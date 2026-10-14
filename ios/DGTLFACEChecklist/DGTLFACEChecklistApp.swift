import SwiftUI

@main
@MainActor
struct DGTLFACEChecklistApp: App {
    @StateObject private var panel = PanelStore()
    @StateObject private var archive = PanelLegacyArchiveReader()

    var body: some Scene {
        WindowGroup {
            PanelRootView()
                .environmentObject(panel)
                .environmentObject(archive)
                .tint(Color(red: 0.529, green: 0.239, blue: 0.671))
                .environment(\.locale, Locale(identifier: "tr_TR"))
        }
    }
}
