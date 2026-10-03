const { ObjectIds } = require("../../../../src/main/typescript/elvarg/util/IdEnums");
const { Anim } = require("../constants");
const { climb, balance } = require("../steps");

/** Shows the lap's shortcut portal (1-6), 0 hides it. RuneLite: PRIF_AGILITY_SHORTCUT_TRANSMIT. */
const PORTAL_VARBIT = 9298;
const PORTAL_ATTRIBUTE = "agility.prifddinas.portal";

/**
 * Each lap one portal may open. It appears after obstacle `after`, stands on `at`,
 * and drops the player at `exit`, continuing the lap as if obstacle `skipTo` was done.
 */
const PORTALS = [
  { after: 1, at: [3257, 6111, 2], exit: [3275, 6105, 2], skipTo: 2 },
  { after: 4, at: [3270, 6116, 0], exit: [3292, 6141, 2], skipTo: 6 },
  { after: 7, at: [3282, 6138, 2], exit: [3268, 6146, 2], skipTo: 8 },
  { after: 8, at: [3267, 6147, 2], exit: [3271, 6157, 2], skipTo: 9 },
  { after: 9, at: [3272, 6157, 2], exit: [3277, 6167, 2], skipTo: 10 },
  { after: 10, at: [3273, 6171, 2], exit: [3286, 6178, 0], skipTo: 11 },
];

function setPortal(player, portal) {
  player.setAttribute(PORTAL_ATTRIBUTE, portal);
  player.getPacketSender().sendVarbit(PORTAL_VARBIT, portal);
}

/** Picks this lap's portal; it stays hidden until its obstacle has been crossed. */
function choosePortal(player) {
  player.setAttribute(PORTAL_ATTRIBUTE, 1 + Math.floor(Math.random() * PORTALS.length));
  player.getPacketSender().sendVarbit(PORTAL_VARBIT, 0);
  revealPortal(player, 1);
}

/** Opens this lap's portal once the obstacle before it has been crossed. */
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
  return PORTALS.findIndex((portal) => portal.at[0] === obj.x && portal.at[1] === obj.y && portal.at[2] === obj.z);
}

function obstacle(object, index, xp, route, steps, extra = {}) {
  return {
    object,
    index,
    level: 75,
    xp,
    route,
    steps,
    onSuccess: (player) => revealPortal(player, index),
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
  name: "Prifddinas Agility",
  lapXp: 1337,
  petBase: 25146, // Giant squirrel base chance (Wiki)
  obstacles: [
    obstacle(ObjectIds.LADDER_392, 1, 11.5, [3253, 6109, 0], climb([3255, 6109, 2]), {
      onSuccess: choosePortal,
    }),
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
    obstacle(ObjectIds.DARK_HOLE_8, 5, 11.5, [3269, 6117, 0], darkHole([3293, 6141, 0])),
    obstacle(ObjectIds.LADDER_393, 6, 0, [3295, 6145, 0], climb([3293, 6145, 2], Anim.CLIMB_UP, 2)),
    obstacle(ObjectIds.ROPE_BRIDGE_17, 7, 25.6, [3289, 6142, 2], balance([3281, 6142]), {
      render: Anim.BALANCE_WALK,
    }),
    obstacle(ObjectIds.TIGHTROPE_16, 8, 30.7, [3278, 6142, 2], balance([3271, 6149]), {
      render: Anim.BALANCE_WALK,
      fail: ropeFall([3274, 6146], "Gah!!!"),
    }),
    obstacle(ObjectIds.ROPE_BRIDGE_18, 9, 25.6, [3270, 6150, 2], balance([3270, 6158]), {
      render: Anim.BALANCE_WALK,
    }),
    obstacle(ObjectIds.TIGHTROPE_17, 10, 30.7, [3268, 6161, 2], balance([3268, 6162], [3274, 6168]), {
      render: Anim.BALANCE_WALK,
    }),
    obstacle(ObjectIds.TIGHTROPE_18, 11, 30.7, [3277, 6170, 2], [{ walk: [[3284, 6177]] }, { tele: [3284, 6177, 0] }], {
      render: Anim.BALANCE_WALK,
    }),
    obstacle(ObjectIds.DARK_HOLE_9, 12, 1037.1, [3282, 6183, 0], darkHole([3240, 6109, 0]), {
      onSuccess: hidePortal,
    }),
    {
      object: ObjectIds.PORTAL_81,
      level: 75,
      xp: 0,
      precondition: (context) => {
        const portal = context.player.getAttribute(PORTAL_ATTRIBUTE) ?? 0;
        return portal > 0 && portalAt(context) === portal - 1 ? null : "The portal is not active.";
      },
      steps: (context) => {
        const portal = PORTALS[portalAt(context)];
        return [{ walk: [portal.at] }, { wait: 1 }, { tele: portal.exit }];
      },
      skipTo: (context) => PORTALS[portalAt(context)].skipTo,
      onSuccess: hidePortal,
    },
    {
      object: ObjectIds.LADDER_394,
      level: 75,
      xp: 0,
      route: [3267, 6144, 0],
      steps: climb([3267, 6146, 2], Anim.CLIMB_UP, 2),
    },
  ],
};
