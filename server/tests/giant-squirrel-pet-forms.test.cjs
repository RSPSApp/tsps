// Run after `yarn build`: node --test tests/giant-squirrel-pet-forms.test.cjs
// Issue 4423: the giant squirrel's Metamorphosis, the dark and calcified acorn conversions, and the
// unlocked-form cycle (Wiki: Giant Squirrel, Dark acorn, Calcified acorn). Every plugin is loaded;
// inventory uses go through PluginManager's item-on-item and item-on-NPC emitters, and the follower is
// a real pet NPC.
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
let next = 5500;
const obj = (name) => core.CacheDefinitions.getObjId(name);
const npcOf = (name) => core.CacheDefinitions.getNpcId(name);
const LOCKED = "You need a dark acorn or a calcified acorn to metamorphose your pet like that.";
const DARK_LINE = "The squirrel happily eats the dark acorn and magically turns into a darker colour. How unexpected.";
const BONE_LINE = "The squirrel carefully crunches the calcified acorn and magically turns into a skeleton. Whoops!";
const BONE_REFUSED = "Your squirrel has had enough of those. It doesn't get more skeletal than this.";

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
  p.setUsername("squirrel" + p.getIndex());
  p.setRegistered(true);
  p.setLocation(new core.Location(3222, 3218, 0));
  p.needsPlacement = false;
  const messages = [];
  const sender = p.getPacketSender();
  t.mock.method(sender, "sendMessage", (m) => { messages.push(m); return sender; });
  const c = new ClientConnection(channel);
  c.player = p;
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
    core.TaskManager.cancelTasks(p.getIndex());
    for (const n of [...core.World.getNpcs()]) if (n?.getOwner?.() === p) core.World.getNpcs().remove(n);
  });
  return { p, c, messages, inv: p.getInventory() };
}

function give(f, slot, name) { f.inv.setItem(slot, new core.Item(obj(name), 1)); }

function useOn(f, usedSlot, squirrelSlot) {
  const event = {
    player: f.p, usedItem: f.inv.get(usedSlot), usedItemId: f.inv.get(usedSlot).getId(), usedItemSlot: usedSlot,
    usedWithItem: f.inv.get(squirrelSlot), usedWithItemId: f.inv.get(squirrelSlot).getId(), usedWithItemSlot: squirrelSlot, handled: false,
  };
  PM.emitItemOnItem(event);
  return event;
}

function useOnFollower(f, slot) {
  const follower = f.p.getAttribute("pets:current");
  const event = { player: f.p, target: follower, npcId: follower.getId(), targetIndex: follower.getIndex(),
    item: f.inv.get(slot), itemId: f.inv.get(slot).getId(), slot, interfaceId: 3214, handled: false };
  PM.emitItemOnNpc(event);
  return { event, follower };
}

/** Puts the squirrel item in the backpack and summons it as a real follower. */
function summon(f, name = "skillpetagility") {
  give(f, 0, name);
  const Pets = require("../plugins/npcs/Pets.plugin");
  assert.equal(Pets.__internals.drop(f.p, obj(name), false), true);
  return { Pets, follower: f.p.getAttribute("pets:current") };
}

test("a locked squirrel's Metamorphosis says which acorns to feed it and stays a giant", (t) => {
  const f = actor(t);
  const { Pets, follower } = summon(f);
  assert.equal(Pets.__internals.morph(f.p, follower), true);
  assert.ok(f.messages.includes(LOCKED));
  assert.equal(follower.getId(), npcOf("skillpet_agility"));
  assert.equal(f.p.getAttribute("pets:active-item"), obj("skillpetagility"));
});

test("a dark acorn on the squirrel item unlocks the dark form and turns the item", (t) => {
  const f = actor(t);
  give(f, 0, "skillpetagility");
  give(f, 1, "dark_acorn");
  assert.equal(useOn(f, 1, 0).handled, true);
  assert.equal(f.inv.get(1)?.getId?.() ?? -1, -1, "the acorn is eaten");
  assert.deepEqual(f.p.getAttribute("pets:giant-squirrel-unlocks"), ["dark"]);
  assert.equal(f.inv.get(0).getId(), obj("skillpetagility_dark"));
  assert.ok(f.messages.includes(DARK_LINE));
  assert.ok(f.p.getAttribute("pets.owned").includes(obj("skillpetagility_dark")), "insurance follows the new form");
  assert.ok(!f.p.getAttribute("pets.owned").includes(obj("skillpetagility")), "one record per pet");
});

test("a calcified acorn turns the squirrel skeletal, and a second one is refused without being eaten", (t) => {
  const f = actor(t);
  give(f, 0, "skillpetagility");
  give(f, 1, "calcified_acorn");
  assert.equal(useOn(f, 1, 0).handled, true);
  assert.equal(f.inv.get(0).getId(), obj("skillpetagility_bone"));
  assert.deepEqual(f.p.getAttribute("pets:giant-squirrel-unlocks"), ["bone"]);
  assert.ok(f.messages.includes(BONE_LINE));

  give(f, 1, "calcified_acorn");
  assert.equal(useOn(f, 1, 0).handled, true);
  assert.equal(f.inv.get(0).getId(), obj("skillpetagility_bone"));
  assert.equal(f.inv.get(1).getId(), obj("calcified_acorn"), "a bone squirrel does not eat another");
  assert.ok(f.messages.includes(BONE_REFUSED));
});

test("Metamorphosis cycles giant, dark and bone through the unlocked forms", (t) => {
  const f = actor(t);
  f.p.setAttribute("pets:giant-squirrel-unlocks", ["dark", "bone"]);
  const { Pets, follower } = summon(f);
  const seen = [];
  for (let i = 0; i < 3; i++) {
    assert.equal(Pets.__internals.morph(f.p, follower), true);
    seen.push(follower.getId());
  }
  assert.deepEqual(seen, [npcOf("skillpet_agility_dark"), npcOf("skillpet_agility_bone"), npcOf("skillpet_agility")]);
  assert.equal(f.p.getAttribute("pets:active-item"), obj("skillpetagility"));
});

test("Metamorphosis skips a form that has not been unlocked", (t) => {
  const f = actor(t);
  f.p.setAttribute("pets:giant-squirrel-unlocks", ["bone"]);
  const { Pets, follower } = summon(f);
  assert.equal(Pets.__internals.morph(f.p, follower), true);
  assert.equal(follower.getId(), npcOf("skillpet_agility_bone"));
  assert.equal(Pets.__internals.morph(f.p, follower), true);
  assert.equal(follower.getId(), npcOf("skillpet_agility"), "bone goes back to the always-available giant form");
});

test("an acorn used on the follower unlocks and changes it, and the item it drops is that form", (t) => {
  const f = actor(t);
  f.p.setAttribute("pets:giant-squirrel-unlocks", ["dark"]);
  const { Pets, follower } = summon(f);
  assert.equal(Pets.__internals.morph(f.p, follower), true);
  assert.equal(follower.getId(), npcOf("skillpet_agility_dark"));

  give(f, 1, "calcified_acorn");
  const { event } = useOnFollower(f, 1);
  assert.equal(event.handled, true);
  assert.equal(follower.getId(), npcOf("skillpet_agility_bone"));
  assert.equal(f.p.getAttribute("pets:active-item"), obj("skillpetagility_bone"));
  assert.deepEqual(f.p.getAttribute("pets:giant-squirrel-unlocks"), ["dark", "bone"]);
  assert.equal(f.inv.get(1)?.getId?.() ?? -1, -1, "the acorn is eaten");
  assert.equal(Pets.__internals.pickup(f.p, follower), true);
  assert.ok(f.p.getAttribute("pets.owned").includes(obj("skillpetagility_bone")), "the dropped item is the form just shown");
});

test("another player's squirrel does not eat the acorn", (t) => {
  const owner = actor(t);
  const other = actor(t);
  give(owner, 0, "dark_acorn");
  const { follower } = summon(other);
  const event = { player: owner.p, target: follower, npcId: follower.getId(), targetIndex: follower.getIndex(),
    item: owner.inv.get(0), itemId: obj("dark_acorn"), slot: 0, interfaceId: 3214, handled: false };
  PM.emitItemOnNpc(event);
  assert.equal(event.handled, false);
  assert.equal(owner.inv.get(0).getId(), obj("dark_acorn"), "the acorn stays with its owner");
  assert.equal(follower.getId(), npcOf("skillpet_agility"));
});
