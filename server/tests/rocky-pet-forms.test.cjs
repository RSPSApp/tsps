// Run after `yarn build`: node --test tests/rocky-pet-forms.test.cjs
// Rocky's berry forms (Wiki: Rocky): redberries make Red, poison ivy berries Ziggy, white berries Rocky
// again. Decision (2026-11-15): silent, and the berry is kept (no source gives a message or says it is
// eaten). Every plugin is loaded; the berry goes through PluginManager's item-on-NPC emitter onto a
// real pet follower.
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
let next = 5600;
const obj = (name) => core.CacheDefinitions.getObjId(name);
const npcOf = (name) => core.CacheDefinitions.getNpcId(name);

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
  p.setUsername("rocky" + p.getIndex());
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

/** Puts the Rocky item in the backpack and summons it as a real follower. */
function summon(f, name = "skillpetthieving") {
  give(f, 0, name);
  const Pets = require("../plugins/npcs/Pets.plugin");
  assert.equal(Pets.__internals.drop(f.p, obj(name), false), true);
  return { Pets, follower: f.p.getAttribute("pets:current") };
}

// Live's follower is skillpet_thieving (rsprox_transcripts/236/03963.txt), not the house's poh_skillpet_thieving.
const rockyFollower = () => npcOf("skillpet_thieving");

test("redberries make Red, poison ivy berries Ziggy and white berries Rocky again, silently, the berry kept", (t) => {
  const f = actor(t);
  const { Pets, follower } = summon(f);
  assert.equal(follower.getId(), rockyFollower());
  const said = f.messages.length; // the drop's own lines
  for (const [berry, npc, item] of [
    ["redberries", npcOf("skillpet_thieving_panda"), obj("skillpetthieving_panda")],
    ["poisonivy_berries", npcOf("skillpet_thieving_tanuki"), obj("skillpetthieving_tanuki")],
    ["white_berries", rockyFollower(), obj("skillpetthieving")],
  ]) {
    give(f, 1, berry);
    const { event } = useOnFollower(f, 1);
    assert.equal(event.handled, true, berry);
    assert.equal(follower.getId(), npc, `${berry}: the follower changes form`);
    assert.equal(f.p.getAttribute("pets:active-item"), item, `${berry}: it is picked up as that form`);
    assert.equal(f.inv.get(1)?.getId?.(), obj(berry), `${berry}: the berry is kept`);
  }
  assert.deepEqual(f.messages.slice(said), [], "no message");
  assert.equal(Pets.__internals.PET_BY_ID.get(npcOf("skillpet_thieving_panda")).dialogueVariant, "red-panda-dialogue");
  assert.equal(Pets.__internals.PET_BY_ID.get(npcOf("skillpet_thieving_tanuki")).dialogueVariant, "tanuki-dialogue");
});

test("picking up Red gives the Red item, and the berry on the form it already is changes nothing", (t) => {
  const f = actor(t);
  const { Pets, follower } = summon(f);
  give(f, 1, "redberries");
  useOnFollower(f, 1);
  const again = useOnFollower(f, 1).event;
  assert.equal(again.handled, false, "left to the default response");
  assert.equal(follower.getId(), npcOf("skillpet_thieving_panda"));
  f.inv.setItem(1, new core.Item(-1, 0));
  assert.equal(Pets.__internals.pickup(f.p, follower), true);
  assert.ok(f.inv.contains(obj("skillpetthieving_panda")), "Red goes back to the backpack as Red");
  assert.ok(!f.inv.contains(obj("skillpetthieving")));
});

test("a berry on someone else's Rocky does nothing", (t) => {
  const owner = actor(t), other = actor(t);
  const { follower } = summon(owner);
  give(other, 0, "redberries");
  const event = { player: other.p, target: follower, npcId: follower.getId(), targetIndex: follower.getIndex(),
    item: other.inv.get(0), itemId: other.inv.get(0).getId(), slot: 0, interfaceId: 3214, handled: false };
  PM.emitItemOnNpc(event);
  assert.equal(event.handled, false);
  assert.equal(follower.getId(), rockyFollower());
});
