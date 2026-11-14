/**
 * Darkmeyer's eastern wall shortcut to Slepe (Wiki: Wall (Darkmeyer), Long rope). docs/darkmeyer-wall.md.
 *
 * Two walls stand side by side, each a multiloc that shows a climbable "Wall" once a long rope is
 * attached: the inner one (darkm_outer_wall_2h_shortcut, varbit darkm_shortcut_inner) and the outer
 * one (darkm_outer_wall_3h_shortcut, varbit darkm_shortcut_outer). Using a long rope on a wall
 * without one attaches it for good: the rope goes, the wall's varbit goes to 1 and a message box
 * says "You attach the rope to the wall." (rsprox captures 362 and 1862, the inner wall with
 * human_pickuptable, the outer with human_pickupfloor). The Wiki: attaching needs no Agility.
 * A wall that already has its rope is left to the game's "Nothing interesting happens." (rec 362).
 * The climbs are Agility shortcuts (63 Agility) in plugins/skills/data/agility-shortcuts.json.
 */
const ROPES_ATTRIBUTE = "darkmeyer-wall:ropes";

const ROPE_NAME = "Long rope";
const WALL_NAME = "Wall";
const ATTACHED = "You attach the rope to the wall.";

/** Each wall's multiloc gameval, the bit it keeps in ROPES_ATTRIBUTE, its varbit and the attaching animation. */
const WALLS = Object.freeze([
  { loc: "darkm_outer_wall_2h_shortcut", bit: 1, varbit: "darkm_shortcut_inner", animation: "human_pickuptable" },
  { loc: "darkm_outer_wall_3h_shortcut", bit: 2, varbit: "darkm_shortcut_outer", animation: "human_pickupfloor" },
]);

let core = null;

function wallOf(objectId) {
  return WALLS.find((wall) => core.CacheDefinitions.getLocId(wall.loc) === objectId) ?? null;
}

function ropes(player) {
  const value = Number(player.getAttribute(ROPES_ATTRIBUTE));
  return Number.isInteger(value) && value > 0 ? value : 0;
}

function hasRope(player, wall) {
  return (ropes(player) & wall.bit) !== 0;
}

function sendWall(player, wall) {
  const id = core.CacheDefinitions.getVarbitId(wall.varbit);
  if (id != null) player.getPacketSender().sendVarbit(id, hasRope(player, wall) ? 1 : 0);
}

function restoreWalls({ player }) {
  for (const wall of WALLS) {
    if (hasRope(player, wall)) sendWall(player, wall);
  }
}

function attachRope(event) {
  const { player } = event;
  const wall = wallOf(event.objectId);
  if (!wall || hasRope(player, wall)) return false;
  // Only a rope still in the used slot can be attached; one dropped or banked on the way is gone.
  if (player.getInventory().getItems()[event.itemSlot]?.getId() !== event.itemId) return true;
  player.getInventory().delete(event.itemId, 1);
  player.setAttribute(ROPES_ATTRIBUTE, ropes(player) | wall.bit);
  sendWall(player, wall);
  const animation = core.CacheDefinitions.getSeqId(wall.animation);
  if (animation != null) player.performAnimation(new core.Animation(animation));
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(new core.StatementDialogue(0, ATTACHED)));
  return true;
}

module.exports = {
  name: "DarkmeyerWall",
  description: "Darkmeyer's eastern wall shortcut: a long rope used on each wall attaches it for good, so the wall can be climbed (63 Agility).",
  members: true,
  _test: { attachRope, restoreWalls, ROPES_ATTRIBUTE, WALLS },
  register(api) {
    core = api.core;
    api.persistAttribute(ROPES_ATTRIBUTE, 0);
    api.onPlayerLogin(restoreWalls);
    api.onItemOnObject(ROPE_NAME, WALL_NAME, attachRope, { noted: false });
  },
};
