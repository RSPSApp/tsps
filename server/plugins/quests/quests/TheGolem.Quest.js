/**
 * The Golem (members).
 *
 * Built against a whole run of the quest on live: the user's RSProx capture TheGolem.bin
 * (revision 242; docs/quests/the-golem/README.md lists the facts and ticks). Spoken lines come
 * from the "The Golem" transcript page; messages are the Wiki transcript's, sent as the capture
 * sends them (game message or item box). Where the capture words a message differently the
 * Wiki's wording is kept and the README records the difference.
 *
 * Stages (varbit 346 golem_a in varp 437): 0 unstarted, 1 repair the golem, 2 open the portal,
 * 3 the curator told the player about the statuette, 4 statuette replaced, 5 portal open,
 * 6 seen the demon's skeleton, 7 the golem did not believe it, 10 complete.
 *
 * Sibling varbits in varp 437 (cache transforms in brackets):
 * 347 golem_b: 1 read the letter, 2 Elissa named the notes, 3 read the notes;
 * 348 golem_clay (NPC 6277: 0-1 broken 5134, 2-3 damaged 5135, 4 repaired 5136);
 * 349-351 statuettes A-C (0 faces right 6307, 1 left 6308); 352 statuette D (0 empty 6309,
 * 1 left, 2 right); 353 the golem's head open; 354 throne gems taken (6301 -> 6302);
 * 355 statuette retrieved (case 24627 -> 24550); 356 seen the ruins underground.
 * The temple door 6310 is 6363 "Open" below stage 5 and 6364 "Enter" from stage 5.
 *
 * Route: Quest Helper pinned at
 * https://github.com/Zoinkwiz/quest-helper/blob/06da90f982518a093f2fe1c9cfac5547fa7053d3/src/main/java/com/questhelper/helpers/quests/thegolem/TheGolem.java
 */
module.exports = function registerTheGolemQuest(api) {
  const { Location, Skill, Animation, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest, refreshQuestList, startTranscript, openBook, giveReward, questStartMessage } = require("../QuestRuntime");

  const PAGE = "The Golem";
  const VARP_THE_GOLEM = 437; // golem_quest
  const VARBIT_THE_GOLEM = 346; // golem_a
  const VARBIT_GOLEM_B = 347;
  const VARBIT_GOLEM_CLAY = 348;
  const VARBIT_STATUETTE_A = 349;
  const VARBIT_STATUETTE_B = 350;
  const VARBIT_STATUETTE_C = 351;
  const VARBIT_STATUETTE_D = 352;
  const VARBIT_HEAD_OPEN = 353;
  const VARBIT_THRONE_GEMS = 354;
  const VARBIT_RETRIEVED_STATUETTE = 355;
  const VARBIT_SEEN_UNDERGROUND = 356;

  const STAGE_NOT_STARTED = 0;
  const STAGE_REPAIR_GOLEM = 1;
  const STAGE_OPEN_PORTAL = 2;
  const STAGE_FIND_STATUETTE = 3;
  const STAGE_STATUETTE_REPLACED = 4;
  const STAGE_PORTAL_OPENED = 5;
  const STAGE_DEMON_DEAD = 6;
  const STAGE_CONVINCE_GOLEM = 7;
  const STAGE_COMPLETE = 10;

  /** golem_b: the letter hunt. */
  const LETTER_READ = 1;
  const ELISSA_TOLD = 2;
  const NOTES_READ = 3;

  const CRAFTING_LEVEL = 20;
  const THIEVING_LEVEL = 25;
  const CLAY_REPAIRS = 4;

  // The world's Uzer golem is 6277, a nameless multi-NPC the client shows as 5134/5135/5136; the
  // capture's chatheads are 6277 too (if_setnpchead, ticks 25-1447).
  const GOLEM_NPC_ID = 6277;
  const GOLEM_NPC_IDS = new Set([
    GOLEM_NPC_ID,
    NpcIdentifiers.CLAY_GOLEM, // 917
    NpcIdentifiers.CLAY_GOLEM_2, // 918
    NpcIdentifiers.BROKEN_CLAY_GOLEM, // 5134
    NpcIdentifiers.DAMAGED_CLAY_GOLEM, // 5135
    NpcIdentifiers.CLAY_GOLEM_3, // 5136
  ]);
  const ELISSA_NPC_ID = NpcIdentifiers.ELISSA; // 5138
  const CURATOR_NPC_ID = NpcIdentifiers.CURATOR_HAIG_HALEN; // 5214

  const LETTER_ITEM_ID = ItemIdentifiers.LETTER_2; // 4615 golem_letter
  const NOTES_ITEM_ID = ItemIdentifiers.VARMENS_NOTES; // 4616
  const CABINET_KEY_ITEM_ID = ItemIdentifiers.DISPLAY_CABINET_KEY; // 4617 golem_statuettekey
  const STATUETTE_ITEM_ID = ItemIdentifiers.STATUETTE; // 4618
  const STRANGE_IMPLEMENT_ITEM_ID = ItemIdentifiers.STRANGE_IMPLEMENT; // 4619 golem_golemkey
  const MUSHROOM_ITEM_ID = ItemIdentifiers.BLACK_MUSHROOM; // 4620
  const FEATHER_ITEM_ID = ItemIdentifiers.PHOENIX_FEATHER; // 4621
  const INK_ITEM_ID = ItemIdentifiers.BLACK_DYE; // 4622 golem_ink
  const QUILL_ITEM_ID = ItemIdentifiers.PHOENIX_QUILL_PEN; // 4623
  const PROGRAM_ITEM_ID = ItemIdentifiers.GOLEM_PROGRAM; // 4624
  const SOFT_CLAY_ITEM_ID = ItemIdentifiers.SOFT_CLAY; // 1761
  const PAPYRUS_ITEM_ID = ItemIdentifiers.PAPYRUS; // 970
  const HAMMER_ITEM_ID = ItemIdentifiers.HAMMER; // 2347
  const CHISEL_ITEM_ID = ItemIdentifiers.CHISEL; // 1755
  const THRONE_GEMS = [ItemIdentifiers.RUBY, ItemIdentifiers.EMERALD, ItemIdentifiers.SAPPHIRE]; // two of each (tick 1230)

  const SEQ_PICKPOCKET = 881; // human_pickpocket: clay, the curator's pocket, the throne
  const SOUND_REPAIR_CLAY = 1850; // golem_repairclay, delay 5
  const SOUND_PICK = 2581; // pick
  const SOUND_TURN_STATUE = 1852;
  const SOUND_DEMON_DOOR = 1848;
  const SOUND_PROGRAM = 1849;
  const LOC_ANIM_DOOR_OPEN = 1909; // golem_door_open, on the temple door (tick 1184)

  // The Exam Centre's south-east bookcase.
  const BOOKCASE_OBJECT_ID = ObjectIdentifiers.BOOKCASE_20; // 6292 golem_bookcase
  const BOOKCASE_TILE = { x: 3366, y: 3332 };
  const BOOKCASE_SEARCH_TICKS = 2; // "You search the bookcase..." then the find (ticks 468 -> 470, 477 -> 479)
  // Display case 30 (3257,3453,1), vm_timeline_terracotta_statue, placed once: 24627 Study/Open, then
  // 24550 Study once emptied.
  const DISPLAY_CASE_IDS = new Set([24626, 24627]);
  const CASE_BOX_TICKS = 2; // the statuette arrives, its item box two ticks later (677 -> 679, 759 -> 761)
  const TIMELINE_GROUP = 534;
  const TIMELINE_CLOSE = 1;
  const TIMELINE_TEXT = 2;
  const TIMELINE_NUMBER = 84;
  const TIMELINE_STATUE_MODEL = 49;
  const TIMELINE_EMPTY_MODEL = 35;
  const CASE_STATUE_MODEL_ID = 25576;
  const CASE_EMPTY_MODEL_ID = 25568;
  const SET_SPINNER_SCRIPT = 65;
  const STUDY_SEQUENCE = 6383; // vm_display_case_ponder
  const BUSY_VARBIT = 12393;
  const CASE_NUMBER = "30";
  const CASE_DATE = "3rd Age - yr 3000-4000";
  const CASE_DESCRIPTION = "This statuette was found in an underground temple in the ruined city of Uzer, which was "
    + "destroyed late in the 3rd Age, suddenly, due to causes unknown. It probably represents one of the clay golems "
    + "that the craftsmen of the city built as warriors and servants. The statuette was originally part of a "
    + "mechanism whose purpose is unknown.";
  const CASE_STOLEN = "Recently this display was stolen and its whereabouts are unknown.";
  const THRONE_IDS = new Set([6300, ObjectIdentifiers.THRONE_10, ObjectIdentifiers.THRONE_11]); // 6300 -> 6301/6302
  const THRONE_TILE = { x: 2719, y: 4913, z: 2 };
  // The alcoves: the client sends the multiloc's base id (6303-6306), so the tile picks the alcove.
  const ALCOVES = [
    { slot: 0, objectId: 6303, bit: VARBIT_STATUETTE_A, x: 2718, y: 4899, target: 1 },
    { slot: 1, objectId: 6304, bit: VARBIT_STATUETTE_B, x: 2718, y: 4896, target: 1 },
    { slot: 2, objectId: 6305, bit: VARBIT_STATUETTE_C, x: 2725, y: 4899, target: 0 },
    { slot: 3, objectId: 6306, bit: VARBIT_STATUETTE_D, x: 2725, y: 4896, target: 2 },
  ];
  const ALCOVE_D = ALCOVES[3];
  const ALCOVE_OBJECT_IDS = new Set([...ALCOVES.map((alcove) => alcove.objectId), 6307, 6308, 6309]);
  const MUSHROOM_OBJECT_ID = ObjectIdentifiers.BLACK_MUSHROOMS; // 6311
  const TEMPLE_DOOR_OBJECT_IDS = new Set([6310, 6363, 6364]); // golem_portal and its two doors
  const TEMPLE_DOOR_TILE = { x: 2720, y: 4912, z: 0 };
  const SURFACE_STAIRS_OBJECT_ID = ObjectIdentifiers.STAIRCASE_35; // 6373 golem_insidestairs_top
  const TEMPLE_STAIRS_OBJECT_ID = ObjectIdentifiers.STAIRCASE_34; // 6372 golem_insidestairs_base
  const TEMPLE_LANDING = { x: 2721, y: 4886, z: 0 }; // tick 129
  const SURFACE_LANDING = { x: 3491, y: 3090, z: 0 }; // tick 1127
  const THRONE_ROOM_LANDING = { x: 2720, y: 4884, z: 2 }; // tick 1195
  const DEMON_PORTAL_OBJECT_ID = ObjectIdentifiers.PORTAL_13; // 6282 golem_demon_portal
  const DEMON_PORTAL_TILE = { x: 2719, y: 4883, z: 2 };
  const DOOR_LANDING = { x: 2721, y: 4911, z: 0 }; // tick 1250
  // The letter (3479,3092) and the strange implement (2713,4913) are world spawns (ground-items.json).
  const UZER_RUINS_ZONE = { minX: 2706, maxX: 2738, minY: 4881, maxY: 4918, levels: [0] };
  const COMPLETED_SCROLL_GROUP = 153;

  const START_HOOK = "quest:the-golem:start";
  /** Lines whose Continue moves the quest on, as the capture's ticks show. */
  const ELISSA_NOTES_LINE = /^If you're interested in his expedition, the notes he made are in the library in the Exam Centre\.$/;
  const STATUETTE_QUESTION = /^I'm looking for a statuette recovered from the city of Uzer\.$/;
  const GOLEM_DISBELIEF_LINE = /^Demon must be defeated! Task incomplete\.$/;
  const GOLEM_AT_REST_LINE = /^Thank you\. Now my mind is at rest\.$/;

  const LETTER_ATTRIBUTE = "quest.the_golem.letter";
  const CLAY_ATTRIBUTE = "quest.the_golem.clay";
  const STATUE_ATTRIBUTE = "quest.the_golem.statuettes";
  const THRONE_GEMS_ATTRIBUTE = "quest.the_golem.throne_gems";
  const RETRIEVED_ATTRIBUTE = "quest.the_golem.retrieved_statuette";
  const SEEN_ATTRIBUTE = "quest.the_golem.seen_underground";
  // The open skull lasts the session: a relog closes it (Ours: live's relog is not captured).
  const HEAD_OPEN_ATTRIBUTE = "quest.the_golem.head_open";

  /** Interface 220's lines 1-15, as captured (tick 117). */
  const LETTER_GROUP = 220;
  const LETTER_LINES = [
    "",
    "",
    "Dearest Varmen,",
    "I hope this finds you well. Here are the books you asked for.",
    "There has been an exciting development closer to home --",
    "another city from the same period has been discovered east",
    "of Varrock, and we are starting a huge excavation project",
    "here. I don't know if the museum will be able to finance your",
    "expedition as well as this one, so I fear your current trip will be",
    "the last.",
    "May Saradomin grant you a safe journey home.",
    "Your loving Elissa.",
    "",
    "",
    "",
  ];
  const NOTES_TITLE = "The Ruins of Uzer";
  /** The book's 16 pages, as captured (ticks 488-497). */
  const NOTES_PAGES = require("../data/the-golem-notes-book.json");

  /** Players whose program conversation is playing: its last line completes the quest. */
  const reprogramming = new WeakSet();

  let quest;

  const inventory = (player) => player.getInventory();
  const held = (player, itemId) => inventory(player).getAmount(itemId) > 0;
  const stageOf = (player) => quest.getStage(player);

  function numberAttribute(player, key) {
    return Number(player.getAttribute(key)) || 0;
  }

  function letterProgress(player) {
    return numberAttribute(player, LETTER_ATTRIBUTE);
  }

  function setLetterProgress(player, value) {
    player.setAttribute(LETTER_ATTRIBUTE, value);
    setVarbit(player, VARBIT_GOLEM_B, value);
  }

  function clayUsed(player) {
    return numberAttribute(player, CLAY_ATTRIBUTE);
  }

  function level(player, skill) {
    return player.getSkillManager().getCurrentLevel(skill);
  }

  function setVarbit(player, id, value) {
    player.getPacketSender().sendVarbit(id, value | 0);
  }

  function statueValue(player, slot) {
    return (numberAttribute(player, STATUE_ATTRIBUTE) >>> (slot * 2)) & 3;
  }

  function setStatueValue(player, slot, value) {
    const shift = slot * 2;
    const packed = numberAttribute(player, STATUE_ATTRIBUTE);
    player.setAttribute(STATUE_ATTRIBUTE, (packed & ~(3 << shift)) | ((value & 3) << shift));
    setVarbit(player, ALCOVES[slot].bit, value);
  }

  function headOpen(player) {
    return player.getAttribute(HEAD_OPEN_ATTRIBUTE) === true;
  }

  function setHeadOpen(player, open) {
    player.setAttribute(HEAD_OPEN_ATTRIBUTE, open);
    setVarbit(player, VARBIT_HEAD_OPEN, open ? 1 : 0);
  }

  /** Replays the varp 437 siblings after login (the stage itself is the runtime's). */
  function syncGolemVarbits(player) {
    setVarbit(player, VARBIT_GOLEM_B, letterProgress(player));
    setVarbit(player, VARBIT_GOLEM_CLAY, clayUsed(player));
    for (const alcove of ALCOVES) setVarbit(player, alcove.bit, statueValue(player, alcove.slot));
    setVarbit(player, VARBIT_HEAD_OPEN, headOpen(player) ? 1 : 0);
    setVarbit(player, VARBIT_THRONE_GEMS, player.getAttribute(THRONE_GEMS_ATTRIBUTE) ? 1 : 0);
    setVarbit(player, VARBIT_RETRIEVED_STATUETTE, player.getAttribute(RETRIEVED_ATTRIBUTE) ? 1 : 0);
    setVarbit(player, VARBIT_SEEN_UNDERGROUND, player.getAttribute(SEEN_ATTRIBUTE) ? 1 : 0);
  }

  function schedule(player, ticks, run) {
    const { CountdownTask, TaskManager } = api.core;
    TaskManager.submit(new CountdownTask(player, ticks, () => {
      if (player.isRegistered?.() === false) return;
      run();
    }));
  }

  /** An item box (objectbox 193), as live shows a hand-out; `then` runs once it is continued. */
  function itemBox(player, itemId, text, then) {
    const { DialogueChainBuilder, ItemStatementDialogue, ActionDialogue } = api.core;
    const chain = new DialogueChainBuilder().add(new ItemStatementDialogue(0, itemId, text));
    if (then) chain.add(new ActionDialogue(1, { execute: () => then() }));
    player.getDialogueManager().startDialogues(chain);
  }

  /** A plain message box (messagebox 229). */
  function messageBox(player, text) {
    const { DialogueChainBuilder, StatementDialogue } = api.core;
    player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, text)));
  }

  function spam(player, text) {
    player.getPacketSender().sendTypedMessage(api.core.ChatType.SPAM, text);
  }

  /** Into the inventory, or onto the floor under the player with a full one (Wiki: "Drops to floor"). */
  function giveOrDrop(player, itemId) {
    giveReward(player, itemId, 1);
  }

  function atTile(event, tile) {
    const location = event.location ?? event.object?.getLocation?.();
    if (!location) return true;
    const x = location.x ?? location.getX?.();
    const y = location.y ?? location.getY?.();
    return x === tile.x && y === tile.y;
  }

  function alcoveAt(event) {
    const location = event.location ?? event.object?.getLocation?.();
    if (!location) return ALCOVES.find((alcove) => alcove.objectId === event.objectId) ?? null;
    const x = location.x ?? location.getX?.();
    const y = location.y ?? location.getY?.();
    return ALCOVES.find((alcove) => alcove.x === x && alcove.y === y) ?? null;
  }

  function freeSlots(player) {
    const container = inventory(player);
    return typeof container.getFreeSlots === "function" ? container.getFreeSlots() : container.isFull() ? 0 : 28;
  }

  // --- The journal -----------------------------------------------------------------------------
  // The captured journal opens at stages 2 (ticks 100, 135, 333, 522), 3 (689), 4 (1121), 6 (1209)
  // and 7 (1288). Lines for the states no capture opens are marked "Ours".

  const GOLEM_ASKED_OPEN = [
    "The golem asked me to open the <col=800000>portal</col> so it can defeat a",
    "<col=800000>demon</col>.",
  ];
  const GOLEM_ASKED_OPEN_DONE = [
    "<str>The golem asked me to open the portal so it could defeat a",
    "<str>demon.",
  ];

  function journalLetterLines(player, stage) {
    const progress = letterProgress(player);
    const lines = [];
    if (progress === LETTER_READ) {
      lines.push("Maybe I should speak to <col=800000>Elissa</col> at the <col=800000>Digsite</col> about the letter I");
      lines.push("found in Uzer.");
      return lines;
    }
    if (progress >= ELISSA_TOLD) lines.push("<str>I talked to Elissa about the letter from the desert.");
    if (progress === ELISSA_TOLD) {
      // Ours: no capture opens the journal between Elissa and the notes.
      lines.push("Elissa told me that <col=800000>Varmen's notes</col> are in the library in the");
      lines.push("<col=800000>Digsite Exam Centre</col>.");
      return lines;
    }
    if (progress >= NOTES_READ) lines.push("<str>I took Varmen's notes from the Digsite Exam Centre.");
    if (progress >= NOTES_READ && !player.getAttribute(RETRIEVED_ATTRIBUTE) && stage < STAGE_STATUETTE_REPLACED) {
      // Captured at stage 2 (tick 522); kept at stage 3 until the statuette is taken (Ours).
      lines.push("According to <col=800000>Varmen's notes</col>, he removed the <col=800000>statuette</col>");
      lines.push("during his expedition.");
    }
    return lines;
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage <= STAGE_NOT_STARTED) {
      return [
        "I can start this quest by talking to the <col=800000>golem</col> in the",
        "ruined city of <col=800000>Uzer</col>, in the desert east of the",
        "<col=800000>Shantay Pass</col>.",
        "",
        "I will need level 20 Crafting and level 25 Thieving.",
      ];
    }
    if (stage === STAGE_REPAIR_GOLEM) {
      // Ours: no capture opens the journal before the repairs are done.
      return [
        "<str>I have spoken to the golem.",
        "The <col=800000>golem</col> asked me to repair it with <col=800000>soft clay</col>.",
      ];
    }
    const lines = ["<str>I have spoken to the golem.", "<str>I have repaired the golem."];
    if (stage <= STAGE_FIND_STATUETTE) {
      lines.push(...GOLEM_ASKED_OPEN);
      if (player.getAttribute(RETRIEVED_ATTRIBUTE)) {
        lines.push(...journalLetterLines(player, stage));
        lines.push("<str>I have retrieved the missing statuette from the Varrock");
        lines.push("<str>Museum.");
        lines.push("I should take the <col=800000>statuette</col> to Uzer and put it back in the");
        lines.push("temple.");
        return lines;
      }
      if (player.getAttribute(SEEN_ATTRIBUTE)) {
        lines.push("To open the portal I will need to find a missing <col=800000>statuette</col>.");
      } else {
        lines.push("I should go down the stairs in <col=800000>Uzer</col> and work out how to open");
        lines.push("the <col=800000>portal</col>.");
      }
      lines.push(...journalLetterLines(player, stage));
      return lines;
    }
    const replaced = [
      "<str>I talked to Elissa about the letter from the desert.",
      "<str>I took Varmen's notes from the Digsite Exam Centre.",
      "<str>I have retrieved the missing statuette from the Varrock",
      "<str>Museum and repaired the puzzle in the temple.",
    ];
    if (stage === STAGE_STATUETTE_REPLACED) {
      return [
        ...lines, ...GOLEM_ASKED_OPEN, ...replaced,
        "I should turn the <col=800000>statuettes</col> to the correct sequence to open",
        "the <col=800000>portal</col>.",
      ];
    }
    lines.push(...GOLEM_ASKED_OPEN_DONE, ...replaced, "<str>I have opened the portal.");
    // Ours: stage 5 (the door open, the room not yet entered) is not captured.
    if (stage === STAGE_PORTAL_OPENED) return lines;
    lines.push("<str>I have visited the demon's lair and seen its skeleton.");
    if (stage === STAGE_DEMON_DEAD) {
      lines.push("I should inform the <col=800000>golem</col> that the <col=800000>demon</col> is dead.");
      return lines;
    }
    lines.push("<str>I told the golem that the demon was dead, but it did not", "<str>believe me!");
    if (stage < STAGE_COMPLETE) {
      lines.push("I should find some way to convince the <col=800000>golem</col> that its task is", "done.");
      return lines;
    }
    // Ours: the completed journal is not captured.
    lines.push("<str>I reprogrammed the golem so that it knows its task is complete.", "", "<col=ff0000>QUEST COMPLETE!");
    return lines;
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.CRAFTING, 1000);
    player.getSkillManager().addExperiences(Skill.THIEVING, 1000);
  }

  // --- Who plays which transcript ----------------------------------------------------------------

  /** The curator's statuette conversation, once the notes are read and until the quest ends. */
  function curatorStepActive(player) {
    const stage = stageOf(player);
    return stage >= STAGE_OPEN_PORTAL && stage < STAGE_COMPLETE && letterProgress(player) >= NOTES_READ;
  }

  function golemVariant(player) {
    const stage = stageOf(player);
    if (stage >= STAGE_COMPLETE) return "post-quest-talking-to-the-golem";
    if (stage >= STAGE_CONVINCE_GOLEM) {
      return "returning-to-uzer-talking-to-the-golem-again-after-being-told-the-demon-must-be-defeated";
    }
    if (stage === STAGE_DEMON_DEAD) return "returning-to-uzer-talking-to-the-golem-after-entering-the-throne-of-the-demon";
    if (stage === STAGE_PORTAL_OPENED) return "returning-to-uzer-talking-to-the-golem-after-opening-the-portal";
    if (stage >= STAGE_OPEN_PORTAL) {
      return "using-the-soft-clay-on-the-golem-talking-to-the-golem-again-after-learning-about-the-demon";
    }
    if (stage >= STAGE_REPAIR_GOLEM) return "talking-to-the-golem-to-start-the-quest-talking-to-the-golem-after-starting-the-quest";
    return "talking-to-the-golem-to-start-the-quest";
  }

  /** Which transcript variant each speaker plays. */
  function selectVariant({ npcId, player }) {
    if (GOLEM_NPC_IDS.has(npcId)) return { page: PAGE, variant: golemVariant(player) };
    if (npcId === ELISSA_NPC_ID) {
      // Tick 1934: after the quest her first menu, without the letter (handleMenu).
      if (quest.isComplete(player)) return { page: PAGE, variant: "talking-to-elissa-in-the-digsite" };
      const progress = letterProgress(player);
      if (progress >= NOTES_READ) return { page: PAGE, variant: "talking-to-elissa-in-the-digsite-talking-to-elissa-after-reading-varmen-s-notes" };
      if (progress >= ELISSA_TOLD) {
        return { page: PAGE, variant: "talking-to-elissa-in-the-digsite-talking-to-elissa-again-after-learning-where-the-notes-are" };
      }
      return { page: PAGE, variant: "talking-to-elissa-in-the-digsite" };
    }
    if (npcId === CURATOR_NPC_ID) {
      // Wiki: "If no dialogue options appear, you did not read the notes!" Dig Site and Bone
      // Voyage keep the curator otherwise (the-golem:curator-step).
      if (!curatorStepActive(player)) return null;
      if (player.getAttribute(RETRIEVED_ATTRIBUTE)) {
        return { page: PAGE, variant: "visiting-the-varrock-museum-talking-to-curator-haig-after-losing-the-statuette" };
      }
      return { page: PAGE, variant: "visiting-the-varrock-museum-talking-to-curator-haig-in-the-varrock-museum" };
    }
    return null;
  }

  /**
   * The curator's "Talk about Fossil Island." borrows his own page's "After Bone Voyage:"
   * (osrsreboxed-db capture source); its step ids in this page's two museum variants.
   */
  const FOSSIL_ISLAND_OPTION_IDS = new Set(["8odAmY", "7sx9Pa"]);

  function answerCondition({ player, npcId, stepId }) {
    if (npcId !== CURATOR_NPC_ID || !FOSSIL_ISLAND_OPTION_IDS.has(stepId)) return null;
    const request = { player, key: "bone_voyage", complete: false };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  const LETTER_OPTION = "I found a letter in the desert with your name on.";

  /** Ticks 1934 and 1940: after the quest Elissa's menu is "What do you do here?|What is this place?|Sorry, I need to go." */
  function handleMenu(notice) {
    if (notice.npcId !== ELISSA_NPC_ID || !notice.player || !quest.isComplete(notice.player)) return;
    if (!notice.options.some((option) => option.text === LETTER_OPTION)) return;
    notice.options = notice.options.filter((option) => option.text !== LETTER_OPTION);
  }

  /** the-golem:curator-step { player, active }: Dig Site and Bone Voyage ask before they claim the curator. */
  function answerCuratorStep(request) {
    if (request?.player) request.active = curatorStepActive(request.player);
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!GOLEM_NPC_IDS.has(npcId) || hook !== START_HOOK) return;
    if (stageOf(player) >= STAGE_REPAIR_GOLEM) return;
    quest.setStage(player, STAGE_REPAIR_GOLEM);
    // Tick 28: the start line comes as "Yes." is picked, before the player's line.
    player.sendMessage(questStartMessage(player, quest.name));
  }

  /** Lines whose Continue moves the quest on (`after` runs once the player continues past it). */
  function handleDialogueLine(event) {
    const { player } = event;
    const text = String(event.text ?? "");
    const chain = (run) => {
      const previous = event.after;
      event.after = () => { previous?.(); run(); };
    };
    // Tick 376 -> 377: Elissa naming the library sets golem_b 2.
    if (event.npcId === ELISSA_NPC_ID && ELISSA_NOTES_LINE.test(text)) {
      chain(() => { if (letterProgress(player) < ELISSA_TOLD) setLetterProgress(player, ELISSA_TOLD); });
      return;
    }
    // Tick 612 -> 614: asking the curator about the statuette is stage 3.
    if (event.npcId === CURATOR_NPC_ID && typeof event.step?.player === "string" && STATUETTE_QUESTION.test(text)) {
      chain(() => {
        if (stageOf(player) === STAGE_OPEN_PORTAL && letterProgress(player) >= NOTES_READ) quest.setStage(player, STAGE_FIND_STATUETTE);
      });
      return;
    }
    if (!GOLEM_NPC_IDS.has(event.npcId)) return;
    if (typeof event.step?.player !== "string") {
      // Live's head is the multi-NPC itself and its name the form it shows (ticks 25, 51, 65).
      event.speakerId = GOLEM_NPC_ID;
      event.speakerName = golemName(player);
    }
    // Tick 1275 -> 1276: the golem refusing to believe it is stage 7.
    if (GOLEM_DISBELIEF_LINE.test(text)) {
      chain(() => { if (stageOf(player) === STAGE_DEMON_DEAD) quest.setStage(player, STAGE_CONVINCE_GOLEM); });
      return;
    }
    // Tick 1437 -> 1438: the golem's last line completes the quest and takes the program.
    if (GOLEM_AT_REST_LINE.test(text) && reprogramming.has(player)) {
      chain(() => completeQuest(player));
    }
  }

  /** The name of the form 6277 shows (varbit 348: 0-1 broken, 2-3 damaged, 4 repaired). */
  function golemName(player) {
    const clay = stageOf(player) >= STAGE_OPEN_PORTAL ? CLAY_REPAIRS : clayUsed(player);
    const form = clay >= CLAY_REPAIRS ? NpcIdentifiers.CLAY_GOLEM_3
      : clay >= 2 ? NpcIdentifiers.DAMAGED_CLAY_GOLEM : NpcIdentifiers.BROKEN_CLAY_GOLEM;
    return api.core.NpcDefinition.forId(form)?.getName?.() ?? "Clay golem";
  }

  function completeQuest(player) {
    reprogramming.delete(player);
    if (quest.isComplete(player) || stageOf(player) !== STAGE_CONVINCE_GOLEM || !held(player, PROGRAM_ITEM_ID)) return;
    inventory(player).deleteNumber(PROGRAM_ITEM_ID, 1);
    quest.complete(player);
  }

  /** Tick 1442: the skull shuts as the completion scroll closes. */
  function handleInterfaceClosed({ player, interfaceId }) {
    if (interfaceId === TIMELINE_GROUP) player.getPacketSender().sendVarbit(BUSY_VARBIT, 0);
    if (interfaceId === COMPLETED_SCROLL_GROUP && headOpen(player) && quest.isComplete(player)) shutSkull(player);
  }

  function shutSkull(player) {
    setHeadOpen(player, false);
    player.sendMessage("The golem's skull shuts automatically.");
  }

  // --- Reading -----------------------------------------------------------------------------------

  /** Reading Varmen's letter starts the hunt (tick 117); reading his notes sets golem_b 3 (tick 487). */
  function handleItemAction(event) {
    const option = String(event.option ?? "").toLowerCase();
    if (!option.includes("read")) return;
    if (event.itemId === LETTER_ITEM_ID) {
      // Ours: the letter is a world spawn; read before the start it moves nothing (no capture reads it then).
      if (letterProgress(event.player) === 0 && quest.isStarted(event.player)) setLetterProgress(event.player, LETTER_READ);
      showLetter(event.player);
      event.handled = true;
      return;
    }
    if (event.itemId === NOTES_ITEM_ID) {
      if (letterProgress(event.player) === ELISSA_TOLD) setLetterProgress(event.player, NOTES_READ);
      openBook(event.player, NOTES_TITLE, NOTES_PAGES);
      event.handled = true;
    }
  }

  function showLetter(player) {
    const sender = player.getPacketSender();
    LETTER_LINES.forEach((line, index) => sender.sendString(line, (LETTER_GROUP << 16) | (index + 1)));
    sender.sendInterfaceScript(2524, [-1, -1]);
    sender.sendInterface(LETTER_GROUP);
  }

  // --- The golem ---------------------------------------------------------------------------------

  const CLAY_BOXES = [
    "You apply some clay to the golem's wounds. The clay begins to harden in the hot sun.",
    "You fix the golem's legs.",
    "The golem is nearly whole.",
    "You repair the golem with a final piece of clay.",
  ];

  /** Ticks 36-63: each soft clay is an animation, the repair sound and an item box. */
  function repairGolem(player, npcId) {
    const stage = stageOf(player);
    if (stage <= STAGE_NOT_STARTED) {
      player.sendMessage("Maybe you should ask the golem first!");
      return true;
    }
    if (stage !== STAGE_REPAIR_GOLEM) return false;
    if (level(player, Skill.CRAFTING) < CRAFTING_LEVEL) {
      // Ours: the Wiki gives the requirement, not the refusal.
      player.sendMessage(`You need a Crafting level of ${CRAFTING_LEVEL} to repair the golem.`);
      return true;
    }
    inventory(player).deleteNumber(SOFT_CLAY_ITEM_ID, 1);
    const used = Math.min(CLAY_REPAIRS, clayUsed(player) + 1);
    player.setAttribute(CLAY_ATTRIBUTE, used);
    setVarbit(player, VARBIT_GOLEM_CLAY, used);
    player.performAnimation(new Animation(SEQ_PICKPOCKET));
    player.getPacketSender().sendSound(SOUND_REPAIR_CLAY, 1, 5);
    if (used < CLAY_REPAIRS) {
      itemBox(player, SOFT_CLAY_ITEM_ID, CLAY_BOXES[used - 1]);
      return true;
    }
    quest.setStage(player, STAGE_OPEN_PORTAL);
    itemBox(player, SOFT_CLAY_ITEM_ID, CLAY_BOXES[3], () =>
      startTranscript(api, player, npcId, PAGE, "using-the-soft-clay-on-the-golem-after-using-the-fourth-soft-clay",
        (steps) => steps.filter((step) => step.type !== "message")));
    return true;
  }

  /** Tick 1430: the strange implement opens the skull for the program. */
  function useImplement(player) {
    if (stageOf(player) !== STAGE_CONVINCE_GOLEM || headOpen(player)) return false;
    setHeadOpen(player, true);
    player.sendMessage("You insert the key and the golem's skull hinges open.");
    // Wiki "without the new instructions": with nothing to put in, it shuts again (Ours: a tick later).
    if (!held(player, PROGRAM_ITEM_ID)) schedule(player, 1, () => { if (headOpen(player)) shutSkull(player); });
    return true;
  }

  /** Ticks 1434-1438: the program plays the golem's three lines, the last of which completes. */
  function useProgram(player, npcId) {
    if (quest.isComplete(player)) return false;
    if (!headOpen(player)) {
      player.sendMessage("You can't see a way to put the instructions in the golem's skull");
      return true;
    }
    if (stageOf(player) !== STAGE_CONVINCE_GOLEM) return false;
    player.getPacketSender().sendSound(SOUND_PROGRAM, 1, 0);
    reprogramming.add(player);
    startTranscript(api, player, npcId, PAGE,
      "returning-to-uzer-after-using-the-strange-implement-on-the-golem-in-uzer-and-adding-the-new-instructions");
    return true;
  }

  function handleItemOnNpc(event) {
    const npcId = event.npcId ?? event.target?.getId?.();
    // Every item-on-NPC hook runs; Shadow of the Storm registers first and takes the implement
    // in its own stages.
    if (event.handled || !GOLEM_NPC_IDS.has(npcId)) return;
    const { player } = event;
    event.handled = true;
    if (event.itemId === SOFT_CLAY_ITEM_ID && repairGolem(player, GOLEM_NPC_ID)) return;
    if (event.itemId === STRANGE_IMPLEMENT_ITEM_ID && useImplement(player)) return;
    if (event.itemId === PROGRAM_ITEM_ID && useProgram(player, GOLEM_NPC_ID)) return;
    // Anything else, as the statuette at tick 1081 (the engine has no item-on-NPC default).
    player.sendMessage("Nothing interesting happens.");
  }

  // --- Making the program ------------------------------------------------------------------------

  /** Converts the clicked copy in place, keeping its slot. */
  function convert(player, fromId, toId) {
    const items = inventory(player).getItems?.() ?? [];
    const slot = items.findIndex((item) => item?.getId() === fromId);
    if (slot >= 0 && typeof items[slot].setId === "function") {
      items[slot].setId(toId);
      inventory(player).refreshItems?.();
      return;
    }
    inventory(player).deleteNumber(fromId, 1);
    inventory(player).adds(toId, 1);
  }

  function handleItemOnItem(event) {
    const { player } = event;
    const ids = [event.usedItemId, event.usedWithItemId];
    const pair = (a, b) => ids.includes(a) && ids.includes(b);
    // The pestle on the mushroom (black dye) is Land of the Goblins' (it registers first), for everyone.
    if (pair(INK_ITEM_ID, FEATHER_ITEM_ID)) {
      event.handled = true;
      // Tick 1388: the feather becomes the pen; the dye is not used up.
      convert(player, FEATHER_ITEM_ID, QUILL_ITEM_ID);
      itemBox(player, QUILL_ITEM_ID, "You dip the phoenix feather into the dye.");
      return;
    }
    if (pair(PAPYRUS_ITEM_ID, FEATHER_ITEM_ID)) {
      event.handled = true;
      player.sendMessage("You will need some kind of ink to write with.");
      return;
    }
    if (pair(PAPYRUS_ITEM_ID, QUILL_ITEM_ID)) {
      event.handled = true;
      writeProgram(player);
    }
  }

  /** Tick 1405 -> 1406: one tick, the papyrus becomes the program; the pen is kept. */
  function writeProgram(player) {
    if (stageOf(player) < STAGE_DEMON_DEAD) {
      player.sendMessage("You don't know what to write.");
      return;
    }
    if (level(player, Skill.CRAFTING) < CRAFTING_LEVEL) {
      // Ours: the Wiki gives the level (boostable), not the refusal.
      player.sendMessage(`You need a Crafting level of ${CRAFTING_LEVEL} to write the program.`);
      return;
    }
    schedule(player, 1, () => {
      if (!held(player, PAPYRUS_ITEM_ID) || !held(player, QUILL_ITEM_ID)) return;
      convert(player, PAPYRUS_ITEM_ID, PROGRAM_ITEM_ID);
      itemBox(player, PROGRAM_ITEM_ID, "You write on the papyrus:<br>YOUR TASK IS DONE");
    });
  }

  // --- The museum --------------------------------------------------------------------------------

  /**
   * Study on display 30. Interface and components are the cache's (vm_timeline, 534), as captured
   * at ticks 670 and 680: the text, then the number, then the model of the case as it stands.
   */
  function studyDisplayCase(player) {
    const stolen = Boolean(player.getAttribute(RETRIEVED_ATTRIBUTE));
    const text = [CASE_DATE, CASE_DESCRIPTION, ...(stolen ? [CASE_STOLEN] : [])].join("<br><br>");
    const model = (TIMELINE_GROUP << 16) | (stolen ? TIMELINE_EMPTY_MODEL : TIMELINE_STATUE_MODEL);
    const sender = player.getPacketSender();
    sender.sendVarbit(BUSY_VARBIT, 1);
    player.performAnimation(new Animation(STUDY_SEQUENCE));
    sender.sendString(text, (TIMELINE_GROUP << 16) | TIMELINE_TEXT);
    sender.sendString(CASE_NUMBER, (TIMELINE_GROUP << 16) | TIMELINE_NUMBER);
    sender.sendInterfaceRawModel(model, stolen ? CASE_EMPTY_MODEL_ID : CASE_STATUE_MODEL_ID);
    sender.sendClientScript(SET_SPINNER_SCRIPT, 0, 5, 0, model);
    sender.sendInterfaceScript(2524, [0, 100]);
    sender.sendInterface(TIMELINE_GROUP);
  }

  function closeTimeline({ player }) {
    player.getPacketSender().sendInterfaceRemoval();
  }

  /** Ticks 676-679 (Open) and 758-761 (the key on the emptied case): the statuette, then its box. */
  function retrieveStatuette(player) {
    if (held(player, STATUETTE_ITEM_ID)) {
      player.sendMessage("You have already taken the statuette.");
      return;
    }
    if (!player.getAttribute(RETRIEVED_ATTRIBUTE)) {
      player.setAttribute(RETRIEVED_ATTRIBUTE, true);
      setVarbit(player, VARBIT_RETRIEVED_STATUETTE, 1);
    }
    giveOrDrop(player, STATUETTE_ITEM_ID);
    schedule(player, CASE_BOX_TICKS, () => itemBox(player, STATUETTE_ITEM_ID, "You open the cabinet and retrieve the statuette."));
  }

  function openDisplayCase(player) {
    if (!held(player, CABINET_KEY_ITEM_ID)) {
      player.sendMessage("The cabinet is locked.");
      return;
    }
    retrieveStatuette(player);
  }

  /** Tick 649 -> 651: the key, once the curator has told the player where the statuette is. */
  function pickCuratorPocket(event) {
    const { player } = event;
    if (stageOf(player) !== STAGE_FIND_STATUETTE || ownsKey(player)) {
      // Ours past the statuette step: the Wiki's line for the step before it.
      player.sendMessage("The curator doesn't seem to have anything of value.");
      return;
    }
    if (level(player, Skill.THIEVING) < THIEVING_LEVEL) {
      // Ours: the pickpocketing plugin's refusal wording.
      messageBox(player, `You need level ${THIEVING_LEVEL} thieving to pick the curator's pocket.`);
      return;
    }
    player.performAnimation(new Animation(SEQ_PICKPOCKET));
    player.getPacketSender().sendSound(SOUND_PICK, 1, 10);
    giveOrDrop(player, CABINET_KEY_ITEM_ID);
    // The capture's box reads "You pick the curator's pocket and steal a key." (tick 651, and local
    // recording 1001607); the Wiki transcript's wording is kept.
    itemBox(player, CABINET_KEY_ITEM_ID, "You steal a tiny key.");
  }

  /** Wiki: only one copy of the key can be obtained. */
  function ownsKey(player) {
    const holds = (container) => container?.getItems?.().some((item) => item?.getId?.() === CABINET_KEY_ITEM_ID && item.getAmount() > 0);
    if (holds(inventory(player))) return true;
    const tabs = api.core.Bank?.TOTAL_BANK_TABS ?? 0;
    for (let tab = 0; tab < tabs; tab++) if (holds(player.getBank?.(tab))) return true;
    return false;
  }

  // --- The temple --------------------------------------------------------------------------------

  /** Tick 1100 -> 1102: the statuette goes into the empty alcove, facing left. */
  function insertStatuette(event) {
    const { player } = event;
    const alcove = alcoveAt(event);
    if (alcove !== ALCOVE_D || statueValue(player, ALCOVE_D.slot) !== 0 || stageOf(player) !== STAGE_FIND_STATUETTE) {
      player.sendMessage("There is already a statuette in the alcove.");
      return;
    }
    inventory(player).deleteNumber(STATUETTE_ITEM_ID, 1);
    player.sendMessage("You insert the statuette into the alcove.");
    setStatueValue(player, ALCOVE_D.slot, 1);
    quest.setStage(player, STAGE_STATUETTE_REPLACED);
  }

  /**
   * Ticks 1169-1184. A-C turn between right (0) and left (1); the placed one between left (1) and
   * right (2). Once they face a=1 b=1 c=0 d=2 the door grinds open and they lock.
   */
  function turnStatuette(player, alcove) {
    if (stageOf(player) >= STAGE_PORTAL_OPENED) {
      player.sendMessage("The statuette is now locked in place.");
      return;
    }
    const current = statueValue(player, alcove.slot);
    // The empty alcove (6309) has no Turn on live.
    if (alcove === ALCOVE_D && (current === 0 || current === 3)) return;
    const next = alcove === ALCOVE_D ? (current === 1 ? 2 : 1) : (current === 1 ? 0 : 1);
    setStatueValue(player, alcove.slot, next);
    const left = alcove === ALCOVE_D ? next === 1 : next === 1;
    player.sendMessage(`You turn the statuette to the ${left ? "left" : "right"}.`);
    player.getPacketSender().sendSound(SOUND_TURN_STATUE, 1, 0);
    const solved = stageOf(player) === STAGE_STATUETTE_REPLACED
      && ALCOVES.every((entry) => statueValue(player, entry.slot) === entry.target);
    if (!solved) return;
    quest.setStage(player, STAGE_PORTAL_OPENED);
    player.sendMessage("The door grinds open.");
    const door = templeDoor();
    if (door) player.getPacketSender().sendObjectAnimation(door, new Animation(LOC_ANIM_DOOR_OPEN));
    player.getPacketSender().sendSound(SOUND_DEMON_DOOR, 1, 0);
  }

  function templeDoor() {
    const tile = new Location(TEMPLE_DOOR_TILE.x, TEMPLE_DOOR_TILE.y, TEMPLE_DOOR_TILE.z);
    return api.core.MapObjects?.getObjectsAt?.(tile, null)?.find((object) => TEMPLE_DOOR_OBJECT_IDS.has(object.getId())) ?? null;
  }

  /** Ticks 1105-1112 (shut) and 1190-1195 (open): the door, then the throne room on plane 2. */
  function useTempleDoor(player) {
    const stage = stageOf(player);
    if (stage < STAGE_PORTAL_OPENED) {
      player.sendMessage("You can't find any way to open the door.");
      return;
    }
    spam(player, "You step into the portal.");
    if (stage === STAGE_PORTAL_OPENED) {
      quest.setStage(player, STAGE_DEMON_DEAD);
      player.sendMessage("This room is dominated by a colossal horned skeleton!");
    }
    player.moveTo(new Location(THRONE_ROOM_LANDING.x, THRONE_ROOM_LANDING.y, THRONE_ROOM_LANDING.z));
  }

  /** Doors owns the generic "Door" name hook; claim the temple door before it does. */
  function handleDoorToggle(event) {
    if (event.handled || !TEMPLE_DOOR_OBJECT_IDS.has(event.objectId)) return;
    if (!atTile(event, TEMPLE_DOOR_TILE)) return;
    event.handled = true;
    useTempleDoor(event.player);
  }

  /** Tick 1230: hammer and chisel take two of each gem from the throne. */
  function prisGems(player) {
    if (!held(player, HAMMER_ITEM_ID) || !held(player, CHISEL_ITEM_ID)) {
      player.sendMessage("You'll need a chisel as well as a hammer to get the gems.");
      return;
    }
    if (freeSlots(player) < THRONE_GEMS.length * 2) {
      // Ours: the Wiki and the capture have no full-inventory case.
      player.sendMessage("You don't have enough inventory space.");
      return;
    }
    player.setAttribute(THRONE_GEMS_ATTRIBUTE, true);
    setVarbit(player, VARBIT_THRONE_GEMS, 1);
    player.performAnimation(new Animation(SEQ_PICKPOCKET));
    player.getPacketSender().sendSound(SOUND_PICK, 1, 0);
    for (const gem of THRONE_GEMS) inventory(player).adds(gem, 2);
    itemBox(player, THRONE_GEMS[0], "You prise the gems from the demon's throne.");
  }

  function handleItemOnObject(event) {
    if (event.handled) return;
    const { player } = event;
    if (event.itemId === STATUETTE_ITEM_ID && ALCOVE_OBJECT_IDS.has(event.objectId)) {
      event.handled = true;
      insertStatuette(event);
      return;
    }
    if (event.itemId === CABINET_KEY_ITEM_ID && DISPLAY_CASE_IDS.has(event.objectId)) {
      event.handled = true;
      retrieveStatuette(player);
      return;
    }
    if ((event.itemId === HAMMER_ITEM_ID || event.itemId === CHISEL_ITEM_ID) && THRONE_IDS.has(event.objectId)
      && atTile(event, THRONE_TILE) && !player.getAttribute(THRONE_GEMS_ATTRIBUTE)) {
      event.handled = true;
      prisGems(player);
    }
  }

  /** Recorded pick (rsprox 226/01694, 235/03333, 241/911592, 242 tick 1283): animation, sound, item box. */
  function pickMushroomBox(player) {
    const { CacheDefinitions } = api.core;
    player.performAnimation(new Animation(CacheDefinitions.getSeqId("human_pickuptable")));
    player.getPacketSender().sendSound(SOUND_PICK, 1, 0);
    itemBox(player, MUSHROOM_ITEM_ID, "You pick a mushroom.");
  }

  /** Ticks 463-479: the search line, then the find two ticks later. */
  function searchBookcase(player) {
    player.sendMessage("You search the bookcase...");
    schedule(player, BOOKCASE_SEARCH_TICKS, () => {
      if (held(player, NOTES_ITEM_ID)) {
        player.sendMessage("You already have Varmen's expedition notes, so you find nothing of interest.");
        return;
      }
      giveOrDrop(player, NOTES_ITEM_ID);
      itemBox(player, NOTES_ITEM_ID, "You find Varmen's expedition notes.");
    });
  }

  function interactionOption(event) {
    return String(event.option ?? event.definition?.getInteractions?.()?.[event.clickType - 1] ?? "").toLowerCase();
  }

  function handleObjectInteraction(event) {
    if (event.handled) return;
    const { player, objectId } = event;
    if (objectId === MUSHROOM_OBJECT_ID) {
      event.handled = true;
      if (!held(player, MUSHROOM_ITEM_ID)) inventory(player).adds(MUSHROOM_ITEM_ID, 1);
      pickMushroomBox(player);
      return;
    }
    if (objectId === BOOKCASE_OBJECT_ID) {
      // Elsewhere, or before Elissa names it, it is the world's ordinary bookcase.
      if (!atTile(event, BOOKCASE_TILE)) return;
      if (letterProgress(player) < ELISSA_TOLD && !quest.isComplete(player)) return;
      event.handled = true;
      searchBookcase(player);
      return;
    }
    if (DISPLAY_CASE_IDS.has(objectId)) {
      const option = interactionOption(event);
      if (option.includes("study")) {
        event.handled = true;
        studyDisplayCase(player);
        return;
      }
      if (!option.includes("open")) return;
      event.handled = true;
      openDisplayCase(player);
      return;
    }
    if (ALCOVE_OBJECT_IDS.has(objectId)) {
      const alcove = alcoveAt(event);
      if (!alcove) return;
      event.handled = true;
      turnStatuette(player, alcove);
      return;
    }
    if (TEMPLE_DOOR_OBJECT_IDS.has(objectId) && atTile(event, TEMPLE_DOOR_TILE)) {
      event.handled = true;
      useTempleDoor(player);
      return;
    }
    if (objectId === SURFACE_STAIRS_OBJECT_ID) {
      event.handled = true;
      // Tick 128 -> 129: the landing and the first-visit flag on the same tick.
      markSeenUnderground(player);
      player.moveTo(new Location(TEMPLE_LANDING.x, TEMPLE_LANDING.y, TEMPLE_LANDING.z));
      return;
    }
    if (objectId === TEMPLE_STAIRS_OBJECT_ID) {
      event.handled = true;
      player.moveTo(new Location(SURFACE_LANDING.x, SURFACE_LANDING.y, SURFACE_LANDING.z));
      return;
    }
    if (objectId === DEMON_PORTAL_OBJECT_ID && atTile(event, DEMON_PORTAL_TILE)) {
      event.handled = true;
      spam(player, "You step into the portal.");
      player.moveTo(new Location(DOOR_LANDING.x, DOOR_LANDING.y, DOOR_LANDING.z));
    }
  }

  /** The first visit below the ruins sets seen_underground (tick 129). */
  function markSeenUnderground(player) {
    if (player.getAttribute(SEEN_ATTRIBUTE)) return;
    player.setAttribute(SEEN_ATTRIBUTE, true);
    setVarbit(player, VARBIT_SEEN_UNDERGROUND, 1);
  }

  function handleNpcInteraction(event) {
    const { player } = event;
    const actions = event.definition?.getActions?.() ?? [];
    const action = String(actions[event.clickType - 1] ?? "").toLowerCase();
    // The world's golem (6277) is not in the dialogue index, so its Talk-to plays here. Shadow of
    // the Storm registers first and claims it in its own stages.
    if (GOLEM_NPC_IDS.has(event.npcId) && action === "talk-to") {
      event.handled = true;
      startTranscript(api, player, GOLEM_NPC_ID, PAGE, golemVariant(player));
      return;
    }
    if (event.npcId === CURATOR_NPC_ID && action === "pickpocket") {
      event.handled = true;
      pickCuratorPocket(event);
    }
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
    // The skull is open for the session only.
    if (headOpen(player)) player.setAttribute(HEAD_OPEN_ATTRIBUTE, false);
    syncGolemVarbits(player);
  }

  function handleLogout({ player }) {
    reprogramming.delete(player);
  }

  function handleRuinsZoneEnter({ player }) {
    if (player?.isPlayerBot?.() === true) return;
    markSeenUnderground(player);
  }

  api.persistAttribute(LETTER_ATTRIBUTE, 0);
  api.persistAttribute(CLAY_ATTRIBUTE, 0);
  api.persistAttribute(STATUE_ATTRIBUTE, 0);
  api.persistAttribute(THRONE_GEMS_ATTRIBUTE, false);
  api.persistAttribute(RETRIEVED_ATTRIBUTE, false);
  api.persistAttribute(SEEN_ATTRIBUTE, false);

  quest = registerQuest(api, {
    key: "the_golem",
    name: "The Golem",
    varpId: VARP_THE_GOLEM,
    varbitId: VARBIT_THE_GOLEM,
    startedValue: STAGE_REPAIR_GOLEM,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [
      { skillId: Skill.CRAFTING.getIndex(), amount: 1000, label: "Crafting" },
      { skillId: Skill.THIEVING.getIndex(), amount: 1000, label: "Thieving" },
    ],
    scrollItemId: STATUETTE_ITEM_ID,
    scrollItemPosition: [78, 126], // tick 1438
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("the-golem:curator-step", answerCuratorStep);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onCustomEvent("npc-dialogue:menu", handleMenu);
  api.onItemAction(handleItemAction);
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onObjectInteraction(handleObjectInteraction);
  api.onCustomEvent("interface:closed", handleInterfaceClosed);
  api.onInterfaceActionButton((TIMELINE_GROUP << 16) | TIMELINE_CLOSE, closeTimeline);
  api.onCustomEvent("door:toggle", handleDoorToggle);
  api.onNpcInteraction(handleNpcInteraction);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
  api.onZoneEnter(UZER_RUINS_ZONE, handleRuinsZoneEnter);
};
