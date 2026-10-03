"use strict";

/**
 * Zulrah's four rotations.
 *
 * Wiki ("Zulrah/Strategies", Rotation overview): each phase's place, form and what it does,
 * in order. The fight always opens in the middle in green form with four venom cloud
 * barrages. Every rotation ends in the middle in green form with five ranged attacks and four
 * barrages, which "counts as the first phase of the new rotation"; the next rotation is picked
 * at random and may be the same one.
 *
 * Near-Reality: the tiles each cloud barrage and snakeling orb lands on. A barrage throws two
 * clouds; each tile is a cloud's centre.
 *
 * Steps:
 * - ["ranged", n] / ["magic", n]: n attacks, three ticks apart. Green form's are ranged;
 *   blue form's mix magic and ranged.
 * - ["melee"]: the red form's two tail swings.
 * - ["jad", style, n]: n attacks alternating ranged and magic, starting with `style`.
 * - ["clouds", [x, y, x, y]]: one barrage of two clouds.
 * - ["snakeling", [x, y]]: one orb that becomes a snakeling.
 */

const C = (x1, y1, x2, y2) => ["clouds", [x1, y1, x2, y2]];
const S = (x, y) => ["snakeling", [x, y]];
const MELEE = ["melee"];

/** The four barrages that open the fight and close every rotation. */
const FILL = [C(2269, 3069, 2272, 3070), C(2266, 3069, 2263, 3070), C(2273, 3072, 2273, 3075), C(2263, 3073, 2263, 3076)];

const OPENING = { at: "middle", form: "green", steps: FILL };
/** The last phase of every rotation, and the first of the next. */
const CLOSING = { at: "middle", form: "green", steps: [["ranged", 5], ...FILL] };

const phase = (at, form, ...steps) => ({ at, form, steps });

/** Phases 2 onwards of each rotation (phase 1 is OPENING or CLOSING). */
const ROTATIONS = [
  // Rotation 1 ("Crimson A")
  [
    phase("middle", "red", MELEE),
    phase("middle", "blue", ["magic", 4]),
    phase("south", "green", ["ranged", 5], S(2263, 3076), S(2263, 3073), C(2263, 3070, 2266, 3069), C(2272, 3069, 2273, 3072), S(2273, 3075), S(2273, 3077)),
    phase("middle", "red", MELEE),
    phase("west", "blue", ["magic", 5]),
    phase("south", "green", C(2269, 3069, 2272, 3069), C(2263, 3070, 2266, 3069), C(2263, 3073, 2263, 3076), S(2272, 3071), S(2273, 3075), S(2273, 3077), S(2273, 3072)),
    phase("south", "blue", ["magic", 5], S(2263, 3070), C(2266, 3069, 2269, 3069), S(2263, 3076), C(2272, 3069, 2273, 3072), S(2263, 3073)),
    phase("west", "green", ["jad", "ranged", 10], C(2263, 3070, 2266, 3069), C(2269, 3069, 2272, 3069), C(2263, 3073, 2263, 3076), C(2273, 3072, 2273, 3075)),
    phase("middle", "red", MELEE),
  ],
  // Rotation 2 ("Crimson B")
  [
    phase("middle", "red", MELEE),
    phase("middle", "blue", ["magic", 4]),
    phase("west", "green", C(2273, 3072, 2272, 3069), C(2273, 3075, 2273, 3078), C(2269, 3069, 2266, 3069), S(2266, 3069), S(2263, 3070), S(2263, 3073), S(2263, 3076)),
    phase("south", "blue", ["magic", 5], S(2263, 3076), S(2263, 3073), C(2263, 3070, 2266, 3069), C(2272, 3069, 2273, 3072), S(2273, 3075), S(2273, 3077)),
    phase("middle", "red", MELEE),
    phase("east", "green", ["ranged", 5]),
    phase("south", "blue", ["magic", 5], S(2263, 3070), C(2266, 3069, 2269, 3069), S(2263, 3076), C(2272, 3069, 2273, 3072), S(2263, 3073)),
    phase("west", "green", ["jad", "ranged", 10], C(2263, 3070, 2266, 3069), C(2269, 3069, 2272, 3069), C(2263, 3073, 2263, 3076), C(2273, 3072, 2273, 3075)),
    phase("middle", "red", MELEE),
  ],
  // Rotation 3 ("Serp")
  [
    phase("east", "green", ["ranged", 5], S(2273, 3078), S(2273, 3075), S(2273, 3072)),
    phase("middle", "red", C(2273, 3078, 2273, 3075), S(2273, 3072), C(2272, 3070, 2269, 3069), S(2266, 3069), C(2263, 3070, 2263, 3073), S(2263, 3076), MELEE),
    phase("west", "blue", ["magic", 5]),
    phase("south", "green", ["ranged", 5]),
    phase("east", "blue", ["magic", 5]),
    phase("middle", "green", C(2273, 3078, 2273, 3075), C(2273, 3072, 2272, 3069), C(2269, 3069, 2266, 3069), S(2263, 3070), S(2263, 3076), S(2263, 3073)),
    phase("west", "green", ["ranged", 5]),
    phase("middle", "blue", ["magic", 5], C(2263, 3076, 2263, 3073), C(2263, 3070, 2266, 3069), S(2269, 3069), S(2272, 3069), S(2273, 3072)),
    phase("east", "green", ["jad", "magic", 10]),
    phase("middle", "blue", S(2263, 3076), S(2263, 3070), S(2263, 3072), S(2273, 3078)),
  ],
  // Rotation 4 ("Tanz")
  [
    phase("east", "blue", S(2272, 3069), S(2273, 3078), S(2273, 3075), S(2273, 3072), ["magic", 6]),
    phase("south", "green", ["ranged", 4], C(2263, 3070, 2269, 3069), C(2266, 3069, 2272, 3069)),
    phase("west", "blue", S(2263, 3076), S(2263, 3073), S(2266, 3069), S(2269, 3069), ["magic", 4]),
    phase("middle", "red", MELEE, C(2263, 3070, 2269, 3069), C(2266, 3069, 2272, 3069)),
    phase("east", "green", ["ranged", 4]),
    phase("south", "green", S(2263, 3076), S(2263, 3073), S(2263, 3070), S(2273, 3072), S(2273, 3075), S(2273, 3078), C(2273, 3075, 2273, 3078), C(2272, 3069, 2273, 3072), C(2269, 3069, 2266, 3069)),
    phase("west", "blue", ["magic", 5], S(2263, 3076), S(2263, 3073), S(2263, 3070), S(2266, 3069)),
    phase("middle", "green", ["ranged", 4]),
    phase("middle", "blue", ["magic", 4], C(2263, 3073, 2266, 3069), C(2263, 3070, 2263, 3076), C(2269, 3069, 2272, 3069)),
    phase("east", "green", ["jad", "magic", 8]),
    phase("middle", "blue", S(2263, 3076), S(2263, 3073), S(2273, 3075), S(2273, 3078)),
  ],
];

/**
 * The phases in fight order: the opening, then a rotation, then its closing phase, then
 * another rotation, and so on. `pick()` chooses each rotation (0-3).
 */
class PhaseCursor {
  constructor(pick) {
    this.pick = pick;
    this.rotation = pick();
    this.index = -1;
    this.started = false;
  }

  /** The phase after the current one. */
  next() {
    if (!this.started) {
      this.started = true;
      return OPENING;
    }
    this.index++;
    const phases = ROTATIONS[this.rotation];
    if (this.index < phases.length) return phases[this.index];
    this.rotation = this.pick();
    this.index = -1;
    return CLOSING;
  }
}

module.exports = { ROTATIONS, OPENING, CLOSING, FILL, PhaseCursor };
