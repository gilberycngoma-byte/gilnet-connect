export type AuthIdentifier = { email: string; phone?: never } | { phone: string; email?: never };

export function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function parseAuthIdentifier(value: string): AuthIdentifier {
  const identifier = value.trim();
  if (identifier.includes("@")) {
    if (!isValidEmail(identifier)) {
      throw new Error(
        "Enter a valid email address or phone number in international format (for example, +260...).",
      );
    }
    return { email: identifier.toLowerCase() };
  }

  const phone = identifier.replace(/[\s()-]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
    throw new Error(
      "Enter a valid email address or phone number in international format (for example, +260...).",
    );
  }
  return { phone };
}
