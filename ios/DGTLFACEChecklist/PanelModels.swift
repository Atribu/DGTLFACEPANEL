import Foundation

struct PanelUser: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let name: String
    let email: String
    let role: String
    let department: String
    let hotelIds: [String]
    let active: Bool?
}

struct PanelHotel: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let name: String
    let location: String
    let stage: String
}

struct PanelCriterion: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let text: String
    var done: Bool
}

struct PanelTask: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let hotelId: String
    let code: String
    let title: String
    let description: String
    let stage: String
    let department: String
    let assigneeId: String?
    let priority: Int
    let status: String
    let dueDate: String?
    let hotelInput: String
    let waitingReason: String
    let checklist: [PanelCriterion]
    let createdAt: String
    let updatedAt: String
}

struct PanelComment: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let taskId: String
    let userId: String
    let userName: String
    let body: String
    let createdAt: String
}

struct PanelSnapshot: Codable, Equatable, Sendable {
    let user: PanelUser
    let users: [PanelUser]
    let hotels: [PanelHotel]
    var tasks: [PanelTask]
    var comments: [PanelComment]
    var taskVersions: [String: String]
    let demo: Bool
    let checklistImportWarning: String?
}

struct PanelTaskMutation: Codable, Sendable {
    let action: String
    var itemId: String? = nil
    var done: Bool? = nil
    var status: String? = nil
    var waitingReason: String? = nil
    var reason: String? = nil

    static func checklist(itemID: String, done: Bool) -> Self {
        Self(action: "checklist", itemId: itemID, done: done)
    }
    static func status(value: String, waitingReason: String? = nil) -> Self {
        Self(action: "status", status: value, waitingReason: waitingReason)
    }
    static let submit = Self(action: "submit")
    static let approve = Self(action: "approve")
    static func reopen(reason: String) -> Self { Self(action: "reopen", reason: reason) }
    static func returnForChanges(reason: String) -> Self { Self(action: "return", reason: reason) }
}

struct PanelTaskResponse: Codable, Sendable {
    let task: PanelTask
    let version: String
}

struct PanelFetchResult: Sendable {
    let snapshot: PanelSnapshot?
    let etag: String?
}

struct PanelSession: Sendable {
    let userID: String
    let expiresAt: Date
}

enum PanelAPIError: LocalizedError, Sendable {
    case http(Int, String)
    case invalidResponse
    case sessionExpired
    case credentialStorage

    var errorDescription: String? {
        switch self {
        case .http(_, let message): return message
        case .invalidResponse: return "Sunucudan geçerli bir yanıt alınamadı. Lütfen tekrar deneyin."
        case .sessionExpired: return "Oturumun sona erdi. Panel hesabınla yeniden giriş yap."
        case .credentialStorage: return "Oturum güvenli olarak saklanamadı. Telefonun kilidini açıp tekrar dene."
        }
    }
}

protocol PanelServicing: Sendable {
    func restoreSession() async throws -> PanelSession?
    func login(email: String, password: String) async throws -> PanelUser
    func logout() async throws
    func fetch(etag: String?) async throws -> PanelFetchResult
    func updateTask(id: String, version: String, payload: PanelTaskMutation) async throws -> PanelTaskResponse
    func addComment(taskID: String, body: String, requestID: String) async throws -> PanelComment
}

/// A separate, account-bound cache. Legacy personal progress is never opened here.
struct PanelCache {
    struct Entry: Codable {
        let schemaVersion: Int
        let snapshot: PanelSnapshot
        let etag: String?
        let savedAt: Date
    }
    let fileURL: URL

    static func standard() -> Self {
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("DGTLFACETeam", isDirectory: true)
        return Self(fileURL: directory.appendingPathComponent("team-cache-v1.json"))
    }

    func load(userID: String) throws -> Entry? {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return nil }
        let entry = try JSONDecoder().decode(Entry.self, from: Data(contentsOf: fileURL))
        guard entry.schemaVersion == 1, entry.snapshot.user.id == userID else { return nil }
        return entry
    }

    func save(snapshot: PanelSnapshot, etag: String?, date: Date) throws {
        let directory = fileURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var mutableDirectory = directory
        try mutableDirectory.setResourceValues(values)
        let data = try JSONEncoder().encode(Entry(schemaVersion: 1, snapshot: snapshot, etag: etag, savedAt: date))
        #if os(iOS)
        try data.write(to: fileURL, options: [.atomic, .completeFileProtection])
        #else
        try data.write(to: fileURL, options: .atomic)
        #endif
    }

    func clear() throws {
        if FileManager.default.fileExists(atPath: fileURL.path) {
            try FileManager.default.removeItem(at: fileURL)
        }
    }
}
