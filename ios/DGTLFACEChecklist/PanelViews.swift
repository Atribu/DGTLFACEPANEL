import Combine
import SwiftUI

private enum PanelStyle {
    static let purple = Color(red: 0.529, green: 0.239, blue: 0.671)
    static let dark = Color(red: 20 / 255, green: 15 / 255, blue: 37 / 255)
    static let blue = Color(red: 84 / 255, green: 124 / 255, blue: 207 / 255)

    static func status(_ value: String) -> String {
        switch value {
        case "planned": return "Planlandı"
        case "in_progress": return "Devam ediyor"
        case "waiting": return "Bekliyor"
        case "review": return "Kontrol bekliyor"
        case "completed": return "Tamamlandı"
        default: return value
        }
    }

    static func role(_ value: String) -> String {
        switch value {
        case "admin": return "Yönetici"
        case "staff": return "Personel"
        case "observer": return "Otel gözlemcisi"
        default: return value
        }
    }

    static func ordered(_ tasks: [PanelTask]) -> [PanelTask] {
        tasks.sorted {
            if $0.priority != $1.priority { return $0.priority < $1.priority }
            if $0.title != $1.title { return $0.title.localizedStandardCompare($1.title) == .orderedAscending }
            return $0.id < $1.id
        }
    }

    static func matches(_ task: PanelTask, query: String) -> Bool {
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return true }
        return [task.code, task.title, task.stage, task.department, task.description]
            .joined(separator: " ")
            .range(of: query, options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "tr_TR")) != nil
    }

    static func assignee(_ task: PanelTask, users: [PanelUser]) -> String {
        guard let id = task.assigneeId else { return "Atanmamış" }
        return users.first { $0.id == id }?.name ?? "Sorumlu bilgisi bulunamadı"
    }

    static func timestamp(_ raw: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = formatter.date(from: raw) ?? ISO8601DateFormatter().date(from: raw)
        return date?.formatted(date: .abbreviated, time: .shortened) ?? raw
    }
}

struct PanelRootView: View {
    @EnvironmentObject private var store: PanelStore
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            if store.isSignedIn {
                if store.snapshot != nil { PanelHomeView() }
                else { PanelLoadingView() }
            } else if store.isLoading {
                VStack(spacing: 24) {
                    PanelBrandHeader(subtitle: "Ekip iş takibi")
                    ProgressView("Panel açılıyor…")
                }
                .padding()
            } else {
                PanelLoginView()
            }
        }
        .tint(PanelStyle.purple)
        .task {
            store.setActive(scenePhase == .active)
            await store.start()
        }
        .onChange(of: scenePhase) { _, phase in store.setActive(phase == .active) }
        .alert("İşlem tamamlanamadı", isPresented: Binding(
            get: { store.errorMessage != nil },
            set: { if !$0 { store.errorMessage = nil } }
        )) {
            Button("Tamam", role: .cancel) { store.errorMessage = nil }
        } message: {
            Text(store.errorMessage ?? "Lütfen yeniden deneyin.")
        }
        .modifier(PanelScenePrivacy())
    }
}

/// Keep view and editor state alive while covering app-switcher snapshots.
private struct PanelScenePrivacy: ViewModifier {
    @Environment(\.scenePhase) private var scenePhase

    func body(content: Content) -> some View {
        content
            .privacySensitive()
            .overlay {
                if scenePhase != .active {
                    ZStack {
                        Color(uiColor: .systemBackground).ignoresSafeArea()
                        PanelBrandHeader(subtitle: "Ekip iş takibi").padding()
                    }
                    .accessibilityHidden(true)
                }
            }
    }
}

private struct PanelLoadingView: View {
    @EnvironmentObject private var store: PanelStore
    @State private var showingArchive = false

    var body: some View {
        NavigationStack {
            List {
                Section { PanelBrandHeader(subtitle: "Ekip iş takibi").listRowInsets(EdgeInsets()).listRowBackground(Color.clear) }
                Section {
                    if store.isLoading || store.isRefreshing {
                        ProgressView("Görevler alınıyor…").frame(minHeight: 44)
                    } else {
                        Label("Görevler henüz alınamadı", systemImage: "wifi.exclamationmark")
                        Text(store.statusMessage ?? "İnternet bağlantını kontrol edip yeniden dene.")
                            .font(.subheadline).foregroundStyle(.secondary)
                        Button("Yeniden dene") { Task { await store.refresh() } }.frame(minHeight: 44)
                    }
                }
                Section {
                    Button("Eski cihaz kayıtları") { showingArchive = true }.frame(minHeight: 44)
                    Button("Çıkış yap", role: .destructive) { Task { await store.logout() } }
                        .frame(minHeight: 44).disabled(store.isLoading || store.isSaving)
                }
            }
            .navigationTitle("Ekip işleri")
            .sheet(isPresented: $showingArchive) { PanelLegacyArchiveView() }
        }
    }
}

private struct PanelBrandHeader: View {
    let subtitle: String

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Image("BrandMark")
                .resizable().scaledToFit().frame(width: 42, height: 40)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 6) {
                Text("DGTLFACE").font(.headline).tracking(1.8)
                Text(subtitle).font(.subheadline).foregroundStyle(.white.opacity(0.85))
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .foregroundStyle(.white)
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(LinearGradient(colors: [PanelStyle.dark, PanelStyle.blue, PanelStyle.dark], startPoint: .topLeading, endPoint: .bottomTrailing))
        .clipShape(RoundedRectangle(cornerRadius: 20))
    }
}

private struct PanelLoginView: View {
    @EnvironmentObject private var store: PanelStore
    @State private var email = ""
    @State private var password = ""
    @State private var showingArchive = false
    @FocusState private var focusedField: LoginField?
    private enum LoginField { case email, password }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    PanelBrandHeader(subtitle: "Ekip hesabınla işlerini takip et")
                        .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                }
                Section {
                    TextField("E-posta", text: $email)
                        .keyboardType(.emailAddress).textContentType(.username)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .focused($focusedField, equals: .email).submitLabel(.next)
                        .onSubmit { focusedField = .password }
                        .frame(minHeight: 44)
                    SecureField("Şifre", text: $password)
                        .textContentType(.password).focused($focusedField, equals: .password)
                        .submitLabel(.go).onSubmit { login() }
                        .frame(minHeight: 44)
                    Button(action: login) {
                        HStack {
                            Spacer()
                            if store.isLoading { ProgressView() }
                            Text(store.isLoading ? "Giriş yapılıyor…" : "Giriş yap")
                            Spacer()
                        }.frame(minHeight: 44)
                    }
                    .disabled(!canLogin)
                } header: {
                    Text("Ekip paneli")
                } footer: {
                    Text("Web panelindeki hesabını kullan. Görevler, sorumlular ve ekip yorumları aynı panelden alınır.")
                }
                Section {
                    Button { showingArchive = true } label: {
                        Label("Eski cihaz kayıtları", systemImage: "archivebox")
                            .frame(minHeight: 44)
                    }
                } footer: {
                    Text("Önceki kişisel tiklerin ve notların bu cihazda arşiv olarak saklanır.")
                }
            }
            .navigationTitle("Hoş geldin")
            .sheet(isPresented: $showingArchive) { PanelLegacyArchiveView() }
        }
    }

    private var canLogin: Bool {
        !store.isLoading && !email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !password.isEmpty
    }

    private func login() {
        guard canLogin else { return }
        focusedField = nil
        let enteredEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)
        let enteredPassword = password
        Task {
            await store.login(email: enteredEmail, password: enteredPassword)
            password = ""
        }
    }
}

private struct PanelHomeView: View {
    @EnvironmentObject private var store: PanelStore
    @State private var query = ""
    @State private var showingArchive = false
    @State private var confirmingLogout = false

    var body: some View {
        NavigationStack {
            List {
                if let snapshot = store.snapshot {
                    Section {
                        PanelBrandHeader(subtitle: "\(snapshot.user.name) · \(PanelStyle.role(snapshot.user.role))")
                            .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                    }
                    PanelSyncSection()
                    Section {
                        let hotels = snapshot.hotels.filter {
                            query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || $0.name.localizedStandardContains(query)
                        }
                        ForEach(hotels) { hotel in
                            NavigationLink {
                                PanelHotelView(hotelID: hotel.id)
                            } label: {
                                PanelHotelRow(hotel: hotel, tasks: snapshot.tasks.filter { $0.hotelId == hotel.id })
                            }
                        }
                        if hotels.isEmpty {
                            ContentUnavailableView("Otel bulunamadı", systemImage: "building.2", description: Text(query.isEmpty ? "Hesabına açık bir otel bulunmuyor." : "Başka bir otel adı dene."))
                        }
                    } header: {
                        Text("Oteller")
                    } footer: {
                        Text(snapshot.user.role == "observer" ? "Yetkili olduğun otelleri gözlemci olarak görüntülüyorsun." : "Görevler öncelik puanına göre sıralanır; 1 en önceliklidir.")
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Ekip işleri")
            .searchable(text: $query, prompt: "Otel ara")
            .refreshable { await store.refresh() }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button { Task { await store.refresh() } } label: { Label("Yenile", systemImage: "arrow.clockwise") }
                            .disabled(store.isRefreshing || store.isSaving)
                        Button { showingArchive = true } label: { Label("Eski cihaz kayıtları", systemImage: "archivebox") }
                        Button(role: .destructive) { confirmingLogout = true } label: { Label("Çıkış yap", systemImage: "rectangle.portrait.and.arrow.right") }
                            .disabled(store.isSaving)
                    } label: {
                        Image(systemName: "ellipsis.circle").frame(minWidth: 44, minHeight: 44)
                    }
                    .accessibilityLabel("Hesap ve panel seçenekleri")
                }
            }
            .sheet(isPresented: $showingArchive) { PanelLegacyArchiveView() }
            .confirmationDialog("Hesabından çıkış yapılsın mı?", isPresented: $confirmingLogout, titleVisibility: .visible) {
                Button("Çıkış yap", role: .destructive) { Task { await store.logout() } }
                Button("Vazgeç", role: .cancel) {}
            }
        }
    }
}

private struct PanelSyncSection: View {
    @EnvironmentObject private var store: PanelStore

    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 8) {
                if store.isOffline {
                    Label("Çevrimdışı · Kaydedilmiş görünüm", systemImage: "wifi.slash")
                        .font(.subheadline.weight(.semibold))
                    Text("Bağlantı kurulana kadar görevler salt okunur.")
                        .font(.caption).foregroundStyle(.secondary)
                } else if store.isRefreshing {
                    HStack(spacing: 8) { ProgressView(); Text("Güncelleniyor…").font(.subheadline) }
                } else {
                    Label("Ekip paneli", systemImage: "person.2").font(.subheadline)
                }
                if let date = store.lastSyncedAt {
                    Text("Son güncelleme: \(date.formatted(date: .abbreviated, time: .shortened))")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if let message = store.statusMessage, !message.isEmpty {
                    Text(message).font(.caption).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if store.snapshot?.demo == true {
                    Label("Demo verileri", systemImage: "info.circle").font(.caption)
                }
            }
            .padding(.vertical, 4)
        }
    }
}

private struct PanelHotelRow: View {
    let hotel: PanelHotel
    let tasks: [PanelTask]

    var body: some View {
        let completed = tasks.filter { $0.status == "completed" }.count
        VStack(alignment: .leading, spacing: 9) {
            Text(hotel.name).font(.headline).foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)
            if !hotel.location.isEmpty { Text(hotel.location).font(.caption).foregroundStyle(.secondary) }
            Text("\(completed) / \(tasks.count) görev tamamlandı").font(.subheadline).foregroundStyle(.secondary).monospacedDigit()
            ProgressView(value: Double(completed), total: Double(max(tasks.count, 1))).accessibilityHidden(true)
        }
        .padding(.vertical, 8).accessibilityElement(children: .combine)
    }
}

private struct PanelHotelView: View {
    @EnvironmentObject private var store: PanelStore
    let hotelID: String
    @State private var query = ""

    var body: some View {
        let tasks = PanelStyle.ordered((store.snapshot?.tasks ?? []).filter { $0.hotelId == hotelID })
        let stages = Array(Set(tasks.map(\.stage))).sorted { $0.localizedStandardCompare($1) == .orderedAscending }
        let searching = !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        List {
            PanelSyncSection()
            Section {
                PanelTaskProgress(tasks: tasks)
            }
            if tasks.isEmpty {
                ContentUnavailableView("Henüz görev yok", systemImage: "checklist")
            } else if searching {
                let matches = tasks.filter { PanelStyle.matches($0, query: query) }
                Section {
                    ForEach(matches) { task in
                        NavigationLink { PanelTaskDetailView(taskID: task.id) } label: { PanelTaskRow(task: task) }
                    }
                    if matches.isEmpty { ContentUnavailableView.search(text: query) }
                } header: { Text("Arama sonuçları · \(matches.count)") }
            } else {
                Section {
                    ForEach(stages, id: \.self) { stage in
                        let stageTasks = tasks.filter { $0.stage == stage }
                        NavigationLink {
                            PanelStageView(hotelID: hotelID, stage: stage)
                        } label: {
                            VStack(alignment: .leading, spacing: 8) {
                                Text(stage.isEmpty ? "Diğer işlemler" : stage).font(.headline).foregroundStyle(.primary)
                                    .fixedSize(horizontal: false, vertical: true)
                                Text("\(stageTasks.filter { $0.status == "completed" }.count) / \(stageTasks.count) görev tamamlandı")
                                    .font(.caption).foregroundStyle(.secondary)
                            }.padding(.vertical, 8)
                        }
                    }
                } header: { Text("İşlem grupları") }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(store.snapshot?.hotels.first { $0.id == hotelID }?.name ?? "Otel")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, prompt: "İşlem veya grup ara")
        .refreshable { await store.refresh() }
        .toolbar { PanelRefreshToolbar() }
    }
}

private struct PanelStageView: View {
    @EnvironmentObject private var store: PanelStore
    let hotelID: String
    let stage: String
    @State private var query = ""

    var body: some View {
        let tasks = PanelStyle.ordered((store.snapshot?.tasks ?? []).filter { $0.hotelId == hotelID && $0.stage == stage })
        let filtered = tasks.filter { PanelStyle.matches($0, query: query) }
        List {
            PanelSyncSection()
            Section {
                Text(store.snapshot?.hotels.first { $0.id == hotelID }?.name ?? "Otel")
                    .font(.subheadline).foregroundStyle(PanelStyle.purple)
                Text(stage.isEmpty ? "Diğer işlemler" : stage).font(.title2.weight(.bold))
                    .fixedSize(horizontal: false, vertical: true)
                PanelTaskProgress(tasks: tasks)
            }
            Section {
                ForEach(filtered) { task in
                    NavigationLink { PanelTaskDetailView(taskID: task.id) } label: { PanelTaskRow(task: task) }
                }
                if filtered.isEmpty { ContentUnavailableView("Görev bulunamadı", systemImage: "magnifyingglass") }
            } header: { Text("Görevler · \(filtered.count)") }
              footer: { Text("Öncelik: 1 en önce, 10 en sonra. Kriterlerin işaretlenmesi görevi otomatik tamamlamaz; yönetici onayı gerekir.") }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("İşlem grubu").navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, prompt: "Bu grupta ara")
        .refreshable { await store.refresh() }
        .toolbar { PanelRefreshToolbar() }
    }
}

private struct PanelRefreshToolbar: ToolbarContent {
    @EnvironmentObject private var store: PanelStore

    var body: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Button { Task { await store.refresh() } } label: {
                Image(systemName: "arrow.clockwise").frame(minWidth: 44, minHeight: 44)
            }
            .disabled(store.isRefreshing || store.isSaving)
            .accessibilityLabel("Paneli yenile")
        }
    }
}

private struct PanelTaskProgress: View {
    let tasks: [PanelTask]

    var body: some View {
        let completed = tasks.filter { $0.status == "completed" }.count
        let review = tasks.filter { $0.status == "review" }.count
        VStack(alignment: .leading, spacing: 8) {
            Text("\(completed) / \(tasks.count) görev tamamlandı").font(.headline).monospacedDigit()
            ProgressView(value: Double(completed), total: Double(max(tasks.count, 1))).accessibilityHidden(true)
            Text("\(review) görev yönetici kontrolü bekliyor.").font(.caption).foregroundStyle(.secondary)
        }.padding(.vertical, 6)
    }
}

private struct PanelTaskRow: View {
    @EnvironmentObject private var store: PanelStore
    let task: PanelTask

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(task.code).font(.caption.weight(.semibold))
                Spacer(minLength: 8)
                Text("Öncelik \(task.priority)").font(.caption.weight(.medium))
            }.foregroundStyle(.secondary)
            Text(task.title).font(.body.weight(.semibold)).foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)
            Text(PanelStyle.status(task.status)).font(.subheadline).foregroundStyle(PanelStyle.purple)
            Text("Sorumlu: \(PanelStyle.assignee(task, users: store.snapshot?.users ?? []))")
                .font(.caption).foregroundStyle(.secondary)
            Text("\(task.checklist.filter(\.done).count) / \(task.checklist.count) kriter işaretli")
                .font(.caption).foregroundStyle(.secondary).monospacedDigit()
        }.padding(.vertical, 8).accessibilityElement(children: .combine)
    }
}

private enum PanelTaskSheet: String, Identifiable {
    case comment, waiting, returnForChanges, reopen
    var id: String { rawValue }
}

private struct PanelTaskDetailView: View {
    @EnvironmentObject private var store: PanelStore
    let taskID: String
    @State private var activeSheet: PanelTaskSheet?

    var body: some View {
        Group {
            if let task = store.task(id: taskID) {
                List {
                    PanelSyncSection()
                    taskSummary(task)
                    criteria(task)
                    workflow(task)
                    comments(task)
                }
                .listStyle(.insetGrouped)
                .refreshable { await store.refresh() }
            } else {
                ContentUnavailableView("Göreve erişilemiyor", systemImage: "doc.questionmark", description: Text("Görev kaldırılmış veya erişim yetkin değişmiş olabilir."))
            }
        }
        .navigationTitle("Görev ayrıntısı").navigationBarTitleDisplayMode(.inline)
        .toolbar { PanelRefreshToolbar() }
        .sheet(item: $activeSheet) { sheet in
            if sheet == .comment {
                PanelCommentEditor(taskID: taskID)
            } else {
                PanelReasonEditor(taskID: taskID, action: sheet)
            }
        }
    }

    private func taskSummary(_ task: PanelTask) -> some View {
        Section {
            Text(store.snapshot?.hotels.first { $0.id == task.hotelId }?.name ?? "Otel")
                .font(.subheadline.weight(.semibold)).foregroundStyle(PanelStyle.purple)
            VStack(alignment: .leading, spacing: 8) {
                Text(task.code).font(.caption).foregroundStyle(.secondary)
                Text(task.title).font(.title2.weight(.bold)).fixedSize(horizontal: false, vertical: true)
            }
            PanelDetailField(title: "Durum", value: PanelStyle.status(task.status))
            PanelDetailField(title: "Öncelik", value: "\(task.priority) / 10 · 1 en öncelikli")
            PanelDetailField(title: "Sorumlu", value: PanelStyle.assignee(task, users: store.snapshot?.users ?? []))
            PanelDetailField(title: "Ekip", value: task.department)
            if let dueDate = task.dueDate, !dueDate.isEmpty { PanelDetailField(title: "Son tarih", value: dueDate) }
            if !task.description.isEmpty { PanelDetailField(title: "Açıklama", value: task.description) }
            if !task.hotelInput.isEmpty { PanelDetailField(title: "Otelden gerekli bilgi", value: task.hotelInput) }
            if !task.waitingReason.isEmpty { PanelDetailField(title: "Bekleme nedeni", value: task.waitingReason) }
        }
    }

    private func criteria(_ task: PanelTask) -> some View {
        Section {
            if task.checklist.isEmpty { Text("Bu görev için kriter tanımlanmamış.").foregroundStyle(.secondary) }
            ForEach(task.checklist) { item in
                Button {
                    Task { _ = await store.updateTask(task, payload: .checklist(itemID: item.id, done: !item.done)) }
                } label: {
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: item.done ? "checkmark.circle.fill" : "circle")
                            .font(.title2).foregroundStyle(item.done ? PanelStyle.purple : Color.secondary)
                            .frame(width: 28)
                        Text(item.text).foregroundStyle(.primary).fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                    }
                    .frame(minHeight: 44).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(!editable(task))
                .accessibilityLabel(item.text)
                .accessibilityValue(item.done ? "İşaretli" : "İşaretlenmedi")
                .accessibilityHint(editable(task) ? "Tamamlanma kriterini değiştirir" : "Salt okunur kriter")
            }
        } header: {
            Text("Tamamlanma kriterleri · \(task.checklist.filter(\.done).count) / \(task.checklist.count)")
        } footer: {
            Text(task.status == "review" || task.status == "completed" ? "Kontrol ve tamamlandı aşamalarında kriterler kilitlidir. Yönetici görevi yeniden çalışmaya açabilir." : "Kriter tikleri hazırlığı gösterir. Görev, kontrole gönderilip yönetici tarafından onaylanınca tamamlanır.")
        }
    }

    @ViewBuilder
    private func workflow(_ task: PanelTask) -> some View {
        if store.canEdit(task), task.status != "review", task.status != "completed" {
            Section {
                Menu {
                    Button("Planlandı") { update(task, .status(value: "planned", waitingReason: nil)) }
                    Button("Devam ediyor") { update(task, .status(value: "in_progress", waitingReason: nil)) }
                    Button("Bekliyor…") { activeSheet = .waiting }
                } label: { Label("Durumu değiştir", systemImage: "arrow.triangle.2.circlepath").frame(minHeight: 44) }
                    .disabled(store.isOffline || store.isSaving)
                Button { update(task, .submit) } label: {
                    Label("Yönetici kontrolüne gönder", systemImage: "paperplane").frame(minHeight: 44)
                }
                .disabled(store.isOffline || store.isSaving || !task.checklist.allSatisfy(\.done))
            } header: { Text("İşlemler") }
              footer: { if !task.checklist.allSatisfy(\.done) { Text("Kontrole göndermek için tüm kriterleri işaretle.") } }
        }
        if store.snapshot?.user.role == "admin", store.snapshot?.user.active != false, task.status == "review" {
            Section {
                Button { update(task, .approve) } label: {
                    Label("Onayla ve tamamla", systemImage: "checkmark.seal").frame(minHeight: 44)
                }
                .disabled(store.isOffline || store.isSaving || !task.checklist.allSatisfy(\.done))
                Button { activeSheet = .returnForChanges } label: {
                    Label("Düzeltme için geri gönder", systemImage: "arrow.uturn.backward").frame(minHeight: 44)
                }.disabled(store.isOffline || store.isSaving)
            } header: { Text("Yönetici kontrolü") }
        }
        if store.snapshot?.user.role == "admin", store.snapshot?.user.active != false, task.status == "completed" {
            Section {
                Button { activeSheet = .reopen } label: {
                    Label("Görevi yeniden aç", systemImage: "arrow.counterclockwise").frame(minHeight: 44)
                }.disabled(store.isOffline || store.isSaving)
            }
        }
    }

    private func comments(_ task: PanelTask) -> some View {
        let comments = (store.snapshot?.comments ?? []).filter { $0.taskId == taskID }.sorted {
            $0.createdAt == $1.createdAt ? $0.id < $1.id : $0.createdAt < $1.createdAt
        }
        return Section {
            ForEach(comments) { comment in
                VStack(alignment: .leading, spacing: 8) {
                    Text(comment.userName).font(.subheadline.weight(.semibold))
                    Text(PanelStyle.timestamp(comment.createdAt)).font(.caption).foregroundStyle(.secondary)
                    Text(comment.body).font(.body).fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
                }.padding(.vertical, 6)
            }
            if comments.isEmpty { Text("Henüz ekip yorumu yok.").foregroundStyle(.secondary) }
            if store.canComment(task) {
                Button { activeSheet = .comment } label: {
                    Label("Yorum / açıklama ekle", systemImage: "square.and.pencil").frame(minHeight: 44)
                }.disabled(store.isOffline || store.isSaving)
            }
        } header: { Text("Ekip yorumları · \(comments.count)") }
          footer: { Text("Yorumlar bu görevi görüntüleyebilen ekip üyeleri ve otel gözlemcileri tarafından görülebilir.") }
    }

    private func editable(_ task: PanelTask) -> Bool {
        store.canEdit(task) && !store.isOffline && !store.isSaving && task.status != "review" && task.status != "completed"
    }

    private func update(_ task: PanelTask, _ payload: PanelTaskMutation) {
        Task { _ = await store.updateTask(task, payload: payload) }
    }
}

private struct PanelDetailField: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            Text(value).font(.body).fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
        }.padding(.vertical, 3).accessibilityElement(children: .combine)
    }
}

private struct PanelCommentEditor: View {
    @EnvironmentObject private var store: PanelStore
    @Environment(\.dismiss) private var dismiss
    let taskID: String
    @State private var bodyText = ""
    @State private var requestID = UUID().uuidString
    @State private var failure: String?
    @State private var confirmingDiscard = false

    private var dirty: Bool { !bodyText.isEmpty }
    private var trimmed: String { bodyText.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var allowed: Bool {
        guard let task = store.task(id: taskID) else { return false }
        return store.canComment(task) && !store.isOffline && !store.isSaving
    }

    var body: some View {
        NavigationStack {
            Form {
                if let task = store.task(id: taskID) {
                    Section { PanelDetailField(title: task.code, value: task.title) }
                }
                Section {
                    TextEditor(text: $bodyText).frame(minHeight: 220)
                        .accessibilityLabel("Ekip yorumu")
                        .disabled(store.isSaving)
                    Text("\(trimmed.count) / 4000 karakter").font(.caption).foregroundStyle(.secondary)
                } header: { Text("Yorum / açıklama") }
                  footer: { Text("Gönderdiğin açıklama ekip panelinde bu görevin yorumlarına eklenir.") }
                if store.isOffline {
                    Section {
                        Label("Çevrimdışısın. Taslağın açık kalacak; bağlantı gelince gönderebilirsin.", systemImage: "wifi.slash").font(.subheadline)
                        Button(store.isRefreshing ? "Bağlanılıyor…" : "Bağlantıyı yeniden dene") { Task { await store.refresh() } }
                            .frame(minHeight: 44).disabled(store.isRefreshing || store.isSaving)
                    }
                }
                if let failure { Section { Text(failure).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true) } }
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Yorum ekle").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Vazgeç") { if dirty { confirmingDiscard = true } else { dismiss() } }
                        .frame(minHeight: 44).disabled(store.isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(store.isSaving ? "Gönderiliyor…" : "Gönder") {
                        Task {
                            failure = nil
                            if await store.addComment(taskID: taskID, body: trimmed, requestID: requestID) {
                                dismiss()
                            } else {
                                failure = store.errorMessage ?? "Yorum gönderilemedi. Taslağın korundu; yeniden deneyebilirsin."
                            }
                        }
                    }
                    .frame(minHeight: 44).fontWeight(.semibold)
                    .disabled(!allowed || trimmed.isEmpty || trimmed.count > 4000)
                }
            }
            .confirmationDialog("Yorum taslağı silinsin mi?", isPresented: $confirmingDiscard, titleVisibility: .visible) {
                Button("Taslağı sil", role: .destructive) { dismiss() }
                Button("Yazmaya devam et", role: .cancel) {}
            }
        }
        .interactiveDismissDisabled(dirty || store.isSaving)
        .onChange(of: bodyText) { _, _ in requestID = UUID().uuidString; failure = nil }
        .modifier(PanelScenePrivacy())
    }
}

private struct PanelReasonEditor: View {
    @EnvironmentObject private var store: PanelStore
    @Environment(\.dismiss) private var dismiss
    let taskID: String
    let action: PanelTaskSheet
    @State private var reason = ""
    @State private var failure: String?
    @State private var confirmingDiscard = false

    private var title: String {
        switch action {
        case .waiting: return "Beklemeye al"
        case .returnForChanges: return "Düzeltme iste"
        case .reopen: return "Görevi yeniden aç"
        case .comment: return "Açıklama"
        }
    }
    private var trimmed: String { reason.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var allowed: Bool {
        guard let task = store.task(id: taskID), !store.isOffline, !store.isSaving else { return false }
        switch action {
        case .waiting: return store.canEdit(task) && task.status != "review" && task.status != "completed"
        case .returnForChanges: return store.snapshot?.user.role == "admin" && store.snapshot?.user.active != false && task.status == "review"
        case .reopen: return store.snapshot?.user.role == "admin" && store.snapshot?.user.active != false && task.status == "completed"
        case .comment: return false
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                if let task = store.task(id: taskID) { Section { PanelDetailField(title: task.code, value: task.title) } }
                Section {
                    TextEditor(text: $reason).frame(minHeight: 180).accessibilityLabel("İşlem nedeni")
                        .disabled(store.isSaving)
                    Text("\(trimmed.count) / 2000 karakter").font(.caption).foregroundStyle(.secondary)
                } header: { Text("Neden") }
                  footer: { Text("Ekibin değişikliği anlayabilmesi için kısa bir açıklama yaz.") }
                if let failure { Section { Text(failure).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true) } }
                if store.isOffline {
                    Section {
                        Label("Çevrimdışı · İşlem gönderilemiyor", systemImage: "wifi.slash")
                        Button(store.isRefreshing ? "Bağlanılıyor…" : "Bağlantıyı yeniden dene") { Task { await store.refresh() } }
                            .frame(minHeight: 44).disabled(store.isRefreshing || store.isSaving)
                    }
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle(title).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Vazgeç") { if reason.isEmpty { dismiss() } else { confirmingDiscard = true } }
                        .frame(minHeight: 44).disabled(store.isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(store.isSaving ? "Kaydediliyor…" : "Kaydet") { save() }
                        .frame(minHeight: 44).fontWeight(.semibold)
                        .disabled(!allowed || trimmed.isEmpty || trimmed.count > 2000)
                }
            }
            .confirmationDialog("Açıklamadan vazgeçilsin mi?", isPresented: $confirmingDiscard, titleVisibility: .visible) {
                Button("Taslağı sil", role: .destructive) { dismiss() }
                Button("Yazmaya devam et", role: .cancel) {}
            }
        }
        .interactiveDismissDisabled(!reason.isEmpty || store.isSaving)
        .modifier(PanelScenePrivacy())
    }

    private func save() {
        guard allowed, let task = store.task(id: taskID) else { return }
        let payload: PanelTaskMutation
        switch action {
        case .waiting: payload = .status(value: "waiting", waitingReason: trimmed)
        case .returnForChanges: payload = .returnForChanges(reason: trimmed)
        case .reopen: payload = .reopen(reason: trimmed)
        case .comment: return
        }
        Task {
            failure = nil
            if await store.updateTask(task, payload: payload) { dismiss() }
            else { failure = store.errorMessage ?? "Değişiklik kaydedilemedi. Açıklaman korundu." }
        }
    }
}

@MainActor
final class PanelLegacyArchiveReader: ObservableObject {
    struct Record {
        let catalog: ChecklistCatalog
        let hotels: [ChecklistHotel]
        var totalCount: Int { catalog.items.count }
    }
    private struct SavedHotel: Decodable {
        let id: String
        let name: String
        let checkedIDs: [String]
        let notes: [String: String]
    }
    private struct V2: Decodable {
        let schemaVersion: Int
        let hotels: [SavedHotel]
    }
    private struct V1: Decodable {
        let schemaVersion: Int
        let checkedIDs: [String]
    }
    @Published private(set) var record: Record?
    @Published private(set) var loadError: String?

    init() { load() }

    // This archive never creates directories, seeds hotels, migrates files or
    // passes records to PanelStore. A malformed v2 file does not fall back to v1.
    func load() {
        do {
            guard let catalogURL = Bundle.main.url(forResource: "checklist", withExtension: "json"),
                  let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
                throw ChecklistError.invalidCatalog
            }
            let catalog = try ChecklistCatalog.decode(Data(contentsOf: catalogURL))
            let knownIDs = Set(catalog.items.map(\.id))
            let directory = support.appendingPathComponent("DGTLFACEChecklist", isDirectory: true)
            let hotels: [ChecklistHotel]
            if let bytes = try readIfPresent(directory.appendingPathComponent("progress-v2.json")) {
                let saved = try JSONDecoder().decode(V2.self, from: bytes)
                guard saved.schemaVersion == 2 else { throw ChecklistError.unsupportedProgressVersion }
                var hotelIDs = Set<String>()
                hotels = try saved.hotels.map { hotel in
                    guard !hotel.id.isEmpty, hotelIDs.insert(hotel.id).inserted,
                          !hotel.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                          Set(hotel.checkedIDs).count == hotel.checkedIDs.count else {
                        throw ChecklistError.invalidProgress
                    }
                    return ChecklistHotel(id: hotel.id, name: hotel.name,
                                          checkedIDs: Set(hotel.checkedIDs).intersection(knownIDs),
                                          notes: hotel.notes.filter { knownIDs.contains($0.key) })
                }
            } else if let bytes = try readIfPresent(directory.appendingPathComponent("progress-v1.json")) {
                let saved = try JSONDecoder().decode(V1.self, from: bytes)
                guard saved.schemaVersion == 1 else { throw ChecklistError.unsupportedProgressVersion }
                guard Set(saved.checkedIDs).count == saved.checkedIDs.count else { throw ChecklistError.invalidProgress }
                hotels = [ChecklistHotel(id: "legacy-personal", name: "Mevcut işlerim",
                                         checkedIDs: Set(saved.checkedIDs).intersection(knownIDs), notes: [:])]
            } else {
                hotels = []
            }
            record = Record(catalog: catalog, hotels: hotels)
            loadError = nil
        } catch {
            record = nil
            loadError = "Eski kayıt dosyaları değiştirilmedi. \(error.localizedDescription)"
        }
    }

    private func readIfPresent(_ url: URL) throws -> Data? {
        do { return try Data(contentsOf: url) }
        catch let error as CocoaError where error.code == .fileReadNoSuchFile { return nil }
    }
}

private struct PanelLegacyArchiveView: View {
    @EnvironmentObject private var archive: PanelLegacyArchiveReader
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if let store = archive.record {
                    List {
                        Section {
                            Label("Bu cihazın eski kayıtları · Salt okunur", systemImage: "archivebox")
                            Text("Buradaki kişisel tikler ve notlar ekip paneline aktarılmaz.")
                                .font(.subheadline).foregroundStyle(.secondary)
                        }
                        Section {
                            if store.hotels.isEmpty {
                                Text("Bu cihazda eski kişisel kayıt bulunmuyor.").foregroundStyle(.secondary)
                            }
                            ForEach(store.hotels) { hotel in
                                NavigationLink {
                                    PanelLegacyHotelView(hotel: hotel, catalog: store.catalog)
                                } label: {
                                    VStack(alignment: .leading, spacing: 7) {
                                        Text(hotel.name).font(.headline)
                                        Text("\(hotel.checkedIDs.count) / \(store.totalCount) işlem işaretli · \(hotel.notes.count) not")
                                            .font(.caption).foregroundStyle(.secondary)
                                    }.padding(.vertical, 6)
                                }
                            }
                        } header: { Text("Cihaz kayıtları") }
                    }.listStyle(.insetGrouped)
                } else {
                    ContentUnavailableView {
                        Label("Cihaz arşivi açılamadı", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(archive.loadError ?? "Kayıtların değiştirilmedi.")
                    } actions: {
                        Button("Tekrar dene", action: archive.load).frame(minHeight: 44)
                    }
                }
            }
            .navigationTitle("Eski cihaz kayıtları").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Kapat") { dismiss() }.frame(minHeight: 44) }
            }
        }
        .modifier(PanelScenePrivacy())
    }
}

private struct PanelLegacyHotelView: View {
    let hotel: ChecklistHotel
    let catalog: ChecklistCatalog

    var body: some View {
        List {
            Section { Label("Cihaz arşivi · Salt okunur", systemImage: "archivebox") }
            ForEach(catalog.groups) { group in
                Section {
                    ForEach(group.items) { item in
                        HStack(alignment: .top, spacing: 12) {
                            Image(systemName: hotel.checkedIDs.contains(item.id) ? "checkmark.circle.fill" : "circle")
                                .foregroundStyle(hotel.checkedIDs.contains(item.id) ? PanelStyle.purple : Color.secondary)
                                .font(.title2).accessibilityHidden(true)
                            VStack(alignment: .leading, spacing: 8) {
                                Text(item.code).font(.caption).foregroundStyle(.secondary)
                                Text(item.title).font(.body.weight(.medium)).fixedSize(horizontal: false, vertical: true)
                                Text(hotel.checkedIDs.contains(item.id) ? "İşaretli" : "İşaretlenmedi").font(.caption).foregroundStyle(.secondary)
                                if let note = hotel.notes[item.id], !note.isEmpty {
                                    Text(note).font(.subheadline).fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
                                }
                            }
                        }.padding(.vertical, 8)
                    }
                } header: { Text(group.title).textCase(nil) }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(hotel.name).navigationBarTitleDisplayMode(.inline)
    }
}
