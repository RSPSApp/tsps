// Run after yarn build: node --test tests/dragon-axe-special.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { CombatSpecial } = require("../dist/game/content/combat/CombatSpecial");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");
const { World } = require("../dist/game/World");
require("../plugins/combat/specials/DragonAxe.SpecialAttack")({
  core: PluginManager.getCoreApi(),
  registerCombatSpecial: CombatSpecial.register,
});
const special = (id) => CombatSpecial.getById(id);

function fakePlayer({ weaponId, energy = 100, levels }) {
  const base = levels.WOODCUTTING;
  let current = base;
  const calls = { sounds: [], animations: [], graphics: [], messages: [] };
  const player = {
    calls,
    energy,
    activated: false,
    special: CombatSpecial.getForWeaponId(weaponId),
    skillManager: { level: () => current, setLevel: (_, level) => { current = level; },
      getMaxLevel: () => base, getCurrentLevel: () => current,
      setCurrentLevels: (_, level) => { current = level; } },
    isPlayer: () => true,
    isPlayerBot: () => false,
    getLocation: () => ({ getX: () => 3200, getY: () => 3200, getZ: () => 0 }),
    getAsPlayer() { return this; },
    getCombatSpecial() { return this.special; },
    isSpecialActivated() { return this.activated; },
    setSpecialActivated(value) { this.activated = value; },
    getSpecialPercentage() { return this.energy; },
    decrementSpecialPercentage(amount) { this.energy -= amount; },
    isRecoveringSpecialAttack: () => true,
    getDueling: () => ({ inDuel: () => false }),
    getEquipment: () => ({ get: () => ({ getId: () => weaponId }) }),
    getWeapon: () => ({ getSpecialBar: () => -1, getSpecialMeter: () => -1 }),
    getPacketSender: () => ({
      sendAreaSound: (...args) => calls.sounds.push(args),
      updateSpecialAttackOrb() {}, sendSpecialAttackState() {},
    }),
    getSkillManager() { return this.skillManager; },
    sendMessage: (message) => calls.messages.push(message),
    forceChat() {},
    performAnimation: (animation) => calls.animations.push(animation),
    performGraphic: (graphic) => calls.graphics.push(graphic),
  };
  return player;
}

function activate(player) {
  const getPlayers = World.getPlayers;
  World.getPlayers = () => [player];
  try {
    CombatSpecial.activate(player);
  } finally {
    World.getPlayers = getPlayers;
  }
}

const LUMBER_UP_AXES = [
  "DRAGON_AXE", "DRAGON_FELLING_AXE", "DRAGON_AXE_OR_", "DRAGON_AXE_OR__3",
  "INFERNAL_AXE", "INFERNAL_AXE_UNCHARGED_", "INFERNAL_AXE_OR_",
  "INFERNAL_AXE_UNCHARGED__2", "INFERNAL_AXE_OR__3", "INFERNAL_AXE_UNCHARGED__4",
  "_3RD_AGE_AXE", "_3RD_AGE_FELLING_AXE", "CRYSTAL_AXE", "CRYSTAL_AXE_INACTIVE_",
  "CRYSTAL_FELLING_AXE", "CRYSTAL_FELLING_AXE_INACTIVE_",
];

for (const name of LUMBER_UP_AXES) {
  test(`Lumber Up activates immediately with ${name}`, () => {
    const player = fakePlayer({ weaponId: ItemIdentifiers[name], levels: { WOODCUTTING: 58 } });
    assert.equal(player.special, special("dragon_axe"), "the equipped axe exposes Lumber Up");
    activate(player);
    assert.equal(player.skillManager.level("WOODCUTTING"), 61, "can meet the dragon axe chopping requirement");
    assert.equal(player.energy, 0);
    assert.equal(player.activated, false);
    assert.equal(player.special.getCombatMethod().hits(), null, "no combat target or hit roll");
    assert.equal(player.calls.animations.length, 1);
    assert.equal(player.calls.graphics.length, 1);
  });
}

test("Lumber Up sends its captured activation sound once and only with sufficient energy", () => {
  const player = fakePlayer({ weaponId: ItemIdentifiers.DRAGON_AXE, levels: { WOODCUTTING: 70 } });
  activate(player);
  assert.deepEqual(player.calls.sounds.map((args) => args.slice(0, 7)), [[2531, 3200, 3200, 0, 1, 0, 1]]);
  activate(player);
  assert.equal(player.calls.sounds.length, 1);
  assert.equal(player.calls.animations.length, 1);
  assert.equal(player.calls.graphics.length, 1);
  assert.equal(player.skillManager.level("WOODCUTTING"), 73);
  assert.equal(player.energy, 0);
  assert.deepEqual(player.calls.messages, ["You don't have enough power left."]);
});
