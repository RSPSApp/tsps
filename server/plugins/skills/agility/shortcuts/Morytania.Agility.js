const { ShortcutAnim } = require("./Builders.Agility");

/** The splash on the swamp tile a failed bridge jump lands in (`watersplash`, rsprox 1001895). */
const WATERSPLASH = 68;

/** Morytania shortcut scripts (agility-shortcuts.json). */
module.exports = {
  /**
   * The broken bridge outside the Nature Grotto: four `Bridge` floor locs, two on each bank of the
   * gap (the north bank's `y` is `northY`). As captured (rsprox 1638, local 1001447, 1001455,
   * 1001895, 1001899; docs/agility-shortcuts.md), the player jumps from the clicked loc's tile and
   * lands on one fixed tile per direction: `north` going north, `south` going
   * south. A failure drops them into the swamp at `fall`, between the banks, and
   * still ends on the far bank: `fallOut.north` / `fallOut.south`, two moves.
   */
  natureGrottoBridge: ({ northY, north, south, fall, fallOut }) => {
    const northward = ({ obj }) => obj.y < northY;
    return {
      // Each loc is a tile the player jumps from (rsprox 1638: the jump starts on the clicked one).
      route: ({ obj }) => [obj.x, obj.y, obj.z],
      steps: (context) => {
        const up = northward(context);
        return [
          { wait: 1 },
          { move: up ? north : south, anim: ShortcutAnim.STEPPING_STONE_JUMP, delay: 30, speed: [58, 70], dir: up ? "north" : "south", ticks: 2 },
          { sound: 2461 },
          { wait: 2 },
        ];
      },
      fail: {
        steps: (context) => {
          const up = northward(context);
          const out = up ? fallOut.north : fallOut.south;
          const splashAt = new context.core.Location(fall[0], fall[1], fall[2]);
          return [
            { wait: 1 },
            { move: fall, anim: up ? ShortcutAnim.WOBBLE_FALL_LEFT : ShortcutAnim.WOBBLE_FALL_RIGHT, delay: 30, speed: [58, 60], dir: up ? "north" : "south", ticks: 1 },
            { sound: 2461 },
            // Out of the swamp onto the far bank, in two moves (rsprox 1001895: 3 and 6 ticks in).
            { wait: 1 },
            { walk: [out[0]], tilesPerTick: 2, arrive: true },
            { run: ({ player, core }) => player.getPacketSender().sendGlobalGraphic(new core.Graphic(WATERSPLASH, 3), splashAt) },
            { sound: 1658 },
            { wait: 3 },
            { walk: [out[1]], arrive: true },
            { anim: -1 },
            { hit: [1, 7] },
            { msg: "You nearly drown in the disgusting swamp." },
          ];
        },
      },
    };
  },
};
