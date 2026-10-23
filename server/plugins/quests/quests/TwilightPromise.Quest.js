/**
 * Twilight's Promise (members).
 *
 * Behaviour follows the complete quest in RSProx recording 1695 (revision 226, ticks 400-2423);
 * the words come from the "Twilight's Promise" transcript page (OSRS Wiki). Evidence and
 * remaining gaps: docs/p2p-varlamore-group-2-parity.md.
 *
 * Stages live in varbit 9649 "vmq2" (varp 4076, bits 0-6), as captured:
 *
 *   0 not started (the Tullus twins by the palace stairs start it)
 *   2 started            4 told to find the Prince at the temple
 *   6 met Metzli         8 asked about the Prince; the crypt gate opens
 *  10 met Itzla and Servius in the crypt   12 sent back to the twins
 *  14 Furia gave the crest; 16, 18 and 20 as each group of knights agrees to return
 *  22 all four groups agreed   24 search the Kualti Headquarters (the crest is taken back)
 *  26 found the letter   28 read it   30 the judgement cutscene   32 it ended
 *  34 sent to Regulus Cento   36 given the quetzal feed   38 Renu fed
 *  40 told Itzla at the Teomat   42 sent to Metzli   44 the cultist attack
 *  46 the cultists are defeated   48 the guard has left with Servius   50 complete
 *
 * Side varbits as captured: 9829 bazaar, 9830 cothon, 9831 pub and 9832 colosseum knights (1
 * asked, 2 task done, 3 returning), 9833 given the crest, 9834 Azali (1 at the pub, 2
 * following, 3 sober at the fountain) and vmq3_itzla_vis (the Teomat Prince, until The Heart of
 * Darkness takes it over). The quest's NPCs are the cache's multi-NPCs placed in npc-spawns.json
 * at the captured tiles; these varbits show and hide them for each player, as live does.
 *
 * Rewards per the capture: 1 Quest point, the Quetzal Transport System, the Civitas illa Fortis
 * Teleport and 3,000 Thieving XP.
 */
module.exports = function registerTwilightPromiseQuest(api) {
  const {
    ActionDialogue,
    Animation,
    DialogueChainBuilder,
    GameObject,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    ObjectIdentifiers,
    PrayerHandler,
    Skill,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript, loadTranscripts } = require("../QuestRuntime");
  const { createQuestScenes } = require("../QuestScenes");
  const { crossingFor } = require("../../objects/WallDoor.Doors");
  const ObstacleRunner = require("../../skills/agility/ObstacleRunner.Agility");

  const PAGE = "Twilight's Promise";
  const START_HOOK = "quest:twilight-s-promise:start";
  const CHILDREN_OF_THE_SUN_KEY = "children_of_the_sun";
  const GARDEN_OF_DEATH_KEY = "the_garden_of_death";
  const HEART_OF_DARKNESS_KEY = "the_heart_of_darkness";

  // Varp 4076; the stage is varbit 9649 "vmq2" (bits 0-6).
  const VARP_TWILIGHTS_PROMISE = 4076;
  const STAGE_VARBIT = 9649;
  const BAZAAR_VARBIT = 9829;
  const COTHON_VARBIT = 9830;
  const PUB_VARBIT = 9831;
  const COLOSSEUM_VARBIT = 9832;
  const CREST_VARBIT = 9833;
  const AZALI_VARBIT = 9834;
  const ITZLA_VIS_VARBIT = 11123; // vmq3_itzla_vis

  const STAGE_STARTED = 2;
  const STAGE_TEMPLE = 4;
  const STAGE_METZLI = 6;
  const STAGE_CRYPT = 8;
  const STAGE_MET_PRINCE = 10;
  const STAGE_TWINS = 12;
  const STAGE_RECRUIT = 14;
  const STAGE_JUDGEMENT = 22;
  const STAGE_HQ = 24;
  const STAGE_LETTER = 26;
  const STAGE_LETTER_READ = 28;
  const STAGE_VERDICT = 30;
  const STAGE_VERDICT_DONE = 32;
  const STAGE_REGULUS = 34;
  const STAGE_FEED = 36;
  const STAGE_FED = 38;
  const STAGE_TEOMAT = 40;
  const STAGE_LIBRARY = 42;
  const STAGE_BATTLE = 44;
  const STAGE_AFTERMATH = 46;
  const STAGE_GUARD_LEFT = 48;
  const STAGE_COMPLETE = 50;

  // The visible variants the multi-NPCs resolve to (the ids the dialogue events carry).
  const FURIA_NPC_ID = NpcIdentifiers.FURIA_TULLUS_2; // 12890
  const ENNIUS_NPC_ID = NpcIdentifiers.ENNIUS_TULLUS_2; // 12892
  const METZLI_NPC_ID = NpcIdentifiers.METZLI_TEOKAN_OF_RANUL; // 12894
  const ITZLA_NPC_ID = NpcIdentifiers.PRINCE_ITZLA_ARKAN_3; // 12896
  const SERVIUS_NPC_ID = NpcIdentifiers.SERVIUS_TEOKAN_OF_RALOS_2; // 12899
  const ARRUN_NPC_ID = NpcIdentifiers.KNIGHT_OF_VARLAMORE_9; // 12902
  const CLAUDIA_NPC_ID = NpcIdentifiers.KNIGHT_OF_VARLAMORE_11; // 12904
  const NEL_NPC_ID = NpcIdentifiers.KNIGHT_OF_VARLAMORE_13; // 12906
  const VELAM_NPC_ID = NpcIdentifiers.KNIGHT_OF_VARLAMORE_15; // 12908
  const AZALI_SOBER_NPC_ID = NpcIdentifiers.KNIGHT_OF_VARLAMORE_17; // 12910
  const AZALI_DRUNK_NPC_ID = NpcIdentifiers.KNIGHT_OF_VARLAMORE_19; // 12912
  const MEZAN_NPC_ID = NpcIdentifiers.KNIGHT_OF_VARLAMORE_21; // 12914
  const CITIZEN_NPC_ID = NpcIdentifiers.CITIZEN_27; // 12929
  const REGULUS_NPC_ID = NpcIdentifiers.REGULUS_CENTO_3; // 12885
  // The resolved knight content ids are absent from npc-dialogue-index.json, so the
  // generic name lookup would play the unrelated "Knight of Varlamore" page.
  const KNIGHT_CONTENT_IDS = [ARRUN_NPC_ID, CLAUDIA_NPC_ID, NEL_NPC_ID, VELAM_NPC_ID,
    AZALI_SOBER_NPC_ID, AZALI_DRUNK_NPC_ID, MEZAN_NPC_ID];
  const RENU_FEED_NPC_ID = NpcIdentifiers.RENU_2; // 13349
  const AZALI_FOLLOWER_ROOT_ID = 13393; // vmq2_knight_5_follower, shown while Azali follows
  const AZALI_PUB_ROOT_ID = 13392; // vmq2_knight_5_pub
  const AZALI_PUB_TILE = [1721, 3075];
  // Scene actors.
  const FURIA_ACTOR_ID = NpcIdentifiers.FURIA_TULLUS_3; // 12891
  const ENNIUS_ACTOR_ID = NpcIdentifiers.ENNIUS_TULLUS_3; // 12893
  const ITZLA_ACTOR_ID = NpcIdentifiers.PRINCE_ITZLA_ARKAN_4; // 12897
  const ITZLA_FIGHTER_ID = 12898; // vmq2_itzla_combat
  const SERVIUS_BATTLE_ID = 12900; // vmq2_servius_battle
  const SERVIUS_INJURED_ID = NpcIdentifiers.SERVIUS_TEOKAN_OF_RALOS_4; // 12901
  const METZLI_BATTLE_ID = NpcIdentifiers.METZLI_TEOKAN_OF_RANUL_2; // 12895
  const AZALI_ACTOR_ID = NpcIdentifiers.KNIGHT_OF_VARLAMORE_20; // 12913, vmq2_knight_5_cutscene_drunk
  const FOUNTAIN_ACTOR_ID = NpcIdentifiers.COL_00FFFF_FOUNTAIN_COL; // 12930
  const MEZAN_FIGHTER_ID = NpcIdentifiers.KNIGHT_OF_VARLAMORE_23; // 12916
  const MEZAN_DONE_ID = NpcIdentifiers.KNIGHT_OF_VARLAMORE_24; // 12917
  const GUARD_ACTOR_ID = NpcIdentifiers.GUARD_229; // 12928
  const KNIGHT_ACTORS = [12903, 12905, 12907, 12909, 12911, 12915]; // vmq2_knight_1..6_cutscene
  const VELAM_ACTOR_ID = 12909;

  const CREST_ITEM_ID = ItemIdentifiers.VARLAMORE_CREST; // 28973
  const LETTER_ITEM_ID = ItemIdentifiers.INCRIMINATING_LETTER; // 28974
  const FEED_ITEM_ID = ItemIdentifiers.QUETZAL_FEED; // 28975
  const AMULET_ITEM_ID = ItemIdentifiers.STOLEN_AMULET; // 28976
  const WEAPON_BOX_ITEMS = [1279, 1311]; // the crate's two weapons, as captured

  const GATE_OBJECT_ID = ObjectIdentifiers.GATE_295; // 50861, vmq2_temple_gate
  const GATE_OPEN_OBJECT_ID = ObjectIdentifiers.GATE_296; // 50862
  const GATEWAY_OBJECT_ID = 38848; // the nameless loc the capture swaps onto the gate
  const GATE_TILE = { x: 1698, y: 9496 };
  const CRATE_OBJECT_ID = 50870; // vmq2_cothon_crate
  const CRATES_OBJECT_ID = 50871; // vmq2_cothon_crates
  const WEAPON_CRATE_TILE = { x: 1778, y: 3149 };
  const CHEST_OBJECT_IDS = [50863, 50864, 50865, 50866, 50867, 50868]; // vmq2_knight_1..6_chest
  const LETTER_CHEST_IDS = [50865, 50866]; // the south-eastern room's two chests
  const OPEN_CHEST_OBJECT_ID = 50869;
  const CHEST_OPEN_TICKS = 2;

  const LETTER_INTERFACE = 291;
  const LETTER_LINES = {
    6: "Velam,",
    8: "Long have you waited. So patiently. So dutifully. Now,",
    9: "at long last, you have been graced with the most glorious",
    10: "of duties, for the day of our destiny is fast approaching.",
    11: "The Teokan will soon travel to the east and you will be",
    12: "selected to accompany him. You must ensure he never",
    13: "returns. Only with his demise can Twilight's Promise",
    14: "begin. Only with his demise will we see the Final Dawn.",
  };

  const RENU_FEED_PLAYER_ANIMATION = 10939;
  const RENU_FEED_ANIMATION = 10951;
  const RENU_FEED_TICKS = 9;
  const FOUNTAIN_SPLASH_ANIMATION = 10942;
  const ENNIUS_STRIKE_ANIMATION = 390;
  const VELAM_FALL_ANIMATION = 836;
  const VELAM_DAMAGE = 50;
  const SPAR_ATTACKS = { guard: 401, guardBlock: 403, cultist: 386, cultistBlock: 388, itzla: 390, itzlaBlock: 388 };
  const SPAR_TICKS = 4;

  // Azali's escort.
  const FOLLOW_STRAY_DISTANCE = 10;
  const FOLLOW_REST_MIN_TICKS = 15;
  const FOLLOW_REST_MAX_TICKS = 25;
  const FOUNTAIN_TILE = [1757, 3068];
  const FOUNTAIN_REACH = 2;

  // Mezan prays against a style used four times running (Wiki); his three prayer calls.
  const MEZAN_PRAYER_STREAK = 4;
  const MEZAN_PRAYER_LINES = ["Ralos will defend me!", "Ralos' light protects me!", "Shield me, Ralos!"];

  // Scenes, at the capture's tiles (the live game plays them in instances).
  const PALACE_BOUNDS = [[1665, 1700, 3145, 3170, 0]];
  const FOUNTAIN_BOUNDS = [[1745, 1770, 3058, 3080, 0]];
  const ARENA_BOUNDS = [[1806, 1842, 3088, 3128, 0]];
  const TEOMAT_BOUNDS = [[1425, 1465, 3140, 3205, 0]];
  const COLOSSEUM_LOBBY_TILE = [1803, 9521, 0];
  const BATTLE_CULTISTS = [
    { id: 12921, tile: [1434, 3167], face: [1440, 3172] },
    { id: 12923, tile: [1438, 3172], face: [1440, 3172], partner: 1 },
    { id: 12922, tile: [1445, 3166], face: [1445, 3168], partner: 0 },
    { id: 12920, tile: [1444, 3172], face: [1444, 3174], partner: "itzla" },
    { id: 12919, tile: [1441, 3169], face: [1441, 3171], partner: 2 },
    { id: 12918, tile: [1440, 3175], face: [1441, 3179], player: true },
    { id: 12922, tile: [1443, 3176], face: [1444, 3176], partner: 3 },
    { id: 12920, tile: [1448, 3168], face: [1445, 3168], partner: 0 },
  ];
  const BATTLE_GUARDS = [
    { id: 12924, tile: [1445, 3168], face: [1445, 3166] },
    { id: 12925, tile: [1440, 3172], face: [1438, 3172] },
    { id: 12926, tile: [1441, 3171], face: [1441, 3169] },
    { id: 12927, tile: [1444, 3176], face: [1443, 3176] },
  ];
  const BATTLE_LOCS = [
    { id: 52800, x: 1433, y: 3142, face: 0 }, { id: 52639, x: 1437, y: 3181, face: 3 },
    { id: 52639, x: 1442, y: 3181, face: 1 }, { id: 52617, x: 1440, y: 3190, face: 1 },
    { id: 53019, x: 1457, y: 3187, face: 2 }, { id: 52617, x: 1458, y: 3195, face: 2 },
  ];
  const AFTERMATH_LOCS = [
    { id: 52413, x: 1449, y: 3171, face: 2 }, { id: 29733, x: 1449, y: 3177, face: 0 },
    { id: 29733, x: 1452, y: 3177, face: 0 }, { id: 50055, x: 1449, y: 3176, type: 4, face: 1 },
    { id: 50055, x: 1452, y: 3176, type: 4, face: 1 },
  ];

  const V = {
    TWINS_START: "with-friends-like-these-talking-to-either-ennius-or-furia-tullus",
    TWINS_STARTED: "with-friends-like-these-talking-to-either-ennius-or-furia-tullus-talking-to-either-again-after-starting-the-quest",
    TWINS_WAIT: "with-friends-like-these-talking-to-either-ennius-or-furia-tullus-talking-to-either-again",
    GATE_LOCKED: "with-friends-like-these-attempting-to-open-the-gate-in-the-temple-basement-before-talking-to-metzli",
    METZLI_INTRO: "with-friends-like-these-talking-to-metzli-teokan-of-ranul",
    METZLI_RETURN: "with-friends-like-these-talking-to-metzli-teokan-of-ranul-talking-to-metzli-before-asking-about-prince-itzla",
    METZLI_AGAIN: "with-friends-like-these-talking-to-metzli-teokan-of-ranul-talking-to-metzli-again",
    PRINCE: "with-friends-like-these-talking-to-prince-itzla-or-servius",
    PRINCE_BACK: "with-friends-like-these-talking-to-prince-itzla-or-servius-talking-to-either-after-hearing-about-the-assassination-attempt",
    PRINCE_TWINS: "with-friends-like-these-talking-to-prince-itzla-or-servius-talking-to-either-again",
    TWINS_CREST: "oh-brother-talking-to-the-tullus-twins",
    TWINS_RECRUITING: "oh-brother-talking-to-the-tullus-twins-talking-to-either-again",
    BAZAAR: "oh-brother-arrun-and-claudia",
    BAZAAR_PICKPOCKET: "oh-brother-arrun-and-claudia-pickpocketing-the-citizen",
    BAZAAR_AGAIN: "oh-brother-arrun-and-claudia-talking-to-arrun-or-claudia-after-speaking-to-them-once",
    BAZAAR_DONE: "oh-brother-arrun-and-claudia-talking-to-either-again-after-giving-the-amulet",
    COTHON: "oh-brother-nel",
    COTHON_BEFORE: "oh-brother-nel-searching-the-correct-crate-before-talking-to-nel",
    COTHON_WRONG: "oh-brother-nel-searching-an-incorrect-crate",
    COTHON_WRONG_PLURAL: "oh-brother-nel-searching-incorrect-crates",
    COTHON_FOUND: "oh-brother-nel-searching-the-correct-crate",
    COTHON_AGAIN: "oh-brother-nel-talking-to-nel-after-speaking-to-her-once",
    COTHON_DONE: "oh-brother-nel-talking-to-her-again-after-finding-the-crate",
    COTHON_ANY: "oh-brother-nel-searching-any-crate-after-nel-s-work-is-done",
    COTHON_ANY_PLURAL: "oh-brother-nel-searching-any-crates-after-nel-s-work-is-done",
    MEZAN: "oh-brother-mezan",
    MEZAN_AGAIN: "oh-brother-mezan-talking-to-mezan-again",
    MEZAN_FIGHT: "oh-brother-mezan-while-fighting-mezan",
    MEZAN_DEFEATED: "oh-brother-mezan-after-defeating-mezan",
    MEZAN_DONE: "oh-brother-mezan-talking-to-mezan-after-he-agrees-to-return-to-the-palace",
    PUB: "oh-brother-velam-and-azali",
    PUB_FOLLOWING: "oh-brother-velam-and-azali-talking-to-velam-while-azali-is-following",
    AZALI_RESTS: "oh-brother-velam-and-azali-azali-occasionally",
    AZALI_FOLLOWING: "oh-brother-velam-and-azali-talking-to-azali-while-she-s-following-you",
    AZALI_FOUNTAIN: "oh-brother-velam-and-azali-after-leading-azali-to-the-fountain",
    AZALI_SOBER: "oh-brother-velam-and-azali-talking-to-azali-after-sobering-up",
    VELAM_SOBER: "oh-brother-velam-and-azali-talking-to-velam-after-azali-sobered-up",
    TWINS_JUDGEMENT: "oh-brother-judgement",
    TWINS_HQ: "oh-brother-judgement-talking-to-the-twins-again",
    CHEST_WRONG: "oh-brother-judgement-searching-a-wrong-chest-or-the-correct-chest-before-and-after-the-quest",
    CHEST: "oh-brother-judgement-searching-the-correct-chest",
    TWINS_LETTER: "oh-brother-judgement-talking-to-the-tullus-twins",
    TWINS_VERDICT: "oh-brother-judgement-talking-to-the-tullus-twins-after-starting-the-cutscene",
    TWINS_VERDICT_DONE: "oh-brother-judgement-talking-to-the-tullus-twins-after-finishing-the-cutscene",
    TWINS_REGULUS: "oh-brother-judgement-talking-to-either-again",
    REGULUS: "the-twilight-emissaries-talking-to-regulus",
    REGULUS_AGAIN: "the-twilight-emissaries-talking-to-regulus-talking-to-regulus-again",
    REGULUS_FED: "the-twilight-emissaries-talking-to-regulus-talking-to-regulus-after-feeding-renu",
    METZLI_TEOMAT_WAIT: "the-twilight-emissaries-talking-to-metzli-before-speaking-to-the-prince",
    PRINCE_EARLY: "the-twilight-emissaries-talking-to-prince-itzla-without-speaking-to-regulus",
    PRINCE_TEOMAT: "the-twilight-emissaries-talking-to-prince-itzla",
    PRINCE_TEOMAT_AGAIN: "the-twilight-emissaries-talking-to-prince-itzla-talking-to-prince-itzla-or-servius-again",
    METZLI_TEOMAT: "the-twilight-emissaries-talking-to-metzli",
    AFTER_CULTISTS: "the-twilight-emissaries-after-defeating-the-cultists",
    AFTER_GUARD: "the-twilight-emissaries-talking-to-prince-itzla-arkan-after-the-guard-leaves",
    POST_QUEST: "post-quest-dialogue-talking-to-prince-itzla-arkan",
  };

  // Lines that move the quest on as they appear (the capture's varbit ticks).
  const LINES = {
    TEMPLE: "On the other side of the bazaar, south of here.",
    METZLI_MET: "Yes. As Teokan of Ranul, I lead the Sect of Ranul. My counterpart, Servius, leads the Church of Ralos.",
    CRYPT: "Yes you are. He is speaking with Servius, down in the crypt. Not a place you'd normally find the Teokan of Ralos, but the Prince desired the privacy only Ranul can offer.",
    MET_PRINCE: "You're quite right, of course. But anyway, shall we get down to business?",
    TWINS: "Then it sounds like we're all set. Timoiva, and may the sun light your way!",
    BAZAAR_ASKED: "Well this doesn't sound totally orthodox, but fair enough. I'll be back soon.",
    COTHON_ASKED: "Good to know. I'll get to it and let you know what I find.",
    COTHON_DONE: "Perfect! That's my work here done then. I'll return to the palace shortly. Timoiva!",
    PUB_ASKED: "Well there's nothing like a little dunk to sober you up a bit. Azali, come with me.",
    AZALI_COMES: "Ohh... We're going somewhere new? How exciting!",
    PUB_DONE: "This day is the worst. Fine, I'll head over there soon.",
    MEZAN_ASKED: "Oh, and bring two attack styles in with you. I want some variety, and it will help me test my faith in Ralos.",
    MEZAN_READY: "Kuani!",
    MEZAN_DONE: "Yes, I'll head over there shortly.",
    HQ: "We'll keep the knights busy until you're done.",
    VERDICT: "Then it sounds like Velam has some explaining to do. This should be fun.",
    REGULUS: "You should not waste time. The Prince will be eager to hear what you've discovered.",
    TEOMAT: "Now, [player name], did your investigation uncover anything else?",
    LIBRARY: "Right, I'll go and see if she can help me.",
    BATTLE: "I guess I'd better...",
    CALL_OUT: "[player name]! I need you outside, now! We have a little bit of an issue!",
    COMPLETE: "However, let's not worry about that just now. Instead, I wanted to thank you for all that you've done. You may be an outsider, but you've already proven yourself to be a true friend to Varlamore. Thank you, iknami.",
  };

  // Transcript steps the plugin plays itself.
  const STEP = {
    CREST: new Set(["Ev2lHZ", "wqRY6L", "xxd9qj"]),
    SHOW_CREST: new Set(["o6WA7o", "MvE-PO", "IsCa0z", "ZdVwjS"]),
    AMULET_FOUND: "D0l_R6",
    AMULET_GIVEN: "VgHiDe",
    WEAPONS: "ibPuw6",
    AZALI_STOPS: "sqN3PN",
    AZALI_FOLLOWS: "M9yTX1",
    DUNK: "ktO5Kb",
    LETTER: "nUVL01",
    VERDICT: new Set(["yqVhSV", "OYWyE3"]),
    VELAM_STEPS: "y1B9YC",
    VELAM_KILLED: "90Dila",
    KNIGHTS_LEAVE: "T86ZS5",
    RENU_PERKS_UP: "00eVwW",
    FEED: new Set(["V6x6Qr", "2fRkv2"]),
    RENU_FED: "OlyLnC",
    OPEN_MAP: "0GSFPb",
    AFTERMATH: "Nmr-Yg",
    GUARD_LEAVES: "rp2e-K",
    COMPLETE: "NyygQH",
    FEED_TAIL: "BN2pDG",
  };

  const RECRUITS_ATTRIBUTE = "quest.twilights_promise.recruits";
  const FLAGS_ATTRIBUTE = "quest.twilights_promise.flags";
  const LETTER_CHEST_ATTRIBUTE = "quest.twilights_promise.letter-chest";
  const STAGE_VERSION_ATTRIBUTE = "twilights-promise:stage-version";
  const STAGE_VERSION = 1;
  const OLD_FLAG_MESSAGE_READ = 1 << 0;
  const RECRUIT_VARBITS = [BAZAAR_VARBIT, COTHON_VARBIT, PUB_VARBIT, COLOSSEUM_VARBIT];
  const BAZAAR = 0;
  const COTHON = 1;
  const PUB = 2;
  const COLOSSEUM = 3;

  let quest;
  const followers = new Map();
  const mezanStreaks = new WeakMap();
  const Scenes = createQuestScenes(api, { onEnd: sceneEnded });

  // ==========================================================================
  // State
  // ==========================================================================

  const stage = (player) => quest.getStage(player);
  const held = (player, itemId) => player.getInventory().getAmount(itemId) >= 1;
  const inventoryFull = (player) => player.getInventory().isFull();

  function advance(player, value) {
    if (stage(player) < value) quest.setStage(player, value);
    syncSideVarbits(player);
  }

  function recruit(player, group) {
    return ((Number(player.getAttribute(RECRUITS_ATTRIBUTE)) || 0) >> (2 * group)) & 3;
  }

  /** A knight group's progress; the stage counts the groups that agreed to return. */
  function setRecruit(player, group, value) {
    const packed = Number(player.getAttribute(RECRUITS_ATTRIBUTE)) || 0;
    player.setAttribute(RECRUITS_ATTRIBUTE, (packed & ~(3 << (2 * group))) | ((value & 3) << (2 * group)));
    if (value >= 3 && stage(player) >= STAGE_RECRUIT && stage(player) < STAGE_JUDGEMENT) {
      const agreed = [BAZAAR, COTHON, PUB, COLOSSEUM].filter((index) => recruit(player, index) >= 3).length;
      quest.setStage(player, STAGE_RECRUIT + agreed * 2);
    }
    syncSideVarbits(player);
  }

  function azaliState(player) {
    const current = stage(player);
    if (current < STAGE_RECRUIT || current >= STAGE_HQ) return 0;
    if (recruit(player, PUB) >= 2) return 3;
    return following(player) ? 2 : 1;
  }

  function isQuestComplete(player, key) {
    const request = { player, key, complete: null };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function isQuestStarted(player, key) {
    const request = { player, key, started: null };
    api.emitCustomEvent("quest:is-started", request);
    return request.started === true;
  }

  /** Side varbits as captured; vmq3_itzla_vis is The Heart of Darkness's once it starts. */
  function syncSideVarbits(player, itzla = null) {
    const sender = player.getPacketSender();
    RECRUIT_VARBITS.forEach((varbit, group) => sender.sendVarbit(varbit, recruit(player, group)));
    sender.sendVarbit(CREST_VARBIT, stage(player) >= STAGE_RECRUIT ? 1 : 0);
    sender.sendVarbit(AZALI_VARBIT, azaliState(player));
    if (!isQuestStarted(player, HEART_OF_DARKNESS_KEY)) {
      sender.sendVarbit(ITZLA_VIS_VARBIT, itzla ?? (stage(player) >= STAGE_HQ ? 1 : 0));
    }
  }

  function variantSteps(variant) {
    return loadTranscripts(api)?.[PAGE]?.variants?.[variant] ?? [];
  }

  /** The step list holding a step id anywhere in a variant, and its index there. */
  function locate(steps, id) {
    for (let index = 0; index < steps.length; index++) {
      const step = steps[index];
      if (step?.id === id) return { list: steps, index };
      for (const nested of [step?.steps, ...(step?.options ?? []).map((option) => option.steps)]) {
        const found = Array.isArray(nested) ? locate(nested, id) : null;
        if (found) return found;
      }
    }
    return null;
  }

  function after(id) {
    return (steps) => {
      const found = locate(steps, id);
      return found ? found.list.slice(found.index + 1) : [];
    };
  }

  /** The steps after the line with this text. */
  function afterLine(text) {
    return (steps) => {
      const index = steps.findIndex((step) => (step.text ?? step.player ?? step.npc) === text);
      return index === -1 ? steps : steps.slice(index + 1);
    };
  }

  function play(player, npcId, variant, transform, npc = null) {
    startTranscript(api, player, npcId, PAGE, variant, transform, npc);
  }

  /** An item box the player cannot continue (Renu eating). */
  function heldItemBox(player, itemId, text) {
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new ActionDialogue(0, {
      execute: () => player.getPacketSender()
        .sendChatboxInterface(193)
        .sendClientScript(2868, "")
        .sendItemOnInterfaces((193 << 16) | 1, itemId, 400)
        .sendString(text, (193 << 16) | 2),
    })));
  }

  // ==========================================================================
  // Variants
  // ==========================================================================

  function selectVariant({ npcId, player, npc }) {
    if (!player) return null;
    if (npcId === FURIA_NPC_ID || npcId === ENNIUS_NPC_ID) return selectTwinsVariant(player);
    if (npcId === METZLI_NPC_ID) return selectMetzliVariant(player, npc);
    if (npcId === ITZLA_NPC_ID || npcId === SERVIUS_NPC_ID) return selectPrinceVariant(player, npc);
    if (npcId === ARRUN_NPC_ID || npcId === CLAUDIA_NPC_ID) return [V.BAZAAR, V.BAZAAR_AGAIN, V.BAZAAR_AGAIN, V.BAZAAR_DONE][recruit(player, BAZAAR)];
    if (npcId === NEL_NPC_ID) return [V.COTHON, V.COTHON_AGAIN, V.COTHON_AGAIN, V.COTHON_DONE][recruit(player, COTHON)];
    if (npcId === MEZAN_NPC_ID) return [V.MEZAN, V.MEZAN_AGAIN, V.MEZAN_DEFEATED, V.MEZAN_DONE][recruit(player, COLOSSEUM)];
    if (npcId === VELAM_NPC_ID) {
      if (recruit(player, PUB) >= 2) return V.VELAM_SOBER;
      return following(player) ? V.PUB_FOLLOWING : V.PUB;
    }
    if (npcId === AZALI_SOBER_NPC_ID) return recruit(player, PUB) >= 3 ? V.AZALI_SOBER : null;
    if (npcId === AZALI_DRUNK_NPC_ID) return recruit(player, PUB) === 0 ? V.PUB : null;
    if (npcId === REGULUS_NPC_ID) return selectRegulusVariant(player);
    return null;
  }

  function selectTwinsVariant(player) {
    const current = stage(player);
    if (current === 0) return V.TWINS_START;
    if (current < STAGE_TEMPLE) return V.TWINS_STARTED;
    if (current < STAGE_TWINS) return V.TWINS_WAIT;
    if (current === STAGE_TWINS) return V.TWINS_CREST;
    if (current < STAGE_JUDGEMENT) return V.TWINS_RECRUITING;
    if (current === STAGE_JUDGEMENT) return V.TWINS_JUDGEMENT;
    if (current === STAGE_HQ) return V.TWINS_HQ;
    if (current < STAGE_VERDICT) return V.TWINS_LETTER;
    if (current === STAGE_VERDICT) return V.TWINS_VERDICT;
    if (current === STAGE_VERDICT_DONE) return V.TWINS_VERDICT_DONE;
    return V.TWINS_REGULUS;
  }

  function atTeomat(npc) {
    return (npc?.getLocation?.()?.getX?.() ?? 9999) < 1600;
  }

  function selectMetzliVariant(player, npc) {
    const current = stage(player);
    if (atTeomat(npc)) return current >= STAGE_LIBRARY ? V.METZLI_TEOMAT : V.METZLI_TEOMAT_WAIT;
    if (current <= STAGE_TEMPLE) return V.METZLI_INTRO;
    return current === STAGE_METZLI ? V.METZLI_RETURN : V.METZLI_AGAIN;
  }

  function selectPrinceVariant(player, npc) {
    const current = stage(player);
    if (!atTeomat(npc)) {
      if (current === STAGE_CRYPT) return V.PRINCE;
      return current === STAGE_MET_PRINCE ? V.PRINCE_BACK : V.PRINCE_TWINS;
    }
    if (current >= STAGE_COMPLETE) return isQuestStarted(player, HEART_OF_DARKNESS_KEY) ? null : V.POST_QUEST;
    if (current < STAGE_FED) return V.PRINCE_EARLY;
    if (current === STAGE_FED) return V.PRINCE_TEOMAT;
    return V.PRINCE_TEOMAT_AGAIN;
  }

  function selectRegulusVariant(player) {
    const current = stage(player);
    if (current < STAGE_REGULUS) return null; // the standard quetzal keeper dialogue
    if (current === STAGE_REGULUS) return V.REGULUS;
    return current === STAGE_FEED ? V.REGULUS_AGAIN : V.REGULUS_FED;
  }

  function answerCondition(event) {
    if (!Array.isArray(event.pages) || !event.pages.some((page) => page?.page === PAGE)) return null;
    const { player } = event;
    switch (event.stepId) {
      case "Jwc6oN": case "UpukqI": case "3-gual": case "YcOYw7": case "ICTu93": case "HtVsID":
        return inventoryFull(player);
      case "zxDa7F": case "fFIaV6":
        return !inventoryFull(player);
      case "e6vbnR":
        return !held(player, CREST_ITEM_ID);
      case "CPKPtM": case "H6QjGy": case "8SXxJI": case "P67pO2":
        return !held(player, CREST_ITEM_ID);
      case "dzUYzM": case "vPKkGs": case "wdwt5t": case "8fYJOI":
        return held(player, CREST_ITEM_ID);
      case "MN8Uyn":
        return !held(player, AMULET_ITEM_ID);
      case "ufM8D1":
        return held(player, AMULET_ITEM_ID);
      case "OQXGae":
        return recruit(player, COTHON) < 2;
      case "A3sZDd":
        return recruit(player, COTHON) >= 2;
      case "1sNdXO":
        return hasPet(player);
      case "o4HOCh":
        return !hasPet(player);
      case "3coEs9":
        return false;
      case "fXNTWu":
        return held(player, LETTER_ITEM_ID);
      case "H8ndzT":
        return stage(player) < STAGE_LETTER_READ;
      // Both of Regulus's feed branches are typed "does not have"; the first is the one with it.
      case "EFAiy1":
        return held(player, FEED_ITEM_ID);
      case "NPlTJc":
        return !held(player, FEED_ITEM_ID);
      case "Al2qgC":
        return !isQuestComplete(player, GARDEN_OF_DEATH_KEY);
      case "kmDUvy":
        return isQuestComplete(player, GARDEN_OF_DEATH_KEY);
      default:
        return null;
    }
  }

  // ==========================================================================
  // Dialogue events
  // ==========================================================================

  function handleStartHook({ player, hook }) {
    if (hook !== START_HOOK || stage(player) !== 0) return;
    if (!isQuestComplete(player, CHILDREN_OF_THE_SUN_KEY)) {
      player.sendMessage("You must have completed Children of the Sun to start this quest.");
      return;
    }
    player.setAttribute(RECRUITS_ATTRIBUTE, 0);
    player.setAttribute(STAGE_VERSION_ATTRIBUTE, STAGE_VERSION);
    quest.setStage(player, STAGE_STARTED);
    player.sendMessage("You've started a new quest: <col=081190>Twilight's Promise</col>");
  }

  function handleChoice({ player, npcId, option }) {
    if (npcId === MEZAN_NPC_ID && option === "I'm ready. Let's do this.") player.__tpMezanReady = true;
  }

  /** Line events fire as a run of lines is queued, so a change made as a line shows goes in `before`. */
  function handleLine(event) {
    const { player, npcId } = event;
    const text = event.step?.text ?? event.step?.player ?? event.step?.npc ?? event.text;
    // The stage is read as the line shows: a run of lines is queued before its first one plays.
    const at = (line, minStage, maxStage, action) => {
      if (text !== line) return;
      const previous = event.before;
      event.before = () => {
        previous?.();
        const now = stage(player);
        if (now >= minStage && now <= maxStage) action();
      };
    };
    at(LINES.TEMPLE, STAGE_STARTED, STAGE_STARTED, () => advance(player, STAGE_TEMPLE));
    at(LINES.METZLI_MET, STAGE_TEMPLE, STAGE_TEMPLE, () => advance(player, STAGE_METZLI));
    at(LINES.CRYPT, STAGE_TEMPLE, STAGE_METZLI, () => advance(player, STAGE_CRYPT));
    at(LINES.MET_PRINCE, STAGE_CRYPT, STAGE_CRYPT, () => advance(player, STAGE_MET_PRINCE));
    at(LINES.TWINS, STAGE_MET_PRINCE, STAGE_MET_PRINCE, () => advance(player, STAGE_TWINS));
    at(LINES.BAZAAR_ASKED, STAGE_RECRUIT, STAGE_JUDGEMENT, () => recruit(player, BAZAAR) === 0 && setRecruit(player, BAZAAR, 1));
    at(LINES.COTHON_ASKED, STAGE_RECRUIT, STAGE_JUDGEMENT, () => recruit(player, COTHON) === 0 && setRecruit(player, COTHON, 1));
    if (text === "Great!" && npcId === NEL_NPC_ID) at("Great!", STAGE_RECRUIT, STAGE_JUDGEMENT, () => recruit(player, COTHON) === 2 && setRecruit(player, COTHON, 3));
    at(LINES.PUB_ASKED, STAGE_RECRUIT, STAGE_JUDGEMENT, () => recruit(player, PUB) === 0 && setRecruit(player, PUB, 1));
    if (text === LINES.AZALI_COMES) event.before = () => recruit(player, PUB) === 1 && startFollowing(player, event.npc);
    at(LINES.PUB_DONE, STAGE_RECRUIT, STAGE_JUDGEMENT, () => recruit(player, PUB) === 2 && setRecruit(player, PUB, 3));
    at(LINES.MEZAN_ASKED, STAGE_RECRUIT, STAGE_JUDGEMENT, () => recruit(player, COLOSSEUM) === 0 && setRecruit(player, COLOSSEUM, 1));
    if (text === LINES.MEZAN_READY && npcId === MEZAN_NPC_ID && player.__tpMezanReady) {
      player.__tpMezanReady = false;
      event.after = () => beginMezanFight(player);
    }
    if (text === "Perfect! Thanks." && npcId === MEZAN_NPC_ID) {
      at(text, STAGE_RECRUIT, STAGE_JUDGEMENT, () => recruit(player, COLOSSEUM) === 2 && setRecruit(player, COLOSSEUM, 3));
    }
    at(LINES.HQ, STAGE_JUDGEMENT, STAGE_JUDGEMENT, () => {
      if (held(player, CREST_ITEM_ID)) player.getInventory().deleteNumber(CREST_ITEM_ID, 1);
      advance(player, STAGE_HQ);
    });
    at(LINES.VERDICT, STAGE_LETTER_READ, STAGE_LETTER_READ, () => advance(player, STAGE_VERDICT));
    at(LINES.REGULUS, STAGE_VERDICT_DONE, STAGE_VERDICT_DONE, () => advance(player, STAGE_REGULUS));
    at(LINES.TEOMAT, STAGE_FED, STAGE_FED, () => advance(player, STAGE_TEOMAT));
    at(LINES.LIBRARY, STAGE_TEOMAT, STAGE_TEOMAT, () => advance(player, STAGE_LIBRARY));
    at(LINES.BATTLE, STAGE_LIBRARY, STAGE_LIBRARY, () => advance(player, STAGE_BATTLE));
    if (text === LINES.CALL_OUT) event.after = () => stage(player) === STAGE_BATTLE && beginBattle(player);
    at(LINES.COMPLETE, STAGE_GUARD_LEFT, STAGE_GUARD_LEFT, () => quest.complete(player));
  }

  const MESSAGE_BOXES = {
    Ev2lHZ: CREST_ITEM_ID, wqRY6L: CREST_ITEM_ID, xxd9qj: CREST_ITEM_ID,
    o6WA7o: CREST_ITEM_ID, "MvE-PO": CREST_ITEM_ID, IsCa0z: CREST_ITEM_ID, ZdVwjS: CREST_ITEM_ID,
    D0l_R6: AMULET_ITEM_ID, VgHiDe: AMULET_ITEM_ID,
    ibPuw6: WEAPON_BOX_ITEMS,
    nUVL01: LETTER_ITEM_ID,
    "00eVwW": null,
    V6x6Qr: FEED_ITEM_ID, "2fRkv2": FEED_ITEM_ID,
  };

  function isQuestEvent(event) {
    return Array.isArray(event.pages) && event.pages.some((page) => page?.page === PAGE);
  }

  function handleAction(event) {
    if (!isQuestEvent(event)) return;
    const { player, stepId } = event;
    if (event.kind === "message" && Object.hasOwn(MESSAGE_BOXES, stepId)) {
      const items = MESSAGE_BOXES[stepId];
      event.handled = true;
      event.box = items === null ? { statement: true } : { items: Array.isArray(items) ? items : [items] };
    }
    if (STEP.CREST.has(stepId)) {
      if (!held(player, CREST_ITEM_ID)) player.getInventory().adds(CREST_ITEM_ID, 1);
      advance(player, STAGE_RECRUIT);
      return;
    }
    switch (stepId) {
      case STEP.AMULET_FOUND:
        if (!held(player, AMULET_ITEM_ID)) {
          if (inventoryFull(player)) return;
          player.getInventory().adds(AMULET_ITEM_ID, 1);
          if (!held(player, AMULET_ITEM_ID)) return;
        }
        setRecruit(player, BAZAAR, 2);
        return;
      case STEP.AMULET_GIVEN:
        if (held(player, AMULET_ITEM_ID)) player.getInventory().deleteNumber(AMULET_ITEM_ID, 1);
        setRecruit(player, BAZAAR, 3);
        return;
      case STEP.WEAPONS:
        if (recruit(player, COTHON) === 1) setRecruit(player, COTHON, 2);
        return;
      case STEP.AZALI_FOLLOWS:
        startFollowing(player, event.npc);
        return;
      case STEP.LETTER:
        if (!held(player, LETTER_ITEM_ID)) player.getInventory().adds(LETTER_ITEM_ID, 1);
        advance(player, STAGE_LETTER);
        return;
      case STEP.VELAM_STEPS:
      case STEP.VELAM_KILLED:
      case STEP.KNIGHTS_LEAVE:
      case STEP.GUARD_LEAVES:
        event.handled = true;
        event.end = true;
        verdictOrAftermathCue(player, stepId);
        return;
      case STEP.RENU_FED:
        event.handled = true;
        event.end = true;
        feedRenu(player, event.npc);
        return;
      case STEP.OPEN_MAP:
        event.handled = true;
        event.end = true;
        api.emitCustomEvent("quetzal:open", { player });
        return;
      case STEP.COMPLETE:
        event.handled = true;
        return;
      default:
        break;
    }
    if (STEP.FEED.has(stepId)) {
      if (!held(player, FEED_ITEM_ID)) player.getInventory().adds(FEED_ITEM_ID, 1);
      advance(player, STAGE_FEED);
      api.emitCustomEvent("quetzal:introduce", { player });
      return;
    }
    if (STEP.VERDICT.has(stepId)) {
      event.handled = true;
      event.end = true;
      beginVerdict(player);
      return;
    }
    if (stepId === STEP.AFTERMATH) {
      event.handled = true;
      event.end = true;
      beginAftermath(player);
    }
  }

  // ==========================================================================
  // The crest's errands: the bazaar, the Cothon and the Kualti Headquarters
  // ==========================================================================

  /** The man in blue: two ticks of "You attempt..." then the amulet. */
  function pickpocketCitizen(event) {
    if (event.npcId !== CITIZEN_NPC_ID) return false;
    const { player } = event;
    const bazaarState = recruit(player, BAZAAR);
    if ((bazaarState !== 1 && bazaarState !== 2) || held(player, AMULET_ITEM_ID)) return false;
    if (inventoryFull(player)) {
      event.handled = true;
      player.sendMessage("You need an open inventory space to take the stolen amulet.");
      return true;
    }
    event.handled = true;
    player.sendMessage("You attempt to pick the man's pocket.");
    Scenes.later(player, 1, () => {
      player.sendMessage("You pick the man's pocket and find the stolen amulet.");
      play(player, CITIZEN_NPC_ID, V.BAZAAR_PICKPOCKET, null, event.npc);
    });
    return true;
  }

  function searchCrate(event) {
    const id = event.definition?.id ?? event.objectId;
    if (id !== CRATE_OBJECT_ID && id !== CRATES_OBJECT_ID) return false;
    const { player } = event;
    if (stage(player) < STAGE_RECRUIT || stage(player) >= STAGE_HQ) return false;
    event.handled = true;
    const plural = id === CRATES_OBJECT_ID;
    const location = event.location ?? event.object?.getLocation?.();
    const x = location?.x ?? location?.getX?.();
    const y = location?.y ?? location?.getY?.();
    const correct = !plural && x === WEAPON_CRATE_TILE.x && y === WEAPON_CRATE_TILE.y;
    const progress = recruit(player, COTHON);
    let variant;
    if (progress >= 2) variant = plural ? V.COTHON_ANY_PLURAL : V.COTHON_ANY;
    else if (!correct) variant = plural ? V.COTHON_WRONG_PLURAL : V.COTHON_WRONG;
    else variant = progress === 0 ? V.COTHON_BEFORE : V.COTHON_FOUND;
    play(player, NEL_NPC_ID, variant);
    return true;
  }

  function letterChest(player) {
    let chest = player.getAttribute(LETTER_CHEST_ATTRIBUTE);
    if (!LETTER_CHEST_IDS.includes(chest)) {
      chest = LETTER_CHEST_IDS[Math.floor(Math.random() * LETTER_CHEST_IDS.length)];
      player.setAttribute(LETTER_CHEST_ATTRIBUTE, chest);
    }
    return chest;
  }

  /** The letter's chest opens for two ticks as it is searched (equal odds of either south-eastern chest). */
  function openChest(event) {
    const id = event.definition?.id ?? event.objectId;
    if (!CHEST_OBJECT_IDS.includes(id)) return false;
    event.handled = true;
    const { player } = event;
    const current = stage(player);
    if (current !== STAGE_HQ && !(current >= STAGE_LETTER && current < STAGE_VERDICT_DONE) || id !== letterChest(player)) {
      play(player, ENNIUS_NPC_ID, V.CHEST_WRONG);
      return true;
    }
    const object = event.object;
    if (current === STAGE_HQ && !inventoryFull(player) && object) {
      const location = object.getLocation();
      const sender = player.getPacketSender();
      sender.sendObject(new GameObject(OPEN_CHEST_OBJECT_ID, location.clone(), object.getType(), object.getFace(), null));
      Scenes.later(player, CHEST_OPEN_TICKS, () => sender.sendObject(new GameObject(id, location.clone(), object.getType(), object.getFace(), null)));
    }
    play(player, ENNIUS_NPC_ID, V.CHEST);
    return true;
  }

  /** The letter in its paper; the first read is what the twins wait for. */
  function readLetter(event) {
    const { player } = event;
    event.handled = true;
    const sender = player.getPacketSender();
    for (let child = 5; child <= 16; child++) sender.sendString(LETTER_LINES[child] ?? "", (LETTER_INTERFACE << 16) | child);
    if (stage(player) === STAGE_LETTER) advance(player, STAGE_LETTER_READ);
    sender.sendInterface(LETTER_INTERFACE);
    return true;
  }

  /** The crypt gate lets the player through and shuts behind them, as captured. */
  function handleGate(request) {
    if (request.handled || request.objectId !== GATE_OBJECT_ID) return;
    const { player, object } = request;
    const location = object?.getLocation?.();
    if (!location || location.getX() !== GATE_TILE.x || location.getY() !== GATE_TILE.y) return;
    request.handled = true;
    if (stage(player) < STAGE_CRYPT) {
      play(player, ENNIUS_NPC_ID, V.GATE_LOCKED);
      return;
    }
    const crossing = crossingFor(object, player.getLocation());
    if (!crossing || ObstacleRunner.isBusy(player)) return;
    const sender = player.getPacketSender();
    const open = new GameObject(GATE_OPEN_OBJECT_ID, new Location(location.getX(), location.getY() - 1, location.getZ()), 0, 0, null);
    sender.sendObject(open).sendObject(new GameObject(GATEWAY_OBJECT_ID, location.clone(), 0, object.getFace(), null));
    ObstacleRunner.run({ player, object }, [{ walk: [[crossing.destination.x, crossing.destination.y]] }]);
    Scenes.later(player, 2, () => {
      sender.sendObjectRemoval(open).sendObject(new GameObject(GATE_OBJECT_ID, location.clone(), 0, object.getFace(), null));
    });
  }

  function openGate(event) {
    const request = { player: event.player, object: event.object, objectId: event.definition?.id ?? event.objectId, handled: false };
    handleGate(request);
    if (request.handled) event.handled = true;
    return request.handled;
  }

  // ==========================================================================
  // Azali's escort to the fountain
  // ==========================================================================

  function hasPet(player) {
    return player.getAttribute?.("pets:current")?.isRegistered?.() === true;
  }

  function following(player) {
    return followers.get(player)?.npc?.isRegistered?.() === true;
  }

  /** Azali leaves the pub and follows; she rests now and then, and gives up on a runaway. */
  function startFollowing(player, from) {
    if (hasPet(player) || recruit(player, PUB) !== 1) return;
    let entry = followers.get(player);
    if (!entry?.npc?.isRegistered?.()) {
      // She leaves from her seat at the pub, wherever the conversation was had.
      const at = from?.getId?.() === AZALI_PUB_ROOT_ID || from?.getContentId?.(player) === AZALI_DRUNK_NPC_ID ? from.getLocation() : new Location(...AZALI_PUB_TILE, 0);
      const npc = api.spawnNpc({ id: AZALI_FOLLOWER_ROOT_ID, x: at.getX(), y: at.getY(), z: at.getZ(), owner: player, ownerOnly: true, wanderRadius: 0 });
      if (!npc) return;
      npc.__skipDefaultRespawn = true;
      entry = { npc, restIn: restTicks() };
      followers.set(player, entry);
    }
    entry.resting = false;
    entry.restIn = restTicks();
    entry.npc.setFollowing(player);
    entry.npc.setMobileInteraction(player);
    syncSideVarbits(player);
  }

  function restTicks() {
    return FOLLOW_REST_MIN_TICKS + Math.floor(Math.random() * (FOLLOW_REST_MAX_TICKS - FOLLOW_REST_MIN_TICKS + 1));
  }

  function stopFollowing(player, toPub) {
    const entry = followers.get(player);
    if (!entry) return;
    followers.delete(player);
    if (entry.npc?.isRegistered?.()) api.removeNpc(entry.npc);
    if (toPub) syncSideVarbits(player);
  }

  function tickFollower(player) {
    const entry = followers.get(player);
    if (!entry?.npc?.isRegistered?.() || entry.leaving) return;
    const npc = entry.npc;
    const distance = npc.getLocation().getDistance?.(player.getLocation())
      ?? Math.max(Math.abs(npc.getLocation().getX() - player.getLocation().getX()), Math.abs(npc.getLocation().getY() - player.getLocation().getY()));
    // As captured: the call, the follower gone three ticks later and Azali back at the pub three after that.
    if (distance > FOLLOW_STRAY_DISTANCE || npc.getLocation().getZ() !== player.getLocation().getZ()) {
      entry.leaving = true;
      npc.setFollowing(null);
      npc.forceChat("Hey! You're going too fast!");
      Scenes.later(player, 3, () => { if (followers.get(player) === entry) api.removeNpc(npc); });
      Scenes.later(player, 6, () => { if (followers.get(player) === entry) stopFollowing(player, true); });
      return;
    }
    const tile = npc.getLocation();
    if (Math.max(Math.abs(tile.getX() - FOUNTAIN_TILE[0]), Math.abs(tile.getY() - FOUNTAIN_TILE[1])) <= FOUNTAIN_REACH) {
      beginFountain(player);
      return;
    }
    if (entry.resting) return;
    if (--entry.restIn > 0) return;
    entry.resting = true;
    npc.setFollowing(null);
    npc.getMovementQueue().reset();
    const lines = variantSteps(V.AZALI_RESTS)[0]?.options ?? [];
    const said = lines[Math.floor(Math.random() * lines.length)]?.steps?.[0]?.text;
    if (said) npc.forceChat(said);
  }

  /** The follower answers "This way, Azali." and comes along again. */
  function talkToFollower(event) {
    const entry = followers.get(event.player);
    if (!entry || event.npc !== entry.npc) return false;
    event.handled = true;
    play(event.player, AZALI_DRUNK_NPC_ID, V.AZALI_FOLLOWING, null, event.npc);
    return true;
  }

  /** Azali at the pub after straying: "Azali, come with me." */
  function talkToAzaliAtPub(event) {
    if (event.npcId !== AZALI_DRUNK_NPC_ID || followers.get(event.player)?.npc === event.npc) return false;
    const { player } = event;
    if (recruit(player, PUB) !== 1) return false;
    event.handled = true;
    play(player, AZALI_DRUNK_NPC_ID, V.PUB, (steps) => {
      const offer = locate(steps, "8fYJOI")?.list?.[locate(steps, "8fYJOI").index]?.steps ?? [];
      const condition = offer.findIndex((step) => step.id === "1sNdXO");
      return [{ player: "Azali, come with me." }, ...offer.slice(condition)];
    }, event.npc);
    return true;
  }

  /** Some of the twins' variants are missing from the index for one sibling or the other. */
  function talkToTwins(event) {
    const { player, npcId } = event;
    if (npcId !== FURIA_NPC_ID && npcId !== ENNIUS_NPC_ID) return false;
    if (stage(player) >= STAGE_TEOMAT) return false;
    event.handled = true;
    play(player, npcId, selectTwinsVariant(player), null, event.npc);
    return true;
  }

  /** The quest's resolved knight ids are not indexed, so answer their Talk-to from here. */
  function talkToKnight(event) {
    if (talkToFollower(event) || talkToAzaliAtPub(event) || talkToSoberAzali(event)) return true;
    const { player, npcId } = event;
    if (!KNIGHT_CONTENT_IDS.includes(npcId)) return false;
    const variant = selectVariant({ player, npcId, npc: event.npc });
    if (!variant) return false;
    event.handled = true;
    play(player, npcId, variant, null, event.npc);
    return true;
  }

  /** Sober Azali before her answer: the dunk's tail, from "Oh boy...". */
  function talkToSoberAzali(event) {
    if (event.npcId !== AZALI_SOBER_NPC_ID || recruit(event.player, PUB) !== 2) return false;
    event.handled = true;
    play(event.player, AZALI_SOBER_NPC_ID, V.AZALI_FOUNTAIN, after(STEP.DUNK), event.npc);
    return true;
  }

  /** The dunk: Azali walks into the fountain, the splash, and her answer back at the fountain. */
  function beginFountain(player) {
    if (Scenes.get(player)) return;
    stopFollowing(player, false);
    Scenes.hold(player);
    Scenes.fade(player, true);
    Scenes.controls(player, true, true);
    Scenes.later(player, 2, () => {
      const scene = Scenes.open(player, "fountain", FOUNTAIN_BOUNDS);
      Scenes.controls(player, true, true);
      player.moveTo(new Location(1756, 3070, 0));
      Scenes.face(player, [1757, 3069]);
      syncSideVarbits(player);
      const azali = Scenes.actor(scene, AZALI_ACTOR_ID, [1753, 3068], [1755, 3068]);
      const fountain = Scenes.actor(scene, FOUNTAIN_ACTOR_ID, [1757, 3068], [1787, 3069]);
      Scenes.loc(scene, { id: 29733, x: 1757, y: 3068 });
      Scenes.loc(scene, { id: 52870, x: 1757, y: 3069, type: 22 });
      Scenes.later(scene, 1, () => Scenes.camera(player, [1760, 3060, 650], [1757, 3072, 350]));
      Scenes.later(scene, 3, () => {
        Scenes.fade(player, false);
        azali?.getMovementQueue().addSteps(new Location(1755, 3068, 0));
      });
      Scenes.later(scene, 5, () => azali?.moveTo(new Location(1757, 3068, 0)));
      Scenes.later(scene, 7, () => {
        fountain?.performAnimation(new Animation(FOUNTAIN_SPLASH_ANIMATION));
        if (azali) Scenes.removeActor(scene, azali);
      });
      Scenes.later(scene, 15, () => {
        setRecruit(player, PUB, 2);
        Scenes.fade(player, true);
      });
      Scenes.later(scene, 17, () => {
        Scenes.end(player, false);
        player.moveTo(new Location(1756, 3070, 0));
        Scenes.face(player, [1756, 3069]);
        Scenes.controls(player, true, true);
        Scenes.later(player, 2, () => Scenes.fade(player, false));
        Scenes.later(player, 4, () => {
          Scenes.controls(player, false);
          Scenes.closeFade(player);
          play(player, AZALI_SOBER_NPC_ID, V.AZALI_FOUNTAIN, after(STEP.DUNK));
        });
      });
    });
  }

  // ==========================================================================
  // Mezan's sparring match
  // ==========================================================================

  function beginMezanFight(player) {
    if (Scenes.get(player) || recruit(player, COLOSSEUM) !== 1) return;
    Scenes.hold(player);
    Scenes.fade(player, true);
    Scenes.controls(player, true);
    Scenes.later(player, 2, () => {
      player.getDialogueManager().reset();
      const scene = Scenes.open(player, "mezan", ARENA_BOUNDS, { canAttack: canAttackInArena });
      player.moveTo(new Location(1824, 3102, 0));
      Scenes.face(player, [1824, 3103]);
      scene.mezan = Scenes.actor(scene, MEZAN_FIGHTER_ID, [1824, 3108], [1824, 3102]);
      Scenes.loc(scene, { id: 50872, x: 1823, y: 3091, face: 1 });
      mezanStreaks.delete(scene.mezan);
      Scenes.later(scene, 2, () => {
        Scenes.fade(player, false);
        Scenes.controls(player, false);
      });
      Scenes.later(scene, 4, () => Scenes.closeFade(player));
    });
  }

  function canAttackInArena(attacker, target) {
    const scene = Scenes.get(attacker?.isPlayer?.() ? attacker : target?.isPlayer?.() ? target : null);
    if (!scene || scene.name !== "mezan") return null;
    return target === scene.mezan || attacker === scene.mezan ? (scene.defeated ? false : true) : null;
  }

  function styleOf(hit) {
    const { CombatType } = api.core;
    const type = hit?.getCombatType?.();
    if (type === CombatType.MELEE) return "melee";
    if (type === CombatType.RANGED) return "ranged";
    if (type === CombatType.MAGIC) return "magic";
    return null;
  }

  const PROTECTIONS = { melee: "PROTECT_FROM_MELEE", ranged: "PROTECT_FROM_MISSILES", magic: "PROTECT_FROM_MAGIC" };

  function nullify(hit) {
    for (const part of hit.getHits()) part.setDamage(0);
    hit.updateTotalDamage();
  }

  /** Each attack counts toward a streak; the fourth in a style has him pray against it next tick. */
  function countMezanAttack({ player, target, hit }) {
    const scene = Scenes.get(player);
    if (!scene || target !== scene.mezan || scene.defeated) return;
    const style = styleOf(hit);
    if (!style) return;
    if (scene.mezan.__tpProtecting === style) {
      nullify(hit);
      return;
    }
    const streak = mezanStreaks.get(scene.mezan) ?? { style: null, count: 0 };
    streak.count = streak.style === style ? streak.count + 1 : 1;
    streak.style = style;
    mezanStreaks.set(scene.mezan, streak);
    if (streak.count < MEZAN_PRAYER_STREAK) return;
    streak.count = 0;
    Scenes.later(scene, 1, () => {
      if (scene.defeated) return;
      const npc = scene.mezan;
      PrayerHandler.activatePrayerPrayerId(npc, PrayerHandler[PROTECTIONS[style]]);
      npc.__tpProtecting = style;
      npc.forceChat(MEZAN_PRAYER_LINES[Math.floor(Math.random() * MEZAN_PRAYER_LINES.length)]);
    });
  }

  function blockMezanHit({ npc, hit }) {
    if (!npc?.__tpProtecting || npc.getId() !== MEZAN_FIGHTER_ID) return;
    if (styleOf(hit) === npc.__tpProtecting && !hit.bypassesProtectionPrayer?.()) nullify(hit);
  }

  /** He falls without dying: the done knight, then back to the lobby for his answer. */
  function keepMezanStanding(event) {
    const npc = event.npc;
    const player = npc?.__questSceneOwner;
    const scene = player ? Scenes.get(player) : null;
    if (!scene || scene.mezan !== npc) return;
    event.preventDeath = true;
    if (scene.defeated) return;
    scene.defeated = true;
    npc.getCombat().reset?.();
    player.getCombat().reset?.();
    PrayerHandler.deactivatePrayers?.(npc);
    Scenes.later(scene, 1, () => npc.setNpcTransformationId?.(MEZAN_DONE_ID));
    Scenes.later(scene, 2, () => {
      setRecruit(player, COLOSSEUM, 2);
      Scenes.fade(player, true);
      Scenes.controls(player, true);
    });
    Scenes.later(scene, 4, () => {
      Scenes.end(player, false);
      player.moveTo(new Location(...COLOSSEUM_LOBBY_TILE));
      Scenes.controls(player, true);
      Scenes.later(player, 2, () => Scenes.fade(player, false));
      Scenes.later(player, 4, () => {
        Scenes.controls(player, false);
        Scenes.closeFade(player);
        play(player, MEZAN_NPC_ID, V.MEZAN_DEFEATED);
      });
    });
  }

  function leaveArena(event) {
    const { player } = event;
    if (Scenes.get(player)?.name !== "mezan") return false;
    event.handled = true;
    Scenes.end(player, false);
    player.moveTo(new Location(...COLOSSEUM_LOBBY_TILE));
    return true;
  }

  // ==========================================================================
  // The judgement
  // ==========================================================================

  function beginVerdict(player) {
    if (Scenes.get(player)) return;
    advance(player, STAGE_VERDICT);
    Scenes.hold(player);
    Scenes.fade(player, true);
    Scenes.controls(player, true, true);
    Scenes.later(player, 2, () => {
      const scene = Scenes.open(player, "verdict", PALACE_BOUNDS);
      Scenes.controls(player, true, true);
      player.moveTo(new Location(1684, 3157, 0));
      Scenes.face(player, [1680, 3159]);
      scene.knights = KNIGHT_ACTORS.map((id, index) =>
        Scenes.actor(scene, id, [1677, 3156 + index], [1679, 3156 + index]));
      scene.velam = scene.knights[KNIGHT_ACTORS.indexOf(VELAM_ACTOR_ID)];
      scene.furia = Scenes.actor(scene, FURIA_ACTOR_ID, [1684, 3156], [1686, 3158]);
      scene.ennius = Scenes.actor(scene, ENNIUS_ACTOR_ID, [1682, 3156], [1684, 3156]);
      Scenes.later(scene, 1, () => Scenes.camera(player, [1684, 3161, 420], [1671, 3156, 220]));
      Scenes.later(scene, 2, () => Scenes.fade(player, false));
      Scenes.later(scene, 6, () => scene.ennius && Scenes.face(scene.ennius, [1676, 3158]));
      Scenes.later(scene, 7, () => play(player, ENNIUS_NPC_ID, V.TWINS_LETTER, after("yqVhSV")));
    });
  }

  /** The cutscene's narrated beats, played on the capture's ticks before the lines go on. */
  function verdictOrAftermathCue(player, stepId) {
    const scene = Scenes.get(player);
    if (!scene) {
      // Replayed without its scene (after a relog): the guard has gone, the Prince goes on.
      if (stepId === STEP.GUARD_LEAVES) {
        advance(player, STAGE_GUARD_LEFT);
        play(player, ITZLA_NPC_ID, V.AFTER_CULTISTS, after(STEP.GUARD_LEAVES));
      }
      return;
    }
    Scenes.hold(player);
    if (stepId === STEP.VELAM_STEPS) {
      scene.velam?.getMovementQueue().addSteps(new Location(1679, 3159, 0));
      Scenes.later(scene, 2, () => scene.velam && Scenes.face(scene.velam, [1679, 3149]));
      Scenes.later(scene, 3, () => play(player, ENNIUS_NPC_ID, V.TWINS_LETTER, after(STEP.VELAM_STEPS)));
      return;
    }
    if (stepId === STEP.VELAM_KILLED) {
      scene.ennius?.performAnimation(new Animation(ENNIUS_STRIKE_ANIMATION));
      Scenes.later(scene, 1, () => {
        scene.velam?.performAnimation(new Animation(VELAM_FALL_ANIMATION));
        scene.velam?.showHitsplat?.(VELAM_DAMAGE, { mine: 17, others: 17 }, { current: 0, max: VELAM_DAMAGE });
      });
      Scenes.later(scene, 4, () => scene.velam && Scenes.removeActor(scene, scene.velam));
      Scenes.later(scene, 6, () => scene.ennius && Scenes.face(scene.ennius, [1675, 3159]));
      Scenes.later(scene, 7, () => play(player, ENNIUS_NPC_ID, V.TWINS_LETTER, after(STEP.VELAM_KILLED)));
      return;
    }
    if (stepId === STEP.KNIGHTS_LEAVE) {
      // As captured: up the line to its first knight's tile, east, then out to the south.
      for (const knight of scene.knights.filter((npc) => npc && npc !== scene.velam)) {
        for (const [x, y] of [[1677, 3156], [1680, 3156], [1681, 3150]]) knight.getMovementQueue().addSteps(new Location(x, y, 0));
      }
      Scenes.later(scene, 3, () => {
        advance(player, STAGE_VERDICT_DONE);
        if (held(player, LETTER_ITEM_ID)) player.getInventory().deleteNumber(LETTER_ITEM_ID, 1);
        Scenes.fade(player, true);
      });
      Scenes.later(scene, 5, () => {
        Scenes.end(player, false);
        player.moveTo(new Location(1683, 3156, 0));
        Scenes.face(player, [1684, 3156]);
        Scenes.controls(player, true, true);
        Scenes.later(player, 2, () => Scenes.fade(player, false));
        Scenes.later(player, 4, () => {
          Scenes.controls(player, false);
          Scenes.closeFade(player);
          play(player, ENNIUS_NPC_ID, V.TWINS_LETTER, after(STEP.KNIGHTS_LEAVE));
        });
      });
      return;
    }
    if (stepId === STEP.GUARD_LEAVES) {
      advance(player, STAGE_GUARD_LEFT);
      syncSideVarbits(player, 1);
      Scenes.fade(player, true);
      Scenes.later(scene, 2, () => {
        Scenes.end(player, false);
        player.moveTo(new Location(1453, 3173, 0));
        Scenes.face(player, [1454, 3173]);
        Scenes.controls(player, true, true);
        Scenes.later(player, 2, () => Scenes.fade(player, false));
        Scenes.later(player, 4, () => {
          Scenes.controls(player, false);
          Scenes.closeFade(player);
          play(player, ITZLA_NPC_ID, V.AFTER_CULTISTS, after(STEP.GUARD_LEAVES));
        });
      });
    }
  }

  // ==========================================================================
  // Renu and the Teomat
  // ==========================================================================

  /** Feeding Renu: she eats (the box can't be continued), and nine ticks later takes it. */
  function feedRenu(player, renu) {
    if (!held(player, FEED_ITEM_ID)) return;
    const text = "Renu eagerly takes the feed from you.";
    player.performAnimation(new Animation(RENU_FEED_PLAYER_ANIMATION));
    renu?.performAnimation?.(new Animation(RENU_FEED_ANIMATION));
    heldItemBox(player, FEED_ITEM_ID, text);
    Scenes.later(player, RENU_FEED_TICKS, () => {
      if (held(player, FEED_ITEM_ID)) player.getInventory().deleteNumber(FEED_ITEM_ID, 1);
      advance(player, STAGE_FED);
      api.emitCustomEvent("quetzal:unlock", { player });
      play(player, REGULUS_NPC_ID, V.REGULUS_AGAIN, (steps) => [
        { type: "message", text, id: "renu-fed-box" },
        ...after(STEP.RENU_FED)(steps),
      ]);
    });
  }

  const FED_BOX_STEP = "renu-fed-box";

  function handleFedBox(event) {
    if (event.stepId !== FED_BOX_STEP) return;
    event.handled = true;
    event.box = { items: [FEED_ITEM_ID] };
  }

  function talkToRenu(event) {
    const { player } = event;
    if (event.npcId !== RENU_FEED_NPC_ID || stage(player) !== STAGE_FEED) return false;
    event.handled = true;
    if (!held(player, FEED_ITEM_ID)) {
      player.sendMessage("Renu looks at you hungrily.");
      return true;
    }
    play(player, REGULUS_NPC_ID, V.REGULUS_AGAIN, after(STEP.FEED_TAIL), event.npc);
    return true;
  }

  function feedOnRenu(event) {
    if (event.itemId !== FEED_ITEM_ID || (event.npcId ?? event.target?.getId?.()) !== RENU_FEED_NPC_ID) return;
    return talkToRenu({ ...event, npcId: RENU_FEED_NPC_ID, npc: event.target ?? event.npc, handled: false }) && (event.handled = true);
  }

  /**
   * The Prince, mid-quest at the Teomat: the battle and its aftermath come back where they
   * stopped. The resolved Itzla/Servius ids are not in npc-dialogue-index.json, so their
   * crypt, conversation and post-quest variants are selected here as well.
   */
  function talkToPrince(event) {
    const { player, npcId } = event;
    if (npcId !== ITZLA_NPC_ID && npcId !== SERVIUS_NPC_ID) return false;
    const current = stage(player);
    if (npcId === ITZLA_NPC_ID && atTeomat(event.npc)) {
      if (current === STAGE_TEOMAT) {
        event.handled = true;
        play(player, ITZLA_NPC_ID, V.PRINCE_TEOMAT, afterLine(LINES.TEOMAT), event.npc);
        return true;
      }
      if (current === STAGE_BATTLE) {
        event.handled = true;
        beginBattle(player);
        return true;
      }
      if (current === STAGE_AFTERMATH) {
        event.handled = true;
        beginAftermath(player);
        return true;
      }
      if (current === STAGE_GUARD_LEFT) {
        event.handled = true;
        play(player, ITZLA_NPC_ID, V.AFTER_GUARD, null, event.npc);
        return true;
      }
    }
    const variant = selectVariant({ player, npcId, npc: event.npc });
    if (!variant) return false;
    event.handled = true;
    play(player, npcId, variant, null, event.npc);
    return true;
  }

  function talkToTeomatMetzli(event) {
    if (event.npcId !== METZLI_NPC_ID || !atTeomat(event.npc) || stage(event.player) !== STAGE_BATTLE) return false;
    event.handled = true;
    beginBattle(event.player);
    return true;
  }

  // ==========================================================================
  // The cultist attack
  // ==========================================================================

  function beginBattle(player) {
    if (Scenes.get(player) || stage(player) !== STAGE_BATTLE) return;
    Scenes.hold(player);
    Scenes.fade(player, true);
    Scenes.controls(player, true);
    Scenes.later(player, 2, () => {
      player.getDialogueManager().reset();
      const scene = Scenes.open(player, "battle", TEOMAT_BOUNDS, { multi: true, canAttack: canAttackInBattle });
      scene.kills = 0;
      player.moveTo(new Location(1441, 3179, 0));
      Scenes.face(player, [1441, 3178]);
      scene.guards = BATTLE_GUARDS.map(({ id, tile, face }) => Scenes.actor(scene, id, tile, face));
      scene.itzla = Scenes.actor(scene, ITZLA_FIGHTER_ID, [1444, 3174], [1444, 3172]);
      Scenes.actor(scene, SERVIUS_BATTLE_ID, [1453, 3172], [1453, 3177]);
      Scenes.actor(scene, METZLI_BATTLE_ID, [1449, 3195], [1449, 3194]);
      scene.cultists = BATTLE_CULTISTS.map((entry) => {
        const npc = Scenes.actor(scene, entry.id, entry.tile, entry.face);
        if (npc) npc.__tpPartner = entry.partner === "itzla" ? scene.itzla : scene.guards[entry.partner] ?? null;
        return npc;
      });
      for (const loc of BATTLE_LOCS) Scenes.loc(scene, loc);
      Scenes.later(scene, 1, () => {
        const attacker = scene.cultists[BATTLE_CULTISTS.findIndex((entry) => entry.player)];
        attacker?.getCombat().attack(player);
      });
      Scenes.later(scene, 2, () => {
        Scenes.fade(player, false);
        Scenes.controls(player, false);
      });
      Scenes.later(scene, 4, () => Scenes.closeFade(player));
      spar(player, scene, 0);
    });
  }

  function canAttackInBattle(attacker, target) {
    const player = attacker?.isPlayer?.() ? attacker : target?.isPlayer?.() ? target : null;
    const scene = player ? Scenes.get(player) : null;
    if (!scene || scene.name !== "battle") return null;
    const npc = attacker === player ? target : attacker;
    return scene.cultists.includes(npc) ? true : false;
  }

  // shortcut: allied sparring is cosmetic; add allied kills when this scene has captured NPC combat rules.
  function spar(player, scene, beat) {
    Scenes.later(scene, SPAR_TICKS / 2, () => {
      if (Scenes.get(player) !== scene) return;
      for (const cultist of scene.cultists) {
        const partner = cultist?.__tpPartner;
        if (!cultist?.isRegistered?.() || (cultist.getHitpoints?.() ?? 1) <= 0 || !partner?.isRegistered?.()) continue;
        if (cultist.getCombat().getTarget?.()) continue;
        const itzla = partner === scene.itzla;
        const [hitter, hit, swing, block] = beat % 2 === 0
          ? [partner, cultist, itzla ? SPAR_ATTACKS.itzla : SPAR_ATTACKS.guard, SPAR_ATTACKS.cultistBlock]
          : [cultist, partner, SPAR_ATTACKS.cultist, itzla ? SPAR_ATTACKS.itzlaBlock : SPAR_ATTACKS.guardBlock];
        hitter.performAnimation(new Animation(swing));
        hit.performAnimation(new Animation(block));
        Scenes.face(hitter, [hit.getLocation().getX(), hit.getLocation().getY()]);
        hit.showHitsplat?.(Math.floor(Math.random() * 5), { mine: 17, others: 17 });
      }
      spar(player, scene, beat + 1);
    });
  }

  function handleNpcDeath(event) {
    const npc = event.npc;
    const player = npc?.__questSceneOwner;
    const scene = player ? Scenes.get(player) : null;
    if (!scene || scene.name !== "battle" || !scene.cultists.includes(npc)) return;
    scene.kills++;
    player.sendMessage(`Enemies Defeated: ${scene.kills}/${BATTLE_CULTISTS.length}`);
    if (scene.kills >= BATTLE_CULTISTS.length) Scenes.later(scene, 3, () => beginAftermath(player));
  }

  /** Servius, gravely wounded: the guard's report, then he is carried away. */
  function beginAftermath(player) {
    const current = Scenes.get(player);
    if (current) current.handingOver = true;
    advance(player, STAGE_AFTERMATH);
    syncSideVarbits(player, 2);
    if (current?.name !== "battle") Scenes.hold(player);
    Scenes.fade(player, true);
    Scenes.controls(player, true, true);
    Scenes.later(current ?? player, 2, () => {
      const scene = Scenes.open(player, "aftermath", TEOMAT_BOUNDS);
      Scenes.controls(player, true, true);
      player.moveTo(new Location(1447, 3173, 0));
      Scenes.face(player, [1448, 3173]);
      Scenes.actor(scene, SERVIUS_INJURED_ID, [1453, 3171], [1453, 3175]);
      scene.guard = Scenes.actor(scene, GUARD_ACTOR_ID, [1455, 3172], [1453, 3172]);
      Scenes.actor(scene, ITZLA_ACTOR_ID, [1453, 3177], [1453, 3175]);
      for (const loc of AFTERMATH_LOCS) Scenes.loc(scene, loc);
      Scenes.later(scene, 1, () => Scenes.camera(player, [1450, 3178, 420], [1453, 3171, 20]));
      Scenes.later(scene, 3, () => Scenes.fade(player, false));
      Scenes.later(scene, 6, () => {
        if (scene.guard) Scenes.face(scene.guard, [1452, 3174]);
        play(player, ITZLA_NPC_ID, V.AFTER_CULTISTS, after(STEP.AFTERMATH));
      });
    });
  }

  function sceneEnded(player, scene, logout) {
    if (scene.name === "battle" && !logout && stage(player) === STAGE_BATTLE && !scene.handingOver) {
      player.sendMessage("You leave the battle.");
    }
    if (scene.name === "mezan") player.__tpMezanReady = false;
    if (logout) {
      const back = { fountain: [1756, 3070, 0], mezan: COLOSSEUM_LOBBY_TILE, verdict: [1683, 3156, 0], battle: [1441, 3179, 0], aftermath: [1453, 3173, 0] }[scene.name];
      if (back) player.moveTo(new Location(...back));
    }
  }

  // ==========================================================================
  // Journal, reward and saves
  // ==========================================================================

  const GROUP_NAMES = [
    "<col=800000>Arrun and Claudia</col> at the bazaar",
    "<col=800000>Nel</col> at the cothon",
    "<col=800000>Velam and Azali</col> at the pub",
    "<col=800000>Mezan</col> at the colosseum",
  ];

  function buildJournal(player, questHandle) {
    const current = questHandle.getStage(player);
    if (current >= STAGE_COMPLETE) {
      return [
        "<str>I helped Prince Itzla find the traitor among the knights who",
        "<str>went to Varrock, and saw cultists attack the Teomat.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (current >= STAGE_AFTERMATH) return ["The cultists are defeated, but Servius has been gravely", "wounded. I should speak to <col=800000>Prince Itzla</col>."];
    if (current >= STAGE_BATTLE) return ["Cultists are attacking the Teomat.", "", "I must defeat the eight <col=800000>cultists</col> outside."];
    if (current >= STAGE_LIBRARY) return ["I should ask <col=800000>Metzli</col> in the Teomat's library about", "the Final Dawn."];
    if (current >= STAGE_FED) return ["Renu can take me to the Teomat now.", "", "I should tell <col=800000>Prince Itzla</col> there what I found."];
    if (current >= STAGE_FEED) return ["Regulus Cento gave me some <col=800000>quetzal feed</col>.", "", "I should feed it to <col=800000>Renu</col> by the landing site."];
    if (current >= STAGE_REGULUS) return ["Ennius killed Velam before he could be questioned.", "", "I should ask <col=800000>Regulus Cento</col> about getting to the Teomat."];
    if (current >= STAGE_VERDICT) return ["The twins summoned the knights to the palace.", "", "I should speak to <col=800000>Ennius and Furia Tullus</col>."];
    if (current >= STAGE_LETTER_READ) return ["The letter names Velam as the traitor.", "", "I should show it to <col=800000>Ennius and Furia Tullus</col>."];
    if (current >= STAGE_LETTER) return ["I found a letter in the Kualti Headquarters.", "", "I should read it."];
    if (current >= STAGE_HQ) return ["The knights stayed in the <col=800000>Kualti Headquarters</col> west of", "the palace. I should search their chests upstairs."];
    if (current >= STAGE_JUDGEMENT) return ["All six knights are returning to the palace.", "", "I should speak to <col=800000>Ennius and Furia Tullus</col>."];
    if (current >= STAGE_RECRUIT) {
      return ["I need to send the knights back to the palace:", ...GROUP_NAMES.map((name, group) =>
        recruit(player, group) >= 3 ? `<str>${name.replace(/<[^>]+>/g, "")}</str>` : name)];
    }
    if (current >= STAGE_TWINS) return ["Prince Itzla suspects one of the delegation's knights.", "", "I should speak to the <col=800000>Tullus twins</col> in the palace."];
    if (current >= STAGE_CRYPT) return ["Metzli said the Prince is in the crypt below the temple.", "", "I should speak to <col=800000>Prince Itzla</col> there."];
    if (current >= STAGE_TEMPLE) return ["The Prince is waiting for me at the temple, south of", "the bazaar. I should speak to <col=800000>Metzli</col> there."];
    if (current >= STAGE_STARTED) return ["I met the <col=800000>Tullus twins</col> outside the Sunrise Palace."];
    return [
      "I can start this quest by talking to <col=800000>Ennius</col> or",
      "<col=800000>Furia Tullus</col> outside the Sunrise Palace.",
      "",
      "I need to have completed Children of the Sun.",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.THIEVING, 3000);
  }

  /** Saves from the old plugin used other stage numbers; map them once. */
  function migrate(player) {
    if (player.getAttribute(STAGE_VERSION_ATTRIBUTE) === STAGE_VERSION) return;
    player.setAttribute(STAGE_VERSION_ATTRIBUTE, STAGE_VERSION);
    const old = stage(player);
    if (old <= 0) return;
    const read = ((Number(player.getAttribute(FLAGS_ATTRIBUTE)) || 0) & OLD_FLAG_MESSAGE_READ) !== 0;
    const mapped = { 4: STAGE_METZLI, 10: STAGE_TWINS, 26: read ? STAGE_LETTER_READ : STAGE_LETTER, 28: STAGE_VERDICT,
      30: STAGE_VERDICT_DONE, 32: STAGE_REGULUS, 40: STAGE_FED }[old] ?? old;
    player.setAttribute(FLAGS_ATTRIBUTE, null);
    if (mapped !== old) quest.setStage(player, mapped);
    if (mapped >= STAGE_FED) api.emitCustomEvent("quetzal:unlock", { player });
  }

  function syncOnBootstrap({ player }) {
    if (!player || player.isPlayerBot?.() === true) return;
    migrate(player);
    syncSideVarbits(player);
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  function handleLogout({ player }) {
    if (!player) return;
    stopFollowing(player, false);
    Scenes.end(player, true);
    Scenes.cancel(player);
  }

  function handleProcess({ player }) {
    if (followers.has(player)) tickFollower(player);
  }

  api.persistAttribute(RECRUITS_ATTRIBUTE, 0);
  api.persistAttribute(FLAGS_ATTRIBUTE);
  api.persistAttribute(LETTER_CHEST_ATTRIBUTE);
  api.persistAttribute(STAGE_VERSION_ATTRIBUTE, 0);

  quest = registerQuest(api, {
    key: "twilights_promise",
    name: "Twilight's Promise",
    varpId: VARP_TWILIGHTS_PROMISE,
    varbitId: STAGE_VARBIT,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    scrollItemId: CREST_ITEM_ID,
    otherRewards: ["Ability to use Quetzals", "Civitas illa Fortis Teleport", "3,000 Thieving XP"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:action", handleFedBox);
  api.onCustomEvent("door:toggle", handleGate);
  api.onCustomEvent("player:bootstrap-complete", syncOnBootstrap);
  api.onObjectInteraction("Gate", { Open: openGate, Exit: leaveArena, "Quick-exit": leaveArena });
  api.onObjectInteraction("Crate", { Search: searchCrate });
  api.onObjectInteraction("Crates", { Search: searchCrate });
  api.onObjectInteraction("Chest", { Open: openChest });
  api.onNpcInteraction("Citizen", { Pickpocket: pickpocketCitizen });
  api.onNpcInteraction("Knight of Varlamore", { "Talk-to": talkToKnight });
  api.onNpcInteraction("Furia Tullus", { "Talk-to": talkToTwins });
  api.onNpcInteraction("Ennius Tullus", { "Talk-to": talkToTwins });
  api.onNpcInteraction("Prince Itzla Arkan", { "Talk-to": talkToPrince });
  api.onNpcInteraction("Servius, Teokan of Ralos", { "Talk-to": talkToPrince });
  api.onNpcInteraction("Metzli, Teokan of Ranul", { "Talk-to": talkToTeomatMetzli });
  api.onNpcInteraction("Renu", { Feed: talkToRenu });
  api.onItemOnNpc(feedOnRenu);
  api.onItemAction("Incriminating letter", { Read: readLetter });
  api.onPlayerDealtDamage(countMezanAttack);
  api.onNpcHitModify(blockMezanHit);
  api.onNpcBeforeDeath(keepMezanStanding);
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerProcess(handleProcess);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
