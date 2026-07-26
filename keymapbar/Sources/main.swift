// KeymapBar — a menu-bar keymap viewer.
//
// Left-click the keyboard icon → popover showing HTML keymap cards.
// "Window" button → the same content in a real resizable window.
// Content = any *.html files in ~/configs/keymapbar/content/ — tabs are
// created per file, alphabetically. Design lives entirely in the HTML;
// this app is just a frame around a WKWebView.
//
// Build: ./build.sh   (single swiftc invocation, no Xcode project)

import Cocoa
import CoreSpotlight
import UniformTypeIdentifiers
import WebKit

let contentDir = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("configs/keymapbar/content")

// JS enhancement layer (search / chips / collapsible sections), injected into
// every page. Editable without rebuilding — press ↻ in the app after changes.
let enhanceJSURL = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("configs/keymapbar/enhance.js")

enum Prefs {
    static let defaults = UserDefaults.standard
    static var zoom: CGFloat {
        get {
            let z = defaults.double(forKey: "zoom")
            return z == 0 ? 1.0 : CGFloat(z)
        }
        set { defaults.set(Double(newValue), forKey: "zoom") }
    }
    static var follow: Bool {
        get { defaults.bool(forKey: "followTerminalApps") }
        set { defaults.set(newValue, forKey: "followTerminalApps") }
    }
}

func htmlFiles() -> [URL] {
    let urls = (try? FileManager.default.contentsOfDirectory(
        at: contentDir, includingPropertiesForKeys: nil)) ?? []
    return urls.filter { $0.pathExtension == "html" }
        .sorted { $0.lastPathComponent < $1.lastPathComponent }
}

func tabName(_ url: URL) -> String {
    // "10-nvim.html" -> "nvim" (numeric prefixes control tab order)
    var name = url.deletingPathExtension().lastPathComponent
    if let r = name.range(of: #"^\d+-"#, options: .regularExpression) {
        name.removeSubrange(r)
    }
    return name
}

final class PanelController: NSViewController, WKNavigationDelegate {
    let isPopover: Bool
    var files: [URL] = []
    var webView: WKWebView!
    var seg: NSSegmentedControl!

    init(isPopover: Bool) {
        self.isPopover = isPopover
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError() }

    override func loadView() {
        files = htmlFiles()

        let config = WKWebViewConfiguration()
        PanelController.installEnhancer(into: config.userContentController)
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.pageZoom = Prefs.zoom

        seg = NSSegmentedControl(
            labels: files.isEmpty ? ["no content"] : files.map(tabName),
            trackingMode: .selectOne, target: self, action: #selector(switchTab))
        seg.selectedSegment = 0
        seg.controlSize = .small

        let reload = NSButton(title: "↻", target: self, action: #selector(reloadContent))
        reload.bezelStyle = .texturedRounded
        reload.controlSize = .small
        reload.toolTip = "Re-scan content directory"

        let zoomOutBtn = NSButton(title: "A\u{2212}", target: self, action: #selector(zoomOut))
        zoomOutBtn.bezelStyle = .texturedRounded
        zoomOutBtn.controlSize = .small
        zoomOutBtn.toolTip = "Smaller text (all tabs, remembered)"
        let zoomInBtn = NSButton(title: "A+", target: self, action: #selector(zoomIn))
        zoomInBtn.bezelStyle = .texturedRounded
        zoomInBtn.controlSize = .small
        zoomInBtn.toolTip = "Larger text (all tabs, remembered)"

        let spacer = NSView()
        spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        var headerViews: [NSView] = [seg, spacer, zoomOutBtn, zoomInBtn, reload]

        if isPopover {
            let expand = NSButton(title: "Window", target: self, action: #selector(expand))
            expand.bezelStyle = .texturedRounded
            expand.controlSize = .small
            expand.toolTip = "Open as a resizable window"
            let quit = NSButton(title: "Quit", target: self, action: #selector(quit))
            quit.bezelStyle = .texturedRounded
            quit.controlSize = .small
            headerViews.append(expand)
            headerViews.append(quit)
        } else {
            // Pin: keep the window above every other app while you type in it
            let pin = NSButton(title: "Pin", target: self, action: #selector(togglePin(_:)))
            pin.bezelStyle = .texturedRounded
            pin.controlSize = .small
            pin.setButtonType(.pushOnPushOff)
            pin.toolTip = "Keep this window on top of other apps"
            headerViews.append(pin)

            // Follow: window appears when iTerm/Terminal is frontmost, hides
            // when anything else takes focus. Pin's opinionated sibling.
            let follow = NSButton(title: "Follow iTerm", target: self, action: #selector(toggleFollow(_:)))
            follow.bezelStyle = .texturedRounded
            follow.controlSize = .small
            follow.setButtonType(.pushOnPushOff)
            follow.state = Prefs.follow ? .on : .off
            follow.toolTip = "Auto-show over iTerm/Terminal, auto-hide elsewhere"
            headerViews.append(follow)
        }

        let header = NSStackView(views: headerViews)
        header.orientation = .horizontal
        header.spacing = 6
        header.edgeInsets = NSEdgeInsets(top: 8, left: 10, bottom: 6, right: 10)
        header.translatesAutoresizingMaskIntoConstraints = false

        let root = NSView()
        root.addSubview(header)
        root.addSubview(webView)
        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: root.topAnchor),
            header.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            header.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            webView.topAnchor.constraint(equalTo: header.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: root.bottomAnchor),
        ])
        self.view = root
        if isPopover {
            self.preferredContentSize = NSSize(width: 460, height: 620)
        }
        loadCurrent()
    }

    func loadCurrent() {
        guard !files.isEmpty else {
            webView.loadHTMLString(
                "<body style='font-family:-apple-system;padding:2em;color:#888'>"
                + "Drop .html files into<br><code>~/configs/keymapbar/content/</code>"
                + "<br>then press ↻</body>", baseURL: nil)
            return
        }
        let idx = max(0, min(seg.selectedSegment, files.count - 1))
        webView.pageZoom = Prefs.zoom
        webView.loadFileURL(files[idx], allowingReadAccessTo: contentDir)
    }

    @objc func switchTab() { loadCurrent() }

    @objc func reloadContent() {
        PanelController.installEnhancer(into: webView.configuration.userContentController)
        AppDelegate.shared?.reindexSpotlight()
        files = htmlFiles()
        let labels = files.isEmpty ? ["no content"] : files.map(tabName)
        seg.segmentCount = labels.count
        for (i, l) in labels.enumerated() { seg.setLabel(l, forSegment: i) }
        seg.selectedSegment = 0
        loadCurrent()
    }

    static func installEnhancer(into controller: WKUserContentController) {
        controller.removeAllUserScripts()
        if let js = try? String(contentsOf: enhanceJSURL, encoding: .utf8) {
            controller.addUserScript(WKUserScript(
                source: js, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
    }

    @objc func zoomIn() { setZoom(Prefs.zoom + 0.1) }
    @objc func zoomOut() { setZoom(Prefs.zoom - 0.1) }
    func setZoom(_ z: CGFloat) {
        Prefs.zoom = min(max(z, 0.5), 2.5)
        webView.pageZoom = Prefs.zoom
    }

    // Spotlight deep-link: switch to the right tab, then run the search once
    // the page has loaded (enhance.js exposes window.__kbSearch).
    var pendingQuery: String?

    func showSearch(tab: String, query: String) {
        files = htmlFiles()
        if let idx = files.firstIndex(where: { $0.lastPathComponent.hasPrefix(tab) }) {
            seg.selectedSegment = idx
        }
        pendingQuery = query
        loadCurrent()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let q = pendingQuery else { return }
        pendingQuery = nil
        let esc = q.replacingOccurrences(of: "\\", with: "\\\\")
                   .replacingOccurrences(of: "\"", with: "\\\"")
        webView.evaluateJavaScript("window.__kbSearch && window.__kbSearch(\"\(esc)\")",
                                   completionHandler: nil)
    }

    @objc func toggleFollow(_ sender: NSButton) {
        AppDelegate.shared?.setFollow(sender.state == .on)
    }

    @objc func expand() { AppDelegate.shared?.openWindow() }

    @objc func togglePin(_ sender: NSButton) {
        guard let w = view.window else { return }
        w.level = (sender.state == .on) ? .floating : .normal
    }
    @objc func quit() { NSApp.terminate(nil) }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSPopoverDelegate {
    static var shared: AppDelegate?
    var statusItem: NSStatusItem!
    let popover = NSPopover()
    var window: NSWindow?

    func applicationDidFinishLaunching(_ n: Notification) {
        AppDelegate.shared = self
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = statusItem.button {
            button.image = NSImage(systemSymbolName: "keyboard",
                                   accessibilityDescription: "Keymaps")
            button.action = #selector(togglePopover)
            button.target = self
        }
        popover.behavior = .transient   // closes when you click elsewhere
        popover.contentViewController = PanelController(isPopover: true)
        popover.delegate = self

        NSWorkspace.shared.notificationCenter.addObserver(
            self, selector: #selector(frontAppChanged(_:)),
            name: NSWorkspace.didActivateApplicationNotification, object: nil)

        reindexSpotlight()
    }

    // ── macOS Spotlight ───────────────────────────────────────────────────
    // Index every binding from content/spotlight.json (written by
    // generate.sh). Search "leader gg" in Spotlight → "⌨ <leader>gg — Lazygit"
    // → Enter opens KeymapBar with that key pre-searched.
    func reindexSpotlight() {
        let file = contentDir.appendingPathComponent("spotlight.json")
        guard let data = try? Data(contentsOf: file),
              let list = (try? JSONSerialization.jsonObject(with: data)) as? [[String: String]]
        else { return }

        let items: [CSSearchableItem] = list.enumerated().map { (i, e) in
            let attr = CSSearchableItemAttributeSet(contentType: UTType.text)
            let key = e["key"] ?? ""
            let tab = e["tab"] ?? ""
            attr.title = "\(key) — \(e["desc"] ?? "")"
            attr.contentDescription = "KeymapBar · \(tab.contains("tmux") ? "tmux" : "nvim")"
            attr.keywords = ["keymap", "keybinding", key, e["desc"] ?? ""]
            return CSSearchableItem(
                uniqueIdentifier: "\(tab)|\(key)|\(i)",
                domainIdentifier: "com.rh.keymapbar.keys",
                attributeSet: attr)
        }
        let index = CSSearchableIndex.default()
        index.deleteSearchableItems(withDomainIdentifiers: ["com.rh.keymapbar.keys"]) { _ in
            index.indexSearchableItems(items) { error in
                if let error = error { NSLog("KeymapBar spotlight index failed: \(error)") }
            }
        }
    }

    func application(_ application: NSApplication,
                     continue userActivity: NSUserActivity,
                     restorationHandler: @escaping ([any NSUserActivityRestoring]) -> Void) -> Bool {
        guard userActivity.activityType == CSSearchableItemActionType,
              let id = userActivity.userInfo?[CSSearchableItemActivityIdentifier] as? String
        else { return false }
        let parts = id.split(separator: "|", maxSplits: 2).map(String.init)
        openWindow()
        if parts.count >= 2,
           let panel = window?.contentViewController as? PanelController {
            panel.showSearch(tab: parts[0], query: parts[1])
        }
        return true
    }

    // Drag the popover away from the menu bar → macOS detaches it into a
    // small standalone window with normal (resizable) chrome.
    func popoverShouldDetach(_ popover: NSPopover) -> Bool { true }

    // Apps whose focus summons the window in Follow mode.
    static let followBundleIDs: Set<String> = [
        "com.googlecode.iterm2",
        "com.apple.Terminal",
    ]

    @objc func frontAppChanged(_ note: Notification) {
        guard Prefs.follow,
              let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
              app.processIdentifier != NSRunningApplication.current.processIdentifier
        else { return }
        guard let w = window else { return }
        if let id = app.bundleIdentifier, AppDelegate.followBundleIDs.contains(id) {
            w.level = .floating
            w.orderFrontRegardless()   // show WITHOUT stealing focus from iTerm
        } else {
            w.orderOut(nil)
        }
    }

    func setFollow(_ on: Bool) {
        Prefs.follow = on
        if on {
            if window == nil { openWindow() }
            window?.level = .floating
            window?.orderFrontRegardless()
        } else {
            window?.level = .normal
        }
    }

    @objc func togglePopover() {
        guard let button = statusItem.button else { return }
        if popover.isShown {
            popover.performClose(nil)
        } else {
            popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
            popover.contentViewController?.view.window?.makeKey()
        }
    }

    func openWindow() {
        popover.performClose(nil)
        if window == nil {
            let w = NSWindow(
                contentRect: NSRect(x: 0, y: 0, width: 900, height: 700),
                styleMask: [.titled, .closable, .resizable, .miniaturizable],
                backing: .buffered, defer: false)
            w.title = "Keymaps"
            w.isReleasedWhenClosed = false
            w.contentViewController = PanelController(isPopover: false)
            w.styleMask.insert(.resizable)   // paranoia: survive anything the VC changed
            w.minSize = NSSize(width: 380, height: 280)
            w.setContentSize(NSSize(width: 900, height: 700))
            w.setFrameAutosaveName("KeymapBarWindow")
            w.center()
            window = w
        }
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
