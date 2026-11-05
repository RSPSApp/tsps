// Run after `yarn build`: node --test tests/gem-bag-gains.test.cjs
//
// The real gem bag (12020, open 24481), by item click and by the paths that gain gems. Wiki (Gem
// bag): an open bag takes gems picked up or got by Mining and Thieving, TzHaar-Hur and Vyre citizens
// among them. Transcript:Gem bag has the lines, and says a gem goes to the inventory when the bag
// has no room. Its Fill entry is a stage direction, not a message, so Fill says nothing. No capture
// shows these lines. Neither page covers a full bag and a full inventory together, nor whether the
// open state survives a logout: the floor and the saved state are ours. Stars go through
// Rewards.rollGemTable directly, not a star session.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { before, after, test } = require("node:test");
// The real save backend, in a throwaway database.
const savesDir = fs.mkdtempSync(path.join(os.tmpdir(), "gem-bag-saves-"));
process.env.PLAYER_SAVE_DATABASE_PATH = path.join(savesDir, "players.sqlite");
process.env.PLAYER_SAVE_IMPORT_LEGACY_JSON = "0";
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const Storage = require("../plugins/items/storage/Common.StorageItems");
const Rewards = require("../plugins/skills/shootingstars/Rewards.ShootingStars");

const HOME = [3222, 3218];
const ROCK = [3223, 3218];
const STRAIGHT_IN = "You put it straight into your open gem bag.";
const OPENED = "You open your gem bag, ready to fill it.";
const CLOSED = "You close your gem bag.";
const TOO_FULL = "Your bag is too full to hold all your gems.";
const NOTHING_SUITABLE = "You have nothing suitable for storing in the bag.";
const CUT_GEM = "Only uncut gems can be stored in the bag.";
const found = (gem) => `You just found a ${gem}!`;
const PER_GEM = 60;
/** A hit on the mining gem table's 1/256, then its last row, a diamond. */
const MINED_GEM = 0.9999;
/** TzHaar-Hur's table, Tokkul 182/195 then Uncut sapphire 5/195: this lands on the sapphire. */
const SAPPHIRE_ROLL = 0.94;
const ATTEMPT_SUCCEEDS = 0.5;

let core;
let I;
let GEM_BAG;
let OPEN_GEM_BAG;
let family;
let next = 9500;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  GEM_BAG = core.CacheDefinitions.getObjId("gem_bag");
  OPEN_GEM_BAG = core.CacheDefinitions.getObjId("gem_bag_open");
  family = Storage.FAMILIES.get("gem-bag");
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(...HOME);
  PM.emitServerStartup({});
});
after(() => {
  PM.emitServerShutdown({});
  // The backend keeps its database open until exit, and Windows won't delete it before then.
  process.once("exit", () => {
    try {
      fs.rmSync(savesDir, { recursive: true, force: true });
    } catch {
      // Left in the temp directory.
    }
  });
});

function actor(t, bagId) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("gemqa" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(HOME[0], HOME[1], 0));
  p.needsPlacement = false;
  const c = new ClientConnection(channel);
  c.player = p;
  const messages = [];
  const sendMessage = p.sendMessage.bind(p);
  t.mock.method(p, "sendMessage", (text) => { messages.push(String(text)); return sendMessage(text); });
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
    core.TaskManager.cancelTasks(p);
  });
  if (bagId !== undefined) p.getInventory().add(new core.Item(bagId), true);
  return { p, c, inv: p.getInventory(), messages };
}

function ticks(f, count) {
  for (let i = 0; i < count; i++) {
    f.p.needsPlacement = false;
    core.TaskManager.processWalkTo(f.p.getIndex());
    f.p.getMovementQueue().process();
    core.TaskManager.process();
  }
  f.p.needsPlacement = false;
}

async function send(f, packet) {
  await f.c.dispatch([packet]);
  f.c.processTurnPackets();
}

async function click(f, itemId, option) {
  const slot = f.inv.getSlotForItemId(itemId);
  assert.ok(slot >= 0, `control: ${itemId} is held`);
  await send(f, { type: "inventory_action", slot, itemId, widgetId: 3214, option });
  ticks(f, 1);
}

function fillPack(f) {
  while (f.inv.getFreeSlots() > 0) f.inv.add(new core.Item(I.RAKE), false);
  f.inv.refreshItems();
}

const stored = (f, id) => Storage.amountOf(f.p, family, id);
const fullOf = (f, id) => Storage.store(f.p, family, id, PER_GEM);
const onFloor = (f, id) => core.World.getItems()
  .filter((ground) => ground.getItem().getId() === id && ground.getOwner() === f.p.getUsername())
  .reduce((sum, ground) => sum + ground.getItem().getAmount(), 0);

function setLevel(f, skill) {
  f.p.getSkillManager().setCurrentLevel(skill, 99, false);
  f.p.getSkillManager().setMaxLevel(skill, 99);
}

/** Mines by packet with every roll forced onto a gem; returns how many gems the player was told of. */
async function mineGems(t, f, rockId) {
  f.inv.add(new core.Item(I.BRONZE_PICKAXE), true);
  setLevel(f, core.Skill.MINING);
  const rock = new core.GameObject(rockId, new core.Location(ROCK[0], ROCK[1], 0), 10, 0, null);
  core.ObjectManager.register(rock, true);
  t.after(() => core.ObjectManager.deregister(rock, true));
  t.mock.method(Math, "random", () => MINED_GEM);
  await send(f, { type: "object_option", id: rockId, x: ROCK[0], y: ROCK[1], action: "Mine" });
  ticks(f, 30);
  const found = f.messages.filter((text) => text === "You just found a Diamond!").length;
  assert.ok(found > 0, `control: a gem was found: ${JSON.stringify(f.messages)}`);
  return found;
}

/** Pickpockets a TzHaar-Hur by packet, with its loot roll forced (by default onto a sapphire). */
async function pickpocket(t, f, lootRoll = SAPPHIRE_ROLL) {
  setLevel(f, core.Skill.THIEVING);
  f.inv.add(new core.Item(I.FIRE_CAPE), true);
  const npc = core.NPC.create(core.CacheDefinitions.getNpcId("tzhaar_hur_city1"), new core.Location(HOME[0] + 1, HOME[1], 0));
  core.World.getNpcs().add(npc);
  t.after(() => core.World.getNpcs().remove(npc));
  const index = npc.getDefinition().getActions().findIndex((action) => action === "Pickpocket");
  assert.ok(index >= 0, "control: the NPC has Pickpocket");
  t.mock.method(Math, "random", () => (new Error().stack.includes("rollLoot") ? lootRoll : ATTEMPT_SUCCEEDS));
  await send(f, { type: "npc_option", index: npc.getIndex(), clickType: index + 1 });
  ticks(f, 6);
}

// ------------------------------------------------------------------ Item clicks

test("Open and Close swap the real bag in place, with the Wiki's lines", async (t) => {
  const f = actor(t, GEM_BAG);
  await click(f, GEM_BAG, "Open");
  assert.equal(f.inv.getAmount(OPEN_GEM_BAG), 1);
  assert.equal(f.messages.at(-1), OPENED);
  await click(f, OPEN_GEM_BAG, "Close");
  assert.equal(f.inv.getAmount(GEM_BAG), 1);
  assert.equal(f.messages.at(-1), CLOSED);
});

for (const [closed, open] of [
  ["coal_bag", "coal_bag_open"],
  ["fish_barrel_closed", "fish_barrel_open"],
  ["fish_sack_barrel_closed", "fish_sack_barrel_open"],
  ["log_basket_closed", "log_basket_open"],
]) {
  test(`${closed} opens and closes by click (control)`, async (t) => {
    const [closedId, openId] = [closed, open].map((name) => core.CacheDefinitions.getObjId(name));
    const f = actor(t, closedId);
    await click(f, closedId, "Open");
    assert.equal(f.inv.getAmount(openId), 1);
    await click(f, openId, "Close");
    assert.equal(f.inv.getAmount(closedId), 1);
  });
}

test("Fill with no gems, and with the bag full of that gem: the Wiki's lines, and the gem stays", async (t) => {
  const f = actor(t, GEM_BAG);
  await click(f, GEM_BAG, "Fill");
  assert.equal(f.messages.at(-1), NOTHING_SUITABLE);
  fullOf(f, I.UNCUT_RUBY);
  f.inv.add(new core.Item(I.UNCUT_RUBY), true);
  await click(f, GEM_BAG, "Fill");
  assert.equal(f.messages.at(-1), TOO_FULL);
  assert.equal(f.inv.getAmount(I.UNCUT_RUBY), 1);
  assert.equal(stored(f, I.UNCUT_RUBY), PER_GEM);
});

test("Fill with room stores what fits and says nothing", async (t) => {
  const f = actor(t, GEM_BAG);
  Storage.store(f.p, family, I.UNCUT_RUBY, PER_GEM - 1);
  f.inv.add(new core.Item(I.UNCUT_RUBY), true);
  f.inv.add(new core.Item(I.UNCUT_RUBY), true);
  await click(f, GEM_BAG, "Fill");
  assert.equal(stored(f, I.UNCUT_RUBY), PER_GEM);
  assert.equal(f.inv.getAmount(I.UNCUT_RUBY), 1, "the one with no room stays");
  assert.deepEqual(f.messages, []);
});

test("a cut gem used on the bag is refused with the Wiki's line", async (t) => {
  const f = actor(t, GEM_BAG);
  f.inv.add(new core.Item(I.RUBY), true);
  const slot = f.inv.getSlotForItemId(I.RUBY);
  const bagSlot = f.inv.getSlotForItemId(GEM_BAG);
  await send(f, { type: "inventory_use_on", slot, itemId: I.RUBY, target: { kind: "inventory", slot: bagSlot, itemId: GEM_BAG } });
  ticks(f, 1);
  assert.equal(f.messages.at(-1), CUT_GEM);
  assert.equal(f.inv.getAmount(I.RUBY), 1);
  assert.equal(Storage.total(f.p, family), 0);
});

test("Check gives the Wiki's two lines, empty or not", async (t) => {
  const f = actor(t, GEM_BAG);
  await click(f, GEM_BAG, "Check");
  assert.deepEqual(f.messages.slice(-2), ["Sapphires: 0 / Emeralds: 0 / Rubies: 0", "Diamonds: 0 / Dragonstones: 0"]);
  Storage.store(f.p, family, I.UNCUT_RUBY, 3);
  Storage.store(f.p, family, I.UNCUT_DIAMOND, 2);
  await click(f, GEM_BAG, "Check");
  assert.deepEqual(f.messages.slice(-2), ["Sapphires: 0 / Emeralds: 0 / Rubies: 3", "Diamonds: 2 / Dragonstones: 0"]);
});

test("Empty brings back what fits and keeps the rest (control)", async (t) => {
  const f = actor(t, GEM_BAG);
  Storage.store(f.p, family, I.UNCUT_RUBY, 3);
  fillPack(f);
  f.inv.setItem(f.inv.getItems().findIndex((held) => held?.getId() === I.RAKE), new core.Item(-1, 0));
  await click(f, GEM_BAG, "Empty");
  assert.equal(f.inv.getAmount(I.UNCUT_RUBY), 1);
  assert.equal(stored(f, I.UNCUT_RUBY), 2, "what didn't fit stays stored");
});

// ------------------------------------------------------------------ Save and reload

test("stored gems and the open state survive a save and reload, and Empty still returns them (control)", async (t) => {
  const f = actor(t, GEM_BAG);
  f.inv.add(new core.Item(I.UNCUT_RUBY), true);
  f.inv.add(new core.Item(I.UNCUT_RUBY), true);
  f.inv.add(new core.Item(I.UNCUT_DIAMOND), true);
  await click(f, GEM_BAG, "Fill");
  await click(f, GEM_BAG, "Open");
  const username = f.p.getUsername();
  PM.emitPlayerLogout({ player: f.p, username });
  const backend = core.GameConstants.PLAYER_PERSISTENCE;
  backend.save(f.p, "logout");
  await backend.flush();
  const g = actor(t);
  g.p.setUsername(username);
  backend.load(username).applyToPlayer(g.p);
  PM.emitPlayerLogin({ player: g.p, username });
  PM.emitCustomEvent("player:bootstrap-complete", { player: g.p, username });
  assert.equal(g.inv.getAmount(OPEN_GEM_BAG), 1, "still open");
  assert.equal(stored(g, I.UNCUT_RUBY), 2);
  assert.equal(stored(g, I.UNCUT_DIAMOND), 1);
  await click(g, OPEN_GEM_BAG, "Empty");
  assert.deepEqual([g.inv.getAmount(I.UNCUT_RUBY), g.inv.getAmount(I.UNCUT_DIAMOND)], [2, 1]);
  assert.equal(Storage.total(g.p, family), 0, "no dupe");
});

// ------------------------------------------------------------------ Mining

test("mining: an open bag takes each gem, once (control)", async (t) => {
  const f = actor(t, OPEN_GEM_BAG);
  const found = await mineGems(t, f, core.CacheDefinitions.getLocId("copperrock1"));
  assert.equal(stored(f, I.UNCUT_DIAMOND), found);
  assert.equal(f.inv.getAmount(I.UNCUT_DIAMOND), 0);
  assert.ok(f.messages.includes(STRAIGHT_IN));
});

test("mining: a closed bag leaves the gem in the inventory (control)", async (t) => {
  const f = actor(t, GEM_BAG);
  const found = await mineGems(t, f, core.CacheDefinitions.getLocId("copperrock1"));
  assert.equal(stored(f, I.UNCUT_DIAMOND), 0);
  assert.equal(f.inv.getAmount(I.UNCUT_DIAMOND), found);
});

test("mining: a bag full of that gem sends it to the inventory (control)", async (t) => {
  const f = actor(t, OPEN_GEM_BAG);
  fullOf(f, I.UNCUT_DIAMOND);
  const found = await mineGems(t, f, core.CacheDefinitions.getLocId("copperrock1"));
  assert.equal(stored(f, I.UNCUT_DIAMOND), PER_GEM);
  assert.equal(f.inv.getAmount(I.UNCUT_DIAMOND), found);
});

test("mining: a full bag and a full inventory put the gem on the floor, not nowhere", async (t) => {
  const f = actor(t, OPEN_GEM_BAG);
  fullOf(f, I.UNCUT_DIAMOND);
  // An open coal bag with room is what lets mining go on with a full inventory.
  f.inv.add(new core.Item(core.CacheDefinitions.getObjId("coal_bag_open")), true);
  f.inv.add(new core.Item(I.BRONZE_PICKAXE), true);
  fillPack(f);
  f.inv.delete(I.BRONZE_PICKAXE, 1); // mineGems hands it back, into this last slot
  const found = await mineGems(t, f, core.CacheDefinitions.getLocId("coalrock1"));
  assert.equal(f.inv.getFreeSlots(), 0, "control: the inventory stayed full");
  assert.equal(stored(f, I.UNCUT_DIAMOND), PER_GEM);
  assert.equal(onFloor(f, I.UNCUT_DIAMOND), found);
});

// ------------------------------------------------------------------ Shooting stars

const STAR_GEM = () => {
  const rolls = [0.003, 0.999];
  return () => rolls.shift();
};

test("stars: an open bag takes the gem, the find line first", (t) => {
  const f = actor(t, OPEN_GEM_BAG);
  assert.equal(Rewards.rollGemTable(f.p, STAR_GEM()), true);
  assert.equal(stored(f, I.UNCUT_DIAMOND), 1);
  assert.equal(f.inv.getAmount(I.UNCUT_DIAMOND), 0);
  assert.deepEqual(f.messages, [found("Diamond"), STRAIGHT_IN]);
});

test("stars: a full bag and a full inventory put the gem on the floor, not nowhere", (t) => {
  const f = actor(t, OPEN_GEM_BAG);
  fullOf(f, I.UNCUT_DIAMOND);
  fillPack(f);
  assert.equal(Rewards.rollGemTable(f.p, STAR_GEM()), true);
  assert.equal(stored(f, I.UNCUT_DIAMOND), PER_GEM);
  assert.equal(onFloor(f, I.UNCUT_DIAMOND), 1);
});

// ------------------------------------------------------------------ Pickpocketing

test("pickpocketing: an open bag takes the gem, the find line first", async (t) => {
  const f = actor(t, OPEN_GEM_BAG);
  await pickpocket(t, f);
  assert.equal(stored(f, I.UNCUT_SAPPHIRE), 1);
  assert.equal(f.inv.getAmount(I.UNCUT_SAPPHIRE), 0, "no dupe");
  const at = f.messages.indexOf(found("Sapphire"));
  assert.ok(at >= 0, JSON.stringify(f.messages));
  assert.equal(f.messages[at + 1], STRAIGHT_IN);
});

test("pickpocketing: other loot stays out of an open bag", async (t) => {
  const f = actor(t, OPEN_GEM_BAG);
  await pickpocket(t, f, 0.5); // Tokkul, the table's first row
  assert.ok(f.inv.getAmount(I.TOKKUL) > 0, "control: the pickpocket landed");
  assert.equal(Storage.total(f.p, family), 0);
  assert.equal(f.messages.some((text) => text.startsWith("You just found")), false, JSON.stringify(f.messages));
});

test("pickpocketing: doubled gems with room for one store one and hand over one", async (t) => {
  const f = actor(t, OPEN_GEM_BAG);
  Storage.store(f.p, family, I.UNCUT_SAPPHIRE, PER_GEM - 1);
  // The hook a league relic doubles loot by; the rogue outfit multiplies the same total.
  PM.createApi(`GemBagDouble${f.p.getIndex()}`).onCustomEvent("thieving:loot", (event) => {
    if (event.player === f.p) event.multiplier = 2;
  });
  await pickpocket(t, f);
  assert.equal(stored(f, I.UNCUT_SAPPHIRE), PER_GEM);
  assert.equal(f.inv.getAmount(I.UNCUT_SAPPHIRE), 1);
  assert.equal(f.messages.filter((text) => text === found("Sapphire")).length, 1, "one find line for the one loot row");
});

test("pickpocketing: a closed bag leaves the gem in the inventory, with no bag lines (control)", async (t) => {
  const f = actor(t, GEM_BAG);
  await pickpocket(t, f);
  assert.equal(stored(f, I.UNCUT_SAPPHIRE), 0);
  assert.equal(f.inv.getAmount(I.UNCUT_SAPPHIRE), 1);
  assert.equal(f.messages.some((text) => text === found("Sapphire") || text === STRAIGHT_IN), false, JSON.stringify(f.messages));
});

test("pickpocketing: a bag full of that gem sends it to the inventory, with the find line alone", async (t) => {
  const f = actor(t, OPEN_GEM_BAG);
  fullOf(f, I.UNCUT_SAPPHIRE);
  await pickpocket(t, f);
  assert.equal(stored(f, I.UNCUT_SAPPHIRE), PER_GEM);
  assert.equal(f.inv.getAmount(I.UNCUT_SAPPHIRE), 1);
  assert.ok(f.messages.includes(found("Sapphire")), JSON.stringify(f.messages));
  assert.equal(f.messages.includes(STRAIGHT_IN), false, JSON.stringify(f.messages));
});
