// Run after `yarn build`: node --test tests/spirit-shields.test.cjs
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Skill } = require("../dist/game/model/Skill");
const { ItemIds } = require("../dist/util/IdEnums");

const SpiritShields = require("../plugins/items/SpiritShields.plugin");

let bless;
let attachSigil;
SpiritShields.register({
  core: { ItemIdentifiers: ItemIds, Skill },
  onItemOnItem: (handler) => {
    if (!bless) bless = handler;
    else attachSigil = handler;
  },
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
  return {
    messages,
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
    }),
    sendMessage: (message) => messages.push(message),
  };
}

test("a holy elixir blesses the spirit shield at 85 Prayer", () => {
  const player = createPlayer();
  const elixir = item(ItemIds.HOLY_ELIXIR);
  const shield = item(ItemIds.SPIRIT_SHIELD);
  const event = { player, usedItem: elixir, usedWithItem: shield, usedItemId: ItemIds.HOLY_ELIXIR, usedWithItemId: ItemIds.SPIRIT_SHIELD, handled: false };
  bless(event);
  assert.equal(event.handled, true);
  assert.equal(shield.getId(), ItemIds.BLESSED_SPIRIT_SHIELD);

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
