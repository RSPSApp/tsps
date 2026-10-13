"use strict";

/**
 * The Nylocas room's 31 waves, from the Wiki's "Theatre of Blood/Strategies/Nylocas" table:
 * per wave, what comes out of the east, south and west lanes.
 *
 * Each entry is the style a nylocas fights as - me (melee, Ischyros), ra (ranged, Toxobolos),
 * ma (magic, Hagios) - upper case for a big one, "!" for one that attacks the team instead of
 * the pillars, then for one that flickers, "~" and the styles it shows first, in order (the
 * table's colours: "flashing nylocas will usually flicker twice before entering the arena").
 * In wave 21's west lane the table's words disagree with its colours (they look swapped); the
 * colours are used, as everywhere else they end on the worded style.
 */

const WAVES = [
  /*  1 */ { east: ["me"], south: ["ma"], west: ["ra!"] },
  /*  2 */ { east: ["ra"], south: ["me!"], west: ["ma"] },
  /*  3 */ { east: ["ma!"], south: ["ra"], west: ["me"] },
  /*  4 */ { east: ["me"], south: ["MA"], west: ["ra"] },
  /*  5 */ { east: ["ma"], south: ["me"], west: ["RA"] },
  /*  6 */ { east: ["ME"], south: ["ra"], west: ["ma"] },
  /*  7 */ { east: ["ME"], south: ["ma", "RA!"], west: [] },
  /*  8 */ { east: ["ra"], south: ["me"], west: ["MA!"] },
  /*  9 */ { east: ["ma"], south: [], west: ["RA!", "me"] },
  /* 10 */ { east: ["ra!", "RA"], south: ["ra", "ra"], west: ["ra", "ra!"] },
  /* 11 */ { east: ["ma!", "ma"], south: ["ma", "ma"], west: ["MA!"] },
  /* 12 */ { east: ["me!", "me"], south: ["ME"], west: ["me", "me!"] },
  /* 13 */ { east: ["ME!"], south: ["ra", "me"], west: ["ra", "ma!"] },
  /* 14 */ { east: ["RA!"], south: ["ma", "ra"], west: ["ma", "me!"] },
  /* 15 */ { east: ["ma!", "ra"], south: ["MA"], west: ["me", "ra!"] },
  /* 16 */ { east: ["ra~mame"], south: ["ra~mema"], west: ["ra~rama"] },
  /* 17 */ { east: ["MA~mame"], south: ["MA~mame"], west: ["MA~mame"] },
  /* 18 */ { east: ["RA~rama"], south: ["RA~rama"], west: ["RA!~rama"] },
  /* 19 */ { east: ["MA!~mame"], south: ["MA~mame"], west: ["MA~mame"] },
  /* 20 */ { east: ["ME~mera"], south: ["ME!~mara"], west: ["ME~mera"] },
  /* 21 */ { east: ["ra~rame", "ra!~rame"], south: ["me~mema", "me!~mera"], west: ["ra~mame", "ma~mara"] },
  /* 22 */ { east: ["ME!~mara"], south: ["me~rama", "me~mara"], west: ["ME~mera"] },
  /* 23 */ { east: ["ME~mara"], south: ["ME!~rama"], west: ["me~mara", "ra~rama"] },
  /* 24 */ { east: ["ME!"], south: ["MA!"], west: ["ME!~rama"] },
  /* 25 */ { east: ["MA~mame"], south: ["RA"], west: ["ME!"] },
  /* 26 */ { east: ["MA"], south: ["ME~mema"], west: ["MA!"] },
  /* 27 */ { east: ["MA~mame"], south: ["RA!~mema"], west: ["MA"] },
  /* 28 */ { east: ["ma~mame", "me~rama"], south: ["me~mera", "ra~mame"], west: ["me~mera", "ma!~rame"] },
  /* 29 */ { east: ["me~mara", "ma!~rame"], south: ["ME"], west: ["ma!~mera", "ra~rame"] },
  /* 30 */ { east: ["MA!"], south: ["me~mera", "me~mara"], west: ["RA~rame"] },
  /* 31 */ { east: ["ma~mara", "ra~rame"], south: ["ra~mema", "ra~mame"], west: ["ma~mera", "ra~rama"] },
];

const STYLES = { me: "melee", ra: "ranged", ma: "magic" };

/** One wave entry as { style, big, aggressive, flickers } - flickers being the styles shown first. */
function parse(entry) {
  const [base, shown = ""] = entry.split("~");
  const aggressive = base.endsWith("!");
  const code = base.replace("!", "");
  const flickers = [];
  for (let i = 0; i < shown.length; i += 2) flickers.push(STYLES[shown.slice(i, i + 2)]);
  return { style: STYLES[code.toLowerCase()], big: code === code.toUpperCase(), aggressive, flickers };
}

module.exports = { WAVES, parse };
