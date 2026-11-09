/**
 * Mor Ul Rek (TzHaar city) area interactions.
 *
 * Cave exit at 2479,5176 > Enter: back into the Karamja volcano dungeon at 2862,9572, beside its
 * cave entrance (rsprox captures, the move on the tick). The rocks up to the surface are
 * Karamja's.
 *
 * Hot vent doors > Pass: the player steps through to the far side in one 2-tile step, as a walk
 * or run (rsprox 224/01437, 235/03870-03891, 236/03958: (2436,5121) -> (2436,5119) through the
 * door at (2436,5120)). The city's music follows from the area as usual.
 */
const CAVE_EXIT_POSITION = { x: 2479, y: 5176, z: 0 };
const VOLCANO_DUNGEON_LANDING = [2862, 9572, 0];

const IGNORE_CLIPPING_FLAG = "movement:ignore-clipping";
const PASS_TICKS = 2;

/** Each player's latest pass, which alone may end the clipping exemption. */
const passes = new WeakMap();

let core;

/** Rotation 0 and 2 doors are passed north-south, 1 and 3 east-west (the cache's placements). */
function passVentDoor({ player, object }) {
  const door = object.getLocation();
  const at = player.getLocation();
  const northSouth = object.getFace() % 2 === 0;
  const beside = (offset) => northSouth
    ? new core.Location(door.getX(), door.getY() + offset, door.getZ())
    : new core.Location(door.getX() + offset, door.getY(), door.getZ());
  // Clicked again while on the door tile itself: carry on to the side that pass was heading for.
  const previous = passes.get(player);
  const onDoor = at.getX() === door.getX() && at.getY() === door.getY();
  const side = onDoor && previous ? -previous.towards
    : Math.sign(northSouth ? at.getY() - door.getY() : at.getX() - door.getX()) || 1;
  const near = beside(side);
  const far = beside(-side);
  const movement = player.getMovementQueue();
  movement.reset();
  // The door blocks its own tile: the steps go straight through it, then clipping is back. Only the
  // latest pass clears the flag, so a second click doesn't lose it to the first one's cleanup. Steps,
  // not a teleport, so a diagonal arrival walks round to the door (a move would drop the queued step).
  player.setFlag(IGNORE_CLIPPING_FLAG, true);
  if (!onDoor && !at.equals(near)) movement.addSteps(near);
  movement.addSteps(far);
  const pass = { towards: -side };
  passes.set(player, pass);
  core.TaskManager.submit(new (class extends core.Task {
    constructor() { super(PASS_TICKS, player, false); }
    execute() { this.stop(); }
    stop() {
      if (passes.get(player) === pass) {
        passes.delete(player);
        player.removeFlag(IGNORE_CLIPPING_FLAG);
      }
      super.stop();
    }
  })());
  return true;
}

function isAt(location, position) {
  return location.x === position.x && location.y === position.y && (location.z ?? 0) === position.z;
}

function exitToVolcano(event) {
  const { player, location } = event;
  if (!isAt(location, CAVE_EXIT_POSITION)) return false;
  player.moveTo(new core.Location(...VOLCANO_DUNGEON_LANDING));
  event.handled = true;
}

module.exports = {
  name: "MorUiRek",
  description: "Mor Ul Rek (the TzHaar city): its cave exit back to the Karamja volcano and its hot vent doors.",
  members: true,
  passVentDoor,
  register(api) {
    core = api.core;
    api.onObjectInteraction("Cave exit", { Enter: exitToVolcano });
    api.onObjectInteraction("Hot vent door", { Pass: passVentDoor });
  },
};
