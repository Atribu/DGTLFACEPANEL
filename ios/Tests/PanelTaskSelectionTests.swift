import Foundation

@main
struct PanelTaskSelectionTests {
    static func main() {
        func task(_ id: String, hotel: String = "h1", assignee: String? = nil, due: String? = nil,
                  status: String = "planned", priority: Int = 1, department: String = "Web", stage: String = "Kurulum") -> PanelTask {
            PanelTask(id: id, hotelId: hotel, code: "DAT-008", title: "İçerik \(id)", description: "Açıklama", stage: stage,
                      department: department, assigneeId: assignee, priority: priority, status: status, dueDate: due,
                      hotelInput: "", waitingReason: "", checklist: [], createdAt: "2026-10-15T10:00:00Z", updatedAt: "2026-10-15T10:00:00Z")
        }
        let tasks = [task("a", assignee: "u1", due: "2026-10-14", priority: 5),
                     task("b", hotel: "h2", assignee: "u2", due: "2026-10-15", priority: 2),
                     task("c", due: "2026-10-12", status: "completed", priority: 1),
                     task("d", department: "SEO", stage: "Operasyon")]
        var checks = 0
        func check(_ value: Bool, _ label: String) {
            precondition(value, label); checks += 1; print("PASS: \(label)")
        }
        func ids(_ selection: PanelTaskSelection) -> [String] { selection.apply(tasks, userID: "u1", today: "2026-10-15").map(\.id) }
        check(ids(PanelTaskSelection(status: "overdue")) == ["a"], "overdue excludes today and completed tasks")
        check(ids(PanelTaskSelection(status: "open")) == ["d", "b", "a"], "open tasks ordered by 1-highest priority")
        var filter = PanelTaskSelection(); filter.assignee = "mine"
        check(ids(filter) == ["a"], "mine respects account ID")
        filter.assignee = "unassigned"
        check(Set(ids(filter)) == Set(["c", "d"]), "unassigned does not include another member")
        filter.assignee = "user:u2"
        check(ids(filter) == ["b"], "specific assignee filter")
        filter = PanelTaskSelection(); filter.hotelID = "h2"; filter.priority = 2
        check(ids(filter) == ["b"], "hotel and priority filters compose")
        filter = PanelTaskSelection(); filter.department = "SEO"; filter.stage = "Operasyon"
        check(ids(filter) == ["d"], "department and group filters compose")
        filter = PanelTaskSelection(); filter.query = "içerik a"
        check(ids(filter) == ["a"], "Turkish case-insensitive title search")
        filter = PanelTaskSelection(); filter.query = "DAT-008"
        check(ids(filter).count == 4, "duplicate display codes never collapse tasks")
        filter = PanelTaskSelection(); filter.sort = "due"
        check(ids(filter) == ["c", "a", "b", "d"], "undated tasks sort last")
        let instant = ISO8601DateFormatter().date(from: "2026-10-14T21:15:00Z")!
        check(PanelTaskSelection.dayKey(instant) == "2026-10-15", "Istanbul day remains consistent at UTC boundary")
        check(!PanelTaskSelection.overdue(task("e", due: "2026-10-15T00:00:00Z"), today: "2026-10-15"), "date-only deadline is not shifted by timestamp")
        print("\(checks) selection checks passed")
    }
}
