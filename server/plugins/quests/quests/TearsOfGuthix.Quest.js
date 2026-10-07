/**
 * Tears of Guthix (members).
 *
 * Words come from the "Tears of Guthix" transcript page; this plugin supplies the
 * variant selector for Juna, the start hook, the prose-condition answers and the
 * magic-stone/stone-bowl crafting.
 *
 * Stages (varp 449, the storage behind varbit 451 "TOG_JUNA_BOWL"; confirmed
 * against the cache): 0 not started, 1 told Juna a story / make the bowl,
 * 2 complete. The minigame keeps its own varbits in the higher bits of 449.
 *
 * Flow: talk to Juna (43 Quest Points) -> the start hook sets stage 1 -> mine
 * Magical rocks (20 Mining, pickaxe) -> chisel the Magic stone into a Stone bowl
 * -> talk to Juna with the bowl ("returning-with-a-stone-bowl") -> the completion
 * action takes the bowl and completes (1 QP, 1000 Crafting XP, minigame access).
 *
 * The minigame after the quest (Juna's eligibility, the cave and the tears) is
 * plugins/minigames/TearsOfGuthix.plugin.js. This file routes Juna's loc to her
 * transcripts, keeps varbit 451 (her multiloc: "Story" appears once the quest is
 * done) in step with the stage, and plays the random story she is told, out of the
 * stories for quests the player has completed.
 *
 * Source: https://github.com/GregHib/void/blob/2b8e267836a8469757c73694ea4d57f2f1c28458/game/src/main/kotlin/content/area/misthalin/lumbridge/swamp/chams_of_tears/Juna.kt
 * (plus quest/member/tears_of_guthix/TearsOfGuthix.kt).
 *
 * Gaps (no dump/index support): the sapphire-lantern / light-creature travel to
 * the chasm; Temple of Ikov does not track the Lucien choice, so both Lucien
 * story conditions answer false.
 */
module.exports = function registerTearsOfGuthixQuest(api) {
  const { Skill, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest, refreshQuestList, startTranscript, getRegisteredQuests, loadTranscripts } = require("../QuestRuntime");
  const mining = require("../../skills/Mining.plugin.js");

  const JUNA_NPC_ID = NpcIdentifiers.JUNA;
  const PAGE = "Tears of Guthix";

  const VARP_TEARS_OF_GUTHIX = 449;
  const STAGE_NOT_STARTED = 0;
  const STAGE_STONE_BOWL = 1;
  const STAGE_COMPLETE = 2;

  const MIN_QUEST_POINTS = 43;
  const MIN_MINING_LEVEL = 20;

  const MAGIC_STONE_ITEM_ID = ItemIdentifiers.MAGIC_STONE;
  const STONE_BOWL_ITEM_ID = ItemIdentifiers.STONE_BOWL;
  const CHISEL_ITEM_ID = ItemIdentifiers.CHISEL;

  const MAGICAL_ROCK_IDS = new Set([
    ObjectIdentifiers.MAGICAL_ROCKS,
    ObjectIdentifiers.MAGICAL_ROCKS_2,
    ObjectIdentifiers.MAGICAL_ROCKS_3,
  ]);
  /** Juna is a loc; her name carries the cache's colour tags. */
  const JUNA_LOC_NAME = "<col=ffff00>Juna</col>";
  /** tog_juna_bowl: the quest stage as Juna's multiloc reads it (bits 0-1 of varp 449). */
  const JUNA_BOWL_VARBIT = 451;

  const START_HOOK = "quest:tears-of-guthix:start";
  const COMPLETE_ACTION_ID = "BitWHU";
  /** "(A random story is selected from below.)" in the quest, and Juna's own "List of stories". */
  const RANDOM_STORY_STEP_IDS = new Set(["s6cYli", "nBzoOC"]);
  /** Juna's "You tell Juna some stories of your adventures." box, which the export lost. */
  const TELL_STORIES_STEP_ID = "0upJBS";
  const TELL_STORIES_MESSAGE = "You tell Juna some stories of your adventures.";
  const RANDOM_STORIES_VARIANT = "starting-off-random-stories";

  const HAZEEL_SIDE_ATTRIBUTE = "quest.hazeel_cult.side";
  const SIDE_CARNILLEAN = 0;
  const SIDE_HAZEEL = 1;
  const HAZEEL_CULT_COMPLETE = 9;

  let quest;

  const attr = (player, key) => Number(player.getAttribute(key)) || 0;
  const has = (player, itemId) => player.getInventory().getAmount(itemId) > 0;

  function questPoints(player) {
    return Number(player.getAttribute("quest.points")) || 0;
  }

  /** Stage of another quest plugin, 0 when it has never run. */
  function otherQuestStage(player, key) {
    return Number(player.getAttribute(`quest.${key}.stage`)) || 0;
  }

  function hasBowl(player) {
    return has(player, STONE_BOWL_ITEM_ID);
  }

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I met Juna the serpent in a deep chasm beneath the</str>",
        "<str>Lumbridge Swamp Caves. I made a bowl out of magical stone in</str>",
        "<str>order to catch the Tears of Guthix.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
        "",
        "Now Juna will let me into the cave to collect the Tears if I",
        "tell her stories of my adventures.",
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
        otherQuestStage(player, "hazeel_cult") >= HAZEEL_CULT_COMPLETE &&
        attr(player, HAZEEL_SIDE_ATTRIBUTE) === SIDE_CARNILLEAN
      );
    }
    if (value.includes("helped the cultists")) {
      return (
        otherQuestStage(player, "hazeel_cult") >= HAZEEL_CULT_COMPLETE &&
        attr(player, HAZEEL_SIDE_ATTRIBUTE) === SIDE_HAZEEL
      );
    }
    if (value.includes("has not completed making friends with my arm")) {
      return otherQuestStage(player, "making_friends_with_my_arm") === 0;
    }
    if (value.includes("has finished making friends with my arm")) {
      return otherQuestStage(player, "making_friends_with_my_arm") > 0;
    }
    if (value.includes("has not finished dragon slayer ii")) {
      return otherQuestStage(player, "dragon_slayer_ii") === 0;
    }
    if (value.includes("has finished dragon slayer ii")) {
      return otherQuestStage(player, "dragon_slayer_ii") > 0;
    }
    if (value.includes("has not completed a kingdom divided")) {
      return otherQuestStage(player, "a_kingdom_divided") === 0;
    }
    if (value.includes("completed a kingdom divided")) {
      return otherQuestStage(player, "a_kingdom_divided") > 0;
    }
    // Temple of Ikov stores no side flag, so neither ending is claimed.
    if (value.includes("killed lucien") || value.includes("helped lucien")) return false;
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== JUNA_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) !== STAGE_NOT_STARTED) return;
    if (questPoints(player) < MIN_QUEST_POINTS) {
      player.sendMessage(`You need at least ${MIN_QUEST_POINTS} Quest Points to start this quest.`);
      return;
    }
    quest.setStage(player, STAGE_STONE_BOWL);
  }

  /** "Congratulations! Quest complete!" from the returning-with-a-stone-bowl variant. */
  function handleAction(event) {
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
    player.performAnimation(pickaxe.animation);
    player.getInventory().adds(MAGIC_STONE_ITEM_ID, 1);
    player.sendMessage("You manage to mine a piece of magic stone.");
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
    player.getInventory().deleteNumber(MAGIC_STONE_ITEM_ID, 1);
    player.getInventory().adds(STONE_BOWL_ITEM_ID, 1);
    player.sendMessage("You make a stone bowl.");
  }

  /** Using a magic stone on Juna has its own wiki variant. */
  function handleStoneOnJuna(event) {
    if (event.itemId !== MAGIC_STONE_ITEM_ID) return;
    const npcId = event.npcId ?? event.target?.getId?.();
    if (npcId !== JUNA_NPC_ID) return;
    event.handled = true;
    startTranscript(api, event.player, JUNA_NPC_ID, PAGE, "starting-off-using-the-magic-stone-on-juna");
  }

  /** Talk-to on Juna's loc plays her transcript; the variant selectors pick the page. */
  function talkToJuna({ player }) {
    api.emitCustomEvent("npc-dialogue:start", { player, npcId: JUNA_NPC_ID });
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
    if (!RANDOM_STORY_STEP_IDS.has(event.stepId)) return;
    const stories = loadTranscripts(api)?.[PAGE]?.variants?.[RANDOM_STORIES_VARIANT];
    event.steps = Array.isArray(stories) ? stories : [];
    event.handled = true;
  }

  function handleLogin({ player }) {
    syncJuna(player);
    refreshQuestList(player);
  }

  /** setStage writes the whole of varp 449; Juna's multiloc only needs its low bits. */
  function syncJuna(player) {
    player.getPacketSender().sendVarbit(JUNA_BOWL_VARBIT, quest.getStage(player));
  }

  quest = registerQuest(api, {
    key: "tears_of_guthix",
    name: "Tears of Guthix",
    varpId: VARP_TEARS_OF_GUTHIX,
    startedValue: STAGE_STONE_BOWL,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.CRAFTING.getIndex(), amount: 1000, label: "Crafting" }],
    scrollItemId: STONE_BOWL_ITEM_ID,
    otherRewards: ["Access to the Tears of Guthix"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onItemOnItem(handleChiselOnStone);
  api.onItemOnNpc(handleStoneOnJuna);
  api.onCustomEvent("npc-dialogue:action", handleStoryActions);
  api.onObjectInteraction(JUNA_LOC_NAME, { "Talk-to": talkToJuna });
  api.onObjectInteraction("Magical rocks", { Mine: mineMagicStone });
  api.onPlayerLogin(handleLogin);
};
