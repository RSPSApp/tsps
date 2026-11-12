const FIRE_SPELLS = new Set();
const WATER_SPELLS = new Set();
// Wiki (Mummy (Ancient Pyramid)): "attacked with fire spells or fire arrows will be set alight".
const FIRE_ARROWS = new Set();
let bases;
let burning;
let magicType;
let rangedType;

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

function hitElement(attacker, hit, combatType) {
  if (combatType === magicType) return spellElement(hit?.getSpellContext?.()?.spell ?? hit?.getSpell?.());
  if (combatType !== rangedType) return null;
  // The worn arrow, not Combat.getAmmunition(): lit fire arrows fire as their plain arrow's entry. It counts only
  // when the shot is the ammo slot's (a bow): a knife, dart, thrown axe, chinchompa or self-ammo bow fires its own.
  const player = attacker.getAsPlayer();
  const ammo = player.getEquipment().get(api.core.Equipment.AMMUNITION_SLOT)?.getId?.();
  if (!FIRE_ARROWS.has(ammo)) return null;
  const { Ammunition } = api.core;
  const fromSlot = Ammunition.getForItem(ammo);
  return fromSlot != null && Ammunition.getFor(player) === fromSlot ? "fire" : null;
}

function hitDamage({ attacker, target, hit, damage, accurate, combatType }) {
  if (!attacker?.isPlayer?.() || !target?.isNpc?.()) return;
  const element = hitElement(attacker, hit, combatType);
  if (!element) return;
  const change = mummyTransition(target.getId(), element, damage?.getDamage?.() ?? 0, accurate);
  if (!change) return;
  target.setNpcTransformationId(change.id);
  if (change.lit) api.emitCustomEvent("league:complete-task", { player: attacker.getAsPlayer(), id: "set-a-mummy-ablaze" });
}

let api;
function attach(pluginApi) {
  api = pluginApi;
  const { NpcIdentifiers, CombatSpells, CombatType, ItemIdentifiers } = api.core;
  // Cache MUMMY_2–5 are the Ancient Pyramid's four models; MUMMY_7–10 are their alight forms.
  bases = [NpcIdentifiers.MUMMY_2, NpcIdentifiers.MUMMY_3, NpcIdentifiers.MUMMY_4, NpcIdentifiers.MUMMY_5];
  burning = [NpcIdentifiers.MUMMY_7, NpcIdentifiers.MUMMY_8, NpcIdentifiers.MUMMY_9, NpcIdentifiers.MUMMY_10];
  for (const [name, spell] of Object.entries(CombatSpells)) {
    if (/^FIRE_(STRIKE|BOLT|BLAST|WAVE|SURGE)$/.test(name)) FIRE_SPELLS.add(spell);
    if (/^WATER_(STRIKE|BOLT|BLAST|WAVE|SURGE)$/.test(name)) WATER_SPELLS.add(spell);
  }
  for (const [name, id] of Object.entries(ItemIdentifiers ?? {})) {
    if (/_FIRE_ARROW_LIT_/.test(name)) FIRE_ARROWS.add(id);
  }
  magicType = CombatType.MAGIC;
  rangedType = CombatType.RANGED;
  api.onCombatHitDamage(hitDamage);
}

module.exports = {
  name: "Ancient Pyramid Mummies",
  description: "Ancient Pyramid mummy transformations: fire spells and lit fire arrows set them alight, water spells douse them.",
  members: true,
  register: attach,
};
