import assert from "node:assert/strict";
import { TRANSMIT_VARPS } from "../common/vars";

// The buff bar's relic op (cache script 3231) flips buff_league_relics_hidden (varbit 12383, varp
// 1734) in the client alone; the server keeps it only if the varp reaches it.
assert.ok(TRANSMIT_VARPS.has(1734), "buff bar settings varp 1734 must reach the server");
console.log("Buff bar settings varp transmission whitelist: ok");
