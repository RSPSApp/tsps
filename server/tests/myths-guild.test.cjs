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

const plugin = require("../plugins/areas/MythsGuild.plugin");
const { BASEMENT, DOG_LINE, DOG_ANSWER } = plugin._test;

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

test("petting the guild dog answers with the Wiki's two lines", () => {
  const player = makePlayer();
  const chats = [], messages = [];
  player.forceChat = (line) => chats.push(line);
  player.sendMessage = (message) => messages.push(String(message));
  const pet = npcs.get("Dog")?.Pet;
  assert.equal(typeof pet, "function", "Pet is registered for the dog");
  assert.equal(pet({ player, npc: { getId: () => core.NpcIdentifiers.DOG_3 } }), true, "the guild dog is ours");
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
  assert.equal(npcs.get("Dog").Pet({ player, npc: { getId: () => 111 } }), false, "declines");
  assert.deepEqual(chats, [], "nothing is said");
  assert.deepEqual(messages, [], "nothing is sent");
  player.setRegistered(false);
});
