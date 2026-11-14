// Run after `yarn build`: node --test tests/pest-control-scores.test.cjs
// The outpost's Score board (pest_scores, "View") shows the player's wins on each lander, sent
// as live sends it (rsprox.net recordings 4006, 4009; plugins/minigames/pestcontrol/Scores.PestControl.js).
"use strict";
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");

process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { RegionManager } = require("../dist/game/collision/RegionManager");
const { ObjectManager } = require("../dist/game/entity/impl/object/ObjectManager");
const { World } = require("../dist/game/World");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");
const { Skill } = require("../dist/game/model/Skill");
const { PluginManager } = require("../dist/plugins/PluginManager");
const plugin = require("../plugins/minigames/PestControl.plugin");
const Scores = require("../plugins/minigames/pestcontrol/Scores.PestControl");

const namedObjects = {};
const customHandlers = {};
const api = {
  core: PluginManager.getCoreApi(),
  registerShopCurrency() {},
  emitCustomEvent(name, payload) { for (const handler of customHandlers[name] ?? []) handler(payload); },
  registerDefinitionSource() {},
  registerNpcCombatMethodProvider() {},
  persistAttribute: (key, defaultValue) => PlayerSave.persistAttribute(key, defaultValue),
  onServerStartup() {},
  getAreaManager: () => ({ areas: [] }),
  getObjectManager: () => ObjectManager,
  getRegionManager: () => RegionManager,
  getWorld: () => World,
  onPlayerLogin() {},
  onObjectInteraction(name, options) { if (typeof name === "string") namedObjects[name] = options; },
  onNpcInteraction() {},
  onInterfaceActionButton() {},
  onCustomEvent(name, handler) { (customHandlers[name] ??= []).push(handler); },
  onCanAttack() {},
  onPlayerDealtDamage() {},
  onNpcDeath() {},
  onPlayerBeforeDeath() {},
  onPlayerDeath() {},
  onShouldDropItemsOnDeath() {},
  onCanTeleport() {},
  onSpellDisabled() {},
  emitObjectInteraction() { return false; },
};

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  RegionManager.init();
  RegionManager.loadMapFiles(2656, 2592);
  plugin.register(api);
});

function realPlayer() {
  const player = new Player(null);
  const sent = [];
  const sender = new Proxy({}, { get: (_, name) => (...args) => { sent.push([name, ...args]); return sender; } });
  player.getPacketSender = () => sender;
  player.sendMessage = (text) => sent.push(["sendMessage", text]);
  player.getForcedLogoutTimer = () => ({ start() {} });
  player.requestLogout = () => {};
  const boat = plugin._test.BOATS[0];
  player.setLocation(boat.waitingLocation.clone());
  for (const skill of Skill.values()) {
    player.getSkillManager().setMaxLevels(skill, 99, false);
    player.getSkillManager().setCurrentLevel(skill, 99, false);
  }
  return { player, sent };
}

function playGame(player, key, { won, activity }) {
  const boat = plugin._test.BOATS.find((entry) => entry.key === key);
  const match = new plugin._test.PestControlMatch(boat, [player], () => {});
  match.players.get(player).activity = activity;
  match.finish(won, "The Void Knight was killed.");
}

function view(player, sent) {
  sent.length = 0;
  namedObjects["Score board"].View({ player, objectId: 27780, option: "View" });
  return sent.slice();
}

test("View opens pest_scores with the wins on each lander, as live sends it", () => {
  const { player, sent } = realPlayer();
  assert.deepEqual(view(player, sent), [
    ["sendVarbit", 12393, 1],
    ["sendInterfaceScript", 2524, [-1, -1]],
    ["sendSubInterface", (161 << 16) | 16, 628, 0],
    ["sendString", "0", (628 << 16) | 8],
    ["sendString", "0", (628 << 16) | 9],
    ["sendString", "0", (628 << 16) | 10],
  ], "busy, toplevel_mainmodal_open, the main modal, the novice/intermediate/veteran counts (4006 tick 3061)");
  assert.equal(player.getInterfaceId(), 628);
});

test("a won and rewarded game counts on its own lander only", () => {
  const { player, sent } = realPlayer();
  playGame(player, "novice", { won: true, activity: 50 });
  playGame(player, "veteran", { won: true, activity: 50 });
  playGame(player, "veteran", { won: true, activity: 50 });
  const strings = view(player, sent).filter(([name]) => name === "sendString").map(([, text]) => text);
  assert.deepEqual(strings, ["1", "0", "2"]);
  assert.deepEqual(Scores.getWins(player), { novice: 1, intermediate: 0, veteran: 2 });
});

test("a lost game, or a win with no activity, doesn't count", () => {
  const { player } = realPlayer();
  playGame(player, "intermediate", { won: false, activity: 100 });
  playGame(player, "intermediate", { won: true, activity: 0 });
  assert.deepEqual(Scores.getWins(player), { novice: 0, intermediate: 0, veteran: 0 });
});

test("closing the board clears busy; other interfaces leave it alone", () => {
  const { player, sent } = realPlayer();
  view(player, sent);
  sent.length = 0;
  for (const handler of customHandlers["interface:closed"]) handler({ player, interfaceId: 741 });
  assert.deepEqual(sent.filter(([name]) => name === "sendVarbit"), []);
  for (const handler of customHandlers["interface:closed"]) handler({ player, interfaceId: 628 });
  assert.deepEqual(sent.filter(([name]) => name === "sendVarbit"), [["sendVarbit", 12393, 0]]);
});

test("the wins are saved with the player and a new account starts at none", () => {
  assert.ok(PlayerSave.persistentAttributeKeys.has(Scores.WINS_ATTRIBUTE), "persisted");
  const fresh = new Player(null);
  PlayerSave.applyAttributeDefaults(fresh);
  assert.deepEqual(Scores.getWins(fresh), { novice: 0, intermediate: 0, veteran: 0 });
  fresh.setAttribute(Scores.WINS_ATTRIBUTE, { novice: "3", veteran: -2, intermediate: null });
  assert.deepEqual(Scores.getWins(fresh), { novice: 3, intermediate: 0, veteran: 0 }, "bad saved values read as numbers or 0");
});
