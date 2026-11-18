import type { ComponentType, ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  navigate,
  resetPasswordForEmail,
  getSession,
  from,
  getCurrentUser,
  getRemembered,
  getPendingAdminOAuth,
} = vi.hoisted(() => ({
  navigate: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  getSession: vi.fn(),
  from: vi.fn(),
  getCurrentUser: vi.fn(),
  getRemembered: vi.fn(),
  getPendingAdminOAuth: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  useNavigate: () => navigate,
}));

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: vi.fn(),
    getLaunchUrl: vi.fn(),
  },
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false },
}));

vi.mock("@/components/gpm/UserAgreement", () => ({
  UserAgreementGate: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/components/gpm/InstallApp", () => ({
  InstallAppButton: () => null,
}));

vi.mock("@/lib/electron", () => ({ getElectronBridge: () => null }));
vi.mock("@/lib/supabaseSync", () => ({
  synchronize: vi.fn(),
  resumeSync: vi.fn(),
}));
vi.mock("@/lib/migrate", () => ({ migrateLocalData: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  clearPendingAdminOAuth: vi.fn(),
  completeAdminOAuthLogin: vi.fn(),
  createAdmin: vi.fn(),
  completeSetup: vi.fn(),
  getCurrentUser,
  getPendingAdminOAuth,
  getRemembered,
  homeFor: vi.fn(() => "/dashboard"),
  login: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      resetPasswordForEmail,
      getSession,
      getUser: vi.fn(),
      updateUser: vi.fn(),
      verifyOtp: vi.fn(),
    },
    from,
  },
}));

import { Route } from "@/routes/login";

const LoginPage = (Route as unknown as { component: ComponentType }).component;

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  navigate.mockReset();
  resetPasswordForEmail.mockReset().mockResolvedValue({ error: null });
  getSession.mockReset();
  from.mockReset();
  getCurrentUser.mockReset().mockReturnValue(null);
  getRemembered.mockReset().mockReturnValue(null);
  getPendingAdminOAuth.mockReset().mockReturnValue(null);
  window.history.replaceState(null, "", "/login");
});

describe("password recovery links", () => {
  it("sends a link-only reset email and waits for the link before showing password fields", async () => {
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText("Staff email address"), {
      target: { value: "staff@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Forgot password?" }));
    fireEvent.click(screen.getByRole("button", { name: "Send a password reset email" }));

    await waitFor(() => {
      expect(resetPasswordForEmail).toHaveBeenCalledWith("staff@example.com", {
        redirectTo: `${window.location.origin}/login?type=recovery`,
      });
    });
    expect(screen.getByText(/open the secure reset link/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/recovery code/i)).not.toBeInTheDocument();
  });

  it("opens password fields after a recovery link restores the session", async () => {
    window.history.replaceState(null, "", "/login?type=recovery");
    getSession.mockResolvedValue({
      data: { session: { user: { id: "staff-id", email: "staff@example.com" } } },
      error: null,
    });
    const single = vi.fn().mockResolvedValue({
      data: { property_code: "TEST001", role: "Front Desk" },
      error: null,
    });
    from.mockReturnValue({
      select: () => ({
        eq: () => ({ single }),
      }),
    });

    render(<LoginPage />);

    await screen.findByLabelText("New password");
    expect(screen.queryByLabelText(/recovery code/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Property Code")).toHaveValue("");
  });
});
