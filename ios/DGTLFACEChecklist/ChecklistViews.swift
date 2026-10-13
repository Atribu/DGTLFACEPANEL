import SwiftUI

private enum ChecklistBrand {
    static let dark = Color(red: 20 / 255, green: 15 / 255, blue: 37 / 255)
    static let purple = Color(red: 167 / 255, green: 84 / 255, blue: 207 / 255)
    static let blue = Color(red: 84 / 255, green: 124 / 255, blue: 207 / 255)
    static let cyan = Color(red: 84 / 255, green: 185 / 255, blue: 207 / 255)
}

private enum ChecklistFilter: String, CaseIterable, Identifiable {
    case all = "Tümü"
    case remaining = "Kalan"
    case completed = "Biten"

    var id: String { rawValue }

    func includes(_ item: ChecklistItem, checkedIDs: Set<String>) -> Bool {
        switch self {
        case .all: return true
        case .remaining: return !checkedIDs.contains(item.id)
        case .completed: return checkedIDs.contains(item.id)
        }
    }
}

struct ChecklistHomeView: View {
    @EnvironmentObject private var store: ChecklistStore
    @State private var addingHotel = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 14) {
                        ChecklistBrandHeading(subtitle: "Otellerine göre iş takibi")
                        Text("Bir otel seç, işlemlerini tamamla ve notlarını ekle.")
                            .font(.subheadline)
                            .foregroundStyle(.white.opacity(0.85))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .checklistBrandCard()
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                }

                Section {
                    ForEach(store.hotels) { hotel in
                        NavigationLink {
                            ChecklistHotelView(hotelID: hotel.id)
                        } label: {
                            ChecklistHotelRow(hotel: hotel)
                        }
                    }
                    Button {
                        addingHotel = true
                    } label: {
                        Label("Otel ekle", systemImage: "plus.circle")
                            .frame(minHeight: 44)
                    }
                    .accessibilityHint("Ayrı işaretler ve notlarla yeni bir otel ekler")
                } header: {
                    Text("Oteller · \(store.hotels.count)")
                } footer: {
                    Text("Her otelin tikleri ve notları ayrı tutulur. İlerlemen yalnızca bu iPhone’da saklanır; internetsiz çalışır.")
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Otellerim")
            .sheet(isPresented: $addingHotel) {
                ChecklistHotelEditor(hotelID: nil, initialName: "")
            }
        }
        .tint(ChecklistBrand.purple)
        .alert("İşlem tamamlanamadı", isPresented: Binding(
            get: { store.errorMessage != nil },
            set: { if !$0 { store.errorMessage = nil } }
        )) {
            Button("Tamam", role: .cancel) { store.errorMessage = nil }
        } message: {
            Text(store.errorMessage ?? "Lütfen yeniden deneyin.")
        }
    }
}

private struct ChecklistHotelRow: View {
    @EnvironmentObject private var store: ChecklistStore
    let hotel: ChecklistHotel

    var body: some View {
        let completed = store.completedCount(hotelID: hotel.id)

        VStack(alignment: .leading, spacing: 10) {
            Text(hotel.name)
                .font(.headline)
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)
            Text("\(completed) / \(store.totalCount) tamamlandı")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .monospacedDigit()
            ProgressView(value: Double(completed), total: Double(max(store.totalCount, 1)))
                .tint(ChecklistBrand.purple)
                .accessibilityHidden(true)
        }
        .padding(.vertical, 8)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Bu otelin işlem gruplarını açar")
    }
}

private struct ChecklistHotelView: View {
    @EnvironmentObject private var store: ChecklistStore
    let hotelID: String
    @State private var query = ""
    @State private var filter: ChecklistFilter = .all
    @State private var confirmingReset = false
    @State private var renamingHotel = false

    private var hotelName: String { store.hotel(id: hotelID)?.name ?? "Otel" }

    private func matchingGroups(query: ChecklistSearchQuery, checkedIDs: Set<String>) -> [ChecklistGroup] {
        store.catalog.groups.compactMap { group in
            if query.isEmpty {
                return group.items.contains { filter.includes($0, checkedIDs: checkedIDs) }
                    ? group : nil
            }

            let items = group.items.filter { item in
                filter.includes(item, checkedIDs: checkedIDs)
                    && store.matchesSearch(item, query: query)
            }
            return items.isEmpty ? nil : ChecklistGroup(id: group.id, title: group.title, items: items)
        }
    }

    var body: some View {
        let searchTerm = ChecklistSearchQuery(query)
        let matchingGroups = matchingGroups(query: searchTerm, checkedIDs: store.checkedIDs(hotelID: hotelID))
        let completedCount = store.completedCount(hotelID: hotelID)

        List {
            if searchTerm.isEmpty {
                Section {
                    ChecklistOverview(hotelID: hotelID)
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                }
            }

            Section {
                ChecklistFilterControl(selection: $filter)
            }

            if matchingGroups.isEmpty {
                Section {
                    ChecklistEmptyState(filter: filter, searching: !searchTerm.isEmpty) {
                        query = ""
                        filter = .all
                    }
                }
            } else if searchTerm.isEmpty {
                Section {
                    ForEach(matchingGroups) { group in
                        NavigationLink {
                            ChecklistGroupView(group: group, hotelID: hotelID, filter: $filter)
                        } label: {
                            ChecklistGroupRow(group: group, hotelID: hotelID)
                        }
                    }
                } header: {
                    Text("İşlem grupları")
                } footer: {
                    Text("Bir grubu aç, tamamladığın işlemlere tik koy ve gerekli notları ekle. Bu otelin ilerlemesi diğer otelleri etkilemez.")
                }
            } else {
                ForEach(matchingGroups) { group in
                    Section {
                        ForEach(group.items) { item in
                            ChecklistItemRow(item: item, hotelID: hotelID)
                        }
                    } header: {
                        Text(group.title)
                            .textCase(nil)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(hotelName)
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, prompt: "İşlem veya grup ara")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button {
                        renamingHotel = true
                    } label: {
                        Label("Otel adını düzenle", systemImage: "pencil")
                    }
                    Button(role: .destructive) {
                        confirmingReset = true
                    } label: {
                        Label("Bu otelin tiklerini sıfırla", systemImage: "arrow.counterclockwise")
                    }
                    .disabled(completedCount == 0)
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .frame(minWidth: 44, minHeight: 44)
                }
                .accessibilityLabel("\(hotelName) seçenekleri")
            }
        }
        .sheet(isPresented: $renamingHotel) {
            ChecklistHotelEditor(hotelID: hotelID, initialName: hotelName)
        }
        .confirmationDialog("Bu otelin tikleri temizlensin mi?", isPresented: $confirmingReset, titleVisibility: .visible) {
            Button("Tikleri temizle (\(completedCount))", role: .destructive) {
                store.reset(hotelID: hotelID)
            }
            Button("Vazgeç", role: .cancel) {}
        } message: {
            Text("\(hotelName) için tamamlandı olarak işaretlenen \(completedCount) işlem yeniden kalanlar listesine alınacak. Notların korunacak. Diğer oteller etkilenmeyecek.")
        }
    }
}

private struct ChecklistBrandHeading: View {
    let subtitle: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image("BrandMark")
                .resizable()
                .scaledToFit()
                .frame(width: 38, height: 36)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text("DGTLFACE")
                    .font(.headline)
                    .tracking(1.8)
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.8))
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
    }
}

private struct ChecklistBrandCard: ViewModifier {
    func body(content: Content) -> some View {
        content
            .foregroundStyle(.white)
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                LinearGradient(colors: [ChecklistBrand.dark, ChecklistBrand.blue.opacity(0.75), ChecklistBrand.dark], startPoint: .topLeading, endPoint: .bottomTrailing)
                    .background(ChecklistBrand.dark)
            )
            .clipShape(RoundedRectangle(cornerRadius: 20))
    }
}

private extension View {
    func checklistBrandCard() -> some View {
        modifier(ChecklistBrandCard())
    }
}

private struct ChecklistOverview: View {
    @EnvironmentObject private var store: ChecklistStore
    let hotelID: String

    var body: some View {
        let total = store.totalCount
        let completed = store.completedCount(hotelID: hotelID)
        let remaining = total - completed

        VStack(alignment: .leading, spacing: 20) {
            ChecklistBrandHeading(subtitle: store.hotel(id: hotelID)?.name ?? "Otel")

            VStack(alignment: .leading, spacing: 10) {
                Text("\(completed) / \(total) tamamlandı")
                    .font(.title2.weight(.bold))
                    .monospacedDigit()
                    .fixedSize(horizontal: false, vertical: true)
                ProgressView(value: Double(completed), total: Double(max(total, 1)))
                    .tint(ChecklistBrand.cyan)
                    .accessibilityLabel("Otelin ilerlemesi")
                    .accessibilityValue("\(total) işlemin \(completed) tanesi tamamlandı")
                Text(remaining == 0 ? "Bu oteldeki tüm işlemleri tamamladın." : "\(remaining) işlem seni bekliyor.")
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.85))
            }
        }
        .checklistBrandCard()
    }
}

private struct ChecklistFilterControl: View {
    @Binding var selection: ChecklistFilter

    var body: some View {
        Picker("Göster", selection: $selection) {
            ForEach(ChecklistFilter.allCases) { filter in
                Text(filter.rawValue).tag(filter)
            }
        }
        .pickerStyle(.menu)
        .accessibilityLabel("İşlem filtresi")
    }
}

private struct ChecklistGroupRow: View {
    @EnvironmentObject private var store: ChecklistStore
    let group: ChecklistGroup
    let hotelID: String

    var body: some View {
        let completed = store.completedCount(in: group, hotelID: hotelID)

        VStack(alignment: .leading, spacing: 10) {
            Text(group.title)
                .font(.headline)
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("\(completed) / \(group.items.count) tamamlandı")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                if completed == group.items.count {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(ChecklistBrand.purple)
                        .accessibilityHidden(true)
                }
            }
            ProgressView(value: Double(completed), total: Double(max(group.items.count, 1)))
                .tint(ChecklistBrand.purple)
                .accessibilityHidden(true)
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Gruptaki işlemleri açar")
    }
}

private struct ChecklistGroupView: View {
    @EnvironmentObject private var store: ChecklistStore
    let group: ChecklistGroup
    let hotelID: String
    @Binding var filter: ChecklistFilter
    @State private var query = ""

    private var hotelName: String { store.hotel(id: hotelID)?.name ?? "Otel" }

    private func filteredItems(query: ChecklistSearchQuery, checkedIDs: Set<String>) -> [ChecklistItem] {
        group.items.filter { item in
            filter.includes(item, checkedIDs: checkedIDs)
                && (query.isEmpty || store.matchesSearch(item, query: query))
        }
    }

    var body: some View {
        let searchTerm = ChecklistSearchQuery(query)
        let filteredItems = filteredItems(query: searchTerm, checkedIDs: store.checkedIDs(hotelID: hotelID))
        let completedCount = store.completedCount(in: group, hotelID: hotelID)

        List {
            Section {
                VStack(alignment: .leading, spacing: 10) {
                    Text(hotelName)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(ChecklistBrand.purple)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(group.title)
                        .font(.title2.weight(.bold))
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                    Text("\(completedCount) / \(group.items.count) tamamlandı")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                    ProgressView(value: Double(completedCount), total: Double(max(group.items.count, 1)))
                        .tint(ChecklistBrand.purple)
                        .accessibilityHidden(true)
                }
                .padding(.vertical, 8)
                ChecklistFilterControl(selection: $filter)
            }

            Section {
                if filteredItems.isEmpty {
                    ChecklistEmptyState(filter: filter, searching: !searchTerm.isEmpty) {
                        query = ""
                        filter = .all
                    }
                } else {
                    ForEach(filteredItems) { item in
                        ChecklistItemRow(item: item, hotelID: hotelID)
                    }
                }
            } header: {
                Text("İşlemler · \(filteredItems.count)")
            } footer: {
                Text("Tamamladığın işlemin yanındaki daireye dokun. Her işlemin altına bu otele özel not ekleyebilirsin.")
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(hotelName)
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, prompt: "Bu grupta ara")
    }
}

private struct ChecklistItemRow: View {
    @EnvironmentObject private var store: ChecklistStore
    let item: ChecklistItem
    let hotelID: String
    @State private var editingNote = false

    var body: some View {
        let checked = store.isChecked(item.id, hotelID: hotelID)
        let note = store.note(for: item.id, hotelID: hotelID)

        HStack(alignment: .top, spacing: 8) {
            Button {
                store.toggle(item, hotelID: hotelID)
            } label: {
                Image(systemName: checked ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 26, weight: .medium))
                    .foregroundStyle(checked ? ChecklistBrand.purple : Color.secondary)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(item.code), \(item.title)")
            .accessibilityValue(checked ? "Tamamlandı" : "Tamamlanmadı")
            .accessibilityHint(checked ? "Tamamlandı işaretini kaldırır" : "İşlemi tamamlandı olarak işaretler")

            VStack(alignment: .leading, spacing: 8) {
                Text(item.code)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .padding(.top, 2)
                Text(item.title)
                    .font(.body.weight(.medium))
                    .strikethrough(checked, color: .secondary)
                    .foregroundStyle(checked ? Color.secondary : Color.primary)
                    .fixedSize(horizontal: false, vertical: true)

                if !note.isEmpty {
                    Text(note)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                        .accessibilityLabel("Not: \(note)")
                }
                Button {
                    editingNote = true
                } label: {
                    Label(note.isEmpty ? "Not ekle" : "Notu düzenle", systemImage: "square.and.pencil")
                        .font(.subheadline)
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.borderless)
                .accessibilityHint("\(item.code) işlemi için bu otele özel açıklama açar")

                DisclosureGroup {
                    VStack(alignment: .leading, spacing: 12) {
                        if !item.criterion.isEmpty {
                            ChecklistDetailField(title: "Tamamlanma ölçütü", value: item.criterion)
                        }
                        if !item.input.isEmpty {
                            ChecklistDetailField(title: "Gerekli bilgi / girdi", value: item.input)
                        }
                        if !item.department.isEmpty {
                            ChecklistDetailField(title: "İlgili ekip", value: item.department)
                        }
                        ChecklistDetailField(title: "Öncelik", value: "\(item.priority) / 10 · 1 en öncelikli")
                    }
                    .padding(.top, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                } label: {
                    Text("Ayrıntılar")
                        .font(.subheadline)
                        .frame(minHeight: 44)
                }
                .tint(ChecklistBrand.purple)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 8)
        .sheet(isPresented: $editingNote) {
            ChecklistNoteEditor(item: item, hotelID: hotelID, initialNote: note)
        }
    }
}

private struct ChecklistNoteEditor: View {
    @EnvironmentObject private var store: ChecklistStore
    @Environment(\.dismiss) private var dismiss
    let item: ChecklistItem
    let hotelID: String
    let initialNote: String
    @State private var draft: String
    @State private var errorMessage: String?
    @State private var confirmingDiscard = false

    init(item: ChecklistItem, hotelID: String, initialNote: String) {
        self.item = item
        self.hotelID = hotelID
        self.initialNote = initialNote
        _draft = State(initialValue: initialNote)
    }

    private var hasChanges: Bool { draft != initialNote }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ChecklistDetailField(title: "Otel", value: store.hotel(id: hotelID)?.name ?? "Otel")
                    ChecklistDetailField(title: item.code, value: item.title)
                }
                Section {
                    TextEditor(text: $draft)
                        .frame(minHeight: 220)
                        .accessibilityLabel("İşlem notu")
                        .accessibilityHint("Bu otele ait işlem için açıklamanı yaz")
                } header: {
                    Text("Açıklama / not")
                } footer: {
                    Text("Notun yalnızca bu otel ve işlem için kaydedilir. Notu kaldırmak için metni temizleyip Kaydet’e dokun.")
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle(initialNote.isEmpty ? "Not ekle" : "Notu düzenle")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Vazgeç") {
                        if hasChanges { confirmingDiscard = true } else { dismiss() }
                    }
                    .frame(minHeight: 44)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Kaydet") {
                        do {
                            try store.saveNote(draft, for: item.id, hotelID: hotelID)
                            dismiss()
                        } catch {
                            errorMessage = error.localizedDescription
                        }
                    }
                    .fontWeight(.semibold)
                    .frame(minHeight: 44)
                    .disabled(!hasChanges)
                }
            }
            .confirmationDialog("Not değişikliklerinden vazgeçilsin mi?", isPresented: $confirmingDiscard, titleVisibility: .visible) {
                Button("Değişiklikleri sil", role: .destructive) { dismiss() }
                Button("Yazmaya devam et", role: .cancel) {}
            } message: {
                Text("Kaydedilmemiş değişikliklerin silinecek. Önceden kaydettiğin not korunacak.")
            }
            .alert("Not kaydedilemedi", isPresented: Binding(
                get: { errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            )) {
                Button("Tamam", role: .cancel) { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "Lütfen yeniden deneyin.")
            }
        }
        .tint(ChecklistBrand.purple)
        .interactiveDismissDisabled(hasChanges)
    }
}

private struct ChecklistHotelEditor: View {
    @EnvironmentObject private var store: ChecklistStore
    @Environment(\.dismiss) private var dismiss
    let hotelID: String?
    let initialName: String
    @State private var name: String
    @State private var errorMessage: String?
    @State private var confirmingDiscard = false

    init(hotelID: String?, initialName: String) {
        self.hotelID = hotelID
        self.initialName = initialName
        _name = State(initialValue: initialName)
    }

    private var hasChanges: Bool { name != initialName }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Otel adı", text: $name, axis: .vertical)
                        .textInputAutocapitalization(.words)
                        .autocorrectionDisabled()
                        .accessibilityLabel("Otel adı")
                } header: {
                    Text("Otel adı")
                } footer: {
                    Text(hotelID == nil
                         ? "Yeni otelde aynı işlem grupları bulunur. Tikler ve notlar boş başlar."
                         : "Otel adını değiştirmek mevcut tiklerini ve notlarını etkilemez.")
                }
            }
            .navigationTitle(hotelID == nil ? "Otel ekle" : "Otel adını düzenle")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Vazgeç") {
                        if hasChanges { confirmingDiscard = true } else { dismiss() }
                    }
                    .frame(minHeight: 44)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Kaydet") {
                        do {
                            if let hotelID {
                                try store.renameHotel(hotelID, name: name)
                            } else {
                                try store.addHotel(name: name)
                            }
                            dismiss()
                        } catch {
                            errorMessage = error.localizedDescription
                        }
                    }
                    .fontWeight(.semibold)
                    .frame(minHeight: 44)
                    .disabled(!hasChanges || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .confirmationDialog("Değişikliklerden vazgeçilsin mi?", isPresented: $confirmingDiscard, titleVisibility: .visible) {
                Button("Değişiklikleri sil", role: .destructive) { dismiss() }
                Button("Düzenlemeye devam et", role: .cancel) {}
            }
            .alert("Otel kaydedilemedi", isPresented: Binding(
                get: { errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            )) {
                Button("Tamam", role: .cancel) { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "Lütfen yeniden deneyin.")
            }
        }
        .tint(ChecklistBrand.purple)
        .interactiveDismissDisabled(hasChanges)
    }
}

private struct ChecklistDetailField: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.subheadline)
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }
}

private struct ChecklistEmptyState: View {
    let filter: ChecklistFilter
    let searching: Bool
    let clear: () -> Void

    private var title: String {
        if searching { return "Eşleşen işlem yok" }
        return filter == .completed ? "Henüz tamamlanan işlem yok" : "Kalan işlem yok"
    }

    private var message: String {
        if searching { return "Başka bir sözcük dene veya aramayı ve filtreyi temizle." }
        if filter == .completed { return "Tamamladığın işlemlere tik koydukça burada görünecekler." }
        return "Bu listedeki tüm işlemleri tamamladın."
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(title, systemImage: searching ? "magnifyingglass" : "checkmark.circle")
                .font(.headline)
                .fixedSize(horizontal: false, vertical: true)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Button("Tüm işlemleri göster", action: clear)
                .buttonStyle(.bordered)
                .frame(minHeight: 44)
        }
        .padding(.vertical, 12)
    }
}
