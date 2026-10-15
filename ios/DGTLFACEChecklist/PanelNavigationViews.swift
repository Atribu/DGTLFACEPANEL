import SwiftUI

struct PanelHomeView: View {
    var body: some View {
        TabView {
            NavigationStack { PanelOverviewView() }
                .tabItem { Label("Genel bakış", systemImage: "square.grid.2x2") }
            PanelHotelsHomeView()
                .tabItem { Label("Oteller", systemImage: "building.2") }
            NavigationStack { PanelAllTasksView() }
                .tabItem { Label("Görevler", systemImage: "checklist") }
            NavigationStack { PanelCalendarView() }
                .tabItem { Label("Takvim", systemImage: "calendar") }
            NavigationStack { PanelMoreView() }
                .tabItem { Label("Diğer", systemImage: "ellipsis.circle") }
        }
    }
}

private struct PanelOverviewView: View {
    @EnvironmentObject private var store: PanelStore
    @State private var composing = false

    var body: some View {
        List {
            if let snapshot = store.snapshot {
                Section {
                    PanelBrandHeader(subtitle: "\(snapshot.user.name) · \(PanelStyle.role(snapshot.user.role))")
                        .listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                }
                PanelSyncSection()
                Section("İşlerin durumu") {
                    metric("Açık işler", count: snapshot.tasks.filter { $0.status != "completed" }.count, filter: "open", symbol: "tray.full")
                    metric("Geciken işler", count: snapshot.tasks.filter { PanelTaskSelection.overdue($0) }.count, filter: "overdue", symbol: "clock.badge.exclamationmark")
                    metric("Kontrol bekleyen", count: snapshot.tasks.filter { $0.status == "review" }.count, filter: "review", symbol: "checkmark.seal")
                    metric("Tamamlanan", count: snapshot.tasks.filter { $0.status == "completed" }.count, filter: "completed", symbol: "checkmark.circle")
                }
                Section(snapshot.user.role == "staff" ? "Öncelikli işlerim" : "Öncelikli işler") {
                    let tasks = PanelStyle.ordered(snapshot.tasks.filter {
                        $0.status != "completed" && (snapshot.user.role != "staff" || $0.assigneeId == snapshot.user.id)
                    })
                    ForEach(Array(tasks.prefix(8))) { task in
                        PanelTaskNavigationRow(task: task)
                    }
                    if tasks.isEmpty { Text("Şu anda açık görev bulunmuyor.").foregroundStyle(.secondary) }
                    NavigationLink("Tüm görevler") { PanelAllTasksView(initialStatus: "open") }
                }
                Section("Hızlı erişim") {
                    NavigationLink { PanelNotificationsView() } label: { Label("Bildirimler", systemImage: "bell") }
                    NavigationLink { PanelReportsView() } label: { Label("Otel raporları", systemImage: "chart.bar") }
                    NavigationLink { PanelActivityView() } label: { Label("Son hareketler", systemImage: "clock.arrow.circlepath") }
                }
            }
        }
        .navigationTitle("Genel bakış")
        .refreshable { await store.refresh() }
        .toolbar {
            PanelRefreshToolbar()
            if store.snapshot?.user.role == "admin" {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { composing = true } label: { Image(systemName: "plus") }
                        .accessibilityLabel("Yeni görev").disabled(store.isOffline || store.isSaving)
                }
            }
        }
        .sheet(isPresented: $composing) { PanelTaskComposerView() }
    }

    private func metric(_ title: String, count: Int, filter: String, symbol: String) -> some View {
        NavigationLink { PanelAllTasksView(initialStatus: filter) } label: {
            HStack { Label(title, systemImage: symbol); Spacer(); Text("\(count)").font(.headline).monospacedDigit() }
                .padding(.vertical, 4)
        }
    }
}

struct PanelTaskNavigationRow: View {
    @EnvironmentObject private var store: PanelStore
    let task: PanelTask
    var body: some View {
        NavigationLink { PanelTaskDetailView(taskID: task.id) } label: {
            VStack(alignment: .leading, spacing: 4) {
                Text(store.snapshot?.hotels.first { $0.id == task.hotelId }?.name ?? "Otel")
                    .font(.caption.weight(.semibold)).foregroundStyle(PanelStyle.purple)
                PanelTaskRow(task: task)
            }
        }
    }
}

struct PanelAllTasksView: View {
    @EnvironmentObject private var store: PanelStore
    @State private var selection: PanelTaskSelection
    @State private var filtersExpanded = false
    @State private var composing = false

    init(initialStatus: String = "all") {
        _selection = State(initialValue: PanelTaskSelection(status: initialStatus))
    }

    var body: some View {
        List {
            PanelSyncSection()
            Section {
                DisclosureGroup("Filtreler ve sıralama", isExpanded: $filtersExpanded) {
                    PanelTaskFilters(selection: $selection)
                    Picker("Sıralama", selection: $selection.sort) {
                        Text("Öncelik").tag("priority")
                        Text("Son tarih").tag("due")
                        Text("Son güncellenen").tag("updated")
                    }
                    Button("Filtreleri temizle") { selection = PanelTaskSelection() }
                }
            }
            let tasks = selection.apply(store.snapshot?.tasks ?? [], userID: store.snapshot?.user.id ?? "")
            Section("Görevler · \(tasks.count)") {
                ForEach(tasks) { task in PanelTaskNavigationRow(task: task) }
                if tasks.isEmpty { ContentUnavailableView("Görev bulunamadı", systemImage: "line.3.horizontal.decrease.circle", description: Text("Aramayı veya filtreleri değiştirebilirsin.")) }
            }
        }
        .navigationTitle("Görevler")
        .searchable(text: $selection.query, prompt: "İşlem, kod veya açıklama ara")
        .refreshable { await store.refresh() }
        .toolbar {
            PanelRefreshToolbar()
            if store.snapshot?.user.role == "admin" {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { composing = true } label: { Image(systemName: "plus") }
                        .accessibilityLabel("Yeni görev").disabled(store.isOffline || store.isSaving)
                }
            }
        }
        .sheet(isPresented: $composing) { PanelTaskComposerView() }
    }
}

private struct PanelTaskFilters: View {
    @EnvironmentObject private var store: PanelStore
    @Binding var selection: PanelTaskSelection
    var body: some View {
        Picker("Otel", selection: $selection.hotelID) {
            Text("Tüm oteller").tag("")
            ForEach(store.snapshot?.hotels ?? []) { Text($0.name).tag($0.id) }
        }
        Picker("Durum", selection: $selection.status) {
            Text("Tümü").tag("all")
            Text("Açık işler").tag("open")
            Text("Gecikenler").tag("overdue")
            ForEach(["planned", "in_progress", "waiting", "review", "completed"], id: \.self) {
                Text(PanelStyle.status($0)).tag($0)
            }
        }
        Picker("Sorumlu", selection: $selection.assignee) {
            Text("Herkes").tag("")
            if store.snapshot?.user.role != "observer" { Text("Bana atananlar").tag("mine") }
            Text("Atanmamış").tag("unassigned")
            ForEach((store.snapshot?.users ?? []).filter { $0.role != "observer" }) {
                Text($0.name).tag("user:" + $0.id)
            }
        }
        Picker("Departman", selection: $selection.department) {
            Text("Tümü").tag("")
            ForEach(Array(Set((store.snapshot?.tasks ?? []).map(\.department))).sorted(), id: \.self) { Text($0).tag($0) }
        }
        Picker("İşlem grubu", selection: $selection.stage) {
            Text("Tümü").tag("")
            ForEach(Array(Set((store.snapshot?.tasks ?? []).map(\.stage))).sorted(), id: \.self) { Text($0).tag($0) }
        }
        Picker("Öncelik", selection: $selection.priority) {
            Text("Tümü").tag(0)
            ForEach(1...10, id: \.self) { Text("\($0)").tag($0) }
        }
    }
}

private struct PanelCalendarView: View {
    @EnvironmentObject private var store: PanelStore
    @State private var date = Date()
    @State private var scope = "day"
    @State private var selection = PanelTaskSelection(status: "open")
    @State private var filtersExpanded = false
    @State private var composing = false

    private var tasks: [PanelTask] {
        let filtered = selection.apply(store.snapshot?.tasks ?? [], userID: store.snapshot?.user.id ?? "")
        let day = PanelTaskSelection.dayKey(date)
        return filtered.filter { task in
            guard let due = task.dueDate.map({ String($0.prefix(10)) }) else { return scope == "undated" }
            if scope == "month" { return due.prefix(7) == day.prefix(7) }
            return scope == "day" && due == day
        }.sorted { ($0.dueDate ?? "", $0.priority, $0.id) < ($1.dueDate ?? "", $1.priority, $1.id) }
    }

    var body: some View {
        List {
            PanelSyncSection()
            Section {
                Picker("Görünüm", selection: $scope) {
                    Text("Gün").tag("day"); Text("Ay").tag("month"); Text("Tarihsiz").tag("undated")
                }.pickerStyle(.segmented)
                if scope != "undated" {
                    DatePicker("Tarih", selection: $date, displayedComponents: .date)
                        .datePickerStyle(.graphical)
                        .environment(\.calendar, PanelTaskSelection.calendar)
                        .environment(\.timeZone, PanelTaskSelection.calendar.timeZone)
                    Button("Bugüne dön") { date = Date() }
                }
                DisclosureGroup("Takvim filtreleri", isExpanded: $filtersExpanded) { PanelTaskFilters(selection: $selection) }
            }
            Section("\(scope == "undated" ? "Tarihsiz görevler" : scope == "month" ? "Seçili ay" : "Seçili gün") · \(tasks.count)") {
                ForEach(tasks) { task in PanelTaskNavigationRow(task: task) }
                if tasks.isEmpty { Text("Bu görünümde görev bulunmuyor.").foregroundStyle(.secondary) }
            }
        }
        .navigationTitle("Takvim")
        .refreshable { await store.refresh() }
        .toolbar {
            PanelRefreshToolbar()
            if store.snapshot?.user.role == "admin" {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { composing = true } label: { Image(systemName: "plus") }
                        .accessibilityLabel("Yeni görev").disabled(store.isOffline || store.isSaving)
                }
            }
        }
        .sheet(isPresented: $composing) { PanelTaskComposerView() }
    }
}

private struct PanelMoreView: View {
    @EnvironmentObject private var store: PanelStore
    @State private var archive = false
    @State private var logout = false
    var body: some View {
        List {
            if let user = store.snapshot?.user {
                Section { Text(user.name).font(.headline); Text("\(user.email) · \(PanelStyle.role(user.role))").font(.caption).foregroundStyle(.secondary) }
                Section("Panel") {
                    NavigationLink { PanelNotificationsView() } label: { Label("Bildirimler", systemImage: "bell") }
                    NavigationLink { PanelReportsView() } label: { Label("Otel raporları", systemImage: "chart.bar") }
                    NavigationLink { PanelActivityView() } label: { Label("Son hareketler", systemImage: "clock.arrow.circlepath") }
                    if user.role != "observer" {
                        NavigationLink { PanelTeamView() } label: { Label("Ekip", systemImage: "person.2") }
                    }
                }
                if user.role == "admin" {
                    Section("Yönetim") {
                        NavigationLink { PanelHotelManagementView() } label: { Label("Otel yönetimi", systemImage: "building.2.crop.circle") }
                        NavigationLink { PanelUsersView() } label: { Label("Kullanıcılar", systemImage: "person.badge.key") }
                        NavigationLink { PanelRecurrencesView() } label: { Label("Düzenli işler", systemImage: "repeat") }
                        NavigationLink { PanelPermissionsView() } label: { Label("Yetkiler", systemImage: "lock.shield") }
                    }
                }
                Section("Hesap ve cihaz") {
                    Button { archive = true } label: { Label("Eski cihaz kayıtları", systemImage: "archivebox") }
                    Button(role: .destructive) { logout = true } label: { Label("Çıkış yap", systemImage: "rectangle.portrait.and.arrow.right") }
                        .disabled(store.isSaving || store.isLoading)
                }
                Section { Text("DGTLFACE İşler · \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "")").font(.caption).foregroundStyle(.secondary) }
            }
        }
        .navigationTitle("Diğer")
        .sheet(isPresented: $archive) { PanelLegacyArchiveView() }
        .confirmationDialog("Hesabından çıkış yapılsın mı?", isPresented: $logout, titleVisibility: .visible) {
            Button("Çıkış yap", role: .destructive) { Task { await store.logout() } }
        }
    }
}

private struct PanelPermissionsView: View {
    var body: some View {
        List {
            Section("Yönetici") { Text("Tüm otel ve görevleri yönetir. Görev oluşturur, sorumlu ve öncelik belirler. Kullanıcıları, otelleri ve düzenli işleri yönetir; kontrole gelen işleri onaylar veya geri gönderir.") }
            Section("Personel") { Text("Tüm otelleri ve görevleri görür. Kendisine atanmış açık görevlerde kriter, durum, yorum ve dosya işlemlerini yapar; işi yönetici kontrolüne gönderir.") }
            Section("Otel gözlemcisi") { Text("Yalnızca hesabına bağlı otellerin görevlerini, yorumlarını, dosyalarını ve raporlarını görüntüler. Kayıtları değiştiremez.") }
            Section("Ortak çalışma") { Text("Kriter tikleri işi otomatik tamamlamaz. Tüm kriterler hazır olunca iş kontrole gönderilir; yönetici onayıyla tamamlanır. Kontrol ve tamamlandı aşamalarında kriterler ve dosyalar kilitlidir.") }
        }.navigationTitle("Yetkiler").navigationBarTitleDisplayMode(.inline)
    }
}

private struct PanelActivity: Decodable, Identifiable, Sendable {
    let id: String
    let taskId: String?
    let hotelId: String
    let userName: String
    let message: String
    let createdAt: String
}

struct PanelActivityView: View {
    @EnvironmentObject private var store: PanelStore
    var taskID: String? = nil
    @State private var activities: [PanelActivity] = []
    @State private var loading = false
    @State private var loaded = false
    @State private var visible = false
    private struct Response: Decodable, Sendable { let activities: [PanelActivity] }
    var body: some View {
        List {
            PanelSyncSection()
            Section {
                ForEach(activities) { activity in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(activity.message).fixedSize(horizontal: false, vertical: true)
                        Text("\(activity.userName) · \(PanelStyle.timestamp(activity.createdAt))").font(.caption).foregroundStyle(.secondary)
                        if taskID == nil, let id = activity.taskId, store.task(id: id) != nil {
                            NavigationLink("Görevi aç") { PanelTaskDetailView(taskID: id) }.font(.subheadline)
                        }
                    }.padding(.vertical, 4)
                }
                if loading && activities.isEmpty { ProgressView("Hareketler alınıyor…") }
                else if activities.isEmpty {
                    Text(loaded ? "Henüz hareket yok." : "Hareketler alınamadı. Yeniden deneyebilirsin.").foregroundStyle(.secondary)
                }
                Button("Yenile") { Task { await load() } }.disabled(loading)
            }
        }
        .navigationTitle(taskID == nil ? "Son hareketler" : "Görev geçmişi")
        .navigationBarTitleDisplayMode(.inline)
        .task { visible = true; await load() }
        .onAppear { visible = true }
        .onDisappear { visible = false }
        .onChange(of: store.lastSyncedAt) { _, _ in if visible { Task { await load() } } }
        .refreshable { await store.refresh(); await load() }
    }
    private func load() async {
        guard !loading else { return }
        loading = true
        defer { loading = false }
        let path = taskID.map { "/api/tasks/\($0)" } ?? "/api/bootstrap"
        if let result: Response = await store.loadResource(path: path) {
            activities = result.activities.sorted { $0.createdAt > $1.createdAt }; loaded = true
        }
    }
}
