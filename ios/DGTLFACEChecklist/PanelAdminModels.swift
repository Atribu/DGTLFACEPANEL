import Foundation

struct PanelTaskDraft: Encodable, Sendable {
    var hotelId: String
    var title: String
    var description: String
    var department: String
    var assigneeId: String?
    var priority: Int
    var dueDate: String?
    var hotelInput: String
    var stage: String
    var checklist: [String]
}

struct PanelHotelDraft: Encodable, Sendable {
    var name: String
    var location: String
    var services: [String]
    var managerId: String
    var contactName: String
    var contactEmail: String
    var template: Bool
}

struct PanelUserDraft: Encodable, Sendable {
    var name: String
    var email: String
    var role: String
    var department: String
    var hotelIds: [String]
    var password: String?
    var active: Bool?
}

struct PanelUsersResponse: Decodable, Sendable { let users: [PanelUser] }
struct PanelEmptyBody: Encodable, Sendable { }
struct PanelOKResponse: Decodable, Sendable { let ok: Bool }
