/**
 * Phoenix necklace (https://oldschool.runescape.wiki/w/Phoenix_necklace).
 *
 * When damage leaves the wearer alive at 20% of their maximum Hitpoints or less, the necklace
 * heals 30% of their base Hitpoints level (rounded down: 29 at level 99) and is destroyed - its
 * one use. It also clears the attacks still on their way in (delayed spells and arrows, the
 * rest of a multi-hit special), and it fires before a ring of life or Redemption could (the
 * Wiki says the necklace activates first, and the Redemption prayer is then not used).
 *
 * It does nothing where food cannot be eaten (a duel with No Food, the Tombs of Amascut's On a
 * Diet invocation, answered by `onCanEat`) or in the Bounty Hunter arena (it answers
 * "phoenix-necklace:eligible"). The Wiki does not quote the activation message, so ours is
 * our own wording.
 */
const Equipment = require("../../src/main/typescript/elvarg/game/model/container/impl/Equipment").Equipment;
const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");

const PHOENIX_NECKLACE = "Phoenix necklace";
const ACTIVATION_PERCENT = 20;
const HEAL_PERCENT = 30;
const ELIGIBLE_EVENT = "phoenix-necklace:eligible";
const WILL_TRIGGER_EVENT = "phoenix-necklace:will-trigger";

let pluginApi = null;

function wornNecklace(player) {
  const necklace = player.getEquipment().get(Equipment.AMULET_SLOT);
  return necklace?.getDefinition?.()?.getName?.() === PHOENIX_NECKLACE ? necklace : null;
}

/** Whether `hitpoints` is low enough to trigger the necklace (20% of the maximum or below). */
function isLowEnough(hitpoints, maxHitpoints) {
  return hitpoints > 0 && hitpoints * 100 <= maxHitpoints * ACTIVATION_PERCENT;
}

/** Worn, not blocked by the area (Bounty Hunter), and food is allowed (duel rules, On a Diet). */
function isUsable(player, necklace) {
  const eligibility = { player, blocked: false };
  pluginApi.emitCustomEvent(ELIGIBLE_EVENT, eligibility);
  return !eligibility.blocked && pluginApi.emitCanEat(player, necklace.getId()) !== false;
}

function onDamageApplied({ target }) {
  if (!target?.isPlayer?.()) {
    return;
  }
  const player = target.getAsPlayer();
  const necklace = wornNecklace(player);
  const skills = player.getSkillManager();
  const max = skills.getMaxLevel(Skill.HITPOINTS);
  const hitpoints = skills.getCurrentLevel(Skill.HITPOINTS);
  if (!necklace || !isLowEnough(hitpoints, max) || !isUsable(player, necklace)) {
    return;
  }
  player.getEquipment().deleteNumber(necklace.getId(), 1);
  player.getEquipment().refreshItems();
  player.getCombat().getHitQueue().clearIncoming();
  skills.setCurrentLevels(Skill.HITPOINTS, hitpoints + Math.floor((max * HEAL_PERCENT) / 100));
  player.sendMessage("Your phoenix necklace heals you, but is destroyed in the process.");
}

/** The ring of life asks first: a necklace that is about to heal the wearer leaves the ring alone. */
function onWillTrigger(request) {
  const player = request.player;
  const necklace = wornNecklace(player);
  if (!necklace) {
    return;
  }
  const max = player.getSkillManager().getMaxLevel(Skill.HITPOINTS);
  if (isLowEnough(request.remaining, max) && isUsable(player, necklace)) {
    request.active = true;
  }
}

module.exports = {
  name: "PhoenixNecklace",
  members: true,
  _test: { onDamageApplied, onWillTrigger, isLowEnough },
  register(api) {
    pluginApi = api;
    api.onCustomEvent("combat:damage-applied", onDamageApplied);
    api.onCustomEvent(WILL_TRIGGER_EVENT, onWillTrigger);
  },
};
