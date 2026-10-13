// Run after `yarn build`: node --test tests/npc-limit.test.cjs
// The world holds NPC indices 1-65534 (as OSRS: 16 bits in npc info, 0xffff ends the list), and
// the interacting-entity field marks players above that range (PlayerSession).
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { World } = require("../dist/game/World");
const { PlayerSession } = require("../dist/net/PlayerSession");

test("the world has room for NPC indices up to 65534", () => {
  // MobileList's capacity counts slot 0, which is never handed out.
  assert.equal(World.getNpcs().capacityReturn(), 65535);
});

test("the interacting-entity field keeps NPCs past 32767 apart from players", () => {
  const interactionIndex = PlayerSession.prototype.interactionIndex;
  const npc = { getIndex: () => 40000, isPlayer: () => false };
  const player = { getIndex: () => 5, isPlayer: () => true };
  assert.equal(interactionIndex.call({}, npc), 40000);
  assert.equal(interactionIndex.call({}, player), 65536 + 5);
  assert.equal(PlayerSession.PLAYER_INTERACTION_OFFSET, 65536, "must match client/rs/interaction/InteractionIndex.ts");
  assert.equal(interactionIndex.call({}, null), -1);
});
