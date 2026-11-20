const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("gilnetBubbles", {
  openRoute: (route) => ipcRenderer.send("gilnet-open-bubble-route", route),
  onState: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("gilnet-bubble-state", listener);
    return () => ipcRenderer.removeListener("gilnet-bubble-state", listener);
  },
});
