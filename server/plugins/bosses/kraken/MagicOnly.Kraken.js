"use strict";

/**
 * Style rules on surfaced krakens (see ../Kraken.plugin.js for behaviour and sources).
 * Wiki (Kraken, Cave kraken): Magic is the only reliable damage — Ranged deals 1/7th of
 * its normal damage, and Melee cannot be used at all (even halberds). A long-range melee
 * hit shows "You can't attack it properly like that." (Wiki).
 *
 * The seventh is a floor of one, not a truncation to nothing: "If you rolled 0 damage, it
 * stays as 0. If you rolled >=1 damage, it's divided by 7, with a floor of 1." (Mod Ash,
 * 6 September 2023, cited on Kraken and Kraken/Strategies).
 *
 * Only player attackers are filtered (id test first): thralls attack as NPCs, so their
 * hits pass through untouched — the boss is not thrall-immune (Wiki), and per-NPC
 * thrall immunity is not modelled anywhere yet. Cannons need no handling here either:
 * cannon-restrictions.json bans them cove-wide ("You can't set up a cannon here.").
 */

const Shared = require("./Shared.Kraken");

const MELEE_MESSAGE = "You can't attack it properly like that.";

/** A ranged roll divided by seven, never below one unless nothing was rolled (Wiki). */
function rangedDamage(total) {
  const damage = Math.floor(total);
  return damage > 0 ? Math.max(1, Math.floor(damage / 7)) : 0;
}

function magicOnly({ npc, hit }) {
  if (!npc || !hit) return;
  if (!Shared.isMagicOnlyId(npc.getId?.())) return;
  const attacker = hit.getAttacker?.();
  if (!attacker?.isPlayer?.()) return;
  const { CombatType } = Shared.core();
  const type = hit.getCombatType?.();
  if (type === CombatType.MAGIC) return;
  if (type === CombatType.RANGED) {
    if (typeof hit.getTotalDamage === "function" && typeof hit.setTotalDamage === "function") {
      hit.setTotalDamage(rangedDamage(hit.getTotalDamage()));
    }
    return;
  }
  if (typeof hit.setTotalDamage === "function") hit.setTotalDamage(0);
  try {
    attacker.sendMessage(MELEE_MESSAGE);
  } catch {
    // Damage is already zeroed; the message is best-effort.
  }
}

function attach(api) {
  api.onNpcHitModify(magicOnly);
}

module.exports = { attach, magicOnly, rangedDamage, MELEE_MESSAGE };
