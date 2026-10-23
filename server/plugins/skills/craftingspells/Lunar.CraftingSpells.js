/**
 * Spin Flax, Tan Leather and Superglass Make (Wiki): Lunar spells cast on nothing.
 *
 * Spin Flax spins up to five flax into bow strings, 15 Crafting XP each. Tan Leather tans up to
 * five hides. Superglass Make turns every bucket of sand matched with soda ash, seaweed, swamp
 * weed or giant seaweed (six sand each) into molten glass, 10 Crafting XP per sand, with a
 * chance of a second glass; glass that does not fit drops. Lunar spells need 40 Defence.
 * The "none" messages are not captured.
 */
const { DATA, itemId, runes } = require("./Data.CraftingSpells");

const LUNAR = DATA.lunar;

let core = null;
let spells = null;

/** Spell name (lower case) -> spell, built on first use. */
function lunarSpells() {
  if (spells) return spells;

  class LunarCraftingSpell extends core.Spell {
    constructor(name, data) {
      super();
      this.data = data;
      this.members = true;
      this.runeItems = runes(core, data.runes);
      const widget = core.CacheDefinitions.getSpellByName(name);
      if (!widget) throw new Error(`Missing cache spell: ${name}`);
      this.id = widget.widgetId;
    }
    spellId() { return this.id; }
    levelRequired() { return this.data.level; }
    baseExperience() { return this.data.xp; }
    itemsRequired() { return this.runeItems; }
    equipmentRequired() { return []; }
    startCast() {}
    getSpellbook() { return core.MagicSpellbook.LUNAR; }
  }

  return spells = new Map(Object.entries(LUNAR.spells).map(([name, data]) =>
    [name.toLowerCase(), Object.assign(new LunarCraftingSpell(name, data), { effect: EFFECTS[name] })]));
}

/** Converts up to `batch` of the spell's inputs; the number converted. */
function convert(player, spell) {
  const conversions = new Map(spell.data.conversions.map(([from, to]) => [itemId(core, from), itemId(core, to)]));
  let converted = 0;
  for (const item of player.getInventory().getValidItems()) {
    const result = conversions.get(item.getId());
    if (result === undefined || converted >= spell.data.batch) continue;
    item.setId(result);
    converted++;
  }
  return converted;
}

function hasConvertible(player, spell) {
  return spell.data.conversions.some(([from]) => player.getInventory().contains(itemId(core, from)));
}

function spinOrTan(player, spell) {
  const converted = convert(player, spell);
  if (spell.data.craftingXp > 0) {
    player.getSkillManager().addExperiences(core.Skill.CRAFTING, converted * spell.data.craftingXp);
  }
}

function hasGlassMaterials(player, spell) {
  const inventory = player.getInventory();
  return inventory.contains(itemId(core, spell.data.sand)) &&
    spell.data.ash.some((ash) => inventory.contains(itemId(core, ash.item)));
}

function superglass(player, spell) {
  const { data } = spell;
  const inventory = player.getInventory();
  const sandId = itemId(core, data.sand);
  let sand = inventory.getAmount(sandId);
  let glass = 0;
  let used = 0;
  for (const ash of data.ash) {
    const ashId = itemId(core, ash.item);
    while (sand > 0 && inventory.getAmount(ashId) > 0) {
      inventory.deleteNumber(ashId, 1);
      const matched = Math.min(ash.sand, sand);
      sand -= matched;
      used += matched;
      for (let i = 0; i < matched; i++) glass += Math.random() < ash.bonusChance ? 2 : 1;
    }
  }
  inventory.deleteNumber(sandId, used);
  const glassId = itemId(core, data.glass);
  for (let i = 0; i < glass; i++) inventory.forceAdd(player, new core.Item(glassId, 1));
  player.getSkillManager().addExperiences(core.Skill.CRAFTING, used * data.craftingXp);
}

const EFFECTS = {
  "Spin Flax": { has: hasConvertible, cast: spinOrTan },
  "Tan Leather": { has: hasConvertible, cast: spinOrTan },
  "Superglass Make": { has: hasGlassMaterials, cast: superglass },
};

function castLunarCraftingSpell(event) {
  const spell = lunarSpells().get(event.spellName.trim().toLowerCase());
  const { player } = event;
  if (!spell || player.getSpellbook() !== core.MagicSpellbook.LUNAR) return;
  event.handled = true;
  if (player.getSkillManager().getMaxLevel(core.Skill.DEFENCE) < LUNAR.defenceLevel) {
    player.sendMessage(`You need at least level ${LUNAR.defenceLevel} Defence to cast Lunar spells.`);
    return;
  }
  if (!spell.effect.has(player, spell)) {
    player.sendMessage(spell.data.noneMessage);
    return;
  }
  if (!spell.canCast(player, false) || !spell.canCast(player, true)) return;
  player.performAnimation(new core.Animation(LUNAR.castSeq));
  player.performGraphic(new core.Graphic(spell.data.spotanim));
  spell.effect.cast(player, spell);
  player.getInventory().refreshItems();
  player.getSkillManager().addExperiences(core.Skill.MAGIC, spell.baseExperience());
}

module.exports = function attach(api) {
  core = api.core;
  api.onSpellCast(castLunarCraftingSpell);
};
