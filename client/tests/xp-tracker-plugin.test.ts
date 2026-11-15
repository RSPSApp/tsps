import { strict as assert } from "node:assert";
import { GameState } from "@runelite/api/GameState";
import { EVENT_CLASSES, GameStateChanged, StatChanged } from "@runelite/api/events";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { EventBus } from "@runelite/client/eventbus/EventBus";
import { inject } from "@runelite/client/plugins/PluginInjector";
import { ClientPluginManager } from "../game/plugins/ClientPluginManager";
import { MenuSwapperPlugin } from "../game/plugins/menuswapper/MenuSwapperPlugin";
import { XpTrackerConfig } from "../game/plugins/xptracker/XpTrackerConfig";
import {
    MENUOP_ADD_CANVAS_TRACKER,
    MENUOP_REMOVE_CANVAS_TRACKER,
    XpTrackerPlugin,
    xpWorldType,
} from "../game/plugins/xptracker/XpTrackerPlugin";
import { SKILL_IDS, SkillId } from "../rs/skill/skills";
import type { SimpleMenuEntry } from "../ui/menu/MenuEngine";
import { applyMenuTransform, setMenuTransform, type MenuTransformContext } from "../ui/menu/menuTransforms";

const STATS = 320;
const ENGINE_LOGGED_IN = 30;
const ENGINE_LOGIN_SCREEN = 10;

// --- Core: StatChanged is a bus event, bound to on<Name> -----------------------------------
assert.equal(EVENT_CLASSES.StatChanged, StatChanged);
{
    const bus = new EventBus();
    const seen: number[] = [];
    bus.register({ onStatChanged: (e: StatChanged) => seen.push(e.getSkill(), e.getXp(), e.getLevel(), e.getBoostedLevel()) });
    bus.post(new StatChanged(SkillId.Fishing, 1234, 12, 14));
    assert.deepEqual(seen, [SkillId.Fishing, 1234, 12, 14]);
}

// --- Core: a stats-tab skill's opened menu reaches plugins; other widget menus don't -------
{
    const seen: MenuTransformContext[] = [];
    setMenuTransform((entries, context) => {
        seen.push(context);
        return entries;
    });
    const ctx = (group: number, menu: boolean): MenuTransformContext =>
        ({ surface: "widget", menu, widgetId: (group << 16) | 1, childIndex: -1, itemId: -1 });
    applyMenuTransform([{ option: "View", target: "" }], ctx(STATS, true));
    applyMenuTransform([{ option: "View", target: "" }], ctx(STATS, false));
    applyMenuTransform([{ option: "Toggle Run", target: "" }], ctx(160, true));
    assert.deepEqual(seen.map((c) => c.surface === "widget" && c.widgetId >>> 16), [STATS]);
    setMenuTransform(undefined);
    const swapped = new MenuSwapperPlugin().transformMenuEntries([{ option: "View", target: "" }], ctx(STATS, true));
    assert.deepEqual(swapped.map((e) => e.option), ["View"], "Menu Swapper leaves the stats tab alone");
}

// --- Core: plugins may supply several overlays --------------------------------------------
{
    const manager = new ClientPluginManager();
    const a = { signature: () => "a", draw: () => [] };
    const b = { signature: () => "b", draw: () => [] };
    manager.add({ widgetOverlay: a } as any);
    manager.add({ widgetOverlays: () => [b] } as any);
    assert.deepEqual(manager.widgetOverlays(), [a, b]);
}

// --- The plugin ------------------------------------------------------------------------------
const varps = new Map<number, number>();
const client: any = {
    gameState: ENGINE_LOGIN_SCREEN,
    localPlayerName: "Alice",
    varManager: { getVarp: (id: number) => varps.get(id) ?? 0 },
};
const xp = new Map<SkillId, number>(SKILL_IDS.map((s) => [s, 1000]));

async function main(): Promise<void> {
    const config = inject(ConfigManager);
    const plugin = new XpTrackerPlugin(client);
    let clock = 1_000_000;
    plugin.now = () => clock;
    await plugin.start();

    const stat = (skill: SkillId, value: number, level = 10) => {
        xp.set(skill, value);
        plugin.onStatChanged(new StatChanged(skill, value, level, level));
    };
    const login = (name = "Alice") => {
        client.localPlayerName = name;
        plugin.onGameStateChanged(new GameStateChanged(GameState.LOGGING_IN));
        for (const skill of SKILL_IDS) plugin.onStatChanged(new StatChanged(skill, xp.get(skill)!, 10, 10));
        client.gameState = ENGINE_LOGGED_IN;
        plugin.onGameStateChanged(new GameStateChanged(GameState.LOGGED_IN));
        plugin.onGameTick();
        plugin.onGameTick();
    };
    const second = (n = 1) => {
        for (let i = 0; i < n; i++) {
            clock += 1000;
            plugin.tickSkillTimes();
        }
    };

    // The login sync counts no gain; the first real gain adds the skill's box.
    login();
    assert.equal(plugin.getView().overall.gained, 0);
    assert.deepEqual(plugin.getView().skills, []);
    second();
    stat(SkillId.Woodcutting, 1025);
    second(120);
    stat(SkillId.Woodcutting, 1050);
    let view = plugin.getView();
    assert.deepEqual(view.skills.map((s) => s.skill), [SkillId.Woodcutting]);
    assert.equal(view.overall.gained, 50);
    assert.equal(view.skills[0].snapshot.xpGainedInSession, 50);
    assert.equal(view.skills[0].snapshot.actionsInSession, 2);
    assert.ok(view.skills[0].snapshot.xpPerHour > 0);

    // Stat updates during the two login ticks are not gains.
    plugin.onGameStateChanged(new GameStateChanged(GameState.HOPPING));
    stat(SkillId.Fishing, 1500);
    plugin.onGameTick();
    plugin.onGameTick();
    stat(SkillId.Fishing, 1510);
    assert.equal(plugin.xpState.get(SkillId.Fishing)!.totalXpGained, 10, "only the gain after the gate counts");

    // XP-drop goals come from the setup varps.
    varps.set(1243 /* XPDROPS_FISHING_START */, 1000);
    varps.set(1267 /* XPDROPS_FISHING_END */, 2000);
    stat(SkillId.Fishing, 1520);
    assert.equal(plugin.getSkillSnapshot(SkillId.Fishing)!.endGoalXp, 2000);

    // Pause on logout; logging back in resumes. Paused skills accrue no time.
    second();
    plugin.pauseSkill(SkillId.Woodcutting, true);
    assert.ok(plugin.isPaused(SkillId.Woodcutting));
    const before = plugin.xpState.get(SkillId.Woodcutting)!.skillTime;
    second(5);
    assert.equal(plugin.xpState.get(SkillId.Woodcutting)!.skillTime, before, "manual pause");
    stat(SkillId.Woodcutting, 1060);
    second();
    assert.ok(!plugin.isPaused(SkillId.Woodcutting), "a gain unpauses");
    client.gameState = ENGINE_LOGIN_SCREEN;
    second();
    assert.ok(plugin.isPaused(SkillId.Woodcutting), "paused on logout");
    client.gameState = ENGINE_LOGGED_IN;
    second();
    assert.ok(!plugin.isPaused(SkillId.Woodcutting));

    // Auto pause after N idle minutes.
    config.setConfigValue(XpTrackerConfig, "pauseSkillAfter", 1);
    second(61);
    assert.ok(plugin.isPaused(SkillId.Woodcutting), "auto pause");
    config.setConfigValue(XpTrackerConfig, "pauseSkillAfter", 0);
    plugin.pauseAllSkills(false);

    // Stats tab: "Add to canvas" under "View", then "Remove from canvas".
    const statsMenu: MenuTransformContext = { surface: "widget", menu: true, widgetId: (STATS << 16) | 21, childIndex: -1, itemId: -1 };
    const menu: SimpleMenuEntry[] = [{ option: "View <col=ff981f>Woodcutting</col> guide", target: "" }, { option: "Cancel", target: "" }];
    let out = plugin.transformMenuEntries(menu, statsMenu);
    assert.deepEqual(out.map((e) => e.option), ["View <col=ff981f>Woodcutting</col> guide", MENUOP_ADD_CANVAS_TRACKER, "Cancel"]);
    assert.equal(out[1].target, "<col=ff981f>Woodcutting</col>");
    out[1].onClick!();
    assert.ok(plugin.hasOverlay(SkillId.Woodcutting));
    assert.equal(plugin.widgetOverlays().length, 1);
    const overlay = plugin.widgetOverlays()[0];
    assert.equal(overlay.movable?.name, "XpInfoBoxOverlayWoodcutting");
    assert.notEqual(overlay.signature(), "");
    assert.equal(overlay.signature(), overlay.signature(), "stable while nothing changes");
    out = plugin.transformMenuEntries(menu, statsMenu);
    assert.equal(out[1].option, MENUOP_REMOVE_CANVAS_TRACKER);
    config.setConfigValue(XpTrackerConfig, "skillTabOverlayMenuOptions", false);
    assert.equal(plugin.transformMenuEntries(menu, statsMenu), menu, "option off");
    config.setConfigValue(XpTrackerConfig, "skillTabOverlayMenuOptions", true);
    client.gameState = ENGINE_LOGIN_SCREEN;
    assert.deepEqual(plugin.widgetOverlays(), [], "no canvas boxes while logged out");
    client.gameState = ENGINE_LOGGED_IN;

    // Reset/hr keeps the gain; Reset drops the box and its overlay.
    plugin.resetSkillPerHour(SkillId.Woodcutting);
    assert.equal(plugin.getSkillSnapshot(SkillId.Woodcutting)!.xpGainedInSession, 60);
    assert.equal(plugin.getSkillSnapshot(SkillId.Woodcutting)!.xpPerHour, 0);
    plugin.resetSkillState(SkillId.Woodcutting);
    assert.ok(!plugin.getView().skills.some((s) => s.skill === SkillId.Woodcutting));
    assert.ok(!plugin.hasOverlay(SkillId.Woodcutting));

    // Hide maxed skills.
    config.setConfigValue(XpTrackerConfig, "hideMaxed", true);
    stat(SkillId.Fishing, 13_100_000, 99);
    assert.ok(!plugin.getView().skills.some((s) => s.skill === SkillId.Fishing));
    config.setConfigValue(XpTrackerConfig, "hideMaxed", false);

    // Saved per account; restored at the next login with offline gains left out.
    stat(SkillId.Cooking, 1100);
    plugin.saveState();
    const key = "rsprofile.alice.state";
    const saved = JSON.parse(config.getConfiguration("xpTracker", key)!);
    assert.equal(saved.skills.COOKING.ar, 100);
    await plugin.stop();
    await plugin.start();
    xp.set(SkillId.Cooking, 1500); // gained 400 while logged out
    client.gameState = ENGINE_LOGIN_SCREEN;
    login();
    view = plugin.getView();
    const cooking = view.skills.find((s) => s.skill === SkillId.Cooking);
    assert.equal(cooking?.snapshot.xpGainedInSession, 100, "restored; offline XP isn't session XP");
    stat(SkillId.Cooking, 1510);
    assert.equal(plugin.getSkillSnapshot(SkillId.Cooking)!.xpGainedInSession, 110);

    // "Save between sessions" off: saved, but not restored.
    plugin.saveState();
    config.setConfigValue(XpTrackerConfig, "saveState", false);
    await plugin.stop();
    await plugin.start();
    login();
    assert.deepEqual(plugin.getView().skills, []);
    config.setConfigValue(XpTrackerConfig, "saveState", true);

    // A different account starts over; Reset All clears the save.
    stat(SkillId.Agility, 1200);
    plugin.onGameStateChanged(new GameStateChanged(GameState.LOGIN_SCREEN));
    login("Bob");
    assert.deepEqual(plugin.getView().skills, [], "Bob doesn't see Alice's trackers");
    stat(SkillId.Agility, 1300);
    plugin.saveState();
    assert.ok(config.getConfiguration("xpTracker", "rsprofile.bob.state"));
    plugin.resetAndInitState();
    assert.equal(config.getConfiguration("xpTracker", "rsprofile.bob.state") ?? null, null);
    assert.deepEqual(plugin.getView().skills, []);

    // A change of world type starts over too (RuneLite's XpWorldType), each type keeping its own save.
    assert.equal(xpWorldType(0), "NORMAL");
    assert.equal(xpWorldType(0x800 | 1), "NORMAL", "hardcore and members worlds are normal");
    assert.equal(xpWorldType(1 << 29), "DMM");
    assert.equal(xpWorldType((1 << 30) >>> 0), "LEAGUE");
    assert.equal(xpWorldType(1 << 25), "TOURNEY");
    assert.equal(xpWorldType(1 << 6), "PVP_ARENA");
    assert.equal(xpWorldType(((1 << 29) | (1 << 30)) >>> 0), "LEAGUE", "the last non-normal type wins");
    stat(SkillId.Mining, 1400);
    assert.ok(plugin.getSkillSnapshot(SkillId.Mining)!.xpGainedInSession > 0);
    client.loginState = { serverWorldFlags: 1 << 29 };
    plugin.onGameStateChanged(new GameStateChanged(GameState.LOGIN_SCREEN));
    login("Bob");
    assert.deepEqual(plugin.getView().skills, [], "a Deadman world doesn't continue the normal trackers");
    assert.ok(config.getConfiguration("xpTracker", "rsprofile.bob.state"), "the normal session was saved as it left");
    stat(SkillId.Mining, 1500);
    plugin.saveState();
    assert.equal(JSON.parse(config.getConfiguration("xpTracker", "rsprofile.bob.dmm.state")!).skills.MINING.ar, 100);
    login("Bob");
    assert.equal(plugin.getSkillSnapshot(SkillId.Mining)!.xpGainedInSession, 100, "the same world type keeps going");
    client.loginState = { serverWorldFlags: 0 };
    login("Bob");
    assert.equal(plugin.getSkillSnapshot(SkillId.Mining)!.xpGainedInSession, 400,
        "back on a normal world, its own save comes back, not the Deadman session");
    client.loginState = undefined;

    await plugin.stop();
    assert.deepEqual(plugin.widgetOverlays(), []);
    assert.equal(plugin.transformMenuEntries(menu, statsMenu), menu);
}

main()
    .then(() => console.log("xp tracker plugin tests passed"))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
