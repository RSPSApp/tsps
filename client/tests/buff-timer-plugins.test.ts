import { strict as assert } from "node:assert";

import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { StatusTimer } from "../game/plugins/statustimer/StatusTimer";
import { TimersPlugin, migrateTimersConfig } from "../game/plugins/statustimer/TimersPlugin";

const plugin = new TimersPlugin();
assert.equal(TimersPlugin.descriptor.name, "Timers");
assert.equal(plugin.isEnabled(), true);
for (const timer of [plugin.poison, plugin.freeze, plugin.antifire, plugin.teleblock, plugin.stamina]) assert.ok(timer instanceof StatusTimer);
const changes: boolean[] = [];
const unsubscribe = plugin.subscribe(() => changes.push(plugin.isEnabled()));
plugin.setEnabledState(false);
plugin.setEnabledState(false);
plugin.setEnabledState(true);
unsubscribe();
assert.deepEqual(changes, [false, true], "the single switch updates the HUD immediately, without redundant updates");

const legacy = ["poisontimerplugin", "freezetimerplugin", "antifiretimerplugin", "teleblocktimerplugin", "staminatimerplugin", "vengeancetimerplugin"];
const config = new ConfigManager();
migrateTimersConfig(config);
assert.equal(config.getConfiguration("runelite", "timersplugin"), undefined, "new players keep the enabled default");
for (const key of legacy) config.setConfiguration("runelite", key, "false");
migrateTimersConfig(config);
assert.equal(config.getConfiguration("runelite", "timersplugin"), "false", "a disabled timer setup stays disabled");
config.setConfiguration("runelite", "timersplugin", "true");
migrateTimersConfig(config);
assert.equal(config.getConfiguration("runelite", "timersplugin"), "true", "the new switch is never overwritten");
const attackOnly = new ConfigManager();
for (const key of legacy) attackOnly.setConfiguration("runelite", key, "false");
attackOnly.setConfiguration("runelite", "attacktimerplugin", "true");
migrateTimersConfig(attackOnly);
assert.equal(attackOnly.getConfiguration("runelite", "timersplugin"), undefined, "an enabled attack timer keeps the merged plugin on");

// Antifire: the type varp switches the icon between antifire and super antifire.
const antifire = plugin.antifire;
antifire.sync(360, 1, 0);
assert.equal(antifire.getRemainingSeconds(0), 360);
antifire.sync(359, 1, 1_000);
assert.equal(antifire.getRemainingSeconds(1_000), 359, "the server countdown does not restart it");
antifire.sync(180, 2, 2_000);
assert.equal(antifire.getState().type, 2);
assert.equal(antifire.getRemainingSeconds(2_000), 180, "a super antifire replaces the antifire");
antifire.sync(0, 0, 3_000);
assert.equal(antifire.getState().active, false);

// Stamina: a new dose extends the timer.
const stamina = plugin.stamina;
stamina.sync(60, 1, 0);
stamina.sync(179, 1, 1_000);
assert.equal(stamina.getRemainingSeconds(1_000), 179);

// Teleblock: counts down locally between server updates and ends on zero.
const teleblock = plugin.teleblock;
teleblock.sync(150, 1, 0);
assert.equal(teleblock.getRemainingSeconds(10_000), 140);
teleblock.sync(0, 1, 10_000);
assert.equal(teleblock.getState().active, false);

console.log("buff timer plugins smoke test passed");
