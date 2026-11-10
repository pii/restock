import "server-only";
import { getDb } from "./db";

export type Settings = {
  /** How often each tracked product is re-checked. */
  checkIntervalMinutes: number;
  /** Send a notification when a product becomes available. */
  notifyOnAvailable: boolean;
  /** Send a notification when a product stops being available. */
  notifyOnUnavailable: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  checkIntervalMinutes: 5,
  notifyOnAvailable: true,
  notifyOnUnavailable: false,
};

export const CHECK_INTERVAL_LIMITS = { min: 1, max: 1440 } as const;

export function getSettings(): Settings {
  const rows = getDb().prepare("SELECT key, value FROM settings").all() as {
    key: string;
    value: string;
  }[];
  const stored: Record<string, unknown> = {};
  for (const { key, value } of rows) {
    try {
      stored[key] = JSON.parse(value);
    } catch {
      // Ignore a corrupt value and fall back to the default.
    }
  }
  const settings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (typeof stored[key] === typeof DEFAULT_SETTINGS[key]) {
      (settings as Record<string, unknown>)[key] = stored[key];
    }
  }
  return settings;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const db = getDb();
  const upsert = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  db.transaction(() => {
    for (const [key, value] of Object.entries(patch)) {
      if (key in DEFAULT_SETTINGS && value !== undefined) {
        upsert.run(key, JSON.stringify(value));
      }
    }
  })();
  return getSettings();
}
