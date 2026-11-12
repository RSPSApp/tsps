/**
 * Goblin Diplomacy, as live plays it: revision 242 capture 20261112T150929-5ab63b4 (the whole quest:
 * the start, the orange, blue and brown fittings and the reward) and the OSRS Wiki transcript.
 * The capture facts are in docs/quests/goblin-diplomacy/README.md.
 */
const CameraShake = require("../../interface/CameraShake.plugin");
const { createQuestScenes } = require("../QuestScenes");

module.exports = function registerGoblinDiplomacyQuest(api) {
  const { Skill, Location, Animation, StatementDialogue, ItemStatementDialogue, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers, CacheDefinitions } = api.core;
  const { registerQuest, refreshQuestList, startTranscript, loadTranscripts } = require("../QuestRuntime");

  const GENERAL_BENTNOZE_NPC_ID = NpcIdentifiers.GENERAL_BENTNOZE;
  const GENERAL_WARTFACE_NPC_ID = NpcIdentifiers.GENERAL_WARTFACE;
  const GRUBFOOT_NPC_IDS = [NpcIdentifiers.GRUBFOOT, NpcIdentifiers.GRUBFOOT_2, NpcIdentifiers.GRUBFOOT_3];

  const MAIN_VARBIT = 2378;
  const GRUBFOOT_VARBIT = 13594;
  /** Saved while a fitting plays: the tile the player comes back to after a logout or a server stop inside it. */
  const SCENE_EXIT_ATTRIBUTE = "goblin-diplomacy:scene-exit";
  /** The old dressing room's marker; a save made inside it is put back outside the hut once. */
  const LEGACY_SCENE_ATTRIBUTE = "goblin-diplomacy:cutscene";
  const LEGACY_SCENE_EXIT = new Location(2957, 3509, 0);
  const CRATES_ATTRIBUTE = "goblin-diplomacy:crates";
  const STAGE_STARTED = 1;
  const STAGE_ORANGE_REJECTED = 3;
  const STAGE_BLUE_REJECTED = 4;
  const STAGE_BROWN_ACCEPTED = 5;
  const STAGE_COMPLETE = 6;

  const ORANGE_GOBLIN_MAIL_ITEM_ID = ItemIdentifiers.ORANGE_GOBLIN_MAIL;
  const BLUE_GOBLIN_MAIL_ITEM_ID = ItemIdentifiers.BLUE_GOBLIN_MAIL;
  const GOBLIN_MAIL_ITEM_ID = ItemIdentifiers.GOBLIN_MAIL;
  const RED_DYE_ITEM_ID = ItemIdentifiers.RED_DYE;
  const YELLOW_DYE_ITEM_ID = ItemIdentifiers.YELLOW_DYE;
  const BLUE_DYE_ITEM_ID = ItemIdentifiers.BLUE_DYE;
  const ORANGE_DYE_ITEM_ID = ItemIdentifiers.ORANGE_DYE;
  const GOLD_BAR_ITEM_ID = ItemIdentifiers.GOLD_BAR;
  const MAIL_ITEM_IDS = new Set([GOBLIN_MAIL_ITEM_ID, ORANGE_GOBLIN_MAIL_ITEM_ID, BLUE_GOBLIN_MAIL_ITEM_ID,
    ItemIdentifiers.RED_GOBLIN_MAIL, ItemIdentifiers.GREEN_GOBLIN_MAIL, ItemIdentifiers.YELLOW_GOBLIN_MAIL,
    ItemIdentifiers.PURPLE_GOBLIN_MAIL, ItemIdentifiers.BLACK_GOBLIN_MAIL, ItemIdentifiers.WHITE_GOBLIN_MAIL]);

  const GOBLIN_MAIL_CRATE_LOC_IDS = new Set([
    ObjectIdentifiers.CRATE_139,
    ObjectIdentifiers.CRATE_140,
    ObjectIdentifiers.CRATE_141,
  ]);

  const GENERAL_IDS = new Set([GENERAL_BENTNOZE_NPC_ID, GENERAL_WARTFACE_NPC_ID]);

  /** "message" step that ends the brown hand-in cutscene. */
  const COMPLETE_MESSAGE_STEP_ID = "QqWnqy";

  /** Condition step ids of the "showing the generals ... armour" hand-ins and wrong-colour answers. */
  const HAND_IN_STEP_IDS = ["mZ3adF", "bypXXZ", "IEyrMp"];
  const WRONG_COLOUR_STEP_IDS = ["wrZYpt", "HPfEZV", "M4wLnN"];

  /** Custom-event slug carried by "Yes." on "Start the Goblin Diplomacy quest?". */
  const START_HOOK = "quest:goblin-diplomacy:start";

  const PAGE_GOBLIN_DIPLOMACY = "Goblin Diplomacy";
  const PAGE_GRUBFOOT = "Grubfoot";

  const VARIANT_START_GENERALS = "starting-off-talking-to-general-wartface-or-general-bentnoze";
  const VARIANT_ORANGE_GENERALS = "showing-the-generals-different-goblin-armours-orange-painted-goblin-armour";
  const VARIANT_BLUE_GENERALS = "showing-the-generals-different-goblin-armours-blue-painted-goblin-armour";
  const VARIANT_BROWN_GENERALS = "showing-the-generals-different-goblin-armours-brown-painted-goblin-armour";
  const VARIANT_GRUBFOOT_STANDARD = "standard-dialogue-after-goblin-diplomacy";
  const VARIANT_BLUE_GRUBFOOT = "showing-the-generals-different-goblin-armours-blue-painted-goblin-armour-talking-to-grubfoot";
  const VARIANT_ORANGE_GRUBFOOT = "showing-the-generals-different-goblin-armours-orange-painted-goblin-armour-talking-to-grubfoot";
  const VARIANT_START_GRUBFOOT = "starting-off-talking-to-grubfoot";

  /**
   * The transcript's own questions, as the menu shows them once the quest is under way (capture ticks 224 and 262:
   * the hand-in first when the armour is carried, then these; "Do you want me to pick an armour colour for you?" is gone).
   */
  const MENU_QUESTIONS = ["Why are you arguing about the colour of your armour?", "Wouldn't you prefer peace?", "I'll leave you to it."];

  const CONDITION_NON_ORANGE = "non-orange";
  const CONDITION_NON_BLUE = "non-blue";
  const CONDITION_ORANGE_PAINTED = "orange-painted";
  const CONDITION_BLUE_PAINTED = "blue-painted";
  const CONDITION_ORANGE_DYE_ON_MAIL = "orange dye on the goblin mail";
  const CONDITION_BLUE_DYE_ON_MAIL = "blue dye on the goblin mail";
  const CONDITION_PAINTED_ARMOUR = "a painted goblin armour";
  const CONDITION_REGULAR_ARMOUR = "uses regular goblin armour";

  // ---- the fitting, as the capture plays it (ticks 188-217, 227-251, 265-290) ----------------------------------------

  /** The scene is a copy of the 3 x 3 chunks from 2944, 3504 (rebuild_region at ticks 189, 228, 266). */
  const SCENE_INSTANCE = { sourceChunk: [368, 438], size: 3 };
  const SCENE_BOUNDS = [[2944, 2967, 3504, 3527, 0]];
  const PLAYER_TILE = [2957, 3513, 0];
  const PLAYER_FACES = [2955, 3511];
  const GENERALS = [["general_bentnoze_red_noop", [2958, 3512, 0]], ["general_wartface_green_noop", [2958, 3511, 0]]];
  /** The generals face the curtain until the fitting is judged, then the player; the player then faces Wartface. */
  const GENERALS_FACE = [2953, 3511];
  const WARTFACE_TILE = [2958, 3511];
  const GRUBFOOT_TILE = [2954, 3511, 0];
  const GRUBFOOT_FACES = [2956, 3511];
  /** Where Grubfoot heads on "Yes General Wartface?"; he is called back before he gets there (ticks 193, 269-270). Ours: the tile. */
  const GRUBFOOT_ANSWERS_AT = [2957, 3511, 0];
  const CURTAIN_TILE = [2953, 3511];
  const IN_FRONT_OF_CURTAIN = [2954, 3511];
  const OUT_OF_CURTAIN = [2955, 3511];
  /** Grubfoot wears the armour of the stage he is shown at, and the armour handed over after. */
  const GRUBFOOT_LOOKS = {
    [STAGE_STARTED]: ["catwalk_goblin_brown_noop", "catwalk_goblin_orange_noop"],
    [STAGE_ORANGE_REJECTED]: ["catwalk_goblin_orange_noop", "catwalk_goblin_blue_noop"],
    [STAGE_BLUE_REJECTED]: ["catwalk_goblin_blue_noop", "catwalk_goblin_brown_noop"],
  };
  /** The copy's cave entrance and hut doors are their op-less variants (loc_add_change at ticks 189, 228, 266). */
  const SCENE_LOCS = [
    { name: "xmas20_goblin_cave_entrance_noop", x: 2947, y: 3506, type: 10, face: 3 },
    { name: "goblin_outpost_poordoor_double_inner_noop", x: 2957, y: 3509, type: 0, face: 1 },
    { name: "goblin_outpost_poordoor_doubler_inner_noop", x: 2958, y: 3509, type: 0, face: 1 },
  ];
  const CAMERA = { move: [2961, 3514, 450], look: [2957, 3512, 150], rates: { rate: 232, rate2: 232, heightRelative: false } };
  /** Script 948's length in this scene's fades ([0, 255, 0, 0, 25] and [0, 0, 0, 255, 25]). */
  const FADE_CYCLES = 25;
  const CURTAIN_OPEN = "curtain_open";
  const CURTAIN_CLOSING = "curtain_closing";
  /** Ticks after Grubfoot is back at the curtain: [tick, step] (orange 194-205, blue 233-244, brown 272-283). */
  /** Grubfoot is at most three tiles from the curtain; past this he is put there. */
  const WALK_BACK_TICKS = 6;
  const CHANGING = [
    [1, "face-curtain"], [2, "open"], [3, "in"], [4, "face-out"], [4, "close"],
    [8, "change"], [8, "open"], [9, "out"], [10, "out-again"], [10, "close"], [11, "speak"],
  ];
  /** Lines the generals turn to the player for, and the player to Wartface (ticks 213, 247, 286). */
  const VERDICT_LINES = new Set(["Human! Get us blue armour!", "Human! Get us brown armour!", "Thank you for sorting out argument, human. You have reward now."]);
  /** The cutscene's own client state, set with cutscene_status and cleared with it (ticks 189 / 216). */
  const SCENE_VARBITS = [["fov_clamp", 3], ["draw_distance_max_override", 1]];
  const SCENE_VARPS = [["option_areasounds_override", 30], ["areasounds_override", 1]];

  const Scenes = createQuestScenes(api, { onEnd: sceneEnded, recoveryAttribute: SCENE_EXIT_ATTRIBUTE });
  const fittings = new WeakMap();

  const page = (variant) => ({ page: PAGE_GOBLIN_DIPLOMACY, variant });

  let quest;

  function has(player, itemId) {
    return player.getInventory().getAmount(itemId) > 0;
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I helped the Goblin Generals choose brown armour.</str>",
        "<str>The goblins have stopped arguing about colours.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_BLUE_REJECTED) {
      return [
        "<str>The generals rejected orange and blue armour.</str>",
        "They now want to try the original <col=800000>brown goblin mail</col>.",
      ];
    }
    if (stage >= STAGE_ORANGE_REJECTED) {
      return [
        "<str>The generals rejected orange armour.</str>",
        "They now want a suit of <col=800000>blue goblin mail</col>.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "The Goblin Generals want a suit of",
        "<col=800000>orange goblin mail</col> to test on Grubfoot.",
        "Goblin mail can be found in crates around the village.",
        "<col=800000>Aggie</col> in Draynor Village knows about dyes.",
      ];
    }
    return [
      "I can start this quest by speaking to either",
      "<col=800000>Goblin General</col> in the hut at",
      "<col=800000>Goblin Village</col>.",
      "",
      "There aren't any requirements for this quest.",
    ];
  }

  function reward(player) {
    player.getSkillManager().addExperiences(Skill.CRAFTING, 200);
  }

  // Which transcript variant the clicked NPC plays, by quest stage.
  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (GENERAL_IDS.has(npcId)) {
      if (stage < STAGE_STARTED) {
        return page(VARIANT_START_GENERALS);
      }
      if (stage === STAGE_STARTED) {
        return page(VARIANT_ORANGE_GENERALS);
      }
      if (stage === STAGE_ORANGE_REJECTED) {
        return page(VARIANT_BLUE_GENERALS);
      }
      if (stage === STAGE_BLUE_REJECTED) {
        return page(VARIANT_BROWN_GENERALS);
      }
      // The Wiki's "Talking to the Generals again" is {{tact|above}} - the same
      // conversation as the start; the dump's alias is an unresolved jump.
      return page(VARIANT_START_GENERALS);
    }
    if (GRUBFOOT_NPC_IDS.includes(npcId)) {
      if (stage >= STAGE_BROWN_ACCEPTED) {
        return { page: PAGE_GRUBFOOT, variant: VARIANT_GRUBFOOT_STANDARD };
      }
      if (stage === STAGE_BLUE_REJECTED) {
        return page(VARIANT_BLUE_GRUBFOOT);
      }
      if (stage === STAGE_ORANGE_REJECTED) {
        return page(VARIANT_ORANGE_GRUBFOOT);
      }
      return page(VARIANT_START_GRUBFOOT);
    }
    return null;
  }

  // Answer the "showing the generals ... armour" prose conditions from carried mail.
  function answerCondition({ npcId, player, text }) {
    if (!GENERAL_IDS.has(npcId)) return null;
    const value = String(text).toLowerCase();
    const orange = has(player, ORANGE_GOBLIN_MAIL_ITEM_ID);
    const blue = has(player, BLUE_GOBLIN_MAIL_ITEM_ID);
    if (value.includes(CONDITION_NON_ORANGE)) return !orange;
    if (value.includes(CONDITION_NON_BLUE)) return !blue;
    if (value.includes(CONDITION_ORANGE_PAINTED)) return orange;
    if (value.includes(CONDITION_BLUE_PAINTED)) return blue;
    if (value.includes(CONDITION_ORANGE_DYE_ON_MAIL)) return false;
    if (value.includes(CONDITION_BLUE_DYE_ON_MAIL)) return false;
    if (value.includes(CONDITION_PAINTED_ARMOUR)) return orange || blue;
    if (value.includes(CONDITION_REGULAR_ARMOUR)) return has(player, GOBLIN_MAIL_ITEM_ID);
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!GENERAL_IDS.has(npcId) || hook !== START_HOOK) return;
    if (quest.getStage(player) >= STAGE_STARTED) return;
    // Acceptance is recorded with "Yep, bring us orange armour", after the first two lines.
  }

  const SCENE_STARTS = new Set(["tpOU6M", "W3sSt5", "qn3xcl"]);
  const SCENE_ENDS = new Set(["C7D_Q0", "0v3cKx", COMPLETE_MESSAGE_STEP_ID]);
  const SCENE_CHANGES = new Set(["7xpvaw", "UNwweE"]);

  function armourFor(player) {
    const stage = quest.getStage(player);
    return stage === STAGE_STARTED ? ORANGE_GOBLIN_MAIL_ITEM_ID : stage === STAGE_ORANGE_REJECTED ? BLUE_GOBLIN_MAIL_ITEM_ID : GOBLIN_MAIL_ITEM_ID;
  }

  function armourVariant(player) {
    const stage = quest.getStage(player);
    return stage === STAGE_STARTED ? VARIANT_ORANGE_GENERALS : stage === STAGE_ORANGE_REJECTED ? VARIANT_BLUE_GENERALS : VARIANT_BROWN_GENERALS;
  }

  function handInSteps(variant) {
    return loadTranscripts(api)[PAGE_GOBLIN_DIPLOMACY].variants[variant].find(step => HAND_IN_STEP_IDS.includes(step.id)).steps;
  }

  function handleDialogueAction(event) {
    if (!GENERAL_IDS.has(event.npcId)) return;
    if (SCENE_STARTS.has(event.stepId)) return startScene(event);
    const fitting = fittings.get(event.player);
    if (SCENE_CHANGES.has(event.stepId) && fitting) {
      event.handled = true;
      changeArmour(event.player, fitting, event.stepId);
    } else if (SCENE_ENDS.has(event.stepId)) {
      event.handled = true;
      finishScene(event.player, fitting);
    }
  }

  function handleLine(event) {
    const { player, text } = event;
    if (!GENERAL_IDS.has(event.npcId)) return;
    if (text === "Yep, bring us orange armour." && quest.getStage(player) === 0) {
      event.before = () => {
        if (quest.getStage(player) !== 0) return;
        quest.setStage(player, STAGE_STARTED);
        player.sendMessage("You've started a new quest: <col=081190>Goblin Diplomacy</col>");
      };
      if (has(player, ORANGE_GOBLIN_MAIL_ITEM_ID)) event.after = () => playArmour(player, event.npcId);
    }
    const fitting = fittings.get(player);
    if (!fitting?.scene) return;
    const speaker = event.step?.speaker;
    if (speaker === "General Wartface") event.speakerId = NpcIdentifiers.GENERAL_WARTFACE_7;
    if (speaker === "General Bentnoze") event.speakerId = NpcIdentifiers.GENERAL_BENTNOZE_7;
    if (speaker === "Grubfoot") event.speakerId = lookOf(fitting.grubfoot);
    if (text === "Yes General Wartface?") event.before = () => Scenes.walk(fitting.grubfoot, GRUBFOOT_ANSWERS_AT);
    if (VERDICT_LINES.has(text)) event.before = () => turnToPlayer(player, fitting);
    // The brown hand-in has no "goes into the changing room" step: he changes once the line is continued.
    if (text === "Put on this armour!" && fitting.stage === STAGE_BLUE_REJECTED) event.after = () => changeArmour(player, fitting, text);
  }

  function playArmour(player, npcId, usedItem) {
    return startTranscript(api, player, npcId, PAGE_GOBLIN_DIPLOMACY, armourVariant(player), steps => {
      const wanted = armourFor(player);
      const condition = steps.find(step => step.type === "condition" && (usedItem === undefined || usedItem === wanted
        ? HAND_IN_STEP_IDS.includes(step.id)
        : WRONG_COLOUR_STEP_IDS.includes(step.id)));
      return condition?.steps ?? [];
    });
  }

  function handleItemOnNpc(event) {
    if (!GENERAL_IDS.has(event.npcId) || ![ORANGE_GOBLIN_MAIL_ITEM_ID, BLUE_GOBLIN_MAIL_ITEM_ID, GOBLIN_MAIL_ITEM_ID].includes(event.itemId)) return;
    if (quest.getStage(event.player) < STAGE_STARTED || quest.isComplete(event.player)) return;
    event.handled = true;
    if (!has(event.player, event.itemId)) return;
    playArmour(event.player, event.npcId, event.itemId);
  }

  /**
   * Talking to a general while the quest is under way: one of the start conversation's openings, then the menu live
   * shows (capture ticks 221-224 and 253-262): "I have some <colour> armour here." while the armour is carried, which
   * plays the hand-in, then the transcript's own questions.
   */
  function handleGeneralTalk(event) {
    const { player, npcId } = event;
    if (quest.getStage(player) < STAGE_STARTED || quest.isComplete(player)) return false;
    event.handled = true;
    const variants = loadTranscripts(api)[PAGE_GOBLIN_DIPLOMACY].variants;
    const intros = variants[VARIANT_START_GENERALS][0].options;
    const intro = intros[Math.floor(Math.random() * intros.length)].steps;
    const end = intro.findIndex(step => step.type === "choice" || step.type === "jump");
    const prefix = end < 0 ? intro : intro.slice(0, end);
    const variant = armourVariant(player);
    startTranscript(api, player, npcId, PAGE_GOBLIN_DIPLOMACY, variant, () => [...prefix, midQuestMenu(player, variant)]);
    return true;
  }

  /** The menu after the opening. Ours: without the armour it is the same menu less the hand-in (no capture shows it). */
  function midQuestMenu(player, variant) {
    const start = loadTranscripts(api)[PAGE_GOBLIN_DIPLOMACY].variants[VARIANT_START_GENERALS][0].options;
    const firstMenu = start.flatMap(option => option.steps).find(step => step.type === "choice" && step.options.some(o => o.text === MENU_QUESTIONS[0]));
    const options = [];
    if (has(player, armourFor(player))) {
      const handIn = handInSteps(variant);
      options.push({ text: handIn[0].player, steps: handIn });
    }
    for (const text of MENU_QUESTIONS) options.push({ text, steps: firstMenu.options.find(option => option.text === text).steps });
    return { type: "choice", options };
  }

  // ---- the fitting -------------------------------------------------------------------------------------------------------

  function gameval(kind, name) {
    const id = kind === "npc" ? CacheDefinitions.getNpcId(name) : kind === "loc" ? CacheDefinitions.getLocId(name) : CacheDefinitions.getSeqId(name);
    if (!Number.isInteger(id)) throw new Error(`Goblin Diplomacy: no ${kind} ${name} in the cache.`);
    return id;
  }

  function lookOf(npc) {
    const transform = npc?.getNpcTransformationId?.();
    return Number.isInteger(transform) && transform >= 0 ? transform : npc?.getId();
  }

  /** Each tick of a fitting is keyed on its scene, so a logout or the scene ending drops what is left of it. */
  function later(player, fitting, ticks, callback) {
    Scenes.later(fitting.scene ?? player, ticks, () => {
      if (fittings.get(player) === fitting && player.isRegistered?.() !== false) callback();
    });
  }

  /** The hand-in carries on after `marker` (a step id or a line). */
  function carryOn(player, fitting, marker) {
    startTranscript(api, player, fitting.npcId, PAGE_GOBLIN_DIPLOMACY, fitting.variant, steps => {
      const body = steps.find(step => HAND_IN_STEP_IDS.includes(step.id)).steps;
      return body.slice(body.findIndex(step => step.id === marker || step.text === marker) + 1);
    });
  }

  function sceneVars(player, on) {
    const sender = player.getPacketSender();
    for (const [name, value] of SCENE_VARBITS) sender.sendVarbit(CacheDefinitions.getVarbitId(name), on ? value : 0);
    for (const [name, value] of SCENE_VARPS) sender.sendConfig(CacheDefinitions.getVarpId(name), on ? value : 0);
  }

  /**
   * The continue past "I have some <colour> armour here.": the chat is held and the screen fades out (tick 188); next tick
   * the fitting room is a copy with the generals and Grubfoot in it, the cutscene's client state is on and the side tabs
   * close (189); then the camera and the fade in (190), and Wartface calls Grubfoot (191).
   */
  function startScene(event) {
    const { player, npcId } = event;
    event.handled = true;
    if (fittings.has(player) || !has(player, armourFor(player))) { event.end = true; return; }
    const stage = quest.getStage(player);
    const at = player.getLocation();
    const fitting = { stage, npcId, variant: armourVariant(player), exit: [at.getX(), at.getY(), at.getZ()], scene: null, grubfoot: null };
    fittings.set(player, fitting);
    player.getMovementQueue().reset().setBlockMovement(true);
    Scenes.fade(player, true, FADE_CYCLES);
    Scenes.hold(player);
    later(player, fitting, 1, () => openScene(player, fitting));
    later(player, fitting, 2, () => {
      Scenes.camera(player, CAMERA.move, CAMERA.look, CAMERA.rates);
      Scenes.fade(player, false, FADE_CYCLES);
    });
    later(player, fitting, 3, () => carryOn(player, fitting, event.stepId));
  }

  function openScene(player, fitting) {
    const scene = Scenes.open(player, "Goblin armour fitting", SCENE_BOUNDS, { canTeleport: () => false, canAttack: () => false },
      { instance: SCENE_INSTANCE, at: PLAYER_TILE, exit: fitting.exit });
    fitting.scene = scene;
    Scenes.face(player, PLAYER_FACES);
    Scenes.controls(player, true, true);
    sceneVars(player, true);
    Scenes.hideTabs(player);
    for (let axis = 0; axis < 5; axis++) CameraShake.send(player.getPacketSender(), "atmospheric", axis, 0);
    for (const [name, tile] of GENERALS) Scenes.actor(scene, gameval("npc", name), tile, GENERALS_FACE);
    fitting.grubfoot = Scenes.actor(scene, gameval("npc", GRUBFOOT_LOOKS[fitting.stage][0]), GRUBFOOT_TILE, GRUBFOOT_FACES);
    for (const { name, ...placement } of SCENE_LOCS) Scenes.loc(scene, { id: gameval("loc", name), ...placement });
  }

  function curtain(fitting, animation) {
    const area = fitting.scene?.area;
    if (!area) return;
    const object = area.getTemplateObjects(area.sourceTile(...CURTAIN_TILE)).find(candidate => candidate.getType() === 0);
    if (object) fitting.scene.owner.getPacketSender().sendObjectAnimation(object, new Animation(gameval("seq", animation)));
  }

  /**
   * The continue past "Put on this armour!": the chat is held and Grubfoot walks back to the curtain. From the tick he is there, CHANGING: he turns to it, it opens, he is moved through it and it closes; four ticks on
   * he wears the new armour (a transform), comes out a tile a tick and asks "What do you think?".
   */
  function changeArmour(player, fitting, marker) {
    const grubfoot = fitting.grubfoot;
    Scenes.hold(player);
    if (!grubfoot) return later(player, fitting, 1, () => carryOn(player, fitting, marker));
    Scenes.walk(grubfoot, [...IN_FRONT_OF_CURTAIN, 0]);
    let waited = 0;
    // Tasks run before NPCs move, so a check from a task that finds him there means he arrived the tick before.
    const back = (fromTask) => {
      // Ours: a walk that is somehow blocked ends with him put there, so the scene never stalls.
      if (!standsOn(grubfoot, IN_FRONT_OF_CURTAIN) && waited++ >= WALK_BACK_TICKS) grubfoot.moveTo(Scenes.tileFor(grubfoot, [...IN_FRONT_OF_CURTAIN, 0]));
      if (!standsOn(grubfoot, IN_FRONT_OF_CURTAIN)) return later(player, fitting, 1, () => back(true));
      const lag = fromTask ? 1 : 0;
      for (const [tick, step] of CHANGING) {
        const run = () => changing(player, fitting, step, marker);
        if (tick - lag <= 0) run(); else later(player, fitting, tick - lag, run);
      }
    };
    back(false);
  }

  function standsOn(npc, [x, y]) {
    const here = Scenes.toSource(npc);
    return here.getX() === x && here.getY() === y;
  }

  function changing(player, fitting, step, marker) {
    const grubfoot = fitting.grubfoot;
    switch (step) {
      case "face-curtain": return Scenes.face(grubfoot, CURTAIN_TILE);
      case "face-out": return Scenes.face(grubfoot, IN_FRONT_OF_CURTAIN);
      case "open": return curtain(fitting, CURTAIN_OPEN);
      case "close": return curtain(fitting, CURTAIN_CLOSING);
      case "in": return grubfoot.moveTo(Scenes.tileFor(grubfoot, [...CURTAIN_TILE, 0]));
      case "change": return grubfoot.setNpcTransformationId(gameval("npc", GRUBFOOT_LOOKS[fitting.stage][1]));
      case "out": return grubfoot.moveTo(Scenes.tileFor(grubfoot, [...IN_FRONT_OF_CURTAIN, 0]));
      case "out-again": return grubfoot.moveTo(Scenes.tileFor(grubfoot, [...OUT_OF_CURTAIN, 0]));
      case "speak": return carryOn(player, fitting, marker);
    }
  }

  function turnToPlayer(player, fitting) {
    Scenes.face(player, WARTFACE_TILE);
    for (const npc of fitting.scene?.actors ?? []) if (npc !== fitting.grubfoot) npc.setPositionToFace(player.getLocation());
  }

  /**
   * The continue past the fitting's last line: the armour goes, the stage moves on, the chat is held and the screen fades
   * out (ticks 215, 249, 287); next tick the player is back where they talked from with the client state and tabs restored
   * (216, 250, 288); then the fade in and the chat closes (217, 251, 289), and the brown fitting completes the quest a tick
   * later (290).
   */
  function finishScene(player, fitting) {
    if (!fitting || !has(player, armourFor(player)) || quest.getStage(player) !== fitting.stage) return;
    player.getInventory().deleteNumber(armourFor(player), 1);
    quest.setStage(player, fitting.stage === STAGE_STARTED ? STAGE_ORANGE_REJECTED : fitting.stage === STAGE_ORANGE_REJECTED ? STAGE_BLUE_REJECTED : STAGE_BROWN_ACCEPTED);
    sync(player);
    Scenes.fade(player, true, FADE_CYCLES);
    Scenes.hold(player);
    fitting.finished = true;
    later(player, fitting, 1, () => {
      Scenes.end(player, false);
      player.moveTo(new Location(...fitting.exit));
    });
    // The scene's own tasks went with it; what is left of the way out is keyed on the player.
    Scenes.later(player, 2, () => {
      Scenes.fade(player, false, FADE_CYCLES);
      player.getDialogueManager().reset();
      player.getPacketSender().sendInterfaceRemoval();
    });
    Scenes.later(player, 3, () => {
      if (fitting.stage === STAGE_BLUE_REJECTED && quest.getStage(player) === STAGE_BROWN_ACCEPTED) quest.complete(player);
    });
  }

  /** The scene ended (its way out, a logout or the player walking out of it): its client state goes. */
  function sceneEnded(player, scene, logout) {
    const fitting = fittings.get(player);
    if (fitting?.scene === scene) fittings.delete(player);
    sceneVars(player, false);
    if (!logout) Scenes.restoreTabs(player);
    player.getPacketSender().sendCameraUnlock(false);
  }

  /** A logout before the room opened (the first tick's fade): nothing was copied, only the controls are back. */
  function handleLogout({ player }) {
    const fitting = fittings.get(player);
    if (!fitting) return;
    if (fitting.scene) return Scenes.end(player, true);
    fittings.delete(player);
    Scenes.controls(player, false);
    Scenes.closeFade(player);
  }

  function sync(player) {
    const stage = quest.getStage(player);
    player.getPacketSender().sendVarbit(GRUBFOOT_VARBIT, stage === STAGE_ORANGE_REJECTED ? 1 : stage === STAGE_BLUE_REJECTED ? 2 : 0);
    const crates = Number(player.getAttribute(CRATES_ATTRIBUTE)) || 0;
    for (let i = 0; i < 3; i++) player.getPacketSender().sendVarbit(2379 + i, crates >> i & 1);
  }

  function handleBootstrap({ player }) { sync(player); }
  function handleStageChanged({ player, key }) { if (key === "goblin_diplomacy") sync(player); }

  // Mix orange dye (the wiki's only source), then dye an ordinary goblin mail orange or blue.
  function handleItemOnItem(event) {
    const used = event.usedItemId;
    const with_ = event.usedWithItemId;
    if (
      (used === RED_DYE_ITEM_ID && with_ === YELLOW_DYE_ITEM_ID) ||
      (used === YELLOW_DYE_ITEM_ID && with_ === RED_DYE_ITEM_ID)
    ) {
      event.handled = true;
      if (!has(event.player, RED_DYE_ITEM_ID) || !has(event.player, YELLOW_DYE_ITEM_ID)) return;
      event.player.getInventory().deleteNumber(RED_DYE_ITEM_ID, 1);
      event.player.getInventory().deleteNumber(YELLOW_DYE_ITEM_ID, 1);
      event.player.getInventory().adds(ORANGE_DYE_ITEM_ID, 1);
      event.player.sendMessage("You mix the red and yellow dyes to make orange dye.");
      event.handled = true;
      return;
    }
    const mail = MAIL_ITEM_IDS.has(used) ? used : MAIL_ITEM_IDS.has(with_) ? with_ : null;
    const pairsWith = dyeId => mail !== null && (used === dyeId || with_ === dyeId);
    let dyeId;
    let result;
    if (pairsWith(ORANGE_DYE_ITEM_ID)) {
      dyeId = ORANGE_DYE_ITEM_ID;
      result = ORANGE_GOBLIN_MAIL_ITEM_ID;
    } else if (pairsWith(BLUE_DYE_ITEM_ID)) {
      dyeId = BLUE_DYE_ITEM_ID;
      result = BLUE_GOBLIN_MAIL_ITEM_ID;
    } else {
      return;
    }
    const inventory = event.player.getInventory();
    event.handled = true;
    if (!has(event.player, dyeId) || !has(event.player, mail)) return;
    inventory.deleteNumber(dyeId, 1);
    inventory.deleteNumber(mail, 1);
    inventory.adds(result, 1);
    event.player.sendMessage(result === ORANGE_GOBLIN_MAIL_ITEM_ID ? "You dye the goblin mail orange." : "You dye the goblin mail blue.");
    event.handled = true;
  }

  // Search the village crates for spare goblin mail.
  function handleObjectInteraction(event) {
    if (!GOBLIN_MAIL_CRATE_LOC_IDS.has(event.objectId)) return;
    const action = String(event.definition?.getInteractions?.()?.[event.clickType - 1] ?? "").toLowerCase();
    if (action !== "search") return;
    event.handled = true;

    const index = [...GOBLIN_MAIL_CRATE_LOC_IDS].indexOf(event.objectId);
    const searched = Number(event.player.getAttribute(CRATES_ATTRIBUTE)) || 0;
    if (searched & 1 << index) {
      event.player.sendMessage("You search the crate, but find nothing of interest.");
      return;
    }
    if (event.player.getInventory().isFull()) { event.player.getInventory().full(); return; }
    event.player.setAttribute(CRATES_ATTRIBUTE, searched | 1 << index);
    sync(event.player);
    event.player.getInventory().adds(GOBLIN_MAIL_ITEM_ID, 1);
    const chain = new api.core.DialogueChainBuilder();
    chain.add(new ItemStatementDialogue(0, GOBLIN_MAIL_ITEM_ID, "You find some goblin mail in the crate."));
    event.player.getPacketSender().sendSound(2581, 1, 0);
    event.player.getDialogueManager().startDialogues(chain);
  }

  function refreshQuestsOnLogin({ player }) {
    if (player.getAttribute(LEGACY_SCENE_ATTRIBUTE)) {
      player.setAttribute(LEGACY_SCENE_ATTRIBUTE, 0);
      player.moveTo(LEGACY_SCENE_EXIT);
    }
    // The brown fitting's stage is saved a tick before the quest completes; a logout between them completes it here.
    if (quest.getStage(player) === STAGE_BROWN_ACCEPTED) quest.complete(player);
    sync(player);
    refreshQuestList(player);
  }

  quest = registerQuest(api, {
    key: "goblin_diplomacy",
    name: "Goblin Diplomacy",
    varbitId: MAIN_VARBIT,
    varbitValue: stage => stage === STAGE_STARTED ? 3 : stage === STAGE_ORANGE_REJECTED ? 4 : stage === STAGE_BLUE_REJECTED ? 5 : stage >= STAGE_BROWN_ACCEPTED ? 6 : 0,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 5,
    completionJingleId: 153,
    xpRewards: [{ skillId: Skill.CRAFTING.getIndex(), amount: 200, label: "Crafting" }],
    rewardItemId: GOLD_BAR_ITEM_ID,
    rewardItemLabel: "A Gold Bar",
    // The scroll shows the goblin armour (questscroll:quest_model, tick 290).
    scrollItemId: GOBLIN_MAIL_ITEM_ID,
    buildJournal,
    onReward: reward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onCustomEvent("quest:stage-changed", handleStageChanged);
  api.onCustomEvent("player:bootstrap-complete", handleBootstrap);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemOnItem(handleItemOnItem);
  api.onObjectInteraction(handleObjectInteraction);
  api.onPlayerLogin(refreshQuestsOnLogin);
  api.onPlayerLogout(handleLogout);
  api.onNpcInteraction("General Bentnoze", { "Talk-to": handleGeneralTalk });
  api.onNpcInteraction("General Wartface", { "Talk-to": handleGeneralTalk });
  api.persistAttribute(CRATES_ATTRIBUTE, 0);
  api.persistAttribute(LEGACY_SCENE_ATTRIBUTE, 0);
};
