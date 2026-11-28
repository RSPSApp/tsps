/**
 * The members' gate between the zombies and the chaos druids (membergatel/r at 3131-3132,9917) leads into the
 * Wilderness: going north, live first asks with the Wilderness warning (warning 7, wilderness_warningscreen). The
 * gate itself is Doors' pass-through gate (docs/edgeville-dungeon.md).
 *
 * rsprox local 1002252 (rev 242): Open at tick 2395, the screen at 2398 with the gate shut; No (2401) leaves it shut;
 * the next Open (2402) asks again, and Yes (2403) opens the gate and walks the player across the tick after (2404).
 * 1002220 the same. Going south, and with the warning toggled off, the gate opens at once (rev 243 capture).
 */
const Dungeon = require("./Common.EdgevilleDungeon");

/** The warning this gate asks (Wilderness Ditch, cws_warning_7). */
const WILDERNESS_WARNING = 7;
/** The gate's tiles; its wall is their north edge, the Wilderness beyond. */
const GATE_Y = 9917;
const GATE_X = [3131, 3132];
/** Ticks from Yes to the gate opening (2403 -> 2404). */
const OPEN_AFTER_YES_TICKS = 1;

let gateIds = null;

function isGate(objectId, location) {
  gateIds ??= new Set([
    Dungeon.core.CacheDefinitions.getLocId("membergatel"),
    Dungeon.core.CacheDefinitions.getLocId("membergater"),
  ]);
  const x = location?.getX?.() ?? location?.x;
  const y = location?.getY?.() ?? location?.y;
  const z = location?.getZ?.() ?? location?.z ?? 0;
  return gateIds.has(objectId) && y === GATE_Y && z === 0 && GATE_X.includes(x);
}

function openGate(player, object) {
  Dungeon.api.emitCustomEvent("door:open", { player, object, handled: false });
}

/** Opens the gate a tick after Yes, if the player is still beside it and nothing else took over. */
function openAfterYes(player, object) {
  const task = new Dungeon.core.Task(OPEN_AFTER_YES_TICKS, false);
  task.execute = () => {
    task.stop();
    const here = player.getLocation();
    if (player.isRegistered?.() === false || here.getZ() !== 0 || here.getY() !== GATE_Y || !GATE_X.includes(here.getX())) return;
    openGate(player, object);
  };
  Dungeon.core.TaskManager.submit(task);
}

/** "door:toggle": going north, the Wilderness warning first; Yes opens the gate. */
function askBeforeWilderness(request) {
  if (request.handled || !isGate(request.objectId, request.location)) return;
  const { player, object } = request;
  if (player.getLocation().getY() > GATE_Y) return;
  request.handled = true;
  let asked = false;
  const event = {
    player,
    warning: WILDERNESS_WARNING,
    proceed: () => (asked ? openAfterYes(player, object) : openGate(player, object)),
    stayOut: () => {},
  };
  Dungeon.api.emitCustomEvent("warning-screen:show", event);
  asked = true;
  // Warning screens off (that plugin disabled): straight through, as before.
  if (!event.handled) openGate(player, object);
}

module.exports = function attach(api) {
  api.onCustomEvent("door:toggle", askBeforeWilderness);
};
module.exports.askBeforeWilderness = askBeforeWilderness;
module.exports.WILDERNESS_WARNING = WILDERNESS_WARNING;
