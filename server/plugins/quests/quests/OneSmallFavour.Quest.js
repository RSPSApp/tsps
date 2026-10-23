/**
 * One Small Favour (members).
 *
 * The words come from the "One Small Favour" transcript page; this plugin supplies
 * the variant selector for the twenty-one NPCs in the favour chain, the prose
 * condition answers, the hand-in/action steps, the Feldip landing-light mini-game,
 * the weather-vane repair, the Slagilith summoning, the Hammerspike gang fight and
 * the completion reward.
 *
 * Stages (varp 416 "onesmallfavour"; the cache has no varbits on it - varp 417
 * "onesmallfavourmulti" carries the per-light bits and the fixed flags). 285 is
 * the cache quest DB value (dbTable 0 row 107, column 19; column 14 stores start
 * NPC 5361 Yanni Salika), so the quest list scripts agree on completion:
 *   1  Yanni asked for red mahogany
 *   2  forester asked; blunt axe in hand (take it to Shanks/Brian)
 *   3  Brian kept the axe; ask Aggie to be a character witness
 *   4  Aggie asked; find Jimmy the Chisel in the H.A.M. hideout
 *   5  Johanhus accepted; wants a month of chickens from Fred
 *   6  Fred talked; sent you to Seth Groats
 *   7  Seth accepted; take 3 steel bars to Horvik
 *   8  Horvik has the bars; needs medicine and 5 pigeon cages
 *   9  Apothecary gave the herbal tincture; needs an airtight pot (Tassie)
 *  10  Tassie accepted; deal with Hammerspike
 *  11  Hammerspike wants to become a druid initiate; ask Sanfew
 *  12  tea handed to Bleemadge; T.R.A.S.H. needed from Arhein
 *  13  Arhein accepted; get a weather report from Seers' Village
 *  14  Farsight accepted; search the Goblin Cave for Petra
 *  15  sculpture searched; the message points to Wizard Cromperty
 *  16  Cromperty accepted; iron oxide from Port Khazard (Tindel)
 *  17  Tindel accepted; the stodgy mattress is in hand (Rantz must fill it)
 *  18  Rantz accepted; help Gnormadium with the landing lights
 *  19  fixing the eight Feldip landing lights
 *  20  lights fixed and reported to Gnormadium (Rantz owes the mattress)
 *  21  comfy mattress obtained
 *  22  iron oxide obtained
 *  23  animate rock scroll obtained
 *  24  first cast misfired; Slagilith summoned
 *  25  Petra freed
 *  26  weather vane discovered on the Seers' roof
 *  27  weather vane repaired (report pending)
 *  28  weather report obtained
 *  29  report shown to Arhein (T.R.A.S.H. sent)
 *  30  Bleemadge confirmed; tell Sanfew
 *  31  Sanfew will take the dwarf; report to Hammerspike
 *  32  Hammerspike betrayed you; fight his gang
 *  33  gang defeated; Hammerspike yields
 *  34  Tassie shown; learned pot lids (clay in hand)
 *  35  breathing salts obtained
 *  36  medicine given to Horvik; 5 pigeon cages needed
 *  37  pigeon cages converted to chicken cages
 *  38  chicken cages delivered to Seth
 *  39  Johanhus told; Jimmy released
 *  40  Aggie told; she agrees to be the witness
 *  41  sharpened axe obtained
 *  42  red mahogany log obtained
 * 285  complete (cache quest DB completion value)
 *
 * Sources: OSRS Wiki "One Small Favour" page, its quick guide and
 * Transcript:One Small Favour (the dialogue is replayed verbatim; the message
 * steps reused as system messages are copied from the same transcript). Cache
 * evidence: yarn dump:loc 5809/5810/5811 (Seers weathervane, 2702,3476,3),
 * 5815/5820-5823 (the eight Feldip landing lights, 2545-2554 x 2969/2974),
 * 5808 (Petra's sculpture, 2621,9835), 5825 (Feldip gnome glider, 2540,2970);
 * scripts/lookup-gameval.ts varbit osf_* (varp 417 bits); quest DB row 107.
 *
 * Gaps / approximations:
 *  - Captain Bleemadge (10459), Wizard Cromperty (8480) and Gnormadium Avlafrim
 *    (7516) have no npc-spawns.json entry, so they are spawned once per world on
 *    the first login at their OSRS spots (White Wolf Mountain, NE Ardougne,
 *    Feldip Hills).
 *  - Rantz's spawn is the nameless cache placeholder 1470; its transform varp
 *    (293, Big Chompy) resolves to 14793, which has no npc-dialogue-index entry,
 *    so his quest variants are driven by our own Talk-to hook.
 *  - Gem cutting is already handled by the Crafting plugin (no crush chance), so
 *    the "buy a replacement gem for 500 coins" branch is only reachable if a gem
 *    is dropped; it then sells whichever gem type is missing.
 *  - Pot lid making: Crafting's potter's wheel has no pot-lid recipe and its
 *    handler cannot be pre-empted (item-on-object hooks all run), so Tassie's
 *    "shows you how to make pot lids" step turns the soft clay into an unfired
 *    pot lid; it is fired on a pottery oven and used on a pot to make the
 *    airtight pot. The pot spawn in the Barbarian Village helmet shop has no map
 *    placement here, so a pot is picked up just outside Tassie's pottery.
 *  - Brewing: the bowl of hot water can be made on any range/oven/fire and used
 *    on an empty cup (or the harralander used on the bowl directly) while the
 *    Sanfew favour is open.
 *  - The first cast summons a per-player Slagilith (the transcript's misfire);
 *    when the gang attacks, the three dwarf gang members in the Dwarven Mine are
 *    made to attack the player.
 *  - Lost broken/fixed vane parts are re-granted on searching the vane again
 *    (the wiki's 1,000-coin recovery from Phantuwti has no transcript lines).
 *  - The cache's maps have no upper end for the Seers' roof ladder (26118) or the
 *    trapdoor above it (26119), so the plugin supplies that climb link itself.
 *  - Petra is not spawned; freeing her replays her transcript with her chathead,
 *    and the post-quest small talk for the NPCs without a post-quest variant
 *    falls back to their own standard transcript page.
 */
module.exports = function registerOneSmallFavourQuest(api) {
  const {
    Item,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    ObjectDefinition,
    ObjectIdentifiers,
    Skill,
  } = api.core;
  const { registerQuest, startTranscript } = require("../QuestRuntime");

  const PAGE = "One Small Favour";
  const START_HOOK = "quest:one-small-favour:start";
  const REQUIREMENTS_MESSAGE =
    "You need to have completed Shilo Village and Rune Mysteries, with 36 Agility, 25 Crafting, 18 Herblore and 30 Smithing, before Yanni will ask this favour.";

  // ==========================================================================
  // NPCs
  // ==========================================================================

  const YANNI = NpcIdentifiers.YANNI_SALIKA; // 5361
  const FORESTER_IDS = new Set([NpcIdentifiers.JUNGLE_FORESTER, NpcIdentifiers.JUNGLE_FORESTER_2]); // 3954/3955
  const CAPTAIN_SHANKS = NpcIdentifiers.CAPTAIN_SHANKS; // 5364
  const BRIAN = NpcIdentifiers.BRIAN; // 2892
  const AGGIE_IDS = new Set([NpcIdentifiers.AGGIE, NpcIdentifiers.AGGIE_2]); // 120/121
  const JOHANHUS_IDS = new Set([
    NpcIdentifiers.JOHANHUS_ULSBRECHT, // 2535
    NpcIdentifiers.JOHANHUS_ULSBRECHT_2, // 4330
  ]);
  const FRED = NpcIdentifiers.FRED_THE_FARMER; // 732
  const SETH = NpcIdentifiers.SETH_GROATS; // 1351
  const HORVIK = NpcIdentifiers.HORVIK; // 2882
  const APOTHECARY = NpcIdentifiers.APOTHECARY; // 5036
  const TASSIE = NpcIdentifiers.TASSIE_SLIPCAST; // 1352
  const HAMMERSPIKE = NpcIdentifiers.HAMMERSPIKE_STOUTBEARD; // 1353
  const GANG_IDS = new Set([
    NpcIdentifiers.DWARF_GANG_MEMBER, // 1354
    NpcIdentifiers.DWARF_GANG_MEMBER_2, // 1355
    NpcIdentifiers.DWARF_GANG_MEMBER_3, // 1356
  ]);
  const SANFEW = NpcIdentifiers.SANFEW; // 5044
  const BLEEMADGE_IDS = new Set([
    NpcIdentifiers.CAPTAIN_BLEEMADGE, // 10459
    NpcIdentifiers.CAPTAIN_BLEEMADGE_2, // 10461
    NpcIdentifiers.CAPTAIN_BLEEMADGE_3, // 10462
    NpcIdentifiers.CAPTAIN_BLEEMADGE_4, // 10463
    NpcIdentifiers.CAPTAIN_BLEEMADGE_5, // 10464
    NpcIdentifiers.CAPTAIN_BLEEMADGE_6, // 10465
    NpcIdentifiers.CAPTAIN_BLEEMADGE_7, // 10466
  ]);
  const ARHEIN = NpcIdentifiers.ARHEIN; // 3200
  const FARSIGHT = NpcIdentifiers.PHANTUWTI_FANSTUWI_FARSIGHT; // 1357
  const TINDEL = NpcIdentifiers.TINDEL_MARCHANT; // 1358
  const PETRA = NpcIdentifiers.PETRA_FIYED; // 1360
  const CROMPERTY_IDS = new Set([NpcIdentifiers.WIZARD_CROMPERTY, NpcIdentifiers.WIZARD_CROMPERTY_2]); // 8480/8481
  const GNORMADIUM_IDS = new Set([NpcIdentifiers.GNORMADIUM_AVLAFRIM, NpcIdentifiers.GNORMADIUM_AVLAFRIM_2]); // 7516/7517
  const RANTZ_PLACEHOLDER = 1470; // nameless transform parent spawned in Feldip Hills
  const RANTZ_IDS = new Set([
    RANTZ_PLACEHOLDER,
    NpcIdentifiers.RANTZ_2, // 4855
    NpcIdentifiers.RANTZ_3, // 4856
    NpcIdentifiers.RANTZ_4, // 4857
    NpcIdentifiers.RANTZ, // 14793
  ]);
  const SLAGILITH = NpcIdentifiers.SLAGILITH; // 1362, level 92
  const QUEST_NPC_IDS = new Set([
    YANNI,
    ...FORESTER_IDS,
    CAPTAIN_SHANKS,
    BRIAN,
    ...AGGIE_IDS,
    ...JOHANHUS_IDS,
    FRED,
    SETH,
    HORVIK,
    APOTHECARY,
    TASSIE,
    HAMMERSPIKE,
    ...GANG_IDS,
    SANFEW,
    ...BLEEMADGE_IDS,
    ARHEIN,
    FARSIGHT,
    TINDEL,
    PETRA,
    ...CROMPERTY_IDS,
    ...GNORMADIUM_IDS,
    ...RANTZ_IDS,
  ]);

  // ==========================================================================
  // Items
  // ==========================================================================

  const COINS = ItemIdentifiers.COINS; // 995
  const BLUNT_AXE = ItemIdentifiers.BLUNT_AXE; // 4415
  const SHARPENED_AXE = ItemIdentifiers.SHARPENED_AXE; // 4444
  const RED_MAHOGANY_LOG = ItemIdentifiers.RED_MAHOGANY_LOG; // 4445
  const HERBAL_TINCTURE = ItemIdentifiers.HERBAL_TINCTURE; // 4416
  const BREATHING_SALTS = ItemIdentifiers.BREATHING_SALTS; // 4442
  const AIRTIGHT_POT = ItemIdentifiers.AIRTIGHT_POT; // 4436
  const GUTHIX_REST_4_DOSE = ItemIdentifiers.GUTHIX_REST_4_; // 4417
  const GUTHIX_REST_ITEM_IDS = [
    GUTHIX_REST_4_DOSE,
    ItemIdentifiers.GUTHIX_REST_3_, // 4419
    ItemIdentifiers.GUTHIX_REST_2_, // 4421
    ItemIdentifiers.GUTHIX_REST_1_, // 4423
  ];
  const STODGY_MATTRESS = ItemIdentifiers.STODGY_MATTRESS; // 4425
  const COMFY_MATTRESS = ItemIdentifiers.COMFY_MATTRESS; // 4426
  const IRON_OXIDE = ItemIdentifiers.IRON_OXIDE; // 4427
  const ANIMATE_ROCK_SCROLL = ItemIdentifiers.ANIMATE_ROCK_SCROLL; // 4428
  const BROKEN_DIRECTIONALS = ItemIdentifiers.BROKEN_VANE_PART; // 4429
  const DIRECTIONALS = ItemIdentifiers.DIRECTIONALS; // 4430
  const BROKEN_ORNAMENT = ItemIdentifiers.BROKEN_VANE_PART_2; // 4431
  const ORNAMENT = ItemIdentifiers.ORNAMENT; // 4432
  const BROKEN_PILLAR = ItemIdentifiers.BROKEN_VANE_PART_3; // 4433
  const WEATHERVANE_PILLAR = ItemIdentifiers.WEATHERVANE_PILLAR; // 4434
  const WEATHER_REPORT = ItemIdentifiers.WEATHER_REPORT; // 4435
  const UNFIRED_POT_LID = ItemIdentifiers.UNFIRED_POT_LID; // 4438
  const POT_LID = ItemIdentifiers.POT_LID; // 4440
  const CHICKEN_CAGE = ItemIdentifiers.CHICKEN_CAGE; // 4443
  const STEEL_KEY_RING = ItemIdentifiers.STEEL_KEY_RING; // 4446
  const ANTIQUE_LAMP = ItemIdentifiers.ANTIQUE_LAMP; // 4447
  const BOWL_OF_HOT_WATER = ItemIdentifiers.BOWL_OF_HOT_WATER; // 4456
  const CUP_OF_HOT_WATER = ItemIdentifiers.CUP_OF_HOT_WATER; // 4460
  const EMPTY_CUP = ItemIdentifiers.EMPTY_CUP; // 1980
  const BOWL_OF_WATER = ItemIdentifiers.BOWL_OF_WATER; // 1921
  const POT = ItemIdentifiers.POT; // 1931
  const SOFT_CLAY = ItemIdentifiers.SOFT_CLAY; // 1761
  const PIGEON_CAGE = ItemIdentifiers.PIGEON_CAGE; // 424
  const STEEL_BAR = ItemIdentifiers.STEEL_BAR; // 2353
  const BRONZE_BAR = ItemIdentifiers.BRONZE_BAR; // 2349
  const IRON_BAR = ItemIdentifiers.IRON_BAR; // 2351
  const GUAM_LEAF = ItemIdentifiers.GUAM_LEAF; // 249
  const MARRENTILL = ItemIdentifiers.MARRENTILL; // 251
  const HARRALANDER = ItemIdentifiers.HARRALANDER; // 255
  const CHISEL = ItemIdentifiers.CHISEL; // 1755
  const HAMMER = ItemIdentifiers.HAMMER; // 2347
  const UNCUT_SAPPHIRE = ItemIdentifiers.UNCUT_SAPPHIRE; // 1623
  const UNCUT_OPAL = ItemIdentifiers.UNCUT_OPAL; // 1625
  const UNCUT_RED_TOPAZ = ItemIdentifiers.UNCUT_RED_TOPAZ; // 1629
  const UNCUT_JADE = ItemIdentifiers.UNCUT_JADE; // 1627
  const SAPPHIRE = ItemIdentifiers.SAPPHIRE; // 1607
  const OPAL = ItemIdentifiers.OPAL; // 1609
  const RED_TOPAZ = ItemIdentifiers.RED_TOPAZ; // 1613
  const JADE = ItemIdentifiers.JADE; // 1611
  const CUT_GEM_IDS = new Set([SAPPHIRE, OPAL, RED_TOPAZ, JADE]);
  const BAR_NAMES = new Map([
    [BRONZE_BAR, "a bronze bar"],
    [IRON_BAR, "an iron bar"],
    [STEEL_BAR, "a steel bar"],
  ]);

  // ==========================================================================
  // Objects
  // ==========================================================================

  const SCULPTURE = ObjectIdentifiers.SCULPTURE; // 5808, Goblin Cave (2621,9835)
  const BROKEN_WEATHERVANE = ObjectIdentifiers.WEATHERVANE; // 5809, "Weathervane"
  const FIXED_WEATHERVANE = ObjectIdentifiers.SEERS_WEATHERVANE; // 5810, "Seers weathervane"
  const WEATHERVANE_MULTI = 5811; // nameless osf_weathervane multiloc at 2702,3476,3
  const WEATHERVANE_OBJECT_IDS = new Set([WEATHERVANE_MULTI, BROKEN_WEATHERVANE, FIXED_WEATHERVANE]);
  const GNOME_LANDING_LIGHT = ObjectIdentifiers.GNOME_LANDING_LIGHT; // 5815, "Gnome landing light"
  // The map stores the four Feldip panels (one per gem) as un-named wall locs 5820-5823.
  const LANDING_LIGHT_PANEL_IDS = new Set([5820, 5821, 5822, 5823]);
  const HOT_WATER_SOURCES = new Set(["Cooking range", "Range", "Fire", "Oven", "Clay oven", "Small oven", "Large oven"]);
  // The Seers' roof (where the weathervane sits, 2702,3476,3) has no upper end for
  // the ladder at 2715,3472,1 in this cache's maps, and the trapdoor above it has no
  // lower end either; these ids/tiles put the two-way link back.
  const ROOF_LADDER = 26118; // "Ladder" at 2715,3472,1, Climb-up
  const ROOF_TRAPDOOR = 26119; // "Trapdoor" at 2715,3472,3, Climb-down
  const ROOF_LADDER_TILE = new Location(2715, 3472, 1);
  const ROOF_TRAPDOOR_TILE = new Location(2715, 3472, 3);
  const ROOF_TILE = new Location(2714, 3472, 3);
  const ROOF_EXIT_TILE = new Location(2715, 3471, 1);

  // ==========================================================================
  // Varbits (varp 417 "onesmallfavourmulti")
  // ==========================================================================

  const VARBIT_ALL_LIGHTS_FIXED = 256; // all_lights_fixed, bit 25
  const VARBIT_FIXEDLANDINGLIGHTS = 6241; // fixedlandinglights, bits 9-16
  const VARBIT_WEATHERVANE_FIXED = 258; // weathervanefixed, bit 26

  // The eight landing lights. Columns/panels from yarn dump:loc 5820-5823
  // (jade x=2554, opal x=2548, red topaz x=2551, sapphire x=2545), each panel has
  // the two tiles light1/light2. Per-light search/fix varbits from lookup-gameval.
  const LIGHTS = [
    { x: 2545, y: 2969, gem: "sapphire", uncut: UNCUT_SAPPHIRE, cut: SAPPHIRE, takenVarbit: 6228, fixedVarbit: 6240 },
    { x: 2545, y: 2974, gem: "sapphire", uncut: UNCUT_SAPPHIRE, cut: SAPPHIRE, takenVarbit: 6232, fixedVarbit: 6236 },
    { x: 2548, y: 2969, gem: "opal", uncut: UNCUT_OPAL, cut: OPAL, takenVarbit: 6227, fixedVarbit: 6235 },
    { x: 2548, y: 2974, gem: "opal", uncut: UNCUT_OPAL, cut: OPAL, takenVarbit: 6231, fixedVarbit: 6239 },
    { x: 2551, y: 2969, gem: "red topaz", uncut: UNCUT_RED_TOPAZ, cut: RED_TOPAZ, takenVarbit: 6226, fixedVarbit: 6234 },
    { x: 2551, y: 2974, gem: "red topaz", uncut: UNCUT_RED_TOPAZ, cut: RED_TOPAZ, takenVarbit: 6230, fixedVarbit: 6238 },
    { x: 2554, y: 2969, gem: "jade", uncut: UNCUT_JADE, cut: JADE, takenVarbit: 6225, fixedVarbit: 6233 },
    { x: 2554, y: 2974, gem: "jade", uncut: UNCUT_JADE, cut: JADE, takenVarbit: 6229, fixedVarbit: 6237 },
  ];
  const LIGHT_BY_TILE = new Map(LIGHTS.map((light, index) => [`${light.x},${light.y}`, { ...light, index }]));

  // The transcript's message steps, replayed as system messages.
  const GEM_FOUND_MESSAGE = {
    sapphire: "You find an uncut sapphire in the landing light.",
    opal: "You find an uncut opal in the landing light.",
    "red topaz": "You find an uncut red topaz in the landing light.",
    jade: "You find an uncut jade in the landing light.",
  };
  const GEM_PLACED_MESSAGE = {
    sapphire: "You place the sapphire in the landing light. It seems to look right.",
    opal: "You place the opal in the landing light. It seems to look right.",
    "red topaz": "You place the red topaz in the landing light. It seems to look right.",
    jade: "You place the jade in the landing light. It seems to look right.",
  };
  const LIGHT_COUNT_MESSAGES = [
    "You've fixed one landing light so far...",
    "You've fixed 2 landing lights so far...",
    "You've fixed 3 landing lights so far...",
    "You've fixed 4 landing lights so far...",
    "You've fixed 5 landing lights so far...",
    "You've fixed 6 landing lights so far...",
    "You've fixed 7 landing lights so far...",
    "You've fixed all the landing lights!",
  ];

  // Broken part -> fixed part, bar, anvil condition id and bit (dir=2, ornament=1,
  // pillar=4); the installation bits share the layout.
  const VANE_PARTS = new Map([
    [BROKEN_DIRECTIONALS, { name: "directionals", fixed: DIRECTIONALS, bar: IRON_BAR, anvilCondition: "W2jBPO", bit: 2 }],
    [BROKEN_ORNAMENT, { name: "ornament", fixed: ORNAMENT, bar: BRONZE_BAR, anvilCondition: "pCOOeX", bit: 1 }],
    [BROKEN_PILLAR, { name: "pillar", fixed: WEATHERVANE_PILLAR, bar: STEEL_BAR, anvilCondition: "rSHT3a", bit: 4 }],
  ]);
  const VANE_INSTALL_BY_ITEM = new Map([
    [DIRECTIONALS, { name: "directionals", bit: 2 }],
    [ORNAMENT, { name: "ornament", bit: 1 }],
    [WEATHERVANE_PILLAR, { name: "pillar", bit: 4 }],
  ]);
  const VANE_ALL_BITS = 7;

  // ==========================================================================
  // Stages / attributes
  // ==========================================================================

  const VARP_ONE_SMALL_FAVOUR = 416; // "onesmallfavour"

  const STAGE_STARTED = 1;
  const STAGE_FORESTER = 2;
  const STAGE_BRIAN = 3;
  const STAGE_AGGIE = 4;
  const STAGE_JOHANHUS = 5;
  const STAGE_FRED = 6;
  const STAGE_SETH = 7;
  const STAGE_HORVIK = 8;
  const STAGE_APOTHECARY = 9;
  const STAGE_HAMMERSPIKE = 10;
  const STAGE_SANFEW = 11;
  const STAGE_BLEEMADGE = 12;
  const STAGE_ARHEIN = 13;
  const STAGE_SEERS = 14;
  const STAGE_MESSAGE = 15;
  const STAGE_CROMPERTY = 16;
  const STAGE_TINDEL = 17;
  const STAGE_RANTZ = 18;
  const STAGE_LIGHTS_FIXING = 19;
  const STAGE_LIGHTS_TOLD = 20;
  const STAGE_MATTRESS = 21;
  const STAGE_IRON_OXIDE = 22;
  const STAGE_SCROLL = 23;
  const STAGE_SLAGILITH = 24;
  const STAGE_PETRA_FREED = 25;
  const STAGE_VANE = 26;
  const STAGE_VANE_FIXED = 27;
  const STAGE_REPORT = 28;
  const STAGE_ARHEIN_DONE = 29;
  const STAGE_BLEEMADGE_DONE = 30;
  const STAGE_SANFEW_DONE = 31;
  const STAGE_HAMMER_FIGHT = 32;
  const STAGE_HAMMER_DONE = 33;
  const STAGE_TASSIE_DONE = 34;
  const STAGE_SALTS = 35;
  const STAGE_MEDICINE_GIVEN = 36;
  const STAGE_CAGES = 37;
  const STAGE_SETH_DONE = 38;
  const STAGE_JIMMY = 39;
  const STAGE_WITNESS = 40;
  const STAGE_AXE = 41;
  const STAGE_MAHOGANY = 42;
  const STAGE_COMPLETE = 285; // cache quest DB completion value

  const LIGHTS_SEARCHED_ATTRIBUTE = "quest.one_small_favour.lights-searched";
  const LIGHTS_FIXED_ATTRIBUTE = "quest.one_small_favour.lights-fixed";
  const VANE_SEARCHED_ATTRIBUTE = "quest.one_small_favour.vane-searched";
  const VANE_LOOSENED_ATTRIBUTE = "quest.one_small_favour.vane-loosened";
  const VANE_PARTS_TAKEN_ATTRIBUTE = "quest.one_small_favour.vane-parts-taken";
  const VANE_INSTALLED_ATTRIBUTE = "quest.one_small_favour.vane-installed";
  const SLAGILITH_KILLED_ATTRIBUTE = "quest.one_small_favour.slagilith-killed";
  const GANG_KILLS_ATTRIBUTE = "quest.one_small_favour.gang-kills";

  const HAMMERSPIKE_ROOM = new Location(2965, 9811, 0);
  const SCULPTURE_TILE = new Location(2621, 9835, 0);
  const PIGEON_CAGE_TILES = [
    new Location(2615, 3321, 0),
    new Location(2616, 3321, 0),
    new Location(2617, 3321, 0),
    new Location(2618, 3321, 0),
    new Location(2619, 3321, 0),
  ];
  const TASSIE_POT_TILE = new Location(3086, 3408, 0);

  const blockedStart = new WeakSet();
  const pendingVane = new WeakMap();
  const slagilithByPlayer = new WeakMap();
  let worldNpcsSpawned = false;
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

  function hasItem(player, itemId, amount = 1) {
    return player.getInventory().getAmount(itemId) >= amount;
  }

  function addItem(player, itemId, amount = 1) {
    player.getInventory().adds(itemId, amount);
  }

  function deleteItem(player, itemId, amount = 1) {
    player.getInventory().deleteNumber(itemId, amount);
  }

  function freeSlots(player) {
    return player.getInventory().getFreeSlots();
  }

  function attributeBits(player, key) {
    return Number(player.getAttribute(key)) | 0;
  }

  function setAttributeBits(player, key, value) {
    player.setAttribute(key, value | 0);
  }

  function hasGuthixRest(player) {
    return GUTHIX_REST_ITEM_IDS.some((itemId) => hasItem(player, itemId));
  }

  function deleteGuthixRest(player) {
    for (const itemId of GUTHIX_REST_ITEM_IDS) {
      if (hasItem(player, itemId)) {
        deleteItem(player, itemId, 1);
        return;
      }
    }
  }

  function questComplete(player, key) {
    const request = { player, key, complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function meetsRequirements(player) {
    const skills = player.getSkillManager();
    return (
      questComplete(player, "shilo_village") &&
      questComplete(player, "rune_mysteries") &&
      skills.getMaxLevel(Skill.AGILITY) >= 36 &&
      skills.getMaxLevel(Skill.CRAFTING) >= 25 &&
      skills.getMaxLevel(Skill.HERBLORE) >= 18 &&
      skills.getMaxLevel(Skill.SMITHING) >= 30
    );
  }

  function resolvedObjectId(event) {
    if (typeof event.definition?.getId === "function") return event.definition.getId();
    const resolved = ObjectDefinition.forPlayer(event.objectId, event.player);
    return resolved?.getId?.() ?? event.objectId;
  }

  function nearbySculpture(player) {
    return player.getLocation().isWithinDistance(SCULPTURE_TILE, 8);
  }

  // ==========================================================================
  // Landing lights
  // ==========================================================================

  function lightsSearched(player) {
    return attributeBits(player, LIGHTS_SEARCHED_ATTRIBUTE);
  }

  function lightsFixed(player) {
    return attributeBits(player, LIGHTS_FIXED_ATTRIBUTE);
  }

  function sendLightVarbits(player) {
    const sender = player.getPacketSender();
    const searched = lightsSearched(player);
    const fixed = lightsFixed(player);
    LIGHTS.forEach((light, index) => {
      sender.sendVarbit(light.takenVarbit, (searched >> index) & 1);
      sender.sendVarbit(light.fixedVarbit, (fixed >> index) & 1);
    });
    sender.sendVarbit(VARBIT_FIXEDLANDINGLIGHTS, fixed);
    sender.sendVarbit(VARBIT_ALL_LIGHTS_FIXED, fixed === 0xff ? 1 : 0);
  }

  function sendVaneVarbit(player) {
    player.getPacketSender().sendVarbit(VARBIT_WEATHERVANE_FIXED, stageOf(player) >= STAGE_VANE_FIXED ? 1 : 0);
  }

  function syncVarbits(player) {
    sendLightVarbits(player);
    sendVaneVarbit(player);
  }

  function searchLandingLight(event) {
    const { player } = event;
    if (stageOf(player) !== STAGE_LIGHTS_FIXING) return false;
    const location = event.location ?? event.object?.getLocation?.();
    if (!location) return false;
    const light = LIGHT_BY_TILE.get(`${location.x},${location.y}`);
    if (!light) return false;
    event.handled = true;
    const searched = lightsSearched(player);
    const bit = 1 << light.index;
    if (lightsFixed(player) & bit) return;
    if (!(searched & bit)) {
      addItem(player, light.uncut, 1);
      player.sendMessage(GEM_FOUND_MESSAGE[light.gem]);
      setAttributeBits(player, LIGHTS_SEARCHED_ATTRIBUTE, searched | bit);
      player.getPacketSender().sendVarbit(light.takenVarbit, 1);
      return;
    }
    // Lost the gem: hand another one over instead of soft-locking the light.
    if (!hasItem(player, light.uncut) && !hasItem(player, light.cut)) {
      addItem(player, light.uncut, 1);
      player.sendMessage(GEM_FOUND_MESSAGE[light.gem]);
    }
  }

  function placeLightGem(event, light) {
    const { player } = event;
    if (stageOf(player) !== STAGE_LIGHTS_FIXING) return;
    if (!hasItem(player, light.cut)) return;
    event.handled = true;
    deleteItem(player, light.cut, 1);
    const next = lightsFixed(player) | (1 << light.index);
    setAttributeBits(player, LIGHTS_FIXED_ATTRIBUTE, next);
    player.getPacketSender().sendVarbit(light.fixedVarbit, 1);
    player.sendMessage(GEM_PLACED_MESSAGE[light.gem]);
    const count = LIGHTS.filter((_, index) => next & (1 << index)).length;
    player.sendMessage(LIGHT_COUNT_MESSAGES[count - 1]);
    if (count === LIGHTS.length) {
      player.getPacketSender().sendVarbit(VARBIT_FIXEDLANDINGLIGHTS, 0xff);
      player.getPacketSender().sendVarbit(VARBIT_ALL_LIGHTS_FIXED, 1);
    }
  }

  // ==========================================================================
  // Weather vane
  // ==========================================================================

  function installedBits(player) {
    return attributeBits(player, VANE_INSTALLED_ATTRIBUTE);
  }

  function grantVaneParts(player) {
    for (const [brokenId, part] of VANE_PARTS) {
      if (!hasItem(player, brokenId) && !hasItem(player, part.fixed)) addItem(player, brokenId, 1);
    }
    setAttributeBits(player, VANE_PARTS_TAKEN_ATTRIBUTE, VANE_ALL_BITS);
  }

  function vanePartMissing(player) {
    for (const [brokenId, part] of VANE_PARTS) {
      if ((installedBits(player) & part.bit) === 0 && !hasItem(player, brokenId) && !hasItem(player, part.fixed)) {
        return true;
      }
    }
    return false;
  }

  function searchVane(event) {
    const { player } = event;
    event.handled = true;
    if (stageOf(player) < STAGE_VANE) return;
    if (player.getAttribute(VANE_SEARCHED_ATTRIBUTE) !== true) {
      player.setAttribute(VANE_SEARCHED_ATTRIBUTE, true);
      startTranscript(api, player, FARSIGHT, PAGE, "heading-back-to-complete-the-favours-farsight-weather-vane-searching");
      return;
    }
    if (player.getAttribute(VANE_LOOSENED_ATTRIBUTE) !== true) {
      startTranscript(api, player, FARSIGHT, PAGE, "heading-back-to-complete-the-favours-farsight-weather-vane-searching");
      return;
    }
    if (attributeBits(player, VANE_PARTS_TAKEN_ATTRIBUTE) !== VANE_ALL_BITS || vanePartMissing(player)) {
      startTranscript(api, player, FARSIGHT, PAGE, "heading-back-to-complete-the-favours-farsight-weather-vane-searching-after-loosening-its-parts");
      return;
    }
    startTranscript(api, player, FARSIGHT, PAGE, "heading-back-to-complete-the-favours-farsight-weather-vane-searching-after-retrieving-its-parts");
  }

  function lookVane(event) {
    if (stageOf(event.player) < STAGE_VANE) return;
    event.handled = true;
    startTranscript(api, event.player, FARSIGHT, PAGE, "heading-back-to-complete-the-favours-farsight-weather-vane-looking");
  }

  // ==========================================================================
  // Seers' roof link (see ROOF_LADDER above)
  // ==========================================================================

  function atTile(location, tile) {
    return location && location.x === tile.getX() && location.y === tile.getY() && location.z === tile.getZ();
  }

  function climbRoofLadder(event) {
    if (resolvedObjectId(event) !== ROOF_LADDER) return false;
    const location = event.location ?? event.object?.getLocation?.();
    if (!atTile(location, ROOF_LADDER_TILE)) return false;
    event.handled = true;
    event.player.moveTo(ROOF_TILE);
  }

  function descendRoofTrapdoor(event) {
    if (resolvedObjectId(event) !== ROOF_TRAPDOOR) return false;
    const location = event.location ?? event.object?.getLocation?.();
    if (!atTile(location, ROOF_TRAPDOOR_TILE)) return false;
    event.handled = true;
    event.player.moveTo(ROOF_EXIT_TILE);
  }

  // ==========================================================================
  // Reads and item interactions
  // ==========================================================================

  function readAnimateRockScroll(event) {
    const { player } = event;
    const stage = stageOf(player);
    if (stage < STAGE_SCROLL || stage > STAGE_SLAGILITH) return;
    if (!nearbySculpture(player)) {
      startTranscript(api, player, PETRA, PAGE, "heading-back-to-complete-the-favours-petra-using-the-animate-rock-scroll");
      return;
    }
    if (stage === STAGE_SLAGILITH && player.getAttribute(SLAGILITH_KILLED_ATTRIBUTE) === true) {
      startTranscript(api, player, PETRA, PAGE, "heading-back-to-complete-the-favours-petra-freeing-petra");
      setStage(player, STAGE_PETRA_FREED);
      return;
    }
    startTranscript(api, player, PETRA, PAGE, "heading-back-to-complete-the-favours-petra-using-the-animate-rock-scroll");
    if (stage === STAGE_SCROLL) setStage(player, STAGE_SLAGILITH);
    spawnSlagilith(player);
  }

  function spawnSlagilith(player) {
    const existing = slagilithByPlayer.get(player);
    if (existing && (typeof existing.isRegistered !== "function" || existing.isRegistered()) && existing.getHitpoints() > 0) {
      return;
    }
    const npc = api.spawnNpc({
      id: SLAGILITH,
      x: 2617,
      y: 9835,
      z: 0,
      owner: player,
      ownerOnly: true,
      wanderRadius: 0,
    });
    if (!npc) return;
    npc.__skipDefaultRespawn = true;
    npc.getCombat().attack(player);
    slagilithByPlayer.set(player, npc);
  }

  function isAnvilName(name) {
    return typeof name === "string" && name.toLowerCase().includes("anvil");
  }

  function handleItemOnObject(event) {
    const { player, itemId } = event;
    const objectId = resolvedObjectId(event);
    const objectName = ObjectDefinition.forId(objectId)?.getName?.();

    if (itemId === HAMMER && WEATHERVANE_OBJECT_IDS.has(objectId)) {
      event.handled = true;
      if (stageOf(player) < STAGE_VANE) return;
      if (player.getAttribute(VANE_LOOSENED_ATTRIBUTE) === true) return;
      player.setAttribute(VANE_LOOSENED_ATTRIBUTE, true);
      startTranscript(api, player, FARSIGHT, PAGE, "heading-back-to-complete-the-favours-farsight-weather-vane-using-a-hammer-to-loosen-its-parts");
      return;
    }

    const broken = VANE_PARTS.get(itemId);
    if (broken && isAnvilName(objectName)) {
      event.handled = true;
      if (stageOf(player) < STAGE_VANE) return;
      if (!hasItem(player, broken.bar)) {
        player.sendMessage(`You need ${BAR_NAMES.get(broken.bar)} to repair the ${broken.name}.`);
        return;
      }
      deleteItem(player, broken.bar, 1);
      deleteItem(player, itemId, 1);
      addItem(player, broken.fixed, 1);
      pendingVane.set(player, broken.name);
      startTranscript(api, player, FARSIGHT, PAGE, "heading-back-to-complete-the-favours-farsight-weather-vane-fixing-the-parts");
      return;
    }

    const install = VANE_INSTALL_BY_ITEM.get(itemId);
    if (install && WEATHERVANE_OBJECT_IDS.has(objectId)) {
      event.handled = true;
      const stage = stageOf(player);
      if (stage < STAGE_VANE || stage >= STAGE_VANE_FIXED) return;
      if (installedBits(player) & install.bit) return;
      deleteItem(player, itemId, 1);
      const bits = installedBits(player) | install.bit;
      setAttributeBits(player, VANE_INSTALLED_ATTRIBUTE, bits);
      pendingVane.set(player, install.name);
      if (bits === VANE_ALL_BITS) {
        setStage(player, STAGE_VANE_FIXED);
        sendVaneVarbit(player);
      }
      startTranscript(api, player, FARSIGHT, PAGE, "heading-back-to-complete-the-favours-farsight-weather-vane-repairing-the-weather-vane");
      return;
    }

    if (CUT_GEM_IDS.has(itemId) && (objectId === GNOME_LANDING_LIGHT || LANDING_LIGHT_PANEL_IDS.has(objectId))) {
      const location = event.location;
      const light = location ? LIGHT_BY_TILE.get(`${location.x},${location.y}`) : undefined;
      if (light && light.cut === itemId) placeLightGem(event, light);
      return;
    }

    if (itemId === BOWL_OF_WATER && HOT_WATER_SOURCES.has(objectName)) {
      if (stageOf(player) < STAGE_SANFEW || stageOf(player) >= STAGE_COMPLETE) return;
      event.handled = true;
      deleteItem(player, BOWL_OF_WATER, 1);
      addItem(player, BOWL_OF_HOT_WATER, 1);
      player.sendMessage("You heat the bowl of water.");
      return;
    }

    if (itemId === UNFIRED_POT_LID && objectName === "Pottery Oven") {
      event.handled = true;
      deleteItem(player, UNFIRED_POT_LID, 1);
      addItem(player, POT_LID, 1);
      player.sendMessage("You fire the pot lid in the oven.");
    }
  }

  function brewGuthixRest(player) {
    if (!hasItem(player, GUAM_LEAF, 2) || !hasItem(player, MARRENTILL, 1)) {
      player.sendMessage("You need 1 harralander, 2 guam leaves and 1 marrentill to brew Guthix's rest.");
      return;
    }
    deleteItem(player, HARRALANDER, 1);
    deleteItem(player, GUAM_LEAF, 2);
    deleteItem(player, MARRENTILL, 1);
    if (hasItem(player, BOWL_OF_HOT_WATER)) deleteItem(player, BOWL_OF_HOT_WATER, 1);
    else deleteItem(player, CUP_OF_HOT_WATER, 1);
    addItem(player, GUTHIX_REST_4_DOSE, 1);
    player.sendMessage("You brew a cup of Guthix's rest.");
  }

  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const pair = new Set([usedItemId, usedWithItemId]);

    if (pair.has(POT_LID) && pair.has(POT)) {
      event.handled = true;
      deleteItem(player, POT_LID, 1);
      deleteItem(player, POT, 1);
      addItem(player, AIRTIGHT_POT, 1);
      player.sendMessage("You seal the pot with the lid, making it airtight.");
      return;
    }

    if (pair.has(BOWL_OF_HOT_WATER) && pair.has(EMPTY_CUP)) {
      event.handled = true;
      deleteItem(player, BOWL_OF_HOT_WATER, 1);
      deleteItem(player, EMPTY_CUP, 1);
      addItem(player, CUP_OF_HOT_WATER, 1);
      player.sendMessage("You pour the hot water into the cup.");
      return;
    }

    if (pair.has(HARRALANDER) && (pair.has(BOWL_OF_HOT_WATER) || pair.has(CUP_OF_HOT_WATER))) {
      if (stageOf(player) === 0) return;
      event.handled = true;
      brewGuthixRest(player);
    }
  }

  // ==========================================================================
  // World spawns and ground items
  // ==========================================================================

  function ensureWorldNpcs() {
    if (worldNpcsSpawned) return;
    worldNpcsSpawned = true;
    // Quest NPCs with no npc-spawns.json entry, at their OSRS spots.
    api.spawnNpc({ id: NpcIdentifiers.GNORMADIUM_AVLAFRIM, x: 2544, y: 2971, z: 0, wanderRadius: 0 });
    api.spawnNpc({ id: NpcIdentifiers.CAPTAIN_BLEEMADGE, x: 2846, y: 3498, z: 0, wanderRadius: 0 });
    api.spawnNpc({ id: NpcIdentifiers.WIZARD_CROMPERTY, x: 2681, y: 3325, z: 0, wanderRadius: 0 });
  }

  function syncGroundItems(player) {
    if (!player || player.isPlayerBot?.() === true) return;
    const manager = api.getItemOnGroundManager();
    if (!manager?.registerLocation || !manager?.getGroundItem) return;
    const stage = stageOf(player);
    const privateArea = player.getPrivateArea?.() ?? null;
    if (stage >= STAGE_MEDICINE_GIVEN && stage < STAGE_CAGES) {
      for (const tile of PIGEON_CAGE_TILES) {
        if (manager.getGroundItem(player.getUsername(), PIGEON_CAGE, tile, privateArea)) continue;
        manager.registerLocation(player, new Item(PIGEON_CAGE, 1), tile);
      }
    }
    if (stage >= STAGE_TASSIE_DONE && stage < STAGE_MEDICINE_GIVEN) {
      if (!hasItem(player, POT) && !manager.getGroundItem(player.getUsername(), POT, TASSIE_POT_TILE, privateArea)) {
        manager.registerLocation(player, new Item(POT, 1), TASSIE_POT_TILE);
      }
    }
  }

  // ==========================================================================
  // Dialogue variant selection (Talk-to)
  // ==========================================================================

  function selectVariant(event) {
    const { player, npcId } = event;
    const stage = stageOf(player);

    if (npcId === YANNI) {
      if (stage === 0) return "starting-up-speaking-to-yanni-salika";
      if (stage < STAGE_COMPLETE) {
        if (stage === STAGE_MAHOGANY && hasItem(player, RED_MAHOGANY_LOG)) {
          return "finishing-up-returning-to-yanni-salika-with-the-red-mahogany";
        }
        return "starting-up-speaking-to-yanni-salika-returning-to-yanni-without-completing-the-favour";
      }
      return null;
    }

    if (FORESTER_IDS.has(npcId)) {
      if (stage === 0) return null;
      if (stage === STAGE_STARTED) {
        return "the-various-favours-are-asked-asking-jungle-forester-for-red-mahogany";
      }
      if (stage >= STAGE_MAHOGANY) {
        if (!hasItem(player, RED_MAHOGANY_LOG)) {
          return "heading-back-to-complete-the-favours-jungle-forester-losing-the-red-mahogany-logs";
        }
        return null;
      }
      if (hasItem(player, SHARPENED_AXE)) {
        return "heading-back-to-complete-the-favours-jungle-forester-with-the-sharpened-axe";
      }
      if (!hasItem(player, BLUNT_AXE)) {
        return "the-various-favours-are-asked-asking-jungle-forester-for-red-mahogany-returning-to-the-jungle-forester-after-losing-the-blunt-axe";
      }
      return "the-various-favours-are-asked-asking-jungle-forester-for-red-mahogany-returning-to-the-jungle-forester-without-completing-the-favour";
    }

    if (npcId === CAPTAIN_SHANKS) {
      if (stage === STAGE_FORESTER) return "the-various-favours-are-asked-asking-captain-shanks-for-axe-sharpening";
      if (stage > STAGE_FORESTER && stage < STAGE_COMPLETE) {
        return "the-various-favours-are-asked-asking-captain-shanks-for-axe-sharpening-talking-to-captain-shanks-again";
      }
      return null;
    }

    if (npcId === BRIAN) {
      if (stage === STAGE_FORESTER) return "the-various-favours-are-asked-asking-brian-to-sharpen-the-axe";
      if (stage >= STAGE_BRIAN && stage < STAGE_WITNESS) {
        return "the-various-favours-are-asked-asking-brian-to-sharpen-the-axe-returning-to-brian-without-completing-the-favour";
      }
      if (stage >= STAGE_WITNESS && stage < STAGE_AXE) {
        return "heading-back-to-complete-the-favours-brian-before-getting-the-axe";
      }
      if (stage >= STAGE_AXE && stage < STAGE_COMPLETE) {
        return hasItem(player, SHARPENED_AXE)
          ? "heading-back-to-complete-the-favours-brian-with-the-axe"
          : "heading-back-to-complete-the-favours-brian-without-the-axe";
      }
      return null;
    }

    if (AGGIE_IDS.has(npcId)) {
      // Only Aggie's ask and final turn-in steps are OSF's; between them QH sends the
      // player to Jimmy/H.A.M., so other quests keep their own Aggie conversations.
      if (stage === STAGE_BRIAN) return "the-various-favours-are-asked-asking-aggie-to-be-a-character-witness";
      if (stage === STAGE_JIMMY) return "heading-back-to-complete-the-favours-aggie";
      return null;
    }

    if (JOHANHUS_IDS.has(npcId)) {
      if (stage === STAGE_AGGIE) return "the-various-favours-are-asked-asking-johanhus-about-jimmy-s-release";
      if (stage === STAGE_SETH_DONE) return "heading-back-to-complete-the-favours-johanhus";
      if (stage >= STAGE_JOHANHUS && stage < STAGE_SETH_DONE) {
        return "the-various-favours-are-asked-asking-johanhus-about-jimmy-s-release-returning-to-johanhus-without-completing-the-favour";
      }
      return null;
    }

    if (npcId === FRED) {
      // Fred owns only OSF's chicken request. After that QH sends the player to Seth,
      // and a completed OSF must not keep Fred from Sheep Shearer.
      if (stage === STAGE_JOHANHUS) return "the-various-favours-are-asked-asking-fred-for-chickens";
      return null;
    }

    if (npcId === SETH) {
      if (stage === STAGE_FRED) return "the-various-favours-are-asked-asking-seth-groats-for-chickens";
      if (stage === STAGE_SETH) return "the-various-favours-are-asked-asking-seth-groats-for-chickens-talking-to-him-again-before-talking-to-horvik";
      if (stage >= STAGE_HORVIK && stage < STAGE_CAGES) {
        return "the-various-favours-are-asked-asking-seth-groats-for-chickens-after-accepting-a-new-favour-from-horvik";
      }
      if (stage >= STAGE_CAGES && stage < STAGE_SETH_DONE) {
        return hasItem(player, CHICKEN_CAGE, 5)
          ? "heading-back-to-complete-the-favours-seth-with-all-chicken-cages"
          : "heading-back-to-complete-the-favours-seth-without-all-the-chicken-cages";
      }
      if (stage >= STAGE_SETH_DONE && stage < STAGE_COMPLETE) {
        return "heading-back-to-complete-the-favours-seth-after-delivering-the-cages-before-rescuing-jimmy";
      }
      return null;
    }

    if (npcId === HORVIK) {
      if (stage === STAGE_SETH) return "the-various-favours-are-asked-asking-horvik-about-chicken-cages";
      if (stage >= STAGE_HORVIK && stage < STAGE_SALTS) {
        return "the-various-favours-are-asked-asking-horvik-about-chicken-cages-returning-to-horvik-without-medicine";
      }
      if (stage === STAGE_SALTS) {
        if (hasItem(player, HERBAL_TINCTURE) && hasItem(player, BREATHING_SALTS)) {
          return "heading-back-to-complete-the-favours-horkiv-giving-the-items-to-horkiv-with-the-tincture-and-breathing-salts";
        }
        if (hasItem(player, HERBAL_TINCTURE)) {
          return "heading-back-to-complete-the-favours-horkiv-giving-the-items-to-horkiv-with-only-the-herbal-tincture";
        }
        if (hasItem(player, BREATHING_SALTS)) {
          return "heading-back-to-complete-the-favours-horkiv-giving-the-items-to-horkiv-with-only-breathing-salts";
        }
        return "the-various-favours-are-asked-asking-horvik-about-chicken-cages-returning-to-horvik-without-medicine";
      }
      if (stage === STAGE_MEDICINE_GIVEN) {
        if (hasItem(player, PIGEON_CAGE, 5)) {
          return "heading-back-to-complete-the-favours-horkiv-getting-the-chicken-cages-with-enough-pigeon-cages";
        }
        if (hasItem(player, PIGEON_CAGE)) {
          return "heading-back-to-complete-the-favours-horkiv-getting-the-chicken-cages-without-enough-pigeon-cages";
        }
        return "heading-back-to-complete-the-favours-horkiv-getting-the-chicken-cages-without-any-pigeon-cages";
      }
      if (stage === STAGE_CAGES && !hasItem(player, CHICKEN_CAGE, 5)) {
        return "heading-back-to-complete-the-favours-horkiv-getting-the-chicken-cages-without-some-of-the-chicken-cages";
      }
      return null;
    }

    if (npcId === APOTHECARY) {
      if (stage === STAGE_HORVIK) return "the-various-favours-are-asked-asking-the-apothecary-for-medicine";
      if (stage >= STAGE_APOTHECARY && stage < STAGE_SALTS) {
        if (hasItem(player, AIRTIGHT_POT)) return "heading-back-to-complete-the-favours-apothecary-with-an-airtight-pot";
        return "the-various-favours-are-asked-asking-the-apothecary-for-medicine-returning-to-the-apothecary-without-the-airtight-pot";
      }
      if (stage === STAGE_SALTS) {
        if (hasItem(player, BREATHING_SALTS)) return "heading-back-to-complete-the-favours-apothecary-with-breathing-salts";
        return "heading-back-to-complete-the-favours-apothecary-without-breathing-salts";
      }
      return null;
    }

    if (npcId === TASSIE) {
      if (stage === STAGE_APOTHECARY) return "the-various-favours-are-asked-tassie-s-request";
      if (stage >= STAGE_HAMMERSPIKE && stage < STAGE_HAMMER_DONE) {
        return "the-various-favours-are-asked-tassie-s-request-returning-to-tassie-without-completing-the-favour";
      }
      if (stage >= STAGE_HAMMER_DONE && stage < STAGE_MEDICINE_GIVEN) {
        // Replays the lesson (and re-gives the clay/lid) if the lid was lost.
        if (stage === STAGE_HAMMER_DONE) return "heading-back-to-complete-the-favours-tassie";
        const needsLesson =
          !hasItem(player, UNFIRED_POT_LID) && !hasItem(player, POT_LID) && !hasItem(player, AIRTIGHT_POT);
        if (needsLesson) return "heading-back-to-complete-the-favours-tassie";
      }
      return null;
    }

    if (npcId === HAMMERSPIKE) {
      if (stage === STAGE_HAMMERSPIKE) return "the-various-favours-are-asked-dealing-with-hammerspike-talking-to-hammerspike";
      if (stage === STAGE_SANFEW) {
        return "the-various-favours-are-asked-dealing-with-hammerspike-returning-to-hammerspike-without-completing-the-favour";
      }
      if (stage === STAGE_SANFEW_DONE) {
        return "heading-back-to-complete-the-favours-hammerspike-reporting-to-hammerspike";
      }
      if (stage === STAGE_HAMMER_FIGHT) {
        if (gangKills(player) >= 3) {
          setStage(player, STAGE_HAMMER_DONE);
          return "heading-back-to-complete-the-favours-hammerspike-after-defeating-his-men";
        }
        return "heading-back-to-complete-the-favours-hammerspike-reporting-to-hammerspike";
      }
      if (stage >= STAGE_HAMMER_DONE && stage < STAGE_COMPLETE) {
        return "heading-back-to-complete-the-favours-hammerspike-after-defeating-his-men";
      }
      return null;
    }

    if (GANG_IDS.has(npcId)) {
      if (stage >= STAGE_HAMMERSPIKE && stage <= STAGE_HAMMER_DONE) {
        return "the-various-favours-are-asked-dealing-with-hammerspike-talking-to-hammerspike-s-gang-members";
      }
      return null;
    }

    if (npcId === SANFEW) {
      if (stage === STAGE_HAMMERSPIKE) {
        return "the-various-favours-are-asked-asking-sanfew-to-take-hammerspike-as-an-initiate-returning-to-sanfew-without-completing-the-favour";
      }
      if (stage === STAGE_SANFEW) {
        return "the-various-favours-are-asked-asking-sanfew-to-take-hammerspike-as-an-initiate";
      }
      if (stage === STAGE_BLEEMADGE_DONE) return "heading-back-to-complete-the-favours-sanfew";
      return null;
    }

    if (BLEEMADGE_IDS.has(npcId)) {
      if (stage === STAGE_SANFEW) {
        return hasGuthixRest(player)
          ? "the-various-favours-are-asked-giving-bleemadge-the-tea-and-talking-about-sanfew-s-favour"
          : "the-various-favours-are-asked-talking-to-bleemadge-without-guthix-s-rest";
      }
      if (stage === STAGE_BLEEMADGE) {
        return "the-various-favours-are-asked-giving-bleemadge-the-tea-and-talking-about-sanfew-s-favour-returning-to-bleemadge-without-completing-the-favour";
      }
      if (stage >= STAGE_ARHEIN_DONE && stage < STAGE_COMPLETE) {
        return "heading-back-to-complete-the-favours-bleemadge";
      }
      return null;
    }

    if (npcId === ARHEIN) {
      if (stage === STAGE_BLEEMADGE || stage === STAGE_ARHEIN) return "the-various-favours-are-asked-talking-t-r-a-s-h-to-arhein";
      if (stage === STAGE_REPORT) return "heading-back-to-complete-the-favours-arheim-with-the-weather-report";
      if (stage === STAGE_ARHEIN_DONE) {
        return "heading-back-to-complete-the-favours-arheim-after-submitting-the-weather-report";
      }
      return null;
    }

    if (npcId === FARSIGHT) {
      if (stage === STAGE_ARHEIN) return "the-various-favours-are-asked-asking-farsight-for-a-forecast";
      if (stage >= STAGE_SEERS && stage <= STAGE_SLAGILITH) {
        return "the-various-favours-are-asked-asking-farsight-for-a-forecast-talking-to-phantuwti-fanstuwi-farsight-again";
      }
      if (stage === STAGE_PETRA_FREED) {
        return "heading-back-to-complete-the-favours-farsight-before-fixing-the-weather-vane";
      }
      if (stage === STAGE_VANE) {
        return "heading-back-to-complete-the-favours-farsight-after-freeing-petra";
      }
      if (stage === STAGE_VANE_FIXED) {
        return "heading-back-to-complete-the-favours-farsight-after-repairing-the-weather-vane";
      }
      if (stage >= STAGE_REPORT && stage < STAGE_COMPLETE) {
        return hasItem(player, WEATHER_REPORT)
          ? "heading-back-to-complete-the-favours-farsight-with-the-weather-report"
          : "heading-back-to-complete-the-favours-farsight-after-losing-the-weather-report";
      }
      return null;
    }

    if (CROMPERTY_IDS.has(npcId)) {
      if (stage === STAGE_MESSAGE) return "the-various-favours-are-asked-asking-wizard-cromperty-for-a-spell";
      if (stage === STAGE_CROMPERTY) {
        return "the-various-favours-are-asked-asking-wizard-cromperty-for-a-spell-returning-to-wizard-cromperty-without-completing-the-favour";
      }
      if (stage === STAGE_IRON_OXIDE) {
        return "heading-back-to-complete-the-favours-wizard-cromperty-with-the-iron-oxide";
      }
      if (stage === STAGE_SCROLL) {
        return hasItem(player, ANIMATE_ROCK_SCROLL)
          ? "heading-back-to-complete-the-favours-wizard-cromperty-with-the-animate-rock-scroll"
          : "heading-back-to-complete-the-favours-wizard-cromperty-after-losing-the-animate-rock-scroll";
      }
      return null;
    }

    if (npcId === TINDEL) {
      if (stage === STAGE_CROMPERTY) return "the-various-favours-are-asked-asking-tindel-marchant-for-iron-oxide";
      if (stage === STAGE_TINDEL) {
        return hasItem(player, STODGY_MATTRESS)
          ? "the-various-favours-are-asked-asking-tindel-marchant-for-iron-oxide-returning-to-tindel-marchant-without-completing-the-favour"
          : "the-various-favours-are-asked-asking-tindel-marchant-for-iron-oxide-returning-to-tindel-marchant-after-losing-the-mattress";
      }
      if (stage === STAGE_MATTRESS) return "heading-back-to-complete-the-favours-tindel-with-the-feathered-mattress";
      if (stage === STAGE_IRON_OXIDE) {
        return hasItem(player, IRON_OXIDE)
          ? "heading-back-to-complete-the-favours-tindel-with-the-iron-oxide"
          : "heading-back-to-complete-the-favours-tindel-after-losing-the-iron-oxide";
      }
      return null;
    }

    if (GNORMADIUM_IDS.has(npcId)) {
      if (stage === STAGE_RANTZ) return "the-various-favours-are-asked-helping-gnormadium-with-the-gnome-glider";
      if (stage === STAGE_LIGHTS_FIXING) {
        if (lightsFixed(player) === 0xff) {
          return "the-various-favours-are-asked-helping-gnormadium-with-the-gnome-glider-after-fixing-the-lights";
        }
        if (!hasItem(player, CHISEL)) {
          return "the-various-favours-are-asked-helping-gnormadium-with-the-gnome-glider-obtaining-a-chisel";
        }
        return "the-various-favours-are-asked-helping-gnormadium-with-the-gnome-glider-before-repairing-the-lights";
      }
      if (stage >= STAGE_LIGHTS_TOLD && stage < STAGE_COMPLETE) {
        return "the-various-favours-are-asked-helping-gnormadium-with-the-gnome-glider-talking-to-gnormadium-again";
      }
      return null;
    }

    return null;
  }

  function gangKills(player) {
    return Number(player.getAttribute(GANG_KILLS_ATTRIBUTE)) || 0;
  }

  // ==========================================================================
  // Rantz (his resolved id 14793 is not in npc-dialogue-index, so drive Talk-to)
  // ==========================================================================

  function talkRantz(event) {
    const { player } = event;
    const stage = stageOf(player);
    let variant = null;
    if (stage === STAGE_TINDEL) {
      variant = "the-various-favours-are-asked-asking-rantz-the-ogre-for-a-mattress";
    } else if (stage === STAGE_RANTZ) {
      variant = "the-various-favours-are-asked-asking-rantz-the-ogre-for-a-mattress-returning-to-rantz-without-completing-the-favour";
    } else if (stage === STAGE_LIGHTS_TOLD) {
      variant = "heading-back-to-complete-the-favours-rantz-after-helping-with-the-gnome-glider";
    } else if (stage === STAGE_MATTRESS) {
      variant = hasItem(player, COMFY_MATTRESS)
        ? "heading-back-to-complete-the-favours-rantz-with-the-comfy-mattress"
        : "heading-back-to-complete-the-favours-rantz-after-losing-the-comfy-mattress";
    }
    if (!variant) return false;
    startTranscript(api, player, event.definition?.getId?.() ?? event.npcId, PAGE, variant);
    return true;
  }

  // ==========================================================================
  // Condition answers
  // ==========================================================================

  function answerCondition(event) {
    const { player, stepId } = event;
    if (!QUEST_NPC_IDS.has(event.npcId) && !QUEST_NPC_IDS.has(event.definition?.getId?.())) return null;
    switch (stepId) {
      case "6nSqlH":
        return player.getSkillManager().getCombatLevel() < 45;
      case "b6-Anp":
        return !hasItem(player, BLUNT_AXE);
      case "-e5oRH":
        return !hasItem(player, STEEL_BAR, 3);
      case "mqzK4R":
        return hasItem(player, STEEL_BAR, 3);
      case "ICVUtB":
        if (!hasItem(player, HERBAL_TINCTURE) && stageOf(player) >= STAGE_APOTHECARY && stageOf(player) < STAGE_SALTS) {
          addItem(player, HERBAL_TINCTURE, 1);
          return true;
        }
        return false;
      case "q6QSGi":
        return !hasItem(player, COINS, 10);
      case "ikhDn6":
        return hasItem(player, COINS, 10);
      case "88K3dn":
        return !hasItem(player, COINS, 500);
      case "a5al5_":
        return hasItem(player, COINS, 500);
      case "sxngz5":
      case "mdWr29":
        return !hasItem(player, STODGY_MATTRESS);
      case "J4DYx2":
      case "ZP9lkf":
        return hasItem(player, STODGY_MATTRESS);
      case "dMyGSb":
      case "eJqjrp":
        return !hasItem(player, COINS, 200);
      case "nHmTio":
      case "psbw4U":
        return hasItem(player, COINS, 200);
      case "yXCvko":
        return !hasItem(player, COINS, 100);
      case "gfEKIx":
        return hasItem(player, COINS, 100);
      case "fJ6la5":
        return !nearbySculpture(player);
      case "uqtVzz":
        return nearbySculpture(player);
      case "VDA6gD":
        if (freeSlots(player) < 3) return false;
        grantVaneParts(player);
        return true;
      case "qb1gKa":
        return freeSlots(player) < 3;
      case "pCOOeX":
        return pendingVane.get(player) === "ornament";
      case "W2jBPO":
        return pendingVane.get(player) === "directionals";
      case "rSHT3a":
        return pendingVane.get(player) === "pillar";
      case "-WkeEZ":
        return pendingVane.get(player) === "ornament" && installedBits(player) !== VANE_ALL_BITS;
      case "oVMhAI":
        return pendingVane.get(player) === "directionals" && installedBits(player) !== VANE_ALL_BITS;
      case "uOuBas":
        return pendingVane.get(player) === "pillar" && installedBits(player) !== VANE_ALL_BITS;
      case "BZUOhc":
        return installedBits(player) === VANE_ALL_BITS && stageOf(player) >= STAGE_VANE_FIXED;
      case "ih_c4H":
        return !hasItem(player, AIRTIGHT_POT);
      case "dWiVwe":
        return hasItem(player, AIRTIGHT_POT);
      case "kykUbG":
        return !hasItem(player, COINS, 200);
      case "wWGutE":
        return hasItem(player, COINS, 200);
      case "u6jo5G":
        return !hasItem(player, CHICKEN_CAGE);
      case "tbn-SK":
        return hasItem(player, CHICKEN_CAGE);
      case "Eeseq9":
        return !hasItem(player, COINS, 200);
      case "o-UH8V":
        return hasItem(player, COINS, 200);
      case "iH7IEM":
      case "T_EyeN":
      case "i0LfuV":
        return false;
      case "kdHSLb":
        return !hasItem(player, PIGEON_CAGE);
      case "_qMM3G":
        return !hasItem(player, COINS, 100);
      case "c0pX3D":
        return hasItem(player, PIGEON_CAGE) && hasItem(player, COINS, 100);
      default:
        return null;
    }
  }

  // ==========================================================================
  // Transcript action / message handler
  // ==========================================================================

  function handleAction(event) {
    const { player, stepId } = event;
    switch (stepId) {
      case "ul6u_u":
      case "hZfe8O":
      case "xzC4Vz":
      case "CYi9G1":
      case "xeflYu":
      case "rgwHpN":
      case "NHdEV4":
      case "p9lJYE":
      case "LFXwI8":
      case "tGR6yI":
      case "YS3u_-":
      case "jUx6wG":
      case "_rAzFg":
      case "xfzTuc":
      case "HcMSzd":
      case "V5ywNF":
      case "d7iIGS":
      case "5Oxk_Y":
      case "YmddNA":
      case "pCW_ta":
      case "ZAlvcR":
      case "RWoHyM":
      case "QI-MkK":
      case "pQ4G8_":
      case "t0mBD3":
      case "mLqEi5":
      case "do1_2-":
        return;
      case "HBrQGQ":
        if (stageOf(player) === STAGE_SEERS) setStage(player, STAGE_MESSAGE);
        return;
      case "RzuWDD":
        if (!hasItem(player, BLUNT_AXE)) addItem(player, BLUNT_AXE, 1);
        if (stageOf(player) < STAGE_FORESTER) setStage(player, STAGE_FORESTER);
        return;
      case "xC0PO1":
        if (hasItem(player, BLUNT_AXE)) deleteItem(player, BLUNT_AXE, 1);
        if (stageOf(player) < STAGE_BRIAN) setStage(player, STAGE_BRIAN);
        return;
      case "bR3mg_":
        if (hasItem(player, STEEL_BAR, 3)) deleteItem(player, STEEL_BAR, 3);
        if (stageOf(player) < STAGE_HORVIK) setStage(player, STAGE_HORVIK);
        return;
      case "ZnDUL6":
        if (!hasItem(player, HERBAL_TINCTURE)) addItem(player, HERBAL_TINCTURE, 1);
        if (stageOf(player) < STAGE_APOTHECARY) setStage(player, STAGE_APOTHECARY);
        return;
      case "e017Ln":
        // Wiki "unavailable" marker inside Bleemadge's tea hand-in; keep it open.
        event.handled = true;
        return;
      case "30_mgi":
        deleteGuthixRest(player);
        if (stageOf(player) < STAGE_BLEEMADGE) setStage(player, STAGE_BLEEMADGE);
        return;
      case "QVgWFx":
        if (!hasItem(player, STODGY_MATTRESS)) addItem(player, STODGY_MATTRESS, 1);
        if (stageOf(player) < STAGE_TINDEL) setStage(player, STAGE_TINDEL);
        return;
      case "XDJxj8":
        if (hasItem(player, COINS, 100)) {
          deleteItem(player, COINS, 100);
          if (!hasItem(player, STODGY_MATTRESS)) addItem(player, STODGY_MATTRESS, 1);
        }
        return;
      case "S8UwpK":
        if (hasItem(player, COINS, 10) && !hasItem(player, CHISEL)) {
          deleteItem(player, COINS, 10);
          addItem(player, CHISEL, 1);
        }
        return;
      case "khx7U0":
        if (hasItem(player, STODGY_MATTRESS)) deleteItem(player, STODGY_MATTRESS, 1);
        if (!hasItem(player, COMFY_MATTRESS)) addItem(player, COMFY_MATTRESS, 1);
        if (stageOf(player) < STAGE_MATTRESS) setStage(player, STAGE_MATTRESS);
        return;
      case "AjI0FX":
        if (hasItem(player, COINS, 200)) {
          deleteItem(player, COINS, 200);
          if (!hasItem(player, COMFY_MATTRESS)) addItem(player, COMFY_MATTRESS, 1);
        }
        return;
      case "bkR9OA":
        if (hasItem(player, COMFY_MATTRESS)) deleteItem(player, COMFY_MATTRESS, 1);
        if (!hasItem(player, IRON_OXIDE)) addItem(player, IRON_OXIDE, 1);
        if (stageOf(player) < STAGE_IRON_OXIDE) setStage(player, STAGE_IRON_OXIDE);
        return;
      case "yPSGYz":
        if (hasItem(player, COINS, 200)) {
          deleteItem(player, COINS, 200);
          if (!hasItem(player, IRON_OXIDE)) addItem(player, IRON_OXIDE, 1);
        }
        return;
      case "TVeRFq":
        if (hasItem(player, IRON_OXIDE)) deleteItem(player, IRON_OXIDE, 1);
        return;
      case "Bza02G":
        if (!hasItem(player, ANIMATE_ROCK_SCROLL)) addItem(player, ANIMATE_ROCK_SCROLL, 1);
        if (stageOf(player) < STAGE_SCROLL) setStage(player, STAGE_SCROLL);
        return;
      case "J0bzxQ":
        if (!hasItem(player, WEATHER_REPORT)) addItem(player, WEATHER_REPORT, 1);
        if (stageOf(player) < STAGE_REPORT) setStage(player, STAGE_REPORT);
        return;
      case "fItdaI":
        if (hasItem(player, WEATHER_REPORT)) deleteItem(player, WEATHER_REPORT, 1);
        if (stageOf(player) < STAGE_ARHEIN_DONE) setStage(player, STAGE_ARHEIN_DONE);
        return;
      case "oBokWK":
        setStage(player, STAGE_HAMMER_FIGHT);
        player.setAttribute(GANG_KILLS_ATTRIBUTE, 0);
        attackWithGang(player);
        return;
      case "r-WDZ7":
        if (!hasItem(player, SOFT_CLAY)) addItem(player, SOFT_CLAY, 1);
        return;
      case "CNZzA5":
        if (hasItem(player, SOFT_CLAY)) deleteItem(player, SOFT_CLAY, 1);
        if (!hasItem(player, UNFIRED_POT_LID) && !hasItem(player, POT_LID) && !hasItem(player, AIRTIGHT_POT)) {
          addItem(player, UNFIRED_POT_LID, 1);
        }
        if (stageOf(player) < STAGE_TASSIE_DONE) setStage(player, STAGE_TASSIE_DONE);
        syncGroundItems(player);
        return;
      case "HwUNbQ":
        if (hasItem(player, AIRTIGHT_POT)) deleteItem(player, AIRTIGHT_POT, 1);
        return;
      case "2zkKoZ":
        if (!hasItem(player, BREATHING_SALTS)) addItem(player, BREATHING_SALTS, 1);
        if (stageOf(player) < STAGE_SALTS) setStage(player, STAGE_SALTS);
        return;
      case "tBZ_3K":
        if (hasItem(player, AIRTIGHT_POT) && hasItem(player, COINS, 200)) {
          deleteItem(player, AIRTIGHT_POT, 1);
          deleteItem(player, COINS, 200);
          if (!hasItem(player, BREATHING_SALTS)) addItem(player, BREATHING_SALTS, 1);
        }
        return;
      case "RGnIIu":
        if (hasItem(player, PIGEON_CAGE, 5)) deleteItem(player, PIGEON_CAGE, 5);
        return;
      case "rEm3R4":
        deleteItem(player, PIGEON_CAGE, player.getInventory().getAmount(PIGEON_CAGE));
        if (!hasItem(player, CHICKEN_CAGE, 5)) {
          addItem(player, CHICKEN_CAGE, 5 - player.getInventory().getAmount(CHICKEN_CAGE));
        }
        if (stageOf(player) < STAGE_CAGES) setStage(player, STAGE_CAGES);
        return;
      case "0hbmgc":
        if (hasItem(player, CHICKEN_CAGE, 5)) deleteItem(player, CHICKEN_CAGE, 5);
        if (stageOf(player) < STAGE_SETH_DONE) setStage(player, STAGE_SETH_DONE);
        return;
      case "unKHdm":
        if (!hasItem(player, SHARPENED_AXE)) addItem(player, SHARPENED_AXE, 1);
        if (stageOf(player) < STAGE_AXE) setStage(player, STAGE_AXE);
        return;
      case "HIa9CW":
        if (!hasItem(player, SHARPENED_AXE)) addItem(player, SHARPENED_AXE, 1);
        return;
      case "f0A05v":
        if (hasItem(player, SHARPENED_AXE)) deleteItem(player, SHARPENED_AXE, 1);
        return;
      case "tY7TjH":
        if (!hasItem(player, RED_MAHOGANY_LOG)) addItem(player, RED_MAHOGANY_LOG, 1);
        if (stageOf(player) < STAGE_MAHOGANY) setStage(player, STAGE_MAHOGANY);
        return;
      case "0DCnZC":
        if (hasItem(player, COINS, 200)) {
          deleteItem(player, COINS, 200);
          if (!hasItem(player, RED_MAHOGANY_LOG)) addItem(player, RED_MAHOGANY_LOG, 1);
        }
        return;
      case "-A_EOB":
        if (!hasItem(player, STEEL_KEY_RING)) addItem(player, STEEL_KEY_RING, 1);
        return;
      case "_KicpJ":
        if (!quest.isComplete(player)) quest.complete(player);
        return;
      default:
        return;
    }
  }

  function attackWithGang(player) {
    const npcs = api.getWorld()?.getNpcs ? [...api.getWorld().getNpcs()] : [];
    for (const npc of npcs) {
      const id = npc?.getContentId?.(player) ?? npc?.getId?.();
      if (!GANG_IDS.has(id) && !GANG_IDS.has(npc?.getId?.())) continue;
      const location = npc.getLocation?.();
      if (!location || !location.isWithinDistance(HAMMERSPIKE_ROOM, 12)) continue;
      if (npc.getHitpoints?.() <= 0) continue;
      npc.getCombat().attack(player);
    }
  }

  // ==========================================================================
  // Choice handler
  // ==========================================================================

  function buyMissingGem(player) {
    if (!hasItem(player, COINS, 500)) return;
    const fixed = lightsFixed(player);
    const missing = LIGHTS.find((light, index) => !(fixed & (1 << index)) && !hasItem(player, light.uncut) && !hasItem(player, light.cut));
    if (!missing) return;
    deleteItem(player, COINS, 500);
    addItem(player, missing.uncut, 1);
  }

  function handleChoice(event) {
    const { player, npcId, option } = event;
    switch (option) {
      case "Oh, Ok, I'll see if I can find Jimmy.":
        if (AGGIE_IDS.has(npcId) && stageOf(player) < STAGE_AGGIE) setStage(player, STAGE_AGGIE);
        return;
      case "Good news! Jimmy has been released!":
        if (AGGIE_IDS.has(npcId) && stageOf(player) === STAGE_JIMMY) setStage(player, STAGE_WITNESS);
        return;
      case "Ok, Jimmy has to be worth more than a few scrawny chickens!":
        if (JOHANHUS_IDS.has(npcId) && stageOf(player) < STAGE_JOHANHUS) setStage(player, STAGE_JOHANHUS);
        return;
      case "You're in luck, I've managed to swing that chicken deal for you.":
        if (JOHANHUS_IDS.has(npcId) && stageOf(player) === STAGE_SETH_DONE) setStage(player, STAGE_JIMMY);
        return;
      case "I need to talk to you about Jimmy.":
        if (npcId === FRED && stageOf(player) < STAGE_FRED) setStage(player, STAGE_FRED);
        return;
      case "Here's the red mahogany you asked for.":
        if (npcId === YANNI && stageOf(player) === STAGE_MAHOGANY && hasItem(player, RED_MAHOGANY_LOG)) {
          deleteItem(player, RED_MAHOGANY_LOG, 1);
        }
        return;
      case "Oh, ok! I guess it's not that much further to Varrock!":
        if (npcId === SETH && stageOf(player) < STAGE_SETH) setStage(player, STAGE_SETH);
        return;
      case "I have the tincture and the breathing salts.":
        if (npcId === HORVIK && hasItem(player, HERBAL_TINCTURE) && hasItem(player, BREATHING_SALTS)) {
          deleteItem(player, HERBAL_TINCTURE, 1);
          deleteItem(player, BREATHING_SALTS, 1);
          setStage(player, STAGE_MEDICINE_GIVEN);
          syncGroundItems(player);
        }
        return;
      case "Ok, I'll pay, here's the pigeon cage[s] and [X] gold.":
        if (npcId === HORVIK) {
          const missing = 5 - player.getInventory().getAmount(CHICKEN_CAGE);
          const swaps = Math.max(0, Math.min(missing, player.getInventory().getAmount(PIGEON_CAGE), Math.floor(player.getInventory().getAmount(COINS) / 100)));
          if (swaps > 0) {
            deleteItem(player, PIGEON_CAGE, swaps);
            deleteItem(player, COINS, swaps * 100);
            addItem(player, CHICKEN_CAGE, swaps);
          }
        }
        return;
      case "Ok, I'll deal with Hammerspike!":
        if (npcId === TASSIE && stageOf(player) < STAGE_HAMMERSPIKE) setStage(player, STAGE_HAMMERSPIKE);
        return;
      case "Ok, another favour...I think I can manage that.":
        if (npcId === HAMMERSPIKE && stageOf(player) < STAGE_SANFEW) setStage(player, STAGE_SANFEW);
        return;
      case "Yep, it's a deal.":
        if (npcId === SANFEW && stageOf(player) < STAGE_SANFEW) setStage(player, STAGE_SANFEW);
        return;
      case "Hi there, the Gnome Pilot has agreed to take you to see the ogres!":
        if (npcId === SANFEW && stageOf(player) === STAGE_BLEEMADGE_DONE) setStage(player, STAGE_SANFEW_DONE);
        return;
      case "Ok, I'll go and get you some T.R.A.S.H.":
        if (BLEEMADGE_IDS.has(npcId) && stageOf(player) < STAGE_BLEEMADGE) setStage(player, STAGE_BLEEMADGE);
        return;
      case "Hey there, did you get your T.R.A.S.H?":
        if (BLEEMADGE_IDS.has(npcId) && stageOf(player) === STAGE_ARHEIN_DONE) setStage(player, STAGE_BLEEMADGE_DONE);
        return;
      case "Yes, Ok, I'll do it!":
        if (npcId === ARHEIN && stageOf(player) < STAGE_ARHEIN) setStage(player, STAGE_ARHEIN);
        return;
      case "Yes, Ok, I'll do it.":
        if (npcId === FARSIGHT && stageOf(player) < STAGE_SEERS) setStage(player, STAGE_SEERS);
        return;
      case "Ok, show me where this weather vane is...I want to look at it.":
        if (npcId === FARSIGHT && stageOf(player) >= STAGE_PETRA_FREED && stageOf(player) < STAGE_VANE_FIXED) {
          setStage(player, STAGE_VANE);
        }
        return;
      case "Oh! Ok, one more 'small favour' isn't going to kill me...I hope!":
        if (CROMPERTY_IDS.has(npcId) && stageOf(player) < STAGE_CROMPERTY) setStage(player, STAGE_CROMPERTY);
        return;
      case "Okay, I'll do it!":
        if (npcId === TINDEL && stageOf(player) < STAGE_TINDEL) setStage(player, STAGE_TINDEL);
        return;
      case "Ok, I'll see what I can do.":
        if (RANTZ_IDS.has(npcId) && stageOf(player) < STAGE_RANTZ) setStage(player, STAGE_RANTZ);
        return;
      case "Yes, I'll take a look at them.":
        if (GNORMADIUM_IDS.has(npcId) && stageOf(player) < STAGE_LIGHTS_FIXING) setStage(player, STAGE_LIGHTS_FIXING);
        return;
      case "I've fixed all the lights!":
        if (GNORMADIUM_IDS.has(npcId) && lightsFixed(player) === 0xff && stageOf(player) === STAGE_LIGHTS_FIXING) {
          setStage(player, STAGE_LIGHTS_TOLD);
        }
        return;
      case "Okay, here's 500 coins, I'll buy one.":
        if (GNORMADIUM_IDS.has(npcId)) buyMissingGem(player);
        return;
      default:
        return;
    }
  }

  function handleHook(event) {
    if (event.hook !== START_HOOK) return;
    const { player } = event;
    if (quest.isComplete(player) || stageOf(player) !== 0) return;
    if (!meetsRequirements(player)) {
      blockedStart.add(player);
      player.sendMessage(REQUIREMENTS_MESSAGE);
      return;
    }
    blockedStart.delete(player);
    setStage(player, STAGE_STARTED);
  }

  function handleLine(event) {
    if (!blockedStart.has(event.player)) return;
    if (String(event.text ?? "").startsWith("Great, nice of you to do it for me.")) event.skip = true;
  }

  // ==========================================================================
  // Deaths and login
  // ==========================================================================

  function handleNpcDeath(event) {
    const player = event?.killer?.isPlayer?.() ? event.killer : null;
    if (!player) return;
    const npcId = event.npcId ?? event.npc?.getContentId?.(player) ?? event.npc?.getId?.();
    if (npcId === SLAGILITH || event.npc?.getId?.() === SLAGILITH) {
      player.setAttribute(SLAGILITH_KILLED_ATTRIBUTE, true);
      return;
    }
    if (GANG_IDS.has(npcId) || GANG_IDS.has(event.npc?.getId?.())) {
      if (stageOf(player) < STAGE_HAMMER_FIGHT) return;
      player.setAttribute(GANG_KILLS_ATTRIBUTE, gangKills(player) + 1);
    }
  }

  function handleLogin({ player }) {
    ensureWorldNpcs();
    syncVarbits(player);
    syncGroundItems(player);
  }

  function handleBootstrap({ player }) {
    syncVarbits(player);
  }

  // ==========================================================================
  // Sculpture interactions
  // ==========================================================================

  function lookSculpture(event) {
    if (stageOf(event.player) < STAGE_SEERS) return;
    event.handled = true;
    startTranscript(api, event.player, PETRA, PAGE, "the-various-favours-are-asked-searching-for-petra-in-the-goblin-cave-looking-at-the-sculpture");
  }

  function searchSculpture(event) {
    if (stageOf(event.player) < STAGE_SEERS) return;
    event.handled = true;
    startTranscript(api, event.player, PETRA, PAGE, "the-various-favours-are-asked-searching-for-petra-in-the-goblin-cave-searching-the-sculpture");
  }

  // ==========================================================================
  // Journal and rewards
  // ==========================================================================

  function buildJournal(player, handle) {
    const stage = handle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Yanni asked me to fetch a piece of red mahogany from the Kharazi</str>",
        "<str>Jungle, and one small favour turned into a chain of twenty of them.</str>",
        "<str>I finally got the wood and the favour is repaid.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage === 0) {
      return [
        "I can start this quest by talking to <col=800000>Yanni Salika</col> in his",
        "antiques shop in <col=800000>Shilo Village</col>.",
      ];
    }
    if (stage >= STAGE_MAHOGANY) {
      return [
        "<str>Everyone's favours are done and I have the red mahogany log.</str>",
        "I should take it back to <col=800000>Yanni Salika</col> in Shilo Village.",
      ];
    }
    if (stage >= STAGE_AXE) {
      return [
        "<str>Brian sharpened the jungle forester's axe.</str>",
        "I should take the <col=800000>sharpened axe</col> back to the",
        "<col=800000>jungle forester</col> south of Shilo Village.",
      ];
    }
    if (stage >= STAGE_WITNESS) {
      return [
        "<str>Aggie agreed to be Brian's character witness.</str>",
        "I should return to <col=800000>Brian</col> in Port Sarim for the axe.",
      ];
    }
    if (stage >= STAGE_JIMMY) {
      return [
        "<str>Johanhus released Jimmy the Chisel.</str>",
        "I should tell <col=800000>Aggie</col> in Draynor Village the good news.",
      ];
    }
    if (stage >= STAGE_SETH_DONE) {
      return [
        "<str>Seth has his chicken cages.</str>",
        "I should tell <col=800000>Johanhus Ulsbrecht</col> in the H.A.M. hideout",
        "to release Jimmy the Chisel.",
      ];
    }
    if (stage >= STAGE_CAGES) {
      return [
        "<str>Horvik turned the pigeon cages into chicken cages.</str>",
        "I should take the <col=800000>chicken cages</col> to",
        "<col=800000>Seth Groats</col> at the farm east of the River Lum.",
      ];
    }
    if (stage >= STAGE_MEDICINE_GIVEN) {
      return [
        "<str>Horvik has his medicine.</str>",
        "I need five <col=800000>pigeon cages</col> (from the house south of",
        "the north Ardougne bank) for him to convert.",
      ];
    }
    if (stage >= STAGE_SALTS) {
      return [
        "<str>The Apothecary gave me the breathing salts.</str>",
        "Take the <col=800000>herbal tincture</col> and",
        "<col=800000>breathing salts</col> back to <col=800000>Horvik</col>.",
      ];
    }
    if (stage >= STAGE_TASSIE_DONE) {
      return [
        "<str>Hammerspike agreed to leave Tassie alone and she showed me</str>",
        "<str>how to make pot lids.</str>",
        "Make the <col=800000>airtight pot</col> (fire the lid, use it on a pot)",
        "and take it to the <col=800000>Apothecary</col> in Varrock.",
      ];
    }
    if (stage >= STAGE_HAMMER_DONE) {
      return [
        "<str>Hammerspike's gang was beaten and he agreed to leave Tassie alone.</str>",
        "I should tell <col=800000>Tassie Slipcast</col> in Barbarian Village.",
      ];
    }
    if (stage >= STAGE_SANFEW_DONE) {
      return [
        "<str>Sanfew will take the dwarf as an initiate.</str>",
        "I should report the good news to <col=800000>Hammerspike</col> in",
        "the Dwarven Mine west cave.",
      ];
    }
    if (stage >= STAGE_BLEEMADGE_DONE) {
      return [
        "<str>Bleemadge installed the T.R.A.S.H. and will fly Sanfew.</str>",
        "I should tell <col=800000>Sanfew</col> in Taverley.",
      ];
    }
    if (stage >= STAGE_ARHEIN_DONE) {
      return [
        "<str>Arhein has the weather report and sent the T.R.A.S.H.</str>",
        "I should tell <col=800000>Captain Bleemadge</col> on White Wolf Mountain.",
      ];
    }
    if (stage >= STAGE_REPORT) {
      return [
        "<str>Phantuwti gave me the weather report.</str>",
        "Take it to <col=800000>Arhein</col> in Catherby.",
      ];
    }
    if (stage >= STAGE_VANE_FIXED) {
      return [
        "<str>The weather vane is repaired.</str>",
        "I should tell <col=800000>Phantuwti Fanstuwi Farsight</col> for the",
        "weather report.",
      ];
    }
    if (stage >= STAGE_VANE) {
      return [
        "<str>Petra is safe and the weather vane is broken.</str>",
        "Search it on the Seers' Village roof, whack it with a hammer, then",
        "repair <col=800000>ornament</col>, <col=800000>directionals</col> and",
        "<col=800000>pillar</col> on an anvil with bronze, iron and steel bars.",
      ];
    }
    if (stage >= STAGE_PETRA_FREED) {
      return [
        "<str>Slagilith is beaten and Petra is free.</str>",
        "I should tell <col=800000>Phantuwti Fanstuwi Farsight</col> in",
        "Seers' Village.",
      ];
    }
    if (stage >= STAGE_SLAGILITH) {
      return [
        "<str>The animate rock spell misfired and summoned a Slagilith!</str>",
        "Defeat it, then read the <col=800000>animate rock scroll</col> in",
        "front of Petra's sculpture again.",
      ];
    }
    if (stage >= STAGE_SCROLL) {
      return [
        "<str>Wizard Cromperty gave me the animate rock scroll.</str>",
        "Take it to the <col=800000>sculpture</col> in the Goblin Cave east of",
        "the Fishing Guild and read it to free Petra.",
      ];
    }
    if (stage >= STAGE_MATTRESS) {
      return [
        "<str>Rantz filled the mattress with feathers.</str>",
        "Take the <col=800000>comfy mattress</col> back to",
        "<col=800000>Tindel Marchant</col> in Port Khazard for the iron oxide,",
        "then take it to Wizard Cromperty.",
      ];
    }
    if (stage >= STAGE_LIGHTS_TOLD) {
      return [
        "<str>The landing lights are fixed and Gnormadium can finish the strip.</str>",
        "Return to <col=800000>Rantz</col> in the Feldip Hills for the mattress.",
      ];
    }
    if (stage >= STAGE_LIGHTS_FIXING) {
      return [
        "<str>Rantz sent me to help Gnormadium Avlafrim with the glider.</str>",
        "Search the eight <col=800000>landing lights</col>, cut the gems with a",
        "chisel and put them back.",
      ];
    }
    if (stage >= STAGE_RANTZ) {
      return [
        "<str>Rantz will fill the mattress once the gnome glider is finished.</str>",
        "Help <col=800000>Gnormadium Avlafrim</col> at the Feldip Hills landing",
        "strip.",
      ];
    }
    if (stage >= STAGE_TINDEL) {
      return [
        "<str>Tindel gave me his stodgy mattress.</str>",
        "Take it to <col=800000>Rantz</col> in the Feldip Hills to be filled",
        "with chompy feathers.",
      ];
    }
    if (stage >= STAGE_MESSAGE) {
      return [
        "<str>Cromperty needs iron oxide from Port Khazard.</str>",
        "Ask <col=800000>Tindel Marchant</col> for some.",
      ];
    }
    if (stage >= STAGE_SEERS) {
      return [
        "<str>Phantuwti asked me to find the missing Petra.</str>",
        "Search the <col=800000>sculpture</col> in the Goblin Cave east of the",
        "Fishing Guild for a clue.",
      ];
    }
    if (stage >= STAGE_ARHEIN) {
      return [
        "<str>Arhein wants a weather report from the Seers.</str>",
        "Ask <col=800000>Phantuwti Fanstuwi Farsight</col> in Seers' Village.",
      ];
    }
    if (stage >= STAGE_BLEEMADGE) {
      return [
        "<str>Bleemadge wants some T.R.A.S.H. from Arhein.</str>",
        "Ask <col=800000>Arhein</col> in Catherby.",
      ];
    }
    if (stage >= STAGE_SANFEW) {
      return [
        "<str>Sanfew wants a Guthix rest for the gnome pilot and the ogres.</str>",
        "Brew the tea (harralander, 2 guam, marrentill and hot water) and take",
        "it to <col=800000>Captain Bleemadge</col> on White Wolf Mountain.",
      ];
    }
    if (stage >= STAGE_HAMMERSPIKE) {
      return [
        "<str>Hammerspike wants to become a druid initiate.</str>",
        "Ask <col=800000>Sanfew</col> in Taverley to accept him.",
      ];
    }
    if (stage >= STAGE_APOTHECARY) {
      return [
        "<str>The Apothecary gave me the herbal tincture.</str>",
        "Ask <col=800000>Tassie Slipcast</col> in Barbarian Village to make an",
        "airtight pot for the breathing salts.",
      ];
    }
    if (stage >= STAGE_HORVIK) {
      return [
        "<str>Horvik has his steel bars and is ill.</str>",
        "Get <col=800000>herbal tincture</col> and",
        "<col=800000>breathing salts</col> from the Apothecary in Varrock.",
      ];
    }
    if (stage >= STAGE_SETH) {
      return [
        "<str>Seth Groats agreed to supply the chickens.</str>",
        "Take 3 <col=800000>steel bars</col> to <col=800000>Horvik</col> in",
        "Varrock to arrange the chicken cages.",
      ];
    }
    if (stage >= STAGE_FRED) {
      return [
        "<str>Fred can't supply the chickens; Seth Groats can.</str>",
        "Talk to <col=800000>Seth Groats</col> at the farm east of the River Lum.",
      ];
    }
    if (stage >= STAGE_JOHANHUS) {
      return [
        "<str>Johanhus wants a month's supply of chickens for Jimmy's release.</str>",
        "Ask <col=800000>Fred the Farmer</col> north of the H.A.M. hideout.",
      ];
    }
    if (stage >= STAGE_AGGIE) {
      return [
        "<str>Aggie asked me to find her missing apprentice, Jimmy the Chisel.</str>",
        "Search the <col=800000>H.A.M. Hideout</col> east of Draynor Village.",
      ];
    }
    if (stage >= STAGE_BRIAN) {
      return [
        "<str>Brian gave me a small favour before he sharpens the axe.</str>",
        "Ask <col=800000>Aggie</col> in Draynor Village to be his character",
        "witness.",
      ];
    }
    if (stage >= STAGE_FORESTER) {
      return [
        "<str>The jungle forester gave me his blunt axe to be sharpened.</str>",
        "Take it to <col=800000>Captain Shanks</col> west of Shilo Village, then",
        "to <col=800000>Brian</col> in Port Sarim.",
      ];
    }
    return [
      "<str>Yanni Salika asked me to fetch some red mahogany.</str>",
      "Talk to the <col=800000>jungle forester</col> south of Shilo Village.",
    ];
  }

  function grantReward(player) {
    if (!hasItem(player, STEEL_KEY_RING)) addItem(player, STEEL_KEY_RING, 1);
    addItem(player, ANTIQUE_LAMP, 1);
  }

  // ==========================================================================
  // Registration
  // ==========================================================================

  api.persistAttribute(LIGHTS_SEARCHED_ATTRIBUTE);
  api.persistAttribute(LIGHTS_FIXED_ATTRIBUTE);
  api.persistAttribute(VANE_SEARCHED_ATTRIBUTE);
  api.persistAttribute(VANE_LOOSENED_ATTRIBUTE);
  api.persistAttribute(VANE_PARTS_TAKEN_ATTRIBUTE);
  api.persistAttribute(VANE_INSTALLED_ATTRIBUTE);
  api.persistAttribute(SLAGILITH_KILLED_ATTRIBUTE);
  api.persistAttribute(GANG_KILLS_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "one_small_favour",
    name: "One Small Favour",
    varpId: VARP_ONE_SMALL_FAVOUR,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    rewardItemId: ANTIQUE_LAMP,
    rewardItemLabel: "2 Antique lamps (10,000 XP each)",
    otherRewards: [
      "A steel key ring",
      "The ability to make and drink Guthix rest tea",
      "The ability to craft pot lids",
      "Access to the gnome glider route to the Feldip Hills",
    ],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:hook", handleHook);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemOnItem(handleItemOnItem);
  api.onItemAction("Animate rock scroll", { Read: readAnimateRockScroll });
  api.onObjectInteraction("Sculpture", { Look: lookSculpture, Search: searchSculpture });
  api.onObjectInteraction("Weathervane", { Look: lookVane, Search: searchVane });
  api.onObjectInteraction("Gnome landing light", { Search: searchLandingLight });
  api.onObjectInteraction("Ladder", { "Climb-up": climbRoofLadder });
  api.onObjectInteraction("Trapdoor", { "Climb-down": descendRoofTrapdoor });
  api.onNpcInteraction("Rantz", { "Talk-to": talkRantz });
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerLogin(handleLogin);
  api.onCustomEvent("player:bootstrap-complete", handleBootstrap);
};
