// ── Open external links (video join, invoice, etc.) ──────────────────────────
import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';

export async function openLink(url) {
  if (!url) return;
  try {
    await WebBrowser.openBrowserAsync(url, { dismissButtonStyle: 'close', toolbarColor: '#6366F1' });
  } catch {
    Linking.openURL(url).catch(() => {});
  }
}
