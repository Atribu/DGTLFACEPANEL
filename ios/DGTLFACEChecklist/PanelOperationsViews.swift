import SwiftUI
import UIKit
import UniformTypeIdentifiers

// These screens keep server-owned resources in memory only. The shared store
// validates the session and discards replies from a previous account.
private enum PanelOperationsDate {
    static var calendar: Calendar {
        var value = Calendar(identifier: .gregorian)
        value.timeZone = TimeZone(identifier: "Europe/Istanbul")!
        return value
    }

    static func day(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    static func parse(_ day: String) -> Date? {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.isLenient = false
        return formatter.date(from: day)
    }

    static func label(_ day: String?) -> String {
        guard let day, let date = parse(day) else { return "Tarih yok" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "tr_TR")
        formatter.timeZone = calendar.timeZone
        formatter.dateStyle = .medium
        return formatter.string(from: date)
    }

    static var monthStart: Date {
        calendar.dateInterval(of: .month, for: Date())?.start ?? Date()
    }

    static var monthEnd: Date {
        let end = calendar.dateInterval(of: .month, for: Date())?.end ?? Date()
        return calendar.date(byAdding: .day, value: -1, to: end) ?? end
    }
}

private struct PanelOperationsConnection: View {
    @EnvironmentObject private var store: PanelStore

    var body: some View {
        if store.isOffline {
            Section {
                Label("Çevrimdışı · Görüntülenen bilgiler güncel olmayabilir", systemImage: "wifi.slash")
                    .font(.subheadline).foregroundStyle(.secondary)
                Button("Bağlantıyı yeniden dene") { Task { await store.refresh() } }
                    .disabled(store.isRefreshing)
            }
        }
    }
}

private struct PanelOperationTaskDestination: Hashable {
    let id: String
}

// MARK: Reports

private struct PanelReportEnvelope: Decodable, Sendable {
    let report: PanelHotelReport
}

private struct PanelHotelReport: Decodable, Sendable {
    struct Hotel: Decodable, Sendable {
        let id: String
        let name: String
        let location: String
        let services: [String]
    }
    struct Filters: Decodable, Sendable {
        let hotelId: String
        let from: String
        let to: String
        let includeUndated: Bool

        var query: String {
            var components = URLComponents()
            components.queryItems = [
                URLQueryItem(name: "hotelId", value: hotelId),
                URLQueryItem(name: "from", value: from),
                URLQueryItem(name: "to", value: to),
                URLQueryItem(name: "includeUndated", value: String(includeUndated)),
            ]
            return components.percentEncodedQuery ?? ""
        }
    }
    struct Summary: Decodable, Sendable {
        let total: Int
        let planned: Int
        let in_progress: Int
        let waiting: Int
        let review: Int
        let completed: Int
        let overdue: Int
        let completionRate: Int
    }
    struct Row: Decodable, Identifiable, Sendable {
        let id: String
        let code: String
        let title: String
        let department: String
        let assigneeName: String
        let priority: Int
        let dueDate: String?
        let status: String
        let waitingReason: String
        let overdue: Bool
    }
    struct Undated: Decodable, Sendable {
        let count: Int
        let included: Bool
        let tasks: [Row]
    }
    let hotel: Hotel
    let filters: Filters
    let generatedAt: String
    let today: String
    let summary: Summary
    let tasks: [Row]
    let undated: Undated
}

private struct PanelReportDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.commaSeparatedText, .pdf] }
    var data: Data

    init(data: Data = Data()) { self.data = data }
    init(configuration: ReadConfiguration) throws {
        data = configuration.file.regularFileContents ?? Data()
    }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }
}

/// Uses the same report instance the user is viewing. The markup contains only
/// escaped text and inline styles, so printing cannot fetch external content.
@MainActor
private enum PanelReportPDF {
    private static func escape(_ value: String) -> String {
        value.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "'", with: "&#39;")
    }

    private static func task(_ row: PanelHotelReport.Row) -> String {
        let waiting = row.waitingReason.isEmpty ? "" : "<p class='reason'><strong>Bekleme nedeni:</strong> \(escape(row.waitingReason))</p>"
        return """
        <article class='task'>
          <h3>\(escape(row.title))</h3>
          <p class='meta'>\(escape(row.code)) · \(escape(row.department)) · \(escape(row.assigneeName))</p>
          <p class='meta'>Öncelik: \(row.priority) · \(escape(PanelStyle.status(row.status))) · Teslim: \(escape(PanelOperationsDate.label(row.dueDate)))\(row.overdue ? " · Gecikti" : "")</p>
          \(waiting)
        </article>
        """
    }

    static func make(_ report: PanelHotelReport) -> Data {
        let rows = report.tasks.isEmpty ? "<p>Bu dönemde teslim tarihi bulunan görev yok.</p>" : report.tasks.map(task).joined()
        let undated: String
        if report.undated.included {
            let tasks = report.undated.tasks.isEmpty ? "<p>Tarihsiz görev bulunmuyor.</p>" : report.undated.tasks.map(task).joined()
            undated = "<h2>Tarihsiz görevler · Ek bölüm (\(report.undated.count))</h2>\(tasks)"
        } else {
            undated = "<p class='note'>Oteldeki \(report.undated.count) tarihsiz görev bu rapora dahil edilmedi.</p>"
        }
        let summary = report.summary
        let html = """
        <!doctype html><html lang='tr'><head><meta charset='utf-8'>
        <style>
        body { font-family: Arial, Helvetica, sans-serif; color: #211c29; font-size: 10pt; line-height: 1.42; margin: 0; overflow-wrap: anywhere; word-wrap: break-word; }
        h1 { font-size: 21pt; line-height: 1.2; margin: 0 0 9pt; color: #873dab; }
        h2 { font-size: 14pt; margin: 20pt 0 9pt; border-bottom: 1pt solid #c8b5d1; padding-bottom: 5pt; page-break-after: avoid; }
        h3 { font-size: 11pt; margin: 0 0 4pt; line-height: 1.35; page-break-after: avoid; }
        p { margin: 4pt 0; widows: 2; orphans: 2; }
        .meta, .note { color: #5e5866; font-size: 9pt; }
        .note { margin: 10pt 0; }
        .task { margin: 0 0 11pt; padding: 0 0 9pt; border-bottom: 0.5pt solid #ddd5e2; page-break-inside: auto; }
        .reason { white-space: pre-wrap; }
        table { border-collapse: collapse; width: 100%; margin: 14pt 0; font-size: 10pt; }
        td { border-bottom: 0.5pt solid #e1d9e6; padding: 6pt 5pt; }
        td:last-child { text-align: right; font-weight: bold; }
        tr { page-break-inside: avoid; }
        </style></head><body>
        <h1>DGTLFACE · Otel iş raporu</h1>
        <h2>\(escape(report.hotel.name))</h2>
        <p>\(escape(report.hotel.location))</p>
        <p><strong>Teslim tarihi dönemi:</strong> \(escape(PanelOperationsDate.label(report.filters.from))) – \(escape(PanelOperationsDate.label(report.filters.to)))</p>
        <p class='meta'>Rapor oluşturulma zamanı: \(escape(PanelStyle.timestamp(report.generatedAt)))</p>
        <p class='meta'>Gecikme değerlendirme tarihi (Türkiye): \(escape(PanelOperationsDate.label(report.today)))</p>
        <p class='note'>Bu rapor, seçilen dönemde teslim tarihi olan görevlerin rapor alınırken güncel durumunu gösterir. Seçilen dönemde tamamlanan işler raporu değildir. Tarihsiz görevler dönem toplamına dahil edilmez.</p>
        <table>
        <tr><td>Dönemde teslim tarihli görev</td><td>\(summary.total)</td></tr>
        <tr><td>Tamamlanan / Tamamlanma oranı</td><td>\(summary.completed) / %\(summary.completionRate)</td></tr>
        <tr><td>Devam ediyor</td><td>\(summary.in_progress)</td></tr>
        <tr><td>Kontrol bekliyor</td><td>\(summary.review)</td></tr>
        <tr><td>Bekliyor</td><td>\(summary.waiting)</td></tr>
        <tr><td>Planlandı</td><td>\(summary.planned)</td></tr>
        <tr><td>Geciken</td><td>\(summary.overdue)</td></tr>
        <tr><td>Oteldeki tarihsiz görev</td><td>\(report.undated.count)</td></tr>
        </table>
        <h2>Dönemde teslim tarihli görevler (\(report.tasks.count))</h2>
        \(rows)
        \(undated)
        </body></html>
        """
        let renderer = PanelReportPrintRenderer()
        renderer.addPrintFormatter(UIMarkupTextPrintFormatter(markupText: html), startingAtPageAt: 0)
        let count = renderer.numberOfPages
        renderer.prepare(forDrawingPages: NSRange(location: 0, length: count))
        let format = UIGraphicsPDFRendererFormat()
        format.documentInfo = [kCGPDFContextTitle as String: "DGTLFACE · \(report.hotel.name)", kCGPDFContextCreator as String: "DGTLFACE İşler"]
        return UIGraphicsPDFRenderer(bounds: renderer.paperRect, format: format).pdfData { context in
            for page in 0..<count {
                context.beginPage()
                renderer.drawPage(at: page, in: renderer.paperRect)
            }
        }
    }
}

@MainActor
private final class PanelReportPrintRenderer: UIPrintPageRenderer {
    override var paperRect: CGRect { CGRect(x: 0, y: 0, width: 595.28, height: 841.89) }
    override var printableRect: CGRect { paperRect.insetBy(dx: 36, dy: 36) }

    override init() {
        super.init()
        headerHeight = 20
        footerHeight = 20
    }

    override func drawHeaderForPage(at pageIndex: Int, in headerRect: CGRect) {
        let rect = CGRect(x: 36, y: 26, width: paperRect.width - 72, height: 12)
        ("DGTLFACE · İş Takibi" as NSString).draw(in: rect, withAttributes: [.font: UIFont(name: "ArialMT", size: 8) ?? UIFont.systemFont(ofSize: 8), .foregroundColor: UIColor.darkGray])
    }

    override func drawFooterForPage(at pageIndex: Int, in footerRect: CGRect) {
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = .right
        let rect = CGRect(x: 36, y: paperRect.height - 36, width: paperRect.width - 72, height: 12)
        ("Sayfa \(pageIndex + 1) / \(numberOfPages)" as NSString).draw(in: rect, withAttributes: [.font: UIFont(name: "ArialMT", size: 8) ?? UIFont.systemFont(ofSize: 8), .foregroundColor: UIColor.darkGray, .paragraphStyle: paragraph])
    }
}

struct PanelReportsView: View {
    @EnvironmentObject private var store: PanelStore
    @State private var hotelID = ""
    @State private var from = PanelOperationsDate.monthStart
    @State private var to = PanelOperationsDate.monthEnd
    @State private var includeUndated = false
    @State private var report: PanelHotelReport?
    @State private var isLoading = false
    @State private var isExporting = false
    @State private var failure: String?
    @State private var csvDocument = PanelReportDocument()
    @State private var csvName = "dgtlface-rapor.csv"
    @State private var exportType = UTType.commaSeparatedText
    @State private var showingExporter = false
    @State private var isVisible = false
    @State private var destination: PanelOperationTaskDestination?
    @State private var openingTask = false

    private var filters: PanelHotelReport.Filters {
        .init(hotelId: hotelID, from: PanelOperationsDate.day(from), to: PanelOperationsDate.day(to), includeUndated: includeUndated)
    }
    private var dirty: Bool { report?.filters.query != filters.query }

    var body: some View {
        List {
            PanelOperationsConnection()
            filterSection
            if let failure {
                Section { Text(failure).foregroundStyle(.red).accessibilityAddTraits(.updatesFrequently) }
            }
            if isLoading { Section { ProgressView("Rapor hazırlanıyor…") } }
            if let report {
                if dirty {
                    Section { Label("Filtreler değişti. Yeni sonuçlar için raporu oluştur.", systemImage: "line.3.horizontal.decrease.circle").font(.subheadline) }
                }
                reportSummary(report)
                Section("Dönemde teslim tarihli görevler · \(report.tasks.count)") {
                    if report.tasks.isEmpty { Text("Bu dönemde teslim tarihi bulunan görev yok.").foregroundStyle(.secondary) }
                    ForEach(report.tasks) { row in reportRow(row) }
                }
                Section("Tarihsiz görevler · \(report.undated.count)") {
                    if report.undated.included {
                        if report.undated.tasks.isEmpty { Text("Tarihsiz görev bulunmuyor.").foregroundStyle(.secondary) }
                        ForEach(report.undated.tasks) { row in reportRow(row) }
                    } else {
                        Text("Tarihsiz görevler dönem toplamına dahil edilmez. İstersen filtrelerden ayrı bir ek bölüm olarak ekleyebilirsin.")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                }
            } else if !isLoading && failure == nil {
                Section { ContentUnavailableView("Rapor hazırla", systemImage: "chart.bar.doc.horizontal", description: Text("Bir otel ve teslim tarihi dönemi seç.")) }
            }
        }
        .navigationTitle("Raporlar")
        .navigationBarTitleDisplayMode(.inline)
        .environment(\.timeZone, PanelOperationsDate.calendar.timeZone)
        .refreshable { await store.refresh(); await load() }
        .onAppear { isVisible = true }
        .onDisappear { isVisible = false }
        .onChange(of: store.lastSyncedAt) { _, _ in
            if isVisible && report != nil && !dirty && !isLoading && !isExporting {
                Task { await load() }
            }
        }
        .task(id: store.snapshot?.user.id) {
            report = nil
            hotelID = store.snapshot?.hotels.first?.id ?? ""
            if !hotelID.isEmpty && !store.isOffline { await load() }
        }
        .fileExporter(isPresented: $showingExporter, document: csvDocument, contentType: exportType, defaultFilename: csvName) { result in
            if case .failure(let error) = result { failure = error.localizedDescription }
            csvDocument = PanelReportDocument()
        }
        .navigationDestination(item: $destination) { item in PanelTaskDetailView(taskID: item.id) }
        .modifier(PanelScenePrivacy())
    }

    private var filterSection: some View {
        Section {
            Picker("Otel", selection: $hotelID) {
                Text("Otel seç").tag("")
                ForEach(store.snapshot?.hotels ?? []) { hotel in Text(hotel.name).tag(hotel.id) }
            }
            DatePicker("Başlangıç", selection: $from, displayedComponents: .date)
            DatePicker("Bitiş", selection: $to, displayedComponents: .date)
            Toggle("Tarihsiz görevleri ek bölümde göster", isOn: $includeUndated)
            Button { Task { await load() } } label: {
                Label("Rapor oluştur", systemImage: "chart.bar.xaxis")
            }
            .disabled(hotelID.isEmpty || store.isOffline || isLoading || isExporting)
        } header: {
            Text("Teslim tarihi dönemi")
        } footer: {
            Text("En fazla 366 gün seçilebilir. Rapor, bu dönemde teslim tarihi olan görevlerin güncel durumunu gösterir.")
        }
    }

    private func reportSummary(_ report: PanelHotelReport) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 6) {
                Text(report.hotel.name).font(.headline)
                Text("\(PanelOperationsDate.label(report.filters.from)) – \(PanelOperationsDate.label(report.filters.to))")
                    .font(.subheadline).foregroundStyle(.secondary)
                if !report.hotel.location.isEmpty { Text(report.hotel.location).font(.caption).foregroundStyle(.secondary) }
            }
            LabeledContent("Toplam görev", value: String(report.summary.total))
            LabeledContent("Tamamlanan", value: "\(report.summary.completed) · %\(report.summary.completionRate)")
            LabeledContent("Devam ediyor", value: String(report.summary.in_progress))
            LabeledContent("Kontrol bekliyor", value: String(report.summary.review))
            LabeledContent("Bekliyor", value: String(report.summary.waiting))
            LabeledContent("Planlandı", value: String(report.summary.planned))
            LabeledContent("Bugün itibarıyla geciken", value: String(report.summary.overdue))
                .foregroundStyle(report.summary.overdue > 0 ? .red : .primary)
            Button { Task { await export(report) } } label: {
                if isExporting { ProgressView("CSV hazırlanıyor…") }
                else { Label("Excel için CSV dışa aktar", systemImage: "square.and.arrow.up") }
            }
            .disabled(isExporting || isLoading || dirty || store.isOffline)
            Button { exportPDF(report) } label: {
                Label("Görüntülenen raporu PDF kaydet", systemImage: "doc.richtext")
            }.disabled(isExporting || isLoading || dirty)
            if UIPrintInteractionController.isPrintingAvailable {
                Button { printReport(report) } label: {
                    Label("Raporu yazdır", systemImage: "printer")
                }.disabled(isExporting || isLoading || dirty)
            }
            Text("Hazırlandı: \(PanelStyle.timestamp(report.generatedAt))")
                .font(.caption).foregroundStyle(.secondary)
        } footer: {
            Text("Tamamlanma oranı güncel duruma göre hesaplanır; seçilen dönemde tamamlanan işler anlamına gelmez. Dışa aktarma sunucudaki güncel raporu alır.")
        }
    }

    private func reportRow(_ row: PanelHotelReport.Row) -> some View {
        Button {
            Task {
                openingTask = true
                await store.refresh()
                openingTask = false
                guard store.isSignedIn, !Task.isCancelled else { return }
                destination = .init(id: row.id)
            }
        } label: {
            VStack(alignment: .leading, spacing: 5) {
                HStack {
                    Text(row.title).font(.headline)
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
                }
                Text("\(row.code) · \(row.department)").font(.caption).foregroundStyle(.secondary)
                Text(row.assigneeName).font(.subheadline)
                Text("Öncelik \(row.priority) · \(PanelStyle.status(row.status))").font(.caption)
                Text(PanelOperationsDate.label(row.dueDate)).font(.caption).foregroundStyle(.secondary)
                if row.overdue { Label("Gecikti", systemImage: "clock.badge.exclamationmark").font(.caption).foregroundStyle(.red) }
                if !row.waitingReason.isEmpty { Text("Bekleme nedeni: \(row.waitingReason)").font(.caption).foregroundStyle(.secondary) }
            }.padding(.vertical, 4)
        }.buttonStyle(.plain).disabled(openingTask)
    }

    @MainActor private func load() async {
        guard !isLoading, !isExporting, !hotelID.isEmpty else { return }
        let selected = filters
        guard selected.from <= selected.to else { failure = "Başlangıç tarihi bitiş tarihinden sonra olamaz."; return }
        let days = PanelOperationsDate.calendar.dateComponents([.day], from: PanelOperationsDate.calendar.startOfDay(for: from), to: PanelOperationsDate.calendar.startOfDay(for: to)).day ?? 367
        guard days < 366 else { failure = "Tek raporda en fazla 366 günlük dönem seçebilirsin."; return }
        isLoading = true
        failure = nil
        defer { isLoading = false }
        let response: PanelReportEnvelope? = await store.loadResource(path: "/api/reports?\(selected.query)")
        guard !Task.isCancelled else { return }
        if let response { report = response.report }
        else { failure = store.errorMessage ?? "Rapor alınamadı. Bağlantıyı kontrol edip yeniden dene." }
    }

    @MainActor private func export(_ report: PanelHotelReport) async {
        guard !isExporting, !dirty, !store.isOffline else { return }
        isExporting = true
        failure = nil
        defer { isExporting = false }
        guard let data = await store.downloadResource(path: "/api/reports/export?\(report.filters.query)"), !Task.isCancelled else {
            failure = store.errorMessage ?? "CSV alınamadı. Yeniden deneyebilirsin."
            return
        }
        csvDocument = PanelReportDocument(data: data)
        csvName = "dgtlface-\(report.hotel.id)-\(report.filters.from)-\(report.filters.to).csv"
        exportType = .commaSeparatedText
        showingExporter = true
    }

    @MainActor private func exportPDF(_ report: PanelHotelReport) {
        guard !isExporting, !isLoading, !dirty else { return }
        csvDocument = PanelReportDocument(data: PanelReportPDF.make(report))
        csvName = "dgtlface-\(report.hotel.id)-\(report.filters.from)-\(report.filters.to).pdf"
        exportType = .pdf
        showingExporter = true
    }

    @MainActor private func printReport(_ report: PanelHotelReport) {
        guard !isExporting, !isLoading, !dirty, UIPrintInteractionController.isPrintingAvailable else { return }
        let controller = UIPrintInteractionController.shared
        let info = UIPrintInfo(dictionary: nil)
        info.jobName = "DGTLFACE · \(report.hotel.name)"
        info.outputType = .general
        controller.printInfo = info
        controller.printingItem = PanelReportPDF.make(report)
        controller.present(animated: true) { controller, _, error in
            controller.printingItem = nil
            if let error { failure = error.localizedDescription }
        }
    }
}

// MARK: Notifications

private struct PanelNotificationList: Decodable, Sendable {
    let notifications: [PanelPersonalNotification]
    let unreadCount: Int
}

private struct PanelPersonalNotification: Decodable, Identifiable, Sendable {
    let id: String
    let taskId: String
    let hotelId: String
    let kind: String
    let title: String
    let message: String
    let createdAt: String
    var readAt: String?
}

private struct PanelNotificationRead: Encodable, Sendable {
    let action: String
    let id: String?
}

private struct PanelNotificationReadResponse: Decodable, Sendable {
    let ok: Bool
    let updated: Int
}

struct PanelNotificationsView: View {
    @EnvironmentObject private var store: PanelStore
    @State private var notifications: [PanelPersonalNotification] = []
    @State private var unreadCount = 0
    @State private var unreadOnly = false
    @State private var isLoading = false
    @State private var busy = false
    @State private var failure: String?
    @State private var destination: PanelOperationTaskDestination?
    @State private var isVisible = false

    private var visible: [PanelPersonalNotification] {
        unreadOnly ? notifications.filter { $0.readAt == nil } : notifications
    }

    var body: some View {
        List {
            PanelOperationsConnection()
            Section {
                Picker("Bildirimler", selection: $unreadOnly) {
                    Text("Tümü").tag(false)
                    Text("Okunmamış (\(unreadCount))").tag(true)
                }.pickerStyle(.segmented)
                Button { Task { await markRead(nil) } } label: {
                    Label("Tümünü okundu işaretle", systemImage: "checkmark.message")
                }.disabled(unreadCount == 0 || busy || isLoading || store.isSaving || store.isOffline)
            } footer: {
                Text("Görev atamaları, kontrol talepleri ve önemli tarihler. Bildirimler ekran açıkken yenilenir; aşağı çekerek de yenileyebilirsin.")
            }
            if let failure { Section { Text(failure).foregroundStyle(.red) } }
            if isLoading { Section { ProgressView("Bildirimler alınıyor…") } }
            if visible.isEmpty && !isLoading {
                Section { ContentUnavailableView(unreadOnly ? "Okunmamış bildirim yok" : "Henüz bildirim yok", systemImage: "bell") }
            }
            ForEach(visible) { item in
                Section {
                    Button { Task { await open(item) } } label: {
                        VStack(alignment: .leading, spacing: 7) {
                            HStack(alignment: .top) {
                                if item.readAt == nil { Image(systemName: "circle.fill").font(.system(size: 8)).foregroundStyle(PanelStyle.purple).padding(.top, 5).accessibilityLabel("Okunmamış") }
                                Text(item.title).font(.headline).foregroundStyle(.primary)
                                Spacer(minLength: 0)
                                Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
                            }
                            Text(item.message).font(.subheadline).foregroundStyle(.primary)
                            Text(store.snapshot?.hotels.first { $0.id == item.hotelId }?.name ?? "Otel")
                                .font(.caption).foregroundStyle(.secondary)
                            Text(PanelStyle.timestamp(item.createdAt)).font(.caption).foregroundStyle(.secondary)
                        }.padding(.vertical, 4)
                    }.buttonStyle(.plain).disabled(busy || isLoading || store.isSaving)
                    if item.readAt == nil {
                        Button("Okundu işaretle") { Task { await markRead(item.id) } }
                            .disabled(busy || isLoading || store.isSaving || store.isOffline)
                    }
                }
            }
        }
        .navigationTitle("Bildirimler")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await store.refresh(); await load() }
        .onAppear { isVisible = true }
        .onDisappear { isVisible = false }
        .onChange(of: store.lastSyncedAt) { _, _ in
            if isVisible && !isLoading && !busy { Task { await load() } }
        }
        .task(id: store.snapshot?.user.id) {
            notifications = []
            unreadCount = 0
            await load()
        }
        .navigationDestination(item: $destination) { item in PanelTaskDetailView(taskID: item.id) }
        .modifier(PanelScenePrivacy())
    }

    @MainActor private func load() async {
        guard !isLoading else { return }
        isLoading = true
        failure = nil
        defer { isLoading = false }
        let response: PanelNotificationList? = await store.loadResource(path: "/api/notifications")
        guard !Task.isCancelled else { return }
        if let response {
            notifications = response.notifications
            unreadCount = response.unreadCount
        } else { failure = store.errorMessage ?? "Bildirimler alınamadı. Yenilemek için aşağı çekebilirsin." }
    }

    @MainActor private func markRead(_ id: String?) async {
        guard !busy, !isLoading, !store.isOffline else { return }
        busy = true
        failure = nil
        defer { busy = false }
        let response: PanelNotificationReadResponse? = await store.mutateResource(path: "/api/notifications", method: "PATCH", body: PanelNotificationRead(action: id == nil ? "read_all" : "read", id: id))
        guard response?.ok == true else { failure = store.errorMessage ?? "Bildirim güncellenemedi."; return }
        let now = ISO8601DateFormatter().string(from: Date())
        notifications = notifications.map { item in
            var next = item
            if id == nil || item.id == id { next.readAt = next.readAt ?? now }
            return next
        }
        if id == nil { unreadCount = 0 }
        else { unreadCount = max(0, unreadCount - min(1, response?.updated ?? 0)) }
        await load()
    }

    @MainActor private func open(_ item: PanelPersonalNotification) async {
        if item.readAt == nil && !store.isOffline { await markRead(item.id) }
        guard store.isSignedIn else { return }
        await store.refresh()
        guard store.isSignedIn, !Task.isCancelled else { return }
        destination = .init(id: item.taskId)
    }
}

// MARK: Recurrences

private struct PanelRecurrenceList: Decodable, Sendable { let recurrences: [PanelRecurrence] }
private struct PanelRecurrenceResponse: Decodable, Sendable { let recurrence: PanelRecurrence }
private struct PanelRecurrenceAction: Encodable, Sendable { let action: String }

private struct PanelRecurrence: Decodable, Identifiable, Sendable {
    let id: String
    let hotelId: String
    let title: String
    let description: String
    let department: String
    let assigneeId: String
    let priority: Int
    let checklist: [String]
    let frequency: String
    let startsOn: String
    let dueOffsetDays: Int
    let active: Bool
    let nextRunOn: String
    let lastRunOn: String?
    let blockedReason: String?

    var status: String { !active ? "Duraklatıldı" : blockedReason == nil ? "Aktif" : "İşlem gerekiyor" }
    var cadence: String {
        guard let date = PanelOperationsDate.parse(startsOn) else { return frequency == "weekly" ? "Haftalık" : "Aylık" }
        if frequency == "monthly" { return "Her ayın \(PanelOperationsDate.calendar.component(.day, from: date)). günü" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "tr_TR")
        formatter.timeZone = PanelOperationsDate.calendar.timeZone
        formatter.dateFormat = "EEEE"
        return "Her \(formatter.string(from: date))"
    }
}

private struct PanelRecurrenceDraftTarget: Identifiable {
    let id = UUID()
    let rule: PanelRecurrence?
}

struct PanelRecurrencesView: View {
    @EnvironmentObject private var store: PanelStore
    @State private var rules: [PanelRecurrence] = []
    @State private var filter = "all"
    @State private var search = ""
    @State private var isLoading = false
    @State private var busy = false
    @State private var failure: String?
    @State private var editor: PanelRecurrenceDraftTarget?
    @State private var isVisible = false

    private var isAdmin: Bool { store.snapshot?.user.role == "admin" }
    private var filtered: [PanelRecurrence] {
        rules.filter { rule in
            let matchesFilter = filter == "all" || (filter == "active" && rule.active && rule.blockedReason == nil) || (filter == "paused" && !rule.active) || (filter == "blocked" && rule.active && rule.blockedReason != nil)
            let hotel = store.snapshot?.hotels.first { $0.id == rule.hotelId }?.name ?? ""
            let user = store.snapshot?.users.first { $0.id == rule.assigneeId }?.name ?? ""
            let term = search.trimmingCharacters(in: .whitespacesAndNewlines)
            return matchesFilter && (term.isEmpty || "\(rule.title) \(rule.department) \(hotel) \(user)".range(of: term, options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "tr_TR")) != nil)
        }
    }

    var body: some View {
        Group {
            if isAdmin { recurrenceList }
            else { ContentUnavailableView("Yönetici yetkisi gerekiyor", systemImage: "lock", description: Text("Sana atanan düzenli işler görev listende görünür.")) }
        }
        .navigationTitle("Düzenli işler")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if isAdmin {
                ToolbarItem(placement: .primaryAction) {
                    Button { editor = .init(rule: nil) } label: { Label("Düzenli iş ekle", systemImage: "plus") }
                        .disabled(store.isOffline || store.isSaving || busy || isLoading)
                }
            }
        }
        .task(id: store.snapshot?.user.id) { rules = []; if isAdmin { await load() } }
        .onAppear { isVisible = true }
        .onDisappear { isVisible = false }
        .onChange(of: store.lastSyncedAt) { _, _ in
            if isVisible && isAdmin && !isLoading && !busy && editor == nil { Task { await load() } }
        }
        .sheet(item: $editor) { target in
            PanelRecurrenceEditor(rule: target.rule) { rule in
                if let index = rules.firstIndex(where: { $0.id == rule.id }) { rules[index] = rule }
                else { rules.insert(rule, at: 0) }
            }
        }
        .modifier(PanelScenePrivacy())
    }

    private var recurrenceList: some View {
        List {
            PanelOperationsConnection()
            Section {
                Picker("Plan durumu", selection: $filter) {
                    Text("Tüm planlar").tag("all")
                    Text("Aktif").tag("active")
                    Text("Duraklatıldı").tag("paused")
                    Text("İşlem gerekiyor").tag("blocked")
                }
            } footer: {
                Text("Her dönem ayrı görev oluşur. Plan değişiklikleri önceki görevleri değiştirmez. Türkiye tarihine göre çalışır.")
            }
            if let failure { Section { Text(failure).foregroundStyle(.red) } }
            if isLoading { Section { ProgressView("Planlar alınıyor…") } }
            if filtered.isEmpty && !isLoading {
                Section { ContentUnavailableView("Bu görünümde plan yok", systemImage: "repeat", description: Text("Haftalık veya aylık işler için bir plan ekleyebilirsin.")) }
            }
            ForEach(filtered) { rule in
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(rule.title).font(.headline)
                        Text(store.snapshot?.hotels.first { $0.id == rule.hotelId }?.name ?? "Otel bulunamadı")
                            .font(.subheadline).foregroundStyle(PanelStyle.purple)
                        Text("\(rule.department) · \(store.snapshot?.users.first { $0.id == rule.assigneeId }?.name ?? "Sorumlu bulunamadı")")
                            .font(.caption).foregroundStyle(.secondary)
                        if !rule.description.isEmpty { Text(rule.description).font(.subheadline) }
                    }
                    LabeledContent("Durum", value: rule.status)
                    LabeledContent("Tekrar", value: rule.cadence)
                    LabeledContent("Öncelik", value: "\(rule.priority) · 1 en yüksek")
                    LabeledContent("Teslim hedefi", value: rule.dueOffsetDays == 0 ? "Oluştuğu gün" : "\(rule.dueOffsetDays) gün sonra")
                    LabeledContent("Sonraki görev", value: rule.active ? PanelOperationsDate.label(rule.nextRunOn) : "Duraklatıldı")
                    LabeledContent("Son dönem", value: rule.lastRunOn == nil ? "Henüz oluşmadı" : PanelOperationsDate.label(rule.lastRunOn))
                    if let reason = rule.blockedReason { Label(reason, systemImage: "exclamationmark.triangle").font(.subheadline).foregroundStyle(.orange) }
                    DisclosureGroup("Tamamlanma kriterleri · \(rule.checklist.count)") {
                        ForEach(Array(rule.checklist.enumerated()), id: \.offset) { index, text in Text("\(index + 1). \(text)").font(.subheadline) }
                    }
                    Button("Düzenle") { editor = .init(rule: rule) }.disabled(store.isOffline || busy || isLoading || store.isSaving)
                    Button { Task { await toggle(rule) } } label: {
                        Label(rule.active ? "Duraklat" : "Devam ettir", systemImage: rule.active ? "pause.circle" : "play.circle")
                    }.disabled(store.isOffline || busy || isLoading || store.isSaving)
                }
            }
            Section {
                Text("Duraklatılan dönemler devam edildiğinde atlanır. Görevler, kriterleri tamamlandıktan sonra yönetici onayıyla tamamlanır.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
        .searchable(text: $search, prompt: "İş, otel veya sorumlu ara")
        .refreshable { await store.refresh(); await load() }
    }

    @MainActor private func load() async {
        guard isAdmin, !isLoading else { return }
        isLoading = true
        failure = nil
        defer { isLoading = false }
        let response: PanelRecurrenceList? = await store.loadResource(path: "/api/recurrences")
        guard !Task.isCancelled else { return }
        if let response { rules = response.recurrences }
        else { failure = store.errorMessage ?? "Düzenli işler alınamadı. Yenilemek için aşağı çekebilirsin." }
    }

    @MainActor private func toggle(_ rule: PanelRecurrence) async {
        guard isAdmin, !busy, !isLoading, !store.isOffline else { return }
        busy = true
        failure = nil
        defer { busy = false }
        let response: PanelRecurrenceResponse? = await store.mutateResource(path: "/api/recurrences/\(rule.id)", method: "PATCH", body: PanelRecurrenceAction(action: rule.active ? "pause" : "resume"))
        if let response, let index = rules.firstIndex(where: { $0.id == rule.id }) { rules[index] = response.recurrence }
        else { failure = store.errorMessage ?? "Plan güncellenemedi." }
    }
}

private struct PanelRecurrenceMutation: Encodable, Sendable {
    let action: String?
    let hotelId: String?
    let title: String
    let description: String
    let department: String
    let assigneeId: String
    let priority: Int
    let checklist: [String]
    let frequency: String?
    let startsOn: String?
    let dueOffsetDays: Int
}

private struct PanelRecurrenceEditor: View {
    @EnvironmentObject private var store: PanelStore
    @Environment(\.dismiss) private var dismiss
    let rule: PanelRecurrence?
    let onSaved: (PanelRecurrence) -> Void
    @State private var hotelID: String
    @State private var title: String
    @State private var description: String
    @State private var department: String
    @State private var assigneeID: String
    @State private var priority: Int
    @State private var checklist: String
    @State private var frequency: String
    @State private var startsOn: Date
    @State private var dueOffsetDays: Int
    @State private var busy = false
    @State private var failure: String?
    @State private var confirmingDiscard = false

    init(rule: PanelRecurrence?, onSaved: @escaping (PanelRecurrence) -> Void) {
        self.rule = rule
        self.onSaved = onSaved
        _hotelID = State(initialValue: rule?.hotelId ?? "")
        _title = State(initialValue: rule?.title ?? "")
        _description = State(initialValue: rule?.description ?? "")
        _department = State(initialValue: rule?.department ?? "")
        _assigneeID = State(initialValue: rule?.assigneeId ?? "")
        _priority = State(initialValue: rule?.priority ?? 5)
        _checklist = State(initialValue: rule?.checklist.joined(separator: "\n") ?? "")
        _frequency = State(initialValue: rule?.frequency ?? "weekly")
        _startsOn = State(initialValue: rule.flatMap { PanelOperationsDate.parse($0.startsOn) } ?? Date())
        _dueOffsetDays = State(initialValue: rule?.dueOffsetDays ?? 0)
    }

    private var people: [PanelUser] { (store.snapshot?.users ?? []).filter { $0.active != false && $0.role != "observer" } }
    private var departments: [String] {
        let defaults = ["Proje Yöneticisi", "Web & IT", "Sosyal Medya", "Analytics", "Performans Pazarlama", "Çağrı Merkezi", "Dijital Strateji", "SEO", "Kreatif Ekip"]
        return Array(Set(defaults + (store.snapshot?.users.map(\.department) ?? []) + [department])).filter { !$0.isEmpty }.sorted()
    }
    private var canSave: Bool { !busy && !store.isSaving && !store.isOffline && store.snapshot?.user.role == "admin" }
    private var dirty: Bool {
        hotelID != (rule?.hotelId ?? "") || title != (rule?.title ?? "") || description != (rule?.description ?? "") ||
        department != (rule?.department ?? "") || assigneeID != (rule?.assigneeId ?? "") || priority != (rule?.priority ?? 5) ||
        checklist != (rule?.checklist.joined(separator: "\n") ?? "") || frequency != (rule?.frequency ?? "weekly") ||
        PanelOperationsDate.day(startsOn) != (rule?.startsOn ?? PanelOperationsDate.day(Date())) || dueOffsetDays != (rule?.dueOffsetDays ?? 0)
    }

    var body: some View {
        NavigationStack {
            Form {
                PanelOperationsConnection()
                if let failure { Section { Text(failure).foregroundStyle(.red) } }
                Section("İş bilgileri") {
                    TextField("İşin adı", text: $title, axis: .vertical)
                    Picker("Otel", selection: $hotelID) {
                        Text("Otel seç").tag("")
                        ForEach(store.snapshot?.hotels ?? []) { hotel in Text(hotel.name).tag(hotel.id) }
                    }.disabled(rule != nil)
                    Picker("Ekip", selection: $department) {
                        Text("Ekip seç").tag("")
                        ForEach(departments, id: \.self) { Text($0).tag($0) }
                    }
                    TextField("Açıklama", text: $description, axis: .vertical).lineLimit(3...8)
                    Picker("Sorumlu", selection: $assigneeID) {
                        Text("Sorumlu seç").tag("")
                        if !assigneeID.isEmpty && !people.contains(where: { $0.id == assigneeID }) {
                            Text("Yeniden atama gerekiyor").tag(assigneeID)
                        }
                        ForEach(people) { person in Text("\(person.name) · \(person.department)").tag(person.id) }
                    }
                    Picker("Öncelik", selection: $priority) {
                        ForEach(1...10, id: \.self) { Text($0 == 1 ? "1 · En yüksek" : String($0)).tag($0) }
                    }
                }
                Section {
                    Picker("Tekrar sıklığı", selection: $frequency) {
                        Text("Haftalık").tag("weekly")
                        Text("Aylık").tag("monthly")
                    }.disabled(rule != nil)
                    DatePicker("İlk görevin günü", selection: $startsOn, displayedComponents: .date).disabled(rule != nil)
                    Stepper("Teslim hedefi: \(dueOffsetDays) gün sonra", value: $dueOffsetDays, in: 0...30)
                } header: { Text("Tekrar takvimi") } footer: {
                    Text(rule != nil ? "Otel ve tekrar takvimi sonradan değiştirilemez. Diğer değişiklikler yalnızca sonraki görevleri etkiler." : "İlk tarih bugün veya sonrası olmalı. Aylık planda o gün yoksa ayın son günü kullanılır. 0 gün, görevin oluştuğu gün teslim edilmesi demektir.")
                }
                Section {
                    TextField("Her satıra bir kriter yaz", text: $checklist, axis: .vertical).lineLimit(5...15)
                } header: { Text("Tamamlanma kriterleri") } footer: { Text("1–30 kriter ekle. Her kriter en fazla 2.000 karakter olabilir.") }
            }
            .disabled(busy)
            .navigationTitle(rule == nil ? "Düzenli iş ekle" : "Planı düzenle")
            .navigationBarTitleDisplayMode(.inline)
            .environment(\.timeZone, PanelOperationsDate.calendar.timeZone)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Vazgeç") { if dirty { confirmingDiscard = true } else { dismiss() } }.disabled(busy)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button { Task { await save() } } label: {
                        if busy { ProgressView() } else { Text("Kaydet") }
                    }.disabled(!canSave)
                }
            }
            .confirmationDialog("Kaydedilmemiş değişiklikler silinsin mi?", isPresented: $confirmingDiscard, titleVisibility: .visible) {
                Button("Değişiklikleri sil", role: .destructive) { dismiss() }
                Button("Düzenlemeye devam et", role: .cancel) {}
            }
            .interactiveDismissDisabled(busy || dirty)
        }
        .modifier(PanelScenePrivacy())
    }

    @MainActor private func save() async {
        guard canSave else { return }
        let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanDescription = description.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanDepartment = department.trimmingCharacters(in: .whitespacesAndNewlines)
        let items = checklist.components(separatedBy: .newlines).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        guard !cleanTitle.isEmpty, cleanTitle.utf16.count <= 200 else { failure = "İşin adı 1–200 karakter olmalı."; return }
        guard !hotelID.isEmpty, store.snapshot?.hotels.contains(where: { $0.id == hotelID }) == true else { failure = "Bir otel seç."; return }
        guard !cleanDepartment.isEmpty, cleanDepartment.utf16.count <= 200 else { failure = "Geçerli bir ekip seç."; return }
        guard people.contains(where: { $0.id == assigneeID }) else { failure = "Aktif bir personel veya yönetici seç."; return }
        guard cleanDescription.utf16.count <= 5000 else { failure = "Açıklama en fazla 5.000 karakter olabilir."; return }
        guard (1...30).contains(items.count), items.allSatisfy({ $0.utf16.count <= 2000 }) else { failure = "1–30 kriter ekle; her biri en fazla 2.000 karakter olabilir."; return }
        let start = PanelOperationsDate.day(startsOn)
        guard rule != nil || start >= PanelOperationsDate.day(Date()) else { failure = "İlk görev günü bugün veya sonraki bir gün olmalı."; return }
        let payload = PanelRecurrenceMutation(action: rule == nil ? nil : "update", hotelId: rule == nil ? hotelID : nil, title: cleanTitle, description: cleanDescription, department: cleanDepartment, assigneeId: assigneeID, priority: priority, checklist: items, frequency: rule == nil ? frequency : nil, startsOn: rule == nil ? start : nil, dueOffsetDays: dueOffsetDays)
        busy = true
        failure = nil
        defer { busy = false }
        let response: PanelRecurrenceResponse? = await store.mutateResource(path: rule.map { "/api/recurrences/\($0.id)" } ?? "/api/recurrences", method: rule == nil ? "POST" : "PATCH", body: payload)
        if let response { onSaved(response.recurrence); dismiss() }
        else { failure = store.errorMessage ?? "Plan kaydedilemedi. Girdiğin bilgiler korunuyor." }
    }
}
