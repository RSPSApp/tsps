/**
 * The ogres Watchtower's chiefs keep, which only fight when a chief calls them (Og's and Grew's "Guards!").
 *
 * The Wiki's Ogre page gives one infobox for ids 136, 2095 and 2096 with "Aggressive: Yes (depends on
 * location)", so the monster dump marks all three aggressive. The Watchtower capture (Watchtower.bin, revision
 * 242.1) tells them apart: the ogre2 (2096) spawns are Og's four in the ruins north-west of Yanille, Grew's four on
 * his island, the four on Toban's and Gorad's island and three in Gu'Tanoth, and none of them attacks the player
 * unprovoked in the whole run (around Og t1000-1050 and t1160-1180, Grew t1220-1260 and t1700-1780, the island
 * t1400-1530, Gu'Tanoth t2200-2720 and after): they attack only after Og's and Grew's calls (t1053, t1226). The plain
 * ogres (2095) beside them hunt the player: west of Yanille at t1266 and t1693, in Gu'Tanoth at t2487 and t2524.
 *
 * So, where those ogres stand, an ogre2 does not hunt; the chiefs' calls still send one (Watchtower.Quest.js).
 */
module.exports = function createWatchtowerOgres(api) {
  const { Area, Boundary } = api.core;

  /** ogre2: the chiefs' ogres (cache name "Ogre", like 2095). */
  const CHIEFS_OGRE = 2096;
  /** Each camp with room for its ogres' wander and aggression ranges (wander 5 + aggression range 8 from each spawn), so a player at the edge is covered too. */
  const CAMPS = [
    new Boundary(2489, 2521, 3095, 3132, 0), // Og's ruins (spawns 2502-2508, 3108-3119)
    new Boundary(2496, 2527, 3068, 3100, 0), // Grew's island (2509-2514, 3081-3087)
    new Boundary(2495, 2591, 3005, 3065, 0), // Gu'Tanoth (2510-2526, 3039-3046) and Toban's island (2571-2578, 3024-3031)
  ];

  class WatchtowerOgreCamps extends Area {
    getName() { return "Watchtower ogre camps"; }

    npcAggression(player, npc) {
      return npc.getId() === CHIEFS_OGRE ? false : null;
    }
  }

  function register() {
    api.registerArea(new WatchtowerOgreCamps(CAMPS));
  }

  return { register, CHIEFS_OGRE, CAMPS };
};
