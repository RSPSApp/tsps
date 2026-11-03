import { strict as assert } from "node:assert";
import type { Client } from "@runelite/api/Client";
import { GameStateChanged } from "@runelite/api/events";
import { GameState } from "@runelite/api/GameState";
import { LIGHTBEARER } from "@runelite/api/gameval/ItemID";
import { PRAYER_RAPIDHEAL } from "@runelite/api/gameval/VarbitID";
import { SA_ENERGY } from "@runelite/api/gameval/VarPlayerID";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { inject } from "@runelite/client/plugins/PluginInjector";
import { RegenMeterConfig } from "../game/plugins/regenmeter/RegenMeterConfig";
import { RegenMeterPlugin } from "../game/plugins/regenmeter/RegenMeterPlugin";
import { SkillId } from "../rs/skill/skills";

// --- Config: RuneLite's group, keys and defaults -------------------------------------------------
assert.equal(RegenMeterConfig.group, "regenmeter");
assert.equal(RegenMeterConfig.items.getNotifyBeforeHpRegenSeconds.keyName, "notifyBeforeHpRegenDuration");
assert.equal(RegenMeterConfig.items.showHitpoints.default, true);
assert.equal(RegenMeterConfig.items.showWhenNoChange.default, false);
assert.equal(RegenMeterPlugin.descriptor.name, "Regeneration Meter");
assert.equal(RegenMeterPlugin.descriptor.enabledByDefault, undefined, "on by default, as RuneLite");

let spec = 1000;
let rapidHeal = 0;
let hp = 10;
let maxHp = 10;
let worn: number[] = [];
const client = {
    getVarpValue: (id: number) => (id === SA_ENERGY ? spec : 0),
    getVarbitValue: (id: number) => (id === PRAYER_RAPIDHEAL ? rapidHeal : 0),
    getBoostedSkillLevel: (skill: SkillId) => (skill === SkillId.Hitpoints ? hp : 1),
    getRealSkillLevel: (skill: SkillId) => (skill === SkillId.Hitpoints ? maxHp : 1),
} as unknown as Client;
const notified: string[] = [];
const plugin = new RegenMeterPlugin(client, { notify: (m) => notified.push(m) }, () => worn);
const config = inject(ConfigManager);
const ticks = (n: number) => { for (let i = 0; i < n; i++) plugin.onGameTick(); };
void plugin.start();

// Special attack: no recharge at 100%, then a 50 tick cycle.
ticks(10);
assert.equal(plugin.getSpecialPercentage(), 0, "full special: no ring");
spec = 900;
ticks(25);
assert.equal(plugin.getSpecialPercentage(), 0.5);
ticks(25);
assert.equal(plugin.getSpecialPercentage(), 0, "wraps every 50 ticks");
// Lightbearer halves it, keeping the time to the next regen when under 25 ticks remain.
ticks(30);
worn = [LIGHTBEARER];
plugin.onGameTick();
assert.equal(plugin.getSpecialPercentage(), 6 / 25, "30 ticks in, less 25, plus this tick: 6 of 25");
worn = [];
plugin.onGameTick();
assert.equal(plugin.getSpecialPercentage(), 1 / 50, "taking it off starts over");

// Hitpoints: nothing at full unless asked, a 100 tick cycle below it, 50 with Rapid Heal.
assert.equal(plugin.getHitpointsPercentage(), 0, "full hitpoints: no ring");
config.setConfigValue(RegenMeterConfig, "showWhenNoChange", true);
plugin.onGameTick();
assert.ok(plugin.getHitpointsPercentage() > 0, "Show at full hitpoints");
config.setConfigValue(RegenMeterConfig, "showWhenNoChange", false);

hp = 5;
plugin.onGameStateChanged(new GameStateChanged(GameState.LOGIN_SCREEN));
ticks(2);
assert.equal(plugin.getHitpointsPercentage(), 0, "after a login the cycle starts two ticks late (RuneLite's -2)");
ticks(50);
assert.equal(plugin.getHitpointsPercentage(), 0.5);
rapidHeal = 1;
plugin.onGameTick();
assert.equal(plugin.getHitpointsPercentage(), 1 / 50, "switching Rapid Heal restarts it, 50 ticks long");
ticks(24);
assert.equal(plugin.getHitpointsPercentage(), 0.5);
rapidHeal = 0;
plugin.onGameTick();
assert.equal(plugin.getHitpointsPercentage(), 1 / 100);

// Above base hitpoints the ring empties instead.
hp = 12;
ticks(24);
assert.equal(plugin.getHitpointsPercentage(), 0.75);
hp = 5;

// The notification: on the tick the configured time before the next hitpoint.
config.setConfigValue(RegenMeterConfig, "getNotifyBeforeHpRegenSeconds", 3);
notified.length = 0;
ticks(100);
assert.deepEqual(notified, ["Your next hitpoint will regenerate soon!"], "once a cycle");
hp = maxHp;
ticks(100);
assert.equal(notified.length, 1, "not at full hitpoints");
config.setConfigValue(RegenMeterConfig, "getNotifyBeforeHpRegenSeconds", 0);

// The overlay draws nothing without the game client's orbs, and nothing once stopped.
assert.equal(plugin.widgetOverlay.signature(), "");
void plugin.stop();
const before = plugin.getSpecialPercentage();
plugin.onGameTick();
assert.equal(plugin.getSpecialPercentage(), before, "stopped: no ticking");

console.log("Regeneration Meter plugin tests passed");
