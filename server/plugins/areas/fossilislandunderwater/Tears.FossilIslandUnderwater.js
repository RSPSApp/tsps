/**
 * Underwater Agility and Thieving: the tears in the sea floor's chests and clams
 * (https://oldschool.runescape.wiki/w/Underwater_Agility_and_Thieving).
 *
 * rsprox captures (231/00712-00715, main game, Thieving 99; 234/03273 and 03299 are Grid Master
 * event worlds, whose searches all succeed, so only their timings are used):
 * - One of the sea floor's 54 chests and clams (the cache's closed locs, 30972 and 30970) is open
 *   at a time, for the player alone: the open loc (30971, 30969) replaces it in their scene for
 *   100 ticks, and 3 ticks after it closes another opens, chosen at random (the same one can open
 *   again). Nobody else is ever seen in the area, so each player has their own.
 * - A hint arrow stands on its west side (height 128), sent again every 3 ticks with
 *   `current_hint_arrow` (varbit 14192) going to 0 and back to 6.
 * - The first time a dive brings the player next to it: "You have successfully found an open chest;
 *   the mermaids will reward you from now on." (or clam), and Mairin's "Thanks, you should be able
 *   to get some tears from the next chest!".
 * - Search: human_swim_steal (7707) at once, the outcome a tick later. A success is
 *   human_swim_steal_success (7709), sound 73, a glistening tear and a mermaid's tear, and Agility
 *   and Thieving XP (4.5 each, Wiki). The first search of each opening always succeeds (7 of 7
 *   captured); later ones failed 92 times in 115. A failure is a nibble (spam): 37 of the 92
 *   "...and lose some breath.", which takes 2% oxygen.
 * - Wiki: later searches succeed 12.1% of the time at Thieving 1 rising to 16.0% at 99 (the
 *   skilling roll's low 30 / high 40; the captures' 23 in 115 at 99 is within its spread).
 */
const SEARCH = Object.freeze({ STEAL: 7707, SUCCESS: 7709, SOUND: 73 });
const HINT_VARBIT = 14192; // current_hint_arrow
const HINT_ON = 6;
const HINT_WEST = 3;
const HINT_HEIGHT = 128;
const FULL_MESSAGE = "You don't have enough inventory space.";
const CLOSED_MESSAGE = "You'll have to wait for the next chest or clam to open.";
const NIBBLE = "You jerk back as something nibbles your hand.";
const NIBBLE_BREATH = "You jerk back as something nibbles your hand and lose some breath.";
const FOUND_LINE = "Thanks, you should be able to get some tears from the next chest!";
const CHAT_HAPPY = 568; // chathap2
const PUFF_ANIMATION = 7701; // human_inhale_pufferfish
const PUFF_MESSAGE = "You depuff the pufferfish, restoring some of your puff.";

let core;
let shared;
let TEARS;
/** player -> { spot, object, closesAt, opensAt, searched, found, searching, ticks } */
const states = new Map();

function spotIds(kind) {
  const { ObjectIdentifiers: O } = core;
  return kind === "clam" ? { open: O.CLAM_2, closed: O.CLAM_3, size: 2 } : { open: O.CHEST_107, closed: O.CHEST_108, size: 1 };
}

function spotObject(spot, open) {
  const [kind, x, y, z, face] = spot;
  const ids = spotIds(kind);
  return new core.GameObject(open ? ids.open : ids.closed, new core.Location(x, y, z), 10, face, null);
}

function sendHint(player, state) {
  const [, x, y, z] = state.spot;
  const sender = player.getPacketSender();
  sender.sendVarbit(HINT_VARBIT, 0);
  sender.sendVarbit(HINT_VARBIT, HINT_ON);
  sender.clearHintArrow();
  sender.sendPositionalHint(new core.Location(x, y, z), HINT_WEST, HINT_HEIGHT, z);
}

function open(player, state) {
  state.spot = TEARS.spots[Math.floor(Math.random() * TEARS.spots.length)];
  state.object = spotObject(state.spot, true).setOwner(player);
  state.searched = false;
  state.closesAt = state.ticks + TEARS.openTicks;
  state.opensAt = null;
  core.ObjectManager.register(state.object, true);
  sendHint(player, state);
}

/**
 * Back to the cache's closed loc: the owned open one goes (a despawn, so it leaves the map's
 * objects too, sent to its owner only) and the closed one is sent in its place.
 */
function close(player, state, clear = false) {
  if (!state.object) return;
  core.ObjectManager.deregister(state.object, true);
  if (player.isRegistered?.()) player.getPacketSender().sendObject(spotObject(state.spot, false));
  state.object = null;
  state.opensAt = state.ticks + TEARS.gapTicks;
  if (clear && player.isRegistered?.()) {
    player.getPacketSender().sendVarbit(HINT_VARBIT, 0);
    player.getPacketSender().clearHintArrow();
  }
}

/** Next to the open loc's footprint, as the captures' "found" lines come (a tile off a chest, the clam's 2x2). */
function besideSpot(player, state) {
  const [kind, x, y, z] = state.spot;
  const { size } = spotIds(kind);
  const location = player.getLocation();
  if (location.getZ() !== z) return false;
  const dx = location.getX() < x ? x - location.getX() : Math.max(0, location.getX() - (x + size - 1));
  const dy = location.getY() < y ? y - location.getY() : Math.max(0, location.getY() - (y + size - 1));
  return Math.max(dx, dy) <= 1;
}

function find(player, state) {
  state.found = true;
  player.sendMessage(`You have successfully found an open ${state.spot[0]}; the mermaids will reward you from now on.`);
  const { DialogueChainBuilder, NpcDialogue, NpcIdentifiers } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder()
    .add(new NpcDialogue(0, NpcIdentifiers.MAIRIN, FOUND_LINE, undefined, CHAT_HAPPY)));
}

function enter(player) {
  const state = { ticks: 0, found: false, searching: false, spot: null, object: null, opensAt: 0 };
  states.set(player, state);
  open(player, state);
}

function leave(player) {
  const state = states.get(player);
  if (!state) return;
  states.delete(player);
  close(player, state, true);
}

/** Every tick a diving player is underwater (FossilIslandUnderwater's tick). */
function tick(player) {
  const state = states.get(player);
  if (!state) return;
  state.ticks++;
  if (state.object && state.ticks >= state.closesAt) close(player, state);
  else if (!state.object && state.opensAt != null && state.ticks >= state.opensAt) open(player, state);
  else if (state.object && state.ticks % TEARS.hintTicks === 0) sendHint(player, state);
  if (state.object && !state.found && besideSpot(player, state)) find(player, state);
}

/** The OSRS skilling roll over levels 1-99 (Wiki: Skilling success rate). */
function chance(low, high, level) {
  const capped = Math.max(1, Math.min(99, level));
  return (1 + Math.floor((low * (99 - capped)) / 98 + (high * (capped - 1)) / 98 + 0.5)) / 256;
}

function hasRoom(player) {
  const { Item, ItemIdentifiers: I } = core;
  const inventory = player.getInventory();
  return [I.GLISTENING_TEAR, I.MERMAIDS_TEAR].every((id) => inventory.getAddableAmount(new Item(id, 1)) > 0);
}

function reward(player, state) {
  const { Skill, ItemIdentifiers: I, Animation } = core;
  player.performAnimation(new Animation(SEARCH.SUCCESS));
  player.getPacketSender().sendSoundEffect(SEARCH.SOUND, 1, 0);
  player.getInventory().adds(I.GLISTENING_TEAR, 1);
  player.getInventory().adds(I.MERMAIDS_TEAR, 1);
  player.getSkillManager().addExperiences(Skill.AGILITY, TEARS.xp);
  player.getSkillManager().addExperiences(Skill.THIEVING, TEARS.xp);
  state.searched = true;
}

function nibble(player) {
  const { ChatType } = core;
  const breath = Math.random() < TEARS.breathChance;
  player.getPacketSender().sendTypedMessage(ChatType.SPAM, breath ? NIBBLE_BREATH : NIBBLE);
  if (breath) shared.changeOxygen(player, -TEARS.breathLoss);
}

function resolveSearch(player, object) {
  const state = states.get(player);
  if (!state) return;
  state.searching = false;
  if (!player.isRegistered() || state.object !== object) return;
  const level = player.getSkillManager().getCurrentLevel(core.Skill.THIEVING);
  const { low, high } = TEARS.searchChance;
  if (!state.searched || Math.random() < chance(low, high, level)) reward(player, state);
  else nibble(player);
}

function search({ player, location }) {
  const state = states.get(player);
  if (!state || !shared.isDiving(player)) return false;
  const [, x, y, z] = state.spot ?? [];
  if (!state.object || location.x !== x || location.y !== y || location.z !== z) {
    player.sendMessage(CLOSED_MESSAGE);
    return true;
  }
  if (state.searching) return true;
  if (!hasRoom(player)) {
    player.sendMessage(FULL_MESSAGE);
    return true;
  }
  if (!state.found) find(player, state);
  state.searching = true;
  player.performAnimation(new core.Animation(SEARCH.STEAL));
  const object = state.object;
  shared.later(1, () => resolveSearch(player, object));
  return true;
}

/** Puff: "You depuff the pufferfish, restoring some of your puff." 15% oxygen (rsprox 715: +150 of 1,000). */
function puff({ player }) {
  if (!shared.isDiving(player)) return false;
  const { ItemIdentifiers: I, Animation } = core;
  player.getInventory().delete(I.PUFFERFISH, 1);
  player.performAnimation(new Animation(PUFF_ANIMATION));
  player.sendMessage(PUFF_MESSAGE);
  shared.changeOxygen(player, TEARS.puff);
  return true;
}
function attach(api, sharedHelpers, data) {
  core = api.core;
  shared = sharedHelpers;
  TEARS = data;
  const { ObjectIdentifiers: O } = core;
  api.onObjectFirstClick([O.CHEST_107, O.CLAM_2], search);
  api.onItemAction("Pufferfish", { Puff: puff });
}

module.exports = { attach, enter, leave, tick, _test: { states, chance, besideSpot, search, puff } };
