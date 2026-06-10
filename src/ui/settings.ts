const SETTINGS_KEY = "custom_spotify_settings_v1";

export type AppSettings = {
  rateLimitGuardEnabled: boolean;
};

export const defaultSettings: AppSettings = {
  rateLimitGuardEnabled: true,
};

export function loadSettings(): AppSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultSettings;
    return { ...defaultSettings, ...JSON.parse(raw) };
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(settings: AppSettings) {
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
