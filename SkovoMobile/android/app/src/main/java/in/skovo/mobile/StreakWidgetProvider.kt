package `in`.skovo.mobile

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews

/**
 * Home-screen streak widget (feature-updates.md §7 item N, §11).
 * Shows what the app last saved through WidgetBridge; tapping opens the app.
 * It never calls the network itself, so it needs no token.
 */
class StreakWidgetProvider : AppWidgetProvider() {

  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    for (id in ids) manager.updateAppWidget(id, views(context))
  }

  companion object {
    const val PREFS = "skovo_widget"

    fun refreshAll(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, StreakWidgetProvider::class.java))
      for (id in ids) manager.updateAppWidget(id, views(context))
    }

    private fun views(context: Context): RemoteViews {
      val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val streak = p.getInt("streak", 0)
      val kept = p.getBoolean("kept", false)
      val atRisk = p.getBoolean("at_risk", false)
      val goal = p.getString("goal", "") ?: ""

      val v = RemoteViews(context.packageName, R.layout.streak_widget)
      v.setTextViewText(R.id.widget_streak, "🔥 $streak")
      v.setTextViewText(R.id.widget_status, when {
        kept -> "Kept today ✓"
        atRisk -> "Do one task today"
        streak == 0 -> "Start your streak"
        else -> "Keep it going"
      })
      v.setTextViewText(R.id.widget_goal, goal)

      val open = context.packageManager.getLaunchIntentForPackage(context.packageName)
        ?: Intent(context, MainActivity::class.java)
      val pi = PendingIntent.getActivity(context, 0, open,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      v.setOnClickPendingIntent(R.id.widget_root, pi)
      return v
    }
  }
}
