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
 * The NPC's elemental weakness as `attacker`'s `spell` meets it: { type, percent, added } or null
 * (none at all). `elemental-spells:weakness` { attacker, target, spell, element (1 air .. 4 fire,
 * 0 for none), weakness, added } lets effects change it: an effect may make the spell count as the
 * element the target is weak to by setting `weakness.type` (the cast spell itself stays as it is;
 * `weakness` is null for an NPC with none), or add a weakness to every element on top through
 * `added` (a percentage). `type` 0 means the NPC has no weakness of its own.
 */
function targetWeakness(attacker, target, spell, element = metadata(spell)?.element ?? 0) {
  if (!target?.isNpc?.()) return null;
  const value = target.getAsNpc().getCurrentDefinition().getElementalWeakness();
  const request = { attacker, target, spell, element, weakness: value ? { type: value.type, percent: value.percent } : null, added: 0 };
  pluginApi?.emitCustomEvent?.('elemental-spells:weakness', request);
  const added = Math.max(0, Math.floor(Number(request.added) || 0));
  if (!request.weakness && !added) return null;
  return { type: request.weakness?.type ?? 0, percent: request.weakness?.percent ?? 0, added };
}
/** The target's weakness to `element` (1 air .. 4 fire) as `attacker`'s `spell` meets it, in percent. */
function elementWeakness(attacker, target, spell, element) {
  const value = targetWeakness(attacker, target, spell, element);
  if (!value || !element) return 0;
  return (value.type === element ? value.percent : 0) + value.added;
}
function weakness(target, spell, attacker = null) {
  const entry = metadata(spell);
  if (!entry) return 0;
  return elementWeakness(attacker, target, spell, entry.element);
}
function matchingAmulet(player, element) {
  const id = player.getEquipment().get(core.Equipment.AMULET_SLOT)?.getId?.();
  return id === core.ItemIdentifiers.ELEMENTAL_AMULET || id === amulets.get(element);
}
module.exports = { init, metadata, familyMaximum, weakness, targetWeakness, elementWeakness, matchingAmulet, get core() { return core; } };
