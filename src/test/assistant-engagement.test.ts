import { describe, expect, it } from "vitest";
import { shouldEngageAssistant } from "@/lib/bot";

describe("GILNET Assistant engagement", () => {
  it("runs for messages sent to the assistant department", () => {
    expect(shouldEngageAssistant("GILNET Assistant", "chat")).toBe(true);
    expect(shouldEngageAssistant("GILNET Assistant", "voice")).toBe(true);
  });

  it("does not run in staff department chats or for generated bot messages", () => {
    expect(shouldEngageAssistant("Housekeeping", "chat")).toBe(false);
    expect(shouldEngageAssistant("GILNET Assistant", "bot")).toBe(false);
  });
});
