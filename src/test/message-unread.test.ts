import { describe, expect, it } from "vitest";
import { countUnreadMessagesForStaff } from "@/lib/message-unread";
import type { Message } from "@/lib/types";

const message = (overrides: Partial<Message> = {}): Message => ({
  id: "message-1",
  property_code: "HOTEL1",
  from_department: "Front Desk",
  to_department: "Front Desk",
  from_user: "Alex",
  message: "Please call reception.",
  room_number: null,
  notice_id: null,
  message_type: "chat",
  is_read: false,
  audio_url: null,
  audio_duration: null,
  transcription: null,
  created_at: "2026-11-19T00:00:00.000Z",
  ...overrides,
});

describe("staff unread message counts", () => {
  it("shows no unread count when there are no messages", () => {
    expect(countUnreadMessagesForStaff([], [], "staff-1")).toBe(0);
  });

  it("counts unread department and broadcast messages from other staff only", () => {
    expect(
      countUnreadMessagesForStaff(
        [
          message({ sender_staff_id: "staff-2" }),
          message({ id: "own-message", sender_id: "staff-1" }),
          message({ id: "read-message", is_read: true }),
        ],
        [message({ id: "broadcast", sender_staff_id: "staff-3" })],
        "staff-1",
      ),
    ).toBe(2);
  });

  it("ignores incomplete and empty message records", () => {
    expect(
      countUnreadMessagesForStaff(
        [
          message({ id: "", message: "Unread but missing an id" }),
          message({ message: "   " }),
          { id: "missing-read-state", message: "Missing read state" },
        ],
        [],
        "staff-1",
      ),
    ).toBe(0);
  });
});
