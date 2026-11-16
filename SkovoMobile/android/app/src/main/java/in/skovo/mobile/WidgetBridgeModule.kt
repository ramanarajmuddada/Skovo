package `in`.skovo.mobile

import android.content.Context
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/** JS → widget: NativeModules.WidgetBridge.update(streak, kept, atRisk, goalText). */
class WidgetBridgeModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  override fun getName() = "WidgetBridge"

  @ReactMethod
  fun update(streak: Int, kept: Boolean, atRisk: Boolean, goal: String?) {
    ctx.getSharedPreferences(StreakWidgetProvider.PREFS, Context.MODE_PRIVATE).edit()
      .putInt("streak", streak)
      .putBoolean("kept", kept)
      .putBoolean("at_risk", atRisk)
      .putString("goal", goal ?: "")
      .apply()
    StreakWidgetProvider.refreshAll(ctx)
  }

  @ReactMethod
  fun clear() {
    ctx.getSharedPreferences(StreakWidgetProvider.PREFS, Context.MODE_PRIVATE).edit().clear().apply()
    StreakWidgetProvider.refreshAll(ctx)
  }
}
