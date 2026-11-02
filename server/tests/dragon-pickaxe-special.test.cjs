// Run after yarn build: node --test tests/dragon-pickaxe-special.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { CombatSpecial } = require("../dist/game/content/combat/CombatSpecial");
const { Skill } = require("../dist/game/model/Skill");
const { ItemIdentifiers: Items } = require("../dist/util/ItemIdentifiers");

require("../plugins/combat/specials/DragonPickaxe.SpecialAttack")({
  core: PluginManager.getCoreApi(),
  registerCombatSpecial: CombatSpecial.register,
});

const PICKAXES = [
  ["dragon", Items.DRAGON_PICKAXE, 7138],
  ["upgraded dragon", Items.DRAGON_PICKAXE_3, 334],
  ["Zalcano dragon", Items.DRAGON_PICKAXE_OR_, 8330],
  ["infernal", Items.INFERNAL_PICKAXE, 3410],
  ["depleted infernal", Items.INFERNAL_PICKAXE_UNCHARGED_, 3410],
  ["3rd Age", Items._3RD_AGE_PICKAXE, 7267],
  ["crystal", Items.CRYSTAL_PICKAXE, 8329],
  ["inactive crystal", Items.CRYSTAL_PICKAXE_INACTIVE_, 8329],
  ["Trailblazer dragon", Items.DRAGON_PICKAXE_OR__3, 11821],
  ["Reloaded dragon", Items.DRAGON_PICKAXE_OR__5, 11822],
  ["Trailblazer infernal", Items.INFERNAL_PICKAXE_OR_, 11821],
  ["Reloaded infernal", Items.INFERNAL_PICKAXE_OR__3, 11822],
  ["depleted Trailblazer infernal", Items.INFERNAL_PICKAXE_UNCHARGED__2, 11821],
  ["depleted Reloaded infernal", Items.INFERNAL_PICKAXE_UNCHARGED__4, 11822],
];
const { World } = require("../dist/game/World");
function activate(p) {
  const getPlayers = World.getPlayers;
  World.getPlayers = () => [p];
  try { CombatSpecial.activate(p); } finally { World.getPlayers = getPlayers; }
}

function player(weaponId, { base = 80, current = base, energy = 100 } = {}) {
  const calls = { animations: [], graphics: [], chat: [], messages: [], sounds: [] };
  const p = {
    current, energy, calls, special: null, activated: false,
    isPlayer: () => true,
    getLocation: () => ({ getX: () => 3200, getY: () => 3200, getZ: () => 0 }),
    isPlayerBot: () => false,
    getAsPlayer() { return this; },
    getEquipment: () => ({ get: () => ({ getId: () => weaponId }) }),
    getWeapon: () => ({ getSpecialBar: () => -1, getSpecialMeter: () => -1 }),
    getCombatSpecial() { return this.special; },
    setCombatSpecial(special) { this.special = special; },
    isSpecialActivated() { return this.activated; },
    setSpecialActivated(on) { this.activated = on; },
    getDueling: () => ({ inDuel: () => false }),
    getSpecialPercentage() { return this.energy; },
    decrementSpecialPercentage(amount) { this.energy -= amount; },
    isRecoveringSpecialAttack: () => true,
    getPacketSender: () => ({ updateSpecialAttackOrb() {}, sendSpecialAttackState() {},
      sendAreaSound: (...args) => calls.sounds.push(args) }),
    getSkillManager: () => ({
      getMaxLevel: () => base,
      getCurrentLevel: () => p.current,
      setCurrentLevels(skill, level) {
        assert.equal(skill, Skill.MINING);
        p.current = level;
      },
    }),
    forceChat: (text) => calls.chat.push(text),
    performAnimation: (animation) => calls.animations.push(animation.getId()),
    performGraphic: (graphic) => calls.graphics.push(graphic.getId()),
    sendMessage: (text) => calls.messages.push(text),
  };
  CombatSpecial.assign(p);
  return p;
}

for (const [name, id, animation] of PICKAXES) {
  test(`${name} pickaxe activates Rock Knocker immediately without a target`, () => {
    const p = player(id);
    activate(p);
    assert.equal(p.current, 83, "visible +3 Mining boost");
    assert.equal(p.energy, 0, "100% energy consumed");
    assert.equal(p.activated, false);
    assert.deepEqual(p.calls.chat, ["Smashing!"]);
    assert.deepEqual(p.calls.animations, [animation]);
    assert.deepEqual(p.calls.graphics, []);
    assert.deepEqual(p.calls.sounds.map(args => args.slice(0, 7)), [[2655, 3200, 3200, 0, 1, 0, 1]]);
    assert.equal(p.special.getCombatMethod().hits(), null);
  });

  test(`${name} pickaxe refuses Rock Knocker below 100% energy`, () => {
    const p = player(id, { energy: 99 });
    activate(p);
    assert.equal(p.current, 80);
    assert.equal(p.energy, 99);
    assert.deepEqual(p.calls.messages, ["You don't have enough power left."]);
    assert.deepEqual(p.calls.chat, []);
    assert.deepEqual(p.calls.animations, []);
    assert.deepEqual(p.calls.graphics, []);
    assert.deepEqual(p.calls.sounds, []);
  });
}

test("Rock Knocker refreshes its boost without stacking or reducing a stronger boost", () => {
  for (const [, id] of PICKAXES) {
    for (const [current, expected] of [[78, 83], [82, 83], [83, 83], [85, 85]]) {
      const p = player(id, { current });
      activate(p);
      assert.equal(p.current, expected);
      assert.equal(p.energy, 0);
    }
  }
});

test("notes, placeholders, broken and Gauntlet pickaxes do not acquire Rock Knocker", () => {
  for (const id of [Items.DRAGON_PICKAXE_2, Items.DRAGON_PICKAXE_4, Items.DRAGON_PICKAXE_5,
    Items.INFERNAL_PICKAXE_2, Items._3RD_AGE_PICKAXE_2, Items._3RD_AGE_PICKAXE_3,
    Items.CRYSTAL_PICKAXE_2, Items.CRYSTAL_PICKAXE_INACTIVE__2,
    Items.INFERNAL_PICKAXE_OR__2, Items.INFERNAL_PICKAXE_UNCHARGED__3,
    Items.DRAGON_PICKAXE_OR__2, Items.DRAGON_PICKAXE_OR__4,
    Items.RUNE_PICKAXE, Items.CRYSTAL_PICKAXE_3, Items.CORRUPTED_PICKAXE,
    Items.DRAGON_PICKAXE_BROKEN_]) {
    assert.equal(CombatSpecial.getForWeaponId(id), null, String(id));
  }
});
