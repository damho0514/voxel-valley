import Cocoa
import WebKit

// Voxel Valley for Mac: a plain window around the web build, so it starts like a game
// (Dock icon, own window, no address bar) and keeps its save data between launches.

let gameURL = URL(string: "https://damho0514.github.io/voxel-valley/play/")!
let fullKey = "fullscreen"

// The page asks for fullscreen the browser way (requestFullscreen), and Esc would throw it back
// out. Here those calls drive the Mac's own fullscreen instead, which Esc doesn't leave:
// Esc only pauses the game, and ⌘ + Enter switches between window and fullscreen.
let fullscreenShim = """
(() => {
  const post = (m) => window.webkit.messageHandlers.vv.postMessage(m);
  let full = false;
  const get = { get() { return full ? document.documentElement : null; }, configurable: true };
  Object.defineProperty(Document.prototype, 'fullscreenElement', get);
  Object.defineProperty(Document.prototype, 'webkitFullscreenElement', get);
  Element.prototype.requestFullscreen = function () { post('enter'); return Promise.resolve(); };
  Element.prototype.webkitRequestFullscreen = function () { post('enter'); };
  Document.prototype.exitFullscreen = function () { post('exit'); return Promise.resolve(); };
  Document.prototype.webkitExitFullscreen = function () { post('exit'); };
  window.__vvNativeFull = (on) => {
    if (full === on) return;
    full = on;
    document.dispatchEvent(new Event('fullscreenchange'));
  };
})();
"""

/// Esc belongs to the game (pause). When the page lets it through, WebKit hands "cancel" up the
/// responder chain and the fullscreen frame would leave fullscreen; stop it at the web view.
final class GameWebView: WKWebView {
  override func cancelOperation(_ sender: Any?) {}
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKUIDelegate, WKNavigationDelegate, WKScriptMessageHandler {
  var window: NSWindow!
  var web: WKWebView!

  func applicationDidFinishLaunching(_ note: Notification) {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .default()
    config.preferences.isElementFullscreenEnabled = true
    config.mediaTypesRequiringUserActionForPlayback = []
    config.applicationNameForUserAgent = "Version/18.0 Safari/605.1.15 VoxelValleyMac"
    config.userContentController.addUserScript(
      WKUserScript(source: fullscreenShim, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    config.userContentController.add(self, name: "vv")
    UserDefaults.standard.register(defaults: [fullKey: true])

    web = GameWebView(frame: .zero, configuration: config)
    web.uiDelegate = self
    web.navigationDelegate = self
    web.allowsBackForwardNavigationGestures = false
    web.setValue(false, forKey: "drawsBackground")

    let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
    let size = NSSize(width: min(1440, screen.width * 0.85), height: min(900, screen.height * 0.85))
    window = NSWindow(
      contentRect: NSRect(origin: .zero, size: size),
      styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
      backing: .buffered, defer: false)
    window.title = "Voxel Valley"
    window.titlebarAppearsTransparent = true
    window.backgroundColor = NSColor(red: 0.047, green: 0.071, blue: 0.133, alpha: 1)
    window.contentView = web
    window.delegate = self
    window.collectionBehavior = [.fullScreenPrimary]
    window.setFrameAutosaveName("VoxelValleyMain")
    if !window.setFrameUsingName("VoxelValleyMain") { window.center() }
    window.makeKeyAndOrderFront(nil)

    buildMenu()
    web.load(URLRequest(url: gameURL))
    NSApp.activate(ignoringOtherApps: true)
    // Starts the way it was last left: fullscreen like a game, unless ⌘ + Enter chose a window.
    if UserDefaults.standard.bool(forKey: fullKey) {
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { self.setFull(true) }
    }
  }

  var isFull: Bool { window.styleMask.contains(.fullScreen) }
  func setFull(_ on: Bool) { if on != isFull { window.toggleFullScreen(nil) } }

  @objc func toggleFull() { setFull(!isFull) }

  func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
    switch message.body as? String {
    case "enter": setFull(true)
    case "exit": setFull(false)
    default: break
    }
  }

  func tellPage() { web.evaluateJavaScript("window.__vvNativeFull && window.__vvNativeFull(\(isFull))") }
  func windowDidEnterFullScreen(_ n: Notification) { UserDefaults.standard.set(true, forKey: fullKey); tellPage() }
  func windowDidExitFullScreen(_ n: Notification) { UserDefaults.standard.set(false, forKey: fullKey); tellPage() }
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { tellPage() }

  func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }

  // MARK: menu

  func buildMenu() {
    let main = NSMenu()
    let appItem = NSMenuItem(); main.addItem(appItem)
    let appMenu = NSMenu()
    appMenu.addItem(withTitle: "Voxel Valley 정보", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
    appMenu.addItem(.separator())
    appMenu.addItem(withTitle: "Voxel Valley 숨기기", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
    appMenu.addItem(.separator())
    appMenu.addItem(withTitle: "Voxel Valley 종료", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    appItem.submenu = appMenu

    // Edit menu so ⌘C/⌘V/⌘A work in the chat box.
    let editItem = NSMenuItem(); main.addItem(editItem)
    let edit = NSMenu(title: "편집")
    edit.addItem(withTitle: "실행 취소", action: Selector(("undo:")), keyEquivalent: "z")
    edit.addItem(withTitle: "잘라내기", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
    edit.addItem(withTitle: "복사", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
    edit.addItem(withTitle: "붙여넣기", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
    edit.addItem(withTitle: "모두 선택", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
    editItem.submenu = edit

    let viewItem = NSMenuItem(); main.addItem(viewItem)
    let view = NSMenu(title: "보기")
    view.addItem(withTitle: "새로고침", action: #selector(reload), keyEquivalent: "r")
    // ⌘ + Enter anywhere (mid-game the page takes it first and asks for the same thing); ⌃⌘F too.
    view.addItem(withTitle: "창 모드 ↔ 전체 화면", action: #selector(toggleFull), keyEquivalent: "\r")
    let fs = NSMenuItem(title: "창 모드 ↔ 전체 화면", action: #selector(toggleFull), keyEquivalent: "f")
    fs.keyEquivalentModifierMask = [.command, .control]
    fs.isAlternate = false
    view.addItem(fs)
    viewItem.submenu = view

    NSApp.mainMenu = main
  }

  @objc func reload() { web.load(URLRequest(url: gameURL)) }

  // MARK: web view

  // "사진 제출" opens a file input; WKWebView needs us to show the panel.
  func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
               initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = parameters.allowsMultipleSelection
    panel.canChooseDirectories = false
    panel.allowedContentTypes = [.image]
    panel.beginSheetModal(for: window) { res in completionHandler(res == .OK ? panel.urls : nil) }
  }

  func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
               initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
               decisionHandler: @escaping (WKPermissionDecision) -> Void) {
    decisionHandler(.prompt)
  }

  // Links that open a new window (README, store pages…) go to the normal browser.
  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
               for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let url = action.request.url { NSWorkspace.shared.open(url) }
    return nil
  }

  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
               decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    if let url = action.request.url, action.targetFrame?.isMainFrame == true,
       let host = url.host, host != gameURL.host, url.scheme?.hasPrefix("http") == true {
      NSWorkspace.shared.open(url); decisionHandler(.cancel); return
    }
    decisionHandler(.allow)
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation nav: WKNavigation!, withError error: Error) {
    offline()
  }

  func offline() {
    let html = """
    <html><body style="margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
      background:#0c1222;color:#f3e7cf;font:600 18px -apple-system;gap:18px">
      <div style="font-size:42px">📡</div><div>인터넷에 연결되면 Voxel Valley를 시작할 수 있어요.</div>
      <button onclick="location.href='\(gameURL.absoluteString)'" style="font:700 16px -apple-system;padding:10px 22px;
        border-radius:10px;border:0;background:#e9b330;color:#2a1d14;cursor:pointer">다시 시도</button>
    </body></html>
    """
    web.loadHTMLString(html, baseURL: nil)
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
