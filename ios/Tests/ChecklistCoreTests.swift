import Foundation

private struct TestFailure: Error, CustomStringConvertible {
    let description: String
}

private func expect(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
    guard try condition() else { throw TestFailure(description: message) }
}

private func expectThrow(_ message: String, _ body: () throws -> Void) throws {
    do {
        try body()
    } catch {
        return
    }
    throw TestFailure(description: message)
}

@main
struct ChecklistCoreTests {
    static func main() throws {
        guard CommandLine.arguments.count == 2 else {
            throw TestFailure(description: "Pass the bundled checklist.json path.")
        }
        let fileManager = FileManager.default
        let temporaryDirectory = fileManager.temporaryDirectory
            .appendingPathComponent("DGTLFACEChecklistTests-\(UUID().uuidString)", isDirectory: true)
        try fileManager.createDirectory(at: temporaryDirectory, withIntermediateDirectories: true)
        defer { try? fileManager.removeItem(at: temporaryDirectory) }

        let bundleURL = URL(fileURLWithPath: CommandLine.arguments[1])
        let bundleData = try Data(contentsOf: bundleURL)
        let catalog = try ChecklistCatalog.decode(bundleData)
        var passed = 0
        func test(_ title: String, _ body: () throws -> Void) throws {
            try body()
            passed += 1
            print("PASS \(title)")
        }
        func progressURL(_ name: String) -> URL {
            temporaryDirectory.appendingPathComponent(name).appendingPathComponent("progress.json")
        }
        func mutatedCatalog(_ mutate: (inout [String: Any]) -> Void) throws -> Data {
            var object = try JSONSerialization.jsonObject(with: bundleData) as! [String: Any]
            mutate(&object)
            return try JSONSerialization.data(withJSONObject: object)
        }
        func editFirstItem(_ object: inout [String: Any], _ edit: (inout [String: Any]) -> Void) {
            var groups = object["groups"] as! [[String: Any]]
            var items = groups[0]["items"] as! [[String: Any]]
            edit(&items[0])
            groups[0]["items"] = items
            object["groups"] = groups
        }

        try test("Bundled source contains all 93 steps in 12 nonempty groups") {
            try expect(catalog.items.count == 93, "Expected 93 steps")
            try expect(catalog.groups.count == 12, "Expected 12 groups")
            try expect(Set(catalog.items.map(\.id)).count == 93, "Every step needs its own stable ID")
            try expect(catalog.groups.allSatisfy { !$0.items.isEmpty }, "No empty groups")
        }

        try test("Indexed search retains codes, details, groups and Turkish matching") {
            let item = ChecklistItem(id: "search-one", code: "PRJ-001", title: "İŞ TAKİBİ",
                                     criterion: "Ölçüm onaylandı", input: "Şifre",
                                     department: "İçerik Ekibi", priority: 1)
            let other = ChecklistItem(id: "search-two", code: "PRJ-001", title: "Telefon",
                                      criterion: "", input: "", department: "", priority: 5)
            let searchCatalog = ChecklistCatalog(schemaVersion: 1, title: "Arama", groups: [
                ChecklistGroup(id: "first", title: "Erişim & Güvenlik", items: [item]),
                ChecklistGroup(id: "second", title: "Çağrı", items: [other])
            ])
            let index = ChecklistSearchIndex(catalog: searchCatalog)
            for query in ["", "prj-001", "iş takibi", "İŞ TAKİBİ", "is takibi", "olcum", "sifre", "İÇERİK", "erisim", "  ŞİFRE\n"] {
                try expect(index.matches(item, query: ChecklistSearchQuery(query)), "Expected search match for \(query)")
            }
            try expect(!index.matches(item, query: ChecklistSearchQuery("olmayan kelime")), "Nonmatching query must stay empty")
            try expect(!index.matches(other, query: ChecklistSearchQuery("iş takibi")), "Duplicate display codes must not share search text")
            try expect(index.matches(other, query: ChecklistSearchQuery("CAGRI")), "Group title must be searchable")
            try expect(ChecklistSearchQuery(" \n ").isEmpty, "Whitespace-only search must show the unfiltered list")
        }

        func writeJSON(_ object: [String: Any], to url: URL) throws -> Data {
            try fileManager.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            let bytes = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
            try bytes.write(to: url)
            return bytes
        }
        func hotel(_ storage: ProgressStorage, _ id: String) throws -> ChecklistHotel {
            guard let value = storage.hotels.first(where: { $0.id == id }) else {
                throw TestFailure(description: "Hotel disappeared")
            }
            return value
        }
        func expectUnchanged(_ url: URL, _ bytes: Data) throws {
            let after = try Data(contentsOf: url)
            try expect(after == bytes, "Original persisted bytes must remain intact")
        }
        let first = catalog.items[0].id
        let second = catalog.items[1].id
        let initialNames = ["Miramare Beach", "Miramare Quenn", "Port Nature Luxury Resort", "SY Hotels", "Mi Hotel", "Teona Hotel"]

        try test("A new installation remains empty until a hotel is added") {
            let url = progressURL("empty")
            let storage = try ProgressStorage(fileURL: url, catalog: catalog)
            try expect(storage.hotels.isEmpty, "No placeholder hotel on a fresh installation")
            try expect(!fileManager.fileExists(atPath: url.path), "Reading missing progress must not create a file")
        }

        try test("Initial hotels are seeded exactly once with the requested spelling") {
            let url = progressURL("seeded")
            let storage = try ProgressStorage(fileURL: url, catalog: catalog, initialHotelNames: initialNames)
            try expect(storage.hotels.map(\.name) == initialNames, "Seed names and order must be preserved")
            try expect(storage.hotels.allSatisfy { $0.checkedIDs.isEmpty && $0.notes.isEmpty }, "New hotels start empty")
            try expect(Set(storage.hotels.map(\.id)).count == initialNames.count, "Each hotel needs its own ID")
            let id = storage.hotels[0].id
            try storage.renameHotel(id, name: "Miramare Beach Hotel")
            let bytes = try Data(contentsOf: url)
            let reopened = try ProgressStorage(fileURL: url, catalog: catalog,
                                               initialHotelNames: initialNames + ["New seed ignored"])
            try expect(reopened.hotels == storage.hotels, "Relaunch must not restore or add initial names")
            try expectUnchanged(url, bytes)
        }

        try test("Valid v2 wins even when legacy and later seed arguments are invalid") {
            let url = progressURL("v2-wins")
            let legacy = url.deletingLastPathComponent().appendingPathComponent("legacy.json")
            let storage = try ProgressStorage(fileURL: url, catalog: catalog, initialHotelNames: initialNames)
            let id = storage.hotels[0].id
            try storage.setChecked(first, isChecked: true, hotelID: id)
            try storage.setNote("Yeni sürüm notu", for: first, hotelID: id)
            let bytes = try Data(contentsOf: url)
            let corruptLegacy = Data("not json".utf8)
            try corruptLegacy.write(to: legacy)
            let reopened = try ProgressStorage(fileURL: url, legacyFileURL: legacy, catalog: catalog,
                                               initialHotelNames: ["", ""], legacyHotelName: "SY Hotels")
            try expect(reopened.hotels == storage.hotels, "Existing v2 must bypass all initialization and migration inputs")
            try expectUnchanged(url, bytes)
            try expectUnchanged(legacy, corruptLegacy)
        }

        try test("Duplicate display codes keep independent completion state") {
            let duplicates = Dictionary(grouping: catalog.items, by: \.code).values.first { $0.count > 1 }
            guard let pair = duplicates else { throw TestFailure(description: "Expected the source's duplicate display codes") }
            let storage = try ProgressStorage(fileURL: progressURL("duplicates"), catalog: catalog)
            let id = try storage.addHotel(name: "Miramare Beach")
            try storage.setChecked(pair[0].id, isChecked: true, hotelID: id)
            let value = try hotel(storage, id)
            try expect(value.checkedIDs.contains(pair[0].id), "First duplicate must be checked")
            try expect(!value.checkedIDs.contains(pair[1].id), "Second duplicate must remain unchecked")
        }

        try test("Checks, exact notes and hotel identities survive fresh storage instances") {
            let url = progressURL("persistence")
            let storage = try ProgressStorage(fileURL: url, catalog: catalog)
            let id = try storage.addHotel(name: "Miramare Beach")
            let note = "  Yetkiliyle görüşüldü.\nYarın tekrar aranacak.  "
            try storage.setChecked(first, isChecked: true, hotelID: id)
            try storage.setChecked(second, isChecked: true, hotelID: id)
            try storage.setNote(note, for: first, hotelID: id)
            let reopened = try ProgressStorage(fileURL: url, catalog: catalog)
            let value = try hotel(reopened, id)
            try expect(value.checkedIDs == [first, second] && value.notes[first] == note, "Checks and exact multiline notes persist")
            try reopened.setChecked(first, isChecked: false, hotelID: id)
            let reopenedAgain = try ProgressStorage(fileURL: url, catalog: catalog)
            let final = try hotel(reopenedAgain, id)
            try expect(final.checkedIDs == [second], "Unchecking survives relaunch")
            try expect(final.notes[first] == note, "Unchecking must keep the note")
            try reopenedAgain.setNote(" \n\t", for: first, hotelID: id)
            let cleared = try ProgressStorage(fileURL: url, catalog: catalog)
            try expect(try hotel(cleared, id).notes.isEmpty, "Whitespace-only note clears its saved entry")
        }

        try test("Hotel checks and notes stay independent and reset preserves notes") {
            let url = progressURL("independence")
            let storage = try ProgressStorage(fileURL: url, catalog: catalog)
            let a = try storage.addHotel(name: "Miramare Beach")
            let b = try storage.addHotel(name: "SY Hotels")
            try storage.setChecked(first, isChecked: true, hotelID: a)
            try storage.setNote("Beach açıklaması", for: first, hotelID: a)
            try expect(try hotel(storage, b).checkedIDs.isEmpty, "Another hotel stays unchecked")
            try expect(try hotel(storage, b).notes.isEmpty, "Another hotel receives no copied notes")
            try storage.setChecked(second, isChecked: true, hotelID: b)
            try storage.setNote("SY açıklaması", for: first, hotelID: b)
            let bBefore = try hotel(storage, b)
            try storage.reset(hotelID: a)
            let reopened = try ProgressStorage(fileURL: url, catalog: catalog)
            let aAfter = try hotel(reopened, a)
            try expect(aAfter.checkedIDs.isEmpty && aAfter.notes[first] == "Beach açıklaması", "Reset clears only this hotel's checks")
            try expect(try hotel(reopened, b) == bBefore, "Reset must not affect another hotel")
            let newID = try reopened.addHotel(name: "Mi Hotel")
            try expect(try hotel(reopened, newID).checkedIDs.isEmpty, "Later hotels must not inherit completion")
        }

        try test("Hotel names trim whitespace and reject blank or Turkish case-equivalent duplicates") {
            let url = progressURL("names")
            let storage = try ProgressStorage(fileURL: url, catalog: catalog)
            let a = try storage.addHotel(name: "  İŞ OTELİ  ")
            let b = try storage.addHotel(name: "SY Hotels")
            try expect(try hotel(storage, a).name == "İŞ OTELİ", "Trim outer whitespace")
            let bytes = try Data(contentsOf: url)
            for name in ["", "  \n", "iş oteli", " İŞ OTELİ "] {
                try expectThrow("Blank and duplicate additions must fail") { _ = try storage.addHotel(name: name) }
            }
            try expectThrow("Rename must reject another hotel's name") { try storage.renameHotel(b, name: "iş oteli") }
            try expectThrow("Blank rename must fail") { try storage.renameHotel(a, name: " ") }
            try expectUnchanged(url, bytes)
            try storage.setChecked(first, isChecked: true, hotelID: a)
            try storage.setNote("Not", for: first, hotelID: a)
            try storage.renameHotel(a, name: "İş Oteli Yeni")
            let value = try hotel(storage, a)
            try expect(value.name == "İş Oteli Yeni" && value.checkedIDs == [first] && value.notes[first] == "Not", "Rename preserves ID, checks and notes")
        }

        try test("Unchanged checks, notes, names and resets do not write to disk") {
            let url = progressURL("no-op")
            let storage = try ProgressStorage(fileURL: url, catalog: catalog)
            let id = try storage.addHotel(name: "Miramare Beach")
            let oldDate = Date(timeIntervalSince1970: 1_000_000)
            try fileManager.setAttributes([.modificationDate: oldDate], ofItemAtPath: url.path)
            try storage.reset(hotelID: id)
            try storage.setChecked(first, isChecked: false, hotelID: id)
            try storage.setNote(" \n", for: first, hotelID: id)
            try storage.renameHotel(id, name: " Miramare Beach ")
            var attributes = try fileManager.attributesOfItem(atPath: url.path)
            try expect(attributes[.modificationDate] as? Date == oldDate, "Empty no-op mutations must not rewrite")
            try storage.setChecked(first, isChecked: true, hotelID: id)
            try storage.setNote("Kaydedildi", for: first, hotelID: id)
            try fileManager.setAttributes([.modificationDate: oldDate], ofItemAtPath: url.path)
            try storage.setChecked(first, isChecked: true, hotelID: id)
            try storage.setNote("Kaydedildi", for: first, hotelID: id)
            attributes = try fileManager.attributesOfItem(atPath: url.path)
            try expect(attributes[.modificationDate] as? Date == oldDate, "Repeated checks and notes must not rewrite")
        }

        try test("Unknown hotel and task IDs reject every mutation without changing memory or disk") {
            let url = progressURL("unknown")
            let storage = try ProgressStorage(fileURL: url, catalog: catalog)
            let id = try storage.addHotel(name: "Miramare Beach")
            try storage.setChecked(first, isChecked: true, hotelID: id)
            let before = storage.hotels
            let bytes = try Data(contentsOf: url)
            let actions: [() throws -> Void] = [
                { try storage.setChecked("not-a-task", isChecked: true, hotelID: id) },
                { try storage.setNote("Not", for: "not-a-task", hotelID: id) },
                { try storage.setChecked(first, isChecked: true, hotelID: "missing") },
                { try storage.setNote("Not", for: first, hotelID: "missing") },
                { try storage.reset(hotelID: "missing") },
                { try storage.renameHotel("missing", name: "New name") }
            ]
            for action in actions { try expectThrow("Unknown ID must fail", action) }
            try expect(storage.hotels == before, "Rejected mutations preserve all memory")
            try expectUnchanged(url, bytes)
        }

        try test("Obsolete stored task IDs are ignored without rewriting the original v2 file") {
            let url = progressURL("obsolete")
            let bytes = try writeJSON(["schemaVersion": 2, "hotels": [[
                "id": "hotel-1", "name": "Miramare Beach", "checkedIDs": [first, "removed-task"],
                "notes": [first: "Kept", "removed-task": "Old note"]
            ]]], to: url)
            let storage = try ProgressStorage(fileURL: url, catalog: catalog)
            try expect(storage.hotels[0].checkedIDs == [first], "Only current task IDs count")
            try expect(storage.hotels[0].notes == [first: "Kept"], "Only current notes appear")
            try expectUnchanged(url, bytes)
        }

        try test("Failed atomic mutations preserve every in-memory hotel and saved bytes") {
            let url = progressURL("failed-write")
            let storage = try ProgressStorage(fileURL: url, catalog: catalog)
            let id = try storage.addHotel(name: "Miramare Beach")
            try storage.setChecked(first, isChecked: true, hotelID: id)
            try storage.setNote("Original", for: first, hotelID: id)
            let before = storage.hotels
            let bytes = try Data(contentsOf: url)
            let preservedURL = url.deletingLastPathComponent().appendingPathComponent("original.json")
            try fileManager.moveItem(at: url, to: preservedURL)
            try fileManager.createDirectory(at: url, withIntermediateDirectories: false)
            try Data("keep".utf8).write(to: url.appendingPathComponent("sentinel"))
            let actions: [() throws -> Void] = [
                { try storage.setChecked(second, isChecked: true, hotelID: id) },
                { try storage.setNote("Changed", for: first, hotelID: id) },
                { try storage.reset(hotelID: id) },
                { try storage.renameHotel(id, name: "New name") },
                { _ = try storage.addHotel(name: "SY Hotels") }
            ]
            for action in actions {
                try expectThrow("Blocked atomic replacement must fail", action)
                try expect(storage.hotels == before, "Failed save must preserve memory")
            }
            try expectUnchanged(preservedURL, bytes)
            let sentinel = try String(contentsOf: url.appendingPathComponent("sentinel"), encoding: .utf8)
            try expect(sentinel == "keep", "Failed writes preserve destination contents")
        }

        try test("Legacy checks migrate once to a named placeholder with original bytes preserved") {
            let url = progressURL("migration")
            let legacy = url.deletingLastPathComponent().appendingPathComponent("legacy.json")
            let bytes = try writeJSON(["schemaVersion": 1, "checkedIDs": [first, "removed-task"]], to: legacy)
            let storage = try ProgressStorage(fileURL: url, legacyFileURL: legacy, catalog: catalog)
            try expect(storage.hotels.count == 1 && storage.hotels[0].name == "Mevcut işlerim", "Unassigned old work needs its own hotel")
            let id = storage.hotels[0].id
            try expect(storage.hotels[0].checkedIDs == [first], "Known old checks preserved")
            try expectUnchanged(legacy, bytes)
            try storage.renameHotel(id, name: "Miramare Beach")
            try storage.setChecked(first, isChecked: false, hotelID: id)
            let addedID = try storage.addHotel(name: "SY Hotels")
            let reopened = try ProgressStorage(fileURL: url, legacyFileURL: legacy, catalog: catalog)
            try expect(reopened.hotels == storage.hotels, "Relaunch must never remigrate stale checks")
            try expect(try hotel(reopened, addedID).checkedIDs.isEmpty, "New hotels must not copy legacy checks")
            try expectUnchanged(legacy, bytes)
        }

        try test("Legacy migration assigns old checks only to the explicitly chosen seeded hotel") {
            let url = progressURL("migration-assigned")
            let legacy = url.deletingLastPathComponent().appendingPathComponent("legacy.json")
            let bytes = try writeJSON(["schemaVersion": 1, "checkedIDs": [first]], to: legacy)
            let storage = try ProgressStorage(fileURL: url, legacyFileURL: legacy, catalog: catalog,
                                              initialHotelNames: initialNames, legacyHotelName: "Miramare Beach")
            try expect(storage.hotels.map(\.name) == initialNames, "Assigned migration adds no extra placeholder")
            try expect(storage.hotels[0].checkedIDs == [first], "Selected hotel receives legacy progress")
            try expect(storage.hotels.dropFirst().allSatisfy { $0.checkedIDs.isEmpty }, "Other hotels remain empty")
            try expectUnchanged(legacy, bytes)
            let reopened = try ProgressStorage(fileURL: url, legacyFileURL: legacy, catalog: catalog,
                                               initialHotelNames: initialNames, legacyHotelName: "SY Hotels")
            try expect(reopened.hotels == storage.hotels, "Later migration parameters cannot reassign existing progress")
        }

        try test("Empty legacy files need no placeholder while unmatched checks remain recoverable") {
            for (index, checks) in [[], ["removed-task"], [first]].enumerated() {
                let url = progressURL("migration-empty-\(index)")
                let legacy = url.deletingLastPathComponent().appendingPathComponent("legacy.json")
                let bytes = try writeJSON(["schemaVersion": 1, "checkedIDs": checks], to: legacy)
                let storage = try ProgressStorage(fileURL: url, legacyFileURL: legacy, catalog: catalog,
                                                  initialHotelNames: initialNames, legacyHotelName: "Unmatched name")
                try expect(storage.hotels.count == initialNames.count + (checks == [first] ? 1 : 0), "Only known unassigned checks need a placeholder")
                if checks == [first] {
                    try expect(storage.hotels.last?.name == "Mevcut işlerim" && storage.hotels.last?.checkedIDs == [first], "Unmatched old progress is preserved separately")
                }
                try expectUnchanged(legacy, bytes)
            }
            let url = progressURL("migration-empty-no-seeds")
            let legacy = url.deletingLastPathComponent().appendingPathComponent("legacy.json")
            _ = try writeJSON(["schemaVersion": 1, "checkedIDs": []], to: legacy)
            let storage = try ProgressStorage(fileURL: url, legacyFileURL: legacy, catalog: catalog)
            try expect(storage.hotels.isEmpty && fileManager.fileExists(atPath: url.path), "Even empty migration commits v2 exactly once")
        }

        try test("Migration write failure preserves legacy data and succeeds safely on retry") {
            let directory = temporaryDirectory.appendingPathComponent("migration-blocked", isDirectory: true)
            try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
            let url = directory.appendingPathComponent("progress.json")
            let legacy = directory.appendingPathComponent("legacy.json")
            let bytes = try writeJSON(["schemaVersion": 1, "checkedIDs": [first]], to: legacy)
            try fileManager.setAttributes([.posixPermissions: 0o500], ofItemAtPath: directory.path)
            defer { try? fileManager.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path) }
            try expectThrow("Migration must fail when destination cannot be written") {
                _ = try ProgressStorage(fileURL: url, legacyFileURL: legacy, catalog: catalog,
                                        initialHotelNames: initialNames, legacyHotelName: "Miramare Beach")
            }
            try expect(!fileManager.fileExists(atPath: url.path), "Failed migration must not publish partial v2")
            try expectUnchanged(legacy, bytes)
            try fileManager.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
            let retried = try ProgressStorage(fileURL: url, legacyFileURL: legacy, catalog: catalog,
                                              initialHotelNames: initialNames, legacyHotelName: "Miramare Beach")
            try expect(retried.hotels[0].checkedIDs == [first], "Retry must recover original progress")
            try expectUnchanged(legacy, bytes)
        }

        try test("Corrupt or unsupported legacy files never create v2 or overwrite originals") {
            let examples = [Data("not json".utf8),
                            Data("{\"schemaVersion\":3,\"checkedIDs\":[]}".utf8),
                            Data("{\"schemaVersion\":1,\"checkedIDs\":true}".utf8),
                            Data("{\"schemaVersion\":1,\"checkedIDs\":[\"\"]}".utf8)]
            for (index, bytes) in examples.enumerated() {
                let url = progressURL("bad-legacy-\(index)")
                let legacy = url.deletingLastPathComponent().appendingPathComponent("legacy.json")
                try fileManager.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
                try bytes.write(to: legacy)
                try expectThrow("Invalid legacy must surface an error") {
                    _ = try ProgressStorage(fileURL: url, legacyFileURL: legacy, catalog: catalog,
                                            initialHotelNames: initialNames)
                }
                try expect(!fileManager.fileExists(atPath: url.path), "Failed migration cannot commit seeds")
                try expectUnchanged(legacy, bytes)
            }
        }

        try test("V2 rejects missing fields, duplicates, invalid IDs and names without replacing bytes") {
            let validHotel: [String: Any] = ["id": "hotel-1", "name": "İŞ OTELİ", "checkedIDs": [first], "notes": [first: "Not"]]
            var objects: [[String: Any]] = [
                ["schemaVersion": 3, "hotels": []],
                ["schemaVersion": 2],
                ["schemaVersion": 2, "hotels": true],
                ["schemaVersion": 2, "hotels": [validHotel, validHotel]]
            ]
            for key in ["id", "name", "checkedIDs", "notes"] {
                var invalid = validHotel
                invalid.removeValue(forKey: key)
                objects.append(["schemaVersion": 2, "hotels": [invalid]])
            }
            for (key, value) in [("id", "" as Any), ("id", "bad id"), ("name", " \n"),
                                 ("checkedIDs", [first, first]), ("checkedIDs", [""]),
                                 ("notes", ["": "Invalid"]), ("notes", [first: true])] {
                var invalid = validHotel
                invalid[key] = value
                objects.append(["schemaVersion": 2, "hotels": [invalid]])
            }
            var duplicateName = validHotel
            duplicateName["id"] = "hotel-2"
            duplicateName["name"] = "iş oteli"
            objects.append(["schemaVersion": 2, "hotels": [validHotel, duplicateName]])
            var bytesExamples = try objects.map { try JSONSerialization.data(withJSONObject: $0) }
            bytesExamples.append(Data("not json".utf8))
            for (index, bytes) in bytesExamples.enumerated() {
                let url = progressURL("invalid-v2-\(index)")
                let legacy = url.deletingLastPathComponent().appendingPathComponent("legacy.json")
                _ = try writeJSON(["schemaVersion": 1, "checkedIDs": [first]], to: legacy)
                try bytes.write(to: url)
                try expectThrow("Invalid v2 must not fall back to legacy") {
                    _ = try ProgressStorage(fileURL: url, legacyFileURL: legacy, catalog: catalog,
                                            initialHotelNames: initialNames)
                }
                try expectUnchanged(url, bytes)
            }
        }

        try test("Catalog rejects unsupported schemas, empty titles, groups and tasks") {
            let changes: [(inout [String: Any]) -> Void] = [
                { $0["schemaVersion"] = 2 },
                { $0["title"] = "  " },
                { $0["groups"] = [] },
                { object in
                    var groups = object["groups"] as! [[String: Any]]
                    groups[0]["title"] = ""
                    object["groups"] = groups
                },
                { object in
                    var groups = object["groups"] as! [[String: Any]]
                    groups[0]["items"] = []
                    object["groups"] = groups
                },
                { object in editFirstItem(&object) { $0["title"] = "" } }
            ]
            for change in changes {
                let invalid = try mutatedCatalog(change)
                try expectThrow("Invalid catalog should throw") { _ = try ChecklistCatalog.decode(invalid) }
            }
        }

        try test("Catalog rejects duplicate group IDs and step IDs across groups") {
            let duplicateGroup = try mutatedCatalog { object in
                var groups = object["groups"] as! [[String: Any]]
                groups[1]["id"] = groups[0]["id"]
                object["groups"] = groups
            }
            try expectThrow("Duplicate group ID should throw") { _ = try ChecklistCatalog.decode(duplicateGroup) }
            let duplicateItem = try mutatedCatalog { object in
                var groups = object["groups"] as! [[String: Any]]
                let firstItems = groups[0]["items"] as! [[String: Any]]
                var secondItems = groups[1]["items"] as! [[String: Any]]
                secondItems[0]["id"] = firstItems[0]["id"]
                groups[1]["items"] = secondItems
                object["groups"] = groups
            }
            try expectThrow("Duplicate step ID should throw") { _ = try ChecklistCatalog.decode(duplicateItem) }
        }

        try test("Catalog priority accepts only the inclusive 1–10 range") {
            for value in [0, 11] {
                let invalid = try mutatedCatalog { object in editFirstItem(&object) { $0["priority"] = value } }
                try expectThrow("Out-of-range priority should throw") { _ = try ChecklistCatalog.decode(invalid) }
            }
            for value in [1, 10] {
                let valid = try mutatedCatalog { object in editFirstItem(&object) { $0["priority"] = value } }
                _ = try ChecklistCatalog.decode(valid)
            }
        }
        print("\(passed) core tests passed. Foundation/macOS only; no iOS SDK build was run.")
    }
}
