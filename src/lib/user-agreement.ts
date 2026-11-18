export const USER_AGREEMENT_VERSION = "2027-01-01-v2";
const ACCEPTANCE_KEY = "gilnet_user_agreement_accepted";

export function hasAcceptedUserAgreement(
  storage: Pick<Storage, "getItem">,
  version = USER_AGREEMENT_VERSION,
): boolean {
  return storage.getItem(ACCEPTANCE_KEY) === version;
}

export function recordUserAgreementAcceptance(
  storage: Pick<Storage, "setItem">,
  version = USER_AGREEMENT_VERSION,
): void {
  storage.setItem(ACCEPTANCE_KEY, version);
}
