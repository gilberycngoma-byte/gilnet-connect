import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { resolveClientAsset } = require("../../electron/local-server.cjs") as {
  resolveClientAsset: (clientDirectory: string, requestPath: string) => string | null;
};
const { normalizePropertyId } = require("../../electron/property-code.cjs") as {
  normalizePropertyId: (propertyId: unknown) => string;
};

describe("Electron local asset server", () => {
  it("resolves client assets beneath the bundled client directory", () => {
    const root = path.resolve("release-test", "client");

    expect(resolveClientAsset(root, "/assets/app.js")).toBe(path.join(root, "assets", "app.js"));
  });

  it("rejects encoded path traversal and malformed paths", () => {
    const root = path.resolve("release-test", "client");

    expect(resolveClientAsset(root, "/%2e%2e/private.json")).toBeNull();
    expect(resolveClientAsset(root, "/assets/%E0%A4%A")).toBeNull();
  });

  it("accepts readable property codes with spaces but rejects path separators", () => {
    expect(normalizePropertyId(" sample lodge property ")).toBe("SAMPLE LODGE PROPERTY");
    expect(() => normalizePropertyId("../other-property")).toThrow("property code is invalid");
  });
});
