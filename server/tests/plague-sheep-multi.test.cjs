// Run after `yarn build`: node --test tests/plague-sheep-multi.test.cjs
//
// #2622: the sheep standing in the world are the cache's multi-NPCs 6179-6182, showing as 3986-3989 (with
// Prod) on varbits 801, 803, 800 and 802, and as 5305-5308 once Mourning's End Part I has re-dyed them.
//
// Native fixture: real npc_option and item_on_npc through ClientConnection.dispatch, with World's order: tasks,
// NPCs, then the player. Quest stages and equipment are set directly, and the toad is loaded through
// UseItemPacketListener.itemOnItem, the function the item-on-item packet calls. No client ran.
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
const { UseItemPacketListener } = require("../dist/net/packet/impl/UseItemPacketListener");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const HOME = [2609, 3344];
const DISPOSAL = "quest.sheep_herder.disposal";
const STAGE_DISPOSING = 2;
const STAGE_COMPLETE = 3;
const PENNED = "The sheep obligingly jumps over the gate and into the enclosure!";
// [world multi-NPC, Prod form, index in the quest's progress, pen tile]
const SHEEP = [
  [6179, 3986, 0, [2596, 3362]],
  [6180, 3987, 1, [2597, 3363]],
  [6181, 3988, 2, [2597, 3360]],
  [6182, 3989, 3, [2596, 3359]],
];
const MOURNING_STAGE_FIXED_DEVICE = 7;
const MOURNING_SHEEP = "quest.mournings_end_part_i.sheep";
const RED_VARBIT = 801;
const DYED_RED = 5305;

let core;
let I;
let next = 8300;

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

const quest = (key) => QuestRuntime.getRegisteredQuests().find((entry) => entry.key === key);

function actor(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("sheepqa" + p.getIndex());
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
  return { t, p, c, inv: p.getInventory(), messages, spawned: [] };
}

function herder(t, { suit = true, prod = true, stage = STAGE_DISPOSING } = {}) {
  const f = actor(t);
  quest("sheep_herder").setStage(f.p, stage);
  const equipment = f.p.getEquipment();
  if (suit) {
    equipment.setItem(core.Equipment.BODY_SLOT, new core.Item(I.PLAGUE_JACKET, 1));
    equipment.setItem(core.Equipment.LEG_SLOT, new core.Item(I.PLAGUE_TROUSERS, 1));
  }
  if (prod) equipment.setItem(core.Equipment.WEAPON_SLOT, new core.Item(I.CATTLEPROD, 1));
  const spawnNpc = PM.spawnNpc;
  t.mock.method(PM, "spawnNpc", (definition, ...rest) => {
    const npc = spawnNpc.call(PM, definition, ...rest);
    if (npc && definition?.owner === f.p) f.spawned.push(npc);
    return npc;
  });
  return f;
}

/** A sheep beside the player, as the world has it. */
function place(f, id) {
  const npc = core.NPC.create(id, new core.Location(HOME[0] + 1, HOME[1], 0));
  core.World.getNpcs().add(npc);
  f.t.after(() => core.World.getNpcs().remove(npc));
  return npc;
}

function tick(f, npc) {
  for (let i = 0; i < 6; i++) {
    core.TaskManager.process();
    if (npc?.isRegistered()) npc.process();
    // Player sync clears this each tick; a moveTo leaves the player busy until it does.
    f.p.needsPlacement = false;
    f.p.getMovementQueue().process();
    core.TaskManager.processWalkTo(f.p.getIndex());
  }
}

async function send(f, packet, npc) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
  tick(f, npc);
}

const prod = (f, npc) => send(f, { type: "npc_option", index: npc.getIndex(), clickType: 1 }, npc);

function useOn(f, itemId, npc) {
  const slot = f.inv.getSlotForItemId(itemId);
  return send(f, { type: "item_on_npc", targetIndex: npc.getIndex(), itemId, slot, widgetId: 3214 }, npc);
}

const loadToad = (f, toad) => UseItemPacketListener.itemOnItem(f.p, f.inv.getSlotForItemId(toad), f.inv.getSlotForItemId(I.FIXED_DEVICE));

const progress = (f, index) => ((Number(f.p.getAttribute(DISPOSAL)) || 0) >>> (index * 3)) & 7;

// ------------------------------------------------------------------ Sheep Herder

test("Sheep Herder: each sheep standing in the world can be prodded into the pen", async (t) => {
  for (const [world, form, index, pen] of SHEEP) {
    const f = herder(t);
    const npc = place(f, world);
    assert.equal(npc.getContentId(f.p), form, `control: ${world} shows as ${form}`);
    assert.equal(npc.getCurrentDefinition(f.p).getActions()[0], "Prod", "control: with Prod");
    await prod(f, npc);
    t.diagnostic(`${world}: progress ${progress(f, index)}; messages ${f.messages}`);
    assert.ok(!f.messages.includes("Nothing interesting happens."), `${world}: not "Nothing interesting happens"`);
    assert.equal(progress(f, index), 1, `${world}: penned`);
    assert.ok(f.messages.includes(PENNED), `${world}: the transcript's line`);
    const penned = f.spawned.at(-1);
    assert.deepEqual([penned?.getLocation().getX(), penned?.getLocation().getY()], pen, `${world}: in its pen tile`);
    assert.equal(npc.isRegistered(), true, `${world}: the world's sheep stays for other players`);
  }
});

test("Sheep Herder: the quest's own spawned sheep still works", async (t) => {
  const f = herder(t);
  const npc = place(f, 3986);
  // Only the spawn the quest made counts as its own: this one isn't, and isn't a world sheep either.
  f.p.setAttribute(DISPOSAL, 0);
  PM.emitPlayerLogin({ player: f.p, username: f.p.getUsername() });
  const own = f.spawned.find((entry) => entry.getId() === 3986);
  assert.ok(own, "control: the quest spawned its red sheep");
  f.p.setLocation(new core.Location(own.getLocation().getX() - 1, own.getLocation().getY(), 0));
  await prod(f, own);
  assert.equal(progress(f, 0), 1, "penned");
  assert.ok(npc.isRegistered(), "the other one is untouched");
});

test("Sheep Herder: a world sheep needs the suit, the prod and the stage, and only pens once", async (t) => {
  for (const [options, expected] of [
    [{ suit: false }, /protective plague suit/],
    [{ prod: false }, /equip the cattleprod/],
    [{ stage: STAGE_COMPLETE }, /no reason to interfere/],
  ]) {
    const f = herder(t, options);
    const npc = place(f, 6179);
    await prod(f, npc);
    assert.equal(progress(f, 0), 0, `not penned: ${JSON.stringify(options)}`);
    assert.ok(f.messages.some((message) => expected.test(message)), `told: ${f.messages}`);
  }

  const f = herder(t);
  const npc = place(f, 6179);
  await prod(f, npc);
  assert.equal(progress(f, 0), 1, "control: penned");
  const spawns = f.spawned.length;
  f.messages.length = 0;
  await prod(f, npc);
  assert.ok(f.messages.includes("This sheep is already in the enclosure."), `again: ${f.messages}`);
  assert.equal(f.spawned.length, spawns, "and no second one");
});

test("Sheep Herder: feed on a world sheep doesn't remove it; on the penned one it gives the bones", async (t) => {
  const f = herder(t);
  f.inv.adds(I.SHEEP_FEED, 1);
  const npc = place(f, 6179);
  await prod(f, npc);
  assert.equal(progress(f, 0), 1, "control: penned");

  f.messages.length = 0;
  await useOn(f, I.SHEEP_FEED, npc);
  t.diagnostic(`on the world sheep: ${f.messages}`);
  assert.equal(npc.isRegistered(), true, "the world's sheep stays");
  assert.equal(progress(f, 0), 1, "no bones from it");
  assert.ok(!f.messages.includes("Nothing interesting happens."), "and the player is told why");

  const penned = f.spawned.at(-1);
  f.p.setLocation(new core.Location(penned.getLocation().getX() + 1, penned.getLocation().getY(), 0));
  await useOn(f, I.SHEEP_FEED, penned);
  t.diagnostic(`on the penned sheep: ${f.messages}; progress ${progress(f, 0)}`);
  assert.equal(progress(f, 0), 2, "bones");
  assert.equal(f.inv.getAmount(I.SHEEP_BONES_1_), 1, "in the pack");
});

// ------------------------------------------------------------------ Mourning's End Part I

test("Mourning's End: the fixed device re-dyes a world sheep, which then shows dyed", async (t) => {
  const f = actor(t);
  quest("mournings_end_part_i").setStage(f.p, MOURNING_STAGE_FIXED_DEVICE);
  f.inv.adds(I.FIXED_DEVICE, 1);
  f.inv.adds(I.GREEN_TOAD, 1);
  f.inv.adds(I.RED_TOAD, 1);
  const npc = place(f, 6179);
  assert.equal(npc.getContentId(f.p), 3986, "control: it shows undyed");

  loadToad(f, I.GREEN_TOAD);
  assert.equal(f.inv.getAmount(I.GREEN_TOAD), 0, "control: the toad is loaded");
  await useOn(f, I.FIXED_DEVICE, npc);
  assert.equal(f.p.getPacketSender().getVarbit(RED_VARBIT), 0, "control: a green toad doesn't dye it");

  const fresh = actor(t);
  quest("mournings_end_part_i").setStage(fresh.p, MOURNING_STAGE_FIXED_DEVICE);
  fresh.inv.adds(I.FIXED_DEVICE, 1);
  fresh.inv.adds(I.RED_TOAD, 1);
  loadToad(fresh, I.RED_TOAD);
  assert.equal(fresh.inv.getAmount(I.RED_TOAD), 0, "control: the toad is loaded");
  await useOn(fresh, I.FIXED_DEVICE, npc);
  t.diagnostic(`messages ${fresh.messages}; bits ${fresh.p.getAttribute(MOURNING_SHEEP)}`);
  assert.equal(fresh.p.getPacketSender().getVarbit(RED_VARBIT), 1, "the varbit");
  assert.equal(npc.getContentId(fresh.p), DYED_RED, "it now shows dyed");
  assert.ok(!npc.getCurrentDefinition(fresh.p).getActions()[0], "with no Prod");
});
