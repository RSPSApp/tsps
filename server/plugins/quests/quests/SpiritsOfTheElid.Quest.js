/**
 * Spirits of the Elid (members).
 *
 * The words come from the "Spirits of the Elid" transcript page; this plugin
 * supplies the variant selector for every Nardah NPC in the quest, the start
 * hook, the prose-condition answers (Awusah's 40 Prayer aside, the genie's
 * sole check), the shrine cupboard / torn robes / ancestral key loop, the
 * Water Ravine Dungeon (rope entry, ancestral door, three golem fights, three
 * water channels), the genie's crevice and the statuette hand-in.
 *
 * Stages (varbit 1444 "elidquest", varp 616; rev-227 capture 1788):
 * 10 mayor's plea accepted, 20 Ghaslor's ballad/key on table, 25 key
 * telegrabbed, 27 ancestral door opened, 30 lake door opened after the three
 * channels, 35 spirits told of the statuette, 40 mayor named the crevice,
 * 50 genie deal accepted, 55 sole traded for the statuette, 60 complete.
 * Lost key/shoes are re-placed on login and lost torn robes can be searched
 * again from the shrine cupboard.
 *
 * The seven side bits live in varbit 1445 "elid_shiratti", 1446-1448
 * "elid_black/white/greygolem", 1449-1451 "elid_mining/thieving/rangingchannel"
 * (all bits of varp 616); they are persisted in a player attribute and
 * mirrored with sendVarbit because registerQuest only owns the stage varbit.
 *
 * Object ids (cache loc dump, all placed in Nardah / the Water Ravine Dungeon
 * at y 9536-9599): 10382/10384 closed cupboards and 10385-10387 search
 * variants, 10399/10396 thieving/mining water-channel multilocs transformed
 * by varbits 1450/1449, the 4763/4765 ranging target for varbit 1451,
 * 10419-10429 dungeon doors, 10416 crevice and 10434 rope, 6382 root above
 * the waterfall, 10438 statuette plinth / 10439 Elidinis Statuette (both
 * absent from the cache map, so the plugin places them itself).
 *
 * Source: https://oldschool.runescape.wiki/w/Spirits_of_the_Elid and its
 * quick guide (requirements 33 Magic / 37 Ranged / 37 Mining / 37 Thieving;
 * rewards 2 QP, 8,000 Prayer, 1,000 Thieving, 1,000 Magic XP, Robe of
 * Elidinis and the Nardah shrine). The golem/NPC ids come from the cache.
 *
 * Gaps/approximations:
 *  - The cache map's dungeon pockets are not all walkable-connected, so every
 *    door interaction moves the player across the doorway instead of swinging
 *    the leaves; the ancestral door needs the key, both robes equipped and
 *    (before completion) the ballad, and afterwards leads to the lake. The
 *    black golem door has no reachable adjacent tile at all, so quest-door
 *    clicks are routed to the player's own tile (handleObjectRoute) and the
 *    genie's crevice door crosses from the recorded click side.
 *  - Golem damage is filtered by the plugin to the captured stab/slash/crush
 *    styles; the monster definitions themselves have no weakness data.
 *  - The mining channel needs a usable pickaxe and 37 Mining, the thieving
 *    channel 37 Thieving and the ranging channel 37 Ranged (base levels).
 *  - The rope descent plays the captured camera, fade, landing tile and theme.
 *  - The crevice darkness warning uses the shared Darkness light-source check;
 *    no light source stops the climb instead of applying bug damage.
 *  - The key is telegrabbed as in OSRS; direct pickup says it is out of reach.
 *  - The plinth/statuette and the clearable channels are world objects, so a
 *    restart restores the cache map until the state is touched again.
 */
module.exports = function registerSpiritsOfTheElidQuest(api) {
  const {
    Animation,
    Equipment,
    GameObject,
    Item,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    ObjectIdentifiers,
    ObjectManager,
    Ammunition,
    CombatFactory,
    CombatRange,
    CombatType,
    RangedCombatMethod,
    RangedWeapon,
    Skill,
    WeaponProfiles,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");
  const { createQuestScenes } = require("../QuestScenes");
  const darkness = require("../../world/Darkness.plugin.js");
  const mining = require("../../skills/Mining.plugin.js");

  const Scenes = createQuestScenes(api);
  const PAGE = "Spirits of the Elid";
  const START_HOOK = "quest:spirits-of-the-elid:start";

  const VARP_SPIRITS_OF_THE_ELID = 616;
  const VARBIT_STAGE = 1444; // elidquest
  const VARBIT_SHIRATTI = 1445; // elid_shiratti
  const VARBIT_BLACK_GOLEM = 1446; // elid_blackgolem
  const VARBIT_WHITE_GOLEM = 1447; // elid_whitegolem
  const VARBIT_GREY_GOLEM = 1448; // elid_greygolem
  const VARBIT_MINING_CHANNEL = 1449; // elid_miningchannel
  const VARBIT_THIEVING_CHANNEL = 1450; // elid_thievingchannel
  const VARBIT_RANGING_CHANNEL = 1451; // elid_rangingchannel

  // Native ELIDQUEST varbit values (Quest Helper loadSteps / cache 1444).
  const STAGE_NOT_STARTED = 0;
  const STAGE_STARTED = 10;
  const STAGE_BALLAD = 20;
  const STAGE_KEY = 25;
  const STAGE_DUNGEON = 27;
  const STAGE_CHANNELS = 30;
  const STAGE_SPIRITS = 35;
  const STAGE_MAYOR = 40;
  const STAGE_GENIE_DEAL = 50;
  const STAGE_STATUETTE = 55;
  const STAGE_COMPLETE = 60;

  const AWUSAH_NPC_ID = NpcIdentifiers.AWUSAH_THE_MAYOR; // 4756
  const GHASLOR_NPC_ID = NpcIdentifiers.GHASLOR_THE_ELDER; // 4745
  const SHIRATTI_NPC_ID = NpcIdentifiers.SHIRATTI_THE_CUSTODIAN; // 4760
  const ALI_THE_CARTER_NPC_ID = NpcIdentifiers.ALI_THE_CARTER; // 4746
  const ROKUH_NPC_ID = NpcIdentifiers.ROKUH; // 4761
  const GARAI_NPC_ID = NpcIdentifiers.GARAI; // 4749
  const NKUKU_NPC_ID = NpcIdentifiers.NKUKU; // 4748
  const USI_NPC_ID = NpcIdentifiers.USI; // 4747
  const HABIBAH_NPC_ID = NpcIdentifiers.HABIBAH; // 4750
  const MESKHENET_NPC_ID = NpcIdentifiers.MESKHENET; // 4751
  const ZAHRA_NPC_ID = NpcIdentifiers.ZAHRA; // 4752
  const GENIE_NPC_ID = NpcIdentifiers.GENIE_3; // 4738
  const NIRRIE_NPC_ID = NpcIdentifiers.NIRRIE; // 4739
  const TIRRIE_NPC_ID = NpcIdentifiers.TIRRIE; // 4740
  const HALLAK_NPC_ID = NpcIdentifiers.HALLAK; // 4741
  const BLACK_GOLEM_NPC_ID = NpcIdentifiers.BLACK_GOLEM; // 4742
  const WHITE_GOLEM_NPC_ID = NpcIdentifiers.WHITE_GOLEM; // 4743
  const GREY_GOLEM_NPC_ID = NpcIdentifiers.GREY_GOLEM; // 4744

  const SPIRIT_NPC_IDS = new Set([NIRRIE_NPC_ID, TIRRIE_NPC_ID, HALLAK_NPC_ID]);
  const GOLEM_NPC_IDS = new Set([BLACK_GOLEM_NPC_ID, WHITE_GOLEM_NPC_ID, GREY_GOLEM_NPC_ID]);
  const CHATTER_NPC_IDS = new Set([HABIBAH_NPC_ID, MESKHENET_NPC_ID, ZAHRA_NPC_ID]);
  const ASKING_VARIANTS = new Map([
    [ALI_THE_CARTER_NPC_ID, "asking-around-the-town-ali-the-carter"],
    [ROKUH_NPC_ID, "asking-around-the-town-rokuh"],
    [GARAI_NPC_ID, "asking-around-the-town-garai"],
    [NKUKU_NPC_ID, "asking-around-the-town-nkuku"],
    [USI_NPC_ID, "asking-around-the-town-usi"],
  ]);

  const KNIFE_ITEM_ID = ItemIdentifiers.KNIFE; // 946
  const FLETCHING_KNIFE_ITEM_ID = ItemIdentifiers.FLETCHING_KNIFE; // 31043
  const ROPE_ITEM_ID = ItemIdentifiers.ROPE; // 954
  const NEEDLE_ITEM_ID = ItemIdentifiers.NEEDLE; // 1733
  const THREAD_ITEM_ID = ItemIdentifiers.THREAD; // 1734
  const STATUETTE_ITEM_ID = ItemIdentifiers.STATUETTE_2; // 6785
  const ROBE_TOP_ITEM_ID = ItemIdentifiers.ROBE_OF_ELIDINIS; // 6786
  const ROBE_BOTTOM_ITEM_ID = ItemIdentifiers.ROBE_OF_ELIDINIS_2; // 6787
  const TORN_ROBE_TOP_ITEM_ID = ItemIdentifiers.TORN_ROBE; // 6788
  const TORN_ROBE_BOTTOM_ITEM_ID = ItemIdentifiers.TORN_ROBE_2; // 6789
  const SHOES_ITEM_ID = ItemIdentifiers.SHOES; // 6790
  const SOLE_ITEM_ID = ItemIdentifiers.SOLE; // 6791
  const ANCESTRAL_KEY_ITEM_ID = ItemIdentifiers.ANCESTRAL_KEY; // 6792
  const BALLAD_ITEM_ID = ItemIdentifiers.BALLAD; // 6793

  const ROOT_OBJECT_ID = ObjectIdentifiers.ROOT_3; // 6382, above the waterfall
  const CREVICE_OBJECT_ID = ObjectIdentifiers.CREVICE_9; // 10416, west of Nardah
  const CREVICE_ROPE_OBJECT_ID = ObjectIdentifiers.ROPE_10; // 10434, inside the crevice
  const CAVE_EXIT_OBJECT_ID = ObjectIdentifiers.CAVE_EXIT_18; // 10417
  // Cache multilocs that the client transforms from the channel varbits.
  const THIEVING_CHANNEL_OBJECT_ID = 10399; // elid_waterchannel_thieving_multiloc
  const MINING_CHANNEL_OBJECT_ID = 10396; // elid_waterchannel_mining_multiloc
  // Cache gameval elid_ranging_target (not yet in generated identifiers).
  const RANGING_TARGET_NPC_IDS = new Set([4763, 4765]);
  // The map places the multiloc 10389 at (3426,2930); varbit 1444 resolves it to
  // 10438 while the statuette is missing and 10439 once it is returned.
  const PLINTH_MULTILOC_OBJECT_ID = 10389; // elid_statuette_multiloc
  const PLINTH_OBJECT_ID = ObjectIdentifiers.STATUETTE_PLINTH; // 10438
  const STATUETTE_OBJECT_ID = ObjectIdentifiers.ELIDINIS_STATUETTE; // 10439
  // The client sends the map parent id; keep the resolved children for direct use.
  const PLINTH_OBJECT_IDS = new Set([PLINTH_MULTILOC_OBJECT_ID, PLINTH_OBJECT_ID]);
  const STATUETTE_OBJECT_IDS = new Set([PLINTH_MULTILOC_OBJECT_ID, STATUETTE_OBJECT_ID]);
  const CUPBOARD_SEARCH_IDS = new Set([
    ObjectIdentifiers.CUPBOARD_36, // 10383 opened cupboard
    ObjectIdentifiers.CUPBOARD_38, // 10385 opened cupboard with robes
    ObjectIdentifiers.CUPBOARD_40, // 10387 opened empty cupboard
  ]);
  const CUPBOARD_WITH_ROBES_TILE = new Location(3420, 2930, 0);
  const LAKE_DOOR_IDS = new Set([
    ObjectIdentifiers.DOOR_248, // 10423
    ObjectIdentifiers.DOOR_249, // 10425 (mirror)
  ]);
  const ANCESTRAL_DOOR_IDS = new Set([
    ObjectIdentifiers.DOOR_250, // 10427
    ObjectIdentifiers.DOOR_251, // 10429 (mirror)
  ]);
  const CREVICE_DOOR_ID = ObjectIdentifiers.DOOR_252; // 10431, genie's door
  const GOLEM_DOOR_IDS = new Set([
    ObjectIdentifiers.DOOR_245, // 10419
    ObjectIdentifiers.DOOR_246, // 10420
    ObjectIdentifiers.DOOR_247, // 10421
  ]);

  // The ancestral key sits on the shrine's wooden table (elid_wooden_table).
  const ANCESTRAL_KEY_TILE = new Location(3432, 2928, 0);
  const SHOES_TILE = new Location(3442, 2917, 0);
  // West of the ancestral door, where the rope lands the player.
  const DUNGEON_ENTRY_TILE = new Location(3349, 9536, 0);
  // Past the ancestral door, at the white golem's door.
  const GOLEM_CORRIDOR_TILE = new Location(3365, 9544, 0);
  // Lake side of the ancestral door, used once the channels are clear.
  const LAKE_ENTRY_TILE = new Location(3347, 9563, 0);
  // South side of the lake door, where the last channel sends the player.
  const LAKE_DOOR_APPROACH_TILE = new Location(3354, 9559, 0);
  const DUNGEON_EXIT_TILES = [
    new Location(3349, 9557, 0),
    new Location(3347, 9563, 0),
  ];
  const WATERFALL_SURFACE_TILE = new Location(3369, 3131, 0);
  const CREVICE_SURFACE_TILE = new Location(3374, 2903, 0);
  const CREVICE_FLOOR_TILE = new Location(3373, 9306, 0);
  const CREVICE_DOOR_NORTH_TILE = new Location(3371, 9316, 0);
  const CREVICE_DOOR_SOUTH_TILE = new Location(3371, 9311, 0);

  const WHITE_GOLEM_ROOM = {
    golemNpcId: WHITE_GOLEM_NPC_ID,
    doorId: ObjectIdentifiers.DOOR_246, // 10420
    approach: new Location(3365, 9544, 0),
    inside: new Location(3365, 9539, 0),
    spawn: new Location(3364, 9544, 0),
    channelTiles: [new Location(3365, 9538, 0)],
    channelVariant: "the-waterfall-starting-the-water-flow-southern-room",
    channelObjectId: THIEVING_CHANNEL_OBJECT_ID,
    channelBit: null, // filled in below
    golemBit: null,
    skill: "THIEVING",
  };
  const GREY_GOLEM_ROOM = {
    golemNpcId: GREY_GOLEM_NPC_ID,
    doorId: ObjectIdentifiers.DOOR_247, // 10421
    approach: new Location(3370, 9547, 0),
    inside: new Location(3377, 9546, 0),
    spawn: new Location(3371, 9547, 0),
    channelTiles: [new Location(3378, 9547, 0)],
    channelVariant: "the-waterfall-starting-the-water-flow-eastern-room",
    channelObjectId: MINING_CHANNEL_OBJECT_ID,
    channelBit: null,
    golemBit: null,
    skill: "MINING",
  };
  const BLACK_GOLEM_ROOM = {
    golemNpcId: BLACK_GOLEM_NPC_ID,
    doorId: ObjectIdentifiers.DOOR_245, // 10419
    // The door at (3372,9556) has no reachable neighbour on the cache collision
    // map, so the click is routed from here (3363,9556, verified reachable) and
    // never walks; see handleObjectRoute.
    approach: new Location(3363, 9556, 0),
    inside: new Location(3375, 9555, 0),
    spawn: new Location(3362, 9556, 0),
    channelTiles: [
      new Location(3376, 9554, 0),
      new Location(3376, 9555, 0),
    ],
    channelVariant: "the-waterfall-starting-the-water-flow-northern-room",
    channelNpcIds: RANGING_TARGET_NPC_IDS,
    channelBit: null,
    golemBit: null,
    skill: "RANGED",
  };

  const BITS_ATTRIBUTE = "quest.spirits_of_the_elid.bits";
  const BIT_SHIRATTI = 1 << 0;
  const BIT_BLACK_GOLEM = 1 << 1;
  const BIT_WHITE_GOLEM = 1 << 2;
  const BIT_GREY_GOLEM = 1 << 3;
  const BIT_MINING_CHANNEL = 1 << 4;
  const BIT_THIEVING_CHANNEL = 1 << 5;
  const BIT_RANGING_CHANNEL = 1 << 6;
  const BIT_DEAL_ACCEPTED = 1 << 7;
  const BIT_CREVICE_ROPED = 1 << 8;

  WHITE_GOLEM_ROOM.golemBit = BIT_WHITE_GOLEM;
  WHITE_GOLEM_ROOM.channelBit = BIT_THIEVING_CHANNEL;
  GREY_GOLEM_ROOM.golemBit = BIT_GREY_GOLEM;
  GREY_GOLEM_ROOM.channelBit = BIT_MINING_CHANNEL;
  BLACK_GOLEM_ROOM.golemBit = BIT_BLACK_GOLEM;
  BLACK_GOLEM_ROOM.channelBit = BIT_RANGING_CHANNEL;

  const ROOMS = [WHITE_GOLEM_ROOM, GREY_GOLEM_ROOM, BLACK_GOLEM_ROOM];
  // OSRS requires stab/slash/crush (southern/eastern/northern golem).
  // BonusManager melee bonus types (stab 0, slash 1, crush 2).
  const ATTACK_STAB = 0;
  const ATTACK_SLASH = 1;
  const ATTACK_CRUSH = 2;
  const GOLEM_WEAKNESS = new Map([
    [WHITE_GOLEM_NPC_ID, { style: ATTACK_STAB, name: "stab" }],
    [GREY_GOLEM_NPC_ID, { style: ATTACK_SLASH, name: "slash" }],
    [BLACK_GOLEM_NPC_ID, { style: ATTACK_CRUSH, name: "crush" }],
  ]);
  const ROOM_BY_DOOR = new Map(ROOMS.map((room) => [room.doorId, room]));

  let quest;
  let dungeonExitPlaced = false;
  const trackedGolems = new Map(); // "<username>:<doorId>" -> npc
  /** Where each player clicked a quest door, captured before the walk: the black
   * golem door and the crevice door have no walkable contact tile, and door:toggle
   * fires after the walk (which can leave the player on the door tile itself). */
  const doorClickSource = new WeakMap();
  const itemOnGroundManager = api.getItemOnGroundManager();

  // ==========================================================================
  // Bits / stage helpers
  // ==========================================================================

  function bits(player) {
    return Number(player.getAttribute(BITS_ATTRIBUTE)) || 0;
  }

  function hasBit(player, bit) {
    return (bits(player) & bit) !== 0;
  }

  function setBit(player, bit) {
    player.setAttribute(BITS_ATTRIBUTE, bits(player) | bit);
    syncVarbits(player);
  }

  function syncVarbits(player) {
    const value = bits(player);
    const packet = player.getPacketSender();
    packet.sendVarbit(VARBIT_SHIRATTI, (value & BIT_SHIRATTI) !== 0 ? 1 : 0);
    packet.sendVarbit(VARBIT_BLACK_GOLEM, (value & BIT_BLACK_GOLEM) !== 0 ? 1 : 0);
    packet.sendVarbit(VARBIT_WHITE_GOLEM, (value & BIT_WHITE_GOLEM) !== 0 ? 1 : 0);
    packet.sendVarbit(VARBIT_GREY_GOLEM, (value & BIT_GREY_GOLEM) !== 0 ? 1 : 0);
    packet.sendVarbit(VARBIT_MINING_CHANNEL, (value & BIT_MINING_CHANNEL) !== 0 ? 1 : 0);
    packet.sendVarbit(VARBIT_THIEVING_CHANNEL, (value & BIT_THIEVING_CHANNEL) !== 0 ? 1 : 0);
    packet.sendVarbit(VARBIT_RANGING_CHANNEL, (value & BIT_RANGING_CHANNEL) !== 0 ? 1 : 0);
  }

  function questActive(player) {
    return quest.getStage(player) >= STAGE_STARTED && !quest.isComplete(player);
  }

  const held = (player, itemId, amount = 1) =>
    player.getInventory().getAmount(itemId) >= amount;

  function wearingRobes(player) {
    const top = player.getEquipment().get(Equipment.BODY_SLOT)?.getId?.();
    const bottom = player.getEquipment().get(Equipment.LEG_SLOT)?.getId?.();
    return top === ROBE_TOP_ITEM_ID && bottom === ROBE_BOTTOM_ITEM_ID;
  }

  function hasRobePiece(player) {
    return (
      held(player, TORN_ROBE_TOP_ITEM_ID) ||
      held(player, TORN_ROBE_BOTTOM_ITEM_ID) ||
      held(player, ROBE_TOP_ITEM_ID) ||
      held(player, ROBE_BOTTOM_ITEM_ID)
    );
  }

  function allChannelsClear(player) {
    return ROOMS.every((room) => hasBit(player, room.channelBit));
  }

  function tileOf(location) {
    return new Location(
      location?.getX?.() ?? location?.x ?? 0,
      location?.getY?.() ?? location?.y ?? 0,
      location?.getZ?.() ?? location?.z ?? 0
    );
  }

  function sameTile(location, tile) {
    const point = tileOf(location);
    return point.getX() === tile.getX() && point.getY() === tile.getY();
  }

  function roomForChannel(location) {
    for (const room of ROOMS) {
      if (room.channelTiles.some((tile) => sameTile(location, tile))) return room;
    }
    return null;
  }

  function replaceObject(object, newId) {
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

  function placeWorldObject(id, tile, type = 10) {
    const object = new GameObject(id, new Location(tile.getX(), tile.getY(), tile.getZ()), type, 0, null);
    ObjectManager.register(object, true);
    return object;
  }

  function ensureDungeonExit() {
    if (dungeonExitPlaced) return;
    dungeonExitPlaced = true;
    for (const tile of DUNGEON_EXIT_TILES) placeWorldObject(CAVE_EXIT_OBJECT_ID, tile);
  }

  // ==========================================================================
  // Journal
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Awusah the Mayor asked me to lift the curse on Nardah.</str>",
        "<str>I found the ancestral key and robes in the shrine, cleared the</str>",
        "<str>three channels of the Water Ravine Dungeon and spoke with the</str>",
        "<str>spirits of the Elid. I recovered the statuette of Elidinis from</str>",
        "<str>the genie and returned it to the shrine.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_STATUETTE) {
      return [
        "<str>Awusah the Mayor asked me to lift the curse on Nardah.</str>",
        "<str>The spirits of the Elid cursed the town for throwing away their</str>",
        "<str>statuette of Elidinis.</str>",
        "",
        "I traded the mayor's sole to the genie for the statuette.",
        "I should put it back on its <col=800000>plinth</col> in the shrine.",
      ];
    }
    if (stage >= STAGE_MAYOR) {
      return [
        "<str>Awusah the Mayor asked me to lift the curse on Nardah.</str>",
        "<str>The spirits of the Elid cursed the town for throwing away their</str>",
        "<str>statuette of Elidinis.</str>",
        "",
        "Awusah says the statuette was thrown into a crevice west of",
        "Nardah. I should take his <col=800000>shoes</col>, cut out a",
        "<col=800000>sole</col> and give it to the <col=800000>genie</col> in the crevice.",
      ];
    }
    if (stage >= STAGE_SPIRITS) {
      return [
        "<str>Awusah the Mayor asked me to lift the curse on Nardah.</str>",
        "<str>I spoke with the spirits of the Elid at the source of the river.</str>",
        "",
        "The curse will lift when the statuette of Elidinis is returned to",
        "the shrine. I should ask <col=800000>Awusah</col> where it was thrown.",
      ];
    }
    if (stage >= STAGE_CHANNELS) {
      return [
        "<str>Awusah the Mayor asked me to lift the curse on Nardah.</str>",
        "<str>I entered the Water Ravine Dungeon and cleared its channels.</str>",
        "",
        "I should talk to the <col=800000>spirits</col> by the lake in the dungeon.",
      ];
    }
    if (stage >= STAGE_KEY) {
      return [
        "<str>Awusah the Mayor asked me to lift the curse on Nardah.</str>",
        "<str>Ghaslor gave me the ballad of Jareesh and I found the torn robes</str>",
        "<str>and ancestral key in the shrine.</str>",
        "",
        "I repaired the robes with a needle and thread.",
        "I must wear the <col=800000>robes of Elidinis</col> and take the",
        "<col=800000>ancestral key</col> and <col=800000>ballad</col> to the",
        "waterfall north of Nardah.",
      ];
    }
    if (stage >= STAGE_BALLAD) {
      return [
        "<str>Awusah the Mayor asked me to lift the curse on Nardah.</str>",
        "<str>Ghaslor the Elder gave me the ballad of Jareesh.</str>",
        "",
        "I should search the <col=800000>cupboards</col> in the shrine north",
        "of Nardah's fountain for the robes and key.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "Awusah the Mayor has asked me to find out why Nardah is cursed.",
        "I should ask the <col=800000>townsfolk</col> about the curse, starting",
        "with <col=800000>Ghaslor the Elder</col> in the north-east of town.",
      ];
    }
    return [
      "I can start this quest by talking to <col=800000>Awusah the Mayor</col>",
      "in <col=800000>Nardah</col>, in the southern Kharidian Desert.",
    ];
  }

  // ==========================================================================
  // Dialogue variant selection
  // ==========================================================================

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (npcId === AWUSAH_NPC_ID) {
      if (quest.isComplete(player)) return null; // dedicated after-quest page
      if (stage <= STAGE_NOT_STARTED) return "starting-off";
      if (stage < STAGE_SPIRITS) return "starting-off-talking-to-awusah-after-starting-the-quest";
      if (stage < STAGE_MAYOR) return "the-crevice-talking-to-awusah-the-mayor";
      if (stage < STAGE_GENIE_DEAL) return "the-crevice-talking-to-awusah-the-mayor-again";
      if (stage < STAGE_STATUETTE) return "sole-split-talking-to-the-mayor-again";
      return "sole-split-talking-to-the-mayor-with-the-statuette";
    }
    if (npcId === GHASLOR_NPC_ID) {
      if (quest.isComplete(player)) return null;
      if (stage >= STAGE_SPIRITS) return "the-crevice-talking-to-ghaslor-the-elder";
      return "starting-off-talking-to-ghaslor-the-elder";
    }
    if (npcId === SHIRATTI_NPC_ID) {
      if (quest.isComplete(player)) return null;
      if (stage >= STAGE_STATUETTE) return "sole-split-talking-to-shiratti-with-the-statuette";
      if (stage >= STAGE_SPIRITS) return "the-crevice-talking-to-shiratti-the-custodian";
      return "starting-off-talking-to-shiratti-the-custodian";
    }
    if (
      npcId === ALI_THE_CARTER_NPC_ID ||
      npcId === ROKUH_NPC_ID ||
      npcId === GARAI_NPC_ID ||
      npcId === NKUKU_NPC_ID ||
      npcId === USI_NPC_ID
    ) {
      return stage >= STAGE_STARTED && stage < STAGE_SPIRITS ? ASKING_VARIANTS.get(npcId) : null;
    }
    if (npcId === GENIE_NPC_ID) {
      if (stage < STAGE_MAYOR) return null;
      if (stage >= STAGE_STATUETTE) {
        return !quest.isComplete(player) && !held(player, STATUETTE_ITEM_ID)
          ? "sole-split-talking-to-the-genie-after-losing-the-statuette"
          : null;
      }
      if (!hasBit(player, BIT_DEAL_ACCEPTED)) return "the-crevice-talking-to-the-genie";
      if (held(player, SOLE_ITEM_ID)) return "sole-split-returning-to-the-genie-with-the-mayor-s-sole";
      return "the-crevice-talking-to-the-genie-again-after-accepting-his-deal";
    }
    if (SPIRIT_NPC_IDS.has(npcId)) {
      if (quest.isComplete(player)) return null;
      if (stage > STAGE_CHANNELS) {
        return "the-waterfall-talking-to-the-spirits-of-the-elid-again-after-learning-about-the-statuette";
      }
      return "the-waterfall-talking-to-the-spirits-of-the-elid";
    }
    return null;
  }

  function answerCondition({ npcId, player, text }) {
    if (npcId === AWUSAH_NPC_ID) {
      const value = String(text).toLowerCase();
      if (value.includes("at least 40 prayer")) {
        return player.getSkillManager().getCurrentLevel(Skill.PRAYER) >= 40;
      }
    }
    if (npcId === GENIE_NPC_ID) {
      const value = String(text).toLowerCase();
      if (value.includes("does not have a sole")) return !held(player, SOLE_ITEM_ID);
      if (value.includes("has a sole")) return held(player, SOLE_ITEM_ID);
    }
    return null;
  }

  // ==========================================================================
  // Dialogue side effects
  // ==========================================================================

  function handleDialogueLine(event) {
    const { player, npcId } = event;
    const text = String(event.text ?? "");
    if (npcId === AWUSAH_NPC_ID && quest.getStage(player) === STAGE_SPIRITS) {
      if (text.includes("deep crevice in the desert to the west")) {
        quest.setStage(player, STAGE_MAYOR);
        ensureShoes(player);
      }
      return;
    }
    if (SPIRIT_NPC_IDS.has(npcId) && quest.getStage(player) === STAGE_CHANNELS) {
      if (text.includes("throw away a statuette of Elidinis")) {
        quest.setStage(player, STAGE_SPIRITS);
      }
      return;
    }
    if (npcId === SHIRATTI_NPC_ID && questActive(player) && !hasBit(player, BIT_SHIRATTI)) {
      setBit(player, BIT_SHIRATTI);
    }
  }

  function handleDialogueChoice({ player, npcId, option }) {
    if (npcId !== GENIE_NPC_ID) return;
    if (String(option).toLowerCase().includes("agree to the deal")) {
      setBit(player, BIT_DEAL_ACCEPTED);
      if (quest.getStage(player) >= STAGE_MAYOR && quest.getStage(player) < STAGE_GENIE_DEAL) {
        quest.setStage(player, STAGE_GENIE_DEAL);
      }
    }
  }

  function handleDialogueAction(event) {
    const { player, npcId, stepId, text } = event;
    if (stepId === "4JXIDh" && npcId === GHASLOR_NPC_ID) {
      // "Ghaslor hands you a scroll."
      event.handled = true;
      if (!held(player, BALLAD_ITEM_ID)) player.getInventory().adds(BALLAD_ITEM_ID, 1);
      if (quest.getStage(player) === STAGE_STARTED) quest.setStage(player, STAGE_BALLAD);
      ensureAncestralKey(player);
      if (text) player.sendMessage(text);
      return;
    }
    if (stepId === "CqbO1I" || stepId === "UDr1XL") {
      // "You trade the sole for the statuette." The first deal advances to 55;
      // the recorded lost-statuette conversation trades another sole at 55.
      event.handled = true;
      const stage = quest.getStage(player);
      const firstDeal = stepId === "CqbO1I" && stage === STAGE_GENIE_DEAL;
      const replacement = stepId === "UDr1XL" && stage >= STAGE_STATUETTE &&
        !quest.isComplete(player) && !held(player, STATUETTE_ITEM_ID) &&
        held(player, SOLE_ITEM_ID);
      if (firstDeal || replacement) {
        if (held(player, SOLE_ITEM_ID)) player.getInventory().deleteNumber(SOLE_ITEM_ID, 1);
        if (!held(player, STATUETTE_ITEM_ID)) player.getInventory().adds(STATUETTE_ITEM_ID, 1);
        if (firstDeal) quest.setStage(player, STAGE_STATUETTE);
      }
      if (text) player.sendMessage(text);
      return;
    }
    if (stepId === "G39MGw") {
      // "Congratulations! Quest complete!" - the statuette lands on its plinth.
      event.handled = true;
      event.end = true;
      if (!quest.isComplete(player) && quest.getStage(player) >= STAGE_STATUETTE) {
        quest.complete(player);
      }
    }
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== AWUSAH_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) === STAGE_NOT_STARTED) quest.setStage(player, STAGE_STARTED);
  }

  /**
   * Habibah, Meskhenet and Zahra share one wiki voice ("Habibah/Meskhenet/Zahra")
   * but their id-index pages only carry the idle dialogues, so the quest lines
   * are played from the shared page directly.
   */
  function talkToChatter(event) {
    const { player, npcId } = event;
    if (!CHATTER_NPC_IDS.has(npcId)) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED || stage >= STAGE_SPIRITS) return;
    event.handled = true;
    startTranscript(
      api,
      player,
      npcId,
      PAGE,
      stage >= STAGE_SPIRITS
        ? "asking-around-the-town-habibah-meskhenet-and-zahra-after-talking-to-nirrie-and-hallak"
        : "asking-around-the-town-habibah-meskhenet-and-zahra"
    );
  }

  // ==========================================================================
  // Items: robes, shoes, key, crevice, statuette
  // ==========================================================================

  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const ids = [usedItemId, usedWithItemId];
    if (ids.includes(NEEDLE_ITEM_ID)) {
      const torn = ids.includes(TORN_ROBE_TOP_ITEM_ID)
        ? TORN_ROBE_TOP_ITEM_ID
        : ids.includes(TORN_ROBE_BOTTOM_ITEM_ID)
          ? TORN_ROBE_BOTTOM_ITEM_ID
          : 0;
      if (!torn) return;
      event.handled = true;
      if (!held(player, THREAD_ITEM_ID)) {
        player.sendMessage("You need some thread to repair the robe.");
        return;
      }
      player.getInventory().deleteNumber(torn, 1);
      player.getInventory().deleteNumber(THREAD_ITEM_ID, 1);
      player
        .getInventory()
        .adds(torn === TORN_ROBE_TOP_ITEM_ID ? ROBE_TOP_ITEM_ID : ROBE_BOTTOM_ITEM_ID, 1);
      player.sendMessage("You repair the torn robe with your needle and thread.");
      return;
    }
    if (!ids.includes(SHOES_ITEM_ID)) return;
    if (!ids.includes(KNIFE_ITEM_ID) && !ids.includes(FLETCHING_KNIFE_ITEM_ID)) return;
    event.handled = true;
    if (nearMayor(player)) {
      startTranscript(
        api,
        player,
        AWUSAH_NPC_ID,
        PAGE,
        "sole-split-attempting-to-cut-the-mayor-s-shoes-in-his-presence"
      );
      return;
    }
    player.getInventory().deleteNumber(SHOES_ITEM_ID, 1);
    player.getInventory().adds(SOLE_ITEM_ID, 2);
    startTranscript(api, player, AWUSAH_NPC_ID, PAGE, "sole-split-cutting-the-mayor-s-shoes");
  }

  function handleItemOnNpc(event) {
    const { player, npcId, itemId } = event;
    if (npcId !== AWUSAH_NPC_ID || itemId !== KNIFE_ITEM_ID) return;
    if (quest.getStage(player) < STAGE_MAYOR) return;
    event.handled = true;
    startTranscript(api, player, AWUSAH_NPC_ID, PAGE, "sole-split-using-a-knife-on-awusah-the-mayor");
  }

  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (itemId === ROPE_ITEM_ID && objectId === ROOT_OBJECT_ID) {
      event.handled = true;
      if (!held(player, ROPE_ITEM_ID)) {
        player.sendMessage("You need a rope to climb down here.");
        return;
      }
      player.getInventory().deleteNumber(ROPE_ITEM_ID, 1);
      ensureDungeonExit();
      playRopeDescent(player);
      player.sendMessage("You tie the rope to the root and climb down into the cave.");
      return;
    }
    if (itemId === ROPE_ITEM_ID && objectId === CREVICE_OBJECT_ID) {
      event.handled = true;
      if (!held(player, ROPE_ITEM_ID)) {
        player.sendMessage("You need a rope to climb down here.");
        return;
      }
      player.getInventory().deleteNumber(ROPE_ITEM_ID, 1);
      setBit(player, BIT_CREVICE_ROPED);
      player.sendMessage("You tie the rope to the crevice.");
      return;
    }
    if (itemId === STATUETTE_ITEM_ID && PLINTH_OBJECT_IDS.has(objectId)) {
      event.handled = true;
      if (!questActive(player) || quest.getStage(player) < STAGE_STATUETTE) return;
      player.getInventory().deleteNumber(STATUETTE_ITEM_ID, 1);
      startTranscript(api, player, AWUSAH_NPC_ID, PAGE, "sole-split-using-the-statuette-on-the-plinth");
    }
  }

  /** Capture 1788: descent camera, fade, teleport to (3349,9536), reset and theme. */
  function playRopeDescent(player) {
    Scenes.camera(player, [3368, 3134, 1175], [3372, 3130, 25], { rate: 1, rate2: 200 });
    Scenes.fade(player, true);
    Scenes.later(player, 2, () => {
      player.moveTo(DUNGEON_ENTRY_TILE);
      player.getPacketSender().sendCameraReset().sendSong(462);
      Scenes.fade(player, false);
      Scenes.later(player, 2, () => Scenes.closeFade(player));
    });
  }

  /** Logout/death during the rope fade: cancel pending ticks and leave no half-open transition. */
  function handleTransitionInterrupted({ player } = {}) {
    if (!player) return;
    Scenes.cancel(player);
    Scenes.closeFade(player);
    Scenes.controls(player, false);
    player.getPacketSender?.().sendCameraReset?.();
  }

  function handleGroundItemPickup(event) {
    const { player, groundItemId } = event;
    if (groundItemId !== ANCESTRAL_KEY_ITEM_ID) return;
    // The key sits in the shrine's alcove: OSRS requires Telekinetic Grab.
    event.handled = true;
    player.sendMessage("You can't reach that from here.");
  }

  // ==========================================================================
  // Cupboards
  // ==========================================================================

  function openCupboard(event) {
    const { objectId } = event;
    if (objectId === ObjectIdentifiers.CUPBOARD_35) {
      event.handled = true;
      replaceObject(event.object, ObjectIdentifiers.CUPBOARD_36);
      return true;
    }
    if (objectId === ObjectIdentifiers.CUPBOARD_37) {
      event.handled = true;
      replaceObject(event.object, ObjectIdentifiers.CUPBOARD_38);
      return true;
    }
    if (objectId === ObjectIdentifiers.CUPBOARD_39) {
      event.handled = true;
      replaceObject(event.object, ObjectIdentifiers.CUPBOARD_40);
      return true;
    }
    return false;
  }

  function searchCupboard(event) {
    const { player, objectId } = event;
    if (!CUPBOARD_SEARCH_IDS.has(objectId)) return false;
    event.handled = true;
    if (!sameTile(event.location, CUPBOARD_WITH_ROBES_TILE)) {
      player.sendMessage("You find nothing interesting.");
      return true;
    }
    if (hasRobePiece(player)) {
      player.sendMessage("You find nothing interesting.");
      return true;
    }
    if (player.getInventory().getFreeSlots() < 2) {
      player.sendMessage("You need two free inventory spaces.");
      return true;
    }
    player.getInventory().adds(TORN_ROBE_TOP_ITEM_ID, 1);
    player.getInventory().adds(TORN_ROBE_BOTTOM_ITEM_ID, 1);
    replaceObject(event.object, ObjectIdentifiers.CUPBOARD_40);
    startTranscript(api, player, SHIRATTI_NPC_ID, PAGE, "starting-off-searching-the-north-western-cupboard");
    if (quest.getStage(player) < STAGE_BALLAD) quest.setStage(player, STAGE_BALLAD);
    return true;
  }

  function shutCupboard(event) {
    const { objectId } = event;
    if (objectId === ObjectIdentifiers.CUPBOARD_36) {
      event.handled = true;
      replaceObject(event.object, ObjectIdentifiers.CUPBOARD_35);
      return true;
    }
    if (objectId === ObjectIdentifiers.CUPBOARD_38) {
      event.handled = true;
      replaceObject(event.object, ObjectIdentifiers.CUPBOARD_37);
      return true;
    }
    if (objectId === ObjectIdentifiers.CUPBOARD_40) {
      event.handled = true;
      replaceObject(event.object, ObjectIdentifiers.CUPBOARD_39);
      return true;
    }
    return false;
  }

  // ==========================================================================
  // Doors (the shared Doors plugin exposes door:toggle first)
  // ==========================================================================

  function isQuestDoor(objectId) {
    return (
      LAKE_DOOR_IDS.has(objectId) ||
      ANCESTRAL_DOOR_IDS.has(objectId) ||
      GOLEM_DOOR_IDS.has(objectId) ||
      objectId === CREVICE_DOOR_ID
    );
  }

  /**
   * None of the black golem door's four neighbours is reachable on the cache
   * collision map ((3371,9556) and (3373,9556) are standable but walled off,
   * the two axis tiles are blocked), so walk-to-object never fires the click.
   * Route every quest-door click to the tile the player is already on, as
   * CurrentAffairs does for its aquariums, and remember that click position
   * for door:toggle (which runs after the walk).
   */
  function handleObjectRoute(event) {
    const { player, objectId, sourceLocation } = event;
    if (!isQuestDoor(objectId)) return;
    if (sourceLocation) {
      doorClickSource.set(player, {
        x: sourceLocation.x,
        y: sourceLocation.y,
        z: sourceLocation.z,
        objectId,
      });
      event.destination = { x: sourceLocation.x, y: sourceLocation.y, z: sourceLocation.z };
    }
  }

  function handleDoorToggle(event) {
    const { player, objectId } = event;
    if (ANCESTRAL_DOOR_IDS.has(objectId)) {
      event.handled = true;
      useAncestralDoor(player);
      return;
    }
    if (LAKE_DOOR_IDS.has(objectId)) {
      event.handled = true;
      openLakeDoor(player);
      return;
    }
    if (GOLEM_DOOR_IDS.has(objectId)) {
      event.handled = true;
      openGolemDoor(player, ROOM_BY_DOOR.get(objectId));
      return;
    }
    if (objectId === CREVICE_DOOR_ID) {
      event.handled = true;
      // The genie's door sits in a one-tile wall gap: crossing depends on the
      // side the player clicked from, and the walk can leave them on the door
      // tile (y=9312), so use the click-time tile, not the post-walk one.
      const source = doorClickSource.get(player);
      doorClickSource.delete(player);
      const clickY = source?.objectId === objectId ? source.y : player.getLocation().getY();
      player.moveTo(clickY > 9312 ? CREVICE_DOOR_SOUTH_TILE : CREVICE_DOOR_NORTH_TILE);
    }
  }

  function openLakeDoor(player) {
    if (!allChannelsClear(player)) {
      player.sendMessage("The door is locked.");
      return;
    }
    player.moveTo(LAKE_ENTRY_TILE);
    if (quest.getStage(player) < STAGE_CHANNELS) quest.setStage(player, STAGE_CHANNELS);
  }

  function useAncestralDoor(player) {
    if (!held(player, ANCESTRAL_KEY_ITEM_ID)) {
      player.sendMessage("The door is locked.");
      return;
    }
    const questDone = quest.isComplete(player);
    if (!wearingRobes(player) || (!questDone && !held(player, BALLAD_ITEM_ID))) {
      startTranscript(
        api,
        player,
        AWUSAH_NPC_ID,
        PAGE,
        "the-waterfall-attempting-to-open-the-door-without-the-robes-of-elidinis-equipped"
      );
      return;
    }
    startTranscript(api, player, AWUSAH_NPC_ID, PAGE, "the-waterfall-opening-the-door-with-the-robes-equipped");
    player.moveTo(
      quest.getStage(player) >= STAGE_CHANNELS ? LAKE_ENTRY_TILE : GOLEM_CORRIDOR_TILE
    );
    if (quest.getStage(player) < STAGE_DUNGEON) quest.setStage(player, STAGE_DUNGEON);
  }

  function golemKeyFor(player, room) {
    return `${player.getUsername()}:${room.doorId}`;
  }

  function openGolemDoor(player, room) {
    if (!room) return;
    if (!hasBit(player, room.golemBit)) {
      const key = golemKeyFor(player, room);
      const existing = trackedGolems.get(key);
      if (!existing || (existing.getHitpoints?.() ?? 0) <= 0) {
        const npc = api.spawnNpc({
          id: room.golemNpcId,
          x: room.spawn.getX(),
          y: room.spawn.getY(),
          z: room.spawn.getZ(),
          wanderRadius: 0,
          owner: player,
          ownerOnly: true,
        });
        if (npc) trackedGolems.set(key, npc);
      }
      startTranscript(
        api,
        player,
        room.golemNpcId,
        PAGE,
        "the-waterfall-guardian-golem-attempting-to-open-a-door-before-defeating-the-golem"
      );
      return;
    }
    const location = player.getLocation();
    const inside = playerInsideRoom(room, location);
    player.moveTo(inside ? room.approach : room.inside);
  }

  function playerInsideRoom(room, location) {
    const tile = tileOf(location);
    if (room === WHITE_GOLEM_ROOM) return tile.getY() <= 9541;
    if (room === GREY_GOLEM_ROOM) return tile.getX() >= 3375;
    return tile.getX() >= 3374;
  }

  // ==========================================================================
  // Water channels
  // ==========================================================================

  function clearChannel(player, room) {
    if (hasBit(player, room.channelBit)) {
      player.sendMessage("The channel is already clear.");
      return;
    }
    if (!hasBit(player, room.golemBit)) {
      player.sendMessage("You may not pass!");
      return;
    }
    if (!hasChannelSkill(player, room)) return;
    setBit(player, room.channelBit);
    startTranscript(api, player, room.golemNpcId, PAGE, room.channelVariant);
    moveToNextChannel(player);
  }

  function handleChannelClear(event) {
    const { player, objectId, location } = event;
    const room = ROOMS.find(
      (candidate) =>
        candidate.channelObjectId === objectId &&
        candidate.channelTiles.some((tile) => sameTile(location, tile))
    );
    if (!room) return false;
    event.handled = true;
    clearChannel(player, room);
    return true;
  }

  /** The target is shot across the channel; the default walk-to range 1 never reaches it. */
  function handleRangingTargetRoute(event) {
    if (event.clickType === 0) return;
    const room = ROOMS.find((candidate) => candidate.channelNpcIds?.has(event.npcId));
    if (!room) return;
    event.range = 10;
  }

  /** The northern room is cleared by shooting the ranging target, not an object. */
  function handleRangingTarget(event) {
    const { player, npcId, npc, clickType } = event;
    const room = ROOMS.find(
      (candidate) => candidate.skill === "RANGED" && candidate.channelNpcIds?.has(npcId)
    );
    if (!room) return false;
    const action = npc?.getCurrentDefinition?.(player)?.getActions?.()[clickType - 1];
    if (String(action ?? "").toLowerCase() !== "shoot") return false;
    if (!questActive(player) ||
        quest.getStage(player) < STAGE_DUNGEON ||
        quest.getStage(player) >= STAGE_CHANNELS) {
      return false;
    }
    const owner = npc?.getOwner?.();
    if (owner && owner !== player) return false;
    const rangedWeapon = RangedWeapon.getFor(player);
    if (!rangedWeapon) {
      player.sendMessage("You need a ranged weapon to shoot the target.");
      return false;
    }
    player.getCombat().setRangedWeapon(rangedWeapon);
    player.getCombat().setAmmunition(Ammunition.getFor(player));
    const method = new RangedCombatMethod();
    const ammoRequired = WeaponProfiles.ranged(player).ammoRequired ?? 1;
    if (!CombatFactory.checkAmmo(player, ammoRequired, true)) return false;
    if (!CombatRange.canReach(player, method, npc)) {
      player.sendMessage("You can't reach the target.");
      return false;
    }
    event.handled = true;
    method.start(player, npc);
    clearChannel(player, room);
    return true;
  }

  /**
   * The cache map's dungeon is a set of disconnected pockets, so clearing a
   * channel walks the player onward to the next door (or the lake door) as the
   * wiki's "go through the remaining door" would.
   */
  function moveToNextChannel(player) {
    const next = ROOMS.find((room) => !hasBit(player, room.channelBit));
    player.moveTo(next ? next.approach : LAKE_DOOR_APPROACH_TILE);
  }

  function hasChannelSkill(player, room) {
    const skills = player.getSkillManager();
    if (room.skill === "THIEVING") {
      if (skills.getMaxLevel(Skill.THIEVING) < 37) {
        player.sendMessage("You need a Thieving level of at least 37 to clear this channel.");
        return false;
      }
      return true;
    }
    if (room.skill === "MINING") {
      if (skills.getMaxLevel(Skill.MINING) < 37) {
        player.sendMessage("You need a Mining level of at least 37 to clear this channel.");
        return false;
      }
      if (!mining.findBestPickaxe(player)) {
        player.sendMessage("You need a pickaxe to clear this channel.");
        return false;
      }
      return true;
    }
    if (skills.getMaxLevel(Skill.RANGED) < 37) {
      player.sendMessage("You need a Ranged level of at least 37 to shoot down the target.");
      return false;
    }
    return true;
  }

  // ==========================================================================
  // Crevice, dungeon exit and the statuette
  // ==========================================================================

  function handleObjectInteraction(event) {
    const { player, objectId, clickType } = event;
    const option = String(event.definition?.getActions?.()?.[clickType - 1] ?? "").toLowerCase();
    if (ROOMS.some((room) => room.channelObjectId === objectId) && option === "clear") {
      handleChannelClear(event);
      return;
    }
    if (objectId === CREVICE_OBJECT_ID && option === "climb-down") {
      event.handled = true;
      if (!hasBit(player, BIT_CREVICE_ROPED)) {
        player.sendMessage("You need to tie a rope to the crevice before climbing down.");
        return;
      }
      if (!darkness.hasLightSource(player)) {
        player.sendMessage("It is far too dark in there. I will need a light source.");
        return;
      }
      player.moveTo(CREVICE_FLOOR_TILE);
      return;
    }
    if (objectId === CREVICE_ROPE_OBJECT_ID && option === "climb") {
      event.handled = true;
      player.moveTo(CREVICE_SURFACE_TILE);
      return;
    }
    if (objectId === CAVE_EXIT_OBJECT_ID && option === "leave") {
      event.handled = true;
      player.moveTo(WATERFALL_SURFACE_TILE);
      return;
    }
    if (STATUETTE_OBJECT_IDS.has(objectId) && option === "pray-at") {
      event.handled = true;
      prayAtStatuette(player);
    }
  }

  function prayAtStatuette(player) {
    const skills = player.getSkillManager();
    player.performAnimation(new Animation(645));
    skills.setCurrentLevels(Skill.HITPOINTS, skills.getMaxLevel(Skill.HITPOINTS));
    skills.updateSkill(Skill.HITPOINTS);
    skills.setCurrentLevels(Skill.PRAYER, skills.getMaxLevel(Skill.PRAYER));
    skills.updateSkill(Skill.PRAYER);
    player.sendMessage("You feel Elidinis' blessing restore you.");
  }

  // ==========================================================================
  // Golem deaths
  // ==========================================================================

  /** Only the matching melee style can hurt a guardian golem. */
  function handleGolemHit({ npc, hit }) {
    const weakness = GOLEM_WEAKNESS.get(npc?.getId?.());
    if (!weakness) return;
    if (hit?.getCombatType?.() !== CombatType.MELEE) {
      for (const damage of hit?.getHits?.() ?? []) damage.setDamage(0);
      return;
    }
    const attacker = hit.getAttacker?.();
    const player = attacker?.isPlayer?.() ? attacker.getAsPlayer?.() : null;
    if (player?.getFightType?.()?.getBonusType?.() === weakness.style) return;
    const dealt = hit.getTotalDamage?.() ?? 0;
    for (const damage of hit?.getHits?.() ?? []) damage.setDamage(0);
    if (player && dealt > 0) {
      player.sendMessage(`You can only damage this golem with the ${weakness.name} attack style.`);
    }
  }

  function handleNpcDeath(event) {
    const { killer, npcId } = event;
    if (!killer || !GOLEM_NPC_IDS.has(npcId)) return;
    const room = ROOMS.find((candidate) => candidate.golemNpcId === npcId);
    if (!room) return;
    trackedGolems.delete(golemKeyFor(killer, room));
    if (!questActive(killer)) return;
    setBit(killer, room.golemBit);
    startTranscript(api, killer, npcId, PAGE, "the-waterfall-guardian-golem-after-defeating-a-golem");
  }

  // ==========================================================================
  // Mayor's shoes
  // ==========================================================================

  function nearMayor(player) {
    const location = player.getLocation();
    const world = api.getWorld();
    for (const npc of world.getNpcs()) {
      if (npc?.getId?.() !== AWUSAH_NPC_ID) continue;
      const npcLocation = npc.getLocation();
      if (
        Math.abs(npcLocation.getX() - location.getX()) <= 3 &&
        Math.abs(npcLocation.getY() - location.getY()) <= 3
      ) {
        return true;
      }
    }
    return false;
  }

  function ensureAncestralKey(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_BALLAD || stage >= STAGE_STATUETTE) return;
    if (held(player, ANCESTRAL_KEY_ITEM_ID)) return;
    if (
      itemOnGroundManager.getGroundItem(
        player.getUsername(),
        ANCESTRAL_KEY_ITEM_ID,
        ANCESTRAL_KEY_TILE,
        player.getPrivateArea() ?? null
      )
    ) {
      return;
    }
    itemOnGroundManager.registerLocation(
      player,
      new Item(ANCESTRAL_KEY_ITEM_ID, 1),
      ANCESTRAL_KEY_TILE
    );
  }

  /** The table is out of reach: OSRS requires Telekinetic Grab for the key. */
  function handleTelekineticGrab({ player, itemId }) {
    if (itemId !== ANCESTRAL_KEY_ITEM_ID) return;
    if (quest.getStage(player) < STAGE_KEY) quest.setStage(player, STAGE_KEY);
  }

  function ensureShoes(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_MAYOR || quest.isComplete(player)) return;
    if (held(player, SHOES_ITEM_ID) || held(player, SOLE_ITEM_ID) || held(player, STATUETTE_ITEM_ID)) {
      return;
    }
    if (
      itemOnGroundManager.getGroundItem(
        player.getUsername(),
        SHOES_ITEM_ID,
        SHOES_TILE,
        player.getPrivateArea() ?? null
      )
    ) {
      return;
    }
    itemOnGroundManager.registerLocation(player, new Item(SHOES_ITEM_ID, 1), SHOES_TILE);
  }

  // ==========================================================================
  // Login / world state
  // ==========================================================================

  /** One-time move from the old fabricated 1..8 scale to native stages. */
  function migrateLegacyStage(player) {
    const stage = quest.getStage(player);
    if (stage <= STAGE_NOT_STARTED || stage >= STAGE_STARTED) return;
    const legacy = new Map([
      [1, STAGE_STARTED],
      [2, STAGE_BALLAD],
      [3, STAGE_BALLAD],
      [4, STAGE_CHANNELS],
      [5, STAGE_SPIRITS],
      [6, STAGE_MAYOR],
      [7, STAGE_STATUETTE],
      [8, STAGE_COMPLETE],
    ]);
    const mapped = legacy.get(stage);
    if (mapped !== undefined) quest.setStage(player, mapped);
  }

  function handleLogin({ player }) {
    migrateLegacyStage(player);
    refreshQuestList(player);
    syncVarbits(player);
    ensureAncestralKey(player);
    ensureShoes(player);
  }

  // ==========================================================================
  // Registration
  // ==========================================================================

  api.persistAttribute(BITS_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "spirits_of_the_elid",
    name: "Spirits of the Elid",
    varpId: VARP_SPIRITS_OF_THE_ELID,
    varbitId: VARBIT_STAGE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.PRAYER.getIndex(), amount: 8000, label: "Prayer" },
      { skillId: Skill.THIEVING.getIndex(), amount: 1000, label: "Thieving" },
      { skillId: Skill.MAGIC.getIndex(), amount: 1000, label: "Magic" },
    ],
    scrollItemId: ROBE_TOP_ITEM_ID,
    rewardItemLabel: "Robe of Elidinis",
    otherRewards: [
      "Access to the Elidinis Statuette in Nardah",
      "Access to Nardah's fountain",
    ],
    buildJournal,
    onReward(player) {
      const skills = player.getSkillManager();
      skills.addExperiences(Skill.PRAYER, 8000);
      skills.addExperiences(Skill.THIEVING, 1000);
      skills.addExperiences(Skill.MAGIC, 1000);
    },
  });

  ensureDungeonExit();

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onCustomEvent("npc-dialogue:choice", handleDialogueChoice);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("door:toggle", handleDoorToggle);
  api.onCustomEvent("magic:telekinetic-grab", handleTelekineticGrab);
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onGroundItemPickup(handleGroundItemPickup);
  api.onObjectRoute(handleObjectRoute);
  api.onObjectInteraction(handleObjectInteraction);
  api.onNpcRoute(handleRangingTargetRoute);
  api.onNpcInteraction(handleRangingTarget);
  api.onObjectInteraction("Cupboard", {
    Open: openCupboard,
    Search: searchCupboard,
    Shut: shutCupboard,
  });
  api.onNpcDeath(handleNpcDeath);
  api.onNpcHitModify(handleGolemHit);
  api.onNpcInteraction("Habibah", { "Talk-to": talkToChatter });
  api.onNpcInteraction("Meskhenet", { "Talk-to": talkToChatter });
  api.onNpcInteraction("Zahra", { "Talk-to": talkToChatter });
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleTransitionInterrupted);
  api.onPlayerDeath(handleTransitionInterrupted);
};
