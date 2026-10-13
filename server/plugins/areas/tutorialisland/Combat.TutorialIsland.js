/**
 * The Combat Instructor's and Magic Instructor's tasks: the worn-equipment steps, the rat pen,
 * one melee and one ranged rat, and Wind Strike on a chicken. Also the island-wide rules: training
 * stops at level 3 and nothing on the island can kill you.
 */
const T = require("./Common.TutorialIsland");
const Interface = require("./Interface.TutorialIsland");

const { STEP, IDS } = T;
const COMBAT_INSTRUCTOR = IDS.COMBAT_INSTRUCTOR[0];
/** The worn equipment tab's "View equipment stats" button (wornitems:equipment). */
const EQUIPMENT_STATS_BUTTON = (387 << 16) | 1;
/** OSRS stops tutorial training at level 3. */
const TRAINING_LEVEL_CAP = 3;

let Items, Objects, core;

function instructorSays(player, text) {
  T.showBoxes(player, [{ npc: COMBAT_INSTRUCTOR, text }]);
}

function onEquipmentStats({ player }) {
  if (player && T.isActive(player)) T.advanceFrom(player, STEP.OPEN_EQUIPMENT_STATS, STEP.EQUIP_DAGGER);
  return false; // the equipment plugin opens the stats screen
}

/** Equipping the dagger, then the sword and shield, completes those steps. */
function onProcess({ player }) {
  if (!player || !T.isActive(player)) return;
  const current = T.progress(player);
  if (current >= STEP.OPEN_EQUIPMENT && current <= STEP.EQUIP_DAGGER && T.worn(player, Items.BRONZE_DAGGER)) {
    T.setProgress(player, STEP.DAGGER_EQUIPPED);
  } else if (current === STEP.EQUIP_SWORD_SHIELD && T.worn(player, Items.BRONZE_SWORD) && T.worn(player, Items.WOODEN_SHIELD)) {
    T.setProgress(player, STEP.OPEN_COMBAT);
  }
}

/** The rat pen gates: in when the instructor says so, and not again for the ranged rat. */
function onCageGate(event) {
  const player = event.player;
  if (!player || !T.isActive(player) || !T.inTutorial(event.location)) return;
  if (event.objectId !== Objects.GATE_94 && event.objectId !== Objects.GATE_95) return;
  // West of the gate is the pit: leaving is always allowed.
  const gateX = event.location?.getX?.() ?? event.location?.x;
  if (typeof gateX === "number" && player.getLocation().getX() < gateX) return;
  const current = T.progress(player);
  if (current < STEP.ENTER_RAT_PEN) {
    player.sendMessage("Oi! Get away from there. Only enter the rat cage when I say so.");
    event.handled = true;
  } else if (current >= STEP.RANGE_RAT && current < STEP.COMBAT_LADDER) {
    instructorSays(player, "No, don't enter the pit. Range the rats from outside the cage.");
    event.handled = true;
  }
  // Otherwise Paths walks the player through the gate (and on into the pen's step).
}

function onCanAttack(event) {
  const attacker = event.attacker;
  if (!attacker?.isPlayer?.() || !T.isActive(attacker)) return;
  const targetId = event.target?.getId?.();
  const current = T.progress(attacker);
  if (targetId === IDS.RAT) {
    const ranged = T.worn(attacker, Items.SHORTBOW);
    if (current < STEP.ATTACK_RAT) {
      event.allow = false;
      attacker.sendMessage("Oi! Get away from there. Only enter the rat cage when I say so.");
    } else if (current >= STEP.RAT_KILLED && current < STEP.COMBAT_LADDER && !ranged) {
      event.allow = false;
      T.showBoxes(attacker, [{ text: T.data.messages.ratAgain }]);
    } else {
      Interface.pointAtRat(attacker, event.target);
      T.advanceFrom(attacker, STEP.ATTACK_RAT, STEP.FIGHTING_RAT) || T.advanceFrom(attacker, STEP.RANGE_RAT, STEP.RANGING_RAT);
    }
  } else if (targetId === IDS.CHICKEN) {
    if (current < STEP.CAST_WIND_STRIKE) {
      event.allow = false;
      attacker.sendMessage("Cast the Wind Strike spell from your spellbook to fight the chicken.");
    } else if (current >= STEP.WIND_STRIKE_CAST) {
      event.allow = false;
      attacker.sendMessage("You've already done that. Perhaps you should move on.");
    }
  }
}

function onNpcDeath(event) {
  const killer = event.killer;
  if (!killer?.isPlayer?.() || !T.isActive(killer) || event.npcId !== IDS.RAT) return;
  const current = T.progress(killer);
  if (current === STEP.ATTACK_RAT || current === STEP.FIGHTING_RAT) T.setProgress(killer, STEP.RAT_KILLED);
  else if (current === STEP.RANGE_RAT || current === STEP.RANGING_RAT) T.setProgress(killer, STEP.COMBAT_LADDER);
}

/**
 * The magic task completes on the first Wind Strike at a chicken, hit or splash. A tick
 * later the step moves to LEAVE_TALK, the "Learning the Ropes" quest's completion value:
 * the quest plugin's step listener completes it there (scroll, message and jingle).
 */
function onCombatHitRoll({ attacker, target, combatType }) {
  if (!attacker?.isPlayer?.() || !T.isActive(attacker)) return;
  if (target?.getId?.() !== IDS.CHICKEN || combatType !== core.CombatType.MAGIC) return;
  if (!T.advanceFrom(attacker, STEP.CAST_WIND_STRIKE, STEP.WIND_STRIKE_CAST)) return;
  T.later(1, () => T.advanceFrom(attacker, STEP.WIND_STRIKE_CAST, STEP.LEAVE_TALK));
}

function capTraining(event) {
  const player = event.player;
  if (!player || !T.isActive(player)) return;
  if (player.getSkillManager().getCurrentLevel(event.skill) >= TRAINING_LEVEL_CAP) event.allow = false;
}

/** Nothing on Tutorial Island may kill the player: prevent the death and floor Hitpoints at 1. */
function keepAlive(event) {
  const player = event.player;
  if (!player || !T.isActive(player)) return;
  event.preventDeath = true;
  player.getSkillManager().setCurrentLevel(core.Skill.HITPOINTS, 1, true);
}

module.exports = function attach(api) {
  core = api.core;
  Items = core.ItemIdentifiers;
  Objects = core.ObjectIdentifiers;
  api.onInterfaceActionButton(EQUIPMENT_STATS_BUTTON, onEquipmentStats);
  api.onPlayerProcess(onProcess);
  api.onObjectInteraction(onCageGate);
  api.onCanAttack(onCanAttack);
  api.onNpcDeath(onNpcDeath);
  api.onCombatHitRoll(onCombatHitRoll);
  api.onCanGainExperience(capTraining);
  api.onPlayerBeforeDeath(keepAlive);
};
