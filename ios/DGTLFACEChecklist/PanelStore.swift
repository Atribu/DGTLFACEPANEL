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
        isRefreshing = true
        defer { if generation == epoch { isRefreshing = false } }
        do {
            let result = try await api.fetch(etag: snapshot == nil ? nil : etag)
            guard !Task.isCancelled, generation == epoch, change == mutation else { return }
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
            guard !Task.isCancelled, generation == epoch, change == mutation else { return }
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

    func updateTask(_ task: PanelTask, payload: PanelTaskMutation) async -> Bool {
        guard !isSaving, canComment(task), let version = snapshot?.taskVersions[task.id] else { return false }
        guard self.task(id: task.id) == task else {
            errorMessage = "Görev güncellendi. Son bilgileri kontrol edip tekrar dene."
            return false
        }
        isSaving = true
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
            isSaving = false
            await refresh()
            return true
        } catch {
            guard generation == epoch else { return false }
            isSaving = false
            handleFailure(error, showAlert: true)
            if case PanelAPIError.http(let code, _) = error, code == 409 || code == 403 || code == 404 {
                etag = nil
                await refresh()
            }
            return false
        }
    }

    func addComment(taskID: String, body: String, requestID: String) async -> Bool {
        guard !isSaving, let task = task(id: taskID), canComment(task) else { return false }
        isSaving = true
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
            isSaving = false
            await refresh()
            return true
        } catch {
            guard generation == epoch else { return false }
            isSaving = false
            handleFailure(error, showAlert: true)
            if case PanelAPIError.http(let code, _) = error, code == 403 || code == 404 {
                etag = nil
                await refresh()
            }
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
