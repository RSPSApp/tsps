/**
 * Shantay's jail and the Port Sarim cell he sends unpaying outlaws to, as rsprox captures show:
 *
 * - Arrested players are put in the cell west of Shantay (3296, 3124) three ticks after
 *   "The guards arrest you and place you in the jail." The prison door (loc 2692, 3297, 3124)
 *   then answers "This door is locked." and Shantay asks for the fine again.
 * - Unlocked, each "Open" steps the player through the door one tile while it swings open
 *   (an invisible wall on its tile, the open door, 1548, beside it; sound 71), and two ticks
 *   later it closes.
 * - Port Sarim: a fade out, the player lands in the cell at (3014, 3180) two ticks later, and
 *   the fade lifts. Its door (loc 9565, 3014, 3182) is "fairly well locked" and can only be
 *   picked from inside. Each attempt sends "You attempt to pick the lock on the door." and
 *   either opens it ("You pick the lock on the prison door.") or picks for 11 ticks and tries
 *   again.
 * - Leaving a cell without paying (a teleport, or the Port Sarim lock) is an escape, which
 *   Shantay holds against the player.
 *
 * The pick-lock chance is Mod Ash's (Wiki): first try 0% at level 1 to 39% at 99, rising with
 * each failure to 82% / 127% (23% / 117% and 106% / 206% with a lockpick). How fast it rises
 * isn't published; this server reaches the top after four failures.
 */
const Common = require("./Common.ShantayPass");

const SHANTAY_CELL = { tile: [3296, 3124], minX: 3295, maxX: 3297, minY: 3122, maxY: 3126 };
const PRISON_DOOR = 2692;
const PRISON_DOOR_TILE = [3297, 3124];
const PRISON_DOOR_ROTATION = 2;
const OPEN_PRISON_DOOR = 1548;
const OPEN_PRISON_DOOR_TILE = [3298, 3124];
const OPEN_PRISON_DOOR_ROTATION = 3;
const INVISIBLE_WALL = 38848;
const DOOR_SOUND = 71;
const DOOR_OPEN_TICKS = 2;
const ARREST_DELAY = 3;

const PORT_SARIM_CELL = { tile: [3014, 3180], minX: 3013, maxX: 3014, minY: 3180, maxY: 3181 };
const PORT_SARIM_DOOR = 9565;
const PORT_SARIM_DOOR_TILE = [3014, 3182];
const PORT_SARIM_DOOR_ROTATION = 3;
const OPEN_PORT_SARIM_DOOR = 9566;
const OPEN_PORT_SARIM_DOOR_TILE = [3014, 3181];
const OPEN_PORT_SARIM_DOOR_ROTATION = 0;
const PICK_LOCK_ANIMATION = 2094; // human_openingchest_mid
const PICK_LOCK_SOUND = 2402;
const UNLOCK_SOUND = 52;
const PICK_LOCK_RETRY_TICKS = 11;
const PICK_LOCK_RAMP = 4;
const PICK_LOCK_XP = 4;
const PICK_LOCK_FAIL_XP = 0.5;
const LOCKPICK = 1523;

/** In the Port Sarim cell Shantay sent the player to, until they get out. */
const PRISONER_ATTRIBUTE = "shantay-pass:port-sarim-prisoner";

const FADE_OVERLAY_UID = (161 << 16) | 1;
const FADE_OVERLAY = 174;
const FADE_SCRIPT = 948;
const FADE_CYCLES = 50;

const ARRESTED_VARIANT = "arrested";
const LOCKED_VARIANT = "interacting-with-the-prison-door-while-locked-in-the-shantay-pass-jail";
const ESCAPED_VARIANT = "interacting-with-the-prison-door-after-escaping-out-of-the-maximum-security-prison-or-the-shantay-pass-jail";

function jailed(player) {
  return player.getAttribute(Common.JAILED_ATTRIBUTE) === true;
}

function inside(cell, location) {
  const x = location.getX();
  const y = location.getY();
  return location.getZ() === 0 && x >= cell.minX && x <= cell.maxX && y >= cell.minY && y <= cell.maxY;
}

/** Three ticks after the arrest message: in the cell, and Shantay names the fine. */
function lockUp(player) {
  player.setAttribute(Common.JAILED_ATTRIBUTE, true);
  player.getPacketSender().sendInterfaceRemoval();
  Common.later(player, ARREST_DELAY, () => {
    if (!jailed(player)) return;
    player.moveTo(Common.tile(...SHANTAY_CELL.tile));
    Common.shantaySays(player, ARRESTED_VARIANT);
  });
}

function release(player) {
  player.setAttribute(Common.JAILED_ATTRIBUTE, false);
}

function fade(player, out) {
  const args = out ? [0, 255, 0, 0, FADE_CYCLES] : [0, 0, 0, 255, FADE_CYCLES];
  player.getPacketSender().sendSubInterface(FADE_OVERLAY_UID, FADE_OVERLAY, 1, {
    postScripts: [{ scriptId: FADE_SCRIPT, args }],
  });
}

function sendToPortSarim(player) {
  player.setAttribute(Common.JAILED_ATTRIBUTE, false);
  player.setAttribute(PRISONER_ATTRIBUTE, true);
  player.getPacketSender().sendInterfaceRemoval();
  fade(player, true);
  Common.later(player, 2, () => {
    player.moveTo(Common.tile(...PORT_SARIM_CELL.tile));
    Common.later(player, 1, () => {
      fade(player, false);
      Common.later(player, 2, () => player.getPacketSender().closeSubInterface(FADE_OVERLAY_UID));
    });
  });
}

/** Swaps a closed door for its open leaf (and an invisible wall) for this player, then back. */
function swingOpen(player, closed, open) {
  const { GameObject } = Common.getCore();
  const sender = player.getPacketSender();
  const area = player.getPrivateArea();
  const shut = new GameObject(closed.id, Common.tile(...closed.tile), 0, closed.rotation, area);
  const wall = new GameObject(INVISIBLE_WALL, Common.tile(...closed.tile), 0, closed.rotation, area);
  const leaf = new GameObject(open.id, Common.tile(...open.tile), 0, open.rotation, area);
  sender.sendObjectRemoval(shut).sendObject(wall).sendObject(leaf);
  Common.later(player, DOOR_OPEN_TICKS, () => {
    sender.sendObjectRemoval(leaf).sendObject(shut);
  });
}

function openPrisonDoor(event) {
  const { player } = event;
  const at = player.getLocation();
  const fromInside = at.getX() <= PRISON_DOOR_TILE[0];
  if (fromInside && jailed(player)) {
    const lockedAt = () => Common.shantaySays(player, LOCKED_VARIANT);
    if (at.getX() !== PRISON_DOOR_TILE[0]) {
      Common.step(player, PRISON_DOOR_TILE);
      Common.later(player, 1, lockedAt);
    } else {
      lockedAt();
    }
    return true;
  }
  if (player.getAttribute(Common.ESCAPED_ATTRIBUTE) === true) {
    Common.shantaySays(player, ESCAPED_VARIANT);
    return true;
  }
  const closed = { id: PRISON_DOOR, tile: PRISON_DOOR_TILE, rotation: PRISON_DOOR_ROTATION };
  const open = { id: OPEN_PRISON_DOOR, tile: OPEN_PRISON_DOOR_TILE, rotation: OPEN_PRISON_DOOR_ROTATION };
  const through = () => {
    Common.step(player, fromInside ? OPEN_PRISON_DOOR_TILE : PRISON_DOOR_TILE);
    swingOpen(player, closed, open);
    player.getPacketSender().sendSound(DOOR_SOUND, 1, 0);
  };
  if (fromInside && at.getX() !== PRISON_DOOR_TILE[0]) {
    Common.step(player, PRISON_DOOR_TILE);
    Common.later(player, 1, through);
  } else {
    through();
  }
  return true;
}

function isPortSarimDoor(event) {
  const location = event.location ?? event.object?.getLocation?.();
  const x = location?.x ?? location?.getX?.();
  const y = location?.y ?? location?.getY?.();
  return x === PORT_SARIM_DOOR_TILE[0] && y === PORT_SARIM_DOOR_TILE[1];
}

function openPortSarimDoor(event) {
  if (!isPortSarimDoor(event)) return false;
  event.player.sendMessage("The door seems to be fairly well locked.");
  return true;
}

function pickChance(player, failures) {
  const { Skill } = Common.getCore();
  const level = player.getSkillManager().getCurrentLevel(Skill.THIEVING);
  const lockpick = player.getInventory().getAmount(LOCKPICK) > 0;
  const atLevel = (low, high) => low + (high - low) * Math.max(0, Math.min(1, (level - 1) / 98));
  const first = lockpick ? atLevel(0.23, 1.17) : atLevel(0, 0.39);
  const best = lockpick ? atLevel(1.06, 2.06) : atLevel(0.82, 1.27);
  return first + (best - first) * Math.min(1, failures / PICK_LOCK_RAMP);
}

function thievingXp(player, amount) {
  const { Skill, WorldDefinition } = Common.getCore();
  if (WorldDefinition.isMembersWorld()) player.getSkillManager().addExperiences(Skill.THIEVING, amount);
}

function pickedOpen(player) {
  const sender = player.getPacketSender();
  player.sendMessage("You pick the lock on the prison door.");
  player.performAnimation(Common.getCore().Animation.DEFAULT_RESET_ANIMATION);
  sender.sendSound(PICK_LOCK_SOUND, 1, 0);
  thievingXp(player, PICK_LOCK_XP);
  Common.later(player, 1, () => {
    Common.step(player, PORT_SARIM_DOOR_TILE);
    swingOpen(player,
      { id: PORT_SARIM_DOOR, tile: PORT_SARIM_DOOR_TILE, rotation: PORT_SARIM_DOOR_ROTATION },
      { id: OPEN_PORT_SARIM_DOOR, tile: OPEN_PORT_SARIM_DOOR_TILE, rotation: OPEN_PORT_SARIM_DOOR_ROTATION });
    sender.sendSound(UNLOCK_SOUND, 1, 0);
    sender.sendSound(DOOR_SOUND, 1, 0);
  });
}

/**
 * Each player's current attempts at the lock. A new Pick-lock click starts over and the old attempts stop: each click
 * started its own chain, and none stopped the last, so N clicks paid N fail XP every 11 ticks.
 */
const picking = new WeakMap();

/** One attempt, then another every 11 ticks until the lock gives or the player moves off. */
function attemptPick(player, failures, from, attempt) {
  if (picking.get(player) !== attempt) return;
  const at = player.getLocation();
  if (at.getX() !== from.getX() || at.getY() !== from.getY()) return;
  player.sendMessage("You attempt to pick the lock on the door.");
  if (Math.random() < pickChance(player, failures)) {
    pickedOpen(player);
    return;
  }
  thievingXp(player, PICK_LOCK_FAIL_XP);
  Common.later(player, 1, () => {
    player.performAnimation(new (Common.getCore().Animation)(PICK_LOCK_ANIMATION));
    player.getPacketSender().sendSound(PICK_LOCK_SOUND, 1, 0);
    Common.later(player, PICK_LOCK_RETRY_TICKS - 1, () => attemptPick(player, failures + 1, from, attempt));
  });
}

function pickPortSarimLock(event) {
  if (!isPortSarimDoor(event)) return false;
  const { player } = event;
  if (!inside(PORT_SARIM_CELL, player.getLocation())) {
    player.sendMessage("You simply cannot find a way to pick the lock from this side.");
    return true;
  }
  const doorSide = Common.tile(...OPEN_PORT_SARIM_DOOR_TILE);
  player.getMovementQueue().reset();
  const attempt = {};
  picking.set(player, attempt);
  const start = () => attemptPick(player, 0, player.getLocation().clone(), attempt);
  if (!player.getLocation().equals?.(doorSide)) {
    Common.step(player, OPEN_PORT_SARIM_DOOR_TILE);
    Common.later(player, 1, start);
  } else {
    Common.later(player, 1, start);
  }
  return true;
}

function createCell(core, cell, attribute) {
  const { Area, Boundary } = core;
  return new (class extends Area {
    /** Out of the cell without paying: an escape (logging out is not). */
    postLeave(mobile, logout) {
      if (logout || !mobile.isPlayer?.() || mobile.getAttribute(attribute) !== true) return;
      if (inside(cell, mobile.getLocation())) return;
      mobile.setAttribute(attribute, false);
      mobile.setAttribute(Common.ESCAPED_ATTRIBUTE, true);
    }
  })([new Boundary(cell.minX, cell.maxX, cell.minY, cell.maxY, 0)]);
}

function attach(api) {
  api.persistAttribute(PRISONER_ATTRIBUTE, false);
  api.onObjectClick(PRISON_DOOR, 1, openPrisonDoor);
  api.onObjectClick(PORT_SARIM_DOOR, 1, openPortSarimDoor);
  api.onObjectClick(PORT_SARIM_DOOR, 5, pickPortSarimLock);
  api.registerArea(createCell(api.core, SHANTAY_CELL, Common.JAILED_ATTRIBUTE));
  api.registerArea(createCell(api.core, PORT_SARIM_CELL, PRISONER_ATTRIBUTE));
}

module.exports = attach;
Object.assign(module.exports, { lockUp, release, sendToPortSarim, pickChance, pickPortSarimLock, SHANTAY_CELL, PORT_SARIM_CELL });
