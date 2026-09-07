import AppKit
import WebKit
import UniformTypeIdentifiers

// A client, not a second ledger: all team data remains on the configured server.
enum ServerAddress {
    static let initial = "http://192.168.2.100:8766"
    static func parse(_ input: String) -> URL? {
        guard var c = URLComponents(string: input.trimmingCharacters(in: .whitespacesAndNewlines)),
              let scheme = c.scheme?.lowercased(), ["http", "https"].contains(scheme),
              let host = c.host?.lowercased(), !host.isEmpty,
              c.user == nil, c.password == nil, c.query == nil, c.fragment == nil,
              c.path.isEmpty || c.path == "/",
              c.port == nil || (1...65535).contains(c.port!) else { return nil }
        // Plain HTTP is for the explicitly selected LAN server, not the public internet.
        if scheme == "http" && !isLocal(host) { return nil }
        c.scheme = scheme; c.host = host; c.path = "/"
        return c.url
    }
    static func isLocal(_ host: String) -> Bool {
        if ["localhost", "::1", "[::1]"].contains(host) { return true }
        if host.hasSuffix(".local") || host.hasSuffix(".lan") { return true }
        let p = host.split(separator: ".", omittingEmptySubsequences: false)
        guard p.count == 4, p.allSatisfy({ !$0.isEmpty && $0.allSatisfy({ $0.isASCII && $0.isNumber }) }),
              p.allSatisfy({ Int($0).map { (0...255).contains($0) } == true }) else { return false }
        let a = p.map { Int($0)! }
        return a[0] == 10 || a[0] == 127 || (a[0] == 192 && a[1] == 168)
            || (a[0] == 172 && (16...31).contains(a[1]))
            || (a[0] == 100 && (64...127).contains(a[1])) // Tailscale/CGNAT LAN access.
    }
    static func sameOrigin(_ a: URL, _ b: URL) -> Bool {
        func port(_ u: URL) -> Int { u.port ?? (u.scheme == "https" ? 443 : 80) }
        return a.scheme?.lowercased() == b.scheme?.lowercased()
            && a.host?.lowercased() == b.host?.lowercased() && port(a) == port(b)
    }
    static func selfTest() {
        let valid = [initial, "http://localhost:8000", "http://127.0.0.1:8766/", "http://[::1]:8766",
                     "http://172.16.0.1", "http://100.65.58.36:8766", "http://server.local:8766", "https://example.com"]
        let invalid = ["file:///etc/passwd", "javascript:alert(1)", "https://user:pass@example.com",
                       "https://example.com/?key=secret", "https://example.com/#secret", "https://example.com/api",
                       "http://example.com", "http://192.168.999.1", "http://172.32.0.1", "http://localhost:0"]
        for s in valid { precondition(parse(s) != nil, "Valid server was rejected") }
        for s in invalid { precondition(parse(s) == nil, "Invalid server was accepted") }
        precondition(sameOrigin(URL(string: "https://example.com/a")!, URL(string: "https://example.com:443/b")!))
        precondition(!sameOrigin(URL(string: initial)!, URL(string: "http://192.168.2.100:8080")!))
        precondition(!sameOrigin(URL(string: initial)!, URL(string: "http://192.168.2.100.evil.example:8766")!))
        print("PASS: 21 URL and origin assertions")
    }
}

@MainActor final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, NSToolbarDelegate {
    private var window: NSWindow!
    private var web: WKWebView!
    private var failurePanel: NSStackView!
    private var failureText: NSTextField!
    private var endpoint: URL
    private let smokeDirectory: URL?
    private var smokeFinished = false
    private var timeout: Timer?

    init(endpoint: URL, smokeDirectory: URL?) {
        self.endpoint = endpoint; self.smokeDirectory = smokeDirectory
        super.init()
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        installMenus()
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = smokeDirectory == nil ? .default() : .nonPersistent()
        web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = self; web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = true
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1180, height: 820),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Вклад · команда"
        window.minSize = NSSize(width: 760, height: 560)
        window.isReleasedWhenClosed = false
        if smokeDirectory == nil { window.setFrameAutosaveName("VkladMainWindow") }
        let root = NSView()
        window.contentView = root
        root.addSubview(web); web.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([web.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: root.trailingAnchor), web.topAnchor.constraint(equalTo: root.topAnchor),
            web.bottomAnchor.constraint(equalTo: root.bottomAnchor)])
        failureText = NSTextField(wrappingLabelWithString: "")
        failureText.alignment = .center
        let retry = NSButton(title: "Повторить подключение", target: self, action: #selector(reloadPage))
        let settings = NSButton(title: "Адрес сервера…", target: self, action: #selector(changeServer))
        failurePanel = NSStackView(views: [failureText, retry, settings])
        failurePanel.orientation = .vertical; failurePanel.spacing = 20; failurePanel.isHidden = true
        root.addSubview(failurePanel); failurePanel.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([failurePanel.centerXAnchor.constraint(equalTo: root.centerXAnchor),
            failurePanel.centerYAnchor.constraint(equalTo: root.centerYAnchor), failurePanel.widthAnchor.constraint(equalToConstant: 500)])
        let toolbar = NSToolbar(identifier: "VkladToolbar")
        toolbar.delegate = self; toolbar.displayMode = .iconAndLabel
        window.toolbar = toolbar; window.toolbarStyle = .unified
        window.center(); window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
        if smokeDirectory != nil {
            timeout = Timer.scheduledTimer(withTimeInterval: 35, repeats: false) { [weak self] _ in
                MainActor.assumeIsolated { self?.finishSmoke(false, reason: "Timed out loading the real server") }
            }
        }
        reloadPage()
    }
    private func installMenus() {
        let menu = NSMenu()
        let app = NSMenuItem(); let appMenu = NSMenu(); app.submenu = appMenu; menu.addItem(app)
        let settings = NSMenuItem(title: "Адрес сервера…", action: #selector(changeServer), keyEquivalent: ",")
        settings.target = self; appMenu.addItem(settings); appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Завершить Вклад", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let edit = NSMenuItem(); edit.title = "Правка"; edit.submenu = NSMenu(title: "Правка")
        for (title, action, key) in [("Отменить", "undo:", "z"), ("Вырезать", "cut:", "x"),
                                    ("Копировать", "copy:", "c"), ("Вставить", "paste:", "v"), ("Выделить всё", "selectAll:", "a")] {
            edit.submenu!.addItem(withTitle: title, action: Selector(action), keyEquivalent: key)
        }
        menu.addItem(edit)
        let view = NSMenuItem(); view.title = "Вид"; view.submenu = NSMenu(title: "Вид")
        let reload = NSMenuItem(title: "Обновить", action: #selector(reloadPage), keyEquivalent: "r")
        reload.target = self; view.submenu!.addItem(reload)
        let browser = NSMenuItem(title: "Открыть в браузере", action: #selector(openBrowser), keyEquivalent: "")
        browser.target = self; view.submenu!.addItem(browser); menu.addItem(view)
        let win = NSMenuItem(); win.title = "Окно"; win.submenu = NSMenu(title: "Окно")
        win.submenu!.addItem(withTitle: "Свернуть", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        win.submenu!.addItem(withTitle: "Закрыть", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        menu.addItem(win); NSApp.windowsMenu = win.submenu; NSApp.mainMenu = menu
    }
    func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        return [.init("reload"), .init("server"), .flexibleSpace, .init("browser")]
    }
    func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        return toolbarAllowedItemIdentifiers(toolbar)
    }
    func toolbar(_ toolbar: NSToolbar, itemForItemIdentifier id: NSToolbarItem.Identifier,
                 willBeInsertedIntoToolbar flag: Bool) -> NSToolbarItem? {
        let values: [String: (String, String, Selector)] = [
            "reload": ("Обновить", "arrow.clockwise", #selector(reloadPage)),
            "server": ("Сервер", "network", #selector(changeServer)),
            "browser": ("В браузере", "safari", #selector(openBrowser))]
        guard let value = values[id.rawValue] else { return nil }
        let item = NSToolbarItem(itemIdentifier: id); item.label = value.0; item.toolTip = value.0
        item.image = NSImage(systemSymbolName: value.1, accessibilityDescription: value.0)
        item.target = self; item.action = value.2; return item
    }
    @objc private func reloadPage() {
        failurePanel.isHidden = true; web.isHidden = false
        window.subtitle = endpoint.absoluteString
        var request = URLRequest(url: endpoint)
        request.timeoutInterval = 20
        web.load(request)
    }
    @objc private func openBrowser() { NSWorkspace.shared.open(endpoint) }
    @objc private func changeServer() {
        let alert = NSAlert(); alert.messageText = "Сервер команды"
        alert.informativeText = "Общая база остаётся на сервере. HTTP разрешён только для локальной сети/VPN; для интернета используйте HTTPS. Приложение не записывает экран."
        let field = NSTextField(string: endpoint.absoluteString)
        field.frame = NSRect(x: 0, y: 0, width: 460, height: 26)
        alert.accessoryView = field; alert.addButton(withTitle: "Подключиться"); alert.addButton(withTitle: "Отмена")
        alert.window.initialFirstResponder = field
        if alert.runModal() == .alertFirstButtonReturn {
            guard let next = ServerAddress.parse(field.stringValue) else {
                showAlert("Адрес не принят", "Укажите корневой HTTP(S)-адрес сервера без пароля, query-параметров и путей API.")
                return
            }
            endpoint = next
            if smokeDirectory == nil { UserDefaults.standard.set(next.absoluteString, forKey: "serverURL") }
            reloadPage()
        }
    }
    private func showAlert(_ title: String, _ message: String) {
        let alert = NSAlert(); alert.messageText = title; alert.informativeText = message; alert.runModal()
    }
    private func showFailure(_ error: String) {
        if smokeDirectory != nil { finishSmoke(false, reason: error); return }
        web.isHidden = true; failurePanel.isHidden = false
        failureText.stringValue = "Не удалось открыть сервер команды.\n\n\(endpoint.absoluteString)\n\nПроверьте локальную сеть или VPN.\n\(error)\n\nНовая пустая база вместо общей не создаётся."
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code != NSURLErrorCancelled { showFailure(error.localizedDescription) }
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code != NSURLErrorCancelled { showFailure(error.localizedDescription) }
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        showFailure("Процесс веб-интерфейса завершился. Нажмите «Повторить подключение».")
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if ServerAddress.sameOrigin(url, endpoint) { decisionHandler(.allow); return }
        decisionHandler(.cancel)
        if action.navigationType == .linkActivated, ["https", "http"].contains(url.scheme ?? "") {
            NSWorkspace.shared.open(url)
        } else if action.targetFrame?.isMainFrame != false {
            showFailure("Сервер попытался перейти на другой адрес. Измените адрес явно через меню «Сервер».")
        }
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, ["http", "https"].contains(url.scheme ?? "") {
            if ServerAddress.sameOrigin(url, endpoint) { webView.load(navigationAction.request) }
            else if navigationAction.navigationType == .linkActivated { NSWorkspace.shared.open(url) }
        }
        return nil
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        showAlert("Вклад", message); completionHandler()
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert(); alert.messageText = "Вклад"; alert.informativeText = message
        alert.addButton(withTitle: "Подтвердить"); alert.addButton(withTitle: "Отмена")
        completionHandler(alert.runModal() == .alertFirstButtonReturn)
    }
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel(); panel.canChooseDirectories = false; panel.canChooseFiles = true
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.allowedContentTypes = [.json]; panel.prompt = "Выбрать просмотренный экспорт"
        panel.beginSheetModal(for: window) { result in completionHandler(result == .OK ? panel.urls : nil) }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard smokeDirectory != nil, !smokeFinished else { return }
        // Real WebKit + real server, read-only. No team members or ledger entries are created.
        webView.evaluateJavaScript("JSON.stringify({title:document.title,login:!!document.querySelector('#login-form'),work:!!document.querySelector('#work-form'),importer:!!document.querySelector('#evidence-file'),warning:document.body.innerText.includes('Запись экрана отсюда не запускается.')})") { [weak self] value, error in
            guard let self = self else { return }
            guard error == nil, let string = value as? String, let data = string.data(using: .utf8),
                  let info = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  info["login"] as? Bool == true, info["work"] as? Bool == true,
                  info["importer"] as? Bool == true, info["warning"] as? Bool == true else {
                self.finishSmoke(false, reason: "Live server DOM did not match the ledger"); return
            }
            self.web.takeSnapshot(with: nil) { image, snapshotError in
                if let image = image, let tiff = image.tiffRepresentation,
                   let bitmap = NSBitmapImageRep(data: tiff), let png = bitmap.representation(using: .png, properties: [:]) {
                    do {
                        try FileManager.default.createDirectory(at: self.smokeDirectory!, withIntermediateDirectories: true)
                        try png.write(to: self.smokeDirectory!.appendingPathComponent("window.png"), options: .atomic)
                    } catch { self.finishSmoke(false, reason: "Cannot save snapshot"); return }
                } else { self.finishSmoke(false, reason: snapshotError?.localizedDescription ?? "No WebKit snapshot"); return }
                self.finishSmoke(true, reason: "Real arm64 WebKit rendered the live ledger, login, work form and JSON input; recording disclaimer present")
            }
        }
    }
    private func finishSmoke(_ passed: Bool, reason: String) {
        guard !smokeFinished, let directory = smokeDirectory else { return }
        smokeFinished = true; timeout?.invalidate()
        let result: [String: Any] = ["passed": passed, "reason": reason, "server": endpoint.absoluteString,
                                   "arch": "arm64", "capture_tested": false, "models_tested": false,
                                   "production_mutations": 0, "time": ISO8601DateFormatter().string(from: Date())]
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let json = try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
            try json.write(to: directory.appendingPathComponent("result.json"), options: .atomic)
            print(String(data: json, encoding: .utf8)!)
        } catch { fputs("Smoke result write failed\n", stderr); exit(2) }
        exit(passed ? 0 : 1)
    }
}

@main struct Main {
    @MainActor static func main() {
        let args = CommandLine.arguments
        if args.contains("--self-test") { ServerAddress.selfTest(); return }
        func value(_ flag: String) -> String? {
            guard let i = args.firstIndex(of: flag), i + 1 < args.count else { return nil }
            return args[i + 1]
        }
        let raw = value("--server") ?? UserDefaults.standard.string(forKey: "serverURL") ?? ServerAddress.initial
        guard let server = ServerAddress.parse(raw) else { fputs("Invalid server URL\n", stderr); exit(2) }
        let smoke = value("--smoke-dir").map { URL(fileURLWithPath: $0, isDirectory: true) }
        let delegate = AppDelegate(endpoint: server, smokeDirectory: smoke)
        let app = NSApplication.shared; app.delegate = delegate
        withExtendedLifetime(delegate) { app.run() }
    }
}
