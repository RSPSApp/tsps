/**
 * Tears of Guthix (members).
 *
 * Words come from the "Tears of Guthix" transcript page; this plugin supplies the
 * variant selector for Juna (Quest Helper models her as a loc, and so does the
 * cache: the placed multiloc 3193), the start hook, the prose-condition answers
 * and the magic-stone/stone-bowl crafting.
 *
 * Stages (canonical varbit 451 "TOG_JUNA_BOWL", bits 0-1 of shared varp 449;
 * cache quest row 145 completes at 2): 0 not started, 1 told Juna a story /
 * make the bowl, 2 complete. Stage changes write the varbit, never the whole
 * varp, because the minigame's stories/counters are sibling varbits (452+).
 *
 * Flow: talk to Juna (43 Quest Points); the first time she goes straight into her introduction ->
 * "Okay..." / "Yes." checks the requirements -> the camera pan step sets stage 1 -> cross the chasm
 * on a light creature with the lit sapphire lantern -> mine Magical rocks (20 Mining, pickaxe) ->
 * chisel the Magic stone into a Stone bowl -> climb back up the south rocks and talk to Juna with
 * the bowl ("returning-with-a-stone-bowl") -> the completion action takes the bowl and completes
 * (1 QP, 1000 Crafting XP, minigame access).
 *
 * The timings, messages, animations and sounds come from two rev 242 rsprox recordings of the
 * whole quest (local 1001964 and 1002071; see docs/quests/tears-of-guthix/README.md) and sit with
 * the constants that use them.
 *
 * The minigame after the quest (Juna's eligibility, the cave and the tears) is
 * plugins/minigames/TearsOfGuthix.plugin.js, and the chasm's drifting light creatures are its
 * Chasm.TearsOfGuthix.js. This file routes Juna's loc to her transcripts, keeps varbit 451 (her
 * multiloc: "Story" appears once the quest is done) in step with the stage, and plays the random
 * story she is told, out of the stories for quests the player has completed.
 *
 * Source: https://github.com/GregHib/void/blob/2b8e267836a8469757c73694ea4d57f2f1c28458/game/src/main/kotlin/content/area/misthalin/lumbridge/swamp/chams_of_tears/Juna.kt
 * (plus quest/member/tears_of_guthix/TearsOfGuthix.kt) for the refusal lines the recordings do
 * not cover. Temple of Ikov does not track the Lucien choice, so both Lucien story conditions
 * answer false. The surface Dark hole's rope entry belongs to shared world travel.
 *
 * Chasm of Tears (cache region 12948, plane 2), from the cache and the shared
 * world data:
 * - The tunnel 6659 (swamp surface) drops into the chasm floor at 3219,9532,2.
 * - Juna is the placed multiloc 3193 at 3252,9516,2: it resolves to the cache
 *   locs 28928/28929 ("Juna", Talk-to, and Story once the quest is done) by
 *   varbit 451, the quest's own stage varbit, so she is on the chasm floor
 *   with the player and the Talk-to handler matches her resolved name. (NPC
 *   5785 also exists but the shared spawn has it a floor up and the cache
 *   gives that NPC no menu option; Juna is talked to as the loc.)
 * - The pool between the ledges is clipped. The light creatures float over it;
 *   both the Attract option and the lantern use reach one from the ledge
 *   (LIGHT_CREATURE_USE_RANGE, projectile clip ignored), and the crossing
 *   lands on the far side (3224,9504 from the north; 3224,9530 from the south).
 * - The chasm's rocks (6672 on the south shelf, 6673 by the north ledge) move
 *   the player to the tile beyond the rock (rock x +- 1); 6672 only goes down.
 */
module.exports = function registerTearsOfGuthixQuest(api) {
  const { Animation, ForceMovement, Skill, ItemIdentifiers, NpcIdentifiers,
    ObjectIdentifiers, Location, Task, TaskManager } = api.core;
  const { registerQuest, refreshQuestList, startTranscript, getRegisteredQuests, loadTranscripts,
    questStartMessage } = require("../QuestRuntime");
  const mining = require("../../skills/Mining.plugin.js");
  const Chasm = require("../../minigames/tearsofguthix/Chasm.TearsOfGuthix");
  const Juna = require("../../minigames/tearsofguthix/Juna.TearsOfGuthix");

  const JUNA_NPC_ID = NpcIdentifiers.JUNA;
  const PAGE = "Tears of Guthix";

  const VARP_TEARS_OF_GUTHIX = 449;
  const STAGE_NOT_STARTED = 0;
  const STAGE_STONE_BOWL = 1;
  const STAGE_COMPLETE = 2;

  const MIN_QUEST_POINTS = 43;
  const MIN_MINING_LEVEL = 20;
  const MIN_CRAFTING_LEVEL = 20;

  const MAGIC_STONE_ITEM_ID = ItemIdentifiers.MAGIC_STONE;
  const STONE_BOWL_ITEM_ID = ItemIdentifiers.STONE_BOWL;
  const CHISEL_ITEM_ID = ItemIdentifiers.CHISEL;
  const LIT_SAPPHIRE_LANTERN_ITEM_ID = ItemIdentifiers.SAPPHIRE_LANTERN_3;

  const MAGICAL_ROCK_IDS = new Set([
    ObjectIdentifiers.MAGICAL_ROCKS,
    ObjectIdentifiers.MAGICAL_ROCKS_2,
    ObjectIdentifiers.MAGICAL_ROCKS_3,
  ]);
  /** Juna is a loc; her name carries the cache's colour tags. */
  const JUNA_LOC_NAME = "<col=ffff00>Juna</col>";
  /** tog_juna_bowl: the quest stage as Juna's multiloc reads it (bits 0-1 of varp 449). */
  const JUNA_BOWL_VARBIT = 451;
  /**
   * The chasm's light creatures are tog_light_creature (401), which varbit 451 shows as the
   * Attract-able 5435 from stage 1: interaction events carry that resolved id.
   */
  const LIGHT_CREATURE_NPC_ID = NpcIdentifiers.LIGHT_CREATURE_4;
  /** The two chasm slopes: 6672 (tog_climbing_rocks_down) on the south shelf, 6673 (tog_climbing_rocks_up) by the north ledge. */
  const SOUTH_ROCKS_ID = ObjectIdentifiers.ROCKS_27;
  const CHASM_ROCK_IDS = new Set([SOUTH_ROCKS_ID, ObjectIdentifiers.ROCKS_28]);
  /**
   * rsprox local 1001964/1002071 and 1696/1698: the climb moves the player at once to the tile
   * beyond the rock (rock x +-1) with an exact move from the tile they left over 100 client cycles,
   * facing west, and climbing_loop (2454, 5 loops). Going east (down the slope) it is
   * tog_climb_slope_down (2050) two ticks after the player's last step (1001964 ticks 19353 ->
   * 19355, 19637 -> 19639); going west, up 6673, tog_climb_slope_up (2049) one tick after (19482
   * -> 19483). 6672 only goes down: from its east side the player turns to it and gets the
   * message a tick after the last step (1696 tick 326). The interaction itself runs a tick after
   * the last step here, so the delays below count from it.
   */
  const CLIMB_DOWN_ANIMATION = 2050;
  const CLIMB_UP_ANIMATION = 2049;
  const CLIMB_DOWN_DELAY_TICKS = 1;
  const CLIMB_UP_DELAY_TICKS = 0;
  const CLIMB_CYCLES = 100;
  const CLIMBING_LOOP_SOUND = 2454;
  const CLIMBING_LOOP_COUNT = 5;
  const TOO_UNEVEN_MESSAGE = "You could climb down here, but it is too uneven to climb up.";
  /** ForceMovement directions (PlayerSession: 0 north, 1 east, 2 south, 3 west). */
  const FACE_SOUTH = 2;
  const FACE_WEST = 3;
  const TICK_CYCLES = 30;
  /** Recorded landings: the magical-rock shelf, and the north edge by the creature spawns. */
  const ROCK_SIDE_LANDING = [3224, 9504, 2];
  const JUNA_SIDE_LANDING = [3224, 9530, 2];

  const CHASM_PLANE = 2;
  /** Ours: how far from a creature the lantern reaches (the recordings used it from five tiles). */
  const LIGHT_CREATURE_USE_RANGE = 8;
  /** South of this y is the magical-rock shelf; north of it is the Juna-side ledge. */
  const CHASM_MIDDLE_Y = 9515;
  /**
   * The approach (rsprox local 1001964 tick 19492, 1002071 tick 5774): with the attract line the
   * creature comes one tile a tick onto the player's tile, diagonally until in line and then
   * straight (1001964: 3228,9522 to 3231,9527 from the next tick; 1002071: 3234,9524 to 3231,9529),
   * and the player floats up two ticks after it arrives. Ours: a creature that has not arrived in
   * 20 ticks gives up. With no creature to come (a second player's crossing) the float waits the
   * seven ticks 1001964 took in all.
   */
  const TOG_FLOAT_AFTER_ARRIVAL_TICKS = 2;
  const LIGHT_CREATURE_APPROACH_LIMIT = 20;
  const TOG_FLOAT_DELAY_TICKS = 7;
  /**
   * The float (both recordings): tog_player_float_up (2046) with a still exact move of 50 cycles
   * facing south; from the fourth tick the player moves a tile a tick (four tiles straight south,
   * then diagonally until in line with the landing, then straight: 1001964 3231,9527 to 9523,
   * 3224,9516, 3224,9504 at tick 19525), and tog_player_float_down (2047) two ticks after the last
   * step, when the float has lasted the path's length + 5 ticks (28 from y 9527, 30 from 9529).
   * The player can move again the tick after.
   */
  const TOG_FLOAT_UP_ANIMATION = 2046;
  const TOG_FLOAT_DOWN_ANIMATION = 2047;
  const TOG_FLOAT_HOLD_CYCLES = 50;
  const TOG_FLOAT_POSE_TICKS = 5;
  const TOG_CARRY_FIRST_STEP_TICK = 4;
  /**
   * The creature carries the player (1001964 and 1002071 agree): on the float-up tick it telejumps
   * to the tile south-west of the player, plays light_creature_grow and becomes
   * tog_light_creature_transition, with synth light_creature_up; the next tick it becomes
   * tog_light_creature_carrying, and from the fourth tick it moves a tile a tick under the player,
   * a tile south-west of them. On the float-down tick it plays light_creature_shrink with synth
   * light_creature_down. The next tick it is the plain creature again, hops two tiles north-east
   * (3223,9503 to 3225,9505) and drifts off north.
   */
  const LIGHT_CREATURE_GROW_ANIMATION = "light_creature_grow";
  const LIGHT_CREATURE_SHRINK_ANIMATION = "light_creature_shrink";
  const LIGHT_CREATURE_TRANSITION_NPC = "tog_light_creature_transition";
  const LIGHT_CREATURE_CARRYING_NPC = "tog_light_creature_carrying";
  const LIGHT_CREATURE_UP_SOUND = 1799; // light_creature_up
  const LIGHT_CREATURE_DOWN_SOUND = 1792; // light_creature_down
  const LIGHT_CREATURE_STRAIGHT_STEPS = 4;
  const LIGHT_CREATURE_RELEASE_HOP = 2;
  const ATTRACT_MESSAGE = "The light creature is attracted to your beam and comes towards you...";
  const NO_LANTERN_MESSAGE = "You don't have anything to attract the light creature with.";

  /**
   * Mining the magical rocks (rsprox local 1001964 tick 19605, 1002071 tick 5812): a tick after
   * the last step (when the interaction runs here), "You swing your pick at the rock." with the
   * pickaxe's animation; five ticks later the stone, "You manage to mine some stone." and the
   * animation stops. No Mining XP.
   */
  const MINE_SWING_DELAY_TICKS = 0;
  const MINE_STONE_DELAY_TICKS = 5;
  const MINE_SWING_MESSAGE = "You swing your pick at the rock.";
  const MINE_STONE_MESSAGE = "You manage to mine some stone.";
  /** The chisel on the stone (1001964 tick 19618): human_opalcutting and synth chisel on the same tick. */
  const CHISEL_ANIMATION = "human_opalcutting";
  const CHISEL_SOUND = 2586;

  const START_HOOK = "quest:tears-of-guthix:start";
  const COMPLETE_ACTION_ID = "BitWHU";
  /**
   * "The camera pans south ..." (between "But first you will need to make a bowl" and "There is a
   * cave on the south side"). Live starts the quest here, not at "Yes." (1001964 tick 19454:
   * varbit 451 0 -> 1, the start message and cam_moveto 3232,9507 height 700 rates 5/3 with the
   * line), and resets the camera when the conversation closes after "Mine some stone ..." (19473).
   */
  const CAMERA_PAN_STEP_ID = "ZFn96I";
  const CAMERA_PAN = { x: 3232, y: 9507, height: 700, rate: 5, rate2: 3 };
  const LAST_START_LINE = "Mine some stone from that cave, make it into a bowl, and bring it to me, and then I will let you catch the Tears.";
  /**
   * Juna's first Talk-to goes straight to "A story?" with no opening menu, and her introduction's
   * last line sets varbit 452 (1001964 ticks 19369-19407, 1002071 ticks 5699-5719); once she has
   * introduced herself the menu shows (every later recorded Talk-to).
   */
  const STORY_OPTION = "A story?";
  const INTRO_LAST_LINE = "Then you can drink of the power of balance, which will make you stronger in whatever area you are weakest.";
  /** "(A random story is selected from below.)" in the quest, and Juna's own "List of stories". */
  const RANDOM_STORY_STEP_IDS = new Set(["s6cYli", "nBzoOC"]);
  /** Juna's "You tell Juna some stories of your adventures." box, which the export lost. */
  const TELL_STORIES_STEP_ID = "0upJBS";
  /** The quest's own copy of it is a statement box with its continue (1001964 tick 19414). */
  const QUEST_TELL_STORIES_STEP_ID = "zK1Z1j";
  const TELL_STORIES_MESSAGE = "You tell Juna some stories of your adventures.";
  const RANDOM_STORIES_VARIANT = "starting-off-random-stories";

  const SIDE_CARNILLEAN = 0;
  const SIDE_HAZEEL = 1;

  let quest;
  /** Players with a crossing coming or in flight ({ key, destination, carrying }), so a second click does not chain one. */
  const crossings = new WeakMap();
  /** Light creatures coming for or carrying a player now; a second player crosses without one. */
  const carriers = new WeakSet();
  /** Players whose camera the start pan holds. */
  const panned = new WeakSet();
  /** Each player's magical-rock swing (its task key), so a new click replaces it. */
  const swings = new WeakMap();

  const has = (player, itemId) => player.getInventory().getAmount(itemId) > 0;

  function questPoints(player) {
    return Number(player.getAttribute("quest.points")) || 0;
  }

  /** Query another quest through QuestRuntime's public cross-plugin contract. */
  function otherQuestComplete(player, key) {
    const request = { player, key, complete: null };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  function hazeelSide(player) {
    const request = { player, side: null };
    api.emitCustomEvent("hazeel-cult:get-side", request);
    return request.side;
  }

  function hasBowl(player) {
    return has(player, STONE_BOWL_ITEM_ID);
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      const status = { player, lines: [] };
      api.emitCustomEvent("tears-of-guthix:journal", status);
      return [
        "<str>I met Juna the serpent in a deep chasm beneath the</str>",
        "<str>Lumbridge Swamp Caves. I made a bowl out of magical stone in</str>",
        "<str>order to catch the Tears of Guthix.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
        "",
        "Now Juna will let me into the cave to collect the Tears if I",
        "tell her stories of my adventures.",
        "",
        ...status.lines,
      ];
    }
    if (stage >= STAGE_STONE_BOWL) {
      if (hasBowl(player)) {
        return [
          "<str>I met Juna the serpent in a deep chasm beneath the</str>",
          "<str>Lumbridge Swamp Caves.</str>",
          "I made a bowl out of <col=800000>magical stone</col> in order to catch",
          "the <col=800000>Tears of Guthix</col>.",
          "",
          "I should take the bowl to Juna.",
        ];
      }
      return [
        "<str>I met Juna the serpent in a deep chasm beneath the</str>",
        "<str>Lumbridge Swamp Caves.</str>",
        "I must mine <col=800000>magical stone</col> south of the chasm and",
        "use a <col=800000>chisel</col> to make a stone bowl for Juna.",
      ];
    }
    return [
      "I can start this quest by speaking to <col=800000>Juna the serpent</col>",
      "deep in the <col=800000>Lumbridge Swamp Caves</col>.",
      "",
      "I need 43 Quest Points to tell her a story worth hearing.",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.CRAFTING, 1000);
  }

  /** Which transcript variant Juna plays, by quest stage. */
  function selectVariant({ npcId, player }) {
    if (npcId !== JUNA_NPC_ID) return null;
    const stage = quest.getStage(player);
    if (stage >= STAGE_COMPLETE) return null; // post-quest minigame words are not on the page
    if (stage >= STAGE_STONE_BOWL) {
      return hasBowl(player)
        ? "returning-with-a-stone-bowl"
        : "starting-off-talking-to-her-before-making-the-stone-bowl";
    }
    return "starting-off";
  }

  /** Answer Juna's story-picker prose conditions. */
  function answerCondition({ npcId, player, text }) {
    if (npcId !== JUNA_NPC_ID) return null;
    const story = storyCondition(player, text);
    if (story !== null) return story;
    const value = String(text).toLowerCase();
    if (value.includes("stopped the cultists")) {
      return (
        otherQuestComplete(player, "hazeel_cult") &&
        hazeelSide(player) === SIDE_CARNILLEAN
      );
    }
    if (value.includes("helped the cultists")) {
      return (
        otherQuestComplete(player, "hazeel_cult") &&
        hazeelSide(player) === SIDE_HAZEEL
      );
    }
    if (value.includes("has not completed making friends with my arm")) {
      return !otherQuestComplete(player, "making_friends_with_my_arm");
    }
    if (value.includes("has finished making friends with my arm")) {
      return otherQuestComplete(player, "making_friends_with_my_arm");
    }
    if (value.includes("has not finished dragon slayer ii")) {
      return !otherQuestComplete(player, "dragon_slayer_ii");
    }
    if (value.includes("has finished dragon slayer ii")) {
      return otherQuestComplete(player, "dragon_slayer_ii");
    }
    if (value.includes("has not completed a kingdom divided")) {
      return !otherQuestComplete(player, "a_kingdom_divided");
    }
    if (value.includes("completed a kingdom divided")) {
      return otherQuestComplete(player, "a_kingdom_divided");
    }
    // Temple of Ikov stores no side flag, so neither ending is claimed.
    if (value.includes("killed lucien") || value.includes("helped lucien")) return false;
    return null;
  }

  /** Wiki: 49 Firemaking with 43 quest points (20 Mining and 20 Crafting gate the cave). */
  const START_REQUIRED_SKILLS = [
    { skill: Skill.FIREMAKING, level: 49, label: "Firemaking" },
    { skill: Skill.MINING, level: MIN_MINING_LEVEL, label: "Mining" },
    { skill: Skill.CRAFTING, level: MIN_CRAFTING_LEVEL, label: "Crafting" },
  ];

  function missingStartSkillRequirements(player) {
    const skills = player.getSkillManager();
    return START_REQUIRED_SKILLS.filter((requirement) => skills.getMaxLevel(requirement.skill) < requirement.level);
  }

  function notifyStartSkillRequirements(player) {
    for (const requirement of missingStartSkillRequirements(player)) {
      player.sendMessage(
        `You need a ${requirement.label} level of at least ${requirement.level} to start this quest.`
      );
    }
  }

  /** "Yes." to "Start the Tears of Guthix quest?": a player who cannot start it hears no story. */
  function handleStartHook(hook) {
    const { player, npcId } = hook;
    if (npcId !== JUNA_NPC_ID || hook.hook !== START_HOOK) return;
    if (quest.getStage(player) !== STAGE_NOT_STARTED) return;
    if (questPoints(player) < MIN_QUEST_POINTS) {
      player.sendMessage(`You need at least ${MIN_QUEST_POINTS} Quest Points to start this quest.`);
      hook.end = true;
      return;
    }
    if (missingStartSkillRequirements(player).length > 0) {
      notifyStartSkillRequirements(player);
      hook.end = true;
    }
  }

  /** The camera pan (CAMERA_PAN_STEP_ID): the quest starts here, with the start message and the pan. */
  function startQuest(player) {
    if (quest.getStage(player) !== STAGE_NOT_STARTED) return;
    if (questPoints(player) < MIN_QUEST_POINTS || missingStartSkillRequirements(player).length > 0) return;
    quest.setStage(player, STAGE_STONE_BOWL);
    player.sendMessage(questStartMessage(player, quest.name));
    player.getPacketSender().sendCameraMoveTo(CAMERA_PAN.x, CAMERA_PAN.y, CAMERA_PAN.height,
      { rate: CAMERA_PAN.rate, rate2: CAMERA_PAN.rate2, heightRelative: false });
    panned.add(player);
    // Ours: a conversation that closes early (walked away) gives the camera back too.
    TaskManager.submit(new (class extends Task {
      constructor() { super(1, player, false); }
      execute() {
        if (!panned.has(player)) return this.stop();
        if (player.getDialogueManager?.()?.isActive?.() === true) return;
        this.stop();
        resetCamera(player);
      }
    })());
  }

  function resetCamera(player) {
    if (!panned.delete(player)) return;
    player.getPacketSender().sendCameraReset();
  }

  /**
   * Juna's lines: her introduction's last line marks it heard, and the quest's last start line
   * gives the camera back once the player continues past it.
   */
  function handleJunaLine(request) {
    if (request.npcId !== JUNA_NPC_ID) return;
    const { player } = request;
    if (request.text === INTRO_LAST_LINE && !Juna.introHeard(player)) {
      request.after = () => Juna.markIntroHeard(player);
    } else if (request.text === LAST_START_LINE) {
      request.after = () => resetCamera(player);
    }
  }

  /** "Congratulations! Quest complete!" from the returning-with-a-stone-bowl variant. */
  function handleAction(event) {
    if (event.npcId === JUNA_NPC_ID && event.stepId === CAMERA_PAN_STEP_ID) {
      startQuest(event.player);
      event.handled = true;
      return;
    }
    if (event.stepId !== COMPLETE_ACTION_ID || event.npcId !== JUNA_NPC_ID) return;
    const { player } = event;
    if (quest.getStage(player) !== STAGE_STONE_BOWL || !hasBowl(player)) return;
    player.getInventory().deleteNumber(STONE_BOWL_ITEM_ID, 1);
    quest.complete(player);
    event.handled = true;
    event.end = true;
  }

  function mineMagicStone(event) {
    if (!MAGICAL_ROCK_IDS.has(event.objectId)) return;
    const { player } = event;
    event.handled = true;
    if (quest.isComplete(player)) {
      player.sendMessage("You no longer have any need for this stone.");
      return;
    }
    if (player.getSkillManager().getCurrentLevel(Skill.MINING) < MIN_MINING_LEVEL) {
      player.sendMessage(`You need a Mining level of at least ${MIN_MINING_LEVEL} to mine this rock.`);
      return;
    }
    const pickaxe = mining.findBestPickaxe(player);
    if (!pickaxe) {
      player.sendMessage("You don't have a pickaxe which you can use.");
      return;
    }
    if (has(player, MAGIC_STONE_ITEM_ID)) {
      player.sendMessage("You already have a piece of magic stone.");
      return;
    }
    if (player.getInventory().isFull()) {
      player.sendMessage("You need a free inventory space to mine the stone.");
      return;
    }
    swingAtRock(player, pickaxe);
  }

  /** The swing and the stone, timed as recorded (MINE_SWING_DELAY_TICKS); moving off stops it. */
  function swingAtRock(player, pickaxe) {
    const previous = swings.get(player);
    if (previous) TaskManager.cancelTasks(previous);
    const key = {};
    swings.set(player, key);
    const at = player.getLocation().clone();
    const swing = () => {
      player.sendMessage(MINE_SWING_MESSAGE);
      player.performAnimation(pickaxe.animation);
    };
    if (MINE_SWING_DELAY_TICKS === 0) swing();
    let tick = 0;
    TaskManager.submit(new (class extends Task {
      constructor() { super(1, key, false); }
      execute() {
        tick++;
        if (player.isRegistered?.() === false || !player.getLocation().equals(at) || swings.get(player) !== key) {
          this.stop();
          return;
        }
        if (tick === MINE_SWING_DELAY_TICKS) {
          swing();
          return;
        }
        if (tick < MINE_SWING_DELAY_TICKS + MINE_STONE_DELAY_TICKS) return;
        this.stop();
        swings.delete(player);
        player.performAnimation(new Animation(-1));
        if (has(player, MAGIC_STONE_ITEM_ID) || player.getInventory().isFull()) return;
        player.getInventory().adds(MAGIC_STONE_ITEM_ID, 1);
        player.sendMessage(MINE_STONE_MESSAGE);
      }
    })());
  }

  /** Chisel a magic stone into a bowl once Juna has asked for one. */
  function handleChiselOnStone(event) {
    const { player, usedItemId, usedWithItemId } = event;
    const pair = (a, b) =>
      (usedItemId === a && usedWithItemId === b) || (usedItemId === b && usedWithItemId === a);
    if (!pair(CHISEL_ITEM_ID, MAGIC_STONE_ITEM_ID)) return;
    event.handled = true;
    if (quest.getStage(player) !== STAGE_STONE_BOWL) {
      player.sendMessage("You should speak to Juna about the Tears of Guthix first.");
      return;
    }
    if (player.getSkillManager().getCurrentLevel(Skill.CRAFTING) < MIN_CRAFTING_LEVEL) {
      player.sendMessage(`You need a Crafting level of at least ${MIN_CRAFTING_LEVEL} to make a stone bowl.`);
      return;
    }
    player.getInventory().deleteNumber(MAGIC_STONE_ITEM_ID, 1);
    player.getInventory().adds(STONE_BOWL_ITEM_ID, 1);
    player.sendMessage("You make a stone bowl.");
    player.performAnimation(new Animation(api.core.CacheDefinitions.getSeqId(CHISEL_ANIMATION)));
    player.getPacketSender().sendSound(CHISEL_SOUND, 1, 0);
  }

  /** Using a magic stone on Juna has its own wiki variant. */
  function handleStoneOnJuna(event) {
    if (event.itemId !== MAGIC_STONE_ITEM_ID) return;
    const npcId = event.npcId ?? event.target?.getId?.();
    if (npcId !== JUNA_NPC_ID) return;
    event.handled = true;
    startTranscript(api, event.player, JUNA_NPC_ID, PAGE, "starting-off-using-the-magic-stone-on-juna");
  }

  /** The lit sapphire lantern attracts a Chasm light creature across to the far side. */
  function crossChasm(player, npcLocation, creature = null) {
    if (quest.getStage(player) !== STAGE_STONE_BOWL || !isChasmLightCreature(npcLocation)) return false;
    if (!has(player, LIT_SAPPHIRE_LANTERN_ITEM_ID)) {
      player.sendMessage(NO_LANTERN_MESSAGE);
      return true;
    }
    if (crossings.has(player)) return true;
    const southSide = player.getLocation().getY() <= CHASM_MIDDLE_Y;
    const destination = southSide ? JUNA_SIDE_LANDING : ROCK_SIDE_LANDING;
    const start = player.getLocation().clone();
    const key = {};
    const carrier = canCarry(creature) ? creature : null;
    crossings.set(player, { key, destination, carrying: false, carrier });
    player.sendMessage(ATTRACT_MESSAGE);
    if (carrier) {
      carriers.add(carrier);
      carrier.setScriptedMovement(true);
      carrier.getMovementQueue?.().reset();
    }
    // A player who walks away before the float is left alone, and the creature drifts off again.
    const abandon = () => {
      TaskManager.cancelTasks(key);
      crossings.delete(player);
      if (carrier) releaseCreature(carrier, false);
    };
    let arrivedTick = carrier ? -1 : 0;
    let tick = 0;
    TaskManager.submit(new (class extends Task {
      constructor() { super(1, key, false); }
      execute() {
        tick++;
        if (player.isRegistered?.() === false || !player.getLocation().equals(start)) {
          this.stop();
          abandon();
          return;
        }
        // The creature comes a tile a tick onto the player's tile (diagonally until in line).
        if (arrivedTick < 0) {
          const at = carrier.getLocation();
          const dx = Math.sign(start.getX() - at.getX());
          const dy = Math.sign(start.getY() - at.getY());
          if (dx || dy) carrier.moveTo(new Location(at.getX() + dx, at.getY() + dy, at.getZ()));
          if (carrier.getLocation().getX() === start.getX() && carrier.getLocation().getY() === start.getY()) arrivedTick = tick;
          if (tick > LIGHT_CREATURE_APPROACH_LIMIT) {
            this.stop();
            abandon();
          }
          return;
        }
        const waited = carrier ? tick - arrivedTick : tick;
        if (waited < (carrier ? TOG_FLOAT_AFTER_ARRIVAL_TICKS : TOG_FLOAT_DELAY_TICKS)) return;
        this.stop();
        carry(player, carrier, start, destination);
      }
    })());
    return true;
  }

  /** A live creature that is not already carrying or coming for someone; a second player crosses without one. */
  function canCarry(creature) {
    return !!creature && typeof creature.setNpcTransformationId === "function" && !carriers.has(creature) &&
      creature.isScriptedMovement?.() !== true;
  }

  /**
   * The tiles the player passes, one a tick: four straight on y first, then diagonally until in
   * line with the landing, then straight on (both recordings; see TOG_CARRY_FIRST_STEP_TICK).
   */
  function carryPath(from, destination) {
    const path = [];
    let x = from.getX();
    let y = from.getY();
    while (x !== destination[0] || y !== destination[1]) {
      const stepY = Math.sign(destination[1] - y);
      const stepX = path.length < LIGHT_CREATURE_STRAIGHT_STEPS && stepY !== 0 ? 0 : Math.sign(destination[0] - x);
      x += stepX;
      y += stepY;
      path.push([x, y]);
    }
    return path;
  }

  /** The float: up, across a tile a tick with the creature beneath, and down (see the constants). */
  function carry(player, carrier, from, destination) {
    const crossing = crossings.get(player);
    if (!crossing) return;
    crossing.carrying = true;
    const { key } = crossing;
    const z = from.getZ();
    const path = carryPath(from, destination);
    const floatTicks = path.length + TOG_FLOAT_POSE_TICKS;
    const movement = player.getMovementQueue();
    movement.reset();
    movement.setBlockMovement(true);
    player.performAnimation(new Animation(TOG_FLOAT_UP_ANIMATION));
    // Live sends a still exact move with the float (to1 = to2 = the player's tile, 50 cycles, facing south).
    player.setForceMovement(new ForceMovement(from.clone(), new Location(0, 0), 0, TOG_FLOAT_HOLD_CYCLES, FACE_SOUTH, 0));
    if (carrier) {
      const cache = api.core.CacheDefinitions;
      carrier.telejump(new Location(from.getX() - 1, from.getY() - 1, z));
      carrier.performAnimation(new Animation(cache.getSeqId(LIGHT_CREATURE_GROW_ANIMATION)));
      carrier.setNpcTransformationId(cache.getNpcId(LIGHT_CREATURE_TRANSITION_NPC));
      player.getPacketSender().sendSound(LIGHT_CREATURE_UP_SOUND, 1, 0);
    }
    let tick = 0;
    let expected = from.clone();
    TaskManager.submit(new (class extends Task {
      constructor() { super(1, key, false); }
      execute() {
        tick++;
        // Gone, or taken elsewhere mid-float (a teleport): the float ends where they are.
        if (player.isRegistered?.() === false || !player.getLocation().equals(expected)) {
          this.stop();
          crossings.delete(player);
          player.setForceMovement(null);
          movement.setBlockMovement(false);
          if (carrier) releaseCreature(carrier, false);
          return;
        }
        if (tick === 1) {
          player.setForceMovement(null);
          if (carrier) carrier.setNpcTransformationId(api.core.CacheDefinitions.getNpcId(LIGHT_CREATURE_CARRYING_NPC));
        }
        const step = path[tick - TOG_CARRY_FIRST_STEP_TICK];
        if (step) {
          const at = player.getLocation().clone();
          const next = new Location(step[0], step[1], z);
          player.moveTo(next);
          expected = next;
          player.setForceMovement(new ForceMovement(at, new Location(step[0] - at.getX(), step[1] - at.getY()), 0,
            TICK_CYCLES, FACE_SOUTH, 0));
          if (carrier) carrier.moveTo(new Location(step[0] - 1, step[1] - 1, z));
        } else if (tick > TOG_CARRY_FIRST_STEP_TICK) {
          player.setForceMovement(null);
        }
        if (tick === floatTicks) {
          player.performAnimation(new Animation(TOG_FLOAT_DOWN_ANIMATION));
          if (carrier) {
            carrier.performAnimation(new Animation(api.core.CacheDefinitions.getSeqId(LIGHT_CREATURE_SHRINK_ANIMATION)));
            player.getPacketSender().sendSound(LIGHT_CREATURE_DOWN_SOUND, 1, 0);
          }
          return;
        }
        if (tick > floatTicks) {
          this.stop();
          movement.setBlockMovement(false);
          crossings.delete(player);
          if (carrier) releaseCreature(carrier, true);
        }
      }
    })());
  }

  /**
   * Back to the plain creature, which drifts again (Chasm.TearsOfGuthix.js). After a landing it
   * first hops two tiles north-east and heads north (1001964: 3223,9503 to 3225,9505, then north).
   */
  function releaseCreature(creature, landed) {
    creature.setNpcTransformationId(-1);
    if (landed) {
      const at = creature.getLocation();
      creature.moveTo(new Location(at.getX() + LIGHT_CREATURE_RELEASE_HOP, at.getY() + LIGHT_CREATURE_RELEASE_HOP, at.getZ()));
      Chasm.setHeading(creature, 0, 1);
    }
    creature.setScriptedMovement(false);
    carriers.delete(creature);
  }

  /** The cache's only light-creature option is Attract; it does what the lantern use does. */
  function attractLightCreature(event) {
    const { player, npc } = event;
    if ((event.npcId ?? npc?.getId?.()) !== LIGHT_CREATURE_NPC_ID) return false;
    const handled = crossChasm(player, npc?.getLocation?.() ?? event.location, npc);
    if (handled) event.handled = true;
    return handled;
  }

  /** The lit sapphire lantern, used on a Chasm light creature. */
  function handleLanternOnLightCreature(event) {
    if (event.itemId !== LIT_SAPPHIRE_LANTERN_ITEM_ID) return;
    const npcId = event.npcId ?? event.target?.getId?.();
    if (npcId !== LIGHT_CREATURE_NPC_ID) return;
    event.handled = crossChasm(event.player, event.target?.getLocation?.() ?? event.location, event.target);
  }

  function isChasmLightCreature(location) {
    const x = location?.getX?.() ?? location?.x;
    const y = location?.getY?.() ?? location?.y;
    const z = location?.getZ?.() ?? location?.z;
    const bounds = Chasm.BOUNDS;
    return Number(z) === CHASM_PLANE &&
      Number(x) >= bounds.x0 && Number(x) <= bounds.x1 && Number(y) >= bounds.y0 && Number(y) <= bounds.y1;
  }

  /** Both the lantern use and the Attract option target the creature from the ledge. */
  function routeLanternToLightCreature(event) {
    const npcId = event.npcId ?? event.npc?.getId?.();
    if (npcId !== LIGHT_CREATURE_NPC_ID || quest.getStage(event.player) !== STAGE_STONE_BOWL ||
      (event.itemId !== undefined && event.itemId !== LIT_SAPPHIRE_LANTERN_ITEM_ID) ||
      !isChasmLightCreature(event.npc?.getLocation?.() ?? event.location)) return;
    event.range = LIGHT_CREATURE_USE_RANGE;
    event.ignoreProjectileClip = true;
  }

  /**
   * Both chasm slopes are climbed one tile east or west over the rock, as the source's
   * exact move does; the south rocks used to teleport the player to the north ledge.
   */
  function climbTogRocks(event) {
    if (!CHASM_ROCK_IDS.has(event.objectId)) return;
    // The packet listener lower-cases the option before dispatching it, so the
    // canonical option is compared case-insensitively.
    const option = String(
      event.option || event.definition?.getInteractions()?.[event.clickType - 1] || ""
    ).toLowerCase();
    if (option !== "climb") return;
    const rock = event.object?.getLocation?.() ?? event.location;
    if (!rock) return;
    const rockX = rock.getX?.() ?? rock.x;
    const rockY = rock.getY?.() ?? rock.y;
    const rockZ = rock.getZ?.() ?? rock.z;
    const { player } = event;
    const from = player.getLocation().clone();
    const east = from.getX() < rockX;
    event.handled = true;
    if (!east && event.objectId === SOUTH_ROCKS_ID) {
      later(player, CLIMB_UP_DELAY_TICKS, () => {
        player.setPositionToFace(new Location(rockX, rockY, rockZ));
        player.sendMessage(TOO_UNEVEN_MESSAGE);
      });
      return;
    }
    const to = new Location(rockX + (east ? 1 : -1), rockY, rockZ);
    player.getMovementQueue().reset();
    later(player, east ? CLIMB_DOWN_DELAY_TICKS : CLIMB_UP_DELAY_TICKS, () => {
      if (!player.getLocation().equals(from)) return;
      climbOver(player, from, to, east ? CLIMB_DOWN_ANIMATION : CLIMB_UP_ANIMATION);
    });
  }

  /** Runs `action` now for 0 ticks, else that many ticks later. */
  function later(player, ticks, action) {
    if (ticks <= 0) return action();
    TaskManager.submit(new api.core.CountdownTask(player, ticks, action));
  }

  /** On the far tile at once, sliding there from `from` as the recorded exact move does. */
  function climbOver(player, from, to, animation) {
    const slide = new ForceMovement(from, new Location(to.getX() - from.getX(), to.getY() - from.getY()), 0,
      CLIMB_CYCLES, FACE_WEST, animation);
    player.moveTo(to);
    player.setForceMovement(slide);
    player.performAnimation(new Animation(animation));
    player.getPacketSender().sendSoundEffect(CLIMBING_LOOP_SOUND, CLIMBING_LOOP_COUNT, 0);
    TaskManager.submit(new api.core.CountdownTask(player, 1, () => {
      if (player.getForceMovement() === slide) player.setForceMovement(null);
    }));
  }

  /**
   * Talk-to on Juna's loc plays her transcript; the variant selectors pick the
   * page. Juna refuses a player without 43 Quest Points, and the generated page
   * has no refusal variant, so the refusal is a system line and her acceptance
   * lines stay unplayed for someone who cannot start the quest.
   */
  function talkToJuna({ player }) {
    const stage = quest.getStage(player);
    if (stage === STAGE_NOT_STARTED && questPoints(player) < MIN_QUEST_POINTS) {
      player.sendMessage(`You need at least ${MIN_QUEST_POINTS} Quest Points to start this quest.`);
      return;
    }
    const firstMeeting = stage === STAGE_NOT_STARTED && !Juna.introHeard(player);
    api.emitCustomEvent("npc-dialogue:start", { player, npcId: JUNA_NPC_ID, ...(firstMeeting ? { select: introduction } : {}) });
  }

  /** The first meeting: her opening line, then the "A story?" branch without the menu before it. */
  function introduction(steps) {
    const menu = steps.find((step) => step.type === "choice");
    const story = menu?.options?.find((option) => option.text === STORY_OPTION);
    if (!story?.steps?.length) return steps;
    return [...steps.slice(0, steps.indexOf(menu)), ...story.steps];
  }

  /** "If Animal Magnetism is completed:" guards each of the stories Juna can be told. */
  function storyCondition(player, text) {
    const match = /^If (.+?) is complete(?:d:| \()/.exec(String(text));
    if (!match) return null;
    const told = getRegisteredQuests().find((registered) => registered.name === match[1]);
    return told ? told.isComplete(player) : false;
  }

  /** The random story the player tells, and the box the export lost before it. */
  function handleStoryActions(event) {
    if (event.npcId !== JUNA_NPC_ID) return;
    if (event.stepId === TELL_STORIES_STEP_ID) {
      event.player.sendMessage(TELL_STORIES_MESSAGE);
      event.handled = true;
      return;
    }
    if (event.stepId === QUEST_TELL_STORIES_STEP_ID && event.kind === "message") {
      event.box = { statement: true };
      return;
    }
    if (!RANDOM_STORY_STEP_IDS.has(event.stepId)) return;
    const stories = loadTranscripts(api)?.[PAGE]?.variants?.[RANDOM_STORIES_VARIANT];
    event.steps = Array.isArray(stories) ? stories : [];
    event.handled = true;
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  /** A player who logs out mid-float is saved on the far side, not over the pool. */
  function handleLogout({ player }) {
    const crossing = crossings.get(player);
    crossings.delete(player);
    if (!crossing) return;
    TaskManager.cancelTasks(crossing.key);
    player.setForceMovement(null);
    player.getMovementQueue().setBlockMovement(false);
    if (crossing.carrier) releaseCreature(crossing.carrier, false);
    if (crossing.carrying) player.setLocation(new Location(...crossing.destination));
  }

  quest = registerQuest(api, {
    key: "tears_of_guthix",
    name: "Tears of Guthix",
    varpId: VARP_TEARS_OF_GUTHIX,
    varbitId: JUNA_BOWL_VARBIT,
    startedValue: STAGE_STONE_BOWL,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.CRAFTING.getIndex(), amount: 1000, label: "Crafting" }],
    otherRewards: ["Access to the Tears of Guthix"],
    // The scroll shows the bowl (1001964 tick 19677: questscroll:quest_model tog_bowl).
    scrollItemId: STONE_BOWL_ITEM_ID,
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onItemOnItem(handleChiselOnStone);
  api.onItemOnNpc(handleStoneOnJuna);
  api.onItemOnNpc(handleLanternOnLightCreature);
  api.onNpcInteraction("Light creature", { Attract: attractLightCreature });
  api.onNpcRoute(routeLanternToLightCreature);
  api.onObjectInteraction(climbTogRocks);
  api.onCustomEvent("npc-dialogue:action", handleStoryActions);
  api.onCustomEvent("npc-dialogue:line", handleJunaLine);
  api.onObjectInteraction(JUNA_LOC_NAME, { "Talk-to": talkToJuna });
  api.onObjectInteraction("Magical rocks", { Mine: mineMagicStone });
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
};
