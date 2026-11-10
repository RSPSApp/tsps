/**
 * Observatory Quest (members).
 *
 * The words come from the "Observatory Quest" transcript page. The professor, his
 * assistant and the sleeping goblin guard are indexed, so this plugin supplies the
 * by-stage variant selector, the prose-condition answers, the start hook and the
 * "Quest complete!" actions from after-viewing-the-telescope. Stage machine (varp
 * 112): 1 planks, 2 bronze, 3 glass, 4 mould, 5 lens, 6 telescope, 7 complete, 8 wine claimed.
 *
 * What the player sees follows live OSRS (RSProx capture 20261110T110141-5ab63b4, rev 242,
 * docs/quests/observatory-quest/README.md has the facts and ticks):
 * - the start rolls the star sign (observatory_starsign 3828), the glass hand-in which marked
 *   dungeon chest holds the kitchen key (observatory_chestchoice 3827);
 * - the surface stairs warn first (cws_warning_9, interface 560);
 * - the three marked chests open, are searched and close; the sleeping guard sleeps until
 *   prodded, when a goblin guard takes his place and attacks;
 * - the kitchen gate stays shut while that guard is awake (unless he is trapped north of it),
 *   unlocks once with the key and lets the player through like any gate;
 * - the goblin stove gives the mould in two message boxes, the mould and glass make the lens;
 * - the first climb into the Observatory with the lens handed over plays the professor's
 *   cutscene (../observatory/Cutscene.ObservatoryQuest.js);
 * - the telescope shows the player's constellation in its own interface (552).
 */
module.exports = function registerObservatoryQuest(api) {
  const {
    Animation, Skill, Location, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers, ObjectManager, GameObject,
    TaskManager, CountdownTask, DialogueChainBuilder, ActionDialogue, StatementDialogue, ItemStatementDialogue,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript, loadTranscripts } = require("../QuestRuntime");
  const Cutscene = require("../observatory/Cutscene.ObservatoryQuest")(api, { onSeen: cutsceneSeen });

  const PAGE = "Observatory Quest";

  const VARP_OBSERVATORY_QUEST = 112;
  const VARBIT_GATE_UNLOCKED = 3826; // observatory_gatelock
  const VARBIT_CHEST_CHOICE = 3827; // observatory_chestchoice
  const VARBIT_STAR_SIGN = 3828; // observatory_starsign
  const VARBIT_SCOPE_LOOKED = 3836; // observatory_scopelooked
  const VARBIT_MOULD_PRESENT = 3837; // observatory_mould_pres
  const VARBIT_CUTSCENE_SEEN = 3838; // observatory_cutscene_seen
  const VARBIT_DUNGEON_WARNINGS = 3859; // cws_warning_9

  const STAGE_PLANKS = 1;
  const STAGE_BRONZE = 2;
  const STAGE_GLASS = 3;
  const STAGE_MOULD = 4;
  const STAGE_LENS = 5;
  const STAGE_TELESCOPE = 6;
  const STAGE_COMPLETE = 7;
  const STAGE_CLAIMED_WINE = 8;

  const VIEWED_ATTRIBUTE = "quest.observatory_quest.viewed";
  const CONSTELLATION_ATTRIBUTE = "quest.observatory_quest.constellation";
  const GATE_UNLOCKED_ATTRIBUTE = "observatory-quest:gate-unlocked";
  const PROFESSOR_NAME_ATTRIBUTE = "observatory-quest:professor-name-known";
  const CHEST_CHOICE_ATTRIBUTE = "observatory-quest:chest-choice";
  const CUTSCENE_SEEN_ATTRIBUTE = "observatory-quest:cutscene-seen";
  const DUNGEON_WARNINGS_ATTRIBUTE = "observatory-quest:dungeon-warnings";

  const START_HOOK = "quest:observatory-quest:start";

  /**
   * The signs in observatory_starsign order, which is also the professor's menu order (capture
   * tick 1626: Aquarius|Capricorn|Sagittarius|Scorpio, then Libra|Virgo|Leo, Cancer|Gemini|Taurus;
   * Quest Helper's ObservatoryQuest maps 0-11 the same way). `model` is the telescope view
   * (qip_obs_telescope:stars): 27059 is Taurus in the capture, the rest are matched against the
   * Wiki's star chart images by their stars.
   */
  const SIGNS = Object.freeze([
    { name: "Aquarius", model: 27064, action: "RZIxJd", items: [[ItemIdentifiers.WATER_RUNE, 25]] },
    { name: "Capricorn", model: 27061, action: "42iZjm", xp: [Skill.STRENGTH, 875] },
    { name: "Sagittarius", model: 27056, action: "az5TSU", items: [[ItemIdentifiers.MAPLE_LONGBOW, 1]] },
    { name: "Scorpio", model: 27055, action: "jFQCJj", items: [[ItemIdentifiers.WEAPON_POISON, 1]] },
    { name: "Libra", model: 27057, action: "JTTGjU", items: [[ItemIdentifiers.LAW_RUNE, 3]] },
    { name: "Virgo", model: 27060, action: "3JvMiY", xp: [Skill.DEFENCE, 875] },
    { name: "Leo", model: 27058, action: "uJHYgt", xp: [Skill.HITPOINTS, 875] },
    { name: "Cancer", model: 27067, action: "5ogiFw", items: [[ItemIdentifiers.AMULET_OF_DEFENCE, 1]] },
    { name: "Gemini", model: 27068, action: "OX2wkW", items: [[ItemIdentifiers.BLACK_2H_SWORD, 1]] },
    { name: "Taurus", model: 27059, action: "b-a96m", items: [[ItemIdentifiers.SUPER_STRENGTH_1_, 1]] },
    { name: "Aries", model: 27066, action: "AlVBZ2", xp: [Skill.ATTACK, 875] },
    { name: "Pisces", model: 27062, action: "hHQ5V3", items: [[ItemIdentifiers.TUNA, 3]] },
  ]);
  const SIGN_BY_NAME = new Map(SIGNS.map((sign) => [sign.name, sign]));
  const SIGN_BY_ACTION = new Map(SIGNS.map((sign) => [sign.action, sign]));

  /** Item hand-in actions in the returning-with-* branches (stages 1-6). */
  const PLANK_HAND_IN_ACTION = "p1dp6a";
  const BRONZE_HAND_IN_ACTION = "7a36YD";
  const GLASS_HAND_IN_ACTION = "Y5Z4-D";
  const GLASS_RETURN_ACTION = "JH15Z2";
  const LENS_HAND_IN_ACTION = "HgpGGr";
  /** "The professor has gone ahead to the Observatory dome...": live takes the lens here. */
  const GONE_AHEAD_MESSAGE = "vj7Nry";
  /** "The professor gives you back the molten glass.": an item box with the glass (tick 1023). */
  const GLASS_BACK_MESSAGE = "URgSXm";
  /** "The professor carries on with his studies.": a message box (tick 84). */
  const CARRIES_ON_MESSAGE = "Lmq76H";
  const WINE_MESSAGE_ACTION = "3f2Vz2";

  const PROFESSOR_NPC_ID = NpcIdentifiers.OBSERVATORY_PROFESSOR;
  const PROFESSOR_NPC_IDS = new Set([PROFESSOR_NPC_ID, NpcIdentifiers.OBSERVATORY_PROFESSOR_2]);
  const ASSISTANT_NPC_ID = NpcIdentifiers.OBSERVATORY_ASSISTANT;
  const SLEEPING_GUARD_NPC_ID = NpcIdentifiers.SLEEPING_GUARD;
  const GOBLIN_GUARD_NPC_ID = NpcIdentifiers.GOBLIN_GUARD;

  /**
   * The three marked dungeon chests (qip_obs_dungeon_chest_closed, 2 and 3) and their open forms,
   * in observatory_chestchoice order: 0 is 2364,9355 (the capture's key chest), 2 is 2351,9361
   * (Quest Helper's note on chestchoice 2), so 1 is 2360,9366.
   */
  const DUNGEON_CHESTS = Object.freeze([
    { closed: ObjectIdentifiers.CHEST_79, open: ObjectIdentifiers.CHEST_80 },
    { closed: ObjectIdentifiers.CHEST_81, open: ObjectIdentifiers.CHEST_82 },
    { closed: ObjectIdentifiers.CHEST_83, open: ObjectIdentifiers.CHEST_84 },
  ]);
  const CHEST_BY_CLOSED = new Map(DUNGEON_CHESTS.map((chest, choice) => [chest.closed, { ...chest, choice }]));
  const CHEST_BY_OPEN = new Map(DUNGEON_CHESTS.map((chest, choice) => [chest.open, { ...chest, choice }]));
  const KITCHEN_GATE_IDS = new Set([ObjectIdentifiers.KITCHEN_GATE, ObjectIdentifiers.KITCHEN_GATE_2]);
  /** 25442 is the cache transform parent of GOBLIN_STOVE/GOBLIN_STOVE_2. */
  const GOBLIN_STOVE_IDS = new Set([ObjectIdentifiers.GOBLIN_STOVE, ObjectIdentifiers.GOBLIN_STOVE_2, 25442]);
  /** 25591 is the cache transform parent of TELESCOPE_8/TELESCOPE_9 (upstairs). */
  const TELESCOPE_IDS = new Set([ObjectIdentifiers.TELESCOPE, ObjectIdentifiers.TELESCOPE_8, ObjectIdentifiers.TELESCOPE_9, 25591]);
  const SURFACE_STAIRS_ID = ObjectIdentifiers.STAIRS_129; // 25432, east hill
  const DUNGEON_STAIRS_ID = ObjectIdentifiers.STAIRS_127; // 25429, north + south

  // 2335,9351 is the south end (y is lower); 2355,9395 is the north end.
  const DUNGEON_STAIRS_SOUTH = { x: 2335, y: 9351 };
  const DUNGEON_STAIRS_NORTH = { x: 2355, y: 9395 };
  const SURFACE_STAIRS_LANDING = { x: 2458, y: 3185, z: 0 };
  const DUNGEON_NORTH_LANDING = { x: 2355, y: 9394, z: 0 };
  const OBSERVATORY_LANDING = { x: 2443, y: 3158, z: 0 };

  /** The tile north of the gate that traps the woken guard (Quest Helper; capture tick 856). */
  const GUARD_TRAP_TILE = { x: 2327, y: 9399 };
  /** The gate's south side, inside the kitchen. */
  const KITCHEN_SIDE_MAX_Y = 9393;
  /** Ours: an awake guard nobody fights for this long goes back to sleep. */
  const GUARD_IDLE_TICKS = 100;
  const GUARD_CHECK_TICKS = 5;
  /** Ours: when the goblin guard's definition has no respawn time. */
  const GUARD_RESPAWN_TICKS = 25;

  const PLANK = ItemIdentifiers.PLANK;
  const BRONZE_BAR = ItemIdentifiers.BRONZE_BAR;
  const MOLTEN_GLASS = ItemIdentifiers.MOLTEN_GLASS;
  const GOBLIN_KITCHEN_KEY = ItemIdentifiers.GOBLIN_KITCHEN_KEY;
  const LENS_MOULD = ItemIdentifiers.LENS_MOULD;
  const OBSERVATORY_LENS = ItemIdentifiers.OBSERVATORY_LENS;
  const JUG_OF_WINE = ItemIdentifiers.JUG_OF_WINE;

  const ANIM = {
    handOver: 6291, // dream_player_feed_cyrisus_standing, the hand-ins (ticks 140, 156, 171, 1022, 1040)
    openChest: 536, // human_openchest (also the stove's second box)
    closeChest: 535, // human_closechest
    search: 6840, // generic_look_and_search
    chestOpens: 6851, // chest_kicked_open (loc)
    chestCloses: 6850, // chest_closes (loc)
    prod: 6839, // qip_observatory_human_wakes_up_goblin
    guardWakes: 6827, // qip_observatory_goblin_wake_up
    lookThroughScope: 6849, // look_through_scope
  };
  const SOUND = { chestOpen: 52, chestClose: 51 };

  const TELESCOPE_INTERFACE = 552; // qip_obs_telescope
  const TELESCOPE_STARS = (TELESCOPE_INTERFACE << 16) | 7;
  const MAINMODAL_OPEN_SCRIPT = 2524; // toplevel_mainmodal_open
  const DUNGEON_WARNING = 560; // cws_warning_9
  const WARNING_PROCEED = 17; // warn1, "Proceed regardless"
  const WARNING_STAY_OUT = 18; // warn2
  const WARNING_CLOSE = 12; // cws_close
  /** Ours: the count stops below 7, the value the box's script draws as "Don't ask me this again". */
  const WARNING_COUNT_MAX = 6;
  const PENDING_DESCENT = new WeakSet();

  /** Live wording where the Wiki transcript differs or has none (capture ticks in the docs). */
  const MESSAGES = {
    openChest: "You open the chest.",
    closeChest: "You close the chest.",
    emptyChest: "The chest is empty.",
    findKey: "You find a kitchen key.",
    haveKey: ["You already have a kitchen key.", "Another one will be of no use."],
    gateUnlocks: ["The gate unlocks.", "The key is useless now. You discard it."],
    guardAwake: "You need to get rid of that goblin guard first.",
    guardAsleep: "If you open the gate, the guard will hear you. You need to get rid of him.",
    stoveMould: "The goblins appear to have been using the lens mould to cook their stew!",
    stoveShake: "You shake out its contents and take it with you.",
    stoveEmpty: "Just a plain stove. Nothing there.",
    lensPour: "You pour the molten glass into the mould and clasp it together...",
    lensDone: "You pour the molten glass into the mould and clasp it together...<br>It has produced a small, convex glass disc.",
    lookThroughScope: "You look through the telescope.",
    goneAhead: "The professor has gone ahead to the Observatory dome. Best you follow him to see the finished telescope.",
  };

  const page = (p, variant) => ({ page: p, variant });
  const has = (player, itemId, quantity = 1) => player.getInventory().getAmount(itemId) >= quantity;
  const later = (key, ticks, callback) => TaskManager.submit(new CountdownTask(key, ticks, callback));

  let quest;
  /** The woken guard: { guard, sleeper, idle }, while one is about. */
  let awake = null;

  function transcriptLine(variant, index) {
    const step = loadTranscripts(api)?.[PAGE]?.variants?.[variant]?.[index];
    return step?.player ?? step?.text ?? null;
  }

  // ==========================================================================
  // State
  // ==========================================================================

  function ownsMould(player) {
    return has(player, LENS_MOULD)
      || (player.getBanks?.() ?? []).some(bank => (bank?.getAmount(LENS_MOULD) ?? 0) > 0);
  }

  function syncMouldPresence(player) {
    player.getPacketSender().sendVarbit(VARBIT_MOULD_PRESENT, ownsMould(player) ? 1 : 0);
  }

  function handleMouldDiscarded({ player, item }) {
    if (item.getId() === LENS_MOULD) syncMouldPresence(player);
  }

  function handleMouldAfterDeath({ victim }) {
    // PlayerDeathTask has already removed losses and restored kept items here.
    if (victim.getPacketSender().getVarbit(VARBIT_MOULD_PRESENT) === 1) syncMouldPresence(victim);
  }

  function signOf(player) {
    return SIGN_BY_NAME.get(String(player.getAttribute(CONSTELLATION_ATTRIBUTE) ?? "")) ?? null;
  }

  function chestChoice(player) {
    const value = Number(player.getAttribute(CHEST_CHOICE_ATTRIBUTE));
    return Number.isInteger(value) && value >= 0 && value < DUNGEON_CHESTS.length ? value : 0;
  }

  function syncHelperState({ player }) {
    const sender = player.getPacketSender();
    sender.sendVarbit(VARBIT_GATE_UNLOCKED, player.getAttribute(GATE_UNLOCKED_ATTRIBUTE) === true ? 1 : 0);
    sender.sendVarbit(VARBIT_SCOPE_LOOKED, player.getAttribute(VIEWED_ATTRIBUTE) ? 1 : 0);
    sender.sendVarbit(VARBIT_CUTSCENE_SEEN, player.getAttribute(CUTSCENE_SEEN_ATTRIBUTE) === true ? 1 : 0);
    sender.sendVarbit(VARBIT_STAR_SIGN, Math.max(0, SIGNS.indexOf(signOf(player))));
    sender.sendVarbit(VARBIT_CHEST_CHOICE, chestChoice(player));
    sender.sendVarbit(VARBIT_DUNGEON_WARNINGS, Number(player.getAttribute(DUNGEON_WARNINGS_ATTRIBUTE)) || 0);
    syncMouldPresence(player);
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) return ["<str>I repaired the Observatory telescope.</str>", "", "<col=ff0000>QUEST COMPLETE!</col>"];
    if (stage === 0) return ["I can start this quest by speaking to the", "<col=800000>Observatory professor</col> south-west of Ardougne."];
    if (stage === STAGE_PLANKS) return ["The professor needs <col=800000>three wooden planks</col> for a new tripod."];
    if (stage === STAGE_BRONZE) return ["The professor needs a <col=800000>bronze bar</col> for the telescope tube."];
    if (stage === STAGE_GLASS) return ["The professor needs <col=800000>molten glass</col> for a replacement lens."];
    if (stage === STAGE_MOULD) return ["The goblins hid the professor's <col=800000>lens mould</col> in the Observatory dungeon."];
    if (stage === STAGE_LENS) return ["I should use the <col=800000>lens mould</col> with <col=800000>molten glass</col>."];
    return ["The telescope is repaired. I should meet the professor", "at the Observatory and <col=800000>look through the telescope</col>."];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.CRAFTING, 2250);
  }

  // ==========================================================================
  // Dialogue
  // ==========================================================================

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);

    if (PROFESSOR_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_COMPLETE) return page("Observatory professor", "standard-dialogue-after-observatory-quest");
      if (stage === STAGE_TELESCOPE) {
        return page(PAGE, player.getAttribute(VIEWED_ATTRIBUTE)
          ? "after-viewing-the-telescope"
          : "entering-the-observatory-talking-to-the-professor");
      }
      if (stage === STAGE_LENS) {
        return page(PAGE, has(player, OBSERVATORY_LENS)
          ? "returning-with-the-observatory-lens"
          : "returning-with-the-lens-mould-returning-without-the-observatory-lens");
      }
      if (stage === STAGE_MOULD) {
        return page(PAGE, has(player, LENS_MOULD)
          ? "returning-with-the-lens-mould"
          : "returning-with-molten-glass-returning-without-the-lens-mould");
      }
      if (stage === STAGE_GLASS) {
        return page(PAGE, has(player, MOLTEN_GLASS)
          ? "returning-with-molten-glass"
          : "returning-with-a-bronze-bar-returning-without-molten-glass");
      }
      if (stage === STAGE_BRONZE) {
        return page(PAGE, has(player, BRONZE_BAR)
          ? "returning-with-a-bronze-bar"
          : "returning-with-three-planks-returning-without-a-bronze-bar");
      }
      if (stage === STAGE_PLANKS) {
        const planks = player.getInventory().getAmount(PLANK);
        if (planks >= 3) return page(PAGE, "returning-with-three-planks");
        if (planks > 0) return page(PAGE, "starting-off-returning-without-enough-planks");
        return page(PAGE, "starting-off-returning-with-no-planks");
      }
      return page(PAGE, "starting-off");
    }

    if (npcId === ASSISTANT_NPC_ID) {
      if (stage >= STAGE_CLAIMED_WINE) return page("Observatory assistant", "after-observatory-quest-subsequent-dialogue");
      if (stage >= STAGE_COMPLETE) return page("Observatory assistant", "after-observatory-quest-initial-dialogue");
      if (stage === STAGE_TELESCOPE) return page(PAGE, "returning-with-the-observatory-lens-talking-to-the-assistant-before-going-up-to-the-observatory");
      if (stage === STAGE_LENS) {
        return page(PAGE, has(player, OBSERVATORY_LENS)
          ? "making-the-observatory-lens-talking-to-the-assistant-with-the-observatory-lens"
          : "returning-with-the-lens-mould-talking-to-the-assistant-without-the-observatory-lens");
      }
      if (stage === STAGE_MOULD) {
        return page(PAGE, has(player, GOBLIN_KITCHEN_KEY)
          ? "searching-for-the-lens-mould-speaking-to-the-observatory-assistant-with-the-goblin-kitchen-key"
          : "returning-with-molten-glass-talking-to-the-assistant-without-the-lens-mould");
      }
      if (stage === STAGE_GLASS) {
        return page(PAGE, has(player, MOLTEN_GLASS)
          ? "returning-with-a-bronze-bar-talking-to-the-assistant-with-molten-glass"
          : "returning-with-a-bronze-bar-talking-to-the-assistant-without-molten-glass");
      }
      if (stage === STAGE_BRONZE) {
        return page(PAGE, has(player, BRONZE_BAR)
          ? "returning-with-three-planks-talking-to-the-assistant-with-a-bronze-bar"
          : "returning-with-three-planks-talking-to-the-assistant-without-a-bronze-bar");
      }
      if (stage === STAGE_PLANKS) {
        const planks = player.getInventory().getAmount(PLANK);
        if (planks >= 3) return page(PAGE, "starting-off-talking-to-the-assistant-with-three-planks");
        if (planks > 0) return page(PAGE, "starting-off-talking-to-the-assistant-with-less-than-three-planks");
        return page(PAGE, "starting-off-talking-to-the-assistant-without-any-planks");
      }
      return page("Observatory assistant", "before-observatory-quest");
    }

    return null;
  }

  /** Answers the page's prose conditions; scoped so other quests' handlers are not shadowed. */
  function answerCondition({ player, npcId, text }) {
    if (!PROFESSOR_NPC_IDS.has(npcId) && npcId !== ASSISTANT_NPC_ID) return null;
    const value = String(text).toLowerCase();
    if (value.includes("has asked the observatory assistant about his real name")) {
      return player.getAttribute(PROFESSOR_NAME_ATTRIBUTE) === true;
    }
    if (value.includes("no free inventory space") || value.includes("does not have inventory space")) {
      return player.getInventory().isFull();
    }
    if (value.includes("has inventory space")) return !player.getInventory().isFull();
    if (value.includes("did not see this sign")) return true;
    const seen = /did see ([a-z]+)/.exec(value);
    if (seen) return signOf(player)?.name.toLowerCase() === seen[1];
    return null;
  }

  /**
   * The sign the telescope shows, rolled as the quest starts (capture tick 131 sends
   * observatory_starsign with the stage). Live reads the player's birth sign; with none here,
   * one is rolled, keeping OSRS's pure protection: no combat-XP sign for a level-1 skill.
   */
  function rollSign(player) {
    const fair = SIGNS.filter((sign) => !sign.xp || player.getSkillManager().getMaxLevel(sign.xp[0]) > 1);
    const pool = fair.length ? fair : SIGNS;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function ensureSign(player) {
    const existing = signOf(player);
    if (existing) return existing;
    const sign = rollSign(player);
    player.setAttribute(CONSTELLATION_ATTRIBUTE, sign.name);
    player.getPacketSender().sendVarbit(VARBIT_STAR_SIGN, SIGNS.indexOf(sign));
    return sign;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!PROFESSOR_NPC_IDS.has(npcId) || hook !== START_HOOK) return;
    if (quest.getStage(player) >= STAGE_PLANKS) return;
    ensureSign(player);
    quest.setStage(player, STAGE_PLANKS);
  }

  function grantConstellationReward(player, sign) {
    for (const [itemId, amount] of sign.items ?? []) {
      player.getInventory().forceAdd(player, new api.core.Item(itemId, amount));
    }
    if (sign.xp) player.getSkillManager().addExperiences(sign.xp[0], sign.xp[1]);
  }

  /** Ours (when): the key's chest is picked as the professor asks for the mould. */
  function rollChestChoice(player) {
    const choice = Math.floor(Math.random() * DUNGEON_CHESTS.length);
    player.setAttribute(CHEST_CHOICE_ATTRIBUTE, choice);
    player.getPacketSender().sendVarbit(VARBIT_CHEST_CHOICE, choice);
  }

  function handOver(player) {
    player.performAnimation(new Animation(ANIM.handOver));
  }

  function fadeAround(player) {
    const sender = player.getPacketSender();
    const uid = (161 << 16) | 1;
    sender.mountSubInterface(uid, 174, 1, { postScripts: [{ scriptId: 948, args: [0, 255, 0, 0, 50] }] });
    later(player, 2, () => {
      const mount = sender.mountSubInterface(uid, 174, 1, { postScripts: [{ scriptId: 948, args: [0, 0, 0, 255, 50] }] });
      later(player, 3, () => sender.closeSubInterfaceMount(mount));
    });
  }

  /** Item hand-ins, the assistant's wine and the after-viewing completion action. */
  function handleAction(event) {
    const { player, npcId, stepId, kind } = event;
    if (npcId === ASSISTANT_NPC_ID) {
      // The initial post-quest chat's "The assistant gives you some wine." hands it over.
      if (kind === "message" && stepId === WINE_MESSAGE_ACTION && quest.getStage(player) === STAGE_COMPLETE) {
        if (player.getInventory().isFull()) return;
        player.getInventory().adds(JUG_OF_WINE, 1);
        quest.setStage(player, STAGE_CLAIMED_WINE);
      }
      return;
    }
    if (!PROFESSOR_NPC_IDS.has(npcId)) return;
    const stage = quest.getStage(player);
    switch (stepId) {
      case PLANK_HAND_IN_ACTION:
        if (stage !== STAGE_PLANKS || !has(player, PLANK, 3)) return;
        handOver(player);
        player.getInventory().deleteNumber(PLANK, 3);
        quest.setStage(player, STAGE_BRONZE);
        return;
      case BRONZE_HAND_IN_ACTION:
        if (stage !== STAGE_BRONZE || !has(player, BRONZE_BAR)) return;
        handOver(player);
        player.getInventory().deleteNumber(BRONZE_BAR, 1);
        quest.setStage(player, STAGE_GLASS);
        return;
      case GLASS_HAND_IN_ACTION:
        if (stage !== STAGE_GLASS || !has(player, MOLTEN_GLASS)) return;
        handOver(player);
        player.getInventory().deleteNumber(MOLTEN_GLASS, 1);
        rollChestChoice(player);
        quest.setStage(player, STAGE_MOULD);
        return;
      case GLASS_RETURN_ACTION:
        if (stage !== STAGE_MOULD || !has(player, LENS_MOULD)) return;
        handOver(player);
        if (!has(player, MOLTEN_GLASS)) player.getInventory().adds(MOLTEN_GLASS, 1);
        quest.setStage(player, STAGE_LENS);
        return;
      case LENS_HAND_IN_ACTION:
        // Live hands it over here but takes it at the closing message (tick 1047).
        if (stage === STAGE_LENS && has(player, OBSERVATORY_LENS)) handOver(player);
        return;
      case CARRIES_ON_MESSAGE:
        if (kind === "message") event.box = { statement: true };
        return;
      case GLASS_BACK_MESSAGE:
        if (kind === "message") event.box = { items: [MOLTEN_GLASS] };
        return;
      case GONE_AHEAD_MESSAGE:
        // A message box, as live shows it (tick 1047).
        if (kind === "message") event.box = { statement: true };
        if (stage !== STAGE_LENS || !has(player, OBSERVATORY_LENS)) return;
        player.getInventory().deleteNumber(OBSERVATORY_LENS, 1);
        player.getInventory().deleteNumber(LENS_MOULD, 1);
        syncMouldPresence(player);
        quest.setStage(player, STAGE_TELESCOPE);
        fadeAround(player);
        return;
      default:
        break;
    }
    const sign = SIGN_BY_ACTION.get(stepId);
    if (!sign || stage < STAGE_TELESCOPE || quest.isComplete(player)) return;
    quest.complete(player);
    grantConstellationReward(player, sign);
  }

  /** Fill player names and record the assistant's actual name revelation. */
  function handleDialogueLine(request) {
    if (!request?.player || typeof request.text !== "string") return;
    if (!PROFESSOR_NPC_IDS.has(request.npcId) && request.npcId !== ASSISTANT_NPC_ID) return;
    if (request.npcId === ASSISTANT_NPC_ID && request.text.includes("his name is Mambo-duna")) {
      const previous = request.before;
      request.before = () => {
        previous?.();
        request.player.setAttribute(PROFESSOR_NAME_ATTRIBUTE, true);
      };
    }
    if (!request.text.includes("[player name]")) return;
    request.text = request.text.replace(/\[player name\]/gi, request.player.getDisplayName());
  }

  // ==========================================================================
  // The dungeon
  // ==========================================================================

  function statement(player, text, then) {
    const chain = new DialogueChainBuilder().add(new StatementDialogue(0, text));
    if (then) chain.add(new ActionDialogue(1, { execute: () => { player.getPacketSender().sendInterfaceRemoval(); then(); } }));
    player.getDialogueManager().startDialogues(chain);
  }

  function itemBox(player, itemId, text, then) {
    const chain = new DialogueChainBuilder().add(new ItemStatementDialogue(0, itemId, text));
    if (then) chain.add(new ActionDialogue(1, { execute: () => { player.getPacketSender().sendInterfaceRemoval(); then(); } }));
    player.getDialogueManager().startDialogues(chain);
  }

  /** Swaps a chest loc for its other form, for everyone, as live's loc_add_change does. */
  function swapChest(object, nextId) {
    const location = object.getLocation();
    ObjectManager.deregister(object, true);
    ObjectManager.register(new GameObject(nextId, location.clone(), object.getType(), object.getFace(), object.getPrivateArea?.() ?? null), true);
  }

  /** Open: the message, animation and sound on arrival, the open loc a tick later (ticks 466-467). */
  function openChest(player, object, chest) {
    player.sendMessage(MESSAGES.openChest);
    player.performAnimation(new Animation(ANIM.openChest));
    player.getPacketSender().sendObjectAnimation(object, new Animation(ANIM.chestOpens)).sendSound(SOUND.chestOpen, 1, 0);
    later(object, 1, () => swapChest(object, chest.open));
  }

  function closeChest(player, object, chest) {
    player.sendMessage(MESSAGES.closeChest);
    player.performAnimation(new Animation(ANIM.closeChest));
    player.getPacketSender().sendObjectAnimation(object, new Animation(ANIM.chestCloses)).sendSound(SOUND.chestClose, 1, 0);
    later(object, 1, () => swapChest(object, chest.closed));
  }

  /** Search: the look animation, then two ticks later the key's box or an empty chest (703-705). */
  function searchChest(player, chest) {
    player.performAnimation(new Animation(ANIM.search));
    later(player, 2, () => {
      const stage = quest.getStage(player);
      const holdsKey = stage >= STAGE_MOULD && stage <= STAGE_LENS && chest.choice === chestChoice(player);
      if (!holdsKey) {
        player.sendMessage(MESSAGES.emptyChest);
        return;
      }
      if (has(player, GOBLIN_KITCHEN_KEY)) {
        for (const message of MESSAGES.haveKey) player.sendMessage(message);
        return;
      }
      // The key arrives as the box is continued (tick 707).
      itemBox(player, GOBLIN_KITCHEN_KEY, MESSAGES.findKey, () => {
        if (!has(player, GOBLIN_KITCHEN_KEY)) player.getInventory().adds(GOBLIN_KITCHEN_KEY, 1);
      });
    });
  }

  function handleChest(event, option) {
    const { player, objectId, object } = event;
    const closed = CHEST_BY_CLOSED.get(objectId);
    const open = CHEST_BY_OPEN.get(objectId);
    if (closed && option === "open") openChest(player, object, closed);
    else if (open && option === "search") searchChest(player, open);
    else if (open && option === "close") closeChest(player, object, open);
    else return false;
    event.handled = true;
    return true;
  }

  /** The woken guard is up and free: waking, fighting or wandering, but not dead or trapped. */
  function guardStillAwake() {
    if (!awake) return false;
    if (awake.dead) return false;
    const guard = awake.guard;
    if (!guard) return true;
    if (!guard.isRegistered?.() || guard.getHitpoints?.() <= 0 || guard.isDyingFunction?.()) return false;
    const at = guard.getLocation();
    return !(at.getX() === GUARD_TRAP_TILE.x && at.getY() === GUARD_TRAP_TILE.y);
  }

  function sleeperAsleep(npc) {
    return npc?.isVisible?.() !== false;
  }

  /**
   * The kitchen gate (door:toggle, before Doors swings it): locked without the key, shut while
   * the guard sleeps beside it or is awake and free, unlocked once by the key, then a gate the
   * player passes through (Doors' kitchen gate entry). Going in, the player says to be quick.
   */
  function handleKitchenGate(request) {
    const { player, objectId } = request;
    if (!player || !KITCHEN_GATE_IDS.has(objectId)) return;
    const unlocked = player.getAttribute(GATE_UNLOCKED_ATTRIBUTE) === true;
    // Leaving the kitchen is never stopped (live leaves it at tick 888; nothing shows a refusal).
    if (player.getLocation().getY() <= KITCHEN_SIDE_MAX_Y) return;
    const refuse = (message) => {
      player.sendMessage(message);
      request.handled = true;
    };
    if (!unlocked && (quest.getStage(player) < STAGE_MOULD || !has(player, GOBLIN_KITCHEN_KEY))) {
      // Ours: no capture or Wiki line for trying the gate without its key.
      refuse("The kitchen gate is locked.");
      return;
    }
    // Nobody has woken the sleeping guard at his post beside the gate.
    if (!awake) {
      refuse(unlocked ? MESSAGES.guardAwake : MESSAGES.guardAsleep);
      return;
    }
    if (guardStillAwake()) {
      refuse(MESSAGES.guardAwake);
      return;
    }
    if (!unlocked) {
      player.getInventory().deleteNumber(GOBLIN_KITCHEN_KEY, 1);
      player.setAttribute(GATE_UNLOCKED_ATTRIBUTE, true);
      player.getPacketSender().sendVarbit(VARBIT_GATE_UNLOCKED, 1);
      for (const message of MESSAGES.gateUnlocks) player.sendMessage(message);
    }
    startTranscript(api, player, PROFESSOR_NPC_ID, PAGE, "unlocking-the-kitchen-gate");
  }

  /**
   * Prod: the player prods and the guard stirs on arrival; two ticks later the goblin guard is
   * up in his place, shouts and attacks (ticks 806-808). He's a real fight; killed, or once
   * nobody has fought him for a while, the sleeping guard is back at his post. Ours: he can be
   * prodded at any stage (the capture prods him at stage 4 only).
   */
  function prodSleepingGuard(event) {
    const { player, npc } = event;
    if (!npc || awake || !sleeperAsleep(npc)) return;
    player.performAnimation(new Animation(ANIM.prod));
    npc.performAnimation(new Animation(ANIM.guardWakes));
    const entry = { guard: null, sleeper: npc, idle: 0 };
    awake = entry;
    later(player, 2, () => {
      if (awake !== entry) return;
      npc.setVisible(false);
      const at = npc.getLocation();
      const guard = api.spawnNpc({ id: GOBLIN_GUARD_NPC_ID, x: at.getX(), y: at.getY(), z: at.getZ() });
      if (!guard) {
        wakeEnds(entry);
        return;
      }
      guard.__skipDefaultRespawn = true;
      guard.setPositionToFace(new Location(at.getX(), at.getY() + 1, at.getZ()));
      entry.guard = guard;
      const shout = transcriptLine("prodding-the-goblin-guard", 0);
      if (shout) guard.forceChat(shout);
      if (player.isRegistered?.() !== false) guard.getCombat().attack(player);
      watchGuard(entry);
    });
  }

  function wakeEnds(entry) {
    if (awake !== entry) return;
    awake = null;
    if (entry.guard?.isRegistered?.()) api.removeNpc(entry.guard);
    entry.sleeper?.setVisible?.(true);
  }

  function watchGuard(entry) {
    const task = new api.core.Task(GUARD_CHECK_TICKS, entry);
    task.execute = () => {
      if (awake !== entry) {
        task.stop();
        return;
      }
      const guard = entry.guard;
      if (entry.dead) {
        task.stop();
        return;
      }
      if (!guard?.isRegistered?.() && !guard?.isDyingFunction?.()) {
        task.stop();
        wakeEnds(entry);
        return;
      }
      const fighting = guard.getCombat?.().getTarget?.() || guard.getCombat?.().getAttacker?.();
      entry.idle = fighting ? 0 : entry.idle + GUARD_CHECK_TICKS;
      if (entry.idle >= GUARD_IDLE_TICKS) {
        task.stop();
        wakeEnds(entry);
      }
    };
    TaskManager.submit(task);
  }

  /**
   * Killed, the goblin guard no longer stops the gate (live opens it as he falls, tick 914); the
   * sleeping guard is back at his post once the goblin guard would respawn. Ours: no capture shows
   * the sleeper's return, so his definition's respawn time stands in.
   */
  function handleNpcDeath({ npc }) {
    const entry = awake;
    if (!entry || entry.guard !== npc) return;
    entry.dead = true;
    const respawn = npc.getDefinition?.()?.getRespawn?.() ?? GUARD_RESPAWN_TICKS;
    later(entry, Math.max(1, respawn), () => wakeEnds(entry));
  }

  /** Goblin stove: two message boxes, then the mould two ticks after the player's remark (871-876). */
  function inspectStove(player) {
    syncMouldPresence(player);
    if (ownsMould(player)) {
      statement(player, MESSAGES.stoveEmpty);
      return;
    }
    if (player.getInventory().isFull()) {
      // Ours: no capture or Wiki line for a full inventory here.
      player.sendMessage("You need a free inventory space.");
      return;
    }
    statement(player, MESSAGES.stoveMould, () => {
      player.performAnimation(new Animation(ANIM.openChest));
      statement(player, MESSAGES.stoveShake, () => {
        const remark = transcriptLine("inspecting-the-goblin-stove-2", 2);
        if (remark) player.forceChat(remark);
        later(player, 2, () => {
          if (ownsMould(player) || player.getInventory().isFull()) return;
          player.getInventory().adds(LENS_MOULD, 1);
          syncMouldPresence(player);
        });
      });
    });
  }

  /** Cast the lens from the mould and molten glass: two item boxes two ticks apart (1029-1031). */
  function handleItemOnItem(event) {
    const ids = [event.usedItemId, event.usedWithItemId];
    if (!ids.includes(LENS_MOULD) || !ids.includes(MOLTEN_GLASS)) return;
    const { player } = event;
    if (quest.getStage(player) !== STAGE_LENS) return;
    event.handled = true;
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new ActionDialogue(0, {
      execute: () => {
        player.getPacketSender()
          .sendChatboxInterface(193)
          .sendClientScript(2868, "")
          .sendInterfaceFlagsRange((193 << 16) | 0, -1, -1, 0)
          .sendItemOnInterfaces((193 << 16) | 1, LENS_MOULD, 400)
          .sendString(MESSAGES.lensPour, (193 << 16) | 2);
        later(player, 2, () => {
          if (!has(player, MOLTEN_GLASS) || !has(player, LENS_MOULD)) {
            player.getPacketSender().sendInterfaceRemoval();
            return;
          }
          player.getInventory().deleteNumber(MOLTEN_GLASS, 1);
          player.getInventory().adds(OBSERVATORY_LENS, 1);
          itemBox(player, LENS_MOULD, MESSAGES.lensDone);
        });
      },
    }, true)));
  }

  // ==========================================================================
  // Stairs, the Observatory and its telescope
  // ==========================================================================

  /** The surface stairs' "Low level players beware" box; it counts each showing (227-236). */
  function warnBeforeDungeon(player) {
    const shown = Math.min(WARNING_COUNT_MAX, (Number(player.getAttribute(DUNGEON_WARNINGS_ATTRIBUTE)) || 0) + 1);
    player.setAttribute(DUNGEON_WARNINGS_ATTRIBUTE, shown);
    PENDING_DESCENT.add(player);
    const sender = player.getPacketSender();
    sender.sendVarbit(VARBIT_DUNGEON_WARNINGS, shown);
    sender.sendInterfaceScript(MAINMODAL_OPEN_SCRIPT, [-1, -1]);
    sender.sendInterface(DUNGEON_WARNING);
  }

  /** Proceed closes the box and the player is below two ticks later (237-239). */
  function dungeonWarningClick(event) {
    const buttonId = Number(event.buttonId ?? 0);
    if ((event.groupId ?? (buttonId >>> 16)) !== DUNGEON_WARNING) return;
    const child = event.childId ?? (buttonId & 0xffff);
    if (child !== WARNING_PROCEED && child !== WARNING_STAY_OUT && child !== WARNING_CLOSE) return;
    const { player } = event;
    event.handled = true;
    const pending = PENDING_DESCENT.has(player);
    PENDING_DESCENT.delete(player);
    player.getPacketSender().sendInterfaceRemoval();
    if (child !== WARNING_PROCEED || !pending) return;
    later(player, 2, () => player.moveTo(new Location(DUNGEON_NORTH_LANDING.x, DUNGEON_NORTH_LANDING.y, DUNGEON_NORTH_LANDING.z)));
  }

  function cutsceneSeen(player) {
    player.setAttribute(CUTSCENE_SEEN_ATTRIBUTE, true);
    player.getPacketSender().sendVarbit(VARBIT_CUTSCENE_SEEN, 1);
  }

  /**
   * The two dungeon stair runs are far from anything ClimbLinks can pair, so give
   * them explicit destinations: the north stairs lead out to the east hill, the
   * south stairs lead up into the Observatory, and the surface stairs lead down.
   */
  function claimObservatoryClimb(request) {
    if (request.handled) return;
    const { player, object, objectId } = request;
    if (!player || !object) return;
    const location = object.getLocation?.();
    if (!location) return;
    if (objectId === SURFACE_STAIRS_ID) {
      warnBeforeDungeon(player);
      request.handled = true;
      return;
    }
    if (objectId !== DUNGEON_STAIRS_ID) return;
    const x = location.getX();
    const y = location.getY();
    if (x === DUNGEON_STAIRS_SOUTH.x && y === DUNGEON_STAIRS_SOUTH.y) {
      const firstVisit = quest.getStage(player) === STAGE_TELESCOPE && player.getAttribute(CUTSCENE_SEEN_ATTRIBUTE) !== true;
      if (!firstVisit || !Cutscene.start(player)) {
        player.moveTo(new Location(OBSERVATORY_LANDING.x, OBSERVATORY_LANDING.y, OBSERVATORY_LANDING.z));
      }
    } else if (x === DUNGEON_STAIRS_NORTH.x && y === DUNGEON_STAIRS_NORTH.y) {
      player.moveTo(new Location(SURFACE_STAIRS_LANDING.x, SURFACE_STAIRS_LANDING.y, SURFACE_STAIRS_LANDING.z));
    } else {
      return;
    }
    request.handled = true;
  }

  /**
   * View: the message and animation on arrival; two ticks later the telescope's interface with
   * the player's constellation (ticks 1604-1606), and observatory_scopelooked the first time.
   */
  function viewTelescope(player) {
    const stage = quest.getStage(player);
    if (stage < STAGE_TELESCOPE) return false;
    const sign = ensureSign(player);
    player.sendMessage(MESSAGES.lookThroughScope);
    player.performAnimation(new Animation(ANIM.lookThroughScope));
    later(player, 2, () => {
      if (stage === STAGE_TELESCOPE) {
        player.setAttribute(VIEWED_ATTRIBUTE, true);
        player.getPacketSender().sendVarbit(VARBIT_SCOPE_LOOKED, 1);
      }
      const sender = player.getPacketSender();
      sender.sendInterfaceRawModel(TELESCOPE_STARS, sign.model);
      sender.sendInterfaceScript(MAINMODAL_OPEN_SCRIPT, [0, 0]);
      sender.sendInterface(TELESCOPE_INTERFACE);
    });
    return true;
  }

  function telescopeClose(event) {
    const buttonId = Number(event.buttonId ?? 0);
    if ((event.groupId ?? (buttonId >>> 16)) !== TELESCOPE_INTERFACE) return;
    event.handled = true;
    event.player.getPacketSender().sendInterfaceRemoval();
  }

  /** The marked chests, the kitchen stove and the telescope. */
  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    const option = String(event.definition?.getInteractions?.()?.[event.clickType - 1] ?? "").toLowerCase();

    if (CHEST_BY_CLOSED.has(objectId) || CHEST_BY_OPEN.has(objectId)) {
      handleChest(event, option);
      return;
    }

    if (GOBLIN_STOVE_IDS.has(objectId) && option.includes("inspect")) {
      if (quest.getStage(player) < STAGE_MOULD) return;
      event.handled = true;
      inspectStove(player);
      return;
    }

    if (TELESCOPE_IDS.has(objectId) && (option.includes("look") || option.includes("view"))) {
      if (viewTelescope(player)) event.handled = true;
    }
  }

  function handleLogin({ player }) {
    syncHelperState({ player });
    refreshQuestList(player);
  }

  quest = registerQuest(api, {
    key: "observatory_quest",
    name: "Observatory Quest",
    varpId: VARP_OBSERVATORY_QUEST,
    // Wine is a post-quest assistant reward; the cache varp completes at 7.
    varpValue: (stage) => (stage >= STAGE_COMPLETE ? STAGE_COMPLETE : stage),
    startedValue: STAGE_PLANKS,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [{ skillId: Skill.CRAFTING.getIndex(), amount: 2250, label: "Crafting" }],
    rewardItemId: ItemIdentifiers.UNCUT_SAPPHIRE,
    rewardItemLabel: "An uncut sapphire",
    otherRewards: ["A random reward based on the observed constellation"],
    buildJournal,
    onReward: grantReward,
  });

  api.persistAttribute(VIEWED_ATTRIBUTE);
  api.persistAttribute(CONSTELLATION_ATTRIBUTE);
  api.persistAttribute(GATE_UNLOCKED_ATTRIBUTE, false);
  api.persistAttribute(PROFESSOR_NAME_ATTRIBUTE, false);
  api.persistAttribute(CHEST_CHOICE_ATTRIBUTE, 0);
  api.persistAttribute(CUTSCENE_SEEN_ATTRIBUTE, false);
  api.persistAttribute(DUNGEON_WARNINGS_ATTRIBUTE, 0);
  api.onCustomEvent("player:bootstrap-complete", syncHelperState);
  api.onCustomEvent("item:discarded", handleMouldDiscarded);
  api.onPlayerDefeated(handleMouldAfterDeath);
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onNpcInteraction("Sleeping guard", { Prod: prodSleepingGuard });
  api.onNpcDeath(handleNpcDeath);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onCustomEvent("ladders:climb", claimObservatoryClimb);
  api.onCustomEvent("door:toggle", handleKitchenGate);
  api.onInterfaceActionClick(dungeonWarningClick);
  api.onInterfaceActionClick(telescopeClose);
  api.onItemOnItem(handleItemOnItem);
  api.onObjectInteraction(handleObjectInteraction);
  api.onPlayerLogin(handleLogin);
};
