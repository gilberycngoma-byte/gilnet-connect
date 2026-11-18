import { describe, expect, it } from "vitest";
import { resolveMessageDestination } from "@/lib/message-routing";

const recipients = [{ id: "staff-1", name: "Alex", department: "Housekeeping" }];

describe("message destinations", () => {
  it("sends an all-recipient message to the selected department", () => {
    expect(resolveMessageDestination("Housekeeping", "all", recipients)).toEqual({
      kind: "department",
      department: "Housekeeping",
    });
  });

  it("requires a destination before sending", () => {
    expect(resolveMessageDestination("Housekeeping", "", recipients)).toBeNull();
    expect(resolveMessageDestination(null, "all", recipients)).toBeNull();
    expect(resolveMessageDestination("Housekeeping", "unknown-staff", recipients)).toBeNull();
  });

  it("keeps explicitly selected staff messages private", () => {
    expect(resolveMessageDestination("Housekeeping", "staff-1", recipients)).toEqual({
      kind: "private",
      recipient: recipients[0],
    });
  });

  it("requires an explicit All Staff selection", () => {
    expect(resolveMessageDestination("All Staff", "all", recipients)).toEqual({
      kind: "department",
      department: "All Staff",
    });
  });
});
