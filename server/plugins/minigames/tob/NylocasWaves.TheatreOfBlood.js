"use strict";

/**
 * The Nylocas room's 31 waves: per wave, what comes out of the east, south and west lanes.
 * Captured (16 rooms, Entry, Normal and Hard: rsprox 101, 554, 1764, 1833, 1837, 1852, 3299): every
 * wave is fixed in all three modes, down to its tile and its support. The Wiki's table
 * ("Theatre of Blood/Strategies/Nylocas") agrees but for wave 7's east nylocas (small, not big),
 * wave 28's west (me~mema) and wave 31's west (ra~rame). The Entry Mode page's "30 waves" is 31 as well.
 *
 * Each entry is the style a nylocas ends up fighting as - me (melee, Ischyros), ra (ranged, Toxobolos),
 * ma (magic, Hagios) - upper case for a big one, then in this order:
 * - "!" one that goes for the team (it takes its aggressive id on reaching the arena);
 * - "~xxyy" one that flickers: it appears as xx, is yy 5 ticks later and its own style 7 ticks later;
 * - ">zz" what it changes to once more, 26 ticks after appearing;
 * - "^" it starts on the lane's upper tile;
 * - ":NE" the support it goes for (no entry: too few samples reached one).
 */

const WAVES = [
  /*  1 */ { east: ["me^:NW"], south: ["ma^:NE"], west: ["ra!"] },
  /*  2 */ { east: ["ra:SE"], south: ["me!"], west: ["ma^:NE"] },
  /*  3 */ { east: ["ma!^"], south: ["ra^:SE"], west: ["me:NE"] },
  /*  4 */ { east: ["me:NE"], south: ["MA:SW"], west: ["ra^:NW"] },
  /*  5 */ { east: ["ma^:NE"], south: ["me^:SE"], west: ["RA:SW"] },
  /*  6 */ { east: ["ME:SE"], south: ["ra:NW"], west: ["ma^:NE"] },
  /*  7 */ { east: ["me^:NW"], south: ["ma^:NE", "RA!"], west: [] },
  /*  8 */ { east: ["ra:SE"], south: ["me:NW"], west: ["MA!"] },
  /*  9 */ { east: ["ma^:NW"], south: [], west: ["me:NE", "RA!"] },
  /* 10 */ { east: ["ra!^", "RA:NE"], south: ["ra:SW", "ra^:SE"], west: ["ra!", "ra^:NW"] },
  /* 11 */ { east: ["ma!^", "ma:NE"], south: ["ma:SW", "ma^:SE"], west: ["MA!"] },
  /* 12 */ { east: ["me!^", "me:NE"], south: ["ME:SW"], west: ["me!", "me^:NW"] },
  /* 13 */ { east: ["ME!"], south: ["me:SW", "ra^:SE"], west: ["ma!", "ra^:NW"] },
  /* 14 */ { east: ["RA!"], south: ["ma^:SE", "ra:SW"], west: ["ma^:NW", "me!"] },
  /* 15 */ { east: ["ma!^", "ra:NE"], south: ["MA:SW"], west: ["me^:NW", "ra!"] },
  /* 16 */ { east: ["ra~mame>ma:NE"], south: ["ra~mema>ma:SW"], west: ["ra~rama>ma^:NW"] },
  /* 17 */ { east: ["MA~mame>me:NE"], south: ["MA~mame>me:SE"], west: ["MA~mame>me:SW"] },
  /* 18 */ { east: ["RA~rama>ma:NW"], south: ["RA~rama>ma:SW"], west: ["RA!~rama>ma"] },
  /* 19 */ { east: ["MA!~mame>me"], south: ["MA~mame>me:SE"], west: ["MA~mame>me:NE"] },
  /* 20 */ { east: ["ME~mera>ra:NE"], south: ["ME!~mara>ra"], west: ["ME~mera>ra:NW"] },
  /* 21 */ { east: ["ra!~rame>ma", "ra~rame>me^:NE"], south: ["me!~mera>ra", "me~mema>ra^:SE"], west: ["ma~mara>me^:NW", "ra~mame>ma:SW"] },
  /* 22 */ { east: ["ME!~mara>ra"], south: ["me~mara>ma:SW", "me~rama>ma^:SE"], west: ["ME~mera>ra:SW"] },
  /* 23 */ { east: ["ME~mara>ra:NE"], south: ["ME!~rama>ma"], west: ["me~mara>ra^:NW", "ra~rama>me:SW"] },
  /* 24 */ { east: ["ME!"], south: ["MA!"], west: ["ME!~rama>ma"] },
  /* 25 */ { east: ["MA~mame>me:SE"], south: ["RA:SW"], west: ["ME!"] },
  /* 26 */ { east: ["MA:NE"], south: ["ME~mema>ra:SW"], west: ["MA!"] },
  /* 27 */ { east: ["MA~mame>me:SE"], south: ["RA!~mema>ma"], west: ["MA:NW"] },
  /* 28 */ { east: ["ma~mame>me^:NE", "me~rama>ra:SE"], south: ["me~mera>ma^:SE", "ra~mame>ma:SW"], west: ["ma!~rame>me", "me~mema>ra^:NW"] },
  /* 29 */ { east: ["ma!~rame>me", "me~mara>ma^:NE"], south: ["ME:SE"], west: ["ma!~mera>ra^", "ra~rame>me:SW"] },
  /* 30 */ { east: ["MA!"], south: ["me~mara>ma:SW", "me~mera>ma^:SE"], west: ["RA~rame>me:SW"] },
  /* 31 */ { east: ["ma~mara>ra^:NE", "ra~rame>me:SE"], south: ["ra~mame>me:SW", "ra~mema>me^:SE"], west: ["ma~mera>ra^:NW", "ra~rame>ma:SW"] },
];

/**
 * Ticks from one wave to the next, the shortest captured in each mode: the game checks every 4 ticks,
 * and a wave stalled by the cap goes at a later check. Normal: 12 rooms. Hard: 3 rooms (its 10th and 30th
 * gaps are longer than Normal's in all of them). Entry: 2 rooms, so stalls may hide in these.
 */
const GAPS = {
  entry: [8, 4, 8, 4, 16, 8, 12, 4, 16, 12, 16, 8, 16, 12, 12, 8, 16, 8, 12, 16, 12, 12, 8, 8, 8, 28, 8, 8, 4, 8],
  normal: [4, 4, 4, 4, 16, 4, 12, 4, 12, 8, 8, 8, 8, 8, 8, 4, 12, 8, 12, 16, 8, 12, 8, 8, 8, 4, 8, 4, 4, 4],
  hard: [4, 4, 4, 4, 16, 4, 12, 4, 12, 24, 8, 8, 8, 8, 8, 4, 12, 8, 12, 16, 8, 12, 8, 8, 8, 4, 8, 8, 4, 16],
};

const STYLES = { me: "melee", ra: "ranged", ma: "magic" };
const ENTRY = /^(me|ra|ma)(!?)(?:~(..)(..))?(?:>(..))?(\^?)(?::(..))?$/i;

/** One wave entry as { style, big, aggressive, flickers, late, upper, support }: flickers being the styles shown first. */
function parse(entry) {
  const [, code, aggressive, first, second, late, upper, support] = entry.match(ENTRY);
  return {
    style: STYLES[code.toLowerCase()],
    big: code === code.toUpperCase(),
    aggressive: aggressive === "!",
    flickers: first ? [STYLES[first], STYLES[second]] : [],
    late: late ? STYLES[late] : null,
    upper: upper === "^",
    support: support ?? null,
  };
}

module.exports = { WAVES, GAPS, parse };
