import { strict as assert } from "node:assert";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { GameStateChanged, GameTick, PluginMessage } from "@runelite/api/events";
import { GameState } from "@runelite/api/GameState";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { EventBus } from "@runelite/client/eventbus/EventBus";
import { PluginManager } from "@runelite/client/plugins/PluginManager";
import { CLIENT_TOKEN } from "@runelite/client/plugins/PluginInjector";
import { ClientToolbar } from "@runelite/client/ui/ClientToolbar";
import { parsePluginMessage } from "../common/network/PluginMessage";
import { ClientPluginManager } from "../game/plugins/ClientPluginManager";
import { BugReportPanel } from "../game/plugins/bugreport/BugReportPanel";
import { BugReportPlugin } from "../game/plugins/bugreport/BugReportPlugin";
import {
    BUG_REPORT_CHANNEL,
    BugReportUpload,
    CHUNK_CHARS,
    encodeReport,
} from "../game/plugins/bugreport/BugReportUpload";
import { ClientLogBuffer, LOG_WINDOW_MS, captureConsole, formatLogArgs } from "../game/plugins/bugreport/ClientLogBuffer";
import { encodeClientMessage } from "../network/packet/ClientBinaryEncoder";
import { sendChat } from "../network/serverConnection/outgoing/inventoryChat";
import { state } from "../network/serverConnection/state";

/** Microtasks and a few timer turns: Blob.arrayBuffer() resolves on a later turn. */
const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};
const decode = (chunks: string[]): unknown =>
    JSON.parse(Buffer.from(chunks.join(""), "base64").toString("utf8"));

function testLogBuffer(): void {
    let now = 1_000_000;
    const buffer = new ClientLogBuffer(() => now, LOG_WINDOW_MS, { entries: 3, chars: 10 }, { entries: 2, chars: 100 });
    const texts = (): string[] => buffer.recent().map((entry) => entry.text);
    const add = (level: "log" | "warn" | "error", text: string): void => {
        now++;
        buffer.add(level, [text]);
    };
    add("log", "old");
    now += LOG_WINDOW_MS;
    add("warn", "kept");
    assert.deepEqual(texts(), ["kept"], "lines older than 5 minutes go");
    for (const text of ["a", "b", "c", "d"]) add("log", text);
    assert.deepEqual(texts(), ["kept", "b", "c", "d"], "chatter keeps its newest and never pushes out a warning");
    add("log", "eeeeeeeee");
    assert.deepEqual(texts(), ["kept", "d", "eeeeeeeee"], "and stays within its character budget");
    add("error", "x");
    add("error", "y");
    assert.deepEqual(texts(), ["d", "eeeeeeeee", "x", "y"], "warnings and errors have a cap of their own");

    assert.equal(formatLogArgs(["%c[gpu]%c ready", "color: red", "color: blue", { fps: 60 }]), "[gpu] ready {fps: 60}");
    assert.equal(formatLogArgs([new Map([[1, 2]]), new Uint8Array(4), [1, [2, [3, [4]]]]]), "Map(1) Uint8Array(4) [1, [2, Array(2)]]");
    const error = new Error("boom");
    assert.ok(formatLogArgs(["failed", error]).startsWith("failed Error: boom"), "errors keep their stack");
    assert.equal(formatLogArgs(["x".repeat(5000)]).length, 2000, "a line is at most 2,000 characters");
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i]));
    assert.ok(formatLogArgs([many]).endsWith("… 10 more}"));
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    assert.equal(formatLogArgs([cyclic]), "{self: {self: {Object}}}", "cycles end at the depth limit");

    // The console keeps working, the buffer gets a copy, and restoring puts the original back.
    const printed: unknown[][] = [];
    const target = {
        debug: (...args: unknown[]) => printed.push(args),
        log: (...args: unknown[]) => printed.push(args),
        info: (...args: unknown[]) => printed.push(args),
        warn: (...args: unknown[]) => printed.push(args),
        error: (...args: unknown[]) => printed.push(args),
    };
    const original = target.warn;
    const listeners = new Map<string, (event: Event) => void>();
    const events = {
        addEventListener: (type: string, listener: (event: Event) => void) => listeners.set(type, listener),
        removeEventListener: (type: string) => listeners.delete(type),
    } as unknown as EventTarget;
    const captured = new ClientLogBuffer(() => now);
    const restore = captureConsole(captured, target, events);
    target.warn("[cache] slow", 3);
    listeners.get("error")?.({ error: new TypeError("bad read"), message: "bad read" } as unknown as Event);
    listeners.get("unhandledrejection")?.({ reason: "lost socket" } as unknown as Event);
    assert.deepEqual(printed, [["[cache] slow", 3]]);
    assert.deepEqual(captured.recent().map((entry) => entry.level), ["warn", "error", "error"]);
    assert.ok(captured.recent()[1].text.startsWith("Uncaught TypeError: bad read"));
    assert.equal(captured.recent()[2].text, "Unhandled rejection lost socket");
    restore();
    assert.equal(target.warn, original);
    assert.equal(listeners.size, 0);

    // What the player typed never reaches a report: sendChat logs a message twice, and name and
    // text dialogs log their input. The lines stay without the text; a count stays as it is.
    const typed = new ClientLogBuffer(() => now);
    const quietLog = console.log;
    console.log = () => {};
    const restoreConsole = captureConsole(typed, console as unknown as Parameters<typeof captureConsole>[1], undefined);
    const socket = state.socket;
    state.socket = { readyState: 1, send() {} } as any;
    try {
        sendChat("meet me at the bank");
        sendChat("/clan secret", "friends_chat", 2);
    } finally {
        state.socket = socket;
        restoreConsole();
        console.log = quietLog;
    }
    typed.add("log", ['[InputDialog] String dialog submitted: "hunter2"']);
    typed.add("log", ['[InputDialog] Name dialog submitted: "Zezima"']);
    typed.add("log", ["[InputDialog] Complete: type=string, value=hunter2"]);
    typed.add("log", ["[InputDialog] Complete: type=count, value=28"]);
    const lines = typed.recent().map((entry) => entry.text);
    assert.deepEqual(lines, [
        "[sendChat] Attempting to send: (text left out)",
        "[sendChat] Sending to server: (text left out)",
        "[sendChat] Attempting to send: (text left out)",
        "[sendChat] Sending to server: (text left out)",
        "[InputDialog] String dialog submitted: (text left out)",
        "[InputDialog] Name dialog submitted: (text left out)",
        "[InputDialog] Complete: type=string, value=(text left out)",
        "[InputDialog] Complete: type=count, value=28",
    ]);
    assert.ok(!/bank|secret|hunter2|Zezima/i.test(lines.join("\n")), "no typed text is kept");
}

async function testUpload(): Promise<void> {
    const report = { description: "Héllo 🐛", screenshot: `data:image/jpeg;base64,${"A".repeat(40_000)}` };
    const chunks = encodeReport(report);
    assert.equal(chunks.length, 4);
    assert.ok(chunks.slice(0, -1).every((chunk) => chunk.length === CHUNK_CHARS));
    assert.deepEqual(decode(chunks), report, "the chunks join back into the report");
    const message = { channel: BUG_REPORT_CHANNEL, data: { type: "chunk", id: crypto.randomUUID(), index: 199, data: chunks[0] } };
    assert.doesNotThrow(() => encodeClientMessage({ type: "plugin_message", payload: message }), "a full chunk fits a plugin message");

    // ready, the chunks, end; a missing chunk is sent again, then the server's answer.
    const sent: Record<string, unknown>[] = [];
    let upload: BugReportUpload;
    const server = (data: Record<string, unknown>): void => {
        sent.push(data);
        if (data.type === "begin") queueMicrotask(() => upload.handle({ type: "ready", id: data.id as string }));
        const ends = sent.filter((entry) => entry.type === "end").length;
        if (data.type === "end" && ends === 1) {
            queueMicrotask(() => upload.handle({ type: "missing", id: data.id as string, chunks: [2] }));
        }
        if (data.type === "end" && ends === 2) {
            queueMicrotask(() => upload.handle({ type: "sent", id: data.id as string, issueUrl: "https://github.com/o/r/issues/7", issueNumber: 7 }));
        }
    };
    const sleeps: number[] = [];
    upload = new BugReportUpload(server, async (ms) => void sleeps.push(ms));
    const progress: number[] = [];
    const result = await upload.upload("report-1", chunks, (share) => progress.push(share));
    assert.deepEqual(result, { issueUrl: "https://github.com/o/r/issues/7", issueNumber: 7 });
    assert.deepEqual(sent.map((data) => data.type), ["begin", "chunk", "chunk", "chunk", "chunk", "end", "chunk", "end"]);
    assert.deepEqual(sent[0], { type: "begin", id: "report-1", chunks: 4, chars: chunks.join("").length });
    assert.equal(sent[6].index, 2, "only the missing chunk is sent again");
    assert.deepEqual(progress, [0.25, 0.5, 0.75, 1]);

    // Bursts of ten chunks, 250 ms apart: 40 a second.
    const many = Array.from({ length: 25 }, () => "QUJD");
    const paced = new BugReportUpload((data) => {
        if (data.type === "begin") queueMicrotask(() => paced.handle({ type: "ready", id: "report-2" }));
        if (data.type === "end") queueMicrotask(() => paced.handle({ type: "sent", id: "report-2" }));
    }, async (ms) => void sleeps.push(ms));
    sleeps.length = 0;
    await paced.upload("report-2", many);
    assert.deepEqual(sleeps, [250, 250]);

    // A refusal carries the server's reason; replies for another report are ignored.
    const refused = new BugReportUpload((data) => {
        if (data.type === "begin") {
            queueMicrotask(() => {
                assert.equal(refused.handle({ type: "rejected", id: "someone-else", reason: "no" }), false);
                refused.handle({ type: "rejected", id: "report-3", reason: "Please wait 42 seconds before sending another report." });
            });
        }
    });
    await assert.rejects(refused.upload("report-3", ["QUJD"]), /Please wait 42 seconds/);
    const cancelled = new BugReportUpload(() => {});
    const pending = cancelled.upload("report-4", ["QUJD"]);
    cancelled.cancel("You were logged out before the report was sent.");
    await assert.rejects(pending, /logged out/);
    await assert.rejects(new BugReportUpload(() => {}).upload("report-5", ["x".repeat(3_000_001)]), /too large/);
}

type FakeCanvas = { width: number; height: number; style: { display?: string }; parentElement?: { children: unknown[] } };

async function testPlugin(): Promise<void> {
    const packets: { channel: string; data: Record<string, unknown> }[] = [];
    Object.assign(globalThis, {
        WebSocket: { OPEN: 1 },
        window: {
            location: { origin: "http://localhost:3105", pathname: "/" },
            innerWidth: 1280,
            innerHeight: 720,
            devicePixelRatio: 2,
            addEventListener() {},
            removeEventListener() {},
        },
    });
    state.socket = { readyState: 1, send: (bytes: Uint8Array) => packets.push(parsePluginMessage(bytes.subarray(3))) } as any;

    // A frame: the scene canvas and the widget overlay canvas beside it, composed into one JPEG.
    class Canvas implements FakeCanvas {
        style: { display?: string } = {};
        parentElement?: { children: unknown[] };
        constructor(public width: number, public height: number) {}
    }
    const drawn: unknown[] = [];
    const frame = {
        width: 0,
        height: 0,
        getContext: () => ({ fillStyle: "", fillRect() {}, drawImage: (layer: unknown) => drawn.push(layer) }),
        toBlob: (done: (blob: Blob) => void, type: string) => done(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type })),
    };
    Object.assign(globalThis, { HTMLCanvasElement: Canvas, document: { createElement: () => frame } });
    const scene = new Canvas(3200, 1800);
    const overlay = new Canvas(1600, 900);
    const hidden = new Canvas(800, 600);
    hidden.style.display = "none";
    scene.parentElement = { children: [scene, overlay, hidden, {}] };

    let loggedIn = true;
    const client = {
        isLoggedIn: () => loggedIn,
        localPlayerName: "Zezima",
        controlledPlayerServerId: 3,
        playerEcs: { getIndexForServerId: () => 0, getX: () => 3222 * 128 + 64, getY: () => 3218 * 128, getLevel: () => 0 },
        inventory: { getSlots: () => [{ slot: 0, itemId: 1351, quantity: 1 }, { slot: 1, itemId: -1, quantity: 0 }] },
        equipment: { getSlots: () => [{ slot: 3, itemId: 1277, quantity: 1 }] },
        objTypeLoader: { load: (id: number) => ({ name: id === 1351 ? "Bronze axe" : "Bronze sword" }) },
        varManager: { values: Int32Array.from([0, 5, 0, -1]) },
        widgetManager: { rootInterface: 161, interfaceParents: new Map([[(161 << 16) | 16, { group: 149, type: 1 }]]) },
        renderer: { type: "webgl", stats: { frameTimeFps: 59.6 } },
        loadedCache: { info: { name: "osrs-241_2026-09-30" } },
        loginState: { serverName: "Local", serverAddress: "localhost:43594", serverTransport: "websocket", password: "hunter2" },
        isMembersWorld: true,
        runeLite: { pluginManager: { getPluginClasses: () => [], getFailure: () => undefined, getEnabledPlugins: () => [] } },
    };
    const bus = new EventBus();
    const manager = new PluginManager(bus, new ConfigManager(bus));
    manager.getInjector().provide(CLIENT_TOKEN, client);
    const toolbar = manager.getInjector().get<ClientToolbar>(ClientToolbar);
    const opened: string[] = [];
    toolbar.onOpenPanel((button) => opened.push(button.tooltip));
    const realConsole = { ...console };
    manager.loadCorePlugins([BugReportPlugin]);
    await flush();
    const plugin = manager.getPlugin(BugReportPlugin)!;
    const engine = new ClientPluginManager();
    engine.add(plugin);
    assert.deepEqual(toolbar.getNavigations().map((button) => button.tooltip), ["Report a Bug"], "always on, with its rail button");

    // ::bug opens the form, prefilled; it asks the world whether it takes reports and takes a screenshot.
    assert.equal(engine.handleClientCommand("bank"), false);
    assert.equal(engine.handleClientCommand("bug The door in Lumbridge won't open"), true);
    assert.deepEqual(opened, ["Report a Bug"]);
    assert.equal(plugin.getState().description, "The door in Lumbridge won't open");
    assert.deepEqual(packets.map((packet) => packet.data), [{ type: "status" }]);
    assert.equal(plugin.getState().capturing, true);
    engine.afterFrame(scene as unknown as HTMLCanvasElement);
    await flush();
    assert.deepEqual(drawn, [scene, overlay], "the scene, then the interface; hidden layers are skipped");
    assert.deepEqual([frame.width, frame.height], [1600, 900], "scaled to fit 1600 × 1200");
    assert.equal(plugin.getState().screenshot, "data:image/jpeg;base64,/9j/4A==");
    plugin.panelOpened();
    assert.equal(packets.length, 1, "one status request while the world hasn't answered");

    // The chatbox Report button's "Report game bug" (op 4) opens it too; Report abuse doesn't.
    const reportButton = { uid: (162 << 16) | 31 };
    assert.equal(engine.handleWidgetAction({ widget: reportButton, option: "Report abuse", opIndex: 2 }), false);
    assert.equal(engine.handleWidgetAction({ widget: { uid: 123 }, option: "Report game bug", opIndex: 4 }), false);
    assert.equal(engine.handleWidgetAction({ widget: reportButton, option: "Report game bug", opIndex: 4 }), true);
    assert.deepEqual(opened, ["Report a Bug", "Report a Bug"]);

    // The form: the notice says what's included and where it goes.
    bus.post(new PluginMessage(BUG_REPORT_CHANNEL, { type: "status", destination: "github.com/RSPSApp/bug-reports" }));
    let html = renderToStaticMarkup(createElement(BugReportPanel, { plugin }));
    assert.ok(html.includes("What went wrong?"));
    assert.ok(html.includes("Diagnostics are included by default"));
    assert.ok(html.includes("Reports are filed as issues on github.com/RSPSApp/bug-reports."));
    assert.ok(html.includes('alt="The screenshot to attach"'));
    assert.ok(!/<button type="submit"[^>]*disabled/.test(html), "a described report can be sent");
    plugin.setDescription("   ");
    html = renderToStaticMarkup(createElement(BugReportPanel, { plugin }));
    assert.ok(/<button type="submit"[^>]*disabled/.test(html), "a report needs a description");
    await plugin.submit();
    assert.equal(packets.length, 1, "nothing is sent without a description");

    // Sending: the report carries the description, screenshot and diagnostics, never the password.
    plugin.setDescription("The door in Lumbridge won't open");
    console.warn("[door] no handler for Open");
    const sending = plugin.submit();
    await flush();
    const begin = packets.at(-1)!.data;
    assert.equal(begin.type, "begin");
    bus.post(new PluginMessage(BUG_REPORT_CHANNEL, { type: "ready", id: begin.id }));
    await flush();
    const chunks = packets.filter((packet) => packet.data.type === "chunk").map((packet) => packet.data.data as string);
    assert.equal(packets.at(-1)!.data.type, "end");
    const report = decode(chunks) as any;
    assert.equal(report.description, "The door in Lumbridge won't open");
    assert.equal(report.screenshot, "data:image/jpeg;base64,/9j/4A==");
    assert.deepEqual(report.diagnostics.player, { name: "Zezima", serverId: 3, position: { x: 3222, y: 3218, plane: 0 } });
    assert.deepEqual(report.diagnostics.inventory, [{ slot: 0, id: 1351, name: "Bronze axe", quantity: 1 }]);
    assert.deepEqual(report.diagnostics.varps, { 1: 5, 3: -1 });
    assert.deepEqual(report.diagnostics.interfaces, { root: 161, mounted: [{ container: (161 << 16) | 16, group: 149, type: 1 }] });
    assert.deepEqual(
        { ...report.diagnostics.client, userAgent: undefined, language: undefined, timeZone: undefined },
        {
            page: "http://localhost:3105/",
            viewport: { width: 1280, height: 720, devicePixelRatio: 2 },
            renderer: "webgl",
            fps: 60,
            mobile: false,
            cache: "osrs-241_2026-09-30",
            userAgent: undefined,
            language: undefined,
            timeZone: undefined,
        },
    );
    assert.equal(report.diagnostics.world.address, "localhost:43594");
    assert.ok(report.diagnostics.logs.some((entry: any) => entry.level === "warn" && entry.text === "[door] no handler for Open"));
    assert.ok(!JSON.stringify(report).includes("hunter2"), "the login state's password never leaves");
    assert.equal(plugin.getState().phase, "sending");
    bus.post(new PluginMessage(BUG_REPORT_CHANNEL, { type: "sent", id: begin.id, issueUrl: "https://github.com/RSPSApp/bug-reports/issues/12", issueNumber: 12 }));
    await sending;
    assert.equal(plugin.getState().phase, "sent");
    html = renderToStaticMarkup(createElement(BugReportPanel, { plugin }));
    assert.ok(html.includes("Thanks for the report!"));
    assert.ok(html.includes('href="https://github.com/RSPSApp/bug-reports/issues/12"'));
    assert.ok(html.includes(">issue #12</a>"));
    assert.ok(html.includes("Report another bug"));

    // Report another bug: a fresh form, with a new screenshot.
    plugin.reset();
    assert.equal(plugin.getState().description, "");
    assert.equal(plugin.getState().phase, "editing");
    assert.equal(plugin.getState().capturing, true);
    engine.afterFrame(scene as unknown as HTMLCanvasElement);
    await flush();

    // Opened again with nothing written, the form takes a new screenshot; a draft keeps its own.
    plugin.panelOpened();
    assert.equal(plugin.getState().capturing, true);
    engine.afterFrame(scene as unknown as HTMLCanvasElement);
    await flush();
    plugin.setDescription("Second bug");
    plugin.panelOpened();
    assert.equal(plugin.getState().capturing, false);

    // Two captures at once: the older gives way, and the form shows capturing until the newer lands.
    const older = plugin.retakeScreenshot();
    const newer = plugin.retakeScreenshot();
    await older;
    assert.equal(plugin.getState().capturing, true);
    engine.afterFrame(scene as unknown as HTMLCanvasElement);
    await newer;
    assert.equal(plugin.getState().capturing, false);
    assert.equal(plugin.getState().screenshot, "data:image/jpeg;base64,/9j/4A==");

    // Without diagnostics only the description and screenshot go; a refusal shows its reason.
    plugin.setIncludeDiagnostics(false);
    assert.ok(renderToStaticMarkup(createElement(BugReportPanel, { plugin })).includes("Only your description and the screenshot are sent."));
    const second = plugin.submit();
    await flush();
    const secondBegin = packets.at(-1)!.data;
    bus.post(new PluginMessage(BUG_REPORT_CHANNEL, { type: "rejected", id: secondBegin.id, reason: "Please wait 30 seconds before sending another report." }));
    await second;
    assert.equal(plugin.getState().phase, "failed");
    html = renderToStaticMarkup(createElement(BugReportPanel, { plugin }));
    assert.ok(html.includes("The report wasn&#x27;t sent: Please wait 30 seconds before sending another report."));

    // A world without the server plugin answers "unavailable"; logged out, nothing can be sent.
    bus.post(new PluginMessage(BUG_REPORT_CHANNEL, { type: "unavailable" }));
    assert.equal(plugin.blockedReason(), "This world doesn't take bug reports.");
    bus.post(new GameStateChanged(GameState.LOGIN_SCREEN));
    loggedIn = false;
    assert.equal(plugin.getState().world, "unknown");
    assert.equal(plugin.blockedReason(), "Log in to send a report.");
    html = renderToStaticMarkup(createElement(BugReportPanel, { plugin }));
    assert.ok(html.includes("Log in to send a report."));
    assert.ok(/<button type="button"[^>]*disabled="">Retake screenshot/.test(html), "nothing to capture logged out");

    // A form left open on the login screen asks the world once the player logs in.
    const statusRequests = (): number => packets.filter((packet) => packet.data.type === "status").length;
    const hide = plugin.panelShown();
    assert.equal(statusRequests(), 1, "nothing to ask while logged out");
    loggedIn = true;
    bus.post(new GameStateChanged(GameState.LOGGED_IN));
    assert.equal(statusRequests(), 2);
    hide();
    bus.post(new GameStateChanged(GameState.LOGIN_SCREEN));
    bus.post(new GameStateChanged(GameState.LOGGED_IN));
    assert.equal(statusRequests(), 2, "with the form closed, logging in sends nothing");

    // Left open through login, the form's picture is the welcome screen ("Click here to play")
    // until the player enters the world, which takes another unless they wrote or retook one.
    const drawFrame = async (): Promise<void> => {
        engine.afterFrame(scene as unknown as HTMLCanvasElement);
        await flush();
    };
    const tick = (rootInterface: number): void => {
        client.widgetManager.rootInterface = rootInterface;
        bus.post(new GameTick());
    };
    const closePanel = plugin.panelShown();
    const entersWorld = async (onWelcomeScreen?: () => unknown): Promise<boolean> => {
        loggedIn = false;
        bus.post(new GameStateChanged(GameState.LOGIN_SCREEN));
        plugin.reset();
        loggedIn = true;
        bus.post(new GameStateChanged(GameState.LOGGED_IN));
        assert.equal(plugin.getState().capturing, true, "logging in takes a picture");
        tick(378);
        await drawFrame();
        void onWelcomeScreen?.();
        await drawFrame();
        tick(378);
        assert.equal(plugin.getState().capturing, false, "the welcome screen is taken once");
        tick(161);
        const retaken = plugin.getState().capturing;
        await drawFrame();
        tick(161);
        assert.equal(plugin.getState().capturing, false, "and the world once");
        return retaken;
    };
    assert.equal(await entersWorld(), true, "nothing written: the world replaces the welcome screen");
    assert.equal(await entersWorld(() => plugin.setDescription("The welcome screen's message is blank")), false,
        "a description keeps the welcome screen");
    assert.equal(await entersWorld(() => plugin.retakeScreenshot()), false, "and so does the player's own retake");
    closePanel();

    await manager.setPluginEnabled(BugReportPlugin, false);
    assert.equal(console.warn, realConsole.warn, "turning the plugin off restores the console");
    state.socket = undefined;
}

async function main(): Promise<void> {
    testLogBuffer();
    await testUpload();
    await testPlugin();
    console.log("bug report plugin tests passed");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
