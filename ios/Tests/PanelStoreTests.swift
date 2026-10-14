import Foundation

private let sampleJSON = """
{"user":{"id":"admin","name":"Yönetici","email":"admin@example.test","role":"admin","department":"Yönetim","hotelIds":[]},"users":[],"hotels":[{"id":"hotel","name":"Mi Hotel","location":"","stage":"onboarding"}],"tasks":[{"id":"task","hotelId":"hotel","code":"DAT-008","title":"İlk iş","description":"Açıklama","stage":"Kurulum","department":"Web","assigneeId":null,"priority":1,"status":"planned","dueDate":null,"hotelInput":"Bilgi","waitingReason":"","checklist":[{"id":"criterion","text":"Kontrol","done":false}],"createdAt":"2026-10-14T10:00:00Z","updatedAt":"2026-10-14T10:00:00Z"}],"comments":[],"taskVersions":{"task":"version-one"},"demo":false}
"""

private func fixture(_ replacement: String? = nil) throws -> PanelSnapshot {
    let json = replacement.map { sampleJSON.replacingOccurrences(of: "İlk iş", with: $0) } ?? sampleJSON
    return try JSONDecoder().decode(PanelSnapshot.self, from: Data(json.utf8))
}

private actor FakePanelAPI: PanelServicing {
    enum Step: Sendable { case data(PanelSnapshot), unchanged, offline, unauthorized, held }
    var steps: [Step]
    let user: PanelUser
    var restored: PanelSession?
    var taskResult: PanelTaskResponse?
    var conflict = false
    var held: CheckedContinuation<PanelFetchResult, Error>?
    var waiting: CheckedContinuation<Void, Never>?
    var fetched = 0
    var saved = 0

    init(_ value: PanelSnapshot, steps: [Step], restored: Bool = false) {
        user = value.user
        self.steps = steps
        self.restored = restored ? PanelSession(userID: value.user.id, expiresAt: Date().addingTimeInterval(3600)) : nil
    }
    func restoreSession() -> PanelSession? { restored }
    func login(email: String, password: String) -> PanelUser { user }
    func logout() {}
    func configureTask(_ result: PanelTaskResponse?, conflict: Bool = false) { taskResult = result; self.conflict = conflict }
    func fetch(etag: String?) async throws -> PanelFetchResult {
        fetched += 1
        let step = steps.isEmpty ? .unchanged : steps.removeFirst()
        switch step {
        case .data(let data): return PanelFetchResult(snapshot: data, etag: "etag")
        case .unchanged: return PanelFetchResult(snapshot: nil, etag: etag)
        case .offline: throw URLError(.notConnectedToInternet)
        case .unauthorized: throw PanelAPIError.sessionExpired
        case .held:
            return try await withCheckedThrowingContinuation { continuation in
                held = continuation
                waiting?.resume()
                waiting = nil
            }
        }
    }
    func waitForHeld() async {
        if held != nil { return }
        await withCheckedContinuation { waiting = $0 }
    }
    func release(_ snapshot: PanelSnapshot) {
        held?.resume(returning: PanelFetchResult(snapshot: snapshot, etag: "old"))
        held = nil
    }
    func updateTask(id: String, version: String, payload: PanelTaskMutation) throws -> PanelTaskResponse {
        saved += 1
        if conflict { throw PanelAPIError.http(409, "Görev değişti.") }
        guard let taskResult else { throw PanelAPIError.invalidResponse }
        return taskResult
    }
    func addComment(taskID: String, body: String, requestID: String) -> PanelComment {
        saved += 1
        return PanelComment(id: requestID, taskId: taskID, userId: user.id, userName: user.name, body: body, createdAt: "2026-10-14T10:00:00Z")
    }
}

@main
struct PanelStoreTests {
    @MainActor
    static func main() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        func cache(_ name: String) -> PanelCache { PanelCache(fileURL: directory.appendingPathComponent(name)) }
        var count = 0
        func check(_ condition: Bool, _ label: String) {
            guard condition else { fatalError("FAIL: \(label)") }
            count += 1
            print("PASS: \(label)")
        }
        let initial = try fixture()
        let changed = try fixture("Ekip güncelledi")

        let offlineCache = cache("offline.json")
        try offlineCache.save(snapshot: initial, etag: "etag", date: Date())
        check(try offlineCache.load(userID: "someone-else") == nil, "cache never exposes another account")
        let offlineAPI = FakePanelAPI(initial, steps: [.offline], restored: true)
        let offline = PanelStore(api: offlineAPI, cache: offlineCache)
        await offline.start()
        check(offline.snapshot == initial && offline.isOffline && !offline.canEdit(initial.tasks[0]), "offline session loads read-only account cache")
        check(!(await offline.updateTask(initial.tasks[0], payload: .checklist(itemID: "criterion", done: true))), "offline changes are not queued or shown as saved")

        let freshAPI = FakePanelAPI(initial, steps: [.data(initial), .unchanged])
        let freshCache = cache("fresh.json")
        let fresh = PanelStore(api: freshAPI, cache: freshCache)
        await fresh.start()
        await fresh.login(email: initial.user.email, password: "test-only")
        check(fresh.snapshot == initial && fresh.canEdit(initial.tasks[0]), "successful login gets actual server tasks")
        let before = try Data(contentsOf: freshCache.fileURL)
        await fresh.refresh()
        check(try Data(contentsOf: freshCache.fileURL) == before, "304 does not rewrite cache")

        let conflictAPI = FakePanelAPI(initial, steps: [.data(initial), .data(changed)])
        await conflictAPI.configureTask(nil, conflict: true)
        let conflictStore = PanelStore(api: conflictAPI, cache: cache("conflict.json"))
        await conflictStore.start()
        await conflictStore.login(email: initial.user.email, password: "test-only")
        let conflictSaved = await conflictStore.updateTask(initial.tasks[0], payload: .submit)
        check(!conflictSaved && conflictStore.snapshot?.tasks[0].title == "Ekip güncelledi" && conflictStore.errorMessage != nil,
              "409 preserves server change and returns a visible failure")

        let notesAPI = FakePanelAPI(initial, steps: [.data(initial)])
        let notes = PanelStore(api: notesAPI, cache: cache("notes.json"))
        await notes.start()
        await notes.login(email: initial.user.email, password: "test-only")
        _ = await notes.addComment(taskID: "task", body: "Ekip notu", requestID: "stable-note")
        _ = await notes.addComment(taskID: "task", body: "Ekip notu", requestID: "stable-note")
        check(notes.snapshot?.comments.count == 1, "acknowledged note retries do not duplicate UI comments")

        let expiredCache = cache("expired.json")
        try expiredCache.save(snapshot: initial, etag: "etag", date: Date())
        let expired = PanelStore(api: FakePanelAPI(initial, steps: [.unauthorized], restored: true), cache: expiredCache)
        await expired.start()
        check(!expired.isSignedIn && expired.snapshot == nil && !FileManager.default.fileExists(atPath: expiredCache.fileURL.path),
              "revoked session clears visible and cached team data")

        let raceAPI = FakePanelAPI(initial, steps: [.data(initial), .held])
        await raceAPI.configureTask(PanelTaskResponse(task: changed.tasks[0], version: "version-two"))
        let race = PanelStore(api: raceAPI, cache: cache("race.json"))
        await race.start()
        await race.login(email: initial.user.email, password: "test-only")
        let refresh = Task { await race.refresh() }
        await raceAPI.waitForHeld()
        _ = await race.updateTask(initial.tasks[0], payload: .checklist(itemID: "criterion", done: true))
        await raceAPI.release(initial)
        await refresh.value
        check(race.snapshot?.tasks[0].title == "Ekip güncelledi", "slow old refresh cannot overwrite acknowledged mutation")

        let logoutAPI = FakePanelAPI(initial, steps: [.data(initial), .held])
        let logoutCache = cache("logout.json")
        let logoutStore = PanelStore(api: logoutAPI, cache: logoutCache)
        await logoutStore.start()
        await logoutStore.login(email: initial.user.email, password: "test-only")
        let oldRefresh = Task { await logoutStore.refresh() }
        await logoutAPI.waitForHeld()
        await logoutStore.logout()
        await logoutAPI.release(initial)
        await oldRefresh.value
        check(!logoutStore.isSignedIn && logoutStore.snapshot == nil && !FileManager.default.fileExists(atPath: logoutCache.fileURL.path),
              "late responses after logout cannot repopulate account data")
        print("\(count) team store checks passed.")
    }
}
