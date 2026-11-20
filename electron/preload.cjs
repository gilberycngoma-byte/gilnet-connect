const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("gilnetElectron", {
  checkForUpdates: () => ipcRenderer.invoke("gilnet-check-for-updates"),
  update: () => ipcRenderer.invoke("gilnet-update"),
  ensurePropertyFolder: (propertyId, propertyName) =>
    ipcRenderer.invoke("gilnet-property-folder", propertyId, propertyName),
  savePropertyBackup: (propertyId, propertyName, backup) =>
    ipcRenderer.invoke("gilnet-property-backup", propertyId, propertyName, backup),
  openPropertyFolder: (propertyId) => ipcRenderer.invoke("gilnet-open-property-folder", propertyId),
  onBeforeClose: (callback) => {
    const listener = () => callback();
    ipcRenderer.send("gilnet-register-before-close");
    ipcRenderer.on("gilnet-before-close", listener);
    return () => {
      ipcRenderer.removeListener("gilnet-before-close", listener);
      ipcRenderer.send("gilnet-unregister-before-close");
    };
  },
  completeCloseBackup: () => ipcRenderer.send("gilnet-backup-complete"),
  driveStatus: () => ipcRenderer.invoke("gilnet-drive-status"),
  connectDrive: (clientId) => ipcRenderer.invoke("gilnet-drive-connect", clientId),
  disconnectDrive: () => ipcRenderer.invoke("gilnet-drive-disconnect"),
  backupDrive: (clientId, backup) => ipcRenderer.invoke("gilnet-drive-backup", clientId, backup),
  restoreDrive: (clientId, propertyCode) =>
    ipcRenderer.invoke("gilnet-drive-restore", clientId, propertyCode),
  saveSupabaseServiceRoleKey: (key) =>
    ipcRenderer.invoke("gilnet-save-supabase-service-role-key", key),
  openOAuthUrl: (url) => ipcRenderer.invoke("gilnet-auth-open-url", url),
  setBubbles: (state) => ipcRenderer.send("gilnet-set-bubbles", state),
  onAuthCallback: async (callback) => {
    const listener = (_event, url) => callback(url);
    ipcRenderer.on("gilnet-auth-callback", listener);
    try {
      const pendingUrl = await ipcRenderer.invoke("gilnet-auth-register-listener");
      if (pendingUrl) callback(pendingUrl);
    } catch (error) {
      ipcRenderer.removeListener("gilnet-auth-callback", listener);
      throw error;
    }
    return () => {
      ipcRenderer.removeListener("gilnet-auth-callback", listener);
      ipcRenderer.send("gilnet-auth-unregister-listener");
    };
  },
});
