const { Anim } = require("../Constants.Agility");
const { ShortcutAnim, between, climbOver } = require("./Builders.Agility");

/** The log balance's sounds and graphic (rsprox 359, local 1001631, 1002015 ...: docs/agility-shortcuts.md). */
const LOG_BALANCE_SOUND = 2470; // log_balance
const STUMBLE_SOUND = 2493; // stumble_loop
const POOL_PLOP_SOUND = 1658;
const WATERSPLASH = 68;

function tileDistance(a, x, y) {
  return Math.max(Math.abs(a[0] - x), Math.abs(a[1] - y));
}

/** Fremennik shortcut scripts (agility-shortcuts.json). */
module.exports = {
  /** Rellekka's broken fence is only climbed into the town, from the west of `westOfX`. */
  rellekkaFence: ({ westOfX }) => ({
    precondition: ({ pos }) => (pos.x >= westOfX ? "You can't climb the fence from this side." : null),
  }),

  /** Rellekka: the broken bridge to the Fremennik Slayer Dungeon side, from `eastEnd` or the west. */
  rellekkaBrokenBridge: ({ eastEnd }) => ({
    route: ({ obj }) => [obj.x, obj.y, obj.z],
    steps: ({ pos }) => {
      const fromEast = pos.x === eastEnd[0] && pos.y === eastEnd[1];
      const dx = fromEast ? -1 : 1;
      return [
        fromEast ? null : { anim: Anim.LEDGE_TURN, delay: 10 },
        { wait: 1 },
        { render: fromEast ? Anim.LEDGE_WALK_BACK : Anim.LEDGE_WALK },
        { walk: [[pos.x + dx * 2, pos.y]] },
        { render: null },
        fromEast ? { anim: ShortcutAnim.LEDGE_FINISH } : null,
        { walk: [[pos.x + dx * 3, pos.y]] },
      ];
    },
  }),

  /** Neitiznot: the rope bridges, `length` tiles to the far side. */
  neitiznotRopeBridge: ({ length }) => ({
    steps: ({ pos, obj }) => [{ walk: [[pos.x, pos.y + (pos.y > obj.y ? -length : length)]] }],
  }),

  /**
   * Lighthouse basalt rocks: each take-off tile jumps to its pair across the water, the pair
   * whose landing is nearest the clicked rock. The beach and shore are where the jumps end.
   */
  basaltRocks: ({ jumps, beach, shore }) => {
    const pairs = jumps.flatMap(([a, b]) => [[a, b], [b, a]]);
    const jumpFor = ({ obj, pos }) => [...pairs].sort((left, right) =>
      tileDistance(left[1], obj.x, obj.y) + tileDistance(left[0], pos.x, pos.y) * 0.1
      - (tileDistance(right[1], obj.x, obj.y) + tileDistance(right[0], pos.x, pos.y) * 0.1))[0];
    return {
      precondition: ({ obj, pos }) => {
        if (obj.id === beach.object && pos.y <= beach.y) return "You're already at the beach.";
        if (obj.id === shore.object && pos.y >= shore.y) return "You're already at the shore.";
        return null;
      },
      route: (context) => [...jumpFor(context)[0], 0],
      steps: (context) => [{ move: jumpFor(context)[1], anim: Anim.FAIL_JUMP, speed: [15, 35] }],
    };
  },

  /** Fremennik Slayer Dungeon: leap the strange floor to the pyrefiends, at either crack. */
  fremennikStrangeFloor: ({ westCrack, west, east }) => {
    const isWest = (obj) => obj.x === westCrack[0] && obj.y === westCrack[1];
    return {
      route: ({ pos, obj }) => {
        const crack = isWest(obj) ? west : east;
        return pos.x < obj.x ? crack.westStart : crack.eastStart;
      },
      steps: ({ pos, obj }) => {
        const crack = isWest(obj) ? west : east;
        const finish = pos.x < obj.x ? crack.eastLanding : crack.westLanding;
        // As captured (rsprox 2952): a 2-tile run-up with sound 2464, the 2-tile hurdle a tick later.
        const step = Math.sign(finish[0] - pos.x) * 2;
        return [
          { sound: 2464 },
          { move: [pos.x + step, pos.y], anim: Anim.RUN_UP, speed: [8, 50], ticks: 1 },
          { move: finish, anim: Anim.JUMP_HURDLE, speed: [8, 50], ticks: 1 },
        ];
      },
    };
  },

  /** Trollheim: a rock climbed three tiles east or west, depending on which side the player is. */
  trollheimRocks: ({ eastOfX, eastStep }) => ({
    steps: ({ pos }) => {
      const step = pos.x >= eastOfX ? eastStep : -eastStep;
      return [{ move: [pos.x + step, pos.y], anim: Anim.CLIMB_ROCKS, speed: [0, 60] }, { anim: -1 }];
    },
  }),

  /**
   * Low rocks on the paths to Trollheim, stepped over along y near `alongY`, otherwise along x.
   * `delay` and `speed` override the climb's timing where a capture gives it.
   */
  trollheimRockStep: ({ alongY, delay, speed }) => ({
    steps: ({ pos, obj }) => {
      const vertical = alongY.some(([x, y]) => Math.max(Math.abs(obj.x - x), Math.abs(obj.y - y)) <= 3);
      const destination = vertical
        ? [obj.x, obj.y + (pos.y > obj.y ? -1 : 1)]
        : [obj.x + (pos.x > obj.x ? -1 : 1), obj.y];
      const climb = climbOver(destination);
      return [speed ? { ...climb, delay, speed } : climb];
    },
  }),

  /** Trollheim handholds: up the cliff from below `topY`, or two tiles across along it. */
  trollheimHandholds: ({ topY, top, landing }) => ({
    route: ({ obj }) => (obj.y >= topY ? top : [obj.x, obj.y, obj.z]),
    steps: ({ pos, obj }) => [climbOver(obj.y >= topY ? landing : [obj.x, obj.y + (pos.y > obj.y ? -2 : 2)])],
  }),

  /** Mountain Camp: climb over the rockslide to the row on the far side. */
  rockslide: ({ northY, southY }) => ({
    steps: ({ pos, obj }) => [climbOver([pos.x, pos.y < obj.y ? northY : southY])],
  }),

  /**
   * The slippery log north of the Sinclair Mansion, between `ends` across `middle`. As captured
   * (rsprox 359; local 1001623 ... 1002212, ticks from the click's arrival): two tiles a tick, the
   * roll on the middle tile a tick in. A success says so then and walks off; BUSY clears and the
   * XP lands 4 ticks in. A failure falls east into the river at `fall` (exactmove from the middle,
   * `human_wobbleandfall_short_r`), splashes a tick later, is washed along `river` a tile a tick
   * from 3 ticks in, and takes 6 damage on the north bank 7 ticks in (local 1001631, 1001653,
   * 1001659, 1001991, 1002015: every capture starts from the south and hits 6).
   */
  fremennikLogBalance: ({ ends, middle, fall, river }) => {
    const attempt = [
      { sound: LOG_BALANCE_SOUND, loops: 2 },
      { msg: { spam: "You attempt to walk across the slippery log." } },
      { walk: [middle], tilesPerTick: 2 },
    ];
    const crossing = between({
      ends,
      cross: (from, to) => [
        ...attempt,
        { msg: "You make it across the log without any problems." },
        { sound: LOG_BALANCE_SOUND, loops: 2 },
        { walk: [to], tilesPerTick: 2 },
        { wait: 2 },
      ],
    });
    return {
      route: crossing.route,
      steps: crossing.steps,
      fail: {
        steps: ({ pos, core }) => {
          // Ours: no capture fails from the north end; it falls the same way, facing south.
          const dir = pos.y < middle[1] ? "north" : "south";
          const [x, y, z = pos.z] = fall;
          const splashAt = new core.Location(x, y, z);
          const [first, second, third, last] = river;
          return [
            ...attempt,
            { msg: "You lose your footing and fall into the water." },
            { move: fall, anim: ShortcutAnim.FALL_INTO_WATER_RIGHT, speed: [22, 35], dir, ticks: 0 },
            // The exactmove and the teleport onto the river tile share a tick (unlike `tele`, which ends the move).
            { run: ({ player }) => player.moveTo(new core.Location(x, y, z)) },
            { sound: STUMBLE_SOUND, loops: 10 },
            { wait: 1 },
            // The fall has played (cycle 35): clear it, or the client is kept on its end tile and
            // the river walk below reaches it as one teleport (live: idle here, then a walk a tick).
            { run: ({ player }) => player.setForceMovement(null) },
            { run: ({ player }) => player.getPacketSender().sendGlobalGraphic(new core.Graphic(WATERSPLASH, 3), splashAt) },
            { sound: POOL_PLOP_SOUND },
            // Ours: the swim render (the capture's appearance updates here and on the last tile carry no ids).
            { render: ShortcutAnim.SWIM },
            { wait: 1 },
            { msg: "You're being washed down the river." },
            { walk: [first] },
            { msg: { spam: "You feel like you're drowning..." } },
            { walk: [second] },
            { msg: { spam: "You finally come to shore." } },
            { walk: [third] },
            { render: null },
            { walk: [last] },
            { hit: 6 },
          ];
        },
      },
    };
  },
};
