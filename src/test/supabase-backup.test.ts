import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  list: vi.fn(),
  upload: vi.fn(),
  download: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { storage: { from: () => storage } },
}));

import { backupToSupabase, findLatestSupabaseBackup, restoreFromSupabase } from "@/lib/driveBackup";
import { keys, read, write } from "@/lib/db";

beforeEach(() => {
  localStorage.clear();
  storage.list.mockReset();
  storage.upload.mockReset().mockResolvedValue({ error: null });
  storage.download.mockReset();
  write(
    keys.session,
    {
      property_code: "HOTEL1",
      user_email: "admin@example.com",
      user_name: "Admin",
      role: "Admin",
      login_time: new Date().toISOString(),
      remember: true,
      token: "test-session",
    },
    false,
  );
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("Supabase property backups", () => {
  it("uploads a timestamped backup scoped to the selected property", async () => {
    write(keys.rooms("HOTEL1"), [{ number: "1", status: "Available" }], false);

    const result = await backupToSupabase("hotel1");

    expect(result.path).toMatch(/^HOTEL1\/backup-\d+\.json$/);
    expect(result.recordCount).toBeGreaterThan(0);
    expect(storage.upload).toHaveBeenCalledWith(result.path, expect.any(String), {
      contentType: "application/json",
      upsert: true,
    });
    const uploadedBody = storage.upload.mock.calls[0]?.[1];
    expect(typeof uploadedBody).toBe("string");
    const uploaded = JSON.parse(String(uploadedBody));
    expect(uploaded.propertyCode).toBe("HOTEL1");
    expect(uploaded.records[keys.rooms("HOTEL1")]).toEqual([{ number: "1", status: "Available" }]);
  });

  it("selects the newest property backup and restores only from that property path", async () => {
    storage.list.mockResolvedValue({
      data: [
        { id: "older", name: "backup-100.json", created_at: null },
        { id: "newer", name: "backup-200.json", created_at: null },
      ],
      error: null,
    });

    await expect(findLatestSupabaseBackup("HOTEL1")).resolves.toEqual({
      path: "HOTEL1/backup-200.json",
      createdAt: new Date(200).toISOString(),
    });

    await expect(restoreFromSupabase("HOTEL1", "HOTEL2/backup-200.json")).rejects.toThrow(
      "invalid for this property",
    );
    expect(storage.download).not.toHaveBeenCalled();
  });

  it("surfaces missing bucket or access-policy failures", async () => {
    storage.list.mockResolvedValue({ data: null, error: { message: "bucket unavailable" } });

    await expect(findLatestSupabaseBackup("HOTEL1")).rejects.toThrow("bucket unavailable");
  });

  it("explains how to provision a missing cloud-backup bucket", async () => {
    storage.list.mockResolvedValue({ data: null, error: { message: "Bucket not found" } });

    await expect(findLatestSupabaseBackup("HOTEL1")).rejects.toThrow(
      "supabase/migrations/20261116060000_property_backups_storage.sql",
    );
  });

  it("does not allow staff to upload a property-wide backup", async () => {
    write(
      keys.session,
      {
        property_code: "HOTEL1",
        user_email: "staff@example.com",
        user_name: "Staff",
        role: "Front Desk",
        login_time: new Date().toISOString(),
        remember: true,
        token: "test-session",
      },
      false,
    );

    await expect(backupToSupabase("HOTEL1")).rejects.toThrow("Only a property administrator");
    expect(storage.upload).not.toHaveBeenCalled();
  });
});
