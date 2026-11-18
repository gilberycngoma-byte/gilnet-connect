import { keys, read, write } from "./db";
import type { Role } from "./types";

export type AppPreferences = {
  theme: "light" | "dark";
  messageNotifications: boolean;
  desktopNotifications: boolean;
  checkInNotices: boolean;
};

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  theme: "light",
  messageNotifications: true,
  desktopNotifications: false,
  checkInNotices: false,
};

export function getDefaultAppPreferences(role?: Role): AppPreferences {
  return {
    ...DEFAULT_APP_PREFERENCES,
    checkInNotices:
      role === "Front Desk" ||
      role === "Admin" ||
      role === "Manager" ||
      role === "Supervisor",
  };
}

export function getAppPreferences(
  propertyCode: string,
  staffId: string,
  role?: Role,
): AppPreferences {
  const saved = read<Partial<AppPreferences>>(keys.appPreferences(propertyCode, staffId), {});
  return { ...getDefaultAppPreferences(role), ...saved };
}

export function updateAppPreferences(
  propertyCode: string,
  staffId: string,
  patch: Partial<AppPreferences>,
  role?: Role,
) {
  const updated = {
    ...getAppPreferences(propertyCode, staffId, role),
    ...patch,
  };
  write(keys.appPreferences(propertyCode, staffId), updated, false);
  return updated;
}

export function applyTheme(theme: AppPreferences["theme"]) {
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }
}
