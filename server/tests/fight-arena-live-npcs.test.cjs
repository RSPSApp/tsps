// Run after `yarn build`: node --test tests/fight-arena-live-npcs.test.cjs
//
// The Fight Arena NPCs the world spawns are live's quest versions (rsprox_transcripts/241/911665.txt
// ticks 7427-7433 and 7627): multinpc parents on arenaquest (varp 17), so the pens' beasts, Sammy in his
// cell, Justin in the arena and the Khazards' stand show only at the stages live shows them. A real
// Player's packet sender holds the varp; NPC.getContentId resolves the parent as interactions do.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { NpcSpawnDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcSpawnDefinitionLoader");
const spawns = require("../data/definitions/npc-spawns.json");

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
});

const ARENAQUEST = 17;
const id = (name) => core.CacheDefinitions.getNpcId(name);

/** A real player whose packets go nowhere (the sender still keeps its varps). */
function makePlayer() {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const session = new PlayerSession(channel);
  const player = new Player(session);
  session.setPlayer(player);
  return player;
}

/** The world's spawn row at this tile, as an NPC. */
function spawned(x, y) {
  const rows = spawns.filter((row) => row.x === x && row.y === y && row.level === 0);
  assert.equal(rows.length, 1, `one spawn at ${x},${y}`);
  return core.NPC.create(rows[0].id, new core.Location(x, y, 0));
}

/** The facing the spawn loader gives the row at this tile (its `direction` is the client's). */
function facing(x, y) {
  const row = spawns.find((entry) => entry.x === x && entry.y === y && entry.level === 0);
  return new NpcSpawnDefinitionLoader().toDefinition(row, "test").getFacing();
}

function seen(npc, player, stage) {
  player.getPacketSender().sendConfig(ARENAQUEST, stage);
  const definition = npc.getCurrentDefinition(player);
  return definition ? definition.getId() : null;
}

test("the pens hold the caged beasts until each has been fought", () => {
  const player = makePlayer();
  const pens = [
    [2608, 3165, "arena_ogre_cage", "arena_ogre_vis", 7],
    [2608, 3162, "arena_bouncer_cage", "arena_bouncer_vis", 10],
    [2608, 3159, "arena_scorpion_cage", "arena_scorpion_vis", 9],
  ];
  for (const [x, y, cage, vis, last] of pens) {
    const npc = spawned(x, y);
    assert.equal(npc.getId(), id(cage), `${cage} in its pen (tick 7427-7431)`);
    assert.equal(facing(x, y), core.Direction.WEST, `${cage} faces west (spawnangle=west)`);
    assert.equal(seen(npc, player, 0), id(vis));
    assert.equal(seen(npc, player, last), id(vis), `still caged at stage ${last}`);
    assert.equal(seen(npc, player, last + 1), null, `gone once fought (stage ${last + 1})`);
    assert.equal(npc.getDefinition().getInteractions?.().some?.((op) => op === "Attack") ?? false, false, "no Attack on a cage");
  }
});

test("Sammy, Justin and the Khazards' stand show at live's stages", () => {
  const player = makePlayer();
  const sammyInCell = spawned(2615, 3168);
  assert.equal(facing(2615, 3168), core.Direction.SOUTH, "tick 7433: Sammy's spawnangle=south");
  assert.equal(facing(2603, 3168), core.Direction.NORTH, "tick 7433: Justin's spawnangle=north");
  assert.equal(seen(sammyInCell, player, 5), id("sammy_servil_vis"), "Sammy talks from his cell until he is freed");
  assert.equal(seen(sammyInCell, player, 6), null, "and is gone from it after");
  const justin = spawned(2603, 3168);
  assert.equal(seen(justin, player, 8), id("justin_servil_vis"));
  assert.equal(seen(justin, player, 9), null, "Justin leaves the arena floor when the player is jailed");
  const stand = [
    [2603, 3153, "sammy_servil_vis_noop", 6, 11],
    [2602, 3153, "justin_servil_vis", 9, 11],
    [2600, 3153, "general_khazard_vis", 9, 12],
  ];
  for (const [x, y, vis, first, last] of stand) {
    const npc = spawned(x, y);
    assert.equal(facing(x, y), core.Direction.NORTH, `${vis} faces the arena (tick 7627: spawnangle=north)`);
    assert.equal(seen(npc, player, first - 1), null, `${vis} not yet there at stage ${first - 1}`);
    assert.equal(seen(npc, player, first), id(vis));
    assert.equal(seen(npc, player, last), id(vis));
    assert.equal(seen(npc, player, last + 1), null, `${vis} gone after stage ${last}`);
  }
});
