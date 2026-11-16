// Run after `yarn build`: node --test tests/tears-of-guthix-chasm.test.cjs
//
// The Chasm of Tears crossing: the light creatures are NPC 5435 (the only id spawned there) with
// Attract as their cache option, so the lantern must work through that option as well as item-on-NPC.
// The chasm rocks are one-tile slopes, not teleports to the other ledge. Real plugins, Player and
// cache definitions; the events are the ones the packet listeners emit.
process.env.DISABLE_PLAYER_BOTS = "1";
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const LIGHT_CREATURE = 5435;
const LIT_LANTERN = 4702;
const ROCK_SOUTH = 6672;
const ROCK_NORTH = 6673;
let core;
let index = 7700;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function player(t, name, x, y, z = 2) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(index++);
  p.setUsername(name);
  p.setRegistered(true);
  p.setLocation(new core.Location(x, y, z));
  p.needsPlacement = false;
  const messages = [];
  const send = p.sendMessage.bind(p);
  p.sendMessage = (text, ...rest) => { messages.push(String(text)); return send(text, ...rest); };
  QuestRuntime.getRegisteredQuests().find((entry) => entry.key === "tears_of_guthix").setStage(p, 1);
  t.after(() => {
    PM.emitPlayerLogout({ player: p, username: p.getUsername() });
    p.setRegistered(false);
  });
  return { p, messages };
}

function tickTasks(times = 6) {
  for (let tick = 0; tick < times; tick++) core.TaskManager.process();
}

const creature = (x, y) => ({
  getId: () => LIGHT_CREATURE,
  getLocation: () => new core.Location(x, y, 2),
  getIndex: () => 1,
});
const definition = () => core.NpcDefinition.forId(LIGHT_CREATURE);

function npcEvent(p, npc, extra = {}) {
  return { player: p, npc, npcId: LIGHT_CREATURE, npcIndex: 1, definition: definition(),
    clickType: 1, location: { x: npc.getLocation().getX(), y: npc.getLocation().getY(), z: 2 },
    handled: false, ...extra };
}

function rock(x, y, id) {
  return {
    getId: () => id,
    getLocation: () => new core.Location(x, y, 2),
    getDefinition: () => ({ getName: () => "Rocks", getInteractions: () => ["Climb"] }),
  };
}

function climb(p, x, y, id) {
  return PM.emitObjectInteraction({
    player: p, object: rock(x, y, id), objectId: id,
    definition: { getName: () => "Rocks", getInteractions: () => ["Climb"] }, clickType: 1,
    option: "Climb", location: { x, y, z: 2 }, handled: false,
  });
}

test("the lantern reaches a Chasm light creature and carries the player to the magic rocks", (t) => {
  const { p, messages } = player(t, "toglantern1", 3234, 9525);
  p.getInventory().adds(LIT_LANTERN, 1);
  const npc = creature(3226, 9518);

  const route = npcEvent(p, npc, { itemId: LIT_LANTERN, clickType: 0 });
  PM.emitNpcRoute(route);
  assert.equal(route.range, 8, "the ledge reaches the creature across the pool");
  assert.equal(route.ignoreProjectileClip, true);

  const use = {
    player: p, target: npc, npcId: LIGHT_CREATURE, targetIndex: 1, item: { getId: () => LIT_LANTERN },
    itemId: LIT_LANTERN, slot: 0, interfaceId: 149 << 16, definition: definition(), handled: false,
  };
  assert.equal(PM.emitItemOnNpc(use), true, "the lit lantern is accepted");
  assert.ok(messages.includes("The light creature is attracted to your beam and comes towards you..."));
  tickTasks(7);
  assert.equal(p.getLocation().getX(), 3234, "the seven-tick approach leaves the player on the ledge");
  assert.equal(p.getAnimation().getId(), 2046, "the player floats up after the creature arrives");
  tickTasks(26); // max(|dx|, |dy|) + 5 from 3234,9525
  assert.equal(p.getLocation().getX(), 3224);
  assert.equal(p.getLocation().getY(), 9504);
  assert.equal(p.getAnimation().getId(), 2047, "the player floats down on the far shelf");
});

test("the Attract option works from the ledge and a creature outside the chasm is left alone", (t) => {
  const { p, messages } = player(t, "togattract1", 3234, 9525);
  p.getInventory().adds(LIT_LANTERN, 1);
  const npc = creature(3226, 9518);

  const route = npcEvent(p, npc, { clickType: 1 });
  PM.emitNpcRoute(route);
  assert.equal(route.range, 8, "an Attract click routes to the creature too");
  assert.equal(route.ignoreProjectileClip, true);

  assert.equal(PM.emitNpcInteraction(npcEvent(p, npc)), true);
  assert.ok(messages.includes("The light creature is attracted to your beam and comes towards you..."));
  tickTasks(7);
  assert.equal(p.getLocation().getX(), 3234, "the creature approaches before the float");
  assert.equal(p.getAnimation().getId(), 2046);
  tickTasks(26);
  assert.equal(p.getLocation().getX(), 3224);
  assert.equal(p.getLocation().getY(), 9504);

  const outside = creature(3235, 9525);
  const before = p.getLocation().clone();
  assert.equal(PM.emitNpcInteraction(npcEvent(p, outside)), false, "not a Chasm crossing creature");
  assert.ok(p.getLocation().equals(before));

  const empty = player(t, "togattract2", 3234, 9525);
  assert.equal(PM.emitNpcInteraction(npcEvent(empty.p, creature(3226, 9518))), true);
  assert.ok(empty.messages.includes("You don't have anything to attract the light creature with."));
  assert.equal(empty.p.getLocation().getX(), 3234, "no lantern, no crossing");

  const south = player(t, "togattract3", 3226, 9510);
  south.p.getInventory().adds(LIT_LANTERN, 1);
  assert.equal(PM.emitNpcInteraction(npcEvent(south.p, creature(3226, 9518))), true);
  tickTasks(7 + 25); // max(|dx|, |dy|) + 5 from 3226,9510
  assert.equal(south.p.getLocation().getX(), 3224);
  assert.equal(south.p.getLocation().getY(), 9530, "the south side crosses back to the north edge");
});

test("a second Attract during the approach does not chain a second crossing", (t) => {
  const { p, messages } = player(t, "togdouble1", 3234, 9525);
  p.getInventory().adds(LIT_LANTERN, 1);
  const npc = creature(3226, 9518);
  assert.equal(PM.emitNpcInteraction(npcEvent(p, npc)), true);
  tickTasks(3);
  assert.equal(PM.emitNpcInteraction(npcEvent(p, npc)), true, "the second click is consumed");
  assert.equal(messages.filter((text) => text.includes("attracted to your beam")).length, 1,
    "only the first click prints the attract line");
  tickTasks(4); // the first chain floats up at tick 7
  assert.equal(p.getAnimation().getId(), 2046);
  tickTasks(26);
  assert.equal(p.getLocation().getX(), 3224);
  assert.equal(p.getLocation().getY(), 9504);
  assert.equal(p.getAnimation().getId(), 2047);
  tickTasks(3);
  assert.equal(p.getLocation().getX(), 3224, "no second landing follows");
});

// rsprox_transcripts/242/911949.txt: the creature jumps beside the player, grows (2052) into the
// transition creature (13429) with synth 1799, becomes the carrying creature (5784), moves one tile
// a tick from the fourth tick (four tiles south, seven diagonal, then south along x=3223), shrinks
// (2053) with synth 1792 on the float-down tick, and the tick after is the plain creature again at
// 3225,9505, walking north from the next tick; 242/912056.txt does the same from 3231,9529.
test("the attracted light creature carries the player across, as recorded", (t) => {
  const { NPC } = require("../dist/game/entity/impl/npc/NPC");
  const { p } = player(t, "togcarry1", 3231, 9527);
  p.getInventory().adds(LIT_LANTERN, 1);
  const sounds = [];
  const sender = p.getPacketSender();
  const send = sender.sendSound.bind(sender);
  sender.sendSound = (id, ...rest) => { sounds.push(id); return send(id, ...rest); };
  const npc = new NPC(LIGHT_CREATURE, new core.Location(3226, 9518, 2));
  const at = () => [npc.getLocation().getX(), npc.getLocation().getY()];

  assert.equal(PM.emitNpcInteraction(npcEvent(p, npc)), true);
  tickTasks(7);
  assert.equal(p.getAnimation().getId(), 2046);
  assert.deepEqual(at(), [3230, 9526], "the creature jumps to the tile south-west of the player");
  assert.equal(npc.getAnimation().getId(), 2052, "light_creature_grow");
  assert.equal(npc.getNpcTransformationId(), 13429, "tog_light_creature_transition");
  assert.deepEqual(sounds, [1799], "light_creature_up");
  assert.equal(npc.isScriptedMovement(), true, "it does not wander off while carrying");
  tickTasks(1);
  assert.equal(npc.getNpcTransformationId(), 5784, "tog_light_creature_carrying");
  tickTasks(2);
  assert.deepEqual(at(), [3230, 9526], "no step before the fourth tick");
  const path = [];
  for (let i = 0; i < 23; i++) { tickTasks(1); path.push(at().join(",")); }
  assert.deepEqual(path.slice(0, 4), ["3230,9525", "3230,9524", "3230,9523", "3230,9522"], "four tiles straight south first");
  assert.deepEqual(path.slice(4, 11), ["3229,9521", "3228,9520", "3227,9519", "3226,9518", "3225,9517", "3224,9516", "3223,9515"], "then the diagonal leg");
  assert.deepEqual(path.slice(11), Array.from({ length: 12 }, (_, i) => `3223,${9514 - i}`), "then straight south along x=3223");
  tickTasks(2); // the float lasts max(7, 23) + 5 = 28 ticks
  assert.equal(p.getAnimation().getId(), 2047);
  assert.deepEqual(at(), [3223, 9503], "south-west of the landing at 3224,9504");
  assert.equal(npc.getAnimation().getId(), 2053, "light_creature_shrink");
  assert.deepEqual(sounds, [1799, 1792], "light_creature_down");
  assert.equal(npc.getNpcTransformationId(), 5784);
  tickTasks(1);
  assert.equal(npc.getNpcTransformationId(), -1, "the plain creature again");
  assert.deepEqual(at(), [3225, 9505], "it hops two tiles north-east");
  const home = [];
  for (let i = 0; i < 13; i++) { tickTasks(1); home.push(at().join(",")); }
  assert.deepEqual(home.slice(0, 12), Array.from({ length: 12 }, (_, i) => `3225,${9506 + i}`), "straight north along x=3225");
  assert.equal(home[12], "3226,9518", "then the diagonal to its 3226,9518 spawn");
  assert.equal(npc.isScriptedMovement(), true, "still walking home on its last step");
  tickTasks(1);
  assert.deepEqual(at(), [3226, 9518], "back at its spawn by the north ledge");
  assert.equal(npc.isScriptedMovement(), false, "and free to wander again");
});

test("both chasm rocks climb one tile over the slope instead of teleporting to the north ledge", (t) => {
  const { p } = player(t, "togrocks1", 3238, 9499);
  assert.equal(climb(p, 3239, 9499, ROCK_SOUTH), true);
  assert.equal(p.getLocation().getX(), 3240, "south rocks step east, not to 3241,9525");
  assert.equal(p.getLocation().getY(), 9499);

  const north = player(t, "togrocks2", 3241, 9524).p;
  assert.equal(climb(north, 3240, 9524, ROCK_NORTH), true);
  assert.equal(north.getLocation().getX(), 3239, "north rocks step west towards the creatures");
  assert.equal(north.getLocation().getY(), 9524);

  const other = player(t, "togrocks3", 3238, 9505).p;
  const before = other.getLocation().clone();
  assert.equal(climb(other, 3233, 9505, 1234), false, "an unrelated rock is left to other plugins");
  assert.ok(other.getLocation().equals(before));
});
