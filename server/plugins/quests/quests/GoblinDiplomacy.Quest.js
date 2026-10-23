/** Goblin Diplomacy: revision 240 capture 20260817T005704 and the OSRS Wiki. */
module.exports = function registerGoblinDiplomacyQuest(api) {
  const { Skill, Location, Animation, CountdownTask, TaskManager, TemplatedInstanceArea, StatementDialogue, ItemStatementDialogue, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest, refreshQuestList, startTranscript, loadTranscripts } = require("../QuestRuntime");

  const GENERAL_BENTNOZE_NPC_ID = NpcIdentifiers.GENERAL_BENTNOZE;
  const GENERAL_WARTFACE_NPC_ID = NpcIdentifiers.GENERAL_WARTFACE;
  const GRUBFOOT_NPC_IDS = [NpcIdentifiers.GRUBFOOT, NpcIdentifiers.GRUBFOOT_2, NpcIdentifiers.GRUBFOOT_3];

  const MAIN_VARBIT = 2378;
  const GRUBFOOT_VARBIT = 13594;
  const SCENE_ATTRIBUTE = "goblin-diplomacy:cutscene";
  const CRATES_ATTRIBUTE = "goblin-diplomacy:crates";
  const FADE_UID = (161 << 16) | 1;
  const scenes = new WeakMap();
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
  const QUEST_NPC_IDS = new Set([
    GENERAL_BENTNOZE_NPC_ID,
    GENERAL_WARTFACE_NPC_ID,
    ...GRUBFOOT_NPC_IDS,
  ]);

  /** "message" step that ends the brown hand-in cutscene. */
  const COMPLETE_MESSAGE_STEP_ID = "QqWnqy";

  /** Condition step ids of the orange/blue "showing the generals ... armour" transcripts. */
  const ORANGE_HAND_IN_STEP_ID = "mZ3adF";
  const BLUE_HAND_IN_STEP_ID = "bypXXZ";

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

  const CONDITION_NON_ORANGE = "non-orange";
  const CONDITION_NON_BLUE = "non-blue";
  const CONDITION_ORANGE_PAINTED = "orange-painted";
  const CONDITION_BLUE_PAINTED = "blue-painted";
  const CONDITION_ORANGE_DYE_ON_MAIL = "orange dye on the goblin mail";
  const CONDITION_BLUE_DYE_ON_MAIL = "blue dye on the goblin mail";
  const CONDITION_PAINTED_ARMOUR = "a painted goblin armour";
  const CONDITION_REGULAR_ARMOUR = "uses regular goblin armour";

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

  function handleDialogueAction(event) {
    if (!GENERAL_IDS.has(event.npcId)) return;
    if (SCENE_STARTS.has(event.stepId)) return startScene(event);
    const state = scenes.get(event.player);
    if (SCENE_CHANGES.has(event.stepId) && state) {
      changeArmour(event.player, state, event.stepId);
      event.handled = true;
    } else if (SCENE_ENDS.has(event.stepId)) {
      event.handled = true;
      finishScene(event.player, state);
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
    const state = scenes.get(player);
    if (!state) return;
    const speaker = event.step?.speaker;
    if (speaker === "General Wartface") event.speakerId = NpcIdentifiers.GENERAL_WARTFACE_7;
    if (speaker === "General Bentnoze") event.speakerId = NpcIdentifiers.GENERAL_BENTNOZE_7;
    if (speaker === "Grubfoot") event.speakerId = state.grubfoot?.getId();
    if (text === "Yes General Wartface?") event.before = () => state.grubfoot?.getMovementQueue().addFirstStep(state.area.sourceTile(2956, 3511));
    if (text === "Put on this armour!" && state.stage === STAGE_BLUE_REJECTED) event.after = () => changeArmour(player, state, text);
  }

  function playArmour(player, npcId, usedItem) {
    return startTranscript(api, player, npcId, PAGE_GOBLIN_DIPLOMACY, armourVariant(player), steps => {
      const wanted = armourFor(player);
      const condition = steps.find(step => step.type === "condition" && (usedItem === undefined || usedItem === wanted
        ? [ORANGE_HAND_IN_STEP_ID, BLUE_HAND_IN_STEP_ID, "IEyrMp"].includes(step.id)
        : ["wrZYpt", "HPfEZV", "M4wLnN"].includes(step.id)));
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

  function handleGeneralTalk(event) {
    const { player, npcId } = event;
    if (quest.getStage(player) < STAGE_STARTED || quest.isComplete(player)) return false;
    event.handled = true;
    const variants = loadTranscripts(api)[PAGE_GOBLIN_DIPLOMACY].variants;
    const intros = variants[VARIANT_START_GENERALS][0].options;
    const intro = intros[Math.floor(Math.random() * intros.length)].steps;
    const end = intro.findIndex(step => step.type === "choice" || step.type === "jump");
    const prefix = end < 0 ? intro : intro.slice(0, end);
    if (has(player, armourFor(player))) {
      const handin = variants[armourVariant(player)].find(step => [ORANGE_HAND_IN_STEP_ID, BLUE_HAND_IN_STEP_ID, "IEyrMp"].includes(step.id)).steps;
      startTranscript(api, player, npcId, PAGE_GOBLIN_DIPLOMACY, armourVariant(player), () => [...prefix, ...handin]);
    } else {
      const colour = quest.getStage(player) === STAGE_STARTED ? "orange" : quest.getStage(player) === STAGE_ORANGE_REJECTED ? "blue" : "brown";
      startTranscript(api, player, npcId, PAGE_GOBLIN_DIPLOMACY, armourVariant(player), () => [...prefix,
        { type: "line", speaker: "General Wartface", text: `Human! Get us ${colour} armour!` }]);
    }
    return true;
  }

  function fade(player, out) {
    player.getPacketSender().sendSubInterface(FADE_UID, 174, 1, { postScripts: [{ scriptId: 948, args: out ? [0, 255, 0, 0, 25] : [0, 0, 0, 255, 25] }] });
  }

  function sync(player) {
    const stage = quest.getStage(player);
    player.getPacketSender().sendVarbit(GRUBFOOT_VARBIT, stage === STAGE_ORANGE_REJECTED ? 1 : stage === STAGE_BLUE_REJECTED ? 2 : 0);
    const crates = Number(player.getAttribute(CRATES_ATTRIBUTE)) || 0;
    for (let i = 0; i < 3; i++) player.getPacketSender().sendVarbit(2379 + i, crates >> i & 1);
  }

  function controls(player, active) {
    player.getMovementQueue().reset().setBlockMovement(active);
    player.setUntargetable(active);
    player.getPacketSender().sendVarbit(6719, active ? 2 : 0).sendVarbit(12393, active ? 1 : 0);
  }

  class DressingRoom extends TemplatedInstanceArea {
    constructor(owner) {
      super(3, 3); this.owner = owner;
      for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) this.setChunk(0, x, y, { sourceChunkX: 368 + x, sourceChunkY: 438 + y, sourcePlane: 0, rotation: 0 });
    }
    sourceTile(x, y) { return this.tile(x - 2944, y - 3504, 0); }
    getName() { return "Goblin armour fitting"; }
    canAttack() { return false; }
    canTeleport() { return false; }
    postLeave(actor, logout) {
      super.postLeave(actor, logout);
      if (actor === this.owner && !scenes.get(actor)?.returning) cleanup(actor);
    }
  }

  function later(player, state, ticks, fn) {
    TaskManager.submit(new CountdownTask(player, ticks, () => {
      if (scenes.get(player) === state && player.isRegistered?.() !== false) fn();
    }));
  }

  function actor(player, state, id, x, y) {
    const tile = state.area.sourceTile(x, y);
    const npc = api.spawnNpc({ id, x: tile.getX(), y: tile.getY(), z: 0, face: 3, owner: player, ownerOnly: true, wanderRadius: 0 });
    if (npc) state.area.add(npc);
    return npc;
  }

  function resume(player, state, ticks, marker) {
    player.getDialogueManager().reset();
    StatementDialogue.send(player, "", false);
    later(player, state, ticks, () => startTranscript(api, player, state.npcId, PAGE_GOBLIN_DIPLOMACY, state.variant, steps => {
      const body = steps.find(step => [ORANGE_HAND_IN_STEP_ID, BLUE_HAND_IN_STEP_ID, "IEyrMp"].includes(step.id)).steps;
      return body.slice(body.findIndex(step => step.id === marker || step.text === marker) + 1);
    }));
  }

  function startScene(event) {
    const { player, npcId } = event;
    event.handled = true;
    if (scenes.has(player) || !has(player, armourFor(player))) { event.end = true; return; }
    const stage = quest.getStage(player);
    const state = { area: new DressingRoom(player), returnTile: player.getLocation().clone(), stage, npcId, variant: armourVariant(player), returning: false };
    scenes.set(player, state);
    player.setAttribute(SCENE_ATTRIBUTE, 1);
    controls(player, true); fade(player, true);
    later(player, state, 1, () => {
      for (let axis = 0; axis < 5; axis++) player.getPacketSender().sendCameraShake(axis, 0);
      state.area.enter(player); player.moveTo(state.area.sourceTile(2944, 3504));
      actor(player, state, NpcIdentifiers.GENERAL_BENTNOZE_7, 2958, 3512);
      actor(player, state, NpcIdentifiers.GENERAL_WARTFACE_7, 2958, 3511);
      state.grubfoot = actor(player, state, stage === STAGE_STARTED ? NpcIdentifiers.GRUBFOOT_5 : stage === STAGE_ORANGE_REJECTED ? NpcIdentifiers.GRUBFOOT_6 : NpcIdentifiers.GRUBFOOT_7, 2954, 3511);
    });
    later(player, state, 2, () => {
      const at = state.area.sourceTile(2961, 3514), look = state.area.sourceTile(2957, 3512);
      player.getPacketSender().sendCameraMoveTo(at.getX(), at.getY(), 450, { rate: 232, rate2: 232, heightRelative: false }).sendCameraLookAt(look.getX(), look.getY(), 150, { rate: 232, rate2: 232, heightRelative: false });
      fade(player, false);
    });
    resume(player, state, 3, event.stepId);
  }

  function curtain(player, state, animation) {
    const object = state.area.getTemplateObjects(state.area.sourceTile(2953, 3511)).find(object => object.getType() === 0);
    if (object) player.getPacketSender().sendObjectAnimation(object, new Animation(animation));
  }

  function changeArmour(player, state, marker) {
    state.grubfoot?.getMovementQueue().addFirstStep(state.area.sourceTile(2954, 3511));
    later(player, state, 3, () => curtain(player, state, 4346));
    later(player, state, 4, () => state.grubfoot?.moveTo(state.area.sourceTile(2953, 3511)));
    later(player, state, 5, () => curtain(player, state, 4347));
    later(player, state, 9, () => {
      if (state.grubfoot) api.removeNpc(state.grubfoot);
      state.grubfoot = actor(player, state, state.stage === STAGE_STARTED ? NpcIdentifiers.GRUBFOOT_6 : state.stage === STAGE_ORANGE_REJECTED ? NpcIdentifiers.GRUBFOOT_7 : NpcIdentifiers.GRUBFOOT_5, 2953, 3511);
      curtain(player, state, 4346);
    });
    later(player, state, 10, () => state.grubfoot?.moveTo(state.area.sourceTile(2954, 3511)));
    later(player, state, 11, () => { state.grubfoot?.moveTo(state.area.sourceTile(2955, 3511)); curtain(player, state, 4347); });
    resume(player, state, 12, marker);
  }

  function returnFromScene(player, state) {
    state.returning = true;
    if (player.getPrivateArea() === state.area) state.area.leave(player, false);
    player.moveTo(state.returnTile); state.area.destroy();
    player.getPacketSender().sendCameraUnlock(false).sendCameraReset();
  }

  function finishScene(player, state) {
    if (!state || !has(player, armourFor(player)) || quest.getStage(player) !== state.stage) return;
    player.getInventory().deleteNumber(armourFor(player), 1);
    quest.setStage(player, state.stage === STAGE_STARTED ? STAGE_ORANGE_REJECTED : state.stage === STAGE_ORANGE_REJECTED ? STAGE_BLUE_REJECTED : STAGE_BROWN_ACCEPTED);
    sync(player); fade(player, true);
    player.getDialogueManager().reset(); StatementDialogue.send(player, "", false);
    later(player, state, 1, () => { returnFromScene(player, state); controls(player, false); });
    later(player, state, 2, () => fade(player, false));
    later(player, state, 3, () => {
      scenes.delete(player); player.setAttribute(SCENE_ATTRIBUTE, 0);
      if (state.stage === STAGE_BLUE_REJECTED) quest.complete(player);
      else player.getPacketSender().sendInterfaceRemoval();
    });
  }

  function cleanup(player) {
    const state = scenes.get(player);
    scenes.delete(player);
    if (state) returnFromScene(player, state);
    player.setAttribute(SCENE_ATTRIBUTE, 0); controls(player, false);
    player.getPacketSender().sendCameraReset().closeSubInterface(FADE_UID);
  }

  function handleLogout({ player }) { cleanup(player); }
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
    if (player.getAttribute(SCENE_ATTRIBUTE)) { player.moveTo(new Location(2957, 3509, 0)); cleanup(player); }
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
    rewardItemLabel: "A Gold bar",
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
  api.persistAttribute(SCENE_ATTRIBUTE, 0);
};
