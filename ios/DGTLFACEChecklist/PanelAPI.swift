import Foundation
import Security

/// Kept separate from the transport so tests never read or write a real login.
protocol PanelCredentialStoring: Sendable {
    func load() throws -> Data?
    func save(_ data: Data) throws
    func remove() throws
}

private struct PanelKeychain: PanelCredentialStoring {
    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "com.dgtlface.personalchecklist.panel-session",
         kSecAttrAccount as String: "production"]
    }

    func load() throws -> Data? {
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else {
            throw PanelAPIError.credentialStorage
        }
        return data
    }

    func save(_ data: Data) throws {
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            let added = SecItemAdd(query.merging(attributes) { _, new in new } as CFDictionary, nil)
            guard added == errSecSuccess else { throw PanelAPIError.credentialStorage }
        } else if status != errSecSuccess {
            throw PanelAPIError.credentialStorage
        }
    }

    func remove() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw PanelAPIError.credentialStorage
        }
    }
}

private final class PanelRedirectBlocker: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        // Login cookies must never follow a redirect to another server.
        completionHandler(nil)
    }
}

actor PanelAPI: PanelServicing {
    private struct Credential: Codable, Sendable {
        let userID: String
        let cookieValue: String
        let expiresAt: Date
    }

    private struct LoginBody: Encodable { let email: String; let password: String }
    private struct LoginResponse: Decodable { let user: PanelUser }
    private struct TaskBody: Encodable {
        let expectedVersion: String
        let payload: PanelTaskMutation
    }
    private struct CommentBody: Encodable { let body: String; let requestId: String }
    private struct CommentResponse: Decodable { let comment: PanelComment }
    private struct ErrorResponse: Decodable { let error: String }

    private static let cookieName = "dgtlface-session"
    private static let maximumSessionAge: TimeInterval = 8 * 60 * 60
    private let baseURL: URL
    private let credentialStore: any PanelCredentialStoring
    private let configuration: URLSessionConfiguration
    private var session: URLSession
    private var credential: Credential?
    private var didLoadCredential = false
    private var generation = 0

    init() {
        let configuration = Self.makeConfiguration()
        self.configuration = configuration
        baseURL = URL(string: "https://panel.dgtlface.com")!
        credentialStore = PanelKeychain()
        session = Self.makeSession(configuration)
    }

    /// Internal dependency injection for isolated URLProtocol tests only.
    init(testingBaseURL: URL, configuration: URLSessionConfiguration,
         credentialStore: any PanelCredentialStoring) {
        let isolated = configuration.copy() as! URLSessionConfiguration
        Self.harden(isolated)
        self.configuration = isolated
        baseURL = testingBaseURL
        self.credentialStore = credentialStore
        session = Self.makeSession(isolated)
    }

    private static func makeConfiguration() -> URLSessionConfiguration {
        let configuration = URLSessionConfiguration.ephemeral
        harden(configuration)
        return configuration
    }

    private static func harden(_ configuration: URLSessionConfiguration) {
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 20
        configuration.timeoutIntervalForResource = 20
        configuration.waitsForConnectivity = false
        configuration.httpMaximumConnectionsPerHost = 2
    }

    private static func makeSession(_ configuration: URLSessionConfiguration) -> URLSession {
        URLSession(configuration: configuration, delegate: PanelRedirectBlocker(), delegateQueue: nil)
    }

    func restoreSession() async throws -> PanelSession? {
        guard let credential = try currentCredential() else { return nil }
        return PanelSession(userID: credential.userID, expiresAt: credential.expiresAt)
    }

    func login(email: String, password: String) async throws -> PanelUser {
        try Task.checkCancellation()
        try clearCredential()
        let operation = generation
        let body = try JSONEncoder().encode(LoginBody(email: email, password: password))
        let (data, response) = try await send(path: "/api/login", method: "POST", body: body,
                                            cookie: nil, generation: operation)
        try checkResponse(response, data: data)
        let result: LoginResponse = try decode(data)
        let next = try loginCredential(response: response, userID: result.user.id)
        // No suspension between the generation check, Keychain write and publish.
        try checkGeneration(operation)
        do { try credentialStore.save(JSONEncoder().encode(next)) }
        catch { throw PanelAPIError.credentialStorage }
        credential = next
        didLoadCredential = true
        return result.user
    }

    func logout() async throws {
        let previous = try? currentCredential()
        try clearCredential()
        guard let previous else { return }
        let operation = generation
        // The device is signed out even when the server cannot be reached.
        _ = try? await send(path: "/api/logout", method: "POST", body: Data("{}".utf8),
                            cookie: previous.cookieValue, generation: operation)
    }

    func fetch(etag: String?) async throws -> PanelFetchResult {
        let credential = try requireCredential()
        let operation = generation
        let (data, response) = try await send(path: "/api/mobile/bootstrap", method: "GET",
                                            cookie: credential.cookieValue, etag: etag,
                                            generation: operation)
        if response.statusCode == 304 {
            return PanelFetchResult(snapshot: nil, etag: response.value(forHTTPHeaderField: "ETag") ?? etag)
        }
        try checkResponse(response, data: data, mobile: true)
        return PanelFetchResult(snapshot: try decode(data), etag: response.value(forHTTPHeaderField: "ETag"))
    }

    func updateTask(id: String, version: String, payload: PanelTaskMutation) async throws -> PanelTaskResponse {
        let credential = try requireCredential()
        let operation = generation
        let body = try JSONEncoder().encode(TaskBody(expectedVersion: version, payload: payload))
        let (data, response) = try await send(path: "/api/mobile/tasks/\(try pathID(id))", method: "PATCH",
                                            body: body, cookie: credential.cookieValue, generation: operation)
        try checkResponse(response, data: data, mobile: true)
        return try decode(data)
    }

    func addComment(taskID: String, body: String, requestID: String) async throws -> PanelComment {
        let credential = try requireCredential()
        let operation = generation
        let encoded = try JSONEncoder().encode(CommentBody(body: body, requestId: requestID))
        let (data, response) = try await send(path: "/api/mobile/tasks/\(try pathID(taskID))/comments",
                                            method: "POST", body: encoded,
                                            cookie: credential.cookieValue, generation: operation)
        try checkResponse(response, data: data, mobile: true)
        let result: CommentResponse = try decode(data)
        return result.comment
    }

    private func currentCredential() throws -> Credential? {
        if !didLoadCredential {
            let saved: Data?
            do { saved = try credentialStore.load() }
            catch { throw PanelAPIError.credentialStorage }
            if let saved {
                guard let decoded = try? JSONDecoder().decode(Credential.self, from: saved),
                      !decoded.userID.isEmpty, Self.validCookieValue(decoded.cookieValue) else {
                    try clearCredential()
                    return nil
                }
                credential = decoded
            }
            didLoadCredential = true
        }
        if let credential, credential.expiresAt <= Date() {
            try clearCredential()
            return nil
        }
        return credential
    }

    private func requireCredential() throws -> Credential {
        try Task.checkCancellation()
        guard let credential = try currentCredential() else { throw PanelAPIError.sessionExpired }
        return credential
    }

    private func clearCredential() throws {
        generation += 1
        credential = nil
        didLoadCredential = true
        session.invalidateAndCancel()
        session = Self.makeSession(configuration)
        do { try credentialStore.remove() }
        catch { throw PanelAPIError.credentialStorage }
    }

    private func checkGeneration(_ operation: Int) throws {
        guard operation == generation else { throw CancellationError() }
        try Task.checkCancellation()
    }

    private func send(path: String, method: String, body: Data? = nil,
                      cookie: String?, etag: String? = nil,
                      generation operation: Int) async throws -> (Data, HTTPURLResponse) {
        try checkGeneration(operation)
        guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL,
              url.scheme == "https", url.host == baseURL.host else {
            throw PanelAPIError.invalidResponse
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(baseURL.absoluteString, forHTTPHeaderField: "Origin")
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if let cookie { request.setValue("\(Self.cookieName)=\(cookie)", forHTTPHeaderField: "Cookie") }
        if let etag { request.setValue(etag, forHTTPHeaderField: "If-None-Match") }
        let data: Data
        let response: URLResponse
        do { (data, response) = try await session.data(for: request) }
        catch {
            try checkGeneration(operation)
            throw error
        }
        try checkGeneration(operation)
        guard let response = response as? HTTPURLResponse,
              response.url?.host == baseURL.host,
              response.url?.scheme == "https" else { throw PanelAPIError.invalidResponse }
        if response.statusCode == 401, cookie != nil {
            try clearCredential()
            throw PanelAPIError.sessionExpired
        }
        if cookie != nil, let saved = credential, saved.expiresAt <= Date() {
            try clearCredential()
            throw PanelAPIError.sessionExpired
        }
        return (data, response)
    }

    private func checkResponse(_ response: HTTPURLResponse, data: Data, mobile: Bool = false) throws {
        guard !(200...299).contains(response.statusCode) else { return }
        if (300...399).contains(response.statusCode) { throw PanelAPIError.invalidResponse }
        let message = (try? JSONDecoder().decode(ErrorResponse.self, from: data))?.error
        if mobile && response.statusCode == 404 && message == nil {
            throw PanelAPIError.http(404, "Sunucunun mobil güncellemesi henüz yayınlanmamış.")
        }
        throw PanelAPIError.http(response.statusCode,
                                 message.map { String($0.prefix(500)) } ?? "İşlem tamamlanamadı. Lütfen tekrar deneyin.")
    }

    private func decode<T: Decodable>(_ data: Data) throws -> T {
        do { return try JSONDecoder().decode(T.self, from: data) }
        catch { throw PanelAPIError.invalidResponse }
    }

    private func pathID(_ id: String) throws -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_"))
        guard !id.isEmpty, id.unicodeScalars.allSatisfy({ allowed.contains($0) }) else {
            throw PanelAPIError.invalidResponse
        }
        return id
    }

    private static func validCookieValue(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.allSatisfy { byte in
            byte >= 0x21 && byte <= 0x7E && ![0x22, 0x2C, 0x3B, 0x5C].contains(byte)
        }
    }

    private func loginCredential(response: HTTPURLResponse, userID: String) throws -> Credential {
        guard let responseURL = response.url, !userID.isEmpty else { throw PanelAPIError.invalidResponse }
        var headers: [String: String] = [:]
        for (key, value) in response.allHeaderFields {
            guard let key = key as? String, let value = value as? String else { continue }
            headers[key] = value
        }
        let matches = HTTPCookie.cookies(withResponseHeaderFields: headers, for: responseURL)
            .filter { $0.name == Self.cookieName }
        guard matches.count == 1, let cookie = matches.first,
              cookie.isSecure, cookie.isHTTPOnly, cookie.path == "/",
              cookie.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")) == baseURL.host,
              Self.validCookieValue(cookie.value) else { throw PanelAPIError.invalidResponse }
        let now = Date()
        var expiry = cookie.expiresDate
        if let rawAge = cookie.properties?[.maximumAge],
           let age = TimeInterval(String(describing: rawAge)) {
            guard age > 0 else { throw PanelAPIError.invalidResponse }
            let maxAgeExpiry = now.addingTimeInterval(age)
            expiry = expiry.map { min($0, maxAgeExpiry) } ?? maxAgeExpiry
        }
        guard let expiry, expiry > now else { throw PanelAPIError.invalidResponse }
        return Credential(userID: userID, cookieValue: cookie.value,
                          expiresAt: min(expiry, now.addingTimeInterval(Self.maximumSessionAge)))
    }
}
