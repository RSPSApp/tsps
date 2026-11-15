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
 * The quest-side light-creature crossing and south-shelf rock climb are handled here.
 * The minigame plugin supplies the cave, eligibility, timer, bowl and tear streams.
 * Gaps: the surface Dark hole's rope entry belongs to shared world travel. The
 * recordings pin the message, 2046/2047, the landings and the timing (float-up
 * seven ticks after the answer, float-down 28 ticks later). Temple of Ikov does
 * not track the Lucien choice, so both Lucien story conditions answer false.
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
 *   is 3228,9518,2; the cache light creatures (id 5435, the only light creature
 *   spawned in the chasm) occupy 3224-3226,9516-9518. Their only cache option is
 *   Attract, so both that option and using the lit lantern on them use the
 *   quest-scoped eight-tile reach and projectile-clip exception to route to a
 *   valid shore tile without entering the pool. The handler sends the recorded
 *   attract line, waits seven ticks for the creature, floats the player up
 *   (2046), glides them over the chasm (2048) and lands on the far side
 *   (3224,9504 from the north; 3224,9530 from the south) with float-down (2047)
 *   28 ticks after the float-up.
 * - The chasm's rocks (6672 on the south shelf, 6673 by the north ledge) move
 *   the player to the tile beyond the rock (rock x ± 1), not a teleport between
 *   the ledges.
 */
module.exports = function registerTearsOfGuthixQuest(api) {
  const { Animation, ForceMovement, ForceMovementTask, Skill, ItemIdentifiers, NpcIdentifiers,
    ObjectIdentifiers, Location, Task, TaskManager } = api.core;
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
  const LIGHT_CREATURE_NPC_ID = NpcIdentifiers.LIGHT_CREATURE_4; // 5435, the Chasm of Tears spawn
  /** The two chasm slopes: 6672 on the south shelf, 6673 by the north ledge. */
  const CHASM_ROCK_IDS = new Set([ObjectIdentifiers.ROCKS_27, ObjectIdentifiers.ROCKS_28]);
  /** Recorded landings: the magical-rock shelf, and the north edge by the creature spawns. */
  const ROCK_SIDE_LANDING = [3224, 9504, 2];
  const JUNA_SIDE_LANDING = [3224, 9530, 2];

  /** The cache ledge is eight tiles from the nearest 5435 spawn at the north edge. */
  const LIGHT_CREATURE_USE_RANGE = 8;
  const LIGHT_CREATURE_TILE_BOUNDS = { x0: 3224, x1: 3226, y0: 9516, y1: 9518, z: 2 };
  /** South of this y is the magical-rock shelf; north of it is the Juna-side ledge. */
  const CHASM_MIDDLE_Y = 9515;
  /**
   * rsprox 242/911949: the creature answers at tick 19492, float-up (2046) is seven ticks later,
   * the player glides across one tile per tick and float-down (2047) lands 28 ticks after the
   * float-up. `tog_player_float_across` (2048) covers the glide.
   */
  const TOG_FLOAT_DELAY_TICKS = 7;
  const TOG_FLOAT_UP_ANIMATION = 2046;
  const TOG_FLOAT_ACROSS_ANIMATION = 2048;
  const TOG_FLOAT_DOWN_ANIMATION = 2047;
  const TOG_FLOAT_TICKS = 28;
  const ATTRACT_MESSAGE = "The light creature is attracted to your beam and comes towards you...";
  const NO_LANTERN_MESSAGE = "You don't have anything to attract the light creature with.";

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

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== JUNA_NPC_ID || hook !== START_HOOK) return;
    if (quest.getStage(player) !== STAGE_NOT_STARTED) return;
    if (questPoints(player) < MIN_QUEST_POINTS) {
      player.sendMessage(`You need at least ${MIN_QUEST_POINTS} Quest Points to start this quest.`);
      return;
    }
    if (missingStartSkillRequirements(player).length > 0) {
      notifyStartSkillRequirements(player);
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

  /** The lit sapphire lantern attracts a Chasm light creature across to the far side. */
  function crossChasm(player, npcLocation) {
    if (quest.getStage(player) !== STAGE_STONE_BOWL || !isChasmLightCreature(npcLocation)) return false;
    if (!has(player, LIT_SAPPHIRE_LANTERN_ITEM_ID)) {
      player.sendMessage(NO_LANTERN_MESSAGE);
      return true;
    }
    const southSide = player.getLocation().getY() <= CHASM_MIDDLE_Y;
    const destination = southSide ? JUNA_SIDE_LANDING : ROCK_SIDE_LANDING;
    const start = player.getLocation().clone();
    player.sendMessage(ATTRACT_MESSAGE);
    // The creature approaches for seven ticks, then the player floats up and glides across;
    // a player who walked away before the float is left alone.
    TaskManager.submit(new (class extends Task {
      constructor() { super(TOG_FLOAT_DELAY_TICKS, player, false); }
      execute() {
        this.stop();
        if (!player.getLocation().equals(start)) return;
        player.performAnimation(new Animation(TOG_FLOAT_UP_ANIMATION));
        const from = player.getLocation().clone();
        const dx = destination[0] - from.getX();
        const dy = destination[1] - from.getY();
        const direction = Math.abs(dx) > Math.abs(dy) ? dx > 0 ? 1 : 3 : dy > 0 ? 0 : 2;
        TaskManager.submit(new ForceMovementTask(player, TOG_FLOAT_TICKS,
          new ForceMovement(from, new Location(dx, dy), 0, TOG_FLOAT_TICKS * 30, direction,
            TOG_FLOAT_ACROSS_ANIMATION)));
        TaskManager.submit(new (class extends Task {
          constructor() { super(TOG_FLOAT_TICKS, player, false); }
          execute() {
            this.stop();
            player.performAnimation(new Animation(TOG_FLOAT_DOWN_ANIMATION));
          }
        })());
      }
    })());
    return true;
  }

  /** The cache's only light-creature option is Attract; it does what the lantern use does. */
  function attractLightCreature(event) {
    const { player, npc } = event;
    if ((event.npcId ?? npc?.getId?.()) !== LIGHT_CREATURE_NPC_ID) return false;
    const handled = crossChasm(player, npc?.getLocation?.() ?? event.location);
    if (handled) event.handled = true;
    return handled;
  }

  /** The lit sapphire lantern, used on a Chasm light creature. */
  function handleLanternOnLightCreature(event) {
    if (event.itemId !== LIT_SAPPHIRE_LANTERN_ITEM_ID) return;
    const npcId = event.npcId ?? event.target?.getId?.();
    if (npcId !== LIGHT_CREATURE_NPC_ID) return;
    event.handled = crossChasm(event.player, event.target?.getLocation?.() ?? event.location);
  }

  function isChasmLightCreature(location) {
    const x = location?.getX?.() ?? location?.x;
    const y = location?.getY?.() ?? location?.y;
    const z = location?.getZ?.() ?? location?.z;
    return Number(z) === LIGHT_CREATURE_TILE_BOUNDS.z &&
      Number(x) >= LIGHT_CREATURE_TILE_BOUNDS.x0 && Number(x) <= LIGHT_CREATURE_TILE_BOUNDS.x1 &&
      Number(y) >= LIGHT_CREATURE_TILE_BOUNDS.y0 && Number(y) <= LIGHT_CREATURE_TILE_BOUNDS.y1;
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
    const playerX = event.player.getLocation().getX();
    event.handled = true;
    event.player.moveTo(new Location(rockX + (playerX < rockX ? 1 : -1), rockY, rockZ));
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
  api.onNpcInteraction("Light creature", { Attract: attractLightCreature });
  api.onNpcRoute(routeLanternToLightCreature);
  api.onObjectInteraction(climbTogRocks);
  api.onCustomEvent("npc-dialogue:action", handleStoryActions);
  api.onObjectInteraction(JUNA_LOC_NAME, { "Talk-to": talkToJuna });
  api.onObjectInteraction("Magical rocks", { Mine: mineMagicStone });
  api.onPlayerLogin(handleLogin);
};
