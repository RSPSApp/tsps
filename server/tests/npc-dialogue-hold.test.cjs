// Run after `yarn build`: node --test tests/npc-dialogue-hold.test.cjs
// Live (a West Ardougne Civilian talked to while walking: it stops and stays for the whole
// conversation) and LostCity chat.rs2: the NPC's first chat line sets npc mode playerfaceclose,
// which takes no step until the player is more than a tile away or the dialogue ends.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { NPC } = require("../dist/game/entity/impl/npc/NPC");
const { Location } = require("../dist/game/model/Location");

function scene() {
  const state = { current: null, at: new Location(2490, 3305, 0), talkingTo: null };
  const player = {
    isPlayer: () => true,
    getAsPlayer() { return this; },
    getLocation: () => state.at,
    getInteractingMobile: () => state.talkingTo,
    getDialogueManager: () => ({ isActive: () => state.current !== null, getCurrent: () => state.current }),
  };
  const npcWith = (id, at) => ({
    heldByDialogue: null,
    getId: () => id, getNpcTransformationId: () => -1, getContentId: () => id,
    getInteractingMobile: () => player,
    getLocation: () => at,
  });
  const npc = npcWith(3505, new Location(2490, 3306, 0));
  const held = (who = npc) => NPC.prototype.updateDialogueHold.call(who);
  return { state, held, npcWith };
}

const playerLine = { getText: () => "Hello there." };
const npcLine = { getNpcId: () => 3505, getText: () => "Oh hello, I'm sorry, I'm a bit worn out." };
const options = { getOptions: () => [] };

test("an NPC is held from its first chat line until the dialogue closes", () => {
  const { state, held } = scene();
  state.current = playerLine;
  assert.equal(held(), false, "the player's own opening line does not hold it");
  state.current = npcLine;
  assert.equal(held(), true);
  state.current = options;
  assert.equal(held(), true, "stays held for the rest of the conversation");
  state.current = null;
  assert.equal(held(), false, "released when the dialogue closes");
});

test("a held NPC is released once the player is more than a tile away", () => {
  const { state, held } = scene();
  state.current = npcLine;
  assert.equal(held(), true);
  state.at = new Location(2490, 3303, 0);
  assert.equal(held(), false);
  state.at = new Location(2491, 3305, 0);
  state.current = options;
  assert.equal(held(), false, "not re-held by a later non-NPC line");
});

test("only the NPC speaking is held, not another NPC facing the player", () => {
  // A goblin fighting the player (facing them) while they read a banker's line keeps moving:
  // live's chatnpc sets the mode on the speaking NPC alone.
  const { state, held, npcWith } = scene();
  const goblin = npcWith(3029, new Location(2491, 3306, 0));
  state.current = npcLine;
  assert.equal(held(goblin), false);
  assert.equal(held(), true, "the Civilian speaking is held");
  state.current = { getNpcId: () => 1613 };
  const banker = npcWith(1613, new Location(2489, 3304, 0));
  state.talkingTo = banker;
  assert.equal(held(goblin), false);
  assert.equal(held(banker), true, "also found by the player's interaction");
});
