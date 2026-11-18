import type { Department } from "./types";

export type MessageRecipient = { id: string; name: string; department: string };

export type MessageDestination =
  | { kind: "department"; department: Department }
  | { kind: "private"; recipient: MessageRecipient };

export function resolveMessageDestination(
  department: Department | null,
  receiverId: string,
  recipients: MessageRecipient[],
): MessageDestination | null {
  if (!receiverId) return null;
  if (receiverId === "all") {
    return department ? { kind: "department", department } : null;
  }
  const recipient = recipients.find((person) => person.id === receiverId);
  return recipient ? { kind: "private", recipient } : null;
}
