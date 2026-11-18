import { beforeEach, describe, expect, it, vi } from "vitest";

const { signUp, signInWithPassword, invoke, verifyOtp, setSession, getUser, from, rpc } =
  vi.hoisted(() => ({
    signUp: vi.fn(),
    signInWithPassword: vi.fn(),
    invoke: vi.fn(),
    verifyOtp: vi.fn(),
    setSession: vi.fn(),
    getUser: vi.fn(),
    from: vi.fn(),
    rpc: vi.fn(),
  }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { signUp, signInWithPassword, verifyOtp, setSession, getUser },
    functions: { invoke },
    from,
    rpc,
  },
}));

import { can, completeSetup, createAdmin, isLoginModeAllowed, login } from "@/lib/auth";

beforeEach(() => {
  sessionStorage.clear();
  signUp.mockReset();
  signInWithPassword.mockReset();
  invoke.mockReset();
  verifyOtp.mockReset();
  setSession.mockReset();
  getUser.mockReset();
  from.mockReset();
  rpc.mockReset();
});

const property = {
  name: "Test Property",
  address: "Test Address",
  phone: "555-0100",
};

const input = {
  code: "test001",
  name: "Test Admin",
  identifier: "admin@example.com",
  username: "admin",
  password: "test-password",
  property,
};

describe("createAdmin", () => {
  it("clears pending setup data when sign-up fails", async () => {
    signUp.mockResolvedValue({
      data: { session: null },
      error: new Error("Too many requests"),
    });

    await expect(createAdmin(input)).rejects.toThrow("Too many requests");
    expect(sessionStorage.getItem("gilnet_pending_setup")).toBeNull();
    expect(sessionStorage.getItem("gilnet_pending_code")).toBeNull();
  });

  it("preserves setup data while email confirmation is pending", async () => {
    signUp.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    await expect(createAdmin(input)).resolves.toEqual({ signedIn: false, confirmation: "email" });
    expect(sessionStorage.getItem("gilnet_pending_setup")).toBe(JSON.stringify(property));
    expect(sessionStorage.getItem("gilnet_pending_code")).toBe("TEST001");
  });

  it("rejects phone-only administrator sign-up", async () => {
    signUp.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    await expect(createAdmin({ ...input, identifier: "+260971234567" })).rejects.toThrow(
      "Administrator accounts must use an email address.",
    );
    expect(signUp).not.toHaveBeenCalled();
  });
});

describe("property billing contact setup", () => {
  it("creates a property's billing contact separately from the admin login email", async () => {
    rpc.mockResolvedValue({ error: null });

    await completeSetup("test001", {
      ...property,
      billing_email: "billing@test-property.example",
      property_type: "Apartments",
    });

    expect(rpc).toHaveBeenCalledWith("gpm_setup_with_billing", {
      p_code: "test001",
      p_name: "Test Property",
      p_address: "Test Address",
      p_phone: "555-0100",
      p_billing_email: "billing@test-property.example",
      p_property_type: "Apartments",
    });
  });

  it("defaults the property type for legacy setup data", async () => {
    rpc.mockResolvedValue({ error: null });

    await completeSetup("test001", {
      ...property,
      billing_email: "billing@test-property.example",
    });

    expect(rpc).toHaveBeenCalledWith(
      "gpm_setup_with_billing",
      expect.objectContaining({ p_property_type: "Hotel" }),
    );
  });

  it("preserves compatibility for previously saved setup data without a billing contact", async () => {
    rpc.mockResolvedValue({ error: null });

    await completeSetup("test001", property);

    expect(rpc).toHaveBeenCalledWith("gpm_setup", {
      p_code: "test001",
      p_name: "Test Property",
      p_address: "Test Address",
      p_phone: "555-0100",
    });
  });
});

describe("staff password login", () => {
  it("uses the lockout-aware password endpoint without a PIN flow", async () => {
    invoke.mockResolvedValue({ data: null, error: new Error("Invalid email or password.") });

    await expect(
      login("TEST001", "staff@example.com", "strong-password", false, "staff"),
    ).rejects.toThrow("Invalid email or password.");
    expect(invoke).toHaveBeenCalledWith("password-login", {
      body: { email: "staff@example.com", password: "strong-password" },
    });
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("explains the lockout and account recovery options", async () => {
    const error = Object.assign(new Error("The edge function returned an error."), {
      context: new Response(
        JSON.stringify({
          error: "Too many incorrect password attempts.",
          locked: true,
          retry_after_seconds: 900,
        }),
        { status: 429 },
      ),
    });
    invoke.mockResolvedValue({ data: null, error });

    await expect(
      login("TEST001", "admin@example.com", "wrong-password", false, "management"),
    ).rejects.toThrow(/15 minutes.*GILNET Support.*property admin/i);
  });

  it("stores the session returned by password sign-in", async () => {
    invoke.mockResolvedValue({
      data: { access_token: "access-token", refresh_token: "refresh-token" },
      error: null,
    });
    setSession.mockResolvedValue({ error: new Error("Session setup failed") });

    await expect(
      login("TEST001", "admin@example.com", "password", false, "management"),
    ).rejects.toThrow("Session setup failed");
    expect(setSession).toHaveBeenCalledWith({
      access_token: "access-token",
      refresh_token: "refresh-token",
    });
  });

  it("rejects phone identifiers for staff sign-in", async () => {
    await expect(login("TEST001", "+260971234567", "012345", false, "staff")).rejects.toThrow(
      "Staff accounts must sign in with an email address.",
    );
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("sign-in mode roles", () => {
  it("keeps management and staff roles on their respective sign-in paths", () => {
    for (const role of ["Admin", "Manager", "Supervisor"] as const) {
      expect(isLoginModeAllowed(role, "management")).toBe(true);
      expect(isLoginModeAllowed(role, "staff")).toBe(false);
    }
    for (const role of ["Front Desk", "Housekeeping", "Maintenance", "Restaurant"] as const) {
      expect(isLoginModeAllowed(role, "staff")).toBe(true);
      expect(isLoginModeAllowed(role, "management")).toBe(false);
    }
  });

  it("limits subscription access to the property Admin role", () => {
    expect(can("Admin", "billing")).toBe(true);
    expect(can("Manager", "billing")).toBe(true);
    expect(can("Supervisor", "billing")).toBe(true);
    expect(can("Front Desk", "billing")).toBe(false);
    expect(can("Housekeeping", "billing")).toBe(false);
  });
});
