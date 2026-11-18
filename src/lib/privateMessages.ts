export function isPrivateMessageForStaff(value: unknown, staffId: string): boolean {
  if (!staffId || !value || typeof value !== "object" || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  const isPrivate =
    message["receiver_type"] === "specific" ||
    message["receiver_type"] === "individual" ||
    message["recipient_type"] === "individual";
  return (
    isPrivate &&
    (message["sender_staff_id"] === staffId || message["receiver_staff_id"] === staffId)
  );
}

export function isMessageSentByStaff(value: unknown, staffId: string): boolean {
  if (!staffId || !value || typeof value !== "object" || Array.isArray(value)) return false;
  return (value as Record<string, unknown>)["sender_staff_id"] === staffId;
}
