/**
 * Recipe for Disaster: the Cook's banquet, eight independent rescues and the
 * Culinaromancer finale. Dialogue and action ids are the OSRS Wiki transcripts.
 */
module.exports = function registerRecipeForDisasterQuest(api) {
  const { CombatSpells, CombatType, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers, Skill } = api.core;
  const { registerQuest, QUEST_POINTS_ATTRIBUTE, refreshQuestList, loadTranscripts } = require("../QuestRuntime");

  const PAGE = "Recipe for Disaster/Another Cook's Quest";
  const QUEST = "recipe_for_disaster";
  const FLAGS_ATTRIBUTE = "recipe-for-disaster:rescues";
  const PIRATE_ATTRIBUTE = "recipe-for-disaster:pirate-state";
  const PIRATE_HIDES_ATTRIBUTE = "recipe-for-disaster:pirate-hides-given";
  const PIRATE_STAGE_ATTRIBUTE = "recipe-for-disaster:pirate-stage";
  const PIRATE_FIRST_DIVE_ATTRIBUTE = "recipe-for-disaster:pirate-first-dive";
  const GOBLIN_STATE_ATTRIBUTE = "recipe-for-disaster:goblin-state";
  const GOBLIN_STAGE_ATTRIBUTE = "recipe-for-disaster:goblin-stage";
  const GOBLIN_SLOP_RECEIVED = 4;
  const DWARF_STATE_ATTRIBUTE = "recipe-for-disaster:dwarf-state";
  const DWARF_STAGE_ATTRIBUTE = "recipe-for-disaster:dwarf-stage";
  const GUIDE_STATE_ATTRIBUTE = "recipe-for-disaster:guide-state";
  const GUIDE_STAGE_ATTRIBUTE = "recipe-for-disaster:guide-stage";
  const DAVE_STATE_ATTRIBUTE = "recipe-for-disaster:evil-dave-state";
  const DAVE_STAGE_ATTRIBUTE = "recipe-for-disaster:evil-dave-stage";
  const DAVE_RECIPE_ATTRIBUTE = "recipe-for-disaster:evil-dave-recipe";
  const DAVE_STEW_ATTRIBUTE = "recipe-for-disaster:evil-dave-stew";
  const SKRACH_STATE_ATTRIBUTE = "recipe-for-disaster:skrach-state";
  const SKRACH_STAGE_ATTRIBUTE = "recipe-for-disaster:skrach-stage";
  const SKRACH_SPIT_ROAST_OBJECT = ObjectIdentifiers.OGRE_SPIT_ROAST_4; // 3375
  const SKRACH_SPIT_ROAST_TILE = { x: 2632, y: 2985, z: 0 };
  const SKRACH_SPIT_ROAST_BY_PLAYER = new WeakMap();
  const AWOWOGEI_STATE_ATTRIBUTE = "recipe-for-disaster:awowogei-state";
  const AWOWOGEI_STAGE_ATTRIBUTE = "recipe-for-disaster:awowogei-stage";
  const AMIK_STATE_ATTRIBUTE = "recipe-for-disaster:amik-state";
  const AMIK_STAGE_ATTRIBUTE = "recipe-for-disaster:amik-stage";
  const AMIK_DRAGON_DROP_ATTRIBUTE = "recipe-for-disaster:amik-dragon-drop";
  const AMIK_CHICKEN_DEAD_ATTRIBUTE = "recipe-for-disaster:amik-chicken-dead";
  const AMIK_WOM_BRIEFED_ATTRIBUTE = "recipe-for-disaster:amik-wom-briefed";
  const AMIK_WOM_ACTIVE = new WeakSet();
  const AMIK_WOM_PENDING_BRIEFING = new WeakSet();
  // One Small Favour's mandatory Rantz stages (OneSmallFavour.Quest.js).
  const OSF_RANTZ_STAGES = new Set([17, 18, 20, 21]);
  const TCHIKI_COURSE_SWUNG = 256;
  const TCHIKI_CAVE_ENTERED = 512;
  const SKRACH_TREE_PUSHED = 128;
  const SKRACH_ARROW_FIRED = 256;
  const SKRACH_FREE_RIDE_TAKEN = 512;
  const AWOWOGEI_SNAKE_FOUND = 128;
  const AWOWOGEI_RED_TREE_FOUND = 2048;
  const START_HOOK = "quest:recipe-for-disaster:start";
  const VARP_RFD = 678;
  const VARBIT_RFD = 1850;
  const VARBIT_OGRE_BOAT = 1908;
  const RESCUE_QUEST_VARBITS = new Map([
    [1, [1892, 60]], // Mountain Dwarf
    [2, [1867, 40]], // Goblin generals
    [4, [1895, 110]], // Pirate Pete
    [8, [1896, 5]], // Lumbridge Guide
    [16, [1878, 5]], // Evil Dave
    [32, [1904, 170]], // Skrach Uglogwee
    [64, [1910, 20]], // Sir Amik Varze
    [128, [1914, 50]], // King Awowogei
  ]);
  const COOK_IDS = new Set([
    NpcIdentifiers.COOK, NpcIdentifiers.COOK_2, NpcIdentifiers.COOK_3,
    NpcIdentifiers.COOK_4, NpcIdentifiers.COOK_5, NpcIdentifiers.COOK_6,
    NpcIdentifiers.COOK_7, NpcIdentifiers.COOK_8,
  ]);
  // The public Varrock Aris starts Demon Slayer; these are her banquet forms.
  const BANQUET_ARIS_IDS = new Set([NpcIdentifiers.ARIS_2, NpcIdentifiers.ARIS_3]);
  const RESCUES = [
    { name: "the Mountain Dwarf", page: "Recipe for Disaster/Freeing the Mountain Dwarf", ids: [NpcIdentifiers.MOUNTAIN_DWARF], item: ItemIdentifiers.DWARVEN_ROCK_CAKE_2, flag: 1, variant: "starting-out-inspecting-the-dwarf", finish: "finishing-up-freeing-the-dwarf" },
    { name: "the goblin generals", page: "Recipe for Disaster/Freeing the Goblin generals", ids: [NpcIdentifiers.GENERAL_WARTFACE_5, NpcIdentifiers.GENERAL_BENTNOZE_5], item: ItemIdentifiers.SLOP_OF_COMPROMISE, flag: 2, variant: "starting-out-inspecting-the-goblin-generals", finish: "finishing-up-freeing-the-goblin-generals" },
    { name: "Pirate Pete", page: "Recipe for Disaster/Freeing Pirate Pete", ids: [NpcIdentifiers.PIRATE_PETE_3], item: ItemIdentifiers.COOKED_FISHCAKE, flag: 4, variant: "starting-out-inspecting-pirate-pete", finish: "finishing-up-using-the-fishcake-on-pirate-pete" },
    { name: "the Lumbridge Guide", page: "Recipe for Disaster/Freeing the Lumbridge Guide", ids: [NpcIdentifiers.LUMBRIDGE_GUIDE, NpcIdentifiers.LUMBRIDGE_GUIDE_4], item: ItemIdentifiers.CAKE_OF_GUIDANCE, flag: 8, variant: "starting-out-inspecting-the-lumbridge-guide", finish: "finishing-up-freeing-the-lumbridge-guide" },
    { name: "Evil Dave", page: "Recipe for Disaster/Freeing Evil Dave", ids: [NpcIdentifiers.EVIL_DAVE_3], item: ItemIdentifiers.SPICY_STEW, flag: 16, variant: "starting-out-inspecting-evil-dave", finish: "saving-dave-giving-dave-the-right-stew" },
    { name: "Skrach Uglogwee", page: "Recipe for Disaster/Freeing Skrach Uglogwee", ids: [NpcIdentifiers.SKRACH_UGLOGWEE], item: ItemIdentifiers.COOKED_JUBBLY, flag: 32, variant: "starting-off-inspecting-skrach-uglogwee", finish: "jubbly-hunt-freeing-skrach-uglogwee" },
    { name: "Sir Amik Varze", page: "Recipe for Disaster/Freeing Sir Amik Varze", ids: [NpcIdentifiers.SIR_AMIK_VARZE_3, NpcIdentifiers.SIR_AMIK_VARZE_4], item: ItemIdentifiers.BRULEE_SUPREME, flag: 64, variant: "starting-out-inspecting-sir-amik-varze", finish: "finishing-up-using-the-brulee-supreme-on-sir-amik-varze" },
    { name: "King Awowogei", page: "Recipe for Disaster/Freeing King Awowogei", ids: [NpcIdentifiers.AWOWOGEI], item: ItemIdentifiers.STUFFED_SNAKE, flag: 128, variant: "starting-out-inspecting-king-awowogei", finish: "finishing-up-feeding-king-awowogei" },
  ];
  const COUNCIL_IDS = new Set(RESCUES.flatMap(({ ids }) => ids));
  const STAGE_STARTED = 1;
  const STAGE_OPENING_COMPLETE = 4;
  const STAGE_COMPLETE = 5;
  const ALL_RESCUES = 255;
  const FINAL_FIGHT_ATTRIBUTE = "recipe-for-disaster:culinaromancer-wave";
  const FINAL_BOSS_DEFEATED_ATTRIBUTE = "recipe-for-disaster:culinaromancer-defeated";
  const EVIL_CHICKEN_LAIR_ENTRY = { x: 2455, y: 4398, z: 0 };
  const EVIL_CHICKEN_LAIR_BOSS = { x: 2455, y: 4399, z: 0 };
  const EVIL_CHICKEN_LAIR_ZONE = { minX: 2430, maxX: 2492, minY: 4355, maxY: 4407, z: 0 };
  const AWOWOGEI_SNAKE_HOLE = { minX: 3019, maxX: 3028, minY: 5484, maxY: 5492, z: 0 };
  const ACTIVE_FINAL_NPC_BY_PLAYER = new WeakMap();
  const JUBBLY_BY_PLAYER = new WeakMap();
  const LAMP_PENDING = new WeakMap();
  const FINALE_NPCS = new WeakMap();
  const MOTHER_PHASES = new WeakMap();
  const FINAL_AREA_BY_PLAYER = new WeakMap();
  const COUNCIL_BY_PLAYER = new WeakMap();
  let pirateRockPilesInstalled = false;
  const FINAL_ROOM = { x: 1900, y: 5355, z: 2 };
  const FINAL_ROOM_BOUNDS = { minX: 1889, maxX: 1910, minY: 5345, maxY: 5366, z: 2 };
  const COUNCIL_SPAWNS = [
    { id: NpcIdentifiers.MOUNTAIN_DWARF, x: 3236, y: 3219 },
    { id: NpcIdentifiers.GENERAL_WARTFACE_5, x: 3237, y: 3219 },
    { id: NpcIdentifiers.GENERAL_BENTNOZE_5, x: 3238, y: 3219 },
    { id: NpcIdentifiers.PIRATE_PETE_3, x: 3239, y: 3219 },
    { id: NpcIdentifiers.LUMBRIDGE_GUIDE_4, x: 3240, y: 3219 },
    { id: NpcIdentifiers.EVIL_DAVE_3, x: 3236, y: 3220 },
    { id: NpcIdentifiers.SKRACH_UGLOGWEE, x: 3237, y: 3220 },
    { id: NpcIdentifiers.SIR_AMIK_VARZE_3, x: 3238, y: 3220 },
    { id: NpcIdentifiers.AWOWOGEI, x: 3239, y: 3220 },
    { id: NpcIdentifiers.ARIS_3, x: 3240, y: 3220 },
  ];
  function ensureCouncilTalkActions() {
    for (const { id } of COUNCIL_SPAWNS) {
      const actions = api.core.NpcDefinition.forId(id)?.getActions?.();
      if (Array.isArray(actions) && !actions.includes("Talk-to")) actions[0] = "Talk-to";
    }
  }
  function ensureOgreBoatTalkActions() {
    try {
      for (const id of [4858, 4859, 6260, 6261]) {
        const actions = api.core.NpcDefinition.forId(id)?.getActions?.();
        if (Array.isArray(actions) && !actions.includes("Board")) actions[0] = "Board";
      }
    } catch (error) {
      if (!String(error?.message).includes("Cache pipeline has not been initialized")) throw error;
    }
  }
  const ENTRY_PORTAL_TILE = { x: 3209, y: 3218, z: 0 };
  const PIRATE_PAGE = "Recipe for Disaster/Freeing Pirate Pete";
  const GOBLIN_PAGE = "Recipe for Disaster/Freeing the Goblin generals";
  const DWARF_PAGE = "Recipe for Disaster/Freeing the Mountain Dwarf";
  const MURPHY_IDS = new Set([NpcIdentifiers.MURPHY, NpcIdentifiers.MURPHY_2, NpcIdentifiers.MURPHY_3, NpcIdentifiers.MURPHY_4]);
  const NUNG_IDS = new Set([NpcIdentifiers.NUNG]);
  const GOBLIN_COOK_IDS = new Set([NpcIdentifiers.GOBLIN_COOK, NpcIdentifiers.GOBLIN_COOK_2, NpcIdentifiers.GOBLIN_COOK_3]);
  const RANTZ_IDS = new Set([1470, NpcIdentifiers.RANTZ, NpcIdentifiers.RANTZ_2, NpcIdentifiers.RANTZ_3,
    NpcIdentifiers.RANTZ_4, NpcIdentifiers.RANTZ_5]);
  const OGRE_BOAT_IDS = new Set([4858, 4859, 6260, 6261]);
  const EVIL_CHICKEN_IDS = new Set([NpcIdentifiers.EVIL_CHICKEN, NpcIdentifiers.EVIL_CHICKEN_2,
    NpcIdentifiers.EVIL_CHICKEN_3, NpcIdentifiers.EVIL_CHICKEN_HARD_]);
  const BLACK_DRAGON_IDS = new Set([NpcIdentifiers.BLACK_DRAGON, NpcIdentifiers.BLACK_DRAGON_2,
    NpcIdentifiers.BLACK_DRAGON_3, NpcIdentifiers.BLACK_DRAGON_4, NpcIdentifiers.BLACK_DRAGON_5,
    NpcIdentifiers.BLACK_DRAGON_6, NpcIdentifiers.BLACK_DRAGON_7, NpcIdentifiers.BLACK_DRAGON_8,
    NpcIdentifiers.BLACK_DRAGON_9, NpcIdentifiers.BLACK_DRAGON_10, NpcIdentifiers.BLACK_DRAGON_11,
    NpcIdentifiers.BLACK_DRAGON_12, NpcIdentifiers.BLACK_DRAGON_13, NpcIdentifiers.BLACK_DRAGON_14,
    NpcIdentifiers.BLACK_DRAGON_15]);
  const GORILLA_GREEGREE_IDS = [ItemIdentifiers.GORILLA_GREEGREE, ItemIdentifiers.BEARDED_GORILLA_GREEGREE,
    ItemIdentifiers.ANCIENT_GORILLA_GREEGREE, ItemIdentifiers.GORILLA_GREEGREE_2,
    ItemIdentifiers.BEARDED_GORILLA_GREEGREE_2, ItemIdentifiers.ANCIENT_GORILLA_GREEGREE_2];
  const NINJA_GREEGREE_IDS = [ItemIdentifiers.NINJA_MONKEY_GREEGREE, ItemIdentifiers.NINJA_MONKEY_GREEGREE_2,
    ItemIdentifiers.NINJA_MONKEY_GREEGREE_3, ItemIdentifiers.NINJA_MONKEY_GREEGREE_4];
  const ZOMBIE_GREEGREE_IDS = [ItemIdentifiers.ZOMBIE_MONKEY_GREEGREE, ItemIdentifiers.ZOMBIE_MONKEY_GREEGREE_2,
    ItemIdentifiers.ZOMBIE_MONKEY_GREEGREE_3, ItemIdentifiers.ZOMBIE_MONKEY_GREEGREE_4];
  const EVIL_CHICKEN_BY_PLAYER = new WeakMap();
  const FAIRY_DRAGON_BY_PLAYER = new WeakMap();
  const OLD_DWARF_IDS = new Set([NpcIdentifiers.OLD_DWARF, 4810, 6254, 6255]);
  const DWARF_NPCS = new Set([...OLD_DWARF_IDS, NpcIdentifiers.ROHAK, NpcIdentifiers.ROHAK_2,
    NpcIdentifiers.EMILY, NpcIdentifiers.KAYLEE, NpcIdentifiers.TINA, NpcIdentifiers.TINA_2]);
  const TRAIBORN_IDS = new Set([NpcIdentifiers.WIZARD_TRAIBORN, NpcIdentifiers.WIZARD_TRAIBORN_2]);
  const DORIS_IDS = new Set([NpcIdentifiers.DORIS]);
  const WISE_OLD_MAN_IDS = new Set([
    NpcIdentifiers.WISE_OLD_MAN, 2109, NpcIdentifiers.WISE_OLD_MAN_2, NpcIdentifiers.WISE_OLD_MAN_3,
    NpcIdentifiers.WISE_OLD_MAN_4, NpcIdentifiers.WISE_OLD_MAN_5, NpcIdentifiers.WISE_OLD_MAN_6,
    NpcIdentifiers.WISE_OLD_MAN_7, NpcIdentifiers.WISE_OLD_MAN_8, NpcIdentifiers.WISE_OLD_MAN_9,
    NpcIdentifiers.WISE_OLD_MAN_10, NpcIdentifiers.WISE_OLD_MAN_11, NpcIdentifiers.WISE_OLD_MAN_12,
    NpcIdentifiers.WISE_OLD_MAN_13, NpcIdentifiers.WISE_OLD_MAN_14, NpcIdentifiers.WISE_OLD_MAN_15,
  ]);
  const WISE_MONKEY_BITS = new Map([[NpcIdentifiers.MIZARU, 1], [NpcIdentifiers.KIKAZARU, 2], [NpcIdentifiers.IWAZARU, 4]]);
  const TCHIKI_BUSH_IDS = new Set([ObjectIdentifiers.TCHIKI_MONKEY_NUT_BUSH, 16059]);
  const EVIL_DAVE_IDS = new Set([NpcIdentifiers.EVIL_DAVE, NpcIdentifiers.EVIL_DAVE_2,
    NpcIdentifiers.EVIL_DAVE_3, NpcIdentifiers.EVIL_DAVE_4, NpcIdentifiers.EVIL_DAVE_5]);
  const UNDERWATER_ZONE = { minX: 2938, maxX: 3002, minY: 9470, maxY: 9540, z: 1 };
  const MUDSKIPPER_CAVE = { minX: 2943, maxX: 2957, minY: 9518, maxY: 9535, z: 1 };
  const CRAB_PEN = { minX: 2970, maxX: 2988, minY: 9513, maxY: 9526, z: 1 };
  /** Shadow of the Storm's Uzer ruins: its Evil Dave is the same cache id 902, not the Edgeville rescue. */
  const SHADOW_UZER_DAVE_AREA = { minX: 2700, maxX: 2745, minY: 4875, maxY: 4925, levels: [0, 2] };
  const DAVE_SPICES = [
    { color: "red", ids: [ItemIdentifiers.RED_SPICE_4_, ItemIdentifiers.RED_SPICE_3_, ItemIdentifiers.RED_SPICE_2_, ItemIdentifiers.RED_SPICE_1_] },
    { color: "orange", ids: [ItemIdentifiers.ORANGE_SPICE_4_, ItemIdentifiers.ORANGE_SPICE_3_, ItemIdentifiers.ORANGE_SPICE_2_, ItemIdentifiers.ORANGE_SPICE_1_] },
    { color: "brown", ids: [ItemIdentifiers.BROWN_SPICE_4_, ItemIdentifiers.BROWN_SPICE_3_, ItemIdentifiers.BROWN_SPICE_2_, ItemIdentifiers.BROWN_SPICE_1_] },
    { color: "yellow", ids: [ItemIdentifiers.YELLOW_SPICE_4_, ItemIdentifiers.YELLOW_SPICE_3_, ItemIdentifiers.YELLOW_SPICE_2_, ItemIdentifiers.YELLOW_SPICE_1_] },
  ];

  let quest;

  function stage(player) { return quest.getStage(player); }
  function flags(player) { return Number(player.getAttribute(FLAGS_ATTRIBUTE)) || 0; }
  function has(player, itemId, amount = 1) {
    return player.getInventory().getAmount(itemId) >= amount;
  }
  function hasSpace(player, count = 1) {
    return player.getInventory().getFreeSlots() >= count;
  }
  function setFlag(player, flag) {
    player.setAttribute(FLAGS_ATTRIBUTE, flags(player) | flag);
  }
  function syncRescueQuestVarbits(player) {
    for (const [flag, [varbitId, completedValue]] of RESCUE_QUEST_VARBITS) {
      if (hasFlag(player, flag)) player.getPacketSender().sendVarbit(varbitId, completedValue);
    }
    syncDwarfQuestVarbits(player);
    syncGoblinQuestVarbits(player);
    syncDaveQuestVarbits(player);
    syncGuideQuestVarbits(player);
    syncPirateQuestVarbits(player);
    syncSkrachQuestVarbits(player);
    syncAmikQuestVarbits(player);
    syncAwowogeiQuestVarbits(player);
  }
  function pirateQuestStage(player) {
    if (hasFlag(player, 4)) return 110;
    const state = pirateState(player);
    const legacy = state & 8 ? 70 : state & 4 ? 40 : state & 2 ? 30 : state & 1 ? 10 : 0;
    return Math.max(Number(player.getAttribute(PIRATE_STAGE_ATTRIBUTE)) || 0, legacy);
  }
  function syncPirateQuestVarbits(player) {
    player.getPacketSender().sendVarbit(1895, pirateQuestStage(player));
    player.getPacketSender().sendVarbit(1869, Math.min(5, player.getInventory().getAmount(ItemIdentifiers.ROCK_7)));
    player.getPacketSender().sendVarbit(1871, inZone(player, UNDERWATER_ZONE) ? 1 : 0);
    player.getPacketSender().sendVarbit(1872, player.getAttribute(PIRATE_FIRST_DIVE_ATTRIBUTE) ? 1 : 0);
    player.getPacketSender().sendVarbit(1875, Math.min(5, Number(player.getAttribute(PIRATE_HIDES_ATTRIBUTE)) || 0));
  }
  function setPirateStage(player, value) {
    const next = Math.max(Number(player.getAttribute(PIRATE_STAGE_ATTRIBUTE)) || 0, value);
    player.setAttribute(PIRATE_STAGE_ATTRIBUTE, next);
    syncPirateQuestVarbits(player);
  }
  function handlePirateMilestoneLine({ player, npcId, text }) {
    if (!MURPHY_IDS.has(npcId) || hasFlag(player, 4) || stage(player) < STAGE_OPENING_COMPLETE) return;
    if (text?.includes("In the meantime I'll wait, and if you want me to take you diving I'll be ready.")) {
      setPirateStage(player, 20);
    }
  }
  function handlePirateNungMilestoneLine({ player, npcId, text }) {
    if (!NUNG_IDS.has(npcId) || hasFlag(player, 4) || stage(player) < STAGE_OPENING_COMPLETE) return;
    if (text?.includes("You's gotta go up to da topsies, and your gotta get a needly-thing and some wirey stuff.")) {
      setPirateStage(player, 70);
    }
  }
  function handleAmikMilestoneLine({ player, npcId, text }) {
    if (stage(player) < STAGE_OPENING_COMPLETE || hasFlag(player, 64)) return;
    if (BANQUET_ARIS_IDS.has(npcId)
      && text?.includes("To protect this noble knight from the magic of the culinaromancer")) {
      setAmikStage(player, 5);
    } else if (COOK_IDS.has(npcId)
      && text?.includes("Ah yes! Why, I was so impressed with that recipe you created")) {
      setAmikStage(player, 10);
    }
  }
  function handleAwowogeiMilestoneLine({ player, npcId, text }) {
    if (stage(player) < STAGE_OPENING_COMPLETE || hasFlag(player, 128)) return;
    if (npcId === NpcIdentifiers.AWOWOGEI && text === "What? No. Definitely not.") {
      setAwowogeiStage(player, 5);
    } else if (WISE_MONKEY_BITS.has(npcId)
      && (text === "What? eh? Did you say something?" || text === "Who's there? Hello?")) {
      setAwowogeiStage(player, 10);
    }
  }
  function handleSkrachMilestoneLine({ player, npcId, text }) {
    if (stage(player) < STAGE_OPENING_COMPLETE || hasFlag(player, 32)) return;
    if (RANTZ_IDS.has(npcId)) {
      if (text?.includes("You's creatures says what Rantz need for da going over da big water")) {
        setSkrachStage(player, 30);
      } else if (text?.startsWith("Is what me's says...you's creature no helpsies")) {
        setSkrachStage(player, 40);
      } else if (text?.startsWith("Ok, the boat's ready, now tell me how to get a Jubbly?")) {
        setSkrachStage(player, 70);
      } else if (text?.startsWith("Ok, now tell me how to get Jubbly!")) {
        setSkrachStage(player, 100);
      }
    }
  }
  function guideQuestStage(player) {
    if (hasFlag(player, 8)) return 5;
    const state = Number(player.getAttribute(GUIDE_STATE_ATTRIBUTE)) || 0;
    const legacy = (state & 7) === 7 ? 3 : state !== 0 ? 2 : 0;
    return Math.max(Number(player.getAttribute(GUIDE_STAGE_ATTRIBUTE)) || 0, legacy);
  }
  function syncGuideQuestVarbits(player) {
    const state = Number(player.getAttribute(GUIDE_STATE_ATTRIBUTE)) || 0;
    player.getPacketSender().sendVarbit(1896, guideQuestStage(player));
    player.getPacketSender().sendVarbit(1894, state & 1 ? 1 : 0);
    player.getPacketSender().sendVarbit(1897, state & 4 ? 1 : 0);
    player.getPacketSender().sendVarbit(1898, state & 2 ? 1 : 0);
  }
  function setGuideStage(player, value) {
    const next = Math.max(Number(player.getAttribute(GUIDE_STAGE_ATTRIBUTE)) || 0, value);
    player.setAttribute(GUIDE_STAGE_ATTRIBUTE, next);
    syncGuideQuestVarbits(player);
  }
  function handleGuideMilestoneLine({ player, npcId, text, pages }) {
    if (stage(player) < STAGE_OPENING_COMPLETE || hasFlag(player, 8)) return;
    if (BANQUET_ARIS_IDS.has(npcId) && text === "Okay, thanks, I'll get right on it!"
      && pages?.some(({ page, variants }) => page === "Recipe for Disaster/Freeing the Lumbridge Guide"
        && variants?.includes("starting-out-inspecting-the-lumbridge-guide"))) {
      setGuideStage(player, 1);
      return;
    }
    if (TRAIBORN_IDS.has(npcId) && text?.includes("Bring me the basic ingredients")) setGuideStage(player, 2);
  }
  function dwarfQuestStage(player) {
    if (hasFlag(player, 1)) return 60;
    const saved = Number(player.getAttribute(DWARF_STAGE_ATTRIBUTE)) || 0;
    const state = dwarfState(player);
    const legacy = state & 0x800 ? 50 : state & 0x400 ? 40 : state & 0x200 ? 30
      : (state & 7) > 0 ? 20 : state !== 0 ? 10 : 0;
    return Math.max(saved, legacy);
  }
  function syncDwarfQuestVarbits(player) {
    const state = dwarfState(player);
    player.getPacketSender().sendVarbit(1892, dwarfQuestStage(player));
    player.getPacketSender().sendVarbit(1891, dwarfQuestStage(player) >= 20 ? 1 : 0);
    player.getPacketSender().sendVarbit(1893, state & 7);
  }
  function goblinQuestStage(player) {
    if (hasFlag(player, 2)) return 40;
    const saved = Number(player.getAttribute(GOBLIN_STAGE_ATTRIBUTE)) || 0;
    const state = goblinState(player);
    const legacy = state & GOBLIN_SLOP_RECEIVED ? 35 : state & 2 ? 15 : 0;
    return Math.max(saved, legacy);
  }
  function syncGoblinQuestVarbits(player) {
    const state = goblinState(player);
    player.getPacketSender().sendVarbit(1867, goblinQuestStage(player));
    player.getPacketSender().sendVarbit(1868, (state & 2) !== 0 ? 1 : 0);
  }
  function setGoblinStage(player, value) {
    const next = Math.max(Number(player.getAttribute(GOBLIN_STAGE_ATTRIBUTE)) || 0, value);
    player.setAttribute(GOBLIN_STAGE_ATTRIBUTE, next);
    syncGoblinQuestVarbits(player);
  }
  function daveQuestStage(player) {
    if (hasFlag(player, 16)) return 5;
    const saved = Number(player.getAttribute(DAVE_STAGE_ATTRIBUTE)) || 0;
    const state = Number(player.getAttribute(DAVE_STATE_ATTRIBUTE)) || 0;
    const legacy = state & 4 ? 4 : state & 2 ? 2 : state & 1 ? 1 : 0;
    return Math.max(saved, legacy);
  }
  function syncDaveQuestVarbits(player) {
    const recipe = player.getAttribute(DAVE_RECIPE_ATTRIBUTE) ?? {};
    const stew = player.getAttribute(DAVE_STEW_ATTRIBUTE)?.doses ?? {};
    player.getPacketSender().sendVarbit(1878, daveQuestStage(player));
    for (const [color, currentVarbit, targetVarbit] of [
      ["red", 1879, 1883], ["yellow", 1880, 1884],
      ["brown", 1881, 1885], ["orange", 1882, 1886],
    ]) {
      player.getPacketSender().sendVarbit(currentVarbit, Number(stew[color]) || 0);
      player.getPacketSender().sendVarbit(targetVarbit, Number(recipe[color]) || 0);
    }
  }
  function setDaveStage(player, value) {
    const next = Math.max(Number(player.getAttribute(DAVE_STAGE_ATTRIBUTE)) || 0, value);
    player.setAttribute(DAVE_STAGE_ATTRIBUTE, next);
    syncDaveQuestVarbits(player);
  }
  function handleDaveMilestoneLine(event) {
    const { player, npcId, text } = event;
    if (stage(player) < STAGE_OPENING_COMPLETE || hasFlag(player, 16)) return;
    if (BANQUET_ARIS_IDS.has(npcId) && text?.includes("In her basement. I make no judgement about that.")) {
      setDaveStage(player, 1);
      return;
    }
    if (EVIL_DAVE_IDS.has(npcId)
      && text?.includes("Well it tasted like the stews my mum makes. She puts these spices in them.")) {
      player.setAttribute(DAVE_STATE_ATTRIBUTE, (Number(player.getAttribute(DAVE_STATE_ATTRIBUTE)) || 0) | 1);
      if (!player.getAttribute(DAVE_RECIPE_ATTRIBUTE)) {
        const recipe = Object.fromEntries(DAVE_SPICES.map(({ color }) => [color, 1 + Math.floor(Math.random() * 3)]));
        player.setAttribute(DAVE_RECIPE_ATTRIBUTE, recipe);
      }
      setDaveStage(player, 2);
      return;
    }
    if (DORIS_IDS.has(npcId) && text?.includes("I'd better go and kill some hell-rats then.")) {
      player.setAttribute(DAVE_STATE_ATTRIBUTE, (Number(player.getAttribute(DAVE_STATE_ATTRIBUTE)) || 0) | 2);
      setDaveStage(player, 3);
    }
  }
  function handleGoblinMilestoneLine(event) {
    const { player, npcId, text } = event;
    if (stage(player) < STAGE_OPENING_COMPLETE || hasFlag(player, 2)) return;
    if (BANQUET_ARIS_IDS.has(npcId) && text?.includes("Well you could try asking some of the other goblins")) {
      setGoblinStage(player, 5);
      return;
    }
    if (!GOBLIN_COOK_IDS.has(npcId)) return;
    if (text?.includes("Ok, I'll see what I can do.")) setGoblinStage(player, 10);
    else if (text?.includes("Bring 'em all to me and Mudknuckles will make suitable dish.")) setGoblinStage(player, 30);
  }
  function setDwarfStage(player, value) {
    const next = Math.max(Number(player.getAttribute(DWARF_STAGE_ATTRIBUTE)) || 0, value);
    player.setAttribute(DWARF_STAGE_ATTRIBUTE, next);
    syncDwarfQuestVarbits(player);
  }
  function handleDwarfMilestoneLine(event) {
    const { player, npcId, text } = event;
    if (stage(player) < STAGE_OPENING_COMPLETE || hasFlag(player, 1)) return;
    if (BANQUET_ARIS_IDS.has(npcId)
      && text?.includes("His fondness for rock cakes could prove key in")) {
      setDwarfStage(player, 10);
      return;
    }
    if ([NpcIdentifiers.EMILY, NpcIdentifiers.KAYLEE, NpcIdentifiers.TINA, NpcIdentifiers.TINA_2].includes(npcId)
      && text?.startsWith("Mmmmm... the secret is in the gold.")) {
      player.setAttribute(DWARF_STATE_ATTRIBUTE, dwarfState(player) | 16);
      setDwarfStage(player, 20);
      return;
    }
    if (!DWARF_NPCS.has(npcId)) return;
    if (text === "Fer you! Anyfin'! Fer a price of course!") {
      player.setAttribute(DWARF_STATE_ATTRIBUTE, dwarfState(player) | 0x200);
      setDwarfStage(player, 30);
    } else if (text?.startsWith("Also... you'll need to get the ingredients too.")) {
      player.setAttribute(DWARF_STATE_ATTRIBUTE, dwarfState(player) | 0x400);
      setDwarfStage(player, 40);
    }
  }
  function handleRescueStatusQuery(event) {
    const { player, rescue } = event;
    const flag = {
      "mountain-dwarf": 1,
      goblins: 2,
      "pirate-pete": 4,
      "lumbridge-guide": 8,
      "evil-dave": 16,
      "skrach-uglogwee": 32,
      "sir-amik": 64,
      "king-awowogei": 128,
    }[rescue];
    if (player && flag !== undefined) event.complete = hasFlag(player, flag);
  }
  function ensureEntryPortal() {
    const { GameObject, ObjectManager, Location, ObjectIdentifiers } = api.core;
    const location = new Location(ENTRY_PORTAL_TILE.x, ENTRY_PORTAL_TILE.y, ENTRY_PORTAL_TILE.z);
    if (ObjectManager.objectsAt?.(location)?.some((object) => object.getId?.() === ObjectIdentifiers.PORTAL)) return;
    ObjectManager.register(new GameObject(ObjectIdentifiers.PORTAL, location, 10, 0, null), true);
  }
  function hasFlag(player, flag) { return (flags(player) & flag) !== 0; }
  function atShadowUzerDave(player) {
    const location = player.getLocation?.();
    return !!location && SHADOW_UZER_DAVE_AREA.levels.includes(location.getZ()) &&
      location.getX() >= SHADOW_UZER_DAVE_AREA.minX && location.getX() <= SHADOW_UZER_DAVE_AREA.maxX &&
      location.getY() >= SHADOW_UZER_DAVE_AREA.minY && location.getY() <= SHADOW_UZER_DAVE_AREA.maxY;
  }
  function spawnCouncil(player) {
    if (stage(player) < STAGE_OPENING_COMPLETE || quest.isComplete(player)) return;
    ensureCouncilTalkActions();
    const spawns = COUNCIL_SPAWNS.filter(({ id }) => {
      const rescue = RESCUES.find((entry) => entry.ids.includes(id));
      return !rescue || !hasFlag(player, rescue.flag);
    });
    const existing = COUNCIL_BY_PLAYER.get(player);
    if (existing?.length === spawns.length && existing.every((npc) => npc?.isRegistered?.() !== false)) return;
    for (const npc of existing ?? []) api.removeNpc?.(npc);
    COUNCIL_BY_PLAYER.set(player, spawns.map((spawn) => api.spawnNpc({
      ...spawn, z: 0, wanderRadius: 0, owner: player, ownerOnly: true,
    })).filter(Boolean));
  }
  function completed(player, flag) {
    if (hasFlag(player, flag)) return false;
    setFlag(player, flag);
    syncRescueQuestVarbits(player);
    syncSkrachSpitRoast(player);
    awardPoint(player);
    spawnCouncil(player);
    return true;
  }
  function awardPoint(player) {
    const points = (Number(player.getAttribute(QUEST_POINTS_ATTRIBUTE)) || 0) + 1;
    player.setAttribute(QUEST_POINTS_ATTRIBUTE, points);
    player.getPacketSender().sendConfig(101, points);
    refreshQuestList(player);
  }
  function level(player, skill) {
    return player.getSkillManager().getCurrentLevel(skill);
  }
  function skrachState(player) { return Number(player.getAttribute(SKRACH_STATE_ATTRIBUTE)) || 0; }
  function skrachQuestStage(player) {
    if (hasFlag(player, 32)) return 170;
    const state = skrachState(player);
    const legacy = state & 16 ? 80 : state & 8 ? 90 : state & 4 ? 60 : state & 2 ? 50 : state & 1 ? 20 : 0;
    return Math.max(Number(player.getAttribute(SKRACH_STAGE_ATTRIBUTE)) || 0, legacy);
  }
  function syncSkrachQuestVarbits(player) {
    const state = skrachState(player);
    const progress = skrachQuestStage(player);
    player.getPacketSender().sendVarbit(1904, progress);
    player.getPacketSender().sendVarbit(1905, progress >= 10 && progress < 170 ? 1 : 0);
    player.getPacketSender().sendVarbit(1906, state & SKRACH_TREE_PUSHED ? 1 : 0);
    player.getPacketSender().sendVarbit(1907, state & SKRACH_ARROW_FIRED ? 1 : 0);
    player.getPacketSender().sendVarbit(VARBIT_OGRE_BOAT, state & 1 || hasFlag(player, 32) ? 1 : 0);
    player.getPacketSender().sendVarbit(1909, state & SKRACH_FREE_RIDE_TAKEN ? 1 : 0);
  }
  function setSkrachStage(player, value) {
    const next = Math.max(Number(player.getAttribute(SKRACH_STAGE_ATTRIBUTE)) || 0, value);
    player.setAttribute(SKRACH_STAGE_ATTRIBUTE, next);
    syncSkrachQuestVarbits(player);
  }
  function setSkrachBit(player, bit) {
    player.setAttribute(SKRACH_STATE_ATTRIBUTE, skrachState(player) | bit);
    syncSkrachQuestVarbits(player);
  }
  /** The Feldip chompy-grounds spit-roast is missing from the map; show it to this player while Skrach can be rescued. */
  function syncSkrachSpitRoast(player) {
    const { GameObject, Location, ObjectManager } = api.core;
    const existing = SKRACH_SPIT_ROAST_BY_PLAYER.get(player);
    if (stage(player) < STAGE_OPENING_COMPLETE || hasFlag(player, 32)) {
      if (!existing) return;
      ObjectManager.deregister(existing, true);
      SKRACH_SPIT_ROAST_BY_PLAYER.delete(player);
      return;
    }
    if (existing) return;
    const object = new GameObject(SKRACH_SPIT_ROAST_OBJECT,
      new Location(SKRACH_SPIT_ROAST_TILE.x, SKRACH_SPIT_ROAST_TILE.y, SKRACH_SPIT_ROAST_TILE.z), 10, 0, null)
      .setOwner(player);
    ObjectManager.register(object, true);
    SKRACH_SPIT_ROAST_BY_PLAYER.set(player, object);
  }
  function clearSkrachSpitRoast(player) {
    const object = SKRACH_SPIT_ROAST_BY_PLAYER.get(player);
    if (!object) return;
    api.core.ObjectManager.deregister(object, true);
    SKRACH_SPIT_ROAST_BY_PLAYER.delete(player);
  }
  function completedQuest(player, key) {
    return require("../QuestRuntime").getRegisteredQuests()
      .find((entry) => entry.key === key)?.isComplete(player) === true;
  }
  function oneSmallFavourAtRantz(player) {
    const osf = require("../QuestRuntime").getRegisteredQuests()
      .find((entry) => entry.key === "one_small_favour");
    return osf ? OSF_RANTZ_STAGES.has(osf.getStage(player)) : false;
  }
  function hasKharaziAccess(player) {
    const quests = require("../QuestRuntime").getRegisteredQuests();
    const legends = quests.find((entry) => entry.key === "legends_quest");
    return ["family_crest", "heroes_quest", "lost_city", "merlins_crystal", "shield_of_arrav",
      "dragon_slayer_i", "shilo_village", "jungle_potion", "druidic_ritual", "underground_pass",
      "biohazard", "plague_city", "waterfall_quest"]
      .every((key) => completedQuest(player, key)) && (legends?.getStage(player) ?? 0) >= 5;
  }
  function rescueRequirement(player, flag) {
    const all = (keys) => keys.every((key) => completedQuest(player, key));
    const checks = {
      1: [completedQuest(player, "fishing_contest")],
      2: [completedQuest(player, "goblin_diplomacy")],
      4: [level(player, Skill.COOKING) >= 31],
      8: [level(player, Skill.COOKING) >= 40, all(["big_chompy_bird_hunting", "biohazard", "demon_slayer",
        "murder_mystery", "nature_spirit", "witchs_house"])],
      16: [level(player, Skill.COOKING) >= 25, all(["gertrudes_cat", "shadow_of_the_storm"])],
      32: [level(player, Skill.COOKING) >= 41, level(player, Skill.FIREMAKING) >= 20,
        completedQuest(player, "big_chompy_bird_hunting")],
      64: [(Number(player.getAttribute(QUEST_POINTS_ATTRIBUTE)) || 0) >= 107, hasKharaziAccess(player)],
      128: [level(player, Skill.COOKING) >= 70, level(player, Skill.AGILITY) >= 48,
        completedQuest(player, "monkey_madness_i")],
    }[flag] ?? [];
    return checks.every(Boolean);
  }
  function rescueRequirementText(flag) {
    return ({
      1: "You need to complete Fishing Contest before helping the Mountain Dwarf.",
      2: "You need to complete Goblin Diplomacy before helping the goblin generals.",
      4: "You need level 31 Cooking before helping Pirate Pete.",
      8: "You need level 40 Cooking, Big Chompy Bird Hunting, Biohazard, Demon Slayer, Murder Mystery, Nature Spirit and Witch's House before helping the Lumbridge Guide.",
      16: "You need level 25 Cooking, Gertrude's Cat and Shadow of the Storm before helping Evil Dave.",
      32: "You need level 41 Cooking, level 20 Firemaking and completion of Big Chompy Bird Hunting before helping Skrach.",
      64: "You need 107 quest points, the Legends' Quest prerequisites and access to the Kharazi Jungle before helping Sir Amik.",
      128: "You need level 70 Cooking, level 48 Agility and Monkey Madness I before helping King Awowogei.",
    })[flag];
  }
  function pirateState(player) { return Number(player.getAttribute(PIRATE_ATTRIBUTE)) || 0; }
  function setPirateState(player, value) { player.setAttribute(PIRATE_ATTRIBUTE, value | 0); }
  function goblinState(player) { return Number(player.getAttribute(GOBLIN_STATE_ATTRIBUTE)) || 0; }
  function dwarfState(player) { return Number(player.getAttribute(DWARF_STATE_ATTRIBUTE)) || 0; }
  function inZone(player, zone) {
    const loc = player.getLocation?.();
    return !!loc && loc.getZ() === zone.z && loc.getX() >= zone.minX && loc.getX() <= zone.maxX
      && loc.getY() >= zone.minY && loc.getY() <= zone.maxY;
  }
  function moveTo(player, x, y, z) {
    player.moveTo(new api.core.Location(x, y, z));
  }
  function installPirateRockPiles() {
    if (pirateRockPilesInstalled) return;
    pirateRockPilesInstalled = true;
    const { GameObject, Location, ObjectManager, ObjectIdentifiers } = api.core;
    const ids = [ObjectIdentifiers.PILE_OF_ROCK_5, ObjectIdentifiers.PILE_OF_ROCK_6,
      ObjectIdentifiers.PILE_OF_ROCK_7, ObjectIdentifiers.PILE_OF_ROCK_8];
    // The underwater entrance is in cache, but its quest rock piles are absent
    // from the loaded region data. Place them around the entrance's west lip.
    const tiles = [{ x: 2946, y: 9515 }, { x: 2947, y: 9515 },
      { x: 2946, y: 9517 }, { x: 2947, y: 9517 }];
    for (let index = 0; index < tiles.length; index++) {
      const tile = tiles[index];
      ObjectManager.register(new GameObject(ids[index], new Location(tile.x, tile.y, 1), 10, 0, null), true);
    }
  }
  function addItem(player, itemId, amount = 1) {
    if (hasSpace(player)) player.getInventory().adds(itemId, amount);
    else player.sendMessage("You need some inventory space first.");
  }
  function equipmentId(player, slot) { return player.getEquipment().get(slot)?.getId?.(); }
  function hasOrEquipped(player, itemId, slot) {
    return has(player, itemId) || equipmentId(player, slot) === itemId;
  }
  function carriedWeight(player) {
    let weight = 0;
    for (const container of [player.getInventory(), player.getEquipment()]) {
      const items = container.getItems?.() ?? [];
      for (const item of items) {
        if (item?.getId?.() > 0 && item.getAmount?.() > 0) {
          weight += Number(item.getDefinition?.().getWeight?.()) || 0;
        }
      }
    }
    return weight;
  }
  function hasPetCarried(player) {
    return (player.getInventory().getItems?.() ?? []).some((item) => {
      const name = item?.getDefinition?.().getName?.() ?? "";
      return /^(?:pet )?(?:kitten|cat|wily cat|hellcat)/i.test(name);
    });
  }
  function follower(player) {
    const npc = player.getAttribute("pets:current");
    return npc?.isRegistered?.() ? npc : null;
  }
  function followerIsCat(player) {
    const npc = follower(player);
    if (!npc) return false;
    const name = api.core.NpcDefinition.forId(npc.getId())?.getName?.() ?? "";
    return /(?:kitten|cat|hellcat|wily cat)/i.test(name);
  }
  function hasCookAssistant(player) {
    return require("../QuestRuntime").getRegisteredQuests()
      .find((entry) => entry.key === "cooks_assistant")?.isComplete(player) === true;
  }
  function meetsOpeningRequirements(player) {
    return hasCookAssistant(player) && level(player, Skill.COOKING) >= 10;
  }

  function selectVariant({ npcId, player, pages }) {
    if (!player || !pages?.length) return null;
    const page = pages.find((entry) => entry.page === PAGE);
    const amik = RESCUES.find((entry) => entry.flag === 64);
    if (amik && WISE_OLD_MAN_IDS.has(npcId) && stage(player) >= STAGE_OPENING_COMPLETE
      && !hasFlag(player, 64) && Number(player.getAttribute(AMIK_STATE_ATTRIBUTE)) === 1
      && Number(player.getAttribute(AMIK_WOM_BRIEFED_ATTRIBUTE)) !== 1
      && pages.some((entry) => entry.page === amik.page)) {
      return { page: amik.page, variant: "finding-the-lair-talking-to-the-wise-old-man" };
    }
    if (COOK_IDS.has(npcId) && page) {
      if (pirateState(player) & 16) {
        const pirateVariant = pages.find((entry) => entry.page === PIRATE_PAGE);
        if (pirateVariant) return { page: PIRATE_PAGE, variant: "finishing-up-talking-to-the-cook" };
      }
      if (stage(player) === 0 && hasCookAssistant(player)) return { page: PAGE, variant: "starting-out" };
      if (stage(player) === STAGE_STARTED) {
        const all = [ItemIdentifiers.EYE_OF_NEWT, ItemIdentifiers.GREENMANS_ALE,
          ItemIdentifiers.ROTTEN_TOMATO, ItemIdentifiers.DIRTY_BLAST].every((id) => has(player, id));
        return { page: PAGE, variant: all
          ? "d-j-vu-talking-to-the-cook-with-all-of-the-ingredients"
          : "d-j-vu-talking-to-the-cook-without-all-of-the-ingredients" };
      }
      if (stage(player) >= STAGE_OPENING_COMPLETE && !quest.isComplete(player)) {
        return { page: PAGE, variant: "recipe-for-success" };
      }
    }
    if (BANQUET_ARIS_IDS.has(npcId)) {
      if (canBeginFinale(player)) {
        const finalPage = "Recipe for Disaster/Defeating the Culinaromancer";
        if (pages.some((entry) => entry.page === finalPage)) {
          const portalOpen = Number(player.getAttribute(FINAL_FIGHT_ATTRIBUTE)) === -1;
          return { page: finalPage, variant: portalOpen ? "starting-off-talking-to-aris-again" : "starting-off" };
        }
      }
      if (stage(player) >= STAGE_OPENING_COMPLETE) {
        const nextRescue = RESCUES.find((entry) => !hasFlag(player, entry.flag));
        if (nextRescue && pages.some((entry) => entry.page === nextRescue.page)) {
          return { page: nextRescue.page, variant: nextRescue.variant };
        }
      }
      const arisPage = pages.find((entry) => entry.page === "Recipe for Disaster/Another Cook's Quest");
      if (arisPage && stage(player) < STAGE_OPENING_COMPLETE) {
        return { page: arisPage.page, variant: "chef-surprise-talking-to-aris" };
      }
    }
    if (DWARF_NPCS.has(npcId) && stage(player) >= STAGE_OPENING_COMPLETE && !hasFlag(player, 1)
      && pages.some((entry) => entry.page === DWARF_PAGE)) {
      return { page: DWARF_PAGE, variant: dwarfNpcVariant(player, npcId) };
    }
    if (DORIS_IDS.has(npcId) && pages.some((entry) => entry.page === "Recipe for Disaster/Freeing Evil Dave")) {
      const state = Number(player.getAttribute(DAVE_STATE_ATTRIBUTE)) || 0;
      return { page: "Recipe for Disaster/Freeing Evil Dave", variant: state & 2
        ? "getting-the-recipe-from-doris-talking-to-doris-again" : "talking-to-doris" };
    }
    if (EVIL_DAVE_IDS.has(npcId) && !atShadowUzerDave(player) &&
      pages.some((entry) => entry.page === "Recipe for Disaster/Freeing Evil Dave")) {
      const state = Number(player.getAttribute(DAVE_STATE_ATTRIBUTE)) || 0;
      return { page: "Recipe for Disaster/Freeing Evil Dave", variant: state & 1
        ? "talking-to-evil-dave-talking-to-evil-dave-again-after-getting-him-to-tell-you-what-he-ate"
        : "talking-to-evil-dave" };
    }
    if (MURPHY_IDS.has(npcId) && pages.some((entry) => entry.page === PIRATE_PAGE)) {
      const state = pirateState(player);
      const variant = state & 2 ? "asking-about-giant-crabs-talking-to-murphy-again-again"
        : state & 1 ? "asking-about-giant-crabs-talking-to-murphy-again"
          : "asking-about-giant-crabs-talking-to-murphy";
      return { page: PIRATE_PAGE, variant };
    }
    if (GOBLIN_COOK_IDS.has(npcId) && pages.some((entry) => entry.page === GOBLIN_PAGE)) {
      return { page: GOBLIN_PAGE, variant: selectGoblinCookVariant(player) };
    }
    if (NUNG_IDS.has(npcId) && pages.some((entry) => entry.page === PIRATE_PAGE)) {
      const hides = Number(player.getAttribute(PIRATE_HIDES_ATTRIBUTE)) || 0;
      if (hides >= 5 && has(player, ItemIdentifiers.NEEDLE) && has(player, ItemIdentifiers.BRONZE_WIRE, 3)) return { page: PIRATE_PAGE, variant: "underwater-talking-to-nung-with-the-wire-and-needle" };
      if (has(player, ItemIdentifiers.MUDSKIPPER_HIDE)) return { page: PIRATE_PAGE, variant: "underwater-bringing-nung-the-mudskipper-hides" };
      return { page: PIRATE_PAGE, variant: hides >= 5 ? "underwater-talking-to-nung-again-2" : "underwater-talking-to-nung" };
    }
    if (COUNCIL_IDS.has(npcId) && stage(player) >= STAGE_OPENING_COMPLETE) {
      const rescue = RESCUES.find(({ ids }) => ids.includes(npcId));
      if (rescue && pages.some((entry) => entry.page === rescue.page)) {
        if (!hasFlag(player, rescue.flag)) {
          if (rescue.flag === 8 && has(player, ItemIdentifiers.CAKE_OF_GUIDANCE)) {
            return { page: rescue.page, variant: "finishing-up-inspecting-the-lumbridge-guide-after-baking-the-cake" };
          }
          return { page: rescue.page, variant: rescue.variant };
        }
        return { page: rescue.page, variant: "starting-out-talking-to-the-cook" };
      }
    }
    if (FINAL_NPCS.has(npcId) && stage(player) >= STAGE_OPENING_COMPLETE) {
      const finalPage = "Recipe for Disaster/Defeating the Culinaromancer";
      if (pages.some((entry) => entry.page === finalPage)) return { page: finalPage, variant: "facing-the-culinaromancer-fighting-agrith-na-na" };
    }
    return null;
  }

  function answerCondition({ npcId, player, stepId, text, pages }) {
    const value = String(text || "").toLowerCase();
    const pageNames = (pages ?? []).map(entry => String(entry?.page ?? ""));
    const ownPage = pageNames.some(page => page.startsWith("Recipe for Disaster"));
    // The castle Cook's shared menu is the only non-RFD page RFD answers.
    const ownCondition = ownPage || (COOK_IDS.has(npcId) && pageNames.includes("Cook (Lumbridge)"));
    if (OGRE_BOAT_IDS.has(npcId)) {
      const inventory = player.getInventory();
      const chompies = [ItemIdentifiers.RAW_CHOMPY, ItemIdentifiers.RAW_CHOMPY_2,
        ItemIdentifiers.COOKED_CHOMPY, ItemIdentifiers.COOKED_CHOMPY_2,
        ItemIdentifiers.COOKED_CHOMPY_3, ItemIdentifiers.COOKED_CHOMPY_4,
        ItemIdentifiers.COOKED_CHOMPY_5, ItemIdentifiers.COOKED_CHOMPY_6];
      const herbs = [ItemIdentifiers.SNAKE_WEED, ItemIdentifiers.SNAKE_WEED_2,
        ItemIdentifiers.ROGUES_PURSE, ItemIdentifiers.ROGUES_PURSE_2];
      const chompyCount = chompies.reduce((count, id) => count + inventory.getAmount(id), 0);
      const herbCount = herbs.reduce((count, id) => count + inventory.getAmount(id), 0);
      if (stepId === "n8xiFU" || value.includes("does not have two chompies")) return chompyCount < 2;
      if (stepId === "OFh9AH" || value.includes("carrying any karamjan rum")) {
        return [ItemIdentifiers.KARAMJAN_RUM, ItemIdentifiers.KARAMJAN_RUM_2,
          ItemIdentifiers.KARAMJAN_RUM_3, ItemIdentifiers.KARAMJAN_RUM_4,
          ItemIdentifiers.KARAMJAN_RUM_5, ItemIdentifiers.KARAMJAN_RUM_6]
          .some((id) => has(player, id));
      }
      if (stepId === "jx9b44" || value.includes("does not have two snake weed")) return herbCount < 2;
      if (stepId === "7ke2SD" || stepId === "SN91cd" || value.includes("has sufficient payment")) {
        return npcId === 6261 || npcId === 4858 ? herbCount >= 2 : chompyCount >= 2;
      }
    }
    if (npcId === NpcIdentifiers.KKLIK && value.includes("holding the brulee")) return has(player, ItemIdentifiers.BRULEE_3);
    if (npcId === NpcIdentifiers.KKLIK && value.includes("not wearing ice gloves")) {
      return equipmentId(player, api.core.Equipment.HANDS_SLOT) !== ItemIdentifiers.ICE_GLOVES;
    }
    if (npcId === NpcIdentifiers.KKLIK && value.includes("wearing an anti-dragon shield")) {
      return equipmentId(player, api.core.Equipment.SHIELD_SLOT) === ItemIdentifiers.ANTI_DRAGON_SHIELD;
    }
    // The castle Cook's shared post-Cook's Assistant menu guards the quest link
    // behind the world membership check. Leaving this unanswered falls through
    // to the F2P line on a members world and makes RFD appear unavailable.
    if (ownCondition && value.includes("free-to-play world")) return false;
    if (ownCondition && value.includes("members' world")) return true;
    if (stepId === "2hoQn_" || (ownPage && value.includes("has completed beneath cursed sands"))) return false;
    if (ownCondition && (value.includes("does not meet the requirements") || value.includes("doesn't meet the requirements"))) {
      return !meetsOpeningRequirements(player);
    }
    if (ownPage && value.includes("still has all the ingredients")) {
      return [ItemIdentifiers.ENCHANTED_EGG, ItemIdentifiers.ENCHANTED_MILK, ItemIdentifiers.ENCHANTED_FLOUR]
        .every((id) => has(player, id));
    }
    if (ownPage && value.includes("lost the enchanted egg")) {
      return (Number(player.getAttribute(GUIDE_STATE_ATTRIBUTE)) & 1) !== 0 && !has(player, ItemIdentifiers.ENCHANTED_EGG);
    }
    if (ownPage && value.includes("lost the enchanted flour")) {
      return (Number(player.getAttribute(GUIDE_STATE_ATTRIBUTE)) & 4) !== 0 && !has(player, ItemIdentifiers.ENCHANTED_FLOUR);
    }
    if (ownPage && value.includes("lost the enchanted milk")) {
      return (Number(player.getAttribute(GUIDE_STATE_ATTRIBUTE)) & 2) !== 0 && !has(player, ItemIdentifiers.ENCHANTED_MILK);
    }
    if (ownPage && value.includes("still has the slop of compromise")) return has(player, ItemIdentifiers.SLOP_OF_COMPROMISE);
    if (ownPage && value.includes("lost the slop of compromise")) return !has(player, ItemIdentifiers.SLOP_OF_COMPROMISE);
    if ((ownCondition && value.includes("meets the requirements")) ||
      (COOK_IDS.has(npcId) && value.includes("has completed cook's assistant"))) {
      return meetsOpeningRequirements(player);
    }
    const ingredients = [ItemIdentifiers.EYE_OF_NEWT, ItemIdentifiers.GREENMANS_ALE,
      ItemIdentifiers.ROTTEN_TOMATO, ItemIdentifiers.DIRTY_BLAST];
    const count = ingredients.filter((id) => has(player, id)).length;
    const counts = { v58oc_: count === 0, UHRblb: count > 0 && count < 4,
      "1obKVD": count === 1, XWxiAx: count === 2,
      V02anF: !has(player, ItemIdentifiers.EYE_OF_NEWT) && ingredients.filter((id) => id !== ItemIdentifiers.EYE_OF_NEWT).every((id) => has(player, id)),
      ciFlfn: !has(player, ItemIdentifiers.ROTTEN_TOMATO) && ingredients.filter((id) => id !== ItemIdentifiers.ROTTEN_TOMATO).every((id) => has(player, id)),
      mejHA0: !has(player, ItemIdentifiers.GREENMANS_ALE) && ingredients.filter((id) => id !== ItemIdentifiers.GREENMANS_ALE).every((id) => has(player, id)),
      "5Ks1A9": !has(player, ItemIdentifiers.DIRTY_BLAST) && ingredients.filter((id) => id !== ItemIdentifiers.DIRTY_BLAST).every((id) => has(player, id)) };
    if (Object.prototype.hasOwnProperty.call(counts, stepId)) return counts[stepId];
    if (stepId === "2hAlI1" || stepId === "0EUWB6"
      || (ownPage && value.includes("has a full inventory"))) return !hasSpace(player);
    if (ownPage && value.includes("doesn't have a fishbowl")) return !has(player, ItemIdentifiers.EMPTY_FISHBOWL);
    if (ownPage && value.includes("has a fishbowl")) return has(player, ItemIdentifiers.EMPTY_FISHBOWL);
    if (ownPage && value.includes("lost their diving helmet")) return !hasOrEquipped(player, ItemIdentifiers.FISHBOWL_HELMET, api.core.Equipment.HEAD_SLOT);
    if (ownPage && value.includes("lost their diving apparatus")) return !hasOrEquipped(player, ItemIdentifiers.DIVING_APPARATUS, api.core.Equipment.CAPE_SLOT);
    if (ownPage && value.includes("all their equipment")) return hasOrEquipped(player, ItemIdentifiers.FISHBOWL_HELMET, api.core.Equipment.HEAD_SLOT)
      && hasOrEquipped(player, ItemIdentifiers.DIVING_APPARATUS, api.core.Equipment.CAPE_SLOT);
    if (ownPage && value.includes("doesn't have the diving equipment on")) {
      const { Equipment } = api.core;
      return equipmentId(player, Equipment.HEAD_SLOT) !== ItemIdentifiers.FISHBOWL_HELMET
        || equipmentId(player, Equipment.CAPE_SLOT) !== ItemIdentifiers.DIVING_APPARATUS;
    }
    if (stepId === "bPnGSr") return !!follower(player) && !followerIsCat(player);
    if (stepId === "V2XqCw") return !!follower(player) && followerIsCat(player);
    if (stepId === "gnpYPb") return hasPetCarried(player);
    if (ownPage && value.includes("weighs more than 27kg")) return carriedWeight(player) >= 28_000;
    if (ownPage && value.includes("properly equipped")) {
      const { Equipment } = api.core;
      return equipmentId(player, Equipment.HEAD_SLOT) === ItemIdentifiers.FISHBOWL_HELMET
        && equipmentId(player, Equipment.CAPE_SLOT) === ItemIdentifiers.DIVING_APPARATUS
        && carriedWeight(player) < 28_000;
    }
    if (DWARF_NPCS.has(npcId)) {
      const ingredients = [ItemIdentifiers.BOWL_OF_WATER, ItemIdentifiers.EGG,
        ItemIdentifiers.POT_OF_FLOUR, ItemIdentifiers.BUCKET_OF_MILK];
      const count = ingredients.filter((id) => has(player, id)).length;
      if (value.includes("has none of the items")) return count === 0;
      if (value.includes("only has some of the items")) return count > 0 && count < ingredients.length;
      if (value.includes("has all the items")) return count === ingredients.length;
      if (value.includes("doesn't have enough money")) return !has(player, ItemIdentifiers.COINS, 100);
      if (value.includes("has enough money")) return has(player, ItemIdentifiers.COINS, 100);
    }
    if (stepId === "WmehZl") return player.getInventory().getAmount(ItemIdentifiers.ROCK_7) < 5;
    if (stepId === "-Rkyte") return player.getInventory().getAmount(ItemIdentifiers.ROCK_7) >= 5;
    if (stepId === "C6CK1v") return (Number(player.getAttribute(PIRATE_HIDES_ATTRIBUTE)) || 0) < 5;
    if (stepId === "UGb69y") return (Number(player.getAttribute(PIRATE_HIDES_ATTRIBUTE)) || 0) >= 5;
    if (stepId === "WVCcz4") return player.getInventory().getAmount(ItemIdentifiers.ROCK_7) < 5;
    if (stepId === "DiCCHX") return player.getInventory().getAmount(ItemIdentifiers.ROCK_7) >= 5;
    if (stepId === "EqX7Md") return !(pirateState(player) & 8) || player.getInventory().getAmount(ItemIdentifiers.ROCK_7) < 5;
    if (DWARF_NPCS.has(npcId)) {
      if (value.includes("does not have a chocolate bar or a plain pizza")) {
        return !has(player, ItemIdentifiers.CHOCOLATE_BAR) && !has(player, ItemIdentifiers.PLAIN_PIZZA);
      }
      if (value.includes("has a chocolate bar")) return has(player, ItemIdentifiers.CHOCOLATE_BAR);
      if (value.includes("has a plain pizza")) return has(player, ItemIdentifiers.PLAIN_PIZZA);
      if (stepId === "Q7t6lW") return !has(player, ItemIdentifiers.COINS, 50);
      if (stepId === "w7YUwx") return has(player, ItemIdentifiers.COINS, 50);
      if (stepId === "1bnxLR") return !has(player, ItemIdentifiers.COINS, 100);
      if (stepId === "tkGHyl") return has(player, ItemIdentifiers.COINS, 100);
      if (stepId === "3_RhO9") return !has(player, ItemIdentifiers.COINS, 200);
      if (stepId === "YI4hrK") {
        return has(player, ItemIdentifiers.COINS, 200) && equipmentId(player, api.core.Equipment.RING_SLOT) !== ItemIdentifiers.RING_OF_CHAROS_A_;
      }
      if (stepId === "_2PKzo") {
        return has(player, ItemIdentifiers.COINS, 150) && equipmentId(player, api.core.Equipment.RING_SLOT) === ItemIdentifiers.RING_OF_CHAROS_A_;
      }
      if (value.includes("does not have enough money")) return !has(player, ItemIdentifiers.COINS, 200);
      if (value.includes("has enough money and does not have the ring of charos")) {
        return has(player, ItemIdentifiers.COINS, 200) && equipmentId(player, api.core.Equipment.RING_SLOT) !== ItemIdentifiers.RING_OF_CHAROS_A_;
      }
      if (value.includes("has enough money and the ring of charos")) {
        return has(player, ItemIdentifiers.COINS, 150) && equipmentId(player, api.core.Equipment.RING_SLOT) === ItemIdentifiers.RING_OF_CHAROS_A_;
      }
      if (value.includes("has enough money")) return has(player, ItemIdentifiers.COINS, 200);
    }
    return null;
  }

  function handleHook({ player, npcId, hook }) {
    if (!COOK_IDS.has(npcId) || hook !== START_HOOK || stage(player) !== 0) return;
    quest.setStage(player, STAGE_STARTED);
    player.getInventory().adds(ItemIdentifiers.COINS, 100);
  }

  function handleMurphy(event) {
    const { player, npcId } = event;
    if (!MURPHY_IDS.has(npcId) || stage(player) < STAGE_OPENING_COMPLETE || hasFlag(player, 4)) return false;
    const option = event.definition?.getActions?.()?.[event.clickType - 1];
    if (option !== "Talk-to") return false;
    event.handled = true;
    const { startTranscript } = require("../QuestRuntime");
    const state = pirateState(player);
    const variant = state & 2 ? "asking-about-giant-crabs-talking-to-murphy-again-again"
      : state & 1 ? "asking-about-giant-crabs-talking-to-murphy-again"
        : "asking-about-giant-crabs-talking-to-murphy";
    startTranscript(api, player, npcId, PIRATE_PAGE, variant);
    return true;
  }

  function handlePirateChoice({ player, npcId, option }) {
    if (!MURPHY_IDS.has(npcId) || option !== "Talk about Recipe for Disaster.") return;
    setPirateState(player, pirateState(player) | 1);
    setPirateStage(player, 10);
  }

  function handleNungItem(event) {
    const { player, npcId, itemId } = event;
    if (!NUNG_IDS.has(npcId) || !inZone(player, UNDERWATER_ZONE)) return;
    if (itemId === ItemIdentifiers.MUDSKIPPER_HIDE && !hasFlag(player, 4)) {
      event.handled = true;
      player.getInventory().deleteNumber(itemId, 1);
      const given = (Number(player.getAttribute(PIRATE_HIDES_ATTRIBUTE)) || 0) + 1;
      player.setAttribute(PIRATE_HIDES_ATTRIBUTE, given);
      syncPirateQuestVarbits(player);
      setPirateStage(player, given >= 5 ? 60 : 50);
      const { startTranscript } = require("../QuestRuntime");
      startTranscript(api, player, npcId, PIRATE_PAGE, "underwater-bringing-nung-the-mudskipper-hides");
      return;
    }
    if (itemId === ItemIdentifiers.NEEDLE && (Number(player.getAttribute(PIRATE_HIDES_ATTRIBUTE)) || 0) >= 5
      && has(player, ItemIdentifiers.BRONZE_WIRE, 3)) {
      event.handled = true;
      player.getInventory().deleteNumber(ItemIdentifiers.NEEDLE, 1);
      player.getInventory().deleteNumber(ItemIdentifiers.BRONZE_WIRE, 3);
      setPirateState(player, pirateState(player) | 8);
      setPirateStage(player, 80);
      const { startTranscript } = require("../QuestRuntime");
      startTranscript(api, player, npcId, PIRATE_PAGE, "underwater-talking-to-nung-with-the-wire-and-needle");
    }
  }

  function handlePirateObjects(event) {
    const { player, objectId } = event;
    const option = event.definition?.getActions?.()?.[event.clickType - 1];
    const { ObjectIdentifiers } = api.core;
    if (!inZone(player, UNDERWATER_ZONE)) return;
    if ([ObjectIdentifiers.KELP, ObjectIdentifiers.KELP_2].includes(objectId) && ["Pick", "Pick Kelp", "Take"].includes(option)) {
      event.handled = true;
      addItem(player, ItemIdentifiers.KELP);
      return;
    }
    const rockPiles = [ObjectIdentifiers.PILE_OF_ROCK_5, ObjectIdentifiers.PILE_OF_ROCK_6,
      ObjectIdentifiers.PILE_OF_ROCK_7, ObjectIdentifiers.PILE_OF_ROCK_8];
    if (rockPiles.includes(objectId) && ["Take", "Search", "Pick-up", "Mine"].includes(option)) {
      event.handled = true;
      if (player.getInventory().getAmount(ItemIdentifiers.ROCK_7) >= 5) {
        player.sendMessage("You have enough rocks to cross the current safely.");
        return;
      }
      const before = player.getInventory().getAmount(ItemIdentifiers.ROCK_7);
      addItem(player, ItemIdentifiers.ROCK_7);
      if (player.getInventory().getAmount(ItemIdentifiers.ROCK_7) <= before) return;
      syncPirateQuestVarbits(player);
      setPirateStage(player, 50);
      return;
    }
    const caveIds = [ObjectIdentifiers.UNDERWATER_CAVERN_ENTRANCE, ObjectIdentifiers.UNDERWATER_CAVERN_ENTRANCE_2,
      ObjectIdentifiers.UNDERWATER_CAVERN_ENTRANCE_3, ObjectIdentifiers.UNDERWATER_CAVERN_ENTRANCE_4];
    if (caveIds.includes(objectId) && option === "Exit" && inZone(player, MUDSKIPPER_CAVE)) {
      event.handled = true;
      moveTo(player, 2948, 9512, 1);
      return;
    }
    if (caveIds.includes(objectId) && ["Enter", "Climb-down", "Open"].includes(option)) {
      event.handled = true;
      if (player.getInventory().getAmount(ItemIdentifiers.ROCK_7) < 5) {
        const { startTranscript } = require("../QuestRuntime");
        startTranscript(api, player, NpcIdentifiers.MOGRE_GUARD, PIRATE_PAGE, "underwater-entering-the-underwater-cavern-entrance");
        return;
      }
      moveTo(player, 2948, 9524, 1);
      player.setAttribute(PIRATE_FIRST_DIVE_ATTRIBUTE, true);
      syncPirateQuestVarbits(player);
      setPirateStage(player, 40);
      return;
    }
    if ([ObjectIdentifiers.PEN_DOOR, ObjectIdentifiers.PEN_DOOR_2].includes(objectId)
      && ["Open", "Enter", "Pass-through"].includes(option)) {
      event.handled = true;
      if (!(pirateState(player) & 8)) {
        const { startTranscript } = require("../QuestRuntime");
        startTranscript(api, player, NpcIdentifiers.MOGRE_GUARD, PIRATE_PAGE, "underwater-trying-to-open-the-pen-door-early");
        return;
      }
      if (player.getInventory().getAmount(ItemIdentifiers.ROCK_7) < 5) {
        player.sendMessage("The current is too strong; you need five rocks to stand on the sea bed.");
        return;
      }
      if (inZone(player, CRAB_PEN)) moveTo(player, 2975, 9512, 1);
      else moveTo(player, 2975, 9518, 1);
      return;
    }
    const anchors = [ObjectIdentifiers.ANCHOR_4, ObjectIdentifiers.ANCHOR_5,
      ObjectIdentifiers.ANCHOR_6, ObjectIdentifiers.ANCHOR_7];
    if (anchors.includes(objectId) && ["Climb", "Climb-up", "Use"].includes(option)) {
      event.handled = true;
      if (player.getInventory().getAmount(ItemIdentifiers.ROCK_7) > 0) {
        player.sendMessage("You have to drop all your rocks before you can surface.");
        return;
      }
      if (has(player, ItemIdentifiers.MUDSKIPPER_HIDE)) {
        player.getInventory().deleteNumber(ItemIdentifiers.MUDSKIPPER_HIDE,
          player.getInventory().getAmount(ItemIdentifiers.MUDSKIPPER_HIDE));
        player.sendMessage("The mudskipper hides slip away in the water. Nung wanted them before you surfaced.");
      }
      setPirateState(player, pirateState(player) & ~4);
      moveTo(player, 2668, 3162, 0);
      syncPirateQuestVarbits(player);
    }
  }

  function isItemPair(event, first, second) {
    return (event.usedItemId === first && event.usedWithItemId === second)
      || (event.usedItemId === second && event.usedWithItemId === first);
  }

  function handlePirateFoodItems(event) {
    const { player } = event;
    if (stage(player) < STAGE_OPENING_COMPLETE || hasFlag(player, 4)) return;
    const recipes = [
      [ItemIdentifiers.RAW_COD, ItemIdentifiers.PESTLE_AND_MORTAR, ItemIdentifiers.GROUND_COD, "finishing-up-using-raw-cod-on-a-pestle-and-mortar"],
      [ItemIdentifiers.GIANT_CRAB_MEAT, ItemIdentifiers.PESTLE_AND_MORTAR, ItemIdentifiers.GROUND_GIANT_CRAB_MEAT, "finishing-up-using-crab-meat-on-a-pestle-and-mortar"],
      [ItemIdentifiers.KELP, ItemIdentifiers.PESTLE_AND_MORTAR, ItemIdentifiers.GROUND_KELP, "finishing-up-using-kelp-on-a-pestle-and-mortar"],
      [ItemIdentifiers.BREAD, ItemIdentifiers.KNIFE, ItemIdentifiers.BREADCRUMBS, "finishing-up-using-a-knife-on-bread"],
    ];
    for (const [ingredient, tool, output, variant] of recipes) {
      if (!isItemPair(event, ingredient, tool)) continue;
      event.handled = true;
      player.getInventory().deleteNumber(ingredient, 1);
      player.getInventory().adds(output, 1);
      const { startTranscript } = require("../QuestRuntime");
      startTranscript(api, player, NpcIdentifiers.COOK, PIRATE_PAGE, variant);
      return;
    }
    const pieces = [ItemIdentifiers.GROUND_COD, ItemIdentifiers.GROUND_KELP,
      ItemIdentifiers.GROUND_GIANT_CRAB_MEAT, ItemIdentifiers.BREADCRUMBS];
    if (pieces.includes(event.usedItemId) && pieces.includes(event.usedWithItemId)) {
      event.handled = true;
      if (!pieces.every((id) => has(player, id))) {
        player.sendMessage("The recipe calls for ground cod, ground kelp, ground giant crab meat and breadcrumbs.");
        return;
      }
      for (const id of pieces) player.getInventory().deleteNumber(id, 1);
      player.getInventory().adds(ItemIdentifiers.RAW_FISHCAKE, 1);
      setPirateStage(player, 90);
      const { startTranscript } = require("../QuestRuntime");
      startTranscript(api, player, NpcIdentifiers.COOK, PIRATE_PAGE, "finishing-up-combining-the-ingredients");
    }
  }

  function handlePirateRange(event) {
    const { player, itemId, objectId } = event;
    const { ObjectIdentifiers } = api.core;
    if (itemId !== ItemIdentifiers.RAW_FISHCAKE || ![
      ObjectIdentifiers.COOKING_RANGE, ObjectIdentifiers.RANGE, ObjectIdentifiers.COOKING_RANGE_2,
      ObjectIdentifiers.RANGE_2, ObjectIdentifiers.RANGE_3,
    ].includes(objectId) || !(pirateState(player) & 16)) return;
    event.handled = true;
    player.getInventory().deleteNumber(ItemIdentifiers.RAW_FISHCAKE, 1);
    const cooking = level(player, Skill.COOKING);
    const burnChance = Math.max(0, Math.min(0.75, (31 - cooking) * 0.015));
    const result = Math.random() < burnChance ? ItemIdentifiers.BURNT_FISHCAKE : ItemIdentifiers.COOKED_FISHCAKE;
    addItem(player, result);
    setPirateStage(player, result === ItemIdentifiers.COOKED_FISHCAKE ? 100 : 90);
    const { startTranscript } = require("../QuestRuntime");
    startTranscript(api, player, NpcIdentifiers.COOK, PIRATE_PAGE, "finishing-up-cooking-a-fishcake");
  }

  function handleAction(event) {
    const { player, stepId, action } = event;
    if (event.handled || stage(player) === 0) return;
    if (RANTZ_IDS.has(event.npcId) && stepId === "AKuMx3" && stage(player) >= STAGE_OPENING_COMPLETE
      && !hasFlag(player, 32)) {
      setSkrachBit(player, SKRACH_TREE_PUSHED);
      return;
    }
    if (RANTZ_IDS.has(event.npcId) && stepId === "rPhLu8" && stage(player) >= STAGE_OPENING_COMPLETE
      && !hasFlag(player, 32)) {
      setSkrachBit(player, SKRACH_ARROW_FIRED);
      return;
    }
    if (["tOD_lg", "oKXrmY"].includes(stepId)
      && (skrachState(player) & 16) && !hasFlag(player, 32)) {
      setSkrachBit(player, 8);
      moveTo(player, 2655, 2964, 0);
      event.handled = true;
      return;
    }
    if (OGRE_BOAT_IDS.has(event.npcId) && ["f2OXgM", "Lt1Y5S"].includes(stepId)) {
      const inventory = player.getInventory();
      const items = stepId === "f2OXgM"
        ? [ItemIdentifiers.RAW_CHOMPY, ItemIdentifiers.RAW_CHOMPY_2,
          ItemIdentifiers.COOKED_CHOMPY, ItemIdentifiers.COOKED_CHOMPY_2,
          ItemIdentifiers.COOKED_CHOMPY_3, ItemIdentifiers.COOKED_CHOMPY_4,
          ItemIdentifiers.COOKED_CHOMPY_5, ItemIdentifiers.COOKED_CHOMPY_6]
        : [ItemIdentifiers.SNAKE_WEED, ItemIdentifiers.SNAKE_WEED_2,
          ItemIdentifiers.ROGUES_PURSE, ItemIdentifiers.ROGUES_PURSE_2];
      let remaining = 2;
      for (const id of items) {
        const amount = Math.min(remaining, inventory.getAmount(id));
        if (amount) inventory.deleteNumber(id, amount);
        remaining -= amount;
        if (!remaining) break;
      }
      moveTo(player, stepId === "f2OXgM" ? 2790 : 2655, stepId === "f2OXgM" ? 3077 : 2964, 0);
      event.handled = true;
      return;
    }
    if (stepId === "AprD5B" && event.npcId === NpcIdentifiers.KKLIK
      && has(player, ItemIdentifiers.DRAGON_TOKEN) && has(player, ItemIdentifiers.BRULEE_3)) {
      finishFlambe(player);
      return;
    }
    if (stepId === "kMq9sJ" && action === "receive") {
      if (!has(player, ItemIdentifiers.FRUIT_BLAST) || !has(player, ItemIdentifiers.ASHES) || !hasSpace(player)) return;
      player.getInventory().deleteNumber(ItemIdentifiers.FRUIT_BLAST, 1);
      player.getInventory().deleteNumber(ItemIdentifiers.ASHES, 1);
      player.getInventory().adds(ItemIdentifiers.DIRTY_BLAST, 1);
      event.handled = true;
      return;
    }
    if (GOBLIN_COOK_IDS.has(event.npcId) && stepId === "aDep1a") {
      if (!has(player, ItemIdentifiers.CHARCOAL)) return;
      player.getInventory().deleteNumber(ItemIdentifiers.CHARCOAL, 1);
      player.setAttribute(GOBLIN_STATE_ATTRIBUTE, goblinState(player) | 2);
      setGoblinStage(player, 15);
      return;
    }
    if (GOBLIN_COOK_IDS.has(event.npcId) && stepId === "n9iLpk") {
      const parts = [ItemIdentifiers.DYED_ORANGE, ItemIdentifiers.SOGGY_BREAD, ItemIdentifiers.SPICY_MAGGOTS];
      if (!parts.every((id) => has(player, id)) || !hasSpace(player)) return;
      for (const id of parts) player.getInventory().deleteNumber(id, 1);
      player.getInventory().adds(ItemIdentifiers.SLOP_OF_COMPROMISE, 1);
      player.setAttribute(GOBLIN_STATE_ATTRIBUTE, goblinState(player) | GOBLIN_SLOP_RECEIVED);
      setGoblinStage(player, 35);
      event.handled = true;
      return;
    }
    if (GOBLIN_COOK_IDS.has(event.npcId) && stepId === "jKFpD-") {
      if (has(player, ItemIdentifiers.SLOP_OF_COMPROMISE) || !hasSpace(player)) return;
      player.getInventory().adds(ItemIdentifiers.SLOP_OF_COMPROMISE, 1);
      player.setAttribute(GOBLIN_STATE_ATTRIBUTE, goblinState(player) | GOBLIN_SLOP_RECEIVED);
      setGoblinStage(player, 35);
      event.handled = true;
      return;
    }
    if (DWARF_NPCS.has(event.npcId) && ["v6k1zE", "ALTCu0"].includes(stepId)) {
      for (const id of [ItemIdentifiers.BOWL_OF_WATER, ItemIdentifiers.EGG,
        ItemIdentifiers.POT_OF_FLOUR, ItemIdentifiers.BUCKET_OF_MILK]) player.getInventory().deleteNumber(id, 1);
      return;
    }
    if (DWARF_NPCS.has(event.npcId) && stepId === "wpCexm") {
      if (hasSpace(player)) {
        player.getInventory().adds(ItemIdentifiers.DWARVEN_ROCK_CAKE, 1);
        player.setAttribute(DWARF_STATE_ATTRIBUTE, dwarfState(player) | 0x800);
        setDwarfStage(player, 50);
      }
      else player.sendMessage("You need an empty inventory slot to take the hot rock cake.");
      return;
    }
    if (DWARF_NPCS.has(event.npcId) && stepId === "dqFo5Y") {
      const count = dwarfState(player) & 7;
      if (count === 0 && has(player, ItemIdentifiers.ASGOLDIAN_ALE)) {
        player.getInventory().deleteNumber(ItemIdentifiers.ASGOLDIAN_ALE, 1);
        player.setAttribute(DWARF_STATE_ATTRIBUTE, (dwarfState(player) & ~7) | 1);
        syncDwarfQuestVarbits(player);
      }
      return;
    }
    if (DWARF_NPCS.has(event.npcId) && stepId === "f9I7o9") {
      player.getInventory().deleteNumber(ItemIdentifiers.COINS, 100);
      return;
    }
    if (DWARF_NPCS.has(event.npcId) && ["9KHClW", "VIoVIB", "QrDkgJ", "nEtD3S"].includes(stepId)) {
      const cost = { "9KHClW": 50, VIoVIB: 100, QrDkgJ: 200, nEtD3S: 150 }[stepId];
      player.getInventory().deleteNumber(ItemIdentifiers.COINS, cost);
      if (stepId === "9KHClW") player.getInventory().deleteNumber(ItemIdentifiers.CHOCOLATE_BAR, 1);
      if (stepId === "VIoVIB") player.getInventory().deleteNumber(ItemIdentifiers.PLAIN_PIZZA, 1);
      player.setAttribute(DWARF_STATE_ATTRIBUTE, dwarfState(player) | 16);
      syncDwarfQuestVarbits(player);
      return;
    }
    if (event.npcId === NpcIdentifiers.MURPHY && event.pages?.some(({ page }) => page === PIRATE_PAGE)
      && stepId === "FY6rCP") {
      if (!has(player, ItemIdentifiers.EMPTY_FISHBOWL) || !hasSpace(player)) {
        player.sendMessage("Make room and bring Murphy a fishbowl before he prepares your diving gear.");
        event.handled = true;
        event.end = true;
        return;
      }
      player.getInventory().deleteNumber(ItemIdentifiers.EMPTY_FISHBOWL, 1);
      player.getInventory().adds(ItemIdentifiers.DIVING_APPARATUS, 1);
      player.getInventory().adds(ItemIdentifiers.FISHBOWL_HELMET, 1);
      setPirateState(player, pirateState(player) | 2);
      setPirateStage(player, 30);
      return;
    }
    if (stepId === "azBBMr") {
      const { Equipment } = api.core;
      if (equipmentId(player, Equipment.HEAD_SLOT) !== ItemIdentifiers.FISHBOWL_HELMET
        || equipmentId(player, Equipment.CAPE_SLOT) !== ItemIdentifiers.DIVING_APPARATUS
        || carriedWeight(player) >= 28_000 || player.getInventory().getFreeSlots() < 7
        || player.getAttribute("pets:current")?.isRegistered?.() || hasPetCarried(player)) {
        player.sendMessage("To dive, wear the fishbowl helmet and diving apparatus, weigh less than 28 kg, leave seven inventory slots free, and put away any pet.");
        event.handled = true;
        event.end = true;
        return;
      }
      setPirateState(player, pirateState(player) | 4);
      player.setAttribute(PIRATE_FIRST_DIVE_ATTRIBUTE, true);
      moveTo(player, 2960, 9512, 1);
      setPirateStage(player, 40);
      return;
    }
    if (stepId === "5j7eiW" && stage(player) === STAGE_STARTED) {
      const ingredients = [ItemIdentifiers.EYE_OF_NEWT, ItemIdentifiers.GREENMANS_ALE,
        ItemIdentifiers.ROTTEN_TOMATO, ItemIdentifiers.DIRTY_BLAST];
      if (!ingredients.every((id) => has(player, id))) return;
      for (const id of ingredients) player.getInventory().deleteNumber(id, 1);
      quest.setStage(player, STAGE_OPENING_COMPLETE);
      awardPoint(player);
      spawnCouncil(player);
      return;
    }
    if (stepId === "D4lnhQ" && canBeginFinale(player)) {
      player.setAttribute(FINAL_FIGHT_ATTRIBUTE, -1);
      return;
    }
    if (stepId === "LCDDwN" && canBeginFinale(player)) {
      player.setAttribute(FINAL_FIGHT_ATTRIBUTE, -1);
      ensureEntryPortal();
      return;
    }
    if (stepId === "ILo79M" && canBeginFinale(player)
      && player.getAttribute(FINAL_BOSS_DEFEATED_ATTRIBUTE) === true) {
      quest.complete(player);
      leaveFinalRoom(player);
    }
  }

  function finishFlambe(player) {
    player.getInventory().deleteNumber(ItemIdentifiers.DRAGON_TOKEN, 1);
    player.getInventory().deleteNumber(ItemIdentifiers.BRULEE_3, 1);
    addItem(player, ItemIdentifiers.BRULEE_SUPREME);
    FAIRY_DRAGON_BY_PLAYER.delete(player);
  }

  function handleFlambeLine(event) {
    if (event.npcId !== NpcIdentifiers.KKLIK || event.text !== "Sure, that's easy."
      || equipmentId(event.player, api.core.Equipment.HANDS_SLOT) !== ItemIdentifiers.ICE_GLOVES) return;
    event.after = () => {
      if (stage(event.player) >= STAGE_OPENING_COMPLETE
        && has(event.player, ItemIdentifiers.DRAGON_TOKEN) && has(event.player, ItemIdentifiers.BRULEE_3)) {
        finishFlambe(event.player);
      }
    };
  }

  function handleDaveTalk(event) {
    if (!EVIL_DAVE_IDS.has(event.npcId) || stage(event.player) < STAGE_OPENING_COMPLETE || hasFlag(event.player, 16)) return false;
    if (atShadowUzerDave(event.player)) return false;
    const option = event.definition?.getActions?.()?.[event.clickType - 1];
    if (option !== "Talk-to") return false;
    event.handled = true;
    const state = Number(event.player.getAttribute(DAVE_STATE_ATTRIBUTE)) || 0;
    if (!(state & 1)) {
      if (!event.player.getAttribute(DAVE_RECIPE_ATTRIBUTE)) {
        const recipe = Object.fromEntries(DAVE_SPICES.map(({ color }) => [color, 1 + Math.floor(Math.random() * 3)]));
        event.player.setAttribute(DAVE_RECIPE_ATTRIBUTE, recipe);
      }
      syncDaveQuestVarbits(event.player);
    }
    require("../QuestRuntime").startTranscript(api, event.player, event.npcId,
      "Recipe for Disaster/Freeing Evil Dave", state & 1
        ? "talking-to-evil-dave-talking-to-evil-dave-again-after-getting-him-to-tell-you-what-he-ate"
        : "talking-to-evil-dave");
    return true;
  }

  function handleDorisTalk(event) {
    if (!DORIS_IDS.has(event.npcId) || stage(event.player) < STAGE_OPENING_COMPLETE || hasFlag(event.player, 16)) return false;
    const option = event.definition?.getActions?.()?.[event.clickType - 1];
    if (option !== "Talk-to") return false;
    event.handled = true;
    const state = Number(event.player.getAttribute(DAVE_STATE_ATTRIBUTE)) || 0;
    const variant = state & 2 ? "getting-the-recipe-from-doris-talking-to-doris-again"
      : state & 1 ? "getting-the-recipe-from-doris" : "talking-to-doris";
    require("../QuestRuntime").startTranscript(api, event.player, event.npcId,
      "Recipe for Disaster/Freeing Evil Dave", variant);
    return true;
  }

  function dropDaveSpice({ player, verminName, location }) {
    if (verminName !== "Hell-Rat" || stage(player) < STAGE_OPENING_COMPLETE || hasFlag(player, 16)
      || !(Number(player.getAttribute(DAVE_STATE_ATTRIBUTE)) & 2) || !location) return;
    const spice = DAVE_SPICES[Math.floor(Math.random() * DAVE_SPICES.length)];
    const dose = 1 + Math.floor(Math.random() * spice.ids.length);
    const { Item, Location } = api.core;
    api.getItemOnGroundManager().registerLocation(player, new Item(spice.ids[spice.ids.length - dose], 1),
      new Location(location.getX(), location.getY(), location.getZ()));
    player.sendMessage(`Your cat catches a hell-rat and finds ${spice.color} spice (${dose}).`);
  }

  function spiceForItem(itemId) {
    for (const spice of DAVE_SPICES) {
      const index = spice.ids.indexOf(itemId);
      if (index >= 0) return { color: spice.color, doses: spice.ids.length - index };
    }
    return null;
  }

  function handleDaveStewMix(event) {
    const { player, usedItemId, usedWithItemId } = event;
    if (stage(player) < STAGE_OPENING_COMPLETE || hasFlag(player, 16)
      || !(Number(player.getAttribute(DAVE_STATE_ATTRIBUTE)) & 2)) return;
    const stewId = [ItemIdentifiers.STEW, ItemIdentifiers.STEW_2, ItemIdentifiers.STEW_3]
      .find((id) => id === usedItemId || id === usedWithItemId);
    const spicyId = [ItemIdentifiers.SPICY_STEW, ItemIdentifiers.SPICY_STEW_2]
      .find((id) => id === usedItemId || id === usedWithItemId);
    const spiceItem = [usedItemId, usedWithItemId].map(spiceForItem).find(Boolean);
    if (!spiceItem || (!stewId && !spicyId)) return;
    event.handled = true;
    const existing = player.getAttribute(DAVE_STEW_ATTRIBUTE);
    const doses = stewId ? {} : { ...(existing?.doses ?? {}) };
    doses[spiceItem.color] = (doses[spiceItem.color] || 0) + spiceItem.doses;
    if (doses[spiceItem.color] > 4) {
      player.sendMessage("That stew already has too much of that spice.");
      return;
    }
    player.getInventory().deleteNumber(stewId ?? spicyId, 1);
    player.getInventory().deleteNumber([usedItemId, usedWithItemId].find((id) => spiceForItem(id)), 1);
    player.getInventory().adds(ItemIdentifiers.SPICY_STEW, 1);
    player.setAttribute(DAVE_STEW_ATTRIBUTE, { doses });
    syncDaveQuestVarbits(player);
    player.sendMessage(`You add ${spiceItem.doses} dose${spiceItem.doses === 1 ? "" : "s"} of ${spiceItem.color} spice to the stew.`);
  }

  function handleDaveStewTaste(event) {
    const { player, npcId, itemId } = event;
    if (!EVIL_DAVE_IDS.has(npcId) || ![ItemIdentifiers.SPICY_STEW, ItemIdentifiers.STEW, ItemIdentifiers.STEW_2, ItemIdentifiers.STEW_3].includes(itemId)
      || stage(player) < STAGE_OPENING_COMPLETE || hasFlag(player, 16)) return;
    event.handled = true;
    const recipe = player.getAttribute(DAVE_RECIPE_ATTRIBUTE);
    const stew = player.getAttribute(DAVE_STEW_ATTRIBUTE);
    const plain = itemId !== ItemIdentifiers.SPICY_STEW;
    const matching = !plain && recipe && stew ? DAVE_SPICES.filter(({ color }) => Number(recipe[color]) === Number(stew.doses?.[color])).length : 0;
    const variant = plain ? "getting-the-recipe-from-doris-stew-tasting-with-evil-dave-plain-stew"
      : matching === 4 ? "getting-the-recipe-from-doris-stew-tasting-with-evil-dave-correct-spicy-stew"
      : matching === 3 ? "getting-the-recipe-from-doris-stew-tasting-with-evil-dave-three-spices-correct"
        : matching === 2 ? "getting-the-recipe-from-doris-stew-tasting-with-evil-dave-two-spices-correct"
          : matching === 1 ? "getting-the-recipe-from-doris-stew-tasting-with-evil-dave-one-spice-correct"
            : "getting-the-recipe-from-doris-stew-tasting-with-evil-dave-completely-wrong-spicy-stew";
    player.getInventory().deleteNumber(itemId, 1);
    if (matching === 4) {
      player.setAttribute(DAVE_STATE_ATTRIBUTE, (Number(player.getAttribute(DAVE_STATE_ATTRIBUTE)) || 0) | 4);
      setDaveStage(player, 4);
    } else syncDaveQuestVarbits(player);
    require("../QuestRuntime").startTranscript(api, player, npcId, "Recipe for Disaster/Freeing Evil Dave", variant);
  }

  function handleLampRub(event) {
    if (event.itemId !== ItemIdentifiers.ANTIQUE_LAMP_3 || !quest.isComplete(event.player)) return false;
    const { player, item, slot } = event;
    LAMP_PENDING.set(player, { item, slot });
    api.emitCustomEvent("xpreward:open", {
      player,
      title: "Choose the stat you wish to be advanced!",
      minLevel: 50,
      onConfirm: (skill, name) => {
        if (LAMP_PENDING.get(player)?.item !== item || player.getInventory().get(slot) !== item) return null;
        LAMP_PENDING.delete(player);
        if (player.getSkillManager().getMaxLevel(skill) < 50) {
          return `You need level 50 ${name ?? skill.getName()} to use this lamp.`;
        }
        const before = player.getSkillManager().getExperience(skill);
        player.getSkillManager().addExperience(skill, 20_000, false);
        if (player.getSkillManager().getExperience(skill) === before) return null;
        player.getInventory().deleteAtSlot(slot, 1);
        return `You have been awarded 20,000 ${name ?? skill.getName()} XP!`;
      },
    });
    return true;
  }

  function rescueByItem(event) {
    const { player, npcId, itemId } = event;
    if (stage(player) < STAGE_OPENING_COMPLETE) return;
    const rescue = RESCUES.find((entry) => entry.ids.includes(npcId));
    if (!rescue || itemId !== rescue.item || hasFlag(player, rescue.flag)) return;
    event.handled = true;
    if (!rescueRequirement(player, rescue.flag)) {
      player.sendMessage(rescueRequirementText(rescue.flag));
      return;
    }
    if (rescue.flag === 128 && !hasMonkeySpeech(player)) {
      player.sendMessage("You need an M'speak amulet to give King Awowogei the stuffed snake.");
      return;
    }
    if (rescue.flag === 16) {
      const recipe = player.getAttribute(DAVE_RECIPE_ATTRIBUTE);
      const stew = player.getAttribute(DAVE_STEW_ATTRIBUTE);
      const state = Number(player.getAttribute(DAVE_STATE_ATTRIBUTE)) || 0;
      const rightRecipe = recipe && stew && DAVE_SPICES.every(({ color }) => Number(recipe[color]) === Number(stew.doses?.[color]));
      if (!(state & 4) || !rightRecipe) {
        player.sendMessage("First find the right recipe with Evil Dave in Edgeville, then bring that same stew back to the banquet.");
        return;
      }
    }
    if (flags(player) !== ALL_RESCUES && (flags(player) | rescue.flag) === ALL_RESCUES && !hasSpace(player)) {
      player.sendMessage("You need an empty inventory slot before freeing the last council member.");
      return;
    }
    player.getInventory().deleteNumber(rescue.item, 1);
    completed(player, rescue.flag);
    if (rescue.flag === 4) {
      const skills = player.getSkillManager();
      for (const skill of [Skill.COOKING, Skill.CRAFTING, Skill.FISHING, Skill.SMITHING]) skills.addExperiences(skill, 1000);
    } else {
      const rewards = {
        1: [[Skill.COOKING, 1000], [Skill.SLAYER, 1000]],
        2: [[Skill.COOKING, 1000], [Skill.CRAFTING, 1000], [Skill.FARMING, 1000]],
        8: [[Skill.COOKING, 2500], [Skill.MAGIC, 2500]],
        16: [[Skill.COOKING, 7000]],
        32: [[Skill.WOODCUTTING, 1500], [Skill.COOKING, 1500], [Skill.CRAFTING, 1500], [Skill.RANGED, 1500]],
        64: [[Skill.COOKING, 4000], [Skill.HITPOINTS, 4000]],
        128: [[Skill.COOKING, 10000], [Skill.AGILITY, 10000]],
      }[rescue.flag] ?? [];
      for (const [skill, amount] of rewards) player.getSkillManager().addExperiences(skill, amount);
    }
    const { startTranscript } = require("../QuestRuntime");
    startTranscript(api, player, npcId, rescue.page, rescue.finish);
    player.sendMessage(`You have freed ${rescue.name}.`);
  }

  function handleCouncilInteraction(event) {
    const { player, npcId } = event;
    if (stage(player) < STAGE_OPENING_COMPLETE) return false;
    const option = event.definition?.getActions?.()?.[event.clickType - 1];
    if (option !== "Talk-to" && option !== "Inspect") return false;
    const rescue = RESCUES.find((entry) => entry.ids.includes(npcId));
    if (!rescue) return false;
    event.handled = true;
    if (!rescueRequirement(player, rescue.flag)) {
      player.sendMessage(rescueRequirementText(rescue.flag));
      return true;
    }
    if (hasFlag(player, rescue.flag)) return true;
    if (has(player, rescue.item)) {
      player.sendMessage(`Use the prepared item on ${rescue.name} to free them.`);
      return true;
    }
    player.sendMessage(`Speak to Aris about freeing ${rescue.name} to learn the next step.`);
    return true;
  }

  function handleArisInteraction(event) {
    const { player, npcId } = event;
    if (!BANQUET_ARIS_IDS.has(npcId) || stage(player) < STAGE_OPENING_COMPLETE || canBeginFinale(player)) return false;
    const option = event.definition?.getActions?.()?.[event.clickType - 1];
    if (option !== "Talk-to") return false;
    event.handled = true;
    const pending = RESCUES.filter((entry) => !hasFlag(player, entry.flag));
    const available = pending.filter((entry) => rescueRequirement(player, entry.flag));
    if (available.length === 0) {
      if (pending.length === 0) return false;
      player.sendMessage(rescueRequirementText(pending[0].flag));
      return true;
    }
    const startRescue = (rescue) => {
      if (rescue.flag === 4) setPirateState(player, pirateState(player) | 16);
      if (rescue.flag === 64) player.setAttribute(AMIK_STATE_ATTRIBUTE, 1);
      require("../QuestRuntime").startTranscript(api, player, npcId, rescue.page, rescue.variant);
    };
    if (available.length === 1) {
      startRescue(available[0]);
      return true;
    }
    const showRescueChoices = (offset = 0) => {
      const page = available.slice(offset, offset + 4);
      const choices = page.flatMap((rescue) => [`Free ${rescue.name}`, () => startRescue(rescue)]);
      if (offset + page.length < available.length) {
        choices.push("More rescues…", () => showRescueChoices(offset + page.length));
      }
      api.sendMultiChatboxPrompt(player, "Which council member would you like to help?", ...choices);
    };
    showRescueChoices();
    return true;
  }

  function handleAmikWiseOldMan(event) {
    const { player, npcId, clickType, definition } = event;
    if (!player) return false;
    AMIK_WOM_ACTIVE.delete(player);
    AMIK_WOM_PENDING_BRIEFING.delete(player);
    if (!WISE_OLD_MAN_IDS.has(npcId) || stage(player) < STAGE_OPENING_COMPLETE
      || hasFlag(player, 64) || Number(player.getAttribute(AMIK_STATE_ATTRIBUTE)) !== 1) return false;
    if (definition?.getActions?.()?.[clickType - 1] !== "Talk-to") return false;
    if (Number(player.getAttribute(AMIK_WOM_BRIEFED_ATTRIBUTE)) === 1) return false;
    event.handled = true;
    const started = require("../QuestRuntime").startTranscript(api, player, npcId,
      "Recipe for Disaster/Freeing Sir Amik Varze", "finding-the-lair-talking-to-the-wise-old-man");
    if (started) AMIK_WOM_ACTIVE.add(player);
    return true;
  }

  function handleAmikWiseOldManChoice({ player, npcId, option }) {
    if (!player || !AMIK_WOM_ACTIVE.has(player) || !WISE_OLD_MAN_IDS.has(npcId)) return;
    if (option === "Is there anything I can do for you?") AMIK_WOM_PENDING_BRIEFING.add(player);
    else AMIK_WOM_PENDING_BRIEFING.delete(player);
  }

  function handleAmikWiseOldManBriefingClosed({ player }) {
    if (!player) return;
    AMIK_WOM_ACTIVE.delete(player);
    AMIK_WOM_PENDING_BRIEFING.delete(player);
  }

  function handleAmikWiseOldManBriefing({ player, npcId, pages, text }) {
    if (!player || !AMIK_WOM_PENDING_BRIEFING.has(player) || !WISE_OLD_MAN_IDS.has(npcId)
      || Number(player.getAttribute(AMIK_STATE_ATTRIBUTE)) !== 1
      || hasFlag(player, 64) || text?.replace(/\s+/g, " ") !== "I'm sure I can think of a few little jobs. This won't be a quest, mind you, just a little favour..."
      || !pages?.some(({ page, variants }) => page === "Recipe for Disaster/Freeing Sir Amik Varze"
        && variants?.includes("finding-the-lair-talking-to-the-wise-old-man"))) return;
    AMIK_WOM_PENDING_BRIEFING.delete(player);
    AMIK_WOM_ACTIVE.delete(player);
    player.setAttribute(AMIK_WOM_BRIEFED_ATTRIBUTE, 1);
  }

  function handleMurphyGearReceipt(event) {
    const { player, npcId, pages, text } = event;
    if (npcId !== NpcIdentifiers.MURPHY || !pages?.some(({ page }) => page === PIRATE_PAGE)) return;
    const helmet = text === "Sure, here you go. Try not to lose this one, I'm not a very good glassblower.";
    const apparatus = text === "Here, have this one. Only dropped once!";
    if (!helmet && !apparatus) return;
    const item = helmet ? ItemIdentifiers.FISHBOWL_HELMET : ItemIdentifiers.DIVING_APPARATUS;
    const slot = helmet ? api.core.Equipment.HEAD_SLOT : api.core.Equipment.CAPE_SLOT;
    if (hasOrEquipped(player, item, slot)) return;
    if (!hasSpace(player)) {
      player.sendMessage(`Murphy needs you to have a spare inventory slot for the diving ${helmet ? "helmet" : "apparatus"}.`);
      event.skip = true;
      return;
    }
    player.getInventory().adds(item, 1);
  }

  function handleWiseMonkey(event) {
    const { player, npcId } = event;
    if (!WISE_MONKEY_BITS.has(npcId)
      || stage(player) < STAGE_OPENING_COMPLETE || hasFlag(player, 128)) return false;
    const option = event.definition?.getActions?.()?.[event.clickType - 1];
    if (option !== "Talk-to") return false;
    event.handled = true;
    player.setAttribute(AWOWOGEI_STATE_ATTRIBUTE,
      awowogeiState(player) | WISE_MONKEY_BITS.get(npcId));
    if (!hasMonkeySpeech(player)) {
      require("../QuestRuntime").startTranscript(api, player, npcId,
        "Recipe for Disaster/Freeing King Awowogei", "ape-atoll-talking-to-the-wise-monkeys-without-an-amulet");
      return true;
    }
    const variant = has(player, ItemIdentifiers.STUFFED_SNAKE)
      ? "finishing-up-talking-to-wise-monkeys-with-cooked-snake"
      : has(player, ItemIdentifiers.RAW_STUFFED_SNAKE)
        ? "ape-atoll-talking-to-the-monkeys-with-a-stuffed-snake"
        : has(player, ItemIdentifiers.SNAKE_CORPSE)
          ? "ape-atoll-talking-to-the-wise-monkeys-with-a-snake"
          : !(awowogeiState(player) & 48) ? "ape-atoll-talking-to-the-monkeys-again-without-bananas-or-nuts"
            : "ape-atoll-talking-to-the-three-wise-monkeys";
    require("../QuestRuntime").startTranscript(api, player, npcId,
      "Recipe for Disaster/Freeing King Awowogei", variant);
    return true;
  }

  const GUIDE_QUIZZES = {
    egg: {
      input: ItemIdentifiers.EGG,
      output: ItemIdentifiers.ENCHANTED_EGG,
      questions: [
        ["A vision shows a ghostly woman in white. Who is she?", "Velorina", ["Gertrude", "Hetty"]],
        ["A vision shows an elf with long blond hair. Who is he?", "Islwyn", ["Unferth", "Reldo"]],
        ["A vision shows a man wearing a crown in East Ardougne. Who is he?", "King Lathas", ["King Roald", "Sir Amik Varze"]],
        ["A vision shows a man in a blue shirt with a book. Who is he?", "Reldo", ["Ali Morrisane", "Unferth"]],
        ["A vision shows a woman in a pink top. Who is she?", "Gertrude", ["Velorina", "Hetty"]],
        ["A vision shows a witch in a pointed hat. Who is she?", "Hetty", ["Gertrude", "Velorina"]],
        ["A vision shows a pirate in a bandana. Who is he?", "Pirate Pete", ["Ali Morrisane", "Islwyn"]],
        ["A vision shows a man in ordinary clothes from a nearby farm. Who is he?", "Unferth", ["Reldo", "King Lathas"]],
        ["A vision shows a desert merchant with a white beard. Who is he?", "Ali Morrisane", ["Reldo", "Unferth"]],
        ["A vision shows a man in a brown vest. Who is he?", "Professor Gronigen", ["King Lathas", "Sir Amik Varze"]],
      ],
    },
    milk: {
      input: ItemIdentifiers.BUCKET_OF_MILK,
      output: ItemIdentifiers.ENCHANTED_MILK,
      questions: [
        ["What is the combat level of the goblins near Lumbridge?", "2", ["1", "5"]],
        ["What defence level is required to wear a Mystic hat?", "20", "10 30".split(" ")],
        ["What ingredients are used in a cake?", "Flour, egg and milk", ["Flour, potatoes and water", "Egg, chocolate and milk"]],
        ["How many coins does the Al Kharid gate guard charge?", "10", ["5", "20"]],
        ["Which castle does not lie between Morytania and Asgarnia?", "Keep Le Faye", ["Lumbridge Castle", "Canafis Castle"]],
        ["A gold ring is to 5 as a holy symbol is to...", "16", ["20", "32"]],
        ["A glass vial is to 33 as a glass orb is to...", "46", ["42", "49"]],
        ["Which guild is closest to the Fishing Platform?", "Legends' Guild", ["Fishing Guild", "Cooks' Guild"]],
        ["What is the bar west of Pollnivneach called?", "Bandit Camp", ["Bedabin Camp", "Nardah"]],
        ["Which direction does the River Salve run?", "North to south", ["South to north", "East to west"]],
        ["Where can you hear howling one way and buzzing the other?", "Catherby", ["Seers' Village", "Ardougne"]],
        ["What do you need to make glass?", "Sand, a bucket, soda ash and a glassblowing pipe", ["Clay, a jug, ashes and a chisel", "Sand, a pot, seaweed and a knife"]],
        ["Which tower is closest to the Crafting Guild?", "Dark Wizards' Tower", ["Wizards' Tower", "Watchtower"]],
      ],
    },
    flour: {
      input: ItemIdentifiers.POT_OF_FLOUR,
      output: ItemIdentifiers.ENCHANTED_FLOUR,
      questions: [
        ["Which item began with the letter 'M'?", "Mind talisman", ["Chaos rune", "Oak shield"], "Coins, Mind talisman, Black shield, Fire rune, Steel platebody, Leather boots, Hammer, Sardine, Water rune, Bronze dagger."],
        ["Which of the following items was NOT shown to you?", "Trout", ["Sardine", "Hammer"], "Air rune, Bronze pickaxe, Black longsword, Gold ring, Mind rune, Leather gloves, Lobster, Tinderbox, Oak shortbow, Bucket."],
        ["How many weapons were you shown?", "Three", ["Two", "Four"], "Maple longbow, Magic shortbow, Black longsword, Fire rune, Chaos rune, Mind talisman, Trout, Cup of tea, Hammer, Gold ring."],
        ["Which items were among those you were shown?", "Guthix prayer book, magic logs and pike", ["A trout, a tinderbox and a bucket", "A dragon scimitar, a shark and a coal"], "Guthix prayer book, Magic logs, Pike, Air rune, Gold ring, Mithril platebody, Lobster, Steel dagger, Jug of water, Tinderbox."],
        ["How many types of runes were there?", "Two", ["One", "Three"], "Mind rune, Fire rune, Bronze axe, Leather gloves, Gold necklace, Swordfish, Steel platelegs, Bucket, Maple shortbow, Hammer."],
      ],
    },
  };

  function shuffled(values) {
    const result = [...values];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function guideHas(player, itemId) { return has(player, itemId); }

  function guideQuizDialogue(player, npcId, kind) {
    const quiz = GUIDE_QUIZZES[kind];
    const { startDialogue } = require("../QuestRuntime");
    const questions = shuffled(quiz.questions).slice(0, 3);
    const ask = (index) => {
      if (index >= questions.length) {
        return [{ exec: () => {
          if (!has(player, quiz.input)) {
            player.sendMessage("Bring the ingredient back and try the enchantment again.");
            return;
          }
          player.getInventory().deleteNumber(quiz.input, 1);
          player.getInventory().adds(quiz.output, 1);
          player.setAttribute(GUIDE_STATE_ATTRIBUTE, (Number(player.getAttribute(GUIDE_STATE_ATTRIBUTE)) || 0) | ({ egg: 1, milk: 2, flour: 4 }[kind]));
          syncGuideQuestVarbits(player);
          if ((Number(player.getAttribute(GUIDE_STATE_ATTRIBUTE)) & 7) === 7) setGuideStage(player, 3);
          player.sendMessage(`Traiborn enchants the ${kind} with your knowledge.`);
        } }];
      }
      const [question, answer, wrong, memoryDisplay] = questions[index];
      const options = shuffled([answer, ...wrong]);
      return [
        ...(memoryDisplay ? [{ npc: [`Memorise these items: ${memoryDisplay}`] }] : []),
        { npc: [question] },
        { options: options.map((option) => ({
          text: option,
          next: option === answer
            ? [{ npc: [index === questions.length - 1 ? "Correct. The enchantment takes hold." : "Correct. One more question." ] }, ...ask(index + 1)]
            : [{ npc: ["That answer is not right. The quiz begins again."] },
              { exec: () => startDialogue(api, player, { npcId }, ask(0)) }],
        })) },
      ];
    };
    startDialogue(api, player, { npcId }, [
      { npc: [`Let's enchant your ${kind}. Answer three questions correctly without a mistake.`] },
      ...ask(0),
    ]);
  }

  function handleTraiborn(event) {
    const { player, npcId } = event;
    if (!TRAIBORN_IDS.has(npcId) || stage(player) < STAGE_OPENING_COMPLETE || hasFlag(player, 8)) return false;
    const option = event.definition?.getActions?.()?.[event.clickType - 1];
    if (option !== "Talk-to") return false;
    event.handled = true;
    const { startTranscript } = require("../QuestRuntime");
    const enchanted = [ItemIdentifiers.ENCHANTED_EGG, ItemIdentifiers.ENCHANTED_MILK, ItemIdentifiers.ENCHANTED_FLOUR];
    if (enchanted.every((id) => has(player, id))) {
      player.sendMessage("Bake the enchanted egg, enchanted milk and enchanted flour together in a cake tin.");
      return true;
    }
    const guideState = Number(player.getAttribute(GUIDE_STATE_ATTRIBUTE)) || 0;
    const lost = [[1, ItemIdentifiers.ENCHANTED_EGG], [2, ItemIdentifiers.ENCHANTED_MILK],
      [4, ItemIdentifiers.ENCHANTED_FLOUR]].some(([bit, id]) => (guideState & bit) !== 0 && !has(player, id));
    if (lost) {
      startTranscript(api, player, npcId, "Recipe for Disaster/Freeing the Lumbridge Guide",
        "finishing-up-talking-to-wizard-traiborn-again");
      return true;
    }
    const available = Object.entries(GUIDE_QUIZZES).find(([, quiz]) => has(player, quiz.input)
      && !has(player, quiz.output));
    if (available) {
      guideQuizDialogue(player, npcId, available[0]);
      return true;
    }
    startTranscript(api, player, npcId, "Recipe for Disaster/Freeing the Lumbridge Guide",
      guideState === 0
        ? "the-quiz-talking-to-wizard-traiborn"
        : "the-quiz-talking-to-wizard-traiborn-again");
    return true;
  }

  function handleGuideConditionGrant(event) {
    const { player, stepId } = event;
    if (stage(player) < STAGE_OPENING_COMPLETE || hasFlag(player, 8)) return;
    const itemId = { IBOxgj: ItemIdentifiers.ENCHANTED_EGG, FJEB5g: ItemIdentifiers.ENCHANTED_FLOUR,
      OjKquk: ItemIdentifiers.ENCHANTED_MILK }[stepId];
    if (itemId === undefined || has(player, itemId)) return;
    if (!hasSpace(player)) {
      player.sendMessage("You need an empty inventory slot for the replacement ingredient.");
      return;
    }
    player.getInventory().adds(itemId, 1);
    event.handled = true;
  }

  function handleGuideCakeItems(event) {
    const { player, usedItemId, usedWithItemId } = event;
    if (stage(player) < STAGE_OPENING_COMPLETE || hasFlag(player, 8)) return;
    const ingredients = [ItemIdentifiers.ENCHANTED_EGG, ItemIdentifiers.ENCHANTED_MILK, ItemIdentifiers.ENCHANTED_FLOUR];
    if (![...ingredients, ItemIdentifiers.CAKE_TIN].includes(usedItemId)
      || ![...ingredients, ItemIdentifiers.CAKE_TIN].includes(usedWithItemId)) return;
    event.handled = true;
    if (!ingredients.every((id) => has(player, id)) || !has(player, ItemIdentifiers.CAKE_TIN)) {
      player.sendMessage("A Cake of Guidance needs an enchanted egg, enchanted milk, enchanted flour and a cake tin.");
      return;
    }
    for (const id of [...ingredients, ItemIdentifiers.CAKE_TIN]) player.getInventory().deleteNumber(id, 1);
    addItem(player, ItemIdentifiers.RAW_GUIDE_CAKE);
    if ((Number(player.getAttribute(GUIDE_STATE_ATTRIBUTE)) & 7) === 7) setGuideStage(player, 3);
    player.sendMessage("You combine the enchanted ingredients in the cake tin to make a raw Cake of Guidance.");
  }

  function handleGuideRange(event) {
    if (event.itemId !== ItemIdentifiers.RAW_GUIDE_CAKE || stage(event.player) < STAGE_OPENING_COMPLETE
      || hasFlag(event.player, 8)) return;
    const { ObjectIdentifiers } = api.core;
    if (![ObjectIdentifiers.COOKING_RANGE, ObjectIdentifiers.RANGE, ObjectIdentifiers.COOKING_RANGE_2,
      ObjectIdentifiers.RANGE_2, ObjectIdentifiers.RANGE_3].includes(event.objectId)) return;
    event.handled = true;
    event.player.getInventory().deleteNumber(ItemIdentifiers.RAW_GUIDE_CAKE, 1);
    addItem(event.player, ItemIdentifiers.CAKE_OF_GUIDANCE);
    setGuideStage(event.player, 4);
    event.player.sendMessage("You bake the Cake of Guidance.");
  }

  function canBeginFinale(player) {
    return stage(player) >= STAGE_OPENING_COMPLETE && flags(player) === ALL_RESCUES
      && (Number(player.getAttribute(QUEST_POINTS_ATTRIBUTE)) || 0) >= 175
      && completedQuest(player, "desert_treasure_i")
      && completedQuest(player, "horror_from_the_deep")
      && !quest.isComplete(player);
  }

  function enterPortal({ player, action, location }) {
    const currentArea = FINAL_AREA_BY_PLAYER.get(player);
    if (currentArea && player.getArea?.() === currentArea) {
      if (action && !["Use", "Enter", "Enter portal", "Walk-through", "Pass-through"].includes(action)) return false;
      leaveFinalRoom(player);
      return true;
    }
    if (!canBeginFinale(player)) {
      if (flags(player) === ALL_RESCUES) {
        player.sendMessage("You need at least 175 quest points, Desert Treasure I and Horror from the Deep before facing the Culinaromancer.");
        return true;
      }
      return false;
    }
    const checkpoint = Number(player.getAttribute(FINAL_FIGHT_ATTRIBUTE));
    if (checkpoint !== -1 && !(checkpoint >= 1 && checkpoint <= FINAL_WAVES.length)) return false;
    if (location && (location.x !== ENTRY_PORTAL_TILE.x || location.y !== ENTRY_PORTAL_TILE.y || location.z !== ENTRY_PORTAL_TILE.z)) return false;
    if (action && !["Use", "Enter", "Enter portal", "Walk-through", "Pass-through"].includes(action)) return false;
    enterFinalRoom(player);
    moveTo(player, FINAL_ROOM.x, FINAL_ROOM.y, FINAL_ROOM.z);
    const wave = checkpoint === -1 ? 1 : checkpoint;
    if (checkpoint === -1) {
      player.setAttribute(FINAL_FIGHT_ATTRIBUTE, 0);
      player.setAttribute(FINAL_BOSS_DEFEATED_ATTRIBUTE, false);
      const { startTranscript } = require("../QuestRuntime");
      startTranscript(api, player, NpcIdentifiers.ARIS, "Recipe for Disaster/Defeating the Culinaromancer", "facing-the-culinaromancer-entering-the-portal-for-the-first-time");
    }
    spawnCulinaromancer(player, wave);
    return true;
  }

  const FINAL_WAVES = [
    NpcIdentifiers.AGRITH_NA_NA, NpcIdentifiers.FLAMBEED, NpcIdentifiers.KARAMEL,
    NpcIdentifiers.DESSOURT, NpcIdentifiers.GELATINNOTH_MOTHER, NpcIdentifiers.CULINAROMANCER_9,
  ];
  // These cache variants are white/air, blue/water, orange/melee, brown/earth,
  // red/fire, and green/ranged. The OSRS Wiki documents an 18-second cycle.
  const MOTHER_COLOURS = [
    { id: 4884, colour: "white", style: "air" },
    { id: 4885, colour: "blue", style: "water" },
    { id: 4886, colour: "orange", style: "melee" },
    { id: 4887, colour: "brown", style: "earth" },
    { id: 4888, colour: "red", style: "fire" },
    { id: 4889, colour: "green", style: "ranged" },
  ];
  const MOTHER_ELEMENTAL_SPELL_KEYS = {
    air: ["WIND_STRIKE", "WIND_BOLT", "WIND_BLAST", "WIND_WAVE", "WIND_SURGE"],
    water: ["WATER_STRIKE", "WATER_BOLT", "WATER_BLAST", "WATER_WAVE", "WATER_SURGE"],
    earth: ["EARTH_STRIKE", "EARTH_BOLT", "EARTH_BLAST", "EARTH_WAVE", "EARTH_SURGE"],
    fire: ["FIRE_STRIKE", "FIRE_BOLT", "FIRE_BLAST", "FIRE_WAVE", "FIRE_SURGE"],
  };
  const MOTHER_ELEMENTAL_SPELLS = Object.fromEntries(Object.entries(MOTHER_ELEMENTAL_SPELL_KEYS).map(([element, keys]) => [
    element, new Set(keys.map((key) => Number(CombatSpells[key]?.spellId?.())).filter(Number.isFinite)),
  ]));
  // The Mother changes to six cache NPC variants as its weakness cycles. Death
  // reports the transformed id, so every variant must advance the same wave.
  const FINAL_NPCS = new Set([...FINAL_WAVES, ...MOTHER_COLOURS.map(({ id }) => id)]);

  function createFinalRoomArea(player) {
    const { Boundary, PrivateArea } = api.core;
    class RecipeForDisasterFinalRoom extends PrivateArea {
      constructor() {
        super([new Boundary(FINAL_ROOM_BOUNDS.minX, FINAL_ROOM_BOUNDS.maxX,
          FINAL_ROOM_BOUNDS.minY, FINAL_ROOM_BOUNDS.maxY, FINAL_ROOM_BOUNDS.z)]);
        this.owner = player;
      }

      process(mobile) {
        if (!mobile?.isPlayer?.() || mobile.getAsPlayer?.() !== this.owner) return;
        const npc = ACTIVE_FINAL_NPC_BY_PLAYER.get(this.owner);
        if (!npc || npc.getArea?.() !== this) return;
        // Keep the core's idle-NPC regeneration timer fresh only for the owner
        // in this encounter. Incoming hits stay on the ordinary combat path.
        npc.getCombat?.()?.getLastAttack?.()?.reset?.();
        const mother = MOTHER_PHASES.get(npc);
        if (mother) {
          mother.ticks++;
          if (mother.ticks >= 30) {
            mother.ticks = 0;
            mother.index = (mother.index + 1) % MOTHER_COLOURS.length;
            const phase = MOTHER_COLOURS[mother.index];
            npc.setNpcTransformationId?.(phase.id);
            this.owner.sendMessage(`The Gelatinnoth Mother turns ${phase.colour}.`);
          }
        }
      }
    }
    return new RecipeForDisasterFinalRoom();
  }

  function enterFinalRoom(player) {
    let area = FINAL_AREA_BY_PLAYER.get(player);
    if (!area || area.isDestroyed?.() === true) {
      area = createFinalRoomArea(player);
      FINAL_AREA_BY_PLAYER.set(player, area);
    }
    const previous = player.getArea?.();
    if (previous && previous !== area) {
      previous.leave?.(player, false);
    }
    if (player.getArea?.() !== area) area.enter(player);
    api.core.PrayerHandler?.deactivatePrayers?.(player);
    return area;
  }

  function disableFinalRoomPrayers(event) {
    const { player } = event;
    const area = FINAL_AREA_BY_PLAYER.get(player);
    if (!area || player.getArea?.() !== area || !(Number(player.getAttribute(FINAL_FIGHT_ATTRIBUTE)) > 0)) return;
    event.disabled = true;
    event.message = "You cannot use Prayer in the Culinaromancer's dimension.";
  }

  function handleFinalRoomDeath({ player }) {
    if (!(Number(player?.getAttribute?.(FINAL_FIGHT_ATTRIBUTE)) > 0)) return;
    const area = FINAL_AREA_BY_PLAYER.get(player);
    const npc = ACTIVE_FINAL_NPC_BY_PLAYER.get(player);
    if (npc && area?.hasMember?.(npc)) area.leave(npc, false);
    if (npc) api.removeNpc?.(npc);
    if (area && area.hasMember?.(player)) area.leave(player, false);
    ACTIVE_FINAL_NPC_BY_PLAYER.delete(player);
    FINAL_AREA_BY_PLAYER.delete(player);
    player.setAttribute(FINAL_FIGHT_ATTRIBUTE, -1);
  }

  function enforceFlambeedIceGloves(event) {
    const { attacker, target, allow } = event;
    if (!attacker?.isPlayer?.() || !target?.isNpc?.() || allow === false
      || target.getId?.() !== NpcIdentifiers.FLAMBEED
      || !FINAL_AREA_BY_PLAYER.has(attacker) || attacker.getArea?.() !== FINAL_AREA_BY_PLAYER.get(attacker)
      || Number(attacker.getAttribute(FINAL_FIGHT_ATTRIBUTE)) !== 2
      || equipmentId(attacker, api.core.Equipment.HANDS_SLOT) === ItemIdentifiers.ICE_GLOVES) return;
    const weapon = equipmentId(attacker, api.core.Equipment.WEAPON_SLOT);
    if (weapon < 0) return;
    event.allow = false;
    if (api.core.EquipPacketListener.unequip(attacker, api.core.Equipment.WEAPON_SLOT)) {
      attacker.sendMessage("Flambeed's heat burns your hand; you need ice gloves to wield a weapon against him.");
    }
  }

  function motherPhaseFor(target) {
    if (!target?.isNpc?.()) return null;
    const state = MOTHER_PHASES.get(target);
    if (!state) return null;
    return MOTHER_COLOURS[state.index];
  }

  function enforceMotherWeakness({ npc, hit }) {
    const attacker = hit?.getAttacker?.();
    const phase = motherPhaseFor(npc);
    if (!phase || !attacker?.isPlayer?.() || Number(attacker.getAttribute(FINAL_FIGHT_ATTRIBUTE)) !== 5
      || !hit || typeof hit.getHits !== "function" || hit.isAccurate?.() !== true) return;
    let matches = false;
    if (phase.style === "melee" || phase.style === "ranged") {
      matches = hit.getCombatType?.() === CombatType?.[phase.style.toUpperCase()];
    } else if (hit.getCombatType?.() === CombatType?.MAGIC) {
      const spellId = Number(hit.getSpell?.()?.spellId?.());
      matches = MOTHER_ELEMENTAL_SPELLS[phase.style]?.has(spellId) === true;
    }
    if (matches) return;
    if (typeof hit.setTotalDamage === "function") hit.setTotalDamage(0);
    else for (const damage of hit.getHits()) damage.setDamage(0);
    const message = `The ${phase.colour} Gelatinnoth Mother can only be hurt by ${phase.style} attacks.`;
    if (attacker.getAttribute("recipe-for-disaster:mother-style-message") !== message) {
      attacker.setAttribute("recipe-for-disaster:mother-style-message", message);
      attacker.sendMessage(message);
    }
  }

  function applyKaramelMagicEffects({ attacker, target, hit }) {
    if (!attacker?.isNpc?.() || attacker.getId?.() !== NpcIdentifiers.KARAMEL
      || !target?.isPlayer?.() || !FINAL_AREA_BY_PLAYER.has(target)
      || Number(target.getAttribute(FINAL_FIGHT_ATTRIBUTE)) !== 3
      || hit?.getCombatType?.() !== CombatType?.MAGIC || hit.isAccurate?.() !== true
      || hit.getTotalDamage?.() <= 0) return;
    // Karamel's successful magic attacks lower combat levels, freeze briefly,
    // and drain both run and special-attack energy. Restores remain useful for
    // the continuing encounter.
    const { CombatFactory } = api.core;
    const skills = [Skill.ATTACK, Skill.STRENGTH, Skill.DEFENCE, Skill.RANGED, Skill.MAGIC];
    const amount = 1 + Math.floor(Math.random() * 3);
    const manager = target.getSkillManager();
    for (const skill of skills) {
      manager.setCurrentLevelCombat(skill, Math.max(0, manager.getCurrentLevel(skill) - amount));
    }
    target.setRunEnergy?.(0);
    target.setSpecialPercentage?.(0);
    target.getPacketSender?.().sendSpecialAttackState?.(false);
    CombatFactory.stunTicks(target, 2, false);
  }

  function leaveFinalRoom(player) {
    const area = FINAL_AREA_BY_PLAYER.get(player);
    const npc = ACTIVE_FINAL_NPC_BY_PLAYER.get(player);
    if (npc && area?.hasMember?.(npc)) area.leave(npc, false);
    if (npc) api.removeNpc?.(npc);
    ACTIVE_FINAL_NPC_BY_PLAYER.delete(player);
    if (area && area.hasMember?.(player)) area.leave(player, false);
    FINAL_AREA_BY_PLAYER.delete(player);
    moveTo(player, ENTRY_PORTAL_TILE.x, ENTRY_PORTAL_TILE.y, ENTRY_PORTAL_TILE.z);
  }

  function spawnCulinaromancer(player, wave) {
    const id = FINAL_WAVES[wave - 1];
    if (!id) return;
    const area = enterFinalRoom(player);
    const previous = ACTIVE_FINAL_NPC_BY_PLAYER.get(player);
    if (previous) {
      if (area.hasMember?.(previous)) area.leave(previous, false);
      if (previous.isRegistered?.() !== false) api.removeNpc?.(previous);
    }
    const npc = api.spawnNpc({ id, ...FINAL_ROOM, wanderRadius: 0, owner: player, ownerOnly: true });
    if (npc && typeof npc === "object") {
      area.enter(npc);
      FINALE_NPCS.set(npc, { player, wave });
      if (wave === 5) {
        npc.setNpcTransformationId?.(MOTHER_COLOURS[0].id);
        MOTHER_PHASES.set(npc, { index: 0, ticks: 0 });
      }
      ACTIVE_FINAL_NPC_BY_PLAYER.set(player, npc);
    }
    player.setAttribute(FINAL_FIGHT_ATTRIBUTE, wave);
    player.sendMessage(`The Culinaromancer summons dessert minion ${wave} of ${FINAL_WAVES.length}.`);
  }

  function handleNpcDeath(event) {
    const player = event?.killer?.isPlayer?.() ? event.killer : null;
    const encounter = event?.npc && FINALE_NPCS.get(event.npc);
    if (!player || !encounter || encounter.player !== player || !FINAL_NPCS.has(event.npcId) || !canBeginFinale(player)) return;
    const wave = Number(player.getAttribute(FINAL_FIGHT_ATTRIBUTE)) || 0;
    if (encounter.wave !== wave) return;
    if (wave === FINAL_WAVES.length && event.npcId !== FINAL_WAVES[wave - 1]) return;
    ACTIVE_FINAL_NPC_BY_PLAYER.delete(player);
    if (wave < 1) return;
    if (wave < FINAL_WAVES.length) {
      const next = wave + 1;
      const { startTranscript } = require("../QuestRuntime");
      const variants = ["", "facing-the-culinaromancer-fighting-flambeed", "facing-the-culinaromancer-fighting-karamel", "facing-the-culinaromancer-fighting-dessourt", "facing-the-culinaromancer-fighting-the-gelatinnoth-mother", "facing-the-culinaromancer-fighting-the-culinaromancer"];
      startTranscript(api, player, NpcIdentifiers.CULINAROMANCER, "Recipe for Disaster/Defeating the Culinaromancer", variants[next]);
      spawnCulinaromancer(player, next);
      return;
    }
    player.setAttribute(FINAL_FIGHT_ATTRIBUTE, 0);
    player.setAttribute(FINAL_BOSS_DEFEATED_ATTRIBUTE, true);
    const { startTranscript } = require("../QuestRuntime");
    startTranscript(api, player, NpcIdentifiers.ARIS, "Recipe for Disaster/Defeating the Culinaromancer", "facing-the-culinaromancer-fighting-the-culinaromancer");
  }

  function handleFruitBlast(event) {
    const { player, usedItemId, usedWithItemId } = event;
    if (stage(player) !== STAGE_STARTED) return;
    if ([usedItemId, usedWithItemId].includes(ItemIdentifiers.FRUIT_BLAST)
      && [usedItemId, usedWithItemId].includes(ItemIdentifiers.ASHES)) {
      event.handled = true;
      const { startTranscript } = require("../QuestRuntime");
      startTranscript(api, player, NpcIdentifiers.COOK, PAGE, "d-j-vu-using-ashes-on-a-fruit-blast");
      return;
    }
    const fruitCuts = new Map([
      [ItemIdentifiers.PINEAPPLE, ItemIdentifiers.PINEAPPLE_CHUNKS],
      [ItemIdentifiers.LEMON, ItemIdentifiers.LEMON_SLICES],
      [ItemIdentifiers.ORANGE, ItemIdentifiers.ORANGE_SLICES],
    ]);
    const fruit = usedItemId === ItemIdentifiers.KNIFE ? usedWithItemId
      : usedWithItemId === ItemIdentifiers.KNIFE ? usedItemId : null;
    if (fruitCuts.has(fruit)) {
      event.handled = true;
      if (!hasSpace(player)) {
        player.sendMessage("You need an empty inventory slot to cut that fruit.");
        return;
      }
      player.getInventory().deleteNumber(fruit, 1);
      player.getInventory().adds(fruitCuts.get(fruit), 1);
      return;
    }
    const shaker = ItemIdentifiers.COCKTAIL_SHAKER;
    if (![usedItemId, usedWithItemId].includes(shaker)) return;
    const ingredients = [ItemIdentifiers.PINEAPPLE_CHUNKS, ItemIdentifiers.LEMON_SLICES, ItemIdentifiers.ORANGE_SLICES];
    if (!ingredients.every((id) => has(player, id)) || !hasSpace(player)) {
      player.sendMessage("You need a cocktail shaker, pineapple, lemon and orange slices to make a fruit blast.");
      return;
    }
    event.handled = true;
    for (const id of ingredients) player.getInventory().deleteNumber(id, 1);
    player.getInventory().adds(ItemIdentifiers.FRUIT_BLAST, 1);
    player.sendMessage("You shake the ingredients together to make a fruit blast.");
  }

  function selectGoblinCookVariant(player) {
    if (goblinState(player) & 2) {
      if (goblinState(player) & GOBLIN_SLOP_RECEIVED) {
        return "finishing-up-talking-to-the-burnt-goblin-cook-after-receiving-the-slop-of-compromise";
      }
      if (goblinQuestStage(player) < 30) return "discovering-the-recipe-talking-to-the-burnt-goblin-cook";
      const ingredients = [ItemIdentifiers.DYED_ORANGE, ItemIdentifiers.SOGGY_BREAD, ItemIdentifiers.SPICY_MAGGOTS];
      return ingredients.every((id) => has(player, id))
        ? "finishing-up-talking-to-the-burnt-goblin-cook-with-all-three-ingredients-in-inventory"
        : "discovering-the-recipe-talking-to-the-burnt-goblin-cook-again";
    }
    return has(player, ItemIdentifiers.CHARCOAL)
      ? "asking-around-goblin-village-talking-to-the-goblin-cook-again-with-charcoal-in-inventory"
      : "asking-around-goblin-village-talking-to-the-goblin-cook";
  }

  function handleGoblinCook(event) {
    const { player, npcId } = event;
    if (!GOBLIN_COOK_IDS.has(npcId) || stage(player) < STAGE_OPENING_COMPLETE || hasFlag(player, 2)) return false;
    const option = event.definition?.getActions?.()?.[event.clickType - 1];
    if (option !== "Talk-to") return false;
    event.handled = true;
    require("../QuestRuntime").startTranscript(api, player, npcId, GOBLIN_PAGE, selectGoblinCookVariant(player));
    return true;
  }

  // The Goblin Village entrance and its cellar are two unrelated map squares in
  // the cache (the basement ladder is not the 6,400-tile underground offset from
  // the surface one). Keep the real ladder clicks and route checks, but link the
  // mapped ends explicitly so players can walk through the village and climb.
  function handleGoblinLadder(event) {
    if (stage(event.player) < STAGE_OPENING_COMPLETE) return false;
    const action = event.definition?.getActions?.()?.[event.clickType - 1];
    const { Location } = api.core;
    if (event.objectId === 12389 && action === "Climb-down"
      && event.location?.x === 2960 && event.location?.y === 3507) {
      api.emitCustomEvent("ladders:climbDown", {
        player: event.player,
        destination: new Location(2980, 9871, 0),
      });
      event.handled = true;
      return true;
    }
    if (event.objectId === 12391 && action === "Climb-up"
      && event.location?.x === 2981 && event.location?.y === 9876) {
      api.emitCustomEvent("ladders:climbUp", {
        player: event.player,
        destination: new Location(2960, 3506, 0),
      });
      event.handled = true;
      return true;
    }
    return false;
  }

  function handleGoblinIngredients(event) {
    const { player } = event;
    if (stage(player) < STAGE_OPENING_COMPLETE || hasFlag(player, 2)) return;
    const { ObjectIdentifiers } = api.core;
    const orangeDyes = [ItemIdentifiers.BLUE_DYE, ItemIdentifiers.BLACK_DYE,
      ItemIdentifiers.GREEN_DYE, ItemIdentifiers.PURPLE_DYE];
    const orange = event.usedItemId === ItemIdentifiers.ORANGE_SLICES ? ItemIdentifiers.ORANGE_SLICES
      : event.usedWithItemId === ItemIdentifiers.ORANGE_SLICES ? ItemIdentifiers.ORANGE_SLICES : null;
    const dye = [event.usedItemId, event.usedWithItemId].find((id) => orangeDyes.includes(id));
    if (orange && dye) {
      event.handled = true;
      player.getInventory().deleteNumber(ItemIdentifiers.ORANGE_SLICES, 1);
      player.getInventory().deleteNumber(dye, 1);
      addItem(player, ItemIdentifiers.DYED_ORANGE);
      return;
    }
    const spice = [ItemIdentifiers.SPICE, ItemIdentifiers.GNOME_SPICE];
    const bait = [event.usedItemId, event.usedWithItemId].includes(ItemIdentifiers.FISHING_BAIT);
    const baitSpice = [event.usedItemId, event.usedWithItemId].find((id) => spice.includes(id));
    if (bait && baitSpice) {
      event.handled = true;
      player.getInventory().deleteNumber(ItemIdentifiers.FISHING_BAIT, 1);
      player.getInventory().deleteNumber(baitSpice, 1);
      addItem(player, ItemIdentifiers.SPICY_MAGGOTS);
      return;
    }
    if (isItemPair(event, ItemIdentifiers.KNIFE, ItemIdentifiers.ORANGE)) {
      event.handled = true;
      if (!hasSpace(player)) {
        player.sendMessage("You need an empty inventory slot to slice the orange.");
        return;
      }
      player.getInventory().deleteNumber(ItemIdentifiers.ORANGE, 1);
      addItem(player, ItemIdentifiers.ORANGE_SLICES);
      return;
    }
    if (isItemPair(event, ItemIdentifiers.BREAD, ItemIdentifiers.BUCKET_OF_WATER)) {
      event.handled = true;
      player.getInventory().deleteNumber(ItemIdentifiers.BREAD, 1);
      player.getInventory().deleteNumber(ItemIdentifiers.BUCKET_OF_WATER, 1);
      addItem(player, ItemIdentifiers.SOGGY_BREAD);
      addItem(player, ItemIdentifiers.BUCKET);
      return;
    }
    if ([event.usedItemId, event.usedWithItemId, event.itemId].includes(ItemIdentifiers.CHARCOAL)
      && [ObjectIdentifiers.CAULDRON, ObjectIdentifiers.CAULDRON_2].includes(event.objectId)) {
      event.handled = true;
      player.getInventory().deleteNumber(ItemIdentifiers.CHARCOAL, 1);
      player.setAttribute(GOBLIN_STATE_ATTRIBUTE, goblinState(player) | 2);
      setGoblinStage(player, 15);
    }
  }

  function dwarfNpcVariant(player, npcId) {
    if (OLD_DWARF_IDS.has(npcId) && dwarfState(player) === 0 && !has(player, ItemIdentifiers.ASGOLDIAN_ALE)) {
      return "below-white-wolf-mountain-talking-to-an-old-dwarf";
    }
    if ([NpcIdentifiers.EMILY, NpcIdentifiers.KAYLEE, NpcIdentifiers.TINA, NpcIdentifiers.TINA_2].includes(npcId)) {
      const names = new Map([[NpcIdentifiers.EMILY, "emily"], [NpcIdentifiers.KAYLEE, "kaylee"],
        [NpcIdentifiers.TINA, "tina"], [NpcIdentifiers.TINA_2, "tina"]]);
      const name = names.get(npcId);
      return `the-golden-nectar-talking-to-${name}${dwarfState(player) & 16 ? "-again" : ""}`;
    }
    const ales = dwarfState(player) & 7;
    if (dwarfState(player) & 0x800) return "getting-the-recipe-talking-to-rohak-after-he-has-made-the-rock-cake";
    if (dwarfState(player) & 0x400) return "getting-the-recipe-talking-to-rohak-again";
    if (dwarfState(player) & 0x200) return "getting-the-recipe-talking-to-a-sober-rohak";
    if (ales >= 4) return "getting-the-recipe-talking-to-rohak-again-once-he-is-sufficiently-drunk";
    if (has(player, ItemIdentifiers.ASGOLDIAN_ALE)) {
      if (ales === 0) return "getting-the-recipe-talking-to-rohak-with-asgoldian-ale-in-inventory";
      if (ales === 1) return "getting-the-recipe-talking-to-rohak-with-a-second-asgoldian-ale-in-inventory";
      if (ales === 2) return "getting-the-recipe-talking-to-rohak-with-a-third-asgoldian-ale-in-inventory";
      if (ales === 3) return "getting-the-recipe-talking-to-rohak-with-a-fourth-asgoldian-ale-in-inventory";
    }
    return "below-white-wolf-mountain-talking-to-rohak-again";
  }

  function fillDwarfBartenderJump(steps, npcId, variant, speaker) {
    const sourceVariant = variant.endsWith("-again")
      ? "the-golden-nectar-talking-to-emily-again" : "the-golden-nectar-talking-to-emily";
    const source = loadTranscripts(api)?.[DWARF_PAGE]?.variants?.[sourceVariant];
    const sourceOption = source?.find((step) => step.type === "choice")?.options
      ?.find((option) => option.text === "What can you tell me about dwarves and ale?");
    if (!sourceOption?.steps) return steps;
    const replaceSpeaker = (value) => {
      if (Array.isArray(value)) return value.map(replaceSpeaker);
      if (!value || typeof value !== "object") return value;
      return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
        key,
        key === "speaker" && nested === "Emily" ? speaker : replaceSpeaker(nested),
      ]));
    };
    const fill = (list) => (list ?? []).map((step) => {
      if (!step || typeof step !== "object") return step;
      if (step.type === "choice") {
        return { ...step, options: (step.options ?? []).map((option) =>
          option.text === "What can you tell me about dwarves and ale?"
            && (option.steps ?? []).some((entry) => entry?.type === "jump")
            ? { ...option, steps: replaceSpeaker(sourceOption.steps) }
            : { ...option, steps: fill(option.steps) }) };
      }
      return { ...step, ...(Array.isArray(step.steps) ? { steps: fill(step.steps) } : {}) };
    });
    return fill(steps);
  }

  function handleDwarfNpc(event) {
    const { player, npcId } = event;
    if (!DWARF_NPCS.has(npcId) || stage(player) < STAGE_OPENING_COMPLETE || hasFlag(player, 1)) return false;
    const option = event.definition?.getActions?.()?.[event.clickType - 1];
    if (option !== "Talk-to") return false;
    event.handled = true;
    const { startTranscript } = require("../QuestRuntime");
    const variant = dwarfNpcVariant(player, npcId);
    const speaker = event.definition?.getName?.() ?? api.core.NpcDefinition.forId(npcId)?.getName?.();
    const select = [NpcIdentifiers.KAYLEE, NpcIdentifiers.KAYLEE_2,
      NpcIdentifiers.TINA, NpcIdentifiers.TINA_2].includes(npcId)
      ? (steps) => fillDwarfBartenderJump(steps, npcId, variant, speaker) : undefined;
    startTranscript(api, player, npcId, DWARF_PAGE, variant, select);
    if ([...OLD_DWARF_IDS, NpcIdentifiers.ROHAK, NpcIdentifiers.ROHAK_2].includes(npcId)) {
      const count = dwarfState(player) & 7;
      if (count === 0 && variant.includes("asgoldian-ale-in-inventory")) {
        player.getInventory().deleteNumber(ItemIdentifiers.ASGOLDIAN_ALE, 1);
        player.setAttribute(DWARF_STATE_ATTRIBUTE, (dwarfState(player) & ~7) | 1);
      } else if (count > 0 && count < 4 && variant.includes("second-asgoldian-ale")) {
        player.getInventory().deleteNumber(ItemIdentifiers.ASGOLDIAN_ALE, 1);
        player.setAttribute(DWARF_STATE_ATTRIBUTE, (dwarfState(player) & ~7) | (count + 1));
      } else if (count > 0 && count < 4 && (variant.includes("third-asgoldian-ale") || variant.includes("fourth-asgoldian-ale"))) {
        player.getInventory().deleteNumber(ItemIdentifiers.ASGOLDIAN_ALE, 1);
        player.setAttribute(DWARF_STATE_ATTRIBUTE, (dwarfState(player) & ~7) | (count + 1));
      }
    }
    syncDwarfQuestVarbits(player);
    return true;
  }

  function handleDwarfItems(event) {
    const { player } = event;
    if (stage(player) < STAGE_OPENING_COMPLETE || hasFlag(player, 1)) return;
    if (isItemPair(event, ItemIdentifiers.COINS, ItemIdentifiers.ASGARNIAN_ALE)) {
      event.handled = true;
      player.getInventory().deleteNumber(ItemIdentifiers.COINS, 1);
      player.getInventory().deleteNumber(ItemIdentifiers.ASGARNIAN_ALE, 1);
      addItem(player, ItemIdentifiers.ASGOLDIAN_ALE);
      return;
    }
  }

  function handleDwarfBarChoice(event) {
    if (![NpcIdentifiers.EMILY, NpcIdentifiers.KAYLEE, NpcIdentifiers.TINA, NpcIdentifiers.TINA_2].includes(event.npcId)
      || event.option !== "What ales are you serving?") return;
    event.handled = true;
    api.core.ShopManager.open(event.player, 1301, true);
  }

  function handleSkrachItems(event) {
    const { player, usedItemId, usedWithItemId } = event;
    if (stage(player) < STAGE_OPENING_COMPLETE || hasFlag(player, 32)
      || !(Number(player.getAttribute(SKRACH_STATE_ATTRIBUTE)) & 1)) return;
    const bellows = [ItemIdentifiers.OGRE_BELLOWS, ItemIdentifiers.OGRE_BELLOWS_3_,
      ItemIdentifiers.OGRE_BELLOWS_2_, ItemIdentifiers.OGRE_BELLOWS_1_];
    const charged = [ItemIdentifiers.OGRE_BELLOWS_3_, ItemIdentifiers.OGRE_BELLOWS_2_, ItemIdentifiers.OGRE_BELLOWS_1_];
    if (bellows.includes(usedItemId) && usedWithItemId === ItemIdentifiers.BLOATED_TOAD
      || bellows.includes(usedWithItemId) && usedItemId === ItemIdentifiers.BLOATED_TOAD) {
      event.handled = true;
      const filled = bellows.includes(usedItemId) ? usedItemId : usedWithItemId;
      if (!charged.includes(filled)) {
        player.sendMessage("The ogre bellows need to be filled with swamp bubbles first.");
        return;
      }
      if (!has(player, ItemIdentifiers.ROCK) || !has(player, ItemIdentifiers.BALL_OF_WOOL)) {
        player.sendMessage("A rock and a ball of wool will hold the balloon toad together.");
        return;
      }
      player.getInventory().deleteNumber(filled, 1);
      player.getInventory().deleteNumber(ItemIdentifiers.BLOATED_TOAD, 1);
      player.getInventory().deleteNumber(ItemIdentifiers.ROCK, 1);
      player.getInventory().deleteNumber(ItemIdentifiers.BALL_OF_WOOL, 1);
      player.getInventory().adds(ItemIdentifiers.BALLOON_TOAD, 1);
      setSkrachStage(player, 140);
      return;
    }
    if (isItemPair(event, ItemIdentifiers.RAW_CHOMPY, ItemIdentifiers.IRON_SPIT)) {
      event.handled = true;
      if (!hasSpace(player)) return;
      player.getInventory().deleteNumber(ItemIdentifiers.RAW_CHOMPY, 1);
      player.getInventory().adds(ItemIdentifiers.SKEWERED_CHOMPY, 1);
      return;
    }
  }

  function handleSkrachObjectInteraction(event) {
    const { player, objectId } = event;
    if (stage(player) < STAGE_OPENING_COMPLETE || hasFlag(player, 32)
      || !(Number(player.getAttribute(SKRACH_STATE_ATTRIBUTE)) & 1)) return;
    const { ObjectIdentifiers } = api.core;
    const rocks = [ObjectIdentifiers.PILE_OF_ROCKS, ObjectIdentifiers.PILE_OF_ROCK,
      ObjectIdentifiers.PILE_OF_ROCK_5, ObjectIdentifiers.PILE_OF_ROCK_6,
      ObjectIdentifiers.PILE_OF_ROCK_7, ObjectIdentifiers.PILE_OF_ROCK_8];
    const option = event.definition?.getActions?.()?.[event.clickType - 1];
    if (rocks.includes(objectId) && ["Mine", "Take", "Search"].includes(option)) {
      event.handled = true;
      if (!hasSpace(player)) return player.sendMessage("You need an empty inventory slot to carry a rock.");
      player.getInventory().adds(ItemIdentifiers.ROCK, 1);
      setSkrachStage(player, 130);
      return;
    }
    if ([ObjectIdentifiers.CRUDE_BOAT, ObjectIdentifiers.ROW_BOAT, ObjectIdentifiers.ROW_BOAT_2].includes(objectId)
      && ["Board", "Travel", "Cross"].includes(option)) {
      event.handled = true;
      if (!(skrachState(player) & 4) || !has(player, ItemIdentifiers.COOKED_CHOMPY)) {
        player.sendMessage("Rantz needs a cooked chompy before his boat will take you to the Feldip Hills.");
        return;
      }
      player.getInventory().deleteNumber(ItemIdentifiers.COOKED_CHOMPY, 1);
      moveTo(player, 2630, 2981, 0);
      setSkrachBit(player, 8);
      setSkrachStage(player, 90);
      require("../QuestRuntime").startTranscript(api, player, NpcIdentifiers.RANTZ,
        "Recipe for Disaster/Freeing Skrach Uglogwee", "ranting-with-rantz-talking-to-rantz-after-arriving-on-the-ogre-boat");
      return;
    }
  }

  function handleSkrachItemOnObject(event) {
    const { player, objectId, itemId } = event;
    if (stage(player) < STAGE_OPENING_COMPLETE || hasFlag(player, 32)
      || !(Number(player.getAttribute(SKRACH_STATE_ATTRIBUTE)) & 1)) return;
    const { ObjectIdentifiers } = api.core;
    const axes = [ItemIdentifiers.BRONZE_AXE, ItemIdentifiers.IRON_AXE, ItemIdentifiers.STEEL_AXE,
      ItemIdentifiers.BLACK_AXE, ItemIdentifiers.MITHRIL_AXE, ItemIdentifiers.ADAMANT_AXE,
      ItemIdentifiers.RUNE_AXE, ItemIdentifiers.DRAGON_AXE];
    const treeLocation = event.object?.getLocation?.();
    const RANTZ_TREE = objectId === 10819 && treeLocation?.getX?.() === 2652 && treeLocation?.getY?.() === 2960;
    if ((RANTZ_TREE || [ObjectIdentifiers.FALLEN_TREE, ObjectIdentifiers.FALLEN_TREE_2,
      ObjectIdentifiers.FALLEN_TREE_3, ObjectIdentifiers.FALLEN_TREE_4].includes(objectId))
      && axes.includes(itemId) && locationNearFeldip(player)) {
      event.handled = true;
      const state = skrachState(player);
      if (!(state & 2)) {
        setSkrachBit(player, 2);
        setSkrachStage(player, 50);
        require("../QuestRuntime").startTranscript(api, player, NpcIdentifiers.RANTZ,
          "Recipe for Disaster/Freeing Skrach Uglogwee", "ranting-with-rantz-trimming-the-log-s-roots");
      } else if (!(state & 4)) {
        setSkrachBit(player, 4);
        setSkrachStage(player, 60);
        require("../QuestRuntime").startTranscript(api, player, NpcIdentifiers.RANTZ,
          "Recipe for Disaster/Freeing Skrach Uglogwee", "ranting-with-rantz-hollowing-out-the-boat");
      }
      return;
    }
    const swamp = [ObjectIdentifiers.SWAMP_BUBBLES, ObjectIdentifiers.SWAMP_BUBBLES_2,
      ObjectIdentifiers.SWAMP_BUBBLES_3, ObjectIdentifiers.SWAMP_BUBBLES_4];
    if (swamp.includes(objectId) && [ItemIdentifiers.OGRE_BELLOWS, ItemIdentifiers.OGRE_BELLOWS_1_,
      ItemIdentifiers.OGRE_BELLOWS_2_, ItemIdentifiers.OGRE_BELLOWS_3_].includes(itemId)) {
      event.handled = true;
      const contents = player.getInventory();
      const empty = [ItemIdentifiers.OGRE_BELLOWS];
      const current = [ItemIdentifiers.OGRE_BELLOWS, ItemIdentifiers.OGRE_BELLOWS_1_,
        ItemIdentifiers.OGRE_BELLOWS_2_, ItemIdentifiers.OGRE_BELLOWS_3_].find((id) => contents.getAmount(id) > 0);
      if (current && empty.includes(current)) {
        contents.deleteNumber(current, 1);
        contents.adds(ItemIdentifiers.OGRE_BELLOWS_3_, 1);
        setSkrachStage(player, 110);
      } else player.sendMessage("Your ogre bellows are already full of swamp bubbles.");
      return;
    }
    const spitRoasts = [ObjectIdentifiers.OGRE_SPIT_ROAST, ObjectIdentifiers.OGRE_SPIT_ROAST_2,
      ObjectIdentifiers.OGRE_SPIT_ROAST_3, ObjectIdentifiers.OGRE_SPIT_ROAST_4,
      ObjectIdentifiers.OGRE_SPIT_ROAST_5, ObjectIdentifiers.OGRE_SPIT_ROAST_6,
      ObjectIdentifiers.OGRE_SPIT_ROAST_7, ObjectIdentifiers.OGRE_SPIT_ROAST_8,
      ObjectIdentifiers.OGRE_SPIT_ROAST_9];
    if (spitRoasts.includes(objectId) && itemId === ItemIdentifiers.SKEWERED_CHOMPY) {
      event.handled = true;
      player.getInventory().deleteNumber(ItemIdentifiers.SKEWERED_CHOMPY, 1);
      player.getInventory().adds(Math.random() < Math.max(0, (41 - level(player, Skill.COOKING)) * 0.02)
        ? ItemIdentifiers.BURNT_CHOMPY : ItemIdentifiers.COOKED_CHOMPY, 1);
      return;
    }
    if (spitRoasts.includes(objectId) && itemId === ItemIdentifiers.RAW_JUBBLY) {
      event.handled = true;
      player.getInventory().deleteNumber(ItemIdentifiers.RAW_JUBBLY, 1);
      const result = Math.random() < Math.max(0, (41 - level(player, Skill.COOKING)) * 0.02)
        ? ItemIdentifiers.BURNT_JUBBLY : ItemIdentifiers.COOKED_JUBBLY;
      player.getInventory().adds(result, 1);
      setSkrachStage(player, result === ItemIdentifiers.COOKED_JUBBLY ? 160 : 150);
      return;
    }
    if ([ObjectIdentifiers.FIRE, ObjectIdentifiers.FIRE_2, ObjectIdentifiers.FIRE_3,
      ObjectIdentifiers.FIRE_4, ObjectIdentifiers.FIRE_5, ObjectIdentifiers.FIRE_6,
      ObjectIdentifiers.FIRE_7].includes(objectId) && itemId === ItemIdentifiers.SKEWERED_CHOMPY) {
      event.handled = true;
      player.getInventory().deleteNumber(ItemIdentifiers.SKEWERED_CHOMPY, 1);
      const cooked = Math.random() < Math.max(0, (41 - level(player, Skill.COOKING)) * 0.02)
        ? ItemIdentifiers.BURNT_CHOMPY : ItemIdentifiers.COOKED_CHOMPY;
      player.getInventory().adds(cooked, 1);
      if (cooked === ItemIdentifiers.COOKED_CHOMPY && player.getLocation().getX() >= 2700
        && player.getLocation().getY() < 3300) {
        setSkrachBit(player, 16);
        setSkrachStage(player, 80);
        require("../QuestRuntime").startTranscript(api, player, NpcIdentifiers.OGRE_BOAT,
          "Recipe for Disaster/Freeing Skrach Uglogwee", "ranting-with-rantz-after-cooking-the-chompy-on-the-beach");
      }
    }
  }

  function locationNearFeldip(player) {
    const location = player.getLocation();
    return location.getX() >= 2510 && location.getX() <= 2670
      && location.getY() >= 2890 && location.getY() <= 3050;
  }

  function handleSkrachToad(event) {
    const { player, npcId, itemId } = event;
    const bellows = [ItemIdentifiers.OGRE_BELLOWS, ItemIdentifiers.OGRE_BELLOWS_3_,
      ItemIdentifiers.OGRE_BELLOWS_2_, ItemIdentifiers.OGRE_BELLOWS_1_];
    if (npcId !== NpcIdentifiers.SWAMP_TOAD || !bellows.includes(itemId)
      || stage(player) < STAGE_OPENING_COMPLETE || hasFlag(player, 32)
      || !(Number(player.getAttribute(SKRACH_STATE_ATTRIBUTE)) & 1)) return;
    event.handled = true;
    const charged = [ItemIdentifiers.OGRE_BELLOWS_3_, ItemIdentifiers.OGRE_BELLOWS_2_, ItemIdentifiers.OGRE_BELLOWS_1_];
    if (!charged.includes(itemId)) return player.sendMessage("Fill the ogre bellows with swamp bubbles first.");
    if (!hasSpace(player)) return player.sendMessage("You need an empty inventory slot for the bloated toad.");
    const next = itemId === ItemIdentifiers.OGRE_BELLOWS_3_ ? ItemIdentifiers.OGRE_BELLOWS_2_
      : itemId === ItemIdentifiers.OGRE_BELLOWS_2_ ? ItemIdentifiers.OGRE_BELLOWS_1_ : ItemIdentifiers.OGRE_BELLOWS;
    player.getInventory().deleteNumber(itemId, 1);
    player.getInventory().adds(next, 1);
    player.getInventory().adds(ItemIdentifiers.BLOATED_TOAD, 1);
    setSkrachStage(player, 120);
  }

  function handleSkrachDrop(event) {
    if (event.itemId !== ItemIdentifiers.BALLOON_TOAD) return;
    event.handled = true;
    if (stage(event.player) < STAGE_OPENING_COMPLETE) {
      event.player.sendMessage("You should speak to Rantz before hunting a jubbly.");
      return;
    }
    if (hasFlag(event.player, 32)) {
      event.player.sendMessage("Skrach has already been rescued.");
      return;
    }
    if (!(skrachState(event.player) & 1)) {
      event.player.sendMessage("Talk to Rantz about the balloon toad before setting it out.");
      return;
    }
    const location = event.player.getLocation();
    if (location.getX() < 2510 || location.getX() > 2670 || location.getY() < 2890 || location.getY() > 3050) {
      event.player.sendMessage("Rantz said to place the balloon toad near his cave or the Feldip Hills chompy grounds.");
      return;
    }
    event.player.getInventory().deleteNumber(ItemIdentifiers.BALLOON_TOAD, 1);
    setSkrachStage(event.player, 150);
    const npc = api.spawnNpc({ id: NpcIdentifiers.JUBBLY_BIRD, x: location.getX() + 1,
      y: location.getY(), z: location.getZ(), wanderRadius: 0, owner: event.player, ownerOnly: true });
    if (npc && typeof npc === "object") JUBBLY_BY_PLAYER.set(event.player, npc);
    event.player.sendMessage("You place the balloon toad on the ground. A Jubbly bird swoops down!");
  }

  function handleRantzTalk(event) {
    const { player, npcId } = event;
    // Big Chompy owns Rantz until its prerequisite is complete; otherwise its
    // mandatory named-Rantz dialogue would never be reachable behind this hook.
    if (!RANTZ_IDS.has(npcId) || stage(player) < STAGE_OPENING_COMPLETE
      || hasFlag(player, 32) || !completedQuest(player, "big_chompy_bird_hunting")) return false;
    // One Small Favour owns Rantz during its mandatory Rantz stages even if the
    // Skrach rescue has been accepted; the Skrach dialogue is resumable later.
    if (oneSmallFavourAtRantz(player)) return false;
    const option = event.definition?.getActions?.()?.[event.clickType - 1];
    if (option !== "Talk-to") return false;
    event.handled = true;
    const state = skrachState(player);
    let variant = "ranting-with-rantz-talking-to-rantz";
    if (state & 8) variant = "ranting-with-rantz-talking-to-rantz-after-arriving-on-the-ogre-boat";
    else if (state & 4) variant = "ranting-with-rantz-talking-to-rantz-after-hollowing-out-the-boat";
    else if (state & 2) variant = "ranting-with-rantz-talking-to-rantz-after-trimming-the-log-s-roots";
    else if (state & 1) {
      const location = player.getLocation();
      const atLargeTree = location.getX() >= 2640 && location.getX() <= 2660
        && location.getY() >= 2950 && location.getY() <= 2975;
      variant = atLargeTree ? "ranting-with-rantz-talking-to-rantz-near-the-large-tree"
        : "ranting-with-rantz-talking-to-rantz-near-his-cave-after-agreeing-to-help-him";
    }
    require("../QuestRuntime").startTranscript(api, player, npcId,
      "Recipe for Disaster/Freeing Skrach Uglogwee", variant);
    return true;
  }

  function handleOgreBoatTalk(event) {
    const { player, npcId } = event;
    if (!OGRE_BOAT_IDS.has(npcId) || stage(player) < STAGE_OPENING_COMPLETE
      || hasFlag(player, 32) || !(skrachState(player) & 1)) return false;
    const option = event.definition?.getActions?.()?.[event.clickType - 1];
    if (option !== "Board") return false;
    ensureOgreBoatTalkActions();
    event.handled = true;
    const atKaramja = npcId === 6261 || npcId === 4858
      || (player.getLocation().getX() > 2700 && player.getLocation().getY() < 3300);
    if (atKaramja && (skrachState(player) & 16)) {
      require("../QuestRuntime").startTranscript(api, player, NpcIdentifiers.OGRE_BOAT,
        "Recipe for Disaster/Freeing Skrach Uglogwee", "ranting-with-rantz-boarding-the-ogre-boat");
      return true;
    }
    const transcriptNpcId = atKaramja ? NpcIdentifiers.OGRE_BOAT : NpcIdentifiers.OGRE_BOAT_2;
    require("../QuestRuntime").startTranscript(api, player, transcriptNpcId, "Ogre boat",
      atKaramja ? "at-karamja" : "at-the-feldip-hills");
    return true;
  }

  function routeOgreBoat(event) {
    if (!OGRE_BOAT_IDS.has(event.npcId) || stage(event.player) < STAGE_OPENING_COMPLETE
      || hasFlag(event.player, 32) || !(skrachState(event.player) & 1)) return;
    if (event.definition?.getActions?.()?.[event.clickType - 1] === "Board") event.range = 5;
  }

  function handleAmikItems(event) {
    const { player } = event;
    if (stage(player) < STAGE_OPENING_COMPLETE || hasFlag(player, 64)) return;
    const recipes = [
      [ItemIdentifiers.BUCKET_OF_MILK, ItemIdentifiers.POT_OF_CREAM, ItemIdentifiers.MILKY_MIXTURE],
      [ItemIdentifiers.POT_OF_CORNFLOUR, ItemIdentifiers.MILKY_MIXTURE, ItemIdentifiers.CORNFLOUR_MIXTURE],
      [ItemIdentifiers.VANILLA_POD, ItemIdentifiers.CORNFLOUR_MIXTURE, ItemIdentifiers.BRULEE],
      [ItemIdentifiers.EVIL_CHICKENS_EGG, ItemIdentifiers.BRULEE, ItemIdentifiers.BRULEE_2],
      [ItemIdentifiers.CINNAMON, ItemIdentifiers.BRULEE_2, ItemIdentifiers.BRULEE_3],
    ];
    for (const [first, second, result] of recipes) {
      if (!isItemPair(event, first, second)) continue;
      event.handled = true;
      if (!hasSpace(player)) return player.sendMessage("You need an empty inventory slot to combine the ingredients.");
      player.getInventory().deleteNumber(first, 1);
      player.getInventory().deleteNumber(second, 1);
      player.getInventory().adds(result, 1);
      return;
    }
    if (isItemPair(event, ItemIdentifiers.DRAMEN_BRANCH, ItemIdentifiers.PESTLE_AND_MORTAR)) {
      event.handled = true;
      if (!hasSpace(player)) return player.sendMessage("You need an empty inventory slot to grind the dramen branch.");
      player.getInventory().deleteNumber(ItemIdentifiers.DRAMEN_BRANCH, 1);
      player.getInventory().adds(ItemIdentifiers.CINNAMON, 1);
    }
  }

  function handleAmikObjects(event) {
    const { player, objectId } = event;
    if (stage(player) < STAGE_OPENING_COMPLETE || hasFlag(player, 64)) return;
    const { ObjectIdentifiers } = api.core;
    const option = event.definition?.getActions?.()?.[event.clickType - 1];
    if (objectId === ObjectIdentifiers.VANILLA_PLANT) {
      if (option !== "Pick" && option !== "Search") return;
      event.handled = true;
      if (!hasSpace(player)) return player.sendMessage("You need an empty inventory slot to pick the vanilla pod.");
      player.getInventory().adds(ItemIdentifiers.VANILLA_POD, 1);
    }
  }

  function handleEvilChickenShrine(event) {
    const { player, objectId, itemId } = event;
    if (objectId !== api.core.ObjectIdentifiers.CHICKEN_SHRINE || itemId !== ItemIdentifiers.RAW_CHICKEN
      || stage(player) < STAGE_OPENING_COMPLETE || hasFlag(player, 64)
      || Number(player.getAttribute(AMIK_STATE_ATTRIBUTE)) !== 1) return;
    event.handled = true;
    let npc = EVIL_CHICKEN_BY_PLAYER.get(player);
    if (npc?.isRegistered?.() === false) {
      EVIL_CHICKEN_BY_PLAYER.delete(player);
      npc = null;
    }
    npc ??= api.spawnNpc({ id: NpcIdentifiers.EVIL_CHICKEN, ...EVIL_CHICKEN_LAIR_BOSS,
      wanderRadius: 0, owner: player, ownerOnly: true });
    if (!npc || typeof npc !== "object") {
      player.sendMessage("The shrine's magic falters. Your raw chicken is unharmed; try again shortly.");
      return;
    }
    player.getInventory().deleteNumber(ItemIdentifiers.RAW_CHICKEN, 1);
    EVIL_CHICKEN_BY_PLAYER.set(player, npc);
    moveTo(player, EVIL_CHICKEN_LAIR_ENTRY.x, EVIL_CHICKEN_LAIR_ENTRY.y, EVIL_CHICKEN_LAIR_ENTRY.z);
  }

  function handleDragonToken(event) {
    const { player, option } = event;
    if (option !== "Rub" || event.itemId !== ItemIdentifiers.DRAGON_TOKEN
      || stage(player) < STAGE_OPENING_COMPLETE || hasFlag(player, 64)) return;
    event.handled = true;
    const location = player.getLocation();
    const lumbridge = location.getX() >= 3200 && location.getX() <= 3260
      && location.getY() >= 3170 && location.getY() <= 3260;
    const zanaris = location.getX() >= 2350 && location.getX() <= 2470
      && location.getY() >= 4300 && location.getY() <= 4500;
    if (!lumbridge && !zanaris) {
      require("../QuestRuntime").startTranscript(api, player, NpcIdentifiers.SIR_AMIK_VARZE_3,
        "Recipe for Disaster/Freeing Sir Amik Varze",
        "finding-the-lair-rubbing-dragon-token-while-not-in-zanaris-or-lumbridge");
      return;
    }
    const npc = api.spawnNpc({ id: NpcIdentifiers.KKLIK, x: location.getX() + 1,
      y: location.getY(), z: location.getZ(), wanderRadius: 0, owner: player, ownerOnly: true });
    if (npc && typeof npc === "object") FAIRY_DRAGON_BY_PLAYER.set(player, npc);
    require("../QuestRuntime").startTranscript(api, player, NpcIdentifiers.KKLIK,
      "Recipe for Disaster/Freeing Sir Amik Varze",
      lumbridge ? "finding-the-lair-rubbing-dragon-token-while-in-zanaris-or-lumbridge"
        : "finding-the-lair-rubbing-dragon-token-while-in-zanaris-or-lumbridge");
  }

  function handleAmikCombatDrop(event) {
    const player = event?.killer?.isPlayer?.() ? event.killer : null;
    if (!player || stage(player) < STAGE_OPENING_COMPLETE || hasFlag(player, 64)) return;
    if (EVIL_CHICKEN_BY_PLAYER.get(player) === event.npc && EVIL_CHICKEN_IDS.has(event.npcId)) {
      EVIL_CHICKEN_BY_PLAYER.delete(player);
      player.setAttribute(AMIK_CHICKEN_DEAD_ATTRIBUTE, true);
      syncAmikQuestVarbits(player);
      if (hasSpace(player)) player.getInventory().adds(ItemIdentifiers.EVIL_CHICKENS_EGG, 1);
      else {
        const { ItemOnGroundManager, Item, Location } = api.core;
        ItemOnGroundManager.registerLocation(player, new Item(ItemIdentifiers.EVIL_CHICKENS_EGG, 1), player.getLocation());
      }
    } else if (BLACK_DRAGON_IDS.has(event.npcId) && Number(player.getAttribute(AMIK_STATE_ATTRIBUTE)) === 1
      && inZone(player, EVIL_CHICKEN_LAIR_ZONE) && !has(player, ItemIdentifiers.DRAGON_TOKEN)) {
      player.setAttribute(AMIK_DRAGON_DROP_ATTRIBUTE, true);
      syncAmikQuestVarbits(player);
      if (hasSpace(player)) player.getInventory().adds(ItemIdentifiers.DRAGON_TOKEN, 1);
      else {
        const { ItemOnGroundManager, Item, Location } = api.core;
        ItemOnGroundManager.registerLocation(player, new Item(ItemIdentifiers.DRAGON_TOKEN, 1),
          new Location(player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()));
      }
    }
  }

  function equippedMonkey(player, choices) {
    return choices.includes(equipmentId(player, api.core.Equipment.WEAPON_SLOT));
  }

  function amikQuestStage(player) {
    if (hasFlag(player, 64)) return 20;
    return Number(player.getAttribute(AMIK_STAGE_ATTRIBUTE)) || 0;
  }
  function syncAmikQuestVarbits(player) {
    player.getPacketSender().sendVarbit(1910, amikQuestStage(player));
    player.getPacketSender().sendVarbit(1912, player.getAttribute(AMIK_DRAGON_DROP_ATTRIBUTE) ? 1 : 0);
    player.getPacketSender().sendVarbit(1913, player.getAttribute(AMIK_CHICKEN_DEAD_ATTRIBUTE) ? 1 : 0);
  }
  function setAmikStage(player, value) {
    const next = Math.max(Number(player.getAttribute(AMIK_STAGE_ATTRIBUTE)) || 0, value);
    player.setAttribute(AMIK_STAGE_ATTRIBUTE, next);
    syncAmikQuestVarbits(player);
  }

  function awowogeiQuestStage(player) {
    if (hasFlag(player, 128)) return 50;
    const state = awowogeiState(player);
    const saved = Number(player.getAttribute(AWOWOGEI_STAGE_ATTRIBUTE)) || 0;
    const legacy = state & 48 ? 15 : 0;
    return Math.max(saved, legacy);
  }
  function syncAwowogeiQuestVarbits(player) {
    const state = awowogeiState(player);
    player.getPacketSender().sendVarbit(1914, awowogeiQuestStage(player));
    player.getPacketSender().sendVarbit(1915, state & 16 ? 10 : 0);
    player.getPacketSender().sendVarbit(1916, state & 32 ? 10 : 0);
    player.getPacketSender().sendVarbit(1917, state & AWOWOGEI_SNAKE_FOUND ? 10 : 0);
    player.getPacketSender().sendVarbit(1918, state & AWOWOGEI_RED_TREE_FOUND ? 10 : 0);
  }
  function setAwowogeiStage(player, value) {
    const next = Math.max(Number(player.getAttribute(AWOWOGEI_STAGE_ATTRIBUTE)) || 0, value);
    player.setAttribute(AWOWOGEI_STAGE_ATTRIBUTE, next);
    syncAwowogeiQuestVarbits(player);
  }

  function hasMonkeySpeech(player) {
    return hasOrEquipped(player, ItemIdentifiers.MSPEAK_AMULET, api.core.Equipment.AMULET_SLOT)
      || hasOrEquipped(player, ItemIdentifiers.MSPEAK_AMULET_2, api.core.Equipment.AMULET_SLOT)
      || hasOrEquipped(player, ItemIdentifiers.MSPEAK_AMULET_3, api.core.Equipment.AMULET_SLOT)
      || hasOrEquipped(player, ItemIdentifiers.MSPEAK_AMULET_4, api.core.Equipment.AMULET_SLOT);
  }

  function awowogeiState(player) {
    return Number(player.getAttribute(AWOWOGEI_STATE_ATTRIBUTE)) || 0;
  }

  function hasUnmaskedMonkeyRecipe(player) {
    return (awowogeiState(player) & 0x3f) === 0x3f;
  }

  /** The Ape Atoll course's rope (Agility.plugin.js) swung during the quest opens the hole beside it. */
  function handleTchikiRopeSwung({ player, objectId }) {
    if (objectId !== api.core.ObjectIdentifiers.ROPE_20 || stage(player) < STAGE_OPENING_COMPLETE || hasFlag(player, 128)) return;
    player.setAttribute(AWOWOGEI_STATE_ATTRIBUTE, awowogeiState(player) | TCHIKI_COURSE_SWUNG);
  }

  function handleTchikiCourse(event) {
    const { player, objectId } = event;
    const option = event.definition?.getActions?.()?.[event.clickType - 1];
    const { ObjectIdentifiers } = api.core;
    if (objectId === ObjectIdentifiers.HOLE_18 && option === "Enter"
      && stage(player) >= STAGE_OPENING_COMPLETE && !hasFlag(player, 128)) {
      event.handled = true;
      if (!(awowogeiState(player) & TCHIKI_COURSE_SWUNG)) {
        player.sendMessage("You need to swing across the rope before entering the hole.");
        return;
      }
      if (!hasUnmaskedMonkeyRecipe(player)) {
        player.sendMessage("The three wise monkeys have not yet told you the King's recipe.");
        return;
      }
      // The course hole opens into the cached Tchiki cave room. Its mapped
      // Bush (16059) and Exit (16060) are at 3020,5457 and 3025,5457.
      moveTo(player, 3020, 5457, 0);
      player.setAttribute(AWOWOGEI_STATE_ATTRIBUTE, awowogeiState(player) | TCHIKI_CAVE_ENTERED);
      player.sendMessage("You climb down into the hidden cave beneath the agility course.");
    }
  }

  function handleTchikiCaveObject(event) {
    const { player, objectId } = event;
    const option = event.definition?.getActions?.()?.[event.clickType - 1];
    if (objectId === 16060 && option === "Climb-up"
      && inZone(player, { minX: 3018, maxX: 3027, minY: 5454, maxY: 5460, z: 0 })) {
      event.handled = true;
      moveTo(player, 2757, 2734, 0);
      player.sendMessage("You climb up the rope and emerge beside the final tree on the agility course.");
      return;
    }
    if (!TCHIKI_BUSH_IDS.has(objectId) || option !== "Pick"
      || !inZone(player, { minX: 3018, maxX: 3027, minY: 5454, maxY: 5460, z: 0 })) return;
    event.handled = true;
    if (stage(player) < STAGE_OPENING_COMPLETE || hasFlag(player, 128)) return;
    if (!(awowogeiState(player) & TCHIKI_CAVE_ENTERED) || !hasUnmaskedMonkeyRecipe(player)) {
      player.sendMessage("The three wise monkeys have not yet revealed the way to the Tchiki nuts.");
      return;
    }
    if (!equippedMonkey(player, NINJA_GREEGREE_IDS)) {
      player.sendMessage("You need to wear a ninja monkey greegree to pick the Tchiki nuts.");
      return;
    }
    if (follower(player) || hasPetCarried(player)) {
      player.sendMessage("You cannot bring a pet or follower through the agility course.");
      return;
    }
    if (has(player, ItemIdentifiers.TCHIKI_MONKEY_NUTS)) {
      require("../QuestRuntime").startTranscript(api, player, NpcIdentifiers.KING_AWOWOGEI,
        "Recipe for Disaster/Freeing King Awowogei", "ape-atoll-tchiki-nut-bush-trying-to-take-more-nuts");
      return;
    }
    if (!hasSpace(player)) {
      require("../QuestRuntime").startTranscript(api, player, NpcIdentifiers.KING_AWOWOGEI,
        "Recipe for Disaster/Freeing King Awowogei", "ape-atoll-tchiki-nut-bush-no-inventory-room");
      return;
    }
    addItem(player, ItemIdentifiers.TCHIKI_MONKEY_NUTS);
    require("../QuestRuntime").startTranscript(api, player, NpcIdentifiers.KING_AWOWOGEI,
      "Recipe for Disaster/Freeing King Awowogei", "ape-atoll-tchiki-nut-bush-taking-nuts");
  }

  function handleAwowogeiKing(event) {
    const { player, objectId } = event;
    const { ObjectIdentifiers } = api.core;
    if (![ObjectIdentifiers.AWOWOGEI, ObjectIdentifiers.AWOWOGEI_2, ObjectIdentifiers.AWOWOGEI_3].includes(objectId)
      || stage(player) < STAGE_OPENING_COMPLETE || hasFlag(player, 128)) return;
    const option = event.definition?.getActions?.()?.[event.clickType - 1];
    if (option !== "Talk-to" && option !== "Inspect") return;
    event.handled = true;
    if (!hasMonkeySpeech(player)) {
      player.sendMessage("You need an M'speak amulet to understand King Awowogei.");
      return;
    }
    const state = awowogeiState(player);
    const variant = state & 64 ? "ape-atoll-talking-to-awowogei-again" : "ape-atoll-king-awowogei";
    require("../QuestRuntime").startTranscript(api, player, NpcIdentifiers.KING_AWOWOGEI,
      "Recipe for Disaster/Freeing King Awowogei", variant);
    player.setAttribute(AWOWOGEI_STATE_ATTRIBUTE, state | 8 | 64);
  }

  function handleAwowogeiOffer(event) {
    const { player, npcId, itemId } = event;
    if (!WISE_MONKEY_BITS.has(npcId) || stage(player) < STAGE_OPENING_COMPLETE || hasFlag(player, 128)) return;
    const ordinaryBananas = [ItemIdentifiers.BANANA, ItemIdentifiers.BANANA_2];
    const ordinaryNuts = [ItemIdentifiers.MONKEY_NUTS, ItemIdentifiers.MONKEY_NUTS_2];
    if (![...ordinaryBananas, ...ordinaryNuts].includes(itemId)) return;
    event.handled = true;
    const { startTranscript } = require("../QuestRuntime");
    const page = "Recipe for Disaster/Freeing King Awowogei";
    if (!hasMonkeySpeech(player)) {
      startTranscript(api, player, npcId, page, "ape-atoll-talking-to-the-wise-monkeys-without-an-amulet");
      return;
    }
    const state = awowogeiState(player);
    const banana = ordinaryBananas.includes(itemId);
    const bit = banana ? 16 : 32;
    if (!(state & bit)) {
      player.getInventory().deleteNumber(itemId, 1);
      player.setAttribute(AWOWOGEI_STATE_ATTRIBUTE, state | bit);
      syncAwowogeiQuestVarbits(player);
      if (((state | bit) & 48) === 48) setAwowogeiStage(player, has(player, ItemIdentifiers.SNAKE_CORPSE) ? 20 : 15);
    }
    startTranscript(api, player, npcId, page, banana
      ? "ape-atoll-showing-the-wise-monkeys-the-wrong-ingredients-banana"
      : "ape-atoll-showing-the-wise-monkeys-the-wrong-ingredients-monkey-nuts");
  }

  function handleAwowogeiItems(event) {
    const { player } = event;
    if (stage(player) < STAGE_OPENING_COMPLETE || hasFlag(player, 128)) return;
    if (isItemPair(event, ItemIdentifiers.KNIFE, ItemIdentifiers.RED_BANANA)) {
      event.handled = true;
      if (!hasSpace(player)) return player.sendMessage("You need an empty inventory slot to slice the red banana.");
      player.getInventory().deleteNumber(ItemIdentifiers.RED_BANANA, 1);
      player.getInventory().adds(ItemIdentifiers.SLICED_RED_BANANA, 1);
      return;
    }
    if (isItemPair(event, ItemIdentifiers.PESTLE_AND_MORTAR, ItemIdentifiers.TCHIKI_MONKEY_NUTS)) {
      event.handled = true;
      if (!hasSpace(player)) return player.sendMessage("You need an empty inventory slot to grind the tchiki nuts.");
      player.getInventory().deleteNumber(ItemIdentifiers.TCHIKI_MONKEY_NUTS, 1);
      player.getInventory().adds(ItemIdentifiers.TCHIKI_NUT_PASTE, 1);
      return;
    }
    const filling = [ItemIdentifiers.SLICED_RED_BANANA, ItemIdentifiers.TCHIKI_NUT_PASTE];
    const fillingId = [event.usedItemId, event.usedWithItemId].find((id) => filling.includes(id));
    if (fillingId && [event.usedItemId, event.usedWithItemId].includes(ItemIdentifiers.SNAKE_CORPSE)) {
      event.handled = true;
      if (!hasSpace(player)) return player.sendMessage("You need an empty inventory slot to stuff the snake.");
      player.getInventory().deleteNumber(ItemIdentifiers.SNAKE_CORPSE, 1);
      player.getInventory().deleteNumber(fillingId, 1);
      player.getInventory().adds(ItemIdentifiers.RAW_STUFFED_SNAKE, 1);
      setAwowogeiStage(player, 30);
    }
  }

  function handleAwowogeiObjects(event) {
    const { player, objectId, itemId } = event;
    if (stage(player) < STAGE_OPENING_COMPLETE || hasFlag(player, 128)) return;
    const { ObjectIdentifiers } = api.core;
    // The client map currently places the multiloc banana tree (15580) as
    // the live fruiting object; 15578/15579 remain the generated constants
    // for its dialogue-state variants.
    if ([ObjectIdentifiers.RED_BANANA_TREE, ObjectIdentifiers.RED_BANANA_TREE_2, 15580].includes(objectId)
      && itemId === ItemIdentifiers.ROPE) {
      event.handled = true;
      if (!hasUnmaskedMonkeyRecipe(player)) {
        player.sendMessage("The three wise monkeys have not yet told you the King's recipe.");
        return;
      }
      if (!equippedMonkey(player, GORILLA_GREEGREE_IDS)) {
        require("../QuestRuntime").startTranscript(api, player, NpcIdentifiers.AWOWOGEI,
          "Recipe for Disaster/Freeing King Awowogei", "ape-atoll-red-banana-tree-using-rope-on-it-as-a-non-gorilla-monkey");
        return;
      }
      if (has(player, ItemIdentifiers.RED_BANANA)) {
        require("../QuestRuntime").startTranscript(api, player, NpcIdentifiers.KING_AWOWOGEI,
          "Recipe for Disaster/Freeing King Awowogei", "ape-atoll-red-banana-tree-trying-to-take-another-red-banana");
        return;
      }
      if (!hasSpace(player)) return player.sendMessage("You need an empty inventory slot to collect the red banana.");
      player.getInventory().adds(ItemIdentifiers.RED_BANANA, 1);
      player.setAttribute(AWOWOGEI_STATE_ATTRIBUTE, awowogeiState(player) | AWOWOGEI_RED_TREE_FOUND);
      syncAwowogeiQuestVarbits(player);
      return;
    }
    const objectDefinition = event.object?.getDefinition?.();
    const objectName = String(objectDefinition?.getName?.() || "").toLowerCase();
    const objectExamine = String(objectDefinition?.getExamine?.() || "").toLowerCase();
    const hotRockIds = new Set([16077, 16078, 16079, 16080, 26175]);
    if (itemId === ItemIdentifiers.RAW_STUFFED_SNAKE
      && (hotRockIds.has(objectId) || objectName.includes("rock") || objectExamine.includes("hot rock"))) {
      event.handled = true;
      if (level(player, Skill.COOKING) < 70) {
        player.sendMessage("You need level 70 Cooking to roast the stuffed snake on the hot rocks.");
        return;
      }
      if (!equippedMonkey(player, ZOMBIE_GREEGREE_IDS)) {
        require("../QuestRuntime").startTranscript(api, player, NpcIdentifiers.AWOWOGEI,
          "Recipe for Disaster/Freeing King Awowogei",
          "ape-atoll-entering-exiting-the-cave-to-cook-the-snake-standing-on-the-rockets-without-being-a-zombie-monkey");
        return;
      }
      const at = player.getLocation();
      if (at.getX() < 3050 || at.getX() > 3062 || at.getY() < 5478 || at.getY() > 5492) {
        player.sendMessage("The snake must be cooked on the hot rocks in the Ape Atoll dungeon.");
        return;
      }
      player.getInventory().deleteNumber(ItemIdentifiers.RAW_STUFFED_SNAKE, 1);
      const result = Math.random() < Math.max(0, (70 - level(player, Skill.COOKING)) * 0.025)
        ? ItemIdentifiers.ODD_STUFFED_SNAKE : ItemIdentifiers.STUFFED_SNAKE;
      player.getInventory().adds(result, 1);
      setAwowogeiStage(player, result === ItemIdentifiers.STUFFED_SNAKE ? 40 : 30);
    }
  }

  function routeRedBananaTree(event) {
    const { ObjectIdentifiers } = api.core;
    const hotRockIds = [16077, 16078, 16079, 16080, 26175];
    const isBananaTree = [ObjectIdentifiers.RED_BANANA_TREE, ObjectIdentifiers.RED_BANANA_TREE_2, 15580].includes(event.objectId);
    const isHotRock = hotRockIds.includes(event.objectId);
    if (!isBananaTree && !isHotRock) return;
    const playerLocation = event.player.getLocation();
    const objectLocation = event.object?.getLocation?.();
    if (!objectLocation) return;
    const definition = event.object.getDefinition?.();
    const size = Math.max(definition?.getSizeX?.() ?? 1, definition?.getSizeY?.() ?? 1);
    const reach = Math.max(
      objectLocation.getX() - playerLocation.getX(),
      playerLocation.getX() - (objectLocation.getX() + size - 1),
      objectLocation.getY() - playerLocation.getY(),
      playerLocation.getY() - (objectLocation.getY() + size - 1),
      0
    );
    // This shore tree's footprint blocks every adjacent route mask. Once the
    // player reaches its footprint, use the current tile for the interaction.
    if (reach <= 2) event.destination = { x: playerLocation.getX(), y: playerLocation.getY(), z: playerLocation.getZ() };
  }

  function handleAwowogeiDungeon(event) {
    const { player, objectId } = event;
    const option = event.definition?.getActions?.()?.[event.clickType - 1];
    if (objectId === 16061 && option === "Enter" && stage(player) >= STAGE_OPENING_COMPLETE && !hasFlag(player, 128)) {
      event.handled = true;
      if (!equippedMonkey(player, ZOMBIE_GREEGREE_IDS)) {
        require("../QuestRuntime").startTranscript(api, player, NpcIdentifiers.AWOWOGEI,
          "Recipe for Disaster/Freeing King Awowogei",
          "ape-atoll-entering-exiting-the-cave-to-cook-the-snake-standing-on-the-rockets-without-being-a-zombie-monkey");
        return;
      }
      player.setAttribute(AWOWOGEI_STATE_ATTRIBUTE, awowogeiState(player) | 1024);
      moveTo(player, 3055, 5484, 0);
      player.sendMessage("You squeeze through the crack and cross the hot coals as a zombie monkey.");
      return;
    }
    if (objectId === 16100 && option === "Enter" && (awowogeiState(player) & 1024)) {
      event.handled = true;
      moveTo(player, 2808, 9200, 0);
      player.sendMessage("You squeeze back through the crack into the temple dungeon.");
    }
  }

  function handleAwowogeiSnakePit(event) {
    const { player, objectId } = event;
    if (stage(player) < STAGE_OPENING_COMPLETE || hasFlag(player, 128)) return false;
    const option = event.definition?.getActions?.()?.[event.clickType - 1];
    if (objectId === ObjectIdentifiers.PIT_3 && option === "Enter") {
      event.handled = true;
      moveTo(player, 3019, 5485, 0);
      player.sendMessage("You climb down into the snake pit on Crash Island.");
      return true;
    }
    if (objectId === ObjectIdentifiers.ROPE_21 && ["Climb", "Climb-up"].includes(option)
      && inZone(player, AWOWOGEI_SNAKE_HOLE)) {
      event.handled = true;
      moveTo(player, 2922, 2722, 0);
      player.sendMessage("You climb up the rope and out of the snake pit.");
      return true;
    }
    return false;
  }

  function handleBigSnakeDeath(event) {
    const player = event?.killer?.isPlayer?.() ? event.killer : null;
    if (!player || event.npcId !== NpcIdentifiers.BIG_SNAKE || stage(player) < STAGE_OPENING_COMPLETE
      || hasFlag(player, 128)) return;
    player.setAttribute(AWOWOGEI_STATE_ATTRIBUTE, awowogeiState(player) | AWOWOGEI_SNAKE_FOUND);
    syncAwowogeiQuestVarbits(player);
    if (hasSpace(player)) player.getInventory().adds(ItemIdentifiers.SNAKE_CORPSE, 1);
    else {
      const { ItemOnGroundManager, Item } = api.core;
      ItemOnGroundManager.registerLocation(player, new Item(ItemIdentifiers.SNAKE_CORPSE, 1), player.getLocation());
    }
    if (awowogeiQuestStage(player) >= 15) setAwowogeiStage(player, 20);
  }

  function handleSkrachChoice({ player, npcId, option }) {
    if (stage(player) < STAGE_OPENING_COMPLETE || hasFlag(player, 32)) return;
    if (BANQUET_ARIS_IDS.has(npcId) && option === "Oh Ok then, I guess I'll talk to Rantz.") {
      setSkrachStage(player, 10);
      return;
    }
    if (RANTZ_IDS.has(npcId) && option === "Ok, I'll do it.") {
      setSkrachBit(player, 1);
      setSkrachStage(player, 20);
      player.getPacketSender().sendVarbit(VARBIT_OGRE_BOAT, 1);
      return;
    }
    if (OGRE_BOAT_IDS.has(npcId) && option === "Yes please, I'll get a lift back with you.") {
      setSkrachBit(player, SKRACH_FREE_RIDE_TAKEN);
      setSkrachStage(player, 90);
    }
  }

  function handleJubblyDeath(event) {
    const player = event?.killer?.isPlayer?.() ? event.killer : null;
    const npc = event?.npc;
    if (!player || JUBBLY_BY_PLAYER.get(player) !== npc
      || ![NpcIdentifiers.JUBBLY_BIRD, NpcIdentifiers.JUBBLY_BIRD_2, NpcIdentifiers.JUBBLY_BIRD_3].includes(event.npcId)
      || hasFlag(player, 32) || !(Number(player.getAttribute(SKRACH_STATE_ATTRIBUTE)) & 1)) return;
    JUBBLY_BY_PLAYER.delete(player);
    if (hasSpace(player)) player.getInventory().adds(ItemIdentifiers.RAW_JUBBLY, 1);
    else {
      const { ItemOnGroundManager, Item, Location } = api.core;
      ItemOnGroundManager.registerLocation(player, new Item(ItemIdentifiers.RAW_JUBBLY, 1),
        new Location(player.getLocation().getX(), player.getLocation().getY(), player.getLocation().getZ()));
    }
    player.sendMessage("You pluck the raw jubbly from the bird.");
  }

  function requireOgreHuntingGear(event) {
    const { attacker, target } = event;
    if (!attacker?.isPlayer?.() || !target || JUBBLY_BY_PLAYER.get(attacker) !== target) return;
    const id = target.getId?.() ?? target.getDefinition?.()?.getId?.();
    if (![NpcIdentifiers.JUBBLY_BIRD, NpcIdentifiers.JUBBLY_BIRD_2, NpcIdentifiers.JUBBLY_BIRD_3].includes(id)) return;
    const { Equipment } = api.core;
    const weapon = equipmentId(attacker, Equipment.WEAPON_SLOT);
    const arrows = equipmentId(attacker, Equipment.AMMUNITION_SLOT);
    if (![ItemIdentifiers.OGRE_BOW, ItemIdentifiers.COMP_OGRE_BOW].includes(weapon)
      || arrows !== ItemIdentifiers.OGRE_ARROW) {
      event.allow = false;
      attacker.sendMessage("Jubblies can only be hunted with an ogre bow and ogre arrows.");
    }
  }

  function refuseHotCake(event) {
    if (event.npcId !== NpcIdentifiers.MOUNTAIN_DWARF
      || event.itemId !== ItemIdentifiers.DWARVEN_ROCK_CAKE || stage(event.player) < STAGE_OPENING_COMPLETE) return;
    event.handled = true;
    if (equipmentId(event.player, api.core.Equipment.HANDS_SLOT) === ItemIdentifiers.ICE_GLOVES) {
      event.player.getInventory().deleteNumber(ItemIdentifiers.DWARVEN_ROCK_CAKE, 1);
      addItem(event.player, ItemIdentifiers.DWARVEN_ROCK_CAKE_2);
      require("../QuestRuntime").startTranscript(api, event.player, event.npcId, DWARF_PAGE,
        "getting-the-recipe-cooling-the-rock-cake-by-wearing-ice-gloves");
    } else {
      require("../QuestRuntime").startTranscript(api, event.player, event.npcId, DWARF_PAGE,
        "getting-the-recipe-attempting-to-free-the-dwarf-with-a-hot-rock-cake");
    }
  }

  function coolCakeAfterIcefiend(event) {
    const { killer, npcId } = event;
    if (!killer?.isPlayer?.() || ![NpcIdentifiers.ICEFIEND, NpcIdentifiers.ICEFIEND_2, NpcIdentifiers.ICEFIEND_3].includes(npcId)
      || !has(killer, ItemIdentifiers.DWARVEN_ROCK_CAKE)) return;
    killer.getInventory().deleteNumber(ItemIdentifiers.DWARVEN_ROCK_CAKE, 1);
    addItem(killer, ItemIdentifiers.DWARVEN_ROCK_CAKE_2);
    require("../QuestRuntime").startTranscript(api, killer, npcId, DWARF_PAGE,
      "getting-the-recipe-cooling-the-rock-cake-by-killing-an-icefiend");
  }

  function handleStageChanged({ player, key }) {
    if (key === QUEST) syncSkrachSpitRoast(player);
  }

  function handleLogout({ player }) {
    if (player) clearSkrachSpitRoast(player);
  }

  function buildJournal(player) {
    if (quest.isComplete(player)) return ["I freed the Lumbridge council and defeated the Culinaromancer.", "", "<col=ff0000>QUEST COMPLETE!</col>"];
    if (stage(player) >= STAGE_OPENING_COMPLETE) {
      return ["I started the Recipe for Disaster banquet and freed the council members.", "", "The council still need to be freed, and the Culinaromancer defeated."];
    }
    if (stage(player) >= STAGE_STARTED) return ["The Cook is preparing a banquet for the Lumbridge council.", "", "I need to help him gather the ingredients."];
    return ["I can help the Cook in Lumbridge Castle prepare a banquet.", "", "Requirements: 10 Cooking and Cook's Assistant."];
  }

  function syncQuestState({ player }) {
    ensureOgreBoatTalkActions();
    syncSkrachSpitRoast(player);
    syncRescueQuestVarbits(player);
    player.getPacketSender().sendVarbit(VARBIT_OGRE_BOAT,
      (skrachState(player) & 1) || hasFlag(player, 32) ? 1 : 0);
    spawnCouncil(player);
    if (canBeginFinale(player)) ensureEntryPortal();
    const wave = Number(player.getAttribute(FINAL_FIGHT_ATTRIBUTE)) || 0;
    const location = player.getLocation?.();
    if (wave > 0 && location?.getX?.() === FINAL_ROOM.x && location?.getY?.() === FINAL_ROOM.y
      && location?.getZ?.() === FINAL_ROOM.z && canBeginFinale(player)
      && !ACTIVE_FINAL_NPC_BY_PLAYER.get(player)) spawnCulinaromancer(player, wave);
  }

  api.persistAttribute(FLAGS_ATTRIBUTE);
  api.persistAttribute(PIRATE_ATTRIBUTE);
  api.persistAttribute(PIRATE_HIDES_ATTRIBUTE);
  api.persistAttribute(PIRATE_STAGE_ATTRIBUTE, 0);
  api.persistAttribute(PIRATE_FIRST_DIVE_ATTRIBUTE, false);
  api.persistAttribute(GOBLIN_STATE_ATTRIBUTE);
  api.persistAttribute(GOBLIN_STAGE_ATTRIBUTE, 0);
  api.persistAttribute(DWARF_STATE_ATTRIBUTE);
  api.persistAttribute(DWARF_STAGE_ATTRIBUTE, 0);
  api.persistAttribute(GUIDE_STATE_ATTRIBUTE);
  api.persistAttribute(GUIDE_STAGE_ATTRIBUTE, 0);
  api.persistAttribute(DAVE_STATE_ATTRIBUTE);
  api.persistAttribute(DAVE_STAGE_ATTRIBUTE, 0);
  api.persistAttribute(DAVE_RECIPE_ATTRIBUTE);
  api.persistAttribute(DAVE_STEW_ATTRIBUTE);
  api.persistAttribute(SKRACH_STATE_ATTRIBUTE);
  api.persistAttribute(SKRACH_STAGE_ATTRIBUTE, 0);
  api.persistAttribute(AWOWOGEI_STATE_ATTRIBUTE);
  api.persistAttribute(AWOWOGEI_STAGE_ATTRIBUTE, 0);
  api.persistAttribute(AMIK_STATE_ATTRIBUTE);
  api.persistAttribute(AMIK_STAGE_ATTRIBUTE, 0);
  api.persistAttribute(AMIK_DRAGON_DROP_ATTRIBUTE, false);
  api.persistAttribute(AMIK_CHICKEN_DEAD_ATTRIBUTE, false);
  api.persistAttribute(AMIK_WOM_BRIEFED_ATTRIBUTE, 0);
  api.persistAttribute(FINAL_FIGHT_ATTRIBUTE);
  api.persistAttribute(FINAL_BOSS_DEFEATED_ATTRIBUTE);
  quest = registerQuest(api, {
    key: QUEST,
    name: "Recipe for Disaster",
    varpId: VARP_RFD,
    varbitId: VARBIT_RFD,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [],
    rewardItemId: ItemIdentifiers.ANTIQUE_LAMP_3,
    rewardItemLabel: "Antique lamp (20,000 XP in a skill of level 50 or higher)",
    otherRewards: ["Access to the Culinaromancer's Chest", "Ability to buy Barrows gloves"],
    buildJournal,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleHook);
  api.onCustomEvent("recipe-for-disaster:rescue-status", handleRescueStatusQuery);
  api.onCustomEvent("npc-dialogue:choice", handlePirateChoice);
  api.onCustomEvent("npc-dialogue:choice", handleSkrachChoice);
  api.onCustomEvent("npc-dialogue:choice", handleDwarfBarChoice);
  api.onCustomEvent("npc-dialogue:choice", handleAmikWiseOldManChoice);
  api.onCustomEvent("interface:closed", handleAmikWiseOldManBriefingClosed);
  api.onCustomEvent("npc-dialogue:condition", handleGuideConditionGrant);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:line", handleFlambeLine);
  api.onCustomEvent("npc-dialogue:line", handleDwarfMilestoneLine);
  api.onCustomEvent("npc-dialogue:line", handleGoblinMilestoneLine);
  api.onCustomEvent("npc-dialogue:line", handleDaveMilestoneLine);
  api.onCustomEvent("npc-dialogue:line", handleGuideMilestoneLine);
  api.onCustomEvent("npc-dialogue:line", handleAmikWiseOldManBriefing);
  api.onCustomEvent("npc-dialogue:line", handleMurphyGearReceipt);
  api.onCustomEvent("npc-dialogue:line", handlePirateMilestoneLine);
  api.onCustomEvent("npc-dialogue:line", handlePirateNungMilestoneLine);
  api.onCustomEvent("npc-dialogue:line", handleSkrachMilestoneLine);
  api.onCustomEvent("npc-dialogue:line", handleAmikMilestoneLine);
  api.onCustomEvent("npc-dialogue:line", handleAwowogeiMilestoneLine);
  api.onCustomEvent("pets:vermin-caught", dropDaveSpice);
  api.onItemOnItem(handleFruitBlast, { noted: false });
  api.onItemOnItem(handleGoblinIngredients, { noted: false });
  api.onItemOnItem(handleDwarfItems, { noted: false });
  api.onItemOnItem(handleAmikItems, { noted: false });
  api.onItemOnItem(handleAwowogeiItems, { noted: false });
  api.onItemOnItem(handleGuideCakeItems, { noted: false });
  api.onItemOnItem(handleDaveStewMix, { noted: false });
  api.onItemOnNpc(rescueByItem);
  api.onItemOnNpc(handleDaveStewTaste);
  api.onItemOnNpc(refuseHotCake);
  api.onItemOnNpc(handleNungItem);
  api.onItemOnNpc(handleSkrachToad);
  api.onItemOnNpc(handleAwowogeiOffer);
  api.onItemOnObject(handleGoblinIngredients, { noted: false });
  api.onItemOnObject(handleSkrachItemOnObject, { noted: false });
  api.onItemOnObject(handleEvilChickenShrine, { noted: false });
  api.onItemOnObject(handleAwowogeiObjects, { noted: false });
  api.onItemOnItem(handlePirateFoodItems, { noted: false });
  api.onItemOnItem(handleSkrachItems, { noted: false });
  api.onItemOnObject(handlePirateRange, { noted: false });
  api.onItemOnObject(handleGuideRange, { noted: false });
  api.onItemAction("Antique lamp", { Rub: handleLampRub });
  api.onItemAction("Dragon token", { Rub: handleDragonToken });
  api.onNpcDeath(handleNpcDeath);
  api.onNpcDeath(handleJubblyDeath);
  api.onNpcDeath(handleAmikCombatDrop);
  api.onNpcDeath(handleBigSnakeDeath);
  api.onCanAttack(requireOgreHuntingGear);
  api.onCanAttack(enforceFlambeedIceGloves);
  api.onNpcHitModify(enforceMotherWeakness);
  api.onCombatHitResolved(applyKaramelMagicEffects);
  api.onPrayerDisabled(disableFinalRoomPrayers);
  api.onPlayerDeath(handleFinalRoomDeath);
  api.onNpcDeath(coolCakeAfterIcefiend);
  api.onNpcInteraction(handleArisInteraction);
  api.onNpcInteraction("Murphy", { "Talk-to": handleMurphy });
  api.onNpcInteraction("Goblin Cook", { "Talk-to": handleGoblinCook });
  api.onObjectInteraction("Ladder", { "Climb-down": handleGoblinLadder, "Climb-up": handleGoblinLadder });
  api.onNpcInteraction("Old dwarf", { "Talk-to": handleDwarfNpc });
  api.onNpcInteraction(handleDwarfNpc);
  api.onNpcInteraction("Rohak", { "Talk-to": handleDwarfNpc });
  api.onNpcInteraction("Emily", { "Talk-to": handleDwarfNpc });
  api.onNpcInteraction("Kaylee", { "Talk-to": handleDwarfNpc });
  api.onNpcInteraction("Tina", { "Talk-to": handleDwarfNpc });
  api.onNpcInteraction("Rantz", { "Talk-to": handleRantzTalk });
  api.onNpcInteraction(handleOgreBoatTalk);
  api.onNpcRoute(routeOgreBoat);
  api.onNpcInteraction("Wizard Traiborn", { "Talk-to": handleTraiborn });
  api.onNpcInteraction(handleDaveTalk);
  api.onNpcInteraction("Doris", { "Talk-to": handleDorisTalk });
  api.onNpcInteraction("Wise Old Man", { "Talk-to": handleAmikWiseOldMan });
  api.onNpcInteraction("Mizaru", { "Talk-to": handleWiseMonkey });
  api.onNpcInteraction("Kikazaru", { "Talk-to": handleWiseMonkey });
  api.onNpcInteraction("Iwazaru", { "Talk-to": handleWiseMonkey });
  api.onObjectInteraction(handlePirateObjects);
  api.onObjectInteraction(handleSkrachObjectInteraction);
  api.onObjectInteraction(handleAmikObjects);
  api.onObjectInteraction(handleTchikiCourse);
  api.onObjectInteraction(handleTchikiCaveObject);
  api.onCustomEvent("agility:obstacle", handleTchikiRopeSwung);
  api.onObjectInteraction(handleAwowogeiObjects);
  api.onObjectInteraction(handleAwowogeiDungeon);
  api.onObjectInteraction(handleAwowogeiSnakePit);
  api.onObjectRoute(routeRedBananaTree);
  api.onObjectInteraction(handleAwowogeiKing);
  api.onItemAction("Balloon toad", { Drop: handleSkrachDrop, Release: handleSkrachDrop });
  api.onItemDropPolicy(handleSkrachDrop);
  api.onObjectInteraction("Portal", { Use: enterPortal, Enter: enterPortal, "Enter portal": enterPortal, "Pass-through": enterPortal });
  api.onCustomEvent("quest:stage-changed", handleStageChanged);
  api.onPlayerLogin(syncQuestState);
  api.onPlayerLogout(handleLogout);
  api.onCustomEvent("player:bootstrap-complete", syncQuestState);
  api.onNpcInteraction(handleCouncilInteraction);
  installPirateRockPiles();
  ensureOgreBoatTalkActions();
};
