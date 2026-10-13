import Foundation

struct ChecklistItem: Codable, Identifiable, Hashable {
    let id: String
    let code: String
    let title: String
    let criterion: String
    let input: String
    let department: String
    let priority: Int
}

struct ChecklistGroup: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let items: [ChecklistItem]
}

struct ChecklistCatalog: Codable {
    let schemaVersion: Int
    let title: String
    let groups: [ChecklistGroup]

    var items: [ChecklistItem] { groups.flatMap(\.items) }

    static func decode(_ data: Data) throws -> ChecklistCatalog {
        let catalog = try JSONDecoder().decode(ChecklistCatalog.self, from: data)
        try catalog.validate()
        return catalog
    }

    func validate() throws {
        guard schemaVersion == 1 else {
            throw ChecklistError.unsupportedCatalogVersion
        }
        guard !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !groups.isEmpty else {
            throw ChecklistError.invalidCatalog
        }
        var groupIDs = Set<String>()
        var itemIDs = Set<String>()
        for group in groups {
            guard !group.id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  !group.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  !group.items.isEmpty,
                  groupIDs.insert(group.id).inserted else {
                throw ChecklistError.invalidCatalog
            }
            for item in group.items {
                guard !item.id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                      !item.code.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                      !item.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                      (1...10).contains(item.priority),
                      itemIDs.insert(item.id).inserted else {
                    throw ChecklistError.invalidCatalog
                }
            }
        }
    }
}

private func normalizedSearchText(_ text: String) -> String {
    let locale = Locale(identifier: "tr_TR")
    // Lowercase first so that Turkish İ becomes i before diacritics are removed.
    return text.lowercased(with: locale).folding(options: .diacriticInsensitive, locale: locale)
}

struct ChecklistSearchQuery {
    fileprivate let text: String
    var isEmpty: Bool { text.isEmpty }

    init(_ rawValue: String) {
        text = normalizedSearchText(rawValue.trimmingCharacters(in: .whitespacesAndNewlines))
    }
}

/// Join and normalize this immutable catalog once; each render normalizes its
/// query once, then only performs substring checks for the visible results.
struct ChecklistSearchIndex {
    private let textByItemID: [String: String]

    init(catalog: ChecklistCatalog) {
        var texts: [String: String] = [:]
        for group in catalog.groups {
            for item in group.items {
                let text = [item.code, item.title, item.criterion, item.input,
                            item.department, group.title].joined(separator: " ")
                texts[item.id] = normalizedSearchText(text)
            }
        }
        textByItemID = texts
    }

    func matches(_ item: ChecklistItem, query: ChecklistSearchQuery) -> Bool {
        guard let text = textByItemID[item.id] else { return false }
        return query.isEmpty || text.contains(query.text)
    }
}

enum ChecklistError: LocalizedError {
    case unsupportedCatalogVersion
    case invalidCatalog
    case unsupportedProgressVersion
    case unknownItem
    case invalidProgress
    case unknownHotel
    case invalidHotelName
    case duplicateHotelName

    var errorDescription: String? {
        switch self {
        case .unsupportedCatalogVersion:
            return "İşlem listesinin sürümü bu uygulamada desteklenmiyor."
        case .invalidCatalog:
            return "İşlem listesi eksik veya geçersiz kayıtlar içeriyor."
        case .unsupportedProgressVersion:
            return "Kayıtlı ilerlemenin sürümü desteklenmiyor. Mevcut dosyanız korundu."
        case .unknownItem:
            return "Bu işlem listede bulunamadığı için değişiklik kaydedilemedi."
        case .invalidProgress:
            return "Kayıtlı otel bilgileri eksik veya geçersiz. Mevcut dosyanız korundu."
        case .unknownHotel:
            return "Bu otel bulunamadığı için değişiklik kaydedilemedi."
        case .invalidHotelName:
            return "Lütfen boş olmayan bir otel adı yazın."
        case .duplicateHotelName:
            return "Bu isimde bir otel zaten var. Lütfen farklı bir ad yazın."
        }
    }
}

struct ChecklistHotel: Codable, Identifiable, Equatable {
    let id: String
    var name: String
    var checkedIDs: Set<String>
    var notes: [String: String]
}

/// Owned by the UI's main actor. A failed read is surfaced to the caller rather
/// than silently replacing previously saved progress with an empty checklist.
final class ProgressStorage {
    private struct VersionHeader: Decodable {
        let schemaVersion: Int
    }

    private struct LegacyProgress: Decodable {
        let schemaVersion: Int
        let checkedIDs: [String]
    }

    // Keep the serialized IDs as an array until validation so duplicates are
    // rejected rather than silently discarded by Set's decoder.
    private struct SavedHotel: Codable {
        let id: String
        let name: String
        let checkedIDs: [String]
        let notes: [String: String]
    }

    private struct SavedProgress: Codable {
        let schemaVersion: Int
        let hotels: [SavedHotel]
    }

    private let fileURL: URL
    private let knownIDs: Set<String>
    private(set) var hotels: [ChecklistHotel]

    init(fileURL: URL, legacyFileURL: URL? = nil, catalog: ChecklistCatalog,
         initialHotelNames: [String] = [], legacyHotelName: String? = nil) throws {
        try catalog.validate()
        self.fileURL = fileURL
        self.knownIDs = Set(catalog.items.map(\.id))
        self.hotels = []

        if let data = try Self.readIfPresent(fileURL) {
            hotels = try decodeProgress(data)
            return
        }

        var initialHotels: [ChecklistHotel] = []
        for rawName in initialHotelNames {
            let name = try Self.validatedName(rawName, among: initialHotels)
            initialHotels.append(ChecklistHotel(id: UUID().uuidString, name: name,
                                               checkedIDs: [], notes: [:]))
        }

        var hasLegacyFile = false
        if let legacyFileURL, let legacyData = try Self.readIfPresent(legacyFileURL) {
            hasLegacyFile = true
            let checks = try decodeLegacy(legacyData)
            if !checks.isEmpty {
                let matchingIndex = legacyHotelName.flatMap { name in
                    initialHotels.firstIndex { Self.nameKey($0.name) == Self.nameKey(name) }
                }
                if let matchingIndex {
                    initialHotels[matchingIndex].checkedIDs = checks
                } else if let placeholderIndex = initialHotels.firstIndex(where: {
                    Self.nameKey($0.name) == Self.nameKey("Mevcut işlerim")
                }) {
                    initialHotels[placeholderIndex].checkedIDs = checks
                } else {
                    initialHotels.append(ChecklistHotel(id: UUID().uuidString, name: "Mevcut işlerim",
                                                        checkedIDs: checks, notes: [:]))
                }
            }
        }

        // Commit migration/seeding before publishing state. The legacy file is
        // never changed, and an existing v2 file always wins on subsequent runs.
        if hasLegacyFile || !initialHotels.isEmpty {
            try persist(initialHotels)
            hotels = initialHotels
        }
    }

    private static func readIfPresent(_ url: URL) throws -> Data? {
        do {
            return try Data(contentsOf: url)
        } catch let error as CocoaError where error.code == .fileReadNoSuchFile {
            return nil
        }
    }

    private func decodeProgress(_ data: Data) throws -> [ChecklistHotel] {
        do {
            let decoder = JSONDecoder()
            guard try decoder.decode(VersionHeader.self, from: data).schemaVersion == 2 else {
                throw ChecklistError.unsupportedProgressVersion
            }
            let saved = try decoder.decode(SavedProgress.self, from: data)
            var ids = Set<String>()
            var names = Set<String>()
            return try saved.hotels.map { hotel in
                guard Self.validID(hotel.id), ids.insert(hotel.id).inserted,
                      !hotel.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                      names.insert(Self.nameKey(hotel.name)).inserted,
                      hotel.checkedIDs.allSatisfy(Self.validID),
                      Set(hotel.checkedIDs).count == hotel.checkedIDs.count,
                      hotel.notes.keys.allSatisfy(Self.validID) else {
                    throw ChecklistError.invalidProgress
                }
                return ChecklistHotel(id: hotel.id, name: hotel.name,
                                      checkedIDs: Set(hotel.checkedIDs).intersection(knownIDs),
                                      notes: hotel.notes.filter { knownIDs.contains($0.key) })
            }
        } catch let error as ChecklistError {
            throw error
        } catch {
            throw ChecklistError.invalidProgress
        }
    }

    private func decodeLegacy(_ data: Data) throws -> Set<String> {
        do {
            let decoder = JSONDecoder()
            guard try decoder.decode(VersionHeader.self, from: data).schemaVersion == 1 else {
                throw ChecklistError.unsupportedProgressVersion
            }
            let saved = try decoder.decode(LegacyProgress.self, from: data)
            guard saved.checkedIDs.allSatisfy(Self.validID),
                  Set(saved.checkedIDs).count == saved.checkedIDs.count else {
                throw ChecklistError.invalidProgress
            }
            return Set(saved.checkedIDs).intersection(knownIDs)
        } catch let error as ChecklistError {
            throw error
        } catch {
            throw ChecklistError.invalidProgress
        }
    }

    @discardableResult
    func addHotel(name rawName: String) throws -> String {
        let name = try Self.validatedName(rawName, among: hotels)
        let hotel = ChecklistHotel(id: UUID().uuidString, name: name, checkedIDs: [], notes: [:])
        try save(hotels + [hotel])
        return hotel.id
    }

    func renameHotel(_ hotelID: String, name rawName: String) throws {
        let index = try hotelIndex(hotelID)
        let name = try Self.validatedName(rawName, among: hotels.filter { $0.id != hotelID })
        var next = hotels
        next[index].name = name
        try save(next)
    }

    func setChecked(_ itemID: String, isChecked: Bool, hotelID: String) throws {
        guard knownIDs.contains(itemID) else { throw ChecklistError.unknownItem }
        let index = try hotelIndex(hotelID)
        var next = hotels
        if isChecked {
            next[index].checkedIDs.insert(itemID)
        } else {
            next[index].checkedIDs.remove(itemID)
        }
        try save(next)
    }

    func setNote(_ note: String, for itemID: String, hotelID: String) throws {
        guard knownIDs.contains(itemID) else { throw ChecklistError.unknownItem }
        let index = try hotelIndex(hotelID)
        var next = hotels
        if note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            next[index].notes.removeValue(forKey: itemID)
        } else {
            next[index].notes[itemID] = note
        }
        try save(next)
    }

    /// Reset only checkmarks; task notes and every other hotel remain intact.
    func reset(hotelID: String) throws {
        let index = try hotelIndex(hotelID)
        var next = hotels
        next[index].checkedIDs = []
        try save(next)
    }

    private func hotelIndex(_ id: String) throws -> Int {
        guard let index = hotels.firstIndex(where: { $0.id == id }) else {
            throw ChecklistError.unknownHotel
        }
        return index
    }

    private static func validID(_ id: String) -> Bool {
        !id.isEmpty && id.rangeOfCharacter(from: .whitespacesAndNewlines.union(.controlCharacters)) == nil
    }

    private static func nameKey(_ name: String) -> String {
        name.trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased(with: Locale(identifier: "tr_TR"))
            .precomposedStringWithCanonicalMapping
    }

    private static func validatedName(_ rawName: String, among hotels: [ChecklistHotel]) throws -> String {
        let name = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { throw ChecklistError.invalidHotelName }
        guard !hotels.contains(where: { nameKey($0.name) == nameKey(name) }) else {
            throw ChecklistError.duplicateHotelName
        }
        return name
    }

    private func save(_ next: [ChecklistHotel]) throws {
        guard next != hotels else { return }
        try persist(next)
        hotels = next
    }

    private func persist(_ next: [ChecklistHotel]) throws {
        let saved = SavedProgress(schemaVersion: 2, hotels: next.map {
            SavedHotel(id: $0.id, name: $0.name, checkedIDs: $0.checkedIDs.sorted(), notes: $0.notes)
        })
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        let data = try encoder.encode(saved)
        try FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try data.write(to: fileURL, options: .atomic)
    }
}
