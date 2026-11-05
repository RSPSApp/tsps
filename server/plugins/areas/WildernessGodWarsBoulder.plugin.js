/**
 * The Strength route into the Wilderness God Wars Dungeon (Wiki, Boulder (Wilderness God Wars Dungeon)): NPC 6621
 * at 3053,10165,3, option Move, 60 Strength which can be boosted, 5.5 Strength XP "only going into the hallway".
 * Behind it a crevice leads down near Armadyl's encampment (loc-teleports, wilderness_gwd_crevice_west).
 *
 * No capture moves it: 1463 only passes it by on the Agility route. So, inferred:
 * - The tiles: the cache's collision has the corridor open at x 3050-3052 and 3055-3057 on y 10165, so a move lands
 *   on the first open tile past the boulder's two.
 * - No animation or sound, and the two lines below are ours.
 * Not modelled: the move is instant, with no freeze check, as the Agility obstacles have none either. The Wiki's
 * changes say the obstacles "can no longer avoid taking damage permanently" and that the boulder "changed how it
 * treats damage that is queued" (2014, 2015), with no detail, so queued damage isn't handled here.
 */
const BOULDER_ID = 6621; // wilderness_gwd_boulder, op1 Move
const LEVEL = 60;
const XP_GOING_IN = 5.5;
const HALLWAY_SIDE = { x: 3052, y: 10165, z: 3 };
const CAVERN_SIDE = { x: 3055, y: 10165, z: 3 };

let core;

function moveBoulder(event) {
  const { npc, player } = event;
  if (npc?.getRealId?.() !== BOULDER_ID || event.clickType !== 1) return;
  event.handled = true;
  const skills = player.getSkillManager();
  if (skills.getCurrentLevel(core.Skill.STRENGTH) < LEVEL) {
    player.sendMessage(`You need a Strength level of ${LEVEL} to move this boulder.`);
    return;
  }
  const goingIn = player.getLocation().getX() >= CAVERN_SIDE.x;
  const to = goingIn ? HALLWAY_SIDE : CAVERN_SIDE;
  player.moveTo(new core.Location(to.x, to.y, to.z));
  if (goingIn) skills.addExperiences(core.Skill.STRENGTH, XP_GOING_IN);
  player.sendMessage("You move the boulder aside and slip past.");
}

module.exports = {
  name: "WildernessGodWarsBoulder",
  members: true,
  register(api) {
    core = api.core;
    api.onNpcInteraction(moveBoulder);
  },
};
