// Offline-first local store. Every write goes to localStorage first; cloud sync is best-effort.
import { useSyncExternalStore } from "react";

const EVENT = "gilnet-store";
const OFFLINE_DB = "gilnet-offline-v1";
const OFFLINE_STORE = "records";
let offlineDbPromise: Promise<IDBDatabase> | null = null;
let hydrationPromise: Promise<void> | null = null;
const memoryValues = new Map<string, unknown>();
const memoryFallbackKeys = new Set<string>();
const memoryDeletedKeys = new Set<string>();
const invalidListWarnings = new Set<string>();

function normalizeStoredValue<T>(key: string, value: unknown, fallback: T): T {
  if (Array.isArray(fallback) && !Array.isArray(value)) {
    if (!invalidListWarnings.has(key)) {
      console.warn("GILNET stored list data is invalid", key);
      invalidListWarnings.add(key);
    }
    return fallback;
  }
  return value as T;
}

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function openOfflineDb() {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB is unavailable."));
  if (!offlineDbPromise) {
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(OFFLINE_DB, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(OFFLINE_STORE)) {
          request.result.createObjectStore(OFFLINE_STORE, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Could not open offline storage."));
    });
    offlineDbPromise = opening.catch((error) => {
      offlineDbPromise = null;
      throw error;
    });
  }
  return offlineDbPromise;
}

async function persistOfflineRecord(key: string, value: unknown) {
  const db = await openOfflineDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE, "readwrite");
    tx.objectStore(OFFLINE_STORE).put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not persist offline data."));
    tx.onabort = () => reject(tx.error ?? new Error("Offline data write was aborted."));
  });
}

async function removeOfflineRecord(key: string) {
  const db = await openOfflineDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE, "readwrite");
    tx.objectStore(OFFLINE_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not remove offline data."));
    tx.onabort = () => reject(tx.error ?? new Error("Offline data removal was aborted."));
  });
}

export function hydrateLocalStorageFromIndexedDB() {
  const storage = getStorage();
  if (typeof window === "undefined") return Promise.resolve();
  if (hydrationPromise) return hydrationPromise;
  hydrationPromise = (async () => {
    try {
      const db = await openOfflineDb();
      const records = await new Promise<Array<{ key: string; value: unknown }>>((resolve, reject) => {
        const tx = db.transaction(OFFLINE_STORE, "readonly");
        const request = tx.objectStore(OFFLINE_STORE).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Could not restore offline data."));
      });
      for (const record of records) {
        if (memoryDeletedKeys.has(record.key)) continue;
        const serialized = JSON.stringify(record.value);
        if (serialized === undefined) continue;
        if (storage) {
          try {
            if (storage.getItem(record.key) !== null) continue;
            storage.setItem(record.key, serialized);
          } catch (error) {
            memoryValues.set(record.key, record.value);
            memoryFallbackKeys.add(record.key);
            console.warn("GILNET localStorage restore failed", error);
          }
        } else {
          memoryValues.set(record.key, record.value);
          memoryFallbackKeys.add(record.key);
        }
        cache.delete(record.key);
        window.dispatchEvent(new CustomEvent(EVENT, { detail: { key: record.key, value: record.value, sync: false } }));
      }
    } catch (error) {
      console.warn("GILNET IndexedDB restore failed", error);
    }
  })();
  return hydrationPromise;
}

export function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  if (memoryDeletedKeys.has(key)) return fallback;
  const storage = getStorage();
  if (!storage || memoryFallbackKeys.has(key)) {
    return memoryValues.has(key) ? normalizeStoredValue(key, memoryValues.get(key), fallback) : fallback;
  }
  try {
    const raw = storage.getItem(key);
    return raw ? normalizeStoredValue(key, JSON.parse(raw), fallback) : fallback;
  } catch (error) {
    console.warn("GILNET localStorage read failed", error);
    return memoryValues.has(key) ? normalizeStoredValue(key, memoryValues.get(key), fallback) : fallback;
  }
}

export function write<T>(key: string, value: T, sync = true) {
  if (typeof window === "undefined") return;
  const storage = getStorage();
  const previous = read<unknown>(key, null);
  memoryValues.set(key, value);
  memoryDeletedKeys.delete(key);
  invalidListWarnings.delete(key);
  if (storage) {
    try {
      storage.setItem(key, JSON.stringify(value));
      memoryFallbackKeys.delete(key);
    } catch (error) {
      memoryFallbackKeys.add(key);
      console.warn("GILNET localStorage write failed", error);
    }
  } else {
    memoryFallbackKeys.add(key);
  }
  if (typeof indexedDB !== "undefined") {
    void persistOfflineRecord(key, value).catch((error) => console.warn("GILNET IndexedDB write failed", error));
  }
  cache.delete(key);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { key, value, previous, sync } }));
  }
}

export function remove(key: string) {
  if (typeof window === "undefined") return;
  const storage = getStorage();
  memoryValues.delete(key);
  memoryFallbackKeys.delete(key);
  memoryDeletedKeys.add(key);
  if (storage) {
    try {
      storage.removeItem(key);
    } catch (error) {
      console.warn("GILNET localStorage remove failed", error);
    }
  }
  if (typeof indexedDB !== "undefined") {
    void removeOfflineRecord(key).catch((error) => console.warn("GILNET IndexedDB remove failed", error));
  }
  cache.delete(key);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { key, sync: false } }));
  }
}

export async function listStoredKeys() {
  const found = new Set<string>(memoryValues.keys());
  const storage = getStorage();
  if (storage) {
    try {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key) found.add(key);
      }
    } catch (error) {
      console.warn("GILNET localStorage key listing failed", error);
    }
  }
  if (typeof indexedDB !== "undefined") {
    const db = await openOfflineDb();
    const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const tx = db.transaction(OFFLINE_STORE, "readonly");
      const request = tx.objectStore(OFFLINE_STORE).getAllKeys();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Could not list offline data."));
    });
    for (const key of keys) {
      if (typeof key === "string" && !memoryDeletedKeys.has(key)) found.add(key);
    }
  }
  return [...found].filter((key) => !memoryDeletedKeys.has(key));
}

const cache = new Map<string, { raw: string | null; value: unknown }>();

function subscribe(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function useStored<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  return useSyncExternalStore(
    subscribe,
    () => {
      if (memoryDeletedKeys.has(key)) return fallback;
      const storage = getStorage();
      if (!storage || memoryFallbackKeys.has(key)) {
        return memoryValues.has(key) ? normalizeStoredValue(key, memoryValues.get(key), fallback) : fallback;
      }
      let raw: string | null;
      try {
        raw = storage.getItem(key);
      } catch (error) {
        console.warn("GILNET localStorage read failed", error);
        return memoryValues.has(key) ? normalizeStoredValue(key, memoryValues.get(key), fallback) : fallback;
      }
      const hit = cache.get(key);
      if (hit && hit.raw === raw) return hit.value as T;
      let value: T = fallback;
      try {
        if (raw) value = normalizeStoredValue(key, JSON.parse(raw), fallback);
      } catch (error) {
        console.warn("GILNET localStorage data is invalid", error);
        if (memoryValues.has(key)) value = normalizeStoredValue(key, memoryValues.get(key), fallback);
      }
      cache.set(key, { raw, value });
      return value;
    },
    () => fallback,
  );
}

export const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

export const keys = {
  users: (c: string) => `gilnet_cloud250_users_${c}`,
  property: (c: string) => `gilnet_cloud250_property_${c}`,
  rooms: (c: string) => `gilnet_cloud250_rooms_${c}`,
  reservations: (c: string) => `gilnet_cloud250_reservations_${c}`,
  notices: (c: string) => `gilnet_cloud250_notices_${c}`,
  messages: (c: string, dept: string) => `gilnet_cloud250_messages_${c}_${dept}`,
  directMessages: (c: string, firstStaffId: string, secondStaffId: string) =>
    `gilnet_cloud250_direct_messages_${c}_${[firstStaffId, secondStaffId].sort().join("_")}`,
  appPreferences: (c: string, staffId: string) =>
    `gilnet_app_preferences_${c}_${staffId}`,
  menu: (c: string) => `gilnet_cloud250_menu_${c}`,
  sales: (c: string) => `gilnet_cloud250_sales_${c}`,
  outbox: (c: string) => `gilnet_cloud250_outbox_${c}`,
  revisions: (c: string) => `gilnet_cloud250_revisions_${c}`,
  syncConflicts: (c: string) => `gilnet_cloud250_sync_conflicts_${c}`,
  appVersion: (c: string) => `gilnet_cloud250_app_version_${c}`,
  propertyFolder: (c: string) => `gilnet_cloud250_property_folder_${c}`,
  cloudBackupStatus: (c: string) => `gilnet_cloud250_backup_status_${c}`,
  driveClientId: "gilnet_google_drive_client_id",
  session: "gilnet_cloud250_session",
  remembered: "gilnet_cloud250_remembered",
};
