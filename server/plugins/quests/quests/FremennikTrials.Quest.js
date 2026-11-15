/**
 * The Fremennik Trials (members).
 *
 * The words come from the "The Fremennik Trials" transcript page (npc-dialogues.json); this file
 * registers the quest, answers Brundt (start, votes, acceptance) and runs the single set of dialogue
 * listeners that ask each trial's unit in `../fremenniktrials/` (see State.FremennikTrials.js):
 *
 *   Reveller (Manni), Bard (Olaf), Merchant (Sigmund's trading chain), Navigator (Swensen's maze),
 *   Seer (Peer's house), Warrior (Thorvald and Koschei), Hunter (Sigli and the Draugen),
 *   Name (the Fremennik name given at the end).
 *
 * Behaviour follows the rsprox captures of the whole quest (1002236 rev 242; 1001646 rev 241 from
 * the third trial on; 1002250 and 1001364 for single trials): docs/fremennik-trials.md.
 *
 * Stages (varp 347, the real OSRS "viking" varp): 1 started, each passed trial advances a stage up
 * to 7, and Brundt's acceptance sets 8 (complete). The wire value is 1 + trials passed, and 10
 * once complete (`nativeProgress`).
 */
module.exports = function registerFremennikTrialsQuest(api) {
  const { Skill } = api.core;
  const { registerQuest, refreshQuestList } = require("../QuestRuntime");
  const { createFremennikTrialsState } = require("../fremenniktrials/State.FremennikTrials");

  const ctx = createFremennikTrialsState(api);
  const { NPC, T, STAGE_STARTED, STAGE_COMPLETE, VOTES_REQUIRED } = ctx;

  const START_HOOK = "quest:the-fremennik-trials:start";
  const BRUNDT_PROGRESS = "the-council-members-talking-to-brundt";
  // Brundt's "Talking to Brundt" record puts the seven-vote branch after its own `end`, so the
  // runner can never reach it; live plays the greeting, then that branch (1002236 t10284-10305).
  const BRUNDT_GREETING_THEN_ACCEPT = (steps) => [steps[0], ...ctx.stepsById("Ve_OpV")(steps)].filter(Boolean);
  const ACCEPT_STEP = "3gWp4j";
  const XP_EACH = 2812.4;
  const REWARD_SKILLS = [
    [Skill.AGILITY, "Agility"], [Skill.ATTACK, "Attack"], [Skill.CRAFTING, "Crafting"], [Skill.DEFENCE, "Defence"],
    [Skill.FISHING, "Fishing"], [Skill.FLETCHING, "Fletching"], [Skill.HITPOINTS, "Hitpoints"],
    [Skill.STRENGTH, "Strength"], [Skill.THIEVING, "Thieving"], [Skill.WOODCUTTING, "Woodcutting"],
  ];
  /** The scroll's model and reward lines (1002236 t10305, 1001646 t3508). */
  const SCROLL_ITEM = ctx.I.FREMENNIK_HELM;
  const SCROLL_LINES = [
    "3 Quest Points",
    "2,800 XP each in Strength,",
    "Defence, Attack, Hitpoints,",
    "Fishing, Thieving, Agility,",
    "Crafting, Fletching &",
    "Woodcutting",
  ];
  /** Live's completion jingle here is "quest complete 2" (1002236 t10305). */
  const COMPLETION_JINGLE = 153;
  /**
   * Rellekka's stalls before the quest: Steal-from shows a message box (rsprox 1001646 t1538 fish,
   * t1551 fur); the stall keeps its trader's distrust until the player is a Fremennik.
   */
  const STALL_DISTRUST = new Map([
    [api.core.ObjectIdentifiers.FISH_STALL, "The fishmonger is staring at you suspiciously. You cannot steal from<br>his stall while he distrusts you."],
    [api.core.ObjectIdentifiers.FUR_STALL_2, "The fur trader is staring at you suspiciously. You cannot steal from<br>his stall while he distrusts you."],
  ]);

  function brundtVariant(player, stage) {
    if (stage >= STAGE_COMPLETE) return null;
    if (stage <= 0) return "starting-off-talking-to-brundt-the-chieftain";
    return BRUNDT_PROGRESS;
  }

  /** Brundt on Sigmund's chain: the menu's "Ask about becoming a Fremennik" is his own vote count. */
  function brundtOffer(player) {
    return ctx.quest.isComplete(player) ? null : BRUNDT_PROGRESS;
  }

  function selectVariant({ npcId, player }) {
    if (!ctx.quest) return null;
    const stage = ctx.quest.getStage(player);
    for (const fn of ctx.registry.chain) {
      const variant = fn(player, stage, npcId);
      if (variant) return variant;
    }
    for (const { ids, fn } of ctx.registry.variants) {
      if (!ids.has(npcId)) continue;
      const variant = fn(player, stage, npcId);
      if (variant !== undefined) return variant;
    }
    if (NPC.BRUNDT.has(npcId)) return brundtVariant(player, stage);
    return null;
  }

  function answerCondition(event) {
    const { player, npcId, text } = event;
    if (!ctx.DIALOGUE_NPC_IDS.has(npcId)) return null;
    const value = String(text ?? "").toLowerCase();
    if (!value) return null;
    const query = { player, npcId, text, value };
    for (const fn of ctx.registry.conditions) {
      const answer = fn(query);
      if (answer !== null && answer !== undefined) return answer;
    }
    const votes = ctx.votesFor(player);
    if (value.includes("missing at least one requirement")) {
      return ctx.skill(player, Skill.WOODCUTTING) < 40 || ctx.skill(player, Skill.CRAFTING) < 40 ||
        ctx.skill(player, Skill.FLETCHING) < 25;
    }
    if (value.includes("has not gotten only one vote")) return votes === 1;
    if (value.includes("has gotten 2-6 votes")) return votes >= 2 && votes <= 6;
    if (value.includes("has gotten all 7 votes")) return votes >= VOTES_REQUIRED;
    if (value.includes("free-to-play world")) return false;
    if (value.includes("members' world")) return true;
    // Prose about what the player does next (uses, searches, climbs ...) is the units' business:
    // anything they leave is a branch that only plays when its action happens.
    if (/^if the player (uses|searches|shakes|studies|places|adds|enters|climbs|leaves|tries)/.test(value)) return false;
    return null;
  }

  function handleHook({ player, npcId, hook }) {
    if (!NPC.BRUNDT.has(npcId) || hook !== START_HOOK) return;
    if (ctx.quest.getStage(player) >= STAGE_STARTED) return;
    ctx.quest.setStage(player, STAGE_STARTED);
    // Live sends it with varp 0 -> 1 as "Yes." is chosen, before the player's line (1002236 t3169).
    player.sendMessage("You've started a new quest: <col=081190>The Fremennik Trials</col>");
  }

  /** The trial offer that "Ask about becoming a Fremennik" replays for a council member. */
  function offerFor(player, npcId) {
    for (const { ids, fn } of ctx.registry.offers) if (ids.has(npcId)) return fn(player);
    return null;
  }

  function handleChoice(event) {
    const { player, npcId, option } = event;
    if (!ctx.quest || ctx.quest.getStage(player) < STAGE_STARTED) return;
    const text = String(option ?? "").trim().toLowerCase();
    if (text.startsWith("ask about becoming a fremennik")) {
      const offer = offerFor(player, npcId);
      // The dump lost this option's {{tact|above}}: let its dead branch close the chatbox, then replay.
      if (offer) ctx.later(player, 1, () => ctx.play(player, npcId, offer.variant ?? offer, offer.select));
      return;
    }
    for (const fn of ctx.registry.choices) fn(event, text);
  }

  function handleConditionStep(event) {
    const fn = ctx.registry.conditionSteps.get(event.stepId);
    if (fn && event.player) fn(event);
  }

  function handleAction(event) {
    const { player, stepId } = event;
    if (!player) return;
    if (stepId === ACCEPT_STEP) {
      if (ctx.votesFor(player) >= VOTES_REQUIRED && !ctx.quest.isComplete(player)) ctx.quest.complete(player);
      event.handled = true;
      event.end = true;
      return;
    }
    const fn = ctx.registry.actions.get(stepId);
    if (fn) fn(event);
  }

  function handleLine(event) {
    // "I only have [2-6] votes so far.": the transcript's blank for the count.
    if (NPC.BRUNDT.has(event.npcId) && event.player && String(event.text ?? "").includes("[2-6]")) {
      event.text = event.text.split("[2-6]").join(String(ctx.votesFor(event.player)));
    }
    for (const fn of ctx.registry.lines) fn(event);
  }

  function handleNpcInteraction(event) {
    const { player, npcId } = event;
    if (event.clickType !== 1 || !NPC.BRUNDT.has(npcId)) return;
    if (ctx.votesFor(player) < VOTES_REQUIRED || ctx.quest.isComplete(player)) return;
    event.handled = true;
    api.emitCustomEvent("npc-dialogue:start", { player, npcId, variant: BRUNDT_PROGRESS, select: BRUNDT_GREETING_THEN_ACCEPT });
  }

  /** Thieving asks before a theft ("thieving:stall-access"); Rellekka's traders refuse outerlanders. */
  function refuseStall(access) {
    const text = STALL_DISTRUST.get(access.object?.getId?.());
    if (!text || access.refused || ctx.quest.isComplete(access.player)) return;
    access.refused = true;
    const { DialogueChainBuilder, StatementDialogue } = api.core;
    access.player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, text)));
  }

  function grantReward(player) {
    for (const [s] of REWARD_SKILLS) player.getSkillManager().addExperiences(s, XP_EACH);
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
  }

  const quest = registerQuest(api, {
    key: "fremennik_trials",
    name: "The Fremennik Trials",
    varpId: ctx.VARP,
    varpValue: ctx.nativeProgress,
    startedValue: STAGE_STARTED,
    completionValue: STAGE_COMPLETE,
    questPoints: 3,
    xpRewards: REWARD_SKILLS.map(([s, label]) => ({ skillId: s.getIndex(), amount: XP_EACH, label })),
    scrollItemId: SCROLL_ITEM,
    rewardText: SCROLL_LINES,
    completionJingleId: COMPLETION_JINGLE,
    buildJournal: (player, handle) => ctx.buildJournal(player, handle),
    onReward: grantReward,
  });
  ctx.setQuest(quest);
  ctx.offer(NPC.BRUNDT, brundtOffer);

  require("../fremenniktrials/Journal.FremennikTrials")(api, ctx);
  require("../fremenniktrials/Merchant.FremennikTrials")(api, ctx);
  require("../fremenniktrials/Reveller.FremennikTrials")(api, ctx);
  require("../fremenniktrials/Bard.FremennikTrials")(api, ctx);
  require("../fremenniktrials/Hunter.FremennikTrials")(api, ctx);
  require("../fremenniktrials/Navigator.FremennikTrials")(api, ctx);
  require("../fremenniktrials/Seer.FremennikTrials")(api, ctx);
  require("../fremenniktrials/Warrior.FremennikTrials")(api, ctx);
  require("../fremenniktrials/Name.FremennikTrials")(api, ctx);

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:hook", handleHook);
  api.onCustomEvent("npc-dialogue:choice", handleChoice);
  api.onCustomEvent("npc-dialogue:condition", handleConditionStep);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:line", handleLine);
  api.onNpcInteraction(handleNpcInteraction);
  api.onCustomEvent("thieving:stall-access", refuseStall);
  api.onPlayerLogin(handleLogin);
};
