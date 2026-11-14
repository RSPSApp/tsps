/**
 * Necklace of faith (https://oldschool.runescape.wiki/w/Necklace_of_faith).
 *
 * When damage leaves the wearer alive below 20% of their maximum Hitpoints, the necklace
 * restores 25% of their Prayer level (rounded down) to their prayer points and crumbles - its
 * one use. A hit that takes the wearer from above 20% straight to 0 does nothing (Wiki). It runs
 * as the damage lands, so with Redemption active the Redemption check in HitQueue comes after it
 * and drains the restored points, as the Wiki describes.
 *
 * rsprox captures (rsprox.net recording 3167, rev 232, ticks 192-193): a self-inflicted hit
 * (locator orb) took the wearer from 29 to 19 of 99 Hitpoints; the same tick sent the message
 * below, emptied the worn amulet slot (slot 2) and set Prayer from 0 to 24 at Prayer level 99
 * (13,256,069 XP; 87 was the current level at login): floor(99 * 25%) = 24. No graphic or sound
 * of the necklace's own was sent.
 */
const NECKLACE_OF_FAITH = "Necklace of faith";
const ACTIVATION_PERCENT = 20;
const RESTORE_PERCENT = 25;
const MESSAGE = "Your necklace of faith restores some prayer, but is destroyed in the process.";

let Equipment = null;
let Skill = null;

function wornNecklace(player) {
  const necklace = player.getEquipment().get(Equipment.AMULET_SLOT);
  return necklace?.getDefinition?.()?.getName?.() === NECKLACE_OF_FAITH ? necklace : null;
}

/** Below 20% of the maximum and still alive (19 at 99 activates it, 20 does not). */
function isLowEnough(hitpoints, maxHitpoints) {
  return hitpoints > 0 && hitpoints * 100 < maxHitpoints * ACTIVATION_PERCENT;
}

function onDamageApplied({ target }) {
  if (!target?.isPlayer?.()) {
    return;
  }
  const player = target.getAsPlayer();
  const necklace = wornNecklace(player);
  const skills = player.getSkillManager();
  if (!necklace || !isLowEnough(skills.getCurrentLevel(Skill.HITPOINTS), skills.getMaxLevel(Skill.HITPOINTS))) {
    return;
  }
  player.getEquipment().deleteNumber(necklace.getId(), 1);
  player.getEquipment().refreshItems();
  const prayerLevel = skills.getMaxLevel(Skill.PRAYER);
  skills.increaseCurrentLevel(Skill.PRAYER, Math.floor((prayerLevel * RESTORE_PERCENT) / 100), prayerLevel);
  player.sendMessage(MESSAGE);
}

module.exports = {
  name: "NecklaceOfFaith",
  description: "Makes a worn Necklace of faith restore 25% of Prayer and crumble when a hit leaves the wearer below 20% Hitpoints.",
  members: true,
  _test: { onDamageApplied, isLowEnough },
  register(api) {
    Equipment = api.core.Equipment;
    Skill = api.core.Skill;
    api.onCustomEvent("combat:damage-applied", onDamageApplied);
  },
};
