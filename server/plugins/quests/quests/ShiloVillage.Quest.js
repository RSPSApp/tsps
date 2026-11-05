/**
 * Shilo Village (members, requires Jungle Potion, 20 Crafting, 32 Agility).
 *
 * The words come from the "Shilo Village", "Mosol Rei" and "Trufitus" transcript
 * pages; this plugin selects Mosol Rei's and Trufitus' variants by stage, answers
 * the page's prose conditions, runs the start hook, replays the quest's scene
 * variants (mound, fissure, Ah Za Rhoon props, gallows, dolmens, tomb gates)
 * through the dialogue runtime, and drives the item chain (Wampum belt, corpse,
 * bone shard, bone key, bone beads, Beads of the Dead).
 *
 * Stages (varp 116, the OSRS Zombie Queen varp): 0 not started, 1 started,
 * 2 found mound, 3 searched mound, 4 dug, 5 lit, 6 roped, 7 entered Ah Za Rhoon,
 * 8 left Ah Za Rhoon, 9 entered Bervirius' tomb, 10 bone key opened Rashiliyia's
 * tomb, 11 entered wearing the Beads of the Dead, 12 three bones unlocked the
 * tomb door, 14 corpse taken, 15 complete.
 *
 * The crafting/door/Nazastarool progress lives in the persisted
 * "quest.shilo_village.mechanisms" bits:
 *   bit 0 read crumpled scroll, bit 1 found the bone lock, bit 2 table wood
 *   used, bit 3 searched the palm trees, bits 7-8 bones placed, bits 9-11
 *   Nazastarool form defeated.
 *
 * Rashiliyia's tomb doors are the cache's multilocs 34657 and 34673, on varbit 8180:
 * 0 jungle plants, 1 carved doors, 2 hillside entrance. Captures 1444 and 1590 show 2 at login.
 *
 * Source: LostCityRS/Content scripts/quests/quest_zombiequeen (pinned in #196).
 * Gaps: no world object hot-swapping for opened doors and no
 * raft/waterfall/cave-in cinematic - the waterfall exit and Bervirius crawl
 * teleport straight to the next tile; Shilo's roaming undead and Rashiliyia's
 * timed summon are only spawned by the transcript's own action markers; the
 * locating crystal's leading "missing" export step aborts that transcript, so
 * its glow tiers are sent directly and the always-draw option is not offered;
 * the scrolls and notes show their text in the message scroll interface, which is
 * inferred, as no capture shows them; Trufitus is shared with Jungle Potion, so once this quest has
 * started the plugin plays his Shilo variant itself from a Talk-to interaction
 * instead of relying on selector registration order; the requirements condition
 * only checks combat level.
 */
const ObstacleRunner = require("../../skills/agility/ObstacleRunner.Agility");

module.exports = function registerShiloVillageQuest(api) {
  const {
    Skill,
    Equipment,
    Location,
    GameObject,
    ObjectManager,
    ItemIdentifiers,
    NpcIdentifiers,
    ObjectIdentifiers,
    TaskManager,
    CountdownTask,
    CacheDefinitions,
  } = api.core;
  const { registerQuest, startTranscript, refreshQuestList } = require("../QuestRuntime");

  const PAGE = "Shilo Village";

  const TRUFITUS = NpcIdentifiers.TRUFITUS; // 4625
  const MOSOL_REI_IDS = new Set([NpcIdentifiers.MOSOL_REI, NpcIdentifiers.MOSOL_REI_2]); // 5340, 8696
  const SPIRIT_OF_ZADIMUS = NpcIdentifiers.SPIRIT_OF_ZADIMUS; // 5341
  const RASHILIYIA = NpcIdentifiers.RASHILIYIA; // 5352
  const NAZASTAROOL_FORMS = [
    NpcIdentifiers.NAZASTAROOL, // 5353 zombie
    NpcIdentifiers.NAZASTAROOL_2, // 5354 skeleton
    NpcIdentifiers.NAZASTAROOL_3, // 5355 ghost
  ];
  const UNDEAD_ONE_ID = NpcIdentifiers.UNDEAD_ONE; // 5342
  const YANNI = NpcIdentifiers.YANNI_SALIKA; // 5361

  const VARP_SHILO_VILLAGE = 116;
  const STAGE_STARTED = 1;
  const STAGE_FOUND_MOUND = 2;
  const STAGE_SEARCHED_MOUND = 3;
  const STAGE_DUG_MOUND = 4;
  const STAGE_LIT_MOUND = 5;
  const STAGE_ROPED_MOUND = 6;
  const STAGE_ENTERED_TEMPLE = 7;
  const STAGE_LEFT_TEMPLE = 8;
  const STAGE_ENTERED_BERVIRIUS = 9;
  const STAGE_UNLOCKED_RASHILIYIA_TOMB = 10;
  const STAGE_ENTERED_WITH_BEADS = 11;
  const STAGE_UNLOCKED_TOMB_DOOR = 12;
  const STAGE_RETRIEVED_CORPSE = 14;
  const STAGE_COMPLETE = 15;

  const WAMPUM_BELT = ItemIdentifiers.WAMPUM_BELT; // 625
  const ZADIMUS_CORPSE = ItemIdentifiers.ZADIMUS_CORPSE; // 610
  const BONE_SHARD = ItemIdentifiers.BONE_SHARD; // 604
  const BONE_KEY = ItemIdentifiers.BONE_KEY; // 605
  const STONE_PLAQUE = ItemIdentifiers.STONE_PLAQUE; // 606
  const TATTERED_SCROLL = ItemIdentifiers.TATTERED_SCROLL; // 607
  const CRUMPLED_SCROLL = ItemIdentifiers.CRUMPLED_SCROLL; // 608
  const RASHILIYIA_CORPSE = ItemIdentifiers.RASHILIYIA_CORPSE; // 609
  const LOCATING_CRYSTAL = ItemIdentifiers.LOCATING_CRYSTAL; // 611
  const LOCATING_CRYSTAL_IDS = new Set([
    ItemIdentifiers.LOCATING_CRYSTAL,
    ItemIdentifiers.LOCATING_CRYSTAL_2,
    ItemIdentifiers.LOCATING_CRYSTAL_3,
    ItemIdentifiers.LOCATING_CRYSTAL_4,
    ItemIdentifiers.LOCATING_CRYSTAL_5,
  ]);
  const BEADS_OF_THE_DEAD = ItemIdentifiers.BEADS_OF_THE_DEAD; // 616
  const BONE_BEADS = ItemIdentifiers.BONE_BEADS; // 618
  const SWORD_POMMEL = ItemIdentifiers.SWORD_POMMEL; // 623
  const BERVIRIUS_NOTES = ItemIdentifiers.BERVIRIUS_NOTES; // 624
  const BRONZE_WIRE = ItemIdentifiers.BRONZE_WIRE; // 1794
  const CHISEL = ItemIdentifiers.CHISEL; // 1755
  const COINS = ItemIdentifiers.COINS; // 995
  const SPADE = ItemIdentifiers.SPADE; // 952
  const ROPE = ItemIdentifiers.ROPE; // 954
  const BONES = ItemIdentifiers.BONES; // 526
  const LIGHT_SOURCE_IDS = new Set([
    ItemIdentifiers.LIT_CANDLE,
    ItemIdentifiers.LIT_BLACK_CANDLE,
    ItemIdentifiers.LIT_TORCH,
  ]);

  const MOUND_OF_EARTH = ObjectIdentifiers.MOUND_OF_EARTH; // 2217
  const FISSURE = ObjectIdentifiers.FISSURE; // 2218
  const ROPE_FISSURE = ObjectIdentifiers.FISSURE_2; // 2219
  const FISSURE_IDS = new Set([FISSURE, ROPE_FISSURE]);
  const CAVE_IN = ObjectIdentifiers.CAVE_IN; // 2220
  const STRANGE_LOOKING_STONE = ObjectIdentifiers.STRANGE_LOOKING_STONE; // 2221
  const LOOSE_ROCKS = ObjectIdentifiers.LOOSE_ROCKS; // 2222
  const OLD_SACKS = ObjectIdentifiers.OLD_SACKS; // 2223
  const ANCIENT_GALLOWS = ObjectIdentifiers.ANCIENT_GALLOWS; // 2224
  const WATERFALL_ROCKS = ObjectIdentifiers.WATERFALL_ROCKS_2; // 2225
  const SMASHED_TABLE = ObjectIdentifiers.SMASHED_TABLE; // 2226
  const WELL_STACKED_ROCKS = ObjectIdentifiers.WELL_STACKED_ROCKS; // 2234
  const TOMB_DOLMEN = ObjectIdentifiers.TOMB_DOLMEN; // 2235 (Bervirius')
  // 2236, in Bervirius' tomb; 10851 is the Agility Pyramid's top and 10852 is never placed.
  const CLIMBING_ROCKS = ObjectIdentifiers.CLIMBING_ROCKS; // 2236
  const PALM_TREE = ObjectIdentifiers.PALM_TREE; // 2237
  const CARVED_DOORS_IDS = new Set([ObjectIdentifiers.CARVED_DOORS, ObjectIdentifiers.CARVED_DOORS_2]); // 2240, 2241
  const TOMB_EXIT_IDS = new Set([
    ObjectIdentifiers.TOMB_EXIT,
    ObjectIdentifiers.TOMB_EXIT_2,
    ObjectIdentifiers.TOMB_EXIT_3,
    ObjectIdentifiers.TOMB_EXIT_4,
  ]); // 2242, 2243, 2253, 2254
  const TOMB_DOOR_IDS = new Set([
    ObjectIdentifiers.TOMB_DOORS,
    ObjectIdentifiers.TOMB_DOORS_2,
    ObjectIdentifiers.TOMB_DOORS_3,
    ObjectIdentifiers.TOMB_DOORS_4,
    ObjectIdentifiers.TOMB_DOORS_5,
  ]); // 2246-2250
  const ANCIENT_METAL_GATE_IDS = new Set([
    ObjectIdentifiers.ANCIENT_METAL_GATE,
    ObjectIdentifiers.ANCIENT_METAL_GATE_2,
  ]); // 2255, 2256
  const TOMB_DOLMEN_RASHILIYIA = ObjectIdentifiers.TOMB_DOLMEN_2; // 2258
  const HIDDEN_TOMB_DOOR_LOCS = new Set([34657, 34673]);
  const VARBIT_TOMB_DOORS = 8180;
  const TOMB_DOORS_HIDDEN = 0;
  const TOMB_DOORS_CLOSED = 1;
  const TOMB_DOORS_OPEN = 2;
  const TOMB_ROCKS = ObjectIdentifiers.ROCKS_3; // 2257
  /** Rashiliyia's tomb only: other "Rocks" may share the id. */
  const TOMB_ROCKS_AREA = { minX: 2925, maxX: 2932, minY: 9509, maxY: 9517 };
  /** The two tiles the cache's placements leave open at either end of the rocks. */
  const ABOVE_TOMB_ROCKS_TILE = { x: 2929, y: 9515, z: 0 };
  const BELOW_TOMB_ROCKS_TILE = { x: 2928, y: 9511, z: 0 };
  const TOMB_ROCKS_MIDDLE_Y = 9512;

  /**
   * The Brimhaven-road cart (multiloc 2216 on the zombiequeen varp): "Look-at"/"Search" before the quest, and
   * after it only "Climb over". Captured (rsprox 1102 ticks 13657-13659, road side to village): oploc2 on 2216 at
   * 2877,2951, sequence 828 (delay 15), sounds 4035, 4033 (delay 13), 4034 (delay 19), then the next tick the line
   * "You nimbly jump from one side of the cart to the other, and climb down again." and the teleport to 2876,2952,
   * which is OUTSIDE the village's gate. The way back (2880,2952, transports.json) has no capture: the same sequence.
   */
  const BROKEN_CART_LOC = 2216;
  const CART_MIDDLE_X = 2878;
  const CART_INSIDE_TILE = { x: 2876, y: 2952, z: 0 };
  const CART_OUTSIDE_TILE = { x: 2880, y: 2952, z: 0 };
  const CART_LINE = "You nimbly jump from one side of the cart to the other, and climb down again.";
  /**
   * The village's gate, metal gates 2259/2260 at 2875 (rsprox 1102 ticks 13663-13666): oploc1 from 2876,2952, a
   * step to 2875, then a step to 2874 with "You open the gates and make your way through into the village." and sound
   * 71. After the quest only; leaving is the same walk the other way (inferred: no capture, no line).
   */
  const VILLAGE_GATE_IDS = new Set([2259, 2260]);
  const VILLAGE_GATE_LINE = "You open the gates and make your way through into the village.";
  const VILLAGE_GATE_SOUND = 71;
  /** Where Mosol Rei's Follow lands the player, one step inside the gate (the Wiki says only "into the village"). */
  const VILLAGE_INSIDE_TILE = { x: 2874, y: 2952, z: 0 };
  /** Mosol Rei's two messages after "Yes, Ok, I'll go into the village!" (Wiki, Transcript:Mosol Rei). */
  const MESSAGE_MOSOL_LEADS = "SfsaEg";
  const MESSAGE_MOSOL_LEAVES = "uAQHgJ";
  /** Rashiliyia's tomb rocks (#2643: "no animation going down"): the way down and up as a forced walk, one tile a tick. */
  const ROCKS_TOP_TILE = [2929, 9515];
  const ROCKS_BOTTOM_TILE = [2928, 9511];
  const ROCKS_DOWN_PATH = [[2928, 9514], [2928, 9513], [2928, 9512], ROCKS_BOTTOM_TILE];
  const ROCKS_UP_PATH = [[2928, 9512], [2928, 9513], [2929, 9514], ROCKS_TOP_TILE];
  /**
   * Cairn Isle's bridge (Wiki Cairn Isle: Agility 1, 10 XP, success chart low 75 high 250, a failure is three hits of
   * floor(HP / 11), walking or running alike; rsprox 1102 tick 15955 and 75: "You manage to keep your balance on the
   * bridge." as the runner crosses y 2979 at x 2779; capture 352 has those lines 20 ticks apart, also while shuttling
   * on the bridge, which reads as a 20-tick timer). The bridge tiles are x 2776-2781 on y 2979. OURS, unknown to the
   * Wiki and the captures: the failure line, where the player lands, and that a roll needs the player to have moved
   * since the last one (standing still would be an AFK Agility farm; 352 does not show standing still).
   */
  const BRIDGE = { minX: 2776, maxX: 2781, y: 2979 };
  const BRIDGE_LOW = 75;
  const BRIDGE_HIGH = 250;
  const BRIDGE_XP = 10;
  const BRIDGE_REROLL_TICKS = 20;
  const BRIDGE_KEEP_BALANCE = "You manage to keep your balance on the bridge.";
  const BRIDGE_FALL = "You lose your balance and fall into the river!";
  const BRIDGE_LANDING = { x: 2782, y: 2979, z: 0 };
  const PRISM_SOLD_ATTRIBUTE = "quest.shilo_village.prism_sold";
  const YANNI_PAGE = "Yanni Salika";

  const START_HOOK = "quest:shilo-village:start";
  const ACTION_RECEIVE_WAMPUM = "10Zz1R";
  const ACTION_SPAWN_TWO_UNDEAD = "Xkfm6o";
  const ACTION_ENTER_TEMPLE = "hD81Mw";
  const ACTION_RECEIVE_BONE_SHARD = "jlQo6F";
  const ACTION_SPAWN_UNDEAD = "vNDeU9";
  const ACTION_GATE_UNDEAD = "UTuQLV";
  const ACTION_COMPLETE = "l7zrz_";
  const REFERENCE_READ_TATTERED = "WH07P-";
  const REFERENCE_READ_CRUMPLED = "n7hNYR";
  const REFERENCE_READ_NOTES_YELLOW = "7aG-WD";
  const REFERENCE_READ_NOTES_WHITE = "0uSJB3";
  const REFERENCE_READ_NOTES_ORANGE = "i8hwtu";
  const ACTION_NAZASTAROOL_SPAWN_1 = "KPnwZH";
  const ACTION_NAZASTAROOL_CONTINUES_1 = "1sBGNX";
  const ACTION_NAZASTAROOL_SPAWN_2 = "dKXOjT";
  const ACTION_NAZASTAROOL_CONTINUES_2 = "naCrkQ";
  const ACTION_NAZASTAROOL_SPAWN_3 = "fwg4og";
  const ACTION_NAZASTAROOL_CONTINUES_3 = "cRaa-L";
  const MESSAGE_NAZASTAROOL_DEATH_1 = "7tIfZW";
  const MESSAGE_NAZASTAROOL_DEATH_2 = "LrgBDG";
  const MESSAGE_NAZASTAROOL_VOICE = "1uC0er";
  const MESSAGE_NAZASTAROOL_CORPSE = "dBR0dC";
  const CONDITION_WATERFALL_SUCCESS = "k-JIXW";
  const CONDITION_CLIMB_SUCCESS = "EeRyCh";

  const MECH_ATTRIBUTE = "quest.shilo_village.mechanisms";
  const PENDING_BONE_ATTRIBUTE = "quest.shilo_village.pending_bone";

  const MECH_READ_CRUMPLED = 1 << 0;
  const MECH_FOUND_BONE_DOOR = 1 << 1;
  const MECH_USED_TABLE_WOOD = 1 << 2;
  const MECH_SEARCHED_PALM = 1 << 3;
  const MECH_DEFEATED_1 = 1 << 9;
  const MECH_DEFEATED_2 = 1 << 10;
  const MECH_DEFEATED_3 = 1 << 11;
  const BONES_SHIFT = 7;
  const BONES_MASK = 0x3;

  /** The cache places the 3x3 Mound of earth at 2921,2999 shape 10, rotation 0. */
  const MOUND_TILE = { x: 2921, y: 2999, z: 0 };
  const MOUND_TYPE = 10;
  const MOUND_FACE = 0;

  /** Tomb of Rashiliyia surface centre (LostCity 0_45_48_36_20). */
  const TOMB_CENTER = { x: 2916, y: 3092 };
  const SACRED_ZONE = { minX: 2794, maxX: 2806, minY: 3087, maxY: 3102 };
  const AH_ZA_RHOON_TILE = { x: 2898, y: 9401, z: 0 };
  const BERVIRIUS_TOMB_TILE = { x: 2760, y: 9389, z: 0 };
  const RASHILIYIA_TOMB_TILE = { x: 2929, y: 9525, z: 0 };
  const TOMB_EXIT_TILE = { x: 2916, y: 3093, z: 0 };
  const WATERFALL_EXIT_TILE = { x: 2928, y: 2947, z: 0 };
  const CLIMB_OUT_TILE = { x: 2764, y: 2976, z: 0 };
  const CAVE_IN_UPPER_TILE = { x: 2888, y: 9283, z: 0 };
  const CAVE_IN_LOWER_TILE = { x: 2887, y: 9374, z: 0 };

  const TRUFITUS_ITEM_VARIANTS = new Map([
    [WAMPUM_BELT, "starting-out-using-the-wampum-belt-on-trufitus"],
    [ZADIMUS_CORPSE, "visiting-ah-za-rhoon-using-the-zadimus-corpse-on-trufitus"],
    [STONE_PLAQUE, "visiting-ah-za-rhoon-using-the-stone-plaque-on-trufitus"],
    [TATTERED_SCROLL, "visiting-ah-za-rhoon-using-the-tattered-scroll-on-trufitus"],
    [CRUMPLED_SCROLL, "visiting-ah-za-rhoon-using-the-crumpled-scroll-on-trufitus"],
    [BONE_SHARD, "visiting-ah-za-rhoon-using-the-bone-shard-on-trufitus"],
    [SWORD_POMMEL, "visiting-the-tomb-of-bervirius-using-the-sword-pommel-on-trufitus"],
    [BERVIRIUS_NOTES, "visiting-the-tomb-of-bervirius-using-bervirius-notes-on-trufitus"],
    [BONE_BEADS, "visiting-the-tomb-of-bervirius-using-bone-beads-on-trufitus"],
    [BEADS_OF_THE_DEAD, "visiting-the-tomb-of-bervirius-using-beads-of-the-dead-on-trufitus"],
    [BONE_KEY, "visiting-the-tomb-of-bervirius-using-the-bone-key-on-trufitus"],
    [RASHILIYIA_CORPSE, "visiting-the-tomb-of-rashiliyia-using-rashiliyias-remains-on-trufitus"],
  ]);

  /**
   * What Yanni Salika pays for the quest's leftovers (Wiki: Shilo Village rewards and Transcript:Yanni Salika;
   * the lines are the generated "using-antiques-on-yanni-*" variants). The black prism is a choice.
   */
  const YANNI_SALES = new Map([
    [BONE_KEY, { price: 100, variant: "using-antiques-on-yanni-bone-key" }],
    [CRUMPLED_SCROLL, { price: 100, variant: "using-antiques-on-yanni-crumpled-scroll" }],
    [TATTERED_SCROLL, { price: 100, variant: "using-antiques-on-yanni-tattered-scroll" }],
    [BERVIRIUS_NOTES, { price: 100, variant: "using-antiques-on-yanni-bervirius-notes" }],
    [ItemIdentifiers.BERVIRIUS_NOTES_2, { price: 100, variant: "using-antiques-on-yanni-bervirius-notes" }],
    [STONE_PLAQUE, { price: 100, variant: "using-antiques-on-yanni-stone-plaque" }],
    [BEADS_OF_THE_DEAD, { price: 1000, variant: "using-antiques-on-yanni-beads-of-the-dead" }],
    [ItemIdentifiers.BLACK_PRISM, { price: 5000, variant: "using-antiques-on-yanni-black-prism", asks: true }],
  ]);
  for (const id of LOCATING_CRYSTAL_IDS) {
    YANNI_SALES.set(id, { price: 500, variant: "using-antiques-on-yanni-locating-crystal" });
  }
  /** The prism Yanni was shown and is waiting to be told Yes or No about, with the slot it came from. */
  const pendingPrismSale = new Map();

  /** The Wiki's transcripts; the wrapping and the choice of interface are ours. */
  const SCROLLS = new Map([
    [REFERENCE_READ_TATTERED, {
      text: "Bervirius, son of King Danthalas, was killed in battle. His devout mother Rashiliyia was so heartbroken "
        + "that she swore fealty to Zamorak if he would return her son to her. Bervirius returned as an undead "
        + "creature and terrorized the King and Queen. Many guards died fighting the undead Bervirius. Eventually "
        + "the undead Bervirius was set on fire and soon only the bones remained. His remains were taken far to the "
        + "South, and then towards the setting sun to a tomb that is surrounded by and level with the sea. This is "
        + "the only way to contain the spirits of witches and the undead.",
    }],
    [REFERENCE_READ_CRUMPLED, {
      text: "Rashiliyia's rage went unchecked. She killed without mercy for revenge of her son's life. Like a spectre "
        + "through the night she entered houses and one by one quietly strangled life from the occupants. It is said "
        + "only a handful survived, protected by the necklace wards to keep the Witch Queen at bay.",
    }],
    [REFERENCE_READ_NOTES_YELLOW, {
      text: "...and rest like your mother who is silent in the peace of her tomb far to the North of Ah Za Rhoon. Near "
        + "the sea, and under the hills deep in the underground to watch all nature from the darkness of her final "
        + "resting place.",
    }],
    [REFERENCE_READ_NOTES_WHITE, {
      text: "...Rashiliyia did so love objects of beauty. Her tomb was adorned with crystals that glowed brightly when "
        + "near to each other.",
    }],
    [REFERENCE_READ_NOTES_ORANGE, {
      text: "...the sphere is activated when power of a spiritual nature is expended upon it, this can be very draining "
        + "on the body...",
    }],
  ]);
  const SCROLL_INTERFACE = "messagescroll"; // 220
  const SCROLL_LINES = 15;
  const SCROLL_LINE_WIDTH = 55;

  let quest;
  const nazastaroolByPlayer = new Map();
  const nazNarration = new Map();
  const pendingLightByPlayer = new Map();

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;
  const give = (player, itemId, amount = 1) => player.getInventory().adds(itemId, amount);
  const take = (player, itemId, amount = 1) => player.getInventory().deleteNumber(itemId, amount);
  const craftingLevel = (player) => player.getSkillManager().getCurrentLevel(Skill.CRAFTING);
  const hpLevel = (player) => player.getSkillManager().getCurrentLevel(Skill.HITPOINTS);
  const agilityLevel = (player) => player.getSkillManager().getCurrentLevel(Skill.AGILITY);

  function freeSlots(player) {
    const inventory = player.getInventory();
    if (typeof inventory.getFreeSlots === "function") return inventory.getFreeSlots();
    return inventory.isFull() ? 0 : 28;
  }

  function mech(player) {
    return Number(player.getAttribute(MECH_ATTRIBUTE)) || 0;
  }

  function mechTest(player, bit) {
    return (mech(player) & bit) !== 0;
  }

  function mechSet(player, bit, on) {
    const value = mech(player);
    player.setAttribute(MECH_ATTRIBUTE, on ? value | bit : value & ~bit);
  }

  function bonesPlaced(player) {
    return (mech(player) >> BONES_SHIFT) & BONES_MASK;
  }

  function setBonesPlaced(player, count) {
    const value = mech(player);
    player.setAttribute(MECH_ATTRIBUTE, (value & ~(BONES_MASK << BONES_SHIFT)) | ((count & BONES_MASK) << BONES_SHIFT));
  }

  function advance(player, stage) {
    if (quest.isComplete(player)) return;
    if (quest.getStage(player) < stage) quest.setStage(player, stage);
  }

  function scene(player, npcId, variant) {
    pendingLightByPlayer.delete(player);
    startTranscript(api, player, npcId, PAGE, variant);
  }

  function wearingBeads(player) {
    const item = player.getEquipment().get(Equipment.AMULET_SLOT);
    return item?.getId?.() === BEADS_OF_THE_DEAD;
  }

  function inSacredZone(player) {
    const pos = player.getLocation();
    return (
      pos.getX() >= SACRED_ZONE.minX &&
      pos.getX() <= SACRED_ZONE.maxX &&
      pos.getY() >= SACRED_ZONE.minY &&
      pos.getY() <= SACRED_ZONE.maxY
    );
  }

  function crystalDistance(player) {
    const pos = player.getLocation();
    return Math.max(
      Math.abs(pos.getX() - TOMB_CENTER.x),
      Math.abs(pos.getY() - TOMB_CENTER.y)
    );
  }

  function teleport(player, tile) {
    player.moveTo(new Location(tile.x, tile.y, tile.z));
  }

  function ownedMoundObject(player) {
    return ObjectManager.objectsAt(new Location(MOUND_TILE.x, MOUND_TILE.y, MOUND_TILE.z))
      .find((object) => object.getOwner?.() === player && (object.getId() === FISSURE || object.getId() === ROPE_FISSURE));
  }

  function tombDoorState(player) {
    if (quest.getStage(player) >= STAGE_UNLOCKED_RASHILIYIA_TOMB) return TOMB_DOORS_OPEN;
    // A save from before the doors could be seen, which got as far as their lock, has searched.
    return mechTest(player, MECH_SEARCHED_PALM) || mechTest(player, MECH_FOUND_BONE_DOOR)
      ? TOMB_DOORS_CLOSED
      : TOMB_DOORS_HIDDEN;
  }

  function syncTombDoors(player) {
    player.getPacketSender().sendVarbit(VARBIT_TOMB_DOORS, tombDoorState(player));
  }

  function openScroll(player, { text }) {
    const lines = [];
    let line = "";
    for (const word of text.split(" ")) {
      if (line && line.length + 1 + word.length > SCROLL_LINE_WIDTH) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    lines.push(line);
    const sender = player.getPacketSender();
    sender.sendInterface(CacheDefinitions.getInterfaceId(SCROLL_INTERFACE));
    for (let index = 0; index < SCROLL_LINES; index++) {
      sender.sendString(lines[index] ?? "", CacheDefinitions.getComponentId(`${SCROLL_INTERFACE}:messcroll${index + 1}`));
    }
  }

  /** The saved stage decides which fissure (or none) this player sees after login. */
  function ensureMoundObject(player) {
    if (!player || !quest) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_DUG_MOUND) return;
    const wanted = stage >= STAGE_ROPED_MOUND ? ROPE_FISSURE : FISSURE;
    const existing = ownedMoundObject(player);
    if (existing?.getId() === wanted) return;
    if (existing) ObjectManager.deregister(existing, true);
    ObjectManager.register(
      new GameObject(wanted, new Location(MOUND_TILE.x, MOUND_TILE.y, MOUND_TILE.z), MOUND_TYPE, MOUND_FACE, null).setOwner(player),
      true
    );
  }

  function clearMoundObject(player) {
    const existing = ownedMoundObject(player);
    if (existing) ObjectManager.deregister(existing, true);
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Mosol Rei asked me to save Shilo Village from the</str>",
        "<str>undead of Rashiliyia, the Zombie Queen.</str>",
        "<str>I found Ah Za Rhoon, buried Zadimus, explored the</str>",
        "<str>tomb of Bervirius and defeated Nazastarool.</str>",
        "",
        "<str>I laid Rashiliyia's remains on Bervirius' dolmen and</str>",
        "<str>put her spirit to rest.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_RETRIEVED_CORPSE) {
      return [
        "I have Rashiliyia's remains.",
        "I should lay them to rest on the dolmen in <col=800000>Bervirius' tomb</col>.",
      ];
    }
    if (stage >= STAGE_UNLOCKED_TOMB_DOOR) {
      return [
        "I placed three bones in the skeletal door of",
        "<col=800000>Rashiliyia's tomb</col> and it opened.",
        "I should search the <col=800000>tomb dolmen</col> for her remains.",
      ];
    }
    if (stage >= STAGE_UNLOCKED_RASHILIYIA_TOMB) {
      return [
        "I unlocked <col=800000>Rashiliyia's tomb</col> with a bone key.",
        "The <col=800000>Beads of the Dead</col> should protect me inside.",
      ];
    }
    if (stage >= STAGE_ENTERED_BERVIRIUS) {
      return [
        "I searched <col=800000>Bervirius' tomb</col> and found a crystal,",
        "some notes and an ivory sword pommel.",
        "I should craft a <col=800000>bone key</col> and look for",
        "Rashiliyia's final resting place.",
      ];
    }
    if (stage >= STAGE_ENTERED_TEMPLE) {
      return [
        "I entered the ruined temple of <col=800000>Ah Za Rhoon</col>.",
        "I should search it for clues about Rashiliyia's kin.",
      ];
    }
    if (stage >= STAGE_DUG_MOUND) {
      return [
        "I excavated the <col=800000>mound of earth</col> and found a fissure.",
        "I should light it up and find a way down.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "Mosol Rei gave me a <col=800000>Wampum belt</col> and I took it",
        "to <col=800000>Trufitus</col> in Tai Bwo Wannai.",
        "I must find the location of '<col=800000>Ah Za Rhoon</col>'.",
      ];
    }
    return [
      "I can start this quest by speaking to <col=800000>Mosol Rei</col>",
      "outside Shilo Village in southern Karamja.",
      "",
      "I need <col=800000>Jungle Potion</col>, 20 Crafting, 32 Agility",
      "and the ability to defeat a level 86 monster.",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.CRAFTING, 3875);
  }

  function trufitusVariant(player) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return "after-completing-shilo-village";
    if (stage >= STAGE_UNLOCKED_RASHILIYIA_TOMB) {
      return "visiting-the-tomb-of-rashiliyia-talking-to-trufitus-after-visiting-the-tomb-of-rashiliyia";
    }
    if (stage >= STAGE_ENTERED_BERVIRIUS) {
      return "visiting-the-tomb-of-bervirius-talking-to-trufitus-after-visiting-bervirius-tomb";
    }
    if (stage >= STAGE_ENTERED_TEMPLE) {
      return "visiting-ah-za-rhoon-talking-to-trufitus-after-visiting-ah-za-rhoon";
    }
    if (stage >= STAGE_STARTED) return "starting-out-talking-to-trufitus-again";
    return null;
  }

  function mosolVariant(player) {
    if (quest.getStage(player) >= STAGE_COMPLETE) return "standard-dialogue-after-shilo-village";
    if (quest.getStage(player) >= STAGE_STARTED || held(player, WAMPUM_BELT)) {
      return "starting-out-talking-to-mosol-rei-after-getting-the-wampum-belt";
    }
    return "starting-out-talking-to-mosol-rei";
  }

  function selectVariant({ npcId, player }) {
    if (npcId === TRUFITUS) return trufitusVariant(player);
    if (MOSOL_REI_IDS.has(npcId)) return mosolVariant(player);
    return null;
  }

  /** The page's prose conditions, matched case-insensitively. */
  /** The six items Yanni's quote lists, by the transcript's condition wording. */
  const YANNI_QUOTED = [
    ["bone key", () => [BONE_KEY]],
    ["stone-plaque", () => [STONE_PLAQUE]],
    ["tattered scroll", () => [TATTERED_SCROLL]],
    ["crumpled scroll", () => [CRUMPLED_SCROLL]],
    ["locating crystal", () => [...LOCATING_CRYSTAL_IDS]],
    ["beads of the dead", () => [BEADS_OF_THE_DEAD]],
  ];

  /** Yanni's standard dialogue conditions (Transcript:Yanni Salika); null when `value` is not one of them. */
  function yanniCondition(player, value) {
    // What he quotes is the six items the transcript lists, and only those he would really buy from this player (the
    // same rule as showing him one): a prism before Zogre Flesh Eaters, a preset copy, or Bervirius' notes, which the
    // transcript does not quote, leave him with nothing to quote.
    const carries = (ids) => player.getInventory().getItems().some((item) => item && ids.includes(item.getId()) && yanniBuys(player, item));
    const quoted = YANNI_QUOTED.filter(([, ids]) => carries(ids())).length;
    if (value.includes("doesn't have an item yanni can buy")) return quoted === 0;
    if (value.includes("only one of the above items")) return quoted === 1;
    if (value.includes("more than one of the above items")) return quoted > 1;
    if (value.includes("already has the beads of the dead in their inventory or bank")) {
      return held(player, BEADS_OF_THE_DEAD) || bankedBeads(player) || player.getEquipment().getAmount?.(BEADS_OF_THE_DEAD) > 0;
    }
    if (value.includes("does not have the beads of the dead")) return !held(player, BEADS_OF_THE_DEAD);
    for (const [name, ids] of YANNI_QUOTED) {
      if (value.includes(`has the ${name} in their inventory`)) return carries(ids());
    }
    return null;
  }

  function answerCondition({ player, text, stepId, npcId }) {
    const value = String(text).toLowerCase();
    if (npcId === YANNI) {
      const yanni = yanniCondition(player, value);
      if (yanni !== null) return yanni;
    }
    if (value.includes("does not have all the requirements")) {
      const junglePotion = Number(player.getAttribute("quest.jungle_potion.stage")) || 0;
      return junglePotion < 12 || hpLevel(player) < 45;
    }
    if (value.includes("does not have 20 crafting")) return craftingLevel(player) < 20;
    if (value.includes("has 20 crafting")) return craftingLevel(player) >= 20;
    if (value.includes("fails to climb the rock")) return false;
    if (value.includes("successfully climbs the rock")) return true;
    if (value.includes("player succeeds")) return true;
    if (value.includes("player fails")) return false;
    if (value.includes("not wearing the beads")) return !wearingBeads(player);
    if (value.includes("wearing the beads")) return wearingBeads(player);
    if (value.includes("first bone")) {
      return (Number(player.getAttribute(PENDING_BONE_ATTRIBUTE)) || 0) === 0;
    }
    if (value.includes("second bone")) {
      return (Number(player.getAttribute(PENDING_BONE_ATTRIBUTE)) || 0) === 1;
    }
    if (value.includes("third bone")) {
      return (Number(player.getAttribute(PENDING_BONE_ATTRIBUTE)) || 0) === 2;
    }
    if (value.includes("tomb of rashiliyia")) {
      const distance = crystalDistance(player);
      if (value.includes("too far")) return distance > 200;
      if (value.includes("within 200 squares")) return distance > 100 && distance <= 200;
      // The three "within [unknown squares]" conditions share their text; the
      // generator only left distinct step ids. 100/50/10 are the reference cuts.
      if (stepId === "DHF9Uw") return distance > 50 && distance <= 100;
      if (stepId === "w8CW6-") return distance > 10 && distance <= 50;
      if (stepId === "BEZoJ0") return distance <= 10;
      return distance <= 200;
    }
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== TRUFITUS || hook !== START_HOOK) return;
    advance(player, STAGE_STARTED);
    if (held(player, WAMPUM_BELT)) take(player, WAMPUM_BELT);
  }

  /**
   * Jungle Potion registers its Trufitus variants first and would otherwise
   * shadow this quest's; take the click directly once Shilo Village has started.
   */
  function handleTrufitusTalk(event) {
    const { player } = event;
    pendingLightByPlayer.delete(player);
    if (quest.getStage(player) < STAGE_STARTED) return false;
    event.handled = true;
    scene(player, TRUFITUS, trufitusVariant(player));
    return true;
  }

  /**
   * Yanni buys what the quest leaves over (Wiki): shown an item, he pays on the spot. The item is taken from the
   * slot it was used from, and the coins are only paid when it is gone. The black prism waits for Yes.
   */
  function yannisScene(player, variant) {
    pendingLightByPlayer.delete(player);
    startTranscript(api, player, YANNI, YANNI_PAGE, variant);
  }

  /** Preset, untradeable and unbankable copies keep their restrictions, so he takes none. */
  function restricted(item) {
    const { Item } = api.core;
    return item.isPresetItem?.() === true
      || item.getMetaValue?.(Item.PRESET_META) === true
      || item.getMetaValue?.(Item.UNTRADEABLE_META) === true
      || item.getMetaValue?.(Item.UNBANKABLE_META) === true;
  }

  function questDone(player, key) {
    const request = { player, key, complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  /**
   * Wiki (Yanni Salika, Black prism): he buys "after the completion of Shilo Village", and the prism only "after the
   * completion of Zogre Flesh Eaters" (selling it earlier would strand that quest). A second prism is refused. The
   * refusal's wording is ours (his generated nothing-I-want line).
   */
  function yanniBuys(player, item) {
    const sale = YANNI_SALES.get(item?.getId?.());
    if (!sale || restricted(item) || !quest.isComplete(player)) return false;
    return !sale.asks || questDone(player, "zogre_flesh_eaters");
  }

  function sellToYanni(event) {
    const { player, itemId, slot, item } = event;
    const sale = YANNI_SALES.get(itemId);
    if (!yanniBuys(player, item)) return;
    event.handled = true;
    if (sale.asks) {
      if (Number(player.getAttribute(PRISM_SOLD_ATTRIBUTE)) === 1) {
        player.sendMessage("Sorry Bwana, you have nothing I am interested in.");
        return;
      }
      pendingPrismSale.set(player, { itemId, slot, item });
      yannisScene(player, sale.variant);
      return;
    }
    if (paidFor(player, itemId, slot, item, sale.price)) yannisScene(player, sale.variant);
  }

  /** Wiki: once he has bought a prism "they will automatically take ALL prisms you own", carried or banked. */
  function takeEveryPrism(player) {
    const { Bank } = api.core;
    take(player, ItemIdentifiers.BLACK_PRISM, player.getInventory().getAmount(ItemIdentifiers.BLACK_PRISM));
    for (let tab = 0; tab < Bank.TOTAL_BANK_TABS; tab++) {
      if (tab === Bank.BANK_SEARCH_TAB_INDEX) continue;
      const bank = player.getBank(tab);
      const amount = bank.getAmount(ItemIdentifiers.BLACK_PRISM);
      if (amount > 0) bank.deleteNumber(ItemIdentifiers.BLACK_PRISM, amount);
    }
  }

  /** Beads of the Dead anywhere in the bank, every tab. */
  function bankedBeads(player) {
    const { Bank } = api.core;
    for (let tab = 0; tab < Bank.TOTAL_BANK_TABS; tab++) {
      if (tab !== Bank.BANK_SEARCH_TAB_INDEX && player.getBank(tab).getAmount(BEADS_OF_THE_DEAD) > 0) return true;
    }
    return false;
  }

  function paidFor(player, itemId, slot, item, price) {
    const inventory = player.getInventory();
    if (inventory.getItems()[slot] !== item || item.getId() !== itemId) return false;
    inventory.deleteAtSlot(slot, 1, true);
    inventory.adds(COINS, price);
    return true;
  }

  function handleItemOnNpc(event) {
    const npcId = event.npcId ?? event.target?.getId?.();
    if (npcId === YANNI) {
      sellToYanni(event);
      return;
    }
    if (npcId !== TRUFITUS) return;
    const { player, itemId } = event;
    pendingLightByPlayer.delete(player);
    event.handled = true;
    let variant = TRUFITUS_ITEM_VARIANTS.get(itemId);
    if (!variant && LOCATING_CRYSTAL_IDS.has(itemId)) {
      variant = "visiting-the-tomb-of-bervirius-using-the-locating-crystal-on-trufitus";
    }
    if (!variant) variant = "starting-out-use-any-unrelated-item-on-trufitus";
    scene(player, TRUFITUS, variant);
  }

  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const pair = new Set([usedItemId, usedWithItemId]);
    if (pair.has(CHISEL) && pair.has(SWORD_POMMEL)) {
      event.handled = true;
      craftBoneBeads(player);
      return;
    }
    if (pair.has(CHISEL) && pair.has(BONE_SHARD)) {
      event.handled = true;
      craftBoneKey(player);
      return;
    }
    if (pair.has(BRONZE_WIRE) && pair.has(BONE_BEADS)) {
      event.handled = true;
      craftBeadsOfTheDead(player);
      return;
    }
  }

  function craftBoneBeads(player) {
    if (craftingLevel(player) < 15) {
      player.sendMessage("You need a Crafting level of at least 15 to complete this task.");
      return;
    }
    take(player, SWORD_POMMEL);
    give(player, BONE_BEADS);
    scene(player, TRUFITUS, "visiting-the-tomb-of-bervirius-use-chisel-on-sword-pommel");
  }

  function craftBeadsOfTheDead(player) {
    if (!mechTest(player, MECH_READ_CRUMPLED)) {
      player.sendMessage("You're not really sure how this would fit together. Maybe Ah Za Rhoon has some instructions on this?");
      return;
    }
    if (craftingLevel(player) < 16) {
      player.sendMessage("You need a Crafting level of at least 16 to complete this task.");
      return;
    }
    take(player, BONE_BEADS);
    take(player, BRONZE_WIRE);
    give(player, BEADS_OF_THE_DEAD);
    scene(player, TRUFITUS, "visiting-the-tomb-of-bervirius-use-bronze-wire-on-bone-beads");
  }

  function craftBoneKey(player) {
    if (!mechTest(player, MECH_FOUND_BONE_DOOR)) {
      scene(player, TRUFITUS, "visiting-ah-za-rhoon-using-chisel-on-bone-shard");
      return;
    }
    if (craftingLevel(player) < 20) {
      player.sendMessage("You need to have a Crafting level of at least 20 to work this material.");
      return;
    }
    take(player, BONE_SHARD);
    give(player, BONE_KEY);
    scene(player, TRUFITUS, "visiting-the-tomb-of-rashiliyia-use-chisel-on-bone-shard");
  }

  function handleItemAction(event) {
    const { player, itemId } = event;
    const option = String(event.option ?? "").toLowerCase();
    if (itemId === ZADIMUS_CORPSE && option.includes("bury")) {
      event.handled = true;
      buryZadimus(player);
      return;
    }
    if (option.includes("read") && itemId === TATTERED_SCROLL) {
      event.handled = true;
      scene(player, TRUFITUS, "visiting-ah-za-rhoon-read-tattered-scroll");
      return;
    }
    if (option.includes("read") && itemId === CRUMPLED_SCROLL) {
      event.handled = true;
      scene(player, TRUFITUS, "visiting-ah-za-rhoon-read-crumpled-scroll");
      return;
    }
    if (option.includes("read") && itemId === STONE_PLAQUE) {
      event.handled = true;
      scene(player, TRUFITUS, "visiting-ah-za-rhoon-read-stone-plaque");
      return;
    }
    if (option.includes("read") && itemId === BERVIRIUS_NOTES) {
      event.handled = true;
      scene(player, TRUFITUS, "visiting-the-tomb-of-bervirius-read-the-bervirius-notes");
      return;
    }
    if (option.includes("inspect") && itemId === BONE_SHARD) {
      event.handled = true;
      scene(player, TRUFITUS, "visiting-ah-za-rhoon-inspect-bone-shard");
      return;
    }
    if (option.includes("activate") && LOCATING_CRYSTAL_IDS.has(itemId)) {
      event.handled = true;
      activateCrystal(player);
    }
  }

  function buryZadimus(player) {
    if (inSacredZone(player)) {
      take(player, ZADIMUS_CORPSE);
      scene(player, SPIRIT_OF_ZADIMUS, "visiting-ah-za-rhoon-burying-the-zadimus-corpse-in-the-right-place");
      return;
    }
    scene(player, SPIRIT_OF_ZADIMUS, "visiting-ah-za-rhoon-burying-the-zadimus-corpse-in-the-wrong-place");
  }

  /**
   * The crystal transcript opens with a "missing" export step, which the runtime
   * treats as unavailable, so the tiers are sent directly instead.
   */
  function activateCrystal(player) {
    if (quest.isComplete(player)) {
      player.sendMessage("The crystal does not respond anymore.");
      return;
    }
    if (player.getSkillManager().getCurrentLevel(Skill.PRAYER) < 10) {
      player.sendMessage("You need a Prayer level of at least 10 for the crystal to work.");
      return;
    }
    const distance = crystalDistance(player);
    if (distance > 200) {
      player.sendMessage("There is nothing different about the crystal. You're most likely not close enough for it to be active.");
    } else if (distance > 100) {
      player.sendMessage("The crystal glows faintly.");
    } else if (distance > 50) {
      player.sendMessage("The crystal glows brightly.");
    } else if (distance > 10) {
      player.sendMessage("The crystal is very bright.");
    } else {
      player.sendMessage("The crystal blazes brilliantly.");
    }
  }

  /** After the quest the cart is "Climb over" (op 2): across to the other side of it. */
  function climbCart(player) {
    if (ObstacleRunner.isBusy(player)) return;
    const landing = player.getLocation().getX() < CART_MIDDLE_X ? CART_OUTSIDE_TILE : CART_INSIDE_TILE;
    ObstacleRunner.run({ player }, [
      { anim: 828, delay: 15 },
      { sound: 4035 },
      { sound: 4033, delay: 13 },
      { sound: 4034, delay: 19 },
      { wait: 1 },
      { msg: CART_LINE },
      { tele: [landing.x, landing.y, landing.z] },
      { anim: -1 },
    ]);
  }

  /** The village's gate after the quest: through it, by the captured walk and line; out again is the same walk back. */
  function passVillageGate(player, location) {
    if (ObstacleRunner.isBusy(player)) return;
    const { x, y } = location;
    // One walk across, the line and sound on the tick the far tile is reached (1102 tick 13666). Two walks with the
    // line between left the player standing on the gate's tile for a tick, and the first run put them back outside.
    // From the road the engine's own route has already walked the player onto the gate's tile when this runs (the first
    // run of #2643 read that as "inside" and walked them back out), so standing on it counts as the road side.
    if (player.getLocation().getX() >= x) {
      ObstacleRunner.run({ player }, [
        { walk: [[x, y], [x - 1, y]], arrive: true },
        { msg: VILLAGE_GATE_LINE },
        { sound: VILLAGE_GATE_SOUND },
      ]);
      return;
    }
    ObstacleRunner.run({ player }, [{ walk: [[x, y], [x + 1, y]], arrive: true }, { sound: VILLAGE_GATE_SOUND }]);
  }

  /**
   * The village's gates ask before the Doors plugin: it knows "Metal gate" by name and would open this one as a
   * plain door, moving the player one tile (the first run of #2643 left them on 2875).
   */
  function handleVillageGate(event) {
    if (!VILLAGE_GATE_IDS.has(event.objectId) || event.clickType !== 1 || !quest.isComplete(event.player)) return;
    event.handled = true;
    passVillageGate(event.player, event.location);
  }

  function handleObjectInteraction(event) {
    const { objectId, player, clickType } = event;
    if (objectId === BROKEN_CART_LOC) {
      if (clickType !== 2 || !quest.isComplete(player)) return;
      event.handled = true;
      climbCart(player);
      return;
    }
    if (objectId === MOUND_OF_EARTH) {
      event.handled = true;
      handleMound(player, clickType);
      return;
    }
    if (FISSURE_IDS.has(objectId)) {
      event.handled = true;
      handleFissure(player, clickType);
      return;
    }
    if (objectId === STRANGE_LOOKING_STONE) {
      event.handled = true;
      handleStrangeStone(player, clickType);
      return;
    }
    if (objectId === LOOSE_ROCKS) {
      event.handled = true;
      searchLooseRocks(player);
      return;
    }
    if (objectId === OLD_SACKS) {
      event.handled = true;
      searchOldSacks(player);
      return;
    }
    if (objectId === ANCIENT_GALLOWS) {
      event.handled = true;
      searchGallows(player, clickType);
      return;
    }
    if (objectId === SMASHED_TABLE) {
      event.handled = true;
      handleSmashedTable(player, clickType);
      return;
    }
    if (objectId === WATERFALL_ROCKS) {
      event.handled = true;
      scene(player, TRUFITUS, clickType === 1
        ? "visiting-ah-za-rhoon-look-at-waterfall-rocks"
        : "visiting-ah-za-rhoon-search-waterfall-rocks");
      return;
    }
    if (objectId === CAVE_IN) {
      event.handled = true;
      scene(player, TRUFITUS, "visiting-ah-za-rhoon-search-cave-in");
      return;
    }
    if (objectId === WELL_STACKED_ROCKS) {
      event.handled = true;
      scene(player, TRUFITUS, clickType === 1
        ? "visiting-the-tomb-of-bervirius-investigate-well-stacked-rocks"
        : "visiting-the-tomb-of-bervirius-search-well-stacked-rocks");
      return;
    }
    if (objectId === CLIMBING_ROCKS) {
      event.handled = true;
      scene(player, TRUFITUS, "visiting-the-tomb-of-bervirius-climb-climbing-rocks");
      return;
    }
    if (objectId === TOMB_DOLMEN) {
      event.handled = true;
      handleBerviriusDolmen(player, clickType);
      return;
    }
    if (objectId === TOMB_DOLMEN_RASHILIYIA) {
      event.handled = true;
      searchRashiliyiaDolmen(player);
      return;
    }
    if (objectId === PALM_TREE) {
      event.handled = true;
      mechSet(player, MECH_SEARCHED_PALM, true);
      syncTombDoors(player);
      scene(player, TRUFITUS, "visiting-the-tomb-of-rashiliyia-search-palm-tree");
      return;
    }
    if (HIDDEN_TOMB_DOOR_LOCS.has(objectId)) {
      event.handled = true;
      if (tombDoorState(player) === TOMB_DOORS_OPEN) teleport(player, RASHILIYIA_TOMB_TILE);
      else if (tombDoorState(player) === TOMB_DOORS_CLOSED) handleCarvedDoors(player, clickType);
      return;
    }
    if (objectId === TOMB_ROCKS && inTombRocks(event.location)) {
      event.handled = true;
      climbTombRocks(player);
      return;
    }
    if (CARVED_DOORS_IDS.has(objectId)) {
      event.handled = true;
      handleCarvedDoors(player, clickType);
      return;
    }
    if (TOMB_EXIT_IDS.has(objectId)) {
      event.handled = true;
      handleTombExit(player, clickType);
      return;
    }
    if (ANCIENT_METAL_GATE_IDS.has(objectId)) {
      event.handled = true;
      handleAncientMetalGate(event);
      return;
    }
    if (TOMB_DOOR_IDS.has(objectId)) {
      event.handled = true;
      handleTombDoors(event);
    }
  }

  function handleMound(player, clickType) {
    if (quest.getStage(player) >= STAGE_DUG_MOUND) {
      scene(player, TRUFITUS, clickType === 1
        ? "visiting-ah-za-rhoon-look-at-fissure"
        : "visiting-ah-za-rhoon-search-fissure");
      return;
    }
    if (clickType === 2) {
      advance(player, STAGE_SEARCHED_MOUND);
      scene(player, TRUFITUS, "visiting-ah-za-rhoon-search-mound-of-earth");
      return;
    }
    advance(player, STAGE_FOUND_MOUND);
    scene(player, TRUFITUS, "visiting-ah-za-rhoon-look-at-mound-of-earth");
  }

  function handleFissure(player, clickType) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_DUG_MOUND && stage < STAGE_ROPED_MOUND && !quest.isComplete(player)) {
      scene(player, TRUFITUS, clickType === 1
        ? "visiting-ah-za-rhoon-look-at-fissure"
        : "visiting-ah-za-rhoon-search-fissure");
      return;
    }
    if (clickType === 2 && agilityLevel(player) < 32) {
      player.sendMessage("You need a level 32 agility to attempt this.");
      return;
    }
    scene(player, TRUFITUS, clickType === 1
      ? "visiting-ah-za-rhoon-look-at-fissure-after-rope-is-attached"
      : "visiting-ah-za-rhoon-search-fissure-after-rope-is-attached");
  }

  function handleStrangeStone(player, clickType) {
    if (quest.isComplete(player)) {
      scene(player, TRUFITUS, "post-quest-ah-za-rhoon-look-at-or-investigate-strange-looking-stone");
      return;
    }
    scene(player, TRUFITUS, clickType === 1
      ? "visiting-ah-za-rhoon-look-at-strange-looking-stone"
      : "visiting-ah-za-rhoon-investigate-strange-looking-stone");
  }

  function searchLooseRocks(player) {
    if (quest.isComplete(player)) {
      scene(player, TRUFITUS, "post-quest-ah-za-rhoon-search-loose-rocks");
      return;
    }
    if (!held(player, TATTERED_SCROLL)) give(player, TATTERED_SCROLL);
    scene(player, TRUFITUS, "visiting-ah-za-rhoon-search-loose-rocks");
  }

  function searchOldSacks(player) {
    if (quest.isComplete(player)) {
      scene(player, TRUFITUS, "post-quest-ah-za-rhoon-search-old-sacks");
      return;
    }
    if (!held(player, CRUMPLED_SCROLL)) give(player, CRUMPLED_SCROLL);
    scene(player, TRUFITUS, "visiting-ah-za-rhoon-search-old-sacks");
  }

  function searchGallows(player, clickType) {
    if (quest.isComplete(player)) {
      scene(player, TRUFITUS, "post-quest-ah-za-rhoon-look-at-or-search-the-ancient-gallows");
      return;
    }
    if (clickType === 1) {
      scene(player, TRUFITUS, "visiting-ah-za-rhoon-look-at-ancient-gallows");
      return;
    }
    if (!held(player, ZADIMUS_CORPSE) && !held(player, BONE_SHARD) && !held(player, BONE_KEY)) {
      give(player, ZADIMUS_CORPSE);
    }
    scene(player, TRUFITUS, "visiting-ah-za-rhoon-search-ancient-gallows");
  }

  function handleSmashedTable(player, clickType) {
    if (clickType === 1) {
      scene(player, TRUFITUS, "visiting-ah-za-rhoon-look-at-smashed-table");
      return;
    }
    scene(player, TRUFITUS, mechTest(player, MECH_USED_TABLE_WOOD)
      ? "visiting-ah-za-rhoon-craft-smashed-table-after-using-up-the-wood"
      : "visiting-ah-za-rhoon-craft-smashed-table");
  }

  function handleBerviriusDolmen(player, clickType) {
    if (quest.isComplete(player)) {
      scene(player, TRUFITUS, "post-quest-tomb-of-bervirius-inspect-or-search-tomb-dolmen");
      return;
    }
    if (clickType === 1) {
      scene(player, TRUFITUS, "visiting-the-tomb-of-bervirius-inspect-tomb-dolmen");
      return;
    }
    if (!held(player, SWORD_POMMEL)) give(player, SWORD_POMMEL);
    if (!held(player, LOCATING_CRYSTAL)) give(player, LOCATING_CRYSTAL);
    if (!held(player, BERVIRIUS_NOTES)) give(player, BERVIRIUS_NOTES);
    scene(player, TRUFITUS, "visiting-the-tomb-of-bervirius-search-tomb-dolmen");
  }

  function handleCarvedDoors(player, clickType) {
    if (clickType === 1) {
      if (quest.getStage(player) >= STAGE_UNLOCKED_RASHILIYIA_TOMB && !quest.isComplete(player)) {
        teleport(player, RASHILIYIA_TOMB_TILE);
        return;
      }
      scene(player, TRUFITUS, "visiting-the-tomb-of-rashiliyia-open-carved-doors");
      return;
    }
    mechSet(player, MECH_FOUND_BONE_DOOR, true);
    scene(player, TRUFITUS, "visiting-the-tomb-of-rashiliyia-search-carved-doors");
  }

  function inTombRocks(location) {
    return location && location.x >= TOMB_ROCKS_AREA.minX && location.x <= TOMB_ROCKS_AREA.maxX
      && location.y >= TOMB_ROCKS_AREA.minY && location.y <= TOMB_ROCKS_AREA.maxY;
  }

  /**
   * Wiki: without the Beads of the Dead "you will be unable to continue". The refusal's wording is ours,
   * and not needing them once the quest is complete is inferred. The way down's lines are the transcript's;
   * it has none for the way up.
   */
  /** A walk onto the rocks' end tile first, when the player was clicking from beside it. */
  function walkToStart(player, [x, y]) {
    const at = player.getLocation();
    return at.getX() === x && at.getY() === y ? [] : [{ walk: [[x, y]] }];
  }

  function climbTombRocks(player) {
    if (ObstacleRunner.isBusy(player)) return;
    if (player.getLocation().getY() > TOMB_ROCKS_MIDDLE_Y) {
      if (!quest.isComplete(player) && !wearingBeads(player)) {
        player.sendMessage("You can't bring yourself to climb down there without some protection.");
        return;
      }
      // A walk down the rocks, not a teleport (#2643: "no animation going down"); the transcript's lines follow.
      ObstacleRunner.run({ player }, [
        ...walkToStart(player, ROCKS_TOP_TILE),
        { walk: ROCKS_DOWN_PATH },
        { run: () => scene(player, TRUFITUS, "visiting-the-tomb-of-rashiliyia-climb-rocks") },
      ]);
      return;
    }
    ObstacleRunner.run({ player }, [...walkToStart(player, ROCKS_BOTTOM_TILE), { walk: ROCKS_UP_PATH }]);
  }

  function handleTombExit(player, clickType) {
    if (clickType === 2) {
      scene(player, TRUFITUS, "visiting-the-tomb-of-rashiliyia-search-tomb-exit");
      return;
    }
    if (held(player, BONE_KEY)) {
      scene(player, TRUFITUS, "visiting-the-tomb-of-rashiliyia-open-tomb-exit");
      return;
    }
    teleport(player, TOMB_EXIT_TILE);
  }

  function handleAncientMetalGate(event) {
    const { player, location } = event;
    const inside = player.getLocation().getY() > location.y;
    if (wearingBeads(player)) advance(player, STAGE_ENTERED_WITH_BEADS);
    scene(player, RASHILIYIA, "visiting-the-tomb-of-rashiliyia-open-ancient-metal-gate");
    player.moveTo(new Location(location.x, inside ? location.y - 1 : location.y + 1, location.z));
  }

  function handleTombDoors(event) {
    const { player, clickType, location } = event;
    const placed = bonesPlaced(player);
    if (clickType === 2) {
      const variant = placed === 0 ? "visiting-the-tomb-of-rashiliyia-search-tomb-doors-no-bones-put-in"
        : placed === 1 ? "visiting-the-tomb-of-rashiliyia-search-tomb-doors-one-bone-put-in"
        : placed === 2 ? "visiting-the-tomb-of-rashiliyia-search-tomb-doors-two-bones-put-in"
        : "visiting-the-tomb-of-rashiliyia-search-tomb-doors-three-bones-put-in";
      scene(player, TRUFITUS, variant);
      return;
    }
    if (quest.getStage(player) < STAGE_UNLOCKED_TOMB_DOOR) {
      scene(player, TRUFITUS, "visiting-the-tomb-of-rashiliyia-open-tomb-doors-before-placing-bones");
      return;
    }
    const pos = player.getLocation();
    player.moveTo(new Location(location.x, pos.getY() <= location.y ? location.y + 1 : location.y - 1, location.z));
  }

  function searchRashiliyiaDolmen(player) {
    if (quest.isComplete(player)) {
      scene(player, TRUFITUS, "post-quest-rashiliyia-s-tomb-look-at-or-search-tomb-dolmen");
      return;
    }
    if (mechTest(player, MECH_DEFEATED_3)) {
      if (!held(player, RASHILIYIA_CORPSE) && freeSlots(player) > 0) {
        advance(player, STAGE_RETRIEVED_CORPSE);
        give(player, RASHILIYIA_CORPSE);
        scene(player, TRUFITUS, "visiting-the-tomb-of-rashiliyia-take-rashiliyia-corpse");
      }
      return;
    }
    if (nazastaroolByPlayer.has(player)) {
      player.sendMessage("The dolmen remains silent.");
      return;
    }
    const start = mechTest(player, MECH_DEFEATED_1)
      ? (mechTest(player, MECH_DEFEATED_2) ? 2 : 1)
      : 0;
    startNazastaroolScene(player, start);
  }

  function startNazastaroolScene(player, start) {
    nazNarration.set(player, { start });
    scene(player, NAZASTAROOL_FORMS[0], "visiting-the-tomb-of-rashiliyia-look-at-or-search-tomb-dolmen");
  }

  function spawnNazastarool(player, index) {
    const previous = nazastaroolByPlayer.get(player);
    if (previous) api.removeNpc(previous);
    const pos = player.getLocation();
    const npc = api.spawnNpc({
      id: NAZASTAROOL_FORMS[index],
      x: pos.getX() + 1,
      y: pos.getY(),
      z: pos.getZ(),
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) nazastaroolByPlayer.set(player, npc);
  }

  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (itemId === SPADE && (objectId === MOUND_OF_EARTH || FISSURE_IDS.has(objectId))) {
      event.handled = true;
      digMound(player);
      return;
    }
    if (LIGHT_SOURCE_IDS.has(itemId) && FISSURE_IDS.has(objectId)) {
      event.handled = true;
      illuminateFissure(player, itemId);
      return;
    }
    if (itemId === ROPE && FISSURE_IDS.has(objectId)) {
      event.handled = true;
      ropeFissure(player);
      return;
    }
    if (itemId === CHISEL && objectId === STRANGE_LOOKING_STONE) {
      event.handled = true;
      cutPlaque(player);
      return;
    }
    if (itemId === BONE_KEY && (CARVED_DOORS_IDS.has(objectId) || HIDDEN_TOMB_DOOR_LOCS.has(objectId))) {
      const state = tombDoorState(player);
      if (HIDDEN_TOMB_DOOR_LOCS.has(objectId) && state === TOMB_DOORS_HIDDEN) return;
      event.handled = true;
      if (state === TOMB_DOORS_OPEN) teleport(player, RASHILIYIA_TOMB_TILE);
      else unlockCarvedDoors(player);
      return;
    }
    if (itemId === BONE_KEY && TOMB_EXIT_IDS.has(objectId)) {
      event.handled = true;
      scene(player, TRUFITUS, "visiting-the-tomb-of-rashiliyia-use-bone-key-on-tomb-exit");
      teleport(player, TOMB_EXIT_TILE);
      return;
    }
    if (itemId === BONES && TOMB_DOOR_IDS.has(objectId)) {
      event.handled = true;
      useBonesOnTombDoors(player);
      return;
    }
    if (itemId === RASHILIYIA_CORPSE && objectId === TOMB_DOLMEN) {
      event.handled = true;
      scene(player, RASHILIYIA, "visiting-the-tomb-of-rashiliyia-using-rashiliyias-remains-on-the-dolmen");
    }
  }

  function digMound(player) {
    if (quest.getStage(player) >= STAGE_DUG_MOUND) {
      scene(player, TRUFITUS, "visiting-ah-za-rhoon-use-spade-on-fissure");
      return;
    }
    advance(player, STAGE_DUG_MOUND);
    ensureMoundObject(player);
    scene(player, TRUFITUS, "visiting-ah-za-rhoon-use-spade-on-mound-of-earth");
  }

  function illuminateFissure(player, itemId) {
    if (quest.getStage(player) >= STAGE_LIT_MOUND) {
      player.sendMessage("You have already seen inside the fissure.");
      return;
    }
    if (quest.getStage(player) !== STAGE_DUG_MOUND || ownedMoundObject(player)?.getId() !== FISSURE) return;
    scene(player, TRUFITUS, itemId === ItemIdentifiers.LIT_BLACK_CANDLE
      ? "visiting-ah-za-rhoon-use-lit-black-candle-on-fissure"
      : "visiting-ah-za-rhoon-use-lit-candle-on-fissure");
    pendingLightByPlayer.set(player, itemId);
  }

  function ropeFissure(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_LIT_MOUND) {
      player.sendMessage("It's too dark to clearly see where to fix that.");
      return;
    }
    if (stage >= STAGE_ROPED_MOUND) {
      player.sendMessage("There is already a rope attached!");
      return;
    }
    take(player, ROPE);
    advance(player, STAGE_ROPED_MOUND);
    ensureMoundObject(player);
    scene(player, TRUFITUS, "visiting-ah-za-rhoon-use-rope-on-fissure");
  }

  function cutPlaque(player) {
    if (held(player, STONE_PLAQUE)) {
      player.sendMessage("It looks as if something has been cut from this stone.");
      return;
    }
    give(player, STONE_PLAQUE);
    scene(player, TRUFITUS, "visiting-ah-za-rhoon-use-chisel-on-strange-looking-stone");
  }

  function unlockCarvedDoors(player) {
    mechSet(player, MECH_FOUND_BONE_DOOR, true);
    advance(player, STAGE_UNLOCKED_RASHILIYIA_TOMB);
    syncTombDoors(player);
    scene(player, TRUFITUS, "visiting-the-tomb-of-rashiliyia-use-bone-key-on-carved-doors");
  }

  function useBonesOnTombDoors(player) {
    const placed = bonesPlaced(player);
    if (placed >= 3) {
      scene(player, TRUFITUS, "post-quest-rashiliyia-s-tomb-using-bones-on-the-tomb-door");
      return;
    }
    player.setAttribute(PENDING_BONE_ATTRIBUTE, placed);
    setBonesPlaced(player, placed + 1);
    take(player, BONES);
    if (placed + 1 === 3) advance(player, STAGE_UNLOCKED_TOMB_DOOR);
    scene(player, TRUFITUS, "visiting-the-tomb-of-rashiliyia-using-bones-on-tomb-doors");
  }

  function handleNazastaroolAction(event) {
    const { player, stepId } = event;
    const narration = nazNarration.get(player);
    if (!narration) return;
    const start = narration.start;
    switch (stepId) {
      case ACTION_NAZASTAROOL_SPAWN_1:
        event.handled = true;
        if (start === 0) spawnNazastarool(player, 0);
        return;
      case ACTION_NAZASTAROOL_CONTINUES_1:
        event.handled = true;
        if (start === 0) event.end = true;
        return;
      case MESSAGE_NAZASTAROOL_DEATH_1:
        event.handled = start !== 1;
        return;
      case ACTION_NAZASTAROOL_SPAWN_2:
        event.handled = true;
        if (start === 1) spawnNazastarool(player, 1);
        return;
      case ACTION_NAZASTAROOL_CONTINUES_2:
        event.handled = true;
        if (start <= 1) event.end = true;
        return;
      case MESSAGE_NAZASTAROOL_DEATH_2:
        event.handled = start !== 2;
        return;
      case ACTION_NAZASTAROOL_SPAWN_3:
        event.handled = true;
        if (start === 2) spawnNazastarool(player, 2);
        return;
      case ACTION_NAZASTAROOL_CONTINUES_3:
        event.handled = true;
        if (start <= 2) event.end = true;
        return;
      case MESSAGE_NAZASTAROOL_VOICE:
      case MESSAGE_NAZASTAROOL_CORPSE:
        if (start !== 3) event.handled = true;
        return;
      default:
    }
  }

  function handleNazastaroolLine(event) {
    const narration = nazNarration.get(event.player);
    if (!narration) return;
    const start = narration.start;
    const text = String(event.text ?? "");
    if (start >= 1 && text.includes("I am Nazastarool! Prepare to die!")) {
      event.skip = true;
      return;
    }
    if (start >= 2 && (text.includes("Quake in fear, for I am reborn!") || text.includes("Your death will be swift."))) {
      event.skip = true;
      return;
    }
    if (start >= 3 && (text.includes("Nazastarool returns with vengeance!") || text.includes("Soon you will serve Rashiliyia."))) {
      event.skip = true;
    }
  }

  /** Transcript action/message ids, including the Nazastarool scene. */
  function handleAction(event) {
    const { player, stepId } = event;
    if (!player) return;
    if (stepId === MESSAGE_MOSOL_LEAVES) {
      // The transcript's "Mosol leaves you by the gate": the player is inside the village, Mosol is back out.
      teleport(player, VILLAGE_INSIDE_TILE);
      return;
    }
    if (stepId === ACTION_RECEIVE_WAMPUM) {
      if (!held(player, WAMPUM_BELT)) give(player, WAMPUM_BELT);
      event.handled = true;
      return;
    }
    if (stepId === ACTION_SPAWN_TWO_UNDEAD) {
      spawnUndead(player, 2);
      event.handled = true;
      return;
    }
    if (stepId === ACTION_ENTER_TEMPLE) {
      advance(player, STAGE_ENTERED_TEMPLE);
      teleport(player, AH_ZA_RHOON_TILE);
      event.handled = true;
      return;
    }
    if (stepId === ACTION_RECEIVE_BONE_SHARD) {
      if (!held(player, BONE_SHARD)) give(player, BONE_SHARD);
      event.handled = true;
      return;
    }
    if (stepId === ACTION_SPAWN_UNDEAD || stepId === ACTION_GATE_UNDEAD) {
      spawnUndead(player, 1 + Math.floor(Math.random() * 3));
      event.handled = true;
      return;
    }
    if (SCROLLS.has(stepId)) {
      if (stepId === REFERENCE_READ_CRUMPLED) mechSet(player, MECH_READ_CRUMPLED, true);
      event.handled = true;
      event.end = true;
      // After the dialogue's own close, which would shut it too.
      TaskManager.submit(new CountdownTask(player, 1, () => openScroll(player, SCROLLS.get(stepId))));
      return;
    }
    if (stepId === ACTION_COMPLETE) {
      if (!quest.isComplete(player)) {
        take(player, RASHILIYIA_CORPSE);
        quest.complete(player);
      }
      event.handled = true;
      event.end = true;
      return;
    }
    handleNazastaroolAction(event);
  }

  function handleCondition(event) {
    const { player, stepId } = event;
    if (!player) return;
    if (stepId === CONDITION_WATERFALL_SUCCESS) {
      advance(player, STAGE_LEFT_TEMPLE);
      teleport(player, WATERFALL_EXIT_TILE);
      return;
    }
    if (stepId === CONDITION_CLIMB_SUCCESS) {
      teleport(player, CLIMB_OUT_TILE);
    }
  }

  /** Follow (op 1) on the finished-quest Mosol Rei: the transcript's Yes, without the questions (Wiki wording). */
  function handleMosolFollow(event) {
    const { player } = event;
    if (!quest.isComplete(player)) return false;
    event.handled = true;
    player.sendMessage("Mosol leads you into the village.");
    player.sendMessage("Mosol leaves you by the gate and walks back out into the jungle.");
    teleport(player, VILLAGE_INSIDE_TILE);
    return true;
  }

  /**
   * Rashiliyia's corpse is the ghost's drop only: the Wiki lists it as "Always" for Nazastarool without naming a form,
   * and the generated table gives all three forms the same row. The corpse only appears once the third form is down.
   */
  function handleNazastaroolDrops(event) {
    if (event.npcId !== NAZASTAROOL_FORMS[0] && event.npcId !== NAZASTAROOL_FORMS[1]) return;
    if (!Array.isArray(event.drops)) return;
    for (let i = event.drops.length - 1; i >= 0; i--) {
      if (event.drops[i]?.itemId === RASHILIYIA_CORPSE) event.drops.splice(i, 1);
    }
  }

  function handleChoice(event) {
    const { player } = event;
    if (player && event.npcId === YANNI && pendingPrismSale.has(player)) {
      const sale = pendingPrismSale.get(player);
      const option = String(event.option ?? "");
      if (option.startsWith("Yes, I'll sell it for 5000")) {
        pendingPrismSale.delete(player);
        if (paidFor(player, sale.itemId, sale.slot, sale.item, YANNI_SALES.get(sale.itemId).price)) {
          player.setAttribute(PRISM_SOLD_ATTRIBUTE, 1);
          takeEveryPrism(player);
        }
      } else if (option.startsWith("No, I think I'll hold on it")) {
        pendingPrismSale.delete(player);
      }
      return;
    }
    if (!player || event.npcId !== TRUFITUS) return;
    const option = String(event.option ?? "");
    const pendingLight = pendingLightByPlayer.get(player);
    if (pendingLight !== undefined) {
      pendingLightByPlayer.delete(player);
      if (option === "Yes"
        && quest.getStage(player) === STAGE_DUG_MOUND
        && ownedMoundObject(player)?.getId() === FISSURE
        && held(player, pendingLight)) {
        take(player, pendingLight);
        advance(player, STAGE_LIT_MOUND);
      }
      return;
    }
    if (option.includes("I can think of nothing nicer")) {
      if (agilityLevel(player) < 32) {
        player.sendMessage("You need an Agility level of at least 32 to squeeze in there.");
        return;
      }
      advance(player, STAGE_ENTERED_BERVIRIUS);
      teleport(player, BERVIRIUS_TOMB_TILE);
      return;
    }
    if (option.includes("I'll wriggle through")) {
      const pos = player.getLocation();
      teleport(player, pos.getY() > 9344 ? CAVE_IN_UPPER_TILE : CAVE_IN_LOWER_TILE);
    }
  }

  function spawnUndead(player, count) {
    const pos = player.getLocation();
    for (let i = 0; i < count; i++) {
      api.spawnNpc({
        id: UNDEAD_ONE_ID,
        x: pos.getX() + (i % 2 === 0 ? 1 : -1),
        y: pos.getY() + (i < 2 ? 1 : 0),
        z: pos.getZ(),
        wanderRadius: 3,
        owner: player,
        ownerOnly: true,
      });
    }
  }

  function handleNpcDeath(event) {
    const player = event.killer;
    if (!player || typeof player.getAttribute !== "function") return;
    const index = NAZASTAROOL_FORMS.indexOf(event.npcId);
    if (index === -1) return;
    if (!nazastaroolByPlayer.has(player)) return;
    if (quest.getStage(player) < STAGE_UNLOCKED_TOMB_DOOR || quest.isComplete(player)) return;
    nazastaroolByPlayer.delete(player);
    if (index === 0) mechSet(player, MECH_DEFEATED_1, true);
    if (index === 1) mechSet(player, MECH_DEFEATED_2, true);
    if (index === 2) mechSet(player, MECH_DEFEATED_3, true);
    startNazastaroolScene(player, index + 1);
  }

  function clearNazastarool(player) {
    const npc = nazastaroolByPlayer.get(player);
    if (npc) api.removeNpc(npc);
    nazastaroolByPlayer.delete(player);
    nazNarration.delete(player);
  }

  function handleLogout({ player }) {
    if (!player) return;
    clearNazastarool(player);
    pendingLightByPlayer.delete(player);
    pendingPrismSale.delete(player);
    bridgeState.delete(player);
    clearMoundObject(player);
  }

  function handleLogin({ player }) {
    if (!player) return;
    clearNazastarool(player);
    pendingLightByPlayer.delete(player);
    ensureMoundObject(player);
    refreshQuestList(player);
  }

  /** Wiki's success chance for a skill chart: (1 + floor(low * (99 - L) / 98 + high * (L - 1) / 98 + 0.5)) / 256. */
  function bridgeChance(level) {
    return Math.min(1, (1 + Math.floor((BRIDGE_LOW * (99 - level)) / 98 + (BRIDGE_HIGH * (level - 1)) / 98 + 0.5)) / 256);
  }

  /** Each player's last roll on the bridge: the tick, and the tile they stood on. */
  const bridgeState = new Map();

  /**
   * A player on the Cairn Isle bridge rolls Agility every 20 ticks (capture 352 has the success line 20 ticks apart,
   * shuttling on the bridge included), and only after moving since the last roll (ours: standing still would be an AFK
   * farm). The last roll is kept until logout, not cleared on leaving, so stepping off and on does not pay. Success is the
   * captured line and 10 XP; failure is three hits of floor(HP / 11), the fall line and landing being ours.
   */
  function rollOnBridge(player) {
    if (ObstacleRunner.isBusy(player)) return;
    const at = player.getLocation();
    const tick = api.core.World.getProcessCycle();
    const last = bridgeState.get(player);
    if (last && (tick - last.tick < BRIDGE_REROLL_TICKS || last.x === at.getX())) return;
    bridgeState.set(player, { tick, x: at.getX() });
    if (Math.random() < bridgeChance(agilityLevel(player))) {
      player.sendMessage(BRIDGE_KEEP_BALANCE);
      player.getSkillManager().addExperiences(Skill.AGILITY, BRIDGE_XP);
      return;
    }
    const hit = Math.floor(player.getHitpoints() / 11);
    ObstacleRunner.run({ player }, [
      { msg: BRIDGE_FALL },
      { tele: [BRIDGE_LANDING.x, BRIDGE_LANDING.y, BRIDGE_LANDING.z] },
      { hit },
      { hit },
      { hit },
    ]);
  }

  /** The bridge's tiles, x 2776-2781 on y 2979: only the players standing there are asked. */
  function createBridgeArea() {
    return new (class CairnIsleBridge extends api.core.Area {
      constructor() {
        super([new api.core.Boundary(BRIDGE.minX, BRIDGE.maxX, BRIDGE.y, BRIDGE.y, 0)]);
      }

      process(mobile) {
        if (mobile.isPlayer?.()) rollOnBridge(mobile);
      }
    })();
  }

  /** A closed chatbox cancels the pending light confirmation. */
  function handleInterfaceClose({ player } = {}) {
    if (player) pendingLightByPlayer.delete(player);
  }

  api.persistAttribute(MECH_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "shilo_village",
    name: "Shilo Village",
    varpId: VARP_SHILO_VILLAGE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [{ skillId: Skill.CRAFTING.getIndex(), amount: 3875, label: "Crafting" }],
    scrollItemId: BEADS_OF_THE_DEAD,
    otherRewards: ["Access to Shilo Village"],
    buildJournal,
    onReward: grantReward,
  });

  ObstacleRunner.init(api);
  api.onNpcInteraction("Trufitus", { "Talk-to": handleTrufitusTalk });
  // The cache's complete form of Mosol Rei (8696) has Follow as its first option; we lead the player in.
  api.onNpcInteraction("Mosol Rei", { Follow: handleMosolFollow });
  api.onCustomEvent("npc-drops:roll", handleNazastaroolDrops);
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:condition", handleCondition);
  api.onCustomEvent("npc-dialogue:line", handleNazastaroolLine);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("interface:close", handleInterfaceClose);
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemOnItem(handleItemOnItem);
  api.onItemAction(handleItemAction);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onBeforeObjectInteraction(handleVillageGate);
  api.onObjectInteraction(handleObjectInteraction);
  api.onNpcDeath(handleNpcDeath);
  api.registerArea(createBridgeArea());
  api.persistAttribute(PRISM_SOLD_ATTRIBUTE);
  api.onPlayerLogout(handleLogout);
  api.onPlayerLogin(handleLogin);
  // After the login bootstrap, which clobbers shared varps; 8180 shares 1785 with My Arm's quest.
  api.onCustomEvent("player:bootstrap-complete", ({ player }) => syncTombDoors(player));
};
