/**
 * Legends' Quest (members).
 *
 * The words come from the "Legends' Quest" transcript page; this plugin supplies
 * the variant selector for the Legends' guards, Radimus Erkle, the jungle
 * foresters, Gujuo, Ungadulu, Viyeldi, San Tojalon, Irvig Senay, Ranalph Devere
 * and Echned Zekin, answers the wiki prose conditions, runs the start hook, and
 * drives the item/object/NPC gameplay around them.
 *
 * Stages (real OSRS varp 139, mirroring LostCity quest_legends constant values):
 *   0 not started, 1 started (Radimus notes), 2 jungle mapped, 3 got bullroarer,
 *   4 swung bullroarer (met Gujuo), 5 agreed to free Ungadulu, 6 found cave
 *   entrance, 7 spoke Ungadulu, 8 Gujuo told of sacred water, 10 sacred water in
 *   the bowl, 11 Binding Book used, 12 Nezikchened beaten at the fire wall,
 *   13 seeds germinated, 14 sacred pool dried up, 15 learned the bravery potion,
 *   16 entered the lower caves, 17 crystal fused into the heart crystal,
 *   18 heart crystal in the recess, 19 boulder pushed, 20 dark dagger received,
 *   22 Nezikchened beaten at the spring, 25 sacred water collected,
 *   30 Yommi totem carved, 32 final Nezikchened summoned, 35 final Nezikchened
 *   beaten, 40 totem replaced, 45 gilded totem received, 50 returned to Radimus,
 *   55/60/65/70 guild training, 70 complete.
 *
 * Requirements: 107 quest points, Family Crest, Heroes' Quest, Shilo Village,
 * Underground Pass and 10 skills at 50 (Agility, Crafting, Herblore, Magic,
 * Mining, Prayer, Smithing, Strength, Thieving, Woodcutting).
 *
 * Source: LostCityRS/Content scripts/quests/quest_legends (pinned in issue #196):
 * quest_legends.rs2, quest_legends/configs/quest_legends.constant,
 * radimus_erkle.rs2, radimus_notes.rs2, jungle_forester.rs2, gujuo.rs2,
 * ungadulu.rs2, echned_zekin.rs2, nezikchened.rs2, viyeldi.rs2, book_of_binding.rs2.
 * The enchanted-vial helper follows GregHib/void LegendsQuest.kt (pinned).
 *
 * Simplifications (documented gaps):
 *  - The cave trials between the entrance and the lower caves are compressed:
 *    the outer gate, mining boulders, strength gates and jagged wall are wired,
 *    but the gem puzzle is skipped. Inserting the five S.M.E.L.L. runes in the
 *    marked wall opens the way and grants the Book of Binding directly (OSRS
 *    spawns it in the gem room); the gem room itself is not reproduced.
 *  - The magic trial gate accepts any orb item instead of the Charge Orb spell.
 *  - The Yommi tree's 50-tick rot timers are not reproduced; the tree stays
 *    felled/trimmed/totem-carved until used. The dead/rotten variants are only
 *    reached by chopping an existing rotten object.
 *  - The heroes' crystal pieces are granted on their death (they are present in
 *    data/definitions/npc-spawns.json); the crystal is fused in the furnace.
 *  - Nezikchened, Echned Zekin, Viyeldi and Gujuo are spawned owner-only when
 *    the quest reaches them (they are not cache map spawns in this server).
 *  - Radimus Erkle's world spawn ids (10712/10713) are not in the dialogue
 *    index, so his Talk-to/item-on-NPC paths start the "Legends' Quest" page
 *    directly through startTranscript.
 *  - The requirement check reads quest points, the four prerequisite quests
 *    (Family Crest, Heroes' Quest, Shilo Village, Underground Pass) and the ten
 *    level-50 skills from the shared player attributes.
 *  - Radimus's four training rewards are granted from the guild training menu
 *    (7,650 XP each); the completion scroll lists them as an other-reward.
 */
module.exports = function registerLegendsQuest(api) {
  const {
    Skill,
    HitDamage,
    HitMask,
    Location,
    GameObject,
    ObjectManager,
    ItemIdentifiers,
    NpcIdentifiers,
    ObjectIdentifiers,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  let quest;

  const VARP_LEGENDS_QUEST = 139; // OSRS varp 139 (RuneLite VarPlayerID.LEGENDSQUEST)
  const STAGE_NOT_STARTED = 0;
  const STAGE_STARTED = 1;
  const STAGE_MAPPED = 2;
  const STAGE_GOT_BULLROARER = 3;
  const STAGE_SWUNG_BULLROARER = 4;
  const STAGE_ACCEPTED = 5;
  const STAGE_FOUND_ENTRANCE = 6;
  const STAGE_SPOKE_UNGADULU = 7;
  const STAGE_ASKED_HOLY_WATER = 8;
  const STAGE_FILLED_BOWL = 10;
  const STAGE_SUMMONED_FIRE = 11;
  const STAGE_DEFEATED_FIRE = 12;
  const STAGE_GERMINATED = 13;
  const STAGE_POOL_DRIED = 14;
  const STAGE_TALK_GUJUO_POOL = 15;
  const STAGE_ENTER_LOWER = 16;
  const STAGE_CRYSTAL_SMELTED = 17;
  const STAGE_HEART_IN_RECESS = 18;
  const STAGE_PUSHED_BOULDER = 19;
  const STAGE_RECEIVED_DAGGER = 20;
  const STAGE_DEFEATED_WATER = 22;
  const STAGE_SACRED_WATER = 25;
  const STAGE_COLLECTED_TOTEM = 30;
  const STAGE_SPAWNED_FINAL = 32;
  const STAGE_DEFEATED_FINAL = 35;
  const STAGE_REPLACED_TOTEM = 40;
  const STAGE_GOT_GILDED = 45;
  const STAGE_RETURNED = 50;
  const STAGE_TRAINING_4 = 70;
  const STAGE_COMPLETE = 70;

  const PAGE = "Legends' Quest";

  const RADIMUS_IDS = new Set([
    NpcIdentifiers.RADIMUS_ERKLE, // 3953 indexed transcript id
    10712, // spawned Radimus Erkle (npc-spawns.json, unindexed)
    10713, // spawned Radimus Erkle
  ]);
  const GUARD_IDS = new Set([NpcIdentifiers.LEGENDS_GUARD, NpcIdentifiers.LEGENDS_GUARD_2]);
  const FORESTER_IDS = new Set([NpcIdentifiers.JUNGLE_FORESTER, NpcIdentifiers.JUNGLE_FORESTER_2]);
  const GUJUO_ID = NpcIdentifiers.GUJUO;
  const UNGADULU_IDS = new Set([NpcIdentifiers.UNGADULU, NpcIdentifiers.UNGADULU_2]);
  const VIYELDI_ID = NpcIdentifiers.VIYELDI;
  const HERO_IDS = new Map([
    [NpcIdentifiers.SAN_TOJALON, { itemId: ItemIdentifiers.CHUNK_OF_CRYSTAL, label: "chunk" }],
    [NpcIdentifiers.IRVIG_SENAY, { itemId: ItemIdentifiers.HUNK_OF_CRYSTAL, label: "hunk" }],
    [NpcIdentifiers.RANALPH_DEVERE, { itemId: ItemIdentifiers.LUMP_OF_CRYSTAL, label: "lump" }],
  ]);
  const ECHNED_ID = NpcIdentifiers.ECHNED_ZEKIN;
  const NEZIKCHENED_ID = NpcIdentifiers.NEZIKCHENED;

  const RADIMUS_NOTES = ItemIdentifiers.RADIMUS_NOTES; // 714
  const RADIMUS_NOTES_2 = ItemIdentifiers.RADIMUS_NOTES_2; // 715 completed map
  const BULLROARER = ItemIdentifiers.BULLROARER; // 716
  const SCRAWLED_NOTE = ItemIdentifiers.SCRAWLED_NOTE; // 717
  const A_SCRIBBLED_NOTE = ItemIdentifiers.A_SCRIBBLED_NOTE; // 718
  const SCRUMPLED_NOTE = ItemIdentifiers.SCRUMPLED_NOTE; // 719
  const SKETCH = ItemIdentifiers.SKETCH; // 720
  const GOLD_BOWL = ItemIdentifiers.GOLD_BOWL; // 721 empty
  const BLESSED_GOLD_BOWL = ItemIdentifiers.BLESSED_GOLD_BOWL; // 722 blessed empty
  const GOLDEN_BOWL = ItemIdentifiers.GOLDEN_BOWL; // 723 water
  const GOLDEN_BOWL_2 = ItemIdentifiers.GOLDEN_BOWL_2; // 724 pure
  const GOLDEN_BOWL_3 = ItemIdentifiers.GOLDEN_BOWL_3; // 725 blessed water
  const GOLDEN_BOWL_4 = ItemIdentifiers.GOLDEN_BOWL_4; // 726 blessed pure
  const HOLLOW_REED = ItemIdentifiers.HOLLOW_REED; // 727
  const HOLLOW_REED_2 = ItemIdentifiers.HOLLOW_REED_2; // 728 soggy
  const SHAMANS_TOME = ItemIdentifiers.SHAMANS_TOME; // 729
  const BINDING_BOOK = ItemIdentifiers.BINDING_BOOK; // 730
  const ENCHANTED_VIAL = ItemIdentifiers.ENCHANTED_VIAL; // 731
  const HOLY_WATER = ItemIdentifiers.HOLY_WATER; // 732
  const YOMMI_TREE_SEEDS = ItemIdentifiers.YOMMI_TREE_SEEDS; // 735
  const YOMMI_TREE_SEEDS_2 = ItemIdentifiers.YOMMI_TREE_SEEDS_2; // 736 germinated
  const SNAKEWEED_MIXTURE = ItemIdentifiers.SNAKEWEED_MIXTURE; // 737
  const ARDRIGAL_MIXTURE = ItemIdentifiers.ARDRIGAL_MIXTURE; // 738
  const BRAVERY_POTION = ItemIdentifiers.BRAVERY_POTION; // 739
  const CHUNK_OF_CRYSTAL = ItemIdentifiers.CHUNK_OF_CRYSTAL; // 741
  const HUNK_OF_CRYSTAL = ItemIdentifiers.HUNK_OF_CRYSTAL; // 742
  const LUMP_OF_CRYSTAL = ItemIdentifiers.LUMP_OF_CRYSTAL; // 743
  const HEART_CRYSTAL = ItemIdentifiers.HEART_CRYSTAL; // 744
  const HEART_CRYSTAL_2 = ItemIdentifiers.HEART_CRYSTAL_2; // 745 glowing
  const DARK_DAGGER = ItemIdentifiers.DARK_DAGGER; // 746
  const GLOWING_DAGGER = ItemIdentifiers.GLOWING_DAGGER; // 747
  const HOLY_FORCE = ItemIdentifiers.HOLY_FORCE; // 748
  const YOMMI_TOTEM = ItemIdentifiers.YOMMI_TOTEM; // 749
  const GILDED_TOTEM = ItemIdentifiers.GILDED_TOTEM; // 750
  const PAPYRUS = ItemIdentifiers.PAPYRUS; // 970
  const CHARCOAL = ItemIdentifiers.CHARCOAL; // 973
  const MACHETE = ItemIdentifiers.MACHETE; // 975
  const KNIFE = ItemIdentifiers.KNIFE; // 946
  const ROPE = ItemIdentifiers.ROPE; // 954
  const VIAL = ItemIdentifiers.VIAL; // 229
  const SNAKE_WEED = ItemIdentifiers.SNAKE_WEED; // 1526
  const ARDRIGAL = ItemIdentifiers.ARDRIGAL; // 1528
  const GOLD_BAR = ItemIdentifiers.GOLD_BAR; // 2357
  const HAMMER = ItemIdentifiers.HAMMER; // 2347
  const SOUL_RUNE = ItemIdentifiers.SOUL_RUNE; // 566
  const MIND_RUNE = ItemIdentifiers.MIND_RUNE; // 558
  const EARTH_RUNE = ItemIdentifiers.EARTH_RUNE; // 557
  const LAW_RUNE = ItemIdentifiers.LAW_RUNE; // 563
  const LOCKPICK = ItemIdentifiers.LOCKPICK; // 1523
  const COINS = ItemIdentifiers.COINS; // 995
  const RUNE_AXE = ItemIdentifiers.RUNE_AXE; // 1359
  const UNPOWERED_ORB = ItemIdentifiers.UNPOWERED_ORB; // 567

  const ENTRANCE_ROCKS = new Set([
    ObjectIdentifiers.MOSSY_ROCK, // 2900 lgshamancaverock1
    ObjectIdentifiers.MOSSY_ROCK_2, // 2901 lgshamancaverock2
    ObjectIdentifiers.ROCKS_6, // 2902 lgshamancaverock3
  ]);
  const CAVE_EXITS = new Set([
    ObjectIdentifiers.CAVE_ENTRANCE_15, // 2903
    ObjectIdentifiers.CAVE_ENTRANCE_16, // 2904
  ]);
  const FIRE_WALLS = new Set([ObjectIdentifiers.FIRE_WALL, ObjectIdentifiers.FIRE_WALL_2]); // 2908/2909
  const OUTER_GATES = new Set([ObjectIdentifiers.ANCIENT_GATE, ObjectIdentifiers.ANCIENT_GATE_2]); // 2912/2913
  const MINING_BOULDERS = new Set([
    ObjectIdentifiers.BOULDER, // 2919
    ObjectIdentifiers.BOULDER_2, // 2920
    ObjectIdentifiers.BOULDER_3, // 2921
  ]);
  const STRENGTH_GATES = new Set([
    ObjectIdentifiers.ANCIENT_GATE_3, // 2922
    ObjectIdentifiers.ANCIENT_GATE_4, // 2923
    ObjectIdentifiers.ANCIENT_GATE_5, // 2924
    ObjectIdentifiers.ANCIENT_GATE_6, // 2925
  ]);
  const MAGIC_GATES = new Set([ObjectIdentifiers.ANCIENT_GATE_7, ObjectIdentifiers.ANCIENT_GATE_8]); // 2930/2931
  const SEARCH_TABLE = ObjectIdentifiers.TABLE_36; // 2906
  const SEARCH_CRATE = ObjectIdentifiers.CRATE_22; // 2905
  const SEARCH_BED = ObjectIdentifiers.BED_20; // 2907
  const SEARCH_DESK = ObjectIdentifiers.DESK; // 2910
  const SEARCH_BOOKCASE = ObjectIdentifiers.BOOKCASE_12; // 2911
  const JAGGED_WALL = ObjectIdentifiers.JAGGED_WALL; // 2926 (LostCity crumbled wall)
  const MARKED_WALL = ObjectIdentifiers.MARKED_WALL; // 2927 (LostCity lgancientwalldoor)
  const CARVED_ROCK = ObjectIdentifiers.CARVED_ROCK; // 2928
  const BURIED_SKELETON = ObjectIdentifiers.BURIED_SKELETON_3; // 2929
  const WINCH_NO_ROPE = ObjectIdentifiers.WINCH_5; // 2934
  const WINCH_ROPE = ObjectIdentifiers.WINCH_6; // 2935
  const CORRUPT_TOTEMS = new Set([ObjectIdentifiers.TOTEM_POLE_2, ObjectIdentifiers.TOTEM_POLE_4]); // 2936/2938
  const GOOD_TOTEM = ObjectIdentifiers.TOTEM_POLE_3; // 2937
  const SACRED_POOL = ObjectIdentifiers.WATER_POOL; // 2942 (LostCity sacred_water)
  const POLLUTED_POOL = ObjectIdentifiers.POLLUTED_WATER; // 2943
  const REEDS = ObjectIdentifiers.TALL_REEDS; // 2944
  const YOMMI_BABY = ObjectIdentifiers.YOMMI_TREE_BABY; // 2945
  const YOMMI_SAPLING = ObjectIdentifiers.YOMMI_TREE_SAPLING; // 2946
  const YOMMI_ADULT = ObjectIdentifiers.ADULT_YOMMI_TREE; // 2948
  const YOMMI_FELLED = ObjectIdentifiers.FELLED_YOMMI_TREE; // 2950
  const YOMMI_TRIMMED = ObjectIdentifiers.TRIMMED_YOMMI; // 2952
  const YOMMI_TOTEM_OBJECT = ObjectIdentifiers.TOTEM_POLE_6; // 2954
  const DAMAGED_EARTH = ObjectIdentifiers.DAMAGED_EARTH; // 2957
  const FERTILE_SOIL = ObjectIdentifiers.FERTILE_SOIL; // 2956
  const CLIMBING_ROPE = ObjectIdentifiers.CLIMBING_ROPE_2; // 2958
  const DRAGONS_EYE_ROCK = ObjectIdentifiers.MOSSY_ROCK_3; // 2965
  const LEGENDS_FURNACE = ObjectIdentifiers.FURNACE_2; // 2966
  const RECESS_EMPTY = ObjectIdentifiers.RECESS; // 2969
  const RECESS_FULL = ObjectIdentifiers.FILLED_RECESS; // 2970
  const SHIMMERING_FIELD = ObjectIdentifiers.SHIMMERING_FIELD; // 2971
  const GUILD_DOORS = new Set([
    ObjectIdentifiers.LEGENDS_GUILD_DOOR, // 2896
    ObjectIdentifiers.LEGENDS_GUILD_DOOR_2, // 2897
  ]);

  const START_HOOK = "quest:legends-quest:start";
  const COMPLETE_ACTION_ID = "7BEgA_"; // "Congratulations! Quest complete!"
  const HAND_IN_TOTEM_ACTION_ID = "ESPQzk"; // Radimus takes the totem/map
  const SKETCH_MESSAGE_ID = "PkIGcg"; // Gujuo draws the bowl sketch
  const BOWL_BLESSED_MESSAGE_ID = "fV9en4";
  const FORESTER_BULLROARER_MESSAGE_IDS = new Set(["RvfARj", "-SsmZ2"]);
  const ECHNED_DAGGER_MESSAGE_ID = "ZqAjeH"; // Echned gives the dark dagger
  const ECHNED_TAKES_DAGGER_MESSAGE_ID = "O5P-3-";
  const GILDED_TOTEM_MESSAGE_ID = "PrLJcc"; // Gujuo offers the gilded totem
  const GUIDE_TELEPORT_ACTION_ID = "Ss9xRo";
  const DAGGER_THROW_MESSAGE_ID = "_pGLCQ";

  const MAP_ATTRIBUTE = "quest.legends_quest.map"; // 1 west, 2 middle, 4 east
  const BOWL_USES_ATTRIBUTE = "quest.legends_quest.bowl_uses";
  const RUNES_ATTRIBUTE = "quest.legends_quest.runes";
  const ROPE_ATTRIBUTE = "quest.legends_quest.winch_rope";
  const BRAVERY_ATTRIBUTE = "quest.legends_quest.bravery";
  const VIYELDI_ATTRIBUTE = "quest.legends_quest.viyeldi";
  const CRYSTALS_ATTRIBUTE = "quest.legends_quest.crystals"; // 1 chunk, 2 hunk, 4 lump
  const SOAKED_ATTRIBUTE = "quest.legends_quest.soaked";

  const KHARAZI = { minX: 2720, maxX: 2980, minY: 2880, maxY: 2960, levels: [0] };
  const SHAMAN_CAVE_ENTRANCE = { x: 2797, y: 9341, z: 0 };
  const SHAMAN_CAVE_EXIT = { x: 2781, y: 2934, z: 0 };
  const LOWER_CAVES = { x: 2377, y: 4712, z: 0 };
  const CLIMB_BACK = { x: 2760, y: 9328, z: 0 };
  const BARRIER_DESTINATION = { x: 2421, y: 4690, z: 0 };
  const JUNGLE_EDGE = { x: 2865, y: 2941, z: 0 };
  const RUNE_ORDER = [SOUL_RUNE, MIND_RUNE, EARTH_RUNE, LAW_RUNE, LAW_RUNE];

  const REQUIRED_SKILLS = [
    [Skill.AGILITY, "Agility"],
    [Skill.CRAFTING, "Crafting"],
    [Skill.HERBLORE, "Herblore"],
    [Skill.MAGIC, "Magic"],
    [Skill.MINING, "Mining"],
    [Skill.PRAYER, "Prayer"],
    [Skill.SMITHING, "Smithing"],
    [Skill.STRENGTH, "Strength"],
    [Skill.THIEVING, "Thieving"],
    [Skill.WOODCUTTING, "Woodcutting"],
  ];
  const REQUIRED_QUEST_POINTS = 107;
  const REQUIRED_QUESTS = [
    ["quest.family_crest.stage", 11, "Family Crest"],
    ["quest.heroes_quest.stage", 15, "Heroes' Quest"],
    ["quest.shilo_village.stage", 15, "Shilo Village"],
    ["quest.underground_pass.stage", 10, "Underground Pass"],
  ];

  const TRAINING_SKILLS = [
    ["attack", "Attack", Skill.ATTACK],
    ["defence", "Defence", Skill.DEFENCE],
    ["strength", "Strength", Skill.STRENGTH],
    ["hitpoints", "Hitpoints", Skill.HITPOINTS],
    ["prayer", "Prayer", Skill.PRAYER],
    ["magic", "Magic", Skill.MAGIC],
    ["woodcutting", "Woodcutting", Skill.WOODCUTTING],
    ["crafting", "Crafting", Skill.CRAFTING],
    ["smithing", "Smithing", Skill.SMITHING],
    ["herblore", "Herblore", Skill.HERBLORE],
    ["agility", "Agility", Skill.AGILITY],
    ["thieving", "Thieving", Skill.THIEVING],
  ];

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;
  const give = (player, itemId, amount = 1) => player.getInventory().adds(itemId, amount);
  const take = (player, itemId, amount = 1) => player.getInventory().deleteNumber(itemId, amount);
  const hasAny = (player, itemIds) => itemIds.some((itemId) => held(player, itemId));
  const skillLevel = (player, skill) => player.getSkillManager().getCurrentLevel(skill);
  const questStage = (player) => quest.getStage(player);

  function freeSlots(player) {
    const inventory = player.getInventory();
    return typeof inventory.getFreeSlots === "function"
      ? inventory.getFreeSlots()
      : inventory.isFull()
        ? 0
        : 28;
  }

  function inKharazi(player) {
    const location = player.getLocation();
    const x = location.getX();
    const y = location.getY();
    const z = location.getZ();
    return x >= KHARAZI.minX && x <= KHARAZI.maxX && y >= KHARAZI.minY && y <= KHARAZI.maxY && (!z || KHARAZI.levels.includes(z));
  }

  function mapSectionAt(player) {
    const x = player.getLocation().getX();
    if (x < 2810) return { bit: 1, name: "Western" };
    if (x < 2880) return { bit: 2, name: "Middle" };
    return { bit: 4, name: "Eastern" };
  }

  function mapBits(player) {
    return Number(player.getAttribute(MAP_ATTRIBUTE)) || 0;
  }

  function allMapped(player) {
    return (mapBits(player) & 7) === 7;
  }

  function runeCount(player) {
    return Number(player.getAttribute(RUNES_ATTRIBUTE)) || 0;
  }

  function crystalBits(player) {
    return Number(player.getAttribute(CRYSTALS_ATTRIBUTE)) || 0;
  }

  function meetsRequirements(player) {
    for (const [skill, label] of REQUIRED_SKILLS) {
      if (skillLevel(player, skill) < 50) return false;
    }
    if ((Number(player.getAttribute("quest.points")) || 0) < REQUIRED_QUEST_POINTS) return false;
    for (const [attribute, completeAt] of REQUIRED_QUESTS) {
      if ((Number(player.getAttribute(attribute)) || 0) < completeAt) return false;
    }
    return true;
  }

  function missingRequirementText(player) {
    const missing = REQUIRED_SKILLS
      .filter(([skill]) => skillLevel(player, skill) < 50)
      .map(([, label]) => label);
    const lines = ["You need to complete more quests and have 107 quest points before you may start this quest."];
    lines.push("You also need these quests: Family Crest, Heroes' Quest, Shilo Village and Underground Pass.");
    if (missing.length) lines.push(`You need level 50 in: ${missing.join(", ")}.`);
    return lines;
  }

  function damage(player, amount) {
    player.getCombat().getHitQueue().addPendingDamage([new HitDamage(amount, HitMask.RED)]);
  }

  /** Steps the player to the far side of a blocking object (quest trial doors/rocks). */
  function moveAcross(player, objectLocation, distance = 1) {
    const location = player.getLocation();
    const px = location.getX();
    const py = location.getY();
    const ox = Number(objectLocation?.x ?? objectLocation?.getX?.());
    const oy = Number(objectLocation?.y ?? objectLocation?.getY?.());
    if (!Number.isFinite(ox) || !Number.isFinite(oy)) return;
    const dx = px - ox;
    const dy = py - oy;
    if (Math.abs(dx) > Math.abs(dy)) {
      player.moveTo(new Location(ox + (dx <= 0 ? distance : -distance), py, location.getZ()));
    } else {
      player.moveTo(new Location(px, oy + (dy <= 0 ? distance : -distance), location.getZ()));
    }
  }

  function replaceObject(object, newId) {
    if (!object) return;
    const location = object.getLocation();
    ObjectManager.deregister(object, true);
    ObjectManager.register(
      new GameObject(
        newId,
        new Location(location.getX(), location.getY(), location.getZ()),
        object.getType(),
        object.getFace(),
        object.getPrivateArea() ?? null
      ),
      true
    );
  }

  function bowlUses(player) {
    return Number(player.getAttribute(BOWL_USES_ATTRIBUTE)) || 0;
  }

  function setBowlUses(player, value) {
    player.setAttribute(BOWL_USES_ATTRIBUTE, value | 0);
  }

  /** Splash/drink one of the blessed bowl's water doses; empties it on the tenth. */
  function useBowlDose(player) {
    const uses = bowlUses(player);
    if (uses >= 9) {
      setBowlUses(player, 0);
      take(player, GOLDEN_BOWL_4, 1);
      give(player, BLESSED_GOLD_BOWL, 1);
      player.sendMessage("The pure water in the golden bowl has run out...");
    } else {
      setBowlUses(player, uses + 1);
    }
  }

  // ==========================================================================
  // Spawned NPC tracking (Gujuo, Nezikchened, Echned Zekin, Viyeldi)
  // ==========================================================================

  const spawnedByPlayer = new Map();

  function trackSpawn(player, npc) {
    if (!npc) return npc;
    const set = spawnedByPlayer.get(player) ?? new Set();
    set.add(npc);
    spawnedByPlayer.set(player, set);
    return npc;
  }

  function spawnNear(player, npcId, dx, dy, wanderRadius = 0) {
    const location = player.getLocation();
    return trackSpawn(
      player,
      api.spawnNpc({
        id: npcId,
        x: location.getX() + dx,
        y: location.getY() + dy,
        z: location.getZ(),
        wanderRadius,
        owner: player,
        ownerOnly: true,
      })
    );
  }

  function clearSpawns(player) {
    const set = spawnedByPlayer.get(player);
    if (set) for (const npc of set) api.removeNpc(npc);
    spawnedByPlayer.delete(player);
  }

  function despawn(player, npcId) {
    const set = spawnedByPlayer.get(player);
    if (!set) return;
    for (const npc of [...set]) {
      if (npc?.getId?.() === npcId) {
        api.removeNpc(npc);
        set.delete(npc);
      }
    }
  }

  function spawnGujuo(player) {
    const set = spawnedByPlayer.get(player);
    if (set) for (const npc of set) if (npc?.getId?.() === GUJUO_ID) return;
    spawnNear(player, GUJUO_ID, 1, 0, 0);
  }

  function ensureEchnedAndViyeldi(player) {
    const set = spawnedByPlayer.get(player) ?? new Set();
    let hasEchned = false;
    let hasViyeldi = false;
    for (const npc of set) {
      const id = npc?.getId?.();
      if (id === ECHNED_ID) hasEchned = true;
      if (id === VIYELDI_ID) hasViyeldi = true;
    }
    if (!hasEchned) spawnNear(player, ECHNED_ID, 1, 1, 0);
    if (!hasViyeldi) spawnNear(player, VIYELDI_ID, 3, 3, 0);
  }

  function spawnNezikchened(player, radius = 2) {
    const set = spawnedByPlayer.get(player) ?? new Set();
    for (const npc of set) if (npc?.getId?.() === NEZIKCHENED_ID) return npc;
    return spawnNear(player, NEZIKCHENED_ID, 1, 1, radius);
  }

  // ==========================================================================
  // Stage gameplay
  // ==========================================================================

  function noteStage(player, stage) {
    if (questStage(player) < stage) quest.setStage(player, stage);
  }

  function startQuest(player) {
    if (!meetsRequirements(player)) {
      for (const line of missingRequirementText(player)) player.sendMessage(line);
      return;
    }
    noteStage(player, STAGE_STARTED);
    if (!hasAny(player, [RADIMUS_NOTES, RADIMUS_NOTES_2]) && freeSlots(player) >= 1) {
      give(player, RADIMUS_NOTES, 1);
    }
  }

  function mapJungle(player) {
    if (!inKharazi(player)) {
      player.sendMessage("You're not even in the Kharazi Jungle yet. You need to get to the Southern end of Karamja before you can start mapping.");
      return;
    }
    if (!held(player, PAPYRUS) || !held(player, CHARCOAL)) {
      player.sendMessage("You'll need papyrus and charcoal to complete this map.");
      return;
    }
    if (skillLevel(player, Skill.CRAFTING) < 50) {
      player.sendMessage("Mapping the Kharazi Jungle is a difficult task. You need a Crafting level of at least 50.");
      return;
    }
    const section = mapSectionAt(player);
    if (mapBits(player) & section.bit) {
      player.sendMessage("You have already completed this part of the map.");
      return;
    }
    take(player, PAPYRUS, 1);
    if (Math.random() < 0.25) {
      player.sendMessage("You make a mess of the map, but you think you can reuse this papyrus.");
      return;
    }
    player.setAttribute(MAP_ATTRIBUTE, mapBits(player) | section.bit);
    player.sendMessage("You use your Crafting skill to neatly add a new section to your map.");
    if (!allMapped(player)) {
      player.sendMessage("You still have some sections of the map to complete.");
      return;
    }
    take(player, RADIMUS_NOTES, 1);
    give(player, RADIMUS_NOTES_2, 1);
    noteStage(player, STAGE_MAPPED);
    player.sendMessage("Well done! You have finished mapping the Kharazi Jungle. Radimus Erkle will be pleased.");
  }

  function useBullroarer(player) {
    player.sendMessage("You swing the bullroarer above your head.");
    player.sendMessage("You feel a bit silly at first, but soon it makes an interesting sound.");
    if (!inKharazi(player)) {
      player.sendMessage("Nothing much seems to happen, though.");
      return;
    }
    if (questStage(player) < STAGE_GOT_BULLROARER) {
      player.sendMessage("Nothing much seems to happen, though.");
      return;
    }
    player.sendMessage("You see some movement in the trees...");
    player.sendMessage("...and a tall, dark, charismatic-looking man approaches you.");
    noteStage(player, STAGE_SWUNG_BULLROARER);
    spawnGujuo(player);
  }

  function blessBowl(player) {
    let blessed = false;
    if (held(player, GOLD_BOWL)) {
      take(player, GOLD_BOWL, 1);
      give(player, BLESSED_GOLD_BOWL, 1);
      blessed = true;
    } else if (held(player, GOLDEN_BOWL)) {
      take(player, GOLDEN_BOWL, 1);
      give(player, GOLDEN_BOWL_3, 1);
      blessed = true;
    } else if (held(player, GOLDEN_BOWL_2)) {
      take(player, GOLDEN_BOWL_2, 1);
      give(player, GOLDEN_BOWL_4, 1);
      blessed = true;
    }
    if (blessed) player.sendMessage("The bowl is blessed!");
  }

  function emptyBowl(player, itemId) {
    if (itemId === GOLDEN_BOWL_4 || itemId === GOLDEN_BOWL_2) {
      take(player, itemId, 1);
      give(player, GOLD_BOWL, 1);
      player.sendMessage("You empty the pure water out of the golden bowl.");
    } else if (itemId === GOLDEN_BOWL_3 || itemId === GOLDEN_BOWL) {
      take(player, itemId, 1);
      give(player, GOLD_BOWL, 1);
      player.sendMessage("You empty the water out of the golden bowl.");
    } else if (itemId === BLESSED_GOLD_BOWL) {
      player.sendMessage("The golden bowl is already empty.");
    }
  }

  function smithGoldenBowl(player) {
    if (!held(player, SKETCH)) {
      player.sendMessage("You don't know what vessel to make. Gujuo could draw you a sketch.");
      return;
    }
    if (skillLevel(player, Skill.SMITHING) < 50) {
      player.sendMessage("You need a Smithing level of at least 50 to work gold.");
      return;
    }
    if (!held(player, HAMMER)) {
      player.sendMessage("You need a hammer to work the metal with.");
      return;
    }
    if (!held(player, GOLD_BAR, 2)) {
      player.sendMessage("You need two gold bars to make a bowl.");
      return;
    }
    take(player, GOLD_BAR, 2);
    give(player, GOLD_BOWL, 1);
    player.sendMessage("You forge a beautiful bowl out of solid gold.");
  }

  function cutReed(player) {
    if (!held(player, KNIFE) && !held(player, MACHETE)) {
      player.sendMessage("You need a sharp blade to cut the reeds.");
      return;
    }
    give(player, HOLLOW_REED, 1);
    player.sendMessage("You cut down a hollow reed.");
  }

  function scoopSacredWater(player) {
    const stage = questStage(player);
    if (stage >= STAGE_GERMINATED && stage < STAGE_DEFEATED_WATER) {
      if (stage === STAGE_GERMINATED) quest.setStage(player, STAGE_POOL_DRIED);
      player.sendMessage("It looks as if this pool has dried up. A thick black sludge has replaced the sparkling pure water.");
      return;
    }
    if (!held(player, HOLLOW_REED)) {
      player.sendMessage("The water is too awkward to get to, the gap to the water is too narrow to reach with this item.");
      return;
    }
    if (held(player, BLESSED_GOLD_BOWL)) {
      take(player, BLESSED_GOLD_BOWL, 1);
      take(player, HOLLOW_REED, 1);
      give(player, GOLDEN_BOWL_4, 1);
      setBowlUses(player, 0);
      if (stage === STAGE_ASKED_HOLY_WATER) quest.setStage(player, STAGE_FILLED_BOWL);
      if (stage === STAGE_DEFEATED_WATER) quest.setStage(player, STAGE_SACRED_WATER);
      player.sendMessage("You use the cut reed plant to syphon some water from the pool into your blessed golden bowl.");
      return;
    }
    if (held(player, ENCHANTED_VIAL)) {
      take(player, ENCHANTED_VIAL, 1);
      take(player, HOLLOW_REED, 1);
      give(player, HOLY_WATER, 1);
      player.sendMessage("You use the cut reed plant to syphon some water from the pool into your enchanted vial.");
      return;
    }
    if (held(player, GOLD_BOWL)) {
      take(player, GOLD_BOWL, 1);
      take(player, HOLLOW_REED, 1);
      give(player, GOLDEN_BOWL_2, 1);
      player.sendMessage("You use the cut reed plant to syphon some water from the pool into your golden bowl.");
      return;
    }
    player.sendMessage("You have nothing suitable to put the water in.");
  }

  function germinateSeeds(player) {
    if (!hasAny(player, [YOMMI_TREE_SEEDS, YOMMI_TREE_SEEDS_2])) {
      player.sendMessage("You have no Yommi tree seeds to germinate.");
      return;
    }
    if (!held(player, GOLDEN_BOWL_4)) {
      player.sendMessage("The seeds need to be germinated in pure sacred water.");
      return;
    }
    const seeds = player.getInventory().getAmount(YOMMI_TREE_SEEDS);
    take(player, YOMMI_TREE_SEEDS, seeds);
    give(player, YOMMI_TREE_SEEDS_2, seeds);
    take(player, GOLDEN_BOWL_4, 1);
    give(player, BLESSED_GOLD_BOWL, 1);
    if (questStage(player) === STAGE_DEFEATED_FIRE) quest.setStage(player, STAGE_GERMINATED);
    player.sendMessage("You place the seeds into the golden bowl of pure sacred water.");
    player.sendMessage("You start to see little shoots growing on the seeds. They're germinating!");
  }

  function plantYommiTree(player, object) {
    if (!held(player, YOMMI_TREE_SEEDS_2)) return;
    if (skillLevel(player, Skill.HERBLORE) < 45 || skillLevel(player, Skill.WOODCUTTING) < 50) {
      player.sendMessage("You need 45 Herblore and 50 Woodcutting to grow the Yommi tree.");
      return;
    }
    if (!held(player, GOLDEN_BOWL_4)) {
      player.sendMessage("You'll need some pure sacred water to feed the tree when it starts growing.");
      return;
    }
    take(player, YOMMI_TREE_SEEDS_2, 1);
    replaceObject(object, YOMMI_BABY);
    player.sendMessage("You plant the Yommi tree seed in the soil.");
    player.sendMessage("It starts to grow at a remarkable rate.");
    player.sendMessage("It looks as if this Yommi tree needs to be watered.");
  }

  function waterYommiTree(player, object) {
    if (!held(player, GOLDEN_BOWL_4)) {
      player.sendMessage("You need pure sacred water to water the Yommi tree.");
      return;
    }
    take(player, GOLDEN_BOWL_4, 1);
    give(player, BLESSED_GOLD_BOWL, 1);
    setBowlUses(player, 0);
    replaceObject(object, YOMMI_ADULT);
    player.sendMessage("You water the Yommi tree from the Golden Bowl...");
    player.sendMessage("It grows at a remarkable rate...");
    player.sendMessage("Soon the tree stops growing.");
    player.sendMessage("It looks tall enough now to make a good-sized totem pole.");
  }

  function chopYommiTree(player, object, expectedId, nextId, message) {
    if (expectedId !== undefined && object?.getId?.() !== expectedId) return false;
    if (!held(player, RUNE_AXE)) {
      player.sendMessage("You need a better axe than that.");
      return true;
    }
    replaceObject(object, nextId);
    player.sendMessage(message);
    return true;
  }

  function carveTotem(player, object) {
    if (!held(player, RUNE_AXE)) {
      player.sendMessage("You need a better axe than that.");
      return;
    }
    replaceObject(object, YOMMI_TOTEM_OBJECT);
    player.sendMessage("You professionally wield your axe...");
    player.sendMessage("as you carve a wonderful totem pole from the Yommi tree trunk.");
  }

  function pickUpTotem(player, object) {
    if (freeSlots(player) < 1) {
      player.sendMessage("You don't have enough space for this in your inventory.");
      return;
    }
    give(player, YOMMI_TOTEM, 1);
    replaceObject(object, DAMAGED_EARTH);
    noteStage(player, STAGE_COLLECTED_TOTEM);
    player.sendMessage("This totem pole looks very heavy.....");
    player.sendMessage("But you manage to lift it.");
  }

  function makeBraveryPotion(player) {
    if (questStage(player) < STAGE_TALK_GUJUO_POOL) {
      player.sendMessage("You're not sure what mixing these two things together would do. You decide against experimenting.");
      return;
    }
    take(player, ARDRIGAL_MIXTURE, 1);
    take(player, SNAKEWEED_MIXTURE, 1);
    give(player, BRAVERY_POTION, 1);
    player.sendMessage("You mix the two ingredients together.");
    player.sendMessage("It makes a heady brew. This must be what Gujuo was talking about.");
  }

  function drinkBraveryPotion(player) {
    take(player, BRAVERY_POTION, 1);
    give(player, VIAL, 1);
    player.setAttribute(BRAVERY_ATTRIBUTE, 1);
    player.sendMessage("You bravely swig down the entire contents of the vial. After a few seconds, you realise that you actually feel quite okay.");
  }

  function tieWinchRope(player, object) {
    if (Number(player.getAttribute(ROPE_ATTRIBUTE)) === 1) {
      player.sendMessage("You have already thrown a rope around this wooden beam.");
      return;
    }
    take(player, ROPE, 1);
    player.setAttribute(ROPE_ATTRIBUTE, 1);
    replaceObject(object, WINCH_ROPE);
    player.sendMessage("You throw a rope around the winch.");
  }

  function climbDownWinch(player, object) {
    if (object?.getId?.() === WINCH_NO_ROPE || Number(player.getAttribute(ROPE_ATTRIBUTE)) !== 1) {
      player.sendMessage("You see nothing special about this... perhaps with a rope, it might be a bit more functional.");
      return;
    }
    if (Number(player.getAttribute(BRAVERY_ATTRIBUTE)) !== 1) {
      player.sendMessage("You prepare to climb down the rope.");
      player.sendMessage("But a terrible fear grips you... and you can go no further.");
      return;
    }
    player.sendMessage("You prepare to climb down the rope.");
    player.sendMessage("Although fear stabs at your heart... you shimmy down the rope and into the darkness.");
    if (questStage(player) === STAGE_TALK_GUJUO_POOL) quest.setStage(player, STAGE_ENTER_LOWER);
    player.moveTo(new Location(LOWER_CAVES.x, LOWER_CAVES.y, LOWER_CAVES.z));
  }

  function placeCrystalInFurnace(player, itemId) {
    const bit = itemId === CHUNK_OF_CRYSTAL ? 1 : itemId === HUNK_OF_CRYSTAL ? 2 : 4;
    if (crystalBits(player) & bit) {
      player.sendMessage("You have already placed that piece of crystal into the furnace.");
      return;
    }
    take(player, itemId, 1);
    player.setAttribute(CRYSTALS_ATTRIBUTE, crystalBits(player) | bit);
    player.sendMessage("You place the piece of crystal into a specially-shaped compartment of the furnace.");
    if (crystalBits(player) !== 7) {
      player.sendMessage("The compartment looks like it needs more pieces.");
      return;
    }
    give(player, HEART_CRYSTAL, 1);
    if (questStage(player) === STAGE_ENTER_LOWER) quest.setStage(player, STAGE_CRYSTAL_SMELTED);
    player.sendMessage("The heat in the furnace slowly rises and soon fuses the parts together. As soon as the item cools, you pick it up.");
    player.sendMessage("As the crystal touches your hands a voice inside of your head says... Bring life to the dragons eye.");
  }

  function chargeHeartCrystal(player) {
    if (!held(player, HEART_CRYSTAL)) return;
    take(player, HEART_CRYSTAL, 1);
    give(player, HEART_CRYSTAL_2, 1);
    player.sendMessage("You carefully place the dragon crystal on the rock. The rocks seem to vibrate and hum and the crystal starts to glow.");
  }

  function placeHeartInRecess(player, object) {
    if (!held(player, HEART_CRYSTAL_2)) return;
    take(player, HEART_CRYSTAL_2, 1);
    replaceObject(object, RECESS_FULL);
    if (questStage(player) < STAGE_HEART_IN_RECESS) quest.setStage(player, STAGE_HEART_IN_RECESS);
    player.sendMessage("You carefully place the glowing heart shaped crystal into the depression. It slots in perfectly and glows even brighter.");
  }

  function passBarrier(player) {
    if (questStage(player) < STAGE_HEART_IN_RECESS) {
      player.sendMessage("You walk into an invisible barrier... Some kind of magical force will not allow you to pass into the cavern.");
      return;
    }
    player.moveTo(new Location(BARRIER_DESTINATION.x, BARRIER_DESTINATION.y, BARRIER_DESTINATION.z));
    if (questStage(player) === STAGE_HEART_IN_RECESS) quest.setStage(player, STAGE_PUSHED_BOULDER);
    ensureEchnedAndViyeldi(player);
    player.sendMessage("You walk carefully through the magical barrier and into the darkness of the cavern.");
  }

  function useBindingBook(player, target) {
    const stage = questStage(player);
    if (stage >= STAGE_DEFEATED_FIRE) {
      player.sendMessage("The demon is already banished from the shaman.");
      return;
    }
    if (stage < STAGE_FILLED_BOWL) {
      player.sendMessage("The book has no effect. Perhaps you should deal with the flames first.");
      return;
    }
    if (stage < STAGE_SUMMONED_FIRE) quest.setStage(player, STAGE_SUMMONED_FIRE);
    startTranscript(api, player, target?.getId?.() ?? NpcIdentifiers.UNGADULU, PAGE, "book-of-binding-using-the-binding-book-on-ungadulu");
    spawnNezikchened(player, 1);
  }

  function useHolyWaterOnUngadulu(player, target) {
    take(player, HOLY_WATER, 1);
    player.setAttribute(SOAKED_ATTRIBUTE, 1);
    startTranscript(api, player, target?.getId?.() ?? NpcIdentifiers.UNGADULU, PAGE, "book-of-binding-hitting-ungadulu-while-he-is-possessed-with-holy-water");
  }

  function giveHolyForce(player, target) {
    if (held(player, HOLY_FORCE)) {
      take(player, DARK_DAGGER, 1);
      player.sendMessage("Use the Holy Force spell that I gave you earlier to defeat this spirit.");
      return;
    }
    take(player, DARK_DAGGER, 1);
    give(player, HOLY_FORCE, 1);
    startTranscript(api, player, target?.getId?.() ?? NpcIdentifiers.UNGADULU, PAGE, "the-source-of-the-spring-using-the-dark-dagger-on-ungadulu-light-path");
  }

  function stabViyeldi(player, target) {
    take(player, DARK_DAGGER, 1);
    give(player, GLOWING_DAGGER, 1);
    player.setAttribute(VIYELDI_ATTRIBUTE, 1);
    startTranscript(api, player, target?.getId?.() ?? VIYELDI_ID, PAGE, "the-source-of-the-spring-killing-viyeldi-dark-path");
  }

  function castHolyForce(player, target) {
    take(player, HOLY_FORCE, 1);
    startTranscript(api, player, target?.getId?.() ?? ECHNED_ID, PAGE, "the-source-of-the-spring-using-the-holy-force-spell-on-echned-light-path");
    spawnNezikchened(player);
  }

  function giveGlowingDagger(player, target) {
    take(player, GLOWING_DAGGER, 1);
    startTranscript(api, player, target?.getId?.() ?? ECHNED_ID, PAGE, "the-source-of-the-spring-talking-to-echned-with-the-glowing-dagger-dark-path");
    spawnNezikchened(player);
  }

  function placeYommiTotem(player, object) {
    const stage = questStage(player);
    if (stage >= STAGE_REPLACED_TOTEM) {
      player.sendMessage("You have already replaced the evil totem pole with your own. You feel a great sense of accomplishment.");
      return;
    }
    if (stage >= STAGE_DEFEATED_FINAL) {
      take(player, YOMMI_TOTEM, 1);
      replaceObject(object, GOOD_TOTEM);
      quest.setStage(player, STAGE_REPLACED_TOTEM);
      spawnGujuo(player);
      player.sendMessage("You remove the evil totem pole and replace it with the one you carved yourself.");
      return;
    }
    if (stage < STAGE_COLLECTED_TOTEM) return;
    if (stage < STAGE_SPAWNED_FINAL) quest.setStage(player, STAGE_SPAWNED_FINAL);
    player.sendMessage("You attempt to replace the evil totem pole. A black cloud emanates from the evil totem pole and slowly forms into the dread demon Nezikchened.");
    spawnNezikchened(player);
  }

  function claimGuildTraining(player, option) {
    const stage = questStage(player);
    if (stage < STAGE_RETURNED || stage >= STAGE_TRAINING_4) return false;
    const key = String(option ?? "").replace(/\s*\*+\s*$/, "").trim().toLowerCase();
    const entry = TRAINING_SKILLS.find(([name]) => name === key);
    if (!entry) return false;
    const [, label, skill] = entry;
    player.getSkillManager().addExperiences(skill, 7650);
    player.sendMessage(`The training increases your ${label} experience.`);
    quest.setStage(player, stage + 5);
    return true;
  }

  // ==========================================================================
  // Transcript selection
  // ==========================================================================

  function selectVariant({ npcId, player }) {
    if (!quest || !player) return null;
    const stage = quest.getStage(player);
    if (GUARD_IDS.has(npcId)) {
      if (stage >= STAGE_COMPLETE) return "when-going-through-the-legends-guild-s-gates-after-the-quest";
      if (stage >= STAGE_RETURNED) return "when-going-through-the-legends-guild-s-gates-during-the-quest";
      if (stage >= STAGE_STARTED) return "starting-off-talking-to-a-guard-or-entering-exiting-the-guild-after-starting-the-quest";
      return "starting-off";
    }
    if (RADIMUS_IDS.has(npcId)) {
      if (stage >= STAGE_RETURNED) return "finishing-up-talking-to-radimus-inside-the-guild";
      if (stage >= STAGE_GOT_GILDED) return "finishing-up-returning-to-radimus-erkle";
      if (stage >= STAGE_STARTED) return "starting-off-talking-to-radimus-again";
      return "starting-off-talking-to-radimus-erkle";
    }
    if (FORESTER_IDS.has(npcId)) return "mapping-the-jungle-talking-to-a-jungle-forester";
    if (npcId === GUJUO_ID) {
      if (stage >= STAGE_GOT_GILDED) return "finishing-up-talking-to-gujuo-again";
      if (stage >= STAGE_REPLACED_TOTEM) return "finishing-up";
      if (stage >= STAGE_DEFEATED_FINAL) return "growing-the-yommi-tree-talking-to-gujuo-after-making-a-new-totem-pole";
      if (stage >= STAGE_COLLECTED_TOTEM) return "growing-the-yommi-tree-talking-to-gujuo";
      if (stage >= STAGE_DEFEATED_WATER) return "growing-a-yommi-tree-talking-to-gujou-again-after-learning-how-to-make-a-bravery-potion";
      if (stage === STAGE_POOL_DRIED || stage === STAGE_TALK_GUJUO_POOL) return "growing-a-yommi-tree-talking-to-gujuo";
      if (stage === STAGE_GERMINATED) return "growing-a-yommi-tree-talking-to-gujuo-after-germinating-the-seeds";
      if (stage === STAGE_DEFEATED_FIRE) return "growing-a-yommi-tree-talking-to-gujou";
      if (stage >= STAGE_ASKED_HOLY_WATER && hasAny(player, [GOLD_BOWL, BLESSED_GOLD_BOWL, GOLDEN_BOWL, GOLDEN_BOWL_2])) {
        return "metal-of-the-sun-talking-to-gujou-with-a-golden-bowl";
      }
      if (stage >= STAGE_SPOKE_UNGADULU) return "metal-of-the-sun";
      if (stage >= STAGE_ACCEPTED) return "contacting-the-kharazi-tribe-talking-to-gujuo-after-agreeing-to-help-find-ungadulu";
      return "contacting-the-kharazi-tribe-swinging-the-bullroarer-inside-the-kharazi-jungle";
    }
    if (UNGADULU_IDS.has(npcId)) {
      if (stage >= STAGE_REPLACED_TOTEM) return "finishing-up-talking-to-ungadulu";
      if (stage >= STAGE_COLLECTED_TOTEM) return "growing-the-yommi-tree-talking-to-ungadulu-after-making-a-new-totem-pole";
      if (stage >= STAGE_DEFEATED_WATER) return "growing-the-yommi-tree-talking-to-ungadulu";
      if (stage >= STAGE_TALK_GUJUO_POOL) return "the-source-of-the-spring-talking-to-ungadulu-after-reaching-the-source";
      if (stage >= STAGE_GERMINATED) return "growing-a-yommi-tree-talking-to-ungadulu";
      if (stage >= STAGE_DEFEATED_FIRE) return "growing-a-yommi-tree";
      if (stage >= STAGE_FOUND_ENTRANCE) {
        if (stage < STAGE_SPOKE_UNGADULU) quest.setStage(player, STAGE_SPOKE_UNGADULU);
        return "metal-of-the-sun-talking-to-ungadulu";
      }
      return null;
    }
    if (npcId === VIYELDI_ID) {
      if (held(player, DARK_DAGGER)) return "the-source-of-the-spring-killing-viyeldi-dark-path";
      return "into-the-viyeldi-caves-picking-up-the-blue-hat";
    }
    if (HERO_IDS.has(npcId)) return null; // heroes are attacked, not talked to
    if (npcId === ECHNED_ID) {
      if (stage >= STAGE_DEFEATED_WATER) return null;
      if (held(player, HOLY_FORCE)) return "the-source-of-the-spring-talking-to-echned-with-the-holy-force-spell-light-path";
      if (held(player, GLOWING_DAGGER)) return "the-source-of-the-spring-talking-to-echned-with-the-glowing-dagger-dark-path";
      if (held(player, DARK_DAGGER)) return "the-source-of-the-spring-talking-to-echned-again-after-agreeing-to-kill-viyeldi";
      return "the-source-of-the-spring";
    }
    return null;
  }

  // ==========================================================================
  // Prose conditions
  // ==========================================================================

  function answerCondition({ player, text, stepId }) {
    if (!player) return null;
    const value = String(text ?? "").toLowerCase();
    const has = (needle) => value.includes(needle);
    const stage = quest.getStage(player);

    switch (stepId) {
      // Identical prose is shared by the three crystal heroes.
      case "iHt2J9": return !held(player, LUMP_OF_CRYSTAL);
      case "OHfmhD": return held(player, LUMP_OF_CRYSTAL);
      case "rozy7q": return !held(player, HUNK_OF_CRYSTAL);
      case "KE35C4": return held(player, HUNK_OF_CRYSTAL);
      case "nrumZS": return !held(player, CHUNK_OF_CRYSTAL);
      case "mB0sPi": return held(player, CHUNK_OF_CRYSTAL);
      case "N3PgtM": return stage < STAGE_TRAINING_4;
      case "eqVGZN": return stage >= STAGE_TRAINING_4;
      case "FY1B9t": return !allMapped(player);
      case "WjqI-D": return allMapped(player);
      case "UIM5Xz": return allMapped(player);
      default: break;
    }

    if (has("interacting with the gate")) return true;
    if (has("interacting with a guard")) return false;
    if (has("not met all the requirements to start")) return !meetsRequirements(player);
    if (has("met all the requirements to start")) return meetsRequirements(player);
    if (has("doesn't have 30 coins")) return !held(player, COINS, 30);
    if (has("area has not been mapped yet")) return !allMapped(player);
    if (has("all areas have been mapped")) return allMapped(player);
    if (has("area has been mapped")) return allMapped(player);
    if (has("if successful")) return true;
    if (has("if unsuccessful")) return false;
    if (has("inside the fire wall")) return !has("unsuccessful");
    if (has("outside the fire wall")) return true;
    if (has("gets burnt")) return false;
    if (has("avoids getting burnt")) return true;
    if (has("doesn't have the sketch")) return !held(player, SKETCH);
    if (has("has the sketch")) return held(player, SKETCH);
    if (has("with only 1 gold bar")) return player.getInventory().getAmount(GOLD_BAR) === 1;
    if (has("with 2 gold bars")) return held(player, GOLD_BAR, 2);
    if (has("less than 42 prayer")) return skillLevel(player, Skill.PRAYER) < 42;
    if (has("at least 42 prayer")) return skillLevel(player, Skill.PRAYER) >= 42;
    if (has("before agreeing to help ungadulu")) return stage < STAGE_ACCEPTED;
    if (has("first time searching the rocks")) return stage === STAGE_ACCEPTED;
    if (has("looking at the crevice")) return true;
    if (has("searching the crevice")) return true;
    if (has("going further into the cave")) return true;
    if (has("one of the following is picked")) return true;
    if (has("soaked ungadulu with holy water")) return Number(player.getAttribute(SOAKED_ATTRIBUTE)) === 1;
    if (has("already has some seeds")) return hasAny(player, [YOMMI_TREE_SEEDS, YOMMI_TREE_SEEDS_2]);
    if (has("lost all their seeds")) return !hasAny(player, [YOMMI_TREE_SEEDS, YOMMI_TREE_SEEDS_2]);
    if (has("first interaction")) return Number(player.getAttribute(VIYELDI_ATTRIBUTE)) !== 1;
    if (has("subsequent interactions")) return Number(player.getAttribute(VIYELDI_ATTRIBUTE)) === 1;
    if (has("going up the slope")) return true;
    if (has("going down the slope")) return false;
    if (has("hold onto the ledge")) return true;
    if (has("fall down and don't take damage")) return false;
    if (has("fall down and take light damage")) return false;
    if (has("fall down and take major damage")) return false;
    if (has("without having the lump of crystal")) return !hasAny(player, [LUMP_OF_CRYSTAL, HUNK_OF_CRYSTAL, CHUNK_OF_CRYSTAL]);
    if (has("while having the lump of crystal")) return hasAny(player, [LUMP_OF_CRYSTAL, HUNK_OF_CRYSTAL, CHUNK_OF_CRYSTAL]);
    if (has("upon beginning to fight him")) return true;
    if (has("defeating him while not having")) return true;
    if (has("defeating him while already having")) return false;
    if (has("doesn't have the dark dagger")) return !held(player, DARK_DAGGER);
    if (has("has the dark dagger")) return held(player, DARK_DAGGER);
    if (has("if it misses")) return false;
    if (has("if it hits")) return true;
    if (has("from the wrong angle")) return false;
    if (has("from the correct angle")) return true;
    if (has("after it has already been pushed")) return stage >= STAGE_PUSHED_BOULDER;
    if (has("if there are still experience rewards to claim")) return stage < STAGE_TRAINING_4;
    if (has("if the final experience reward has been claimed")) return stage >= STAGE_TRAINING_4;
    return null;
  }

  // ==========================================================================
  // Hooks, choices and actions
  // ==========================================================================

  function handleStartHook({ player, hook }) {
    if (hook !== START_HOOK) return;
    if (quest.getStage(player) !== STAGE_NOT_STARTED) return;
    startQuest(player);
  }

  function handleChoice({ player, npcId, option }) {
    if (!player) return;
    const text = String(option ?? "").toLowerCase();
    if (RADIMUS_IDS.has(npcId)) {
      claimGuildTraining(player, option);
      return;
    }
    if (npcId === GUJUO_ID) {
      if (text.includes("go find ungadulu")) {
        noteStage(player, STAGE_ACCEPTED);
        despawn(player, GUJUO_ID);
      }
      if (text.includes("been sent by the legends")) noteStage(player, STAGE_SWUNG_BULLROARER);
      if (text.includes("i need some pure water")) noteStage(player, STAGE_ASKED_HOLY_WATER);
      if (text.includes("in search of the source") || text.includes("could you help me")) noteStage(player, STAGE_TALK_GUJUO_POOL);
      if (text.includes("bless") && skillLevel(player, Skill.PRAYER) >= 42) blessBowl(player);
      if (text.includes("lost the totem") && !held(player, GILDED_TOTEM)) give(player, GILDED_TOTEM, 1);
      return;
    }
    if (npcId === ECHNED_ID) {
      const accepts = text.includes("do what i must") || (text.startsWith("ok") && text.includes("do it"));
      if (accepts && questStage(player) < STAGE_RECEIVED_DAGGER) {
        if (!held(player, DARK_DAGGER) && !held(player, GLOWING_DAGGER)) give(player, DARK_DAGGER, 1);
        quest.setStage(player, STAGE_RECEIVED_DAGGER);
      }
      return;
    }
    if (UNGADULU_IDS.has(npcId)) {
      if (text.includes("yommi tree seeds") && !hasAny(player, [YOMMI_TREE_SEEDS, YOMMI_TREE_SEEDS_2])) {
        give(player, YOMMI_TREE_SEEDS, 3);
        player.sendMessage("Ungadulu gives you some more seeds.");
      }
      return;
    }
    if (FORESTER_IDS.has(npcId)) {
      if (text.includes("make a copy") && !held(player, BULLROARER)) {
        give(player, BULLROARER, 1);
        noteStage(player, STAGE_GOT_BULLROARER);
      }
    }
  }

  function handleAction(event) {
    const { player, stepId } = event;
    if (!player) return;
    if (stepId === COMPLETE_ACTION_ID) {
      if (!quest.isComplete(player)) quest.complete(player);
      event.handled = true;
      event.end = true;
      return;
    }
    if (stepId === HAND_IN_TOTEM_ACTION_ID) {
      if (questStage(player) >= STAGE_GOT_GILDED) {
        take(player, GILDED_TOTEM, 1);
        take(player, RADIMUS_NOTES_2, 1);
        quest.setStage(player, STAGE_RETURNED);
      }
      event.handled = true;
      return;
    }
    if (stepId === SKETCH_MESSAGE_ID) {
      if (!held(player, SKETCH) && freeSlots(player) >= 1) give(player, SKETCH, 1);
      noteStage(player, STAGE_ASKED_HOLY_WATER);
      return;
    }
    if (stepId === BOWL_BLESSED_MESSAGE_ID) {
      blessBowl(player);
      return;
    }
    if (FORESTER_BULLROARER_MESSAGE_IDS.has(stepId)) {
      if (!held(player, BULLROARER)) give(player, BULLROARER, 1);
      noteStage(player, STAGE_GOT_BULLROARER);
      return;
    }
    if (stepId === ECHNED_DAGGER_MESSAGE_ID) {
      if (!held(player, DARK_DAGGER) && !held(player, GLOWING_DAGGER)) give(player, DARK_DAGGER, 1);
      noteStage(player, STAGE_RECEIVED_DAGGER);
      return;
    }
    if (stepId === ECHNED_TAKES_DAGGER_MESSAGE_ID) {
      take(player, GLOWING_DAGGER, 1);
      return;
    }
    if (stepId === GILDED_TOTEM_MESSAGE_ID) {
      if (!held(player, GILDED_TOTEM)) give(player, GILDED_TOTEM, 1);
      noteStage(player, STAGE_GOT_GILDED);
      return;
    }
    if (stepId === GUIDE_TELEPORT_ACTION_ID) {
      player.moveTo(new Location(JUNGLE_EDGE.x, JUNGLE_EDGE.y, JUNGLE_EDGE.z));
      despawn(player, GUJUO_ID);
      return;
    }
    if (stepId === DAGGER_THROW_MESSAGE_ID) {
      if (Math.random() < 0.25) {
        player.sendMessage("But you neatly manage to dodge the attack.");
      } else {
        damage(player, 7 + Math.floor(Math.random() * 12));
      }
      return;
    }
  }

  // ==========================================================================
  // Items
  // ==========================================================================

  function handleItemAction(event) {
    const { player, itemId, option } = event;
    if (!player) return;
    const text = String(option ?? "").toLowerCase();
    if (itemId === BULLROARER) {
      useBullroarer(player);
      event.handled = true;
      return;
    }
    if (itemId === RADIMUS_NOTES && text.includes("mapping")) {
      mapJungle(player);
      event.handled = true;
      return;
    }
    if (itemId === BRAVERY_POTION && text.includes("drink")) {
      drinkBraveryPotion(player);
      event.handled = true;
      return;
    }
    if (itemId === GOLDEN_BOWL_4 || itemId === GOLDEN_BOWL_3 || itemId === GOLDEN_BOWL_2 || itemId === GOLDEN_BOWL) {
      if (text.includes("empty")) {
        emptyBowl(player, itemId);
        event.handled = true;
      }
      return;
    }
    if (itemId === RADIMUS_NOTES_2 && text.includes("read")) {
      player.sendMessage("The map of the Kharazi Jungle is complete! Radimus Erkle will be pleased.");
      event.handled = true;
    }
  }

  function handleItemOnItem(event) {
    const { player } = event;
    if (!player) return;
    const ids = [event.usedItemId, event.usedWithItemId];
    const isPair = (a, b) => (ids[0] === a && ids[1] === b) || (ids[0] === b && ids[1] === a);

    if (isPair(SKETCH, GOLD_BAR)) {
      smithGoldenBowl(player);
      event.handled = true;
      return;
    }
    if (isPair(GOLDEN_BOWL_4, YOMMI_TREE_SEEDS)) {
      germinateSeeds(player);
      event.handled = true;
      return;
    }
    if (isPair(BINDING_BOOK, VIAL)) {
      if (skillLevel(player, Skill.MAGIC) < 10 || skillLevel(player, Skill.PRAYER) < 10) {
        player.sendMessage("You need level 10 Magic and Prayer to cast this enchantment.");
      } else {
        take(player, VIAL, 1);
        give(player, ENCHANTED_VIAL, 1);
        player.sendMessage("You enchant a vial!");
      }
      event.handled = true;
      return;
    }
    if (isPair(ARDRIGAL, VIAL)) {
      take(player, ARDRIGAL, 1);
      take(player, VIAL, 1);
      give(player, ARDRIGAL_MIXTURE, 1);
      player.sendMessage("You mix the Ardrigal into the vial of water.");
      event.handled = true;
      return;
    }
    if (isPair(SNAKE_WEED, VIAL)) {
      take(player, SNAKE_WEED, 1);
      take(player, VIAL, 1);
      give(player, SNAKEWEED_MIXTURE, 1);
      player.sendMessage("You mix the snake weed into the vial of water.");
      event.handled = true;
      return;
    }
    if (isPair(ARDRIGAL_MIXTURE, SNAKEWEED_MIXTURE)) {
      makeBraveryPotion(player);
      event.handled = true;
    }
  }

  function handleItemOnNpc(event) {
    const { player, itemId } = event;
    const target = event.target;
    const npcId = target?.getId?.();
    if (!player || npcId === undefined) return;

    if (RADIMUS_IDS.has(npcId)) {
      if (itemId === RADIMUS_NOTES_2 && questStage(player) >= STAGE_GOT_GILDED) {
        startTranscript(api, player, npcId, PAGE, "finishing-up-returning-to-radimus-erkle");
      } else {
        startTranscript(api, player, npcId, PAGE, "starting-off-talking-to-radimus-again");
      }
      event.handled = true;
      return;
    }
    if (FORESTER_IDS.has(npcId) && itemId === RADIMUS_NOTES_2) {
      const variant = held(player, BULLROARER)
        ? "mapping-the-jungle-using-the-completed-notes-on-a-jungle-forester-using-the-completed-notes-on-a-jungle-forester-again"
        : "mapping-the-jungle-using-the-completed-notes-on-a-jungle-forester";
      startTranscript(api, player, npcId, PAGE, variant);
      event.handled = true;
      return;
    }
    if (npcId === GUJUO_ID) {
      const variant = hasAny(player, [GOLD_BOWL, BLESSED_GOLD_BOWL, GOLDEN_BOWL, GOLDEN_BOWL_2])
        ? "metal-of-the-sun-using-a-golden-bowl-on-gujou"
        : "metal-of-the-sun-using-any-other-item-on-gujou";
      startTranscript(api, player, npcId, PAGE, variant);
      event.handled = true;
      return;
    }
    if (UNGADULU_IDS.has(npcId)) {
      if (itemId === BINDING_BOOK) {
        useBindingBook(player, target);
        event.handled = true;
        return;
      }
      if (itemId === HOLY_WATER) {
        useHolyWaterOnUngadulu(player, target);
        event.handled = true;
        return;
      }
      if (itemId === DARK_DAGGER) {
        giveHolyForce(player, target);
        event.handled = true;
      }
      return;
    }
    if (npcId === VIYELDI_ID && itemId === DARK_DAGGER) {
      stabViyeldi(player, target);
      event.handled = true;
      return;
    }
    if (npcId === ECHNED_ID) {
      if (itemId === HOLY_FORCE) {
        castHolyForce(player, target);
        event.handled = true;
        return;
      }
      if (itemId === GLOWING_DAGGER) {
        giveGlowingDagger(player, target);
        event.handled = true;
        return;
      }
      if (itemId === DARK_DAGGER) {
        startTranscript(api, player, npcId, PAGE, "the-source-of-the-spring-using-the-dark-dagger-on-echned");
        event.handled = true;
      }
    }
  }

  // ==========================================================================
  // Objects
  // ==========================================================================

  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (!player) return;

    if (FIRE_WALLS.has(objectId)) {
      if (itemId === GOLDEN_BOWL_4) {
        useBowlDose(player);
        player.sendMessage("You splash some sacred water on the flames.");
        event.handled = true;
      } else if (itemId === GOLDEN_BOWL_3 || itemId === GOLDEN_BOWL_2 || itemId === GOLDEN_BOWL) {
        player.sendMessage("The water evaporates in a cloud of steam... before it gets anywhere near the flames.");
        emptyBowl(player, itemId);
        event.handled = true;
      }
      return;
    }
    if (objectId === FERTILE_SOIL && itemId === YOMMI_TREE_SEEDS_2) {
      plantYommiTree(player, event.object);
      event.handled = true;
      return;
    }
    if ((objectId === YOMMI_BABY || objectId === YOMMI_SAPLING) && itemId === GOLDEN_BOWL_4) {
      waterYommiTree(player, event.object);
      event.handled = true;
      return;
    }
    if (objectId === YOMMI_ADULT && itemId === RUNE_AXE) {
      chopYommiTree(player, event.object, YOMMI_ADULT, YOMMI_FELLED, "You chop the Yommi tree down.");
      event.handled = true;
      return;
    }
    if (objectId === YOMMI_FELLED && itemId === RUNE_AXE) {
      chopYommiTree(player, event.object, YOMMI_FELLED, YOMMI_TRIMMED, "and trim the branches from the Yommi Tree.");
      event.handled = true;
      return;
    }
    if (objectId === YOMMI_TRIMMED && itemId === RUNE_AXE) {
      carveTotem(player, event.object);
      event.handled = true;
      return;
    }
    if (REEDS === objectId && (itemId === KNIFE || itemId === MACHETE)) {
      cutReed(player);
      event.handled = true;
      return;
    }
    if (SACRED_POOL === objectId && itemId === HOLLOW_REED) {
      scoopSacredWater(player);
      event.handled = true;
      return;
    }
    if (WINCH_NO_ROPE === objectId && itemId === ROPE) {
      tieWinchRope(player, event.object);
      event.handled = true;
      return;
    }
    if (LEGENDS_FURNACE === objectId && (itemId === CHUNK_OF_CRYSTAL || itemId === HUNK_OF_CRYSTAL || itemId === LUMP_OF_CRYSTAL)) {
      placeCrystalInFurnace(player, itemId);
      event.handled = true;
      return;
    }
    if (DRAGONS_EYE_ROCK === objectId && itemId === HEART_CRYSTAL) {
      chargeHeartCrystal(player);
      event.handled = true;
      return;
    }
    if (RECESS_EMPTY === objectId && itemId === HEART_CRYSTAL_2) {
      placeHeartInRecess(player, event.object);
      event.handled = true;
      return;
    }
    if (CORRUPT_TOTEMS.has(objectId) && itemId === YOMMI_TOTEM) {
      placeYommiTotem(player, event.object);
      event.handled = true;
      return;
    }
    if (MARKED_WALL === objectId && RUNE_ORDER.includes(itemId)) {
      const count = runeCount(player);
      if (count >= RUNE_ORDER.length) {
        player.sendMessage("The wall already hangs open.");
        event.handled = true;
        return;
      }
      if (itemId !== RUNE_ORDER[count]) {
        player.sendMessage("The rune burns red hot in your hand!");
        damage(player, 5);
        event.handled = true;
        return;
      }
      take(player, itemId, 1);
      player.setAttribute(RUNES_ATTRIBUTE, count + 1);
      event.handled = true;
      if (count + 1 < RUNE_ORDER.length) {
        player.sendMessage(`You slide the rune into the ${count + 1}${count === 0 ? "st" : count === 1 ? "nd" : count === 2 ? "rd" : "th"} depression. It glows and merges with the wall.`);
        return;
      }
      player.sendMessage("You place the last rune and the illusory wall fades away, revealing a door.");
      player.moveTo(new Location(2774, 9301, 0));
      if (!held(player, BINDING_BOOK)) {
        give(player, BINDING_BOOK, 1);
        player.sendMessage("On a pedestal in the cavern you find a strange book - the Book of Binding.");
      }
      return;
    }
    if (MAGIC_GATES.has(objectId) && itemId === UNPOWERED_ORB) {
      take(player, UNPOWERED_ORB, 1);
      player.sendMessage("The orb attached to the door glows brightly as you charge it. The illusory doors fade away.");
      player.moveTo(new Location(2763, 9348, 0));
      event.handled = true;
    }
  }

  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    if (!player) return;

    if (ENTRANCE_ROCKS.has(objectId)) {
      event.handled = true;
      const stage = questStage(player);
      if (stage < STAGE_ACCEPTED) {
        player.sendMessage("You search the rocks but you see nothing significant.");
        return;
      }
      if (stage === STAGE_ACCEPTED) quest.setStage(player, STAGE_FOUND_ENTRANCE);
      if (skillLevel(player, Skill.AGILITY) < 50) {
        player.sendMessage("You need an Agility level of at least 50 to attempt to crawl through the crevice.");
        return;
      }
      player.sendMessage("You see that there is a small crevice that you may be able to crawl through.");
      player.sendMessage("You adroitly squeeze, serpent-like, into the crevice.");
      player.moveTo(new Location(SHAMAN_CAVE_ENTRANCE.x, SHAMAN_CAVE_ENTRANCE.y, SHAMAN_CAVE_ENTRANCE.z));
      return;
    }
    if (CAVE_EXITS.has(objectId)) {
      event.handled = true;
      player.sendMessage("You crawl back out from the cavern...");
      player.moveTo(new Location(SHAMAN_CAVE_EXIT.x, SHAMAN_CAVE_EXIT.y, SHAMAN_CAVE_EXIT.z));
      return;
    }
    if (FIRE_WALLS.has(objectId)) {
      event.handled = true;
      if (questStage(player) >= STAGE_DEFEATED_FIRE) {
        player.sendMessage("You feel completely fine to walk through these flames. The magic of Ungadulu's spell protects you.");
        moveAcross(player, event.location);
        return;
      }
      player.sendMessage("You approach the supernatural flames. They give off an incredibly intense heat.");
      if (Math.random() < 0.33) {
        player.sendMessage("You get too close and the intense heat burns you!");
        damage(player, 4);
      } else {
        player.sendMessage("You get close, but step back just in time to avoid getting burned.");
      }
      return;
    }
    if (OUTER_GATES.has(objectId)) {
      event.handled = true;
      if (!held(player, LOCKPICK) || skillLevel(player, Skill.THIEVING) < 50) {
        player.sendMessage("The doors have a huge locking mechanism. You need a lockpick and 50 Thieving.");
        return;
      }
      player.sendMessage("You tumble the lock mechanism and the door opens easily.");
      moveAcross(player, event.location);
      return;
    }
    if (MINING_BOULDERS.has(objectId)) {
      event.handled = true;
      if (skillLevel(player, Skill.MINING) < 52) {
        player.sendMessage("You need a Mining level of 52 to mine your way through this rock.");
        return;
      }
      player.sendMessage("You manage to smash the rock to bits.");
      player.sendMessage("Another boulder drops down behind you.");
      moveAcross(player, event.location, 2);
      return;
    }
    if (STRENGTH_GATES.has(objectId)) {
      event.handled = true;
      if (skillLevel(player, Skill.STRENGTH) < 50) {
        player.sendMessage("You'll need a Strength level of 50 to force these huge metal doors.");
        return;
      }
      player.sendMessage("You push and push... and you just manage to force the doors open slightly, just enough to force yourself through.");
      moveAcross(player, event.location);
      return;
    }
    if (JAGGED_WALL === objectId) {
      event.handled = true;
      if (skillLevel(player, Skill.AGILITY) < 50) {
        player.sendMessage("You need an Agility level of 50 to jump this wall.");
        return;
      }
      if (Math.random() < 0.7) {
        player.sendMessage("You take a good run up and sail majestically over the wall.");
      } else {
        player.sendMessage("You fail to jump the wall properly and clip it with your leg.");
        damage(player, 5);
      }
      moveAcross(player, event.location);
      return;
    }
    if (MARKED_WALL === objectId) {
      event.handled = true;
      if (runeCount(player) >= RUNE_ORDER.length) {
        player.sendMessage("You walk into the darkness of the magical doorway.");
        player.moveTo(new Location(2774, 9301, 0));
        return;
      }
      player.sendMessage("You find five slightly round depressions and some strange markings.");
      player.sendMessage("'Place five stones of magical power - but place them wrong, and your fate will sour.'");
      return;
    }
    if (CARVED_ROCK === objectId) {
      event.handled = true;
      player.sendMessage("You see a delicate inscription on the rock. 'Once there were crystals to make the pool shine. Ordered in stature to retrieve what's mine.'");
      return;
    }
    if (BURIED_SKELETON === objectId) {
      event.handled = true;
      player.sendMessage("It looks as if some poor unfortunate soul died here.");
      return;
    }
    if (SEARCH_TABLE === objectId || SEARCH_CRATE === objectId || SEARCH_BED === objectId || SEARCH_DESK === objectId) {
      event.handled = true;
      searchShamanRoom(player, objectId);
      return;
    }
    if (SEARCH_BOOKCASE === objectId) {
      event.handled = true;
      player.sendMessage("You search the bookcase, but find nothing of interest.");
      return;
    }
    if (SACRED_POOL === objectId) {
      event.handled = true;
      if (questStage(player) >= STAGE_GERMINATED && questStage(player) < STAGE_DEFEATED_WATER) {
        player.sendMessage("It looks as if this pool has dried up. A thick black sludge has replaced the sparkling pure water.");
      } else {
        player.sendMessage("A pretty babbling spring. The water bubbles with a strange effervescence.");
      }
      return;
    }
    if (POLLUTED_POOL === objectId) {
      event.handled = true;
      player.sendMessage("It looks as if this pool has dried up. A thick black sludge has replaced the sparkling pure water.");
      return;
    }
    if (REEDS === objectId) {
      event.handled = true;
      player.sendMessage("These tall reeds look nice and long with a tube for a stem.");
      return;
    }
    if (objectId === YOMMI_TOTEM_OBJECT) {
      event.handled = true;
      pickUpTotem(player, event.object);
      return;
    }
    if (WINCH_NO_ROPE === objectId || WINCH_ROPE === objectId) {
      event.handled = true;
      climbDownWinch(player, event.object);
      return;
    }
    if (CLIMBING_ROPE === objectId) {
      event.handled = true;
      player.sendMessage("You climb back up the rope to the Shaman Caves.");
      player.moveTo(new Location(CLIMB_BACK.x, CLIMB_BACK.y, CLIMB_BACK.z));
      return;
    }
    if (LEGENDS_FURNACE === objectId) {
      event.handled = true;
      player.sendMessage("This is an ancient looking furnace. Inside there is a compartment with strangely shaped sections.");
      return;
    }
    if (SHIMMERING_FIELD === objectId) {
      event.handled = true;
      passBarrier(player);
      return;
    }
    if (RECESS_EMPTY === objectId) {
      event.handled = true;
      player.sendMessage("You see a heart-shaped depression in the wall. A message reads... 'Place your full true heart within, and proceed...'");
      return;
    }
    if (RECESS_FULL === objectId) {
      event.handled = true;
      player.sendMessage("You see a magical, glowing crystal shape in the wall. It grants access to the cavern.");
      return;
    }
    if (CORRUPT_TOTEMS.has(objectId)) {
      event.handled = true;
      player.sendMessage("This totem pole looks corrupted. You don't like to look at it for too long.");
      return;
    }
    if (GOOD_TOTEM === objectId) {
      event.handled = true;
      player.sendMessage("This totem pole is truly awe inspiring. It depicts powerful Karamja jungle animals.");
      return;
    }
    if (GUILD_DOORS.has(objectId)) {
      if (questStage(player) < STAGE_COMPLETE) {
        event.handled = true;
        player.sendMessage("You need to complete the Legends' quest before you can enter the Legends' Guild.");
      }
    }
  }

  function searchShamanRoom(player, objectId) {
    if (objectId === SEARCH_TABLE && !held(player, A_SCRIBBLED_NOTE)) {
      give(player, A_SCRIBBLED_NOTE, 1);
      player.sendMessage("You find a scrap of paper with what looks like nonsense written on it.");
      return;
    }
    if (objectId === SEARCH_CRATE && !held(player, SCRAWLED_NOTE)) {
      give(player, SCRAWLED_NOTE, 1);
      player.sendMessage("After some time you find a scrumpled up piece of paper. It looks like rubbish.");
      return;
    }
    if (objectId === SEARCH_BED && !held(player, SCRUMPLED_NOTE)) {
      give(player, SCRUMPLED_NOTE, 1);
      player.sendMessage("You find a scrap of paper with spidery writing on it.");
      return;
    }
    if (objectId === SEARCH_DESK && !held(player, SHAMANS_TOME)) {
      give(player, SHAMANS_TOME, 1);
      player.sendMessage("You find an interesting tome. It looks heavy and very unique.");
      return;
    }
    player.sendMessage("You cannot find anything else in here.");
  }

  // ==========================================================================
  // NPC death and interaction
  // ==========================================================================

  function handleNpcDeath(event) {
    const player = event.killer ?? event.player;
    if (!player) return;
    const npcId = event.npcId;
    const stage = questStage(player);
    if (npcId === NEZIKCHENED_ID) {
      if (stage >= STAGE_SUMMONED_FIRE && stage < STAGE_DEFEATED_FIRE) {
        quest.setStage(player, STAGE_DEFEATED_FIRE);
        player.sendMessage("The demon vanishes, leaving nothing but a pile of ashes where he stood.");
        return;
      }
      if (stage >= STAGE_RECEIVED_DAGGER && stage < STAGE_DEFEATED_WATER) {
        quest.setStage(player, STAGE_DEFEATED_WATER);
        player.sendMessage("And its unearthly frame crumbles to dust.");
        return;
      }
      if (stage >= STAGE_SPAWNED_FINAL && stage < STAGE_DEFEATED_FINAL) {
        quest.setStage(player, STAGE_DEFEATED_FINAL);
        player.sendMessage("You deliver the final killing blow to the foul demon.");
        player.sendMessage("Nezikchened's unearthly frame crumbles into dust.");
        return;
      }
      return;
    }
    if (npcId === VIYELDI_ID && stage >= STAGE_RECEIVED_DAGGER && !held(player, GLOWING_DAGGER)) {
      give(player, GLOWING_DAGGER, 1);
      player.setAttribute(VIYELDI_ATTRIBUTE, 1);
      player.sendMessage("The dagger glows brightly as Viyeldi crumples to the floor.");
      return;
    }
    const hero = HERO_IDS.get(npcId);
    if (hero && stage >= STAGE_ENTER_LOWER) {
      if (!held(player, hero.itemId) && freeSlots(player) >= 1) {
        give(player, hero.itemId, 1);
        player.sendMessage(`A ${hero.label} of crystal forms mid-air and falls to the floor.`);
      }
    }
  }

  function handleNpcInteraction(event) {
    const { player, npcId, clickType } = event;
    if (!player || clickType !== 1) return;
    if (!RADIMUS_IDS.has(npcId) || npcId === NpcIdentifiers.RADIMUS_ERKLE) return;
    // The spawned Radimus ids are not in the dialogue index; play his quest page directly.
    const stage = questStage(player);
    let variant;
    if (stage >= STAGE_RETURNED) variant = "finishing-up-talking-to-radimus-inside-the-guild";
    else if (stage >= STAGE_GOT_GILDED && held(player, GILDED_TOTEM) && held(player, RADIMUS_NOTES_2)) {
      variant = "finishing-up-returning-to-radimus-erkle";
    } else if (stage >= STAGE_STARTED) variant = "starting-off-talking-to-radimus-again";
    else variant = "starting-off-talking-to-radimus-erkle";
    if (startTranscript(api, player, npcId, PAGE, variant)) event.handled = true;
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  function handleLogout({ player }) {
    if (player) clearSpawns(player);
  }

  // ==========================================================================
  // Journal
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Radimus Erkle set me the task of mapping the</str>",
        "<str>Kharazi Jungle and befriending the Kharazi tribe.</str>",
        "<str>I freed the shaman Ungadulu, defeated the demon</str>",
        "<str>Nezikchened and replaced the corrupted totem pole.</str>",
        "",
        "<str>I am now a member of the Legends' Guild.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_GOT_GILDED) {
      return [
        "Gujuo gave me a gilded totem pole as a token of friendship.",
        "I should take it, and the completed map, to <col=800000>Radimus Erkle</col>.",
      ];
    }
    if (stage >= STAGE_REPLACED_TOTEM) {
      return ["I replaced the corrupted totem pole.", "I should speak to <col=800000>Gujuo</col> for a token of friendship."];
    }
    if (stage >= STAGE_DEFEATED_FINAL) {
      return ["I defeated Nezikchened for the final time.", "I should replace the corrupted totem pole with my Yommi totem."];
    }
    if (stage >= STAGE_COLLECTED_TOTEM) {
      return ["I carved a Yommi totem pole.", "I must replace a corrupted totem pole somewhere in the Kharazi Jungle."];
    }
    if (stage >= STAGE_SACRED_WATER) {
      return [
        "I collected sacred water from the source.",
        "I should germinate the Yommi tree seeds and grow the sacred tree.",
      ];
    }
    if (stage >= STAGE_DEFEATED_WATER) {
      return ["I defeated Nezikchened at the source of the spring.", "I should fill my golden bowl with sacred water."];
    }
    if (stage >= STAGE_RECEIVED_DAGGER) {
      return [
        "A spirit called Echned Zekin gave me a dark dagger",
        "in return for killing Viyeldi. I should find Viyeldi.",
      ];
    }
    if (stage >= STAGE_HEART_IN_RECESS) {
      return ["I placed the glowing heart crystal in the recess.", "The way to the source lies through the shimmering barrier."];
    }
    if (stage >= STAGE_ENTER_LOWER) {
      return [
        "I climbed down the winch into the Viyeldi caves.",
        "I need three crystal pieces from the ancient heroes to make a heart crystal.",
      ];
    }
    if (stage >= STAGE_TALK_GUJUO_POOL) {
      return [
        "The sacred pool has dried up. Gujuo says the source",
        "lies deep underground, guarded by undead spirits.",
        "I need a bravery potion to climb down the winch.",
      ];
    }
    if (stage >= STAGE_POOL_DRIED) {
      return ["The sacred pool has dried up.", "I should ask <col=800000>Gujuo</col> what has happened."];
    }
    if (stage >= STAGE_DEFEATED_FIRE) {
      if (stage >= STAGE_GERMINATED) {
        return ["I germinated the Yommi tree seeds in sacred water.", "I should plant them in fertile soil in the Kharazi Jungle."];
      }
      return ["I freed Ungadulu from Nezikchened.", "I should ask him for Yommi tree seeds."];
    }
    if (stage >= STAGE_ASKED_HOLY_WATER) {
      return [
        "Ungadulu is trapped in a wall of fire.",
        "Gujuo told me I need pure water in a blessed golden vessel.",
        "I should make a golden bowl and have Gujuo bless it.",
      ];
    }
    if (stage >= STAGE_FOUND_ENTRANCE) {
      return ["I found the cave where Ungadulu is held.", "I should speak to him and find a way past the flames."];
    }
    if (stage >= STAGE_ACCEPTED) {
      return [
        "Gujuo asked me to free <col=800000>Ungadulu</col>.",
        "His cave is in the north west of the Kharazi Jungle,",
        "marked by three rocks and a palm.",
      ];
    }
    if (stage >= STAGE_SWUNG_BULLROARER) {
      return ["I met Gujuo of the Kharazi tribe.", "I should find out how to help his people."];
    }
    if (stage >= STAGE_GOT_BULLROARER) {
      return ["The jungle forester gave me a bullroarer.", "I should swing it inside the Kharazi Jungle to attract natives."];
    }
    if (stage >= STAGE_MAPPED) {
      return ["I completed the map of the Kharazi Jungle.", "I should show it to a jungle forester."];
    }
    if (stage >= STAGE_STARTED) {
      const bits = mapBits(player);
      return [
        "Radimus Erkle wants me to map the Kharazi Jungle",
        "and bring back a token from the Kharazi tribe.",
        "",
        `Eastern Kharazi Jungle - ${bits & 4 ? "mapped" : "not mapped"}`,
        `Middle Kharazi Jungle - ${bits & 2 ? "mapped" : "not mapped"}`,
        `Western Kharazi Jungle - ${bits & 1 ? "mapped" : "not mapped"}`,
      ];
    }
    return [
      "I can start this quest by speaking to <col=800000>Radimus Erkle</col>",
      "at the Legends' Guild north of Ardougne.",
      "",
      "I need 107 Quest Points, 50 in ten skills, and the",
      "following quests: Family Crest, Heroes' Quest,",
      "Shilo Village and Underground Pass.",
    ];
  }

  quest = registerQuest(api, {
    key: "legends_quest",
    name: "Legends' Quest",
    varpId: VARP_LEGENDS_QUEST,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 4,
    xpRewards: [],
    otherRewards: [
      "Access to the Legends' Guild",
      "7,650 XP in four skills of your choice",
    ],
    buildJournal,
    onReward: () => {},
  });

  api.persistAttribute(MAP_ATTRIBUTE);
  api.persistAttribute(BOWL_USES_ATTRIBUTE);
  api.persistAttribute(RUNES_ATTRIBUTE);
  api.persistAttribute(ROPE_ATTRIBUTE);
  api.persistAttribute(BRAVERY_ATTRIBUTE);
  api.persistAttribute(VIYELDI_ATTRIBUTE);
  api.persistAttribute(CRYSTALS_ATTRIBUTE);
  api.persistAttribute(SOAKED_ATTRIBUTE);

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onItemAction(handleItemAction);
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onObjectInteraction(handleObjectInteraction);
  api.onNpcInteraction(handleNpcInteraction);
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
