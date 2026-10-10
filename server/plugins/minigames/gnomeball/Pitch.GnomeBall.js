"use strict";

/**
 * The Gnome Ball pitch at the Tree Gnome Stronghold
 * (https://oldschool.runescape.wiki/w/Gnome_Ball).
 *
 * Sessions live here; Referee.GnomeBall.js hands the ball over through `beginGame`.
 * The Wiki's three mechanics:
 * - Shoot: d = min(distance to the goal, 11); low = 48 - 2d, high = 278 - 3d;
 *   P = (round(low * (99 - Ranged) / 98 + high * (Ranged - 1) / 98) + 1) / 256,
 *   clamped to 0-1 (Wiki Module:Skilling_success_chart). A goal scores a point
 *   and gives 4/5/6/7 XP in Ranged and Agility on goals 1-4 and 30 XP on goal 5 (that 30
 *   carries the 25-XP win bonus; 52 XP per skill per won game). The fifth goal resets the
 *   score. Hit or miss, the ball is lost and a new one must be asked from the referee.
 * - Tackle: a successful player tackle knocks a baller out for a few seconds;
 *   P = lerp(31/256, 201/256, (Agility - 1) / 98), or 221/256 against a baller holding the
 *   ball. A successful tackle transfers the held ball back to the player.
 *   A baller that tackles the carrier deals damage (the Wiki says 1-2; the capture shows 1)
 *   and takes the ball. Ballers chase carriers within eight tiles and check for a tackle
 *   every two ticks on contact. The chosen roll is 50% at level 1 falling to 20% at 99.
 *   Checks pause after a Shoot click, so a shot
 *   cannot be pre-empted by the tackle that the shot itself triggered.
 * - Pass: wingers catch the ball, hold it a few seconds, then throw it back.
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
const WINGER_NAME = "Gnome winger";
const GOAL_NAME = "Gnome goal";
const GNOMEBALL = 751; // ItemIdentifiers.GNOMEBALL
const PITCH = { minX: 2383, maxX: 2408, minY: 3481, maxY: 3496, plane: 0 };
// shortcut: throws reach across the pitch, narrow this if live captures establish a shorter range.
const PITCH_THROW_RANGE = Math.max(PITCH.maxX - PITCH.minX, PITCH.maxY - PITCH.minY);
const MAX_SHOT_DISTANCE = 11;
const GOALS_PER_GAME = 5;
/** Goals 1-5: the Wiki's 4/5/6/7 and the 30 that carries the win bonus. */
const GOAL_XP = [4, 5, 6, 7, 30];
const TACKLE_MIN = 31 / 256;
const TACKLE_MAX = 201 / 256;
const TACKLE_HOLDING_MAX = 221 / 256;
// shortcut: the restored 50%-20% tackle roll is undocumented, replace with captures when available.
const BALLER_TACKLE_AT_1 = 0.5;
const BALLER_TACKLE_AT_99 = 0.2;
const TACKLE_KNOCKOUT_TICKS = 5; // "knocking them out for a few seconds"
const BALLER_TACKLE_CHECK_TICKS = 2;
const BALLER_TACKLE_RANGE = 1;
const BALLER_CHASE_RANGE = 8;
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
  TACKLE: 778, TACKLE_FAIL: 780, TACKLED: 779, CATCH: 782, THROW: 783,
});
const SOUND = Object.freeze({
  TACKLE: 1571, TACKLE_FAIL: 1572, TACKLED: 1574, TACKLED_THUD: 518, THROW: 1576,
});
const BALL_PROJECTILE = 55;
const BALL_THROW_HEIGHT = 40;
// Animation 783 lasts 48 client cycles; release after its final frame advances.
const BALL_THROW_RELEASE_CYCLES = 49;
const WINGER_CATCH_ANIMATION = 200; // cache: gnome_catch
const WINGER_THROW_ANIMATION = 201; // cache: gnome_throw
// shortcut: five ticks stands in for the Wiki's "a few seconds", use captures for exact timing.
const WINGER_RETURN_TICKS = 5;
/** The Gnome Ball HUD, in the toplevel's overlay slot (as Corp's). */
const HUD_INTERFACE = 139;
const SCORE_VARBIT = 8387; // HUD scripts 574/882 read this; 2533 watches its backing varp 143.
const OVERLAY_HUD_UID = (161 << 16) | 8;
const DIARY = Object.freeze({ diary: "western", task: "score-a-goal-in-a-gnomeball-match" });
/** The player had no room for a ball the referee owed them; give it on login. */
const OWED_BALL_ATTRIBUTE = "gnomeball:owed-ball";
const IN_PLAY_BALL_META = "gnomeball:in-play";
const BALL_RETURNS_MESSAGE = "The ball magically returns to the ref as you put it down.";
const NO_BALL_MESSAGE = "You need a ball in your hand to throw.";
const THROW_MESSAGE = "You throw the ball at the goal...";
const MISS_MESSAGE = "... and miss.";
const BEING_TACKLED_MESSAGE = "That gnome is being tackled.";

let api;
let core;
let ballerHoldingIds;
let random = Math.random;

/** player -> { goals, won, ownBall, ticks } */
const sessions = new Map();

const tile = (x, y, z) => new core.Location(x, y, z);

function isCarrying(player) {
  return player.getEquipment().getSlot(core.Equipment.WEAPON_SLOT) === GNOMEBALL;
}

function isCarryingGameBall(player) {
  return isCarrying(player)
    && player.getEquipment().getItems()[core.Equipment.WEAPON_SLOT].getMetaValue(IN_PLAY_BALL_META) === true;
}

function isPlaying(player) {
  return sessions.has(player);
}

/** Wiki Gnome goal bounds with Module:Skilling_success_chart's rounded inclusive roll. */
function shotChance(distance, rangedLevel) {
  const d = Math.min(distance, MAX_SHOT_DISTANCE);
  const low = 48 - 2 * d;
  const high = 278 - 3 * d;
  const threshold = Math.floor(low * (99 - rangedLevel) / 98 + high * (rangedLevel - 1) / 98 + 0.5) + 1;
  return Math.min(1, Math.max(0, threshold / 256));
}

/** Wiki: lerp(31/256, 201/256, (Agility - 1) / 98); 221/256 while the baller holds the ball. */
function tackleChance(agilityLevel, ballerHasBall = false) {
  const top = ballerHasBall ? TACKLE_HOLDING_MAX : TACKLE_MAX;
  const t = Math.max(0, Math.min(1, (agilityLevel - 1) / 98));
  return TACKLE_MIN + (top - TACKLE_MIN) * t;
}

/** Baller -> carrier: the restored chosen roll falls with Agility. */
function ballerTackleChance(agilityLevel) {
  const t = Math.max(0, Math.min(1, (agilityLevel - 1) / 98));
  return BALLER_TACKLE_AT_1 + (BALLER_TACKLE_AT_99 - BALLER_TACKLE_AT_1) * t;
}

function inPitch(actor) {
  const at = actor.getLocation();
  return at.getZ() === PITCH.plane
    && at.getX() >= PITCH.minX && at.getX() <= PITCH.maxX
    && at.getY() >= PITCH.minY && at.getY() <= PITCH.maxY;
}

function sessionHoldingBall(npc) {
  for (const session of sessions.values()) {
    if (session.ballHolder === npc) return session;
  }
  return null;
}

function clearNpcBall(session) {
  session.passTask?.stop();
  delete session.passTask;
  session.ballHolder?.setNpcTransformationId(-1);
  delete session.ballHolder;
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
  player.getEquipment().setItem(core.Equipment.WEAPON_SLOT,
    new core.Item(GNOMEBALL, 1).setMetaValue(IN_PLAY_BALL_META, true));
  player.getEquipment().refreshItems();
  flagAppearance(player);
}

function clearCarriedBall(player) {
  const equipment = player.getEquipment();
  if (!isCarryingGameBall(player)) return;
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
  clearNpcBall(session);
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
  clearNpcBall(session);
  sessions.delete(player);
  clearCarriedBall(player);
  if (session.ownBall) giveBall(player);
  else if (reward && session.won) giveBall(player);
}

/** A Shoot click on the goal buys the shot a few ticks before ballers may tackle. */
function routeShot(event) {
  if (event.definition?.getName?.() !== GOAL_NAME) return;
  const option = event.definition.getInteractions?.()?.[event.clickType - 1];
  if (option && option !== "Shoot") return;
  if (!inPitch(event.player) || !inPitch(event.object)) return;
  // Repeated clicks after releasing the ball must not start a walk to the goal either.
  event.destination = event.sourceLocation;
  const session = sessions.get(event.player);
  if (session && isCarrying(event.player)) session.shotGrace = SHOT_GRACE_TICKS;
}

function routePass(event) {
  if (event.definition?.getName?.() !== WINGER_NAME) return;
  if (event.definition.getActions?.()?.[event.clickType - 1] !== "Pass-to") return;
  if (!inPitch(event.player) || !inPitch(event.npc)) return;
  event.range = PITCH_THROW_RANGE;
}

/** Runs `action` after `ticks` game ticks. */
function later(ticks, action) {
  const { Task } = core;
  const task = new (class extends Task {
    constructor() {
      super(ticks);
    }
    execute() {
      this.stop();
      action();
    }
  })();
  api.getTaskManager().submit(task);
  return task;
}

/** Animation, sound, and a ball flying at a goal or winger. Returns its travel ticks. */
function throwBall(player, goal, target = null) {
  const from = player.getLocation();
  const flight = BALL_THROW_RELEASE_CYCLES + 5 * Math.max(1, from.getDistance(goal));
  player.performAnimation(new core.Animation(PLAYER.THROW));
  player.getPacketSender()
    .sendAreaSound(SOUND.THROW, from.getX(), from.getY(), from.getZ(), 1, 10, 5)
    .sendProjectile(from, goal, 0, flight, BALL_PROJECTILE, BALL_THROW_HEIGHT, BALL_THROW_HEIGHT, target, BALL_THROW_RELEASE_CYCLES, 15, 11);
  return Math.ceil(flight / 30);
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
  later(1, () => {
    if (sessions.get(player) !== session || !inPitch(player)) return;
    const travelTicks = throwBall(player, goal);
    later(travelTicks, () => {
      if (sessions.get(player) !== session || !inPitch(player)) return;
      if (scored) scoreGoal(player, session);
      else player.sendMessage(MISS_MESSAGE);
    });
  });
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
  player.getPacketSender().sendVarbit(SCORE_VARBIT, session.goals);
  return true;
}

/** Pass-to throws to the winger; each pending step is cancelled on leaving or a new ball. */
function passToWinger({ player, npc }) {
  const session = sessions.get(player);
  if (!session) {
    player.sendMessage("Talk to the gnome ball referee first.");
    return true;
  }
  if (!isCarrying(player)) {
    player.sendMessage("You need a gnome ball to pass.");
    return true;
  }
  if (!npc || !inPitch(player) || !inPitch(npc)) return true;
  if (sessionHoldingBall(npc)) {
    player.sendMessage("That gnome winger already has a ball in play.");
    return true;
  }
  session.ballHolder = npc;
  player.getTimers().cancel(core.TimerKey.STUN);
  player.setPositionToFace(npc.getLocation());
  clearCarriedBall(player);
  player.sendMessage("You pass the ball to the gnome winger.");
  const travelTicks = throwBall(player, npc.getLocation(), npc);
  const canReturn = () => sessions.get(player) === session && !isCarrying(player) && inPitch(player);
  session.passTask = later(travelTicks, () => {
    if (!canReturn()) {
      clearNpcBall(session);
      return;
    }
    npc.setNpcTransformationId(core.NpcIdentifiers.GNOME_WINGER_2);
    npc.setPositionToFace(player.getLocation());
    npc.performAnimation(new core.Animation(WINGER_CATCH_ANIMATION));
    session.passTask = later(WINGER_RETURN_TICKS, () => {
      if (!canReturn()) {
        clearNpcBall(session);
        return;
      }
      const from = npc.getLocation();
      const to = player.getLocation();
      const flight = 41 + 5 * Math.max(1, from.getDistance(to));
      npc.setPositionToFace(to);
      npc.performAnimation(new core.Animation(WINGER_THROW_ANIMATION));
      npc.setNpcTransformationId(-1);
      delete session.ballHolder;
      player.getPacketSender().sendProjectile(from, to, 0, flight, BALL_PROJECTILE, BALL_THROW_HEIGHT, BALL_THROW_HEIGHT, player, 41, 15, 11);
      session.passTask = later(Math.ceil(flight / 30), () => {
        if (!canReturn()) return;
        delete session.passTask;
        player.performAnimation(new core.Animation(PLAYER.CATCH));
        equipBall(player);
        player.sendMessage("The gnome winger passes the ball back to you.");
      });
    });
  });
  return true;
}

/** Tackle knocks a baller down; a held ball changes hands, with no XP or score. */
function tackleBaller(event) {
  const { player, npc } = event;
  if (!npc) return true;
  if (npc.getTimers().has(core.TimerKey.STUN)) {
    player.sendMessage(BEING_TACKLED_MESSAGE);
    return true;
  }
  const holderSession = sessionHoldingBall(npc);
  const playerSession = sessions.get(player);
  if (holderSession && !playerSession) {
    player.sendMessage("Talk to the gnome ball referee first.");
    return true;
  }
  if (holderSession && isCarrying(player)) {
    player.sendMessage("You already have a ball in play.");
    return true;
  }
  player.setPositionToFace(npc.getLocation());
  npc.setPositionToFace(player.getLocation());
  const agility = player.getSkillManager().getCurrentLevel(core.Skill.AGILITY);
  if (random() < tackleChance(agility, holderSession !== null)) {
    if (holderSession) {
      if (!unequipWeapon(player)) return true;
      clearNpcBall(holderSession);
      if (playerSession !== holderSession) clearNpcBall(playerSession);
      equipBall(player);
    }
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

/** Pursue the carrier using the existing NPC movement queue. */
function stepToward(npc, target) {
  const at = npc.getLocation();
  if (at.getDistance(target.getLocation()) > BALLER_CHASE_RANGE) return;
  const movement = npc.getMovementQueue?.();
  if (!movement?.getMobility?.().canMove()) return;
  npc.setPositionToFace(target.getLocation());
  movement.setPursuitCheckpoint(core.PathFinder.naiveEntityDestination(npc, target));
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
  sessions.get(player).ballHolder = baller;
  baller.setNpcTransformationId(ballerHoldingIds.get(baller.getRealId()));
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
      // Static ballers may never enter the area NPC index; the player's local list has them.
      const ballers = player.getLocalNpcs().filter((npc) => {
        if (!npc || !npc.getHitpoints || npc.getHitpoints() <= 0) return false;
        if (npc.getDefinition?.()?.getName?.() !== BALLER_NAME) return false;
        if (npc.getTimers?.().has?.(core.TimerKey.STUN)) return false;
        if (!ballerHoldingIds.has(npc.getRealId()) || sessionHoldingBall(npc)) return false;
        return inPitch(npc);
      });
      for (const npc of ballers) stepToward(npc, player);
      const adjacent = ballers.filter((npc) => npc.getLocation().isWithinDistance(here, BALLER_TACKLE_RANGE));
      if (adjacent.length) ballerTackle(player, adjacent);
    }

    postEnter(mobile) {
      if (!mobile.isPlayer()) return;
      const player = mobile.getAsPlayer();
      unequipWeapon(player);
      player.getPacketSender()
        .sendVarbit(SCORE_VARBIT, sessions.get(player)?.goals ?? 0)
        .sendSubInterface(OVERLAY_HUD_UID, HUD_INTERFACE, 1);
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
  if (!player) return;
  // Recover only marked game balls; an equipped reward belongs to the player.
  if (isCarryingGameBall(player)) {
    if (inPitch(player)) sessionFor(player);
    else clearCarriedBall(player);
  }
  if (player.getAttribute(OWED_BALL_ATTRIBUTE) === true && player.getInventory().getFreeSlots() > 0) {
    player.setAttribute(OWED_BALL_ATTRIBUTE, null);
    giveBall(player);
  }
}

function attach(pluginApi) {
  api = pluginApi;
  core = api.core;
  const N = core.NpcIdentifiers;
  ballerHoldingIds = new Map([
    [N.GNOME_BALLER, N.GNOME_BALLER_2],
    [N.GNOME_BALLER_5, N.GNOME_BALLER_6],
    [N.GNOME_BALLER_9, N.GNOME_BALLER_10],
  ]);
  api.persistAttribute(OWED_BALL_ATTRIBUTE);
  api.registerArea(createPitch());
  api.onObjectInteraction(GOAL_NAME, { Shoot: shootGoal });
  api.onObjectRoute(routeShot);
  api.onNpcInteraction(BALLER_NAME, { Tackle: tackleBaller });
  api.onNpcInteraction(WINGER_NAME, { "Pass-to": passToWinger });
  api.onNpcRoute(routePass);
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
    routePass,
    shootGoal,
    scoreGoal,
    throwBall,
    passToWinger,
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
