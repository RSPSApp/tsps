/**
 * Shades of Mort'ton (members).
 *
 * The words come from the "Shades of Mort'ton" transcript page; this plugin
 * selects the variants for Ulsquire Shauncy (1287 afflicted / 1288 cured) and
 * Razmire Keelgan (1289/1290), answers the two olive-oil prose conditions and
 * wires the diary start hook, the shade kills, the remains hand-ins, the temple
 * repair, sacred oil and pyre logs; the funeral pyres themselves are the minigame's
 * (minigames/ShadesOfMortton.plugin.js), which tells the quest of the logs placed and the
 * cremation for its stages 75 and 80.
 *
 * Stages (varp 339, LostCity "morttonquest"): 5 read the diary, 10 made serum
 * 207, 15 accepted Razmire's shade hunt, 20/25/30/35/40 one..five shades
 * killed, 45 gave remains to Razmire, 47 showed them to Ulsquire, 50 temple
 * discussed, 55 temple repair begun, 60 altar can be lit, 65 sacred oil made,
 * 70 pyre logs made, 75 logs on the pyre, 80 shade cremated, 85 complete.
 * The rev-227 capture also writes temple varps 343 (repair %) and 345
 * (sanctity). Varp 340 is a bitfield: the cache names made_perm_serum (bit 7),
 * pyre_loc (9-13) and temple_resources (14-27). Quest Helper requires bit 1/3
 * for partial 207 cures and bit 5/6 for permanent 208; bits 0/2 (used 207) come
 * from the older LostCity-derived partial mask. Bit 7 matches the cache's
 * made_perm_serum and is set at the altar. The capture's 207 cure values are
 * 12 for Razmire (bits 2+3) and 15 for both priests (adds bits 0+1). Repair
 * follows the captured build-tick model: one
 * material set per tick, +1% repair and +1 sanctity, with a worn Flamtaer
 * bracelet performing five ticks per click.
 *
 * Sources: OSRS Wiki quick guide, Quest Helper pinned route, and RSProx rev-227
 * capture 1846. Legacy LostCityRS scripts (quest_mortton/game_mortton, pinned
 * in issue #196) remain the starting point for the minigame state.
 *
 * The temple follows the OSRS Wiki minigame page: interface 171 shows repair
 * (varp 343, shared), resources (varp 344, the player's own pool: +5% for each
 * set of 1 limestone brick, 1 timber beam or plank and 5 swamp paste) and
 * sanctity (varp 345, the player's own, -1% a minute and gone on logout). Each
 * successful build spends 1% resources for +1% repair; walls show the repair
 * state (cache locs 4068-4078 and corners 4079-4089) and the cache's broken altar
 * (4092) becomes the unlit (4091) and lit (4090) fire altar. Sacred oil needs 10%
 * sanctity and costs 0.9% a dose; serum 208 needs 20% and costs 5% a dose.
 * Serums turn Razmire, Ulsquire and the afflicted villagers into their cured NPCs
 * for a while (the NPC itself changes, for every player, as on live); a 208 cure
 * of Razmire or Ulsquire is the player's for good, so talking to him cures him
 * again. Razmire's two Trade options open his own stores.
 *
 * Unverified (no recording found): build cadence and success chance, the
 * Crafting XP per build (tip.it: about 76 per 1% of supplies), how fast idle
 * repair decays, the altar's repair thresholds, how long each cure lasts and
 * the villagers' cure rewards (Wiki names coins, olive oil, tarromin and, for
 * 208, the odd bronze key). Those are the TUNABLE constants below.
 */
module.exports = function registerShadesOfMorttonQuest(api) {
  const {
    Skill,
    Location,
    GameObject,
    ObjectManager,
    ItemIdentifiers,
    NpcIdentifiers,
    ObjectIdentifiers,
    Equipment,
    CountdownTask,
    TaskManager,
  } = api.core;
  const { registerQuest, refreshQuestList, openBook, startTranscript } = require("../QuestRuntime");

  const ULSQUIRE_NPC_IDS = new Set([
    NpcIdentifiers.AFFLICTED_ULSQUIRE_,
    NpcIdentifiers.ULSQUIRE_SHAUNCY,
  ]);
  const RAZMIRE_NPC_IDS = new Set([
    NpcIdentifiers.AFFLICTED_RAZMIRE_,
    NpcIdentifiers.RAZMIRE_KEELGAN,
  ]);
  /** Afflicted NPC -> the cured NPC it turns into (cache: same model, Talk-to only). */
  const CURED_FORM = new Map([
    [NpcIdentifiers.AFFLICTED_ULSQUIRE_, NpcIdentifiers.ULSQUIRE_SHAUNCY],
    [NpcIdentifiers.AFFLICTED_RAZMIRE_, NpcIdentifiers.RAZMIRE_KEELGAN],
  ]);
  const VILLAGER_CURED_FORM = new Map([
    [NpcIdentifiers.AFFLICTED, NpcIdentifiers.MORTTON_LOCAL],
    [NpcIdentifiers.AFFLICTED_2, NpcIdentifiers.MORTTON_LOCAL_2],
    [NpcIdentifiers.AFFLICTED_3, NpcIdentifiers.MORTTON_LOCAL_3],
    [NpcIdentifiers.AFFLICTED_4, NpcIdentifiers.MORTTON_LOCAL_4],
  ]);
  // Razmire's stores (shops.json ids). shops.json binds both to one option, so neither opened.
  const RAZMIRE_GENERAL_STORE = 1294;
  const RAZMIRE_BUILDERS_STORE = 1293;

  const SHADE_NPC_IDS = new Set([
    NpcIdentifiers.LOAR_SHADOW,
    NpcIdentifiers.LOAR_SHADE,
    NpcIdentifiers.PHRIN_SHADOW,
    NpcIdentifiers.PHRIN_SHADE,
    NpcIdentifiers.RIYL_SHADOW,
    NpcIdentifiers.RIYL_SHADE,
    NpcIdentifiers.ASYN_SHADOW,
    NpcIdentifiers.ASYN_SHADE,
    NpcIdentifiers.FIYR_SHADOW,
    NpcIdentifiers.FIYR_SHADE,
  ]);

  const PAGE = "Shades of Mort'ton";
  const START_HOOK = "quest:shades-of-mort-ton:start";

  const VARP_SHADES_OF_MORTTON = 339;
  const VARP_MORTTON_MULTI = 340;
  const VARP_TEMPLE_REPAIRED = 343;
  const VARP_TEMPLE_RESOURCES = 344;
  const VARP_TEMPLE_SANCTITY = 345;
  // Interface 171 is the temple HUD (clientscript 947 reads varps 343-345).
  const TEMPLE_HUD_INTERFACE = 171;
  const OVERLAY_HUD_UID = (161 << 16) | 8;
  // Varp 340: bits 1/3 are Quest Helper's partial 207 visible flags (kept as
  // 3/12 with the LostCity-derived 0/2 used flags), bits 5/6 are its permanent
  // 208 flags, and bit 7 is the cache's made_perm_serum, set at the altar.
  const MULTI_ULSQUIRE_CURED = 0b0011;
  const MULTI_RAZMIRE_CURED = 0b1100;
  const MULTI_ULSQUIRE_PERMANENT = 1 << 5;
  const MULTI_RAZMIRE_PERMANENT = 1 << 6;
  const MULTI_PERM_SERUM = 1 << 7;
  // Wiki (Flamtaer bracelet): 80 charges, one per build, about 75% more sanctity.
  const FLAMTAER_BRACELET_CHARGES = 80;
  const FLAMTAER_BRACELET_SANCTITY = 1.75;
  // Mod Ash (Wiki, Flamtaer hammer): an invisible +40 Crafting while building.
  const FLAMTAER_HAMMER_BOOST = 40;
  const REPAIR_CRAFTING_LEVEL = 20;

  // TUNABLE (unverified). Sanctity is kept in tenths of a percent.
  const BUILD_ATTEMPT_TICKS = 4;
  const BUILD_SANCTITY_TENTHS = 30; // capture 1846: +2 at once, +1 four ticks later
  const BUILD_CRAFTING_XP = 76; // tip.it: "around 76 exp per 1% of used building supplies"
  const RESOURCES_PER_SET = 5;
  const REPAIR_IDLE_DECAY_TICKS = 100; // -1% a minute once nobody has built for a minute
  const SANCTITY_DECAY_TICKS = 100; // Wiki: -1% per minute
  const SHADE_KILL_SANCTITY_TENTHS = 20; // Wiki: 2% per shade killed near the temple
  const OIL_MIN_SANCTITY_TENTHS = 100; // Wiki: 10%
  const OIL_COST_TENTHS_PER_DOSE = 9; // Wiki: 0.9% per dose
  const SERUM_MIN_SANCTITY_TENTHS = 200; // Wiki: 20%
  const SERUM_COST_TENTHS_PER_DOSE = 50; // Wiki: 5% per dose
  const QUEST_MIN_SANCTITY_TENTHS = 200; // quest: 100% repair and 20 sanctity
  const ALTAR_BREAKS_BELOW = 50; // the restored altar crumbles again below this repair
  const ALTAR_GOES_OUT_BELOW = 90; // the flame goes out below this repair
  const SANCTIFY_TICKS = 3;
  const CURE_TICKS_FRESH_207 = 300;
  const CURE_TICKS_STALE_207 = 30; // "not too fresh": about one conversation
  const CURE_TICKS_208 = 1000;
  const CURE_TICKS_VILLAGER = 100;
  // The temple island, where the HUD shows and shade kills count.
  const TEMPLE_AREA = { minX: 3496, maxX: 3516, minY: 3306, maxY: 3326 };

  const STAGE_NOT_STARTED = 0;
  const STAGE_READ_DIARY = 5;
  const STAGE_MADE_SERUM = 10;
  const STAGE_KILL_SHADES = 15;
  const STAGE_KILLED_1 = 20;
  const STAGE_KILLED_5 = 40;
  const STAGE_SHADES_TO_RAZMIRE = 45;
  const STAGE_SHADES_TO_ULSQUIRE = 47;
  const STAGE_ULSQUIRE_TEMPLE = 50;
  const STAGE_REBUILD_TEMPLE = 55;
  const STAGE_CAN_LIGHT_ALTAR = 60;
  const STAGE_CREATED_SACRED_OIL = 65;
  const STAGE_CREATED_PYRE_LOGS = 70;
  const STAGE_LOGS_ON_PYRE = 75;
  const STAGE_LIT_PYRE = 80;
  const STAGE_COMPLETE = 85;

  const DIARY_ITEM_ID = ItemIdentifiers.DIARY_2;
  const REMAINS_ITEM_IDS = [
    ItemIdentifiers.LOAR_REMAINS,
    ItemIdentifiers.PHRIN_REMAINS,
    ItemIdentifiers.RIYL_REMAINS,
    ItemIdentifiers.ASYN_REMAINS,
    ItemIdentifiers.FIYR_REMAINS,
  ];
  const SERUM_207_LEVEL = 15;
  const SERUM_207_XP = 50;
  const SERUM_207_SOUND = 2608;
  const SERUM_207_ITEM_IDS = [
    ItemIdentifiers.SERUM_207_4_,
    ItemIdentifiers.SERUM_207_3_,
    ItemIdentifiers.SERUM_207_2_,
    ItemIdentifiers.SERUM_207_1_,
  ];
  const SERUM_208_ITEM_IDS = [
    ItemIdentifiers.SERUM_208_4_,
    ItemIdentifiers.SERUM_208_3_,
    ItemIdentifiers.SERUM_208_2_,
    ItemIdentifiers.SERUM_208_1_,
  ];
  const OLIVE_OIL_ITEM_IDS = [
    ItemIdentifiers.OLIVE_OIL_4_,
    ItemIdentifiers.OLIVE_OIL_3_,
    ItemIdentifiers.OLIVE_OIL_2_,
    ItemIdentifiers.OLIVE_OIL_1_,
  ];
  const SACRED_OIL_ITEM_IDS = [
    ItemIdentifiers.SACRED_OIL_4_,
    ItemIdentifiers.SACRED_OIL_3_,
    ItemIdentifiers.SACRED_OIL_2_,
    ItemIdentifiers.SACRED_OIL_1_,
  ];

  const SHELF_OBJECT_ID = ObjectIdentifiers.SHELF_9;
  const SMASHED_TABLE_OBJECT_ID = ObjectIdentifiers.SMASHED_TABLE_2;
  const ALTAR_OBJECT_IDS = new Set([
    ObjectIdentifiers.FLAMING_FIRE_ALTAR,
    ObjectIdentifiers.FIRE_ALTAR,
    ObjectIdentifiers.BROKEN_FIRE_ALTAR,
  ]);
  // The cache places the broken fire altar (4092, type 10, rotation 0) at the temple centre.
  const FIRE_ALTAR_LOCATION = new Location(3506, 3316, 0);
  const FIRE_ALTAR_OBJECT_TYPE = 10;
  // Cache map region 54_51: the temple's wall locs (type 10) and their rotations. A wall
  // shows repair/10 steps past its broken form: 4068 -> 4069..4077 -> 4078 ("Reinforce"),
  // corners 4079 -> 4080..4088 -> 4089.
  const WALL_BASE_ID = ObjectIdentifiers.BROKEN_WALL;
  const CORNER_BASE_ID = ObjectIdentifiers.BROKEN_WALL_2;
  const TEMPLE_WALLS = [
    [3504, 3315, 0, false], [3504, 3316, 0, false], [3504, 3317, 0, false],
    [3505, 3314, 3, false], [3505, 3318, 1, false], [3506, 3318, 1, false],
    [3507, 3314, 3, false], [3507, 3318, 1, false],
    [3508, 3315, 2, false], [3508, 3316, 2, false], [3508, 3317, 2, false],
    [3504, 3314, 3, true], [3504, 3318, 0, true], [3508, 3314, 2, true], [3508, 3318, 1, true],
  ].map(([x, y, rotation, corner]) => ({ x, y, rotation, corner }));
  const FLAMTAER_REGION_ID = ((FIRE_ALTAR_LOCATION.getX() >> 6) << 8) | (FIRE_ALTAR_LOCATION.getY() >> 6);
  const TEMPLE_WALL_OBJECT_IDS = new Set([
    ObjectIdentifiers.BROKEN_WALL,
    ObjectIdentifiers.TEMPLE_WALL,
    ObjectIdentifiers.TEMPLE_WALL_2,
    ObjectIdentifiers.TEMPLE_WALL_3,
    ObjectIdentifiers.TEMPLE_WALL_4,
    ObjectIdentifiers.TEMPLE_WALL_5,
    ObjectIdentifiers.TEMPLE_WALL_6,
    ObjectIdentifiers.TEMPLE_WALL_7,
    ObjectIdentifiers.TEMPLE_WALL_8,
    ObjectIdentifiers.TEMPLE_WALL_9,
    ObjectIdentifiers.TEMPLE_WALL_10,
    ObjectIdentifiers.BROKEN_WALL_2,
    ObjectIdentifiers.TEMPLE_WALL_11,
    ObjectIdentifiers.TEMPLE_WALL_12,
    ObjectIdentifiers.TEMPLE_WALL_13,
    ObjectIdentifiers.TEMPLE_WALL_14,
    ObjectIdentifiers.TEMPLE_WALL_15,
    ObjectIdentifiers.TEMPLE_WALL_16,
    ObjectIdentifiers.TEMPLE_WALL_17,
    ObjectIdentifiers.TEMPLE_WALL_18,
    ObjectIdentifiers.TEMPLE_WALL_19,
    ObjectIdentifiers.TEMPLE_WALL_20,
  ]);

  /** Sacred/oil dose -> the item left after one dose is used. */
  const DOSE_STAGE = new Map([
    [ItemIdentifiers.SERUM_207_4_, ItemIdentifiers.SERUM_207_3_],
    [ItemIdentifiers.SERUM_207_3_, ItemIdentifiers.SERUM_207_2_],
    [ItemIdentifiers.SERUM_207_2_, ItemIdentifiers.SERUM_207_1_],
    [ItemIdentifiers.SERUM_207_1_, ItemIdentifiers.VIAL],
    [ItemIdentifiers.SERUM_208_4_, ItemIdentifiers.SERUM_208_3_],
    [ItemIdentifiers.SERUM_208_3_, ItemIdentifiers.SERUM_208_2_],
    [ItemIdentifiers.SERUM_208_2_, ItemIdentifiers.SERUM_208_1_],
    [ItemIdentifiers.SERUM_208_1_, ItemIdentifiers.VIAL],
    [ItemIdentifiers.OLIVE_OIL_4_, ItemIdentifiers.OLIVE_OIL_3_],
    [ItemIdentifiers.OLIVE_OIL_3_, ItemIdentifiers.OLIVE_OIL_2_],
    [ItemIdentifiers.OLIVE_OIL_2_, ItemIdentifiers.OLIVE_OIL_1_],
    [ItemIdentifiers.OLIVE_OIL_1_, ItemIdentifiers.VIAL],
    [ItemIdentifiers.SACRED_OIL_4_, ItemIdentifiers.SACRED_OIL_3_],
    [ItemIdentifiers.SACRED_OIL_3_, ItemIdentifiers.SACRED_OIL_2_],
    [ItemIdentifiers.SACRED_OIL_2_, ItemIdentifiers.SACRED_OIL_1_],
    [ItemIdentifiers.SACRED_OIL_1_, ItemIdentifiers.VIAL],
  ]);

  /** Serum 207 placed in the sacred flame becomes permanent serum 208. */
  const SERUM_207_TO_208 = new Map([
    [ItemIdentifiers.SERUM_207_4_, ItemIdentifiers.SERUM_208_4_],
    [ItemIdentifiers.SERUM_207_3_, ItemIdentifiers.SERUM_208_3_],
    [ItemIdentifiers.SERUM_207_2_, ItemIdentifiers.SERUM_208_2_],
    [ItemIdentifiers.SERUM_207_1_, ItemIdentifiers.SERUM_208_1_],
  ]);

  /** One dose of olive oil sanctifies into the same-dose sacred oil. */
  const OLIVE_TO_SACRED = new Map([
    [ItemIdentifiers.OLIVE_OIL_4_, ItemIdentifiers.SACRED_OIL_4_],
    [ItemIdentifiers.OLIVE_OIL_3_, ItemIdentifiers.SACRED_OIL_3_],
    [ItemIdentifiers.OLIVE_OIL_2_, ItemIdentifiers.SACRED_OIL_2_],
    [ItemIdentifiers.OLIVE_OIL_1_, ItemIdentifiers.SACRED_OIL_1_],
  ]);

  /**
   * Logs -> pyre logs and the sacred-oil doses each takes. Wiki (Pyre logs): regular and oak 2, willow and maple 3, yew
   * and magic 4; making them gives "a flat rate of 5 experience per dose of oil used" in Firemaking.
   */
  const PYRE_XP_PER_DOSE = 5;
  const PYRE_LOG_RECIPES = new Map([
    [ItemIdentifiers.LOGS, { product: ItemIdentifiers.PYRE_LOGS, doses: 2 }],
    [ItemIdentifiers.OAK_LOGS, { product: ItemIdentifiers.OAK_PYRE_LOGS, doses: 2 }],
    [ItemIdentifiers.WILLOW_LOGS, { product: ItemIdentifiers.WILLOW_PYRE_LOGS, doses: 3 }],
    [ItemIdentifiers.MAPLE_LOGS, { product: ItemIdentifiers.MAPLE_PYRE_LOGS, doses: 3 }],
    [ItemIdentifiers.YEW_LOGS, { product: ItemIdentifiers.YEW_PYRE_LOGS, doses: 4 }],
    [ItemIdentifiers.MAGIC_LOGS, { product: ItemIdentifiers.MAGIC_PYRE_LOGS, doses: 4 }],
  ]);

  const KILLS_ATTRIBUTE = "quest.shades_of_mortton.shade_kills";
  const MET_ULSQUIRE_ATTRIBUTE = "quest.shades_of_mortton.met_ulsquire";
  const MET_RAZMIRE_ATTRIBUTE = "quest.shades_of_mortton.met_razmire";
  const OLIVE_OIL_ATTRIBUTE = "quest.shades_of_mortton.olive_oil";
  const TABLE_SEARCHED_ATTRIBUTE = "quest.shades_of_mortton.table_searched";
  const TEMPLE_REPAIRED_ATTRIBUTE = "shades-of-mortton:temple-repaired";
  const TEMPLE_SANCTITY_ATTRIBUTE = "shades-of-mortton:temple-sanctity";
  // Sanctity in tenths of a percent; deliberately not persisted (Wiki: lost on logout).
  const SANCTITY_TENTHS_ATTRIBUTE = "shades-of-mortton:sanctity-tenths";
  const TEMPLE_RESOURCES_ATTRIBUTE = "shades-of-mortton:temple-resources";
  const BRACELET_CHARGES_ATTRIBUTE = "shades-of-mortton:flamtaer-bracelet-charges";
  // A running build or sanctify loop, so a new click or a step away ends the old one.
  const ACTION_ATTRIBUTE = "shades-of-mortton:action";
  const PERM_ULSQUIRE_ATTRIBUTE = "shades-of-mortton:perm-ulsquire";
  const PERM_RAZMIRE_ATTRIBUTE = "shades-of-mortton:perm-razmire";
  const MULTI_ATTRIBUTE = "shades-of-mortton:multi";
  const PERM_GIFT_ATTRIBUTE = "shades-of-mortton:perm-gift";
  const MADE_PERM_SERUM_ATTRIBUTE = "shades-of-mortton:made-perm-serum";

  const DIARY_TITLE = "Diary of Herbi Flax";
  // Capture 1846 ticks 7163-7166: the book opens on the page 11 spread.
  const DIARY_PAGES = [
    {
      44: "<col=000080> ~ Page 11 ~ ",
      45: "<col=000000>Some local townsfolk are",
      46: "<col=000000>worried about the mists",
      47: "<col=000000>coming from the North East.",
      48: "<col=000000>Ordered more fire logs from",
      49: "<col=000000>Razmire's shop, must find a",
      50: "<col=000000>more reliable source of",
      51: "<col=000000>fyreneght. That money",
      52: "<col=000000>grabbing Razmire didn't",
      53: "<col=000000>know what I was talking",
      54: "<col=000000>about, had to explain they",
      55: "<col=000000>were ashes! Herbs like",
      56: "<col=000000>harralander, marrentil and",
      57: "<col=000000>tarromin in short supply. I'm",
      58: "<col=000000>hoping the latter will make",
      60: "<col=000000>solution 194 the best yet.",
      61: "",
      62: "The remains of a primitive",
      63: "temple to the north have",
      64: "piqued my curiosity.",
    },
  ];

  const REPAIR_MATERIALS_MESSAGE =
    "~ Repairing the temple ~To repair the temple you need to increase your material resource pool by bringing limestone bricks, timber beams (or wooden planks) and swamp paste, either in your inventory or in a Flamtaer bag.";

  let quest;
  // One quest registration belongs to one server World, like the altar below.
  const world = api.getWorld();
  // Shared by everyone on the world, as on live; it starts at 0 after a restart.
  let templeRepaired = 0;
  let lastBuildTick = 0;
  let templeTicks = 0;
  let templeTaskStarted = false;
  let templeRegionLoaded = false;
  // The Flamtaer altar is one world object: broken (4092), unlit (4091) or lit (4090).
  let altarObject = null;
  let altarRestored = false;
  let altarLit = false;
  // The wall loc each temple wall currently shows (null until first swapped from the cache's).
  const wallObjects = TEMPLE_WALLS.map(() => null);
  let wallStep = 0;
  // Players who have the temple HUD open.
  const hudShown = new Set();

  const held = (player, itemId, amount = 1) =>
    player.getInventory().getAmount(itemId) >= amount;

  function freeSlots(player) {
    const inventory = player.getInventory();
    return typeof inventory.getFreeSlots === "function"
      ? inventory.getFreeSlots()
      : inventory.isFull()
        ? 0
        : 28;
  }

  function later(ticks, action) {
    TaskManager.submit(new CountdownTask(null, Math.max(1, ticks), action));
  }

  function isOnline(player) {
    return player && player.isRegistered?.() !== false;
  }

  function inTempleArea(player) {
    const location = player.getLocation();
    return location.getZ() === 0 &&
      location.getX() >= TEMPLE_AREA.minX && location.getX() <= TEMPLE_AREA.maxX &&
      location.getY() >= TEMPLE_AREA.minY && location.getY() <= TEMPLE_AREA.maxY;
  }

  /** The player's sanctity in tenths of a percent (0..1000). Not saved: logging out loses it. */
  function sanctityOf(player) {
    return Math.max(0, Math.min(1000, Number(player.getAttribute(SANCTITY_TENTHS_ATTRIBUTE)) || 0));
  }

  function setSanctity(player, tenths) {
    player.setAttribute(SANCTITY_TENTHS_ATTRIBUTE, Math.max(0, Math.min(1000, Math.round(tenths))));
    syncTemple(player);
  }

  /** The player's own building resources, 0..100%. Saved, unlike sanctity. */
  function resourcesOf(player) {
    return Math.max(0, Math.min(100, Number(player.getAttribute(TEMPLE_RESOURCES_ATTRIBUTE)) || 0));
  }

  function setResources(player, value) {
    player.setAttribute(TEMPLE_RESOURCES_ATTRIBUTE, Math.max(0, Math.min(100, value)));
    syncTemple(player);
  }

  function syncTemple(player) {
    const packet = player.getPacketSender();
    packet.sendConfig(VARP_TEMPLE_REPAIRED, templeRepaired);
    packet.sendConfig(VARP_TEMPLE_RESOURCES, resourcesOf(player));
    packet.sendConfig(VARP_TEMPLE_SANCTITY, Math.floor(sanctityOf(player) / 10));
  }

  function syncTempleRepairOthers(actor) {
    for (const player of world.getPlayers()) {
      if (player && player !== actor) player.getPacketSender().sendConfig(VARP_TEMPLE_REPAIRED, templeRepaired);
    }
  }

  function showHud(player) {
    if (hudShown.has(player)) return;
    hudShown.add(player);
    syncTemple(player);
    player.getPacketSender().sendSubInterface(OVERLAY_HUD_UID, TEMPLE_HUD_INTERFACE, 1);
  }

  function hideHud(player) {
    if (!hudShown.delete(player)) return;
    if (isOnline(player)) player.getPacketSender().closeSubInterface(OVERLAY_HUD_UID);
  }

  function makeLoc(id, x, y, rotation) {
    return new GameObject(id, new Location(x, y, 0), FIRE_ALTAR_OBJECT_TYPE, rotation, null);
  }

  /** Swaps a temple loc for its next form in the same tile and shape slot. */
  function swapLoc(outgoing, incoming) {
    if (typeof ObjectManager.replaceInPlace === "function") {
      ObjectManager.replaceInPlace(outgoing, incoming);
    } else {
      ObjectManager.deregister(outgoing, true);
      ObjectManager.register(incoming, true);
    }
  }

  /** Walls show the shared repair state in eleven steps. */
  function refreshWalls() {
    if (!templeRegionLoaded) return;
    const step = Math.max(0, Math.min(10, Math.floor(templeRepaired / 10)));
    if (step === wallStep) return;
    wallStep = step;
    TEMPLE_WALLS.forEach((wall, index) => {
      const base = wall.corner ? CORNER_BASE_ID : WALL_BASE_ID;
      const outgoing = wallObjects[index] ?? makeLoc(base, wall.x, wall.y, wall.rotation);
      const incoming = makeLoc(base + step, wall.x, wall.y, wall.rotation);
      swapLoc(outgoing, incoming);
      wallObjects[index] = incoming;
    });
  }

  function altarIdFor() {
    if (!altarRestored) return ObjectIdentifiers.BROKEN_FIRE_ALTAR;
    return altarLit ? ObjectIdentifiers.FLAMING_FIRE_ALTAR : ObjectIdentifiers.FIRE_ALTAR;
  }

  /** The altar comes back at full repair, goes out and crumbles again as repair falls. */
  function refreshAltar() {
    if (templeRepaired >= 100) altarRestored = true;
    if (templeRepaired < ALTAR_BREAKS_BELOW) altarRestored = false;
    if (!altarRestored || templeRepaired < ALTAR_GOES_OUT_BELOW) altarLit = false;
    if (!templeRegionLoaded) return;
    const id = altarIdFor();
    const outgoing = altarObject ?? makeLoc(ObjectIdentifiers.BROKEN_FIRE_ALTAR,
      FIRE_ALTAR_LOCATION.getX(), FIRE_ALTAR_LOCATION.getY(), 0);
    if (outgoing.getId() === id) return;
    const incoming = makeLoc(id, FIRE_ALTAR_LOCATION.getX(), FIRE_ALTAR_LOCATION.getY(), 0);
    swapLoc(outgoing, incoming);
    altarObject = incoming;
  }

  function setTempleRepaired(value) {
    const next = Math.max(0, Math.min(100, value));
    if (next === templeRepaired) return;
    templeRepaired = next;
    for (const player of world.getPlayers()) {
      if (player) player.getPacketSender().sendConfig(VARP_TEMPLE_REPAIRED, templeRepaired);
    }
    refreshWalls();
    refreshAltar();
  }

  /** Once a tick: HUD in the temple area, idle repair decay and sanctity decay. */
  function templeTick() {
    templeTicks++;
    for (const player of [...hudShown]) {
      if (!isOnline(player) || !inTempleArea(player)) hideHud(player);
    }
    for (const player of world.getPlayers()) {
      if (!player) continue;
      if (inTempleArea(player) && quest.getStage(player) >= STAGE_ULSQUIRE_TEMPLE) showHud(player);
      if (templeTicks % SANCTITY_DECAY_TICKS === 0 && sanctityOf(player) > 0) {
        setSanctity(player, sanctityOf(player) - 10);
      }
    }
    if (templeRepaired > 0 && templeTicks - lastBuildTick >= REPAIR_IDLE_DECAY_TICKS &&
        templeTicks % REPAIR_IDLE_DECAY_TICKS === 0) {
      setTempleRepaired(templeRepaired - 1);
    }
  }

  function startTempleTask() {
    if (templeTaskStarted) return;
    templeTaskStarted = true;
    const { Task } = api.core;
    TaskManager.submit(new (class extends Task {
      constructor() {
        super(1, null, false);
      }
      execute() {
        try {
          templeTick();
        } catch (error) {
          console.error("[ShadesOfMortton] temple tick failed", error);
        }
      }
    })());
  }

  function curedMultiValue(player) {
    let value = 0;
    if (player.getAttribute(MET_ULSQUIRE_ATTRIBUTE)) {
      value |= MULTI_ULSQUIRE_CURED;
    }
    if (player.getAttribute(MET_RAZMIRE_ATTRIBUTE)) {
      value |= MULTI_RAZMIRE_CURED;
    }
    if (player.getAttribute(PERM_ULSQUIRE_ATTRIBUTE)) {
      value |= MULTI_ULSQUIRE_PERMANENT;
    }
    if (player.getAttribute(PERM_RAZMIRE_ATTRIBUTE)) {
      value |= MULTI_RAZMIRE_PERMANENT;
    }
    if (player.getAttribute(MADE_PERM_SERUM_ATTRIBUTE)) {
      value |= MULTI_PERM_SERUM;
    }
    return value;
  }

  function setMulti(player) {
    const value = curedMultiValue(player);
    player.setAttribute(MULTI_ATTRIBUTE, value);
    player.getPacketSender().sendConfig(VARP_MORTTON_MULTI, value);
  }

  function syncCuredNpcs(player) {
    // Rebuild from the saved cure attributes so permanent 208 bits (5/6) and
    // the altar bit (7) survive login even if an older save cached a stale mask.
    setMulti(player);
  }

  function remainingCount(player) {
    return REMAINS_ITEM_IDS.reduce(
      (total, itemId) => total + player.getInventory().getAmount(itemId),
      0
    );
  }

  function removeRemains(player, count) {
    let left = count;
    for (const itemId of REMAINS_ITEM_IDS) {
      if (left <= 0) break;
      const have = player.getInventory().getAmount(itemId);
      const take = Math.min(have, left);
      if (take > 0) {
        player.getInventory().deleteNumber(itemId, take);
        left -= take;
      }
    }
    return left === 0;
  }

  /** Use up to `count` doses from the given dose chain, highest dose first. */
  function drainDoses(player, itemIds, count) {
    let left = count;
    for (const itemId of itemIds) {
      while (left > 0 && player.getInventory().getAmount(itemId) > 0) {
        player.getInventory().deleteNumber(itemId, 1);
        player.getInventory().adds(DOSE_STAGE.get(itemId), 1);
        left--;
      }
      if (left === 0) break;
    }
    return left === 0;
  }

  function sacredOilDoses(player) {
    return (
      player.getInventory().getAmount(SACRED_OIL_ITEM_IDS[0]) * 4 +
      player.getInventory().getAmount(SACRED_OIL_ITEM_IDS[1]) * 3 +
      player.getInventory().getAmount(SACRED_OIL_ITEM_IDS[2]) * 2 +
      player.getInventory().getAmount(SACRED_OIL_ITEM_IDS[3])
    );
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I travelled to Mort'ton and found Herbi Flax's diary.</str>",
        "<str>I made serum 207 and used it to cure the afflicted.</str>",
        "<str>I killed five shades for Razmire and helped rebuild</str>",
        "<str>the temple of Flamtaer. I cremated a shade's remains,</str>",
        "<str>putting its spirit to rest.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_LIT_PYRE) {
      return ["The shade's spirit was released.", "I should tell Ulsquire."];
    }
    if (stage >= STAGE_LOGS_ON_PYRE) {
      return [
        "I need to put the shade remains on the funeral",
        "pyre and light it to put the shade to rest.",
      ];
    }
    if (stage >= STAGE_CREATED_PYRE_LOGS) {
      return [
        "Ulsquire says the pyre logs are connected to the",
        "shade remains. I can try to put a spirit to rest.",
      ];
    }
    if (stage >= STAGE_CREATED_SACRED_OIL) {
      return [
        "When all of the temple walls were rebuilt an altar",
        "appeared. I sanctified olive oil in the sacred flame.",
      ];
    }
    if (stage >= STAGE_CAN_LIGHT_ALTAR) {
      return [
        "I helped rebuild the temple of Flamtaer.",
        "The holy fire altar can now be lit.",
      ];
    }
    if (stage >= STAGE_REBUILD_TEMPLE) {
      return [
        "I'm rebuilding the temple using limestone bricks,",
        "wooden planks and swamp paste.",
      ];
    }
    if (stage >= STAGE_ULSQUIRE_TEMPLE) {
      return [
        "Ulsquire is interested in 'Flaemtaer temple'.",
        "I should help him rebuild it.",
      ];
    }
    if (stage >= STAGE_SHADES_TO_ULSQUIRE) {
      return [
        "I showed Ulsquire the shade remains.",
        "A holy cremation with pyre logs should put the",
        "shades' spirits to rest.",
      ];
    }
    if (stage >= STAGE_SHADES_TO_RAZMIRE) {
      return ["I gave Razmire the shade remains.", "He said to show some to Ulsquire."];
    }
    if (stage >= STAGE_KILLED_1) {
      const kills = Math.min(
        5,
        Number(player.getAttribute(KILLS_ATTRIBUTE)) || 0
      );
      const lines = [`I have killed ${kills} of the five shades.`];
      if (remainingCount(player) < 5) {
        lines.push("I must collect the remains and bring them to Razmire.");
      } else {
        lines.push("I have five shade remains to bring to Razmire.");
      }
      return lines;
    }
    if (stage >= STAGE_KILL_SHADES) {
      return [
        "Razmire asked me to kill five shades and bring",
        "him their remains.",
      ];
    }
    if (stage >= STAGE_MADE_SERUM) {
      return [
        "I made serum 207 from tarromin, water and ashes",
        "using Herbi Flax's diary.",
        "I should use it on an afflicted local.",
      ];
    }
    if (stage >= STAGE_READ_DIARY) {
      return [
        "I found Herbi Flax's diary in Mort'ton.",
        "Tarromin, a vial of water and ashes make serum 207.",
      ];
    }
    return [
      "I can start this quest by exploring the town of",
      "<col=800000>Mort'ton</col>, accessible from the",
      "southern edge of <col=800000>Mort Myre</col>.",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.CRAFTING, 2000);
    player.getSkillManager().addExperiences(Skill.HERBLORE, 2000);
  }

  /** Which transcript variant each speaker plays, by quest stage. */
  function selectVariant({ npcId, player, npc }) {
    if (!ULSQUIRE_NPC_IDS.has(npcId) && !RAZMIRE_NPC_IDS.has(npcId)) return null;
    recureOnTalk({ player, npc, npcId });
    const stage = quest.getStage(player);

    if (ULSQUIRE_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_COMPLETE) {
        return { page: "Ulsquire Shauncy", variant: "after-shades-of-mort-ton" };
      }
      if (stage >= STAGE_LIT_PYRE) return "talking-to-ulsquire-after-burning-shade-remains";
      if (stage >= STAGE_LOGS_ON_PYRE) {
        return "burning-the-remains-putting-the-logs-on-the-funeral-pyre-talking-to-ulsquire";
      }
      if (stage >= STAGE_CREATED_PYRE_LOGS) {
        return "making-pyre-logs-returning-to-ulsquire-after-making-pyre-logs";
      }
      if (stage >= STAGE_CREATED_SACRED_OIL) return "making-sacred-oil-talking-to-ulsquire";
      if (stage >= STAGE_REBUILD_TEMPLE) {
        return "talking-with-ulsquire-again-returning-to-ulsquire-before-making-sacred-oil";
      }
      if (stage >= STAGE_SHADES_TO_ULSQUIRE) return "talking-with-ulsquire-again";
      if (stage >= STAGE_SHADES_TO_RAZMIRE) {
        return remainingCount(player) > 0
          ? "giving-ulsquire-the-remains"
          : "giving-razmire-his-shades-going-to-ulsquire-without-remains";
      }
      if (stage >= STAGE_KILL_SHADES) {
        return "curing-razmire-talking-to-ulsquire-before-giving-razmire-5-shade-remains";
      }
      if (stage >= STAGE_MADE_SERUM) {
        if (!player.getAttribute(MET_ULSQUIRE_ATTRIBUTE)) return null;
        return player.getAttribute(MET_ULSQUIRE_ATTRIBUTE) === "talked"
          ? "reading-the-book-curing-ulsquire-talking-to-him-again"
          : "reading-the-book-curing-ulsquire";
      }
      return null;
    }

    if (stage >= STAGE_COMPLETE) {
      return { page: "Razmire Keelgan", variant: "after-shades-of-mort-ton" };
    }
    if (stage >= STAGE_LIT_PYRE) {
      return "burning-the-remains-returning-to-razmire-after-burning-shade-remains";
    }
    if (stage >= STAGE_CREATED_SACRED_OIL) return "making-pyre-logs-talking-to-razmire";
    if (stage >= STAGE_REBUILD_TEMPLE) {
      return "talking-with-ulsquire-again-returning-to-razmire-before-making-sacred-oil";
    }
    if (stage >= STAGE_SHADES_TO_RAZMIRE) {
      return "giving-razmire-his-shades-talking-to-razmire-again";
    }
    if (stage >= STAGE_KILLED_5) {
      return remainingCount(player) >= 5
        ? "giving-razmire-his-shades"
        : "killing-shades-returning-without-the-five-shade-remains";
    }
    if (stage >= STAGE_KILLED_1) return "killing-shades-talking-to-razmire";
    if (stage >= STAGE_KILL_SHADES) {
      return "curing-razmire-returning-before-killing-5-shade-remains";
    }
    if (stage >= STAGE_MADE_SERUM) {
      if (!player.getAttribute(MET_RAZMIRE_ATTRIBUTE)) return null;
      // The repeat-greeting variant's "shadowy creatures" answer jumps to a lost
      // target and lands on Ulsquire's line, so always play the full menu.
      return "curing-razmire";
    }
    return null;
  }

  /** Answer the transcript's two prose conditions. */
  function answerCondition({ player, text }) {
    const value = String(text).toLowerCase();
    const gotOil = Boolean(player.getAttribute(OLIVE_OIL_ATTRIBUTE));
    if (value.includes("has not already received olive oil")) return !gotOil;
    if (value.includes("has received olive oil already")) return gotOil;
    return null;
  }

  /** The diary's "Yes." starts the quest; the cured greetings mark first contact. */
  /** Wiki: 20 Crafting, 15 Herblore, 5 Firemaking and Priest in Peril. */
  const REQUIRED_SKILLS = [
    { skill: Skill.CRAFTING, level: 20, label: "Crafting" },
    { skill: Skill.HERBLORE, level: 15, label: "Herblore" },
    { skill: Skill.FIREMAKING, level: 5, label: "Firemaking" },
  ];

  function questIsComplete(player, key) {
    const request = { player, key, complete: undefined };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function meetsStartRequirements(player) {
    return missingSkillRequirements(player).length === 0 && questIsComplete(player, "priest_in_peril");
  }

  function notifyStartRequirements(player) {
    notifySkillRequirements(player);
    if (!questIsComplete(player, "priest_in_peril")) {
      player.sendMessage("You must complete Priest in Peril to start this quest.");
    }
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

  function handleStartHook({ player, hook }) {
    if (hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_READ_DIARY) {
      if (!meetsStartRequirements(player)) {
        notifyStartRequirements(player);
        return;
      }
      quest.setStage(player, STAGE_READ_DIARY);
    }
  }

  function handleDialogueLine(event) {
    if (!String(event.text ?? "").includes("you've made your own serum")) return;
    const key = ULSQUIRE_NPC_IDS.has(event.npcId)
      ? MET_ULSQUIRE_ATTRIBUTE
      : RAZMIRE_NPC_IDS.has(event.npcId)
        ? MET_RAZMIRE_ATTRIBUTE
        : null;
    if (key) event.player.setAttribute(key, "talked");
  }

  /** Razmire's shade-hunt acceptance and Ulsquire's temple question. */
  function handleChoice({ player, npcId, option }) {
    const text = String(option ?? "");
    if (RAZMIRE_NPC_IDS.has(npcId) && text.startsWith("Yes, I'll dispatch")) {
      const stage = quest.getStage(player);
      if (stage >= STAGE_MADE_SERUM && stage < STAGE_KILL_SHADES) {
        quest.setStage(player, STAGE_KILL_SHADES);
      }
      return;
    }
    if (ULSQUIRE_NPC_IDS.has(npcId) && text.includes("What can you tell me about that temple?")) {
      const stage = quest.getStage(player);
      if (stage >= STAGE_SHADES_TO_ULSQUIRE && stage < STAGE_ULSQUIRE_TEMPLE) {
        quest.setStage(player, STAGE_ULSQUIRE_TEMPLE);
      }
    }
  }

  /** Quest actions and item hand-outs in the transcript branches. */
  function handleAction(event) {
    const { player, npcId, stepId } = event;
    if (stepId === "eINek0") {
      // "Yes." on the diary confirmation opens the captured book interface.
      event.handled = true;
      handleStartHook({ player, hook: START_HOOK });
      openBook(player, DIARY_TITLE, DIARY_PAGES);
      return;
    }
    if (stepId === "LyXCwi") {
      if (quest.getStage(player) >= STAGE_LIT_PYRE && !quest.isComplete(player)) {
        quest.complete(player);
      }
      event.handled = true;
      event.end = true;
      return;
    }
    if (stepId === "BYUtF3") {
      if (!player.getAttribute(OLIVE_OIL_ATTRIBUTE)) {
        player.getInventory().adds(ItemIdentifiers.OLIVE_OIL_3_, 1);
        player.setAttribute(OLIVE_OIL_ATTRIBUTE, true);
      }
      event.handled = true;
      return;
    }
    if (stepId === "yUgA1J" && RAZMIRE_NPC_IDS.has(npcId)) {
      if (quest.getStage(player) === STAGE_KILLED_5 && remainingCount(player) >= 5) {
        removeRemains(player, 2);
        quest.setStage(player, STAGE_SHADES_TO_RAZMIRE);
      }
      return;
    }
    if (stepId === "tSotiE" && ULSQUIRE_NPC_IDS.has(npcId)) {
      if (quest.getStage(player) === STAGE_SHADES_TO_RAZMIRE && remainingCount(player) > 0) {
        removeRemains(player, 1);
        quest.setStage(player, STAGE_SHADES_TO_ULSQUIRE);
      }
    }
  }

  /** Count the shades killed for Razmire and narrate each kill. */
  function handleNpcDeath({ killer, npcId }) {
    if (!killer || !SHADE_NPC_IDS.has(npcId)) return;
    // Wiki: killing the shades around the temple gives 2% sanctity.
    if (inTempleArea(killer) && quest.getStage(killer) >= STAGE_ULSQUIRE_TEMPLE) {
      setSanctity(killer, sanctityOf(killer) + SHADE_KILL_SANCTITY_TENTHS);
      checkAltarUnlock(killer);
    }
    const stage = quest.getStage(killer);
    if (stage < STAGE_KILL_SHADES || stage >= STAGE_SHADES_TO_RAZMIRE) return;
    const kills = Math.min(5, (Number(killer.getAttribute(KILLS_ATTRIBUTE)) || 0) + 1);
    killer.setAttribute(KILLS_ATTRIBUTE, kills);
    const message = [
      "",
      "That's one Shade!",
      "That's two Shades!",
      "That's three Shades!",
      "That's four Shades!",
    ][kills];
    if (message) killer.sendMessage(message);
    if (kills === 5) killer.sendMessage("That's all five Shades!");
    quest.setStage(killer, STAGE_KILLED_1 + (kills - 1) * 5);
  }

  /** Reading the diary: first read offers the quest-start branch. */
  function handleItemAction(event) {
    if (event.itemId !== DIARY_ITEM_ID) return;
    if (!String(event.option ?? "").toLowerCase().includes("read")) return;
    event.handled = true;
    const { player } = event;
    if (quest.getStage(player) === STAGE_NOT_STARTED) {
      startTranscript(api, player, NpcIdentifiers.ULSQUIRE_SHAUNCY, PAGE, "reading-the-book");
      return;
    }
    openBook(player, DIARY_TITLE, DIARY_PAGES);
  }

  /** One Serum 207 (3): the ashes of `ashesSlot` into the tarromin vial of `vialSlot`, which becomes the serum. */
  function makeSerum207(player, vialSlot, ashesSlot) {
    const inventory = player.getInventory();
    inventory.deleteAtSlot(ashesSlot, 1, false);
    inventory.setItem(vialSlot, new api.core.Item(ItemIdentifiers.SERUM_207_3_, 1));
    inventory.refreshItems();
    player.getSkillManager().addExperiences(Skill.HERBLORE, SERUM_207_XP);
    player.performAnimation(new api.core.Animation(api.core.CacheDefinitions.getSeqId("human_herbing_vial")));
    player.getPacketSender().sendSound(SERUM_207_SOUND, 1, 0);
    player.getPacketSender().sendTypedMessage(api.core.ChatType.SPAM, "You make serum 207.");
    if (quest.getStage(player) === STAGE_READ_DIARY) {
      quest.setStage(player, STAGE_MADE_SERUM);
    }
  }

  /** Ashes finish serum 207; sacred oil turns logs into pyre logs. */
  function handleItemOnItem(event) {
    const { player } = event;
    const used = event.usedItemId;
    const withId = event.usedWithItemId;
    const pair = [used, withId];

    if (
      pair.includes(ItemIdentifiers.ASHES) &&
      pair.includes(ItemIdentifiers.TARROMIN_POTION_UNF_)
    ) {
      if (quest.getStage(player) < STAGE_READ_DIARY) return;
      event.handled = true;
      // Wiki (Serum 207): level 15 Herblore (boostable), 50 XP, a 3-dose serum. rsprox_transcripts/227/01846.txt:
      // ashes on the tarromin vial in slot 9 -> "You make serum 207." (spam), mort_serum3 in slot 9, the ashes' slot
      // emptied, human_herbing_vial, synth 2608 and a Herblore XP drop.
      if (player.getSkillManager().getCurrentLevel(Skill.HERBLORE) < SERUM_207_LEVEL) {
        player.sendMessage(`You need a Herblore level of ${SERUM_207_LEVEL} to combine those.`);
        return;
      }
      const inventory = player.getInventory();
      const slotOf = (id, clicked) => (inventory.forSlot(clicked)?.getId?.() === id ? clicked : inventory.getSlotForItemId(id));
      const vialSlot = slotOf(ItemIdentifiers.TARROMIN_POTION_UNF_, used === ItemIdentifiers.TARROMIN_POTION_UNF_ ? event.usedItemSlot : event.usedWithItemSlot);
      const ashesSlot = slotOf(ItemIdentifiers.ASHES, used === ItemIdentifiers.ASHES ? event.usedItemSlot : event.usedWithItemSlot);
      api.core.TaskManager.cancelTasks(player.getIndex());
      makeSerum207(player, vialSlot, ashesSlot);
      // Wiki (Serum 207): no Make-X, it carries on until the vials or ashes run out, 0 then 2 then every 3 ticks
      // (rsprox 227/01846: the second "You make serum 207." two ticks on, into vial slot 10 with the ashes of slot 12).
      // A player-keyed task, so a walk or another click stops it.
      let tick = 0;
      let next = 2;
      api.core.TaskManager.submit(new (class extends api.core.Task {
        constructor() { super(1, player.getIndex(), false); }
        execute() {
          if (!player.isRegistered() || player.getHitpoints() <= 0) { this.stop(); return; }
          if (++tick < next) return;
          next += 3;
          const vial = inventory.getSlotForItemId(ItemIdentifiers.TARROMIN_POTION_UNF_);
          const ashes = inventory.getSlotForItemId(ItemIdentifiers.ASHES);
          if (vial < 0 || ashes < 0 || player.getSkillManager().getCurrentLevel(Skill.HERBLORE) < SERUM_207_LEVEL) {
            this.stop();
            return;
          }
          makeSerum207(player, vial, ashes);
        }
      })());
      return;
    }

    if (!SACRED_OIL_ITEM_IDS.some((itemId) => pair.includes(itemId))) return;
    const logId = pair.find((itemId) => PYRE_LOG_RECIPES.has(itemId));
    if (logId === undefined) return;
    event.handled = true;
    if (quest.getStage(player) < STAGE_CREATED_SACRED_OIL) {
      player.sendMessage("This sacred oil doesn't seem fresh. You should make your own.");
      return;
    }
    const recipe = PYRE_LOG_RECIPES.get(logId);
    if (sacredOilDoses(player) < recipe.doses) {
      player.sendMessage(`This needs ${recipe.doses} doses of sacred oil.`);
      return;
    }
    drainDoses(player, SACRED_OIL_ITEM_IDS, recipe.doses);
    player.getInventory().deleteNumber(logId, 1);
    player.getInventory().adds(recipe.product, 1);
    player.getSkillManager().addExperiences(Skill.FIREMAKING, recipe.doses * PYRE_XP_PER_DOSE);
    player.sendMessage("You use the sacred oil on the logs and get pyre logs.");
    if (quest.getStage(player) < STAGE_CREATED_PYRE_LOGS) {
      quest.setStage(player, STAGE_CREATED_PYRE_LOGS);
    }
  }

  /** Turns an NPC into another form for `ticks`, then back, unless a newer cure took over. */
  function transformFor(npc, formId, ticks) {
    if (!npc?.setNpcTransformationId) return;
    const token = {};
    npc.__morttonCure = token;
    npc.setNpcTransformationId(formId);
    later(ticks, () => {
      if (npc.__morttonCure !== token) return;
      npc.__morttonCure = null;
      if (npc.getNpcTransformationId?.() === formId) npc.setNpcTransformationId(-1);
    });
  }

  function npcOf(event) {
    return event.target ?? event.npc ?? null;
  }

  function itemName(itemId) {
    return api.core.ItemDefinition?.forId?.(itemId)?.getName?.() ?? "something";
  }

  function give(player, itemId, amount) {
    const inventory = player.getInventory();
    const item = new api.core.Item(itemId, amount);
    if (inventory.getAddableAmount?.(item) < amount && typeof inventory.forceAdd === "function") {
      inventory.forceAdd(player, item);
    } else {
      inventory.adds(itemId, amount);
    }
  }

  const randomInt = (low, high) => low + Math.floor(Math.random() * (high - low + 1));
  const BRONZE_KEYS = [
    ItemIdentifiers.BRONZE_KEY_RED,
    ItemIdentifiers.BRONZE_KEY_BROWN,
    ItemIdentifiers.BRONZE_KEY_CRIMSON,
    ItemIdentifiers.BRONZE_KEY_BLACK,
    ItemIdentifiers.BRONZE_KEY_PURPLE,
  ];

  /**
   * A cured villager's thanks. TUNABLE (unverified weights): the Wiki names coins, olive oil and
   * tarromin, and for serum 208 a better haul and the occasional bronze key.
   */
  function villagerReward(player, permanent) {
    const roll = Math.random() * 100;
    if (permanent && roll < 4) {
      const key = BRONZE_KEYS[randomInt(0, BRONZE_KEYS.length - 1)];
      give(player, key, 1);
      player.sendMessage(`You've been given a ${itemName(key).toLowerCase()}.`);
      return;
    }
    if (roll < (permanent ? 34 : 30)) {
      const amount = permanent ? randomInt(1, 2) : 1;
      give(player, ItemIdentifiers.TARROMIN, amount);
      player.sendMessage(`You've been given ${amount === 1 ? "some" : amount} tarromin.`);
      return;
    }
    if (roll < (permanent ? 59 : 50)) {
      const oil = permanent ? ItemIdentifiers.OLIVE_OIL_2_ : ItemIdentifiers.OLIVE_OIL_1_;
      give(player, oil, 1);
      player.sendMessage(`You've been given some ${itemName(oil).toLowerCase()}.`);
      return;
    }
    const coins = permanent ? randomInt(20, 60) : randomInt(3, 25);
    give(player, ItemIdentifiers.COINS, coins);
    player.sendMessage(`You've been given ${coins} coins.`);
  }

  function cureVillager(event, is208) {
    const { player } = event;
    const npc = npcOf(event);
    const curedId = VILLAGER_CURED_FORM.get(event.npcId);
    if (!npc || curedId === undefined) return;
    if (!drainDoses(player, is208 ? SERUM_208_ITEM_IDS : SERUM_207_ITEM_IDS, 1)) return;
    npc.getCombat?.()?.reset?.();
    // Wiki (Afflicted): even serum 208 only cures ordinary villagers for a while.
    transformFor(npc, curedId, CURE_TICKS_VILLAGER);
    villagerReward(player, is208);
  }

  /** Serum cures Ulsquire and Razmire so their quest dialogue opens up, and changes the NPC. */
  function handleItemOnNpc(event) {
    const npcId = event.npcId ?? event.target?.getId?.();
    const is207 = SERUM_207_ITEM_IDS.includes(event.itemId);
    const is208 = SERUM_208_ITEM_IDS.includes(event.itemId);
    if (!is207 && !is208) return;
    if (VILLAGER_CURED_FORM.has(npcId)) {
      event.handled = true;
      if (quest.getStage(event.player) < STAGE_READ_DIARY) return;
      cureVillager(event, is208);
      return;
    }
    if (!ULSQUIRE_NPC_IDS.has(npcId) && !RAZMIRE_NPC_IDS.has(npcId)) return;
    event.handled = true;
    const { player } = event;
    if (quest.getStage(player) < STAGE_READ_DIARY) return;
    if (!drainDoses(player, is207 ? SERUM_207_ITEM_IDS : SERUM_208_ITEM_IDS, 1)) return;
    const isUlsquire = ULSQUIRE_NPC_IDS.has(npcId);
    const fresh = quest.getStage(player) >= STAGE_MADE_SERUM;
    const npc = npcOf(event);
    const curedId = isUlsquire ? NpcIdentifiers.ULSQUIRE_SHAUNCY : NpcIdentifiers.RAZMIRE_KEELGAN;
    transformFor(npc, curedId, is208 ? CURE_TICKS_208 : fresh ? CURE_TICKS_FRESH_207 : CURE_TICKS_STALE_207);
    if (is208) {
      player.setAttribute(
        isUlsquire ? PERM_ULSQUIRE_ATTRIBUTE : PERM_RAZMIRE_ATTRIBUTE,
        true
      );
      setMulti(player);
    } else {
      player.setAttribute(
        isUlsquire ? MET_ULSQUIRE_ATTRIBUTE : MET_RAZMIRE_ATTRIBUTE,
        player.getAttribute(isUlsquire ? MET_ULSQUIRE_ATTRIBUTE : MET_RAZMIRE_ATTRIBUTE) ||
          "cured"
      );
      setMulti(player);
    }
    if (!fresh) {
      player.sendMessage(
        "The serum it works...but it's not too fresh, make some yourself and then it might work for longer."
      );
      return;
    }
    if (is208 && !player.getAttribute(PERM_GIFT_ATTRIBUTE)) {
      player.setAttribute(PERM_GIFT_ATTRIBUTE, true);
      const coins = 180 + Math.floor(Math.random() * 41);
      player.getInventory().adds(ItemIdentifiers.COINS, coins);
      player.sendMessage(`You've been given ${coins} coins.`);
    }
  }

  /**
   * Wiki (Serum 208): a permanently cured Razmire or Ulsquire may look afflicted again after a
   * while, but becomes cured when talked to, for that player and everyone else.
   */
  function recureOnTalk({ player, npc, npcId }) {
    const curedId = CURED_FORM.get(npcId);
    if (curedId === undefined || !npc) return;
    const permanent = npcId === NpcIdentifiers.AFFLICTED_RAZMIRE_
      ? player.getAttribute(PERM_RAZMIRE_ATTRIBUTE)
      : player.getAttribute(PERM_ULSQUIRE_ATTRIBUTE);
    if (permanent) transformFor(npc, curedId, CURE_TICKS_208);
  }

  function talkToAfflictedRazmire({ player }) {
    if (player.getAttribute(PERM_RAZMIRE_ATTRIBUTE)) return false;
    player.sendMessage("This person doesn't make any sense at all.");
    return true;
  }

  /** Razmire's two Trade options, each to its own store (the quest-shop gates still apply). */
  function tradeWithRazmire(shopId) {
    return (event) => {
      event.handled = true;
      api.core.ShopManager.open(event.player, shopId, true);
    };
  }

  /** Materials repair the temple; sacred flame oil; logs and remains on the pyre. */
  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (TEMPLE_WALL_OBJECT_IDS.has(objectId)) {
      event.handled = true;
      repairTemple(player);
      return;
    }
    if (ALTAR_OBJECT_IDS.has(objectId) && OLIVE_TO_SACRED.has(itemId)) {
      event.handled = true;
      sanctifyOil(player);
      return;
    }
    if (ALTAR_OBJECT_IDS.has(objectId) && itemId === ItemIdentifiers.TINDERBOX) {
      event.handled = true;
      lightAltar(player);
      return;
    }
    if (ALTAR_OBJECT_IDS.has(objectId) && SERUM_207_ITEM_IDS.includes(itemId)) {
      event.handled = true;
      sanctifySerum(player);
    }
  }

  /**
   * Runs `step` every `ticks` until it returns false, the player walks away or logs out, or
   * another loop replaces it.
   */
  function repeatAction(player, ticks, step) {
    const token = {};
    player.setAttribute(ACTION_ATTRIBUTE, token);
    const start = player.getLocation().clone();
    const run = () => {
      if (!isOnline(player) || player.getAttribute(ACTION_ATTRIBUTE) !== token) return;
      if (!player.getLocation().equals(start)) {
        player.setAttribute(ACTION_ATTRIBUTE, null);
        return;
      }
      if (step() === false) {
        player.setAttribute(ACTION_ATTRIBUTE, null);
        return;
      }
      later(ticks, run);
    };
    run();
  }

  function hammerBoost(player) {
    if (held(player, ItemIdentifiers.FLAMTAER_HAMMER)) return FLAMTAER_HAMMER_BOOST;
    if (held(player, ItemIdentifiers.HAMMER) || held(player, ItemIdentifiers.IMCANDO_HAMMER)) return 0;
    return null;
  }

  function wearingBracelet(player) {
    return player.getEquipment?.()?.get?.(Equipment.HANDS_SLOT)?.getId?.() ===
      ItemIdentifiers.FLAMTAER_BRACELET;
  }

  /** One bracelet charge per build; Wiki: it disappears after 80. */
  function useBraceletCharge(player) {
    const left = (Number(player.getAttribute(BRACELET_CHARGES_ATTRIBUTE)) || FLAMTAER_BRACELET_CHARGES) - 1;
    if (left > 0) {
      player.setAttribute(BRACELET_CHARGES_ATTRIBUTE, left);
      return;
    }
    player.setAttribute(BRACELET_CHARGES_ATTRIBUTE, FLAMTAER_BRACELET_CHARGES);
    const equipment = player.getEquipment();
    equipment.set?.(Equipment.HANDS_SLOT, new api.core.Item(-1));
    equipment.refreshItems?.();
    player.sendMessage("Your Flamtaer bracelet crumbles to dust.");
  }

  function setsInInventory(player) {
    const timber = player.getInventory().getAmount(ItemIdentifiers.TIMBER_BEAM) +
      player.getInventory().getAmount(ItemIdentifiers.PLANK);
    return Math.min(
      player.getInventory().getAmount(ItemIdentifiers.LIMESTONE_BRICK),
      timber,
      Math.floor(player.getInventory().getAmount(ItemIdentifiers.SWAMP_PASTE) / 5)
    );
  }

  /** Turns whole material sets from the inventory into resources, 5% each, up to 100%. */
  function topUpResources(player) {
    let resources = resourcesOf(player);
    let added = 0;
    while (resources + RESOURCES_PER_SET <= 100 && setsInInventory(player) > 0) {
      const timberId = held(player, ItemIdentifiers.TIMBER_BEAM)
        ? ItemIdentifiers.TIMBER_BEAM
        : ItemIdentifiers.PLANK;
      player.getInventory().deleteNumber(ItemIdentifiers.LIMESTONE_BRICK, 1);
      player.getInventory().deleteNumber(timberId, 1);
      player.getInventory().deleteNumber(ItemIdentifiers.SWAMP_PASTE, 5);
      resources += RESOURCES_PER_SET;
      added++;
    }
    if (added > 0) setResources(player, resources);
    return added;
  }

  function checkAltarUnlock(player) {
    if (
      templeRepaired >= 100 &&
      sanctityOf(player) >= QUEST_MIN_SANCTITY_TENTHS &&
      quest.getStage(player) >= STAGE_REBUILD_TEMPLE &&
      quest.getStage(player) < STAGE_CAN_LIGHT_ALTAR
    ) {
      quest.setStage(player, STAGE_CAN_LIGHT_ALTAR);
      player.sendMessage("You are now allowed to light the holy fire altar.");
    }
  }

  /** Repair or Reinforce: keeps building while there are resources and the player stays put. */
  function repairTemple(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_ULSQUIRE_TEMPLE) {
      player.sendMessage("You're not sure how you would go about fixing this.");
      return;
    }
    if (hammerBoost(player) === null) {
      player.sendMessage("You need a hammer to repair this temple.");
      return;
    }
    if (player.getSkillManager().getCurrentLevel(Skill.CRAFTING) < REPAIR_CRAFTING_LEVEL) {
      player.sendMessage(`You need a Crafting level of ${REPAIR_CRAFTING_LEVEL} to repair this temple.`);
      return;
    }
    topUpResources(player);
    if (resourcesOf(player) < 1) {
      player.sendMessage(REPAIR_MATERIALS_MESSAGE);
      return;
    }
    if (stage < STAGE_REBUILD_TEMPLE) quest.setStage(player, STAGE_REBUILD_TEMPLE);
    showHud(player);
    // Capture 1846: the click's first build lands at once (+1% repair, +2% sanctity).
    repeatAction(player, BUILD_ATTEMPT_TICKS, () => {
      lastBuildTick = templeTicks;
      const boost = hammerBoost(player);
      if (boost === null) {
        player.sendMessage("You need a hammer to repair this temple.");
        return false;
      }
      if (resourcesOf(player) < 1) topUpResources(player);
      if (resourcesOf(player) < 1) {
        player.sendMessage("You have run out of building resources.");
        return false;
      }
      // TUNABLE: a Crafting roll; the Flamtaer hammer adds an invisible +40.
      const level = player.getSkillManager().getCurrentLevel(Skill.CRAFTING) + boost;
      const chance = Math.max(0.25, Math.min(0.6, 0.25 + (level - REPAIR_CRAFTING_LEVEL) / 200));
      if (Math.random() >= chance) return true;
      setResources(player, resourcesOf(player) - 1);
      setTempleRepaired(templeRepaired + 1);
      player.getSkillManager().addExperiences(Skill.CRAFTING, BUILD_CRAFTING_XP);
      let gain = BUILD_SANCTITY_TENTHS;
      if (wearingBracelet(player)) {
        gain = Math.round(gain * FLAMTAER_BRACELET_SANCTITY);
        useBraceletCharge(player);
      }
      // Capture 1846: most of the sanctity at once, the last 1% four ticks later.
      setSanctity(player, sanctityOf(player) + gain - 10);
      later(4, () => {
        if (isOnline(player)) setSanctity(player, sanctityOf(player) + 10);
        if (isOnline(player)) checkAltarUnlock(player);
      });
      checkAltarUnlock(player);
      return true;
    });
  }

  function sanctifyGate(player, item) {
    if (quest.getStage(player) < STAGE_CAN_LIGHT_ALTAR) {
      player.sendMessage(
        "You need to have repaired or reinforced the walls of the temple before you can use the sacred flame."
      );
      return false;
    }
    if (!altarLit) {
      player.sendMessage(`The fire altar needs to be lit before you can sanctify ${item}.`);
      return false;
    }
    return true;
  }

  const doseCount = (itemId, chain) => 4 - chain.indexOf(itemId);

  /** Serum 207 placed in the sacred flame becomes serum 208: 20% needed, 5% a dose. */
  function sanctifySerumOnce(player) {
    for (const [serumId, permanentId] of SERUM_207_TO_208) {
      if (player.getInventory().getAmount(serumId) <= 0) continue;
      const cost = doseCount(serumId, SERUM_207_ITEM_IDS) * SERUM_COST_TENTHS_PER_DOSE;
      if (sanctityOf(player) < Math.max(SERUM_MIN_SANCTITY_TENTHS, cost)) return "sanctity";
      player.getInventory().deleteNumber(serumId, 1);
      player.getInventory().adds(permanentId, 1);
      setSanctity(player, sanctityOf(player) - cost);
      player.setAttribute(MADE_PERM_SERUM_ATTRIBUTE, true);
      setMulti(player);
      player.sendMessage("You sanctify the serum in the sacred flame.");
      return "done";
    }
    return "none";
  }

  /** Olive oil becomes sacred oil: 10% needed, 0.9% a dose. */
  function sanctifyOilOnce(player) {
    for (const [oilId, sacredId] of OLIVE_TO_SACRED) {
      if (player.getInventory().getAmount(oilId) <= 0) continue;
      const cost = doseCount(oilId, OLIVE_OIL_ITEM_IDS) * OIL_COST_TENTHS_PER_DOSE;
      if (sanctityOf(player) < Math.max(OIL_MIN_SANCTITY_TENTHS, cost)) return "sanctity";
      player.getInventory().deleteNumber(oilId, 1);
      player.getInventory().adds(sacredId, 1);
      setSanctity(player, sanctityOf(player) - cost);
      player.sendMessage("You carefully sanctify the oil in the sacred flame.");
      if (quest.getStage(player) < STAGE_CREATED_SACRED_OIL) {
        quest.setStage(player, STAGE_CREATED_SACRED_OIL);
      }
      return "done";
    }
    return "none";
  }

  /** Wiki (31 July 2024): sanctifying carries on through the rest of the vials. */
  function sanctifyLoop(player, steps) {
    let made = 0;
    repeatAction(player, SANCTIFY_TICKS, () => {
      if (!altarLit) return false;
      for (const step of steps) {
        const result = step(player);
        if (result === "done") {
          made++;
          return true;
        }
        if (result === "sanctity") {
          player.sendMessage("You don't have enough sanctity to do that.");
          return false;
        }
      }
      if (made === 0) player.sendMessage("You have nothing to sanctify.");
      return false;
    });
  }

  function sanctifySerum(player) {
    if (sanctifyGate(player, "the serum")) sanctifyLoop(player, [sanctifySerumOnce]);
  }

  function sanctifyOil(player) {
    if (sanctifyGate(player, "oil")) sanctifyLoop(player, [sanctifyOilOnce]);
  }

  /** The lit altar's left-click Use: olive oil first, then serum 207. */
  function useAltar(player) {
    if (sanctifyGate(player, "anything")) sanctifyLoop(player, [sanctifyOilOnce, sanctifySerumOnce]);
  }

  function installAltar({ regionId }) {
    if (regionId !== FLAMTAER_REGION_ID || templeRegionLoaded) return;
    templeRegionLoaded = true;
    startTempleTask();
    wallStep = 0;
    refreshWalls();
    refreshAltar();
  }

  function lightAltar(player) {
    if (quest.getStage(player) < STAGE_CAN_LIGHT_ALTAR) {
      player.sendMessage(
        "You need to have repaired or reinforced the walls of the temple before you can light the sacred flame."
      );
      return;
    }
    if (!altarRestored) {
      player.sendMessage("The temple needs to be repaired before the fire altar can be lit.");
      return;
    }
    if (!held(player, ItemIdentifiers.TINDERBOX)) {
      player.sendMessage("You need a tinderbox to light the fire altar.");
      return;
    }
    if (altarLit) {
      player.sendMessage("The fire altar is already lit.");
      return;
    }
    altarLit = true;
    refreshAltar();
    player.sendMessage("You light the temple fire.");
  }

  /** The minigame's funeral pyres (minigames/ShadesOfMortton.plugin.js) bring the quest's two steps. */
  function pyreLogsPlaced({ player }) {
    const stage = player ? quest.getStage(player) : 0;
    if (stage >= STAGE_CREATED_PYRE_LOGS && stage < STAGE_LOGS_ON_PYRE) quest.setStage(player, STAGE_LOGS_ON_PYRE);
  }

  function cremated({ player }) {
    const stage = player ? quest.getStage(player) : 0;
    if (stage >= STAGE_CREATED_PYRE_LOGS && stage < STAGE_LIT_PYRE) quest.setStage(player, STAGE_LIT_PYRE);
  }

  /** The diary shelf and the smashed table of Herbi Flax's house. */
  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    if (objectId === ObjectIdentifiers.FIRE_ALTAR && event.clickType === 1) {
      event.handled = true;
      lightAltar(player);
      return;
    }
    if (objectId === ObjectIdentifiers.FLAMING_FIRE_ALTAR && event.clickType === 1) {
      event.handled = true;
      useAltar(player);
      return;
    }
    if (TEMPLE_WALL_OBJECT_IDS.has(objectId) && event.clickType === 1) {
      event.handled = true;
      repairTemple(player);
      return;
    }
    if (objectId === SHELF_OBJECT_ID) {
      event.handled = true;
      if (held(player, DIARY_ITEM_ID)) {
        player.sendMessage("You find nothing useful here.");
        return;
      }
      if (freeSlots(player) < 1) {
        player.sendMessage("There's a book on the shelf but you don't have room to take it.");
        return;
      }
      player.getInventory().adds(DIARY_ITEM_ID, 1);
      player.sendMessage("You find an interesting looking book on the shelf.");
      return;
    }
    if (objectId === SMASHED_TABLE_OBJECT_ID) {
      event.handled = true;
      if (player.getAttribute(TABLE_SEARCHED_ATTRIBUTE)) {
        player.sendMessage("You search the table but find nothing.");
        return;
      }
      if (freeSlots(player) < 3) {
        player.sendMessage(
          "You see three herbs inside, but you don't have enough inventory space to take them."
        );
        return;
      }
      player.setAttribute(TABLE_SEARCHED_ATTRIBUTE, true);
      player.getInventory().adds(ItemIdentifiers.GRIMY_TARROMIN, 2);
      player.getInventory().adds(ItemIdentifiers.GRIMY_ROGUES_PURSE, 1);
      player.sendMessage("You find a selection of herbs.");
    }
  }

  function handleLogin({ player }) {
    // The old completion value was 100; native rev-227 uses 85.
    if (quest.getStage(player) > STAGE_COMPLETE) quest.setStage(player, STAGE_COMPLETE);
    refreshQuestList(player);
    // Wiki: sanctity is lost on logout.
    player.setAttribute(SANCTITY_TENTHS_ATTRIBUTE, 0);
    hudShown.delete(player);
    syncTemple(player);
    syncCuredNpcs(player);
    startTempleTask();
  }

  api.persistAttribute(KILLS_ATTRIBUTE);
  api.persistAttribute(MET_ULSQUIRE_ATTRIBUTE);
  api.persistAttribute(MET_RAZMIRE_ATTRIBUTE);
  api.persistAttribute(OLIVE_OIL_ATTRIBUTE);
  api.persistAttribute(TABLE_SEARCHED_ATTRIBUTE);
  // Retired keys from older saves (temple repair is world-wide and sanctity is not saved).
  api.persistAttribute(TEMPLE_REPAIRED_ATTRIBUTE, 0);
  api.persistAttribute(TEMPLE_SANCTITY_ATTRIBUTE, 0);
  api.persistAttribute(TEMPLE_RESOURCES_ATTRIBUTE, 0);
  api.persistAttribute(BRACELET_CHARGES_ATTRIBUTE, FLAMTAER_BRACELET_CHARGES);
  api.persistAttribute(PERM_ULSQUIRE_ATTRIBUTE, false);
  api.persistAttribute(PERM_RAZMIRE_ATTRIBUTE, false);
  api.persistAttribute(MULTI_ATTRIBUTE);
  api.persistAttribute(PERM_GIFT_ATTRIBUTE, false);
  api.persistAttribute(MADE_PERM_SERUM_ATTRIBUTE, false);

  quest = registerQuest(api, {
    key: "shades_of_mortton",
    name: "Shades of Mort'ton",
    varpId: VARP_SHADES_OF_MORTTON,
    startedValue: STAGE_READ_DIARY,
    completionValue: STAGE_COMPLETE,
    questPoints: 3,
    xpRewards: [
      { skillId: Skill.CRAFTING.getIndex(), amount: 2000, label: "Crafting" },
      { skillId: Skill.HERBLORE.getIndex(), amount: 2000, label: "Herblore" },
    ],
    otherRewards: ["Access to the Shade Lair", "Access to Razmire's stores"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcInteraction("Afflicted(Razmire)", { "Talk-to": talkToAfflictedRazmire });
  api.onNpcInteraction("Razmire Keelgan", {
    "Trade-General-Store": tradeWithRazmire(RAZMIRE_GENERAL_STORE),
    "Trade-Builders-Store": tradeWithRazmire(RAZMIRE_BUILDERS_STORE),
  });
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onItemAction(handleItemAction);
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onObjectInteraction(handleObjectInteraction);
  api.onNpcDeath(handleNpcDeath);
  api.onCustomEvent("shades-of-mortton:pyre-logs", pyreLogsPlaced);
  api.onCustomEvent("shades-of-mortton:cremated", cremated);
  api.onRegionLoaded(installAltar);
  api.onPlayerLogin(handleLogin);
};
