import { describe, expect, it } from "vitest";
import { parseAuthIdentifier } from "@/lib/auth-identifier";

describe("parseAuthIdentifier", () => {
  it("normalizes email addresses", () => {
    expect(parseAuthIdentifier("  Admin@Example.com ")).toEqual({ email: "admin@example.com" });
  });

  it("accepts international phone numbers with common formatting", () => {
    expect(parseAuthIdentifier("+260 (97) 123-4567")).toEqual({ phone: "+260971234567" });
  });

  it("rejects phone numbers without an international country code", () => {
    expect(() => parseAuthIdentifier("0971234567")).toThrow("international format");
  });
});
