import { describe, expect, it, vi } from "vitest";
import { isPasswordRecoveryCallback, withPasswordRecoveryTimeout } from "@/lib/auth-recovery";

describe("password recovery callback detection", () => {
  it("recognizes native PKCE codes when no provider sign-in is pending", () => {
    expect(
      isPasswordRecoveryCallback(new URL("gilnet://auth/callback?code=one-time-code"), false),
    ).toBe(true);
  });

  it("leaves unmarked PKCE codes to a pending provider sign-in", () => {
    expect(
      isPasswordRecoveryCallback(new URL("gilnet://auth/callback?code=provider-code"), true),
    ).toBe(false);
  });

  it("treats an explicit recovery marker as recovery even when provider sign-in is pending", () => {
    expect(
      isPasswordRecoveryCallback(
        new URL("gilnet://auth/callback?type=recovery&code=reset-code"),
        true,
      ),
    ).toBe(true);
  });

  it("reports a stalled password reset request", async () => {
    vi.useFakeTimers();
    try {
      const request = new Promise<never>(() => {});
      const result = withPasswordRecoveryTimeout(request, 100);
      const rejection = expect(result).rejects.toThrow(
        "The password reset request timed out. Check your inbox before trying again.",
      );
      await vi.advanceTimersByTimeAsync(100);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });
});
