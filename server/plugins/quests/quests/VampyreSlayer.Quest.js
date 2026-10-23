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
 *   - The captured Harlow dialogue predates the rev 241 Wiki transcript; current words
 *     come from that transcript, while the captured beer-request stage remains 2.
 */
module.exports = function registerVampyreSlayerQuest(api) {
  const { Skill, Animation, ItemIdentifiers, NpcIdentifiers, ObjectIdentifiers, ObjectManager, GameObject } = api.core;
  const { registerQuest } = require("../QuestRuntime");

  // Rev 241 moved Morgan's and Harlow's names into NPC transforms: the world spawns the
  // nameless parents 3479/3480, and interactions resolve to these variants. Content is
  // handed the resolved id, so accept every variant.
  const MORGAN_NPC_IDS = new Set([
    NpcIdentifiers.MORGAN,
    NpcIdentifiers.MORGAN_2,
    NpcIdentifiers.MORGAN_3,
  ]);
  const HARLOW_NPC_IDS = new Set([NpcIdentifiers.DR_HARLOW, NpcIdentifiers.DR_HARLOW_2]);
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

  const MORGAN_GREET_ATTR = "vampyre-slayer:morgan-greeted";
  const STAKE_RECEIVED_ATTRIBUTE = "vampyre-slayer:stake-received";

  const QUEST_START_HOOK = "quest:vampyre-slayer:start";
  /** "You give a beer to Dr Harlow." on page "Vampyre Slayer". */
  const HARLOW_BEER_MESSAGE_ID = "BokFvm";
  /** "Dr Harlow hands you a stake." (both the beer and lost-stake branches). */
  const HARLOW_STAKE_MESSAGE_IDS = new Set(["jJK9QV", "Za1uIb"]);

  let quest;

  const hasItem = (player, itemId) => player.getInventory().getAmount(itemId) > 0;

  const ownsStake = (player) => hasItem(player, STAKE_ITEM_ID) ||
    (player.getBanks?.() ?? []).some((bank) => bank?.getAmount?.(STAKE_ITEM_ID) > 0);

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

    if (MORGAN_NPC_IDS.has(npcId)) {
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

    if (HARLOW_NPC_IDS.has(npcId)) {
      if (stage >= STAGE_COMPLETE) {
        // No post-quest Harlow transcript exists; fall back to his generic page.
        return { page: "Dr Harlow", variant: "standard-dialogue" };
      }
      if (stage >= STAGE_HARLOW) {
        if (ownsStake(player)) player.setAttribute(STAKE_RECEIVED_ATTRIBUTE, true);
        return {
          page: "Vampyre Slayer",
          variant: player.getAttribute(STAKE_RECEIVED_ATTRIBUTE) === true
            ? "dr-harlow-talking-to-dr-harlow-after-getting-the-stake"
            : "dr-harlow-talking-to-him-again",
        };
      }
      if (stage >= STAGE_STARTED) {
        return {
          page: "Vampyre Slayer",
          variant: "dr-harlow",
        };
      }
      return { page: "Dr Harlow", variant: "standard-dialogue" };
    }

    return null;
  }

  function answerCondition({ npcId, player, text }) {
    if (!MORGAN_NPC_IDS.has(npcId) && !HARLOW_NPC_IDS.has(npcId)) return null;
    const value = String(text).toLowerCase();
    if (value.includes("combat level less than 20")) {
      return player.getSkillManager().getCombatLevel() < 20;
    }
    if (value.includes("lost the stake")) return !ownsStake(player);
    if (value.includes("has the stake")) return ownsStake(player);
    if (value.includes("does not have a beer")) return !hasItem(player, BEER_ITEM_ID);
    if (value.includes("has a beer")) return hasItem(player, BEER_ITEM_ID);
    return null;
  }

  function handleStartHook({ player, npcId, hook }) {
    if (!MORGAN_NPC_IDS.has(npcId) || hook !== QUEST_START_HOOK) return;
    if (quest.getStage(player) >= STAGE_STARTED) return;
    quest.setStage(player, STAGE_STARTED);
  }

  function handleDialogueAction(event) {
    if (!HARLOW_NPC_IDS.has(event.npcId)) return;
    const { player, stepId } = event;

    if (stepId === HARLOW_BEER_MESSAGE_ID) {
      if (!hasItem(player, BEER_ITEM_ID) || quest.getStage(player) !== STAGE_HARLOW) {
        event.handled = true;
        event.end = true;
        return;
      }
      player.getInventory().deleteNumber(BEER_ITEM_ID, 1);
      player.performAnimation(new Animation(3116));
      event.box = { items: [BEER_ITEM_ID] };
      return;
    }

    if (HARLOW_STAKE_MESSAGE_IDS.has(stepId)) {
      if (ownsStake(player) || quest.getStage(player) !== STAGE_HARLOW) { event.handled = true; return; }
      if (player.getInventory().isFull()) {
        player.sendMessage("You need a free inventory slot for the stake.");
        event.handled = true;
        event.end = true;
        return;
      }
      player.getInventory().adds(STAKE_ITEM_ID, 1);
      player.setAttribute(STAKE_RECEIVED_ATTRIBUTE, true);
      event.box = { items: [STAKE_ITEM_ID] };
      if (quest.getStage(player) < STAGE_HARLOW) quest.setStage(player, STAGE_HARLOW);
      // Transcript prints "Dr Harlow hands you a stake."
    }
  }

  function handleDialogueLine(event) {
    if (!HARLOW_NPC_IDS.has(event.npcId) || quest.getStage(event.player) !== STAGE_STARTED) return;
    if (event.text === "Huh? No, I don't think ssho. Now, buy ush a beer.") {
      event.after = () => quest.setStage(event.player, STAGE_HARLOW);
    }
  }

  function useGarlicCupboard(event) {
    if (!GARLIC_CUPBOARD_IDS.includes(event.objectId)) return false;
    const { object, player } = event;
    const action = object.getDefinition().getInteractions()[event.clickType - 1];
    if (action === "Search") {
      if (player.getInventory().isFull()) {
        player.sendMessage("You need a free inventory slot for the garlic.");
      } else {
        player.getInventory().adds(GARLIC_ITEM_ID, 1);
        player.sendMessage("The cupboard contains garlic. You take a clove.");
      }
    } else if (action === "Open" || action === "Close") {
      const id = action === "Open" ? ObjectIdentifiers.CUPBOARD_19 : ObjectIdentifiers.CUPBOARD_18;
      ObjectManager.deregister(object, true);
      ObjectManager.register(new GameObject(id, object.getLocation().clone(), object.getType(), object.getFace(), object.getPrivateArea()), true);
    }
    event.handled = true;
    return true;
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
    killer.performAnimation(new Animation(806));
    killer.sendMessage("<col=ff3045>You hammer the stake into the vampyre's chest!");
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
  api.persistAttribute(MORGAN_GREET_ATTR, false);
  api.persistAttribute(STAKE_RECEIVED_ATTRIBUTE, false);

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onObjectInteraction(useGarlicCupboard);
  api.onNpcBeforeDeath(handleNpcBeforeDeath);
  api.onNpcDeath(handleNpcDeath);
};
