/**
 * Throne of Miscellania (members).
 *
 * The words come from the "Throne of Miscellania" transcript page; this plugin
 * supplies the variant selector for King Vargas, Queen Sigrid, Prince Brand,
 * Princess Astrid, Advisor Ghrim, the throne-room guard and Derrik, the start
 * hook (with the requirements gate), the courtship gift hand-ins, the peace
 * treaty chain (anthem -> correction -> treaty -> giant pen), the public
 * support phase and the final ceremony.
 *
 * Stages (varp 359, "misc_quest" in the cache varp dump; the wiki publishes no
 * per-stage values, so the numbering follows Quest Helper's
 * VarPlayerID.MISC_QUEST-driven guide, the only published reference): 10
 * started (court the chosen heir), 20 heir trust gained (negotiate peace with
 * Queen Sigrid), 30 Sigrid asks for recognition (report to King Vargas), 40
 * Vargas wants the Etceterian anthem changed (report to Sigrid), 50 Sigrid
 * wants a new anthem (Prince Brand writes the awful anthem, Advisor Ghrim
 * corrects it), 60 good anthem in hand (show it to Sigrid), 70 Sigrid's signed
 * treaty (show it to Vargas), 80 Vargas needs a giant pen (Derrik's nib on
 * logs), 90 pen signed, gain 75% public support, 100 complete. 100 is pinned
 * by the cache itself: Ghrim (3670, transformVarp 359) transforms to 5447 for
 * every value below 100 and to 5448 - his post-quest "Collect" form - at
 * exactly 100; Quest Helper's last guided stage is 90.
 *
 * Side state lives in persisted attributes and is mirrored to the cache's own
 * side varbits (confirmed with `lookup-gameval varbit misc`): 72 misc_approval
 * (varp 361 bits 18-24, a 7-bit native 0..127 value, not a percentage), 73
 * misc_affection (25-31), 14606 misc_acceptedtorule (varp 362 bit 28) and
 * 14607 misc_partner_multivar (varp 363 bit 29; 1 = Prince Brand, 0 = Princess
 * Astrid per Quest Helper). The wiki's s1/s2/s3 courtship dialogue progress is
 * our own persisted bitfield.
 *
 * Requirements per the OSRS Wiki: The Fremennik Trials and Heroes' Quest
 * complete, both gated with quest:is-complete on the "Yes." start hook (the
 * dump has no "lacks the requirements" condition). There are no hard skill
 * requirements; the wiki's Woodcutting/Mining/Fishing/Farming levels only
 * unlock the optional support-gaining methods. Rewards per the wiki: 1 Quest
 * point and access to Managing Miscellania (10,000 coins inside the coffers,
 * ring of wealth teleport).
 *
 * Gaps / approximations:
 *  - The dance/clap and blow-kiss steps are real emote gates (`player:emote`),
 *    matching Quest Helper; the emote varbits 96/97 are mirrored for guides.
 *  - Advisor Ghrim spawns as the nameless transform parent 3670 (varp 359
 *    drives it to 5447/5448), which is what the dialogue index and this
 *    selector key on.
 *  - The Managing Miscellania reward system (coffers, approval interface,
 *    daily collection) does not exist in this server: the post-quest
 *    open_interface action answers with a system message and the 10,000 coins
 *    stay a completion-scroll line only. Ring of Wealth's Miscellania
 *    teleport is not quest-gated (separate plugin).
 *  - Public support starts at native 32 (25%) when the pen is signed, matching
 *    capture 91's varbit; each mining/woodcutting/fishing success or raw lobster
 *    handed to Fisherman Frodi adds one native point. Quest Helper requires
 *    native 96 for 75% (floor(96*100/127) = 75). Raking flax/herbs is not
 *    hooked because farming emits no rake event; capture 91 support came from
 *    lobster fishing, which this server reaches through the Frodi hand-in.
 *  - Saves written before the native scale stored 0..100 percent under the
 *    legacy approval attribute; the first read upgrades that to the equivalent
 *    native value so the displayed percentage (and progress) is unchanged.
 *  - The wiki's "[number]%" and "[Fremennik name]" blanks are filled from
 *    state and the player name; "{{...}}" annotations are stripped from lines.
 *  - If the player declines at the start, the transcript's acceptance lines
 *    are dropped but its heir-choice menu still shows; the quest simply does
 *    not start.
 *  - The guard's Heroes' Quest condition (QSsVp6) only has its "may pass"
 *    branch in the dump, so it is always answered true.
 *  - Gifts are consumed as their hand-over dialogue starts (declining the
 *    "Yes"/marriage prompt still loses them), and items granted with a full
 *    inventory are not dropped to the ground as the wiki annotations say.
 */
module.exports = function registerThroneOfMiscellaniaQuest(api) {
  const { ItemIdentifiers, NpcIdentifiers } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const QUEEN_SIGRID_NPC_ID = NpcIdentifiers.QUEEN_SIGRID; // 765
  const PRINCE_BRAND_NPC_IDS = new Set([
    NpcIdentifiers.PRINCE_BRAND, // 3666
    NpcIdentifiers.PRINCE_BRAND_2, // 3918
  ]);
  const PRINCESS_ASTRID_NPC_IDS = new Set([
    NpcIdentifiers.PRINCESS_ASTRID, // 3667
    NpcIdentifiers.PRINCESS_ASTRID_2, // 3919
  ]);
  const KING_VARGAS_NPC_ID = NpcIdentifiers.KING_VARGAS; // 3668
  const GUARD_NPC_ID = NpcIdentifiers.GUARD_47; // 3669, Miscellania throne-room guard
  const DERRIK_NPC_ID = NpcIdentifiers.DERRIK; // 3671
  // The spawned Ghrim is 3670, which the transcript index misses; his variants
  // are indexed to 5447/5448, so replay him through 5447.
  const ADVISOR_GHRIM_NPC_ID = NpcIdentifiers.ADVISOR_GHRIM; // 5447
  const OWN_NPC_IDS = new Set([
    QUEEN_SIGRID_NPC_ID,
    KING_VARGAS_NPC_ID,
    GUARD_NPC_ID,
    DERRIK_NPC_ID,
    ADVISOR_GHRIM_NPC_ID,
    NpcIdentifiers.ADVISOR_GHRIM_2, // 5448
    ...PRINCE_BRAND_NPC_IDS,
    ...PRINCESS_ASTRID_NPC_IDS,
  ]);

  const VARP_THRONE = 359; // "misc_quest"
  const VARBIT_APPROVAL = 72; // misc_approval, varp 361 bits 18-24
  const VARBIT_AFFECTION = 73; // misc_affection, varp 361 bits 25-31
  const VARBIT_ACCEPTED_TO_RULE = 14606; // misc_acceptedtorule, varp 362 bit 28
  const VARBIT_PARTNER = 14607; // misc_partner_multivar, varp 363 bit 29
  // Courtship varbits (cache names); Quest Helper reads these, so mirror them
  // instead of only keeping the private bitfield.
  const VARBIT_S1_D1 = 85;
  const VARBIT_S1_D2 = 86;
  const VARBIT_S1_D3 = 87;
  const VARBIT_S2_D1 = 88;
  const VARBIT_S2_D2 = 89;
  const VARBIT_S2_D3 = 90;
  const VARBIT_S3_D1 = 91;
  const VARBIT_S3_D2 = 92;
  const VARBIT_S3_D3 = 93;
  const VARBIT_S1_GIVE = 94;
  const VARBIT_S2_GIVE = 95;
  const VARBIT_S1_EMOTE = 96;
  const VARBIT_S3_EMOTE = 97;

  // Emote interface slots (216 content): dance, blow kiss, clap.
  const EMOTE_SLOT_DANCE = 12;
  const EMOTE_SLOT_BLOW_KISS = 17;
  const EMOTE_SLOT_CLAP = 20;
  const PARTNER_ROOM_MAX_DISTANCE = 3;

  const STAGE_STARTED = 10;
  const STAGE_TRUST = 20;
  const STAGE_RECOGNISE = 30;
  const STAGE_ANTHEM = 40;
  const STAGE_ANTHEM_WANTED = 50;
  const STAGE_GOOD_ANTHEM = 60;
  const STAGE_TREATY = 70;
  const STAGE_PEN = 80;
  const STAGE_SUPPORT = 90;
  const STAGE_COMPLETE = 100;

  const PARTNER_ASTRID = 0;
  const PARTNER_BRAND = 1;

  const BITS_ATTRIBUTE = "throne-of-miscellania:bits";
  const PARTNER_ATTRIBUTE = "throne-of-miscellania:partner";
  const TRUST_ATTRIBUTE = "throne-of-miscellania:trust";
  const MARRIED_ATTRIBUTE = "throne-of-miscellania:married";
  const AFFECTION_ATTRIBUTE = "throne-of-miscellania:affection";
  // Legacy saves stored a percentage here; new saves use the native scale below.
  const APPROVAL_ATTRIBUTE = "throne-of-miscellania:approval";
  const APPROVAL_NATIVE_ATTRIBUTE = "throne-of-miscellania:approval-native";

  const BIT_S1_D1 = 1 << 0;
  const BIT_S1_D2 = 1 << 1;
  const BIT_S1_D3 = 1 << 2;
  const BIT_S1_GIVE = 1 << 3;
  const BIT_FORMAL = 1 << 4;
  const BIT_S2_D1 = 1 << 5;
  const BIT_S2_D2 = 1 << 6;
  const BIT_S2_D3 = 1 << 7;
  const BIT_S2_GIVE = 1 << 8;
  const BIT_GIFT_TALK = 1 << 9;
  const BIT_S3_D1 = 1 << 10;
  const BIT_S3_D2 = 1 << 11;
  const BIT_S3_D3 = 1 << 12;
  const BIT_KISS = 1 << 13;
  const BIT_MET_PARTNER = 1 << 14;
  const BIT_GUARD_GREETED = 1 << 15;
  const BIT_S1_EMOTE = 1 << 16;
  const S1_ALL = BIT_S1_D1 | BIT_S1_D2 | BIT_S1_D3;
  const S2_ALL = BIT_S2_D1 | BIT_S2_D2 | BIT_S2_D3;
  const S3_ALL = BIT_S3_D1 | BIT_S3_D2 | BIT_S3_D3;

  const START_HOOK = "quest:throne-of-miscellania:start";

  const IRON_BAR_ITEM_ID = ItemIdentifiers.IRON_BAR; // 2351
  const LOGS_ITEM_ID = ItemIdentifiers.LOGS; // 1511
  const AWFUL_ANTHEM_ITEM_ID = ItemIdentifiers.AWFUL_ANTHEM; // 3894
  const GOOD_ANTHEM_ITEM_ID = ItemIdentifiers.GOOD_ANTHEM; // 3895
  const TREATY_ITEM_ID = ItemIdentifiers.TREATY; // 3896
  const GIANT_NIB_ITEM_ID = ItemIdentifiers.GIANT_NIB; // 3897
  const GIANT_PEN_ITEM_ID = ItemIdentifiers.GIANT_PEN; // 3898
  const FLOWER_ITEM_IDS = new Set([
    ItemIdentifiers.ASSORTED_FLOWERS, // 2460
    ItemIdentifiers.RED_FLOWERS, // 2462
    ItemIdentifiers.BLUE_FLOWERS, // 2464
    ItemIdentifiers.YELLOW_FLOWERS, // 2466
    ItemIdentifiers.PURPLE_FLOWERS, // 2468
    ItemIdentifiers.ORANGE_FLOWERS, // 2470
    ItemIdentifiers.MIXED_FLOWERS, // 2472
    ItemIdentifiers.WHITE_FLOWERS, // 2474
    ItemIdentifiers.BLACK_FLOWERS, // 2476
  ]);
  const RING_ITEM_IDS = new Set([
    ItemIdentifiers.GOLD_RING, // 1635
    ItemIdentifiers.SAPPHIRE_RING, // 1637
    ItemIdentifiers.EMERALD_RING, // 1639
    ItemIdentifiers.RUBY_RING, // 1641
    ItemIdentifiers.DIAMOND_RING, // 1643
  ]);
  const CAKE_ITEM_IDS = new Set([
    ItemIdentifiers.CAKE, // 1891
    ItemIdentifiers._2_3_CAKE, // 1893
    ItemIdentifiers.SLICE_OF_CAKE, // 1895
    ItemIdentifiers.CHOCOLATE_CAKE, // 1897
    ItemIdentifiers._2_3_CHOCOLATE_CAKE, // 1899
    ItemIdentifiers.CHOCOLATE_SLICE, // 1901
  ]);
  const BOW_ITEM_IDS = new Set([
    ItemIdentifiers.LONGBOW, // 839
    ItemIdentifiers.SHORTBOW, // 841
    ItemIdentifiers.OAK_SHORTBOW, // 843
    ItemIdentifiers.OAK_LONGBOW, // 845
    ItemIdentifiers.WILLOW_LONGBOW, // 847
    ItemIdentifiers.WILLOW_SHORTBOW, // 849
    ItemIdentifiers.MAPLE_LONGBOW, // 851
    ItemIdentifiers.MAPLE_SHORTBOW, // 853
    ItemIdentifiers.YEW_LONGBOW, // 855
    ItemIdentifiers.YEW_SHORTBOW, // 857
  ]);

  const PAGE = "Throne of Miscellania";
  const GUARD_PAGE = "Guard (Miscellania Castle)";
  const DERRIK_PAGE = "Derrik";

  // King Vargas.
  const V_VARGAS_START = "getting-started-talking-to-king-vargas";
  const V_VARGAS_AGAIN = "getting-started-talking-to-king-vargas-again-after-starting-the-quest";
  const V_VARGAS_APPROVAL = "getting-started-talking-to-king-vargas-after-starting-to-gain-approval";
  const V_VARGAS_TRUST =
    "after-gaining-trust-or-agreeing-to-marry-talking-to-king-vargas-after-gaining-trust-of-the-heir";
  const V_VARGAS_CHANGE_HEIRS = "after-gaining-trust-or-agreeing-to-marry-changing-heirs-dialogue";
  const V_VARGAS_RECOGNISE =
    "negotiating-the-peace-deal-with-queen-sigrid-talking-to-king-vargas-after-queen-sigrid-asks-for-him-to-recognize-etceteria";
  const V_VARGAS_ANTHEM_AGAIN =
    "negotiating-the-peace-deal-with-queen-sigrid-talking-to-king-vargas-again-after-he-asks-sigrid-to-change-the-anthem";
  const V_VARGAS_TREATY =
    "negotiating-the-peace-deal-with-queen-sigrid-talking-to-king-vargas-after-getting-the-treaty";
  const V_VARGAS_PEN = "negotiating-the-peace-deal-with-queen-sigrid-talking-to-king-vargas-after-he-asks-for-a-pen";
  const V_VARGAS_PEN_GIVEN =
    "negotiating-the-peace-deal-with-queen-sigrid-talking-to-king-vargas-after-getting-the-giant-pen";
  const V_VARGAS_SIGNED =
    "negotiating-the-peace-deal-with-queen-sigrid-talking-to-king-vargas-after-he-signs-the-treaty";
  const V_VARGAS_SUPPORT_DONE = "gaining-public-support-talking-to-king-vargas-after-gaining-enough-support";
  const V_VARGAS_POST = "post-quest-talking-to-king-vargas-after-the-quest";

  // Queen Sigrid.
  const V_SIGRID_PRE = "pre-quest-talking-to-queen-sigrid-before-the-quest";
  const V_SIGRID_FIRST = "negotiating-the-peace-deal-with-queen-sigrid-talking-to-queen-sigrid";
  const V_SIGRID_WAIT_VARGAS =
    "negotiating-the-peace-deal-with-queen-sigrid-talking-to-queen-sigrid-again-after-being-asked-to-talk-to-king-vargas";
  const V_SIGRID_ANTHEM =
    "negotiating-the-peace-deal-with-queen-sigrid-talking-to-queen-sigrid-after-king-vargas-asks-to-change-the-anthem";
  const V_SIGRID_WAIT_ANTHEM =
    "negotiating-the-peace-deal-with-queen-sigrid-talking-to-queen-sigrid-again-after-she-asks-for-a-new-anthem";
  const V_SIGRID_AWFUL =
    "negotiating-the-peace-deal-with-queen-sigrid-talking-to-queen-sigrid-after-getting-the-awful-anthem";
  const V_SIGRID_GOOD = "negotiating-the-peace-deal-with-queen-sigrid-talking-to-queen-sigrid-with-the-good-anthem";
  const V_SIGRID_TREATY =
    "negotiating-the-peace-deal-with-queen-sigrid-talking-to-queen-sigrid-after-getting-the-treaty";
  const V_SIGRID_POST = "post-quest-talking-to-queen-sigrid-after-the-quest";

  // Prince Brand.
  const V_BRAND_PRE = "pre-quest-talking-to-prince-brand-before-the-quest";
  const V_BRAND_CROSS_TALK =
    "gaining-the-approval-of-princess-astrid-talking-to-prince-brand-while-gaining-the-approval-of-princess-astrid";
  const V_BRAND_CROSS_ITEMS =
    "gaining-the-approval-of-princess-astrid-giving-items-to-prince-brand-while-gaining-the-approval-of-princess-astrid";
  const V_BRAND_INTRO = "gaining-the-approval-of-prince-brand-talking-to-prince-brand";
  const V_BRAND_S1 =
    "gaining-the-approval-of-prince-brand-talking-to-prince-brand-after-beginning-the-approval-process";
  const V_BRAND_S1_DONE =
    "gaining-the-approval-of-prince-brand-talking-to-prince-brand-after-finishing-the-first-set-of-dialogues";
  const V_BRAND_FLOWERS = "gaining-the-approval-of-prince-brand-giving-flowers-to-prince-brand";
  const V_BRAND_FLOWERS2 = "gaining-the-approval-of-prince-brand-giving-a-second-bouquet-of-flowers-to-prince-brand";
  const V_BRAND_FORMAL =
    "gaining-the-approval-of-prince-brand-talking-to-prince-brand-after-gaining-sufficient-approval";
  const V_BRAND_S2 =
    "gaining-the-approval-of-prince-brand-talking-to-prince-brand-again-after-formal-introduction";
  const V_BRAND_S2_DONE =
    "gaining-the-approval-of-prince-brand-talking-to-prince-brand-after-finishing-the-second-set-of-dialogues";
  const V_BRAND_CAKE =
    "gaining-the-approval-of-prince-brand-giving-cake-chocolate-cake-or-1-3-or-2-3-cake-to-prince-brand";
  const V_BRAND_CAKE2 = "gaining-the-approval-of-prince-brand-giving-a-second-piece-of-cake-to-prince-brand";
  const V_BRAND_CAKE_TALK = "gaining-the-approval-of-prince-brand-talking-to-prince-brand-after-giving-him-cake";
  const V_BRAND_S3 =
    "gaining-the-approval-of-prince-brand-talking-to-prince-brand-after-asking-about-running-the-kingdom";
  const V_BRAND_S3_DONE =
    "gaining-the-approval-of-prince-brand-talking-to-prince-brand-after-finishing-the-third-set-of-dialogues";
  const V_BRAND_RING_EARLY = "gaining-the-approval-of-prince-brand-giving-a-ring-to-prince-brand-too-early";
  const V_BRAND_RING = "gaining-the-approval-of-prince-brand-giving-a-ring-to-prince-brand-after-blowing-a-kiss";
  const V_BRAND_RING2 = "gaining-the-approval-of-prince-brand-giving-a-second-ring-to-prince-brand";
  const V_BRAND_RING_TAKEN = "gaining-the-approval-of-prince-brand-talking-to-prince-brand-after-he-takes-the-ring";
  const V_BRAND_MARRIED = "gaining-the-approval-of-prince-brand-talking-to-prince-brand-after-agreeing-to-marry";
  const V_BRAND_IRRELEVANT = "gaining-the-approval-of-prince-brand-using-irrelevant-items-on-prince-brand";
  const V_BRAND_ANTHEM =
    "negotiating-the-peace-deal-with-queen-sigrid-talking-to-prince-brand-to-ask-for-a-new-anthem";
  const V_BRAND_ANTHEM_AGAIN =
    "negotiating-the-peace-deal-with-queen-sigrid-talking-to-prince-brand-after-losing-the-anthem";
  const V_BRAND_POST_HEIR = "post-quest-talking-to-prince-brand-when-he-is-the-heir-and-not-married";
  const V_BRAND_POST_MARRIED = "post-quest-talking-to-prince-brand-when-married-to-him";
  const V_BRAND_POST_OTHER = "post-quest-talking-to-prince-brand-when-princess-astrid-is-the-heir";

  // Princess Astrid.
  const V_ASTRID_PRE = "pre-quest-talking-to-princess-astrid-before-the-quest";
  const V_ASTRID_CROSS_TALK =
    "gaining-the-approval-of-prince-brand-talking-to-princess-astrid-while-gaining-the-approval-of-prince-brand";
  const V_ASTRID_CROSS_ITEMS =
    "gaining-the-approval-of-prince-brand-giving-items-to-princess-astrid-while-gaining-the-approval-of-prince-brand";
  const V_ASTRID_INTRO = "gaining-the-approval-of-princess-astrid-talking-to-princess-astrid";
  const V_ASTRID_S1 =
    "gaining-the-approval-of-princess-astrid-talking-to-princess-astrid-after-beginning-the-approval-process";
  // The page has no first-set greeting for Astrid; her own generic "Good day"
  // branch is reused until the flowers/formal introduction.
  const V_ASTRID_S1_DONE = "pre-quest-talking-to-princess-astrid-before-the-quest";
  const V_ASTRID_FLOWERS = "gaining-the-approval-of-princess-astrid-giving-flowers-to-princess-astrid";
  const V_ASTRID_FLOWERS2 =
    "gaining-the-approval-of-princess-astrid-giving-a-second-boquet-of-flowers-to-princess-astrid";
  const V_ASTRID_FORMAL =
    "gaining-the-approval-of-princess-astrid-talking-to-princess-astrid-after-gaining-sufficient-approval";
  const V_ASTRID_S2 =
    "gaining-the-approval-of-princess-astrid-talking-to-princess-astrid-again-after-formal-introduction";
  const V_ASTRID_S2_DONE =
    "gaining-the-approval-of-princess-astrid-talking-to-princess-astrid-after-finishing-the-second-set-of-dialogues";
  const V_ASTRID_BOW = "gaining-the-approval-of-princess-astrid-giving-a-bow-to-princess-astrid";
  const V_ASTRID_BOW2 = "gaining-the-approval-of-princess-astrid-giving-a-second-bow-to-princess-astrid";
  const V_ASTRID_BOW_TALK =
    "gaining-the-approval-of-princess-astrid-talking-to-princess-astrid-after-giving-her-the-bow";
  const V_ASTRID_S3 =
    "gaining-the-approval-of-princess-astrid-talking-to-princess-astrid-after-asking-about-running-the-kingdom";
  const V_ASTRID_S3_DONE =
    "gaining-the-approval-of-princess-astrid-talking-to-princess-astrid-after-finishing-the-third-set-of-dialogues";
  const V_ASTRID_RING_EARLY =
    "gaining-the-approval-of-princess-astrid-giving-a-ring-to-princess-astrid-too-early";
  const V_ASTRID_RING =
    "gaining-the-approval-of-princess-astrid-giving-a-ring-to-princess-astrid-after-finishing-the-third-set-of-dialogues";
  const V_ASTRID_RING2 = "gaining-the-approval-of-princess-astrid-giving-a-second-ring-to-princess-astrid";
  const V_ASTRID_RING_TAKEN =
    "gaining-the-approval-of-princess-astrid-talking-to-princess-astrid-after-she-takes-the-ring";
  const V_ASTRID_MARRIED = "gaining-the-approval-of-princess-astrid-talking-to-princess-astrid-after-agreeing-to-marry";
  const V_ASTRID_IRRELEVANT = "gaining-the-approval-of-princess-astrid-using-irrelevant-items-on-princess-astrid";
  const V_ASTRID_POST_HEIR = "post-quest-talking-to-princess-astrid-when-she-is-the-heir-and-not-married";
  const V_ASTRID_POST_MARRIED = "post-quest-talking-to-princess-astrid-when-married-to-her";
  const V_ASTRID_POST_OTHER = "post-quest-talking-to-princess-astrid-when-prince-brand-is-the-heir";

  // Advisor Ghrim.
  const V_GHRIM_PRE = "pre-quest-talking-to-advisor-ghrim-before-the-quest";
  const V_GHRIM_START = "getting-started-talking-to-advisor-ghrim-after-starting-the-quest";
  const V_GHRIM_WANT_ANTHEM =
    "negotiating-the-peace-deal-with-queen-sigrid-talking-to-advisor-ghrim-after-sigrid-asks-for-a-new-anthem";
  const V_GHRIM_AWFUL =
    "negotiating-the-peace-deal-with-queen-sigrid-talking-to-advisor-ghrim-with-the-awful-anthem";
  const V_GHRIM_GOOD = "negotiating-the-peace-deal-with-queen-sigrid-talking-to-advisor-ghrim-with-the-good-anthem";
  const V_GHRIM_LOST =
    "negotiating-the-peace-deal-with-queen-sigrid-talking-to-advisor-ghrim-after-losing-the-good-anthem";
  const V_GHRIM_TREATY =
    "negotiating-the-peace-deal-with-queen-sigrid-talking-to-advisor-ghrim-after-getting-the-treaty";
  const V_GHRIM_PEN = "negotiating-the-peace-deal-with-queen-sigrid-talking-to-advisor-ghrim-after-king-vargas-asks-for-a-pen";
  const V_GHRIM_SUPPORT = "gaining-public-support-talking-to-advisor-ghrim-about-becoming-regent";
  const V_GHRIM_POST = "post-quest-talking-to-advisor-ghrim-after-the-quest";

  // Guard / Derrik.
  const V_GUARD_FIRST = "pre-quest-talking-to-guard-at-door-to-throne-room";
  const V_GUARD_AGAIN = "pre-quest-talking-to-guard-at-the-throne-room-after-entering-once";
  const V_GUARD_POST = "after-throne-of-miscellania";
  const V_DERRIK_PEN = "negotiating-the-peace-deal-with-queen-sigrid-talking-to-derrik-after-king-vargas-asks-for-a-pen";
  const V_DERRIK_POST = "standard-dialogue-after-throne-of-miscellania";

  // Condition step ids on the page.
  const COND_HEROES_GUARD = "QSsVp6";
  const COND_ASTRID_NOT_TRUSTED = "pVyhMK";
  const COND_ASTRID_TRUSTED = "R-ioM0";
  const COND_HAS_ANOTHER_BAD_ANTHEM = "c6OJH6";
  const COND_NO_ANOTHER_BAD_ANTHEM = "j3eepi";
  const COND_HAS_TREATY = "vPKedS";
  const COND_LOST_TREATY = "u2mSC3";
  const COND_NO_IRON_BAR = "o3Os0d";
  const COND_KILLED_CITIZEN = "Qjl9TH";
  const COND_AT_LEAST_75 = "Wrg10w";
  const COND_LESS_THAN_75 = "Eyvdls";
  const COND_TRUSTED_BRAND = "FNTmnS";
  const COND_TRUSTED_ASTRID = "q6bxJv";
  const COND_GAINING_ASTRID = "xABgz8";
  const COND_GAINING_BRAND = "PnIoBF";
  const COND_GAINING_ASTRID_2 = "C0E3P_";
  const COND_GAINING_BRAND_2 = "BWb8Gq";
  const COND_EARNING_BRAND = "73JMQK";
  const COND_EARNING_ASTRID = "F067Uu";
  const COND_MARRIED = "hXFXGl";
  const COND_NOT_MARRIED = "QI1Q2y";

  // Random courtship dialogue conditions (per set and dialogue).
  const BRAND_RANDOM_CONDITIONS = new Map([
    ["EAutTF", BIT_S1_D1],
    ["5-d-cw", BIT_S1_D2],
    ["d7pkcR", BIT_S1_D3],
    ["kwNFA8", BIT_S2_D1],
    ["SaxflL", BIT_S2_D2],
    ["f6M7_A", BIT_S2_D3],
    ["-Lj_o1", BIT_S3_D1],
    ["Lzd-Km", BIT_S3_D2],
    ["s4GzI6", BIT_S3_D3],
  ]);
  const ASTRID_RANDOM_CONDITIONS = new Map([
    ["JplkCV", BIT_S1_D1],
    ["7LLLdI", BIT_S1_D2],
    ["3nrn2W", BIT_S1_D3],
    ["3jKsFz", BIT_S2_D1],
    ["1y40qo", BIT_S2_D2],
    ["An2HbH", BIT_S2_D3],
    ["lekJ97", BIT_S3_D1],
    ["VvFKJk", BIT_S3_D2],
    ["7eWLDe", BIT_S3_D3],
  ]);
  const RANDOM_CONDITION_BITS = new Map([...BRAND_RANDOM_CONDITIONS, ...ASTRID_RANDOM_CONDITIONS]);

  // The correct answers to the random courtship dialogues: text -> [bit, affection].
  const BRAND_ANSWERS = new Map([
    ["Be still, my heart.", [BIT_S1_D1, 1]],
    ["They don't understand your poetry as I do.", [BIT_S1_D2, 1]],
    ["You will be the greatest bard!", [BIT_S1_D3, 1]],
    ["How poetic.", [BIT_S2_D1, 1]],
    ["How inspiring!", [BIT_S2_D2, 1]],
    ["A much nobler pursuit, to be sure.", [BIT_S2_D3, 1]],
    ["That was lovely. I'm touched!", [BIT_S3_D1, 1]],
    ["I wouldn't presume to have the skill...", [BIT_S3_D2, 1]],
    ["I'm glad to hear it.", [BIT_S3_D3, 1]],
  ]);
  const ASTRID_ANSWERS = new Map([
    ["Archery is a noble art!", [BIT_S1_D1, 1]],
    ["Hahahaha!", [BIT_S1_D2, 1]],
    ["He's been very helpful.", [BIT_S1_D3, 1]],
    ["That sounds like a good idea.", [BIT_S2_D1, 1]],
    ["What happened next?", [BIT_S2_D2, 1]],
    ["I'm quite fond of it myself.", [BIT_S2_D3, 1]],
    ["It's a lovely little country.", [BIT_S3_D1, 1]],
    ["And what a great bard he makes!", [BIT_S3_D2, 1]],
    ["I suppose you don't have much opportunity to.", [BIT_S3_D3, 1]],
  ]);
  const RANDOM_COURT_VARIANTS = new Set([
    V_BRAND_S1,
    V_BRAND_S2,
    V_BRAND_S3,
    V_ASTRID_S1,
    V_ASTRID_S2,
    V_ASTRID_S3,
  ]);

  // Action / message step ids.
  const ACTION_CHANGE_HEIRS_AFTER_TRUST = "jIyvWM";
  const ACTION_VARGAS_RECOGNISE = "hYN_8p";
  const ACTION_VARGAS_ANTHEM_AGAIN = "2jWTa5";
  const ACTION_VARGAS_TREATY = "ZJ2xU5";
  const ACTION_VARGAS_PEN_WAIT = "yjd_hl";
  const ACTION_VARGAS_SIGNED_TREATY = "3agED3";
  const ACTION_VARGAS_POST = "DCQDGk";
  const ACTION_VARGAS_PEN_CONTINUE = "m2WGDj";
  const ACTION_COMPLETE = "7ukkOd";
  const ACTION_OPEN_MANAGING = "5osMOh";
  const ACTION_ROYAL_TROUBLE = "q1HFEt";
  const MESSAGE_BRAND_RING = "nDuj-o";
  const MESSAGE_ASTRID_RING = "H2ri6u";

  const REFUSAL_LINE_PREFIXES = [
    "If I may be so bold",
    "Hahaha! You are bold",
    "You will first have to demonstrate your worth",
    "We have been at war with neighbouring Etceteria",
    "Now may be an opportune time to make amends",
    "Then do not stray far",
    "Wait! There is one more matter",
    "By Miscellanious tradition",
    "This includes that of the future king or queen",
    "Until then, gaining the trust of one of them",
    "So tell me! Which of my children",
    "I would like to choose",
    "And you say this is a mere formality",
    "I am sure you can form a good working relationship",
  ];

  // Miscellania + Etceteria island bounds (Quest Helper's islands zone).
  const ISLAND_MIN_X = 2491;
  const ISLAND_MAX_X = 2627;
  const ISLAND_MIN_Y = 3835;
  const ISLAND_MAX_Y = 3904;
  // Cache varbit 72 is 7-bit: native 0..127. Capture 91 starts at 32 and each
  // lobster/action adds one native point; Quest Helper's 75% gate is native 96.
  const APPROVAL_MAX = 127;
  const APPROVAL_THRESHOLD = 96;
  const APPROVAL_PER_ACTION = 1;
  const APPROVAL_START = 32;

  const FISHERMAN_FRODI_NPC_ID = NpcIdentifiers.FISHERMAN_FRODI; // 3655
  const RAW_LOBSTER_ITEM_ID = ItemIdentifiers.RAW_LOBSTER; // 377
  const FRODI_TILE = { x: 2576, y: 3852 };
  const FRODI_HAND_IN_RANGE = 8;

  const refusingStart = new WeakSet();
  // The ring transcript's real menus are gift "Yes"/"Goodbye." then proposal
  // "Yes"/"No"; the proposal line itself is a player step, not an option.
  const proposalStage = new WeakMap();

  let quest;

  const held = (player, itemId, amount = 1) =>
    player.getInventory().getAmount(itemId) >= amount;

  function bits(player) {
    return Number(player.getAttribute(BITS_ATTRIBUTE)) || 0;
  }

  function hasBit(player, bit) {
    return (bits(player) & bit) !== 0;
  }

  function setBits(player, value) {
    player.setAttribute(BITS_ATTRIBUTE, value | 0);
  }

  function partner(player) {
    const value = Number(player.getAttribute(PARTNER_ATTRIBUTE));
    return value === PARTNER_BRAND ? PARTNER_BRAND : PARTNER_ASTRID;
  }

  function setPartner(player, value) {
    player.setAttribute(PARTNER_ATTRIBUTE, value | 0);
    sendSideVarbits(player);
  }

  function trusted(player) {
    return Number(player.getAttribute(TRUST_ATTRIBUTE)) === 1;
  }

  function setTrusted(player, value) {
    player.setAttribute(TRUST_ATTRIBUTE, value ? 1 : 0);
    sendSideVarbits(player);
  }

  function married(player) {
    return Number(player.getAttribute(MARRIED_ATTRIBUTE)) === 1;
  }

  function setMarried(player, value) {
    player.setAttribute(MARRIED_ATTRIBUTE, value ? 1 : 0);
  }

  function affection(player) {
    return Math.max(0, Number(player.getAttribute(AFFECTION_ATTRIBUTE)) || 0);
  }

  function addAffection(player, amount) {
    player.setAttribute(AFFECTION_ATTRIBUTE, Math.min(127, affection(player) + amount));
    sendSideVarbits(player);
  }

  function clampApproval(value) {
    return Math.max(0, Math.min(APPROVAL_MAX, value | 0));
  }

  /** The percentage the cache script and Quest Helper show for a native value. */
  function approvalPercent(player) {
    return Math.floor((approval(player) * 100) / APPROVAL_MAX);
  }

  function legacyApprovalToNative(percent) {
    return clampApproval(Math.ceil((percent * APPROVAL_MAX) / 100));
  }

  function approval(player) {
    const native = Number(player.getAttribute(APPROVAL_NATIVE_ATTRIBUTE));
    if (Number.isFinite(native) && native >= 0) return clampApproval(native);
    const legacy = Number(player.getAttribute(APPROVAL_ATTRIBUTE));
    if (!Number.isFinite(legacy) || legacy <= 0) return 0;
    const migrated = legacyApprovalToNative(legacy);
    player.setAttribute(APPROVAL_NATIVE_ATTRIBUTE, migrated);
    return migrated;
  }

  function setApproval(player, value) {
    player.setAttribute(APPROVAL_NATIVE_ATTRIBUTE, clampApproval(value));
    sendSideVarbits(player);
    refreshQuestList(player);
  }

  function sendSideVarbits(player) {
    const sender = player.getPacketSender();
    const value = bits(player);
    const flag = (bit) => ((value & bit) !== 0 ? 1 : 0);
    sender.sendVarbit(VARBIT_APPROVAL, approval(player));
    sender.sendVarbit(VARBIT_AFFECTION, affection(player));
    sender.sendVarbit(VARBIT_ACCEPTED_TO_RULE, trusted(player) ? 1 : 0);
    sender.sendVarbit(VARBIT_PARTNER, partner(player));
    sender.sendVarbit(VARBIT_S1_D1, flag(BIT_S1_D1));
    sender.sendVarbit(VARBIT_S1_D2, flag(BIT_S1_D2));
    sender.sendVarbit(VARBIT_S1_D3, flag(BIT_S1_D3));
    sender.sendVarbit(VARBIT_S2_D1, flag(BIT_S2_D1));
    sender.sendVarbit(VARBIT_S2_D2, flag(BIT_S2_D2));
    sender.sendVarbit(VARBIT_S2_D3, flag(BIT_S2_D3));
    sender.sendVarbit(VARBIT_S3_D1, flag(BIT_S3_D1));
    sender.sendVarbit(VARBIT_S3_D2, flag(BIT_S3_D2));
    sender.sendVarbit(VARBIT_S3_D3, flag(BIT_S3_D3));
    sender.sendVarbit(VARBIT_S1_GIVE, flag(BIT_S1_GIVE));
    sender.sendVarbit(VARBIT_S2_GIVE, flag(BIT_S2_GIVE));
    sender.sendVarbit(VARBIT_S1_EMOTE, flag(BIT_S1_EMOTE));
    sender.sendVarbit(VARBIT_S3_EMOTE, flag(BIT_KISS));
  }

  function advanceStage(player, stage) {
    if (quest.getStage(player) >= stage) return;
    quest.setStage(player, stage);
    if (stage === STAGE_SUPPORT && approval(player) === 0) setApproval(player, APPROVAL_START);
    sendSideVarbits(player);
  }

  function isBrand(npcId) {
    return PRINCE_BRAND_NPC_IDS.has(npcId);
  }

  function isAstrid(npcId) {
    return PRINCESS_ASTRID_NPC_IDS.has(npcId);
  }

  function courted(player, brand) {
    return quest.getStage(player) === STAGE_STARTED && partner(player) === (brand ? PARTNER_BRAND : PARTNER_ASTRID);
  }

  function onMiscellania(player) {
    const location = player.getLocation();
    const x = location.getX();
    const y = location.getY();
    return x >= ISLAND_MIN_X && x <= ISLAND_MAX_X && y >= ISLAND_MIN_Y && y <= ISLAND_MAX_Y;
  }

  function questComplete(player, key) {
    const request = { player, key, complete: null };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function consumeOneOf(player, itemIds) {
    for (const itemId of itemIds) {
      if (held(player, itemId)) {
        player.getInventory().deleteNumber(itemId, 1);
        return itemId;
      }
    }
    return undefined;
  }

  /** Plays a named variant through NpcDialogues; falls back to the runtime replay. */
  function playVariant(player, npcId, variant) {
    const request = { player, npcId, variant, handled: false };
    api.emitCustomEvent("npc-dialogue:start", request);
    if (!request.handled) startTranscript(api, player, npcId, PAGE, variant);
  }

  function replayNextTick(player, action) {
    const { CountdownTask, TaskManager } = api.core;
    if (!CountdownTask || !TaskManager) {
      action();
      return;
    }
    TaskManager.submit(
      new CountdownTask({}, 1, () => {
        if (player.isRegistered?.() === false) return;
        action();
      })
    );
  }

  // ==========================================================================
  // Courtship
  // ==========================================================================

  /**
   * The talk variant for the courted heir at a given progress point. Selecting
   * the intro / formal introduction / gift reaction / kiss greeting also
   * records that step. The dance/clap and blow-kiss emotes are real gates, as
   * Quest Helper's route has them.
   */
  function courtTalkVariant(player, brand) {
    const value = bits(player);
    if ((value & BIT_MET_PARTNER) === 0) {
      setBits(player, value | BIT_MET_PARTNER);
      if (affection(player) === 0) addAffection(player, 10);
      return brand ? V_BRAND_INTRO : V_ASTRID_INTRO;
    }
    if ((value & S1_ALL) !== S1_ALL) return brand ? V_BRAND_S1 : V_ASTRID_S1;
    if ((value & BIT_S1_GIVE) === 0) return brand ? V_BRAND_S1_DONE : V_ASTRID_S1_DONE;
    if ((value & BIT_S1_EMOTE) === 0) return brand ? V_BRAND_S1_DONE : V_ASTRID_S1_DONE;
    if ((value & BIT_FORMAL) === 0) {
      setBits(player, value | BIT_FORMAL);
      addAffection(player, 5);
      return brand ? V_BRAND_FORMAL : V_ASTRID_FORMAL;
    }
    if ((value & S2_ALL) !== S2_ALL) return brand ? V_BRAND_S2 : V_ASTRID_S2;
    if ((value & BIT_S2_GIVE) === 0) return brand ? V_BRAND_S2_DONE : V_ASTRID_S2_DONE;
    if ((value & BIT_GIFT_TALK) === 0) {
      setBits(player, value | BIT_GIFT_TALK);
      addAffection(player, 6);
      return brand ? V_BRAND_CAKE_TALK : V_ASTRID_BOW_TALK;
    }
    if ((value & S3_ALL) !== S3_ALL) return brand ? V_BRAND_S3 : V_ASTRID_S3;
    if ((value & BIT_KISS) === 0) return brand ? V_BRAND_S3_DONE : V_ASTRID_S3_DONE;
    if (trusted(player)) {
      if (brand) return married(player) ? V_BRAND_MARRIED : V_BRAND_RING_TAKEN;
      return married(player) ? V_ASTRID_MARRIED : V_ASTRID_RING_TAKEN;
    }
    return brand ? V_BRAND_S3_DONE : V_ASTRID_S3_DONE;
  }

  function selectVargas(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return { page: PAGE, variant: V_VARGAS_POST };
    if (stage >= STAGE_SUPPORT) {
      return { page: PAGE, variant: approval(player) >= APPROVAL_THRESHOLD ? V_VARGAS_SUPPORT_DONE : V_VARGAS_SIGNED };
    }
    if (stage >= STAGE_PEN) {
      if (held(player, GIANT_PEN_ITEM_ID)) {
        player.getInventory().deleteNumber(GIANT_PEN_ITEM_ID, 1);
        advanceStage(player, STAGE_SUPPORT);
        return { page: PAGE, variant: V_VARGAS_PEN_GIVEN };
      }
      return { page: PAGE, variant: V_VARGAS_PEN };
    }
    if (stage >= STAGE_TREATY) return { page: PAGE, variant: V_VARGAS_TREATY };
    if (stage >= STAGE_ANTHEM) return { page: PAGE, variant: V_VARGAS_ANTHEM_AGAIN };
    if (stage >= STAGE_RECOGNISE) return { page: PAGE, variant: V_VARGAS_RECOGNISE };
    if (stage >= STAGE_TRUST) return { page: PAGE, variant: V_VARGAS_TRUST };
    if (stage >= STAGE_STARTED) {
      return { page: PAGE, variant: hasBit(player, BIT_MET_PARTNER) ? V_VARGAS_APPROVAL : V_VARGAS_AGAIN };
    }
    refusingStart.delete(player);
    return { page: PAGE, variant: V_VARGAS_START };
  }

  function selectSigrid(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return { page: PAGE, variant: V_SIGRID_POST };
    if (stage >= STAGE_TREATY) {
      if (stage === STAGE_TREATY && !held(player, TREATY_ITEM_ID)) {
        player.getInventory().adds(TREATY_ITEM_ID, 1);
        player.sendMessage("Queen Sigrid signs another copy of the treaty and hands it to you.");
      }
      return { page: PAGE, variant: V_SIGRID_TREATY };
    }
    if (stage >= STAGE_GOOD_ANTHEM) {
      return { page: PAGE, variant: held(player, GOOD_ANTHEM_ITEM_ID) ? V_SIGRID_GOOD : V_SIGRID_WAIT_ANTHEM };
    }
    if (stage >= STAGE_ANTHEM_WANTED) {
      if (held(player, AWFUL_ANTHEM_ITEM_ID)) return { page: PAGE, variant: V_SIGRID_AWFUL };
      return { page: PAGE, variant: V_SIGRID_WAIT_ANTHEM };
    }
    if (stage >= STAGE_ANTHEM) {
      advanceStage(player, STAGE_ANTHEM_WANTED);
      return { page: PAGE, variant: V_SIGRID_ANTHEM };
    }
    if (stage >= STAGE_RECOGNISE) return { page: PAGE, variant: V_SIGRID_WAIT_VARGAS };
    if (stage >= STAGE_TRUST) {
      advanceStage(player, STAGE_RECOGNISE);
      return { page: PAGE, variant: V_SIGRID_FIRST };
    }
    return { page: PAGE, variant: V_SIGRID_PRE };
  }

  function selectBrand(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      if (partner(player) === PARTNER_BRAND) {
        return { page: PAGE, variant: married(player) ? V_BRAND_POST_MARRIED : V_BRAND_POST_HEIR };
      }
      return { page: PAGE, variant: V_BRAND_POST_OTHER };
    }
    if (stage >= STAGE_TRUST) {
      if (stage === STAGE_ANTHEM_WANTED && !held(player, AWFUL_ANTHEM_ITEM_ID) && !held(player, GOOD_ANTHEM_ITEM_ID)) {
        return { page: PAGE, variant: V_BRAND_ANTHEM };
      }
      if (stage === STAGE_GOOD_ANTHEM && !held(player, GOOD_ANTHEM_ITEM_ID)) {
        return { page: PAGE, variant: V_BRAND_ANTHEM_AGAIN };
      }
      if (partner(player) === PARTNER_BRAND) {
        return { page: PAGE, variant: married(player) ? V_BRAND_MARRIED : V_BRAND_RING_TAKEN };
      }
      return { page: PAGE, variant: V_BRAND_POST_OTHER };
    }
    if (stage >= STAGE_STARTED) {
      if (partner(player) !== PARTNER_BRAND) return { page: PAGE, variant: V_BRAND_CROSS_TALK };
      return { page: PAGE, variant: courtTalkVariant(player, true) };
    }
    return { page: PAGE, variant: V_BRAND_PRE };
  }

  function selectAstrid(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      if (partner(player) === PARTNER_ASTRID) {
        return { page: PAGE, variant: married(player) ? V_ASTRID_POST_MARRIED : V_ASTRID_POST_HEIR };
      }
      return { page: PAGE, variant: V_ASTRID_POST_OTHER };
    }
    if (stage >= STAGE_TRUST) {
      if (partner(player) === PARTNER_ASTRID) {
        return { page: PAGE, variant: married(player) ? V_ASTRID_MARRIED : V_ASTRID_RING_TAKEN };
      }
      return { page: PAGE, variant: V_ASTRID_POST_OTHER };
    }
    if (stage >= STAGE_STARTED) {
      if (partner(player) !== PARTNER_ASTRID) return { page: PAGE, variant: V_ASTRID_CROSS_TALK };
      return { page: PAGE, variant: courtTalkVariant(player, false) };
    }
    return { page: PAGE, variant: V_ASTRID_PRE };
  }

  function selectGuard(player) {
    if (quest.getStage(player) >= STAGE_COMPLETE) {
      return { page: GUARD_PAGE, variant: V_GUARD_POST };
    }
    if (hasBit(player, BIT_GUARD_GREETED)) return { page: PAGE, variant: V_GUARD_AGAIN };
    setBits(player, bits(player) | BIT_GUARD_GREETED);
    return { page: PAGE, variant: V_GUARD_FIRST };
  }

  function selectDerrik(player) {
    const stage = quest.getStage(player);
    if (stage === STAGE_PEN) return { page: PAGE, variant: V_DERRIK_PEN };
    if (stage >= STAGE_COMPLETE) return { page: DERRIK_PAGE, variant: V_DERRIK_POST };
    return null;
  }

  function selectVariant({ npcId, player }) {
    if (!player) return null;
    if (npcId === KING_VARGAS_NPC_ID) return selectVargas(player);
    if (npcId === QUEEN_SIGRID_NPC_ID) return selectSigrid(player);
    if (isBrand(npcId)) return selectBrand(player);
    if (isAstrid(npcId)) return selectAstrid(player);
    if (npcId === GUARD_NPC_ID) return selectGuard(player);
    if (npcId === DERRIK_NPC_ID) return selectDerrik(player);
    if (npcId === ADVISOR_GHRIM_NPC_ID || npcId === NpcIdentifiers.ADVISOR_GHRIM_2) {
      return { page: PAGE, variant: ghrimVariant(player) };
    }
    return null;
  }

  function partnerRoomTile(brand) {
    return brand ? { x: 2502, y: 3852 } : { x: 2502, y: 3867 };
  }

  function nearPartnerRoom(player, brand) {
    const location = player.getLocation();
    const tile = partnerRoomTile(brand);
    return location.getZ() === 1 &&
      Math.abs(location.getX() - tile.x) <= PARTNER_ROOM_MAX_DISTANCE &&
      Math.abs(location.getY() - tile.y) <= PARTNER_ROOM_MAX_DISTANCE;
  }

  /** Dance (Astrid) / clap (Brand) after the flowers, then blow kiss before the ring. */
  function handleEmote(event) {
    const { player, slot } = event;
    if (!player || quest.getStage(player) !== STAGE_STARTED || !onMiscellania(player)) return;
    const brand = partner(player) === PARTNER_BRAND;
    if (!nearPartnerRoom(player, brand)) return;
    const value = bits(player);
    const firstSetEmote = brand ? EMOTE_SLOT_CLAP : EMOTE_SLOT_DANCE;
    if ((value & BIT_S1_GIVE) !== 0 && (value & BIT_S1_EMOTE) === 0 && slot === firstSetEmote) {
      setBits(player, value | BIT_S1_EMOTE);
      addAffection(player, 1);
      sendSideVarbits(player);
      return;
    }
    if ((value & S3_ALL) === S3_ALL && (value & BIT_KISS) === 0 && slot === EMOTE_SLOT_BLOW_KISS) {
      setBits(player, value | BIT_KISS);
      addAffection(player, 1);
      sendSideVarbits(player);
    }
  }

  function ghrimVariant(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return V_GHRIM_POST;
    if (stage >= STAGE_SUPPORT) return V_GHRIM_SUPPORT;
    if (stage >= STAGE_PEN) return V_GHRIM_PEN;
    if (stage >= STAGE_TREATY) return V_GHRIM_TREATY;
    if (stage >= STAGE_GOOD_ANTHEM) return held(player, GOOD_ANTHEM_ITEM_ID) ? V_GHRIM_GOOD : V_GHRIM_LOST;
    if (stage >= STAGE_ANTHEM_WANTED) {
      if (held(player, AWFUL_ANTHEM_ITEM_ID)) return V_GHRIM_AWFUL;
      if (held(player, GOOD_ANTHEM_ITEM_ID)) return V_GHRIM_GOOD;
      return V_GHRIM_WANT_ANTHEM;
    }
    if (stage >= STAGE_STARTED) return V_GHRIM_START;
    return V_GHRIM_PRE;
  }

  // ==========================================================================
  // Conditions
  // ==========================================================================

  function answerCondition({ player, stepId }) {
    if (!player || typeof stepId !== "string") return null;
    return answerConditionForPlayer(player, stepId);
  }

  function answerConditionForPlayer(player, stepId) {
    switch (stepId) {
      case COND_HEROES_GUARD:
        return true;
      case COND_ASTRID_NOT_TRUSTED:
        return !(trusted(player) && partner(player) === PARTNER_ASTRID);
      case COND_ASTRID_TRUSTED:
        return trusted(player) && partner(player) === PARTNER_ASTRID;
      case COND_HAS_ANOTHER_BAD_ANTHEM:
        return held(player, AWFUL_ANTHEM_ITEM_ID);
      case COND_NO_ANOTHER_BAD_ANTHEM:
        return !held(player, AWFUL_ANTHEM_ITEM_ID);
      case COND_HAS_TREATY:
        return held(player, TREATY_ITEM_ID);
      case COND_LOST_TREATY:
        return !held(player, TREATY_ITEM_ID);
      case COND_NO_IRON_BAR:
        return !held(player, IRON_BAR_ITEM_ID);
      case COND_KILLED_CITIZEN:
        return false;
      case COND_AT_LEAST_75:
        return approval(player) >= APPROVAL_THRESHOLD;
      case COND_LESS_THAN_75:
        return approval(player) < APPROVAL_THRESHOLD;
      case COND_TRUSTED_BRAND:
        return trusted(player) && partner(player) === PARTNER_BRAND;
      case COND_TRUSTED_ASTRID:
        return trusted(player) && partner(player) === PARTNER_ASTRID;
      case COND_GAINING_ASTRID:
      case COND_GAINING_ASTRID_2:
        return partner(player) === PARTNER_ASTRID;
      case COND_GAINING_BRAND:
      case COND_GAINING_BRAND_2:
        return partner(player) === PARTNER_BRAND;
      case COND_EARNING_BRAND:
        return partner(player) === PARTNER_BRAND;
      case COND_EARNING_ASTRID:
        return partner(player) === PARTNER_ASTRID;
      case COND_MARRIED:
        return married(player);
      case COND_NOT_MARRIED:
        return !married(player);
      default:
        break;
    }
    const bit = RANDOM_CONDITION_BITS.get(stepId);
    if (bit !== undefined) return !hasBit(player, bit);
    return null;
  }

  // ==========================================================================
  // Choices / hooks / lines / actions
  // ==========================================================================

  function resetCourtship(player) {
    setBits(player, bits(player) & BIT_GUARD_GREETED);
    player.setAttribute(AFFECTION_ATTRIBUTE, 0);
    sendSideVarbits(player);
  }

  /** Trust belongs to one heir, so changing heir drops it and restarts the courtship. */
  function switchHeir(player, value) {
    const stage = quest.getStage(player);
    if (stage !== STAGE_STARTED && stage !== STAGE_TRUST) return;
    if (partner(player) === value) return;
    setPartner(player, value);
    resetCourtship(player);
    setTrusted(player, false);
    setMarried(player, false);
    if (stage === STAGE_TRUST) quest.setStage(player, STAGE_STARTED);
  }

  function handleChoice(event) {
    const { player, npcId, option } = event;
    if (!player || typeof option !== "string") return;
    if (npcId === KING_VARGAS_NPC_ID) {
      if (option.startsWith("I want to earn Prince Brand")) {
        switchHeir(player, PARTNER_BRAND);
        return;
      }
      if (option.startsWith("I want to earn Princess Astrid")) {
        switchHeir(player, PARTNER_ASTRID);
        return;
      }
      if (option === "I think Princess Astrid would make the best heir.") {
        switchHeir(player, PARTNER_ASTRID);
        return;
      }
      if (option === "I think Prince Brand would make the best heir.") {
        switchHeir(player, PARTNER_BRAND);
        return;
      }
    }
    const proposal = proposalStage.get(player);
    if (proposal && (isBrand(npcId) || isAstrid(npcId))) {
      if (proposal === 1) {
        proposalStage.delete(player);
        if (option === "Yes") proposalStage.set(player, 2);
        return;
      }
      proposalStage.delete(player);
      if (option === "Yes" && !trusted(player) && consumeOneOf(player, RING_ITEM_IDS)) {
        setTrusted(player, true);
        setMarried(player, true);
        addAffection(player, 6);
        advanceStage(player, STAGE_TRUST);
      }
      return;
    }
    if (
      (isBrand(npcId) || isAstrid(npcId)) &&
      (option === "Prince Brand, will you marry me?" || option === "Princess Astrid, will you marry me?")
    ) {
      if (quest.getStage(player) === STAGE_STARTED) {
        if (!trusted(player) && !consumeOneOf(player, RING_ITEM_IDS)) return;
        if (!trusted(player)) {
          setTrusted(player, true);
          addAffection(player, 6);
          advanceStage(player, STAGE_TRUST);
        }
        setMarried(player, true);
      }
      return;
    }
    if (option === "[Random option]") {
      const brand = isBrand(npcId);
      if (!(brand || isAstrid(npcId)) || !courted(player, brand)) return;
      const variant = courtTalkVariant(player, brand);
      if (RANDOM_COURT_VARIANTS.has(variant)) {
        replayNextTick(player, () => playVariant(player, npcId, variant));
      }
      return;
    }
    if (!(isBrand(npcId) || isAstrid(npcId)) || !courted(player, isBrand(npcId))) return;
    const answers = isBrand(npcId) ? BRAND_ANSWERS : ASTRID_ANSWERS;
    const answer = answers.get(option);
    if (!answer) return;
    const [bit, affectionGain] = answer;
    if (hasBit(player, bit)) return;
    setBits(player, bits(player) | bit);
    addAffection(player, affectionGain);
  }

  function handleStartHook(event) {
    const { player, npcId, hook } = event;
    if (!player || npcId !== KING_VARGAS_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) !== 0) return;
    if (!questComplete(player, "fremennik_trials") || !questComplete(player, "heroes_quest")) {
      refusingStart.add(player);
      player.sendMessage("You must complete The Fremennik Trials and Heroes' Quest before you can help King Vargas.");
      return;
    }
    quest.setStage(player, STAGE_STARTED);
    sendSideVarbits(player);
  }

  function handleDialogueLine(event) {
    const { player, npcId, text } = event;
    if (!player || typeof text !== "string" || !OWN_NPC_IDS.has(npcId)) return;
    if (refusingStart.has(player) && REFUSAL_LINE_PREFIXES.some((prefix) => text.startsWith(prefix))) {
      event.skip = true;
      if (text.startsWith("I am sure you can form a good working relationship")) refusingStart.delete(player);
      return;
    }
    if (text.includes("[Fremennik name]")) {
      event.text = event.text.split("[Fremennik name]").join(player.getUsername?.() ?? "");
    }
    if (event.text.includes("[number]%")) {
      event.text = event.text.replace("[number]%", `${approvalPercent(player)}%`);
    }
    if (event.text.includes("{{")) {
      event.text = event.text.replace(/\{\{[^}]*\}\}/g, "").trimEnd();
    }
    const line = event.text;
    if (npcId === DERRIK_NPC_ID && quest.getStage(player) === STAGE_PEN) {
      const hasBar = held(player, IRON_BAR_ITEM_ID);
      const hasNib = held(player, GIANT_NIB_ITEM_ID) || held(player, GIANT_PEN_ITEM_ID);
      if ((!hasBar || hasNib) && (line.startsWith("I have one here") || line.startsWith("Good. Just a minute") || line.includes("One giant pen nib"))) {
        event.skip = true;
        if (!hasBar && !hasNib && line.startsWith("I have one here")) {
          player.sendMessage("You need an iron bar for Derrik to make a giant nib.");
        }
        return;
      }
      if (line.includes("One giant pen nib") && hasBar && !hasNib) {
        player.getInventory().deleteNumber(IRON_BAR_ITEM_ID, 1);
        player.getInventory().adds(GIANT_NIB_ITEM_ID, 1);
      }
      return;
    }
    if ((isBrand(npcId)) && line.includes("Here's a copy, you can keep it")) {
      if (!held(player, AWFUL_ANTHEM_ITEM_ID) && !held(player, GOOD_ANTHEM_ITEM_ID)) {
        player.getInventory().adds(AWFUL_ANTHEM_ITEM_ID, 1);
      }
      return;
    }
    if (npcId === ADVISOR_GHRIM_NPC_ID || npcId === NpcIdentifiers.ADVISOR_GHRIM_2) {
      if (line.includes("There you go") && held(player, AWFUL_ANTHEM_ITEM_ID)) {
        player.getInventory().deleteNumber(AWFUL_ANTHEM_ITEM_ID, 1);
        player.getInventory().adds(GOOD_ANTHEM_ITEM_ID, 1);
        advanceStage(player, STAGE_GOOD_ANTHEM);
      }
      return;
    }
    if (npcId === QUEEN_SIGRID_NPC_ID && line.includes("Here is a treaty declaring")) {
      if (held(player, GOOD_ANTHEM_ITEM_ID)) player.getInventory().deleteNumber(GOOD_ANTHEM_ITEM_ID, 1);
      if (!held(player, TREATY_ITEM_ID)) player.getInventory().adds(TREATY_ITEM_ID, 1);
      advanceStage(player, STAGE_TREATY);
    }
  }

  function handleAction(event) {
    const { player, npcId, stepId, kind } = event;
    if (!player) return;
    if (kind === "message" && (stepId === MESSAGE_BRAND_RING || stepId === MESSAGE_ASTRID_RING)) {
      proposalStage.delete(player);
      if (quest.getStage(player) === STAGE_STARTED && !trusted(player) && consumeOneOf(player, RING_ITEM_IDS)) {
        setTrusted(player, true);
        addAffection(player, 6);
        advanceStage(player, STAGE_TRUST);
      }
      return;
    }
    if (stepId === ACTION_COMPLETE) {
      event.handled = true;
      event.end = true;
      if (!quest.isComplete(player) && quest.getStage(player) >= STAGE_SUPPORT && approval(player) >= APPROVAL_THRESHOLD) {
        quest.complete(player);
      }
      return;
    }
    if (stepId === ACTION_OPEN_MANAGING) {
      event.handled = true;
      event.end = true;
      player.sendMessage("Managing Miscellania is not yet available on this world.");
      return;
    }
    if (stepId === ACTION_ROYAL_TROUBLE) {
      event.handled = true;
      event.end = true;
      player.sendMessage("Speak to Advisor Ghrim if you wish to investigate the kingdom's troubles.");
      return;
    }
    if (stepId === ACTION_VARGAS_PEN_CONTINUE) {
      event.handled = true;
      event.end = true;
      advanceStage(player, STAGE_SUPPORT);
      replayNextTick(player, () => playVariant(player, npcId, V_VARGAS_SIGNED));
      return;
    }
    if (
      stepId === ACTION_CHANGE_HEIRS_AFTER_TRUST ||
      stepId === ACTION_VARGAS_RECOGNISE ||
      stepId === ACTION_VARGAS_ANTHEM_AGAIN ||
      stepId === ACTION_VARGAS_TREATY ||
      stepId === ACTION_VARGAS_PEN_WAIT ||
      stepId === ACTION_VARGAS_SIGNED_TREATY ||
      stepId === ACTION_VARGAS_POST
    ) {
      event.handled = true;
      event.end = true;
      if (stepId === ACTION_VARGAS_RECOGNISE) advanceStage(player, STAGE_ANTHEM);
      if (stepId === ACTION_VARGAS_TREATY) {
        if (held(player, TREATY_ITEM_ID)) player.getInventory().deleteNumber(TREATY_ITEM_ID, 1);
        advanceStage(player, STAGE_PEN);
      }
      if (stepId === ACTION_VARGAS_SIGNED_TREATY) advanceStage(player, STAGE_SUPPORT);
      replayNextTick(player, () => playVariant(player, npcId, V_VARGAS_CHANGE_HEIRS));
    }
  }

  // ==========================================================================
  // Items
  // ==========================================================================

  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const pair = (a, b) =>
      (usedItemId === a && usedWithItemId === b) || (usedItemId === b && usedWithItemId === a);
    if (!pair(GIANT_NIB_ITEM_ID, LOGS_ITEM_ID)) return;
    event.handled = true;
    if (!held(player, GIANT_NIB_ITEM_ID) || !held(player, LOGS_ITEM_ID)) return;
    player.getInventory().deleteNumber(GIANT_NIB_ITEM_ID, 1);
    player.getInventory().deleteNumber(LOGS_ITEM_ID, 1);
    player.getInventory().adds(GIANT_PEN_ITEM_ID, 1);
    player.sendMessage("You place the nib on the end of the log to make a crude pen.");
  }

  function handleItemOnNpc(event) {
    const { player, itemId } = event;
    const npcId = event.npcId ?? event.target?.getId?.();
    if (!player || !Number.isInteger(itemId)) return;
    if (npcId === FISHERMAN_FRODI_NPC_ID) {
      if (itemId !== RAW_LOBSTER_ITEM_ID || quest.getStage(player) !== STAGE_SUPPORT) return;
      event.handled = true;
      if (!held(player, RAW_LOBSTER_ITEM_ID) || approval(player) >= APPROVAL_MAX) return;
      player.getInventory().deleteNumber(RAW_LOBSTER_ITEM_ID, 1);
      setApproval(player, approval(player) + APPROVAL_PER_ACTION);
      player.sendMessage("You give Fisherman Frodi the lobster.");
      return;
    }
    const targetBrand = isBrand(npcId);
    const targetAstrid = isAstrid(npcId);
    if (!targetBrand && !targetAstrid) return;
    if (quest.getStage(player) !== STAGE_STARTED) return;
    event.handled = true;
    const courtedHere = partner(player) === (targetBrand ? PARTNER_BRAND : PARTNER_ASTRID);
    if (!courtedHere) {
      playVariant(player, npcId, targetBrand ? V_BRAND_CROSS_ITEMS : V_ASTRID_CROSS_ITEMS);
      return;
    }
    if (FLOWER_ITEM_IDS.has(itemId)) {
      if (hasBit(player, BIT_S1_GIVE)) {
        playVariant(player, npcId, targetBrand ? V_BRAND_FLOWERS2 : V_ASTRID_FLOWERS2);
        return;
      }
      player.getInventory().deleteNumber(itemId, 1);
      setBits(player, bits(player) | BIT_S1_GIVE);
      addAffection(player, 1);
      playVariant(player, npcId, targetBrand ? V_BRAND_FLOWERS : V_ASTRID_FLOWERS);
      return;
    }
    if (RING_ITEM_IDS.has(itemId)) {
      if (!hasBit(player, BIT_KISS)) {
        playVariant(player, npcId, targetBrand ? V_BRAND_RING_EARLY : V_ASTRID_RING_EARLY);
        return;
      }
      if (trusted(player)) {
        playVariant(player, npcId, targetBrand ? V_BRAND_RING2 : V_ASTRID_RING2);
        return;
      }
      // Keep the ring until the proposal is accepted, so a logout before the
      // answer cannot consume it with no pending state to resume.
      proposalStage.set(player, 1);
      playVariant(player, npcId, targetBrand ? V_BRAND_RING : V_ASTRID_RING);
      return;
    }
    if (targetAstrid && BOW_ITEM_IDS.has(itemId)) {
      if ((bits(player) & S2_ALL) !== S2_ALL || hasBit(player, BIT_S2_GIVE)) {
        playVariant(
          player,
          npcId,
          (bits(player) & S2_ALL) === S2_ALL ? V_ASTRID_BOW2 : V_ASTRID_IRRELEVANT
        );
        return;
      }
      player.getInventory().deleteNumber(itemId, 1);
      setBits(player, bits(player) | BIT_S2_GIVE);
      addAffection(player, 1);
      playVariant(player, npcId, V_ASTRID_BOW);
      return;
    }
    if (targetBrand && CAKE_ITEM_IDS.has(itemId)) {
      if ((bits(player) & S2_ALL) !== S2_ALL || hasBit(player, BIT_S2_GIVE)) {
        playVariant(
          player,
          npcId,
          (bits(player) & S2_ALL) === S2_ALL ? V_BRAND_CAKE2 : V_BRAND_IRRELEVANT
        );
        return;
      }
      player.getInventory().deleteNumber(itemId, 1);
      setBits(player, bits(player) | BIT_S2_GIVE);
      addAffection(player, 1);
      playVariant(player, npcId, V_BRAND_CAKE);
      return;
    }
    playVariant(player, npcId, targetBrand ? V_BRAND_IRRELEVANT : V_ASTRID_IRRELEVANT);
  }

  // ==========================================================================
  // Public support
  // ==========================================================================

  function nearFrodi(player) {
    const location = player.getLocation();
    return Math.abs(location.getX() - FRODI_TILE.x) <= FRODI_HAND_IN_RANGE &&
      Math.abs(location.getY() - FRODI_TILE.y) <= FRODI_HAND_IN_RANGE;
  }

  function handleSkillingSuccess(event) {
    const { player, itemId } = event;
    if (!player || quest.getStage(player) !== STAGE_SUPPORT || !onMiscellania(player)) return;
    const before = approval(player);
    if (before >= APPROVAL_MAX) return;
    // Capture 91: a lobster catch beside Frodi is handed straight to him.
    if (itemId === RAW_LOBSTER_ITEM_ID && held(player, RAW_LOBSTER_ITEM_ID) && nearFrodi(player)) {
      player.getInventory().deleteNumber(RAW_LOBSTER_ITEM_ID, 1);
      player.sendMessage("You catch a lobster and give it to Fisherman Frodi.");
    }
    setApproval(player, before + APPROVAL_PER_ACTION);
    if (before < APPROVAL_THRESHOLD && approval(player) >= APPROVAL_THRESHOLD) {
      player.sendMessage("You have gained enough support to become regent. Speak to King Vargas.");
    }
  }

  // ==========================================================================
  // Journal / rewards / lifecycle
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I gained the trust of the heir and negotiated peace with</str>",
        "<str>Etceteria, then won the support of the Miscellanians.</str>",
        "<str>King Vargas named me regent of Miscellania.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_SUPPORT) {
      return [
        "The treaty is signed; I must win the support of the people.",
        `Current support: <col=800000>${approvalPercent(player)}%</col> (75% needed).`,
        "Mine coal, chop maples, fish or rake the patches on the islands.",
      ];
    }
    if (stage >= STAGE_PEN) {
      return ["King Vargas needs a giant pen to sign the treaty.", "Derrik can make a nib; I need an iron bar and logs."];
    }
    if (stage >= STAGE_TREATY) {
      return ["Queen Sigrid signed the treaty.", "I should show it to <col=800000>King Vargas</col>."];
    }
    if (stage >= STAGE_GOOD_ANTHEM) {
      return ["Advisor Ghrim improved the anthem.", "I should show the good anthem to <col=800000>Queen Sigrid</col>."];
    }
    if (stage >= STAGE_ANTHEM_WANTED) {
      return [
        "Queen Sigrid wants a new Etceterian anthem.",
        "Prince Brand can write one; Advisor Ghrim can improve it.",
      ];
    }
    if (stage >= STAGE_ANTHEM) {
      return ["King Vargas wants the Etceterian anthem changed.", "I should tell <col=800000>Queen Sigrid</col>."];
    }
    if (stage >= STAGE_RECOGNISE) {
      return ["Queen Sigrid wants Etceteria recognised as a sovereign nation.", "I should tell <col=800000>King Vargas</col>."];
    }
    if (stage >= STAGE_TRUST) {
      return ["I have gained the trust of the heir.", "I should negotiate peace with <col=800000>Queen Sigrid</col> in Etceteria."];
    }
    if (stage >= STAGE_STARTED) {
      const brand = partner(player) === PARTNER_BRAND;
      const name = brand ? "Prince Brand" : "Princess Astrid";
      const value = bits(player);
      let progress;
      if ((value & S1_ALL) !== S1_ALL) progress = "I should talk to them until I have impressed them.";
      else if ((value & BIT_S1_GIVE) === 0) progress = "I should give them some flowers.";
      else if ((value & S2_ALL) !== S2_ALL) progress = "I should keep talking to them.";
      else if ((value & BIT_S2_GIVE) === 0) progress = brand ? "I should give them a cake." : "I should give them a bow.";
      else if ((value & S3_ALL) !== S3_ALL) progress = "I should keep talking to them.";
      else progress = "I should get down on one knee with a ring.";
      return [`I must gain the trust of <col=800000>${name}</col>.`, progress];
    }
    return [
      "I can start this quest by talking to <col=800000>King Vargas</col> in Miscellania Castle.",
      "It requires The Fremennik Trials and Heroes' Quest.",
    ];
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
    sendSideVarbits(player);
  }

  function handleBootstrapComplete({ player }) {
    sendSideVarbits(player);
  }

  api.persistAttribute(BITS_ATTRIBUTE);
  api.persistAttribute(PARTNER_ATTRIBUTE);
  api.persistAttribute(TRUST_ATTRIBUTE);
  api.persistAttribute(MARRIED_ATTRIBUTE);
  api.persistAttribute(AFFECTION_ATTRIBUTE);
  api.persistAttribute(APPROVAL_ATTRIBUTE);
  api.persistAttribute(APPROVAL_NATIVE_ATTRIBUTE, -1);

  quest = registerQuest(api, {
    key: "throne_of_miscellania",
    name: "Throne of Miscellania",
    varpId: VARP_THRONE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    otherRewards: ["Access to Managing Miscellania", "10,000 coins in the Miscellania coffers"],
    buildJournal,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("player:emote", handleEmote);
  api.onItemOnNpc(handleItemOnNpc, { noted: false });
  api.onItemOnItem(handleItemOnItem);
  api.onCustomEvent("mining:success", handleSkillingSuccess);
  api.onCustomEvent("woodcutting:success", handleSkillingSuccess);
  api.onCustomEvent("fishing:success", handleSkillingSuccess);
  api.onPlayerLogin(handleLogin);
  api.onCustomEvent("player:bootstrap-complete", handleBootstrapComplete);
};
