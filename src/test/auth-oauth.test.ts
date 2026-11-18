import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signInWithOAuth: vi.fn(),
  getUser: vi.fn(),
  signOut: vi.fn(),
  from: vi.fn(),
  role: { value: { property_code: "LUS001", role: "Admin" } as Record<string, unknown> | null },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signInWithOAuth: mocks.signInWithOAuth,
      getUser: mocks.getUser,
      signOut: mocks.signOut,
    },
    from: mocks.from,
  },
}));

import {
  beginAdminOAuth,
  completeAdminOAuthLogin,
  getCurrentUser,
  getPendingAdminOAuth,
  logout,
} from "@/lib/auth";
import { keys } from "@/lib/db";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  mocks.signInWithOAuth.mockReset();
  mocks.getUser.mockReset();
  mocks.signOut.mockReset();
  mocks.from.mockReset();
  mocks.role.value = { property_code: "LUS001", role: "Admin" };
  mocks.signInWithOAuth.mockResolvedValue({
    data: { url: "https://qyawsbiipskhpstnemno.supabase.co/auth/v1/authorize" },
    error: null,
  });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.getUser.mockResolvedValue({
    data: {
      user: {
        id: "admin-user",
        email: "admin@example.com",
        user_metadata: {},
      },
    },
    error: null,
  });
  mocks.from.mockImplementation((table: string) => {
    const result =
      table === "user_roles"
        ? mocks.role.value
        : table === "profiles"
          ? { name: "GILNET Admin" }
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

describe("Admin provider sign-in", () => {
  it("keeps a device session signed in beyond the former 30-day limit", () => {
    localStorage.setItem(
      keys.session,
      JSON.stringify({
        property_code: "LUS001",
        user_email: "admin@example.com",
        user_name: "GILNET Admin",
        role: "Admin",
        login_time: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
        remember: false,
        token: "admin-user",
        staff_id: "admin-user",
      }),
    );

    expect(getCurrentUser()?.user_email).toBe("admin@example.com");
  });

  it("logs out only the current device's Supabase session", async () => {
    await logout();

    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(getCurrentUser()).toBeNull();
  });

  it("keeps the property and remember choice while starting Google OAuth", async () => {
    mocks.signInWithOAuth.mockResolvedValue({
      data: { url: "https://qyawsbiipskhpstnemno.supabase.co/auth/v1/authorize" },
      error: null,
    });

    await expect(
      beginAdminOAuth("google", "lus001", true, "gilnet://auth/callback"),
    ).resolves.toContain("/auth/v1/authorize");

    expect(mocks.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "gilnet://auth/callback",
        skipBrowserRedirect: true,
        queryParams: { prompt: "select_account" },
      },
    });
    expect(getPendingAdminOAuth()).toEqual({
      provider: "google",
      propertyCode: "LUS001",
      remember: true,
    });
  });

  it("creates an app session only for a user already assigned the Admin role", async () => {
    await beginAdminOAuth("github", "LUS001", false, "gilnet://auth/callback");
    const session = await completeAdminOAuthLogin();

    expect(session.role).toBe("Admin");
    expect(getCurrentUser()?.user_email).toBe("admin@example.com");
    expect(getPendingAdminOAuth()).toBeNull();
  });

  it("signs out an OAuth account that is assigned a non-admin role", async () => {
    mocks.role.value = { property_code: "LUS001", role: "Manager" };
    await beginAdminOAuth("github", "LUS001", false, "gilnet://auth/callback");

    await expect(completeAdminOAuthLogin()).rejects.toThrow(
      "GitHub and Google sign-in are limited to an existing GILNET Admin account.",
    );
    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(getCurrentUser()).toBeNull();
  });

  it("rejects an Admin account belonging to a different property", async () => {
    mocks.role.value = { property_code: "OTHER01", role: "Admin" };
    await beginAdminOAuth("google", "LUS001", false, "gilnet://auth/callback");

    await expect(completeAdminOAuthLogin()).rejects.toThrow(
      "This account belongs to a different property.",
    );
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });
});
