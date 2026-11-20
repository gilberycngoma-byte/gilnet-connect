const { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, screen, shell } = require("electron");
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const path = require("path");
const { pathToFileURL } = require("node:url");
const googleDrive = require("./google-drive.cjs");
const { createLocalAppServer } = require("./local-server.cjs");
const { normalizePropertyId } = require("./property-code.cjs");
const {
  findAuthCallback,
  isAuthCallbackUrl,
  isSupabaseAuthorizeUrl,
} = require("./auth-protocol.cjs");
const startupLogPath = path.join(
  process.env.TEMP || process.env.TMP || app.getPath("temp"),
  "gilnet-gpm-connect-startup.log",
);

function logStartup(message, error) {
  const detail = error instanceof Error ? error.stack || error.message : error ? String(error) : "";
  const entry = `${new Date().toISOString()} [${process.pid}] ${message}${detail ? `\n${detail}` : ""}\n`;
  try {
    fsSync.appendFileSync(startupLogPath, entry, "utf8");
  } catch (logError) {
    console.error("Could not write the desktop startup log", logError);
  }
  if (error) console.error(message, error);
}

function reportStartupFailure(message, error) {
  const detail = error instanceof Error ? error.stack || error.message : String(error);
  logStartup(message, error);
  dialog.showErrorBox(
    "GILNET GPM CONNECT could not start",
    `${message}\n\n${detail}\n\nStartup log: ${startupLogPath}`,
  );
}

logStartup("Main process loaded");
process.on("exit", (code) => logStartup(`Process exiting with code ${code}`));

const { autoUpdater } = require("electron-updater");
let mainWindow = null;
let bubbleWindow = null;
let serviceKeyWindow = null;
let localAppServer = null;
let closeRequested = false;
let closeBackupReady = false;
let authCallbackListenerReady = false;
let pendingAuthCallback = findAuthCallback(process.argv);
let authProtocolRegistered = false;
let isQuitting = false;
let closeBackupTimeout = null;
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.autoInstallOnAppStartup = false;
autoUpdater.allowPrerelease = false;

let appUrl = app.isPackaged ? "" : "http://localhost:5173";
let appOrigin = appUrl ? new URL(appUrl).origin : "";

ipcMain.handle("gilnet-check-for-updates", async (event) => {
  assertTrustedRenderer(event);
  if (!app.isPackaged)
    throw new Error("Installer updates are available in the installed desktop app.");
  const result = await autoUpdater.checkForUpdates();
  if (!result) throw new Error("The release server did not return update information.");
  const notes = result.updateInfo.releaseNotes;
  const releaseNotes =
    typeof notes === "string"
      ? notes
      : Array.isArray(notes)
        ? notes
            .map((entry) => (typeof entry === "string" ? entry : entry.note))
            .filter(Boolean)
            .join("\n")
        : "";
  return {
    available: result.isUpdateAvailable,
    version: result.updateInfo.version,
    releaseNotes,
  };
});
ipcMain.handle("gilnet-update", async (event) => {
  assertTrustedRenderer(event);
  if (!app.isPackaged)
    throw new Error("Installer updates are available in the installed desktop app.");
  const result = await autoUpdater.checkForUpdates();
  if (!result) throw new Error("The release server did not return update information.");
  if (!result.isUpdateAvailable) throw new Error("There is no newer desktop update to install.");
  await autoUpdater.downloadUpdate();
  autoUpdater.quitAndInstall();
});
ipcMain.handle("gilnet-save-supabase-service-role-key", async (event, value) => {
  assertServiceKeyWindow(event);
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Windows secure storage is unavailable; the Supabase key was not saved.");
  }
  const key = validateServiceRoleKey(value);
  const encrypted = safeStorage.encryptString(key);
  const filePath = serviceRoleKeyPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, encrypted);
  process.env["SUPABASE_SERVICE_ROLE_KEY"] = key;
});
ipcMain.handle("gilnet-auth-open-url", async (event, value) => {
  assertTrustedRenderer(event);
  if (!authProtocolRegistered) {
    throw new Error(
      "The GILNET sign-in return link is not registered. Restart the desktop app and try again.",
    );
  }
  const supabaseUrl = getConfiguredSupabaseUrl();
  if (!supabaseUrl || !isSupabaseAuthorizeUrl(value, supabaseUrl)) {
    throw new Error("The Supabase sign-in address could not be verified.");
  }
  await shell.openExternal(value);
});

function createBubbleWindow() {
  if (bubbleWindow && !bubbleWindow.isDestroyed()) return;
  bubbleWindow = new BrowserWindow({
    width: 64,
    height: 180,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    hasShadow: false,
    focusable: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "bubble-preload.cjs"),
    },
  });
  bubbleWindow.setIgnoreMouseEvents(false);
  bubbleWindow.setMenu(null);
  const bounds = bubbleWindow.getBounds();
  bubbleWindow.setPosition(
    Math.max(0, screen.getPrimaryDisplay().workAreaSize.width - bounds.width - 20),
    Math.max(0, screen.getPrimaryDisplay().workAreaSize.height - 220),
  );
  void bubbleWindow.loadFile(path.join(__dirname, "bubbles.html")).catch((error) => {
    logStartup("Could not load desktop quick-access bubbles", error);
  });
}

function openMainRoute(route) {
  if (!["/attendance", "/messages", "/notices"].includes(route)) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  const target = new URL(appUrl);
  target.pathname = route;
  target.search = "";
  void mainWindow.loadURL(target.toString());
}

ipcMain.on("gilnet-open-bubble-route", (event, route) => {
  if (event.sender !== bubbleWindow?.webContents) return;
  openMainRoute(route);
});

ipcMain.on("gilnet-set-bubbles", (event, value) => {
  try {
    assertTrustedRenderer(event);
  } catch {
    return;
  }
  if (!bubbleWindow || bubbleWindow.isDestroyed()) createBubbleWindow();
  bubbleWindow?.webContents.send("gilnet-bubble-state", value);
});
ipcMain.handle("gilnet-auth-register-listener", (event) => {
  assertTrustedRenderer(event);
  authCallbackListenerReady = true;
  const callbackUrl = pendingAuthCallback;
  pendingAuthCallback = null;
  return callbackUrl;
});
ipcMain.on("gilnet-auth-unregister-listener", (event) => {
  if (event.sender === mainWindow?.webContents) authCallbackListenerReady = false;
});

function getConfiguredSupabaseUrl() {
  const configuredUrl = process.env["SUPABASE_URL"] || process.env["VITE_SUPABASE_URL"];
  if (configuredUrl) return configuredUrl;
  const configPath = path.join(app.getAppPath(), "dist", "client", "desktop-supabase-config.json");
  try {
    const config = JSON.parse(fsSync.readFileSync(configPath, "utf8"));
    return typeof config.url === "string" ? config.url : "";
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

function queueAuthCallback(url) {
  if (!isAuthCallbackUrl(url)) {
    logStartup("Blocked an invalid GILNET sign-in callback URL");
    return;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    if (authCallbackListenerReady) {
      mainWindow.webContents.send("gilnet-auth-callback", url);
      return;
    }
  }
  pendingAuthCallback = url;
}

app.on("open-url", (event, url) => {
  event.preventDefault();
  queueAuthCallback(url);
});

function assertTrustedRenderer(event) {
  if (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame) {
    throw new Error("This desktop feature is available only in the main GILNET window.");
  }
  let senderOrigin;
  try {
    senderOrigin = new URL(event.senderFrame.url).origin;
  } catch {
    throw new Error("The GILNET window origin could not be verified.");
  }
  if (senderOrigin !== appOrigin)
    throw new Error("Google Drive request came from an untrusted origin.");
}

function validateServiceRoleKey(value) {
  const key = typeof value === "string" ? value.trim() : "";
  if (!key || key.length > 4096 || /[\r\n]/.test(key)) {
    throw new Error("Enter a valid Supabase service-role or secret key.");
  }
  if (key.startsWith("sb_secret_")) return key;

  const payload = key.split(".")[1];
  if (payload) {
    try {
      const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      if (claims.role === "service_role") return key;
    } catch {
      // The key is rejected below when it is not a service-role JWT.
    }
  }
  throw new Error("Use a Supabase service-role JWT or project secret key, not a publishable key.");
}

function serviceRoleKeyPath() {
  return path.join(app.getPath("userData"), "supabase-service-role-key.bin");
}

async function loadStoredServiceRoleKey() {
  let encrypted;
  try {
    encrypted = await fs.readFile(serviceRoleKeyPath());
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      "Windows secure storage is unavailable; the saved Supabase key cannot be decrypted.",
    );
  }
  const key = validateServiceRoleKey(safeStorage.decryptString(encrypted));
  process.env["SUPABASE_SERVICE_ROLE_KEY"] = key;
  return true;
}

function assertServiceKeyWindow(event) {
  const expectedUrl = pathToFileURL(path.join(__dirname, "service-key-setup.html")).href;
  if (
    event.sender !== serviceKeyWindow?.webContents ||
    event.senderFrame !== event.sender.mainFrame ||
    event.senderFrame.url !== expectedUrl
  ) {
    throw new Error("Supabase key setup is available only in the trusted local setup window.");
  }
}

function openServiceKeyWindow() {
  if (serviceKeyWindow && !serviceKeyWindow.isDestroyed()) {
    serviceKeyWindow.show();
    serviceKeyWindow.focus();
    return;
  }

  const setupPath = path.join(__dirname, "service-key-setup.html");
  serviceKeyWindow = new BrowserWindow({
    width: 560,
    height: 600,
    resizable: false,
    parent: mainWindow || undefined,
    title: "Secure Supabase Setup",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  serviceKeyWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== pathToFileURL(setupPath).href) event.preventDefault();
  });
  serviceKeyWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  serviceKeyWindow.on("closed", () => {
    serviceKeyWindow = null;
  });
  void serviceKeyWindow.loadFile(setupPath).catch((error) => {
    logStartup("Could not open the secure Supabase key setup window", error);
    serviceKeyWindow?.close();
  });
}

async function startBundledAppServer() {
  process.env["GILNET_DESKTOP_APP"] = "true";
  const appPath = app.getAppPath();
  const configPath = path.join(appPath, "dist", "client", "desktop-supabase-config.json");
  let config;
  try {
    config = JSON.parse(await fs.readFile(configPath, "utf8"));
  } catch (error) {
    throw new Error(
      `The bundled Supabase public configuration is missing or invalid: ${error.message}`,
    );
  }
  if (
    !config ||
    typeof config.url !== "string" ||
    !/^https?:\/\//.test(config.url) ||
    typeof config.publishableKey !== "string" ||
    !config.publishableKey
  ) {
    throw new Error("The bundled Supabase URL or publishable key is invalid.");
  }

  process.env["SUPABASE_URL"] = config.url;
  process.env["SUPABASE_PUBLISHABLE_KEY"] = config.publishableKey;
  try {
    await loadStoredServiceRoleKey();
  } catch (error) {
    logStartup("Could not load the locally encrypted Supabase service key", error);
    dialog.showErrorBox(
      "Supabase server key unavailable",
      "The app will open, but desktop server operations requiring the local service key will be unavailable. Re-enter the key from File > Configure Supabase server key.",
    );
  }

  return createLocalAppServer({
    clientDirectory: path.join(appPath, "dist", "client"),
    serverEntry: path.join(appPath, "dist", "server", "server.js"),
    host: "127.0.0.1",
    port: 41287,
    onRequestError: (error) => logStartup("Local GILNET request failed", error),
    onServerError: (error) => logStartup("Local GILNET server error", error),
  });
}

function propertyFolderPath(propertyId) {
  return path.join(app.getPath("documents"), "GILNET GPM CONNECT", normalizePropertyId(propertyId));
}

async function ensurePropertyFolder(propertyId, propertyName) {
  const code = normalizePropertyId(propertyId);
  const name = typeof propertyName === "string" ? propertyName.trim() : "";
  if (!name || name.length > 160) throw new Error("The property name is invalid.");
  const folder = propertyFolderPath(code);
  const databasePath = path.join(folder, "database");
  const backupPath = path.join(folder, "backups");
  await Promise.all([
    fs.mkdir(path.join(folder, "files"), { recursive: true }),
    fs.mkdir(backupPath, { recursive: true }),
    fs.mkdir(databasePath, { recursive: true }),
  ]);

  const propertyFile = path.join(folder, "property.json");
  let createdAt = new Date().toISOString();
  try {
    const existing = JSON.parse(await fs.readFile(propertyFile, "utf8"));
    if (
      !existing ||
      existing.propertyId !== code ||
      typeof existing.createdAt !== "string" ||
      Number.isNaN(Date.parse(existing.createdAt))
    ) {
      throw new Error(
        "The local property.json file is invalid. The existing file was left unchanged.",
      );
    }
    createdAt = existing.createdAt;
  } catch (error) {
    if (error && error.code !== "ENOENT") throw error;
  }
  await fs.writeFile(
    propertyFile,
    JSON.stringify({ propertyId: code, propertyName: name, createdAt }, null, 2),
    "utf8",
  );
  return { path: folder, databasePath, backupPath, createdAt };
}

async function savePropertyBackup(propertyId, propertyName, backup) {
  const code = normalizePropertyId(propertyId);
  if (!backup || backup.propertyCode !== code || typeof backup.createdAt !== "string") {
    throw new Error("The local backup does not match this property.");
  }
  const serialized = JSON.stringify(backup);
  if (serialized.length > 25 * 1024 * 1024)
    throw new Error("The local property backup exceeds 25 MB.");

  const folder = await ensurePropertyFolder(code, propertyName);
  const timestamp = Date.parse(backup.createdAt);
  if (Number.isNaN(timestamp)) throw new Error("The local backup timestamp is invalid.");
  const backupFile = path.join(folder.backupPath, `backup-${timestamp}.json`);
  const databaseFile = path.join(folder.databasePath, "local-cache.json");
  await Promise.all([
    fs.writeFile(backupFile, serialized, "utf8"),
    fs.writeFile(databaseFile, serialized, "utf8"),
  ]);

  const retainedFiles = (await fs.readdir(folder.backupPath))
    .filter((name) => /^backup-\d+\.json$/.test(name))
    .sort((left, right) => Number(right.slice(7, -5)) - Number(left.slice(7, -5)));
  await Promise.all(
    retainedFiles.slice(30).map((name) => fs.unlink(path.join(folder.backupPath, name))),
  );
  return folder;
}

ipcMain.handle("gilnet-property-folder", async (event, propertyId, propertyName) => {
  assertTrustedRenderer(event);
  return ensurePropertyFolder(propertyId, propertyName);
});
ipcMain.handle("gilnet-property-backup", async (event, propertyId, propertyName, backup) => {
  assertTrustedRenderer(event);
  return savePropertyBackup(propertyId, propertyName, backup);
});
ipcMain.handle("gilnet-open-property-folder", async (event, propertyId) => {
  assertTrustedRenderer(event);
  const folder = propertyFolderPath(propertyId);
  await fs.mkdir(folder, { recursive: true });
  const error = await shell.openPath(folder);
  if (error) throw new Error(`Could not open the property folder: ${error}`);
});

ipcMain.on("gilnet-backup-complete", (event) => {
  assertTrustedRenderer(event);
  if (!closeRequested) return;
  closeRequested = false;
  if (closeBackupTimeout) clearTimeout(closeBackupTimeout);
  isQuitting = true;
  app.quit();
});
ipcMain.on("gilnet-register-before-close", (event) => {
  assertTrustedRenderer(event);
  closeBackupReady = true;
});
ipcMain.on("gilnet-unregister-before-close", (event) => {
  assertTrustedRenderer(event);
  closeBackupReady = false;
});

ipcMain.handle("gilnet-drive-status", (event) => {
  assertTrustedRenderer(event);
  return googleDrive.getStatus();
});
ipcMain.handle("gilnet-drive-connect", (event, clientId) => {
  assertTrustedRenderer(event);
  return googleDrive.connect(clientId);
});
ipcMain.handle("gilnet-drive-disconnect", (event) => {
  assertTrustedRenderer(event);
  return googleDrive.disconnect();
});
ipcMain.handle("gilnet-drive-backup", (event, clientId, payload) => {
  assertTrustedRenderer(event);
  return googleDrive.backup(clientId, payload);
});
ipcMain.handle("gilnet-drive-restore", (event, clientId, propertyCode) => {
  assertTrustedRenderer(event);
  return googleDrive.restore(clientId, propertyCode);
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();
logStartup(`Single-instance lock ${hasSingleInstanceLock ? "acquired" : "not acquired"}`);

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    logStartup("A second instance requested the main window");
    const authCallback = findAuthCallback(argv);
    if (authCallback) queueAuthCallback(authCallback);
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app
    .whenReady()
    .then(async () => {
      logStartup("Electron app is ready");
      const developmentAppArgs = process.argv[1] ? [path.resolve(process.argv[1])] : [];
      authProtocolRegistered = app.isPackaged
        ? app.setAsDefaultProtocolClient("gilnet")
        : app.setAsDefaultProtocolClient("gilnet", process.execPath, developmentAppArgs);
      if (!authProtocolRegistered) logStartup("Could not register the GILNET sign-in return link");
      if (app.isPackaged) {
        localAppServer = await startBundledAppServer();
        appUrl = localAppServer.origin;
        appOrigin = new URL(appUrl).origin;
        logStartup(`Bundled local app server listening at ${appUrl}`);
      }

      const fileMenu = app.isPackaged
        ? [
            { label: "Configure Supabase server key…", click: openServiceKeyWindow },
            { type: "separator" },
            { role: "quit" },
          ]
        : [{ role: "quit" }];
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          { label: "File", submenu: fileMenu },
          { role: "editMenu" },
          { role: "viewMenu" },
          { role: "windowMenu" },
        ]),
      );

      const splash = new BrowserWindow({
        width: 500,
        height: 700,
        frame: false,
        alwaysOnTop: true,
      });
      void splash.loadFile(path.join(__dirname, "..", "public", "splash.html")).catch((error) => {
        logStartup("Could not load the desktop splash screen", error);
      });

      const main = new BrowserWindow({
        width: 1280,
        height: 800,
        show: false,
        autoHideMenuBar: true,
        icon: path.join(__dirname, "..", "public", "icon-512.png"),
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          preload: path.join(__dirname, "preload.cjs"),
        },
      });
      mainWindow = main;
      logStartup("Main and splash windows were created");
      main.webContents.on("did-start-loading", () => {
        authCallbackListenerReady = false;
      });
      main.on("close", (event) => {
        if (isQuitting) return;
        event.preventDefault();
        main.hide();
        if (!bubbleWindow || bubbleWindow.isDestroyed()) createBubbleWindow();
      });

      const showOfflineFallback = () => {
        if (main.isDestroyed() || main.__offlineFallback) return;
        main.__offlineFallback = true;
        void main
          .loadFile(path.join(__dirname, "..", "public", "offline.html"))
          .catch((error) => logStartup("Could not load the offline startup page", error));
      };

      main.webContents.on("will-navigate", (event, url) => {
        if (url.startsWith("mailto:") || url.startsWith("tel:")) {
          event.preventDefault();
          void shell.openExternal(url);
          return;
        }

        let targetOrigin;
        try {
          targetOrigin = new URL(url).origin;
        } catch (error) {
          event.preventDefault();
          console.warn("Blocked an invalid desktop navigation URL", error);
          return;
        }

        if (
          main.__offlineFallback &&
          url === pathToFileURL(path.join(__dirname, "..", "public", "offline.html")).href
        ) {
          return;
        }
        if (targetOrigin !== appOrigin) {
          event.preventDefault();
          return;
        }
        main.__offlineFallback = false;
      });

      main.webContents.setWindowOpenHandler(({ url }) => {
        if (/^(https:|mailto:|tel:)/i.test(url)) void shell.openExternal(url);
        return { action: "deny" };
      });

      main.webContents.on("did-finish-load", () => {
        logStartup(`Desktop page loaded: ${main.webContents.getURL()}`);
      });

      main.webContents.on(
        "did-fail-load",
        (_event, errorCode, description, _validatedUrl, isMainFrame) => {
          if (!isMainFrame || errorCode === -3) return;
          logStartup(`Desktop app navigation failed (${errorCode}): ${description}`);
          showOfflineFallback();
        },
      );

      void main.loadURL(appUrl).catch((error) => {
        logStartup("Could not open the GILNET app", error);
        showOfflineFallback();
      });

      setTimeout(() => {
        if (!splash.isDestroyed()) splash.close();
        if (!main.isDestroyed()) {
          main.show();
          logStartup("Main window shown");
        }
      }, 3000);

      main.on("closed", () => {
        mainWindow = null;
        authCallbackListenerReady = false;
      });
    })
    .catch((error) => {
      reportStartupFailure("Could not initialize the desktop app", error);
      app.quit();
    });

  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    logStartup("Electron app is quitting");
    isQuitting = true;
    if (closeBackupTimeout) clearTimeout(closeBackupTimeout);
    if (localAppServer) {
      void localAppServer
        .close()
        .catch((error) => logStartup("Could not close the bundled local app server", error));
      localAppServer = null;
    }
  });
}
