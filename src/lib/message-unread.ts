function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function countUnreadMessagesForStaff(
  departmentMessages: readonly unknown[],
  broadcastMessages: readonly unknown[],
  staffId: string,
) {
  return [...departmentMessages, ...broadcastMessages].filter((value) => {
    if (
      !isRecord(value) ||
      typeof value.id !== "string" ||
      !value.id.trim() ||
      typeof value.message !== "string" ||
      !value.message.trim() ||
      value.is_read !== false
    ) {
      return false;
    }

    return value.sender_staff_id !== staffId && value.sender_id !== staffId;
  }).length;
}
