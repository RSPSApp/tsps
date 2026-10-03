/**
 * Tears of Guthix (members).
 *
 * Words come from the "Tears of Guthix" transcript page; this plugin supplies the
 * variant selector for Juna, the start hook, the prose-condition answers, the
 * magic-stone/stone-bowl crafting and the tear-collection reward.
 *
 * Stages (varp 449, the storage behind varbit 451 "TOG_JUNA_BOWL"; confirmed
 * against the cache): 0 not started, 1 told Juna a story / make the bowl,
 * 2 complete. 449 is the real OSRS varp and is unused elsewhere in the repo.
 *
 * Flow: talk to Juna (43 Quest Points) -> the start hook sets stage 1 -> mine
 * Magical rocks (20 Mining, pickaxe) -> chisel the Magic stone into a Stone bowl
 * -> talk to Juna with the bowl ("returning-with-a-stone-bowl") -> the completion
 * action takes the bowl and completes (1 QP, 1000 Crafting XP, minigame access).
 *
 * Post-quest activity: "Collect-from" the Weeping wall, or use the bowl on the
 * blue/green tear objects, to bank tears; leaving the chasm (tunnels / climb
 * rocks) or logging out converts them into XP in the player's lowest skill at the
 * reference's rate (10 + floor(lowestXp / 270) / 10, capped at 60 per tear).
 *
 * Source: https://github.com/GregHib/void/blob/2b8e267836a8469757c73694ea4d57f2f1c28458/game/src/main/kotlin/content/area/misthalin/lumbridge/swamp/chams_of_tears/Juna.kt
 * (plus LightCreature.kt, WeepingWall.kt and quest/member/tears_of_guthix/TearsOfGuthix.kt).
 *
 * Gaps (no dump/index support): the sapphire-lantern / light-creature travel to
 * the chasm and the water-bowl minigame interface + timer are not reproduced
 * (collection is a plain accumulate-then-settle); the reminder toggle is not
 * modelled; the tear streams do not drift, a wall click
 * always yields a blue tear and green only drains through the bowl on a green
 * tears object; Temple of Ikov does not track the Lucien choice, so both Lucien
 * story conditions answer false; Juna's post-quest minigame words are not on the
 * transcript page, so the default "starting-off" variant plays.
 *
 * A game (https://oldschool.runescape.wiki/w/Tears_of_Guthix_(minigame)) starts with
 * the first tear caught: once every seven days, and only after a quest point or
 * 100,000 total XP since the last game (the first game is free). It lasts one tick
 * per quest point; the refusal messages are not on the Wiki and are ours.
 */
module.exports = function registerTearsOfGuthixQuest(api) {
  const { Skill, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest, refreshQuestList, startTranscript } = require("../QuestRuntime");
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
  const BLUE_TEAR_IDS = new Set([
    ObjectIdentifiers.BLUE_TEARS,
    ObjectIdentifiers.BLUE_TEARS_2,
  ]);
  const GREEN_TEAR_IDS = new Set([
    ObjectIdentifiers.GREEN_TEARS,
    ObjectIdentifiers.GREEN_TEARS_2,
  ]);
  const CHASM_EXIT_IDS = new Set([
    ObjectIdentifiers.TUNNEL_12,
    ObjectIdentifiers.TUNNEL_13,
    ObjectIdentifiers.ROCKS_27,
    ObjectIdentifiers.ROCKS_28,
  ]);

  const START_HOOK = "quest:tears-of-guthix:start";
  const COMPLETE_ACTION_ID = "BitWHU";
  const TEARS_ATTRIBUTE = "quest.tears_of_guthix.tears";
  /** { at, questPoints, totalXp } of the last game. */
  const LAST_GAME_ATTRIBUTE = "quest.tears_of_guthix.last_game";
  /** When the current game's time runs out (ms); not saved. */
  const GAME_ENDS_ATTRIBUTE = "quest.tears_of_guthix.game_ends";
  const GAME_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
  const GAME_XP_SINCE_LAST = 100000;
  const TICK_MS = 600;

  const HAZEEL_SIDE_ATTRIBUTE = "quest.hazeel_cult.side";
  const SIDE_CARNILLEAN = 0;
  const SIDE_HAZEEL = 1;
  const HAZEEL_CULT_COMPLETE = 9;
  const DRUIDIC_RITUAL_COMPLETE = 4;
  const RUNE_MYSTERIES_COMPLETE = 6;

  /** The reference's per-skill "lowest skill" lines (tears_of_guthix_messages table). */
  const TEAR_MESSAGES = new Map([
    [Skill.ATTACK.getIndex(), "You feel a brief surge of aggression!"],
    [Skill.DEFENCE.getIndex(), "You feel very defensive!"],
    [Skill.STRENGTH.getIndex(), "Your muscles bulge!"],
    [Skill.HITPOINTS.getIndex(), "You feel more healthy."],
    [Skill.RANGED.getIndex(), "Your aim improves."],
    [Skill.PRAYER.getIndex(), "You suddenly feel very close to the gods."],
    [Skill.MAGIC.getIndex(), "You feel magical power coursing through your body."],
    [Skill.COOKING.getIndex(), "You have a brief urge to cook some food."],
    [Skill.WOODCUTTING.getIndex(), "You gain a deep understanding of the trees in the forest."],
    [Skill.FLETCHING.getIndex(), "You gain a deep understanding of wooden sticks."],
    [Skill.FISHING.getIndex(), "You gain a deep understanding of the creatures of the sea."],
    [Skill.FIREMAKING.getIndex(), "You have a brief urge to set light to something!"],
    [Skill.CRAFTING.getIndex(), "Your fingers feel nimble and suited to delicate work."],
    [Skill.SMITHING.getIndex(), "You gain a deep understanding of metal."],
    [Skill.MINING.getIndex(), "You gain a deep understanding of the stones of the earth."],
    [Skill.HERBLORE.getIndex(), "You gain a deep understanding of all kinds of strange plants."],
    [Skill.AGILITY.getIndex(), "You feel very nimble."],
    [Skill.THIEVING.getIndex(), "You feel your respect for others' property slipping away."],
    [Skill.SLAYER.getIndex(), "You gain a deep understanding of many strange creatures."],
    [Skill.FARMING.getIndex(), "You gain a deep understanding of the cycles of nature."],
    [Skill.RUNECRAFTING.getIndex(), "You gain a deep understanding of runes."],
    [Skill.CONSTRUCTION.getIndex(), "You feel homesick."],
    [Skill.HUNTER.getIndex(), "You briefly experience the joy of the hunt."],
  ]);

  let quest;

  const attr = (player, key) => Number(player.getAttribute(key)) || 0;
  const setAttr = (player, key, value) => player.setAttribute(key, value | 0);
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

  /** Starts a game if none is running; false (with a message) when Juna won't allow one. */
  function inGame(player) {
    const endsAt = Number(player.getAttribute(GAME_ENDS_ATTRIBUTE)) || 0;
    if (endsAt > Date.now()) return true;
    if (endsAt > 0) {
      endGame(player);
      return false;
    }
    const last = player.getAttribute(LAST_GAME_ATTRIBUTE);
    const totalXp = player.getSkillManager().getTotalExp();
    if (last && typeof last === "object") {
      const waitMs = (Number(last.at) || 0) + GAME_COOLDOWN_MS - Date.now();
      if (waitMs > 0) {
        const days = Math.ceil(waitMs / (24 * 60 * 60 * 1000));
        player.sendMessage(`You must wait ${days} more day${days === 1 ? "" : "s"} before you can collect the tears again.`);
        return false;
      }
      if (questPoints(player) <= (Number(last.questPoints) || 0) && totalXp - (Number(last.totalXp) || 0) < GAME_XP_SINCE_LAST) {
        player.sendMessage("You need another quest point or 100,000 more experience before you can collect the tears again.");
        return false;
      }
    }
    player.setAttribute(LAST_GAME_ATTRIBUTE, { at: Date.now(), questPoints: questPoints(player), totalXp });
    player.setAttribute(GAME_ENDS_ATTRIBUTE, Date.now() + questPoints(player) * TICK_MS);
    return true;
  }

  function endGame(player) {
    player.sendMessage("Your time in the cave is up.");
    settleTears(player);
  }

  function addTears(player, amount) {
    setAttr(player, TEARS_ATTRIBUTE, Math.max(0, attr(player, TEARS_ATTRIBUTE) + amount));
  }

  /** "Collect-from" on the weeping wall: a blue stream banks a tear. */
  function collectTearFromWall(event) {
    const { player } = event;
    event.handled = true;
    if (!quest.isComplete(player)) {
      player.sendMessage("You need Juna's blessing before you can collect the tears.");
      return;
    }
    if (!inGame(player)) return;
    addTears(player, 1);
    player.sendMessage("You catch a blue tear.");
  }

  /** The bowl on a tear object: blue banks a tear, green dilutes the bowl. */
  function handleBowlOnTears(event) {
    if (event.itemId !== STONE_BOWL_ITEM_ID) return;
    const blue = BLUE_TEAR_IDS.has(event.objectId);
    const green = GREEN_TEAR_IDS.has(event.objectId);
    if (!blue && !green) return;
    event.handled = true;
    const { player } = event;
    if (!quest.isComplete(player)) {
      player.sendMessage("You need Juna's blessing before you can collect the tears.");
      return;
    }
    if (!inGame(player)) return;
    if (green) {
      const drained = attr(player, TEARS_ATTRIBUTE) > 0;
      addTears(player, -1);
      player.sendMessage(drained ? "The green tears dilute your bowl." : "The green tears fill your bowl with nothing.");
      return;
    }
    addTears(player, 1);
    player.sendMessage("You catch a blue tear.");
  }

  /** The lowest skill the tears empower (Herblore/Runecrafting need their quests). */
  function lowestSkill(player) {
    const manager = player.getSkillManager();
    let skill;
    let xp = Infinity;
    for (const candidate of Skill.values()) {
      if (candidate === Skill.SAILING) continue;
      if (candidate === Skill.HERBLORE && otherQuestStage(player, "druidic_ritual") < DRUIDIC_RITUAL_COMPLETE) {
        continue;
      }
      if (candidate === Skill.RUNECRAFTING && otherQuestStage(player, "rune_mysteries") < RUNE_MYSTERIES_COMPLETE) {
        continue;
      }
      const value = manager.getExperience(candidate);
      if (value < xp) {
        xp = value;
        skill = candidate;
      }
    }
    return { skill, xp };
  }

  /** Convert banked tears into XP in the player's weakest skill. */
  function settleTears(player) {
    player.setAttribute(GAME_ENDS_ATTRIBUTE, 0);
    const points = attr(player, TEARS_ATTRIBUTE);
    if (points <= 0) {
      setAttr(player, TEARS_ATTRIBUTE, 0);
      return;
    }
    setAttr(player, TEARS_ATTRIBUTE, 0);
    if (!quest.isComplete(player)) return;
    const { skill, xp } = lowestSkill(player);
    if (!skill) return;
    const rate = Math.min(60, 10 + Math.floor(Math.floor(xp / 10) / 27) / 10);
    player.getSkillManager().addExperiences(skill, Math.floor(rate * points));
    const message = TEAR_MESSAGES.get(skill.getIndex());
    if (message) player.sendMessage(message);
  }

  /** Tunnels and climb rocks are the way out of the chasm; settle on the way. */
  function handleChasmExit(event) {
    if (!CHASM_EXIT_IDS.has(event.objectId)) return;
    settleTears(event.player);
  }

  function handleLogout({ player }) {
    if (player) settleTears(player);
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  api.persistAttribute(TEARS_ATTRIBUTE);
  api.persistAttribute(LAST_GAME_ATTRIBUTE);

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
  api.onItemOnObject(handleBowlOnTears, { noted: false });
  api.onObjectInteraction("Weeping wall", { "Collect-from": collectTearFromWall });
  api.onObjectInteraction("Magical rocks", { Mine: mineMagicStone });
  api.onObjectInteraction(handleChasmExit);
  api.onPlayerLogout(handleLogout);
  api.onPlayerLogin(handleLogin);
};
