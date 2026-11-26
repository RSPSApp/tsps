/**
 * The strangle (rsprox 3285): Vardorvis rears up (entangle start) and two ticks later holds the
 * player in tendrils - "Vardorvis entangles you in some tendrils!", spores on them and the spore
 * overlay (interface 833 over the game, script 1816 with the spore count; varbits vardorvis_qte_1..6
 * of varp 3942 say which still stand). Each click on a spore clears its varbit. Clearing them all
 * ends it at once ("You manage to escape from the tendrils."); otherwise, 5 ticks after the overlay
 * opened (3 awakened, Wiki) the tendrils tighten for heavy damage (Wiki: about 25, 40 awakened).
 * Either way the spores fall (script 1823), Vardorvis lets go and the overlay closes a tick later;
 * his next axes come 3 ticks after he lets go (rsprox 1156, all seven escapes). The escape line is
 * a filterable one (message type 105, rsprox 3285 and 1156).
 * The first strangle of a kill has 4 spores, each one after one more, up to 6 (Wiki).
 */
const Common = require("./Common.Vardorvis");

const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
const OVERLAY = 1;
const BLOCK_ANIM = 424;

const holds = new WeakMap();

function start(fight) {
  const { strangle } = Common.data;
  const { boss, player } = fight;
  fight.strangling = true;
  boss.getMovementQueue().reset();
  boss.getMovementQueue().setBlockMovement(true);
  boss.performAnimation(new Common.core.Animation(strangle.startAnim));
  boss.setPositionToFace(player.getLocation());
  Common.sound(player, strangle.startSound);
  fight.at(strangle.openTicks, () => entangle(fight));
}

function entangle(fight) {
  const { strangle } = Common.data;
  const { boss, player } = fight;
  if (!fight.alive() || !player.isRegistered() || player.getHitpoints() <= 0) {
    release(fight);
    return;
  }
  const spores = Math.min(strangle.spores.first + fight.strangles - 1, strangle.spores.max);
  const hold = { fight, spores, standing: (1 << spores) - 1, ticks: 0, done: false };
  holds.set(player, hold);
  fight.hold = hold;
  boss.performAnimation(new Common.core.Animation(strangle.loopAnim));
  Common.sound(player, strangle.loopSound);
  player.sendMessage(strangle.message);
  player.getMovementQueue().reset();
  player.getMovementQueue().setBlockMovement(true);
  player.getCombat().reset?.();
  player.performAnimation(new Common.core.Animation(strangle.playerAnim));
  player.performGraphicInSlot(2, Common.graphic(strangle.spots.spawn));
  const sender = player.getPacketSender();
  sender.sendConfig(strangle.sporeVarp, hold.standing);
  sender.sendSubInterface(OVERLAY_ATMOSPHERE_UID, strangle.interface, OVERLAY);
  sender.sendInterfaceScript(strangle.setupScript, [spores]);
  const window = strangle.windowTicks[fight.awakened ? "awakened" : "normal"];
  const step = () => {
    if (hold.done) return;
    if (++hold.ticks >= window) {
      resolve(hold, false);
      return;
    }
    player.performAnimation(new Common.core.Animation(strangle.playerAnim));
    fight.at(1, step);
  };
  fight.at(1, step);
}

/** A click on a spore: its varbit clears; the last one frees the player. */
function destroySpore(player, index) {
  const hold = holds.get(player);
  if (!hold || hold.done || index < 0 || index >= hold.spores) return false;
  const bit = 1 << index;
  if ((hold.standing & bit) === 0) return true;
  const { strangle } = Common.data;
  hold.standing &= ~bit;
  player.getPacketSender().sendConfig(strangle.sporeVarp, hold.standing);
  if (hold.standing === 0) resolve(hold, true);
  else player.performGraphicInSlot(2, Common.graphic(strangle.spots.idle));
  return true;
}

function resolve(hold, escaped) {
  if (hold.done) return;
  hold.done = true;
  const { strangle } = Common.data;
  const { fight } = hold;
  const { player, boss } = fight;
  const sender = player.getPacketSender();
  sender.sendConfig(strangle.sporeVarp, 0);
  player.performGraphicInSlot(2, Common.graphic(strangle.spots.despawn));
  sender.sendInterfaceScript(strangle.fadeScript, []);
  if (escaped) {
    Common.spam(player, strangle.escapeMessage);
    player.performAnimation(new Common.core.Animation(-1));
  } else {
    player.sendMessage(strangle.tightenMessage);
    player.performAnimation(new Common.core.Animation(BLOCK_ANIM));
    const max = strangle.maxHit[fight.awakened ? "awakened" : "normal"];
    Common.damage(player, Common.randomInt(Math.ceil(max * strangle.minShare), max),
      null, (amount) => fight.recordDamage(amount));
  }
  if (boss.isRegistered() && boss.getHitpoints() > 0) {
    boss.performAnimation(new Common.core.Animation(strangle.endAnim));
    Common.sound(player, strangle.endSound);
  }
  Common.later(1, () => player.isRegistered() && sender.closeSubInterface(OVERLAY_ATMOSPHERE_UID));
  release(fight);
  fight.released?.();
}

function release(fight) {
  const { player, boss } = fight;
  fight.strangling = false;
  fight.hold = null;
  holds.delete(player);
  player.getMovementQueue().setBlockMovement(false);
  boss?.getMovementQueue?.().setBlockMovement(false);
}

/** The fight ended mid-strangle: the overlay goes and the player is free. */
function clear(fight) {
  const hold = fight.hold;
  if (!hold || hold.done) {
    if (fight.strangling) release(fight);
    return;
  }
  hold.done = true;
  const { strangle } = Common.data;
  const sender = fight.player.getPacketSender();
  sender.sendConfig(strangle.sporeVarp, 0);
  sender.closeSubInterface(OVERLAY_ATMOSPHERE_UID);
  release(fight);
}

function clickSpore({ player, buttonId }) {
  const { strangle } = Common.data;
  return destroySpore(player, strangle.sporeComponents.indexOf(buttonId & 0xffff));
}

function attachStrangle(api) {
  const { strangle } = Common.data;
  api.onInterfaceActionButton(strangle.sporeComponents.map((component) => (strangle.interface << 16) | component), clickSpore);
}

module.exports = { attachStrangle, start, clear };
