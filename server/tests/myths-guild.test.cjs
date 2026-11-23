// Run after `yarn build`: node --test tests/myths-guild.test.cjs
//
// The Myths' Guild's own interactions (plugins/areas/MythsGuild.plugin.js): the Mythic Statue down
// into the basement, and the guild dog's Pet — which the game had no handler for at all, so the
// click answered "Nothing interesting happens" (#3960, #3963).
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { Location } = require("../dist/game/model/Location");
const { RegionManager } = require("../dist/game/collision/RegionManager");

const plugin = require("../plugins/areas/MythsGuild.plugin");
const { BASEMENT, DOG_LINE, DOG_ANSWER, PET_ANIMATION, isTopFloor, clipTopFloorVoid, PORTALS, PORTAL_DELAY_TICKS, PORTAL_MESSAGE, PORTAL_SOUND } = plugin._test;

let core, objects, npcs;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  plugin.register(new Proxy({
    core,
    onObjectInteraction(name, handlers) { objects.set(name, handlers); },
    onNpcInteraction(name, handlers) { npcs.set(name, handlers); },
  }, { get: (target, key) => (key in target ? target[key] : () => {}) }));
});

function makePlayer(x = 2457, y = 2850) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel), new Location(x, y));
  player.setIndex(9700 + Math.floor(Math.random() * 200));
  player.setUsername("guildqa");
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  player.setHitpoints(10);
  return player;
}

// The maps above the table are built in `before` only once the handlers are captured.
objects = new Map();
npcs = new Map();

test("the Mythic Statue's Enter takes the player into the guild basement", () => {
  const player = makePlayer();
  const enter = objects.get("Mythic Statue")?.Enter;
  assert.equal(typeof enter, "function", "Enter is registered for the statue");
  enter({ player, objectId: core.ObjectIdentifiers.MYTHIC_STATUE, handled: false });
  const at = player.getLocation();
  assert.deepEqual([at.getX(), at.getY(), at.getZ()], [BASEMENT.x, BASEMENT.y, BASEMENT.z],
    "the basement, at the foot of the ladder back up");
  player.setRegistered(false);
});

test("petting the guild dog kneels, then answers with the Wiki's two lines", () => {
  const player = makePlayer();
  const chats = [], messages = [], animations = [];
  player.forceChat = (line) => chats.push(line);
  player.sendMessage = (message) => messages.push(String(message));
  player.performAnimation = (animation) => animations.push(animation);
  const pet = npcs.get("Dog")?.Pet;
  assert.equal(typeof pet, "function", "Pet is registered for the dog");
  assert.equal(pet({ player, npc: { getId: () => core.NpcIdentifiers.DOG_3 } }), true, "the guild dog is ours");
  // Every recorded dog Pet plays human_pickupfloor on the same tick as the line (226/01663,
  // 227/01723, 231/00365); the name has to resolve in the cache, not just be a number.
  const sequence = core.CacheDefinitions.getSeqId(PET_ANIMATION);
  assert.equal(sequence, 827, `${PET_ANIMATION} is the kneeling animation`);
  assert.deepEqual(animations.map((animation) => animation.getId?.() ?? animation),
    [sequence], "the player kneels");
  assert.deepEqual(chats, [DOG_LINE], "the player says it over their head");
  assert.deepEqual(messages, [DOG_ANSWER], "and the chatbox answers");
  player.setRegistered(false);
});

test("another Dog is left to its own Pet handler", () => {
  const player = makePlayer();
  const chats = [], messages = [];
  player.forceChat = (line) => chats.push(line);
  player.sendMessage = (message) => messages.push(String(message));
  // 111 is the ordinary wandering dog; TheFinalDawn's guard dogs and every other variant too.
  const animations = [];
  player.performAnimation = (animation) => animations.push(animation);
  assert.equal(npcs.get("Dog").Pet({ player, npc: { getId: () => 111 } }), false, "declines");
  assert.deepEqual(animations, [], "and does not kneel");
  assert.deepEqual(chats, [], "nothing is said");
  assert.deepEqual(messages, [], "nothing is sent");
  player.setRegistered(false);
});

// A live capture (2026-11-21) walked every top-floor tile; the server used to let players step off
// the walkway onto the floorless, unclipped void around it.
test("the top floor's walkway is walkable and the void around it is not", () => {
  RegionManager.init();
  RegionManager.loadMapFiles(2457, 2847);
  clipTopFloorVoid();
  const step = (x, y, dx, dy) => RegionManager.canMove(x, y, x + dx, y + dy, 2, 1, 1, null);
  assert.ok(isTopFloor(2457, 2847) && !isTopFloor(2457, 2856), "the floor map's own bounds");
  assert.ok(step(2457, 2847, 1, 0), "east along the walkway");
  assert.ok(step(2457, 2850, 0, 1), "north along the walkway");
  assert.ok(!step(2457, 2850, 1, 0), "off the north arm's side");
  assert.ok(!step(2457, 2855, 0, 1), "off the north end");
  assert.ok(!step(2448, 2847, -1, 0), "off the west ring");
  assert.ok(!step(2466, 2847, 1, 0), "off the east ring");
});

// A live capture (2026-11-21) of each portal: two ticks after reaching it, the message, the move and
// sound 200 together.
test("each top-floor portal's Enter moves the player to its guild two ticks later", () => {
  const expected = {
    "Portal of Heroes": [2904, 3511, 0],
    "Portal of Champions": [3191, 3365, 0],
    "Portal of Legends": [2728, 3367, 0],
  };
  assert.deepEqual(Object.keys(PORTALS).sort(), Object.keys(expected).sort());
  for (const [name, landing] of Object.entries(expected)) {
    const player = makePlayer(2457, 2853);
    player.setLocation(new Location(2457, 2853, 2));
    const messages = [];
    const sounds = [];
    const sender = player.getPacketSender();
    sender.sendTypedMessage = (type, text) => { messages.push([type, text]); return sender; };
    sender.sendSound = (id) => { sounds.push(id); return sender; };
    const enter = objects.get(name)?.Enter;
    assert.equal(typeof enter, "function", `Enter is registered for ${name}`);
    enter({ player, handled: false });
    for (let tick = 1; tick < PORTAL_DELAY_TICKS; tick++) core.TaskManager.process();
    assert.equal(player.getLocation().getZ(), 2, `${name}: still upstairs before the second tick`);
    assert.equal(messages.length, 0, `${name}: no message yet`);
    core.TaskManager.process();
    const at = player.getLocation();
    assert.deepEqual([at.getX(), at.getY(), at.getZ()], landing, `${name}: its guild`);
    assert.deepEqual(messages, [[core.ChatType.SPAM, PORTAL_MESSAGE]]);
    assert.deepEqual(sounds, [PORTAL_SOUND]);
    player.setRegistered(false);
  }
});
