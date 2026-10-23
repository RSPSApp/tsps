/**
 * The Golem (members).
 *
 * Words come from the "The Golem" transcript page; this plugin supplies the
 * variant selector for the clay golem (917/918/5134/5135/5136), Elissa (5138)
 * and Curator Haig Halen (5214), the prose-condition answers, the start hook,
 * the soft-clay repairs, the letter/statuette hunt, the temple statue puzzle,
 * the demon's lair and the reprogramming that completes the quest.
 *
 * Stages (varbit 346 golem_a, varp 437 golem_quest bits 0-4): 0 unstarted, 1 repair golem, 2 open portal, 3 find
 * statuette, 4 statuette replaced, 5 portal opened, 6 demon dead, 7 convince
 * golem, 10 complete.
 *
 * Route source: Quest Helper pinned at
 * https://github.com/Zoinkwiz/quest-helper/blob/06da90f982518a093f2fe1c9cfac5547fa7053d3/src/main/java/com/questhelper/helpers/quests/thegolem/TheGolem.java
 * Packet evidence: RSProx capture 3333, which shows
 * seen_underground set on first ruin entry, golem_b 1/2/3 on letter/Elissa/notes,
 * stage 3 on the curator talk, and head_open cleared two ticks after completion.
 * Cache state follows varp 437: 347 golem_b (letter/Elissa/notes/curator),
 * 348 golem_clay (transforms NPC 6277 to 5134/5135/5136), 349-352 the four
 * statuette facings, 353 head open, 354 throne gems, 355 retrieved statuette
 * (transforms the museum case) and 356 seen underground. The values live in
 * JSON varbits; persisted attributes replay them after login.
 *
 * Items on the floor follow Quest Helper: the letter lies at 3479,3092 in
 * Uzer and the strange implement at 2713,4913 underground. They are spawned
 * for the owner on login and when the matching zone is entered.
 */
module.exports = function registerTheGolemQuest(api) {
  const { Item, Location, Skill, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");

  const PAGE = "The Golem";
  const VARP_THE_GOLEM = 437; // golem_quest
  // golem_a: the stage the cache reads, e.g. Uzer's Rug Merchant (NPC 21) shows at 10.
  const VARBIT_THE_GOLEM = 346;
  const VARBIT_GOLEM_B = 347;
  const VARBIT_GOLEM_CLAY = 348; // NPC 6277 transform: 0/1 broken, 2/3 damaged, 4 fixed
  const VARBIT_STATUETTE_A = 349;
  const VARBIT_STATUETTE_B = 350;
  const VARBIT_STATUETTE_C = 351;
  const VARBIT_STATUETTE_D = 352;
  const VARBIT_HEAD_OPEN = 353;
  const VARBIT_THRONE_GEMS = 354;
  const VARBIT_RETRIEVED_STATUETTE = 355; // 24626 transform: 0 full case, 1 open/empty
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

  const CRAFTING_LEVEL = 20;
  const THIEVING_LEVEL = 25;
  const CLAY_REPAIRS = 4;

  const GOLEM_NPC_IDS = new Set([
    NpcIdentifiers.CLAY_GOLEM, // 917
    NpcIdentifiers.CLAY_GOLEM_2, // 918
    NpcIdentifiers.BROKEN_CLAY_GOLEM, // 5134
    NpcIdentifiers.DAMAGED_CLAY_GOLEM, // 5135
    NpcIdentifiers.CLAY_GOLEM_3, // 5136
    // The world's single Uzer spawn is 6277, a nameless transform placeholder
    // (varbit 348 -> 5134/5135/5136); interaction events can carry the raw id.
    6277,
  ]);
  const ELISSA_NPC_ID = NpcIdentifiers.ELISSA; // 5138
  const CURATOR_NPC_ID = NpcIdentifiers.CURATOR_HAIG_HALEN; // 5214
  const DESERT_PHOENIX_NPC_ID = NpcIdentifiers.DESERT_PHOENIX; // 5137
  const GOLEM_CHAT_HEAD = NpcIdentifiers.BROKEN_CLAY_GOLEM;

  const LETTER_ITEM_ID = ItemIdentifiers.LETTER_2; // 4615 Varmen's letter
  const NOTES_ITEM_ID = ItemIdentifiers.VARMENS_NOTES; // 4616
  const CABINET_KEY_ITEM_ID = ItemIdentifiers.DISPLAY_CABINET_KEY; // 4617
  const STATUETTE_ITEM_ID = ItemIdentifiers.STATUETTE; // 4618
  const STRANGE_IMPLEMENT_ITEM_ID = ItemIdentifiers.STRANGE_IMPLEMENT; // 4619
  const MUSHROOM_ITEM_ID = ItemIdentifiers.BLACK_MUSHROOM; // 4620
  const FEATHER_ITEM_ID = ItemIdentifiers.PHOENIX_FEATHER; // 4621
  const INK_ITEM_ID = ItemIdentifiers.BLACK_DYE; // 4622 black mushroom ink (cache name)
  const QUILL_ITEM_ID = ItemIdentifiers.PHOENIX_QUILL_PEN; // 4623
  const PROGRAM_ITEM_ID = ItemIdentifiers.GOLEM_PROGRAM; // 4624
  const SOFT_CLAY_ITEM_ID = ItemIdentifiers.SOFT_CLAY; // 1761
  const CLAY_ITEM_ID = ItemIdentifiers.CLAY; // 434
  const VIAL_ITEM_ID = ItemIdentifiers.VIAL; // 229
  const PESTLE_ITEM_ID = ItemIdentifiers.PESTLE_AND_MORTAR; // 233
  const PAPYRUS_ITEM_ID = ItemIdentifiers.PAPYRUS; // 970
  const HAMMER_ITEM_ID = ItemIdentifiers.HAMMER; // 2347
  const CHISEL_ITEM_ID = ItemIdentifiers.CHISEL; // 1755
  const RUBY_ITEM_ID = ItemIdentifiers.RUBY; // 1603
  const EMERALD_ITEM_ID = ItemIdentifiers.EMERALD; // 1605
  const SAPPHIRE_ITEM_ID = ItemIdentifiers.SAPPHIRE; // 1607

  // The Exam Centre's south-east bookcase (Quest Helper 6292 at 3366/3367,3332).
  const BOOKCASE_OBJECT_ID = ObjectIdentifiers.BOOKCASE_20; // 6292
  const BOOKCASE_TILE = { x: 3366, y: 3332 };
  // 24626 is the world's Open-able museum case; 6294/6295 are not placed.
  const DISPLAY_CASE_IDS = new Set([24626]);
  const THRONE_IDS = new Set([ObjectIdentifiers.THRONE_10, ObjectIdentifiers.THRONE_11]); // 6301/6302
  // Uzer temple alcoves. 6303-6306 are the placed base objects; the client
  // transforms them through varbits 349-352 to 6307 (right), 6308 (left) or 6309
  // (empty). A click can arrive as either the base or the transformed id, so
  // match the tile too.
  const ALCOVES = [
    { slot: 0, objectId: 6303, bit: VARBIT_STATUETTE_A, x: 2718, y: 4899, target: 1 },
    { slot: 1, objectId: 6304, bit: VARBIT_STATUETTE_B, x: 2718, y: 4896, target: 1 },
    { slot: 2, objectId: 6305, bit: VARBIT_STATUETTE_C, x: 2725, y: 4899, target: 0 },
    { slot: 3, objectId: 6306, bit: VARBIT_STATUETTE_D, x: 2725, y: 4896, target: 2 },
  ];
  const ALCOVE_OBJECT_IDS = new Set([...ALCOVES.map((alcove) => alcove.objectId), 6307, 6308, 6309]);
  const MUSHROOM_OBJECT_ID = ObjectIdentifiers.BLACK_MUSHROOMS; // 6311
  // Both states of the temple door are the same live loc (6363/6364 are not placed).
  const TEMPLE_DOOR_OBJECT_ID = 6310;
  const SURFACE_STAIRS_OBJECT_ID = ObjectIdentifiers.STAIRCASE_35; // 6373 Climb-down
  const TEMPLE_STAIRS_OBJECT_ID = ObjectIdentifiers.STAIRCASE_34; // 6372 Climb-up
  const SURFACE_STAIRS_TILE = { x: 3492, y: 3092, z: 0 };
  const TEMPLE_STAIRS_TILE = { x: 2721, y: 4886, z: 0 };
  const THRONE_ROOM_TILE = { x: 2720, y: 4884, z: 2 }; // capture 3333 portal landing
  const DEMON_PORTAL_OBJECT_ID = ObjectIdentifiers.PORTAL_13; // 6282 back out of the lair
  const LETTER_TILE = { x: 3479, y: 3092, z: 0 };
  const IMPLEMENT_TILE = { x: 2713, y: 4913, z: 0 };
  const UZER_SURFACE_ZONE = { minX: 3465, maxX: 3505, minY: 3075, maxY: 3105, levels: [0] };
  const UZER_RUINS_ZONE = { minX: 2706, maxX: 2738, minY: 4881, maxY: 4918, levels: [0] };

  const START_HOOK = "quest:the-golem:start";
  const REPAIR_DONE_MESSAGE_ID = "qjXp0f"; // "You repair the golem with a final piece of clay."

  /** This page's condition step ids; several texts ("player succeeds", ...) are shared pages' too. */
  const OWN_CONDITION_IDS = new Set([
    "Ji7EyT", // display case knowledge
    "1V3-sZ", // display cabinet key
    "mZfxeU", // statuette already taken
    "LP56DN", // statuette already in the alcove
    "HuSKOr", // first entry to the portal
    "1_61bg", // no chisel/hammer for the throne
    "V8x72C", // phoenix feather/quill already held
    "cVN5bN", // phoenix grab succeeds
    "TeT63s", // phoenix grab fails
    "0dQN2w", // demon-death knowledge for the program
  ]);

  const LETTER_ATTRIBUTE = "quest.the_golem.letter";
  const CLAY_ATTRIBUTE = "quest.the_golem.clay";
  const STATUE_ATTRIBUTE = "quest.the_golem.statuettes";
  const THRONE_GEMS_ATTRIBUTE = "quest.the_golem.throne_gems";
  const RETRIEVED_ATTRIBUTE = "quest.the_golem.retrieved_statuette";
  const SEEN_ATTRIBUTE = "quest.the_golem.seen_underground";
  const HEAD_OPEN_ATTRIBUTE = "quest.the_golem.head_open";

  const LETTER_LINES = [
    "Dearest Varmen,",
    "I hope this finds you well. Here are the books you asked for.",
    "There has been an exciting development closer to home --",
    "another city from the same period has been discovered east of Varrock,",
    "and we are starting a huge excavation project here. I don't know if the",
    "museum will be able to finance your expedition as well as this one, so I",
    "fear your current trip will be the last.",
    "May Saradomin grant you a safe journey home.",
    "Your loving Elissa.",
  ];

  let quest;

  const held = (player, itemId) => player.getInventory().getAmount(itemId) > 0;

  function numberAttribute(player, key) {
    return Number(player.getAttribute(key)) || 0;
  }

  function letterProgress(player) {
    return numberAttribute(player, LETTER_ATTRIBUTE);
  }

  function clayUsed(player) {
    return numberAttribute(player, CLAY_ATTRIBUTE);
  }

  function craftLevel(player) {
    return player.getSkillManager().getCurrentLevel(Skill.CRAFTING);
  }

  function thiefLevel(player) {
    return player.getSkillManager().getCurrentLevel(Skill.THIEVING);
  }

  function varbit(player, id) {
    return player.getPacketSender().getVarbit(id);
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
  }

  /** Replays the golem's cache state (varp 437 siblings) after login or a reload. */
  function syncGolemVarbits(player) {
    setVarbit(player, VARBIT_GOLEM_B, letterProgress(player));
    setVarbit(player, VARBIT_GOLEM_CLAY, clayUsed(player));
    setVarbit(player, VARBIT_STATUETTE_A, statueValue(player, 0));
    setVarbit(player, VARBIT_STATUETTE_B, statueValue(player, 1));
    setVarbit(player, VARBIT_STATUETTE_C, statueValue(player, 2));
    setVarbit(player, VARBIT_STATUETTE_D, statueValue(player, 3));
    setVarbit(player, VARBIT_HEAD_OPEN, player.getAttribute(HEAD_OPEN_ATTRIBUTE) ? 1 : 0);
    setVarbit(player, VARBIT_THRONE_GEMS, player.getAttribute(THRONE_GEMS_ATTRIBUTE) ? 1 : 0);
    setVarbit(player, VARBIT_RETRIEVED_STATUETTE, player.getAttribute(RETRIEVED_ATTRIBUTE) ? 1 : 0);
    setVarbit(player, VARBIT_SEEN_UNDERGROUND, player.getAttribute(SEEN_ATTRIBUTE) ? 1 : 0);
  }

  /** A Quest Helper floor spawn, registered for its owner until picked up. */
  function ensureGroundItem(player, itemId, tile) {
    if (held(player, itemId)) return;
    const location = new Location(tile.x, tile.y, tile.z);
    const manager = api.getItemOnGroundManager();
    if (manager.getGroundItem(player.getUsername(), itemId, location, player.getPrivateArea())) return;
    manager.registerLocation(player, new Item(itemId, 1), location);
  }

  function ensureQuestItemSpawns(player) {
    if (letterProgress(player) === 0) ensureGroundItem(player, LETTER_ITEM_ID, LETTER_TILE);
    if (quest.isStarted(player) && !quest.isComplete(player)) {
      ensureGroundItem(player, STRANGE_IMPLEMENT_ITEM_ID, IMPLEMENT_TILE);
    }
  }

  function alcoveAt(event) {
    const location = event.location;
    if (location) {
      for (const alcove of ALCOVES) {
        if (Math.abs(location.x - alcove.x) <= 1 && Math.abs(location.y - alcove.y) <= 1) return alcove;
      }
      return null;
    }
    return ALCOVES.find((alcove) => alcove.objectId === event.objectId) ?? null;
  }

  function freeSlots(player) {
    const inventory = player.getInventory();
    return typeof inventory.getFreeSlots === "function"
      ? inventory.getFreeSlots()
      : inventory.isFull()
        ? 0
        : 28;
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
    const lines = ["<str>I have spoken to the golem.</str>"];
    if (stage < STAGE_OPEN_PORTAL) {
      lines.push("The <col=800000>golem</col> asked me to repair him with soft clay.");
      lines.push("");
      lines.push(`Repairs done: ${clayUsed(player)}/${CLAY_REPAIRS}.`);
      return lines;
    }
    lines.push("<str>I have repaired the golem.</str>");
    if (stage >= STAGE_PORTAL_OPENED) {
      lines.push("<str>The golem asked me to open the portal so it can defeat a demon.</str>");
      lines.push("<str>I have opened the portal.</str>");
    } else {
      lines.push("The <col=800000>golem</col> asked me to open the portal so it can");
      lines.push("defeat the great demon.");
      if (stage < STAGE_FIND_STATUETTE) {
        lines.push("I should go down the stairs in <col=800000>Uzer</col> and work out how to open the portal.");
      } else if (!player.getAttribute(RETRIEVED_ATTRIBUTE)) {
        lines.push("To open the portal I need the missing <col=800000>statuette</col>, which is in the <col=800000>Varrock Museum</col>.");
      } else if (stage < STAGE_STATUETTE_REPLACED) {
        lines.push("I have the missing statuette and should put it back in the temple in <col=800000>Uzer</col>.");
      } else {
        lines.push("I have replaced the statuette and should turn the statuettes to open the door.");
      }
    }
    if (letterProgress(player) === 1) {
      lines.push("");
      lines.push("Maybe I should speak to <col=800000>Elissa</col> at the <col=800000>Digsite</col> about the letter I found in Uzer.");
    } else if (letterProgress(player) === 2) {
      lines.push("");
      lines.push("Elissa told me that <col=800000>Varmen's expedition notes</col> are in the library in the <col=800000>Exam Centre</col>.");
    }
    if (stage === STAGE_DEMON_DEAD) {
      lines.push("");
      lines.push("I saw the demon's skeleton in its lair. I should inform the <col=800000>golem</col> that it is dead.");
    } else if (stage >= STAGE_CONVINCE_GOLEM) {
      lines.push("");
      lines.push("<str>I told the golem that the demon was dead, but it did not believe me!</str>");
      lines.push("I should find some way to convince the <col=800000>golem</col> that its task is done.");
    }
    if (stage >= STAGE_COMPLETE) {
      lines.push("");
      lines.push("<str>I reprogrammed the golem so that it knows its task is complete.</str>");
      lines.push("<col=ff0000>QUEST COMPLETE!</col>");
    }
    return lines;
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.CRAFTING, 1000);
    player.getSkillManager().addExperiences(Skill.THIEVING, 1000);
  }

  /** Which transcript variant each speaker plays, by quest stage. */
  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (GOLEM_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_COMPLETE) return { page: PAGE, variant: "post-quest-talking-to-the-golem" };
      if (stage >= STAGE_CONVINCE_GOLEM) {
        return { page: PAGE, variant: "returning-to-uzer-talking-to-the-golem-again-after-being-told-the-demon-must-be-defeated" };
      }
      if (stage === STAGE_DEMON_DEAD) {
        return { page: PAGE, variant: "returning-to-uzer-talking-to-the-golem-after-entering-the-throne-of-the-demon" };
      }
      if (stage >= STAGE_PORTAL_OPENED) {
        return { page: PAGE, variant: "returning-to-uzer-talking-to-the-golem-after-opening-the-portal" };
      }
      if (stage >= STAGE_OPEN_PORTAL) {
        return { page: PAGE, variant: "using-the-soft-clay-on-the-golem-talking-to-the-golem-again-after-learning-about-the-demon" };
      }
      if (stage >= STAGE_REPAIR_GOLEM) {
        return { page: PAGE, variant: "talking-to-the-golem-to-start-the-quest-talking-to-the-golem-after-starting-the-quest" };
      }
      return { page: PAGE, variant: "talking-to-the-golem-to-start-the-quest" };
    }
    if (npcId === ELISSA_NPC_ID) {
      if (quest.getStage(player) >= STAGE_FIND_STATUETTE) {
        return { page: PAGE, variant: "talking-to-elissa-in-the-digsite-talking-to-elissa-after-reading-varmen-s-notes" };
      }
      if (letterProgress(player) >= 2) {
        return { page: PAGE, variant: "talking-to-elissa-in-the-digsite-talking-to-elissa-again-after-learning-where-the-notes-are" };
      }
      return { page: PAGE, variant: "talking-to-elissa-in-the-digsite" };
    }
    if (npcId === CURATOR_NPC_ID) {
      // Only the active quest has curator business; Dig Site/Bone Voyage own him
      // after completion.
      if (quest.isComplete(player)) return null;
      if (quest.getStage(player) < STAGE_REPAIR_GOLEM && !player.getAttribute(RETRIEVED_ATTRIBUTE)) {
        return null;
      }
      if (player.getAttribute(RETRIEVED_ATTRIBUTE) || quest.getStage(player) >= STAGE_STATUETTE_REPLACED) {
        return { page: PAGE, variant: "visiting-the-varrock-museum-talking-to-curator-haig-after-losing-the-statuette" };
      }
      return { page: PAGE, variant: "visiting-the-varrock-museum-talking-to-curator-haig-in-the-varrock-museum" };
    }
    return null;
  }

  /** Answer the transcript page's prose conditions. */
  function answerCondition({ player, npcId, text, stepId }) {
    const ownsNpc =
      GOLEM_NPC_IDS.has(npcId) ||
      npcId === ELISSA_NPC_ID ||
      npcId === CURATOR_NPC_ID ||
      npcId === DESERT_PHOENIX_NPC_ID;
    if (!ownsNpc && !OWN_CONDITION_IDS.has(stepId)) return null;
    const value = String(text).toLowerCase();
    const has = (itemId) => player.getInventory().getAmount(itemId) > 0;
    if (value.includes("not yet learned about the display case")) {
      return quest.getStage(player) < STAGE_FIND_STATUETTE;
    }
    if (value.includes("does not have the key")) {
      return !has(CABINET_KEY_ITEM_ID);
    }
    if (value.includes("already has the statuette")) {
      return Boolean(player.getAttribute(RETRIEVED_ATTRIBUTE)) || has(STATUETTE_ITEM_ID);
    }
    if (value.includes("already a statuette in the alcove")) {
      return quest.getStage(player) >= STAGE_STATUETTE_REPLACED;
    }
    if (value.includes("first time the player has entered the portal")) {
      // Capture 3333 sets seen_underground when the player first enters the
      // ruins, long before the portal; the skeleton line still plays on the
      // first portal entry at stage 5.
      return quest.getStage(player) === STAGE_PORTAL_OPENED;
    }
    if (value.includes("no chisel")) {
      return !has(CHISEL_ITEM_ID) || !has(HAMMER_ITEM_ID);
    }
    if (value.includes("already has a phoenix feather or quill pen")) {
      return has(FEATHER_ITEM_ID) || has(QUILL_ITEM_ID);
    }
    if (value.includes("player succeeds")) {
      return thiefLevel(player) >= THIEVING_LEVEL;
    }
    if (value.includes("player fails")) {
      return thiefLevel(player) < THIEVING_LEVEL;
    }
    if (value.includes("not learned that the demon is dead")) {
      return quest.getStage(player) < STAGE_DEMON_DEAD;
    }
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!GOLEM_NPC_IDS.has(npcId) || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_REPAIR_GOLEM) quest.setStage(player, STAGE_REPAIR_GOLEM);
  }

  /** Elissa explaining where Varmen's notes are advances the letter hunt. */
  function handleDialogueLine(event) {
    if (event.npcId === ELISSA_NPC_ID && /notes he made are in the library/i.test(String(event.text))) {
      if (letterProgress(event.player) < 2) {
        event.player.setAttribute(LETTER_ATTRIBUTE, 2);
        setVarbit(event.player, VARBIT_GOLEM_B, 2);
      }
    }
    // The golem refuses to believe the demon is dead; this ends the stage-6
    // conversation and starts the reprogramming hunt (stage 7).
    if (GOLEM_NPC_IDS.has(event.npcId) && /demon must be defeated.*task incomplete/i.test(String(event.text))) {
      if (quest.getStage(event.player) === STAGE_DEMON_DEAD) quest.setStage(event.player, STAGE_CONVINCE_GOLEM);
    }
  }

  /** Message steps fired by the transcript variants we replay drive state. */
  function handleAction(event) {
    if (event.stepId === REPAIR_DONE_MESSAGE_ID && GOLEM_NPC_IDS.has(event.npcId)) {
      if (quest.getStage(event.player) < STAGE_OPEN_PORTAL) quest.setStage(event.player, STAGE_OPEN_PORTAL);
    }
  }

  /**
   * The portal's first-entry branch describes the demon's skeleton; walking
   * through the temple door marks the sighting and moves the quest on.
   */
  /** The first ruin entry sets seen_underground; the portal moves the stage on. */
  function markSeenUnderground(player) {
    if (player.getAttribute(SEEN_ATTRIBUTE)) return;
    player.setAttribute(SEEN_ATTRIBUTE, true);
    setVarbit(player, VARBIT_SEEN_UNDERGROUND, 1);
  }

  function markFirstEntry(player) {
    if (quest.getStage(player) === STAGE_PORTAL_OPENED) quest.setStage(player, STAGE_DEMON_DEAD);
  }

  /** Reading Varmen's letter starts the hunt; reading his notes sets golem_b 3. */
  function handleItemAction(event) {
    const option = String(event.option ?? "").toLowerCase();
    if (!option.includes("read")) return;
    if (event.itemId === LETTER_ITEM_ID) {
      for (const line of LETTER_LINES) event.player.sendMessage(line);
      if (letterProgress(event.player) === 0) {
        event.player.setAttribute(LETTER_ATTRIBUTE, 1);
        setVarbit(event.player, VARBIT_GOLEM_B, 1);
      }
      event.handled = true;
      return;
    }
    if (event.itemId === NOTES_ITEM_ID && letterProgress(event.player) >= 2) {
      event.player.sendMessage("You read Varmen's notes. He describes the four statuettes in the temple.");
      if (letterProgress(event.player) < 3) {
        event.player.setAttribute(LETTER_ATTRIBUTE, 3);
        setVarbit(event.player, VARBIT_GOLEM_B, 3);
      }
      event.handled = true;
    }
  }

  function repairGolem(player, npcId) {
    const stage = quest.getStage(player);
    if (stage <= STAGE_NOT_STARTED) {
      player.sendMessage("Maybe you should ask the golem first!");
      return;
    }
    if (stage >= STAGE_OPEN_PORTAL) {
      player.sendMessage("You have already repaired the golem.");
      return;
    }
    if (craftLevel(player) < CRAFTING_LEVEL) {
      player.sendMessage("You need level 20 crafting to repair the golem.");
      return;
    }
    if (!held(player, SOFT_CLAY_ITEM_ID)) return;
    player.getInventory().deleteNumber(SOFT_CLAY_ITEM_ID, 1);
    const used = clayUsed(player) + 1;
    player.setAttribute(CLAY_ATTRIBUTE, used);
    // The world golem is NPC 6277, transformed by this varbit; the client
    // switches 5134 -> 5135 -> 5136 as the player adds clay.
    setVarbit(player, VARBIT_GOLEM_CLAY, used);
    const variant = {
      1: "using-the-soft-clay-on-the-golem-after-using-the-first-soft-clay",
      2: "using-the-soft-clay-on-the-golem-after-using-the-second-soft-clay",
      3: "using-the-soft-clay-on-the-golem-after-using-the-third-soft-clay",
      4: "using-the-soft-clay-on-the-golem-after-using-the-fourth-soft-clay",
    }[used];
    if (variant) startTranscript(api, player, npcId, PAGE, variant);
  }

  function openGolemHead(player, npcId) {
    player.setAttribute(HEAD_OPEN_ATTRIBUTE, true);
    setVarbit(player, VARBIT_HEAD_OPEN, 1);
    // Quest Helper keeps Golem_head_open set while the player writes and uses
    // the program, so play only the opening message, not the wiki's second
    // "shuts automatically" line.
    startTranscript(api, player, npcId, PAGE,
      "returning-to-uzer-using-the-strange-implement-on-the-golem-without-the-new-instructions",
      (steps) => steps.filter((step) => step.id !== "tzrMiL"));
  }

  function closeGolemHead(player) {
    player.setAttribute(HEAD_OPEN_ATTRIBUTE, false);
    setVarbit(player, VARBIT_HEAD_OPEN, 0);
    player.sendMessage("The golem's skull shuts automatically.");
  }

  function completeWhenDialogueEnds(player, attempts) {
    const { CountdownTask, TaskManager } = api.core;
    TaskManager.submit(
      new CountdownTask({}, 1, () => {
        if (player.getDialogueManager().isActive() && attempts > 0) {
          completeWhenDialogueEnds(player, attempts - 1);
          return;
        }
        quest.complete(player);
        // Capture 3333: head_open stays set through the program dialogue and is
        // cleared two ticks after completion, with the wiki message.
        TaskManager.submit(new CountdownTask(player, 2, () => closeGolemHead(player)));
      })
    );
  }

  /** Soft clay repairs the golem; the implement opens its head; the program ends the quest. */
  function handleItemOnNpc(event) {
    const npcId = event.npcId ?? event.target?.getId?.();
    if (!GOLEM_NPC_IDS.has(npcId)) return;
    const { player } = event;
    if (event.itemId === SOFT_CLAY_ITEM_ID) {
      event.handled = true;
      repairGolem(player, npcId);
      return;
    }
    if (event.itemId === CLAY_ITEM_ID) {
      event.handled = true;
      player.sendMessage("The clay is not soft enough to stick to the golem.");
      return;
    }
    if (event.itemId === STRANGE_IMPLEMENT_ITEM_ID) {
      event.handled = true;
      if (player.getAttribute(HEAD_OPEN_ATTRIBUTE)) {
        player.sendMessage("The golem's head is already open.");
        return;
      }
      openGolemHead(player, npcId);
      return;
    }
    if (event.itemId === PROGRAM_ITEM_ID) {
      event.handled = true;
      if (!player.getAttribute(HEAD_OPEN_ATTRIBUTE)) {
        player.sendMessage("You can't see a way to put the instructions in the golem's skull.");
        return;
      }
      if (quest.isComplete(player)) {
        player.sendMessage("You have already reprogrammed the golem.");
        return;
      }
      if (quest.getStage(player) < STAGE_CONVINCE_GOLEM) return;
      player.getInventory().deleteNumber(PROGRAM_ITEM_ID, 1);
      startTranscript(
        api,
        player,
        npcId,
        PAGE,
        "returning-to-uzer-after-using-the-strange-implement-on-the-golem-in-uzer-and-adding-the-new-instructions"
      );
      completeWhenDialogueEnds(player, 100);
    }
  }

  function handleItemOnItem(event) {
    const { player } = event;
    const ids = [event.usedItemId, event.usedWithItemId];
    const has = (itemId) => ids.includes(itemId);
    if (has(MUSHROOM_ITEM_ID) && has(PESTLE_ITEM_ID)) {
      event.handled = true;
      if (!held(player, MUSHROOM_ITEM_ID)) return;
      player.getInventory().deleteNumber(MUSHROOM_ITEM_ID, 1);
      if (!held(player, VIAL_ITEM_ID)) {
        player.sendMessage("You crush the mushroom, but you have no vial to put the dye in and it goes everywhere!");
        return;
      }
      player.getInventory().deleteNumber(VIAL_ITEM_ID, 1);
      player.getInventory().adds(INK_ITEM_ID, 1);
      player.sendMessage("You crush the mushroom and pour the juice into a vial.");
      return;
    }
    if (has(INK_ITEM_ID) && has(FEATHER_ITEM_ID)) {
      event.handled = true;
      player.getInventory().deleteNumber(INK_ITEM_ID, 1);
      player.getInventory().deleteNumber(FEATHER_ITEM_ID, 1);
      player.getInventory().adds(QUILL_ITEM_ID, 1);
      player.sendMessage("You dip the phoenix feather into the dye.");
      return;
    }
    if (has(PAPYRUS_ITEM_ID) && has(FEATHER_ITEM_ID)) {
      event.handled = true;
      player.sendMessage("You will need some kind of ink to write with.");
      return;
    }
    if (has(PAPYRUS_ITEM_ID) && has(QUILL_ITEM_ID)) {
      event.handled = true;
      if (quest.getStage(player) !== STAGE_CONVINCE_GOLEM) {
        player.sendMessage("You don't know what to write.");
        return;
      }
      player.getInventory().deleteNumber(PAPYRUS_ITEM_ID, 1);
      player.getInventory().adds(PROGRAM_ITEM_ID, 1);
      player.sendMessage("You write on the papyrus: YOUR TASK IS DONE");
    }
  }

  function openDisplayCase(player) {
    if (player.getAttribute(RETRIEVED_ATTRIBUTE) || held(player, STATUETTE_ITEM_ID)) {
      player.sendMessage("You have already taken the statuette.");
      return;
    }
    if (player.getInventory().isFull()) {
      player.sendMessage("You do not have enough space for the statuette in your backpack.");
      return;
    }
    player.setAttribute(RETRIEVED_ATTRIBUTE, true);
    setVarbit(player, VARBIT_RETRIEVED_STATUETTE, 1);
    player.getInventory().adds(STATUETTE_ITEM_ID, 1);
    player.sendMessage("You open the cabinet and retrieve the statuette.");
  }

  /** Statuette into an alcove, or hammer and chisel on the gem-encrusted throne. */
  function handleItemOnObject(event) {
    if (event.itemId === STATUETTE_ITEM_ID && ALCOVE_OBJECT_IDS.has(event.objectId)) {
      event.handled = true;
      const { player } = event;
      const alcove = alcoveAt(event);
      if (!alcove || alcove.slot !== 3) {
        player.sendMessage("There is already a statuette in this alcove.");
        return;
      }
      if (quest.getStage(player) >= STAGE_STATUETTE_REPLACED) {
        startTranscript(api, player, GOLEM_CHAT_HEAD, PAGE, "returning-to-uzer-using-statuette-on-alcove");
        return;
      }
      if (!held(player, STATUETTE_ITEM_ID)) return;
      player.getInventory().deleteNumber(STATUETTE_ITEM_ID, 1);
      // 1 is a valid facing for the missing fourth statuette; one Turn reaches
      // the target 2.
      setStatueValue(player, 3, 1);
      setVarbit(player, VARBIT_STATUETTE_D, 1);
      startTranscript(api, player, GOLEM_CHAT_HEAD, PAGE, "returning-to-uzer-using-statuette-on-alcove");
      quest.setStage(player, STAGE_STATUETTE_REPLACED);
      return;
    }
    if (event.itemId === CABINET_KEY_ITEM_ID && DISPLAY_CASE_IDS.has(event.objectId)) {
      event.handled = true;
      openDisplayCase(event.player);
      return;
    }
    if (
      (event.itemId === HAMMER_ITEM_ID || event.itemId === CHISEL_ITEM_ID) &&
      THRONE_IDS.has(event.objectId)
    ) {
      event.handled = true;
      const { player } = event;
      if (player.getAttribute(THRONE_GEMS_ATTRIBUTE)) {
        player.sendMessage("You have already removed the gems from the throne.");
        return;
      }
      if (!held(player, HAMMER_ITEM_ID) || !held(player, CHISEL_ITEM_ID)) {
        player.sendMessage("You'll need a chisel as well as a hammer to get the gems.");
        return;
      }
      if (freeSlots(player) < 6) {
        player.sendMessage("You don't have enough free space to remove all six gems.");
        return;
      }
      player.setAttribute(THRONE_GEMS_ATTRIBUTE, true);
      setVarbit(player, VARBIT_THRONE_GEMS, 1);
      player.getInventory().adds(RUBY_ITEM_ID, 2);
      player.getInventory().adds(EMERALD_ITEM_ID, 2);
      player.getInventory().adds(SAPPHIRE_ITEM_ID, 2);
      player.sendMessage("You prise the gems from the demon's throne.");
    }
  }

  /**
   * Turn the clicked statuette. A/B/C toggle between the two facings (0 right,
   * 1 left); D cycles between left and right once placed. The door opens on
   * a=1, b=1, c=0, d=2, exactly the Quest Helper varbit predicates.
   */
  function turnStatuette(player, alcove) {
    const stage = quest.getStage(player);
    if (stage >= STAGE_PORTAL_OPENED) {
      player.sendMessage("The statuette is now locked in place.");
      return;
    }
    const current = varbit(player, alcove.bit);
    // The three standing statuettes can be turned before the fourth is
    // recovered; only the empty alcove reports a missing statuette.
    if (alcove.slot === 3 && (current === 0 || current === 3)) {
      player.sendMessage("The statuette is missing from this alcove.");
      return;
    }
    const next = alcove.slot === 3 ? (current === 1 ? 2 : 1) : (current === 1 ? 0 : 1);
    setVarbit(player, alcove.bit, next);
    setStatueValue(player, alcove.slot, next);
    player.sendMessage(`You turn the statuette to the ${next === 1 ? "left" : "right"}.`);
    const solved = ALCOVES.every((entry) => varbit(player, entry.bit) === entry.target);
    if (solved) {
      player.sendMessage("The door grinds open.");
      quest.setStage(player, STAGE_PORTAL_OPENED);
    }
  }

  /** The temple door is the same loc before and after the statuettes open it. */
  function useTempleDoor(player) {
    if (quest.getStage(player) < STAGE_PORTAL_OPENED) {
      player.sendMessage("You can't find any way to open the door.");
      return;
    }
    // 6310 is the temple portal; the throne room is map plane 2 through 6282.
    player.moveTo(new Location(THRONE_ROOM_TILE.x, THRONE_ROOM_TILE.y, THRONE_ROOM_TILE.z));
    startTranscript(api, player, GOLEM_CHAT_HEAD, PAGE, "returning-to-uzer-entering-the-portal");
    markFirstEntry(player);
  }

  /** Doors owns the generic "Door" name hook, so claim the temple door first. */
  function handleDoorToggle(event) {
    if (event.objectId !== TEMPLE_DOOR_OBJECT_ID) return;
    // Shadow of the Storm owns this portal after The Golem is complete.
    const stage = quest.getStage(event.player);
    if (stage < STAGE_REPAIR_GOLEM || stage >= STAGE_COMPLETE) return;
    event.handled = true;
    useTempleDoor(event.player);
  }

  function handleObjectInteraction(event) {
    const { player, objectId } = event;
    if (objectId === MUSHROOM_OBJECT_ID) {
      event.handled = true;
      if (!held(player, MUSHROOM_ITEM_ID)) player.getInventory().adds(MUSHROOM_ITEM_ID, 1);
      player.sendMessage("You pick a mushroom.");
      return;
    }
    if (objectId === BOOKCASE_OBJECT_ID) {
      event.handled = true;
      const location = event.location;
      if (location && (Math.abs(location.x - BOOKCASE_TILE.x) > 2 || Math.abs(location.y - BOOKCASE_TILE.y) > 2)) {
        player.sendMessage("You search the bookcase.");
        return;
      }
      if (letterProgress(player) < 2) {
        player.sendMessage("You search the bookcase, but find nothing useful.");
        return;
      }
      player.sendMessage("You search the bookcase...");
      if (!held(player, NOTES_ITEM_ID)) {
        player.getInventory().adds(NOTES_ITEM_ID, 1);
        player.sendMessage("You find Varmen's expedition notes.");
      }
      return;
    }
    if (DISPLAY_CASE_IDS.has(objectId)) {
      const option = String(event.definition?.getInteractions?.()?.[event.clickType - 1] ?? "").toLowerCase();
      if (!option.includes("open")) return;
      event.handled = true;
      if (!held(player, CABINET_KEY_ITEM_ID)) {
        player.sendMessage("The cabinet is locked.");
        return;
      }
      openDisplayCase(player);
      return;
    }
    if (ALCOVE_OBJECT_IDS.has(objectId)) {
      event.handled = true;
      const alcove = alcoveAt(event);
      if (!alcove) return;
      turnStatuette(player, alcove);
      return;
    }
    if (objectId === TEMPLE_DOOR_OBJECT_ID) {
      const stage = quest.getStage(player);
      if (stage < STAGE_REPAIR_GOLEM || stage >= STAGE_COMPLETE) return;
      event.handled = true;
      useTempleDoor(player);
      return;
    }
    if (objectId === SURFACE_STAIRS_OBJECT_ID) {
      event.handled = true;
      player.moveTo(new api.core.Location(TEMPLE_STAIRS_TILE.x, TEMPLE_STAIRS_TILE.y, TEMPLE_STAIRS_TILE.z));
      return;
    }
    if (objectId === TEMPLE_STAIRS_OBJECT_ID) {
      event.handled = true;
      player.moveTo(new api.core.Location(SURFACE_STAIRS_TILE.x, SURFACE_STAIRS_TILE.y, SURFACE_STAIRS_TILE.z));
      return;
    }
    if (objectId === DEMON_PORTAL_OBJECT_ID) {
      const stage = quest.getStage(player);
      if (stage < STAGE_DEMON_DEAD || stage >= STAGE_COMPLETE) return;
      event.handled = true;
      player.sendMessage("You step into the portal.");
      player.moveTo(new Location(2721, 4911, 0));
    }
  }

  /** Pickpocketing the curator needs the statuette lead and 25 Thieving. */
  function handleNpcInteraction(event) {
    const { player } = event;
    const actions = event.definition?.getActions?.() ?? [];
    const action = String(actions[event.clickType - 1] ?? "").toLowerCase();
    // The world's Uzer golem is a transform placeholder (6277 -> 5134...); when
    // an interaction carries the raw id it is not in the dialogue index, so the
    // Talk-to variant is replayed here for every handled golem id.
    if (GOLEM_NPC_IDS.has(event.npcId) && action === "talk-to") {
      const selected = selectVariant({ npcId: event.npcId, player });
      if (selected) {
        event.handled = true;
        startTranscript(api, player, event.npcId, selected.page ?? PAGE, selected.variant ?? selected);
      }
      return;
    }
    if (event.npcId === CURATOR_NPC_ID && action === "talk-to") {
      // Capture 3333: the curator conversation moves golem_a from 2 to 3.
      if (letterProgress(player) >= 3 && quest.getStage(player) < STAGE_FIND_STATUETTE) {
        quest.setStage(player, STAGE_FIND_STATUETTE);
      }
      // Recovery: a lost statuette before it is placed can be handed back.
      if (
        player.getAttribute(RETRIEVED_ATTRIBUTE) &&
        quest.getStage(player) >= STAGE_FIND_STATUETTE &&
        quest.getStage(player) < STAGE_STATUETTE_REPLACED &&
        !held(player, STATUETTE_ITEM_ID) &&
        !player.getInventory().isFull()
      ) {
        player.getInventory().adds(STATUETTE_ITEM_ID, 1);
        player.sendMessage("Curator Haig gives you another statuette from the display case.");
      }
    }
    if (event.npcId === CURATOR_NPC_ID && action === "pickpocket") {
      event.handled = true;
      if (letterProgress(player) < 3) {
        player.sendMessage("The curator doesn't seem to have anything of value.");
        return;
      }
      if (quest.getStage(player) < STAGE_FIND_STATUETTE) quest.setStage(player, STAGE_FIND_STATUETTE);
      if (held(player, CABINET_KEY_ITEM_ID) || player.getAttribute(RETRIEVED_ATTRIBUTE)) {
        player.sendMessage("You have already taken the display cabinet key.");
        return;
      }
      if (thiefLevel(player) < THIEVING_LEVEL) {
        player.sendMessage("You need level 25 Thieving to pickpocket the curator.");
        return;
      }
      player.getInventory().adds(CABINET_KEY_ITEM_ID, 1);
      player.sendMessage("You pickpocket the curator and take the display cabinet key.");
      return;
    }
    if (event.npcId === DESERT_PHOENIX_NPC_ID && action.includes("feather")) {
      event.handled = true;
      if (held(player, FEATHER_ITEM_ID) || held(player, QUILL_ITEM_ID)) {
        player.sendMessage("You already have a phoenix tail-feather.");
        return;
      }
      player.sendMessage("You attempt to grab the phoenix's tail-feather.");
      if (thiefLevel(player) >= THIEVING_LEVEL) {
        player.getInventory().adds(FEATHER_ITEM_ID, 1);
        player.sendMessage("You grab the feather and pull your hand back before the phoenix reacts.");
      } else {
        player.sendMessage("You fail to grab the feather.");
        player.sendMessage("You've been stunned!");
      }
    }
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
    // Recovery: a logout during the two-tick close must not leave the skull open.
    if (quest.isComplete(player) && player.getAttribute(HEAD_OPEN_ATTRIBUTE)) {
      closeGolemHead(player);
    }
    syncGolemVarbits(player);
    ensureQuestItemSpawns(player);
  }

  function handleZoneEnter({ player }) {
    if (player?.isPlayerBot?.() === true) return;
    ensureQuestItemSpawns(player);
  }

  function handleRuinsZoneEnter({ player }) {
    if (player?.isPlayerBot?.() === true) return;
    markSeenUnderground(player);
    ensureQuestItemSpawns(player);
  }

  api.persistAttribute(LETTER_ATTRIBUTE);
  api.persistAttribute(CLAY_ATTRIBUTE);
  api.persistAttribute(STATUE_ATTRIBUTE);
  api.persistAttribute(THRONE_GEMS_ATTRIBUTE);
  api.persistAttribute(RETRIEVED_ATTRIBUTE);
  api.persistAttribute(SEEN_ATTRIBUTE);
  api.persistAttribute(HEAD_OPEN_ATTRIBUTE);

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
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onItemAction(handleItemAction);
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnNpc(handleItemOnNpc);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onObjectInteraction(handleObjectInteraction);
  api.onCustomEvent("door:toggle", handleDoorToggle);
  api.onNpcInteraction(handleNpcInteraction);
  api.onPlayerLogin(handleLogin);
  api.onZoneEnter(UZER_SURFACE_ZONE, handleZoneEnter);
  api.onZoneEnter(UZER_RUINS_ZONE, handleRuinsZoneEnter);
};
