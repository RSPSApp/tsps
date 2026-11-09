/**
 * Crab Quest (members).
 *
 * The words come from the "Crab Quest" transcript page (OSRS Wiki); the places, ids, order
 * and timing from a full live run (RSProx capture 20261103T014803-ee79c12, revision 241).
 *
 * Stages (varbit 15842 "crab_main", varp 5739 bits 0-6), as live sends them and as
 * Quest Helper's loadSteps keys on them:
 *   0 not started, 5 drank from the bottle, 10/15/20 the crab's explanation,
 *   25 gathering shells, 30 seven shells handed in, 35/37 gathering the floatsam,
 *   40 instrument made, 45 instrument handed in, 47 instrument tuned and recruiting,
 *   50 the band is complete, 55 dance lesson, 60 ceremony, 63 complete.
 *
 * The bottle (loc 62438) is the only quest loc in the real map. Drinking from it puts the
 * player into a private copy of Dognose Island (Dream.CrabQuest.js), where live adds the
 * crab, the floatsam, the shells, the drums and the recruit scenery for the owner only.
 * Drinking again inside wakes the player on the real beach with progress kept; the dream's
 * "headache" (no boats, no teleports) is the instance. The ceremony is its own instance
 * (Ceremony.CrabQuest.js) and the player wakes on the beach when it ends.
 *
 * Gaps: logout or death inside the dream wakes the player on the beach (TSPS policy: the
 * capture shows neither). A recruit is not shown at its hiding place while it talks (the
 * capture spawns it there; only six of the eleven tiles are captured), only on the practice
 * tiles; the band's practice rhythm animations are not played. No post-quest beach-crab
 * variant exists, so a completed player replays "crab-hunting-talking-to-the-crab-again".
 * The Crab dance emote is not unlocked (the dance conditions answer "not unlocked"). The
 * requirement refusal is a plain system message because the transcript has none.
 */
module.exports = function registerCrabQuestQuest(api) {
  const {
    Animation,
    Graphic,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    Skill,
  } = api.core;
  const { loadTranscripts, registerQuest, refreshQuestList, startTranscript } =
    require("../QuestRuntime");
  const { startDialogue } = require("../../npcs/NpcDialogues.plugin.js");
  const { createQuestScenes } = require("../QuestScenes");
  const Scenes = createQuestScenes(api);
  const Dream = require("../crab/Dream.CrabQuest")(api, { onLeave: dreamClosed });
  const Ceremony = require("../crab/Ceremony.CrabQuest")(api);
  // The ceremony variant hands over to the captured cutscene at this message, and the quest's
  // closing lines (complete, waking up) follow the last message box of the cutscene.
  const CEREMONY_START_STEP = "dTDVEF";
  const CEREMONY_LAST_MESBOX_STEP = "wyTQfj";
  const CEREMONY_VARIANT = "crab-rave-the-ceremony";

  // The bottle's sips (transcript message ids): the first, back to reality, back to the dream,
  // and each one's "...and immediately black out." that the instance change hangs on.
  const FIRST_BLACKOUT_STEP = "Cc5OQV";
  const REALITY_BLACKOUT_STEP = "51SJsJ";
  const DREAM_BLACKOUT_STEP = "H_lEXB";
  const BLACKOUT_TEXT = "...and immediately black out.";
  const BOTTLE_VARIANTS = new Map([
    [FIRST_BLACKOUT_STEP, "drinking-from-bottle"],
    [REALITY_BLACKOUT_STEP, "drinking-from-bottle-drinking-from-the-bottle-again-to-go-back-to-reality"],
    [DREAM_BLACKOUT_STEP, "drinking-from-bottle-drinking-from-the-bottle-again-to-go-back-to-the-dream"],
  ]);
  // Capture ticks after the sip: black-out message and fade 2, instance 4, fade-in with the
  // dizzy spotanim 9, getting up 13, the first line 14.
  const BLACKOUT_DELAY = 2;
  const INSTANCE_DELAY = 2;
  const FADE_IN_DELAY = 5;
  const GET_UP_DELAY = 4;
  const RESUME_DELAY = 1;
  const DIZZY_GRAPHIC = 245; // stunned_thieving, height 124
  const DIZZY_HEIGHT = 124;
  const GET_UP_ANIMATION = 7330; // human_death_reverse
  const DREAM_ENTRY_TILE = { x: 3056, y: 2639 };
  const CRAB_NET_VARBIT = 15888; // "crab_net", set with crab_put_back_in_instance
  const DREAM_BOAT_REFUSAL =
    "The headache from drinking from the bottle on the beach makes it difficult to find your boat. You feel that swigging from that bottle again would fix it.";
  const DREAM_TELEPORT_REFUSAL =
    "The headache from drinking from the bottle stops you from remembering how to teleport. Drinking from the bottle again may help with this.";

  const STAGE_VERSION_ATTRIBUTE = "crab-quest:stage-version";
  const STAGE_VERSION = 2;
  const PAGE = "Crab Quest";
  const START_HOOK = "quest:crab-quest:start";

  // The values live sends and Quest Helper's loadSteps use (CrabQuest capture):
  // intro 5/10/15/20, shells 25, instrument 30/35/37/40, recruiting 45/47,
  // ceremony 50/55/60, complete 63. The old 0-8 ladder never matched the varbit.
  const STAGE_VARBIT = 15842; // "crab_main"
  const CRAB_SEASHELL_VARBIT = 15844; // "crab_seashell_1"..'_7'
  const CRAB_FLOATSAM_HIDDEN_VARBIT = 15852; // 0..3, 3 = no floatsam left
  const CRAB_BANDMATE_VARBIT = 15853; // "crab_bandmate_1"..'_11'
  const CRAB_SHY_VARBIT = 15865; // 1 = met/blushing, 2 = scuttered away
  const CRAB_KICKED_PENGUIN_VARBIT = 15867;
  const CRAB_INSTANCE_VARBIT = 15868;
  const CRAB_RECRUITED_BANDMATE_VARBIT = 15869; // "crab_recruited_bandmate_1"..'_11'
  const CRAB_PARTIAL_COMPLETE_VARBIT = 15881;
  const STAGE_NOT_STARTED = 0;
  const STAGE_START = 5;
  const STAGE_LEARN = 10;
  const STAGE_STORY = 15;
  const STAGE_PLEA = 20;
  const STAGE_SHELLS = 25;
  const STAGE_INSTRUMENT = 30;
  const STAGE_MATERIALS = 35;
  const STAGE_MATERIALS_READY = 37;
  const STAGE_INSTRUMENT_MADE = 40;
  const STAGE_RECRUITING = 45;
  const STAGE_TUNING = 47;
  const STAGE_ALL_LEADERS = 50;
  const STAGE_DANCE_READY = 55;
  const STAGE_CEREMONY = 60;
  const STAGE_COMPLETE = 63;

  const SAILING_REQUIREMENT = 40;
  const FISHING_REQUIREMENT = 30;
  const WOODCUTTING_LEADER_REQUIREMENT = 75;
  const ALL_LEADER_COUNT = 11;
  const SIX_LEADER_COUNT = 6;
  const REQUIREMENTS_MESSAGE =
    "You need a Sailing level of 40, a Fishing level of 30 and Pandemonium completed to start this quest.";

  // Spawn the cache's raw parents; their stage varbit transform selects the
  // visible/content child. 16469 covers stages 5-40 (16471/16472), 16470 covers
  // 45-60 (16473/16474); 16471/16474 remain the dialogue-head ids.
  const MAIN_CRAB_RAW_NPC_ID = 16469; // crab_maincrab
  const MAIN_CRAB_PRACTISING_RAW_NPC_ID = 16470; // crab_maincrab_practising
  const MAIN_CRAB_NPC_ID = NpcIdentifiers.CRAB_9; // 16471, "Crab", Talk-to
  const MAIN_CRAB_END_NPC_ID = 16474; // captured crab_maincrab_end, Talk-to in the dance/ceremony scene
  const SHY_CRAB_NPC_ID = 16484; // crab_shycrab parent, multinpc Crab
  const BAND_CRAB_NPC_ID = 16483; // resolved crab_bandcrab transform (QH/capture chathead)
  const SHY_CRAB_CONTENT_ID = BAND_CRAB_NPC_ID;
  const PENGUIN_CRAB_NPC_ID = NpcIdentifiers.CRAB_18; // 16485, "'Crab'"
  // Raw packet ids and every cache-resolved content id for the main crab.
  const MAIN_CRAB_NPC_IDS = new Set([
    MAIN_CRAB_RAW_NPC_ID,
    MAIN_CRAB_PRACTISING_RAW_NPC_ID,
    16472, // blushing (stage 20)
    16473, // practising (stage 45)
    MAIN_CRAB_NPC_ID,
    MAIN_CRAB_END_NPC_ID,
  ]);
  const CRAB_NPC_IDS = new Set([...MAIN_CRAB_NPC_IDS, PENGUIN_CRAB_NPC_ID, BAND_CRAB_NPC_ID]);
  // Interface 216 slot 54 (cache enum 1001 -> sprite 5248) is the real Sit emote;
  // the capture's op=1 plays emote_sit_loop 10061.
  const SIT_EMOTE_SLOT = 54;
  // The dream's one floatsam: its multi parent and the forms crab_floatsam_hidden picks.
  const FLOATSAM_NPC_IDS = new Set([
    16478, // crab_floatsam_multi
    NpcIdentifiers.FLOATSAM, // 16475, "Net"
    NpcIdentifiers.FLOATSAM_2, // 16476
    NpcIdentifiers.FLOATSAM_3, // 16477
  ]);

  // Items from the 2026 quest, absent from the generated ItemIdentifiers.
  const SHELL_ITEM_IDS = [34575, 34576, 34577, 34578, 34579, 34580, 34581];
  const BAD_SHELL_ITEM_IDS = [34582, 34583];
  const ALL_SHELL_ITEM_IDS = [...SHELL_ITEM_IDS, ...BAD_SHELL_ITEM_IDS];
  const SHELL_COUNT = SHELL_ITEM_IDS.length;
  const PLANK_ITEM_ID = 34584; // Weathered rosewood plank
  const BARREL_ITEM_ID = 34585; // Battered barrel
  const BOWSTRING_ITEM_ID = 34586; // Sea-soaked bowstring
  const INSTRUMENT_ITEM_ID = 34587; // Instrument
  const SHELL_COLLECTION_ITEM_ID = 34589; // Shell collection
  const BIG_FISHING_NET_ITEM_ID = ItemIdentifiers.BIG_FISHING_NET; // 305
  const LYRE_ITEM_ID = ItemIdentifiers.LYRE; // 3689
  const ENCHANTED_LYRE_ITEM_IDS = new Set([
    ItemIdentifiers.ENCHANTED_LYRE, // 3690
    ItemIdentifiers.ENCHANTED_LYRE_1_, // 3691
    ItemIdentifiers.ENCHANTED_LYRE_2_, // 6125
    ItemIdentifiers.ENCHANTED_LYRE_3_, // 6126
    ItemIdentifiers.ENCHANTED_LYRE_4_, // 6127
  ]);

  // Objects from the 2026 quest, absent from the generated ObjectIdentifiers (capture gamevals).
  const CRAB_BOTTLE_RAW_OBJECT_ID = 62438; // crab_bottle_multi; cache shows 62439/62440
  const CRAB_BOTTLE_OBJECT_ID = 62439; // "Bottle", Drink
  const CRAB_BOTTLE_POST_OBJECT_ID = 62440; // "Bottle", Reminisce
  const CRAB_PALM_OBJECT_ID = 62470; // crab_palm_update01, Investigate
  const CRAB_PALM_2_OBJECT_ID = 62471; // crab_palm_update02
  const CRAB_PALM_3_OBJECT_ID = 62472; // crab_palm_update03 (the shy crab's palm is one)
  const CRAB_MAGIC_TREE_OBJECT_ID = 62473; // crab_magictree, Investigate
  const CRAB_MAGIC_TREE_NOOP_OBJECT_ID = 62474; // crab_magictree_noop, before recruiting
  const CRAB_TREE_OBJECT_ID = 62475; // crab_avium_tree_1
  const CRAB_TREE_2_OBJECT_ID = 62476; // crab_avium_tree_2
  const CRAB_PLANT_OBJECT_ID = 62477; // crab_groundcover_plant4_withered
  const CRAB_BUSH_OBJECT_ID = 62478; // crab_enakh_leaflessbush

  const BOTTLE_TILE = { x: 3055, y: 2639 };
  // crab_maincrab 16469 until the instrument is handed in, then crab_maincrab_practising 16470.
  const MAIN_CRAB_TILE = { x: 3054, y: 2637, face: [3053, 2636] };
  const MAIN_CRAB_PRACTISING_TILE = { x: 3056, y: 2637, face: [3057, 2638] };
  const SHY_CRAB_PALM_TILE = { x: 3044, y: 2653 };
  const SHY_CRAB_TILE = { x: 3045, y: 2653 };
  const SHY_CRAB_RELOCATED_TILE = { x: 3055, y: 2650 };
  const NET_TILE = { x: 3061, y: 2646 };
  const FLOATSAM_RAW_NPC_ID = 16478; // crab_floatsam_multi; crab_floatsam_hidden picks its form
  const FLOATSAM_TILE = { x: 3051, y: 2632 };
  // Each shell item's tile, in ALL_SHELL_ITEM_IDS order (capture obj_add_specific).
  const SHELL_TILES = [
    { x: 3059, y: 2648 }, // crab_shell_1
    { x: 3044, y: 2652 }, // crab_shell_2
    { x: 3051, y: 2634 }, // crab_shell_3
    { x: 3036, y: 2643 }, // crab_shell_4
    { x: 3050, y: 2655 }, // crab_shell_5
    { x: 3063, y: 2642 }, // crab_shell_6
    { x: 3040, y: 2636 }, // crab_shell_7
    { x: 3048, y: 2645 }, // crab_shell_bad1
    { x: 3055, y: 2654 }, // crab_shell_bad2
  ];
  // The dream's own locs from the moment it is built: three invisible markers, the seven
  // shell, bass and drum multilocs the crab's varbits dress, and the magic tree without ops.
  const DREAM_LOCS = [
    { id: 13723, x: 3059, y: 2639, shape: 22 }, { id: 13723, x: 3061, y: 2644, shape: 22 },
    { id: 13723, x: 3055, y: 2635, shape: 22 },
    { id: 62442, x: 3057, y: 2637 }, { id: 62444, x: 3057, y: 2638 }, { id: 62446, x: 3056, y: 2638 },
    { id: 62454, x: 3056, y: 2636 }, { id: 62448, x: 3055, y: 2638 }, { id: 62450, x: 3055, y: 2637 },
    { id: 62452, x: 3055, y: 2636 },
    { id: 62459, x: 3056, y: 2637, rotation: 3 }, // crab_bass_multi_quest
    { id: 62468, x: 3056, y: 2639, rotation: 3 }, { id: 62469, x: 3057, y: 2639, rotation: 3 },
    { id: 62466, x: 3054, y: 2637, rotation: 2 }, { id: 62467, x: 3054, y: 2638, rotation: 2 },
  ];
  const MAGIC_TREE_NOOP_LOC = { id: CRAB_MAGIC_TREE_NOOP_OBJECT_ID, x: 3043, y: 2640, rotation: 1 };
  const SHY_CRAB_PALM_LOC = { id: CRAB_PALM_3_OBJECT_ID, ...SHY_CRAB_PALM_TILE, rotation: 3 };
  // Practice tiles: six captured recruits (bandmates 3, 4, 5, 7, 10, 11), and the five other
  // tiles the complete band takes at stage 50, in bandmate order for the rest.
  const BANDMATE_PRACTICE_TILES = [
    [3057, 2637], [3057, 2638], [3056, 2638], [3055, 2638], [3055, 2637], [3056, 2636],
    [3055, 2636], [3054, 2637], [3054, 2638], [3056, 2639], [3057, 2639],
  ];

  // Message step ids that mean "this crab joined the practice" and its bit.
  const JOINED_STEP_BITS = new Map([
    ["5WiO-g", 1 << 0], // magic tree
    ["OrHsAs", 1 << 1], // palm south of the magic tree
    ["uxsvrh", 1 << 2], // quiz tree, "101"
    ["NQTJwM", 1 << 2], // quiz tree, "210"
    ["pyykYg", 1 << 2], // quiz tree, "I don't know"
    ["XBEBvy", 1 << 3], // western-most palm
    ["XffNTB", 1 << 4], // palm directly east
    ["MVf-5E", 1 << 5], // palm directly north-east
    ["yUuVKM", 1 << 6], // northern-most palm ("'Crab'" penguin)
    ["nJXHcW", 1 << 7], // north-western-most tree
    ["ByoUzK", 1 << 8], // plant
    ["UtfH3c", 1 << 9], // western bush
    ["beb_BL", 1 << 10], // eastern bush ("Dipper")
  ]);

  // Quest Helper's bandmate numbering (bandmate_1..11) in this file's join-bit
  // order: crabOne palm, crabTwo east bush, crabThree NW palm, crabFour plant,
  // crabFive western palm, crabSix magic tree, crabSeven penguin palm,
  // crabEight west bush, crabNine avium tree, crabTen north avium, crabEleven
  // east palm.
  const BANDMATE_JOIN_BITS = [
    1 << 1, 1 << 10, 1 << 5, 1 << 8, 1 << 3, 1 << 0,
    1 << 6, 1 << 9, 1 << 2, 1 << 7, 1 << 4,
  ];
  const PENGUIN_JOIN_BIT = 1 << 6; // northern-most palm ("'Crab'" penguin)

  const MAGIC_TREE_STEP = "5WiO-g";
  const DIPPER_STEP = "beb_BL";
  const KID_CRAB_STEP = "ByoUzK";
  const CRAB_VOICE_TRAILS_STEP = "Rp9LU6";
  const INSTRUMENT_GIVEN_STEP = "YAKnYw";
  const INSTRUMENT_ONE_NOTE_STEP = "IJKINA";
  const INSTRUMENT_TUNED_STEP = "zUZGcG";
  const DANCE_BEGINS_STEP = "uZozUI";
  const DANCE_ENDS_STEP = "UOa-Sd";
  const CEREMONY_DANCE_STEP = "twF4TG";
  const CEREMONY_COMPLETE_STEP = "Wk9imR";
  const SHELL_COLLECTION_MESSAGE_STEP = "Uf9RIo";
  const SIX_LEADERS_VARIANT = "crab-hunting-after-finding-all-six-leaders-to-join-practise";
  const WAIT_FOR_LEADERS_OPTION = "Wait for leaders to turn up.";

  const DISASTER_NAME = "A disaster.";
  const BASS_NAME = "A bass.";
  const BANJO_NAME = "I don't actually know.";
  const PLAY_STYLE_OPTIONS = new Set(["Let me show you!", "I can try and explain.", BANJO_NAME]);

  const SHY_CRAB_ATTRIBUTE = "crab-quest:shy-met"; // legacy boolean, migrated to progress
  const SHY_CRAB_PROGRESS_ATTRIBUTE = "crab-quest:shy-progress";
  const SHY_CRAB_HIDDEN = 0;
  const SHY_CRAB_FOUND = 1;
  const SHY_CRAB_BLUSHING = 2;
  const SHY_CRAB_SCUTTERED = 3;
  const SHY_CRAB_BLUSH_STEP = "shy-crab-blush";
  const SHY_CRAB_SCUTTER_STEP = "shy-crab-scutter";
  // Captured CrabQuest.txt conversation; blush and scutter are the only native
  // 15865 transitions (0->1 mid-conversation, 1->2 after the last line).
  const SHY_CRAB_LINES = [
    { player: "Hey there! I'm looking for ceremonial leaders to help my friend on the beach." },
    { npc: "Oh. Sorry. You've come to the wrong crab!" },
    { player: "How comes?" },
    { npc: "First, I'm a girl and girls are never ceremonial leaders. Besides, I get very nervous standing in front of others... I'm afraid to mess up." },
    { player: "What if you do? Messing up is a part of life. You fall and pick yourself back up again." },
    { npc: "I know that, and yet I can't help it. I have this uneasy feeling that I don't belong... But I just really want to be accepted." },
    { player: "I hear you." },
    { npc: "If only I could be more like..." },
    { type: "message", id: SHY_CRAB_BLUSH_STEP, text: "" },
    { npc: "You see, there's this one crab... He's kind and funny... and handsome! When he's around I feel like everything is going to be okay. But unfortunately, I can't even look at him!" },
    { player: "Why not?" },
    { npc: "For a start. I... get all red. In fact I get all red just thinking about him!" },
    { npc: "It's really confusing how he makes me feel at ease yet so nervous at the same time. If I was a ceremonial leader and I spotted him... I would mess up for sure." },
    { npc: "No, the only way I can ever look at him is to steal some side glances..." },
    { player: "Wait. Since you walk sideways, which way IS a side glance?" },
    { npc: "The way I'm walking! Which means if I try to walk towards him, I can't even look where I'm going!" },
    { npc: "So I look at him from afar when he doesn't know I'm around. Yet among a thousand crabs on the beach, he's the only one I see." },
    { player: "Awww. I don't know which crab is the one that caught your eye, but you obviously like him. Hey, maybe he's a ceremonial leader this year?" },
    { npc: "I already can't handle how awesome he is. If he was a ceremonial leader as well, how could I possibly approach him? I already can't!" },
    { player: "I clearly can't convince you to join, but the leaders will be practising on the beach if you wanted to check in advance whether the crab of your dreams will be playing." },
    { player: "And if he is, that might be your chance! Who knows! Maybe 'that crab you can't look at' only wants one thing: for you to look at him!" },
    { npc: "Very unlikely! But maybe I will take a peek. The good thing about being pessimistic is that you're happy when you're wrong!" },
    { type: "message", id: SHY_CRAB_SCUTTER_STEP, text: "" },
  ];

  const DONE_JOINED_VARIANT = "crab-hunting-investigating-a-tree-plant-or-bush-after-the-crab-goes-to-practice";
  const WHILE_OUT_VARIANT = "crab-hunting-investigating-a-tree-plant-or-bush-while-the-crab-is-out";
  const NO_CRAB_TEXT = "No crab is coming out of the tree. Maybe they are too scared?";
  const NEED_NET_TEXT = "You need a big net to gather items from this floatsam.";
  const NO_SPACE_TEXT = "You can't carry any more floatsam.";
  const NOTHING_LEFT_TEXT = "There is nothing left here.";
  const CRAFT_MESSAGE_TEXT = "You fashion a makeshift string instrument out of the floatsam.";
  const SHELL_COLLECTION_RECOVERY_TEXT =
    "As you look at the bottle, you notice familiar shells nearby. You collect them.";
  const NEED_MATERIALS_TEXT =
    "To make a string instrument, you'll also need a sound box to amplify the sound and a frame or fretboard to tense the string.";

  const RECRUITED_ATTRIBUTE = "quest.crab_quest.recruited";
  const SCARED_ATTRIBUTE = "quest.crab_quest.scared";
  const MET_ATTRIBUTE = "quest.crab_quest.met";
  const SHELLS_HANDED_ATTRIBUTE = "quest.crab_quest.shells-handed";
  const SHELLS_HANDED_MASK_ATTRIBUTE = "crab-quest:shells-handed-mask";
  const SHELLS_PICKED_ATTRIBUTE = "quest.crab_quest.shells-picked";
  const NET_PICKED_ATTRIBUTE = "quest.crab_quest.net-picked";
  const MATERIALS_FISHED_ATTRIBUTE = "quest.crab_quest.materials-fished"; // legacy: all three caught
  const FLOATSAM_CAUGHT_ATTRIBUTE = "crab-quest:floatsam-caught"; // 0..3, crab_floatsam_hidden
  // "Wait for leaders to turn up.": the rest of the band joins (live sets every bandmate bit).
  const BAND_COMPLETE_ATTRIBUTE = "crab-quest:band-complete";
  // Set while the player is in the dream or the ceremony, so a session that ends without a
  // normal logout (a crash, a restart) still logs back in on the real beach.
  const IN_INSTANCE_ATTRIBUTE = "crab-quest:in-instance";
  const INSTRUMENT_MADE_ATTRIBUTE = "quest.crab_quest.instrument-made";
  const INSTRUMENT_NAME_ATTRIBUTE = "quest.crab_quest.instrument-name";
  const MAGIC_TREE_MET_ATTRIBUTE = "quest.crab_quest.magic-tree-met";
  const DIPPER_MET_ATTRIBUTE = "quest.crab_quest.dipper-met";
  const KID_CRAB_MET_ATTRIBUTE = "quest.crab_quest.kid-crab-met";

  // Correct shell item -> the transcript message the crab hands it over with.
  const SHELL_MESSAGE_VARIANTS = new Map([
    [34575, "handing-in-seashells-large-rose-shell"],
    [34576, "handing-in-seashells-black-and-white-shell"],
    [34577, "handing-in-seashells-vivid-orange-shell"],
    [34578, "handing-in-seashells-bright-yellow-shell"],
    [34579, "handing-in-seashells-exotic-looking-shell"],
    [34580, "handing-in-seashells-unassuming-cream-shell"],
    [34581, "handing-in-seashells-tiny-white-shell"],
  ]);
  const SHELL_REACTION_VARIANTS = [
    "handing-in-seashells-first-correct-shell",
    "handing-in-seashells-second-correct-shell",
    "handing-in-seashells-third-correct-shell",
    "handing-in-seashells-fourth-correct-shell",
    "handing-in-seashells-fifth-correct-shell",
    "handing-in-seashells-sixth-correct-shell",
  ];
  const LAST_SHELL_VARIANT = "handing-in-seashells-last-correct-shell";

  const MATERIAL_ITEM_IDS = new Set([PLANK_ITEM_ID, BARREL_ITEM_ID, BOWSTRING_ITEM_ID]);

  /**
   * The investigation spots, with the loc live adds there once recruiting starts (capture
   * tick 6215: id, tile and rotation). `first` is the "too scared" line (missing when the crab
   * comes straight out), `variant` is the conversation, and `joinBit` marks a spot whose end
   * message recruits a band member. The order is the saved SCARED/MET bit order: keep it.
   */
  const SPOTS = [
    {
      objectId: CRAB_MAGIC_TREE_OBJECT_ID, x: 3043, y: 2640, rotation: 1,
      sitTile: { x: 3042, y: 2640 }, // QH sitForCrabSix
      first: "crab-hunting-investigating-the-magic-tree",
      variant: "crab-hunting-investigating-the-magic-tree-sitting-by-the-magic-tree",
      joinBit: 1 << 0,
    },
    {
      objectId: CRAB_PALM_OBJECT_ID, x: 3042, y: 2637, rotation: 0,
      sitTile: { x: 3041, y: 2638 }, // QH sitForCrabOne
      first: "crab-hunting-investigating-the-palm-south-of-the-magic-tree",
      variant: "crab-hunting-investigating-the-palm-south-of-the-magic-tree-sitting-by-the-palm",
      joinBit: 1 << 1,
    },
    {
      objectId: CRAB_PALM_OBJECT_ID, x: 3038, y: 2637, rotation: 1,
      variant: "crab-hunting-investigating-the-palm-south-west-of-the-magic-tree",
    },
    {
      objectId: CRAB_TREE_OBJECT_ID, x: 3036, y: 2644, rotation: 2,
      sitTile: { x: 3037, y: 2643 }, // capture: player sits south of the 2x2 avium tree
      first: "crab-hunting-investigating-the-tree-north-west-of-the-magic-tree",
      variant: "crab-hunting-investigating-the-tree-north-west-of-the-magic-tree-sitting-by-the-palm",
      joinBit: 1 << 2,
    },
    {
      objectId: CRAB_PALM_2_OBJECT_ID, x: 3037, y: 2647, rotation: 2,
      variant: "crab-hunting-investigating-the-western-most-palm",
      joinBit: 1 << 3,
    },
    {
      objectId: CRAB_PALM_3_OBJECT_ID, x: 3039, y: 2647, rotation: 0,
      variant: "crab-hunting-investigating-the-palm-directly-east-of-the-western-most-palm",
      joinBit: 1 << 4,
    },
    {
      objectId: CRAB_PALM_OBJECT_ID, x: 3040, y: 2649, rotation: 3,
      variant: "crab-hunting-investigating-the-palm-directly-north-east-of-the-western-most-palm",
      joinBit: 1 << 5,
    },
    {
      objectId: CRAB_PALM_OBJECT_ID, x: 3048, y: 2658, rotation: 3,
      variant: "crab-hunting-investigating-the-northern-most-palm",
      joinBit: 1 << 6,
      chathead: PENGUIN_CRAB_NPC_ID,
    },
    {
      // The shy crab's palm: placed and handled by investigateShyCrabPalm, kept here only
      // so the saved bit order stays the same.
      objectId: CRAB_PALM_3_OBJECT_ID, x: 3044, y: 2653, rotation: 3, place: false,
      variant: "crab-hunting-investigating-the-palm-directly-north-of-the-magic-tree",
    },
    {
      objectId: CRAB_TREE_OBJECT_ID, x: 3046, y: 2656, rotation: 2,
      sitTile: { x: 3046, y: 2655 }, // QH sitForCrabTen
      first: "crab-hunting-investigating-the-north-western-most-tree",
      variant: "crab-hunting-investigating-the-north-western-most-tree-sitting-by-the-tree",
      joinBit: 1 << 7,
    },
    {
      objectId: CRAB_TREE_2_OBJECT_ID, x: 3050, y: 2657, rotation: 0,
      first: "crab-hunting-investigating-the-north-eastern-most-tree",
      variant: "crab-hunting-investigating-the-north-eastern-most-tree-sitting-by-the-tree",
    },
    {
      objectId: CRAB_PLANT_OBJECT_ID, x: 3054, y: 2656, rotation: 3,
      variant: "crab-hunting-investigating-the-plant",
      joinBit: 1 << 8,
    },
    {
      objectId: CRAB_BUSH_OBJECT_ID, x: 3049, y: 2635, rotation: 3,
      variant: "crab-hunting-investigating-the-western-bush",
      joinBit: 1 << 9,
    },
    {
      objectId: CRAB_BUSH_OBJECT_ID, x: 3057, y: 2640, rotation: 0,
      variant: "crab-hunting-investigating-the-eastern-bush",
      joinBit: 1 << 10,
    },
  ];

  // The floatsam's catches in order (capture: one cast, a catch every 3/6/6 ticks).
  const FLOATSAM_ITEMS = [
    { itemId: BOWSTRING_ITEM_ID, text: "You catch a sea-soaked bowstring." },
    { itemId: BARREL_ITEM_ID, text: "You catch a small battered barrel." },
    { itemId: PLANK_ITEM_ID, text: "You catch a weathered rosewood plank." },
  ];
  const FLOATSAM_CAST_TEXT = "You cast out your net...";
  const FLOATSAM_CAST_DELAY = 2;
  const FLOATSAM_CATCH_DELAYS = [3, 6, 6];
  const NET_ANIMATION = 620; // human_largenet

  // The dance lesson and ceremony (capture): the skybox, the two sand circles and their finals.
  const SKYBOX_MODEL = 61359;
  const CIRCLE_CRAB_LOC = 62479;
  const CIRCLE_HUMAN_LOC = 62480;
  const CIRCLE_CRAB_FINAL_LOC = 62481;
  const CIRCLE_HUMAN_FINAL_LOC = 62482;
  const CRAB_CIRCLE_TILE = [3062, 2641];
  const HUMAN_CIRCLE_TILE = [3062, 2642];
  const MINIMAP_STATE_VARBIT = 6719;
  const MINIMAP_OFF = 2;
  // Sand circle frames 14511-14518 (crab_sand_circle_1..8), the crab's dance/hide/reveal and
  // the player's headbang, kick, spin and cry, on the lines live sends them with.
  const DANCE_LINE_EFFECTS = new Map([
    ["The point of the dance is to make a sturdy sand nest.", [{ camera: [3067, 2637, 470, 1, 0] }]],
    ["That's definitely a skill I need to level up.", [{ crabCircle: 14511, crab: 14501 }]],
    ["You can sway and wave your claws in time with the music if you want to...", [{ crabCircle: 14512, crab: 14501 }]],
    ["But to be honest, the only thing that really matters...", [{ crabCircle: 14513, player: 10050, crab: 14501 }]],
    ["Is what your back legs are doing.", [{ crabCircle: 14514 }]],
    ["I don't have back legs! Unless I put one at the front and one at the back, like this?", [{ crabCircle: 14515, crab: 14501 }]],
    ["Use those legs to move the sand and gently and push it away.", [{ crabCircle: 14516, crab: 14501 }]],
    ["I will just use one.", [{ crabCircle: 14517, crab: 14501 }]],
    ["As you slowly turn around on the spot...", [{ crabCircle: 14518, humanLoc: CIRCLE_HUMAN_LOC, crab: 14501 }]],
    ["You can change direction once you've done a full rotation.", [{ humanCircle: 14512, penguin: true, crab: 14501 }]],
    ["Oh no you don't!", [{ crab: 14501 }]],
    ["What?", [{ player: 423, penguin: false, crab: 14501 }]],
    ["Nothing!", [{ humanCircle: 14513, player: 10050, crab: 14501 }]],
    ["Am I doing this right?", [{ humanCircle: 14514, crab: 14501 }]],
    ["Not really.", [{ humanCircle: 14515 }]],
    ["We are just drawing a circle.", [{ humanCircle: 14516 }]],
    ["That's how it starts.", [{ humanCircle: 14517 }]],
    ["But if you do it long enough, you have a nest.", [{ humanCircle: 14518, humanLoc: CIRCLE_HUMAN_FINAL_LOC, crabLoc: CIRCLE_CRAB_FINAL_LOC }]],
    ["Noooooooooooooo! Lil' guy!", [{ player: 2107, crab: 1314, camera: [3066, 2637, 470, 1, 1] }]],
    ["What have I done!", [{ player: 860, crab: 14500 }]],
    ["I should have listened to you!", [{ player: 860 }]],
    ["Disputable.", [{ crab: 1316 }]],
  ]);

  let quest;
  /** Players netting the floatsam now; the token stops a stale cast. */
  const netting = new Map();

  // ==========================================================================
  // State helpers
  // ==========================================================================

  function flags(player, attribute) {
    return Number(player.getAttribute(attribute)) || 0;
  }

  function hasFlag(player, attribute, bit) {
    return (flags(player, attribute) & bit) !== 0;
  }

  function setFlag(player, attribute, bit) {
    player.setAttribute(attribute, flags(player, attribute) | bit);
  }

  function popcount(mask) {
    let count = 0;
    let value = mask;
    while (value) {
      count += value & 1;
      value >>>= 1;
    }
    return count;
  }

  function hasItem(player, itemId) {
    return player.getInventory().getAmount(itemId) > 0;
  }

  function grantShellCollection(player) {
    player.getInventory().adds(SHELL_COLLECTION_ITEM_ID, 1);
  }

  function hasAnyShell(player) {
    for (const itemId of ALL_SHELL_ITEM_IDS) if (hasItem(player, itemId)) return true;
    return false;
  }

  function shellCount(player) {
    let count = 0;
    for (const itemId of ALL_SHELL_ITEM_IDS) count += player.getInventory().getAmount(itemId);
    return count;
  }

  function handedShellCount(player) {
    return Number(player.getAttribute(SHELLS_HANDED_ATTRIBUTE)) || 0;
  }

  function handedShellMask(player) {
    return Number(player.getAttribute(SHELLS_HANDED_MASK_ATTRIBUTE)) || 0;
  }

  function shyCrabProgress(player) {
    return Number(player.getAttribute(SHY_CRAB_PROGRESS_ATTRIBUTE)) || 0;
  }

  function hasAllMaterials(player) {
    return (
      hasItem(player, PLANK_ITEM_ID) &&
      hasItem(player, BARREL_ITEM_ID) &&
      hasItem(player, BOWSTRING_ITEM_ID)
    );
  }

  /** How many of the floatsam's three items have been netted (an old save's flag is all three). */
  function floatsamCaught(player) {
    if (player.getAttribute(MATERIALS_FISHED_ATTRIBUTE) === true) return FLOATSAM_ITEMS.length;
    return Math.min(FLOATSAM_ITEMS.length, Number(player.getAttribute(FLOATSAM_CAUGHT_ATTRIBUTE)) || 0);
  }

  function materialsFished(player) {
    return floatsamCaught(player) >= FLOATSAM_ITEMS.length;
  }

  function bandIsComplete(player) {
    return player.getAttribute(BAND_COMPLETE_ATTRIBUTE) === true || quest.getStage(player) >= STAGE_ALL_LEADERS;
  }

  function instrumentMade(player) {
    return player.getAttribute(INSTRUMENT_MADE_ATTRIBUTE) === true;
  }

  function instrumentName(player) {
    return player.getAttribute(INSTRUMENT_NAME_ATTRIBUTE) ?? null;
  }

  function leaderCount(player) {
    return popcount(flags(player, RECRUITED_ATTRIBUTE));
  }

  /**
   * Publishes the quest's saved sub-state to the client varp bits Quest Helper
   * reads. sendVarbit writes only these bits, so the stage and sibling bits in
   * varps 5739/5740 are preserved.
   */
  function syncVarbits(player) {
    const sender = player.getPacketSender();
    const stage = quest.getStage(player);
    const handedMask = handedShellMask(player);
    for (let index = 0; index < SHELL_COUNT; index++) {
      sender.sendVarbit(CRAB_SEASHELL_VARBIT + index, handedMask & (1 << index) ? 1 : 0);
    }
    sender.sendVarbit(CRAB_FLOATSAM_HIDDEN_VARBIT, floatsamCaught(player));
    // crab_bandmate_N: at practice (all of them once the band is complete); crab_recruited_
    // bandmate_N: the player talked them into it (capture tick 6544).
    const bandComplete = bandIsComplete(player);
    BANDMATE_JOIN_BITS.forEach((bit, index) => {
      const recruited = hasFlag(player, RECRUITED_ATTRIBUTE, bit) ? 1 : 0;
      sender.sendVarbit(CRAB_BANDMATE_VARBIT + index, recruited || bandComplete ? 1 : 0);
      sender.sendVarbit(CRAB_RECRUITED_BANDMATE_VARBIT + index, recruited);
    });
    const shyProgress = shyCrabProgress(player);
    sender.sendVarbit(
      CRAB_SHY_VARBIT,
      shyProgress >= SHY_CRAB_SCUTTERED ? 2 : shyProgress >= SHY_CRAB_BLUSHING ? 1 : 0
    );
    sender.sendVarbit(
      CRAB_KICKED_PENGUIN_VARBIT,
      hasFlag(player, RECRUITED_ATTRIBUTE, PENGUIN_JOIN_BIT) ? 1 : 0
    );
    // crab_put_back_in_instance and crab_net: the player is in the dream (capture 5953, 7046).
    const dreaming = Dream.active(player) || Ceremony.active(player) ? 1 : 0;
    sender.sendVarbit(CRAB_INSTANCE_VARBIT, dreaming);
    sender.sendVarbit(CRAB_NET_VARBIT, dreaming);
    // crab_partial_complete: set as the sixth recruit leaves for practice (capture tick 6520).
    sender.sendVarbit(CRAB_PARTIAL_COMPLETE_VARBIT, leaderCount(player) >= SIX_LEADER_COUNT ? 1 : 0);
  }

  function pandemoniumComplete(player) {
    const request = { player, key: "pandemonium", complete: undefined };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function meetsRequirements(player) {
    const skills = player.getSkillManager();
    return (
      skills.getMaxLevel(Skill.SAILING) >= SAILING_REQUIREMENT &&
      skills.getMaxLevel(Skill.FISHING) >= FISHING_REQUIREMENT &&
      pandemoniumComplete(player)
    );
  }

  function setStage(player, stage) {
    if (quest.getStage(player) >= stage) return;
    quest.setStage(player, stage);
    syncVarbits(player);
    syncDream(player);
  }

  function recountLeaders(player) {
    if (quest.isComplete(player)) return;
    if (leaderCount(player) >= ALL_LEADER_COUNT) setStage(player, STAGE_ALL_LEADERS);
  }

  // ==========================================================================
  // Transcript helpers
  // ==========================================================================

  function transcriptRecord() {
    return loadTranscripts(api)?.[PAGE] ?? null;
  }

  function variantSteps(name) {
    const raw = transcriptRecord()?.variants?.[name];
    return Array.isArray(raw) ? raw : [];
  }

  function conditionSteps(variantName, conditionId) {
    const raw = variantSteps(variantName);
    const found = raw.find((step) => step.type === "condition" && step.id === conditionId);
    return Array.isArray(found?.steps) ? found.steps : [];
  }

  /** Wiki multi-speaker lines -> generic NPC lines so one chathead renders them. */
  function flattenSpeakers(steps) {
    if (!Array.isArray(steps)) return [];
    return steps.map((step) => {
      const copy = { ...step };
      if (copy.type === "line" && typeof copy.speaker === "string") {
        copy.npc = copy.text;
        delete copy.speaker;
      }
      if (Array.isArray(copy.steps)) copy.steps = flattenSpeakers(copy.steps);
      if (Array.isArray(copy.options)) {
        copy.options = copy.options.map((option) => ({
          ...option,
          steps: flattenSpeakers(option.steps),
        }));
      }
      return copy;
    });
  }

  /** A message box (mesbox), as live sends "There is nothing left here.". */
  function mesbox(player, text) {
    const { DialogueChainBuilder, StatementDialogue } = api.core;
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, text)));
  }

  /** Plays a composed list of raw transcript steps with one NPC's chathead. */
  function playSteps(player, npcId, steps) {
    if (!Array.isArray(steps) || steps.length === 0) return false;
    const { NpcDefinition } = api.core;
    const definition = NpcDefinition.forId(npcId);
    const event = { player, npcId, npc: null, definition };
    const context = { player, npc: null, npcId, definition, pages: [{ page: PAGE, variants: [] }] };
    startDialogue(api, event, flattenSpeakers(steps), transcriptRecord()?.branches, context);
    return true;
  }

  // ==========================================================================
  // The dream
  // ==========================================================================

  /** What the dream shows for the quest's state; re-run after every change, idempotent. */
  function syncDream(player) {
    if (!Dream.active(player) || player.isPlayerBot?.() === true) return;
    const stage = quest.getStage(player);
    const complete = quest.isComplete(player);
    for (const loc of DREAM_LOCS) Dream.loc(player, loc);
    if (stage >= STAGE_TUNING || complete) {
      for (const spot of SPOTS) if (spot.place !== false) Dream.loc(player, { id: spot.objectId, x: spot.x, y: spot.y, rotation: spot.rotation });
      Dream.loc(player, SHY_CRAB_PALM_LOC);
    } else {
      Dream.loc(player, MAGIC_TREE_NOOP_LOC);
    }
    const crab = stage >= STAGE_RECRUITING
      ? { id: MAIN_CRAB_PRACTISING_RAW_NPC_ID, ...MAIN_CRAB_PRACTISING_TILE }
      : { id: MAIN_CRAB_RAW_NPC_ID, ...MAIN_CRAB_TILE };
    if (!danceActive(player)) Dream.npc(player, "main-crab", crab);
    if (floatsamCaught(player) < FLOATSAM_ITEMS.length && !complete) {
      Dream.npc(player, "floatsam", { id: FLOATSAM_RAW_NPC_ID, ...FLOATSAM_TILE, wanderRadius: 2 });
    } else {
      Dream.removeNpc(player, "floatsam");
    }
    const bandComplete = bandIsComplete(player);
    BANDMATE_JOIN_BITS.forEach((bit, index) => {
      const key = `bandmate-${index + 1}`;
      if (bandComplete || hasFlag(player, RECRUITED_ATTRIBUTE, bit)) {
        const [x, y] = BANDMATE_PRACTICE_TILES[index];
        Dream.npc(player, key, { id: BAND_CRAB_NPC_ID, x, y, face: [x, y - 1] });
      } else {
        Dream.removeNpc(player, key);
      }
    });
    const shy = shyCrabProgress(player);
    if (stage >= STAGE_TUNING && shy >= SHY_CRAB_FOUND && !complete) {
      const tile = shy >= SHY_CRAB_SCUTTERED ? SHY_CRAB_RELOCATED_TILE : SHY_CRAB_TILE;
      Dream.npc(player, "shy-crab", { id: SHY_CRAB_NPC_ID, ...tile, face: [tile.x, tile.y - 1] });
    } else {
      Dream.removeNpc(player, "shy-crab");
    }
    syncGroundItems(player);
  }

  /** Shells until the seven are in, and the big net until the instrument is handed in. */
  function syncGroundItems(player) {
    const stage = quest.getStage(player);
    const handedMask = handedShellMask(player);
    ALL_SHELL_ITEM_IDS.forEach((itemId, index) => {
      // A colour handed in is gone for good; one held is not doubled. A picked and lost
      // shell comes back on its tile the next time the dream is built.
      const show = stage < STAGE_INSTRUMENT && !(handedMask & (1 << index)) && !hasItem(player, itemId)
        && !hasFlag(player, SHELLS_PICKED_ATTRIBUTE, 1 << index);
      if (show) Dream.groundItem(player, itemId, SHELL_TILES[index]);
    });
    if (stage < STAGE_RECRUITING && !hasItem(player, BIG_FISHING_NET_ITEM_ID) && !hasFlag(player, NET_PICKED_ATTRIBUTE, 1)) {
      Dream.groundItem(player, BIG_FISHING_NET_ITEM_ID, NET_TILE);
    }
  }

  function enterDream(player) {
    player.setAttribute(IN_INSTANCE_ATTRIBUTE, true);
    Dream.enter(player, DREAM_ENTRY_TILE);
    syncVarbits(player);
    syncDream(player);
  }

  function leaveDream(player) {
    Dream.leave(player);
  }

  /** The dream closed (woken, logged out or moved elsewhere): its varbits follow. */
  function dreamClosed(player, logout) {
    danceScenes.delete(player);
    if (!Ceremony.active(player)) player.setAttribute(IN_INSTANCE_ATTRIBUTE, false);
    if (logout) {
      // Saved on the real beach, never on an instance tile.
      const tile = new Location(DREAM_ENTRY_TILE.x, DREAM_ENTRY_TILE.y, 0);
      player.setLocation?.(tile);
      return;
    }
    if (player.isRegistered?.() === false) return;
    syncVarbits(player);
  }

  /** Steps after `stepId` in the list that holds it (the rest of a bottle sip). */
  function stepsAfter(steps, stepId) {
    if (!Array.isArray(steps)) return null;
    const index = steps.findIndex((step) => step?.id === stepId);
    if (index >= 0) return steps.slice(index + 1);
    for (const step of steps) {
      const nested = stepsAfter(step?.steps, stepId)
        ?? (Array.isArray(step?.options) ? step.options.map((option) => stepsAfter(option.steps, stepId)).find(Boolean) : null);
      if (nested) return nested;
    }
    return null;
  }

  /**
   * A sip's black-out: the transcript stops at "...and immediately black out." and the
   * capture's timing takes over (fade, instance change, fade-in, getting up) before the rest
   * of the variant plays.
   */
  function blackOut(player, stepId) {
    const rest = stepsAfter(variantSteps(BOTTLE_VARIANTS.get(stepId)), stepId) ?? [];
    const intoDream = stepId !== REALITY_BLACKOUT_STEP;
    const sender = player.getPacketSender();
    player.getMovementQueue().reset().setBlockMovement(true);
    Scenes.later(player, BLACKOUT_DELAY, () => {
      player.sendMessage(BLACKOUT_TEXT);
      Scenes.fade(player, true);
      Scenes.later(player, 1, () => sender.sendVarbit(MINIMAP_STATE_VARBIT, MINIMAP_OFF));
      Scenes.later(player, INSTANCE_DELAY, () => {
        if (intoDream) enterDream(player);
        else leaveDream(player);
        Scenes.later(player, FADE_IN_DELAY, () => {
          Scenes.fade(player, false);
          sender.sendVarbit(MINIMAP_STATE_VARBIT, 0);
          if (intoDream) player.performGraphic(new Graphic(DIZZY_GRAPHIC, DIZZY_HEIGHT));
          Scenes.later(player, intoDream ? GET_UP_DELAY : 0, () => {
            if (intoDream) player.performAnimation(new Animation(GET_UP_ANIMATION));
            Scenes.later(player, RESUME_DELAY, () => {
              player.getMovementQueue().setBlockMovement(false);
              if (rest.length) playSteps(player, MAIN_CRAB_NPC_ID, rest);
            });
          });
        });
      });
    });
  }

  // ==========================================================================
  // The dance lesson (in the dream; capture ticks 6557-6674)
  // ==========================================================================

  const danceScenes = new Map();
  const DANCE_VARIANT = "crab-rave";
  const DANCE_LESSON_DELAY = 7;
  const CEREMONY_ASK_DELAY = 6;

  function danceActive(player) {
    return danceScenes.has(player);
  }

  function danceLoc(player, id, [x, y]) {
    Dream.loc(player, { id, x, y });
  }

  function danceLocAnim(player, [x, y], animation) {
    const object = Dream.locAt(player, x, y);
    if (object) player.getPacketSender().sendObjectAnimation(object, new Animation(animation));
  }

  function dreamCamera(player, move, look) {
    const sender = player.getPacketSender();
    if (move) {
      const at = Dream.tile(player, move[0], move[1]);
      sender.sendCameraMoveTo(at.getX(), at.getY(), move[2], { rate: move[3], rate2: move[4], heightRelative: false });
    }
    if (look) {
      const at = Dream.tile(player, look[0], look[1]);
      sender.sendCameraLookAt(at.getX(), at.getY(), look[2], { rate: look[3], rate2: look[4], heightRelative: false });
    }
  }

  function danceCrab(player) {
    return Dream.npcFor(player, "dance-crab");
  }

  function startDanceScene(player) {
    if (!Dream.active(player) || danceActive(player)) return;
    danceScenes.set(player, {});
    const sender = player.getPacketSender();
    Scenes.fade(player, true);
    Scenes.later(player, 1, () => sender.sendVarbit(MINIMAP_STATE_VARBIT, MINIMAP_OFF));
    Scenes.later(player, 2, () => {
      Scenes.controls(player, true, true);
      sender.sendCameraUnlock(true);
      sender.sendCameraSkybox(SKYBOX_MODEL);
    });
    Scenes.later(player, 4, () => {
      Dream.removeNpc(player, "main-crab");
      Dream.npc(player, "dance-crab", { id: MAIN_CRAB_END_NPC_ID, x: 3062, y: 2641, face: [3061, 2641] });
      danceLoc(player, CIRCLE_HUMAN_LOC, HUMAN_CIRCLE_TILE);
      danceLoc(player, CIRCLE_CRAB_LOC, CRAB_CIRCLE_TILE);
      player.moveTo(Dream.tile(player, HUMAN_CIRCLE_TILE[0], HUMAN_CIRCLE_TILE[1]));
      dreamCamera(player, [3071, 2637, 470, 232, 100], [3062, 2641, 50, 232, 100]);
    });
    Scenes.later(player, 5, () => {
      Scenes.fade(player, false);
      sender.sendVarbit(MINIMAP_STATE_VARBIT, MINIMAP_OFF);
    });
    // The lesson's first line follows on its own (capture tick 6564, seven after the fade).
    Scenes.later(player, DANCE_LESSON_DELAY, () => {
      if (danceActive(player)) startTranscript(api, player, MAIN_CRAB_END_NPC_ID, PAGE, DANCE_VARIANT);
    });
  }

  /** The dance's per-line effects, keyed by the line's text (capture, same tick as the line). */
  function danceLine(player, text, request) {
    if (!danceActive(player)) return;
    const effects = DANCE_LINE_EFFECTS.get(text);
    if (!effects) return;
    const previous = request.before;
    request.before = () => {
      previous?.();
      for (const effect of effects) danceEffect(player, effect);
    };
  }

  function danceEffect(player, effect) {
    const crab = danceCrab(player);
    if (effect.crabCircle !== undefined) danceLocAnim(player, CRAB_CIRCLE_TILE, effect.crabCircle);
    if (effect.humanCircle !== undefined) danceLocAnim(player, HUMAN_CIRCLE_TILE, effect.humanCircle);
    if (effect.humanLoc) danceLoc(player, effect.humanLoc, HUMAN_CIRCLE_TILE);
    if (effect.crabLoc) danceLoc(player, effect.crabLoc, CRAB_CIRCLE_TILE);
    if (effect.player !== undefined) player.performAnimation(new Animation(effect.player));
    if (effect.crab !== undefined) crab?.performAnimation?.(new Animation(effect.crab));
    if (effect.camera) dreamCamera(player, effect.camera, null);
    if (effect.penguin === true) Dream.npc(player, "dance-penguin", { id: PENGUIN_CRAB_NPC_ID, x: 3063, y: 2642, face: [3062, 2642] });
    if (effect.penguin === false) Scenes.later(player, 1, () => Dream.removeNpc(player, "dance-penguin"));
  }

  /** The ceremony cutscene, then the closing lines on the real beach. */
  function startCeremony(player) {
    if (Ceremony.active(player) || !Dream.active(player)) return;
    Ceremony.play(player, {
      enter: (who) => Dream.leave(who),
      exitTile: DREAM_ENTRY_TILE,
      done: (who, logout) => {
        who.setAttribute(IN_INSTANCE_ATTRIBUTE, false);
        syncVarbits(who);
        if (logout) return;
        const rest = stepsAfter(variantSteps(CEREMONY_VARIANT), CEREMONY_LAST_MESBOX_STEP) ?? [];
        if (rest.length) playSteps(who, MAIN_CRAB_END_NPC_ID, rest);
      },
    });
  }

  function endDanceScene(player) {
    if (!danceActive(player)) return;
    const sender = player.getPacketSender();
    Scenes.fade(player, true);
    Scenes.later(player, 1, () => sender.sendVarbit(MINIMAP_STATE_VARBIT, MINIMAP_OFF));
    Scenes.later(player, 2, () => {
      danceScenes.delete(player);
      Scenes.controls(player, false);
      Dream.removeNpc(player, "dance-crab");
      Dream.removeNpc(player, "dance-penguin");
      player.moveTo(Dream.tile(player, 3055, 2637));
      sender.sendCameraUnlock(false);
      sender.sendCameraReset();
      sender.sendCameraSkybox(-1);
      syncDream(player);
    });
    Scenes.later(player, 4, () => Scenes.fade(player, false));
    // Then the crab asks for help with the ceremony (capture tick 6676).
    Scenes.later(player, CEREMONY_ASK_DELAY, () => {
      if (Dream.active(player) && quest.getStage(player) === STAGE_CEREMONY) {
        startTranscript(api, player, MAIN_CRAB_END_NPC_ID, PAGE, CEREMONY_VARIANT);
      }
    });
  }

  // ==========================================================================
  // Start, bottle and reminiscing
  // ==========================================================================

  function handleStartHook(event) {
    if (event.hook !== START_HOOK) return;
    const { player } = event;
    if (quest.isComplete(player) || quest.getStage(player) !== STAGE_NOT_STARTED) return;
    if (!meetsRequirements(player)) return;
    setStage(player, STAGE_START);
  }

  function drinkFromBottle(player) {
    if (quest.isComplete(player)) {
      // The collection has no Drop option, so reclaiming it must not depend on
      // dropping it: a missing collection is handed back on the bottle itself.
      if (!hasItem(player, SHELL_COLLECTION_ITEM_ID)) {
        grantShellCollection(player);
        if (hasItem(player, SHELL_COLLECTION_ITEM_ID)) {
          player.sendMessage(SHELL_COLLECTION_RECOVERY_TEXT);
        }
        return;
      }
      startTranscript(api, player, MAIN_CRAB_NPC_ID, PAGE, "crab-rave-reminiscing-at-the-bottle");
      return;
    }
    if (quest.getStage(player) === STAGE_NOT_STARTED) {
      if (!meetsRequirements(player)) {
        player.sendMessage(REQUIREMENTS_MESSAGE);
        return;
      }
      startTranscript(api, player, MAIN_CRAB_NPC_ID, PAGE, "drinking-from-bottle");
      return;
    }
    // Inside the dream the bottle wakes the player; on the real beach it sends them back.
    const variant = BOTTLE_VARIANTS.get(Dream.active(player) ? REALITY_BLACKOUT_STEP : DREAM_BLACKOUT_STEP);
    startTranscript(api, player, MAIN_CRAB_NPC_ID, PAGE, variant);
  }

  // ==========================================================================
  // Main crab
  // ==========================================================================

  function shellHandInSteps(player) {
    const shells = ALL_SHELL_ITEM_IDS.filter((itemId) => hasItem(player, itemId));
    if (shells.length === 0) return null;
    const steps = [];
    steps.push(...conditionSteps("handing-in-seashells", shells.length === 1 ? "mp1abt" : "6eoFGP"));
    let correct = Math.max(handedShellCount(player), popcount(handedShellMask(player)));
    for (const itemId of shells) {
      if (SHELL_ITEM_IDS.includes(itemId)) {
        const shellIndex = SHELL_ITEM_IDS.indexOf(itemId);
        const bit = 1 << shellIndex;
        // A duplicate of an already-handed colour must not increment the count
        // towards seven again.
        if (handedShellMask(player) & bit) {
          player.getInventory().deleteNumber(itemId, 1);
          continue;
        }
        player.setAttribute(SHELLS_HANDED_MASK_ATTRIBUTE, handedShellMask(player) | bit);
        steps.push(...variantSteps(SHELL_MESSAGE_VARIANTS.get(itemId)));
        correct += 1;
        if (correct >= SHELL_COUNT) steps.push(...variantSteps(LAST_SHELL_VARIANT));
        else steps.push(...variantSteps(SHELL_REACTION_VARIANTS[correct - 1]));
      } else {
        steps.push(...variantSteps("handing-in-seashells-bad-shell"));
      }
      player.getInventory().deleteNumber(itemId, 1);
    }
    player.setAttribute(SHELLS_HANDED_ATTRIBUTE, correct);
    return steps;
  }

  function playShellHandIn(player) {
    const steps = shellHandInSteps(player);
    if (!steps) return false;
    if (handedShellCount(player) >= SHELL_COUNT) setStage(player, STAGE_INSTRUMENT);
    syncVarbits(player);
    return playSteps(player, MAIN_CRAB_NPC_ID, steps);
  }

  function talkToMainCrab(player) {
    if (quest.isComplete(player)) {
      startTranscript(api, player, MAIN_CRAB_NPC_ID, PAGE, "crab-hunting-talking-to-the-crab-again");
      return;
    }
    const stage = quest.getStage(player);
    if (stage < STAGE_RECRUITING && hasAnyShell(player) && handedShellCount(player) < SHELL_COUNT) {
      playShellHandIn(player);
      return;
    }
    if (stage <= STAGE_SHELLS) {
      startTranscript(api, player, MAIN_CRAB_NPC_ID, PAGE, "handing-in-seashells");
      return;
    }
    if (stage >= STAGE_INSTRUMENT && stage < STAGE_RECRUITING) {
      // The transcript's own conditions cover a missing instrument and allow remaking it.
      startTranscript(
        api,
        player,
        MAIN_CRAB_NPC_ID,
        PAGE,
        "making-the-string-instrument-handing-in-the-instrument"
      );
      return;
    }
    if (stage >= STAGE_RECRUITING && stage < STAGE_ALL_LEADERS) {
      if (leaderCount(player) >= SIX_LEADER_COUNT) {
        startTranscript(
          api,
          player,
          MAIN_CRAB_NPC_ID,
          PAGE,
          "crab-hunting-after-finding-all-six-leaders-to-join-practise-talking-to-the-main-crab"
        );
      } else {
        startTranscript(api, player, MAIN_CRAB_NPC_ID, PAGE, "crab-hunting-talking-to-the-crab-again");
      }
      return;
    }
    if (stage === STAGE_ALL_LEADERS) {
      startTranscript(
        api,
        player,
        MAIN_CRAB_NPC_ID,
        PAGE,
        "crab-hunting-after-finding-every-crab-to-join-practise-talking-to-the-main-crab"
      );
      return;
    }
    if (stage === STAGE_DANCE_READY) {
      // A lesson cut short (a logout) starts over with its scene, which plays the lines.
      if (Dream.active(player) && !danceActive(player)) startDanceScene(player);
      else startTranscript(api, player, MAIN_CRAB_END_NPC_ID, PAGE, DANCE_VARIANT);
      return;
    }
    if (stage === STAGE_CEREMONY) {
      startTranscript(api, player, MAIN_CRAB_END_NPC_ID, PAGE, CEREMONY_VARIANT);
      return;
    }
    startTranscript(api, player, MAIN_CRAB_NPC_ID, PAGE, "drinking-from-bottle");
  }

  function handleNpcInteraction(event) {
    const { player, npcId, clickType, definition } = event;
    const action = definition?.getActions?.()[clickType - 1];
    if (MAIN_CRAB_NPC_IDS.has(npcId)) {
      if (action !== "Talk-to") return;
      event.handled = true;
      talkToMainCrab(player);
      return;
    }
    if (npcId === SHY_CRAB_NPC_ID || npcId === SHY_CRAB_CONTENT_ID) {
      if (action !== "Talk-to") return;
      const progress = shyCrabProgress(player);
      if (progress === SHY_CRAB_FOUND || progress === SHY_CRAB_BLUSHING) {
        event.handled = true;
        playSteps(player, SHY_CRAB_NPC_ID, SHY_CRAB_LINES);
      } else if (progress === SHY_CRAB_SCUTTERED) {
        // No further captured dialogue after she scutters to the practice.
        event.handled = true;
      }
      return;
    }
    if (FLOATSAM_NPC_IDS.has(npcId)) {
      if (action !== "Net") return;
      event.handled = true;
      netFloatsam(player, event.npc);
    }
  }

  function investigateShyCrabPalm(player) {
    const stage = quest.getStage(player);
    if (quest.isComplete(player) || stage < STAGE_TUNING || stage >= STAGE_ALL_LEADERS) return;
    if (shyCrabProgress(player) >= SHY_CRAB_FOUND) return;
    player.setAttribute(SHY_CRAB_PROGRESS_ATTRIBUTE, SHY_CRAB_FOUND);
    syncDream(player);
    player.sendMessage("A crab comes out shyly.");
    syncVarbits(player);
    playSteps(player, SHY_CRAB_NPC_ID, SHY_CRAB_LINES);
  }

  /**
   * The floatsam: one cast, then the bowstring, the barrel and the plank, a catch every
   * 3/6/6 ticks with the net animation each time; the last one empties it (capture 6159-6177).
   */
  function netFloatsam(player, npc) {
    const stage = quest.getStage(player);
    if (stage < STAGE_INSTRUMENT || stage >= STAGE_RECRUITING || hasItem(player, INSTRUMENT_ITEM_ID)) {
      playSteps(player, MAIN_CRAB_NPC_ID, variantSteps("drinking-from-bottle-interacting-with-the-floatsam"));
      return;
    }
    if (!hasItem(player, BIG_FISHING_NET_ITEM_ID)) {
      player.sendMessage(NEED_NET_TEXT);
      return;
    }
    if (materialsFished(player)) {
      mesbox(player, NOTHING_LEFT_TEXT);
      return;
    }
    if (player.getInventory().getFreeSlots() < FLOATSAM_ITEMS.length - floatsamCaught(player)) {
      player.sendMessage(NO_SPACE_TEXT);
      return;
    }
    if (netting.has(player)) return;
    const casting = {};
    netting.set(player, casting);
    if (npc) player.setPositionToFace(npc.getLocation());
    player.getMovementQueue().reset();
    if (stage < STAGE_MATERIALS) setStage(player, STAGE_MATERIALS);
    const stillNetting = () => netting.get(player) === casting && Dream.active(player) && player.isRegistered?.() !== false;
    Scenes.later(player, FLOATSAM_CAST_DELAY, () => {
      if (!stillNetting()) return netting.delete(player);
      player.sendMessage(FLOATSAM_CAST_TEXT);
      player.performAnimation(new Animation(NET_ANIMATION));
      const catchNext = () => {
        const caught = floatsamCaught(player);
        const next = FLOATSAM_ITEMS[caught];
        if (!next || !stillNetting()) return netting.delete(player);
        Scenes.later(player, FLOATSAM_CATCH_DELAYS[caught], () => {
          if (!stillNetting()) return netting.delete(player);
          if (!hasItem(player, next.itemId)) player.getInventory().adds(next.itemId, 1);
          player.setAttribute(FLOATSAM_CAUGHT_ATTRIBUTE, caught + 1);
          player.sendMessage(next.text);
          player.performAnimation(new Animation(NET_ANIMATION));
          if (caught + 1 >= FLOATSAM_ITEMS.length) {
            netting.delete(player);
            if (hasAllMaterials(player)) setStage(player, STAGE_MATERIALS_READY);
            syncVarbits(player);
            syncDream(player);
            Scenes.later(player, 1, () => mesbox(player, NOTHING_LEFT_TEXT));
            return;
          }
          syncVarbits(player);
          catchNext();
        });
      };
      catchNext();
    });
  }

  // ==========================================================================
  // Conditions, choices and stage directions
  // ==========================================================================

  function answerCondition(event) {
    const { player, npcId, stepId } = event;
    if (!CRAB_NPC_IDS.has(npcId)) return null;
    switch (stepId) {
      case "xfDRD_":
        return true; // this server has no attack-options setting; play the enabled branch
      case "l8tRCh":
        return false;
      case "K-qe1w":
        return !hasAnyShell(player);
      case "mp1abt":
        return shellCount(player) === 1;
      case "6eoFGP":
        return shellCount(player) > 1;
      case "TuN4Gx":
      case "389Shq":
        return false;
      case "iDnqb8":
        return hasItem(player, LYRE_ITEM_ID);
      case "0nXch7":
        for (const itemId of ENCHANTED_LYRE_ITEM_IDS) if (hasItem(player, itemId)) return true;
        return false;
      case "rpY0DE":
        return !hasItem(player, BIG_FISHING_NET_ITEM_ID);
      case "6SReDK":
        return player.getInventory().getFreeSlots() === 0;
      case "N8bbIk":
        return !materialsFished(player) && !hasAllMaterials(player) && !instrumentMade(player);
      case "6TbVF9":
        return hasAllMaterials(player);
      case "OmiT2d":
        return materialsFished(player) && !hasAllMaterials(player) && !instrumentMade(player);
      case "YefR4I":
        return instrumentMade(player) && !hasItem(player, INSTRUMENT_ITEM_ID);
      case "58Th_3":
        return hasAllMaterials(player);
      case "_-d3Em":
        return !hasAllMaterials(player);
      case "Mu0yhy":
        return hasItem(player, INSTRUMENT_ITEM_ID);
      case "rjtSkq":
        return player.getSkillManager().getMaxLevel(Skill.WOODCUTTING) >= WOODCUTTING_LEADER_REQUIREMENT;
      case "8TCO7P":
        return player.getSkillManager().getMaxLevel(Skill.WOODCUTTING) < WOODCUTTING_LEADER_REQUIREMENT;
      case "rXHyu1":
        return player.getAttribute(KID_CRAB_MET_ATTRIBUTE) === true;
      case "suOAJW":
        return instrumentName(player) === "disaster";
      case "_VgJ7G":
        return instrumentName(player) === "bass";
      case "Bb9j57":
        return instrumentName(player) === "banjo";
      case "mLyYVn":
        return player.getAttribute(DIPPER_MET_ATTRIBUTE) === true;
      case "Cx3vIK":
        return player.getAttribute(MAGIC_TREE_MET_ATTRIBUTE) === true;
      case "aBWf-c":
        return player.getAttribute(MAGIC_TREE_MET_ATTRIBUTE) !== true;
      case "xTNJly":
        return leaderCount(player) >= ALL_LEADER_COUNT;
      case "Z9b5Dj":
        return leaderCount(player) < ALL_LEADER_COUNT;
      case "U-Ic3c":
      case "sL_fYT":
        return false;
      case "foHwur":
        return true;
      case "hdDZkC":
        return quest.isComplete(player) && !hasItem(player, SHELL_COLLECTION_ITEM_ID);
      default:
        return null;
    }
  }

  function handleChoice(event) {
    const { player, npcId, option } = event;
    if (npcId !== MAIN_CRAB_NPC_ID) return;
    if (option === "I'll see what I can do." && quest.getStage(player) === STAGE_INSTRUMENT) {
      setStage(player, STAGE_MATERIALS);
      return;
    }
    if (option === DISASTER_NAME) {
      player.setAttribute(INSTRUMENT_NAME_ATTRIBUTE, "disaster");
      return;
    }
    if (option === BASS_NAME) {
      player.setAttribute(INSTRUMENT_NAME_ATTRIBUTE, "bass");
      return;
    }
    if (option === BANJO_NAME && instrumentName(player) === null) {
      player.setAttribute(INSTRUMENT_NAME_ATTRIBUTE, "banjo");
      return;
    }
    if (option === WAIT_FOR_LEADERS_OPTION && quest.getStage(player) === STAGE_TUNING) {
      // Capture tick 6544: stage 50 and every bandmate at practice, the recruited bits kept.
      player.setAttribute(BAND_COMPLETE_ATTRIBUTE, true);
      setStage(player, STAGE_ALL_LEADERS);
      return;
    }
    if (!PLAY_STYLE_OPTIONS.has(option)) {
      if (option === "I will experiment, then!") setStage(player, STAGE_TUNING);
      return;
    }
    setStage(player, STAGE_TUNING);
  }

  /** The bottle's opening conversation advances the intro stages 5/10/15/20/25. */
  function handleLine(event) {
    const { player, npcId, text } = event;
    if (!CRAB_NPC_IDS.has(npcId) || typeof text !== "string") return;
    const stage = quest.getStage(player);
    if (stage === STAGE_START && text.includes("Are you learning, though?")) {
      setStage(player, STAGE_LEARN);
      return;
    }
    if (stage === STAGE_LEARN && text.includes("not had a good experience in the past")) {
      setStage(player, STAGE_STORY);
      return;
    }
    if (stage === STAGE_PLEA && text === "See ya!") setStage(player, STAGE_SHELLS);
    danceLine(player, text, event);
  }

  /** The shell a hand-in message names, from the message its own variant plays. */
  function handedShellFor(text) {
    for (const [itemId, variant] of SHELL_MESSAGE_VARIANTS) {
      if (variantSteps(variant).some((step) => step.type === "message" && step.text === text)) return itemId;
    }
    return null;
  }

  function handleAction(event) {
    const { player, npcId, stepId } = event;
    // "You hand in a ... shell." is an item box with that shell (capture: objectbox 193).
    if (event.kind === "message" && typeof event.text === "string" && event.text.startsWith("You hand in ")) {
      const itemId = handedShellFor(event.text);
      if (itemId !== null) event.box = { items: [itemId] };
    }
    if (npcId === MAIN_CRAB_NPC_ID && event.kind === "message" && BOTTLE_VARIANTS.has(stepId) && !quest.isComplete(player)) {
      // Into the dream needs to be out of it, and back to reality needs to be in it.
      if ((stepId === REALITY_BLACKOUT_STEP) === Dream.active(player)) {
        event.handled = true;
        event.end = true;
        blackOut(player, stepId);
      }
      return;
    }
    if (stepId === SHY_CRAB_BLUSH_STEP || stepId === SHY_CRAB_SCUTTER_STEP) {
      if (npcId !== SHY_CRAB_NPC_ID && npcId !== SHY_CRAB_CONTENT_ID) return;
      event.handled = true;
      if (stepId === SHY_CRAB_BLUSH_STEP) {
        player.setAttribute(SHY_CRAB_PROGRESS_ATTRIBUTE, SHY_CRAB_BLUSHING);
        player.sendMessage("The crab appears to turn bright red.");
      } else {
        player.setAttribute(SHY_CRAB_PROGRESS_ATTRIBUTE, SHY_CRAB_SCUTTERED);
        syncDream(player);
        player.sendMessage("The crab scutters away.");
      }
      syncVarbits(player);
      return;
    }
    if (!CRAB_NPC_IDS.has(npcId) || !stepId) return;
    const joinedBit = JOINED_STEP_BITS.get(stepId);
    if (joinedBit !== undefined) {
      // Live shows the scutter as a message box (capture tick 6519).
      if (event.kind === "message") event.box = { statement: true };
      if (!hasFlag(player, RECRUITED_ATTRIBUTE, joinedBit)) {
        setFlag(player, RECRUITED_ATTRIBUTE, joinedBit);
        if (stepId === MAGIC_TREE_STEP) player.setAttribute(MAGIC_TREE_MET_ATTRIBUTE, true);
        if (stepId === DIPPER_STEP) player.setAttribute(DIPPER_MET_ATTRIBUTE, true);
        if (stepId === KID_CRAB_STEP) player.setAttribute(KID_CRAB_MET_ATTRIBUTE, true);
        recountLeaders(player);
        syncVarbits(player);
        syncDream(player);
        // The sixth recruit: the player's own "enough leaders" line follows the scutter.
        if (leaderCount(player) === SIX_LEADER_COUNT && quest.getStage(player) < STAGE_ALL_LEADERS) {
          event.after = () => playSteps(player, MAIN_CRAB_NPC_ID, variantSteps(SIX_LEADERS_VARIANT));
        }
      }
      return;
    }
    if (stepId === INSTRUMENT_GIVEN_STEP) {
      if (hasItem(player, INSTRUMENT_ITEM_ID)) player.getInventory().deleteNumber(INSTRUMENT_ITEM_ID, 1);
      setStage(player, STAGE_RECRUITING);
      return;
    }
    if (stepId === INSTRUMENT_ONE_NOTE_STEP) {
      setStage(player, STAGE_TUNING);
      return;
    }
    if (stepId === CRAB_VOICE_TRAILS_STEP) {
      setStage(player, STAGE_PLEA);
      return;
    }
    if (stepId === INSTRUMENT_TUNED_STEP) {
      setStage(player, STAGE_TUNING);
      return;
    }
    if (stepId === DANCE_BEGINS_STEP) {
      event.handled = true;
      setStage(player, STAGE_DANCE_READY);
      startDanceScene(player);
      return;
    }
    if (stepId === DANCE_ENDS_STEP) {
      event.handled = true;
      setStage(player, STAGE_CEREMONY);
      endDanceScene(player);
      return;
    }
    if (stepId === CEREMONY_START_STEP) {
      event.handled = true;
      event.end = true;
      startCeremony(player);
      return;
    }
    if (stepId === CEREMONY_COMPLETE_STEP) {
      event.handled = true;
      if (!quest.isComplete(player)) quest.complete(player);
      syncVarbits(player);
      return;
    }
    if (stepId === SHELL_COLLECTION_MESSAGE_STEP) {
      if (quest.isComplete(player) && !hasItem(player, SHELL_COLLECTION_ITEM_ID)) {
        grantShellCollection(player);
      } else {
        // The words say you collect shells you are not actually missing.
        event.handled = true;
      }
      return;
    }
  }

  // ==========================================================================
  // Investigations
  // ==========================================================================

  function spotAt(objectId, location) {
    return (
      SPOTS.find(
        (spot) => spot.objectId === objectId && spot.x === location.x && spot.y === location.y
      ) ?? null
    );
  }

  function spotBit(spot) {
    return 1 << SPOTS.indexOf(spot);
  }

  function chatheadFor(spot) {
    return spot.chathead ?? BAND_CRAB_NPC_ID;
  }

  function investigateSpot(player, spot) {
    const stage = quest.getStage(player);
    const bit = spotBit(spot);
    if (quest.isComplete(player)) {
      startTranscript(api, player, chatheadFor(spot), PAGE, DONE_JOINED_VARIANT);
      return;
    }
    if (stage < STAGE_RECRUITING) {
      if (spot.first) startTranscript(api, player, chatheadFor(spot), PAGE, spot.first);
      else player.sendMessage(NO_CRAB_TEXT);
      return;
    }
    if (spot.joinBit !== undefined && hasFlag(player, RECRUITED_ATTRIBUTE, spot.joinBit)) {
      startTranscript(api, player, chatheadFor(spot), PAGE, DONE_JOINED_VARIANT);
      return;
    }
    if (spot.joinBit === undefined && hasFlag(player, MET_ATTRIBUTE, bit)) {
      startTranscript(api, player, chatheadFor(spot), PAGE, WHILE_OUT_VARIANT);
      return;
    }
    if (spot.first && !hasFlag(player, SCARED_ATTRIBUTE, bit)) {
      setFlag(player, SCARED_ATTRIBUTE, bit);
      startTranscript(api, player, chatheadFor(spot), PAGE, spot.first);
      return;
    }
    if (spot.sitTile && !hasFlag(player, MET_ATTRIBUTE, bit)) {
      // The capture repeats the too-scared line until the player sits; the
      // crab only comes out on the real Sit emote (handled below).
      if (spot.first) startTranscript(api, player, chatheadFor(spot), PAGE, spot.first);
      else player.sendMessage(NO_CRAB_TEXT);
      return;
    }
    // A later investigate is recovery for a crab already coaxed out.
    setFlag(player, MET_ATTRIBUTE, bit);
    startTranscript(api, player, chatheadFor(spot), PAGE, spot.variant);
  }

  /** The captured coax: after the too-scared line, Sit on the spot's tile. */
  function handleEmote(event) {
    const { player, slot } = event;
    if (!player || slot !== SIT_EMOTE_SLOT) return;
    const stage = quest.getStage(player);
    if (quest.isComplete(player) || stage < STAGE_RECRUITING || stage >= STAGE_ALL_LEADERS) return;
    const here = player.getLocation();
    for (const spot of SPOTS) {
      if (!spot.sitTile || spot.joinBit === undefined) continue;
      if (hasFlag(player, RECRUITED_ATTRIBUTE, spot.joinBit)) continue;
      const bit = spotBit(spot);
      if (hasFlag(player, MET_ATTRIBUTE, bit) || !hasFlag(player, SCARED_ATTRIBUTE, bit)) continue;
      if (here.getX() !== spot.sitTile.x || here.getY() !== spot.sitTile.y || here.getZ() !== 0) continue;
      setFlag(player, MET_ATTRIBUTE, bit);
      player.sendMessage("And now, you wait...");
      startTranscript(api, player, chatheadFor(spot), PAGE, spot.variant);
      return;
    }
  }

  // ==========================================================================
  // Items, ground items and interactions
  // ==========================================================================

  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    if (!MATERIAL_ITEM_IDS.has(usedItemId) || !MATERIAL_ITEM_IDS.has(usedWithItemId)) return;
    event.handled = true;
    const stage = quest.getStage(player);
    if (stage < STAGE_INSTRUMENT || stage >= STAGE_RECRUITING) return;
    if (!hasAllMaterials(player)) {
      player.sendMessage(NEED_MATERIALS_TEXT);
      return;
    }
    player.getInventory().deleteNumber(PLANK_ITEM_ID, 1);
    player.getInventory().deleteNumber(BARREL_ITEM_ID, 1);
    player.getInventory().deleteNumber(BOWSTRING_ITEM_ID, 1);
    player.getInventory().adds(INSTRUMENT_ITEM_ID, 1);
    player.setAttribute(INSTRUMENT_MADE_ATTRIBUTE, true);
    setStage(player, STAGE_INSTRUMENT_MADE);
    player.sendMessage(CRAFT_MESSAGE_TEXT);
  }

  function handleObjectInteraction(event) {
    const { player, objectId, clickType, location, definition } = event;
    if (
      objectId === CRAB_BOTTLE_RAW_OBJECT_ID ||
      objectId === CRAB_BOTTLE_OBJECT_ID ||
      objectId === CRAB_BOTTLE_POST_OBJECT_ID
    ) {
      const action = definition?.getActions?.()[clickType - 1];
      if (action !== "Drink" && action !== "Reminisce") return;
      event.handled = true;
      drinkFromBottle(player);
      return;
    }
    const at = Dream.toSource(player, location);
    if (objectId === CRAB_PALM_3_OBJECT_ID && at.x === SHY_CRAB_PALM_TILE.x && at.y === SHY_CRAB_PALM_TILE.y) {
      if (definition?.getActions?.()[clickType - 1] !== "Investigate") return;
      event.handled = true;
      investigateShyCrabPalm(player);
      return;
    }
    const spot = spotAt(objectId, at);
    if (!spot) return;
    if (definition?.getActions?.()[clickType - 1] !== "Investigate") return;
    event.handled = true;
    investigateSpot(player, spot);
  }

  function handleGroundItemPickup(event) {
    const { player, groundItemId } = event;
    const location = Dream.toSource(player, event.location);
    const shellIndex = ALL_SHELL_ITEM_IDS.indexOf(groundItemId);
    if (shellIndex >= 0) {
      const tile = SHELL_TILES[shellIndex];
      if (tile && tile.x === location.x && tile.y === location.y) {
        setFlag(player, SHELLS_PICKED_ATTRIBUTE, 1 << shellIndex);
        syncVarbits(player);
      }
      return;
    }
    if (
      groundItemId === BIG_FISHING_NET_ITEM_ID &&
      location.x === NET_TILE.x &&
      location.y === NET_TILE.y
    ) {
      setFlag(player, NET_PICKED_ATTRIBUTE, 1);
      syncVarbits(player);
    }
  }

  /** Maps the old 1..8 ladder onto the live 5..63 values once. */
  function migrateStage({ player }) {
    if (player.getAttribute(STAGE_VERSION_ATTRIBUTE) === STAGE_VERSION) return;
    const old = quest.getStage(player);
    const migrated = { 1: 25, 2: 30, 3: 45, 4: 47, 5: 50, 6: 55, 7: 60, 8: 63 }[old];
    if (migrated !== undefined) quest.setStage(player, migrated);
    player.setAttribute(STAGE_VERSION_ATTRIBUTE, STAGE_VERSION);
  }

  /**
   * Fills sub-state that older saves could not record. A handed-in count of
   * seven proves all seven colours were consumed; partial counts prove nothing
   * about which colours, so they are left at 0 rather than guessed.
   */
  function migrateSubState(player) {
    if (handedShellCount(player) >= SHELL_COUNT) {
      player.setAttribute(SHELLS_HANDED_MASK_ATTRIBUTE, (1 << SHELL_COUNT) - 1);
    }
    // The old plugin only knew "met"; that proves the crab was found, not that
    // the captured blush/scutter conversation ran.
    if (shyCrabProgress(player) === SHY_CRAB_HIDDEN && player.getAttribute(SHY_CRAB_ATTRIBUTE) === true) {
      player.setAttribute(SHY_CRAB_PROGRESS_ATTRIBUTE, SHY_CRAB_FOUND);
    }
  }

  /** Login is always on the real beach: the dream and the ceremony end with the session. */
  function handleLogin({ player }) {
    if (player.getAttribute(IN_INSTANCE_ATTRIBUTE) === true) {
      player.setAttribute(IN_INSTANCE_ATTRIBUTE, false);
      player.moveTo(new Location(DREAM_ENTRY_TILE.x, DREAM_ENTRY_TILE.y, 0));
    }
    refreshQuestList(player);
    migrateSubState(player);
    syncVarbits(player);
  }

  function handleBootstrap({ player }) {
    if (!player || player.isPlayerBot?.() === true) return;
    migrateStage({ player });
    migrateSubState(player);
    syncVarbits(player);
  }

  function handleLogout({ player }) {
    netting.delete(player);
    Scenes.cancel(player);
    Scenes.closeFade(player);
  }

  /** The dream's headache: no boat, no teleport, until the bottle wakes the player. */
  function canBoardDream(event) {
    if (event.allow === false || !Dream.active(event.player)) return;
    event.allow = false;
    event.reason = DREAM_BOAT_REFUSAL;
  }

  function canTeleportDream(event) {
    if (!Dream.active(event.player)) return;
    event.allow = false;
    event.player.sendMessage(DREAM_TELEPORT_REFUSAL);
  }

  // ==========================================================================
  // Journal and rewards
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I drank from the strange bottle on Dognose Island and met a</str>",
        "<str>crab who wanted to become a ceremonial leader.</str>",
        "<str>I gathered shells, built him an instrument and recruited</str>",
        "<str>eleven crabs for the ceremony.</str>",
        "",
        "<str>The crabs danced and I woke up with a shell collection.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage === STAGE_NOT_STARTED) {
      return [
        "I can start this quest by drinking from the",
        "strange <col=800000>bottle</col> on <col=800000>Dognose Island</col>.",
        "",
        "I need <col=800000>40 Sailing</col> and <col=800000>30 Fishing</col>.",
      ];
    }
    const lines = [
      "I drank from the strange bottle on Dognose Island and met a crab who",
      "wants to be a ceremonial leader at the crab ceremony.",
      "",
    ];
    if (stage < STAGE_INSTRUMENT) {
      lines.push("I should gather seashells from around the island and bring");
      lines.push("them to the crab. I have handed in " + handedShellCount(player) + "/7 good shells.");
    } else if (stage < STAGE_RECRUITING) {
      lines.push("The crab can't play 7 shells at once, so I agreed to make him");
      lines.push("a string instrument from the floatsam on the beach.");
    } else if (stage < STAGE_ALL_LEADERS) {
      lines.push("The crab is practising his instrument while I recruit more crabs");
      lines.push("to become ceremonial leaders. Leaders found: " + leaderCount(player) + "/11.");
    } else if (stage === STAGE_ALL_LEADERS) {
      lines.push("All eleven ceremonial leaders have gathered on the beach.");
      lines.push("I should talk to the crab about the ceremony.");
    } else {
      lines.push("The ceremony is about to begin on the beach.");
    }
    return lines;
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.SAILING, 10000);
    player.getSkillManager().addExperiences(Skill.FISHING, 3000);
  }

  // ==========================================================================
  // Registration
  // ==========================================================================

  api.persistAttribute(RECRUITED_ATTRIBUTE);
  api.persistAttribute(SCARED_ATTRIBUTE);
  api.persistAttribute(MET_ATTRIBUTE);
  api.persistAttribute(SHELLS_HANDED_ATTRIBUTE);
  api.persistAttribute(SHELLS_HANDED_MASK_ATTRIBUTE, 0);
  api.persistAttribute(SHELLS_PICKED_ATTRIBUTE);
  api.persistAttribute(NET_PICKED_ATTRIBUTE);
  api.persistAttribute(MATERIALS_FISHED_ATTRIBUTE);
  api.persistAttribute(FLOATSAM_CAUGHT_ATTRIBUTE, 0);
  api.persistAttribute(BAND_COMPLETE_ATTRIBUTE, false);
  api.persistAttribute(IN_INSTANCE_ATTRIBUTE, false);
  api.persistAttribute(INSTRUMENT_MADE_ATTRIBUTE);
  api.persistAttribute(INSTRUMENT_NAME_ATTRIBUTE);
  api.persistAttribute(MAGIC_TREE_MET_ATTRIBUTE);
  api.persistAttribute(DIPPER_MET_ATTRIBUTE);
  api.persistAttribute(KID_CRAB_MET_ATTRIBUTE);
  api.persistAttribute(SHY_CRAB_ATTRIBUTE, false);
  api.persistAttribute(SHY_CRAB_PROGRESS_ATTRIBUTE, 0);
  api.persistAttribute(STAGE_VERSION_ATTRIBUTE, 0);

  quest = registerQuest(api, {
    key: "crab_quest",
    name: "Crab Quest",
    varpId: 5739,
    varbitId: STAGE_VARBIT,
    startedValue: STAGE_START,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [
      { skillId: Skill.SAILING.getIndex(), amount: 10000, label: "Sailing" },
      { skillId: Skill.FISHING.getIndex(), amount: 3000, label: "Fishing" },
    ],
    rewardItemId: SHELL_COLLECTION_ITEM_ID,
    rewardItemLabel: "A shell collection",
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("sailing:can-board", canBoardDream);
  api.onCustomEvent("teleport:can-start", canTeleportDream);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("player:emote", handleEmote);
  api.onNpcInteraction(handleNpcInteraction);
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemOnItem(handleItemOnItem);
  api.onGroundItemPickup(handleGroundItemPickup);
  api.onPlayerLogin(migrateStage);
  api.onPlayerLogin(handleLogin);
  api.onCustomEvent("player:bootstrap-complete", handleBootstrap);
  api.onPlayerLogout(handleLogout);
};
