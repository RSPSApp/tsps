"use strict";

/**
 * NPC flat armour (Wiki: Flat armour). Every landed melee or ranged hitsplat a player deals to one
 * of these monsters loses its flat armour, or gains it when the value is negative: "if a target has
 * 4 flat armour then an attack that would usually deal 10 damage would instead deal 6". Misses stay
 * 0, and each splat of a multi-hit weapon is adjusted on its own. A positive value takes a hit down
 * to no less than 0 (Wiki: Giant rockslug, "it will not take damage from attacks that deal that much
 * or lower damage").
 *
 * Left alone (Wiki): magic from players (spells and powered staves, the Voidwaker special), thralls,
 * poison and venom, burns and recoil. Only hits a player deals pass here, so thralls and other NPCs
 * don't; poison, burns and recoil are queued past the hit-modify hook.
 *
 * The values are the Wiki's list of NPCs with flat armour (data/npc-flat-armour.json), one row per
 * monster page, keyed by gameval. A player's landed hit is always at least 1 (combat rolls turn a
 * successful 0 into 1), so a splat above 0 is a landed one.
 */
const DATA = require("./data/npc-flat-armour.json");

let core = null;
/** npc id -> flat armour; built at register from the gamevals in the data file. */
const armourById = new Map();

function load(CacheDefinitions) {
  armourById.clear();
  for (const monster of DATA.monsters) {
    for (const gameval of monster.npcs) {
      const id = CacheDefinitions.getNpcId(gameval);
      if (id == null) throw new Error(`FlatArmour: unknown npc gameval ${gameval} (${monster.wiki})`);
      armourById.set(id, monster.flatArmour);
    }
  }
}

/** The flat armour of an NPC id, 0 when it has none. */
function flatArmourOf(id) {
  return armourById.get(id) ?? 0;
}

/** onNpcHitModify: a player's landed melee or ranged splats lose (or gain) the target's flat armour. */
function applyFlatArmour({ npc, hit }) {
  const armour = flatArmourOf(npc?.getId?.());
  if (!armour) return;
  if (!hit?.getAttacker?.()?.isPlayer?.()) return;
  const { CombatType } = core;
  // The damage type, not the method: the Voidwaker special is a melee swing that deals magic damage.
  const type = hit.getProtectionType?.() ?? hit.getCombatType();
  if (type !== CombatType.MELEE && type !== CombatType.RANGED) return;
  let changed = false;
  for (const splat of hit.getHits()) {
    const damage = splat.getDamage();
    if (damage <= 0) continue;
    splat.setDamage(Math.max(0, damage - armour));
    changed = true;
  }
  if (changed) hit.updateTotalDamage();
}

module.exports = {
  name: "FlatArmour",
  description: "NPC flat armour from the Wiki: each landed melee or ranged hitsplat a player deals to a listed monster loses its flat armour (to no less than 0), or gains it when the value is negative; magic, thralls and recoil are unaffected.",
  members: false,
  register(api) {
    core = api.core;
    load(core.CacheDefinitions);
    // Base stage: before content hooks that read or spend the damage (the Moons' fight health,
    // Dusk's phase floor, Nex's damage credit).
    api.onNpcHitModify(applyFlatArmour, { stage: "base" });
  },
  flatArmourOf,
  _test: { applyFlatArmour, armourById },
};
