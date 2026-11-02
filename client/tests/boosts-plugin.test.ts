import { strict as assert } from "node:assert";
import type { Client } from "@runelite/api/Client";
import { ConfigChanged, StatChanged } from "@runelite/api/events";
import * as VarbitID from "@runelite/api/gameval/VarbitID";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { inject } from "@runelite/client/plugins/PluginInjector";
import { BoostsConfig, DisplayBoosts, DisplayChangeMode } from "../game/plugins/boosts/BoostsConfig";
import { BoostsPlugin } from "../game/plugins/boosts/BoostsPlugin";
import { SkillId } from "../rs/skill/skills";

// --- Config: RuneLite's group, keys and defaults -------------------------------------------------
assert.equal(BoostsConfig.group, "boosts");
assert.equal(BoostsConfig.items.useRelativeBoost.keyName, "relativeBoost");
assert.equal(BoostsConfig.items.displayInfoboxes.keyName, "displayIndicators");
assert.equal(BoostsConfig.items.displayBoosts.default, DisplayBoosts.COMBAT);
assert.equal(BoostsConfig.items.displayNextBuffChange.default, DisplayChangeMode.BOOSTED);
assert.equal(BoostsPlugin.descriptor.enabledByDefault, undefined, "on by default, as RuneLite");

let tickCount = 1000;
let preserve = 0;
const client = {
    getTickCount: () => tickCount,
    getVarbitValue: (id: number) => (id === VarbitID.PRAYER_PRESERVE ? preserve : 0),
    getBoostedSkillLevel: () => 1,
    getRealSkillLevel: () => 1,
} as unknown as Client;

const config = inject(ConfigManager);
const sent: string[] = [];
const plugin = new BoostsPlugin(client, { notify: (m) => sent.push(m) });
let clock = 0;
plugin.now = () => clock;
void plugin.start();
const stat = (skill: SkillId, real: number, boosted: number) => plugin.onStatChanged(new StatChanged(skill, 0, real, boosted));
const configChanged = () => plugin.onConfigChanged(new ConfigChanged("boosts", "x", undefined, undefined));

// Login sync: unboosted stats show nothing.
for (const skill of [SkillId.Attack, SkillId.Strength, SkillId.Defence, SkillId.Mining]) stat(skill, 70, 70);
assert.deepEqual([...plugin.skillsToDisplay], []);
assert.equal(plugin.infoBoxOverlay.signature(), "");

// A super strength: combat boosts show by default, skilling boosts don't.
stat(SkillId.Strength, 70, 89);
stat(SkillId.Mining, 70, 73);
assert.deepEqual([...plugin.skillsToDisplay], [SkillId.Strength]);
assert.equal(plugin.boostText(SkillId.Strength), "89");
assert.equal(plugin.textColor(19), 0x00ff00, "above the threshold: green");
assert.equal(plugin.textColor(0), 0xffff00, "at the threshold: yellow");
assert.equal(plugin.textColor(-1), 0xee3333, "drained: red");

config.setConfigValue(BoostsConfig, "displayBoosts", DisplayBoosts.BOTH);
configChanged();
assert.deepEqual([...plugin.skillsToDisplay], [SkillId.Strength, SkillId.Mining], "skill order");
config.setConfigValue(BoostsConfig, "useRelativeBoost", true);
assert.equal(plugin.boostText(SkillId.Strength), "+19");

// The next restore: a boost dropping by one starts the 100 tick (60 s) cycle.
assert.equal(plugin.getChangeDownTicks(), -1, "unknown until a stat restores");
tickCount = 1010;
stat(SkillId.Strength, 70, 88);
assert.equal(plugin.getChangeDownTicks(), 100);
tickCount = 1040;
plugin.onGameTick();
assert.equal(plugin.getChangeDownTicks(), 70);
assert.equal(plugin.getChangeTime(70), 42, "seconds");
clock += 300;
assert.equal(plugin.getChangeTime(70), 41, "less the time since the tick");

// Preserve lengthens it to 150 ticks.
preserve = 1;
assert.equal(plugin.getChangeDownTicks(), 120);
preserve = 0;

// Debuffs: only counted while a stat is drained (BOOSTED) — the default for them is NEVER.
config.setConfigValue(BoostsConfig, "displayNextDebuffChange", DisplayChangeMode.BOOSTED);
configChanged();
stat(SkillId.Attack, 70, 60);
stat(SkillId.Attack, 70, 61);
assert.equal(plugin.getChangeUpTicks(), 100);

// The infobox row: skills then the debuff and buff timers.
const calls: string[] = [];
const context: any = {
    renderer: {
        drawRect: () => calls.push("rect"),
        drawTexture: () => calls.push("icon"),
        drawPolygon: () => calls.push("arrow"),
    },
    fontLoader: () => undefined,
    sprite: () => ({ tex: {}, w: 25, h: 25 }),
    place: (_o: unknown, w: number, h: number) => ((placed = { w, h }), { x: 0, y: 0, scaleX: 1, scaleY: 1 }),
};
let placed: any;
const rects = plugin.infoBoxOverlay.draw(context);
assert.equal(rects.length, 5, "attack, strength, mining, debuff timer, buff timer");
assert.deepEqual(placed, { w: 5 * 35 + 4 * 2, h: 35 });
assert.equal(calls.filter((c) => c === "icon").length, 3);
assert.equal(calls.filter((c) => c === "arrow").length, 2);
assert.deepEqual(plugin.panelOverlay.draw(context), [], "panel off by default");
config.setConfigValue(BoostsConfig, "displayPanel", true);
assert.equal(plugin.panelOverlay.draw(context).length, 1);
assert.deepEqual(placed, { w: 129, h: 8 + 5 * 15 }, "two timer lines and three skills");
config.setConfigValue(BoostsConfig, "displayInfoboxes", false);
assert.equal(plugin.infoBoxOverlay.signature(), "");

// Notify when a boost drains to the threshold (off by default).
config.setConfigValue(BoostsConfig, "notifyOnBoost", true);
config.setConfigValue(BoostsConfig, "boostThreshold", 5);
stat(SkillId.Strength, 70, 76);
assert.deepEqual(sent, []);
stat(SkillId.Strength, 70, 75);
assert.deepEqual(sent, ["Strength level is getting low!"]);
stat(SkillId.Strength, 70, 74);
assert.equal(sent.length, 1, "once, on crossing");

// Hitpoints and prayer are not boostable here.
stat(SkillId.Hitpoints, 99, 110);
assert.ok(!plugin.skillsToDisplay.has(SkillId.Hitpoints));

console.log("boosts-plugin: ok");
