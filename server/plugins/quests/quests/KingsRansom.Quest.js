/**
 * King's Ransom (members).
 *
 * Words come from the "King's Ransom" transcript page (every variant named
 * below), plus the "Gossip" page's "after-king-s-ransom" line and the "Guard
 * (Sinclair Mansion)" page's post-quest line. This plugin supplies the variant
 * selection for every quest NPC, the prose-condition answers, the evidence
 * gathering (window, scrap-paper spawn, address form, bookcase), the trial
 * (witness menu, testimony proof actions, verdict), the Keep Le Faye jail
 * (vent, lockpick door, grail riddle), the fortress infiltration (black-armour
 * gate, animate-rock freeing of Arthur) and the reward.
 *
 * Stage varbit: 3888 "kr_quest" (varp 1049, bits 0-7). Evidence: RuneLite
 * Quest.KINGS_RANSOM(82); cache cs2 script 4024 switches quest DB row 82 to
 * get_varbit 3888; QuestHelper's KingsRansom step map supplies the stage
 * values below. The cache corroborates them: loc 25943 ("Arthur statue") is a
 * kr_quest multiloc whose King Arthur (25942, Free) transform sits at
 * kr_quest 70 and 75.
 *
 * Stages (varbit 3888): 5 started (Gossip), 10 guard asked (gather evidence),
 * 15 evidence shown, 20 Sinclair history learned, 25 Anna met, 30 attorney
 * (trial or servants' testimony), 35 not guilty, 40 Camelot statue, 45
 * captured (jail), 50 Merlin briefed, 55 Merlin escaped (free the knights),
 * 65 cell open (search the grail table), 70 Holy Grail recovered, 75 Wizard
 * Cromperty (free Arthur), 80 Arthur freed (give him the disguise), 85
 * complete.
 *
 * Rewards per the OSRS Wiki: 1 Quest point, 33,000 Defence, 5,000 Magic and an
 * antique lamp (5,000 XP in any skill over 50), plus the Knight Waves training
 * grounds and Chivalry/Piety after them. The lamp rubs through the shared
 * xpreward interface; the Knight Waves themselves are not implemented.
 *
 * Sources: OSRS Wiki "King's Ransom", its Quick guide and transcript page; the
 * "Table (King's Ransom)" riddle; "Antique lamp (King's Ransom)" (item 11679);
 * the cache for every id and the kr_quest/court varbits; QuestHelper for walk
 * tiles and stage values.
 *
 * Gaps / approximations:
 *  - The fortress wall (loc 2341) is pushed by the earlier BlackKnightsFortress
 *    plugin, which does not know this quest, so the "full black armour" gate is
 *    enforced when climbing down the basement ladder (25843) instead of on the
 *    push.
 *  - No Telekinetic Grab on the jail guard and no Mastermind interface 588:
 *    the knights' pocket hand-outs supply a lockpick (Kay's) and opening the
 *    cell door plays the transcript's success message directly.
 *  - The box-selection interface (390) is not driven; the grail table plays the
 *    wiki riddle then a Box 1..9 prompt (correct box 8). A wrong box teleports
 *    with 5 damage; the stat drain is skipped.
 *  - Venting out lands at the Catherby docks instead of the keep's back dock.
 *  - Trial witnesses are not spawned: picking a name in the judge's menu starts
 *    that witness's testimony transcript once the chatbox clears.
 *  - Evidence items are presented by menu choice and not consumed. The scrap
 *    paper has no static ground spawn, so it is registered per player in the
 *    dining room (the address form has one already).
 *  - No Knight Waves training grounds, no Chivalry/Piety unlock.
 */
module.exports = function registerKingsRansomQuest(api) {
  const {
    CountdownTask,
    Equipment,
    HitDamage,
    HitMask,
    Item,
    ItemIdentifiers,
    Location,
    NpcIdentifiers,
    ObjectIdentifiers,
    Skill,
    TaskManager,
  } = api.core;
  const { registerQuest, refreshQuestList, startDialogue, startTranscript } = require("../QuestRuntime");

  const PAGE = "King's Ransom";
  const GOSSIP_PAGE = "Gossip";
  const GUARD_PAGE = "Guard (Sinclair Mansion)";

  // ==========================================================================
  // Stages (varbit 3888 "kr_quest", varp 1049 bits 0-7)
  // ==========================================================================

  const VARBIT_STAGE = 3888;

  const STAGE_NOT_STARTED = 0;
  const STAGE_STARTED = 5;
  const STAGE_INVESTIGATE = 10;
  const STAGE_EVIDENCE_SHOWN = 15;
  const STAGE_HISTORY_LEARNED = 20;
  const STAGE_ANNA_MET = 25;
  const STAGE_ATTORNEY = 30;
  const STAGE_VERDICT = 35;
  const STAGE_STATUE = 40;
  const STAGE_JAIL = 45;
  const STAGE_MERLIN_BRIEFED = 50;
  const STAGE_MERLIN_ESCAPED = 55;
  const STAGE_CELL_OPEN = 65;
  const STAGE_GRAIL = 70;
  const STAGE_CROMPERTY = 75;
  const STAGE_FREED_ARTHUR = 80;
  const STAGE_COMPLETE = 85;

  // ==========================================================================
  // Items
  // ==========================================================================

  const ITEM = ItemIdentifiers;
  const SCRAP_PAPER_ITEM = ITEM.SCRAP_PAPER; // 11681
  const ADDRESS_FORM_ITEM = ITEM.ADDRESS_FORM; // 11680
  const BLACK_KNIGHT_HELM_ITEM = ITEM.BLACK_KNIGHT_HELM; // 11678
  const HAIR_CLIP_ITEM = ITEM.HAIR_CLIP; // 11682
  const ANTIQUE_LAMP_ITEM = ITEM.ANTIQUE_LAMP_12; // 11679
  const ANIMATE_ROCK_SCROLL_ITEM = ITEM.ANIMATE_ROCK_SCROLL; // 4428
  const HOLY_GRAIL_ITEM = ITEM.HOLY_GRAIL; // 19
  const CRIMINALS_THREAD_ITEM = ITEM.CRIMINALS_THREAD_2; // 1809, Anna's green thread
  const LOCKPICK_ITEMS = new Set([ITEM.LOCKPICK, ITEM.LOCKPICK_2]); // 1523/1524
  const GRANITE_ITEMS = new Set([
    ITEM.GRANITE_500G_,
    ITEM.GRANITE_2KG_,
    ITEM.GRANITE_5KG_,
    ITEM.GRANITE_500G__2,
    ITEM.GRANITE_2KG__2,
    ITEM.GRANITE_5KG__2,
  ]);
  const BRONZE_MED_HELM_ITEM = ITEM.BRONZE_MED_HELM; // 1139
  const IRON_CHAINBODY_ITEM = ITEM.IRON_CHAINBODY; // 1101
  const BLACK_FULL_HELM_ITEM = ITEM.BLACK_FULL_HELM; // 1165
  const BLACK_PLATEBODY_ITEM = ITEM.BLACK_PLATEBODY; // 1125
  const BLACK_LEG_ITEMS = new Set([ITEM.BLACK_PLATELEGS, ITEM.BLACK_PLATESKIRT]); // 1077/1089
  const JUNK_ITEM = ITEM.VODKA; // 2015
  const AIR_RUNE_ITEM = ITEM.AIR_RUNE; // 556
  const LAW_RUNE_ITEM = ITEM.LAW_RUNE; // 563
  const VIAL_ITEM = ITEM.VIAL; // 229
  const SHARK_ITEM = ITEM.SHARK; // 385
  const LOGS_ITEM = ITEM.LOGS; // 1511
  const LOCKPICK_ITEM = ITEM.LOCKPICK; // 1523

  // ==========================================================================
  // NPCs
  // ==========================================================================

  const GOSSIP_ID = NpcIdentifiers.GOSSIP; // 4219, outside Sinclair Mansion
  const MANSION_GUARD_ID = NpcIdentifiers.GUARD_61; // 4218, courtyard guard
  const COURT_GUARD_1_ID = NpcIdentifiers.GUARD_63; // 4335
  const COURT_GUARD_2_ID = NpcIdentifiers.GUARD_64; // 4336
  const PROSECUTOR_ID = NpcIdentifiers.PROSECUTOR; // 4337
  const COURT_ANNA_ID = 1995; // Seers' Village courthouse Anna (unnamed in the dump; resolves to 967)
  const KR_ANNA_ID = NpcIdentifiers.ANNA_3; // 4220, trial-room Anna
  const ANNA_IDS = new Set([
    NpcIdentifiers.ANNA, // 967, the id the courthouse spawn resolves to during the quest
    NpcIdentifiers.ANNA_2, // 969
    COURT_ANNA_ID,
    KR_ANNA_ID,
  ]);
  const DONOVAN_ID = NpcIdentifiers.DONOVAN_THE_FAMILY_HANDYMAN; // 4212
  const PIERRE_ID = NpcIdentifiers.PIERRE; // 4213
  const HOBBES_ID = NpcIdentifiers.HOBBES; // 4214
  const LOUISA_ID = NpcIdentifiers.LOUISA; // 4215
  const MARY_ID = NpcIdentifiers.MARY; // 4216
  const STANFORD_ID = NpcIdentifiers.STANFORD; // 4217
  const JAIL_MERLIN_ID = 4341; // Keep Le Faye cell (unnamed in the dump)
  const CAMELOT_MERLIN_ID = NpcIdentifiers.MERLIN; // 3529
  const CAMELOT_MERLIN_2_ID = NpcIdentifiers.MERLIN_2; // 4059
  const BASEMENT_ARTHUR_ID = 4339; // Black Knights' Fortress basement (unnamed; resolves to 3531 at stage 80)
  const CAMELOT_ARTHUR_ID = NpcIdentifiers.KING_ARTHUR; // 3531
  const CAMELOT_ARTHUR_IDS = new Set([
    CAMELOT_ARTHUR_ID,
    NpcIdentifiers.ARTHUR, // 4340
    NpcIdentifiers.KING_ARTHUR_2, // 5871
    NpcIdentifiers.KING_ARTHUR_3, // 8047
  ]);
  const CROMPERTY_ARDOUGNE_ID = 5314; // East Ardougne spawn (unnamed in the dump)
  const CROMPERTY_IDS = new Set([
    NpcIdentifiers.WIZARD_CROMPERTY, // 8480
    NpcIdentifiers.WIZARD_CROMPERTY_2, // 8481
    CROMPERTY_ARDOUGNE_ID,
  ]);
  const SQUIRE_ID = NpcIdentifiers.SQUIRE_13; // 4353, Camelot top floor
  const JAIL_KNIGHT_IDS = new Map([
    [NpcIdentifiers.SIR_PELLEAS_3, "pelleas"], // 4350
    [NpcIdentifiers.SIR_GAWAIN_3, "gawain"], // 4351
    [NpcIdentifiers.SIR_KAY_3, "kay"], // 4352
  ]);
  // The keep-floor "prison-break" transcripts exist for every knight but
  // Palomedes (4343), so his Talk-to falls through to the generic handler.
  const KEEP_KNIGHT_IDS = new Map([
    [NpcIdentifiers.SIR_LUCAN_2, "lucan"], // 4342
    [NpcIdentifiers.SIR_LANCELOT_2, "lancelot"], // 4344
    [NpcIdentifiers.SIR_BEDIVERE_2, "bedivere"], // 4345
    [NpcIdentifiers.SIR_TRISTRAM_2, "tristram"], // 4346
    [NpcIdentifiers.SIR_PELLEAS_2, "pelleas"], // 4347
    [NpcIdentifiers.SIR_GAWAIN_2, "gawain"], // 4348
    [NpcIdentifiers.SIR_KAY_2, "kay"], // 4349
  ]);
  const SERVANT_FRAGMENTS = new Map([
    [DONOVAN_ID, "donovan"],
    [PIERRE_ID, "pierre"],
    [HOBBES_ID, "hobbes"],
    [LOUISA_ID, "louisa"],
    [MARY_ID, "mary"],
    [STANFORD_ID, "stanford"],
  ]);

  // ==========================================================================
  // Objects
  // ==========================================================================

  const WINDOW_OBJECT_ID = 26123; // nameless kr_window multi at 2748,3577 (26110-26112 children)
  const SINCLAIR_BOOKCASE_ID = ObjectIdentifiers.BOOKCASE_98; // 26053, library 2738,3580
  const CAMELOT_STATUE_ID = ObjectIdentifiers.STATUE_90; // 26073, 2780,3508
  const JAIL_VENT_ID = ObjectIdentifiers.VENT_2; // 25880, 1904,4283
  const JAIL_CELL_DOOR_ID = ObjectIdentifiers.METAL_DOOR; // 25876
  const GRAIL_TABLE_ID = ObjectIdentifiers.TABLE_33; // 2650, keep top floor
  const COURT_JUDGE_ID = ObjectIdentifiers.COURT_JUDGE; // 25956, 1819,4275
  const COURT_GATE_ID = ObjectIdentifiers.GATE_174; // 26042, 1819/1820,4268
  const COURT_STAIRS_ID = ObjectIdentifiers.STAIRS_132; // 26017, 2737,3469
  const ARTHUR_STATUE_IDS = new Set([ObjectIdentifiers.KING_ARTHUR, 25943]); // 25942 + nameless kr_quest multi, 1867,4233
  const CAMELOT_GATE_IDS = new Set([ObjectIdentifiers.GATE_175, ObjectIdentifiers.GATE_176]); // 26081/26082
  const SINCLAIR_GATE_IDS = new Set([
    ObjectIdentifiers.STURDY_WOODEN_GATE,
    ObjectIdentifiers.STURDY_WOODEN_GATE_2,
  ]);
  const BKF_BASEMENT_LADDER_DOWN_ID = ObjectIdentifiers.LADDER_332; // 25843, 3016,3519
  const BKF_BASEMENT_LADDER_UP_ID = ObjectIdentifiers.LADDER_333; // 25844, 1867,4244

  // ==========================================================================
  // Tiles
  // ==========================================================================

  const SCRAP_PAPER_TILE = new Location(2746, 3580, 0);
  const WINDOW_TILE = { x: 2748, y: 3577 };
  const JAIL_TILE = new Location(1904, 4275, 0);
  const CELL_DOOR_TILE = { x: 1904, y: 4273 };
  const TRIAL_TILE = new Location(1819, 4270, 0);
  const TRIAL_ANNA_TILE = { x: 1817, y: 4270, z: 0 };
  const COURT_RETURN_TILE = new Location(2737, 3470, 0);
  const BKF_SECRET_ROOM_TILE = new Location(3016, 3518, 0);
  const BKF_BASEMENT_TILE = new Location(1867, 4244, 0);
  const VENT_EXIT_TILE = new Location(2779, 3400, 0);
  const ARDOUGNE_CAVE_TILE = new Location(2611, 3220, 0);
  const KEEP_BOUNDS = { minX: 1689, maxX: 1701, minY: 4250, maxY: 4264 };
  const JAIL_BOUNDS = { minX: 1895, maxX: 1912, minY: 4260, maxY: 4286 };
  const BKF_BASEMENT_BOUNDS = { minX: 1855, maxX: 1880, minY: 4225, maxY: 4255 };


  // ==========================================================================
  // Evidence / trial bits
  // ==========================================================================

  const EVIDENCE_FORM = 1 << 0;
  const EVIDENCE_PAPER = 1 << 1;
  const EVIDENCE_HELM = 1 << 2;
  const EVIDENCE_ALL = EVIDENCE_FORM | EVIDENCE_PAPER | EVIDENCE_HELM;

  const HISTORY_FAMILY = 1 << 0;
  const HISTORY_MANSION = 1 << 1;
  const HISTORY_ANNA = 1 << 2;
  const HISTORY_ALL = HISTORY_FAMILY | HISTORY_MANSION | HISTORY_ANNA;

  const REBUTTAL_DAGGER = 1 << 0;
  const REBUTTAL_THREAD = 1 << 1;
  const REBUTTAL_POISON = 1 << 2;
  const REBUTTAL_NIGHT = 1 << 3;
  const REBUTTAL_ALL = REBUTTAL_DAGGER | REBUTTAL_THREAD | REBUTTAL_POISON | REBUTTAL_NIGHT;

  const EVIDENCE_ATTRIBUTE = "quest.kings_ransom.evidence";
  const HISTORY_ATTRIBUTE = "quest.kings_ransom.history";
  const REBUTTAL_ATTRIBUTE = "quest.kings_ransom.rebuttal";
  const HANDOUT_ATTRIBUTE = "quest.kings_ransom.handouts";
  const DISGUISE_ATTRIBUTE = "quest.kings_ransom.disguise-given";

  const LAMP_XP = 5000;
  const LAMP_MIN_LEVEL = 50;

  const RIDDLE_LINES = [
    "You seek the grail of old,",
    "but no longer is it a goblet of gold.",
    "Among these nine will you find what you seek,",
    "but be careful and don't peek!",
    "A wrong choice will expel you,",
    "so consider carefully each clue.",
    "Three boxes contain only air,",
    "beware of three boxes, for danger lurks there.",
    "Two hold only rubbish but would fool you with disguise,",
    "only one box holds your prize.",
    "Clues will give the information you need,",
    "rubbish always sits to the right of danger, pay heed.",
    "There is nothing helpful in boxes great in height,",
    "and boxes on either end will not end your plight.",
    "A tall or small box will only bring you anger,",
    "but a square box will not put you in danger.",
  ];

  let quest;
  const trialAnnas = new Map();
  const witnessPending = new WeakSet();

  // ==========================================================================
  // Small helpers
  // ==========================================================================

  function stageOf(player) {
    return quest.getStage(player);
  }

  function isQuestComplete(player, key) {
    const request = { player, key, complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function hasItem(player, itemId, amount = 1) {
    return player.getInventory().getAmount(itemId) >= amount;
  }

  function giveItem(player, itemId, amount = 1) {
    if (!hasItem(player, itemId) && player.getInventory().isFull()) {
      player.sendMessage("You need a free inventory slot.");
      return false;
    }
    player.getInventory().adds(itemId, amount);
    return true;
  }

  function bitAttr(player, key) {
    return Number(player.getAttribute(key)) || 0;
  }

  function addBit(player, key, flag) {
    player.setAttribute(key, bitAttr(player, key) | flag);
  }

  function evidence(player) {
    return bitAttr(player, EVIDENCE_ATTRIBUTE);
  }

  function history(player) {
    return bitAttr(player, HISTORY_ATTRIBUTE);
  }

  function rebuttals(player) {
    return bitAttr(player, REBUTTAL_ATTRIBUTE);
  }

  function handout(player) {
    return bitAttr(player, HANDOUT_ATTRIBUTE);
  }

  function inBounds(location, bounds, levels = [0]) {
    if (!location) return false;
    const x = location.getX?.() ?? location.x;
    const y = location.getY?.() ?? location.y;
    const z = location.getZ?.() ?? location.z ?? 0;
    return levels.includes(z) && x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
  }

  function play(player, npcId, variant, page = PAGE, select) {
    return startTranscript(api, player, npcId, page, variant, select);
  }

  /** Runs `action` once the player's chatbox is clear (a menu still owns it). */
  function whenIdle(player, action) {
    if (!TaskManager || !CountdownTask) {
      action();
      return;
    }
    TaskManager.submit(
      new CountdownTask(player, 2, () => {
        if (player.isRegistered?.() === false) return;
        const chatting =
          player.getDialogueManager?.()?.isActive?.() === true ||
          api.core.MultiChatboxPrompt?.getPending?.(player) != null;
        if (chatting) {
          whenIdle(player, action);
          return;
        }
        action();
      })
    );
  }

  /** Moves the player to the other side of a blocking wall loc, as BKF's doors do. */
  function crossObject(player, location) {
    const position = player.getLocation();
    const dx = position.getX() - location.x;
    const dy = position.getY() - location.y;
    const z = location.z ?? position.getZ();
    if (dx === 0 && dy === 0) {
      player.moveTo(new Location(location.x - 1, location.y, z));
    } else if (Math.abs(dx) > Math.abs(dy)) {
      player.moveTo(new Location(location.x - Math.sign(dx), position.getY(), z));
    } else {
      player.moveTo(new Location(position.getX(), location.y - Math.sign(dy), z));
    }
  }

  function wearingBlackArmour(player) {
    const equipment = player.getEquipment();
    return (
      equipment.get(Equipment.HEAD_SLOT)?.getId?.() === BLACK_FULL_HELM_ITEM &&
      equipment.get(Equipment.BODY_SLOT)?.getId?.() === BLACK_PLATEBODY_ITEM &&
      BLACK_LEG_ITEMS.has(equipment.get(Equipment.LEG_SLOT)?.getId?.())
    );
  }

  function hasGranite(player) {
    for (const itemId of GRANITE_ITEMS) {
      if (hasItem(player, itemId)) return true;
    }
    return false;
  }

  function disguiseGiven(player) {
    return player.getAttribute(DISGUISE_ATTRIBUTE) === true;
  }

  /** 11681 has no static spawn; register the dining-room paper for the owner. */
  function ensureScrapPaper(player) {
    const stage = stageOf(player);
    if (stage < STAGE_INVESTIGATE || stage >= STAGE_EVIDENCE_SHOWN) return;
    if (hasItem(player, SCRAP_PAPER_ITEM)) return;
    const manager = api.getItemOnGroundManager();
    if (manager.getGroundItem(player.getUsername(), SCRAP_PAPER_ITEM, SCRAP_PAPER_TILE, player.getPrivateArea())) return;
    manager.registerLocation(player, new Item(SCRAP_PAPER_ITEM, 1), SCRAP_PAPER_TILE);
  }

  function spawnTrialAnna(player) {
    if (trialAnnas.has(player)) return;
    const npc = api.spawnNpc({
      id: KR_ANNA_ID,
      x: TRIAL_ANNA_TILE.x,
      y: TRIAL_ANNA_TILE.y,
      z: TRIAL_ANNA_TILE.z,
      owner: player,
      ownerOnly: true,
      wanderRadius: 0,
    });
    if (npc) trialAnnas.set(player, npc);
  }

  function removeTrialAnna(player) {
    const npc = trialAnnas.get(player);
    if (!npc) return;
    api.removeNpc(npc);
    trialAnnas.delete(player);
  }

  // ==========================================================================
  // Dialogue conditions (step ids from the wiki transcript page)
  // ==========================================================================

  function answerCondition({ player, stepId }) {
    switch (stepId) {
      case "s73elp": // If the player has lost the scrap paper
        return !hasItem(player, SCRAP_PAPER_ITEM);
      case "FQJLRc": // After showing all 3 pieces of evidence to the guard
        return evidence(player) === EVIDENCE_ALL;
      case "Juwj4h": // If the player has lost the thread
        return !hasItem(player, CRIMINALS_THREAD_ITEM);
      case "tAo1yE": // If the player already has an animate rock scroll
        if (!hasItem(player, ANIMATE_ROCK_SCROLL_ITEM)) {
          giveItem(player, ANIMATE_ROCK_SCROLL_ITEM);
          return false;
        }
        return true;
      case "M3q2hb": // "I seem to have lost the scroll..." option: shown only when lost
        return !hasItem(player, ANIMATE_ROCK_SCROLL_ITEM);
      default:
        return null;
    }
  }

  // ==========================================================================
  // Choice handling
  // ==========================================================================

  /** Wiki: 65 Defence and 45 Magic. */
  const REQUIRED_SKILLS = [
    { skill: Skill.DEFENCE, level: 65, label: "Defence" },
    { skill: Skill.MAGIC, level: 45, label: "Magic" },
  ];

  function missingSkillRequirements(player) {
    const skills = player.getSkillManager();
    return REQUIRED_SKILLS.filter((requirement) => skills.getMaxLevel(requirement.skill) < requirement.level);
  }

  function notifySkillRequirements(player) {
    for (const requirement of missingSkillRequirements(player)) {
      player.sendMessage(
        `You need a ${requirement.label} level of at least ${requirement.level} to start this quest.`
      );
    }
  }

  const REQUIRED_QUESTS = [
    { key: "holy_grail", name: "Holy Grail" },
    { key: "one_small_favour", name: "One Small Favour" },
    { key: "murder_mystery", name: "Murder Mystery" },
    { key: "black_knights_fortress", name: "Black Knights' Fortress" },
  ];

  function notifyQuestRequirements(player) {
    for (const requirement of REQUIRED_QUESTS) {
      if (!isQuestComplete(player, requirement.key)) {
        player.sendMessage(`You must complete ${requirement.name} to start this quest.`);
      }
    }
  }

  function handleStartHook({ player, npcId, hook }) {
    if (hook !== "quest:king-s-ransom:start" || npcId !== GOSSIP_ID) return;
    if (stageOf(player) !== STAGE_NOT_STARTED) return;
    if (missingSkillRequirements(player).length > 0) {
      notifySkillRequirements(player);
      return;
    }
    notifyQuestRequirements(player);
    if (REQUIRED_QUESTS.some((requirement) => !isQuestComplete(player, requirement.key))) return;
    quest.setStage(player, STAGE_STARTED);
  }

  function handleChoice({ player, npcId, option, stepId }) {
    const stage = stageOf(player);
    const text = String(option ?? "").toLowerCase();

    if (npcId === MANSION_GUARD_ID && stage >= STAGE_INVESTIGATE && stage < STAGE_EVIDENCE_SHOWN) {
      let flag = 0;
      let itemId = 0;
      if (text.includes("sinclairs have left")) {
        flag = EVIDENCE_FORM;
        itemId = ADDRESS_FORM_ITEM;
      } else if (text.includes("links the sinclairs to camelot")) {
        flag = EVIDENCE_PAPER;
        itemId = SCRAP_PAPER_ITEM;
      } else if (text.includes("proof of foul play")) {
        flag = EVIDENCE_HELM;
        itemId = BLACK_KNIGHT_HELM_ITEM;
      }
      if (!flag) return;
      if (!hasItem(player, itemId)) {
        player.sendMessage("You no longer have that piece of evidence.");
        return;
      }
      addBit(player, EVIDENCE_ATTRIBUTE, flag);
      if (evidence(player) === EVIDENCE_ALL) quest.setStage(player, STAGE_EVIDENCE_SHOWN);
      return;
    }

    if (npcId === GOSSIP_ID && stage >= STAGE_EVIDENCE_SHOWN && stage < STAGE_ATTORNEY) {
      if (text.includes("tell me about the family")) addBit(player, HISTORY_ATTRIBUTE, HISTORY_FAMILY);
      else if (text.includes("tell me about the mansion")) addBit(player, HISTORY_ATTRIBUTE, HISTORY_MANSION);
      else if (text.includes("tell me about anna sinclair")) addBit(player, HISTORY_ATTRIBUTE, HISTORY_ANNA);
      else return;
      if (history(player) === HISTORY_ALL && stage < STAGE_HISTORY_LEARNED) {
        quest.setStage(player, STAGE_HISTORY_LEARNED);
      }
      return;
    }

    if (ANNA_IDS.has(npcId) && text.includes("okay, i guess i don't have much of a choice")) {
      giveItem(player, CRIMINALS_THREAD_ITEM);
      if (stage < STAGE_ATTORNEY) quest.setStage(player, STAGE_ATTORNEY);
      return;
    }

    if (npcId === PROSECUTOR_ID && stage >= STAGE_ATTORNEY && stage < STAGE_VERDICT) {
      const fragment = TRIAL_WITNESS_FRAGMENTS.get(normalizeWitness(option));
      if (!fragment || witnessPending.has(player)) return;
      witnessPending.add(player);
      whenIdle(player, () => {
        witnessPending.delete(player);
        if (stageOf(player) !== stage) return;
        play(player, fragment.npcId, fragment.variant);
      });
      return;
    }

    if (stepId === "M3q2hb") {
      giveItem(player, ANIMATE_ROCK_SCROLL_ITEM);
    }
  }

  const TRIAL_WITNESS_FRAGMENTS = new Map([
    ["handyman", { npcId: DONOVAN_ID, variant: "trials-and-tribulations-donovan" }],
    ["dog handler", { npcId: PIERRE_ID, variant: "trials-and-tribulations-pierre" }],
    ["butler", { npcId: HOBBES_ID, variant: "trials-and-tribulations-talking-to-hobbes" }],
    ["maid", { npcId: MARY_ID, variant: "trials-and-tribulations-mary" }],
  ]);

  function normalizeWitness(option) {
    return String(option ?? "").trim().toLowerCase();
  }

  // ==========================================================================
  // Transcript action handling (step ids from the wiki transcript page)
  // ==========================================================================

  function scheduleVerdict(player) {
    whenIdle(player, () => {
      spawnTrialAnna(player);
      play(player, PROSECUTOR_ID, "trials-and-tribulations-after-successfully-disproving-all-four-evidences");
    });
  }

  function handleAction(event) {
    const { player, stepId } = event;
    switch (stepId) {
      case "gSJQlf": // Anna hands over another thread
        giveItem(player, CRIMINALS_THREAD_ITEM);
        event.handled = true;
        return;
      case "oBThxS": // "The courtroom cutscene begins."
        player.moveTo(TRIAL_TILE);
        whenIdle(player, () => {
          if (stageOf(player) !== STAGE_ATTORNEY) return;
          play(player, PROSECUTOR_ID, "trials-and-tribulations-the-court-is-in-session");
        });
        event.handled = true;
        return;
      case "BqLxiV": // Morgan knocks the player out; wake in the cell
        player.moveTo(JAIL_TILE);
        if (stageOf(player) < STAGE_JAIL) quest.setStage(player, STAGE_JAIL);
        event.handled = true;
        return;
      case "Bg9t9P": // The knights lift Merlin to the vent
        if (stageOf(player) < STAGE_MERLIN_ESCAPED) quest.setStage(player, STAGE_MERLIN_ESCAPED);
        event.handled = true;
        return;
      case "Uu2oEW": // The knights lift the player out
        player.moveTo(VENT_EXIT_TILE);
        event.handled = true;
        return;
      case "Sxgy3n": // The Holy Grail drops into the pack
        giveItem(player, HOLY_GRAIL_ITEM);
        if (stageOf(player) < STAGE_GRAIL) quest.setStage(player, STAGE_GRAIL);
        return;
      case "iWIqF7": // Booby-trapped box throws the player from the keep
        player.getCombat().getHitQueue().addPendingDamage([new HitDamage(5, HitMask.RED)]);
        player.moveTo(ARDOUGNE_CAVE_TILE);
        return;
      case "hRG18k": // "Congratulations! Quest complete!"
        quest.complete(player);
        event.handled = true;
        return;
      case "JvkVp2": // Hobbes disproves the dagger
        recordRebuttal(player, REBUTTAL_DAGGER, event);
        return;
      case "Gxn2uM": // Donovan questions the thread
        recordRebuttal(player, REBUTTAL_THREAD, event);
        return;
      case "tEQvXa": // Pierre disproves the poison
        recordRebuttal(player, REBUTTAL_POISON, event);
        return;
      case "awFvrM": // Mary disproves the night
        recordRebuttal(player, REBUTTAL_NIGHT, event);
        return;
      case "n9-seQ": // "You search the bookcase..."
        return; // the helm arrives on the next message step
      case "utgl2J": // Black knight helm found
        giveItem(player, BLACK_KNIGHT_HELM_ITEM);
        return;
      case "QqfR-m": // knight hand-outs
      case "eTmq_u":
      case "ahWElu":
      case "QjS9Gx":
      case "UWmusj":
      case "8FOg7Q":
        giveKnightJunk(player, stepId);
        return;
      default:
        return;
    }
  }

  function recordRebuttal(player, flag, event) {
    event.handled = true;
    addBit(player, REBUTTAL_ATTRIBUTE, flag);
    if (rebuttals(player) !== REBUTTAL_ALL) return;
    if (stageOf(player) < STAGE_VERDICT) quest.setStage(player, STAGE_VERDICT);
    event.end = true;
    scheduleVerdict(player);
  }

  const KNIGHT_HANDOUTS = new Map([
    ["QqfR-m", { bit: 1 << 0, item: JUNK_ITEM }], // Sir Lancelot
    ["eTmq_u", { bit: 1 << 1, item: AIR_RUNE_ITEM }], // Sir Pelleas
    ["ahWElu", { bit: 1 << 2, item: SHARK_ITEM }], // Sir Gawain
    ["QjS9Gx", { bit: 1 << 3, item: LAW_RUNE_ITEM }], // Sir Tristram
    ["UWmusj", { bit: 1 << 4, item: LOCKPICK_ITEM }], // Sir Kay
    ["8FOg7Q", { bit: 1 << 5, item: LOGS_ITEM }], // Sir Bedivere
  ]);

  function giveKnightJunk(player, stepId) {
    const handoutEntry = KNIGHT_HANDOUTS.get(stepId);
    if (!handoutEntry || (handout(player) & handoutEntry.bit) !== 0) return;
    addBit(player, HANDOUT_ATTRIBUTE, handoutEntry.bit);
    giveItem(player, handoutEntry.item);
    if (handoutEntry.item !== LOCKPICK_ITEM) giveItem(player, VIAL_ITEM);
  }

  // ==========================================================================
  // NPC Talk-to selection
  // ==========================================================================

  function servantVariant(stage, fragment, npcId) {
    if (stage >= STAGE_COMPLETE) return null;
    if (stage >= STAGE_ATTORNEY) return `ace-detective-part-2-${testimonyFragment(fragment)}-testimony`;
    if (stage >= STAGE_EVIDENCE_SHOWN) return `snooping-around-${fragment}`;
    if (stage >= STAGE_INVESTIGATE) {
      if (fragment === "pierre") return "peril-at-the-end-house-talking-to-pierre-after-talking-to-the-guard";
      if (fragment === "stanford") return "peril-at-the-end-house-stanford-after-talking-to-the-guard";
      return `breaking-and-entering-talking-to-${fragment}`;
    }
    if (stage >= STAGE_STARTED) {
      if (fragment === "pierre") return "peril-at-the-end-house-talking-to-pierre-before-talking-to-the-guard";
      if (fragment === "stanford") return "peril-at-the-end-house-talking-to-stanford-before-talking-to-the-guard";
    }
    return null;
  }

  function testimonyFragment(fragment) {
    if (fragment === "pierre") return "pierre-s";
    if (fragment === "louisa") return "louisa-s";
    if (fragment === "mary") return "mary-s";
    if (fragment === "stanford") return "stanford-s";
    if (fragment === "donovan") return "donovan-s";
    return "hobbes";
  }

  function talkGossip(player, npcId, stage) {
    if (stage >= STAGE_COMPLETE) return play(player, npcId, "after-king-s-ransom", GOSSIP_PAGE) || true;
    if (stage < STAGE_STARTED) {
      // This opening thanks the player for solving Lord Sinclair's murder; until
      // Murder Mystery is complete, leave Gossip to that quest's own variants.
      if (!isQuestComplete(player, "murder_mystery")) return false;
      return play(player, npcId, "strange-things-are-afoot-talking-to-gossip") || true;
    }
    if (stage < STAGE_INVESTIGATE) return play(player, npcId, "strange-things-are-afoot-talking-to-gossip-again") || true;
    if (stage < STAGE_EVIDENCE_SHOWN) {
      return play(player, npcId, "peril-at-the-end-house-talking-to-gossip-after-talking-to-the-guard") || true;
    }
    if (stage < STAGE_HISTORY_LEARNED) {
      return play(player, npcId, "snooping-around-asking-gossip-about-the-sinclairs") || true;
    }
    if (stage < STAGE_ATTORNEY) return play(player, npcId, "snooping-around-talking-to-gossip-again") || true;
    if (stage < STAGE_FREED_ARTHUR) {
      return play(player, npcId, "devil-s-advocate-talking-to-gossip-after-becoming-an-attorney") || true;
    }
    return play(player, npcId, "back-at-the-round-table-talking-to-gossip-before-finishing-the-quest") || true;
  }

  function talkMansionGuard(player, npcId, stage) {
    if (stage >= STAGE_COMPLETE) return play(player, npcId, "standard-dialogue-after-king-s-ransom", GUARD_PAGE) || true;
    if (stage < STAGE_STARTED) return false;
    if (stage < STAGE_INVESTIGATE) {
      play(player, npcId, "peril-at-the-end-house-talking-to-the-guard");
      quest.setStage(player, STAGE_INVESTIGATE);
      return true;
    }
    if (stage < STAGE_EVIDENCE_SHOWN) {
      return play(player, npcId, "breaking-and-entering-returning-to-the-guard-with-the-evidence") || true;
    }
    if (stage < STAGE_ANNA_MET) {
      return play(player, npcId, "snooping-around-talking-to-the-guard-after-learning-about-anna") || true;
    }
    if (stage < STAGE_FREED_ARTHUR) {
      return play(player, npcId, "breaking-and-entering-talking-to-the-guard-after-giving-him-the-evidence") || true;
    }
    return play(player, npcId, "back-at-the-round-table-talking-to-sinclair-guard-before-turning-in-the-quest") || true;
  }

  function talkAnna(player, npcId, stage) {
    if (stage >= STAGE_COMPLETE) return false;
    if (stage >= STAGE_STATUE) return play(player, npcId, "in-justice-has-prevailed-talking-to-anna-again") || true;
    if (stage >= STAGE_VERDICT) {
      if (npcId === KR_ANNA_ID) {
        play(player, npcId, "trials-and-tribulations-talking-to-anna-after-winning-the-case");
        return true;
      }
      play(player, npcId, "in-justice-has-prevailed-talking-to-anna-in-her-cell");
      quest.setStage(player, STAGE_STATUE);
      return true;
    }
    if (stage >= STAGE_ATTORNEY) {
      if (!hasItem(player, CRIMINALS_THREAD_ITEM)) {
        return play(player, npcId, "devil-s-advocate-claiming-another-criminal-s-thread") || true;
      }
      return play(player, npcId, "devil-s-advocate-talking-to-anna-after-agreeing-to-help-her") || true;
    }
    if (stage >= STAGE_HISTORY_LEARNED) {
      play(player, npcId, "devil-s-advocate-talking-to-anna");
      if (stage < STAGE_ANNA_MET) quest.setStage(player, STAGE_ANNA_MET);
      return true;
    }
    return false;
  }

  /**
   * The jail Merlin (4341) and the courthouse Anna (1995) are nameless cache
   * parents whose kr_quest transform resolves to the shared Merlin/Anna ids, so
   * the jail and the fortress basement are told apart by where the NPC stands.
   */
  function talkMerlin(player, stage, inJail) {
    if (inJail) {
      if (stage < STAGE_JAIL || stage >= STAGE_CELL_OPEN) return false;
      if (stage < STAGE_MERLIN_BRIEFED) {
        play(player, CAMELOT_MERLIN_ID, "the-round-tables-have-turned-talking-to-merlin");
        quest.setStage(player, STAGE_MERLIN_BRIEFED);
        return true;
      }
      return play(player, CAMELOT_MERLIN_ID, "the-round-tables-have-turned-talking-to-merlin-again") || true;
    }
    if (stage >= STAGE_COMPLETE) {
      return play(player, CAMELOT_MERLIN_ID, "post-quest-dialogue-talking-to-merlin") || true;
    }
    return false;
  }

  function talkArthur(player, stage, inBasement) {
    if (inBasement) {
      if (stage !== STAGE_FREED_ARTHUR) return false;
      if (disguiseGiven(player)) {
        return play(player, CAMELOT_ARTHUR_ID, "infiltrating-the-black-knights-fortress-again-talking-to-guard-arthur-again") || true;
      }
      if (hasItem(player, BRONZE_MED_HELM_ITEM) && hasItem(player, IRON_CHAINBODY_ITEM)) {
        player.getInventory().deleteNumber(BRONZE_MED_HELM_ITEM, 1);
        player.getInventory().deleteNumber(IRON_CHAINBODY_ITEM, 1);
        player.setAttribute(DISGUISE_ATTRIBUTE, true);
        return (
          play(player, CAMELOT_ARTHUR_ID, "infiltrating-the-black-knights-fortress-again-talking-to-king-arthur-with-a-spare-disguise") || true
        );
      }
      return (
        play(player, CAMELOT_ARTHUR_ID, "infiltrating-the-black-knights-fortress-again-talking-to-king-arthur-without-a-guard-disguise") || true
      );
    }
    if (stage >= STAGE_COMPLETE) {
      return play(player, CAMELOT_ARTHUR_ID, "post-quest-dialogue-talking-to-king-arthur-after-the-quest") || true;
    }
    if (stage === STAGE_FREED_ARTHUR) {
      if (disguiseGiven(player)) {
        return play(player, CAMELOT_ARTHUR_ID, "back-at-the-round-table-talking-to-king-arthur") || true;
      }
      return (
        play(player, CAMELOT_ARTHUR_ID, "infiltrating-the-black-knights-fortress-again-talking-to-king-arthur-without-a-guard-disguise") || true
      );
    }
    return false;
  }

  function talkCromperty(player, npcId, stage) {
    if (stage >= STAGE_COMPLETE) return false;
    if (stage < STAGE_GRAIL) return false;
    if (stage < STAGE_CROMPERTY) {
      play(player, npcId, "the-king-in-the-stone-talking-to-wizard-cromperty");
      quest.setStage(player, STAGE_CROMPERTY);
      return true;
    }
    return play(player, npcId, "the-king-in-the-stone-talking-to-wizard-cromperty-again") || true;
  }

  function talkJailKnight(player, npcId, stage) {
    const name = JAIL_KNIGHT_IDS.get(npcId);
    if (!name || stage < STAGE_JAIL) return false;
    if (stage < STAGE_MERLIN_BRIEFED) {
      return play(player, npcId, `the-round-tables-have-turned-talking-to-the-knights-before-talking-to-merlin-sir-${name}`) || true;
    }
    if (stage < STAGE_MERLIN_ESCAPED) {
      return play(player, npcId, `the-round-tables-have-turned-talking-to-the-knights-after-talking-to-merlin-sir-${name}`) || true;
    }
    if (stage < STAGE_CELL_OPEN) {
      return play(player, npcId, `the-round-tables-have-turned-talking-to-the-knights-after-rescuing-merlin-sir-${name}`) || true;
    }
    return false;
  }

  function talkKeepKnight(player, npcId, stage) {
    const name = KEEP_KNIGHT_IDS.get(npcId);
    if (!name) return false;
    if (stage < STAGE_CELL_OPEN || stage >= STAGE_COMPLETE) return false;
    if (!inBounds(player.getLocation(), KEEP_BOUNDS)) return false;
    return play(player, npcId, `prison-break-talking-to-knights-sir-${name}`) || true;
  }

  function talkProsecutor(player, npcId, stage) {
    if (stage < STAGE_ATTORNEY) return false;
    if (stage < STAGE_VERDICT) {
      if (rebuttals(player) === REBUTTAL_ALL) {
        spawnTrialAnna(player);
        return play(player, npcId, "trials-and-tribulations-after-successfully-disproving-all-four-evidences") || true;
      }
      return play(player, npcId, "trials-and-tribulations-the-court-is-in-session") || true;
    }
    if (stage < STAGE_COMPLETE) {
      return play(player, npcId, "trials-and-tribulations-talking-to-prosecutor-after-the-case-is-over") || true;
    }
    return false;
  }

  function talkSquire(player, npcId, stage) {
    if (stage < STAGE_COMPLETE) return false;
    return play(player, npcId, "post-quest-dialogue-talking-to-squire") || true;
  }

  function handleNpcTalk(event) {
    const { player, npcId, clickType } = event;
    const option = event.definition?.getActions?.()?.[clickType - 1];
    if (option !== "Talk-to") return;
    const stage = stageOf(player);

    if (npcId === GOSSIP_ID) {
      if (talkGossip(player, npcId, stage)) event.handled = true;
      return;
    }
    if (npcId === MANSION_GUARD_ID) {
      // Murder Mystery's start/finish dialogue runs on this guard; leave it
      // unhandled until that quest is complete so its registered branch wins.
      if (!isQuestComplete(player, "murder_mystery")) return;
      if (talkMansionGuard(player, npcId, stage)) event.handled = true;
      return;
    }
    if (ANNA_IDS.has(npcId)) {
      if (talkAnna(player, npcId, stage)) event.handled = true;
      return;
    }
    if (npcId === JAIL_MERLIN_ID || npcId === CAMELOT_MERLIN_ID || npcId === CAMELOT_MERLIN_2_ID) {
      if (talkMerlin(player, stage, inBounds(event.location, JAIL_BOUNDS))) event.handled = true;
      return;
    }
    if (npcId === BASEMENT_ARTHUR_ID || CAMELOT_ARTHUR_IDS.has(npcId)) {
      if (talkArthur(player, stage, inBounds(event.location, BKF_BASEMENT_BOUNDS))) event.handled = true;
      return;
    }
    if (CROMPERTY_IDS.has(npcId)) {
      if (talkCromperty(player, npcId, stage)) event.handled = true;
      return;
    }
    if (JAIL_KNIGHT_IDS.has(npcId)) {
      if (talkJailKnight(player, npcId, stage)) event.handled = true;
      return;
    }
    if (KEEP_KNIGHT_IDS.has(npcId)) {
      if (talkKeepKnight(player, npcId, stage)) event.handled = true;
      return;
    }
    if (npcId === PROSECUTOR_ID) {
      if (talkProsecutor(player, npcId, stage)) event.handled = true;
      return;
    }
    if (npcId === SQUIRE_ID) {
      if (talkSquire(player, npcId, stage)) event.handled = true;
      return;
    }
    const fragment = SERVANT_FRAGMENTS.get(npcId);
    if (fragment) {
      const variant = servantVariant(stage, fragment, npcId);
      if (variant) {
        play(player, npcId, variant);
        event.handled = true;
      }
      return;
    }
    if (npcId === COURT_GUARD_1_ID || npcId === COURT_GUARD_2_ID) {
      if (stage < STAGE_HISTORY_LEARNED || stage >= STAGE_COMPLETE) return;
      const which = npcId === COURT_GUARD_1_ID ? 1 : 2;
      play(player, npcId, `devil-s-advocate-talking-to-guard-${which}-at-the-courthouse`);
      event.handled = true;
    }
  }

  // ==========================================================================
  // Object interactions
  // ==========================================================================

  function handleWindow(player, option, stage) {
    if (option === "Investigate") {
      if (stage < STAGE_STARTED) return;
      play(player, MANSION_GUARD_ID, "peril-at-the-end-house-investigating-the-smashed-window");
      return true;
    }
    if (option !== "Break") return;
    if (stage < STAGE_STARTED) return;
    if (stage < STAGE_INVESTIGATE) {
      play(player, MANSION_GUARD_ID, "peril-at-the-end-house-trying-to-break-in-without-a-permission");
      return true;
    }
    ensureScrapPaper(player);
    crossObject(player, WINDOW_TILE);
    return true;
  }

  function handleBookcase(player, option, stage) {
    if (option !== "Search" || stage < STAGE_INVESTIGATE || stage >= STAGE_EVIDENCE_SHOWN) return;
    if (hasItem(player, BLACK_KNIGHT_HELM_ITEM)) {
      play(player, MANSION_GUARD_ID, "breaking-and-entering-searching-the-bookcase-after-finding-the-helmet");
    } else {
      play(player, MANSION_GUARD_ID, "breaking-and-entering-searching-the-bookcase");
    }
    return true;
  }

  function handleCamelotStatue(player, option, stage) {
    if (option !== "Search") return;
    if (stage === STAGE_STATUE) {
      play(player, NpcIdentifiers.MORGAN_LE_FAYE, "in-justice-has-prevailed-searching-the-statue-near-camelot-castle");
      return true;
    }
    if (stage > STAGE_STATUE && stage < STAGE_CELL_OPEN) {
      player.moveTo(JAIL_TILE);
      return true;
    }
    return;
  }

  function handleVent(player, option, stage) {
    if (option !== "Reach") return;
    if (stage >= STAGE_MERLIN_BRIEFED && stage < STAGE_MERLIN_ESCAPED) {
      play(player, NpcIdentifiers.SIR_KAY_3, "the-round-tables-have-turned-talking-to-the-knights-after-talking-to-merlin-reaching-for-the-vent");
      if (stage < STAGE_MERLIN_ESCAPED) quest.setStage(player, STAGE_MERLIN_ESCAPED);
      return true;
    }
    if (stage >= STAGE_MERLIN_ESCAPED && stage < STAGE_CELL_OPEN) {
      play(player, NpcIdentifiers.SIR_KAY_3, "the-round-tables-have-turned-venting-out-after-rescuing-merlin");
      player.moveTo(VENT_EXIT_TILE);
      return true;
    }
    return;
  }

  function hasLockpick(player) {
    for (const itemId of LOCKPICK_ITEMS) {
      if (hasItem(player, itemId)) return true;
    }
    return false;
  }

  function handleCellDoor(player, option, stage) {
    if (option !== "Open") return;
    if (stage < STAGE_JAIL || stage >= STAGE_CELL_OPEN) return;
    if (hasItem(player, HAIR_CLIP_ITEM) || hasLockpick(player)) {
      play(player, NpcIdentifiers.SIR_KAY_3, "the-round-tables-have-turned-successfully-picking-the-lock");
      crossObject(player, CELL_DOOR_TILE);
      quest.setStage(player, STAGE_CELL_OPEN);
      return true;
    }
    play(player, NpcIdentifiers.SIR_KAY_3, "the-round-tables-have-turned-trying-to-open-the-doors-without-a-lockpick");
    return true;
  }

  function handleCellDoorToggle(request) {
    const { player, objectId, location } = request;
    if (request.handled || !player || objectId !== JAIL_CELL_DOOR_ID) return;
    if (location?.x !== CELL_DOOR_TILE.x || location?.y !== CELL_DOOR_TILE.y) return;
    const stage = stageOf(player);
    if (stage < STAGE_JAIL || stage >= STAGE_CELL_OPEN) return;
    request.handled = true;
    handleCellDoor(player, "Open", stage);
  }

  function handleGrailTable(player, option, stage) {
    if (option !== "Search" || stage < STAGE_CELL_OPEN || stage >= STAGE_COMPLETE) return;
    if (hasItem(player, HOLY_GRAIL_ITEM)) {
      if (stage < STAGE_GRAIL) {
        quest.setStage(player, STAGE_GRAIL);
        return true;
      }
      play(player, NpcIdentifiers.MERLIN, "prison-break-opening-the-grail-box-for-another-grail");
      return true;
    }
    openGrailRiddle(player);
    return true;
  }

  function handleJudge(player, option, stage) {
    if (option !== "Talk-to") return;
    if (stage >= STAGE_ATTORNEY && stage < STAGE_VERDICT) {
      if (rebuttals(player) === REBUTTAL_ALL) {
        spawnTrialAnna(player);
        play(player, PROSECUTOR_ID, "trials-and-tribulations-after-successfully-disproving-all-four-evidences");
        return true;
      }
      play(player, PROSECUTOR_ID, "trials-and-tribulations-the-court-is-in-session");
      return true;
    }
    if (stage >= STAGE_VERDICT && stage < STAGE_COMPLETE) {
      play(player, PROSECUTOR_ID, "trials-and-tribulations-talking-to-judge-after-the-case-is-over");
      return true;
    }
    return;
  }

  function handleJudgeRoute(event) {
    if (event.objectId !== COURT_JUDGE_ID) return;
    const option = event.definition?.getInteractions?.()?.[event.clickType - 1];
    if (option !== "Talk-to") return;
    const stage = stageOf(event.player);
    if (stage < STAGE_ATTORNEY || stage >= STAGE_COMPLETE) return;
    event.destination = { ...event.sourceLocation };
  }

  function handleObjectInteraction(event) {
    const { player, objectId, location } = event;
    const stage = stageOf(player);
    const option = event.definition?.getActions?.()?.[event.clickType - 1];

    if (objectId === WINDOW_OBJECT_ID) {
      if (handleWindow(player, option, stage)) event.handled = true;
      return;
    }
    if (objectId === SINCLAIR_BOOKCASE_ID) {
      if (handleBookcase(player, option, stage)) event.handled = true;
      return;
    }
    if (objectId === CAMELOT_STATUE_ID) {
      if (handleCamelotStatue(player, option, stage)) event.handled = true;
      return;
    }
    if (objectId === JAIL_VENT_ID) {
      if (handleVent(player, option, stage)) event.handled = true;
      return;
    }
    if (
      objectId === JAIL_CELL_DOOR_ID &&
      location?.x === CELL_DOOR_TILE.x &&
      location?.y === CELL_DOOR_TILE.y
    ) {
      if (handleCellDoor(player, option, stage)) event.handled = true;
      return;
    }
    if (objectId === GRAIL_TABLE_ID) {
      if (handleGrailTable(player, option, stage)) event.handled = true;
      return;
    }
    if (objectId === COURT_JUDGE_ID) {
      if (handleJudge(player, option, stage)) event.handled = true;
      return;
    }
    if (objectId === COURT_GATE_ID) {
      if (option !== "Exit") return;
      removeTrialAnna(player);
      player.moveTo(COURT_RETURN_TILE);
      event.handled = true;
      return;
    }
    if (ARTHUR_STATUE_IDS.has(objectId)) {
      if (option !== "Free") return;
      if (freeArthur(player)) event.handled = true;
      return;
    }
    if (CAMELOT_GATE_IDS.has(objectId) || SINCLAIR_GATE_IDS.has(objectId)) {
      if (stage <= STAGE_STATUE || stage >= STAGE_CELL_OPEN) return;
      player.moveTo(JAIL_TILE);
      event.handled = true;
    }
  }

  // ==========================================================================
  // Grail riddle
  // ==========================================================================

  function openGrailRiddle(player) {
    const boxChoice = (box) => ({
      text: `Box ${box}`,
      echo: false,
      next: [{ exec: () => chooseBox(player, box) }],
    });
    startDialogue(api, player, { npcId: NpcIdentifiers.MERLIN }, [
      { npc: RIDDLE_LINES },
      {
        title: "Which box holds the Holy Grail?",
        options: [
          boxChoice(1),
          boxChoice(2),
          boxChoice(3),
          boxChoice(4),
          {
            text: "More...",
            echo: false,
            next: [
              {
                title: "Which box holds the Holy Grail?",
                options: [
                  boxChoice(5),
                  boxChoice(6),
                  boxChoice(7),
                  boxChoice(8),
                  {
                    text: "More...",
                    echo: false,
                    next: [
                      {
                        title: "Which box holds the Holy Grail?",
                        options: [boxChoice(9), { text: "Never mind", echo: false, next: [] }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);
  }

  function chooseBox(player, box) {
    if (stageOf(player) < STAGE_CELL_OPEN) return;
    if (box === 8) {
      play(player, NpcIdentifiers.MERLIN, "prison-break-solving-the-riddle-and-finding-the-grail");
      return;
    }
    play(player, NpcIdentifiers.MERLIN, "prison-break-booby-trapped-box");
    player.getCombat().getHitQueue().addPendingDamage([new HitDamage(5, HitMask.RED)]);
    player.moveTo(ARDOUGNE_CAVE_TILE);
  }

  // ==========================================================================
  // Arthur, the disguise and the fortress basement
  // ==========================================================================

  function freeArthur(player) {
    const stage = stageOf(player);
    if (stage < STAGE_CROMPERTY || stage >= STAGE_FREED_ARTHUR) return false;
    if (!hasItem(player, ANIMATE_ROCK_SCROLL_ITEM) || !hasItem(player, HOLY_GRAIL_ITEM) || !hasGranite(player)) {
      play(player, CAMELOT_ARTHUR_ID, "infiltrating-the-black-knights-fortress-again-trying-to-free-king-arthur-without-all-the-items");
      return true;
    }
    startDialogue(api, player, { npcId: CAMELOT_ARTHUR_ID }, [
      { npc: ["Thank you! I was afraid that would be the end of me."] },
      {
        player: [
          "There's no time to explain; we need to get you out of here before the Black Knights notice. I'll find you a guard disguise.",
        ],
      },
      { npc: ["Very well. I shall await you here."] },
    ]);
    quest.setStage(player, STAGE_FREED_ARTHUR);
    return true;
  }

  function handleLadderClaim(request) {
    const { player, objectId } = request;
    if (!player || objectId !== BKF_BASEMENT_LADDER_DOWN_ID && objectId !== BKF_BASEMENT_LADDER_UP_ID) return;
    const stage = stageOf(player);
    if (objectId === BKF_BASEMENT_LADDER_UP_ID || inBounds(player.getLocation(), BKF_BASEMENT_BOUNDS)) {
      request.handled = true;
      player.moveTo(BKF_SECRET_ROOM_TILE);
      return;
    }
    if (stage >= STAGE_FREED_ARTHUR && stage < STAGE_COMPLETE) {
      play(player, CAMELOT_ARTHUR_ID, "infiltrating-the-black-knights-fortress-again-trying-to-climb-down-ladder-after-rescuing-arthur");
      request.handled = true;
      player.moveTo(BKF_BASEMENT_TILE);
      return;
    }
    if (stage >= STAGE_CROMPERTY && stage < STAGE_FREED_ARTHUR && !wearingBlackArmour(player)) {
      play(
        player,
        NpcIdentifiers.BLACK_KNIGHT,
        "infiltrating-the-black-knights-fortress-again-attempting-to-push-the-wall-on-the-ground-floor-without-wearing-black-armour"
      );
      request.handled = true;
      return;
    }
    request.handled = true;
    player.moveTo(BKF_BASEMENT_TILE);
  }

  // ==========================================================================
  // Trial entry from the courthouse stairs (via ladders:climb)
  // ==========================================================================

  function handleStairsClaim(request) {
    if (request.objectId !== COURT_STAIRS_ID) return;
    const stage = stageOf(request.player);
    if (stage < STAGE_ATTORNEY || stage >= STAGE_VERDICT) return;
    request.handled = true;
    play(request.player, COURT_GUARD_1_ID, "trials-and-tribulations-climbing-down-the-stairs");
  }

  /**
   * The Camelot gates are handled by Doors.plugin, which asks quests through
   * door:toggle first; while Morgan holds the player, using them sends the
   * player back to the cell (the wiki's catch-all re-entry).
   */
  function handleGateToggleClaim(request) {
    const { player, objectId } = request;
    if (!player || !CAMELOT_GATE_IDS.has(objectId)) return;
    const stage = stageOf(player);
    if (stage <= STAGE_STATUE || stage >= STAGE_CELL_OPEN) return;
    request.handled = true;
    player.moveTo(JAIL_TILE);
  }

  // ==========================================================================
  // Items
  // ==========================================================================

  function handleItemAction(event) {
    const { player, itemId, option } = event;
    if (itemId === ANTIQUE_LAMP_ITEM && option === "Rub") {
      event.handled = true;
      api.emitCustomEvent("xpreward:open", {
        player,
        minLevel: LAMP_MIN_LEVEL,
        title: "Choose the stat you wish to be advanced!",
        onConfirm: (skill, name) => {
          player.getSkillManager().addExperience(skill, LAMP_XP, false);
          player.getInventory().deleteNumber(ANTIQUE_LAMP_ITEM, 1);
          return `You rub the lamp and feel your ${name} skill advance.`;
        },
      });
    }
  }

  function handleItemOnObject(event) {
    const { player, itemId } = event;
    if (ARTHUR_STATUE_IDS.has(event.objectId) && itemId === ANIMATE_ROCK_SCROLL_ITEM) {
      if (freeArthur(player)) event.handled = true;
      return;
    }
    const onCellDoor =
      event.objectId === JAIL_CELL_DOOR_ID &&
      event.location?.x === CELL_DOOR_TILE.x &&
      event.location?.y === CELL_DOOR_TILE.y;
    if (onCellDoor && (LOCKPICK_ITEMS.has(itemId) || itemId === HAIR_CLIP_ITEM)) {
      if (handleCellDoor(player, "Open", stageOf(player))) event.handled = true;
    }
  }

  // ==========================================================================
  // Login / logout
  // ==========================================================================

  function handleLogin({ player }) {
    ensureScrapPaper(player);
    refreshQuestList(player);
  }

  function handleLogout({ player }) {
    removeTrialAnna(player);
  }

  // ==========================================================================
  // Journal and rewards
  // ==========================================================================

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I gathered evidence that the Sinclairs had left for Camelot.</str>",
        "<str>I cleared Anna Sinclair of Lord Sinclair's murder.</str>",
        "<str>Merlin and the knights freed me, and I recovered the Holy Grail.</str>",
        "<str>I freed King Arthur from Morgan Le Faye's spell.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_FREED_ARTHUR) {
      return [
        "<str>King Arthur is free of the statue.</str>",
        "Give him a <col=800000>bronze med helm</col> and an",
        "<col=800000>iron chainbody</col>, then meet him at Camelot.",
      ];
    }
    if (stage >= STAGE_CROMPERTY) {
      return [
        "<str>Wizard Cromperty explained how to free King Arthur.</str>",
        "Take the <col=800000>animate rock scroll</col>, the",
        "<col=800000>Holy Grail</col> and <col=800000>granite</col> to his statue,",
        "wearing full <col=800000>black armour</col> to get to it.",
      ];
    }
    if (stage >= STAGE_GRAIL) {
      return [
        "<str>I took the Holy Grail from the box on the table.</str>",
        "Speak to <col=800000>Wizard Cromperty</col> in East Ardougne.",
      ];
    }
    if (stage >= STAGE_CELL_OPEN) {
      return [
        "<str>I escaped the cell and the knights fight the guards.</str>",
        "Climb to the top of <col=800000>Keep Le Faye</col> and search the",
        "<col=800000>table</col> for the Holy Grail.",
      ];
    }
    if (stage >= STAGE_MERLIN_ESCAPED) {
      return [
        "<str>Merlin escaped through the vent.</str>",
        "Talk to the knights for a lockpick, then unlock the cell door.",
      ];
    }
    if (stage >= STAGE_MERLIN_BRIEFED) {
      return [
        "<str>Merlin explained Morgan Le Faye's plan.</str>",
        "Reach for the <col=800000>vent</col> in the cell wall.",
      ];
    }
    if (stage >= STAGE_JAIL) {
      return [
        "<str>Morgan Le Faye captured me at the Camelot statue.</str>",
        "Speak to <col=800000>Merlin</col> in the cell.",
      ];
    }
    if (stage >= STAGE_STATUE) {
      return [
        "<str>Anna told me about the statue behind Camelot.</str>",
        "Search the <col=800000>statue</col> east of Camelot.",
      ];
    }
    if (stage >= STAGE_VERDICT) {
      return [
        "<str>The jury found Anna not guilty.</str>",
        "Speak to Anna, then meet her in her cell.",
      ];
    }
    if (stage >= STAGE_ATTORNEY) {
      return [
        "<str>Anna made a deal: clear her name and she reveals Camelot.</str>",
        "Ask the servants about the dagger, thread, poison and the",
        "night of the murder, then start the trial at the courthouse.",
      ];
    }
    if (stage >= STAGE_ANNA_MET) {
      return [
        "<str>Anna says the evidence was forged and the murderer was framed.</str>",
        "Agree to be her defence lawyer.",
      ];
    }
    if (stage >= STAGE_HISTORY_LEARNED) {
      return [
        "<str>Gossip told me the Sinclair family history.</str>",
        "Speak to <col=800000>Anna</col> at the Seers' Village courthouse.",
      ];
    }
    if (stage >= STAGE_EVIDENCE_SHOWN) {
      return [
        "<str>The guard accepted the three pieces of evidence.</str>",
        "Ask <col=800000>Gossip</col> about the family, the mansion and Anna.",
      ];
    }
    if (stage >= STAGE_INVESTIGATE) {
      return [
        "<str>The guard asked me to break into the Sinclair Mansion.</str>",
        "Break the east <col=800000>window</col>, then take the",
        "<col=800000>scrap paper</col> and <col=800000>address form</col> and",
        "search the west <col=800000>bookcase</col> in the library.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return ["<str>Gossip told me the Sinclairs vanished with King Arthur.</str>", "Speak to the guard by the mansion."];
    }
    return [
      "I can start this quest by talking to <col=800000>Gossip</col>",
      "outside the <col=800000>Sinclair Mansion</col>.",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.DEFENCE, 33000);
    player.getSkillManager().addExperiences(Skill.MAGIC, 5000);
  }

  // ==========================================================================
  // Registration
  // ==========================================================================

  api.persistAttribute(EVIDENCE_ATTRIBUTE);
  api.persistAttribute(HISTORY_ATTRIBUTE);
  api.persistAttribute(REBUTTAL_ATTRIBUTE);
  api.persistAttribute(HANDOUT_ATTRIBUTE);
  api.persistAttribute(DISGUISE_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "kings_ransom",
    name: "King's Ransom",
    varpId: 1049,
    varbitId: VARBIT_STAGE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [
      { skillId: Skill.DEFENCE.getIndex(), amount: 33000, label: "Defence" },
      { skillId: Skill.MAGIC.getIndex(), amount: 5000, label: "Magic" },
    ],
    rewardItemId: ANTIQUE_LAMP_ITEM,
    rewardItemLabel: "Antique lamp (5,000 XP in any skill over 50)",
    otherRewards: ["Access to the Knight Waves training grounds"],
    buildJournal,
    onReward: grantReward,
  });

  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onNpcInteraction(handleNpcTalk);
  api.onObjectInteraction(handleObjectInteraction);
  api.onObjectRoute(handleJudgeRoute);
  api.onItemOnObject(handleItemOnObject);
  api.onItemAction(handleItemAction);
  api.onCustomEvent("ladders:climb", handleStairsClaim);
  api.onCustomEvent("ladders:climb", handleLadderClaim);
  api.onCustomEvent("door:toggle", handleGateToggleClaim);
  api.onCustomEvent("door:toggle", handleCellDoorToggle);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
