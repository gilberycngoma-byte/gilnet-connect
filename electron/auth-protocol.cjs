function isAuthCallbackUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "gilnet:" && url.hostname === "auth" && url.pathname === "/callback";
  } catch {
    return false;
  }
}

function findAuthCallback(argv) {
  return argv.find((value) => isAuthCallbackUrl(value)) ?? null;
}

function isSupabaseAuthorizeUrl(value, supabaseUrl) {
  try {
    const url = new URL(value);
    const projectUrl = new URL(supabaseUrl);
    return (
      url.protocol === "https:" &&
      url.origin === projectUrl.origin &&
      url.pathname === "/auth/v1/authorize"
    );
  } catch {
    return false;
  }
}

module.exports = { findAuthCallback, isAuthCallbackUrl, isSupabaseAuthorizeUrl };
