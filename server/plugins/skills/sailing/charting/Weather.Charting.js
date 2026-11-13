// Weather trolls (rsprox 939-948, 3467): Meaty Aura Logist, one on each weather task's island,
// hands out a portable weather station (Collect-data, from the deck). Take-reading tells which way
// the wind blows; the winds circle the task's spot, and a reading at the spot fills the station.
// Handing the filled station back to the same troll charts the task (250 XP).
//   Collect-data: the helm let go of, "The troll hands you a portable weather station." with the
//   station, then her "You take my number getter! ..." line. Holding a station already: "You
//   already have number getter. Go find where windys stop!". Under 57 Sailing: "You no good sail
//   her. Windys topple you.". Another troll's station: "Number getter not for here. Dis one go
//   over there."
//   Take-reading away from the spot: "The weather station reads that the wind is blowing toward
//   the <col=3366ff>{direction}</col>." At it: the helm let go of, the filled station in the same
//   slot; +1 the troll animation and the "You find a spot where the winds have dropped..." box.
//   Hand-in: the charting, "You hand over the troll's weather station and she promptly consumes
//   the log book full of data." and her "Numbers so tasty. Weather here must be really good!".
const common = require("./Common.Charting");

const NPC_TROLL = 15154;
const ITEM_EMPTY = 31809;
const ITEM_FULL = 31810;
const SEQ_TROLL = 13303; // human_sailing_charting_troll01
const LEVEL = 57;
const TROLL_NAME = "Meaty Aura Logist";
/** From the deck to a troll on her island: the deck's usual reach (ours; live refuses further off). */
const DECK_REACH = 12;
/** Which task a station belongs to (persisted): the troll it came from. */
const STATION_ATTRIBUTE = "charting:weather-station";
/** How near the spot a reading fills the station (ours: the captures fill 0-8 from the boat's centre). */
const SPOT_RANGE = 5;
/** How far a troll stands from her task's spot (the Wiki's tile; two captured 1 and 3 off). */
const TROLL_RANGE = 4;
/**
 * The winds circle the spot and bend in towards it (ours: the captured readings fit a tangent
 * turned 20-30 degrees inwards best).
 */
const INWARD_DEGREES = 25;
const DIRECTIONS = ["east", "north east", "north", "north west", "west", "south west", "south", "south east"];

const HANDED = "The troll hands you a portable weather station.";
const TAKE_IT = "You take my number getter! Find where windy no do the blowing, and it get numbers. Bring numbers back to me! I try myself, but I just follow wind round in circles. Make sure you no do that!";
const HAVE_ONE = "You already have number getter. Go find where windys stop!";
const TOO_LOW = "You no good sail her. Windys topple you.";
const WRONG_TROLL = "Number getter not for here. Dis one go over there.";
const FOUND = "You find a spot where the winds have dropped. You fill the station's log and your charts with interesting data. You should now return to Meaty Aura Logist where she gave you the weather station.";
const HANDED_BACK = "You hand over the troll's weather station and she promptly consumes the log book full of data.";
const TASTY = "Numbers so tasty. Weather here must be really good!";
const NO_ROOM = "You don't have enough inventory space.";

/** The weather task whose troll stands at (x, y). */
function taskAt(x, y) {
  return common.spotsOfType("weather_troll").find((spot) => spot.location
    && Math.max(Math.abs(spot.location[0] - x), Math.abs(spot.location[1] - y)) <= TROLL_RANGE);
}

function stationTask(player) {
  const key = player.getAttribute(STATION_ATTRIBUTE);
  return typeof key === "string" ? common.spotByKey(key) : undefined;
}

function chain(player, steps) {
  const { DialogueChainBuilder, ItemStatementDialogue, NpcDialogue } = common.core();
  const builder = new DialogueChainBuilder();
  steps.forEach((step, i) => builder.add(step.item
    ? new ItemStatementDialogue(i, step.item, step.text)
    : new NpcDialogue(i, NPC_TROLL, step.text, TROLL_NAME)));
  player.getDialogueManager().startDialogues(builder);
}

function holds(player, id) {
  return player.getInventory().contains(id);
}

function collectData(event) {
  const { player, npc } = event;
  const here = npc.getLocation();
  const spot = taskAt(here.getX(), here.getY());
  if (!spot) return false;
  if (player.getSkillManager().getCurrentLevel(common.core().Skill.SAILING) < LEVEL) {
    chain(player, [{ text: TOO_LOW }]);
    return true;
  }
  const own = stationTask(player);
  if (holds(player, ITEM_FULL) && own === spot) {
    handIn(player, spot);
    return true;
  }
  if (holds(player, ITEM_FULL) || (holds(player, ITEM_EMPTY) && own && own !== spot)) {
    chain(player, [{ text: own && own !== spot ? WRONG_TROLL : HAVE_ONE }]);
    return true;
  }
  if (holds(player, ITEM_EMPTY)) {
    chain(player, [{ text: HAVE_ONE }]);
    return true;
  }
  const station = new (common.core().Item)(ITEM_EMPTY, 1);
  // Ours: a full inventory isn't captured; the troll keeps her station, as the other charting rewards do.
  if (player.getInventory().getAddableAmount(station) < 1) {
    player.sendMessage(NO_ROOM);
    return true;
  }
  common.leaveHelm(player);
  player.getInventory().add(station, true);
  player.setAttribute(STATION_ATTRIBUTE, spot.key);
  chain(player, [{ item: ITEM_EMPTY, text: HANDED }, { text: TAKE_IT }]);
  return true;
}

function handIn(player, spot) {
  common.leaveHelm(player);
  player.getInventory().delete(ITEM_FULL, 1);
  player.setAttribute(STATION_ATTRIBUTE, null);
  common.complete(player, spot, { lines: [] });
  chain(player, [{ item: ITEM_FULL, text: HANDED_BACK }, { text: TASTY }]);
}

/** Which way the wind blows at (x, y): round the spot, bent in towards it, as one of 8 directions. */
function windAt(spot, x, y) {
  const dx = x - spot.location2[0];
  const dy = y - spot.location2[1];
  const clockwise = spot.clockwise !== false;
  const [tx, ty] = clockwise ? [dy, -dx] : [-dy, dx];
  const degrees = (Math.atan2(ty, tx) * 180) / Math.PI + (clockwise ? -INWARD_DEGREES : INWARD_DEGREES);
  return DIRECTIONS[((Math.round(degrees / 45) % 8) + 8) % 8];
}

function takeReading({ player, slot }) {
  const { BoatManager } = common.core();
  const here = BoatManager.getBoatAboard(player) ? BoatManager.rootLocation(player) : player.getLocation();
  const spot = stationTask(player) ?? nearestTask(here);
  if (!spot?.location2) return;
  const distance = Math.max(Math.abs(spot.location2[0] - here.getX()), Math.abs(spot.location2[1] - here.getY()));
  if (distance > SPOT_RANGE) {
    player.sendMessage(`The weather station reads that the wind is blowing toward the <col=3366ff>${windAt(spot, here.getX(), here.getY())}</col>.`);
    return;
  }
  common.leaveHelm(player);
  const inventory = player.getInventory();
  const at = Number.isInteger(slot) && inventory.getItems()[slot]?.getId?.() === ITEM_EMPTY ? slot : inventory.getSlotForItemId(ITEM_EMPTY);
  inventory.setItem(at, new (common.core().Item)(ITEM_FULL, 1));
  inventory.refreshItems();
  player.setAttribute(STATION_ATTRIBUTE, spot.key);
  const { CountdownTask, TaskManager, Animation } = common.core();
  TaskManager.submit(new CountdownTask(player, 1, () => {
    player.performAnimation(new Animation(SEQ_TROLL));
    chain(player, [{ item: ITEM_FULL, text: FOUND }]);
  }));
}

/** A station with no troll of its own (one kept from before): the nearest task's. */
function nearestTask(here) {
  let best;
  let bestDistance = Infinity;
  for (const spot of common.spotsOfType("weather_troll")) {
    if (!spot.location2) continue;
    const distance = Math.max(Math.abs(spot.location2[0] - here.getX()), Math.abs(spot.location2[1] - here.getY()));
    if (distance < bestDistance) {
      best = spot;
      bestDistance = distance;
    }
  }
  return best;
}

/** The trolls stand ashore: from a deck they're used across the water. */
function widenTrollRange(event) {
  if (event.npcId !== NPC_TROLL || !common.core().BoatManager.getBoatAboard(event.player)) return;
  event.range = DECK_REACH;
}

function attach(api) {
  common.init(api);
  api.persistAttribute(STATION_ATTRIBUTE, null);
  api.onNpcRoute(widenTrollRange);
  api.onNpcInteraction(TROLL_NAME, { "Collect-data": collectData });
  api.onItemAction("Portable weather station", { "Take-reading": takeReading });
}

module.exports = attach;
module.exports.windAt = windAt;
module.exports.taskAt = taskAt;
module.exports.collectData = collectData;
module.exports.takeReading = takeReading;
module.exports.STATION_ATTRIBUTE = STATION_ATTRIBUTE;
