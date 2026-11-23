"use strict";

/**
 * Shadow spiders (Wiki: Shadow spider): "If a player initiates combat, it will drain the player's
 * Prayer points by half of the current amount, rounded up." "Wearing a spectral spirit shield
 * reduces the Prayer drain by half." "They can never take away a player's last prayer point."
 * Since 30 November 2022 they "no longer drain a player's prayer if they are not in combat with
 * the player", so only the spider's own target is drained.
 *
 * As recorded (rsprox local recordings 1001903 rev 242 ticks 1990/2035/2197 and 1001457 rev 241
 * ticks 1452/1464/1500/2127, Waterfall Dungeon): the drain comes with a spider's first attack on
 * the player, on the swing's tick, with the game message "The spider drains your prayer..." and
 * synth prayer_drain (2672). Its later swings at the same player don't drain (1001903: four more
 * swings over 21 ticks from tick 2197); a spider that lost the player and came back drains again
 * (1001457 tick 1500, after it left the player's view at 1477).
 *
 * Recorded difference: every recorded drain left ceil(prayer / 2) (21 to 11, 13 to 7, 7 to 4), a
 * drain of half rounded down; this follows the Wiki's "half of the current amount, rounded up".
 *
 * Ours: "at regular intervals" in a long fight has no interval on the Wiki or in the recordings,
 * so only the first attack of each engagement drains. With nothing to drain (prayer at 1 or 0, or
 * a spectral shield rounding it to 0) no message or sound is sent; no recording shows that case.
 */
const DRAIN_MESSAGE = "The spider drains your prayer...";
/** synth prayer_drain */
const DRAIN_SOUND = 2672;

let core = null;
let ShadowSpiderCombat = null;

/** npc -> the target it has drained this engagement; cleared when its combat ends. */
const engaged = new WeakMap();

/** Wiki: half of the current prayer, rounded up, but never the last point. */
function prayerDrain(prayer) {
  if (prayer <= 1) return 0;
  return Math.min(Math.ceil(prayer / 2), prayer - 1);
}

/** The engagement's first swing at a player drains them (once per engagement). */
function drainOnEngage(npc, target) {
  if (engaged.get(npc) === target) return;
  engaged.set(npc, target);
  if (!target?.isPlayer?.()) return;
  const player = target.getAsPlayer();
  const { Skill, Sounds, Sound, applyPrayerDrainModifiers } = core;
  const skills = player.getSkillManager();
  const base = prayerDrain(skills.getCurrentLevel(Skill.PRAYER));
  const drain = base > 0 ? applyPrayerDrainModifiers(player, base, { attacker: npc }) : 0;
  if (drain <= 0) return;
  skills.decreaseCurrentLevel(Skill.PRAYER, drain, 1);
  player.getPacketSender().sendMessage(DRAIN_MESSAGE);
  Sounds.sendSound(player, new Sound(DRAIN_SOUND, 1, 0, 0));
}

/** An engagement ends with the spider's combat (it dropped or lost the target, or died). */
function endEngagement(npc) {
  engaged.delete(npc);
}

function methodClass() {
  if (ShadowSpiderCombat) return ShadowSpiderCombat;
  ShadowSpiderCombat = class ShadowSpiderCombat extends core.MeleeCombatMethod {
    start(npc, target) {
      super.start(npc, target);
      drainOnEngage(npc, target);
    }

    onCombatEnded(npc, target) {
      super.onCombatEnded?.(npc, target);
      endEngagement(npc);
    }
  };
  return ShadowSpiderCombat;
}

function attach(api) {
  core = api.core;
  api.registerNpcCombatMethodProvider([core.NpcIdentifiers.SHADOW_SPIDER], methodClass());
}

module.exports = {
  name: "ShadowSpiders",
  description: "Shadow spiders drain half the player's Prayer (rounded up, never the last point) with their first attack of a fight, halved by a spectral spirit shield.",
  members: true,
  register: attach,
  _test: { prayerDrain, drainOnEngage, endEngagement, engaged, methodClass, DRAIN_MESSAGE, DRAIN_SOUND },
};
