/**
 * The Curse of Arrav (members).
 *
 * The words come from the "The Curse of Arrav" transcript page; this plugin
 * supplies the variant selector for Elias White (12610), the start hook, the
 * prose-condition answers for the lever/key sequence, the skeleton loot, the
 * canopic-jar chain, the fort/tapestry hand-in, the base infiltration and the
 * heart cutscene that completes the quest.
 *
 * Stage (varbit 11479 "coa", in varp 4498 "coa_primary"):
 *   0  not started            2  accepted the quest (start hook)
 *   4  entered the Uzer Mastaba (Entry 50201)
 *   6  first lever pulled      8  both levers pulled (imposing doors unlocked)
 *   10 golem guard defeated    12 reached the mastaba lower level
 *   14 canopic jar (oil) found 16 canopic jar filled (3 dwellberries + ring)
 *   18 showed the jar to Elias in the oasis
 *   20 entered the Trollweiss tunnels (rubble-mining stages 22-28 skipped)
 *   30 climbed into Zemouregal's Fort
 *   32 spoke to Arrav         34 searched the flame tapestry
 *   38 gave the plans to Elias (heist briefing)  42 Elias departs for the base
 *   44 met Elias outside the base (chose "Ready when you are.")
 *   46 opened the code chest  48 opened the vault's metal doors
 *   50 grappled over the fire traps
 *   52 took Arrav's heart (cutscene)  58 complete
 *
 * The stage values and the two mastaba-lever varbits (11481 north / 11482 south,
 * also from varp 4498) match QuestHelper's live mapping of the same `coa`
 * varbit; the values are the OSRS quest's own, not this server's invention.
 *
 * Source: OSRS Wiki (The Curse of Arrav, Transcript:The Curse of Arrav,
 * Transcript:The Curse of Arrav/Journal); ids from the cache gameval dump:
 * items 30308-30317, NPCs 12610/14125/14129, objects 50201-50211, 50348-50353,
 * 50508-50543, 55779-55796, varp 4498 / varbits 11479-11483.
 *
 * Gaps / approximations (no instance, mining, interface or transform support):
 * - the mastaba lever locs are placed without actions (50203/50204), so they are
 *   replaced with the pull-able lever (50205) at login; the pulled model and the
 *   per-player varbit transforms are not simulated, only the real varbits sent;
 * - the floor-tile puzzle and its disable lever (55784, no actions) are not
 *   simulated - the crossing is walked normally (levels 20-28 are compressed:
 *   the tunnel Cave 55779 is registered at the closed entrance 50583 and moves
 *   the player straight to the fort cellar, skipping the rubble maze);
 * - the base trapdoor is registered (50689 is placed with no actions) and the
 *   sewer maze is compressed: the kitchen Pipe 50523 crosses straight to the
 *   storage area, so the vault doors, grapple pipes and pedestal are reachable;
 * - the Arrav fight and the vault-code interface are not fought/solved: the
 *   pedestal plays the full taking-the-heart + escape transcript in one go;
 * - the junk-skeleton variants and the east/west mural ids are placed by the
 *   wiki's wording, which names no coordinates - QuestHelper only fixes the two
 *   key skeletons (50350, 50353) and the south mural (55790), which are used;
 * - quest requirement checks (Defender of Varrock, Troll Romance, the listed
 *   skills) are not enforced here; members gating is the quest list's job.
 */
module.exports = function registerCurseOfArravQuest(api) {
  const {
    Location,
    GameObject,
    MapObjects,
    ObjectManager,
    RegionManager,
    Skill,
    ItemIdentifiers,
    NpcIdentifiers,
    ObjectIdentifiers,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript, loadTranscripts } = require("../QuestRuntime");

  const PAGE = "The Curse of Arrav";
  const START_HOOK = "quest:the-curse-of-arrav:start";

  const VARP_COA = 4498; // "coa_primary"
  const VARBIT_COA = 11479; // "coa"
  const VARBIT_LEVER_NORTH = 11481; // "coa_mastaba_lever_1"
  const VARBIT_LEVER_SOUTH = 11482; // "coa_mastaba_lever_2"

  const STAGE_NOT_STARTED = 0;
  const STAGE_STARTED = 2;
  const STAGE_ENTERED_TOMB = 4;
  const STAGE_ONE_LEVER = 6;
  const STAGE_DOORS_OPEN = 8;
  const STAGE_GOLEM_DEAD = 10;
  const STAGE_LOWER_TOMB = 12;
  const STAGE_JAR_TAKEN = 14;
  const STAGE_JAR_FILLED = 16;
  const STAGE_JAR_SHOWN = 18;
  const STAGE_IN_TUNNELS = 20;
  const STAGE_AT_FORT = 30;
  const STAGE_ARRAV_MET = 32;
  const STAGE_TAPESTRY_SEARCHED = 34;
  const STAGE_PLANS_GIVEN = 38;
  const STAGE_ELIAS_DEPARTS = 42;
  const STAGE_MET_AT_BASE = 44;
  const STAGE_CODE_KEY_TAKEN = 46;
  const STAGE_METAL_DOORS_OPEN = 48;
  const STAGE_GRAPPLED = 50;
  const STAGE_HEART_TAKEN = 52;
  const STAGE_COMPLETE = 58;

  const ELIAS_NPC_ID = NpcIdentifiers.ELIAS_WHITE; // 12610, indexed to the COA page
  const ARRAV_NPC_ID = NpcIdentifiers.ARRAV_3; // 14129 "Arrav", Talk-to
  const GOLEM_GUARD_NPC_ID = NpcIdentifiers.GOLEM_GUARD; // 14125, combat 141
  const ZEMOUREGAL_NPC_ID = NpcIdentifiers.ZEMOUREGAL; // 12614, chathead for the cutscene

  const DWELLBERRIES_ITEM_ID = ItemIdentifiers.DWELLBERRIES; // 2126
  const RING_OF_LIFE_ITEM_ID = ItemIdentifiers.RING_OF_LIFE; // 2570
  const MASTABA_KEY_ITEM_ID = ItemIdentifiers.MASTABA_KEY; // 30308 (north lever)
  const MASTABA_KEY_2_ITEM_ID = ItemIdentifiers.MASTABA_KEY_2; // 30309 (south lever)
  const BASE_PLANS_ITEM_ID = ItemIdentifiers.BASE_PLANS; // 30310
  const BASE_KEY_ITEM_ID = ItemIdentifiers.BASE_KEY; // 30311
  const CANOPIC_JAR_OIL_ITEM_ID = ItemIdentifiers.CANOPIC_JAR_OIL_; // 30312
  const CANOPIC_JAR_BERRIES_ITEM_ID = ItemIdentifiers.CANOPIC_JAR_OIL_AND_BERRIES_; // 30313
  const CANOPIC_JAR_FULL_ITEM_ID = ItemIdentifiers.CANOPIC_JAR_FULL_; // 30314
  const CODE_KEY_ITEM_ID = ItemIdentifiers.CODE_KEY; // 30316
  const DECODER_STRIPS_ITEM_ID = ItemIdentifiers.DECODER_STRIPS; // 30317

  // The two placed levers have no actions (null ids 50203 north / 50204 south); the
  // pull-able loc is 50205. No identifiers are generated for the actionless pair.
  const PLACED_NORTH_LEVER_OBJECT_ID = 50203;
  const PLACED_SOUTH_LEVER_OBJECT_ID = 50204;
  const LEVER_OBJECT_ID = ObjectIdentifiers.LEVER_68; // 50205, "Lever" Pull
  const TUNNEL_ENTRANCE_CLOSED_OBJECT_ID = 50583; // placed 4x4 "null", no actions
  const BASE_TRAPDOOR_CLOSED_OBJECT_ID = 50689; // placed "null", no actions

  // 50201 Entry and 50202 Stairs are in LocTeleports' captured data already.
  const IMPOSING_DOORS_OBJECT_ID = ObjectIdentifiers.IMPOSING_DOORS_4; // 50211 Open
  const TUNNEL_CAVE_OBJECT_ID = ObjectIdentifiers.CAVE_117; // 55779 Enter, registered at the entrance
  const SKELETON_OBJECT_IDS = new Map([
    [ObjectIdentifiers.SKELETON_134, "tomb-raiding-searching-the-skeleton-by-the-dais"], // 50348
    [ObjectIdentifiers.SKELETON_135, "tomb-raiding-searching-the-skeleton-by-the-entrance-of-the-room-with-the-boat"], // 50349
    [ObjectIdentifiers.SKELETON_136, "tomb-raiding-searching-the-south-skeleton-in-the-tunnel"], // 50350, first key
    [ObjectIdentifiers.SKELETON_137, "tomb-raiding-searching-the-skeleton-south-of-the-boat"], // 50351
    [ObjectIdentifiers.SKELETON_138, "tomb-raiding-searching-the-north-skeleton-in-the-tunnel"], // 50352
    [ObjectIdentifiers.SKELETON_139, "tomb-raiding-searching-the-skeleton-by-the-boat"], // 50353, second key
  ]);
  const SHELVES_OBJECT_ID = ObjectIdentifiers.SHELVES_164; // 55796 Search
  const MURAL_OBJECT_IDS = new Map([
    [ObjectIdentifiers.MURAL_10, "tomb-raiding-inspecting-the-east-mural"], // 55787
    [ObjectIdentifiers.MURAL_13, "tomb-raiding-inspecting-the-south-mural"], // 55790, the recipe
    [ObjectIdentifiers.MURAL_16, "tomb-raiding-inspecting-the-west-mural"], // 55793
  ]);
  const FORT_STAIRS_OBJECT_ID = ObjectIdentifiers.STAIRS_264; // 50508 Climb-up (cellar -> fort)
  const FORT_DOOR_OBJECT_ID = ObjectIdentifiers.DOOR_702; // 50514 Open, into the tapestry room
  const TAPESTRY_OBJECT_ID = ObjectIdentifiers.TAPESTRY_3; // 50516 Search
  const BASE_GATE_OBJECT_ID = ObjectIdentifiers.GATE_293; // 50537 Open, needs the base key
  const BASE_INNER_DOOR_OBJECT_ID = ObjectIdentifiers.DOOR_704; // 50529 Open, needs the base key
  const KITCHEN_PIPE_OBJECT_ID = ObjectIdentifiers.PIPE_27; // 50523 Squeeze-through
  const STORAGE_TABLE_IDS = new Set([
    ObjectIdentifiers.TABLE_405, // 50532
    ObjectIdentifiers.TABLE_406, // 50533, decoder strips
    ObjectIdentifiers.TABLE_407, // 50534
  ]);
  const STORAGE_CHEST_OBJECT_ID = ObjectIdentifiers.CHEST_237; // 50530 Open
  const METAL_DOORS_OBJECT_IDS = new Set([
    ObjectIdentifiers.METAL_DOORS, // 50517
    ObjectIdentifiers.METAL_DOORS_2, // 50518
  ]);
  const GRAPPLE_PIPE_OBJECT_IDS = new Set([
    ObjectIdentifiers.PIPE_31, // 50542 (west side)
    ObjectIdentifiers.PIPE_32, // 50543 (east side)
  ]);
  const PEDESTAL_OBJECT_ID = ObjectIdentifiers.PEDESTAL_28; // 50539 Take-from
  // The map places the actionless 2x2 pedestal 50538 (no identifier is generated for
  // it); the coa varbit swaps it to 50539, whose definition carries "Take-from".
  const HEART_PEDESTAL_OBJECT_ID = 50538;
  const BASE_TRAPDOOR_OPEN_OBJECT_ID = ObjectIdentifiers.TRAPDOOR_101; // 50142 Enter
  const BASE_TRAPDOOR_OPEN_REPLACEMENT_ID = ObjectIdentifiers.TRAPDOOR_100; // 50141 Open

  const BITS_ATTRIBUTE = "quest.curse_of_arrav.bits";
  const BIT_KEY_1_LOOTED = 1 << 0;
  const BIT_KEY_2_LOOTED = 1 << 1;
  const BIT_JAR_TAKEN = 1 << 2;
  const BIT_RECIPE_LEARNED = 1 << 3;
  const BIT_CODE_KEY_TAKEN = 1 << 4;
  const BIT_BASE_KEY_USED = 1 << 5;
  const BIT_TABLE_NOTES = 1 << 6;
  const BIT_LEVER_NORTH_PULLED = 1 << 7;
  const BIT_LEVER_SOUTH_PULLED = 1 << 8;

  const BASE_ELIAS_TILE = { x: 3341, y: 3516 };
  const OASIS_ELIAS_TILE = { x: 3505, y: 3037 };
  const FORT_ARRAV_TILE = { x: 2856, y: 3871 };
  const GOLEM_TILE = { x: 3865, y: 4595 };
  const BASE_INTERIOR_LANDING = { x: 3560, y: 4552 };
  const TUNNEL_CELLAR_LANDING = { x: 2811, y: 10266 };
  const FORT_LANDING = { x: 2850, y: 3871 };
  const STORAGE_LANDING = { x: 3613, y: 4568 };
  const GRAPPLE_LANDING = { x: 3627, y: 4582 };

  const LOWER_TOMB_ZONE = { minX: 3719, maxX: 3900, minY: 4674, maxY: 4732, levels: [0] };
  const MASTABA_ZONE = { minX: 3842, maxX: 3900, minY: 4547, maxY: 4603, levels: [0] };

  // Condition ids on the "The Curse of Arrav" page (gameplay prose branches).
  const CONDITION_LEVER_NO_KEY = "2cxLE0";
  const CONDITION_LEVER_WRONG_KEY = "xQ4fBc";
  const CONDITION_LEVER_RIGHT_KEY = "_xW2b5";
  const CONDITION_LEVER_USED = "Bc9dvD";
  const CONDITION_NO_LEVER_YET = "2yJM4V";
  const CONDITION_ONE_LEVER = "5aaE38";
  const CONDITION_TAPESTRY_NO_ROOM = "T2jv3H";
  const CONDITION_TAPESTRY_ROOM = "Tc9jJ8";
  const CONDITION_LOST_JAR = "pKHmJR";
  const CONDITION_HAS_JAR = "6bQt1o";
  const CONDITION_LOST_JAR_AGAIN = "8K0dI7";
  const CONDITION_HAS_JAR_AGAIN = "P9txhe";
  const CONDITION_NOT_ENTERED_TOMB = "lVsGF3";
  const CONDITION_ENTERED_TOMB = "QXZXpt";
  const CONDITION_LEARNED_RECIPE = "L54m1t";
  const CONDITION_JAR_EMPTY = "qRYEJO";
  const CONDITION_JAR_PARTIAL = "2_tSJQ";
  const CONDITION_ARRAV_DOOR_ATTEMPT = "xAKtDX";

  const CONDITION_IDS = new Set([
    CONDITION_LEVER_NO_KEY,
    CONDITION_LEVER_WRONG_KEY,
    CONDITION_LEVER_RIGHT_KEY,
    CONDITION_LEVER_USED,
    CONDITION_NO_LEVER_YET,
    CONDITION_ONE_LEVER,
    CONDITION_TAPESTRY_NO_ROOM,
    CONDITION_TAPESTRY_ROOM,
    CONDITION_LOST_JAR,
    CONDITION_HAS_JAR,
    CONDITION_LOST_JAR_AGAIN,
    CONDITION_HAS_JAR_AGAIN,
    CONDITION_NOT_ENTERED_TOMB,
    CONDITION_ENTERED_TOMB,
    CONDITION_LEARNED_RECIPE,
    CONDITION_JAR_EMPTY,
    CONDITION_JAR_PARTIAL,
    CONDITION_ARRAV_DOOR_ATTEMPT,
  ]);

  // Action / message step ids.
  const ACTION_LEVER_FIRST_PULL = "dXNfnD"; // "You pull the lever."
  const ACTION_LEVER_SECOND_PULL = "TfZ1WT"; // "...hear a click..."
  const ACTION_JAR_FOUND = "rMlrad"; // "You search the shelves and find an oil-filled canopic jar."
  const ACTION_RECIPE_MURAL = "BPu3RX"; // the dwellberries/ring diagram
  const ACTION_JAR_SHOWN = "uv7vDM"; // "You show the canopic jar to Elias."
  const ACTION_PLANS_GIVEN = "oRUl9x"; // "You give the plans to Elias."
  const ACTION_ELIAS_DEPARTS = "Umb_at"; // "Elias departs."
  const ACTION_TAPESTRY_FOUND = "wLnYFS"; // "You find some plans and a key behind the tapestry."
  const ACTION_JAR_GIFT_BASE = "Gkvvt9"; // "Elias gives you a canopic jar."
  const ACTION_JAR_GIFT_AGAIN = "4QJiv7"; // "Elias gives you a canopic jar."
  const ACTION_NOTES_FOUND = "4cfDVS"; // notes on the east table
  const ACTION_CODE_KEY_FOUND = "g3M02d"; // "You unlock the chest and find a code key inside."
  const ACTION_QUEST_COMPLETE = "zKzGTb"; // "Congratulations! Quest complete!"

  const ACTION_IDS = new Set([
    ACTION_LEVER_FIRST_PULL,
    ACTION_LEVER_SECOND_PULL,
    ACTION_JAR_FOUND,
    ACTION_RECIPE_MURAL,
    ACTION_JAR_SHOWN,
    ACTION_PLANS_GIVEN,
    ACTION_ELIAS_DEPARTS,
    ACTION_TAPESTRY_FOUND,
    ACTION_JAR_GIFT_BASE,
    ACTION_JAR_GIFT_AGAIN,
    ACTION_NOTES_FOUND,
    ACTION_CODE_KEY_FOUND,
    ACTION_QUEST_COMPLETE,
  ]);
  const PAGE_NPC_IDS = new Set([ELIAS_NPC_ID, ARRAV_NPC_ID, GOLEM_GUARD_NPC_ID, ZEMOUREGAL_NPC_ID]);

  const CUTSCENE_VARIANT = "heart-heist-taking-the-heart";
  const CUTSCENE_END_VARIANT = "heart-heist-escaping-and-finishing-up";

  let quest;
  let worldInstalled = false;
  const baseEliasByPlayer = new Map();
  const leverContext = new WeakMap();

  // ==========================================================================
  // Small helpers
  // ==========================================================================

  function held(player, itemId, amount = 1) {
    return player.getInventory().getAmount(itemId) >= amount;
  }

  function bits(player) {
    return Number(player.getAttribute(BITS_ATTRIBUTE)) || 0;
  }

  function hasBit(player, bit) {
    return (bits(player) & bit) !== 0;
  }

  function setBit(player, bit) {
    player.setAttribute(BITS_ATTRIBUTE, bits(player) | bit);
  }

  function questActive(player) {
    return quest.getStage(player) >= STAGE_STARTED && !quest.isComplete(player);
  }

  /** Never rewinds a quest; milestones can be reached out of order. */
  function ensureStage(player, value) {
    if (quest.getStage(player) < value && !quest.isComplete(player)) {
      quest.setStage(player, value);
    }
  }

  function objectTile(event) {
    const location = event.location ?? event.object?.getLocation?.();
    return location ? { x: location.x ?? location.getX?.(), y: location.y ?? location.getY?.(), z: location.z ?? location.getZ?.() } : null;
  }

  /** Mirror the player to the first free tile on the far side of an object. */
  function stepAcross(player, location) {
    const current = player.getLocation();
    const dx = current.getX() - location.x;
    const dy = current.getY() - location.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
      const step = dx >= 0 ? -1 : 1;
      for (let n = 1; n <= 3; n++) {
        const tile = new Location(location.x + step * n, current.getY(), current.getZ());
        if (!RegionManager.blocked(tile, null)) {
          player.moveTo(tile);
          return true;
        }
      }
      return false;
    }
    const step = dy >= 0 ? -1 : 1;
    for (let n = 1; n <= 3; n++) {
      const tile = new Location(current.getX(), location.y + step * n, current.getZ());
      if (!RegionManager.blocked(tile, null)) {
        player.moveTo(tile);
        return true;
      }
    }
    return false;
  }

  /** Mirror the player one tile past a blocking object (ClockTower's step-through). */
  function stepThrough(player, location) {
    const current = player.getLocation();
    const dx = current.getX() - location.x;
    const dy = current.getY() - location.y;
    const destination =
      Math.abs(dx) >= Math.abs(dy)
        ? new Location(location.x - (dx >= 0 ? 1 : -1), location.y, current.getZ())
        : new Location(location.x, location.y - (dy >= 0 ? 1 : -1), current.getZ());
    player.moveTo(destination);
  }

  function startPageTranscript(player, variant, npcId = GOLEM_GUARD_NPC_ID) {
    return startTranscript(api, player, npcId, PAGE, variant);
  }

  // ==========================================================================
  // World install: levers, tunnel entrance, base trapdoor, quest NPCs
  // ==========================================================================

  function replacePlacedObject(baseId, x, y, newId, type, face) {
    const location = new Location(x, y, 0);
    const base = MapObjects.get(baseId, location.clone(), null);
    if (base) {
      ObjectManager.deregister(base, true);
    }
    ObjectManager.register(new GameObject(newId, location, type, face, null), true);
  }

  function spawnIfMissing(id, tile, wanderRadius = 0) {
    const world = api.getWorld?.();
    const npcs = world?.getNpcs ? [...world.getNpcs()] : [];
    const present = npcs.some((npc) => {
      if (npc?.getId?.() !== id) return false;
      const location = npc.getLocation();
      return Math.abs(location.getX() - tile.x) < 12 && Math.abs(location.getY() - tile.y) < 12;
    });
    if (present) return;
    api.spawnNpc({ id, x: tile.x, y: tile.y, z: 0, wanderRadius });
  }

  function installWorld() {
    if (worldInstalled) return;
    worldInstalled = true;
    // The placed levers (50203/50204) and entrances carry no actions in this cache;
    // put the working locs on their tiles (LocTeleports handles the rest).
    replacePlacedObject(PLACED_NORTH_LEVER_OBJECT_ID, 3894, 4598, LEVER_OBJECT_ID, 4, 2);
    replacePlacedObject(PLACED_SOUTH_LEVER_OBJECT_ID, 3894, 4553, LEVER_OBJECT_ID, 4, 2);
    replacePlacedObject(TUNNEL_ENTRANCE_CLOSED_OBJECT_ID, 2808, 3860, TUNNEL_CAVE_OBJECT_ID, 10, 1);
    replacePlacedObject(BASE_TRAPDOOR_CLOSED_OBJECT_ID, 3343, 3515, BASE_TRAPDOOR_OPEN_REPLACEMENT_ID, 10, 1);
    spawnIfMissing(ELIAS_NPC_ID, OASIS_ELIAS_TILE);
    spawnIfMissing(ARRAV_NPC_ID, FORT_ARRAV_TILE);
    spawnIfMissing(GOLEM_GUARD_NPC_ID, GOLEM_TILE);
  }

  /** The base Elias exists only for players on the heist (QuestHelper's stage 42+). */
  function syncBaseElias(player) {
    const wanted = quest.getStage(player) >= STAGE_ELIAS_DEPARTS && !quest.isComplete(player);
    const existing = baseEliasByPlayer.get(player);
    if (wanted && !existing) {
      const npc = api.spawnNpc({
        id: ELIAS_NPC_ID,
        x: BASE_ELIAS_TILE.x,
        y: BASE_ELIAS_TILE.y,
        z: 0,
        wanderRadius: 0,
        owner: player,
        ownerOnly: true,
      });
      if (npc) baseEliasByPlayer.set(player, npc);
      return;
    }
    if (!wanted && existing) {
      api.removeNpc(existing);
      baseEliasByPlayer.delete(player);
    }
  }

  function sendLeverVarbits(player) {
    const sender = player.getPacketSender();
    sender.sendVarbit(VARBIT_LEVER_NORTH, hasBit(player, BIT_LEVER_NORTH_PULLED) ? 2 : 0);
    sender.sendVarbit(VARBIT_LEVER_SOUTH, hasBit(player, BIT_LEVER_SOUTH_PULLED) ? 2 : 0);
  }

  // ==========================================================================
  // Journal
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I spoke to Elias White in the Uzer Oasis and agreed to help",
        "<str>free Arrav from Zemouregal by recovering his Heart.</str>",
        "<str>I prepared a Canopic Jar in the Uzer Mastaba and tracked",
        "<str>Arrav's Heart to Zemouregal's Base, where Elias and I",
        "<str>stole it back from under Zemouregal's nose.</str>",
        "<str>Elias took the Heart to research how to free Arrav, and",
        "<str>promised to contact me once he had made progress.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_MET_AT_BASE) {
      return [
        "<str>I spoke to Elias White in the Uzer Oasis and agreed to help</str>",
        "<str>free Arrav from Zemouregal by recovering his Heart.</str>",
        "<str>I prepared a Canopic Jar and followed the plans to</str>",
        "<str>Zemouregal's Base in Silvarea.</str>",
        "",
        "I infiltrated <col=800000>Zemouregal's Base</col> with <col=800000>Elias'</col> help.",
        "I should recover <col=800000>Arrav's Heart</col> from the vault.",
      ];
    }
    if (stage >= STAGE_PLANS_GIVEN) {
      return [
        "<str>I recovered a Canopic Jar in the Uzer Mastaba and</str>",
        "<str>followed the plans from Zemouregal's Fort.</str>",
        "",
        "<col=800000>Elias</col> and I inspected the <col=800000>Plans</col> and formed a plan",
        "to steal <col=800000>Arrav's Heart</col>. I need insulated protection, a",
        "<col=800000>Crossbow</col>, a <col=800000>Grappling Hook</col>, the <col=800000>Canopic Jar</col> and the",
        "<col=800000>Base key</col>, then meet <col=800000>Elias</col> outside the base.",
      ];
    }
    if (stage >= STAGE_TAPESTRY_SEARCHED) {
      return [
        "<str>I entered the tunnels from the peak of Trollweiss Mountain</str>",
        "<str>and found a way through them into Zemouregal's Fort.</str>",
        "",
        "Inside the <col=800000>Fort</col> I met <col=800000>Arrav</col>. Before he was called",
        "away, he directed me to the <col=800000>Plans</col> hidden behind the",
        "<col=800000>Tapestry</col>. I should take them to <col=800000>Elias</col>.",
      ];
    }
    if (stage >= STAGE_AT_FORT) {
      return [
        "<str>I prepared a Canopic Jar from the Mastaba.</str>",
        "",
        "According to <col=800000>Elias'</col> contact, <col=800000>Zemouregal</col> was seen at a",
        "<col=800000>Fort</col> near <col=800000>Trollweiss Mountain</col>. I entered its tunnels",
        "and should explore the <col=800000>Fort</col>.",
      ];
    }
    if (stage >= STAGE_JAR_SHOWN) {
      return [
        "<str>Following Elias' suggestion, I entered the Mastaba in the</str>",
        "<str>Uzer Oasis and found how to preserve Arrav's Heart.</str>",
        "",
        "I showed the filled <col=800000>Canopic Jar</col> to <col=800000>Elias</col>. One of his",
        "contacts saw <col=800000>Zemouregal</col> entering a <col=800000>Fort</col> near",
        "<col=800000>Trollweiss Mountain</col>; I can reach it through tunnels on the peak.",
      ];
    }
    if (stage >= STAGE_JAR_FILLED) {
      return [
        "<str>I entered the Mastaba in the Uzer Oasis and found how to</str>",
        "<str>preserve Arrav's Heart.</str>",
        "",
        "I filled the <col=800000>Canopic Jar</col> with three <col=800000>Dwellberries</col> and a",
        "<col=800000>Ring of Life</col>. I should return to <col=800000>Elias</col> in the Uzer Oasis.",
      ];
    }
    if (stage >= STAGE_ENTERED_TOMB) {
      return [
        "<str>I spoke to Elias White in the Uzer Oasis. He asked for my</str>",
        "<str>help in freeing Arrav from Zemouregal by recovering his Heart.</str>",
        "",
        "Elias reckons the <col=800000>Mastaba</col> in the Uzer Oasis holds the",
        "knowledge to preserve the Heart. I should search it and find",
        "a way to keep the Heart beating.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "I spoke to <col=800000>Elias White</col> in the <col=800000>Uzer Oasis</col>. He asked",
        "for my help in freeing <col=800000>Arrav</col> from <col=800000>Zemouregal</col>.",
        "I should speak to him again and see how I can help.",
      ];
    }
    return [
      "I can start this quest by talking to <col=800000>Elias White</col> in the",
      "<col=800000>Uzer Oasis</col>.",
    ];
  }

  function grantReward(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.MINING, 40000);
    skills.addExperiences(Skill.THIEVING, 40000);
    skills.addExperiences(Skill.AGILITY, 40000);
  }

  // ==========================================================================
  // Dialogue: variant, conditions, choices
  // ==========================================================================

  function atBase(player) {
    const location = player.getLocation();
    return Math.abs(location.getX() - BASE_ELIAS_TILE.x) <= 10 && Math.abs(location.getY() - BASE_ELIAS_TILE.y) <= 10;
  }

  /** Which Elias conversation this stage plays (npc 12610 is indexed to the page). */
  function selectVariant(event) {
    const { npcId, player } = event;
    if (npcId !== ELIAS_NPC_ID || !player) return null;
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return atBase(player) ? "heart-heist-talking-to-elias-again" : "fort-invasion-talking-to-elias-again";
    }
    if (stage === STAGE_NOT_STARTED) return "starting-the-quest";
    if (stage < STAGE_JAR_SHOWN) {
      if (stage >= STAGE_JAR_FILLED && held(player, CANOPIC_JAR_FULL_ITEM_ID)) {
        return "fort-invasion-talking-to-elias";
      }
      return "tomb-raiding-talking-to-elias-again";
    }
    if (stage < STAGE_TAPESTRY_SEARCHED) return "fort-invasion-talking-to-elias-again";
    if (stage < STAGE_ELIAS_DEPARTS) return "heart-heist-talking-to-elias";
    if (atBase(player)) {
      return stage >= STAGE_MET_AT_BASE
        ? "heart-heist-talking-to-elias-again"
        : "heart-heist-meeting-elias-at-the-base";
    }
    return "fort-invasion-talking-to-elias-again";
  }

  function leverOf(event) {
    const tile = objectTile(event);
    return tile && tile.y >= 4570 ? "north" : "south";
  }

  function leverKeyed(player, which) {
    return which === "north" ? hasBit(player, BIT_LEVER_NORTH_PULLED) : hasBit(player, BIT_LEVER_SOUTH_PULLED);
  }

  function pulledLevers(player) {
    let count = 0;
    if (hasBit(player, BIT_LEVER_NORTH_PULLED)) count++;
    if (hasBit(player, BIT_LEVER_SOUTH_PULLED)) count++;
    return count;
  }

  function answerCondition(event) {
    const { player, stepId } = event;
    if (!player || !CONDITION_IDS.has(stepId)) return null;
    const stage = quest.getStage(player);
    switch (stepId) {
      // Elias, tomb raiding
      case CONDITION_NOT_ENTERED_TOMB:
        return stage < STAGE_ENTERED_TOMB;
      case CONDITION_ENTERED_TOMB:
        // The learned-recipe branch (L54m1t) comes after this one and wins when it is true.
        return stage >= STAGE_ENTERED_TOMB && !hasBit(player, BIT_RECIPE_LEARNED);
      case CONDITION_LEARNED_RECIPE:
        return hasBit(player, BIT_RECIPE_LEARNED);
      case CONDITION_JAR_EMPTY:
        return !held(player, CANOPIC_JAR_BERRIES_ITEM_ID) && !held(player, CANOPIC_JAR_FULL_ITEM_ID);
      case CONDITION_JAR_PARTIAL:
        return held(player, CANOPIC_JAR_BERRIES_ITEM_ID) || held(player, CANOPIC_JAR_FULL_ITEM_ID);
      // The mastaba levers
      case CONDITION_LEVER_NO_KEY: {
        const which = leverContext.get(player);
        if (!which) return null;
        if (leverKeyed(player, which)) return false;
        return !held(player, MASTABA_KEY_ITEM_ID) && !held(player, MASTABA_KEY_2_ITEM_ID);
      }
      case CONDITION_LEVER_WRONG_KEY: {
        const which = leverContext.get(player);
        if (!which) return null;
        if (leverKeyed(player, which)) return false;
        const needed = which === "north" ? MASTABA_KEY_ITEM_ID : MASTABA_KEY_2_ITEM_ID;
        const other = which === "north" ? MASTABA_KEY_2_ITEM_ID : MASTABA_KEY_ITEM_ID;
        return !held(player, needed) && held(player, other);
      }
      case CONDITION_LEVER_RIGHT_KEY: {
        const which = leverContext.get(player);
        if (!which) return null;
        if (leverKeyed(player, which)) return false;
        const needed = which === "north" ? MASTABA_KEY_ITEM_ID : MASTABA_KEY_2_ITEM_ID;
        return held(player, needed);
      }
      case CONDITION_LEVER_USED: {
        const which = leverContext.get(player);
        return which ? leverKeyed(player, which) : null;
      }
      case CONDITION_NO_LEVER_YET:
        return pulledLevers(player) === 0;
      case CONDITION_ONE_LEVER:
        return pulledLevers(player) === 1;
      // Tapestry
      case CONDITION_TAPESTRY_NO_ROOM:
        return player.getInventory().getFreeSlots() < 2;
      case CONDITION_TAPESTRY_ROOM:
        return player.getInventory().getFreeSlots() >= 2;
      // Elias at the base
      case CONDITION_LOST_JAR:
      case CONDITION_LOST_JAR_AGAIN:
        return !held(player, CANOPIC_JAR_FULL_ITEM_ID);
      case CONDITION_HAS_JAR:
      case CONDITION_HAS_JAR_AGAIN:
        return held(player, CANOPIC_JAR_FULL_ITEM_ID);
      // Arrav's "east door before talking" prelude
      case CONDITION_ARRAV_DOOR_ATTEMPT:
        return false;
      default:
        return null;
    }
  }

  function handleDialogueHook(event) {
    if (event.hook !== START_HOOK || event.npcId !== ELIAS_NPC_ID) return;
    ensureStage(event.player, STAGE_STARTED);
  }

  function handleDialogueChoice(event) {
    if (event.npcId !== ELIAS_NPC_ID) return;
    if (event.option !== "Ready when you are.") return;
    ensureStage(event.player, STAGE_MET_AT_BASE);
  }

  function handleDialogueAction(event) {
    const { player, stepId, npcId } = event;
    if (!player || !ACTION_IDS.has(stepId)) return;
    if (npcId !== undefined && !PAGE_NPC_IDS.has(npcId)) return;
    switch (stepId) {
      case ACTION_LEVER_FIRST_PULL:
      case ACTION_LEVER_SECOND_PULL: {
        const which = leverContext.get(player);
        if (!which) return;
        if (leverKeyed(player, which)) return; // already turned this key
        const keyId = which === "north" ? MASTABA_KEY_ITEM_ID : MASTABA_KEY_2_ITEM_ID;
        if (!held(player, keyId)) return;
        player.getInventory().deleteNumber(keyId, 1);
        if (which === "north") {
          setBit(player, BIT_LEVER_NORTH_PULLED);
          player.getPacketSender().sendVarbit(VARBIT_LEVER_NORTH, 2);
        } else {
          setBit(player, BIT_LEVER_SOUTH_PULLED);
          player.getPacketSender().sendVarbit(VARBIT_LEVER_SOUTH, 2);
        }
        ensureStage(player, pulledLevers(player) >= 2 ? STAGE_DOORS_OPEN : STAGE_ONE_LEVER);
        return;
      }
      case ACTION_JAR_FOUND:
        if (hasBit(player, BIT_JAR_TAKEN) || held(player, CANOPIC_JAR_OIL_ITEM_ID)) return;
        setBit(player, BIT_JAR_TAKEN);
        player.getInventory().adds(CANOPIC_JAR_OIL_ITEM_ID, 1);
        ensureStage(player, STAGE_JAR_TAKEN);
        return;
      case ACTION_RECIPE_MURAL:
        setBit(player, BIT_RECIPE_LEARNED);
        return;
      case ACTION_JAR_SHOWN:
        ensureStage(player, STAGE_JAR_SHOWN);
        return;
      case ACTION_PLANS_GIVEN:
        if (held(player, BASE_PLANS_ITEM_ID)) player.getInventory().deleteNumber(BASE_PLANS_ITEM_ID, 1);
        ensureStage(player, STAGE_PLANS_GIVEN);
        return;
      case ACTION_ELIAS_DEPARTS:
        ensureStage(player, STAGE_ELIAS_DEPARTS);
        return;
      case ACTION_TAPESTRY_FOUND:
        if (!hasBit(player, BIT_BASE_KEY_USED) && !held(player, BASE_KEY_ITEM_ID)) {
          player.getInventory().adds(BASE_KEY_ITEM_ID, 1);
        }
        if (!held(player, BASE_PLANS_ITEM_ID)) player.getInventory().adds(BASE_PLANS_ITEM_ID, 1);
        ensureStage(player, STAGE_TAPESTRY_SEARCHED);
        return;
      case ACTION_JAR_GIFT_BASE:
      case ACTION_JAR_GIFT_AGAIN:
        if (!held(player, CANOPIC_JAR_FULL_ITEM_ID)) {
          player.getInventory().adds(CANOPIC_JAR_FULL_ITEM_ID, 1);
        }
        return;
      case ACTION_NOTES_FOUND:
        setBit(player, BIT_TABLE_NOTES);
        return;
      case ACTION_CODE_KEY_FOUND:
        if (hasBit(player, BIT_CODE_KEY_TAKEN) || held(player, CODE_KEY_ITEM_ID)) return;
        setBit(player, BIT_CODE_KEY_TAKEN);
        player.getInventory().adds(CODE_KEY_ITEM_ID, 1);
        ensureStage(player, STAGE_CODE_KEY_TAKEN);
        return;
      case ACTION_QUEST_COMPLETE:
        event.handled = true;
        event.end = true;
        if (!quest.isComplete(player) && quest.getStage(player) >= STAGE_HEART_TAKEN) {
          quest.complete(player);
        }
        return;
      default:
        return;
    }
  }

  // ==========================================================================
  // Arrav at the fort (14129 is not in the dialogue index; play the page ourselves)
  // ==========================================================================

  function talkToArrav(event) {
    if (event.npcId !== ARRAV_NPC_ID) return false;
    event.handled = true;
    const { player } = event;
    if (!questActive(player)) return true;
    ensureStage(player, STAGE_ARRAV_MET);
    startTranscript(api, player, ARRAV_NPC_ID, PAGE, "fort-invasion-talking-to-arrav-in-the-fort");
    return true;
  }

  // ==========================================================================
  // Object interactions
  // ==========================================================================

  function handleLever(event) {
    const { player } = event;
    event.handled = true;
    leverContext.set(player, leverOf(event));
    if (!questActive(player)) return;
    if (quest.getStage(player) < STAGE_ENTERED_TOMB) return;
    startPageTranscript(player, "tomb-raiding-pulling-the-lever");
  }

  function handleSkeleton(event) {
    const { player, objectId } = event;
    const variant = SKELETON_OBJECT_IDS.get(objectId);
    if (!variant) return;
    event.handled = true;
    if (!questActive(player)) return;
    if (objectId === ObjectIdentifiers.SKELETON_136) {
      if (hasBit(player, BIT_KEY_1_LOOTED) || held(player, MASTABA_KEY_ITEM_ID)) return;
      setBit(player, BIT_KEY_1_LOOTED);
      player.getInventory().adds(MASTABA_KEY_ITEM_ID, 1);
    } else if (objectId === ObjectIdentifiers.SKELETON_139) {
      if (hasBit(player, BIT_KEY_2_LOOTED) || held(player, MASTABA_KEY_2_ITEM_ID)) return;
      setBit(player, BIT_KEY_2_LOOTED);
      player.getInventory().adds(MASTABA_KEY_2_ITEM_ID, 1);
    }
    startPageTranscript(player, variant);
  }

  function handleImposingDoors(event) {
    const { player } = event;
    event.handled = true;
    const tile = objectTile(event);
    if (!questActive(player)) return;
    if (pulledLevers(player) >= 2 || quest.isComplete(player)) {
      if (tile) stepAcross(player, tile);
      return;
    }
    startPageTranscript(player, "tomb-raiding-opening-the-imposing-stone-doors-without-pulling-the-levers");
  }

  function handleShelves(event) {
    const { player } = event;
    event.handled = true;
    if (!questActive(player)) return;
    if (quest.getStage(player) < STAGE_LOWER_TOMB) return;
    if (hasBit(player, BIT_JAR_TAKEN) || held(player, CANOPIC_JAR_OIL_ITEM_ID)) return;
    startPageTranscript(player, "tomb-raiding-searching-the-shelves");
  }

  function handleMural(event) {
    const { player, objectId } = event;
    const variant = MURAL_OBJECT_IDS.get(objectId);
    if (!variant) return;
    event.handled = true;
    if (!questActive(player)) return;
    if (objectId === ObjectIdentifiers.MURAL_13) setBit(player, BIT_RECIPE_LEARNED);
    startPageTranscript(player, variant);
  }

  function handleTapestry(event) {
    const { player } = event;
    event.handled = true;
    if (!questActive(player)) return;
    if (quest.getStage(player) < STAGE_ARRAV_MET) return;
    if (quest.getStage(player) >= STAGE_TAPESTRY_SEARCHED) return;
    startPageTranscript(player, "fort-invasion-searching-the-tapestry");
  }

  function handleFortDoor(event) {
    const { player } = event;
    event.handled = true;
    const tile = objectTile(event);
    if (tile) stepAcross(player, tile);
  }

  /** Doors.plugin.js opens 50514 by name before our object hook runs; mirror us through. */
  function handleDoorToggle(request) {
    if (request.objectId !== FORT_DOOR_OBJECT_ID || !request.player) return;
    if (!questActive(request.player)) return;
    const tile = request.location;
    if (tile) stepThrough(request.player, tile);
  }

  function handleBaseGate(event) {
    const { player } = event;
    event.handled = true;
    if (!questActive(player)) return;
    if (!held(player, BASE_KEY_ITEM_ID)) {
      startPageTranscript(player, "fort-invasion-attempting-to-open-the-south-or-west-doors-in-the-base");
      return;
    }
    if (!hasBit(player, BIT_BASE_KEY_USED)) {
      setBit(player, BIT_BASE_KEY_USED);
      player.getInventory().deleteNumber(BASE_KEY_ITEM_ID, 1);
    }
    const tile = objectTile(event);
    if (tile) stepAcross(player, tile);
  }

  function handleKitchenPipe(event) {
    const { player } = event;
    event.handled = true;
    if (!questActive(player)) return;
    player.moveTo(new Location(STORAGE_LANDING.x, STORAGE_LANDING.y, 0));
  }

  function handleStorageTable(event) {
    const { player, objectId } = event;
    if (!STORAGE_TABLE_IDS.has(objectId)) return;
    event.handled = true;
    if (!questActive(player)) return;
    if (objectId === ObjectIdentifiers.TABLE_406) {
      if (!held(player, DECODER_STRIPS_ITEM_ID)) player.getInventory().adds(DECODER_STRIPS_ITEM_ID, 1);
      startPageTranscript(player, "heart-heist-searching-the-west-table");
      return;
    }
    if (hasBit(player, BIT_TABLE_NOTES)) return;
    startPageTranscript(player, "heart-heist-searching-the-east-table");
  }

  function handleStorageChest(event) {
    const { player } = event;
    event.handled = true;
    if (!questActive(player)) return;
    if (quest.getStage(player) < STAGE_MET_AT_BASE) return;
    if (hasBit(player, BIT_CODE_KEY_TAKEN) || held(player, CODE_KEY_ITEM_ID)) return;
    startPageTranscript(player, "heart-heist-searching-the-chest");
  }

  /** The two metal-door leaves (50517/50518) are solid map walls: remove them to open. */
  function openMetalDoors(player, object) {
    const area = player.getPrivateArea?.() ?? null;
    const location = object.getLocation();
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const tile = new Location(location.getX() + dx, location.getY() + dy, location.getZ());
        for (const id of METAL_DOORS_OBJECT_IDS) {
          const leaf = MapObjects.get(id, tile, area);
          if (leaf) ObjectManager.deregister(leaf, true);
        }
      }
    }
  }

  function handleMetalDoors(event) {
    const { player, object } = event;
    event.handled = true;
    if (!questActive(player)) return;
    const tile = objectTile(event);
    if (tile) {
      openMetalDoors(player, object);
      stepThrough(player, tile);
    }
    ensureStage(player, STAGE_METAL_DOORS_OPEN);
  }

  function handleGrapplePipe(event) {
    const { player, objectId } = event;
    event.handled = true;
    if (!questActive(player)) return;
    const location = player.getLocation();
    const x = objectId === ObjectIdentifiers.PIPE_31 ? GRAPPLE_LANDING.x : STORAGE_LANDING.x;
    player.moveTo(new Location(x, location.getY(), location.getZ()));
    ensureStage(player, STAGE_GRAPPLED);
  }

  function handlePedestal(event) {
    const { player } = event;
    event.handled = true;
    if (!questActive(player)) return;
    if (quest.getStage(player) < STAGE_MET_AT_BASE) return;
    ensureStage(player, STAGE_HEART_TAKEN);
    playHeartCutscene(player);
  }

  function handleTunnelCave(event) {
    const { player } = event;
    event.handled = true;
    if (!questActive(player)) return;
    if (quest.getStage(player) < STAGE_JAR_SHOWN) return;
    ensureStage(player, STAGE_IN_TUNNELS);
    player.moveTo(new Location(TUNNEL_CELLAR_LANDING.x, TUNNEL_CELLAR_LANDING.y, 0));
  }

  /** Defender of Varrock has its own key/dialogue/entry on this shared trapdoor. */
  function defenderActive(player) {
    const started = { player, key: "defender_of_varrock", started: false };
    api.emitCustomEvent("quest:is-started", started);
    if (started.started !== true) return false;
    const complete = { player, key: "defender_of_varrock", complete: false };
    api.emitCustomEvent("quest:is-complete", complete);
    return complete.complete !== true;
  }

  function handleBaseTrapdoorOpen(event) {
    const { player } = event;
    if (defenderActive(player)) return; // let Defender play V_TRAPDOOR and consume its key
    event.handled = true;
    const tile = objectTile(event);
    if (tile) replacePlacedObject(BASE_TRAPDOOR_OPEN_REPLACEMENT_ID, tile.x, tile.y, BASE_TRAPDOOR_OPEN_OBJECT_ID, 10, 1);
  }

  function handleBaseTrapdoorEnter(event) {
    const { player } = event;
    if (defenderActive(player)) return; // Defender owns the active-quest crossing
    event.handled = true;
    player.moveTo(new Location(BASE_INTERIOR_LANDING.x, BASE_INTERIOR_LANDING.y, 0));
  }

  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    if (!player) return;
    if (objectId === LEVER_OBJECT_ID) return handleLever(event);
    if (SKELETON_OBJECT_IDS.has(objectId)) return handleSkeleton(event);
    if (objectId === IMPOSING_DOORS_OBJECT_ID) return handleImposingDoors(event);
    if (objectId === SHELVES_OBJECT_ID) return handleShelves(event);
    if (MURAL_OBJECT_IDS.has(objectId)) return handleMural(event);
    if (objectId === FORT_DOOR_OBJECT_ID) return handleFortDoor(event);
    if (objectId === TAPESTRY_OBJECT_ID) return handleTapestry(event);
    if (objectId === BASE_GATE_OBJECT_ID || objectId === BASE_INNER_DOOR_OBJECT_ID) return handleBaseGate(event);
    if (objectId === KITCHEN_PIPE_OBJECT_ID) return handleKitchenPipe(event);
    if (STORAGE_TABLE_IDS.has(objectId)) return handleStorageTable(event);
    if (objectId === STORAGE_CHEST_OBJECT_ID) return handleStorageChest(event);
    if (METAL_DOORS_OBJECT_IDS.has(objectId)) return handleMetalDoors(event);
    if (GRAPPLE_PIPE_OBJECT_IDS.has(objectId)) return handleGrapplePipe(event);
    if (objectId === PEDESTAL_OBJECT_ID || objectId === HEART_PEDESTAL_OBJECT_ID) return handlePedestal(event);
    if (objectId === TUNNEL_CAVE_OBJECT_ID) return handleTunnelCave(event);
    if (objectId === BASE_TRAPDOOR_OPEN_REPLACEMENT_ID) return handleBaseTrapdoorOpen(event);
    if (objectId === BASE_TRAPDOOR_OPEN_OBJECT_ID) return handleBaseTrapdoorEnter(event);
  }

  // ==========================================================================
  // The heart heist cutscene
  // ==========================================================================

  function playHeartCutscene(player) {
    const data = loadTranscripts(api);
    const ending = data?.[PAGE]?.variants?.[CUTSCENE_END_VARIANT];
    if (!Array.isArray(ending)) {
      startTranscript(api, player, ZEMOUREGAL_NPC_ID, PAGE, CUTSCENE_VARIANT);
      return;
    }
    startTranscript(api, player, ZEMOUREGAL_NPC_ID, PAGE, CUTSCENE_VARIANT, (taking) => [
      ...taking,
      ...ending,
    ]);
  }

  // ==========================================================================
  // Items
  // ==========================================================================

  function handleItemOnItem(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const pair = new Set([usedItemId, usedWithItemId]);
    if (pair.has(DWELLBERRIES_ITEM_ID) && pair.has(CANOPIC_JAR_OIL_ITEM_ID)) {
      event.handled = true;
      if (!questActive(player)) return;
      if (!held(player, DWELLBERRIES_ITEM_ID, 3) || !held(player, CANOPIC_JAR_OIL_ITEM_ID)) return;
      player.getInventory().deleteNumber(DWELLBERRIES_ITEM_ID, 3);
      player.getInventory().deleteNumber(CANOPIC_JAR_OIL_ITEM_ID, 1);
      player.getInventory().adds(CANOPIC_JAR_BERRIES_ITEM_ID, 1);
      startPageTranscript(player, "tomb-raiding-using-dwellberries-on-the-canopic-jar");
      return;
    }
    if (pair.has(RING_OF_LIFE_ITEM_ID) && pair.has(CANOPIC_JAR_BERRIES_ITEM_ID)) {
      event.handled = true;
      if (!questActive(player)) return;
      player.getInventory().deleteNumber(RING_OF_LIFE_ITEM_ID, 1);
      player.getInventory().deleteNumber(CANOPIC_JAR_BERRIES_ITEM_ID, 1);
      player.getInventory().adds(CANOPIC_JAR_FULL_ITEM_ID, 1);
      ensureStage(player, STAGE_JAR_FILLED);
      startPageTranscript(player, "tomb-raiding-using-a-ring-of-life-on-the-canopic-jar");
    }
  }

  // ==========================================================================
  // Login / zones / stairs
  // ==========================================================================

  function handleLogin({ player }) {
    installWorld();
    refreshQuestList(player);
    sendLeverVarbits(player);
    syncBaseElias(player);
  }

  function handleLogout({ player }) {
    const npc = baseEliasByPlayer.get(player);
    if (npc) {
      api.removeNpc(npc);
      baseEliasByPlayer.delete(player);
    }
  }

  function handleStageChanged(event) {
    if (event.key !== "curse_of_arrav" || !event.player) return;
    syncBaseElias(event.player);
  }

  function handleMastabaEnter({ player }) {
    if (!player || !questActive(player)) return;
    if (quest.getStage(player) < STAGE_STARTED) return;
    ensureStage(player, STAGE_ENTERED_TOMB);
  }

  function handleLowerTombEnter({ player }) {
    if (!player || !questActive(player)) return;
    if (quest.getStage(player) < STAGE_GOLEM_DEAD) return;
    ensureStage(player, STAGE_LOWER_TOMB);
  }

  /** The cellar stairs (50508) are outside LocTeleports' captured set: claim them. */
  function handleClimbRequest(request) {
    if (request.objectId !== FORT_STAIRS_OBJECT_ID) return;
    request.handled = true;
    if (!questActive(request.player)) return;
    api.emitCustomEvent("ladders:climbUp", {
      player: request.player,
      destination: new Location(FORT_LANDING.x, FORT_LANDING.y, 0),
    });
    ensureStage(request.player, STAGE_AT_FORT);
  }

  function handleNpcDeath(event) {
    if (event.npcId !== GOLEM_GUARD_NPC_ID) return;
    const player = event.killer?.isPlayer?.() ? event.killer : null;
    if (!player || !questActive(player)) return;
    ensureStage(player, STAGE_GOLEM_DEAD);
  }

  // ==========================================================================
  // Registration
  // ==========================================================================

  api.persistAttribute(BITS_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "curse_of_arrav",
    name: "The Curse of Arrav",
    varpId: VARP_COA,
    varbitId: VARBIT_COA,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.MINING.getIndex(), amount: 40000, label: "Mining" },
      { skillId: Skill.THIEVING.getIndex(), amount: 40000, label: "Thieving" },
      { skillId: Skill.AGILITY.getIndex(), amount: 40000, label: "Agility" },
    ],
    otherRewards: ["Access to Zemouregal's Fort"],
    buildJournal,
    onReward: grantReward,
  });

  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleDialogueHook);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onCustomEvent("npc-dialogue:choice", handleDialogueChoice);
  api.onCustomEvent("quest:stage-changed", handleStageChanged);
  api.onCustomEvent("door:toggle", handleDoorToggle);
  api.onCustomEvent("ladders:climb", handleClimbRequest);
  api.onNpcInteraction("Arrav", { "Talk-to": talkToArrav });
  api.onNpcDeath(handleNpcDeath);
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemOnItem(handleItemOnItem);
  api.onZoneEnter(MASTABA_ZONE, handleMastabaEnter);
  api.onZoneEnter(LOWER_TOMB_ZONE, handleLowerTombEnter);
};
