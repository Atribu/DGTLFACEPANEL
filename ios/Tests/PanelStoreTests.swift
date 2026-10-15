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
    var resourceData = Data("{}".utf8)
    var resourceFailure = false
    var resourceHold = false
    var heldResource: CheckedContinuation<Data, Error>?
    var resourceWaiter: CheckedContinuation<Void, Never>?
    var resourceRequests: [(path: String, method: String, body: Data?)] = []

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
    func configureResource(_ data: Data = Data("{}".utf8), hold: Bool = false, unauthorized: Bool = false) {
        resourceData = data; resourceHold = hold; resourceFailure = unauthorized
    }
    func request(path: String, method: String, body: Data?, contentType: String?) async throws -> Data {
        resourceRequests.append((path, method, body))
        if resourceFailure { throw PanelAPIError.sessionExpired }
        if resourceHold {
            return try await withCheckedThrowingContinuation { continuation in
                heldResource = continuation
                resourceWaiter?.resume(); resourceWaiter = nil
            }
        }
        return resourceData
    }
    func uploadAttachment(taskID: String, fileName: String, data: Data, title: String) -> Data {
        saved += 1
        return resourceData
    }
    func waitForResource() async {
        if heldResource != nil { return }
        await withCheckedContinuation { resourceWaiter = $0 }
    }
    func releaseResource() { heldResource?.resume(returning: resourceData); heldResource = nil }
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

        let legacyCache = cache("legacy-cache.json")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var legacyJSON = try JSONSerialization.jsonObject(with: Data(sampleJSON.utf8)) as! [String: Any]
        // This is the exact v1 disk shape: its hotels have only four fields while
        // the saved ETag hashes all server hotel fields, including managerId.
        let legacyBytes = try JSONSerialization.data(withJSONObject: [
            "schemaVersion": 1, "snapshot": legacyJSON, "etag": "unchanged-server-etag", "savedAt": 0
        ])
        try legacyBytes.write(to: legacyCache.fileURL)
        let legacyEntry = try legacyCache.load(userID: initial.user.id)
        check(legacyEntry?.snapshot == initial && legacyEntry?.etag == nil,
              "v1 cache preserves the offline task list but drops stale-shape ETag on upgrade")
        legacyJSON["hotels"] = [[
            "id": "hotel", "name": "Mi Hotel", "location": "Antalya", "stage": "onboarding",
            "services": ["Web", "SEO"], "managerId": "admin", "contactName": "Otel Sorumlusu",
            "contactEmail": "hotel@example.test", "color": "#873DAB", "createdAt": "2026-10-01T09:00:00Z"
        ]]
        let fullDetails = try JSONDecoder().decode(PanelSnapshot.self, from: JSONSerialization.data(withJSONObject: legacyJSON))
        let upgradedCache = cache("upgraded-cache.json")
        try upgradedCache.save(snapshot: fullDetails, etag: "current-server-etag", date: Date())
        let upgradedEntry = try upgradedCache.load(userID: initial.user.id)
        check(upgradedEntry?.schemaVersion == 2 && upgradedEntry?.snapshot == fullDetails && upgradedEntry?.etag == "current-server-etag",
              "v2 cache persists complete hotel details and reuses its matching ETag")

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

        let conflictRaceAPI = FakePanelAPI(initial, steps: [.data(initial), .held, .data(changed)])
        await conflictRaceAPI.configureTask(nil, conflict: true)
        let conflictRace = PanelStore(api: conflictRaceAPI, cache: cache("conflict-race.json"))
        await conflictRace.start()
        await conflictRace.login(email: initial.user.email, password: "test-only")
        let preConflictRefresh = Task { await conflictRace.refresh() }
        await conflictRaceAPI.waitForHeld()
        let conflicted = await conflictRace.updateTask(initial.tasks[0], payload: .submit)
        check(!conflicted && conflictRace.snapshot == changed,
              "409 supersedes a pre-write refresh and immediately loads current server state")
        await conflictRaceAPI.release(initial)
        await preConflictRefresh.value

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

        let resourceBody = PanelEmptyBody()
        let offlineWrite: PanelOKResponse? = await offline.mutateResource(path: "/api/notifications", method: "PATCH", body: resourceBody)
        let offlineRequests = await offlineAPI.resourceRequests
        check(offlineWrite == nil && offlineRequests.isEmpty,
              "offline generic mutations never send a request")

        let resourceAPI = FakePanelAPI(initial, steps: [.data(initial), .data(changed)])
        await resourceAPI.configureResource(Data("{\"ok\":true}".utf8))
        let resourceStore = PanelStore(api: resourceAPI, cache: cache("resource.json"))
        await resourceStore.start()
        await resourceStore.login(email: initial.user.email, password: "test-only")
        let resourceResult: PanelOKResponse? = await resourceStore.mutateResource(path: "/api/notifications", method: "PATCH", body: resourceBody)
        check(resourceResult?.ok == true && resourceStore.snapshot == changed && !resourceStore.isSaving,
              "generic mutation waits for server acknowledgement and refreshes bootstrap")

        let userDraft = PanelUserDraft(name: "Kişi", email: "person@example.test", role: "staff", department: "Web",
                                      hotelIds: [], password: "new-account-only", active: false)
        _ = await resourceStore.saveUser(id: "person", draft: userDraft)
        var records = await resourceAPI.resourceRequests
        let editedUser = try JSONSerialization.jsonObject(with: records.last!.body!) as! [String: Any]
        check(editedUser["password"] == nil && editedUser["action"] == nil && editedUser["active"] as? Bool == false,
              "user editing uses strict server schema without password or action")
        _ = await resourceStore.saveUser(id: nil, draft: userDraft)
        records = await resourceAPI.resourceRequests
        let newUser = try JSONSerialization.jsonObject(with: records.last!.body!) as! [String: Any]
        check(newUser["active"] == nil && newUser["password"] as? String == "new-account-only",
              "user creation includes initial password only and omits unsupported active flag")

        let lateResourceAPI = FakePanelAPI(initial, steps: [.data(initial)])
        await lateResourceAPI.configureResource(Data("{\"ok\":true}".utf8), hold: true)
        let lateResourceStore = PanelStore(api: lateResourceAPI, cache: cache("late-resource.json"))
        await lateResourceStore.start()
        await lateResourceStore.login(email: initial.user.email, password: "test-only")
        let resourceRead = Task { await lateResourceStore.loadResource(path: "/api/notifications", as: PanelOKResponse.self) }
        await lateResourceAPI.waitForResource()
        await lateResourceStore.logout()
        await lateResourceAPI.releaseResource()
        check(await resourceRead.value == nil && !lateResourceStore.isSignedIn,
              "late resource response after logout is never delivered to a resource screen")

        await resourceAPI.configureResource(unauthorized: true)
        let unauthorizedRead = await resourceStore.downloadResource(path: "/api/reports/export")
        check(unauthorizedRead == nil && !resourceStore.isSignedIn && resourceStore.snapshot == nil,
              "resource 401 clears the same session and visible cache as bootstrap")

        let oversized = directory.appendingPathComponent("too-large.txt")
        try Data(count: 10 * 1024 * 1024 + 1).write(to: oversized)
        let uploadsBefore = await freshAPI.saved
        let uploaded = await fresh.uploadAttachment(taskID: "task", fileURL: oversized, title: "")
        let uploadsAfter = await freshAPI.saved
        check(!uploaded && uploadsAfter == uploadsBefore,
              "oversized file is refused before the transport reads or uploads its content")
        print("\(count) team store checks passed.")
    }
}
