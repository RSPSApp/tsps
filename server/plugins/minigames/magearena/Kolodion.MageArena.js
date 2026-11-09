"use strict";

/**
 * Kolodion in the Mage Arena bank, from his Wiki transcript (npc-dialogues.json, Transcript:Kolodion):
 * this unit only picks his variant and answers its conditions.
 *
 * - Talk-to plays "after-mage-arena-i" once the account has Mage Arena I behind it. tsps has no
 *   Kolodion duel, so the god cape from the statues stands in for it (Statues.MageArena.js);
 *   otherwise the record's default, "without-level-60-magic", plays. Transcript:Mage Arena I's
 *   "With 60 Magic or higher" section (the duel offer) isn't in the dump and the duel isn't built.
 * - "How am I doing so far?": one line per god spell from its inside-the-arena cast count
 *   (Spells.MageArena.js). The Kolodion page leaves three of each spell's four tiers as
 *   "(unknown) times", so those are answered by step id. The thresholds come from the same lines
 *   in Transcript:Mage Arena II ("starting-off"): less than 51, at least 51, at least 90, at least 100.
 * - "Are there any more challenges available?": all three spells at 100 casts and 75 Magic, not
 *   boostable (Wiki Mage_Arena_II requirements). Mage Arena II itself isn't in tsps yet, so the
 *   transcript's hand-over to it plays Kolodion's line and stops.
 */
const Spells = require("./Spells.MageArena");
const Statues = require("./Statues.MageArena");

const NAME = "Kolodion";
const AFTER_MAGE_ARENA_I = "after-mage-arena-i";
const MAGE_ARENA_II_MAGIC = 75;
const HALF_TRAINED = 51;
const ALMOST_TRAINED = 90;

const { GODS, CASTS_REQUIRED, chargeOf } = Spells;
const { CAPE_RECEIVED_ATTRIBUTE } = Statues;

/** Each god spell's four cast-count conditions, in transcript order, by step id. */
const TIERS = Object.freeze([
  { god: GODS[0], ids: ["En7Sp3", "9i2GtM", "rfd0bW", "7mx-IY"] },
  { god: GODS[1], ids: ["1kPYYa", "j0NMWW", "4HpHME", "qd0yuo"] },
  { god: GODS[2], ids: ["LZ_RfE", "qYkRUc", "f6UaHA", "Parmoj"] },
]);
const TIER_BY_STEP = new Map(TIERS.flatMap(({ god, ids }) => ids.map((id, tier) => [id, { god, tier }])));

const NOT_MASTERED = "If player hasn't mastered all the god spells yet:";
const BELOW_MAGIC = "If player doesn't have 75 Magic:";
const READY = "If player has mastered all the god spells and is 75 Magic:";

let api;

function isKolodion(event) {
  return event?.definition?.getName?.() === NAME;
}

/** 0: under 51 casts, 1: 51-89, 2: 90-99, 3: 100 (Transcript:Mage Arena II's thresholds). */
function tierOf(player, god) {
  const casts = chargeOf(player, god);
  if (casts >= CASTS_REQUIRED) return 3;
  if (casts >= ALMOST_TRAINED) return 2;
  if (casts >= HALF_TRAINED) return 1;
  return 0;
}

function mastered(player) {
  return GODS.every((god) => chargeOf(player, god) >= CASTS_REQUIRED);
}

function hasMagic(player) {
  return player.getSkillManager().getMaxLevel(api.core.Skill.MAGIC) >= MAGE_ARENA_II_MAGIC;
}

function pickVariant(event) {
  if (!isKolodion(event)) return null;
  return event.player?.getAttribute(CAPE_RECEIVED_ATTRIBUTE) === true ? AFTER_MAGE_ARENA_I : null;
}

function answerCondition(event) {
  if (!isKolodion(event)) return null;
  const { player, stepId, text } = event;
  const spell = TIER_BY_STEP.get(stepId);
  if (spell) return tierOf(player, spell.god) === spell.tier;
  if (text === NOT_MASTERED) return !mastered(player);
  if (text === BELOW_MAGIC) return !hasMagic(player);
  if (text === READY) return mastered(player) && hasMagic(player);
  return null;
}

module.exports = function registerKolodion(pluginApi) {
  api = pluginApi;
  api.onNpcDialogueVariant(pickVariant);
  api.onNpcDialogueCondition(answerCondition);
};

Object.assign(module.exports, {
  _test: {
    AFTER_MAGE_ARENA_I,
    TIERS,
    tierOf,
    mastered,
    pickVariant,
    answerCondition,
  },
});
