/**
 * The Catacombs of Kourend (https://oldschool.runescape.wiki/w/Catacombs_of_Kourend): the
 * statue of King Rada I in Kourend Castle's courtyard, and the vine ladder back up from where it
 * lands you (docs/catacombs-of-kourend.md).
 *
 * - Investigate (rsprox captures): the player faces the statue, kneels (human_pickupfloor) with
 *   "You investigate what looks like hinges...", then "You climb down the hole." as the screen
 *   fades, lands at (1666, 10050) and the screen fades back in.
 * - Read (rsprox captures): the scroll "Kourend the Magnificent" (longscroll).
 * - The vine ladder beside the landing climbs back to the statue's east side. Not captured: the
 *   ladder animation and the tile are ours.
 *
 * Under areas/ so the vine ladder's handler runs before objects/Ladders, which finds no floor above.
 */
const STATUE = { x: 1634, y: 3671, size: 5 };
const LANDING = [1666, 10050, 0];
const VINE_LADDER = { x: 1666, y: 10051, z: 0 };
const STATUE_EAST_SIDE = [1639, 3673, 0];

const PICKUP_FLOOR = 827; // human_pickupfloor
const READ_SCROLL = 2171; // human_use_wom_telecope
const CLIMB_LADDER = 828; // human_reachforladder

const HINGES = "You investigate what looks like hinges on the plaque and find it opens.";
const CLIMB_DOWN = "You climb down the hole.";

const LONGSCROLL = 625;
const LONGSCROLL_SETUP = 418;
const SCROLL_TITLE = "Kourend the Magnificent";
const SCROLL_TEXT = [
  "Kourend the magnificent,", "Kourend the resplendent,", "Kourend, the most powerful", "of the nations in the world.", "",
  "Kourend is our citadel,", "Kourend is our homeland.", "We will live and die for Kourend,", "for the kingdom of our birth.", "",
  "From the rugged mountains,", "to the foaming seas,", "here we make our home in Kourend,", "all together, all in peace.", "",
  "Kourend is a monument,", "Kourend is a triumph;", "it shall stand here forever", "in the shadow of our King.",
].join("<br>");

const OVERLAY_ATMOSPHERE_UID = (161 << 16) | 1;
const FADE_OVERLAY = 174;
const FADE_SCRIPT = 948;
const FADE_CYCLES = 50;
const MINIMAP_STATE_VARBIT = 6719;
const MINIMAP_OFF = 2;

let core = null;

const isStatue = (location) => location?.x === STATUE.x && location?.y === STATUE.y;

function statueCentre() {
  const half = Math.floor(STATUE.size / 2);
  return new core.Location(STATUE.x + half, STATUE.y + half, 0);
}

function fade(player, out) {
  const args = out ? [0, 255, 0, 0, FADE_CYCLES] : [0, 0, 0, 255, FADE_CYCLES];
  player.getPacketSender().sendSubInterface(OVERLAY_ATMOSPHERE_UID, FADE_OVERLAY, 1, {
    postScripts: [{ scriptId: FADE_SCRIPT, args }],
  });
}

/**
 * Runs `steps` (ticks from the click -> actions) with the player's movement blocked until the
 * last; stops if the player leaves or dies. Tick 0 runs now. Captured ticks count from the
 * player's arrival, and the click is handled a tick after it.
 */
function run(player, steps) {
  const { Task, TaskManager } = core;
  const movement = player.getMovementQueue();
  if (movement.isMovementBlocked()) return false;
  const last = Math.max(...steps.keys());
  let tick = 0;
  const runTick = () => (steps.get(tick) ?? []).forEach((step) => step());
  movement.setBlockMovement(true).reset();
  runTick();
  TaskManager.submit(new (class extends Task {
    constructor() { super(1, player, false); }
    execute() {
      tick++;
      if (!player.isRegistered() || player.getHitpoints() <= 0) {
        this.stop();
        return;
      }
      runTick();
      if (tick >= last) this.stop();
    }
    stop() {
      movement.setBlockMovement(false);
      super.stop();
    }
  })());
  return true;
}

function travel(player, [x, y, z], moveTick, steps) {
  const at = (tick, step) => steps.set(tick, [...(steps.get(tick) ?? []), step]);
  at(moveTick - 2, () => fade(player, true));
  at(moveTick - 1, () => player.getPacketSender().sendVarbit(MINIMAP_STATE_VARBIT, MINIMAP_OFF));
  at(moveTick, () => player.moveTo(new core.Location(x, y, z)));
  at(moveTick + 2, () => {
    player.getPacketSender().sendVarbit(MINIMAP_STATE_VARBIT, 0);
    fade(player, false);
  });
  at(moveTick + 4, () => player.getPacketSender().closeSubInterface(OVERLAY_ATMOSPHERE_UID));
  return steps;
}

/** Investigate: arrival +1 face, +2 kneel and hinges, +3 climb down and fade, +5 land, +7 fade in. */
function investigate(event) {
  const { player, location } = event;
  if (!isStatue(location)) return false;
  const steps = new Map([
    [0, [() => player.setPositionToFace(statueCentre())]],
    [1, [() => {
      player.performAnimation(new core.Animation(PICKUP_FLOOR));
      player.sendMessage(HINGES);
    }]],
    [2, [() => player.sendMessage(CLIMB_DOWN)]],
  ]);
  run(player, travel(player, LANDING, 4, steps));
  return true;
}

/** Read: arrival +2 the reading animation, +3 the scroll. */
function read(event) {
  const { player, location } = event;
  if (!isStatue(location)) return false;
  run(player, new Map([
    [0, [() => player.setPositionToFace(statueCentre())]],
    [1, [() => player.performAnimation(new core.Animation(READ_SCROLL))]],
    [2, [() => {
      const sender = player.getPacketSender();
      sender.sendInterface(LONGSCROLL);
      sender.sendClientScript(LONGSCROLL_SETUP, SCROLL_TITLE, SCROLL_TEXT);
    }]],
  ]));
  return true;
}

/** The vine ladder by the landing: back up beside the statue. */
function climbUp(event) {
  const { player, location } = event;
  if (location?.x !== VINE_LADDER.x || location?.y !== VINE_LADDER.y || (location?.z ?? 0) !== VINE_LADDER.z) return false;
  const steps = new Map([[0, [() => player.performAnimation(new core.Animation(CLIMB_LADDER))]]]);
  run(player, travel(player, STATUE_EAST_SIDE, 2, steps));
  return true;
}

module.exports = {
  name: "CatacombsOfKourend",
  members: true,
  register(api) {
    core = api.core;
    api.onObjectInteraction("Statue", { Investigate: investigate, Read: read });
    api.onObjectInteraction("Vine ladder", { "Climb-up": climbUp });
  },
};
