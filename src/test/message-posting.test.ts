import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentUser, syncInBackground } = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  syncInBackground: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  can: vi.fn(),
  getCurrentUser,
}));
vi.mock("@/lib/supabaseSync", () => ({ syncInBackground }));

import { postMessage } from "@/lib/actions";

beforeEach(() => {
  localStorage.clear();
  getCurrentUser.mockReturnValue({
    property_code: "CHANICHE NDOLA",
    role: "Front Desk",
    staff_id: "staff-1",
    user_name: "Alex",
  });
  syncInBackground.mockReset();
});

describe("posted message receiver types", () => {
  it("keeps department routing metadata while using a database-valid receiver type", () => {
    const message = postMessage("Housekeeping", "Hello", {
      receiver_type: "department",
    });

    expect(message.recipient_type).toBe("department");
    expect(message.receiver_type).toBe("all");
    expect(message.to_department).toBe("Housekeeping");
  });
});
