"use strict";

/**
 * Forthos Dungeon's grubby gate (issue #3977).
 *
 * `Grubby Door` 34840 carries one action, Pick-lock, and nothing implemented it, so every click
 * fell through to nothing. Wiki: Grubby Door — "a locked door that requires 57 Thieving to
 * unlock, rewarding 10 Thieving experience", and "once unlocked, the player can access the Grubby
 * Chest" behind it.
 *
 * The gate is not walked through once it is unlocked: the cache's own open leaf (34841) still
 * clips the tile, and despawning the shut leaf does not free the map's collision either, so the
 * unlock hands the player across the gateway instead — one tile inside from the east side, and
 * one tile back out when it is used from within.
 *
 * The chest behind it (multiloc 34901, varbit hosdun_chest_status) is a key chest: see
 * plugins/objects/keychests (the "grubby" entry in key-chests.json).
 *
 * The pick animation is the one Pyramid Plunder's tomb doors already use for their own Pick-lock
 * (Passages.PyramidPlunder.js, `human_pickuptable`); no capture of this door exists.
 */

const DOOR = 34840;
const THIEVING_REQUIRED = 57;
const LOCK_EXPERIENCE = 10;
const PICK_ANIMATION = "human_pickuptable";

let core = null;

/** Pick-lock: 57 Thieving, 10 XP, and the player is handed across the gateway. */
function pickLock({ player, object }) {
  if (player.getSkillManager().getCurrentLevel(core.Skill.THIEVING) < THIEVING_REQUIRED) {
    player.sendMessage(
      `You need a Thieving level of at least ${THIEVING_REQUIRED} to pick this lock.`,
    );
    return true;
  }
  const sequence = core.CacheDefinitions.getSeqId(PICK_ANIMATION);
  if (sequence != null) player.performAnimation(new core.Animation(sequence));
  const at = object?.getLocation?.().clone() ?? player.getLocation().clone();
  const west = player.getLocation().getX() < at.getX();
  player.moveTo(new core.Location(west ? at.getX() + 1 : at.getX() - 1, at.getY(), at.getZ()));
  core.Sounds.sendSound(player, core.Sound.DOOR_OPEN);
  player.getSkillManager().addExperiences(core.Skill.THIEVING, LOCK_EXPERIENCE);
  player.sendMessage("You pick the lock on the gate.");
  return true;
}

module.exports = {
  name: "ForthosDungeon",
  description: "Forthos Dungeon's grubby gate: 57 Thieving unlocks it and hands the player across.",
  members: true,
  _test: { pickLock, DOOR, THIEVING_REQUIRED, LOCK_EXPERIENCE, PICK_ANIMATION },
  register(pluginApi) {
    core = pluginApi.core;
    pluginApi.onObjectInteraction("Grubby Door", { "Pick-lock": pickLock });
  },
};
