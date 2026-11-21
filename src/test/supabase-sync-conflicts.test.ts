import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  currentUser: vi.fn(),
  getSession: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  channel: vi.fn(),
  isMessageSentByStaff: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: state.getSession },
    from: state.from,
    rpc: state.rpc,
    channel: state.channel,
    removeChannel: vi.fn(),
  },
}));

vi.mock("@/lib/auth", () => ({
  can: vi.fn(() => true),
  getCurrentUser: state.currentUser,
  loadIdentity: vi.fn(),
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...actual,
    read: (key: string, fallback: unknown) =>
      state.values.has(key) ? state.values.get(key) : fallback,
    write: (key: string, value: unknown) => state.values.set(key, value),
  };
});

vi.mock("@/lib/app-preferences", () => ({
  getAppPreferences: vi.fn(() => ({ messageNotifications: false, desktopNotifications: false })),
}));
vi.mock("@/lib/driveBackup", () => ({ backupToSupabase: vi.fn() }));
vi.mock("@/lib/electron", () => ({ getElectronBridge: vi.fn(() => null) }));
vi.mock("@/lib/messages.functions", () => ({ listPrivateMessages: vi.fn(async () => []) }));
vi.mock("@/lib/privateMessages", () => ({
  isMessageSentByStaff: state.isMessageSentByStaff,
  isPrivateMessageForStaff: vi.fn(() => true),
}));

import { keys } from "@/lib/db";
import {
  normalizeMessageReceiverForSync,
  synchronize,
  type SyncConflicts,
} from "@/lib/supabaseSync";

const propertyCode = "HOTEL1";
const localChange = {
  kind: "rooms" as const,
  id: "1",
  payload: { number: "1", status: "Occupied" },
  deleted: false,
  localKey: keys.rooms(propertyCode),
};
const defaultRemoteRow = {
  kind: "rooms",
  id: "1",
  payload: { number: "1", status: "Available" },
  revision: 2,
  deleted: false,
  receiver_staff_id: null,
  is_private: false,
};
let remoteRow: typeof defaultRemoteRow & { payload: Record<string, unknown> } = defaultRemoteRow;

describe("message receiver sync compatibility", () => {
  it.each([
    ["department", "all"],
    ["all_staffs", "all"],
    ["individual", "specific"],
  ])("converts legacy %s routing to the database receiver value", (legacy, expected) => {
    expect(
      normalizeMessageReceiverForSync({ receiver_type: legacy, to_department: "Housekeeping" }),
    ).toMatchObject({ receiver_type: expected, to_department: "Housekeeping" });
  });
});

beforeEach(() => {
  remoteRow = defaultRemoteRow;
  state.values.clear();
  state.isMessageSentByStaff.mockReset().mockReturnValue(true);
  state.currentUser.mockReturnValue({
    property_code: propertyCode,
    staff_id: "staff-1",
    remember: false,
    role: "Admin",
  });
  state.getSession.mockResolvedValue({
    data: { session: { user: { id: "staff-1" } } },
    error: null,
  });
  state.rpc.mockReset().mockResolvedValue({
    data: null,
    error: { message: "Conflict: another device changed this record. Refresh and retry." },
  });
  state.from.mockImplementation(() => {
    let columns = "";
    const builder: {
      select: (value: string) => typeof builder;
      eq: () => typeof builder;
      order: () => typeof builder;
      range: () => Promise<{ data: (typeof remoteRow)[]; error: null }>;
      maybeSingle: () => Promise<{ data: typeof remoteRow; error: null }>;
    } = {
      select(value) {
        columns = value;
        return builder;
      },
      eq() {
        return builder;
      },
      order() {
        return builder;
      },
      async range() {
        return { data: columns === "id, revision" ? [] : [remoteRow], error: null };
      },
      async maybeSingle() {
        return { data: remoteRow, error: null };
      },
    };
    return builder;
  });
  state.channel.mockImplementation(() => {
    const channel = {
      on: vi.fn(() => channel),
      subscribe: vi.fn(() => channel),
    };
    return channel;
  });
  state.values.set(keys.outbox(propertyCode), { "rooms:1": localChange });
  state.values.set(keys.revisions(propertyCode), { "rooms:1": 1 });
});

describe("sync revision conflicts", () => {
  it("keeps local changes queued and avoids requests when the provider session is missing", async () => {
    state.getSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    await synchronize();

    expect(state.values.get(keys.outbox(propertyCode))).toEqual({ "rooms:1": localChange });
    expect(state.values.get("gilnet_sync_status")).toBe("Sign in again to sync changes.");
    expect(state.from).not.toHaveBeenCalled();
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("keeps another sender's message pending for quiet background retry", async () => {
    const message = {
      kind: "messages" as const,
      id: "message-1",
      payload: { id: "message-1", sender_staff_id: "staff-2" },
      deleted: false,
      localKey: keys.messages(propertyCode, "Front Desk"),
      basePayload: null,
    };
    state.isMessageSentByStaff.mockReturnValue(false);
    state.values.set(keys.outbox(propertyCode), { "messages:message-1": message });
    state.values.set(keys.revisions(propertyCode), {});

    await synchronize();
    await synchronize();

    expect(state.values.get(keys.outbox(propertyCode))).toEqual({
      "messages:message-1": message,
    });
    expect(state.rpc).not.toHaveBeenCalled();
    expect(state.values.get("gilnet_sync_status")).toBe("Pending sync");
  });

  it("preserves both versions and pauses retries until the conflict is resolved", async () => {
    await synchronize();

    const conflicts = state.values.get(keys.syncConflicts(propertyCode)) as SyncConflicts;
    expect(conflicts["rooms:1"]).toMatchObject({
      local: localChange,
      remote: remoteRow,
      remoteLoaded: true,
    });
    expect(state.values.get(keys.outbox(propertyCode))).toEqual({ "rooms:1": localChange });

    await synchronize();

    expect(state.rpc).toHaveBeenCalledTimes(1);
    expect(state.values.get(keys.syncConflicts(propertyCode))).toEqual(conflicts);
  });

  it("automatically reconciles structurally identical versions despite object-key order", async () => {
    const equivalentLocal = {
      ...localChange,
      payload: { status: "Occupied", number: "1" },
    };
    remoteRow = {
      ...defaultRemoteRow,
      payload: { number: "1", status: "Occupied" },
      revision: 7,
    };
    state.values.set(keys.outbox(propertyCode), { "rooms:1": equivalentLocal });
    state.values.set(keys.syncConflicts(propertyCode), {
      "rooms:1": {
        local: equivalentLocal,
        remote: remoteRow,
        remoteLoaded: true,
      },
    });
    state.values.set(keys.revisions(propertyCode), { "rooms:1": 3 });

    await synchronize();

    expect(state.values.get(keys.outbox(propertyCode))).toEqual({});
    expect(state.values.get(keys.syncConflicts(propertyCode))).toEqual({});
    expect(state.values.get(keys.revisions(propertyCode))).toMatchObject({ "rooms:1": 7 });
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("automatically merges non-overlapping edits and retries from the latest cloud revision", async () => {
    const basePayload = { number: "1", status: "Available", notes: "Before" };
    const offlineChange = {
      ...localChange,
      payload: { number: "1", status: "Occupied", notes: "Before" },
      basePayload,
    };
    remoteRow = {
      ...defaultRemoteRow,
      payload: { number: "1", status: "Available", notes: "Updated on another device" },
      revision: 2,
    };
    state.values.set(keys.outbox(propertyCode), { "rooms:1": offlineChange });

    await synchronize();

    expect(state.values.get(keys.outbox(propertyCode))).toMatchObject({
      "rooms:1": {
        payload: {
          number: "1",
          status: "Occupied",
          notes: "Updated on another device",
        },
        basePayload: remoteRow.payload,
      },
    });
    expect(state.values.get(keys.revisions(propertyCode))).toMatchObject({ "rooms:1": 2 });
    expect(state.values.get(keys.syncConflicts(propertyCode))).toEqual({});

    remoteRow = {
      ...remoteRow,
      payload: {
        number: "1",
        status: "Occupied",
        notes: "Updated on another device",
      },
      revision: 3,
    };
    state.rpc.mockResolvedValue({ data: 3, error: null });
    await synchronize();

    expect(state.rpc).toHaveBeenLastCalledWith("gpm_mutate", {
      p_kind: "rooms",
      p_id: "1",
      p_payload: {
        number: "1",
        status: "Occupied",
        notes: "Updated on another device",
      },
      p_revision: 2,
      p_deleted: false,
    });
    expect(state.values.get(keys.outbox(propertyCode))).toEqual({});
  });

  it("keeps overlapping offline edits for manual review instead of overwriting either version", async () => {
    const basePayload = { number: "1", status: "Available" };
    const offlineChange = {
      ...localChange,
      payload: { number: "1", status: "Occupied" },
      basePayload,
    };
    remoteRow = {
      ...defaultRemoteRow,
      payload: { number: "1", status: "Dirty" },
      revision: 2,
    };
    state.values.set(keys.outbox(propertyCode), { "rooms:1": offlineChange });

    await synchronize();

    expect(state.values.get(keys.outbox(propertyCode))).toEqual({ "rooms:1": offlineChange });
    expect(state.values.get(keys.syncConflicts(propertyCode))).toMatchObject({
      "rooms:1": { local: offlineChange, remote: remoteRow, remoteLoaded: true },
    });
  });
});
