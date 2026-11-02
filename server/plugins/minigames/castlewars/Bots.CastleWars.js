"use strict";

/**
 * Castle Wars bots. The lobby seeds each bot with a role in the "castlewars:bot-role"
 * attribute (game.BOT_ROLE_KEY); this unit turns that role into behaviour while the bot is
 * inside a live game:
 *
 *   attacker - storm the enemy castle, fight anyone in reach, otherwise batter the enemy
 *              large door down (a door swing is rooted to the clicked tile, so the bot
 *              stands still between swings);
 *   flag     - run the castle's scripted ladder route to the enemy standard, capture it
 *              with an empty weapon slot, carry it home and score at the team's own stand;
 *   guard    - climb to the team's own stand, kill intruders around it and hold the post.
 *
 * Every bot gets a core BotController (one per player, built lazily) ticked from the game
 * area's inGameProcessors. The routes are the CLIMB_ROUTES chains from Data.CastleWars.js;
 * when a bot is left behind on another floor the route resumes at the first step on its
 * current floor, and a bot that cannot make progress falls back to a hold position instead
 * of freezing. Controllers go away on "castlewars:reset" and on logout.
 */

const { ActionNode, BotController, SelectorNode } = require("../../../src/main/typescript/elvarg/game/bot/BehaviorTree");
const { PlayerRights } = require("../../../src/main/typescript/elvarg/game/model/rights/PlayerRights");
const { buildRoamingPvpMetadata } = require("../../bots/behaviours/pvp/PvpAssignment.PlayerBots");
const { applyGeneratedPvpLoadout } = require("../../bots/behaviours/policies/PvpLoadoutPolicy.PlayerBots");
const {
  initPvpTierLoadouts,
  TIER_BANDS,
  TIER_PROFILE_IDS,
  pickTierChoice: pickSharedTierChoice,
  tierCombatLevel,
} = require("../../bots/behaviours/pvp/PvpTierLoadouts.PlayerBots");
const FoodPlugin = require("../../items/Food.plugin");


// Lobby.CastleWars.js owns the attribute and mirrors it onto the game object; the literal
// is only the fallback if this unit is ever loaded before the lobby.
const DEFAULT_BOT_ROLE_KEY = "castlewars:bot-role";
const ROLES = Object.freeze({
  ATTACKER: "attacker",
  FLAG: "flag",
  GUARD: "guard",
  DOORMAN: "doorman",
  SIDE_DOORMAN: "side-doorman",
  ARCHER: "archer",
  MAGE: "mage",
  CATAPULT: "catapult",
  SCORER: "scorer",
  DEFENDER: "defender",
});
const FLAG_MODE = Object.freeze({ OUT: "out", HOME: "home", BACK: "back" });

// Cadences (milliseconds): how often a bot re-asks the pather, re-clicks a door or flag, and
// how long a route step may show no progress before it is declared stuck.
const WALK_RETRY_MS = 350;
const CLIMB_COOLDOWN_MS = 1200;
const CLIMB_TIMEOUT_MS = 4000;
const BARRIER_CLICK_COOLDOWN_MS = 1200;
const BARRIER_TIMEOUT_MS = 4000;
const STUCK_TIMEOUT_MS = 8000;
const LOADOUT_RETRY_MS = 5000;
const STAND_RETRY_MS = 3000;
const FLAG_CLICK_INTERVAL_MS = 1200;
const DOOR_CLICK_INTERVAL_MS = 2000;
// Engagement ranges (tiles): how far a role looks for a fight, how far it may stray from its
// post before heading back, and the radius that still counts as "on post".
// Attackers only fight what is right on their path: a wide engage range left the squad
// brawling mid-map instead of pushing the enemy door and flag room.
const ATTACKER_ENGAGE_RANGE = 4;
const ATTACKER_LEASH = 8;
const GUARD_ENGAGE_RANGE = 10;
const GUARD_LEASH = 12;
const GUARD_HOLD_RANGE = 3;
const DOORMAN_ENGAGE_RANGE = 7;
const DOORMAN_LEASH = 10;
const DOORMAN_CLEAR_RADIUS = 2;
const DROPPED_FLAG_RADIUS = 10;
// Attackers grab an enemy standard lying this close instead of walking past it.
const RECOVER_FLAG_RADIUS = 8;
// Teammates within this of their own flag carrier protect them; threats are fought this
// close to the carrier and the escort keeps this close itself.
const ESCORT_RADIUS = 16;
const ESCORT_ENGAGE_RANGE = 6;
// Escorts hold within bandage reach of the carrier so they can top the carrier up.
const ESCORT_STAND_RANGE = 2;
const ARCHER_ENGAGE_RANGE = 12;
const ARCHER_LEASH = 4;
// Supplies: how many bandages/rocks to carry, when to heal, and how far the crew may fire.
const BANDAGE_TARGET = 8;
const ROCK_TARGET = 14;
const BANDAGE_HEAL_BELOW = 0.75;
const BANDAGE_SELF_BELOW = 0.4;
const BANDAGE_USE_INTERVAL_MS = 1800;
// The flag bearer can be bandaged from a step further than an ordinary teammate.
const BANDAGE_CARRIER_REACH = 3;
const TABLE_SCAN_RADIUS = 8;
const CATAPULT_TARGET_RADIUS = 2;
const CATAPULT_HOLD_RANGE = 9;

/** Dedicated battlements bots keep the style of their post: a bow, or a barrage staff. */
const ROLE_LOADOUTS = Object.freeze({
  [ROLES.ARCHER]: { loadoutId: "edge_ranged_melee", archetypeId: "karils_venge_ags" },
  [ROLES.MAGE]: { loadoutId: "deep_wild_hybrid", archetypeId: "ancients_hybrid" },
});

// Combat tiers chosen in the lobby prompt (PvpTierLoadouts.PlayerBots): each pins a bot's
// loadout and combat level band.
const DEFAULT_BOT_TIER_KEY = "castlewars:bot-tier";

let api;
let game;
let core;
let routes;

const botControllers = new Map();
const botStates = new Map();

// --- Tiles and routes --------------------------------------------------------------------

function tileKey(location) {
  return `${location.getX()},${location.getY()},${location.getZ()}`;
}

function chebyshevDistance(x1, y1, x2, y2) {
  return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2));
}

function walkStep(x, y, z) {
  return { type: "walk", x, y, z };
}

function climbStep(from, to, reach = 1) {
  return { type: "climb", from, to, reach };
}

/**
 * An own-team energy barrier pass: walk onto the barrier tile, then click Pass; the
 * crossing carries the bot to the far tile. Only needed from inside the team's spawn room,
 * so routes reused mid-map skip it (the runner checks the spawn bounds first).
 */
function barrierStep(id, stand, to) {
  return { type: "barrier", id, stand, to };
}

/**
 * A stepping-stone crossing: land at either end of `ends`, hop the `stones` in order (the
 * runner picks the end nearest the bot and walks/clicks its way across). The stones are the
 * quick hops over the river inlets; the island bridge is the walkable main crossing.
 */
function stonesStep(stones, ends) {
  return { type: "stones", stones, ends, z: ends[0][2] };
}

/**
 * The middle island bridge: the row of walkable tiles across the river at y3099-3104,
 * between the island and either bank. Routes walk it instead of hopping the stones.
 */
function islandBridgeWestToEast() {
  return [
    walkStep(2384, 3104, 0),
    walkStep(2386, 3103, 0),
    walkStep(2413, 3103, 0),
    walkStep(2415, 3103, 0),
  ];
}

function islandBridgeEastToWest() {
  return islandBridgeWestToEast().reverse();
}

/** The south stepping stones, between the Saradomin side and the south land. */
function eastCrossing() {
  return stonesStep(
    [[2420, 3123], [2419, 3123], [2419, 3124], [2419, 3125], [2418, 3125]],
    [[2420, 3122, 0], [2417, 3125, 0]]
  );
}

/**
 * Open one's own large door from `stand` (either side). The castle's outer door is the only
 * way between the ground floor hall and the island, so an attacker/flag route must click it
 * open; owners may open their own door, enemies have to attack it.
 */
function doorStep(leaves, stand) {
  return { type: "door", leaves, stand, z: stand[2] };
}

/** The floor a step has to be walked (or climbed from) on. */
function stepFloor(step) {
  if (step.type === "climb") {
    return step.from[2];
  }
  if (step.type === "barrier") {
    return step.stand[2];
  }
  return step.z;
}

/** First step at or after `fromIndex` on this floor, or -1. Used to re-plan after a death or a skip. */
function firstStepOnFloor(route, fromIndex, z) {
  for (let index = fromIndex; index < route.length; index += 1) {
    if (stepFloor(route[index]) === z) {
      return index;
    }
  }
  return -1;
}

/**
 * The bot's scripted routes, built from the castle's own ladder chains in
 * Data.CastleWars.CLIMB_ROUTES. Tiles match CLIMB_ROUTES' [from, to] pairs exactly, so a
 * route step can only be added when the map really offers that climb. `teams` is
 * game.TEAM (passed separately so tests can build the routes without a game).
 */
function buildRoutes(core, teams) {
  const O = core.ObjectIdentifiers;
  const { SARADOMIN, ZAMORAK } = teams;
  // Own large doors, opened from either side by the owning team.
  const saraDoor = (stand) =>
    doorStep([[O.LARGE_DOOR_24, 2426, 3088, 0], [O.LARGE_DOOR_25, 2427, 3088, 0]], stand);
  const zamDoor = (stand) =>
    doorStep([[O.LARGE_DOOR_28, 2373, 3119, 0], [O.LARGE_DOOR_29, 2372, 3119, 0]], stand);

  // Shared route segments. Every route that leaves a start room opens with the same
  // barrier pass and first descent, and both castles' flag-room climbs are walked by flag
  // runners, raiders and guards alike, so each is built once and spread into place.
  const saraSpawnBarrier = barrierStep(O.ENERGY_BARRIER, [2426, 3080, 1], [2426, 3081, 1]);
  const zamSpawnBarrier = barrierStep(O.ENERGY_BARRIER_2, [2376, 3131, 1], [2377, 3131, 1]);
  const saraLeaveSpawn = [
    saraSpawnBarrier,
    walkStep(2419, 3080, 1),
    climbStep([2419, 3080, 1], [2419, 3077, 0]),
  ];
  const zamLeaveSpawn = [
    zamSpawnBarrier,
    walkStep(2378, 3134, 1),
    climbStep([2378, 3134, 1], [2378, 3133, 0]),
  ];
  // Down the team's own staircase, through its own large door and out to the island. The
  // door is the only hall-to-island opening, so every raider/flag/doorman route clicks it.
  const saraThroughOwnDoor = [
    ...saraLeaveSpawn,
    walkStep(2426, 3087, 0),
    saraDoor([2426, 3087, 0]),
  ];
  const zamThroughOwnDoor = [
    ...zamLeaveSpawn,
    walkStep(2372, 3120, 0),
    zamDoor([2372, 3120, 0]),
  ];
  // Up the enemy castle's climb chains to its flag room: Saradomin's on the east side,
  // Zamorak's on the west, each starting on the ground floor by its outer wall.
  const saraFlagRoomUp = [
    walkStep(2428, 3081, 1),
    climbStep([2428, 3081, 1], [2430, 3080, 2]),
    walkStep(2425, 3074, 2),
    climbStep([2425, 3074, 2], [2426, 3074, 3]),
    walkStep(2429, 3074, 3),
  ];
  // From the floor-1 landing of Zamorak's own stairwell up to its flag room.
  const zamFlagRoomAscent = [
    walkStep(2369, 3126, 1),
    climbStep([2369, 3126, 1], [2369, 3127, 2]),
    walkStep(2374, 3131, 2),
    climbStep([2374, 3131, 2], [2373, 3133, 3]),
    walkStep(2370, 3133, 3),
  ];
  const zamFlagRoomUp = [
    walkStep(2378, 3134, 0),
    climbStep([2378, 3134, 0], [2378, 3133, 1]),
    ...zamFlagRoomAscent,
  ];
  // The island gate into the tunnels, and the two tunnel exits (one per castle's basement).
  const tunnelDown = [
    walkStep(2399, 3099, 0),
    climbStep([2399, 3099, 0], [2399, 9500, 0]),
    walkStep(2400, 9504, 0),
  ];
  const tunnelUpIntoZamorak = [
    walkStep(2369, 9525, 0),
    climbStep([2369, 9525, 0], [2369, 3126, 0]),
  ];
  const tunnelUpIntoSaradomin = [
    walkStep(2430, 9482, 0),
    climbStep([2430, 9482, 0], [2430, 3081, 0]),
  ];

  // Saradomin: down STAIRCASE_13 (2419,3080,1), over the island bridge, up LADDER_195 into
  // Zamorak's castle, then STAIRCASE_16 to the Zamorak flag room.
  const saraFlagOut = [
    ...saraThroughOwnDoor,
    ...islandBridgeEastToWest(),
    ...zamFlagRoomUp,
  ];
  // Saradomin: out of the start room to STAIRCASE_13, then over the island bridge to the
  // Zamorak large door outside (2372,3119 is inside, so 3118 is the outside tile).
  const saraAttackerOut = [
    ...saraThroughOwnDoor,
    ...islandBridgeEastToWest(),
    walkStep(2371, 3118, 0),
  ];
  // Saradomin: once Zamorak's door is down (or open), push through it and up their own
  // climb chain into the flag room, where the carrier and guards are.
  const saraAttackerRaid = [walkStep(2372, 3120, 0), ...zamFlagRoomUp];
  // Saradomin, the long way: out the west wall and over the south stepping stones.
  const saraAttackerEast = [
    ...saraThroughOwnDoor,
    walkStep(2424, 3095, 0),
    walkStep(2420, 3122, 0),
    eastCrossing(),
    walkStep(2371, 3118, 0),
  ];
  // Saradomin, under the river: over the island to the gate, down into the tunnels and up
  // inside Zamorak's castle. The raid after surfacing is the same flag-room chain.
  const saraAttackerTunnel = [
    ...saraThroughOwnDoor,
    ...tunnelDown,
    ...tunnelUpIntoZamorak,
  ];
  const saraTunnelRaid = saraAttackerRaid;
  // Saradomin: start room up STAIRCASE_15 twice to the flag room's stand. The guard passes
  // the spawn barrier and goes straight up the castle's own stairwell (no descent).
  const saraGuardUp = [saraSpawnBarrier, ...saraFlagRoomUp];
  // Saradomin: the guard/flag chain back down (STAIRCASE_13 both floors) to the island exit.
  const saraDescent = [
    walkStep(2425, 3074, 3),
    climbStep([2425, 3074, 3], [2425, 3077, 2]),
    walkStep(2430, 3081, 2),
    climbStep([2430, 3081, 2], [2427, 3081, 1]),
    walkStep(2419, 3080, 1),
  ];
  // One guard per team is stationed at the team's own large door and shuts it behind
  // teammates, so attackers have to batter it down again. He stands OUTSIDE the gate and
  // fights there, defending it with his last breath.
  const saraDoormanUp = [...saraThroughOwnDoor, walkStep(2426, 3089, 0)];
  // The side-door keeper: own spawn down to the side door on the ground floor.
  const saraSideDoorUp = [...saraLeaveSpawn, walkStep(2416, 3073, 0)];
  // The battlements crew: down to the ground floor, then up the battlement stair (both
  // surfaces read as z0, the walkway just sits raised above the courtyard).
  const saraBattlementUp = [
    ...saraLeaveSpawn,
    walkStep(2416, 3074, 0),
    // The stair carries the crew onto the raised walkway itself, not the ground beside it.
    climbStep([2416, 3074, 0], [2415, 3083, 0], 4),
  ];

  // Zamorak: LADDER_46 down out of the start room, over the island bridge, LADDER_195 up
  // into Saradomin's castle, then STAIRCASE_15 to the Saradomin flag room.
  const zamFlagOut = [
    ...zamThroughOwnDoor,
    ...islandBridgeWestToEast(),
    walkStep(2421, 3073, 0),
    climbStep([2421, 3073, 0], [2421, 3074, 1]),
    ...saraFlagRoomUp,
  ];
  // Zamorak: LADDER_46 out, then over the island bridge to the Saradomin large door
  // outside (3088 is inside, so 3089).
  const zamAttackerOut = [
    ...zamThroughOwnDoor,
    ...islandBridgeWestToEast(),
    walkStep(2428, 3089, 0),
  ];
  // Zamorak: once Saradomin's door is down (or open), push through it and up their own
  // climb chain into the flag room, where the carrier and guards are.
  const zamAttackerRaid = [
    walkStep(2419, 3077, 0),
    climbStep([2419, 3078, 0], [2420, 3080, 1]),
    ...saraFlagRoomUp,
  ];
  const zamTunnelRaid = zamAttackerRaid;
  // Zamorak, the long way: along the south land and over the south stepping stones.
  const zamAttackerEast = [
    ...zamThroughOwnDoor,
    walkStep(2372, 3118, 0),
    walkStep(2400, 3120, 0),
    walkStep(2417, 3125, 0),
    eastCrossing(),
    walkStep(2428, 3089, 0),
  ];
  // Zamorak, under the river: across the island, down the gate into the tunnels and up
  // inside Saradomin's castle. The raid after surfacing is the same flag-room chain.
  const zamAttackerTunnel = [
    ...zamThroughOwnDoor,
    ...tunnelDown,
    ...tunnelUpIntoSaradomin,
  ];
  // Zamorak: start room up STAIRCASE_16 twice to the flag room's stand. The guard passes
  // the inner barrier leaf onto the stairwell landing rather than taking LADDER_46 down.
  const zamGuardUp = [
    barrierStep(O.ENERGY_BARRIER_2, [2373, 3127, 1], [2373, 3126, 1]),
    ...zamFlagRoomAscent,
  ];
  // Zamorak: the guard/flag chain back down (STAIRCASE_13 both floors) to the island exit.
  const zamDescent = [
    walkStep(2374, 3133, 3),
    climbStep([2374, 3133, 3], [2374, 3130, 2]),
    walkStep(2369, 3126, 2),
    climbStep([2369, 3126, 2], [2372, 3126, 1]),
    walkStep(2378, 3134, 1),
  ];
  const zamDoormanUp = [...zamThroughOwnDoor, walkStep(2372, 3118, 0)];
  const zamSideDoorUp = [...zamLeaveSpawn, walkStep(2383, 3134, 0)];
  const zamBattlementUp = [
    ...zamLeaveSpawn,
    climbStep([2379, 3132, 0], [2384, 3124, 0], 5),
  ];

  return {
    [SARADOMIN]: {
      flagOut: saraFlagOut,
      // Carrying the Zamorak flag home is not a plain reverse: the map's down-chains use
      // different tiles. Descend Zamorak's castle, cross the island bridge and climb back
      // up Saradomin's own chain to the stand.
      flagHome: [
        ...zamDescent,
        climbStep([2378, 3134, 1], [2378, 3133, 0]),
        ...islandBridgeWestToEast(),
        walkStep(2426, 3089, 0),
        saraDoor([2426, 3089, 0]),
        walkStep(2419, 3077, 0),
        climbStep([2419, 3078, 0], [2420, 3080, 1]),
        ...saraGuardUp,
      ],
      guardUp: saraGuardUp,
      descent: saraDescent,
      // Carrying a standard recovered in the field: go straight to the own door and up to
      // the stand (the flag-room-anchored flagHome would send a field carrier the long way).
      carryHome: [
        walkStep(2426, 3089, 0),
        saraDoor([2426, 3089, 0]),
        walkStep(2419, 3077, 0),
        climbStep([2419, 3078, 0], [2420, 3080, 1]),
        ...saraGuardUp,
      ],
      attackerOut: saraAttackerOut,
      attackerRaid: saraAttackerRaid,
      attackerEast: saraAttackerEast,
      attackerTunnel: saraAttackerTunnel,
      tunnelRaid: saraTunnelRaid,
      attackerVariants: [
        { out: saraAttackerOut, raid: saraAttackerRaid },
        { out: saraAttackerEast, raid: saraAttackerRaid },
        { out: saraAttackerTunnel, raid: saraTunnelRaid, needsDoor: false },
        { out: saraAttackerOut, raid: null },
      ],
      doormanUp: saraDoormanUp,
      doorman: {
        post: [2426, 3089, 0],
        clear: [[2426, 3088], [2427, 3088]],
        open: [
          [O.LARGE_DOOR_26, 2426, 3087, 0],
          [O.LARGE_DOOR_27, 2427, 3087, 0],
        ],
      },
      sideDoorUp: saraSideDoorUp,
      sideDoor: {
        post: [2416, 3073, 0],
        door: [2415, 3073, 0],
        openId: O.DOOR_126,
      },
      battlementUp: saraBattlementUp,
      battlement: {
        archer: [[2415, 3085, 0], [2415, 3081, 0]],
        mage: [[2415, 3083, 0], [2415, 3079, 0]],
        catapult: [2415, 3087, 0],
        catapultTile: [2413, 3088],
      },
      // The door this team attacks: Zamorak's large door (Doors.CastleWars.js leaves).
      door: {
        approach: [2371, 3118, 0],
        leaves: [
          [O.LARGE_DOOR_28, 2373, 3119, 0],
          [O.LARGE_DOOR_29, 2372, 3119, 0],
        ],
      },
    },
    [ZAMORAK]: {
      flagOut: zamFlagOut,
      // Mirror of Saradomin's: down Saradomin's castle, over the island bridge, then up
      // the Zamorak chain.
      flagHome: [
        ...saraDescent,
        climbStep([2419, 3080, 1], [2419, 3077, 0]),
        walkStep(2426, 3089, 0),
        saraDoor([2426, 3089, 0]),
        ...islandBridgeEastToWest(),
        walkStep(2372, 3118, 0),
        zamDoor([2372, 3118, 0]),
        walkStep(2378, 3134, 0),
        climbStep([2378, 3134, 0], [2378, 3133, 1]),
        ...zamGuardUp,
      ],
      guardUp: zamGuardUp,
      descent: zamDescent,
      carryHome: [
        walkStep(2372, 3118, 0),
        zamDoor([2372, 3118, 0]),
        walkStep(2378, 3134, 0),
        climbStep([2378, 3134, 0], [2378, 3133, 1]),
        ...zamGuardUp,
      ],
      attackerOut: zamAttackerOut,
      attackerRaid: zamAttackerRaid,
      attackerEast: zamAttackerEast,
      attackerTunnel: zamAttackerTunnel,
      tunnelRaid: zamTunnelRaid,
      attackerVariants: [
        { out: zamAttackerOut, raid: zamAttackerRaid },
        { out: zamAttackerEast, raid: zamAttackerRaid },
        { out: zamAttackerTunnel, raid: zamTunnelRaid, needsDoor: false },
        { out: zamAttackerOut, raid: null },
      ],
      doormanUp: zamDoormanUp,
      doorman: {
        post: [2372, 3118, 0],
        clear: [[2373, 3119], [2372, 3119]],
        open: [
          [O.LARGE_DOOR_30, 2373, 3120, 0],
          [O.LARGE_DOOR_31, 2372, 3120, 0],
        ],
      },
      sideDoorUp: zamSideDoorUp,
      sideDoor: {
        post: [2383, 3134, 0],
        door: [2384, 3134, 0],
        openId: O.DOOR_128,
      },
      battlementUp: zamBattlementUp,
      battlement: {
        archer: [[2384, 3122, 0], [2384, 3126, 0]],
        mage: [[2384, 3124, 0], [2384, 3128, 0]],
        catapult: [2384, 3120, 0],
        catapultTile: [2384, 3117],
      },      door: {
        approach: [2428, 3089, 0],
        leaves: [
          [O.LARGE_DOOR_24, 2426, 3088, 0],
          [O.LARGE_DOOR_25, 2427, 3088, 0],
        ],
      },
    },
  };
}

// --- Object and combat helpers -----------------------------------------------------------

function clickObject(player, object, clickType) {
  const location = object.getLocation();
  return api.emitObjectInteraction({
    player,
    object,
    objectId: object.getId(),
    clickType,
    location: { x: location.getX(), y: location.getY(), z: location.getZ() },
    sourceLocation: {
      x: player.getLocation().getX(),
      y: player.getLocation().getY(),
      z: player.getLocation().getZ(),
    },
    handled: false,
  });
}

/** 1-based index of `action` in a definition's option list, or `fallback` when absent. */
function optionIndex(definition, action, fallback) {
  const options = definition?.getInteractions?.() ?? [];
  const index = options.findIndex((option) => String(option ?? "").toLowerCase() === action);
  return index >= 0 ? index + 1 : fallback;
}

/** "Open" on the door/barrier step objects (slot 1 is the usual Open slot). */
function openOptionIndex(definition) {
  return optionIndex(definition, "open", 1);
}

/** "Attack" on a large door; its known slot is 2 on the leaves this minigame uses. */
function attackOptionIndex(definition) {
  return optionIndex(definition, "attack", 2);
}

/** "Close" on an open door leaf. */
function closeOptionIndex(definition) {
  return optionIndex(definition, "close", 1);
}

/** "Lock" on an open side door. */
function lockOptionIndex(definition) {
  return optionIndex(definition, "lock", 1);
}

/** The standard object currently standing at a team's stand (safe or empty, whichever is up). */
function findStandObject(teamId) {
  const team = game.getTeamData(teamId);
  for (const id of [team.safeStandId, team.emptyStandId]) {
    const object = core.MapObjects.get(id, team.standLocation, null);
    if (object) {
      return object;
    }
  }
  return null;
}

/** A dropped standard of `flagTeam` within a short walk of `nearTeam`'s stand, any floor. */
function findDroppedFlag(flagTeam, nearTeam = flagTeam) {
  const team = game.getTeamData(flagTeam);
  const near = game.getTeamData(nearTeam);
  const stand = near.standLocation;
  for (let z = 0; z <= 3; z += 1) {
    for (let dx = -DROPPED_FLAG_RADIUS; dx <= DROPPED_FLAG_RADIUS; dx += 1) {
      for (let dy = -DROPPED_FLAG_RADIUS; dy <= DROPPED_FLAG_RADIUS; dy += 1) {
        const object = core.MapObjects.get(
          team.droppedFlagObjectId,
          new core.Location(stand.getX() + dx, stand.getY() + dy, z),
          null
        );
        if (object) {
          return object;
        }
      }
    }
  }
  return null;
}

function isEnemyOf(player, other, teamId) {
  if (other === player || other.getHitpoints?.() <= 0) {
    return false;
  }
  if (other.isRegistered?.() === false) {
    return false;
  }
  const otherTeam = game.getTeamId(other);
  if (otherTeam == null || otherTeam === teamId) {
    return false;
  }
  return other.getPrivateArea?.() === player.getPrivateArea?.();
}

/** True when a straight walk line to the target is clipped (the river, a castle wall). */
function walkLineBlocked(player, target, coreApi = core) {
  const from = player.getLocation();
  const to = target.getLocation();
  if (from.getZ() !== to.getZ()) {
    return true;
  }
  const steps = Math.max(Math.abs(from.getX() - to.getX()), Math.abs(from.getY() - to.getY()));
  if (steps <= 1) {
    return false;
  }
  const privateArea = player.getPrivateArea?.() ?? null;
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    const x = Math.round(from.getX() + (to.getX() - from.getX()) * t);
    const y = Math.round(from.getY() + (to.getY() - from.getY()) * t);
    if (coreApi.RegionManager.blocked(new coreApi.Location(x, y, from.getZ()), privateArea)) {
      return true;
    }
  }
  return false;
}

/**
 * Whether chasing the target is sensible: already able to hit it from here, or standing on
 * a walkable line. Melee bots used to pace the river bank forever chasing targets across
 * the water; their role routes cross by the stepping stones instead.
 */
function canEngage(player, target) {
  const method = core.CombatFactory.getMethod(player);
  if (core.CombatRange.canReach(player, method, target)) {
    return true;
  }
  return !walkLineBlocked(player, target);
}

/**
 * The nearest enemy of `player` on the same floor within `maxDistance`, optionally only
 * those matching `filter` (used to prioritize enemy flag carriers). Enemies behind a
 * clipped walk line (the river) are skipped: the route, not a chase, does the crossing.
 */
function nearestEnemy(player, teamId, maxDistance, filter = null) {
  const location = player.getLocation();
  let best = null;
  let bestDistance = maxDistance + 1;
  for (const other of game.gameArea.getPlayers()) {
    if (!isEnemyOf(player, other, teamId) || !canEngage(player, other)) {
      continue;
    }
    if (filter && !filter(other)) {
      continue;
    }
    const otherLocation = other.getLocation();
    if (otherLocation.getZ() !== location.getZ()) {
      continue;
    }
    const distance = chebyshevDistance(
      otherLocation.getX(),
      otherLocation.getY(),
      location.getX(),
      location.getY()
    );
    if (distance < bestDistance) {
      best = other;
      bestDistance = distance;
    }
  }
  return best;
}

/** An enemy flag carrier within range; they are the target that breaks the flag standoff. */
function nearestEnemyCarrier(player, teamId, maxDistance) {
  return nearestEnemy(player, teamId, maxDistance, (other) => Boolean(game.getCarriedFlagTeam(other)));
}

/** The current combat target when it is still a live enemy inside the role's leash. */
function currentEnemyTarget(player, teamId, anchor, leash) {
  const target = player.getCombat().getTarget?.();
  if (!target || target.getHitpoints?.() <= 0 || game.getTeamId(target) === teamId) {
    return null;
  }
  const location = player.getLocation();
  const targetLocation = target.getLocation();
  if (targetLocation.getZ() !== location.getZ() || target.getPrivateArea?.() !== player.getPrivateArea?.()) {
    return null;
  }
  if (!canEngage(player, target)) {
    // Across the river, say: drop it and let the role route do the crossing.
    return null;
  }
  const originX = anchor ? anchor[0] : location.getX();
  const originY = anchor ? anchor[1] : location.getY();
  return chebyshevDistance(targetLocation.getX(), targetLocation.getY(), originX, originY) <= leash ? target : null;
}

/** Attack the nearest reachable enemy, or keep the current fight going; "failure" when nobody is in range. */
function attackEnemies(ctx, teamId, engageRange, anchor, leash) {
  const player = ctx.player;
  const combat = player.getCombat();
  const current = currentEnemyTarget(player, teamId, anchor, leash);
  const carrier = nearestEnemyCarrier(player, teamId, engageRange);
  if (current) {
    if (!carrier || carrier === current) {
      return "running";
    }
    // A carrier walked into range: switch, or the standoff never breaks.
    combat.reset();
  } else if (combat.getTarget?.()) {
    combat.reset();
  }
  const target = carrier ?? nearestEnemy(player, teamId, engageRange);
  if (!target) {
    return "failure";
  }
  const permission = core.CombatFactory.canAttackPermission(
    player,
    target,
    false,
    core.CombatFactory.getMethod(player)
  );
  if (permission !== core.CanAttackResponse.CAN_ATTACK) {
    return "failure";
  }
  combat.attack(target);
  return "running";
}

// --- Route runner ------------------------------------------------------------------------

function beginRoute(state, route) {
  state.route = route;
  state.cursor = 0;
  state.routeActive = false;
  state.pendingClimb = null;
  state.stonesStep = null;
  state.stonePath = null;
  state.stoneIndex = 0;
  state.pendingStone = null;
}

function advanceRoute(state) {
  state.cursor += 1;
  state.pendingClimb = null;
  state.stonesStep = null;
  state.stonePath = null;
  state.stoneIndex = 0;
  state.pendingStone = null;
}

/**
 * Ask the pather for a step toward x,y at most every WALK_RETRY_MS; a move already queued
 * is left alone. Returns "running" so callers can return its result directly.
 */
function walkTowards(ctx, state, x, y) {
  if (ctx.player.getMovementQueue().size() === 0 && ctx.nowMs >= state.nextWalkAt) {
    core.PathFinder.calculateWalkRoute(ctx.player, x, y);
    state.nextWalkAt = ctx.nowMs + WALK_RETRY_MS;
  }
  return "running";
}

/** Climb one step: stand within its reach, then hand the destination to game.climbTo. */
function runClimbStep(ctx, state, step) {
  const player = ctx.player;
  const location = player.getLocation();
  const movement = player.getMovementQueue();
  const [fromX, fromY] = step.from;
  const reach = step.reach ?? 1;
  const atFrom = chebyshevDistance(location.getX(), location.getY(), fromX, fromY) <= reach;
  if (!atFrom || movement.size() > 0) {
    return walkTowards(ctx, state, fromX, fromY);
  }
  if (ctx.nowMs < state.nextClimbAt) {
    return "running";
  }
  // climbTo carries an explicit destination, so the climb starts from wherever the bot
  // stands next tick. It must not walk that tick - game.climbTo blocks movement anyway.
  state.nextClimbAt = ctx.nowMs + CLIMB_COOLDOWN_MS;
  state.pendingClimb = { at: ctx.nowMs, to: step.to };
  game.climbTo(player, step.to);
  return "running";
}

/**
 * A stepping-stone crossing: pick the end nearest the bot, build [near end, ...stones, far
 * end], then walk to each tile first and hop each stone with movement.walkStep - the same
 * step the stone-click handler takes for players, so no object dispatch is needed.
 */
function runStonesStep(ctx, state, step) {
  const player = ctx.player;
  const nowMs = ctx.nowMs;
  const location = player.getLocation();
  const movement = player.getMovementQueue();
  if (state.stonesStep !== step) {
    state.stonesStep = step;
    const [a, b] = step.ends;
    const fromFirst =
      chebyshevDistance(location.getX(), location.getY(), a[0], a[1]) <=
      chebyshevDistance(location.getX(), location.getY(), b[0], b[1]);
    const order = fromFirst ? step.stones : [...step.stones].reverse();
    const near = fromFirst ? a : b;
    const far = fromFirst ? b : a;
    state.stonePath = [
      { x: near[0], y: near[1], z: near[2] },
      ...order.map(([x, y, z]) => ({ x, y, z: z ?? near[2], stone: true })),
      { x: far[0], y: far[1], z: far[2] },
    ];
    state.stoneIndex = 0;
    state.pendingStone = null;
    if (process.env.CW_BOT_DEBUG === "1") {
      console.log(`[cw_bot] stones_init ${player.getUsername?.()} path=${state.stonePath.map((p) => `${p.x},${p.y}${p.stone ? "S" : ""}`).join(" ")}`);
    }
  }
  const path = state.stonePath;
  if (state.stoneIndex >= path.length) {
    advanceRoute(state);
    return runRoute(ctx, state);
  }
  const target = path[state.stoneIndex];
  if (process.env.CW_BOT_DEBUG_USER === player.getUsername?.()) {
    console.log(`[cw_bot] stones_tick ${player.getUsername?.()} idx=${state.stoneIndex}/${path.length} at=${location.getX()},${location.getY()} target=${target.x},${target.y}${target.stone ? "S" : ""} pending=${!!state.pendingStone} queue=${movement.size()} stillMs=${nowMs - state.lastMovedAt}`);
  }
  const onTarget =
    location.getZ() === target.z && location.getX() === target.x && location.getY() === target.y;
  if (onTarget) {
    state.stoneIndex += 1;
    state.pendingStone = null;
    return runRoute(ctx, state);
  }
  if (target.stone) {
    const manhattan = Math.abs(location.getX() - target.x) + Math.abs(location.getY() - target.y);
    if (location.getZ() !== target.z || manhattan > 1) {
      // Walk to the tile before the stone (the near end or the previous stone).
      const before = path[Math.max(0, state.stoneIndex - 1)];
      return walkTowards(ctx, state, before.x, before.y);
    }
    const dx = Math.sign(target.x - location.getX());
    const dy = Math.sign(target.y - location.getY());
    if ((dx === 0) !== (dy === 0)) {
      movement.walkStep(dx, dy);
      if (process.env.CW_BOT_DEBUG === "1") {
        console.log(`[cw_bot] stone_hop ${player.getUsername?.()} stone=${target.x},${target.y} from=${location.getX()},${location.getY()} dir=${dx},${dy}`);
      }
    }
    return "running";
  }
  return walkTowards(ctx, state, target.x, target.y);
}

/** Click an own-team large door open from its stand tile (either side of the leaf). */
function runDoorStep(ctx, state, step) {
  const player = ctx.player;
  const location = player.getLocation();
  const [standX, standY, standZ] = step.stand;
  const nearStand =
    location.getZ() === standZ &&
    chebyshevDistance(location.getX(), location.getY(), standX, standY) <= 1;
  if (!nearStand) {
    return walkTowards(ctx, state, standX, standY);
  }
  for (const [id, x, y, z] of step.leaves) {
    const object = core.MapObjects.get(id, new core.Location(x, y, z), null);
    if (object) {
      if (process.env.CW_BOT_DEBUG === "1") {
        console.log(`[cw_bot] door_click ${player.getUsername?.()} leaf=${id}@${x},${y},${z} from=${location.getX()},${location.getY()}`);
      }
      clickObject(player, object, openOptionIndex(object.getDefinition?.()));
      break;
    }
  }
  advanceRoute(state);
  return runRoute(ctx, state);
}

/** Pass the own-team energy barrier from its stand tile. */
function runBarrierStep(ctx, state, step) {
  const player = ctx.player;
  const nowMs = ctx.nowMs;
  const location = player.getLocation();
  // Only the spawn room is walled off by the team's energy barrier; a route reused
  // mid-map (a flag carrier coming home, a second run) skips the pass.
  const teamId = game.getTeamId(player);
  const bounds = teamId ? game.getTeamData(teamId)?.respawnBounds : null;
  if (!bounds || !bounds.inside(location)) {
    advanceRoute(state);
    return runRoute(ctx, state);
  }
  if (state.pendingBarrier) {
    if (nowMs - state.pendingBarrier.at > BARRIER_TIMEOUT_MS) {
      state.pendingBarrier = null;
    } else {
      return "running";
    }
  }
  const [standX, standY, standZ] = step.stand;
  const onStand =
    location.getZ() === standZ && location.getX() === standX && location.getY() === standY;
  if (!onStand) {
    return walkTowards(ctx, state, standX, standY);
  }
  if (nowMs < (state.nextBarrierAt ?? 0)) {
    return "running";
  }
  state.nextBarrierAt = nowMs + BARRIER_CLICK_COOLDOWN_MS;
  state.pendingBarrier = { at: nowMs };
  const barrier = core.MapObjects.get(step.id, new core.Location(standX, standY, standZ), null);
  if (barrier) {
    clickObject(player, barrier, 1);
  }
  return "running";
}

/** Land a step within one tile, or walk toward it. */
function runWalkStep(ctx, state, step) {
  const location = ctx.player.getLocation();
  if (chebyshevDistance(location.getX(), location.getY(), step.x, step.y) <= 1) {
    advanceRoute(state);
    return runRoute(ctx, state);
  }
  return walkTowards(ctx, state, step.x, step.y);
}

/**
 * Walk/climb the current route one decision. Returns "running" while there is somewhere to
 * go, "done" when every step is behind the bot and "stuck" when it cannot make progress
 * (the caller decides the fallback). Bots are only area-processed every third tick when
 * idle, so every wait here is measured in wall-clock milliseconds, not ticks.
 */
function runRoute(ctx, state) {
  const player = ctx.player;
  const nowMs = ctx.nowMs;
  const route = state.route;
  const location = player.getLocation();
  // Track the last tile the bot occupied, so a bot that neither moves nor changes tile can
  // still time out as stuck (it may process no movement events at all while idle).
  if (!state.routeActive) {
    state.routeActive = true;
    state.lastTile = tileKey(location);
    state.lastMovedAt = nowMs;
  } else if (tileKey(location) !== state.lastTile) {
    state.lastTile = tileKey(location);
    state.lastMovedAt = nowMs;
  }
  if (state.cursor >= route.length) {
    state.routeActive = false;
    return "done";
  }
  let step = route[state.cursor];
  // A climb ends on its destination: a changing floor is detected by plane, while same-plane
  // stairs (the battlements are raised but still z0) are detected by the landing tile.
  const climbedTo = state.pendingClimb?.to;
  if (
    climbedTo &&
    location.getX() === climbedTo[0] &&
    location.getY() === climbedTo[1] &&
    location.getZ() === climbedTo[2]
  ) {
    state.pendingClimb = null;
    advanceRoute(state);
    return runRoute(ctx, state);
  }
  // A climb ends one floor away: a bot standing on the destination floor has landed (check
  // this before the floor-resume below, or the completed climb reads as a wrong floor).
  if (step.type === "climb" && step.to[2] !== step.from[2] && location.getZ() === step.to[2]) {
    advanceRoute(state);
    return runRoute(ctx, state);
  }
  // Left behind on another floor (a respawn, a skip): resume at the next step on this floor.
  if (stepFloor(step) !== location.getZ()) {
    const index = firstStepOnFloor(route, state.cursor, location.getZ());
    if (index < 0) {
      state.routeActive = false;
      return "stuck";
    }
    state.cursor = index;
    state.pendingClimb = null;
    state.lastMovedAt = nowMs;
    step = route[index];
  }
  if (state.pendingClimb) {
    if (nowMs - state.pendingClimb.at > CLIMB_TIMEOUT_MS) {
      state.pendingClimb = null;
    } else {
      return "running";
    }
  }
  if (player.getMovementQueue().size() === 0 && nowMs - state.lastMovedAt > STUCK_TIMEOUT_MS) {
    if (process.env.CW_BOT_DEBUG === "1") {
      console.log(`[cw_bot] route_stuck ${player.getUsername?.()} step=${step.type} cursor=${state.cursor} stoneIdx=${state.stoneIndex ?? "-"} at=${location.getX()},${location.getY()},${location.getZ()}`);
    }
    state.routeActive = false;
    return "stuck";
  }

  if (step.type === "climb") {
    return runClimbStep(ctx, state, step);
  }
  if (step.type === "stones") {
    return runStonesStep(ctx, state, step);
  }
  if (step.type === "door") {
    return runDoorStep(ctx, state, step);
  }
  if (step.type === "barrier") {
    return runBarrierStep(ctx, state, step);
  }
  return runWalkStep(ctx, state, step);
}

// --- Roles -------------------------------------------------------------------------------

function roleOf(player) {
  return player.getAttribute(game.BOT_ROLE_KEY ?? DEFAULT_BOT_ROLE_KEY);
}

/**
 * A deterministic tier- and role-appropriate loadout+archetype for this bot. Archers and
 * mages keep their post's style (a ranged or magic loadout); everyone else takes any
 * loadout of the tier. Returns null for a bot without a tier (plain random PvP presets).
 */
function pickTierChoice(player, role, tier) {
  const style = role === ROLES.ARCHER ? "range" : role === ROLES.MAGE ? "magic" : null;
  return pickSharedTierChoice(tier, { index: botNumber(player), style });
}

function ensureLoadout(player, state, teamId, nowMs) {
  if (game.practiceBots?.prepare(player, state, teamId)) return;
  if (state.equipped || nowMs < state.nextLoadoutAt) {
    return;
  }
  state.nextLoadoutAt = nowMs + LOADOUT_RETRY_MS;
  // Every role wears the full combat preset, runners included; the banner sits in the
  // weapon slot, which ensureFlagWeapon keeps clear until the flag is actually picked up.
  // A lobby-chosen combat tier pins the loadout+archetype to its level band; without one,
  // archers and mages draw their fixed archetypes so the battlements crew keeps its style.
  const tier = player.getAttribute(game.BOT_TIER_KEY ?? DEFAULT_BOT_TIER_KEY);
  const tierChoice = pickTierChoice(player, state.role, tier);
  const forced = tierChoice ?? ROLE_LOADOUTS[state.role];
  const applied = applyGeneratedPvpLoadout(
    player,
    {
      pvp: {
        ...buildRoamingPvpMetadata({
          // Tier bots may take free-to-play gear: the low-level archetypes live there.
          excludeF2p: !tierChoice,
          config: forced
            ? {
                pvp: {
                  loadoutWeights: [{ value: forced.loadoutId, weight: 1 }],
                  profileWeights: tierChoice ? [{ value: TIER_PROFILE_IDS[tier], weight: 1 }] : undefined,
                },
              }
            : {},
        }),
        ...(tierChoice ? { combatLevelRange: TIER_BANDS[tier] } : {}),
        ...(forced ? { generatedArchetypeId: forced.archetypeId } : {}),
      },
    },
    { api }
  );
  if (applied) {
    state.equipped = true;
    // Castle Wars food is the bandage table: the preset's sharks/karambwans would fill every
    // slot and leave no room to pick bandages up.
    stripFood(player);
  }
  // Team colours go on even while the preset is deferred (the bot is in combat), and go on
  // again after it lands so its helmet cannot cover the hood.
  if (applied || !state.colours) {
    state.colours = true;
    game.equipTeamColours(player, teamId);
  }
  if (state.role === ROLES.FLAG) {
    ensureFlagWeapon(player);
  }
}

/** Clears ordinary food so the bot can carry bandages; potions and runes stay. */
function stripFood(player) {
  const inventory = player.getInventory();
  const food = new Set(inventory.getItems().map((item) => item?.getId?.()).filter(FoodPlugin.isFoodItem));
  for (const id of food) {
    inventory.deleteNumber(id, inventory.getAmount(id));
  }
}

/** The bandage supply table in the team's spawn room, if one is loaded. */
function findSupplyTable(teamId, tableIds) {
  const room = game.getTeamData(teamId).startRoom;
  for (let dx = -TABLE_SCAN_RADIUS; dx <= TABLE_SCAN_RADIUS; dx += 1) {
    for (let dy = -TABLE_SCAN_RADIUS; dy <= TABLE_SCAN_RADIUS; dy += 1) {
      for (const id of tableIds) {
        const object = core.MapObjects.get(id, new core.Location(room.getX() + dx, room.getY() + dy, room.getZ()), null);
        if (object) {
          return object;
        }
      }
    }
  }
  return null;
}

/** Stock a supply from the spawn-room tables while standing in the spawn. */
function takeSupply(ctx, state, teamId, itemId, tableIds, target) {
  const player = ctx.player;
  const location = player.getLocation();
  if (!game.getTeamData(teamId).respawnBounds.inside(location)) {
    return "failure";
  }
  const inventory = player.getInventory();
  if (inventory.getAmount(itemId) >= target || inventory.getFreeSlots() === 0) {
    return "failure";
  }
  const table = findSupplyTable(teamId, tableIds);
  if (!table) {
    return "failure";
  }
  const tableLocation = table.getLocation();
  if (
    location.getZ() !== tableLocation.getZ() ||
    chebyshevDistance(location.getX(), location.getY(), tableLocation.getX(), tableLocation.getY()) > 1
  ) {
    return walkTowards(ctx, state, tableLocation.getX(), tableLocation.getY());
  }
  if (ctx.nowMs >= (state.nextTableClickAt ?? 0)) {
    state.nextTableClickAt = ctx.nowMs + 700;
    clickObject(player, table, 2);
  }
  return "running";
}

/** Bandages are the healing supply every bot stocks. */
function takeBandages(ctx, state, teamId) {
  return takeSupply(ctx, state, teamId, core.ItemIdentifiers.BANDAGES, [core.ObjectIdentifiers.TABLE_450, core.ObjectIdentifiers.TABLE_451], BANDAGE_TARGET);
}

/** The catapult crew stocks rocks for the machine. */
function takeRocks(ctx, state, teamId) {
  return takeSupply(ctx, state, teamId, core.ItemIdentifiers.ROCK_5, [core.ObjectIdentifiers.TABLE_455, core.ObjectIdentifiers.TABLE_456], ROCK_TARGET);
}

/** Hold a battlements post: climb up the stair until on the walkway, then stand the tile. */
function battlementPost(ctx, state, teamId, post) {
  const player = ctx.player;
  const [x, y, z] = post;
  const location = player.getLocation();
  if (location.getZ() === z && chebyshevDistance(location.getX(), location.getY(), x, y) <= 1) {
    return "failure";
  }
  if (state.battlementOnDeck && location.getZ() === z) {
    return walkTowards(ctx, state, x, y);
  }
  if (!state.route) {
    beginRoute(state, routes[teamId].battlementUp);
  }
  const result = runRoute(ctx, state);
  if (result === "done") {
    state.route = null;
    state.battlementOnDeck = true;
  } else if (result === "stuck") {
    state.route = null;
    state.battlementOnDeck = false;
  }
  return result === "running" ? "running" : "failure";
}

/** The enemy tile with the most enemies around it; catapult shots land on floor 0. */
function densestEnemyCluster(player, teamId) {
  const enemies = [];
  for (const other of game.gameArea.getPlayers()) {
    if (!isEnemyOf(player, other, teamId)) {
      continue;
    }
    const loc = other.getLocation();
    if (loc.getZ() === 0) {
      enemies.push(loc);
    }
  }
  let best = null;
  let bestScore = 0;
  for (const loc of enemies) {
    let score = 0;
    for (const other of enemies) {
      if (chebyshevDistance(loc.getX(), loc.getY(), other.getX(), other.getY()) <= CATAPULT_TARGET_RADIUS) {
        score += 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = loc;
    }
  }
  return best;
}

/** The catapult crew: drop a rock on the biggest enemy cluster whenever the machine is ready. */
function catapultFireAction(ctx, state, teamId) {
  const player = ctx.player;
  if (typeof game.catapultFire !== "function") {
    return "failure";
  }
  const tile = routes[teamId].battlement.catapultTile;
  const location = player.getLocation();
  if (chebyshevDistance(location.getX(), location.getY(), tile[0], tile[1]) > CATAPULT_HOLD_RANGE) {
    return "failure";
  }
  const target = densestEnemyCluster(player, teamId);
  if (!target) {
    return "failure";
  }
  return game.catapultFire(player, target.getX(), target.getY()) ? "running" : "failure";
}

/**
 * Bandage a hurt teammate in reach - the flag bearer first - or ourselves when critical.
 * The carrier is healed from a little further out, so an escort on their shoulder can top
 * them up while they run.
 */
function bandageTeammate(ctx, state, teamId) {
  const player = ctx.player;
  if (typeof game.useBandageOn !== "function" || player.getInventory().getAmount(core.ItemIdentifiers.BANDAGES) <= 0) {
    return "failure";
  }
  if (ctx.nowMs < (state.nextBandageAt ?? 0)) {
    return "failure";
  }
  const location = player.getLocation();
  let best = null;
  let bestScore = 0;
  for (const other of game.gameArea.getPlayers()) {
    if (other === player || game.getTeamId(other) !== teamId) {
      continue;
    }
    if (other.getPrivateArea?.() !== player.getPrivateArea?.()) {
      continue;
    }
    const otherLocation = other.getLocation();
    if (otherLocation.getZ() !== location.getZ()) {
      continue;
    }
    const carrying = Boolean(game.getCarriedFlagTeam(other));
    const reach = carrying ? BANDAGE_CARRIER_REACH : 2;
    if (chebyshevDistance(location.getX(), location.getY(), otherLocation.getX(), otherLocation.getY()) > reach) {
      continue;
    }
    const max = other.getSkillManager().getMaxLevel(core.Skill.HITPOINTS);
    const current = other.getSkillManager().getCurrentLevel(core.Skill.HITPOINTS);
    if (max <= 0 || current / max > BANDAGE_HEAL_BELOW) {
      continue;
    }
    const score = max - current + (carrying ? max : 0);
    if (score > bestScore) {
      bestScore = score;
      best = other;
    }
  }
  if (best) {
    state.nextBandageAt = ctx.nowMs + BANDAGE_USE_INTERVAL_MS;
    game.useBandageOn(player, best);
    return "running";
  }
  const ownMax = player.getSkillManager().getMaxLevel(core.Skill.HITPOINTS);
  const ownCurrent = player.getSkillManager().getCurrentLevel(core.Skill.HITPOINTS);
  if (ownMax > 0 && ownCurrent / ownMax <= BANDAGE_SELF_BELOW) {
    state.nextBandageAt = ctx.nowMs + BANDAGE_USE_INTERVAL_MS;
    game.useBandageOn(player, player);
    return "running";
  }
  return "failure";
}

/** Capturing a flag needs an empty weapon slot; flag bots never carry one. */
function ensureFlagWeapon(player) {
  if (game.getCarriedFlagTeam(player)) {
    return;
  }
  if (player.getEquipment().getSlot(core.Equipment.WEAPON_SLOT) > 0) {
    game.clearWeaponSlot(player);
  }
}

function findDoorObject(info) {
  for (const [id, x, y, z] of info.leaves) {
    const object = core.MapObjects.get(id, new core.Location(x, y, z), null);
    if (object) {
      return object;
    }
  }
  return null;
}

function attackerDoorRoute(ctx, state, teamId, variant) {
  const chosen = state.attackFallback ? routes[teamId].attackerVariants[0] : variant;
  if (state.outDone) {
    return "failure";
  }
  if (!state.route) {
    beginRoute(state, chosen.out ?? routes[teamId].attackerOut);
  }
  const result = runRoute(ctx, state);
  if (result === "done") {
    state.outDone = true;
    state.route = null;
    return "failure";
  }
  if (result === "stuck") {
    // A blocked variant (a tunnel wall, say) falls back to the standard route once.
    if (!state.attackFallback) {
      state.attackFallback = true;
      state.route = null;
    }
    return "failure";
  }
  return "running";
}

/**
 * Once the attacker has reached the enemy door, walk through it when it is open or broken
 * and push up the enemy's own climb chain to their flag room, where the carrier and the
 * guards are. A shut door leaves the bashing node (checked first) to do its job.
 */
function attackerRaidRoute(ctx, state, teamId, variant) {
  const chosen = state.attackFallback ? routes[teamId].attackerVariants[0] : variant;
  if (!state.outDone || state.raidDone || !chosen.raid) {
    return "failure";
  }
  if (chosen.needsDoor !== false && findDoorObject(routes[teamId].door)) {
    return "failure";
  }
  if (!state.route) {
    beginRoute(state, chosen.raid);
  }
  const result = runRoute(ctx, state);
  if (result === "running" || result === "stuck") {
    return "running";
  }
  state.route = null;
  state.raidDone = true;
  return "failure";
}

/** Swing at the enemy large door when adjacent; the door swing is rooted, so no walking meanwhile. */
function attackEnemyDoor(ctx, state, teamId) {
  const player = ctx.player;
  const info = routes[teamId].door;
  if (game.getTeamVar(game.opposingTeam(teamId), game.TEAM_VARBIT.DOOR_HEALTH) <= 0) {
    return "failure";
  }
  const object = findDoorObject(info);
  const location = player.getLocation();
  if (process.env.CW_BOT_DEBUG === "1" && ctx.nowMs >= (state.nextDoorDebugAt ?? 0)) {
    state.nextDoorDebugAt = ctx.nowMs + 10000;
    const target = object?.getLocation();
    console.log(
      `[cw_bot] door_probe ${player.getUsername?.()} team=${teamId} obj=${object ? `${object.getId()}@${target.getX()},${target.getY()},${target.getZ()}` : "null"} at=${location.getX()},${location.getY()},${location.getZ()} routeCursor=${state.cursor}`
    );
  }
  if (!object) {
    return "failure";
  }
  const objectLocation = object.getLocation();
  const distance = chebyshevDistance(
    location.getX(),
    location.getY(),
    objectLocation.getX(),
    objectLocation.getY()
  );
  if (location.getZ() !== objectLocation.getZ() || distance > 2) {
    return "failure";
  }
  if (ctx.nowMs < state.nextDoorClickAt) {
    return "running";
  }
  state.nextDoorClickAt = ctx.nowMs + DOOR_CLICK_INTERVAL_MS;
  if (player.getCombat().getTarget?.()) {
    player.getCombat().reset();
  }
  if (process.env.CW_BOT_DEBUG === "1") {
    console.log(`[cw_bot] door_swing ${player.getUsername?.()} team=${teamId} at=${location.getX()},${location.getY()} doorHp=${game.getTeamVar(game.opposingTeam(teamId), game.TEAM_VARBIT.DOOR_HEALTH)}`);
  }
  clickObject(player, object, attackOptionIndex(object.getDefinition?.()));
  return "running";
}

/** Attacker fallback: hold just outside the enemy door so it reloads onto the click tile. */
function holdNearDoor(ctx, state, teamId) {
  const player = ctx.player;
  const [x, y] = routes[teamId].door.approach;
  const location = player.getLocation();
  if (location.getZ() !== 0 || chebyshevDistance(location.getX(), location.getY(), x, y) <= 1) {
    return "running";
  }
  return walkTowards(ctx, state, x, y);
}

function guardAttack(ctx, teamId) {
  const stand = game.getTeamData(teamId).standLocation;
  return attackEnemies(ctx, teamId, GUARD_ENGAGE_RANGE, [stand.getX(), stand.getY()], GUARD_LEASH);
}

/**
 * Guards fetch their own flag when it drops near the stand and click the stand to put it
 * back (Flags.CastleWars.returnCarriedFlag); without this the flags sit in enemy hands and
 * neither team can ever score.
 */
function guardReturnFlag(ctx, state, teamId) {
  const player = ctx.player;
  const carried = game.getCarriedFlagTeam(player);
  if (carried && carried !== teamId) {
    return "failure";
  }
  const stand = findStandObject(teamId);
  if (!stand) {
    return "failure";
  }
  const standLocation = stand.getLocation();
  const location = player.getLocation();
  if (carried === teamId) {
    if (location.getZ() !== standLocation.getZ() || chebyshevDistance(location.getX(), location.getY(), standLocation.getX(), standLocation.getY()) > 1) {
      return walkTowards(ctx, state, standLocation.getX(), standLocation.getY());
    }
    if (ctx.nowMs >= (state.nextFlagClickAt ?? 0)) {
      state.nextFlagClickAt = ctx.nowMs + FLAG_CLICK_INTERVAL_MS;
      clickObject(player, stand, 1);
    }
    return "running";
  }
  if (game.flagStatus[teamId] !== 2) {
    return "failure";
  }
  const dropped = findDroppedFlag(teamId);
  if (!dropped) {
    return "failure";
  }
  const flagLocation = dropped.getLocation();
  if (location.getZ() !== flagLocation.getZ() || chebyshevDistance(location.getX(), location.getY(), flagLocation.getX(), flagLocation.getY()) > 1) {
    return walkTowards(ctx, state, flagLocation.getX(), flagLocation.getY());
  }
  if (ctx.nowMs >= (state.nextFlagClickAt ?? 0)) {
    state.nextFlagClickAt = ctx.nowMs + FLAG_CLICK_INTERVAL_MS;
    clickObject(player, dropped, 1);
  }
  return "running";
}

/** Climb back to the team's stand after a chase or a respawn; never leaves the guard post idle. */
function guardPost(ctx, state, teamId) {
  const player = ctx.player;
  const stand = game.getTeamData(teamId).standLocation;
  const location = player.getLocation();
  const near =
    location.getZ() === stand.getZ() &&
    chebyshevDistance(location.getX(), location.getY(), stand.getX(), stand.getY()) <= GUARD_HOLD_RANGE;
  if (near) {
    return "failure";
  }
  if (!state.route) {
    beginRoute(state, routes[teamId].guardUp);
  }
  const result = runRoute(ctx, state);
  if (result === "done") {
    state.route = null;
  }
  return "running";
}

/** True when a teammate stands on or next to the doorway; don't shut it on them. */
function teammateNearDoor(player, teamId, clearTiles) {
  const location = player.getLocation();
  for (const other of game.gameArea.getPlayers()) {
    if (other === player || game.getTeamId(other) !== teamId) {
      continue;
    }
    if (other.getPrivateArea?.() !== player.getPrivateArea?.()) {
      continue;
    }
    const otherLocation = other.getLocation();
    if (otherLocation.getZ() !== location.getZ()) {
      continue;
    }
    for (const [x, y] of clearTiles) {
      if (chebyshevDistance(otherLocation.getX(), otherLocation.getY(), x, y) <= DOORMAN_CLEAR_RADIUS) {
        return true;
      }
    }
  }
  return false;
}

/** The stationed door guard: shut the team's own large door once teammates have cleared it. */
function doormanCloseDoor(ctx, state, teamId) {
  const player = ctx.player;
  const info = routes[teamId].doorman;
  // Only from the door's own floor: from upstairs this node used to hijack the whole tree
  // trying to path down to the outside post, and the doorman never left the spawn.
  if (player.getLocation().getZ() !== info.post[2]) {
    return "failure";
  }
  // Only from his outside station: stepping in from the castle he would shut the door on
  // himself mid-exit. The route walks him out first, then this node takes over.
  const doorwayY = info.clear[0][1];
  if (Math.sign(player.getLocation().getY() - doorwayY) !== Math.sign(info.post[1] - doorwayY)) {
    return "failure";
  }
  let openLeaf = null;
  for (const [id, x, y, z] of info.open) {
    const object = core.MapObjects.get(id, new core.Location(x, y, z), null);
    if (object) {
      openLeaf = object;
      break;
    }
  }
  if (!openLeaf) {
    return "failure";
  }
  const location = player.getLocation();
  const leafLocation = openLeaf.getLocation();
  if (
    location.getZ() !== leafLocation.getZ() ||
    chebyshevDistance(location.getX(), location.getY(), leafLocation.getX(), leafLocation.getY()) > 2
  ) {
    return walkTowards(ctx, state, info.post[0], info.post[1]);
  }
  if (teammateNearDoor(player, teamId, info.clear)) {
    return "failure";
  }
  if (ctx.nowMs >= state.nextDoorClickAt) {
    state.nextDoorClickAt = ctx.nowMs + DOOR_CLICK_INTERVAL_MS;
    clickObject(player, openLeaf, closeOptionIndex(openLeaf.getDefinition?.()));
  }
  return "running";
}

/** Back to the doorway after a chase or a respawn. */
function doormanPost(ctx, state, teamId) {
  const player = ctx.player;
  const info = routes[teamId].doorman;
  const [x, y, z] = info.post;
  const location = player.getLocation();
  // Exact tile: after closing he is standing on the doorway tile and must step back out.
  if (location.getZ() === z && location.getX() === x && location.getY() === y) {
    return "failure";
  }
  if (location.getZ() === z) {
    // Already on the outside: walk straight back to the gate post instead of the spawn chain.
    const doorwayY = info.clear[0][1];
    if (Math.sign(location.getY() - doorwayY) === Math.sign(y - doorwayY)) {
      return walkTowards(ctx, state, x, y);
    }
  }
  if (!state.route) {
    beginRoute(state, routes[teamId].doormanUp);
  }
  const result = runRoute(ctx, state);
  if (result === "done" || result === "stuck") {
    state.route = null;
  }
  return result === "running" ? "running" : "failure";
}

/** The open side door of the team's own castle, wherever its swing moved it. */
function findOpenSideDoor(info) {
  const [x, y, z] = info.door;
  for (let dx = -2; dx <= 2; dx += 1) {
    for (let dy = -2; dy <= 2; dy += 1) {
      const object = core.MapObjects.get(info.openId, new core.Location(x + dx, y + dy, z), null);
      if (object) {
        return object;
      }
    }
  }
  return null;
}

/** The side-door keeper: relock the team's side door as soon as it stands open. */
function sideDoormanLockDoor(ctx, state, teamId) {
  const player = ctx.player;
  const info = routes[teamId].sideDoor;
  if (player.getLocation().getZ() !== info.post[2]) {
    return "failure";
  }
  const openDoor = findOpenSideDoor(info);
  if (!openDoor) {
    return "failure";
  }
  const location = player.getLocation();
  const doorLocation = openDoor.getLocation();
  if (
    location.getZ() !== doorLocation.getZ() ||
    chebyshevDistance(location.getX(), location.getY(), doorLocation.getX(), doorLocation.getY()) > 2
  ) {
    return walkTowards(ctx, state, info.post[0], info.post[1]);
  }
  if (ctx.nowMs >= state.nextDoorClickAt) {
    state.nextDoorClickAt = ctx.nowMs + DOOR_CLICK_INTERVAL_MS;
    clickObject(player, openDoor, lockOptionIndex(openDoor.getDefinition?.()));
  }
  return "running";
}

/** Back to the side door after a chase or a respawn. */
function sideDoormanPost(ctx, state, teamId) {
  const player = ctx.player;
  const [x, y, z] = routes[teamId].sideDoor.post;
  const location = player.getLocation();
  if (location.getZ() === z && chebyshevDistance(location.getX(), location.getY(), x, y) <= 1) {
    return "failure";
  }
  if (!state.route) {
    beginRoute(state, routes[teamId].sideDoorUp);
  }
  const result = runRoute(ctx, state);
  if (result === "done" || result === "stuck") {
    state.route = null;
  }
  return result === "running" ? "running" : "failure";
}

/**
 * The whole flag loop: out to the enemy standard, capture it (or pick a dropped one up),
 * carry it home along the map's own descent chains, score at the own stand, then walk back
 * down for the next run.
 */
function flagCycle(ctx, state, teamId) {
  const player = ctx.player;
  const nowMs = ctx.nowMs;
  const enemyTeam = game.opposingTeam(teamId);
  if (
    process.env.CW_BOT_DEBUG === "1" &&
    player.getUsername?.() === process.env.CW_BOT_DEBUG_USER &&
    nowMs >= (state.nextFlagDebugAt ?? 0)
  ) {
    state.nextFlagDebugAt = nowMs + 5000;
    console.log(
      `[cw_bot] flag_probe ${player.getUsername?.()} mode=${state.flagMode} carried=${game.getCarriedFlagTeam(player) ?? "none"} ownFlag=${game.flagStatus[teamId]} enemyFlag=${game.flagStatus[enemyTeam]} route=${state.route ? "set" : "null"} cursor=${state.cursor} at=${player.getLocation().getX()},${player.getLocation().getY()},${player.getLocation().getZ()}`
    );
  }
  ensureFlagWeapon(player);
  if (!state.flagMode) {
    state.flagMode = FLAG_MODE.OUT;
  }

  if (state.flagMode === FLAG_MODE.OUT) {
    const carried = game.getCarriedFlagTeam(player);
    if (carried) {
      // Enemy flag: captured. Own flag: picked up from the floor mid-raid. Either way the
      // way home is the same and the own stand sorts out scoring from returning.
      if (process.env.CW_BOT_DEBUG === "1") {
        console.log(`[cw_bot] flag_carry_home ${player.getUsername?.()} flag=${carried} at=${player.getLocation().getX()},${player.getLocation().getY()},${player.getLocation().getZ()}`);
      }
      state.flagMode = FLAG_MODE.HOME;
      state.route = null;
      return "running";
    }
    if (!state.route) {
      beginRoute(state, routes[teamId].flagOut);
    }
    const result = runRoute(ctx, state);
    if (result === "done") {
      const ownDropped = game.flagStatus[teamId] === 2 ? findDroppedFlag(teamId, enemyTeam) : null;
      if (ownDropped) {
        const dropLocation = ownDropped.getLocation();
        const location = player.getLocation();
        if (location.getZ() === dropLocation.getZ() && chebyshevDistance(location.getX(), location.getY(), dropLocation.getX(), dropLocation.getY()) <= 1) {
          if (nowMs >= state.nextStandClickAt) {
            state.nextStandClickAt = nowMs + FLAG_CLICK_INTERVAL_MS;
            clickObject(player, ownDropped, 1);
          }
          return "running";
        }
        return walkTowards(ctx, state, dropLocation.getX(), dropLocation.getY());
      }
      if (nowMs >= state.nextStandClickAt) {
        state.nextStandClickAt = nowMs + STAND_RETRY_MS;
        if (game.flagStatus[enemyTeam] === 0) {
          const stand = findStandObject(enemyTeam);
          if (stand) {
            clickObject(player, stand, 1);
          }
        } else if (game.flagStatus[enemyTeam] === 2) {
          const dropped = findDroppedFlag(enemyTeam);
          if (dropped) {
            clickObject(player, dropped, 1);
          }
        }
      }
      if (game.getCarriedFlagTeam(player)) {
        state.flagMode = FLAG_MODE.HOME;
        state.route = null;
      }
      return "running";
    }
    return "running";
  }

  if (state.flagMode === FLAG_MODE.HOME) {
    if (!game.getCarriedFlagTeam(player)) {
      // Died (or the flag went home): start again from wherever the respawn left the bot.
      state.flagMode = FLAG_MODE.OUT;
      state.route = null;
      return "running";
    }
    if (!state.route) {
      beginRoute(state, routes[teamId].flagHome);
    }
    const result = runRoute(ctx, state);
    if (result === "done") {
      if (nowMs >= state.nextStandClickAt) {
        state.nextStandClickAt = nowMs + STAND_RETRY_MS;
        const stand = findStandObject(teamId);
        if (stand) {
          if (process.env.CW_BOT_DEBUG === "1") {
            console.log(`[cw_bot] flag_score_click ${player.getUsername?.()} ownFlag=${game.flagStatus[teamId]} enemyFlag=${game.flagStatus[enemyTeam]}`);
          }
          clickObject(player, stand, 1);
        }
      }
      if (!game.getCarriedFlagTeam(player)) {
        state.flagMode = FLAG_MODE.BACK;
        state.route = null;
      }
      return "running";
    }
    return "running";
  }

  // FLAG_MODE.BACK: scored, walk the own-castle chain down to the island and go again.
  if (game.getCarriedFlagTeam(player)) {
    state.flagMode = FLAG_MODE.HOME;
    state.route = null;
    return "running";
  }
  if (!state.route) {
    beginRoute(state, routes[teamId].descent);
  }
  const result = runRoute(ctx, state);
  if (result === "done") {
    state.flagMode = FLAG_MODE.OUT;
    state.route = null;
  }
  return "running";
}

/**
 * Attackers double as flag runners for a standard already on the floor: within a short walk
 * they pick the enemy flag up (dropping their own weapon for the free slot) and carry it
 * home along the flag runner's own home route. This is what turns a won fight into a point.
 */
function recoverEnemyFlag(ctx, state, teamId) {
  const player = ctx.player;
  const enemyTeam = game.opposingTeam(teamId);
  const carried = game.getCarriedFlagTeam(player);
  if (carried) {
    return carried === enemyTeam ? carryEnemyFlagHome(ctx, state, teamId) : "failure";
  }
  if (game.flagStatus[enemyTeam] !== 2) {
    return "failure";
  }
  const dropped = game.getDroppedFlagObject?.(enemyTeam);
  if (!dropped) {
    return "failure";
  }
  const location = player.getLocation();
  const flagLocation = dropped.getLocation();
  if (location.getZ() !== flagLocation.getZ()) {
    return "failure";
  }
  const distance = chebyshevDistance(
    location.getX(),
    location.getY(),
    flagLocation.getX(),
    flagLocation.getY()
  );
  if (distance > RECOVER_FLAG_RADIUS) {
    return "failure";
  }
  if (distance > 1) {
    return walkTowards(ctx, state, flagLocation.getX(), flagLocation.getY());
  }
  // Capturing needs an empty weapon slot; the weapon is restored once the run is over.
  if (player.getEquipment().getSlot(core.Equipment.WEAPON_SLOT) > 0) {
    game.clearWeaponSlot(player);
  }
  if (ctx.nowMs >= (state.nextFlagClickAt ?? 0)) {
    state.nextFlagClickAt = ctx.nowMs + FLAG_CLICK_INTERVAL_MS;
    clickObject(player, dropped, 1);
  }
  return "running";
}

/** Carry the enemy standard home along the flag runner's route, then score at the stand. */
function carryEnemyFlagHome(ctx, state, teamId) {  const player = ctx.player;
  const enemyTeam = game.opposingTeam(teamId);
  if (game.getCarriedFlagTeam(player) !== enemyTeam) {
    // Scored, died, or the standard went home: resume normal attacking and re-gear (the
    // weapon was dropped to pick the flag up).
    state.route = null;
    state.equipped = false;
    return "failure";
  }
  if (!state.route) {
    beginRoute(state, routes[teamId].carryHome);
  }
  const result = runRoute(ctx, state);
  if (result === "done") {
    if (ctx.nowMs >= (state.nextStandClickAt ?? 0)) {
      state.nextStandClickAt = ctx.nowMs + STAND_RETRY_MS;
      const stand = findStandObject(teamId);
      if (stand) {
        clickObject(player, stand, 1);
      }
    }
  } else if (result === "stuck") {
    state.route = null;
  }
  return "running";
}

// --- Controllers -------------------------------------------------------------------------

/** The own-team player currently carrying the enemy standard, or null. */
function teamFlagCarrier(teamId) {
  const enemyTeam = game.opposingTeam(teamId);
  for (const other of game.gameArea.getPlayers()) {
    if (game.getTeamId(other) === teamId && game.getCarriedFlagTeam(other) === enemyTeam) {
      return other;
    }
  }
  return null;
}

/** The enemy most dangerous to the carrier: their attacker first, else the nearest one. */
function carrierThreat(player, teamId, carrier, range) {
  const attacker = carrier.getCombat?.().getAttacker?.();
  if (attacker && isEnemyOf(player, attacker, teamId) && canEngage(player, attacker)) {
    return attacker;
  }
  const carrierLocation = carrier.getLocation();
  let best = null;
  let bestDistance = range + 1;
  for (const other of game.gameArea.getPlayers()) {
    if (!isEnemyOf(player, other, teamId) || !canEngage(player, other)) {
      continue;
    }
    const otherLocation = other.getLocation();
    if (otherLocation.getZ() !== carrierLocation.getZ()) {
      continue;
    }
    const distance = chebyshevDistance(
      otherLocation.getX(),
      otherLocation.getY(),
      carrierLocation.getX(),
      carrierLocation.getY()
    );
    if (distance < bestDistance) {
      best = other;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Escort duty: while a teammate carries the enemy standard, nearby teammates walk with
 * them and fight whoever closes in, so the capture is not lost to a chaser. Attackers and
 * idle flag runners use this; guards keep their post.
 */
function escortFlagCarrier(ctx, state, teamId) {
  const player = ctx.player;
  if (game.getCarriedFlagTeam(player)) {
    return "failure";
  }
  const carrier = teamFlagCarrier(teamId);
  if (!carrier || carrier === player) {
    return "failure";
  }
  const location = player.getLocation();
  const carrierLocation = carrier.getLocation();
  if (
    location.getZ() !== carrierLocation.getZ() ||
    chebyshevDistance(location.getX(), location.getY(), carrierLocation.getX(), carrierLocation.getY()) > ESCORT_RADIUS
  ) {
    return "failure";
  }
  // Fight whoever is on the carrier (or chasing us beside them).
  const threat =
    carrierThreat(player, teamId, carrier, ESCORT_ENGAGE_RANGE) ??
    currentEnemyTarget(player, teamId, [carrierLocation.getX(), carrierLocation.getY()], ESCORT_ENGAGE_RANGE);
  if (threat) {
    const permission = core.CombatFactory.canAttackPermission(
      player,
      threat,
      false,
      core.CombatFactory.getMethod(player)
    );
    if (permission === core.CanAttackResponse.CAN_ATTACK) {
      player.getCombat().attack(threat);
      return "running";
    }
  }
  const distance = chebyshevDistance(
    location.getX(),
    location.getY(),
    carrierLocation.getX(),
    carrierLocation.getY()
  );
  if (distance > ESCORT_STAND_RANGE) {
    return walkTowards(ctx, state, carrierLocation.getX(), carrierLocation.getY());
  }
  // On their shoulder: hold, re-checking for threats every tick.
  return "running";
}

/** The username's numeric suffix (CWBotZ42 -> 42), a stable per-slot seed. */
function botNumber(player) {
  const digits = Number(String(player?.getUsername?.() ?? "").replace(/\D+/g, ""));
  return Number.isFinite(digits) ? digits : 0;
}

/** 0/1 spread index, so a pair of posters (archer/mage) splits between the two tiles. */
function postIndex(player) {
  return variantIndex(player, 2);
}

/** Slot of this bot across `length` options (routes, posts); the pool spreads by username. */
function variantIndex(player, length) {
  return botNumber(player) % Math.max(1, length);
}

function createBotTree(role, state, teamId, player) {
  if (role === ROLES.SCORER) {
    return new SelectorNode([
      new ActionNode((ctx) => game.practiceBots.scorerTools(ctx, state)),
      new ActionNode((ctx) => takeBandages(ctx, state, teamId)),
      new ActionNode((ctx) => bandageTeammate(ctx, state, teamId)),
      new ActionNode((ctx) => flagCycle(ctx, state, teamId)),
    ]);
  }
  if (role === ROLES.DEFENDER) {
    const target = () => nearestEnemyCarrier(player, teamId, 16) ?? nearestEnemy(player, teamId, 10);
    return new SelectorNode([
      new ActionNode((ctx) => takeBandages(ctx, state, teamId)),
      new ActionNode((ctx) => bandageTeammate(ctx, state, teamId)),
      new ActionNode((ctx) => game.practiceBots.defenderTools(ctx, state, target())),
      new ActionNode((ctx) => game.practiceBots.defenderAttack(ctx, state, target())),
      new ActionNode((ctx) => guardReturnFlag(ctx, state, teamId)),
      new ActionNode((ctx) => guardPost(ctx, state, teamId)),
      new ActionNode(() => "running"),
    ]);
  }
  // Each selector is a priority list, first match wins. Bandages sit high for support roles
  // so a hurt teammate is healed between fights; the final node keeps idle bots alive.
  if (role === ROLES.GUARD) {
    // Kill intruders by the stand, return the team's dropped flag, heal, then climb back.
    return new SelectorNode([
      new ActionNode((ctx) => guardAttack(ctx, teamId)),
      new ActionNode((ctx) => guardReturnFlag(ctx, state, teamId)),
      new ActionNode((ctx) => takeBandages(ctx, state, teamId)),
      new ActionNode((ctx) => bandageTeammate(ctx, state, teamId)),
      new ActionNode((ctx) => guardPost(ctx, state, teamId)),
      new ActionNode(() => "running"),
    ]);
  }
  if (role === ROLES.FLAG) {
    // A runner whose teammate already has the enemy standard escorts them home instead of
    // standing at the enemy stand waiting; otherwise it heals and runs the capture loop.
    return new SelectorNode([
      new ActionNode((ctx) => takeBandages(ctx, state, teamId)),
      new ActionNode((ctx) => bandageTeammate(ctx, state, teamId)),
      new ActionNode((ctx) => escortFlagCarrier(ctx, state, teamId)),
      new ActionNode((ctx) => flagCycle(ctx, state, teamId)),
    ]);
  }
  if (role === ROLES.DOORMAN) {
    // Shut the large door on teammates' heels, fight at the gate, then return to post.
    return new SelectorNode([
      new ActionNode((ctx) => doormanCloseDoor(ctx, state, teamId)),
      new ActionNode((ctx) => attackEnemies(ctx, teamId, DOORMAN_ENGAGE_RANGE, routes[teamId].doorman.post, DOORMAN_LEASH)),
      new ActionNode((ctx) => takeBandages(ctx, state, teamId)),
      new ActionNode((ctx) => bandageTeammate(ctx, state, teamId)),
      new ActionNode((ctx) => doormanPost(ctx, state, teamId)),
      new ActionNode(() => "running"),
    ]);
  }
  if (role === ROLES.SIDE_DOORMAN) {
    // Relock the castle's side door whenever someone opens it, otherwise guard the area.
    return new SelectorNode([
      new ActionNode((ctx) => sideDoormanLockDoor(ctx, state, teamId)),
      new ActionNode((ctx) => attackEnemies(ctx, teamId, DOORMAN_ENGAGE_RANGE, routes[teamId].sideDoor.post, DOORMAN_LEASH)),
      new ActionNode((ctx) => takeBandages(ctx, state, teamId)),
      new ActionNode((ctx) => bandageTeammate(ctx, state, teamId)),
      new ActionNode((ctx) => sideDoormanPost(ctx, state, teamId)),
      new ActionNode(() => "running"),
    ]);
  }
  if (role === ROLES.ARCHER || role === ROLES.MAGE) {
    // Fire from a fixed battlements post; the pair splits by username parity.
    const pair = routes[teamId].battlement[role === ROLES.ARCHER ? "archer" : "mage"];
    const post = pair[postIndex(player)] ?? pair[0];
    return new SelectorNode([
      new ActionNode((ctx) => takeBandages(ctx, state, teamId)),
      new ActionNode((ctx) => bandageTeammate(ctx, state, teamId)),
      new ActionNode((ctx) => attackEnemies(ctx, teamId, ARCHER_ENGAGE_RANGE, post, ARCHER_LEASH)),
      new ActionNode((ctx) => battlementPost(ctx, state, teamId, post)),
    ]);
  }
  if (role === ROLES.CATAPULT) {
    // Stock rocks, fire at the densest enemy cluster, then fight/return to the machine.
    const info = routes[teamId].battlement;
    return new SelectorNode([
      new ActionNode((ctx) => takeRocks(ctx, state, teamId)),
      new ActionNode((ctx) => takeBandages(ctx, state, teamId)),
      new ActionNode((ctx) => catapultFireAction(ctx, state, teamId)),
      new ActionNode((ctx) => attackEnemies(ctx, teamId, ARCHER_ENGAGE_RANGE, info.catapult, ARCHER_LEASH)),
      new ActionNode((ctx) => battlementPost(ctx, state, teamId, info.catapult)),
    ]);
  }
  // Attackers: one of four route variants, spread over the whole pool by the bot's slot
  // number (a % 2 parity index used to collapse every squad onto the two stone crossings).
  const variants = routes[teamId].attackerVariants;
  const variant = variants[variantIndex(player, variants.length)] ?? variants[0];
  return new SelectorNode([
    // A loose enemy standard (or one already in hand) beats every other attacker job. Stock
    // bandages and heal (the flag bearer first) before protecting the carrier, fighting and
    // pushing the door.
    new ActionNode((ctx) => recoverEnemyFlag(ctx, state, teamId)),
    new ActionNode((ctx) => takeBandages(ctx, state, teamId)),
    new ActionNode((ctx) => bandageTeammate(ctx, state, teamId)),
    new ActionNode((ctx) => escortFlagCarrier(ctx, state, teamId)),
    // At the enemy door the swing is the job, even with defenders around: the rooted
    // swing is only cancelled by moving, so fighting first meant the door never fell.
    new ActionNode((ctx) => attackEnemyDoor(ctx, state, teamId)),
    new ActionNode((ctx) => attackEnemies(ctx, teamId, ATTACKER_ENGAGE_RANGE, null, ATTACKER_LEASH)),
    new ActionNode((ctx) => attackerDoorRoute(ctx, state, teamId, variant)),
    new ActionNode((ctx) => attackerRaidRoute(ctx, state, teamId, variant)),
    new ActionNode((ctx) => holdNearDoor(ctx, state, teamId)),
  ]);
}

function controllerFor(player, teamId, role, nowMs) {
  const existing = botControllers.get(player);
  if (existing) {
    return existing;
  }
  const startRoom = game.getTeamData(teamId).startRoom;
  const state = {
    role,
    equipped: false,
    // Spread the first preset generation over a couple of seconds: 40 bots entering the
    // game area on the same tick would otherwise all build their loadout in that tick.
    nextLoadoutAt: nowMs + Math.floor(Math.random() * 1500),
    route: null,
    cursor: 0,
    pendingClimb: null,
    nextWalkAt: 0,
    nextClimbAt: 0,
    routeActive: false,
    lastTile: null,
    lastMovedAt: 0,
    flagMode: null,
    nextStandClickAt: 0,
    nextDoorClickAt: 0,
    outDone: false,
    raidDone: false,
  };
  botStates.set(player, state);
  const controller = new BotController(
    player,
    startRoom.getX(),
    startRoom.getY(),
    startRoom.getZ(),
    createBotTree(role, state, teamId, player)
  );
  botControllers.set(player, controller);
  return controller;
}

/** Forget any in-flight route, keeping the applied loadout. */
function resetRouteState(state) {
  state.route = null;
  state.cursor = 0;
  state.pendingClimb = null;
  state.stonesStep = null;
  state.stonePath = null;
  state.stoneIndex = 0;
  state.pendingStone = null;
  state.routeActive = false;
  state.flagMode = null;
  state.nextStandClickAt = 0;
  state.outDone = false;
  state.raidDone = false;
  state.battlementOnDeck = false;
  state.attackFallback = false;
}

function processBot(player) {
  if (player.getAttribute(game.BOT_KEY) !== true) {
    return;
  }
  const teamId = game.getTeamId(player);
  if (teamId == null || !game.isPlaying(player)) {
    return;
  }
  const nowMs = Date.now();
  const role = roleOf(player) ?? ROLES.ATTACKER;
  const existing = botStates.get(player);
  if (existing && existing.role !== role) {
    // The role can change while a headless test repurposes a bot; rebuild its tree.
    botControllers.delete(player);
    botStates.delete(player);
  }
  const controller = controllerFor(player, teamId, role, nowMs);
  const state = botStates.get(player);
  if (player.getHitpoints() <= 0) {
    resetRouteState(state);
    // Castle Wars death strips the gear like any death; refill on respawn or the bot
    // walks out of the spawn room naked and hoodless.
    state.equipped = false;
    state.colours = false;
    return;
  }
  if (game.getTeamData(teamId).respawnBounds.inside(player.getLocation())) {
    resetRouteState(state);
  }
  ensureLoadout(player, state, teamId, nowMs);
  controller.tick(nowMs);
}

function clearBots() {
  botControllers.clear();
  botStates.clear();
}

function forgetBot({ player }) {
  botControllers.delete(player);
  botStates.delete(player);
}

module.exports = function attachCastleWarsBots(registry, castleWars) {
  api = registry;
  game = castleWars;
  core = api.core;
  initPvpTierLoadouts(api);
  routes = buildRoutes(core, game.TEAM);
  // A dedicated task, not the area's inGameProcessors: the world strides idle player
  // bots (seconds between turns), far too slow for one-hop-per-tick route steps.
  const task = new core.Task(1);
  task.execute = () => {
    task.calls = (task.calls ?? 0) + 1;
    if (process.env.CW_BOT_DEBUG === "1" && task.calls % 100 === 0) {
      const inArea = game.gameArea ? game.gameArea.getPlayers().filter((p) => p.isPlayerBot?.() === true).length : -1;
      console.log(`[cw_bot] heartbeat calls=${task.calls} phase=${game.getPhase()} bots=${inArea}`);
    }
    if (game.getPhase() !== game.PHASE.ACTIVE || !game.gameArea) {
      prepareWaitingRoomBots(Date.now());
      return;
    }
    for (const player of [...game.gameArea.getPlayers()]) {
      if (player.isPlayerBot?.() === true) {
        processBot(player);
      }
    }
  };
  api.getTaskManager?.()?.submit?.(task);
  api.onCustomEvent("castlewars:reset", clearBots);
  api.onPlayerLogout(forgetBot);
  api.registerCommand?.("endcw", () => game.endGame(), PlayerRights.OWNER, "End the current Castle Wars game.");
};

/**
 * Bots wait in the lobby already geared: the loadout spread (controllerFor's per-bot
 * nextLoadoutAt) keeps the lobby tick light, and the match starts with everyone dressed
 * instead of 80 bots generating loadouts on the first active tick.
 */
function prepareWaitingRoomBots(nowMs) {
  const areas = [game.lobbyArea, ...Object.values(game.waitingAreas ?? {})].filter(Boolean);
  for (const area of areas) {
    for (const player of [...area.getPlayers()]) {
      if (player.isPlayerBot?.() !== true || player.getAttribute(game.BOT_KEY) !== true) {
        continue;
      }
      const teamId = game.getTeamId(player);
      if (teamId == null) {
        continue;
      }
      const role = roleOf(player) ?? ROLES.ATTACKER;
      controllerFor(player, teamId, role, nowMs);
      const state = botStates.get(player);
      ensureLoadout(player, state, teamId, nowMs);
      // Idle bots drift around the room now and then, not constantly.
      if (nowMs >= (state.nextWanderAt ?? 0) && player.getMovementQueue().size() === 0) {
        state.nextWanderAt = nowMs + 8000 + Math.floor(Math.random() * 12000);
        const bounds = game.getTeamData(teamId).waitingBounds[0];
        if (bounds) {
          const x = bounds.getX() + Math.floor(Math.random() * (bounds.getX2() - bounds.getX() + 1));
          const y = bounds.getY() + Math.floor(Math.random() * (bounds.getY2() - bounds.getY() + 1));
          core.PathFinder.calculateWalkRoute(player, x, y);
        }
      }
    }
  }
}

module.exports._test = {
  buildRoutes,
  runRoute,
  firstStepOnFloor,
  attackOptionIndex,
  walkLineBlocked,
  botNumber,
  variantIndex,
  pickTierChoice,
  tierCombatLevel,
  TIER_BANDS,
  TIER_PROFILE_IDS,
  ROLES,
  DEFAULT_BOT_ROLE_KEY,
  DEFAULT_BOT_TIER_KEY,
};
