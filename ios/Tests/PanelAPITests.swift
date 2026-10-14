import Foundation

private struct Failure: Error, CustomStringConvertible, Sendable {
    let description: String
}

private func expect(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
    guard try condition() else { throw Failure(description: message) }
}

private final class MemoryCredentials: PanelCredentialStoring, @unchecked Sendable {
    private let lock = NSLock()
    private var data: Data?
    private var refusesWrites = false
    func load() throws -> Data? { lock.withLock { data } }
    func save(_ data: Data) throws {
        try lock.withLock {
            guard !refusesWrites else { throw PanelAPIError.credentialStorage }
            self.data = data
        }
    }
    func remove() throws { lock.withLock { data = nil } }
    func refuseWrites() { lock.withLock { refusesWrites = true } }
}

private struct Stub: Sendable {
    let status: Int
    var headers: [String: String] = ["Content-Type": "application/json"]
    var data = Data()
    var delay: TimeInterval = 0
    var error: URLError?
}

private struct RecordedRequest: Sendable {
    let url: URL
    let method: String
    let headers: [String: String]
    let body: Data

    func header(_ name: String) -> String? {
        headers.first { $0.key.lowercased() == name.lowercased() }?.value
    }
}

private final class StubRegistry: @unchecked Sendable {
    private let lock = NSLock()
    private var stubs: [Stub] = []
    private var requests: [RecordedRequest] = []

    func prepare(_ stubs: [Stub]) { lock.withLock { self.stubs = stubs; requests = [] } }
    func recorded() -> [RecordedRequest] { lock.withLock { requests } }

    func take(_ request: URLRequest) -> Stub {
        var body = request.httpBody ?? Data()
        if body.isEmpty, let stream = request.httpBodyStream {
            stream.open()
            defer { stream.close() }
            var buffer = [UInt8](repeating: 0, count: 1024)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                if count <= 0 { break }
                body.append(buffer, count: count)
            }
        }
        let record = RecordedRequest(url: request.url!, method: request.httpMethod ?? "GET",
                                     headers: request.allHTTPHeaderFields ?? [:], body: body)
        return lock.withLock {
            requests.append(record)
            return stubs.isEmpty ? Stub(status: 500, error: URLError(.badServerResponse)) : stubs.removeFirst()
        }
    }
}

private final class MockProtocol: URLProtocol, @unchecked Sendable {
    static let registry = StubRegistry()
    private let lock = NSLock()
    private var stopped = false

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let stub = Self.registry.take(request)
        if stub.delay > 0 {
            DispatchQueue.global().asyncAfter(deadline: .now() + stub.delay) { [self] in deliver(stub) }
        } else { deliver(stub) }
    }
    private func deliver(_ stub: Stub) {
        guard !lock.withLock({ stopped }) else { return }
        if let error = stub.error {
            client?.urlProtocol(self, didFailWithError: error)
            return
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: stub.status,
                                       httpVersion: "HTTP/1.1", headerFields: stub.headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: stub.data)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() { lock.withLock { stopped = true } }
}

@main
@MainActor
private struct PanelAPITests {
    static let base = URL(string: "https://panel.example.test")!
    static let cookie = "dgtlface-session=opaque-test-session; Path=/; Max-Age=28800; Secure; HttpOnly; SameSite=Lax"
    static let user = PanelUser(id: "admin-one", name: "Yönetici", email: "admin@example.test",
                                role: "admin", department: "Yönetim", hotelIds: [], active: true)

    static func api(_ credentials: MemoryCredentials = MemoryCredentials()) -> PanelAPI {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockProtocol.self]
        return PanelAPI(testingBaseURL: base, configuration: configuration, credentialStore: credentials)
    }
    static func json<T: Encodable>(_ value: T) throws -> Data { try JSONEncoder().encode(value) }
    static func object(_ data: Data) throws -> [String: Any] {
        guard let result = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw Failure(description: "Expected JSON object")
        }
        return result
    }
    static func loginStub(cookie value: String = cookie, delay: TimeInterval = 0) throws -> Stub {
        Stub(status: 200, headers: ["Content-Type": "application/json", "Set-Cookie": value],
             data: try json(["user": user]), delay: delay)
    }
    static func expectAPIError(_ operation: () async throws -> Void,
                               matching predicate: (PanelAPIError) -> Bool) async throws {
        do { try await operation() }
        catch let error as PanelAPIError {
            try expect(predicate(error), "Unexpected API error: \(error)")
            return
        }
        throw Failure(description: "Expected API error")
    }

    static func main() async throws {
        var passed = 0
        func test(_ name: String, _ operation: () async throws -> Void) async throws {
            try await operation()
            passed += 1
            print("PASS \(name)")
        }

        let task = PanelTask(id: "task-one", hotelId: "hotel-one", code: "DAT-008", title: "Ölçümleme",
                             description: "Açıklama", stage: "Ölçümleme & Veri", department: "Veri",
                             assigneeId: nil, priority: 1, status: "planned", dueDate: nil, hotelInput: "",
                             waitingReason: "", checklist: [PanelCriterion(id: "criterion-one", text: "Kontrol", done: false)],
                             createdAt: "2026-10-14T00:00:00Z", updatedAt: "2026-10-14T00:00:00Z")
        let snapshot = PanelSnapshot(user: user, users: [user],
                                     hotels: [PanelHotel(id: "hotel-one", name: "Miramare Beach", location: "", stage: "onboarding")],
                                     tasks: [task], comments: [], taskVersions: [task.id: "version-one"],
                                     demo: false, checklistImportWarning: nil)
        let comment = PanelComment(id: "comment-one", taskId: task.id, userId: user.id,
                                   userName: user.name, body: "Türkçe ekip notu", createdAt: task.createdAt)

        try await test("Login keeps only the bounded cookie session, never the password") {
            let credentials = MemoryCredentials()
            let service = api(credentials)
            MockProtocol.registry.prepare([try loginStub()])
            let loggedIn = try await service.login(email: user.email, password: "do-not-store-this-password")
            try expect(loggedIn == user, "Login user differs")
            let requests = MockProtocol.registry.recorded()
            try expect(requests.count == 1 && requests[0].url.path == "/api/login", "Wrong login request")
            try expect(requests[0].method == "POST" && requests[0].header("Cookie") == nil, "Login must be anonymous")
            try expect(requests[0].header("Origin") == base.absoluteString, "Missing same-origin header")
            try expect(requests[0].header("Content-Type") == "application/json", "Missing JSON header")
            let saved = try credentials.load()!
            try expect(!String(decoding: saved, as: UTF8.self).contains("do-not-store"), "Password persisted")
            let restored = try await api(credentials).restoreSession()
            try expect(restored?.userID == user.id, "Session account not restored")
            try expect(restored!.expiresAt > Date() && restored!.expiresAt.timeIntervalSinceNow <= 28800,
                       "Session expiry must be capped at 8h")
            try expect(MockProtocol.registry.recorded().count == 1, "Restore must not use the network")
        }

        try await test("ETag requests preserve session headers and 304 skips JSON parsing") {
            let service = api()
            MockProtocol.registry.prepare([try loginStub(), Stub(status: 200, headers: ["ETag": "\"etag-one\""], data: try json(snapshot)),
                                           Stub(status: 304, data: Data("not JSON".utf8))])
            _ = try await service.login(email: user.email, password: "test")
            let initial = try await service.fetch(etag: nil)
            try expect(initial.snapshot == snapshot && initial.etag == "\"etag-one\"", "Snapshot or ETag lost")
            let unchanged = try await service.fetch(etag: initial.etag)
            try expect(unchanged.snapshot == nil && unchanged.etag == initial.etag, "304 parsed or dropped ETag")
            let requests = MockProtocol.registry.recorded()
            try expect(requests[2].header("If-None-Match") == "\"etag-one\"", "Missing conditional header")
            try expect(requests[2].header("Cookie") == "dgtlface-session=opaque-test-session", "Wrong session cookie")
        }

        try await test("Task mutation sends the expected version and an explicit desired check state") {
            let service = api()
            MockProtocol.registry.prepare([try loginStub(), Stub(status: 200, data: try json(PanelTaskResponse(task: task, version: "version-two")))])
            _ = try await service.login(email: user.email, password: "test")
            let result = try await service.updateTask(id: task.id, version: "version-one",
                                                       payload: .checklist(itemID: "criterion-one", done: true))
            try expect(result.version == "version-two" && result.task == task, "Task response lost")
            let request = MockProtocol.registry.recorded()[1]
            let body = try object(request.body)
            let payload = body["payload"] as! [String: Any]
            try expect(request.method == "PATCH" && request.url.path == "/api/mobile/tasks/task-one", "Wrong task route")
            try expect(body["expectedVersion"] as? String == "version-one", "Version guard omitted")
            try expect(payload["action"] as? String == "checklist" && payload["done"] as? Bool == true, "Desired state omitted")
        }

        try await test("Notes carry the caller's stable idempotency request ID") {
            let service = api()
            MockProtocol.registry.prepare([try loginStub(), Stub(status: 200, data: try json(["comment": comment]))])
            _ = try await service.login(email: user.email, password: "test")
            let result = try await service.addComment(taskID: task.id, body: comment.body, requestID: "same-request-id")
            try expect(result == comment, "Comment response differs")
            let request = MockProtocol.registry.recorded()[1]
            let body = try object(request.body)
            try expect(request.url.path == "/api/mobile/tasks/task-one/comments" && request.method == "POST", "Wrong comment route")
            try expect(body["requestId"] as? String == "same-request-id" && body["body"] as? String == comment.body,
                       "Idempotency key or exact note changed")
        }

        try await test("Unauthorized authenticated requests clear the saved session") {
            let credentials = MemoryCredentials()
            let service = api(credentials)
            MockProtocol.registry.prepare([try loginStub(), Stub(status: 401, data: Data("{}".utf8))])
            _ = try await service.login(email: user.email, password: "test")
            try await expectAPIError({ _ = try await service.fetch(etag: nil) }, matching: {
                if case .sessionExpired = $0 { return true }; return false
            })
            try expect(try credentials.load() == nil, "401 kept the cookie")
            let restored = try await service.restoreSession()
            try expect(restored == nil, "401 kept an in-memory session")
        }

        try await test("Wrong credentials retain the login error and never create a session") {
            let credentials = MemoryCredentials()
            let service = api(credentials)
            MockProtocol.registry.prepare([Stub(status: 401, data: Data("{\"error\":\"E-posta veya şifre hatalı.\"}".utf8))])
            try await expectAPIError({ _ = try await service.login(email: user.email, password: "wrong") }, matching: {
                if case .http(401, "E-posta veya şifre hatalı.") = $0 { return true }; return false
            })
            try expect(try credentials.load() == nil, "Invalid login saved a cookie")
        }

        try await test("Insecure, cross-domain, expired or incomplete login cookies are refused") {
            let invalid = [
                cookie.replacingOccurrences(of: "; Secure", with: ""),
                cookie + "; Domain=attacker.example.test",
                cookie.replacingOccurrences(of: "Max-Age=28800", with: "Max-Age=0"),
                cookie.replacingOccurrences(of: "; HttpOnly", with: ""),
                cookie.replacingOccurrences(of: "; Max-Age=28800", with: "")
            ]
            for value in invalid {
                let credentials = MemoryCredentials()
                let service = api(credentials)
                MockProtocol.registry.prepare([try loginStub(cookie: value)])
                try await expectAPIError({ _ = try await service.login(email: user.email, password: "test") }, matching: {
                    if case .invalidResponse = $0 { return true }; return false
                })
                try expect(try credentials.load() == nil, "Unsafe cookie persisted")
            }
        }

        try await test("HTML 404 explains deployment while JSON task errors remain accurate") {
            let service = api()
            MockProtocol.registry.prepare([try loginStub(), Stub(status: 404, data: Data("<html>Not found</html>".utf8)),
                                           Stub(status: 404, data: Data("{\"error\":\"Görev bulunamadı.\"}".utf8))])
            _ = try await service.login(email: user.email, password: "test")
            try await expectAPIError({ _ = try await service.fetch(etag: nil) }, matching: {
                if case .http(404, "Sunucunun mobil güncellemesi henüz yayınlanmamış.") = $0 { return true }; return false
            })
            try await expectAPIError({ _ = try await service.updateTask(id: task.id, version: "v", payload: .submit) }, matching: {
                if case .http(404, "Görev bulunamadı.") = $0 { return true }; return false
            })
        }

        try await test("Network loss preserves the credential for readonly cached operation") {
            let credentials = MemoryCredentials()
            let service = api(credentials)
            MockProtocol.registry.prepare([try loginStub(), Stub(status: 0, error: URLError(.notConnectedToInternet))])
            _ = try await service.login(email: user.email, password: "test")
            do {
                _ = try await service.fetch(etag: nil)
                throw Failure(description: "Expected network failure")
            } catch let error as URLError {
                try expect(error.code == .notConnectedToInternet, "Network error changed")
            }
            try expect(try credentials.load() != nil, "Network failure removed valid session")
        }

        try await test("Logout clears credentials even when its network request fails") {
            let credentials = MemoryCredentials()
            let service = api(credentials)
            MockProtocol.registry.prepare([try loginStub(), Stub(status: 0, error: URLError(.notConnectedToInternet))])
            _ = try await service.login(email: user.email, password: "test")
            try await service.logout()
            try expect(try credentials.load() == nil, "Offline logout retained credential")
            let request = MockProtocol.registry.recorded()[1]
            try expect(request.url.path == "/api/logout" && request.header("Cookie") != nil, "Server logout missed old cookie")
        }

        try await test("Logout cancels an unfinished login so late responses cannot restore it") {
            let credentials = MemoryCredentials()
            let service = api(credentials)
            MockProtocol.registry.prepare([try loginStub(delay: 0.2)])
            let pending = Task { try await service.login(email: user.email, password: "test") }
            for _ in 0..<100 {
                if !MockProtocol.registry.recorded().isEmpty { break }
                try await Task.sleep(for: .milliseconds(5))
            }
            try expect(MockProtocol.registry.recorded().count == 1, "Login did not start")
            try await service.logout()
            do { _ = try await pending.value; throw Failure(description: "Cancelled login succeeded") }
            catch is CancellationError { }
            try expect(try credentials.load() == nil, "Late login wrote credential")
            let restored = try await service.restoreSession()
            try expect(restored == nil, "Late login restored session")
        }

        try await test("Expired and malformed saved sessions are removed without network access") {
            for bytes in [Data("not JSON".utf8), try JSONSerialization.data(withJSONObject: [
                "userID": user.id, "cookieValue": "opaque-test-session",
                "expiresAt": Date.distantPast.timeIntervalSinceReferenceDate
            ])] {
                let credentials = MemoryCredentials()
                try credentials.save(bytes)
                MockProtocol.registry.prepare([])
                let restored = try await api(credentials).restoreSession()
                try expect(restored == nil && (try credentials.load()) == nil, "Invalid saved cookie survived")
                try expect(MockProtocol.registry.recorded().isEmpty, "Expired session used network")
            }
        }

        try await test("Failed secure storage never publishes a successful login") {
            let credentials = MemoryCredentials()
            credentials.refuseWrites()
            let service = api(credentials)
            MockProtocol.registry.prepare([try loginStub()])
            try await expectAPIError({ _ = try await service.login(email: user.email, password: "test") }, matching: {
                if case .credentialStorage = $0 { return true }; return false
            })
            let restored = try await service.restoreSession()
            try expect(restored == nil, "Unstored cookie became active")
        }

        try await test("Redirect responses and malformed success JSON never expose response content") {
            let service = api()
            MockProtocol.registry.prepare([try loginStub(), Stub(status: 302, headers: ["Location": "https://outside.example.test"]),
                                           Stub(status: 200, data: Data("<html>sensitive response details</html>".utf8))])
            _ = try await service.login(email: user.email, password: "test")
            for _ in 0..<2 {
                try await expectAPIError({ _ = try await service.fetch(etag: nil) }, matching: {
                    if case .invalidResponse = $0 { return true }; return false
                })
            }
            try expect(MockProtocol.registry.recorded().allSatisfy { $0.url.host == base.host }, "External request sent")
        }

        print("\(passed) API tests passed. All requests were intercepted; no real network or Keychain access.")
    }
}
