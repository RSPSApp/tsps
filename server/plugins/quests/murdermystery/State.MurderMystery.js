/**
 * Murder Mystery's stages, ids, saved attributes and suspects, shared by the quest and its units.
 *
 * The stage is varp 192 (murderquest) and the murderer varp 195 (murdersus), as four whole runs of
 * the quest send them (docs/quests/murder-mystery/README.md): 192 goes 0 -> 1 on "Yes." and 1 -> 2
 * at the hand-in, nothing in between; 195 is the murderer 1-6 (Anna to Frank) from the start and 0
 * again at the hand-in. Everything else the quest tracks is server-side.
 */
const STAGES = Object.freeze({ NOT_STARTED: 0, STARTED: 1, COMPLETE: 2 });

const VARPS = Object.freeze({
  QUEST: 192, // murderquest
  MURDERER: 195, // murdersus: 1 Anna ... 6 Frank (the captures' 6, 4, 4, 3 are Frank, David, David, Carol)
});

const PAGE = "Murder Mystery";

/**
 * Saved per-player state. The "quest.murder_mystery.*" keys predate the kebab-case rule and stay
 * for old saves; the poison stories are new.
 */
const ATTRIBUTES = Object.freeze({
  MURDERER: "quest.murder_mystery.murderer", // 1-6, chosen at the start
  EVIDENCE: "quest.murder_mystery.evidence", // EVIDENCE bits
  POISON: "quest.murder_mystery.poison", // POISON progress
  STORIES: "murder-mystery:poison-stories", // bit per suspect id: told why they bought the poison
});

const EVIDENCE = Object.freeze({ THREAD: 1 << 1, FINGERPRINTS: 1 << 2 });

/** 2 was "the murderer told their story" before STORIES; read as that bit for old saves. */
const POISON = Object.freeze({ NONE: 0, SALESMAN: 1, OLD_STORY: 2, PROOF: 3 });

/** NPCs. The family and the inside guard spawn as King's Ransom multis (6194-6200) whose cache names are empty. */
const NPCS = Object.freeze({
  GUARD: 4218, // murderguard, in the courtyard
  HOUSE_GUARD: 6194, // kr_murderguard_house_multi, inside (both floors)
  DONOVAN: 4212,
  PIERRE: 4213,
  HOBBES: 4214,
  LOUISA: 4215,
  MARY: 4216,
  STANFORD: 4217,
  GOSSIP: 4219, // gossipy_man
  POISON_SALESMAN: 4227,
});

const SERVANTS = Object.freeze([
  [NPCS.DONOVAN, "donovan"], [NPCS.PIERRE, "pierre"], [NPCS.HOBBES, "hobbes"],
  [NPCS.LOUISA, "louisa"], [NPCS.MARY, "mary"], [NPCS.STANFORD, "stanford"],
]);

/**
 * The suspects, by murdersus value. `thread` is the criminal's thread the window holds when they did it
 * (the captures: Frank murderthreadb 1810, David murderthreadg 1809, Carol murderthreadr 1808), and the
 * Wiki's thread colours (Bob's and Carol's red answers, Elizabeth's and Frank's blue ones).
 * `place`: the loc where they say they used the poison. `story`: the end of their own
 * answer to "Why'd you buy poison the other day?", which records it as told.
 */
const SUSPECTS = Object.freeze([
  { id: 1, name: "Anna", fragment: "anna", npcs: [4220, 6195], son: false, item: "SILVER_NECKLACE", print: "ANNAS_PRINT",
    thread: 1809, colour: "green", place: 26120, story: "kill off some of the wildlife living in it." },
  { id: 2, name: "Bob", fragment: "bob", npcs: [4221, 6196], son: true, item: "SILVER_CUP", print: "BOBS_PRINT",
    thread: 1808, colour: "red", place: 26121, story: "I decided I would deal with it myself. So I did." },
  { id: 3, name: "Carol", fragment: "carol", npcs: [4222, 6197], son: false, item: "SILVER_BOTTLE", print: "CAROLS_PRINT",
    thread: 1808, colour: "red", place: 2652, story: "I felt I had to do it myself." },
  { id: 4, name: "David", fragment: "david", npcs: [4223, 6198], son: true, item: "SILVER_BOOK", print: "DAVIDS_PRINT",
    thread: 1809, colour: "green", place: 26109, story: "fire the whole workshy lot of them!" },
  { id: 5, name: "Elizabeth", fragment: "elizabeth", npcs: [4224, 6199], son: false, item: "SILVER_NEEDLE", print: "ELIZABETHS_PRINT",
    thread: 1810, colour: "blue", place: 2654, story: "Doesn't everyone?" },
  { id: 6, name: "Frank", fragment: "frank", npcs: [4225, 6200], son: true, item: "SILVER_POT", print: "FRANKS_PRINT",
    thread: 1810, colour: "blue", place: 2655, story: "It's cleaned up a bit now." },
]);

/** The poison places' "after questioning the Sinclairs" variants, by suspect id. */
const PLACE_VARIANTS = Object.freeze({
  1: ["getting-started-investigating-the-compost-heap", "investigating-the-poisoned-areas-investigating-compost-heap-after-questioning-the-sinclairs"],
  2: ["getting-started-investigating-the-sinclair-family-beehive", "investigating-the-poisoned-areas-investigating-beehive-after-questioning-the-sinclairs"],
  3: ["getting-started-investigating-the-drain", "investigating-the-poisoned-areas-investigating-kitchen-drain-after-questioning-the-sinclairs"],
  4: ["getting-started-investigate-spiders-nest", "investigating-the-poisoned-areas-investigating-the-spiders-nest-after-questioning-the-sinclairs"],
  5: ["getting-started-investigate-fountain", "investigating-the-poisoned-areas-investigating-fountain-after-questioning-the-sinclairs"],
  6: ["getting-started-investigate-family-crest", "investigating-the-poisoned-areas-investigating-family-crest-after-questioning-the-sinclairs"],
});

const LOCS = Object.freeze({
  WINDOW: 26123, // murderwindow, the study's nameless multi (King's Ransom's 26110-26112 children)
  SACKS: 2663, // murdersacks, "Investigate"
  GATES: Object.freeze([2664, 2665]), // murderdoggatel/r, "Investigate"
  FLOUR_BARREL: 26122, // flourbarrel
});

/**
 * The Wiki's {{mes}} lines inside variants that are otherwise boxes ({{tbox}}): the "already have" lines,
 * "You take the thread.", declining the flypaper and the six print matches. Every other message the
 * quest's conversations and boxes play is a messagebox, as all four runs send them (mesbox).
 */
const MESSAGE_STEPS = new Set([
  "mDM89v", "zzMV8W", // I already have the murder weapon / the poisoned pot
  "6_kqk5", // You take the thread.
  "NILn2h", // You leave the paper in the sack.
  "yI4nWL", "Nt2mJc", "YtIqy4", "6h8hPt", "eB-hZ2", "-BD558", // I already have <the silver belonging>
  "plrEWs", "9kUNPd", "DiAVsi", "6N1bN9", "gfvFou", "Ou_j26", // The finger prints are an exact match to <name>'s.
]);

/** Variants whose messages are all {{mes}} chat lines: before the start, flour and flypaper, the plain investigations. */
const MESSAGE_VARIANT = /^(before-starting-|gathering-suspect-evidence-flour-barrel-(taking|using-empty)|gathering-suspect-evidence-using-fl|getting-started-breaking-|getting-started-investigat(e|ing)-(?!the-smashed|sturdy))/;

const STEPS = Object.freeze({
  TAKE_THREAD: "6_kqk5", // You take the thread.
  THREAD_LEFT: "noYDmb", // Lucky for you there's some thread left.
  FLYPAPER: "Cq_D8l", // You take a piece of fly paper.
  HAND_OVER: "n_EwIn", // You hand over all the evidence.
  COMPLETE: "uvOs6C", // Congratulations! Quest complete!
});

module.exports = {
  STAGES, VARPS, PAGE, ATTRIBUTES, EVIDENCE, POISON, NPCS, SERVANTS, SUSPECTS, PLACE_VARIANTS, LOCS,
  MESSAGE_STEPS, MESSAGE_VARIANT, STEPS,
};
