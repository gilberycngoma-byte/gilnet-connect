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

export function withPasswordRecoveryTimeout<T>(
  request: Promise<T>,
  timeoutMs = 15_000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(
      () =>
        reject(
          new Error("The password reset request timed out. Check your inbox before trying again."),
        ),
      timeoutMs,
    );
    request.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}
