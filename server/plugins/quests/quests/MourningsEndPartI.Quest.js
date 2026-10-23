/**
 * Mourning's End Part I (members).
 *
 * The words come from the "Mourning's End Part I" transcript page (plus the
 * "Arianwyn" page's pre-quest line); this plugin supplies the variant selectors
 * for Eluned, Oronwen and the Seer, claims Arianwyn, Essyllt, the torture
 * gnome, Elena and Tegid by name (the ME2 plugin and the Biohazard/PlagueCity/
 * Eadgar's Ruse plugins share those NPCs), answers the wiki prose conditions,
 * and runs the disguise, device, sheep-dye, poison and food-store gameplay.
 *
 * Stage varp: 517 "mourning_quest" (a whole varp, no bits). Evidence:
 * `lookup-gameval.ts varp 517` prints "517 mourning_quest". The mechanics live
 * in the sibling varp 518 "mourning_quest_bits" as varbits 797/798-810/9149-9156;
 * Part II's stage is varbit 1103 over varp 574, which this plugin never writes.
 *
 * Stages (varp 517):
 *   1  STARTED       Eluned took you to Lletya and Arianwyn explained the task
 *   2  DISGUISE      the Arandar mourner is dead and its outfit is loose
 *   3  CLEANED       Tegid's soap and a bucket of water cleaned the top
 *   4  TROUSERS      Oronwen repaired the trousers (2 silk + bear fur)
 *   5  REPORTED      Arianwyn told you to enter the Mourner HQ
 *   6  RECRUIT       Essyllt accepted the letter and handed over device + key
 *   7  FIXED_DEVICE  the torture gnome released and fixed the device
 *   8  SHEEP         all four flocks re-dyed
 *   9  ORDERS        Essyllt wants a plague-like poison in the food supply
 *   10 ELENA         Elena explained the toxin and handed over a sieve
 *   11 TOXIN         the range evaporated the mixture into toxic powder
 *   12 STORES        two West Ardougne food stores contaminated
 *   13 PLAN          Essyllt revealed the Temple of Light search
 *   14 COMPLETE      Arianwyn told; quest complete (GT5Pn9)
 *
 * Mechanics varbits written (evidence: `lookup-gameval.ts varbit mourning`):
 *   797  mourning_can_see_eluned (varp 518 bit 0)  1 after the Lletya trip
 *   800  mourning_sheep_blue   (bit 12)            1 when blue is re-dyed
 *   801  mourning_sheep_red    (bit 13)            1 when red is re-dyed
 *   802  mourning_sheep_yellow (bit 14)            1 when yellow is re-dyed
 *   803  mourning_sheep_green  (bit 15)            1 when green is re-dyed
 *   804  mourning_gun_ammo     (bits 16-18)        1 while a toad is loaded
 *   9154 mourning_mourner_vis  (bit 29)            1 after the mourner is killed
 *
 * Object/ground ids (cache placements, `yarn dump:loc`):
 *   Laundry Basket 4039 at 2912,3418 (Taverley); Trapdoor 8783 at 2542,3327;
 *   Ladder 8785 at 2044,4650; Closed Chest 8797 at 2039,4633; Apple Press 8807
 *   at 2484,3374; Rotten Apple Pile 8809 at 2487,3374/2489,3373; the three
 *   food stores are mourning_sack_full1..3 37330-37332 (365 is unrelated
 *   generic scenery); Range 26181 at 2547,3322 and Cooking range 8750 in
 *   Lletya. Ground items: Barrel 3216 at 2487,3371; Rotten apple
 *   1984 at 2535,3333/2549,3332.
 * NPCs: Arandar mourner spawn 9233 -> content 9013 (level 11); Arianwyn 5292 ->
 * 9014 in Lletya; Essyllt 9235 -> 9016 at 2044,4628; Elena 4257 at 2592,3336;
 * Tegid 4766 at 2913,3417; Oronwen 1478 at 2324,3179; Seer 5231; swamp toads
 * 1473 in the Feldip Hills; sheep 3986-3989/5305-5308.
 *
 * Sources: OSRS Wiki "Mourning's End Part I" page, quick guide and transcript;
 * the cache for every id, varbit, placement and drop.
 *
 * Gaps / approximations:
 *  - The mourner outfit drops through npc-drops.json (content 9013); this plugin
 *    only advances the stage on its death. Its stat-drain special is not modelled.
 *  - The torture gnome is spawned per player (owner-only 5309) once Essyllt's key
 *    is held: the static spawn 6287 resolves to nothing at varbit 799's default,
 *    so varbit 799 is left alone rather than toggling the world spawn.
 *  - The "Aim and Fire" combat interface is not scripted; the loaded fixed device
 *    is used directly on a flock and the loaded toad's colour must match it.
 *  - Oronwen's incremental silk/fur item-on-NPC hand-ins are not scripted; her
 *    dialogue hands the trousers over when 2 silk and bear fur are carried.
 *  - The 50 Thieving, 60 Ranged, Roving Elves, Big Chompy Bird Hunting and
 *    Sheep Herder start requirements are enforced; the stat drain is not modelled.
 *  - HQ mourners (content 9017) are Attack-only in this cache, so the
 *    inside/outside headquarters variants are unreachable.
 *  - Entering the HQ needs the full mourner set equipped; the original
 *    "stopped by a mourner" flavour becomes a one-line refusal.
 */
module.exports = function registerMourningsEndPartIQuest(api) {
  const {
    CountdownTask,
    Equipment,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    ObjectIdentifiers,
    RegionManager,
    Skill,
    TaskManager,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const PAGE = "Mourning's End Part I";
  const ARIANWYN_PAGE = "Arianwyn";

  // ==========================================================================
  // Ids
  // ==========================================================================

  const ELUNED_IDS = new Set([
    NpcIdentifiers.ELUNED, // 8766
    NpcIdentifiers.ELUNED_2, // 5304
    NpcIdentifiers.ELUNED_3, // 8767
    NpcIdentifiers.ELUNED_4, // 8829
    NpcIdentifiers.ELUNED_5, // 8830
    NpcIdentifiers.ELUNED_6, // 9145
  ]);
  const ARIANWYN_IDS = new Set([
    NpcIdentifiers.ARIANWYN, // 3432
    NpcIdentifiers.ARIANWYN_3, // 8866
    NpcIdentifiers.ARIANWYN_4, // 8867
    NpcIdentifiers.ARIANWYN_5, // 8868
    NpcIdentifiers.ARIANWYN_6, // 9014, the Lletya spawn 5292 resolves here
  ]);
  const ESSYLLT_IDS = new Set([
    NpcIdentifiers.ESSYLLT, // 3415
    NpcIdentifiers.ESSYLLT_6, // 9016, the HQ spawn 9235 resolves here
  ]);
  const GNOME_IDS = new Set([
    NpcIdentifiers.GNOME_5, // 5309, the gnome on the rack
    NpcIdentifiers.GNOME_12, // 8848
  ]);
  const ELENA_IDS = new Set([
    NpcIdentifiers.ELENA, // 1102
    NpcIdentifiers.ELENA_2, // 4257, the East Ardougne house spawn
    NpcIdentifiers.ELENA_3, // 8791
    NpcIdentifiers.ELENA_4, // 8792
    NpcIdentifiers.ELENA_5, // 8793
    NpcIdentifiers.ELENA_6, // 8794
    NpcIdentifiers.ELENA_7, // 8795
    NpcIdentifiers.ELENA_8, // 8797
    NpcIdentifiers.ELENA_9, // 8798
    NpcIdentifiers.ELENA_10, // 8838
    NpcIdentifiers.ELENA_11, // 9148
  ]);
  const ORONWEN_ID = NpcIdentifiers.ORONWEN; // 1478
  const TEGID_ID = NpcIdentifiers.TEGID; // 4766
  const SEER_ID = NpcIdentifiers.SEER; // 5231
  const ELUNED_CHATHEAD = NpcIdentifiers.ELUNED; // 8766
  const GNOME_CHATHEAD = NpcIdentifiers.GNOME_5; // 5309
  const ARIANWYN_CHATHEAD = NpcIdentifiers.ARIANWYN; // 3432
  const ESSYLLT_CHATHEAD = NpcIdentifiers.ESSYLLT; // 3415
  const ELENA_CHATHEAD = NpcIdentifiers.ELENA; // 1102
  const ARANDAR_MOURNER_ID = NpcIdentifiers.MOURNER_17; // 9013, spawn 9233's content
  const SWAMP_TOAD_NPC_ID = NpcIdentifiers.SWAMP_TOAD; // 1473

  const TELEPORT_CRYSTAL_4 = ItemIdentifiers.TELEPORT_CRYSTAL_4_; // 6099
  const TELEPORT_CRYSTALS = new Set([
    TELEPORT_CRYSTAL_4,
    ItemIdentifiers.TELEPORT_CRYSTAL_3_, // 6100
    ItemIdentifiers.TELEPORT_CRYSTAL_2_, // 6101
    ItemIdentifiers.TELEPORT_CRYSTAL_1_, // 6102
    ItemIdentifiers.CRYSTAL_TELEPORT_SEED, // 6103
  ]);
  const GAS_MASK = ItemIdentifiers.GAS_MASK; // 1506
  const BLOODY_MOURNER_TOP = ItemIdentifiers.BLOODY_MOURNER_TOP; // 6064
  const MOURNER_TOP = ItemIdentifiers.MOURNER_TOP; // 6065
  const RIPPED_MOURNER_TROUSERS = ItemIdentifiers.RIPPED_MOURNER_TROUSERS; // 6066
  const MOURNER_TROUSERS = ItemIdentifiers.MOURNER_TROUSERS; // 6067
  const MOURNER_GLOVES = ItemIdentifiers.MOURNER_GLOVES; // 6068
  const MOURNER_BOOTS = ItemIdentifiers.MOURNER_BOOTS; // 6069
  const MOURNER_CLOAK = ItemIdentifiers.MOURNER_CLOAK; // 6070
  const MOURNER_LETTER = ItemIdentifiers.MOURNER_LETTER; // 6071
  const TEGIDS_SOAP = ItemIdentifiers.TEGIDS_SOAP; // 6072
  const BROKEN_DEVICE = ItemIdentifiers.BROKEN_DEVICE; // 6081
  const FIXED_DEVICE = ItemIdentifiers.FIXED_DEVICE; // 6082
  const TARNISHED_KEY = ItemIdentifiers.TARNISHED_KEY; // 6083
  const RED_DYE_BELLOWS = ItemIdentifiers.RED_DYE_BELLOWS; // 6085
  const BLUE_DYE_BELLOWS = ItemIdentifiers.BLUE_DYE_BELLOWS; // 6086
  const YELLOW_DYE_BELLOWS = ItemIdentifiers.YELLOW_DYE_BELLOWS; // 6087
  const GREEN_DYE_BELLOWS = ItemIdentifiers.GREEN_DYE_BELLOWS; // 6088
  const BLUE_TOAD = ItemIdentifiers.BLUE_TOAD; // 6089
  const RED_TOAD = ItemIdentifiers.RED_TOAD; // 6090
  const YELLOW_TOAD = ItemIdentifiers.YELLOW_TOAD; // 6091
  const GREEN_TOAD = ItemIdentifiers.GREEN_TOAD; // 6092
  const ROTTEN_APPLES = ItemIdentifiers.ROTTEN_APPLES; // 6093
  const APPLE_BARREL = ItemIdentifiers.APPLE_BARREL; // 6094
  const NAPHTHA_APPLE_MIX = ItemIdentifiers.NAPHTHA_APPLE_MIX; // 6095
  const TOXIC_NAPHTHA = ItemIdentifiers.TOXIC_NAPHTHA; // 6096
  const SIEVE = ItemIdentifiers.SIEVE; // 6097
  const TOXIC_POWDER = ItemIdentifiers.TOXIC_POWDER; // 6098
  const BUCKET_OF_WATER = ItemIdentifiers.BUCKET_OF_WATER; // 1929
  const SILK = ItemIdentifiers.SILK; // 950
  const BEAR_FUR = ItemIdentifiers.BEAR_FUR; // 948
  const FEATHER = ItemIdentifiers.FEATHER; // 314
  // The wiki transcript just calls these "toad crunchies"; Quest Helper also
  // accepts the premade and Aluft variants.
  const TOAD_CRUNCHIES_IDS = new Set([
    ItemIdentifiers.TOAD_CRUNCHIES, // 2217
    2243, // premade toad crunchies
    9538, // Aluft toad crunchies
  ]);
  const MAGIC_LOGS = ItemIdentifiers.MAGIC_LOGS; // 1513
  const LEATHER = ItemIdentifiers.LEATHER; // 1741
  const OGRE_BELLOWS = ItemIdentifiers.OGRE_BELLOWS; // 2871
  const ROTTEN_APPLE = ItemIdentifiers.ROTTEN_APPLE; // 1984, the sample near the HQ
  const BARREL = ItemIdentifiers.BARREL; // 1841
  const BARREL_2 = ItemIdentifiers.BARREL_2; // 3216, the orchard ground spawn
  const BARREL_OF_NAPHTHA = ItemIdentifiers.BARREL_OF_NAPHTHA; // 3221
  const RED_DYE = ItemIdentifiers.RED_DYE; // 1763
  const YELLOW_DYE = ItemIdentifiers.YELLOW_DYE; // 1765
  const BLUE_DYE = ItemIdentifiers.BLUE_DYE; // 1767
  const GREEN_DYE = ItemIdentifiers.GREEN_DYE; // 1771

  const LAUNDRY_BASKET = ObjectIdentifiers.LAUNDRY_BASKET; // 4039
  const HQ_TRAPDOOR = ObjectIdentifiers.TRAPDOOR_38; // 8783 at 2542,3327
  const HQ_LADDER = ObjectIdentifiers.LADDER_84; // 8785 at 2044,4650
  const DEVICE_CHEST = ObjectIdentifiers.CLOSED_CHEST_15; // 8797 at 2039,4633
  // The torture-chamber doors have no open variant in the cache, so the quest
  // itself walks the player through them: 8788 at 2037,4633 and 8789 at 2034,4636.
  const HQ_TORTURE_DOORS = new Set([
    ObjectIdentifiers.DOOR_204, // 8788
    ObjectIdentifiers.DOOR_205, // 8789
  ]);
  // The rack is placed as the nameless 8794, which transforms to 8795
  // "Gnome on a rack" (Talk-to / Release) while the gnome sits on it.
  const GNOME_RACK = 8794;
  const GNOME_RACK_IDS = new Set([GNOME_RACK, ObjectIdentifiers.COL_FFFF00_GNOME_ON_A_RACK_COL]);
  const APPLE_PRESS = ObjectIdentifiers.APPLE_PRESS; // 8807
  const ROTTEN_APPLE_PILE = ObjectIdentifiers.ROTTEN_APPLE_PILE; // 8809
  // The three West Ardougne food stores are the mourning_sack_full1..3 base
  // locs (gameval); 365 is the unrelated generic "Sacks" scenery family.
  const FOOD_STORE_IDS = new Set([37330, 37331, 37332]);
  const RANGE_OBJECT_IDS = new Set([
    ObjectIdentifiers.RANGE_12, // 26181, the HQ ground floor and most ranges
    ObjectIdentifiers.COOKING_RANGE_3, // 8750, the Lletya ranges
  ]);

  const HQ_BASEMENT = { x: 2044, y: 4649, z: 0 };
  const HQ_TRAPDOOR_TILE = { x: 2542, y: 3328, z: 0 };
  const LLETYA_SQUARE = { x: 2352, y: 3170, z: 0 };
  const GNOME_SPAWN = { x: 2036, y: 4630, z: 0 };

  const VARP_MOURNINGS_END_PART_I = 517; // mourning_quest
  const VARBIT_SEE_ELUNED = 797; // mourning_can_see_eluned
  const VARBIT_MOURNER_VIS = 9154; // mourning_mourner_vis
  const VARBIT_GUN_AMMO = 804; // mourning_gun_ammo
  const SHEEP_VARBIT_BY_COLOUR = new Map([
    ["red", 801], // mourning_sheep_red
    ["green", 803], // mourning_sheep_green
    ["blue", 800], // mourning_sheep_blue
    ["yellow", 802], // mourning_sheep_yellow
  ]);

  const STAGE_STARTED = 1;
  const STAGE_DISGUISE = 2;
  const STAGE_CLEANED = 3;
  const STAGE_TROUSERS = 4;
  const STAGE_REPORTED = 5;
  const STAGE_RECRUIT = 6;
  const STAGE_FIXED_DEVICE = 7;
  const STAGE_SHEEP = 8;
  const STAGE_ORDERS = 9;
  const STAGE_ELENA = 10;
  const STAGE_TOXIN = 11;
  const STAGE_STORES = 12;
  const STAGE_PLAN = 13;
  const STAGE_COMPLETE = 14;

  const GNOME_STATE_ATTRIBUTE = "quest.mournings_end_part_i.gnome";
  const GNOME_PARCELS_ATTRIBUTE = "quest.mournings_end_part_i.gnome-parcels";
  const SHEEP_ATTRIBUTE = "quest.mournings_end_part_i.sheep";
  const STORES_ATTRIBUTE = "quest.mournings_end_part_i.stores";
  const TEGID_ATTRIBUTE = "quest.mournings_end_part_i.tegid";

  const SHEEP_BIT_BY_COLOUR = new Map([
    ["red", 1 << 0],
    ["green", 1 << 1],
    ["blue", 1 << 2],
    ["yellow", 1 << 3],
  ]);
  const SHEEP_COLOUR_BY_NPC = new Map([
    [3986, "red"],
    [5305, "red"],
    [3987, "green"],
    [5306, "green"],
    [3988, "blue"],
    [5307, "blue"],
    [3989, "yellow"],
    [5308, "yellow"],
  ]);
  const SHEEP_NPC_IDS = new Set(SHEEP_COLOUR_BY_NPC.keys());

  const BELLOWS_BY_DYE = new Map([
    [RED_DYE, RED_DYE_BELLOWS],
    [YELLOW_DYE, YELLOW_DYE_BELLOWS],
    [BLUE_DYE, BLUE_DYE_BELLOWS],
    [GREEN_DYE, GREEN_DYE_BELLOWS],
  ]);
  const TOAD_BY_BELLOWS = new Map([
    [RED_DYE_BELLOWS, RED_TOAD],
    [YELLOW_DYE_BELLOWS, YELLOW_TOAD],
    [BLUE_DYE_BELLOWS, BLUE_TOAD],
    [GREEN_DYE_BELLOWS, GREEN_TOAD],
  ]);
  const COLOUR_BY_TOAD = new Map([
    [RED_TOAD, "red"],
    [YELLOW_TOAD, "yellow"],
    [BLUE_TOAD, "blue"],
    [GREEN_TOAD, "green"],
  ]);

  // ==========================================================================
  // Transcript step ids on the "Mourning's End Part I" page
  // ==========================================================================

  const CONDITION_STEP_IDS = new Set([
    "IUmRNv", "v_lhjc", "Wamzez", "FwAIoK", "c_p6AK", "TCt6hQ", "bkuvDV",
    "Q_wXNE", "jkLHwe", "ntFDQi", "8Ooc-z", "v-W9YJ", "x5myQ4", "EMtyHI",
    "qtJbss", "GWQRtW", "cCmPae", "Cwe2SE", "gybbui", "SNaRxB", "v1GQbT",
    "uZx-_Z", "H02re8", "5maQBO", "wm9swJ", "zZCOTk",
  ]);
  const ACTION_STEP_IDS = new Set([
    "QRsYJW", "qEuEsp", "RI034J", "OVpPAl", "PF2IWD", "HUqB2R", "HpLBIl",
    "Rdmsd6", "_c6TLF", "OOPznE", "t1l8Is", "im129e", "OiyR9-", "dSnuKD",
    "GT5Pn9",
  ]);
  const GNOME_AGREE_OPTION = "toad crunchies and being tickled";
  const START_HOOK = "quest:mourning-s-end-part-i:start";

  let quest;
  const spawnedGnomeByPlayer = new Map();
  const loadedToadByPlayer = new Map();

  // ==========================================================================
  // Small state helpers
  // ==========================================================================

  function questComplete(player, key) {
    const request = { player, key, complete: null };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;
  const give = (player, itemId, amount = 1) => player.getInventory().adds(itemId, amount);
  const take = (player, itemId, amount = 1) => player.getInventory().deleteNumber(itemId, amount);

  function activateTeleportCrystal(event) {
    const { player, itemId } = event ?? {};
    if (!player || !TELEPORT_CRYSTALS.has(itemId) || itemId === ItemIdentifiers.CRYSTAL_TELEPORT_SEED) return;
    event.handled = true;
    take(player, itemId, 1);
    if (itemId < ItemIdentifiers.TELEPORT_CRYSTAL_1_) give(player, itemId + 1, 1);
    else give(player, ItemIdentifiers.CRYSTAL_TELEPORT_SEED, 1);
    player.moveTo(new Location(LLETYA_SQUARE.x, LLETYA_SQUARE.y, LLETYA_SQUARE.z));
    player.sendMessage("You activate the teleport crystal and arrive in Lletya.");
  }

  function advance(player, stage) {
    if (quest.getStage(player) < stage) quest.setStage(player, stage);
  }

  function wearingFullMournerGear(player) {
    const equipment = player.getEquipment();
    const worn = (slot, itemId) => equipment.get(slot)?.getId?.() === itemId;
    return (
      worn(Equipment.HEAD_SLOT, GAS_MASK) &&
      worn(Equipment.CAPE_SLOT, MOURNER_CLOAK) &&
      worn(Equipment.BODY_SLOT, MOURNER_TOP) &&
      worn(Equipment.LEG_SLOT, MOURNER_TROUSERS) &&
      worn(Equipment.HANDS_SLOT, MOURNER_GLOVES) &&
      worn(Equipment.FEET_SLOT, MOURNER_BOOTS)
    );
  }

  function hasCleanTop(player) {
    if (held(player, MOURNER_TOP)) return true;
    return player.getEquipment().get(Equipment.BODY_SLOT)?.getId?.() === MOURNER_TOP;
  }

  function hasFixedTrousers(player) {
    if (held(player, MOURNER_TROUSERS)) return true;
    return player.getEquipment().get(Equipment.LEG_SLOT)?.getId?.() === MOURNER_TROUSERS;
  }

  function hasDisguiseReady(player) {
    return hasCleanTop(player) && hasFixedTrousers(player);
  }

  function hasTrouserMaterials(player) {
    return held(player, SILK, 2) && held(player, BEAR_FUR, 1);
  }

  function hasGnomeMaterials(player) {
    return held(player, MAGIC_LOGS, 1) && held(player, LEATHER, 1);
  }

  function sheepBits(player) {
    return Number(player.getAttribute(SHEEP_ATTRIBUTE)) || 0;
  }

  function sheepBitSet(player, colour) {
    return (sheepBits(player) & SHEEP_BIT_BY_COLOUR.get(colour)) !== 0;
  }

  function allSheepDyed(player) {
    for (const bit of SHEEP_BIT_BY_COLOUR.values()) {
      if ((sheepBits(player) & bit) === 0) return false;
    }
    return true;
  }

  function gnomeState(player) {
    return Number(player.getAttribute(GNOME_STATE_ATTRIBUTE)) || 0;
  }

  function storesPoisoned(player) {
    const raw = String(player.getAttribute(STORES_ATTRIBUTE) ?? "");
    return raw ? raw.split(",").filter(Boolean) : [];
  }

  function hasToadCrunchies(player) {
    for (const itemId of TOAD_CRUNCHIES_IDS) if (held(player, itemId)) return true;
    return false;
  }

  function takeToadCrunchies(player) {
    for (const itemId of TOAD_CRUNCHIES_IDS) {
      if (held(player, itemId)) {
        take(player, itemId, 1);
        return true;
      }
    }
    return false;
  }

  function play(player, npcId, variant, select) {
    return startTranscript(api, player, npcId, PAGE, variant, select);
  }

  /** The steps after a top-level step id (for replaying only a variant's tail). */
  function selectAfter(steps, stepId) {
    if (!Array.isArray(steps)) return steps;
    const index = steps.findIndex((step) => step && step.id === stepId);
    return index === -1 ? steps : steps.slice(index + 1);
  }

  /** Opens a follow-up conversation next tick, after the current chatbox closes. */
  function deferPlay(player, npcId, variant, select) {
    if (!CountdownTask || !TaskManager) {
      play(player, npcId, variant, select);
      return;
    }
    TaskManager.submit(new CountdownTask(player, 1, () => play(player, npcId, variant, select)));
  }

  // ==========================================================================
  // Variant selectors (NpcDialogues pages this plugin owns)
  // ==========================================================================

  /** Eluned starts the quest: only answer while ME1 has not begun. */
  function elunedVariant(player) {
    if (quest.getStage(player) !== 0) return null;
    if (!questComplete(player, "roving_elves")) return null;
    return "in-need-of-your-skills";
  }

  function oronwenVariant(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_DISGUISE || stage >= STAGE_REPORTED) return null;
    if (!held(player, RIPPED_MOURNER_TROUSERS) || hasFixedTrousers(player)) return null;
    return hasTrouserMaterials(player)
      ? "the-mourner-s-disguise-trousers"
      : "the-mourner-s-disguise-trousers-talking-to-oronwen-before-giving-the-items-without-all-necessary-items";
  }

  function tegidVariant(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_DISGUISE || stage >= STAGE_REPORTED) return null;
    player.setAttribute(TEGID_ATTRIBUTE, 1);
    return "the-mourner-s-disguise-talking-to-tegid";
  }

  function seerVariant(player) {
    const stage = quest.getStage(player);
    if (stage !== STAGE_DISGUISE) return null;
    if (!held(player, BLOODY_MOURNER_TOP)) return null;
    return "the-mourner-s-disguise-talking-to-a-seer-about-the-bloody-top";
  }

  function selectVariant({ npcId, player }) {
    if (!player) return null;
    if (ELUNED_IDS.has(npcId)) return elunedVariant(player);
    if (npcId === ORONWEN_ID) return oronwenVariant(player);
    if (npcId === TEGID_ID) return tegidVariant(player);
    if (npcId === SEER_ID) return seerVariant(player);
    return null;
  }

  // ==========================================================================
  // Prose condition answers
  // ==========================================================================

  function answerCondition({ player, stepId }) {
    if (!player || !CONDITION_STEP_IDS.has(stepId)) return null;
    switch (stepId) {
      case "IUmRNv":
        return questComplete(player, "eadgars_ruse");
      case "v_lhjc":
        return player.getInventory().isFull();
      case "Wamzez":
        return hasTrouserMaterials(player);
      case "FwAIoK":
      case "c_p6AK":
      case "TCt6hQ":
      case "bkuvDV":
        return false; // only reached by Oronwen's item-on-NPC variant, not scripted
      case "Q_wXNE":
        return !held(player, BROKEN_DEVICE) && !held(player, TARNISHED_KEY);
      case "jkLHwe":
        return !held(player, BROKEN_DEVICE);
      case "ntFDQi":
        return !held(player, TARNISHED_KEY);
      case "8Ooc-z":
        return !hasGnomeMaterials(player);
      case "v-W9YJ":
        return hasGnomeMaterials(player);
      case "x5myQ4":
        return !held(player, LEATHER);
      case "EMtyHI":
        return !held(player, MAGIC_LOGS);
      case "qtJbss":
      case "Cwe2SE":
        return questComplete(player, "big_chompy_bird_hunting");
      case "GWQRtW":
      case "gybbui":
        return held(player, OGRE_BELLOWS);
      case "cCmPae":
      case "SNaRxB":
        return false; // no bank check; the inventory line is enough
      case "v1GQbT":
      case "wm9swJ":
      case "zZCOTk":
        return wearingFullMournerGear(player);
      case "uZx-_Z":
        return !wearingFullMournerGear(player);
      case "H02re8":
        return !held(player, ROTTEN_APPLE);
      case "5maQBO":
        return held(player, ROTTEN_APPLE);
      default:
        return null;
    }
  }

  // ==========================================================================
  // Transcript hand-ins and messages
  // ==========================================================================

  function handleAction(event) {
    const { player, stepId } = event;
    if (!player || !stepId || !ACTION_STEP_IDS.has(stepId)) return;
    switch (stepId) {
      case "QRsYJW":
        // "Eluned takes you to Lletya."
        player.moveTo(new Location(LLETYA_SQUARE.x, LLETYA_SQUARE.y, LLETYA_SQUARE.z));
        return;
      case "qEuEsp": {
        // "Eluned hands you a tiny crystal seed."
        if (![...TELEPORT_CRYSTALS].some((itemId) => held(player, itemId))) {
          give(player, TELEPORT_CRYSTAL_4, 1);
        }
        player.getPacketSender().sendVarbit(VARBIT_SEE_ELUNED, 1);
        advance(player, STAGE_STARTED);
        return;
      }
      case "RI034J":
        if (!held(player, TEGIDS_SOAP)) give(player, TEGIDS_SOAP, 1);
        return;
      case "OVpPAl":
      case "PF2IWD":
        repairTrousers(player);
        return;
      case "HUqB2R":
        if (held(player, MOURNER_LETTER)) take(player, MOURNER_LETTER, 1);
        return;
      case "HpLBIl": {
        if (!held(player, TARNISHED_KEY)) give(player, TARNISHED_KEY, 1);
        if (!held(player, BROKEN_DEVICE) && !held(player, FIXED_DEVICE)) give(player, BROKEN_DEVICE, 1);
        advance(player, STAGE_RECRUIT);
        return;
      }
      case "Rdmsd6":
        if (!held(player, BROKEN_DEVICE) && !held(player, FIXED_DEVICE)) give(player, BROKEN_DEVICE, 1);
        if (!held(player, TARNISHED_KEY)) give(player, TARNISHED_KEY, 1);
        return;
      case "_c6TLF":
        if (!held(player, BROKEN_DEVICE) && !held(player, FIXED_DEVICE)) give(player, BROKEN_DEVICE, 1);
        return;
      case "OOPznE":
        if (!held(player, TARNISHED_KEY)) give(player, TARNISHED_KEY, 1);
        return;
      case "t1l8Is": {
        // "You release the gnome and hand him the magic logs, soft leather and
        // the strange device along with some toad crunchies."
        if (held(player, MAGIC_LOGS)) take(player, MAGIC_LOGS, 1);
        if (held(player, LEATHER)) take(player, LEATHER, 1);
        takeToadCrunchies(player);
        if (held(player, BROKEN_DEVICE)) take(player, BROKEN_DEVICE, 1);
        if (!held(player, FIXED_DEVICE)) give(player, FIXED_DEVICE, 1);
        advance(player, STAGE_FIXED_DEVICE);
        return;
      }
      case "im129e":
        // "Elena hands you a large sieve."
        if (!held(player, SIEVE)) give(player, SIEVE, 1);
        advance(player, STAGE_ELENA);
        return;
      case "OiyR9-":
        if (held(player, ROTTEN_APPLE)) take(player, ROTTEN_APPLE, 1);
        return;
      case "dSnuKD":
        // "You hand Elena the rotten apple." The page's continuation ("Ick...
        // Alright then let's get started.") lives on the sample-return variant
        // and is replayed next tick, but that replay can be lost with the chatbox
        // state; hand the sieve over here too (the tail's im129e is idempotent).
        event.handled = true;
        event.end = true;
        if (held(player, ROTTEN_APPLE)) take(player, ROTTEN_APPLE, 1);
        if (!held(player, SIEVE)) give(player, SIEVE, 1);
        advance(player, STAGE_ELENA);
        deferPlay(player, ELENA_CHATHEAD, "earning-their-trust-for-the-greater-good-returning-with-the-sample", (steps) =>
          selectAfter(steps, "OiyR9-")
        );
        return;
      case "GT5Pn9":
        // "Congratulations! Quest complete!"
        event.handled = true;
        if (quest.getStage(player) >= STAGE_PLAN && !quest.isComplete(player)) {
          quest.complete(player);
        }
        return;
      default:
        return;
    }
  }

  function repairTrousers(player) {
    if (!held(player, RIPPED_MOURNER_TROUSERS)) return;
    take(player, RIPPED_MOURNER_TROUSERS, 1);
    if (held(player, SILK, 2)) take(player, SILK, 2);
    if (held(player, BEAR_FUR)) take(player, BEAR_FUR, 1);
    if (!held(player, MOURNER_TROUSERS)) give(player, MOURNER_TROUSERS, 1);
    advance(player, STAGE_TROUSERS);
  }

  /**
   * Roving Elves' post-quest Islwyn answers "Yes." with this hook, and the
   * canonical continuation is Eluned's "in need of your skills" page (she
   * takes the player to Lletya and hands over the crystal seed).
   */
  function handleDialogueHook(event) {
    const { player, hook } = event ?? {};
    if (!player || hook !== START_HOOK) return;
    if (quest.getStage(player) !== 0) return;
    if (!meetsStartRequirements(player)) {
      player.sendMessage("You do not meet all of the requirements to start Mourning's End Part I.");
      return;
    }
    advance(player, STAGE_STARTED);
    deferPlay(player, ELUNED_CHATHEAD, "in-need-of-your-skills");
  }

  function meetsStartRequirements(player) {
    const skills = player.getSkillManager();
    return questComplete(player, "roving_elves")
      && questComplete(player, "big_chompy_bird_hunting")
      && questComplete(player, "sheep_herder")
      && skills.getMaxLevel(Skill.RANGED) >= 60
      && skills.getMaxLevel(Skill.THIEVING) >= 50;
  }

  function answerStartRequirementQuery(request) {
    if (!request?.player) return;
    request.started = quest.getStage(request.player) > 0;
    request.meetsRequirements = meetsStartRequirements(request.player);
  }

  /** The gnome's "toad crunchies and being tickled" choice is the bargain. */
  function handleChoice(event) {
    const { player, npcId, option } = event;
    if (!player || !GNOME_IDS.has(npcId)) return;
    if (String(option ?? "").toLowerCase().includes(GNOME_AGREE_OPTION)) {
      player.setAttribute(GNOME_STATE_ATTRIBUTE, 1);
    }
  }

  // ==========================================================================
  // NPC Talk-to handlers (name hooks, claimed before NpcDialogues plays)
  // ==========================================================================

  function arianwynVariant(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return null;
    if (stage === 0) {
      return { page: ARIANWYN_PAGE, variant: "talking-to-arianwyn-before-starting-mourning-s-end-part-i" };
    }
    if (stage === STAGE_STARTED) return { page: PAGE, variant: "in-need-of-your-skills" };
    if (stage >= STAGE_PLAN) return { page: PAGE, variant: "the-mourners-plan-reporting-back-to-arianwyn" };
    if (stage >= STAGE_ORDERS) {
      return { page: PAGE, variant: "earning-their-trust-for-the-greater-good-reporting-to-arianwyn" };
    }
    if (stage >= STAGE_REPORTED) return { page: PAGE, variant: "earning-their-trust-reporting-to-arianwyn" };
    if (hasDisguiseReady(player)) return { page: PAGE, variant: "the-mourner-s-disguise-reporting-to-arianwyn" };
    return { page: PAGE, variant: "the-mourner-s-disguise-asking-arianwyn-for-help-with-the-bloody-top-and-ripped-trousers" };
  }

  function talkToArianwyn(event) {
    const { player } = event;
    if (!player || !ARIANWYN_IDS.has(event.npcId)) return false;
    const choice = arianwynVariant(player);
    if (!choice) return false;
    event.handled = true;
    if (choice.variant === "the-mourner-s-disguise-reporting-to-arianwyn") {
      advance(player, STAGE_REPORTED);
    }
    startTranscript(api, player, event.npcId, choice.page, choice.variant);
    return true;
  }

  function essylltVariant(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_REPORTED || stage >= STAGE_COMPLETE) return null;
    if (stage < STAGE_RECRUIT) return "earning-their-trust-new-recruit";
    if (stage < STAGE_SHEEP) return "earning-their-trust-new-recruit-lost-items";
    if (stage < STAGE_ORDERS) return "earning-their-trust-for-the-greater-good-new-orders";
    if (stage < STAGE_STORES) return "earning-their-trust-for-the-greater-good-talking-to-essyllt-again";
    if (stage < STAGE_PLAN) return "the-mourners-plan";
    return "the-mourners-plan-talking-to-essyllt-again";
  }

  function talkToEssyllt(event) {
    const { player } = event;
    if (!player || !ESSYLLT_IDS.has(event.npcId)) return false;
    const variant = essylltVariant(player);
    if (!variant) return false;
    event.handled = true;
    if (variant === "earning-their-trust-for-the-greater-good-new-orders") {
      advance(player, STAGE_ORDERS);
    } else if (variant === "the-mourners-plan") {
      advance(player, STAGE_PLAN);
    }
    play(player, ESSYLLT_CHATHEAD, variant);
    return true;
  }

  function gnomeVariant(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_RECRUIT || stage >= STAGE_COMPLETE) return null;
    if (stage >= STAGE_FIXED_DEVICE) {
      if (stage >= STAGE_STORES) return "earning-their-trust-contaminating-the-stores-talking-to-the-gnome-again";
      if (Number(player.getAttribute(GNOME_PARCELS_ATTRIBUTE)) === 1) {
        return "earning-their-trust-it-s-a-deal-talking-to-the-gnome-again-2";
      }
      player.setAttribute(GNOME_PARCELS_ATTRIBUTE, 1);
      return "earning-their-trust-it-s-a-deal-talking-to-the-gnome-again";
    }
    if (gnomeState(player) >= 1) return "earning-their-trust-torture-chamber-talking-to-the-gnome-again";
    return "earning-their-trust-torture-chamber-bargains-and-bluffs";
  }

  function talkToGnome(event) {
    const { player } = event;
    if (!player || !GNOME_IDS.has(event.npcId)) return false;
    const variant = gnomeVariant(player);
    if (!variant) return false;
    event.handled = true;
    play(player, event.npcId, variant);
    return true;
  }

  function elenaVariant(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_ORDERS || stage >= STAGE_COMPLETE) return null;
    if (stage < STAGE_ELENA) return "earning-their-trust-for-the-greater-good-an-old-friend";
    if (stage < STAGE_TOXIN) {
      return held(player, ROTTEN_APPLE)
        ? "earning-their-trust-for-the-greater-good-returning-with-the-sample"
        : "earning-their-trust-for-the-greater-good-returning-without-the-sample";
    }
    if (stage < STAGE_STORES) return "earning-their-trust-contaminating-the-stores-talking-to-elena-after-making-the-toxic-powder";
    return "earning-their-trust-contaminating-the-stores-talking-to-elena-after-contaminating-the-food-supply";
  }

  function talkToElena(event) {
    const { player } = event;
    if (!player || !ELENA_IDS.has(event.npcId)) return false;
    const variant = elenaVariant(player);
    if (!variant) return false;
    event.handled = true;
    if (variant === "earning-their-trust-for-the-greater-good-an-old-friend") {
      advance(player, STAGE_ELENA);
    }
    play(player, event.npcId, variant);
    return true;
  }

  function talkToTegid(event) {
    const { player } = event;
    if (!player || event.npcId !== TEGID_ID) return false;
    const variant = tegidVariant(player);
    if (!variant) return false;
    event.handled = true;
    play(player, TEGID_ID, variant);
    return true;
  }

  // ==========================================================================
  // The mourner kill, the disguise items and the sheep
  // ==========================================================================

  function handleNpcDeath({ killer, npcId }) {
    if (!killer || npcId !== ARANDAR_MOURNER_ID) return;
    if (quest.getStage(killer) !== STAGE_STARTED) return;
    advance(killer, STAGE_DISGUISE);
    killer.getPacketSender().sendVarbit(VARBIT_MOURNER_VIS, 1);
  }

  function washTop(player) {
    if (!held(player, BLOODY_MOURNER_TOP)) return false;
    if (!held(player, BUCKET_OF_WATER)) {
      play(player, TEGID_ID, "the-mourner-s-disguise-use-tegid-s-soap-with-the-bloody-mourner-top-without-a-bucket-of-water");
      return true;
    }
    play(player, TEGID_ID, "the-mourner-s-disguise-use-tegid-s-soap-with-the-bloody-mourner-top-with-a-bucket-of-water");
    take(player, BLOODY_MOURNER_TOP, 1);
    if (!held(player, MOURNER_TOP)) give(player, MOURNER_TOP, 1);
    advance(player, STAGE_CLEANED);
    return true;
  }

  function mixNaphtha(player) {
    if (!held(player, BARREL_OF_NAPHTHA) || !held(player, APPLE_BARREL)) return false;
    player.sendMessage("You mix the naphtha with the apple mush.");
    take(player, BARREL_OF_NAPHTHA, 1);
    take(player, APPLE_BARREL, 1);
    give(player, NAPHTHA_APPLE_MIX, 1);
    return true;
  }

  function sieveMix(player) {
    if (!held(player, NAPHTHA_APPLE_MIX) || !held(player, SIEVE)) return false;
    player.sendMessage("You sieve the solids out of the mixture.");
    take(player, NAPHTHA_APPLE_MIX, 1);
    give(player, TOXIC_NAPHTHA, 1);
    return true;
  }

  function dyeBellows(player, dyeId) {
    const stage = quest.getStage(player);
    if (stage < STAGE_FIXED_DEVICE || stage >= STAGE_SHEEP) return false;
    if (!held(player, dyeId) || !held(player, OGRE_BELLOWS)) return false;
    take(player, dyeId, 1);
    take(player, OGRE_BELLOWS, 1);
    give(player, BELLOWS_BY_DYE.get(dyeId), 1);
    return true;
  }

  function fillBellows(player, bellowsId) {
    const stage = quest.getStage(player);
    if (stage < STAGE_FIXED_DEVICE || stage >= STAGE_SHEEP) return false;
    const toadId = TOAD_BY_BELLOWS.get(bellowsId);
    if (toadId === undefined || !held(player, bellowsId)) return false;
    take(player, bellowsId, 1);
    if (!held(player, OGRE_BELLOWS)) give(player, OGRE_BELLOWS, 1);
    give(player, toadId, 1);
    return true;
  }

  function loadDevice(player, toadId) {
    const stage = quest.getStage(player);
    if (stage < STAGE_FIXED_DEVICE || stage >= STAGE_SHEEP) return false;
    if (!held(player, toadId) || !held(player, FIXED_DEVICE)) return false;
    player.sendMessage(
      "You put the dye-filled toad in to the firing chamber. To use the device, select the Aim and Fire mode from your Combat Options."
    );
    take(player, toadId, 1);
    loadedToadByPlayer.set(player, COLOUR_BY_TOAD.get(toadId));
    player.getPacketSender().sendVarbit(VARBIT_GUN_AMMO, 1);
    return true;
  }

  /** The loaded device fired at a flock; the toad's colour must match. */
  function dyeSheep(player, npcId) {
    const stage = quest.getStage(player);
    if (stage < STAGE_FIXED_DEVICE || stage >= STAGE_SHEEP) return false;
    if (!held(player, FIXED_DEVICE)) return false;
    const colour = SHEEP_COLOUR_BY_NPC.get(npcId);
    if (!colour) return false;
    const loaded = loadedToadByPlayer.get(player);
    if (loaded !== colour) return false;
    if (sheepBitSet(player, colour)) return false;
    loadedToadByPlayer.delete(player);
    player.getPacketSender().sendVarbit(VARBIT_GUN_AMMO, 0);
    player.setAttribute(SHEEP_ATTRIBUTE, sheepBits(player) | SHEEP_BIT_BY_COLOUR.get(colour));
    player.getPacketSender().sendVarbit(SHEEP_VARBIT_BY_COLOUR.get(colour), 1);
    player.sendMessage(`You re-dye the ${colour} sheep.`);
    if (allSheepDyed(player)) advance(player, STAGE_SHEEP);
    return true;
  }

  // ==========================================================================
  // Item interactions
  // ==========================================================================

  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    if (!player) return;
    const ids = new Set([usedItemId, usedWithItemId]);

    if (ids.has(TEGIDS_SOAP) && ids.has(BLOODY_MOURNER_TOP)) {
      event.handled = washTop(player);
      return;
    }
    if (ids.has(BARREL_OF_NAPHTHA) && ids.has(APPLE_BARREL)) {
      event.handled = mixNaphtha(player);
      return;
    }
    if (ids.has(SIEVE) && ids.has(NAPHTHA_APPLE_MIX)) {
      event.handled = sieveMix(player);
      return;
    }
    for (const dyeId of BELLOWS_BY_DYE.keys()) {
      if (ids.has(dyeId) && ids.has(OGRE_BELLOWS)) {
        event.handled = dyeBellows(player, dyeId);
        return;
      }
    }
    for (const toadId of COLOUR_BY_TOAD.keys()) {
      if (ids.has(toadId) && ids.has(FIXED_DEVICE)) {
        event.handled = loadDevice(player, toadId);
        return;
      }
    }
  }

  function handleItemOnNpc(event) {
    const { player, itemId, npcId } = event;
    if (!player || !npcId) return;

    if (GNOME_IDS.has(npcId)) {
      event.handled = gnomeItem(player, itemId);
      return;
    }
    if (npcId === SWAMP_TOAD_NPC_ID) {
      event.handled = TOAD_BY_BELLOWS.has(itemId) ? fillBellows(player, itemId) : false;
      return;
    }
    if (SHEEP_NPC_IDS.has(npcId)) {
      event.handled = dyeSheep(player, npcId);
      return;
    }
  }

  /** The agreed bargain: hand over the device, logs, leather and crunchies. */
  function releaseGnome(player) {
    if (quest.getStage(player) >= STAGE_FIXED_DEVICE) return false;
    if (gnomeState(player) < 1) return false;
    if (!held(player, BROKEN_DEVICE)) return false;
    if (!hasGnomeMaterials(player) || !hasToadCrunchies(player)) return false;
    play(player, GNOME_CHATHEAD, "earning-their-trust-it-s-a-deal-releasing-the-gnome");
    return true;
  }

  function gnomeItem(player, itemId) {
    const stage = quest.getStage(player);
    if (stage < STAGE_RECRUIT || stage >= STAGE_COMPLETE) return false;
    const released = stage >= STAGE_FIXED_DEVICE;

    if (itemId === BROKEN_DEVICE && !released) {
      return releaseGnome(player);
    }
    if (itemId === FEATHER && !released) {
      if (gnomeState(player) < 1) return false;
      if (gnomeState(player) >= 2) {
        play(player, GNOME_CHATHEAD, "earning-their-trust-torture-chamber-tickle-the-gnome-on-rack-again");
        return true;
      }
      if (hasToadCrunchies(player)) {
        player.setAttribute(GNOME_STATE_ATTRIBUTE, 2);
        play(player, GNOME_CHATHEAD, "earning-their-trust-torture-chamber-tickling-the-gnome-s-feet-with-a-feather");
        return true;
      }
      play(player, GNOME_CHATHEAD, "earning-their-trust-torture-chamber-using-a-feather-on-the-gnome-again-without-toad-crunchies");
      return true;
    }
    if (TOAD_CRUNCHIES_IDS.has(itemId)) {
      if (released) {
        take(player, itemId, 1);
        play(player, GNOME_CHATHEAD, "earning-their-trust-contaminating-the-stores-use-toad-crunchies-on-the-gnome");
        return true;
      }
      if (gnomeState(player) >= 1) {
        take(player, itemId, 1);
        play(player, GNOME_CHATHEAD, "earning-their-trust-torture-chamber-with-toad-crunchies-but-no-feather");
        return true;
      }
    }
    if (released) {
      play(player, GNOME_CHATHEAD, "earning-their-trust-contaminating-the-stores-use-anything-else-on-the-gnome");
      return true;
    }
    return false;
  }

  function barrelOnPile(player, objectId) {
    if (objectId !== ROTTEN_APPLE_PILE) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_ELENA || stage >= STAGE_STORES) return false;
    if (!held(player, BARREL) && !held(player, BARREL_2)) return false;
    if (held(player, BARREL)) take(player, BARREL, 1);
    else take(player, BARREL_2, 1);
    player.sendMessage("You scoop up a barrel full of the rotten apples.");
    give(player, ROTTEN_APPLES, 1);
    return true;
  }

  function applesOnPress(player, objectId) {
    if (objectId !== APPLE_PRESS) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_ELENA || stage >= STAGE_STORES) return false;
    if (!held(player, ROTTEN_APPLES)) return false;
    take(player, ROTTEN_APPLES, 1);
    player.sendMessage("You use the apple press to crush your rotten apples.");
    player.sendMessage("You get a barrel full of crushed rotten apples.");
    give(player, APPLE_BARREL, 1);
    return true;
  }

  function naphthaOnRange(player, objectId) {
    if (!RANGE_OBJECT_IDS.has(objectId)) return false;
    const stage = quest.getStage(player);
    if (stage < STAGE_ELENA || stage >= STAGE_STORES) return false;
    if (!held(player, TOXIC_NAPHTHA)) return false;
    if (player.getInventory().getFreeSlots() < 1) {
      player.sendMessage("You need two free inventory slots.");
      return true;
    }
    take(player, TOXIC_NAPHTHA, 1);
    player.sendMessage("You evaporate the naphtha and you're left with a powdery residue on the insides of the barrel.");
    give(player, TOXIC_POWDER, 2);
    advance(player, STAGE_TOXIN);
    return true;
  }

  function powderOnSacks(player, objectId) {
    if (!FOOD_STORE_IDS.has(objectId)) return false;
    if (quest.getStage(player) !== STAGE_TOXIN) return false;
    if (!held(player, TOXIC_POWDER)) return false;
    const store = String(objectId);
    const poisoned = storesPoisoned(player);
    if (poisoned.includes(store)) {
      player.sendMessage("You've already poisoned this store.");
      return true;
    }
    take(player, TOXIC_POWDER, 1);
    player.sendMessage("You add the toxin to the grain, after a few seconds of mixing you can't tell the difference.");
    poisoned.push(store);
    player.setAttribute(STORES_ATTRIBUTE, poisoned.join(","));
    if (poisoned.length >= 2) advance(player, STAGE_STORES);
    return true;
  }

  function handleItemOnObject(event) {
    const { player, itemId, objectId, location } = event;
    if (!player) return;
    if (itemId === BARREL || itemId === BARREL_2) {
      event.handled = barrelOnPile(player, objectId);
      return;
    }
    if (itemId === ROTTEN_APPLES) {
      event.handled = applesOnPress(player, objectId);
      return;
    }
    if (itemId === TOXIC_NAPHTHA) {
      event.handled = naphthaOnRange(player, objectId);
      return;
    }
    if (itemId === TOXIC_POWDER) {
      event.handled = powderOnSacks(player, objectId);
    }
  }

  // ==========================================================================
  // Object interactions, the HQ trip and the torture chamber
  // ==========================================================================

  function openHqTrapdoor(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    // Basement access is a quest reward, so the completed quest keeps it.
    if (stage < STAGE_REPORTED) return;
    event.handled = true;
    if (!wearingFullMournerGear(player)) {
      player.sendMessage("You need to be wearing the full mourner disguise to enter the headquarters.");
      return;
    }
    player.moveTo(new Location(HQ_BASEMENT.x, HQ_BASEMENT.y, HQ_BASEMENT.z));
  }

  function searchLaundry(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_DISGUISE || stage >= STAGE_COMPLETE) return;
    event.handled = true;
    const variant = Number(player.getAttribute(TEGID_ATTRIBUTE)) === 1
      ? "the-mourner-s-disguise-stealing-from-the-laundry-basket-after-talking-to-tegid"
      : "the-mourner-s-disguise-stealing-from-the-laundry-basket-before-talking-to-tegid";
    play(player, TEGID_ID, variant);
  }

  function takeRottenApples(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_ELENA || stage >= STAGE_STORES) return;
    event.handled = true;
    give(player, ROTTEN_APPLES, 1);
  }

  function openDeviceChest(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_RECRUIT || stage >= STAGE_COMPLETE) return;
    event.handled = true;
    if (held(player, BROKEN_DEVICE) || held(player, FIXED_DEVICE)) return;
    give(player, BROKEN_DEVICE, 1);
    player.sendMessage("You take one of the broken devices from the chest.");
  }

  /**
   * The torture-chamber doors have no open variant in the cache, so Doors.plugin.js
   * leaves Open unhandled; once Essyllt has recruited the player the quest walks
   * them across to the first free tile on the far side (as Curse of Arrav does).
   */
  function passThroughTortureDoor(event) {
    const { player, location } = event;
    if (quest.getStage(player) < STAGE_RECRUIT) return false;
    event.handled = true;
    const from = player.getLocation();
    const dx = from.getX() - location.x;
    const dy = from.getY() - location.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
      const step = dx >= 0 ? -1 : 1;
      for (let n = 1; n <= 3; n++) {
        const tile = new Location(location.x + step * n, from.getY(), from.getZ());
        if (!RegionManager.blocked(tile, null)) {
          player.moveTo(tile);
          break;
        }
      }
      return true;
    }
    const step = dy >= 0 ? -1 : 1;
    for (let n = 1; n <= 3; n++) {
      const tile = new Location(from.getX(), location.y + step * n, from.getZ());
      if (!RegionManager.blocked(tile, null)) {
        player.moveTo(tile);
        break;
      }
    }
    return true;
  }

  /** Rack clicks talk to the gnome; Release is the same hand-in as the device. */
  function rackGnome(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    if (stage < STAGE_RECRUIT || stage >= STAGE_COMPLETE) return false;
    const option = event.definition?.getInteractions?.()?.[event.clickType - 1];
    if (option === "Release" && releaseGnome(player)) {
      event.handled = true;
      return true;
    }
    const variant = gnomeVariant(player);
    if (!variant) return false;
    event.handled = true;
    play(player, GNOME_CHATHEAD, variant);
    return true;
  }

  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    if (!player) return;
    if (objectId === HQ_TRAPDOOR) {
      openHqTrapdoor(event);
      return;
    }
    if (HQ_TORTURE_DOORS.has(objectId)) {
      passThroughTortureDoor(event);
      return;
    }
    if (GNOME_RACK_IDS.has(objectId)) {
      rackGnome(event);
      return;
    }
    if (objectId === LAUNDRY_BASKET) {
      searchLaundry(event);
      return;
    }
    if (objectId === ROTTEN_APPLE_PILE) {
      takeRottenApples(event);
      return;
    }
    if (objectId === DEVICE_CHEST) {
      openDeviceChest(event);
    }
  }

  /** The HQ ladder climbs back up beside the trapdoor (no map link exists). */
  function claimHqLadder(request) {
    if (!request || request.objectId !== HQ_LADDER) return;
    request.handled = true;
    request.player.moveTo(new Location(HQ_TRAPDOOR_TILE.x, HQ_TRAPDOOR_TILE.y, HQ_TRAPDOOR_TILE.z));
  }

  // ==========================================================================
  // Torture gnome spawn (owner-only)
  // ==========================================================================

  function ensureGnome(player) {
    if (!player || player.isPlayerBot?.() === true) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_RECRUIT || stage >= STAGE_COMPLETE) {
      removeGnome(player);
      return;
    }
    if (spawnedGnomeByPlayer.has(player)) return;
    const npc = api.spawnNpc({
      id: GNOME_CHATHEAD,
      x: GNOME_SPAWN.x,
      y: GNOME_SPAWN.y,
      z: GNOME_SPAWN.z,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) spawnedGnomeByPlayer.set(player, npc);
  }

  function removeGnome(player) {
    const npc = spawnedGnomeByPlayer.get(player);
    if (!npc) return;
    api.removeNpc(npc);
    spawnedGnomeByPlayer.delete(player);
  }

  // ==========================================================================
  // Varbit sync and journal
  // ==========================================================================

  function syncVarbits(player) {
    const stage = quest.getStage(player);
    const sender = player.getPacketSender();
    sender.sendVarbit(VARBIT_SEE_ELUNED, stage >= STAGE_STARTED ? 1 : 0);
    sender.sendVarbit(VARBIT_MOURNER_VIS, stage >= STAGE_DISGUISE ? 1 : 0);
    sender.sendVarbit(VARBIT_GUN_AMMO, 0);
    for (const [colour, varbit] of SHEEP_VARBIT_BY_COLOUR) {
      sender.sendVarbit(varbit, sheepBitSet(player, colour) ? 1 : 0);
    }
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I infiltrated the mourners in West Ardougne for Arianwyn and</str>",
        "<str>earnt their trust by poisoning the food supply.</str>",
        "<str>Essyllt revealed they are searching for the Temple of Light,</str>",
        "<str>and I told Arianwyn what I learnt.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_PLAN) {
      return [
        "<str>I infiltrated the mourners and earnt their trust.</str>",
        "",
        "Essyllt told me the mourners are digging for the <col=800000>Temple of</col>",
        "<col=800000>Light</col> beneath West Ardougne.",
        "",
        "I should report this to <col=800000>Arianwyn</col>.",
      ];
    }
    if (stage >= STAGE_STORES) {
      return [
        "<str>I infiltrated the mourners and earnt their trust.</str>",
        "",
        "I contaminated two of the food stores in West Ardougne.",
        "I should tell <col=800000>Essyllt</col> it is done.",
      ];
    }
    if (stage >= STAGE_TOXIN) {
      return [
        "<str>I infiltrated the mourners and earnt their trust.</str>",
        "",
        "I made heaps of <col=800000>toxic powder</col> from the rotten apples.",
        "I must use it on two of the three food supply points.",
      ];
    }
    if (stage >= STAGE_ELENA) {
      return [
        "<str>I infiltrated the mourners and earnt their trust.</str>",
        "",
        "<col=800000>Elena</col> is helping me make a non-fatal toxin: mash rotten",
        "apples, mix in naphtha, sieve it and heat it on a range.",
      ];
    }
    if (stage >= STAGE_ORDERS) {
      return [
        "<str>I infiltrated the mourners and earnt their trust.</str>",
        "",
        "Essyllt wants a plague-like poison placed in the food supply.",
        "I should ask <col=800000>Elena</col> for help.",
      ];
    }
    if (stage >= STAGE_SHEEP) {
      return [
        "<str>I infiltrated the mourners and earnt their trust.</str>",
        "",
        "I re-dyed Farmer Brumty's sheep.",
        "I should report back to <col=800000>Essyllt</col>.",
      ];
    }
    if (stage >= STAGE_FIXED_DEVICE) {
      return [
        "<str>I infiltrated the mourners and earnt their trust.</str>",
        "",
        "I freed the gnome and he fixed the device.",
        "I must dye the four flocks red, green, blue and yellow.",
      ];
    }
    if (stage >= STAGE_RECRUIT) {
      return [
        "<str>I infiltrated the mourners and earnt their trust.</str>",
        "",
        "Essyllt gave me a <col=800000>broken device</col> and a",
        "<col=800000>tarnished key</col>; the gnome in the torture chamber",
        "can fix the device for magic logs and leather.",
      ];
    }
    if (stage >= STAGE_REPORTED) {
      return [
        "<str>I have a full mourner disguise and Arianwyn told me to</str>",
        "<str>infiltrate the Mourner Headquarters in West Ardougne.</str>",
      ];
    }
    if (stage >= STAGE_DISGUISE) {
      return [
        "<str>I killed a mourner on the Arandar pass and took the disguise.</str>",
        "",
        hasCleanTop(player) ? "The top is clean." : "The top is <col=800000>bloodstained</col>.",
        hasFixedTrousers(player) ? "The trousers are repaired." : "The trousers are <col=800000>ripped</col>.",
        "",
        "I should take the disguise back to <col=800000>Arianwyn</col>.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "<str>Arianwyn asked me to infiltrate the mourners to find out</str>",
        "<str>what they are doing in West Ardougne.</str>",
        "",
        "He said they cross the <col=800000>Arandar</col> mountain pass, where",
        "I can ambush one and take their disguise.",
      ];
    }
    return [
      "I can start this quest by talking to <col=800000>Eluned</col>",
      "in the elven woods of <col=800000>Isafdar</col>.",
      "",
      "This quest has the following requirements:",
      "Roving Elves",
    ];
  }

  // ==========================================================================
  // Login / stage sync
  // ==========================================================================

  function handleLogin({ player }) {
    if (!player) return;
    refreshQuestList(player);
    syncVarbits(player);
    ensureGnome(player);
  }

  function handleBootstrap({ player }) {
    if (player) syncVarbits(player);
  }

  function handleLogout({ player }) {
    if (!player) return;
    removeGnome(player);
    loadedToadByPlayer.delete(player);
  }

  function handleStageChanged(event) {
    if (!event || event.key !== "mournings_end_part_i" || !event.player) return;
    if (event.stage === 0) {
      event.player.setAttribute(GNOME_STATE_ATTRIBUTE, 0);
      event.player.setAttribute(GNOME_PARCELS_ATTRIBUTE, 0);
      event.player.setAttribute(SHEEP_ATTRIBUTE, 0);
      event.player.setAttribute(STORES_ATTRIBUTE, "");
      event.player.setAttribute(TEGID_ATTRIBUTE, 0);
      loadedToadByPlayer.delete(event.player);
    }
    syncVarbits(event.player);
    ensureGnome(event.player);
  }

  // ==========================================================================
  // Registration
  // ==========================================================================

  api.persistAttribute(GNOME_STATE_ATTRIBUTE);
  api.persistAttribute(GNOME_PARCELS_ATTRIBUTE);
  api.persistAttribute(SHEEP_ATTRIBUTE);
  api.persistAttribute(STORES_ATTRIBUTE);
  api.persistAttribute(TEGID_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "mournings_end_part_i",
    name: "Mourning's End Part I",
    varpId: VARP_MOURNINGS_END_PART_I,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.THIEVING.getIndex(), amount: 40000, label: "Thieving" },
      { skillId: Skill.HITPOINTS.getIndex(), amount: 25000, label: "Hitpoints" },
    ],
    otherRewards: ["Access to the Mourner HQ basement", "Elf teleport crystal"],
    buildJournal,
    onReward(player) {
      player.getSkillManager().addExperiences(Skill.THIEVING, 40000);
      player.getSkillManager().addExperiences(Skill.HITPOINTS, 25000);
    },
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onNpcInteraction("Arianwyn", { "Talk-to": talkToArianwyn });
  api.onNpcInteraction("Essyllt", { "Talk-to": talkToEssyllt });
  api.onNpcInteraction("Gnome", { "Talk-to": talkToGnome });
  api.onNpcInteraction("Elena", { "Talk-to": talkToElena });
  api.onNpcInteraction("Tegid", { "Talk-to": talkToTegid });
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:hook", handleDialogueHook);
  api.onCustomEvent("mournings-end-part-i:start-requirements", answerStartRequirementQuery);
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  for (const name of [
    "Teleport crystal (4)", "Teleport crystal (3)",
    "Teleport crystal (2)", "Teleport crystal (1)",
  ]) api.onItemAction(name, { Lletya: activateTeleportCrystal });
  api.onObjectInteraction(handleObjectInteraction);
  api.onNpcDeath(handleNpcDeath);
  api.onCustomEvent("ladders:climb", claimHqLadder);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
  api.onCustomEvent("player:bootstrap-complete", handleBootstrap);
  api.onCustomEvent("quest:stage-changed", handleStageChanged);
};
