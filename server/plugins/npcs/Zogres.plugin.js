"use strict";

/**
 * Zogres, skogres and Slash Bash shrug off most attacks (docs/zogres.md). The Wiki (Zogre, Skogre):
 * "almost immune to normal weapons (you will hit just as often, but damage is reduced by 75%)", with
 * Mod Ash's "Damage divided by 4. I didn't see any sign of a floor."; brutal arrows are effective and
 * Crumble Undead's "damage is halved". Slash Bash's page puts numbers on the two exceptions:
 * "Attacks against Slash Bash will only hit up to 25% of their normal max hit", brutal arrows 100%,
 * Crumble Undead 50%. Each rolled hit is scaled before protection and the hitsplat.
 * Ours: only a player's own attacks are scaled (the pages don't say how thralls or a cannon fare).
 */
const ZOGRE_NAMES = new Set(["Zogre", "Skogre", "Slash Bash"]);
const NORMAL_DIVISOR = 4;
const CRUMBLE_UNDEAD_DIVISOR = 2;
const BRUTAL_NAME = /\bbrutal$/i;

let core = null;

function isZogre(npc) {
  return ZOGRE_NAMES.has(npc.getCurrentDefinition?.()?.getName?.());
}

/** A brutal arrow fired from the ammo slot (an ogre or comp ogre bow), not a weapon's own ammo. */
function firesBrutal(player) {
  const { Ammunition, Equipment, ItemDefinition } = core;
  const ammoId = player.getEquipment().get(Equipment.AMMUNITION_SLOT)?.getId?.();
  if (!Number.isInteger(ammoId) || ammoId <= 0) return false;
  if (!BRUTAL_NAME.test(ItemDefinition.forId(ammoId)?.getName?.() ?? "")) return false;
  const fromSlot = Ammunition.getForItem(ammoId);
  return fromSlot != null && Ammunition.getFor(player) === fromSlot;
}

function divisorFor(attacker, hit, combatType) {
  const { CombatSpells, CombatType } = core;
  if (combatType === CombatType.RANGED && firesBrutal(attacker.getAsPlayer())) return 1;
  if (combatType === CombatType.MAGIC) {
    const spell = hit?.getSpellContext?.()?.spell ?? hit?.getSpell?.();
    if (spell === CombatSpells.CRUMBLE_UNDEAD) return CRUMBLE_UNDEAD_DIVISOR;
  }
  return NORMAL_DIVISOR;
}

function scaleZogreHit({ attacker, target, hit, combatType, damage, accurate }) {
  if (!accurate || !attacker?.isPlayer?.() || !target?.isNpc?.() || !isZogre(target)) return;
  const divisor = divisorFor(attacker, hit, combatType);
  if (divisor === 1) return;
  damage.setDamage(Math.floor(damage.getDamage() / divisor));
}

module.exports = {
  name: "Zogres",
  description: "Zogres, skogres and Slash Bash take a quarter of most damage, half from Crumble Undead and full from brutal arrows.",
  members: true,
  register(api) {
    core = api.core;
    api.onCombatHitDamage(scaleZogreHit);
  },
};
