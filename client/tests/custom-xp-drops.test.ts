import { strict as assert } from "node:assert";
import { GameStateChanged, StatChanged } from "@runelite/api/events";
import { GameState } from "@runelite/api/GameState";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { inject } from "@runelite/client/plugins/PluginInjector";
import {
    CustomXpDropsConfig,
    HorizontalDirection,
    PredictedHitIconStyle,
    VerticalDirection,
    XpTrackerSkill,
} from "../game/plugins/customxpdrops/CustomXpDropsConfig";
import { CustomXpDropsPlugin } from "../game/plugins/customxpdrops/CustomXpDropsPlugin";
import {
    calculateHit,
    dropText,
    type DropSettings,
    formatXp,
    HITSPLAT_FLAGS_MASK,
    OVERALL,
    parseSkillFilter,
    parseXpModifiers,
    SKILL_INDICES,
    SKILL_PRIORITY,
    trackerAlpha,
    XpDropState,
    XpDropStyle,
    AttackStyle,
} from "../game/plugins/customxpdrops/xpDrops";
import { SkillId } from "../rs/skill/skills";

const settings = (over: Partial<DropSettings> = {}): DropSettings => ({
    isGrouped: true,
    groupedDelay: 20,
    yPixelsPerSecond: 44,
    yDirection: VerticalDirection.UP,
    xPixelsPerSecond: 0,
    xDirection: HorizontalDirection.LEFT,
    framesPerDrop: 100,
    fadeOut: true,
    showIcons: true,
    showPredictedHit: true,
    neverGroupPredictedHit: false,
    predictedHitIcon: PredictedHitIconStyle.HITSPLAT,
    filteredSkills: new Set(),
    filteredSkillsPredictedHits: new Set(),
    xpTrackerSkill: XpTrackerSkill.MOST_RECENT,
    xpTrackerClientTicksToLinger: 0,
    xpRate: 1,
    ...over,
});
const bit = (skill: SkillId) => 1 << SKILL_PRIORITY[skill];

// --- Tables and helpers ----------------------------------------------------------------------
SKILL_PRIORITY.forEach((priority, skill) => assert.equal(SKILL_INDICES[priority], skill, "SKILL_INDICES inverts SKILL_PRIORITY"));
assert.deepEqual([...parseSkillFilter(" Runecrafting, Hitpoints ,")], ["runecrafting", "hitpoints", "runecraft"]);
assert.deepEqual([...parseXpModifiers("14779:0.875\nbad\n1:x\n2:1.5\n2:2")], [[14779, 0.875], [2, 2]]);
assert.equal(formatXp(1234567), "1,234,567");
// 4/3 Hitpoints XP per damage: a 30 at OSRS rates is 40 XP; at 10x it is 400, at 10x x5 2000.
assert.equal(calculateHit(40, 1, 1), 30);
assert.equal(calculateHit(400, 1, 10), 30, "the server's rate divides out");
assert.equal(calculateHit(2000, 1, 50), 30);
assert.equal(calculateHit(35, 0.875, 1), 30, "a target paying 87.5%");
assert.equal(calculateHit(40, 0, 1), 0);
// One damage at 10x is 13.3 XP, which the client sees as 13 or 14.
assert.equal(calculateHit(13, 1, 10), 1);
assert.equal(calculateHit(14, 1, 10), 1);

// --- Grouped: one drop per tick, icons in vanilla order, the hit appended ----------------------
{
    const state = new XpDropState();
    state.queue.push({ skill: SkillId.Hitpoints, experience: 133, style: XpDropStyle.DEFAULT });
    state.queue.push({ skill: SkillId.Strength, experience: 400, style: XpDropStyle.MELEE });
    state.hits.push({ hpXp: 133, modifier: 1, style: AttackStyle.AGGRESSIVE });
    state.update(1000, 1, settings({ xpRate: 10 }));
    assert.equal(state.inFlight.length, 1);
    const [drop] = state.inFlight;
    assert.equal(drop.amount, 533);
    assert.equal(drop.hit, 10, "133 Hitpoints XP at 10x: a 10");
    assert.equal(drop.icons, bit(SkillId.Strength) | bit(SkillId.Hitpoints));
    assert.equal(drop.style, XpDropStyle.MELEE, "a prayer-coloured gain colours the group");
    assert.equal(state.lastSkill, SkillId.Strength, "the tracker follows the first skill in vanilla order");
    const colors = { DEFAULT: 0xffffffff, MELEE: 0xffff0000, MAGE: 0xff0000ff, RANGE: 0xff00ff00 };
    assert.deepEqual(dropText(drop, {
        xpDropPrefix: "+", xpDropSuffix: " xp", predictedHitPrefix: "", predictedHitSuffix: "",
        predictedHitColorOverride: false, predictedHitColor: 0, colors,
    }), [{ text: "+533 xp", color: 0xffff0000 }, { text: " (10)", color: 0xffff0000 }]);

    // A second report from the same tick joins the drop already up.
    state.queue.push({ skill: SkillId.Attack, experience: 7, style: XpDropStyle.DEFAULT });
    state.update(1020, 1, settings({ xpRate: 10 }));
    assert.equal(state.inFlight.length, 1);
    assert.equal(state.inFlight[0].amount, 540);
    assert.ok(state.inFlight[0].icons & bit(SkillId.Attack));

    // It rises 44 px a second, fades over its last third and is gone after 100 frames (2 s).
    state.update(2020, 1, settings());
    assert.ok(Math.abs(state.inFlight[0].yOffset - -44) < 1, `moved up ${state.inFlight[0].yOffset}`);
    assert.equal(state.inFlight[0].alpha, 0xff);
    state.update(2800, 1, settings());
    assert.ok(state.inFlight[0].alpha < 0xff && state.inFlight[0].alpha > 0, "fading");
    state.update(3200, 1, settings());
    state.update(3220, 1, settings());
    assert.equal(state.inFlight.length, 0);
}

// --- Ungrouped: a drop per skill, each a delay behind the last; filtered skills hidden ---------
{
    const state = new XpDropState();
    state.queue.push({ skill: SkillId.Hitpoints, experience: 13, style: XpDropStyle.DEFAULT });
    state.queue.push({ skill: SkillId.Attack, experience: 40, style: XpDropStyle.DEFAULT });
    state.queue.push({ skill: SkillId.Prayer, experience: 5, style: XpDropStyle.DEFAULT });
    state.update(1000, 1, settings({ isGrouped: false, filteredSkills: parseSkillFilter("prayer") }));
    assert.deepEqual(state.inFlight.map((d) => d.amount), [40, 13], "vanilla order; Prayer filtered");
    assert.deepEqual(state.inFlight.map((d) => d.frame), [0, -20], "each a delay behind");
}

// --- Never grouped: the hit is its own drop, with a hitsplat ---------------------------------
{
    const state = new XpDropState();
    state.queue.push({ skill: SkillId.Hitpoints, experience: 40, style: XpDropStyle.DEFAULT });
    state.queue.push({ skill: SkillId.Ranged, experience: 120, style: XpDropStyle.DEFAULT });
    state.hits.push({ hpXp: 40, modifier: 1, style: AttackStyle.RANGING });
    state.update(1000, 1, settings({ neverGroupPredictedHit: true }));
    assert.equal(state.inFlight.length, 2);
    const [hit, xp] = state.inFlight;
    assert.equal(hit.isPredictedHit, true);
    assert.equal(hit.amount, 30);
    assert.equal(hit.icons, HITSPLAT_FLAGS_MASK);
    assert.equal(xp.hit, 0, "the XP drop no longer carries it");
    // A hit filtered by skill shows on neither.
    const filtered = new XpDropState();
    filtered.queue.push({ skill: SkillId.Hitpoints, experience: 40, style: XpDropStyle.DEFAULT });
    filtered.hits.push({ hpXp: 40, modifier: 1 });
    filtered.update(1000, 1, settings({ filteredSkillsPredictedHits: parseSkillFilter("Hitpoints") }));
    assert.equal(filtered.inFlight[0].hit, 0);
}

// --- Tracker: a fixed skill, and its fade ----------------------------------------------------
{
    const state = new XpDropState();
    state.update(1000, 1, settings({ xpTrackerSkill: XpTrackerSkill.OVERALL }));
    assert.equal(state.lastSkill, OVERALL);
    state.update(1000, 1, settings({ xpTrackerSkill: XpTrackerSkill.FISHING }));
    assert.equal(state.lastSkill, SkillId.Fishing);
    assert.equal(trackerAlpha(5000, 0, 0, true), 255, "0 never fades");
    assert.equal(trackerAlpha(0, 0, 100, true), 255);
    assert.equal(trackerAlpha(2000, 0, 100, true), 0, "gone after its 100 frames");
    assert.equal(trackerAlpha(2100, 0, 100, false), 0);
}

// --- The plugin: stats in, drops out; vanilla drops hidden; drawn ------------------------------
async function main(): Promise<void> {
    const config = inject(ConfigManager);
    const varbits = new Map<number, number>([[4702, 1], [4129, 1]]); // XP drops on; Piety
    const widgets = new Map<number, any>([[(122 << 16) | 4, { hidden: false, isHidden: false }], [(122 << 16) | 9, { hidden: false, isHidden: false }]]);
    const widgetManager = {
        getWidgetByUid: (uid: number) => widgets.get(uid),
        invalidateWidgetRender: () => {},
        invalidateWidget: () => {},
    };
    let interacting = -1;
    const npcEcs = {
        getEcsIdForServer: (id: number) => (id === 55 ? 7 : undefined),
        getNpcTypeId: () => 14779,
        getWorldX: () => 3200 * 128, getWorldY: () => 3200 * 128, getLevel: () => 0,
    };
    const playerEcs = {
        getIndexForServerId: (id: number) => (id === 1 ? 0 : undefined),
        getInteractionIndex: () => interacting,
        getX: () => 3201 * 128, getY: () => 3200 * 128, getLevel: () => 0,
    };
    const osrsClient: any = {
        gameState: 30, controlledPlayerServerId: 1, hitpointsXpRate: 10, widgetManager, npcEcs, playerEcs,
        sceneGeometry: { tileHeight: () => 0, worldToScreen: (x: number) => [x - 3000, 300], npcHeight: () => 100 },
    };
    const client: any = {
        getVarbitValue: (id: number) => varbits.get(id) ?? 0,
        getVarpValue: () => 1, // the second style: Aggressive on a scimitar
        getEnum: (id: number) => (id === 3908 ? { getIntValue: () => -1 } : null),
    };
    const plugin = new CustomXpDropsPlugin(osrsClient, client);
    let clock = 1000;
    plugin.now = () => clock;
    await plugin.start();
    config.setConfigValue(CustomXpDropsConfig, "showPredictedHit", true);
    config.setConfigValue(CustomXpDropsConfig, "predictedHitModifiers", "14779:0.875");
    plugin.onConfigChanged({ getGroup: () => "CustomizableXPDrops", getKey: () => "predictedHitModifiers" } as any);

    const stat = (skill: SkillId, xp: number) => plugin.onStatChanged(new StatChanged(skill, xp, 50, 50));
    stat(SkillId.Hitpoints, 100_000);
    stat(SkillId.Strength, 200_000);
    plugin.onClientTick();
    assert.equal(plugin.state.inFlight.length, 0, "the login values are no drops");
    // A 30 on a Gemstone Crab (87.5%) at 10x: 1,050 Strength XP and 350 Hitpoints XP. The first
    // hit's stats arrive before the update that says who the player attacks.
    stat(SkillId.Hitpoints, 100_350);
    stat(SkillId.Strength, 201_050);
    interacting = 55;
    plugin.onClientTick();
    assert.equal(plugin.state.inFlight.length, 1);
    assert.equal(plugin.state.inFlight[0].amount, 1400);
    assert.equal(plugin.state.inFlight[0].hit, 30, "350 * 3/4 / 0.875 / 10");
    assert.deepEqual(plugin.state.inFlight[0].target, { type: "npc", serverId: 55, npcTypeId: 14779 });

    // Vanilla drops: hidden as script 996 sizes them; the tracker only with the custom one on.
    plugin.onScriptPreFired(996, { intStack: [(122 << 16) | 9, 0, 0, 0], intStackSize: 4 } as any);
    assert.equal(widgets.get((122 << 16) | 9).isHidden, true);
    plugin.onScriptFinished(997);
    assert.equal(widgets.get((122 << 16) | 4).isHidden, false, "the custom tracker is off");
    config.setConfigValue(CustomXpDropsConfig, "useXpTracker", true);
    plugin.onConfigChanged({ getGroup: () => "CustomizableXPDrops", getKey: () => "useXpTracker" } as any);
    assert.equal(widgets.get((122 << 16) | 4).isHidden, true);

    // Drawn in a box (text, then its icons to the left), and over the player when attached.
    const calls: string[] = [];
    let placed: any;
    const context: any = {
        renderer: { drawTexture: () => calls.push("icon"), drawRect: () => calls.push("rect") },
        fontLoader: () => undefined,
        sprite: () => ({ tex: {}, w: 25, h: 25 }),
        place: (o: any, w: number, h: number) => ((placed = { name: o.movable?.name, w, h }), { x: 500, y: 10, scaleX: 1, scaleY: 1 }),
    };
    assert.notEqual(plugin.dropOverlay.signature(), "");
    plugin.dropOverlay.draw(context);
    assert.equal(placed.name, "CustomizableXpDropOverlay");
    assert.equal(placed.h, 16 + 88, "a line plus 100 frames of 44 px/s");
    assert.equal(calls.filter((c) => c === "icon").length, 2, "Strength and Hitpoints icons");

    config.setConfigValue(CustomXpDropsConfig, "attachToPlayer", true);
    assert.equal(plugin.dropOverlay.movable, undefined, "attached: not a movable box");
    calls.length = 0;
    const rects = plugin.dropOverlay.draw(context);
    assert.equal(calls.filter((c) => c === "icon").length, 2);
    assert.ok(rects.some((r) => r.x > 180 && r.x < 230), `drawn over the player at x 201: ${JSON.stringify(rects)}`);
    config.setConfigValue(CustomXpDropsConfig, "attachToPlayer", false);

    // The tracker: Strength's XP, then its progress bar.
    calls.length = 0;
    plugin.trackerOverlay.draw(context);
    assert.equal(placed.name, "CustomizableXpTrackerOverlay");
    assert.equal(calls.filter((c) => c === "icon").length, 1);
    config.setConfigValue(CustomXpDropsConfig, "showXpTrackerProgressBar", true);
    calls.length = 0;
    plugin.trackerOverlay.draw(context);
    assert.equal(calls.filter((c) => c === "rect").length, 3, "border, background, fill");

    // The orb toggle off: nothing drawn; logging out clears the drops.
    varbits.set(4702, 0);
    assert.equal(plugin.dropOverlay.signature(), JSON.stringify([[], ...JSON.parse(plugin.dropOverlay.signature()).slice(1)]));
    plugin.onGameStateChanged(new GameStateChanged(GameState.LOGIN_SCREEN));
    assert.equal(plugin.state.inFlight.length, 0);

    await plugin.stop();
    assert.equal(widgets.get((122 << 16) | 4).isHidden, false, "stopping shows the vanilla tracker again");
    clock += 1;
    console.log("custom-xp-drops tests passed");
}

void main().catch((error) => {
    console.error(error);
    process.exit(1);
});
