// Mobile-mode frame profiler: headless Chrome + CDP against a tsps client (dev server or a
// served production build). Emulates an Android phone (user agent, touch, DPR, viewport), logs
// the given account in, settles, then records idle / camera-drag windows with a sampled CPU
// profile, per-frame render CPU, frame pacing, and what drove the HUD redraws.
//
//   node tests/mobile-frame-profile.browser.cjs --user perfbot --pass secret --out /tmp/run.json
//
// Options (defaults): --url (this worktree's client, PORT from the root .env) --renderer webgpu
// --mobile 1 --cpu 1 (Chrome CPU throttling factor; 4 is a phone-like stress case) --dpr 3
// --viewport 844x390 --window-ms 8000 --settle-ms 10000 --modes idle,drag --shot <png>
// --diag 1 (count full/partial HUD redraws, dirty widgets, overlay signature changes, scripts).
// CPU throttling is a stress test, not an emulation of any phone's CPU or GPU; GPU time is not
// measured. Use an account of its own: a second login of the same name is refused.
const { spawn, execFileSync } = require("node:child_process");
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

const CHROME_CANDIDATES = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
].filter((p) => p && fs.existsSync(p));
const PROFILE_MARKER = "mobile-frame-profile-";
const ANDROID_UA =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";

function defaultUrl() {
    try {
        const env = fs.readFileSync(path.join(__dirname, "..", "..", ".env"), "utf8");
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

function killBrowser(proc) {
    if (process.platform === "win32") {
        try { execFileSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore", timeout: 15000 }); } catch {}
        try {
            const out = execFileSync("powershell", ["-NoProfile", "-Command",
                `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${PROFILE_MARKER}*' } | ForEach-Object { $_.ProcessId }`],
                { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15000 });
            for (const line of out.split(/\r?\n/)) {
                const pid = line.trim();
                if (/^\d+$/.test(pid)) { try { execFileSync("taskkill", ["/PID", pid, "/T", "/F"], { stdio: "ignore", timeout: 10000 }); } catch {} }
            }
        } catch {}
    } else {
        try { process.kill(-proc.pid, "SIGKILL"); } catch { try { proc.kill("SIGKILL"); } catch {} }
    }
}

function createCdp(url) {
    const ws = new Ws(url, { maxPayload: 1024 * 1024 * 1024 });
    let id = 0;
    const pending = new Map();
    const consoleLines = [];
    ws.on("message", (data) => {
        let msg;
        try { msg = JSON.parse(data.toString()); } catch { return; }
        if (msg.id != null && pending.has(msg.id)) {
            const p = pending.get(msg.id);
            pending.delete(msg.id);
            p(msg);
        } else if (msg.method === "Runtime.consoleAPICalled" || msg.method === "Log.entryAdded") {
            const text = msg.params.entry?.text ?? msg.params.args?.map((a) => a.value ?? a.description ?? "").join(" ") ?? "";
            consoleLines.push(text.slice(0, 300));
            if (consoleLines.length > 400) consoleLines.shift();
        }
    });
    return {
        ws, consoleLines,
        opened: new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); }),
        close() { try { ws.close(); } catch {} },
        send(method, params = {}, timeoutMs = 120000) {
            return new Promise((resolve, reject) => {
                const myId = ++id;
                pending.set(myId, resolve);
                ws.send(JSON.stringify({ id: myId, method, params }), (err) => { if (err) { pending.delete(myId); reject(err); } });
                setTimeout(() => { if (pending.has(myId)) { pending.delete(myId); reject(new Error(`cdp timeout: ${method}`)); } }, timeoutMs);
            });
        },
        async evaluate(expression) {
            const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
            if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text || JSON.stringify(r.result.exceptionDetails));
            if (r.error) throw new Error(r.error.message || JSON.stringify(r.error));
            return r.result?.result?.value;
        },
    };
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

const CLIENT_JS = `(() => window.osrsClient ?? window.__WEBGPU_RENDERER__?.osrsClient ?? window.__osrsClient ?? null)()`;

/** Self and inclusive time by function, file and category from a CDP sampling profile. */
function summarizeProfile(profile) {
    const nodes = new Map();
    for (const n of profile.nodes) nodes.set(n.id, n);
    const parent = new Map();
    for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
    const self = new Map();
    const incl = new Map();
    const byFile = new Map();
    const byCategory = new Map();
    const keyOf = (n) => {
        const cf = n.callFrame;
        const file = (cf.url || "").split("/").slice(-2).join("/");
        return `${cf.functionName || "(anonymous)"} @ ${file}:${cf.lineNumber + 1}`;
    };
    const fileOf = (n) => {
        const u = n.callFrame.url || "";
        if (!u) return n.callFrame.functionName === "(garbage collector)" ? "(gc)" : n.callFrame.functionName === "(program)" ? "(program)" : n.callFrame.functionName === "(idle)" ? "(idle)" : "(native/unknown)";
        return u.replace(/^.*\/(static\/js\/|src\/|client\/)/, "").replace(/\?.*$/, "");
    };
    const catOf = (file) => {
        if (file === "(idle)") return "idle";
        if (file === "(gc)") return "gc";
        if (file === "(program)") return "program";
        if (/node_modules\/react|react-dom|scheduler/.test(file)) return "react";
        if (/widgets\/|WidgetsOverlay|WidgetManager|cs2|clientscript|ClientScript/i.test(file)) return "widgets/cs2";
        if (/render\/webgpu/.test(file)) return "render-webgpu";
        if (/render\//.test(file)) return "render-other";
        if (/runelite/.test(file)) return "runelite";
        if (/game\//.test(file)) return "game";
        if (/network\//.test(file)) return "network";
        if (/rs\//.test(file)) return "rs-cache";
        if (/node_modules/.test(file)) return "node_modules-other";
        return "other";
    };
    let total = 0;
    const deltas = profile.timeDeltas;
    for (let i = 0; i < profile.samples.length; i++) {
        const dt = (deltas[i] ?? 0) / 1000;
        if (dt <= 0) continue;
        total += dt;
        const n = nodes.get(profile.samples[i]);
        if (!n) continue;
        const k = keyOf(n);
        self.set(k, (self.get(k) ?? 0) + dt);
        const f = fileOf(n);
        byFile.set(f, (byFile.get(f) ?? 0) + dt);
        const c = catOf(f);
        byCategory.set(c, (byCategory.get(c) ?? 0) + dt);
        const seen = new Set();
        let cur = n.id;
        while (cur != null) {
            const cn = nodes.get(cur);
            const ck = keyOf(cn);
            if (!seen.has(ck)) { seen.add(ck); incl.set(ck, (incl.get(ck) ?? 0) + dt); }
            cur = parent.get(cur);
        }
    }
    const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ name: k, ms: +v.toFixed(1), pct: +((100 * v) / total).toFixed(1) }));
    return { totalMs: +total.toFixed(1), categories: top(byCategory, 20), files: top(byFile, 30), selfTop: top(self, 45), inclusiveTop: top(incl, 60) };
}

async function main() {
    const url = new URL(arg("url", defaultUrl()));
    const user = arg("user", null);
    const pass = arg("pass", "");
    if (!user) throw new Error("--user <account> is required (an account no other client has logged in)");
    const renderer = arg("renderer", "webgpu");
    const mobile = arg("mobile", "1") === "1";
    const cpu = Number(arg("cpu", "1"));
    const dpr = Number(arg("dpr", "3"));
    const viewport = (arg("viewport", "844x390")).split("x").map(Number);
    const windowMs = Number(arg("window-ms", "8000"));
    const settleMs = Number(arg("settle-ms", "10000"));
    const modes = (arg("modes", "idle,drag")).split(",");
    const out = arg("out", null);
    const shot = arg("shot", null);
    const headless = arg("headless", "1") === "1";
    const diag = arg("diag", "1") === "1";
    if (CHROME_CANDIDATES.length === 0) throw new Error("no Chrome found (set CHROME_PATH)");

    if (!url.pathname || url.pathname === "/") url.pathname = "/play";
    url.searchParams.set("username", user);
    url.searchParams.set("password", pass);
    if (renderer !== "none") url.searchParams.set("renderer", renderer);
    if (mobile) url.searchParams.set("mobile", "1");

    const debugPort = await freePort();
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), PROFILE_MARKER));
    const proc = spawn(CHROME_CANDIDATES[0], [
        ...(headless ? ["--headless=new"] : []),
        "--no-first-run", "--no-default-browser-check", "--mute-audio", "--hide-scrollbars",
        `--window-size=${viewport[0] | 0},${viewport[1] | 0}`,
        `--remote-debugging-port=${debugPort}`,
        `--user-data-dir=${profileDir}`,
        "about:blank",
    ], { stdio: "ignore", detached: true });
    proc.unref();
    const summary = { settings: { url: url.href.replace(/password=[^&]*/, "password=***"), renderer, mobile, cpu, dpr, viewport, windowMs, modes } };
    let cdp;
    try {
        const tab = await waitForTab(debugPort, 30000);
        cdp = createCdp(tab.webSocketDebuggerUrl);
        await cdp.opened;
        await cdp.send("Page.enable");
        await cdp.send("Runtime.enable");
        await cdp.send("Log.enable");
        await cdp.send("Performance.enable");
        if (mobile) {
            await cdp.send("Emulation.setUserAgentOverride", {
                userAgent: ANDROID_UA, platform: "Linux armv8l",
                userAgentMetadata: { brands: [{ brand: "Chromium", version: "131" }, { brand: "Google Chrome", version: "131" }], fullVersion: "131.0.0.0", platform: "Android", platformVersion: "14", architecture: "", model: "Pixel 8", mobile: true },
            });
            await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
        }
        await cdp.send("Emulation.setDeviceMetricsOverride", {
            width: viewport[0] | 0, height: viewport[1] | 0, deviceScaleFactor: dpr, mobile,
            screenOrientation: { type: "landscapePrimary", angle: 90 },
        });
        await cdp.send("Page.navigate", { url: url.href });
        const deadline = Date.now() + 180000;
        let state = null;
        for (;;) {
            try {
                state = await cdp.evaluate(`(() => {
                    const c = ${CLIENT_JS};
                    const r = c && c.renderer;
                    if (!r) return { present: false };
                    return { present: true, running: r.running === true, frames: Number(r.stats && r.stats.frameCount) || 0,
                        loggedIn: !!(c.isLoggedIn && c.isLoggedIn()), gameState: typeof c.gameState === "number" ? c.gameState : -1,
                        maps: r.mapManager && r.mapManager.visibleMaps ? r.mapManager.visibleMaps.length : 0, type: r.type };
                })()`);
            } catch { state = { present: false }; }
            if (state && state.present && state.frames > 0 && state.loggedIn && state.maps > 0 && state.gameState === 30) break;
            if (Date.now() > deadline) throw new Error("login/scene did not become ready: " + JSON.stringify(state));
            await sleep(750);
        }
        summary.ready = state;
        await sleep(2000);
        // The Welcome Screen (378) and a fresh account's Character Creator (679) cover the scene.
        summary.welcome = await cdp.evaluate(`(() => {
            const client = ${CLIENT_JS};
            if (!client || !client.widgetManager || client.widgetManager.rootInterface !== 378) return "n/a";
            const widget = client.widgetManager.getWidgetByUid((378 << 16) | 72);
            if (!widget) return "missing-play";
            client.handleWidgetAction({ widget, option: "Play", opIndex: 1, source: "primary" });
            return "dismissed";
        })()`).catch((e) => "error " + e.message);
        summary.charCreator = await cdp.evaluate(`(() => {
            const client = ${CLIENT_JS}; const wm = client.widgetManager; const out = [];
            for (let i = 0; i < 400; i++) {
                const w = wm.getWidgetByUid((679 << 16) | i);
                if (w && typeof w.text === "string" && /^confirm$/i.test(w.text.trim())) { client.handleWidgetAction({ widget: w, option: "Confirm", opIndex: 1, source: "primary" }); out.push("confirm@" + i); }
            }
            return out.length ? out : "none";
        })()`).catch((e) => "error " + e.message);
        await sleep(settleMs);

        if (diag) {
            await cdp.evaluate(`(() => {
                const c = ${CLIENT_JS}; const wm = c.widgetManager; const d = window.__diag = { full: 0, partial: 0, anyRootDirtyTrue: 0, anyRootDirtyCalls: 0, precise: {}, preciseCalls: 0, preciseNonEmpty: 0, gameFrame: 0, overlaySigChanges: 0, overlayNames: {}, lastSig: null, scripts: {}, scriptRuns: 0 };
                const wrap = (obj, name, fn) => { if (!obj || typeof obj[name] !== "function") return; const o = obj[name]; obj[name] = function(...a) { const res = o.apply(this, a); try { fn(res, a); } catch {} return res; }; };
                wrap(wm, "consumeAllRootDirty", () => d.full++);
                wrap(wm, "consumeRootDirty", () => d.partial++);
                wrap(wm, "isAnyRootDirty", (res) => { d.anyRootDirtyCalls++; if (res) d.anyRootDirtyTrue++; });
                wrap(wm, "getPreciseDirtyWidgets", (res) => { d.preciseCalls++; if (res && res.length) { d.preciseNonEmpty++; for (const w of res) { const k = (w.uid >>> 16) + ":" + (w.uid & 0xffff) + " t" + w.type; d.precise[k] = (d.precise[k] || 0) + 1; } } });
                wrap(c.cs2Vm, "runScriptEvent", (res, a) => { const ev = a[0]; d.scriptRuns++; const uid = ev && ev.widget ? ev.widget.uid : -1; const args = ev && ev.args; const sid = Array.isArray(args) ? args[0] : ""; const k = (uid >>> 16) + ":" + (uid & 0xffff) + " s" + sid + " " + (ev && ev.type || ""); d.scripts[k] = (d.scripts[k] || 0) + 1; });
                const cp = c.clientPlugins;
                wrap(cp, "activeGameFrame", (res) => { if (res) d.gameFrame++; });
                wrap(cp, "widgetOverlays", (res) => { let sig = ""; for (const o of res || []) { const nm = o.constructor && o.constructor.name; d.overlayNames[nm] = (d.overlayNames[nm] || 0) + 1; sig += nm + "=" + o.signature() + "|"; } if (d.lastSig !== null && sig !== d.lastSig) d.overlaySigChanges++; d.lastSig = sig; });
            })()`);
        }

        summary.env = await cdp.evaluate(`(() => {
            const c = ${CLIENT_JS}; const r = c.renderer; const s = r.stats;
            const ov = r.ui && r.ui.widgetsOverlay;
            return { rendererType: r.type, dpr: window.devicePixelRatio, maxTouchPoints: navigator.maxTouchPoints, ua: navigator.userAgent.slice(0, 60),
                coarse: matchMedia("(pointer: coarse)").matches, innerSize: [innerWidth, innerHeight],
                canvas: [r.canvas.width, r.canvas.height], canvasCss: [r.canvas.clientWidth, r.canvas.clientHeight],
                fpsLimit: r.fpsLimit, targetFps: c.targetFps, effectiveFpsLimit: r.getEffectiveFpsLimit ? r.getEffectiveFpsLimit() : null,
                rootInterface: c.widgetManager && c.widgetManager.rootInterface, mobileSceneScale: c.mobileEffectiveResolutionScale,
                renderDistance: c.renderDistance, visibleMaps: r.mapManager.visibleMaps.length, workers: c.workerPool && c.workerPool.size,
                widgetGl: ov && ov.glRenderer && ov.glRenderer.canvas ? [ov.glRenderer.canvas.width, ov.glRenderer.canvas.height] : null,
                plugins: c.runeLite.pluginManager.getPlugins().filter(p => p.isStarted && p.isStarted()).map(p => c.runeLite.pluginManager.getDescriptor(p).name),
                player: (() => { const i = c.playerEcs.getIndexForServerId(c.controlledPlayerServerId); return i === undefined ? null : [c.playerEcs.getX(i) / 128 | 0, c.playerEcs.getY(i) / 128 | 0, c.playerEcs.getLevel(i)]; })(),
            };
        })()`);

        if (cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
        summary.windows = [];
        for (const mode of modes) {
            await cdp.evaluate(`(() => {
                const c = ${CLIENT_JS}; const r = c.renderer;
                c.camera.snapToYaw(0); c.camera.snapToPitch(256);
                r.followCamCameraFeelInitialized = false;
                const orig = r.__profOrigRender ?? (r.__profOrigRender = r.render);
                const w = window.__prof = { samples: [], mode: ${JSON.stringify(mode)}, started: undefined, widgetDraws: 0, widgetDrawMs: 0, uiUpdateMs: 0, actorsMs: 0, overlaysMs: 0 };
                const ov = r.ui && r.ui.widgetsOverlay;
                if (ov && !ov.__profPatched) {
                    ov.__profPatched = true;
                    const od = ov.draw;
                    ov.draw = function(...a) { const t = performance.now(); try { return od.apply(this, a); } finally { const p = window.__prof; if (p && p.started !== undefined) { p.widgetDraws++; p.widgetDrawMs += performance.now() - t; } } };
                }
                const timed = (obj, name, field) => {
                    if (!obj || obj["__profPatched_" + name]) return;
                    const o = obj[name]; if (typeof o !== "function") return;
                    obj["__profPatched_" + name] = true;
                    obj[name] = function(...a) { const t = performance.now(); try { return o.apply(this, a); } finally { const p = window.__prof; if (p && p.started !== undefined) p[field] += performance.now() - t; } };
                };
                timed(r.ui, "update", "uiUpdateMs"); timed(r.actors, "update", "actorsMs"); timed(r.overlays, "update", "overlaysMs");
                r.render = function(time, dt, resized) {
                    w.started ??= time;
                    const live = time - w.started >= 1500;
                    // The camera-pan benchmark's drag input: 512 yaw units per second.
                    if (w.mode === "drag") c.inputManager._cameraDragDeltaX = -512 * dt / 1000 / .9;
                    const b = performance.now();
                    try { return orig.call(this, time, dt, resized); }
                    finally { if (live) w.samples.push([time, dt, performance.now() - b]); else if (w.samples.length === 0) { w.widgetDraws = 0; w.widgetDrawMs = 0; w.uiUpdateMs = 0; w.actorsMs = 0; w.overlaysMs = 0; } }
                };
            })()`);
            const m0 = await cdp.send("Performance.getMetrics");
            await cdp.send("Profiler.enable");
            await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
            await cdp.send("Profiler.start");
            await sleep(windowMs + 1500);
            const prof = await cdp.send("Profiler.stop");
            const m1 = await cdp.send("Performance.getMetrics");
            const data = await cdp.evaluate(`(() => { const c = ${CLIENT_JS}; const r = c.renderer; r.render = r.__profOrigRender; const w = window.__prof; window.__prof = undefined; c.inputManager._cameraDragDeltaX = 0;
                const s = r.stats; w.stats = { fps: s.frameTimeFps, visibleMaps: r.mapManager.visibleMaps.length, canvas: [r.canvas.width, r.canvas.height] };
                if (window.__diag) { const d = window.__diag; w.diag = JSON.parse(JSON.stringify(d)); d.full = 0; d.partial = 0; d.anyRootDirtyTrue = 0; d.anyRootDirtyCalls = 0; d.precise = {}; d.preciseCalls = 0; d.preciseNonEmpty = 0; d.gameFrame = 0; d.overlaySigChanges = 0; d.scripts = {}; d.scriptRuns = 0; }
                return w; })()`);
            const metric = (m, name) => m.result?.metrics?.find((x) => x.name === name)?.value ?? 0;
            const diff = (name) => +(metric(m1, name) - metric(m0, name)).toFixed(name.includes("Duration") ? 3 : 0);
            const cpuMs = data.samples.map((s) => s[2]);
            const dts = data.samples.map((s) => s[1]);
            const pct = (v, p) => [...v].sort((a, b) => a - b)[Math.floor((v.length - 1) * p)] ?? 0;
            const stat = (v) => ({ mean: +(v.reduce((a, b) => a + b, 0) / Math.max(1, v.length)).toFixed(2), p50: +pct(v, .5).toFixed(2), p95: +pct(v, .95).toFixed(2), p99: +pct(v, .99).toFixed(2), max: +Math.max(0, ...v).toFixed(2) });
            const frames = data.samples.length;
            const win = {
                mode, frames, fps: +(frames / ((data.samples.at(-1)?.[0] - data.samples[0]?.[0]) / 1000 || 1)).toFixed(1),
                renderCpuMs: stat(cpuMs), frameIntervalMs: stat(dts), gapsOver25ms: dts.filter((d) => d > 25).length, gapsOver50ms: dts.filter((d) => d > 50).length,
                perFrame: { widgetDraws: +(data.widgetDraws / frames).toFixed(2), widgetDrawMs: +(data.widgetDrawMs / frames).toFixed(2), uiUpdateMs: +(data.uiUpdateMs / frames).toFixed(2), actorsMs: +(data.actorsMs / frames).toFixed(2), overlaysMs: +(data.overlaysMs / frames).toFixed(2) },
                browser: { layoutCount: diff("LayoutCount"), recalcStyleCount: diff("RecalcStyleCount"), scriptDurationS: diff("ScriptDuration"), layoutDurationS: diff("LayoutDuration"), taskDurationS: diff("TaskDuration"), jsHeapUsedMB: +(metric(m1, "JSHeapUsedSize") / 1048576).toFixed(1), domNodes: metric(m1, "Nodes") },
                stats: data.stats,
                diag: data.diag,
                profile: summarizeProfile(prof.result.profile),
            };
            summary.windows.push(win);
            console.error(`[${mode}] frames=${frames} fps=${win.fps} cpu mean=${win.renderCpuMs.mean} p95=${win.renderCpuMs.p95} hud=${win.perFrame.widgetDrawMs}ms/frame full=${win.diag?.full ?? "-"} partial=${win.diag?.partial ?? "-"}`);
            if (out) fs.writeFileSync(out + `.${summary.windows.length}.${mode}.cpuprofile`, JSON.stringify(prof.result.profile));
        }
        if (cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
        if (shot) {
            const png = await cdp.send("Page.captureScreenshot", { format: "png" });
            fs.writeFileSync(shot, Buffer.from(png.result.data, "base64"));
            summary.screenshot = shot;
        }
        summary.console = cdp.consoleLines.slice(-60);
        if (out) fs.writeFileSync(out, JSON.stringify(summary, null, 1));
        const brief = { settings: summary.settings, env: summary.env, windows: summary.windows.map(({ profile, ...w }) => ({ ...w, topCategories: profile.categories.slice(0, 8), topSelf: profile.selfTop.slice(0, 12) })) };
        console.log(JSON.stringify(brief, null, 1));
    } finally {
        try { cdp?.close(); } catch {}
        killBrowser(proc);
    }
}

main().catch((e) => { console.error("FAILED:", e); process.exitCode = 1; });
