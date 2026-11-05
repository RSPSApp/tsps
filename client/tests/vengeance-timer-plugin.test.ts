import { strict as assert } from "node:assert";

import {
    VENGEANCE_COOLDOWN_MS,
    VengeanceTimer,
} from "../game/plugins/vengeancetimer/VengeanceTimer";

const plugin = new VengeanceTimer();

const startedAt = 1_000;
plugin.syncCooldownVarbit(1, startedAt);
assert.equal(plugin.getRemainingSeconds(startedAt), VENGEANCE_COOLDOWN_MS / 1000);
assert.equal(plugin.getRemainingSeconds(startedAt + 15_000), 15);

plugin.syncCooldownVarbit(1, startedAt + 15_000);
assert.equal(plugin.getRemainingSeconds(startedAt + 15_000), 15, "polling must not restart the timer");

assert.equal(plugin.getRemainingSeconds(startedAt + 20_000), 10);

plugin.syncCooldownVarbit(0, startedAt + 30_000);
assert.equal(plugin.getRemainingSeconds(startedAt + 30_000), 0);

console.log("vengeance timer plugin smoke test passed");
