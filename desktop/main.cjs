// AI Office desktop app (Electron).
//
// Opens the floor in its own window, with no browser involved. The floor server
// runs inside this process unless one is already running. The window can be
// closed; the app keeps listening from the menu bar / system tray so hooks
// never have to relaunch it. "Quit" pauses auto-launch for a while.
const { app, BrowserWindow, Menu, Tray, nativeImage, shell, nativeTheme, session, ipcMain } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { markPng } = require('./icon.cjs');
const { snooze } = require('./state.cjs');
const { resolveTarget, allowInWindow, saveChoice, currentChoice, remoteOrigin } = require('./target.cjs');
const { env } = require('../shared/env.cjs');

// 원격 서버 주소가 있으면 그 서버를, 저장된 선택이 로컬이면 로컬 서버를 연다(desktop/target.cjs).
// 저장된 선택이 없으면 needsChoice가 켜지고, 창에 연결 방식 선택 화면(choose.html)을 띄운다.
let TARGET = resolveTarget();
const startedByHook = process.argv.includes('--from-hook');
// 훅은 로컬 주소일 때만 앱을 연다(bin/ai-office.mjs). 이때 선택 화면을 띄우면 고를 때까지 로컬 서버가
// 없어 이벤트가 버려지므로, 선택을 저장하지 않고 이번에는 로컬로 연다.
if (TARGET.needsChoice && startedByHook) TARGET = { ...TARGET, needsChoice: false };
const PORT = TARGET.port;
const CHOOSER = path.join(__dirname, 'choose.html');
const CHOOSER_URL = pathToFileURL(CHOOSER).href;

app.setName('AI Office');

if (!app.requestSingleInstanceLock()) {
  // Another window is already open; it will focus itself (see second-instance).
  app.quit();
} else {
  let win = null;
  let tray = null;
  let floor = null;
  let quitting = false;
  let chooseShown = false; // 지금 창에 선택 화면(choose.html)이 떠 있는지

  async function serverIsUp() {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(600) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function ensureServer() {
    if (TARGET.remote || TARGET.needsChoice) return; // 원격 서버를 볼 때와 선택 전에는 로컬 서버를 띄우지 않는다.
    if (await serverIsUp()) return;
    const { startServer } = await import(pathToFileURL(path.join(__dirname, '../server/index.mjs')).href);
    floor = await startServer({ port: PORT, log: () => {} });
  }

  function loadChooser() {
    chooseShown = true;
    win.loadFile(CHOOSER);
  }

  // forceChoose가 true이면 서버 대신 선택 화면을 띄운다. 저장된 선택이 없을 때도 선택 화면을 띄운다.
  function createWindow(forceChoose = false) {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      if (forceChoose === true && !chooseShown) loadChooser();
      return;
    }
    chooseShown = false;
    win = new BrowserWindow({
      width: 1440,
      height: 920,
      minWidth: 720,
      minHeight: 480,
      title: 'AI Office',
      show: false,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b0e13' : '#e7ebf0',
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
      autoHideMenuBar: true,
      icon: nativeImage.createFromBuffer(markPng(256, { background: true })),
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: true, preload: path.join(__dirname, 'preload.cjs') },
    });
    win.once('ready-to-show', () => {
      // Opened by an agent hook: show without stealing focus from your editor.
      if (startedByHook && process.platform === 'darwin') win.showInactive();
      else win.show();
    });
    // Links (like the GitHub button) open in the real browser; the window stays on the floor.
    win.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, url) => {
      // 선택 화면에서는 어디로도 이동하지 못하게 하고, 외부 링크는 브라우저로 연다.
      if (chooseShown || !allowInWindow(TARGET, url)) {
        e.preventDefault();
        shell.openExternal(url);
      }
    });
    win.on('close', (e) => {
      // Closing the window keeps the floor listening in the tray.
      if (!quitting) {
        e.preventDefault();
        win.hide();
      }
    });
    win.on('closed', () => (win = null));
    if (forceChoose === true || TARGET.needsChoice) loadChooser();
    else win.loadURL(TARGET.url);
  }

  // 선택 화면(choose.html)에서 온 요청만 믿는다. 원격 서버의 페이지는 이 IPC를 부를 수 없다.
  function fromChooser(e) {
    try {
      const u = new URL(e.senderFrame?.url || '');
      return `${u.protocol}//${u.host}${u.pathname}` === CHOOSER_URL;
    } catch {
      return false;
    }
  }

  ipcMain.handle('choice:current', (e) => {
    if (!fromChooser(e)) return null;
    // 환경변수 주소가 우선이면 선택 화면이 그 사실을 알려 줄 수 있도록 envUrl을 함께 준다.
    return { ...(currentChoice() || {}), envUrl: remoteOrigin(env('URL')) || '', canCancel: !TARGET.needsChoice };
  });

  // 서버 바꾸기를 취소하면 지금 연결된 곳으로 돌아간다. 아직 고르지 않았으면 돌아갈 곳이 없다.
  ipcMain.handle('choice:cancel', (e) => {
    if (!fromChooser(e) || TARGET.needsChoice || !win) return false;
    chooseShown = false;
    win.loadURL(TARGET.url);
    return true;
  });

  ipcMain.handle('choice:save', (e, c) => {
    if (!fromChooser(e)) return { ok: false, error: '허용되지 않은 요청이에요.' };
    let choice;
    if (c && typeof c === 'object' && c.mode === 'local') choice = { mode: 'local' };
    else if (c && typeof c === 'object' && typeof c.url === 'string') choice = { url: c.url };
    else return { ok: false, error: '연결 방식을 고르지 못했어요.' };
    const result = saveChoice(choice);
    if (result.ok) {
      // 다시 시작하면 로컬 서버를 띄우거나 끄는 처리를 새 실행이 알아서 한다.
      try {
        floor?.close();
      } catch {
        /* 종료 중이므로 무시한다 */
      }
      app.relaunch();
      app.exit(0);
    }
    return result;
  });

  function createTray() {
    const image =
      process.platform === 'darwin'
        ? nativeImage.createFromBuffer(markPng(32, { template: true }), { scaleFactor: 2 })
        : nativeImage.createFromBuffer(markPng(32));
    if (process.platform === 'darwin') image.setTemplateImage(true);
    tray = new Tray(image);
    tray.setToolTip('AI Office');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Show AI Office', click: () => createWindow() },
        { label: 'Change server…', click: () => createWindow(true) },
        { type: 'separator' },
        {
          label: 'Quit (pause auto-open for 6 hours)',
          click: () => {
            snooze(6);
            quitting = true;
            app.quit();
          },
        },
        {
          label: 'Quit',
          click: () => {
            quitting = true;
            app.quit();
          },
        },
      ]),
    );
    tray.on('click', () => createWindow());
  }

  app.on('second-instance', () => createWindow());
  app.on('activate', () => createWindow());
  app.on('before-quit', () => (quitting = true));
  app.on('window-all-closed', () => {
    /* keep running in the tray */
  });
  app.on('will-quit', () => floor?.close());

  app.whenReady().then(async () => {
    if (process.platform === 'darwin') app.dock?.setIcon(nativeImage.createFromBuffer(markPng(512, { background: true })));
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
        { role: 'editMenu' },
        { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
        { role: 'windowMenu' },
      ]),
    );
    await ensureServer();
    if (TARGET.remote && TARGET.token) {
      // 토큰은 주소에 싣지 않고 그 서버에만 가는 쿠키로 넣는다(desktop/target.cjs 설명 참고).
      await session.defaultSession.cookies
        .set({ url: TARGET.origin, name: 'af_token', value: TARGET.token, httpOnly: true, secure: TARGET.origin.startsWith('https:'), sameSite: 'lax', expirationDate: Date.now() / 1000 + 31536000 })
        .catch(() => {});
    }
    createTray();
    createWindow();
  });
}
