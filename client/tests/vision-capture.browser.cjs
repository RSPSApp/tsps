// Vision capture harness: headless Chromium + CDP against a tsps dev client.
// Screenshots (Page.captureScreenshot) and short clips (Page.startScreencast,
// assembled with ffmpeg when available). Drives the client through its own
// handles: ?username=&password= auto-login, window.__osrsClient for the camera.
//
// Run: node client/tests/vision-capture.browser.cjs [--url <client URL>]
//   --user visionbot --pass vision1234 --out shot.png [--yaw 1024 --pitch 300]
//   [--clip-secs 5 --clip-fps 10 --clip-out clip.mp4]
//   [--animation-smoothing on|off] [--check-animation-smoothing 1]
//   [--check-mobile-keyboard 1] (use --url with ?mobile=1)
//   [--check-mobile-combat-hud 1] (mobile client in Wilderness; checks rotation and captures each layout)
//   [--check-responsive-gameframe 1] (desktop login, narrow/portrait/desktop switches without reloading)
//   [--check-responsive-mobile-start 1] (phone-emulated login, disable emulation, then repeat resize switches)
// VISION_CHROME_FLAGS is an optional JSON array for software rendering in CI.
// --url defaults to this worktree's client (PORT in the root .env, see
// docs/worktrees.md), then http://localhost:3000; VISION_CLIENT_URL overrides.
//
// Notes:
// - Plain `--headless=new` with NO webgpu/swiftshader flags: on modern Chromium
//   extra flags (notably --enable-unsafe-webgpu) actively disable the adapter.
//   Verified with hardware D3D11 on Windows; SwiftShader remains the fallback.
// - Screenshots are file paths by design (MCP tools return text); the agent
//   reads the PNGs back with its file tools for inspection.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const Ws = require("../node_modules/ws");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

// Ordered browser candidates: explicit path first, then Chrome before Edge on
// each platform (both Chromium; either works). The harness probes each for a
// WebGPU adapter and uses the first that has one — a present binary without
// WebGPU (seen on some installs) is skipped, never fatal.
function findBrowsers() {
  if (process.env.VISION_CHROME_PATH && fs.existsSync(process.env.VISION_CHROME_PATH)) {
    return [process.env.VISION_CHROME_PATH];
  }
  return [
    // Windows.
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    // macOS.
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    // Linux.
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge",
  ].filter((p) => { try { return fs.existsSync(p); } catch { return false; } });
}

// Default client URL: explicit --url, then VISION_CLIENT_URL, then this
// worktree's own client port (scripts/wt writes PORT into root .env),
// falling back to the main checkout default (docs/worktrees.md).
function defaultUrl() {
  if (process.env.VISION_CLIENT_URL) return process.env.VISION_CLIENT_URL;
  try {
    const root = path.resolve(__dirname, "..", "..");
    const env = fs.readFileSync(path.join(root, ".env"), "utf8");
    const match = env.match(/^PORT=(\d+)\s*$/m);
    if (match) return `http://localhost:${match[1]}`;
  } catch {}
  return "http://localhost:3000";
}

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

// Kill only browsers this harness launched, identified by their unique
// --user-data-dir (mkdtemp temp profile, prefix vision-cap-). Never touches
// other Chrome/Edge processes: the user's own windows keep running, even if
// they spawn tabs mid-capture. (A blanket PID-diff kill used to catch them.)
const PROFILE_MARKER = "vision-cap-";

function killOurBrowserProcesses() {
  if (process.platform !== "win32") return;
  try {
    const { execFileSync } = require("node:child_process");
    const out = execFileSync("powershell", ["-NoProfile", "-Command",
      `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${PROFILE_MARKER}*' } | ForEach-Object { $_.ProcessId }`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15000 });
    for (const line of out.split(/\r?\n/)) {
      const pid = line.trim();
      if (/^\d+$/.test(pid)) {
        try { execFileSync("taskkill", ["/PID", pid, "/T", "/F"], { stdio: "ignore", timeout: 10000 }); } catch {}
      }
    }
  } catch {}
}

function killBrowser(proc) {
  if (proc && proc.pid != null) {
    try {
      if (process.platform === "win32") {
        require("node:child_process").execFileSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"],
          { stdio: "ignore", timeout: 15000 });
      } else {
        try { process.kill(-proc.pid, "SIGKILL"); } catch { try { proc.kill("SIGKILL"); } catch {} }
      }
    } catch {
      try { proc.kill(); } catch {}
    }
  }
  // Sweep any of ours that outlived the tree kill (re-parented children).
  killOurBrowserProcesses();
}

function createCdp(url) {
  const ws = new Ws(url, { maxPayload: 512 * 1024 * 1024 });
  let id = 0;
  const pending = new Map();
  const graphicsErrors = new Set();
  ws.on("message", (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (msg.id != null && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      p(msg);
    } else if (msg.method === "Page.screencastFrame" && ws.onScreencastFrame) {
      ws.onScreencastFrame(msg.params);
    } else if (msg.method === "Runtime.consoleAPICalled" || msg.method === "Log.entryAdded") {
      const message = msg.params.entry?.text ?? msg.params.args?.map(a => a.value ?? a.description ?? "").join(" ") ?? "";
      if (/validation error|invalid.*pipeline|shader.*error|error.*shader|GPUValidationError|Error while parsing WGSL|device lost|context lost/i.test(message)) graphicsErrors.add(message);
    }
  });
  return {
    ws,
    graphicsErrors,
    opened: new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); }),
    close() { try { ws.close(); } catch {} },
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const myId = ++id;
        pending.set(myId, resolve);
        ws.send(JSON.stringify({ id: myId, method, params }), (err) => {
          if (err) { pending.delete(myId); reject(err); }
        });
        setTimeout(() => {
          if (pending.has(myId)) { pending.delete(myId); reject(new Error(`cdp timeout: ${method}`)); }
        }, 60000);
      });
    },
    async evaluate(expression) {
      // CDP wraps the value twice: { result: { result: { value } } }.
      const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text || JSON.stringify(r.result.exceptionDetails));
      if (r.error) throw new Error(r.error.message || JSON.stringify(r.error));
      return r.result?.result?.value;
    },
  };
}

const CLIENT_JS = `(() => window.osrsClient ?? window.__WEBGPU_RENDERER__?.osrsClient ?? window.__osrsClient ?? null)()`;
// The client holds no plugin references; find one by its descriptor name.
const SMOOTHING_JS = `((pm) => pm.getPlugins().find((p) => pm.getDescriptor(p).name === "Animation Smoothing"))(${CLIENT_JS}.runeLite.pluginManager)`;

// Boots one candidate headless, navigates it to the target URL and probes for
// WebGPU there: navigator.gpu is a secure-context API, so it must be checked
// on the game page (localhost is trustworthy) — on about:blank (opaque
// origin) it is hidden and every browser looks "WebGPU-less".
// Returns { ok, proc, cdp, adapter } on success; cleans up and returns
// { ok: false, reason } otherwise. Adapter label distinguishes hardware from
// SwiftShader.
async function tryBrowser(bin, viewport, budgetMs, targetHref) {
  const debugPort = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "vision-cap-"));
  const proc = spawn(bin, [
    "--headless=new", "--no-first-run", "--no-default-browser-check",
    "--mute-audio", "--hide-scrollbars",
    ...JSON.parse(process.env.VISION_CHROME_FLAGS || "[]"),
    `--window-size=${viewport[0] | 0},${viewport[1] | 0}`,
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ], { stdio: process.env.VISION_DEBUG ? ["ignore", "ignore", "inherit"] : "ignore", detached: true });
  proc.unref();
  let cdp = null;
  const cleanup = () => {
    try { cdp?.close?.(); } catch {}
    killBrowser(proc);
  };
  try {
    const tab = await waitForTab(debugPort, Math.min(Math.max(15000, budgetMs), 30000));
    cdp = createCdp(tab.webSocketDebuggerUrl);
    await cdp.opened;
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Log.enable");
    if (arg("check-responsive-mobile-start", "0") === "1") {
      cdp.desktopUserAgent = await cdp.evaluate("navigator.userAgent");
      await cdp.send("Emulation.setUserAgentOverride", {
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      });
      await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
    }
    await cdp.send("Page.navigate", { url: targetHref });
    // Probe on the secure page; poll briefly in case the document is mid-load.
    let webgpu = false;
    let attempts = 0;
    const gpuEnd = Date.now() + 30000;
    while (!webgpu && Date.now() < gpuEnd) {
      attempts++;
      try {
        webgpu = await cdp.evaluate(`!!navigator.gpu`);
      } catch (e) {
        webgpu = false;
        if (process.env.VISION_DEBUG) console.log(`[vision] gpu poll #${attempts} threw: ${String(e?.message ?? e).slice(0, 120)}`);
      }
      if (process.env.VISION_DEBUG) console.log(`[vision] gpu poll #${attempts}: ${webgpu}`);
      if (!webgpu) await sleep(1000);
    }
    if (!webgpu) {
      cleanup();
      cdp = null;
      return { ok: false, reason: "no WebGPU adapter on the game page" };
    }
    let adapter = "adapter";
    try {
      adapter = await cdp.evaluate(`(async () => { try {
        const a = await navigator.gpu.requestAdapter();
        if (!a) return "none";
        const i = a.info || {};
        return ("adapter " + (i.vendor || "") + " " + (i.device || a.backend || "")).trim();
      } catch (e) { return "error"; } })()`);
    } catch {}
    return { ok: true, proc, cdp, adapter };
  } catch (error) {
    cleanup();
    cdp = null;
    return { ok: false, reason: String(error?.message ?? error).slice(0, 120) };
  }
}

async function main() {
  const started = Date.now();
  const summary = { ok: false };
  const out = arg("out", null);
  const clipSecs = Number(arg("clip-secs", "0")) || 0;
  const timeoutMs = Number(arg("timeout-ms", "120000"));
  const deadline = Date.now() + timeoutMs;
  const viewport = (arg("viewport", "1280x800") || "1280x800").split("x").map(Number);
  let proc = null;
  try {
    const target = new URL(arg("url", defaultUrl()));
    if (arg("user", null)) {
      target.searchParams.set("username", arg("user"));
      target.searchParams.set("password", arg("pass", ""));
    }
    if (arg("renderer", "webgpu") !== "none") target.searchParams.set("renderer", arg("renderer", "webgpu"));
    summary.url = target.href.replace(/password=[^&]*/, "password=***");

    const candidates = findBrowsers();
    if (candidates.length === 0) throw new Error("no Chromium found (set VISION_CHROME_PATH)");
    // Reap stale harness browsers from earlier (crashed) runs before probing.
    killOurBrowserProcesses();
    const tried = [];
    let cdp = null;
    for (const bin of candidates) {
      if (Date.now() > deadline) throw new Error("deadline passed before a browser was ready");
      const attempt = await tryBrowser(bin, viewport, Math.min(deadline - Date.now(), 45000), target.href);
      tried.push(`${bin} (${attempt.ok ? attempt.adapter : attempt.reason})`);
      if (!attempt.ok) {
        // Let the failed candidate's GPU process fully tear down before the
        // next launch contends for the adapter.
        await sleep(2500);
        continue;
      }
      proc = attempt.proc;
      cdp = attempt.cdp;
      summary.browser = bin;
      summary.webgpu = attempt.adapter;
      break;
    }
    if (!cdp) throw new Error(`no WebGPU-capable Chromium found. Tried: ${tried.join("; ")}`);
    summary.browserTried = tried;
    // (tryBrowser already enabled Page events and navigated to the target URL.)

    // Wait for frames, then for a logged-in world (or time out with a login-screen shot).
    // Field paths mirror webgpu-smoke's rendererState: stats.frameCount,
    // mapManager.visibleMaps.length, osrsClient.isLoggedIn().
    const needLogin = !!arg("user", null);
    const state = await waitFor(cdp, deadline, async () => {
      try {
        return await cdp.evaluate(`(() => {
          const c = ${CLIENT_JS};
          const r = window.__WEBGPU_RENDERER__ ?? (c && c.renderer) ?? null;
          if (!r) return { present: false };
          return {
            present: true,
            running: r.running === true,
            frames: Number(r.stats && r.stats.frameCount) || 0,
            loggedIn: !!(c && c.isLoggedIn && c.isLoggedIn()),
            // GameState.LOGGED_IN (30): LOADING_GAME (25) still shows the
            // "Loading - please wait." overlay with a black viewport.
            gameState: c && typeof c.gameState === "number" ? c.gameState : -1,
            maps: (r.mapManager && r.mapManager.visibleMaps) ? r.mapManager.visibleMaps.length : 0,
          };
        })()`);
      } catch { return { present: false }; }
    }, (s) => s && s.present && (s.frames > 0) && (!needLogin || (s.loggedIn && s.maps > 0 && s.gameState === 30)));
    summary.client = state;
    await dismissWelcome(cdp);
    const smoothing = arg("animation-smoothing", null);
    if (smoothing !== null) {
      await cdp.evaluate(`(async () => {
        const c = ${CLIENT_JS};
        await c.runeLite.pluginManager.setPluginEnabled(${SMOOTHING_JS}, ${smoothing === "on"});
      })()`);
    }


    const yaw = arg("yaw", null), pitch = arg("pitch", null);
    if (yaw !== null || pitch !== null) {
      summary.camera = await cdp.evaluate(`(() => {
        const c = ${CLIENT_JS};
        if (!c || !c.camera) return "no-camera";
        ${yaw !== null ? `c.camera.snapToYaw(${Number(yaw) | 0});` : ""}
        ${pitch !== null ? `c.camera.snapToPitch(${Number(pitch) | 0});` : ""}
        return { yaw: c.camera.yaw | 0, pitch: c.camera.pitch | 0 };
      })()`);
      await sleep(Number(arg("settle-ms", "1500")));
    } else {
      await sleep(Number(arg("settle-ms", "2500")));
    }

    if (arg("check-mobile-keyboard", "0") === "1") {
      await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });
      const point = await cdp.evaluate(`(() => {
        const c = ${CLIENT_JS}, canvas = c.renderer.canvas;
        // Cache rev 241: toplevel_osm:48 runs the chat keyboard toggle (script 2251).
        const button = c.widgetManager.getWidgetByUid((601 << 16) | 48);
        if (!button || c.widgetManager.isEffectivelyHidden(button.uid)) throw new Error("mobile keyboard button is not visible");
        const rect = canvas.getBoundingClientRect();
        return {
          x: rect.left + (button._absX + button.width * button._absScaleX / 2) * rect.width / canvas.width,
          y: rect.top + (button._absY + button.height * button._absScaleY / 2) * rect.height / canvas.height,
        };
      })()`);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await sleep(500);
      summary.mobileKeyboard = await cdp.evaluate(`(async () => {
        const c = ${CLIENT_JS}, keyboard = c.mobileChatKeyboard, canvas = c.renderer.canvas;
        const check = (condition, message) => { if (!condition) throw new Error(message); };
        try {
          const input = document.querySelector("input[data-mobile-chat-input]");
          check(input && document.activeElement === input, "the first keyboard tap did not retain mobile chat focus");
          check(c.varManager.getVarcInt(1226) === 1, "the chat script did not keep its keyboard toggle open");
          c.closeMenu();
          check(document.activeElement === input, "menu cleanup dismissed the mobile chat input");
          // The tap focuses first; the clientscript supplies the hint in a later frame.
          await new Promise(requestAnimationFrame);
          keyboard.show("Type a message", 0);
          c.resetMenu();
          check(document.activeElement === input, "menu reset dismissed the mobile chat input");
          await new Promise(resolve => setTimeout(resolve, 500));
          check(document.activeElement === input, "the frame loop dismissed the mobile chat input");
          keyboard.hide();
          check(document.activeElement !== input && !keyboard.isOpen, "explicit hide did not dismiss chat");
          c.closeMenu();
          check(document.activeElement === canvas, "closing a menu did not restore normal canvas focus");
          keyboard.show();
          c.closeMenu();
          check(document.activeElement === input, "reopened chat lost focus");
          return { tap: true, menuClose: true, menuReset: true, laterFrames: true, hide: true, reopen: true };
        } finally {
          keyboard.hide();
        }
      })()`);
    }

    if (arg("check-responsive-gameframe", "0") === "1" || arg("check-responsive-mobile-start", "0") === "1") {
      const mobileStart = arg("check-responsive-mobile-start", "0") === "1";
      const initialRoot = await cdp.evaluate(`(${CLIENT_JS}).widgetManager.rootInterface`);
      const desktopRoot = mobileStart ? 161 : initialRoot;
      if (mobileStart ? initialRoot !== 601 : ![161, 164, 548].includes(initialRoot)) throw new Error("responsive check started on the wrong layout");
      await cdp.evaluate(`(async () => {
        const c = ${CLIENT_JS}, pm = c.runeLite.pluginManager;
        await pm.setPluginEnabled(pm.getPlugins().find(p => pm.getDescriptor(p).name === "Portrait Mode"), true);
        c.widgetManager.setWidgetFlagsByKey((12 << 16) | 13, 0, 0x7fe);
      })()`);
      const nativeChat = () => cdp.evaluate(`(() => {
        const m = (${CLIENT_JS}).widgetManager;
        const bar = m.getWidgetByUid((162 << 16) | 1), messages = m.getWidgetByUid((162 << 16) | 34);
        return { barYMode: bar.yPositionMode, barY: bar._absY, messagesY: messages._absY };
      })()`);
      if (mobileStart) {
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: true });
        await sleep(600);
        const phoneRoot = await cdp.evaluate(`(${CLIENT_JS}).widgetManager.rootInterface`);
        if (phoneRoot !== 601) throw new Error("phone emulation should still use the mobile layout at a larger size");
        await cdp.send("Emulation.setUserAgentOverride", { userAgent: cdp.desktopUserAgent });
        await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
        await cdp.send("Emulation.clearDeviceMetricsOverride");
        const root = await waitFor(cdp, deadline, () => cdp.evaluate(`(${CLIENT_JS}).widgetManager.rootInterface`), value => value === desktopRoot);
        if (root !== desktopRoot) throw new Error("disabling device emulation did not restore the desktop UI without reloading");
        await sleep(600);
        const chat = await nativeChat();
        if (chat.barYMode !== 2 || chat.barY <= chat.messagesY) throw new Error("desktop frame retained the mobile chatbox arrangement: " + JSON.stringify(chat));
        summary.mobileStart = { initialRoot, phoneRootAtDesktopSize: phoneRoot, desktopAfterDisablingEmulation: root, chat };
      }
      summary.responsiveGameframe = [];
      for (const [width, height, root] of [[667, 375, 601], [375, 812, 601], [1280, 800, desktopRoot]]) {
        await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
        const layout = await waitFor(cdp, deadline, () => cdp.evaluate(`(() => {
          const c = ${CLIENT_JS}, m = c.widgetManager;
          return { root: m.rootInterface, orbs: m.getContainerUidForGroup(${root === 601 ? 897 : 160}),
            inventory: m.getContainerUidForGroup(149), flags: m.getServerSetFlags({ id: (12 << 16) | 13, childIndex: 0 }) };
        })()`), value => value.root === root && value.orbs !== undefined && value.inventory !== undefined);
        if (layout.root !== root || layout.orbs === undefined || layout.inventory === undefined) throw new Error("responsive layout did not switch: " + JSON.stringify(layout));
        if (layout.flags !== 0x7fe) throw new Error("layout switch lost mounted interface flags");
        await sleep(600);
        const chat = await nativeChat();
        if (chat.barYMode !== (root === 601 ? 0 : 2)) throw new Error("chatbox did not follow the active gameframe: " + JSON.stringify({ root, chat }));
        summary.responsiveGameframe.push({ width, height, ...layout, chat });
        if (out) {
          const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
          const file = out.replace(/\.png$/, "") + "-" + width + "x" + height + ".png";
          fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
          fs.writeFileSync(file, Buffer.from(shot.result.data, "base64"));
        }
      }
      // A resize can cross back before the server acknowledges the first request.
      for (const width of [667, 1280, 667, 1280]) {
        await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: false });
      }
      await sleep(750);
      const root = await waitFor(cdp, deadline, () => cdp.evaluate(`(${CLIENT_JS}).widgetManager.rootInterface`), value => value === desktopRoot);
      if (root !== desktopRoot) throw new Error("rapid resize left the wrong gameframe active");
    }

    if (arg("check-mobile-combat-hud", "0") === "1") {
      summary.timerPluginSwitch = await cdp.evaluate(`(async () => {
        const c = ${CLIENT_JS}, pm = c.runeLite.pluginManager;
        await pm.setPluginEnabled(pm.getPlugins().find(p => pm.getDescriptor(p).name === "Portrait Mode"), true);
        const timers = pm.getPlugins().filter(p => pm.getDescriptor(p).name === "Timers");
        if (timers.length !== 1 || pm.getPlugins().some(p => /^(Attack|Vengeance|Poison|Freeze|Antifire|Teleblock|Stamina) Timer$/.test(pm.getDescriptor(p).name))) throw new Error("all timers must share one plugin");
        const plugin = timers[0];
        const boosts = pm.getPlugins().find(p => pm.getDescriptor(p).name === "Boosts Information");
        await pm.setPluginEnabled(boosts, true);
        if (new URLSearchParams(location.search).has("timers")) {
          if (JSON.parse(boosts.infoBoxOverlay.signature()).length !== 24) throw new Error("?timers must preview all 22 boostable skills and both restore timers");
          await pm.setPluginEnabled(boosts, false);
          if (boosts.infoBoxOverlay.signature() !== "" || boosts.panelOverlay.signature() !== "" || boosts.compactOverlay.signature() !== "") throw new Error("disabled Boosts must stay hidden with ?timers");
          await pm.setPluginEnabled(boosts, true);
        } else {
          for (let skill = 0; skill < 24; skill++) boosts.onStatChanged({getSkill: () => skill, getLevel: () => 99, getBoostedLevel: () => 99});
          boosts.onStatChanged({getSkill: () => 1, getLevel: () => 99, getBoostedLevel: () => 98});
        }
        if (new URLSearchParams(location.search).has("timers")) {
          const count = () => document.querySelectorAll(".status-timer-infobox, .vengeance-timer-infobox").length;
          const attackCount = () => {
            const output = [];
            plugin.appendLocalPlayerOverheads({ osrsClient: { playerEcs: {
              getWorldViewId: () => -1, getX: () => 128, getY: () => 128, getLevel: () => 0,
            } }, acquireOverheadTextEntry: () => ({}), makeActorGroupKey: () => 1, mapOverheadColor: () => 0xffff00,
              resolvePlayerLogicalHeightTiles: () => 2 }, 0, output, 10, 2);
            return output.length;
          };
          await pm.setPluginEnabled(plugin, false);
          await new Promise(resolve => setTimeout(resolve, 300));
          if (count() !== 0 || attackCount() !== 0) throw new Error("disabled Timers must hide everything even with ?timers");
          if (c.runeLite.configManager.getConfiguration("runelite", "timersplugin") !== "false") throw new Error("timer switch was not saved");
          await pm.setPluginEnabled(plugin, true);
          await new Promise(resolve => setTimeout(resolve, 500));
          if (count() !== 6 || attackCount() !== 1) throw new Error("enabled Timers must preview all six infoboxes and attack overhead");
          return { disabledInfoboxes: 0, disabledAttack: 0, enabledInfoboxes: 6, enabledAttack: 1 };
        }
        await pm.setPluginEnabled(plugin, true);
        return { enabled: true };
      })()`);
      summary.mobileCombatHud = [];
      for (const [width, height, dpr] of [[667, 375, 2], [1320, 1340, 1], [1300, 1340, 1], [1300, 864, 1], [1200, 864, 1], [1100, 864, 1], [1000, 864, 1], [900, 864, 1], [864, 864, 1], [800, 864, 1], [375, 812, 2], [1920, 1080, 1], [667, 375, 2]]) {
        await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: true });
        await cdp.evaluate(`(() => {
          const c = ${CLIENT_JS};
          if (!new URLSearchParams(location.search).has("timers")) { c.varManager.setVarp(7996, 300); c.varManager.setVarp(7997, 1); }
        })()`);
        await sleep(1000);
        const sidebar = await cdp.evaluate(`(async () => {
          const c = ${CLIENT_JS}, portrait = matchMedia("(orientation: portrait)").matches;
          const canvas = () => c.renderer.canvas.getBoundingClientRect();
          const rail = () => document.querySelector(".rl-sidebar-rail").getBoundingClientRect();
          const buttons = [...document.querySelectorAll(".rl-sidebar-rail-button")];
          {
            const panel = c.widgetManager.getWidgetByUid((601 << 16) | 111);
            const buffer = c.renderer.canvas;
            if (panel._absX < 0 || panel._absX + panel._absWidth > buffer.width + 1 || panel._absY + panel._absHeight > buffer.height + 1) throw new Error("mobile inventory clips outside the canvas: " + JSON.stringify({ width: innerWidth, height: innerHeight, canvas: {width: buffer.width, height: buffer.height}, panel: {x: panel._absX, y: panel._absY, w: panel._absWidth, h: panel._absHeight},
              logical: {width: c.widgetManager.canvasWidth, height: c.widgetManager.canvasHeight},
              parents: [19,20].map(id => { const w = c.widgetManager.getWidgetByUid((601 << 16) | id); return {id, x: w.x, width: w.width, rawWidth: w.rawWidth, scrollWidth: w.scrollWidth};}) }));
            for (const id of [50, 111]) {
              const w = c.widgetManager.getWidgetByUid((601 << 16) | id);
              const gap = buffer.height - w._absY - w._absHeight;
              const edge = 2 * buffer.height / c.widgetManager.canvasHeight;
              if (gap < 0 || gap > edge + 1) throw new Error("mobile inventory and tab buttons must stay bottom-aligned: " + JSON.stringify({width: innerWidth, height: innerHeight, id, gap, edge}));
            }
          }
          if (portrait) {
            if (Math.abs(rail().top - canvas().bottom) > 1 || Math.abs(rail().right - canvas().right) > 1) throw new Error("portrait bar must sit below the full-width game");
            if (Math.abs(buttons[buttons.length - 1].getBoundingClientRect().right - rail().right) > 1) throw new Error("portrait buttons must be right-aligned");
            const handedness = document.querySelector(".portrait-handedness-toggle").getBoundingClientRect();
            const inset = parseFloat(getComputedStyle(document.querySelector(".rl-sidebar-rail")).paddingLeft) || 0;
            if (Math.abs(handedness.left - rail().left - inset) > 1) throw new Error("handedness toggle must sit at the far left of the portrait toolbar");
          } else {
            if (Math.abs(rail().left - canvas().right) > 1) throw new Error("landscape bar must return to the right edge");
            if (getComputedStyle(document.querySelector(".portrait-handedness-toggle")).display !== "none") throw new Error("handedness toggle must only show in portrait");
          }
          if (!portrait && innerWidth === 1100 && innerHeight === 864) {
            const pm = c.runeLite.pluginManager, m = c.widgetManager;
            const p = pm.getPlugins().find(p => pm.getDescriptor(p).name === "Portrait Mode");
            const panel = m.getWidgetByUid((601 << 16) | 111), bottomY = panel.y;
            await pm.setPluginEnabled(p, false);
            await new Promise(resolve => setTimeout(resolve, 250));
            if (panel.y === bottomY) throw new Error("disabling Portrait Mode must restore native panel positioning immediately");
            await pm.setPluginEnabled(p, true);
            await new Promise(resolve => setTimeout(resolve, 250));
            if (panel.y !== bottomY) throw new Error("re-enabling Portrait Mode must restore bottom alignment immediately");
          }
          if (portrait) {
            const pm = c.runeLite.pluginManager;
            const plugin = pm.getPlugins().find(p => pm.getDescriptor(p).name === "Portrait Mode");
            await pm.setPluginEnabled(plugin, false);
            await new Promise(resolve => setTimeout(resolve, 200));
            if (rail().width > 40 || Math.abs(rail().left - canvas().right) > 1) throw new Error("disabling portrait must restore the side rail immediately");
            await pm.setPluginEnabled(plugin, true);
            await new Promise(resolve => setTimeout(resolve, 200));
            if (Math.abs(rail().top - canvas().bottom) > 1) throw new Error("re-enabling portrait must restore the bottom rail immediately");
          }
          const width = canvas().width;
          document.querySelector('.rl-sidebar-rail-button[aria-label="Configuration"]').click();
          await new Promise(resolve => setTimeout(resolve, 200));
          const drawer = document.querySelector(".rl-sidebar-panel").getBoundingClientRect();
          if (portrait && (Math.abs(drawer.right - rail().right) > 1 || Math.abs(drawer.bottom - rail().top) > 1 || Math.abs(drawer.top) > 1)) throw new Error("portrait drawer must open from the right above the bar: " + JSON.stringify(drawer));
          if (canvas().width !== width) throw new Error("opening the mobile drawer must not resize the canvas");
          const result = { portrait, rail: { x: rail().x, y: rail().y, width: rail().width, height: rail().height }, drawer: { x: drawer.x, y: drawer.y, width: drawer.width, height: drawer.height } };
          return result;
        })()`);
        if (out && sidebar.portrait) {
          const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
          const file = out.replace(/\.png$/, "") + "-drawer.png";
          fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
          fs.writeFileSync(file, Buffer.from(shot.result.data, "base64"));
        }
        await cdp.evaluate(`(${CLIENT_JS}).sidebar.select(null)`);
        await sleep(100);
        if (sidebar.portrait) {
          const handedness = () => cdp.evaluate(`(() => {
            const c = ${CLIENT_JS}, m = c.widgetManager, button = document.querySelector(".portrait-handedness-toggle");
            const rect = button.getBoundingClientRect();
            return { left: button.getAttribute("aria-pressed") === "true", visible: rect.width > 0,
              x: rect.x + rect.width / 2, y: rect.y + rect.height / 2,
              mapX: m.getWidgetByUid((601 << 16) | 22)._absX,
              stonesX: m.getWidgetByUid((601 << 16) | 50)._absX,
              inventoryX: m.getWidgetByUid((601 << 16) | 111)._absX,
              stickX: document.querySelector(".touch-joystick")?.getBoundingClientRect().x,
              leftOpacity: button.querySelector('[data-hand="left"]').getAttribute("opacity"),
              rightOpacity: button.querySelector('[data-hand="right"]').getAttribute("opacity"),
              saved: c.runeLite.configManager.getConfiguration("portraitmode", "leftHanded") };
          })()`);
          const tapHandedness = async () => {
            const p = await handedness();
            await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: p.x, y: p.y }] });
            await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
            await sleep(300);
          };
          if ((await handedness()).left) await tapHandedness();
          const right = await handedness();
          if (!right.visible || right.leftOpacity !== "0.25" || right.rightOpacity !== "1" || right.mapX >= right.inventoryX) throw new Error("right-handed portrait state is wrong: " + JSON.stringify(right));
          await tapHandedness();
          const left = await handedness();
          if (!left.left || left.saved !== "true" || left.leftOpacity !== "1" || left.rightOpacity !== "0.25" || left.mapX <= left.inventoryX || left.stonesX <= left.inventoryX || (left.stickX !== undefined && left.stickX <= right.stickX)) throw new Error("portrait handedness did not swap immediately: " + JSON.stringify({right, left}));
          if (out) {
            const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
            fs.writeFileSync(out.replace(/\.png$/, "") + "-left-handed.png", Buffer.from(shot.result.data, "base64"));
          }
          const tabState = () => cdp.evaluate(`(() => {
            const c = ${CLIENT_JS}, m = c.widgetManager, canvas = c.renderer.canvas, rect = canvas.getBoundingClientRect();
            const w = id => m.getWidgetByUid((601 << 16) | id);
            const toggle = w(103), rows = w(50), top = w(87), bottom = w(61), arrow = w(110);
            return { height: rows.height, rawWidth: rows.rawWidth, top: top.y, bottom: bottom.y,
              angle: arrow.spriteAngle, sprite: arrow.spriteId, option: toggle.actions[0],
              x: rect.left + (toggle._absX + toggle._absWidth / 2) * rect.width / canvas.width,
              y: rect.top + (toggle._absY + toggle._absHeight / 2) * rect.height / canvas.height };
          })()`);
          const tapToggle = async () => {
            const p = await tabState();
            await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: p.x, y: p.y }] });
            await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
            await sleep(300);
          };
          if ((await tabState()).rawWidth === 58) await tapToggle();
          const expanded = await tabState();
          if (expanded.height !== 85 || expanded.angle !== 16384 || expanded.option !== "Show Less") throw new Error("portrait expanded toggle is wrong: " + JSON.stringify(expanded));
          await tapToggle();
          const folded = await tabState();
          if (folded.height !== 58 || folded.bottom >= folded.top + 40 || folded.angle !== 16384 || folded.option !== "Show More" || folded.sprite === expanded.sprite) throw new Error("portrait touch toggle did not fold the top row over the bottom: " + JSON.stringify({expanded, folded}));
          if (out) {
            const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
            fs.writeFileSync(out.replace(/\.png$/, "") + "-folded.png", Buffer.from(shot.result.data, "base64"));
          }
          await tapToggle();
          const restored = await tabState();
          if (restored.height !== 85 || restored.bottom <= folded.bottom || restored.sprite !== expanded.sprite) throw new Error("Show More did not restore the portrait rows");
          summary.portraitTabToggle = { expanded, folded, restored };
          await cdp.evaluate(`(async () => {
            const c = ${CLIENT_JS}, pm = c.runeLite.pluginManager;
            const p = pm.getPlugins().find(p => pm.getDescriptor(p).name === "Portrait Mode");
            await pm.setPluginEnabled(p, false);
            await pm.setPluginEnabled(p, true);
          })()`);
          await sleep(300);
          if (!(await handedness()).left) throw new Error("Portrait Mode must restore the saved handedness after re-enabling");
          await tapHandedness();
          const restoredHand = await handedness();
          if (restoredHand.left || restoredHand.mapX !== right.mapX || restoredHand.inventoryX !== right.inventoryX) throw new Error("right-handed portrait positions were not restored");
          summary.portraitHandedness = { right, left, restored: restoredHand };
        }
        if (out) {
          const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
          const file = out.replace(/\.png$/, "") + "-" + width + "x" + height + ".png";
          fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
          fs.writeFileSync(file, Buffer.from(shot.result.data, "base64"));
        }
        const geometry = await cdp.evaluate(`(() => {
          const c = ${CLIENT_JS}, canvas = c.renderer.canvas, rect = canvas.getBoundingClientRect();
          const widget = (group, child) => {
            const w = c.widgetManager.getWidgetByUid((group << 16) | child);
            return { x: rect.left + w._absX * rect.width / canvas.width, y: rect.top + w._absY * rect.height / canvas.height,
              width: w._absWidth * rect.width / canvas.width, height: w._absHeight * rect.height / canvas.height };
          };
          const pvp = widget(90, 44), chat = widget(601, 49), controls = widget(601, 41);
          const timer = document.querySelector(".poison-timer-infobox")?.getBoundingClientRect();
          if (!timer || !pvp.width) throw new Error("combat HUD is not visible");
          if (timer.left < pvp.x + pvp.width + 2) throw new Error("poison overlaps the Wilderness indicator: " + JSON.stringify({ pvp, timer,
            nodes: [0, 2, 43, 44].map(id => { const w = c.widgetManager.getWidgetByUid((90 << 16) | id); return { id, x: w.x, y: w.y, scrollX: w.scrollX, scrollY: w.scrollY, absX: w._absX, absY: w._absY }; }) }));
          if (pvp.y < Math.max(chat.y + chat.height, controls.y + controls.height)) throw new Error("Wilderness row overlaps chat: " + JSON.stringify({ pvp, chat, controls }));
          if (Math.abs(timer.top - pvp.y) > 2) throw new Error("native and plugin rows do not line up: " + JSON.stringify({ pvp, timer }));
          const previews = [...document.querySelectorAll(".status-timer-infobox, .vengeance-timer-infobox")]
            .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
          if (new URLSearchParams(location.search).has("timers")) {
            if (previews.length !== 6) throw new Error("enabled ?timers preview must show all six infoboxes");
            let right = pvp.x + pvp.width;
            for (const preview of previews) {
              const box = preview.getBoundingClientRect();
              if (box.left < right + 1 || box.right > rect.right) throw new Error("timer preview row overlaps or clips");
              right = box.right;
            }
            if (document.querySelector(".vengeance-timer-seconds").textContent !== "0") throw new Error("inactive preview must show zero seconds");
          }
          const boosts = c.runeLite.overlayRenderer.drawn.find(p => p.overlay.movable?.name === "BoostsInfoBoxOverlay")?.bounds;
          if (!boosts) throw new Error("Boosts overlay is missing");
          const boost = { x: rect.left + boosts.x * rect.width / canvas.width, y: rect.top + boosts.y * rect.height / canvas.height,
            width: boosts.w * rect.width / canvas.width, height: boosts.h * rect.height / canvas.height };
          if (boost.x < rect.left - 1 || boost.x + boost.width > rect.right + 1) throw new Error("Boosts clip outside the resized canvas: " + JSON.stringify(boost));
          if (boost.y < Math.max(pvp.y + pvp.height, timer.bottom) + 2) throw new Error("Boosts must always sit below the Wilderness and timer row: " + JSON.stringify({ boost, pvp, timer }));
          const stick = document.querySelector(".touch-joystick");
          const stickSize = stick ? parseFloat(getComputedStyle(stick).width) : null;
          const scale = Math.max(1, rect.width / c.widgetManager.canvasWidth * 1.25);
          if (Math.abs(timer.width - 28 * scale) > 0.2) throw new Error("timers must follow native mobile gameframe growth");
          if (stickSize !== null && Math.abs(stickSize - (matchMedia("(orientation: portrait)").matches ? 50.4 : 72) * scale) > 0.2) throw new Error("joystick must keep its 40% reduction while following the gameframe scale");
          return { pvp, timer: { x: timer.x, y: timer.y, width: timer.width, height: timer.height }, chat, controls, timerCount: previews.length, boost, stickSize };
        })()`);
        summary.mobileCombatHud.push({ width, height, ...geometry, sidebar });
      }
    }

    if (arg("check-animation-smoothing", "0") === "1") {
      summary.animationSmoothing = await cdp.evaluate(`(async () => {
        const c = ${CLIENT_JS}, r = c.renderer;
        const pid = c.playerEcs.getIndexForServerId(c.controlledPlayerServerId);
        const poses = new Set(), durations = [];
        let last = performance.now();
        for (let i = 0; i < 120; i++) {
          await new Promise(requestAnimationFrame);
          const now = performance.now(); durations.push(now - last); last = now;
          const cache = r.actors?.playerPose?.poseCache ?? r.playerRenderer?.poseCache;
          if (cache) for (const [key, matrices] of cache) if (matrices && key.includes("~")) poses.add(key);
        }
        const cpu = r.actors?.playerPose?.resolve(pid, false);
        let fractionalVertices = 0;
        if (cpu) for (let i = 16; i < cpu.opaqueVertices.length; i += 20) {
          const v = new DataView(cpu.opaqueVertices.buffer, cpu.opaqueVertices.byteOffset + i, 4).getUint32(0, true);
          if (v) fractionalVertices++;
        }
        durations.sort((a,b) => a-b);
        return { backend: r.constructor.name, enabled: ${SMOOTHING_JS}.isEnabled(),
          poses: poses.size, fractionalVertices, glError: (r.gl ?? r.app?.gl)?.getError?.() ?? 0,
          medianFrameMs: durations[60], p95FrameMs: durations[114] };
      })()`);
      const check = summary.animationSmoothing;
      check.graphicsErrors = [...cdp.graphicsErrors].slice(0, 10);
      const enabled = smoothing !== "off";
      if (check?.enabled !== enabled || (enabled ? check.poses < 2 : check.poses !== 0) || check.glError !== 0 || check.graphicsErrors.length) throw new Error("animation smoothing render check failed: " + JSON.stringify(check));
      if (arg("renderer", "webgpu") === "webgpu" && check.backend !== "WebGPURenderer") throw new Error("WebGPU fell back to " + check.backend);
      if (check.backend === "WebGPURenderer") {
        // Read the submitted scene itself: some headless Vulkan compositors capture a black
        // canvas even when the GPU rendered correctly. Pose-cache activity alone is not proof.
        const scene = await cdp.evaluate(`(async () => {
          const r = ${CLIENT_JS}.renderer;
          const width = r.canvas.width, height = r.canvas.height;
          const bytesPerRow = Math.ceil(width * 4 / 256) * 256;
          const buffer = r.device.createBuffer({size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ});
          await new Promise((resolve, reject) => {
            const render = r.render;
            const timeout = setTimeout(() => { r.render = render; reject(new Error("scene readback timed out")); }, 10000);
            r.render = function(...args) {
              r.render = render;
              try {
                render.apply(r, args);
                const encoder = r.device.createCommandEncoder();
                encoder.copyTextureToBuffer({texture:r.context.getCurrentTexture()}, {buffer,bytesPerRow}, {width,height});
                r.device.queue.submit([encoder.finish()]);
                buffer.mapAsync(GPUMapMode.READ).then(resolve, reject).finally(() => clearTimeout(timeout));
              } catch (e) { clearTimeout(timeout); reject(e); }
            };
          });
          const bytes = new Uint8Array(buffer.getMappedRange());
          const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext("2d"), pixels = ctx.createImageData(width, height);
          const bgra = r.format.startsWith("bgra"), colours = new Set();
          for (let y=0; y<height; y++) for (let x=0; x<width; x++) {
            const src=y*bytesPerRow+x*4, dst=(y*width+x)*4;
            pixels.data[dst]=bytes[src+(bgra?2:0)]; pixels.data[dst+1]=bytes[src+1];
            pixels.data[dst+2]=bytes[src+(bgra?0:2)]; pixels.data[dst+3]=255;
            if(x%16===0 && y%16===0) colours.add((bytes[src]<<16)|(bytes[src+1]<<8)|bytes[src+2]);
          }
          buffer.unmap(); buffer.destroy(); ctx.putImageData(pixels,0,0);
          return {colours:colours.size,png:canvas.toDataURL("image/png").split(",")[1]};
        })()`);
        check.sceneColours = scene.colours;
        if (scene.colours < 16) throw new Error("WebGPU scene is blank: " + scene.colours + " colours");
        if (out) {
          const scenePath = path.resolve(out.replace(/\.png$/i, "") + "-scene.png");
          fs.mkdirSync(path.dirname(scenePath), { recursive: true });
          fs.writeFileSync(scenePath, Buffer.from(scene.png, "base64"));
          summary.sceneScreenshot = scenePath;
        }
      }
    }

    // Staging hold: print READY after login+camera so an external driver can
    // arrange the scene (MCP teleports etc.), then the shot fires.
    const holdSecs = Number(arg("hold-secs", "0")) || 0;
    if (holdSecs > 0) {
      console.log("VISION_READY " + JSON.stringify({ camera: summary.camera ?? null }));
      await sleep(Math.min(holdSecs, 300) * 1000);
    }

    if (out) {
      const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
      if (shot.error) throw new Error(shot.error.message || JSON.stringify(shot.error));
      const data = shot.result?.data;
      if (!data) throw new Error("captureScreenshot returned no pixels");
      fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
      fs.writeFileSync(out, Buffer.from(data, "base64"));
      summary.screenshot = path.resolve(out);
    }

    if (clipSecs > 0) {
      summary.clip = await recordClip(cdp, {
        secs: clipSecs,
        fps: Number(arg("clip-fps", "10")) || 10,
        out: arg("clip-out", null),
        framesDir: arg("frames-dir", null),
        viewport,
      });
    }
    // A world-wait timeout with --user means login/loads never finished (server
    // restarting, session torn down, ...): fail loudly instead of handing the
    // caller a loading-screen image as if it were gameplay.
    if (needLogin && !(state && state.loggedIn && state.gameState === 30)) {
      summary.error = "login did not complete within the wait window" +
        (summary.screenshot ? `; login-screen screenshot saved: ${summary.screenshot}` : "");
      summary.ok = false;
    } else {
      summary.ok = true;
    }
  } catch (error) {
    summary.error = String(error?.message ?? error);
  } finally {
    if (proc) killBrowser(proc);
  }
  summary.ms = Date.now() - started;
  console.log(JSON.stringify(summary));
  process.exit(summary.ok ? 0 : 1);
}

async function waitForTab(port, budgetMs) {
  const end = Date.now() + budgetMs;
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const tabs = await res.json();
      const page = tabs.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {}
    if (Date.now() > end) throw new Error("no devtools page tab");
    await sleep(500);
  }
}

async function waitFor(cdp, deadline, read, done) {
  let last = null;
  for (;;) {
    last = await read();
    if (done(last)) return last;
    if (Date.now() > deadline) return last;
    await sleep(750);
  }
}

async function dismissWelcome(cdp) {
  try {
    const closed = await cdp.evaluate(`(() => {
      const client = window.osrsClient;
      if (!client || !client.widgetManager || client.widgetManager.rootInterface !== 378) return "n/a";
      const widget = client.widgetManager.getWidgetByUid((378 << 16) | 72);
      if (!widget) return "missing-play";
      client.handleWidgetAction({ widget, option: "Play", opIndex: 1, source: "primary" });
      return "dismissed";
    })()`);
    return closed;
  } catch {
    return "error";
  }
}

async function recordClip(cdp, { secs, fps, out, framesDir, viewport }) {
  const frames = [];
  cdp.ws.onScreencastFrame = async (params) => {
    frames.push(Buffer.from(params.data, "base64"));
    try {
      await cdp.send("Page.screencastFrameAck", { sessionId: params.sessionId });
    } catch {}
  };
  const everyNth = Math.max(1, Math.round(30 / Math.max(1, fps)));
  await cdp.send("Page.startScreencast", {
    format: "jpeg", quality: 80,
    maxWidth: viewport[0] | 0, maxHeight: viewport[1] | 0,
    everyNthFrame: everyNth,
  });
  await sleep(Math.max(500, secs * 1000));
  try { await cdp.send("Page.stopScreencast"); } catch {}
  await sleep(500);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = framesDir || path.join(process.cwd(), `clip-frames-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });
  frames.forEach((b, i) => fs.writeFileSync(path.join(dir, `f${String(i).padStart(4, "0")}.jpg`), b));
  const result = { frames: frames.length, framesDir: path.resolve(dir) };
  if (out && frames.length > 0) {
    try {
      const { spawnSync } = require("node:child_process");
      fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
      // Measured capture rate keeps the clip realtime (requested fps only sets density).
      const measuredFps = Math.max(1, Math.round(frames.length / Math.max(1, secs)));
      result.measuredFps = measuredFps;
      // Encoder order: Intel Quick Sync, MediaFoundation, then baseline mpeg4.
      // (libx264 is present but fails to open on some Windows Store builds;
      // mpeg4-in-mp4 does not play in stock Windows players.)
      const attempts = [
        ["-c:v", "h264_qsv", "-pix_fmt", "nv12", "-b:v", "4M"],
        ["-c:v", "h264_mf", "-b:v", "4M"],
        ["-c:v", "mpeg4", "-q:v", "3", "-pix_fmt", "yuv420p"],
      ];
      for (const codecArgs of attempts) {
        const r = spawnSync("ffmpeg", ["-y", "-framerate", String(measuredFps),
          "-i", path.join(dir, "f%04d.jpg"), ...codecArgs, path.resolve(out)],
          { stdio: "ignore" });
        if (r.status === 0 && fs.existsSync(path.resolve(out))
          && fs.statSync(path.resolve(out)).size > 0) {
          result.video = path.resolve(out);
          result.videoCodec = codecArgs[1];
          break;
        }
        result.videoError = `ffmpeg ${codecArgs[1]} exit ${r.status}`;
      }
    } catch (e) {
      result.videoError = String(e?.message ?? e);
    }
  }
  return result;
}

main();
