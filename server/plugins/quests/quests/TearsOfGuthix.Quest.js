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
 * The light-creature crossing and the south-shelf rock climb are handled here.
 * Gaps: the surface Dark hole's rope entry belongs to shared world travel; the
 * exact carry animation/landing is uncaptured. Temple of Ikov does not track the
 * Lucien choice, so both Lucien story conditions answer false.
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
 * - The pool between the ledges remains clipped. The Quest Helper lantern target
 *   is 3228,9518,2; the cache light creatures occupy 3224-3226,9516-9518. From
 *   the ledge at 3239,9525,2, item-on-NPC uses the quest-scoped eight-tile reach
 *   and projectile-clip exception to route to a valid shore tile without entering
 *   the pool. The lantern handler then carries the player across.
 * - Juna's platform is reached from the chasm ledge (3241,9525) by the shared
 *   "Rocks" 6673 climb, and the rock side is reached by the lantern crossing.
 */
module.exports = function registerTearsOfGuthixQuest(api) {
  const { Skill, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers, Location } = api.core;
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
  const LIGHT_CREATURE_NPC_ID = NpcIdentifiers.LIGHT_CREATURE_3; // 5784, the Chasm of Tears spawn
  /** Rocks 6672 on the south shelf climbs back to the light-creature shelf (Quest Helper route). */
  const TOG_ROCK_CLIMB_OBJECT_ID = ObjectIdentifiers.ROCKS_27;
  const ROCK_SIDE_LANDING = [3229, 9505, 2];
  const JUNA_SIDE_LANDING = [3241, 9525, 2];

  /** The cache ledge is eight tiles from the nearest 5784 spawn at the north edge. */
  const LIGHT_CREATURE_USE_RANGE = 8;
  const LIGHT_CREATURE_TILE_BOUNDS = { x0: 3224, x1: 3226, y0: 9516, y1: 9518, z: 2 };

  const START_HOOK = "quest:tears-of-guthix:start";
  const COMPLETE_ACTION_ID = "BitWHU";
  /** "(A random story is selected from below.)" in the quest, and Juna's own "List of stories". */
  const RANDOM_STORY_STEP_IDS = new Set(["s6cYli", "nBzoOC"]);
  /** Juna's "You tell Juna some stories of your adventures." box, which the export lost. */
  const TELL_STORIES_STEP_ID = "0upJBS";
  const TELL_STORIES_MESSAGE = "You tell Juna some stories of your adventures.";
  const RANDOM_STORIES_VARIANT = "starting-off-random-stories";

  const SIDE_CARNILLEAN = 0;
  const SIDE_HAZEEL = 1;

  let quest;

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
    if (player.getSkillManager().getCurrentLevel(Skill.CRAFTING) < MIN_CRAFTING_LEVEL) {
      player.sendMessage(`You need a Crafting level of at least ${MIN_CRAFTING_LEVEL} to make a stone bowl.`);
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

  /** The lit sapphire lantern attracts a Chasm light creature across to the magic rocks. */
  function handleLanternOnLightCreature(event) {
    if (event.itemId !== LIT_SAPPHIRE_LANTERN_ITEM_ID) return;
    const npcId = event.npcId ?? event.target?.getId?.();
    if (npcId !== LIGHT_CREATURE_NPC_ID || quest.getStage(event.player) !== STAGE_STONE_BOWL ||
      !isChasmLightCreature(event.target?.getLocation?.() ?? event.location)) return;
    event.handled = true;
    event.player.moveTo(new Location(...ROCK_SIDE_LANDING));
    event.player.sendMessage("The light creature carries you across the chasm.");
  }

  function isChasmLightCreature(location) {
    const x = location?.getX?.() ?? location?.x;
    const y = location?.getY?.() ?? location?.y;
    const z = location?.getZ?.() ?? location?.z;
    return Number(z) === LIGHT_CREATURE_TILE_BOUNDS.z &&
      Number(x) >= LIGHT_CREATURE_TILE_BOUNDS.x0 && Number(x) <= LIGHT_CREATURE_TILE_BOUNDS.x1 &&
      Number(y) >= LIGHT_CREATURE_TILE_BOUNDS.y0 && Number(y) <= LIGHT_CREATURE_TILE_BOUNDS.y1;
  }

  /** QH lantern use targets the creature from the chasm's walkable ledge. */
  function routeLanternToLightCreature(event) {
    if (event.clickType !== 0 || event.itemId !== LIT_SAPPHIRE_LANTERN_ITEM_ID ||
      event.npcId !== LIGHT_CREATURE_NPC_ID || quest.getStage(event.player) !== STAGE_STONE_BOWL ||
      !isChasmLightCreature(event.location)) return;
    event.range = LIGHT_CREATURE_USE_RANGE;
    event.ignoreProjectileClip = true;
  }

  /** The south-shelf rocks climb back to the ledge by Juna and the light creatures. */
  function climbTogRocks(event) {
    if (event.objectId !== TOG_ROCK_CLIMB_OBJECT_ID) return;
    // The packet listener lower-cases the option before dispatching it, so the
    // canonical option is compared case-insensitively.
    const option = String(
      event.option || event.definition?.getInteractions()?.[event.clickType - 1] || ""
    ).toLowerCase();
    if (option !== "climb") return;
    event.handled = true;
    event.player.moveTo(new Location(...JUNA_SIDE_LANDING));
  }

  /**
   * Talk-to on Juna's loc plays her transcript; the variant selectors pick the
   * page. Juna refuses a player without 43 Quest Points, and the generated page
   * has no refusal variant, so the refusal is a system line and her acceptance
   * lines stay unplayed for someone who cannot start the quest.
   */
  function talkToJuna({ player }) {
    if (quest.getStage(player) === STAGE_NOT_STARTED && questPoints(player) < MIN_QUEST_POINTS) {
      player.sendMessage(`You need at least ${MIN_QUEST_POINTS} Quest Points to start this quest.`);
      return;
    }
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
    refreshQuestList(player);
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
  api.onNpcRoute(routeLanternToLightCreature);
  api.onObjectInteraction(climbTogRocks);
  api.onCustomEvent("npc-dialogue:action", handleStoryActions);
  api.onObjectInteraction(JUNA_LOC_NAME, { "Talk-to": talkToJuna });
  api.onObjectInteraction("Magical rocks", { Mine: mineMagicStone });
  api.onPlayerLogin(handleLogin);
};
