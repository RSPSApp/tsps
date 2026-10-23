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
const { Skill } = require("../dist/game/model/Skill");
const { ItemIds } = require("../dist/util/IdEnums");

require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });

const SpiritShields = require("../plugins/items/SpiritShields.plugin");
const SpiritShieldEffects = require("../plugins/combat/effects/SpiritShields.EquipmentEffects");

let bless;
let attachSigil;
let prayerDrain;
SpiritShields.register({
  core: {
    ItemIdentifiers: ItemIds,
    Skill,
    Animation: class { constructor(id) { this.id = id; } },
    CacheDefinitions: { getSeqId: (name) => (name === "human_smithing" ? 898 : null) },
    Sound: { SMITHING: { id: 3790 }, PRAYER_RECHARGE: { id: 2674 } },
    Sounds: { sendSound: (player, sound) => player.sounds.push(sound.id) },
  },
  onItemOnItem: (handler) => {
    if (!bless) bless = handler;
    else attachSigil = handler;
  },
});
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

function createPlayer({ prayer = 99, smithing = 99, hammer = true } = {}) {
  const messages = [];
  const inventory = { items: hammer ? [item(ItemIds.HAMMER)] : [] };
  let smithingXp = 0;
  return {
    messages,
    sounds: [],
    animations: [],
    get smithingXp() { return smithingXp; },
    performAnimation(animation) { this.animations.push(animation.id); },
    getInventory: () => ({
      contains: (id) => inventory.items.some((entry) => entry.getId() === id),
      deleteNumber: (id) => {
        const index = inventory.items.findIndex((entry) => entry.getId() === id);
        if (index >= 0) inventory.items.splice(index, 1);
      },
      refreshItems: () => {},
    }),
    getSkillManager: () => ({
      getCurrentLevel: (skill) => (skill === Skill.PRAYER ? prayer : smithing),
      addExperience: (skill, amount) => { if (skill === Skill.SMITHING) smithingXp += amount; },
    }),
    sendMessage: (message) => messages.push(message),
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

test("a holy elixir blesses the spirit shield at 85 Prayer", () => {
  const player = createPlayer();
  const elixir = item(ItemIds.HOLY_ELIXIR);
  const shield = item(ItemIds.SPIRIT_SHIELD);
  const event = { player, usedItem: elixir, usedWithItem: shield, usedItemId: ItemIds.HOLY_ELIXIR, usedWithItemId: ItemIds.SPIRIT_SHIELD, handled: false };
  bless(event);
  assert.equal(event.handled, true);
  assert.equal(shield.getId(), ItemIds.BLESSED_SPIRIT_SHIELD);
  assert.deepEqual(player.sounds, [2674]);
  assert.match(player.messages.at(-1), /eerie holy glow/);

  const low = createPlayer({ prayer: 84 });
  const lockedShield = item(ItemIds.SPIRIT_SHIELD);
  bless({ player: low, usedItem: item(ItemIds.HOLY_ELIXIR), usedWithItem: lockedShield, usedItemId: ItemIds.HOLY_ELIXIR, usedWithItemId: ItemIds.SPIRIT_SHIELD, handled: false });
  assert.equal(lockedShield.getId(), ItemIds.SPIRIT_SHIELD);
  assert.match(low.messages.at(-1), /Prayer level of 85/);
});

test("sigils attach to a blessed shield with 90 Prayer, 85 Smithing and a hammer", () => {
  const player = createPlayer();
  const sigil = item(ItemIds.ARCANE_SIGIL);
  const shield = item(ItemIds.BLESSED_SPIRIT_SHIELD);
  const event = { player, usedItem: sigil, usedWithItem: shield, usedItemId: ItemIds.ARCANE_SIGIL, usedWithItemId: ItemIds.BLESSED_SPIRIT_SHIELD, handled: false };
  attachSigil(event);
  assert.equal(event.handled, true);
  assert.equal(shield.getId(), ItemIds.ARCANE_SPIRIT_SHIELD);
  assert.deepEqual(player.animations, [898]);
  assert.deepEqual(player.sounds, [3790]);
  assert.equal(player.smithingXp, 1800);

  const noHammer = createPlayer({ hammer: false });
  const elysian = item(ItemIds.BLESSED_SPIRIT_SHIELD);
  attachSigil({ player: noHammer, usedItem: item(ItemIds.ELYSIAN_SIGIL), usedWithItem: elysian, usedItemId: ItemIds.ELYSIAN_SIGIL, usedWithItemId: ItemIds.BLESSED_SPIRIT_SHIELD, handled: false });
  assert.equal(elysian.getId(), ItemIds.BLESSED_SPIRIT_SHIELD);
  assert.match(noHammer.messages.at(-1), /hammer/);

  const low = createPlayer({ smithing: 84 });
  const spectral = item(ItemIds.BLESSED_SPIRIT_SHIELD);
  attachSigil({ player: low, usedItem: item(ItemIds.SPECTRAL_SIGIL), usedWithItem: spectral, usedItemId: ItemIds.SPECTRAL_SIGIL, usedWithItemId: ItemIds.BLESSED_SPIRIT_SHIELD, handled: false });
  assert.equal(spectral.getId(), ItemIds.BLESSED_SPIRIT_SHIELD);
  assert.match(low.messages.at(-1), /Smithing/);

  const wrongBase = item(ItemIds.SPIRIT_SHIELD);
  const notHandled = { player, usedItem: item(ItemIds.ARCANE_SIGIL), usedWithItem: wrongBase, usedItemId: ItemIds.ARCANE_SIGIL, usedWithItemId: ItemIds.SPIRIT_SHIELD, handled: false };
  attachSigil(notHandled);
  assert.equal(notHandled.handled, false);
});

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
