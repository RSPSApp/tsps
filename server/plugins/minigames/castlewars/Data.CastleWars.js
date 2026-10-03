"use strict";

/**
 * Castle Wars tables: teams, interfaces, vars, area bounds, routes and supplies.
 * Built once from api.core, because the ids come from the generated identifier classes.
 */

let data = null;

function buildData(core) {
  const { Location, Boundary, PolygonalBoundary, Animation, Equipment, ItemIdentifiers: I, NpcIdentifiers: N, ObjectIdentifiers: O } = core;
  const loc = (x, y, z) => new Location(x, y, z);
  const box = (...args) => new Boundary(...args);
  const TEAM = { SARADOMIN: "saradomin", ZAMORAK: "zamorak" };
  const TEAM_VARBIT = { DOOR_HEALTH: 136, DOOR_UNLOCKED: 137, TUNNEL_NS_CLEAR: 138, TUNNEL_EW_CLEAR: 139, CATAPULT_BROKEN: 140 };

  return Object.freeze({
    TEAM,
    TEAM_DATA: {
      [TEAM.SARADOMIN]: { id: TEAM.SARADOMIN, name: "Saradomin", capeId: I.SARADOMIN_CLOAK_3, hoodId: I.CASTLEWARS_HOOD, bannerId: I.SARADOMIN_BANNER, waitingRoom: loc(2381, 9489, 0), startRoom: loc(2426, 3076, 1), respawnBounds: box(2423, 2431, 3072, 3080, 1), standLocation: loc(2429, 3074, 3), safeStandId: O.SARADOMIN_STANDARD_2, emptyStandId: O.STANDARD_STAND, droppedFlagObjectId: O.SARADOMIN_STANDARD, waitingBounds: [box(2368, 2392, 9481, 9497, 0)] },
      [TEAM.ZAMORAK]: { id: TEAM.ZAMORAK, name: "Zamorak", capeId: I.ZAMORAK_CLOAK_3, hoodId: I.CASTLEWARS_HOOD_2, bannerId: I.ZAMORAK_BANNER, waitingRoom: loc(2421, 9524, 0), startRoom: loc(2372, 3131, 1), respawnBounds: box(2368, 2376, 3127, 3135, 1), standLocation: loc(2370, 3133, 3), safeStandId: O.ZAMORAK_STANDARD_2, emptyStandId: O.STANDARD_STAND_2, droppedFlagObjectId: O.ZAMORAK_STANDARD, waitingBounds: [box(2408, 2432, 9512, 9535, 0)] },
    },
    START_TASK_KEY: "cw.start",
    END_TASK_KEY: "cw.end",
    START_COUNTDOWN_SECONDS: 10,
    GAME_SECONDS: 1200,
    LOBBY_TELEPORT: loc(2440, 3089, 0),
    TAKE_SUPPLY_ANIM: new Animation(881),

    // OSRS interfaces (cache 237). The old 317 ids (11146/11479/...) don't exist in this cache.
    OVERLAY_HUD_UID: (161 << 16) | 8, // component.toplevel_osrs_stretch:overlay_hud
    WAITING_ROOM_INTERFACE: 131, // interface.castlewars_waitingroom
    STATUS_OVERLAY_INTERFACE: { [TEAM.SARADOMIN]: 58, [TEAM.ZAMORAK]: 59 }, // interface.castlewars_status_overlay_*
    EJECT_TEXT_UID: { [TEAM.SARADOMIN]: (58 << 16) | 26, [TEAM.ZAMORAK]: (59 << 16) | 25 },
    // Scores, flag states and the timer are drawn by the cache's own scripts (887/888/2375),
    // so the server only feeds the vars they read.
    TIMER_VARP: 380, // seconds until start in the waiting room, minutes remaining in game
    FLAG_VARBIT: { [TEAM.SARADOMIN]: 143, [TEAM.ZAMORAK]: 153 },
    SCORE_VARBIT: { [TEAM.SARADOMIN]: 145, [TEAM.ZAMORAK]: 155 },
    // Each team's own castle status (main door, side door, tunnels, catapult), read by the same scripts.
    TEAM_VARBIT,
    TEAM_VARBIT_DEFAULTS: { [TEAM_VARBIT.DOOR_HEALTH]: 100 },

    LOBBY_BOUNDS: [box(2435, 2446, 3081, 3098, 0)],
    GAME_BOUNDS: [box(2365, 2404, 9500, 9530, 0), box(2394, 2431, 9474, 9499, 0), box(2405, 2424, 9500, 9509, 0), new PolygonalBoundary([[2377, 3079], [2368, 3079], [2368, 3136], [2416, 3136], [2432, 3120], [2432, 3080], [2432, 3072], [2384, 3072]])],

    MAX_BARRICADES: 10,
    BARRICADE_NPC: { [TEAM.SARADOMIN]: N.BARRICADE, [TEAM.ZAMORAK]: N.BARRICADE_3 },
    BRACELET_NEXT: { [I.CASTLE_WARS_BRACELET_3_]: I.CASTLE_WARS_BRACELET_2_, [I.CASTLE_WARS_BRACELET_2_]: I.CASTLE_WARS_BRACELET_1_, [I.CASTLE_WARS_BRACELET_1_]: -1 },
    CLEANUP_ITEM_IDS: new Set([I.BANDAGES, I.BRONZE_PICKAXE, I.EXPLOSIVE_POTION, I.BARRICADE, I.SARADOMIN_CLOAK_3, I.ZAMORAK_CLOAK_3, I.CASTLEWARS_HOOD, I.CASTLEWARS_HOOD_2, I.SARADOMIN_BANNER, I.ZAMORAK_BANNER, I.ROCK_5, I.TINDERBOX, I.ROPE, I.TOOLKIT_2]),
    DEATH_REMOVE_ITEM_IDS: new Set([I.BANDAGES, I.BRONZE_PICKAXE, I.EXPLOSIVE_POTION, I.BARRICADE, I.ROCK_5, I.TINDERBOX, I.ROPE, I.TOOLKIT_2, I.SARADOMIN_BANNER, I.ZAMORAK_BANNER]),
    TEAM_COLOUR_SLOTS: new Set([Equipment.CAPE_SLOT, Equipment.HEAD_SLOT]),
    ENEMY_SPAWN_MESSAGE: "You are not allowed in the other team's spawn point.",

    LOBBY_TEAMS: { [O.ZAMORAK_PORTAL]: TEAM.ZAMORAK, [O.SARADOMIN_PORTAL]: TEAM.SARADOMIN, [O.GUTHIX_PORTAL]: null },
    WAITING_EXIT_IDS: new Set([O.PORTAL_8, O.PORTAL_9]),
    GAME_EXIT_IDS: new Set([O.PORTAL_10, O.PORTAL_11]),
    STAND_TEAMS: { [O.SARADOMIN_STANDARD_2]: TEAM.SARADOMIN, [O.STANDARD_STAND]: TEAM.SARADOMIN, [O.ZAMORAK_STANDARD_2]: TEAM.ZAMORAK, [O.STANDARD_STAND_2]: TEAM.ZAMORAK },
    DROPPED_FLAG_TEAMS: { [O.SARADOMIN_STANDARD]: TEAM.SARADOMIN, [O.ZAMORAK_STANDARD]: TEAM.ZAMORAK },
    TRAPDOOR_ROUTES: { [O.TRAPDOOR_16]: { blockedTeam: TEAM.ZAMORAK, to: [2429, 3075, 1] }, [O.TRAPDOOR_17]: { blockedTeam: TEAM.SARADOMIN, to: [2370, 3132, 1] } },
    // [barrier tile, tile the crossing starts from, tile it ends on]
    ENERGY_BARRIERS: {
      [O.ENERGY_BARRIER]: { team: TEAM.SARADOMIN, crossings: [[[2426, 3080, 1], [2426, 3080, 1], [2426, 3081, 1]], [[2426, 3080, 1], [2426, 3081, 1], [2426, 3080, 1]], [[2423, 3076, 1], [2422, 3076, 1], [2423, 3076, 1]], [[2423, 3076, 1], [2423, 3076, 1], [2422, 3076, 1]]] },
      [O.ENERGY_BARRIER_2]: { team: TEAM.ZAMORAK, crossings: [[[2373, 3127, 1], [2373, 3126, 1], [2373, 3127, 1]], [[2373, 3127, 1], [2373, 3127, 1], [2373, 3126, 1]], [[2376, 3131, 1], [2376, 3131, 1], [2377, 3131, 1]], [[2376, 3131, 1], [2377, 3131, 1], [2376, 3131, 1]]] },
    },
    // object id -> [[object tile, destination], ...]
    CLIMB_ROUTES: {
      [O.STAIRCASE_15]: [[[2428, 3081, 1], [2430, 3080, 2]], [[2425, 3074, 2], [2426, 3074, 3]], [[2419, 3078, 0], [2420, 3080, 1]]],
      [O.STAIRCASE_13]: [[[2419, 3080, 1], [2419, 3077, 0]], [[2430, 3081, 2], [2427, 3081, 1]], [[2425, 3074, 3], [2425, 3077, 2]], [[2374, 3133, 3], [2374, 3130, 2]], [[2369, 3126, 2], [2372, 3126, 1]], [[2380, 3127, 1], [2380, 3130, 0]]],
      [O.LADDER_46]: [[[2421, 3073, 1], [2421, 3074, 0]], [[2378, 3134, 1], [2378, 3133, 0]]],
      [O.LADDER_195]: [[[2421, 3073, 0], [2421, 3074, 1]], [[2378, 3134, 0], [2378, 3133, 1]]],
      [O.LADDER_47]: [[[2430, 3082, 0], [2430, 9482, 0]], [[2369, 3125, 0], [2369, 9525, 0]]],
      [O.LADDER_218]: [[[2369, 9525, 0], [2369, 3126, 0]], [[2430, 9482, 0], [2430, 3081, 0]], [[2400, 9508, 0], [2400, 3107, 0]], [[2399, 9499, 0], [2399, 3100, 0]]],
      [O.HOLLOW_TREE_3]: [[[2430, 9482, 0], [2430, 3081, 0]], [[2369, 9525, 0], [2369, 3126, 0]]],
      [O.STAIRCASE_16]: [[[2380, 3127, 0], [2379, 3127, 1]], [[2369, 3126, 1], [2369, 3127, 2]], [[2374, 3131, 2], [2373, 3133, 3]]],
    },
    FIXED_MOVES: { [O.LADDER_64]: [2370, 3132, 2], [O.LADDER_63]: [2429, 3075, 2] },
    SUPPLY_TABLES: {
      [O.TABLE_450]: [I.BANDAGES, "You get some bandages."],
      [O.TABLE_451]: [I.BANDAGES, "You get some bandages."],
      // Newer-revision tables: 56224/56225 carry the explosive-potion prop (model 4434, as 4463),
      // 56226 sits under the bucket spawns.
      [O.TABLE_452]: [I.EXPLOSIVE_POTION, "You get an explosive potion."],
      [O.TABLE_453]: [I.EXPLOSIVE_POTION, "You get an explosive potion."],
      [O.TABLE_454]: [I.BUCKET, "You get a bucket."],
      [O.TABLE_44]: [I.BARRICADE, "You get a barricade."],
      [O.TABLE_46]: [I.EXPLOSIVE_POTION, "You get an explosive potion."],
      [O.TABLE_47]: [I.BRONZE_PICKAXE, "You get a bronze pickaxe for mining."],
      [O.TABLE_42]: [I.TOOLKIT_2, "You get a toolkit."],
      [O.TABLE_45]: [I.ROPE, "You get some rope."],
      [O.TABLE_43]: [I.ROCK_5, "You get a rock."],
    },
    ALTAR_SPAWNS: [[O.CHAOS_ALTAR_2, [2431, 3076, 1], 1], [O.CHAOS_ALTAR_2, [2373, 3135, 1], 0]],
  });
}

module.exports = function castleWarsData(core) {
  return (data ??= buildData(core));
};
