/**
 * Recruitment Drive (members).
 *
 * The words come from the "Recruitment Drive" transcript page (npc-dialogues.json);
 * this plugin supplies the variant selector for Sir Amik Varze (4771, shared with
 * Black Knights' Fortress), Sir Tiffy Cashien (4687) and the five test observers,
 * the prose-condition answers, the per-room state machines for the five tests the
 * shortlist scopes (Sir Ren Itchood, Ms. Hynn Terprett, Lady Table, Sir Tinley and
 * Sir Kuam Ferentse) and the completion reward.
 *
 * Stages (varbit 657, rd_main, in varp 496, recruitmentdrive):
 *   0 not started, 1 recommended by Sir Amik (meet Sir Tiffy),
 *   2 being tested (also the state after quitting or failing a room),
 *   3 all five tests passed (return to Sir Tiffy), 4 complete.
 * Per-room progress lives in the persisted "quest.recruitment-drive.*"
 * attributes (tests bitmask + per-room state).
 *
 * Source: OSRS Wiki "Recruitment Drive" and "Transcript:Recruitment Drive".
 * Rewards per the Wiki: 1 Quest point, 1,000.5 Prayer/Herblore/Agility XP,
 * 3,000 coins and a free initiate sallet (initiate armour shop stock is a gap).
 *
 * Gaps / approximations:
 *   - Requirements are the wiki page's: Black Knights' Fortress + Druidic Ritual
 *     (the 12 Quest Points some wiki tables list is not used).
 *   - OSRS picks 5 of 7 rooms at random and always includes Sir Kuam Ferentse.
 *     This implements the five shortlisted rooms as a fixed course (Ren, Hynn,
 *     Table, Tinley, Kuam); Miss Cheevers and Sir Spishyus are not implemented.
 *   - The rooms share one map with no private instances, so a second player can
 *     physically open/see the same doors; test state itself is per player.
 *   - Sir Ren's "combination lock" is a five-option word prompt: the assigned
 *     word plus four decoys (OSRS's actual answer-entry UI is not in the
 *     transcript). No necklace item exists in the quest's item list or transcript.
 *   - Ms. Hynn Terprett's numeric-input riddles 1 and 2 are replaced by a four
 *     option chatbox prompt (the dialogue runtime has no input step); riddles 3-5
 *     use the transcript's own menus.
 *   - Sir Tinley counts attacks/movement clicks only through NPC and object
 *     interactions (his room's door included), and auto-plays his "excellent
 *     work" line after ~10s idle.
 *   - Sir Kuam's death check is the Wiki rule: a steel sword/claws/battleaxe in
 *     the weapon slot fails, the steel warhammer or unarmed passes. The four
 *     weapons are laid out as owner-only ground items at the room's tables.
 *   - Failed/quit attempts reset the room bits and return the player to Sir
 *     Tiffy, who plays the Wiki failure lines on the next conversation.
 */
module.exports = function registerRecruitmentDriveQuest(api) {
  const { Equipment, Item, ItemIdentifiers, Location, NpcIdentifiers, ObjectIdentifiers, Skill } =
    api.core;
  const { refreshQuestList, registerQuest, startTranscript, loadTranscripts } = require("../QuestRuntime");

  const PAGE = "Recruitment Drive";
  const VARBIT_RECRUITMENT_DRIVE = 657; // rd_main; preserve the statue layout in sibling bit 658
  const BLOCKED_KNIGHTS_QUEST_KEY = "black_knights_fortress";
  const DRUIDIC_RITUAL_QUEST_KEY = "druidic_ritual";

  const STAGE_STARTED = 1;
  const STAGE_TESTING = 2;
  const STAGE_RETURN = 3;
  const STAGE_COMPLETE = 4;

  const SIR_AMIK_VARZE_NPC_ID = NpcIdentifiers.SIR_AMIK_VARZE_4; // 4771, White Knights' Castle
  const SIR_TIFFY_CASHIEN_NPC_ID = NpcIdentifiers.SIR_TIFFY_CASHIEN; // 4687, Falador Park
  const SIR_REN_ITCHOOD_NPC_ID = NpcIdentifiers.SIR_REN_ITCHOOD; // 4684
  const MS_HYNN_TERPRETT_NPC_ID = NpcIdentifiers.MS_HYNN_TERPRETT; // 4686
  const LADY_TABLE_NPC_ID = NpcIdentifiers.LADY_TABLE; // 4680
  const SIR_TINLEY_NPC_ID = NpcIdentifiers.SIR_TINLEY; // 4683
  const SIR_KUAM_FERENTSE_NPC_ID = NpcIdentifiers.SIR_KUAM_FERENTSE; // 4681
  const SIR_LEYE_NPC_ID = NpcIdentifiers.SIR_LEYE; // 4682

  const TEST_BIT_REN = 1 << 0;
  const TEST_BIT_HYNN = 1 << 1;
  const TEST_BIT_TABLE = 1 << 2;
  const TEST_BIT_TINLEY = 1 << 3;
  const TEST_BIT_KUAM = 1 << 4;

  const TESTS_ATTRIBUTE = "quest.recruitment-drive.tests";
  const WORD_ATTRIBUTE = "quest.recruitment-drive.word";
  const REN_CLUES_ATTRIBUTE = "quest.recruitment-drive.ren-clues";
  const RIDDLE_ATTRIBUTE = "quest.recruitment-drive.riddle";
  const TABLE_STATE_ATTRIBUTE = "quest.recruitment-drive.table-state";
  const TABLE_LAYOUT_ATTRIBUTE = "recruitment-drive:statue-layout";
  const TINLEY_STATE_ATTRIBUTE = "quest.recruitment-drive.tinley-state";

  const FALADOR_TILE = { x: 2998, y: 3373, z: 0 };
  const GROUNDS = { minX: 2430, maxX: 2510, minY: 4920, maxY: 5000 };
  const TABLE_WAIT_TICKS = 17; // ~10 game seconds
  const TINLEY_WAIT_TICKS = 17; // ~10 game seconds

  const ROOMS = [
    {
      key: "ren",
      label: "Sir Ren Itchood's riddle",
      bit: TEST_BIT_REN,
      npcId: SIR_REN_ITCHOOD_NPC_ID,
      doorId: ObjectIdentifiers.DOOR_195, // 7323
      entryPortalId: ObjectIdentifiers.PORTAL_23, // 7321
      exitPortalId: ObjectIdentifiers.PORTAL_24, // 7322
      landing: { x: 2444, y: 4956, z: 0 },
    },
    {
      key: "hynn",
      label: "Ms. Hynn Terprett's riddles",
      bit: TEST_BIT_HYNN,
      npcId: MS_HYNN_TERPRETT_NPC_ID,
      doorId: ObjectIdentifiers.DOOR_197, // 7354
      entryPortalId: ObjectIdentifiers.PORTAL_27, // 7352
      exitPortalId: ObjectIdentifiers.PORTAL_28, // 7353
      landing: { x: 2450, y: 4939, z: 0 },
    },
    {
      key: "table",
      label: "Lady Table's statues",
      bit: TEST_BIT_TABLE,
      npcId: LADY_TABLE_NPC_ID,
      doorId: ObjectIdentifiers.DOOR_192, // 7302
      entryPortalId: ObjectIdentifiers.PORTAL_17, // 7288
      exitPortalId: ObjectIdentifiers.PORTAL_18, // 7289
      landing: { x: 2457, y: 4981, z: 0 },
    },
    {
      key: "tinley",
      label: "Sir Tinley's patience",
      bit: TEST_BIT_TINLEY,
      npcId: SIR_TINLEY_NPC_ID,
      doorId: ObjectIdentifiers.DOOR_194, // 7320
      entryPortalId: ObjectIdentifiers.PORTAL_21, // 7318
      exitPortalId: ObjectIdentifiers.PORTAL_22, // 7319
      landing: { x: 2475, y: 4958, z: 0 },
    },
    {
      key: "kuam",
      label: "Sir Kuam Ferentse's combat test",
      bit: TEST_BIT_KUAM,
      npcId: SIR_KUAM_FERENTSE_NPC_ID,
      doorId: ObjectIdentifiers.DOOR_193, // 7317
      entryPortalId: ObjectIdentifiers.PORTAL_19, // 7315
      exitPortalId: ObjectIdentifiers.PORTAL_20, // 7316
      landing: { x: 2458, y: 4966, z: 0 },
    },
  ];
  const ROOM_BY_KEY = new Map(ROOMS.map((room) => [room.key, room]));
  const ROOM_BY_DOOR = new Map(ROOMS.map((room) => [room.doorId, room]));
  const ROOM_BY_PORTAL = new Map(
    ROOMS.flatMap((room) => [
      [room.entryPortalId, room],
      [room.exitPortalId, room],
    ])
  );
  const ENTRY_PORTALS = new Set(ROOMS.map((room) => room.entryPortalId));

  const REN_WORDS = ["Bite", "Time", "Fish", "Meat", "Last", "Rain"];
  const REN_WORD_CONDITION_IDS = [
    ["Lcr4_8", "LgNNqJ", "QKLW3b", "pY2LFM", "RHR_7Q", "Cw4TJj"],
    ["mSbRBW", "Is77SA", "5_H_K_", "biWU_y", "Lh8PMl", "OZ2kJM"],
    ["H3nHTW", "mK3Jo7", "_YALpO", "7UhaJw", "wrry80", "byUNkj"],
  ];
  const REN_WORD_CONDITION_INDEX = new Map();
  REN_WORD_CONDITION_IDS.forEach((ids, clue) => {
    ids.forEach((id, word) => REN_WORD_CONDITION_INDEX.set(id, { clue, word }));
  });

  const HYNN_RIDDLE_CONDITION_IDS = ["I6CCMw", "JkOLon", "PesVic", "HUY9QS", "MrB8X8"];
  const HYNN_RIDDLE_INDEX = new Map(HYNN_RIDDLE_CONDITION_IDS.map((id, index) => [id, index]));
  const HYNN_RIDDLES = [
    { inputStepId: "WJmb2X", correct: "0", options: ["0", "250,000", "500,000", "1,000,000"] },
    { inputStepId: "v3xp4c", correct: "10", options: ["5", "10", "15", "20"] },
    { correct: "The number of false statements here is three." },
    { correct: "The wolves." },
    { correct: "Bucket A (32 degrees)" },
  ];

  const TABLE_LAYOUT_VARBIT = 658; // rd_room_order: the twelve placed rd_statue_multi locs
  const TABLE_FIRST_LOC_ID = 7290;
  const TABLE_STATUE_COUNT = 12;
  const TABLE_LINE_TICKS = 3;
  const TABLE_FADE_TICKS = 2;
  const FADE_UID = (161 << 16) | 1;
  const FADE_INTERFACE = 174;
  const FADE_SCRIPT = 948;
  const tableAttempts = new Map();

  const KUAM_VICTORY_CONDITION_IDS = ["DBOLHO", "crzBa_", "d7FuHu"];
  const LEYE_WEAPON_ITEM_IDS = [
    ItemIdentifiers.STEEL_SWORD, // 1281
    ItemIdentifiers.STEEL_CLAWS, // 3097
    ItemIdentifiers.STEEL_BATTLEAXE, // 1365
    ItemIdentifiers.STEEL_WARHAMMER, // 1339
  ];
  const BLADED_WEAPON_ITEM_IDS = new Set([
    ItemIdentifiers.STEEL_SWORD,
    ItemIdentifiers.STEEL_CLAWS,
    ItemIdentifiers.STEEL_BATTLEAXE,
  ]);
  const KUAM_WEAPON_TILES = [
    { x: 2456, y: 4962, z: 0 },
    { x: 2458, y: 4962, z: 0 },
    { x: 2460, y: 4962, z: 0 },
    { x: 2462, y: 4962, z: 0 },
  ];

  const START_HOOK = "quest:recruitment-drive:start";

  const V_AMIK_START = "starting-out-talking-to-sir-amik-varze";
  const V_AMIK_AGAIN = "starting-out-talking-to-sir-amik-varze-talking-to-sir-amik-varze-again";
  const V_TIFFY_AFTER_START = "starting-out-talking-to-sir-tiffy-cashien-after-starting-the-quest";
  const V_TIFFY_FAIL = "the-tests-upon-failing-a-test";
  const V_TIFFY_RETRY = "the-tests-talking-to-sir-tiffy-cashien-after-attempting-the-tests-once";
  const V_TIFFY_FINISH = "finishing-up";
  const V_REN_ENTER = "the-tests-sir-ren-itchood-entering-the-room";
  const V_REN_SECOND = "the-tests-sir-ren-itchood-talking-to-sir-ren-itchood-after-getting-the-second-clue";
  const V_REN_DOOR = "the-tests-sir-ren-itchood-entering-the-combination-lock-door";
  const V_HYNN_ENTER = "the-tests-ms-hynn-terprett-entering-the-room";
  const V_TABLE_ENTER = "the-tests-lady-table-entering-the-room";
  const V_TABLE_AFTER = "the-tests-lady-table-after-waiting-10-seconds";
  const V_TABLE_TALK = "the-tests-lady-table-talking-to-lady-table-after-the-statues-have-shuffled";
  const V_TABLE_TOUCH = "the-tests-lady-table-touching-a-statue";
  const V_TINLEY_ENTER = "the-tests-sir-tinley-entering-the-room";
  const V_TINLEY_TALK = "the-tests-sir-tinley-talking-to-sir-tinley";
  const V_TINLEY_FAIL = "the-tests-sir-tinley-interacting-with-anything-before-completing-the-challenge";
  const V_TINLEY_DONE = "the-tests-sir-tinley-after-completing-the-challenge";
  const V_KUAM_ENTER = "the-tests-sir-kuam-ferentse-entering-the-room";
  const V_KUAM_LEYE = "the-tests-sir-kuam-ferentse-talking-to-sir-leye";
  const V_KUAM_DEFEAT = "the-tests-sir-kuam-ferentse-defeating-sir-leye";

  let quest;

  /** Player -> owner-only Sir Leye spawn while his room attempt is live. */
  const leyeByPlayer = new Map();
  /** Player -> owner-only weapon ground spawns laid out for the fight. */
  const leyeLootByPlayer = new Map();
  /** Player -> { riddle, resolved, correct } for the current Ms. Hynn attempt. */
  const hynnAttempts = new Map();

  function tests(player) {
    return Number(player.getAttribute(TESTS_ATTRIBUTE)) || 0;
  }

  function hasTest(player, bit) {
    return (tests(player) & bit) !== 0;
  }

  function setTests(player, value) {
    player.setAttribute(TESTS_ATTRIBUTE, value | 0);
  }

  function nameFor(value) {
    if (value === null || value === undefined) return undefined;
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }

  function renWord(player) {
    return nameFor(player.getAttribute(WORD_ATTRIBUTE));
  }

  function ensureRenWord(player) {
    let word = renWord(player);
    if (word === undefined) {
      word = Math.floor(Math.random() * REN_WORDS.length);
      player.setAttribute(WORD_ATTRIBUTE, word);
    }
    return word;
  }

  function renClues(player) {
    return Number(player.getAttribute(REN_CLUES_ATTRIBUTE)) || 0;
  }

  function hynnRiddle(player) {
    return nameFor(player.getAttribute(RIDDLE_ATTRIBUTE));
  }

  function ensureHynnRiddle(player) {
    let riddle = hynnRiddle(player);
    if (riddle === undefined) {
      riddle = Math.floor(Math.random() * HYNN_RIDDLES.length);
      player.setAttribute(RIDDLE_ATTRIBUTE, riddle);
    }
    return riddle;
  }

  function tableState(player) {
    return Number(player.getAttribute(TABLE_STATE_ATTRIBUTE)) || 0;
  }

  function setTableState(player, value) {
    player.setAttribute(TABLE_STATE_ATTRIBUTE, value | 0);
  }

  function tinleyState(player) {
    return Number(player.getAttribute(TINLEY_STATE_ATTRIBUTE)) || 0;
  }

  function setTinleyState(player, value) {
    player.setAttribute(TINLEY_STATE_ATTRIBUTE, value | 0);
  }

  function inventoryReady(player) {
    return (
      player.getInventory().isEmpty() && player.getEquipment().getValidItems().length === 0
    );
  }

  function questComplete(player, key) {
    const request = { player, key, complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function meetsRequirements(player) {
    return (
      questComplete(player, BLOCKED_KNIGHTS_QUEST_KEY) &&
      questComplete(player, DRUIDIC_RITUAL_QUEST_KEY)
    );
  }

  function inGrounds(player) {
    const location = player.getLocation();
    const x = location.getX();
    const y = location.getY();
    return x >= GROUNDS.minX && x <= GROUNDS.maxX && y >= GROUNDS.minY && y <= GROUNDS.maxY;
  }

  function teleport(player, tile) {
    player.moveTo(new Location(tile.x, tile.y, tile.z));
  }

  function teleportToTiffy(player) {
    teleport(player, FALADOR_TILE);
  }

  function clearFight(player) {
    const npc = leyeByPlayer.get(player);
    if (npc) {
      api.removeNpc(npc);
      leyeByPlayer.delete(player);
    }
    const loot = leyeLootByPlayer.get(player);
    if (loot) {
      const manager = api.getItemOnGroundManager();
      for (const item of loot) manager?.deregister?.(item);
      leyeLootByPlayer.delete(player);
    }
  }

  function resetAttempt(player) {
    setTests(player, 0);
    player.setAttribute(WORD_ATTRIBUTE, null);
    player.setAttribute(REN_CLUES_ATTRIBUTE, 0);
    player.setAttribute(RIDDLE_ATTRIBUTE, null);
    clearTableAttempt(player);
    player.setAttribute(TABLE_LAYOUT_ATTRIBUTE, 0);
    player.setAttribute(TABLE_STATE_ATTRIBUTE, 0);
    player.setAttribute(TINLEY_STATE_ATTRIBUTE, 0);
    hynnAttempts.delete(player);
    clearFight(player);
  }

  /** Runs fn once the player's chatbox (dialogue or multi-option prompt) is clear. */
  function afterChatbox(player, fn) {
    if (player.isRegistered?.() === false) return;
    const { CountdownTask, TaskManager, MultiChatboxPrompt } = api.core;
    const attempt = () => {
      afterChatbox(player, fn);
    };
    if (!CountdownTask || !TaskManager) {
      fn();
      return;
    }
    TaskManager.submit(
      new CountdownTask(player, 1, () => {
        if (player.isRegistered?.() === false) return;
        const prompt = MultiChatboxPrompt?.getPending?.(player) ?? null;
        if (player.getDialogueManager?.()?.isActive?.() === true || prompt !== null) {
          attempt();
          return;
        }
        fn();
      })
    );
  }

  /** Plays one condition branch of a wiki variant, without replaying the rest. */
  function findConditionSteps(steps, stepId) {
    for (const step of steps ?? []) {
      if (step.type === "condition" && step.id === stepId) return step.steps ?? [];
      const nested = findConditionSteps(step.steps, stepId);
      if (nested) return nested;
      for (const option of step.options ?? []) {
        const found = findConditionSteps(option.steps, stepId);
        if (found) return found;
      }
    }
    return null;
  }

  function playBranch(player, npcId, variant, stepId) {
    api.emitCustomEvent("npc-dialogue:start", {
      player,
      npcId,
      variant,
      select: (steps) => findConditionSteps(steps, stepId) ?? [],
    });
  }

  function beginTests(player) {
    resetAttempt(player);
    quest.setStage(player, STAGE_TESTING);
    teleport(player, ROOM_BY_KEY.get("ren").landing);
  }

  function quitTests(player) {
    resetAttempt(player);
    quest.setStage(player, STAGE_TESTING);
    teleportToTiffy(player);
    player.sendMessage("You leave the tests. Your progress has been reset.");
  }

  function failTest(player) {
    resetAttempt(player);
    quest.setStage(player, STAGE_TESTING);
    afterChatbox(player, () => {
      teleportToTiffy(player);
      startTranscript(api, player, SIR_TIFFY_CASHIEN_NPC_ID, PAGE, V_TIFFY_FAIL);
    });
  }

  function goNextRoom(player, room) {
    const index = ROOMS.indexOf(room);
    const remaining = ROOMS.filter((candidate) => !hasTest(player, candidate.bit));
    if (remaining.length === 0) {
      quest.setStage(player, STAGE_RETURN);
      teleportToTiffy(player);
      return;
    }
    const next =
      ROOMS.find((candidate, candidateIndex) => candidateIndex > index && !hasTest(player, candidate.bit)) ??
      remaining[0];
    teleport(player, next.landing);
    player.sendMessage("You step through the portal to the next challenge.");
  }

  function kuamVictoryCondition(bitmask) {
    const count = ROOMS.filter((room) => (bitmask & room.bit) !== 0).length;
    if (count >= 5) return "d7FuHu";
    if (count === 4) return "crzBa_";
    return "DBOLHO";
  }

  function openRenDoorPrompt(player) {
    if (renClues(player) <= 0) {
      player.sendMessage(
        "The door has a four-letter combination lock. Sir Ren Itchood may have a clue for you."
      );
      return;
    }
    const answer = ensureRenWord(player);
    const options = [REN_WORDS[answer]];
    for (const word of REN_WORDS) {
      if (options.length >= 5) break;
      if (word !== REN_WORDS[answer]) options.push(word);
    }
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }
    const pairs = [];
    for (const word of options) {
      pairs.push(word, () => chooseRenWord(player, word));
    }
    api.sendMultiChatboxPrompt(player, "Enter the combination", ...pairs);
  }

  function chooseRenWord(player, word) {
    if (word === REN_WORDS[ensureRenWord(player)]) {
      setTests(player, tests(player) | TEST_BIT_REN);
      playBranch(player, SIR_REN_ITCHOOD_NPC_ID, V_REN_DOOR, "qNmbLN");
      return;
    }
    playBranch(player, SIR_REN_ITCHOOD_NPC_ID, V_REN_DOOR, "lA3dy2");
    failTest(player);
  }

  function nearLadyTable(player) {
    const location = player.getLocation();
    return location.getZ() === 0 && location.getX() >= 2448 && location.getX() <= 2461 &&
      location.getY() >= 4974 && location.getY() <= 4985;
  }

  function tableLater(player, attempt, ticks, callback) {
    api.core.TaskManager.submit(new api.core.CountdownTask(attempt, ticks, () => {
      if (tableAttempts.get(player) !== attempt || player.isRegistered?.() === false ||
          quest.getStage(player) !== STAGE_TESTING || !nearLadyTable(player)) return;
      callback();
    }));
  }

  function tableFade(player, out) {
    player.getPacketSender().sendSubInterface(FADE_UID, FADE_INTERFACE, 1, {
      postScripts: [{ scriptId: FADE_SCRIPT, args: out ? [0, 255, 0, 0, 50] : [0, 0, 0, 255, 50] }],
    });
  }

  function clearTableAttempt(player) {
    const attempt = tableAttempts.get(player);
    if (!attempt) return;
    tableAttempts.delete(player);
    api.core.TaskManager.cancelTasks(attempt);
    if (attempt.showing) {
      player.getDialogueManager().reset();
      player.getPacketSender().sendInterfaceRemoval();
    }
    player.getPacketSender().closeSubInterface(FADE_UID);
    player.getMovementQueue().setBlockMovement(false);
  }

  /** The room's automatic lines cannot be skipped by holding Space. */
  function tableLine(player, attempt, step, ticks, next) {
    const { ActionDialogue, DialogueChainBuilder, NpcDialogue } = api.core;
    const text = step.text.replace("[player name]", player.getDisplayName());
    attempt.showing = true;
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
      new ActionDialogue(0, { execute: () => {
        new NpcDialogue(0, LADY_TABLE_NPC_ID, text).sendHeld(player);
        tableLater(player, attempt, ticks, next);
      } }, true)
    ));
  }

  function startTable(player) {
    if (quest.getStage(player) !== STAGE_TESTING || hasTest(player, TEST_BIT_TABLE) || tableAttempts.has(player)) return;
    let layout = Number(player.getAttribute(TABLE_LAYOUT_ATTRIBUTE));
    if (!Number.isInteger(layout) || layout < 1 || layout > TABLE_STATUE_COUNT) {
      layout = 1 + Math.floor(Math.random() * TABLE_STATUE_COUNT);
      player.setAttribute(TABLE_LAYOUT_ATTRIBUTE, layout);
      setTableState(player, 0);
    }
    // Read the answer from the same multi-loc transforms the player sees, rather than a second table.
    const statues = Array.from({ length: TABLE_STATUE_COUNT }, (_, i) => api.core.CacheDefinitions.getObject(TABLE_FIRST_LOC_ID + i).transforms);
    const visible = statues.map((variants) => variants[layout < variants.length - 1 ? layout : variants.length - 1]);
    const attempt = { answer: statues.map((variants) => variants[0]).find((id) => !visible.includes(id)), showing: false };
    tableAttempts.set(player, attempt);
    if (tableState(player) >= 2) {
      player.getPacketSender().sendVarbit(TABLE_LAYOUT_VARBIT, 0);
      return;
    }
    setTableState(player, 1);
    player.getPacketSender().sendVarbit(TABLE_LAYOUT_VARBIT, layout);
    player.getMovementQueue().reset().setBlockMovement(true);
    const intro = loadTranscripts(api)[PAGE].variants[V_TABLE_ENTER];
    const after = loadTranscripts(api)[PAGE].variants[V_TABLE_AFTER];
    function introduce(index) {
      const last = index === intro.length - 1;
      tableLine(player, attempt, intro[index], last ? TABLE_WAIT_TICKS : TABLE_LINE_TICKS, () => {
        if (!last) return introduce(index + 1);
        tableLine(player, attempt, after[0], TABLE_LINE_TICKS, () => {
          tableFade(player, true);
          tableLater(player, attempt, TABLE_FADE_TICKS, () => {
            player.getPacketSender().sendVarbit(TABLE_LAYOUT_VARBIT, 0);
            tableFade(player, false);
            tableLater(player, attempt, TABLE_FADE_TICKS, () => {
              player.getPacketSender().closeSubInterface(FADE_UID);
              player.getMovementQueue().setBlockMovement(false);
              setTableState(player, 2);
              attempt.showing = false;
              player.getDialogueManager().reset();
              startTranscript(api, player, LADY_TABLE_NPC_ID, PAGE, V_TABLE_AFTER, (steps) => steps.slice(1));
            });
          });
        });
      });
    }
    introduce(0);
  }

  class StatueRoom extends api.core.Area {
    postEnter(mobile) {
      if (mobile.isPlayer()) startTable(mobile.getAsPlayer());
    }
    postLeave(mobile) {
      if (mobile.isPlayer()) clearTableAttempt(mobile.getAsPlayer());
    }
  }

  function touchTableStatue({ player, objectId, definition }) {
    if (quest.getStage(player) !== STAGE_TESTING || !nearLadyTable(player)) return false;
    if (objectId < TABLE_FIRST_LOC_ID || objectId >= TABLE_FIRST_LOC_ID + TABLE_STATUE_COUNT) return false;
    const attempt = tableAttempts.get(player);
    if (tableState(player) !== 2 || !attempt || hasTest(player, TEST_BIT_TABLE)) return true;
    if (definition.id === attempt.answer) {
      setTests(player, tests(player) | TEST_BIT_TABLE);
      setTableState(player, 3);
      playBranch(player, LADY_TABLE_NPC_ID, V_TABLE_TOUCH, "FjPTRa");
    } else {
      playBranch(player, LADY_TABLE_NPC_ID, V_TABLE_TOUCH, "Hsk37b");
      failTest(player);
    }
    return true;
  }

  function startTinleyWait(player) {
    const { CountdownTask, TaskManager } = api.core;
    if (!CountdownTask || !TaskManager) return;
    TaskManager.submit(
      new CountdownTask(player, TINLEY_WAIT_TICKS, () => {
        if (player.isRegistered?.() === false) return;
        if (quest.getStage(player) !== STAGE_TESTING || tinleyState(player) !== 2) return;
        if (!nearTinley(player)) {
          setTinleyState(player, 1);
          return;
        }
        afterChatbox(player, () => {
          if (quest.getStage(player) !== STAGE_TESTING || tinleyState(player) !== 2) return;
          setTinleyState(player, 3);
          setTests(player, tests(player) | TEST_BIT_TINLEY);
          startTranscript(api, player, SIR_TINLEY_NPC_ID, PAGE, V_TINLEY_DONE);
        });
      })
    );
  }

  function nearTinley(player) {
    const location = player.getLocation();
    return (
      Math.abs(location.getX() - 2476) <= 12 && Math.abs(location.getY() - 4958) <= 12
    );
  }

  function playTinleyFailure(player) {
    startTranscript(api, player, SIR_TINLEY_NPC_ID, PAGE, V_TINLEY_FAIL);
  }

  function spawnLeyeFight(player) {
    if (leyeByPlayer.has(player)) return;
    const npc = api.spawnNpc({
      id: SIR_LEYE_NPC_ID,
      x: 2458,
      y: 4965,
      z: 0,
      wanderRadius: 2,
      owner: player,
      ownerOnly: true,
    });
    if (npc) leyeByPlayer.set(player, npc);
    const manager = api.getItemOnGroundManager();
    const loot = [];
    for (let i = 0; i < LEYE_WEAPON_ITEM_IDS.length; i++) {
      const tile = KUAM_WEAPON_TILES[i];
      const ground = manager?.registerLocation?.(
        player,
        new Item(LEYE_WEAPON_ITEM_IDS[i], 1),
        new Location(tile.x, tile.y, tile.z)
      );
      if (ground) loot.push(ground);
    }
    if (loot.length) leyeLootByPlayer.set(player, loot);
  }

  function hynnAnswerCorrect(riddle, option) {
    const definition = HYNN_RIDDLES[riddle];
    return definition !== undefined && option === definition.correct;
  }

  function selectVariant({ npcId, player }) {
    if (!player) return null;
    if (npcId === SIR_AMIK_VARZE_NPC_ID) {
      const stage = quest.getStage(player);
      if (stage >= STAGE_COMPLETE) return null;
      if (stage >= STAGE_STARTED) return { page: PAGE, variant: V_AMIK_AGAIN };
      return { page: PAGE, variant: V_AMIK_START };
    }
    if (npcId === SIR_TIFFY_CASHIEN_NPC_ID) {
      const stage = quest.getStage(player);
      if (stage === STAGE_STARTED) return { page: PAGE, variant: V_TIFFY_AFTER_START };
      if (stage === STAGE_TESTING) return { page: PAGE, variant: V_TIFFY_RETRY };
      if (stage === STAGE_RETURN) return { page: PAGE, variant: V_TIFFY_FINISH };
      return null;
    }
    if (npcId === SIR_REN_ITCHOOD_NPC_ID) {
      if (quest.getStage(player) !== STAGE_TESTING || hasTest(player, TEST_BIT_REN)) {
        return { page: PAGE, variant: V_REN_ENTER };
      }
      ensureRenWord(player);
      return { page: PAGE, variant: renClues(player) > 0 ? V_REN_SECOND : V_REN_ENTER };
    }
    if (npcId === MS_HYNN_TERPRETT_NPC_ID) {
      if (quest.getStage(player) === STAGE_TESTING && !hasTest(player, TEST_BIT_HYNN)) {
        const riddle = ensureHynnRiddle(player);
        hynnAttempts.set(player, { riddle, resolved: false, correct: false });
      }
      return { page: PAGE, variant: V_HYNN_ENTER };
    }
    if (npcId === LADY_TABLE_NPC_ID) {
      return { page: PAGE, variant: V_TABLE_TALK };
    }
    if (npcId === SIR_TINLEY_NPC_ID) {
      if (quest.getStage(player) === STAGE_TESTING && !hasTest(player, TEST_BIT_TINLEY)) {
        const state = tinleyState(player);
        if (state === 0) {
          setTinleyState(player, 1);
          return { page: PAGE, variant: V_TINLEY_ENTER };
        }
        if (state === 1) {
          setTinleyState(player, 2);
          startTinleyWait(player);
          return { page: PAGE, variant: V_TINLEY_TALK };
        }
        if (state === 2) return { page: PAGE, variant: V_TINLEY_FAIL };
      }
      return {
        page: PAGE,
        variant: hasTest(player, TEST_BIT_TINLEY) ? V_TINLEY_DONE : V_TINLEY_ENTER,
      };
    }
    if (npcId === SIR_KUAM_FERENTSE_NPC_ID) {
      if (quest.getStage(player) === STAGE_TESTING && hasTest(player, TEST_BIT_KUAM)) {
        return { page: PAGE, variant: V_KUAM_DEFEAT };
      }
      return { page: PAGE, variant: V_KUAM_ENTER };
    }
    if (npcId === SIR_LEYE_NPC_ID) return { page: PAGE, variant: V_KUAM_LEYE };
    return null;
  }

  function answerCondition({ npcId, player, stepId }) {
    if (!player) return null;
    if (npcId === SIR_AMIK_VARZE_NPC_ID && stepId === "zDFMYL") {
      return !meetsRequirements(player);
    }
    if (npcId === SIR_TIFFY_CASHIEN_NPC_ID) {
      if (stepId === "vAdG3I") return !inventoryReady(player);
      if (stepId === "JI9IMB") return inventoryReady(player);
      return null;
    }
    if (npcId === SIR_REN_ITCHOOD_NPC_ID) {
      const entry = REN_WORD_CONDITION_INDEX.get(stepId);
      if (entry) return ensureRenWord(player) === entry.word;
      return null;
    }
    if (npcId === MS_HYNN_TERPRETT_NPC_ID) {
      const riddle = HYNN_RIDDLE_INDEX.get(stepId);
      if (riddle !== undefined) return hynnRiddle(player) === riddle;
      // The pass/fail branches are replayed from the answer, so leave them out.
      if (stepId === "N2--kz" || stepId === "3MX-iE") return false;
      return null;
    }
    if (npcId === SIR_KUAM_FERENTSE_NPC_ID) {
      const count = ROOMS.filter((room) => hasTest(player, room.bit)).length;
      if (stepId === KUAM_VICTORY_CONDITION_IDS[0]) return count >= 1 && count <= 3;
      if (stepId === KUAM_VICTORY_CONDITION_IDS[1]) return count === 4;
      if (stepId === KUAM_VICTORY_CONDITION_IDS[2]) return count >= 5;
      return null;
    }
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== SIR_AMIK_VARZE_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) !== 0) return;
    quest.setStage(player, STAGE_STARTED);
  }

  function handleDialogueCondition({ player, npcId, stepId }) {
    if (!player || npcId !== SIR_TIFFY_CASHIEN_NPC_ID) return;
    if (stepId !== "JI9IMB") return;
    const stage = quest.getStage(player);
    if (stage !== STAGE_STARTED && stage !== STAGE_TESTING) return;
    beginTests(player);
  }

  function handleDialogueAction(event) {
    const { player, npcId, stepId } = event;
    if (!player) return;
    if (npcId === SIR_KUAM_FERENTSE_NPC_ID && stepId === "OAGq9W") {
      spawnLeyeFight(player);
      event.handled = true;
      return;
    }
    if (npcId === SIR_TIFFY_CASHIEN_NPC_ID && stepId === "oqnyB5") {
      if (quest.getStage(player) === STAGE_RETURN && !quest.isComplete(player)) {
        quest.complete(player);
      }
      event.handled = true;
      return;
    }
    if (npcId === MS_HYNN_TERPRETT_NPC_ID && (stepId === "WJmb2X" || stepId === "v3xp4c")) {
      const riddle = hynnRiddle(player);
      const definition = HYNN_RIDDLES[riddle];
      if (definition?.options) {
        event.handled = true;
        event.steps = [
          {
            type: "choice",
            prompt: "Select an Answer",
            options: definition.options.map((text) => ({ text, steps: [] })),
          },
        ];
      }
      return;
    }
    if (
      (stepId === "RaVtxv" && npcId === MS_HYNN_TERPRETT_NPC_ID) ||
      (stepId === "UHsrRg" && npcId === SIR_TINLEY_NPC_ID)
    ) {
      event.handled = true;
      event.end = true;
      failTest(player);
    }
  }

  function handleDialogueChoice({ player, npcId, option }) {
    if (!player) return;
    if (npcId === SIR_REN_ITCHOOD_NPC_ID) {
      if (String(option).toLowerCase().includes("clue")) {
        player.setAttribute(REN_CLUES_ATTRIBUTE, Math.max(1, renClues(player)));
      }
      return;
    }
    if (npcId !== MS_HYNN_TERPRETT_NPC_ID) return;
    const attempt = hynnAttempts.get(player);
    if (!attempt || attempt.resolved) return;
    attempt.resolved = true;
    attempt.correct = hynnAnswerCorrect(attempt.riddle, String(option));
    if (attempt.correct) setTests(player, tests(player) | TEST_BIT_HYNN);
    afterChatbox(player, () =>
      playBranch(
        player,
        MS_HYNN_TERPRETT_NPC_ID,
        V_HYNN_ENTER,
        attempt.correct ? "N2--kz" : "3MX-iE"
      )
    );
  }

  function handleDoorToggle(request) {
    const { player, objectId } = request;
    if (!player || request.handled) return;
    const room = ROOM_BY_DOOR.get(objectId);
    if (!room) return;
    if (quest.getStage(player) !== STAGE_TESTING) return;
    request.handled = true;
    if (hasTest(player, room.bit)) {
      goNextRoom(player, room);
      return;
    }
    // Tinley's room is failed by touching anything while the patience wait runs;
    // the reachable exit door must count too (the exit portal sits behind it).
    if (room.key === "tinley" && tinleyState(player) === 2) {
      playTinleyFailure(player);
      return;
    }
    if (room.key === "ren") {
      openRenDoorPrompt(player);
      return;
    }
    player.sendMessage("The door is locked. Complete this room's challenge first.");
  }

  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    if (!player || event.handled) return;
    if (quest.getStage(player) === STAGE_TESTING && tinleyState(player) === 2) {
      if (nearTinley(player)) {
        event.handled = true;
        playTinleyFailure(player);
        return;
      }
      setTinleyState(player, 1);
    }
    const room = ROOM_BY_PORTAL.get(objectId);
    if (!room) return;
    event.handled = true;
    if (quest.getStage(player) !== STAGE_TESTING) {
      player.sendMessage("The portal is inactive.");
      return;
    }
    if (ENTRY_PORTALS.has(objectId)) {
      quitTests(player);
      return;
    }
    if (hasTest(player, room.bit)) {
      goNextRoom(player, room);
      return;
    }
    player.sendMessage("The portal is inactive. Complete this room's challenge first.");
  }

  function handleNpcInteraction(event) {
    const { player } = event;
    if (!player || event.handled) return;
    if (event.npcId === LADY_TABLE_NPC_ID && tableAttempts.get(player)?.showing) {
      event.handled = true;
      return;
    }
    if (quest.getStage(player) !== STAGE_TESTING || tinleyState(player) !== 2) return;
    if (!nearTinley(player)) {
      setTinleyState(player, 1);
      return;
    }
    event.handled = true;
    playTinleyFailure(player);
  }

  function handleNpcDeath(event) {
    const npc = event?.npc;
    if (!npc || npc.getId?.() !== SIR_LEYE_NPC_ID) return;
    const owner = npc.getOwner?.();
    if (!owner) return;
    const tracked = leyeByPlayer.get(owner);
    if (tracked !== npc) return;
    leyeByPlayer.delete(owner);
    const killer = event.killer?.isPlayer?.() ? event.killer : null;
    if (!killer || killer !== owner) {
      failTest(owner);
      return;
    }
    if (quest.getStage(killer) !== STAGE_TESTING) return;
    const weapon = killer.getEquipment().get(Equipment.WEAPON_SLOT)?.getId?.();
    if (BLADED_WEAPON_ITEM_IDS.has(weapon)) {
      killer.sendMessage("A blade cannot defeat Sir Leye. You have failed the test.");
      failTest(killer);
      return;
    }
    setTests(killer, tests(killer) | TEST_BIT_KUAM);
    afterChatbox(killer, () => {
      playBranch(
        killer,
        SIR_KUAM_FERENTSE_NPC_ID,
        V_KUAM_DEFEAT,
        kuamVictoryCondition(tests(killer))
      );
      if (ROOMS.every((room) => hasTest(killer, room.bit))) {
        afterChatbox(killer, () => {
          clearFight(killer);
          quest.setStage(killer, STAGE_RETURN);
          teleportToTiffy(killer);
        });
      }
    });
  }

  function handleLogin({ player }) {
    if (quest.getStage(player) === STAGE_RETURN && inGrounds(player)) {
      teleportToTiffy(player);
    }
    refreshQuestList(player);
  }

  function handleLogout({ player }) {
    clearTableAttempt(player);
    hynnAttempts.delete(player);
    clearFight(player);
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>Sir Amik Varze recommended me to the Temple Knights.</str>",
        "<str>I passed all five of Sir Tiffy's tests in the training</str>",
        "<str>grounds and joined the Temple Knights.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_RETURN) {
      return [
        "<str>I passed all five of Sir Tiffy's tests.</str>",
        "",
        "I should speak to <col=800000>Sir Tiffy Cashien</col> in",
        "<col=800000>Falador Park</col> to finish my recruitment.",
      ];
    }
    if (stage >= STAGE_TESTING) {
      const lines = ["I must pass five tests in a row for the Temple Knights:"];
      for (const room of ROOMS) {
        const line = `- ${room.label}`;
        lines.push(hasTest(player, room.bit) ? `<str>${line}</str>` : line);
      }
      return lines;
    }
    if (stage >= STAGE_STARTED) {
      return [
        "<str>Sir Amik Varze recommended me to the Temple Knights.</str>",
        "",
        "I should speak to <col=800000>Sir Tiffy Cashien</col> in",
        "<col=800000>Falador Park</col> to be tested.",
        "",
        "I need an <col=800000>empty inventory</col> and no equipment.",
      ];
    }
    return [
      "I can start this quest by speaking to <col=800000>Sir Amik Varze</col>",
      "on the upper floor of the <col=800000>White Knights' Castle</col>.",
      "",
      "I need to have completed <col=800000>Black Knights' Fortress</col>",
      "and <col=800000>Druidic Ritual</col>.",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.PRAYER, 1000.5);
    player.getSkillManager().addExperiences(Skill.HERBLORE, 1000.5);
    player.getSkillManager().addExperiences(Skill.AGILITY, 1000.5);
    player.getInventory().adds(ItemIdentifiers.COINS, 3000);
  }

  api.persistAttribute(TESTS_ATTRIBUTE);
  api.persistAttribute(WORD_ATTRIBUTE);
  api.persistAttribute(REN_CLUES_ATTRIBUTE);
  api.persistAttribute(RIDDLE_ATTRIBUTE);
  api.persistAttribute(TABLE_STATE_ATTRIBUTE);
  api.persistAttribute(TABLE_LAYOUT_ATTRIBUTE, 0);
  api.persistAttribute(TINLEY_STATE_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "recruitment_drive",
    name: "Recruitment Drive",
    varbitId: VARBIT_RECRUITMENT_DRIVE,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    // Native rd_main stays 1 throughout the tests/return; only Sir Tiffy's reward is 2.
    varbitValue: stage => stage >= STAGE_COMPLETE ? 2 : stage >= STAGE_STARTED ? 1 : 0,
    questPoints: 1,
    xpRewards: [
      { skillId: Skill.PRAYER.getIndex(), amount: 1000.5, label: "Prayer" },
      { skillId: Skill.HERBLORE.getIndex(), amount: 1000.5, label: "Herblore" },
      { skillId: Skill.AGILITY.getIndex(), amount: 1000.5, label: "Agility" },
    ],
    rewardItemId: ItemIdentifiers.INITIATE_SALLET,
    rewardItemLabel: "An initiate sallet",
    otherRewards: ["Access to initiate armour from Sir Tiffy Cashien"],
    buildJournal,
    onReward: grantReward,
  });

  api.registerArea(new StatueRoom([new api.core.Boundary(2448, 2461, 4974, 4985, 0)]));
  api.onObjectInteraction("Statue", { Touch: touchTableStatue });
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:condition", handleDialogueCondition);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onCustomEvent("npc-dialogue:choice", handleDialogueChoice);
  api.onCustomEvent("door:toggle", handleDoorToggle);
  api.onObjectInteraction(handleObjectInteraction);
  api.onNpcInteraction(handleNpcInteraction);
  api.onNpcDeath(handleNpcDeath);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
