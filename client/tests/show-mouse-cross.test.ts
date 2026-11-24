import assert from "node:assert/strict";

import { ClientState } from "../game/ClientState";
import { Opcodes } from "../rs/cs2/Opcodes";
import { createHandlerMap } from "../rs/cs2/handlers";
import { spawnClickCross } from "../render/render/interact/highlight4";

// setshowmousecross(false): a top-level layout turns the click cross off, and a click then draws none.
const handlers = createHandlerMap();
const set = (on: number) => handlers.get(Opcodes.SETSHOWMOUSECROSS)!({ intStack: [on], intStackSize: 1 } as any, 0, null as any);
let planeReads = 0;
const host: any = { getPlayerBasePlane: () => { planeReads++; throw new Error("stop after the gate"); } };
const click = () => { try { spawnClickCross(host, { tileX: 1, tileY: 1 }, { sx: 0, sy: 0 }, "red"); } catch {} };

set(0);
assert.equal(ClientState.showMouseCross, false);
click();
assert.equal(planeReads, 0, "no cross is spawned while it is off");
set(1);
click();
assert.equal(planeReads, 1, "on again, the cross is spawned");
ClientState.reset();
assert.equal(ClientState.showMouseCross, true);
console.log("ok");
