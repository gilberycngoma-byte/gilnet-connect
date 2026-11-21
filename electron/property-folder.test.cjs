const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { ensurePropertyMetadata } = require("./property-folder.cjs");

test("repairs malformed property metadata without discarding the original file", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "gpm-property-folder-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "property.json");
  const malformed = "0000000000";
  await fs.writeFile(filePath, malformed, "utf8");

  const result = await ensurePropertyMetadata(filePath, "CHANICHE NDOLA", "Chaniche Lodge");

  assert.ok(result.recoveredPath);
  assert.equal(await fs.readFile(result.recoveredPath, "utf8"), malformed);
  assert.deepEqual(JSON.parse(await fs.readFile(filePath, "utf8")), {
    propertyId: "CHANICHE NDOLA",
    propertyName: "Chaniche Lodge",
    createdAt: result.createdAt,
  });
});

test("accepts a UTF-8 BOM and preserves a valid property's creation date", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "gpm-property-folder-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "property.json");
  await fs.writeFile(
    filePath,
    `\uFEFF${JSON.stringify({
      propertyId: "CHANICHE NDOLA",
      propertyName: "Old Name",
      createdAt: "2026-11-15T12:07:01.532Z",
    })}`,
    "utf8",
  );

  const result = await ensurePropertyMetadata(filePath, "CHANICHE NDOLA", "Current Name");

  assert.equal(result.recoveredPath, null);
  assert.equal(result.createdAt, "2026-11-15T12:07:01.532Z");
  assert.equal(JSON.parse(await fs.readFile(filePath, "utf8")).propertyName, "Current Name");
});
