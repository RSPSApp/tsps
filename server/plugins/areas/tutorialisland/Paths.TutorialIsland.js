/**
 * Getting from one instructor to the next: the doors and gates (each completes the step whose
 * arrow points at it), the ladders down to the mine and up from the combat area, the bank booth
 * and the poll booth.
 *
 * The tutorial's doors and gates never stay open, as captured: clicking one walks the player
 * through while its open leaves show for a moment, then it is closed again (data `passages`).
 */
const T = require("./Common.TutorialIsland");
const ObstacleRunner = require("../../skills/agility/ObstacleRunner.Agility");

const { STEP } = T;
/** Step a door or gate completes -> the step after it. The door is the one the step's arrow marks. */
const DOOR_STEPS = Object.freeze({
  [STEP.GIELINOR_DOOR]: STEP.SURVIVAL_TALK,
  [STEP.SURVIVAL_GATE]: STEP.CHEF_DOOR,
  [STEP.CHEF_DOOR]: STEP.CHEF_TALK,
  [STEP.CHEF_EXIT]: STEP.QUEST_DOOR,
  [STEP.QUEST_DOOR]: STEP.QUEST_TALK,
  [STEP.MINING_GATE]: STEP.COMBAT_TALK,
  [STEP.BANK_DOOR]: STEP.ACCOUNT_TALK,
  [STEP.ACCOUNT_DOOR]: STEP.PRAYER_TALK,
  [STEP.PRAYER_DOOR]: STEP.MAGIC_TALK,
  [STEP.ENTER_RAT_PEN]: STEP.ATTACK_RAT,
});
/** A wall on side `rotation` of its tile leads to the tile this way (0 west, 1 north, 2 east, 3 south). */
const WALL_SIDE = [[-1, 0], [0, 1], [1, 0], [0, -1]];
/** Wiki transcript lines for leaving a section early. */
const NOT_YET = Object.freeze({
  gielinor: "You need to talk to the Gielinor Guide before you are allowed to proceed through this door.",
  survival: "You need to talk to the Survival Guide and complete her tasks before you are allowed to proceed through this gate.",
  chef: "You need to finish the Master Chef's tasks first.",
  mining: "You need to finish with Mining and Smithing first.",
  account: "You need to talk to the Account Guide before you are allowed to proceed through this door.",
  prayer: "You need to finish Brother Brace's tasks before you are allowed to proceed through this door.",
});
const NOT_READY_FOR_COMBAT = "You're not ready to continue yet. You need to know about combat before you go on.";
/** Ladder animations (human_pickupfloor going down, human_reachforladder going up), as captured. */
const CLIMB_DOWN_ANIMATION = 827;
const CLIMB_UP_ANIMATION = 828;

let Objects, core, exits, doorIds, passages;
/** Passages showing their open leaves right now. */
const opening = new Set();

/** The arrow's tile for a door step, so only the marked door (or its gate leaf) completes it. */
function marks(stepValue, location) {
  const tile = T.step(stepValue)?.arrow?.tile;
  const x = Array.isArray(location) ? location[0] : location?.getX?.() ?? location?.x;
  const y = Array.isArray(location) ? location[1] : location?.getY?.() ?? location?.y;
  return tile && Math.abs(x - tile[0]) <= 1 && Math.abs(y - tile[1]) <= 1;
}

function wall(leaf, type = 0) {
  return new core.GameObject(leaf.id, new core.Location(leaf.tile[0], leaf.tile[1], 0), type, leaf.rotation, null);
}

/** Shows a passage's open leaves for a moment, then closes it again. */
function swing(passage) {
  if (opening.has(passage)) return;
  opening.add(passage);
  for (const leaf of passage.closed) core.ObjectManager.deregister(wall(leaf), true);
  for (const leaf of passage.open) core.ObjectManager.register(wall(leaf), true);
  T.later(T.data.passages.ticks, () => {
    for (const leaf of passage.open) core.ObjectManager.deregister(wall(leaf), true);
    for (const leaf of passage.closed) core.ObjectManager.register(wall(leaf), true);
    opening.delete(passage);
  });
}

/** The two tiles a leaf joins: its own and the one across its wall. */
function sides(leaf) {
  const [dx, dy] = WALL_SIDE[leaf.rotation & 3];
  return [leaf.tile, [leaf.tile[0] + dx, leaf.tile[1] + dy]];
}

/** Walks the player through the clicked leaf, opening and closing the passage around them. */
function walkThrough(player, passage, leaf) {
  const at = player.getLocation();
  const [own, across] = sides(leaf);
  // Which side of the wall the player is on, wherever beside the door the click left them.
  const [dx, dy] = WALL_SIDE[leaf.rotation & 3];
  const beyond = (at.getX() - own[0]) * dx + (at.getY() - own[1]) * dy > 0;
  const [from, to] = beyond ? [across, own] : [own, across];
  const on = (tile) => at.getX() === tile[0] && at.getY() === tile[1];
  const path = on(from) ? [to] : [from, to];
  const current = T.progress(player);
  player.getPacketSender().sendSound(passage.sound, 1, 0);
  swing(passage);
  ObstacleRunner.run({ player }, [{ walk: path }], {
    onFinish: () => {
      const next = DOOR_STEPS[current];
      if (next !== undefined && T.progress(player) === current && marks(current, leaf.tile)) T.setProgress(player, next);
    },
  });
}

// Doors.plugin.js emits this before opening a door: the tutorial's own doors are passed, not opened.
function onDoorToggle(request) {
  const { player, objectId, location } = request;
  if (!doorIds.has(objectId) || !T.inTutorial(location)) return;
  const x = location?.getX?.() ?? location?.x;
  const y = location?.getY?.() ?? location?.y;
  for (const passage of passages) {
    const leaf = passage.closed.find((closed) => closed.id === objectId && closed.tile[0] === x && closed.tile[1] === y);
    if (!leaf) continue;
    request.handled = true;
    if (!ObstacleRunner.isBusy(player)) walkThrough(player, passage, leaf);
    return;
  }
}

function climb(player, animation, to, then) {
  player.performAnimation(new core.Animation(animation));
  T.later(1, () => {
    player.moveTo(to);
    then?.();
  });
}

function ladder(player, event) {
  const current = T.progress(player);
  const { Location } = core;
  switch (event.objectId) {
    case Objects.LADDER_88: // quest guide's ladder down to the mine
      if (current < STEP.QUEST_LADDER) player.sendMessage("I don't think you're ready to go down there yet.");
      else climb(player, CLIMB_DOWN_ANIMATION, new Location(3088, 9520, 0), () => T.advance(player, STEP.MINING_TALK));
      break;
    case Objects.LADDER_87: // mine ladder up
      climb(player, CLIMB_UP_ANIMATION, new Location(3088, 3120, 0));
      break;
    case Objects.LADDER_89: // combat area ladder up to the bank
      if (current < STEP.COMBAT_LADDER) T.showBoxes(player, [{ npc: T.IDS.COMBAT_INSTRUCTOR[0], text: NOT_READY_FOR_COMBAT }]);
      else climb(player, CLIMB_UP_ANIMATION, new Location(3111, 3127, 0), () => T.advance(player, STEP.OPEN_BANK));
      break;
    case Objects.LADDER_90: // surface ladder down to the combat area
      climb(player, CLIMB_DOWN_ANIMATION, new Location(3111, 9527, 0));
      break;
    default:
      return;
  }
  event.handled = true;
}

function openBank(player, event) {
  if (T.progress(player) < STEP.OPEN_BANK) {
    player.sendMessage(NOT_READY_FOR_COMBAT);
    event.handled = true;
    return;
  }
  T.giveBankCoins(player);
  T.advance(player, STEP.POLL_BOOTH);
  // The bank booth plugin opens the bank.
}

function pollBooth(player, event) {
  if (T.progress(player) < STEP.POLL_BOOTH) return;
  event.handled = true;
  const { pollBooth: lines, pollBoothItem } = T.data.messages;
  T.showBoxes(player, [{ text: lines[0] }, { text: lines[1] }, { item: pollBoothItem, text: lines[2] }],
    () => T.advance(player, STEP.BANK_DOOR));
}

function onObject(event) {
  const player = event.player;
  if (!player || !T.isActive(player) || !T.inTutorial(event.location)) return;
  const id = event.objectId;
  const exit = exits.get(id);
  if (exit && T.progress(player) < exit.need) {
    player.sendMessage(NOT_YET[exit.who]);
    event.handled = true;
    return;
  }
  if (id === Objects.BANK_BOOTH_7) return openBank(player, event);
  if (id === T.data.objects.pollBooth) return pollBooth(player, event);
  if ([Objects.LADDER_87, Objects.LADDER_88, Objects.LADDER_89, Objects.LADDER_90].includes(id)) ladder(player, event);
}

module.exports = function attach(api) {
  core = api.core;
  Objects = core.ObjectIdentifiers;
  passages = T.data.passages.doors;
  doorIds = new Set(passages.flatMap((passage) => passage.closed.map((leaf) => leaf.id)));
  /** Section exits and the step that opens them. */
  exits = new Map([
    [Objects.DOOR_223, { need: STEP.GIELINOR_DOOR, who: "gielinor" }],
    [Objects.GATE_90, { need: STEP.SURVIVAL_GATE, who: "survival" }],
    [Objects.GATE_91, { need: STEP.SURVIVAL_GATE, who: "survival" }],
    [Objects.DOOR_226, { need: STEP.CHEF_EXIT, who: "chef" }],
    [Objects.GATE_92, { need: STEP.MINING_GATE, who: "mining" }],
    [Objects.GATE_93, { need: STEP.MINING_GATE, who: "mining" }],
    [Objects.DOOR_229, { need: STEP.ACCOUNT_DOOR, who: "account" }],
    [Objects.DOOR_230, { need: STEP.PRAYER_DOOR, who: "prayer" }],
  ]);
  api.onObjectInteraction(onObject);
  api.onCustomEvent("door:toggle", onDoorToggle);
};
