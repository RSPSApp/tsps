import { strict as assert } from "node:assert";
import { GameStateChanged, StatChanged } from "@runelite/api/events";
import { GameState } from "@runelite/api/GameState";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { inject } from "@runelite/client/plugins/PluginInjector";
import { onConfigurationRequest, openConfiguration, takePendingConfiguration } from "@runelite/client/plugins/config/configurationRequests";
import { OverlayRenderer } from "@runelite/client/ui/overlay/OverlayRenderer";
import { XpGlobesConfig } from "../game/plugins/xpglobes/XpGlobesConfig";
import { XpGlobesPlugin } from "../game/plugins/xpglobes/XpGlobesPlugin";
import {
    MAXIMUM_SHOWN_GLOBES,
    XpGlobes,
    arcPoints,
    formatXp,
    levelGoals,
    skillProgress,
    tooltipLines,
} from "../game/plugins/xpglobes/xpGlobes";
import { XpTrackerPlugin } from "../game/plugins/xptracker/XpTrackerPlugin";
import { SkillId, getXpForLevel } from "../rs/skill/skills";

const opts = { hideMaxed: false, showVirtualLevel: false };

// --- Globe rules ---------------------------------------------------------------------------------
const g = new XpGlobes();
g.onStatChanged(SkillId.Woodcutting, 100, 2, 0, opts);
assert.deepEqual(g.globes, [], "the first value (login sync) only fills the cache");
g.onStatChanged(SkillId.Woodcutting, 100, 2, 1, opts);
g.onStatChanged(SkillId.Woodcutting, 90, 2, 2, opts);
assert.deepEqual(g.globes, [], "no gain (a boost or drain): no globe");
g.onStatChanged(SkillId.Woodcutting, 125, 2, 3, opts);
assert.equal(g.globes.length, 1);
assert.equal(g.globes[0].currentXp, 125);
for (const skill of [SkillId.Attack, SkillId.Defence, SkillId.Strength, SkillId.Hitpoints, SkillId.Magic, SkillId.Fishing]) {
    g.onStatChanged(skill, 0, 1, 10 + skill, opts);
    g.onStatChanged(skill, 10, 1, 20 + skill, opts);
}
assert.equal(g.globes.length, MAXIMUM_SHOWN_GLOBES, "five at most");
assert.ok(!g.globes.some((x) => x.skill === SkillId.Woodcutting), "the oldest left");
assert.deepEqual(g.globes.map((x) => x.skill), [...g.globes.map((x) => x.skill)].sort((a, b) => a - b), "ordered by skill");
g.expire(26 * 1000 + 30, 0);
g.expire(20 + SkillId.Strength + 10_000, 10);
assert.ok(g.globes.every((x) => x.time >= 20 + SkillId.Strength), "older than the duration expire");
g.reset();
assert.deepEqual(g.globes, []);

// Maxed skills: hidden, or the virtual level.
const maxed = new XpGlobes();
maxed.onStatChanged(SkillId.Cooking, 14_000_000, 99, 0, { hideMaxed: true, showVirtualLevel: false });
maxed.onStatChanged(SkillId.Cooking, 14_000_100, 99, 1, { hideMaxed: true, showVirtualLevel: false });
assert.deepEqual(maxed.globes, []);
maxed.onStatChanged(SkillId.Cooking, 14_500_000, 99, 0, { hideMaxed: false, showVirtualLevel: true });
maxed.onStatChanged(SkillId.Cooking, 14_500_100, 99, 1, { hideMaxed: false, showVirtualLevel: true });
assert.equal(maxed.globes[0].currentLevel, 100, "virtual level 100 at 14.5M");

// Progress, arc, goals, numbers.
assert.equal(skillProgress(100, 150, 200), 50);
assert.deepEqual(levelGoals(100), { start: getXpForLevel(2), end: getXpForLevel(3) });
const arc = arcPoints(0, 0, 10, 90, -90);
assert.deepEqual(arc[0].map(Math.round), [0, -10], "starts at 12 o'clock (screen y down)");
assert.deepEqual(arc[arc.length - 1].map(Math.round), [10, 0], "clockwise to 3 o'clock");
assert.equal(formatXp(1234567), "1,234,567");

// Tooltip lines, with and without the XP Tracker.
const globe = { skill: SkillId.Fishing, currentXp: 500, currentLevel: 5, time: 0 };
const all = { showActionsLeft: true, showXpLeft: true, showXpHour: true, showTimeTilGoal: true };
assert.deepEqual(tooltipLines(globe, 600, { actionsLeft: 4, xpHr: 3000, timeTilGoal: "02:00" }, all).map((l) => `${l.left} ${l.right}`),
    ["Fishing 5", "Current XP: 500", "Actions left: 4", "XP left: 100", "XP per hour: 3,000", "Time left: 02:00"]);
assert.deepEqual(tooltipLines(globe, 600, { actionsLeft: 2147483647, xpHr: 0, timeTilGoal: "∞" }, all).map((l) => l.left),
    ["Fishing", "Current XP:", "XP left:", "Time left:"], "N/A actions and 0 XP/hr are left out");
assert.deepEqual(tooltipLines(globe, 600, undefined, all).map((l) => l.left), ["Fishing", "Current XP:", "XP left:"],
    "no XP Tracker: no tracker lines");
assert.deepEqual(tooltipLines(globe, 500, undefined, all).map((l) => l.left), ["Fishing", "Current XP:"], "goal reached");

// --- Plugin and overlay ------------------------------------------------------------------------
async function main(): Promise<void> {
    // An unavailable Configuration plugin must not leave a surprise request for its next start.
    openConfiguration(XpGlobesPlugin);
    assert.equal(takePendingConfiguration(), undefined, "no listener: nothing is queued");
    const openPanel = onConfigurationRequest(() => {});
    openConfiguration(XpGlobesPlugin);
    assert.equal(takePendingConfiguration(), XpGlobesPlugin, "an active plugin defers until its panel mounts");
    assert.equal(takePendingConfiguration(), undefined, "a deferred request is consumed once");
    openConfiguration(XpGlobesPlugin);
    openPanel();
    const restarted = onConfigurationRequest(() => {});
    assert.equal(takePendingConfiguration(), undefined, "shutdown discards an unconsumed request");
    const panel = onConfigurationRequest(() => takePendingConfiguration());
    openConfiguration(XpGlobesPlugin);
    assert.equal(takePendingConfiguration(), undefined, "a mounted panel consumes the request immediately");
    panel();
    openConfiguration(XpGlobesPlugin);
    assert.equal(takePendingConfiguration(), XpGlobesPlugin, "closing only the panel still permits deferred opening");
    restarted();

    const config = inject(ConfigManager);
    const client: any = { gameState: 30, inputManager: { mouseX: -1, mouseY: -1 } };
    const plugin = new XpGlobesPlugin(client);
    let clock = 1000;
    plugin.now = () => clock;
    await plugin.start();
    const stat = (skill: SkillId, xp: number) => plugin.onStatChanged(new StatChanged(skill, xp, 3, 3));
    stat(SkillId.Firemaking, 100);
    assert.equal(plugin.widgetOverlay.signature(), "", "nothing until a gain");
    stat(SkillId.Firemaking, 140);
    assert.notEqual(plugin.widgetOverlay.signature(), "");

    const calls: string[] = [];
    const renderer: any = {
        width: 1000,
        drawPolygon: (pts: unknown[], c: number[]) => calls.push(`fill ${pts.length} ${c[3].toFixed(2)}`),
        drawPolyline: (pts: unknown[], w: number, _c: unknown, closed: boolean) => calls.push(`line ${w} ${closed}`),
        drawTexture: () => calls.push("icon"),
        drawRect: () => calls.push("rect"),
    };
    let placed: any;
    const context: any = {
        renderer,
        fontLoader: () => undefined,
        sprite: () => ({ tex: {}, w: 25, h: 25 }),
        place: (_o: unknown, w: number, h: number) => ((placed = { w, h }), { x: 100, y: 10, scaleX: 1, scaleY: 1 }),
    };
    plugin.widgetOverlay.draw(context);
    assert.deepEqual(calls, ["fill 60 0.50", "icon", "line 5 true", "line 2 false"], "background, icon, ring, progress arc");
    assert.deepEqual(placed, { w: 43, h: 46 }, "RuneLite: n * (size + overhang) + 10 * (n - 1) long, size + 2 overhangs high");

    // #1612: a started globe still disappeared on mobile: the real overlay placer
    // did not recognise toplevel_osm, so it never supplied a draw position.
    const mobileScale = 1.6;
    const mobileWidgets = new Map([
        [1, { _absX: 0, _absY: 0, _absWidth: 1136, _absHeight: 640, width: 710, height: 400 }],
        [26, { _absX: 0, _absY: 0, _absWidth: 1136, _absHeight: 640 }],
        [49, { _absX: 0, _absY: 480, _absWidth: 830, _absHeight: 160 }],
    ]);
    client.widgetManager = {
        rootInterface: 601,
        getWidgetByUid: (uid: number) => (uid >>> 16) === 601 ? mobileWidgets.get(uid & 0xffff) : undefined,
        isEffectivelyHidden: () => false,
    };
    const mobileOverlays = new OverlayRenderer(client, config);
    const desktopPlace = context.place;
    let mobilePlace: any;
    context.place = (overlay: any, w: number, h: number) =>
        mobilePlace = mobileOverlays.placeOverlay(overlay, w, h, { w: 1136, h: 640 });
    calls.length = 0;
    const mobileRects = plugin.widgetOverlay.draw(context);
    assert.equal(mobileRects.length, 1, "mobile XP globes reach the actual overlay placement and draw path");
    assert.deepEqual(calls, ["fill 60 0.50", "icon", "line 8 true", "line 3.2 false"]);
    assert.equal(mobilePlace.scaleX, mobileScale, "mobile globes use the rendered viewport scale");
    assert.ok(mobileRects[0].x >= 0 && mobileRects[0].y >= 0 &&
        mobileRects[0].x + mobileRects[0].w <= 1136 && mobileRects[0].y + mobileRects[0].h <= 640,
        "the globe remains inside a narrow phone viewport");
    context.place = desktopPlace;

    // A second globe: a row, 10 px apart; flipped, a column.
    stat(SkillId.Cooking, 50);
    stat(SkillId.Cooking, 60);
    plugin.widgetOverlay.draw(context);
    assert.deepEqual(placed, { w: 2 * (40 + 3) + 10, h: 46 });
    plugin.flip();
    plugin.widgetOverlay.draw(context);
    assert.deepEqual(placed, { w: 46, h: 2 * (40 + 3) + 10 });
    plugin.flip();

    // Hover: dark overlay and a tooltip; the globe stays while hovered.
    client.inputManager.mouseX = 100 + 3 + 20;
    client.inputManager.mouseY = 10 + 3 + 20;
    calls.length = 0;
    clock = 50_000;
    plugin.widgetOverlay.signature();
    plugin.widgetOverlay.draw(context);
    assert.ok(calls.includes("fill 60 0.71"), "the dark hover overlay");
    assert.ok(calls.filter((c) => c === "rect").length >= 5, "tooltip panel and outline");
    plugin.removeExpiredXpGlobes();
    assert.deepEqual(plugin.globes.globes.map((x) => x.skill), [SkillId.Cooking], "the hovered (first, by skill order) globe stays; Firemaking expired");
    clock = 70_000;
    client.inputManager.mouseX = -1;
    plugin.removeExpiredXpGlobes();
    assert.equal(plugin.globes.globes.length, 0, "all expire after 10 s");

    // Overlay menu: Flip and Configure.
    const entries = plugin.widgetOverlay.menuEntries();
    assert.deepEqual(entries.map((e) => `${e.option} ${e.target}`), ["Configure XP Globes overlay", "Flip XP Globes overlay"]);
    let requested: unknown;
    const off = onConfigurationRequest((c) => (requested = c));
    entries[0].onClick();
    assert.equal(requested, XpGlobesPlugin, "Configure opens the plugin's settings");
    off();
    entries[1].onClick();
    assert.equal(config.getConfiguration("xpglobes", "alignOrbsVertically"), "true");
    entries[1].onClick();

    // Logging in or hopping clears everything; logged out draws nothing.
    stat(SkillId.Firemaking, 200);
    plugin.onGameStateChanged(new GameStateChanged(GameState.HOPPING));
    assert.deepEqual(plugin.globes.globes, []);
    client.gameState = 10;
    assert.equal(plugin.widgetOverlay.signature(), "");
    await plugin.stop();

    // Core: overlay menu entries show only over the overlay.
    const overlays = new OverlayRenderer({ inputManager: {} } as any, config);
    const overlay: any = { menuEntries: () => [{ option: "Flip", target: "Test overlay", onClick() {} }] };
    (overlays as any).drawn = [{ overlay, bounds: { x: 0, y: 0, w: 50, h: 50 } }];
    (overlays as any).mouseX = 10;
    (overlays as any).mouseY = 10;
    const menu = overlays.transformMenuEntries([{ option: "Walk here", target: "" }], { surface: "world", menu: true });
    assert.deepEqual(menu.map((e) => e.option), ["Flip", "Walk here"]);
    assert.equal(menu[0].deprioritized, true);
    (overlays as any).mouseX = 80;
    assert.equal(overlays.transformMenuEntries([{ option: "Walk here", target: "" }], { surface: "world", menu: true }).length, 1);

    // Core: the XP Tracker's service accessors.
    const tracker = new XpTrackerPlugin({ gameState: 30, localPlayerName: "G", varManager: { getVarp: () => 0 } } as any);
    await tracker.start();
    assert.equal(tracker.getActionsLeft(SkillId.Attack), 2147483647);
    assert.equal(tracker.getXpHr(SkillId.Attack), 0);
    assert.equal(tracker.getTimeTilGoal(SkillId.Attack), "∞");
    await tracker.stop();
    void XpGlobesConfig;
}

main()
    .then(() => console.log("xp globes tests passed"))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
