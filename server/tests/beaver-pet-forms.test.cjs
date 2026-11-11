// Run after `yarn build`: node --test tests/beaver-pet-forms.test.cjs
// Issue 4463: the beaver's Metamorphosis, the Funky shaped log, pheasant egg and fox whistle unlocks, and
// recolouring with logs (Wiki: Beaver, Funky shaped log), with the locked messagebox and the locked
// log use as captured (rsprox 2780 tick 349, 2783 ticks 160-172). Every plugin is loaded; inventory
// clicks go through the real packet dispatch, uses through PluginManager's item-on-item and
// item-on-NPC emitters, and the follower is a real pet NPC.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");

let core;
let next = 5400;
const obj = (name) => core.CacheDefinitions.getObjId(name);
const npcOf = (name) => core.CacheDefinitions.getNpcId(name);
const MESSAGEBOX_TEXT = (229 << 16) | 3;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3222, 3218);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("beaver" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(3222, 3218, 0));
  p.needsPlacement = false;
  const messages = [];
  const strings = new Map();
  const sender = p.getPacketSender();
  const sendString = sender.sendString.bind(sender);
  t.mock.method(sender, "sendMessage", (m) => { messages.push(m); return sender; });
  t.mock.method(sender, "sendString", (text, uid) => { strings.set(uid, text); return sendString(text, uid); });
  const c = new ClientConnection(channel);
  c.player = p;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
    for (const n of [...core.World.getNpcs()]) if (n?.getOwner?.() === p) core.World.getNpcs().remove(n);
  });
  return { p, c, messages, strings, inv: p.getInventory() };
}

async function metamorphosis(f, slot = 0) {
  const itemId = f.inv.get(slot).getId();
  await f.c.dispatch([{ type: "inventory_action", slot, itemId, widgetId: 3214, option: "Metamorphosis" }]);
  f.c.processTurnPackets();
}

function useOn(f, usedSlot, beaverSlot) {
  const event = {
    player: f.p, usedItem: f.inv.get(usedSlot), usedItemId: f.inv.get(usedSlot).getId(), usedItemSlot: usedSlot,
    usedWithItem: f.inv.get(beaverSlot), usedWithItemId: f.inv.get(beaverSlot).getId(), usedWithItemSlot: beaverSlot, handled: false,
  };
  PM.emitItemOnItem(event);
  return event;
}

function give(f, slot, name) { f.inv.setItem(slot, new core.Item(obj(name), 1)); }

test("a locked beaver's Metamorphosis opens the captured messagebox and stays a beaver", async (t) => {
  const f = actor(t);
  give(f, 0, "skillpetwc");
  await metamorphosis(f);
  assert.equal(f.strings.get(MESSAGEBOX_TEXT),
    "You can unlock the ability for your pet Beaver to change colour by<br>feeding it a <col=0000b2>Funky shaped log</col>.");
  assert.equal(f.inv.get(0).getId(), obj("skillpetwc"));
});

test("a log on a locked beaver is not taken: the engine's Nothing interesting happens", (t) => {
  const f = actor(t);
  give(f, 0, "skillpetwc");
  give(f, 1, "magic_logs");
  assert.equal(useOn(f, 1, 0).handled, false);
  assert.equal(f.inv.get(1).getId(), obj("magic_logs"));
});

test("the funky shaped log unlocks colours once, and each log then recolours the beaver item", (t) => {
  const f = actor(t);
  give(f, 0, "skillpetwc");
  give(f, 1, "forestry_funky_shaped_log");
  assert.equal(useOn(f, 1, 0).handled, true);
  assert.equal(f.inv.get(1)?.getId?.() ?? -1, -1, "the funky log is used up");
  assert.deepEqual(f.p.getAttribute("pets:beaver-unlocks"), ["colours"]);
  give(f, 1, "magic_logs");
  assert.equal(useOn(f, 1, 0).handled, true);
  assert.equal(f.inv.get(0).getId(), obj("skillpet_wc_magic"));
  assert.equal(f.inv.get(1)?.getId?.() ?? -1, -1, "the log is used up");
  assert.ok(f.p.getAttribute("pets.owned").includes(obj("skillpet_wc_magic")), "insurance follows the new form");
  assert.ok(!f.p.getAttribute("pets.owned").includes(obj("skillpetwc")), "one record per pet");
  give(f, 1, "logs");
  useOn(f, 1, 0);
  assert.equal(f.inv.get(0).getId(), obj("skillpetwc"), "plain logs give the default colour back");
});

test("Metamorphosis cycles beaver, pheasant and fox once unlocked; a recoloured beaver comes back default", async (t) => {
  const f = actor(t);
  f.p.setAttribute("pets:beaver-unlocks", ["colours"]);
  give(f, 0, "skillpet_wc_yew");
  await metamorphosis(f);
  assert.ok(f.messages.includes("Your pet can't change like that."), "colours alone give no form to change to");
  assert.equal(f.inv.get(0).getId(), obj("skillpet_wc_yew"));
  give(f, 1, "forestry_pheasant_pet_egg");
  useOn(f, 1, 0);
  give(f, 1, "forestry_fox_pet_whistle");
  useOn(f, 1, 0);
  assert.deepEqual(f.p.getAttribute("pets:beaver-unlocks"), ["colours", "pheasant", "fox"]);
  const seen = [];
  for (let i = 0; i < 3; i++) { await metamorphosis(f); seen.push(f.inv.get(0).getId()); }
  assert.deepEqual(seen, [obj("skillpet_wc_pheasant"), obj("skillpet_wc_fox"), obj("skillpetwc")]);
});

test("the follower's Metamorphosis and a log used on it change the follower and its item record", (t) => {
  const f = actor(t);
  f.p.setAttribute("pets:beaver-unlocks", ["colours", "fox"]);
  give(f, 0, "skillpetwc");
  const Pets = require("../plugins/npcs/Pets.plugin");
  assert.equal(Pets.__internals.drop(f.p, obj("skillpetwc"), false), true);
  const follower = f.p.getAttribute("pets:current");
  assert.equal(Pets.__internals.morph(f.p, follower), true);
  assert.equal(follower.getId(), npcOf("skillpet_wc_fox"));
  assert.equal(f.p.getAttribute("pets:active-item"), obj("skillpet_wc_fox"));
  give(f, 1, "oak_logs");
  const event = { player: f.p, target: follower, npcId: follower.getId(), targetIndex: follower.getIndex(),
    item: f.inv.get(1), itemId: obj("oak_logs"), slot: 1, interfaceId: 3214, handled: false };
  PM.emitItemOnNpc(event);
  assert.equal(event.handled, true);
  assert.equal(follower.getId(), npcOf("skillpet_wc_oak"));
  assert.equal(f.p.getAttribute("pets:active-item"), obj("skillpet_wc_oak"));
});

test("a form changed in the inventory is the form the next summon brings out", (t) => {
  const f = actor(t);
  f.p.setAttribute("pets:beaver-unlocks", ["colours"]);
  give(f, 0, "skillpetwc");
  const Pets = require("../plugins/npcs/Pets.plugin");
  assert.equal(Pets.__internals.drop(f.p, obj("skillpetwc"), false), true);
  f.inv.setItem(0, new core.Item(-1, 0));
  const follower = f.p.getAttribute("pets:current");
  give(f, 1, "oak_logs");
  PM.emitItemOnNpc({ player: f.p, target: follower, npcId: follower.getId(), targetIndex: follower.getIndex(),
    item: f.inv.get(1), itemId: obj("oak_logs"), slot: 1, interfaceId: 3214, handled: false });
  assert.equal(follower.getId(), npcOf("skillpet_wc_oak"));
  assert.equal(Pets.__internals.pickup(f.p, follower), true);
  const slot = f.inv.getSlotForItemId(obj("skillpet_wc_oak"));
  give(f, slot === 0 ? 1 : 0, "logs");
  useOn(f, slot === 0 ? 1 : 0, slot);
  assert.equal(f.inv.get(slot).getId(), obj("skillpetwc"));
  f.p.setAttribute("pets:current", null);
  assert.equal(Pets.__internals.drop(f.p, obj("skillpetwc"), false), true);
  assert.equal(f.p.getAttribute("pets:current").getId(), npcOf("skillpetwc"), "the default beaver follows, not the old oak one");
});
