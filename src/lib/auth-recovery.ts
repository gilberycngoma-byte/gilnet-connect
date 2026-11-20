export function isPasswordRecoveryCallback(url: URL, hasPendingAdminOAuth: boolean) {
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
  const errorCode = url.searchParams.get("error_code") ?? hashParams.get("error_code");
  return (
    url.searchParams.get("type") === "recovery" ||
    hashParams.get("type") === "recovery" ||
    errorCode?.startsWith("otp_") === true ||
    (!hasPendingAdminOAuth && (url.searchParams.has("code") || hashParams.has("code")))
  );
}
