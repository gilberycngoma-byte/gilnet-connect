import type { DriveBackup } from "./driveBackup";

export type DriveStatus = { connected: boolean; email: string };
export type PropertyFolderInfo = {
  path: string;
  databasePath: string;
  backupPath: string;
  createdAt: string;
};
export type DesktopUpdateCheck = {
  available: boolean;
  version: string;
  releaseNotes: string;
};

export type GilnetElectron = {
  checkForUpdates: () => Promise<DesktopUpdateCheck>;
  update: () => Promise<void>;
  ensurePropertyFolder: (propertyId: string, propertyName: string) => Promise<PropertyFolderInfo>;
  savePropertyBackup: (
    propertyId: string,
    propertyName: string,
    backup: DriveBackup,
  ) => Promise<PropertyFolderInfo>;
  openPropertyFolder: (propertyId: string) => Promise<void>;
  onBeforeClose: (callback: () => void) => () => void;
  completeCloseBackup: () => void;
  driveStatus: () => Promise<DriveStatus>;
  connectDrive: (clientId: string) => Promise<DriveStatus>;
  disconnectDrive: () => Promise<DriveStatus>;
  backupDrive: (clientId: string, backup: DriveBackup) => Promise<{ modifiedTime: string }>;
  restoreDrive: (clientId: string, propertyCode: string) => Promise<DriveBackup | null>;
  saveSupabaseServiceRoleKey: (key: string) => Promise<void>;
  openOAuthUrl: (url: string) => Promise<void>;
  setBubbles: (state: {
    attendance: boolean;
    messages: boolean;
    notices: boolean;
    messagesUnread: number;
    noticesUnread: number;
  }) => void;
  onAuthCallback: (callback: (url: string) => void) => Promise<() => void>;
};

declare global {
  interface Window {
    gilnetElectron?: GilnetElectron;
  }
}

export function getElectronBridge() {
  return typeof window === "undefined" ? undefined : window.gilnetElectron;
}
