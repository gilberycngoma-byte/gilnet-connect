const fs = require("node:fs/promises");

async function quarantineInvalidPropertyFile(filePath) {
  for (let suffix = 0; ; suffix++) {
    const backupPath = `${filePath}.corrupt-${Date.now()}-${suffix}`;
    try {
      await fs.rename(filePath, backupPath);
      return backupPath;
    } catch (error) {
      if (error.code !== "EEXIST" && error.code !== "ENOTEMPTY") throw error;
    }
  }
}

async function ensurePropertyMetadata(filePath, propertyId, propertyName) {
  const name = typeof propertyName === "string" ? propertyName.trim() : "";
  if (!name || name.length > 160) throw new Error("The property name is invalid.");

  let createdAt = new Date().toISOString();
  let recoveredPath = null;
  let raw;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  if (raw !== undefined) {
    let existing;
    try {
      existing = JSON.parse(raw.replace(/^\uFEFF/, ""));
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      recoveredPath = await quarantineInvalidPropertyFile(filePath);
    }

    if (!recoveredPath) {
      if (
        !existing ||
        existing.propertyId !== propertyId ||
        typeof existing.createdAt !== "string" ||
        Number.isNaN(Date.parse(existing.createdAt))
      ) {
        recoveredPath = await quarantineInvalidPropertyFile(filePath);
      } else {
        createdAt = existing.createdAt;
      }
    }
  }

  await fs.writeFile(
    filePath,
    JSON.stringify({ propertyId, propertyName: name, createdAt }, null, 2),
    "utf8",
  );
  return { createdAt, recoveredPath };
}

module.exports = { ensurePropertyMetadata };
