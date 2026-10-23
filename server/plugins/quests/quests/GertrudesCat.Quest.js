/**
 * Gertrude's Cat (members).
 *
 * Gertrude (7284/7723) and the boys Shilop (3501) / Wilough (3503) are indexed on
 * the "Gertrude's Cat" transcript page, so their talk is transcript-driven; this
 * plugin selects the variant by stage, runs the start hook, consumes the 100 coins
 * hand-in and completes on the "finishing-up" action. Fluffs (3497) is indexed only
 * for her post-quest catspeak pages, so her quest interactions are replayed from the
 * "Gertrude's Cat" page by stage, and her milk/sardine/kitten hand-overs, the
 * doogle-sardine recipe and NPC-crate search are supplied here.
 *
 * Stages (varp 180): 1 started, 2 paid the boy, 3 gave milk, 4 gave sardine,
 * 5 rescued the kitten, 6 complete.
 *
 * Gaps (no dump support): the crate search does not honour the reference's
 * kitten-crate varp (181); every Lumber Yard mewing crate can find the kitten
 * at stage 4. At completion Gertrude plays her generic "Gertrude" page dialogue
 * (the cat page has no post-quest variant).
 */
module.exports = function registerGertrudesCatQuest(api) {
  const { Skill, ItemIdentifiers, NpcIdentifiers } = api.core;
  const { registerQuest, startTranscript } = require("../QuestRuntime");

  const PAGE = "Gertrude's Cat";

  const GERTRUDE_NPC_IDS = new Set([NpcIdentifiers.GERTRUDE, NpcIdentifiers.GERTRUDE_2]);
  const SHILOP_NPC_ID = NpcIdentifiers.SHILOP;
  const WILOUGH_NPC_ID = NpcIdentifiers.WILOUGH;
  const FLUFFS_NPC_ID = NpcIdentifiers.GERTRUDES_CAT_2;
  const CRATE_NPC_ID = NpcIdentifiers.CRATE;
  const QUEST_NPC_IDS = new Set([...GERTRUDE_NPC_IDS, SHILOP_NPC_ID, WILOUGH_NPC_ID, FLUFFS_NPC_ID]);

  const VARP_GERTRUDES_CAT = 180;
  const STAGE_STARTED = 1;
  const STAGE_PAID_BOY = 2;
  const STAGE_GAVE_MILK = 3;
  const STAGE_GAVE_SARDINE = 4;
  const STAGE_RESCUED = 5;
  const STAGE_COMPLETE = 6;

  const RAW_SARDINE_ITEM_ID = ItemIdentifiers.RAW_SARDINE;
  const BUCKET_ITEM_ID = ItemIdentifiers.BUCKET;
  const MILK_ITEM_ID = ItemIdentifiers.BUCKET_OF_MILK;
  const BOTTOMLESS_MILK_ITEM_ID = 33089; // Gameval bottomless_milk_bucket_filled
  const COINS_ITEM_ID = ItemIdentifiers.COINS;
  const SEASONED_SARDINE_ITEM_ID = ItemIdentifiers.SEASONED_SARDINE;
  const FLUFFS_KITTEN_ITEM_ID = ItemIdentifiers.FLUFFS_KITTEN;
  const DOOGLE_LEAVES_ITEM_ID = ItemIdentifiers.DOOGLE_LEAVES;
  const CHOCOLATE_CAKE_ITEM_ID = ItemIdentifiers.CHOCOLATE_CAKE;
  const STEW_ITEM_ID = ItemIdentifiers.STEW;

  /** Fluffs' quest flavour: talking is the same throughout, the hiss hint moves by stage. */
  const FLUFFS_TALK_VARIANT = "finding-fluffs-talk-to-fluffs";
  const FLUFFS_STAGE_HINTS = {
    [STAGE_PAID_BOY]: { "pick-up": "finding-fluffs-pick-up-fluffs", stroke: "finding-fluffs-stroke-fluffs" },
    [STAGE_GAVE_MILK]: { "pick-up": "finding-fluffs-pick-up-fluffs-2", stroke: "finding-fluffs-pick-up-fluffs-2" },
    [STAGE_GAVE_SARDINE]: { "pick-up": "making-seasoned-sardines-pick-up-fluffs", stroke: "making-seasoned-sardines-pick-up-fluffs" },
  };

  // The helper marks the mewing "Crate" NPCs in the Lumber Yard.
  const LUMBERYARD_CRATE_BOUNDS = { minX: 3298, maxX: 3315, minY: 3499, maxY: 3515, z: 0 };

  const START_HOOK = "quest:gertrude-s-cat:start";
  const COINS_ACTION_ID = "YQId7G";
  const COMPLETE_ACTION_ID = "Rf4BAK";
  const REPLACEMENT_KITTEN_ACTION_ID = "Q44J0B";

  let quest;

  const hasItem = (player, itemId) => player.getInventory().getAmount(itemId) > 0;

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I found Fluffs and returned her kitten.</str>",
        "<str>Gertrude gave me a kitten of my own.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_RESCUED) {
      return ["Fluffs ran home with her kitten.", "I should return to <col=800000>Gertrude</col>."];
    }
    if (stage >= STAGE_GAVE_SARDINE) {
      return [
        "Fluffs is fed but afraid to leave.",
        "I can hear a <col=800000>kitten mewing in the lumber yard crates</col>.",
      ];
    }
    if (stage >= STAGE_GAVE_MILK) {
      return [
        "Fluffs is no longer thirsty.",
        "Gertrude said she likes a raw sardine seasoned with <col=800000>doogle leaves</col>.",
      ];
    }
    if (stage >= STAGE_PAID_BOY) {
      return [
        "Shilop saw Fluffs at the abandoned lumber yard",
        "north-east of the Jolly Boar Inn.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return ["Gertrude asked me to speak to", "<col=800000>Shilop and Wilough</col> in Varrock marketplace."];
    }
    return ["Speak to <col=800000>Gertrude</col> in her house", "west of Varrock."];
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.COOKING, 1525);
    // The wiki's completion hand-out also includes the cake and stew the scroll advertises.
    player.getInventory().adds(CHOCOLATE_CAKE_ITEM_ID, 1);
    player.getInventory().adds(STEW_ITEM_ID, 1);
  }

  function gertrudeVariant(stage) {
    if (stage >= STAGE_COMPLETE) return { page: "Gertrude", variant: "standard-dialogue-on-pay-to-play-worlds" };
    if (stage >= STAGE_RESCUED) return "finishing-up";
    if (stage >= STAGE_GAVE_SARDINE) return "making-seasoned-sardines-talking-to-gertrude-after-giving-fluffs-the-sardine";
    if (stage >= STAGE_GAVE_MILK) return "finding-fluffs-talking-to-gertrude-again";
    if (stage >= STAGE_PAID_BOY) return "talking-to-shilop-and-wilough-talking-to-gertrude-again";
    if (stage >= STAGE_STARTED) return "starting-off-talking-to-gertrude-again";
    return "starting-off";
  }

  function boyVariant(npcId, stage) {
    if (stage >= STAGE_RESCUED) return null;
    if (stage >= STAGE_GAVE_SARDINE) return "finding-fluffs-talking-to-shilop-and-wilough-again";
    if (stage >= STAGE_PAID_BOY) {
      // After paying, the canonical follow-up is no longer the first (pay) menu.
      // That variant lives on the shared "Gertrude's Cat" transcript page, not
      // on Wilough's own page (which only has the standard/treasure-trail talk).
      if (npcId === WILOUGH_NPC_ID) {
        return { page: PAGE, variant: "talking-to-shilop-and-wilough-talking-to-them-again" };
      }
      return { page: "Shilop", variant: "standard-dialogue-after-paying-him" };
    }
    if (stage >= STAGE_STARTED) return "talking-to-shilop-and-wilough";
    return null;
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);
    if (GERTRUDE_NPC_IDS.has(npcId)) return gertrudeVariant(stage);
    if (npcId === SHILOP_NPC_ID || npcId === WILOUGH_NPC_ID) return boyVariant(npcId, stage);
    return null;
  }

  function handleGertrudeInteraction(event) {
    if (!GERTRUDE_NPC_IDS.has(event.npcId)) return false;
    const stage = quest.getStage(event.player);
    if (stage < STAGE_STARTED || stage >= STAGE_COMPLETE) return false;
    event.handled = true;
    startTranscript(api, event.player, event.npcId, PAGE, gertrudeVariant(stage));
    return true;
  }

  function answerCondition({ npcId, player, text }) {
    // Gertrude's pages only; other quests share the same prose ("free inventory
    // space") and must answer it themselves.
    if (
      !GERTRUDE_NPC_IDS.has(npcId) &&
      npcId !== SHILOP_NPC_ID &&
      npcId !== WILOUGH_NPC_ID
    ) {
      return null;
    }
    const value = String(text).toLowerCase();
    if (value.includes("does not have at least 100 coins")) return player.getInventory().getAmount(COINS_ITEM_ID) < 100;
    if (value.includes("at least 100 coins")) return player.getInventory().getAmount(COINS_ITEM_ID) >= 100;
    if (value.includes("no free inventory space")) return player.getInventory().isFull();
    if (value.includes("free inventory space")) return !player.getInventory().isFull();
    return null;
  }

  function handleStartHook({ player, hook }) {
    if (hook !== START_HOOK) return;
    if (quest.getStage(player) < STAGE_STARTED) quest.setStage(player, STAGE_STARTED);
  }

  function handleAction(event) {
    const { player, stepId } = event;
    const stage = quest.getStage(player);
    // The dump wraps wiki conditionals as `unavailable` steps mid-branch (the boys'
    // first-talk LgothB, Gertrude's mDyVfF before the completion action). The shared
    // dialogue runtime closes on them; for this quest's NPCs skip past them instead.
    if (QUEST_NPC_IDS.has(event.npcId) && (event.step?.type === "unavailable" || event.step?.type === "reference")) {
      event.handled = true;
      event.end = false;
      return;
    }
    if (stepId === COINS_ACTION_ID) {
      if (stage >= STAGE_PAID_BOY) {
        event.handled = true;
        return;
      }
      if (player.getInventory().getAmount(COINS_ITEM_ID) < 100) {
        event.handled = true;
        event.end = true;
        return;
      }
      player.getInventory().deleteNumber(COINS_ITEM_ID, 100);
      player.sendMessage("You give the lad 100 coins.");
      quest.setStage(player, STAGE_PAID_BOY);
      event.handled = true;
      return;
    }
    if (stepId === COMPLETE_ACTION_ID) {
      if (!quest.isComplete(player) && stage >= STAGE_RESCUED && player.getInventory().getFreeSlots() < 3) {
        player.sendMessage("You need three free inventory slots to receive Gertrude's rewards.");
        event.handled = true;
        event.end = true;
        return;
      }
      if (!quest.isComplete(player) && stage >= STAGE_RESCUED) quest.complete(player);
      event.handled = true;
      event.end = true;
      return;
    }
    if (stepId === REPLACEMENT_KITTEN_ACTION_ID) {
      event.handled = true;
      if (player.getInventory().getAmount(COINS_ITEM_ID) < 100) {
        player.sendMessage("You need 100 coins to buy another kitten.");
        event.end = true;
        return;
      }
      if (player.getInventory().isFull()) {
        player.sendMessage("You need a free inventory slot.");
        event.end = true;
        return;
      }
      player.getInventory().deleteNumber(COINS_ITEM_ID, 100);
      player.getInventory().adds(ItemIdentifiers.PET_KITTEN, 1);
      player.sendMessage("Gertrude gives you another kitten.");
    }
  }

  /** Fluffs: milk, seasoned sardine, then her kitten. */
  function handleItemOnCat(event) {
    if ((event.npcId ?? event.target?.getId?.()) !== FLUFFS_NPC_ID) return;
    const { player, itemId } = event;
    const stage = quest.getStage(player);
    if ((itemId === MILK_ITEM_ID || itemId === BOTTOMLESS_MILK_ITEM_ID) && stage === STAGE_PAID_BOY) {
      if (itemId === MILK_ITEM_ID) {
        player.getInventory().deleteNumber(MILK_ITEM_ID, 1);
        player.getInventory().adds(BUCKET_ITEM_ID, 1);
      }
      quest.setStage(player, STAGE_GAVE_MILK);
      player.sendMessage("Fluffs laps up the milk.");
      event.handled = true;
      return;
    }
    if (itemId === SEASONED_SARDINE_ITEM_ID && stage === STAGE_GAVE_MILK) {
      player.getInventory().deleteNumber(SEASONED_SARDINE_ITEM_ID, 1);
      quest.setStage(player, STAGE_GAVE_SARDINE);
      player.sendMessage("Fluffs eats the seasoned sardine, but still seems afraid.");
      event.handled = true;
      return;
    }
    if (itemId === FLUFFS_KITTEN_ITEM_ID && stage === STAGE_GAVE_SARDINE) {
      player.getInventory().deleteNumber(FLUFFS_KITTEN_ITEM_ID, 1);
      quest.setStage(player, STAGE_RESCUED);
      player.sendMessage("Fluffs purrs and runs home with her kitten.");
      event.handled = true;
      return;
    }
    if (itemId === MILK_ITEM_ID || itemId === BOTTOMLESS_MILK_ITEM_ID || itemId === SEASONED_SARDINE_ITEM_ID || itemId === FLUFFS_KITTEN_ITEM_ID) {
      player.sendMessage("Fluffs is not interested right now.");
      event.handled = true;
    }
  }

  /** The stage-appropriate wiki flavour for a Fluffs click ("pick-up" / "stroke"). */
  function fluffsVariant(action, stage) {
    if (action === "talk-to") return FLUFFS_TALK_VARIANT;
    const hints = FLUFFS_STAGE_HINTS[stage] ?? FLUFFS_STAGE_HINTS[STAGE_PAID_BOY];
    return hints?.[action] ?? null;
  }

  /**
   * Fluffs' quest clicks: the id index only carries her post-quest catspeak pages, so
   * replay the stage-appropriate "Gertrude's Cat" variant and claim the click before
   * NpcDialogues/Pets pick the catspeak conversation or the generic fallback.
   */
  function handleFluffsInteraction(event) {
    if (event.npcId !== FLUFFS_NPC_ID) return;
    const stage = quest.getStage(event.player);
    if (stage >= STAGE_RESCUED) return;
    const actions = event.definition?.getActions?.() ?? [];
    const action = String(actions[event.clickType - 1] ?? "").toLowerCase();
    const variant = fluffsVariant(action, stage);
    if (!variant) return;
    event.handled = true;
    startTranscript(api, event.player, FLUFFS_NPC_ID, PAGE, variant);
  }

  /** Seasoning a raw sardine with doogle leaves (either order). */
  function handleItemOnItem(event) {
    const ids = [event.usedItemId, event.usedWithItemId];
    if (!ids.includes(DOOGLE_LEAVES_ITEM_ID) || !ids.includes(RAW_SARDINE_ITEM_ID)) return;
    const { player } = event;
    player.getInventory().deleteNumber(DOOGLE_LEAVES_ITEM_ID, 1);
    player.getInventory().deleteNumber(RAW_SARDINE_ITEM_ID, 1);
    player.getInventory().adds(SEASONED_SARDINE_ITEM_ID, 1);
    player.sendMessage("You rub the doogle leaves all over the sardine.");
    event.handled = true;
  }

  function isLumberyardCrate(event) {
    if ((event.npcId ?? event.npc?.getId?.()) !== CRATE_NPC_ID) return false;
    const location = event.npc?.getLocation?.() ?? event.location;
    if (!location) return false;
    const x = location.x ?? location.getX?.();
    const y = location.y ?? location.getY?.();
    const z = location.z ?? location.getZ?.() ?? 0;
    const bounds = LUMBERYARD_CRATE_BOUNDS;
    return z === bounds.z && x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
  }

  /** Searching the lumber-yard crates finds the kitten once Fluffs is fed. */
  function handleCrateSearch(event) {
    if (!isLumberyardCrate(event)) return false;
    const action = event.definition?.getActions?.()[event.clickType - 1] ?? event.option;
    if (String(action ?? "").toLowerCase() !== "search") return false;
    const { player } = event;
    if (quest.getStage(player) !== STAGE_GAVE_SARDINE || hasItem(player, FLUFFS_KITTEN_ITEM_ID)) {
      player.sendMessage("You search the crate but find nothing.");
      event.handled = true;
      return true;
    }
    if (player.getInventory().isFull()) {
      player.sendMessage("You need a free inventory slot.");
      event.handled = true;
      return true;
    }
    player.getInventory().adds(FLUFFS_KITTEN_ITEM_ID, 1);
    player.sendMessage("You find Fluffs' kitten!");
    event.handled = true;
    return true;
  }

  quest = registerQuest(api, {
    key: "gertrudes_cat",
    name: "Gertrude's Cat",
    varpId: VARP_GERTRUDES_CAT,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 1,
    xpRewards: [{ skillId: Skill.COOKING.getIndex(), amount: 1525, label: "Cooking" }],
    rewardItemId: ItemIdentifiers.PET_KITTEN,
    rewardItemLabel: "A pet kitten",
    otherRewards: ["A chocolate cake and a bowl of stew", "The ability to raise cats"],
    buildJournal,
    onReward: grantReward,
  });

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcInteraction("Gertrude", { "Talk-to": handleGertrudeInteraction });
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onNpcInteraction(handleFluffsInteraction);
  api.onItemOnNpc(handleItemOnCat);
  api.onItemOnItem(handleItemOnItem);
  api.onNpcInteraction("Crate", { Search: handleCrateSearch });
};
