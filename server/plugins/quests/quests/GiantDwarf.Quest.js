/**
 * The Giant Dwarf (members).
 *
 * The words come from the "The Giant Dwarf" transcript page; this plugin supplies
 * the variant selector for the boatman, Veldaban, Blasidar, Riki, Vermundi, Hugi,
 * Saro, Dromund, Santiri, Reldo and Thurgo, the prose-condition answers, the
 * clothes/boots/axe gathering chains, the Riki hand-in, the consortium errand
 * loop and the Veldaban meeting that completes the quest.
 *
 * Stages (varbit 571 "giantdwarf_quest", varp 482 "giantdwarf_main"; values are
 * the cache's own, from cache dbTable 0 row 63: column 19 completion = 50, and
 * RuneLite's quest helper steps map 0/5/10/20/30/40): 0 not started, 5 boat ride
 * done and Veldaban has asked for help, 10 Veldaban's task accepted (go to
 * Blasidar), 20 Blasidar's item list (boots/clothes/axe), 30 items handed to Riki
 * and Blasidar told (Consortium head decision), 40 joined a company and promised
 * support at the meeting, 50 complete.
 *
 * Sibling varbits of varp 482, from cache 571-584/2781-2782: 576 model_state bits
 * 11-14 (Riki's model: 1 clothes, 2 boots, 4 axe - the spawn 3197 transforms on
 * it), 577 original_company / 578 current_company bits 15-22 (company ids 1-8 per
 * RuneLite quest helper), 580 pie_given, 584 vermundi_givenbook, 2781 had the axe
 * fully fixed, 2782 got the boot pair.
 *
 * Source: OSRS Wiki "The Giant Dwarf", its transcript page and quick guide (not
 * the pre-9-November-2022 gender variants, which are never selected); RuneLite
 * quest-helper for the stage values and consortium scoring (75 points -> director,
 * 100 -> join); the cache for every id, varbit and item state.
 *
 * Route cross-check: RuneLite Quest Helper "The Giant Dwarf" (Zoinkwiz/quest-helper
 * pinned 06da90f982518a093f2fe1c9cfac5547fa7053d3) for the mandatory step order,
 * requirements and consortium scoring; the recorded transcript provides the words.
 *
 * Requirements enforced at the start: 12 Crafting, 16 Firemaking, 33 Magic,
 * 14 Thieving and the standard spellbook (Quest Helper's list).
 * Item weights are cache grams, so the bookcase compares carried weight against
 * 30,000g. The current Varrock Reldo (22428) is handled explicitly. Company
 * secretaries/directors use canonical named Talk-to bindings; the shared
 * ForgettableTale director hook must return false when it defers (see
 * jobs/varrock-keldagrim.shared.md) or it claims Talk-to before this plugin.
 * A declined Veldaban task can be re-offered.
 *
 * Gaps / approximations:
 *  - Dromund is static, so both boot pickups use a 50% "he is not looking" roll.
 *    The probability is an inference: the transcript and Quest Helper show both
 *    outcomes but no capture establishes the chance. The right boot supports the
 *    real Telekinetic Grab event; rejected grabs restore the ground item so it
 *    stays reclaimable. The cat branch (6GAow8) is unreachable and answers false.
 *  - The consortium loop tracks one pinned company and one task at a time, with no
 *    delivery timer or per-company score; +20 per ore delivery, +12 per bar
 *    delivery, -2 for cancelling, +20 once for the Purple Pewter H.A.M. headstart.
 *  - Cutscene room availability is always "a room is available"; the captured
 *    boat fade is replayed, while later statue/council scenes remain transcript
 *    prose because capture 3278 only covers the start. The boatman's post-quest
 *    Travel option is not handled.
 *  - The "[company name]" placeholder in spoken lines is filled, but option labels
 *    are not routed through the line hook, so the one option reading "Yes! Long
 *    live the [company name]!" keeps its wiki placeholder.
 */
module.exports = function registerGiantDwarfQuest(api) {
  const { Item, ItemIdentifiers, Location, MagicSpellbook, NpcIdentifiers, ObjectIdentifiers, Skill } = api.core;
  const { registerQuest, startTranscript, loadTranscripts } = require("../QuestRuntime");

  // ==========================================================================
  // Page, variants
  // ==========================================================================

  const PAGE = "The Giant Dwarf";
  const FADE_UID = (161 << 16) | 1;

  const BOATMAN_START_VARIANT = "starting-off-talking-to-dwarven-boatman";
  const VELDABAN_AGAIN_VARIANT = "starting-off-talking-to-veldaban-again-after-agreeing-to-help";
  const VELDABAN_MEETING_VARIANT = "art-by-committee-talking-to-commander-veldaban";
  const MEETING_VARIANT = "art-by-committee-the-consortium-meeting";
  const BLASIDAR_START_VARIANT = "starting-off-talking-to-blasidar-the-sculptor";
  const BLASIDAR_DECLINED_VARIANT =
    "starting-off-talking-to-blasidar-the-sculptor-talking-to-blasidar-after-declining-to-help";
  const BLASIDAR_ITEMS_VARIANT = "the-head-of-a-dwarf-talking-to-blasidar-the-sculptor-before-giving-the-items-to-riki";
  const BLASIDAR_AFTER_ITEMS_VARIANT =
    "the-head-of-a-dwarf-talking-to-blasidar-the-sculptor-after-giving-the-items-to-riki";
  const BLASIDAR_AGAIN_VARIANT = "the-head-of-a-dwarf-talking-to-blasidar-the-sculptor-again";
  const RIKI_BEFORE_VARIANT = "starting-off-talking-to-riki-before-agreeing-to-help";
  const RIKI_AFTER_TALK_VARIANT = "the-head-of-a-dwarf-talking-to-riki-the-sculptor-s-model-after-talking-to-blasidar";
  const RIKI_AFTER_GIVING_VARIANT =
    "the-head-of-a-dwarf-talking-to-riki-the-sculptor-s-model-after-giving-all-items-to-him";
  const RIKI_ALL_VARIANT = "the-head-of-a-dwarf-talking-to-riki-the-sculptor-s-model-with-all-items";
  const RIKI_TWO_VARIANT = "the-head-of-a-dwarf-talking-to-riki-the-sculptor-s-model-with-two-items-left";
  const RIKI_ONE_VARIANT = "the-head-of-a-dwarf-talking-to-riki-the-sculptor-s-model-with-one-item-left";
  const RIKI_CLOTHES_VARIANT = "the-head-of-a-dwarf-talking-to-riki-the-sculptor-s-model-with-clothes-but-not-other-items";
  const RIKI_AXE_VARIANT = "the-head-of-a-dwarf-talking-to-riki-the-sculptor-s-model-with-the-battleaxe-but-not-other-items";
  const RIKI_NOTHING_VARIANT = "the-head-of-a-dwarf-talking-to-riki-the-sculptor-s-model-before-giving-him-anything";
  const VERMUNDI_FIRST_VARIANT = "clothes-fit-for-a-king-talking-to-vermundi";
  const VERMUNDI_RETURN_VARIANT = "clothes-fit-for-a-king-returning-to-vermundi";
  const VERMUNDI_BOOK_VARIANT = "clothes-fit-for-a-king-talking-to-vermundi-after-giving-her-the-book";
  const BOOK_VARIANT = "clothes-fit-for-a-king-retrieving-the-book";
  const LIGHT_VARIANT = "clothes-fit-for-a-king-lighting-the-spinning-machine";
  const LIGHT_AGAIN_VARIANT =
    "clothes-fit-for-a-king-attempting-to-light-the-spinning-machine-after-it-is-already-lit";
  const WEARING_CLOTHES_VARIANT = "clothes-fit-for-a-king-wearing-the-clothes";
  const SARO_FIRST_VARIANT = "boots-fit-for-a-king-talking-to-saro";
  const SARO_AGAIN_VARIANT = "boots-fit-for-a-king-talking-to-saro-again";
  const DROMUND_FIRST_VARIANT = "boots-fit-for-a-king-talking-to-dromund";
  const DROMUND_AGAIN_VARIANT = "boots-fit-for-a-king-talking-to-dromund-again";
  const BOOT_BEFORE_VARIANT = "boots-fit-for-a-king-trying-to-take-the-boots-before-talking-to-dromund";
  const LEFT_BOOT_VARIANT = "boots-fit-for-a-king-taking-the-left-boot";
  const RIGHT_BOOT_VARIANT = "boots-fit-for-a-king-taking-the-right-boot";
  const BOOTS_DONE_VARIANT =
    "boots-fit-for-a-king-trying-to-pick-up-the-left-or-right-boot-while-already-having-the-exquisite-boots";
  const WEARING_BOOTS_VARIANT = "boots-fit-for-a-king-wearing-the-boots";
  const DROPPING_BOOTS_VARIANT = "boots-fit-for-a-king-dropping-the-boots";
  const SANTIRI_FIRST_VARIANT = "an-axe-fit-for-a-king-talking-to-santiri";
  const SANTIRI_AGAIN_VARIANT = "an-axe-fit-for-a-king-talking-to-santiri-again";
  const SANTIRI_SAPPHIRES_BEFORE_VARIANT =
    "an-axe-fit-for-a-king-using-sapphires-on-the-axe-before-having-thurgo-repair-it";
  const SANTIRI_SAPPHIRES_AFTER_VARIANT =
    "an-axe-fit-for-a-king-using-the-sapphires-on-the-axe-after-having-thurgo-repair-it";
  const WIELD_RESTORED_AXE_VARIANT = "an-axe-fit-for-a-king-trying-to-wield-the-restored-axe";
  const HUGI_CLOTHES_VARIANT = "clothes-fit-for-a-king-talking-to-hugi";
  const HUGI_IMCANDO_VARIANT = "an-axe-fit-for-a-king-talking-to-hugi-with-the-knight-s-sword-incomplete";
  const RELDO_IMCANDO_VARIANT = "an-axe-fit-for-a-king-talking-to-reldo-with-the-knight-s-sword-incomplete";
  const THURGO_AXE_VARIANT = "an-axe-fit-for-a-king-talking-to-thurgo";
  const SECRETARY_VARIANT = "the-head-of-a-dwarf-talking-to-a-company-secretary";
  const SECRETARY_TURN_IN_VARIANT = "the-head-of-a-dwarf-talking-to-a-company-secretary-turning-in-items";
  const RED_AXE_SECRETARY_VARIANT = "the-head-of-a-dwarf-talking-to-a-company-secretary-talking-to-the-red-axe-secretary";
  const DIRECTOR_VARIANT = "the-head-of-a-dwarf-talking-to-a-company-director";
  const DIRECTOR_TURN_IN_VARIANT = "the-head-of-a-dwarf-talking-to-a-company-director-turning-in-items";
  const RED_AXE_DIRECTOR_VARIANT = "the-head-of-a-dwarf-talking-to-a-company-director-talking-to-the-red-axe-director";

  // ==========================================================================
  // Ids
  // ==========================================================================

  const BOATMAN_NPC_IDS = new Set([
    NpcIdentifiers.DWARVEN_BOATMAN_3, // 7725, at the mine before the ride
    NpcIdentifiers.DWARVEN_BOATMAN_4, // 7726, after the quest is started
  ]);
  const VELDABAN_NPC_IDS = new Set([
    NpcIdentifiers.COMMANDER_VELDABAN, // 2228
    NpcIdentifiers.COMMANDER_VELDABAN_2, // 6045
  ]);
  const BLASIDAR_NPC_ID = NpcIdentifiers.BLASIDAR_THE_SCULPTOR; // 2347
  const RIKI_NPC_IDS = new Set([
    NpcIdentifiers.RIKI_THE_SCULPTORS_MODEL, // 2348
    NpcIdentifiers.RIKI_THE_SCULPTORS_MODEL_2, // 2349
    NpcIdentifiers.RIKI_THE_SCULPTORS_MODEL_3, // 2350
    NpcIdentifiers.RIKI_THE_SCULPTORS_MODEL_4, // 2351
    NpcIdentifiers.RIKI_THE_SCULPTORS_MODEL_5, // 2352
    NpcIdentifiers.RIKI_THE_SCULPTORS_MODEL_6, // 2353
    NpcIdentifiers.RIKI_THE_SCULPTORS_MODEL_7, // 2354
    NpcIdentifiers.RIKI_THE_SCULPTORS_MODEL_8, // 2355
  ]);
  const SANTIRI_NPC_ID = NpcIdentifiers.SANTIRI; // 2357
  const SARO_NPC_ID = NpcIdentifiers.SARO; // 2358
  const VERMUNDI_NPC_ID = NpcIdentifiers.VERMUNDI; // 2367
  const LIBRARIAN_NPC_ID = NpcIdentifiers.LIBRARIAN; // 2370
  const DROMUND_NPC_ID = NpcIdentifiers.DROMUND; // 2374
  const RELDO_NPC_IDS = new Set([NpcIdentifiers.RELDO, NpcIdentifiers.RELDO_2, 22428]); // 4242/4243 + current Varrock Reldo
  const THURGO_NPC_ID = NpcIdentifiers.THURGO; // 4733
  const RED_AXE_SECRETARY_NPC_ID = NpcIdentifiers.RED_AXE_SECRETARY; // 5997
  const RED_AXE_DIRECTOR_NPC_ID = NpcIdentifiers.RED_AXE_DIRECTOR_4; // 6025

  const COMPANIES = [
    {
      id: 1,
      name: "Purple Pewter",
      secretaryName: "Purple Pewter Secretary",
      directorName: "Purple Pewter Director",
      secretary: NpcIdentifiers.PURPLE_PEWTER_SECRETARY, // 5990
      director: NpcIdentifiers.PURPLE_PEWTER_DIRECTOR_3, // 5998
    },
    {
      id: 2,
      name: "Yellow Fortune",
      secretaryName: "Yellow Fortune Secretary",
      directorName: "Yellow Fortune Director",
      secretary: NpcIdentifiers.YELLOW_FORTUNE_SECRETARY, // 5991
      director: NpcIdentifiers.YELLOW_FORTUNE_DIRECTOR_2, // 6000
    },
    {
      id: 3,
      name: "Blue Opal",
      secretaryName: "Blue Opal Secretary",
      directorName: "Blue Opal Director",
      secretary: NpcIdentifiers.BLUE_OPAL_SECRETARY, // 5992
      director: NpcIdentifiers.BLUE_OPAL_DIRECTOR_2, // 5999
    },
    {
      id: 4,
      name: "Green Gemstone",
      secretaryName: "Green Gemstone Secretary",
      directorName: "Green Gemstone Director",
      secretary: NpcIdentifiers.GREEN_GEMSTONE_SECRETARY, // 5993
      director: NpcIdentifiers.GREEN_GEMSTONE_DIRECTOR_2, // 6021
    },
    {
      id: 5,
      name: "White Chisel",
      secretaryName: "White Chisel Secretary",
      directorName: "White Chisel Director",
      secretary: NpcIdentifiers.WHITE_CHISEL_SECRETARY, // 5994
      director: NpcIdentifiers.WHITE_CHISEL_DIRECTOR_2, // 6022
    },
    {
      id: 6,
      name: "Silver Cog",
      secretaryName: "Silver Cog Secretary",
      directorName: "Silver Cog Director",
      secretary: NpcIdentifiers.SILVER_COG_SECRETARY, // 5995
      director: NpcIdentifiers.SILVER_COG_DIRECTOR_2, // 6023
    },
    {
      id: 7,
      name: "Brown Engine",
      secretaryName: "Brown Engine Secretary",
      directorName: "Brown Engine Director",
      secretary: NpcIdentifiers.BROWN_ENGINE_SECRETARY, // 5996
      director: NpcIdentifiers.BROWN_ENGINE_DIRECTOR_2, // 6024
    },
  ];
  const COMPANY_BY_ID = new Map(COMPANIES.map((company) => [company.id, company]));
  const SECRETARY_COMPANY_BY_ID = new Map(COMPANIES.map((company) => [company.secretary, company]));
  const DIRECTOR_COMPANY_BY_ID = new Map(COMPANIES.map((company) => [company.director, company]));
  const SECRETARY_NPC_IDS = new Set(COMPANIES.map((company) => company.secretary));
  const DIRECTOR_NPC_IDS = new Set(COMPANIES.map((company) => company.director));
  const SECRETARY_NAMES = [...COMPANIES.map((company) => company.secretaryName), "Red Axe Secretary"];
  const DIRECTOR_NAMES = [...COMPANIES.map((company) => company.directorName), "Red Axe Director"];

  const BOOK_ITEM = ItemIdentifiers.BOOK_ON_COSTUMES; // 5065
  const CLOTHES_ITEM = ItemIdentifiers.EXQUISITE_CLOTHES; // 5067
  const EXQUISITE_BOOTS_ITEM = ItemIdentifiers.EXQUISITE_BOOTS; // 5064
  const LEFT_BOOT_ITEM = ItemIdentifiers.LEFT_BOOT; // 5062
  const RIGHT_BOOT_ITEM = ItemIdentifiers.RIGHT_BOOT; // 5063
  const MEETING_NOTES_ITEM = ItemIdentifiers.MEETING_NOTES; // 5066
  const AXE_ITEM = ItemIdentifiers.DWARVEN_BATTLEAXE; // 5056, rusty
  const AXE_SHARPENED_ITEM = ItemIdentifiers.DWARVEN_BATTLEAXE_2; // 5057, blade fixed
  const AXE_SAPPHIRES_ITEM = ItemIdentifiers.DWARVEN_BATTLEAXE_3; // 5058, sapphires set
  const AXE_RESTORED_ITEM = ItemIdentifiers.DWARVEN_BATTLEAXE_4; // 5059, fully restored
  const AXE_ITEM_IDS = new Set([AXE_ITEM, AXE_SHARPENED_ITEM, AXE_SAPPHIRES_ITEM, AXE_RESTORED_ITEM]);
  const COINS_ITEM = ItemIdentifiers.COINS; // 995
  const SAPPHIRE_ITEM = ItemIdentifiers.SAPPHIRE; // 1607
  const COAL_ITEM = ItemIdentifiers.COAL; // 453
  const LOGS_ITEM = ItemIdentifiers.LOGS; // 1511
  const TINDERBOX_ITEM = ItemIdentifiers.TINDERBOX; // 590
  const IRON_BAR_ITEM = ItemIdentifiers.IRON_BAR; // 2351
  const REDBERRY_PIE_ITEM = ItemIdentifiers.REDBERRY_PIE; // 2325
  const CLOTHES_PRICE = 200;
  const SAPPHIRES_REQUIRED = 3;
  const HAM_ITEM_IDS = new Set([
    ItemIdentifiers.HAM_HOOD, // 4302
    ItemIdentifiers.HAM_SHIRT, // 4298
    ItemIdentifiers.HAM_ROBE, // 4300
    ItemIdentifiers.HAM_CLOAK, // 4304
    ItemIdentifiers.HAM_GLOVES, // 4308
    ItemIdentifiers.HAM_BOOTS, // 4310
  ]);

  const ORES = [
    { id: ItemIdentifiers.COPPER_ORE, name: "copper ore" }, // 436
    { id: ItemIdentifiers.TIN_ORE, name: "tin ore" }, // 438
    { id: ItemIdentifiers.CLAY, name: "clay" }, // 434
    { id: ItemIdentifiers.IRON_ORE, name: "iron ore" }, // 440
    { id: ItemIdentifiers.SILVER_ORE, name: "silver ore" }, // 442
    { id: ItemIdentifiers.COAL, name: "coal" }, // 453
    { id: ItemIdentifiers.GOLD_ORE, name: "gold ore" }, // 444
    { id: ItemIdentifiers.MITHRIL_ORE, name: "mithril ore" }, // 447
  ];
  const BARS = [
    { id: ItemIdentifiers.BRONZE_BAR, name: "bronze bar" }, // 2349
    { id: ItemIdentifiers.IRON_BAR, name: "iron bar" }, // 2351
    { id: ItemIdentifiers.STEEL_BAR, name: "steel bar" }, // 2353
    { id: ItemIdentifiers.SILVER_BAR, name: "silver bar" }, // 2355
    { id: ItemIdentifiers.GOLD_BAR, name: "gold bar" }, // 2357
    { id: ItemIdentifiers.MITHRIL_BAR, name: "mithril bar" }, // 2359
  ];
  const ORE_BY_ID = new Map(ORES.map((entry) => [entry.id, entry.name]));
  const BAR_BY_ID = new Map(BARS.map((entry) => [entry.id, entry.name]));

  const SPINNING_MACHINE_OBJECT = ObjectIdentifiers.SPINNING_MACHINE; // 6080, at 2885,10188
  const BOOKCASE_LADDER_OBJECT = ObjectIdentifiers.BOOKCASE_19; // 6092, "Climb" in the library

  // ==========================================================================
  // Varbits / stages / attributes / tiles
  // ==========================================================================

  const VARP_GIANT_DWARF = 482; // "giantdwarf_main"
  const VARBIT_STAGE = 571; // "giantdwarf_quest", bits 0-6
  const VARBIT_MODEL_STATE = 576; // "giantdwarf_model_state", bits 11-14
  const VARBIT_ORIGINAL_COMPANY = 577; // "giantdwarf_original_company", bits 15-18
  const VARBIT_CURRENT_COMPANY = 578; // "giantdwarf_current_company", bits 19-22
  const VARBIT_PIE_GIVEN = 580; // "giantdwarf_pie_given", bit 24
  const VARBIT_VERMUNDI_BOOK = 584; // "giantdwarf_vermundi_givenbook", bit 28
  const VARBIT_FIXED_AXE = 2781; // bit 29, fully restored the axe at least once
  const VARBIT_GOT_PAIR = 2782; // bit 30, obtained the boot pair
  const COMPANY_OUTSIDER = 9; // the "no company"/outsider value the game sets on the boat ride

  const STAGE_STARTED = 5;
  const STAGE_BLASIDAR = 10;
  const STAGE_ITEMS = 20;
  const STAGE_CONSORTIUM = 30;
  const STAGE_VELDABAN = 40;
  const STAGE_COMPLETE = 50;

  const CLOTHES_NONE = 0;
  const CLOTHES_TOLD = 1; // Vermundi explained, bring the book
  const CLOTHES_BOOK = 2; // book handed over, the machine needs fuel
  const CLOTHES_DONE = 5; // clothes received
  const MACHINE_EMPTY = 0;
  const MACHINE_LOADED = 1;
  const MACHINE_LIT = 2;
  const BOOTS_NONE = 0;
  const BOOTS_SARO = 1;
  const BOOTS_DROMUND = 2;
  const MODEL_CLOTHES = 1;
  const MODEL_BOOTS = 2;
  const MODEL_AXE = 4;
  const MODEL_ALL = MODEL_CLOTHES | MODEL_BOOTS | MODEL_AXE;
  const SECRETARY_TASK_POINTS = 20;
  const DIRECTOR_TASK_POINTS = 12;
  const CANCEL_POINTS = 2;
  const DIRECTOR_POINTS = 75;
  const JOIN_POINTS = 100;
  const HAM_HEADSTART_POINTS = 20;
  const LIGHT_LEVEL = 16;
  const SAPPHIRE_CRAFT_LEVEL = 12;
  const BOOT_THIEVING_LEVEL = 14;
  const TELEGRAB_LEVEL = 33;
  const UNDER_WEIGHT_LIMIT = 30_000; // item weights are stored in grams
  const RIGHT_BOOT_TILE = new Location(2836, 10226, 0);

  const CLOTHES_ATTRIBUTE = "quest.giant_dwarf.clothes";
  const LIBRARIAN_ATTRIBUTE = "quest.giant_dwarf.librarian";
  const MACHINE_ATTRIBUTE = "quest.giant_dwarf.machine";
  const BOOTS_ATTRIBUTE = "quest.giant_dwarf.boots";
  const AXE_STARTED_ATTRIBUTE = "quest.giant_dwarf.axe-started";
  const AXE_LIBRARIAN_ATTRIBUTE = "quest.giant_dwarf.axe-librarian";
  const AXE_RELDO_ATTRIBUTE = "quest.giant_dwarf.axe-reldo";
  const PIE_ATTRIBUTE = "quest.giant_dwarf.pie";
  const BOOK_GIVEN_ATTRIBUTE = "quest.giant_dwarf.book-given";
  const MODEL_ATTRIBUTE = "quest.giant_dwarf.model";
  const PAIR_ATTRIBUTE = "quest.giant_dwarf.pair";
  const FIXED_AXE_ATTRIBUTE = "quest.giant_dwarf.fixed-axe";
  const DECLINED_ATTRIBUTE = "quest.giant_dwarf.declined";
  const COMPANY_ATTRIBUTE = "quest.giant_dwarf.company";
  const POINTS_ATTRIBUTE = "quest.giant_dwarf.points";
  const JOINED_ATTRIBUTE = "quest.giant_dwarf.joined";
  const HAM_BONUS_ATTRIBUTE = "quest.giant_dwarf.ham-bonus";
  const TASK_KIND_ATTRIBUTE = "quest.giant_dwarf.task-kind";
  const TASK_ITEM_ATTRIBUTE = "quest.giant_dwarf.task-item";
  const TASK_AMOUNT_ATTRIBUTE = "quest.giant_dwarf.task-amount";
  const TASK_ACTIVE_ATTRIBUTE = "quest.giant_dwarf.task-active";

  const BLACK_GUARD_HQ_TILE = new Location(2827, 10214, 0);
  const BLASIDAR_HOUSE_TILE = new Location(2907, 10206, 0);

  // The boatman's "Play Cutscene" branch: RV7CMp starts the cutscene and the
  // wiki marks its scene transitions unavailable. Skipping them plays the
  // transcript's real lines through to Veldaban.
  const BOAT_CUTSCENE_STEP_IDS = new Set([
    "bQ3UM1",
    "Ru6HA5",
    "ZPUkah",
    "efDsj3",
    "6Pr95H",
    "dLRCT3",
    "XggBjQ",
    "sg2BCG",
    "4m4OUB",
  ]);

  const BETWEEN_A_ROCK = "between_a_rock";
  const KNIGHTS_SWORD = "the_knights_sword";

  /** Transient, never persisted. */
  const watchState = new WeakMap(); // player -> Dromund is looking
  const bootCase = new WeakMap(); // player -> "inside" | "los" | "clear"
  const lightingState = new WeakMap(); // player -> lighting succeeded
  const skipReturnState = new WeakSet(); // player chose "Explore the area..."
  const meetingCompany = new WeakMap(); // player -> company id during the meeting

  let quest;

  // ==========================================================================
  // Small state helpers
  // ==========================================================================

  function stageOf(player) {
    return quest.getStage(player);
  }

  function setStage(player, value) {
    if (quest.getStage(player) !== value) quest.setStage(player, value);
  }

  function numberAttribute(player, key) {
    return Number(player.getAttribute(key)) || 0;
  }

  function flag(player, key) {
    return player.getAttribute(key) === true;
  }

  function hasItem(player, itemId, amount = 1) {
    return player.getInventory().getAmount(itemId) >= amount;
  }

  function questComplete(player, key) {
    const request = { player, key, complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function questStarted(player, key) {
    const request = { player, key, started: false };
    api.emitCustomEvent("quest:is-started", request);
    return request.started === true;
  }

  function isMale(player) {
    return player.getAppearance?.().isMale?.() !== false;
  }

  function skillLevel(player, skill) {
    return player.getSkillManager().getCurrentLevel(skill);
  }

  /** Quest Helper's explicit requirements for The Giant Dwarf. */
  function missingRequirements(player) {
    const skills = player.getSkillManager();
    const missing = [];
    if (skills.getMaxLevel(Skill.CRAFTING) < SAPPHIRE_CRAFT_LEVEL) missing.push(`${SAPPHIRE_CRAFT_LEVEL} Crafting`);
    if (skills.getMaxLevel(Skill.FIREMAKING) < LIGHT_LEVEL) missing.push(`${LIGHT_LEVEL} Firemaking`);
    if (skills.getMaxLevel(Skill.MAGIC) < TELEGRAB_LEVEL) missing.push(`${TELEGRAB_LEVEL} Magic`);
    if (skills.getMaxLevel(Skill.THIEVING) < BOOT_THIEVING_LEVEL) missing.push(`${BOOT_THIEVING_LEVEL} Thieving`);
    if (player.getSpellbook?.() !== MagicSpellbook.NORMAL) missing.push("the standard spellbook");
    return missing;
  }

  function carriedWeight(player) {
    let weight = 0;
    for (const item of [...player.getInventory().getItems(), ...player.getEquipment().getItems()]) {
      if (item?.getId?.() > 0 && item.getAmount?.() > 0) {
        weight += (Number(item.getDefinition().getWeight()) || 0) * Number(item.getAmount());
      }
    }
    return weight;
  }

  function wearingHamRobes(player) {
    let pieces = 0;
    for (const item of player.getEquipment().getItems()) {
      if (item && HAM_ITEM_IDS.has(item.getId?.())) pieces++;
    }
    return pieces >= 3;
  }

  function clothesState(player) {
    return numberAttribute(player, CLOTHES_ATTRIBUTE);
  }

  function setClothesState(player, value) {
    player.setAttribute(CLOTHES_ATTRIBUTE, value | 0);
  }

  function machineState(player) {
    return numberAttribute(player, MACHINE_ATTRIBUTE);
  }

  function setMachineState(player, value) {
    player.setAttribute(MACHINE_ATTRIBUTE, value | 0);
  }

  function bootsState(player) {
    return numberAttribute(player, BOOTS_ATTRIBUTE);
  }

  function setBootsState(player, value) {
    player.setAttribute(BOOTS_ATTRIBUTE, value | 0);
  }

  function modelState(player) {
    return numberAttribute(player, MODEL_ATTRIBUTE);
  }

  function hasModelBit(player, bit) {
    return (modelState(player) & bit) !== 0;
  }

  function setModelBit(player, bit) {
    const next = modelState(player) | bit;
    player.setAttribute(MODEL_ATTRIBUTE, next);
    player.getPacketSender().sendVarbit(VARBIT_MODEL_STATE, next);
  }

  function axeStarted(player) {
    return flag(player, AXE_STARTED_ATTRIBUTE);
  }

  function hasAnyAxe(player) {
    for (const itemId of AXE_ITEM_IDS) if (hasItem(player, itemId)) return true;
    return false;
  }

  function companyId(player) {
    return numberAttribute(player, COMPANY_ATTRIBUTE);
  }

  function points(player) {
    return numberAttribute(player, POINTS_ATTRIBUTE);
  }

  function addPoints(player, amount) {
    player.setAttribute(POINTS_ATTRIBUTE, Math.max(0, points(player) + amount));
  }

  function joined(player) {
    return flag(player, JOINED_ATTRIBUTE);
  }

  function taskActive(player) {
    return flag(player, TASK_ACTIVE_ATTRIBUTE);
  }

  function taskKind(player) {
    return String(player.getAttribute(TASK_KIND_ATTRIBUTE) ?? "");
  }

  function taskFromAttributes(player) {
    const itemId = numberAttribute(player, TASK_ITEM_ATTRIBUTE);
    if (!itemId) return null;
    const kind = taskKind(player);
    const name = (kind === "bar" ? BAR_BY_ID : ORE_BY_ID).get(itemId);
    if (!name) return null;
    return { kind, itemId, name, amount: numberAttribute(player, TASK_AMOUNT_ATTRIBUTE) };
  }

  function activeTask(player) {
    return taskActive(player) ? taskFromAttributes(player) : null;
  }

  function pendingTask(player) {
    return taskActive(player) ? null : taskFromAttributes(player);
  }

  function clearTask(player) {
    player.setAttribute(TASK_ACTIVE_ATTRIBUTE, false);
    player.setAttribute(TASK_ITEM_ATTRIBUTE, 0);
    player.setAttribute(TASK_AMOUNT_ATTRIBUTE, 0);
    player.setAttribute(TASK_KIND_ATTRIBUTE, "");
  }

  function hasTaskItems(player) {
    const task = activeTask(player);
    return Boolean(task) && hasItem(player, task.itemId, task.amount);
  }

  function companyForNpc(npcId) {
    return SECRETARY_COMPANY_BY_ID.get(npcId) ?? DIRECTOR_COMPANY_BY_ID.get(npcId) ?? null;
  }

  // ==========================================================================
  // Varbit sync
  // ==========================================================================

  function syncVarbits(player) {
    const sender = player.getPacketSender();
    const stage = stageOf(player);
    sender.sendVarbit(VARBIT_MODEL_STATE, modelState(player));
    sender.sendVarbit(VARBIT_ORIGINAL_COMPANY, stage >= STAGE_STARTED ? COMPANY_OUTSIDER : 0);
    sender.sendVarbit(VARBIT_CURRENT_COMPANY, companyId(player) || (stage >= STAGE_STARTED ? COMPANY_OUTSIDER : 0));
    sender.sendVarbit(VARBIT_PIE_GIVEN, flag(player, PIE_ATTRIBUTE) ? 1 : 0);
    sender.sendVarbit(VARBIT_VERMUNDI_BOOK, flag(player, BOOK_GIVEN_ATTRIBUTE) ? 1 : 0);
    sender.sendVarbit(VARBIT_FIXED_AXE, flag(player, FIXED_AXE_ATTRIBUTE) ? 1 : 0);
    sender.sendVarbit(VARBIT_GOT_PAIR, flag(player, PAIR_ATTRIBUTE) ? 1 : 0);
  }

  function handleLogin({ player }) {
    syncVarbits(player);
  }

  function handleBootstrap({ player }) {
    syncVarbits(player);
  }

  // ==========================================================================
  // NPC variant selector
  // ==========================================================================

  function selectVariant(event) {
    const { npcId, player } = event;
    const stage = stageOf(player);

    if (BOATMAN_NPC_IDS.has(npcId)) {
      return stage === 0 ? BOATMAN_START_VARIANT : null;
    }
    if (VELDABAN_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_COMPLETE || stage < STAGE_STARTED) return null;
      if (stage >= STAGE_VELDABAN) return VELDABAN_MEETING_VARIANT;
      return VELDABAN_AGAIN_VARIANT;
    }
    if (npcId === BLASIDAR_NPC_ID) {
      if (stage >= STAGE_COMPLETE || stage < STAGE_STARTED) return null;
      if (stage >= STAGE_CONSORTIUM) return BLASIDAR_AGAIN_VARIANT;
      if (stage >= STAGE_ITEMS) {
        return modelState(player) === MODEL_ALL ? BLASIDAR_AFTER_ITEMS_VARIANT : BLASIDAR_ITEMS_VARIANT;
      }
      return flag(player, DECLINED_ATTRIBUTE) ? BLASIDAR_DECLINED_VARIANT : BLASIDAR_START_VARIANT;
    }
    if (RIKI_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_COMPLETE) return null;
      if (stage >= STAGE_CONSORTIUM) return RIKI_AFTER_TALK_VARIANT;
      if (stage < STAGE_ITEMS) return RIKI_BEFORE_VARIANT;
      if (modelState(player) === MODEL_ALL) return RIKI_AFTER_GIVING_VARIANT;
      return rikiItemVariant(player);
    }
    if (npcId === SANTIRI_NPC_ID) {
      if (stage < STAGE_ITEMS || stage >= STAGE_COMPLETE) return null;
      return axeStarted(player) ? SANTIRI_AGAIN_VARIANT : SANTIRI_FIRST_VARIANT;
    }
    if (npcId === SARO_NPC_ID) {
      if (stage < STAGE_ITEMS || stage >= STAGE_COMPLETE) return null;
      if (hasModelBit(player, MODEL_BOOTS) || hasItem(player, EXQUISITE_BOOTS_ITEM)) return null;
      return bootsState(player) >= BOOTS_SARO ? SARO_AGAIN_VARIANT : SARO_FIRST_VARIANT;
    }
    if (npcId === VERMUNDI_NPC_ID) {
      if (stage < STAGE_ITEMS || stage >= STAGE_COMPLETE) return null;
      const clothes = clothesState(player);
      if (clothes >= CLOTHES_DONE) return null;
      if (clothes >= CLOTHES_BOOK) return VERMUNDI_BOOK_VARIANT;
      if (clothes >= CLOTHES_TOLD) return VERMUNDI_RETURN_VARIANT;
      return VERMUNDI_FIRST_VARIANT;
    }
    if (npcId === LIBRARIAN_NPC_ID) {
      if (stage < STAGE_ITEMS || stage >= STAGE_COMPLETE) return null;
      const needsImcando =
        axeStarted(player) &&
        !questComplete(player, KNIGHTS_SWORD) &&
        !flag(player, AXE_LIBRARIAN_ATTRIBUTE);
      if (needsImcando) return HUGI_IMCANDO_VARIANT;
      if (clothesState(player) <= CLOTHES_TOLD && !flag(player, LIBRARIAN_ATTRIBUTE)) return HUGI_CLOTHES_VARIANT;
      return null;
    }
    if (npcId === DROMUND_NPC_ID) {
      if (stage < STAGE_ITEMS || stage >= STAGE_COMPLETE) return null;
      if (hasModelBit(player, MODEL_BOOTS) || hasItem(player, EXQUISITE_BOOTS_ITEM)) return null;
      return bootsState(player) >= BOOTS_DROMUND ? DROMUND_AGAIN_VARIANT : DROMUND_FIRST_VARIANT;
    }
    if (RELDO_NPC_IDS.has(npcId)) {
      if (stage < STAGE_ITEMS || stage >= STAGE_COMPLETE) return null;
      if (questComplete(player, KNIGHTS_SWORD)) return null;
      if (!flag(player, AXE_LIBRARIAN_ATTRIBUTE) || flag(player, AXE_RELDO_ATTRIBUTE)) return null;
      return RELDO_IMCANDO_VARIANT;
    }
    if (npcId === THURGO_NPC_ID) {
      if (stage < STAGE_ITEMS || stage >= STAGE_COMPLETE) return null;
      const repairable =
        hasItem(player, AXE_ITEM) || hasItem(player, AXE_SHARPENED_ITEM) || hasItem(player, AXE_SAPPHIRES_ITEM);
      return repairable ? THURGO_AXE_VARIANT : null;
    }
    return null;
  }

  function rikiItemVariant(player) {
    const clothes = hasItem(player, CLOTHES_ITEM) && !hasModelBit(player, MODEL_CLOTHES);
    const boots = hasItem(player, EXQUISITE_BOOTS_ITEM) && !hasModelBit(player, MODEL_BOOTS);
    const axe = hasItem(player, AXE_RESTORED_ITEM) && !hasModelBit(player, MODEL_AXE);
    const count = [clothes, boots, axe].filter(Boolean).length;
    if (count === 3) return RIKI_ALL_VARIANT;
    if (count === 2) return RIKI_TWO_VARIANT;
    if (count === 1) {
      if (clothes) return RIKI_CLOTHES_VARIANT;
      if (axe) return RIKI_AXE_VARIANT;
      return RIKI_ONE_VARIANT;
    }
    return RIKI_NOTHING_VARIANT;
  }

  // ==========================================================================
  // Condition answers
  // ==========================================================================

  function answerCondition(event) {
    const { player, stepId } = event;
    switch (stepId) {
      // Commander Veldaban's Between a Rock... branches and the meeting.
      case "N3znPB":
        return questComplete(player, BETWEEN_A_ROCK);
      case "9Rn-rN":
        return questStarted(player, BETWEEN_A_ROCK) && !questComplete(player, BETWEEN_A_ROCK);
      case "QdoL7y":
        return !questStarted(player, BETWEEN_A_ROCK);
      case "M0J4St":
        return !questComplete(player, BETWEEN_A_ROCK);
      case "-yx6aT":
        return questComplete(player, BETWEEN_A_ROCK);

      // Clothes fit for a king.
      case "ttjvy8":
        return !flag(player, LIBRARIAN_ATTRIBUTE) && !hasItem(player, BOOK_ITEM);
      case "QaXKTZ":
        return !hasItem(player, BOOK_ITEM) && carriedWeight(player) > UNDER_WEIGHT_LIMIT;
      case "QoVouj":
        return !hasItem(player, BOOK_ITEM) && carriedWeight(player) <= UNDER_WEIGHT_LIMIT;
      case "4DpV4g":
        return hasItem(player, BOOK_ITEM);
      case "1rEz3k":
        return !flag(player, LIBRARIAN_ATTRIBUTE);
      case "IBBd2G":
        return (
          flag(player, LIBRARIAN_ATTRIBUTE) && !hasItem(player, BOOK_ITEM) && !flag(player, BOOK_GIVEN_ATTRIBUTE)
        );
      case "Lj6XV-":
        return hasItem(player, BOOK_ITEM);
      case "cNtTV7":
        return lightingState.has(player) ? lightingState.get(player) === true : null;
      case "Cw1YG2":
        return lightingState.has(player) ? lightingState.get(player) === false : null;
      case "zBQbfw":
        return machineState(player) < MACHINE_LOADED;
      case "yrtfGJ":
        return hasItem(player, COAL_ITEM) && hasItem(player, LOGS_ITEM);
      case "29VfFc":
        return machineState(player) === MACHINE_LOADED;
      case "C3OZ1G":
        return machineState(player) >= MACHINE_LIT;

      // Boots fit for a king.
      case "oVsHBb":
        return watchState.has(player) ? watchState.get(player) === true : null;
      case "JMNr1p":
        return watchState.has(player) ? watchState.get(player) === false : null;
      case "6GAow8":
        return bootCase.get(player) === "inside";
      case "iXgjbD":
        return false; // no Telekinetic Grab hook: the inside house branch is the cat
      case "EiiuPN":
        return bootCase.get(player) === "los";
      case "tFYZ8M":
        return bootCase.get(player) === "clear";
      case "vl8wAf":
        return (hasItem(player, LEFT_BOOT_ITEM) ? 1 : 0) + (hasItem(player, RIGHT_BOOT_ITEM) ? 1 : 0) === 1;
      case "vaffGf":
        return hasItem(player, LEFT_BOOT_ITEM) && hasItem(player, RIGHT_BOOT_ITEM);
      case "k_3nAW":
        return hasItem(player, EXQUISITE_BOOTS_ITEM);

      // An axe fit for a king.
      case "pvB8bs": {
        const level = skillLevel(player, Skill.SMITHING);
        return level >= 1 && level <= 29;
      }
      case "TCZDxp": {
        const level = skillLevel(player, Skill.SMITHING);
        return level >= 30 && level <= 74;
      }
      case "LEwBqL": {
        const level = skillLevel(player, Skill.SMITHING);
        return level >= 75 && level <= 98;
      }
      case "TjCJmD":
        return skillLevel(player, Skill.SMITHING) >= 99;
      case "4ue8O5":
      case "Jw2WnN":
      case "krV4vt":
        return !questComplete(player, KNIGHTS_SWORD);
      case "LDHm8p":
      case "a4sPGm":
      case "0m9UNv":
        return questComplete(player, KNIGHTS_SWORD);
      case "sQb13v":
        return hasAnyAxe(player);
      case "qL1UIV":
        return axeStarted(player) && !hasAnyAxe(player);
      case "ejl4Ta":
        return hasItem(player, AXE_SAPPHIRES_ITEM);
      case "Cm7FiC":
        return hasItem(player, AXE_SHARPENED_ITEM);
      case "lQLlvm":
        return hasItem(player, AXE_RESTORED_ITEM);
      case "lHXWsz":
        return hasModelBit(player, MODEL_AXE) || stageOf(player) >= STAGE_CONSORTIUM;
      case "xlM8LZ":
        return !hasItem(player, IRON_BAR_ITEM);
      case "stP52K":
        return hasItem(player, IRON_BAR_ITEM);
      case "WfgzWH":
      case "UH-MbK":
        return hasAnyAxe(player) && !hasItem(player, AXE_SAPPHIRES_ITEM) && !hasItem(player, AXE_RESTORED_ITEM);
      case "-w28Ah":
      case "09akPM":
        return hasItem(player, AXE_SAPPHIRES_ITEM) || hasItem(player, AXE_RESTORED_ITEM);
      case "en_Hhv":
      case "WnLsAs":
      case "HEWDLB":
        return hasItem(player, REDBERRY_PIE_ITEM);

      // The head of a dwarf (Blasidar's item progress).
      case "FQow_g":
        return !hasModelBit(player, MODEL_BOOTS) && !hasItem(player, EXQUISITE_BOOTS_ITEM);
      case "CZdTAG":
        return hasItem(player, EXQUISITE_BOOTS_ITEM);
      case "Oc0Nou":
        return (
          (hasModelBit(player, MODEL_BOOTS) || hasItem(player, EXQUISITE_BOOTS_ITEM)) &&
          !hasModelBit(player, MODEL_CLOTHES) &&
          !hasItem(player, CLOTHES_ITEM)
        );
      case "tiFuDD":
        return (
          !hasModelBit(player, MODEL_BOOTS) &&
          !hasItem(player, EXQUISITE_BOOTS_ITEM) &&
          !hasModelBit(player, MODEL_CLOTHES) &&
          !hasItem(player, CLOTHES_ITEM)
        );
      case "bKTj1I":
        return hasItem(player, CLOTHES_ITEM);
      case "hCNaGR":
        return !hasModelBit(player, MODEL_AXE) && !hasItem(player, AXE_RESTORED_ITEM);
      case "_CrNlB":
        return (
          !hasModelBit(player, MODEL_AXE) &&
          (hasItem(player, AXE_ITEM) || hasItem(player, AXE_SHARPENED_ITEM) || hasItem(player, AXE_SAPPHIRES_ITEM))
        );
      case "SmGxa5":
        return !hasModelBit(player, MODEL_AXE) && hasItem(player, AXE_RESTORED_ITEM);

      // Joining the consortium.
      case "Mzu06u":
      case "AlJWQd":
      case "lWcEhC":
      case "waIrdt":
      case "TRnN0M":
      case "Oto6R9":
        return points(player) < 20;
      case "jzxdAM":
      case "358NnA":
      case "WG1P6M":
      case "tRKFXE":
      case "OsZ4_q":
        return points(player) >= 20;
      case "j33FhT":
        return points(player) >= 20 && points(player) < DIRECTOR_POINTS;
      case "5mNpjN":
      case "Rx8A7A":
      case "nhMUz4":
        return stepId === "nhMUz4" ? points(player) < DIRECTOR_POINTS : points(player) >= DIRECTOR_POINTS;
      case "pMsir8":
        return points(player) >= DIRECTOR_POINTS;
      case "OG9Fvx":
        return taskActive(player) && taskKind(player) === "ore";
      case "b2W2BJ":
        return taskActive(player) && taskKind(player) === "bar";
      case "Phv0rC":
        return !taskActive(player);
      case "DaQDI6":
        return !joined(player);
      case "RBg-Mt":
      case "m5t76w":
        return points(player) < JOIN_POINTS;
      case "wJzWen":
      case "yyCqHp":
        return points(player) >= JOIN_POINTS;
      case "idYwU6":
        return !joined(player);
      case "98Qh1k":
        return joined(player);
      case "eQt6ua": {
        const wearing = event.npcId === NpcIdentifiers.PURPLE_PEWTER_SECRETARY && wearingHamRobes(player);
        if (wearing && !flag(player, HAM_BONUS_ATTRIBUTE)) {
          player.setAttribute(HAM_BONUS_ATTRIBUTE, true);
          addPoints(player, HAM_HEADSTART_POINTS);
        }
        return wearing;
      }

      // Gender branches of the pre-9-November-2022 variants (never selected).
      case "pqsFsD":
      case "eybqmz":
      case "Vuq-ee":
      case "IeYyES":
        return isMale(player);
      case "GrF58C":
      case "NMMhMX":
      case "0XIHHh":
      case "wQvUKU":
        return !isMale(player);
      case "3LEU5t":
      case "JzxMzW":
        return false;

      // Cutscene room availability: a room is always available here.
      case "sftv2b":
      case "voELv5":
        return false;
      case "SIqHdO":
      case "8vyjs_":
        return true;

      default:
        return null;
    }
  }

  // ==========================================================================
  // Line handler: placeholders, item hand-outs, task hand-ins
  // ==========================================================================

  function handleLine(event) {
    const { player, npcId, text } = event;
    if (typeof text !== "string" || text.length === 0) return;
    if (
      npcId === VERMUNDI_NPC_ID &&
      text.startsWith("A book, how wonderful!") &&
      hasItem(player, BOOK_ITEM)
    ) {
      // The wiki's book-less ending line sits before the book hand-in branch;
      // with the book in hand, drop it and its end step so the hand-in plays.
      event.skip = true;
      if (event.step) event.step.steps = [];
      return;
    }
    applyLineEffects(player, npcId, text);
    const filled = fillPlaceholders(player, npcId, text);
    if (filled !== text) event.text = filled;
  }

  function applyLineEffects(player, npcId, text) {
    if (npcId === SANTIRI_NPC_ID) {
      if (
        text.startsWith("I will entrust you with King Alvis' battleaxe") ||
        text.startsWith("I found it, actually")
      ) {
        giveAxe(player);
      }
      return;
    }
    if (npcId === DROMUND_NPC_ID && text.startsWith("Get out you pesky human!")) {
      setBootsState(player, BOOTS_DROMUND);
      return;
    }
    if (npcId === VERMUNDI_NPC_ID && text.startsWith("Great, thanks a lot, I'll check out the library!")) {
      setClothesState(player, CLOTHES_TOLD);
      return;
    }
    if (SECRETARY_NPC_IDS.has(npcId)) {
      if (text.startsWith("I've completed your task! Here is your ore!")) completeTask(player, "ore");
      else if (text.startsWith("We need ")) ensurePendingTask(player, "ore");
      return;
    }
    if (DIRECTOR_NPC_IDS.has(npcId)) {
      if (text.startsWith("I've completed your task! Here are your bars!")) completeTask(player, "bar");
      else if (text.startsWith("We need ")) ensurePendingTask(player, "bar");
      else if (text.startsWith("It is agreed then!")) joinCompanyForNpc(player, npcId);
    }
  }

  function fillPlaceholders(player, npcId, text) {
    let out = text;
    const task = activeTask(player) ?? pendingTask(player);
    if (task) {
      if (out.includes("in the next [number] minutes")) {
        const minutes = task.kind === "bar" ? 10 + task.amount * 2 : 10 + task.amount;
        out = out.replace("in the next [number] minutes", `in the next ${minutes} minutes`);
      }
      out = out.split("[number]").join(String(task.amount));
      out = out.replace("[copper ore/tin ore/clay/iron ore/silver ore/coal/gold ore/mithril ore]", task.name);
      out = out.replace("[bronze/iron/steel/silver/gold/mithril]", task.name);
    }
    const company =
      companyForNpc(npcId) ?? (VELDABAN_NPC_IDS.has(npcId) ? COMPANY_BY_ID.get(companyId(player)) : null);
    if (company) out = out.split("[company name]").join(company.name);
    const chosenId = meetingCompany.get(player) ?? companyId(player);
    if (chosenId && out.includes("[chosen company name]")) {
      out = out.replace("[chosen company name]", COMPANY_BY_ID.get(chosenId)?.name ?? "");
    }
    if (out.includes("[He deserves/She deserves/They deserve]")) {
      out = out.replace("[He deserves/She deserves/They deserve]", isMale(player) ? "He deserves" : "She deserves");
    }
    return out;
  }

  function giveAxe(player) {
    if (hasAnyAxe(player)) return;
    player.getInventory().adds(AXE_ITEM, 1);
    player.setAttribute(AXE_STARTED_ATTRIBUTE, true);
  }

  function completeTask(player, kind) {
    const task = activeTask(player);
    if (!task || task.kind !== kind) return;
    if (!hasItem(player, task.itemId, task.amount)) return;
    player.getInventory().deleteNumber(task.itemId, task.amount);
    addPoints(player, kind === "bar" ? DIRECTOR_TASK_POINTS : SECRETARY_TASK_POINTS);
    clearTask(player);
  }

  function ensurePendingTask(player, kind) {
    if (taskActive(player) || pendingTask(player)) return;
    if (companyId(player) !== 0 && joined(player)) return;
    const table = kind === "bar" ? BARS : ORES;
    const entry = table[Math.floor(Math.random() * table.length)];
    const amount = kind === "bar" ? 2 + Math.floor(Math.random() * 3) : 3 + Math.floor(Math.random() * 3);
    player.setAttribute(TASK_KIND_ATTRIBUTE, kind);
    player.setAttribute(TASK_ITEM_ATTRIBUTE, entry.id);
    player.setAttribute(TASK_AMOUNT_ATTRIBUTE, amount);
  }

  function promoteTask(player, npcId) {
    if (!pendingTask(player)) return;
    player.setAttribute(TASK_ACTIVE_ATTRIBUTE, true);
    const company = companyForNpc(npcId);
    if (company && companyId(player) === 0) player.setAttribute(COMPANY_ATTRIBUTE, company.id);
  }

  function cancelPending(player) {
    if (!pendingTask(player)) return;
    clearTask(player);
    addPoints(player, -CANCEL_POINTS);
  }

  function joinCompanyForNpc(player, npcId) {
    const company = companyForNpc(npcId);
    if (!company) return;
    player.setAttribute(JOINED_ATTRIBUTE, true);
    player.setAttribute(COMPANY_ATTRIBUTE, company.id);
    syncVarbits(player);
  }

  // ==========================================================================
  // Transcript action handler
  // ==========================================================================

  function meetingSteps() {
    const steps = loadTranscripts(api)?.[PAGE]?.variants?.[MEETING_VARIANT];
    return Array.isArray(steps) ? steps : null;
  }

  function blasidarOfferRemainder() {
    const steps = loadTranscripts(api)?.[PAGE]?.variants?.[BLASIDAR_START_VARIANT];
    if (!Array.isArray(steps)) return null;
    const index = steps.findIndex((step) => step?.player === "So what did you need doing?");
    return index === -1 ? null : steps.slice(index + 1);
  }

  function transcriptTailAfter(steps, stepId) {
    if (!Array.isArray(steps)) return null;
    for (let index = 0; index < steps.length; index++) {
      const step = steps[index];
      if (step?.id === stepId) return steps.slice(index + 1);
      for (const branch of [step?.steps, ...(step?.options ?? []).map((option) => option.steps)]) {
        const tail = transcriptTailAfter(branch, stepId);
        if (tail) return tail;
      }
    }
    return null;
  }

  /** What follows the boat ride's arrival action: Veldaban's task offer. */
  function veldabanOfferRemainder() {
    const steps = loadTranscripts(api)?.[PAGE]?.variants?.[BOATMAN_START_VARIANT];
    return transcriptTailAfter(steps, "TWPrRb");
  }

  function repairAxe(player) {
    if (!hasItem(player, IRON_BAR_ITEM)) return;
    player.getInventory().deleteNumber(IRON_BAR_ITEM, 1);
    if (hasItem(player, AXE_SAPPHIRES_ITEM)) {
      player.getInventory().deleteNumber(AXE_SAPPHIRES_ITEM, 1);
      player.getInventory().adds(AXE_RESTORED_ITEM, 1);
      player.setAttribute(FIXED_AXE_ATTRIBUTE, true);
      return;
    }
    if (hasItem(player, AXE_ITEM)) {
      player.getInventory().deleteNumber(AXE_ITEM, 1);
      player.getInventory().adds(AXE_SHARPENED_ITEM, 1);
    }
  }

  function fade(player, out) {
    player.getPacketSender().sendSubInterface(FADE_UID, 174, 1, {
      postScripts: [{ scriptId: 948, args: out ? [0, 255, 0, 0, 50] : [0, 0, 0, 255, 50] }],
    });
  }

  function finishBoatCutscene(player) {
    fade(player, false);
    player.getPacketSender().closeSubInterface(FADE_UID);
  }

  function handleAction(event) {
    const { player, stepId } = event;
    if (BOAT_CUTSCENE_STEP_IDS.has(stepId)) {
      event.handled = true;
      return;
    }
    switch (stepId) {
      case "RV7CMp": {
        // The capture fades to black for the client-side boat film. The scene
        // markers cannot be replayed here, so the fade carries the transition
        // into the arrival action instead of dropping the presentation.
        event.handled = true;
        fade(player, true);
        const { CountdownTask, TaskManager } = api.core;
        if (CountdownTask && TaskManager) {
          TaskManager.submit(new CountdownTask(player, 3, () => {
            if (player.isRegistered?.() === false) return;
            finishBoatCutscene(player);
          }));
        }
        return;
      }
      case "rbNSPj": {
        event.handled = true;
        player.moveTo(BLACK_GUARD_HQ_TILE);
        const remainder = veldabanOfferRemainder();
        if (remainder) event.steps = remainder;
        return;
      }
      case "TWPrRb":
        event.handled = true;
        player.moveTo(BLACK_GUARD_HQ_TILE);
        finishBoatCutscene(player);
        return;
      case "GVSGRf": {
        event.handled = true;
        const remainder = blasidarOfferRemainder();
        if (remainder) event.steps = remainder;
        return;
      }
      case "3nitJs":
        // message step: keep the prose, just hand over the book
        if (!hasItem(player, BOOK_ITEM)) player.getInventory().adds(BOOK_ITEM, 1);
        return;
      case "pJyVnt":
        event.handled = true;
        if (hasItem(player, BOOK_ITEM)) player.getInventory().deleteNumber(BOOK_ITEM, 1);
        player.setAttribute(BOOK_GIVEN_ATTRIBUTE, true);
        setClothesState(player, CLOTHES_BOOK);
        syncVarbits(player);
        return;
      case "23dies":
        // message step: keep the prose, just mark the machine lit
        setMachineState(player, MACHINE_LIT);
        return;
      case "xcf363":
        event.handled = true;
        if (!hasItem(player, COINS_ITEM, CLOTHES_PRICE)) {
          player.sendMessage(`You need ${CLOTHES_PRICE} coins to pay Vermundi.`);
          return;
        }
        // Spending exactly the fee empties the coin slot; a larger stack keeps
        // the bag full and the clothes would be lost after payment.
        if (!hasItem(player, CLOTHES_ITEM) && player.getInventory().getFreeSlots() < 1 &&
            player.getInventory().getAmount(COINS_ITEM) > CLOTHES_PRICE) {
          player.sendMessage("You couldn't hold all those items.");
          return;
        }
        player.getInventory().deleteNumber(COINS_ITEM, CLOTHES_PRICE);
        if (!hasItem(player, CLOTHES_ITEM)) player.getInventory().adds(CLOTHES_ITEM, 1);
        setClothesState(player, CLOTHES_DONE);
        return;
      case "TtgU-I":
        event.handled = true;
        player.getInventory().deleteNumber(LEFT_BOOT_ITEM, 1);
        player.getInventory().deleteNumber(RIGHT_BOOT_ITEM, 1);
        if (!hasItem(player, EXQUISITE_BOOTS_ITEM)) player.getInventory().adds(EXQUISITE_BOOTS_ITEM, 1);
        player.setAttribute(PAIR_ATTRIBUTE, true);
        syncVarbits(player);
        return;
      case "zNGGt4":
        event.handled = true;
        repairAxe(player);
        syncVarbits(player);
        return;
      case "e14etm":
        // message step: keep the prose, just take the pie
        if (hasItem(player, REDBERRY_PIE_ITEM)) player.getInventory().deleteNumber(REDBERRY_PIE_ITEM, 1);
        player.setAttribute(PIE_ATTRIBUTE, true);
        syncVarbits(player);
        return;
      case "z3YxxS":
        event.handled = true;
        event.end = true; // the parsed variant leaves a stray "Explore" menu after this
        if (skipReturnState.has(player)) {
          skipReturnState.delete(player);
          return;
        }
        player.moveTo(BLASIDAR_HOUSE_TILE);
        return;
      case "hd3pA-":
        event.handled = true;
        setStage(player, STAGE_CONSORTIUM);
        return;
      case "hp1hc7":
        // message step: keep the "visit Veldaban" line, mark the support promised
        setStage(player, STAGE_VELDABAN);
        return;
      case "LsMtIf": {
        event.handled = true;
        const chosen = companyId(player);
        if (chosen) meetingCompany.set(player, chosen);
        const steps = meetingSteps();
        if (steps) event.steps = steps;
        return;
      }
      case "lEFN0h":
        event.handled = true;
        event.end = true;
        meetingCompany.delete(player);
        if (!quest.isComplete(player)) quest.complete(player);
        return;
      case "IZ752f":
        event.handled = true;
        if (!hasItem(player, MEETING_NOTES_ITEM)) player.getInventory().adds(MEETING_NOTES_ITEM, 1);
        meetingCompany.delete(player);
        if (!quest.isComplete(player) && stageOf(player) >= STAGE_VELDABAN) quest.complete(player);
        return;
      case "n9xSMg":
      case "vjghj9":
        event.handled = true;
        if (hasItem(player, CLOTHES_ITEM)) player.getInventory().deleteNumber(CLOTHES_ITEM, 1);
        setModelBit(player, MODEL_CLOTHES);
        return;
      case "LnIhkv":
        event.handled = true;
        if (hasItem(player, EXQUISITE_BOOTS_ITEM)) player.getInventory().deleteNumber(EXQUISITE_BOOTS_ITEM, 1);
        setModelBit(player, MODEL_BOOTS);
        return;
      case "JeBfp-":
      case "RPHNH1":
        event.handled = true;
        if (hasItem(player, AXE_RESTORED_ITEM)) player.getInventory().deleteNumber(AXE_RESTORED_ITEM, 1);
        setModelBit(player, MODEL_AXE);
        return;
      default:
        return;
    }
  }

  // ==========================================================================
  // Transcript hook and choice handler
  // ==========================================================================

  function handleChoice(event) {
    const { player, npcId, option } = event;
    if (VELDABAN_NPC_IDS.has(npcId)) {
      if (option === "Yes, I will do this." && stageOf(player) < STAGE_BLASIDAR) setStage(player, STAGE_BLASIDAR);
      return;
    }
    if (BOATMAN_NPC_IDS.has(npcId)) {
      // The transcript has no hook step for the start; its "Start The Giant
      // Dwarf quest?" choice is the real acceptance point.
      if (option === "Yes." && stageOf(player) === 0) {
        const missing = missingRequirements(player);
        if (missing.length > 0) {
          player.sendMessage(`You need ${missing.join(", ")} to start The Giant Dwarf.`);
          return;
        }
        setStage(player, STAGE_STARTED);
        syncVarbits(player);
        return;
      }
      if (option === "Yes, I will do this." && stageOf(player) < STAGE_BLASIDAR) setStage(player, STAGE_BLASIDAR);
      return;
    }
    if (npcId === BLASIDAR_NPC_ID) {
      if (option === "Yes, I will do this.") {
        player.setAttribute(DECLINED_ATTRIBUTE, false);
        if (stageOf(player) < STAGE_ITEMS) setStage(player, STAGE_ITEMS);
      } else if (option === "No, I can't be bothered.") {
        player.setAttribute(DECLINED_ATTRIBUTE, true);
      }
      return;
    }
    if (npcId === VERMUNDI_NPC_ID) {
      if (option === "Yes, I'm looking for some special clothes." && clothesState(player) === CLOTHES_NONE) {
        setClothesState(player, CLOTHES_TOLD);
      }
      return;
    }
    if (npcId === LIBRARIAN_NPC_ID) {
      if (option === "Do you know anything about King Alvis' clothes?") {
        player.setAttribute(LIBRARIAN_ATTRIBUTE, true);
      } else if (option === "Can you help me find an Imcando dwarf?") {
        player.setAttribute(AXE_LIBRARIAN_ATTRIBUTE, true);
      }
      return;
    }
    if (RELDO_NPC_IDS.has(npcId)) {
      if (option === "What do you know about the Imcando dwarves?") player.setAttribute(AXE_RELDO_ATTRIBUTE, true);
      return;
    }
    if (npcId === SARO_NPC_ID) {
      if (option === "Yes, I'm looking for a pair of special boots." && bootsState(player) === BOOTS_NONE) {
        setBootsState(player, BOOTS_SARO);
      }
      return;
    }
    if (npcId === THURGO_NPC_ID) {
      if (option === "Explore the area before returning.") skipReturnState.add(player);
      return;
    }
    if (SECRETARY_NPC_IDS.has(npcId)) {
      if (option === "I'll take it.") promoteTask(player, npcId);
      else if (option === "No thanks.") cancelPending(player);
      return;
    }
    if (DIRECTOR_NPC_IDS.has(npcId)) {
      if (option === "I'll take it.") promoteTask(player, npcId);
      else if (option === "No thanks.") cancelPending(player);
      else if (option === "I'd like to officially join your company." && points(player) >= JOIN_POINTS) {
        joinCompanyForNpc(player, npcId);
      }
    }
  }

  // ==========================================================================
  // NPC interactions (the consortium floors are not in the transcript index)
  // ==========================================================================

  function npcOption(event) {
    const actions = event.definition?.getActions?.() ?? event.definition?.getInteractions?.();
    const action = actions?.[event.clickType - 1];
    // Some transformed director NPCs arrive without a cached definition; their
    // first option is still Talk-to.
    if (action) return action;
    return event.clickType === 1 ? "Talk-to" : undefined;
  }

  /** A declined task leaves stage 5 with no transcript hook; offer it again. */
  function talkToVeldaban(event) {
    const { player } = event;
    if (!player || npcOption(event) !== "Talk-to") return false;
    if (stageOf(player) !== STAGE_STARTED) return false;
    const remainder = veldabanOfferRemainder();
    if (!remainder) return false;
    event.handled = true;
    startTranscript(api, player, event.npcId, PAGE, BOATMAN_START_VARIANT, () => remainder);
    return true;
  }

  /** Named Talk-to handler for every company secretary and director. */
  function handleConsortiumNpc(event) {
    const { player, npcId } = event;
    const stage = stageOf(player);
    if (stage < STAGE_CONSORTIUM || stage >= STAGE_VELDABAN) return;
    if (npcId === RED_AXE_SECRETARY_NPC_ID) {
      event.handled = true;
      startTranscript(api, player, npcId, PAGE, RED_AXE_SECRETARY_VARIANT);
      return;
    }
    if (npcId === RED_AXE_DIRECTOR_NPC_ID) {
      event.handled = true;
      startTranscript(api, player, npcId, PAGE, RED_AXE_DIRECTOR_VARIANT);
      return;
    }
    if (SECRETARY_NPC_IDS.has(npcId)) {
      const company = companyForNpc(npcId);
      if (companyId(player) !== 0 && companyId(player) !== company.id) return;
      event.handled = true;
      const variant =
        taskActive(player) && taskKind(player) === "ore" && hasTaskItems(player)
          ? SECRETARY_TURN_IN_VARIANT
          : SECRETARY_VARIANT;
      startTranscript(api, player, npcId, PAGE, variant);
      return;
    }
    if (DIRECTOR_NPC_IDS.has(npcId)) {
      const company = companyForNpc(npcId);
      if (companyId(player) !== company.id) return;
      event.handled = true;
      const variant =
        taskActive(player) && taskKind(player) === "bar" && hasTaskItems(player)
          ? DIRECTOR_TURN_IN_VARIANT
          : DIRECTOR_VARIANT;
      startTranscript(api, player, npcId, PAGE, variant);
    }
  }

  // ==========================================================================
  // Items
  // ==========================================================================

  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (objectId !== SPINNING_MACHINE_OBJECT) return;
    if (itemId === COAL_ITEM) {
      if (stageOf(player) < STAGE_ITEMS || clothesState(player) < CLOTHES_BOOK) return;
      if (machineState(player) >= MACHINE_LOADED) return;
      if (!hasItem(player, LOGS_ITEM)) return;
      event.handled = true;
      player.getInventory().deleteNumber(COAL_ITEM, 1);
      player.getInventory().deleteNumber(LOGS_ITEM, 1);
      setMachineState(player, MACHINE_LOADED);
      player.sendMessage("You load the spinning machine with coal and logs.");
      return;
    }
    if (itemId === TINDERBOX_ITEM) {
      if (stageOf(player) < STAGE_ITEMS || clothesState(player) < CLOTHES_BOOK) return;
      if (machineState(player) >= MACHINE_LIT) {
        event.handled = true;
        startTranscript(api, player, VERMUNDI_NPC_ID, PAGE, LIGHT_AGAIN_VARIANT);
        return;
      }
      if (machineState(player) !== MACHINE_LOADED) return;
      event.handled = true;
      const success = skillLevel(player, Skill.FIREMAKING) >= LIGHT_LEVEL;
      lightingState.set(player, success);
      if (success) setMachineState(player, MACHINE_LIT);
      startTranscript(api, player, VERMUNDI_NPC_ID, PAGE, LIGHT_VARIANT);
      lightingState.delete(player);
    }
  }

  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const pair = new Set([usedItemId, usedWithItemId]);
    if (!pair.has(SAPPHIRE_ITEM)) return;
    const axeId = usedItemId === SAPPHIRE_ITEM ? usedWithItemId : usedItemId;
    if (!AXE_ITEM_IDS.has(axeId)) return;
    event.handled = true;
    if (!axeStarted(player)) return;
    if (axeId === AXE_SAPPHIRES_ITEM || axeId === AXE_RESTORED_ITEM) return;
    if (skillLevel(player, Skill.CRAFTING) < SAPPHIRE_CRAFT_LEVEL) {
      player.sendMessage(`You need a Crafting level of ${SAPPHIRE_CRAFT_LEVEL} to set the sapphires.`);
      return;
    }
    if (!hasItem(player, SAPPHIRE_ITEM, SAPPHIRES_REQUIRED)) {
      player.sendMessage(`You need ${SAPPHIRES_REQUIRED} cut sapphires.`);
      return;
    }
    player.getInventory().deleteNumber(SAPPHIRE_ITEM, SAPPHIRES_REQUIRED);
    if (axeId === AXE_ITEM) {
      player.getInventory().deleteNumber(AXE_ITEM, 1);
      player.getInventory().adds(AXE_SAPPHIRES_ITEM, 1);
      startTranscript(api, player, SANTIRI_NPC_ID, PAGE, SANTIRI_SAPPHIRES_BEFORE_VARIANT);
      return;
    }
    player.getInventory().deleteNumber(AXE_SHARPENED_ITEM, 1);
    player.getInventory().adds(AXE_RESTORED_ITEM, 1);
    player.setAttribute(FIXED_AXE_ATTRIBUTE, true);
    syncVarbits(player);
    startTranscript(api, player, SANTIRI_NPC_ID, PAGE, SANTIRI_SAPPHIRES_AFTER_VARIANT);
  }

  function handleItemAction(event) {
    const { player, itemId } = event;
    if (itemId === LEFT_BOOT_ITEM || itemId === RIGHT_BOOT_ITEM) {
      if (event.option === "Wear") {
        event.handled = true;
        startTranscript(api, player, DROMUND_NPC_ID, PAGE, WEARING_BOOTS_VARIANT);
        return;
      }
      if (event.option === "Drop") {
        if (hasItem(player, LEFT_BOOT_ITEM) && hasItem(player, RIGHT_BOOT_ITEM)) {
          player.getInventory().deleteNumber(itemId === LEFT_BOOT_ITEM ? RIGHT_BOOT_ITEM : LEFT_BOOT_ITEM, 1);
        }
        startTranscript(api, player, DROMUND_NPC_ID, PAGE, DROPPING_BOOTS_VARIANT);
        return;
      }
      return;
    }
    if (itemId === CLOTHES_ITEM && event.option === "Wear") {
      event.handled = true;
      startTranscript(api, player, VERMUNDI_NPC_ID, PAGE, WEARING_CLOTHES_VARIANT);
      return;
    }
    if (itemId === AXE_RESTORED_ITEM && event.option === "Wield") {
      event.handled = true;
      startTranscript(api, player, SANTIRI_NPC_ID, PAGE, WIELD_RESTORED_AXE_VARIANT);
    }
  }

  // ==========================================================================
  // Ground items (the boots)
  // ==========================================================================

  function handleGroundItemPickup(event) {
    const { player, groundItemId } = event;
    if (groundItemId !== LEFT_BOOT_ITEM && groundItemId !== RIGHT_BOOT_ITEM) return;
    if (hasModelBit(player, MODEL_BOOTS) || hasItem(player, EXQUISITE_BOOTS_ITEM)) {
      event.handled = true;
      startTranscript(api, player, DROMUND_NPC_ID, PAGE, BOOTS_DONE_VARIANT);
      return;
    }
    if (stageOf(player) < STAGE_ITEMS || bootsState(player) < BOOTS_SARO) {
      event.handled = true;
      startTranscript(api, player, DROMUND_NPC_ID, PAGE, BOOT_BEFORE_VARIANT);
      return;
    }
    if (groundItemId === LEFT_BOOT_ITEM && hasItem(player, LEFT_BOOT_ITEM)) return;
    if (groundItemId === RIGHT_BOOT_ITEM && hasItem(player, RIGHT_BOOT_ITEM)) return;
    if (groundItemId === LEFT_BOOT_ITEM) {
      if (skillLevel(player, Skill.THIEVING) < BOOT_THIEVING_LEVEL) {
        event.handled = true;
        player.sendMessage(`You need a Thieving level of ${BOOT_THIEVING_LEVEL} to steal this boot.`);
        return;
      }
      const watching = Math.random() < 0.5;
      watchState.set(player, watching);
      if (watching) event.handled = true;
      startTranscript(api, player, DROMUND_NPC_ID, PAGE, LEFT_BOOT_VARIANT);
      watchState.delete(player);
      return;
    }
    const watching = Math.random() < 0.5;
    bootCase.set(player, watching ? "los" : "clear");
    if (watching) event.handled = true;
    startTranscript(api, player, DROMUND_NPC_ID, PAGE, RIGHT_BOOT_VARIANT);
    bootCase.delete(player);
  }

  /** Return a boot the telekinetic grab should not have awarded. */
  function restoreRightBoot(player) {
    const manager = api.getItemOnGroundManager?.();
    if (manager) manager.registerLocation(player, new Item(RIGHT_BOOT_ITEM, 1), RIGHT_BOOT_TILE.clone());
  }

  /**
   * Telekinetic Grab deregisters the ground item and awards it before this
   * event fires. A grab that is too early, duplicated or spotted by Dromund
   * must hand the boot back and restore the ground item so it stays retryable.
   * The 50% "spotted" roll is an inference: the capture and Quest Helper show
   * the two outcomes but do not expose the probability.
   */
  function handleTelekineticGrab(event) {
    const { player, itemId } = event;
    if (!player || itemId !== RIGHT_BOOT_ITEM) return;
    const reject = (variant, message) => {
      if (hasItem(player, RIGHT_BOOT_ITEM)) player.getInventory().deleteNumber(RIGHT_BOOT_ITEM, 1);
      restoreRightBoot(player);
      if (message) player.sendMessage(message);
      startTranscript(api, player, DROMUND_NPC_ID, PAGE, variant);
      bootCase.delete(player);
    };
    if (hasModelBit(player, MODEL_BOOTS) || hasItem(player, EXQUISITE_BOOTS_ITEM)) {
      return reject(BOOTS_DONE_VARIANT);
    }
    if (stageOf(player) < STAGE_ITEMS || bootsState(player) < BOOTS_SARO) {
      return reject(BOOT_BEFORE_VARIANT);
    }
    // The core already added the boot; a second one would duplicate it.
    if (player.getInventory().getAmount(RIGHT_BOOT_ITEM) > 1) {
      return reject(RIGHT_BOOT_VARIANT);
    }
    const watching = Math.random() < 0.5;
    bootCase.set(player, watching ? "los" : "clear");
    if (watching) {
      return reject(RIGHT_BOOT_VARIANT, "Dromund spots you and snatches the boot back.");
    }
    startTranscript(api, player, DROMUND_NPC_ID, PAGE, RIGHT_BOOT_VARIANT);
    bootCase.delete(player);
  }

  // ==========================================================================
  // Objects
  // ==========================================================================

  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    if (objectId !== BOOKCASE_LADDER_OBJECT) return;
    const stage = stageOf(player);
    if (stage < STAGE_BLASIDAR || stage >= STAGE_CONSORTIUM) return;
    event.handled = true;
    startTranscript(api, player, LIBRARIAN_NPC_ID, PAGE, BOOK_VARIANT);
  }

  // ==========================================================================
  // Journal and rewards
  // ==========================================================================

  function buildJournal(player, handle) {
    const stage = handle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>The boat I rode to Keldagrim crashed into the statue of King Alvis.</str>",
        "<str>I helped Blasidar the sculptor rebuild it, gathering boots, clothes</str>",
        "<str>and the king's axe, and joined a consortium company so its director</str>",
        "<str>could sit atop the new statue.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_VELDABAN) {
      return [
        "<str>I promised the director of my company that I would speak for them</str>",
        "<str>at the Consortium meeting.</str>",
        "I should meet <col=800000>Commander Veldaban</col> west of the bank",
        "and attend the meeting in the palace.",
      ];
    }
    if (stage >= STAGE_CONSORTIUM) {
      return [
        "<str>Riki has the boots, clothes and axe, and Blasidar has built the</str>",
        "<str>statue up to the neck.</str>",
        "I need a company's <col=800000>director</col> to convince the Consortium",
        "whose head the statue should receive.",
      ];
    }
    if (stage >= STAGE_ITEMS) {
      return [
        "<str>Blasidar asked me to find a pair of boots, some clothes and a</str>",
        "<str>battleaxe fit for King Alvis' statue.</str>",
        "",
        clothLine(player, "boots", hasItem(player, EXQUISITE_BOOTS_ITEM) || hasModelBit(player, MODEL_BOOTS)),
        clothLine(player, "clothes", hasItem(player, CLOTHES_ITEM) || hasModelBit(player, MODEL_CLOTHES)),
        clothLine(player, "battleaxe", hasItem(player, AXE_RESTORED_ITEM) || hasModelBit(player, MODEL_AXE)),
      ];
    }
    if (stage >= STAGE_BLASIDAR) {
      return ["I should speak to <col=800000>Blasidar the sculptor</col> in Keldagrim-East."];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "<str>The boat I rode to Keldagrim crashed into the statue of King Alvis.</str>",
        "I should speak to <col=800000>Commander Veldaban</col> in the Black",
        "Guard headquarters about helping to rebuild it.",
      ];
    }
    return [
      "I can start this quest by talking to the",
      "<col=800000>Dwarven Boatman</col> by the River Kelda, east of Rellekka.",
    ];
  }

  function clothLine(player, label, done) {
    return done ? `<str>I have the ${label} for the sculptor.</str>` : `I still need the <col=800000>${label}</col>.`;
  }

  const REWARD_XP = [
    { skill: Skill.MINING, amount: 2500, label: "Mining" },
    { skill: Skill.SMITHING, amount: 2500, label: "Smithing" },
    { skill: Skill.CRAFTING, amount: 2500, label: "Crafting" },
    { skill: Skill.MAGIC, amount: 1500, label: "Magic" },
    { skill: Skill.THIEVING, amount: 1500, label: "Thieving" },
    { skill: Skill.FIREMAKING, amount: 1500, label: "Firemaking" },
  ];

  function grantReward(player) {
    const skills = player.getSkillManager();
    for (const reward of REWARD_XP) skills.addExperiences(reward.skill, reward.amount);
  }

  // ==========================================================================
  // Registration
  // ==========================================================================

  for (const key of [
    CLOTHES_ATTRIBUTE,
    LIBRARIAN_ATTRIBUTE,
    MACHINE_ATTRIBUTE,
    BOOTS_ATTRIBUTE,
    AXE_STARTED_ATTRIBUTE,
    AXE_LIBRARIAN_ATTRIBUTE,
    AXE_RELDO_ATTRIBUTE,
    PIE_ATTRIBUTE,
    BOOK_GIVEN_ATTRIBUTE,
    MODEL_ATTRIBUTE,
    PAIR_ATTRIBUTE,
    FIXED_AXE_ATTRIBUTE,
    DECLINED_ATTRIBUTE,
    COMPANY_ATTRIBUTE,
    POINTS_ATTRIBUTE,
    JOINED_ATTRIBUTE,
    HAM_BONUS_ATTRIBUTE,
    TASK_KIND_ATTRIBUTE,
    TASK_ITEM_ATTRIBUTE,
    TASK_AMOUNT_ATTRIBUTE,
    TASK_ACTIVE_ATTRIBUTE,
  ]) {
    api.persistAttribute(key);
  }

  quest = registerQuest(api, {
    key: "giant_dwarf",
    name: "The Giant Dwarf",
    varpId: VARP_GIANT_DWARF,
    varbitId: VARBIT_STAGE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: REWARD_XP.map((reward) => ({
      skillId: reward.skill.getIndex(),
      amount: reward.amount,
      label: reward.label,
    })),
    otherRewards: ["Ability to do more delivery tasks for the company you joined"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onNpcsInteraction(SECRETARY_NAMES, { "Talk-to": handleConsortiumNpc });
  api.onNpcsInteraction(DIRECTOR_NAMES, { "Talk-to": handleConsortiumNpc });
  api.onNpcInteraction("Commander Veldaban", { "Talk-to": talkToVeldaban });
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemOnItem(handleItemOnItem);
  api.onItemAction(handleItemAction);
  api.onGroundItemPickup(handleGroundItemPickup);
  api.onCustomEvent("magic:telekinetic-grab", handleTelekineticGrab);
  api.onObjectInteraction(handleObjectInteraction);
  api.onPlayerLogin(handleLogin);
  api.onCustomEvent("player:bootstrap-complete", handleBootstrap);
};
