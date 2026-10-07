/**
 * A cannon's lifetime (Wiki): after 25 minutes set up it breaks and needs repairing; ten more
 * minutes unrepaired and it is gone, to be reclaimed from Nulodion. It stays up while its owner
 * is logged out. "Pick-up" takes it back, parts and balls, as captured.
 */
const Cannon = require("./Common.DwarfCannon");
const Data = require("./Data.DwarfCannon");
const Ammo = require("./Ammo.DwarfCannon");

/** Ours, or unverified (docs/dwarf-cannon.md). */
const MESSAGE = {
  BROKEN: "Your cannon has broken!",
  REPAIRED: "You repair your cannon, restoring it to working order.",
  LOST: "Your cannon has decayed. Speak to Nulodion to obtain a new one.",
  NO_SPACE: "You need more inventory space to pick up your cannon.",
};
const PICKED_UP = "You pick up the cannon. It's really heavy.";

/** Every tick the cannon stands. */
function tick(cannon) {
  cannon.age++;
  if (cannon.age >= Data.LOSE_TICKS) lose(cannon);
  else if (!cannon.broken && cannon.age >= Data.BREAK_TICKS && cannon.stage === 4) breakDown(cannon);
}

function breakDown(cannon) {
  cannon.broken = true;
  if (cannon.firing) Ammo.stopFiring(cannon);
  Cannon.setLoc(cannon, Cannon.KINDS[cannon.kind].broken);
  cannon.player?.sendMessage(MESSAGE.BROKEN);
}

/** Gone: its parts wait at Nulodion (balls in it are lost). */
function lose(cannon) {
  Cannon.forget(cannon);
  const { player } = cannon;
  if (player) markLost(player, cannon.kind, cannon.stage);
}

function markLost(player, kind, stage) {
  player.setAttribute(Cannon.LOST_ATTRIBUTE, { kind, stage });
  player.setAttribute(Cannon.STATE_ATTRIBUTE, null);
  Cannon.clearVars(player);
  player.sendMessage(MESSAGE.LOST);
}

/** "Repair" on the owner's broken cannon. */
function repair({ player, object }) {
  const cannon = Ammo.ownCannon(player, object);
  if (cannon === null) return false;
  if (!cannon) return true;
  cannon.broken = false;
  cannon.age = 0;
  Cannon.setLoc(cannon, Cannon.KINDS[cannon.kind].locs[3]);
  player.sendMessage(MESSAGE.REPAIRED);
  return true;
}

/** "Pick-up": the parts added so far and every ball, in the same tick (captured). */
function pickUp({ player, object }) {
  const cannon = Ammo.ownCannon(player, object);
  if (cannon === null) return false;
  if (!cannon) return true;
  const Items = Cannon.core.ItemIdentifiers;
  const inventory = player.getInventory();
  const balls = [[Items.STEEL_CANNONBALL, cannon.steel], [Items.GRANITE_CANNONBALL, cannon.granite]].filter(([, amount]) => amount > 0);
  const slots = cannon.stage + balls.filter(([id]) => !inventory.contains(id)).length;
  if (inventory.getFreeSlots() < slots) {
    player.sendMessage(MESSAGE.NO_SPACE);
    return true;
  }
  player.sendMessage(PICKED_UP);
  Cannon.forget(cannon);
  player.setAttribute(Cannon.STATE_ATTRIBUTE, null);
  Cannon.clearVars(player);
  for (const part of Cannon.KINDS[cannon.kind].parts.slice(0, cannon.stage)) inventory.add(new Cannon.core.Item(part, 1), true);
  for (const [id, amount] of balls) inventory.add(new Cannon.core.Item(id, amount), true);
  player.getPacketSender().sendSound(Data.SOUND.PICK_UP, 1, 0);
  return true;
}

/** Back on: the cannon is still up (re-attach it), or it went with the server (lost). */
function reattach({ player }) {
  const loadX = Number(player.getAttribute(Cannon.LOAD_X_ATTRIBUTE) ?? 0);
  if (loadX > 0) player.getPacketSender().sendVarbit(Data.VARBIT.LOAD_X, loadX);
  const cannon = Cannon.cannonOf(player);
  if (cannon) {
    cannon.player = player;
    Cannon.resendVars(cannon);
    return;
  }
  const saved = player.getAttribute(Cannon.STATE_ATTRIBUTE);
  if (saved && Cannon.KINDS[saved.kind]) markLost(player, saved.kind, saved.stage ?? 4);
}

/** Logged out: the cannon stays up, but stops firing (nobody to fire for). */
function detach({ player }) {
  const cannon = Cannon.cannonOf(player);
  if (!cannon) return;
  if (cannon.firing) cannon.firing = false;
  cannon.player = null;
}

/** ::cannondecay - the next decay step for your cannon: broken, then gone (testing). */
function fastForwardDecay({ player }) {
  const cannon = Cannon.cannonOf(player);
  if (!cannon) {
    player.sendMessage("You have no cannon set up.");
    return;
  }
  cannon.age = cannon.broken ? Data.LOSE_TICKS - 1 : Data.BREAK_TICKS - 1;
  player.sendMessage(cannon.broken ? "Your cannon will be gone next tick." : "Your cannon will break next tick.");
}

module.exports = function attachDecay(api) {
  api.persistAttribute(Cannon.STATE_ATTRIBUTE);
  api.persistAttribute(Cannon.LOST_ATTRIBUTE);
  api.onObjectInteraction("Dwarf multicannon", { "Pick-up": pickUp });
  api.onObjectInteraction("Broken multicannon", { Repair: repair, "Pick-up": pickUp });
  api.onObjectInteraction("Cannon base", { "Pick-up": pickUp });
  api.onObjectInteraction("Cannon stand", { "Pick-up": pickUp });
  api.onObjectInteraction("Cannon barrels", { "Pick-up": pickUp });
  api.onPlayerLogin(reattach);
  api.onPlayerLogout(detach);
  api.registerCommand("cannondecay", fastForwardDecay, api.core.PlayerRights.DEVELOPER, "Break your cannon, or make a broken one disappear");
};

Object.assign(module.exports, { tick, breakDown, lose, repair, pickUp, reattach, detach, fastForwardDecay, MESSAGE, PICKED_UP });
