/**
 * Grim Tales (members).
 *
 * The words come from the "Grim Tales" transcript page (research pack
 * /tmp/tsps-quest-dumps/GrimTales.page.json); this plugin supplies the variant
 * selection for Sylas, Grimgnash, Rupert and Miazrqa, the prose-condition
 * answers, the missing quest scenery, the item/object interactions and the reward.
 *
 * Stages (varbit 2783 "grim_quest", varp 1016; confirmed with
 * `./node_modules/.bin/ts-node scripts/lookup-gameval.ts varbit grim`):
 *   0 not started
 *   1 Sylas asked for the griffin feather and Rupert's helmet
 *   2 feather given to Sylas
 *   3 met Rupert in the tower (he asks you to speak to Miazrqa)
 *   4 Miazrqa asked for her pendant; door key available
 *   5 pendant taken from the mouse hole
 *   6 pendant returned; Rupert freed and gave his helmet
 *   7 helmet given to Sylas; magic beans and the golden goblin story received
 *   8 beans planted in the earth mound
 *   9 beanstalk grown (watering-can stage done)
 *  10 Glod defeated; golden goblin on the ground
 *  11 golden goblin given to Sylas; he asks for the beanstalk to be cut down
 *  12 beanstalk shrunk with shrink-me-quick
 *  13 beanstalk chopped down
 *  14 complete
 *
 * Source: OSRS Wiki (https://oldschool.runescape.wiki/w/Grim_Tales, /Quick_guide
 * and /Transcript:Grim_Tales), plus the cache dumps for ids and placements.
 *
 * Gaps / approximations:
 * - the cache map has no placement for the earth mound (24730/24731), the
 *   beanstalks (24733/24735/24738), the piano (24721/24722), the music stand
 *   (24728), the beard (24767) or the pendant (24780); the plugin registers
 *   them at their wiki tiles on first login. Growing/shrinking/chopping swaps
 *   the world object, so the beanstalk is shared world state, not per-player;
 * - the piano has no cache interface: Play opens a two-step chatbox prompt
 *   (right-hand keys, then left-hand keys) instead of the piano interface;
 * - the music sheet is given silently (the transcript page has no line for
 *   searching the music stand);
 * - Grimgnash's lash-out drains 20% of current hitpoints (wiki) but is floored
 *   at 1 hitpoint so the chat cannot kill;
 * - drinking shrink-me-quick near the witch's house teleports straight into the
 *   mouse-hole map (no shrink timer); the mouse-hole exits teleport back to the
 *   witch's house cellar;
 * - the tower door and the trapdoor are shown locked for the whole quest (the
 *   princess cut-scene is flavour); the crumbling wall's Thieving and the
 *   beard's Agility checks use current (boostable) levels;
 * - start requirements (Witch's House and the five skills) are checked in the
 *   transcript's requirement condition;
 * - quest-scoped transcript replays all use one chathead (the transcript runner
 *   flattens multi-speaker pages), so a few cut-scene lines show the wrong head;
 * - Miazrqa's pendant menu "jump above"/"previous" jumps re-enter the branch they
 *   are in, so stage 3's variant is preprocessed (fixPendantSteps) to keep the
 *   "I need a key for the house." branch reachable;
 * - the finishing-up page's "Quest complete!" action sits after an end marker and
 *   never plays, so completion is driven by Sylas's last epilogue line.
 */
module.exports = function registerGrimTalesQuest(api) {
  const {
    Equipment,
    GameObject,
    Item,
    ItemDefinition,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    ObjectIdentifiers,
    ObjectManager,
    Skill,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript, loadTranscripts } = require("../QuestRuntime");

  const PAGE = "Grim Tales";

  // Chatheads (the indexed transcript pages), used for every replay.
  const SYLAS_NPC_ID = NpcIdentifiers.SYLAS; // 5118
  const GRIMGNASH_NPC_ID = NpcIdentifiers.GRIMGNASH; // 5119
  const RUPERT_NPC_ID = NpcIdentifiers.RUPERT_THE_BEARD; // 5120, tower spawn
  const RUPERT_NPC_IDS = new Set([
    NpcIdentifiers.RUPERT_THE_BEARD, // 5120
    NpcIdentifiers.RUPERT_THE_BEARD_2, // 5121
    NpcIdentifiers.RUPERT_THE_BEARD_3, // 5123
    NpcIdentifiers.RUPERT_THE_BEARD_4, // 5124
  ]);
  const MIAZRQA_NPC_ID = NpcIdentifiers.MIAZRQA; // 5125
  const MIAZRQA_PENDANT_VARIANT = "looking-for-miazrqa-s-pendant";
  const DWARF_OPTION_PREFIX = "I see there is an embarrassed-looking dwarf";
  const GLOD_NPC_ID = NpcIdentifiers.GLOD; // 5129
  const DRAIN_PIPE_NPC_ID = 5122; // "Drain pipe"; no generated identifier (cache dump)
  const GRIM_DIALOGUE_NPC_IDS = new Set([
    SYLAS_NPC_ID,
    GRIMGNASH_NPC_ID,
    RUPERT_NPC_ID,
    MIAZRQA_NPC_ID,
    DRAIN_PIPE_NPC_ID,
  ]);

  const VARP_GRIM_TALES = 1016; // "grim_quest" sits at bits 0-7
  const VARBIT_GRIM_TALES = 2783;

  const STAGE_STARTED = 1;
  const STAGE_FEATHER_GIVEN = 2;
  const STAGE_RUPERT_MET = 3;
  const STAGE_PENDANT_TASK = 4;
  const STAGE_PENDANT_FOUND = 5;
  const STAGE_RUPERT_FREED = 6;
  const STAGE_BEANS_OBTAINED = 7;
  const STAGE_BEAN_PLANTED = 8;
  const STAGE_BEANSTALK_GROWN = 9;
  const STAGE_GOBLIN_OBTAINED = 10;
  const STAGE_GOBLIN_GIVEN = 11;
  const STAGE_STALK_SHRUNK = 12;
  const STAGE_STALK_CUT = 13;
  const STAGE_COMPLETE = 14;
  // Native completion floor: cache DB row 68 column 19, read by script 4024/4029.
  // Quest Helper's last loadSteps key is 50; the cache requires grim_quest >= 60.
  const COMPLETION_VARBIT_VALUE = 60;
  const QH_VARBITS = {
    griffinAsleep: 3717,
    dwarfQuest: 3694,
    dwarfVisible: 3701,
    stalkState: 3714,
    giantDead: 3715,
    headFound: 3716,
    pianoTrack: 3697,
    pianoUsed: 3698,
    rupertTowerVisible: 3711,
    featherGiven: 3719,
    pendantHeld: 3721,
  };

  // Items (ItemIdentifiers.ts).
  const GRIFFIN_FEATHER_ITEM_ID = ItemIdentifiers.GRIFFIN_FEATHER; // 11196
  const MIAZRQAS_PENDANT_ITEM_ID = ItemIdentifiers.MIAZRQAS_PENDANT; // 11197
  const MUSIC_SHEET_ITEM_ID = ItemIdentifiers.MUSIC_SHEET; // 11198
  const RUPERTS_HELMET_ITEM_ID = ItemIdentifiers.RUPERTS_HELMET; // 11199
  const DWARVEN_HELMET_ITEM_ID = ItemIdentifiers.DWARVEN_HELMET; // 11200
  const SHRINKING_RECIPE_ITEM_ID = ItemIdentifiers.SHRINKING_RECIPE; // 11202
  const TO_DO_LIST_ITEM_ID = ItemIdentifiers.TO_DO_LIST; // 11203
  const SHRINK_ME_QUICK_ITEM_ID = ItemIdentifiers.SHRINK_ME_QUICK; // 11204
  const SHRUNK_OGLEROOT_ITEM_ID = ItemIdentifiers.SHRUNK_OGLEROOT; // 11205
  const GOLDEN_GOBLIN_ITEM_ID = ItemIdentifiers.GOLDEN_GOBLIN; // 11210
  const MAGIC_BEANS_ITEM_ID = ItemIdentifiers.MAGIC_BEANS; // 11211
  const DOOR_KEY_ITEM_ID = ItemIdentifiers.DOOR_KEY; // 2409, "a key to the Witch's house's front door"
  const SEED_DIBBER_ITEM_ID = ItemIdentifiers.SEED_DIBBER; // 5343
  const TARROMIN_POTION_UNF_ITEM_IDS = new Set([
    ItemIdentifiers.TARROMIN_POTION_UNF_, // 95
    ItemIdentifiers.TARROMIN_POTION_UNF__2, // 96
  ]);
  // Full watering can -> next dose down; 5331 is the empty can.
  const WATERING_CAN_DOSES = new Map([
    [ItemIdentifiers.WATERING_CAN_8_, ItemIdentifiers.WATERING_CAN_7_],
    [ItemIdentifiers.WATERING_CAN_7_, ItemIdentifiers.WATERING_CAN_6_],
    [ItemIdentifiers.WATERING_CAN_6_, ItemIdentifiers.WATERING_CAN_5_],
    [ItemIdentifiers.WATERING_CAN_5_, ItemIdentifiers.WATERING_CAN_4_],
    [ItemIdentifiers.WATERING_CAN_4_, ItemIdentifiers.WATERING_CAN_3_],
    [ItemIdentifiers.WATERING_CAN_3_, ItemIdentifiers.WATERING_CAN_2_],
    [ItemIdentifiers.WATERING_CAN_2_, ItemIdentifiers.WATERING_CAN_1_],
    [ItemIdentifiers.WATERING_CAN_1_, ItemIdentifiers.WATERING_CAN],
  ]);

  // Objects (ObjectIdentifiers.ts).
  const TOWER_DOOR_OBJECT_ID = ObjectIdentifiers.DOOR_500; // 24759
  const CRUMBLING_WALL_OBJECT_IDS = new Set([
    ObjectIdentifiers.CRUMBLING_WALL_4, // 24749
    ObjectIdentifiers.CRUMBLING_WALL_5, // 24880
  ]);
  const DRAIN_PIPE_OBJECT_ID = ObjectIdentifiers.DRAIN_PIPE; // 24723
  const BEARD_OBJECT_ID = ObjectIdentifiers.BEARD; // 24767
  const TOWER_TRAPDOOR_OBJECT_ID = ObjectIdentifiers.TRAPDOOR_63; // 15523
  const FEATHERS_OBJECT_ID = ObjectIdentifiers.FEATHERS; // 24841
  const MOUND_SIGNPOST_OBJECT_ID = ObjectIdentifiers.SIGNPOST_28; // 15522, by the earth mound
  const PIANO_OBJECT_ID = ObjectIdentifiers.PIANO_5; // 24721, Play
  const PIANO_OPEN_OBJECT_ID = ObjectIdentifiers.PIANO_6; // 24722, Play + Search
  const MUSIC_STAND_OBJECT_ID = ObjectIdentifiers.MUSIC_STAND; // 24728
  const EARTH_MOUND_OBJECT_ID = ObjectIdentifiers.EARTH_MOUND; // 24730
  const BEAN_MOUND_OBJECT_ID = ObjectIdentifiers.BEAN_MOUND; // 24731
  const BEANSTALK_OBJECT_ID = ObjectIdentifiers.BEANSTALK_2; // 24733, Climb + Chop
  const SHRUNK_BEANSTALK_OBJECT_ID = ObjectIdentifiers.BEANSTALK_4; // 24735, Chop
  const BEANSTUMP_OBJECT_ID = ObjectIdentifiers.BEANSTUMP; // 24738
  const CLOUD_BEANSTALK_OBJECT_ID = ObjectIdentifiers.BEANSTALK_7; // 24819, Climb-down
  const PENDANT_OBJECT_ID = ObjectIdentifiers.PENDANT; // 24780
  const MOUSE_HOLE_OBJECT_ID = ObjectIdentifiers.MOUSE_HOLE_3; // 24799
  const GRATE_OBJECT_ID = ObjectIdentifiers.GRATE; // 24802
  const NAILS_UP_OBJECT_ID = ObjectIdentifiers.NAILS; // 24795
  const NAILS_DOWN_OBJECT_ID = ObjectIdentifiers.NAILS_2; // 24796
  const WITCH_HOUSE_DOOR_OBJECT_ID = ObjectIdentifiers.DOOR_102; // 2861
  const BEANSTALK_OBJECT_IDS = new Set([BEANSTALK_OBJECT_ID, SHRUNK_BEANSTALK_OBJECT_ID]);
  const PIANO_OBJECT_IDS = new Set([PIANO_OBJECT_ID, PIANO_OPEN_OBJECT_ID]);

  // World tiles (wiki pins; the mound/beanstalk objects come from the cache map
  // signpost and the "Earth Mound" page: x=2921 y=3424 pin, 3x3 object).
  const EARTH_MOUND_TILE = { x: 2920, y: 3423, z: 0 };
  const BEARD_GROUND_TILE = { x: 2966, y: 3464, z: 0 };
  const BEARD_TOP_TILE = { x: 2966, y: 3468, z: 2 };
  const TOWER_TOP_TILE = { x: 2968, y: 3468, z: 2 };
  const PIANO_TILE = { x: 2907, y: 9870, z: 0 }; // cache parent 24881, 2x1 piano
  const MUSIC_STAND_TILE = { x: 2900, y: 9875, z: 0 };
  const PENDANT_TILE = { x: 2262, y: 5516, z: 3 };
  const MOUSE_HOLE_ENTRY_TILE = { x: 2275, y: 5530, z: 0 };
  const CELLAR_TILE = { x: 2907, y: 9876, z: 0 };
  const GLOD_TILE = { x: 2148, y: 5528, z: 3 };

  const MOUSE_HOLE_AREA = { minX: 2895, maxX: 2915, minY: 3455, maxY: 3480 };
  const CELLAR_AREA = { minX: 2890, maxX: 2940, minY: 9855, maxY: 9885 };

  // Piano: the wiki tune is E F E D C (right hand), then A E G A (left hand).
  const PIANO_TUNE = ["upper-e", "upper-f", "upper-e", "upper-d", "upper-c", "a", "e", "g", "a"];
  const PIANO_INTERFACE_ID = 535;
  const PIANO_BUTTON_NOTES = new Map([
    [(PIANO_INTERFACE_ID << 16) | 77, "upper-e"],
    [(PIANO_INTERFACE_ID << 16) | 78, "upper-f"],
    [(PIANO_INTERFACE_ID << 16) | 76, "upper-d"],
    [(PIANO_INTERFACE_ID << 16) | 75, "upper-c"],
    [(PIANO_INTERFACE_ID << 16) | 73, "a"],
    [(PIANO_INTERFACE_ID << 16) | 70, "e"],
    [(PIANO_INTERFACE_ID << 16) | 72, "g"],
  ]);
  const PIANO_PROGRESS_ATTRIBUTE = "grim-tales:piano-progress";
  const PIANO_NOTE_MESSAGES = ["ZNc_gU", "J4H8Je", "p6_WrQ", "YyCouY", "-KzTuA", "oItvCU", "DOh0JW", "_Xs4C4", "4kmCmc"];
  const PIANO_OPEN_MESSAGE_ID = "j_cFAe";

  const BITS_ATTRIBUTE = "quest.grim_tales.bits";
  const RUPERT_HELMET_GIVEN_ATTRIBUTE = "grim-tales:rupert-helmet-given";
  const BIT_RUPERT_SPOKEN = 1 << 0;
  const BIT_RUPERT_INTRO = 1 << 1;
  const BIT_BEARD_DOWN = 1 << 2;
  const BIT_STORY_INTRO = 1 << 3;
  const BIT_GRIFFIN_ASLEEP = 1 << 4;
  const BIT_PIANO_OPEN = 1 << 5;
  const BIT_PIANO_SEARCHED = 1 << 6;

  // The Grimgnash story's "fast asleep" endings (message step ids).
  const GRIFFIN_SLEEP_STEP_IDS = new Set(["iJPYA9", "S259BU", "0aew0m", "aXvQHi"]);
  // The wrong-story lash-outs (action step ids).
  const GRIFFIN_LASH_STEP_IDS = new Set([
    "uTkcMa", "GWj6Rg", "rUuvyP", "5CqreZ", "EsUIwu", "9QZfVO", "qEadwe", "BmYTAz",
    "zZV-ZZ", "V0aEhm", "newYLJ", "kHapTe", "gzBAli", "rEGCdb", "JNKFvr", "c1fukz", "oIhtkX",
  ]);

  let quest;
  let worldInstalled = false;
  let messageIndex = null;
  const installedObjects = [];
  const glodByPlayer = new WeakMap();

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;

  function bits(player) {
    return Number(player.getAttribute(BITS_ATTRIBUTE)) || 0;
  }

  function hasBit(player, bit) {
    return (bits(player) & bit) !== 0;
  }

  function setBit(player, bit) {
    player.setAttribute(BITS_ATTRIBUTE, bits(player) | bit);
    syncQuestHelperState(player);
  }

  function pianoProgress(player) {
    return Math.max(0, Math.min(PIANO_TUNE.length, Number(player.getAttribute(PIANO_PROGRESS_ATTRIBUTE)) || 0));
  }

  function questHelperStageValue(stage, player) {
    if (stage >= STAGE_COMPLETE) return COMPLETION_VARBIT_VALUE;
    if (stage >= STAGE_STALK_CUT) return 50;
    if (stage >= STAGE_GOBLIN_GIVEN) return 40;
    if (stage >= STAGE_BEANSTALK_GROWN) return 30;
    if (stage >= STAGE_BEANS_OBTAINED) return 20;
    if (stage === STAGE_RUPERT_FREED && player?.getAttribute(RUPERT_HELMET_GIVEN_ATTRIBUTE)) return 19;
    if (stage >= STAGE_STARTED) return 10;
    return 0;
  }

  function syncQuestHelperState(player) {
    if (!quest) return;
    const stage = quest.getStage(player);
    let dwarfQuest = 0;
    if (stage >= STAGE_RUPERT_FREED) dwarfQuest = 25;
    else if (stage >= STAGE_PENDANT_TASK) dwarfQuest = 20;
    else if (stage >= STAGE_RUPERT_MET) dwarfQuest = 15;
    else if (hasBit(player, BIT_BEARD_DOWN)) dwarfQuest = 10;
    else if (hasBit(player, BIT_RUPERT_SPOKEN)) dwarfQuest = 5;
    const stalkState = stage >= STAGE_STALK_SHRUNK ? 3
      : stage >= STAGE_BEANSTALK_GROWN ? 2
       : stage >= STAGE_BEAN_PLANTED ? 1 : 0;
    player.getPacketSender()
      .sendVarbit(VARBIT_GRIM_TALES, questHelperStageValue(stage, player))
      .sendVarbit(QH_VARBITS.griffinAsleep, Number(hasBit(player, BIT_GRIFFIN_ASLEEP)))
      .sendVarbit(QH_VARBITS.dwarfQuest, dwarfQuest)
      .sendVarbit(QH_VARBITS.dwarfVisible, Number(stage >= STAGE_RUPERT_FREED))
      .sendVarbit(QH_VARBITS.stalkState, stalkState)
      .sendVarbit(QH_VARBITS.giantDead, Number(stage >= STAGE_GOBLIN_OBTAINED))
      .sendVarbit(QH_VARBITS.headFound, Number(hasBit(player, BIT_PIANO_SEARCHED)))
      .sendVarbit(QH_VARBITS.pianoTrack, pianoProgress(player))
      .sendVarbit(QH_VARBITS.pianoUsed, Number(hasBit(player, BIT_PIANO_OPEN)))
      .sendVarbit(QH_VARBITS.rupertTowerVisible, Number(hasBit(player, BIT_BEARD_DOWN)))
      .sendVarbit(QH_VARBITS.featherGiven, Number(stage >= STAGE_FEATHER_GIVEN))
      .sendVarbit(QH_VARBITS.pendantHeld,
        Number(stage === STAGE_PENDANT_FOUND && held(player, MIAZRQAS_PENDANT_ITEM_ID)));
  }

  function handleQuestStageChanged({ player, key }) {
    if (key === "grim_tales") syncQuestHelperState(player);
  }

  function playVariant(player, npcId, variant, select) {
    return startTranscript(api, player, npcId, PAGE, variant, select);
  }

  /** Text of a message step on the Grim Tales page, so replays stay on the wiki words. */
  function pageMessage(stepId) {
    if (!messageIndex) {
      messageIndex = new Map();
      const walk = (steps) => {
        for (const step of steps ?? []) {
          if (step.type === "message" && step.id) messageIndex.set(step.id, step.text);
          for (const option of step.options ?? []) walk(option.steps);
          walk(step.steps);
        }
      };
      const record = loadTranscripts(api)?.[PAGE];
      for (const steps of Object.values(record?.variants ?? {})) walk(steps);
    }
    return messageIndex.get(stepId);
  }

  function meetsRequirements(player) {
    const skills = player.getSkillManager();
    if (skills.getCurrentLevel(Skill.FARMING) < 45) return false;
    if (skills.getCurrentLevel(Skill.HERBLORE) < 52) return false;
    if (skills.getCurrentLevel(Skill.THIEVING) < 58) return false;
    if (skills.getCurrentLevel(Skill.AGILITY) < 59) return false;
    if (skills.getCurrentLevel(Skill.WOODCUTTING) < 71) return false;
    const request = { player, key: "witchs_house", complete: undefined };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function isAxe(itemId) {
    const name = String(ItemDefinition.forId(itemId)?.getName?.() ?? "");
    // "Dragon axe", "Rune axe", ... but not "Dragon battleaxe" or "Rune pickaxe".
    return /(^| )axe$/i.test(name);
  }

  function hasAxe(player) {
    const inventory = player.getInventory();
    for (let slot = 0; slot < 28; slot++) {
      const item = inventory.get(slot);
      if (item && isAxe(item.getId())) return true;
    }
    const weapon = player.getEquipment().get(Equipment.WEAPON_SLOT);
    return Boolean(weapon && isAxe(weapon.getId()));
  }

  /** Uses one watering-can dose; false when no can carries water. */
  function useWateringCan(player) {
    const inventory = player.getInventory();
    for (const [canId, nextId] of WATERING_CAN_DOSES) {
      if (held(player, canId)) {
        inventory.deleteNumber(canId, 1);
        inventory.adds(nextId, 1);
        return true;
      }
    }
    return false;
  }

  /** Mirror the player one tile across a wall object (ClockTower's step-through). */
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

  function nearArea(player, area) {
    const position = player.getLocation();
    return (
      position.getX() >= area.minX &&
      position.getX() <= area.maxX &&
      position.getY() >= area.minY &&
      position.getY() <= area.maxY
    );
  }

  // ---------------------------------------------------------------------------
  // World setup (scenery the cache maps do not place)
  // ---------------------------------------------------------------------------

  function sameTile(location, tile) {
    return location.getX() === tile.x && location.getY() === tile.y && location.getZ() === tile.z;
  }

  /** Event locations are plain { x, y, z } objects (sameTile takes a Location). */
  function atTile(location, tile) {
    return Boolean(location) && location.x === tile.x && location.y === tile.y && location.z === tile.z;
  }

  function registerQuestObject(objectId, tile, type = 10) {
    const object = new GameObject(objectId, new Location(tile.x, tile.y, tile.z), type, 0, null);
    ObjectManager.register(object, true);
    installedObjects.push(object);
    return object;
  }

  function swapQuestObject(oldId, newId, tile) {
    for (let index = installedObjects.length - 1; index >= 0; index--) {
      const object = installedObjects[index];
      if (object.getId() === oldId && sameTile(object.getLocation(), tile)) {
        ObjectManager.deregister(object, true);
        installedObjects.splice(index, 1);
      }
    }
    registerQuestObject(newId, tile);
  }

  function installWorld() {
    if (worldInstalled) return;
    worldInstalled = true;
    registerQuestObject(EARTH_MOUND_OBJECT_ID, EARTH_MOUND_TILE);
    registerQuestObject(BEARD_OBJECT_ID, BEARD_GROUND_TILE);
    registerQuestObject(BEARD_OBJECT_ID, BEARD_TOP_TILE);
    // The cache piano transforms per player from varbit 3698; do not register
    // a shared replacement object when one player solves the tune.
    registerQuestObject(MUSIC_STAND_OBJECT_ID, MUSIC_STAND_TILE);
    registerQuestObject(PENDANT_OBJECT_ID, PENDANT_TILE);
    // Grimgnash is already a cache spawn (6274, transformed to 5119 by grim_griffin_asleep).
    // Spawning 5119 here produced a second griffin at a different tile.
  }

  function ensureGlod(player) {
    if (glodByPlayer.has(player)) return;
    const npc = api.spawnNpc({
      id: GLOD_NPC_ID,
      x: GLOD_TILE.x,
      y: GLOD_TILE.y,
      z: GLOD_TILE.z,
      wanderRadius: 0,
      owner: player,
      ownerOnly: true,
    });
    if (npc) glodByPlayer.set(player, npc);
  }

  function removeGlod(player) {
    const npc = glodByPlayer.get(player);
    if (!npc) return;
    api.removeNpc(npc);
    glodByPlayer.delete(player);
  }

  function syncNpcs(player) {
    if (quest.getStage(player) === STAGE_BEANSTALK_GROWN) ensureGlod(player);
    else removeGlod(player);
  }

  // ---------------------------------------------------------------------------
  // Dialogue: variant selection, conditions, lines, choices, actions
  // ---------------------------------------------------------------------------

  function sylasVariant(player, stage) {
    if (stage >= STAGE_COMPLETE) return { page: "Sylas", variant: "after-grim-tales" };
    if (stage === 0) return "getting-started";
    if (stage === STAGE_STARTED) {
      return held(player, GRIFFIN_FEATHER_ITEM_ID)
        ? "obtaining-grimgnash-s-feather-giving-sylas-the-feather"
        : "getting-started-speaking-to-sylas-again";
    }
    if (stage === STAGE_RUPERT_FREED) {
      return held(player, RUPERTS_HELMET_ITEM_ID)
        || player.getAttribute(RUPERT_HELMET_GIVEN_ATTRIBUTE)
        ? "getting-sylas-magic-bean-returning-to-sylas"
        : "getting-started-speaking-to-sylas-again";
    }
    if (stage === STAGE_BEANS_OBTAINED && !held(player, MAGIC_BEANS_ITEM_ID)) {
      // No separate reclaim wording is present in the transcript. Reuse only its
      // canonical bean receipt tail, avoiding the false helmet hand-in conversation.
      return {
        variant: "getting-sylas-magic-bean-returning-to-sylas",
        select: selectBeanReceiptSteps,
      };
    }
    if (stage <= STAGE_PENDANT_FOUND) return "getting-started-speaking-to-sylas-again";
    if (stage <= STAGE_BEAN_PLANTED) return "getting-sylas-magic-bean-asking-sylas-about-the-bean-again";
    if (stage === STAGE_BEANSTALK_GROWN || stage === STAGE_GOBLIN_OBTAINED) {
      if (stage === STAGE_GOBLIN_OBTAINED && held(player, GOLDEN_GOBLIN_ITEM_ID)) {
        return "the-final-battle-speaking-to-sylas-after-defeating-glod";
      }
      return "the-final-battle-talking-to-sylas-after-growing-the-beanstalk";
    }
    if (stage <= STAGE_STALK_SHRUNK) return "the-final-battle-asking-sylas-how-to-cut-down-the-stock";
    if (stage === STAGE_STALK_CUT) {
      return player.getInventory().isFull()
        ? "finishing-the-quest-talking-to-sylas-without-a-free-inventory-space"
        : "finishing-the-quest-finishing-up";
    }
    return null;
  }

  function selectBeanReceiptSteps(steps) {
    const lineIndex = steps.findIndex((step) =>
      step.type === "line" && step.speaker === "Sylas" && step.text === "Here are the beans as promised.");
    const actionIndex = steps.findIndex((step, index) =>
      index > lineIndex && step.type === "action" && step.id === "4ncaBB");
    if (lineIndex < 0 || actionIndex !== lineIndex + 1) return [];
    return steps.slice(lineIndex, actionIndex + 1);
  }

  function miazrqaVariant(player, stage) {
    if (stage >= STAGE_COMPLETE) return { page: "Miazrqa", variant: "standard-dialogue-after-completion-of-grim-tales" };
    if (stage <= STAGE_FEATHER_GIVEN) {
      return hasBit(player, BIT_RUPERT_SPOKEN)
        ? "entering-the-tower-speaking-with-miazrqa-after-first-dialogue-with-rupert"
        : "entering-the-tower-talking-to-miazrqa-before-speaking-with-rupert";
    }
    if (stage === STAGE_RUPERT_MET) return "looking-for-miazrqa-s-pendant";
    if (stage === STAGE_PENDANT_TASK) return "looking-for-miazrqa-s-pendant-talking-to-miazrqa-again-before-leaving";
    if (stage === STAGE_PENDANT_FOUND) return "looking-for-miazrqa-s-pendant-returning-miazrqa-s-pendant";
    return "looking-for-miazrqa-s-pendant-talking-to-miazrqa-again";
  }

  /**
   * The cousin-guess menu's wiki "jump above" resolves back into the option it is
   * in, so the runtime's jump_to replays the same wrong guess until MAX_JUMPS and
   * "I need a key for the house." is never reached. Fold the guesses back onto
   * the menu, let the correct guess continue into the question menu the
   * "first-cousin" answer reaches, and make the question menu's "previous"
   * jumps replay itself rather than the guess menu.
   */
  function fixPendantSteps(steps) {
    const clone = JSON.parse(JSON.stringify(steps));
    const walk = (list) => {
      for (const step of list ?? []) {
        if (step.type === "choice" && Array.isArray(step.options)) {
          const continuation = step.options.find((option) =>
            String(option.text ?? "").startsWith("Your first-cousin, once removed?")
          );
          const correct = step.options.find((option) =>
            String(option.text ?? "").startsWith("Your second-cousin, twice removed?")
          );
          const questions = continuation?.steps?.[continuation.steps.length - 1];
          if (correct && questions) {
            for (const option of step.options) {
              const jump = (option.steps ?? []).findIndex((entry) => entry.type === "jump");
              if (jump === -1) continue;
              if (option === correct) option.steps.splice(jump, 1, JSON.parse(JSON.stringify(questions)));
              else option.steps[jump] = { type: "jump", reference: "other" };
            }
          }
          for (const option of step.options) {
            for (const entry of option.steps ?? []) {
              if (entry.type === "jump" && entry.reference === "previous") entry.reference = "other";
            }
          }
        }
        walk(step.steps);
        for (const option of step.options ?? []) walk(option.steps);
      }
    };
    walk(clone);
    return clone;
  }

  /** Stage 3's pendant menu needs its looping wiki jumps rewritten; other stages keep the page-context path. */
  function talkToMiazrqa(event) {
    const { player, npc, npcId } = event;
    if (npcId !== MIAZRQA_NPC_ID || quest.getStage(player) !== STAGE_RUPERT_MET) return false;
    event.handled = true;
    api.emitCustomEvent("npc-dialogue:start", {
      player,
      npc,
      npcId,
      variant: MIAZRQA_PENDANT_VARIANT,
      select: fixPendantSteps,
    });
    return true;
  }

  function rupertVariant(player, stage) {
    if (stage < STAGE_FEATHER_GIVEN) return null; // pre-quest: the tower page's own variant
    if (stage === STAGE_FEATHER_GIVEN) return "entering-the-tower-speaking-to-rupert-in-the-tower";
    if (stage === STAGE_RUPERT_MET) return "entering-the-tower-speaking-to-rupert-again-2";
    if (stage === STAGE_PENDANT_TASK) return "looking-for-miazrqa-s-pendant-talking-to-rupert-before-looking-for-miazrqa-s-pendant";
    if (stage === STAGE_PENDANT_FOUND) return "looking-for-miazrqa-s-pendant-talking-to-rupert-the-beard-before-handing-the-pendant";
    if (stage === STAGE_RUPERT_FREED && !held(player, RUPERTS_HELMET_ITEM_ID)) {
      return "looking-for-miazrqa-s-pendant-speaking-with-rupert";
    }
    return { page: "Rupert the Beard", variant: "after-grim-tales" };
  }

  function grimgnashVariant(player, stage) {
    if (hasBit(player, BIT_GRIFFIN_ASLEEP)) return "obtaining-grimgnash-s-feather-trying-to-talk-to-grimgnash-after-he-s-asleep";
    if (stage >= STAGE_STARTED && stage < STAGE_COMPLETE) {
      return hasBit(player, BIT_STORY_INTRO)
        ? "obtaining-grimgnash-s-feather-putting-grimgnash-to-sleep"
        : "obtaining-grimgnash-s-feather-initial-conversation-with-grimgnash";
    }
    return { page: "Grimgnash", variant: "before-grim-tales" };
  }

  function selectVariant({ npcId, player }) {
    if (!player) return null;
    const stage = quest.getStage(player);
    if (npcId === SYLAS_NPC_ID) return sylasVariant(player, stage);
    if (npcId === MIAZRQA_NPC_ID) return miazrqaVariant(player, stage);
    if (RUPERT_NPC_IDS.has(npcId)) return rupertVariant(player, stage);
    if (npcId === GRIMGNASH_NPC_ID) return grimgnashVariant(player, stage);
    return null;
  }

  /** Grimgnash's cache option is "Talk-To" (capital T), so he has no generic Talk-to. */
  function talkToGrimgnash(event) {
    const { player } = event;
    const choice = grimgnashVariant(player, quest.getStage(player));
    const variant = typeof choice === "string" ? choice : choice.variant;
    const page = typeof choice === "object" && choice.page ? choice.page : PAGE;
    startTranscript(api, player, GRIMGNASH_NPC_ID, page, variant);
    event.handled = true;
  }

  function answerCondition(event) {
    const { npcId, player, stepId } = event;
    if (!player || !stepId || !GRIM_DIALOGUE_NPC_IDS.has(npcId)) return null;
    switch (stepId) {
      case "7a_R6r": // If the player does not have the requirements to begin the quest
        return !meetsRequirements(player);
      case "KTNiA9": // If the player already owns a Griffin feather
        return held(player, GRIFFIN_FEATHER_ITEM_ID);
      case "g_ZNbn": // If the player hasn't spoken to Rupert before starting the quest
        return !hasBit(player, BIT_RUPERT_SPOKEN);
      case "MDKJT6": // If the player has previously spoken to Rupert before starting the quest
        return hasBit(player, BIT_RUPERT_SPOKEN);
      case "TpT0Oe": // If the player doesn't own the Door key
        return !held(player, DOOR_KEY_ITEM_ID);
      case "IwfacL": // If the player already has the key
        return held(player, DOOR_KEY_ITEM_ID);
      default:
        return null;
    }
  }

  function handleDialogueChoice(event) {
    const { player, npcId, option } = event;
    if (!player || typeof option !== "string") return;
    if (npcId === GRIMGNASH_NPC_ID && option === "I heard you were a great and mighty Griffin!") {
      setBit(player, BIT_STORY_INTRO);
      return;
    }
    if (
      npcId === MIAZRQA_NPC_ID &&
      option.startsWith(DWARF_OPTION_PREFIX) &&
      quest.getStage(player) === STAGE_RUPERT_MET
    ) {
      quest.setStage(player, STAGE_PENDANT_TASK);
    }
  }

  function handleDialogueLine(event) {
    const { player, npcId, text } = event;
    if (!player || typeof text !== "string") return;
    const stage = quest.getStage(player);
    if (npcId === SYLAS_NPC_ID) {
      if (stage === 0 && text.startsWith("Ahhh, good day young adventurer. A good day indeed!")) {
        quest.setStage(player, STAGE_STARTED);
        return;
      }
      if (stage === STAGE_STARTED && text.startsWith("Ah! Good work. Let me take that from you then.")) {
        if (held(player, GRIFFIN_FEATHER_ITEM_ID)) player.getInventory().deleteNumber(GRIFFIN_FEATHER_ITEM_ID, 1);
        quest.setStage(player, STAGE_FEATHER_GIVEN);
        return;
      }
      if (stage === STAGE_GOBLIN_OBTAINED && text.startsWith("First, let me take that goblin from you.")) {
        if (!held(player, GOLDEN_GOBLIN_ITEM_ID)) return;
        player.getInventory().deleteNumber(GOLDEN_GOBLIN_ITEM_ID, 1);
        quest.setStage(player, STAGE_GOBLIN_GIVEN);
        return;
      }
      // The transcript puts the "Quest complete!" action after an end marker, so
      // it never plays; finish on Sylas's last spoken line of the epilogue.
      if (stage === STAGE_STALK_CUT && text.startsWith("Anyway, I have removed the potion now")) {
        quest.complete(player);
      }
      return;
    }
    if (RUPERT_NPC_IDS.has(npcId) && stage === STAGE_FEATHER_GIVEN && text.startsWith("Ah! Straight to the point, eh, what?")) {
      quest.setStage(player, STAGE_RUPERT_MET);
    }
  }

  function lashOut(event) {
    const { player } = event;
    const skills = player.getSkillManager();
    const hitpoints = skills.getCurrentLevel(Skill.HITPOINTS);
    const damage = Math.max(1, Math.ceil(hitpoints * 0.2));
    skills.setCurrentLevel(Skill.HITPOINTS, Math.max(1, hitpoints - damage), true);
  }

  function givePianoLoot(player) {
    if (hasBit(player, BIT_PIANO_SEARCHED)) return;
    const inventory = player.getInventory();
    const missingSlots = [SHRINKING_RECIPE_ITEM_ID, TO_DO_LIST_ITEM_ID]
      .filter((itemId) => !held(player, itemId)).length;
    const rootsStack = ItemDefinition.forId(SHRUNK_OGLEROOT_ITEM_ID).isStackable();
    const missingRoots = Math.max(0, 2 - inventory.getAmount(SHRUNK_OGLEROOT_ITEM_ID));
    const rootSlots = rootsStack
      ? Number(!held(player, SHRUNK_OGLEROOT_ITEM_ID))
      : missingRoots;
    if (missingSlots + rootSlots > inventory.getFreeSlots()) {
      player.sendMessage("You need more inventory space to search the piano.");
      return;
    }
    if (!held(player, SHRINKING_RECIPE_ITEM_ID)) inventory.adds(SHRINKING_RECIPE_ITEM_ID, 1);
    if (!held(player, TO_DO_LIST_ITEM_ID)) inventory.adds(TO_DO_LIST_ITEM_ID, 1);
    if (missingRoots > 0) inventory.adds(SHRUNK_OGLEROOT_ITEM_ID, missingRoots);
    setBit(player, BIT_PIANO_SEARCHED);
  }

  function handleDialogueAction(event) {
    const { player, npcId, stepId } = event;
    if (!player || !stepId || !GRIM_DIALOGUE_NPC_IDS.has(npcId)) return;
    if (GRIFFIN_SLEEP_STEP_IDS.has(stepId)) {
      setBit(player, BIT_GRIFFIN_ASLEEP);
      return;
    }
    if (GRIFFIN_LASH_STEP_IDS.has(stepId)) {
      lashOut(event);
      return;
    }
    switch (stepId) {
      case "aLgFIp": // Rupert's beard is let down.
        setBit(player, BIT_BEARD_DOWN);
        break;
      case "CzhK4D": // You quickly take a feather while Grimgnash is sleeping.
        if (!held(player, GRIFFIN_FEATHER_ITEM_ID)) player.getInventory().adds(GRIFFIN_FEATHER_ITEM_ID, 1);
        break;
      case "Q0UzpC": // receive Door key
        if (!held(player, DOOR_KEY_ITEM_ID)) player.getInventory().adds(DOOR_KEY_ITEM_ID, 1);
        if (quest.getStage(player) === STAGE_RUPERT_MET) quest.setStage(player, STAGE_PENDANT_TASK);
        break;
      case "1fP9ED": // receive Shrinking recipe, To-do list and 2 Shrunk ogleroot
        givePianoLoot(player);
        break;
      case "kF0r9w": // receive Rupert's helmet
        if (!held(player, RUPERTS_HELMET_ITEM_ID)) player.getInventory().adds(RUPERTS_HELMET_ITEM_ID, 1);
        break;
      case "scnFAs": // give Rupert's helmet
        if (held(player, RUPERTS_HELMET_ITEM_ID)) {
          player.getInventory().deleteNumber(RUPERTS_HELMET_ITEM_ID, 1);
          if (quest.getStage(player) === STAGE_RUPERT_FREED) {
            player.setAttribute(RUPERT_HELMET_GIVEN_ATTRIBUTE, 1);
            syncQuestHelperState(player);
          }
        }
        break;
      case "4ncaBB": // receive Magic beans
        if (!held(player, MAGIC_BEANS_ITEM_ID)) {
          const inventory = player.getInventory();
          if (inventory.getFreeSlots() < 1) return;
          inventory.adds(MAGIC_BEANS_ITEM_ID, 1);
          if (!held(player, MAGIC_BEANS_ITEM_ID)) return;
        }
        if (quest.getStage(player) === STAGE_RUPERT_FREED) {
          player.setAttribute(RUPERT_HELMET_GIVEN_ATTRIBUTE, 0);
          quest.setStage(player, STAGE_BEANS_OBTAINED);
        }
        break;
      case "6CrztP": // You hand over the pendant.
        if (held(player, MIAZRQAS_PENDANT_ITEM_ID)) player.getInventory().deleteNumber(MIAZRQAS_PENDANT_ITEM_ID, 1);
        if (quest.getStage(player) === STAGE_PENDANT_FOUND) quest.setStage(player, STAGE_RUPERT_FREED);
        break;
      case "i7lDh5": // The player shrinks and enters the mouse hole.
        player.moveTo(new Location(MOUSE_HOLE_ENTRY_TILE.x, MOUSE_HOLE_ENTRY_TILE.y, MOUSE_HOLE_ENTRY_TILE.z));
        break;
      case "kDhVWf": // Congratulations! Quest complete!
        if (quest.getStage(player) === STAGE_STALK_CUT) quest.complete(player);
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // The griffin's feather
  // ---------------------------------------------------------------------------

  function takeFeather(event) {
    const { player } = event;
    event.handled = true;
    if (!quest.isStarted(player)) {
      startTranscript(api, player, GRIMGNASH_NPC_ID, "Grimgnash", "before-grim-tales-trying-to-take-from-the-pile-of-feathers");
      return;
    }
    if (!hasBit(player, BIT_GRIFFIN_ASLEEP)) {
      startTranscript(api, player, GRIMGNASH_NPC_ID, "Grimgnash", "before-grim-tales-trying-to-take-from-the-pile-of-feathers");
      return;
    }
    if (held(player, GRIFFIN_FEATHER_ITEM_ID)) {
      const message = pageMessage("z2qI_4");
      if (message) player.sendMessage(message);
      return;
    }
    playVariant(player, GRIMGNASH_NPC_ID, "obtaining-grimgnash-s-feather-taking-the-griffin-feather");
  }

  function handleItemOnNpc(event) {
    const { player, itemId, npcId } = event;
    if (npcId === GRIMGNASH_NPC_ID) {
      event.handled = true;
      if (!quest.isStarted(player)) {
        startTranscript(api, player, GRIMGNASH_NPC_ID, "Grimgnash", "before-grim-tales-using-an-item-on-grimgnash");
        return;
      }
      playVariant(player, GRIMGNASH_NPC_ID, "obtaining-grimgnash-s-feather-using-any-item-on-grimgnash");
      return;
    }
    if (npcId === MIAZRQA_NPC_ID) {
      event.handled = true;
      playVariant(player, MIAZRQA_NPC_ID, "entering-the-tower-using-any-item-on-miazrqa");
    }
  }

  // ---------------------------------------------------------------------------
  // The tower (Rupert and Miazrqa)
  // ---------------------------------------------------------------------------

  function talkIntoPipe(event) {
    const { player } = event;
    event.handled = true;
    const firstIntro = !hasBit(player, BIT_RUPERT_INTRO);
    if (firstIntro) setBit(player, BIT_RUPERT_INTRO);
    if (hasBit(player, BIT_BEARD_DOWN)) {
      playVariant(player, DRAIN_PIPE_NPC_ID, "entering-the-tower-speaking-to-rupert-through-the-drain-pipe-after-he-let-down-his-beard");
    } else if (firstIntro) {
      playVariant(player, DRAIN_PIPE_NPC_ID, "entering-the-tower-speaking-to-rupert-through-the-pipe");
    } else {
      playVariant(player, DRAIN_PIPE_NPC_ID, "entering-the-tower-speaking-to-rupert-again");
    }
    setBit(player, BIT_RUPERT_SPOKEN);
  }

  function climbBeard(event) {
    const { player, location } = event;
    event.handled = true;
    if (location.z >= 1) {
      playVariant(player, RUPERT_NPC_ID, "entering-the-tower-climbing-down-rupert-s-beard");
      player.moveTo(new Location(BEARD_GROUND_TILE.x, BEARD_GROUND_TILE.y - 1, BEARD_GROUND_TILE.z));
      return;
    }
    if (!hasBit(player, BIT_BEARD_DOWN)) return;
    if (player.getSkillManager().getCurrentLevel(Skill.AGILITY) < 59) {
      player.sendMessage("You need an Agility level of 59 to climb up here.");
      return;
    }
    playVariant(player, RUPERT_NPC_ID, "entering-the-tower-climbing-up-rupert-s-beard");
    player.moveTo(new Location(TOWER_TOP_TILE.x, TOWER_TOP_TILE.y, TOWER_TOP_TILE.z));
  }

  function climbCrumblingWall(event) {
    const { player } = event;
    event.handled = true;
    if (player.getSkillManager().getCurrentLevel(Skill.THIEVING) < 58) {
      playVariant(player, MIAZRQA_NPC_ID, "entering-the-tower-trying-to-climb-the-crumbled-wall-without-the-thieving-level");
      return;
    }
    stepThrough(player, event.location);
  }

  function enterTowerDoor(event) {
    const { player } = event;
    if (quest.isComplete(player)) return; // let Doors.plugin handle it after the quest
    event.handled = true;
    playVariant(player, MIAZRQA_NPC_ID, "entering-the-tower-attempting-to-enter-the-tower-door");
  }

  function openTowerTrapdoor(event) {
    event.handled = true;
    playVariant(event.player, RUPERT_NPC_ID, "entering-the-tower-attempting-to-leave-the-tower-through-the-trapdoor");
  }

  // ---------------------------------------------------------------------------
  // Miazrqa's pendant (witch's house and mouse hole)
  // ---------------------------------------------------------------------------

  function openWitchHouseDoor(event) {
    const { player } = event;
    if (!quest.isStarted(player) || quest.isComplete(player)) return; // Witch's House owns it otherwise
    event.handled = true;
    if (!held(player, DOOR_KEY_ITEM_ID)) {
      player.sendMessage("This door appears to be securely locked.");
      return;
    }
    stepThrough(player, event.location);
  }

  function searchMusicStand(event) {
    const { player } = event;
    event.handled = true;
    if (held(player, MUSIC_SHEET_ITEM_ID)) return;
    player.getInventory().adds(MUSIC_SHEET_ITEM_ID, 1);
  }

  function showPianoMenu(player) {
    player.getPacketSender().sendInterface(PIANO_INTERFACE_ID);
  }

  function pressPianoNote(player, note) {
    const progress = pianoProgress(player);
    if (PIANO_TUNE[progress] !== note) {
      player.setAttribute(PIANO_PROGRESS_ATTRIBUTE, 0);
      syncQuestHelperState(player);
      return;
    }
    const message = pageMessage(PIANO_NOTE_MESSAGES[progress]);
    if (message) player.sendMessage(message);
    const next = progress + 1;
    if (next >= PIANO_TUNE.length) {
      player.setAttribute(PIANO_PROGRESS_ATTRIBUTE, 0);
      setBit(player, BIT_PIANO_OPEN);
      const opened = pageMessage(PIANO_OPEN_MESSAGE_ID);
      if (opened) player.sendMessage(opened);
      return;
    }
    player.setAttribute(PIANO_PROGRESS_ATTRIBUTE, next);
    syncQuestHelperState(player);
  }

  function playPiano(event) {
    const { player } = event;
    event.handled = true;
    if (hasBit(player, BIT_PIANO_OPEN) || quest.getStage(player) !== STAGE_PENDANT_TASK) return;
    showPianoMenu(player);
  }

  function handlePianoButton({ player, buttonId, handled = false }) {
    const note = PIANO_BUTTON_NOTES.get(buttonId);
    if (handled || !player || !note || quest.getStage(player) !== STAGE_PENDANT_TASK || hasBit(player, BIT_PIANO_OPEN)) return;
    pressPianoNote(player, note);
  }

  function searchPiano(event) {
    const { player } = event;
    event.handled = true;
    if (!hasBit(player, BIT_PIANO_OPEN)) return;
    if (hasBit(player, BIT_PIANO_SEARCHED)) {
      playVariant(player, MIAZRQA_NPC_ID, "looking-for-miazrqa-s-pendant-searching-the-piano-again");
      return;
    }
    playVariant(player, MIAZRQA_NPC_ID, "looking-for-miazrqa-s-pendant-searching-the-piano");
  }

  function drinkShrinkPotion(event) {
    const { player } = event;
    if (!nearArea(player, MOUSE_HOLE_AREA) && !nearArea(player, CELLAR_AREA)) return;
    event.handled = true;
    if (!held(player, SHRINK_ME_QUICK_ITEM_ID)) return;
    player.getInventory().deleteNumber(SHRINK_ME_QUICK_ITEM_ID, 1);
    playVariant(player, MIAZRQA_NPC_ID, "looking-for-miazrqa-s-pendant-drinking-the-shrink-potion");
  }

  /** Tarromin potion (unf) + shrunk ogleroot -> shrink-me-quick (52 Herblore, not enforced). */
  function mixShrinkPotion(event) {
    const { player } = event;
    const first = event.usedItemId;
    const second = event.usedWithItemId;
    const root = first === SHRUNK_OGLEROOT_ITEM_ID ? second : second === SHRUNK_OGLEROOT_ITEM_ID ? first : null;
    if (root === null || !TARROMIN_POTION_UNF_ITEM_IDS.has(root)) return;
    event.handled = true;
    if (!held(player, SHRUNK_OGLEROOT_ITEM_ID) || !held(player, root)) return;
    player.getInventory().deleteNumber(SHRUNK_OGLEROOT_ITEM_ID, 1);
    player.getInventory().deleteNumber(root, 1);
    player.getInventory().adds(SHRINK_ME_QUICK_ITEM_ID, 1);
    const message = pageMessage("d4Ft0u");
    if (message) player.sendMessage(message);
  }

  function takePendant(event) {
    const { player } = event;
    event.handled = true;
    if (quest.getStage(player) !== STAGE_PENDANT_TASK || held(player, MIAZRQAS_PENDANT_ITEM_ID)) return;
    if (player.getInventory().getFreeSlots() < 1) {
      player.sendMessage("You need a free inventory space to take the pendant.");
      return;
    }
    player.getInventory().adds(MIAZRQAS_PENDANT_ITEM_ID, 1);
    quest.setStage(player, STAGE_PENDANT_FOUND);
    playVariant(player, MIAZRQA_NPC_ID, "looking-for-miazrqa-s-pendant-taking-the-pendant");
  }

  function climbMouseNails(event) {
    const { player, objectId, location } = event;
    event.handled = true;
    const delta = objectId === NAILS_UP_OBJECT_ID ? 1 : -1;
    player.moveTo(new Location(location.x, location.y, location.z + delta));
  }

  function leaveMouseHole(event) {
    event.handled = true;
    event.player.moveTo(new Location(CELLAR_TILE.x, CELLAR_TILE.y, CELLAR_TILE.z));
  }

  // ---------------------------------------------------------------------------
  // The beanstalk and Glod
  // ---------------------------------------------------------------------------

  function readMoundSignpost(event) {
    const { player, location } = event;
    if (Math.abs(location.x - EARTH_MOUND_TILE.x) > 2 || Math.abs(location.y - EARTH_MOUND_TILE.y) > 2) return;
    event.handled = true;
    playVariant(player, SYLAS_NPC_ID, "the-final-battle-reading-the-signpost-next-to-the-earth-mound");
  }

  function plantBeans(event) {
    const { player, itemId, objectId } = event;
    if (itemId !== MAGIC_BEANS_ITEM_ID || objectId !== EARTH_MOUND_OBJECT_ID) return;
    if (quest.getStage(player) !== STAGE_BEANS_OBTAINED) return;
    if (!held(player, SEED_DIBBER_ITEM_ID)) return;
    event.handled = true;
    player.getInventory().deleteNumber(MAGIC_BEANS_ITEM_ID, 1);
    playVariant(player, SYLAS_NPC_ID, "the-final-battle-planting-the-bean-in-the-earth-mound");
    swapQuestObject(EARTH_MOUND_OBJECT_ID, BEAN_MOUND_OBJECT_ID, EARTH_MOUND_TILE);
    quest.setStage(player, STAGE_BEAN_PLANTED);
  }

  function waterMound(event) {
    const { player, objectId } = event;
    if (objectId === BEAN_MOUND_OBJECT_ID) {
      if (quest.getStage(player) !== STAGE_BEAN_PLANTED || !useWateringCan(player)) return;
      event.handled = true;
      playVariant(player, SYLAS_NPC_ID, "the-final-battle-watering-the-bean-mound");
      swapQuestObject(BEAN_MOUND_OBJECT_ID, BEANSTALK_OBJECT_ID, EARTH_MOUND_TILE);
      quest.setStage(player, STAGE_BEANSTALK_GROWN);
      ensureGlod(player);
      return;
    }
    if (objectId !== EARTH_MOUND_OBJECT_ID) return;
    if (!useWateringCan(player)) return;
    event.handled = true;
    playVariant(player, SYLAS_NPC_ID, "the-final-battle-watering-the-mound-before-planting-the-bean");
  }

  function climbBeanstalk(event) {
    const { player } = event;
    event.handled = true;
    if (quest.getStage(player) < STAGE_BEANSTALK_GROWN || quest.isComplete(player)) return;
    if (player.getSkillManager().getCurrentLevel(Skill.AGILITY) < 59) {
      player.sendMessage("You need an Agility level of 59 to climb up here.");
      return;
    }
    ensureGlod(player);
    player.moveTo(new Location(GLOD_TILE.x, GLOD_TILE.y + 2, GLOD_TILE.z));
  }

  function climbDownBeanstalk(event) {
    event.handled = true;
    event.player.moveTo(new Location(EARTH_MOUND_TILE.x + 1, EARTH_MOUND_TILE.y + 3, EARTH_MOUND_TILE.z));
  }

  function shrinkBeanstalk(event) {
    const { player, itemId, objectId } = event;
    if (itemId !== SHRINK_ME_QUICK_ITEM_ID || objectId !== BEANSTALK_OBJECT_ID) return;
    if (quest.getStage(player) !== STAGE_GOBLIN_GIVEN) return;
    event.handled = true;
    player.getInventory().deleteNumber(SHRINK_ME_QUICK_ITEM_ID, 1);
    playVariant(player, SYLAS_NPC_ID, "finishing-the-quest-shrinking-the-beanstalk");
    swapQuestObject(BEANSTALK_OBJECT_ID, SHRUNK_BEANSTALK_OBJECT_ID, EARTH_MOUND_TILE);
    quest.setStage(player, STAGE_STALK_SHRUNK);
  }

  function chopBeanstalk(event) {
    const { player } = event;
    event.handled = true;
    if (quest.getStage(player) < STAGE_GOBLIN_GIVEN) return;
    if (quest.getStage(player) < STAGE_STALK_SHRUNK) {
      playVariant(player, SYLAS_NPC_ID, "finishing-the-quest-chopping-the-beanstalk-without-shrinking-it");
      return;
    }
    if (!hasAxe(player)) {
      playVariant(player, SYLAS_NPC_ID, "finishing-the-quest-trying-to-chop-down-the-stalk-without-an-axe");
      return;
    }
    playVariant(player, SYLAS_NPC_ID, "finishing-the-quest-chopping-down-the-beanstalk");
    swapQuestObject(SHRUNK_BEANSTALK_OBJECT_ID, BEANSTUMP_OBJECT_ID, EARTH_MOUND_TILE);
    quest.setStage(player, STAGE_STALK_CUT);
  }

  function handleItemOnBeanstalk(event) {
    const { player, itemId, objectId } = event;
    if (!BEANSTALK_OBJECT_IDS.has(objectId) && objectId !== BEANSTUMP_OBJECT_ID) return;
    if (itemId === SHRINK_ME_QUICK_ITEM_ID) {
      shrinkBeanstalk(event);
      return;
    }
    if (isAxe(itemId)) {
      event.handled = true;
      if (objectId === BEANSTUMP_OBJECT_ID || quest.getStage(player) >= STAGE_STALK_CUT) {
        playVariant(player, SYLAS_NPC_ID, "finishing-the-quest-using-axe-on-the-stalk-after-it-s-chopped");
        return;
      }
      chopBeanstalk(event);
      return;
    }
    event.handled = true;
    playVariant(player, SYLAS_NPC_ID, "finishing-the-quest-using-any-item-besides-axe-on-the-stalk");
  }

  function handleNpcDeath(event) {
    const { killer, npc, npcId } = event;
    if (npcId !== GLOD_NPC_ID || !killer || !npc) return;
    const owner = npc.getOwner?.();
    if (owner && owner !== killer) return;
    if (glodByPlayer.get(killer) !== npc) return;
    glodByPlayer.delete(killer);
    const location = npc.getLocation?.() ?? npc.getSpawnLocation?.();
    if (location) {
      api.getItemOnGroundManager()?.registerLocation(
        killer,
        new Item(GOLDEN_GOBLIN_ITEM_ID, 1),
        new Location(location.getX(), location.getY(), location.getZ())
      );
    }
    if (quest.getStage(killer) === STAGE_BEANSTALK_GROWN) quest.setStage(killer, STAGE_GOBLIN_OBTAINED);
  }

  // ---------------------------------------------------------------------------
  // Object interactions
  // ---------------------------------------------------------------------------

  function handleObjectInteraction(event) {
    const { objectId, player } = event;
    if (objectId === FEATHERS_OBJECT_ID) {
      takeFeather(event);
      return;
    }
    if (objectId === TOWER_DOOR_OBJECT_ID) {
      enterTowerDoor(event);
      return;
    }
    if (CRUMBLING_WALL_OBJECT_IDS.has(objectId)) {
      climbCrumblingWall(event);
      return;
    }
    if (objectId === DRAIN_PIPE_OBJECT_ID) {
      if (event.clickType === 3) {
        if (hasBit(player, BIT_BEARD_DOWN)) climbBeard(event);
        return;
      }
      talkIntoPipe(event);
      return;
    }
    if (objectId === BEARD_OBJECT_ID) {
      climbBeard(event);
      return;
    }
    if (objectId === TOWER_TRAPDOOR_OBJECT_ID) {
      openTowerTrapdoor(event);
      return;
    }
    if (objectId === MOUND_SIGNPOST_OBJECT_ID && event.clickType === 1) {
      readMoundSignpost(event);
      return;
    }
    if (PIANO_OBJECT_IDS.has(event.definition?.id ?? objectId) && atTile(event.location, PIANO_TILE)) {
      if (event.clickType === 3) searchPiano(event);
      else playPiano(event);
      return;
    }
    if (objectId === MUSIC_STAND_OBJECT_ID && atTile(event.location, MUSIC_STAND_TILE)) {
      searchMusicStand(event);
      return;
    }
    if (objectId === BEANSTALK_OBJECT_ID && event.clickType === 1) {
      climbBeanstalk(event);
      return;
    }
    if (objectId === CLOUD_BEANSTALK_OBJECT_ID) {
      climbDownBeanstalk(event);
      return;
    }
    if (objectId === BEANSTALK_OBJECT_ID || objectId === SHRUNK_BEANSTALK_OBJECT_ID) {
      chopBeanstalk(event);
      return;
    }
    if (objectId === PENDANT_OBJECT_ID) {
      takePendant(event);
      return;
    }
    if (objectId === MOUSE_HOLE_OBJECT_ID || objectId === GRATE_OBJECT_ID) {
      leaveMouseHole(event);
      return;
    }
    if (objectId === NAILS_UP_OBJECT_ID || objectId === NAILS_DOWN_OBJECT_ID) {
      climbMouseNails(event);
      return;
    }
    if (objectId === WITCH_HOUSE_DOOR_OBJECT_ID) {
      openWitchHouseDoor(event);
    }
  }

  function handleItemOnObject(event) {
    const { itemId, objectId } = event;
    if (WATERING_CAN_DOSES.has(itemId) && (objectId === EARTH_MOUND_OBJECT_ID || objectId === BEAN_MOUND_OBJECT_ID)) {
      waterMound(event);
      return;
    }
    if (itemId === MAGIC_BEANS_ITEM_ID) {
      plantBeans(event);
      return;
    }
    handleItemOnBeanstalk(event);
  }

  // ---------------------------------------------------------------------------
  // Journal and reward
  // ---------------------------------------------------------------------------

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I collected a griffin feather and Rupert the Beard's helmet for Sylas.</str>",
        "<str>I found Miazrqa's pendant and freed Rupert from the tower.</str>",
        "<str>I grew a beanstalk, defeated the cloud giant Glod and took the</str>",
        "<str>golden goblin, then chopped the beanstalk down.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage === 0) {
      return [
        "I can start this quest by speaking to <col=800000>Sylas</col> in <col=800000>Taverley</col>.",
        "",
        "I must have completed <col=800000>Witch's House</col>, and have",
        "<col=800000>45 Farming</col>, <col=800000>52 Herblore</col>, <col=800000>58 Thieving</col>,",
        "<col=800000>59 Agility</col> and <col=800000>71 Woodcutting</col>.",
      ];
    }
    const lines = [];
    if (stage === STAGE_STARTED) {
      lines.push(
        "<str>I agreed to find two rare items for Sylas the collector:</str>",
        "<str>a feather from the griffin Grimgnash, and Rupert the Beard's helmet.</str>",
        "",
        "Grimgnash lairs on <col=800000>White Wolf Mountain</col>."
      );
      return lines;
    }
    lines.push("<str>I gave Sylas Grimgnash's feather.</str>");
    if (stage === STAGE_FEATHER_GIVEN) {
      lines.push(
        "",
        "I still need <col=800000>Rupert the Beard's helmet</col> from the tower",
        "south of the <col=800000>Mind Altar</col>."
      );
      return lines;
    }
    if (stage === STAGE_RUPERT_MET) {
      lines.push(
        "<str>I met Rupert the Beard in the tower and agreed to help him.</str>",
        "",
        "I should speak to <col=800000>Princess Miazrqa</col> north of the tower."
      );
      return lines;
    }
    if (stage === STAGE_PENDANT_TASK) {
      lines.push(
        "<str>Miazrqa will free Rupert if I find her pendant,</str>",
        "<str>lost in her cousin's house in Taverley.</str>",
        "",
        "I should search the <col=800000>witch's house</col> for the pendant."
      );
      return lines;
    }
    if (stage === STAGE_PENDANT_FOUND) {
      lines.push(
        "<str>I found Miazrqa's pendant in the mouse hole.</str>",
        "",
        "I should return it to <col=800000>Princess Miazrqa</col>."
      );
      return lines;
    }
    lines.push("<str>Miazrqa freed Rupert and I have his helmet.</str>");
    if (stage === STAGE_RUPERT_FREED) {
      lines.push("", "I should take <col=800000>Rupert's helmet</col> back to Sylas.");
      return lines;
    }
    lines.push("<str>Sylas gave me magic beans to plant on the earth mound</str>", "<str>south-east of Taverley.</str>");
    if (stage === STAGE_BEANS_OBTAINED) {
      lines.push("", "I need a <col=800000>seed dibber</col> and a <col=800000>watering can</col>.");
      return lines;
    }
    if (stage === STAGE_BEAN_PLANTED) {
      lines.push("", "<str>I planted the beans; they need watering.</str>");
      return lines;
    }
    lines.push("<str>The beanstalk grew!</str>");
    if (stage === STAGE_BEANSTALK_GROWN) {
      lines.push("", "I should climb the <col=800000>beanstalk</col> and find the golden goblin.");
      return lines;
    }
    lines.push("<str>I defeated Glod and have the golden goblin.</str>");
    if (stage === STAGE_GOBLIN_OBTAINED) {
      lines.push("", "I should take it to <col=800000>Sylas</col>.");
      return lines;
    }
    lines.push("<str>Sylas took the golden goblin and wants the beanstalk cut down.</str>");
    if (stage <= STAGE_STALK_SHRUNK) {
      lines.push(
        "",
        "I need to shrink the <col=800000>beanstalk</col> with a shrinking potion,",
        "then chop it with an <col=800000>axe</col>."
      );
      return lines;
    }
    lines.push("", "<str>I chopped down the beanstalk.</str>", "", "I should speak to <col=800000>Sylas</col>.");
    return lines;
  }

  function grantReward(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.WOODCUTTING, 60000);
    skills.addExperiences(Skill.AGILITY, 25000);
    skills.addExperiences(Skill.THIEVING, 25000);
    skills.addExperiences(Skill.HERBLORE, 15000);
    skills.addExperiences(Skill.FARMING, 10000);
    skills.addExperiences(Skill.HITPOINTS, 5000);
  }

  function handleLogin({ player }) {
    installWorld();
    syncNpcs(player);
    syncQuestHelperState(player);
    refreshQuestList(player);
  }

  function handleLogout({ player }) {
    if (player) removeGlod(player);
  }

  // ---------------------------------------------------------------------------
  // Registration (attach-only)
  // ---------------------------------------------------------------------------

  api.persistAttribute(BITS_ATTRIBUTE);
  api.persistAttribute(RUPERT_HELMET_GIVEN_ATTRIBUTE, 0);

  quest = registerQuest(api, {
    key: "grim_tales",
    name: "Grim Tales",
    varpId: VARP_GRIM_TALES,
    varbitId: VARBIT_GRIM_TALES,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    varbitValue: questHelperStageValue,
    questPoints: 1,
    xpRewards: [
      { skillId: Skill.WOODCUTTING.getIndex(), amount: 60000, label: "Woodcutting" },
      { skillId: Skill.AGILITY.getIndex(), amount: 25000, label: "Agility" },
      { skillId: Skill.THIEVING.getIndex(), amount: 25000, label: "Thieving" },
      { skillId: Skill.HERBLORE.getIndex(), amount: 15000, label: "Herblore" },
      { skillId: Skill.FARMING.getIndex(), amount: 10000, label: "Farming" },
      { skillId: Skill.HITPOINTS.getIndex(), amount: 5000, label: "Hitpoints" },
    ],
    rewardItemId: DWARVEN_HELMET_ITEM_ID,
    rewardItemLabel: "Dwarven helmet",
    otherRewards: ["Glod is now available in the Nightmare Zone."],
    buildJournal,
    onReward: grantReward,
  });

  api.onCustomEvent("quest:stage-changed", handleQuestStageChanged);

  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
  api.onInterfaceActionButton([...PIANO_BUTTON_NOTES.keys()], handlePianoButton);
  api.persistAttribute(PIANO_PROGRESS_ATTRIBUTE, 0);
  api.onNpcInteraction("Grimgnash", { "Talk-To": talkToGrimgnash });
  api.onNpcInteraction("Miazrqa", { "Talk-to": talkToMiazrqa });
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:choice", handleDialogueChoice);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemOnItem(mixShrinkPotion);
  api.onItemAction("Shrink-me-quick", { Drink: drinkShrinkPotion });
  api.onObjectInteraction(handleObjectInteraction);
  api.onNpcDeath(handleNpcDeath);
};
