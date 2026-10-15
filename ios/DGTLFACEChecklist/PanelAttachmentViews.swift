import SwiftUI
import UniformTypeIdentifiers

private struct PanelAttachment: Decodable, Identifiable, Sendable {
    let id: String
    let taskId: String
    let kind: String
    let title: String
    let url: String?
    let fileName: String?
    let mimeType: String?
    let size: Int?
    let userId: String
    let userName: String
    let createdAt: String

    var externalURL: URL? {
        guard let url, let parsed = URL(string: url),
              ["https", "http"].contains(parsed.scheme?.lowercased() ?? ""),
              parsed.host != nil, parsed.user == nil, parsed.password == nil else { return nil }
        return parsed
    }
}

struct PanelBinaryDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.data] }
    var data: Data
    init(data: Data) { self.data = data }
    init(configuration: ReadConfiguration) throws { data = configuration.file.regularFileContents ?? Data() }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: data) }
}

struct PanelAttachmentsView: View {
    @EnvironmentObject private var store: PanelStore
    let taskID: String
    @State private var attachments: [PanelAttachment] = []
    @State private var loaded = false
    @State private var loading = false
    @State private var busy = false
    @State private var visible = false
    @State private var adding = false
    @State private var removing: PanelAttachment?
    @State private var exported = PanelBinaryDocument(data: Data())
    @State private var exportName = "dosya"
    @State private var exportType = UTType.data
    @State private var exporting = false

    private struct Response: Decodable, Sendable { let attachments: [PanelAttachment] }
    private var editable: Bool {
        guard let task = store.task(id: taskID) else { return false }
        return store.canEdit(task) && !store.isSaving && !busy && !loading
    }

    var body: some View {
        List {
            PanelSyncSection()
            Section {
                if loading && !loaded { ProgressView("Ekler alınıyor…") }
                ForEach(attachments) { attachment in attachmentRow(attachment) }
                if loaded && attachments.isEmpty { Text("Bu göreve henüz dosya veya bağlantı eklenmemiş.").foregroundStyle(.secondary) }
                if !loaded && !loading {
                    Text("Dosya listesi alınamadı.").foregroundStyle(.secondary)
                    Button("Yeniden dene") { Task { await load() } }
                }
            } header: { Text("Dosyalar ve bağlantılar · \(attachments.count) / 20") }
              footer: { Text("PDF, PNG, JPG, WEBP, TXT, CSV, DOCX, XLSX, PPTX ve ZIP · Dosya başına en fazla 10 MB.") }
            if let task = store.task(id: taskID), store.canEdit(task) {
                Section {
                    Button { adding = true } label: { Label("Dosya veya bağlantı ekle", systemImage: "plus") }
                        .disabled(!editable || attachments.count >= 20 || !loaded)
                } footer: { Text("Ekler, görevi görmeye yetkili ekip üyeleri ve otel gözlemcileri tarafından görüntülenebilir.") }
            }
        }
        .navigationTitle("Dosyalar ve bağlantılar").navigationBarTitleDisplayMode(.inline)
        .task { visible = true; await load() }
        .onAppear { visible = true }
        .onDisappear { visible = false; exported = PanelBinaryDocument(data: Data()) }
        .onChange(of: store.lastSyncedAt) { _, _ in if visible && !busy && !adding { Task { await load() } } }
        .refreshable { await store.refresh(); await load() }
        .sheet(isPresented: $adding, onDismiss: { Task { await load() } }) { PanelAttachmentComposer(taskID: taskID) }
        .confirmationDialog("Ek kaldırılsın mı?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            if let attachment = removing {
                Button("Kaldır", role: .destructive) { Task { await remove(attachment) } }
            }
        } message: { Text(removing?.title ?? "") }
        .fileExporter(isPresented: $exporting, document: exported, contentType: exportType, defaultFilename: exportName) { result in
            if case .failure(let error) = result { store.errorMessage = error.localizedDescription }
            exported = PanelBinaryDocument(data: Data())
        }
    }

    private func attachmentRow(_ item: PanelAttachment) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(item.title, systemImage: item.kind == "link" ? "link" : "doc")
                .font(.headline).fixedSize(horizontal: false, vertical: true)
            Text("\(item.userName) · \(PanelStyle.timestamp(item.createdAt))").font(.caption).foregroundStyle(.secondary)
            if let size = item.size {
                Text("\(item.fileName ?? "Dosya") · \(ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file))")
                    .font(.caption).foregroundStyle(.secondary)
            }
            HStack {
                if item.kind == "link", let url = item.externalURL {
                    Link("Bağlantıyı aç", destination: url)
                } else if item.kind == "file" {
                    Button("Dosyayı indir") { Task { await download(item) } }.disabled(busy || store.isOffline)
                }
                Spacer()
                if editable && (store.snapshot?.user.role == "admin" || store.snapshot?.user.id == item.userId) {
                    Button("Kaldır", role: .destructive) { removing = item }.disabled(busy)
                }
            }.buttonStyle(.borderless).frame(minHeight: 44)
        }.padding(.vertical, 6)
    }

    private func load() async {
        guard !loading else { return }
        loading = true; defer { loading = false }
        if let result: Response = await store.loadResource(path: "/api/tasks/\(taskID)/attachments") {
            attachments = result.attachments; loaded = true
        }
    }

    private func remove(_ item: PanelAttachment) async {
        guard editable else { return }
        busy = true; defer { busy = false; removing = nil }
        let result: PanelOKResponse? = await store.mutateResource(path: "/api/attachments/\(item.id)", method: "DELETE", body: PanelEmptyBody())
        if result?.ok == true { await load() }
    }

    private func download(_ item: PanelAttachment) async {
        guard !busy else { return }
        busy = true; defer { busy = false }
        if let data = await store.downloadResource(path: "/api/attachments/\(item.id)") {
            let name = (item.fileName ?? "dosya").replacingOccurrences(of: "\\", with: "/").split(separator: "/").last.map(String.init) ?? "dosya"
            exportName = name
            exportType = UTType(filenameExtension: (name as NSString).pathExtension) ?? .data
            exported = PanelBinaryDocument(data: data)
            exporting = true
        }
    }
}

private struct PanelAttachmentComposer: View {
    @EnvironmentObject private var store: PanelStore
    @Environment(\.dismiss) private var dismiss
    let taskID: String
    @State private var kind = "file"
    @State private var title = ""
    @State private var url = ""
    @State private var fileURL: URL?
    @State private var importing = false
    @State private var saving = false
    @State private var discard = false
    @State private var error: String?

    private struct LinkBody: Encodable, Sendable { let kind = "link"; let title: String; let url: String }
    private struct Created: Decodable, Sendable { }
    private var changed: Bool { !title.isEmpty || !url.isEmpty || fileURL != nil }
    private var canSave: Bool {
        guard let task = store.task(id: taskID), store.canEdit(task), !saving, !store.isSaving else { return false }
        if title.count > 200 { return false }
        return kind == "file" ? fileURL != nil : !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && validURL
    }
    private var validURL: Bool {
        let raw = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard raw.count <= 2048, let parsed = URL(string: raw),
              ["http", "https"].contains(parsed.scheme?.lowercased() ?? "") else { return false }
        return parsed.host != nil && parsed.user == nil && parsed.password == nil
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Tür", selection: $kind) { Text("Dosya").tag("file"); Text("Bağlantı").tag("link") }.pickerStyle(.segmented)
                    TextField(kind == "file" ? "Başlık (isteğe bağlı)" : "Başlık", text: $title)
                    if kind == "file" {
                        Button { importing = true } label: { Label(fileURL?.lastPathComponent ?? "Dosya seç", systemImage: "doc.badge.plus") }
                    } else {
                        TextField("https://…", text: $url).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    }
                } footer: { Text(kind == "file" ? "Dosya en fazla 10 MB olabilir. Başlık boşsa dosya adı kullanılır." : "http:// veya https:// ile başlayan bir bağlantı gir.") }
                if let error { Section { Text(error).foregroundStyle(.red) } }
                if store.isOffline { Section { Text("Kaydetmek için internet bağlantısı gerekiyor."); Button("Bağlantıyı yeniden dene") { Task { await store.refresh() } } } }
            }
            .disabled(saving)
            .navigationTitle("Ek oluştur").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Vazgeç") { if changed { discard = true } else { dismiss() } }.disabled(saving) }
                ToolbarItem(placement: .confirmationAction) { Button(saving ? "Kaydediliyor…" : "Kaydet") { Task { await save() } }.disabled(!canSave) }
            }
            .confirmationDialog("Taslak silinsin mi?", isPresented: $discard, titleVisibility: .visible) { Button("Taslağı sil", role: .destructive) { dismiss() } }
            .fileImporter(isPresented: $importing, allowedContentTypes: ["pdf", "png", "jpg", "jpeg", "webp", "txt", "csv", "docx", "xlsx", "pptx", "zip"].compactMap { UTType(filenameExtension: $0) }) { result in
                switch result { case .success(let selected): fileURL = selected; error = nil
                case .failure(let failure): error = failure.localizedDescription }
            }
        }
        .interactiveDismissDisabled(changed || saving)
        .modifier(PanelScenePrivacy())
    }

    private func save() async {
        guard canSave else { return }
        saving = true; error = nil
        let success: Bool
        if kind == "file", let fileURL {
            success = await store.uploadAttachment(taskID: taskID, fileURL: fileURL, title: title.trimmingCharacters(in: .whitespacesAndNewlines))
        } else {
            let result: Created? = await store.mutateResource(path: "/api/tasks/\(taskID)/attachments", method: "POST", body: LinkBody(title: title.trimmingCharacters(in: .whitespacesAndNewlines), url: url.trimmingCharacters(in: .whitespacesAndNewlines)))
            success = result != nil
        }
        saving = false
        if success { dismiss() } else { error = store.errorMessage ?? "Ek kaydedilemedi. Bilgileri kontrol edip tekrar dene." }
    }
}
