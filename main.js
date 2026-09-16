const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { buildApkg, ensureEnvFile, getPublicConfig, lookupWord, saveApiConfig, testApiConnection } = require("./core");

const appName = "雅思词汇";
const appIconPath = path.join(__dirname, "icon.png");

app.setName(appName);
app.setAboutPanelOptions({
  applicationName: appName,
  applicationVersion: app.getVersion(),
});

const appHtmlPath = path.join(__dirname, "index.html");
const preloadPath = path.join(__dirname, "preload.js");

function getEnvPath() {
  return path.join(app.getPath("userData"), ".env");
}

function ensureDesktopConfig() {
  return ensureEnvFile({
    envPath: getEnvPath(),
    templatePath: path.join(__dirname, ".env.example"),
  });
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 860,
    minWidth: 920,
    minHeight: 700,
    title: appName,
    icon: appIconPath,
    backgroundColor: "#f4f5f9",
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  await win.loadFile(appHtmlPath);
  return win;
}

ipcMain.handle("ielts:lookup-word", async (_event, word) => {
  const value = String(word || "").trim();
  if (!value) throw new Error("请输入单词");
  ensureDesktopConfig();
  return lookupWord(value, { envPath: getEnvPath() });
});

ipcMain.handle("ielts:get-api-config", async () => {
  ensureDesktopConfig();
  return getPublicConfig({ envPath: getEnvPath() });
});

ipcMain.handle("ielts:save-api-config", async (_event, payload) => {
  ensureDesktopConfig();
  saveApiConfig({
    envPath: getEnvPath(),
    apiKey: payload && payload.apiKey,
    model: payload && payload.model,
    baseUrl: payload && payload.baseUrl,
  });
  return getPublicConfig({ envPath: getEnvPath() });
});

ipcMain.handle("ielts:test-api-connection", async (_event, payload) => {
  ensureDesktopConfig();
  return testApiConnection({
    envPath: getEnvPath(),
    apiKey: payload && payload.apiKey,
    model: payload && payload.model,
    baseUrl: payload && payload.baseUrl,
  });
});

ipcMain.handle("ielts:open-config", async () => {
  ensureDesktopConfig();
  return shell.openPath(getEnvPath());
});

ipcMain.handle("ielts:export-apkg", async (_event, payload) => {
  const cards = Array.isArray(payload && payload.cards) ? payload.cards.filter((c) => c && c.word) : [];
  if (!cards.length) throw new Error("没有可导出的单词");

  const deckName = String((payload && payload.deck) || "雅思生词本");
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: "导出 Anki 卡片",
    defaultPath: `${deckName}.apkg`,
    filters: [{ name: "Anki Package", extensions: ["apkg"] }],
  });
  if (canceled || !filePath) return { canceled: true };

  const buf = buildApkg(cards, deckName);
  fs.writeFileSync(filePath, buf);
  return { canceled: false, filePath };
});

app.whenReady().then(async () => {
  if (process.platform === "darwin" && app.dock && fs.existsSync(appIconPath)) {
    app.dock.setIcon(appIconPath);
  }

  ensureDesktopConfig();
  const win = await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
