/**
 * Regicide (members).
 *
 * The words come from the "Regicide" transcript page; this plugin supplies the
 * variant selector for King Lathas, the King's Messenger, Idris/Morvran/Essyllt,
 * Lord Iorwerth, the Elf Tracker, General Hining, the Tyras guards, the Chemist
 * and Arianwyn, the start hook, the prose-condition answers, the bomb-making
 * hand-ins and the catapult that kills Tyras.
 *
 * Stages (varp 328): 0 not started, 1 King's message received, 2 spoken to
 * Lathas, 3 met the scouts, 4 spoken to Iorwerth, 5 tracker refused, 6 pendant
 * shown, 7 footprints found, 8 tracker explained the forest, 9 guard defeated,
 * 10 camp found, 11 bomb book received, 12 Tyras killed, 13 scroll from
 * Iorwerth, 14 Arianwyn meeting, 15 complete.
 *
 * Source: LostCityRS/Content quest_regicide (varp/regicide_quest stages, item
 * and object ids). Gaps: the Regicide NPCs are not in npc-spawns.json, so the
 * King's Messenger is owner-spawned on login, only once Underground Pass is
 * complete and Regicide has not started, while the rest must be spawned by
 * content/admin tools; the Isafdar traps, the Tyras
 * guard fight and the fractionalising still minigame are not simulated (a
 * crossing advances the guard stage and a barrel of coal tar on the still gives
 * naphtha directly); Arianwyn is met by talking to him rather than a zone
 * ambush; completion happens on the hand-over message, so the king's remaining
 * lines are skipped.
 */
module.exports = function registerRegicideQuest(api) {
  const {
    HitDamage,
    HitMask,
    Skill,
    Location,
    ItemIdentifiers,
    NpcIdentifiers,
    ObjectIdentifiers,
    ObjectManager,
    MapObjects,
  } = api.core;
  const { registerQuest, refreshQuestList, startTranscript, getRegisteredQuests } = require("../QuestRuntime");

  const KING_LATHAS_IDS = new Set([
    NpcIdentifiers.KING_LATHAS,
    NpcIdentifiers.KING_LATHAS_2,
    NpcIdentifiers.LATHAS,
    NpcIdentifiers.KING_LATHAS_3,
    NpcIdentifiers.KING_LATHAS_4,
  ]);
  const SCOUT_IDS = new Set([
    NpcIdentifiers.IDRIS,
    NpcIdentifiers.ESSYLLT,
    NpcIdentifiers.MORVRAN,
    NpcIdentifiers.MORVRAN_2,
    NpcIdentifiers.MORVRAN_3,
    NpcIdentifiers.MORVRAN_4,
  ]);
  const IORWERTH_IDS = new Set([
    NpcIdentifiers.LORD_IORWERTH,
    NpcIdentifiers.LORD_IORWERTH_2,
    NpcIdentifiers.LORD_IORWERTH_3,
    NpcIdentifiers.LORD_IORWERTH_4,
    NpcIdentifiers.LORD_IORWERTH_5,
  ]);
  const GENERAL_HINING_IDS = new Set([NpcIdentifiers.GENERAL_HINING, NpcIdentifiers.GENERAL_HINING_2]);
  const TYRAS_GUARD_IDS = new Set([
    NpcIdentifiers.TYRAS_GUARD,
    NpcIdentifiers.TYRAS_GUARD_2,
    NpcIdentifiers.TYRAS_GUARD_3,
    NpcIdentifiers.TYRAS_GUARD_4,
    NpcIdentifiers.TYRAS_GUARD_6,
    NpcIdentifiers.TYRAS_GUARD_7,
    NpcIdentifiers.TYRAS_GUARD_8,
    NpcIdentifiers.TYRAS_GUARD_9,
    NpcIdentifiers.TYRAS_GUARD_10,
    NpcIdentifiers.TYRAS_GUARD_11,
  ]);
  const ARIANWYN_IDS = new Set([
    NpcIdentifiers.ARIANWYN,
    NpcIdentifiers.ARIANWYN_3,
    NpcIdentifiers.ARIANWYN_4,
    NpcIdentifiers.ARIANWYN_5,
    NpcIdentifiers.ARIANWYN_6,
  ]);
  /** Every npc this plugin plays a Regicide page for; condition answers are scoped to them. */
  const DIALOGUE_NPC_IDS = new Set([
    ...KING_LATHAS_IDS,
    NpcIdentifiers.KINGS_MESSENGER,
    ...SCOUT_IDS,
    ...IORWERTH_IDS,
    NpcIdentifiers.ELF_TRACKER,
    ...GENERAL_HINING_IDS,
    NpcIdentifiers.TYRAS_GUARD_5,
    ...TYRAS_GUARD_IDS,
    NpcIdentifiers.CHEMIST,
    ...ARIANWYN_IDS,
  ]);

  const VARP_REGICIDE = 328;
  const STAGE_NOT_STARTED = 0;
  const STAGE_RECEIVED_MESSAGE = 1;
  const STAGE_SPOKEN_LATHAS = 2;
  const STAGE_SPOKEN_SCOUTS = 3;
  const STAGE_SPOKEN_IORWERTH = 4;
  const STAGE_SPOKEN_TRACKER = 5;
  const STAGE_SHOWN_PENDANT = 6;
  const STAGE_FOUND_FOOTPRINTS = 7;
  const STAGE_SPOKEN_TRACKER_2 = 8;
  const STAGE_DEFEATED_GUARD = 9;
  const STAGE_ENTERED_CAMP = 10;
  const STAGE_SPOKEN_IORWERTH_2 = 11;
  const STAGE_KILLED_TYRAS = 12;
  const STAGE_REPORTED_IORWERTH = 13;
  const STAGE_SPOKEN_ARIANWYN = 14;
  const STAGE_COMPLETE = 15;

  const KINGS_MESSAGE = ItemIdentifiers.KINGS_MESSAGE;
  const IORWERTHS_MESSAGE = ItemIdentifiers.IORWERTHS_MESSAGE;
  const CRYSTAL_PENDANT = ItemIdentifiers.CRYSTAL_PENDANT;
  const SULPHUR_ITEM = ItemIdentifiers.SULPHUR;
  const LIMESTONE_ITEM = ItemIdentifiers.LIMESTONE;
  const QUICKLIME_ITEM = ItemIdentifiers.QUICKLIME;
  const POT_OF_QUICKLIME = ItemIdentifiers.POT_OF_QUICKLIME;
  const GROUND_SULPHUR = ItemIdentifiers.GROUND_SULPHUR;
  const EMPTY_BARREL = ItemIdentifiers.BARREL_2; // 3216, the regicide barrel
  const BARREL_OF_COAL_TAR = ItemIdentifiers.BARREL_OF_COAL_TAR;
  const BARREL_OF_NAPHTHA = ItemIdentifiers.BARREL_OF_NAPHTHA;
  const NAPHTHA_SULPHUR_MIX = ItemIdentifiers.NAPHTHA_MIX;
  const NAPHTHA_QUICKLIME_MIX = ItemIdentifiers.NAPHTHA_MIX_2;
  const BARREL_BOMB = ItemIdentifiers.BARREL_BOMB;
  const FUSED_BARREL_BOMB = ItemIdentifiers.BARREL_BOMB_2;
  const STRIP_OF_CLOTH = ItemIdentifiers.STRIP_OF_CLOTH;
  const COOKED_RABBIT = ItemIdentifiers.COOKED_RABBIT;
  const BIG_BOOK_OF_BANGS = ItemIdentifiers.BIG_BOOK_OF_BANGS;
  const PESTLE_AND_MORTAR = ItemIdentifiers.PESTLE_AND_MORTAR;
  const POT = ItemIdentifiers.POT;
  const TINDERBOX = ItemIdentifiers.TINDERBOX;
  const BALL_OF_WOOL = ItemIdentifiers.BALL_OF_WOOL;
  const COINS = ItemIdentifiers.COINS;

  const DENSE_FOREST_IDS = new Set([
    ObjectIdentifiers.DENSE_FOREST,
    ObjectIdentifiers.DENSE_FOREST_2,
    ObjectIdentifiers.DENSE_FOREST_3,
    ObjectIdentifiers.DENSE_FOREST_4,
    ObjectIdentifiers.DENSE_FOREST_5,
  ]);
  const TRIPWIRE_IDS = new Set([ObjectIdentifiers.TRIPWIRE_3, ObjectIdentifiers.TRIPWIRE]);
  const STICKS_IDS = new Set([ObjectIdentifiers.STICKS]);
  const LEAVES_IDS = new Set([ObjectIdentifiers.LEAVES, ObjectIdentifiers.LEAVES_2, ObjectIdentifiers.LEAVES_3]);
  const ISAFDAR_LOG_BALANCE_ID = ObjectIdentifiers.LOG_BALANCE_10;
  const IORWERTH_LOG_BALANCE_ID = ObjectIdentifiers.LOG_BALANCE_9;
  const SULPHUR_ROCK_IDS = new Set([
    ObjectIdentifiers.SULPHUR,
    ObjectIdentifiers.SULPHUR_2,
    ObjectIdentifiers.SULPHUR_3,
  ]);
  const LIMESTONE_ROCK_IDS = new Set([
    ObjectIdentifiers.LIMESTONE_ROCK,
    ObjectIdentifiers.LIMESTONE_ROCK_2,
    ObjectIdentifiers.LIMESTONE_ROCK_3,
  ]);
  const WELL_IDS = new Set([ObjectIdentifiers.WELL_8, ObjectIdentifiers.WELL_9]); // 4004/4005
  const ARANDAR_GATE_IDS = new Set([ObjectIdentifiers.HUGE_GATE, ObjectIdentifiers.HUGE_GATE_2]); // 3944/3945
  const CATAPULT_ID = ObjectIdentifiers.CATAPULT_3; // 3976
  const COAL_TAR_ID = ObjectIdentifiers.COAL_TAR; // 3975
  const STILL_ID = ObjectIdentifiers.FRACTIONALISING_STILL; // 4026
  const FURNACE_IDS = new Set([ObjectIdentifiers.FURNACE, ObjectIdentifiers.SMALL_FURNACE]);
  const OLD_CAMP_FOOTPRINTS_ID = 2004; // regicide old camp footprints, no ObjectIdentifiers name

  const START_HOOK = "quest:regicide:start";
  const MESSENGER_SCROLL_ACTION_ID = "oJUE-4";
  const SCOUTS_KILL_IDRIS_ACTION_ID = "Ru0gbO";
  const PENDANT_GIVEN_ACTION_ID = "Yq0Mj5";
  const SHOW_PENDANT_ACTION_ID = "cZHYin";
  const FOOTPRINTS_ACTION_ID = "YP6KIU";
  const BOOK_GIVEN_ACTION_ID = "YFImo8";
  const BOOK_REPLACED_ACTION_ID = "GhpQNp";
  const SCROLL_GIVEN_ACTION_ID = "iCbSyT";
  const SCROLL_REPLACED_ACTION_ID = "YGAr_i";
  const ARIANWYN_MESSAGE_ACTION_ID = "cadgHq";
  const KING_HANDOVER_ACTION_ID = "HgxCWD";
  const COOKED_RABBIT_CONDITION_ID = "lv8Qfz";

  const GUARD_BRIBED_ATTRIBUTE = "quest.regicide.guard_bribed";

  let quest;
  const messengerByPlayer = new Map();

  const held = (player, itemId, amount = 1) => player.getInventory().getAmount(itemId) >= amount;
  const give = (player, itemId, amount = 1) => player.getInventory().adds(itemId, amount);
  const take = (player, itemId, amount = 1) => player.getInventory().deleteNumber(itemId, amount);
  const agilityLevel = (player) => player.getSkillManager().getCurrentLevel(Skill.AGILITY);
  const craftingLevel = (player) => player.getSkillManager().getCurrentLevel(Skill.CRAFTING);
  const inventoryFull = (player) => player.getInventory().isFull?.() === true;

  function giveOnce(player, itemId) {
    if (!held(player, itemId)) give(player, itemId, 1);
  }

  function regicideVariant(variant) {
    return { page: "Regicide", variant };
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I killed King Tyras with a bomb fired from his own catapult.</str>",
        "<str>I delivered Lord Iorwerth's message to King Lathas.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_SPOKEN_ARIANWYN) {
      return [
        "Arianwyn showed me the truth behind Iorwerth's message.",
        "I must still deliver it to <col=800000>King Lathas</col> and act normal.",
      ];
    }
    if (stage >= STAGE_REPORTED_IORWERTH) {
      const lines = ["I must take Lord Iorwerth's message to <col=800000>King Lathas</col>."];
      if (!held(player, IORWERTHS_MESSAGE)) lines.push("I lost the message, Iorwerth will give me another copy.");
      return lines;
    }
    if (stage >= STAGE_KILLED_TYRAS) {
      return [
        "The catapult bomb killed King Tyras.",
        "I should tell <col=800000>Lord Iorwerth</col>, then King Lathas.",
      ];
    }
    if (stage >= STAGE_SPOKEN_IORWERTH_2) {
      const lines = ["Lord Iorwerth has given me a book on explosives."];
      if (held(player, FUSED_BARREL_BOMB)) {
        lines.push("I have a fused barrel bomb ready for the catapult.");
      } else if (held(player, BARREL_BOMB)) {
        lines.push("I need a strip of cloth to make a fuse for the barrel bomb.");
      } else if (held(player, NAPHTHA_QUICKLIME_MIX) || held(player, NAPHTHA_SULPHUR_MIX)) {
        lines.push("I need ground sulphur to finish the bomb.");
      } else if (held(player, BARREL_OF_NAPHTHA)) {
        lines.push("I need quicklime and ground sulphur, then a fuse.");
      } else if (held(player, BARREL_OF_COAL_TAR)) {
        lines.push("I should distil the coal tar in the fractionalising still.");
      } else {
        lines.push("I need quicklime, sulphur and naphtha to make the bomb.");
      }
      return lines;
    }
    if (stage >= STAGE_ENTERED_CAMP) {
      return [
        "I found Tyras's camp hidden in the woods; he is in his tent, well guarded.",
        "I should report back to <col=800000>Lord Iorwerth</col>.",
      ];
    }
    if (stage >= STAGE_DEFEATED_GUARD) {
      return [
        "I fought off a Tyras guard in the undergrowth.",
        "His camp must be close.",
      ];
    }
    if (stage >= STAGE_SPOKEN_TRACKER_2) {
      return ["The tracker showed me how to find gaps in the dense forest."];
    }
    if (stage >= STAGE_FOUND_FOOTPRINTS) {
      return [
        "I found tracks that lead into impassable woodland.",
        "The <col=800000>tracker</col> may know how to follow them.",
      ];
    }
    if (stage >= STAGE_SHOWN_PENDANT) {
      return ["I should search the west end of Tyras's old camp for signs of him."];
    }
    if (stage >= STAGE_SPOKEN_TRACKER) {
      return held(player, CRYSTAL_PENDANT)
        ? ["I have Lord Iorwerth's pendant to prove I was sent."]
        : ["The <col=800000>tracker</col> wants proof that Lord Iorwerth sent me."];
    }
    if (stage >= STAGE_SPOKEN_IORWERTH) {
      return [
        "Lord Iorwerth's tracker waits at Tyras's old camp,",
        "south-east of the camp, north of the poisoned lake.",
      ];
    }
    if (stage >= STAGE_SPOKEN_SCOUTS) {
      return ["Elven scouts told me to speak with <col=800000>Lord Iorwerth</col>."];
    }
    if (stage >= STAGE_SPOKEN_LATHAS) {
      return [
        "King Lathas wants me to travel through the <col=800000>Well of Voyage</col>",
        "and kill his brother, King Tyras.",
        "Elves on the other side will help me.",
      ];
    }
    if (stage >= STAGE_RECEIVED_MESSAGE) {
      return [
        "A messenger gave me a summons from King Lathas.",
        "I should speak to him in <col=800000>Ardougne Castle</col>.",
      ];
    }
    return [
      "I can start this quest by speaking to <col=800000>King Lathas</col>",
      "in <col=800000>Ardougne Castle</col>.",
      "",
      "This quest has the following requirements:",
      "Underground Pass",
      agilityLevel(player) >= 56 ? "<str>Level 56 Agility</str>" : "Level 56 Agility",
      craftingLevel(player) >= 10 ? "<str>Level 10 Crafting</str>" : "Level 10 Crafting",
    ];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.AGILITY, 13750);
    // registerQuest adds the one coin that makes the reward 15,000.
    give(player, COINS, 14999);
  }

  /** Which transcript variant each speaker plays, by quest stage. */
  function selectVariant({ npcId, player }) {
    if (!npcId || !player) return null;
    const stage = quest.getStage(player);

    if (KING_LATHAS_IDS.has(npcId)) {
      if (stage < STAGE_RECEIVED_MESSAGE) return null;
      if (stage < STAGE_SPOKEN_LATHAS) return regicideVariant("starting-off-talking-to-king-lathas");
      if (stage < STAGE_REPORTED_IORWERTH) return regicideVariant("starting-off-talking-to-lathas-again");
      return regicideVariant("reporting-to-king-lathas-speaking-with-king-lathas");
    }
    if (npcId === NpcIdentifiers.KINGS_MESSENGER) {
      return stage === STAGE_NOT_STARTED ? regicideVariant("starting-off-message-from-the-king") : null;
    }
    if (SCOUT_IDS.has(npcId)) {
      return stage === STAGE_SPOKEN_LATHAS
        ? regicideVariant("entering-isafdar-encountering-idris-morvran-and-essyllt")
        : null;
    }
    if (IORWERTH_IDS.has(npcId)) {
      if (stage === STAGE_SPOKEN_SCOUTS) {
        quest.setStage(player, STAGE_SPOKEN_IORWERTH);
        return regicideVariant("entering-isafdar-speaking-with-lord-iorwerth");
      }
      if (stage === STAGE_SPOKEN_IORWERTH) return regicideVariant("entering-isafdar-talking-to-iorwerth-again");
      if (stage === STAGE_SPOKEN_TRACKER) return regicideVariant("tracking-tyras-camp-speaking-with-lord-iorwerth-again");
      if (stage === STAGE_SHOWN_PENDANT || stage === STAGE_FOUND_FOOTPRINTS) {
        return regicideVariant("tracking-tyras-camp-speaking-with-lord-iorwerth-again-2");
      }
      if (stage >= STAGE_SPOKEN_TRACKER_2 && stage <= STAGE_ENTERED_CAMP) {
        return regicideVariant("making-a-bomb-speaking-with-lord-iorwerth");
      }
      if (stage === STAGE_SPOKEN_IORWERTH_2) {
        return held(player, BIG_BOOK_OF_BANGS)
          ? regicideVariant("making-a-bomb-speaking-with-lord-iorwerth-about-ingredients")
          : regicideVariant("making-a-bomb-losing-the-book");
      }
      if (stage === STAGE_KILLED_TYRAS) return regicideVariant("committing-regicide-reporting-to-lord-iorwerth");
      if (stage === STAGE_REPORTED_IORWERTH && !held(player, IORWERTHS_MESSAGE)) {
        return regicideVariant("committing-regicide-losing-the-scroll");
      }
      return regicideVariant("committing-regicide-talking-to-lord-iorwerth-again");
    }
    if (npcId === NpcIdentifiers.ELF_TRACKER) {
      if (stage === STAGE_SPOKEN_IORWERTH) {
        return regicideVariant("entering-isafdar-talking-to-the-elf-tracker-before-iorwerth");
      }
      if (stage === STAGE_SPOKEN_TRACKER) {
        return held(player, CRYSTAL_PENDANT)
          ? regicideVariant("tracking-tyras-camp-returning-to-the-elf-tracker")
          : regicideVariant("tracking-tyras-camp-speaking-with-the-elf-tracker");
      }
      if (stage === STAGE_SHOWN_PENDANT) {
        return regicideVariant("tracking-tyras-camp-speaking-with-the-elf-tracker-again-before-finding-the-tracks");
      }
      if (stage === STAGE_FOUND_FOOTPRINTS) {
        quest.setStage(player, STAGE_SPOKEN_TRACKER_2);
        return regicideVariant("tracking-tyras-camp-speaking-with-the-elf-tracker-again-after-finding-the-tracks");
      }
      if (stage === STAGE_SPOKEN_TRACKER_2 || stage === STAGE_DEFEATED_GUARD) {
        return regicideVariant("tracking-tyras-camp-speaking-with-the-elf-tracker-again-after-finding-the-tracks");
      }
      if (stage === STAGE_ENTERED_CAMP) {
        return regicideVariant("tracking-tyras-camp-returning-to-the-elf-tracker-after-finding-the-camp");
      }
      if (stage >= STAGE_KILLED_TYRAS) return regicideVariant("committing-regicide-talking-to-the-elf-tracker");
      return null;
    }
    if (GENERAL_HINING_IDS.has(npcId)) {
      if (stage >= STAGE_KILLED_TYRAS) {
        return regicideVariant("committing-regicide-talking-to-tyras-forces-after-killing-him-talking-to-general-hining");
      }
      if (stage === STAGE_ENTERED_CAMP) return regicideVariant("tracking-tyras-camp-talking-to-general-hining");
      return null;
    }
    if (npcId === NpcIdentifiers.TYRAS_GUARD_5) {
      if (stage >= STAGE_KILLED_TYRAS) {
        return regicideVariant("committing-regicide-talking-to-tyras-forces-after-killing-him-talking-to-the-catapult-guard");
      }
      if (stage === STAGE_SPOKEN_IORWERTH_2 && Number(player.getAttribute(GUARD_BRIBED_ATTRIBUTE)) !== 1) {
        return regicideVariant("committing-regicide-bribing-the-guard");
      }
      return null;
    }
    if (TYRAS_GUARD_IDS.has(npcId)) {
      if (stage >= STAGE_KILLED_TYRAS) {
        return regicideVariant("committing-regicide-talking-to-tyras-forces-after-killing-him-talking-to-a-tyras-guard-in-the-camp");
      }
      return null;
    }
    if (npcId === NpcIdentifiers.CHEMIST) {
      return stage === STAGE_SPOKEN_IORWERTH_2 ? regicideVariant("making-a-bomb-speaking-with-the-chemist") : null;
    }
    if (ARIANWYN_IDS.has(npcId)) {
      return stage === STAGE_REPORTED_IORWERTH ? regicideVariant("reporting-to-king-lathas-meeting-arianwyn") : null;
    }
    return null;
  }

  /** Answer the page's prose conditions, only for this plugin's own NPCs. */
  function answerCondition({ player, npcId, text }) {
    if (!DIALOGUE_NPC_IDS.has(npcId)) return null;
    const value = String(text).toLowerCase();
    const full = player && inventoryFull(player);
    const hasItem = (itemId) => Boolean(player) && held(player, itemId);
    if (value.includes("doesn't have enough inventory space") || value.includes("doesn't have any inventory space")) {
      return full;
    }
    if (value.includes("has enough inventory space") || value.includes("has inventory space")) return !full;
    if (value.includes("without a cooked rabbit")) return !hasItem(COOKED_RABBIT);
    if (value.includes("with a cooked rabbit")) return hasItem(COOKED_RABBIT);
    if (value.includes("doesn't have the scroll")) return !hasItem(IORWERTHS_MESSAGE);
    if (value.includes("has the scroll")) return hasItem(IORWERTHS_MESSAGE);
    return null;
  }

  /** Wiki: 56 Agility and 10 Crafting. */
  function missingStartSkillRequirements(player) {
    const skills = player.getSkillManager();
    const missing = [];
    if (skills.getMaxLevel(Skill.AGILITY) < 56) missing.push("56 Agility");
    if (skills.getMaxLevel(Skill.CRAFTING) < 10) missing.push("10 Crafting");
    return missing;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!KING_LATHAS_IDS.has(npcId) || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_SPOKEN_LATHAS) {
      const missing = missingStartSkillRequirements(player);
      if (missing.length > 0) {
        player.sendMessage(`You need ${missing.join(" and ")} to start this quest.`);
        return;
      }
      quest.setStage(player, STAGE_SPOKEN_LATHAS);
    }
  }

  /** Message and action ids from the transcript drive the hand-ins and stages. */
  function handleAction(event) {
    const { player, npcId, stepId } = event;
    if (!player || !stepId) return;
    if (stepId === MESSENGER_SCROLL_ACTION_ID) {
      giveOnce(player, KINGS_MESSAGE);
      if (quest.getStage(player) < STAGE_RECEIVED_MESSAGE) quest.setStage(player, STAGE_RECEIVED_MESSAGE);
      removeMessenger(player);
      return;
    }
    if (stepId === SCOUTS_KILL_IDRIS_ACTION_ID) {
      if (quest.getStage(player) < STAGE_SPOKEN_SCOUTS) quest.setStage(player, STAGE_SPOKEN_SCOUTS);
      event.handled = true;
      return;
    }
    if (stepId === PENDANT_GIVEN_ACTION_ID) {
      giveOnce(player, CRYSTAL_PENDANT);
      return;
    }
    if (stepId === SHOW_PENDANT_ACTION_ID) {
      if (quest.getStage(player) < STAGE_SHOWN_PENDANT) quest.setStage(player, STAGE_SHOWN_PENDANT);
      return;
    }
    if (stepId === FOOTPRINTS_ACTION_ID) {
      if (quest.getStage(player) < STAGE_FOUND_FOOTPRINTS) quest.setStage(player, STAGE_FOUND_FOOTPRINTS);
      return;
    }
    if (stepId === BOOK_GIVEN_ACTION_ID) {
      giveOnce(player, BIG_BOOK_OF_BANGS);
      if (quest.getStage(player) < STAGE_SPOKEN_IORWERTH_2) quest.setStage(player, STAGE_SPOKEN_IORWERTH_2);
      return;
    }
    if (stepId === BOOK_REPLACED_ACTION_ID) {
      giveOnce(player, BIG_BOOK_OF_BANGS);
      return;
    }
    if (stepId === SCROLL_GIVEN_ACTION_ID) {
      giveOnce(player, IORWERTHS_MESSAGE);
      if (quest.getStage(player) < STAGE_REPORTED_IORWERTH) quest.setStage(player, STAGE_REPORTED_IORWERTH);
      return;
    }
    if (stepId === SCROLL_REPLACED_ACTION_ID) {
      giveOnce(player, IORWERTHS_MESSAGE);
      return;
    }
    if (stepId === ARIANWYN_MESSAGE_ACTION_ID) {
      if (quest.getStage(player) < STAGE_SPOKEN_ARIANWYN) quest.setStage(player, STAGE_SPOKEN_ARIANWYN);
      return;
    }
    if (stepId === KING_HANDOVER_ACTION_ID && KING_LATHAS_IDS.has(npcId)) {
      take(player, IORWERTHS_MESSAGE);
      if (!quest.isComplete(player)) quest.complete(player);
      event.handled = true;
      event.end = true;
    }
  }

  /** Giving the guard the cooked rabbit distracts him from the catapult. */
  function handleDialogueCondition(event) {
    if (!event || event.stepId !== COOKED_RABBIT_CONDITION_ID || !event.player) return;
    const { player } = event;
    if (held(player, COOKED_RABBIT)) take(player, COOKED_RABBIT);
    player.setAttribute(GUARD_BRIBED_ATTRIBUTE, 1);
  }

  function squeezeThrough(player, location) {
    const pos = player.getLocation();
    const dx = pos.getX() - location.x;
    const dy = pos.getY() - location.y;
    const destination =
      Math.abs(dx) >= Math.abs(dy)
        ? new Location(location.x + (dx >= 0 ? 2 : -2), pos.getY(), pos.getZ())
        : new Location(pos.getX(), location.y + (dy >= 0 ? 2 : -2), pos.getZ());
    player.moveTo(destination);
  }

  function crossDenseForest(event) {
    const { player, object, objectId, location } = event;
    const stage = quest.getStage(player);
    event.handled = true;
    if (stage < STAGE_SPOKEN_TRACKER_2) {
      player.sendMessage("You can see no way to get past this.");
      return;
    }
    if (agilityLevel(player) < 56) {
      player.sendMessage("You need level 56 Agility to pass this.");
      return;
    }
    if (stage === STAGE_SPOKEN_TRACKER_2) {
      player.sendMessage("A Tyras guard spots you as you force your way through the dense forest!");
      quest.setStage(player, STAGE_DEFEATED_GUARD);
    } else if (stage === STAGE_DEFEATED_GUARD && objectId === ObjectIdentifiers.DENSE_FOREST_4) {
      quest.setStage(player, STAGE_ENTERED_CAMP);
    }
    const definition = event.definition ?? object?.getDefinition?.();
    const face = object?.getFace?.() ?? 0;
    const sizeX = definition?.getSizeX?.() ?? 1;
    const sizeY = definition?.getSizeY?.() ?? 1;
    const width = face % 2 === 0 ? sizeX : sizeY;
    const height = face % 2 === 0 ? sizeY : sizeX;
    const position = player.getLocation();
    let x = position.getX();
    let y = position.getY();
    // This cache placement opens onto the north-side path only at these two
    // collision-clear tiles. Object routing keeps the approach outside its
    // three-tile footprint so the clicker's side is still unambiguous here.
    if (location.x === 2302 && location.y === 3214 && objectId === ObjectIdentifiers.DENSE_FOREST) {
      if (x < location.x) {
        x = 2305;
        y = 3213;
      } else {
        x = 2301;
        y = 3215;
      }
    } else if (x < location.x) x = location.x + width;
    else if (x >= location.x + width) x = location.x - 1;
    else if (y < location.y) y = location.y + height;
    else y = location.y - 1;
    player.moveTo(new Location(x, y, position.getZ()));
  }

  function routeMeilyrDenseForest(event) {
    if (LEAVES_IDS.has(event.objectId)) {
      const objectLocation = event.object?.getLocation?.();
      if (!objectLocation) return;
      const location = {
        x: objectLocation.getX(),
        y: objectLocation.getY(),
        z: objectLocation.getZ(),
      };
      const bounds = leafTrapBounds({ ...event, location });
      const from = event.sourceLocation;
      const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
      if (from.x < bounds.minX) {
        event.destination = { x: bounds.minX - 1, y: clamp(from.y, bounds.minY, bounds.maxY), z: from.z };
      } else if (from.x > bounds.maxX) {
        event.destination = { x: bounds.maxX + 1, y: clamp(from.y, bounds.minY, bounds.maxY), z: from.z };
      } else if (from.y < bounds.minY) {
        event.destination = { x: clamp(from.x, bounds.minX, bounds.maxX), y: bounds.minY - 1, z: from.z };
      } else if (from.y > bounds.maxY) {
        event.destination = { x: clamp(from.x, bounds.minX, bounds.maxX), y: bounds.maxY + 1, z: from.z };
      }
      return;
    }
    if (
      event.objectId !== ObjectIdentifiers.DENSE_FOREST ||
      event.object?.getLocation?.()?.getX() !== 2302 ||
      event.object?.getLocation?.()?.getY() !== 3214
    ) return;
    const from = event.sourceLocation;
    const z = event.object.getLocation().getZ();
    event.destination = from.x < 2302
      ? { x: 2301, y: 3215, z }
      : { x: 2305, y: 3213, z };
  }

  /** Wiki's chance chart is 31/256 at level 1, rising to 156/256 at level 99. */
  function stepOverTripwire(event) {
    const { player, object, location } = event;
    const option = event.definition?.getActions?.()?.[event.clickType - 1];
    if (option !== "Step-over") return;
    event.handled = true;
    const position = player.getLocation();
    const level = Math.max(1, Math.min(99, player.getSkillManager().getCurrentLevel(Skill.AGILITY)));
    const successChance = (31 + ((level - 1) * (156 - 31)) / 98) / 256;
    // A snag still crosses: rsprox_transcripts/230/02969.txt tick 156-157 and 237/01105.txt tick 13814-13815
    // step over (regicide_stepover), then "You snag the trip wire as you step over it.", "You have been
    // poisoned!" and poison varp 0 -> 10. poisonEntity starts it, says the second line and honours immunity.
    if (Math.random() >= successChance) {
      player.getCombat().getHitQueue().addPendingDamage([new HitDamage(10, HitMask.RED)]);
      player.sendMessage("You snag the trip wire as you step over it.");
      api.core.CombatFactory.poisonEntity(player, 10);
    }
    const face = object?.getFace?.() ?? 0;
    // Cross past the wire's full local-Y footprint, rotated onto the crossing axis.
    const axis = face % 2 === 0 ? "y" : "x";
    const current = axis === "x" ? position.getX() : position.getY();
    const wire = location[axis];
    const span = event.definition?.getSizeY?.() ?? 1;
    const destination = current > wire ? wire - 1 : wire + span;
    player.moveTo(new Location(
      axis === "x" ? destination : position.getX(),
      axis === "y" ? destination : position.getY(),
      position.getZ(),
    ));
  }

  function leafTrapBounds(event) {
    const { location } = event;
    const z = location.z ?? location.getZ?.() ?? 0;
    const originX = location.x ?? location.getX?.();
    const originY = location.y ?? location.getY?.();
    const queue = [[originX, originY]];
    const visited = new Set([`${originX},${originY}`]);
    const tiles = [];
    for (let i = 0; i < queue.length && i < 25; i++) {
      const [x, y] = queue[i];
      const tile = new Location(x, y, z);
      const objects = [
        ...(ObjectManager?.objectsAt?.(tile) ?? []),
        ...(MapObjects?.mapObjects?.get?.(MapObjects.getHash(x, y, z)) ?? []),
      ];
      if (!objects.some((object) => LEAVES_IDS.has(object.getId?.()))) continue;
      tiles.push([x, y]);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        const key = `${nx},${ny}`;
        if (visited.has(key) || Math.abs(nx - originX) > 2 || Math.abs(ny - originY) > 2) continue;
        visited.add(key);
        queue.push([nx, ny]);
      }
    }
    if (!tiles.length) return { minX: originX, maxX: originX, minY: originY, maxY: originY };
    return {
      minX: Math.min(...tiles.map(([x]) => x)), maxX: Math.max(...tiles.map(([x]) => x)),
      minY: Math.min(...tiles.map(([, y]) => y)), maxY: Math.max(...tiles.map(([, y]) => y)),
    };
  }

  function crossAgilityTrap(event, { successChance, damage, label }) {
    const { player, location } = event;
    const option = event.definition?.getActions?.()?.[event.clickType - 1];
    if (option !== label) return;
    event.handled = true;
    const source = event.sourceLocation ?? player.getLocation();
    const px = source.x ?? source.getX?.();
    const py = source.y ?? source.getY?.();
    const pz = source.z ?? source.getZ?.();
    const locX = location.x ?? location.getX?.();
    const locY = location.y ?? location.getY?.();
    const level = Math.max(1, Math.min(99, player.getSkillManager().getCurrentLevel(Skill.AGILITY)));
    if (Math.random() >= successChance(level)) {
      const hit = LEAVES_IDS.has(event.objectId) ? Math.floor(Math.random() * damage) + 1 : damage;
      player.getCombat().getHitQueue().addPendingDamage([new HitDamage(hit, HitMask.RED)]);
      if (LEAVES_IDS.has(event.objectId)) {
        player.sendMessage("You fall into the leaf trap and take damage.");
      } else {
        player.sendMessage("You fail to pass the trap and are knocked back.");
        if (px < locX) player.moveTo(new Location(px - 1, py, pz));
        else if (px > locX) player.moveTo(new Location(px + 1, py, pz));
        else if (py < locY) player.moveTo(new Location(px, py - 1, pz));
        else player.moveTo(new Location(px, py + 1, pz));
      }
      return;
    }
    const bounds = LEAVES_IDS.has(event.objectId)
      ? leafTrapBounds(event)
      : { minX: locX, maxX: locX, minY: locY, maxY: locY };
    let x = px;
    let y = py;
    let axis;
    if (px < bounds.minX) { axis = "x"; x = bounds.maxX + 1; }
    else if (px > bounds.maxX) { axis = "x"; x = bounds.minX - 1; }
    else if (py < bounds.minY) { axis = "y"; y = bounds.maxY + 1; }
    else if (py > bounds.maxY) { axis = "y"; y = bounds.minY - 1; }
    else {
      player.sendMessage("Stand beside the near edge of the trap before trying to cross it.");
      return;
    }
    player.moveTo(new Location(x, y, pz));
  }

  function jumpLeaves(event) {
    crossAgilityTrap(event, {
      successChance: (agility) => Math.round(181 + ((agility - 1) * 75) / 98) / 256,
      damage: 18,
      label: "Jump",
    });
  }

  function passSticks(event) {
    crossAgilityTrap(event, {
      successChance: (agility) => Math.round(31 + ((agility - 1) * 125) / 98) / 256,
      damage: 8,
      label: "Pass",
    });
  }

  /** Cache log endpoints connect the forest banks; land outside their collision. */
  function crossIsafdarLogBalance(event) {
    const { player, location, sourceLocation } = event;
    if (event.objectId === IORWERTH_LOG_BALANCE_ID) {
      if (location.z !== 0 || location.y !== 3237 || ![2197, 2201].includes(location.x) ||
        (event.option && event.option.toLowerCase() !== "cross")) return;
      event.handled = true;
      if (agilityLevel(player) < 45) {
        player.sendMessage("You need an Agility level of 45 to cross this log balance.");
        return;
      }
      player.performAnimation?.(new api.core.Animation(762));
      player.moveTo(location.x === 2197
        ? new Location(2201, 3236, 0)
        : new Location(2197, 3238, 0));
      return;
    }
    if (location.z !== 0 || location.y !== 3250 || ![2259, 2263].includes(location.x) ||
      (event.option && event.option.toLowerCase() !== "cross")) return;
    event.handled = true;
    const sourceX = sourceLocation?.x ?? player.getLocation().getX();
    const destinationX = location.x === 2259
      ? (sourceX > location.x ? 2258 : 2259)
      : (sourceX < location.x ? 2264 : 2262);
    player.performAnimation?.(new api.core.Animation(762));
    player.moveTo(new Location(destinationX, 3250, 0));
  }

  function inspectFootprints(event) {
    const { player } = event;
    const stage = quest.getStage(player);
    event.handled = true;
    if (stage < STAGE_SHOWN_PENDANT) {
      player.sendMessage("You are unable to make anything of the markings.");
      return;
    }
    if (stage >= STAGE_FOUND_FOOTPRINTS) {
      player.sendMessage("I know where those tracks lead.");
      return;
    }
    if (
      !startTranscript(api, player, NpcIdentifiers.ELF_TRACKER, "Regicide", "tracking-tyras-camp-finding-the-tracks")
    ) {
      player.sendMessage("You try to follow the footprints but they lead into impassable woodland.");
    }
    quest.setStage(player, STAGE_FOUND_FOOTPRINTS);
  }

  function climbWell(event) {
    const { player } = event;
    // While the Regicide repair quest is active, its story route handles the
    // well. Once complete, let the shared captured loc route own it: the same
    // cache well is also the Underground Pass connection used by later quests.
    if (quest.getStage(player) < STAGE_RECEIVED_MESSAGE || quest.isComplete(player)) return;
    event.handled = true;
    const pos = player.getLocation();
    player.sendMessage("You climb into the well..");
    const destination =
      pos.getY() > 9000
        ? new Location(2312, 3216, 0) // Isafdar, by the Arandar pass
        : new Location(2343, 9622, 0); // underground, Iban's temple side
    player.moveTo(destination);
  }

  function passArandarGate(event) {
    const { player, location, sourceLocation } = event;
    event.handled = true;
    if (quest.getStage(player) < STAGE_REPORTED_IORWERTH) {
      player.sendMessage("No human may enter Tirannwn. Unless you have the proper documentation, sealed by one of the great houses.");
      return;
    }
    player.sendMessage("The guards recognise Lord Iorwerth's seal and let you pass.");
    // Both Huge Gate leaves (3944/3945) form a north/south barrier. The
    // object route puts the player beside the clicked leaf before this hook,
    // so use that approach side and move across the full gate row.
    const sourceY = sourceLocation?.y ?? player.getLocation().getY();
    const destinationY = sourceY < location.y ? location.y + 2 : location.y - 2;
    const position = player.getLocation();
    player.moveTo(new Location(position.getX(), destinationY, position.getZ()));
  }

  function handleObjectInteraction(event) {
    const { player, objectId, location } = event;
    if (!player || !location) return;
    if (WELL_IDS.has(objectId)) {
      climbWell(event);
      return;
    }
    if (ARANDAR_GATE_IDS.has(objectId)) {
      passArandarGate(event);
      return;
    }
    if (objectId === OLD_CAMP_FOOTPRINTS_ID) {
      inspectFootprints(event);
      return;
    }
    if (DENSE_FOREST_IDS.has(objectId)) {
      crossDenseForest(event);
      return;
    }
    if (TRIPWIRE_IDS.has(objectId)) {
      stepOverTripwire(event);
      return;
    }
    if (LEAVES_IDS.has(objectId)) {
      jumpLeaves(event);
      return;
    }
    if (objectId === ISAFDAR_LOG_BALANCE_ID || objectId === IORWERTH_LOG_BALANCE_ID) {
      crossIsafdarLogBalance(event);
      return;
    }
    if (STICKS_IDS.has(objectId)) {
      passSticks(event);
      return;
    }
    if (SULPHUR_ROCK_IDS.has(objectId)) {
      event.handled = true;
      give(player, SULPHUR_ITEM, 1);
      player.sendMessage("You break off a piece of the formation.");
      return;
    }
    if (LIMESTONE_ROCK_IDS.has(objectId)) {
      event.handled = true;
      give(player, LIMESTONE_ITEM, 1);
      player.sendMessage("You mine some limestone.");
      return;
    }
    if (objectId === COAL_TAR_ID) {
      event.handled = true;
      player.sendMessage("I need something to hold the coal tar.");
    }
  }

  function handleItemOnObject(event) {
    const { player, itemId, objectId } = event;
    if (!player) return;
    if (itemId === EMPTY_BARREL && objectId === COAL_TAR_ID) {
      event.handled = true;
      take(player, EMPTY_BARREL, 1);
      give(player, BARREL_OF_COAL_TAR, 1);
      player.sendMessage("You fill the barrel with tar.");
      return;
    }
    if (itemId === BARREL_OF_COAL_TAR && objectId === STILL_ID) {
      event.handled = true;
      take(player, BARREL_OF_COAL_TAR, 1);
      give(player, BARREL_OF_NAPHTHA, 1);
      player.sendMessage("You distil the coal tar in the still.");
      return;
    }
    if (itemId === LIMESTONE_ITEM && FURNACE_IDS.has(objectId)) {
      event.handled = true;
      if (quest.getStage(player) < STAGE_SPOKEN_IORWERTH_2) {
        player.sendMessage("I see no reason to put this in the furnace.");
        return;
      }
      take(player, LIMESTONE_ITEM, 1);
      give(player, QUICKLIME_ITEM, 1);
      player.sendMessage("You put the limestone in the furnace and retrieve a block of quicklime.");
      return;
    }
    if (itemId === BALL_OF_WOOL && objectId === ObjectIdentifiers.LOOM) {
      event.handled = true;
      if (craftingLevel(player) < 10) {
        player.sendMessage("You need level 10 Crafting to make that.");
        return;
      }
      if (!held(player, BALL_OF_WOOL, 4)) {
        player.sendMessage("You don't have enough balls of wool to weave a strip of cloth.");
        return;
      }
      take(player, BALL_OF_WOOL, 4);
      give(player, STRIP_OF_CLOTH, 1);
      player.sendMessage("You weave the balls of wool into a strip of cloth.");
      return;
    }
    if (itemId === FUSED_BARREL_BOMB && objectId === CATAPULT_ID) {
      event.handled = true;
      const stage = quest.getStage(player);
      if (stage !== STAGE_SPOKEN_IORWERTH_2) {
        player.sendMessage("I think I've done enough damage with that.");
        return;
      }
      if (Number(player.getAttribute(GUARD_BRIBED_ATTRIBUTE)) !== 1) {
        if (
          !startTranscript(api, player, NpcIdentifiers.TYRAS_GUARD_5, "Regicide", "committing-regicide-trying-to-use-the-catapult-before-distracting-the-guard")
        ) {
          player.sendMessage("Oi! Don't mess with that.");
        }
        return;
      }
      if (!held(player, TINDERBOX)) {
        player.sendMessage("You need a tinderbox to light the fuse.");
        return;
      }
      take(player, FUSED_BARREL_BOMB, 1);
      player.sendMessage("You load the barrel bomb into the catapult and light the fuse...");
      player.sendMessage("The burning barrel arcs through the air and explodes on King Tyras's tent!");
      quest.setStage(player, STAGE_KILLED_TYRAS);
    }
  }

  /** The bomb recipe: grind, mix, seal, fuse. */
  function handleItemOnItem(event) {
    const { player } = event;
    if (!player) return;
    const ids = [event.usedItemId, event.usedWithItemId];
    const pair = (a, b) => ids.includes(a) && ids.includes(b);
    if (pair(PESTLE_AND_MORTAR, SULPHUR_ITEM)) {
      event.handled = true;
      take(player, SULPHUR_ITEM, 1);
      give(player, GROUND_SULPHUR, 1);
      player.sendMessage("You grind the sulphur into a fine dust.");
      return;
    }
    if (pair(PESTLE_AND_MORTAR, QUICKLIME_ITEM)) {
      event.handled = true;
      if (!held(player, POT)) {
        player.sendMessage("You burn yourself on the caustic dust before spilling it on the ground.");
        player.sendMessage("Maybe you need something to store it in.");
        return;
      }
      take(player, QUICKLIME_ITEM, 1);
      take(player, POT, 1);
      give(player, POT_OF_QUICKLIME, 1);
      player.sendMessage("You grind the quicklime to dust and store it in a pot.");
      return;
    }
    if (pair(BARREL_OF_NAPHTHA, POT_OF_QUICKLIME)) {
      event.handled = true;
      take(player, BARREL_OF_NAPHTHA, 1);
      take(player, POT_OF_QUICKLIME, 1);
      give(player, NAPHTHA_QUICKLIME_MIX, 1);
      player.sendMessage("You mix the quicklime dust into the naphtha.");
      return;
    }
    if (pair(BARREL_OF_NAPHTHA, GROUND_SULPHUR)) {
      event.handled = true;
      take(player, BARREL_OF_NAPHTHA, 1);
      take(player, GROUND_SULPHUR, 1);
      give(player, NAPHTHA_SULPHUR_MIX, 1);
      player.sendMessage("You mix the sulphur dust into the naphtha.");
      return;
    }
    if (pair(NAPHTHA_QUICKLIME_MIX, GROUND_SULPHUR)) {
      event.handled = true;
      take(player, NAPHTHA_QUICKLIME_MIX, 1);
      take(player, GROUND_SULPHUR, 1);
      give(player, BARREL_BOMB, 1);
      player.sendMessage("You mix the sulphur dust into the naphtha and seal the barrel.");
      player.sendMessage("Now you just need to make a fuse for it.");
      return;
    }
    if (pair(NAPHTHA_SULPHUR_MIX, POT_OF_QUICKLIME)) {
      event.handled = true;
      take(player, NAPHTHA_SULPHUR_MIX, 1);
      take(player, POT_OF_QUICKLIME, 1);
      give(player, BARREL_BOMB, 1);
      player.sendMessage("You mix the quicklime dust into the naphtha and seal the barrel.");
      player.sendMessage("Now you just need to make a fuse for it.");
      return;
    }
    if (pair(BARREL_BOMB, STRIP_OF_CLOTH)) {
      event.handled = true;
      take(player, BARREL_BOMB, 1);
      take(player, STRIP_OF_CLOTH, 1);
      give(player, FUSED_BARREL_BOMB, 1);
      player.sendMessage("You stuff cloth through a hole in the barrel to make a fuse.");
    }
  }

  function trackedMessenger(player) {
    return messengerByPlayer.get(player);
  }

  function removeMessenger(player) {
    const npc = trackedMessenger(player);
    if (npc) api.removeNpc(npc);
    messengerByPlayer.delete(player);
  }

  function undergroundPassComplete(player) {
    const undergroundPass = getRegisteredQuests().find((entry) => entry.key === "underground_pass");
    return Boolean(undergroundPass && undergroundPass.isComplete(player));
  }

  function ensureMessenger(player) {
    if (!player || player.isPlayerBot?.() === true) return;
    if (quest.getStage(player) !== STAGE_NOT_STARTED) return;
    if (!undergroundPassComplete(player)) return;
    if (trackedMessenger(player)) return;
    const pos = player.getLocation();
    const npc = api.spawnNpc({
      id: NpcIdentifiers.KINGS_MESSENGER,
      x: pos.getX() + 1,
      y: pos.getY(),
      z: pos.getZ(),
      wanderRadius: 2,
      owner: player,
      ownerOnly: true,
    });
    if (npc) messengerByPlayer.set(player, npc);
  }

  function handleLogout({ player }) {
    if (player) removeMessenger(player);
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
    ensureMessenger(player);
  }

  api.persistAttribute(GUARD_BRIBED_ATTRIBUTE);

  quest = registerQuest(api, {
    key: "regicide",
    name: "Regicide",
    varpId: VARP_REGICIDE,
    startedValue: STAGE_RECEIVED_MESSAGE,
    completionValue: STAGE_COMPLETE,
    questPoints: 3,
    xpRewards: [{ skillId: Skill.AGILITY.getIndex(), amount: 13750, label: "Agility" }],
    rewardItemId: COINS,
    rewardItemLabel: "15,000 Coins",
    scrollItemId: ItemIdentifiers.SYMBOL_7,
    otherRewards: ["Access to the Arandar pass"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:condition", handleDialogueCondition);
  api.onObjectInteraction(handleObjectInteraction);
  api.onObjectRoute(routeMeilyrDenseForest);
  api.onItemOnObject(handleItemOnObject, { noted: false });
  api.onItemOnItem(handleItemOnItem);
  api.onPlayerLogout(handleLogout);
  api.onPlayerLogin(handleLogin);
};
