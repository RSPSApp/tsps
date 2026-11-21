/**
 * Murder Mystery (members), aligned with four whole runs of the quest on live: the user's RSProx capture
 * MurderMystery.bin (revision 242, Frank the murderer) and local recordings 1001551, 1001958 (David) and
 * 1001930 (Carol); docs/quests/murder-mystery/README.md has every capture fact the plugin relies on, with
 * the recordings' ticks. The words are the Wiki's: the "Murder Mystery" transcript, with the lines it
 * lacks added from these captures in osrsreboxed-db's capture-sources.json, and the Pierre page after
 * the quest.
 *
 * The units in plugins/quests/murdermystery/: State (stages, varps, ids, suspects), Journal, Evidence
 * (the window, the dagger and pot, barrels, sacks, gate, flour, flypaper and prints) and Poison (the
 * salesman, the Sinclairs' stories and the places they used the poison).
 *
 * Every message of the quest's conversations and boxes is a messagebox, as live sends them, except the
 * Wiki's {{mes}} lines (State.MESSAGE_STEPS, MESSAGE_VARIANT), which are chat messages.
 *
 * Rewards (the capture's scroll, t2248; the Wiki): 3 Quest points, 1,406 Crafting XP and 2,000 coins;
 * the guard takes the evidence with them (live: a line earlier, t2247).
 */
module.exports = function registerMurderMysteryQuest(api) {
  const { Skill, ItemIdentifiers: I, CountdownTask, TaskManager } = api.core;
  const { registerQuest, refreshQuestList, startTranscript, giveReward } = require("../QuestRuntime");
  const {
    STAGES, VARPS, PAGE, ATTRIBUTES, EVIDENCE, POISON, NPCS, SERVANTS, SUSPECTS, MESSAGE_STEPS, MESSAGE_VARIANT, STEPS,
  } = require("../murdermystery/State.MurderMystery");
  const { journal } = require("../murdermystery/Journal.MurderMystery");

  const GUARDS = new Set([NPCS.GUARD, NPCS.HOUSE_GUARD]);
  const SERVANT_FRAGMENT = new Map(SERVANTS);
  const SUSPECT_BY_NPC = new Map(SUSPECTS.flatMap((suspect) => suspect.npcs.map((npcId) => [npcId, suspect])));
  /** The family and the inside guard spawn as cache ids 6194-6200 with empty names: no transcript reaches them by name. */
  const MANSION_MULTIS = [NPCS.HOUSE_GUARD, ...SUSPECTS.map((suspect) => suspect.npcs[1])];
  const SERVANTS_WITH_SNUB = new Set([NPCS.DONOVAN, NPCS.PIERRE, NPCS.HOBBES, NPCS.LOUISA, NPCS.STANFORD]);
  const PIERRE_AFTER = { page: "Pierre", variant: "standard-dialogue-after-murder-mystery" };
  /** quest_scroll's model (t2248: murderweapon, zoom 400) and title. */
  const SCROLL_TITLE = "You have solved the Murder Mystery!";
  const QUEST_COMPLETE_2_JINGLE = 153;

  /** Evidence the guard takes at the hand-in (t2247: everything the player still carries). */
  const EVIDENCE_ITEM_IDS = [
    I.CRIMINALS_DAGGER, I.CRIMINALS_DAGGER_2, I.CRIMINALS_THREAD, I.CRIMINALS_THREAD_2, I.CRIMINALS_THREAD_3,
    I.UNKNOWN_PRINT, I.KILLERS_PRINT, ...SUSPECTS.flatMap((suspect) => [I[suspect.item], I[`${suspect.item}_2`], I[suspect.print]]),
    I.PUNGENT_POT, I.FLYPAPER,
  ];

  let quest;

  const attr = (player, key) => Number(player.getAttribute(key)) || 0;
  const setAttr = (player, key, value) => player.setAttribute(key, value);
  const stage = (player) => quest.getStage(player);
  const murderer = (player) => SUSPECTS[(attr(player, ATTRIBUTES.MURDERER) || 1) - 1] ?? SUSPECTS[0];
  const has = (player, itemId) => player.getInventory().getAmount(itemId) > 0;

  /** The variant of this page a dialogue event belongs to, or null. */
  function variantOf(event) {
    if (event?.playing?.page === PAGE) return event.playing.variant ?? null;
    const entry = Array.isArray(event?.pages) ? event.pages.find((candidate) => candidate?.page === PAGE) : null;
    return entry?.variants?.length === 1 ? entry.variants[0] : null;
  }

  /** Plays one variant of the page (objects and items: the guard carries it, as King's Ransom's window does). */
  const play = (player, variant, npcId = NPCS.GUARD) => startTranscript(api, player, npcId, PAGE, variant);

  function later(player, ticks, callback) {
    TaskManager.submit(new CountdownTask(player, ticks, callback));
  }

  const ctx = { stage, attr, setAttr, murderer, play, later, variantOf };
  const evidence = require("../murdermystery/Evidence.MurderMystery")(api, ctx);
  require("../murdermystery/Poison.MurderMystery")(api, ctx);

  function sendMurdererVarp(player) {
    const id = attr(player, ATTRIBUTES.MURDERER);
    player.getPacketSender().sendConfig(VARPS.MURDERER, id >= 1 && id <= SUSPECTS.length ? id : 0);
  }

  /** What the guard takes: the thread and the killer's print (the Wiki: the rest may be dropped once matched). */
  function hasHandInEvidence(player) {
    return has(player, murderer(player).thread) && has(player, I.KILLERS_PRINT);
  }

  function conclusiveEvidence(player) {
    const found = attr(player, ATTRIBUTES.EVIDENCE);
    return (found & EVIDENCE.THREAD) !== 0 && (found & EVIDENCE.FINGERPRINTS) !== 0
      && attr(player, ATTRIBUTES.POISON) >= POISON.PROOF;
  }

  function anyEvidence(player) {
    return attr(player, ATTRIBUTES.EVIDENCE) !== 0 || attr(player, ATTRIBUTES.POISON) >= POISON.PROOF;
  }

  function buildJournal(player) {
    return journal(player, stage(player), STAGES);
  }

  function grantReward(player) {
    player.getSkillManager().addExperiences(Skill.CRAFTING, 1406);
    giveReward(player, I.COINS, 2000);
  }

  // ---- Talking -------------------------------------------------------------------------------

  /** `npc`: the house guard is a multi of the courtyard guard (6194 -> 4218), told apart by its own id. */
  function guardVariant(player, npcId, npc) {
    const current = stage(player);
    if (current >= STAGES.COMPLETE) {
      return (npc?.getId?.() ?? npcId) === NPCS.GUARD
        ? "post-quest-talking-to-the-guard-outside-the-mansion-after-the-quest"
        : "post-quest-talking-to-the-guard-after-the-quest";
    }
    if (current < STAGES.STARTED) return "getting-started-talking-to-guard";
    if (conclusiveEvidence(player) && hasHandInEvidence(player)) return "presenting-the-evidence-talking-to-the-guard-with-all-evidence";
    // Proof, not just progress: banked or dropped evidence still has the guard hear what was found.
    if (anyEvidence(player)) return "presenting-the-evidence-talking-to-the-guard-with-some-but-not-all-evidence";
    return "getting-started-talking-to-the-guard-after-starting-the-quest";
  }

  function selectVariant({ npcId, player, npc }) {
    if (GUARDS.has(npcId)) return guardVariant(player, npcId, npc);
    const suspect = SUSPECT_BY_NPC.get(npcId);
    const fragment = suspect?.fragment ?? SERVANT_FRAGMENT.get(npcId) ?? (npcId === NPCS.GOSSIP ? "gossip" : null);
    if (!fragment) return null;
    const current = stage(player);
    if (current === STAGES.STARTED) {
      // Once the salesman has named the buyers everyone has the poison question (Gossip has none).
      if (npcId !== NPCS.GOSSIP && attr(player, ATTRIBUTES.POISON) >= POISON.SALESMAN) {
        return `visiting-the-poison-salesman-talking-to-${fragment}-after-learning-about-the-poison`;
      }
      return `questioning-the-inhabitants-talking-to-${fragment}`;
    }
    if (current >= STAGES.COMPLETE) {
      // Gossip after the quest is King's Ransom's ("Oh, I remember you.", t2430).
      if (npcId === NPCS.GOSSIP) return null;
      if (npcId === NPCS.PIERRE) return PIERRE_AFTER;
      return `post-quest-talking-to-${fragment}-after-the-quest`;
    }
    if (SERVANTS_WITH_SNUB.has(npcId)) return `before-starting-talking-to-${fragment}`;
    if (suspect) return suspect.son ? "before-starting-talking-to-frank-david-or-bob" : "before-starting-talking-to-anna-carol-mary-or-elizabeth";
    if (npcId === NPCS.MARY) return "before-starting-talking-to-anna-carol-mary-or-elizabeth";
    return null;
  }

  /** The mansion multis: their empty cache names reach no page, so play the variant for them. */
  function talkInMansion(event) {
    const variant = selectVariant(event);
    if (typeof variant !== "string") return false;
    if (startTranscript(api, event.player, event.npcId, PAGE, variant, null, event.npc) === false) return false;
    event.handled = true;
    return true;
  }

  // ---- Conditions ----------------------------------------------------------------------------

  function answerCondition(event) {
    const { player } = event;
    const ours = GUARDS.has(event.npcId) || SUSPECT_BY_NPC.has(event.npcId) || SERVANT_FRAGMENT.has(event.npcId)
      || event.npcId === NPCS.POISON_SALESMAN || variantOf(event) !== null;
    if (!player || !ours) return null;
    const value = String(event.text ?? "").toLowerCase();
    const culprit = murderer(player);
    const colour = /^if the criminal's thread (is|isn't) (red|green|blue)/.exec(value);
    if (colour) return (culprit.colour === colour[2]) === (colour[1] === "is");
    // The guard's evidence menu: each option shows only for evidence the player has found.
    if (value.startsWith("if the player has the thread evidence")) return (attr(player, ATTRIBUTES.EVIDENCE) & EVIDENCE.THREAD) !== 0;
    if (value.startsWith("if the player has poison evidence")) return attr(player, ATTRIBUTES.POISON) >= POISON.PROOF;
    if (value.startsWith("if the player has fingerprint evidence")) return (attr(player, ATTRIBUTES.EVIDENCE) & EVIDENCE.FINGERPRINTS) !== 0;
    if (value.startsWith("if bob, david or frank is the murderer")) return culprit.son;
    if (value.startsWith("if anna, carol or elizabeth is the murderer")) return !culprit.son;
    const who = /^if (anna|bob|carol|david|elizabeth|frank) is (the murderer|innocent)/.exec(value);
    if (who) return (culprit.fragment === who[1]) === (who[2] === "the murderer");
    return evidence.answer(player, value);
  }

  // ---- Start, boxes and the hand-in ----------------------------------------------------------

  /** The murderer is chosen at random when the quest starts (the Wiki; the captures' 6, 4, 4 and 3). */
  function startQuest({ player, npcId, hook }) {
    if (!GUARDS.has(npcId) || hook !== "quest:murder-mystery:start" || stage(player) !== STAGES.NOT_STARTED) return;
    setAttr(player, ATTRIBUTES.MURDERER, 1 + Math.floor(Math.random() * SUSPECTS.length));
    setAttr(player, ATTRIBUTES.POISON, POISON.NONE);
    setAttr(player, ATTRIBUTES.EVIDENCE, 0);
    setAttr(player, ATTRIBUTES.STORIES, 0);
    quest.setStage(player, STAGES.STARTED);
    sendMurdererVarp(player);
  }

  const proven = (player) => stage(player) === STAGES.STARTED && conclusiveEvidence(player) && hasHandInEvidence(player);

  /** "You hand over all the evidence.": the proof is checked again; lost on the way, the guard stops there. */
  function handOver(event) {
    if (!proven(event.player)) event.end = true;
  }

  /**
   * The completion step: the proof once more, then the evidence goes and the quest completes together.
   * Ours: live takes the evidence one line earlier, as "You hand over all the evidence." is continued
   * (t2247); taking it here means a chat closed on "Please accept this reward" keeps both.
   */
  function complete(player) {
    if (!proven(player)) return;
    const inventory = player.getInventory();
    for (const itemId of EVIDENCE_ITEM_IDS) {
      const amount = inventory.getAmount(itemId);
      if (amount > 0) inventory.deleteNumber(itemId, amount);
    }
    setAttr(player, ATTRIBUTES.MURDERER, 0);
    setAttr(player, ATTRIBUTES.POISON, POISON.NONE);
    setAttr(player, ATTRIBUTES.EVIDENCE, 0);
    setAttr(player, ATTRIBUTES.STORIES, 0);
    sendMurdererVarp(player);
    quest.complete(player);
  }

  function handleAction(event) {
    const variant = variantOf(event);
    if (!variant || !event.player) return;
    if (event.stepId === STEPS.COMPLETE) return complete(event.player);
    if (event.kind !== "message") return;
    if (!MESSAGE_VARIANT.test(variant) && !MESSAGE_STEPS.has(event.stepId)) event.box = { statement: true };
    if (event.stepId === STEPS.HAND_OVER) return handOver(event);
    evidence.onMessage(event, variant);
  }

  /** The guard's evidence menu with one piece of evidence goes straight to it (the Wiki's note; t1074-1075). */
  function evidenceMenu(notice) {
    if (!GUARDS.has(notice.npcId) || !notice.options?.some((option) => option.text === "I have proof that it wasn't any of the servants.")) return;
    notice.direct = true;
  }

  function handleLogin({ player }) {
    refreshQuestList(player);
    sendMurdererVarp(player);
  }

  function handleBootstrap({ player }) {
    sendMurdererVarp(player);
  }

  quest = registerQuest(api, {
    key: "murder_mystery",
    name: "Murder Mystery",
    varpId: VARPS.QUEST,
    startedValue: STAGES.STARTED,
    completionValue: STAGES.COMPLETE,
    questPoints: 3,
    xpRewards: [{ skillId: Skill.CRAFTING.getIndex(), amount: 1406, label: "Crafting" }],
    rewardItemLabel: "2,000 Coins",
    scrollItemId: I.CRIMINALS_DAGGER,
    scrollTitle: SCROLL_TITLE,
    completionJingleId: QUEST_COMPLETE_2_JINGLE,
    buildJournal,
    onReward: grantReward,
  });

  api.persistAttribute(ATTRIBUTES.MURDERER, 0);
  api.persistAttribute(ATTRIBUTES.EVIDENCE, 0);
  api.persistAttribute(ATTRIBUTES.POISON, 0);
  api.persistAttribute(ATTRIBUTES.STORIES, 0);

  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onNpcFirstClick(MANSION_MULTIS, talkInMansion);
  api.onCustomEvent("npc-dialogue:hook", startQuest);
  api.onCustomEvent("npc-dialogue:action", handleAction);
  api.onCustomEvent("npc-dialogue:menu", evidenceMenu);
  api.onPlayerLogin(handleLogin);
  api.onCustomEvent("player:bootstrap-complete", handleBootstrap);
};
