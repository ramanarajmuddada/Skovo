// ── Push notifications (Expo) ────────────────────────────────────────────────
// Requests permission, gets the Expo push token, and registers it with the
// backend (POST /notifications/register-device).
//
// Safe no-op whenever push cannot work — simulator, permission refused, or no
// EAS project id — so it never blocks or noisily fails the auth flow.
import { Platform } from 'react-native';
import Constants from 'expo-constants';

/** The EAS project the push token is minted against.
 *
 *  SDK 49+ requires this: `getExpoPushTokenAsync()` with no projectId throws
 *  "Calling getExpoPushTokenAsync without specifying a projectId is deprecated",
 *  which is what fired on every login. Expo exposes it in two places depending
 *  on how the app was started, so check both.
 *
 *  Set it once in app.json and push starts working:
 *      "extra": { "eas": { "projectId": "<uuid from `eas project:info`>" } }
 */
function getProjectId() {
  return (
    Constants?.expoConfig?.extra?.eas?.projectId ||
    Constants?.easConfig?.projectId ||
    null
  );
}

export async function registerForPush(client) {
  try {
    const Notifications = require('expo-notifications');
    const Device = require('expo-device');
    if (!Device.isDevice) return;   // simulators can't get a token

    // Without a project id the token call throws. Skipping quietly is the right
    // outcome — push is not configured yet, and that is not a login failure.
    const projectId = getProjectId();
    if (!projectId) return;

    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (existing !== 'granted') {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') return;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = tokenData?.data;
    if (!token) return;

    // Persist on the backend (device_tokens table). No-ops gracefully if absent.
    await client.post('/notifications/register-device', { token, platform: Platform.OS });
  } catch {
    // push is best-effort; never throw into the auth flow
  }
}
