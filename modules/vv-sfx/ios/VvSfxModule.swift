import AVFoundation
import ExpoModulesCore

/// Game sound effects: each sound is decoded once into a few AVAudioPlayers (so rapid repeats
/// overlap), and play() hands the work to a serial queue and returns at once, so the game's JS
/// thread never waits on audio.
public final class VvSfxModule: Module {
  private let queue = DispatchQueue(label: "vv.sfx", qos: .userInteractive)
  private var sounds: [Int: [AVAudioPlayer]] = [:]
  private var cursor: [Int: Int] = [:]
  private var nextId = 1

  public func definition() -> ModuleDefinition {
    Name("VvSfx")

    /// Decodes a local file URI; resolves with an id for play(), or 0 on failure.
    AsyncFunction("load") { (uri: String) -> Int in
      guard let url = URL(string: uri) else { return 0 }
      var players: [AVAudioPlayer] = []
      for _ in 0..<3 {
        guard let p = try? AVAudioPlayer(contentsOf: url) else { break }
        p.prepareToPlay()
        players.append(p)
      }
      if players.isEmpty { return 0 }
      return self.queue.sync {
        let id = self.nextId
        self.nextId += 1
        self.sounds[id] = players
        self.cursor[id] = 0
        return id
      }
    }

    /// Starts a sound without blocking. Returns false if the id is unknown.
    Function("play") { (id: Int, volume: Double) -> Bool in
      self.queue.async {
        guard let players = self.sounds[id], !players.isEmpty else { return }
        let i = self.cursor[id] ?? 0
        self.cursor[id] = (i + 1) % players.count
        let p = players[i]
        p.volume = Float(max(0, min(1, volume)))
        p.currentTime = 0
        p.play()
      }
      return true
    }
  }
}
