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
const PHOENIX_NECKLACE = "Phoenix necklace";
const ACTIVATION_PERCENT = 20;
const HEAL_PERCENT = 30;
const ELIGIBLE_EVENT = "phoenix-necklace:eligible";
const WILL_TRIGGER_EVENT = "phoenix-necklace:will-trigger";

let pluginApi = null;
let Equipment = null;
let Skill = null;

function wornNecklace(player) {
  const necklace = player.getEquipment().get(Equipment.AMULET_SLOT);
  return necklace?.getDefinition?.()?.getName?.() === PHOENIX_NECKLACE ? necklace : null;
}

/** Whether `hitpoints` is low enough to trigger the necklace (20% of the maximum or below). */
function isLowEnough(hitpoints, maxHitpoints) {
  return hitpoints > 0 && hitpoints * 100 <= maxHitpoints * ACTIVATION_PERCENT;
}

/**
 * Not blocked by the area or the rules (Bounty Hunter, No Food duels, On a Diet, Last Stand). A
 * side-effect-free question: asking never eats, tallies food or sends a refusal message.
 */
function isUsable(player) {
  const eligibility = { player, blocked: false };
  pluginApi.emitCustomEvent(ELIGIBLE_EVENT, eligibility);
  return !eligibility.blocked;
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
  if (!necklace || !isLowEnough(hitpoints, max) || !isUsable(player)) {
    return;
  }
  // The one real "eat": the Tombs of Amascut count the necklace as food, once per activation.
  if (pluginApi.emitCanEat(player, necklace.getId()) === false) {
    return;
  }
  player.getEquipment().deleteNumber(necklace.getId(), 1);
  player.getEquipment().refreshItems();
  player.getCombat().getHitQueue().clearIncoming();
  player.heal(Math.floor((max * HEAL_PERCENT) / 100));
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
  if (isLowEnough(request.remaining, max) && isUsable(player)) {
    request.active = true;
  }
}

module.exports = {
  name: "PhoenixNecklace",
  members: true,
  _test: { onDamageApplied, onWillTrigger, isLowEnough },
  register(api) {
    pluginApi = api;
    Equipment = api.core.Equipment;
    Skill = api.core.Skill;
    api.onCustomEvent("combat:damage-applied", onDamageApplied);
    api.onCustomEvent(WILL_TRIGGER_EVENT, onWillTrigger);
  },
};
