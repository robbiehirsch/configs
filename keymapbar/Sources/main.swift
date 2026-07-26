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
import WebKit

let contentDir = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("configs/keymapbar/content")

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

final class PanelController: NSViewController {
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

        webView = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
        webView.translatesAutoresizingMaskIntoConstraints = false

        seg = NSSegmentedControl(
            labels: files.isEmpty ? ["no content"] : files.map(tabName),
            trackingMode: .selectOne, target: self, action: #selector(switchTab))
        seg.selectedSegment = 0
        seg.controlSize = .small

        let reload = NSButton(title: "↻", target: self, action: #selector(reloadContent))
        reload.bezelStyle = .texturedRounded
        reload.controlSize = .small
        reload.toolTip = "Re-scan content directory"

        let spacer = NSView()
        spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        var headerViews: [NSView] = [seg, spacer, reload]

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
        self.preferredContentSize = NSSize(width: 460, height: 620)
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
        webView.loadFileURL(files[idx], allowingReadAccessTo: contentDir)
    }

    @objc func switchTab() { loadCurrent() }

    @objc func reloadContent() {
        files = htmlFiles()
        let labels = files.isEmpty ? ["no content"] : files.map(tabName)
        seg.segmentCount = labels.count
        for (i, l) in labels.enumerated() { seg.setLabel(l, forSegment: i) }
        seg.selectedSegment = 0
        loadCurrent()
    }

    @objc func expand() { AppDelegate.shared?.openWindow() }

    @objc func togglePin(_ sender: NSButton) {
        guard let w = view.window else { return }
        w.level = (sender.state == .on) ? .floating : .normal
    }
    @objc func quit() { NSApp.terminate(nil) }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
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
