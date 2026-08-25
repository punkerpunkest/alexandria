// The wrapper. Electron's main process IS Node, so the existing server runs
// in-process and the window loads it — nothing in public/ or src/ changes.
//
// Run:  npx electron electron/main.js
// Dev mode is unaffected: `npm start` + a browser still works exactly as before.
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PORT = 4173;

// The worlds folder a world author drops a package into. Visible on purpose:
// never inside the .app bundle (signing) and never in Application Support (hidden).
const WORLDS_DIR = join(app.getPath('home'), 'Alexandria', 'worlds');

// Geometry is a pre-fixture decision — the window owns the stage box, and the
// panel aspect and body cap were both calibrated inside a box Chrome partly chose.
const WINDOW = { width: 1440, height: 900, minWidth: 1100, minHeight: 700 };

// FRAME: 'inset' keeps the traffic lights over the top strip; 'frameless' hides
// them and hands minimise/close to the chrome, which then costs strip space.
const FRAME = process.env.ALEX_FRAME ?? 'inset';

// quit() only *requests* a quit — the module body keeps running, so a second copy
// would still reach the server import below and bind PORT. Stop dead instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

await import(pathToFileURL(join(ROOT, 'server.js')).href);   // starts listening on PORT

function createWindow() {
  const win = new BrowserWindow({
    ...WINDOW,
    show: false,
    backgroundColor: '#1f2335',
    frame: FRAME !== 'frameless',
    titleBarStyle: FRAME === 'inset' ? 'hiddenInset' : 'default',
    trafficLightPosition: FRAME === 'inset' ? { x: 14, y: 13 } : undefined,
    webPreferences: { preload: join(HERE, 'preload.cjs'), sandbox: true },
  });
  win.once('ready-to-show', () => win.show());
  win.loadURL(`http://127.0.0.1:${PORT}`);
}

// The chrome-to-host interface: the few things only an application can do.
// Stub these as no-ops in dev mode so the browser path keeps working.
ipcMain.handle('alexandria:reveal-worlds', () => shell.openPath(WORLDS_DIR));
ipcMain.handle('alexandria:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize());
ipcMain.handle('alexandria:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close());
ipcMain.handle('alexandria:worlds-dir', () => WORLDS_DIR);

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
