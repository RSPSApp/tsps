"use strict";

/**
 * The Ghost captain's boat between Port Phasmatys and Dragontooth Island, as the user's
 * revision 242 capture sails it (20261112T092603-5ab63b4: out at ticks 1110-1122, back at
 * 1158-1167):
 *
 * - Travel (op3) has no dialogue. On reaching the captain the fare (25 Ectotokens, outbound
 *   only; Wiki, Ghost captain: "or 10 with the Ring of Charos(a)") is taken and the screen fades out with the caption "After a long boat trip you arrive
 *   at Dragontooth Island." / "... you return to Port Phasmatys." (fade_overlay 174, script 948
 *   [0, 255, 0, 0, 50]).
 * - Four ticks later the player is on the far jetty; the tick after, the caption clears and
 *   the screen fades back in ([0, 0, 0, 255, 50]); two ticks after that the overlay closes.
 *
 * Talk-to's "Okay, here's 25 ectotokens. Let's go." sails the same way.
 */

const FADE_UID = (161 << 16) | 1;
const FADE_INTERFACE = 174;
const FADE_CAPTION = (174 << 16) | 4;
const FADE_SCRIPT = 948;
const FADE_OUT = [0, 255, 0, 0, 50];
const FADE_IN = [0, 0, 0, 255, 50];
const MOVE_TICKS = 4;
const FADE_IN_TICKS = 5;
const CLOSE_TICKS = 7;

const FARE = 25;
/** Wiki (Ghost captain): 10 with the Ring of Charos(a). Ours: only while it is worn. */
const CHAROS_FARE = 10;
const DRAGONTOOTH = Object.freeze({ minX: 3776, maxX: 3812, minY: 3520, maxY: 3584 });
const DRAGONTOOTH_LANDING = Object.freeze([3792, 3559, 0]);
const PORT_PHASMATYS_LANDING = Object.freeze([3702, 3487, 0]);
const OUTBOUND = "After a long boat trip you arrive at Dragontooth Island.";
const RETURN = "After a long boat trip you return to Port Phasmatys.";

let core;
let api;
let ids;

/** Players on a voyage, and where the boat lands them. */
const sailing = new Map();

function atDragontooth(player) {
  const at = player.getLocation();
  return at.getZ() === 0 && at.getX() >= DRAGONTOOTH.minX && at.getX() <= DRAGONTOOTH.maxX
    && at.getY() >= DRAGONTOOTH.minY && at.getY() <= DRAGONTOOTH.maxY;
}

function fade(player, args, caption) {
  const sender = player.getPacketSender();
  sender.mountSubInterface(FADE_UID, FADE_INTERFACE, 1, { postScripts: [{ scriptId: FADE_SCRIPT, args }] });
  player.getFrameUpdater?.()?.clear?.(FADE_CAPTION);
  sender.sendString(caption, FADE_CAPTION);
}

function fare(player) {
  const ring = player.getEquipment().get(core.Equipment.RING_SLOT)?.getId?.();
  return ring === core.ItemIdentifiers.RING_OF_CHAROS_A_ || ring === core.ItemIdentifiers.RING_OF_CHAROS_A__2 ? CHAROS_FARE : FARE;
}

function canAfford(player) {
  return atDragontooth(player) || player.getInventory().getAmount(ids.ECTO_TOKEN) >= fare(player);
}

/** Sails to the other end of the route; false (nothing taken) when the fare can't be paid. */
function sail(player) {
  if (sailing.has(player)) return true;
  const home = atDragontooth(player);
  if (!home) {
    const cost = fare(player);
    if (player.getInventory().getAmount(ids.ECTO_TOKEN) < cost) return false;
    player.getInventory().deleteNumber(ids.ECTO_TOKEN, cost);
  }
  const landing = home ? PORT_PHASMATYS_LANDING : DRAGONTOOTH_LANDING;
  sailing.set(player, landing);
  const movement = player.getMovementQueue();
  movement.reset().setBlockMovement(true);
  fade(player, FADE_OUT, home ? RETURN : OUTBOUND);
  let ticks = 0;
  const task = new core.Task(1, player, false);
  task.execute = () => {
    ticks++;
    if (!player.isRegistered?.()) {
      task.stop();
      return;
    }
    if (ticks === MOVE_TICKS) {
      player.moveTo(new core.Location(...landing));
      if (!home) api.emitCustomEvent("diary:task", { player, diary: "morytania", task: "travel-to-dragontooth-isle" });
    }
    if (ticks === FADE_IN_TICKS) {
      movement.setBlockMovement(false);
      fade(player, FADE_IN, "");
    }
    if (ticks >= CLOSE_TICKS) {
      player.getPacketSender().closeSubInterface(FADE_UID);
      task.stop();
    }
  };
  const stop = task.stop.bind(task);
  task.stop = () => {
    sailing.delete(player);
    movement.setBlockMovement(false);
    stop();
  };
  core.TaskManager.submit(task);
  return true;
}

/** A logout mid-voyage lands the player where the boat was going. */
function leave({ player }) {
  const landing = sailing.get(player);
  if (!landing) return;
  sailing.delete(player);
  player.getMovementQueue().setBlockMovement(false);
  const at = player.getLocation();
  if (at.getX() !== landing[0] || at.getY() !== landing[1]) player.setLocation(new core.Location(...landing));
}

function attach(registry, shared) {
  api = registry;
  core = registry.core;
  ({ ids } = shared);
}

module.exports = { attach, sail, canAfford, fare, CHAROS_FARE, atDragontooth, leave, OUTBOUND, RETURN, FARE, DRAGONTOOTH_LANDING, PORT_PHASMATYS_LANDING };
