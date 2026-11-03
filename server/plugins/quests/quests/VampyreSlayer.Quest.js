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

  const REGENERATE_HITPOINTS = 20;
  const HEAL_HITSPLAT = 6;

  let quest;

  function later(ticks, action) {
    const { TaskManager, CountdownTask } = api.core;
    TaskManager.submit(new CountdownTask(null, ticks, action));
  }

  const hasItem = (player, itemId) => player.getInventory().getAmount(itemId) > 0;

  const ownsStake = (player) => hasItem(player, STAKE_ITEM_ID) ||
    (player.getBanks?.() ?? []).some((bank) => bank?.getAmount?.(STAKE_ITEM_ID) > 0);

  const r = (text) => `<col=800000>${text}</col>`;
  const JOURNAL_SPOKE_TO_MORGAN = `I spoke to ${r("Morgan")} at his home in ${r("Draynor Village")}. He told me about ${r("Count Draynor")}, a vampyre living in ${r("Draynor Manor")} north of the village. At his request, I agreed to try and kill ${r("Count Draynor")}. ${r("Morgan")} suggested I begin by seeking out ${r("Dr Harlow")}, a retired vampyre hunter, at the ${r("Blue Moon Inn")} in ${r("Varrock")}.`;
  const JOURNAL_FOUND_HARLOW = `I travelled to the ${r("Blue Moon Inn")} in ${r("Varrock")} and found ${r("Dr Harlow")}.`;
  const JOURNAL_GOT_STAKE = `${JOURNAL_FOUND_HARLOW} He told me that vampyres are hard to kill due to their ability to regenerate. However, he gave me a ${r("Stake")} and told me I could use it to prevent the regeneration.`;
  const JOURNAL_GARLIC = `${r("Dr Harlow")} also suggested I carry some ${r("Garlic")} on me. ${r("Morgan")} might have some.`;

  /** Word-wrap journal prose to the journal's width; colour tags take no space. */
  function wrap(text, strike = false) {
    const visible = (value) => value.replace(/<[^>]*>/g, "").length;
    const lines = [];
    let line = "";
    for (const word of text.split(" ")) {
      if (line && visible(line) + 1 + visible(word) > 58) { lines.push(line); line = word; }
      else line = line ? `${line} ${word}` : word;
    }
    if (line) lines.push(line);
    return strike ? lines.map((value) => `<str>${value.replace(/<[^>]*>/g, "")}</str>`) : lines;
  }

  // Transcript:Vampyre_Slayer/Journal (the 30 June 2026 rewrite).
  function buildJournal(player, questHandle) {
    const stage = questHandle.getStage(player);
    if (stage >= STAGE_COMPLETE) {
      return [
        ...wrap(JOURNAL_SPOKE_TO_MORGAN, true), "",
        ...wrap(JOURNAL_GOT_STAKE, true), "",
        ...wrap("I entered Draynor Manor and found Count Draynor in the basement. However, I was able to use the Stake that Dr Harlow gave me to kill him for good.", true), "",
        "<col=ff0000>QUEST COMPLETE!</col>",
      ];
    }
    if (stage >= STAGE_HARLOW && player.getAttribute(STAKE_RECEIVED_ATTRIBUTE) === true) {
      const hunt = `I'll now need to head to ${r("Draynor Manor")}, find ${r("Count Draynor")} and kill him.`;
      const tools = ownsStake(player)
        ? `I should make sure to take the ${r("Stake")} with me, along with a ${r("Hammer")}. Most ${r("General Stores")} should stock a ${r("Hammer")}.`
        : `I should make sure to take the ${r("Stake")} with me. If I lose it, I'll need to ask ${r("Dr Harlow")} for another. I'll also need a ${r("Hammer")}. Most ${r("General Stores")} should stock one.`;
      return [...wrap(JOURNAL_SPOKE_TO_MORGAN, true), "", ...wrap(`${JOURNAL_GOT_STAKE} ${hunt} ${tools} ${JOURNAL_GARLIC}`)];
    }
    if (stage >= STAGE_HARLOW) {
      return [
        ...wrap(JOURNAL_SPOKE_TO_MORGAN, true), "",
        ...wrap(`${JOURNAL_FOUND_HARLOW} However, he doesn't seem willing to talk to me unless I buy him a ${r("Beer")} first.`),
      ];
    }
    if (stage >= STAGE_STARTED) return wrap(JOURNAL_SPOKE_TO_MORGAN);
    return wrap(`I can start this quest by talking to ${r("Morgan")} at his home in ${r("Draynor Village")}.`);
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
    // The start menu shows this as a box (warnBeforeStart), so the transcript's line is skipped.
    if (value.includes("combat level less than 20")) return false;
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
    player.sendMessage("You've started a new quest: <col=081190>Vampyre Slayer</col>");
  }

  /** rsprox 1718: below combat 20 a blocking box comes before "Start the Vampyre Slayer quest?". */
  function warnBeforeStart(event) {
    if (String(event.prompt).includes("Start the Vampyre Slayer quest") &&
        (event.player.getSkillManager().getCombatLevel?.() ?? 20) < 20) {
      event.warning = "Before starting this quest, be aware that your combat level is lower than the recommended level of 20.";
    }
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
    if (hasStake && hasHammer) {
      // rsprox 3275, 1710: the message and the hammering come the tick after the last hit,
      // with the Count's death animation; completion follows with the death (onNpcDeath).
      later(1, () => {
        killer.sendMessage("<col=ff3045>You hammer the stake into the vampyre's chest!");
        killer.performAnimation(new Animation(806));
      });
      return;
    }
    if (hasStake) killer.sendMessage("<col=ff3045>You're unable to push the stake far enough in!");
    killer.sendMessage("<col=ff3045>The vampyre seems to regenerate!");
    // rsprox 1710 (125231): a heal hitsplat of 20, not a full heal.
    const healed = Math.min(REGENERATE_HITPOINTS, npc.getMaxHitpoints?.() ?? npc.getDefinition().getHitpoints());
    npc.setHitpoints(healed);
    npc.showHitsplat?.(healed, { mine: HEAL_HITSPLAT, others: HEAL_HITSPLAT });
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
    completionJingleId: 154,
    buildJournal,
    onReward: reward,
  });
  api.persistAttribute(MORGAN_GREET_ATTR, false);
  api.persistAttribute(STAKE_RECEIVED_ATTRIBUTE, false);

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleStartHook);
  api.onCustomEvent("npc-dialogue:menu", warnBeforeStart);
  api.onCustomEvent("npc-dialogue:action", handleDialogueAction);
  api.onCustomEvent("npc-dialogue:line", handleDialogueLine);
  api.onObjectInteraction(useGarlicCupboard);
  api.onNpcBeforeDeath(handleNpcBeforeDeath);
  api.onNpcDeath(handleNpcDeath);
};
