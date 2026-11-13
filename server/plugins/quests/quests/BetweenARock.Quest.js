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
 * The stage numbers below are durable plugin stages. nativeProgress maps them to
 * the native cache phases; see docs/quests/native-quest-state-a.md.
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
 * Sources: the user's rsprox capture BetweenARock.bin (rev 242.1, start to finish; ticks are cited
 * where each behaviour is built, facts in docs/quests/between-a-rock/README.md and
 * plugins/quests/data/between-a-rock.json); the OSRS Wiki "Between a Rock..." and its Transcript
 * page; the cache's gamevals for ids.
 *
 * Units (plugins/quests/betweenarock/): Scenes (the kick, the golden cannonball, the cannon, the
 * landing and the first thoughts), Schematics (the 113/114 puzzle) and Mine (the helmet's time, the
 * Being's voice, the walls of flame, leaving the rock).
 *
 * Gaps (Ours, or not covered):
 *  - The page-3 rock drop and page-1 scorpion drop are guaranteed on the first success (the wiki
 *    says they may take several attempts).
 *  - The Being speaks up on one gold ore in two (the capture's rate varies); the Avatar's form follows
 *    the Wiki's highest-stat rule (the capture's three fights do not), and its health regeneration
 *    without enough gold ore is not simulated.
 *  - A player who logs out inside the rock logs back in outside it; the post-quest visits have no
 *    time limit.
 *  - The post-quest granite-boot haggling uses an input step the runtime cannot run, so only the
 *    wear/not-wear branches answer.
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
  const { registerQuest, startTranscript, openBook, bookPagesFromSpreads, loadTranscripts } = require("../QuestRuntime");
  const { createQuestScenes } = require("../QuestScenes");
  const { formatPlayerText } = require("../../npcs/NpcDialogues.plugin.js");
  const DATA = require("../data/between-a-rock.json");
  const Scenes = require("../betweenarock/Scenes.BetweenARock");
  const Schematics = require("../betweenarock/Schematics.BetweenARock");
  const Mine = require("../betweenarock/Mine.BetweenARock");

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
  /** The three pages put together (dwarf_rock_pagex3): they join as the third is found (tick 1159). */
  const PAGES_ITEM = api.core.CacheDefinitions.getObjId("dwarf_rock_pagex3"); // 4573
  const DIAGRAM_ITEM = api.core.CacheDefinitions.getObjId("dwarf_rock_diagram"); // 25128
  const DONDAKAN_CANNON = api.core.CacheDefinitions.getLocId("dwarf_rock_multicannon1"); // 5975, Fire
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
  const QUEST_SCROLL = 153; // questscroll
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

  /** The Being's spawn (npc-spawns.json): the player faces it as they talk to the flames (tick 3563). */
  const ARZINIAN_BEING_TILE = [2367, 4960];
  const DONDAKAN_MULTI = api.core.CacheDefinitions.getNpcId("dwarfrock_multi_dondakan"); // 6262
  const BUSY_VARBIT = 12393;

  // The Dwarven Mine (scorpions, book cart, tin/clay/copper/iron rocks).
  const DWARVEN_MINE_BOUNDS = new Boundary(2960, 3070, 9690, 9860, 0);
  // Dondakan's mine ends before map square 38: that square holds the Recruitment Drive rooms.
  const ARZINIAN_MINE_BOUNDS = new Boundary(2300, 2431, 4920, 5010, 0);

  /** The Arzinian Avatar spawned for one player. */
  const activeAvatars = new WeakMap();
  /** Players shown "Dondakan gives you a rune pickaxe." as the quest scroll closes (tick 5789). */
  const pickaxeBox = new WeakSet();
  /** Players watching one of the quest's scenes. */
  const scenePlaying = new WeakSet();
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
    if (hasItem(player, PAGES_ITEM)) return 3;
    let count = 0;
    for (const itemId of PAGE_ITEM_IDS) if (hasItem(player, itemId)) count++;
    return count;
  }

  /** Whether the page is carried, loose or among the three put together. */
  function hasPage(player, itemId) {
    return hasItem(player, itemId) || hasItem(player, PAGES_ITEM);
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

  /** `itemId` into inventory slot `slot` when it is free (live hands items back in the slot the old ones had), else anywhere. */
  function putInSlot(player, slot, itemId) {
    const inventory = player.getInventory();
    const there = slot >= 0 ? inventory.get(slot) : null;
    if (slot >= 0 && (!there || (there.getId?.() ?? -1) < 0 || (there.getAmount?.() ?? 0) <= 0)) {
      inventory.setItem(slot, new Item(itemId, 1)).refreshItems();
      return;
    }
    addItem(player, itemId, 1);
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
    // Ours: a player who logged out inside the rock (during the quest) is outside again, as taking the
    // helmet off would leave them; the time and the Avatar do not carry over.
    // After the quest, logging out leaves the mine as well (Wiki, Arzinian Mine).
    if (inArzinianMine(player)) {
      const [x, y] = DATA.exits.helmetOff;
      player.setLocation(new Location(x, y, 0));
    }
    // Ours: a logout during the cannon cutscene (2057,4978, plane 3) comes back next to Dondakan, the stage unchanged.
    const at = player.getLocation?.();
    if (at && at.getZ() === 3 && at.getX() >= 2048 && at.getX() <= 2066 && at.getY() >= 4966 && at.getY() <= 4990) {
      player.setLocation(new Location(2825, 10168, 0));
    }
    player.setAttribute(INSIDE_ATTRIBUTE, false);
    player.setAttribute(MINE_TICKS_ATTRIBUTE, 0);
    Mine.stopTimer(player);
    removeAvatar(player);
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
    if (stage >= STAGE_ASSEMBLE) {
      // Still looking, with no helmet and the parts not all found, he says what to look for (ticks 2140, 2174).
      const looking = !hasItem(player, SCHEMATIC_ASSEMBLED_ITEM) && !hasAllSchematicParts(player) && !holdsHelmetOrWears(player);
      return looking ? "finding-the-schematics-talking-to-dondakan" : "between-a-rock-returning-to-dondakan";
    }
    // Stage 70 is played by talkDondakan: his question again.
    if (stage >= STAGE_SCHEMATICS) return "finding-the-schematics-talking-to-dondakan";
    if (stage >= STAGE_BOOK) return "going-for-the-gold-returning-to-dondakan";
    if (stage >= STAGE_ENGINEER) {
      return "an-unbreakable-rock-or-stone-talking-to-dondakan-after-learning-about-the-book";
    }
    if (stage >= STAGE_STARTED) {
      return "an-unbreakable-rock-or-stone-talking-to-dondakan-after-accepting-the-quest";
    }
    return "an-unbreakable-rock-or-stone";
  }

  function holdsHelmetOrWears(player) {
    return hasItem(player, GOLD_HELMET_ITEM) || wearingHelmet(player);
  }

  /**
   * Talk-to at stage 70 (after "My head's spinning, I have to go for a bit."): the player asks his
   * question again, "So you want to... fire me into the rock?" (tick 2079). Named hooks count as handled
   * unless they return false.
   */
  function talkDondakan(event) {
    const { player, npcId } = event;
    if (stageOf(player) !== STAGE_SCHEMATICS || !DONDAKAN_NPC_IDS.has(npcId)) return false;
    const question = (raw) => {
      const all = [];
      const walk = (steps) => (steps ?? []).forEach((step) => {
        for (const option of step?.options ?? []) {
          if (option.text === "So you want to... fire me into the rock?") all.push(option.steps);
          walk(option.steps);
        }
        walk(step?.steps);
      });
      walk(raw);
      return all[0] ?? [];
    };
    event.handled = true;
    startTranscript(api, player, npcId, PAGE, "going-for-the-gold-using-the-golden-cannonball-on-dondakan", question, event.npc ?? null);
  }

  function selectEngineerVariant(player) {
    // After the quest they say their own things (the Dwarven Engineer, tick 6113).
    if (quest.isComplete(player)) return null;
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
    // After the quest they say their own things (the Dwarven Engineer, tick 6113).
    if (quest.isComplete(player)) return null;
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
    // After the quest they say their own things (the Dwarven Engineer, tick 6113).
    if (quest.isComplete(player)) return null;
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
        return holdsHelmetOrWears(player) && !hasItem(player, SCHEMATIC_ASSEMBLED_ITEM) && !hasAnySchematicPart(player);
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
        return holdsHelmetOrWears(player) && hasItem(player, SCHEMATIC_DONDAKAN_ITEM)
          && !hasItem(player, SCHEMATIC_ASSEMBLED_ITEM) && !hasAllSchematicParts(player);
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

  /** Wiki: 50 Smithing, 40 Mining, 30 Defence, Dwarf Cannon and Fishing Contest. */
  const REQUIRED_SKILLS = [
    { skill: Skill.SMITHING, level: 50, label: "Smithing" },
    { skill: Skill.MINING, level: 40, label: "Mining" },
    { skill: Skill.DEFENCE, level: 30, label: "Defence" },
  ];
  const REQUIRED_QUESTS = [
    { key: "dwarf_cannon", name: "Dwarf Cannon" },
    { key: "fishing_contest", name: "Fishing Contest" },
  ];

  function questIsComplete(player, key) {
    const request = { player, key, complete: undefined };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function missingQuestRequirements(player) {
    return REQUIRED_QUESTS.filter(({ key }) => !questIsComplete(player, key));
  }

  function notifyQuestRequirements(player) {
    for (const requirement of missingQuestRequirements(player)) {
      player.sendMessage(`You must complete ${requirement.name} to start this quest.`);
    }
  }

  function meetsStartRequirements(player) {
    return missingSkillRequirements(player).length === 0 && missingQuestRequirements(player).length === 0;
  }

  function missingSkillRequirements(player) {
    const skills = player.getSkillManager();
    return REQUIRED_SKILLS.filter((requirement) => skills.getMaxLevel(requirement.skill) < requirement.level);
  }

  function meetsSkillRequirements(player) {
    return missingSkillRequirements(player).length === 0;
  }

  function notifySkillRequirements(player) {
    for (const requirement of missingSkillRequirements(player)) {
      player.sendMessage(
        `You need a ${requirement.label} level of at least ${requirement.level} to start this quest.`
      );
    }
  }

  function handleHook(event) {
    const { player, npcId, hook } = event;
    if (hook !== START_HOOK || !DONDAKAN_NPC_IDS.has(npcId)) return;
    if (quest.getStage(player) !== 0) return;
    if (!meetsStartRequirements(player)) {
      event.end = true;
      notifySkillRequirements(player);
      notifyQuestRequirements(player);
      return;
    }
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
          // The book goes in the pages' slot (tick 1221).
          const slot = player.getInventory().getSlotForItemId(PAGES_ITEM);
          player.getInventory().deleteNumber(PAGES_ITEM, 1);
          for (const itemId of PAGE_ITEM_IDS) player.getInventory().deleteNumber(itemId, 1);
          if (!hasItem(player, DWARVEN_LORE_ITEM)) putInSlot(player, slot, DWARVEN_LORE_ITEM);
          if (stageOf(player) === STAGE_PAGES) quest.setStage(player, STAGE_BOOK);
        }
        return;
      // Finished reading the book: enough information for Dondakan, in a box with the book (tick 1257).
      case "e2X7B0":
        if (stageOf(player) === STAGE_BOOK) quest.setStage(player, STAGE_DONDAKAN_BOOK);
        event.box = { items: [DWARVEN_LORE_ITEM] };
        return;
      // The last page's picture (tick 2166): a message box, then "Tear out the page?".
      case "lbgg1b":
        event.box = { statement: true };
        return;
      // Dondakan walks up the passage and kicks the rock (ticks 1567-1586); the talk carries on after it.
      case "-ian1p":
        if (!DONDAKAN_NPC_IDS.has(npcId)) return;
        event.handled = true;
        Scenes.kick(player, event.npc ?? nearbyDondakan(player), () =>
          startTranscript(api, player, npcId, PAGE, "going-for-the-gold-returning-to-dondakan", (raw) => resumeAfterKick(raw), event.npc));
        return;
      // The golden cannonball is fired through the rock (ticks 2041-2050).
      case "3j4Hdi":
        if (!DONDAKAN_NPC_IDS.has(npcId)) return;
        event.handled = true;
        if (hasItem(player, GOLDEN_CANNONBALL_ITEM)) player.getInventory().deleteNumber(GOLDEN_CANNONBALL_ITEM, 1);
        player.setAttribute(FIRED_ATTRIBUTE, true);
        player.getPacketSender().sendVarbit(VARBIT_FIRED_GOLD_CANNONBALL, 1);
        if (stageOf(player) < STAGE_SCHEMATICS) quest.setStage(player, STAGE_SCHEMATICS);
        Scenes.goldCannonball(player, () =>
          startTranscript(api, player, npcId, PAGE, "going-for-the-gold-using-the-golden-cannonball-on-dondakan",
            (raw) => stepsFrom(raw, "3j4Hdi", false) ?? [], event.npc));
        return;
      // Schematic hand-outs.
      case "On25m7":
      case "SFdap4":
        if (!hasItem(player, SCHEMATIC_DONDAKAN_ITEM)) addItem(player, SCHEMATIC_DONDAKAN_ITEM);
        // Stage 80 as his schematic is handed over (tick 2138).
        if (stageOf(player) === STAGE_SCHEMATICS) quest.setStage(player, STAGE_ASSEMBLE);
        return;
      case "73WGfD":
        if (!hasItem(player, SCHEMATICS_ENGINEER_ITEM)) addItem(player, SCHEMATICS_ENGINEER_ITEM);
        return;
      case "WQRznH":
      case "fAJORE":
        if (!hasItem(player, SCHEMATICS_KHORVAK_ITEM)) addItem(player, SCHEMATICS_KHORVAK_ITEM);
        return;
      // Tearing the base schematic out of the book: it takes the book's slot, shown in a box (tick 2170).
      case "KjD1IE":
        tearOutSchematic(player);
        event.box = { items: [BASE_SCHEMATICS_ITEM] };
        return;
      // The furnace's messages come one after another as the cannonball is made (ticks 1767-1775).
      case "i-Dp7-":
      case "FuWG5m":
      case "4zrI1F":
      case "O6vmyg":
      case "ZQsP2t":
        furnaceMessage(event);
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
        if (!quest.isComplete(player) || !wearingHelmet(player)) return;
        event.handled = true;
        event.end = true;
        Scenes.launch(player, null);
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
  }

  /** Dondakan's lines that start a scene as they are continued, and the Being's that shake the room. */
  function handleLine(event) {
    const { player, npcId, text } = event;
    if (typeof text !== "string") return;
    if (DONDAKAN_NPC_IDS.has(npcId)) {
      // Stage 60 as this line is continued (tick 1542), whichever of his questions the player asks next.
      if (text === "Well, we're not very much closer to a solution then, are we?" && stageOf(player) === STAGE_DONDAKAN_BOOK) {
        event.after = () => { if (stageOf(player) === STAGE_DONDAKAN_BOOK) quest.setStage(player, STAGE_GOLD); };
        return;
      }
      // "...let me have a look at those schematics and we'll get started.": the cannon scene (tick 3209).
      if (text.endsWith("let me have a look at those schematics and we'll get started.")) {
        if (stageOf(player) === STAGE_ASSEMBLE && hasItem(player, SCHEMATIC_ASSEMBLED_ITEM) && wearingHelmet(player)) {
          event.after = () => Scenes.cannon(player, firstLanding);
        }
        return;
      }
      // "Okay, here we go, hold on to your helmet!": fired straight in (tick 3724).
      if (text === "Okay, here we go, hold on to your helmet!" && stageOf(player) === STAGE_MINE && wearingHelmet(player)) {
        event.after = () => Scenes.launch(player, landedAgain);
      }
      return;
    }
    if (npcId !== ARZINIAN_BEING) return;
    // Its first word shakes the room (tick 3563); the Avatar comes after its last (tick 3574).
    if (text.startsWith("You did not heed my messages to stay away!")) Scenes.shake(player);
    if (AVATAR_LINES.has(text)) event.after = () => avatarDescends(player);
  }

  /** The Being's last lines, by the gold the player carries. */
  const AVATAR_LINES = new Set([
    "I am invincible! You stand no chance against me!",
    "You are no match for me!",
    "And while your power is great, mortal, I will still resist you!",
  ]);

  function avatarDescends(player) {
    player.getPacketSender().sendInterfaceRemoval().sendCameraReset();
    spawnAvatar(player);
  }

  /** The first landing (tick 3295): stage 90, the assembled schematic used up, the player's thoughts. */
  function firstLanding(player) {
    if (stageOf(player) === STAGE_ASSEMBLE) {
      player.getInventory().deleteNumber(SCHEMATIC_ASSEMBLED_ITEM, 1);
      enterMine(player);
    }
    Mine.stopTimer(player);
    Scenes.firstThoughts(player, startTimeInside);
  }

  /** Every later landing: the helmet's warning (tick 3738), its continue starting the time. */
  function landedAgain(player) {
    enterMine(player);
    const raw = loadTranscripts(api)?.[PAGE]?.variants?.["between-a-rock-talking-to-dondakan-after-being-shot-into-the-mine"] ?? [];
    const box = stepsFrom(raw, "ucl68v") ?? [];
    Mine.stopTimer(player);
    Scenes.warningBox(player, formatPlayerText(String(box[0]?.text ?? ""), player), startTimeInside);
  }

  /** The warning's continue: the time starts only for a player still inside with the helmet on. */
  function startTimeInside(player) {
    if (Mine.inside(player) && wearingHelmet(player) && stageOf(player) === STAGE_MINE && !quest.isComplete(player)) Mine.startTimer(player);
  }

  function enterMine(player) {
    removeAvatar(player);
    player.setAttribute(AVATAR_KILLED_ATTRIBUTE, false);
    player.setAttribute(INSIDE_ATTRIBUTE, true);
    player.getPacketSender().sendVarbit(VARBIT_INSIDE_VISITED, 1);
    if (stageOf(player) < STAGE_MINE) quest.setStage(player, STAGE_MINE);
  }

  /** Out of the rock (Mine.leave): the inside flags go. */
  function leftMine(player, { killed }) {
    player.setAttribute(INSIDE_ATTRIBUTE, false);
    player.getPacketSender().sendVarbit(VARBIT_INSIDE_VISITED, 0);
    if (killed) player.getPacketSender().sendVarbit(VARBIT_STAGE, nativeProgress(stageOf(player), player));
  }

  function nearbyDondakan(player) {
    return [...(player.getLocalNpcs?.() ?? [])].find((npc) => npc.getId?.() === DONDAKAN_MULTI) ?? null;
  }

  /** The steps after the step with `id`, wherever it sits (Lost Tribe's helper). */
  function stepsFrom(steps, id, inclusive = true) {
    for (let index = 0; index < (steps?.length ?? 0); index++) {
      const step = steps[index];
      if (step?.id === id) return steps.slice(inclusive ? index : index + 1);
      for (const nested of [step?.steps, ...(step?.options ?? []).map((option) => option.steps)]) {
        const found = stepsFrom(nested, id, inclusive);
        if (found) return found;
      }
    }
    return null;
  }

  /** The transcript's steps of `variant` after the step `from` (all of them when null), up to `until`. */
  function transcriptSteps(variant, from, until) {
    const raw = loadTranscripts(api)?.[PAGE]?.variants?.[variant] ?? [];
    let steps = from ? (stepsFrom(raw, from, false) ?? []) : raw;
    if (until) {
      const end = steps.findIndex((step) => step?.id === until);
      if (end >= 0) steps = steps.slice(0, end);
    }
    return steps;
  }

  /**
   * After the kick: the rest of "What else did you try?", then Dondakan's first menu again, as its
   * "previous" jump does and as live shows it (the capture picks "Maybe we should..." there, tick 1659).
   */
  function resumeAfterKick(raw) {
    const tail = stepsFrom(raw, "-ian1p", false) ?? [];
    const menu = raw.find((step) => step?.type === "choice");
    const lines = tail.filter((step) => step?.type !== "jump");
    return menu ? [...lines, menu] : lines;
  }

  // ==========================================================================
  // Items
  // ==========================================================================

  /**
   * A page found: shown in a box with the page (ticks 1077, 1129, 1156), or dropped where the player
   * stands when there is no room. With the third, the three go together into one item and a second box
   * says so (tick 1159).
   */
  function giveQuestPage(player, itemId, foundText, fullText) {
    if (hasPage(player, itemId)) return;
    const boxes = [];
    if (hasSpace(player)) {
      addItem(player, itemId, 1);
      boxes.push([itemId, foundText]);
    } else {
      api.getItemOnGroundManager().registerLocation(player, new Item(itemId, 1), player.getLocation());
      if (fullText) boxes.push([itemId, fullText]);
    }
    if (PAGE_ITEM_IDS.every((id) => hasItem(player, id))) {
      const slot = player.getInventory().getSlotForItemId(BOOK_PAGE_2_ITEM) >= 0
        ? Math.min(...PAGE_ITEM_IDS.map((id) => player.getInventory().getSlotForItemId(id)))
        : -1;
      for (const id of PAGE_ITEM_IDS) player.getInventory().deleteNumber(id, 1);
      putInSlot(player, slot, PAGES_ITEM);
      boxes.push([PAGES_ITEM, "You've found all three of Rolad's missing pages. Return them to him so he can put them back in his book."]);
    }
    itemBoxes(player, boxes);
  }

  function itemBoxes(player, boxes) {
    if (!boxes.length) return;
    const { DialogueChainBuilder, ItemStatementDialogue } = api.core;
    const chain = new DialogueChainBuilder();
    boxes.forEach(([itemId, text], index) => chain.add(new ItemStatementDialogue(index, itemId, text)));
    player.getDialogueManager().startDialogues(chain);
  }

  function handleItemOnObject(event) {
    const { player, itemId } = event;
    const name = String(event.object?.getDefinition?.()?.getName?.() ?? "");
    if (itemId === GOLD_BAR_ITEM && name.includes("Furnace")) {
      if (stageOf(player) < STAGE_GOLD || stageOf(player) >= STAGE_MINE) return;
      event.handled = true;
      makeGoldenCannonball(player);
      return;
    }
    if (itemId === GOLD_BAR_ITEM && name === "Anvil") {
      if (!canAskHelmet(player)) return;
      event.handled = true;
      askGoldHelmet(player);
    }
  }

  function makeGoldenCannonball(player) {
    if (!hasItem(player, AMMO_MOULD_ITEM) && !hasItem(player, DOUBLE_AMMO_MOULD_ITEM)) {
      // Ours: no capture or Wiki line for a furnace without a mould.
      player.sendMessage("You need an ammo mould to make a golden cannonball.");
      return;
    }
    if (!hasItem(player, GOLD_BAR_ITEM)) return;
    startTranscript(api, player, DONDAKAN, PAGE, "going-for-the-gold-using-gold-bar-on-a-furnace-with-an-ammo-mould");
  }

  /**
   * The furnace's transcript messages, timed as live sends them (ticks 1767-1775): the first two as
   * "Yes." is picked with human_furnace, one a tick for the next two, and the cannonball eight ticks
   * on, made from the first gold bar in its slot (37.5 Smithing XP, Wiki Cannon ball (Between a Rock...)).
   */
  const FURNACE_TICKS = { "i-Dp7-": 0, FuWG5m: 0, "4zrI1F": 1, O6vmyg: 2, ZQsP2t: 8 };
  const FURNACE_ANIMATION = 899;
  const GOLDEN_CANNONBALL_XP = 37.5;

  function furnaceMessage(event) {
    const { player, stepId } = event;
    const text = formatPlayerText(String(event.text ?? ""), player);
    event.handled = true;
    if (stepId === "i-Dp7-") {
      player.getMovementQueue().reset();
      player.performAnimation(new api.core.Animation(FURNACE_ANIMATION));
      player.getPacketSender().sendVarbit(BUSY_VARBIT, 1);
    }
    const ticks = FURNACE_TICKS[stepId] ?? 0;
    const deliver = () => {
      if (player.isRegistered?.() === false) return;
      player.sendMessage(text);
      if (stepId === "ZQsP2t") castGoldenCannonball(player);
    };
    if (ticks === 0) deliver();
    else api.core.TaskManager.submit(new api.core.CountdownTask(player, ticks, deliver));
  }

  function castGoldenCannonball(player) {
    player.getPacketSender().sendVarbit(BUSY_VARBIT, 0);
    const inventory = player.getInventory();
    const slot = inventory.getSlotForItemId(GOLD_BAR_ITEM);
    if (slot < 0) return;
    inventory.setItem(slot, new Item(GOLDEN_CANNONBALL_ITEM, 1)).refreshItems();
    player.getSkillManager().addExperiences(Skill.SMITHING, GOLDEN_CANNONBALL_XP);
  }

  function holdsGoldHelmet(player) {
    return hasItem(player, GOLD_HELMET_ITEM)
      || Array.from({ length: api.core.Bank.TOTAL_BANK_TABS }, (_, tab) => player.getBank(tab)).some((bank) => bank.getAmount(GOLD_HELMET_ITEM) > 0);
  }

  // Wiki (Gold helmet): "Partial completion of Between a Rock..." (no step named; the lower bound here, the
  // golden cannonball, is inferred and sits right before the Quick guide's helmet step) and, after the quest,
  // "smith it on any anvil". The Wilderness Diary row: not "while you already have a gold helmet in your
  // inventory or bank"; that row is not limited to after the quest, so the rule holds at every stage.
  function canAskHelmet(player) {
    return stageOf(player) >= STAGE_GOLD && !holdsGoldHelmet(player);
  }

  const HELMET_PROMPT = "Would you like to make a golden helmet?";
  const SMITHING_ANIMATION = 898;
  const HELMET_TICKS = 4;

  /** Smith on an anvil with gold bars (tick 5114), or a gold bar used on it (2356): the golden helmet's question. */
  function smithAtAnvil(request) {
    const { player } = request;
    if (!hasItem(player, GOLD_BAR_ITEM) || !canAskHelmet(player)) return;
    request.handled = true;
    askGoldHelmet(player);
  }

  function askGoldHelmet(player) {
    api.sendMultiChatboxPrompt(player, HELMET_PROMPT, "Yes.", () => smithGoldHelmet(player), "No.", () => {});
  }

  /** "Yes.": human_smithing, then the helmet four ticks later from the first bar's slot (ticks 2358-2362). */
  function smithGoldHelmet(player) {
    // Wiki: the 50 Smithing is boostable, so the current level counts.
    if (player.getSkillManager().getCurrentLevel(Skill.SMITHING) < 50) {
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
    // Preset bars are not the player's own: they make no helmet (and so no diary credit).
    const { plainAmount, takePlain, PRESET_TEXT } = require("../../items/PoweredStaff");
    if (plainAmount(player.getInventory(), GOLD_BAR_ITEM) < 3) {
      player.sendMessage(PRESET_TEXT);
      return;
    }
    player.getMovementQueue().reset();
    player.performAnimation(new api.core.Animation(SMITHING_ANIMATION));
    api.core.TaskManager.submit(new api.core.CountdownTask(player, HELMET_TICKS, () => {
      if (player.isRegistered?.() === false || plainAmount(player.getInventory(), GOLD_BAR_ITEM) < 3) return;
      const inventory = player.getInventory();
      const slot = inventory.getSlotForItemId(GOLD_BAR_ITEM);
      takePlain(inventory, GOLD_BAR_ITEM, 3);
      putInSlot(player, slot, GOLD_HELMET_ITEM);
      // Wiki (Gold helmet): 30 Smithing XP.
      player.getSkillManager().addExperiences(Skill.SMITHING, 30);
      player.sendMessage("You forge a beautiful and very heavy golden helmet out of solid gold.");
      player.sendMessage("Who knows, this might become a new fashion rage?");
      // The Wilderness Diary credits it in the Resource Area (WildernessResourceDiary.AchievementDiaries.js).
      api.emitCustomEvent("smithing:success", { player, skill: Skill.SMITHING, itemId: GOLD_HELMET_ITEM });
    }));
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
      startTranscript(api, player, npcId, PAGE, "going-for-the-gold-using-the-golden-cannonball-on-dondakan", null, event.npc ?? null);
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
      if (!Schematics.openPuzzle(player)) {
        // Ours: no capture or Wiki line for assembling with parts missing.
        player.sendMessage("You need all four parts of the schematics to assemble them.");
      }
    }
  }

  /** The book's three spreads (ticks 1247-1251), the diagram on the last. */
  const BOOK_PAGES = bookPagesFromSpreads(DATA.book.spreads.map((sides) => sides.map((lines) =>
    lines.map((line) => (typeof line === "string" ? line : { item: DIAGRAM_ITEM, zoom: line.zoom }))))) ;

  /**
   * Read: the book (392). Opened at stage 40 the reading is done at once (stage 50 as it opens, tick
   * 1247); closing it then says so in a box with the book. From stage 80 closing it shows the last
   * page's picture and asks to tear it out (2151-2170).
   */
  function readDwarvenLore(player) {
    openBook(player, DATA.book.title, BOOK_PAGES, () => closedDwarvenLore(player));
    if (stageOf(player) === STAGE_BOOK) quest.setStage(player, STAGE_DONDAKAN_BOOK);
  }

  function closedDwarvenLore(player) {
    if (player.isRegistered?.() === false) return;
    const stage = stageOf(player);
    if (stage >= STAGE_ASSEMBLE && !quest.isComplete(player) && !hasItem(player, BASE_SCHEMATICS_ITEM)
      && player.getAttribute(SOLVED_ATTRIBUTE) !== true) {
      startTranscript(api, player, ROLAD, PAGE, "finding-the-schematics-reading-the-dwarven-lore-book");
      return;
    }
    if (stage >= STAGE_DONDAKAN_BOOK && stage < STAGE_GOLD) {
      startTranscript(api, player, ROLAD, PAGE, "an-unbreakable-rock-or-stone-after-reading-the-book");
    }
  }

  function tearOutSchematic(player) {
    const inventory = player.getInventory();
    const slot = inventory.getSlotForItemId(DWARVEN_LORE_ITEM);
    if (slot >= 0) inventory.setItem(slot, new Item(BASE_SCHEMATICS_ITEM, 1)).refreshItems();
    else if (!hasItem(player, BASE_SCHEMATICS_ITEM)) addItem(player, BASE_SCHEMATICS_ITEM);
  }

  /** Solved (Schematics.BetweenARock): the four parts become the assembled one, in Dondakan's part's slot (tick 2795). */
  function assembleSchematics(player) {
    const inventory = player.getInventory();
    const slot = inventory.getSlotForItemId(SCHEMATIC_DONDAKAN_ITEM);
    for (const itemId of SCHEMATIC_PART_IDS) inventory.deleteNumber(itemId, 1);
    putInSlot(player, slot, SCHEMATIC_ASSEMBLED_ITEM);
    player.setAttribute(SOLVED_ATTRIBUTE, true);
    player.getPacketSender().sendVarbit(VARBIT_SCHEMATICS_SOLVED, 1);
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
      if (stageOf(player) !== STAGE_PAGES) return;
      event.handled = true;
      if (hasPage(player, BOOK_PAGE_2_ITEM)) {
        player.sendMessage("You've had enough of searching carts, there's nothing more inside them.");
        return;
      }
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
        !hasPage(player, BOOK_PAGE_3_ITEM) &&
        inDwarvenMine(player)
      ) {
        pendingRockPage.add(player);
      }
      return;
    }
    if (TALKABLE_FLAME_IDS.has(objectId) && option === "Talk-to") {
      if (stageOf(player) !== STAGE_MINE || avatarKilled(player) || activeAvatars.has(player)) return;
      event.handled = true;
      player.setPositionToFace?.(new Location(ARZINIAN_BEING_TILE[0], ARZINIAN_BEING_TILE[1], 0));
      startTranscript(api, player, ARZINIAN_BEING, PAGE, "between-a-rock-facing-the-arzinian-being");
      return;
    }
    if (objectId === DONDAKAN_CANNON && option === "Fire") {
      event.handled = true;
      fireCannon(player);
    }
  }

  /**
   * Fire on Dondakan's cannon: "This definitely isn't your cannon." before the quest is done (tick 268);
   * after it, straight back into the rock with the helmet on (Wiki, the 14 August 2024 update).
   */
  function fireCannon(player) {
    if (!quest.isComplete(player)) {
      player.sendMessage("This definitely isn't your cannon.");
      return;
    }
    if (!wearingHelmet(player)) {
      // Ours: Dondakan's post-quest line for a player without the helmet on.
      const steps = stepsFrom(loadTranscripts(api)?.[PAGE]?.variants?.["post-quest-dondakan"] ?? [], "bSJoCg") ?? [];
      startTranscript(api, player, DONDAKAN, PAGE, "post-quest-dondakan", () => steps[0]?.steps ?? []);
      return;
    }
    Scenes.launch(player, null);
  }

  function handleMiningSuccess(event) {
    const { player } = event;
    if (!pendingRockPage.has(player)) return;
    pendingRockPage.delete(player);
    if (stageOf(player) !== STAGE_PAGES || !inDwarvenMine(player)) return;
    if (hasPage(player, BOOK_PAGE_3_ITEM)) return;
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

  function handleDropContext({ context }) {
    // The quest awards this page with its mine, stage and inventory checks.
    context.handledItemIds.add(BOOK_PAGE_1_ITEM);
  }

  function handleNpcDeath(event) {
    const killer = event?.killer?.isPlayer?.() ? event.killer : null;
    if (!killer) return;
    if (event.npcId === DWARVEN_MINE_SCORPION) {
      if (stageOf(killer) !== STAGE_PAGES || hasPage(killer, BOOK_PAGE_1_ITEM)) return;
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
      // The tick after the killing blow, the player is out (tick 5751).
      killer.setAttribute(AVATAR_KILLED_ATTRIBUTE, true);
      killer.getPacketSender().sendEntityHintRemoval?.();
      Mine.leave(killer, { killed: true });
    }
  }

  /** The Avatar, by the player's best combat skill and the gold they carry, at 2375,4951 facing them (tick 3574). */
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
    const [x, y] = DATA.avatar.spawn;
    const npc = api.spawnNpc({ id, x, y, z: 0, owner: player, ownerOnly: true });
    if (!npc) return;
    activeAvatars.set(player, npc);
    npc.setPositionToFace?.(player.getLocation());
    player.getPacketSender().sendEntityHint?.(npc);
  }

  function removeAvatar(player) {
    const npc = activeAvatars.get(player);
    if (!npc) return;
    activeAvatars.delete(player);
    player.getPacketSender().sendEntityHintRemoval?.();
    api.removeNpc(npc);
  }

  // ==========================================================================
  // Dondakan's mine (the helmet's time; Mine.BetweenARock)
  // ==========================================================================

  function createArzinianMineArea() {
    class DondakanMineArea extends Area {
      process(mobile) {
        if (!mobile?.isPlayer?.()) return;
        const player = mobile.getAsPlayer();
        // Not while being fired in or thinking the first thoughts: the helmet is on and the player held.
        if (scenePlaying.has(player)) return;
        const questVisit = stageOf(player) === STAGE_MINE && !quest.isComplete(player) && !avatarKilled(player);
        if (!questVisit && !quest.isComplete(player)) return;
        // The helmet off takes the player out (tick 3679); after the quest too (Wiki, Arzinian Mine).
        if (!wearingHelmet(player)) {
          Mine.leave(player, { helmetOff: true });
          return;
        }
        if (!questVisit) return;
        // Ours: a warning box closed some other way than its continue starts the time as the continue would.
        if (!Mine.timing(player)) {
          if (player.getDialogueManager().isActive?.()) return;
          Mine.startTimer(player);
          player.getMovementQueue().setBlockMovement(false);
          return;
        }
        Mine.tickTimer(player);
      }

      /** However a visit ends (a teleport, a death), its time and Avatar end with it. */
      postLeave(mobile, logout) {
        if (mobile?.isPlayer?.()) {
          const player = mobile.getAsPlayer();
          Mine.stopTimer(player);
          removeAvatar(player);
        }
        super.postLeave?.(mobile, logout);
      }
    }
    return new DondakanMineArea([ARZINIAN_MINE_BOUNDS]);
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

  function showPickaxeBox({ player, interfaceId }) {
    if (interfaceId !== QUEST_SCROLL || !pickaxeBox.has(player)) return;
    pickaxeBox.delete(player);
    itemBoxes(player, [[RUNE_PICKAXE_ITEM, "Dondakan gives you a rune pickaxe."]]);
  }

  function grantReward(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.DEFENCE, 5000);
    skills.addExperiences(Skill.MINING, 5000);
    skills.addExperiences(Skill.SMITHING, 5000);
    if (hasSpace(player)) {
      addItem(player, RUNE_PICKAXE_ITEM, 1);
      pickaxeBox.add(player);
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

  // QH 06da90: 90 fights the Avatar, 100 returns to Dondakan; cache DB completes at 110.
  // Durable stage 100 already means the reward was paid, so old saves keep that meaning.
  function nativeProgress(stage, player) {
    stage |= 0;
    if (stage >= STAGE_COMPLETE) return 110;
    if (stage === STAGE_MINE && avatarKilled(player)) return 100;
    return stage;
  }

  quest = registerQuest(api, {
    key: "between_a_rock",
    name: "Between a Rock...",
    varpId: VARP_DWARFROCK,
    varbitId: VARBIT_STAGE,
    varbitValue: nativeProgress,
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

  const context = {
    get quest() { return quest; },
    stageOf,
    stages: { MINE: STAGE_MINE, ASSEMBLE: STAGE_ASSEMBLE },
    ids: { arzinianBeing: ARZINIAN_BEING, goldOre: GOLD_ORE_ITEM, goldHelmet: GOLD_HELMET_ITEM },
    schematicParts: [...SCHEMATIC_PART_IDS],
    hasItem,
    wearingHelmet,
    avatarKilled,
    removeAvatar,
    assembleSchematics,
    left: leftMine,
    transcriptSteps,
    format: (player, text) => formatPlayerText(String(text ?? ""), player),
    scenePlaying,
    Scenes: createQuestScenes(api, {}),
  };
  Scenes.attach(api, context);
  Schematics.attach(api, context);
  Mine.attach(api, context);

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcInteraction("Dondakan the Dwarf", { "Talk-to": talkDondakan });
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:condition", handleCondition);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("smithing:anvil-smith", smithAtAnvil);
  api.onCustomEvent("interface:closed", showPickaxeBox);
  api.onItemAction(handleItemAction);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemOnNpc(handleItemOnNpc);
  api.onObjectInteraction(handleObjectInteraction);
  api.onCustomEvent("mining:success", handleMiningSuccess);
  api.onNpcDeath(handleNpcDeath);
  api.onCustomEvent("npc-drops:context", handleDropContext);
  api.onPlayerLogin(handleLogin);
  api.onCustomEvent("player:bootstrap-complete", handleBootstrap);
  api.registerArea(createArzinianMineArea());
};
