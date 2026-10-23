// Vision capture harness: headless Chromium + CDP against a tsps dev client.
// Screenshots (Page.captureScreenshot) and short clips (Page.startScreencast,
// assembled with ffmpeg when available). Drives the client through its own
// handles: ?username=&password= auto-login, window.__osrsClient for the camera.
//
// Run: node client/tests/vision-capture.browser.cjs [--url <client URL>]
//   --user visionbot --pass vision1234 --out shot.png [--yaw 1024 --pitch 300]
//   [--clip-secs 5 --clip-fps 10 --clip-out clip.mp4]
//   [--animation-smoothing on|off] [--check-animation-smoothing 1]
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
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text || JSON.stringify(r.result.exceptionDetails));
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
