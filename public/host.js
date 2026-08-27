// THE CHROME-TO-HOST SURFACE. A handful of things the chrome needs are things only an
// application can do: reveal the worlds folder in Finder, minimise and close a frameless
// window, ask the host where the worlds folder is. In Electron those are IPC calls, set up
// by `electron/preload.cjs`, which exposes them as `window.alexandria`. In a browser they
// cannot exist at all.
//
// So this module resolves the two into ONE named surface. Import `host` and call it; never
// read `window.alexandria` directly. The chrome then runs unchanged in both places, and the
// browser dev path fails loudly at this file rather than quietly at a scattered
// `if (window.alexandria)` guard. See `Alexandria - Packaging`, "The chrome-to-host interface".
//
// Adding a call means adding it in three places: the stub below, the preload, and a handler
// in the main process. That is deliberate — the cost of a new call should be visible, or the
// surface stops being small.

// Every call the surface carries. Anything not on this list is not available to the chrome,
// whichever host it is running under.
const CALLS = ['revealWorlds', 'worldsDir', 'minimize', 'close'];

// Things the host TELLS the chrome, rather than things the chrome asks for. Same
// three-places rule as the calls: the stub below, the preload, and a sender in the
// main process.
const EVENTS = ['onFullscreen'];

// Dev mode. Each call resolves rather than throwing, because a browser-mode chrome should
// degrade to doing nothing rather than break — the same rule as everywhere else. It warns
// once per call so a missing capability is visible to whoever is working on it, instead of
// looking like the feature is broken.
function browserStub() {
  const warned = new Set();
  const stub = { host: 'browser' };
  for (const name of CALLS) {
    stub[name] = async () => {
      if (!warned.has(name)) {
        warned.add(name);
        console.info(`[host] ${name}() is an application call and does nothing in the browser.`);
      }
      return null;
    };
  }
  // SUBSCRIPTIONS are not calls: the host pushes, the chrome listens. The browser has
  // no native window to go fullscreen, so this never fires — which is the correct
  // answer rather than a missing one, and is why it does not warn like the calls above.
  for (const name of EVENTS) stub[name] = () => {};
  return stub;
}

export const host = globalThis.window?.alexandria ?? browserStub();

// True when running inside the application. Use it to HIDE a control the browser cannot
// honour, rather than to branch on behaviour — a call that behaves differently per host is
// a call that has escaped this file.
export const isApp = host.host === 'electron';
