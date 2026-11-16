// Feeds the Android home-screen streak widget (android/.../StreakWidgetProvider.kt).
// Safe no-op on iOS, Expo Go, or a build without the native module.
import { NativeModules, Platform } from 'react-native';
import { studentApi } from './api';

const bridge = Platform.OS === 'android' ? NativeModules.WidgetBridge : null;

export async function refreshWidget() {
  if (!bridge) return;
  try {
    const { data } = await studentApi.get('/engagement/widget');
    if (!data?.bool) return;
    const r = data.response;
    const goal = r.goal_need ? `Goal ${r.goal_done || 0}/${r.goal_need}` : '';
    bridge.update(Number(r.streak) || 0, !!r.kept_today, !!r.at_risk, goal);
  } catch { /* the widget just keeps its last value */ }
}

export function clearWidget() {
  try { bridge?.clear(); } catch { /* ignore */ }
}
