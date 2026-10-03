/**
 * Jungle Potion (members).
 *
 * The words come from the "Jungle Potion" and "Trufitus" transcript pages; both
 * are indexed for Trufitus, so this plugin selects the variant by stage, answers
 * the prose conditions, runs the start hook, converts the five clean-herb
 * conditions into hand-ins, searches the jungle herb locations and cleans the
 * grimy herbs.
 *
 * Stages (varp 175): 1-2 snake weed (asked/found), 3-4 ardrigal, 5-6 sito foil,
 * 7-8 volencia moss, 9-10 rogue's purse, 11 all found, 12 complete, 13 spoken.
 * Handing in the fifth clean herb plays the transcript's "Quest complete!"
 * action and finishes the quest.
 *
 * Gaps (no dump/index support): the Druidic Ritual requirement is not enforced
 * (no condition in the transcript); the "obtained from a monster drop" freshness
 * branch is always answered false because freshness is not tracked; cleaning the
 * jungle herbs is supplied here because the Herblore skill plugin does not list
 * them as cleanable.
 */
module.exports = function registerJunglePotionQuest(api) {
  const { Skill, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers, Location } = api.core;
  const { registerQuest, startTranscript, refreshQuestList } = require("../QuestRuntime");

  const TRUFITUS_NPC_ID = NpcIdentifiers.TRUFITUS; // 4625
  const PAGE = "Jungle Potion";

  const VARP_JUNGLE_POTION = 175;
  const STAGE_STARTED = 1;
  const STAGE_COMPLETE = 12;

  const START_HOOK = "quest:jungle-potion:start";
  const COMPLETE_ACTION_ID = "WiofTb";

  const POTHOLE_ENTRANCE_LOC_ID = ObjectIdentifiers.ROCKS_4; // 2584
  const POTHOLE_EXIT_LOC_ID = ObjectIdentifiers.HAND_HOLDS; // 2585
  const POTHOLE_INTERIOR = { x: 2830, y: 9520, z: 0 };
  const POTHOLE_EXTERIOR = { x: 2823, y: 3120, z: 0 };
  /** Transcript messages for the "enter the caves?" choice. */
  const ENTER_CAVE_MESSAGE_ID = "LP0T9g";

  const HERBS = [
    {
      name: "Snake weed",
      grimy: ItemIdentifiers.GRIMY_SNAKE_WEED,
      clean: ItemIdentifiers.SNAKE_WEED,
      locId: ObjectIdentifiers.MARSHY_JUNGLE_VINE,
      requestedStage: 1,
      foundStage: 2,
      nextStage: 3,
      searchVariant: "snake-weed-searching-the-marshy-jungle-vine",
      talkVariant: "snake-weed-talking-to-trufitus",
      handInStepId: "Z2U1Sk",
    },
    {
      name: "Ardrigal",
      grimy: ItemIdentifiers.GRIMY_ARDRIGAL,
      clean: ItemIdentifiers.ARDRIGAL,
      locId: ObjectIdentifiers.PALM_TREE_2,
      requestedStage: 3,
      foundStage: 4,
      nextStage: 5,
      searchVariant: "ardrigal-search-palm-tree",
      talkVariant: "ardrigal-talking-to-trufitus",
      handInStepId: "1TUBY2",
    },
    {
      name: "Sito foil",
      grimy: ItemIdentifiers.GRIMY_SITO_FOIL,
      clean: ItemIdentifiers.SITO_FOIL,
      locId: ObjectIdentifiers.SCORCHED_EARTH,
      requestedStage: 5,
      foundStage: 6,
      nextStage: 7,
      searchVariant: "sito-foil-searching-the-scorched-earth",
      talkVariant: "sito-foil-talking-to-trufitus",
      handInStepId: "4Qi9K-",
    },
    {
      name: "Volencia moss",
      grimy: ItemIdentifiers.GRIMY_VOLENCIA_MOSS,
      clean: ItemIdentifiers.VOLENCIA_MOSS,
      locId: ObjectIdentifiers.ROCK_3,
      requestedStage: 7,
      foundStage: 8,
      nextStage: 9,
      searchVariant: "volencia-moss-searching-the-rock",
      talkVariant: "volencia-moss-talking-to-trufitus",
      handInStepId: "l4gnZZ",
    },
    {
      name: "Rogue's purse",
      grimy: ItemIdentifiers.GRIMY_ROGUES_PURSE,
      clean: ItemIdentifiers.ROGUES_PURSE,
      locId: ObjectIdentifiers.FUNGUS_COVERED_CAVERN_WALL,
      requestedStage: 9,
      foundStage: 10,
      nextStage: 11,
      searchVariant: "rogue-s-purse-search-fungus-covered-cavern-wall",
      talkVariant: "rogue-s-purse-talking-to-trufitus",
      handInStepId: "3UOzJ-",
    },
  ];

  const LOC_TO_HERB = new Map(HERBS.map((herb) => [herb.locId, herb]));
  const HAND_IN_STEPS = new Map(HERBS.map((herb) => [herb.handInStepId, herb]));
  const GRIMY_TO_CLEAN = new Map(HERBS.map((herb) => [herb.grimy, herb]));

  let quest;

  const held = (player, itemId) => player.getInventory().getAmount(itemId) > 0;

  function currentHerb(stage) {
    return HERBS.find((herb) => stage === herb.requestedStage || stage === herb.foundStage);
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage <= 0) {
      return [
        "I can start this quest by speaking to",
        "<col=800000>Trufitus Shakaya</col> in <col=800000>Tai Bwo Wannai</col>.",
        "",
        "I must have completed <col=800000>Druidic Ritual</col>.",
      ];
    }
    const lines = [
      "<str>I spoke to Trufitus. He needs to commune with the gods</str>",
      "<str>and asked me to collect five special jungle herbs.</str>",
      "",
    ];
    for (const herb of HERBS) {
      if (stage > herb.foundStage) {
        lines.push(`<str>I collected fresh ${herb.name} for Trufitus.</str>`);
        continue;
      }
      if (stage === herb.foundStage) {
        const carrying = held(player, herb.grimy) || held(player, herb.clean);
        lines.push(
          carrying
            ? `<str>I found some fresh ${herb.name}.</str>`
            : `I need to collect more fresh <col=800000>${herb.name}</col>.`
        );
        if (carrying) lines.push("I should clean it and give it to <col=800000>Trufitus</col>.");
        break;
      }
      if (stage === herb.requestedStage) {
        lines.push(
          `I need to find fresh <col=800000>${herb.name}</col> for <col=800000>Trufitus</col>.`
        );
        break;
      }
    }
    if (stage >= STAGE_COMPLETE) lines.push("", "<col=ff0000>QUEST COMPLETE!</col>");
    return lines;
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.HERBLORE, 775);
  }

  function selectVariant({ npcId, player }) {
    if (npcId !== TRUFITUS_NPC_ID) return null;
    const stage = quest.getStage(player);
    if (stage <= 0) return "starting-off";
    if (stage >= STAGE_COMPLETE) return "after-jungle-potion";
    if (stage >= 11) return HERBS[4].talkVariant;
    const herb = currentHerb(stage);
    return herb ? herb.talkVariant : "starting-off";
  }

  function answerCondition({ player, text }) {
    const value = String(text).toLowerCase();
    for (const herb of HERBS) {
      const name = herb.name.toLowerCase();
      const hasGrimy = held(player, herb.grimy);
      const hasClean = held(player, herb.clean);
      if (value.includes(`does not have any ${name}`) || value.includes(`has no ${name}`)) {
        return !hasGrimy && !hasClean;
      }
      if (value.includes(`has grimy ${name}`)) return hasGrimy;
      if (value.includes("obtained from a monster drop")) return false;
      if (value.includes(`has ${name}`)) return hasClean;
    }
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== TRUFITUS_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_STARTED) quest.setStage(player, STAGE_STARTED);
  }

  /** The chosen "player has the clean herb" branch consumes it and advances. */
  function handleCondition({ player, npcId, stepId }) {
    if (npcId !== TRUFITUS_NPC_ID) return;
    const herb = HAND_IN_STEPS.get(stepId);
    if (!herb || !held(player, herb.clean)) return;
    player.getInventory().deleteNumber(herb.clean, 1);
    quest.setStage(player, herb.nextStage);
  }

  /** The transcript's completion action on the last hand-in. */
  function handleAction({ player, npcId, stepId }) {
    if (npcId !== TRUFITUS_NPC_ID || stepId !== COMPLETE_ACTION_ID) return;
    if (quest.getStage(player) >= 11 && !quest.isComplete(player)) quest.complete(player);
  }

  /** Search a herb location: hand over the grimy herb and replay the search text. */
  function handleObjectInteraction(event) {
    const herb = LOC_TO_HERB.get(event.objectId);
    if (herb) {
      const action = String(
        event.definition?.getInteractions?.()?.[event.clickType - 1] ?? ""
      ).toLowerCase();
      if (action !== "search") return;
      event.handled = true;
      const stage = quest.getStage(event.player);
      if (stage < herb.requestedStage) {
        event.player.sendMessage(
          herb === HERBS[0]
            ? "Unfortunately, you find nothing of interest."
            : "You find nothing of significance."
        );
        return;
      }
      if (event.player.getInventory().isFull()) {
        event.player.sendMessage("You find a herb, but you have no room to store it.");
        return;
      }
      event.player.getInventory().adds(herb.grimy, 1);
      if (stage === herb.requestedStage) quest.setStage(event.player, herb.foundStage);
      startTranscript(api, event.player, TRUFITUS_NPC_ID, PAGE, herb.searchVariant);
      return;
    }

    if (event.objectId === POTHOLE_ENTRANCE_LOC_ID) {
      const action = String(
        event.definition?.getInteractions?.()?.[event.clickType - 1] ?? ""
      ).toLowerCase();
      if (action !== "search") return;
      event.handled = true;
      startTranscript(api, event.player, TRUFITUS_NPC_ID, PAGE, "rogue-s-purse-search-rocks");
      return;
    }

    if (event.objectId === POTHOLE_EXIT_LOC_ID) {
      const action = String(
        event.definition?.getInteractions?.()?.[event.clickType - 1] ?? ""
      ).toLowerCase();
      if (!action.includes("climb")) return;
      event.handled = true;
      event.player.sendMessage("You climb the rocks back out of the cave.");
      event.player.moveTo(new Location(POTHOLE_EXTERIOR.x, POTHOLE_EXTERIOR.y, POTHOLE_EXTERIOR.z));
    }
  }

  /** The transcript's "you decide to enter the caves" message moves the player. */
  function handleMessageAction(event) {
    if (event.npcId !== TRUFITUS_NPC_ID || event.stepId !== ENTER_CAVE_MESSAGE_ID) return;
    event.player.moveTo(new Location(POTHOLE_INTERIOR.x, POTHOLE_INTERIOR.y, POTHOLE_INTERIOR.z));
    event.handled = true;
  }

  /** Cleaning a grimy jungle herb (the Herblore plugin does not list these). */
  function handleItemAction(event) {
    const herb = GRIMY_TO_CLEAN.get(event.itemId);
    if (!herb) return;
    if (event.option && !/clean/i.test(event.option)) return;
    event.handled = true;
    if (quest.getStage(event.player) < STAGE_STARTED) {
      event.player.sendMessage("You cannot clean this herb until you have started Jungle Potion.");
      return;
    }
    if (event.player.getSkillManager().getCurrentLevel(Skill.HERBLORE) < 3) {
      event.player.sendMessage("You need a Herblore level of 3 to clean this herb.");
      return;
    }
    event.player.getInventory().deleteAtSlot(event.slot, 1);
    event.player.getInventory().adds(herb.clean, 1);
    event.player.getSkillManager().addExperiences(Skill.HERBLORE, 2.5);
    event.player.sendMessage(`You clean the ${herb.name.toLowerCase()}.`);
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  quest = registerQuest(api, {
    key: "jungle_potion",
    name: "Jungle Potion",
    varpId: VARP_JUNGLE_POTION,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.HERBLORE.getIndex(), amount: 775, label: "Herblore" }],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:condition", handleCondition);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:action", handleMessageAction);
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemAction(handleItemAction);
  api.onPlayerLogin(handleLogin);
};
