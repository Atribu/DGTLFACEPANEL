import Combine
import Foundation

@MainActor
final class ChecklistStore: ObservableObject {
    let catalog: ChecklistCatalog
    let totalCount: Int
    @Published private(set) var hotels: [ChecklistHotel]
    @Published var errorMessage: String?
    private let storage: ProgressStorage
    private let searchIndex: ChecklistSearchIndex

    init(catalog: ChecklistCatalog, storage: ProgressStorage) {
        self.catalog = catalog
        totalCount = catalog.groups.reduce(0) { $0 + $1.items.count }
        searchIndex = ChecklistSearchIndex(catalog: catalog)
        self.storage = storage
        hotels = storage.hotels
    }

    func hotel(id: String) -> ChecklistHotel? {
        hotels.first { $0.id == id }
    }

    func checkedIDs(hotelID: String) -> Set<String> {
        hotel(id: hotelID)?.checkedIDs ?? []
    }

    func completedCount(hotelID: String) -> Int {
        checkedIDs(hotelID: hotelID).count
    }

    func isChecked(_ id: String, hotelID: String) -> Bool {
        checkedIDs(hotelID: hotelID).contains(id)
    }

    func completedCount(in group: ChecklistGroup, hotelID: String) -> Int {
        let checked = checkedIDs(hotelID: hotelID)
        return group.items.reduce(0) { $0 + (checked.contains($1.id) ? 1 : 0) }
    }

    func note(for itemID: String, hotelID: String) -> String {
        hotel(id: hotelID)?.notes[itemID] ?? ""
    }

    func matchesSearch(_ item: ChecklistItem, query: ChecklistSearchQuery) -> Bool {
        searchIndex.matches(item, query: query)
    }

    func toggle(_ item: ChecklistItem, hotelID: String) {
        do {
            try storage.setChecked(item.id, isChecked: !isChecked(item.id, hotelID: hotelID), hotelID: hotelID)
            publishChanges()
        } catch {
            errorMessage = "İşaret kaydedilemedi. Önceki durum korundu. \(error.localizedDescription)"
        }
    }

    func reset(hotelID: String) {
        do {
            try storage.reset(hotelID: hotelID)
            publishChanges()
        } catch {
            errorMessage = "İşaretler sıfırlanamadı. Önceki durum korundu. \(error.localizedDescription)"
        }
    }

    func addHotel(name: String) throws {
        _ = try storage.addHotel(name: name)
        publishChanges()
    }

    func renameHotel(_ hotelID: String, name: String) throws {
        try storage.renameHotel(hotelID, name: name)
        publishChanges()
    }

    func saveNote(_ note: String, for itemID: String, hotelID: String) throws {
        try storage.setNote(note, for: itemID, hotelID: hotelID)
        publishChanges()
    }

    private func publishChanges() {
        // Avoid invalidating every visible row for an unchanged save.
        if hotels != storage.hotels { hotels = storage.hotels }
    }
}

@MainActor
final class ChecklistContainer: ObservableObject {
    @Published private(set) var store: ChecklistStore?
    @Published private(set) var loadError: String?

    init() { load() }

    func load() {
        do {
            guard let resource = Bundle.main.url(forResource: "checklist", withExtension: "json") else {
                throw CocoaError(.fileNoSuchFile)
            }
            let catalog = try ChecklistCatalog.decode(Data(contentsOf: resource))
            let directory = try FileManager.default.url(
                for: .applicationSupportDirectory, in: .userDomainMask,
                appropriateFor: nil, create: true
            ).appendingPathComponent("DGTLFACEChecklist", isDirectory: true)
            let storage = try ProgressStorage(
                fileURL: directory.appendingPathComponent("progress-v2.json"),
                legacyFileURL: directory.appendingPathComponent("progress-v1.json"),
                catalog: catalog,
                initialHotelNames: [
                    "Miramare Beach", "Miramare Quenn", "Port Nature Luxury Resort",
                    "SY Hotels", "Mi Hotel", "Teona Hotel"
                ]
            )
            store = ChecklistStore(catalog: catalog, storage: storage)
            loadError = nil
        } catch {
            store = nil
            loadError = error.localizedDescription
        }
    }
}
