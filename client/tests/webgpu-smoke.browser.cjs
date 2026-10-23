// WebGPU renderer smoke test. Launches its own headless Chrome (fresh --user-data-dir,
// so it never touches an already-running Chrome), navigates to the dev client with
// ?renderer=webgpu, waits for window.__WEBGPU_RENDERER__ to create a device and submit
// frames, then writes client/tests/artifacts/webgpu-smoke.png.
//
// Run: node client/tests/webgpu-smoke.browser.cjs
//
// Env:
//   CLIENT_URL        client to test (default http://localhost:3101, this worktree's port).
//                     May include query params, e.g. ?username=a&password=a (auto-login)
//   SMOKE_TIMEOUT_MS  how long to wait for the renderer (default 60000)
//   SMOKE_EXPECT_WORLD=1  also wait for the game to be logged in with visible maps
//   SMOKE_RENDERER    renderer param to force (default webgpu; "none" leaves ?renderer off,
//                     e.g. SMOKE_RENDERER=webgl to verify the fallback)
//   SMOKE_PROJECTILE_ROTATION=1  compare projectile GPU orientation with WebGL rotation maths
//   SMOKE_HD_OPTIMISATIONS=1  check scenery draw savings, LOD and cached world shadows
//   SMOKE_HD_QUALITY=1  verify HD quality toggles, GPU pixels, camera motion and resize
//   SMOKE_HD_LIGHTS=1  check nearby lanterns and their 25% dimmer light uniforms
//   SMOKE_HEADLESS=0  run non-headless with a visible 1280x800 window, the fallback if
//                     headless Chrome cannot get a WebGPU adapter on this machine
//
// Chrome flags (adapter + dev client verified on Chrome 154 / macOS, headless, muted):
//   --headless=new --mute-audio --enable-unsafe-webgpu --use-angle=metal
//   --enable-features=Vulkan --disable-vulkan-surface
//   --remote-debugging-port=<free port> --user-data-dir=<temp profile>
//   --no-first-run --no-default-browser-check about:blank
// `--headless=new --enable-unsafe-webgpu` alone also got an adapter here; the ANGLE and
// Vulkan flags are kept because they are the known-good set for GPU presentation.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const WebSocket = require("ws");

const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:3101";
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS) || 60000;
// The client holds no plugin references; find one by its descriptor name.
const pluginJs = (name) => `((pm) => pm.getPlugins().find((p) => pm.getDescriptor(p).name === ${JSON.stringify(name)}))(window.osrsClient.runeLite.pluginManager)`;
const HD_PLUGIN_JS = pluginJs("117 HD");
const COMMAND_TIMEOUT_MS = Math.min(TIMEOUT_MS, 15000);
const DEVTOOLS_TIMEOUT_MS = Math.min(TIMEOUT_MS, 20000);
const SETTLE_MS = 3000;

const targetUrl = new URL(CLIENT_URL);
const rendererParam = process.env.SMOKE_RENDERER ?? "webgpu";
if (rendererParam !== "none") targetUrl.searchParams.set("renderer", rendererParam);

async function main() {
    assert.ok(fs.existsSync(CHROME_PATH), `Chrome not found at ${CHROME_PATH}`);
    const failures = [];
    const consoleMessages = [];
    const debugPort = await freePort();
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "webgpu-smoke-"));
    const chrome = spawn(CHROME_PATH, chromeFlags(debugPort, profileDir), {
        stdio: "ignore",
        detached: true,
    });
    let socket;
    try {
        const tab = await waitForDevtoolsPage(debugPort);
        socket = new WebSocket(tab.webSocketDebuggerUrl);
        const cdp = createCdp(socket, consoleMessages);
        await cdp.opened;
        await cdp.send("Runtime.enable");
        await cdp.send("Log.enable");
        await cdp.send("Page.enable");

        console.log(`[webgpu-smoke] navigating to ${targetUrl.href}`);
        await cdp.send("Page.navigate", { url: targetUrl.href });

        const deadline = Date.now() + TIMEOUT_MS;
        let state = { present: false };
        while (!rendererReady(state, rendererParam) && Date.now() < deadline) {
            await sleep(250);
            try {
                state = await rendererState(cdp);
            } catch {
                // The execution context is replaced during navigation; keep polling.
            }
        }
        if (!rendererReady(state, rendererParam)) {
            failures.push(
                `renderer (${rendererParam}) did not appear within ${TIMEOUT_MS}ms`,
            );
        } else {
            await sleep(SETTLE_MS);
            state = await rendererState(cdp);
            console.log(`[webgpu-smoke] renderer state: ${JSON.stringify(state)}`);
            if (process.env.SMOKE_ENABLE_HD === "1") {
                const result = await cdp.send("Runtime.evaluate", {
                    returnByValue: true,
                    awaitPromise: true,
                    expression: `(async () => {
                        const client =
                            window.osrsClient ??
                            (window.__WEBGPU_RENDERER__ && window.__WEBGPU_RENDERER__.osrsClient) ??
                            null;
                        const pm = client && client.runeLite.pluginManager;
                        const hd = pm && pm.getPlugins().find((p) => pm.getDescriptor(p).name === "117 HD");
                        if (!hd) return "hd-plugin-missing";
                        await pm.setPluginEnabled(hd, true);
                        return "hd-enabled";
                    })()`,
                });
                console.log(`[webgpu-smoke] HD enable: ${result.result?.value}`);
                if (result.result?.value !== "hd-enabled") {
                    failures.push(`HD enable failed: ${result.result?.value}`);
                }
            }
            if (!state.running) failures.push("renderer.running is false");
            if (!(state.frameCount > 0)) {
                failures.push(`renderer submitted no frames (frameCount=${state.frameCount})`);
            }
            if (!(state.canvasWidth > 0 && state.canvasHeight > 0)) {
                failures.push(`canvas is ${state.canvasWidth}x${state.canvasHeight}`);
            }
            if (process.env.SMOKE_EXPECT_WORLD === "1") {
                while (!(state.visibleMaps > 0) && Date.now() < deadline) {
                    await sleep(500);
                    state = await rendererState(cdp);
                }
                await sleep(Number(process.env.SMOKE_FINAL_WAIT_MS) || 2000);
                state = await rendererState(cdp);
                console.log(`[webgpu-smoke] world state: ${JSON.stringify(state)}`);
                if (!state.loggedIn) failures.push("client is not in a logged-in state");
                if (!(state.visibleMaps > 0)) {
                    failures.push(`no visible maps (visibleMaps=${state.visibleMaps})`);
                }
                if (process.env.SMOKE_EXPECT_HD === "1" && !state.hdEnabled) {
                    failures.push("HD plugin is not enabled");
                }
                await dismissWelcome(cdp);
            }
            if (process.env.SMOKE_HD_QUALITY === "1") {
                await checkHdQuality(cdp);
            }
            if (process.env.SMOKE_PROJECTILE_ROTATION === "1") {
                const result = await cdp.send("Runtime.evaluate", {
                    expression: `(${projectileRotationGpuPixels.toString()})()`, returnByValue: true, awaitPromise: true,
                });
                if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
                console.log(`[webgpu-smoke] projectile rotation: ${JSON.stringify(result.result.value)}`);
            }
            if (process.env.SMOKE_HD_OPTIMISATIONS === "1") {
                await checkHdOptimisations(cdp);
            }
            if (process.env.SMOKE_HD_LIGHTS === "1") {
                await checkHdLights(cdp);
            }
            const baselineWait = Number(process.env.SMOKE_BASELINE_WAIT_MS) || 0;
            if (baselineWait > 0) {
                const start = await controlledPlayerTile(cdp);
                await sleep(baselineWait);
                const end = await controlledPlayerTile(cdp);
                console.log(
                    `[webgpu-smoke] baseline tile ${JSON.stringify(start)} -> ${JSON.stringify(end)}`,
                );
                if (start && end && start.x === end.x && start.y === end.y) {
                    console.log("[webgpu-smoke] baseline: player stationary before click");
                } else {
                    failures.push(
                        `player moved without a click (${JSON.stringify(start)} -> ${JSON.stringify(end)})`,
                    );
                }
            }
            const clickAt = process.env.SMOKE_CLICK_AT;
            if (clickAt && process.env.SMOKE_EXPECT_HOVER === "1") {
                const [cx, cy] = clickAt.split(",").map(Number);
                await cdp.send("Runtime.evaluate", {
                    expression: "if (window.osrsClient) window.osrsClient.hoverOverlayEnabled = true;",
                });
                await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: cx, y: cy, button: "none" });
                await sleep(Number(process.env.SMOKE_CLICK_WAIT_MS) || 1000);
                const hover = await evaluateHover(cdp);
                console.log(`[webgpu-smoke] hover state: ${JSON.stringify(hover)}`);
                if (!hover || !hover.tile) {
                    failures.push(`hover tile not populated: ${JSON.stringify(hover)}`);
                }
            }
            if (clickAt) {
                const [cx, cy] = clickAt.split(",").map(Number);
                const expectMenu = process.env.SMOKE_EXPECT_MENU === "1";
                const expectMove = process.env.SMOKE_EXPECT_MOVE === "1";
                const button = expectMenu ? "right" : "left";
                if (expectMenu) {
                    // ?mobile=1 (used to skip the welcome screen) also flips the desktop
                    // tooltips default off, which makes the shared world-menu pass close the
                    // menu on the next frame. Force the desktop default for this check.
                    await cdp.send("Runtime.evaluate", {
                        expression: "if (window.osrsClient) window.osrsClient.tooltips = true;",
                    });
                }
                const before = expectMove ? await controlledPlayerTile(cdp) : null;
                console.log(`[webgpu-smoke] clicking (${cx}, ${cy}) button=${button}`);
                for (const type of ["mousePressed", "mouseReleased"]) {
                    await cdp.send("Input.dispatchMouseEvent", {
                        type,
                        x: cx,
                        y: cy,
                        button,
                        clickCount: 1,
                    });
                }
                await sleep(Number(process.env.SMOKE_CLICK_WAIT_MS) || 3000);
                state = await rendererState(cdp);
                console.log(`[webgpu-smoke] post-click state: ${JSON.stringify(state)}`);
                if (before) {
                    const after = await controlledPlayerTile(cdp);
                    console.log(
                        `[webgpu-smoke] player tile ${JSON.stringify(before)} -> ${JSON.stringify(after)}`,
                    );
                    if (!after || (after.x === before.x && after.y === before.y)) {
                        failures.push(
                            `player did not move after click (${JSON.stringify(before)})`,
                        );
                    }
                }
                if (expectMenu) {
                    const menu = await worldMenuState(cdp);
                    console.log(`[webgpu-smoke] world menu: ${JSON.stringify(menu)}`);
                    const options = menu.options || [];
                    const hasWorldEntry = options.some((option) => !/^cancel$/i.test(option));
                    if (!menu.open || options.length === 0) {
                        failures.push(`world menu did not open: ${JSON.stringify(menu)}`);
                    } else if (!hasWorldEntry) {
                        failures.push(
                            `world menu has only Cancel: ${JSON.stringify(options)}`,
                        );
                    }
                }
            }
        }
        await captureScreenshot(cdp);
    } catch (error) {
        failures.push(`smoke run failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
        try {
            socket?.close();
        } catch {}
        killChrome(chrome);
        removeDir(profileDir);
    }
    failures.push(...scanConsole(consoleMessages));

    const errors = consoleMessages.filter((message) => message.level === "error");
    if (errors.length > 0) {
        console.error(`[webgpu-smoke] console errors (${errors.length}):`);
        for (const { text } of errors) console.error(`  ${text}`);
    }
    if (failures.length > 0) {
        console.error(`FAIL WebGPU smoke test: ${failures.join("; ")}`);
        process.exitCode = 1;
    } else {
        console.log("PASS WebGPU smoke test: renderer running and submitting frames");
    }
}

function chromeFlags(debugPort, profileDir) {
    const headless = process.env.SMOKE_HEADLESS !== "0";
    return [
        ...(headless ? ["--headless=new"] : ["--window-size=1280,800"]),
        "--mute-audio",
        "--enable-unsafe-webgpu",
        "--use-angle=metal",
        "--enable-features=Vulkan",
        "--disable-vulkan-surface",
        `--remote-debugging-port=${debugPort}`,
        `--user-data-dir=${profileDir}`,
        "--no-first-run",
        "--no-default-browser-check",
        "about:blank",
    ];
}

function freePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });
}

async function waitForDevtoolsPage(port) {
    const deadline = Date.now() + DEVTOOLS_TIMEOUT_MS;
    let lastError;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
                signal: AbortSignal.timeout(2000),
            });
            const tab = (await response.json()).find(
                (candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl,
            );
            if (tab) return tab;
        } catch (error) {
            lastError = error;
        }
        await sleep(250);
    }
    throw new Error(`DevTools endpoint never came up on port ${port}: ${lastError}`);
}

function createCdp(socket, consoleMessages) {
    const pending = new Map();
    let nextId = 0;
    socket.on("message", (raw) => {
        const message = JSON.parse(raw);
        if (message.id !== undefined && pending.has(message.id)) {
            const { resolve, reject, timer } = pending.get(message.id);
            pending.delete(message.id);
            clearTimeout(timer);
            if (message.error) reject(new Error(JSON.stringify(message.error)));
            else resolve(message.result);
            return;
        }
        collectConsoleMessage(message, consoleMessages);
    });
    socket.on("error", (error) => {
        for (const { reject, timer } of pending.values()) {
            clearTimeout(timer);
            reject(error);
        }
        pending.clear();
    });
    const opened = new Promise((resolve, reject) => {
        if (socket.readyState === WebSocket.OPEN) resolve();
        else {
            socket.once("open", resolve);
            socket.once("error", reject);
        }
    });
    const send = (method, params = {}) =>
        new Promise((resolve, reject) => {
            const id = ++nextId;
            const timer = setTimeout(() => {
                pending.delete(id);
                reject(new Error(`${method} timed out after ${COMMAND_TIMEOUT_MS}ms`));
            }, COMMAND_TIMEOUT_MS);
            pending.set(id, { resolve, reject, timer });
            socket.send(JSON.stringify({ id, method, params }));
        });
    return { send, opened };
}

function collectConsoleMessage(message, consoleMessages) {
    if (message.method === "Runtime.consoleAPICalled") {
        consoleMessages.push({
            level: message.params.type,
            text: message.params.args.map(describeConsoleArg).join(" "),
        });
    } else if (message.method === "Runtime.exceptionThrown") {
        const details = message.params.exceptionDetails;
        consoleMessages.push({
            level: "error",
            text: details.exception?.description ?? details.text,
        });
    } else if (message.method === "Log.entryAdded") {
        consoleMessages.push({
            level: message.params.entry.level,
            text: message.params.entry.text,
        });
    }
}

function describeConsoleArg(arg) {
    if (arg.value !== undefined) {
        return typeof arg.value === "string" ? arg.value : JSON.stringify(arg.value);
    }
    return arg.description ?? arg.unserializableValue ?? arg.type;
}

async function rendererState(cdp) {
    const response = await cdp.send("Runtime.evaluate", {
        returnByValue: true,
        expression: `(() => {
            const renderer =
                window.__WEBGPU_RENDERER__ ??
                (window.osrsClient && window.osrsClient.renderer) ??
                null;
            if (!renderer) return { present: false };
            const canvas = renderer.canvas;
            return {
                present: true,
                rendererType: renderer.type ?? (renderer.device ? "webgpu" : "webgl"),
                hasDevice: !!renderer.device,
                running: renderer.running === true,
                frameCount: Number(renderer.stats && renderer.stats.frameCount) || 0,
                canvasWidth: canvas ? canvas.width : 0,
                canvasHeight: canvas ? canvas.height : 0,
                loggedIn:
                    !!(renderer.osrsClient && renderer.osrsClient.isLoggedIn
                        ? renderer.osrsClient.isLoggedIn()
                        : false),
                gameState: renderer.osrsClient ? renderer.osrsClient.gameState : -1,
                hdEnabled: !!(renderer.osrsClient && renderer.osrsClient.clientPlugins.hdEnabled()),
                visibleMaps:
                    renderer.mapManager && renderer.mapManager.visibleMaps
                        ? renderer.mapManager.visibleMaps.length
                        : 0,
                atlasTextures: (() => {
                    try {
                        return renderer.world ? renderer.world.loadedTextureIds.size : -1;
                    } catch {
                        return -1;
                    }
                })(),
                loadingPending: (() => {
                    try {
                        const tracker = renderer.osrsClient.loadingTracker;
                        return Array.from(tracker.requirements).filter(
                            (requirement) => !tracker.completed.has(requirement),
                        );
                    } catch {
                        return [];
                    }
                })(),
            };
        })()`,
    });
    return response.result?.value ?? { present: false };
}

function rendererReady(state, expected) {
    if (!state.present) return false;
    if (expected === "webgpu") return state.hasDevice === true;
    if (expected === "webgl") return state.rendererType === "webgl";
    return true;
}

/** Sub-tile X/Y of the controlled player, for SMOKE_EXPECT_MOVE runs. */
async function controlledPlayerTile(cdp) {
    const response = await cdp.send("Runtime.evaluate", {
        returnByValue: true,
        expression: `(() => {
            const client =
                window.osrsClient ??
                (window.__WEBGPU_RENDERER__ && window.__WEBGPU_RENDERER__.osrsClient) ??
                null;
            if (!client) return null;
            const pe = client.playerEcs;
            const idx = pe.getIndexForServerId(client.controlledPlayerServerId | 0);
            if (idx === undefined) return null;
            return { x: pe.getX(idx) | 0, y: pe.getY(idx) | 0, serverId: client.controlledPlayerServerId | 0 };
        })()`,
    });
    return response.result?.value ?? null;
}

/** Hovered world tile, for SMOKE_EXPECT_HOVER runs. */
async function evaluateHover(cdp) {
    const response = await cdp.send("Runtime.evaluate", {
        returnByValue: true,
        expression: `(() => {
            const client =
                window.osrsClient ??
                (window.__WEBGPU_RENDERER__ && window.__WEBGPU_RENDERER__.osrsClient) ??
                null;
            if (!client) return null;
            const canvas = document.querySelector("canvas");
            const rect = canvas ? canvas.getBoundingClientRect() : null;
            const px = client.inputManager.mouseX === -1 ? 300 : client.inputManager.mouseX;
            const py = client.inputManager.mouseY === -1 ? 200 : client.inputManager.mouseY;
            const stack = (document.elementsFromPoint(px, py) || []).slice(0, 4).map((el) => {
                return (
                    el.tagName +
                    "|" +
                    String(el.className || "").slice(0, 40) +
                    "|" +
                    String((el.style && el.style.pointerEvents) || "")
                );
            });
            const hud = document.querySelector(".hud.right-top");
            return {
                enabled: !!client.hoverOverlayEnabled,
                mouse: [client.inputManager.mouseX, client.inputManager.mouseY],
                stack,
                hudPointerEvents: hud ? getComputedStyle(hud).pointerEvents : null,
                rect: rect ? { x: rect.x, y: rect.y, w: rect.width, h: rect.height } : null,
                contains:
                    client.camera && client.camera.containsScreenPoint
                        ? client.camera.containsScreenPoint(px, py)
                        : null,
                tile: client.hoveredTile ?? null,
                screen: client.hoveredTileScreen ?? null,
            };
        })()`,
    });
    return response.result?.value ?? null;
}

/** Open world menu entries, for SMOKE_EXPECT_MENU runs. */
async function worldMenuState(cdp) {    const response = await cdp.send("Runtime.evaluate", {
        returnByValue: true,
        expression: `(() => {
            const client =
                window.osrsClient ??
                (window.__WEBGPU_RENDERER__ && window.__WEBGPU_RENDERER__.osrsClient) ??
                null;
            if (!client) return { open: false, options: [] };
            return {
                open: !!client.menuOpen,
                options: (client.menuEntries || []).map((entry) => String(entry.option || "")),
            };
        })()`,
    });
    return response.result?.value ?? { open: false, options: [] };
}

function scanConsole(consoleMessages) {
    const failures = [];
    for (const { level, text } of consoleMessages) {
        if (!text) continue;
        if (level === "error" && /\[webgpu\]/i.test(text)) {
            failures.push(`console error: ${text}`);
        } else if (/Validation Error|device lost/i.test(text)) {
            failures.push(`WebGPU error text: ${text}`);
        }
    }
    return failures;
}

async function checkHdLights(cdp) {
    const evaluate = async expression => {
        const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
        return result.result.value;
    };
    await evaluate("window.osrsClient.camera.setYaw(1024); window.osrsClient.camera.snapToPitch(160)");
    await sleep(500);
        const state = await evaluate(`(() => {
            const client = window.osrsClient, r = window.__WEBGPU_RENDERER__ ?? client.renderer;
            const lightState = r.world?.extension ?? ${HD_PLUGIN_JS}.renderers.get(r);
            const plane = r.getPlayerRawPlane(), locs = [];
            for (let m = 0; m < r.mapManager.visibleMapCount; m++) {
                const map = r.mapManager.visibleMaps[m], ids = map.tileLocIdsByLevel?.[plane], offsets = map.tileLocOffsetsByLevel?.[plane];
                if (!ids || !offsets) continue;
                for (let tile = 0; tile < 4096; tile++) {
                    const x = map.getRenderBaseWorldX() + (tile % 64), z = map.getRenderBaseWorldY() + (tile >> 6);
                    if (Math.abs(x - r.playerPosUni[0]) > 8 || Math.abs(z - r.playerPosUni[1]) > 8) continue;
                    for (let i = offsets[tile]; i < offsets[tile + 1]; i++) {
                        if (![196, 205].includes(ids[i])) continue;
                        const loc = client.locTypeLoader.load(ids[i]);
                        locs.push({ id: ids[i], name: loc.name, x, z, typeRot: map.tileLocTypeRotByLevel[plane][i], size: [loc.sizeX, loc.sizeY] });
                    }
                }
            }
            return { player: Array.from(r.playerPosUni), locs, count: lightState.lightCount,
                positions: Array.from(lightState.lightPositions).slice(0, lightState.lightCount * 4),
                colors: Array.from(lightState.lightColors).slice(0, lightState.lightCount * 4) };
        })()`);
        assert.ok(state.count > 0 && state.locs.some(loc => loc.id === 205), "test scene contains a lit lantern");
        assert.ok(state.colors.some((value, i) => i % 4 === 0 && value === 1 && Math.abs(state.colors[i + 3] - 0.46875) < 0.001),
            "actual lantern uniform is 25% dimmer");
        console.log(`[webgpu-smoke] HD lights: ${JSON.stringify(state)}`);
        await captureScreenshot(cdp, `hd-lights-${rendererParam}.png`);

}

async function checkHdQuality(cdp) {
    const evaluate = async (expression) => {
        const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
        return result.result.value;
    };
    const keys = ["textureFiltering", "antiAliasing", "depthAwareAo"];
    const defaults = await evaluate(`${HD_PLUGIN_JS}.options`);
    for (const key of keys) assert.equal(defaults[key], true, `${key} defaults on`);
    const pixels = await evaluate(`(${hdQualityGpuPixels.toString()})()`);
    console.log(`[webgpu-smoke] HD GPU pixel checks: ${JSON.stringify(pixels)}`);
    for (const disabled of [...keys, "all", "none"]) {
        await evaluate(`(() => {
            const client = window.osrsClient;
            for (const key of ${JSON.stringify(keys)}) {
                client.runeLite.configManager.setConfiguration("hd", key, String(key !== ${JSON.stringify(disabled)} && ${JSON.stringify(disabled)} !== "all"));
            }
        })()`);
        await sleep(500);
        const state = await evaluate(`(() => {
            const r = window.__WEBGPU_RENDERER__, ext = r.world.extension;
            return { frame: r.stats.frameCount, options: ${HD_PLUGIN_JS}.options,
                filtering: ext.uniforms[196], aoWidth: ext.post.ssao.blurTexture.width, sceneWidth: r.canvas.width };
        })()`);
        for (const key of keys) assert.equal(state.options[key], disabled !== "all" && disabled !== key, `${key} after disabling ${disabled}`);
        assert.equal(state.filtering, state.options.textureFiltering ? 1 : 0);
        assert.equal(state.aoWidth, state.options.depthAwareAo ? state.sceneWidth : Math.max(1, Math.floor(state.sceneWidth / 2)));
        await captureScreenshot(cdp, `hd-quality-${disabled}.png`);
        console.log(`[webgpu-smoke] HD toggles ${disabled}: ${JSON.stringify(state)}`);
    }
    const yawBefore = await evaluate("window.osrsClient.camera.yaw");
    await evaluate("window.osrsClient.camera.setYaw(window.osrsClient.camera.yaw + 256)");
    await sleep(750);
    const yawAfter = await evaluate("window.osrsClient.camera.yaw");
    assert.notEqual(yawAfter, yawBefore, "camera motion actually changed the view");
    await captureScreenshot(cdp, "hd-quality-camera.png");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1001, height: 701, deviceScaleFactor: 1, mobile: false });
    await sleep(750);
    await captureScreenshot(cdp, "hd-quality-resize.png");
    await cdp.send("Emulation.clearDeviceMetricsOverride");
    await sleep(500);
}

// Use the actual live pipelines on tiny synthetic images, rather than reimplementing their maths.
async function hdQualityGpuPixels() {
    const r = window.__WEBGPU_RENDERER__, d = r.device, post = r.world.extension.post;
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    check(r.world.extension.materials.textures.mipLevelCount === 9, "256px HD mip chain missing");
    check(r.world.extension.materials.detailTextures.width === 512 &&
        r.world.extension.materials.detailTextures.mipLevelCount === 10, "512px detail mip chain missing");
    const owned = [];
    const texture = (format, size, usage) => {
        const t = d.createTexture({ format, size, usage }); owned.push(t); return t;
    };
    const render = (encoder, pipeline, target, groups) => {
        const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: "clear", storeOp: "store" }] });
        pass.setPipeline(pipeline);
        groups.forEach((group, i) => pass.setBindGroup(i, group));
        pass.draw(3); pass.end();
    };
    const read = async (t, bytesPerPixel) => {
        const b = d.createBuffer({ size: 256 * 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        owned.push(b);
        const encoder = d.createCommandEncoder();
        encoder.copyTextureToBuffer({ texture: t }, { buffer: b, bytesPerRow: 256 }, [8, 8]);
        d.queue.submit([encoder.finish()]);
        await b.mapAsync(GPUMapMode.READ);
        const bytes = new Uint8Array(b.getMappedRange());
        const values = Array.from({ length: 64 }, (_, i) => bytes[Math.floor(i / 8) * 256 + i % 8 * bytesPerPixel]);
        b.unmap(); return values;
    };
    try {
        const fxaa = post.fxaa;
        check(!!fxaa, "FXAA pass missing");
        const src = texture(r.format, [8, 8], GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING);
        const dst = texture(r.format, [8, 8], GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT);
        const group = d.createBindGroup({ layout: fxaa.layout, entries: [
            { binding: 0, resource: src.createView() }, { binding: 1, resource: fxaa.sampler },
        ] });
        const pixels = new Uint8Array(8 * 8 * 4);
        for (let i = 0; i < 64; i++) pixels.set([102, 102, 102, 255], i * 4);
        const fxaaDraw = async () => {
            d.queue.writeTexture({ texture: src }, pixels, { bytesPerRow: 32 }, [8, 8]);
            const encoder = d.createCommandEncoder(); render(encoder, fxaa.pipeline, dst, [group]);
            d.queue.submit([encoder.finish()]); return read(dst, 4);
        };
        const flat = await fxaaDraw();
        check(flat.every(v => Math.abs(v - 102) <= 1), "FXAA changed a flat surface");
        for (let i = 0; i < 64; i++) {
            const value = i % 8 > Math.floor(i / 8) ? 255 : 0;
            pixels.set([value, value, value, 255], i * 4);
        }
        const edges = await fxaaDraw();
        check(edges.some(v => v > 10 && v < 245), "FXAA did not smooth a diagonal edge");
        check(edges.every((v, i) => pixels[i * 4] === 0 ? v <= 128 : v >= 127),
            "FXAA erased more than half the original edge contrast");
        const ao = texture("r8unorm", [4, 4], GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING);
        d.queue.writeTexture({ texture: ao }, new Uint8Array([0,0,255,255, 0,0,255,255, 0,0,255,255, 0,0,255,255]), { bytesPerRow: 4 }, [4,4]);
        const depth = texture("depth32float", [8, 8], GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING);
        const aoDst = texture("r8unorm", [8, 8], GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC);
        const module = d.createShaderModule({ code: `
            @vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
                let p = array<vec2<f32>,3>(vec2<f32>(-1,-1),vec2<f32>(3,-1),vec2<f32>(-1,3));
                return vec4<f32>(p[i],0,1);
            }
            @fragment fn fs(@builtin(position) p: vec4<f32>) -> @builtin(frag_depth) f32 { return select(0.8,0.2,p.x < 4); }
        ` });
        const depthPipeline = d.createRenderPipeline({ layout: "auto", vertex: { module, entryPoint: "vs" },
            fragment: { module, entryPoint: "fs", targets: [] }, depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "always" } });
        const uniform = d.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }); owned.push(uniform);
        const u = new Float32Array(32);
        u.set([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
        u.set([4,4,0.25,0.25],20); u[25]=1; u.set([8,8,0.125,0.125],28);
        d.queue.writeBuffer(uniform,0,u);
        const pipeline = post.ssao.blurPipeline;
        const groups = [d.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniform } }] }),
            d.createBindGroup({ layout: pipeline.getBindGroupLayout(1), entries: [{ binding: 0, resource: depth.createView() }, { binding: 1, resource: ao.createView() }] })];
        const encoder = d.createCommandEncoder();
        const pass = encoder.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: depth.createView(), depthLoadOp: "clear", depthStoreOp: "store", depthClearValue: 1 } });
        pass.setPipeline(depthPipeline); pass.draw(3); pass.end();
        render(encoder,pipeline,aoDst,groups); d.queue.submit([encoder.finish()]);
        const filtered = await read(aoDst,1);
        check(filtered[3 + 8 * 4] < 5 && filtered[4 + 8 * 4] > 250, "AO blurred across a depth edge");
        return { flatColour: flat[0], fxaaSmoothedPixels: edges.filter(v => v > 10 && v < 245).length,
            aoDepthEdge: [filtered[35], filtered[36]] };
    } finally { owned.forEach(resource => resource.destroy()); }
}

// Render a small projectile mesh through the live pipelines and compare its screen bounds with WebGL.
async function dismissWelcome(cdp) {
    const result = await cdp.send("Runtime.evaluate", { expression: `(() => {
        const client = window.osrsClient;
        if (client.widgetManager.rootInterface !== 378) return false;
        // WelcomeScreen.plugin.js registers the Play button at 378:72.
        const widget = client.widgetManager.getWidgetByUid((378 << 16) | 72);
        if (!widget) throw new Error("welcome Play widget missing");
        client.handleWidgetAction({ widget, option: "Play", opIndex: 1, source: "primary" });
        return true;
    })()`, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    if (result.result.value) {
        await sleep(1000);
        const root = await cdp.send("Runtime.evaluate", {
            expression: "window.osrsClient.widgetManager.rootInterface", returnByValue: true,
        });
        assert.notEqual(root.result.value, 378, "welcome screen must close before visual checks");
    }
}

async function checkHdOptimisations(cdp) {
    const evaluate = async (expression) => {
        const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
        return result.result.value;
    };
    const original = await evaluate("({ distance: window.osrsClient.renderDistance, lod: window.osrsClient.lodDistance })");
    try {
        for (const distance of [25, 90, 160]) {
            await evaluate(`window.osrsClient.renderDistance = ${distance}; window.osrsClient.lodDistance = ${original.lod}`);
            await sleep(4000);
            const state = await evaluate(`(() => {
                const r = window.__WEBGPU_RENDERER__, context = r.frameScenery, roof = r.getRoofPlaneLimit();
                let legacyCalls = 0, legacyIndices = 0, calls = 0, indices = 0, farCalls = 0, far = false;
                const farGroups = new Set();
                for (const map of r.mapManager.visibleMaps) {
                    for (const batch of [...map.opaqueBatches, ...map.alphaBatches]) {
                        if (batch.lod) { farGroups.add(batch.bindGroup); continue; }
                        batch.ranges.forEach((range, i) => {
                            if (range[1] > 0 && range[2] > 0 && (!batch.planes || batch.planes[i] <= roof)) {
                                legacyCalls++; legacyIndices += range[1] * range[2];
                            }
                        });
                    }
                }
                const pass = { setPipeline() {}, setVertexBuffer() {}, setIndexBuffer() {},
                    setBindGroup(group, binding) { if (group === 3) far = farGroups.has(binding); },
                    drawIndexed(count, instances) { calls++; indices += count * instances; if (far) farCalls++; } };
                for (const map of r.mapManager.visibleMaps) {
                    map.drawOpaque(pass, roof, context); map.drawAlpha(pass, roof, context);
                }
                return { configuredDistance: r.osrsClient.renderDistance, detailRadius: context.lodDistance, fogEnd: r.world.sceneData[60],
                    loadedMaps: r.mapManager.mapSquares.size, legacyCalls, calls, legacyIndices, indices, farCalls };
            })()`);
            assert.ok(state.calls > 0 && state.calls < state.legacyCalls, "scenery culling/batching must reduce draw calls");
            assert.ok(state.indices < state.legacyIndices, "fog/frustum/LOD must reduce submitted geometry");
            if (distance > 25) assert.ok(state.farCalls > 0, "far scenery must actually draw");
            if (distance === 160) assert.ok(state.fogEnd > 90, "HD long views must not retain the old 90-tile cap");
            console.log(`[webgpu-smoke] HD scenery ${distance}: ${JSON.stringify(state)}`);
            await captureScreenshot(cdp, `hd-optimisations-${distance}.png`);
        }
        const shadow = await evaluate(`(async () => {
            const r = window.__WEBGPU_RENDERER__, ext = r.world.extension;
            const world = r.drawWorldDepth, actor = r.drawActorDepth;
            let worldPasses = 0, actorPasses = 0;
            r.drawWorldDepth = function(...args) { worldPasses++; return world.apply(this, args); };
            r.drawActorDepth = function(...args) { actorPasses++; return actor.apply(this, args); };
            try {
                await new Promise(resolve => setTimeout(resolve, 1000));
                if (!worldPasses || actorPasses <= worldPasses) throw new Error("world shadow cache was not reused");
                const invalidations = [];
                for (const [field, value] of [["x", ext.lastShadow.x - 3], ["plane", 99], ["distance", -1], ["roof", -1], ["environment", null]]) {
                    const previous = ext.lastShadow; previous.time = performance.now(); previous[field] = value;
                    await new Promise(resolve => requestAnimationFrame(resolve));
                    if (ext.lastShadow === previous) throw new Error("shadow did not invalidate on " + field);
                    invalidations.push(field);
                }
                return { worldPasses, actorPasses, invalidations };
            } finally { r.drawWorldDepth = world; r.drawActorDepth = actor; }
        })()`);
        console.log(`[webgpu-smoke] HD shadow cache: ${JSON.stringify(shadow)}`);
    } finally {
        await evaluate(`window.osrsClient.renderDistance = ${original.distance}; window.osrsClient.lodDistance = ${original.lod}`);
    }
}

async function projectileRotationGpuPixels() {
    const r = window.__WEBGPU_RENDERER__, d = r.device, actors = r.actors;
    const owned = [];
    const buffer = (data, usage) => {
        const b = d.createBuffer({ size: data.byteLength, usage: usage | GPUBufferUsage.COPY_DST });
        d.queue.writeBuffer(b, 0, data); owned.push(b); return b;
    };
    const texture = (format, size, usage) => {
        const t = d.createTexture({ format, size, usage }); owned.push(t); return t;
    };
    const vertices = [[-32,-16,-64], [32,-16,-64], [32,16,64], [-32,16,64]];
    // The same signed position / HSL / alpha words that SceneBuffer emits.
    const words = new Uint32Array(vertices.flatMap(([x,y,z]) => [
        (x + 0x4000) << 17, (-y + 0x4000) | (100 << 15), ((z + 0x4000) << 17) | (255 << 9),
    ]));
    const vertexBuffer = buffer(words, GPUBufferUsage.VERTEX);
    const indexBuffer = buffer(new Uint32Array([0,1,2,0,2,3]), GPUBufferUsage.INDEX);
    const identity = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
    const scene = new Float32Array(68);
    scene.set(identity); scene.set(identity,16);
    // Orthographic view from above: screen X = world X, screen Y = world Z.
    scene.set([1,0,0,0, 0,0,0.05,0, 0,1,0,0, 0,0,0,1],32);
    scene.set([-1,-1,-1,0],52); scene[60]=90; scene[61]=90; scene[62]=10; scene[63]=0.8;
    const sceneBuffer = buffer(scene, GPUBufferUsage.UNIFORM);
    const uniform = new Float32Array(32); uniform[2]=-1; new DataView(uniform.buffer).setInt32(40,-1,true); uniform.set(identity,16);
    const uniformBuffer = buffer(uniform,GPUBufferUsage.UNIFORM);
    const height = texture("r16sint",[1,1,1],GPUTextureUsage.TEXTURE_BINDING);
    const data = texture("rgba16uint",[16,1],GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST);
    const depth = texture("depth32float",[64,64],GPUTextureUsage.RENDER_ATTACHMENT);
    const results = [];
    try {
        const base = actors.pipelines.get("projectile")[0];
        for (const mode of ["base", "extended"]) {
            const pipeline = mode === "base" ? base : actors.variants.get(base).extended;
            const format = mode === "base" ? r.format : r.world.extension.sceneColorFormat;
            const bytesPerPixel = format === "rgba16float" ? 8 : 4;
            const target = texture(format,[64,64],GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC);
            const groups = [
                d.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding:0,resource:{buffer:sceneBuffer} }] }),
                mode === "base" ? r.world.worldTextureBindGroup : r.world.extensionTextureBindGroup,
                d.createBindGroup({ layout: pipeline.getBindGroupLayout(2), entries: [{ binding:0,resource:{buffer:uniformBuffer} },{ binding:1,resource:height.createView({dimension:"2d-array"}) }] }),
                d.createBindGroup({ layout: pipeline.getBindGroupLayout(3), entries: [{ binding:0,resource:data.createView() },{ binding:1,resource:actors.actorData.poseTexture.createView() }] }),
            ];
            for (const [yaw,pitch,roll] of [[0,0,0],[0,256,0],[0,1792,0],[512,256,0],[1536,1792,768]]) {
                const packed = new Uint16Array(64);
                const shifted = pitch >> 4;
                packed[2]=(yaw << 2) | ((shifted >> 4) << 13);
                packed[3]=10 | ((shifted & 15) << 9) | ((roll >> 8) << 13);
                d.queue.writeTexture({ texture:data },packed,{bytesPerRow:128},[16,1]);
                const readback = d.createBuffer({ size:64*512,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ }); owned.push(readback);
                const encoder = d.createCommandEncoder();
                const pass = encoder.beginRenderPass({ colorAttachments:[{view:target.createView(),loadOp:"clear",storeOp:"store",clearValue:{r:0,g:0,b:0,a:0}}],
                    depthStencilAttachment:{view:depth.createView(),depthLoadOp:"clear",depthStoreOp:"store",depthClearValue:1} });
                pass.setPipeline(pipeline);
                groups.forEach((group,i)=>pass.setBindGroup(i,group,i===2?[0]:[]));
                pass.setVertexBuffer(0,vertexBuffer); pass.setIndexBuffer(indexBuffer,"uint32"); pass.drawIndexed(6); pass.end();
                encoder.copyTextureToBuffer({texture:target},{buffer:readback,bytesPerRow:512},[64,64]);
                d.queue.submit([encoder.finish()]); await readback.mapAsync(GPUMapMode.READ);
                const pixels = new Uint8Array(readback.getMappedRange());
                const bounds = [64,64,-1,-1];
                for (let y=0;y<64;y++) for(let x=0;x<64;x++) {
                    const alphaByte = bytesPerPixel === 8 ? 7 : 3;
                    if (pixels[y*512+x*bytesPerPixel+alphaByte]) {
                        bounds[0]=Math.min(bounds[0],x); bounds[1]=Math.min(bounds[1],y);
                        bounds[2]=Math.max(bounds[2],x); bounds[3]=Math.max(bounds[3],y);
                    }
                }
                readback.unmap();
                const points = vertices.map(([x,y,z])=> {
                    // projectile.vert.glsl's row-vector roll -> pitch -> yaw.
                    const angle = value=>value*0.00306796157;
                    let c=Math.cos(angle(roll)),s=Math.sin(angle(roll)); [x,y]=[x*c-y*s,x*s+y*c];
                    c=Math.cos(angle(pitch));s=Math.sin(angle(pitch));[y,z]=[y*c-z*s,y*s+z*c];
                    c=Math.cos(angle(yaw));s=Math.sin(angle(yaw));[x,z]=[x*c+z*s,-x*s+z*c];
                    return [(x/128+1)*32,(1-z/128)*32];
                });
                const expected = [Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];
                if (bounds.some((v,i)=>Math.abs(v-expected[i])>2)) throw new Error(`projectile ${mode} yaw/pitch/roll ${[yaw,pitch,roll]} bounds ${bounds} != WebGL ${expected}`);
                results.push({mode,yaw,pitch,roll,bounds});
            }
        }
        return results;
    } finally { owned.forEach(resource=>resource.destroy()); }
}

async function captureScreenshot(cdp, name = process.env.SMOKE_SCREENSHOT || "webgpu-smoke.png") {
    const artifactsDir = path.join(__dirname, "artifacts");
    fs.mkdirSync(artifactsDir, { recursive: true });
    const file = path.isAbsolute(name) ? name : path.join(artifactsDir, name);
    try {
        const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
        fs.writeFileSync(file, Buffer.from(data, "base64"));
        console.log(`[webgpu-smoke] screenshot: ${file}`);
    } catch (error) {
        throw new Error(`screenshot failed: ${error.message}`);
    }
}

function killChrome(chrome) {
    try {
        process.kill(-chrome.pid, "SIGKILL");
    } catch {
        try {
            chrome.kill("SIGKILL");
        } catch {}
    }
}

function removeDir(dir) {
    try {
        fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
