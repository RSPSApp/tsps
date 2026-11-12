// Run after `yarn build`: node --test tests/dragon-slayer-wormbrain-map.test.cjs
//
// Wormbrain's table (npc-drops.json) always lists Lozar's map piece; Dragon Slayer I keeps it for the
// players owed one, so a kill drops exactly one and nobody else gets one. Rolled through NpcDrops'
// real table and kill context. Bots off. No client ran.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const STAGE_OZIACH = 2;
const INSTRUCTIONS_ATTRIBUTE = "dragon-slayer:instructions";
/** Bit 2 is Wormbrain's; a set bit means the Guildmaster has not been asked about him yet. */
const WORMBRAIN_NOT_ASKED = 1 << 2;

let core;
let index = 7520;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
});
after(() => PM.emitServerShutdown({}));

function player(t, name) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(index++);
  p.setUsername(name);
  p.setRegistered(true);
  p.setLocation(new core.Location(3012, 3189, 0));
  p.needsPlacement = false;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
  });
  return p;
}

function mapPiecesDropped(p) {
  const wormbrain = { getId: () => core.NpcIdentifiers.WORMBRAIN, getLocation: () => new core.Location(3014, 3189, 0) };
  const request = { player: p, npcId: core.NpcIdentifiers.WORMBRAIN, npc: wormbrain, drops: [] };
  PM.emitCustomEvent("npc-drops:roll-table", request);
  return request.drops.filter((drop) => drop.itemId === core.ItemIdentifiers.MAP_PART_2).length;
}

const dragonSlayer = () => QuestRuntime.getRegisteredQuests().find((entry) => entry.key === "dragon_slayer_i");

test("Wormbrain drops one map piece for a player owed it, none for anyone else", (t) => {
  const owed = player(t, "wormbrainqa1");
  dragonSlayer().setStage(owed, STAGE_OZIACH);
  owed.setAttribute(INSTRUCTIONS_ATTRIBUTE, 0);
  assert.equal(mapPiecesDropped(owed), 1, "the table's piece, and only that one");

  const notStarted = player(t, "wormbrainqa2");
  assert.equal(mapPiecesDropped(notStarted), 0, "not on the quest");

  const notAsked = player(t, "wormbrainqa3");
  dragonSlayer().setStage(notAsked, STAGE_OZIACH);
  notAsked.setAttribute(INSTRUCTIONS_ATTRIBUTE, WORMBRAIN_NOT_ASKED);
  assert.equal(mapPiecesDropped(notAsked), 0, "the Guildmaster has not sent them to Wormbrain");

  const holding = player(t, "wormbrainqa4");
  dragonSlayer().setStage(holding, STAGE_OZIACH);
  holding.setAttribute(INSTRUCTIONS_ATTRIBUTE, 0);
  holding.getInventory().add(new core.Item(core.ItemIdentifiers.MAP_PART_2, 1));
  assert.equal(mapPiecesDropped(holding), 0, "already carrying it");
});

test("a map piece or Crandor map in the bank counts as owned; a placeholder does not", (t) => {
  const owed = (name) => {
    const p = player(t, name);
    dragonSlayer().setStage(p, STAGE_OZIACH);
    p.setAttribute(INSTRUCTIONS_ATTRIBUTE, 0);
    return p;
  };
  const bankedPiece = owed("wormbrainqa5");
  bankedPiece.getBank(1).add(new core.Item(core.ItemIdentifiers.MAP_PART_2, 1));
  assert.equal(mapPiecesDropped(bankedPiece), 0, "the piece is in a bank tab");

  const bankedMap = owed("wormbrainqa6");
  bankedMap.getBank(0).add(new core.Item(core.ItemIdentifiers.CRANDOR_MAP, 1));
  assert.equal(mapPiecesDropped(bankedMap), 0, "the joined map holds the piece");

  const placeholder = owed("wormbrainqa7");
  placeholder.getBank(0).add(new core.Item(core.ItemIdentifiers.MAP_PART_2, 0));
  assert.equal(mapPiecesDropped(placeholder), 1, "a placeholder is not the piece");
});
