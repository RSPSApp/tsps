const { Anim } = require("../Constants.Agility");
const { ShortcutAnim, between } = require("./Builders.Agility");
const { hideSideTabs, restoreSideTabs } = require("../../../quests/QuestScenes");

/**
 * The River Lum's broken raft, between Lumbridge and Al Kharid (Wiki: Broken Raft). As captured, both ways
 * (rsprox 347, rev 230, ticks 1945 west to east and 4061 east to west, counted from the first shot): the
 * player fires at the raft from the bank (xbows_human_fire_and_reload, synth 2928) with the side tabs closed;
 * three ticks later the rope is tied to the near tree and runs across the water, and the player swims to the
 * raft, crosses it on foot, fires at the far tree and swims to the far bank. Each bank's rope and tree stay
 * 14 ticks. No XP (Wiki).
 *
 * `grapple: false` is the Jump-to crossing at 48 Agility without the grapple (Wiki, the 12 August 2026 update).
 * Ours: nothing captures it, so it is the grapple's two swims without the shots, ropes or messages.
 */
const RAFT_WEST = [3252, 3180];
const RAFT_EAST = [3253, 3179];
const BANKS = {
  // Strong Yew (xbows_yewtree_basic) and Strong Tree (xbows_jungletree_basic), as the cache places them.
  // The rope tied (xbows_*_rope_tied) on the bank the player leaves, grappled (xbows_*_rope_grappled) on the far one.
  west: { tree: [3244, 3179], face: 0, basic: 17039, tied: 17040, grappled: 17041, rope: [3246, 3251] },
  east: { tree: [3260, 3178], face: 2, basic: 17036, tied: 17037, grappled: 17038, rope: [3254, 3259] },
};
const ROPE = 17034; // xbows_ground_rope
const ROPE_Y = 3179;
const RIG_TICKS = 14;
const FIRE_ANIM = 4230; // xbows_human_fire_and_reload
const FIRE_SOUND = 2928;
const SWIM_SOUND = 2929;
const NEAR_WEST_SWIM = 4466; // xbows_lumbridge_east_swimming_anim, the leg by the west bank
const NEAR_EAST_SWIM = 4467; // xbows_lumbridge_west_swimming_anim, the leg by the east bank
const WATERSPLASH = 68;
const SIDEBUTTON_SWITCH_SCRIPT = 915;
const TABS_HIDDEN_TAB = 9;
const TABS_BACK_TAB = 1;

/** Each bank's rope and tree while someone crosses: rigged once, kept until 14 ticks after the latest crossing's leg. */
const rigs = new Map();

function rig(context, side, treeId) {
  const { core, api } = context;
  const bank = BANKS[side];
  const at = new core.Location(bank.tree[0], bank.tree[1], 0);
  let state = rigs.get(side);
  if (!state) {
    const standing = core.MapObjects.getType(at, 10, null);
    const original = standing?.getId() === bank.basic ? standing : null;
    const ropes = [];
    for (let x = bank.rope[0]; x <= bank.rope[1]; x++) {
      const tile = new core.Location(x, ROPE_Y, 0);
      // The rope takes the place of the bank's own ground decoration where there is one (3246, 3248 and 3259).
      const under = core.MapObjects.getType(tile, 22, null);
      const rope = new core.GameObject(ROPE, tile, 22, 0, null);
      if (under) core.ObjectManager.replaceInPlace(under, rope);
      else core.ObjectManager.register(rope, true);
      ropes.push({ rope, under });
    }
    state = { original, tree: original, ropes };
    rigs.set(side, state);
  }
  if (state.original && state.tree.getId() !== treeId) {
    const next = new core.GameObject(treeId, at, 10, bank.face, null);
    core.ObjectManager.replaceInPlace(state.tree, next);
    state.tree = next;
  }
  const token = {};
  state.token = token;
  api.getTaskManager().submit(new core.CountdownTask(state, RIG_TICKS, () => unrig(core, side, token)));
}

/** The bank as the map has it again, unless a later crossing has rigged it since. */
function unrig(core, side, token) {
  const state = rigs.get(side);
  if (state?.token !== token) return;
  rigs.delete(side);
  // Ours: live sends loc_del for every rope tile, the decorated ones too (rsprox 347); here the decoration is put
  // back (a loc_add_change of it) so the map stays whole.
  for (const { rope, under } of state.ropes) {
    if (under) core.ObjectManager.replaceInPlace(rope, under);
    else core.ObjectManager.deregister(rope, true);
  }
  if (state.original && state.tree !== state.original) core.ObjectManager.replaceInPlace(state.tree, state.original);
}

function splash(context, [x, y]) {
  const { core, player } = context;
  const at = new core.Location(x, y, 0);
  const graphic = core.Graphic.delayed(WATERSPLASH, 6, 0);
  for (const viewer of [player, ...(player.getLocalPlayers?.() ?? [])]) viewer.getPacketSender().sendGlobalGraphic(graphic, at);
}

function tabs(player, hidden) {
  if (hidden) hideSideTabs(player);
  else restoreSideTabs(player);
  player.getPacketSender().sendClientScript(SIDEBUTTON_SWITCH_SCRIPT, hidden ? TABS_HIDDEN_TAB : TABS_BACK_TAB);
}

/**
 * A swim from `from` onto `to`: placed there at once, drawn moving from `from` over `cycles`, as captured. `drawnTo`:
 * where the drawing ends when it isn't `to` (the first swim east is drawn to 3251,3180, one short of the raft tile).
 */
function swim(from, to, anim, cycles, dir, splashAt, drawnTo = to) {
  return [
    { tele: to },
    { move: drawnTo, from, anim, speed: [0, cycles], dir, ticks: 0 },
    { run: (context) => splash(context, splashAt) },
    { sound: SWIM_SOUND, delay: 3 },
  ];
}

function shot() {
  return [{ anim: FIRE_ANIM }, { sound: FIRE_SOUND }];
}

const GRAPPLE = {
  // Two ticks after arriving on the bank tile (rsprox 347 tick 1943), the tabs close with the first shot.
  east: [
    { wait: 1 },
    { faceDir: "east" }, ...shot(), { run: (context) => tabs(context.player, true) }, { wait: 3 },
    { msg: { spam: "You successfully grapple the raft and tie the rope to a tree." } },
    { run: (context) => rig(context, "west", BANKS.west.tied) },
    { walk: [[3247, 3179]], arrive: true }, { wait: 1 },
    ...swim([3247, 3179], RAFT_WEST, NEAR_WEST_SWIM, 120, "east", [3249, 3179], [3251, 3180]), { wait: 1 },
    { walk: [[3253, 3180], RAFT_EAST], arrive: true }, { wait: 2 },
    { faceDir: "east" }, { wait: 2 },
    ...shot(), { wait: 3 },
    { msg: { spam: "You successfully grapple the tree on the opposite bank." } },
    { run: (context) => rig(context, "east", BANKS.east.grappled) }, { wait: 1 },
    ...swim(RAFT_EAST, [3258, 3179], NEAR_EAST_SWIM, 160, "east", [3254, 3179]), { wait: 1 },
    { walk: [[3259, 3179]], arrive: true }, { wait: 3 },
    { run: (context) => tabs(context.player, false) },
  ],
  // The tabs close two ticks after arriving (rsprox 347 tick 4055), the first shot four ticks later.
  west: [
    { wait: 1 },
    { faceDir: "west" }, { run: (context) => tabs(context.player, true) }, { wait: 4 },
    ...shot(), { wait: 3 },
    { msg: { spam: "You successfully grapple the raft and tie the rope to a tree." } },
    { run: (context) => rig(context, "east", BANKS.east.tied) },
    { walk: [[3258, 3179]], arrive: true }, { wait: 2 },
    ...swim([3258, 3179], RAFT_EAST, NEAR_EAST_SWIM, 160, "west", [3257, 3179]), { wait: 1 },
    { walk: [[3253, 3180], RAFT_WEST], arrive: true }, { wait: 1 },
    { faceDir: "west" }, { wait: 1 },
    ...shot(), { wait: 3 },
    { msg: { spam: "You successfully grapple the tree." } },
    { run: (context) => rig(context, "west", BANKS.west.grappled) },
    ...swim(RAFT_WEST, [3248, 3179], NEAR_WEST_SWIM, 120, "west", [3251, 3179]), { wait: 1 },
    { walk: [[3247, 3179], [3246, 3179]], arrive: true }, { wait: 2 },
    { run: (context) => tabs(context.player, false) },
  ],
};

// Each ends a tick after its last swim: the run ending on that tick would clear the exact move before it is sent.
const BAREHANDED = {
  east: [
    ...swim([3246, 3179], RAFT_WEST, NEAR_WEST_SWIM, 120, "east", [3249, 3179]), { wait: 1 },
    { walk: [[3253, 3180], RAFT_EAST], arrive: true }, { wait: 1 },
    ...swim(RAFT_EAST, [3259, 3179], NEAR_EAST_SWIM, 160, "east", [3254, 3179]), { wait: 1 },
  ],
  west: [
    ...swim([3259, 3179], RAFT_EAST, NEAR_EAST_SWIM, 160, "west", [3257, 3179]), { wait: 1 },
    { walk: [[3253, 3180], RAFT_WEST], arrive: true }, { wait: 1 },
    ...swim(RAFT_WEST, [3246, 3179], NEAR_WEST_SWIM, 120, "west", [3251, 3179]), { wait: 1 },
  ],
};

/**
 * From the raft itself (a player saved there: before this crossing was scripted, the one from Lumbridge ended on
 * 3253,3179): the far half of a crossing, to the nearer bank. Ours: live has no way to stand there between crossings.
 */
const RAFT_TILES = new Set(["3252,3180", "3253,3179", "3253,3180"]);
/** The water a swim passes over, blocked, where a save made mid-swim (a server stop) can leave a player. */
function inWater(pos) {
  return pos.z === 0 && pos.y === ROPE_Y && ((pos.x >= 3248 && pos.x <= 3251) || (pos.x >= 3254 && pos.x <= 3257));
}
function onRaft(pos) {
  return inWater(pos) || (pos.z === 0 && RAFT_TILES.has(`${pos.x},${pos.y}`));
}
function fromRaft(pos, grapple) {
  // Ours: out of the water onto the nearer bank.
  if (inWater(pos)) return [{ tele: pos.x <= 3251 ? [3246, 3179] : [3259, 3179] }];
  const way = pos.x >= RAFT_EAST[0] ? "east" : "west";
  const start = way === "east" ? RAFT_EAST : RAFT_WEST;
  const walk = pos.x === start[0] && pos.y === start[1] ? [] : [{ walk: [start], arrive: true }, { wait: 1 }];
  if (!grapple) {
    // The second swim onwards.
    const steps = BAREHANDED[way];
    return [...walk, ...steps.slice(steps.findIndex((step, index) => index > 0 && step.tele))];
  }
  // The second shot onwards, with the tabs closed as for a whole crossing.
  const steps = GRAPPLE[way];
  const secondShot = steps.findIndex((step, index) => step.anim === FIRE_ANIM && index > steps.findIndex((s) => s.anim === FIRE_ANIM));
  return [...walk, { faceDir: way }, { run: (context) => tabs(context.player, true) }, ...steps.slice(secondShot)];
}

/** Misthalin shortcut scripts (agility-shortcuts.json). */
module.exports = {
  /** The Broken Raft across the River Lum, either way, from the bank tile nearer the player (see above). */
  riverLumRaft: ({ grapple = true }) => {
    const crossing = between({
      ends: [[3246, 3179, 0], [3259, 3179, 0]],
      cross: (from, to) => (grapple ? GRAPPLE : BAREHANDED)[to[0] > from[0] ? "east" : "west"],
    });
    return {
      ...crossing,
      route: (context) => (onRaft(context.pos) ? [context.pos.x, context.pos.y, context.pos.z] : crossing.route(context)),
      steps: (context) => (onRaft(context.pos) ? fromRaft(context.pos, grapple) : crossing.steps(context)),
      // A crossing cut short (a death on the way) gives the side tabs back; a logout rebuilds them on login.
      ...(grapple ? { onCancel: (player) => tabs(player, false) } : {}),
    };
  },

  /** Lumbridge castle basement: crawl through the hole, away from the player's side. */
  lumbridgeBasementHole: () => ({
    steps: ({ pos, obj }) => {
      const north = pos.y <= obj.y;
      return [{ move: [obj.x, north ? obj.y + 3 : obj.y - 1], anim: Anim.SQUEEZE_PIPE, speed: [0, 90], ticks: 2 }];
    },
  }),

  /**
   * Zanaris jutting walls: shimmy past to the other side of `pivot`'s row. As captured (rsprox
   * 359, 424; southward): the side-step from cycle 28 to 124, sound 2489 and the message at once,
   * sound 2490 five ticks later.
   */
  zanarisJuttingWall: ({ pivot }) => ({
    steps: ({ pos, obj }) => {
      const southward = pos.y >= pivot;
      return [
        { sound: 2489 },
        { msg: { spam: "You try to squeeze past." } },
        {
          move: [obj.x, southward ? obj.y - 1 : obj.y + 1],
          anim: southward ? ShortcutAnim.JUTTING_WALL_LEFT : ShortcutAnim.JUTTING_WALL_RIGHT,
          speed: [28, 124],
          ticks: 5,
        },
        { sound: 2490 },
      ];
    },
  }),
};
