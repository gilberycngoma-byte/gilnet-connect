import { describe, expect, it } from "vitest";
import { isPasswordRecoveryCallback } from "@/lib/auth-recovery";

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
});
