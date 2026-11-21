import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { Network } from "@capacitor/network";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { keys, read, write } from "./db";
import { getCurrentUser, loadIdentity } from "./auth";
import { getAppPreferences } from "./app-preferences";
import { DEPARTMENTS, type Property } from "./types";
import { toast } from "sonner";
import { listPrivateMessages } from "./messages.functions";
import { isMessageSentByStaff, isPrivateMessageForStaff } from "./privateMessages";

type Kind = "rooms" | "reservations" | "notices" | "messages" | "menu" | "sales";
type Row = {
  id?: string;
  number?: string;
  to_department?: string;
  sender_staff_id?: string | null;
  receiver_staff_id?: string | null;
  [key: string]: unknown;
};
type Change = {
  kind: Kind;
  id: string;
  payload: Row;
  deleted: boolean;
  localKey: string;
  basePayload?: Row | null;
};
type Outbox = Record<string, Change>;
type CloudRow = {
  kind: string;
  id: string;
  payload: Json;
  revision: number;
  deleted: boolean;
  receiver_staff_id: string | null;
  is_private: boolean;
};
export type SyncConflict = {
  local: Change;
  remote: CloudRow | null;
  remoteLoaded: boolean;
};
export type SyncConflicts = Record<string, SyncConflict>;
const listKey = (c: string, kind: Kind, dept?: string) =>
  kind === "messages" ? keys.messages(c, dept ?? "All Staff") : keys[kind](c);
const directKeyPrefix = (c: string) => `gilnet_cloud250_direct_messages_${c}_`;

export function syncInBackground(_table: string, _row: unknown) {
  // All writes are captured by the store listener, including deletions.
}

let started = false;
let busy = false;
let stopped = false;
let activeChannel: ReturnType<typeof supabase.channel> | null = null;
let activePropertyCode = "";
let activeStaffId = "";
let nativeNetworkConnected: boolean | null = null;
let nativeNetworkMonitoring = false;
let nativeResumeMonitoring = false;

function status(text: string) {
  write("gilnet_sync_status", text, false);
}

function updateNativeNetworkStatus(connected: boolean) {
  const changed = nativeNetworkConnected !== connected;
  nativeNetworkConnected = connected;
  write("gilnet_network_online", connected, false);
  if (!connected) status("Offline · changes saved on this device");
  else if (changed) void synchronize();
}

function startNativeNetworkMonitoring() {
  if (!Capacitor.isNativePlatform() || nativeNetworkMonitoring) return;
  nativeNetworkMonitoring = true;
  void Network.addListener("networkStatusChange", ({ connected }) => {
    updateNativeNetworkStatus(connected);
  })
    .then(async () => {
      try {
        const { connected } = await Network.getStatus();
        updateNativeNetworkStatus(connected);
      } catch (error: unknown) {
        console.error("Could not check mobile network status.", error);
      }
    })
    .catch((error: unknown) => {
      nativeNetworkMonitoring = false;
      console.error("Could not monitor mobile network status.", error);
    });
}

function startNativeResumeSync() {
  if (!Capacitor.isNativePlatform() || nativeResumeMonitoring) return;
  nativeResumeMonitoring = true;
  void App.addListener("appStateChange", ({ isActive }) => {
    if (!isActive) return;
    void Network.getStatus()
      .then(({ connected }) => updateNativeNetworkStatus(connected))
      .catch((error: unknown) => {
        console.error("Could not refresh mobile network status.", error);
      });
    void synchronize();
  }).catch((error: unknown) => {
    nativeResumeMonitoring = false;
    console.error("Could not monitor mobile app resume events.", error);
  });
}

function connectRealtime() {
  const session = getCurrentUser();
  const staffId = session?.staff_id ?? session?.token ?? "";
  if (
    !session ||
    !staffId ||
    (activePropertyCode === session.property_code && activeStaffId === staffId)
  )
    return;
  if (activeChannel) void supabase.removeChannel(activeChannel);
  activePropertyCode = session.property_code;
  activeStaffId = staffId;
  const code = session.property_code;
  activeChannel = supabase
    .channel(`gpm-staff-${staffId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "operation_rows",
        filter: `receiver_staff_id=eq.${staffId}`,
      },
      (event) => {
        if (event.eventType === "INSERT") {
          const row = event.new as {
            property_code?: string;
            kind?: string;
            is_private?: boolean;
            payload?: Record<string, unknown>;
          };
          const message = row.payload;
          if (
            row.property_code === code &&
            row.kind === "messages" &&
            row.is_private &&
            message &&
            message["receiver_staff_id"] === staffId &&
            isPrivateMessageForStaff(message, staffId) &&
            message["sender_staff_id"] !== staffId
          ) {
            if (getAppPreferences(code, staffId).messageNotifications) {
              const sender =
                typeof message["from_user"] === "string" ? message["from_user"] : "Staff";
              const text =
                typeof message["message"] === "string"
                  ? message["message"]
                  : "Sent you a private message.";
              toast(`Private message from ${sender}`, { description: text.slice(0, 120) });
              if (
                getAppPreferences(code, staffId).desktopNotifications &&
                typeof Notification !== "undefined" &&
                Notification.permission === "granted"
              ) {
                try {
                  new Notification(`Private message from ${sender}`, {
                    body: text.slice(0, 120),
                    icon: "/gilnet-logo.png",
                  });
                } catch (error) {
                  console.warn("Could not display private-message notification", error);
                }
              }
            }
          }
        }
        void synchronize();
      },
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "properties", filter: `code=eq.${code}` },
      (event) => {
        const property = event.new as Property & { code: string };
        if (property.code === code) write(keys.property(code), property, false);
      },
    )
    .subscribe((state) => {
      if (state === "SUBSCRIBED") void synchronize();
      if (state === "CHANNEL_ERROR" || state === "TIMED_OUT")
        console.warn("GILNET realtime connection failed", state);
    });
}

export function startSyncLoop() {
  if (started) return;
  started = true;
  startNativeNetworkMonitoring();
  startNativeResumeSync();
  window.addEventListener("gilnet-store", (event) => {
    const detail = (event as CustomEvent).detail;
    const session = getCurrentUser();
    if (!session || !detail?.sync || !Array.isArray(detail.value)) return;
    const code = session.property_code;
    const kinds: Kind[] = ["rooms", "reservations", "notices", "messages", "menu", "sales"];
    const kind = kinds.find((candidate) =>
      candidate === "messages"
        ? detail.key.startsWith(`gilnet_cloud250_messages_${code}_`) ||
          detail.key.startsWith(directKeyPrefix(code))
        : detail.key === listKey(code, candidate),
    );
    if (!kind) return;

    const before = (Array.isArray(detail.previous) ? detail.previous : []) as Row[];
    const after = detail.value as Row[];
    const id = (row: Row) => String(kind === "rooms" ? row.number : row.id);
    const queue = read<Outbox>(keys.outbox(code), {});
    for (const row of after) {
      if (JSON.stringify(before.find((prior) => id(prior) === id(row))) !== JSON.stringify(row)) {
        const key = `${kind}:${id(row)}`;
        const existing = queue[key];
        const prior = before.find((candidate) => id(candidate) === id(row));
        queue[key] = {
          kind,
          id: id(row),
          payload: row,
          deleted: false,
          localKey: detail.key,
          basePayload: existing ? (existing.basePayload ?? null) : (prior ?? null),
        };
      }
    }
    for (const row of before) {
      if (!after.some((current) => id(current) === id(row))) {
        const key = `${kind}:${id(row)}`;
        const existing = queue[key];
        queue[key] = {
          kind,
          id: id(row),
          payload: row,
          deleted: true,
          localKey: detail.key,
          basePayload: existing ? (existing.basePayload ?? null) : row,
        };
      }
    }
    write(keys.outbox(code), queue, false);
    const conflicts = read<SyncConflicts>(keys.syncConflicts(code), {});
    let updatedConflict = false;
    for (const [key, change] of Object.entries(queue)) {
      if (conflicts[key]) {
        conflicts[key] = { ...conflicts[key], local: change };
        updatedConflict = true;
      }
    }
    if (updatedConflict) write(keys.syncConflicts(code), conflicts, false);
    status("Pending sync");
    void synchronize();
  });
  window.addEventListener("online", () => void synchronize());
  window.addEventListener("focus", () => void synchronize());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void synchronize();
  });
  window.setInterval(() => void synchronize(), 10000);
  connectRealtime();
  void synchronize();
}

function rowId(kind: Kind, row: Row) {
  return String(kind === "rooms" ? row.number : row.id);
}

export function normalizeMessageReceiverForSync(payload: Row): Row {
  const receiverType = payload.receiver_type ?? payload.recipient_type;
  if (receiverType === "department" || receiverType === "all_staffs" || receiverType === "all") {
    return { ...payload, receiver_type: "all" };
  }
  if (receiverType === "individual" || receiverType === "specific") {
    return { ...payload, receiver_type: "specific" };
  }
  return payload;
}

function directConversationKey(code: string, row: Row) {
  const sender = row.sender_staff_id;
  const receiver = row.receiver_staff_id;
  if (typeof sender !== "string" || typeof receiver !== "string") return null;
  return keys.directMessages(code, sender, receiver);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

const missingValue = Symbol("missing");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameJsonValue(left: unknown, right: unknown) {
  if (left === missingValue || right === missingValue) return left === right;
  return stableJson(left) === stableJson(right);
}

function mergeJsonValue(
  base: unknown,
  local: unknown,
  remote: unknown,
): { ok: true; value: unknown } | { ok: false } {
  if (sameJsonValue(local, base)) return { ok: true, value: remote };
  if (sameJsonValue(remote, base) || sameJsonValue(local, remote)) {
    return { ok: true, value: local };
  }
  if (!isRecord(base) || !isRecord(local) || !isRecord(remote)) return { ok: false };

  const keysToMerge = new Set([
    ...Object.keys(base),
    ...Object.keys(local),
    ...Object.keys(remote),
  ]);
  const mergedEntries: [string, unknown][] = [];
  for (const key of keysToMerge) {
    const merged = mergeJsonValue(
      Object.prototype.hasOwnProperty.call(base, key) ? base[key] : missingValue,
      Object.prototype.hasOwnProperty.call(local, key) ? local[key] : missingValue,
      Object.prototype.hasOwnProperty.call(remote, key) ? remote[key] : missingValue,
    );
    if (!merged.ok) return merged;
    if (merged.value !== missingValue) mergedEntries.push([key, merged.value]);
  }
  return { ok: true, value: Object.fromEntries(mergedEntries) };
}

function mergeConcurrentPayload(base: Row, local: Row, remote: Row): Row | null {
  const merged = mergeJsonValue(base, local, remote);
  return merged.ok && isRecord(merged.value) ? merged.value : null;
}

function sameRecordVersion(change: Change, remote: CloudRow | null): remote is CloudRow {
  return (
    !!remote &&
    change.deleted === remote.deleted &&
    stableJson(change.payload) === stableJson(remote.payload)
  );
}

function reconcileEquivalentConflict(
  code: string,
  key: string,
  local: Change,
  remote: CloudRow | null,
): boolean {
  if (!sameRecordVersion(local, remote)) return false;

  const queue = read<Outbox>(keys.outbox(code), {});
  const latestLocal = queue[key] ?? local;
  if (!sameRecordVersion(latestLocal, remote)) return false;
  delete queue[key];
  write(keys.outbox(code), queue, false);

  const revisions = read<Record<string, number>>(keys.revisions(code), {});
  revisions[key] = remote.revision;
  write(keys.revisions(code), revisions, false);

  const conflicts = read<SyncConflicts>(keys.syncConflicts(code), {});
  delete conflicts[key];
  write(keys.syncConflicts(code), conflicts, false);
  return true;
}

function mergeRows(cloud: Row[], changes: Change[], kind: Kind) {
  const ids = new Set(changes.map((change) => change.id));
  const merged = cloud
    .filter((row) => !ids.has(rowId(kind, row)))
    .concat(changes.filter((change) => !change.deleted).map((change) => change.payload));
  if (kind === "rooms") merged.sort((a, b) => Number(a.number) - Number(b.number));
  return merged;
}

export async function synchronize() {
  if (busy || stopped) return;
  let session = getCurrentUser();
  if (!session) return;
  if (
    !(Capacitor.isNativePlatform() && nativeNetworkConnected !== null
      ? nativeNetworkConnected
      : navigator.onLine)
  ) {
    status("Offline · changes saved on this device");
    return;
  }

  busy = true;
  try {
    const {
      data: { session: authSession },
      error: authError,
    } = await supabase.auth.getSession();
    if (authError) throw authError;
    if (!authSession) {
      status("Sign in again to sync changes.");
      return;
    }
    if (session.staff_id !== authSession.user.id) {
      const refreshedSession = await loadIdentity(session.remember, session.property_code);
      if (!refreshedSession) {
        status("The signed-in account is not assigned to a property.");
        return;
      }
      session = refreshedSession;
    }
    const staffId = authSession.user.id;
    if (session.staff_id !== staffId) {
      status("The signed-in account changed. Please sign in again to sync changes.");
      return;
    }

    connectRealtime();
    const code = session.property_code;
    const queue = read<Outbox>(keys.outbox(code), {});
    const conflicts = read<SyncConflicts>(keys.syncConflicts(code), {});
    const revisions = read<Record<string, number>>(keys.revisions(code), {});
    for (let offset = 0; ; offset += 1000) {
      const messageRows = await supabase
        .from("operation_rows")
        .select("id, revision")
        .eq("property_code", code)
        .eq("kind", "messages")
        .eq("deleted", false)
        .order("id")
        .range(offset, offset + 999);
      if (messageRows.error) throw messageRows.error;
      for (const row of messageRows.data) {
        const key = `messages:${row.id}`;
        if (!queue[key]) revisions[key] = Math.max(revisions[key] ?? 0, row.revision);
      }
      if (messageRows.data.length < 1000) break;
    }

    for (const [key, change] of Object.entries(queue)) {
      const conflict = conflicts[key];
      if (conflict) {
        let currentConflict = conflict;
        if (!conflict.remoteLoaded) {
          const remote = await supabase
            .from("operation_rows")
            .select("*")
            .eq("property_code", code)
            .eq("kind", change.kind)
            .eq("id", change.id)
            .maybeSingle();
          if (remote.error) throw remote.error;
          const currentConflicts = read<SyncConflicts>(keys.syncConflicts(code), {});
          const latestConflict = currentConflicts[key] ?? conflict;
          const latestChange = read<Outbox>(keys.outbox(code), {})[key] ?? latestConflict.local;
          currentConflict = {
            ...latestConflict,
            local: latestChange,
            remote: remote.data,
            remoteLoaded: true,
          };
          currentConflicts[key] = currentConflict;
          Object.assign(conflicts, currentConflicts);
          write(keys.syncConflicts(code), currentConflicts, false);
        }
        if (currentConflict.remoteLoaded) {
          const latestChange = read<Outbox>(keys.outbox(code), {})[key] ?? currentConflict.local;
          reconcileEquivalentConflict(code, key, latestChange, currentConflict.remote);
        }
        continue;
      }
      if (
        change.kind === "messages" &&
        change.localKey.startsWith(directKeyPrefix(code)) &&
        !isPrivateMessageForStaff(change.payload, staffId)
      ) {
        continue;
      }
      if (
        change.kind === "messages" &&
        (revisions[key] ?? 0) === 0 &&
        !isMessageSentByStaff(change.payload, staffId)
      ) {
        continue;
      }
      const result = await supabase.rpc("gpm_mutate", {
        p_kind: change.kind,
        p_id: change.id,
        p_payload: (change.kind === "messages"
          ? normalizeMessageReceiverForSync(change.payload)
          : change.payload) as Json,
        p_revision: revisions[key] ?? 0,
        p_deleted: change.deleted,
      });
      if (result.error) {
        if (result.error.message.includes("Conflict: another device changed this record.")) {
          const current = read<Outbox>(keys.outbox(code), {});
          const latestLocal = current[key] ?? change;
          const currentConflicts = read<SyncConflicts>(keys.syncConflicts(code), {});
          const newConflict: SyncConflict = {
            local: latestLocal,
            remote: null,
            remoteLoaded: false,
          };
          currentConflicts[key] = newConflict;
          Object.assign(conflicts, currentConflicts);
          write(keys.syncConflicts(code), currentConflicts, false);
          const remote = await supabase
            .from("operation_rows")
            .select("*")
            .eq("property_code", code)
            .eq("kind", change.kind)
            .eq("id", change.id)
            .maybeSingle();
          if (remote.error) throw remote.error;
          const latestConflicts = read<SyncConflicts>(keys.syncConflicts(code), {});
          const currentConflict = latestConflicts[key] ?? newConflict;
          const latestChange = read<Outbox>(keys.outbox(code), {})[key] ?? currentConflict.local;
          latestConflicts[key] = {
            ...currentConflict,
            local: latestChange,
            remote: remote.data,
            remoteLoaded: true,
          };
          Object.assign(conflicts, latestConflicts);
          write(keys.syncConflicts(code), latestConflicts, false);
          if (reconcileEquivalentConflict(code, key, latestChange, remote.data)) continue;

          let rebasedRevision: number | null = null;
          let rebasedChange: Change | null = null;
          if (!remote.data && latestChange.basePayload === null) {
            rebasedRevision = 0;
            if (latestChange.deleted) {
              const nextQueue = read<Outbox>(keys.outbox(code), {});
              delete nextQueue[key];
              write(keys.outbox(code), nextQueue, false);
            } else {
              rebasedChange = latestChange;
            }
          } else if (remote.data?.deleted && latestChange.deleted) {
            const nextQueue = read<Outbox>(keys.outbox(code), {});
            delete nextQueue[key];
            write(keys.outbox(code), nextQueue, false);
            rebasedRevision = remote.data.revision;
          } else if (
            remote.data &&
            !remote.data.deleted &&
            latestChange.deleted &&
            latestChange.basePayload !== null &&
            latestChange.basePayload !== undefined &&
            isRecord(remote.data.payload) &&
            stableJson(latestChange.basePayload) === stableJson(remote.data.payload)
          ) {
            rebasedRevision = remote.data.revision;
            rebasedChange = { ...latestChange, basePayload: remote.data.payload };
          } else if (
            remote.data &&
            !remote.data.deleted &&
            !latestChange.deleted &&
            latestChange.basePayload !== null &&
            latestChange.basePayload !== undefined &&
            isRecord(remote.data.payload)
          ) {
            const mergedPayload = mergeConcurrentPayload(
              latestChange.basePayload,
              latestChange.payload,
              remote.data.payload,
            );
            if (mergedPayload) {
              rebasedRevision = remote.data.revision;
              if (stableJson(mergedPayload) !== stableJson(remote.data.payload)) {
                rebasedChange = {
                  ...latestChange,
                  payload: mergedPayload,
                  basePayload: remote.data.payload,
                };
              }
            }
          }

          if (rebasedRevision !== null) {
            const nextQueue = read<Outbox>(keys.outbox(code), {});
            if (rebasedChange) nextQueue[key] = rebasedChange;
            else delete nextQueue[key];
            write(keys.outbox(code), nextQueue, false);

            const nextRevisions = read<Record<string, number>>(keys.revisions(code), {});
            nextRevisions[key] = rebasedRevision;
            write(keys.revisions(code), nextRevisions, false);

            const resolvedConflicts = read<SyncConflicts>(keys.syncConflicts(code), {});
            delete resolvedConflicts[key];
            write(keys.syncConflicts(code), resolvedConflicts, false);
            continue;
          }

          status("Sync conflict · review required");
          return;
        }
        status(result.error.message);
        return;
      }
      revisions[key] = result.data;
      write(keys.revisions(code), revisions, false);
      const current = read<Outbox>(keys.outbox(code), {});
      if (JSON.stringify(current[key]) === JSON.stringify(change)) delete current[key];
      write(keys.outbox(code), current, false);
    }

    const all: CloudRow[] = [];
    for (let offset = 0; ; offset += 1000) {
      const page = await supabase
        .from("operation_rows")
        .select("*")
        .eq("property_code", code)
        .eq("is_private", false)
        .order("kind")
        .order("id")
        .range(offset, offset + 999);
      if (page.error) throw page.error;
      all.push(...page.data);
      if (page.data.length < 1000) break;
    }

    const pending = read<Outbox>(keys.outbox(code), {});
    for (const kind of [
      "rooms",
      "reservations",
      "notices",
      "messages",
      "menu",
      "sales",
    ] as Kind[]) {
      const groups = kind === "messages" ? [...DEPARTMENTS] : [undefined];
      for (const department of groups) {
        const targetKey = listKey(code, kind, department);
        const cloud = all
          .filter(
            (row) =>
              row.kind === kind &&
              !row.deleted &&
              (kind !== "messages" ||
                (!row.is_private && (row.payload as Row).to_department === department)),
          )
          .map((row) => row.payload as Row);
        const changes = Object.values(pending).filter(
          (change) => change.kind === kind && change.localKey === targetKey,
        );
        const merged = mergeRows(cloud, changes, kind);
        if (JSON.stringify(read(targetKey, [])) !== JSON.stringify(merged))
          write(targetKey, merged, false);
      }
    }

    const directRows = (await listPrivateMessages()).filter(
      (row) =>
        row.kind === "messages" &&
        row.is_private &&
        !row.deleted &&
        isPrivateMessageForStaff(row.payload, staffId),
    );
    const directChanges = Object.values(pending).filter(
      (change) =>
        change.kind === "messages" &&
        change.localKey.startsWith(directKeyPrefix(code)) &&
        isPrivateMessageForStaff(change.payload, staffId),
    );
    const conversations = new Set<string>();
    for (const row of directRows) {
      const key = directConversationKey(code, row.payload as Row);
      if (key) conversations.add(key);
    }
    for (const change of directChanges) conversations.add(change.localKey);
    for (const key of conversations) {
      const cloud = directRows
        .filter((row) => directConversationKey(code, row.payload as Row) === key)
        .map((row) => row.payload as Row);
      const changes = directChanges.filter((change) => change.localKey === key);
      const merged = mergeRows(cloud, changes, "messages");
      if (JSON.stringify(read(key, [])) !== JSON.stringify(merged)) write(key, merged, false);
    }

    for (const row of all) {
      const key = `${row.kind}:${row.id}`;
      if (!pending[key]) revisions[key] = row.revision;
    }
    write(keys.revisions(code), revisions, false);
    const hasPendingChanges = Object.keys(read<Outbox>(keys.outbox(code), {})).length > 0;
    const hasSyncConflicts =
      Object.keys(read<SyncConflicts>(keys.syncConflicts(code), {})).length > 0;
    status(
      hasSyncConflicts
        ? "Sync conflict · review required"
        : hasPendingChanges
          ? "Pending sync"
          : "Cloud synced",
    );
  } catch (error) {
    status(
      error instanceof Error ? error.message : "Cloud unavailable · changes remain on this device",
    );
  } finally {
    busy = false;
  }
}

export function resolveSyncConflict(key: string, keep: "local" | "cloud") {
  const session = getCurrentUser();
  if (!session) return;
  const code = session.property_code;
  const conflicts = read<SyncConflicts>(keys.syncConflicts(code), {});
  const conflict = conflicts[key];
  if (!conflict || !conflict.remoteLoaded) return;

  const queue = read<Outbox>(keys.outbox(code), {});
  if (keep === "local") {
    queue[key] = queue[key] ?? conflict.local;
  } else {
    delete queue[key];
  }
  write(keys.outbox(code), queue, false);

  const revisions = read<Record<string, number>>(keys.revisions(code), {});
  revisions[key] = conflict.remote?.revision ?? 0;
  write(keys.revisions(code), revisions, false);

  delete conflicts[key];
  write(keys.syncConflicts(code), conflicts, false);
  void synchronize();
}

export function stopSync() {
  stopped = true;

  if (activeChannel) void supabase.removeChannel(activeChannel);
  activeChannel = null;
  activePropertyCode = "";
  activeStaffId = "";
}

export function resumeSync() {
  stopped = false;
  startNativeNetworkMonitoring();
  startNativeResumeSync();
  connectRealtime();
  void synchronize();
}
