// Run after `yarn build`: node --test tests/mourning-device-state.test.cjs
//
// Mourning's End Part I, the fixed device (maintainer notes on #2642). The Wiki's Fixed device page says
// "Only one toad may be placed in the device at a time" and "the device can only be wielded when filled
// with ammo". The refusal lines are our wording, not live's. Aim and Fire itself is not covered.
//
// Native fixture: real inventory_use_on packets through ClientConnection.dispatch, Wield as the
// decoded inventory_action frame the client sends, and a save/load through PlayerSave. The quest stage
// is set directly. No client ran.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { decodeClientPackets } = require("../dist/net/protocol/ClientProtocol");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
const JsonPersistence = require("../plugins/persistence/JsonPlayerPersistence.plugin");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const HOME = [2609, 3344];
const WORLD_RED_SHEEP = 6179;
const RED_VARBIT = 801;
const AMMO_VARBIT = 804;
const STAGE_FIXED_DEVICE = 7;
const STAGE_SHEEP = 8;
const WEAPON = 3;
// ClientPacketId.INVENTORY_USE: a const enum, so it has no object at runtime. The decoder checks it.
const INVENTORY_USE_OPCODE = 240;
const SECOND = /already holds a toad/;
const NEEDS_TOAD = /only be wielded when it holds a toad/;
const DYED = /sheep is already dyed/;

let core;
let I;
let codec;
let next = 8700;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  JsonPersistence.register({
    getSkillManager: () => require("../dist/game/content/skill/SkillManager").SkillManager,
    setPlayerPersistence: (backend) => { codec = backend; }, log() {},
  });
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
  p.setUsername("devstate" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  p.needsPlacement = false;
  for (const name of ["RANGED", "ATTACK", "DEFENCE", "STRENGTH"]) {
    p.getSkillManager().setMaxLevels(core.Skill[name], 99, false).setCurrentLevels(core.Skill[name], 99, false);
  }
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
  return { p, c, inv: p.getInventory(), eq: p.getEquipment(), messages };
}

async function send(f, packet, npc) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
  for (let i = 0; i < 6; i++) {
    core.TaskManager.process();
    if (npc?.isRegistered()) npc.process();
    f.p.needsPlacement = false;
    f.p.getMovementQueue().process();
    core.TaskManager.processWalkTo(f.p.getIndex());
  }
}

function loadToad(f, toadId) {
  return send(f, {
    type: "inventory_use_on", slot: f.inv.getSlotForItemId(toadId), itemId: toadId,
    target: { kind: "inventory", slot: f.inv.getSlotForItemId(I.FIXED_DEVICE), itemId: I.FIXED_DEVICE },
  });
}

/** The frame ClientBinaryEncoder.encodeInventoryUse builds for a Wield click, through the real decoder. */
async function wield(f) {
  const slot = f.inv.getSlotForItemId(I.FIXED_DEVICE);
  const held = f.inv.getItems()[slot];
  const option = core.CacheDefinitions.getItem(held.getId()).inventoryActions.find((name) => /^(Wield|Wear)$/.test(name ?? ""));
  assert.ok(option, "the device has a Wield option");
  const body = Buffer.alloc(8 + option.length + 1);
  body.writeUInt16BE(slot, 0);
  body.writeUInt16BE(held.getId(), 2);
  body.writeInt32BE(held.getAmount(), 4);
  body.write(option, 8, "latin1");
  const packets = decodeClientPackets(Buffer.concat([Buffer.from([INVENTORY_USE_OPCODE, body.length]), body]));
  assert.equal(packets.length, 1);
  await f.c.dispatch(packets);
  f.c.processTurnPackets();
}

const worn = (f) => f.eq.getItems()[WEAPON]?.getId();

test("a second toad is refused and kept, not used up", async (t) => {
  const f = actor(t, STAGE_FIXED_DEVICE);
  f.inv.adds(I.RED_TOAD, 1);
  f.inv.adds(I.BLUE_TOAD, 1);
  await loadToad(f, I.RED_TOAD);
  assert.equal(f.inv.getAmount(I.RED_TOAD), 0, "control: the first toad loads");
  await loadToad(f, I.BLUE_TOAD);
  t.diagnostic(`messages ${f.messages}`);
  assert.equal(f.inv.getAmount(I.BLUE_TOAD), 1, "the second toad stays in the pack");
  assert.ok(f.messages.some((message) => SECOND.test(message)), "the player is told");
  assert.equal(f.p.getPacketSender().getVarbit(AMMO_VARBIT), 1, "control: still loaded");
});

test("the loaded colour survives a save and load, and still dyes its sheep", async (t) => {
  const f = actor(t, STAGE_FIXED_DEVICE);
  f.inv.adds(I.RED_TOAD, 1);
  await loadToad(f, I.RED_TOAD);
  PM.emitPlayerLogout({ player: f.p, username: f.p.getUsername() });

  const g = actor(t, STAGE_FIXED_DEVICE);
  const raw = JSON.parse(JSON.stringify(PlayerSave.fromPlayer(f.p), codec.replacer.bind(codec)), codec.reviver.bind(codec));
  codec.hydratePlayerSave(raw).applyToPlayer(g.p);
  PM.emitPlayerLogin({ player: g.p, username: g.p.getUsername(), isNewAccount: false });
  assert.equal(g.p.getPacketSender().getVarbit(AMMO_VARBIT), 1, "the ammo varbit shows loaded after login");

  const npc = core.NPC.create(WORLD_RED_SHEEP, new core.Location(HOME[0] + 1, HOME[1], 0));
  core.World.getNpcs().add(npc);
  t.after(() => core.World.getNpcs().remove(npc));
  await send(g, {
    type: "inventory_use_on", slot: g.inv.getSlotForItemId(I.FIXED_DEVICE), itemId: I.FIXED_DEVICE,
    target: { kind: "npc", id: npc.getIndex() },
  }, npc);
  assert.equal(g.p.getPacketSender().getVarbit(RED_VARBIT), 1, "the saved red toad re-dyes the red sheep");
  assert.equal(g.p.getPacketSender().getVarbit(AMMO_VARBIT), 0, "and is used");
});

test("the empty device can't be wielded; loaded, it can", async (t) => {
  const f = actor(t, STAGE_FIXED_DEVICE);
  await wield(f);
  t.diagnostic(`messages ${f.messages}`);
  assert.notEqual(worn(f), I.FIXED_DEVICE, "not wielded empty");
  assert.equal(f.inv.getAmount(I.FIXED_DEVICE), 1, "still in the pack");
  assert.ok(f.messages.some((message) => NEEDS_TOAD.test(message)), "the player is told");

  f.inv.adds(I.RED_TOAD, 1);
  await loadToad(f, I.RED_TOAD);
  await wield(f);
  assert.equal(worn(f), I.FIXED_DEVICE, "control: loaded, it is wielded");
});

test("a toad for an already dyed sheep is refused and kept, so the other three sheep can still be dyed", async (t) => {
  const f = actor(t, STAGE_FIXED_DEVICE);
  const sheep = [
    [I.RED_TOAD, 6179, 801],
    [I.BLUE_TOAD, 6181, 800],
    [I.YELLOW_TOAD, 6182, 802],
    [I.GREEN_TOAD, 6180, 803],
  ];
  const npcs = sheep.map(([, id], n) => {
    const npc = core.NPC.create(id, new core.Location(HOME[0] + 1, HOME[1] + n, 0));
    core.World.getNpcs().add(npc);
    t.after(() => core.World.getNpcs().remove(npc));
    return npc;
  });
  const fire = (n) => send(f, {
    type: "inventory_use_on", slot: f.inv.getSlotForItemId(I.FIXED_DEVICE), itemId: I.FIXED_DEVICE,
    target: { kind: "npc", id: npcs[n].getIndex() },
  }, npcs[n]);
  f.inv.adds(I.RED_TOAD, 2);
  await loadToad(f, I.RED_TOAD);
  await fire(0);
  assert.equal(f.p.getPacketSender().getVarbit(801), 1, "control: red is dyed");

  await loadToad(f, I.RED_TOAD);
  t.diagnostic(`messages ${f.messages}`);
  assert.equal(f.inv.getAmount(I.RED_TOAD), 1, "the spare red toad stays in the pack");
  assert.ok(f.messages.some((message) => DYED.test(message)), "the player is told");

  for (const n of [1, 2, 3]) {
    f.inv.adds(sheep[n][0], 1);
    await loadToad(f, sheep[n][0]);
    await fire(n);
    assert.equal(f.p.getPacketSender().getVarbit(sheep[n][2]), 1, `sheep ${n} is dyed`);
  }
  assert.equal(QuestRuntime.getRegisteredQuests().find((q) => q.key === "mournings_end_part_i").getStage(f.p), STAGE_SHEEP, "the quest moves on");
});

test("outside the loading stages the wield rule stays out of the way", async (t) => {
  const f = actor(t, STAGE_SHEEP);
  await wield(f);
  assert.equal(worn(f), I.FIXED_DEVICE, "no loading is possible here, so the rule doesn't apply");
});
