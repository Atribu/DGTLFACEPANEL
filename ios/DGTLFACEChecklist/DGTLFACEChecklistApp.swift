import SwiftUI

@main
@MainActor
struct DGTLFACEChecklistApp: App {
    @StateObject private var container = ChecklistContainer()

    var body: some Scene {
        WindowGroup {
            Group {
                if let store = container.store {
                    ChecklistHomeView().environmentObject(store)
                } else {
                    ContentUnavailableView {
                        Label("İş listesi açılamadı", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text("Kayıtlar değiştirilmedi. \(container.loadError ?? "Lütfen tekrar deneyin.")")
                    } actions: {
                        Button("Tekrar dene", action: container.load)
                            .buttonStyle(.borderedProminent)
                    }
                }
            }
            .tint(Color(red: 0.529, green: 0.239, blue: 0.671))
            .environment(\.locale, Locale(identifier: "tr_TR"))
        }
    }
}
