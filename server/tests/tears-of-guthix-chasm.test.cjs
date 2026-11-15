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
  assert.equal(p.getLocation().getX(), 3229);
  assert.equal(p.getLocation().getY(), 9505);
  assert.ok(messages.includes("The light creature carries you across the chasm."));
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
  assert.equal(p.getLocation().getX(), 3229);
  assert.equal(p.getLocation().getY(), 9505);
  assert.ok(messages.includes("The light creature carries you across the chasm."));

  const outside = creature(3235, 9525);
  const before = p.getLocation().clone();
  assert.equal(PM.emitNpcInteraction(npcEvent(p, outside)), false, "not a Chasm crossing creature");
  assert.ok(p.getLocation().equals(before));

  const empty = player(t, "togattract2", 3234, 9525);
  assert.equal(PM.emitNpcInteraction(npcEvent(empty.p, creature(3226, 9518))), true);
  assert.ok(empty.messages.some((text) => text.includes("lit sapphire lantern")));
  assert.equal(empty.p.getLocation().getX(), 3234, "no lantern, no crossing");
});

test("both chasm rocks climb one tile over the slope instead of teleporting to the north ledge", (t) => {
  const { p } = player(t, "togrocks1", 3238, 9498);
  assert.equal(climb(p, 3239, 9498, ROCK_SOUTH), true);
  assert.equal(p.getLocation().getX(), 3240, "south rocks step east, not to 3241,9525");
  assert.equal(p.getLocation().getY(), 9498);

  const north = player(t, "togrocks2", 3241, 9524).p;
  assert.equal(climb(north, 3240, 9524, ROCK_NORTH), true);
  assert.equal(north.getLocation().getX(), 3239, "north rocks step west towards the creatures");
  assert.equal(north.getLocation().getY(), 9524);

  const other = player(t, "togrocks3", 3238, 9505).p;
  const before = other.getLocation().clone();
  assert.equal(climb(other, 3233, 9505, 1234), false, "an unrelated rock is left to other plugins");
  assert.ok(other.getLocation().equals(before));
});
