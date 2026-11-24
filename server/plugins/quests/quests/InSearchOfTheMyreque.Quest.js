/**
 * In Search of the Myreque (members).
 *
 * The words come from the "In Search of the Myreque" transcript page; this plugin
 * supplies the variant selector for Vanstrom Klause, Cyreg Paddlehorn, Curpile
 * Fyod, Veliaf Hurtz, the five hideout members and the post-quest Stranger, the
 * prose-condition answers, the start hook, the Curpile quiz routing, the
 * boat/rope-bridge/hideout traversal and the Skeleton Hellhound fight.
 *
 * Stages (varp 387): 5 agreed, 10 refused delivery, 15 persuaded boatman,
 * 20 gave planks, 25 reached Hollows, 52 questioned by Curpile, 55 answered,
 * 60 entered hideout, 65 met Veliaf, 67 weapons handed over, 70 cutscene,
 * 80 hellhound summoned, 85 killed hellhound, 90 shown way out,
 * 95 in inn basement, 97 escaped to Canifis, 105 complete.
 *
 * Sources: an rsprox capture of a whole live playthrough (revision 242; docs/in-search-of-the-myreque.md has the facts,
 * by tick) for what happens between the words: stage changes, varbits, animations, sounds, tiles, timings and the
 * cutscene; the OSRS Wiki and the transcript for the words and the rules. Where the two disagree the Wiki's value is
 * kept and the doc lists the recorded difference.
 *
 * Units: ../insearchofthemyreque/Bridge (the rope bridge) and Hideout (Vanstrom's cutscene and the hellhound fight).
 * The quest NPCs are world spawns (their multinpcs follow varp 387 and varbits 396/10367); only the cutscene cast and
 * the Skeleton Hellhound are spawned, owner-only. Curpile's quiz is a counted random in the regenerated Myreque record
 * (RSPSApp/osrsreboxed-db#108: three of six questions, no repeats, then the four count conditions): the plugin resets a
 * per-attempt counter on draw 1, scores each answer against the drawn question's text and answers the count conditions
 * by their ids, mirroring the counts to varbits 173/174 as live does.
 */
module.exports = function registerInSearchOfTheMyrequeQuest(api) {
  const { Skill, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest, refreshQuestList, loadTranscripts } = require("../QuestRuntime");
  const { createQuestScenes } = require("../QuestScenes");

  const VARP_IN_SEARCH_OF_THE_MYREQUE = 387;

  const STAGE_UNSTARTED = 0;
  const STAGE_STARTED = 5; // agreed_to_help
  const STAGE_REFUSED_DELIVERY = 10;
  const STAGE_PERSUADED_BOATMAN = 15;
  const STAGE_GAVE_PLANKS = 20;
  const STAGE_REACHED_HOLLOWS = 25;
  const STAGE_QUESTIONED_BY_CURPILE = 52;
  const STAGE_ANSWERED_QUESTIONS = 55;
  const STAGE_ENTERED_HIDEOUT = 60;
  const STAGE_MET_VELIAF = 65;
  const STAGE_WEAPONS_ACCEPTED = 67;
  const STAGE_DELIVERED_WEAPONS = 70;
  const STAGE_HELLHOUND_SUMMONED = 80;
  const STAGE_KILLED_HELLHOUND = 85;
  const STAGE_SHOWN_WAY_OUT = 90;
  const STAGE_IN_INN_BASEMENT = 95;
  const STAGE_ESCAPED_TO_CANIFIS = 97;
  const STAGE_COMPLETE = 105;

  const VANSTROM_NPC_IDS = new Set([NpcIdentifiers.VANSTROM_KLAUSE_8]); // 5056
  const CYREG_NPC_ID = NpcIdentifiers.CYREG_PADDLEHORN; // 5046
  const CURPILE_NPC_ID = NpcIdentifiers.CURPILE_FYOD; // 9619
  const STRANGER_NPC_ID = NpcIdentifiers.STRANGER_2; // 5055
  const VELIAF_NPC_IDS = new Set([
    NpcIdentifiers.VELIAF_HURTZ, // 989
    NpcIdentifiers.VELIAF_HURTZ_2, // 5048
    15879, // Veliaf Hurtz (cache id, no identifier)
    15885, // Veliaf Hurtz (cache id, no identifier)
  ]);
  const HAROLD_NPC_IDS = new Set([NpcIdentifiers.HAROLD_EVANS, 9803]); // 9803: route_harold_evans, the spawn that shows 9624
  const HELLHOUND_NPC_IDS = new Set([
    NpcIdentifiers.SKELETON_HELLHOUND, // 5054
    NpcIdentifiers.SKELETON_HELLHOUND_2, // 6387
  ]);

  /**
   * npc id -> member slug (page variant stem), met flag and its bit of thsfm_spoken_allmyreque (varbit 2496): live sets
   * Harold 2, Radigad 4, Sani 1, Polmafi 8, Ivan 16 on each first talk (capture ticks 1135, 1166, 1188, 1211, 1236).
   */
  const MEMBERS = new Map([
    [NpcIdentifiers.SANI_PILIU, { name: "Sani Piliu", slug: "sani-piliu", flag: "met_sani", bit: 1, after: null }],
    [NpcIdentifiers.SANI_PILIU_2, { name: "Sani Piliu", slug: "sani-piliu", flag: "met_sani", bit: 1, after: null }],
    [NpcIdentifiers.HAROLD_EVANS, { name: "Harold Evans", slug: "harold-evans", flag: "met_harold", bit: 2, after: null }],
    [NpcIdentifiers.HAROLD_EVANS_2, { name: "Harold Evans", slug: "harold-evans", flag: "met_harold", bit: 2, after: null }],
    [NpcIdentifiers.RADIGAD_PONFIT, { name: "Radigad Ponfit", slug: "radigad-ponfit", flag: "met_radigad", bit: 4, after: "myreque-hideout-after-defeating-the-skeleton-hellhound-radigad-ponfit" }],
    [NpcIdentifiers.POLMAFI_FERDYGRIS, { name: "Polmafi Ferdygris", slug: "polmafi-ferdygris", flag: "met_polmafi", bit: 8, after: "myreque-hideout-after-defeating-the-skeleton-hellhound-polmafi-ferdygris" }],
    [NpcIdentifiers.IVAN_STROM, { name: "Ivan Strom", slug: "ivan-strom", flag: "met_ivan", bit: 16, after: "myreque-hideout-after-defeating-the-skeleton-hellhound-ivan-strom" }],
    [NpcIdentifiers.IVAN_STROM_2, { name: "Ivan Strom", slug: "ivan-strom", flag: "met_ivan", bit: 16, after: "myreque-hideout-after-defeating-the-skeleton-hellhound-ivan-strom" }],
    [NpcIdentifiers.IVAN_STROM_3, { name: "Ivan Strom", slug: "ivan-strom", flag: "met_ivan", bit: 16, after: "myreque-hideout-after-defeating-the-skeleton-hellhound-ivan-strom" }],
    [NpcIdentifiers.IVAN_STROM_5, { name: "Ivan Strom", slug: "ivan-strom", flag: "met_ivan", bit: 16, after: "myreque-hideout-after-defeating-the-skeleton-hellhound-ivan-strom" }],
    [NpcIdentifiers.IVAN_STROM_6, { name: "Ivan Strom", slug: "ivan-strom", flag: "met_ivan", bit: 16, after: "myreque-hideout-after-defeating-the-skeleton-hellhound-ivan-strom" }],
    [NpcIdentifiers.IVAN_STROM_7, { name: "Ivan Strom", slug: "ivan-strom", flag: "met_ivan", bit: 16, after: "myreque-hideout-after-defeating-the-skeleton-hellhound-ivan-strom" }],
    [NpcIdentifiers.IVAN_STROM_8, { name: "Ivan Strom", slug: "ivan-strom", flag: "met_ivan", bit: 16, after: "myreque-hideout-after-defeating-the-skeleton-hellhound-ivan-strom" }],
    [NpcIdentifiers.IVAN_STROM_9, { name: "Ivan Strom", slug: "ivan-strom", flag: "met_ivan", bit: 16, after: "myreque-hideout-after-defeating-the-skeleton-hellhound-ivan-strom" }],
    [NpcIdentifiers.IVAN_STROM_10, { name: "Ivan Strom", slug: "ivan-strom", flag: "met_ivan", bit: 16, after: "myreque-hideout-after-defeating-the-skeleton-hellhound-ivan-strom" }],
    [NpcIdentifiers.IVAN_STROM_11, { name: "Ivan Strom", slug: "ivan-strom", flag: "met_ivan", bit: 16, after: "myreque-hideout-after-defeating-the-skeleton-hellhound-ivan-strom" }],
  ]);

  const STEEL_LONGSWORD_ITEM_ID = ItemIdentifiers.STEEL_LONGSWORD;
  const STEEL_SWORD_ITEM_ID = ItemIdentifiers.STEEL_SHORTSWORD;
  const STEEL_DAGGER_ITEM_ID = ItemIdentifiers.STEEL_DAGGER;
  const STEEL_MACE_ITEM_ID = ItemIdentifiers.STEEL_MACE;
  const STEEL_WARHAMMER_ITEM_ID = ItemIdentifiers.STEEL_WARHAMMER;
  const PLANK_ITEM_ID = ItemIdentifiers.PLANK;
  const COINS_ITEM_ID = ItemIdentifiers.COINS;
  const RING_OF_CHAROS_A_ITEM_IDS = [
    ItemIdentifiers.RING_OF_CHAROS_A_, // 6465
    ItemIdentifiers.RING_OF_CHAROS_A__2, // 17756
  ];
  const DRUID_POUCH_ITEM_IDS = [
    ItemIdentifiers.DRUID_POUCH,
    ItemIdentifiers.DRUID_POUCH_2,
    ItemIdentifiers.DRUID_POUCH_3,
  ];

  /** The steel delivery Vanstrom asks for (amounts matter for two swords). */
  const WEAPONS = [
    { itemId: STEEL_LONGSWORD_ITEM_ID, amount: 1, label: "1 x Steel longsword" },
    { itemId: STEEL_SWORD_ITEM_ID, amount: 2, label: "2 x Steel shortsword" },
    { itemId: STEEL_DAGGER_ITEM_ID, amount: 1, label: "1 x Steel dagger" },
    { itemId: STEEL_MACE_ITEM_ID, amount: 1, label: "1 x Steel mace" },
    { itemId: STEEL_WARHAMMER_ITEM_ID, amount: 1, label: "1 x Steel warhammer" },
  ];
  const JOURNAL_MEMBERS = [
    MEMBERS.get(NpcIdentifiers.SANI_PILIU),
    MEMBERS.get(NpcIdentifiers.HAROLD_EVANS),
    MEMBERS.get(NpcIdentifiers.RADIGAD_PONFIT),
    MEMBERS.get(NpcIdentifiers.POLMAFI_FERDYGRIS),
    MEMBERS.get(NpcIdentifiers.IVAN_STROM),
  ];

  const ROPE_BRIDGE_ID = ObjectIdentifiers.ROPE_BRIDGE; // 5002, Cross
  const BRIDGE_TREE_PARENT_ID = 5003; // spooky_tree_base_forbridge, shown by varbit 3928 as 50787 (Climb) or 50788 (Cross-bridge)
  const BRIDGE_TREE_IDS = new Set([ObjectIdentifiers.TREE_117, ObjectIdentifiers.TREE_118]); // 26248, 26249
  const BROKEN_BRIDGE_IDS = new Set([
    ObjectIdentifiers.BROKEN_ROPE_BRIDGE_2, // 26244
    26245, // route_swampbridge_1, varbit 176
    26246, // route_swampbridge_2, varbit 177
    26247, // route_swampbridge_3, varbit 178
  ]);
  const SURFACE_DOOR_IDS = new Set([ObjectIdentifiers.WOODEN_DOORS_7, ObjectIdentifiers.WOODEN_DOORS_8]);
  /**
   * Open on the doors in the earth (freedomfighterentrancer 5061 at (3509,3447), size 2): the open pair 5062/5063 in
   * their place, iron_door_open (71) and the fade on the tick after human_pickuptable (832), the move into the cave two
   * ticks on (capture ticks 1081-1086).
   */
  const SURFACE_DOOR_OPEN = { left: ObjectIdentifiers.WOODEN_DOORS_9, right: ObjectIdentifiers.WOODEN_DOORS_10 }; // 5062, 5063
  const SURFACE_DOOR_ANIMATION = 832; // human_pickuptable
  const SURFACE_DOOR_SOUND = 71; // iron_door_open
  const CAVE_LANDING = { x: 3500, y: 9811 };
  /** The hideout's arrival tile from the main cave's tunnel (loc-teleports: route_cavewalltunnel at (3492,9823)). */
  const HIDEOUT_TUNNEL = { x: 3492, y: 9823 };
  const STALAGMITE_ID = ObjectIdentifiers.STALAGMITE_3; // 5050
  const FAKE_WALL_ID = ObjectIdentifiers.WALL_17; // 5052, thrttavernbasementfalsewall
  /**
   * The hidden wall at the end of the tunnel: loc 5052 "Wall" (op Search) at (3480,9837), type 0, rotation 3, a straight
   * wall on that tile's south edge between (3480,9836) and (3480,9837). Searching it from (3480,9836) (capture tick
   * 1574): the wall becomes an invisible one (inviswall 38848) and the inactive wall (5053) stands open on (3480,9836),
   * rotation 0; door_open (62); the player walks one tile north; two ticks on the wall is back and the open leaf gone.
   */
  const WALL_NORTH_SIDE = { x: 3480, y: 9837 };
  const WALL_SOUTH_SIDE = { x: 3480, y: 9836 };
  const INVISIBLE_WALL_ID = 38848; // inviswall
  const OPEN_WALL_ID = ObjectIdentifiers.WALL_18; // 5053, thrttavernbasementfalsewall_inactive
  const WALL_OPEN_SOUND = 62; // door_open
  const WALL_OPEN_TICKS = 2;
  const IGNORE_CLIPPING_FLAG = "movement:ignore-clipping";
  const WALL_PASS_ATTRIBUTE = "in-search-of-the-myreque:wall-pass-prior-clipping";
  const wallPasses = new WeakMap();
  const TAVERN_LADDER_ID = ObjectIdentifiers.LADDER_54; // 5054
  /** Climb-up: human_reachforladder (828), the move to (3495,3465) the next tick (capture ticks 1581-1582). */
  const LADDER_ANIMATION = 828;
  const LADDER_TOP = { x: 3495, y: 3465 };
  const TAVERN_TRAPDOOR_ID = ObjectIdentifiers.TRAPDOOR_23; // 5055
  const HIDEOUT_EXIT_DOOR_IDS = new Set([
    ObjectIdentifiers.WOODEN_DOORS_3, // 5056
    ObjectIdentifiers.WOODEN_DOORS_4, // 5057
  ]);
  const MORT_TON_BOAT_ID = ObjectIdentifiers.SWAMP_BOATY_2; // 6969
  const HOLLOWS_BOAT_ID = ObjectIdentifiers.SWAMP_BOATY_3; // 6970
  const HOLLOWS_SIGN_ID = ObjectIdentifiers.SIGN_35; // 26255
  /**
   * The boat ride to the Hollows (Cyreg's Travel, capture ticks 621-641; the Mort'ton boat's Board, 898-916): the fare and
   * the fade on the click, then the side tabs close, the "morytania boatride" jingle (137), swamp_boatjourney (321) and
   * the box "You board the boat and journey to the Hollows." (no continue) the next tick; the move to (3498,3380) fourteen
   * ticks on, and a tick later the box "You arrive at the Hollows.", the tabs back, 321 shut and the fade back in.
   */
  const BOAT_JOURNEY_INTERFACE = 321;
  const BOAT_JINGLE = 137;
  const BOAT_RIDE_TICKS = 15;
  const HOLLOWS_LANDING = { x: 3498, y: 3380 };
  const MORT_TON_LANDING = { x: 3522, y: 3285 };
  const BOAT_FARE = 10;

  const START_HOOK = "quest:in-search-of-the-myreque:start";
  // Ids of the record imported from RSPSApp/osrsreboxed-db c971f8ee2 (#108 there, docs/npc-dialogues.json): Curpile's quiz is a counted
  // random (three of six questions, no repeats) followed by the "After the third question is answered:" block whose four
  // count conditions and knock-out messages carry these ids. Node ids of the export: a re-export that renames them is
  // caught by tests/myreque-quiz-counting.test.cjs and myreque-curpile-step-ids.test.cjs, which read the imported file.
  const QUIZ_COUNT_CONDITION_IDS = new Map([
    ["A6wXnN", 0], // "If the player answered zero out of three questions correctly:"
    ["arNFa2", 1], // "... one out of three ..."
    ["K8_P_w", 2], // "... two out of three ..."
    ["p493oV", 3], // "... three out of three ..."
  ]);
  const QUIZ_PASS_CONDITION_ID = "p493oV";
  const SHOW_POUCH_MESSAGE_ID = "BKpf08";
  const PLANKS_MESSAGE_ID = "DsO5TF";
  const HAND_IN_MESSAGE_ID = "OVBQEv"; // "You give the weapons to Veliaf."
  const SUMMON_HOUND_ACTION_ID = "OFmcmp";
  // "Curpile knocks you out and takes you back to Mort'ton." after one, two or three wrong answers.
  const KNOCKOUT_MESSAGE_IDS = new Set(["HQfMkY", "XmM1Px", "k1iShr"]); // zero, one, two correct (RSPSApp/osrsreboxed-db#108 record)
  const FIRST_SPEAKING_STEP_FLAGS = new Map([
    ["k_vzYt", "met_harold"],
    ["_g5SY-", "met_radigad"],
    ["25JBP_", "met_polmafi"],
    ["C5YuIy", "met_sani"],
    ["KI2Pb0", "met_ivan"],
    ["a8YEIJ", "veliaf_after"],
  ]);
  /** The six quiz questions (the sentence after "Okay, [first/second/third and final] question.") -> the correct answer. */
  const QUIZ_ANSWERS = new Map([
    ["Name the only female member of the Myreque.", "Sani Piliu."],
    ["Who is the youngest member of the Myreque?", "Ivan Strom."],
    ["Who is the leader of the Myreque in Mort Myre?", "Veliaf Hurtz."],
    ["Which member of the Myreque was originally a scholar?", "Polmafi Ferdygris."],
    ["What is the name of the boatman who helps the Myreque?", "Cyreg Paddlehorn."],
    ["What vampyre family rules over Morytania?", "Drakan."],
  ]);
  const QUIZ_QUESTION_PREFIX = "Okay, [first/second/third and final] question. ";
  /** routequestionscorrect / routequestionsanswered: live counts each attempt's answers (reset as an attempt starts). */
  const QUIZ_CORRECT_VARBIT = 173;
  const QUIZ_ANSWERED_VARBIT = 174;
  /**
   * The knock-out (capture ticks 778-791, 882-895): with the box up (no continue), Curpile's human_sword_slash (390) and
   * hacksword_slash (2500); a tick later the player's human_staff_block (415), stunned_thieving (245, height 124) and
   * stunned (2727); a tick later human_death_backwards (837) and the fade; the minimap off a tick after that; the move
   * to Mort'ton seven ticks after the box; three ticks on the fade back in and the box again, now with continue.
   */
  const KNOCKOUT = {
    curpileAnimation: 390, curpileSound: 2500,
    blockAnimation: 415, stunSpotanim: 245, stunHeight: 124, stunSound: 2727,
    fallAnimation: 837, moveTicks: 7, wakeTicks: 10,
    text: "Curpile knocks you out and takes you back to Mort'ton.",
  };
  /** The refusal punch (capture tick 698): "Curpile punches you.", the 3 damage and human_unarmedpunch (422) on the player. */
  const PUNCH_MESSAGE = "Curpile punches you.";
  const PUNCH_ANIMATION = 422;

  /**
   * The Hair of the Dog's stranger is one spawn (cache NPC 6269) that shows Vanstrom Klause (5056) while varbit 396
   * (thsfm_vanstrom_hide) is 0 and the plain Stranger (5055) when it is 1. Live sets it as the cutscene starts, with
   * stage 70 (capture tick 1301). It stays 1 after completion (Wiki, Stranger: "only upon completing In Search of the
   * Myreque will the stranger replace Vanstrom"), though live's completion clears varp 388 with it (tick 1617; a
   * recorded difference). Re-derived from the stage at every change and login.
   */
  const VANSTROM_HIDE_VARBIT = 396;
  /** Flags of the members whose first-time branch has already played in the conversation in progress. */
  const metThisConversation = new WeakMap();
  const BRIDGE_ATTRIBUTE = "quest.in_search_of_the_myreque.bridge";
  const QUIZ_CORRECT_ATTRIBUTE = "quest.in_search_of_the_myreque.quiz.correct";
  /** The question each player is being asked right now (set by the draw event, cleared by the answer). */
  const askedQuestion = new WeakMap();
  /** Answers given in the attempt in progress (varbit 174). */
  const quizAnswered = new WeakMap();
  const knockedOut = new WeakSet();
  /** Where the hound waits for a player who left the fight and came back (Wiki: "close to the entrance"). Ours: the tile. */
  const HELLHOUND_SPOT = { x: 3505, y: 9834, z: 0 };
  const SPOKEN_ALL_MYREQUE_VARBIT = 2496;
  const SCENE_EXIT_ATTRIBUTE = "quest.in_search_of_the_myreque.scene_exit";

  let quest;
  const houndByPlayer = new Map();
  /** The quest handle for the units, which are built before registerQuest returns it. */
  const questRef = {
    getStage: (player) => quest.getStage(player),
    setStage: (player, stage) => quest.setStage(player, stage),
    isComplete: (player) => quest.isComplete(player),
  };
  const Scenes = createQuestScenes(api, { onEnd: sceneEnded, recoveryAttribute: SCENE_EXIT_ATTRIBUTE });
  const Bridge = require("../insearchofthemyreque/Bridge.InSearchOfTheMyreque")(api, {
    quest: questRef, attribute: BRIDGE_ATTRIBUTE, stageReachedHollows: STAGE_REACHED_HOLLOWS,
  });
  const Hideout = require("../insearchofthemyreque/Hideout.InSearchOfTheMyreque")(api, {
    Scenes,
    quest: questRef,
    stages: {
      MET_VELIAF: STAGE_MET_VELIAF, DELIVERED_WEAPONS: STAGE_DELIVERED_WEAPONS, HELLHOUND_SUMMONED: STAGE_HELLHOUND_SUMMONED,
    },
    onKilled: veliafAfterTheHound,
  });

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;

  function hasAllWeapons(player) {
    return WEAPONS.every((weapon) => held(player, weapon.itemId, weapon.amount));
  }

  function hasDruidPouch(player) {
    // The pouch's stack size is its remaining charges (Nature Spirit fills it).
    const charges = DRUID_POUCH_ITEM_IDS.reduce(
      (sum, itemId) => sum + player.getInventory().getAmount(itemId),
      0
    );
    return charges >= 5;
  }

  function metFlag(player, flag) {
    return player.getAttribute(`quest.in_search_of_the_myreque.${flag}`) === true;
  }

  function setMetFlag(player, flag) {
    player.setAttribute(`quest.in_search_of_the_myreque.${flag}`, true);
    sendSpokenMembers(player);
  }

  /** thsfm_spoken_allmyreque (varbit 2496): one bit per member met; 0 once the quest is complete (capture tick 1617). */
  function sendSpokenMembers(player) {
    const value = quest.isComplete(player) ? 0
      : JOURNAL_MEMBERS.reduce((sum, member) => sum | (metFlag(player, member.flag) ? member.bit : 0), 0);
    player.getPacketSender().sendVarbit(SPOKEN_ALL_MYREQUE_VARBIT, value);
  }

  function allMembersMet(player) {
    return JOURNAL_MEMBERS.every((member) => metFlag(player, member.flag));
  }

  function quizCorrect(player) {
    return Number(player.getAttribute(QUIZ_CORRECT_ATTRIBUTE)) || 0;
  }

  // ---- Journal ----

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Vanstrom Klause asked me to take steel weapons to the</str>",
        "<str>Myreque, but he was a vampyre who followed me to their</str>",
        "<str>hideout. Sani and Harold were killed before I defeated</str>",
        "<str>the Skeleton Hellhound he summoned.</str>",
        "",
        "<str>I found a quicker route between Mort'ton and Canifis.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage < STAGE_STARTED) {
      return [
        "I can start this quest by speaking to the",
        "<col=800000>stranger</col> in the 'Hair of the Dog Inn' in Canifis.",
        "",
        "I need to have completed Nature Spirit and have 25 Agility.",
      ];
    }
    const lines = ["<str>Vanstrom Klause asked me to take steel weapons to the Myreque.</str>"];
    if (stage < STAGE_DELIVERED_WEAPONS) {
      lines.push("The weapons he asked for:");
      for (const weapon of WEAPONS) {
        lines.push(held(player, weapon.itemId, weapon.amount) ? `<str>${weapon.label}</str>` : `<col=800000>${weapon.label}</col>`);
      }
    }
    if (stage >= STAGE_REFUSED_DELIVERY && stage < STAGE_PERSUADED_BOATMAN) {
      lines.push("The boatman Cyreg in Mort'ton won't take me to the hideout yet.");
    }
    if (stage >= STAGE_PERSUADED_BOATMAN && stage < STAGE_GAVE_PLANKS) {
      lines.push("Cyreg needs 6 planks: 3 for his boat and 3 for the bridge.");
    }
    if (stage >= STAGE_GAVE_PLANKS && stage < STAGE_REACHED_HOLLOWS) {
      lines.push("I can use Cyreg's boat to travel north to the Hollows.");
    }
    if (stage >= STAGE_REACHED_HOLLOWS && stage < STAGE_ANSWERED_QUESTIONS) {
      lines.push("I reached the Hollows; Curpile Fyod guards the way to the Myreque.");
    }
    if (stage >= STAGE_ANSWERED_QUESTIONS && stage < STAGE_ENTERED_HIDEOUT) {
      lines.push("I answered Curpile's questions; the doors behind the tree are open.");
    }
    if (stage >= STAGE_ENTERED_HIDEOUT && stage < STAGE_MET_VELIAF) {
      lines.push("I entered the hideout; I should look for the Myreque members.");
    }
    if (stage >= STAGE_MET_VELIAF && stage < STAGE_DELIVERED_WEAPONS) {
      lines.push("I need to introduce myself to:");
      for (const member of JOURNAL_MEMBERS) {
        lines.push(metFlag(player, member.flag) ? `<str>${member.name}</str>` : `<col=800000>${member.name}</col>`);
      }
    }
    if (stage >= STAGE_MET_VELIAF && stage < STAGE_WEAPONS_ACCEPTED && allMembersMet(player)) {
      lines.push("I should hand the weapons over to Veliaf.");
    }
    if (stage === STAGE_WEAPONS_ACCEPTED) lines.push("I gave the weapons to Veliaf.");
    if (stage >= STAGE_HELLHOUND_SUMMONED && stage < STAGE_KILLED_HELLHOUND) {
      lines.push("Vanstrom summoned a Skeleton Hellhound! I must kill it.");
    }
    if (stage >= STAGE_KILLED_HELLHOUND && stage < STAGE_SHOWN_WAY_OUT) {
      lines.push("I killed the hellhound; I should ask Veliaf for a way out.");
    }
    if (stage >= STAGE_SHOWN_WAY_OUT && stage < STAGE_IN_INN_BASEMENT) {
      lines.push("I should search the wall in the tunnel for the hidden door.");
    }
    if (stage >= STAGE_IN_INN_BASEMENT && stage < STAGE_ESCAPED_TO_CANIFIS) {
      lines.push("I should climb the ladder out of the inn basement.");
    }
    if (stage >= STAGE_ESCAPED_TO_CANIFIS) {
      lines.push("I escaped to Canifis; I should find the stranger in the tavern.");
    }
    return lines;
  }

  function grantReward(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.ATTACK, 600);
    skills.addExperiences(Skill.DEFENCE, 600);
    skills.addExperiences(Skill.STRENGTH, 600);
    skills.addExperiences(Skill.HITPOINTS, 600);
    skills.addExperiences(Skill.CRAFTING, 600);
  }

  // ---- Dialogue ----

  const CURPILE_PAGE = "In Search of the Myreque";
  const CURPILE_FIRST_VARIANT = "convincing-curpile-fyod-talking-to-curpile-fyod";
  const CURPILE_RETRY_VARIANT = "convincing-curpile-fyod-talking-to-curpile-fyod-again-before-convincing-him";

  /**
   * The quiz as the first-time page plays it: the counted random and the sibling steps after it (the after-question blocks and
   * the four count conditions), from the random node to the end of the "I've come to help the Myreque" answer. Null when the
   * record has no such node (an older export), so the plain behaviour is kept.
   */
  function quizTail() {
    const steps = loadTranscripts(api)?.[CURPILE_PAGE]?.variants?.[CURPILE_FIRST_VARIANT];
    if (!Array.isArray(steps)) return null;
    for (const step of steps) {
      for (const option of Array.isArray(step?.options) ? step.options : []) {
        const body = Array.isArray(option?.steps) ? option.steps : [];
        const start = body.findIndex((entry) => entry?.type === "random" && entry.count > 1);
        if (start >= 0) return body.slice(start);
      }
    }
    return null;
  }

  /**
   * After a knock-out the player stays at stage 52, and the retry variant ("Back again? ..." / "Well let's hear them then." /
   * "Okay, first question...") ends in a jump above (id 8xSPeu) that has no target, so the dialogue closed with no quiz. The
   * retry plays its first two lines and then the quiz tail; its third line ("Okay, first question...") is dropped because the
   * first drawn question already opens with that ordinal.
   */
  function spliceQuizRetry(tail) {
    return (steps) => {
      const jump = steps.findIndex((step) => step?.type === "jump" && step.reference === "above");
      if (jump < 0) return steps;
      const lines = steps.slice(0, jump).filter((step) => !String(step?.text ?? "").startsWith("Okay, first question..."));
      return [...lines, ...tail];
    };
  }

  /** Talk-to Curpile at stage 52-54: the retry plays the quiz again from draw 1. */
  function talkToCurpile(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_QUESTIONED_BY_CURPILE || stage >= STAGE_ANSWERED_QUESTIONS) return false;
    const tail = quizTail();
    if (!tail) {
      console.warn("[InSearchOfTheMyreque] Curpile's quiz tail is missing or unreadable in the dialogue record; the retry plays the plain variant");
      return false;
    }
    askedQuestion.delete(player);
    player.setAttribute(QUIZ_CORRECT_ATTRIBUTE, 0);
    event.handled = true;
    api.emitCustomEvent("npc-dialogue:start", {
      player,
      npc: event.npc,
      npcId: event.npcId,
      variant: CURPILE_RETRY_VARIANT,
      exact: true,
      select: spliceQuizRetry(tail),
    });
    return true;
  }

  /** Which transcript variant each speaker plays, by quest stage. */
  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (VANSTROM_NPC_IDS.has(npcId)) {
      if (stage === STAGE_UNSTARTED) return "starting-out-vanstrom-klause";
      if (stage < STAGE_ESCAPED_TO_CANIFIS) return "starting-out-talking-to-vanstrom-klause-again";
      return null;
    }
    if (npcId === CYREG_NPC_ID) {
      if (stage < STAGE_STARTED) return null;
      if (stage < STAGE_REFUSED_DELIVERY) return "convincing-cyreg-paddlehorn-talking-to-cyreg";
      if (stage < STAGE_PERSUADED_BOATMAN) return "convincing-cyreg-paddlehorn-talking-to-cyreg-again";
      if (stage < STAGE_GAVE_PLANKS) return "convincing-cyreg-paddlehorn-talking-to-cyreg-after-convincing-him";
      return "convincing-cyreg-paddlehorn-talking-to-cyreg-after-fixing-the-boaty";
    }
    if (npcId === CURPILE_NPC_ID) {
      if (stage < STAGE_REACHED_HOLLOWS) return null;
      if (stage < STAGE_QUESTIONED_BY_CURPILE) return "convincing-curpile-fyod-talking-to-curpile-fyod";
      if (stage < STAGE_ANSWERED_QUESTIONS) return "convincing-curpile-fyod-talking-to-curpile-fyod-again-before-convincing-him";
      return "convincing-curpile-fyod-talking-to-curpile-fyod-again-after-convincing-him";
    }
    const member = MEMBERS.get(npcId);
    if (member) {
      if (stage >= STAGE_KILLED_HELLHOUND && stage < STAGE_COMPLETE) return member.after;
      if (stage === STAGE_ENTERED_HIDEOUT) {
        return `myreque-hideout-speaking-to-myreque-members-before-speaking-to-veliaf-${member.slug}`;
      }
      if (stage >= STAGE_MET_VELIAF && stage < STAGE_HELLHOUND_SUMMONED) {
        return `myreque-hideout-speaking-to-myreque-members-${member.slug}`;
      }
      return null;
    }
    if (VELIAF_NPC_IDS.has(npcId)) {
      if (stage === STAGE_ENTERED_HIDEOUT) {
        quest.setStage(player, STAGE_MET_VELIAF);
        return "myreque-hideout-talking-to-veliaf";
      }
      if (stage >= STAGE_MET_VELIAF && stage < STAGE_HELLHOUND_SUMMONED) {
        return allMembersMet(player)
          ? "myreque-hideout-speaking-to-veliaf-after-introduced-to-other-members"
          : "myreque-hideout-talking-to-veliaf-talking-to-veliaf-before-speaking-to-all-other-myreque-members";
      }
      if (stage >= STAGE_KILLED_HELLHOUND && stage < STAGE_COMPLETE) {
        return "myreque-hideout-after-defeating-the-skeleton-hellhound-veliaf-hurtz";
      }
      return null;
    }
    if (npcId === STRANGER_NPC_ID && stage >= STAGE_ESCAPED_TO_CANIFIS && stage < STAGE_COMPLETE) {
      return "myreque-hideout-finishing-up";
    }
    return null;
  }

  /** Answer the page's prose conditions. */
  function answerCondition({ npcId, player, text, stepId }) {
    const value = String(text).toLowerCase();
    // The four count conditions after the quiz, by their ids in the RSPSApp/osrsreboxed-db#108 record (counter = correct answers this attempt).
    if (QUIZ_COUNT_CONDITION_IDS.has(stepId)) return quizCorrect(player) === QUIZ_COUNT_CONDITION_IDS.get(stepId);
    if (value.includes("does not have a druid pouch")) return !hasDruidPouch(player);
    if (value.includes("has a druid pouch")) return hasDruidPouch(player);
    if (value.includes("does not have the correct weapons")) return !hasAllWeapons(player);
    // The wiki's "If first time speaking:" and "If speaking again:" are alternatives, but the runtime judges the sibling
    // after a chosen branch that ends in "continue" when it reaches it, by which time the first-time branch has set the
    // flag: so a conversation must not observe its own flag. The note holds the flags set by the first-time branch of the
    // conversation in progress: the first-time question clears it, and the one "speaking again" judgement that follows the
    // first-time branch consumes it (false once), so a later conversation, from any page, sees the flag as persisted.
    // Residual: an intro abandoned between the first-time branch and that tail judgement leaves the note until the next
    // first-time or "speaking again" judgement for the flag, a stage change of this quest, or a login.
    // These two conditions are the Myreque members' and Veliaf's: for any other NPC (Solztun's "If speaking again:" among
    // them) this plugin has no flag, and answering with Veliaf's "after the hellhound" flag leaked it into other pages.
    if ((value.includes("if first time speaking") || value.includes("if speaking again")) && !member(npcId) && !VELIAF_NPC_IDS.has(npcId)) return null;
    if (value.includes("if first time speaking")) {
      const flag = conditionFlag(npcId);
      metThisConversation.get(player)?.delete(flag);
      return !metFlag(player, flag);
    }
    if (value.includes("if speaking again")) {
      const flag = conditionFlag(npcId);
      const note = metThisConversation.get(player);
      if (note?.has(flag)) {
        note.delete(flag);
        return false;
      }
      return metFlag(player, flag);
    }
    // Once handed over (stage 67) Veliaf has them: a hand-in whose chat was closed at the item box still reaches the cutscene.
    const handedOver = quest.getStage(player) >= STAGE_WEAPONS_ACCEPTED;
    if (value.includes("does not have the weapons")) return !handedOver && !hasAllWeapons(player);
    if (value.includes("does have the weapons")) return handedOver || hasAllWeapons(player);
    return null;
  }

  const member = (npcId) => MEMBERS.get(npcId);
  function conditionFlag(npcId) {
    const entry = member(npcId);
    return entry ? entry.flag : "veliaf_after";
  }

  /** Wiki: 25 Agility and Nature Spirit. */
  const AGILITY_REQUIREMENT = 25;

  function meetsSkillRequirements(player) {
    return player.getSkillManager().getMaxLevel(Skill.AGILITY) >= AGILITY_REQUIREMENT;
  }

  function notifySkillRequirements(player) {
    if (!meetsSkillRequirements(player)) {
      player.sendMessage(
        `You need an Agility level of at least ${AGILITY_REQUIREMENT} to start this quest.`
      );
    }
  }

  function natureSpiritComplete(player) {
    const request = { player, key: "nature_spirit", complete: undefined };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function handleStartHook(event) {
    const { player, npcId, hook } = event;
    if (hook !== START_HOOK || !VANSTROM_NPC_IDS.has(npcId)) return;
    if (quest.getStage(player) === STAGE_UNSTARTED) {
      if (!meetsSkillRequirements(player)) {
        event.end = true;
        notifySkillRequirements(player);
        return;
      }
      if (!natureSpiritComplete(player)) {
        event.end = true;
        player.sendMessage("You must complete Nature Spirit to start this quest.");
        return;
      }
      quest.setStage(player, STAGE_STARTED);
    }
  }

  /**
   * "You give the weapons to Veliaf." (capture tick 1295): the weapons go, stage 67, and the box shows the longsword and
   * the mace; stage 70 comes with the cutscene three ticks after Veliaf's thanks.
   */
  function handInWeapons(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_MET_VELIAF || stage >= STAGE_WEAPONS_ACCEPTED || !hasAllWeapons(player)) return;
    for (const weapon of WEAPONS) player.getInventory().deleteNumber(weapon.itemId, weapon.amount);
    quest.setStage(player, STAGE_WEAPONS_ACCEPTED);
    event.box = { items: [STEEL_LONGSWORD_ITEM_ID, STEEL_MACE_ITEM_ID] };
  }

  /**
   * Shows the plain Stranger instead of Vanstrom in the pub from the cutscene (stage 70) on, derived from the persisted
   * stage at every stage change (the runtime's quest:stage-changed) and at login, so a jump or a reset leaves the pub
   * consistent.
   */
  function sendStrangerSwap(player) {
    player.getPacketSender().sendVarbit(VANSTROM_HIDE_VARBIT, quest.getStage(player) >= STAGE_DELIVERED_WEAPONS ? 1 : 0);
  }

  function handleStageChanged({ player, key }) {
    if (key !== "in_search_of_the_myreque") return;
    metThisConversation.delete(player);
    sendStrangerSwap(player);
  }

  function handleCondition(event) {
    const { player, stepId } = event;
    if (!player || !stepId) return;
    if (stepId === QUIZ_PASS_CONDITION_ID) {
      const stage = quest.getStage(player);
      if (stage >= STAGE_QUESTIONED_BY_CURPILE && stage < STAGE_ANSWERED_QUESTIONS) {
        quest.setStage(player, STAGE_ANSWERED_QUESTIONS);
      }
      return;
    }
    const flag = FIRST_SPEAKING_STEP_FLAGS.get(stepId);
    if (!flag) return;
    setMetFlag(player, flag);
    // After the stage moves above: a stage change drops the note, and this conversation's tail judgement still needs it.
    if (!metThisConversation.has(player)) metThisConversation.set(player, new Set());
    metThisConversation.get(player).add(flag);
  }

  function handleChoice(event) {
    const { player, npcId, option } = event;
    if (!player) return;
    const text = String(option ?? "");
    // An answer to the question the last draw asked: the first choice after it. QUIZ_ANSWERS is keyed by the question text.
    const asked = askedQuestion.get(player);
    if (asked !== undefined && npcId === CURPILE_NPC_ID) {
      askedQuestion.delete(player);
      if (QUIZ_ANSWERS.get(asked) === text) player.setAttribute(QUIZ_CORRECT_ATTRIBUTE, quizCorrect(player) + 1);
      quizAnswered.set(player, (quizAnswered.get(player) ?? 0) + 1);
      player.getPacketSender().sendVarbit(QUIZ_CORRECT_VARBIT, quizCorrect(player)).sendVarbit(QUIZ_ANSWERED_VARBIT, quizAnswered.get(player));
      return;
    }
    const stage = quest.getStage(player);
    if (npcId === CYREG_NPC_ID && stage === STAGE_STARTED) {
      quest.setStage(player, STAGE_REFUSED_DELIVERY);
      return;
    }
    if (npcId === CURPILE_NPC_ID && text === "I've come to help the Myreque. I've brought weapons.") {
      if (stage >= STAGE_REACHED_HOLLOWS && stage < STAGE_QUESTIONED_BY_CURPILE && hasAllWeapons(player)) {
        quest.setStage(player, STAGE_QUESTIONED_BY_CURPILE);
      }
      return;
    }
    if (text === "How do I get out of here again?" && stage === STAGE_KILLED_HELLHOUND) {
      quest.setStage(player, STAGE_SHOWN_WAY_OUT);
    }
  }

  /**
   * The counted random's draw event (NpcDialogues, PR 5582): draw 1 starts a quiz attempt (the counter resets), and every
   * draw says which question is asked so the next choice can be scored against its answer.
   */
  function handleDraw(event) {
    const { player, npcId } = event;
    if (!player || npcId !== CURPILE_NPC_ID) return;
    if (event.draw === 1) {
      player.setAttribute(QUIZ_CORRECT_ATTRIBUTE, 0);
      quizAnswered.set(player, 0);
      player.getPacketSender().sendVarbit(QUIZ_CORRECT_VARBIT, 0).sendVarbit(QUIZ_ANSWERED_VARBIT, 0);
    }
    const line = String(event.question ?? "");
    const question = line.startsWith(QUIZ_QUESTION_PREFIX) ? line.slice(QUIZ_QUESTION_PREFIX.length) : line;
    if (!QUIZ_ANSWERS.has(question)) console.warn(`[InSearchOfTheMyreque] Curpile drew a question with no known answer, it will score as wrong: ${JSON.stringify(question)}`);
    askedQuestion.set(player, question);
  }

  /**
   * "I don't have to answer to you!": the transcript's action step says "Curpile hits the player for 3 damage.", matched by
   * its text so a re-export that renames the step id does not drop it; the amount is the text's number (3, as the Wiki).
   * Live (capture tick 698) shows "Curpile punches you." with the hit and human_unarmedpunch (422) on the player. Ours:
   * the hit has no death protection.
   */
  const CURPILE_PUNCH_TEXT = /^Curpile hits the player for (\d+) damage\.$/;

  function handleAction(event) {
    const { player, stepId } = event;
    if (!player) return;
    const punch = event.npcId === CURPILE_NPC_ID ? CURPILE_PUNCH_TEXT.exec(String(event.text ?? "")) : null;
    if (punch) {
      player.sendMessage(PUNCH_MESSAGE);
      player.performAnimation(new api.core.Animation(PUNCH_ANIMATION));
      player.getCombat().getHitQueue().addPendingDamage([new api.core.HitDamage(Number(punch[1]), api.core.HitMask.RED)]);
      return;
    }
    if (!stepId) return;
    if (stepId === SHOW_POUCH_MESSAGE_ID) {
      const stage = quest.getStage(player);
      if (stage >= STAGE_REFUSED_DELIVERY && stage < STAGE_PERSUADED_BOATMAN) {
        quest.setStage(player, STAGE_PERSUADED_BOATMAN);
      }
      return;
    }
    if (stepId === PLANKS_MESSAGE_ID) {
      if (!held(player, PLANK_ITEM_ID, 3)) {
        event.handled = true;
        player.sendMessage("You don't have three planks to give him.");
        return;
      }
      player.getInventory().deleteNumber(PLANK_ITEM_ID, 3);
      if (quest.getStage(player) === STAGE_PERSUADED_BOATMAN) quest.setStage(player, STAGE_GAVE_PLANKS);
      // Live shows it as an item box with a plank (capture tick 601).
      event.box = { items: [PLANK_ITEM_ID] };
      return;
    }
    if (stepId === HAND_IN_MESSAGE_ID) {
      handInWeapons(event);
      return;
    }
    if (KNOCKOUT_MESSAGE_IDS.has(stepId)) {
      knockOut(event);
      return;
    }
    // The transcript's "Cutscene ends": the hound fights. Without the scene (a test, or a jump) it waits in the hideout.
    if (stepId === SUMMON_HOUND_ACTION_ID) {
      if (Hideout.inScene(player)) Hideout.finish(player);
      else summonHellhound(player);
    }
  }

  /** The knock-out after a failed quiz, as live plays it (see KNOCKOUT); the box holds its continue meanwhile. */
  function knockOut(event) {
    const { player, npc } = event;
    if (knockedOut.has(player)) return;
    const { Animation, Graphic, Location } = api.core;
    knockedOut.add(player);
    event.box = { statement: true, holdTicks: KNOCKOUT.wakeTicks };
    player.getMovementQueue().reset().setBlockMovement(true);
    npc?.performAnimation?.(new Animation(KNOCKOUT.curpileAnimation));
    player.getPacketSender().sendSound(KNOCKOUT.curpileSound, 1, 0);
    Scenes.later(player, 1, () => {
      player.performAnimation(new Animation(KNOCKOUT.blockAnimation));
      player.performGraphic(Graphic.atHeight(KNOCKOUT.stunSpotanim, KNOCKOUT.stunHeight));
      player.getPacketSender().sendSound(KNOCKOUT.stunSound, 1, 0);
    });
    Scenes.later(player, 2, () => {
      player.performAnimation(new Animation(KNOCKOUT.fallAnimation));
      Scenes.fade(player, true);
    });
    Scenes.later(player, 3, () => Scenes.controls(player, true));
    Scenes.later(player, KNOCKOUT.moveTicks, () => {
      player.moveTo(new Location(MORT_TON_LANDING.x, MORT_TON_LANDING.y, 0));
      player.performAnimation(new Animation(-1));
    });
    Scenes.later(player, KNOCKOUT.wakeTicks, () => {
      knockedOut.delete(player);
      Scenes.controls(player, false);
      Scenes.fade(player, false);
    });
  }

  /** Veliaf's first after-the-hound words end with the way out: stage 90 on the player's thanks (capture tick 1502). */
  const SHOWN_WAY_OUT_LINE = "That's very useful. Thanks.";

  function handleLine(event) {
    if (Hideout.line(event)) return;
    // Line events come as the runner builds a stretch of the conversation, so both of these wait for the player to
    // continue past their line (`after`).
    const { player } = event;
    if (event.text === SHOWN_WAY_OUT_LINE && VELIAF_NPC_IDS.has(event.npcId)) {
      event.after = () => {
        if (quest.getStage(player) !== STAGE_KILLED_HELLHOUND) return;
        // Inside the first-time branch: its "If speaking again" tail is still to be judged, so the note outlives the stage change.
        const note = metThisConversation.get(player);
        quest.setStage(player, STAGE_SHOWN_WAY_OUT);
        if (note) metThisConversation.set(player, note);
      };
      return;
    }
    if (event.npcId !== STRANGER_NPC_ID || event.text !== "I definitely have!") return;
    event.after = () => {
      if (quest.getStage(player) >= STAGE_ESCAPED_TO_CANIFIS && !quest.isComplete(player)) quest.complete(player);
    };
  }

  // ---- Skeleton Hellhound ----

  /**
   * The hound for a player who left the fight (Wiki: "You may leave the chamber during the fight, which will cause the
   * hellhound to respawn close to the entrance once you re-enter"): owner-only, in the hideout itself. Ours: the tile,
   * and that it attacks on sight.
   */
  function ensureHellhound(player) {
    if (quest.getStage(player) !== STAGE_HELLHOUND_SUMMONED || houndByPlayer.has(player) || Hideout.inScene(player)) return;
    const npc = api.spawnNpc({
      id: NpcIdentifiers.SKELETON_HELLHOUND,
      x: HELLHOUND_SPOT.x,
      y: HELLHOUND_SPOT.y,
      z: HELLHOUND_SPOT.z,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (!npc) return;
    houndByPlayer.set(player, npc);
    npc.getCombat?.()?.attack?.(player);
  }

  function removeHellhound(player) {
    const npc = houndByPlayer.get(player);
    if (npc) api.removeNpc(npc);
    houndByPlayer.delete(player);
  }

  /** The cutscene's end without the scene (it was left, or the stage was set): the hound waits in the hideout. */
  function summonHellhound(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_WEAPONS_ACCEPTED) return;
    if (stage < STAGE_HELLHOUND_SUMMONED) quest.setStage(player, STAGE_HELLHOUND_SUMMONED);
    ensureHellhound(player);
  }

  /** The cutscene ended early (a logout or a walk out before the hound appeared): the fight waits for the return. */
  function sceneEnded(player, scene) {
    if (scene?.name !== Hideout.SCENE) return;
    const stage = quest.getStage(player);
    if (stage >= STAGE_DELIVERED_WEAPONS && stage < STAGE_HELLHOUND_SUMMONED) quest.setStage(player, STAGE_HELLHOUND_SUMMONED);
  }

  /** Stage 85 a tick after the kill (capture tick 1459); no message. */
  function handleNpcDeath(event) {
    const player = event.killer ?? event.player;
    if (!player || !HELLHOUND_NPC_IDS.has(event.npcId)) return;
    if (quest.getStage(player) !== STAGE_HELLHOUND_SUMMONED) return;
    removeHellhound(player);
    quest.setStage(player, STAGE_KILLED_HELLHOUND);
    Hideout.killed(player);
  }

  /** Live starts Veliaf's after-the-hound words by itself, as the screen comes back (capture tick 1465). */
  function veliafAfterTheHound(player) {
    if (quest.getStage(player) !== STAGE_KILLED_HELLHOUND || player.getDialogueManager?.()?.isActive?.()) return;
    const npc = nearbyNpc(player, VELIAF_NPC_IDS);
    api.emitCustomEvent("npc-dialogue:start", {
      player, npc, npcId: NpcIdentifiers.VELIAF_HURTZ_2,
      variant: { page: CURPILE_PAGE, variant: "myreque-hideout-after-defeating-the-skeleton-hellhound-veliaf-hurtz" },
      exact: true,
    });
  }

  /** A world NPC of one of `ids` (raw or shown for this player) within 15 tiles. */
  function nearbyNpc(player, ids) {
    const here = player.getLocation();
    for (const npc of api.core.World.getNpcs?.() ?? []) {
      if (!npc || !npc.getLocation) continue;
      const id = npc.getId?.();
      const shown = npc.getCurrentDefinition?.(player)?.getId?.() ?? id;
      if (!ids.has(id) && !ids.has(shown)) continue;
      if (npc.getLocation().getZ() === here.getZ() && npc.getLocation().isWithinDistance?.(here, 15)) return npc;
    }
    return undefined;
  }

  // ---- Object interactions ----

  /** Ours: Cross on the landing walks nowhere; it crosses a repaired bridge from bank to bank. No capture uses it. */
  function crossBridge(event) {
    const { player, location } = event;
    const stage = quest.getStage(player);
    event.handled = true;
    if (stage < STAGE_REACHED_HOLLOWS && !quest.isComplete(player)) {
      player.sendMessage("You have no reason to cross here.");
      return;
    }
    if (!Bridge.repaired(player)) {
      player.sendMessage("This bridge looks pretty old. The wooden boards break apart beneath your feet.");
      return;
    }
    const north = player.getLocation().getY() >= 3430;
    player.moveTo(new api.core.Location(3502, north ? 3425 : 3432, location?.z ?? 0));
    Bridge.leaveBridge(player);
  }

  function useStalagmite(event) {
    const { player, clickType } = event;
    event.handled = true;
    if (clickType === 1) {
      player.sendMessage("It looks like an ordinary stalagmite, however, beyond it you can see that there is a small cave entrance.");
      return;
    }
    player.moveTo(new api.core.Location(3505, 9832, 0));
    if (quest.getStage(player) === STAGE_HELLHOUND_SUMMONED) ensureHellhound(player);
  }

  /**
   * Open on the doors in the earth: stage 60, the doors' own open look, and the cave two ticks on (see SURFACE_DOOR_OPEN).
   * Ours: the refusal before the quiz keeps its old text (no capture tries it).
   */
  function enterSurfaceDoors(event) {
    const { player } = event;
    event.handled = true;
    const stage = quest.getStage(player);
    if (stage < STAGE_ANSWERED_QUESTIONS && !quest.isComplete(player)) {
      player.sendMessage("There seems to be a strange combination on the door. It would take ages to work it out.");
      return;
    }
    if (stage === STAGE_ANSWERED_QUESTIONS) quest.setStage(player, STAGE_ENTERED_HIDEOUT);
    const { Animation, GameObject, Location } = api.core;
    const doors = event.object;
    player.getMovementQueue().reset().setBlockMovement(true);
    player.performAnimation(new Animation(SURFACE_DOOR_ANIMATION));
    Scenes.later(player, 1, () => {
      if (doors?.getLocation) {
        const at = doors.getLocation();
        const sender = player.getPacketSender();
        sender.sendObject(new GameObject(SURFACE_DOOR_OPEN.left, new Location(at.getX() + 1, at.getY(), at.getZ()), doors.getType(), doors.getFace(), null));
        sender.sendObject(new GameObject(SURFACE_DOOR_OPEN.right, at.clone(), doors.getType(), doors.getFace(), null));
      }
      player.getPacketSender().sendSound(SURFACE_DOOR_SOUND, 1, 0);
      Scenes.fade(player, true);
    });
    Scenes.later(player, 3, () => {
      player.getMovementQueue().setBlockMovement(false);
      player.moveTo(new Location(CAVE_LANDING.x, CAVE_LANDING.y, 0));
      Scenes.fade(player, false);
    });
  }

  /**
   * The hideout's tunnel from the main cave (loc-teleports' crawl): Harold's words two ticks after the arrival while it
   * is stage 60 (capture ticks 1103-1105), and the hound back while the fight is unfinished.
   */
  function arrivedThroughTunnel(event) {
    const { player, objectId, location } = event;
    if (objectId !== ObjectIdentifiers.CAVE_ENTRANCE_27 || location?.x !== HIDEOUT_TUNNEL.x || location?.y !== HIDEOUT_TUNNEL.y) return;
    let stage = quest.getStage(player);
    if (stage === STAGE_HELLHOUND_SUMMONED) {
      ensureHellhound(player);
      return;
    }
    // A save made in the cave at 55 before the doors set 60 (they did not, before): this is still the first arrival.
    if (stage === STAGE_ANSWERED_QUESTIONS) {
      quest.setStage(player, STAGE_ENTERED_HIDEOUT);
      stage = STAGE_ENTERED_HIDEOUT;
    }
    if (stage !== STAGE_ENTERED_HIDEOUT) return;
    Scenes.later(player, 2, () => {
      if (quest.getStage(player) !== STAGE_ENTERED_HIDEOUT || player.getDialogueManager?.()?.isActive?.()) return;
      api.emitCustomEvent("npc-dialogue:start", {
        player,
        npc: nearbyNpc(player, HAROLD_NPC_IDS),
        npcId: NpcIdentifiers.HAROLD_EVANS,
        variant: { page: CURPILE_PAGE, variant: "myreque-hideout-when-first-entering-the-hideout" },
        exact: true,
      });
    });
  }

  /**
   * Search on the hidden wall, from either side (see WALL_NORTH_SIDE): the open wall for two ticks and one walk step
   * through. Ours: the pass from the north side mirrors the captured one; the walk ignores clipping for the step.
   */
  function passThroughWall(player) {
    finishWallPass(player);
    const { GameObject, Location } = api.core;
    const here = player.getLocation();
    const goingNorth = here.getY() <= WALL_SOUTH_SIDE.y;
    const from = goingNorth ? WALL_SOUTH_SIDE : WALL_NORTH_SIDE;
    if (here.getX() !== from.x || here.getY() !== from.y) player.moveTo(new Location(from.x, from.y, here.getZ()));
    const sender = player.getPacketSender();
    const wall = new GameObject(FAKE_WALL_ID, new Location(WALL_NORTH_SIDE.x, WALL_NORTH_SIDE.y, 0), 0, 3, null);
    const leaf = new GameObject(OPEN_WALL_ID, new Location(WALL_SOUTH_SIDE.x, WALL_SOUTH_SIDE.y, 0), 0, 0, null);
    sender.sendObject(new GameObject(INVISIBLE_WALL_ID, wall.getLocation().clone(), 0, 3, null));
    sender.sendObject(leaf);
    sender.sendSound(WALL_OPEN_SOUND, 1, 0);
    player.getMovementQueue().reset();
    const pass = { wall, leaf };
    wallPasses.set(player, pass);
    // An autosave in these two ticks can be restored without mistaking an unrelated flag for ours.
    player.setAttribute(WALL_PASS_ATTRIBUTE, player.hasFlag(IGNORE_CLIPPING_FLAG));
    player.setFlag(IGNORE_CLIPPING_FLAG, true);
    player.getMovementQueue().walkStep(0, goingNorth ? 1 : -1);
    // Cleanup must also run for an unregistered player, unlike an ordinary player-keyed scene callback.
    Scenes.later(pass, WALL_OPEN_TICKS, () => {
      if (wallPasses.get(player) === pass) finishWallPass(player);
    });
  }

  function finishWallPass(player) {
    if (!player) return;
    const pass = wallPasses.get(player);
    const priorClipping = player.getAttribute(WALL_PASS_ATTRIBUTE);
    if (!pass && typeof priorClipping !== "boolean") return;
    wallPasses.delete(player);
    if (pass) api.core.TaskManager.cancelTasks(pass);
    player.setAttribute(WALL_PASS_ATTRIBUTE, null);
    if (priorClipping === false) player.removeFlag(IGNORE_CLIPPING_FLAG);
    if (pass && player.isRegistered()) {
      player.getPacketSender().sendObject(pass.wall).sendObjectRemoval(pass.leaf);
    }
  }

  function handleWallPassDeath({ player }) {
    finishWallPass(player);
  }

  /** Climb-up on the basement ladder (see LADDER_TOP). Ours: no message, as live sends none. */
  function climbTavernLadder(event) {
    const { player } = event;
    event.handled = true;
    player.getMovementQueue().reset().setBlockMovement(true);
    player.performAnimation(new api.core.Animation(LADDER_ANIMATION));
    Scenes.later(player, 1, () => {
      player.getMovementQueue().setBlockMovement(false);
      if (quest.getStage(player) === STAGE_IN_INN_BASEMENT) quest.setStage(player, STAGE_ESCAPED_TO_CANIFIS);
      player.moveTo(new api.core.Location(LADDER_TOP.x, LADDER_TOP.y, 0));
    });
  }

  const wearsCharos = (player) => RING_OF_CHAROS_A_ITEM_IDS.includes(player.getEquipment().get(api.core.Equipment.RING_SLOT)?.getId?.());

  /** The fare, or the ring that waives it (Wiki: a Ring of Charos(a) avoids paying). Ours: the refusal's text. */
  function payFare(player) {
    if (wearsCharos(player)) return true;
    if (!held(player, COINS_ITEM_ID, BOAT_FARE)) {
      player.sendMessage("You need 10 coins to rent the boat.");
      return false;
    }
    player.getInventory().deleteNumber(COINS_ITEM_ID, BOAT_FARE);
    return true;
  }

  /** The ride to the Hollows (see BOAT_JOURNEY_INTERFACE); the fare is already paid. */
  function rideToHollows(player) {
    const { Location, StatementDialogue } = api.core;
    const sender = player.getPacketSender();
    Scenes.controls(player, true);
    Scenes.fade(player, true);
    Scenes.later(player, 1, () => {
      Scenes.hideTabs(player);
      sender.sendJingle(BOAT_JINGLE, 0);
      sender.sendInterface(BOAT_JOURNEY_INTERFACE);
      StatementDialogue.send(player, "You board the boat and journey to the Hollows.", false);
    });
    Scenes.later(player, BOAT_RIDE_TICKS, () => {
      player.moveTo(new Location(HOLLOWS_LANDING.x, HOLLOWS_LANDING.y, 0));
      if (quest.getStage(player) === STAGE_GAVE_PLANKS) quest.setStage(player, STAGE_REACHED_HOLLOWS);
      api.emitCustomEvent("transport:swamp-boaty", { player, from: "mortton", to: "hollows" });
    });
    Scenes.later(player, BOAT_RIDE_TICKS + 1, () => {
      sender.sendInterfaceRemoval();
      Scenes.restoreTabs(player);
      Scenes.controls(player, false);
      Scenes.fade(player, false);
      player.getDialogueManager().startDialogues(new api.core.DialogueChainBuilder().add(
        new StatementDialogue(0, "You arrive at the Hollows.")));
    });
  }

  function mayUseBoat(player) {
    if (quest.getStage(player) >= STAGE_GAVE_PLANKS || quest.isComplete(player)) return true;
    player.sendMessage("You don't have the boatman's permission to use his boat.");
    return false;
  }

  /** Cyreg's Travel (op 3): the fare on the click and the ride (capture tick 621). */
  function travelWithCyreg(event) {
    const { player } = event;
    if (!mayUseBoat(player) || !payFare(player)) return true;
    rideToHollows(player);
    return true;
  }

  /**
   * Board on the Mort'ton boat: Cyreg asks for the fare first (capture ticks 895-898: "I'll have to charge you ten gold
   * to cover the loan of the boat. Is that okay?", then "Yes, I'll pay the ten gold." / "No, I won't use the boat."), the
   * fare goes with the answer and the ride starts. Ours: Quick-board, and a worn Ring of Charos(a), skip the question.
   */
  function boardMortonBoat(event) {
    const { player } = event;
    event.handled = true;
    if (!mayUseBoat(player)) return;
    if (event.clickType === 2 || wearsCharos(player)) {
      if (payFare(player)) rideToHollows(player);
      return;
    }
    const { DialogueChainBuilder, NpcDialogue, OptionDialogue, PlayerDialogue, ActionDialogue } = api.core;
    const chain = new DialogueChainBuilder();
    chain.add(new NpcDialogue(0, CYREG_NPC_ID, "I'll have to charge you ten gold to cover the loan of the boat. Is that okay?"));
    // The menu's options are numbered from 1.
    chain.add(new OptionDialogue(1, { executeOption: (option) => {
      if (option !== 1) {
        player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new PlayerDialogue(0, "No, I won't use the boat.")));
        return;
      }
      player.getDialogueManager().startDialogues(new DialogueChainBuilder()
        .add(new PlayerDialogue(0, "Yes, I'll pay the ten gold."))
        .add(new ActionDialogue(1, { execute: () => {
          player.getPacketSender().sendInterfaceRemoval();
          if (payFare(player)) rideToHollows(player);
        } })));
    } }, "Yes, I'll pay the ten gold.", "No, I won't use the boat."));
    player.getDialogueManager().startDialogues(chain);
  }

  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    if (!player) return;
    const stage = quest.getStage(player);
    if (SURFACE_DOOR_IDS.has(objectId)) {
      enterSurfaceDoors(event);
      return;
    }
    if (objectId === BRIDGE_TREE_PARENT_ID || BRIDGE_TREE_IDS.has(objectId)) {
      Bridge.climbTree(event);
      return;
    }
    if (objectId === ROPE_BRIDGE_ID) {
      crossBridge(event);
      return;
    }
    if (BROKEN_BRIDGE_IDS.has(objectId)) {
      Bridge.repairRung(event);
      return;
    }
    if (objectId === Hideout.ESCAPE_LOC_ID) {
      Hideout.escape(event);
      return;
    }
    if (objectId === STALAGMITE_ID) {
      useStalagmite(event);
      return;
    }
    if (objectId === FAKE_WALL_ID) {
      event.handled = true;
      if (stage < STAGE_SHOWN_WAY_OUT) {
        player.sendMessage("You see nothing interesting with this wall.");
        return;
      }
      if (stage === STAGE_SHOWN_WAY_OUT) quest.setStage(player, STAGE_IN_INN_BASEMENT);
      passThroughWall(player);
      return;
    }
    if (objectId === TAVERN_LADDER_ID) {
      climbTavernLadder(event);
      return;
    }
    if (objectId === TAVERN_TRAPDOOR_ID) {
      event.handled = true;
      if (!quest.isComplete(player)) {
        player.sendMessage("This trap door seems locked, you're not really sure where it would lead to.");
        return;
      }
      player.moveTo(new api.core.Location(3477, 9845, 0));
      player.sendMessage("You open the trapdoor and find yourself in the inn basement.");
      return;
    }
    if (HIDEOUT_EXIT_DOOR_IDS.has(objectId)) {
      event.handled = true;
      if (stage < STAGE_ANSWERED_QUESTIONS) {
        player.sendMessage("There seems to be a strange combination on the door. It would take ages to work it out.");
        return;
      }
      player.moveTo(new api.core.Location(3509, 3449, 0));
      player.sendMessage("You push open the doors and climb back out.");
      return;
    }
    if (objectId === MORT_TON_BOAT_ID) {
      boardMortonBoat(event);
      return;
    }
    if (objectId === HOLLOWS_BOAT_ID) {
      event.handled = true;
      player.moveTo(new api.core.Location(MORT_TON_LANDING.x, MORT_TON_LANDING.y, 0));
      player.sendMessage("You board the boat and journey back to Mort'ton.");
      api.emitCustomEvent("transport:swamp-boaty", { player, from: "hollows", to: "mortton" });
      return;
    }
    if (objectId === HOLLOWS_SIGN_ID) {
      event.handled = true;
      player.sendMessage("The sign reads: 'The Hollows'.");
    }
  }

  function handleLogin({ player }) {
    finishWallPass(player);
    metThisConversation.delete(player);
    sendStrangerSwap(player);
    sendSpokenMembers(player);
    refreshQuestList(player);
    Bridge.login(player);
    ensureHellhound(player);
  }

  function handleLogout({ player }) {
    if (player) {
      finishWallPass(player);
      removeHellhound(player);
    }
  }

  /** Completing the quest repairs the whole bridge for good (capture tick 1617). */
  function handleQuestCompleted(event) {
    if (event?.key !== "in_search_of_the_myreque" || !event.player) return;
    // Live clears routequestmulti (varp 388) and sets the bridge again (tick 1617); varbit 396 is kept (see VANSTROM_HIDE_VARBIT).
    event.player.getPacketSender().sendVarbit(QUIZ_CORRECT_VARBIT, 0).sendVarbit(QUIZ_ANSWERED_VARBIT, 0)
      .sendVarbit(SPOKEN_ALL_MYREQUE_VARBIT, 0);
    Bridge.send(event.player);
  }

  api.persistAttribute(BRIDGE_ATTRIBUTE);
  api.persistAttribute(QUIZ_CORRECT_ATTRIBUTE);
  api.persistAttribute(WALL_PASS_ATTRIBUTE, null);
  for (const flag of ["met_sani", "met_harold", "met_radigad", "met_polmafi", "met_ivan", "veliaf_after"]) {
    api.persistAttribute(`quest.in_search_of_the_myreque.${flag}`);
  }

  quest = registerQuest(api, {
    combatNpcIds: () => [NpcIdentifiers.SKELETON_HELLHOUND],
    key: "in_search_of_the_myreque",
    name: "In Search of the Myreque",
    varpId: VARP_IN_SEARCH_OF_THE_MYREQUE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.ATTACK.getIndex(), amount: 600, label: "Attack" },
      { skillId: Skill.DEFENCE.getIndex(), amount: 600, label: "Defence" },
      { skillId: Skill.STRENGTH.getIndex(), amount: 600, label: "Strength" },
      { skillId: Skill.HITPOINTS.getIndex(), amount: 600, label: "Hitpoints" },
      { skillId: Skill.CRAFTING.getIndex(), amount: 600, label: "Crafting" },
    ],
    otherRewards: ["Access to the Hollows", "A boat shortcut between Mort'ton and the Hollows"],
    // The reward scroll's model (capture tick 1617: questscroll:quest_model shows steel_sword 1281).
    scrollItemId: STEEL_SWORD_ITEM_ID,
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcInteraction("Curpile Fyod", { "Talk-to": talkToCurpile });
  api.onNpcInteraction("Cyreg Paddlehorn", { Travel: travelWithCyreg });
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:condition", handleCondition);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:draw", handleDraw);
  api.onCustomEvent("quest:stage-changed", handleStageChanged);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("loc-teleports:arrived", arrivedThroughTunnel);
  api.onCustomEvent("quest:completed", handleQuestCompleted);
  api.onNpcDeath(handleNpcDeath);
  api.onObjectInteraction(handleObjectInteraction);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
  api.onPlayerDeath(handleWallPassDeath);
};
