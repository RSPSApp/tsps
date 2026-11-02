// Run after yarn build: node --test tests/dragon-harpoon-special.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { PluginManager } = require("../dist/plugins/PluginManager");
const { CombatSpecial } = require("../dist/game/content/combat/CombatSpecial");
const { Skill } = require("../dist/game/model/Skill");
const { ItemIdentifiers: Items } = require("../dist/util/ItemIdentifiers");

require("../plugins/combat/specials/DragonHarpoon.SpecialAttack")({
  core: PluginManager.getCoreApi(),
  registerCombatSpecial: CombatSpecial.register,
});

const HARPOONS = [
  ["dragon", Items.DRAGON_HARPOON, 7393, 246],
  ["infernal", Items.INFERNAL_HARPOON, 7394, 246],
  ["depleted infernal", Items.INFERNAL_HARPOON_UNCHARGED_, 7394, 246],
  ["crystal", Items.CRYSTAL_HARPOON, 8333, 1688],
  ["inactive crystal", Items.CRYSTAL_HARPOON_INACTIVE_, 8333, 1688],
  ["Trailblazer dragon", Items.DRAGON_HARPOON_OR_, 11823, 246],
  ["Reloaded dragon", Items.DRAGON_HARPOON_OR__3, 11824, 246],
  ["Trailblazer infernal", Items.INFERNAL_HARPOON_OR_, 11823, 246],
  ["Reloaded infernal", Items.INFERNAL_HARPOON_OR__3, 11824, 246],
  ["depleted Trailblazer infernal", Items.INFERNAL_HARPOON_UNCHARGED__2, 11823, 246],
  ["depleted Reloaded infernal", Items.INFERNAL_HARPOON_UNCHARGED__4, 11824, 246],
];

function player(weaponId, { base = 80, current = base, energy = 100 } = {}) {
  const calls = { animations: [], graphics: [], chat: [], messages: [] };
  const p = {
    current, energy, calls, special: null, activated: false,
    isPlayer: () => true,
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
    getPacketSender: () => ({ updateSpecialAttackOrb() {}, sendSpecialAttackState() {} }),
    getSkillManager: () => ({
      getMaxLevel: () => base,
      getCurrentLevel: () => p.current,
      setCurrentLevels(skill, level) {
        assert.equal(skill, Skill.FISHING);
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

for (const [name, id, animation, graphic] of HARPOONS) {
  test(`${name} harpoon activates Fishstabber immediately without a target`, () => {
    const p = player(id);
    CombatSpecial.activate(p);
    assert.equal(p.current, 83, "visible +3 Fishing boost");
    assert.equal(p.energy, 0, "100% energy consumed");
    assert.equal(p.activated, false);
    assert.deepEqual(p.calls.chat, ["Here fishy fishies!"]);
    assert.deepEqual(p.calls.animations, [animation]);
    assert.deepEqual(p.calls.graphics, [graphic]);
    assert.equal(p.special.getCombatMethod().hits(), null);
  });

  test(`${name} harpoon refuses Fishstabber below 100% energy`, () => {
    const p = player(id, { energy: 99 });
    CombatSpecial.activate(p);
    assert.equal(p.current, 80);
    assert.equal(p.energy, 99);
    assert.deepEqual(p.calls.messages, ["You don't have enough power left."]);
    assert.deepEqual(p.calls.chat, []);
    assert.deepEqual(p.calls.animations, []);
    assert.deepEqual(p.calls.graphics, []);
  });
}

test("Fishstabber refreshes its boost without stacking or reducing a stronger boost", () => {
  for (const [, id] of HARPOONS) {
    for (const [current, expected] of [[78, 83], [82, 83], [83, 83], [85, 85]]) {
      const p = player(id, { current });
      CombatSpecial.activate(p);
      assert.equal(p.current, expected);
      assert.equal(p.energy, 0);
    }
  }
});

test("bank copies, regular harpoons and Gauntlet tools do not acquire Fishstabber", () => {
  for (const id of [Items.DRAGON_HARPOON_2, Items.DRAGON_HARPOON_3,
    Items.INFERNAL_HARPOON_2, Items.CRYSTAL_HARPOON_2, Items.CRYSTAL_HARPOON_INACTIVE__2,
    Items.INFERNAL_HARPOON_OR__2, Items.INFERNAL_HARPOON_UNCHARGED__3,
    Items.DRAGON_HARPOON_OR__2, Items.HARPOON, Items.BARB_TAIL_HARPOON,
    Items.CRYSTAL_HARPOON_3, Items.CORRUPTED_HARPOON]) {
    assert.equal(CombatSpecial.getForWeaponId(id), null, String(id));
  }
});
