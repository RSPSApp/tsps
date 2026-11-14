// Run after `yarn build`: node --test tests/spirit-shields.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
CachePipeline.initialize();
const { CombatConstants } = require("../dist/game/content/combat/CombatConstants");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { ItemIds } = require("../dist/util/IdEnums");

require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });

const SpiritShieldEffects = require("../plugins/combat/effects/SpiritShields.EquipmentEffects");

let prayerDrain;
SpiritShieldEffects({
  registerPrayerDrainModifier: (modifier) => { prayerDrain = modifier; },
});

function item(id) {
  return {
    id,
    getId() { return this.id; },
    setId(next) { this.id = next; },
  };
}

function wearing(shieldId) {
  const player = {
    isPlayer: () => true,
    getAsPlayer: () => player,
    getEquipment: () => ({
      getItems: () => {
        const items = new Array(11).fill(null);
        items[Equipment.SHIELD_SLOT] = item(shieldId);
        return items;
      },
    }),
  };
  return player;
}

// Blessing (Holy elixir on a spirit shield) and the sigils at an anvil are the Corporeal Beast unit's:
// tests/corporeal-beast.test.cjs and tests/spirit-shield-preset-meta.test.cjs.
test("the shields carry the Wiki's attack, defence and magic-damage stats", () => {
  const bonuses = (id) => ItemDefinition.forId(id).getBonuses();
  assert.equal(bonuses(ItemIds.ARCANE_SPIRIT_SHIELD)[3], 20, "+20 Magic attack");
  assert.equal(bonuses(ItemIds.ARCANE_SPIRIT_SHIELD)[12], 3, "+3% Magic damage");
  assert.equal(bonuses(ItemIds.SPECTRAL_SPIRIT_SHIELD)[8], 30, "+30 Magic defence");
  assert.equal(bonuses(ItemIds.ELYSIAN_SPIRIT_SHIELD)[13], 3, "Prayer bonus");
  assert.equal(bonuses(ItemIds.BLESSED_SPIRIT_SHIELD)[12], 0, "Blessed has no effect");
});

test("the Elysian passive stays at 70% for a 25% reduction", () => {
  assert.equal(CombatConstants.ELYSIAN_ACTIVATION_CHANCE, 0.7);
  assert.equal(CombatConstants.ELYSIAN_DAMAGE_REDUCTION, 0.75);
});

test("the spectral shield halves NPC prayer drains, not PvP ones", () => {
  const spectral = wearing(ItemIds.SPECTRAL_SPIRIT_SHIELD);
  assert.equal(prayerDrain(spectral, 10, {}), 5);
  assert.equal(prayerDrain(spectral, 5, {}), 2, "odd drains floor");
  assert.equal(prayerDrain(spectral, 3, {}), 1);
  assert.equal(prayerDrain(spectral, 10, { attacker: { isPlayer: () => true } }), 10);
  assert.equal(prayerDrain(wearing(ItemIds.BLESSED_SPIRIT_SHIELD), 10, {}), 10);
  assert.equal(prayerDrain(wearing(ItemIds.ARCANE_SPIRIT_SHIELD), 10, {}), 10);
  assert.equal(prayerDrain(wearing(ItemIds.ELYSIAN_SPIRIT_SHIELD), 10, {}), 10);

  let total = 0;
  for (let i = 0; i < 400; i++) total += prayerDrain(spectral, 1, {});
  assert.ok(total > 150 && total < 250, `one-point drains average 50%, got ${total}/400`);
});
