import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { findAuthCallback, isAuthCallbackUrl, isSupabaseAuthorizeUrl } =
  require("../../electron/auth-protocol.cjs") as {
    findAuthCallback: (argv: string[]) => string | null;
    isAuthCallbackUrl: (value: string) => boolean;
    isSupabaseAuthorizeUrl: (value: string, supabaseUrl: string) => boolean;
  };

describe("Electron OAuth protocol", () => {
  it("accepts only the GILNET auth callback scheme", () => {
    expect(isAuthCallbackUrl("gilnet://auth/callback?code=abc")).toBe(true);
    expect(isAuthCallbackUrl("https://example.com/callback?code=abc")).toBe(false);
    expect(isAuthCallbackUrl("gilnet://other/callback?code=abc")).toBe(false);
    expect(findAuthCallback(["--hidden", "gilnet://auth/callback?code=abc"])).toBe(
      "gilnet://auth/callback?code=abc",
    );
  });

  it("opens only the configured Supabase OAuth authorization endpoint", () => {
    expect(
      isSupabaseAuthorizeUrl(
        "https://qyawsbiipskhpstnemno.supabase.co/auth/v1/authorize?provider=github",
        "https://qyawsbiipskhpstnemno.supabase.co",
      ),
    ).toBe(true);
    expect(
      isSupabaseAuthorizeUrl(
        "https://evil.example/auth/v1/authorize?provider=github",
        "https://qyawsbiipskhpstnemno.supabase.co",
      ),
    ).toBe(false);
    expect(
      isSupabaseAuthorizeUrl(
        "https://qyawsbiipskhpstnemno.supabase.co/functions/v1/gpm-mobile-api",
        "https://qyawsbiipskhpstnemno.supabase.co",
      ),
    ).toBe(false);
  });
});
