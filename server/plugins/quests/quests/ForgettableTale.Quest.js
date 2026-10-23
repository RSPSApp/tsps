/**
 * Forgettable Tale... (members).
 *
 * The words come from the "Forgettable Tale..." transcript page; this plugin supplies the
 * variant selectors, the prose-condition answers, the Kelda hops patch and Keldagrim brewery
 * brewing, the Red Axe tunnel sequence, the memory-wipe cutscene and the reward.
 *
 * Stage varbit: 822 "forget_quest" (varp 521, bits 0-7). The value order below is this
 * plugin's own; no cache consumer of 822 exists beyond the quest list. The sibling bits of
 * varp 521 are driven the way the cache expects:
 *   823 forget_farming (0-3 weeds->raked, 4-7 growing, 8 grown), 825 forget_boarding_removed,
 *   826/827/828 forget_seed2/3/4_given (rowdy/Gauss/Khorvak), 829/830/831 ..._told,
 *   833/834/835 forget_room2_bookcase/paper1/paper2, 837 forget_region_status,
 *   838 forget_beer_given. Brewing varbits 736 brewing_vat_varbit_1 (water 1, malt 2,
 *   hops 68, yeast 69, brewed 71) and 738 brewing_barrel_varbit_1 (3 = stout in the barrel)
 *   live on varp 510.
 *
 * Stages (varbit 822): 1 started, 2 dwarf told, 3 beer given + first seed, 4 four seeds,
 * 5 Rind asked, 6 seeds planted, 7 hops harvested, 8 stout brewed, 9 stout collected,
 * 10 story heard, 11 Veldaban briefed, 12 boarding removed, 13 tunnel entered, 14 eavesdropped,
 * 15 archive searched, 16 memory wiped, 17 Veldaban told, 18 complete.
 *
 * Source: OSRS Wiki "Forgettable Tale...", its Quick guide and Transcript page; RuneLite
 * Quest Helper for tiles; the cache for every id and varbit.
 *
 * Gaps / approximations:
 *  - The tunnel's cart platforms and junction interface are not on this server's map (only
 *    Room 1's machinery/box/cart, the listening room, the archive and the cave entrances are
 *    placed). The nine junction configurations are compressed into one solve per chasm:
 *    search the box for stones, use the machinery, then ride the cart.
 *  - The secret minecart object is not placed at the Keldagrim station; once the director has
 *    the boarding removed, the southern cart conductor sends the player into the tunnel.
 *  - Cutscenes play their transcript lines and move the player; no camera/interface effects.
 *  - The Keldagrim pot and rake ground spawns are the world's; a beer glass must be brought
 *    (pouring the barrel needs one).
 *  - The King's Axe Inn barman's post-brewing line is not wired (hijacking his normal pub
 *    menu would stop beer sales); the Laughing Miner barmaid's lost-stout replacement is.
 *  - Kelda hops grow and the stout ferments in 15 minutes; agent:advance-time moves it.
 */
module.exports = function registerForgettableTaleQuest(api) {
  const {
    Equipment,
    ItemIdentifiers,
    ItemDefinition,
    Location,
    MapObjects,
    NpcIdentifiers,
    ObjectDefinition,
    ObjectIdentifiers,
    Skill,
  } = api.core;
  const { registerQuest, loadTranscripts, startTranscript } = require("../QuestRuntime");

  const PAGE = "Forgettable Tale...";

  // ==========================================================================
  // Ids
  // ==========================================================================

  const COMMANDER_VELDABAN = NpcIdentifiers.COMMANDER_VELDABAN; // 2228
  const COMMANDER_VELDABAN_2 = NpcIdentifiers.COMMANDER_VELDABAN_2; // 6045, the Keldagrim spawn
  const VELDABAN_IDS = new Set([COMMANDER_VELDABAN, COMMANDER_VELDABAN_2]);
  const GIANT_DWARF_STAGE_ATTRIBUTE = "quest.giant_dwarf.stage";
  const GIANT_MEETING_STAGE = 40;
  const GIANT_COMPLETE_STAGE = 50;

  const DRUNKEN_DWARF = NpcIdentifiers.DRUNKEN_DWARF; // 322, random-event twin
  const DRUNKEN_DWARF_2 = NpcIdentifiers.DRUNKEN_DWARF_2; // 2408
  const DRUNKEN_DWARF_4 = NpcIdentifiers.DRUNKEN_DWARF_4; // 2429, cutscene twin
  const DRUNKEN_DWARF_5 = NpcIdentifiers.DRUNKEN_DWARF_5; // 4305
  // dwarf_city_drunken_dwarf_multi, the NPC actually spawned in east Keldagrim.
  const DRUNKEN_DWARF_KELDAGRIM = 3198;
  const DRUNKEN_DWARF_IDS = new Set([
    DRUNKEN_DWARF,
    DRUNKEN_DWARF_2,
    DRUNKEN_DWARF_4,
    DRUNKEN_DWARF_5,
    DRUNKEN_DWARF_KELDAGRIM,
  ]);

  const RED_AXE_DIRECTOR_CUTSCENE = NpcIdentifiers.RED_AXE_DIRECTOR; // 2227
  const CUTSCENE_PATRON = 2425; // forget_cutscene_patron2

  const RIND = NpcIdentifiers.RIND_THE_GARDENER; // 2375
  const ELSTAN = NpcIdentifiers.ELSTAN; // 2663
  const BARMAID = NpcIdentifiers.BARMAID; // 2383, the Laughing Miner
  const ROWDY_DWARF = NpcIdentifiers.ROWDY_DWARF; // 2393
  const ROWDY_DWARF_2 = NpcIdentifiers.ROWDY_DWARF_2; // 2430
  const ROWDY_IDS = new Set([ROWDY_DWARF, ROWDY_DWARF_2]);
  const GAUSS = NpcIdentifiers.GAUSS; // 2402
  const GAUSS_2 = NpcIdentifiers.GAUSS_2; // 2428
  const GAUSS_IDS = new Set([GAUSS, GAUSS_2]);
  const KHORVAK = NpcIdentifiers.KHORVAK_A_DWARVEN_ENGINEER; // 4895
  const CONDUCTOR_IDS = new Set([
    NpcIdentifiers.CART_CONDUCTOR, // 2385
    NpcIdentifiers.CART_CONDUCTOR_2, // 2386
    NpcIdentifiers.CART_CONDUCTOR_3, // 2387
    NpcIdentifiers.CART_CONDUCTOR_4, // 2388
    NpcIdentifiers.CART_CONDUCTOR_5, // 2389
    NpcIdentifiers.CART_CONDUCTOR_6, // 2390
    NpcIdentifiers.CART_CONDUCTOR_7, // 2391
    NpcIdentifiers.CART_CONDUCTOR_8, // 2392
  ]);
  const DIRECTOR_IDS = new Set([
    NpcIdentifiers.PURPLE_PEWTER_DIRECTOR_3, // 5998
    NpcIdentifiers.BLUE_OPAL_DIRECTOR_2, // 5999
    NpcIdentifiers.YELLOW_FORTUNE_DIRECTOR_2, // 6000
    NpcIdentifiers.GREEN_GEMSTONE_DIRECTOR_2, // 6021
    NpcIdentifiers.WHITE_CHISEL_DIRECTOR_2, // 6022
    NpcIdentifiers.SILVER_COG_DIRECTOR_2, // 6023
    NpcIdentifiers.BROWN_ENGINE_DIRECTOR_2, // 6024
  ]);
  const DIRECTOR_NAMES = [
    "Purple Pewter Director",
    "Blue Opal Director",
    "Yellow Fortune Director",
    "Green Gemstone Director",
    "White Chisel Director",
    "Silver Cog Director",
    "Brown Engine Director",
  ];

  const KELDA_SEED = ItemIdentifiers.KELDA_SEED; // 6112
  const KELDA_HOPS = ItemIdentifiers.KELDA_HOPS; // 6113
  const KELDA_STOUT = ItemIdentifiers.KELDA_STOUT; // 6118
  const SQUARE_STONE_YELLOW = ItemIdentifiers.SQUARE_STONE; // 6119, yellow marking
  const SQUARE_STONE_GREEN = ItemIdentifiers.SQUARE_STONE_2; // 6120, green marking
  const LETTER = ItemIdentifiers.LETTER_3; // 6121, for Elstan of Falador
  const BEER = ItemIdentifiers.BEER; // 1917
  const BEER_2 = ItemIdentifiers.BEER_2; // 1918
  const BEER_GLASS = ItemIdentifiers.BEER_GLASS; // 1919
  const QUEST_BEER_GLASS = ItemIdentifiers.BEER_GLASS_3; // 6123
  const DWARVEN_STOUT = ItemIdentifiers.DWARVEN_STOUT; // 1913
  const ALE_YEAST = ItemIdentifiers.ALE_YEAST; // 5767
  const BARLEY_MALT = ItemIdentifiers.BARLEY_MALT; // 6008
  const BUCKET_OF_WATER = ItemIdentifiers.BUCKET_OF_WATER; // 1929
  const BUCKET = ItemIdentifiers.BUCKET; // 1925
  const KEBAB = ItemIdentifiers.KEBAB; // 1971
  const RAKE = ItemIdentifiers.RAKE; // 5341
  const SEED_DIBBER = ItemIdentifiers.SEED_DIBBER; // 5343
  const MARRENTILL_SEED = ItemIdentifiers.MARRENTILL_SEED; // 5292
  const DWARVEN_STOUT_M = ItemIdentifiers.DWARVEN_STOUT_M_; // 5747
  const COMPOST_IDS = new Set([
    ItemIdentifiers.COMPOST,
    ItemIdentifiers.COMPOST_2,
    ItemIdentifiers.SUPERCOMPOST,
    ItemIdentifiers.SUPERCOMPOST_2,
  ]);

  const KELDA_PATCH_MULTILOC = 8877; // farming_hops_patch_keldagrim, varbit-823 multiloc
  const KELDA_PATCH_TRANSFORMS = new Set([
    ObjectIdentifiers.KELDA_HOPS_PATCH, // 8861
    ObjectIdentifiers.KELDA_HOPS_PATCH_2, // 8862
    ObjectIdentifiers.KELDA_HOPS_PATCH_3, // 8863
    ObjectIdentifiers.KELDA_HOPS_PATCH_4, // 8864
    ObjectIdentifiers.KELDA_HOPS, // 8865
    ObjectIdentifiers.KELDA_HOPS_2, // 8866
    ObjectIdentifiers.KELDA_HOPS_3, // 8867
    ObjectIdentifiers.KELDA_HOPS_4, // 8868
    ObjectIdentifiers.KELDA_HOPS_5, // 8869
  ]);

  const DWARVEN_MACHINERY = ObjectIdentifiers.DWARVEN_MACHINERY; // 8878, Control
  const ROOM_BOX = ObjectIdentifiers.BOX; // 8879, Search
  const PUZZLE_ENTRANCE = ObjectIdentifiers.CAVE_ENTRANCE_36; // 8881, Go-through
  const PUZZLE_EXIT = ObjectIdentifiers.CAVE_ENTRANCE_37; // 8882
  const STORY_EXIT_PREV = ObjectIdentifiers.CAVE_ENTRANCE_38; // 8883, Enter
  const STORY_EXIT_NEXT = ObjectIdentifiers.CAVE_ENTRANCE_39; // 8884, Enter
  const TUNNEL_CART = ObjectIdentifiers.TRAIN_CART_5; // 8924, Ride/Return
  const TUNNEL_RETURN_CART = ObjectIdentifiers.TRAIN_CART_6; // 8925, Ride
  const BOOKCASE = ObjectIdentifiers.BOOKCASE_37; // 8910, Search
  const CRATE_ADMIN = ObjectIdentifiers.CRATE_73; // 8914, Search
  const CRATE_LETTER = ObjectIdentifiers.CRATE_74; // 8915, Search
  const CRATE_REPORT = ObjectIdentifiers.CRATE_75; // 8916, Search
  const BOARDED_TUNNEL = 8885; // keldagrim_boardedupdoor_multi, varbit-825 multiloc
  const VAT_BASE = 11670; // brewing vat multiloc base, varbit 736
  const VAT_TRANSFORMS = new Set([
    ObjectIdentifiers.FERMENTING_VAT_4, // 8871
    ObjectIdentifiers.FERMENTING_VAT_5, // 8872
    ObjectIdentifiers.FERMENTING_VAT_6, // 8873
    ObjectIdentifiers.FERMENTING_VAT_7, // 8874
  ]);
  const BARREL_BASE = 24957; // brewing barrel multiloc base, varbit 738
  const KELDA_BARREL = ObjectIdentifiers.KELDA_STOUT; // 8870, Level
  const VAT_VALVE = ObjectIdentifiers.VALVE_2; // 23936, Turn

  // Every object this quest owns, so the global object handler can bail immediately.
  const QUEST_OBJECT_IDS = new Set([
    KELDA_PATCH_MULTILOC,
    ...[...KELDA_PATCH_TRANSFORMS],
    DWARVEN_MACHINERY,
    ROOM_BOX,
    PUZZLE_ENTRANCE,
    PUZZLE_EXIT,
    STORY_EXIT_PREV,
    STORY_EXIT_NEXT,
    TUNNEL_CART,
    TUNNEL_RETURN_CART,
    BOOKCASE,
    CRATE_ADMIN,
    CRATE_LETTER,
    CRATE_REPORT,
    VAT_BASE,
    ...[...VAT_TRANSFORMS],
    BARREL_BASE,
    KELDA_BARREL,
    VAT_VALVE,
  ]);

  // ==========================================================================
  // Varbits, stages, state
  // ==========================================================================

  const VARP_FORGET = 521;
  const VARBIT_STAGE = 822; // forget_quest
  const VARBIT_FARMING = 823; // forget_farming
  const VARBIT_BOARDING = 825; // forget_boarding_removed
  const VARBIT_SEED2_GIVEN = 826; // rowdy dwarf
  const VARBIT_SEED3_GIVEN = 827; // Gauss
  const VARBIT_SEED4_GIVEN = 828; // Khorvak
  const VARBIT_SEED2_TOLD = 829;
  const VARBIT_SEED3_TOLD = 830;
  const VARBIT_SEED4_TOLD = 831;
  const VARBIT_ROOM_BOOKCASE = 833;
  const VARBIT_ROOM_PAPER1 = 834;
  const VARBIT_ROOM_PAPER2 = 835;
  const VARBIT_REGION_STATUS = 837;
  const VARBIT_BEER_GIVEN = 838;
  const VARBIT_VAT = 736; // brewing_vat_varbit_1
  const VARBIT_BARREL = 738; // brewing_barrel_varbit_1

  const STAGE_STARTED = 1;
  const STAGE_DWARF_TOLD = 2;
  const STAGE_BEER_GIVEN = 3;
  const STAGE_SEEDS_GATHERED = 4;
  const STAGE_RIND_ASKED = 5;
  const STAGE_PLANTED = 6;
  const STAGE_HOPS_HARVESTED = 7;
  const STAGE_BREWED = 8;
  const STAGE_STOUT_COLLECTED = 9;
  const STAGE_STORY_HEARD = 10;
  const STAGE_VELDABAN_BRIEFED = 11;
  const STAGE_TUNNEL_OPENED = 12;
  const STAGE_TUNNEL_ENTERED = 13;
  const STAGE_EAVESDROPPED = 14;
  const STAGE_LIBRARY_SEARCHED = 15;
  const STAGE_WITNESSED = 16;
  const STAGE_REPORTED = 17;
  const STAGE_COMPLETE = 18;

  const PUZZLE_ROOM1_STONES = 1;
  const PUZZLE_ROOM1_SET = 2;
  const PUZZLE_LISTENING = 3;
  const PUZZLE_FINAL_SEARCH = 4;
  const PUZZLE_FINAL_STONES = 5;
  const PUZZLE_FINAL_SET = 6;
  const PUZZLE_DONE = 7;

  const VAT_WATER = 1;
  const VAT_MALT = 2;
  const VAT_HOPS = 68;
  const VAT_YEAST = 69;
  const VAT_BREWED = 71;
  const BARREL_STOUT = 3;

  const SEED_BASE = 1;
  const SEED_ROWDY = 2;
  const SEED_GAUSS = 4;
  const SEED_KHORVAK = 8;
  const ALL_SEEDS = SEED_BASE | SEED_ROWDY | SEED_GAUSS | SEED_KHORVAK;

  const LIB_ADMIN = 1;
  const LIB_LETTER = 2;
  const LIB_REPORT = 4;
  const LIB_BOOK = 8;
  const LIB_ALL = LIB_ADMIN | LIB_LETTER | LIB_REPORT | LIB_BOOK;

  const LETTER_OFFERED = 0;
  const LETTER_DELIVERED = 1;
  const LETTER_REFUSED = 2;
  const LETTER_REWARDED = 3;

  const SEEDS_ATTRIBUTE = "quest.forgettable_tale.seeds";
  const FARMING_ATTRIBUTE = "quest.forgettable_tale.farming";
  const PLANT_TIME_ATTRIBUTE = "quest.forgettable_tale.plant-time";
  const VAT_ATTRIBUTE = "quest.forgettable_tale.vat";
  const VAT_WATER_ATTRIBUTE = "quest.forgettable_tale.vat-water";
  const VAT_MALT_ATTRIBUTE = "quest.forgettable_tale.vat-malt";
  const BREW_TIME_ATTRIBUTE = "quest.forgettable_tale.brew-time";
  const BARREL_ATTRIBUTE = "quest.forgettable_tale.barrel";
  const BOARDING_ATTRIBUTE = "quest.forgettable_tale.boarding";
  const BEER_ATTRIBUTE = "quest.forgettable_tale.beer-given";
  const LETTER_ATTRIBUTE = "quest.forgettable_tale.letter";
  const LIBRARY_ATTRIBUTE = "quest.forgettable_tale.library";
  const PUZZLE_ATTRIBUTE = "quest.forgettable_tale.puzzle";
  const REQUEST_ATTRIBUTE = "quest.forgettable_tale.item-request";
  const STOUT_ATTRIBUTE = "quest.forgettable_tale.had-stout";
  const CONDUCTOR_ATTRIBUTE = "quest.forgettable_tale.conductor";

  const HOP_GROWTH_MS = 15 * 60 * 1000; // wiki: 15-20 minutes
  const BREW_TIME_MS = 15 * 60 * 1000; // wiki: 15-20 minutes

  const PATCH_TILES = [];
  for (let x = 2853; x <= 2856; x++) {
    for (let y = 10203; y <= 10206; y++) PATCH_TILES.push([x, y]);
  }
  const VAT_TILE = [2917, 10194, 1];
  const BARREL_TILE = [2917, 10193, 1];
  const BOARDING_TILE = [2926, 10158, 0];
  const DWARF_HOUSE_TILE = new Location(2913, 10224, 0);
  const ROOM1_TILE = new Location(1861, 4955, 1);
  const LISTENING_TILE = new Location(1888, 4982, 2); // floor beside the 8884 hole at 1889,4982
  const LIBRARY_TILE = new Location(1913, 4965, 2); // floor beside the archive 8884 hole at 1914,4965
  const KELDAGRIM_RETURN_TILE = new Location(2922, 10161, 0);
  const EAST_PUB = { x1: 2905, y1: 10185, x2: 2932, y2: 10200 };

  // The rowdy dwarf's random request (wiki's list, trimmed to obtainable items).
  const REQUEST_ITEMS = [
    ItemIdentifiers.ASHES,
    ItemIdentifiers.BANANA,
    ItemIdentifiers.CABBAGE,
    ItemIdentifiers.POTATO,
    ItemIdentifiers.PINK_SKIRT,
    ItemIdentifiers.RED_CAPE,
    ItemIdentifiers.SWAMP_TAR,
    ItemIdentifiers.BEER_GLASS,
    ItemIdentifiers.BAT_BONES,
    ItemIdentifiers.AMULET_MOULD,
    ItemIdentifiers.BROKEN_GLASS,
    ItemIdentifiers.WHITE_APRON,
  ];

  const COMPANY_NAMES = new Map([
    [1, "Purple Pewter"],
    [2, "Yellow Fortune"],
    [3, "Blue Opal"],
    [4, "Green Gemstone"],
    [5, "White Chisel"],
    [6, "Silver Cog"],
    [7, "Brown Engine"],
  ]);
  const COMPANY_ATTRIBUTE = "quest.giant_dwarf.company";

  const QUEST_NPC_IDS = new Set([
    ...[...VELDABAN_IDS],
    ...[...DRUNKEN_DWARF_IDS],
    ...[...ROWDY_IDS],
    ...[...GAUSS_IDS],
    ...[...CONDUCTOR_IDS],
    ...[...DIRECTOR_IDS],
    RIND,
    ELSTAN,
    KHORVAK,
    BARMAID,
    RED_AXE_DIRECTOR_CUTSCENE,
    CUTSCENE_PATRON,
  ]);

  let quest;

  // ==========================================================================
  // State helpers
  // ==========================================================================

  function numberAttribute(player, key) {
    const value = Number(player.getAttribute(key));
    return Number.isFinite(value) ? value | 0 : 0;
  }

  function seeds(player) {
    return numberAttribute(player, SEEDS_ATTRIBUTE);
  }

  function hasSeed(player, bit) {
    return (seeds(player) & bit) !== 0;
  }

  function addSeed(player, bit) {
    if (hasSeed(player, bit)) return false;
    player.setAttribute(SEEDS_ATTRIBUTE, seeds(player) | bit);
    player.getInventory().adds(KELDA_SEED, 1);
    const sender = player.getPacketSender();
    sender.sendVarbit(VARBIT_SEED2_GIVEN, hasSeed(player, SEED_ROWDY) ? 1 : 0);
    sender.sendVarbit(VARBIT_SEED3_GIVEN, hasSeed(player, SEED_GAUSS) ? 1 : 0);
    sender.sendVarbit(VARBIT_SEED4_GIVEN, hasSeed(player, SEED_KHORVAK) ? 1 : 0);
    if (seeds(player) === ALL_SEEDS && quest.getStage(player) < STAGE_SEEDS_GATHERED) {
      quest.setStage(player, STAGE_SEEDS_GATHERED);
    }
    return true;
  }

  function seedCount(player) {
    const expected =
      (hasSeed(player, SEED_BASE) ? 1 : 0) +
      (hasSeed(player, SEED_ROWDY) ? 1 : 0) +
      (hasSeed(player, SEED_GAUSS) ? 1 : 0) +
      (hasSeed(player, SEED_KHORVAK) ? 1 : 0);
    return { expected, held: player.getInventory().getAmount(KELDA_SEED) };
  }

  function lostSeeds(player) {
    const { expected, held } = seedCount(player);
    return expected > 0 && held < expected;
  }

  function farming(player) {
    return numberAttribute(player, FARMING_ATTRIBUTE);
  }

  function setFarming(player, value) {
    player.setAttribute(FARMING_ATTRIBUTE, value | 0);
    player.getPacketSender().sendVarbit(VARBIT_FARMING, value | 0);
  }

  function boardingRemoved(player) {
    return player.getAttribute(BOARDING_ATTRIBUTE) === true;
  }

  function setBoardingRemoved(player) {
    player.setAttribute(BOARDING_ATTRIBUTE, true);
    player.getPacketSender().sendVarbit(VARBIT_BOARDING, 1);
  }

  function beerGiven(player) {
    return player.getAttribute(BEER_ATTRIBUTE) === true;
  }

  function setBeerGiven(player) {
    player.setAttribute(BEER_ATTRIBUTE, true);
    player.getPacketSender().sendVarbit(VARBIT_BEER_GIVEN, 1);
  }

  function letterState(player) {
    return numberAttribute(player, LETTER_ATTRIBUTE);
  }

  function setLetterState(player, value) {
    player.setAttribute(LETTER_ATTRIBUTE, value | 0);
  }

  function library(player) {
    return numberAttribute(player, LIBRARY_ATTRIBUTE);
  }

  function setLibrary(player, value) {
    player.setAttribute(LIBRARY_ATTRIBUTE, value | 0);
    const sender = player.getPacketSender();
    sender.sendVarbit(VARBIT_ROOM_BOOKCASE, (value & LIB_BOOK) !== 0 ? 1 : 0);
    sender.sendVarbit(VARBIT_ROOM_PAPER1, (value & LIB_LETTER) !== 0 ? 1 : 0);
    sender.sendVarbit(VARBIT_ROOM_PAPER2, (value & LIB_REPORT) !== 0 ? 1 : 0);
    if ((value & LIB_ALL) === LIB_ALL && quest.getStage(player) < STAGE_LIBRARY_SEARCHED && !quest.isComplete(player)) {
      quest.setStage(player, STAGE_LIBRARY_SEARCHED);
    }
  }

  function puzzle(player) {
    return numberAttribute(player, PUZZLE_ATTRIBUTE);
  }

  function setPuzzle(player, value) {
    player.setAttribute(PUZZLE_ATTRIBUTE, value | 0);
  }

  function vat(player) {
    return numberAttribute(player, VAT_ATTRIBUTE);
  }

  function setVat(player, value) {
    player.setAttribute(VAT_ATTRIBUTE, value | 0);
    player.getPacketSender().sendVarbit(VARBIT_VAT, value | 0);
    refreshObject(player, VAT_BASE, VAT_TILE[0], VAT_TILE[1], VAT_TILE[2]);
  }

  function barrel(player) {
    return numberAttribute(player, BARREL_ATTRIBUTE);
  }

  function setBarrel(player, value) {
    player.setAttribute(BARREL_ATTRIBUTE, value | 0);
    player.getPacketSender().sendVarbit(VARBIT_BARREL, value | 0);
    refreshObject(player, BARREL_BASE, BARREL_TILE[0], BARREL_TILE[1], BARREL_TILE[2]);
  }

  function conductorSpoken(player) {
    return player.getAttribute(CONDUCTOR_ATTRIBUTE) === true;
  }

  function requestedItemId(player) {
    const value = numberAttribute(player, REQUEST_ATTRIBUTE);
    return value > 0 ? value : null;
  }

  function ensureRequestedItem(player) {
    if (requestedItemId(player) === null) {
      const pick = REQUEST_ITEMS[Math.floor(Math.random() * REQUEST_ITEMS.length)];
      player.setAttribute(REQUEST_ATTRIBUTE, pick | 0);
      player.getPacketSender().sendVarbit(VARBIT_SEED2_TOLD, 1); // forget_seed2_told
    }
    return requestedItemId(player);
  }

  function itemName(itemId) {
    return ItemDefinition.forId(itemId)?.getName?.() ?? "item";
  }

  function companyName(player) {
    return COMPANY_NAMES.get(numberAttribute(player, COMPANY_ATTRIBUTE)) ?? "your company";
  }

  function held(player, itemId, amount = 1) {
    return player.getInventory().getAmount(itemId) >= amount;
  }

  function hasBeer(player) {
    return held(player, BEER) || held(player, BEER_2);
  }

  function hasStout(player) {
    return held(player, KELDA_STOUT);
  }

  function hasBeerGlass(player) {
    return held(player, BEER_GLASS) || held(player, QUEST_BEER_GLASS);
  }

  function questComplete(player, key) {
    const request = { player, key, complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function questActive(player) {
    return quest.getStage(player) >= STAGE_STARTED && !quest.isComplete(player);
  }

  function stageOf(player) {
    return quest.getStage(player);
  }

  function play(player, npcId, variant) {
    return startTranscript(api, player, npcId, PAGE, variant);
  }

  // A wiki "Continues below at ..." stage direction names the line the shared tail
  // resumes at; the tail itself is the matching branch further down the variant.
  function continuationSteps(variant, marker) {
    const steps = loadTranscripts(api)?.[PAGE]?.variants?.[variant];
    const walk = (list) => {
      for (let index = 0; index < (list?.length ?? 0); index++) {
        const step = list[index];
        const text = typeof step.text === "string" ? step.text : typeof step.npc === "string" ? step.npc : "";
        if (text.startsWith(marker)) return list.slice(index);
        const nested = walk(step.steps);
        if (nested) return nested;
        for (const option of step.options ?? []) {
          const branch = walk(option.steps);
          if (branch) return branch;
        }
      }
      return null;
    };
    return walk(steps) ?? [];
  }

  // ==========================================================================
  // Map object refresh (varbit multilocs do not re-render from the varbit alone)
  // ==========================================================================

  function refreshObject(player, objectId, x, y, z) {
    const object = MapObjects.get(objectId, new Location(x, y, z), player.getPrivateArea());
    if (!object) return;
    const sender = player.getPacketSender();
    sender.sendObjectRemoval(object);
    sender.sendObject(object);
  }

  function refreshPatch(player) {
    for (const [x, y] of PATCH_TILES) refreshObject(player, KELDA_PATCH_MULTILOC, x, y, 0);
  }

  // ==========================================================================
  // Growth / brewing timers
  // ==========================================================================

  function settleGrowth(player) {
    const value = farming(player);
    if (value < 4 || value >= 8) return false;
    const at = numberAttribute(player, PLANT_TIME_ATTRIBUTE);
    if (!at || Date.now() - at < HOP_GROWTH_MS) return false;
    setFarming(player, 8);
    refreshPatch(player);
    player.sendMessage("Perhaps I should take a look and see if my Kelda hops have grown...");
    return true;
  }

  function settleBrew(player) {
    if (vat(player) !== VAT_YEAST) return false;
    const at = numberAttribute(player, BREW_TIME_ATTRIBUTE);
    if (!at || Date.now() - at < BREW_TIME_MS) return false;
    setVat(player, VAT_BREWED);
    player.sendMessage("Perhaps I should have a look and see if my Kelda Stout has brewed...");
    return true;
  }

  function handleAdvanceTime(event) {
    const { player, ms } = event;
    if (!player || !Number.isFinite(ms) || ms <= 0) return;
    const shift = (key) => {
      const value = numberAttribute(player, key);
      if (value > 0) player.setAttribute(key, Math.max(1, value - ms));
    };
    shift(PLANT_TIME_ATTRIBUTE);
    shift(BREW_TIME_ATTRIBUTE);
    settleGrowth(player);
    settleBrew(player);
  }

  // ==========================================================================
  // Login / bootstrap sync
  // ==========================================================================

  function syncVarbits(player) {
    const sender = player.getPacketSender();
    sender.sendVarbit(VARBIT_FARMING, farming(player));
    sender.sendVarbit(VARBIT_BOARDING, boardingRemoved(player) ? 1 : 0);
    sender.sendVarbit(VARBIT_SEED2_GIVEN, hasSeed(player, SEED_ROWDY) ? 1 : 0);
    sender.sendVarbit(VARBIT_SEED3_GIVEN, hasSeed(player, SEED_GAUSS) ? 1 : 0);
    sender.sendVarbit(VARBIT_SEED4_GIVEN, hasSeed(player, SEED_KHORVAK) ? 1 : 0);
    sender.sendVarbit(VARBIT_ROOM_BOOKCASE, (library(player) & LIB_BOOK) !== 0 ? 1 : 0);
    sender.sendVarbit(VARBIT_ROOM_PAPER1, (library(player) & LIB_LETTER) !== 0 ? 1 : 0);
    sender.sendVarbit(VARBIT_ROOM_PAPER2, (library(player) & LIB_REPORT) !== 0 ? 1 : 0);
    sender.sendVarbit(VARBIT_REGION_STATUS, stageOf(player) >= STAGE_TUNNEL_ENTERED ? 1 : 0);
    sender.sendVarbit(VARBIT_BEER_GIVEN, beerGiven(player) ? 1 : 0);
    sender.sendVarbit(VARBIT_VAT, vat(player));
    sender.sendVarbit(VARBIT_BARREL, barrel(player));
  }

  function handleLogin({ player }) {
    settleGrowth(player);
    settleBrew(player);
    syncVarbits(player);
  }

  function handleBootstrap({ player }) {
    syncVarbits(player);
  }

  // ==========================================================================
  // Variant selectors
  // ==========================================================================

  function veldabanVariant(player) {
    const stage = stageOf(player);
    if (stage >= STAGE_COMPLETE) return "post-quest-talking-to-veldaban";
    if (stage === 0) {
      return questComplete(player, "fishing_contest")
        ? "starting-out-talking-to-commander-veldaban"
        : "starting-out-without-fishing-contest-completed";
    }
    if (stage >= STAGE_REPORTED) return "finishing-up-talking-to-veldaban-again";
    if (stage >= STAGE_WITNESSED) return "finishing-up-talking-to-veldaban";
    if (stage >= STAGE_VELDABAN_BRIEFED) {
      if (boardingRemoved(player)) {
        return "exploring-the-closed-tunnel-before-entering-the-tunnel-talking-to-veldaban-after-talking-to-the-company-director";
      }
      if (conductorSpoken(player)) {
        return "exploring-the-closed-tunnel-before-entering-the-tunnel-talking-to-veldaban-after-speaking-to-the-cart-conductor";
      }
      return "brewing-talking-to-veldaban-after-hearing-the-drunken-dwarf-s-story";
    }
    if (stage >= STAGE_STORY_HEARD) return "brewing-talking-to-veldaban-after-hearing-the-drunken-dwarf-s-story";
    return "starting-out-talking-to-commander-veldaban-again";
  }

  /** Giant Dwarf owns Veldaban for its mandatory meeting at stage 40 until completion. */
  function giantOwnsMeeting(player) {
    const stage = Number(player.getAttribute(GIANT_DWARF_STAGE_ATTRIBUTE)) || 0;
    return stage >= GIANT_MEETING_STAGE && stage < GIANT_COMPLETE_STAGE;
  }

  function drunkDwarfVariant(player) {
    const stage = stageOf(player);
    if (stage >= STAGE_STOUT_COLLECTED && stage < STAGE_STORY_HEARD) {
      return "brewing-talking-to-the-drunken-dwarf-after-collecting-the-kelda-stout";
    }
    if (stage >= STAGE_PLANTED && stage < STAGE_STOUT_COLLECTED) {
      return "brewing-talking-to-the-drunken-dwarf-after-harvesting-the-kelda-hops";
    }
    if (stage === STAGE_SEEDS_GATHERED) {
      return "starting-out-talking-to-the-drunken-dwarf-again-after-giving-him-a-beer";
    }
    if (stage >= STAGE_RIND_ASKED) {
      return "brewing-talking-to-the-drunken-dwarf-after-harvesting-the-kelda-hops";
    }
    if (stage >= STAGE_BEER_GIVEN) {
      return "starting-out-talking-to-the-drunken-dwarf-again-after-giving-him-a-beer";
    }
    if (stage >= STAGE_DWARF_TOLD) return "starting-out-talking-to-the-drunken-dwarf-again";
    return "starting-out-talking-to-the-drunken-dwarf";
  }

  function rindVariant(player) {
    const stage = stageOf(player);
    if (stage < STAGE_SEEDS_GATHERED || quest.isComplete(player)) return null;
    if (stage === STAGE_SEEDS_GATHERED) {
      quest.setStage(player, STAGE_RIND_ASKED);
      return "brewing-talking-to-rind";
    }
    if (stage >= STAGE_BREWED) {
      return "brewing-speaking-to-rind-after-the-kelda-stout-has-finished-brewing";
    }
    if (stage >= STAGE_HOPS_HARVESTED) {
      return held(player, KELDA_HOPS)
        ? "brewing-speaking-to-rind-after-harvesting-the-kelda-hops"
        : "brewing-speaking-to-rind-after-losing-the-kelda-hops";
    }
    if (farming(player) >= 4) {
      if (vat(player) >= VAT_HOPS) return "brewing-speaking-to-rind-while-the-kelda-stout-is-brewing";
      if (held(player, LETTER) || letterState(player) === LETTER_OFFERED) {
        return "brewing-talking-to-rind-after-offering-to-deliver-his-letter";
      }
      if (letterState(player) === LETTER_DELIVERED) {
        return "brewing-talking-to-rind-after-delivering-his-letter";
      }
      if (letterState(player) === LETTER_REFUSED || letterState(player) === LETTER_REWARDED) {
        return "brewing-talking-to-rind-after-finishing-or-refusing-his-letter-delivery";
      }
      return "brewing-talking-to-rind-again";
    }
    return "brewing-talking-to-rind-again";
  }

  function rowdyVariant(player) {
    const stage = stageOf(player);
    if (stage < STAGE_BEER_GIVEN || stage >= STAGE_RIND_ASKED) return null;
    if (hasSeed(player, SEED_ROWDY)) return null;
    return requestedItemId(player) !== null
      ? "getting-the-seeds-talking-to-the-rowdy-dwarf-again"
      : "getting-the-seeds-talking-to-the-rowdy-dwarf";
  }

  function gaussVariant(player) {
    const stage = stageOf(player);
    if (stage < STAGE_BEER_GIVEN || stage >= STAGE_RIND_ASKED) return null;
    if (hasSeed(player, SEED_GAUSS)) return null;
    player.getPacketSender().sendVarbit(VARBIT_SEED3_TOLD, 1); // forget_seed3_told
    return "getting-the-seeds-talking-to-gauss";
  }

  function khorvakVariant(player) {
    const stage = stageOf(player);
    if (stage < STAGE_BEER_GIVEN || stage >= STAGE_RIND_ASKED) return null;
    if (hasSeed(player, SEED_KHORVAK)) return null;
    player.getPacketSender().sendVarbit(VARBIT_SEED4_TOLD, 1); // forget_seed4_told
    return "getting-the-seeds-talking-to-khorvak";
  }

  function barmaidVariant(player) {
    if (stageOf(player) !== STAGE_STOUT_COLLECTED || quest.isComplete(player)) return null;
    return "brewing-talking-to-the-laughing-miner-barmaid-after-brewing-kelda-stout";
  }

  function conductorVariant(player) {
    const stage = stageOf(player);
    if (stage < STAGE_VELDABAN_BRIEFED || stage >= STAGE_TUNNEL_ENTERED || quest.isComplete(player)) {
      return null;
    }
    return boardingRemoved(player)
      ? { page: PAGE, variant: "exploring-the-closed-tunnel-before-entering-the-tunnel-talking-to-the-cart-conductor-again" }
      : { page: PAGE, variant: "exploring-the-closed-tunnel-before-entering-the-tunnel-talking-to-the-cart-conductor" };
  }

  function selectVariant(event) {
    const { npcId, player } = event;
    if (VELDABAN_IDS.has(npcId)) {
      if (!questActive(player) && giantOwnsMeeting(player)) return null;
      return veldabanVariant(player);
    }
    if (npcId === RIND) return rindVariant(player);
    if (npcId === ELSTAN) return held(player, LETTER) ? "brewing-talking-to-elstan" : null;
    if (ROWDY_IDS.has(npcId)) return rowdyVariant(player);
    if (GAUSS_IDS.has(npcId)) return gaussVariant(player);
    if (npcId === KHORVAK) return khorvakVariant(player);
    if (npcId === BARMAID) return barmaidVariant(player);
    if (npcId === DRUNKEN_DWARF_2 || npcId === DRUNKEN_DWARF_KELDAGRIM) return drunkDwarfVariant(player);
    if (CONDUCTOR_IDS.has(npcId)) return conductorVariant(player);
    return null;
  }

  // ==========================================================================
  // Prose-condition answers
  // ==========================================================================

  function answerCondition(event) {
    const { player, stepId } = event;
    if (!QUEST_NPC_IDS.has(event.npcId)) return null;
    switch (stepId) {
      case "hJML4Q":
        return hasBeer(player);
      case "w19V3O":
        return !hasBeer(player);
      case "MQ6lYP":
        return !lostSeeds(player) && seedCount(player).held < 4;
      case "hXLJvV":
        return lostSeeds(player);
      case "dAdMmP":
        return !lostSeeds(player) && seedCount(player).held >= 4;
      case "qDq4Oo": {
        const itemId = ensureRequestedItem(player);
        return itemId !== null && held(player, itemId);
      }
      case "R0247e": {
        const itemId = ensureRequestedItem(player);
        return itemId === null || !held(player, itemId);
      }
      case "ZcKAPm":
        return held(player, DWARVEN_STOUT);
      case "DBXhTl":
        return !held(player, DWARVEN_STOUT);
      case "N6-Lzw":
        return hasBeer(player) || hasBeerGlass(player);
      case "xnlH60":
        return !hasBeer(player) && !hasBeerGlass(player);
      case "qG7LM-":
        return letterState(player) === LETTER_OFFERED && !held(player, LETTER);
      case "bCP3fB":
        return hasStout(player);
      case "591Xrj":
        return player.getAttribute(STOUT_ATTRIBUTE) === true && !hasStout(player);
      case "Qou1Ch":
        return !hasStout(player);
      case "pmJ0UH":
        return hasStout(player);
      default:
        return null;
    }
  }

  // ==========================================================================
  // Dialogue line / choice / action handlers
  // ==========================================================================

  function handleLine(event) {
    const { player, npcId } = event;
    if (!QUEST_NPC_IDS.has(npcId)) return;
    const raw = String(event.text ?? "");

    if (raw.includes("[item]")) {
      event.text = raw.replace(/\[item\]/g, itemName(ensureRequestedItem(player)));
    } else if (raw.includes("[company name]")) {
      event.text = raw.replace(/\[company name\]/g, companyName(player));
    }

    if (npcId === RIND && raw.startsWith("That's a little clumsy")) {
      if (!held(player, LETTER) && letterState(player) === LETTER_OFFERED) {
        player.getInventory().adds(LETTER, 1);
      }
      return;
    }
    if (VELDABAN_IDS.has(npcId)) {
      if (raw.startsWith("Happy to hear that") && stageOf(player) === STAGE_STORY_HEARD) {
        quest.setStage(player, STAGE_VELDABAN_BRIEFED);
        return;
      }
      if (raw.startsWith("Poor ") && raw.includes("bewitched") && stageOf(player) === STAGE_WITNESSED) {
        quest.setStage(player, STAGE_REPORTED);
        return;
      }
    }
    if (CONDUCTOR_IDS.has(npcId) && raw.includes("influential friends")) {
      if (boardingRemoved(player) && stageOf(player) < STAGE_TUNNEL_ENTERED) tunnelEnter(player);
    }
  }

  function handleChoice(event) {
    const { player, npcId, option } = event;
    if (option === "I need to know about the Red Axe..." && DRUNKEN_DWARF_IDS.has(npcId)) {
      if (stageOf(player) === STAGE_STARTED) quest.setStage(player, STAGE_DWARF_TOLD);
      return;
    }
    if (option === "Ask about closed off tunnel." && CONDUCTOR_IDS.has(npcId)) {
      player.setAttribute(CONDUCTOR_ATTRIBUTE, true);
      return;
    }
    if (option === "Can you help me with a boarded up tunnel?" && DIRECTOR_IDS.has(npcId)) {
      if (stageOf(player) >= STAGE_VELDABAN_BRIEFED && stageOf(player) < STAGE_TUNNEL_OPENED) {
        setBoardingRemoved(player);
        quest.setStage(player, STAGE_TUNNEL_OPENED);
        refreshObject(player, BOARDED_TUNNEL, BOARDING_TILE[0], BOARDING_TILE[1], BOARDING_TILE[2]);
      }
      return;
    }
    if (npcId === RIND && option === "Alright, I'll deliver that letter for you.") {
      setLetterState(player, LETTER_OFFERED);
    }
  }

  function handleAction(event) {
    const { player, stepId } = event;
    switch (stepId) {
      case "oYdSOU": // "Continues below": resume at the shared start-prompt tail.
        event.handled = true;
        event.steps = continuationSteps(
          "starting-out-talking-to-commander-veldaban",
          "But he seems to know something about the Red Axe"
        );
        return;
      case "KmAed5":
        event.handled = true;
        if (stageOf(player) === 0) quest.setStage(player, STAGE_STARTED);
        player.moveTo(DWARF_HOUSE_TILE);
        return;
      case "7E9t4X":
        event.handled = true;
        if (held(player, BEER)) player.getInventory().deleteNumber(BEER, 1);
        else if (held(player, BEER_2)) player.getInventory().deleteNumber(BEER_2, 1);
        setBeerGiven(player);
        if (stageOf(player) < STAGE_BEER_GIVEN) quest.setStage(player, STAGE_BEER_GIVEN);
        return;
      case "l3edsC":
        event.handled = true;
        addSeed(player, SEED_BASE);
        if (stageOf(player) < STAGE_BEER_GIVEN) quest.setStage(player, STAGE_BEER_GIVEN);
        return;
      case "5-Cvcz":
        event.handled = true;
        player.getInventory().adds(KELDA_SEED, 1);
        return;
      case "CNN_hK": {
        event.handled = true;
        const itemId = ensureRequestedItem(player);
        if (itemId !== null && held(player, itemId)) player.getInventory().deleteNumber(itemId, 1);
        return;
      }
      case "LG4J0x":
        event.handled = true;
        addSeed(player, SEED_ROWDY);
        return;
      case "1Ss_fy":
        event.handled = true;
        if (held(player, DWARVEN_STOUT)) player.getInventory().deleteNumber(DWARVEN_STOUT, 1);
        return;
      case "81z3Dh":
      case "D41l86":
        event.handled = true;
        addSeed(player, SEED_KHORVAK);
        return;
      case "EtDfVN":
        event.handled = true;
        addSeed(player, SEED_GAUSS);
        return;
      case "Xk9onS":
        event.handled = true;
        if (!held(player, LETTER)) player.getInventory().adds(LETTER, 1);
        setLetterState(player, LETTER_OFFERED);
        return;
      case "9EYwOK":
        event.handled = true;
        if (held(player, LETTER)) player.getInventory().deleteNumber(LETTER, 1);
        setLetterState(player, LETTER_REFUSED);
        return;
      case "rn9wc4":
        event.handled = true;
        if (held(player, LETTER)) player.getInventory().deleteNumber(LETTER, 1);
        setLetterState(player, LETTER_DELIVERED);
        return;
      case "QDUHsY":
        event.handled = true;
        player.getInventory().adds(MARRENTILL_SEED, 2);
        setLetterState(player, LETTER_REWARDED);
        return;
      case "oKT26B":
        event.handled = true;
        player.getInventory().adds(KELDA_HOPS, 1);
        if (stageOf(player) < STAGE_HOPS_HARVESTED) quest.setStage(player, STAGE_HOPS_HARVESTED);
        return;
      case "Z9bb9f":
        event.handled = true;
        player.getInventory().adds(KELDA_STOUT, 1);
        player.setAttribute(STOUT_ATTRIBUTE, true);
        if (stageOf(player) < STAGE_STOUT_COLLECTED) quest.setStage(player, STAGE_STOUT_COLLECTED);
        return;
      case "2auRCe":
        event.handled = true;
        if (held(player, KELDA_STOUT)) player.getInventory().deleteNumber(KELDA_STOUT, 1);
        quest.setStage(player, STAGE_STORY_HEARD);
        return;
      case "YiJ1SP":
        event.handled = true;
        quest.setStage(player, STAGE_WITNESSED);
        player.moveTo(KELDAGRIM_RETURN_TILE);
        return;
      case "Y-itLl":
        event.handled = true;
        if (!quest.isComplete(player)) quest.complete(player);
        return;
      default:
        return;
    }
  }

  // ==========================================================================
  // Drunken dwarf, cart conductor and company director (own conversations)
  // ==========================================================================

  function talkDrunkenDwarf(event) {
    const { player, npcId } = event;
    // Interactions carry the resolved content id (2408); 3198 is only the spawn id.
    if (npcId !== DRUNKEN_DWARF_KELDAGRIM && npcId !== DRUNKEN_DWARF_2) return;
    // 3198's cache name is "null", so it has no indexed page: this handler owns it.
    event.handled = true;
    if (stageOf(player) === 0) {
      startTranscript(api, player, npcId, "Drunken Dwarf (Keldagrim)", "standard-dialogue-initial-dialogue");
      return;
    }
    play(player, npcId, drunkDwarfVariant(player));
  }

  function talkCartConductor(event) {
    const { player, npcId } = event;
    if (!CONDUCTOR_IDS.has(npcId)) return false;
    const stage = stageOf(player);
    if (stage < STAGE_VELDABAN_BRIEFED || stage >= STAGE_TUNNEL_ENTERED || quest.isComplete(player)) {
      return false; // the normal cart-conductor dialogue
    }
    event.handled = true;
    const choice = conductorVariant(player);
    if (choice) startTranscript(api, player, npcId, choice.page, choice.variant);
  }

  function talkDirector(event) {
    const { player, npcId } = event;
    if (!DIRECTOR_IDS.has(npcId)) return false;
    const stage = stageOf(player);
    if (stage < STAGE_STORY_HEARD || stage >= STAGE_TUNNEL_OPENED || quest.isComplete(player)) {
      return false; // the normal director dialogue
    }
    event.handled = true;
    play(player, npcId, "exploring-the-closed-tunnel-before-entering-the-tunnel-talking-to-the-company-director");
  }

  function talkBarmaid(event) {
    const { player, npcId } = event;
    if (npcId !== BARMAID || stageOf(player) !== STAGE_STOUT_COLLECTED) return;
    event.handled = true;
    play(player, npcId, "brewing-talking-to-the-laughing-miner-barmaid-after-brewing-kelda-stout");
  }

  function talkKhorvak(event) {
    const { player, npcId } = event;
    if (npcId !== KHORVAK) return;
    if (khorvakVariant(player) === null) return;
    event.handled = true;
    play(player, npcId, "getting-the-seeds-talking-to-khorvak");
  }

  // ==========================================================================
  // Tunnel entry, puzzles and the archive
  // ==========================================================================

  function tunnelEnter(player) {
    quest.setStage(player, STAGE_TUNNEL_ENTERED);
    setPuzzle(player, 0);
    player.moveTo(ROOM1_TILE);
    player.getPacketSender().sendVarbit(VARBIT_REGION_STATUS, 1);
    play(player, RED_AXE_DIRECTOR_CUTSCENE, "exploring-the-closed-tunnel-room-1-entering-the-tunnel");
  }

  function takeStones(player, green, yellow) {
    if (!held(player, SQUARE_STONE_GREEN, green) || !held(player, SQUARE_STONE_YELLOW, yellow)) {
      return false;
    }
    if (green > 0) player.getInventory().deleteNumber(SQUARE_STONE_GREEN, green);
    if (yellow > 0) player.getInventory().deleteNumber(SQUARE_STONE_YELLOW, yellow);
    return true;
  }

  function machineryInteraction(event) {
    const { player } = event;
    event.handled = true;
    if (stageOf(player) < STAGE_TUNNEL_ENTERED || quest.isComplete(player)) return;
    const phase = puzzle(player);
    if (phase === PUZZLE_ROOM1_STONES) {
      if (!takeStones(player, 1, 1)) {
        play(player, RED_AXE_DIRECTOR_CUTSCENE, "exploring-the-closed-tunnel-room-1-attempting-to-control-the-dwarven-machinery-without-any-square-stones");
        return;
      }
      setPuzzle(player, PUZZLE_ROOM1_SET);
      player.sendMessage("You set the stones in the dwarven machinery; the cart tracks line up across the chasm.");
      return;
    }
    if (phase === PUZZLE_FINAL_STONES) {
      if (!takeStones(player, 2, 2)) {
        play(player, RED_AXE_DIRECTOR_CUTSCENE, "exploring-the-closed-tunnel-room-1-attempting-to-control-the-dwarven-machinery-without-any-square-stones");
        return;
      }
      setPuzzle(player, PUZZLE_FINAL_SET);
      player.sendMessage("You set the stones in the dwarven machinery; the cart tracks line up across the chasm.");
      return;
    }
    play(player, RED_AXE_DIRECTOR_CUTSCENE, "exploring-the-closed-tunnel-room-1-attempting-to-control-the-dwarven-machinery-without-any-square-stones");
  }

  function roomBoxInteraction(event) {
    const { player } = event;
    event.handled = true;
    if (stageOf(player) < STAGE_TUNNEL_ENTERED || quest.isComplete(player)) return;
    const phase = puzzle(player);
    if (phase === 0) {
      player.getInventory().adds(SQUARE_STONE_GREEN, 1);
      player.getInventory().adds(SQUARE_STONE_YELLOW, 1);
      setPuzzle(player, PUZZLE_ROOM1_STONES);
      play(player, RED_AXE_DIRECTOR_CUTSCENE, "exploring-the-closed-tunnel-room-1-searching-the-first-box");
      return;
    }
    if (phase === PUZZLE_FINAL_SEARCH) {
      player.getInventory().adds(SQUARE_STONE_GREEN, 2);
      player.getInventory().adds(SQUARE_STONE_YELLOW, 2);
      setPuzzle(player, PUZZLE_FINAL_STONES);
      play(player, RED_AXE_DIRECTOR_CUTSCENE, "exploring-the-closed-tunnel-room-5-searching-the-first-box");
      return;
    }
    play(player, RED_AXE_DIRECTOR_CUTSCENE, "exploring-the-closed-tunnel-room-1-searching-a-box-again");
  }

  function cartInteraction(event, option) {
    const { player } = event;
    event.handled = true;
    if (stageOf(player) < STAGE_TUNNEL_ENTERED || quest.isComplete(player)) return;
    const equipment = player.getEquipment();
    if (!equipment.isSlotFree(Equipment.WEAPON_SLOT) || !equipment.isSlotFree(Equipment.SHIELD_SLOT)) {
      player.sendMessage("You need both hands free to ride the cart.");
      return;
    }
    if (option === "Return") {
      player.moveTo(ROOM1_TILE);
      play(player, RED_AXE_DIRECTOR_CUTSCENE, "exploring-the-closed-tunnel-room-1-returning-to-keldagrim-on-the-cart");
      return;
    }
    const phase = puzzle(player);
    if (phase === PUZZLE_ROOM1_SET) {
      setPuzzle(player, PUZZLE_LISTENING);
      quest.setStage(player, STAGE_EAVESDROPPED);
      player.moveTo(LISTENING_TILE);
      play(player, RED_AXE_DIRECTOR_CUTSCENE, "exploring-the-closed-tunnel-room-2-listening-in-on-the-red-axe");
      return;
    }
    if (phase === PUZZLE_FINAL_SET) {
      setPuzzle(player, PUZZLE_DONE);
      play(player, RED_AXE_DIRECTOR_CUTSCENE, "exploring-the-closed-tunnel-room-6");
      return;
    }
    play(player, RED_AXE_DIRECTOR_CUTSCENE, "exploring-the-closed-tunnel-room-1-riding-the-cart-before-the-junction-is-switched");
  }

  function bookcaseInteraction(event) {
    const { player } = event;
    event.handled = true;
    if (stageOf(player) < STAGE_TUNNEL_ENTERED || quest.isComplete(player)) return;
    const state = library(player);
    if ((state & LIB_BOOK) === 0) {
      setLibrary(player, state | LIB_BOOK);
      play(player, RED_AXE_DIRECTOR_CUTSCENE, "exploring-the-closed-tunnel-room-4-searching-the-bookcase");
      return;
    }
    play(player, RED_AXE_DIRECTOR_CUTSCENE, "exploring-the-closed-tunnel-room-4-searching-the-bookcase-again");
  }

  function crateInteraction(event, objectId) {
    const { player } = event;
    event.handled = true;
    if (stageOf(player) < STAGE_TUNNEL_ENTERED || quest.isComplete(player)) return;
    const state = library(player);
    if (objectId === CRATE_ADMIN) {
      if ((state & LIB_ADMIN) === 0) {
        setLibrary(player, state | LIB_ADMIN);
        play(player, RED_AXE_DIRECTOR_CUTSCENE, "exploring-the-closed-tunnel-room-4-searching-the-crate-with-administrative-info");
      } else {
        play(player, RED_AXE_DIRECTOR_CUTSCENE, "exploring-the-closed-tunnel-room-1-searching-a-box-again");
      }
      return;
    }
    if (objectId === CRATE_LETTER) {
      if ((state & LIB_LETTER) === 0) {
        setLibrary(player, state | LIB_LETTER);
        play(player, RED_AXE_DIRECTOR_CUTSCENE, "exploring-the-closed-tunnel-room-4-searching-the-crate-with-the-boatman-s-letter");
      } else {
        play(player, RED_AXE_DIRECTOR_CUTSCENE, "exploring-the-closed-tunnel-room-1-searching-a-box-again");
      }
      return;
    }
    if ((state & LIB_REPORT) === 0) {
      setLibrary(player, state | LIB_REPORT);
      play(player, RED_AXE_DIRECTOR_CUTSCENE, "exploring-the-closed-tunnel-room-4-searching-the-third-crate");
    } else {
      play(player, RED_AXE_DIRECTOR_CUTSCENE, "exploring-the-closed-tunnel-room-1-searching-a-box-again");
    }
  }

  function caveEntranceInteraction(event, objectId) {
    const { player } = event;
    const location = event.location ?? {};
    if (stageOf(player) < STAGE_TUNNEL_ENTERED || quest.isComplete(player)) return;
    event.handled = true;
    if (objectId === PUZZLE_ENTRANCE) {
      player.moveTo(ROOM1_TILE);
      return;
    }
    if (objectId === PUZZLE_EXIT) return;
    if (objectId === STORY_EXIT_PREV) {
      player.moveTo(ROOM1_TILE);
      return;
    }
    // STORY_EXIT_NEXT. The archive exit (x >= 1900) leads deeper; the other one is the
    // listening room's hole into the archive.
    if ((location.x ?? 0) >= 1900) {
      if ((library(player) & LIB_ALL) !== LIB_ALL) {
        play(player, RED_AXE_DIRECTOR_CUTSCENE, "exploring-the-closed-tunnel-room-4-attempting-to-enter-the-next-room-without-inspecting-everything");
        return;
      }
      if (puzzle(player) < PUZZLE_FINAL_SEARCH) {
        setPuzzle(player, PUZZLE_FINAL_SEARCH);
        player.moveTo(ROOM1_TILE);
        player.sendMessage("You take the cart deeper into the mines, to the final chasm.");
      }
      return;
    }
    player.moveTo(LIBRARY_TILE);
    player.sendMessage("You crawl through the hole into another room.");
  }

  // ==========================================================================
  // Farming patch
  // ==========================================================================

  function patchInteraction(event, option) {
    const { player } = event;
    if (stageOf(player) < STAGE_RIND_ASKED || quest.isComplete(player)) return;
    event.handled = true;
    settleGrowth(player);
    const value = farming(player);
    if (option === "Rake") {
      if (!held(player, RAKE)) {
        player.sendMessage("You need a rake to do that.");
        return;
      }
      if (value < 3) {
        setFarming(player, value + 1);
        refreshPatch(player);
        player.sendMessage("You rake the weeds from the patch.");
      } else {
        player.sendMessage("The patch is already clear.");
      }
      return;
    }
    if (option === "Harvest") {
      if (value === 8) {
        setFarming(player, 3);
        player.getInventory().adds(KELDA_HOPS, 1);
        refreshPatch(player);
        if (stageOf(player) < STAGE_HOPS_HARVESTED) quest.setStage(player, STAGE_HOPS_HARVESTED);
        player.sendMessage("You pick the kelda hops.");
      } else {
        player.sendMessage("The kelda hops aren't ready to harvest yet.");
      }
      return;
    }
    // Inspect.
    if (value === 8) {
      play(player, RIND, "brewing-inspecting-the-fully-grown-kelda-hops");
    } else if (value >= 4) {
      player.sendMessage("The kelda hops are still growing.");
    } else {
      player.sendMessage("The patch is empty.");
    }
  }

  function plantSeeds(player) {
    if (stageOf(player) < STAGE_RIND_ASKED) {
      play(player, RIND, "brewing-attempting-to-plant-kelda-seeds-before-asking-for-permission");
      return;
    }
    if (farming(player) !== 3) {
      player.sendMessage("The hops patch needs raking first.");
      return;
    }
    if (!held(player, KELDA_SEED, 4)) {
      player.sendMessage("You need four kelda seeds to plant the patch.");
      return;
    }
    if (!held(player, SEED_DIBBER)) {
      player.sendMessage("You need a seed dibber to do that.");
      return;
    }
    player.getInventory().deleteNumber(KELDA_SEED, 4);
    setFarming(player, 4);
    player.setAttribute(PLANT_TIME_ATTRIBUTE, Date.now());
    quest.setStage(player, STAGE_PLANTED);
    refreshPatch(player);
    player.sendMessage("You plant the kelda seeds in the patch.");
  }

  // ==========================================================================
  // Brewing
  // ==========================================================================

  function vatItem(event, itemId) {
    const { player } = event;
    event.handled = true;
    if (stageOf(player) < STAGE_RIND_ASKED || quest.isComplete(player)) return;
    settleBrew(player);
    if (itemId === BUCKET_OF_WATER) {
      const water = numberAttribute(player, VAT_WATER_ATTRIBUTE);
      if (vat(player) >= VAT_MALT || water >= 2) {
        player.sendMessage("The vat already has enough water in it.");
        return;
      }
      player.getInventory().deleteNumber(BUCKET_OF_WATER, 1);
      player.getInventory().adds(BUCKET, 1);
      player.setAttribute(VAT_WATER_ATTRIBUTE, water + 1);
      if (water + 1 >= 2) setVat(player, VAT_WATER);
      player.sendMessage("You add some water to the vat.");
      return;
    }
    if (itemId === BARLEY_MALT) {
      const water = numberAttribute(player, VAT_WATER_ATTRIBUTE);
      const malt = numberAttribute(player, VAT_MALT_ATTRIBUTE);
      if (water < 2) {
        player.sendMessage("You need to add water to the vat first.");
        return;
      }
      if (malt >= 2 || vat(player) >= VAT_HOPS) {
        player.sendMessage("The vat already has enough barley malt in it.");
        return;
      }
      player.getInventory().deleteNumber(BARLEY_MALT, 1);
      player.setAttribute(VAT_MALT_ATTRIBUTE, malt + 1);
      if (malt + 1 >= 2) setVat(player, VAT_MALT);
      player.sendMessage("You add some barley malt to the vat.");
      return;
    }
    if (itemId === KELDA_HOPS) {
      if (vat(player) < VAT_MALT) {
        play(player, CUTSCENE_PATRON, "brewing-attempting-to-add-kelda-hops-to-the-vat-prematurely");
        return;
      }
      if (vat(player) >= VAT_HOPS) return;
      player.getInventory().deleteNumber(KELDA_HOPS, 1);
      setVat(player, VAT_HOPS);
      play(player, CUTSCENE_PATRON, "brewing-adding-kelda-hops-to-the-vat");
      return;
    }
    if (itemId === ALE_YEAST) {
      if (vat(player) !== VAT_HOPS) {
        player.sendMessage("You need to add kelda hops to the vat first.");
        return;
      }
      if (held(player, ALE_YEAST)) player.getInventory().deleteNumber(ALE_YEAST, 1);
      player.getInventory().adds(ItemIdentifiers.POT, 1);
      setVat(player, VAT_YEAST);
      player.setAttribute(BREW_TIME_ATTRIBUTE, Date.now());
      player.sendMessage("The vat begins to ferment.");
      return;
    }
  }

  function valveInteraction(event) {
    const { player } = event;
    event.handled = true;
    if (stageOf(player) < STAGE_RIND_ASKED || quest.isComplete(player)) return;
    settleBrew(player);
    if (vat(player) !== VAT_BREWED) {
      player.sendMessage("There's nothing ready in the vat to drain.");
      return;
    }
    setBarrel(player, BARREL_STOUT);
    play(player, CUTSCENE_PATRON, "brewing-turning-the-vat-valve-after-the-kelda-stout-is-finished");
    if (stageOf(player) < STAGE_BREWED) quest.setStage(player, STAGE_BREWED);
  }

  function barrelItem(event, itemId) {
    const { player } = event;
    if (itemId !== BEER_GLASS && itemId !== QUEST_BEER_GLASS) return;
    event.handled = true;
    if (barrel(player) !== BARREL_STOUT) {
      player.sendMessage("The barrel is empty.");
      return;
    }
    if (stageOf(player) < STAGE_BREWED) return;
    player.getInventory().deleteNumber(itemId, 1);
    player.getInventory().adds(KELDA_STOUT, 1);
    player.setAttribute(STOUT_ATTRIBUTE, true);
    setBarrel(player, 0);
    quest.setStage(player, STAGE_STOUT_COLLECTED);
    play(player, CUTSCENE_PATRON, "brewing-collecting-the-kelda-stout");
  }

  // ==========================================================================
  // Object / item interactions
  // ==========================================================================

  function resolvedObject(event) {
    const base = event.objectId;
    return ObjectDefinition.forPlayer(base, event.player) ?? event.definition ?? null;
  }

  function optionOf(event, object) {
    const actions = object?.getActions?.() ?? event.definition?.getActions?.() ?? null;
    return actions?.[event.clickType - 1] ?? null;
  }

  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    if (!QUEST_OBJECT_IDS.has(objectId)) return;
    const object = resolvedObject(event);
    const resolvedId = object?.getId?.() ?? objectId;
    if (resolvedId === KELDA_PATCH_MULTILOC || KELDA_PATCH_TRANSFORMS.has(resolvedId)) {
      return patchInteraction(event, optionOf(event, object));
    }
    if (objectId === DWARVEN_MACHINERY) return machineryInteraction(event);
    if (objectId === ROOM_BOX) return roomBoxInteraction(event);
    if (objectId === TUNNEL_CART || objectId === TUNNEL_RETURN_CART) {
      return cartInteraction(event, optionOf(event, object));
    }
    if (objectId === BOOKCASE) return bookcaseInteraction(event);
    if (objectId === CRATE_ADMIN || objectId === CRATE_LETTER || objectId === CRATE_REPORT) {
      return crateInteraction(event, objectId);
    }
    if (
      objectId === PUZZLE_ENTRANCE ||
      objectId === PUZZLE_EXIT ||
      objectId === STORY_EXIT_PREV ||
      objectId === STORY_EXIT_NEXT
    ) {
      return caveEntranceInteraction(event, objectId);
    }
    if (objectId === VAT_VALVE) return valveInteraction(event);
    if (resolvedId === KELDA_BARREL || objectId === BARREL_BASE) {
      if (optionOf(event, object) === "Level" && barrel(player) === BARREL_STOUT) {
        event.handled = true;
        play(player, CUTSCENE_PATRON, "brewing-leveling-the-kelda-stout");
      }
      return;
    }
  }

  function handleItemOnObject(event) {
    const { player, itemId } = event;
    if (!QUEST_OBJECT_IDS.has(event.objectId)) return;
    const object = resolvedObject(event);
    const resolvedId = object?.getId?.() ?? event.objectId;
    if (KELDA_PATCH_TRANSFORMS.has(resolvedId) || event.objectId === KELDA_PATCH_MULTILOC) {
      event.handled = true;
      if (itemId === KELDA_SEED) return plantSeeds(player);
      if (COMPOST_IDS.has(itemId)) {
        player.sendMessage("The soil in this patch is very rich - it's doesn't need compost.");
      }
      return;
    }
    if (VAT_TRANSFORMS.has(resolvedId) || event.objectId === VAT_BASE) return vatItem(event, itemId);
    if (resolvedId === KELDA_BARREL || event.objectId === BARREL_BASE) return barrelItem(event, itemId);
  }

  function handleItemAction(event) {
    const { player, itemId, option } = event;
    if (itemId === KELDA_STOUT && option === "Drink") {
      event.handled = true;
      play(player, DRUNKEN_DWARF_KELDAGRIM, "brewing-attempting-to-drink-the-kelda-stout");
    }
  }

  // Food and Potions swallow first-click Eat/Drink in onItemFirstAction (and close any open
  // interface), so the final pub cutscene is claimed at the can-use gate that runs before
  // them; the bite/drink is consumed here to keep it a real one.
  function interceptPubMeal(event) {
    const { player, itemId, option } = event;
    if (event.action !== "action" || (option !== "Eat" && option !== "Drink")) return;
    if (itemId !== KEBAB && itemId !== BEER && itemId !== BEER_2) return;
    if (stageOf(player) !== STAGE_REPORTED) return;
    const location = player.getLocation();
    if (
      location.getX() < EAST_PUB.x1 || location.getX() > EAST_PUB.x2 ||
      location.getY() < EAST_PUB.y1 || location.getY() > EAST_PUB.y2
    ) {
      return;
    }
    event.allow = false;
    player.getInventory().deleteNumber(itemId, 1);
    if (itemId === BEER || itemId === BEER_2) player.getInventory().adds(BEER_GLASS, 1);
    play(player, DRUNKEN_DWARF_4, "finishing-up-final-cutscene");
  }

  // ==========================================================================
  // Journal
  // ==========================================================================

  function seedLine(player, bit, label) {
    return hasSeed(player, bit)
      ? `<str>I have the ${label} Kelda seed.</str>`
      : `I don't have the ${label} Kelda seed yet.`;
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Commander Veldaban asked me to find out what the Red Axe</str>",
        "<str>is up to after they left Keldagrim.</str>",
        "<str>I brewed Kelda stout, followed the drunken dwarf's tale into a</str>",
        "<str>hidden tunnel and saw the Red Axe's chaos dwarf army.</str>",
        "<str>Grunsh wiped my memory, but Veldaban promised to keep looking.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_REPORTED) {
      return [
        "<str>I saw the Red Axe's chaos dwarf army, but Grunsh wiped my memory.</str>",
        "I have a strange craving for a beer and a kebab. I should have",
        "a beer and a kebab in the <col=800000>Laughing Miner</col> in east Keldagrim.",
      ];
    }
    if (stage >= STAGE_WITNESSED) {
      return [
        "Hi hi hi ha ha ha ha.",
        "Lalalalalalalalala.",
        "Rock hot nice butterfly bad wolf sing song down the river.",
        "I saw... I saw... I saw kebabs? Wearing silly hats! Yes!",
        "<col=800000>AHAHAHAHA, I've gone totally mad! AHAHAHAHA!</col>",
      ];
    }
    if (stage >= STAGE_TUNNEL_ENTERED) {
      const lines = [
        "<str>Commander Veldaban asked me to find out what the Red Axe is up to.</str>",
        "<str>I brewed Kelda stout and heard the drunken dwarf's tale of a</str>",
        "<str>boarded up mine tunnel; the company director had it opened.</str>",
        "",
      ];
      if (stage === STAGE_EAVESDROPPED || stage === STAGE_LIBRARY_SEARCHED) {
        lines.push("I overheard the Red Axe plotting in the closed tunnel.");
        lines.push("I should explore the rest of the mines.");
      } else {
        lines.push("I should search the box, set the dwarven machinery and");
        lines.push("ride the cart across the chasm.");
      }
      return lines;
    }
    if (stage >= STAGE_TUNNEL_OPENED) {
      return [
        "<str>Commander Veldaban asked me to find out what the Red Axe is up to.</str>",
        "<str>I brewed Kelda stout and heard the drunken dwarf's tale of a</str>",
        "<str>boarded up tunnel south of the cart station.</str>",
        "",
        "The director had the boarding removed. I should talk to the",
        "<col=800000>cart conductor</col> and ride into the tunnel.",
      ];
    }
    if (stage >= STAGE_STORY_HEARD) {
      return [
        "<str>Commander Veldaban asked me to find out what the Red Axe is up to.</str>",
        "<str>I brewed Kelda stout for the drunken dwarf and heard his tale</str>",
        "<str>about a boarded up mine tunnel south of the cart station.</str>",
        "",
        "I should tell <col=800000>Commander Veldaban</col> what I heard.",
      ];
    }
    if (stage >= STAGE_STOUT_COLLECTED) {
      return [
        "<str>I gathered four Kelda seeds and grew them into hops.</str>",
        "<str>I brewed the hops into Kelda stout at the Keldagrim brewery.</str>",
        "",
        "I should take the <col=800000>Kelda stout</col> to the <col=800000>drunken dwarf</col>",
        "in east Keldagrim.",
      ];
    }
    if (stage >= STAGE_HOPS_HARVESTED) {
      return [
        "<str>I gathered four Kelda seeds and grew them into hops.</str>",
        "",
        "I should brew the <col=800000>Kelda hops</col> into stout at the brewery",
        "upstairs in the <col=800000>Laughing Miner</col>.",
      ];
    }
    if (stage >= STAGE_PLANTED) {
      const lines = [
        "<str>I gathered four Kelda seeds and Rind let me use the palace patch.</str>",
        "",
      ];
      if (farming(player) >= 8) lines.push("My <col=800000>Kelda hops</col> are fully grown - I should harvest them.");
      else lines.push("My kelda seeds are growing in the palace garden patch.");
      return lines;
    }
    if (stage >= STAGE_SEEDS_GATHERED) {
      return [
        "The drunken dwarf wants 'the REALLY good stuff' - Kelda stout.",
        "I have all four <col=800000>Kelda seeds</col>. I should ask",
        "<col=800000>Rind the gardener</col> in west Keldagrim how to grow them.",
      ];
    }
    const seedLines = [
      seedLine(player, SEED_BASE, "first"),
      seedLine(player, SEED_ROWDY, "rowdy dwarf's"),
      seedLine(player, SEED_GAUSS, "Gauss's"),
      seedLine(player, SEED_KHORVAK, "Khorvak's"),
    ];
    if (stage >= STAGE_BEER_GIVEN) {
      return [
        "<str>Commander Veldaban asked me to spy on the Red Axe.</str>",
        "<str>I gave the drunken dwarf a beer; he wants Kelda stout.</str>",
        "",
        "I need <col=800000>four Kelda seeds</col> from his drinking buddies,",
        "then I must grow them into hops.",
        ...seedLines,
      ];
    }
    if (stage >= STAGE_DWARF_TOLD) {
      return [
        "<str>Commander Veldaban asked me to spy on the Red Axe.</str>",
        "",
        "The <col=800000>drunken dwarf</col> in east Keldagrim will talk for a",
        "beer. I should buy one at the Laughing Miner or the King's Axe Inn.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "<str>Commander Veldaban asked me to spy on the Red Axe.</str>",
        "",
        "I should talk to the <col=800000>drunken dwarf</col> in his house in",
        "east Keldagrim.",
      ];
    }
    return [
      "I can start this quest by talking to <col=800000>Commander Veldaban</col>",
      "in the Black Guard headquarters in <col=800000>Keldagrim</col>.",
    ];
  }

  // ==========================================================================
  // Rewards
  // ==========================================================================

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.COOKING, 5000);
    player.getSkillManager().addExperiences(Skill.FARMING, 5000);
    player.getInventory().adds(DWARVEN_STOUT_M, 1); // registerQuest adds the first
  }

  // ==========================================================================
  // Registration
  // ==========================================================================

  api.persistAttribute(SEEDS_ATTRIBUTE);
  api.persistAttribute(FARMING_ATTRIBUTE);
  api.persistAttribute(PLANT_TIME_ATTRIBUTE);
  api.persistAttribute(VAT_ATTRIBUTE);
  api.persistAttribute(VAT_WATER_ATTRIBUTE);
  api.persistAttribute(VAT_MALT_ATTRIBUTE);
  api.persistAttribute(BREW_TIME_ATTRIBUTE);
  api.persistAttribute(BARREL_ATTRIBUTE);
  api.persistAttribute(BOARDING_ATTRIBUTE);
  api.persistAttribute(BEER_ATTRIBUTE);
  api.persistAttribute(LETTER_ATTRIBUTE);
  api.persistAttribute(LIBRARY_ATTRIBUTE);
  api.persistAttribute(PUZZLE_ATTRIBUTE);
  api.persistAttribute(REQUEST_ATTRIBUTE);
  api.persistAttribute(STOUT_ATTRIBUTE);
  api.persistAttribute(CONDUCTOR_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "forgettable_tale",
    name: "Forgettable Tale...",
    varpId: VARP_FORGET,
    varbitId: VARBIT_STAGE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.COOKING.getIndex(), amount: 5000, label: "Cooking" },
      { skillId: Skill.FARMING.getIndex(), amount: 5000, label: "Farming" },
    ],
    rewardItemId: DWARVEN_STOUT_M,
    rewardItemLabel: "2 x Dwarven stout(m)",
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("agent:advance-time", handleAdvanceTime);
  api.onNpcInteraction(talkDrunkenDwarf);
  api.onNpcInteraction("Cart conductor", { "Talk-to": talkCartConductor });
  api.onNpcInteraction("Barmaid", { "Talk-to": talkBarmaid });
  api.onNpcInteraction("Khorvak, a dwarven engineer", { "Talk-to": talkKhorvak });
  for (const name of DIRECTOR_NAMES) {
    api.onNpcInteraction(name, { "Talk-to": talkDirector });
  }
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemAction(handleItemAction);
  api.onCanUseItem(interceptPubMeal);
  api.onPlayerLogin(handleLogin);
  api.onCustomEvent("player:bootstrap-complete", handleBootstrap);
};
