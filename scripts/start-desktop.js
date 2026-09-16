#!/usr/bin/env node

const { existsSync, readdirSync } = require("fs");
const { join } = require("path");
const { spawn, spawnSync } = require("child_process");

const root = join(__dirname, "..");
const productName = "雅思词汇";
const distDir = join(root, "dist");

function findBuiltApp() {
  if (!existsSync(distDir)) return null;
  for (const dir of readdirSync(distDir)) {
    if (!dir.startsWith("mac")) continue;
    const appPath = join(distDir, dir, `${productName}.app`);
    if (existsSync(appPath)) return appPath;
  }
  return null;
}

function buildApp() {
  const result = spawnSync("npm", ["run", "dist:app"], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

let appPath = findBuiltApp();
if (!appPath) {
  console.log("Building the desktop app first...");
  buildApp();
  appPath = findBuiltApp();
}

if (!appPath) {
  console.error("Desktop app was not found after build.");
  process.exit(1);
}

const child = spawn("open", ["-n", appPath], {
  cwd: root,
  detached: true,
  stdio: "ignore",
});

child.unref();
console.log("Desktop app launched.");
