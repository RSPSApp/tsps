// Run after `yarn build`: node --test tests/fremennik-isles-mawnis-worn-armour.test.cjs
// The Fremennik Isles, stage 16 (decree delivered): Mawnis checks for the yak-hide top and legs. Worn pieces count as well
// as carried ones (issue #6715 item 4); with only one piece held he still asks for the other.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { NPC } = require("../dist/game/entity/impl/npc/NPC");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const MAWNIS = 1878;
const STAGE_DECREE_DELIVERED = 16;
const STAGE_ARMOUR_DONE = 17;
const SPOT = { x: 2660, y: 3700 };
let core;
let next = 9500;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("isleyak" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(SPOT.x, SPOT.y, 0));
  p.needsPlacement = false;
  t.mock.method(p.getPacketSender(), "sendMessage", () => p.getPacketSender());
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
  });
  QuestRuntime.questNamed("The Fremennik Isles").setStage(p, STAGE_DECREE_DELIVERED);
  return p;
}

function talk(p) {
  const npc = new NPC(MAWNIS, new core.Location(SPOT.x, SPOT.y, 0));
  npc.setRegistered(true);
  PM.emitNpcInteraction({ player: p, npc, npcId: MAWNIS, clickType: 1, handled: false });
  return QuestRuntime.questNamed("The Fremennik Isles").getStage(p);
}

const wear = (p, slot, id) => p.getEquipment().set(slot, new core.Item(id, 1));

test("Mawnis accepts the yak-hide set when both pieces are worn", (t) => {
  const p = actor(t);
  wear(p, core.Equipment.BODY_SLOT, core.ItemIdentifiers.YAK_HIDE_ARMOUR);
  wear(p, core.Equipment.LEG_SLOT, core.ItemIdentifiers.YAK_HIDE_ARMOUR_3);
  assert.equal(talk(p), STAGE_ARMOUR_DONE);
});

test("Mawnis accepts one piece worn and the other carried", (t) => {
  const p = actor(t);
  wear(p, core.Equipment.BODY_SLOT, core.ItemIdentifiers.YAK_HIDE_ARMOUR);
  p.getInventory().adds(core.ItemIdentifiers.YAK_HIDE_ARMOUR_3, 1);
  assert.equal(talk(p), STAGE_ARMOUR_DONE);
});

test("Mawnis still accepts the set when both pieces are carried", (t) => {
  const p = actor(t);
  p.getInventory().adds(core.ItemIdentifiers.YAK_HIDE_ARMOUR, 1);
  p.getInventory().adds(core.ItemIdentifiers.YAK_HIDE_ARMOUR_3, 1);
  assert.equal(talk(p), STAGE_ARMOUR_DONE);
});

test("Mawnis does not accept a single worn piece", (t) => {
  const p = actor(t);
  wear(p, core.Equipment.BODY_SLOT, core.ItemIdentifiers.YAK_HIDE_ARMOUR);
  assert.equal(talk(p), STAGE_DECREE_DELIVERED);
});
