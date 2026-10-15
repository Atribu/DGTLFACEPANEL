import Foundation

/// Date-only task deadlines stay on their calendar day, independent of timestamp parsing.
struct PanelTaskSelection {
    var status = "all"
    var query = ""
    var hotelID = ""
    var assignee = ""
    var department = ""
    var stage = ""
    var priority = 0
    var sort = "priority"

    static var calendar: Calendar {
        var value = Calendar(identifier: .gregorian)
        value.timeZone = TimeZone(identifier: "Europe/Istanbul")!
        value.firstWeekday = 2
        return value
    }

    static func dayKey(_ date: Date) -> String {
        let fields = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", fields.year!, fields.month!, fields.day!)
    }

    static func overdue(_ task: PanelTask, today: String = dayKey(Date())) -> Bool {
        task.status != "completed" && task.dueDate.map { String($0.prefix(10)) < today } == true
    }

    static func contains(_ text: String, query: String) -> Bool {
        let locale = Locale(identifier: "tr_TR")
        // Fold case before accents: applying both at once loses Turkish İ/i pairing.
        func normalized(_ value: String) -> String {
            value.folding(options: .caseInsensitive, locale: locale)
                .folding(options: .diacriticInsensitive, locale: locale)
        }
        return normalized(text).contains(normalized(query))
    }

    func apply(_ tasks: [PanelTask], userID: String, today: String = dayKey(Date())) -> [PanelTask] {
        let term = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return tasks.filter { task in
            if !hotelID.isEmpty && task.hotelId != hotelID { return false }
            if !department.isEmpty && task.department != department { return false }
            if !stage.isEmpty && task.stage != stage { return false }
            if priority != 0 && task.priority != priority { return false }
            if assignee == "mine" && task.assigneeId != userID { return false }
            if assignee == "unassigned" && task.assigneeId != nil { return false }
            if assignee.hasPrefix("user:") && task.assigneeId != String(assignee.dropFirst(5)) { return false }
            if status == "open" && task.status == "completed" { return false }
            if status == "overdue" && !Self.overdue(task, today: today) { return false }
            if !["all", "open", "overdue"].contains(status) && task.status != status { return false }
            if !term.isEmpty {
                let text = [task.title, task.code, task.description, task.department, task.stage].joined(separator: " ")
                if !Self.contains(text, query: term) { return false }
            }
            return true
        }.sorted {
            if sort == "due", $0.dueDate != $1.dueDate { return ($0.dueDate ?? "9999-12-31") < ($1.dueDate ?? "9999-12-31") }
            if sort == "updated", $0.updatedAt != $1.updatedAt { return $0.updatedAt > $1.updatedAt }
            if $0.priority != $1.priority { return $0.priority < $1.priority }
            if $0.title != $1.title { return $0.title.localizedStandardCompare($1.title) == .orderedAscending }
            return $0.id < $1.id
        }
    }
}
