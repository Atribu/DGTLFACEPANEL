import SwiftUI

private enum PanelManagement {
    static let departments = ["Proje Yöneticisi", "Web & IT", "Sosyal Medya", "Analytics", "Performans Pazarlama", "Çağrı Merkezi", "Dijital Strateji", "SEO", "Kreatif Ekip"]
    static let services = ["Web", "OTA", "Çağrı Merkezi", "SEO", "Sosyal Medya", "Reklam"]
    static func trimmed(_ value: String) -> String { value.trimmingCharacters(in: .whitespacesAndNewlines) }
    @MainActor static func isAdmin(_ store: PanelStore) -> Bool { store.isSignedIn && store.snapshot?.user.role == "admin" && store.snapshot?.user.active != false }
    @MainActor static func canSave(_ store: PanelStore) -> Bool { isAdmin(store) && !store.isOffline && !store.isSaving && !store.isLoading }
    @MainActor static func people(_ store: PanelStore) -> [PanelUser] { (store.snapshot?.users ?? []).filter { $0.active != false && $0.role != "observer" }.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending } }
    static func matches(_ values: [String], query: String) -> Bool {
        let query = trimmed(query)
        return query.isEmpty || values.joined(separator: " ").range(of: query, options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "tr_TR")) != nil
    }
    static func date(_ raw: String?) -> Date? {
        guard let raw else { return nil }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.date(from: String(raw.prefix(10)))
    }
    static func dateString(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
    static func overdue(_ task: PanelTask) -> Bool {
        PanelTaskSelection.overdue(task)
    }
    static func emailIsPlausible(_ text: String) -> Bool {
        let text = trimmed(text)
        return text.count <= 254 && text.range(of: #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#, options: .regularExpression) != nil
    }
}

/// Sheets retain their fields after a rejected request and never dismiss before an acknowledgement.
private struct PanelManagementEditor<Fields: View>: View {
    @EnvironmentObject private var store: PanelStore
    @Environment(\.dismiss) private var dismiss
    let title: String
    let dirty: Bool
    let saveTitle: String
    let onSave: () async -> Bool
    @ViewBuilder let fields: () -> Fields
    @State private var confirmingDiscard = false

    var body: some View {
        NavigationStack {
            Group {
                if PanelManagement.isAdmin(store) {
                    Form {
                        fields()
                        if store.isOffline {
                            Section {
                                Label("Çevrimdışısın. Taslağın bu ekranda korunur.", systemImage: "wifi.slash")
                                Button(store.isRefreshing ? "Bağlanılıyor…" : "Bağlantıyı yeniden dene") { Task { await store.refresh() } }
                                    .disabled(store.isRefreshing || store.isSaving)
                            } footer: { Text("Kaydetmek için internet bağlantısı gerekir.") }
                        }
                    }
                    .disabled(store.isSaving)
                } else {
                    ContentUnavailableView("Yönetici yetkisi gerekiyor", systemImage: "lock.shield", description: Text("Bu işlemi yalnızca aktif yöneticiler yapabilir."))
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle(title).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Vazgeç") { if dirty { confirmingDiscard = true } else { dismiss() } }.disabled(store.isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(store.isSaving ? "Kaydediliyor…" : saveTitle) { Task { if await onSave() { dismiss() } } }
                        .fontWeight(.semibold).disabled(!PanelManagement.canSave(store))
                }
            }
            .confirmationDialog("Kaydedilmemiş değişiklikler silinsin mi?", isPresented: $confirmingDiscard, titleVisibility: .visible) {
                Button("Değişiklikleri sil", role: .destructive) { dismiss() }
                Button("Düzenlemeye devam et", role: .cancel) {}
            }
        }
        .interactiveDismissDisabled(dirty || store.isSaving)
        .modifier(PanelScenePrivacy())
    }
}

private struct PanelManagementFailure: View {
    let message: String?
    var body: some View {
        if let message { Section { Text(message).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true) } }
    }
}

private struct PanelTaskForm: Equatable {
    var hotelID: String
    var title: String
    var description: String
    var department: String
    var assigneeID: String
    var priority: Int
    var hasDueDate: Bool
    var dueDate: Date
    var hotelInput: String
    var stage: String
    var checklist: String

    init(task: PanelTask?, hotelID: String?) {
        self.hotelID = task?.hotelId ?? hotelID ?? ""
        title = task?.title ?? ""
        description = task?.description ?? ""
        department = task?.department ?? ""
        assigneeID = task?.assigneeId ?? ""
        priority = task?.priority ?? 5
        hasDueDate = task?.dueDate != nil
        dueDate = PanelManagement.date(task?.dueDate) ?? Calendar.current.startOfDay(for: Date())
        hotelInput = task?.hotelInput ?? ""
        stage = task?.stage ?? "Genel"
        checklist = task?.checklist.map(\.text).joined(separator: "\n") ?? ""
    }
}

struct PanelTaskComposerView: View {
    @EnvironmentObject private var store: PanelStore
    @State private var baselineTask: PanelTask?
    @State private var initial: PanelTaskForm
    @State private var form: PanelTaskForm
    @State private var failure: String?
    @State private var confirmingReload = false

    init(task: PanelTask? = nil, hotelID: String? = nil) {
        let fields = PanelTaskForm(task: task, hotelID: hotelID)
        _baselineTask = State(initialValue: task)
        _initial = State(initialValue: fields)
        _form = State(initialValue: fields)
    }

    private var stale: Bool {
        guard let task = baselineTask else { return false }
        return store.task(id: task.id) != task
    }
    private var departmentOptions: [String] {
        Array(Set(PanelManagement.departments + (store.snapshot?.tasks.map(\.department) ?? []) + [form.department])).filter { !$0.isEmpty }.sorted()
    }
    private var assignees: [PanelUser] {
        var users = PanelManagement.people(store)
        if !form.assigneeID.isEmpty, !users.contains(where: { $0.id == form.assigneeID }), let historical = store.snapshot?.users.first(where: { $0.id == form.assigneeID }) { users.append(historical) }
        return users
    }

    var body: some View {
        PanelManagementEditor(title: baselineTask == nil ? "Yeni görev" : "Görevi düzenle", dirty: form != initial, saveTitle: "Kaydet", onSave: save) {
            PanelManagementFailure(message: failure)
            if stale {
                Section {
                    Label("Görev başka bir işlemle güncellendi", systemImage: "arrow.triangle.2.circlepath")
                    Text("Kaydetmeden önce sunucudaki güncel bilgileri yükle. Bu formdaki değişikliklerin yerine güncel bilgiler gelecek.").font(.footnote).foregroundStyle(.secondary)
                    Button("Güncel bilgileri yükle") { confirmingReload = true }
                }
            }
            Section("Görev bilgileri") {
                TextField("Görev adı", text: $form.title, axis: .vertical).lineLimit(1...3)
                Picker("Otel", selection: $form.hotelID) {
                    Text("Otel seç").tag("")
                    ForEach(store.snapshot?.hotels ?? []) { Text($0.name).tag($0.id) }
                }.disabled(baselineTask != nil)
                Picker("Ekip", selection: $form.department) {
                    Text("Ekip seç").tag("")
                    ForEach(departmentOptions, id: \.self) { Text($0).tag($0) }
                }
                TextField("Süreç aşaması", text: $form.stage)
            }
            Section("Açıklama") { TextField("İşin kapsamını yaz", text: $form.description, axis: .vertical).lineLimit(4...10) }
            Section {
                Picker("Sorumlu", selection: $form.assigneeID) {
                    Text("Henüz atanmadı").tag("")
                    ForEach(assignees) { user in Text("\(user.name)\(user.active == false ? " · Pasif / mevcut atama" : "")").tag(user.id) }
                }
                Picker("Öncelik", selection: $form.priority) {
                    ForEach(1...10, id: \.self) { Text("\($0)\($0 == 1 ? " · En yüksek" : $0 == 10 ? " · En düşük" : "")").tag($0) }
                }
                Toggle("Teslim tarihi belirle", isOn: $form.hasDueDate)
                if form.hasDueDate { DatePicker("Teslim tarihi", selection: $form.dueDate, displayedComponents: .date) }
            } header: { Text("Planlama") } footer: { Text("1 en öncelikli, 10 en düşük öncelikli iştir.") }
            if baselineTask == nil {
                Section {
                    TextField("Her satıra bir tamamlanma kriteri", text: $form.checklist, axis: .vertical).lineLimit(5...12)
                } header: { Text("Tamamlanma kriterleri") } footer: { Text("En az bir, en fazla 30 kriter ekle. Her kriter ayrı satırda olmalı.") }
            }
            Section("Otelden beklenen bilgi veya erişim") {
                TextField("Örneğin: Domain yönetim paneli erişimi", text: $form.hotelInput, axis: .vertical).lineLimit(3...8)
            }
        }
        .confirmationDialog("Formdaki değişikliklerin yerine güncel görev yüklensin mi?", isPresented: $confirmingReload, titleVisibility: .visible) {
            Button("Güncel görevi yükle", role: .destructive) {
                guard let id = baselineTask?.id, let task = store.task(id: id) else { return }
                baselineTask = task
                let fields = PanelTaskForm(task: task, hotelID: nil)
                form = fields; initial = fields; failure = nil
            }
            Button("Taslağı koru", role: .cancel) {}
        }
    }

    private func save() async -> Bool {
        failure = nil
        guard PanelManagement.canSave(store) else { return false }
        guard !stale else { failure = "Görev güncellendi. Taslağın korundu; güncel bilgileri yükleyip tekrar düzenle."; return false }
        let criteria = form.checklist.components(separatedBy: .newlines).map(PanelManagement.trimmed).filter { !$0.isEmpty }
        let title = PanelManagement.trimmed(form.title)
        let department = PanelManagement.trimmed(form.department)
        let stage = PanelManagement.trimmed(form.stage)
        guard !title.isEmpty, title.count <= 200, !form.hotelID.isEmpty, !department.isEmpty, department.count <= 200 else {
            failure = "Görev adı, otel ve ekip alanlarını doldur. Ad ve ekip en fazla 200 karakter olabilir."; return false
        }
        guard form.description.count <= 5000, form.hotelInput.count <= 3000, stage.count <= 200 else {
            failure = "Açıklama 5.000, otel bilgisi 3.000, süreç aşaması 200 karakteri geçemez."; return false
        }
        guard baselineTask != nil || (!criteria.isEmpty && criteria.count <= 30 && criteria.allSatisfy { $0.count <= 2000 }) else {
            failure = "1–30 tamamlanma kriteri ekle. Her kriter en fazla 2.000 karakter olabilir."; return false
        }
        let draft = PanelTaskDraft(hotelId: form.hotelID, title: title, description: PanelManagement.trimmed(form.description), department: department, assigneeId: form.assigneeID.isEmpty ? nil : form.assigneeID, priority: form.priority, dueDate: form.hasDueDate ? PanelManagement.dateString(form.dueDate) : nil, hotelInput: PanelManagement.trimmed(form.hotelInput), stage: stage.isEmpty ? "Genel" : stage, checklist: criteria)
        let saved: Bool
        if let task = baselineTask { saved = await store.updateTaskDetails(task, draft: draft) }
        else { saved = await store.createTask(draft) }
        if !saved { failure = store.errorMessage ?? "Görev kaydedilemedi. Taslağın korundu." }
        return saved
    }
}

struct PanelHotelManagementView: View {
    @EnvironmentObject private var store: PanelStore
    @State private var query = ""
    @State private var creating = false
    @State private var editingManager: PanelHotel?

    private var hotels: [PanelHotel] {
        (store.snapshot?.hotels ?? []).filter { hotel in
            let manager = store.snapshot?.users.first { $0.id == hotel.managerId }?.name ?? ""
            return PanelManagement.matches([hotel.name, hotel.location, hotel.services.joined(separator: " "), manager], query: query)
        }
            .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }
    var body: some View {
        Group {
            if PanelManagement.isAdmin(store) {
                List {
                    PanelSyncSection()
                    ForEach(hotels) { hotel in
                        Section {
                            NavigationLink { PanelHotelView(hotelID: hotel.id) } label: {
                                VStack(alignment: .leading, spacing: 5) {
                                    Text(hotel.name).font(.headline)
                                    Text(hotel.location).font(.subheadline).foregroundStyle(.secondary)
                                    Text(hotel.stage == "operation" ? "Operasyon" : "Kurulum").font(.caption).foregroundStyle(PanelStyle.purple)
                                }.padding(.vertical, 4)
                            }
                            if !hotel.services.isEmpty { LabeledContent("Hizmetler", value: hotel.services.joined(separator: ", ")) }
                            if !hotel.contactName.isEmpty { LabeledContent("Otel yetkilisi", value: hotel.contactName) }
                            if !hotel.contactEmail.isEmpty { Text(hotel.contactEmail).font(.subheadline).textSelection(.enabled) }
                            Button { editingManager = hotel } label: {
                                HStack {
                                    Label("Sorumlu", systemImage: "person.crop.circle")
                                    Spacer()
                                    Text(store.snapshot?.users.first { $0.id == hotel.managerId }?.name ?? "Atanmamış").foregroundStyle(.secondary).multilineTextAlignment(.trailing)
                                    Image(systemName: "pencil").font(.caption)
                                }.frame(minHeight: 35)
                            }.disabled(!PanelManagement.canSave(store))
                        }
                    }
                    if hotels.isEmpty { ContentUnavailableView("Otel bulunamadı", systemImage: "building.2", description: Text(query.isEmpty ? "İlk oteli ekleyerek başlayabilirsin." : "Arama metnini değiştir.")) }
                }
                .searchable(text: $query, prompt: "Otel, konum veya hizmet ara")
                .refreshable { await store.refresh() }
            } else { ContentUnavailableView("Yönetici yetkisi gerekiyor", systemImage: "lock.shield") }
        }
        .navigationTitle("Otel yönetimi")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                if PanelManagement.isAdmin(store) { Button { creating = true } label: { Label("Otel ekle", systemImage: "plus") }.disabled(!PanelManagement.canSave(store)) }
            }
        }
        .sheet(isPresented: $creating) { PanelHotelComposerView() }
        .sheet(item: $editingManager) { PanelHotelManagerEditor(hotel: $0) }
    }
}

private struct PanelHotelForm: Equatable {
    var name = ""
    var location = ""
    var contactName = ""
    var contactEmail = ""
    var managerID = ""
    var services: Set<String> = []
    var template = true
}

private struct PanelHotelComposerView: View {
    @EnvironmentObject private var store: PanelStore
    @State private var form = PanelHotelForm()
    @State private var failure: String?

    var body: some View {
        PanelManagementEditor(title: "Yeni otel", dirty: form != PanelHotelForm(), saveTitle: "Oluştur", onSave: save) {
            PanelManagementFailure(message: failure)
            Section("Otel bilgileri") {
                TextField("Otel adı", text: $form.name)
                TextField("Konum", text: $form.location)
                TextField("Otel yetkilisinin adı", text: $form.contactName).textContentType(.name)
                TextField("Yetkilinin e-posta adresi", text: $form.contactEmail)
                    .textContentType(.emailAddress).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                Picker("DGTLFACE sorumlusu", selection: $form.managerID) {
                    Text("Sorumlu seç").tag("")
                    ForEach(PanelManagement.people(store)) { Text($0.name).tag($0.id) }
                }
            }
            Section("Alınan hizmetler") {
                ForEach(PanelManagement.services, id: \.self) { service in
                    Toggle(service, isOn: Binding(get: { form.services.contains(service) }, set: { if $0 { form.services.insert(service) } else { form.services.remove(service) } }))
                }
            }
            Section {
                Toggle("Kurulum görevlerini ekle", isOn: $form.template)
            } footer: { Text("Açık olduğunda 93 görevlik standart kurulum listesi de oluşturulur. Kapalı olduğunda görevleri daha sonra tek tek ekleyebilirsin.") }
        }
    }

    private func save() async -> Bool {
        failure = nil
        guard PanelManagement.canSave(store) else { return false }
        let textFields = [form.name, form.location, form.contactName].map(PanelManagement.trimmed)
        guard textFields.allSatisfy({ !$0.isEmpty && $0.count <= 200 }), !form.managerID.isEmpty else {
            failure = "Otel adı, konum, yetkili ve sorumluyu doldur. Metin alanları en fazla 200 karakter olabilir."; return false
        }
        guard PanelManagement.emailIsPlausible(form.contactEmail) else { failure = "Geçerli bir e-posta adresi yaz."; return false }
        guard !form.services.isEmpty else { failure = "En az bir hizmet seç."; return false }
        let draft = PanelHotelDraft(name: textFields[0], location: textFields[1], services: PanelManagement.services.filter { form.services.contains($0) }, managerId: form.managerID, contactName: textFields[2], contactEmail: PanelManagement.trimmed(form.contactEmail), template: form.template)
        let saved = await store.createHotel(draft)
        if !saved { failure = store.errorMessage ?? "Otel kaydedilemedi. Taslağın korundu." }
        return saved
    }
}

private struct PanelHotelManagerEditor: View {
    @EnvironmentObject private var store: PanelStore
    let hotel: PanelHotel
    @State private var managerID: String
    @State private var failure: String?
    init(hotel: PanelHotel) { self.hotel = hotel; _managerID = State(initialValue: hotel.managerId) }

    var body: some View {
        PanelManagementEditor(title: "Otel sorumlusu", dirty: managerID != hotel.managerId, saveTitle: "Kaydet", onSave: save) {
            PanelManagementFailure(message: failure)
            Section {
                Text(hotel.name).font(.headline)
                Picker("Yeni sorumlu", selection: $managerID) {
                    Text("Sorumlu seç").tag("")
                    ForEach(PanelManagement.people(store)) { Text("\($0.name) · \($0.department)").tag($0.id) }
                }
            } footer: { Text("Otelin koordinasyon sorumlusunu değiştirir. Görevleri devretmek için her görevin sorumlusunu ayrıca güncelle.") }
        }
    }
    private func save() async -> Bool {
        failure = nil
        guard !managerID.isEmpty else { failure = "Bir sorumlu seç."; return false }
        let saved = await store.updateHotelManager(hotelID: hotel.id, managerID: managerID)
        if !saved { failure = store.errorMessage ?? "Sorumlu kaydedilemedi. Seçimin korundu." }
        return saved
    }
}

struct PanelUsersView: View {
    @EnvironmentObject private var store: PanelStore
    @State private var query = ""
    @State private var role = "all"
    @State private var state = "all"
    @State private var creating = false
    @State private var editingUser: PanelUser?

    private var users: [PanelUser] {
        (store.snapshot?.managedUsers ?? []).filter { user in
            let hotels = user.hotelIds.compactMap { id in store.snapshot?.hotels.first { $0.id == id }?.name }
            return (role == "all" || user.role == role) && (state == "all" || (state == "active" ? user.active != false : user.active == false)) && PanelManagement.matches([user.name, user.email, user.department, PanelStyle.role(user.role)] + hotels, query: query)
        }.sorted {
            if ($0.active != false) != ($1.active != false) { return $0.active != false }
            return $0.name.localizedStandardCompare($1.name) == .orderedAscending
        }
    }
    var body: some View {
        Group {
            if PanelManagement.isAdmin(store) {
                List {
                    PanelSyncSection()
                    Section {
                        Picker("Rol", selection: $role) {
                            Text("Tüm roller").tag("all")
                            ForEach(["admin", "staff", "observer"], id: \.self) { Text(PanelStyle.role($0)).tag($0) }
                        }
                        Picker("Hesap", selection: $state) {
                            Text("Tüm hesaplar").tag("all")
                            Text("Aktif").tag("active")
                            Text("Pasif").tag("inactive")
                        }
                    }
                    Section("\(users.count) kullanıcı") {
                        ForEach(users) { user in
                            Button { editingUser = user } label: { userRow(user) }.buttonStyle(.plain)
                        }
                        if users.isEmpty { Text("Bu filtrelere uygun kullanıcı bulunamadı.").foregroundStyle(.secondary) }
                    }
                }
                .searchable(text: $query, prompt: "Ad, e-posta, ekip veya otel ara")
                .refreshable { await store.refresh() }
            } else { ContentUnavailableView("Yönetici yetkisi gerekiyor", systemImage: "lock.shield", description: Text("Hesapları ve otel erişimlerini yalnızca yöneticiler düzenleyebilir.")) }
        }
        .navigationTitle("Kullanıcılar")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                if PanelManagement.isAdmin(store) { Button { creating = true } label: { Label("Kullanıcı ekle", systemImage: "person.badge.plus") }.disabled(!PanelManagement.canSave(store)) }
            }
        }
        .sheet(isPresented: $creating) { PanelUserComposerView() }
        .sheet(item: $editingUser) { PanelUserComposerView(user: $0) }
    }

    private func userRow(_ user: PanelUser) -> some View {
        let tasks = (store.snapshot?.tasks ?? []).filter { $0.assigneeId == user.id }
        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(user.name).font(.headline)
                Spacer()
                Text(user.active == false ? "Pasif" : "Aktif").font(.caption.weight(.semibold)).foregroundStyle(user.active == false ? Color.secondary : PanelStyle.purple)
                Image(systemName: "pencil").foregroundStyle(.secondary)
            }
            Text(user.email).font(.subheadline).foregroundStyle(.secondary)
            Text("\(PanelStyle.role(user.role)) · \(user.department)").font(.subheadline)
            if user.role == "observer" {
                Text(user.hotelIds.compactMap { id in store.snapshot?.hotels.first { $0.id == id }?.name }.joined(separator: ", ")).font(.caption).foregroundStyle(.secondary)
            } else {
                Text("Tüm oteller · \(tasks.filter { $0.status != "completed" }.count) açık görev").font(.caption).foregroundStyle(.secondary)
            }
        }.padding(.vertical, 5).contentShape(Rectangle())
    }
}

private struct PanelUserForm: Equatable {
    var name: String
    var email: String
    var role: String
    var department: String
    var hotelIDs: Set<String>
    var active: Bool
    var password = ""
    init(user: PanelUser?) {
        name = user?.name ?? ""; email = user?.email ?? ""; role = user?.role ?? "staff"
        department = user?.department ?? ""; hotelIDs = Set(user?.hotelIds ?? []); active = user?.active != false
    }
}

private struct PanelUserComposerView: View {
    @EnvironmentObject private var store: PanelStore
    let user: PanelUser?
    private let initial: PanelUserForm
    @State private var form: PanelUserForm
    @State private var failure: String?
    init(user: PanelUser? = nil) {
        self.user = user
        let fields = PanelUserForm(user: user)
        initial = fields; _form = State(initialValue: fields)
    }
    private var editingSelf: Bool { user?.id == store.snapshot?.user.id }
    private var roleDescription: String {
        switch form.role {
        case "admin": return "Tüm otelleri, görevleri ve kullanıcıları yönetir."
        case "observer": return "Yalnızca seçtiğin otellerin işlerini görüntüler; değişiklik yapamaz."
        default: return "Tüm otelleri ve işleri görür. Kendisine atanan işlerde işlem yapabilir."
        }
    }
    var body: some View {
        PanelManagementEditor(title: user == nil ? "Yeni kullanıcı" : "Kullanıcıyı düzenle", dirty: form != initial, saveTitle: "Kaydet", onSave: save) {
            PanelManagementFailure(message: failure)
            Section("Hesap bilgileri") {
                TextField("Ad soyad", text: $form.name).textContentType(.name)
                TextField("E-posta", text: $form.email).textContentType(.emailAddress).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                TextField("Departman / ekip", text: $form.department)
                Menu("Departman önerileri") {
                    ForEach(Array(Set(["Yönetim", "Otel Yönetimi"] + PanelManagement.departments + (store.snapshot?.users.map(\.department) ?? []))).sorted(), id: \.self) { value in
                        Button(value) { form.department = value }
                    }
                }
            }
            Section {
                Picker("Kullanıcı rolü", selection: $form.role) {
                    ForEach(["admin", "staff", "observer"], id: \.self) { Text(PanelStyle.role($0)).tag($0) }
                }.disabled(editingSelf)
                Text(roleDescription).font(.footnote).foregroundStyle(.secondary)
                if editingSelf { Text("Kendi rolünü ve hesabının aktif durumunu buradan değiştiremezsin.").font(.footnote).foregroundStyle(.secondary) }
            } header: { Text("Yetkiler") }
            if form.role == "observer" {
                Section {
                    ForEach(store.snapshot?.hotels ?? []) { hotel in
                        Toggle(hotel.name, isOn: Binding(get: { form.hotelIDs.contains(hotel.id) }, set: { if $0 { form.hotelIDs.insert(hotel.id) } else { form.hotelIDs.remove(hotel.id) } }))
                    }
                    if store.snapshot?.hotels.isEmpty != false { Text("Önce bir otel oluşturmalısın.").foregroundStyle(.secondary) }
                } header: { Text("Erişebileceği oteller") } footer: { Text("En az bir otel seç. Diğer oteller bu kullanıcıya gösterilmez.") }
            }
            if user == nil {
                Section {
                    SecureField("İlk giriş şifresi", text: $form.password).textContentType(.newPassword).textInputAutocapitalization(.never).autocorrectionDisabled()
                } header: { Text("İlk giriş") } footer: { Text("Şifre 12–256 karakter olmalı. Yeni hesap aktif olarak oluşturulur.") }
            } else {
                Section {
                    Toggle("Hesap aktif", isOn: $form.active).disabled(editingSelf)
                } footer: {
                    Text(form.active ? "Kullanıcı mevcut rolüyle giriş yapabilir." : "Giriş kapatılır; görevler ve işlem geçmişi korunur. Açık görevler ve otel sorumluluğu önce başka birine aktarılmalıdır.")
                }
            }
        }
    }

    private func save() async -> Bool {
        failure = nil
        guard PanelManagement.canSave(store) else { return false }
        let name = PanelManagement.trimmed(form.name)
        let department = PanelManagement.trimmed(form.department)
        guard !name.isEmpty, name.count <= 200, !department.isEmpty, department.count <= 200 else { failure = "Ad soyad ve departmanı doldur. Her biri en fazla 200 karakter olabilir."; return false }
        guard PanelManagement.emailIsPlausible(form.email) else { failure = "Geçerli bir e-posta adresi yaz."; return false }
        guard form.role != "observer" || !form.hotelIDs.isEmpty else { failure = "Otel gözlemcisi için en az bir otel seç."; return false }
        guard user != nil || (12...256).contains(form.password.count) else { failure = "İlk giriş şifresi 12–256 karakter olmalı."; return false }
        let role = editingSelf ? user!.role : form.role
        let draft = PanelUserDraft(name: name, email: PanelManagement.trimmed(form.email).lowercased(), role: role, department: department, hotelIds: role == "observer" ? form.hotelIDs.sorted() : [], password: user == nil ? form.password : nil, active: user == nil ? nil : editingSelf ? user?.active != false : form.active)
        let saved = await store.saveUser(id: user?.id, draft: draft)
        if saved { form.password = "" }
        else { failure = store.errorMessage ?? "Kullanıcı kaydedilemedi. Formdaki bilgiler korundu." }
        return saved
    }
}

struct PanelTeamView: View {
    @EnvironmentObject private var store: PanelStore
    @State private var query = ""
    @State private var department = "all"
    private var team: [PanelUser] {
        (store.snapshot?.users ?? []).filter {
            $0.role != "observer" && $0.active != false && (department == "all" || $0.department == department) && PanelManagement.matches([$0.name, $0.email, $0.department], query: query)
        }.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }
    private var departments: [String] { Array(Set((store.snapshot?.users ?? []).filter { $0.role != "observer" && $0.active != false }.map(\.department))).sorted() }
    var body: some View {
        List {
            PanelSyncSection()
            Section {
                Picker("Ekip", selection: $department) {
                    Text("Tüm ekipler").tag("all")
                    ForEach(departments, id: \.self) { Text($0).tag($0) }
                }
            }
            ForEach(team) { user in
                Section {
                    let tasks = (store.snapshot?.tasks ?? []).filter { $0.assigneeId == user.id }
                    NavigationLink { PanelTeamMemberView(userID: user.id) } label: {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(user.name).font(.headline)
                            Text(user.department).font(.subheadline).foregroundStyle(.secondary)
                            HStack(spacing: 14) {
                                Label("\(tasks.filter { $0.status != "completed" }.count) açık", systemImage: "list.bullet")
                                Label("\(tasks.filter { $0.status == "review" }.count) kontrolde", systemImage: "checkmark.seal")
                            }.font(.caption).foregroundStyle(PanelStyle.purple)
                            Text("\(tasks.filter(PanelManagement.overdue).count) geciken · \(tasks.filter { $0.status == "completed" }.count) tamamlandı").font(.caption).foregroundStyle(.secondary)
                            if let next = PanelStyle.ordered(tasks.filter { $0.status != "completed" }).first {
                                Text("Sıradaki öncelik: \(next.title)").font(.caption).lineLimit(2)
                            }
                        }.padding(.vertical, 5)
                    }
                }
            }
            if team.isEmpty { ContentUnavailableView("Ekip üyesi bulunamadı", systemImage: "person.2", description: Text("Arama veya ekip filtresini değiştir.")) }
        }
        .navigationTitle("Ekip")
        .searchable(text: $query, prompt: "Kişi veya ekip ara")
        .refreshable { await store.refresh() }
    }
}

private struct PanelTeamMemberView: View {
    @EnvironmentObject private var store: PanelStore
    let userID: String
    var body: some View {
        List {
            if let user = store.snapshot?.users.first(where: { $0.id == userID }) {
                Section {
                    Text(user.name).font(.title2.bold())
                    Text("\(PanelStyle.role(user.role)) · \(user.department)").foregroundStyle(.secondary)
                    if !user.email.isEmpty { Text(user.email).textSelection(.enabled) }
                }
                let tasks = PanelStyle.ordered((store.snapshot?.tasks ?? []).filter { $0.assigneeId == userID })
                Section("Görevler · \(tasks.count)") {
                    ForEach(tasks) { task in
                        NavigationLink { PanelTaskDetailView(taskID: task.id) } label: {
                            VStack(alignment: .leading, spacing: 5) {
                                Text(task.title).font(.headline)
                                Text(store.snapshot?.hotels.first { $0.id == task.hotelId }?.name ?? "Otel").font(.subheadline).foregroundStyle(.secondary)
                                Text("Öncelik \(task.priority) · \(PanelStyle.status(task.status))").font(.caption).foregroundStyle(PanelStyle.purple)
                            }.padding(.vertical, 3)
                        }
                    }
                    if tasks.isEmpty { Text("Atanmış görev bulunmuyor.").foregroundStyle(.secondary) }
                }
            } else { ContentUnavailableView("Ekip üyesine erişilemiyor", systemImage: "person.crop.circle.badge.questionmark") }
        }
        .navigationTitle("Ekip üyesi").navigationBarTitleDisplayMode(.inline)
        .refreshable { await store.refresh() }
    }
}
