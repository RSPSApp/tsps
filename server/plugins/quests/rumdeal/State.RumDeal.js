/**
 * Rum Deal's stage map, varbits, ids and saved attributes, shared by the quest and its units.
 *
 * The stages are varp 600 (deal_quest) as the user's revision 242 capture sets it (RumDeal.bin,
 * docs/quests/rum-deal/README.md "Stages"). Stage 2 is agreeing to slay "Barrelor", not the knock-out:
 * the knock-out and both cutscenes leave it at 2, and the seed hand-out sets 3 and 4 together.
 */
const STAGES = Object.freeze({
  STARTED: 1, // "Yes." on "Start the Rum Deal quest?"
  AGREED: 2, // "Of course, I fear no demon!" / "Because I came to offer to help."
  MET_BRAINDEATH: 3, // the meeting, with no room for the seed
  GIVEN_SEEDS: 4, // "Here, lad. I'll give ye the seed ..."
  GROWN_BLINDWEED: 5, // the blindweed picked
  SHOWN_BLINDWEED: 6, // shown to (or replaced by) Braindeath
  BLINDWEED_ADDED: 7, // the blindweed in the intake hopper
  FETCH_WATER: 8, // "When is it ever..."
  COLLECTED_WATER: 9, // the stagnant lake
  WATER_ADDED: 10, // the water in the hopper
  CATCH_CREATURES: 11, // "Here. Ye'll need this to catch them."
  PRESSURISED: 12, // the pressure lever, two ticks after the pull
  BLESS_WRENCH: 13, // "Give the controls a couple of belts with this wrench."
  SPIRIT_BANISHED: 14, // the Evil Spirit dies
  KILL_SPIDER: 15, // the end of Braindeath's Fever Spider talk
  SPIDER_ADDED: 16, // the body in the hopper
  COLLECT_SWILL: 17, // the end of the brewing talk
  TOLD_DONNIE: 18, // "Hand it over or I'll run ye through!"
  COMPLETE: 19,
});

const VARP_QUEST = 600; // deal_quest

/** deal_* varbits the capture sends; the cache's multilocs read 1354, 1355 and 1366. */
const VARBITS = Object.freeze({
  BARREL: 1354, // deal_barrel: creatures in the pressure barrel; the lever multiloc 10164 (5 = 10165)
  MULTI_HOPPER: 1355, // deal_multi_hopper: the brewing controls multiloc 10104 (0 still, 1 possessed, 2 brewed)
  SLUG: 1357, // deal_slug: sluglings in the barrel
  THULHU: 1358, // deal_thulhu: karamthulhu in the barrel
  PIRATES: Object.freeze([1359, 1360, 1361, 1362, 1363, 1364]), // deal_multi_pirate_a-f: 1 once Donnie has drunk
  PATCH: 1366, // deal_farming: the blindweed patch multiloc 10096
});

/** Saved per-player state. The keys predate the kebab-case rule and stay for old saves. */
const ATTRIBUTES = Object.freeze({
  KNOCKED_OUT: "quest.rum_deal.intro", // 1 once Pete has knocked the player out
  WEEDS: "quest.rum_deal.weeded", // how far the patch is raked: 0 (weeds) to 3 (weeded)
  WEEDS_AT: "quest.rum_deal.weeds-at", // when that last changed, for the weeds growing back
  PLANTED: "quest.rum_deal.planted", // when the seed went in, 0 for none
  SLUGLINGS: "quest.rum_deal.slugs",
  KARAMTHULHU: "quest.rum_deal.karam",
  SPIRIT: "quest.rum_deal.spirit", // 1 while the Evil Spirit is out
});

const PAGE = "Rum Deal";

/** NPCs. Pete 601 waits at Port Phasmatys, 602 on Braindeath Island (the capture's deal_pete / deal_island_pete). */
const NPCS = Object.freeze({
  PETE: 601,
  ISLAND_PETE: 602,
  BRAINDEATH: 603,
  LUKE: 604,
  DAVEY: 605,
  DONNIE: 606,
  PROTESTERS: Object.freeze([607, 608, 609, 610, 611, 612]),
  SWABS: Object.freeze([619, 620, 621, 622, 623, 624]),
  EVIL_SPIRIT: 625,
  FEVER_SPIDER: 626,
  BREWERS: Object.freeze([627, 628, 629, 630, 631, 632, 633, 634]),
  FISHING_SPOT: 635, // deal_squid
});

/**
 * Which numbered brewer of the Wiki's transcripts each brewer NPC is. The capture talks to every one
 * of them before the quest and six of them after it, and each keeps its number (ticks 510-574,
 * 2883-2946); 630 and 633 are the two left, matched by their in-quest words.
 */
const BREWER_NUMBER = Object.freeze({ 627: 2, 628: 3, 629: 8, 630: 7, 631: 5, 632: 6, 633: 4, 634: 1 });

const TILES = Object.freeze({
  PORT_PHASMATYS: Object.freeze([3680, 3536, 0]), // where Pete's lift from the island lands (tick 3091)
  ISLAND_DOCK: Object.freeze([2162, 5114, 1]), // and his lift from Port Phasmatys (tick 3122)
  WAKE: Object.freeze([2144, 5108, 1]), // in front of Braindeath after the knock-out (tick 359)
  GATE: Object.freeze([2120, 5098, 0]),
  SPIRIT: Object.freeze([2143, 5097, 1]), // the Evil Spirit appears here facing north (tick 2316)
});

module.exports = { STAGES, VARP_QUEST, VARBITS, ATTRIBUTES, PAGE, NPCS, BREWER_NUMBER, TILES };
