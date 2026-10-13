/**
 * The river event (Wiki, "Puzzle events"; captured on both directions): a river with no
 * bridge. A knife cuts three short vines from the small swamp tree, which twist into a long
 * vine; thrown over the big tree's branch it swings player and follower across to the success
 * path. A backpack by the river holds a knife for anyone without one. Worth 500 points.
 */
const Common = require("./Common.TempleTrekking");
const Trek = require("./Trek.TempleTrekking");

const SLICE_ANIMATION = 3747;
const SLICE_SOUND = 2503;
const SLICE_TICKS = 2;
const TWIST_ANIMATION = 3740;
const TWIST_SOUND = 1807;
const TWIST_TICKS = 3;
const VINES_NEEDED = 3;
const LASSO_ANIMATION = 3739;
const LASSO_SOUND = 1806;
const LASSO_TICKS = 3;
const SWING_ANIMATION = 751;
const SWING_SOUND = 2494;
const SWING_LOC_ANIMATION = 497;
const FOLLOWER_SWING_TICKS = 7;

function start(trek, room) {
  const { spec } = room;
  const [x, y, face] = spec.rucksack;
  trek.setLoc(Common.data.locs.templetrek_swing_rucksack, [x, y, 0], 10, face);
  room.points = Common.data.points.puzzle;
  room.state = { vineStage: 0, rucksackKnife: true };
  const back = Common.data.dialogue[trek.direction].backTo;
  Common.chat(trek.player, [
    ["npc", trek.follower.id, `Well that's torn it... Looks like we can't get over this bog. We'll have to go back to ${back}.`],
    ["player", "Oh, I'm sure we can find a way through!"],
  ]);
}

function riverTrek(player) {
  const trek = Trek.trekOf(player);
  return trek?.room?.key === "river" ? trek : null;
}

function search(event) {
  const trek = riverTrek(event.player);
  if (!trek) return false;
  const { player, room } = trek;
  if (room.state.rucksackKnife && !player.getInventory().contains(Common.data.items.knife)) {
    if (player.getInventory().getFreeSlots() < 1) {
      player.sendMessage("You don't have enough inventory space.");
      return true;
    }
    room.state.rucksackKnife = false;
    player.getInventory().adds(Common.data.items.knife, 1);
    player.sendMessage("You find a knife in the backpack.");
    return true;
  }
  player.sendMessage("The backpack seems to be empty.");
  return true;
}

/** Each cut takes a vine and moves the tree on: vines, fewer vines, none. */
function cutVine(event) {
  const trek = riverTrek(event.player);
  if (!trek) return false;
  const { player, room } = trek;
  const trees = Common.data.locs.templetrek_swamptree_small;
  if (!player.getInventory().contains(Common.data.items.knife)) {
    player.sendMessage("You need a knife to cut a vine from the tree.");
    return true;
  }
  if (room.state.cutting || room.state.vineStage >= trees.length - 1) return true;
  room.state.cutting = true;
  player.performAnimation(new Common.core.Animation(SLICE_ANIMATION));
  Common.sound(player, SLICE_SOUND);
  player.sendMessage("You slice a vine from the tree.");
  trek.schedule(SLICE_TICKS, () => {
    room.state.cutting = false;
    room.state.vineStage++;
    const [x, y, face] = room.spec.tree;
    trek.setLoc(trees[room.state.vineStage], [x, y, 0], 10, face);
    const { items } = Common.data;
    if (player.getInventory().getFreeSlots() > 0) player.getInventory().adds(items.templetrek_short_vine, 1);
    else Common.api.getItemOnGroundManager().registerLocation(player, new Common.core.Item(items.templetrek_short_vine, 1), player.getLocation());
  });
  return true;
}

function twistVines(event) {
  const { player } = event;
  const { items } = Common.data;
  if (event.usedItemId !== items.templetrek_short_vine || event.usedWithItemId !== items.templetrek_short_vine) return;
  event.handled = true;
  if (player.getInventory().getAmount(items.templetrek_short_vine) < VINES_NEEDED) {
    player.sendMessage("You need three short vines to make a long vine.");
    return;
  }
  player.performAnimation(new Common.core.Animation(TWIST_ANIMATION));
  Common.sound(player, TWIST_SOUND);
  Common.later(TWIST_TICKS, () => {
    if (!player.isRegistered() || player.getInventory().getAmount(items.templetrek_short_vine) < VINES_NEEDED) return;
    player.getInventory().deleteNumber(items.templetrek_short_vine, VINES_NEEDED);
    player.getInventory().adds(items.templetrek_long_vine, 1);
    Common.itemStatement(player, items.templetrek_long_vine, "You twist the vines together to make a long vine.");
  });
}

function throwVine(event) {
  const trek = riverTrek(event.player);
  if (!trek || event.itemId !== Common.data.items.templetrek_long_vine) return;
  if ((event.objectId ?? event.object?.getId?.()) !== Common.data.locs.templetrek_swamptree_branch) return;
  event.handled = true;
  const { player, room } = trek;
  if (room.state.vine) return;
  player.performAnimation(new Common.core.Animation(LASSO_ANIMATION));
  Common.sound(player, LASSO_SOUND);
  trek.schedule(LASSO_TICKS, () => {
    if (!player.getInventory().contains(Common.data.items.templetrek_long_vine)) return;
    player.getInventory().deleteNumber(Common.data.items.templetrek_long_vine, 1);
    room.state.vine = true;
    player.sendMessage("You throw the vine up and wrap it around the branch.");
    const [x, y, face] = room.spec.branch;
    trek.setLoc(Common.data.locs.templetrek_swamptree_branch_vine, [x, y, 0], 10, face);
  });
}

/** Swing-from: the player's exact move across, then the follower follows suit. */
function swing(event) {
  const trek = riverTrek(event.player);
  if (!trek) return false;
  const { player, room } = trek;
  const { Animation, ForceMovement, ForceMovementTask, Location, TaskManager } = Common.core;
  const from = trek.area.at(room.spec.swingFrom);
  const to = trek.area.at(room.spec.swingTo);
  player.moveTo(from);
  player.performAnimation(new Animation(SWING_ANIMATION, 5));
  player.getPacketSender().sendSound(SWING_SOUND, 1, 15);
  const branch = event.object;
  if (branch) player.getPacketSender().sendObjectAnimation(branch, new Animation(SWING_LOC_ANIMATION));
  TaskManager.submit(new ForceMovementTask(player, 2,
    new ForceMovement(from.clone(), new Location(to.getX() - from.getX(), to.getY() - from.getY()), 30, 55, 0, -1)));
  room.complete = true;
  trek.schedule(2, () => {
    Common.chat(player, [["npc", trek.follower.id, "That's amazing! I'll have to do the same."]]);
  });
  trek.schedule(2 + FOLLOWER_SWING_TICKS, () => {
    if (trek.npc?.isRegistered?.()) trek.npc.moveTo(trek.area.at(room.spec.followerAcross));
    Common.chat(player, [["npc", trek.follower.id, "Whahay! That was great! But we really should be heading off now."]]);
  });
  return true;
}

function attachRiver(api) {
  Trek.registerEvent("river", { room: () => Common.data.rooms.river, start });
  api.onObjectInteraction("Backpack", { Search: search });
  api.onObjectInteraction("Swamp tree", { "Cut-vine": cutVine });
  api.onObjectInteraction("Swamp tree branch", { "Swing-from": swing });
  api.onItemOnItem(twistVines);
  api.onItemOnObject(throwVine);
}

module.exports = { attachRiver };
