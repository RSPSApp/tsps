/**
 * The Great Brain Robbery (members).
 *
 * The words come from the "The Great Brain Robbery" transcript page
 * (research pack /tmp/tsps-quest-dumps/GreatBrainRobbery.page.json); this plugin
 * supplies the variant selection for the quest NPCs, the prose-condition
 * answers, the missing map objects, the item/object interactions and the reward.
 *
 * Stages (varp 980 "brain_quest_var", confirmed with
 * `./node_modules/.bin/ts-node scripts/lookup-gameval.ts varp brain`):
 *   0 not started
 *   1 accepted; teleported to Harmony Island
 *   2 overheard Mi-Gor through the peephole
 *   3 reported back; sent for the book of prayers (back at Mos Le'Harmless)
 *   4 prayer book obtained
 *   5 back on Harmony in the gas; recite the prayer
 *   6 gas warded off
 *   7 sent to fetch Dr Fenkenstrain
 *   8 Dr Fenkenstrain told about Rufus
 *   9 Rufus arranged the meat shipment (crate parts + wolf whistle)
 *  10 crate built
 *  11 false bottom built
 *  12 crate filled with wooden cats
 *  13 shipping order received from Rufus
 *  14 shipping order used; the doctor is shipped to Harmony
 *  15 at Harmony; Dr Fenkenstrain lists the surgical equipment
 *  16 temple door blown open
 *  17 implements handed over; the operation is done
 *  18 told to deal with Mi-Gor (the monks can bless you)
 *  19 Barrelchest defeated
 *  20 complete
 *
 * Source: OSRS Wiki (https://oldschool.runescape.wiki/w/The_Great_Brain_Robbery
 * and the Transcript page).
 *
 * Gaps:
 * - the cache map has no placements for the quest statue (22352-22354), peephole
 *   (22097), broken/fixed stairs (22368/22369) or the crate hotspot (22457), nor
 *   for the tinderbox crate (29319); the plugin registers the first four at their
 *   wiki tiles on login (bring your own tinderbox, as the crate is not placed);
 * - crate building consumes fixed materials (6 parts + 20 nails; false bottom
 *   4 planks + 8 nails) instead of the wiki's bend rolls;
 * - Sorebones drops are deterministic (clamp, tongs, 3 bell jars, 30 staples);
 * - the Barrelchest fight is a normal owner-only spawn and the anchor drops where
 *   it dies;
 * - the cache maps the Harmony spawn 1955 (Dr Fenkenstrain) to a visible NPC only
 *   while varp 980 is 70-130, which this stage map does not use, so a visible
 *   Fenkenstrain (1269) is spawned per player at the mill basement from stage 15;
 * - the cache spawns 1953/1954/1964 (Brother Tranquility at Mos Le'Harmless,
 *   Harmony Island and the mill basement) resolve to null definitions at quest
 *   stages, so a visible 550 is spawned per player beside each;
 * - the holy symbol (1718) stands in for the wiki's "blessed symbol of Saradomin".
 */
module.exports = function registerGreatBrainRobberyQuest(api) {
  const {
    Equipment,
    GameObject,
    Item,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    ObjectIdentifiers,
    ObjectManager,
    RegionManager,
    Skill,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const PAGE = "The Great Brain Robbery";
  const START_HOOK = "quest:the-great-brain-robbery:start";

  // Chathead ids (the indexed transcript pages), used for every replay.
  const TRANQUILITY_CHAT_ID = NpcIdentifiers.BROTHER_TRANQUILITY; // 550
  const FENKENSTRAIN_CHAT_ID = NpcIdentifiers.DR_FENKENSTRAIN; // 1269
  const RUFUS_CHAT_ID = NpcIdentifiers.RUFUS_2; // 6478
  const MIGOR_CHAT_ID = NpcIdentifiers.MI_GOR; // 547
  const MONK_CHAT_ID = NpcIdentifiers.MONK; // 542

  // Spawned quest NPCs whose cache definitions are called "null", so no generated
  // identifier exists; confirmed against data/definitions/npc-spawns.json.
  const TRANQUILITY_MOS_NPC_ID = 1953; // Mos Le'Harmless dock
  const TRANQUILITY_HARMONY_NPC_ID = 1954; // Harmony Island windmill
  const TRANQUILITY_BASEMENT_NPC_ID = 1964; // Harmony Island mill basement
  const FENKENSTRAIN_HARMONY_NPC_ID = 1955; // Harmony Island mill basement

  const TRANQUILITY_NPC_IDS = new Set([
    NpcIdentifiers.BROTHER_TRANQUILITY,
    NpcIdentifiers.BROTHER_TRANQUILITY_2,
    NpcIdentifiers.BROTHER_TRANQUILITY_3,
    TRANQUILITY_MOS_NPC_ID,
    TRANQUILITY_HARMONY_NPC_ID,
    TRANQUILITY_BASEMENT_NPC_ID,
  ]);
  const RUFUS_NPC_IDS = new Set([NpcIdentifiers.RUFUS, RUFUS_CHAT_ID]);
  const FENKENSTRAIN_NPC_IDS = new Set([FENKENSTRAIN_CHAT_ID, FENKENSTRAIN_HARMONY_NPC_ID]);
  const MIGOR_NPC_IDS = new Set([MIGOR_CHAT_ID]);
  const MONK_NPC_IDS = new Set([
    NpcIdentifiers.MONK,
    NpcIdentifiers.MONK_2,
    NpcIdentifiers.MONK_3,
    NpcIdentifiers.MONK_4,
    NpcIdentifiers.ZOMBIE_MONK,
    NpcIdentifiers.ZOMBIE_MONK_2,
    NpcIdentifiers.ZOMBIE_MONK_3,
    NpcIdentifiers.ZOMBIE_MONK_4,
    1956, // Harmony mill spawns, cache name "null"
    1957,
    1958,
    1959,
  ]);
  const SOREBONES_NPC_IDS = new Set([NpcIdentifiers.SOREBONES, NpcIdentifiers.SOREBONES_2]);
  const BARRELCHEST_NPC_ID = NpcIdentifiers.BARRELCHEST; // 600

  const VARP_GREAT_BRAIN_ROBBERY = 980; // "brain_quest_var"

  const STAGE_STARTED = 1;
  const STAGE_SPIED = 2;
  const STAGE_REPORTED = 3;
  const STAGE_BOOK = 4;
  const STAGE_GAS = 5;
  const STAGE_WARDED = 6;
  const STAGE_DOCTOR_TASK = 7;
  const STAGE_DOCTOR_TOLD = 8;
  const STAGE_RUFUS = 9;
  const STAGE_CRATE_BUILT = 10;
  const STAGE_BOTTOM_BUILT = 11;
  const STAGE_CATS_FILLED = 12;
  const STAGE_ORDER = 13;
  const STAGE_DOCTOR_SENT = 14;
  const STAGE_LIST = 15;
  const STAGE_DOOR_BLOWN = 16;
  const STAGE_OPERATION = 17;
  const STAGE_BOSS = 18;
  const STAGE_BOSS_KILLED = 19;
  const STAGE_COMPLETE = 20;

  const FUSE_ITEM_ID = ItemIdentifiers.FUSE_2; // 10884
  const KEG_ITEM_ID = ItemIdentifiers.KEG; // 10885
  const PRAYER_BOOK_ITEM_ID = ItemIdentifiers.PRAYER_BOOK_2; // 10890 (Read/Recite-prayer)
  const WOODEN_CAT_ITEM_ID = ItemIdentifiers.WOODEN_CAT; // 10891
  const WOODEN_CAT_NOTED_ITEM_ID = ItemIdentifiers.WOODEN_CAT_2; // 10892
  const CRANIAL_CLAMP_ITEM_ID = ItemIdentifiers.CRANIAL_CLAMP; // 10893
  const BRAIN_TONGS_ITEM_ID = ItemIdentifiers.BRAIN_TONGS; // 10894
  const BELL_JAR_ITEM_ID = ItemIdentifiers.BELL_JAR; // 10895
  const WOLF_WHISTLE_ITEM_ID = ItemIdentifiers.WOLF_WHISTLE; // 10896
  const SHIPPING_ORDER_ITEM_ID = ItemIdentifiers.SHIPPING_ORDER; // 10897
  const CRATE_PART_ITEM_ID = ItemIdentifiers.CRATE_PART; // 10899
  const SKULL_STAPLE_ITEM_ID = ItemIdentifiers.SKULL_STAPLE; // 10904
  const BARRELCHEST_ANCHOR_ITEM_ID = ItemIdentifiers.BARRELCHEST_ANCHOR; // 10887
  const BLESSED_LAMP_ITEM_ID = ItemIdentifiers.BLESSED_LAMP; // 10889
  const HAMMER_ITEM_ID = ItemIdentifiers.HAMMER; // 2347
  const PLANK_ITEM_ID = ItemIdentifiers.PLANK; // 960
  const TINDERBOX_ITEM_ID = ItemIdentifiers.TINDERBOX; // 590
  const FISHBOWL_HELMET_ITEM_ID = ItemIdentifiers.FISHBOWL_HELMET; // 7534
  const DIVING_APPARATUS_ITEM_ID = ItemIdentifiers.DIVING_APPARATUS; // 7535
  const MEDALLION_OF_THE_DEEP_ITEM_ID = ItemIdentifiers.MEDALLION_OF_THE_DEEP;
  const HOLY_SYMBOL_ITEM_ID = ItemIdentifiers.HOLY_SYMBOL; // 1718
  const RING_OF_CHAROS_ITEM_ID = ItemIdentifiers.RING_OF_CHAROS; // 4202
  const RING_OF_CHAROS_A_ITEM_ID = ItemIdentifiers.RING_OF_CHAROS_A_; // 6465

  const NAIL_ITEM_IDS = [
    ItemIdentifiers.BRONZE_NAILS, // 4819
    ItemIdentifiers.IRON_NAILS, // 4820
    ItemIdentifiers.STEEL_NAILS, // 1539
    ItemIdentifiers.BLACK_NAILS, // 4821
    ItemIdentifiers.MITHRIL_NAILS, // 4822
    ItemIdentifiers.ADAMANTITE_NAILS, // 4823
    ItemIdentifiers.RUNE_NAILS, // 4824
  ];

  const STATUE_OBJECT_ID = ObjectIdentifiers.STATUE_76; // 22353, Pull
  const STATUE_PULLED_OBJECT_ID = ObjectIdentifiers.STATUE_77; // 22354, Climb-down
  const PEEPHOLE_OBJECT_ID = ObjectIdentifiers.PEEPHOLE; // 22097
  const LOCKER_OBJECT_ID = ObjectIdentifiers.LOCKER_5; // 22298, Open
  const LOCKER_SEARCHED_OBJECT_ID = ObjectIdentifiers.LOCKER_6; // 22299, Search
  const BROKEN_STAIRS_OBJECT_ID = ObjectIdentifiers.STAIRS_101; // 22368, Repair/Climb
  const FIXED_STAIRS_OBJECT_ID = ObjectIdentifiers.STAIRS_102; // 22369, Climb
  const CRATE_HOTSPOT_OBJECT_ID = ObjectIdentifiers.CRATE_202; // 22457, Build
  const CRATE_BOTTOMLESS_OBJECT_ID = ObjectIdentifiers.CRATE_198; // 22453, Add-bottom
  const CRATE_EMPTY_OBJECT_ID = ObjectIdentifiers.CRATE_199; // 22454, Fill
  const CRATE_FILLED_OBJECT_ID = ObjectIdentifiers.CRATE_200; // 22455
  const CRATE_CLOSED_OBJECT_ID = ObjectIdentifiers.CRATE_228; // 31943, Check
  const EDGEVILLE_BOOKCASE_OBJECT_ID = ObjectIdentifiers.BOOKCASE_4; // 380 at (3049,3483)
  const MONASTERY_ENTRANCE_OBJECT_ID = 22119; // Open; cache transforms on varbit 3393
  const VARBIT_MONASTERY_ENTRANCE = 3393;
  const MONASTERY_ENTRANCE_TILE = new Location(3805, 2844, 0);

  const CRATE_OBJECT_IDS = new Set([
    CRATE_HOTSPOT_OBJECT_ID,
    CRATE_BOTTOMLESS_OBJECT_ID,
    CRATE_EMPTY_OBJECT_ID,
    CRATE_FILLED_OBJECT_ID,
    CRATE_CLOSED_OBJECT_ID,
  ]);

  const STATUE_TILE = new Location(3796, 2845, 0);
  const PEEPHOLE_TILE = new Location(3817, 2844, 0);
  const BROKEN_STAIRS_TILE = new Location(3785, 9254, 0);
  const CRATE_TILE = new Location(3550, 3554, 2);
  const BOOKCASE_TILE = new Location(3049, 3483, 0);
  const TUNNEL_TILE = new Location(3786, 9254, 0);
  const SECRET_ROOM_TILE = new Location(3818, 2844, 0);
  const HARMONY_TILE = new Location(3788, 2830, 0);
  const MOS_TILE = new Location(3681, 2963, 0);
  const MIGOR_TILE = new Location(3819, 2844, 0);

  const MONASTERY_ZONE = { minX: 3808, maxX: 3832, minY: 2828, maxY: 2856, levels: [0] };
  const HARMONY_BASEMENT_ZONE = { minX: 3776, maxX: 3794, minY: 9218, maxY: 9232, levels: [0] };

  // The cache hides spawn 1955 (Harmony Dr Fenkenstrain) unless varp 980 is 70-130,
  // which our own stage map does not use, so a visible 1269 is spawned per player.
  const HARMONY_DOCTOR_TILE = new Location(3785, 9225, 0);
  // Cache spawns 1953/1954/1964 ("null" definitions with no options at quest stages)
  // are replaced by a visible 550 per player beside each, like the 1269 doctor.
  const TRANQUILITY_TILES = {
    tranquilityMos: new Location(3680, 2963, 0),
    tranquilityHarmony: new Location(3786, 2824, 0),
    tranquilityBasement: new Location(3787, 9224, 0),
  };
  // brain_multi_monk (varbit 3407): turns the mill zombie monks into cured monks.
  const BRAIN_MULTI_MONK_VARBIT = 3407;

  const ATTRIBUTE_PREFIX = "quest.great_brain_robbery";
  const PEEPHOLE_ATTRIBUTE = `${ATTRIBUTE_PREFIX}.peephole`;
  const BOOK_READ_ATTRIBUTE = `${ATTRIBUTE_PREFIX}.book-read`;
  const STAIRS_FIXED_ATTRIBUTE = `${ATTRIBUTE_PREFIX}.stairs-fixed`;
  const RUFUS_ATTRIBUTE = `${ATTRIBUTE_PREFIX}.rufus`;
  const DOCTOR_TOLD_ATTRIBUTE = `${ATTRIBUTE_PREFIX}.doctor-told`;
  const DOCTOR_LIST_ATTRIBUTE = `${ATTRIBUTE_PREFIX}.doctor-list`;
  const CATS_ATTRIBUTE = `${ATTRIBUTE_PREFIX}.cats`;
  const PENDING_LAMP_REWARD_ATTRIBUTE = "great-brain-robbery:pending-lamp-reward";

  const CAT_TARGET = 10;
  const CRATE_PART_COUNT = 6;
  const CRATE_NAILS = 20;
  const BOTTOM_PLANKS = 4;
  const BOTTOM_NAILS = 8;
  const STAIRS_PLANKS = 4;
  const STAIRS_NAILS = 10;
  const STAPLES_REQUIRED = 30;

  const SOREBONES_DROPS = [
    { id: CRANIAL_CLAMP_ITEM_ID, amount: 1 },
    { id: BRAIN_TONGS_ITEM_ID, amount: 1 },
    { id: BELL_JAR_ITEM_ID, amount: 3 },
    { id: SKULL_STAPLE_ITEM_ID, amount: STAPLES_REQUIRED },
  ];

  function nextSorebonesDrop(player) {
    return SOREBONES_DROPS.find((drop) => player.getInventory().getAmount(drop.id) < drop.amount) ?? null;
  }

  const QUEST_CHATHEADS = new Set([
    TRANQUILITY_CHAT_ID,
    NpcIdentifiers.BROTHER_TRANQUILITY_2,
    NpcIdentifiers.BROTHER_TRANQUILITY_3,
    FENKENSTRAIN_CHAT_ID,
    RUFUS_CHAT_ID,
    MIGOR_CHAT_ID,
    MONK_CHAT_ID,
  ]);

  const bookAction = new WeakMap();
  const stairsAction = new WeakMap();
  const fuseNearDoor = new WeakMap();
  const lampPending = new WeakMap();
  const XP_REWARD_INTERFACE_ID = 240;
  const npcsByPlayer = new Map();

  let quest;

  function flag(player, key) {
    return player.getAttribute(key) === true;
  }

  function setFlag(player, key) {
    player.setAttribute(key, true);
  }

  function held(player, itemId, amount = 1) {
    return player.getInventory().getAmount(itemId) >= amount;
  }

  function equipped(player, slot, itemId) {
    const item = player.getEquipment().get(slot);
    return item?.getId?.() === itemId;
  }

  function wearingDivingGear(player) {
    return (
      equipped(player, Equipment.HEAD_SLOT, FISHBOWL_HELMET_ITEM_ID) &&
      equipped(player, Equipment.CAPE_SLOT, DIVING_APPARATUS_ITEM_ID)
    );
  }

  function hasDivingGear(player) {
    return (
      wearingDivingGear(player) ||
      equipped(player, Equipment.AMULET_SLOT, MEDALLION_OF_THE_DEEP_ITEM_ID)
    );
  }

  function wearingFishbowlHelmet(player) {
    return equipped(player, Equipment.HEAD_SLOT, FISHBOWL_HELMET_ITEM_ID);
  }

  function wearingHolySymbol(player) {
    return equipped(player, Equipment.AMULET_SLOT, HOLY_SYMBOL_ITEM_ID);
  }

  function wearingCharos(player) {
    return (
      equipped(player, Equipment.RING_SLOT, RING_OF_CHAROS_ITEM_ID) ||
      equipped(player, Equipment.RING_SLOT, RING_OF_CHAROS_A_ITEM_ID)
    );
  }

  function isQuestComplete(player, key) {
    const request = { player, key, complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function isRescueComplete(player, rescue) {
    const request = { player, rescue, complete: false };
    api.emitCustomEvent("recipe-for-disaster:rescue-status", request);
    return request.complete === true;
  }

  function hasStartRequirements(player) {
    const skills = player.getSkillManager();
    return skills.getMaxLevel(Skill.CRAFTING) >= 16 &&
      skills.getMaxLevel(Skill.CONSTRUCTION) >= 30 &&
      skills.getMaxLevel(Skill.PRAYER) >= 50 &&
      isQuestComplete(player, "creature_of_fenkenstrain") &&
      isQuestComplete(player, "cabin_fever") &&
      isRescueComplete(player, "pirate-pete");
  }

  function totalNails(player) {
    return NAIL_ITEM_IDS.reduce((sum, id) => sum + player.getInventory().getAmount(id), 0);
  }

  function deleteNails(player, count) {
    let left = count;
    for (const id of NAIL_ITEM_IDS) {
      if (left <= 0) return;
      const take = Math.min(player.getInventory().getAmount(id), left);
      if (take > 0) {
        player.getInventory().deleteNumber(id, take);
        left -= take;
      }
    }
  }

  function giveItem(player, itemId, amount = 1) {
    const inventory = player.getInventory();
    if (inventory.getFreeSlots() <= 0 && inventory.getAmount(itemId) <= 0) {
      player.sendMessage("You do not have enough free inventory space.");
      return false;
    }
    inventory.adds(itemId, amount);
    return true;
  }

  function locationOf(value) {
    if (!value) return null;
    if (typeof value.getX === "function") {
      return new Location(value.getX(), value.getY(), value.getZ());
    }
    return new Location(value.x, value.y, value.z ?? 0);
  }

  function nearLocation(value, tile, radius) {
    const location = locationOf(value);
    if (!location) return false;
    return (
      Math.abs(location.getX() - tile.getX()) <= radius &&
      Math.abs(location.getY() - tile.getY()) <= radius &&
      location.getZ() === tile.getZ()
    );
  }

  function teleport(player, tile) {
    player.moveTo(new Location(tile.getX(), tile.getY(), tile.getZ()));
  }

  function objectAction(event) {
    const definition = event.definition ?? event.object?.getDefinition?.();
    const actions = definition?.getInteractions?.() ?? [];
    return String(actions[event.clickType - 1] ?? "");
  }

  function questObjectAt(player, tile, ids) {
    const objects = ObjectManager.objectsAt(tile) ?? [];
    return objects.find((candidate) => candidate.getOwner?.() === player && ids.has(candidate.getId?.()));
  }

  function cloneLocation(location) {
    return new Location(location.getX(), location.getY(), location.getZ());
  }

  function swapObjectAt(player, tile, expectedIds, newId, fallbackFace = 0) {
    const object = questObjectAt(player, tile, expectedIds);
    if (!object) return;
    ObjectManager.deregister(object, true);
    ObjectManager.register(
      new GameObject(newId, cloneLocation(object.getLocation()), object.getType?.() ?? 10, object.getFace?.() ?? fallbackFace, null).setOwner(player),
      true
    );
  }

  function removeObjectAt(player, tile, expectedIds) {
    const object = questObjectAt(player, tile, expectedIds);
    if (object) ObjectManager.deregister(object, true);
  }

  function swapObjectInstance(event, newId) {
    const object = event.object;
    if (!object) return;
    ObjectManager.deregister(object, true);
    ObjectManager.register(
      new GameObject(newId, cloneLocation(object.getLocation()), object.getType?.() ?? 10, object.getFace?.() ?? 0, null)
        .setOwner(object.getOwner?.() ?? event.player),
      true
    );
  }

  function catCount(player) {
    return Number(player.getAttribute(CATS_ATTRIBUTE)) || 0;
  }

  function canBuildCrate(player) {
    return held(player, HAMMER_ITEM_ID) && totalNails(player) >= CRATE_NAILS && held(player, CRATE_PART_ITEM_ID, CRATE_PART_COUNT);
  }

  function canBuildBottom(player) {
    return held(player, HAMMER_ITEM_ID) && totalNails(player) >= BOTTOM_NAILS && held(player, PLANK_ITEM_ID, BOTTOM_PLANKS);
  }

  function hasStairsMaterials(player) {
    return held(player, HAMMER_ITEM_ID) && totalNails(player) >= STAIRS_NAILS && held(player, PLANK_ITEM_ID, STAIRS_PLANKS);
  }

  function hasAllImplements(player) {
    return (
      held(player, CRANIAL_CLAMP_ITEM_ID) &&
      held(player, BRAIN_TONGS_ITEM_ID) &&
      held(player, BELL_JAR_ITEM_ID, 3) &&
      held(player, SKULL_STAPLE_ITEM_ID, STAPLES_REQUIRED) &&
      held(player, HAMMER_ITEM_ID)
    );
  }

  function consumeImplements(player) {
    player.getInventory().deleteNumber(CRANIAL_CLAMP_ITEM_ID, 1);
    player.getInventory().deleteNumber(BRAIN_TONGS_ITEM_ID, 1);
    player.getInventory().deleteNumber(BELL_JAR_ITEM_ID, 3);
    player.getInventory().deleteNumber(SKULL_STAPLE_ITEM_ID, STAPLES_REQUIRED);
    player.getInventory().deleteNumber(HAMMER_ITEM_ID, 1);
  }

  function selectCondition(steps, conditionId) {
    const step = steps.find((entry) => entry?.type === "condition" && entry.id === conditionId);
    return step ? [step] : steps;
  }

  /** The crate transform the saved stage implies; null once the shipment has left. */
  function crateObjectIdFor(player) {
    const stage = quest?.getStage(player) ?? 0;
    if (stage >= STAGE_DOCTOR_SENT) return null;
    if (stage >= STAGE_ORDER) return CRATE_CLOSED_OBJECT_ID;
    if (stage >= STAGE_CATS_FILLED) return CRATE_FILLED_OBJECT_ID;
    if (stage >= STAGE_BOTTOM_BUILT) return CRATE_EMPTY_OBJECT_ID;
    if (stage >= STAGE_CRATE_BUILT) return CRATE_BOTTOMLESS_OBJECT_ID;
    return CRATE_HOTSPOT_OBJECT_ID;
  }

  function replaceCrateObject(player, newId) {
    for (const object of ObjectManager.objectsAt(CRATE_TILE) ?? []) {
      if (object.getOwner?.() === player && CRATE_OBJECT_IDS.has(object.getId?.())) {
        ObjectManager.deregister(object, true);
      }
    }
    if (newId !== null) {
      ObjectManager.register(new GameObject(newId, CRATE_TILE, 10, 0, null).setOwner(player), true);
    }
  }

  /**
   * Restore the quest-only map objects. The crate/bottom/closed transforms are
   * session objects, so a relog at stage 10-13 must rebuild the right one from the
   * saved stage or the build/fill/order clicks land on the wrong transform.
   */
  function ensureQuestObjects(player) {
    const stage = player && quest ? quest.getStage(player) : 0;
    const pulled = stage >= STAGE_SPIED;
    const statueIds = new Set([STATUE_OBJECT_ID, STATUE_PULLED_OBJECT_ID]);
    const statue = questObjectAt(player, STATUE_TILE, statueIds);
    const wantedStatue = pulled ? STATUE_PULLED_OBJECT_ID : STATUE_OBJECT_ID;
    if (statue && statue.getId() !== wantedStatue) {
      swapObjectAt(player, STATUE_TILE, new Set([statue.getId()]), wantedStatue);
    } else if (!statue) {
      ObjectManager.register(new GameObject(wantedStatue, STATUE_TILE, 10, 0, null).setOwner(player), true);
    }
    if (!questObjectAt(player, PEEPHOLE_TILE, new Set([PEEPHOLE_OBJECT_ID]))) {
      ObjectManager.register(new GameObject(PEEPHOLE_OBJECT_ID, PEEPHOLE_TILE, 10, 0, null).setOwner(player), true);
    }
    const fixed = player ? flag(player, STAIRS_FIXED_ATTRIBUTE) : false;
    const stairsIds = new Set([BROKEN_STAIRS_OBJECT_ID, FIXED_STAIRS_OBJECT_ID]);
    const stairs = questObjectAt(player, BROKEN_STAIRS_TILE, stairsIds);
    const wantedStairs = fixed ? FIXED_STAIRS_OBJECT_ID : BROKEN_STAIRS_OBJECT_ID;
    if (stairs && stairs.getId() !== wantedStairs) {
      swapObjectAt(player, BROKEN_STAIRS_TILE, new Set([stairs.getId()]), wantedStairs);
    } else if (!stairs) {
      ObjectManager.register(new GameObject(wantedStairs, BROKEN_STAIRS_TILE, 10, 0, null).setOwner(player), true);
    }
    if (player && quest) {
      const wanted = crateObjectIdFor(player);
      const crate = questObjectAt(player, CRATE_TILE, CRATE_OBJECT_IDS);
      if ((crate?.getId() ?? null) !== wanted) replaceCrateObject(player, wanted);
    } else {
      replaceCrateObject(player, CRATE_HOTSPOT_OBJECT_ID);
    }
  }

  function ensureMiGor(player) {
    if (!quest || quest.getStage(player) !== STAGE_BOSS) return;
    const entry = npcsByPlayer.get(player) ?? {};
    if (!entry.migor && !entry.barrelchest) {
      entry.migor = api.spawnNpc({
        id: MIGOR_CHAT_ID,
        x: MIGOR_TILE.getX(),
        y: MIGOR_TILE.getY(),
        z: MIGOR_TILE.getZ(),
        owner: player,
        ownerOnly: true,
        wanderRadius: 0,
      });
    }
    npcsByPlayer.set(player, entry);
  }

  function ensureHarmonyDoctor(player) {
    if (!quest || quest.getStage(player) < STAGE_LIST) return;
    const entry = npcsByPlayer.get(player) ?? {};
    if (!entry.doctor) {
      entry.doctor = api.spawnNpc({
        id: FENKENSTRAIN_CHAT_ID,
        x: HARMONY_DOCTOR_TILE.getX(),
        y: HARMONY_DOCTOR_TILE.getY(),
        z: HARMONY_DOCTOR_TILE.getZ(),
        owner: player,
        ownerOnly: true,
        wanderRadius: 0,
      });
    }
    npcsByPlayer.set(player, entry);
  }

  /** Visible 550 copies beside the null cache spawns 1953/1954/1964, per player. */
  function ensureTranquility(player) {
    if (!quest) return;
    const entry = npcsByPlayer.get(player) ?? {};
    for (const [key, tile] of Object.entries(TRANQUILITY_TILES)) {
      if (entry[key]) continue;
      entry[key] = api.spawnNpc({
        id: TRANQUILITY_CHAT_ID,
        x: tile.getX(),
        y: tile.getY(),
        z: tile.getZ(),
        owner: player,
        ownerOnly: true,
        wanderRadius: 0,
      });
    }
    npcsByPlayer.set(player, entry);
  }

  function spawnBarrelchest(player) {
    const entry = npcsByPlayer.get(player) ?? {};
    if (!entry.barrelchest) {
      entry.barrelchest = api.spawnNpc({
        id: BARRELCHEST_NPC_ID,
        x: MIGOR_TILE.getX() + 1,
        y: MIGOR_TILE.getY(),
        z: MIGOR_TILE.getZ(),
        owner: player,
        ownerOnly: true,
        wanderRadius: 0,
      });
    }
    npcsByPlayer.set(player, entry);
  }

  function removeMiGor(player) {
    const entry = npcsByPlayer.get(player);
    if (entry?.migor) {
      api.removeNpc(entry.migor);
      delete entry.migor;
    }
  }

  function clearNpcs(player) {
    const entry = npcsByPlayer.get(player);
    if (!entry) return;
    for (const npc of Object.values(entry)) api.removeNpc(npc);
    npcsByPlayer.delete(player);
  }

  // ==========================================================================
  // NPCs
  // ==========================================================================

  /**
   * The post-quest "Yes, please." is a wiki {{tact|above}} jump, which a direct
   * startTranscript cannot resolve; surface it as the action the handler runs.
   */
  function resolvePostQuestTransport(steps) {
    return steps.map((step) => {
      if (step.type !== "choice" || !step.options) return step;
      return {
        ...step,
        options: step.options.map((option) => {
          const transport = (option.steps ?? []).find((entry) => entry.id === "F6MVz8");
          return transport
            ? { ...option, steps: [{ type: "action", action: "teleport", id: transport.id, text: "The player is teleported back to Mos Le'Harmless." }] }
            : option;
        }),
      };
    });
  }

  function talkToTranquility(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE && flag(player, PENDING_LAMP_REWARD_ATTRIBUTE)) {
      const inventory = player.getInventory();
      if (inventory.getFreeSlots() > 0 && inventory.adds(BLESSED_LAMP_ITEM_ID, 1)) {
        player.setAttribute(PENDING_LAMP_REWARD_ATTRIBUTE, false);
      }
    }
    let variant;
    if (stage >= STAGE_COMPLETE) {
      variant = "post-quest-dialogue-talking-to-brother-tranquility";
    } else if (stage >= STAGE_BOSS_KILLED) {
      variant = "talking-to-brother-tranquility";
      quest.complete(player);
    } else if (stage >= STAGE_OPERATION) {
      if (stage === STAGE_OPERATION) quest.setStage(player, STAGE_BOSS);
      variant = "giving-brother-tranquility-the-good-news";
    } else if (stage >= STAGE_LIST) {
      variant = "talking-to-brother-tranquility-at-harmony-island";
    } else if (stage >= STAGE_DOCTOR_SENT) {
      variant = "talking-to-brother-tranquility-at-mos-le-harmless";
    } else if (stage >= STAGE_DOCTOR_TASK) {
      variant = "at-harmony-island-cursed-with-poison-gas-talking-to-brother-tranquility-after-reciting-the-prayer-talking-to-brother-tranquility-again";
    } else if (stage === STAGE_WARDED) {
      variant = "at-harmony-island-cursed-with-poison-gas-talking-to-brother-tranquility-after-reciting-the-prayer";
    } else if (stage === STAGE_GAS) {
      variant = "at-harmony-island-cursed-with-poison-gas-talking-to-brother-tranquility";
    } else if (stage >= STAGE_REPORTED) {
      variant = "reporting-back-to-brother-tranquility-talking-to-brother-tranquility-at-mos-le-harmless";
    } else if (stage >= STAGE_SPIED) {
      variant = "reporting-back-to-brother-tranquility";
    } else if (stage >= STAGE_STARTED) {
      variant = "starting-off-talking-to-brother-tranquility-again-after-being-teleported-to-harmony-island";
    } else {
      variant = "starting-off";
    }
    startTranscript(api, player, TRANQUILITY_CHAT_ID, PAGE, variant, stage >= STAGE_COMPLETE ? resolvePostQuestTransport : undefined);
  }

  function talkToRufus(player) {
    const stage = quest.getStage(player);
    // The shipping order is droppable; the pinned helper notes Rufus replaces a
    // lost one, so hand it back before the "again" conversation.
    if (stage >= STAGE_ORDER && stage < STAGE_DOCTOR_SENT && !held(player, SHIPPING_ORDER_ITEM_ID)) {
      giveItem(player, SHIPPING_ORDER_ITEM_ID, 1);
    }
    const variant =
      stage >= STAGE_CRATE_BUILT ? "talking-to-rufus-talking-to-rufus-again" : "talking-to-rufus";
    startTranscript(api, player, RUFUS_CHAT_ID, PAGE, variant);
  }

  function talkToFenkenstrainAtHarmony(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      startTranscript(api, player, FENKENSTRAIN_CHAT_ID, PAGE, "post-quest-dialogue-talking-to-dr-fenkenstrain");
      return;
    }
    if (stage >= STAGE_OPERATION) {
      startTranscript(api, player, FENKENSTRAIN_CHAT_ID, PAGE, "retrieving-the-items-for-dr-fenkenstrain-talking-to-dr-fenkenstrain-again");
      return;
    }
    if (hasAllImplements(player)) {
      startTranscript(api, player, FENKENSTRAIN_CHAT_ID, PAGE, "retrieving-the-items-for-dr-fenkenstrain-retrieving-the-items-for-dr-fenkenstrain-checking-the-requirements");
      return;
    }
    if (!flag(player, DOCTOR_LIST_ATTRIBUTE)) {
      setFlag(player, DOCTOR_LIST_ATTRIBUTE);
      startTranscript(api, player, FENKENSTRAIN_CHAT_ID, PAGE, "talking-to-dr-fenkenstrain-at-harmony-island");
      return;
    }
    startTranscript(api, player, FENKENSTRAIN_CHAT_ID, PAGE, "talking-to-dr-fenkenstrain-at-harmony-island-talking-to-dr-fenkenstrain-again");
  }

  function talkToFenkenstrainAtCastle(player) {
    const stage = quest.getStage(player);
    if (!flag(player, DOCTOR_TOLD_ATTRIBUTE)) {
      setFlag(player, DOCTOR_TOLD_ATTRIBUTE);
      if (stage < STAGE_DOCTOR_TOLD) quest.setStage(player, STAGE_DOCTOR_TOLD);
      startTranscript(api, player, FENKENSTRAIN_CHAT_ID, PAGE, "talking-to-dr-fenkenstrain");
      return;
    }
    if (stage <= STAGE_RUFUS) {
      startTranscript(api, player, FENKENSTRAIN_CHAT_ID, PAGE, "talking-to-rufus-talking-to-dr-fenkenstrain-before-building-the-crate");
      return;
    }
    if (stage === STAGE_CRATE_BUILT) {
      startTranscript(api, player, FENKENSTRAIN_CHAT_ID, PAGE, "building-the-crate-talking-to-dr-fenkenstrain-before-building-the-false-bottom");
      return;
    }
    if (stage === STAGE_BOTTOM_BUILT) {
      startTranscript(api, player, FENKENSTRAIN_CHAT_ID, PAGE, "building-the-crate-building-the-false-bottom-talking-to-dr-fenkenstrain-after-building-the-false-bottom");
      return;
    }
    startTranscript(api, player, FENKENSTRAIN_CHAT_ID, PAGE, "building-the-crate-storing-the-mechanical-cats-talking-to-dr-fenkenstrain-after-filling-up-the-crate-with-mechanical-cats");
  }

  function talkToMonk(player, event) {
    const stage = quest.getStage(player);
    if (stage < STAGE_BOSS || stage > STAGE_BOSS_KILLED) return false;
    event.handled = true;
    const skills = player.getSkillManager();
    const full = skills.getCurrentLevel(Skill.PRAYER) >= skills.getMaxLevel(Skill.PRAYER);
    startTranscript(
      api,
      player,
      MONK_CHAT_ID,
      PAGE,
      full ? "talking-to-the-cured-monks-with-full-prayer-points" : "talking-to-the-cured-monks-with-partial-prayer-points"
    );
    return true;
  }

  function handleNpcInteraction(event) {
    const { player, npcId } = event;
    const action = String(event.definition?.getActions?.()?.[event.clickType - 1] ?? "");
    if (MIGOR_NPC_IDS.has(npcId)) {
      if (action !== "Confront" && action !== "Talk-to") return;
      if (quest.getStage(player) !== STAGE_BOSS) return;
      event.handled = true;
      startTranscript(api, player, MIGOR_CHAT_ID, PAGE, "confronting-mi-gor");
      return;
    }
    if (action !== "Talk-to") return;
    if (TRANQUILITY_NPC_IDS.has(npcId)) {
      event.handled = true;
      talkToTranquility(player);
      return;
    }
    if (RUFUS_NPC_IDS.has(npcId)) {
      if (quest.getStage(player) < STAGE_DOCTOR_TASK) return;
      event.handled = true;
      talkToRufus(player);
      return;
    }
    if (FENKENSTRAIN_NPC_IDS.has(npcId)) {
      if (nearLocation(event.location, HARMONY_DOCTOR_TILE, 12)) {
        if (quest.getStage(player) < STAGE_LIST) return;
        event.handled = true;
        talkToFenkenstrainAtHarmony(player);
        return;
      }
      if (quest.getStage(player) < STAGE_DOCTOR_TASK) return;
      event.handled = true;
      talkToFenkenstrainAtCastle(player);
      return;
    }
    if (MONK_NPC_IDS.has(npcId)) {
      talkToMonk(player, event);
    }
  }

  function handleNpcDeath(event) {
    const player = event.killer?.isPlayer?.() ? event.killer : null;
    if (event.npcId === BARRELCHEST_NPC_ID) {
      const entry = player ? npcsByPlayer.get(player) : null;
      if (entry?.barrelchest) delete entry.barrelchest;
      if (!player) return;
      if (quest.getStage(player) === STAGE_BOSS) {
        quest.setStage(player, STAGE_BOSS_KILLED);
        player.sendMessage("The Barrelchest has dropped its anchor! If you could get it fixed, then it would make a formidable weapon...");
      }
      if (event.location) {
        api
          .getItemOnGroundManager()
          .registerLocation(player, new Item(BARRELCHEST_ANCHOR_ITEM_ID, 1), locationOf(event.location));
      }
      return;
    }
    if (!SOREBONES_NPC_IDS.has(event.npcId) || !player || !event.location) return;
    if (quest.getStage(player) !== STAGE_DOOR_BLOWN) return;
    // Each new kill targets the first missing implement. If the last drop was
    // left on the floor, the next kill duplicates it as the Wiki walkthrough warns.
    const drop = nextSorebonesDrop(player);
    if (!drop) return;
    api
      .getItemOnGroundManager()
      .registerLocation(player, new Item(drop.id, drop.amount), locationOf(event.location));
  }

  // ==========================================================================
  // Objects and items
  // ==========================================================================

  function pullStatue(event) {
    event.handled = true;
    const player = event.player;
    if (!quest.isStarted(player) || quest.isComplete(player)) return;
    swapObjectAt(player, STATUE_TILE, new Set([STATUE_OBJECT_ID]), STATUE_PULLED_OBJECT_ID);
    startTranscript(
      api,
      player,
      TRANQUILITY_CHAT_ID,
      PAGE,
      "starting-off-exploring-the-island-before-investigating-the-statue-pulling-the-saradomin-statue",
      (steps) => steps.slice(0, 2)
    );
  }

  function climbDownStatue(event) {
    event.handled = true;
    const player = event.player;
    if (!quest.isStarted(player) || quest.isComplete(player)) return;
    const gear = hasDivingGear(player);
    startTranscript(
      api,
      player,
      TRANQUILITY_CHAT_ID,
      PAGE,
      "starting-off-exploring-the-island-before-investigating-the-statue-pulling-the-saradomin-statue",
      (steps) => selectCondition(steps, gear ? "STglHL" : "znLFz8")
    );
    if (gear) teleport(player, TUNNEL_TILE);
  }

  function peerThroughPeephole(event) {
    event.handled = true;
    const player = event.player;
    if (!quest.isStarted(player) || quest.isComplete(player)) {
      player.sendMessage("You do not think there will be anything interesting to see through that.");
      return;
    }
    startTranscript(
      api,
      player,
      TRANQUILITY_CHAT_ID,
      PAGE,
      "starting-off-sneaking-past-the-tunnel-into-the-library",
      (steps) => selectCondition(steps, flag(player, PEEPHOLE_ATTRIBUTE) ? "v0Tj_f" : "MRxv-w")
    );
  }

  function handleBrokenStairs(event, action) {
    if (action !== "Repair" && action !== "Climb") return;
    event.handled = true;
    const player = event.player;
    if (!quest.isStarted(player) || quest.isComplete(player)) return;
    stairsAction.set(player, action === "Repair" ? "repair" : "climb");
    startTranscript(
      api,
      player,
      TRANQUILITY_CHAT_ID,
      PAGE,
      "starting-off-exploring-the-island-before-investigating-the-statue-interacting-with-the-stairs-while-underwater"
    );
  }

  function climbFixedStairs(event) {
    event.handled = true;
    const player = event.player;
    if (!quest.isStarted(player) || quest.isComplete(player)) return;
    teleport(player, SECRET_ROOM_TILE);
  }

  /**
   * The cache names 22368/22369 "Stairs", so Ladders' named hook claims the click
   * before the generic object hook. Claim the quest flow through ladders:climb
   * (the request carries the object, not its definition).
   */
  function claimStairsClimb(request) {
    if (request.objectId === BROKEN_STAIRS_OBJECT_ID) {
      handleBrokenStairs(request, objectAction(request));
      return;
    }
    if (request.objectId === FIXED_STAIRS_OBJECT_ID && objectAction(request) === "Climb") {
      climbFixedStairs(request);
    }
  }

  function openLocker(event) {
    event.handled = true;
    swapObjectInstance(event, LOCKER_SEARCHED_OBJECT_ID);
  }

  function closeLocker(event) {
    event.handled = true;
    swapObjectInstance(event, LOCKER_OBJECT_ID);
  }

  function searchLocker(event) {
    event.handled = true;
    const player = event.player;
    if (quest.getStage(player) < STAGE_LIST || quest.isComplete(player)) {
      player.sendMessage("You do not need some fuse from there right now.");
      return;
    }
    startTranscript(api, player, FENKENSTRAIN_CHAT_ID, PAGE, "retrieving-the-items-for-dr-fenkenstrain-zombie-ship-taking-the-fuse");
  }

  /**
   * The locker sits in the ship's hull with only its own tile and the tile to the
   * east walkable, so the generic approach lands on the object itself. Route the
   * click to the nearest free adjacent tile instead.
   */
  function routeLocker(event) {
    if (event.objectId !== LOCKER_OBJECT_ID && event.objectId !== LOCKER_SEARCHED_OBJECT_ID) return;
    const tile = event.object?.getLocation?.();
    if (!tile) return;
    const position = event.player.getLocation();
    const privateArea = event.player.getPrivateArea?.() ?? null;
    let best = null;
    for (const [x, y] of [
      [tile.getX() + 1, tile.getY()],
      [tile.getX() - 1, tile.getY()],
      [tile.getX(), tile.getY() + 1],
      [tile.getX(), tile.getY() - 1],
    ]) {
      const stand = new Location(x, y, tile.getZ());
      if (RegionManager.blocked(stand, privateArea)) continue;
      const distance = Math.max(Math.abs(x - position.getX()), Math.abs(y - position.getY()));
      if (!best || distance < best.distance) best = { x, y, distance };
    }
    if (!best) return;
    event.destination = { x: best.x, y: best.y, z: tile.getZ() };
  }

  function searchBookcase(event) {
    if (!nearLocation(event.location, BOOKCASE_TILE, 2)) return;
    event.handled = true;
    const player = event.player;
    if (quest.getStage(player) < STAGE_REPORTED || quest.isComplete(player)) {
      player.sendMessage("You search the books...");
      player.sendMessage("You find nothing to interest you.");
      return;
    }
    startTranscript(api, player, TRANQUILITY_CHAT_ID, PAGE, "finding-the-book-of-prayers");
  }

  /**
   * The "building-the-crate" variant lists V6O5Wk and CfTdWV as sibling conditions;
   * NpcDialogues.flatten picks the first true one (V6O5Wk) and its branch does not
   * continue, so the CfTdWV effect (consume 6 parts + 20 nails, swap the crate, set
   * stage 10) never runs. Build the crate here and splice the finished branch in.
   */
  function buildCrate(event) {
    event.handled = true;
    const player = event.player;
    if (quest.getStage(player) < STAGE_RUFUS || quest.isComplete(player)) return;
    const built = canBuildCrate(player);
    if (built) {
      player.getInventory().deleteNumber(CRATE_PART_ITEM_ID, CRATE_PART_COUNT);
      deleteNails(player, CRATE_NAILS);
      player.setAttribute(CATS_ATTRIBUTE, 0);
      swapObjectAt(player, CRATE_TILE, new Set([CRATE_HOTSPOT_OBJECT_ID]), CRATE_BOTTOMLESS_OBJECT_ID);
      if (quest.getStage(player) < STAGE_CRATE_BUILT) quest.setStage(player, STAGE_CRATE_BUILT);
    }
    startTranscript(api, player, FENKENSTRAIN_CHAT_ID, PAGE, "building-the-crate", (steps) => {
      if (!built) return steps;
      const started = steps.find((step) => step.id === "V6O5Wk");
      const finished = steps.find((step) => step.id === "CfTdWV");
      return [...(started?.steps ?? []), ...(finished?.steps ?? [])];
    });
  }

  function buildFalseBottom(event) {
    event.handled = true;
    const player = event.player;
    if (quest.getStage(player) !== STAGE_CRATE_BUILT) return;
    startTranscript(api, player, FENKENSTRAIN_CHAT_ID, PAGE, "building-the-crate-building-the-false-bottom");
  }

  function handleObjectInteraction(event) {
    const { objectId } = event;
    if (objectId === STATUE_OBJECT_ID) {
      if (objectAction(event) === "Pull") pullStatue(event);
      return;
    }
    if (objectId === STATUE_PULLED_OBJECT_ID) {
      if (objectAction(event) === "Climb-down") climbDownStatue(event);
      return;
    }
    if (objectId === PEEPHOLE_OBJECT_ID) {
      if (objectAction(event) === "Peer-through") peerThroughPeephole(event);
      return;
    }
    if (objectId === BROKEN_STAIRS_OBJECT_ID) {
      handleBrokenStairs(event, objectAction(event));
      return;
    }
    if (objectId === FIXED_STAIRS_OBJECT_ID) {
      if (objectAction(event) === "Climb") climbFixedStairs(event);
      return;
    }
    if (objectId === LOCKER_OBJECT_ID) {
      if (objectAction(event) === "Open") openLocker(event);
      return;
    }
    if (objectId === LOCKER_SEARCHED_OBJECT_ID) {
      const action = objectAction(event);
      if (action === "Search") searchLocker(event);
      else if (action === "Close") closeLocker(event);
      return;
    }
    if (objectId === EDGEVILLE_BOOKCASE_OBJECT_ID) {
      if (objectAction(event) === "Search") searchBookcase(event);
      return;
    }
    if (objectId === CRATE_HOTSPOT_OBJECT_ID) {
      if (objectAction(event) === "Build") buildCrate(event);
      return;
    }
    if (objectId === CRATE_BOTTOMLESS_OBJECT_ID) {
      if (objectAction(event) === "Add-bottom") buildFalseBottom(event);
    }
  }

  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (
      itemId === SHIPPING_ORDER_ITEM_ID &&
      (objectId === CRATE_FILLED_OBJECT_ID || objectId === CRATE_CLOSED_OBJECT_ID)
    ) {
      event.handled = true;
      if (quest.getStage(player) !== STAGE_ORDER) return;
      startTranscript(
        api,
        player,
        FENKENSTRAIN_CHAT_ID,
        PAGE,
        "smuggling-dr-fenkenstrain-out-of-the-castle-sending-dr-fenkenstrain-to-harmony-island"
      );
      return;
    }
    if (
      (itemId === WOODEN_CAT_ITEM_ID || itemId === WOODEN_CAT_NOTED_ITEM_ID) &&
      objectId === CRATE_EMPTY_OBJECT_ID
    ) {
      event.handled = true;
      if (quest.getStage(player) !== STAGE_BOTTOM_BUILT) return;
      player.getInventory().deleteNumber(itemId, 1);
      player.setAttribute(CATS_ATTRIBUTE, catCount(player) + 1);
      startTranscript(
        api,
        player,
        FENKENSTRAIN_CHAT_ID,
        PAGE,
        "building-the-crate-storing-the-mechanical-cats"
      );
      return;
    }
    if (CRATE_OBJECT_IDS.has(objectId)) {
      if (quest.getStage(player) < STAGE_RUFUS) return;
      event.handled = true;
      player.sendMessage("Nothing interesting happens.");
    }
  }

  function handleItemOnItem(event) {
    const ids = [event.usedItemId, event.usedWithItemId];
    if (!ids.includes(FUSE_ITEM_ID) || !ids.includes(KEG_ITEM_ID)) return;
    event.handled = true;
    const player = event.player;
    if (quest.getStage(player) < STAGE_LIST || quest.getStage(player) > STAGE_DOOR_BLOWN) return;
    fuseNearDoor.set(player, nearLocation(player.getLocation(), MONASTERY_ENTRANCE_TILE, 1));
    startTranscript(
      api,
      player,
      FENKENSTRAIN_CHAT_ID,
      PAGE,
      "retrieving-the-items-for-dr-fenkenstrain-lighting-the-fuse"
    );
  }

  function handleGroundItemPickup(event) {
    const { player, groundItemId } = event;
    if (groundItemId !== KEG_ITEM_ID) return;
    if (quest.getStage(player) < STAGE_LIST || quest.isComplete(player)) return;
    event.handled = true;
    if (held(player, KEG_ITEM_ID)) {
      player.sendMessage("You already have a barrel of gunpowder. You do not need another.");
      return;
    }
    if (player.getInventory().getFreeSlots() < 1) {
      player.sendMessage("You do not have enough free inventory space to take that.");
      return;
    }
    startTranscript(
      api,
      player,
      FENKENSTRAIN_CHAT_ID,
      PAGE,
      "retrieving-the-items-for-dr-fenkenstrain-zombie-ship-taking-the-keg-of-gunpowder"
    );
  }

  function readPrayerBook(event) {
    const player = event.player;
    if (event.itemId !== PRAYER_BOOK_ITEM_ID) return false;
    bookAction.set(player, "read");
    setFlag(player, BOOK_READ_ATTRIBUTE);
    startTranscript(
      api,
      player,
      TRANQUILITY_CHAT_ID,
      PAGE,
      "finding-the-book-of-prayers-interacting-with-the-book-of-prayers",
      (steps) => selectCondition(steps, "HDXjv4")
    );
    return true;
  }

  function recitePrayerBook(event) {
    const player = event.player;
    if (event.itemId !== PRAYER_BOOK_ITEM_ID) return false;
    if (!flag(player, BOOK_READ_ATTRIBUTE)) {
      bookAction.set(player, "recite");
      startTranscript(
        api,
        player,
        TRANQUILITY_CHAT_ID,
        PAGE,
        "finding-the-book-of-prayers-interacting-with-the-book-of-prayers",
        (steps) => selectCondition(steps, "hP9pnH")
      );
      return true;
    }
    if (quest.getStage(player) === STAGE_GAS) {
      startTranscript(
        api,
        player,
        TRANQUILITY_CHAT_ID,
        PAGE,
        "at-harmony-island-cursed-with-poison-gas-talking-to-brother-tranquility",
        (steps) => selectCondition(steps, wearingHolySymbol(player) ? "x-JYH8" : "5Kh-Fz")
      );
      return true;
    }
    bookAction.set(player, "recite");
    startTranscript(
      api,
      player,
      TRANQUILITY_CHAT_ID,
      PAGE,
      "finding-the-book-of-prayers-interacting-with-the-book-of-prayers",
      (steps) => selectCondition(steps, wearingHolySymbol(player) ? "5a53gY" : "Geotyj")
    );
    return true;
  }

  function blowWolfWhistle(event) {
    const player = event.player;
    if (event.itemId !== WOLF_WHISTLE_ITEM_ID) return false;
    if (quest.getStage(player) !== STAGE_CATS_FILLED) return false;
    startTranscript(
      api,
      player,
      RUFUS_CHAT_ID,
      PAGE,
      "smuggling-dr-fenkenstrain-out-of-the-castle-summoning-rufus"
    );
    return true;
  }

  /** The blessed lamp's cache action is "Pray-over"; the reward is 5,000 XP (min level 30). */
  function prayOverLamp(event) {
    if (event.itemId !== BLESSED_LAMP_ITEM_ID) return false;
    const { player, item, slot } = event;
    if (!held(player, BLESSED_LAMP_ITEM_ID)) return false;
    if (lampPending.get(player)?.item === item) return false;
    lampPending.set(player, { item, slot });
    api.emitCustomEvent("xpreward:open", {
      player,
      minLevel: 30,
      title: "Choose the stat you wish to be advanced!",
      onConfirm: (skill, name) => confirmLamp(player, item, slot, skill, name),
    });
    return true;
  }

  function confirmLamp(player, item, slot, skill, name) {
    if (lampPending.get(player)?.item !== item) return null;
    lampPending.delete(player);
    const inventory = player.getInventory();
    if (inventory.get(slot) !== item) return null;
    const skills = player.getSkillManager();
    const before = skills.getExperience(skill);
    skills.addExperience(skill, 5000, false);
    if (skills.getExperience(skill) === before) return null;
    inventory.deleteAtSlot(slot, 1);
    return `<col=0000ff>Your wish has been granted!</col> You have been awarded 5,000 ${name ?? skill.getName()} experience!`;
  }

  function cancelLampChoice({ player, interfaceId }) {
    if (interfaceId === XP_REWARD_INTERFACE_ID) lampPending.delete(player);
  }

  function handleDoorToggle(request) {
    if (request.objectId !== MONASTERY_ENTRANCE_OBJECT_ID) return;
    if (!nearLocation(request.location, MONASTERY_ENTRANCE_TILE, 1)) return;
    const player = request.player;
    if (!player || !quest.isStarted(player) || quest.isComplete(player)) return;
    if (quest.getStage(player) >= STAGE_DOOR_BLOWN) return;
    request.handled = true;
    player.sendMessage("You cannot go in there now; it would probably give away the monks' plan.");
  }

  // ==========================================================================
  // Transcript conditions, hooks and actions
  // ==========================================================================

  const CONDITION_ANSWERS = new Map([
    ["zsGywr", (player) => !hasStartRequirements(player)],
    ["jfYyLX", hasStartRequirements],
    ["STglHL", (player) => hasDivingGear(player)],
    ["0wZEHp", (player) => !hasDivingGear(player)],
    ["znLFz8", (player) => !hasDivingGear(player)],
    ["ZTi5gG", (player) => hasDivingGear(player)],
    ["k9SY56", (player) => stairsAction.get(player) === "repair" && !hasStairsMaterials(player)],
    ["lwrLNw", (player) => stairsAction.get(player) === "climb" && !flag(player, STAIRS_FIXED_ATTRIBUTE)],
    ["ifiDXn", (player) => stairsAction.get(player) === "repair" && hasStairsMaterials(player)],
    ["dhS1ko", () => false],
    ["MRxv-w", (player) => !flag(player, PEEPHOLE_ATTRIBUTE)],
    ["v0Tj_f", (player) => flag(player, PEEPHOLE_ATTRIBUTE)],
    ["lIgCfE", () => false],
    ["xbT4_u", (player) => !held(player, PRAYER_BOOK_ITEM_ID)],
    ["KgNSpr", (player) => held(player, PRAYER_BOOK_ITEM_ID)],
    ["2NXPy8", (player) => !held(player, PRAYER_BOOK_ITEM_ID)],
    ["ozy2bM", () => false],
    ["Dd20UD", (player) => held(player, PRAYER_BOOK_ITEM_ID)],
    ["pQtKI-", (player) => !flag(player, BOOK_READ_ATTRIBUTE)],
    ["2fPj_D", (player) => flag(player, BOOK_READ_ATTRIBUTE)],
    ["nxxcZ1", (player) => !wearingHolySymbol(player)],
    ["XVf9lp", (player) => wearingHolySymbol(player)],
    ["hP9pnH", (player) => !flag(player, BOOK_READ_ATTRIBUTE)],
    ["HDXjv4", (player) => bookAction.get(player) === "read"],
    ["Geotyj", (player) => bookAction.get(player) === "recite" && !wearingHolySymbol(player)],
    ["5a53gY", (player) => bookAction.get(player) === "recite" && wearingHolySymbol(player)],
    ["LWjR89", () => true],
    ["gyOFgt", () => false],
    ["Dd9_bz", (player) => player.getSkillManager().getCurrentLevel(Skill.PRAYER) <= 0],
    ["1JqdZv", (player) => player.getSkillManager().getCurrentLevel(Skill.PRAYER) > 0],
    ["5Kh-Fz", (player) => !wearingHolySymbol(player)],
    ["x-JYH8", (player) => wearingHolySymbol(player)],
    ["66qPLS", (player) => !wearingCharos(player)],
    ["K5nAIL", (player) => wearingCharos(player)],
    ["ahKuot", (player) => player.getInventory().getFreeSlots() < 1],
    ["VqdO2N", (player) => player.getInventory().getFreeSlots() >= 1],
    ["jEEuzO", (player) => player.getInventory().getFreeSlots() < 1],
    ["zAYiRc", (player) => player.getInventory().getFreeSlots() >= 1],
    ["n0yk8i", (player) => !held(player, WOLF_WHISTLE_ITEM_ID)],
    ["K70N9u", (player) => player.getInventory().getFreeSlots() < 1],
    ["qNgtxQ", (player) => player.getInventory().getFreeSlots() >= 1],
    ["nN85zm", (player) => !held(player, CRATE_PART_ITEM_ID)],
    ["9ilwOr", (player) => player.getInventory().getFreeSlots() < 1],
    ["tEPhpt", (player) => player.getInventory().getFreeSlots() >= 1],
    ["iOHuTD", (player) => !flag(player, RUFUS_ATTRIBUTE)],
    ["gG96j4", (player) => flag(player, RUFUS_ATTRIBUTE)],
    ["GeClIU", (player) => !canBuildCrate(player)],
    ["V6O5Wk", (player) => canBuildCrate(player)],
    ["TQ_hIy", () => false],
    ["CfTdWV", () => true],
    ["thuAxc", (player) => !canBuildBottom(player)],
    ["7p4CMa", (player) => canBuildBottom(player)],
    ["_NgwsM", () => false],
    ["VDkh8H", () => true],
    ["Olp2wC", () => false],
    ["YSxZaM", (player) => catCount(player) < CAT_TARGET],
    ["1WI7yE", (player) => catCount(player) >= CAT_TARGET],
    ["luP6Sa", (player) => wearingFishbowlHelmet(player)],
    ["FbFkPO", (player) => !wearingCharos(player)],
    ["rUSl3k", (player) => wearingCharos(player) && !wearingFishbowlHelmet(player)],
    ["yHzx5k", () => true],
    ["YR9f06", () => true],
    ["UWnXBQ", (player) => held(player, FUSE_ITEM_ID)],
    ["oqr6vd", (player) => player.getInventory().getFreeSlots() < 1],
    ["zfNp3_", (player) => player.getInventory().getFreeSlots() >= 1],
    ["7Ork37", () => true],
    ["jaDawz", (player) => held(player, KEG_ITEM_ID)],
    ["Ic7we3", (player) => player.getInventory().getFreeSlots() < 1],
    ["NlnahY", (player) => player.getInventory().getFreeSlots() >= 1],
    ["-sgLFX", () => false],
    ["Tuzetx", () => false],
    ["tX9fK6", (player) => !fuseNearDoor.get(player)],
    ["CnQmqi", (player) => !held(player, TINDERBOX_ITEM_ID)],
    ["QgHr_7", (player) => held(player, TINDERBOX_ITEM_ID)],
    ["-6aApd", () => false],
    ["6j_tbb", () => true],
    ["kKgbe0", (player) => held(player, HAMMER_ITEM_ID)],
    ["SQWmiM", (player) => held(player, SKULL_STAPLE_ITEM_ID, STAPLES_REQUIRED)],
    ["qPsu7i", (player) => held(player, CRANIAL_CLAMP_ITEM_ID)],
    ["9v7JyY", (player) => held(player, BRAIN_TONGS_ITEM_ID)],
    ["sSVXIU", (player) => held(player, BELL_JAR_ITEM_ID, 1) && !held(player, BELL_JAR_ITEM_ID, 2)],
    ["DLBFty", (player) => held(player, BELL_JAR_ITEM_ID, 2)],
    ["oVNz0H", (player) => !hasAllImplements(player)],
    ["5XpYrd", (player) => hasAllImplements(player)],
    ["xsj1t-", (player) => quest.getStage(player) >= STAGE_BOSS_KILLED],
  ]);

  const CONDITION_EFFECTS = new Map([
    [
      "MRxv-w",
      (player) => {
        setFlag(player, PEEPHOLE_ATTRIBUTE);
        if (quest.getStage(player) === STAGE_STARTED) quest.setStage(player, STAGE_SPIED);
      },
    ],
    [
      "ifiDXn",
      (player) => {
        deleteNails(player, STAIRS_NAILS);
        player.getInventory().deleteNumber(PLANK_ITEM_ID, STAIRS_PLANKS);
        swapObjectAt(player, BROKEN_STAIRS_TILE, new Set([BROKEN_STAIRS_OBJECT_ID]), FIXED_STAIRS_OBJECT_ID);
        setFlag(player, STAIRS_FIXED_ATTRIBUTE);
      },
    ],
    [
      "VqdO2N",
      (player) => {
        setFlag(player, RUFUS_ATTRIBUTE);
        if (!held(player, CRATE_PART_ITEM_ID)) giveItem(player, CRATE_PART_ITEM_ID, CRATE_PART_COUNT);
        if (quest.getStage(player) < STAGE_RUFUS) quest.setStage(player, STAGE_RUFUS);
      },
    ],
    [
      "zAYiRc",
      (player) => {
        setFlag(player, RUFUS_ATTRIBUTE);
        if (!held(player, WOLF_WHISTLE_ITEM_ID)) giveItem(player, WOLF_WHISTLE_ITEM_ID, 1);
        if (quest.getStage(player) < STAGE_RUFUS) quest.setStage(player, STAGE_RUFUS);
      },
    ],
    ["qNgtxQ", (player) => giveItem(player, WOLF_WHISTLE_ITEM_ID, 1)],
    ["tEPhpt", (player) => giveItem(player, CRATE_PART_ITEM_ID, CRATE_PART_COUNT)],
    [
      "VDkh8H",
      (player) => {
        player.getInventory().deleteNumber(PLANK_ITEM_ID, BOTTOM_PLANKS);
        deleteNails(player, BOTTOM_NAILS);
        swapObjectAt(player, CRATE_TILE, new Set([CRATE_BOTTOMLESS_OBJECT_ID]), CRATE_EMPTY_OBJECT_ID);
        if (quest.getStage(player) < STAGE_BOTTOM_BUILT) quest.setStage(player, STAGE_BOTTOM_BUILT);
      },
    ],
    [
      "1WI7yE",
      (player) => {
        swapObjectAt(player, CRATE_TILE, new Set([CRATE_EMPTY_OBJECT_ID]), CRATE_FILLED_OBJECT_ID);
        if (quest.getStage(player) < STAGE_CATS_FILLED) quest.setStage(player, STAGE_CATS_FILLED);
      },
    ],
    [
      "QgHr_7",
      (player) => {
        player.getInventory().deleteNumber(FUSE_ITEM_ID, 1);
        player.getInventory().deleteNumber(KEG_ITEM_ID, 1);
        player.getPacketSender().sendVarbit(VARBIT_MONASTERY_ENTRANCE, 5);
        if (quest.getStage(player) < STAGE_DOOR_BLOWN) quest.setStage(player, STAGE_DOOR_BLOWN);
      },
    ],
    [
      "5XpYrd",
      (player) => {
        consumeImplements(player);
        if (quest.getStage(player) < STAGE_OPERATION) quest.setStage(player, STAGE_OPERATION);
        player.getPacketSender().sendVarbit(BRAIN_MULTI_MONK_VARBIT, 1);
      },
    ],
  ]);

  function handleDialogueConditionAnswer(event) {
    if (!QUEST_CHATHEADS.has(event.npcId)) return null;
    const answer = CONDITION_ANSWERS.get(event.stepId);
    return answer ? answer(event.player) : null;
  }

  function handleDialogueCondition(event) {
    if (!QUEST_CHATHEADS.has(event.npcId)) return;
    const effect = CONDITION_EFFECTS.get(event.stepId);
    if (effect) effect(event.player);
  }

  function handleDialogueHook(event) {
    if (event.hook !== START_HOOK || !TRANQUILITY_NPC_IDS.has(event.npcId)) return;
    if (quest.getStage(event.player) === 0) quest.setStage(event.player, STAGE_STARTED);
  }

  function handleDialogueAction(event) {
    if (!QUEST_CHATHEADS.has(event.npcId)) return;
    const player = event.player;
    switch (event.stepId) {
      case "rsYDSe":
        event.handled = true;
        quest.setStage(player, STAGE_STARTED);
        teleport(player, HARMONY_TILE);
        return;
      case "tfWNLf":
        event.handled = true;
        teleport(player, MOS_TILE);
        return;
      case "F6MVz8":
        event.handled = true;
        teleport(player, MOS_TILE);
        return;
      case "HRJL7U":
        event.handled = true;
        if (quest.getStage(player) < STAGE_REPORTED) quest.setStage(player, STAGE_REPORTED);
        teleport(player, MOS_TILE);
        return;
      case "RzcjDw":
        event.handled = true;
        quest.setStage(player, STAGE_GAS);
        teleport(player, HARMONY_TILE);
        return;
      case "UoQUsd":
        event.handled = true;
        quest.setStage(player, STAGE_DOCTOR_TASK);
        teleport(player, MOS_TILE);
        return;
      case "JfLzr7":
        event.handled = true;
        quest.setStage(player, STAGE_LIST);
        ensureHarmonyDoctor(player);
        teleport(player, HARMONY_TILE);
        return;
      case "DjDfxn":
        giveItem(player, PRAYER_BOOK_ITEM_ID, 1);
        if (quest.getStage(player) < STAGE_BOOK) quest.setStage(player, STAGE_BOOK);
        return;
      case "5iPKK_":
        event.handled = true;
        giveItem(player, FUSE_ITEM_ID, 1);
        return;
      case "I3miMQ":
        event.handled = true;
        giveItem(player, KEG_ITEM_ID, 1);
        return;
      case "7ypfDH":
        event.handled = true;
        giveItem(player, WOLF_WHISTLE_ITEM_ID, 1);
        return;
      case "yEM6vg":
        event.handled = true;
        giveItem(player, CRATE_PART_ITEM_ID, CRATE_PART_COUNT);
        return;
      case "0ckhw5":
        event.handled = true;
        // Rufus takes the whistle first: that slot is what a full bag needs for
        // the order, and the old order (give then delete) lost it when full.
        player.getInventory().deleteNumber(WOLF_WHISTLE_ITEM_ID, 1);
        if (!giveItem(player, SHIPPING_ORDER_ITEM_ID, 1)) {
          giveItem(player, WOLF_WHISTLE_ITEM_ID, 1);
          return;
        }
        swapObjectAt(player, CRATE_TILE, new Set([CRATE_FILLED_OBJECT_ID]), CRATE_CLOSED_OBJECT_ID);
        if (quest.getStage(player) < STAGE_ORDER) quest.setStage(player, STAGE_ORDER);
        return;
      case "A61QHe":
        player.getInventory().deleteNumber(SHIPPING_ORDER_ITEM_ID, 1);
        removeObjectAt(player, CRATE_TILE, new Set([CRATE_CLOSED_OBJECT_ID, CRATE_FILLED_OBJECT_ID]));
        if (quest.getStage(player) < STAGE_DOCTOR_SENT) quest.setStage(player, STAGE_DOCTOR_SENT);
        return;
      case "9qzrXT":
        if (quest.getStage(player) < STAGE_WARDED) quest.setStage(player, STAGE_WARDED);
        return;
      case "LvauA0":
        event.handled = true;
        player.sendMessage("The temple door explodes, leaving a sizeable hole.");
        if (quest.getStage(player) < STAGE_DOOR_BLOWN) quest.setStage(player, STAGE_DOOR_BLOWN);
        return;
      case "95z_Qu":
        event.handled = true;
        player.getSkillManager().setCurrentLevel(Skill.PRAYER, player.getSkillManager().getMaxLevel(Skill.PRAYER), true);
        player.sendMessage("The player is restored with full Prayer points.");
        return;
      case "tMiAlp":
        event.handled = true;
        player.sendMessage(`You think ${Math.max(0, CAT_TARGET - catCount(player))} more will cover it.`);
        return;
      case "ib-nyK":
        event.handled = true;
        player.sendMessage("Mi-Gor teleports away and Barrelchest strikes the player with its anchor.");
        removeMiGor(player);
        spawnBarrelchest(player);
        return;
      case "0ayRsR":
        event.handled = true;
        player.sendMessage("Barrelchest rises up from the ground behind Mi-Gor.");
        return;
      case "gtjBNw":
        event.handled = true;
        player.sendMessage("The monk blesses the player with a symbol of Saradomin over the player's head.");
        return;
      case "61sNa3":
        event.handled = true;
        player.sendMessage("A redacted cutscene of Dr Fenkenstrain operating on a brain has been replaced with a kitten playing with a ball of string.");
        return;
      case "c9bmGx":
        event.handled = true;
        player.sendMessage("A cutscene begins.");
        return;
      case "C2JcKC":
        event.handled = true;
        player.sendMessage("The cutscene ends.");
        return;
      case "gxfU1O":
        event.handled = true;
        player.sendMessage("A cutscene starts with the player pondering on where to get the cats...");
        return;
      case "ubN0Yb":
        event.handled = true;
        player.sendMessage("Elfinlocks walks by Rufus' store with their mechanical cat.");
        return;
      case "l0AWhd":
        event.handled = true;
        teleport(player, TRANQUILITY_TILES.tranquilityHarmony);
        player.sendMessage("The player collapses, and is sent back to the granary.");
        return;
      case "hnbBxH":
        event.handled = true;
        player.sendMessage("The player's poison is cured.");
        return;
      case "vPCEhg":
        event.handled = true;
        player.sendMessage("The player enters water-flooded stairs.");
        return;
      case "734DAl":
        event.handled = true;
        player.sendMessage("The player begins building the crate and may bend a few nails.");
        return;
      default:
        return;
    }
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  function handleStageChanged(event) {
    if (event?.key !== "great_brain_robbery" || !event.player) return;
    ensureHarmonyDoctor(event.player);
    ensureMiGor(event.player);
    ensureTranquility(event.player);
  }

  function handleLogin({ player }) {
    ensureQuestObjects(player);
    ensureMiGor(player);
    ensureHarmonyDoctor(player);
    ensureTranquility(player);
    if (quest.getStage(player) >= STAGE_OPERATION) {
      player.getPacketSender().sendVarbit(BRAIN_MULTI_MONK_VARBIT, 1);
    }
    player.getPacketSender().sendVarbit(
      VARBIT_MONASTERY_ENTRANCE,
      quest.getStage(player) >= STAGE_DOOR_BLOWN ? 5 : 0
    );
    refreshQuestList(player);
  }

  function handleZoneEnter(event) {
    ensureMiGor(event.player);
    ensureHarmonyDoctor(event.player);
    ensureTranquility(event.player);
  }

  function handleLogout({ player }) {
    const ownedQuestObjects = [
      [STATUE_TILE, new Set([STATUE_OBJECT_ID, STATUE_PULLED_OBJECT_ID])],
      [PEEPHOLE_TILE, new Set([PEEPHOLE_OBJECT_ID])],
      [BROKEN_STAIRS_TILE, new Set([BROKEN_STAIRS_OBJECT_ID, FIXED_STAIRS_OBJECT_ID])],
      [CRATE_TILE, CRATE_OBJECT_IDS],
    ];
    for (const [tile, ids] of ownedQuestObjects) {
      for (const object of ObjectManager.objectsAt(tile) ?? []) {
        if (object.getOwner?.() === player && ids.has(object.getId?.())) ObjectManager.deregister(object, true);
      }
    }
    clearNpcs(player);
  }

  function grantRewards(player) {
    player.getSkillManager().addExperiences(Skill.PRAYER, 6000);
    player.getSkillManager().addExperiences(Skill.CRAFTING, 3000);
    player.getSkillManager().addExperiences(Skill.CONSTRUCTION, 2000);
    const inventory = player.getInventory();
    if (inventory.getFreeSlots() > 0) {
      inventory.adds(BLESSED_LAMP_ITEM_ID, 1);
      player.setAttribute(PENDING_LAMP_REWARD_ATTRIBUTE, false);
    } else {
      player.setAttribute(PENDING_LAMP_REWARD_ATTRIBUTE, true);
    }
  }

  /**
   * Client varp 980 uses the quest DB's 10/130 scale (native completion
   * threshold 130), not this plugin's compact 0-20 internal stages. The save
   * attribute stays 0-20, so old saves keep working; only the wire value maps.
   */
  const VARP_VALUES = [
    0, 10, 20, 30, 40, 40, 50, 60, 60, 60, 60, 60, 60, 60, 70, 80, 90, 100, 110, 120, 130,
  ];

  function wireValue(stage) {
    const index = Math.max(0, Math.min(STAGE_COMPLETE, stage | 0));
    return VARP_VALUES[index];
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Brother Tranquility asked me to help the monks of Harmony</str>",
        "<str>Island, whose brains had been swapped into zombie pirates.</str>",
        "<str>I spied on Mi-Gor, warded the granary against the gas and</str>",
        "<str>brought Dr Fenkenstrain to reverse the operations.</str>",
        "<str>I defeated Mi-Gor's Barrelchest, and the monks rewarded me.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_BOSS_KILLED) {
      return ["I defeated the Barrelchest. I should report back to", "<col=800000>Brother Tranquility</col> for my reward."];
    }
    if (stage >= STAGE_BOSS) {
      return [
        "Dr Fenkenstrain has finished the operations.",
        "I must deal with <col=800000>Mi-Gor</col> in the monastery; the",
        "cured monks can bless me before I go.",
      ];
    }
    if (stage >= STAGE_OPERATION) {
      return ["The operation is done. I should speak to", "<col=800000>Brother Tranquility</col>."];
    }
    if (stage >= STAGE_LIST) {
      return [
        "Dr Fenkenstrain needs a cranial clamp, brain tongs, three bell",
        "jars, thirty skull staples and a hammer.",
        "The implements are held by the <col=800000>Sorebones</col> in the",
        "monastery; the fuse is in the ship's locker and the gunpowder keg",
        "on its upper deck. I must blow the temple door open.",
      ];
    }
    if (stage >= STAGE_DOCTOR_SENT) {
      return ["The crate was shipped. I should speak to", "<col=800000>Brother Tranquility</col> at Mos Le'Harmless", "for transport back to Harmony."];
    }
    if (stage >= STAGE_RUFUS) {
      return [
        "I need to build Rufus' meat crate in Fenkenstrain's castle,",
        "add a false bottom, fill it with ten wooden cats and blow the",
        "<col=800000>wolf whistle</col> so he inspects the shipment.",
      ];
    }
    if (stage >= STAGE_DOCTOR_TASK) {
      return ["I must ask <col=800000>Dr Fenkenstrain</col> in his castle to", "help the monks, and arrange transport to Harmony Island."];
    }
    if (stage >= STAGE_WARDED) {
      return [
        "The granary is warded against the pirates' gas.",
        "I should speak to <col=800000>Brother Tranquility</col> about",
        "getting the monks' brains put back in the right bodies.",
      ];
    }
    if (stage >= STAGE_GAS) {
      return [
        "The pirates have released the gas! I must wear my holy symbol",
        "and recite the <col=800000>prayer from the book</col> inside the",
        "granary to ward it off.",
      ];
    }
    if (stage >= STAGE_BOOK) {
      return [
        "I have the book of prayers. I should read it, wear a",
        "<col=800000>holy symbol</col> and speak to",
        "<col=800000>Brother Tranquility</col> at Mos Le'Harmless",
        "for transport back to Harmony Island.",
      ];
    }
    if (stage >= STAGE_SPIED) {
      return [
        "I overheard Mi-Gor planning to knock the monks out with",
        "sleeping gas. I must warn <col=800000>Brother Tranquility</col>.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "Brother Tranquility took me to Harmony Island, where zombie",
        "pirates have overrun the monastery.",
        "The secret tunnel is under the <col=800000>Saradomin statue</col>",
        "in the garden; I need my diving apparatus and fishbowl helmet",
        "to swim the flooded tunnel.",
      ];
    }
    return [
      "I can start this quest by talking to",
      "<col=800000>Brother Tranquility</col> at Mos Le'Harmless.",
    ];
  }

  api.persistAttribute(PEEPHOLE_ATTRIBUTE);
  api.persistAttribute(BOOK_READ_ATTRIBUTE);
  api.persistAttribute(STAIRS_FIXED_ATTRIBUTE);
  api.persistAttribute(RUFUS_ATTRIBUTE);
  api.persistAttribute(DOCTOR_TOLD_ATTRIBUTE);
  api.persistAttribute(DOCTOR_LIST_ATTRIBUTE);
  api.persistAttribute(CATS_ATTRIBUTE);
  api.persistAttribute(PENDING_LAMP_REWARD_ATTRIBUTE, false);

  quest = registerQuest(api, {
    key: "great_brain_robbery",
    name: "The Great Brain Robbery",
    varpId: VARP_GREAT_BRAIN_ROBBERY,
    varpValue: wireValue,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.PRAYER.getIndex(), amount: 6000, label: "Prayer" },
      { skillId: Skill.CRAFTING.getIndex(), amount: 3000, label: "Crafting" },
      { skillId: Skill.CONSTRUCTION.getIndex(), amount: 2000, label: "Construction" },
    ],
    rewardItemLabel: "Blessed lamp (5,000 XP in a skill of your choice)",
    otherRewards: ["Barrelchest anchor (from the Barrelchest)"],
    buildJournal,
    onReward: grantRewards,
  });

  api.onNpcInteraction(handleNpcInteraction);
  api.onNpcDeath(handleNpcDeath);
  api.onObjectInteraction(handleObjectInteraction);
  api.onObjectRoute(routeLocker);
  api.onItemOnObject(handleItemOnObject);
  api.onItemOnItem(handleItemOnItem);
  api.onItemAction("Prayer book", { Read: readPrayerBook, "Recite-prayer": recitePrayerBook });
  api.onItemAction("Wolf whistle", { Blow: blowWolfWhistle });
  api.onItemAction("Blessed lamp", { "Pray-over": prayOverLamp });
  api.onCustomEvent("interface:closed", cancelLampChoice);
  api.onGroundItemPickup(handleGroundItemPickup);
  api.onNpcDialogueCondition(handleDialogueConditionAnswer);
  api.onCustomEvent("npc-dialogue:hook", handleDialogueHook);
  api.onCustomEvent("npc-dialogue:condition", handleDialogueCondition);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onCustomEvent("door:toggle", handleDoorToggle);
  api.onCustomEvent("ladders:climb", claimStairsClimb);
  api.onCustomEvent("quest:stage-changed", handleStageChanged);
  api.onZoneEnter(MONASTERY_ZONE, handleZoneEnter);
  api.onZoneEnter(HARMONY_BASEMENT_ZONE, handleZoneEnter);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
