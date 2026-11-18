import { keys, listStoredKeys, read, write } from "./db";
import { supabase } from "@/integrations/supabase/client";
import { getElectronBridge, type PropertyFolderInfo } from "./electron";
import { getCurrentUser } from "./auth";
import { isPrivateMessageForStaff } from "./privateMessages";

const BACKUP_FORMAT = "gilnet-property-backup";
const BACKUP_VERSION = 1;
const MAX_BACKUP_SIZE = 25 * 1024 * 1024;
export const SUPABASE_BACKUP_BUCKET = "gilnet-backups";
const SUPABASE_BACKUP_MIGRATION = "supabase/migrations/20261116060000_property_backups_storage.sql";
const operationKinds = ["rooms", "reservations", "notices", "messages", "menu", "sales"] as const;
const keysForKind: Record<(typeof operationKinds)[number], (code: string) => string> = {
  rooms: keys.rooms,
  reservations: keys.reservations,
  notices: keys.notices,
  messages: (code) => keys.messages(code, "All Staff"),
  menu: keys.menu,
  sales: keys.sales,
};
const messagePrefix = (code: string) => `gilnet_cloud250_messages_${code}_`;
const directMessagePrefix = (code: string) => `gilnet_cloud250_direct_messages_${code}_`;

export type DriveBackup = {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  propertyCode: string;
  createdAt: string;
  records: Record<string, unknown>;
};

export type SupabaseBackupFile = { path: string; createdAt: string };
export type PropertyBackupResult = SupabaseBackupFile & {
  recordCount: number;
  localFolder?: PropertyFolderInfo;
  localError?: string;
};

function normalizedCode(code: string) {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z0-9 _-]{1,32}$/.test(normalized)) {
    throw new Error("The property code is invalid for a Drive backup.");
  }
  return normalized;
}

function assertBackupAccess(code: string) {
  const session = getCurrentUser();
  if (
    !session ||
    session.property_code !== code ||
    !["Admin", "Manager", "Supervisor"].includes(session.role)
  ) {
    throw new Error(
      "Only a property administrator, manager, or supervisor can access property backups.",
    );
  }
}

function backupStorageError(message: string) {
  if (/bucket not found|nosuchbucket/i.test(message)) {
    return `The private "${SUPABASE_BACKUP_BUCKET}" bucket is missing. Apply ${SUPABASE_BACKUP_MIGRATION} to the Supabase project.`;
  }
  return message;
}

function isOwnedDirectMessageKey(key: string, code: string, staffId?: string) {
  if (!staffId || !key.startsWith(directMessagePrefix(code))) return false;
  return key.slice(directMessagePrefix(code).length).split("_").includes(staffId);
}

function isBackupKey(key: string, code: string, staffId?: string) {
  const fixedKeys = [
    keys.property(code),
    keys.rooms(code),
    keys.reservations(code),
    keys.notices(code),
    keys.menu(code),
    keys.sales(code),
    keys.outbox(code),
    keys.revisions(code),
  ];
  return (
    fixedKeys.includes(key) ||
    key.startsWith(messagePrefix(code)) ||
    isOwnedDirectMessageKey(key, code, staffId)
  );
}

export async function createDriveBackup(propertyCode: string): Promise<DriveBackup> {
  const code = normalizedCode(propertyCode);
  const session = getCurrentUser();
  const staffId = session?.staff_id ?? session?.token;
  const records: Record<string, unknown> = {};
  const storedKeys = await listStoredKeys();

  for (const key of storedKeys) {
    if (!isBackupKey(key, code, staffId)) continue;
    const value = read(key, null);
    if (key === keys.outbox(code) && isObject(value)) {
      records[key] = Object.fromEntries(
        Object.entries(value).filter(([, change]) => {
          if (!isObject(change) || typeof change["localKey"] !== "string") return true;
          const localKey = change["localKey"];
          return (
            !localKey.startsWith(directMessagePrefix(code)) ||
            (isOwnedDirectMessageKey(localKey, code, staffId) &&
              isPrivateMessageForStaff(change["payload"], staffId ?? ""))
          );
        }),
      );
    } else {
      records[key] = value;
    }
  }

  const backup: DriveBackup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    propertyCode: code,
    createdAt: new Date().toISOString(),
    records,
  };
  if (JSON.stringify(backup).length > MAX_BACKUP_SIZE) {
    throw new Error("This property backup exceeds 25 MB.");
  }
  return backup;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isExpectedRecordValue(key: string, value: unknown, code: string) {
  if (key === keys.property(code)) {
    return value === null || isObject(value);
  }
  if (key === keys.outbox(code) || key === keys.revisions(code)) {
    return isObject(value);
  }
  return Array.isArray(value);
}

function isValidOutbox(value: unknown, code: string, staffId?: string) {
  if (!isObject(value)) return false;
  return Object.entries(value).every(([queueId, change]) => {
    if (!isObject(change)) return false;
    const kind = change["kind"];
    const id = change["id"];
    const localKey = change["localKey"];
    if (
      typeof kind !== "string" ||
      !operationKinds.includes(kind as (typeof operationKinds)[number]) ||
      typeof id !== "string" ||
      queueId !== `${kind}:${id}` ||
      typeof change["deleted"] !== "boolean" ||
      !isObject(change["payload"]) ||
      typeof localKey !== "string"
    ) {
      return false;
    }
    if (kind === "messages") {
      return (
        localKey.startsWith(messagePrefix(code)) ||
        (isOwnedDirectMessageKey(localKey, code, staffId) &&
          isPrivateMessageForStaff(change["payload"], staffId ?? ""))
      );
    }
    return localKey === keysForKind[kind as (typeof operationKinds)[number]](code);
  });
}

function isValidRevisions(value: unknown) {
  if (!isObject(value)) return false;
  return Object.entries(value).every(([key, revision]) => {
    const separator = key.indexOf(":");
    const kind = key.slice(0, separator);
    return (
      separator > 0 &&
      operationKinds.includes(kind as (typeof operationKinds)[number]) &&
      typeof revision === "number" &&
      Number.isInteger(revision) &&
      revision >= 0
    );
  });
}

export function parseDriveBackup(input: unknown, expectedPropertyCode: string): DriveBackup {
  const code = normalizedCode(expectedPropertyCode);
  const session = getCurrentUser();
  const staffId = session?.staff_id ?? session?.token;
  if (
    !isObject(input) ||
    input["format"] !== BACKUP_FORMAT ||
    input["version"] !== BACKUP_VERSION
  ) {
    throw new Error("This Google Drive file is not a supported GILNET property backup.");
  }
  if (input["propertyCode"] !== code) {
    throw new Error("This backup belongs to a different property.");
  }
  if (
    typeof input["createdAt"] !== "string" ||
    Number.isNaN(Date.parse(input["createdAt"])) ||
    !isObject(input["records"])
  ) {
    throw new Error("The Google Drive backup is incomplete or invalid.");
  }
  if (JSON.stringify(input).length > MAX_BACKUP_SIZE) {
    throw new Error("This property backup exceeds 25 MB.");
  }

  const records: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input["records"])) {
    if (!isBackupKey(key, code, staffId) || !isExpectedRecordValue(key, value, code)) {
      throw new Error("The backup contains unsupported or out-of-scope property data.");
    }
    if (key === keys.outbox(code) && !isValidOutbox(value, code, staffId)) {
      throw new Error("The backup contains an invalid pending sync queue.");
    }
    if (key === keys.revisions(code) && !isValidRevisions(value)) {
      throw new Error("The backup contains invalid sync revisions.");
    }
    records[key] = value;
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    propertyCode: code,
    createdAt: input["createdAt"],
    records,
  };
}

function rowId(value: unknown, key: string) {
  if (!isObject(value)) return JSON.stringify(value);
  const id = key.startsWith("gilnet_cloud250_rooms_") ? value["number"] : value["id"];
  return typeof id === "string" || typeof id === "number" ? String(id) : JSON.stringify(value);
}

function mergeArrays(key: string, backupRows: unknown[], localRows: unknown[]) {
  const rows = new Map<string, unknown>();
  for (const row of backupRows) rows.set(rowId(row, key), row);
  for (const row of localRows) rows.set(rowId(row, key), row);
  return [...rows.values()];
}

function mergeRecord(key: string, backupValue: unknown, localValue: unknown) {
  if (key.startsWith("gilnet_cloud250_outbox_") || key.startsWith("gilnet_cloud250_revisions_")) {
    return {
      ...(isObject(backupValue) ? backupValue : {}),
      ...(isObject(localValue) ? localValue : {}),
    };
  }
  if (Array.isArray(backupValue) && Array.isArray(localValue)) {
    return mergeArrays(key, backupValue, localValue);
  }
  if (isObject(backupValue) && isObject(localValue)) return { ...backupValue, ...localValue };
  return localValue ?? backupValue;
}

export function restoreDriveBackup(input: unknown, propertyCode: string) {
  const backup = parseDriveBackup(input, propertyCode);
  for (const [key, value] of Object.entries(backup.records)) {
    const localValue = read<unknown>(key, null);
    const merged = mergeRecord(key, value, localValue);
    write(key, merged, false);
  }
  return { recordCount: Object.keys(backup.records).length, createdAt: backup.createdAt };
}

export async function findLatestSupabaseBackup(
  propertyCode: string,
): Promise<SupabaseBackupFile | null> {
  const code = normalizedCode(propertyCode);
  const { data, error } = await supabase.storage.from(SUPABASE_BACKUP_BUCKET).list(code, {
    limit: 1000,
    sortBy: { column: "name", order: "desc" },
  });
  if (error)
    throw new Error(`Could not check Supabase backups: ${backupStorageError(error.message)}`);

  const file = data
    .filter((entry) => entry.id && /^backup-\d+\.json$/.test(entry.name))
    .sort(
      (left, right) =>
        Number(right.name.slice("backup-".length, -".json".length)) -
        Number(left.name.slice("backup-".length, -".json".length)),
    )[0];
  if (!file) return null;
  const timestamp = Number(file.name.slice("backup-".length, -".json".length));
  const createdAt =
    file.created_at ?? (Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "");
  if (!createdAt || Number.isNaN(Date.parse(createdAt))) {
    throw new Error("The latest Supabase backup has an invalid timestamp.");
  }
  return { path: `${code}/${file.name}`, createdAt };
}

export async function backupToSupabase(propertyCode: string): Promise<PropertyBackupResult> {
  const code = normalizedCode(propertyCode);
  assertBackupAccess(code);
  const backup = await createDriveBackup(code);
  const property = backup.records[keys.property(code)];
  const propertyName =
    isObject(property) && typeof property["name"] === "string" ? property["name"] : code;
  const bridge = getElectronBridge();
  let localFolder: PropertyFolderInfo | undefined;
  let localError: string | undefined;

  if (bridge) {
    try {
      localFolder = await bridge.savePropertyBackup(code, propertyName, backup);
    } catch (error) {
      localError =
        error instanceof Error ? error.message : "Could not save the local desktop backup.";
    }
  }

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    throw new Error(
      localError
        ? `Offline: changes remain on this device. The desktop backup also failed: ${localError}`
        : "Offline: changes remain on this device; the cloud backup will retry when online.",
    );
  }

  const path = `${code}/backup-${Date.now()}.json`;
  const body = JSON.stringify(backup);
  const { error } = await supabase.storage.from(SUPABASE_BACKUP_BUCKET).upload(path, body, {
    contentType: "application/json",
    upsert: true,
  });
  if (error) {
    throw new Error(
      localError
        ? `Supabase backup failed: ${backupStorageError(error.message)}. The desktop backup also failed: ${localError}`
        : `Supabase backup failed: ${backupStorageError(error.message)}`,
    );
  }

  return {
    path,
    createdAt: backup.createdAt,
    recordCount: Object.keys(backup.records).length,
    ...(localFolder ? { localFolder } : {}),
    ...(localError ? { localError } : {}),
  };
}

export async function restoreFromSupabase(
  propertyCode: string,
  backupPath?: string,
): Promise<{ recordCount: number; createdAt: string }> {
  const code = normalizedCode(propertyCode);
  assertBackupAccess(code);
  const selected = backupPath ? { path: backupPath } : await findLatestSupabaseBackup(code);
  if (!selected) throw new Error("No Supabase backup exists for this property yet.");
  if (!new RegExp(`^${code}/backup-\\d+\\.json$`).test(selected.path)) {
    throw new Error("The selected backup path is invalid for this property.");
  }

  const { data, error } = await supabase.storage
    .from(SUPABASE_BACKUP_BUCKET)
    .download(selected.path);
  if (error)
    throw new Error(`Could not download the Supabase backup: ${backupStorageError(error.message)}`);

  let input: unknown;
  try {
    input = JSON.parse(await data.text()) as unknown;
  } catch {
    throw new Error("The Supabase backup is not valid JSON.");
  }
  return restoreDriveBackup(input, code);
}
