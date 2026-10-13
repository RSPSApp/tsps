// Run after `yarn build`: node --test tests/blighted-sacks.test.cjs
// Checks the blighted spell sacks against https://oldschool.runescape.wiki/w/Blighted_rune_sack
// with the real cache: a carried sack covers a covered spell's whole rune cost, one sack goes per
// cast, and none of it works off pvp-tagged ground.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { Item } = require("../dist/game/model/Item");
const { Location } = require("../dist/game/model/Location");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { CombatSpells } = require("../dist/game/content/combat/magic/CombatSpells");
const { EffectSpells } = require("../dist/game/content/combat/magic/EffectSpells");
const { LunarSpells } = require("../dist/game/content/combat/magic/LunarSpells");
const { MagicSpellbook } = require("../dist/game/model/MagicSpellbook");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");

const DATA = require("../plugins/items/data/blighted-sacks.json");
const Sacks = require("../plugins/items/BlightedSacks.plugin");

/** Both are pvp-tagged in world.json: the surface Wilderness and the Revenant Caves under it. */
const WILDERNESS = new Location(3100, 3600, 0);
const CAVES = new Location(3200, 10100, 0);
const TOWN = new Location(3222, 3222, 0);
const NO_RUNES_MESSAGE = "You do not have the required items to cast this spell.";

before(async () => {
  const { CachePipeline } = require("../dist/game/cache/CachePipeline");
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  // The real plugin through the real PluginManager, so onSpellCost dispatches for the cast paths.
  Sacks.register(PluginManager.createApi("BlightedSacksTest"));
});

const stack = (id, amount) => new Item(id, amount);

function createContainer(initial = []) {
  const items = [...initial];
  const container = {
    getItems: () => items,
    getValidItems: () => items.filter((item) => item.getId() > 0 && item.getAmount() > 0),
    getAmount: (id) => items.filter((item) => item.getId() === id).reduce((total, item) => total + item.getAmount(), 0),
    contains: (id) => items.some((item) => item.getId() === id && item.getAmount() > 0),
    containsNumber: (id) => container.getAmount(id) > 0,
    containsAllItem: (needed) => needed.filter((item) => item).every((item) => container.containsNumber(item.getId())),
    getFreeSlots: () => 28 - container.getValidItems().length,
    deleteNumber(id, amount) {
      let left = amount;
      for (const item of [...items]) {
        if (left <= 0 || item.getId() !== id) continue;
        const taken = Math.min(left, item.getAmount());
        item.setAmount(item.getAmount() - taken);
        left -= taken;
        if (item.getAmount() <= 0) items.splice(items.indexOf(item), 1);
      }
      return container;
    },
    deletes(item) {
      return container.deleteNumber(item.getId(), item.getAmount());
    },
    deleteItemSet(set) {
      for (const item of set.filter((entry) => entry)) container.deletes(item);
      return container;
    },
    refreshItems: () => container,
  };
  return container;
}

/** A caster with the few extras the Vengeance and Lunar target-cast paths touch. */
function createPlayer({ items = [], at = WILDERNESS, book = MagicSpellbook.NORMAL, area = null } = {}) {
  const inventory = createContainer(items);
  const equipment = Array.from({ length: 14 }, () => stack(-1, 0));
  const attributes = new Map();
  const sender = {
    sendMessage: (message) => player.messages.push(message),
    sendEffectTimer: () => sender,
    sendInterfaceRemoval: () => sender,
  };
  const player = {
    messages: [],
    inventory,
    vengeance: false,
    sendMessage(message) {
      player.messages.push(message);
    },
    getInventory: () => inventory,
    getEquipment: () => ({
      getItems: () => equipment,
      get: (slot) => equipment[slot],
      containsAllItem: () => true,
    }),
    getLocation: () => at,
    getArea: () => area,
    getSkillManager: () => ({ getCurrentLevel: () => 99, getMaxLevel: () => 99, addExperiences() {} }),
    getSpellbook: () => book,
    getCombat: () => ({ setCastSpell() {}, reset() {}, getCastSpell: () => null }),
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getPacketSender: () => sender,
    performAnimation() {},
    performGraphic() {},
    getDueling: () => ({ inDuel: () => false }),
    hasVengeanceReturn: () => false,
    setHasVengeance(value) {
      player.vengeance = value;
    },
    getVengeanceTimer: () => ({ finished: () => true, start() {}, secondsRemaining: () => 0 }),
  };
  return player;
}

/** The other player a Lunar target-cast needs: accepts aid, and has no Vengeance running. */
function createTarget(at) {
  return createPlayer({ at });
}

/** A sack's stackable id, from the names the data file uses. */
function sackId(name) {
  const ids = Sacks._test.sackIds().get(name);
  assert.ok(ids && ids.length > 0, `${name} is in the cache`);
  return ids[0];
}

function spell(id) {
  const found = CombatSpells.getCombatSpell(id) ?? EffectSpells.forSpellId(id);
  assert.ok(found, `no spell with id ${id}`);
  return found;
}

/** `[item, amount]` pairs into a real cost list, the way core's `itemsRequired` returns them. */
function costOf(spk, player) {
  return spk.itemsRequired(player).filter((item) => item != null).map((item) => [item.getId(), item.getAmount()]);
}

test("every sack in the data is a cache item a player can hold", () => {
  for (const sack of DATA.sacks) {
    const id = sackId(sack.item);
    const definition = CacheDefinitions.getItem(id);
    assert.equal(definition.name, sack.item);
    assert.equal(definition.inventoryActions.filter(Boolean).join("|"), "Drop", "Wiki: the only option is Drop");
  }
});

test("every spell the data lists is a spell the engine can cast", () => {
  for (const sack of DATA.sacks) {
    for (const entry of sack.spells) {
      const spk = spell(entry.id);
      assert.equal(spk.spellId(), entry.id, entry.name);
      assert.ok(spk.itemsRequired(createPlayer()).length > 0, `${entry.name} has a rune cost to replace`);
    }
  }
});

test("each sack pays for all of its own spells, with no runes carried", () => {
  for (const sack of DATA.sacks) {
    for (const entry of sack.spells) {
      const spk = spell(entry.id);
      const held = sackId(sack.item);
      const player = createPlayer({ items: [stack(held, 5)], book: spk.getSpellbook() });
      assert.equal(spk.canCast(player, true), true, `${sack.item} -> ${entry.name}`);
      assert.equal(player.inventory.getAmount(held), 4, `${sack.item} -> ${entry.name}`);
      assert.deepEqual(player.messages, []);
    }
  }
});

test("the caster's own runes pay, and the sack stays", () => {
  const spk = spell(1592); // Entangle
  const held = sackId("Blighted entangle sack");
  const cost = costOf(spk, createPlayer());
  const player = createPlayer({ items: [stack(held, 3), ...cost.map(([id, amount]) => stack(id, amount + 5))] });

  assert.equal(spk.canCast(player, true), true);
  for (const [id, amount] of cost) {
    assert.equal(player.inventory.getAmount(id), 5, `rune ${id} paid its own cost`);
  }
  assert.equal(player.inventory.getAmount(held), 3, "the sack was never touched");
});

test("short of a rune the sack pays the whole cost, and the held runes stay", () => {
  const spk = spell(1592); // Entangle, so 5 water, 5 earth, 4 nature
  const held = sackId("Blighted entangle sack");
  const cost = costOf(spk, createPlayer());
  const [water, earth, nature] = cost.map(([id]) => id);
  const player = createPlayer({
    items: [stack(held, 2), stack(water, 1), stack(earth, 5), stack(nature, 4)],
  });

  assert.equal(spk.canCast(player, true), true);
  assert.equal(player.inventory.getAmount(held), 1, "one sack, for a cost the runes could not cover");
  assert.equal(player.inventory.getAmount(water), 1, "and the one water rune it was holding is kept");
  assert.equal(player.inventory.getAmount(earth), 5);
  assert.equal(player.inventory.getAmount(nature), 4);
});

test("the last sack is spent, and the cast after it asks for runes", () => {
  const spk = spell(12891); // Ice Barrage, on the Ancient book
  const held = sackId("Blighted ancient ice sack");
  const player = createPlayer({ items: [stack(held, 1)], book: MagicSpellbook.ANCIENT });

  assert.equal(spk.canCast(player, true), true);
  assert.equal(player.inventory.getAmount(held), 0);

  assert.equal(spk.canCast(player, true), false);
  assert.deepEqual(player.messages, [NO_RUNES_MESSAGE]);
});

test("a sack only covers its own family", () => {
  const ice = sackId("Blighted ancient ice sack");
  const entangle = createPlayer({ items: [stack(ice, 9)] });
  assert.equal(spell(1592).canCast(entangle, true), false, "the ice sack does not pay for Entangle");
  assert.deepEqual(entangle.messages, [NO_RUNES_MESSAGE]);
  assert.equal(entangle.inventory.getAmount(ice), 9, "and none of it went");

  const surge = sackId("Blighted surge sack");
  const barrage = createPlayer({ items: [stack(surge, 9)], book: MagicSpellbook.ANCIENT });
  assert.equal(spell(12891).canCast(barrage, true), false, "the surge sack does not pay for Ice Barrage");
  assert.equal(barrage.inventory.getAmount(surge), 9);
});

test("an uncovered spell still asks for its own runes next to a sack", () => {
  const held = sackId("Blighted ancient ice sack");
  const player = createPlayer({ items: [stack(held, 5)] });
  assert.equal(CombatSpells.WIND_STRIKE.canCast(player, true), false);
  assert.deepEqual(player.messages, [NO_RUNES_MESSAGE]);
  assert.equal(player.inventory.getAmount(held), 5);
});

test("the sacks do not work off pvp-tagged ground", () => {
  const spk = spell(1592); // Entangle, standard book
  const held = sackId("Blighted entangle sack");
  const player = createPlayer({ items: [stack(held, 5)], at: TOWN });
  assert.equal(spk.canCast(player, true), false);
  assert.deepEqual(player.messages, [NO_RUNES_MESSAGE]);
  assert.equal(player.inventory.getAmount(held), 5);
});

test("the caves under the Wilderness count, and so does a listed arena", () => {
  const spk = spell(1582); // Snare
  const held = sackId("Blighted entangle sack");
  const caves = createPlayer({ items: [stack(held, 2)], at: CAVES });
  assert.equal(spk.canCast(caves, true), true, "Revenant Caves are pvp-tagged");
  assert.equal(caves.inventory.getAmount(held), 1);

  const castleWars = createPlayer({
    items: [stack(held, 2)],
    at: new Location(2400, 3100, 0),
    area: { getName: () => "Castle Wars" },
  });
  assert.equal(spk.canCast(castleWars, true), true, "Castle Wars is on the Wiki's list");
  assert.equal(castleWars.inventory.getAmount(held), 1);
});

test("Vengeance pays a sack on its own self-cast path", () => {
  const held = sackId("Blighted vengeance sack");
  const player = createPlayer({ items: [stack(held, 2)], book: MagicSpellbook.LUNAR });

  // EffectSpells.handleSpell checks with canCast(player, false) and then pays via deleteItemSet,
  // so this is the path a player clicking Vengeance on the spellbook actually takes.
  assert.equal(EffectSpells.handleSpell(player, EffectSpells.VENGEANCE.spellId()), true);
  assert.equal(player.inventory.getAmount(held), 1, "one sack");
  assert.equal(player.vengeance, true, "and the effect landed");
});

test("Vengeance Other pays a sack on the Lunar cast-on-player path", () => {
  const held = sackId("Blighted vengeance sack");
  const caster = createPlayer({ items: [stack(held, 2)], book: MagicSpellbook.LUNAR });
  const target = createTarget(new Location(3104, 3600, 0));

  assert.equal(LunarSpells.handlePlayerTarget(caster, target, "Vengeance Other"), true);
  assert.equal(caster.inventory.getAmount(held), 1, "one sack");
  assert.equal(target.vengeance, true, "and the target got the effect");
});
