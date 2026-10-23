/**
 * Death on the Isle: RSProx 1695 (ticks 5884-7030), OSRS Wiki transcript/walkthrough,
 * and the cache's doti varbits and multi-NPCs. Evidence: docs/p2p-varlamore-group-2-parity.md.
 * The butler holds both containers with their slots/metadata; private accusation/stage actors
 * and the nonlethal fight recover their earned checkpoints on login.
 */
module.exports = function registerDeathOnTheIsleQuest(api) {
  const {
    Equipment,
    CombatMethod,
    CombatType,
    Item,
    Animation,
    GameObject,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    ObjectIdentifiers,
    ObjectManager,
    Skill,
  } = api.core;
  const { refreshQuestList, registerQuest, startTranscript } = require("../QuestRuntime");
  const { createQuestScenes } = require('../QuestScenes');
  const ObstacleRunner = require('../../skills/agility/ObstacleRunner.Agility');
  const Scenes = createQuestScenes(api);
  const GEAR_ATTRIBUTE = 'death-on-the-isle:held-gear';
  const VILLA_GEAR_ATTRIBUTE = 'death-on-the-isle:villa-gear';
  const FINAL_FIGHT_ATTRIBUTE = 'death-on-the-isle:final-fight';
  const STAGE_VERSION_ATTRIBUTE = 'death-on-the-isle:stage-version';

  const PAGE = "Death on the Isle";
  const START_HOOK = "quest:death-on-the-isle:start";

  // ==========================================================================
  // Ids (all from the generated cache identifiers unless noted)
  // ==========================================================================

  const PATZI = NpcIdentifiers.PATZI; // 13818, outside the villa
  const PATZI_PICKPOCKET = NpcIdentifiers.PATZI_2; // 13819
  const ADALA = NpcIdentifiers.ADALA; // 13820, masked inside
  const ADALA_NOMASK = NpcIdentifiers.ADALA_3; // 13822, outside
  const ADALA_PICKPOCKET = NpcIdentifiers.ADALA_4; // 13823, masked pickpocket
  const ADALA_BOSS = NpcIdentifiers.ADALA_5; // 13824, level 49
  const CONSTANTINIUS = NpcIdentifiers.CONSTANTINIUS; // 13825
  const CONSTANTINIUS_PICKPOCKET = NpcIdentifiers.CONSTANTINIUS_2; // 13826
  const COZYAC = NpcIdentifiers.COZYAC; // 13827
  const COZYAC_PICKPOCKET = NpcIdentifiers.COZYAC_2; // 13828
  const XOCOTLA = NpcIdentifiers.XOCOTLA; // 13829
  const XOCOTLA_PICKPOCKET = NpcIdentifiers.XOCOTLA_2; // 13830
  const PAVO = NpcIdentifiers.PAVO; // 13831
  const PAVO_PICKPOCKET = NpcIdentifiers.PAVO_2; // 13832
  const HEAD_BUTLER = NpcIdentifiers.HEAD_BUTLER; // 13833
  const STRADIUS = NpcIdentifiers.STRADIUS; // 13834
  const HUTZA = NpcIdentifiers.HUTZA; // 13835
  const HUTZA_2 = NpcIdentifiers.HUTZA_2; // 13836, interrupts the interrogation door
  const COSTUMER = NpcIdentifiers.COSTUMER; // 13837
  const NAIATLI = NpcIdentifiers.NAIATLI; // 13838
  const CLODIUS = NpcIdentifiers.CLODIUS; // 13839
  const WANDERING_GUARD = NpcIdentifiers.WANDERING_GUARD; // 13840
  const VILLA_GUARD = NpcIdentifiers.VILLA_GUARD; // 13871
  const LIVIUS_BODY = NpcIdentifiers.MAN_41; // 13872, "Man" Check-on
  const LIVIUS_NAMED = NpcIdentifiers.COL_00FFFF_LIVIUS_COL; // 13873, "Livius" Inspect

  const QUEST_NPC_IDS = new Set([
    PATZI, PATZI_PICKPOCKET, ADALA, ADALA_NOMASK, ADALA_PICKPOCKET, ADALA_BOSS,
    CONSTANTINIUS, CONSTANTINIUS_PICKPOCKET, COZYAC, COZYAC_PICKPOCKET,
    XOCOTLA, XOCOTLA_PICKPOCKET, PAVO, PAVO_PICKPOCKET, HEAD_BUTLER,
    STRADIUS, HUTZA, HUTZA_2, COSTUMER, NAIATLI, CLODIUS, WANDERING_GUARD,
    VILLA_GUARD, LIVIUS_BODY, LIVIUS_NAMED,
  ]);
  const GUEST_IDS = new Set([
    CONSTANTINIUS, CONSTANTINIUS_PICKPOCKET, COZYAC, COZYAC_PICKPOCKET,
    XOCOTLA, XOCOTLA_PICKPOCKET, PAVO, PAVO_PICKPOCKET,
  ]);
  const HEAD_BUTLER_IDS = new Set([HEAD_BUTLER]);

  // Cache items: the wardrobe gives the stolen uniform (29916/29918, capture
  // 1695); entering the villa wears its own pieces (29914/29915).
  const UNIFORM_TOP_VILLA = ItemIdentifiers.BUTLERS_UNIFORM; // 29914
  const UNIFORM_BOTTOM_VILLA = ItemIdentifiers.BUTLERS_UNIFORM_2; // 29915
  const UNIFORM_TOP = ItemIdentifiers.BUTLERS_UNIFORM_3; // 29916
  const UNIFORM_BOTTOM = ItemIdentifiers.BUTLERS_UNIFORM_5; // 29918
  const UNIFORM_TOPS = new Set([UNIFORM_TOP_VILLA, UNIFORM_TOP]);
  const UNIFORM_BOTTOMS = new Set([UNIFORM_BOTTOM_VILLA, UNIFORM_BOTTOM]);
  const UNIFORM_ITEMS = new Set([...UNIFORM_TOPS, ...UNIFORM_BOTTOMS]);
  const TRAY = ItemIdentifiers.BUTLERS_TRAY; // 29912, post-quest reward
  const VILLA_TRAY = ItemIdentifiers.BUTLERS_TRAY_3; // 30156, worn inside the party
  const MASKS = [
    ItemIdentifiers.RAM_MASK, // 29929
    ItemIdentifiers.WOLF_MASK_4, // 29930
    ItemIdentifiers.BIRD_MASK, // 29931
    ItemIdentifiers.JAGUAR_MASK, // 29932
    ItemIdentifiers.SNAKE_MASK, // 29933
  ];
  const CASE_FILE = ItemIdentifiers.CASE_FILE; // 29922
  const CHEST_KEY = ItemIdentifiers.CHEST_KEY_10; // 29923
  const DRINKING_FLASK = ItemIdentifiers.DRINKING_FLASK; // 29925
  const THREATENING_NOTE = ItemIdentifiers.THREATENING_NOTE; // 29926
  const SHIPPING_CONTRACT = ItemIdentifiers.SHIPPING_CONTRACT; // 29927
  const WINE_LABELS = ItemIdentifiers.WINE_LABELS; // 29928
  const COSTUME_NEEDLE = ItemIdentifiers.COSTUME_NEEDLE; // 29920
  const PROP_SWORD = ItemIdentifiers.PROP_SWORD_3; // 29911
  const ICON = ItemIdentifiers.ICON_5; // 29897, Icon (Aldarin)
  const WATER_RUNE = ItemIdentifiers.WATER_RUNE; // 555
  const EVIDENCE_ITEMS = [WINE_LABELS, THREATENING_NOTE, DRINKING_FLASK, SHIPPING_CONTRACT];

  const HOUSE_WINDOW = ObjectIdentifiers.HOUSE_WINDOW; // 54701
  const ANTIQUE_WINE = ObjectIdentifiers.ANTIQUE_WINE; // 54704, Investigate at stage>=18
  const JUG = ObjectIdentifiers.JUG; // 54708, clue1
  const BROKEN_POTTERY = ObjectIdentifiers.BROKEN_POTTERY; // 54709, clue2
  const WINE_STORAGE = ObjectIdentifiers.WINE_STORAGE; // 54710, clue3
  const SMALL_BOX = ObjectIdentifiers.SMALL_BOX; // 54711, clue4
  const BROKEN_STOOL = ObjectIdentifiers.BROKEN_STOOL_3; // 54712, clue5
  const CELLAR_STAIR_EXIT_VILLA = ObjectIdentifiers.STAIRS_289; // 54716
  const CELLAR_STAIR_EXIT_BACKSTAGE = ObjectIdentifiers.STAIRS_290; // 54717
  const COSTUME_RACK = ObjectIdentifiers.COSTUME_RACK; // 54718, Search
  const LOOSE_ROCKS_FIRST = ObjectIdentifiers.LOOSE_ROCKS_2; // 54720
  const LOOSE_ROCKS_SECOND = ObjectIdentifiers.LOOSE_ROCKS_3; // 54721
  const LOOSE_ROCKS_DOWN = ObjectIdentifiers.LOOSE_ROCKS_4; // 54722
  const WARDROBE_UNIFORM = ObjectIdentifiers.WARDROBE_59; // 54723, Take-uniform
  const WARDROBE_UNIFORM_TAKE = ObjectIdentifiers.WARDROBE_60; // 54724
  const BOOKSHELF_CLOSED = ObjectIdentifiers.BOOKSHELF_397; // 54726, Search
  const BOOKSHELF_OPEN = ObjectIdentifiers.BOOKSHELF_398; // 54727, Search
  const BOOKSHELF_PASSAGE = ObjectIdentifiers.BOOKSHELF_PASSAGE; // 54728, Enter
  // The generated identifiers omit the cache's changing-bookshelf multi-locs.
  const CHANGING_BOOKSHELF_BASE = 54735; // stage varbit 11210: bookshelf, then the post-quest passage
  const CHANGING_BOOKSHELF_IN = 54734; // clue varbit 11250: searchable closed/open bookshelf
  const CHANGING_BOOKSHELF_TILE = new Location(1461, 9331, 0);
  const CRATE_POISON = ObjectIdentifiers.CRATE_341; // 54731, Search
  const BACKSTAGE_ENTRANCE = ObjectIdentifiers.BACKSTAGE_ENTRANCE; // 54715, Enter
  const FANCY_CHEST = ObjectIdentifiers.FANCY_CHEST; // 54736, Open
  const FOUNTAIN = ObjectIdentifiers.FOUNTAIN_22; // 54738, plain
  const FOUNTAIN_SEARCH = ObjectIdentifiers.FOUNTAIN_23; // 54739, Search
  const ENTRYWAY = ObjectIdentifiers.ENTRYWAY; // 54707, guest entryway Pass-through
  const INTERROGATION_DOOR = ObjectIdentifiers.DOOR_748; // 54706, Open
  const CELLAR_ENTRANCE = ObjectIdentifiers.CELLAR_ENTRANCE; // 55047, Enter
  const STATUE_INACTIVE = ObjectIdentifiers.STATUE_273; // 54553, Activate

  // ==========================================================================
  // Varbits / stages
  // ==========================================================================

  const STAGE_VARBIT = 11210; // doti
  const VARBIT_MET_XOCOTLA = 11211;
  const VARBIT_MET_COZYAC = 11212;
  const VARBIT_MET_PAVO = 11213;
  const VARBIT_MET_CONSTANTINIUS = 11214;
  const VARBIT_PICKPOCKET_XOCOTLA = 11215;
  const VARBIT_PICKPOCKET_COZYAC = 11216;
  const VARBIT_PICKPOCKET_PAVO = 11217;
  const VARBIT_CLUE1 = 11218;
  const VARBIT_CLUE2 = 11219;
  const VARBIT_CLUE3 = 11220;
  const VARBIT_CLUE4 = 11221;
  const VARBIT_CLUE5 = 11222;
  const VARBIT_BODYCHECK = 11223;
  const VARBIT_INVESTIGATED_XOCOTLA = 11224;
  const VARBIT_INVESTIGATED_COZYAC = 11225;
  const VARBIT_INVESTIGATED_PAVO = 11226;
  const VARBIT_INVESTIGATED_CONSTANTINIUS = 11227;
  const VARBIT_PICKPOCKET_ADALA = 11228;
  const VARBIT_ADALA_FIGHT_OUTCOME = 11229;
  const VARBIT_INITIAL_CONVERSATION = 11230;
  const VARBIT_MASK_ASSIGNMENT = 11231;
  const VARBIT_GIVEN_ITEMS = 11233;
  const VARBIT_INVESTIGATED_PATZI = 11234;
  const VARBIT_INVESTIGATED_FLASK = 11235;
  const VARBIT_INVESTIGATED_LABELS = 11236;
  const VARBIT_INVESTIGATED_LETTER = 11237;
  const VARBIT_INVESTIGATED_CONTRACT = 11238;
  const VARBIT_ACCUSED_COZYAC = 11239;
  const VARBIT_ACCUSED_CONSTANTINIUS = 11240;
  const VARBIT_ACCUSED_XOCOTLA = 11241;
  const VARBIT_ACCUSED_PAVO = 11242;
  const VARBIT_QUESTIONED_COZYAC = 11243;
  const VARBIT_QUESTIONED_CONSTANTINIUS = 11244;
  const VARBIT_QUESTIONED_XOCOTLA = 11245;
  const VARBIT_QUESTIONED_PAVO = 11246;
  const VARBIT_QUESTIONED_PATZI = 11247;
  const VARBIT_ACCUSED_PATZI = 11248;
  const VARBIT_BACKSTAGE_INTRO = 11249;
  const VARBIT_BOOKSHELF_CLUE = 11250;
  const VARBIT_POISON_CLUE = 11251;
  const VARBIT_CLOTHING_CLUE = 11252;
  const VARBIT_ACTORS_CHAT = 11253;
  const VARBIT_BOOKSHELF_CHAT = 11254;
  const VARBIT_POISON_CHAT = 11255;
  const VARBIT_CLOTHING_CHAT = 11256;
  const VARBIT_FINAL_ACCUSATION_INTRO = 11257;
  const VARBIT_ALDARIN_PENDANT = 11178; // pendant_of_ates_aldarin_found, drives the statue
  const VARBIT_ATES_PIECE_HUNT = 11232; // ates_piece_hunt, transforms the placed 54740 fountain

  const STAGE_STARTED = 2;
  const STAGE_WINDOW = 6;
  const STAGE_UNIFORM = 6;
  const STAGE_ADALA_INSIDE = 8;
  const STAGE_UNIFORM_WORN = 10;
  const STAGE_ENTERED = 14;
  const STAGE_PATZI_INSIDE = 15;
  const STAGE_MET_GUESTS = 15;
  const STAGE_WINE_REQUEST = 16;
  const STAGE_WINE_INVESTIGATED = 18;
  const STAGE_BODY_FOUND = 19;
  const STAGE_ARRESTED = 20;
  const STAGE_INTERROGATED = 21;
  const STAGE_CELLAR_DONE = 22;
  const STAGE_REPORTED = 24;
  const STAGE_PICKPOCKET = 26;
  const STAGE_EVIDENCE = 27;
  const STAGE_ACCUSATIONS = 28;
  const STAGE_ADALA_GONE = 33;
  const STAGE_ACCUSATION_DONE = 34;
  const STAGE_THEATRE = 36;
  const STAGE_THEATRE_GUARDS = 36;
  const STAGE_BACKSTAGE_DONE = 40;
  const STAGE_NAIATLI_ACCUSED = 40;
  const STAGE_ON_STAGE = 42;
  const STAGE_CASE_CLOSED = 49;
  const STAGE_COMPLETE = 50;

  const QUEST_KEYS = { the_fremennik_isles: "the_fremennik_isles" };

  // ==========================================================================
  // Tiles from RSProx 1695 (Villa Lucens/Aldarin)
  // ==========================================================================

  const HEAD_BUTLER_TILE = new Location(1426, 2919, 0);
  const NAIATLI_TILE = new Location(1465, 2932, 0);
  const CLODIUS_TILE = new Location(1469, 2937, 0);

  const WINDOW_OUTSIDE = new Location(1401, 2966, 0);
  const WINDOW_INSIDE = new Location(1401, 2967, 0);
  const INSIDE_PARTY = new Location(1434, 2934, 0);
  const ROOM_INSIDE = new Location(1438, 2938, 0);
  const ROOM_OUTSIDE = new Location(1438, 2940, 0);
  const TOP_FLOOR = new Location(1444, 2935, 2);
  const CELLAR_INSIDE = new Location(1447, 9333, 0);
  const CELLAR_STAIR_OUT = new Location(1447, 2938, 0);
  const BACKSTAGE_INSIDE = new Location(1466, 9330, 0);
  const THEATRE_OUTSIDE = new Location(1472, 2925, 0);
  const STAGE_LANDING = new Location(1470, 2931, 0);
  const ROCK_FIRST_TOP = new Location(1471, 2918, 0);
  const ROCK_SECOND_TOP = new Location(1477, 2925, 0);
  const VILLA_CELLAR_FROM_PASSAGE = new Location(1445, 9336, 0);
  const FINAL_VILLA = new Location(1444, 2934, 0);
  const BOSS_TILE = new Location(1446, 2933, 2);

  const FIGHT_WON = 2;
  const FIGHT_LOST = 3;

  // ==========================================================================
  // Persisted flags
  // ==========================================================================

  const FLAG_BITS = {
    initial: VARBIT_INITIAL_CONVERSATION,
    "met.const": VARBIT_MET_CONSTANTINIUS,
    "met.cozyac": VARBIT_MET_COZYAC,
    "met.pavo": VARBIT_MET_PAVO,
    "met.xocotla": VARBIT_MET_XOCOTLA,
    "investigated.const": VARBIT_INVESTIGATED_CONSTANTINIUS,
    "investigated.cozyac": VARBIT_INVESTIGATED_COZYAC,
    "investigated.pavo": VARBIT_INVESTIGATED_PAVO,
    "investigated.xocotla": VARBIT_INVESTIGATED_XOCOTLA,
    "investigated.patzi": VARBIT_INVESTIGATED_PATZI,
    "questioned.const": VARBIT_QUESTIONED_CONSTANTINIUS,
    "questioned.cozyac": VARBIT_QUESTIONED_COZYAC,
    "questioned.pavo": VARBIT_QUESTIONED_PAVO,
    "questioned.xocotla": VARBIT_QUESTIONED_XOCOTLA,
    "questioned.patzi": VARBIT_QUESTIONED_PATZI,
    "accused.const": VARBIT_ACCUSED_CONSTANTINIUS,
    "accused.cozyac": VARBIT_ACCUSED_COZYAC,
    "accused.pavo": VARBIT_ACCUSED_PAVO,
    "accused.xocotla": VARBIT_ACCUSED_XOCOTLA,
    "accused.patzi": VARBIT_ACCUSED_PATZI,
    "pickpocket.const": null,
    "pickpocket.cozyac": VARBIT_PICKPOCKET_COZYAC,
    "pickpocket.pavo": VARBIT_PICKPOCKET_PAVO,
    "pickpocket.xocotla": VARBIT_PICKPOCKET_XOCOTLA,
    "pickpocket.adala": VARBIT_PICKPOCKET_ADALA,
    "inspected.flask": VARBIT_INVESTIGATED_FLASK,
    "inspected.labels": VARBIT_INVESTIGATED_LABELS,
    "inspected.letter": VARBIT_INVESTIGATED_LETTER,
    "inspected.contract": VARBIT_INVESTIGATED_CONTRACT,
    "clue.jug": VARBIT_CLUE1,
    "clue.pottery": VARBIT_CLUE2,
    "clue.storage": VARBIT_CLUE3,
    "clue.box": VARBIT_CLUE4,
    "clue.stool": VARBIT_CLUE5,
    body: VARBIT_BODYCHECK,
    "backstage.bookshelf": VARBIT_BOOKSHELF_CLUE,
    "backstage.poison": VARBIT_POISON_CLUE,
    "backstage.clothing": VARBIT_CLOTHING_CLUE,
    "chat.actors": VARBIT_ACTORS_CHAT,
    "chat.bookshelf": VARBIT_BOOKSHELF_CHAT,
    "chat.poison": VARBIT_POISON_CHAT,
    "chat.clothing": VARBIT_CLOTHING_CHAT,
    given: VARBIT_GIVEN_ITEMS,
    "backstage.intro": VARBIT_BACKSTAGE_INTRO,
    "accusation.intro": VARBIT_FINAL_ACCUSATION_INTRO,
  };
  const FLAG_NAMES = Object.keys(FLAG_BITS);
  const NON_BIT_FLAGS = [
    "fight.active",
    "fight.won",
    "fight.lost",
    "on.stage",
    "clodius.done",
    "chest.opened",
    "icon.found",
    "wine",
  ];

  function flagKey(name) {
    return `quest.death_on_the_isle.${name}`;
  }

  function hasFlag(player, name) {
    return player.getAttribute(flagKey(name)) === true;
  }

  function setFlag(player, name, on = true) {
    player.setAttribute(flagKey(name), on === true);
    const varbit = FLAG_BITS[name];
    if (on && varbit !== undefined && varbit !== null) {
      player.getPacketSender().sendVarbit(varbit, 1);
    }
  }

  function maskAssignment(player) {
    const value = Number(player.getAttribute(flagKey("mask")));
    return Number.isInteger(value) && value >= 1 && value <= MASKS.length ? value : 1;
  }

  function setMaskAssignment(player, value) {
    player.setAttribute(flagKey("mask"), value | 0);
    player.getPacketSender().sendVarbit(VARBIT_MASK_ASSIGNMENT, value | 0);
  }

  function fightOutcome(player) {
    const value = Number(player.getAttribute(flagKey("fight.outcome")));
    return Number.isInteger(value) ? value : 0;
  }

  function setFightOutcome(player, value) {
    player.setAttribute(flagKey("fight.outcome"), value | 0);
    player.getPacketSender().sendVarbit(VARBIT_ADALA_FIGHT_OUTCOME, value === FIGHT_WON ? 1 : 0);
  }

  // ==========================================================================
  // Small helpers
  // ==========================================================================

  let quest;

  function stageOf(player) {
    return quest.getStage(player);
  }

  function questComplete(player, key) {
    const request = { player, key, complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function meetsRequirements(player) {
    const skills = player.getSkillManager();
    return (
      skills.getMaxLevel(Skill.THIEVING) >= 34 &&
      skills.getMaxLevel(Skill.AGILITY) >= 32 &&
      questComplete(player, "children_of_the_sun")
    );
  }

  function hasFollower(player) {
    const world = api.getWorld?.();
    if (!world?.getNpcs) return false;
    for (const npc of world.getNpcs()) {
      if (npc?.isPet?.() === true && npc.getOwner?.() === player) return true;
    }
    return false;
  }

  function hasItem(player, itemId, amount = 1) {
    return player.getInventory().getAmount(itemId) >= amount;
  }

  function addItem(player, itemId, amount = 1) {
    player.getInventory().adds(itemId, amount);
  }

  function removeItems(player, itemId, amount = 1) {
    const have = player.getInventory().getAmount(itemId);
    if (have > 0) player.getInventory().deleteNumber(itemId, Math.min(have, amount));
  }

  function hasAnyUniform(player) {
    for (const id of UNIFORM_ITEMS) {
      if (player.getInventory().getAmount(id) > 0) return true;
    }
    return false;
  }

  function wearingUniform(player) {
    const equipment = player.getEquipment();
    const top = equipment.get(Equipment.BODY_SLOT)?.getId?.();
    const bottom = equipment.get(Equipment.LEG_SLOT)?.getId?.();
    return UNIFORM_TOPS.has(top) && UNIFORM_BOTTOMS.has(bottom);
  }

  function allMet(player) {
    return (
      hasFlag(player, "met.const") &&
      hasFlag(player, "met.cozyac") &&
      hasFlag(player, "met.pavo") &&
      hasFlag(player, "met.xocotla")
    );
  }

  function allQuestioned(player) {
    return (
      hasFlag(player, "questioned.const") &&
      hasFlag(player, "questioned.cozyac") &&
      hasFlag(player, "questioned.pavo") &&
      hasFlag(player, "questioned.xocotla")
    );
  }

  function allClues(player) {
    return (
      hasFlag(player, "clue.jug") &&
      hasFlag(player, "clue.pottery") &&
      hasFlag(player, "clue.storage") &&
      hasFlag(player, "clue.box") &&
      hasFlag(player, "clue.stool") &&
      hasFlag(player, "body")
    );
  }

  function allBackstage(player) {
    return (
      hasFlag(player, "backstage.bookshelf") &&
      hasFlag(player, "backstage.poison") &&
      hasFlag(player, "backstage.clothing")
    );
  }

  function allEvidence(player) {
    return (
      hasFlag(player, "pickpocket.adala") &&
      hasFlag(player, "pickpocket.cozyac") &&
      hasFlag(player, "pickpocket.pavo") &&
      hasFlag(player, "pickpocket.xocotla") &&
      hasFlag(player, "inspected.labels") &&
      hasFlag(player, "inspected.letter") &&
      hasFlag(player, "inspected.flask") &&
      hasFlag(player, "inspected.contract")
    );
  }

  /** The hand-in transcript consumes these from the inventory, not the bank. */
  function holdsEvidence(player) {
    return EVIDENCE_ITEMS.every(id => hasItem(player, id));
  }

  function playVariant(player, npcId, variant, select) {
    return startTranscript(api, player, npcId, PAGE, variant, select);
  }

  function ownGear(player) { return !!player.getAttribute(GEAR_ATTRIBUTE); }

  /** Save both containers, including slots and item metadata, before swapping the held gear. */
  function swapGear(player, outgoing, incoming, defaults) {
    const inventory = player.getInventory(), equipment = player.getEquipment();
    const save = container => container.getItems().map(item => [item.getId(), item.getAmount(), Item.cloneMeta(item.meta)]);
    const saved = player.getAttribute(incoming) ?? defaults;
    if (!saved) return false;
    player.setAttribute(outgoing, { inventory: save(inventory), equipment: save(equipment) });
    inventory.setItems(saved.inventory.map(([id, amount, meta]) => new Item(id, amount, meta)));
    equipment.setItems(saved.equipment.map(([id, amount, meta]) => new Item(id, amount, meta)));
    player.setAttribute(incoming, null);
    inventory.refreshItems(); equipment.refreshItems();
    return true;
  }

  function fadeMove(player, move, resume) {
    Scenes.fade(player, true); Scenes.controls(player, true);
    Scenes.later(player, 3, move);
    Scenes.later(player, 4, () => { Scenes.fade(player, false); Scenes.controls(player, false); resume?.(); });
    Scenes.later(player, 6, () => Scenes.closeFade(player));
  }

  /** A variant sliced from its first top-level menu (wiki jump "above" tails). */
  function selectFromMenu(steps) {
    if (!Array.isArray(steps)) return steps;
    const index = steps.findIndex((step) => step?.type === "choice");
    return index === -1 ? steps : steps.slice(index);
  }

  function maybeClueStage(player) {
    if (stageOf(player) >= STAGE_INTERROGATED && allClues(player) && stageOf(player) < STAGE_CELLAR_DONE) {
      quest.setStage(player, STAGE_CELLAR_DONE);
    }
  }

  function syncVarbits(player) {
    const sender = player.getPacketSender();
    for (const [name, varbit] of Object.entries(FLAG_BITS)) {
      if (varbit) sender.sendVarbit(varbit, hasFlag(player, name) ? 1 : 0);
    }
    sender.sendVarbit(VARBIT_MASK_ASSIGNMENT, maskAssignment(player));
    if (quest.isComplete(player)) {
      sender.sendVarbit(VARBIT_ALDARIN_PENDANT, hasFlag(player, "icon.found") ? 1 : 0);
      sender.sendVarbit(
        VARBIT_ATES_PIECE_HUNT,
        hasFlag(player, "icon.found") ? 2 : hasFlag(player, "chest.opened") ? 1 : 0
      );
    }
  }

  // ==========================================================================
  // Per-player quest NPC spawns
  // ==========================================================================

  const trackedNpcs = new WeakMap();
  const changingBookshelfByPlayer = new WeakMap();

  function spawnTracked(player, key, definition) {
    const tracked = trackedNpcs.get(player) ?? new Map();
    trackedNpcs.set(player, tracked);
    if (tracked.get(key)) return tracked.get(key);
    const npc = api.spawnNpc({
      id: definition.id,
      x: definition.tile.getX(),
      y: definition.tile.getY(),
      z: definition.tile.getZ(),
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) {
      npc.__skipDefaultRespawn = true;
      Scenes.get(player)?.area?.add(npc);
      tracked.set(key, npc);
    }
    return npc;
  }

  function removeTracked(player, key) {
    const tracked = trackedNpcs.get(player);
    const npc = tracked?.get(key);
    if (npc) {
      api.removeNpc(npc);
      tracked.delete(key);
    }
  }

  // The world's multi-NPCs handle visibility; only the stage's actors are private.
  function desiredSpawns(player) {
    if (!Scenes.get(player) || stageOf(player) < STAGE_ON_STAGE || stageOf(player) >= STAGE_CASE_CLOSED) return [];
    return [
      { key: "naiatli", id: NAIATLI, tile: NAIATLI_TILE },
      { key: "clodius", id: CLODIUS, tile: CLODIUS_TILE },
    ];
  }

  function syncSpawns(player) {
    if (!player || player.isPlayerBot?.() === true) return;
    const tracked = trackedNpcs.get(player) ?? new Map();
    trackedNpcs.set(player, tracked);
    const wanted = new Map(desiredSpawns(player).map((spawn) => [spawn.key, spawn]));
    for (const [key, npc] of tracked) {
      if (!wanted.has(key)) {
        api.removeNpc(npc);
        tracked.delete(key);
      }
    }
    for (const [key, spawn] of wanted) {
      const npc = tracked.get(key);
      if (npc?.isRegistered() && npc.getId() === spawn.id) continue;
      if (npc) { api.removeNpc(npc); tracked.delete(key); }
      spawnTracked(player, key, spawn);
    }
    syncChangingBookshelf(player);
  }

  /** The map's changing bookshelf has no options during the quest; this player's copy is searchable. */
  function syncChangingBookshelf(player) {
    const stage = stageOf(player);
    const existing = changingBookshelfByPlayer.get(player);
    if (stage >= STAGE_THEATRE_GUARDS && stage < STAGE_NAIATLI_ACCUSED) {
      if (existing?.getId() === CHANGING_BOOKSHELF_IN) return;
      if (existing) ObjectManager.deregister(existing, true);
      const object = new GameObject(CHANGING_BOOKSHELF_IN, cloneBookshelfTile(), 10, 0, null).setOwner(player);
      ObjectManager.register(object, true);
      changingBookshelfByPlayer.set(player, object);
      return;
    }
    if (!existing || existing.getId() === CHANGING_BOOKSHELF_BASE) return;
    ObjectManager.deregister(existing, true);
    const base = new GameObject(CHANGING_BOOKSHELF_BASE, cloneBookshelfTile(), 10, 0, null).setOwner(player);
    ObjectManager.register(base, true);
    changingBookshelfByPlayer.set(player, base);
  }

  function cloneBookshelfTile() {
    return new Location(CHANGING_BOOKSHELF_TILE.getX(), CHANGING_BOOKSHELF_TILE.getY(), CHANGING_BOOKSHELF_TILE.getZ());
  }

  function clearChangingBookshelf(player) {
    const object = changingBookshelfByPlayer.get(player);
    if (!object) return;
    ObjectManager.deregister(object, true);
    changingBookshelfByPlayer.delete(player);
  }

  function removeAllSpawns(player) {
    const tracked = trackedNpcs.get(player);
    if (!tracked) return;
    for (const npc of tracked.values()) api.removeNpc(npc);
    trackedNpcs.delete(player);
  }

  const OWNER_CULL_IDS = new Set([PATZI, PATZI_PICKPOCKET, HEAD_BUTLER]);

  function cullLeakedSpawns(player) {
    const world = api.getWorld?.();
    const username = player.getUsername?.();
    if (!world?.getNpcs || !username) return;
    for (const npc of [...world.getNpcs()]) {
      if (npc?.isOwnerOnly?.() !== true) continue;
      if (!OWNER_CULL_IDS.has(npc.getId?.())) continue;
      const owner = npc.getOwner?.();
      if (owner === player || owner?.getUsername?.() !== username) continue;
      api.removeNpc(npc);
    }
  }

  function handleStageChanged(event) {
    if (event?.key !== "death_on_the_isle" || !event.player) return;
    syncSpawns(event.player);
  }

  // ==========================================================================
  // Transcript variant selection
  // ==========================================================================

  const UNIFORM_TALK_WITH = "getting-a-uniform-talking-to-adala-or-patzi-with-a-uniform";

  function selectPatziVariant(player, npcId) {
    const stage = stageOf(player);
    if (quest.isComplete(player)) return "post-quest-dialogue-talking-to-patzi";
    if (stage < STAGE_STARTED) return npcId === PATZI ? "starting-the-quest" : null;
    if (stage < STAGE_ADALA_INSIDE) {
      return hasAnyUniform(player) || wearingUniform(player) ? UNIFORM_TALK_WITH : "getting-a-uniform-talking-to-patzi-without-a-uniform";
    }
    if (stage < STAGE_ENTERED) return "getting-a-uniform-talking-to-patzi-after-adala-is-gone";
    if (stage < STAGE_WINE_REQUEST) {
      if (stage < STAGE_PATZI_INSIDE) return "inside-villa-lucens-talking-to-patzi";
      return allMet(player)
        ? "inside-villa-lucens-talking-to-patzi-after-talking-to-everyone-else"
        : "inside-villa-lucens-talking-to-patzi-talking-to-patzi-again";
    }
    if (stage < STAGE_INTERROGATED) return "inside-villa-lucens-talking-to-patzi-again";
    if (stage < STAGE_ACCUSATIONS) return "the-investigation-talking-to-adala-or-patzi";
    if (stage < STAGE_ADALA_GONE) return "the-accusation-adala-and-patzi";
    return null;
  }

  function selectAdalaVariant(player) {
    const stage = stageOf(player);
    if (quest.isComplete(player)) return null;
    if (stage < STAGE_ADALA_INSIDE) {
      return hasAnyUniform(player) || wearingUniform(player) ? UNIFORM_TALK_WITH : "getting-a-uniform-talking-to-adala-without-a-uniform";
    }
    if (stage >= STAGE_INTERROGATED && stage < STAGE_ACCUSATIONS) {
      return "the-investigation-talking-to-adala-or-patzi";
    }
    if (stage >= STAGE_ACCUSATIONS && stage < STAGE_ADALA_GONE) {
      return "the-accusation-adala-and-patzi";
    }
    return null;
  }

  const GUEST_INFO = new Map([
    [CONSTANTINIUS, {
      key: "const",
      intro: "inside-villa-lucens-talking-to-constantinius",
      repeat: "inside-villa-lucens-talking-to-constantinius-talking-to-constantinius-again",
      investigate: "the-investigation-talking-to-constantinius",
      accuse: "the-accusation-constantinius",
      accused: "the-accusation-talking-to-constantinius-afterwards",
      post: "post-quest-dialogue-talking-to-constantinius",
    }],
    [COZYAC, {
      key: "cozyac",
      intro: "inside-villa-lucens-talking-to-cozyac",
      repeat: "inside-villa-lucens-talking-to-cozyac-talking-to-cozyac-again",
      investigate: "the-investigation-talking-to-cozyac",
      accuse: "the-accusation-cozyac",
      accused: "the-accusation-talking-to-cozyac-afterwards",
      post: "the-accusation-talking-to-cozyac-afterwards",
    }],
    [XOCOTLA, {
      key: "xocotla",
      intro: "inside-villa-lucens-talking-to-xocotla",
      repeat: "inside-villa-lucens-talking-to-xocotla-again",
      investigate: "the-investigation-talking-to-xocotla",
      accuse: "the-accusation-xocotla",
      accused: "the-accusation-talking-to-xocotla-afterwards",
      post: "the-accusation-talking-to-xocotla-afterwards",
    }],
    [PAVO, {
      key: "pavo",
      intro: "inside-villa-lucens-talking-to-pavo",
      repeat: "inside-villa-lucens-talking-to-pavo-again",
      investigate: "the-investigation-talking-to-pavo",
      accuse: "the-accusation-pavo",
      accused: "the-accusation-talking-to-pavo-afterwards",
      post: "the-accusation-talking-to-pavo-afterwards",
    }],
  ]);
  for (const pickpocketId of [CONSTANTINIUS_PICKPOCKET, COZYAC_PICKPOCKET, XOCOTLA_PICKPOCKET, PAVO_PICKPOCKET]) {
    const base = pickpocketId === CONSTANTINIUS_PICKPOCKET ? CONSTANTINIUS
      : pickpocketId === COZYAC_PICKPOCKET ? COZYAC
      : pickpocketId === XOCOTLA_PICKPOCKET ? XOCOTLA : PAVO;
    GUEST_INFO.set(pickpocketId, GUEST_INFO.get(base));
  }

  function selectGuestVariant(player, npcId) {
    const info = GUEST_INFO.get(npcId);
    if (!info) return null;
    const stage = stageOf(player);
    if (quest.isComplete(player)) return info.post;
    if (stage >= STAGE_ACCUSATIONS && stage < STAGE_ADALA_GONE) {
      // The wiki "-again" menus are jump-only ("same as above") and would close
      // under this replay, so the full accusation menu is used until it is made.
      if (hasFlag(player, `accused.${info.key}`)) return info.accused;
      return info.accuse;
    }
    if (stage >= STAGE_INTERROGATED && stage < STAGE_EVIDENCE) return info.investigate;
    if (stage >= STAGE_ENTERED && stage < STAGE_WINE_INVESTIGATED) {
      return hasFlag(player, `met.${info.key}`) ? info.repeat : info.intro;
    }
    return null;
  }

  function selectCostumerVariant(player) {
    if (quest.isComplete(player)) return "post-quest-dialogue-talking-to-the-costumer";
    if (stageOf(player) >= STAGE_THEATRE_GUARDS) return "the-backstage-talking-to-costumer";
    return null;
  }

  // Interrupted conversations resume from the tail of the transcript they died in.
  const ACCUSATION_AFTERMATH = "the-accusation-fighting-adala";
  const STAGE_WRAP_UP = "the-stage-attacking-naiatli-again";

  /** The steps after `stepId`, so a conversation cut short can be replayed. */
  function tailAfter(stepId) {
    return steps => {
      if (!Array.isArray(steps)) return steps;
      const index = steps.findIndex(step => step?.id === stepId);
      return index === -1 ? steps : steps.slice(index + 1);
    };
  }

  function selectGuardsVariant(player, npcId) {
    const stage = stageOf(player);
    const hutza = npcId === HUTZA || npcId === HUTZA_2;
    if (quest.isComplete(player)) {
      return hutza ? "post-quest-dialogue-talking-to-hutza" : "post-quest-dialogue-talking-to-stradius";
    }
    // The case was closed but the wrap-up was cut off: it still has to complete.
    if (stage >= STAGE_CASE_CLOSED) return STAGE_WRAP_UP;
    if (stage >= STAGE_ON_STAGE) {
      return hasFlag(player, "on.stage")
        ? "the-stage-talking-to-hutza"
        : "the-stage-talking-to-hutza-or-stradius";
    }
    if (stage >= STAGE_BACKSTAGE_DONE) return "the-backstage-talking-to-hutza-or-stradius-after-investigating-the-backstage";
    if (stage >= STAGE_THEATRE_GUARDS) {
      return !hasFlag(player, 'backstage.intro') ? 'the-backstage-talking-to-hutza-or-stradius'
        : 'the-backstage-talking-to-hutza-or-stradius-without-investigating-the-backstage';
    }
    if (stage >= STAGE_THEATRE) {
      return "the-backstage-talking-to-hutza-or-stradius";
    }
    if (stage >= STAGE_ADALA_GONE) {
      // Adala was escorted away but the departure was cut short: replay the tail.
      if (stage < STAGE_ACCUSATION_DONE) return ACCUSATION_AFTERMATH;
      return hutza ? "the-accusation-talking-to-hutza" : "the-accusation-talking-to-stradius";
    }
    if (stage >= STAGE_ACCUSATIONS) {
      return hutza ? "the-accusation-talking-to-hutza" : "the-accusation-talking-to-stradius";
    }
    if (stage >= STAGE_EVIDENCE) {
      return allEvidence(player) && hasFlag(player, "given")
        ? "the-investigation-talking-to-hutza-or-stradius-after-giving-them-the-evidence"
        : "the-investigation-talking-to-hutza-or-stradius-after-pickpocketing-everyone";
    }
    if (stage >= STAGE_PICKPOCKET) {
      return allEvidence(player) && (hasFlag(player, "given") || holdsEvidence(player))
        ? "the-investigation-talking-to-hutza-or-stradius-after-pickpocketing-everyone"
        : "the-investigation-talking-to-hutza-or-stradius-without-pickpocketing-everyone";
    }
    if (stage >= STAGE_CELLAR_DONE) {
      if (allClues(player)) {
        return "the-investigation-talking-to-hutza-or-stradius-after-investigating-everything";
      }
      return "the-investigation-talking-to-hutza-or-stradius";
    }
    if (stage === STAGE_ARRESTED || stage === STAGE_BODY_FOUND) {
      return "inside-villa-lucens-talking-to-hutza-or-stradius-after-interrupting-conversation";
    }
    if (stage >= STAGE_INTERROGATED) return "the-investigation-talking-to-hutza-or-stradius";
    return null;
  }

  function selectNaiatliVariant(player) {
    if (stageOf(player) < STAGE_ON_STAGE) return null;
    const step = Number(player.getAttribute(flagKey("fight.step"))) || 0;
    if (step === 0) return "the-stage-talking-to-naiatli";
    if (step === 1) return "the-stage-talking-to-naiatli-again";
    if (step === 2) return "the-stage-attacking-naiatli";
    if (step === 3) return "the-stage-attacking-naiatli-again";
    return "the-stage-attacking-naiatli-again";
  }

  // ==========================================================================
  // NPC Talk-to / pickpocket handling
  // ==========================================================================

  function talkPatzi(event) {
    const { player, npcId } = event;
    const variant = selectPatziVariant(player, npcId);
    if (!variant) return false;
    return playVariant(player, npcId, variant);
  }

  function talkAdala(event) {
    const { player, npcId } = event;
    const variant = selectAdalaVariant(player);
    if (!variant) return false;
    if (variant === "the-investigation-talking-to-adala-or-patzi") setFlag(player, "investigated.patzi");
    return playVariant(player, npcId, variant);
  }

  function talkGuest(event) {
    const { player, npcId } = event;
    const info = GUEST_INFO.get(npcId);
    if (!info) return false;
    const variant = selectGuestVariant(player, npcId);
    if (!variant) return false;
    if (variant === info.investigate) setFlag(player, `investigated.${info.key}`);
    if (variant === info.accuse) setFlag(player, `questioned.${info.key}`);
    return playVariant(player, npcId, variant);
  }

  function talkGuards(event) {
    const { player, npcId } = event;
    const variant = selectGuardsVariant(player, npcId);
    if (!variant) return false;
    if (variant === 'the-investigation-talking-to-hutza-or-stradius-after-investigating-everything' && allClues(player)) {
      return playVariant(player, npcId, variant, steps => {
        const menu = steps.find(step => step.type === 'choice');
        const report = menu.options[0];
        const proceed = report.steps.find(step => step.type === 'choice').options[0].steps;
        return [steps[0], { ...menu, options: [{ ...report, steps: [report.steps[0], ...proceed] }, ...menu.options.slice(1)] }];
      });
    }
    if (variant === "the-investigation-talking-to-hutza-or-stradius-after-giving-them-the-evidence") {
      return playVariant(
        player,
        npcId,
        "the-investigation-talking-to-hutza-or-stradius-after-pickpocketing-everyone",
        selectFromMenu
      );
    }
    if (variant === ACCUSATION_AFTERMATH) {
      return playVariant(player, npcId, variant, tailAfter("k5CJTB"));
    }
    if (variant === STAGE_WRAP_UP) {
      return playVariant(player, npcId, variant, tailAfter("wdaiPu"));
    }
    return playVariant(player, npcId, variant);
  }

  function talkHeadButler(event) {
    const { player, npcId, npc } = event;
    if (quest.isComplete(player) && !ownGear(player)) {
      return playVariant(player, npcId, "post-quest-dialogue-talking-to-the-head-butler");
    }
    const own = npc?.getLocation?.().getY() === HEAD_BUTLER_TILE.getY();
    if (own) {
      const stage = stageOf(player);
      if (stage >= STAGE_ENTERED) {
        return playVariant(player, npcId, "getting-inside-the-villa-talking-to-the-head-butler-again");
      }
      if (wearingUniform(player)) {
        return playVariant(
          player,
          npcId,
          "getting-inside-the-villa-talking-to-the-head-butler-with-the-butler-uniform-worn"
        );
      }
      return playVariant(
        player,
        npcId,
        "getting-inside-the-villa-talking-to-the-head-butler-without-the-butler-uniform-worn"
      );
    }
    if (stageOf(player) >= STAGE_UNIFORM_WORN) {
      return playVariant(player, npcId, "getting-inside-the-villa-exiting-via-staff-entrance");
    }
    return false;
  }

  function talkCostumer(event) {
    const { player, npcId } = event;
    const variant = selectCostumerVariant(player);
    if (!variant) return false;
    return playVariant(player, npcId, variant, stageOf(player) >= 38 ? selectFromMenu : null);
  }

  function talkNaiatli(event) {
    const { player, npcId } = event;
    const variant = selectNaiatliVariant(player);
    if (!variant) return false;
    return playVariant(player, npcId, variant);
  }

  function attackClodius(event) {
    const { player, npcId } = event;
    if (hasFlag(player, "clodius.done")) return playVariant(player, npcId, "the-stage-attacking-clodius");
    setFlag(player, "clodius.done");
    return playVariant(player, npcId, "the-stage-attacking-clodius");
  }

  function checkMan(event) {
    const { player } = event;
    if (!hasFlag(player, "wine")) return false;
    return playVariant(player, STRADIUS, "inside-villa-lucens-investigating-the-man-on-the-floor");
  }

  function inspectLivius(event) {
    const { player } = event;
    if (stageOf(player) < STAGE_INTERROGATED) return false;
    const variant = hasFlag(player, "body")
      ? "the-investigation-inspecting-livius-again"
      : "the-investigation-inspecting-livius";
    setFlag(player, "body");
    maybeClueStage(player);
    return playVariant(player, LIVIUS_NAMED, variant);
  }

  function pickpocketAdala(event) {
    const { player, npcId } = event;
    if (stageOf(player) < STAGE_PICKPOCKET || stageOf(player) >= STAGE_EVIDENCE) return false;
    if (hasItem(player, WINE_LABELS)) {
      return playVariant(player, npcId, "the-investigation-pickpocketing-adala-again");
    }
    return playVariant(player, npcId, "the-investigation-pickpocketing-adala");
  }

  function pickpocketGuest(event) {
    const { player, npcId } = event;
    const info = GUEST_INFO.get(npcId);
    if (!info) return false;
    if (quest.isComplete(player)) {
      if (npcId !== CONSTANTINIUS_PICKPOCKET) return false;
      return playVariant(
        player,
        npcId,
        hasItem(player, CHEST_KEY)
          ? "post-quest-dialogue-pickpocketing-constantinius-pickpocketing-constantinius-while-already-having-the-key"
          : "post-quest-dialogue-pickpocketing-constantinius"
      );
    }
    const stage = stageOf(player);
    if (stage < STAGE_PICKPOCKET || stage >= STAGE_EVIDENCE) return false;
    const already = hasItem(player, { cozyac: THREATENING_NOTE, pavo: DRINKING_FLASK, xocotla: SHIPPING_CONTRACT }[info.key]);
    const variant = info.key === "const"
      ? "the-investigation-pickpocketing-constantinius"
      : already
        ? `the-investigation-pickpocketing-${info.key}-again`
        : `the-investigation-pickpocketing-${info.key}`;
    return playVariant(player, npcId, variant);
  }

  function pickpocketPatzi(event) {
    const { player, npcId } = event;
    if (stageOf(player) < STAGE_PICKPOCKET || stageOf(player) >= STAGE_EVIDENCE) return false;
    return playVariant(player, npcId, "the-investigation-pickpocketing-patzi");
  }

  function handleNpcInteraction(event) {
    const { player, npcId, clickType } = event;
    if (!player || !npcId) return;
    const action = event.definition?.getActions?.()?.[clickType - 1];
    if (GUEST_IDS.has(npcId)) {
      if (action === "Talk-to") talkGuest(event);
      else if (action === "Pickpocket") pickpocketGuest(event);
      else return;
      event.handled = true;
      return;
    }
    switch (npcId) {
      case PATZI:
      case PATZI_PICKPOCKET:
        if (action === "Talk-to") talkPatzi(event);
        else if (action === "Pickpocket") pickpocketPatzi(event);
        else return;
        break;
      case ADALA:
      case ADALA_NOMASK:
      case ADALA_PICKPOCKET:
        if (action === "Talk-to") talkAdala(event);
        else if (action === "Pickpocket") pickpocketAdala(event);
        else return;
        break;
      case HEAD_BUTLER:
        if (action !== "Talk-to") return;
        talkHeadButler(event);
        break;
      case STRADIUS:
      case HUTZA:
      case HUTZA_2:
        if (action !== "Talk-to" && action !== "Leave") return;
        talkGuards(event);
        break;
      case COSTUMER:
        if (action !== "Talk-to") return;
        talkCostumer(event);
        break;
      case NAIATLI:
        if (action !== "Talk-to" && action !== "Attack") return;
        talkNaiatli(event);
        break;
      case CLODIUS:
        if (action !== "Attack" && action !== "Talk-to") return;
        attackClodius(event);
        break;
      case LIVIUS_BODY:
        if (action !== "Check-on") return;
        checkMan(event);
        break;
      case LIVIUS_NAMED:
        if (action !== "Inspect") return;
        inspectLivius(event);
        break;
      default:
        return;
    }
    // Once one of the quest's own NPC ids is matched, the generic NpcDialogues
    // fallback must never replay an arbitrary page variant on it.
    event.handled = true;
  }

  // ==========================================================================
  // Conditions / choices / hooks / stage actions
  // ==========================================================================

  const NOT_QUESTIONED_CONDITIONS = new Set([
    "schJyj", "u6ubhU", "Mnv1nk", "QYv09w", "xhlA68", "A0FW9s",
  ]);
  const QUESTIONED_CONDITIONS = new Set([
    "bHTaru", "zZs-hy", "7bwOjA", "qqnBfK", "DlBJ9z", "AZe2y6",
  ]);

  function answerCondition(event) {
    const { player, stepId } = event;
    if (!player || !QUEST_NPC_IDS.has(event.npcId)) return null;
    switch (stepId) {
      case "wBmCn9":
        return !meetsRequirements(player);
      case "L0Lo69":
        return meetsRequirements(player);
      case "BJkOQT":
        return !hasFollower(player);
      case "2JnDDN":
        return hasFollower(player);
      case "vD-rj5":
        return !questComplete(player, QUEST_KEYS.the_fremennik_isles);
      case "Wago-m":
        return questComplete(player, QUEST_KEYS.the_fremennik_isles);
      case "0UuB8z":
      case "DuGw5u":
        return false;
      case "8P5Tr3":
        return true; // no player-owned houses exist in this repo
      case "wziBMm":
        return fightOutcome(player) === FIGHT_LOST;
      case "JPt8VE":
        return fightOutcome(player) === FIGHT_WON;
      default:
        break;
    }
    if (NOT_QUESTIONED_CONDITIONS.has(stepId)) return !allQuestioned(player);
    if (QUESTIONED_CONDITIONS.has(stepId)) return allQuestioned(player);
    return null;
  }


  const ACCUSED_BY_NPC = new Map([
    [CONSTANTINIUS, "accused.const"],
    [CONSTANTINIUS_PICKPOCKET, "accused.const"],
    [COZYAC, "accused.cozyac"],
    [COZYAC_PICKPOCKET, "accused.cozyac"],
    [XOCOTLA, "accused.xocotla"],
    [XOCOTLA_PICKPOCKET, "accused.xocotla"],
    [PAVO, "accused.pavo"],
    [PAVO_PICKPOCKET, "accused.pavo"],
  ]);

  function handleChoice(event) {
    const { player, npcId, stepId, option } = event;
    if (!player) return;
    if (option === "Accuse Patzi.") {
      setFlag(player, "accused.patzi");
      return;
    }
    if (option === "I am." && HEAD_BUTLER_IDS.has(npcId) && stageOf(player) >= STAGE_ENTERED) {
      enterVilla(player);
      return;
    }
    if (option === "Yes.") {
      const accusedFlag = ACCUSED_BY_NPC.get(npcId);
      if (accusedFlag) setFlag(player, accusedFlag);
    }
  }

  function handleHook(event) {
    if (event?.hook !== START_HOOK || !event.player) return;
    if (event.npcId !== PATZI && event.npcId !== PATZI_PICKPOCKET) return;
    const { player } = event;
    if (stageOf(player) !== 0 || !meetsRequirements(player)) return;
    player.setAttribute(STAGE_VERSION_ATTRIBUTE, 1);
    quest.setStage(player, STAGE_STARTED);
    player.sendMessage("You've started a new quest: <col=081190>Death on the Isle</col>");
  }

  /** State changes when the captured line appears, so cancelling a conversation keeps its work. */
  function handleLine(event) {
    if (!event.pages?.some(page => page.page === PAGE)) return;
    const { player, npcId } = event;
    const text = event.step?.text ?? event.step?.player ?? event.step?.npc ?? event.text;
    const at = (line, minimum, maximum, callback, when = 'before') => {
      if (text !== line) return;
      const previous = event[when];
      event[when] = () => { previous?.(); const value = stageOf(player); if (value >= minimum && value <= maximum) callback(); };
    };
    const advance = value => { if (stageOf(player) < value) quest.setStage(player, value); };
    at("Right... I guess I'm off to find a uniform then.", 2, 2, () => advance(4));
    at("I'll bet Adala went through it. You should've followed her! I think she headed somewhere along that hedgerow.", 8, 8, () => advance(10));
    at('Right, I think that covers everything. Are you ready to enter?', 10, 12, () => { if (stageOf(player) < 12) setMaskAssignment(player, 1 + Math.floor(Math.random() * MASKS.length)); advance(12); });
    at("No, no. I think you're doing more than enough right now, thank you.", 14, 14, () => { setFlag(player, 'initial'); advance(15); });
    at('Alright, one glass of wine coming right up.', 15, 15, () => { if (allMet(player)) advance(16); });
    at('Stradius...', 20, 20, () => advance(21));
    at('What if they hired someone to do it for them?', 22, 22, () => { if (allClues(player)) advance(24); });
    at('Hutza!', 24, 24, () => advance(26));
    if (text.startsWith('Alright, [player name], just let us know when you want everyone gathered')) at(text, 26, 26, () => advance(27));
    at("Murder! What a ridiculous assertion! I may be a thief, but I'd never kill someone!", 28, 28, () => advance(30));
    at('Go ahead.', 36, 36, () => advance(38));
    if ([HUTZA, STRADIUS].includes(npcId)) at("Okay, I'll get to it.", 36, 38, () => setFlag(player, 'backstage.intro'));
    if (npcId === COSTUMER) {
      const flags = [
        ["I don't think so. I suppose I do get quite engrossed in my work sometimes, so it's not impossible. But I'm sure I'd have spotted someone going up the stairs...", 'chat.actors'],
        ['Ah, that was a gift from Constantinius. We were having a bit of a rat problem, so he gave us the poison to deal with them.', 'chat.poison'],
        ["Interesting...", 'chat.clothing'],
        ['This is an old villa. Apparently it once played a role in some smuggling operations a long time ago. I could see them having a few secrets to help them with that.', 'chat.bookshelf'],
      ];
      for (const [line, flag] of flags) at(line, 38, 40, () => { setFlag(player, flag); maybeBackstageStage(player); });
    }
    for (const [id, info] of GUEST_INFO) {
      if (id !== npcId) continue;
      const intro = require('../QuestRuntime').loadTranscripts(api)?.[PAGE]?.variants?.[info.intro] ?? [];
      const last = intro.filter(step => step.type === 'line').at(-1)?.text;
      if (last) at(last, 14, 16, () => setFlag(player, `met.${info.key}`));
    }
    at('But did you find anything that could tell us who did it?', 40, 40, () => setFlag(player, 'accusation.intro'));
    at("Well then we'll have to just speed things along a bit. I'm going out there!", 40, 40, () => advance(42));
    at('Argh! You\'re stronger than I thought... I need to regroup!', 42, 42, () => advance(45));
    at('Aha, villain! This is where you fall!', 45, 45, () => { setFinalFight(player, 2); player.setAttribute(flagKey('fight.step'), 2); });
    if (text === 'Bravo!') at(text, 45, 45, () => setFinalFight(player, 6));
    at('You win some and you lose some I guess. All the best, [player name]!', 49, 49, () => quest.complete(player), 'after');
  }

  function setFinalFight(player, value) {
    player.setAttribute(FINAL_FIGHT_ATTRIBUTE, value);
    const id = api.core.CacheDefinitions.getVarbitId('doti_final_fight');
    if (id != null) player.getPacketSender().sendVarbit(id, value);
  }

  function openAccusation(player) {
    if (Scenes.get(player)?.name === 'doti-accusation') return;
    const scene = Scenes.open(player, 'doti-accusation', [[1428, 1461, 2920, 2947, 2]], { multi: true, canAttack: (attacker, target) => target?.__dotiOwner === player || attacker?.__dotiOwner === player ? null : false });
    for (const [id, x, y] of [[PATZI,1446,2934],[ADALA,1446,2933],[CONSTANTINIUS,1446,2931],[COZYAC,1442,2929],[XOCOTLA,1444,2928],[PAVO,1442,2931],[STRADIUS,1444,2936],[HUTZA,1445,2936]]) Scenes.actor(scene, id, [x,y,2]);
  }

  function openStage(player) {
    if (Scenes.get(player)?.name === 'doti-stage') return;
    const scene = Scenes.open(player, 'doti-stage', [[1430, 1485, 2915, 2947, 0]]);
    for (const [id,x,y] of [[CONSTANTINIUS,1458,2932],[COZYAC,1457,2930],[PAVO,1457,2934],[PATZI,1459,2935],[STRADIUS,1472,2925],[HUTZA,1473,2925]]) Scenes.actor(scene, id, [x,y]);
    syncSpawns(player);
  }

  class StageCombat extends CombatMethod {
    type() { return CombatType.MELEE; }
    attackDistance() { return 1; }
    attackSpeed() { return 4; }
    start(player, npc) {
      player.getCombat().reset();
      const event = { player, npc, npcId: npc.getId() };
      if (event.npcId === NAIATLI) talkNaiatli(event);
      else if (event.npcId === CLODIUS) attackClodius(event);
    }
    hits() { return []; }
  }
  const stageCombat = new StageCombat();
  function resolveStageCombat(player) {
    return Scenes.get(player)?.name === 'doti-stage' ? stageCombat : null;
  }

  function stageStrike(player, damage, value, destination, clodius = false) {
    const npc = trackedNpcs.get(player)?.get(clodius ? 'clodius' : 'naiatli');
    if (!npc) return;
    player.performAnimation(new Animation(390));
    npc.showHitsplat?.(damage, { mine: 17, others: 17 });
    setFinalFight(player, value);
    if (destination) npc.getMovementQueue().addSteps(new Location(...destination, 0));
    else if (!clodius) npc.performAnimation(new Animation(836));
  }

  // ==========================================================================
  // Quest NPC hand-outs / teleports
  // ==========================================================================

  function enterVilla(player) {
    if (stageOf(player) < 12) return;
    if (!ownGear(player)) {
      const blank = container => container.getItems().map(() => [-1, 0, null]);
      const equipment = blank(player.getEquipment());
      equipment[Equipment.BODY_SLOT] = [UNIFORM_TOP_VILLA, 1, null];
      equipment[Equipment.LEG_SLOT] = [UNIFORM_BOTTOM_VILLA, 1, null];
      equipment[Equipment.HEAD_SLOT] = [MASKS[maskAssignment(player) - 1], 1, null];
      equipment[Equipment.WEAPON_SLOT] = [VILLA_TRAY, 1, null];
      swapGear(player, GEAR_ATTRIBUTE, VILLA_GEAR_ATTRIBUTE, { inventory: blank(player.getInventory()), equipment });
    }
    fadeMove(player, () => { if (stageOf(player) < STAGE_ENTERED) quest.setStage(player, STAGE_ENTERED); player.moveTo(INSIDE_PARTY); });
  }

  function leaveVilla(player) {
    if (!ownGear(player)) return;
    fadeMove(player, () => {
      Scenes.end(player, false);
      swapGear(player, VILLA_GEAR_ATTRIBUTE, GEAR_ATTRIBUTE);
      player.moveTo(HEAD_BUTLER_TILE);
    });
  }

  function startAdalaFight(player) {
    setFlag(player, "fight.active");
    setFlag(player, "fight.won", false);
    setFlag(player, "fight.lost", false);
    setFightOutcome(player, 0);
    const npc = spawnTracked(player, "adala-boss", { id: ADALA_BOSS, tile: BOSS_TILE });
    if (npc) { npc.__dotiOwner = player; npc.getCombat().attack(player); }
  }

  function finishFight(player, outcome) {
    if (!hasFlag(player, "fight.active")) return;
    setFlag(player, "fight.active", false);
    setFightOutcome(player, outcome);
    setFlag(player, outcome === FIGHT_WON ? "fight.won" : "fight.lost");
    removeTracked(player, "adala-boss");
    player.getCombat().reset();
    if (stageOf(player) < 32) quest.setStage(player, 32);
    playVariant(player, ADALA_NOMASK, "the-accusation-fighting-adala");
  }

  function preventAdalaDeath(event) {
    const player = event.npc?.__dotiOwner;
    if (!player || !hasFlag(player, 'fight.active')) return;
    event.preventDeath = true;
    finishFight(player, FIGHT_WON);
  }

  function fightHit({ attacker, target }) {
    const player = target?.__dotiOwner ?? attacker?.__dotiOwner;
    if (!player || !hasFlag(player, 'fight.active')) return;
    if (target?.__dotiOwner && target.getHitpoints() <= 10) finishFight(player, FIGHT_WON);
    else if (target === player && player.getHitpoints() <= 10) finishFight(player, FIGHT_LOST);
  }

  function handleNpcDeath(event) {
    if (event?.npcId !== ADALA_BOSS || !event.killer?.isPlayer?.()) return;
    const player = event.killer;
    if (!hasFlag(player, "fight.active")) return;
    finishFight(player, FIGHT_WON);
  }

  function handlePlayerBeforeDeath(event) {
    const { player } = event;
    if (!player || !hasFlag(player, "fight.active")) return;
    event.preventDeath = true;
    player.setHitpoints(10);
    finishFight(player, FIGHT_LOST);
  }

  function handleAction(event) {
    const { player, stepId } = event;
    if (!player || !stepId || !event.pages?.some(page => page.page === PAGE)) return;
    const boxes = {
      '0NeKgL': [UNIFORM_TOP, UNIFORM_BOTTOM],
      '5z2Lhi': [WINE_LABELS], SsD2Fw: [THREATENING_NOTE], Adb65_: [DRINKING_FLASK], XXxTM6: [SHIPPING_CONTRACT],
      JwtSTS: [WINE_LABELS, DRINKING_FLASK], FTSXlx: [CHEST_KEY], '1XIQ80': [ICON],
    };
    if (boxes[stepId]) { event.handled = true; event.box = { items: boxes[stepId] }; }
    if (boxes[stepId]?.some(id => EVIDENCE_ITEMS.includes(id)) && stepId !== 'JwtSTS' && player.getInventory().getFreeSlots() < 1) {
      event.handled = true; event.end = true; player.sendMessage('You need some free inventory space.'); return;
    }
    switch (stepId) {
      case "Uj6RhJ":
        if (stageOf(player) < STAGE_WINDOW) quest.setStage(player, STAGE_WINDOW);
        return;
      case "0NeKgL":
        if (stageOf(player) < STAGE_UNIFORM) quest.setStage(player, STAGE_UNIFORM);
        return;
      case "VOULZt":
        event.handled = true; event.end = true;
        fadeMove(player, () => { if (stageOf(player) < STAGE_ADALA_INSIDE) quest.setStage(player, STAGE_ADALA_INSIDE); },
          () => playVariant(player, PATZI, UNIFORM_TALK_WITH, steps => steps.slice(6)));
        return;
      case "wNdlW9":
        setFlag(player, "wine");
        if (stageOf(player) === STAGE_WINE_INVESTIGATED) quest.setStage(player, STAGE_BODY_FOUND);
        syncSpawns(player);
        return;
      case "5z2Lhi":
        addItem(player, WINE_LABELS);
        setFlag(player, "pickpocket.adala");
        return;
      case "SsD2Fw":
        addItem(player, THREATENING_NOTE);
        setFlag(player, "pickpocket.cozyac");
        return;
      case "Adb65_":
        addItem(player, DRINKING_FLASK);
        setFlag(player, "pickpocket.pavo");
        return;
      case "XXxTM6":
        addItem(player, SHIPPING_CONTRACT);
        setFlag(player, "pickpocket.xocotla");
        return;
      case "JwtSTS": {
        if (!hasFlag(player, 'given') && !EVIDENCE_ITEMS.every(id => hasItem(player, id))) {
          event.handled = true; event.end = true; player.sendMessage('You should recover the missing evidence first.'); return;
        }
        for (const itemId of EVIDENCE_ITEMS) removeItems(player, itemId);
        setFlag(player, "given");
        return;
      }
      case "BpumsX":
        setFlag(player, "backstage.clothing");
        maybeBackstageStage(player);
        return;
      case "SAM47H":
        setFlag(player, "backstage.poison");
        maybeBackstageStage(player);
        return;
      case "nSxoFv":
        setFlag(player, "backstage.bookshelf");
        maybeBackstageStage(player);
        return;
      case "_txlA4":
        setFlag(player, "body");
        maybeClueStage(player);
        return;
      case "FTSXlx":
        if (!hasItem(player, CHEST_KEY)) addItem(player, CHEST_KEY);
        return;
      case "1XIQ80":
        setFlag(player, "icon.found");
        if (!hasItem(player, ICON)) addItem(player, ICON);
        player.getPacketSender().sendVarbit(VARBIT_ATES_PIECE_HUNT, 2);
        return;
      case "Q8AJrp":
        api.getItemOnGroundManager().registerLocation(player, new Item(WATER_RUNE, 1), player.getLocation().clone());
        event.handled = true;
        return;
      case "pn24Ai":
        addItem(player, ItemIdentifiers.RAM_MASK);
        return;
      case "Jci-4K":
        addItem(player, ItemIdentifiers.WOLF_MASK_4);
        return;
      case "0IpxbG":
        addItem(player, ItemIdentifiers.BIRD_MASK);
        return;
      case "yy6sHr":
        addItem(player, ItemIdentifiers.JAGUAR_MASK);
        return;
      case "hklzpZ":
        addItem(player, ItemIdentifiers.SNAKE_MASK);
        return;
      case "82ODj5":
        addItem(player, TRAY);
        return;
      case "ajYdc-":
        addItem(player, COSTUME_NEEDLE);
        return;
      case "9kVMFj":
        event.handled = true;
        enterVilla(player);
        return;
      case "GMJFxO":
        event.handled = true;
        leaveVilla(player);
        return;
      case "GTGWOB":
        event.handled = true;
        if (stageOf(player) < STAGE_ARRESTED) quest.setStage(player, STAGE_ARRESTED);
        fadeMove(player, () => player.moveTo(ROOM_INSIDE));
        return;
      case "YgkOvV":
        event.handled = true;
        if (!hasItem(player, CASE_FILE)) addItem(player, CASE_FILE);
        if (stageOf(player) < STAGE_CELLAR_DONE) quest.setStage(player, STAGE_CELLAR_DONE);
        fadeMove(player, () => player.moveTo(ROOM_OUTSIDE));
        return;
      case "saoG_F":
        event.handled = true;
        if (stageOf(player) < STAGE_ACCUSATIONS) quest.setStage(player, STAGE_ACCUSATIONS);
        player.moveTo(TOP_FLOOR);
        openAccusation(player);
        return;
      case "fAjuOG":
        event.handled = true;
        startAdalaFight(player);
        return;
      case "k5CJTB":
        removeTracked(player, "adala-boss");
        event.handled = true;
        if (stageOf(player) < STAGE_ADALA_GONE) quest.setStage(player, STAGE_ADALA_GONE);
        return;
      case "QJgNYI":
        if (stageOf(player) < STAGE_ACCUSATION_DONE) quest.setStage(player, STAGE_ACCUSATION_DONE);
        Scenes.end(player, false);
        return;
      case '33aVQJ':
        event.handled = true; stageStrike(player, 3, 1, [1470, 2936]); player.setAttribute(flagKey('fight.step'), 1); return;
      case '-7LlHY':
        event.handled = true; stageStrike(player, 5, 3, null, true); return;
      case 'Ek_VQn':
        event.handled = true; stageStrike(player, 8, 4, [1472, 2931]); player.setAttribute(flagKey('fight.step'), 3); return;
      case '_5FOD1': case 'PZ_3g5':
        event.handled = true; return;
      case "lPk2UZ":
        event.handled = true;
        if (stageOf(player) < 40) { event.end = true; return; }
        if (!hasItem(player, PROP_SWORD)) addItem(player, PROP_SWORD);
        if (stageOf(player) < STAGE_ON_STAGE) quest.setStage(player, STAGE_ON_STAGE);
        setFlag(player, "on.stage");
        player.setAttribute(flagKey("fight.step"), 0);
        openStage(player);
        player.moveTo(new Location(1472, 2929, 0));
        return;
      case "FuqU1o":
        event.handled = true;
        setFlag(player, "on.stage", false);
        player.moveTo(BACKSTAGE_INSIDE);
        return;
      case "_CJ2qe":
      case "-y3JVZ":
        event.handled = true;
        setFlag(player, "on.stage");
        player.moveTo(STAGE_LANDING);
        return;
      case "SWcdkt":
        event.handled = true;
        stageStrike(player, 4, 5, null);
        return;
      case "wdaiPu":
        event.handled = true;
        setFlag(player, "on.stage", false);
        removeTracked(player, "naiatli");
        removeTracked(player, "clodius");
        removeItems(player, PROP_SWORD);
        Scenes.end(player, false);
        player.moveTo(FINAL_VILLA);
        if (stageOf(player) < STAGE_CASE_CLOSED) quest.setStage(player, STAGE_CASE_CLOSED);
        return;
      case "-1VVkQ":
        removeItems(player, ICON);
        player.getPacketSender().sendVarbit(VARBIT_ALDARIN_PENDANT, 1);
        return;
      case "owpmxZ":
        event.handled = true;
        return;
      default:
        return;
    }
  }

  function maybeBackstageStage(player) {
    if (allBackstage(player) && ['chat.bookshelf','chat.clothing','chat.poison','chat.actors'].every(flag => hasFlag(player, flag)) && stageOf(player) < STAGE_BACKSTAGE_DONE) {
      quest.setStage(player, STAGE_BACKSTAGE_DONE);
    }
  }

  // ==========================================================================
  // Items
  // ==========================================================================

  const INSPECT_ITEMS = new Map([
    [DRINKING_FLASK, { flag: "inspected.flask", variant: "the-investigation-inspecting-drinking-flask" }],
    [THREATENING_NOTE, { flag: "inspected.letter", variant: "the-investigation-inspecting-threatening-note" }],
    [SHIPPING_CONTRACT, { flag: "inspected.contract", variant: "the-investigation-inspecting-shipping-contract" }],
    [WINE_LABELS, { flag: "inspected.labels", variant: "the-investigation-inspecting-wine-labels" }],
  ]);

  function handleItemAction(event) {
    const { player, itemId, option } = event;
    if (!player || option !== "Inspect") return;
    const info = INSPECT_ITEMS.get(itemId);
    if (!info) return;
    event.handled = true;
    setFlag(player, info.flag);
    playVariant(player, STRADIUS, info.variant);
  }

  // ==========================================================================
  // Objects
  // ==========================================================================

  function wanderingGuardNear(player) {
    const world = api.getWorld?.();
    if (!world?.getNpcs) return false;
    const location = player.getLocation();
    for (const npc of world.getNpcs()) {
      if (npc?.getId?.() !== WANDERING_GUARD) continue;
      const npcLocation = npc.getLocation?.();
      if (!npcLocation) continue;
      // The world spawn stands 6 tiles west of the window and never wanders
      // (npc-spawns.json wanderRadius 0), so only an in-your-face guard blocks.
      if (
        Math.abs(npcLocation.getX() - location.getX()) <= 4 &&
        Math.abs(npcLocation.getY() - location.getY()) <= 4
      ) {
        return true;
      }
    }
    return false;
  }

  function handleHouseWindow(event) {
    const { player } = event;
    const stage = stageOf(player);
    if (quest.isComplete(player) || stage < STAGE_STARTED || stage >= STAGE_ENTERED) return;
    const inside =
      player.getLocation().getX() >= 1392 &&
      player.getLocation().getX() <= 1402 &&
      player.getLocation().getY() >= 2967 &&
      player.getLocation().getY() <= 2977;
    event.handled = true;
    if (inside) {
      player.moveTo(WINDOW_OUTSIDE);
      return;
    }
    if (wanderingGuardNear(player)) {
      playVariant(
        player,
        WANDERING_GUARD,
        "getting-a-uniform-attempting-to-enter-the-house-window-while-in-view-of-the-guard"
      );
      return;
    }
    player.moveTo(WINDOW_INSIDE);
    playVariant(player, PATZI, "getting-a-uniform-sneaking-in");
  }

  function handleWardrobe(event) {
    const { player } = event;
    const stage = stageOf(player);
    if (stage < STAGE_STARTED || stage >= STAGE_ENTERED) return;
    event.handled = true;
    if (hasAnyUniform(player)) {
      playVariant(player, PATZI, "getting-a-uniform-attempting-to-steal-another-uniform");
      return;
    }
    if (player.getInventory().getFreeSlots() < 2) { player.sendMessage('You need two free inventory spaces.'); return; }
    addItem(player, UNIFORM_TOP);
    addItem(player, UNIFORM_BOTTOM);
    playVariant(player, PATZI, "getting-a-uniform-stealing-a-uniform");
  }

  function handleCellarEntrance(event) {
    const { player } = event;
    const stage = stageOf(player);
    event.handled = true;
    if (stage < STAGE_WINE_REQUEST) {
      playVariant(player, PATZI, "inside-villa-lucens-attempting-to-enter-the-cellar-before-being-asked-to");
      return;
    }
    // The cellar multi-locs only offer their Investigate option from varbit 18
    // (55379's transform table), so entering the cellar is the "in the cellar"
    // checkpoint (Quest Helper's getWineStep sits on 18 too).
    if (stage < STAGE_WINE_INVESTIGATED) quest.setStage(player, STAGE_WINE_INVESTIGATED);
    player.moveTo(CELLAR_INSIDE);
  }

  function handleAntiqueWine(event) {
    const { player } = event;
    if (stageOf(player) < STAGE_WINE_REQUEST) return;
    event.handled = true;
    if (hasFlag(player, "wine")) {
      const variant = stageOf(player) >= STAGE_INTERROGATED
        ? "the-investigation-investigating-the-antique-wine"
        : "inside-villa-lucens-attempting-to-investigate-the-antique-wine-again";
      playVariant(player, STRADIUS, variant);
      return;
    }
    playVariant(player, STRADIUS, "inside-villa-lucens-investigating-the-antique-wine");
  }

  function handleClueObject(event, info) {
    const { player } = event;
    if (stageOf(player) < STAGE_INTERROGATED) return;
    event.handled = true;
    setFlag(player, info.flag);
    maybeClueStage(player);
    playVariant(player, STRADIUS, info.variant);
  }

  function handleLooseRocks(event, objectId) {
    const { player } = event;
    const stage = stageOf(player);
    if (stage < STAGE_ACCUSATION_DONE) {
      event.handled = true;
      playVariant(player, HUTZA, "the-backstage-attempting-to-climb-up-the-loose-rocks-before-being-asked-to");
      return;
    }
    event.handled = true;
    if (objectId === LOOSE_ROCKS_DOWN) {
      player.moveTo(ROCK_SECOND_TOP);
      return;
    }
    if (stage < STAGE_THEATRE) quest.setStage(player, STAGE_THEATRE);
    player.moveTo(ROCK_FIRST_TOP);
  }

  function handleCrate(event) {
    const { player } = event;
    const stage = stageOf(player);
    if (stage < STAGE_THEATRE_GUARDS || stage >= STAGE_NAIATLI_ACCUSED) return;
    event.handled = true;
    if (hasFlag(player, "backstage.bookshelf") && hasFlag(player, "backstage.clothing")) {
      playVariant(player, COSTUMER, "the-backstage-searching-the-crate-after-investigating-other-clues");
      return;
    }
    playVariant(player, COSTUMER, "the-backstage-searching-the-crate-before-investigating-other-clues");
  }

  function handleBackstageEntrance(event) {
    const { player } = event;
    const stage = stageOf(player);
    event.handled = true;
    if (stage < STAGE_THEATRE_GUARDS || !hasFlag(player, 'backstage.intro')) {
      playVariant(
        player,
        STRADIUS,
        "the-backstage-attempting-to-enter-through-the-backstage-entrance-before-talking-to-hutza-or-stradius"
      );
      return;
    }
    player.moveTo(BACKSTAGE_INSIDE);
  }

  function handleFancyChest(event) {
    const { player } = event;
    event.handled = true;
    if (!quest.isComplete(player)) {
      if (stageOf(player) < STAGE_ADALA_GONE) {
        playVariant(player, STRADIUS, "inside-villa-lucens-attempting-to-open-the-fancy-chest");
      }
      return;
    }
    if (hasFlag(player, "chest.opened")) return;
    if (!hasItem(player, CHEST_KEY)) {
      playVariant(player, STRADIUS, "inside-villa-lucens-attempting-to-open-the-fancy-chest");
      return;
    }
    removeItems(player, CHEST_KEY);
    setFlag(player, "chest.opened");
    player.getPacketSender().sendVarbit(VARBIT_ATES_PIECE_HUNT, 1);
    playVariant(player, STRADIUS, "post-quest-dialogue-opening-the-chest");
  }

  function handleFountain(event) {
    const { player } = event;
    if (!quest.isComplete(player) || !hasFlag(player, "chest.opened") || hasFlag(player, "icon.found")) return;
    event.handled = true;
    playVariant(player, STRADIUS, "post-quest-dialogue-searching-the-south-western-fountain");
  }

  function handleStatue(event) {
    const { player } = event;
    if (!hasItem(player, ICON)) return;
    event.handled = true;
    playVariant(player, COSTUMER, "post-quest-dialogue-activating-the-aldarin-statue");
  }

  function handleObjectInteraction(event) {
    const { player } = event;
    if (!player) return;
    const objectId = event.definition?.id ?? event.objectId;
    switch (objectId) {
      case HOUSE_WINDOW:
        return handleHouseWindow(event);
      case WARDROBE_UNIFORM:
      case WARDROBE_UNIFORM_TAKE:
        return handleWardrobe(event);
      case CELLAR_ENTRANCE:
        return handleCellarEntrance(event);
      case ANTIQUE_WINE:
        return handleAntiqueWine(event);
      case JUG:
        return handleClueObject(event, { flag: "clue.jug", variant: "the-investigation-investigating-jug" });
      case BROKEN_POTTERY:
        return handleClueObject(event, { flag: "clue.pottery", variant: "the-investigation-investigating-broken-pottery" });
      case WINE_STORAGE:
        return handleClueObject(event, { flag: "clue.storage", variant: "the-investigation-investigating-wine-storage" });
      case SMALL_BOX:
        return handleClueObject(event, { flag: "clue.box", variant: "the-investigation-investigating-small-box" });
      case BROKEN_STOOL:
        return handleClueObject(event, { flag: "clue.stool", variant: "the-investigation-investigating-broken-stool" });
      case CELLAR_STAIR_EXIT_VILLA:
        event.handled = true;
        player.moveTo(CELLAR_STAIR_OUT);
        return;
      case CELLAR_STAIR_EXIT_BACKSTAGE:
        event.handled = true;
        player.moveTo(THEATRE_OUTSIDE);
        return;
      case COSTUME_RACK:
        if (stageOf(player) < STAGE_THEATRE_GUARDS || stageOf(player) >= STAGE_NAIATLI_ACCUSED) return;
        event.handled = true;
        setFlag(player, "backstage.clothing");
        maybeBackstageStage(player);
        playVariant(player, COSTUMER, "the-backstage-searching-the-costume-rack");
        return;
      case BACKSTAGE_ENTRANCE:
        return handleBackstageEntrance(event);
      case LOOSE_ROCKS_FIRST:
      case LOOSE_ROCKS_SECOND:
      case LOOSE_ROCKS_DOWN:
        return handleLooseRocks(event, objectId);
      case BOOKSHELF_CLOSED:
      case BOOKSHELF_OPEN:
        if (stageOf(player) < STAGE_THEATRE_GUARDS || stageOf(player) >= STAGE_NAIATLI_ACCUSED) return;
        event.handled = true;
        setFlag(player, "backstage.bookshelf");
        maybeBackstageStage(player);
        playVariant(player, COSTUMER, "the-backstage-searching-the-bookshelf");
        return;
      case BOOKSHELF_PASSAGE:
        event.handled = true;
        player.moveTo(VILLA_CELLAR_FROM_PASSAGE);
        return;
      case CRATE_POISON:
        return handleCrate(event);
      case FANCY_CHEST:
        return handleFancyChest(event);
      case FOUNTAIN:
      case FOUNTAIN_SEARCH:
        return handleFountain(event);
      case STATUE_INACTIVE:
        return handleStatue(event);
      case ENTRYWAY:
        if (stageOf(player) >= STAGE_ENTERED && !quest.isComplete(player)) {
          event.handled = true;
          playVariant(player, VILLA_GUARD, "getting-inside-the-villa-attempting-to-enter-through-the-guest-entrance");
        }
        return;
      case INTERROGATION_DOOR:
        if (stageOf(player) === STAGE_ARRESTED) {
          event.handled = true;
          playVariant(player, HUTZA_2, "inside-villa-lucens-attempting-to-open-the-room-s-door-before-finishing-the-conversation");
        }
        return;
      default:
        return;
    }
  }

  // ==========================================================================
  // Login / logout
  // ==========================================================================

  function handleLogin({ player }) {
    cullLeakedSpawns(player);
    if (player.getAttribute(STAGE_VERSION_ATTRIBUTE) !== 1) {
      player.setAttribute(STAGE_VERSION_ATTRIBUTE, 1);
      const mapped = { 4: 6, 10: 12, 12: 14, 14: 15, 21: 22, 32: 33, 33: 34, 34: 36, 38: 40 }[stageOf(player)];
      if (mapped != null) quest.setStage(player, mapped);
    }
    if (hasFlag(player, "fight.active")) {
      // An interrupted fight resumes from its earned checkpoint, without a free victory.
      setFlag(player, "fight.active", false);
      removeTracked(player, "adala-boss");
      setFightOutcome(player, 0);
    }
    syncVarbits(player);
    if (stageOf(player) >= 28 && stageOf(player) <= 33 && player.getLocation().getZ() === 2) openAccusation(player);
    if (stageOf(player) >= 42 && stageOf(player) < 49 && player.getLocation().getY() < 3000) openStage(player);
    syncSpawns(player);
    refreshQuestList(player);
  }

  function handleLogout({ player }) {
    if (!player) return;
    clearChangingBookshelf(player);
    removeAllSpawns(player);
    Scenes.end(player, true); Scenes.cancel(player);
  }

  // ==========================================================================
  // Journal and rewards
  // ==========================================================================

  function buildJournal(player, handle) {
    const stage = handle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I posed as a butler at Villa Lucens and helped the guards</str>",
        "<str>investigate Livius' murder, proving it was Naiatli.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_ON_STAGE) {
      return [
        "<str>I searched the backstage area and deduced that Naiatli killed Livius.</str>",
        "I went on <col=800000>stage</col> to confront her. When it is done, I",
        "should discuss things with <col=800000>Stradius</col> and <col=800000>Hutza</col>.",
      ];
    }
    if (stage >= STAGE_BACKSTAGE_DONE) {
      return [
        "<str>I searched the backstage area and found the poison, the passage and</str>",
        "<str>Naiatli's wine-stained costume.</str>",
        "Tell <col=800000>Stradius</col> and <col=800000>Hutza</col> who I believe did it.",
      ];
    }
    if (stage >= STAGE_THEATRE) {
      return [
        "<str>The play went ahead and I took the cliff path to the theatre.</str>",
        "Search the <col=800000>backstage area</col> for any new clues.",
      ];
    }
    if (stage >= STAGE_ADALA_GONE) {
      return [
        "<str>I accused Adala of the murder; she admitted the theft, not the</str>",
        "<str>murder, and was escorted away.</str>",
        "Speak to <col=800000>Stradius</col> and <col=800000>Hutza</col> about what to do next.",
      ];
    }
    if (stage >= STAGE_ACCUSATIONS) {
      return [
        "<str>The guards gathered the suspects upstairs.</str>",
        "Question everyone, then decide who to <col=800000>accuse</col>.",
      ];
    }
    if (stage >= STAGE_EVIDENCE) {
      return [
        "<str>I gave the guards the note, contract, flask and labels.</str>",
        "Tell them I am ready to make an <col=800000>accusation</col>.",
      ];
    }
    if (stage >= STAGE_PICKPOCKET) {
      return [
        "<str>The guards let me pickpocket the suspects for evidence.</str>",
        "Pick the pockets and inspect what I find.",
      ];
    }
    if (stage >= STAGE_REPORTED) {
      return [
        "<str>I reported my cellar findings to the guards.</str>",
        "They suggested searching the suspects' <col=800000>pockets</col>.",
      ];
    }
    if (stage >= STAGE_CELLAR_DONE) {
      return [
        "<str>I examined the cellar crime scene and the body.</str>",
        "Tell <col=800000>Stradius</col> and <col=800000>Hutza</col> what I found.",
      ];
    }
    if (stage >= STAGE_INTERROGATED) {
      return [
        "<str>The guards let me help investigate Livius' murder.</str>",
        "Search the <col=800000>wine cellar</col> for clues.",
      ];
    }
    if (stage >= STAGE_ARRESTED) {
      return [
        "<str>I found a body in the wine cellar and was arrested.</str>",
        "Talk my way out of it with <col=800000>Stradius</col> and <col=800000>Hutza</col>.",
      ];
    }
    if (stage >= STAGE_BODY_FOUND) {
      return [
        "<str>I heard a crash in the cellar and found a body.</str>",
        "Check on the <col=800000>man</col> on the floor.",
      ];
    }
    if (stage >= STAGE_WINE_INVESTIGATED) {
      return [
        "<str>I found the Principum Red but spilled it at a crash.</str>",
        "Investigate the <col=800000>noise</col> in the cellar.",
      ];
    }
    if (stage >= STAGE_WINE_REQUEST) {
      return [
        "<str>Patzi asked me to fetch him a glass of Principum Red.</str>",
        "Find the <col=800000>wine</col> in the cellar.",
      ];
    }
    if (stage >= STAGE_MET_GUESTS) {
      return [
        "<str>I met the host and the guests for Patzi.</str>",
        "Tell <col=800000>Patzi</col> what I learnt.",
      ];
    }
    if (stage >= STAGE_PATZI_INSIDE) {
      return [
        "<str>I entered Villa Lucens as a butler.</str>",
        "Meet the <col=800000>host</col> and the <col=800000>guests</col>.",
      ];
    }
    if (stage >= STAGE_ENTERED) {
      return [
        "<str>I entered Villa Lucens as a butler.</str>",
        "Find <col=800000>Patzi</col> inside.",
      ];
    }
    if (stage >= STAGE_UNIFORM_WORN) {
      return [
        "<str>I have the butler's uniform.</str>",
        "Wear it and talk to the <col=800000>head butler</col> at the staff entrance.",
      ];
    }
    if (stage >= STAGE_ADALA_INSIDE) {
      return [
        "<str>I showed Patzi the uniform and Adala headed inside.</str>",
        "Follow the hedge to the <col=800000>staff entrance</col>.",
      ];
    }
    if (stage >= STAGE_UNIFORM) {
      return [
        "<str>I stole a butler's uniform from a villa to the north.</str>",
        "Return to <col=800000>Patzi</col>.",
      ];
    }
    if (stage >= STAGE_WINDOW) {
      return ["I broke into the villa through the window.", "Take a <col=800000>uniform</col> from the wardrobe."];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "<str>Patzi asked me to help him sneak into Villa Lucens as a butler.</str>",
        "Find a spare <col=800000>butler's uniform</col> in the villa to the north.",
      ];
    }
    return [
      "I can start this quest by talking to <col=800000>Patzi</col> outside",
      "<col=800000>Villa Lucens</col> on <col=800000>Aldarin</col>.",
    ];
  }

  function grantReward(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.THIEVING, 10000);
    skills.addExperiences(Skill.AGILITY, 7500);
    skills.addExperiences(Skill.CRAFTING, 5000);
    removeItems(player, PROP_SWORD);
    player.getPacketSender().sendVarbit(VARBIT_ALDARIN_PENDANT, hasFlag(player, "icon.found") ? 1 : 0);
  }

  // ==========================================================================
  // Registration
  // ==========================================================================

  for (const flag of [...FLAG_NAMES, ...NON_BIT_FLAGS, "mask", "fight.outcome", "fight.step"]) {
    api.persistAttribute(flagKey(flag));
  }

  api.persistAttribute(GEAR_ATTRIBUTE, null);
  api.persistAttribute(VILLA_GEAR_ATTRIBUTE, null);
  api.persistAttribute(STAGE_VERSION_ATTRIBUTE, 0);
  api.persistAttribute(FINAL_FIGHT_ATTRIBUTE, 0);

  quest = registerQuest(api, {
    key: "death_on_the_isle",
    name: "Death on the Isle",
    varpId: 4401,
    varbitId: STAGE_VARBIT,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    scrollItemId: MASKS[0],
    xpRewards: [
      { skillId: Skill.THIEVING.getIndex(), amount: 10000, label: "Thieving" },
      { skillId: Skill.AGILITY.getIndex(), amount: 7500, label: "Agility" },
      { skillId: Skill.CRAFTING.getIndex(), amount: 5000, label: "Crafting" },
    ],
    otherRewards: [
      "A costume needle from the costumer",
      "The masks and butler's tray from the Head Butler",
      "The North Aldarin teleport on the Pendant of Ates",
    ],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcInteraction(handleNpcInteraction);
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemAction(handleItemAction);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:hook", handleHook);
  api.onCustomEvent("quest:stage-changed", handleStageChanged);
  api.onNpcDeath(handleNpcDeath);
  api.onNpcBeforeDeath(preventAdalaDeath);
  api.onCombatHitResolved(fightHit);
  api.registerCombatMethodResolver({ resolve: resolveStageCombat });
  api.onPlayerBeforeDeath(handlePlayerBeforeDeath);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
