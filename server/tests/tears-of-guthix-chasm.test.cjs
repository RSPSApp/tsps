// Run after `yarn build`: node --test tests/tears-of-guthix-chasm.test.cjs
//
// The Chasm of Tears crossing: the light creatures are the multinpc 401, which varbit 451 shows as
// 5435 with Attract from stage 1 (events carry that id), so the lantern must work through that
// option as well as item-on-NPC. The chasm rocks are one-tile slopes, not teleports to the other
// ledge. Real plugins, Player and cache definitions; the events are the ones the packet listeners
// emit. Facts: rsprox local 1001964 and 1002071 (rev 242), see docs/quests/tears-of-guthix/README.md.
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

  const outside = creature(3240, 9531);
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

// rsprox local 1001964 ticks 19492-19528: the creature comes a tile a tick onto the player's tile,
// the player floats up two ticks after it arrives, the creature telejumps south-west of them, grows
// (2052) into the transition creature (13429) with synth 1799 and becomes the carrying creature
// (5784); from the fourth tick both move a tile a tick (four south, diagonally, then south), the
// creature a tile south-west of the player; both float down / shrink (2053, synth 1792) 28 ticks
// after the float-up, and the tick after it is the plain creature again two tiles north-east.
test("the attracted light creature comes to the player and carries them across, as recorded", (t) => {
  const { NPC } = require("../dist/game/entity/impl/npc/NPC");
  const { p } = player(t, "togcarry1", 3231, 9527);
  p.getInventory().adds(LIT_LANTERN, 1);
  const sounds = [];
  const sender = p.getPacketSender();
  const send = sender.sendSound.bind(sender);
  sender.sendSound = (id, ...rest) => { sounds.push(id); return send(id, ...rest); };
  const npc = new NPC(LIGHT_CREATURE, new core.Location(3228, 9522, 2));
  const at = () => [npc.getLocation().getX(), npc.getLocation().getY()];
  const me = () => [p.getLocation().getX(), p.getLocation().getY()];
  const { World } = require("../dist/game/World");
  // A plain moveTo drops an NPC from every client's view for the tick; live sends in-place teleports.
  // Checks the tick, then ends it as the world's sync does (resetUpdating, placement done).
  const inView = () => {
    const visible = !npc.isNeedsPlacement() || World.staysInViewWhenPlaced(npc);
    npc.resetUpdating();
    npc.setNeedsPlacement(false);
    return visible;
  };

  assert.equal(PM.emitNpcInteraction(npcEvent(p, npc)), true);
  assert.equal(npc.isScriptedMovement(), true, "it stops drifting to come over");
  const approach = [];
  for (let i = 0; i < 5; i++) {
    tickTasks(1);
    approach.push(at().join(","));
    assert.ok(inView(), `the creature stays in view on approach step ${i + 1}`);
  }
  assert.deepEqual(approach, ["3229,9523", "3230,9524", "3231,9525", "3231,9526", "3231,9527"],
    "diagonally until in line, then straight onto the player's tile (1001964)");
  tickTasks(1);
  inView();
  assert.notEqual(p.getAnimation()?.getId(), 2046, "no float the tick after it arrives");
  tickTasks(1);
  assert.equal(p.getAnimation().getId(), 2046, "the float two ticks after it arrives");
  assert.equal(p.getMovementQueue().isMovementBlocked(), true, "the player is held during the float");
  assert.deepEqual(at(), [3230, 9526], "the creature telejumps to the tile south-west of the player");
  assert.equal(npc.getAnimation().getId(), 2052, "light_creature_grow");
  assert.equal(npc.getNpcTransformationId(), 13429, "tog_light_creature_transition");
  assert.deepEqual(sounds, [1799], "light_creature_up");
  assert.ok(inView(), "the telejump keeps it in view");
  tickTasks(1);
  assert.equal(npc.getNpcTransformationId(), 5784, "tog_light_creature_carrying");
  inView();
  tickTasks(1);
  inView();
  tickTasks(1);
  inView();
  assert.deepEqual(me(), [3231, 9527], "no step before the fourth tick");
  const path = [];
  const under = [];
  for (let i = 0; i < 23; i++) {
    tickTasks(1);
    path.push(me().join(","));
    under.push(at().join(","));
    assert.ok(inView(), `the creature stays in view under the player on step ${i + 1}`);
  }
  assert.deepEqual(path.slice(0, 4), ["3231,9526", "3231,9525", "3231,9524", "3231,9523"], "four tiles straight south first");
  assert.deepEqual(path.slice(4, 11), ["3230,9522", "3229,9521", "3228,9520", "3227,9519", "3226,9518", "3225,9517", "3224,9516"], "then the diagonal leg");
  assert.deepEqual(path.slice(11), Array.from({ length: 12 }, (_, i) => `3224,${9515 - i}`), "then straight south to 3224,9504 (19525)");
  assert.deepEqual(under, path.map((tile) => tile.split(",").map(Number)).map(([x, y]) => `${x - 1},${y - 1}`),
    "the creature a tile south-west of the player all the way");
  tickTasks(1);
  inView();
  assert.notEqual(p.getAnimation()?.getId(), 2047);
  tickTasks(1); // the float lasts the 23 steps + 5 = 28 ticks
  assert.equal(p.getAnimation().getId(), 2047);
  assert.equal(npc.getAnimation().getId(), 2053, "light_creature_shrink");
  assert.deepEqual(sounds, [1799, 1792], "light_creature_down");
  assert.equal(npc.getNpcTransformationId(), 5784);
  assert.equal(p.getMovementQueue().isMovementBlocked(), true);
  inView();
  tickTasks(1);
  assert.equal(p.getMovementQueue().isMovementBlocked(), false, "free to move the tick after");
  assert.deepEqual(at(), [3225, 9505], "it hops two tiles north-east");
  assert.ok(inView());
  assert.equal(npc.getNpcTransformationId(), 5784, "still carrying on the hop (19528)");
  tickTasks(1);
  assert.equal(npc.getNpcTransformationId(), -1, "the plain creature the tick after (19529)");
  assert.equal(npc.isScriptedMovement(), false, "and drifts again");
});

test("a player who walks away before the float is left alone", (t) => {
  const { NPC } = require("../dist/game/entity/impl/npc/NPC");
  const { p } = player(t, "togleave1", 3231, 9527);
  p.getInventory().adds(LIT_LANTERN, 1);
  const npc = new NPC(LIGHT_CREATURE, new core.Location(3228, 9522, 2));
  assert.equal(PM.emitNpcInteraction(npcEvent(p, npc)), true);
  tickTasks(2);
  p.setLocation(new core.Location(3233, 9527, 2));
  tickTasks(10);
  assert.notEqual(p.getAnimation()?.getId(), 2046);
  assert.equal(npc.isScriptedMovement(), false, "the creature drifts off again");
  assert.equal(PM.emitNpcInteraction(npcEvent(p, npc)), true, "and can be attracted again");
});

test("a logout mid-float saves the player on the far side and frees the creature", (t) => {
  const { NPC } = require("../dist/game/entity/impl/npc/NPC");
  const { p } = player(t, "toglogout1", 3231, 9527);
  p.getInventory().adds(LIT_LANTERN, 1);
  const npc = new NPC(LIGHT_CREATURE, new core.Location(3231, 9526, 2));
  assert.equal(PM.emitNpcInteraction(npcEvent(p, npc)), true);
  tickTasks(3 + 8); // a tile to come, two to wait, then eight of the float
  assert.notEqual(p.getLocation().getY(), 9527, "mid-float over the pool");
  PM.emitPlayerLogout({ player: p, username: p.getUsername() });
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [3224, 9504], "saved on the landing");
  assert.equal(p.getMovementQueue().isMovementBlocked(), false);
  assert.equal(npc.getNpcTransformationId(), -1, "the creature is a plain creature again");
  assert.equal(npc.isScriptedMovement(), false, "and drifts");
});

test("the unrecorded northbound float faces north and the creature hops back into the chasm", (t) => {
  const { NPC } = require("../dist/game/entity/impl/npc/NPC");
  const Chasm = require("../plugins/minigames/tearsofguthix/Chasm.TearsOfGuthix");
  const { p } = player(t, "tognorth1", 3224, 9504);
  p.getInventory().adds(LIT_LANTERN, 1);
  const npc = new NPC(LIGHT_CREATURE, new core.Location(3224, 9505, 2));
  assert.equal(PM.emitNpcInteraction(npcEvent(p, npc)), true);
  const directions = new Set();
  for (let i = 0; i < 60; i++) {
    tickTasks(1);
    const move = p.getForceMovement();
    if (move) directions.add(move.getDirection());
  }
  assert.deepEqual([p.getLocation().getX(), p.getLocation().getY()], [3224, 9530]);
  assert.deepEqual([...directions], [0], "facing north all the way");
  const y = npc.getLocation().getY();
  assert.ok(y <= Chasm.BOUNDS.y1, `the creature lands back inside the chasm (y ${y})`);
});

// rsprox local 1001964/1002071, 1696: on the far tile at once with a 100-cycle exact move facing
// west and climbing_loop; down (east) two ticks after the last step with 2050, up (west) one tick
// after with 2049. The interaction runs a tick after the last step, so down waits one more tick.
test("both chasm rocks climb one tile over the slope, as recorded", (t) => {
  const { p } = player(t, "togrocks1", 3238, 9499);
  const sounds = [];
  const sender = p.getPacketSender();
  const effect = sender.sendSoundEffect.bind(sender);
  sender.sendSoundEffect = (id, loops, ...rest) => { sounds.push([id, loops]); return effect(id, loops, ...rest); };
  assert.equal(climb(p, 3239, 9499, ROCK_SOUTH), true);
  assert.equal(p.getLocation().getX(), 3238, "down waits a tick");
  tickTasks(1);
  assert.equal(p.getLocation().getX(), 3240, "south rocks step east, not to 3241,9525");
  assert.equal(p.getLocation().getY(), 9499);
  assert.equal(p.getAnimation().getId(), 2050, "tog_climb_slope_down");
  const slide = p.getForceMovement();
  assert.deepEqual([slide.getStart().getX(), slide.getEnd().getX(), slide.getSpeed(), slide.getReverseSpeed(), slide.getDirection()],
    [3238, 2, 0, 100, 3], "the exact move from the tile left, 100 cycles, facing west");
  assert.deepEqual(sounds, [[2454, 5]], "climbing_loop, five loops");

  const north = player(t, "togrocks2", 3241, 9524).p;
  assert.equal(climb(north, 3240, 9524, ROCK_NORTH), true);
  assert.equal(north.getLocation().getX(), 3239, "north rocks step west at once, towards the creatures");
  assert.equal(north.getLocation().getY(), 9524);
  assert.equal(north.getAnimation().getId(), 2049, "tog_climb_slope_up");

  const back = player(t, "togrocks4", 3239, 9525).p;
  assert.equal(climb(back, 3240, 9525, ROCK_NORTH), true);
  tickTasks(1);
  assert.equal(back.getLocation().getX(), 3241, "6673 also goes down to Juna's side");
  assert.equal(back.getAnimation().getId(), 2050);

  const uphill = player(t, "togrocks5", 3240, 9499);
  assert.equal(climb(uphill.p, 3239, 9499, ROCK_SOUTH), true);
  tickTasks(2);
  assert.equal(uphill.p.getLocation().getX(), 3240, "6672 does not go back up");
  assert.ok(uphill.messages.includes("You could climb down here, but it is too uneven to climb up."));

  const other = player(t, "togrocks3", 3238, 9505).p;
  const before = other.getLocation().clone();
  assert.equal(climb(other, 3233, 9505, 1234), false, "an unrelated rock is left to other plugins");
  assert.ok(other.getLocation().equals(before));
});
