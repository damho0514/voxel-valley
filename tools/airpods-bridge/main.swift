// Voxel Valley AirPods bridge (macOS 14+).
//
// Browsers can't read AirPods' head tracking, so this small menu-bar app does: it recognizes the
// AirPods (CMHeadphoneMotionManager + the Mac's current audio output name) and streams the head's
// attitude to the web game over a WebSocket on this Mac only (ws://127.0.0.1:47800). The game turns
// the view with it, like a mouse.
//
//   Messages (JSON text frames):
//     {"t":"s", "connected":Bool, "name":String?, "bluetooth":Bool, "bud":String?, "supported":Bool,
//      "auth":String, "fake":Bool}                                                                 status
//     {"t":"m", "yaw":Double, "pitch":Double, "roll":Double}                                      motion, radians
//
//   "bud" is which earbud's sensor is speaking: "left", "right" or "both" (the AirPods pick one; it
//   changes when that one comes out). "bluetooth" says the Mac's sound goes to a Bluetooth device,
//   which together with the name tells real AirPods from, say, the Mac's speakers.
//
//   --fake   no AirPods needed: sends a slow synthetic head sway (for tests).

import AppKit
import CoreAudio
import CoreMotion
import Network

let port: UInt16 = 47800
/** Pages allowed to connect: local dev servers and the published game. Non-browser clients send no Origin. */
let allowedOrigins = ["http://localhost", "http://127.0.0.1", "https://damho0514.github.io"]
let fake = CommandLine.arguments.contains("--fake")

func originAllowed(_ origin: String?) -> Bool {
  guard let origin, !origin.isEmpty else { return true }
  return allowedOrigins.contains { origin == $0 || origin.hasPrefix($0 + ":") }
}

/** Whether the Mac's current audio output is a Bluetooth device (AirPods are). */
func outputIsBluetooth() -> Bool {
  var id = AudioDeviceID(0)
  var size = UInt32(MemoryLayout<AudioDeviceID>.size)
  var addr = AudioObjectPropertyAddress(
    mSelector: kAudioHardwarePropertyDefaultOutputDevice,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain)
  guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &id) == noErr else { return false }
  var transport = UInt32(0)
  size = UInt32(MemoryLayout<UInt32>.size)
  addr.mSelector = kAudioDevicePropertyTransportType
  guard AudioObjectGetPropertyData(id, &addr, 0, nil, &size, &transport) == noErr else { return false }
  return transport == kAudioDeviceTransportTypeBluetooth || transport == kAudioDeviceTransportTypeBluetoothLE
}

/** Name of the Mac's current audio output (e.g. "담호의 AirPods"), which is where the motion comes from. */
func outputDeviceName() -> String? {
  var id = AudioDeviceID(0)
  var size = UInt32(MemoryLayout<AudioDeviceID>.size)
  var addr = AudioObjectPropertyAddress(
    mSelector: kAudioHardwarePropertyDefaultOutputDevice,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain)
  guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &id) == noErr else { return nil }
  var name: Unmanaged<CFString>?
  size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
  addr.mSelector = kAudioObjectPropertyName
  guard AudioObjectGetPropertyData(id, &addr, 0, nil, &size, &name) == noErr, let name else { return nil }
  return name.takeRetainedValue() as String
}

final class Bridge: NSObject, CMHeadphoneMotionManagerDelegate {
  let motion = CMHeadphoneMotionManager()
  var listener: NWListener?
  var clients: [ObjectIdentifier: NWConnection] = [:]
  var connected = false
  var lastMotion = Date.distantPast
  /** Which earbud's sensor the motion comes from. */
  var bud: String?
  var statusItem: NSStatusItem?
  let stateLine = NSMenuItem(title: "", action: nil, keyEquivalent: "")
  let clientLine = NSMenuItem(title: "", action: nil, keyEquivalent: "")

  func start() {
    setUpMenu()
    startServer()
    if fake { startFake() } else { startMotion() }
    refresh()
  }

  // MARK: menu bar

  func setUpMenu() {
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    let menu = NSMenu()
    menu.addItem(withTitle: "Voxel Valley 에어팟 브리지", action: nil, keyEquivalent: "")
    menu.addItem(.separator())
    menu.addItem(stateLine)
    menu.addItem(clientLine)
    menu.addItem(.separator())
    let quit = NSMenuItem(title: "종료", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    menu.addItem(quit)
    item.menu = menu
    statusItem = item
  }

  func authLabel() -> String {
    switch CMHeadphoneMotionManager.authorizationStatus() {
    case .authorized: return "authorized"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .notDetermined: return "notDetermined"
    @unknown default: return "unknown"
    }
  }

  func refresh() {
    let name = fake ? "테스트용 가짜 에어팟" : outputDeviceName()
    statusItem?.button?.title = connected ? "🎧●" : "🎧○"
    if !fake && !motion.isDeviceMotionAvailable {
      stateLine.title = "이 Mac은 헤드폰 움직임을 지원하지 않아요"
    } else if !fake && authLabel() == "denied" {
      stateLine.title = "권한 거부됨: 시스템 설정 › 개인정보 보호 › 동작 및 피트니스"
    } else {
      let side = bud == "left" ? " · 왼쪽" : bud == "right" ? " · 오른쪽" : ""
      stateLine.title = connected ? "인식됨: \(name ?? "에어팟")\(side)" : "에어팟을 연결하면 인식돼요"
    }
    clientLine.title = clients.isEmpty ? "게임 연결 없음" : "게임 \(clients.count)개 연결됨"
    broadcast(statusMessage(name: name))
  }

  func statusMessage(name: String?) -> [String: Any] {
    var m: [String: Any] = [
      "t": "s", "connected": connected, "supported": fake || motion.isDeviceMotionAvailable,
      "auth": fake ? "authorized" : authLabel(), "fake": fake,
    ]
    if let name { m["name"] = name }
    if let bud { m["bud"] = bud }
    m["bluetooth"] = fake || outputIsBluetooth()
    return m
  }

  // MARK: AirPods motion

  func startMotion() {
    motion.delegate = self
    guard motion.isDeviceMotionAvailable else { return }
    motion.startDeviceMotionUpdates(to: .main) { [weak self] m, _ in
      guard let self, let m else { return }
      self.lastMotion = Date()
      if !self.connected { self.connected = true; self.refresh() }
      let side: String
      switch m.sensorLocation {
      case .headphoneLeft: side = "left"
      case .headphoneRight: side = "right"
      default: side = "both"
      }
      if side != self.bud { self.bud = side; self.refresh() }
      let a = m.attitude
      self.broadcast(["t": "m", "yaw": a.yaw, "pitch": a.pitch, "roll": a.roll])
    }
    // Motion stops arriving when the AirPods come out of the ears or switch to another device.
    Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
      guard let self, self.connected, Date().timeIntervalSince(self.lastMotion) > 2 else { return }
      self.connected = false
      self.refresh()
    }
  }

  func headphoneMotionManagerDidConnect(_ manager: CMHeadphoneMotionManager) {
    connected = true
    refresh()
  }

  func headphoneMotionManagerDidDisconnect(_ manager: CMHeadphoneMotionManager) {
    connected = false
    refresh()
  }

  func startFake() {
    connected = true
    bud = "right"
    let t0 = Date()
    Timer.scheduledTimer(withTimeInterval: 1.0 / 30, repeats: true) { [weak self] _ in
      let t = Date().timeIntervalSince(t0)
      self?.broadcast(["t": "m", "yaw": 0.4 * sin(t * 0.8), "pitch": 0.15 * sin(t * 1.3), "roll": 0.0])
    }
  }

  // MARK: WebSocket server (this Mac only)

  func startServer() {
    let ws = NWProtocolWebSocket.Options()
    ws.autoReplyPing = true
    ws.setClientRequestHandler(.main) { _, headers in
      let origin = headers.first { $0.name.lowercased() == "origin" }?.value
      let ok = originAllowed(origin)
      if !ok { NSLog("rejected origin %@", origin ?? "") }
      return NWProtocolWebSocket.Response(status: ok ? .accept : .reject, subprotocol: nil, additionalHeaders: nil)
    }
    let params = NWParameters.tcp
    params.defaultProtocolStack.applicationProtocols.insert(ws, at: 0)
    params.allowLocalEndpointReuse = true
    params.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!)
    do {
      let l = try NWListener(using: params)
      l.newConnectionHandler = { [weak self] c in self?.accept(c) }
      l.stateUpdateHandler = { state in
        if case .failed(let e) = state {
          NSLog("listener failed: %@", "\(e)")
          let alert = NSAlert()
          alert.messageText = "에어팟 브리지를 시작하지 못했어요"
          alert.informativeText = "포트 \(port)를 다른 프로그램이 쓰고 있을 수 있어요. 이미 켜져 있는지 메뉴 막대를 확인하세요.\n\(e)"
          alert.runModal()
          NSApp.terminate(nil)
        }
      }
      l.start(queue: .main)
      listener = l
    } catch {
      NSLog("listener error: %@", "\(error)")
    }
  }

  func accept(_ c: NWConnection) {
    let id = ObjectIdentifier(c)
    c.stateUpdateHandler = { [weak self, weak c] state in
      guard let self, let c else { return }
      switch state {
      case .ready:
        self.clients[id] = c
        self.refresh()
        self.receive(c)
      case .failed, .cancelled:
        self.clients[id] = nil
        self.refresh()
      default: break
      }
    }
    c.start(queue: .main)
  }

  /** Keep reading so a closed tab is noticed (the game never sends anything that matters). */
  func receive(_ c: NWConnection) {
    c.receiveMessage { [weak self, weak c] _, _, _, error in
      guard let self, let c else { return }
      if error != nil { c.cancel(); return }
      self.receive(c)
    }
  }

  func broadcast(_ obj: [String: Any]) {
    guard !clients.isEmpty, let data = try? JSONSerialization.data(withJSONObject: obj) else { return }
    let meta = NWProtocolWebSocket.Metadata(opcode: .text)
    let ctx = NWConnection.ContentContext(identifier: "vv", metadata: [meta])
    for c in clients.values {
      c.send(content: data, contentContext: ctx, isComplete: true, completion: .idempotent)
    }
  }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
  let bridge = Bridge()
  func applicationDidFinishLaunching(_ notification: Notification) {
    bridge.start()
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
