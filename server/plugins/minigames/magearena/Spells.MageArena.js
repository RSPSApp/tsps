"use strict";

/**
 * Charging the god spells (https://oldschool.runescape.wiki/w/Mage_Arena): a god spell may only
 * be cast outside the Mage Arena once it has been cast 100 times inside the arena on a battle
 * mage - a splash counts. One persisted counter per god, `mage-arena:charge:<god>`, doubles as
 * the unlock flag (>= 100), so it survives logout. The gate rides `onSpellDisabled`, which
 * `Spell.canCast` consults before consuming runes (server/src/.../magic/Spell.ts), so a locked
 * spell is truly cancelled without core edits. `canCast` may be asked several times a tick, so
 * the refusal message is throttled.
 */

const CASTS_REQUIRED = 100;
const ARENA = Object.freeze({ minX: 3089, maxX: 3117, minY: 3921, maxY: 3946, z: 0 });
const DENY_MESSAGE_INTERVAL_MS = 1200;

/** Spell ids of the three god spells (core CombatSpells). */
const SARADOMIN_STRIKE = 1190;
const CLAWS_OF_GUTHIX = 1191;
const FLAMES_OF_ZAMORAK = 1192;
/** Battle mage NPC ids (core NpcIdentifiers BATTLE_MAGE/_2/_3). */
const BATTLE_MAGE_IDS = new Set([1610, 1611, 1612]);

const GODS = Object.freeze([
  Object.freeze({ name: "Saradomin Strike", spellId: SARADOMIN_STRIKE, counter: "mage-arena:charge:saradomin" }),
  Object.freeze({ name: "Claws of Guthix", spellId: CLAWS_OF_GUTHIX, counter: "mage-arena:charge:guthix" }),
  Object.freeze({ name: "Flames of Zamorak", spellId: FLAMES_OF_ZAMORAK, counter: "mage-arena:charge:zamorak" }),
]);
const GOD_BY_SPELL = new Map(GODS.map((god) => [god.spellId, god]));

const lastDeniedAt = new WeakMap();

function inArena(player) {
  const at = player?.getLocation?.();
  return at != null && at.getZ() === ARENA.z
    && at.getX() >= ARENA.minX && at.getX() <= ARENA.maxX
    && at.getY() >= ARENA.minY && at.getY() <= ARENA.maxY;
}

function chargeOf(player, god) {
  return Math.min(CASTS_REQUIRED, Math.max(0, Number(player.getAttribute(god.counter)) || 0));
}

function isUnlocked(player, god) {
  return chargeOf(player, god) >= CASTS_REQUIRED;
}

/** The spell the player just cast, wherever the combat state currently holds it. */
function spellOf(player) {
  const combat = player?.getCombat?.();
  return combat?.getSelectedSpell?.() ?? combat?.getPreviousCast?.() ?? null;
}

/** One resolved cast on a battle mage. Returns true when it counted. */
function awardCast(player, god) {
  const current = chargeOf(player, god);
  if (current >= CASTS_REQUIRED) return false;
  const next = current + 1;
  player.setAttribute(god.counter, next);
  if (next === CASTS_REQUIRED) {
    player.sendMessage(`You are now able to cast ${god.name} outside of the Mage Arena.`);
  }
  return true;
}

/** A spell hit resolved (it lands after this, splash or not); count it if it qualifies. */
function hitResolved({ attacker, target }) {
  if (attacker?.isPlayer?.() !== true || target?.isNpc?.() !== true) return;
  if (!BATTLE_MAGE_IDS.has(target.getId?.())) return;
  if (!inArena(attacker)) return;
  const god = GOD_BY_SPELL.get(spellOf(attacker)?.spellId?.());
  if (god) awardCast(attacker, god);
}

function sendLockedMessage(player, god) {
  const now = Date.now();
  if (now < (lastDeniedAt.get(player) ?? 0)) return;
  lastDeniedAt.set(player, now + DENY_MESSAGE_INTERVAL_MS);
  player.sendMessage(
    `You need to cast ${god.name} 100 times inside the Mage Arena before you can cast it outside.`
  );
}

/** Block a locked god spell outside the arena; the cast is cancelled by Spell.canCast. */
function spellDisabled(event) {
  const god = GOD_BY_SPELL.get(event.spellId);
  if (!god || !event.player) return;
  if (inArena(event.player) || isUnlocked(event.player, god)) return;
  event.disabled = true;
  sendLockedMessage(event.player, god);
}

module.exports = function registerSpells(api) {
  api.persistAttribute(GODS[0].counter);
  api.persistAttribute(GODS[1].counter);
  api.persistAttribute(GODS[2].counter);
  api.onSpellDisabled(spellDisabled);
  api.onCombatHitResolved(hitResolved);
};

Object.assign(module.exports, {
  _test: {
    ARENA,
    CASTS_REQUIRED,
    GODS,
    BATTLE_MAGE_IDS,
    inArena,
    chargeOf,
    isUnlocked,
    spellOf,
    awardCast,
    hitResolved,
    spellDisabled,
  },
});
