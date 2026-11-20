import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateWithPasskey: vi.fn(),
  verifyOtp: vi.fn(),
  getUser: vi.fn(),
  signOut: vi.fn(),
  from: vi.fn(),
  role: { value: { property_code: "LUS001", role: "Front Desk" } as Record<string, unknown> },
}));

vi.mock("@/lib/passkeys", () => ({
  authenticateWithPasskey: mocks.authenticateWithPasskey,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      verifyOtp: mocks.verifyOtp,
      getUser: mocks.getUser,
      signOut: mocks.signOut,
    },
    from: mocks.from,
  },
}));

import { getCurrentUser, loginWithPasskey } from "@/lib/auth";
import { keys } from "@/lib/db";

beforeEach(() => {
  localStorage.clear();
  mocks.authenticateWithPasskey.mockReset().mockResolvedValue("one-time-token");
  mocks.verifyOtp.mockReset().mockResolvedValue({ error: null });
  mocks.getUser.mockReset().mockResolvedValue({
    data: {
      user: {
        id: "staff-user",
        email: "staff@example.com",
        user_metadata: { department: "Front Desk" },
      },
    },
    error: null,
  });
  mocks.signOut.mockReset().mockResolvedValue({ error: null });
  mocks.role.value = { property_code: "LUS001", role: "Front Desk" };
  mocks.from.mockImplementation((table: string) => {
    const result =
      table === "user_roles"
        ? mocks.role.value
        : table === "profiles"
          ? { name: "Front Desk Staff" }
          : { code: "LUS001" };
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () => ({ data: result, error: null }),
      single: async () => ({ data: result, error: null }),
    };
    return query;
  });
});

describe("passkey sign-in", () => {
  it("creates and remembers an app session after the passkey is verified", async () => {
    const session = await loginWithPasskey("LUS001", true, "staff");

    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      token_hash: "one-time-token",
      type: "magiclink",
    });
    expect(session.role).toBe("Front Desk");
    expect(getCurrentUser()?.user_email).toBe("staff@example.com");
    expect(JSON.parse(localStorage.getItem(keys.remembered) ?? "{}")).toMatchObject({
      property_code: "LUS001",
      email: "staff@example.com",
      mode: "staff",
    });
  });

  it("signs out when the passkey belongs to the other account type", async () => {
    mocks.role.value = { property_code: "LUS001", role: "Admin" };

    await expect(loginWithPasskey("LUS001", false, "staff")).rejects.toThrow(
      "This is a management account. Choose “Management.”",
    );

    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(getCurrentUser()).toBeNull();
  });

  it("requires a property code before opening the passkey prompt", async () => {
    await expect(loginWithPasskey("", false, "staff")).rejects.toThrow("Enter your property code.");
    expect(mocks.authenticateWithPasskey).not.toHaveBeenCalled();
  });
});
