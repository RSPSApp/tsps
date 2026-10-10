"use strict";

/**
 * The Gnome Ball pitch at the Tree Gnome Stronghold
 * (https://oldschool.runescape.wiki/w/Gnome_Ball).
 *
 * Sessions live here; Referee.GnomeBall.js hands the ball over through `beginGame`.
 * The Wiki's three mechanics:
 * - Shoot: d = min(distance to the goal, 11); low = 48 - 2d, high = 278 - 3d;
 *   P = (low + (high - low) * (Ranged - 1) / 98) / 256, capped at 1. A goal scores a point
 *   and gives 4/5/6/7 XP in Ranged and Agility on goals 1-4 and 30 XP on goal 5 (that 30
 *   carries the 25-XP win bonus; 52 XP per skill per won game). The fifth goal resets the
 *   score. Hit or miss, the ball is lost and a new one must be asked from the referee.
 * - Tackle: a successful player tackle knocks a baller out for a few seconds;
 *   P = lerp(31/256, 201/256, (Agility - 1) / 98), or 221/256 against a baller holding the
 *   ball (this implementation does not track a baller in possession, so it uses 201/256).
 *   A baller that tackles the carrier deals damage (the Wiki says 1-2; the capture shows 1)
 *   and takes the ball. The Wiki does not document the baller's roll, so the chosen default
 *   is a low one per check: 12% at level 1 falling to 2% at 99, better agility dodging more
 *   tackles. Checks run every 3
 *   ticks against an adjacent baller, never on the tick(s) after a Shoot click, so a shot
 *   cannot be pre-empted by the tackle that the shot itself triggered. UNDOCUMENTED: the
 *   ball goes back to the referee (ask for a new one) rather than being carried by the baller.
 * - Pass: passing to the gnome wingers is not implemented (needs their pass-back timing).
 *
 * Dropping a gnome ball never puts one on the floor: it "magically returns to the ref".
 *
 * From rsprox captures (rev 234, the one recorded game):
 * - Through the gate, the weapon and shield go to the inventory and the Gnome Ball HUD (139)
 *   opens in the overlay slot; it closes on leaving the pitch.
 * - Shoot says "You throw the ball at the goal..." on the click; the next tick the player
 *   throws (783, area sound 1576) and the ball flies at the goal (projectile 55, 5 client
 *   cycles a tile); three ticks after that comes "... and miss.". A scored goal was not
 *   recorded, so its "You score a goal!" is ours. With no ball: "You need a ball in your hand
 *   to throw."
 * - Tackle: 778 and sound 1571 with the baller going down (203) on a hit, 780 and 1572 with
 *   the baller dodging (204) on a miss; no message. A baller already down answers "That gnome
 *   is being tackled.". A baller tackling the carrier plays 210, the player falls (779,
 *   sounds 1574 and 518) and takes 1 damage.
 */

const BALLER_NAME = "Gnome baller";
const GOAL_NAME = "Gnome goal";
const GNOMEBALL = 751; // ItemIdentifiers.GNOMEBALL
const PITCH = { minX: 2383, maxX: 2408, minY: 3481, maxY: 3496, plane: 0 };
const MAX_SHOT_DISTANCE = 11;
const GOALS_PER_GAME = 5;
/** Goals 1-5: the Wiki's 4/5/6/7 and the 30 that carries the win bonus. */
const GOAL_XP = [4, 5, 6, 7, 30];
const TACKLE_MIN = 31 / 256;
const TACKLE_MAX = 201 / 256;
const TACKLE_HOLDING_MAX = 221 / 256;
/** Baller -> carrier (Wiki undocumented): 12% per check at Agility 1 down to 2% at 99. */
const BALLER_TACKLE_AT_1 = 0.12;
const BALLER_TACKLE_AT_99 = 0.02;
const TACKLE_KNOCKOUT_TICKS = 5; // "knocking them out for a few seconds"
const BALLER_TACKLE_CHECK_TICKS = 3;
const BALLER_TACKLE_RANGE = 1;
const BALLER_HIT_STUN_TICKS = 3;
/** The baller's damage on the carrier, as captured (the Wiki says 1-2). */
const BALLER_TACKLE_DAMAGE = 1;
/** A Shoot click pauses baller checks for this many ticks so the shot resolves first. */
const SHOT_GRACE_TICKS = 3;
/** gnome_human_tackle, gnome_tackled and gnome_dodge_tackle on the ballers (captured). */
const BALLER_TACKLE_ANIMATION = 210;
const BALLER_DOWN_ANIMATION = 203;
const BALLER_DODGE_ANIMATION = 204;
const PLAYER = Object.freeze({
  TACKLE: 778, TACKLE_FAIL: 780, TACKLED: 779, THROW: 783,
});
const SOUND = Object.freeze({
  TACKLE: 1571, TACKLE_FAIL: 1572, TACKLED: 1574, TACKLED_THUD: 518, THROW: 1576,
});
const BALL_PROJECTILE = 55;
/** The Gnome Ball HUD, in the toplevel's overlay slot (as Corp's). */
const HUD_INTERFACE = 139;
const OVERLAY_HUD_UID = (161 << 16) | 8;
const DIARY = Object.freeze({ diary: "western", task: "score-a-goal-in-a-gnomeball-match" });
/** The player had no room for a ball the referee owed them; give it on login. */
const OWED_BALL_ATTRIBUTE = "gnomeball:owed-ball";
const BALL_RETURNS_MESSAGE = "The ball magically returns to the ref as you put it down.";
const NO_BALL_MESSAGE = "You need a ball in your hand to throw.";
const THROW_MESSAGE = "You throw the ball at the goal...";
const MISS_MESSAGE = "... and miss.";
const BEING_TACKLED_MESSAGE = "That gnome is being tackled.";

let api;
let core;
let random = Math.random;

/** player -> { goals, won, ownBall, ticks } */
const sessions = new Map();

const tile = (x, y, z) => new core.Location(x, y, z);

function isCarrying(player) {
  return player.getEquipment().getSlot(core.Equipment.WEAPON_SLOT) === GNOMEBALL;
}

function isPlaying(player) {
  return sessions.has(player);
}

/** Wiki: P = (low + (high - low) * (Ranged - 1) / 98) / 256, capped at 1. */
function shotChance(distance, rangedLevel) {
  const d = Math.min(distance, MAX_SHOT_DISTANCE);
  const low = 48 - 2 * d;
  const high = 278 - 3 * d;
  return Math.min(1, (low + (high - low) * (rangedLevel - 1) / 98) / 256);
}

/** Wiki: lerp(31/256, 201/256, (Agility - 1) / 98); 221/256 while the baller holds the ball. */
function tackleChance(agilityLevel, ballerHasBall = false) {
  const top = ballerHasBall ? TACKLE_HOLDING_MAX : TACKLE_MAX;
  const t = Math.max(0, Math.min(1, (agilityLevel - 1) / 98));
  return TACKLE_MIN + (top - TACKLE_MIN) * t;
}

/** Baller -> carrier. The Wiki documents no formula; chosen default: 12% -> 2% with Agility. */
function ballerTackleChance(agilityLevel) {
  const t = Math.max(0, Math.min(1, (agilityLevel - 1) / 98));
  return BALLER_TACKLE_AT_1 + (BALLER_TACKLE_AT_99 - BALLER_TACKLE_AT_1) * t;
}

function sessionFor(player) {
  let session = sessions.get(player);
  if (!session) {
    session = { goals: 0, won: false, ownBall: false, ticks: 0, shotGrace: 0 };
    sessions.set(player, session);
  }
  return session;
}

function flagAppearance(player) {
  player.getUpdateFlag().flag(core.Flag.APPEARANCE);
}

/** Wiki: weapons are automatically unequipped; the capture moves the shield too. */
function unequipWeapon(player) {
  const equipment = player.getEquipment();
  for (const slot of [core.Equipment.WEAPON_SLOT, core.Equipment.SHIELD_SLOT]) {
    const item = equipment.getItems()[slot];
    if (!item || item.getId() <= 0 || item.getId() === GNOMEBALL) continue;
    if (player.getInventory().getFreeSlots() <= 0) {
      player.sendMessage("You need a free inventory slot to unequip your weapon.");
      return false;
    }
    equipment.setItem(slot, new core.Item(-1, 0));
    player.getInventory().addItem(item);
  }
  equipment.refreshItems();
  flagAppearance(player);
  return true;
}

function equipBall(player) {
  player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(GNOMEBALL, 1));
  player.getEquipment().refreshItems();
  flagAppearance(player);
}

function clearCarriedBall(player) {
  const equipment = player.getEquipment();
  if (equipment.getSlot(core.Equipment.WEAPON_SLOT) !== GNOMEBALL) return;
  equipment.setItem(core.Equipment.WEAPON_SLOT, new core.Item(-1, 0));
  equipment.refreshItems();
  flagAppearance(player);
}

/** The referee hands over a ball; a ball the player brought is kept until they leave. */
function beginGame(player) {
  if (isCarrying(player)) {
    player.sendMessage("You already have a ball in play.");
    return false;
  }
  const session = sessionFor(player);
  if (!unequipWeapon(player)) return false;
  if (player.getInventory().getAmount(GNOMEBALL) > 0) {
    player.getInventory().deleteNumber(GNOMEBALL, 1);
    session.ownBall = true;
  }
  equipBall(player);
  return true;
}

/** Puts a gnomeball in the inventory, or owes it if there is no room (never lose it). */
function giveBall(player) {
  if (player.getInventory().getFreeSlots() > 0) {
    player.getInventory().addItem(new core.Item(GNOMEBALL, 1));
    return true;
  }
  player.setAttribute(OWED_BALL_ATTRIBUTE, true);
  player.sendMessage("You don't have room for a gnome ball; the referee keeps it for you.");
  return false;
}

/** Ends the session: the carried ball goes back to the referee. */
function endSession(player, { reward = false } = {}) {
  const session = sessions.get(player);
  if (!session) return;
  sessions.delete(player);
  clearCarriedBall(player);
  if (session.ownBall) giveBall(player);
  else if (reward && session.won) giveBall(player);
}

/** A Shoot click on the goal buys the shot a few ticks before ballers may tackle. */
function routeShot(event) {
  const session = sessions.get(event.player);
  if (!session || !isCarrying(event.player)) return;
  if (event.definition?.getName?.() !== GOAL_NAME) return;
  const option = event.definition.getInteractions?.()?.[event.clickType - 1];
  if (option && option !== "Shoot") return;
  session.shotGrace = SHOT_GRACE_TICKS;
}

/** Runs `action` after `ticks` game ticks. */
function later(ticks, action) {
  const { Task } = core;
  api.getTaskManager().submit(new (class extends Task {
    constructor() {
      super(ticks);
    }
    execute() {
      this.stop();
      action();
    }
  })());
}

/** The throw a tick after the click: animation, sound, and the ball flying at the goal. */
function throwBall(player, goal) {
  const from = player.getLocation();
  const flight = 41 + 5 * Math.max(1, from.getDistance(goal));
  player.performAnimation(new core.Animation(PLAYER.THROW));
  player.getPacketSender()
    .sendAreaSound(SOUND.THROW, from.getX(), from.getY(), from.getZ(), 1, 10, 5)
    .sendProjectile(from, goal, 0, flight, BALL_PROJECTILE, 163, 10, null, 41, 15, 11);
}

function shootGoal(event) {
  const { player } = event;
  const session = sessions.get(player);
  if (!session || !isCarrying(player)) {
    player.sendMessage(NO_BALL_MESSAGE);
    return true;
  }
  // The clicked shot wins over the ballers: no stun may swallow the throw.
  player.getTimers().cancel(core.TimerKey.STUN);
  const goal = tile(event.location.x, event.location.y, event.location.z);
  const distance = player.getLocation().getDistance(goal);
  const ranged = player.getSkillManager().getCurrentLevel(core.Skill.RANGED);
  const scored = random() < shotChance(distance, ranged);
  clearCarriedBall(player);
  player.sendMessage(THROW_MESSAGE);
  later(1, () => throwBall(player, goal));
  later(4, () => (scored ? scoreGoal(player, session) : player.sendMessage(MISS_MESSAGE)));
  return true;
}

function scoreGoal(player, session) {
  session.goals += 1;
  const xp = GOAL_XP[session.goals - 1];
  player.getSkillManager().addExperiences(core.Skill.RANGED, xp);
  player.getSkillManager().addExperiences(core.Skill.AGILITY, xp);
  api.emitCustomEvent("diary:task", { player, ...DIARY });
  if (session.goals >= GOALS_PER_GAME) {
    session.goals = 0;
    session.won = true;
    player.sendMessage("You win the game!");
  } else {
    player.sendMessage("You score a goal!");
  }
  return true;
}

/** Tackle on a baller: knocks them out for a few seconds; no XP or score. */
function tackleBaller(event) {
  const { player, npc } = event;
  if (!npc) return true;
  if (npc.getTimers().has(core.TimerKey.STUN)) {
    player.sendMessage(BEING_TACKLED_MESSAGE);
    return true;
  }
  player.setPositionToFace(npc.getLocation());
  npc.setPositionToFace(player.getLocation());
  const agility = player.getSkillManager().getCurrentLevel(core.Skill.AGILITY);
  if (random() < tackleChance(agility)) {
    player.performAnimation(new core.Animation(PLAYER.TACKLE, 33));
    player.getPacketSender().sendSoundEffect(SOUND.TACKLE, 1, 0);
    npc.performAnimation(new core.Animation(BALLER_DOWN_ANIMATION, 30));
    npc.getTimers().registers(core.TimerKey.STUN, TACKLE_KNOCKOUT_TICKS);
  } else {
    player.performAnimation(new core.Animation(PLAYER.TACKLE_FAIL, 33));
    player.getPacketSender().sendSoundEffect(SOUND.TACKLE_FAIL, 1, 0);
    npc.performAnimation(new core.Animation(BALLER_DODGE_ANIMATION, 33));
  }
  return true;
}

function ballerTackle(player, ballers) {
  const agility = player.getSkillManager().getCurrentLevel(core.Skill.AGILITY);
  const baller = ballers[Math.floor(random() * ballers.length)];
  if (random() >= ballerTackleChance(agility)) return;
  player.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(BALLER_TACKLE_DAMAGE, core.HitMask.RED)]);
  player.getTimers().registers(core.TimerKey.STUN, BALLER_HIT_STUN_TICKS);
  baller.performAnimation(new core.Animation(BALLER_TACKLE_ANIMATION));
  player.performAnimation(new core.Animation(PLAYER.TACKLED));
  player.getPacketSender().sendSoundEffect(SOUND.TACKLED, 1, 0).sendSoundEffect(SOUND.TACKLED_THUD, 1, 20);
  clearCarriedBall(player);
}

function createPitch() {
  class GnomeBallPitch extends core.Area {
    process(mobile) {
      if (!mobile.isPlayer()) return;
      const player = mobile.getAsPlayer();
      const session = sessions.get(player);
      if (!session || !isCarrying(player)) return;
      // A just-clicked Shoot resolves before any baller may tackle.
      if (session.shotGrace > 0) {
        session.shotGrace--;
        return;
      }
      if (++session.ticks % BALLER_TACKLE_CHECK_TICKS !== 0) return;
      const here = player.getLocation();
      const ballers = this.getNpcs().filter((npc) => {
        if (!npc || !npc.getHitpoints || npc.getHitpoints() <= 0) return false;
        if (npc.getDefinition?.()?.getName?.() !== BALLER_NAME) return false;
        if (npc.getTimers?.().has?.(core.TimerKey.STUN)) return false;
        return npc.getLocation().isWithinDistance(here, BALLER_TACKLE_RANGE);
      });
      if (ballers.length) ballerTackle(player, ballers);
    }

    postEnter(mobile) {
      if (!mobile.isPlayer()) return;
      const player = mobile.getAsPlayer();
      unequipWeapon(player);
      player.getPacketSender().sendSubInterface(OVERLAY_HUD_UID, HUD_INTERFACE, 1);
    }

    postLeave(mobile, logout) {
      if (!mobile.isPlayer()) return;
      const player = mobile.getAsPlayer();
      if (!logout) player.getPacketSender().closeSubInterface(OVERLAY_HUD_UID);
      if (!sessions.has(player)) return;
      // A win pays out only when the player walks off the pitch, not on logout.
      endSession(player, { reward: !logout });
    }
  }
  return new GnomeBallPitch([new core.Boundary(PITCH.minX, PITCH.maxX, PITCH.minY, PITCH.maxY, PITCH.plane)]);
}

/** A dropped gnome ball returns to the referee; no ground item is left behind. */
function dropBall(event) {
  if (event.itemId !== GNOMEBALL) return false;
  const { player } = event;
  player.getInventory().deleteNumber(GNOMEBALL, 1);
  player.sendMessage(BALL_RETURNS_MESSAGE);
  return true;
}

function dropPolicy(event) {
  if (event.itemId !== GNOMEBALL) return;
  dropBall(event);
  event.handled = true;
  event.dropToGround = false;
}

function endOnLogout({ player }) {
  if (player) endSession(player);
}

function endOnDeath({ player }) {
  if (player) endSession(player);
}

function login({ player }) {
  if (player && player.getAttribute(OWED_BALL_ATTRIBUTE) === true && player.getInventory().getFreeSlots() > 0) {
    player.setAttribute(OWED_BALL_ATTRIBUTE, null);
    giveBall(player);
  }
}

function attach(pluginApi) {
  api = pluginApi;
  core = api.core;
  api.persistAttribute(OWED_BALL_ATTRIBUTE);
  api.registerArea(createPitch());
  api.onObjectInteraction(GOAL_NAME, { Shoot: shootGoal });
  api.onObjectRoute(routeShot);
  api.onNpcInteraction(BALLER_NAME, { Tackle: tackleBaller });
  api.onItemAction("Gnomeball", { Drop: dropBall });
  api.onItemDropPolicy(dropPolicy);
  api.onPlayerLogout(endOnLogout);
  api.onPlayerDisconnect(endOnLogout);
  api.onPlayerDeath(endOnDeath);
  api.onPlayerLogin(login);
}

module.exports = {
  attach,
  isCarrying,
  isPlaying,
  beginGame,
  endSession,
  BALLER_NAME,
  GNOMEBALL,
  OWED_BALL_ATTRIBUTE,
  BALL_RETURNS_MESSAGE,
  _test: {
    sessions,
    shotChance,
    tackleChance,
    ballerTackleChance,
    routeShot,
    shootGoal,
    scoreGoal,
    throwBall,
    tackleBaller,
    dropBall,
    dropPolicy,
    createPitch,
    endOnLogout,
    endOnDeath,
    login,
    beginGame,
    endSession,
    setCore: (value) => {
      core = value;
    },
    setApi: (value) => {
      api = value;
    },
    setRandom: (value) => {
      random = value;
    },
    resetRandom: () => {
      random = Math.random;
    },
  },
};
