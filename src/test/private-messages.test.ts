import { describe, expect, it } from "vitest";
import { isMessageSentByStaff, isPrivateMessageForStaff } from "@/lib/privateMessages";

describe("private message visibility", () => {
  const message = {
    receiver_type: "specific",
    sender_staff_id: "staff-a",
    receiver_staff_id: "staff-b",
  };

  it("allows only the sender and intended receiver", () => {
    expect(isPrivateMessageForStaff(message, "staff-a")).toBe(true);
    expect(isPrivateMessageForStaff(message, "staff-b")).toBe(true);
    expect(isPrivateMessageForStaff(message, "staff-c")).toBe(false);
  });

  it("does not treat an all-staff message as private", () => {
    expect(
      isPrivateMessageForStaff(
        { ...message, receiver_type: "all", recipient_type: "all_staffs" },
        "staff-a",
      ),
    ).toBe(false);
    expect(isPrivateMessageForStaff(message, "")).toBe(false);
  });

  it("only lets the original sender create a queued message", () => {
    expect(isMessageSentByStaff(message, "staff-a")).toBe(true);
    expect(isMessageSentByStaff(message, "staff-b")).toBe(false);
    expect(isMessageSentByStaff({ ...message, sender_staff_id: null }, "staff-a")).toBe(false);
  });
});
