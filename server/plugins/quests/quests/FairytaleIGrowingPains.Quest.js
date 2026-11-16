/**
 * Fairytale I - Growing Pains (members).
 *
 * The words come from the "Fairytale I - Growing Pains" transcript page, aligned with the user's
 * revision 242 capture (FairyTale1, docs/quests/fairytale-i-growing-pains/README.md) in
 * osrsreboxed-db's capture sources; the NPCs' own pages ("Martin the Master Gardener", "Fairy Nuff",
 * "Malignius Mortifer", "Zandar Horfyre", "Gatekeeper") supply their non-quest options. What happens
 * when follows the captures: tick numbers below are FairyTale1's unless a recording is named
 * (1001455 is the user's revision 241 run, 424 an rsprox.net revision 232 recording).
 *
 * Stages (varp 671 "fairytale_multi", varbit 1803 "fairy_farmers_quest" bits 0-6):
 *   0 not started,
 *   10 Martin asked me to talk to the gardeners (set as "If I were you I would start by speaking..."
 *      shows, 171),
 *   20 the five gardeners reported (Martin's "Hello again" line, 1065),
 *   30 the Fairy Godfather sent me to Fairy Nuff (after the player's "?", 1370),
 *   40 Fairy Nuff gave me the symptoms list (after "Here, I've written down a list...", 1525),
 *   50 Zandar Horfyre diagnosed the Queen (after "So I guess I need to go and kill...", 1748),
 *   60 Malignius Mortifer taught me the recipe (after "Yes, I have it right here.", 2404),
 *   70 the Nature Spirit enchanted my secateurs (six ticks into the blessing, 3271),
 *   80 I picked up the Queen's secateurs (3997),
 *   90 complete (after "Grazie infinite!", 4181).
 * Older saves used 30..80 for the stages after the Godfather conversation, so migrateStage moves
 * them to 40..90 once.
 *
 * Varbits sharing varp 671: 1804-1806 hold the three nature items as indexes 0-30 into the Wiki's
 * ordered list (17-19 named a raw cave eel, edible seaweed and an oyster, FairyTale1 tick 2404; 10-12
 * a potato cactus, crushed gem and snapdragon, 1001455 tick 1940), cleared at completion; 1807 moves
 * the Queen to Nuff's room and 1808 shows the Godfather and his henchmen, both set on reaching Zanaris
 * at stage 20 (1255; still 0 at stage 10); 1809 is Fairy Nuff's first meeting (1602).
 *
 * Gaps (Ours, no source): see docs/quests/fairytale-i-growing-pains/README.md "Not covered".
 */
module.exports = function registerFairytaleIGrowingPainsQuest(api) {
  const {
    Animation,
    CacheDefinitions,
    ChatType,
    CountdownTask,
    Equipment,
    ItemIdentifiers,
    Location,
    Misc,
    NpcIdentifiers,
    ObjectIdentifiers,
    Skill,
    Sound,
    Sounds,
    TaskManager,
  } = api.core;
  const QuestRuntime = require("../QuestRuntime");
  const { registerQuest, refreshQuestList, startTranscript, questStartMessage } = QuestRuntime;
  const { buildLines } = require("../fairytalei/Journal.FairytaleIGrowingPains");
  const createFairytaleIScenes = require("../fairytalei/Scenes.FairytaleIGrowingPains");

  const PAGE = "Fairytale I - Growing Pains";
  const GATEKEEPER_PAGE = "Gatekeeper";
  const QUEST_NAME = "Fairytale I - Growing Pains";

  const MARTIN_NPC_ID = NpcIdentifiers.MARTIN_THE_MASTER_GARDENER; // 5832
  const FAIRY_NUFF_NPC_IDS = new Set([NpcIdentifiers.FAIRY_NUFF, NpcIdentifiers.FAIRY_NUFF_2]); // 1841, 5836
  const FAIRY_GODFATHER_NPC_IDS = new Set([
    NpcIdentifiers.FAIRY_GODFATHER,
    NpcIdentifiers.FAIRY_GODFATHER_2, // 1840, 5837
  ]);
  const ZANDAR_NPC_ID = NpcIdentifiers.ZANDAR_HORFYRE; // 5841
  const MALIGNIUS_NPC_ID = NpcIdentifiers.MALIGNIUS_MORTIFER; // 1783
  const NATURE_SPIRIT_NPC_ID = NpcIdentifiers.NATURE_SPIRIT; // 944
  const NATURE_SPIRIT_NPC_IDS = new Set([NpcIdentifiers.NATURE_SPIRIT, NpcIdentifiers.FILLIMAN_TARLOCK]); // 944, 943
  const GATEKEEPER_NPC_ID = NpcIdentifiers.GATEKEEPER_2; // 5855, the grove guard (6534 transformed)
  /** Only magic secateurs hurt these (the Wiki; 1001455 tick 3033, 424 tick 18688). */
  const SECATEURS_ONLY_NPC_IDS = new Set([
    NpcIdentifiers.TANGLEFOOT, // 5848
    NpcIdentifiers.BABY_TANGLEFOOT, // 5853
    NpcIdentifiers.BABY_TANGLEFOOT_2, // 5854
  ]);

  // Group of Advanced Gardeners members that predate Old School RuneScape.
  const GARDENER_NPC_IDS = new Set([
    NpcIdentifiers.ELSTAN, // 2663
    NpcIdentifiers.DANTAERA, // 2664
    NpcIdentifiers.KRAGEN, // 2665
    NpcIdentifiers.LYRA, // 2666
    NpcIdentifiers.FRANCIS, // 2667
    NpcIdentifiers.GARTH, // 2669
    NpcIdentifiers.ELLENA, // 2670
    NpcIdentifiers.SELENA, // 2671
    NpcIdentifiers.VASQUEN, // 2672
    NpcIdentifiers.RHONEN, // 2673
    NpcIdentifiers.DREVEN, // 2674
    NpcIdentifiers.TARIA, // 2675
    NpcIdentifiers.RHAZIEN, // 2676
    NpcIdentifiers.TORRELL, // 2677
    NpcIdentifiers.ALAIN, // 2678
    NpcIdentifiers.HESKEL, // 2679
    NpcIdentifiers.TREZNOR, // 2680
    NpcIdentifiers.FAYETH, // 2681
    NpcIdentifiers.BOLONGO, // 2682
    NpcIdentifiers.GILETH, // 2683
    NpcIdentifiers.FRIZZY_SKERNIP, // 2684
    NpcIdentifiers.YULF_SQUECKS, // 2685
    NpcIdentifiers.PRAISTAN_EBOLA, // 2686
    NpcIdentifiers.PRISSY_SCILLA, // 2687
    NpcIdentifiers.LILIWEN, // 2689
    NpcIdentifiers.GARDENER, // 3275
    NpcIdentifiers.GARDENER_2, // 3276
    NpcIdentifiers.GARDENER_3, // 3651
    NpcIdentifiers.GARDENER_4, // 5512
    NpcIdentifiers.TREZNOR_2, // 11957
  ]);
  // Farmers added after the OSRS launch: the invalid-gardener answer.
  const INVALID_GARDENER_NPC_IDS = new Set([
    NpcIdentifiers.AYESHA, // 310
    NpcIdentifiers.IMIAGO, // 2688
    NpcIdentifiers.LAMMY_LANGLE, // 6814
    NpcIdentifiers.MARISI, // 6921
  ]);

  const STAGE_STARTED = 10;
  const STAGE_GARDENERS_REPORTED = 20;
  const STAGE_TALKED_TO_GODFATHER = 30;
  const STAGE_HAS_SYMPTOMS_LIST = 40;
  const STAGE_DIAGNOSED = 50;
  const STAGE_HAS_RECIPE = 60;
  const STAGE_HAS_MAGIC_SECATEURS = 70;
  const STAGE_TANGLEFOOT_DEFEATED = 80;
  const STAGE_COMPLETE = 90;

  const STAGE_SCHEMA_ATTRIBUTE = "quest.fairytale-i-growing-pains:stage-schema";
  const STAGE_SCHEMA = 1;
  // Older saves numbered the post-Godfather stages 30..80; they are now 40..90.
  const LEGACY_STAGE_VALUES = { 30: 40, 40: 50, 50: 60, 60: 70, 70: 80, 80: 90 };
  const LEGACY_STAGE_COMPLETE = 80;

  const VARP_FAIRYTALE = 671;
  const VARBIT_FAIRYTALE_QUEST = 1803; // "fairy_farmers_quest", bits 0-6
  const VARBIT_NATURE_ITEMS = [1804, 1805, 1806]; // "fairy_nature_item1-3", bits 7-21
  const VARBIT_FAIRY_QUEEN_CHECK = 1807; // 1 = Queen in Nuff's room, not on the throne
  const VARBIT_FAIRY_GODFATHER_CHECK = 1808; // 1 = Godfather and henchmen visible
  const VARBIT_FAIRY_NUFF_CHECK = 1809; // 1 = Nuff has introduced herself, bits 26-27
  const FT2_KEY = "fairytale_ii_cure_a_queen";
  /** Fairytale II's stage from which it sets 1808 to 2 (its Pick-pocket Godfather). */
  const FT2_PICKPOCKET_STAGE = 50;

  const GARDENERS_ATTRIBUTE = "quest.fairytale-i-growing-pains:gardeners";
  const MALIGNIUS_ASKED_ATTRIBUTE = "quest.fairytale-i-growing-pains:malignius-asked";
  /** The three nature items as 1-based rows of the Wiki's list; the varbits send row - 1. */
  const NATURE_ITEMS_ATTRIBUTE = "quest.fairytale-i-growing-pains:nature-items";
  const NUFF_MET_ATTRIBUTE = "quest.fairytale-i-growing-pains:nuff-met";

  const SECATEURS_ITEM_ID = ItemIdentifiers.SECATEURS; // 5329
  const MAGIC_SECATEURS_ITEM_ID = ItemIdentifiers.MAGIC_SECATEURS; // 7409
  const QUEENS_SECATEURS_ITEM_ID = ItemIdentifiers.QUEENS_SECATEURS; // 7410
  const SYMPTOMS_LIST_ITEM_ID = ItemIdentifiers.SYMPTOMS_LIST; // 7411
  const DRAYNOR_SKULL_ITEM_ID = ItemIdentifiers.DRAYNOR_SKULL; // 7408
  const GHOSTSPEAK_AMULET_ITEM_ID = ItemIdentifiers.GHOSTSPEAK_AMULET; // 552
  const SPADE_ITEM_ID = ItemIdentifiers.SPADE; // 952
  const COINS_ITEM_ID = ItemIdentifiers.COINS;
  const SECATEURS_PRICE = 40000;

  const DRAYNOR_GRAVE_OBJECT_ID = ObjectIdentifiers.GRAVESTONE_8; // 12125 at 3106,3384
  const DRAYNOR_GRAVE_TILE = new Location(3106, 3384, 0);
  // Cache 241: human_dig_long 831 has eight frames, length 39, loops 99 and no
  // frame sounds; capture 3209 sends its separate 1470 synth as loops=1/delay=0
  // and loops=3/delay=25.
  const HUMAN_DIG_LONG_SEQUENCE = 831;
  const DRAYNOR_DIG_TICKS = 4;
  const DRAYNOR_DIG_SOUND_ID = 1470;
  const DRAYNOR_DIG_SOUND_DELAY = 25;
  const DRAYNOR_DIG_SOUND_LOOPS = 3;
  /** The player's overhead as the dig starts (FairyTale1 tick 2216). */
  const DRAYNOR_DIG_OVERHEAD = "I can't believe I'm about to do this!";
  // 12004 is the static gap at 2397,4379; 11999 is the placed loc at 2399,4379
  // whose varbit-1803 transform is 12041 "A gap through the wall". Object click
  // events carry the placed id, and 11999 has no generated identifier.
  const GROVE_WALL_OBJECT_ID = 11999; // 11999 -> 12041 during the quest
  const GROVE_GAP_OBJECT_IDS = new Set([
    ObjectIdentifiers.A_GAP_THROUGH_THE_WALL, // 12004
    GROVE_WALL_OBJECT_ID, // 11999
  ]);
  /** Up to this x (in source coordinates) is the tunnel side of the gap at 2397. */
  const GROVE_INSIDE_MAX_X = 2396;

  /**
   * The Wiki's ordered nature-item list. The varbit is the row's index from 0. The journal and
   * Malignius name the items as live does where a capture shows them (rows 11-13, 18-20); the
   * other names are Ours.
   */
  const NATURE_ITEMS = [
    { id: ItemIdentifiers.WHITE_BERRIES, name: "white berries" },
    { id: ItemIdentifiers.MORT_MYRE_PEAR, name: "a mort myre pear" },
    { id: ItemIdentifiers.MORT_MYRE_STEM, name: "a mort myre stem" },
    { id: ItemIdentifiers.MORT_MYRE_FUNGUS, name: "a mort myre fungus" },
    { id: ItemIdentifiers.NATURE_TALISMAN, name: "a nature talisman" },
    { id: ItemIdentifiers.AVANTOE, name: "clean avantoe" },
    { id: ItemIdentifiers.IRIT_LEAF, name: "clean irit leaf" },
    { id: ItemIdentifiers.BLUE_DRAGON_SCALE, name: "a blue dragon scale" },
    { id: ItemIdentifiers.PROBOSCIS, name: "a proboscis" },
    { id: ItemIdentifiers.JANGERBERRIES, name: "jangerberries" },
    { id: ItemIdentifiers.POTATO_CACTUS, name: "a Potato cactus" }, // 1001455 tick 1943
    { id: ItemIdentifiers.CRUSHED_GEM, name: "a crushed gemstone" }, // 1001455 tick 1943
    { id: ItemIdentifiers.SNAPDRAGON, name: "some Snapdragon" }, // 1001455 tick 1943
    { id: ItemIdentifiers.SUPERCOMPOST, name: "supercompost" },
    { id: ItemIdentifiers.VOLENCIA_MOSS, name: "clean volencia moss" },
    { id: ItemIdentifiers.BABYDRAGON_BONES, name: "babydragon bones" },
    { id: ItemIdentifiers.UNCUT_DIAMOND, name: "an uncut diamond" },
    { id: ItemIdentifiers.RAW_CAVE_EEL, name: "a raw cave eel" }, // ticks 2413, 2480
    { id: ItemIdentifiers.EDIBLE_SEAWEED, name: "some edible seaweed" }, // ticks 2413, 2480
    { id: ItemIdentifiers.OYSTER, name: "an unopened oyster" }, // ticks 2413, 2480
    { id: ItemIdentifiers.CHARCOAL, name: "charcoal" },
    { id: ItemIdentifiers.RED_VINE_WORM, name: "a red vine worm" },
    { id: ItemIdentifiers.FAT_SNAIL, name: "a fat snail" },
    { id: ItemIdentifiers.RED_SPIDERS_EGGS, name: "red spiders' eggs" },
    { id: ItemIdentifiers.RAW_SLIMY_EEL, name: "a raw slimy eel" },
    { id: ItemIdentifiers.GRAPES, name: "grapes" },
    { id: ItemIdentifiers.UNCUT_RUBY, name: "an uncut ruby" },
    { id: ItemIdentifiers.JOGRE_BONES, name: "jogre bones" },
    { id: ItemIdentifiers.KING_WORM, name: "a king worm" },
    { id: ItemIdentifiers.SNAPE_GRASS, name: "snape grass" },
    { id: ItemIdentifiers.LIME, name: "a lime" },
  ];

  // Transcript step ids and lines.
  const ENCHANT_ACTION_ID = "JQyqMZ";
  const GROVE_ENTER_ACTION_ID = "EwGK2L";
  const GROVE_REENTER_ACTION_ID = "HxBLkD";
  const RECEIVE_SECATEURS_ACTION_ID = "pZt1sS";
  const COMPLETE_ACTION_ID = "Z_ZWiI";
  const LOST_SECATEURS_CONDITION_ID = "jC0-xh";

  const START_HOOK = "quest:fairytale-i-growing-pains:start";
  const GARDENER_QUESTION = "Are you a member of the Group of Advanced Gardeners?";
  const GARDENER_REPORTED_ACTION = "fairytale-i-growing-pains:gardener-reported";

  const STARTED_LINE = "If I were you I would start by speaking to some of the other gardeners.";
  const MARTIN_REPORT_LINE = "Hello again, [player name]. How are you getting on with solving the Gardening Group's problems?";
  const GODFATHER_LAST_LINE = "?";
  const GODFATHER_DISMISSAL = "The Godfather is no longer paying attention to you.";
  const GODFATHER_IGNORING = "The Godfather is ignoring you.";
  const NUFF_LIST_LINE = "Here, I've written down a list of her symptoms.";
  const NUFF_COPY_LINE = "Well not to worry, I have a copy of it here.";
  const NUFF_INTRODUCED_LINE = "Maybe to you, but you'd be surprised how many adventurer's are willing to pay those prices.";
  const ZANDAR_DIAGNOSIS_LINE = "So I guess I need to go and kill this Tanglefoot and get back her magic essence if I am to help her?";
  const ZANDAR_HARD_WAY_LINE = "Actually, that wasn't an invitation. I've tried being polite, now we'll do it the hard way!";
  const ZANDAR_TELEPORT_ACTION = "The player is teleported to the Lumbridge swamp";
  const MALIGNIUS_SKULL_LINES = new Set(["Yes, I have it right here.", "Excellent, hand it over then."]);
  const MALIGNIUS_MUSHROOM_LINE = "How about if I turn you into a mushroom to make you stop bothering me?";
  const MALIGNIUS_MUSHROOM_ACTION = "The player is transformed into a mushroom.";
  const MALIGNIUS_MUSHROOM_CAST_TICKS = 2;
  const MALIGNIUS_NECROMANCY_LAST = "Thanks, I'll be off now.";
  const BLESSING_LINE = "Then let us begin...";
  const ZANDAR_TELEPORT_PAUSE_TICKS = 1;

  const GATEKEEPER_REFUSAL_VARIANT =
    "gatekeeper-near-the-entrance-to-the-tanglefoot-s-lair-attempting-to-enter-the-shady-grove-without-magic-secateurs";
  const GATEKEEPER_AFTER_VARIANT =
    "gatekeeper-near-the-entrance-to-the-tanglefoot-s-lair-after-fairytale-i";
  const ZANDAR_VARIANT = "at-the-dark-wizard-s-tower-talking-to-zandar-horfyre";
  const MARTIN_RETURNING_VARIANT = "talking-to-the-gardeners-returning-to-martin";
  const GARDENER_ALREADY_VARIANT = "talking-to-the-gardeners-if-the-player-has-already-talked-to-them";
  const GARDENER_AFTER_FIVE_VARIANT = "talking-to-the-gardeners-talking-to-other-gardeners-after-having-already-asked-five";
  const NUFF_INITIAL_VARIANT = "initial-dialogue-before-fairytale-part-1";
  const NUFF_SUBSEQUENT_VARIANT = "initial-dialogue-before-fairytale-part-1-subsequent-dialogue";
  const NATURE_SPIRIT_LOST_VARIANT = "in-the-nature-grotto-talking-to-the-nature-spirit-after-losing-the-secateurs";

  /**
   * The transcript's quest=No options, which the export leaves empty: each plays its branch from
   * the NPC's own page (the options and pages they come from).
   */
  const OWN_PAGE_OPTIONS = {
    martin: { page: "Martin the Master Gardener", variant: "standard-dialogue", options: ["Ask about the Skillcape of Farming."] },
    gardener: { options: ["Can you give me any farming advice?", "Can you sell me something?", "I'll come back another time."] },
    malignius: {
      page: "Malignius Mortifer", variant: "standard-dialogue",
      options: ["Who are you and what are you doing here?", "Where can I get clothes like those?"],
    },
    nuff: { page: "Fairy Nuff", variant: NUFF_SUBSEQUENT_VARIANT, options: ["Yes, please. I need healing.", "No thanks. Just looking around."] },
  };
  /** Malignius after the quest, as live shows him (4454-4482): no greeting, this menu. */
  const MALIGNIUS_AFTER_PROMPT = "What would you like to say?";
  const MALIGNIUS_AFTER_OPTIONS = [
    "Who are you and what are you doing here?",
    "About those enchanted secateurs again...",
    "Where can I get clothes like those?",
  ];

  let quest;
  const draynorDigTasks = new Map();
  const Scenes = createFairytaleIScenes(api);

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;
  const onPage = (event) => event.pages?.some(({ page }) => page === PAGE);

  /** The magic secateurs are a weapon: a pair in the weapon slot is still the player's pair. */
  const wieldsMagicSecateurs = (player) =>
    player.getEquipment().get(Equipment.WEAPON_SLOT)?.getId?.() === MAGIC_SECATEURS_ITEM_ID;
  const hasMagicSecateurs = (player) => held(player, MAGIC_SECATEURS_ITEM_ID) || wieldsMagicSecateurs(player);

  function advance(player, value) {
    if (quest.getStage(player) < value && !quest.isComplete(player)) quest.setStage(player, value);
  }

  /** Moves saves written before the Godfather stage existed onto the cache's values. */
  function migrateStage({ player }) {
    if (Number(player.getAttribute(STAGE_SCHEMA_ATTRIBUTE)) >= STAGE_SCHEMA) return;
    const migrated = LEGACY_STAGE_VALUES[quest.getStage(player)];
    player.setAttribute(STAGE_SCHEMA_ATTRIBUTE, STAGE_SCHEMA);
    if (migrated !== undefined) quest.setStage(player, migrated);
  }

  function actionOf(event) {
    return String(event.definition?.getActions?.()?.[event.clickType - 1] ?? "").toLowerCase();
  }

  function askedGardeners(player) {
    return String(player.getAttribute(GARDENERS_ATTRIBUTE) ?? "")
      .split(",")
      .map(Number)
      .filter((npcId) => Number.isInteger(npcId) && npcId > 0);
  }

  /** The first five answers count (Martin, the journal); later gardeners only remember being asked. */
  const reportedGardeners = (player) => Math.min(askedGardeners(player).length, 5);

  function wearingGhostspeak(player) {
    return player.getEquipment().get(Equipment.AMULET_SLOT)?.getId?.() === GHOSTSPEAK_AMULET_ITEM_ID;
  }

  function natureItemPositions(player) {
    return String(player.getAttribute(NATURE_ITEMS_ATTRIBUTE) ?? "")
      .split(",")
      .map(Number)
      .filter((position) => position >= 1 && position <= NATURE_ITEMS.length);
  }

  function requiredNatureItems(player) {
    return natureItemPositions(player).map((position) => NATURE_ITEMS[position - 1]);
  }

  function hasEnchantingItems(player) {
    const ids = requiredNatureItems(player).map((entry) => entry.id);
    return ids.length === 3 && held(player, SECATEURS_ITEM_ID) && ids.every((id) => held(player, id));
  }

  function rollNatureItems(player) {
    const first = Misc.randomInclusive(1, NATURE_ITEMS.length - 2);
    player.setAttribute(NATURE_ITEMS_ATTRIBUTE, [first, first + 1, first + 2].join(","));
  }

  function ft2Stage(player) {
    return QuestRuntime.getRegisteredQuests().findLast((entry) => entry.key === FT2_KEY)?.getStage(player) ?? 0;
  }

  /** Every sibling varbit of varp 671 this quest owns, from the saved state. */
  function sendProgressVarbits(player) {
    const sender = player.getPacketSender();
    const stage = quest.getStage(player);
    const zanaris = stage >= STAGE_GARDENERS_REPORTED ? 1 : 0;
    sender.sendVarbit(VARBIT_FAIRY_QUEEN_CHECK, zanaris);
    // Fairytale II turns the Godfather into its Pick-pocket version (2) from its own stage 50.
    if (ft2Stage(player) < FT2_PICKPOCKET_STAGE) sender.sendVarbit(VARBIT_FAIRY_GODFATHER_CHECK, zanaris);
    const positions = stage >= STAGE_HAS_RECIPE && stage < STAGE_COMPLETE ? natureItemPositions(player) : [];
    VARBIT_NATURE_ITEMS.forEach((varbit, index) => sender.sendVarbit(varbit, positions[index] ? positions[index] - 1 : 0));
    sender.sendVarbit(VARBIT_FAIRY_NUFF_CHECK, Number(player.getAttribute(NUFF_MET_ATTRIBUTE)) > 0 ? 1 : 0);
  }

  // ==========================================================================
  // Transcript selection
  // ==========================================================================

  function martinVariant(player, stage) {
    if (stage >= STAGE_COMPLETE) return null;
    if (stage < STAGE_STARTED) return "starting-the-quest";
    // Captured at 20 (1084); Ours for 30-80, which no source covers.
    if (stage >= STAGE_GARDENERS_REPORTED) return MARTIN_RETURNING_VARIANT;
    const asked = reportedGardeners(player);
    if (asked >= 5) return MARTIN_RETURNING_VARIANT;
    if (asked > 0) return `talking-to-the-gardeners-gardener-${asked}-reporting-to-martin`;
    return "starting-the-quest-talking-to-martin-again";
  }

  /** Nuff's own page: her introduction until she has given it (1555-1602), then her shorter greeting (3485). */
  const nuffOwnVariant = (player) =>
    Number(player.getAttribute(NUFF_MET_ATTRIBUTE)) > 0 ? NUFF_SUBSEQUENT_VARIANT : NUFF_INITIAL_VARIANT;

  function nuffVariant(player, stage) {
    if (stage >= STAGE_COMPLETE) return "after-fairytale-part-1";
    if (stage >= STAGE_TANGLEFOOT_DEFEATED) return "after-defeating-the-tanglefoot-returning-to-fairy-nuff-first";
    if (stage >= STAGE_HAS_SYMPTOMS_LIST && stage < STAGE_DIAGNOSED && !held(player, SYMPTOMS_LIST_ITEM_ID)) {
      return "entering-zanaris-talking-to-fairy-nuff-again";
    }
    // The Godfather's errand (1450); before it and between the errands, her own page (1555, 3485).
    if (stage >= STAGE_TALKED_TO_GODFATHER && stage < STAGE_HAS_SYMPTOMS_LIST) return "entering-zanaris-talking-to-fairy-nuff";
    return nuffOwnVariant(player);
  }

  function godfatherVariant(stage) {
    if (stage >= STAGE_COMPLETE) return null;
    if (stage >= STAGE_TANGLEFOOT_DEFEATED) return "after-defeating-the-tanglefoot-returning-to-the-fairy-godfather";
    if (stage >= STAGE_TALKED_TO_GODFATHER) return "entering-zanaris-trying-to-talk-to-the-fairy-godfather-again";
    if (stage >= STAGE_GARDENERS_REPORTED) return "entering-zanaris-talking-to-the-fairy-godfather";
    return null;
  }

  function maligniusVariant(player, stage) {
    if (stage < STAGE_DIAGNOSED || stage >= STAGE_COMPLETE) return null;
    if (stage >= STAGE_HAS_RECIPE) {
      return "talking-to-malignius-mortifer-talking-to-malignius-again-after-learning-how-to-kill-the-tanglefoot";
    }
    if (Number(player.getAttribute(MALIGNIUS_ASKED_ATTRIBUTE)) > 0) {
      return "talking-to-malignius-mortifer-talking-to-malignius-again-before-getting-the-skull";
    }
    return "talking-to-malignius-mortifer";
  }

  function natureSpiritVariant(player, stage) {
    if (stage < STAGE_HAS_RECIPE || stage >= STAGE_COMPLETE) return null;
    if (!wearingGhostspeak(player)) return "in-the-nature-grotto-without-a-ghostspeak-amulet";
    // After the blessing he asks why the player is back (1001455 tick 2520), secateurs or not.
    if (stage >= STAGE_HAS_MAGIC_SECATEURS) return NATURE_SPIRIT_LOST_VARIANT;
    return "in-the-nature-grotto-talking-to-the-nature-spirit";
  }

  function gatekeeperVariant(stage) {
    if (stage >= STAGE_TANGLEFOOT_DEFEATED) return GATEKEEPER_AFTER_VARIANT;
    if (stage >= STAGE_STARTED) return "shady-grove";
    return null;
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (npcId === MARTIN_NPC_ID) return martinVariant(player, stage);
    if (FAIRY_NUFF_NPC_IDS.has(npcId)) return nuffVariant(player, stage);
    if (FAIRY_GODFATHER_NPC_IDS.has(npcId)) return godfatherVariant(stage);
    if (npcId === ZANDAR_NPC_ID) return stage === STAGE_HAS_SYMPTOMS_LIST ? ZANDAR_VARIANT : null;
    if (npcId === MALIGNIUS_NPC_ID) return maligniusVariant(player, stage);
    if (NATURE_SPIRIT_NPC_IDS.has(npcId)) return natureSpiritVariant(player, stage);
    if (npcId === GATEKEEPER_NPC_ID) return gatekeeperVariant(stage);
    return null;
  }

  // ==========================================================================
  // Prose conditions
  // ==========================================================================

  function answerCondition({ npcId, player, stepId, text }) {
    if (npcId === MARTIN_NPC_ID) {
      // The start conversation branches on pickpocketing Martin; only the
      // no-pickpocket and Farming-trained answers are modelled.
      if (stepId === "nWr7FB") return false;
      if (stepId === "7kb35l") return true;
      if (stepId === "O3O0GH") return player.getSkillManager().getMaxLevel(Skill.FARMING) <= 1;
      if (stepId === "qeSx96") return player.getSkillManager().getMaxLevel(Skill.FARMING) > 1;
      return null;
    }
    if (npcId === ZANDAR_NPC_ID) {
      if (text === "If the player has the symptoms list:") return held(player, SYMPTOMS_LIST_ITEM_ID);
      if (text === "If the player doesn't have the symptoms list:") return !held(player, SYMPTOMS_LIST_ITEM_ID);
      return null;
    }
    if (npcId === MALIGNIUS_NPC_ID) {
      const skull = held(player, DRAYNOR_SKULL_ITEM_ID);
      if (text === "If the player already has the skull in their inventory:" || text === "If the player has brought the skull:") return skull;
      if (text === "If the player does not have the skull in their inventory:" || text === "If the player has not brought the skull:") {
        if (!skull && quest.getStage(player) === STAGE_DIAGNOSED) player.setAttribute(MALIGNIUS_ASKED_ATTRIBUTE, 1);
        return !skull;
      }
      if (text === "If Zogre Flesh Eaters has been completed:") return questIsComplete(player, "zogre_flesh_eaters");
      if (text === "If Zogre Flesh Eaters hasn't been completed:") return !questIsComplete(player, "zogre_flesh_eaters");
      if (/^If the player has at least 40,000 coins, and enough inventory space:$/.test(text)) {
        return held(player, COINS_ITEM_ID, SECATEURS_PRICE) && player.getInventory().getFreeSlots() > 0;
      }
      if (/^If the player has at least 40,000 coins, but no inventory space:$/.test(text)) {
        return held(player, COINS_ITEM_ID, SECATEURS_PRICE) && player.getInventory().getFreeSlots() === 0;
      }
      if (/^If the player does not have at least 40,000 coins:$/.test(text)) return !held(player, COINS_ITEM_ID, SECATEURS_PRICE);
      return null;
    }
    if (NATURE_SPIRIT_NPC_IDS.has(npcId)) {
      if (text === "If the player has the required items:") return hasEnchantingItems(player);
      if (text === "If the player does not have the required items:") return !hasEnchantingItems(player);
      if (text === "If the player has the magic secateurs:") return hasMagicSecateurs(player);
      if (text === "If the player does not have the magic secateurs:") return !hasMagicSecateurs(player);
      return null;
    }
    if (npcId === GATEKEEPER_NPC_ID) {
      if (stepId === LOST_SECATEURS_CONDITION_ID) return !held(player, QUEENS_SECATEURS_ITEM_ID);
      return null;
    }
    return null;
  }

  // ==========================================================================
  // Dialogue lines: what happens as a line shows or once it is continued
  // ==========================================================================

  function questIsComplete(player, key) {
    const request = { player, key, complete: undefined };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  /** The Wiki's "[item 1]" blanks name the rolled items. */
  function fillItems(event) {
    if (event.npcId !== MALIGNIUS_NPC_ID || event.step?.speaker !== "Malignius Mortifer") return;
    const items = requiredNatureItems(event.player);
    if (items.length === 3) event.text = event.text.replace(/\[item\s*([123])\]/gi, (_, index) => items[Number(index) - 1].name);
  }

  /** The line as the transcript has it: another handler may already have filled "[player name]". */
  const rawText = (event) => event.step?.text ?? event.step?.player ?? event.step?.npc ?? event.text;

  function handleQuestLine(event) {
    const { player, npcId } = event;
    const text = rawText(event);
    if (GARDENER_NPC_IDS.has(npcId) || INVALID_GARDENER_NPC_IDS.has(npcId)) {
      if (/^\[Gardener(?: #\d+)?\]$/.test(event.step?.speaker ?? "")) event.speakerName = event.definition.getName();
      return;
    }
    fillItems(event);
    const stage = quest.getStage(player);
    if (npcId === MARTIN_NPC_ID) {
      // The quest starts as Martin's answer shows (171), with live's start message.
      if (text === STARTED_LINE && stage === 0) event.before = () => startQuest(player);
      if (text === MARTIN_REPORT_LINE && stage === STAGE_STARTED) event.before = () => advance(player, STAGE_GARDENERS_REPORTED);
      return;
    }
    if (FAIRY_GODFATHER_NPC_IDS.has(npcId) && text === GODFATHER_LAST_LINE && stage === STAGE_GARDENERS_REPORTED) {
      event.after = () => {
        player.sendMessage(GODFATHER_DISMISSAL);
        advance(player, STAGE_TALKED_TO_GODFATHER);
      };
      return;
    }
    if (FAIRY_NUFF_NPC_IDS.has(npcId) && (text === NUFF_LIST_LINE || text === NUFF_COPY_LINE)) {
      event.after = () => {
        const now = quest.getStage(player);
        if (now < STAGE_TALKED_TO_GODFATHER || now >= STAGE_DIAGNOSED) return;
        if (!held(player, SYMPTOMS_LIST_ITEM_ID)) player.getInventory().adds(SYMPTOMS_LIST_ITEM_ID, 1);
        if (held(player, SYMPTOMS_LIST_ITEM_ID)) advance(player, STAGE_HAS_SYMPTOMS_LIST);
      };
      return;
    }
    if (npcId === ZANDAR_NPC_ID && text === ZANDAR_DIAGNOSIS_LINE) {
      event.after = () => {
        if (quest.getStage(player) !== STAGE_HAS_SYMPTOMS_LIST || !held(player, SYMPTOMS_LIST_ITEM_ID)) return;
        player.getInventory().deleteNumber(SYMPTOMS_LIST_ITEM_ID, 1);
        advance(player, STAGE_DIAGNOSED);
      };
      return;
    }
    if (npcId === MALIGNIUS_NPC_ID && MALIGNIUS_SKULL_LINES.has(text)) {
      event.after = () => {
        if (quest.getStage(player) !== STAGE_DIAGNOSED || !held(player, DRAYNOR_SKULL_ITEM_ID)) return;
        player.getInventory().deleteNumber(DRAYNOR_SKULL_ITEM_ID, 1);
        rollNatureItems(player);
        advance(player, STAGE_HAS_RECIPE);
      };
      return;
    }
    if (NATURE_SPIRIT_NPC_IDS.has(npcId) && text === BLESSING_LINE && stage < STAGE_COMPLETE) {
      const spirit = event.npc;
      event.after = () => Scenes.startBlessing(player, spirit);
      event.pauseTicks = Scenes.BLESSING_TICKS;
    }
  }

  /** Nuff's and Zandar's and Malignius's own pages, which this quest's scenes play through. */
  function handleOwnPageLine(event) {
    const { player, npcId } = event;
    const text = rawText(event);
    if (FAIRY_NUFF_NPC_IDS.has(npcId) && text === NUFF_INTRODUCED_LINE) {
      event.after = () => {
        player.setAttribute(NUFF_MET_ATTRIBUTE, 1);
        player.getPacketSender().sendVarbit(VARBIT_FAIRY_NUFF_CHECK, 1);
      };
      return;
    }
    if (npcId === ZANDAR_NPC_ID && text === ZANDAR_HARD_WAY_LINE) {
      event.after = () => Scenes.zandarTeleport(player);
      event.pauseTicks = ZANDAR_TELEPORT_PAUSE_TICKS;
      return;
    }
    if (npcId === MALIGNIUS_NPC_ID && text === MALIGNIUS_MUSHROOM_LINE) {
      const malignius = event.npc;
      event.after = () => Scenes.castMushroom(player, malignius);
      event.pauseTicks = MALIGNIUS_MUSHROOM_CAST_TICKS;
    }
  }

  function handleDialogueLine(event) {
    if (onPage(event)) handleQuestLine(event);
    handleOwnPageLine(event);
  }

  function startQuest(player) {
    if (quest.getStage(player) !== 0) return;
    advance(player, STAGE_STARTED);
    player.sendMessage(questStartMessage(player, QUEST_NAME));
  }

  /** "Yes." to Martin's offer: the requirements; the stage itself waits for his answer. */
  function handleStartHook(event) {
    const { player, npcId, hook } = event;
    if (npcId !== MARTIN_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) !== 0) return;
    const missing = [
      { key: "lost_city", name: "Lost City" },
      { key: "nature_spirit", name: "Nature Spirit" },
    ].filter((requirement) => !questIsComplete(player, requirement.key));
    if (missing.length === 0) return;
    event.end = true;
    for (const requirement of missing) {
      player.sendMessage(`You must complete ${requirement.name} to start this quest.`);
    }
  }

  // ==========================================================================
  // quest=No options: the NPC's own page
  // ==========================================================================

  /** The steps of the option named `text` anywhere in `steps`. */
  function findOption(steps, text) {
    for (const step of steps ?? []) {
      for (const option of step?.options ?? []) {
        if (option.text === text) return option.steps ?? [];
        const nested = findOption(option.steps, text);
        if (nested) return nested;
      }
      if (Array.isArray(step?.steps)) {
        const nested = findOption(step.steps, text);
        if (nested) return nested;
      }
    }
    return null;
  }

  function ownPageSteps(page, variant) {
    const record = QuestRuntime.loadTranscripts(api)?.[page];
    return record?.variants?.[variant] ?? record?.variants?.["standard-dialogue"] ?? record?.steps ?? null;
  }

  /** Plays the option's branch from a page; false when the page has no such option. */
  function playOwnOption(player, npc, npcId, page, variant, text) {
    const body = findOption(ownPageSteps(page, variant), text);
    if (!body?.length) return false;
    const record = QuestRuntime.loadTranscripts(api)?.[page];
    const key = record?.variants?.[variant] ? variant
      : record?.variants?.["standard-dialogue"] ? "standard-dialogue" : null;
    if (key) return startTranscript(api, player, npcId, page, key, () => body, npc);
    api.emitCustomEvent("npc-dialogue:start", {
      player, npc, npcId, handled: false, variant: { page, variant: "standard-dialogue" }, select: () => body,
    });
    return true;
  }

  function ownPageFor(npcId, definition) {
    if (npcId === MARTIN_NPC_ID) return OWN_PAGE_OPTIONS.martin;
    if (npcId === MALIGNIUS_NPC_ID) return OWN_PAGE_OPTIONS.malignius;
    if (FAIRY_NUFF_NPC_IDS.has(npcId)) return OWN_PAGE_OPTIONS.nuff;
    if (GARDENER_NPC_IDS.has(npcId) || INVALID_GARDENER_NPC_IDS.has(npcId)) {
      return { ...OWN_PAGE_OPTIONS.gardener, page: definition?.getName?.(), variant: "standard-dialogue" };
    }
    return null;
  }

  function handleDialogueChoice(event) {
    const { player, npc, npcId, option, definition } = event;
    const own = ownPageFor(npcId, definition);
    if (!own?.options.includes(option)) return;
    // Nuff's first-meeting menu shares the subsequent menu's healing and goodbye branches.
    const fromQuest = onPage(event) || (FAIRY_NUFF_NPC_IDS.has(npcId) && event.pages?.some(({ page, variants }) =>
      page === "Fairy Nuff" && variants?.includes?.(NUFF_INITIAL_VARIANT)));
    if (!fromQuest) return;
    if (playOwnOption(player, npc, npcId, own.page, own.variant, option)) event.end = true;
  }

  /** Malignius's necromancy questions come back without the one just asked (2031, 2038, 2052). */
  function handleMenu(notice) {
    if (notice.npcId !== MALIGNIUS_NPC_ID || !notice.chosen) return;
    const options = notice.options ?? [];
    if (!options.some((option) => option.text === MALIGNIUS_NECROMANCY_LAST)) return;
    if (!options.some((option) => option.text === notice.chosen)) return;
    notice.options = options.filter((option) => option.text !== notice.chosen);
  }

  // ==========================================================================
  // Dialogue actions
  // ==========================================================================

  function enchantSecateurs(player) {
    const ids = requiredNatureItems(player).map((entry) => entry.id);
    if (ids.length === 3 && held(player, SECATEURS_ITEM_ID)) {
      // The magic pair takes the secateurs' slot (3271).
      const slot = player.getInventory().getSlotForItemId?.(SECATEURS_ITEM_ID) ?? -1;
      if (slot >= 0) player.getInventory().setItem(slot, new api.core.Item(MAGIC_SECATEURS_ITEM_ID, 1)).refreshItems();
      else player.getInventory().deleteNumber(SECATEURS_ITEM_ID, 1);
      for (const id of ids) player.getInventory().deleteNumber(id, 1);
    }
    if (!hasMagicSecateurs(player)) player.getInventory().adds(MAGIC_SECATEURS_ITEM_ID, 1);
    advance(player, STAGE_HAS_MAGIC_SECATEURS);
  }

  /** Six ticks into the blessing (3271): the secateurs, the camera back, then "It is done!". */
  function finishBlessing(event) {
    const { player } = event;
    const scene = Scenes.blessing(player);
    Scenes.endBlessing(player);
    if (!scene) {
      event.end = true;
      return;
    }
    if (quest.getStage(player) < STAGE_HAS_MAGIC_SECATEURS || !hasMagicSecateurs(player)) {
      // Inventory actions can remove recipe items while the scene plays.
      if (!hasEnchantingItems(player)) {
        player.sendMessage("You no longer have all the materials needed to bless the secateurs.");
        event.end = true;
        return;
      }
      enchantSecateurs(player);
    }
  }

  function handleActionEvent(event) {
    const { player, npcId, stepId, text } = event;
    if (event.action === GARDENER_REPORTED_ACTION) {
      event.handled = true;
      recordGardener(event);
      return;
    }
    if (stepId === GROVE_ENTER_ACTION_ID) {
      event.handled = true;
      event.end = true;
      Scenes.enterGroveCopy(player);
      return;
    }
    if (stepId === GROVE_REENTER_ACTION_ID) {
      event.handled = true;
      Scenes.enterGrove(player);
      return;
    }
    if (stepId === RECEIVE_SECATEURS_ACTION_ID) {
      event.handled = true;
      if (!held(player, QUEENS_SECATEURS_ITEM_ID)) player.getInventory().adds(QUEENS_SECATEURS_ITEM_ID, 1);
      return;
    }
    if (stepId === ENCHANT_ACTION_ID && NATURE_SPIRIT_NPC_IDS.has(npcId)) {
      event.handled = true;
      finishBlessing(event);
      return;
    }
    if (npcId === ZANDAR_NPC_ID && text === ZANDAR_TELEPORT_ACTION) {
      event.handled = true;
      return;
    }
    if (npcId === MALIGNIUS_NPC_ID && text === MALIGNIUS_MUSHROOM_ACTION) {
      event.handled = true;
      event.end = true;
      Scenes.becomeMushroom(player);
      return;
    }
    if (npcId === MALIGNIUS_NPC_ID && event.action === "receive" && /^magic secateurs$/i.test(String(text ?? ""))) {
      event.handled = true;
      if (held(player, COINS_ITEM_ID, SECATEURS_PRICE) && player.getInventory().getFreeSlots() > 0) {
        player.getInventory().deleteNumber(COINS_ITEM_ID, SECATEURS_PRICE);
        player.getInventory().adds(MAGIC_SECATEURS_ITEM_ID, 1);
      }
      return;
    }
    if (stepId !== COMPLETE_ACTION_ID) return;
    if (!FAIRY_GODFATHER_NPC_IDS.has(npcId)) return;
    event.handled = true;
    event.end = true;
    if (quest.getStage(player) >= STAGE_TANGLEFOOT_DEFEATED && !quest.isComplete(player)) {
      if (held(player, QUEENS_SECATEURS_ITEM_ID)) player.getInventory().deleteNumber(QUEENS_SECATEURS_ITEM_ID, 1);
      quest.complete(player);
    }
  }

  // ==========================================================================
  // World interactions
  // ==========================================================================

  function recordGardener({ player, npcId }) {
    if (quest.getStage(player) !== STAGE_STARTED) return;
    if (!GARDENER_NPC_IDS.has(npcId)) return;
    const asked = askedGardeners(player);
    if (asked.includes(npcId)) return;
    asked.push(npcId);
    player.setAttribute(GARDENERS_ATTRIBUTE, asked.join(","));
  }

  function gardenerMenu(steps) {
    return steps.map(step => step.type !== "choice" ? step : {
      ...step,
      options: step.options.map(option => {
        if (option.text === GARDENER_QUESTION) {
          return { ...option, steps: [...option.steps, { type: "action", action: GARDENER_REPORTED_ACTION }] };
        }
        if (option.text === "Would you look after my crops for me?") {
          return { ...option, steps: [{ type: "action", action: "farming:gardener-protect" }] };
        }
        return option;
      }),
    });
  }

  /**
   * The gardeners at stage 10: the next of the five answers, the same menu with "I've already told
   * you everything I suspect." for one asked before (277-281, 864-867), and "I don't think the crops
   * ARE failing" for any after the five (856, 957).
   */
  function talkToGardener(event) {
    const { player, npcId } = event;
    const isGardener = GARDENER_NPC_IDS.has(npcId);
    const asked = askedGardeners(player);
    let variant;
    if (!isGardener) variant = "talking-to-the-gardeners-invalid-gardener";
    else if (asked.includes(npcId)) variant = GARDENER_ALREADY_VARIANT;
    else if (asked.length >= 5) variant = GARDENER_AFTER_FIVE_VARIANT;
    else variant = `talking-to-the-gardeners-gardener-${asked.length + 1}`;
    event.handled = true;
    startTranscript(api, player, npcId, PAGE, variant, gardenerMenu, event.npc);
  }

  /** Malignius after the quest: his three options, no greeting (4454-4482). */
  function talkToMaligniusAfter(event) {
    const { player, npcId } = event;
    const page = ownPageSteps("Malignius Mortifer", "standard-dialogue");
    const options = MALIGNIUS_AFTER_OPTIONS.map((text) => ({ text, steps: findOption(page, text) ?? [] }));
    if (options.some((option) => !option.steps.length)) return;
    event.handled = startTranscript(api, player, npcId, "Malignius Mortifer", "standard-dialogue",
      () => [{ type: "choice", prompt: MALIGNIUS_AFTER_PROMPT, options }], event.npc);
  }

  function handleNpcInteraction(event) {
    const { player, npcId } = event;
    if (actionOf(event) !== "talk-to") return;
    const stage = quest.getStage(player);
    if (GARDENER_NPC_IDS.has(npcId) || INVALID_GARDENER_NPC_IDS.has(npcId)) {
      if (stage === STAGE_STARTED) talkToGardener(event);
      return;
    }
    if (FAIRY_GODFATHER_NPC_IDS.has(npcId) && stage >= STAGE_COMPLETE && ft2Stage(player) === 0) {
      // A chat message, not a box (4201).
      event.handled = true;
      player.sendMessage(GODFATHER_IGNORING);
      return;
    }
    if (npcId === MALIGNIUS_NPC_ID && stage >= STAGE_COMPLETE) talkToMaligniusAfter(event);
  }

  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    if (!GROVE_GAP_OBJECT_IDS.has(objectId)) return;
    event.handled = true;
    if (Scenes.toSource(player, player.getLocation()).getX() <= GROVE_INSIDE_MAX_X) {
      Scenes.leaveGrove(player);
      return;
    }
    const stage = quest.getStage(player);
    if (stage < STAGE_HAS_MAGIC_SECATEURS || !hasMagicSecateurs(player)) {
      if (stage < STAGE_STARTED) {
        player.sendMessage("I'm afraid nobody is allowed in there.");
        return;
      }
      startTranscript(api, player, GATEKEEPER_NPC_ID, GATEKEEPER_PAGE, GATEKEEPER_REFUSAL_VARIANT);
      return;
    }
    const variant =
      stage >= STAGE_TANGLEFOOT_DEFEATED
        ? "shady-grove-re-entering-the-shady-grove-after-obtaining-the-queen-s-secateurs"
        : "shady-grove-entering-the-shady-grove";
    startTranscript(api, player, GATEKEEPER_NPC_ID, PAGE, variant);
  }

  /** The Queen's secateurs are the kill's proof: stage 80 as they are picked up (3997). */
  function handleGroundItemPickup({ player, groundItemId }) {
    if (groundItemId !== QUEENS_SECATEURS_ITEM_ID) return;
    if (quest.getStage(player) !== STAGE_HAS_MAGIC_SECATEURS) return;
    if (player.getInventory().getFreeSlots() === 0) return;
    advance(player, STAGE_TANGLEFOOT_DEFEATED);
  }

  /**
   * Ends the looping long-dig sequence when the pending dig finishes or is cancelled.
   * The task is keyed by the player's index, so walking away stops it like any other
   * interruptible interaction.
   */
  class DraynorDigTask extends CountdownTask {
    constructor(player) {
      super(player.getIndex(), DRAYNOR_DIG_TICKS, () => finishDraynorDig(player));
      this.draynorPlayer = player;
    }

    onTick() {
      if (this.isRunning() && (this.draynorPlayer.getSkill() !== this || !canContinueDraynorDig(this.draynorPlayer))) this.stop();
    }

    cancel() {
      this.stop();
    }

    stop() {
      const player = this.draynorPlayer;
      const ownsActivity = player.getSkill() === this;
      // Not gated on getAnimation(): Mobile clears it every tick, so it is null by the time the dig ends.
      if (this.isRunning() && ownsActivity && player.getHitpoints() > 0 && !player.isDying) {
        player.performAnimation(Animation.DEFAULT_RESET_ANIMATION);
      }
      if (ownsActivity) player.setSkill(null);
      if (draynorDigTasks.get(player) === this) draynorDigTasks.delete(player);
      super.stop();
    }
  }

  function canContinueDraynorDig(player) {
    return player.isRegistered() && player.getHitpoints() > 0 && !player.isDying
      && held(player, SPADE_ITEM_ID) && player.getLocation().isWithinDistance(DRAYNOR_GRAVE_TILE, 1)
      && !!api.core.MapObjects.get(DRAYNOR_GRAVE_OBJECT_ID, DRAYNOR_GRAVE_TILE, player.getPrivateArea());
  }

  function cancelDraynorDig(player) {
    const task = draynorDigTasks.get(player);
    if (task) task.stop();
    draynorDigTasks.delete(player);
  }

  function beginDraynorDig(player, sendOpeningSound) {
    cancelDraynorDig(player);
    if (!canContinueDraynorDig(player)) return true;
    player.getSkillManager().stopSkillable();
    const sequence = CacheDefinitions.getSeqId("human_dig_long") ?? HUMAN_DIG_LONG_SEQUENCE;
    player.performAnimation(new Animation(sequence));
    player.forceChat(DRAYNOR_DIG_OVERHEAD);
    player.getPacketSender().sendTypedMessage(ChatType.SPAM, "You start digging...");
    if (sendOpeningSound) {
      Sounds.sendSound(player, new Sound(DRAYNOR_DIG_SOUND_ID, 1, 0, 1));
    }
    // The capture's second synth: three loops after 25 client cycles.
    Sounds.sendSound(player, new Sound(DRAYNOR_DIG_SOUND_ID, 1, DRAYNOR_DIG_SOUND_DELAY, DRAYNOR_DIG_SOUND_LOOPS));
    const task = new DraynorDigTask(player);
    draynorDigTasks.set(player, task);
    player.setSkill(task);
    TaskManager.submit(task);
    return true;
  }

  function finishDraynorDig(player) {
    if (player.getSkill() !== draynorDigTasks.get(player) || !canContinueDraynorDig(player)) return;
    if (held(player, DRAYNOR_SKULL_ITEM_ID)) {
      player.sendMessage("You dig the grave but find nothing.");
      return;
    }
    if (player.getBanks().some(bank => bank?.getAmount(DRAYNOR_SKULL_ITEM_ID) > 0)) {
      player.sendMessage("I think I've already stored the skull in my bank.");
      return;
    }
    if (player.getInventory().getFreeSlots() === 0) {
      player.getInventory().full();
      return;
    }
    player.getInventory().adds(DRAYNOR_SKULL_ITEM_ID, 1);
    player.sendMessage("You dig up a skull.");
  }

  /** The Draynor skull is dug from the manor grave, quest or no quest. */
  function digDraynorGrave(player, sendOpeningSound = true) {
    const at = player.getLocation();
    if (!at.isWithinDistance(DRAYNOR_GRAVE_TILE, 1)) return false;
    if (!api.core.MapObjects.get(DRAYNOR_GRAVE_OBJECT_ID, DRAYNOR_GRAVE_TILE, player.getPrivateArea())) return false;
    return beginDraynorDig(player, sendOpeningSound);
  }

  function handleSpadeDig({ player }) {
    // The shared Spade Dig handler has already sent the opening 1470/loops=1 sound.
    return digDraynorGrave(player, false);
  }

  function handleSpadeOnGrave(event) {
    if (event.itemId !== SPADE_ITEM_ID || event.objectId !== DRAYNOR_GRAVE_OBJECT_ID) return;
    if (!Location.isSameTile(event.location, DRAYNOR_GRAVE_TILE)) return;
    event.handled = digDraynorGrave(event.player);
  }

  /** Only magic secateurs harm the Tanglefoot and its babies (the Wiki); other hits land as 0s. */
  function handleNpcHitModify({ npc, hit }) {
    if (!SECATEURS_ONLY_NPC_IDS.has(npc?.getContentId?.() ?? npc?.getId?.())) return;
    const attacker = hit?.getAttacker?.();
    if (!attacker?.isPlayer?.() || wieldsMagicSecateurs(attacker)) return;
    for (const single of hit?.getHits?.() ?? []) single.setDamage(0);
    hit?.updateTotalDamage?.();
  }

  /** A melee swing with anything else says so on the swing (1001455 ticks 3033, 3037; 424 tick 18688). */
  function handleHitQueued({ player, target, hit }) {
    if (!SECATEURS_ONLY_NPC_IDS.has(target?.getContentId?.() ?? target?.getId?.())) return;
    if (wieldsMagicSecateurs(player)) return;
    if (hit?.getCombatType?.() !== api.core.CombatType.MELEE) return;
    player.sendMessage("I can't deal any damage...");
  }

  function handleStageChanged({ player, key }) {
    if (key === quest.key || key === FT2_KEY) sendProgressVarbits(player);
  }

  function handleLogin({ player }) {
    migrateStage({ player });
    refreshQuestList(player);
    sendProgressVarbits(player);
  }

  function handleBootstrap({ player }) {
    migrateStage({ player });
    sendProgressVarbits(player);
  }

  function handleLogout({ player }) {
    cancelDraynorDig(player);
    Scenes.cleanup(player);
  }

  function handlePlayerDeath({ player }) {
    cancelDraynorDig(player);
    Scenes.cleanup(player);
  }

  // ==========================================================================
  // Journal and rewards
  // ==========================================================================

  function buildJournal(player, questHandle) {
    return buildLines({
      stage: questHandle.getStage(player),
      gardeners: reportedGardeners(player),
      items: requiredNatureItems(player).map((entry) => entry.name),
      measure: (text) => api.core.ChatTextLayout.width(text),
    });
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.FARMING, 3500);
    player.getSkillManager().addExperiences(Skill.ATTACK, 2000);
    player.getSkillManager().addExperiences(Skill.MAGIC, 1000);
  }

  api.persistAttribute(GARDENERS_ATTRIBUTE);
  api.persistAttribute(MALIGNIUS_ASKED_ATTRIBUTE);
  api.persistAttribute(NATURE_ITEMS_ATTRIBUTE);
  api.persistAttribute(NUFF_MET_ATTRIBUTE, 0);
  api.persistAttribute(STAGE_SCHEMA_ATTRIBUTE, 0);

  quest = registerQuest(api, {
    key: "fairytale_i_growing_pains",
    name: QUEST_NAME,
    varpId: VARP_FAIRYTALE,
    varbitId: VARBIT_FAIRYTALE_QUEST,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.FARMING.getIndex(), amount: 3500, label: "Farming" },
      { skillId: Skill.ATTACK.getIndex(), amount: 2000, label: "Attack" },
      { skillId: Skill.MAGIC.getIndex(), amount: 1000, label: "Magic" },
    ],
    // The scroll (4181): the Queen's secateurs as its model, "Some Magic Secateurs" after the XP.
    rewardItemLabel: "Some Magic Secateurs",
    scrollItemId: QUEENS_SECATEURS_ITEM_ID,
    buildJournal,
    onReward: grantReward,
  });

  // League start-quest and quest-pack completion runs before the Quests plugin's
  // login hooks (modes/ loads first). Until this save's one-shot migration has
  // stamped the schema, an 80 is the old completed value, not the new Tanglefoot
  // stage, so it must not be completed (and rewarded) a second time.
  const isComplete = quest.isComplete.bind(quest);
  quest.isComplete = (player) => {
    if (!(Number(player.getAttribute(STAGE_SCHEMA_ATTRIBUTE)) >= STAGE_SCHEMA)
      && quest.getStage(player) === LEGACY_STAGE_COMPLETE) return true;
    return isComplete(player);
  };

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onCustomEvent("npc-dialogue:choice", handleDialogueChoice);
  api.onCustomEvent("npc-dialogue:menu", handleMenu);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleActionEvent);
  api.onCustomEvent("quest:stage-changed", handleStageChanged);
  api.onCustomEvent("combat:hit-queued", handleHitQueued);
  api.onNpcInteraction(handleNpcInteraction);
  api.onObjectInteraction(handleObjectInteraction);
  api.onGroundItemPickup(handleGroundItemPickup);
  api.onItemOnObject(handleSpadeOnGrave, { noted: false });
  api.onItemAction("Spade", { Dig: handleSpadeDig });
  api.onNpcHitModify(handleNpcHitModify);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
  api.onPlayerDeath(handlePlayerDeath);
  api.onCustomEvent("player:bootstrap-complete", handleBootstrap);
};
