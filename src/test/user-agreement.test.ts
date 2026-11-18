import { beforeEach, describe, expect, it } from "vitest";
import {
  hasAcceptedUserAgreement,
  recordUserAgreementAcceptance,
  USER_AGREEMENT_VERSION,
} from "@/lib/user-agreement";

beforeEach(() => {
  localStorage.clear();
});

describe("user agreement acceptance", () => {
  it("requires acceptance for the current agreement version", () => {
    expect(hasAcceptedUserAgreement(localStorage)).toBe(false);
  });

  it("records acceptance for the current agreement version", () => {
    recordUserAgreementAcceptance(localStorage);

    expect(hasAcceptedUserAgreement(localStorage)).toBe(true);
    expect(localStorage.getItem("gilnet_user_agreement_accepted")).toBe(USER_AGREEMENT_VERSION);
  });

  it("requires renewed acceptance when the agreement version changes", () => {
    localStorage.setItem("gilnet_user_agreement_accepted", "2027-01-01");

    expect(hasAcceptedUserAgreement(localStorage)).toBe(false);
  });

  it("requires renewed acceptance when the published agreement revision changes", () => {
    const revisionTwo = `${USER_AGREEMENT_VERSION}:2`;
    const revisionThree = `${USER_AGREEMENT_VERSION}:3`;
    recordUserAgreementAcceptance(localStorage, revisionTwo);

    expect(hasAcceptedUserAgreement(localStorage, revisionTwo)).toBe(true);
    expect(hasAcceptedUserAgreement(localStorage, revisionThree)).toBe(false);
  });
});
