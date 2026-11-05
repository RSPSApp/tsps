const { ObjectIds } = require("../../../../src/main/typescript/elvarg/util/IdEnums");
const { Anim } = require("../Constants.Agility");
const { climb, balance } = require("../Steps.Agility");

/** Shows the lap's shortcut portal (1-6), 0 hides it. RuneLite: PRIF_AGILITY_SHORTCUT_TRANSMIT. */
const PORTAL_VARBIT = 9298;
const PORTAL_ATTRIBUTE = "agility.prifddinas.portal";
/**
 * The six portal locs (prif_agility_shortcut_portal_1-6), each shown as the "Portal" (36240) while
 * the varbit holds its number. A click names the placed loc (rsprox 1149: 36241, 36246).
 */
const PORTAL_LOCS = [36241, 36242, 36243, 36244, 36245, 36246];
/** Portal XP: 819 tenths (rsprox 1149, at the Leagues' 16x); the Wiki rounds it to 82. */
const PORTAL_XP = 81.9;

/**
 * From the first dark hole on, the course is played in the copy of its rooftops south-west of
 * the city (1024 west, 2752 south), as live OSRS teleports there (rsprox capture 1149); the last
 * dark hole brings the player back up to the city.
 *
 * Each lap one portal opens (Wiki: one of six, at random). It appears as obstacle `after` is begun
 * (rsprox 1149: portal 1 on the tick the ladder is climbed, portal 6 on the tick the third
 * tightrope is), stands on `at`, and drops the player at `exit`, continuing the lap as if obstacle
 * `skipTo` was done.
 */
const PORTALS = [
  { after: 1, at: [3257, 6111, 2], exit: [3275, 6105, 2], skipTo: 2 },
  { after: 4, at: [3270, 6116, 0], exit: [2268, 3389, 2], skipTo: 6 },
  { after: 7, at: [2258, 3386, 2], exit: [2244, 3394, 2], skipTo: 8 },
  { after: 8, at: [2243, 3395, 2], exit: [2247, 3405, 2], skipTo: 9 },
  { after: 9, at: [2248, 3405, 2], exit: [2253, 3415, 2], skipTo: 10 },
  { after: 10, at: [2249, 3419, 2], exit: [2262, 3426, 0], skipTo: 11 },
];

function setPortal(player, portal) {
  player.setAttribute(PORTAL_ATTRIBUTE, portal);
  player.getPacketSender().sendVarbit(PORTAL_VARBIT, portal);
}

/** Picks this lap's portal; it stays hidden until its obstacle is begun. */
function choosePortal(player) {
  player.setAttribute(PORTAL_ATTRIBUTE, 1 + Math.floor(Math.random() * PORTALS.length));
  player.getPacketSender().sendVarbit(PORTAL_VARBIT, 0);
  revealPortal(player, 1);
}

/** Opens this lap's portal as the obstacle before it is begun. */
function revealPortal(player, index) {
  const portal = player.getAttribute(PORTAL_ATTRIBUTE) ?? 0;
  if (portal > 0 && PORTALS[portal - 1].after === index) {
    player.getPacketSender().sendVarbit(PORTAL_VARBIT, portal);
  }
}

function hidePortal(player) {
  setPortal(player, 0);
}

function portalAt({ obj }) {
  return PORTAL_LOCS.indexOf(obj.id);
}

/** The ladder picks the lap's portal; every obstacle opens it when it's the one before it. */
function obstacle(object, index, xp, route, steps, extra = {}) {
  const reveal = index === 1 ? choosePortal : (player) => revealPortal(player, index);
  return {
    object,
    index,
    level: 75,
    xp,
    route,
    steps: [{ run: ({ player }) => reveal(player) }, ...steps],
    ...extra,
  };
}

/** Tightrope falls land on the forest floor below the rope. */
function ropeFall(failTile, cry) {
  return {
    baseChance: 75,
    neverFailLevel: 91,
    xp: 0,
    render: Anim.BALANCE_WALK,
    steps: [
      { walk: [failTile] },
      { render: null },
      { anim: Anim.ROPE_FALL },
      { wait: 1 },
      { tele: [failTile[0], failTile[1] + 1, 0] },
      { anim: Anim.HIT_GROUND },
      { wait: 2 },
      { hit: [7, 9] },
      { wait: 1 },
      { say: cry },
    ],
  };
}

function darkHole(destination) {
  return [{ anim: Anim.CLIMB_DOWN }, { wait: 2 }, { tele: destination }, { wait: 3 }];
}

module.exports = {
  key: "prifddinas",
  // As the lap count line names it: "Your Prifddinas Agility Course lap count is: ..." (rsprox 1149).
  name: "Prifddinas Agility Course",
  helper: 18, // the Agility helper's course (enum 3507: "Prifddinas Agility Course")
  // The Wiki's obstacles add up to the lap: the last dark hole's 1037.1 is the lap's bonus, and
  // nothing more is paid with the lap count (rsprox 1149, both laps).
  lapXp: 1285.2,
  petBase: 25146, // Giant squirrel base chance (Wiki)
  obstacles: [
    obstacle(ObjectIds.LADDER_392, 1, 11.5, [3253, 6109, 0], climb([3255, 6109, 2])),
    obstacle(ObjectIds.TIGHTROPE_15, 2, 30.7, [3257, 6105, 2], balance([3272, 6105]), {
      render: Anim.BALANCE_WALK,
      fail: ropeFall([3263, 6105], "Ouch!!"),
    }),
    obstacle(ObjectIds.CHIMNEY_5, 3, 28.1, [3273, 6105, 2], [
      { faceDir: "north" },
      { anim: Anim.GRAB_LEDGE },
      { tele: [3273, 6106, 2] },
      { wait: 1 },
      { tele: [3273, 6107, 2] },
      { face: [3269, 6112] },
      { wait: 1 },
      { move: [3269, 6112], anim: Anim.JUMP_HURDLE, speed: [0, 60], ticks: 2, dir: "west" },
    ], {
      fail: {
        baseChance: 75,
        neverFailLevel: 91,
        xp: 0,
        steps: [
          { faceDir: "north" },
          { anim: Anim.GRAB_LEDGE },
          { tele: [3273, 6106, 2] },
          { wait: 1 },
          { tele: [3273, 6107, 2] },
          { wait: 1 },
          { move: [3272, 6108], anim: Anim.FAIL_JUMP, speed: [0, 60], ticks: 2 },
          { tele: [3272, 6108, 1] },
          { anim: Anim.FREE_FALL },
          { wait: 1 },
          { tele: [3272, 6108, 0] },
          { anim: Anim.HIT_GROUND },
          { wait: 2 },
          { hit: [7, 9] },
          { wait: 1 },
          { say: "Ow!!" },
        ],
      },
    }),
    obstacle(ObjectIds.ROOF_EDGE, 4, 23, [3269, 6115, 2], [
      { anim: Anim.LEAP },
      { wait: 1 },
      { anim: Anim.LAND },
      { tele: [3269, 6117, 0] },
    ]),
    obstacle(ObjectIds.DARK_HOLE_8, 5, 11.5, [3269, 6117, 0], darkHole([2269, 3389, 0])),
    obstacle(ObjectIds.LADDER_393, 6, 0, [2271, 3393, 0], climb([2269, 3393, 2], Anim.CLIMB_UP, 2)),
    obstacle(ObjectIds.ROPE_BRIDGE_17, 7, 25.6, [2265, 3390, 2], balance([2257, 3390]), {
      render: Anim.BALANCE_WALK,
    }),
    obstacle(ObjectIds.TIGHTROPE_16, 8, 30.7, [2254, 3390, 2], balance([2247, 3397]), {
      render: Anim.BALANCE_WALK,
      fail: ropeFall([2250, 3394], "Gah!!!"),
    }),
    obstacle(ObjectIds.ROPE_BRIDGE_18, 9, 25.6, [2246, 3398, 2], balance([2246, 3406]), {
      render: Anim.BALANCE_WALK,
    }),
    obstacle(ObjectIds.TIGHTROPE_17, 10, 30.7, [2244, 3409, 2], balance([2244, 3410], [2250, 3416]), {
      render: Anim.BALANCE_WALK,
    }),
    obstacle(ObjectIds.TIGHTROPE_18, 11, 30.7, [2253, 3418, 2], [{ walk: [[2260, 3425]] }, { tele: [2260, 3425, 0] }], {
      render: Anim.BALANCE_WALK,
    }),
    obstacle(ObjectIds.DARK_HOLE_9, 12, 1037.1, [2258, 3431, 0], darkHole([3240, 6109, 0]), {
      onSuccess: hidePortal,
    }),
    {
      object: PORTAL_LOCS,
      level: 75,
      xp: PORTAL_XP,
      precondition: (context) => {
        const portal = context.player.getAttribute(PORTAL_ATTRIBUTE) ?? 0;
        return portal > 0 && portalAt(context) === portal - 1 ? null : "The portal is not active.";
      },
      // From the tile beside it: a turn to it, a step onto it, and through the tick after, with
      // the line, the shard and the XP (rsprox 1149, portals 1 and 6).
      steps: (context) => {
        const portal = PORTALS[portalAt(context)];
        return [{ face: portal.at }, { wait: 1 }, { walk: [portal.at] }, { tele: portal.exit }];
      },
      skipTo: (context) => PORTALS[portalAt(context)].skipTo,
      onSuccess: hidePortal,
      // Every portal finds a crystal shard (Wiki, since its 1/3 became certain), as 237/01149 records it.
      gives: { item: "CRYSTAL_SHARD", amount: 1, message: "You find a crystal shard on your way through the portal." },
    },
    {
      object: ObjectIds.LADDER_394,
      level: 75,
      xp: 0,
      route: [2243, 3392, 0],
      steps: climb([2243, 3394, 2], Anim.CLIMB_UP, 2),
    },
  ],
};
