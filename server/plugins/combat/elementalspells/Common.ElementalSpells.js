const ELEMENTS = ['WIND', 'WATER', 'EARTH', 'FIRE'];
const FAMILIES = new Set(['STRIKE', 'BOLT', 'BLAST', 'WAVE', 'SURGE']);
const spells = new Map();
const families = new Map();
const amulets = new Map();
let core;
let pluginApi;

function init(api) {
  core = api.core;
  pluginApi = api;
  spells.clear(); families.clear(); amulets.clear();
  for (const [name, spell] of Object.entries(core.CombatSpells)) {
    const [element, family] = name.split('_');
    if (!ELEMENTS.includes(element) || !FAMILIES.has(family) || name !== element+'_'+family || typeof spell?.spellId !== 'function') continue;
    const entry = { element: ELEMENTS.indexOf(element)+1, family, spell };
    spells.set(spell.spellId(), entry);
    if (!families.has(family)) families.set(family, []);
    families.get(family).push(entry);
  }
  for (const [index, name] of ['AIR','WATER','EARTH','FIRE'].entries()) {
    const id = core.ItemIdentifiers['AMULET_OF_'+name];
    if (Number.isInteger(id)) amulets.set(index+1, id);
  }
}
function metadata(spell) { return spells.get(spell?.spellId?.()) ?? null; }
function familyMaximum(entry, level) {
  const members = families.get(entry.family);
  const learned = members.filter(m => m.spell.levelRequired() <= level);
  return learned.length ? Math.max(...learned.map(m => m.spell.maximumHit()))
    : members.reduce((lowest, m) => m.spell.levelRequired() < lowest.spell.levelRequired() ? m : lowest).spell.maximumHit();
}
/**
 * The NPC's elemental weakness as `attacker`'s `spell` meets it: { type, percent } or null. An effect
 * may make the spell count as the element the target is weak to: `elemental-spells:weakness`
 * { attacker, target, spell, element (1 air .. 4 fire, 0 for none), weakness } lets handlers change
 * `weakness.type` (the cast spell itself stays as it is).
 */
function targetWeakness(attacker, target, spell, element = metadata(spell)?.element ?? 0) {
  if (!target?.isNpc?.()) return null;
  const value = target.getAsNpc().getCurrentDefinition().getElementalWeakness();
  if (!value) return null;
  const request = { attacker, target, spell, element, weakness: { type: value.type, percent: value.percent } };
  pluginApi?.emitCustomEvent?.('elemental-spells:weakness', request);
  return request.weakness;
}
function weakness(target, spell, attacker = null) {
  const entry = metadata(spell);
  if (!entry) return 0;
  const value = targetWeakness(attacker, target, spell, entry.element);
  return value?.type === entry.element ? value.percent : 0;
}
function matchingAmulet(player, element) {
  const id = player.getEquipment().get(core.Equipment.AMULET_SLOT)?.getId?.();
  return id === core.ItemIdentifiers.ELEMENTAL_AMULET || id === amulets.get(element);
}
module.exports = { init, metadata, familyMaximum, weakness, targetWeakness, matchingAmulet, get core() { return core; } };
