/**
 * Between a Rock... (members).
 *
 * The words come from the "Between a Rock..." transcript page; this plugin supplies
 * the variant selector for Dondakan, the Dwarven Engineer, Rolad, Khorvak and the
 * Librarian, the prose-condition answers for the page-finding, schematic and
 * Arzinian-mine branches, the page drops (scorpions, mine cart, ore rocks), the
 * golden cannonball, the gold helmet and assembled schematic, the shot into
 * Dondakan's mine and the Arzinian Avatar fight.
 *
 * Stage varbit: 299 "dwarfrock_quest" (varp 433 "dwarfrock_main", bits 0-7).
 * Evidence: cache varbit dump (scripts/lookup-gameval.ts) names 299
 * dwarfrock_quest on varp 433; the spawned Dondakan (npc 6262) is a varbit-299
 * transform into 4890/4891, whose dialogue index points at this page; the
 * values are RuneLite Quest Helper's stage steps (10,20,...,100). Sibling bits
 * of varp 433 are mirrored where the cache reads them:
 *   300 dwarfrock_lookingforinfo, 301 dwarfrock_gold_cannonball,
 *   305 dwarfrock_schematics_solved, 308 dwarfrock_inside_visited,
 *   313 dwarfrock_fired_gold_cannonball.
 *
 * Stages (varbit 299):
 *   10 started (Dondakan told me to research the rock)
 *   20 the Dwarven Engineer sent me to Rolad
 *   30 Rolad lost his book's pages; find them in the Dwarven Mine
 *   40 I have the Dwarven lore book and should read it
 *   50 read; return to Dondakan with a gold bar
 *   60 Dondakan wants a golden cannonball (gold bar shown)
 *   70 the cannonball went through; he wants schematics + golden helmet
 *   80 gathering/assembling the four schematics; then get fired in
 *   90 inside the rock; mine gold, kill the Arzinian Avatar
 *   100 complete
 *
 * Rewards per the OSRS Wiki: 2 Quest points, 5,000 Defence, Mining and
 * Smithing XP, a rune pickaxe and a gold helmet.
 *
 * Sources: OSRS Wiki "Between a Rock..." and its Transcript page; RuneLite
 * Quest Helper and the gameval dump for ids (objects, items, varbits).
 *
 * Gaps / approximations:
 *  - The three book pages stay separate items; the combined "Pages" items
 *    (4572/4573) are never created. The page-3 rock drop and page-1 scorpion
 *    drop are guaranteed on the first success (the wiki says they may take
 *    several attempts); when the inventory is full the page is dropped on the
 *    ground as the transcript says.
 *  - The schematic-assembly puzzle interface is not simulated: "Assemble" on a
 *    schematic part consumes all four parts and grants the assembled schematic.
 *  - The gold helmet and golden cannonball are made with direct messages
 *    ("Assemble"/use gold bar on anvil/furnace); the cache's smithing/smelting
 *    interfaces have no Between a Rock recipes, so this is the documented
 *    fallback.
 *  - The cutscene has no scenes: choosing "Yes." on "Skip cutscene?" fires the
 *    player immediately; the "between-a-rock-golden-helmet-timer" and
 *    "between-a-rock-randomly-while-mining-gold" page variants are replayed as
 *    messages (an 8-minute area timer in Dondakan's mine) and the mining
 *    taunts are skipped. The Avatar's health regeneration without enough gold
 *    ore is not simulated (it only changes the spawned level).
 *  - The post-quest granite-boot haggling uses an input step the runtime cannot
 *    run, so only the wear/not-wear branches answer.
 */
module.exports = function registerBetweenARockQuest(api) {
  const {
    Area,
    Boundary,
    Equipment,
    Item,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    ObjectIdentifiers,
    Skill,
  } = api.core;
  const { registerQuest, startTranscript } = require("../QuestRuntime");

  const PAGE = "Between a Rock...";
  const START_HOOK = "quest:between-a-rock:start";

  // ==========================================================================
  // Ids
  // ==========================================================================

  const DONDAKAN = NpcIdentifiers.DONDAKAN_THE_DWARF; // 4890
  const DONDAKAN_2 = NpcIdentifiers.DONDAKAN_THE_DWARF_2; // 4891
  const DONDAKAN_3 = NpcIdentifiers.DONDAKAN_THE_DWARF_3; // 4892
  const DONDAKAN_NPC_IDS = new Set([DONDAKAN, DONDAKAN_2, DONDAKAN_3]);
  const DWARVEN_ENGINEER = NpcIdentifiers.DWARVEN_ENGINEER; // 4893
  const ROLAD = NpcIdentifiers.ROLAD; // 4894
  const KHORVAK = NpcIdentifiers.KHORVAK_A_DWARVEN_ENGINEER; // 4895
  const LIBRARIAN = NpcIdentifiers.LIBRARIAN; // 2370
  const ARZINIAN_BEING = NpcIdentifiers.ARZINIAN_BEING_OF_BORDANZAN; // 1236
  const DWARVEN_MINE_SCORPION = NpcIdentifiers.SCORPION_3; // 3024, the level-14 Dwarven Mine scorpions
  const ARZINIAN_AVATAR_OF_STRENGTH = NpcIdentifiers.ARZINIAN_AVATAR_OF_STRENGTH; // 1227
  const ARZINIAN_AVATAR_OF_STRENGTH_2 = NpcIdentifiers.ARZINIAN_AVATAR_OF_STRENGTH_2; // 1228, level 125
  const ARZINIAN_AVATAR_OF_STRENGTH_3 = NpcIdentifiers.ARZINIAN_AVATAR_OF_STRENGTH_3; // 1229, level 75
  const ARZINIAN_AVATAR_OF_RANGING = NpcIdentifiers.ARZINIAN_AVATAR_OF_RANGING; // 1230
  const ARZINIAN_AVATAR_OF_RANGING_2 = NpcIdentifiers.ARZINIAN_AVATAR_OF_RANGING_2; // 1231, level 125
  const ARZINIAN_AVATAR_OF_RANGING_3 = NpcIdentifiers.ARZINIAN_AVATAR_OF_RANGING_3; // 1232, level 75
  const ARZINIAN_AVATAR_OF_MAGIC = NpcIdentifiers.ARZINIAN_AVATAR_OF_MAGIC; // 1233
  const ARZINIAN_AVATAR_OF_MAGIC_2 = NpcIdentifiers.ARZINIAN_AVATAR_OF_MAGIC_2; // 1234, level 125
  const ARZINIAN_AVATAR_OF_MAGIC_3 = NpcIdentifiers.ARZINIAN_AVATAR_OF_MAGIC_3; // 1235, level 75
  const ARZINIAN_AVATAR_NPC_IDS = new Set([
    ARZINIAN_AVATAR_OF_STRENGTH,
    ARZINIAN_AVATAR_OF_STRENGTH_2,
    ARZINIAN_AVATAR_OF_STRENGTH_3,
    ARZINIAN_AVATAR_OF_RANGING,
    ARZINIAN_AVATAR_OF_RANGING_2,
    ARZINIAN_AVATAR_OF_RANGING_3,
    ARZINIAN_AVATAR_OF_MAGIC,
    ARZINIAN_AVATAR_OF_MAGIC_2,
    ARZINIAN_AVATAR_OF_MAGIC_3,
  ]);

  const DWARVEN_LORE_ITEM = ItemIdentifiers.DWARVEN_LORE; // 4568
  const BOOK_PAGE_1_ITEM = ItemIdentifiers.BOOK_PAGE_1; // 4569
  const BOOK_PAGE_2_ITEM = ItemIdentifiers.BOOK_PAGE_2; // 4570
  const BOOK_PAGE_3_ITEM = ItemIdentifiers.BOOK_PAGE_3; // 4571
  const BASE_SCHEMATICS_ITEM = ItemIdentifiers.BASE_SCHEMATICS; // 4574
  const SCHEMATIC_DONDAKAN_ITEM = ItemIdentifiers.SCHEMATIC; // 4575
  const SCHEMATICS_ENGINEER_ITEM = ItemIdentifiers.SCHEMATICS; // 4576
  const SCHEMATICS_KHORVAK_ITEM = ItemIdentifiers.SCHEMATICS_2; // 4577
  const SCHEMATIC_ASSEMBLED_ITEM = ItemIdentifiers.SCHEMATIC_2; // 4578
  const GOLD_HELMET_ITEM = ItemIdentifiers.GOLD_HELMET; // 4567
  const GOLDEN_CANNONBALL_ITEM = ItemIdentifiers.CANNON_BALL; // 4579
  const GOLD_BAR_ITEM = ItemIdentifiers.GOLD_BAR; // 2357
  const GOLD_ORE_ITEM = ItemIdentifiers.GOLD_ORE; // 444
  const PERFECT_GOLD_BAR_ITEM = ItemIdentifiers.PERFECT_GOLD_BAR; // 2365
  const AMMO_MOULD_ITEM = ItemIdentifiers.AMMO_MOULD; // 4
  const DOUBLE_AMMO_MOULD_ITEM = ItemIdentifiers.DOUBLE_AMMO_MOULD; // 27012
  const HAMMER_ITEM = ItemIdentifiers.HAMMER; // 2347
  const DWARVEN_STOUT_ITEM = ItemIdentifiers.DWARVEN_STOUT; // 1913
  const RUNE_PICKAXE_ITEM = ItemIdentifiers.RUNE_PICKAXE; // 1275
  const GRANITE_BOOTS_ITEM = ItemIdentifiers.GRANITE_BOOTS; // 21643
  const PAGE_ITEM_IDS = [BOOK_PAGE_1_ITEM, BOOK_PAGE_2_ITEM, BOOK_PAGE_3_ITEM];
  const SCHEMATIC_PART_IDS = new Set([
    BASE_SCHEMATICS_ITEM,
    SCHEMATIC_DONDAKAN_ITEM,
    SCHEMATICS_ENGINEER_ITEM,
    SCHEMATICS_KHORVAK_ITEM,
  ]);

  const BOOK_MINE_CART = ObjectIdentifiers.MINE_CART_7; // 6045, the Dwarven Mine book cart
  const TALKABLE_FLAME_IDS = new Set([
    ObjectIdentifiers.WALL_OF_FLAME_5, // 5979
    ObjectIdentifiers.WALL_OF_FLAME_6, // 5980
  ]);
  const DWARVEN_MINE_ROCK_IDS = new Set([
    ObjectIdentifiers.TIN_ROCKS_2, // 11360
    ObjectIdentifiers.TIN_ROCKS_3, // 11361
    ObjectIdentifiers.CLAY_ROCKS, // 11362
    ObjectIdentifiers.CLAY_ROCKS_2, // 11363
    ObjectIdentifiers.IRON_ROCKS, // 11364
    ObjectIdentifiers.IRON_ROCKS_2, // 11365
    ObjectIdentifiers.COPPER_ROCKS_2, // 10943
    ObjectIdentifiers.COPPER_ROCKS_3, // 11161
  ]);

  // ==========================================================================
  // Varbits / stages / attributes
  // ==========================================================================

  const VARP_DWARFROCK = 433; // "dwarfrock_main"
  const VARBIT_STAGE = 299; // dwarfrock_quest, bits 0-7
  const VARBIT_LOOKINGFORINFO = 300;
  const VARBIT_GOLD_CANNONBALL = 301; // the gold bar has been shown to Dondakan
  const VARBIT_SCHEMATICS_SOLVED = 305;
  const VARBIT_INSIDE_VISITED = 308;
  const VARBIT_FIRED_GOLD_CANNONBALL = 313;

  const STAGE_STARTED = 10;
  const STAGE_ENGINEER = 20;
  const STAGE_PAGES = 30;
  const STAGE_BOOK = 40;
  const STAGE_DONDAKAN_BOOK = 50;
  const STAGE_GOLD = 60;
  const STAGE_SCHEMATICS = 70;
  const STAGE_ASSEMBLE = 80;
  const STAGE_MINE = 90;
  const STAGE_COMPLETE = 100;

  const GOLD_SHOWN_ATTRIBUTE = "quest.between_a_rock.gold-shown";
  const SOLVED_ATTRIBUTE = "quest.between_a_rock.schematics-solved";
  const INSIDE_ATTRIBUTE = "quest.between_a_rock.inside";
  const FIRED_ATTRIBUTE = "quest.between_a_rock.fired-cannonball";
  const AVATAR_KILLED_ATTRIBUTE = "quest.between_a_rock.avatar-killed";
  const MINE_TICKS_ATTRIBUTE = "quest.between_a_rock.mine-ticks";

  // Tiles (RuneLite Quest Helper / the OSRS map).
  const MINE_LANDING = new Location(2364, 4944, 0);
  const DONDAKAN_TILE = new Location(2824, 10168, 0);
  const AVATAR_TILE = new Location(2375, 4952, 0);

  // The Dwarven Mine (scorpions, book cart, tin/clay/copper/iron rocks).
  const DWARVEN_MINE_BOUNDS = new Boundary(2960, 3070, 9690, 9860, 0);
  // Dondakan's mine behind the rock.
  const ARZINIAN_MINE_BOUNDS = new Boundary(2300, 2460, 4920, 5010, 0);

  // The wiki golden-helmet warning messages, by tick spent inside the rock.
  const HELMET_TIMER_MESSAGES = [
    [100, "The helmet seems to become even heavier"],
    [250, "You feel a headache coming on... oh wait, it's just your helmet."],
    [400, "You feel like you're being pushed into the ground by the weight of the golden helmet."],
    [500, "You stumble and nearly fall. You can only keep this  helmet on for a few more minutes!"],
    [600, "You fight the urge to take off your helmet. It's getting harder and harder to resist!"],
    [700, "You don't think you can keep on this helmet  for more than a minute. Whatever you want to accomplish here, do it fast!"],
    [750, "Must... not... take... off... helmet!"],
    [775, "The weight of the helmet is becoming unbearable. You can't keep it on for more than a few seconds now!"],
  ];

  /** The Arzinian Avatar spawned for one player. */
  const activeAvatars = new WeakMap();
  /** Players whose next mining success may yield Rolad's third page. */
  const pendingRockPage = new WeakSet();

  let quest;

  // ==========================================================================
  // Small state helpers
  // ==========================================================================

  function stageOf(player) {
    return quest.getStage(player);
  }

  function hasItem(player, itemId, amount = 1) {
    return player.getInventory().getAmount(itemId) >= amount;
  }

  function hasSpace(player) {
    return !player.getInventory().isFull();
  }

  function wearingHelmet(player) {
    return player.getEquipment().get(Equipment.HEAD_SLOT)?.getId?.() === GOLD_HELMET_ITEM;
  }

  function wearingGraniteBoots(player) {
    const boots = player.getEquipment().get(Equipment.FEET_SLOT);
    return boots?.getId?.() === GRANITE_BOOTS_ITEM;
  }

  function goldOre(player) {
    return player.getInventory().getAmount(GOLD_ORE_ITEM);
  }

  function inBounds(player, boundary) {
    const location = player.getLocation?.();
    if (!location) return false;
    const x = location.getX();
    const y = location.getY();
    return x >= boundary.getX() && x <= boundary.getX2() && y >= boundary.getY() && y <= boundary.getY2();
  }

  function inDwarvenMine(player) {
    return inBounds(player, DWARVEN_MINE_BOUNDS);
  }

  function inArzinianMine(player) {
    return inBounds(player, ARZINIAN_MINE_BOUNDS);
  }

  function pageCount(player) {
    let count = 0;
    for (const itemId of PAGE_ITEM_IDS) if (hasItem(player, itemId)) count++;
    return count;
  }

  function hasAllSchematicParts(player) {
    for (const itemId of SCHEMATIC_PART_IDS) if (!hasItem(player, itemId)) return false;
    return true;
  }

  function hasAnySchematicPart(player) {
    for (const itemId of SCHEMATIC_PART_IDS) if (hasItem(player, itemId)) return true;
    return false;
  }

  function avatarKilled(player) {
    return player.getAttribute(AVATAR_KILLED_ATTRIBUTE) === true;
  }

  function highestCombatStat(player) {
    const skills = player.getSkillManager();
    const melee = Math.max(skills.getMaxLevel(Skill.ATTACK), skills.getMaxLevel(Skill.STRENGTH));
    const ranged = skills.getMaxLevel(Skill.RANGED);
    const magic = skills.getMaxLevel(Skill.MAGIC);
    if (melee >= ranged && melee >= magic) return "melee";
    return ranged >= magic ? "ranged" : "magic";
  }

  function addItem(player, itemId, amount = 1) {
    player.getInventory().adds(itemId, amount);
  }

  function syncVarbits(player) {
    const sender = player.getPacketSender();
    sender.sendVarbit(VARBIT_LOOKINGFORINFO, stageOf(player) >= STAGE_STARTED ? 1 : 0);
    sender.sendVarbit(VARBIT_GOLD_CANNONBALL, player.getAttribute(GOLD_SHOWN_ATTRIBUTE) === true ? 1 : 0);
    sender.sendVarbit(VARBIT_SCHEMATICS_SOLVED, player.getAttribute(SOLVED_ATTRIBUTE) === true ? 1 : 0);
    sender.sendVarbit(VARBIT_INSIDE_VISITED, player.getAttribute(INSIDE_ATTRIBUTE) === true ? 1 : 0);
    sender.sendVarbit(VARBIT_FIRED_GOLD_CANNONBALL, player.getAttribute(FIRED_ATTRIBUTE) === true ? 1 : 0);
  }

  function handleLogin({ player }) {
    // Logging out inside the rock exits the mine; drop the timer and the spawn.
    if (!inArzinianMine(player)) {
      player.setAttribute(INSIDE_ATTRIBUTE, false);
      player.setAttribute(MINE_TICKS_ATTRIBUTE, 0);
      removeAvatar(player);
    }
    syncVarbits(player);
  }

  function handleBootstrap({ player }) {
    syncVarbits(player);
  }

  // ==========================================================================
  // Variant selection
  // ==========================================================================

  function selectVariant(event) {
    const { npcId, player } = event;
    if (DONDAKAN_NPC_IDS.has(npcId)) return selectDondakanVariant(player);
    if (npcId === DWARVEN_ENGINEER) return selectEngineerVariant(player);
    if (npcId === ROLAD) return selectRoladVariant(player);
    if (npcId === KHORVAK) return selectKhorvakVariant(player);
    if (npcId === LIBRARIAN) return selectLibrarianVariant(player);
    if (npcId === ARZINIAN_BEING) {
      if (stageOf(player) === STAGE_MINE && !avatarKilled(player)) {
        return "between-a-rock-facing-the-arzinian-being";
      }
      return "between-a-rock-randomly-while-mining-gold";
    }
    return null;
  }

  function selectDondakanVariant(player) {
    const stage = stageOf(player);
    if (stage >= STAGE_COMPLETE) return "post-quest-dondakan";
    if (stage >= STAGE_MINE) {
      return avatarKilled(player)
        ? "between-a-rock-finishing-up"
        : "between-a-rock-talking-to-dondakan-after-being-shot-into-the-mine";
    }
    if (stage >= STAGE_ASSEMBLE) return "between-a-rock-returning-to-dondakan";
    if (stage >= STAGE_SCHEMATICS) {
      if (stage === STAGE_SCHEMATICS) quest.setStage(player, STAGE_ASSEMBLE);
      return "finding-the-schematics-talking-to-dondakan";
    }
    if (stage >= STAGE_BOOK) return "going-for-the-gold-returning-to-dondakan";
    if (stage >= STAGE_ENGINEER) {
      return "an-unbreakable-rock-or-stone-talking-to-dondakan-after-learning-about-the-book";
    }
    if (stage >= STAGE_STARTED) {
      return "an-unbreakable-rock-or-stone-talking-to-dondakan-after-accepting-the-quest";
    }
    return "an-unbreakable-rock-or-stone";
  }

  function selectEngineerVariant(player) {
    const stage = stageOf(player);
    if (stage === STAGE_STARTED) {
      quest.setStage(player, STAGE_ENGINEER);
      return "an-unbreakable-rock-or-stone-engineer-i-need-your-attention";
    }
    if (stage >= STAGE_ASSEMBLE) {
      if (hasItem(player, SCHEMATICS_ENGINEER_ITEM)) {
        return "finding-the-schematics-talking-to-the-dwarven-engineer-again-with-the-schematic";
      }
      return "finding-the-schematics-talking-to-the-dwarven-engineer";
    }
    return "an-unbreakable-rock-or-stone-engineer-i-need-your-attention";
  }

  function selectRoladVariant(player) {
    const stage = stageOf(player);
    if (stage === STAGE_ENGINEER) return "an-unbreakable-rock-or-stone-rolad-the-scholar";
    if (stage === STAGE_PAGES) return "an-unbreakable-rock-or-stone-talking-to-rolad-again";
    if (stage >= STAGE_ASSEMBLE) {
      if (
        hasItem(player, BASE_SCHEMATICS_ITEM) ||
        hasItem(player, SCHEMATIC_ASSEMBLED_ITEM) ||
        player.getAttribute(SOLVED_ATTRIBUTE) === true
      ) {
        return "finding-the-schematics-talking-to-rolad-after-finding-the-schematic";
      }
      if (!hasItem(player, DWARVEN_LORE_ITEM)) {
        addItem(player, DWARVEN_LORE_ITEM);
        return "finding-the-schematics-talking-to-rolad-while-having-lost-the-dwarven-lore-book";
      }
      return "finding-the-schematics-back-to-rolad";
    }
    if (stage >= STAGE_DONDAKAN_BOOK) return "an-unbreakable-rock-or-stone-talking-to-rolad-after-reading-the-book";
    if (stage >= STAGE_BOOK) return "an-unbreakable-rock-or-stone-talking-to-rolad-before-reading-the-book";
    return null;
  }

  function selectKhorvakVariant(player) {
    if (stageOf(player) < STAGE_ASSEMBLE) return null;
    if (hasItem(player, SCHEMATICS_KHORVAK_ITEM)) {
      return "finding-the-schematics-talking-to-khorvak-after-receiving-his-schematic";
    }
    return "finding-the-schematics-talking-to-khorvak";
  }

  function selectLibrarianVariant(player) {
    if (quest.isComplete(player)) return "post-quest-hugi-the-librarian";
    if (stageOf(player) >= STAGE_STARTED) return "an-unbreakable-rock-or-stone-knowledge-of-rocks";
    return null;
  }

  // ==========================================================================
  // Condition answers
  // ==========================================================================

  function answerCondition(event) {
    const { player, stepId } = event;
    switch (stepId) {
      // Rolad's page-progress fork.
      case "n9bwRN":
        return pageCount(player) === 0;
      case "ztNzxN":
        return pageCount(player) === 1;
      case "nzuQkP":
        return pageCount(player) === 2;
      case "D2RqyY":
        return pageCount(player) === 3;
      // Inventory-space guards around every schematic hand-out.
      case "3ovfDb":
      case "_mObD5":
      case "8c_fZH":
      case "u2PO7A":
      case "C10iR_":
      case "C3DIma":
        return hasSpace(player);
      case "2rdt3A":
      case "e4h6Rv":
      case "MKvCDX":
      case "YLsq6M":
      case "5IFw4y":
      case "rK1Ytx":
      case "ZDcvjN":
        return !hasSpace(player);
      // Dondakan has lost his own schematic.
      case "vOmfs9":
        return (
          stageOf(player) >= STAGE_SCHEMATICS &&
          !hasItem(player, SCHEMATIC_DONDAKAN_ITEM) &&
          !hasItem(player, SCHEMATIC_ASSEMBLED_ITEM)
        );
      // Ready-to-fire fork.
      case "5mrgn0":
        return !hasItem(player, SCHEMATIC_ASSEMBLED_ITEM) && hasAllSchematicParts(player) && !hasItem(player, GOLD_HELMET_ITEM);
      case "ehPlcC":
        return !hasItem(player, SCHEMATIC_ASSEMBLED_ITEM) && hasAllSchematicParts(player) && hasItem(player, GOLD_HELMET_ITEM);
      case "dM_N-J":
        return false;
      case "sCsZPB":
        return (
          hasItem(player, SCHEMATIC_ASSEMBLED_ITEM) &&
          !hasItem(player, GOLD_HELMET_ITEM) &&
          !wearingHelmet(player)
        );
      case "MGz01q":
        return (
          !hasItem(player, SCHEMATIC_ASSEMBLED_ITEM) &&
          hasItem(player, GOLD_HELMET_ITEM) &&
          !hasItem(player, SCHEMATIC_DONDAKAN_ITEM) &&
          hasAnySchematicPart(player)
        );
      case "0qcHXZ":
        return !hasItem(player, SCHEMATIC_ASSEMBLED_ITEM) && !hasAllSchematicParts(player);
      case "Obzvy6":
        return (
          hasItem(player, SCHEMATIC_ASSEMBLED_ITEM) &&
          hasItem(player, GOLD_HELMET_ITEM) &&
          !wearingHelmet(player)
        );
      case "95tum0":
        return (
          hasItem(player, SCHEMATIC_ASSEMBLED_ITEM) &&
          (wearingHelmet(player) || hasItem(player, GOLD_HELMET_ITEM))
        );
      // The cutscene instances do not exist here.
      case "iv_G2w":
        return false;
      case "o5PcZh":
        return true;
      // Golden-helmet checks when re-entering the rock.
      case "nwpUgk":
      case "bSJoCg":
        return !wearingHelmet(player);
      case "V-xtPu":
      case "9VFdbw":
        return wearingHelmet(player);
      // The Arzinian Avatar's form and strength.
      case "P-TIlE":
        return highestCombatStat(player) === "melee";
      case "0wS2ES":
        return highestCombatStat(player) === "ranged";
      case "zIj6KN":
        return highestCombatStat(player) === "magic";
      case "ls9q3a":
        return goldOre(player) < 5;
      case "qss2L2":
        return goldOre(player) >= 5 && goldOre(player) < 15;
      case "FUvWcx":
        return goldOre(player) >= 15;
      // The full-inventory rune pickaxe message in the epilogue.
      case "naq7ua":
        return !hasSpace(player);
      // Post-quest granite-boot haggling (the offer amount is an input step).
      case "D2J2yF":
        return !wearingGraniteBoots(player);
      case "l5Yu_4":
        return wearingGraniteBoots(player);
      default:
        return null;
    }
  }

  // ==========================================================================
  // Transcript hooks / actions / conditions / choices
  // ==========================================================================

  function handleHook(event) {
    const { player, npcId, hook } = event;
    if (hook !== START_HOOK || !DONDAKAN_NPC_IDS.has(npcId)) return;
    if (quest.getStage(player) !== 0) return;
    quest.setStage(player, STAGE_STARTED);
    syncVarbits(player);
  }

  function handleAction(event) {
    const { player, npcId, stepId } = event;
    switch (stepId) {
      // Rolad discovers the pages are missing; the fetch-the-pages stage starts.
      case "_p3Vas":
        if (npcId === ROLAD && stageOf(player) === STAGE_ENGINEER) quest.setStage(player, STAGE_PAGES);
        return;
      // Rolad receives the three pages and hands over the book.
      case "2Av3E2":
        if (npcId === ROLAD) {
          for (const itemId of PAGE_ITEM_IDS) player.getInventory().deleteNumber(itemId, 1);
          if (!hasItem(player, DWARVEN_LORE_ITEM)) addItem(player, DWARVEN_LORE_ITEM);
          if (stageOf(player) === STAGE_PAGES) quest.setStage(player, STAGE_BOOK);
        }
        return;
      // Finished reading the book: enough information for Dondakan.
      case "e2X7B0":
        if (npcId === ROLAD && stageOf(player) === STAGE_BOOK) quest.setStage(player, STAGE_DONDAKAN_BOOK);
        return;
      // Dondakan's "kicks the rock" cutscene: he wants a stronger material.
      case "-ian1p":
        if (DONDAKAN_NPC_IDS.has(npcId) && stageOf(player) === STAGE_DONDAKAN_BOOK) {
          quest.setStage(player, STAGE_GOLD);
        }
        return;
      // The golden cannonball is fired through the rock.
      case "3j4Hdi":
        if (DONDAKAN_NPC_IDS.has(npcId) && hasItem(player, GOLDEN_CANNONBALL_ITEM)) {
          player.getInventory().deleteNumber(GOLDEN_CANNONBALL_ITEM, 1);
        }
        player.setAttribute(FIRED_ATTRIBUTE, true);
        player.getPacketSender().sendVarbit(VARBIT_FIRED_GOLD_CANNONBALL, 1);
        if (stageOf(player) < STAGE_SCHEMATICS) quest.setStage(player, STAGE_SCHEMATICS);
        return;
      // Schematic hand-outs.
      case "On25m7":
      case "SFdap4":
        if (!hasItem(player, SCHEMATIC_DONDAKAN_ITEM)) addItem(player, SCHEMATIC_DONDAKAN_ITEM);
        return;
      case "73WGfD":
        if (!hasItem(player, SCHEMATICS_ENGINEER_ITEM)) addItem(player, SCHEMATICS_ENGINEER_ITEM);
        return;
      case "WQRznH":
      case "fAJORE":
        if (!hasItem(player, SCHEMATICS_KHORVAK_ITEM)) addItem(player, SCHEMATICS_KHORVAK_ITEM);
        return;
      // Tearing the base schematic out of the book.
      case "KjD1IE":
        if (!hasItem(player, BASE_SCHEMATICS_ITEM)) addItem(player, BASE_SCHEMATICS_ITEM);
        if (hasItem(player, DWARVEN_LORE_ITEM)) player.getInventory().deleteNumber(DWARVEN_LORE_ITEM, 1);
        return;
      // The cannon fires the player into the rock.
      case "jbZ7gu":
      case "ucl68v":
        if (DONDAKAN_NPC_IDS.has(npcId) && wearingHelmet(player)) fireIntoMine(player);
        return;
      // The furnace messages: the last one creates the cannonball.
      case "ZQsP2t":
        if (hasItem(player, GOLD_BAR_ITEM)) {
          player.getInventory().deleteNumber(GOLD_BAR_ITEM, 1);
          if (!hasItem(player, GOLDEN_CANNONBALL_ITEM)) addItem(player, GOLDEN_CANNONBALL_ITEM);
        }
        return;
      // Quest complete.
      case "5yAnic":
        if (DONDAKAN_NPC_IDS.has(npcId) && stageOf(player) >= STAGE_MINE && !quest.isComplete(player)) {
          event.handled = true;
          event.end = true;
          removeAvatar(player);
          quest.complete(player);
        }
        return;
      // Post-quest: the cannon fires the player straight back in.
      case "BETNCt":
        if (quest.isComplete(player) && wearingHelmet(player)) player.moveTo(MINE_LANDING);
        return;
      default:
        return;
    }
  }

  function handleCondition(event) {
    const { player, stepId } = event;
    // Dondakan's lost schematic is handed back without a receive action.
    if (stepId === "MGz01q") {
      if (!hasItem(player, SCHEMATIC_DONDAKAN_ITEM) && hasSpace(player)) {
        addItem(player, SCHEMATIC_DONDAKAN_ITEM);
      }
      return;
    }
    // The Arzinian Being's taunt ends with the gold-count line; the avatar attacks.
    if (stepId === "ls9q3a" || stepId === "qss2L2" || stepId === "FUvWcx") {
      spawnAvatar(player);
    }
  }

  function handleChoice(event) {
    const { player, npcId, option } = event;
    // "Skip cutscene? Yes." fires the player straight into the rock.
    if (
      option === "Yes." &&
      DONDAKAN_NPC_IDS.has(npcId) &&
      stageOf(player) === STAGE_ASSEMBLE &&
      hasItem(player, SCHEMATIC_ASSEMBLED_ITEM)
    ) {
      fireIntoMine(player);
    }
  }

  /** Plays the shake/fade stage direction and moves the player into Dondakan's mine. */
  function fireIntoMine(player) {
    if (stageOf(player) < STAGE_ASSEMBLE || quest.isComplete(player)) return;
    removeAvatar(player);
    player.setAttribute(AVATAR_KILLED_ATTRIBUTE, false);
    player.setAttribute(INSIDE_ATTRIBUTE, true);
    player.setAttribute(MINE_TICKS_ATTRIBUTE, 0);
    player.getPacketSender().sendVarbit(VARBIT_INSIDE_VISITED, 1);
    quest.setStage(player, STAGE_MINE);
    player.moveTo(MINE_LANDING);
  }

  /** Teleports a player out of the rock; the timer and the Avatar do not follow. */
  function exitMine(player) {
    player.setAttribute(INSIDE_ATTRIBUTE, false);
    player.setAttribute(MINE_TICKS_ATTRIBUTE, 0);
    player.getPacketSender().sendVarbit(VARBIT_INSIDE_VISITED, 0);
    player.moveTo(DONDAKAN_TILE);
  }

  function removeHelmetInMine(player) {
    player.sendMessage("The world turns black and you feel as if you're being sucked out of the rock.");
    if (goldOre(player) > 0) {
      player.getInventory().deleteNumber(GOLD_ORE_ITEM, goldOre(player));
      player.sendMessage("You suddenly notice all the gold in your inventory has disappeared! It must have been absorbed into the rock!");
    }
    removeAvatar(player);
    exitMine(player);
  }

  // ==========================================================================
  // Items
  // ==========================================================================

  function giveQuestPage(player, itemId, foundText, fullText) {
    if (hasItem(player, itemId)) return;
    if (hasSpace(player)) {
      addItem(player, itemId, 1);
      player.sendMessage(foundText);
    } else {
      api.getItemOnGroundManager().registerLocation(player, new Item(itemId, 1), player.getLocation());
      if (fullText) player.sendMessage(fullText);
    }
    if (pageCount(player) === 3) {
      player.sendMessage("You've found all three of Rolad's missing pages. Return them to him so he can put them back in his book.");
    }
  }

  function handleItemOnObject(event) {
    const { player, itemId } = event;
    if (itemId === GOLD_BAR_ITEM && String(event.object?.getDefinition?.()?.getName?.() ?? "").includes("Furnace")) {
      if (stageOf(player) < STAGE_GOLD || stageOf(player) >= STAGE_MINE) return;
      event.handled = true;
      makeGoldenCannonball(player);
      return;
    }
    if (itemId === GOLD_BAR_ITEM && event.object?.getDefinition?.()?.getName?.() === "Anvil") {
      if (stageOf(player) < STAGE_GOLD || quest.isComplete(player)) return;
      event.handled = true;
      smithGoldHelmet(player);
      return;
    }
  }

  function makeGoldenCannonball(player) {
    if (!hasItem(player, AMMO_MOULD_ITEM) && !hasItem(player, DOUBLE_AMMO_MOULD_ITEM)) {
      player.sendMessage("You need an ammo mould to make a golden cannonball.");
      return;
    }
    if (!hasItem(player, GOLD_BAR_ITEM)) return;
    startTranscript(api, player, DONDAKAN, PAGE, "going-for-the-gold-using-gold-bar-on-a-furnace-with-an-ammo-mould");
  }

  function smithGoldHelmet(player) {
    if (player.getSkillManager().getMaxLevel(Skill.SMITHING) < 50) {
      player.sendMessage("You need a Smithing level of 50 to make a golden helmet.");
      return;
    }
    if (!hasItem(player, HAMMER_ITEM)) {
      player.sendMessage("You need a hammer to smith a golden helmet.");
      return;
    }
    if (!hasItem(player, GOLD_BAR_ITEM, 3)) {
      player.sendMessage("You need three gold bars to make a golden helmet.");
      return;
    }
    player.getInventory().deleteNumber(GOLD_BAR_ITEM, 3);
    addItem(player, GOLD_HELMET_ITEM, 1);
    // Wiki (Gold helmet): 30 Smithing XP.
    player.getSkillManager().addExperiences(Skill.SMITHING, 30);
    player.sendMessage("You hammer the gold bars into a golden helmet.");
  }

  function handleItemOnNpc(event) {
    const { player, npcId, itemId } = event;
    if (!DONDAKAN_NPC_IDS.has(npcId)) {
      if (npcId === KHORVAK && itemId === DWARVEN_STOUT_ITEM) {
        useStoutOnKhorvak(event);
      }
      return;
    }
    const stage = stageOf(player);
    if (stage < STAGE_GOLD || stage >= STAGE_ASSEMBLE) return;
    event.handled = true;
    if (stage === STAGE_GOLD && itemId === GOLDEN_CANNONBALL_ITEM) {
      startTranscript(api, player, npcId, PAGE, "going-for-the-gold-using-the-golden-cannonball-on-dondakan");
      return;
    }
    if (itemId === GOLD_BAR_ITEM || itemId === GOLD_ORE_ITEM) {
      if (player.getAttribute(GOLD_SHOWN_ATTRIBUTE) === true) {
        startTranscript(api, player, npcId, PAGE, "going-for-the-gold-using-a-gold-ore-bar-on-dondakan-again");
      } else {
        player.setAttribute(GOLD_SHOWN_ATTRIBUTE, true);
        player.getPacketSender().sendVarbit(VARBIT_GOLD_CANNONBALL, 1);
        startTranscript(api, player, npcId, PAGE, "going-for-the-gold-using-gold-ore-bar-on-dondakan");
      }
      return;
    }
    if (itemId === PERFECT_GOLD_BAR_ITEM) {
      startTranscript(api, player, npcId, PAGE, "going-for-the-gold-using-perfect-gold-on-dondakan");
      return;
    }
    const name = String(event.item?.getDefinition?.()?.getName?.() ?? "");
    if (/ore|bar/i.test(name)) {
      startTranscript(api, player, npcId, PAGE, "going-for-the-gold-using-different-metal-ores-bars-on-dondakan");
      return;
    }
    startTranscript(api, player, npcId, PAGE, "going-for-the-gold-using-random-items-on-dondakan");
  }

  function useStoutOnKhorvak(event) {
    const { player } = event;
    if (stageOf(player) < STAGE_ASSEMBLE || hasItem(player, SCHEMATICS_KHORVAK_ITEM)) return;
    event.handled = true;
    player.getInventory().deleteNumber(DWARVEN_STOUT_ITEM, 1);
    startTranscript(api, player, KHORVAK, PAGE, "finding-the-schematics-using-a-dwarven-stout-on-khorvak");
  }

  function handleItemAction(event) {
    const { player, itemId } = event;
    if (itemId === DWARVEN_LORE_ITEM && event.option === "Read") {
      event.handled = true;
      readDwarvenLore(player);
      return;
    }
    if (SCHEMATIC_PART_IDS.has(itemId) && event.option === "Assemble") {
      event.handled = true;
      assembleSchematics(player);
    }
  }

  function readDwarvenLore(player) {
    if (stageOf(player) >= STAGE_ASSEMBLE) {
      startTranscript(api, player, ROLAD, PAGE, "finding-the-schematics-reading-the-dwarven-lore-book");
      return;
    }
    if (stageOf(player) >= STAGE_BOOK) {
      startTranscript(api, player, ROLAD, PAGE, "an-unbreakable-rock-or-stone-after-reading-the-book");
    }
  }

  function assembleSchematics(player) {
    if (hasItem(player, SCHEMATIC_ASSEMBLED_ITEM)) {
      player.sendMessage("The schematics are already assembled.");
      return;
    }
    if (!hasAllSchematicParts(player)) {
      player.sendMessage("You need all four parts of the schematics to assemble them.");
      return;
    }
    for (const itemId of SCHEMATIC_PART_IDS) player.getInventory().deleteNumber(itemId, 1);
    addItem(player, SCHEMATIC_ASSEMBLED_ITEM, 1);
    player.setAttribute(SOLVED_ATTRIBUTE, true);
    player.getPacketSender().sendVarbit(VARBIT_SCHEMATICS_SOLVED, 1);
    player.sendMessage("That's it! It all makes sense now! If you were a dwarf, that is...");
  }

  // ==========================================================================
  // Objects
  // ==========================================================================

  function objectOption(event) {
    const interactions = event.definition?.getInteractions?.()
      ?? event.object?.getDefinition?.()?.getInteractions?.()
      ?? [];
    return interactions[(event.clickType ?? 1) - 1] ?? null;
  }

  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    const option = objectOption(event);
    if (objectId === BOOK_MINE_CART && option === "Search") {
      if (stageOf(player) !== STAGE_PAGES || hasItem(player, BOOK_PAGE_2_ITEM)) return;
      event.handled = true;
      giveQuestPage(
        player,
        BOOK_PAGE_2_ITEM,
        "At the bottom of the cart you find a missing page of Rolad's book!",
        "At the bottom of the cart you find a missing page of Rolad's book! Unfortunately, you can't carry it and are forced to drop it on the ground."
      );
      return;
    }
    if (DWARVEN_MINE_ROCK_IDS.has(objectId) && option === "Mine") {
      if (
        stageOf(player) === STAGE_PAGES &&
        !hasItem(player, BOOK_PAGE_3_ITEM) &&
        inDwarvenMine(player)
      ) {
        pendingRockPage.add(player);
      }
      return;
    }
    if (TALKABLE_FLAME_IDS.has(objectId) && option === "Talk-to") {
      if (stageOf(player) !== STAGE_MINE || avatarKilled(player)) return;
      event.handled = true;
      startTranscript(api, player, ARZINIAN_BEING, PAGE, "between-a-rock-facing-the-arzinian-being");
    }
  }

  function handleMiningSuccess({ player }) {
    if (!pendingRockPage.has(player)) return;
    pendingRockPage.delete(player);
    if (stageOf(player) !== STAGE_PAGES || !inDwarvenMine(player)) return;
    if (hasItem(player, BOOK_PAGE_3_ITEM)) return;
    giveQuestPage(
      player,
      BOOK_PAGE_3_ITEM,
      "You see something lying just behind the rock you just mined... it's a missing page of Rolad's book!",
      "Unfortunately, you can't carry it and are forced to drop it on the ground."
    );
  }

  // ==========================================================================
  // Combat
  // ==========================================================================

  function handleNpcDeath(event) {
    const killer = event?.killer?.isPlayer?.() ? event.killer : null;
    if (!killer) return;
    if (event.npcId === DWARVEN_MINE_SCORPION) {
      if (stageOf(killer) !== STAGE_PAGES || hasItem(killer, BOOK_PAGE_1_ITEM)) return;
      if (!inDwarvenMine(killer)) return;
      giveQuestPage(
        killer,
        BOOK_PAGE_1_ITEM,
        "You turn over the corpse of the scorpion and find a missing page of Rolad's book!",
        "You turn over the corpse of the scorpion and find a missing page of Rolad's book! Unfortunately, you can't carry it and are forced to drop it on the ground."
      );
      return;
    }
    if (!ARZINIAN_AVATAR_NPC_IDS.has(event.npcId)) return;
    if (activeAvatars.get(killer) === event.npc) activeAvatars.delete(killer);
    if (stageOf(killer) === STAGE_MINE && !avatarKilled(killer)) {
      killer.setAttribute(AVATAR_KILLED_ATTRIBUTE, true);
      exitMine(killer);
    }
  }

  function spawnAvatar(player) {
    if (stageOf(player) !== STAGE_MINE || avatarKilled(player)) return;
    const existing = activeAvatars.get(player);
    if (existing && existing.isRegistered?.() !== false) return;
    const form = highestCombatStat(player);
    const level75 = goldOre(player) >= 15;
    let id;
    if (form === "melee") id = level75 ? ARZINIAN_AVATAR_OF_MAGIC_3 : ARZINIAN_AVATAR_OF_MAGIC_2;
    else if (form === "ranged") id = level75 ? ARZINIAN_AVATAR_OF_STRENGTH_3 : ARZINIAN_AVATAR_OF_STRENGTH_2;
    else id = level75 ? ARZINIAN_AVATAR_OF_RANGING_3 : ARZINIAN_AVATAR_OF_RANGING_2;
    const npc = api.spawnNpc({
      id,
      x: AVATAR_TILE.getX(),
      y: AVATAR_TILE.getY(),
      z: AVATAR_TILE.getZ(),
      owner: player,
      ownerOnly: true,
    });
    if (npc) activeAvatars.set(player, npc);
  }

  function removeAvatar(player) {
    const npc = activeAvatars.get(player);
    if (!npc) return;
    activeAvatars.delete(player);
    api.removeNpc(npc);
  }

  // ==========================================================================
  // Dondakan's mine (the helmet timer)
  // ==========================================================================

  function createArzinianMineArea() {
    class DondakanMineArea extends Area {
      process(mobile) {
        if (!mobile?.isPlayer?.()) return;
        const player = mobile.getAsPlayer();
        if (stageOf(player) !== STAGE_MINE || quest.isComplete(player) || avatarKilled(player)) return;
        if (!wearingHelmet(player)) {
          removeHelmetInMine(player);
          return;
        }
        const ticks = (Number(player.getAttribute(MINE_TICKS_ATTRIBUTE)) || 0) + 1;
        player.setAttribute(MINE_TICKS_ATTRIBUTE, ticks);
        for (const [at, message] of HELMET_TIMER_MESSAGES) {
          if (ticks === at) player.sendMessage(message);
        }
        if (ticks >= 800) {
          player.sendMessage("Just as you feel your neck is about to snap, you take off your helmet.");
          removeAvatar(player);
          exitMine(player);
        }
      }
    }
    return new DondakanMineArea([new Boundary(2300, 2460, 4920, 5010, 0)]);
  }

  // ==========================================================================
  // Journal and rewards
  // ==========================================================================

  function buildJournal(player, handle) {
    const stage = handle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Dondakan asked me to research his impenetrable rock.</str>",
        "<str>Rolad's book revealed gold and a demon inside; a golden</str>",
        "<str>cannonball opened the way and I killed the Arzinian Avatar.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_MINE) {
      return [
        "<str>Dondakan fired me into the rock with the golden helmet on.</str>",
        "Mine at least 6 <col=800000>gold ore</col> (15 to weaken it), then",
        "talk to the <col=800000>wall of flame</col> and kill the avatar.",
      ];
    }
    if (stage >= STAGE_ASSEMBLE) {
      return [
        "<str>Dondakan wants schematics and a golden helmet.</str>",
        hasItem(player, SCHEMATIC_ASSEMBLED_ITEM)
          ? "<str>I assembled the schematics.</str>"
          : "Collect all four <col=800000>schematics</col> and assemble one.",
        hasItem(player, GOLD_HELMET_ITEM)
          ? "<str>I have a golden helmet; wear it and return to Dondakan.</str>"
          : "Smith a <col=800000>golden helmet</col> from 3 gold bars at an anvil.",
      ];
    }
    if (stage >= STAGE_SCHEMATICS) {
      return [
        "<str>The golden cannonball passed through the rock.</str>",
        "Dondakan wants the <col=800000>schematics</col> to modify his cannon:",
        "one from him, the engineer, Khorvak or the book, and a golden helmet.",
      ];
    }
    if (stage >= STAGE_GOLD) {
      return [
        "<str>Dondakan wants a material harder than runite or granite.</str>",
        "Show him a <col=800000>gold bar</col>, make a <col=800000>golden cannonball</col>",
        "at a furnace with an ammo mould and give it to him.",
      ];
    }
    if (stage >= STAGE_DONDAKAN_BOOK) {
      return [
        "<str>I read Rolad's book: the rock holds gold and a demon.</str>",
        "Return to <col=800000>Dondakan</col> with a <col=800000>gold bar</col>.",
      ];
    }
    if (stage >= STAGE_BOOK) {
      return [
        "<str>Rolad gave me his Dwarven lore book.</str>",
        "I should <col=800000>read</col> it to learn the rock's secret.",
      ];
    }
    if (stage >= STAGE_PAGES) {
      return [
        "<str>Rolad lost three pages of his book in the Dwarven Mine.</str>",
        "Kill <col=800000>scorpions</col>, search the <col=800000>mine carts</col>",
        "and mine <col=800000>ore rocks</col> until I find them all.",
      ];
    }
    if (stage >= STAGE_ENGINEER) {
      return [
        "<str>The Dwarven Engineer pointed me to Rolad the scholar.</str>",
        "Talk to <col=800000>Rolad</col> at the Dwarven Mine by Ice Mountain.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "<str>Dondakan asked me to research his impenetrable rock.</str>",
        "Ask around <col=800000>Keldagrim</col> or the <col=800000>librarian</col>.",
      ];
    }
    return [
      "I can start this quest by talking to <col=800000>Dondakan</col>",
      "at the mines north-east of Rellekka.",
    ];
  }

  function grantReward(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.DEFENCE, 5000);
    skills.addExperiences(Skill.MINING, 5000);
    skills.addExperiences(Skill.SMITHING, 5000);
    if (hasSpace(player)) {
      addItem(player, RUNE_PICKAXE_ITEM, 1);
    } else {
      api.getItemOnGroundManager().registerLocation(player, new Item(RUNE_PICKAXE_ITEM, 1), player.getLocation());
      player.sendMessage("Dondakan tried to hand you a rune pickaxe, but you dropped it on the ground.");
    }
  }

  // ==========================================================================
  // Registration
  // ==========================================================================

  api.persistAttribute(GOLD_SHOWN_ATTRIBUTE);
  api.persistAttribute(SOLVED_ATTRIBUTE);
  api.persistAttribute(INSIDE_ATTRIBUTE, false);
  api.persistAttribute(FIRED_ATTRIBUTE);
  api.persistAttribute(AVATAR_KILLED_ATTRIBUTE);
  api.persistAttribute(MINE_TICKS_ATTRIBUTE, 0);

  quest = registerQuest(api, {
    key: "between_a_rock",
    name: "Between a Rock...",
    varpId: VARP_DWARFROCK,
    varbitId: VARBIT_STAGE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.DEFENCE.getIndex(), amount: 5000, label: "Defence" },
      { skillId: Skill.MINING.getIndex(), amount: 5000, label: "Mining" },
      { skillId: Skill.SMITHING.getIndex(), amount: 5000, label: "Smithing" },
    ],
    rewardItemLabel: "A Rune pickaxe and a Gold helmet",
    otherRewards: [
      "Access to the Arzinian Mine",
      "The ability to teleport to Dondakan's rock with a ring of wealth",
    ],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:condition", handleCondition);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onItemAction(handleItemAction);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemOnNpc(handleItemOnNpc);
  api.onObjectInteraction(handleObjectInteraction);
  api.onCustomEvent("mining:success", handleMiningSuccess);
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerLogin(handleLogin);
  api.onCustomEvent("player:bootstrap-complete", handleBootstrap);
  api.registerArea(createArzinianMineArea());
};
