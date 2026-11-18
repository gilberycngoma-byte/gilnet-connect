import { afterEach, describe, expect, it } from "vitest";
import { createDriveBackup, restoreDriveBackup } from "@/lib/driveBackup";
import { keys, read, write } from "@/lib/db";

afterEach(() => {
  localStorage.clear();
});

describe("private Google Drive backup", () => {
  it("accepts readable property codes with spaces", async () => {
    const backup = await createDriveBackup("sample lodge property");

    expect(backup.propertyCode).toBe("SAMPLE LODGE PROPERTY");
    expect(() =>
      restoreDriveBackup(
        {
          ...backup,
          records: { [keys.rooms("SAMPLE LODGE PROPERTY")]: [] },
        },
        "sample lodge property",
      ),
    ).not.toThrow();
  });

  it("includes only the selected property's operational data and sync queue", async () => {
    write(keys.rooms("HOTEL1"), [{ number: "1", status: "Available" }], false);
    write(
      keys.outbox("HOTEL1"),
      {
        "rooms:1": {
          kind: "rooms",
          id: "1",
          payload: { number: "1", status: "Available" },
          deleted: false,
          localKey: keys.rooms("HOTEL1"),
        },
      },
      false,
    );
    write(keys.users("HOTEL1"), [{ email: "staff@example.com" }], false);
    write(keys.session, { token: "must-not-be-backed-up" }, false);
    write(keys.rooms("HOTEL2"), [{ number: "9" }], false);

    const backup = await createDriveBackup("hotel1");

    expect(backup.propertyCode).toBe("HOTEL1");
    expect(backup.records[keys.rooms("HOTEL1")]).toEqual([{ number: "1", status: "Available" }]);
    expect(backup.records[keys.outbox("HOTEL1")]).toEqual(read(keys.outbox("HOTEL1"), {}));
    expect(backup.records).not.toHaveProperty(keys.users("HOTEL1"));
    expect(backup.records).not.toHaveProperty(keys.session);
    expect(backup.records).not.toHaveProperty(keys.rooms("HOTEL2"));
  });

  it("backs up only private chats and pending private messages involving the signed-in staff member", async () => {
    const now = new Date().toISOString();
    write(
      keys.session,
      {
        property_code: "HOTEL1",
        user_email: "admin@example.com",
        user_name: "Admin",
        role: "Admin",
        login_time: now,
        remember: true,
        token: "staff-a",
        staff_id: "staff-a",
      },
      false,
    );
    const allowedKey = keys.directMessages("HOTEL1", "staff-a", "staff-b");
    const otherKey = keys.directMessages("HOTEL1", "staff-b", "staff-c");
    const allowedMessage = {
      id: "allowed",
      receiver_type: "specific",
      sender_staff_id: "staff-a",
      receiver_staff_id: "staff-b",
    };
    const otherMessage = {
      id: "other",
      receiver_type: "specific",
      sender_staff_id: "staff-b",
      receiver_staff_id: "staff-c",
    };
    write(allowedKey, [allowedMessage], false);
    write(otherKey, [otherMessage], false);
    write(
      keys.outbox("HOTEL1"),
      {
        "messages:allowed": {
          kind: "messages",
          id: "allowed",
          payload: allowedMessage,
          deleted: false,
          localKey: allowedKey,
        },
        "messages:other": {
          kind: "messages",
          id: "other",
          payload: otherMessage,
          deleted: false,
          localKey: otherKey,
        },
      },
      false,
    );

    const backup = await createDriveBackup("HOTEL1");

    expect(backup.records[allowedKey]).toEqual([allowedMessage]);
    expect(backup.records).not.toHaveProperty(otherKey);
    expect(Object.keys(backup.records[keys.outbox("HOTEL1")] as object)).toEqual([
      "messages:allowed",
    ]);
  });

  it("rejects backups belonging to another property", () => {
    const backup = {
      format: "gilnet-property-backup",
      version: 1,
      propertyCode: "HOTEL1",
      createdAt: new Date().toISOString(),
      records: { [keys.rooms("HOTEL1")]: [{ number: "1" }] },
    };

    expect(() => restoreDriveBackup(backup, "HOTEL2")).toThrow("different property");
  });

  it("merges restored records without replacing local records or pending changes", () => {
    const remoteChange = {
      kind: "rooms",
      id: "1",
      deleted: false,
      localKey: keys.rooms("HOTEL1"),
      payload: { number: "1", status: "Dirty" },
    };
    const localChange = {
      kind: "rooms",
      id: "2",
      deleted: false,
      localKey: keys.rooms("HOTEL1"),
      payload: { number: "2", status: "Occupied" },
    };
    const backup = {
      format: "gilnet-property-backup",
      version: 1,
      propertyCode: "HOTEL1",
      createdAt: new Date().toISOString(),
      records: {
        [keys.rooms("HOTEL1")]: [
          { number: "1", status: "Dirty" },
          { number: "3", status: "Available" },
        ],
        [keys.outbox("HOTEL1")]: { "rooms:1": remoteChange },
        [keys.revisions("HOTEL1")]: { "rooms:1": 4 },
      },
    };
    write(
      keys.rooms("HOTEL1"),
      [
        { number: "1", status: "Occupied" },
        { number: "2", status: "Occupied" },
      ],
      false,
    );
    write(keys.outbox("HOTEL1"), { "rooms:2": localChange }, false);
    write(keys.revisions("HOTEL1"), { "rooms:1": 3 }, false);

    restoreDriveBackup(backup, "HOTEL1");

    expect(read(keys.rooms("HOTEL1"), [])).toEqual([
      { number: "1", status: "Occupied" },
      { number: "3", status: "Available" },
      { number: "2", status: "Occupied" },
    ]);
    expect(read(keys.outbox("HOTEL1"), {})).toEqual({
      "rooms:1": remoteChange,
      "rooms:2": localChange,
    });
    expect(read(keys.revisions("HOTEL1"), {})).toEqual({ "rooms:1": 3 });
  });

  it("rejects a pending change that targets another property's local key", () => {
    const backup = {
      format: "gilnet-property-backup",
      version: 1,
      propertyCode: "HOTEL1",
      createdAt: new Date().toISOString(),
      records: {
        [keys.outbox("HOTEL1")]: {
          "rooms:1": {
            kind: "rooms",
            id: "1",
            deleted: false,
            localKey: keys.rooms("HOTEL2"),
            payload: { number: "1" },
          },
        },
      },
    };

    expect(() => restoreDriveBackup(backup, "HOTEL1")).toThrow("invalid pending sync queue");
  });
});
