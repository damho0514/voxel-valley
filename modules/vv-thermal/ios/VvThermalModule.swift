import ExpoModulesCore
import Foundation

/// How hot the phone is (ProcessInfo.thermalState) and whether Low Power Mode is on, plus an
/// event whenever either changes. The game uses it to lower its frame rate before iOS throttles
/// the CPU/GPU (and dims the screen) on its own.
public final class VvThermalModule: Module {
  private var observers: [NSObjectProtocol] = []

  private func snapshot() -> [String: Any] {
    let info = ProcessInfo.processInfo
    let level: Int
    switch info.thermalState {
    case .nominal: level = 0
    case .fair: level = 1
    case .serious: level = 2
    case .critical: level = 3
    @unknown default: level = 0
    }
    // iOS has no headroom forecast; -1 means "not available".
    return ["thermal": level, "lowPower": info.isLowPowerModeEnabled, "headroom": -1.0]
  }

  public func definition() -> ModuleDefinition {
    Name("VvThermal")

    Events("onChange")

    /// { thermal: 0 nominal … 3 critical, lowPower: Bool, headroom: -1 }
    Function("state") { () -> [String: Any] in
      return self.snapshot()
    }

    OnStartObserving {
      let center = NotificationCenter.default
      let send: (Notification) -> Void = { [weak self] _ in
        guard let self = self else { return }
        self.sendEvent("onChange", self.snapshot())
      }
      self.observers = [
        center.addObserver(forName: ProcessInfo.thermalStateDidChangeNotification, object: nil, queue: nil, using: send),
        center.addObserver(forName: Notification.Name.NSProcessInfoPowerStateDidChange, object: nil, queue: nil, using: send),
      ]
    }

    OnStopObserving {
      for o in self.observers { NotificationCenter.default.removeObserver(o) }
      self.observers = []
    }
  }
}
