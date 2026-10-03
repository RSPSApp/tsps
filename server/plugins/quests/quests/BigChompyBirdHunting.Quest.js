/**
 * Big Chompy Bird Hunting (members).
 *
 * The words come from the "Big Chompy Bird Hunting" transcript page; Rantz, Fycie
 * and Bugs are indexed, so this plugin supplies the by-stage variant selector, the
 * prose-condition answers, the start hook (granting the quest start), the ogre-arrow
 * hand-in (MSG "Rantz takes six ogre arrows off you.") and the seasoned-chompy
 * completion action. The xrsps stage machine (varp 293) and its kill counter
 * (varp 294) are ported here.
 *
 * The child shops (Bugs' knife+chisel for 10 coins, Fycie's 25 feathers for 50),
 * arrow fletching, bellows/toad bait and the spit-roast cooking are interaction
 * hooks that need item-on-item / item-on-loc / item-on-npc plumbing the transcript
 * dump cannot verify here; only the dialogue-driven pieces above are wired.
 *
 * Note: the cache id for Rantz used by npc-dialogue-index.json is 1470, which has no
 * NpcIdentifiers entry, so it is inlined alongside RANTZ_2/3/4.
 */
module.exports = function registerBigChompyBirdHuntingQuest(api) {
  const { Skill, ItemIdentifiers, NpcIdentifiers } = api.core;
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");

  const PAGE = "Big Chompy Bird Hunting";
  const RANTZ_PAGE = "Rantz";
  const FYCIE_PAGE = "Fycie";
  const BUGS_PAGE = "Bugs";

  const VARP_CHOMPY_BIRD = 293;

  const STAGE_STARTED = 5;
  const STAGE_GIVEN_ARROWS = 10;
  const STAGE_KIDS_EXPLAINED_TOADS = 15;
  const STAGE_SHOWN_TOAD = 25;
  const STAGE_RANTZ_MISSED = 40;
  const STAGE_GIVEN_BOW = 45;
  const STAGE_KILLED_CHOMPY = 50;
  const STAGE_TOLD_TO_COOK = 55;
  const STAGE_CHOMPY_COOKED = 60;
  const STAGE_COMPLETE = 65;

  const START_HOOK = "quest:big-chompy-bird-hunting:start";
  /** "Rantz takes six ogre arrows off you." (returning-to-rantz-with-six-or-more-ogre-arrows). */
  const TAKE_ARROWS_MESSAGE_ID = "pzg8li";
  /** "Congratulations! Quest complete!" in handing-the-chompy-to-rantz. */
  const COMPLETE_ACTION_ID = "cmDp4e";

  /** Rantz has more than one cache id but all reach the same transcript pages. */
  const RANTZ_NPC_IDS = new Set([1470, NpcIdentifiers.RANTZ_2, NpcIdentifiers.RANTZ_3, NpcIdentifiers.RANTZ_4]);
  const FYCIE_NPC_ID = NpcIdentifiers.FYCIE;
  const BUGS_NPC_IDS = new Set([NpcIdentifiers.BUGS, NpcIdentifiers.BUGS_2]);

  const OGRE_ARROW = ItemIdentifiers.OGRE_ARROW;
  const OGRE_BOW = ItemIdentifiers.OGRE_BOW;
  const BLOATED_TOAD = ItemIdentifiers.BLOATED_TOAD;
  const RAW_CHOMPY = ItemIdentifiers.RAW_CHOMPY;
  const SEASONED_CHOMPY = ItemIdentifiers.SEASONED_CHOMPY;

  const page = (p, variant) => ({ page: p, variant });
  const has = (player, itemId, quantity = 1) => player.getInventory().getAmount(itemId) >= quantity;

  let quest;

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return ["<str>I hunted and cooked a seasoned chompy for Rantz.</str>", "", "<col=ff0000>QUEST COMPLETE!</col>"];
    }
    if (stage >= STAGE_CHOMPY_COOKED) return ["Give the <col=800000>seasoned chompy</col> to Rantz."];
    if (stage >= STAGE_TOLD_TO_COOK) return ["Ask <col=800000>Bugs</col> and <col=800000>Fycie</col> which flavours they want,", "then cook the raw chompy on Rantz's spit roast."];
    if (stage >= STAGE_KILLED_CHOMPY) return ["Pluck the dead chompy and show its raw meat to <col=800000>Rantz</col>."];
    if (stage >= STAGE_GIVEN_BOW) return ["Shoot the chompy with the <col=800000>ogre bow</col> and ogre arrows."];
    if (stage >= STAGE_SHOWN_TOAD) return ["Release a <col=800000>bloated toad</col> in the clearing south of Rantz."];
    if (stage >= STAGE_KIDS_EXPLAINED_TOADS) return ["Open the rock-covered chest in the cave for ogre bellows,", "fill them at swamp bubbles, then inflate a swamp toad."];
    if (stage >= STAGE_GIVEN_ARROWS) return ["Ask Rantz how to attract a chompy, then speak to his children."];
    if (stage >= STAGE_STARTED) return ["Make six ogre arrows from achey logs, wolf bones and feathers,", "then give the arrows to <col=800000>Rantz</col>."];
    return ["Speak to <col=800000>Rantz</col> east of Gu'Tanoth in the Feldhil Hills."];
  }

  function grantReward(player) {
    const skills = player.getSkillManager();
    skills.addExperiences(Skill.FLETCHING, 262);
    skills.addExperiences(Skill.COOKING, 1470);
    skills.addExperiences(Skill.RANGED, 735);
  }

  /** Which transcript variant the clicked NPC plays, by quest stage. */
  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);

    if (RANTZ_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_COMPLETE) return page(RANTZ_PAGE, "after-big-chompy-bird-hunting");
      if (stage >= STAGE_CHOMPY_COOKED) return page(PAGE, "handing-the-chompy-to-rantz-or-trying-to-cook-another-raw-chompy");
      if (stage >= STAGE_TOLD_TO_COOK) return page(PAGE, "talking-to-rantz-with-a-raw-chompy-talking-to-rantz-again-before-cooking-the-chompy");
      if (stage >= STAGE_GIVEN_BOW) {
        return page(PAGE, has(player, RAW_CHOMPY)
          ? "talking-to-rantz-with-a-raw-chompy"
          : "talking-to-rantz-after-he-failed-talking-to-rantz-before-hunting-the-chompy");
      }
      if (stage >= STAGE_RANTZ_MISSED) return page(PAGE, "talking-to-rantz-after-he-failed");
      if (stage >= STAGE_SHOWN_TOAD) return page(PAGE, "successfully-attracting-a-chompy-after-the-chompy-eats-the-toad");
      if (stage >= STAGE_KIDS_EXPLAINED_TOADS) {
        return page(PAGE, has(player, BLOATED_TOAD)
          ? "returning-to-rantz-with-the-bloated-toad"
          : "using-ogre-arrows-made-by-the-player-on-rantz-returning-to-rantz-without-a-bloated-toad");
      }
      if (stage >= STAGE_GIVEN_ARROWS) return page(PAGE, "using-ogre-arrows-made-by-the-player-on-rantz-returning-to-rantz-without-a-bloated-toad");
      if (stage >= STAGE_STARTED) {
        return page(PAGE, has(player, OGRE_ARROW, 6)
          ? "returning-to-rantz-with-six-or-more-ogre-arrows"
          : "starting-off-returning-to-rantz-without-ogre-arrows");
      }
      return page(PAGE, "starting-off");
    }

    if (npcId === FYCIE_NPC_ID) {
      if (stage >= STAGE_COMPLETE) return page(FYCIE_PAGE, "after-big-chompy-bird-hunting");
      if (stage >= STAGE_TOLD_TO_COOK) return page(PAGE, "talking-to-rantz-with-a-raw-chompy-getting-the-ingredient-order-from-fycie");
      if (stage >= STAGE_KIDS_EXPLAINED_TOADS) return page(PAGE, "returning-to-rantz-with-the-bloated-toad-talking-to-fycie");
      if (stage >= STAGE_GIVEN_ARROWS) return page(PAGE, "using-ogre-arrows-made-by-the-player-on-rantz-talking-to-fycie");
      if (stage >= STAGE_STARTED) return page(PAGE, "starting-off-talking-to-fycie");
      return null;
    }

    if (BUGS_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_COMPLETE) return page(BUGS_PAGE, "after-big-chompy-bird-hunting");
      if (stage >= STAGE_TOLD_TO_COOK) return page(PAGE, "talking-to-rantz-with-a-raw-chompy-getting-the-ingredient-order-from-bugs");
      if (stage >= STAGE_KIDS_EXPLAINED_TOADS) return page(PAGE, "returning-to-rantz-with-the-bloated-toad-talking-to-bugs");
      if (stage >= STAGE_GIVEN_ARROWS) return page(PAGE, "using-ogre-arrows-made-by-the-player-on-rantz-talking-to-bugs");
      if (stage >= STAGE_STARTED) return page(PAGE, "starting-off-talking-to-bugs-without-a-chisel-and-knife");
      return null;
    }

    return null;
  }

  /** Answer the transcript's prose conditions. */
  function answerCondition({ player, text }) {
    const value = String(text).toLowerCase();
    if (value.includes("more than six ogre arrows not made by themselves")) return false;
    if (value.includes("has less than six ogre arrows")) return !has(player, OGRE_ARROW, 6);
    if (value.includes("has six or more ogre arrows")) return has(player, OGRE_ARROW, 6);
    if (value.includes("using a raw chompy on rantz")) return false;
    if (value.includes("using ogre arrows not made by the player")) return false;
    if (value.includes("missing at least one requirement")) return false;
    if (value.includes("does not have 10 coins")) return !has(player, ItemIdentifiers.COINS, 10);
    if (value.includes("has 10 coins and inventory space")) return has(player, ItemIdentifiers.COINS, 10);
    if (value.includes("does not have 50 coins")) return !has(player, ItemIdentifiers.COINS, 50);
    if (value.includes("has 50 coins and inventory space")) return has(player, ItemIdentifiers.COINS, 50);
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!RANTZ_NPC_IDS.has(npcId) || hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_STARTED) quest.setStage(player, STAGE_STARTED);
  }

  /** Item-on-item fletching of ogre arrows, ported from xrsps. */
  function handleItemOnItem(event) {
    const { player } = event;
    const ids = [event.usedItemId, event.usedWithItemId];
    if (quest.getStage(player) < STAGE_STARTED) return;
    if (ids.includes(ItemIdentifiers.KNIFE) && ids.includes(ItemIdentifiers.ACHEY_TREE_LOGS)) {
      if (has(player, ItemIdentifiers.ACHEY_TREE_LOGS)) {
        player.getInventory().deleteNumber(ItemIdentifiers.ACHEY_TREE_LOGS, 1);
        player.getInventory().adds(ItemIdentifiers.OGRE_ARROW_SHAFT, 6);
        player.sendMessage("You cut the achey logs into six ogre arrow shafts.");
        event.handled = true;
      }
      return;
    }
    if (ids.includes(ItemIdentifiers.CHISEL) && ids.includes(ItemIdentifiers.WOLF_BONES)) {
      if (has(player, ItemIdentifiers.WOLF_BONES)) {
        player.getInventory().deleteNumber(ItemIdentifiers.WOLF_BONES, 1);
        player.getInventory().adds(ItemIdentifiers.WOLFBONE_ARROWTIPS, 6);
        event.handled = true;
      }
      return;
    }
    if (ids.includes(ItemIdentifiers.FEATHER) && ids.includes(ItemIdentifiers.OGRE_ARROW_SHAFT)) {
      const amount = Math.min(player.getInventory().getAmount(ItemIdentifiers.OGRE_ARROW_SHAFT), Math.floor(player.getInventory().getAmount(ItemIdentifiers.FEATHER) / 4), 6);
      if (amount >= 1) {
        player.getInventory().deleteNumber(ItemIdentifiers.FEATHER, amount * 4);
        player.getInventory().deleteNumber(ItemIdentifiers.OGRE_ARROW_SHAFT, amount);
        player.getInventory().adds(ItemIdentifiers.FLIGHTED_OGRE_ARROW, amount);
        event.handled = true;
      }
      return;
    }
    if (ids.includes(ItemIdentifiers.WOLFBONE_ARROWTIPS) && ids.includes(ItemIdentifiers.FLIGHTED_OGRE_ARROW)) {
      const amount = Math.min(player.getInventory().getAmount(ItemIdentifiers.WOLFBONE_ARROWTIPS), player.getInventory().getAmount(ItemIdentifiers.FLIGHTED_OGRE_ARROW), 6);
      if (amount >= 1) {
        player.getInventory().deleteNumber(ItemIdentifiers.WOLFBONE_ARROWTIPS, amount);
        player.getInventory().deleteNumber(ItemIdentifiers.FLIGHTED_OGRE_ARROW, amount);
        player.getInventory().adds(OGRE_ARROW, amount);
        player.sendMessage(`You make ${amount} ogre arrow${amount === 1 ? "" : "s"}.`);
        event.handled = true;
      }
    }
  }

  /** Bellows on swamp bubbles, and a bloated toad on the ground. */
  function handleItemOnObject(event) {
    const { player, objectId, itemId } = event;
    const isSwampBubble = objectId === 684 || objectId === 735;
    if (isSwampBubble) {
      const bellowsState = [ItemIdentifiers.OGRE_BELLOWS, ItemIdentifiers.OGRE_BELLOWS_1_, ItemIdentifiers.OGRE_BELLOWS_2_].find((id) => has(player, id));
      if (bellowsState !== undefined) {
        player.getInventory().deleteNumber(bellowsState, 1);
        player.getInventory().adds(ItemIdentifiers.OGRE_BELLOWS_3_, 1);
        player.sendMessage("You fill the ogre bellows with thick swamp gas.");
        event.handled = true;
      }
    }
  }

  /** Release the bloated toad to start the hunt. */
  function handleItemAction(event) {
    const option = String(event.option ?? "").toLowerCase();
    if (event.itemId !== BLOATED_TOAD || !option.includes("release")) return;
    const stage = quest.getStage(event.player);
    if (stage < STAGE_SHOWN_TOAD) {
      event.player.sendMessage("You should ask Rantz where to place this toad.");
      event.handled = true;
      return;
    }
    if (event.player.getInventory().getAmount(BLOATED_TOAD) > 0) {
      event.player.getInventory().deleteNumber(BLOATED_TOAD, 1);
      if (stage < STAGE_COMPLETE) quest.setStage(event.player, STAGE_RANTZ_MISSED);
      event.player.sendMessage("You carefully place the bloated toad bait. A chompy swoops down!");
      event.handled = true;
    }
  }

  /** The transcript's arrow hand-in and seasoned-chompy completion actions. */
  function handleAction({ player, npcId, stepId }) {
    if (!RANTZ_NPC_IDS.has(npcId)) return;
    if (stepId === TAKE_ARROWS_MESSAGE_ID) {
      if (quest.getStage(player) < STAGE_STARTED || !has(player, OGRE_ARROW, 6)) return;
      player.getInventory().deleteNumber(OGRE_ARROW, 6);
      quest.setStage(player, STAGE_GIVEN_ARROWS);
      return;
    }
    if (stepId === COMPLETE_ACTION_ID) {
      if (quest.getStage(player) < STAGE_CHOMPY_COOKED || quest.isComplete(player)) return;
      if (has(player, SEASONED_CHOMPY)) player.getInventory().deleteNumber(SEASONED_CHOMPY, 1);
      quest.complete(player);
    }
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  quest = registerQuest(api, {
    key: "big_chompy_bird_hunting",
    name: "Big Chompy Bird Hunting",
    varpId: VARP_CHOMPY_BIRD,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 2,
    xpRewards: [
      { skillId: Skill.FLETCHING.getIndex(), amount: 262, label: "Fletching" },
      { skillId: Skill.COOKING.getIndex(), amount: 1470, label: "Cooking" },
      { skillId: Skill.RANGED.getIndex(), amount: 735, label: "Ranged" },
    ],
    rewardItemId: OGRE_BOW,
    rewardItemLabel: "An ogre bow",
    otherRewards: ["Ability to hunt chompy birds", "Chompy bird hats from Rantz"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onItemOnItem(handleItemOnItem);
  api.onItemOnObject(handleItemOnObject);
  api.onItemAction(handleItemAction);
  api.onPlayerLogin(handleLogin);
};
