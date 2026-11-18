/**
 * Zogre Flesh Eaters' native state, as the revision 242 capture sends it (rsprox ZogreFleshEaters.bin):
 * the quest varbit `zogre` (487) and its `thzfe_*` siblings, which the client's own locs read
 * (the barricade 6878/6879 on 496, the coffin 6843 on 488, Sithik's bed 6887 on 495).
 */
const VARBITS = Object.freeze({
  QUEST: 487,
  PRISM_SEARCH: 488, // 1 coffin searched, 2 lock forced, 3 lid lifted, 4 clues shown to Zavistic, 5 Sithik questioned
  INNKEEPER_MUG: 489,
  INNKEEPER_PORTRAIT: 490,
  SHOWN_NECRO_BOOK: 491,
  SHOWN_HAM_BOOK: 492,
  SHOWN_TANKARD: 493,
  SHOWN_PORTRAIT: 494,
  SITHIK_TRANSFORMED: 495, // 1 an ogre, 2 a man again once Grish has the news (tick 2328)
  BLOCKING_BARRICADE: 496, // 1 crushed: the multiloc barricade shows "Crushed barricade" (Climb-over)
  MAKE_BRUTAL_ARROW: 499,
  MAKE_COMP_OGRE_BOW: 500,
  SOLD_BALM: 502,
  BRENTLE_SKELETON: 503, // 1 the zombie rose, 2 it died
  PRISM_SOLD: 504,
  CUT_SCENE: 505, // the north-west room's entry scene played
});

const STAGES = Object.freeze({
  STARTED: 2,
  BARRICADE: 3,
  SITHIK: 4,
  POTION: 6,
  PERMANENT_SPELL: 8,
  GIVEN_KEY: 10,
  KILLED_SLASH_BASH: 12,
  COMPLETE: 14,
});

/** Saved flags for the varbits the older attributes don't cover. */
const ATTRIBUTES = Object.freeze({
  CUT_SCENE: "zogre-flesh-eaters:cut-scene-seen",
  PRISM_SOLD: "zogre-flesh-eaters:prism-sold",
  PAGE_FOUND: "zogre-flesh-eaters:page-found",
  HAM_FOUND: "zogre-flesh-eaters:ham-book-found",
  NECRO_FOUND: "zogre-flesh-eaters:necromancy-book-found",
  PORTRAITURE_FOUND: "zogre-flesh-eaters:portraiture-book-found",
});

module.exports = { VARBITS, STAGES, ATTRIBUTES };
