import { getElectronBridge } from "./electron";
import { keys, read, write } from "./db";

type BackupStatus = {
  localFolderPath?: string;
  error?: string;
};

export async function initializePropertyFolder(propertyCode: string, propertyName: string) {
  const bridge = getElectronBridge();
  if (!bridge) return null;
  try {
    const folder = await bridge.ensurePropertyFolder(propertyCode, propertyName);
    write(keys.propertyFolder(propertyCode), folder, false);
    const statusKey = keys.cloudBackupStatus(propertyCode);
    const status = read<BackupStatus>(statusKey, {});
    write(statusKey, { ...status, localFolderPath: folder.path, error: undefined }, false);
    return folder;
  } catch (error) {
    const statusKey = keys.cloudBackupStatus(propertyCode);
    const status = read<BackupStatus>(statusKey, {});
    const message =
      error instanceof Error ? error.message : "Could not initialize the local property folder.";
    write(statusKey, { ...status, error: message }, false);
    throw error;
  }
}
