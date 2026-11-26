/**
 * The H.A.M. Hideout's concussions and its jail. Wiki pages:
 * https://oldschool.runescape.wiki/w/H.A.M._Member#Getting_thrown_out and
 * https://oldschool.runescape.wiki/w/Door_(H.A.M._Hideout_Jail).
 *
 * Caught pickpocketing a H.A.M. Member in the hideout, the blow either concusses the player ("You feel slightly
 * concussed from the blow.") or their Agility lets them partially avoid it (chart 0/254 by Agility level). Each
 * concussion counts up varbit 235 `ham_thief`; the third beats them unconscious: "You're beaten unconscious and
 * bundled out of the HAM Camp." with the stun, the falling animation and a fade two ticks later, and four ticks
 * after that they wake ("You slowly wake up in an unknown place.") in the jail or outside. Climbing down the
 * trapdoor puts the count back to 0 (HamTrapdoor.Thieving.js), as does waking up.
 *
 * The jail door (5501) is "very secure": Open answers so, and its lock can only be picked from inside the cell.
 * Each Pick-lock attempt takes seven ticks; a failure numbs the fingers as the trapdoor's do (the Wiki's page says
 * so in the trapdoor's words), and the next try is
 * likelier (the Wiki's four charts, in four equal steps, kept in `ham_thief`). A new Pick-lock starts from the first
 * chart. On success the player is let through the door to the west, with no door swing.
 *
 * Ours: which of the jail or outside the player wakes in (three in four the jail, the recorded share; the Wiki gives
 * no odds), the outside tile (the one recorded), and Open and Pick-lock from outside the cell answering as Open
 * does inside. Not done: H.A.M. robes making the boot less likely (the Wiki's "about 4%" a piece doesn't say of
 * what).
 */
const { fumbled } = require("./HamTrapdoor.Thieving");

let core;

const HAM_MEMBERS = new Set(["H_A_M_MEMBER", "H_A_M_MEMBER_2"]);
/** The hideout's floor, where its members' blows concuss. */
const HIDEOUT = Object.freeze({ minX: 3140, maxX: 3190, minY: 9600, maxY: 9660, z: 0 });
const HAM_THIEF_VARBIT = 235; // ham_thief: concussions, then the jail lock's tries
const CONCUSSIONS = 3;
const AVOID_CHART = Object.freeze([0, 254]);

const JAIL_DOOR = "DOOR_148"; // favour_prisondoor, 5501
const JAIL_DOOR_TILE = Object.freeze([3183, 9611, 0]);
/** The door is on its tile's west edge: the cell is that tile and east of it. */
const CELL_MIN_X = 3183;
const JAIL = Object.freeze([3185, 9609, 0]);
const OUTSIDE = Object.freeze([3186, 3211, 0]);
const JAIL_SHARE = 0.75;

const MESSAGE = Object.freeze({
  CONCUSSED: "You feel slightly concussed from the blow.",
  AVOIDED: "Your agility helps you partially avoid the blow.",
  BUNDLED: "You're beaten unconscious and bundled out of the HAM Camp.",
  WAKE: "You slowly wake up in an unknown place.",
  SECURE: "This door seems very secure.",
  ATTEMPT: "You attempt to pick the lock on the door.",
  PICKED: "You pick the lock on the prison door.",
});

/** After the bundling line: the fall and fade out, the move, then the wake-up. */
const FALL_TICKS = 2;
const MOVE_TICKS = 6;
const WAKE_TICKS = 7;
const FADE_OVERLAY_UID = (164 << 16) | 1; // toplevel_pre_eoc:overlay_atmosphere
const FADE_OVERLAY = 174;
const FADE_SCRIPT = 948;
const FADE_CYCLES = 50;

/** The jail lock: [low, high] for the 1st to 4th try, without and with a lockpick. */
const LOCK_CHARTS = Object.freeze({
  bare: Object.freeze([[10, 252], [30, 273], [50, 294], [70, 315]]),
  lockpick: Object.freeze([[60, 300], [80, 320], [100, 340], [120, 360]]),
});
const ATTEMPT_TICKS = 7;
const PICK_ANIMATION = "human_lockedchest";
const FALL_ANIMATION = "human_death_backwards";
const WALK_ANIMATION = "human_walk_f";
/** ForceMovement's facing for a step west (Doors' gates: 1 east, 3 west). */
const WEST = 3;
const PICK_SOUND = 2402;
const FAILURE_SOUND = 2581;
const UNLOCK_SOUNDS = Object.freeze([52, 71]);
const SUCCESS_XP = 3.8;

/** Players picking the jail lock, and each one's task. */
const picking = new WeakMap();
/** The unit's rolls; tests replace it. */
let random = Math.random;

/** The Wiki's success chart: the level-scaled roll, rounded, plus one, out of 256. */
function chartChance(level, [low, high]) {
  const value = Math.floor(low * (99 - level) / 98 + high * (level - 1) / 98 + 0.5);
  return Math.max(0, Math.min(1, (value + 1) / 256));
}

function spam(player, text) {
  player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, text);
}

function sound(player, id) {
  player.getPacketSender().sendSound(id, 1, 0);
}

function animate(player, name) {
  player.performAnimation(new core.Animation(name === null ? -1 : core.CacheDefinitions.getSeqId(name)));
}

function inHideout(location) {
  const x = location.getX();
  const y = location.getY();
  return location.getZ() === HIDEOUT.z && x >= HIDEOUT.minX && x <= HIDEOUT.maxX && y >= HIDEOUT.minY && y <= HIDEOUT.maxY;
}

const isHamMember = (npc) => [...HAM_MEMBERS].some((name) => core.NpcIdentifiers[name] === npc?.getId?.());

const thief = (player) => player.getPacketSender().getVarbit(HAM_THIEF_VARBIT);
const setThief = (player, value) => {
  if (thief(player) !== value) player.getPacketSender().sendVarbit(HAM_THIEF_VARBIT, value);
};

/** One tick-counted sequence for a player; it stops when they leave the game or die. */
function later(player, steps) {
  const last = Math.max(...steps.keys());
  core.TaskManager.submit(new (class extends core.Task {
    constructor() { super(1, player, false); this.ticksRun = 0; }
    execute() {
      this.ticksRun++;
      if (!player.isRegistered() || player.getHitpoints() <= 0) return this.stop();
      steps.get(this.ticksRun)?.();
      if (this.ticksRun >= last) this.stop();
    }
  })());
}

function fade(player, out) {
  const args = out ? [0, 255, 0, 0, FADE_CYCLES] : [0, 0, 0, 255, FADE_CYCLES];
  player.getPacketSender().sendSubInterface(FADE_OVERLAY_UID, FADE_OVERLAY, 1, { postScripts: [{ scriptId: FADE_SCRIPT, args }] });
}

/** The third concussion: bundled out a tick after the blow, with the stun's line. */
function bundleOut(player) {
  const start = player.getLocation().clone();
  const landing = random() < JAIL_SHARE ? JAIL : OUTSIDE;
  const movement = player.getMovementQueue();
  const steps = new Map([
    [1, () => { spam(player, MESSAGE.BUNDLED); movement.setBlockMovement(true).reset(); }],
    [1 + FALL_TICKS, () => { animate(player, FALL_ANIMATION); fade(player, true); }],
    [1 + MOVE_TICKS, () => {
      if (player.getLocation().equals(start)) player.moveTo(new core.Location(...landing));
    }],
    [1 + WAKE_TICKS, () => {
      movement.setBlockMovement(false);
      setThief(player, 0);
      fade(player, false);
      player.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(new core.StatementDialogue(0, MESSAGE.WAKE)));
    }],
    [3 + WAKE_TICKS, () => player.getPacketSender().closeSubInterface(FADE_OVERLAY_UID)],
  ]);
  later(player, steps);
}

/** `thieving:struck`: a H.A.M. Member's blow in the hideout concusses, or Agility partly avoids it. */
function struck({ player, npc }) {
  if (!isHamMember(npc) || !inHideout(player.getLocation())) return;
  const agility = player.getSkillManager().getCurrentLevel(core.Skill.AGILITY);
  if (random() < chartChance(agility, AVOID_CHART)) {
    spam(player, MESSAGE.AVOIDED);
    return;
  }
  const concussions = Math.min(CONCUSSIONS, thief(player) + 1);
  setThief(player, concussions);
  spam(player, MESSAGE.CONCUSSED);
  if (concussions >= CONCUSSIONS) bundleOut(player);
}

function isJailDoor(object) {
  const at = object?.getLocation?.();
  return object?.getId?.() === core.ObjectIdentifiers[JAIL_DOOR] && at?.getX() === JAIL_DOOR_TILE[0] &&
    at.getY() === JAIL_DOOR_TILE[1] && at.getZ() === JAIL_DOOR_TILE[2];
}

const inCell = (player) => player.getLocation().getX() >= CELL_MIN_X;

/** `door:toggle`: the jail door never opens; Open says how secure it is. */
function openJailDoor(event) {
  if (event.handled || !isJailDoor(event.object)) return;
  if (event.definition?.getInteractions?.()?.[event.clickType - 1]?.toLowerCase() !== "open") return;
  event.handled = true;
  event.player.setPositionToFace(event.object.getLocation());
  event.player.sendMessage(MESSAGE.SECURE);
}

function hasLockpick(player) {
  const inventory = player.getInventory();
  return inventory.contains(core.ItemIdentifiers.LOCKPICK) || inventory.contains(core.ItemIdentifiers.HAIR_CLIP);
}

/** Through the door on success: one walked step west out of the cell, across the door's wall, as it unlocks. */
function letOut(player) {
  setThief(player, 0);
  for (const id of UNLOCK_SOUNDS) sound(player, id);
  player.getSkillManager().addExperiences(core.Skill.THIEVING, SUCCESS_XP);
  const from = player.getLocation().clone();
  core.TaskManager.submit(new core.ForceMovementTask(player, 1, new core.ForceMovement(from, new core.Location(-1, 0, 0), 0, 30,
    WEST, core.CacheDefinitions.getSeqId(WALK_ANIMATION))));
}

/** Pick-lock: from inside the cell, seven-tick tries until the lock gives or the player stops. */
function pickJailLock({ player, object }) {
  if (!isJailDoor(object)) return false;
  player.setPositionToFace(object.getLocation());
  if (!inCell(player)) {
    player.sendMessage(MESSAGE.SECURE);
    return true;
  }
  picking.get(player)?.stop();
  setThief(player, 0);
  const origin = player.getLocation().clone();
  const begin = () => {
    animate(player, PICK_ANIMATION);
    sound(player, PICK_SOUND);
  };
  const task = new (class extends core.Task {
    constructor() { super(1, player, false); this.elapsed = 0; }
    execute() {
      if (!player.isRegistered() || player.getHitpoints() <= 0 || !player.getLocation().equals(origin) ||
          player.getMovementQueue().isMovementBlocked()) return this.stop();
      if (++this.elapsed === 1 && this.retried) begin();
      if (this.elapsed < ATTEMPT_TICKS) return;
      const level = player.getSkillManager().getCurrentLevel(core.Skill.THIEVING);
      const charts = hasLockpick(player) ? LOCK_CHARTS.lockpick : LOCK_CHARTS.bare;
      spam(player, MESSAGE.ATTEMPT);
      if (random() < chartChance(level, charts[Math.min(thief(player), charts.length - 1)])) {
        sound(player, PICK_SOUND);
        spam(player, MESSAGE.PICKED);
        animate(player, null);
        this.stop();
        later(player, new Map([[1, () => letOut(player)]]));
        return;
      }
      sound(player, FAILURE_SOUND);
      setThief(player, Math.min(charts.length - 1, thief(player) + 1));
      fumbled(player);
      this.elapsed = 0;
      this.retried = true;
    }
    stop() {
      if (picking.get(player) === this) picking.delete(player);
      super.stop();
    }
  })();
  picking.set(player, task);
  spam(player, MESSAGE.ATTEMPT);
  begin();
  core.TaskManager.submit(task);
  return true;
}

function cancel({ player }) {
  picking.get(player)?.stop();
}

module.exports = function attach(pluginApi) {
  core = pluginApi.core;
  pluginApi.onCustomEvent("thieving:struck", struck);
  pluginApi.onCustomEvent("door:toggle", openJailDoor);
  pluginApi.onObjectInteraction("Door", { "Pick-lock": pickJailLock });
  pluginApi.onCustomEvent("player:world-input", cancel);
};
module.exports._test = {
  chartChance, struck, pickJailLock, openJailDoor, LOCK_CHARTS, MESSAGE, JAIL, OUTSIDE,
  setRandom(fn) { random = fn ?? Math.random; },
};
