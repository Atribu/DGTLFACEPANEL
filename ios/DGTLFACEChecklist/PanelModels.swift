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
    let services: [String]
    let managerId: String
    let contactName: String
    let contactEmail: String
    let color: String
    let createdAt: String

    init(id: String, name: String, location: String, stage: String, services: [String] = [],
         managerId: String = "", contactName: String = "", contactEmail: String = "",
         color: String = "", createdAt: String = "") {
        self.id = id; self.name = name; self.location = location; self.stage = stage
        self.services = services; self.managerId = managerId; self.contactName = contactName
        self.contactEmail = contactEmail; self.color = color; self.createdAt = createdAt
    }

    private enum CodingKeys: String, CodingKey {
        case id, name, location, stage, services, managerId, contactName, contactEmail, color, createdAt
    }
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        name = try values.decode(String.self, forKey: .name)
        location = try values.decode(String.self, forKey: .location)
        stage = try values.decode(String.self, forKey: .stage)
        services = try values.decodeIfPresent([String].self, forKey: .services) ?? []
        managerId = try values.decodeIfPresent(String.self, forKey: .managerId) ?? ""
        contactName = try values.decodeIfPresent(String.self, forKey: .contactName) ?? ""
        contactEmail = try values.decodeIfPresent(String.self, forKey: .contactEmail) ?? ""
        color = try values.decodeIfPresent(String.self, forKey: .color) ?? ""
        createdAt = try values.decodeIfPresent(String.self, forKey: .createdAt) ?? ""
    }
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

struct PanelTaskMutation: Encodable, Sendable {
    let action: String
    var itemId: String? = nil
    var done: Bool? = nil
    var status: String? = nil
    var waitingReason: String? = nil
    var reason: String? = nil
    var details: PanelTaskDraft? = nil

    static func checklist(itemID: String, done: Bool) -> Self {
        Self(action: "checklist", itemId: itemID, done: done)
    }
    static func status(value: String, waitingReason: String? = nil) -> Self {
        Self(action: "status", status: value, waitingReason: waitingReason)
    }
    static func update(_ draft: PanelTaskDraft) -> Self { Self(action: "update", details: draft) }

    private enum CodingKeys: String, CodingKey {
        case action, itemId, done, status, waitingReason, reason
        case title, description, department, assigneeId, priority, dueDate, hotelInput, stage
    }
    func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(action, forKey: .action)
        try values.encodeIfPresent(itemId, forKey: .itemId)
        try values.encodeIfPresent(done, forKey: .done)
        try values.encodeIfPresent(status, forKey: .status)
        try values.encodeIfPresent(waitingReason, forKey: .waitingReason)
        try values.encodeIfPresent(reason, forKey: .reason)
        if let draft = details {
            try values.encode(draft.title, forKey: .title)
            try values.encode(draft.description, forKey: .description)
            try values.encode(draft.department, forKey: .department)
            // Explicit null clears an existing value; omission would leave it unchanged.
            try values.encode(draft.assigneeId, forKey: .assigneeId)
            try values.encode(draft.priority, forKey: .priority)
            try values.encode(draft.dueDate, forKey: .dueDate)
            try values.encode(draft.hotelInput, forKey: .hotelInput)
            try values.encode(draft.stage, forKey: .stage)
        }
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
    func request(path: String, method: String, body: Data?, contentType: String?) async throws -> Data
    func uploadAttachment(taskID: String, fileName: String, data: Data, title: String) async throws -> Data
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
        guard [1, 2].contains(entry.schemaVersion), entry.snapshot.user.id == userID else { return nil }
        if entry.schemaVersion == 1 {
            // Version 1 omitted hotel details although its ETag represented the
            // complete server payload. Keep its offline list but force a full
            // fetch so an unchanged server cannot leave those details missing.
            return Entry(schemaVersion: 1, snapshot: entry.snapshot, etag: nil, savedAt: entry.savedAt)
        }
        return entry
    }

    func save(snapshot: PanelSnapshot, etag: String?, date: Date) throws {
        let directory = fileURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var mutableDirectory = directory
        try mutableDirectory.setResourceValues(values)
        let data = try JSONEncoder().encode(Entry(schemaVersion: 2, snapshot: snapshot, etag: etag, savedAt: date))
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
