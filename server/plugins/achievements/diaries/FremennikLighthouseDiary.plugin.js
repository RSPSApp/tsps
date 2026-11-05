/**
 * Fremennik Diary: "Visit the Lighthouse from Waterbirth island."
 *
 * The fifth-sublevel Waterbirth exit is cache loc 10194 ("Ladder", Climb-up, placed at
 * 1975,4408,3). Its captured loc transport (`dagexp_exit_ladder`, rsprox recording) lands the
 * player in the Dagannoth cavern below the Lighthouse at 2506,10018,0; it does not return. The
 * Wiki requires Horror from the Deep both to use that ladder and for the diary task, so the
 * ladder refuses before the quest is done and the credit only fires after the captured move has
 * landed.
 *
 * Sources:
 * - Wiki Fremennik Diary, Medium task 8: "You must exit the Waterbirth Island Dungeon on the 5th
 *   sublevel", requirement "Completion of Horror from the Deep".
 * - Wiki Waterbirth Island Dungeon room 19: "Players must complete Horror from the Deep to use
 *   the ladder, which will send them into the Dagannoth under the Lighthouse."
 * - Wiki Lighthouse: the Waterbirth Island Dungeon has a one-way exit into the Lighthouse Dungeon.
 * - Cache: loc 10194 at 1975,4408,3, ops Climb-up; the captured destination 2506,10018,0 has the
 *   Lighthouse Dagannoth spawns (npc-spawns.json).
 */
const DIARY = "fremennik";
const TASK = "visit-the-lighthouse-from-waterbirth-island";
const HORROR_FROM_THE_DEEP = "horror_from_the_deep";

/** Ladder out of the Waterbirth dungeon's fifth sublevel into the Lighthouse dungeon. */
const EXIT_LADDER_ID = 10194;
const EXIT_LADDER_TILE = { x: 1975, y: 4408, z: 3 };
/** Captured landing in the Dagannoth cavern below the Lighthouse. */
const LIGHTHOUSE_DUNGEON = { minX: 2500, maxX: 2515, minY: 10010, maxY: 10030, z: 0 };

let api;

function active(player) {
  return player?.isRegistered?.() === true && player.getHitpoints?.() > 0
    && player.isDyingReturn?.() !== true && player.getPrivateArea?.() == null;
}

function questComplete(player, key) {
  const request = { player, key, complete: null };
  api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

function atExitLadder(event) {
  if (event.objectId !== EXIT_LADDER_ID) return false;
  const location = event.object?.getLocation?.() ?? event.location;
  return location?.getX?.() === EXIT_LADDER_TILE.x
    && location?.getY?.() === EXIT_LADDER_TILE.y
    && location?.getZ?.() === EXIT_LADDER_TILE.z;
}

/** Before the generic loc transport: the Wiki gates this ladder on Horror from the Deep. */
function gateLadder(event) {
  if (event.handled || !atExitLadder(event)) return;
  const { player } = event;
  if (!active(player) || questComplete(player, HORROR_FROM_THE_DEEP)) return;
  event.handled = true;
  player.sendMessage("You must complete Horror from the Deep before you can use this ladder.");
}

/** After the captured transport lands: award the task only from the fifth-sublevel exit. */
function arrived({ player, objectId, location }) {
  if (objectId !== EXIT_LADDER_ID || !active(player)) return;
  if (!location || location.x !== EXIT_LADDER_TILE.x || location.y !== EXIT_LADDER_TILE.y
    || location.z !== EXIT_LADDER_TILE.z) return;
  const landing = player.getLocation();
  if (landing.getZ() !== LIGHTHOUSE_DUNGEON.z
    || landing.getX() < LIGHTHOUSE_DUNGEON.minX || landing.getX() > LIGHTHOUSE_DUNGEON.maxX
    || landing.getY() < LIGHTHOUSE_DUNGEON.minY || landing.getY() > LIGHTHOUSE_DUNGEON.maxY) return;
  if (!questComplete(player, HORROR_FROM_THE_DEEP)) return;
  api.emitCustomEvent("diary:task", { player, diary: DIARY, task: TASK });
}

module.exports = {
  name: "FremennikLighthouseDiary",
  members: true,
  dependsOn: ["AchievementDiaries"],
  register(registry) {
    api = registry;
    api.onBeforeObjectInteraction(gateLadder);
    api.onCustomEvent("loc-teleports:arrived", arrived);
  },
  _test: { atExitLadder, gateLadder, arrived, EXIT_LADDER_ID, EXIT_LADDER_TILE, LIGHTHOUSE_DUNGEON },
};
