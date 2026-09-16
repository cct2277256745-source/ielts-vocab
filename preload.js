const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ieltsApp", {
  isDesktop: true,
  lookupWord: (word) => ipcRenderer.invoke("ielts:lookup-word", word),
  getApiConfig: () => ipcRenderer.invoke("ielts:get-api-config"),
  saveApiConfig: (payload) => ipcRenderer.invoke("ielts:save-api-config", payload),
  testApiConnection: (payload) => ipcRenderer.invoke("ielts:test-api-connection", payload),
  exportApkg: (payload) => ipcRenderer.invoke("ielts:export-apkg", payload),
  openConfig: () => ipcRenderer.invoke("ielts:open-config"),
});
