/**
 * Underwater Agility and Thieving: the tears in the sea floor's chests and clams
 * (https://oldschool.runescape.wiki/w/Underwater_Agility_and_Thieving).
 *
 * rsprox captures (231/00712-00715, main game, Thieving 99; 234/03273 and 03299 are Grid Master
 * event worlds, whose searches all succeed, so only their timings are used):
 * - One of the sea floor's 54 chests and clams (the cache's closed locs, 30972 and 30970) is open
 *   at a time, for the player alone: the open loc (30971, 30969) replaces it in their scene for
 *   100 ticks, and about 3 ticks after it closes another opens, chosen at random (the same one can
 *   open again; gaps of 1 to 3 ticks are recorded, 231/00715 t307-308, 231/00714 t98-101). Nobody
 *   else is ever seen in the area, so each player has their own.
 * - Not done: at each new opening live plays the open animation (7674) on 4 to 12 other chests and
 *   clams nearby (231/00714 t99-100, 231/00715 t102, 205, 308).
 * - A hint arrow stands on its west side (height 128), sent again every 3 ticks with
 *   `current_hint_arrow` (varbit 14192) going to 0 and back to 6.
 * - A chest or clam shuts (fossil_loc_clam_shut, 7673) the tick before it closes (231/00713 t81-82,
 *   231/00714 t97-98).
 * - The first search on a dive gives no tears: it answers "You have successfully found an open
 *   chest; the mermaids will reward you from now on." (or clam) and Mairin's "Thanks, you should be
 *   able to get some tears from the next chest!", and that opening then only gives "You'll have to
 *   wait for the next chest or clam to open." (231/00715 t155-165, and every other capture; the
 *   Wiki's "the very first clam or chest will not reward any tears").
 * - Search: human_swim_steal (7707) at once, the outcome a tick later. A success is
 *   human_swim_steal_success (7709), sound 73, a glistening tear and a mermaid's tear, and Agility
 *   and Thieving XP (4.5 each, Wiki); the next search can start a tick after. The first search of
 *   each later opening always succeeds (7 of 7 captured); later ones failed 92 times in 115. A
 *   failure is a nibble: human_swim_steal_fail (7708) a tick after the steal, then
 *   human_swim_steal_fail_end (7710) with the line (spam) a tick later, the next search no sooner
 *   than the tick after that (231/00715 t292-297). 37 of the 92 were "...and lose some breath.",
 *   which takes 2% oxygen.
 * - Wiki: later searches succeed 12.1% of the time at Thieving 1 rising to 16.0% at 99 (the
 *   skilling roll's low 30 / high 40; the captures' 23 in 115 at 99 is within its spread).
 */
const SEARCH = Object.freeze({ STEAL: 7707, FAIL: 7708, SUCCESS: 7709, FAIL_END: 7710, SOUND: 73 });
const CLAM_SHUT = 7673; // fossil_loc_clam_shut
const HINT_VARBIT = 14192; // current_hint_arrow
const HINT_ON = 6;
const HINT_WEST = 3;
const HINT_HEIGHT = 128;
// Ours: no full-inventory search was captured; the game's usual line.
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

/** The dive's first search: the found lines, no tears, and that opening is spent. */
function find(player, state) {
  state.found = true;
  state.spent = state.object;
  player.sendMessage(`You have successfully found an open ${state.spot[0]}; the mermaids will reward you from now on.`);
  const { DialogueChainBuilder, NpcDialogue, NpcIdentifiers } = core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder()
    .add(new NpcDialogue(0, NpcIdentifiers.MAIRIN, FOUND_LINE, undefined, CHAT_HAPPY)));
}

function enter(player) {
  const state = { ticks: 0, found: false, spent: null, searching: false, spot: null, object: null, opensAt: 0 };
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
  if (state.object && state.ticks === state.closesAt - 1) {
    player.getPacketSender().sendObjectAnimation(state.object, new core.Animation(CLAM_SHUT));
  }
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

/** A miss: the fail (7708) now, and a tick later its end (7710) with the nibble; searching again only after. */
function nibble(player, state) {
  const { ChatType, Animation } = core;
  player.performAnimation(new Animation(SEARCH.FAIL));
  shared.later(1, () => {
    state.searching = false;
    if (!player.isRegistered()) return;
    player.performAnimation(new Animation(SEARCH.FAIL_END));
    const breath = Math.random() < TEARS.breathChance;
    player.getPacketSender().sendTypedMessage(ChatType.SPAM, breath ? NIBBLE_BREATH : NIBBLE);
    if (breath && shared.isDiving(player)) shared.changeOxygen(player, -TEARS.breathLoss);
  });
}

function resolveSearch(player, object) {
  const state = states.get(player);
  if (!state) return;
  if (!player.isRegistered() || state.object !== object) {
    state.searching = false;
    return;
  }
  const level = player.getSkillManager().getCurrentLevel(core.Skill.THIEVING);
  const { low, high } = TEARS.searchChance;
  if (!state.searched || Math.random() < chance(low, high, level)) {
    state.searching = false;
    reward(player, state);
  } else {
    nibble(player, state);
  }
}

function search({ player, location }) {
  const state = states.get(player);
  if (!state || !shared.isDiving(player)) return false;
  const [, x, y, z] = state.spot ?? [];
  if (!state.object || state.spent === state.object || location.x !== x || location.y !== y || location.z !== z) {
    player.sendMessage(CLOSED_MESSAGE);
    return true;
  }
  if (state.searching) return true;
  if (!hasRoom(player)) {
    player.sendMessage(FULL_MESSAGE);
    return true;
  }
  if (!state.found) {
    find(player, state);
    return true;
  }
  state.searching = true;
  player.performAnimation(new core.Animation(SEARCH.STEAL));
  const object = state.object;
  shared.later(1, () => resolveSearch(player, object));
  return true;
}

/**
 * Puff: "You depuff the pufferfish, restoring some of your puff." 15% oxygen (rsprox 234/03299
 * t18111: 480 to 630). Live also lets the depuffed fish (NPC 7781) swim off from the player's tile;
 * that isn't done.
 */
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

module.exports = { attach, enter, leave, tick, _test: { states, chance, search, puff } };
