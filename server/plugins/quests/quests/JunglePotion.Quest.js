/**
 * Jungle Potion (members).
 *
 * The words come from the "Jungle Potion" and "Trufitus" transcript pages; both
 * are indexed for Trufitus, so this plugin selects the variant by stage, answers
 * the prose conditions, runs the start hook, converts the five clean-herb
 * conditions into hand-ins, searches the jungle herb locations (which empty and
 * grow back, docs/quests/jungle-potion/README.md) and cleans the
 * grimy herbs.
 *
 * Stages (varp 175): 1-2 snake weed (asked/found), 3-4 ardrigal, 5-6 sito foil,
 * 7-8 volencia moss, 9-10 rogue's purse, 11 all handed in, 12 complete, 13 Trufitus has
 * sent the player to Timfraku with the news (his post-quest talk; rsprox captures, the
 * user's JunglePotion run tick 1131).
 * Handing in the fifth clean herb plays the transcript's "Quest complete!"
 * action and finishes the quest; talking at 11 replays that completion tail so
 * an interrupted final hand-in is not a dead end.
 *
 * Boxes as live sends them (JunglePotion, revision 242.1; docs/quests/jungle-potion/README.md):
 * each hand-in is an item box with the clean herb, the Herblore lesson, the Pothole Cave
 * entrance lines and the climb out are message boxes. The dump makes every Wiki {{tbox}}
 * and {{mes}} a plain message step, so this plugin says which are boxes.
 *
 * Gaps (no dump/index support): the Druidic Ritual requirement is enforced at the start hook
 * (no condition in the transcript); the "obtained from a monster drop" freshness
 * branch is always answered false because freshness is not tracked; cleaning the
 * jungle herbs is supplied here because the Herblore skill plugin does not list
 * them as cleanable.
 */
module.exports = function registerJunglePotionQuest(api) {
  const { Skill, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers, Location } = api.core;
  const { registerQuest, startTranscript, refreshQuestList, questStartMessage } = require("../QuestRuntime");

  const TRUFITUS_NPC_ID = NpcIdentifiers.TRUFITUS; // 4625
  const PAGE = "Jungle Potion";

  const VARP_JUNGLE_POTION = 175;
  const STAGE_STARTED = 1;
  const STAGE_COMPLETE = 12;
  const STAGE_NEWS_TOLD = 13;

  const START_HOOK = "quest:jungle-potion:start";
  const COMPLETE_ACTION_ID = "WiofTb";
  /**
   * rsprox captures (JunglePotion ticks 158-160): the quest starts, with its start message, as the player continues
   * past this line of theirs, not when "Yes." is picked.
   */
  const START_LINE = "It sounds like just the challenge for me.";
  /** His post-quest talk's last line; continuing it sets varp 175 12 -> 13 (JunglePotion tick 1131). */
  const NEWS_LINE = "You should deliver the good news to Bwana Timfraku";
  /** The completion's message box; continuing it completes the quest (JunglePotion ticks 1121-1122). */
  const LESSON_MESSAGE = "Trufitus shows you some techniques in Herblore.";
  /** villagers_visible (varp 533 bit 20): live sets it to 1 as the quest completes (JunglePotion tick 1122). */
  const VILLAGERS_VISIBLE_VARBIT = 887;
  /** The completion scroll's model (questscroll:quest_model, JunglePotion tick 1122). */
  const SCROLL_ITEM_ID = ItemIdentifiers.MARRENTILL;

  const POTHOLE_ENTRANCE_LOC_ID = ObjectIdentifiers.ROCKS_4; // 2584
  const POTHOLE_EXIT_LOC_ID = ObjectIdentifiers.HAND_HOLDS; // 2585
  const POTHOLE_INTERIOR = { x: 2830, y: 9520, z: 0 };
  const POTHOLE_EXTERIOR = { x: 2823, y: 3120, z: 0 };
  /** Transcript messages for the "enter the caves?" choice. */
  const ENTER_CAVE_MESSAGE_ID = "LP0T9g";
  /**
   * The Search Rocks variant's three messages (the find, "enter" and "stay"): message boxes, and the move into the
   * cave comes as the player continues past "You decide to enter the caves..." (JunglePotion ticks 942-951).
   */
  const CAVE_BOX_MESSAGE_IDS = new Set(["iUByGE", ENTER_CAVE_MESSAGE_ID, "2QAKDk"]);
  /** The hand holds out: this message box, then the move out as it is continued (JunglePotion ticks 1046-1050). */
  const CLIMB_OUT_MESSAGE = "You attempt to climb the rocks back out.";

  /** search_vine, played by both slow searches (rsprox captures). */
  const SEARCH_SOUND = 1957;
  /**
   * The marshy jungle vine (rsprox captures: rev 242 runs 1002225 and JunglePotion ticks 234-288, rsprox.net 1148 and
   * 1875): human_openingchest_mid and search_vine on each attempt and a roll 10 ticks later; a miss replays the
   * sound then and the next attempt starts a tick after; a find plays the sound too. Ours (fitted): the Wiki gives no
   * chance, and 27 finds took 30 rolls across those recordings, so 0.9.
   */
  const VINE_SEARCH = {
    startAnimation: 2094, rollTicks: 10, chance: 0.9, missSound: true, findSound: true, missAnimation: null,
    findAnimation: null, retryTicks: 1, freshStart: null,
  };
  /**
   * The fungus covered cavern wall (rsprox captures: JunglePotion ticks 970-1029, three finds, and 1002225 ticks
   * 7344-7361, one): human_pick_wall_start and search_vine as the search starts; each miss plays
   * human_pick_wall_middle and search_vine, and the find human_pick_wall_end with no sound. Ours (fitted): the eight
   * recorded rolls came 3 to 10 ticks apart (6.1 on average, moss giants hitting the player throughout), so a roll
   * every 6 ticks, the length of human_pick_wall_middle; 4 of the 8 found the herb, so 0.5. That finds the herb 12
   * ticks in on average, as the four recorded finds did (5, 13, 14 and 17 ticks after the last click).
   */
  const WALL_SEARCH = {
    startAnimation: 2096, rollTicks: 6, chance: 0.5, missSound: true, findSound: false, missAnimation: 2097,
    findAnimation: 2098, retryTicks: 0,
    // A search started with none running: the animation reset (-1) and search_vine twice, in all four recordings
    // (JunglePotion ticks 973, 989, 1006; 1002225 tick 7347). A re-click mid-search plays 2096 and one (977, 1012).
    freshStart: { animation: -1, sounds: 2 },
  };

  const HERBS = [
    {
      name: "Snake weed",
      grimy: ItemIdentifiers.GRIMY_SNAKE_WEED,
      clean: ItemIdentifiers.SNAKE_WEED,
      locId: ObjectIdentifiers.MARSHY_JUNGLE_VINE,
      emptyLocId: ObjectIdentifiers.MARSHY_JUNGLE_VINE_2,
      searchMessage: "You search the vine...",
      search: VINE_SEARCH,
      requestedStage: 1,
      foundStage: 2,
      nextStage: 3,
      talkVariant: "snake-weed-talking-to-trufitus",
      handInStepId: "Z2U1Sk",
    },
    {
      name: "Ardrigal",
      grimy: ItemIdentifiers.GRIMY_ARDRIGAL,
      clean: ItemIdentifiers.ARDRIGAL,
      locId: ObjectIdentifiers.PALM_TREE_2,
      emptyLocId: ObjectIdentifiers.PALM_TREE_3,
      searchMessage: "You search the palm...",
      requestedStage: 3,
      foundStage: 4,
      nextStage: 5,
      talkVariant: "ardrigal-talking-to-trufitus",
      handInStepId: "1TUBY2",
    },
    {
      name: "Sito foil",
      grimy: ItemIdentifiers.GRIMY_SITO_FOIL,
      clean: ItemIdentifiers.SITO_FOIL,
      locId: ObjectIdentifiers.SCORCHED_EARTH,
      emptyLocId: ObjectIdentifiers.SCORCHED_EARTH_2,
      searchMessage: "You search the scorched earth...",
      requestedStage: 5,
      foundStage: 6,
      nextStage: 7,
      talkVariant: "sito-foil-talking-to-trufitus",
      handInStepId: "4Qi9K-",
    },
    {
      name: "Volencia moss",
      grimy: ItemIdentifiers.GRIMY_VOLENCIA_MOSS,
      clean: ItemIdentifiers.VOLENCIA_MOSS,
      locId: ObjectIdentifiers.ROCK_3,
      emptyLocId: ObjectIdentifiers.ROCK_4,
      searchMessage: "You search the rock...",
      requestedStage: 7,
      foundStage: 8,
      nextStage: 9,
      talkVariant: "volencia-moss-talking-to-trufitus",
      handInStepId: "l4gnZZ",
    },
    {
      name: "Rogue's purse",
      grimy: ItemIdentifiers.GRIMY_ROGUES_PURSE,
      clean: ItemIdentifiers.ROGUES_PURSE,
      locId: ObjectIdentifiers.FUNGUS_COVERED_CAVERN_WALL,
      emptyLocId: ObjectIdentifiers.FUNGUS_PATTERN,
      searchMessage: "You search the wall...",
      search: WALL_SEARCH,
      requestedStage: 9,
      foundStage: 10,
      nextStage: 11,
      talkVariant: "rogue-s-purse-talking-to-trufitus",
      handInStepId: "3UOzJ-",
    },
  ];

  const LOC_TO_HERB = new Map(HERBS.map((herb) => [herb.locId, herb]));
  const HAND_IN_STEPS = new Map(HERBS.map((herb) => [herb.handInStepId, herb]));
  const GRIMY_TO_CLEAN = new Map(HERBS.map((herb) => [herb.grimy, herb]));
  /**
   * rsprox captures: an emptied herb loc grows back 99 ticks later (snake vines in rsprox.net 1148 and 1875,
   * six vines; scorched earth in 3030). Ours: the palm, rock and fungus wall use the same, none was seen regrowing.
   */
  const HERB_REGROW_TICKS = 99;
  /** A player's running vine or wall search. */
  const searchSessions = new Map();
  /** Every jungle herb cleans at level 3 for 2.5 XP (OSRS Wiki: Snake weed, Ardrigal, Sito foil, Volencia moss, Rogue's purse). */
  const CLEAN_LEVEL = 3;
  const CLEAN_XP = 2.5;
  /** The Herblore plugin's four herb cleaning sounds (Cleaning.Herblore.js). */
  const CLEAN_SOUNDS = [3920, 3921, 3922, 3923];

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
    if (stage === 11) {
      lines.push("I should speak to <col=800000>Trufitus</col> to finish the potion.");
    }
    if (stage >= STAGE_COMPLETE) lines.push("", "<col=ff0000>QUEST COMPLETE!</col>");
    return lines;
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.HERBLORE, 775);
    player.getPacketSender().sendVarbit(VILLAGERS_VISIBLE_VARBIT, 1);
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
    // Stage 11 is the helper's finish step: the fifth herb was already handed
    // in, so replay the hand-in branch's completion tail instead of denying it.
    if (quest.getStage(player) === 11 && value.includes("rogue's purse")) {
      return !value.includes("no rogue's purse") && !value.includes("grimy");
    }
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

  function druidicRitualComplete(player) {
    const request = { player, key: "druidic_ritual", complete: undefined };
    api.emitCustomEvent("quest:is-complete", request);
    return request.complete === true;
  }

  /** "Yes." checks Druidic Ritual; the quest itself starts on the next line (handleLine). */
  function handleStartHook(event) {
    const { player, npcId, hook } = event;
    if (npcId !== TRUFITUS_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_STARTED && !druidicRitualComplete(player)) {
      event.end = true;
      player.sendMessage("You must complete Druidic Ritual to start this quest.");
    }
  }

  /** The chosen "player has the clean herb" branch consumes it and advances. */
  function handleCondition({ player, npcId, stepId }) {
    if (npcId !== TRUFITUS_NPC_ID) return;
    const herb = HAND_IN_STEPS.get(stepId);
    if (!herb || !held(player, herb.clean)) return;
    // A replay after the hand-in must not consume another herb or rewind progress.
    if (quest.getStage(player) >= herb.nextStage) return;
    player.getInventory().deleteNumber(herb.clean, 1);
    quest.setStage(player, herb.nextStage);
  }

  /** The transcript's completion action on the last hand-in. */
  function handleAction({ player, npcId, stepId }) {
    if (npcId !== TRUFITUS_NPC_ID || stepId !== COMPLETE_ACTION_ID) return;
    if (quest.getStage(player) >= 11 && !quest.isComplete(player)) quest.complete(player);
  }

  /**
   * Search a herb location. rsprox captures (local JunglePotion rev 242; rsprox.net 1148, 1875, 3030): the
   * "You search the <loc>..." spam line, then "You find a herb." in an objectbox showing the grimy herb, and the
   * loc becomes its empty variant for everyone until it grows back 99 ticks later. The palm, scorched earth and
   * rock find it at once; the vine and the fungus wall search for a while (VINE_SEARCH, WALL_SEARCH).
   */
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
      const restarted = searchSessions.has(event.player);
      stopSearching(event.player);
      event.player.getPacketSender().sendTypedMessage(api.core.ChatType.SPAM, herb.searchMessage);
      if (!herb.search) {
        findHerb(event.player, herb, event.object);
        return;
      }
      startSlowSearch(event.player, herb, event.object, restarted);
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
      climbOut(event.player);
    }
  }

  /**
   * The hand holds: the message box, then out of the cave the tick after it is continued (JunglePotion: continued
   * at 1049, moved at 1050).
   */
  function climbOut(player) {
    const { DialogueChainBuilder, StatementDialogue, ActionDialogue, Task } = api.core;
    player.getDialogueManager().startDialogues(
      new DialogueChainBuilder()
        .add(new StatementDialogue(0, CLIMB_OUT_MESSAGE))
        .add(new ActionDialogue(1, { execute: () => {
          player.getPacketSender().sendInterfaceRemoval();
          api.getTaskManager().submit(new (class extends Task {
            constructor() {
              super(1, player);
            }
            execute() {
              this.stop();
              if (player.isRegistered?.() === false) return;
              player.moveTo(new Location(POTHOLE_EXTERIOR.x, POTHOLE_EXTERIOR.y, POTHOLE_EXTERIOR.z));
            }
          })());
        } }))
    );
  }

  /**
   * A slow search (the vine and the fungus wall, `herb.search`): its start animation and search_vine, then a roll
   * every `rollTicks`. A find plays the find animation (and sound), hands over the herb and empties the loc. A miss
   * plays the miss sound (and animation); the vine then starts a new attempt `retryTicks` later, the wall rolls again
   * `rollTicks` on. Moving or teleporting off the tile, an item action or Attack click (player:interaction-cleared),
   * logging out or the loc going away ends it.
   */
  function startSlowSearch(player, herb, object, restarted = false) {
    const { search } = herb;
    const session = { herb, object, task: null, from: player.getLocation().clone() };
    const play = (animation, sound) => {
      if (animation !== null) player.performAnimation(new api.core.Animation(animation));
      if (sound) player.getPacketSender().sendSound(SEARCH_SOUND, 1, 0);
    };
    let wait = search.rollTicks;
    session.task = new (class extends api.core.Task {
      constructor() {
        super(1, player);
      }
      execute() {
        if (searchSessions.get(player) !== session) {
          this.stop();
          return;
        }
        if (!stillSearching(player, session)) {
          stopSearching(player);
          return;
        }
        if (--wait > 0) return;
        if (wait === 0) {
          if (Math.random() < search.chance) {
            this.stop();
            searchSessions.delete(player);
            if (player.getInventory().isFull()) {
              player.sendMessage("You find a herb, but you have no room to store it.");
              return;
            }
            play(search.findAnimation, search.findSound);
            findHerb(player, herb, object);
            return;
          }
          if (search.retryTicks > 0) {
            play(null, search.missSound);
            return;
          }
          play(search.missAnimation, search.missSound);
          wait = search.rollTicks;
          return;
        }
        if (wait > -search.retryTicks) return;
        play(search.startAnimation, true);
        wait = search.rollTicks;
      }
    })();
    searchSessions.set(player, session);
    if (search.freshStart && !restarted) {
      play(search.freshStart.animation, true);
      for (let i = 1; i < search.freshStart.sounds; i++) play(null, true);
    } else {
      play(search.startAnimation, true);
    }
    api.getTaskManager().submit(session.task);
  }

  function stillSearching(player, session) {
    if (!player.isRegistered?.()) return false;
    if (player.getMovementQueue?.()?.size?.() > 0) return false;
    // A teleport leaves the walk queue empty: the search needs the tile it started on, as DairyCow's does.
    if (!player.getLocation().equals(session.from)) return false;
    return herbLocStands(session.object);
  }

  function stopSearching(player) {
    const session = searchSessions.get(player);
    if (!session) return;
    searchSessions.delete(player);
    session.task?.stop();
  }

  /** The loc searched is still the full one (another player may have emptied it). */
  function herbLocStands(object) {
    if (!object?.getLocation) return true;
    const { MapObjects } = api.core;
    return MapObjects.get(object.getId(), object.getLocation(), object.getPrivateArea?.()) === object;
  }

  /** Hand over the grimy herb with the objectbox, advance the quest and empty the loc for 99 ticks. */
  function findHerb(player, herb, object) {
    if (!herbLocStands(object)) return;
    player.getInventory().adds(herb.grimy, 1);
    if (quest.getStage(player) === herb.requestedStage) quest.setStage(player, herb.foundStage);
    const { DialogueChainBuilder, ItemStatementDialogue } = api.core;
    player.getDialogueManager().startDialogues(
      new DialogueChainBuilder().add(new ItemStatementDialogue(0, herb.grimy, "You find a herb."))
    );
    emptyHerbLoc(herb, object);
  }

  function emptyHerbLoc(herb, object) {
    if (!object?.getLocation) return;
    const { GameObject, ObjectManager } = api.core;
    const empty = new GameObject(
      herb.emptyLocId,
      object.getLocation().clone(),
      object.getType(),
      object.getFace(),
      object.getPrivateArea?.() ?? null
    );
    ObjectManager.deregister(object, true);
    ObjectManager.register(empty, true);
    api.getTaskManager().submit(new (class extends api.core.Task {
      constructor() {
        super(HERB_REGROW_TICKS, empty);
      }
      execute() {
        this.stop();
        const { MapObjects } = api.core;
        if (MapObjects.get(empty.getId(), empty.getLocation(), empty.getPrivateArea?.()) === empty) {
          ObjectManager.deregister(empty, true);
        }
        ObjectManager.register(object, true);
      }
    })());
  }

  /**
   * The transcript's message steps live shows as boxes: each hand-in with its clean herb, the Herblore lesson and
   * the Search Rocks lines (rsprox captures, JunglePotion ticks 327, 460, 747, 857, 942-951, 1118-1122). Continuing
   * "You decide to enter the caves..." moves the player into the cave.
   */
  function handleMessageAction(event) {
    if (event.npcId !== TRUFITUS_NPC_ID || event.kind !== "message") return;
    const text = String(event.text ?? "");
    if (CAVE_BOX_MESSAGE_IDS.has(event.stepId)) {
      event.box = { statement: true };
      if (event.stepId === ENTER_CAVE_MESSAGE_ID) {
        event.after = () => event.player.moveTo(new Location(POTHOLE_INTERIOR.x, POTHOLE_INTERIOR.y, POTHOLE_INTERIOR.z));
      }
      return;
    }
    if (text.startsWith(LESSON_MESSAGE)) {
      event.box = { statement: true };
      return;
    }
    const handedIn = text.startsWith("You give the ")
      ? HERBS.find((herb) => text.toLowerCase().includes(herb.name.toLowerCase()))
      : null;
    if (handedIn) event.box = { items: [handedIn.clean] };
  }

  /**
   * The start as the player continues past "It sounds like just the challenge for me..." (the start hook only
   * checks Druidic Ritual), and varp 175 12 -> 13 as they continue past Trufitus's post-quest "deliver the good
   * news" line (rsprox captures, JunglePotion ticks 158-160 and 1131).
   */
  function handleLine(event) {
    if (event.npcId !== TRUFITUS_NPC_ID) return;
    const { player } = event;
    const text = String(event.text ?? "");
    if (text.startsWith(START_LINE)) {
      event.after = () => startQuest(player);
      return;
    }
    if (text.startsWith(NEWS_LINE)) {
      event.after = () => {
        if (quest.getStage(player) === STAGE_COMPLETE) quest.setStage(player, STAGE_NEWS_TOLD);
      };
    }
  }

  function startQuest(player) {
    if (quest.getStage(player) >= STAGE_STARTED || !druidicRitualComplete(player)) return;
    quest.setStage(player, STAGE_STARTED);
    player.sendMessage(questStartMessage(player, quest.name));
  }

  /** villagers_visible goes to 1 as the quest completes, and stays (JunglePotion tick 1122). */
  function sendVillagersVisible(player) {
    player.getPacketSender().sendVarbit(VILLAGERS_VISIBLE_VARBIT, quest.isComplete(player) ? 1 : 0);
  }

  /**
   * Cleaning a grimy jungle herb (the Herblore plugin does not list these), as the Herblore plugin cleans a herb.
   * rsprox_transcripts/227/01875.txt: Clean on grimy snake weed in slot 9 -> "You clean the Grimy snake weed."
   * (spam), snake weed in slot 9, and one of the cleaning sounds (3920-3922 there).
   */
  function handleItemAction(event) {
    const herb = GRIMY_TO_CLEAN.get(event.itemId);
    if (!herb) return;
    if (event.option && !/clean/i.test(event.option)) return;
    event.handled = true;
    const { player } = event;
    const inventory = player.getInventory();
    if (inventory.getItems()[event.slot]?.getId() !== event.itemId) return;
    const grimyName = api.core.ItemDefinition.forId(event.itemId).getName();
    if (herbloreLevel(player) < CLEAN_LEVEL) {
      player.sendMessage(`You need level ${CLEAN_LEVEL} Herblore to clean the ${grimyName}.`);
      return;
    }
    // As Cleaning.Herblore.js: content may clean every herb of the kind in one click.
    const slots = [event.slot, ...inventory.getItems()
      .map((item, index) => (index !== event.slot && item?.getId() === event.itemId ? index : -1))
      .filter((index) => index >= 0)];
    for (const at of slots.slice(0, cleanActionsPerCycle(player))) {
      inventory.setItem(at, new api.core.Item(herb.clean, 1));
      player.getSkillManager().addExperiences(Skill.HERBLORE, CLEAN_XP);
      api.emitCustomEvent("skills:produced", { player, skill: Skill.HERBLORE, itemId: herb.clean, amount: 1, xp: CLEAN_XP, kind: "clean" });
    }
    inventory.refreshItems();
    player.getPacketSender().sendSound(CLEAN_SOUNDS[Math.floor(Math.random() * CLEAN_SOUNDS.length)], 1, 0);
    player.getPacketSender().sendTypedMessage(api.core.ChatType.SPAM, `You clean the ${grimyName}.`);
  }

  /** The Herblore level cleaning checks, raised by content as the Herblore plugin's is ("skills:level-boost"). */
  function herbloreLevel(player) {
    const request = { player, skill: Skill.HERBLORE, boost: 0 };
    api.emitCustomEvent("skills:level-boost", request);
    return player.getSkillManager().getCurrentLevel(Skill.HERBLORE) + Math.max(0, request.boost | 0);
  }

  /** How many herbs one Clean cleans ("skills:actions-per-cycle"); 1 unless content says more. */
  function cleanActionsPerCycle(player) {
    const request = { player, skill: Skill.HERBLORE, kind: "clean", recipe: null, actions: 1 };
    api.emitCustomEvent("skills:actions-per-cycle", request);
    return Math.max(1, request.actions | 0);
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
    sendVillagersVisible(player);
  }

  function handleLogout({ player }) {
    if (player) stopSearching(player);
  }

  /** An inventory/equipment action or an Attack click replaces the search, as it does every repeating action. */
  function handleInteractionCleared({ player }) {
    if (player) stopSearching(player);
  }

  quest = registerQuest(api, {
    key: "jungle_potion",
    name: "Jungle Potion",
    varpId: VARP_JUNGLE_POTION,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.HERBLORE.getIndex(), amount: 775, label: "Herblore" }],
    scrollItemId: SCROLL_ITEM_ID,
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:condition", handleCondition);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:action", handleMessageAction);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onObjectInteraction(handleObjectInteraction);
  api.onItemAction(handleItemAction);
  api.onPlayerLogin(handleLogin);
  api.onPlayerLogout(handleLogout);
  api.onCustomEvent("player:interaction-cleared", handleInteractionCleared);
};
