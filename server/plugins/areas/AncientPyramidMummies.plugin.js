const FIRE_SPELLS = new Set();
const WATER_SPELLS = new Set();
let bases;
let burning;
let magicType;

function mummyTransition(id, element, damage, accurate) {
  if (!accurate) return null;
  if (element === "fire" && damage > 0) {
    const index = bases.indexOf(id);
    return index < 0 ? null : { id: burning[index], lit: true };
  }
  if (element === "water") {
    const index = burning.indexOf(id);
    return index < 0 ? null : { id: bases[index], lit: false };
  }
  return null;
}

function spellElement(spell) {
  return FIRE_SPELLS.has(spell) ? "fire" : WATER_SPELLS.has(spell) ? "water" : null;
}

function hitDamage({ attacker, target, hit, damage, accurate, combatType }) {
  if (!attacker?.isPlayer?.() || !target?.isNpc?.() || combatType !== magicType) return;
  const spell = hit?.getSpellContext?.()?.spell ?? hit?.getSpell?.();
  const change = mummyTransition(target.getId(), spellElement(spell), damage?.getDamage?.() ?? 0, accurate);
  if (!change) return;
  target.setNpcTransformationId(change.id);
  if (change.lit) api.emitCustomEvent("league:complete-task", { player: attacker.getAsPlayer(), id: "set-a-mummy-ablaze" });
}

let api;
function attach(pluginApi) {
  api = pluginApi;
  const { NpcIdentifiers, CombatSpells, CombatType } = api.core;
  // Cache MUMMY_2–5 are the Ancient Pyramid's four models; MUMMY_7–10 are their alight forms.
  bases = [NpcIdentifiers.MUMMY_2, NpcIdentifiers.MUMMY_3, NpcIdentifiers.MUMMY_4, NpcIdentifiers.MUMMY_5];
  burning = [NpcIdentifiers.MUMMY_7, NpcIdentifiers.MUMMY_8, NpcIdentifiers.MUMMY_9, NpcIdentifiers.MUMMY_10];
  for (const [name, spell] of Object.entries(CombatSpells)) {
    if (/^FIRE_(STRIKE|BOLT|BLAST|WAVE|SURGE)$/.test(name)) FIRE_SPELLS.add(spell);
    if (/^WATER_(STRIKE|BOLT|BLAST|WAVE|SURGE)$/.test(name)) WATER_SPELLS.add(spell);
  }
  magicType = CombatType.MAGIC;
  api.onCombatHitDamage(hitDamage);
}

module.exports = {
  name: "Ancient Pyramid Mummies",
  description: "Ancient Pyramid mummy fire and water spell transformations.",
  members: true,
  register: attach,
};
