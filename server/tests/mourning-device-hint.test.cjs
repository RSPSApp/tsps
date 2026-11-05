// Run after `yarn build`: node --test tests/mourning-device-hint.test.cjs
//
// Mourning's End Part I: Aim and Fire isn't scripted, as no capture shows how it aims, so loading the device
// also says it can be used directly on the sheep. That line is our wording, not live's.
//
// Native fixture: real inventory_use_on packets through ClientConnection.dispatch, on a world sheep (multi-NPC
// 6179), with World's order: tasks, NPCs, then the player. The quest stage is set directly. No client ran.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
// The bots rewrite their tracked object index on load, and nothing here needs them.
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const HOME = [2609, 3344];
const WORLD_RED_SHEEP = 6179;
const RED_VARBIT = 801;
const DYED_RED = 5305;
const STAGE_FIXED_DEVICE = 7;
const STAGE_SHEEP = 8;
const LOADED = /firing chamber.*Aim and Fire/;
const HINT = /use the loaded device directly on a sheep/;

let core;
let I;
let next = 8500;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t, stage) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("deviceqa" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  p.needsPlacement = false;
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => {
    messages.push(message);
    return p.getPacketSender();
  });
  const c = new ClientConnection(channel);
  c.player = p;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
  });
  QuestRuntime.getRegisteredQuests().find((quest) => quest.key === "mournings_end_part_i").setStage(p, stage);
  p.getInventory().adds(I.FIXED_DEVICE, 1);
  p.getInventory().adds(I.RED_TOAD, 1);
  return { p, c, inv: p.getInventory(), messages };
}

async function send(f, packet, npc) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
  for (let i = 0; i < 6; i++) {
    core.TaskManager.process();
    if (npc?.isRegistered()) npc.process();
    // Player sync clears this each tick; a moveTo leaves the player busy until it does.
    f.p.needsPlacement = false;
    f.p.getMovementQueue().process();
    core.TaskManager.processWalkTo(f.p.getIndex());
  }
}

function loadToad(f) {
  const slot = f.inv.getSlotForItemId(I.RED_TOAD);
  const deviceSlot = f.inv.getSlotForItemId(I.FIXED_DEVICE);
  return send(f, {
    type: "inventory_use_on", slot, itemId: I.RED_TOAD,
    target: { kind: "inventory", slot: deviceSlot, itemId: I.FIXED_DEVICE },
  });
}

test("loading the device says it can be used directly on a sheep, and doing so re-dyes it", async (t) => {
  const f = actor(t, STAGE_FIXED_DEVICE);
  const npc = core.NPC.create(WORLD_RED_SHEEP, new core.Location(HOME[0] + 1, HOME[1], 0));
  core.World.getNpcs().add(npc);
  t.after(() => core.World.getNpcs().remove(npc));

  await loadToad(f);
  t.diagnostic(`messages ${f.messages}`);
  assert.equal(f.inv.getAmount(I.RED_TOAD), 0, "control: the toad is loaded");
  assert.ok(f.messages.some((message) => LOADED.test(message)), "control: the transcript's line stays");
  assert.ok(f.messages.some((message) => HINT.test(message)), "the hint");

  await send(f, {
    type: "inventory_use_on", slot: f.inv.getSlotForItemId(I.FIXED_DEVICE), itemId: I.FIXED_DEVICE,
    target: { kind: "npc", id: npc.getIndex() },
  }, npc);
  assert.equal(f.p.getPacketSender().getVarbit(RED_VARBIT), 1, "the device re-dyes it");
  assert.equal(npc.getContentId(f.p), DYED_RED, "and it shows dyed");
});

test("no hint when the toad doesn't load", async (t) => {
  const f = actor(t, STAGE_SHEEP);
  await loadToad(f);
  assert.equal(f.inv.getAmount(I.RED_TOAD), 1, "control: the toad stays out");
  assert.ok(!f.messages.some((message) => HINT.test(message)), "no hint");
});
