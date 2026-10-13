import { strict as assert } from "node:assert";

import {
    PLAYER_INDEX_OFFSET,
    decodeInteractionIndex,
    encodeInteractionIndex,
} from "../rs/interaction/InteractionIndex";

/**
 * NPC indices run to 65534 (as OSRS), so the player marker in the interacting-entity field sits
 * above them: an NPC past 32767 must still decode as an NPC, not as a player.
 */
function npcsAbove32767StayNpcs(): void {
    assert.equal(PLAYER_INDEX_OFFSET, 65536);
    assert.deepEqual(decodeInteractionIndex(40000), { type: "npc", id: 40000 });
    assert.deepEqual(decodeInteractionIndex(65534), { type: "npc", id: 65534 });
    assert.deepEqual(decodeInteractionIndex(encodeInteractionIndex("player", 5)), { type: "player", id: 5 });
    assert.equal(encodeInteractionIndex("player", 2047) <= 0xfffffe, true, "fits the 24-bit field (0xffffff is none)");
}

npcsAbove32767StayNpcs();
