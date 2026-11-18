const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { app, safeStorage, shell } = require("electron");

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const DRIVE_SCOPE = "openid email https://www.googleapis.com/auth/drive.appdata";
const MAX_BACKUP_SIZE = 25 * 1024 * 1024;
const tokenFile = () => path.join(app.getPath("userData"), "google-drive-token.bin");

function assertClientId(clientId) {
  if (typeof clientId !== "string" || !/^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
    throw new Error("Enter a valid Google OAuth Desktop app Client ID.");
  }
}

function base64Url(value) {
  return value.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function assertSecureStorage() {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Windows secure storage is unavailable; Google Drive tokens were not saved.");
  }
}

async function loadTokens() {
  assertSecureStorage();
  let encrypted;
  try {
    encrypted = await fs.readFile(tokenFile());
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
  try {
    return JSON.parse(safeStorage.decryptString(encrypted));
  } catch {
    throw new Error("Saved Google Drive authorization could not be decrypted. Disconnect and reconnect Drive.");
  }
}

async function saveTokens(tokens) {
  assertSecureStorage();
  const file = tokenFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, safeStorage.encryptString(JSON.stringify(tokens)));
  await fs.rename(temporary, file);
}

function waitForAuthorization(clientId) {
  return new Promise((resolve, reject) => {
    const verifier = base64Url(crypto.randomBytes(64));
    const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
    const state = base64Url(crypto.randomBytes(32));
    let server;
    let timer;
    let redirectUri;
    let completed = false;

    const finish = (error, value) => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      if (server?.listening) server.close();
      if (error) reject(error);
      else resolve(value);
    };

    server = http.createServer((request, response) => {
      const callback = new URL(request.url || "/", "http://127.0.0.1");
      if (callback.pathname !== "/oauth2callback") {
        response.writeHead(404).end();
        return;
      }
      if (callback.searchParams.get("state") !== state) {
        response.writeHead(400, { "content-type": "text/plain; charset=utf-8" }).end("Invalid OAuth state.");
        finish(new Error("Google sign-in returned an invalid state."));
        return;
      }
      const providerError = callback.searchParams.get("error");
      const code = callback.searchParams.get("code");
      if (providerError || !code) {
        response.writeHead(400, { "content-type": "text/plain; charset=utf-8" })
          .end("Google Drive connection was not completed. You can close this tab.");
        finish(new Error(providerError ? `Google sign-in failed: ${providerError}` : "Google sign-in returned no authorization code."));
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" })
        .end("<!doctype html><title>GILNET connected</title><p>Google Drive is connected. You can return to GILNET.</p>");
      finish(null, { code, verifier, redirectUri });
    });

    server.on("error", (error) => finish(error));
    server.listen(0, "127.0.0.1", async () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        finish(new Error("Could not start the local Google sign-in callback."));
        return;
      }
      redirectUri = `http://127.0.0.1:${address.port}/oauth2callback`;
      const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authUrl.searchParams.set("client_id", clientId);
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("scope", DRIVE_SCOPE);
      authUrl.searchParams.set("access_type", "offline");
      authUrl.searchParams.set("prompt", "consent");
      authUrl.searchParams.set("state", state);
      authUrl.searchParams.set("code_challenge", challenge);
      authUrl.searchParams.set("code_challenge_method", "S256");
      try {
        await shell.openExternal(authUrl.toString());
      } catch (error) {
        finish(error instanceof Error ? error : new Error("Could not open Google sign-in."));
      }
    });
    timer = setTimeout(() => finish(new Error("Google sign-in timed out. Try connecting again.")), 180_000);
    timer.unref?.();
  });
}

async function responseJson(response, operation) {
  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      if (!response.ok) throw new Error(`${operation} failed with HTTP ${response.status}.`);
      throw new Error(`${operation} returned invalid JSON.`);
    }
  }
  if (!response.ok) {
    const message = data.error_description || data.error?.message || data.error || `HTTP ${response.status}`;
    throw new Error(`${operation} failed: ${message}`);
  }
  return data;
}

async function exchangeCode(clientId, authorization) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      code: authorization.code,
      code_verifier: authorization.verifier,
      grant_type: "authorization_code",
      redirect_uri: authorization.redirectUri,
    }),
  });
  const tokens = await responseJson(response, "Google token exchange");
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error("Google did not return an offline refresh token. Revoke this app's Drive access in Google Account settings and reconnect.");
  }
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000,
    email: "",
  };
}

async function refreshTokens(clientId, tokens) {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      refresh_token: tokens.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const refreshed = await responseJson(response, "Google token refresh");
  const nextTokens = {
    ...tokens,
    accessToken: refreshed.access_token,
    expiresAt: Date.now() + Number(refreshed.expires_in || 3600) * 1000,
  };
  await saveTokens(nextTokens);
  return nextTokens;
}

async function getAccessToken(clientId, forceRefresh = false) {
  assertClientId(clientId);
  const tokens = await loadTokens();
  if (!tokens?.refreshToken) throw new Error("Connect Google Drive before syncing a backup.");
  if (!forceRefresh && tokens.accessToken && tokens.expiresAt > Date.now() + 60_000) {
    return tokens.accessToken;
  }
  return (await refreshTokens(clientId, tokens)).accessToken;
}

async function authorizedFetch(clientId, url, options = {}, retried = false) {
  const accessToken = await getAccessToken(clientId);
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), authorization: `Bearer ${accessToken}` },
  });
  if (response.status === 401 && !retried) {
    await getAccessToken(clientId, true);
    return authorizedFetch(clientId, url, options, true);
  }
  return response;
}

async function driveJson(clientId, url, options, operation) {
  return responseJson(await authorizedFetch(clientId, url, options), operation);
}

async function listBackupFiles(clientId, propertyCode) {
  const name = `gilnet-backup-${propertyCode}.json`;
  const query = new URLSearchParams({
    spaces: "appDataFolder",
    q: `name='${name}' and 'appDataFolder' in parents and trashed=false`,
    fields: "files(id,name,modifiedTime)",
    orderBy: "modifiedTime desc",
    pageSize: "10",
  });
  const result = await driveJson(clientId, `${DRIVE_API}/files?${query}`, {}, "Google Drive backup lookup");
  return Array.isArray(result.files) ? result.files : [];
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBackupRecordKey(key, code) {
  const exactKeys = [
    `gilnet_cloud250_property_${code}`,
    `gilnet_cloud250_rooms_${code}`,
    `gilnet_cloud250_reservations_${code}`,
    `gilnet_cloud250_notices_${code}`,
    `gilnet_cloud250_menu_${code}`,
    `gilnet_cloud250_sales_${code}`,
    `gilnet_cloud250_outbox_${code}`,
    `gilnet_cloud250_revisions_${code}`,
  ];
  return exactKeys.includes(key) ||
    key.startsWith(`gilnet_cloud250_messages_${code}_`) ||
    key.startsWith(`gilnet_cloud250_direct_messages_${code}_`);
}

function validateBackup(backup, expectedPropertyCode) {
  if (!isObject(backup) || backup.format !== "gilnet-property-backup" || backup.version !== 1) {
    throw new Error("The backup format is not supported.");
  }
  if (typeof backup.propertyCode !== "string" || !/^[A-Z0-9_-]{1,32}$/.test(backup.propertyCode)) {
    throw new Error("The backup property code is invalid.");
  }
  if (backup.propertyCode !== expectedPropertyCode || !isObject(backup.records)) {
    throw new Error("The backup belongs to a different property or has invalid records.");
  }
  if (
    typeof backup.createdAt !== "string" ||
    Number.isNaN(Date.parse(backup.createdAt)) ||
    Object.keys(backup.records).some((key) => !isBackupRecordKey(key, backup.propertyCode))
  ) {
    throw new Error("The backup contains unsupported or out-of-scope property data.");
  }
  const serialized = JSON.stringify(backup);
  if (serialized.length > MAX_BACKUP_SIZE) throw new Error("This property backup exceeds 25 MB.");
  return serialized;
}

async function connect(clientId) {
  assertClientId(clientId);
  assertSecureStorage();
  const authorization = await waitForAuthorization(clientId);
  const tokens = await exchangeCode(clientId, authorization);
  const profileResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { authorization: `Bearer ${tokens.accessToken}` },
  });
  const profile = await responseJson(profileResponse, "Google account lookup");
  tokens.email = typeof profile.email === "string" ? profile.email : "";
  await saveTokens(tokens);
  return { connected: true, email: tokens.email };
}

async function getStatus() {
  const tokens = await loadTokens();
  return { connected: !!tokens?.refreshToken, email: tokens?.email || "" };
}

async function disconnect() {
  await fs.rm(tokenFile(), { force: true });
  return { connected: false, email: "" };
}

async function backup(clientId, payload) {
  const serialized = validateBackup(payload, payload?.propertyCode);
  const files = await listBackupFiles(clientId, payload.propertyCode);
  let fileId = files[0]?.id;
  if (!fileId) {
    const metadata = await driveJson(
      clientId,
      `${DRIVE_API}/files?fields=id`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: `gilnet-backup-${payload.propertyCode}.json`,
          mimeType: "application/json",
          parents: ["appDataFolder"],
        }),
      },
      "Google Drive backup creation",
    );
    fileId = metadata.id;
  }
  if (typeof fileId !== "string" || !fileId) throw new Error("Google Drive did not return a backup file ID.");
  const query = new URLSearchParams({ uploadType: "media", fields: "id,modifiedTime" });
  const result = await driveJson(
    clientId,
    `${DRIVE_UPLOAD_API}/files/${encodeURIComponent(fileId)}?${query}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: serialized,
    },
    "Google Drive backup upload",
  );
  return { modifiedTime: result.modifiedTime || "" };
}

async function restore(clientId, propertyCode) {
  if (typeof propertyCode !== "string" || !/^[A-Z0-9_-]{1,32}$/.test(propertyCode)) {
    throw new Error("The property code is invalid.");
  }
  const files = await listBackupFiles(clientId, propertyCode);
  if (!files.length) return null;
  const response = await authorizedFetch(
    clientId,
    `${DRIVE_API}/files/${encodeURIComponent(files[0].id)}?alt=media`,
  );
  const backup = await responseJson(response, "Google Drive backup download");
  validateBackup(backup, propertyCode);
  return backup;
}

module.exports = { backup, connect, disconnect, getStatus, restore };
