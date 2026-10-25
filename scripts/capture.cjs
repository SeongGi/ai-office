// Capture marketing / README screenshots of the floor with Electron.
//   npx electron scripts/capture.cjs [outDir]
// Needs a running floor (agent-floor start). Uses the in-browser demo so the
// shots never show your real agents.
const { app, BrowserWindow, nativeTheme } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const out = path.resolve(process.argv[2] || 'docs/shots');
const PORT = Number(process.env.AGENT_FLOOR_PORT) || 4317;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  nativeTheme.themeSource = 'light';
  const win = new BrowserWindow({ width: 1920, height: 1080, show: false, useContentSize: true, webPreferences: { offscreen: false } });
  await win.loadURL(`http://127.0.0.1:${PORT}/?demo&stats`);
  await win.webContents.insertCSS('.stats{display:none!important}');
  const js = (code) => win.webContents.executeJavaScript(code);
  const shot = async (name) => {
    await wait(1800);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(out, `${name}.png`), img.toPNG());
    console.log('saved', name);
  };
  // Let everyone walk in and settle.
  await wait(26000);
  await js(`__floor.frameAll()`);
  await shot('01-overview-day');
  await js(`__floor.focusTeam('checkout-redesign')`);
  await shot('02-office-day');
  await js(`__floor.focusAgent('pixel')`);
  await shot('03-agent-day');
  await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'t'}))`);
  await js(`__floor.frameAll()`);
  await shot('04-overview-night');
  await js(`__floor.focusTeam('auth-service')`);
  await shot('05-office-night');
  app.quit();
});
