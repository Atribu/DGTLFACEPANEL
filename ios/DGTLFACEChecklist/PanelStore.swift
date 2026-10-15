import Combine
import Foundation

@MainActor
final class PanelStore: ObservableObject {
    @Published private(set) var snapshot: PanelSnapshot?
    @Published private(set) var isSignedIn = false
    @Published private(set) var isLoading = false
    @Published private(set) var isRefreshing = false
    @Published private(set) var isSaving = false
    @Published private(set) var isOffline = false
    @Published private(set) var lastSyncedAt: Date?
    @Published var errorMessage: String?
    @Published var statusMessage: String?

    private let api: any PanelServicing
    private let cache: PanelCache
    private var accountID: String?
    private var etag: String?
    private var started = false
    private var active = false
    private var epoch = 0
    private var mutation = 0
    private var refreshRequest = 0
    private var failures = 0
    private var cacheWarning: String?
    private var polling: Task<Void, Never>?

    init(api: any PanelServicing = PanelAPI(), cache: PanelCache = .standard()) {
        self.api = api
        self.cache = cache
    }

    func start() async {
        guard !started else { return }
        started = true
        isLoading = true
        let generation = epoch
        do {
            if let session = try await api.restoreSession(), session.expiresAt > Date() {
                guard generation == epoch else { return }
                accountID = session.userID
                isSignedIn = true
                isOffline = true // Cached content is read-only until the server validates it.
                do {
                    if let saved = try cache.load(userID: session.userID) {
                        snapshot = saved.snapshot
                        etag = saved.etag
                        lastSyncedAt = saved.savedAt
                    }
                } catch {
                    statusMessage = "Son indirilen liste okunamadı. Güncel liste sunucudan alınacak."
                }
                await refresh()
            } else {
                try cache.clear()
            }
        } catch {
            guard generation == epoch else { return }
            errorMessage = error.localizedDescription
        }
        guard generation == epoch else { return }
        isLoading = false
        beginPolling()
    }

    func login(email: String, password: String) async {
        guard !isLoading, !isSignedIn else { return }
        epoch += 1
        let generation = epoch
        isLoading = true
        errorMessage = nil
        snapshot = nil
        etag = nil
        lastSyncedAt = nil
        do {
            let user = try await api.login(email: email.trimmingCharacters(in: .whitespacesAndNewlines), password: password)
            guard generation == epoch else { return }
            accountID = user.id
            isSignedIn = true
            isOffline = true
            try? cache.clear()
            await refresh()
        } catch {
            guard generation == epoch else { return }
            errorMessage = error.localizedDescription
        }
        guard generation == epoch else { return }
        isLoading = false
        beginPolling()
    }

    func logout() async {
        guard !isSaving, !isLoading else { return }
        epoch += 1
        polling?.cancel()
        polling = nil
        isLoading = true
        isRefreshing = false
        do {
            try await api.logout()
            clearAccount()
        } catch {
            errorMessage = "Çıkış tamamlanamadı. \(error.localizedDescription)"
        }
        isLoading = false
        beginPolling()
    }

    func setActive(_ value: Bool) {
        guard active != value else { return }
        active = value
        polling?.cancel()
        polling = nil
        if value { beginPolling(refreshImmediately: true) }
    }

    private func beginPolling(refreshImmediately: Bool = false) {
        guard active, started, isSignedIn, polling == nil else { return }
        polling = Task { [weak self] in
            if refreshImmediately { await self?.refresh() }
            while !Task.isCancelled {
                guard let self else { return }
                let powerInterval: Double = ProcessInfo.processInfo.isLowPowerModeEnabled ? 90 : 30
                let retryInterval = failures == 0 ? powerInterval : min(300, 30 * pow(2, Double(min(failures, 4))))
                do {
                    try await Task.sleep(for: .seconds(max(powerInterval, retryInterval)))
                } catch { return }
                guard !Task.isCancelled, active, isSignedIn else { return }
                await refresh()
            }
        }
    }

    func refresh() async {
        guard isSignedIn, !isRefreshing, !isSaving else { return }
        let generation = epoch
        let change = mutation
        refreshRequest += 1
        let request = refreshRequest
        isRefreshing = true
        defer { if generation == epoch && request == refreshRequest { isRefreshing = false } }
        do {
            let result = try await api.fetch(etag: snapshot == nil ? nil : etag)
            guard !Task.isCancelled, generation == epoch, change == mutation, request == refreshRequest else { return }
            if let next = result.snapshot {
                guard next.user.id == accountID else { throw PanelAPIError.invalidResponse }
                let changed = next != snapshot || etag != result.etag
                snapshot = next
                etag = result.etag
                if changed { saveCache() }
            } else if snapshot == nil {
                throw PanelAPIError.invalidResponse
            }
            isOffline = false
            failures = 0
            lastSyncedAt = Date()
            statusMessage = snapshot?.checklistImportWarning ?? cacheWarning
        } catch {
            guard !Task.isCancelled, generation == epoch, change == mutation, request == refreshRequest else { return }
            handleFailure(error, showAlert: false)
        }
    }

    func task(id: String) -> PanelTask? { snapshot?.tasks.first { $0.id == id } }

    func canComment(_ task: PanelTask) -> Bool {
        guard !isOffline, isSignedIn, !isLoading, let user = snapshot?.user, user.active != false else { return false }
        return user.role == "admin" || (user.role == "staff" && task.assigneeId == user.id)
    }

    func canEdit(_ task: PanelTask) -> Bool {
        canComment(task) && task.status != "review" && task.status != "completed"
    }

    var canManage: Bool {
        isSignedIn && !isOffline && !isLoading && snapshot?.user.role == "admin" && snapshot?.user.active != false
    }

    /// Resource screens retain their own view state; account and mutation generations
    /// prevent a delayed response from leaking into a later session or newer edit.
    func loadResource<T: Decodable & Sendable>(path: String, as type: T.Type = T.self) async -> T? {
        guard let data = await downloadResource(path: path) else { return nil }
        do { return try JSONDecoder().decode(T.self, from: data) }
        catch { errorMessage = PanelAPIError.invalidResponse.localizedDescription; return nil }
    }

    func downloadResource(path: String) async -> Data? {
        guard isSignedIn, !isLoading else { return nil }
        let generation = epoch
        let change = mutation
        do {
            let data = try await api.request(path: path, method: "GET", body: nil, contentType: nil)
            guard !Task.isCancelled, generation == epoch, change == mutation, isSignedIn else { return nil }
            return data
        } catch {
            guard !Task.isCancelled, generation == epoch, change == mutation else { return nil }
            handleFailure(error, showAlert: true)
            return nil
        }
    }

    func mutateResource<B: Encodable & Sendable, R: Decodable & Sendable>(
        path: String, method: String, body: B, as type: R.Type = R.self
    ) async -> R? {
        guard ["POST", "PATCH", "DELETE"].contains(method), beginResourceMutation() else { return nil }
        let generation = epoch
        do {
            let body = try JSONEncoder().encode(body)
            let data = try await api.request(path: path, method: method, body: body, contentType: "application/json")
            guard generation == epoch, isSignedIn else { return nil }
            let response = try JSONDecoder().decode(R.self, from: data)
            await finishResourceMutation()
            guard generation == epoch, isSignedIn else { return nil }
            return response
        } catch {
            guard generation == epoch else { return nil }
            await failResourceMutation(error)
            return nil
        }
    }

    func uploadAttachment(taskID: String, fileURL: URL, title: String) async -> Bool {
        guard let task = task(id: taskID), canEdit(task), beginResourceMutation() else { return false }
        let generation = epoch
        let scoped = fileURL.startAccessingSecurityScopedResource()
        defer { if scoped { fileURL.stopAccessingSecurityScopedResource() } }
        do {
            let attributes = try fileURL.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
            guard fileURL.isFileURL, attributes.isRegularFile == true,
                  let size = attributes.fileSize, size > 0, size <= 10 * 1024 * 1024 else {
                throw PanelAPIError.http(413, "Dosya boş olmamalı ve en fazla 10 MB olabilir.")
            }
            // Bound the read as well as the metadata check in case the file grows.
            let handle = try FileHandle(forReadingFrom: fileURL)
            defer { try? handle.close() }
            let data = try handle.read(upToCount: 10 * 1024 * 1024 + 1) ?? Data()
            _ = try await api.uploadAttachment(taskID: taskID, fileName: fileURL.lastPathComponent, data: data, title: title)
            guard generation == epoch, isSignedIn else { return false }
            await finishResourceMutation()
            return generation == epoch && isSignedIn
        } catch {
            guard generation == epoch else { return false }
            await failResourceMutation(error)
            return false
        }
    }

    private func beginResourceMutation() -> Bool {
        guard isSignedIn, !isOffline, !isSaving, !isLoading, snapshot?.user.active != false else { return false }
        isSaving = true
        mutation += 1
        errorMessage = nil
        return true
    }

    private func finishResourceMutation() async {
        etag = nil
        lastSyncedAt = Date()
        isSaving = false
        // A pre-write refresh may still be in flight. Supersede it so this refresh
        // cannot be skipped and the old response cannot overwrite the new state.
        refreshRequest += 1
        isRefreshing = false
        await refresh()
    }

    private func failResourceMutation(_ error: Error) async {
        isSaving = false
        if error is CancellationError { return }
        handleFailure(error, showAlert: true)
        if case PanelAPIError.http(let code, _) = error, [403, 404, 409].contains(code) {
            etag = nil
            refreshRequest += 1
            isRefreshing = false
            await refresh()
        }
    }

    private struct Acknowledgement: Decodable, Sendable {}
    private struct ManagerUpdate: Encodable, Sendable { let managerId: String }

    func createTask(_ draft: PanelTaskDraft) async -> Bool {
        guard canManage else { return false }
        let result: Acknowledgement? = await mutateResource(path: "/api/tasks", method: "POST", body: draft)
        return result != nil
    }

    func updateTaskDetails(_ task: PanelTask, draft: PanelTaskDraft) async -> Bool {
        guard canManage else { return false }
        return await updateTask(task, payload: .update(draft))
    }

    func createHotel(_ draft: PanelHotelDraft) async -> Bool {
        guard canManage else { return false }
        let result: Acknowledgement? = await mutateResource(path: "/api/hotels", method: "POST", body: draft)
        return result != nil
    }

    func updateHotelManager(hotelID: String, managerID: String) async -> Bool {
        guard canManage else { return false }
        let result: Acknowledgement? = await mutateResource(path: "/api/hotels/\(hotelID)", method: "PATCH",
                                                          body: ManagerUpdate(managerId: managerID))
        return result != nil
    }

    func saveUser(id: String?, draft: PanelUserDraft) async -> Bool {
        guard canManage else { return false }
        var body = draft
        if id == nil { body.active = nil } else { body.password = nil; body.active = draft.active ?? true }
        let result: Acknowledgement? = await mutateResource(path: id.map { "/api/users/\($0)" } ?? "/api/users",
                                                          method: id == nil ? "POST" : "PATCH", body: body)
        return result != nil
    }

    func updateTask(_ task: PanelTask, payload: PanelTaskMutation) async -> Bool {
        guard !isSaving, canComment(task), let version = snapshot?.taskVersions[task.id] else { return false }
        guard self.task(id: task.id) == task else {
            errorMessage = "Görev güncellendi. Son bilgileri kontrol edip tekrar dene."
            return false
        }
        isSaving = true
        errorMessage = nil
        mutation += 1
        let generation = epoch
        do {
            let result = try await api.updateTask(id: task.id, version: version, payload: payload)
            guard generation == epoch else { return false }
            if let index = snapshot?.tasks.firstIndex(where: { $0.id == result.task.id }) {
                snapshot?.tasks[index] = result.task
                snapshot?.taskVersions[result.task.id] = result.version
            }
            etag = nil
            lastSyncedAt = Date()
            saveCache()
            await finishResourceMutation()
            return true
        } catch {
            guard generation == epoch else { return false }
            await failResourceMutation(error)
            return false
        }
    }

    func addComment(taskID: String, body: String, requestID: String) async -> Bool {
        guard !isSaving, let task = task(id: taskID), canComment(task) else { return false }
        isSaving = true
        errorMessage = nil
        mutation += 1
        let generation = epoch
        do {
            let comment = try await api.addComment(taskID: taskID, body: body, requestID: requestID)
            guard generation == epoch else { return false }
            if snapshot?.comments.contains(where: { $0.id == comment.id }) == false {
                snapshot?.comments.append(comment)
            }
            etag = nil
            lastSyncedAt = Date()
            saveCache()
            await finishResourceMutation()
            return true
        } catch {
            guard generation == epoch else { return false }
            await failResourceMutation(error)
            return false
        }
    }

    private func saveCache() {
        guard let snapshot else { return }
        do {
            try cache.save(snapshot: snapshot, etag: etag, date: Date())
            cacheWarning = nil
        } catch {
            cacheWarning = "Güncel liste alındı, ancak çevrimdışı kopyası bu telefona kaydedilemedi."
            statusMessage = cacheWarning
        }
    }

    private func handleFailure(_ error: Error, showAlert: Bool) {
        if case PanelAPIError.sessionExpired = error {
            epoch += 1
            clearAccount()
            errorMessage = error.localizedDescription
            return
        }
        if case PanelAPIError.http(401, _) = error {
            epoch += 1
            clearAccount()
            errorMessage = PanelAPIError.sessionExpired.localizedDescription
            return
        }
        failures += 1
        if error is URLError || !showAlert {
            isOffline = true
            statusMessage = error is URLError
                ? "Bağlantı kurulamadı. Son indirilen listeyi görüntülüyorsun; değişiklik için yeniden bağlan."
                : error.localizedDescription
        }
        if showAlert { errorMessage = error.localizedDescription }
    }

    private func clearAccount() {
        polling?.cancel()
        polling = nil
        snapshot = nil
        accountID = nil
        etag = nil
        lastSyncedAt = nil
        isSignedIn = false
        isLoading = false
        isSaving = false
        isRefreshing = false
        isOffline = false
        statusMessage = nil
        failures = 0
        cacheWarning = nil
        try? cache.clear()
    }
}
