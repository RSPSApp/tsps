import assert from "node:assert/strict";
import { inject } from "@runelite/client/plugins/PluginInjector";
import { ConfigManager } from "@runelite/client/config/ConfigManager";
import { TimersConfig } from "../game/plugins/statustimer/TimersConfig";

import { clearAttackTimer, getAttackTimerTicks, setAttackTimer } from "../game/plugins/attacktimer/attackTimerState";
import { decodeServerPacket } from "../network/packet/ServerBinaryDecoder";
import { encodeAttackTimer } from "../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol";
import { getCurrentTick } from "../network/serverConnection/timing";
import { TimersPlugin } from "../game/plugins/statustimer/TimersPlugin";

// ATTACK_TIMER carries the ticks until the local player's next attack (not an OSRS packet).
const decode = (ticks: number) => decodeServerPacket(new Uint8Array(encodeAttackTimer(ticks))) as any;
assert.deepEqual(decode(4), { type: "attack_timer", payload: { ticks: 4 } });
assert.equal(decode(300).payload.ticks, 255, "capped at a byte");

// Counted from the tick it belongs to: 4, 3, 2, 1, then nothing once the attack is ready.
setAttackTimer(4, 100);
assert.deepEqual([100, 101, 102, 103, 104, 105].map(getAttackTimerTicks), [4, 3, 2, 1, 0, 0]);
// A new value (eating adds ticks) replaces it.
setAttackTimer(5, 102);
assert.equal(getAttackTimerTicks(102), 5);

// Read on the tick before the one it counts from (the packet arrives just before that TICK).
setAttackTimer(4, 201);
assert.equal(getAttackTimerTicks(200), 5);

// A restarted server counts ticks from 0 again: the old timer must not show hundreds of ticks.
setAttackTimer(4, 1500);
assert.equal(getAttackTimerTicks(1200), 0, "the tick went backwards: a new server session");
assert.equal(getAttackTimerTicks(1200 + 1), 0, "and it stays cleared");
// A new login clears it as well.
setAttackTimer(4, 300);
clearAttackTimer();
assert.equal(getAttackTimerTicks(300), 0);

const timers = new TimersPlugin();
assert.equal(timers.config.showAttackTimer(), false, "overhead mode is opt-in; the timer box is the default");
setAttackTimer(4, getCurrentTick());
assert.equal(timers.attackTimerTicks(), 4, "combat countdown follows Timers by default");
assert.equal(timers.visibleInfoboxCount(), 1, "active combat timer reserves a box");
assert.equal(timers.visibleInfoboxCount(6), 0, "combat timer follows the six existing boxes");
timers.setEnabledState(false);
assert.equal(timers.attackTimerTicks(), 0);
assert.equal(timers.visibleInfoboxCount(), 0, "disabled timers reserve no boxes");
timers.setEnabledState(true);
assert.equal(timers.attackTimerTicks(), 4, "re-enabling preserves the server countdown");
timers.poison.sync(30, 1);
assert.equal(timers.visibleInfoboxCount(), 2, "combat and status timers share the row");
const host: any = {
    osrsClient: { playerEcs: { getWorldViewId: () => -1, getX: () => 128, getY: () => 128, getLevel: () => 0 } },
    acquireOverheadTextEntry: () => ({}), makeActorGroupKey: () => 1, mapOverheadColor: () => 0xffff00,
    resolvePlayerLogicalHeightTiles: () => 2,
};
const output: any[] = [];
timers.appendLocalPlayerOverheads(host, 0, output, 10, 2);
assert.equal(output.length, 0, "box mode has no overhead countdown");
inject(ConfigManager).setConfigValue(TimersConfig, "showAttackTimer", true);
assert.equal(timers.visibleInfoboxCount(), 1, "overhead mode leaves only the poison box");
timers.appendLocalPlayerOverheads(host, 0, output, 10, 2);
assert.equal(output[0].text, "4", "overhead mode draws the countdown above the player");
output.length = 0;
timers.setEnabledState(false);
timers.appendLocalPlayerOverheads(host, 0, output, 10, 2);
assert.equal(output.length, 0, "main switch also hides overhead mode");
timers.setEnabledState(true);
inject(ConfigManager).setConfigValue(TimersConfig, "showAttackTimer", false);
assert.equal(timers.visibleInfoboxCount(), 2, "turning overhead off returns the attack box");
clearAttackTimer();
assert.equal(timers.attackTimerTicks(), 0);
assert.equal(timers.visibleInfoboxCount(), 1, "ready attacks leave no empty box");

console.log("attack timer: ok");
