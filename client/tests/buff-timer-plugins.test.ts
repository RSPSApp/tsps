import { strict as assert } from "node:assert";

import {
    AntifireTimerPlugin,
    FreezeTimerPlugin,
    PoisonTimerPlugin,
    StaminaTimerPlugin,
    StatusTimerPlugin,
    TeleblockTimerPlugin,
} from "../game/plugins/statustimer/StatusTimerPlugin";

const plugins = [AntifireTimerPlugin, TeleblockTimerPlugin, StaminaTimerPlugin];
const names = plugins.map((plugin) => plugin.descriptor.name);
assert.deepEqual(names, ["Antifire Timer", "Teleblock Timer", "Stamina Timer"]);

const configKeys = [PoisonTimerPlugin, FreezeTimerPlugin, ...plugins].map((plugin) => plugin.descriptor.configKey);
assert.equal(new Set(configKeys).size, configKeys.length, "each timer is toggled on its own");

for (const Timer of plugins) {
    const plugin = new Timer();
    assert.ok(plugin instanceof StatusTimerPlugin);
    assert.equal(plugin.getState().config.enabled, true, `${Timer.descriptor.name} is enabled by default`);
    assert.equal(typeof plugin.renderHud, "function");
}

// Antifire: the type varp switches the icon between antifire and super antifire.
const antifire = new AntifireTimerPlugin();
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
const stamina = new StaminaTimerPlugin();
stamina.sync(60, 1, 0);
stamina.sync(179, 1, 1_000);
assert.equal(stamina.getRemainingSeconds(1_000), 179);

// Teleblock: counts down locally between server updates and ends on zero.
const teleblock = new TeleblockTimerPlugin();
teleblock.sync(150, 1, 0);
assert.equal(teleblock.getRemainingSeconds(10_000), 140);
teleblock.sync(0, 1, 10_000);
assert.equal(teleblock.getState().active, false);

console.log("buff timer plugins smoke test passed");
