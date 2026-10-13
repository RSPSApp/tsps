const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { ItemIds } = require("../../src/main/typescript/elvarg/util/IdEnums");

/**
 * Wiki (Lvl-1 to Lvl-7 Enchant): casting an enchant spell on a strung gem-set ring, necklace
 * or amulet turns it into its magical version, using up the piece and the runes.
 * Each spell covers one gem: sapphire, emerald, ruby, diamond, dragonstone, onyx, zenyte.
 *
 * `from` -> `to` pairs are per item. Amulets are enchanted strung, so the sapphire amulet is
 * the strung one (the (u) item cannot be enchanted).
 *
 * ponytail: runes come from the inventory only (no elemental staves, rune pouch or combination
 * runes); opal, jade and red topaz jewellery and bracelets are not here yet.
 */
const ENCHANT_SPELLS = [
  {
    name: "Lvl-1 Enchant", level: 7, xp: 17.5,
    runes: [[ItemIds.COSMIC_RUNE, 1], [ItemIds.WATER_RUNE, 1]],
    items: [
      [ItemIds.SAPPHIRE_RING, ItemIds.RING_OF_RECOIL],
      [ItemIds.SAPPHIRE_NECKLACE, ItemIds.GAMES_NECKLACE_8_],
      [ItemIds.SAPPHIRE_AMULET_2, ItemIds.AMULET_OF_MAGIC],
    ],
  },
  {
    name: "Lvl-2 Enchant", level: 27, xp: 37,
    runes: [[ItemIds.COSMIC_RUNE, 1], [ItemIds.AIR_RUNE, 3]],
    items: [
      [ItemIds.EMERALD_RING, ItemIds.RING_OF_DUELING_8_],
      [ItemIds.EMERALD_NECKLACE, ItemIds.BINDING_NECKLACE],
      [ItemIds.EMERALD_AMULET_2, ItemIds.AMULET_OF_DEFENCE],
    ],
  },
  {
    name: "Lvl-3 Enchant", level: 49, xp: 59,
    runes: [[ItemIds.COSMIC_RUNE, 1], [ItemIds.FIRE_RUNE, 5]],
    items: [
      [ItemIds.RUBY_RING, ItemIds.RING_OF_FORGING],
      [ItemIds.RUBY_NECKLACE, ItemIds.DIGSITE_PENDANT_5_],
      [ItemIds.RUBY_AMULET_2, ItemIds.AMULET_OF_STRENGTH],
    ],
  },
  {
    name: "Lvl-4 Enchant", level: 57, xp: 67,
    runes: [[ItemIds.COSMIC_RUNE, 1], [ItemIds.EARTH_RUNE, 10]],
    items: [
      [ItemIds.DIAMOND_RING, ItemIds.RING_OF_LIFE],
      [ItemIds.DIAMOND_NECKLACE, ItemIds.NECKLACE_OF_PASSAGE_5_],
      [ItemIds.DIAMOND_AMULET_2, ItemIds.AMULET_OF_POWER],
    ],
  },
  {
    name: "Lvl-5 Enchant", level: 68, xp: 78,
    runes: [[ItemIds.COSMIC_RUNE, 1], [ItemIds.WATER_RUNE, 15], [ItemIds.EARTH_RUNE, 15]],
    items: [
      [ItemIds.DRAGONSTONE_RING, ItemIds.RING_OF_WEALTH],
      [ItemIds.DRAGON_NECKLACE, ItemIds.SKILLS_NECKLACE_4_],
      [ItemIds.DRAGONSTONE_AMULET, ItemIds.AMULET_OF_GLORY],
    ],
  },
  {
    name: "Lvl-6 Enchant", level: 87, xp: 97,
    runes: [[ItemIds.COSMIC_RUNE, 1], [ItemIds.FIRE_RUNE, 20], [ItemIds.EARTH_RUNE, 20]],
    items: [
      [ItemIds.ONYX_RING_2, ItemIds.RING_OF_STONE],
      [ItemIds.ONYX_NECKLACE_2, ItemIds.BERSERKER_NECKLACE],
      [ItemIds.ONYX_AMULET_2, ItemIds.AMULET_OF_FURY],
    ],
  },
  {
    name: "Lvl-7 Enchant", level: 93, xp: 110,
    runes: [[ItemIds.COSMIC_RUNE, 1], [ItemIds.BLOOD_RUNE, 20], [ItemIds.SOUL_RUNE, 20]],
    items: [
      [ItemIds.ZENYTE_RING_2, ItemIds.RING_OF_SUFFERING],
      [ItemIds.ZENYTE_NECKLACE_2, ItemIds.NECKLACE_OF_ANGUISH],
      [ItemIds.ZENYTE_AMULET_2, ItemIds.AMULET_OF_TORTURE],
    ],
  },
];

const SPELLS_BY_NAME = new Map(ENCHANT_SPELLS.map((spell) => [spell.name.toLowerCase(), spell]));
const RESULT_BY_SPELL_AND_ITEM = new Map(
  ENCHANT_SPELLS.map((spell) => [spell.name.toLowerCase(), new Map(spell.items)])
);

/** The standard jewellery enchanting animation. */
const ENCHANT_ANIMATION = new Animation(720);

/**
 * Enchants the item in `slot` with the named spell. Returns true when the spell is an enchant
 * spell (so the event is ours, whether or not the cast succeeded), false when it is not.
 * `canUse` is the core's item-use check for magic ("can this item be used on a spell").
 */
function enchantItem(player, name, itemId, slot, canUse = () => true) {
  const key = name?.trim().toLowerCase() ?? "";
  const spell = SPELLS_BY_NAME.get(key);
  if (!spell) return false;

  const resultId = RESULT_BY_SPELL_AND_ITEM.get(key).get(itemId);
  if (resultId === undefined) {
    player.sendMessage("This spell cannot be cast on that item.");
    return true;
  }

  const inventory = player.getInventory();
  if (inventory.getItems()[slot]?.getId() !== itemId) return true;
  if (!canUse()) return true;
  if (player.getSkillManager().getCurrentLevel(Skill.MAGIC) < spell.level) {
    player.sendMessage(`You need a Magic level of ${spell.level} to cast this spell.`);
    return true;
  }
  if (!spell.runes.every(([runeId, amount]) => inventory.getAmount(runeId) >= amount)) {
    player.sendMessage("You do not have the required runes to cast this spell.");
    return true;
  }

  player.performAnimation(ENCHANT_ANIMATION);
  for (const [runeId, amount] of spell.runes) {
    inventory.deleteNumber(runeId, amount);
  }
  inventory.deleteNumber(itemId, 1);
  inventory.addItem(new Item(resultId, 1));
  player.getSkillManager().addExperiences(Skill.MAGIC, spell.xp);
  return true;
}

function handleSpellOnItem(event) {
  if (enchantItem(event.player, event.spellName, event.itemId, event.slot, event.canUse)) {
    event.handled = true;
  }
}

module.exports = {
  name: "EnchantJewellery",
  register(api) {
    api.onSpellOnItem(handleSpellOnItem);
    api.log("registered", { spells: ENCHANT_SPELLS.length });
  },
  enchantItem,
};
