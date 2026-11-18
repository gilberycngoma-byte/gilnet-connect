function normalizePropertyId(propertyId) {
  const code = typeof propertyId === "string" ? propertyId.trim().toUpperCase() : "";
  if (!/^[A-Z0-9 _-]{1,32}$/.test(code)) {
    throw new Error("The property code is invalid.");
  }
  return code;
}

module.exports = { normalizePropertyId };
