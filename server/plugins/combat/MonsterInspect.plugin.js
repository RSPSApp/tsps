// OSRS Wiki: Monster Inspect (normal book); its animation/sound use Monster Examine's assets.
const SPELL_NAME = 'Monster Inspect';
const EXPERIENCE = 30.5;
const STATS_INTERFACE = 522;
const STATS_SCRIPT = 1179;
const spells = new WeakMap();

function spellFor(core) {
  if (spells.has(core)) return spells.get(core);
  const widget = core.CacheDefinitions.getSpellByName(SPELL_NAME);
  const requirements = core.CacheDefinitions.getSpellRequirements(SPELL_NAME);
  if (!widget || !requirements) throw new Error(`Missing cache spell: ${SPELL_NAME}`);
  class InspectSpell extends core.Spell {
    spellId() { return widget.widgetId; }
    levelRequired() { return requirements.level; }
    baseExperience() { return EXPERIENCE; }
    itemsRequired() { return requirements.runes.map(rune => new core.Item(rune.id, rune.amount)); }
    equipmentRequired() { return []; }
    getSpellbook() { return core.MagicSpellbook.NORMAL; }
    startCast(player) {
      const cast = core.LunarSpells.CASTS['monster examine'];
      player.performAnimation(new core.Animation(cast.animation));
      player.performGraphic(new core.Graphic(cast.graphic));
      player.getPacketSender().sendSoundEffect(cast.sound, 1, 0, 255);
    }
  }
  const spell = new InspectSpell();
  spells.set(core, spell);
  return spell;
}

function resolveSpell(core, event) {
  if (event.spell || event.spellName !== SPELL_NAME) return;
  const spell = spellFor(core);
  if (event.spellWidget === spell.spellId()) event.spell = spell;
}

function inspect(core, event) {
  const spell = spells.get(core);
  if (!spell || event.handled || event.spell !== spell) return;
  event.handled = true;
  if (!event.consumeRunes()) return;
  event.player.getPacketSender()
    .sendMagicTabInterface(STATS_INTERFACE)
    .sendClientScript(STATS_SCRIPT, core.LunarSpells.monsterStats(event.npc, {
      includeMaxHit: false, includeAttackStyle: false, meleeBonusLabel: 'Attack bonus',
    }));
}

module.exports = {
  name: 'Monster Inspect',
  register(api) {
    api.onCustomEvent('magic:resolve-spell', resolveSpell.bind(null, api.core));
    api.onSpellOnNpc(inspect.bind(null, api.core));
  },
};
