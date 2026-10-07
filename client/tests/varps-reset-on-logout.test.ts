import assert from "node:assert/strict";

import { VarManager } from "../rs/config/vartype/VarManager";

// A varbit over varp 892's low bits, and varcs 1 (persistent) and 2 (transient).
const varbitLoader = {
    load: (id: number) => (id === 1 ? { baseVar: 892, startBit: 0, endBit: 7 } : undefined),
    getCount: () => 2,
} as any;
const varcIntTypeLoader = {
    load: (id: number) => ({ persist: id === 1 }),
    getCount: () => 3,
} as any;

const vars = new VarManager(varbitLoader, varcIntTypeLoader);
const changes: number[] = [];
vars.onVarpChange = (id) => changes.push(id);

// Account A home teleports: the server sends the minute of the cast (varp 892).
vars.setVarp(892, 29_000_000);
vars.setVarp(3078, 29_000_010);
vars.setVarcInt(1, 5);
vars.setVarcInt(2, 7);
changes.length = 0;

// Back to the login screen.
vars.resetForLogout();
assert.equal(vars.getVarp(892), 0, "account A's home teleport minute is gone");
assert.equal(vars.getVarp(3078), 0);
assert.equal(vars.getVarbit(1), 0, "varbits read the cleared varps");
assert.equal(vars.getVarcInt(1), 5, "persistent varcs (client preferences) stay");
assert.equal(vars.getVarcInt(2), -1, "transient varcs go (an unset varc int reads -1)");
assert.deepEqual(changes, [], "no change callbacks while logged out");

// Account B logs in without a cooldown: only its non-zero varps arrive, and they are changes.
vars.setVarp(3078, 29_000_020);
assert.deepEqual(changes, [3078]);
assert.equal(vars.getVarp(892), 0, "account B shows no cooldown");

console.log("varps-reset-on-logout: ok");
