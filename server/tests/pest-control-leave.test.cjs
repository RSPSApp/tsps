// Run after `yarn build`: node --test tests/pest-control-leave.test.cjs
// Every way off a Pest Control lander or island ends on that boat's own jetty tile, and the
// in-game Squire speaks and leaves as live does (rsprox captures, docs/pest-control.md).
"use strict";
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");
const fs = require("node:fs");

process.env.DISABLE_PLAYER_BOTS = "1";
require("../dist/Server").Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { RegionManager } = require("../dist/game/collision/RegionManager");
const { ObjectManager } = require("../dist/game/entity/impl/object/ObjectManager");
const { World } = require("../dist/game/World");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { Location } = require("../dist/game/model/Location");
const { Skill } = require("../dist/game/model/Skill");
const { TaskManager } = require("../dist/game/task/TaskManager");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { ChatType } = require("../dist/net/protocol/ClientProtocol");
const { ObjectIdentifiers } = require("../dist/util/ObjectIdentifiers");
const plugin = require("../plugins/minigames/PestControl.plugin");

// The jetty tile beside each boat's gangplank (rsprox.net recordings, docs/pest-control.md).
const JETTY = { novice: [2657, 2639], intermediate: [2644, 2644], veteran: [2638, 2653] };

let objectHandler = null;
const npcHandlers = {};
const customHandlers = {};
const emitted = [];
const api = {
  core: PluginManager.getCoreApi(),
  registerShopCurrency() {},
  persistAttribute() {},
  emitCustomEvent(name, payload) { emitted.push([name, payload]); },
  registerDefinitionSource() {},
  registerNpcCombatMethodProvider() {},
  onServerStartup() {},
  getAreaManager: () => ({ areas: [] }),
  getObjectManager: () => ObjectManager,
  getRegionManager: () => RegionManager,
  getWorld: () => World,
  onPlayerLogin() {},
  onObjectInteraction(handler) { if (typeof handler === "function") objectHandler = handler; },
  onNpcInteraction(name, options) { npcHandlers[name] = options; },
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
  emitObjectInteraction(event) {
    objectHandler?.(event);
    return event.handled === true;
  },
};

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  RegionManager.init();
  RegionManager.loadMapFiles(2656, 2592);
  plugin.register(api);
});

/** A real Player whose packets and chat lines are recorded. */
function realPlayer(location, { bot = false } = {}) {
  const player = new Player(null);
  const sent = [];
  const sender = new Proxy({}, { get: (_, name) => (...args) => { sent.push([name, ...args]); return sender; } });
  player.getPacketSender = () => sender;
  player.sendMessage = (text) => sent.push(["sendMessage", text]);
  player.getForcedLogoutTimer = () => ({ start() {} });
  player.requestLogout = () => {};
  player.setLocation(location.clone());
  if (bot) player.setPlayerBot(true);
  for (const skill of Skill.values()) {
    player.getSkillManager().setMaxLevels(skill, 99, false);
    player.getSkillManager().setCurrentLevel(skill, 99, false);
  }
  return { player, sent };
}

function boat(key) {
  return plugin._test.BOATS.find((entry) => entry.key === key);
}

function startMatch(key) {
  const { player, sent } = realPlayer(boat(key).waitingLocation);
  const match = new plugin._test.PestControlMatch(boat(key), [player], () => {});
  assert.equal(player.getAttribute("pest-control:match"), match, "the player is in the game");
  sent.length = 0;
  return { player, sent, match };
}

function at(player) {
  return [player.getLocation().getX(), player.getLocation().getY()];
}

function chatLines(sent) {
  return sent.filter(([name]) => name === "sendMessage" || name === "sendTypedMessage");
}

function endMatch(match) {
  if (!match.ended) match.finish(false, "test over");
}

test("the Squire's Leave takes the player to their own boat's jetty two ticks later, with no message", () => {
  for (const key of ["novice", "intermediate", "veteran"]) {
    const { player, sent, match } = startMatch(key);
    try {
      npcHandlers.Squire.Leave({ player, npc: match.squire });
      assert.equal(player.getAttribute("pest-control:match"), match, `${key}: still on the island on the order tick`);
      TaskManager.process();
      assert.equal(player.getAttribute("pest-control:match"), match, `${key}: still on the island the tick after (237/04031.txt 611 to 613)`);
      TaskManager.process();
      assert.equal(player.getAttribute("pest-control:match"), null, `${key}: off the island`);
      assert.deepEqual(at(player), JETTY[key], `${key}: on that boat's jetty tile`);
      assert.deepEqual(chatLines(sent), [], `${key}: live sends no message`);
    } finally {
      endMatch(match);
    }
  }
});

test("another Squire's Leave, or one after the game ended, does nothing", () => {
  const { player, match } = startMatch("veteran");
  const other = { getId: () => 1 };
  assert.equal(npcHandlers.Squire.Leave({ player, npc: other }), false, "not the game's Squire: left to other handlers");
  npcHandlers.Squire.Leave({ player, npc: match.squire });
  match.finish(false, "The Void Knight was killed.");
  const after = at(player);
  TaskManager.process();
  TaskManager.process();
  assert.deepEqual(after, JETTY.veteran, "the game's end already sent them to the jetty");
  assert.deepEqual(at(player), after, "and the pending leave doesn't move them again");
});

test("Talk-to plays the Squire's in-game conversation; its \"I want to leave.\" leaves a tick later", () => {
  const { player, sent, match } = startMatch("intermediate");
  try {
    emitted.length = 0;
    npcHandlers.Squire["Talk-to"]({ player, npc: match.squire });
    const start = emitted.find(([name]) => name === "npc-dialogue:start")?.[1];
    assert.ok(start, "a dialogue, not a chat line");
    assert.equal(start.npc, match.squire);
    assert.deepEqual(start.variant, { page: "Squire (Void Knights)", variant: "minigame-dialogue-standard-dialogue" });
    assert.deepEqual(chatLines(sent), []);

    const unrelated = { player, stepId: "someOtherStep", handled: false };
    for (const handler of customHandlers["npc-dialogue:action"]) handler(unrelated);
    assert.equal(unrelated.handled, false, "other dialogue actions are left alone");

    const action = { player, stepId: "nMpuCa", action: "teleport", handled: false };
    for (const handler of customHandlers["npc-dialogue:action"]) handler(action);
    assert.equal(action.handled, true);
    assert.equal(player.getAttribute("pest-control:match"), match, "still on the island while the box closes");
    TaskManager.process();
    assert.deepEqual(at(player), JETTY.intermediate);
    assert.equal(player.getAttribute("pest-control:match"), null);
  } finally {
    endMatch(match);
  }
});

test("the generated conversation still has the leave step this plugin answers", () => {
  const dialogues = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../data/definitions/npc-dialogues.json"), "utf8"));
  const steps = dialogues["Squire (Void Knights)"].variants["minigame-dialogue-standard-dialogue"];
  const menu = steps.find((step) => step.type === "choice");
  const leave = menu.options.find((option) => option.text === "I want to leave.");
  assert.equal(leave.steps.at(-1).id, "nMpuCa");
  assert.equal(leave.steps.at(-1).action, "teleport");
});

test("the end of a game returns each player to their own boat's jetty", () => {
  for (const key of ["novice", "intermediate", "veteran"]) {
    const { player, match } = startMatch(key);
    match.finish(false, "The Void Knight was killed.");
    assert.deepEqual(at(player), JETTY[key], key);
  }
});

test("logging out in a game saves the player on their boat's jetty", () => {
  const { player, match } = startMatch("veteran");
  try {
    match.area.leave(player, true);
    assert.deepEqual(at(player), JETTY.veteran);
  } finally {
    endMatch(match);
  }
});

test("the lander ladder: \"You leave the lander.\" (filterable) and the boat's jetty tile", () => {
  const key = "veteran";
  const { player, sent } = realPlayer(new Location(...JETTY[key], 0), { bot: true });
  const board = { player, objectId: boat(key).gangplankId, handled: false };
  objectHandler(board);
  assert.equal(board.handled, true);
  assert.deepEqual(at(player), [boat(key).waitingLocation.getX(), boat(key).waitingLocation.getY()], "on the lander");
  sent.length = 0;
  const climb = { player, objectId: ObjectIdentifiers.LADDER_327, handled: false };
  objectHandler(climb);
  assert.equal(climb.handled, true);
  assert.deepEqual(chatLines(sent), [["sendTypedMessage", ChatType.SPAM, "You leave the lander."]]);
  assert.deepEqual(at(player), JETTY[key]);
});
