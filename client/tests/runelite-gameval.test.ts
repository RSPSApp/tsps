import { strict as assert } from "node:assert";

import { ABYSSAL_WHIP } from "@runelite/api/gameval/ItemID";
import { WORN } from "@runelite/api/gameval/InventoryID";
import { GameState } from "@runelite/api/GameState";

assert.equal(ABYSSAL_WHIP, 4151, "gameval constants keep RuneLite's values");
assert.equal(WORN, 94, "InventoryID matches RuneLite");
assert.equal(GameState.CONNECTION_LOST, 40, "GameState uses RuneLite's enum values");

console.log("runelite gameval tests passed");
