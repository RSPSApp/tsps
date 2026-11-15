// Run after `yarn build`: node --test tests/pest-control-repair.test.cjs
// Repairing a Pest Control barricade or gate as live does (rsprox captures 4014/4020/4023/4025,
// docs/pest-control.md): the refusal lines, pest_repair with synth 1728, one log and one stage
// per click, 5 Crafting XP and 8 activity; a destroyed gate's Open/Close says it is destroyed.
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
const { Skill } = require("../dist/game/model/Skill");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const plugin = require("../plugins/minigames/PestControl.plugin");

let objectHandler = null;
const npcHandlers = {};
const customHandlers = {};
const emitted = [];
const api = {
  core: PluginManager.getCoreApi(),
  registerShopCurrency() {},
  emitCustomEvent(name, payload) { emitted.push([name, payload]); },
  registerDefinitionSource() {},
  registerNpcCombatMethodProvider() {},
  onServerStartup() {},
  getAreaManager: () => ({ areas: [] }),
  getObjectManager: () => ObjectManager,
  getRegionManager: () => RegionManager,
  getWorld: () => World,
  onPlayerLogin() {},
  persistAttribute() {},
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

function realPlayer(location) {
  const player = new Player(null);
  const sent = [];
  const sender = new Proxy({}, { get: (_, name) => (...args) => { sent.push([name, ...args]); return sender; } });
  player.getPacketSender = () => sender;
  player.sendMessage = (text) => sent.push(["sendMessage", text]);
  const anims = [];
  player.performAnimation = (animation) => anims.push(animation.getId());
  player.setLocation(location.clone());
  return { player, sent, anims };
}

function startMatch() {
  const boat = plugin._test.BOATS.find((entry) => entry.key === "novice");
  const { player, sent, anims } = realPlayer(boat.waitingLocation);
  const match = new plugin._test.PestControlMatch(boat, [player], () => {});
  sent.length = 0;
  return { player, sent, anims, match };
}

function structure(match, kind) {
  return [...match.structures.values()].find((state) => state.kind === kind);
}

const messages = (sent) => sent.filter(([name]) => name === "sendMessage").map(([, text]) => text);
const sounds = (sent) => sent.filter(([name]) => name === "sendSoundEffect").map(([, id]) => id);

test("Repair without a hammer, then without logs, refuses with live's lines and changes nothing", () => {
  const { player, sent, anims, match } = startMatch();
  try {
    const barricade = structure(match, "barricade");
    barricade.damage = 1;
    match.replaceStructure(barricade);
    player.getInventory().resetItems();
    player.getInventory().adds(ItemIdentifiers.LOGS, 1);
    assert.equal(match.handleObject(player, barricade.object, 3), true);
    player.getInventory().resetItems();
    player.getInventory().adds(ItemIdentifiers.HAMMER, 1);
    assert.equal(match.handleObject(player, barricade.object, 3), true);
    assert.deepEqual(messages(sent), [
      "You'll need a hammer to make any repairs!",
      "You'll need some logs to make any repairs!",
    ]);
    assert.equal(barricade.damage, 1, "still damaged");
    assert.deepEqual(anims, [], "no repair animation");
    assert.deepEqual(sounds(sent), []);
  } finally {
    if (!match.ended) match.finish(false, "test over");
  }
});

test("each Repair click takes one log, plays pest_repair and synth 1728, and lifts one stage", () => {
  const { player, sent, anims, match } = startMatch();
  try {
    const gate = structure(match, "gate");
    gate.damage = gate.maxDamage;
    match.replaceStructure(gate);
    player.getInventory().resetItems();
    player.getInventory().adds(ItemIdentifiers.HAMMER, 1);
    player.getInventory().adds(ItemIdentifiers.LOGS, 5);
    const state = match.players.get(player);
    state.activity = 20;
    const xp = player.getSkillManager().getExperience(Skill.CRAFTING);
    const destroyedId = gate.object.getId();
    assert.equal(match.handleObject(player, gate.object, 3), true);
    assert.equal(gate.damage, gate.maxDamage - 1, "one stage up");
    assert.equal(gate.object.getId(), destroyedId - 4, "destroyed -> damaged_2 (4 ids a stage)");
    assert.equal(player.getInventory().getAmount(ItemIdentifiers.LOGS), 4, "one log used");
    assert.deepEqual(anims, [3931], "pest_repair");
    assert.deepEqual(sounds(sent), [1728]);
    assert.equal(state.activity, 28, "8 activity a repair");
    assert.equal(player.getSkillManager().getExperience(Skill.CRAFTING) - xp, 5);
    assert.deepEqual(messages(sent), [], "a repair sends no chat line");
  } finally {
    if (!match.ended) match.finish(false, "test over");
  }
});

test("Open or Close on a destroyed gate says it has been totally destroyed", () => {
  const { player, sent, match } = startMatch();
  try {
    const gate = structure(match, "gate");
    gate.damage = gate.maxDamage;
    match.replaceStructure(gate);
    const open = gate.open;
    assert.equal(match.handleObject(player, gate.object, 1), true, "handled, not left to a default door");
    assert.equal(gate.open, open, "the gate does not move");
    assert.deepEqual(messages(sent), ["It's been totally destroyed!"]);
  } finally {
    if (!match.ended) match.finish(false, "test over");
  }
});
