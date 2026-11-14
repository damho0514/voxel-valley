package expo.modules.vvthermal

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.PowerManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.Executor

/**
 * How hot the phone is and whether battery saver is on, plus an event whenever either changes.
 * The game lowers its frame rate on this before Android throttles the CPU/GPU on its own.
 *
 *  - thermal: 0 none/light … 3 severe or worse (PowerManager thermal status, API 29+; 0 below that)
 *  - headroom: PowerManager.getThermalHeadroom(10 s) (API 30+): 1.0 means throttling is about to
 *    start; -1 when unavailable. Android rate-limits it, so it's cached for 2 s.
 *  - lowPower: battery saver
 */
class VvThermalModule : Module() {
  private var thermalListener: Any? = null
  private var powerReceiver: BroadcastReceiver? = null
  private var headroomAt = 0L
  private var headroom = -1.0

  private val context: Context?
    get() = appContext.reactContext

  private fun power(): PowerManager? = context?.getSystemService(Context.POWER_SERVICE) as? PowerManager

  private fun level(status: Int): Int = when {
    status >= PowerManager.THERMAL_STATUS_SEVERE -> 3
    status >= PowerManager.THERMAL_STATUS_MODERATE -> 2
    status >= PowerManager.THERMAL_STATUS_LIGHT -> 1
    else -> 0
  }

  private fun snapshot(): Map<String, Any> {
    val pm = power() ?: return mapOf("thermal" to 0, "lowPower" to false, "headroom" to -1.0)
    val thermal = if (Build.VERSION.SDK_INT >= 29) level(pm.currentThermalStatus) else 0
    if (Build.VERSION.SDK_INT >= 30) {
      val now = System.currentTimeMillis()
      if (now - headroomAt >= 2000) {
        headroomAt = now
        val h = pm.getThermalHeadroom(10)
        headroom = if (h.isNaN()) headroom else h.toDouble()
      }
    }
    return mapOf("thermal" to thermal, "lowPower" to pm.isPowerSaveMode, "headroom" to headroom)
  }

  override fun definition() = ModuleDefinition {
    Name("VvThermal")

    Events("onChange")

    Function("state") {
      snapshot()
    }

    OnStartObserving {
      val pm = power() ?: return@OnStartObserving
      val ctx = context ?: return@OnStartObserving
      if (Build.VERSION.SDK_INT >= 29) {
        val listener = PowerManager.OnThermalStatusChangedListener { sendEvent("onChange", snapshot()) }
        val direct = Executor { it.run() }
        pm.addThermalStatusListener(direct, listener)
        thermalListener = listener
      }
      val receiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context?, i: Intent?) {
          sendEvent("onChange", snapshot())
        }
      }
      val filter = IntentFilter(PowerManager.ACTION_POWER_SAVE_MODE_CHANGED)
      // A system broadcast, so not-exported still receives it (and Android 14 requires the flag).
      if (Build.VERSION.SDK_INT >= 33) ctx.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
      else ctx.registerReceiver(receiver, filter)
      powerReceiver = receiver
    }

    OnStopObserving {
      val pm = power()
      if (Build.VERSION.SDK_INT >= 29) {
        (thermalListener as? PowerManager.OnThermalStatusChangedListener)?.let { pm?.removeThermalStatusListener(it) }
      }
      thermalListener = null
      powerReceiver?.let { r -> try { context?.unregisterReceiver(r) } catch (e: IllegalArgumentException) { /* already gone */ } }
      powerReceiver = null
    }
  }
}
