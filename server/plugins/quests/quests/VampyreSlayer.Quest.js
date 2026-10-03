/**
 * Vampyre Slayer.
 *
 * Words come from npc-dialogues.json. The "Vampyre Slayer" page mixes the quest
 * NPCs, so each branch is selected by the speaker's cache id:
 *   Morgan 3479, Dr Harlow 3480, Count Draynor 3481.
 *   stage 0     -> Morgan "Vampyre Slayer" / "starting-off" (hook starts quest)
 *   stage 1     -> Morgan "…/starting-off-talking-to-morgan-again"
 *                  Harlow "…/dr-harlow" (no beer) or "…/dr-harlow-talking-to-him-again"
 *   stage 2     -> Morgan "…/dr-harlow-returning-to-morgan" (until garlic held)
 *                  Harlow "…/dr-harlow-talking-to-dr-harlow-after-getting-the-stake"
 *   complete    -> Morgan page "Morgan" first/subsequent; Harlow generic "Dr Harlow"
 *
 * This plugin supplies the variant selector, the condition answers, the start
 * hook, the beer/stake hand-overs, the garlic cupboard and the Count Draynor
 * kill resolution.
 *
 * Not covered here:
 *   - Count Draynor's spawn / coffin / the garlic cupboard placement are map
 *     content (the existing bosses/CountDraynor.plugin.js owns the instance).
 *   - No stake shop exists: Harlow hands out the stake; hammers come from the
 *     general stores; garlic from Morgan's cupboard (or spice stalls).
 *   - Harlow has no post-quest transcript variant, so completion falls back to
 *     his generic "Dr Harlow" / "standard-dialogue".
 *   - The "lost the stake" condition only checks the inventory (no bank lookup).
 */
module.exports = function registerVampyreSlayerQuest(api) {
  const { Skill, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers } = api.core;
  const { registerQuest } = require("../QuestRuntime");

  const MORGAN_NPC_ID = NpcIdentifiers.MORGAN;
  const HARLOW_NPC_ID = NpcIdentifiers.DR_HARLOW;
  const COUNT_NPC_IDS = new Set([NpcIdentifiers.COUNT_DRAYNOR]);

  const VARP_VAMPYRE_SLAYER = 178;
  const STAGE_STARTED = 1;
  const STAGE_HARLOW = 2;
  const STAGE_COMPLETE = 3;

  const STAKE_ITEM_ID = ItemIdentifiers.STAKE;
  const GARLIC_ITEM_ID = ItemIdentifiers.GARLIC;
  const BEER_ITEM_ID = ItemIdentifiers.BEER;
  const HAMMER_ITEM_ID = ItemIdentifiers.HAMMER;

  /** Morgan's garlic cupboard (the only searchable garlic source in the quest). */
  const GARLIC_CUPBOARD_IDS = [ObjectIdentifiers.CUPBOARD_18, ObjectIdentifiers.CUPBOARD_19];

  const MORGAN_GREET_ATTR = "quest.vampyre_slayer.morgan_greeted";

  const QUEST_START_HOOK = "quest:vampyre-slayer:start";
  /** "You give a beer to Dr Harlow." on page "Vampyre Slayer". */
  const HARLOW_BEER_MESSAGE_ID = "BokFvm";
  /** "Dr Harlow hands you a stake." (both the beer and lost-stake branches). */
  const HARLOW_STAKE_MESSAGE_IDS = new Set(["jJK9QV", "Za1uIb"]);

  let quest;

  const hasItem = (player, itemId) => player.getInventory().getAmount(itemId) > 0;

  /** Count Draynor NPCs already weakened once this spawn (needs garlic). */
  const weakenedNpcs = new WeakSet();

  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        "<str>I killed Count Draynor and saved the village.</str>",
        "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_HARLOW) {
      return [
        "I need to kill <col=800000>Count Draynor</col> beneath Draynor Manor.",
        "I need a <col=800000>stake and hammer</col>; garlic will weaken him.",
      ];
    }
    if (stage >= STAGE_STARTED) {
      return [
        "Morgan told me to find <col=800000>Dr Harlow</col> in",
        "Varrock's <col=800000>Blue Moon Inn</col>.",
      ];
    }
    return [
      "I can start this quest by speaking to",
      "<col=800000>Morgan</col> in Draynor Village.",
    ];
  }

  function reward(player) {
    player.getSkillManager().addExperiences(Skill.ATTACK, 4825);
  }

  function selectVariant({ npcId, player }) {
    const stage = quest.getStage(player);

    if (npcId === MORGAN_NPC_ID) {
      if (stage >= STAGE_COMPLETE) {
        const greeted = player.getAttribute(MORGAN_GREET_ATTR) === true;
        if (!greeted) player.setAttribute(MORGAN_GREET_ATTR, true);
        return {
          page: "Morgan",
          variant: greeted
            ? "after-vampyre-slayer-subsequent-times"
            : "after-vampyre-slayer-first-time",
        };
      }
      if (stage >= STAGE_HARLOW && !hasItem(player, GARLIC_ITEM_ID)) {
        return { page: "Vampyre Slayer", variant: "dr-harlow-returning-to-morgan" };
      }
      if (stage >= STAGE_STARTED) {
        return { page: "Vampyre Slayer", variant: "starting-off-talking-to-morgan-again" };
      }
      return { page: "Vampyre Slayer", variant: "starting-off" };
    }

    if (npcId === HARLOW_NPC_ID) {
      if (stage >= STAGE_COMPLETE) {
        // No post-quest Harlow transcript exists; fall back to his generic page.
        return { page: "Dr Harlow", variant: "standard-dialogue" };
      }
      if (stage >= STAGE_HARLOW) {
        return { page: "Vampyre Slayer", variant: "dr-harlow-talking-to-dr-harlow-after-getting-the-stake" };
      }
      if (stage >= STAGE_STARTED) {
        return {
          page: "Vampyre Slayer",
          variant: hasItem(player, BEER_ITEM_ID)
            ? "dr-harlow-talking-to-him-again"
            : "dr-harlow",
        };
      }
      return { page: "Dr Harlow", variant: "standard-dialogue" };
    }

    return null;
  }

  function answerCondition({ npcId, player, text }) {
    if (npcId !== MORGAN_NPC_ID && npcId !== HARLOW_NPC_ID) return null;
    const value = String(text).toLowerCase();
    if (value.includes("combat level less than 20")) {
      return player.getSkillManager().getCombatLevel() < 20;
    }
    if (value.includes("lost the stake")) return !hasItem(player, STAKE_ITEM_ID);
    if (value.includes("has the stake")) return hasItem(player, STAKE_ITEM_ID);
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (npcId !== MORGAN_NPC_ID || hook !== QUEST_START_HOOK) return;
    if (quest.getStage(player) >= STAGE_STARTED) return;
    quest.setStage(player, STAGE_STARTED);
  }

  function handleDialogueAction(event) {
    if (event.npcId !== HARLOW_NPC_ID) return;
    const { player, stepId } = event;

    if (stepId === HARLOW_BEER_MESSAGE_ID) {
      // Hand over the beer; let the transcript print its own line.
      if (player.getInventory().getAmount(BEER_ITEM_ID) > 0) {
        player.getInventory().deleteNumber(BEER_ITEM_ID, 1);
      }
      return;
    }

    if (HARLOW_STAKE_MESSAGE_IDS.has(stepId)) {
      if (player.getInventory().isFull()) {
        player.sendMessage("You need a free inventory slot for the stake.");
        event.handled = true;
        return;
      }
      player.getInventory().adds(STAKE_ITEM_ID, 1);
      if (quest.getStage(player) < STAGE_HARLOW) quest.setStage(player, STAGE_HARLOW);
      // Transcript prints "Dr Harlow hands you a stake."
    }
  }

  // Beer on Dr Harlow: hand it over and take the stake without the menu.
  function handleItemOnNpc(event) {
    if (event.itemId !== BEER_ITEM_ID) return;
    if (event.target.getId?.() !== HARLOW_NPC_ID) return;
    const stage = quest.getStage(event.player);
    if (stage < STAGE_STARTED || stage >= STAGE_COMPLETE) return;
    const inventory = event.player.getInventory();
    if (inventory.getAmount(BEER_ITEM_ID) <= 0) return;
    inventory.deleteNumber(BEER_ITEM_ID, 1);
    inventory.adds(STAKE_ITEM_ID, 1);
    if (stage < STAGE_HARLOW) quest.setStage(event.player, STAGE_HARLOW);
    event.player.sendMessage("You give a beer to Dr Harlow.");
    event.player.sendMessage("Dr Harlow hands you a stake.");
    event.handled = true;
  }

  // Morgan's cupboard: search or open it for a clove of garlic.
  function takeGarlic({ player }) {
    if (player.getInventory().isFull()) {
      player.sendMessage("You need a free inventory slot for the garlic.");
      return;
    }
    player.getInventory().adds(GARLIC_ITEM_ID, 1);
    player.sendMessage("You take a clove of garlic from the cupboard.");
  }

  // Carrying garlic weakens the vampyre the first time it is struck.
  function handlePlayerDealtDamage({ player, target }) {
    if (!target || typeof target.getId !== "function") return;
    if (!COUNT_NPC_IDS.has(target.getId())) return;
    const stage = quest.getStage(player);
    if (stage < STAGE_STARTED || stage >= STAGE_COMPLETE) return;
    if (!hasItem(player, GARLIC_ITEM_ID)) return;
    if (weakenedNpcs.has(target)) return;
    weakenedNpcs.add(target);
    player.sendMessage("The vampyre seems to be weakened by the garlic you're carrying.");
  }

  // Without a stake (or a hammer to drive it in) the vampyre regenerates.
  function handleNpcBeforeDeath(event) {
    const npc = event.npc;
    if (!COUNT_NPC_IDS.has(npc?.getId?.())) return;
    const killer = npc.getCombat?.().getKiller?.(false);
    if (!killer || typeof killer.getInventory !== "function") return;
    const stage = quest.getStage(killer);
    if (stage < STAGE_STARTED || stage >= STAGE_COMPLETE) return;
    const hasStake = hasItem(killer, STAKE_ITEM_ID);
    const hasHammer = hasItem(killer, HAMMER_ITEM_ID);
    if (hasStake && hasHammer) return;
    if (hasStake) killer.sendMessage("You're unable to push the stake far enough in!");
    killer.sendMessage("The vampyre seems to regenerate!");
    npc.setHitpoints(npc.getDefinition().getHitpoints());
    event.preventDeath = true;
  }

  // With a stake and hammer, the killing blow frees the village.
  function handleNpcDeath({ killer, npcId }) {
    if (!COUNT_NPC_IDS.has(npcId)) return;
    if (!killer || typeof killer.getInventory !== "function") return;
    const stage = quest.getStage(killer);
    if (stage < STAGE_STARTED || stage >= STAGE_COMPLETE) return;
    if (!hasItem(killer, STAKE_ITEM_ID) || !hasItem(killer, HAMMER_ITEM_ID)) return;
    killer.getInventory().deleteNumber(STAKE_ITEM_ID, 1);
    killer.sendMessage("You hammer the stake into the vampyre's chest!");
    quest.complete(killer);
  }

  quest = registerQuest(api, {
    key: "vampyre_slayer",
    name: "Vampyre Slayer",
    varpId: VARP_VAMPYRE_SLAYER,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 3,
    xpRewards: [{ skillId: Skill.ATTACK.getIndex(), amount: 4825, label: "Attack" }],
    scrollItemId: STAKE_ITEM_ID,
    buildJournal,
    onReward: reward,
  });
  api.persistAttribute(MORGAN_GREET_ATTR);

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onItemOnNpc(handleItemOnNpc);
  api.onObjectFirstClick(GARLIC_CUPBOARD_IDS, takeGarlic);
  api.onObjectSecondClick(GARLIC_CUPBOARD_IDS, takeGarlic);
  api.onPlayerDealtDamage(handlePlayerDealtDamage);
  api.onNpcBeforeDeath(handleNpcBeforeDeath);
  api.onNpcDeath(handleNpcDeath);
};
