// The trial masters (rsprox and their Wiki transcripts): Rum-dashed Ralph, Gurtob (with Ros, who
// does his talking) and Gwyna. Their form follows the trial's master_state: Talk-to only before
// the intro, Talk-to / Start-trial / Start-previous-rank after it, nothing during a run.
//   Talk-to plays their transcript (the first talk's intro, then the standard conversation),
//   with its conditions answered here. "I'd like to attempt the X." and Start-trial open the
//   rank selection; Start-previous-rank starts the last rank tried straight away.
//   Refusals (captured): the helm not manned ("You should make sure your helm is manned before
//   starting the trial."), crewmates aboard ("For this Barracuda Trial you are not allowed to
//   bring any crewmates.", then the crew management to clear them and the selection after).
//   Lost rank rewards are handed back ("X hands you a trial reward: Y."); Ralph gives two
//   whirlpool surprises after a first Shark rank.
//   Gwyna's transcript has only her first talk: later ones play the captured greeting ("Hello?"
//   / "Oh! Sorry, sailor, I didn't see you there.") and the same menu, its answers from the first.
// Ours: the Sailing level, Regicide and skiff checks on the right-click options and selection.
const common = require("./Common.BarracudaTrials");
const crewCommon = require("../crew/Common.Crew");
const selection = require("./Selection.BarracudaTrials");
const run = require("./Run.BarracudaTrials");

const HELM_NOT_MANNED = "You should make sure your helm is manned before starting the trial.";
const NO_CREW = "For this Barracuda Trial you are not allowed to bring any crewmates.";
const WHIRLPOOL_SURPRISE = 31811;
const FIRST_TALK = "first-talk-after-completing-pandemonium";
const GWYNA_REFUSAL = "when-spoken-to-from-land-or-from-a-boat-without-having-completed-regicide";

/** Players clearing their crew before a trial: the selection opens once crew management closes. */
const clearingCrew = new Map();

function core() {
  return common.core();
}

function aboard(player) {
  return core().Sailing.instanceAboard(player);
}

function atHelm(player) {
  const boat = aboard(player);
  return !!boat && boat.helmPlayerId === player.getIndex();
}

function hasCrew(player) {
  const boat = aboard(player);
  return !!boat && crewCommon.crewAboard(boat).length > 0;
}

function sailingLevel(player) {
  return player.getSkillManager().getMaxLevel(core().Skill.SAILING);
}

function questDone(player, key) {
  const request = { player, key, complete: false };
  common.api().emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

/** Ours: what stops a trial before any conversation (level, quest, boat). */
function refusal(player, trial) {
  if (sailingLevel(player) < trial.level) return `You require a Sailing level of ${trial.level} to take on the ${trial.name}.`;
  if (trial.quest && !questDone(player, trial.quest)) {
    return `You need to complete the Regicide quest to take part in the ${trial.name} Barracuda Trial.`;
  }
  const owned = core().Sailing.activeBoat(player);
  if (!aboard(player) || !owned) return undefined;
  if (owned.type !== "skiff") return "Only a skiff may take part in the Barracuda Trials.";
  const stats = require("../BoatParts.Sailing").boatStats(owned);
  const needs = trial.requires ?? {};
  if ((stats.stormResistance ?? 0) < (needs.stormResistance ?? 0)) return "Your boat's sails aren't strong enough to withstand the storm.";
  if ((stats.rapidResistance ?? 0) < (needs.rapidResistance ?? 0)) return "Your boat's helm isn't strong enough for the rapids here.";
  if ((stats.crystalFleckedResistance ?? 0) < (needs.crystalFleckedResistance ?? 0)) {
    return "Your boat's keel isn't strong enough for the crystal-flecked waters here.";
  }
  return undefined;
}

/** Who answers for the trial: Ros for Gurtob, else the master. */
function speaker(trial) {
  return trial.assistant?.npc ?? trial.master.npc;
}

function say(player, trial, text) {
  const { DialogueChainBuilder, NpcDialogue } = core();
  const npcId = speaker(trial);
  const name = trial.assistant?.name ?? trial.master.name;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new NpcDialogue(0, npcId, text, name)));
}

/** The trial's checks, then the selection (or the previous rank). */
function attempt(player, trial, { previous = false } = {}) {
  if (!atHelm(player)) return say(player, trial, HELM_NOT_MANNED);
  askEffects(player, trial, () => proceed(player, trial, { previous }));
}

/**
 * The Gwenith Glide's question before every attempt while its effects are on, unless told not to
 * ask (rsprox 936): "Yes." turns them off (settings_colourful_fade_disabled), so it isn't asked again.
 */
function askEffects(player, trial, next) {
  if (!trial.effectsPrompt) return next();
  const effectsOff = common.varbit("settings_colourful_fade_disabled");
  if (player.getPacketSender().getVarbit(effectsOff) === 1 || common.trialProgress(player, trial).extra?.dontAskEffects) return next();
  const { ActionDialogue, DialogueChainBuilder, StatementDialogue } = core();
  const answer = (off, dontAsk) => () => {
    // "Disable colourful fade effects" in All Settings: the same setting, saved with the others.
    if (off) common.api().emitCustomEvent("settings:set", { player, settingId: common.COLOURFUL_FADE_SETTING, value: 1 });
    if (dontAsk) common.updateProgress(player, trial, (saved) => { saved.extra = { ...saved.extra, dontAskEffects: true }; });
    next();
  };
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new StatementDialogue(0, "This Barracuda Trial uses full screen effects which may be distressing to some players."),
    new ActionDialogue(1, {
      execute: () => common.api().sendMultiChatboxPrompt(player, "Would you like to disable these effects?",
        "Yes.", answer(true, false), "Yes, and don't ask again.", answer(true, true),
        "No.", answer(false, false), "No, and don't ask again.", answer(false, true)),
    }),
  ));
}

function proceed(player, trial, { previous }) {
  if (hasCrew(player)) return refuseCrew(player, trial);
  const refused = refusal(player, trial);
  if (refused) return player.sendMessage(refused);
  const last = common.trialProgress(player, trial).previous;
  if (previous && last > 0 && common.rankBeaten(player, trial, last - 2)) return run.start(player, trial, last - 1);
  selection.openSelection(player, trial);
}

function refuseCrew(player, trial) {
  const { ActionDialogue, DialogueChainBuilder, NpcDialogue, PlayerDialogue } = core();
  const npcId = speaker(trial);
  const name = trial.assistant?.name ?? trial.master.name;
  const manager = player.getDialogueManager();
  manager.startDialogues(new DialogueChainBuilder().add(
    new NpcDialogue(0, npcId, NO_CREW, name),
    new ActionDialogue(1, { execute: () => crewMenu(player, trial, npcId, name) }),
  ));
}

function crewMenu(player, trial, npcId, name) {
  const { ActionDialogue, DialogueChainBuilder, NpcDialogue, PlayerDialogue } = core();
  const manager = player.getDialogueManager();
  common.api().sendMultiChatboxPrompt(player, "Select an option",
    "Can you help me transfer my crew away?", () => {
      // The crew management opens once "Yes, I suppose so." is continued past (rsprox 3461).
      manager.startDialogues(new DialogueChainBuilder().add(
        new PlayerDialogue(0, "Can you help me transfer my crew away?"),
        new NpcDialogue(1, npcId, "Yes, I suppose so.", name),
        new ActionDialogue(2, { execute: () => clearCrew(player, trial) }),
      ));
    },
    "I'll come back another time.", () => {
      manager.startDialogues(new DialogueChainBuilder().add(new PlayerDialogue(0, "I'll come back another time.")));
    });
}

function clearCrew(player, trial) {
  clearingCrew.set(player, trial);
  require("../crew/Registrar.Crew").openCrewManagement(player);
}

/** Owned anywhere (worn, carried or banked). */
function owns(player, itemId) {
  if (player.getInventory().contains(itemId)) return true;
  if (player.getEquipment?.().contains?.(itemId)) return true;
  try {
    const tab = core().Bank.getTabForItem(player, itemId);
    return tab >= 0 && player.getBank(tab).contains(itemId);
  } catch {
    return false;
  }
}

/** A rank reward the player earned and no longer has (a used key counts as had: ours). */
function lostReward(player, trial, rank) {
  const reward = common.ranksOf(trial)[rank].reward;
  return common.rankBeaten(player, trial, rank) && reward > 0 && !owns(player, reward);
}

function whirlpoolDue(player, trial) {
  return trial.key === "tempor_tantrum" && common.rankBeaten(player, trial, 2) && !common.trialProgress(player, trial).extra?.whirlpool;
}

function trialOf(npcId) {
  return common.trialByMaster(npcId) ?? common.trials.find((trial) => trial.assistant && [trial.assistant.npc, trial.assistant.npc + 1, trial.assistant.npc + 2].includes(npcId));
}

function selectVariant({ player, npcId }) {
  const trial = trialOf(npcId);
  if (!trial) return null;
  const page = trial.master.page;
  if (!crewCommon.pandemoniumDone(player) && trial.key === "tempor_tantrum") return { page, variant: "before-finishing-pandemonium" };
  if (trial.key === "gwenith_glide" && (sailingLevel(player) < trial.level || !questDone(player, trial.quest))) {
    return { page, variant: GWYNA_REFUSAL };
  }
  if (trial.key === "jubbly_jive" && !aboard(player)) return { page, variant: "while-on-land-standard-dialogue" };
  if (!common.trialProgress(player, trial).intro) {
    // The intro's lines; its tour of the course (Cutscene.BarracudaTrials.js) unlocks the trial.
    common.api().emitCustomEvent("barracuda-trials:intro", { player, trial });
    return { page, variant: FIRST_TALK };
  }
  return { page, variant: "subsequent-dialogue" };
}

/** Rank reward conditions by their item names ("If the player lost the barrel stand:"). */
function rewardCondition(player, trial, condition) {
  const ranks = common.ranksOf(trial);
  for (let rank = 1; rank <= 3; rank++) {
    const name = (core().CacheDefinitions.getItem(ranks[rank].reward)?.name ?? "").toLowerCase();
    if (name && condition.includes(name.toLowerCase())) return lostReward(player, trial, rank);
  }
  return null;
}

function answerCondition({ player, npcId, text }) {
  const trial = trialOf(npcId);
  if (!trial) return null;
  const condition = String(text ?? "").toLowerCase();
  const level = sailingLevel(player);
  let match;
  if ((match = /below (\d+) sailing|does not have (\d+) sailing/.exec(condition))) return level < Number(match[1] ?? match[2]);
  if ((match = /(\d+)\+ sailing/.exec(condition))) return level >= Number(match[1]);
  if (/regicide hasn't been completed/.test(condition)) return !questDone(player, "regicide");
  if (/is manning the helm/.test(condition)) return atHelm(player) && !hasCrew(player);
  if (/is not manning the helm/.test(condition)) return !atHelm(player);
  if (/has crewmates/.test(condition)) return atHelm(player) && hasCrew(player);
  if (/does not have any rewards to reclaim/.test(condition)) {
    return ![1, 2, 3].some((rank) => lostReward(player, trial, rank)) && !whirlpoolDue(player, trial);
  }
  if (/upon reaching shark rank/.test(condition)) return whirlpoolDue(player, trial);
  if (/lost/.test(condition)) return rewardCondition(player, trial, condition);
  return null;
}

/** The transcripts' interfaces and hand-outs. */
function onAction(event) {
  const trial = trialOf(event.npcId);
  if (!trial) return;
  const { player } = event;
  if (event.action === "open_interface" && event.target === `The ${trial.name}`) {
    event.handled = true;
    event.end = true;
    core().TaskManager.submit(new (core().CountdownTask)(player, 1, () => attempt(player, trial)));
    return;
  }
  if (event.action === "open_interface" && event.target === "Crew Management") {
    event.handled = true;
    event.end = true;
    core().TaskManager.submit(new (core().CountdownTask)(player, 1, () => clearCrew(player, trial)));
    return;
  }
  if (event.kind !== "message") return;
  const text = String(event.text ?? "");
  const reward = /hands you a trial reward: (.+)\.$/.exec(text);
  if (reward) {
    const item = common.ranksOf(trial).slice(1).map((rank) => rank.reward)
      .find((id) => core().CacheDefinitions.getItem(id)?.name === reward[1]);
    if (item) player.getInventory().addItem(new (core().Item)(item, 1));
    return;
  }
  if (/hands you two glasses of alcohol/.test(text)) {
    common.updateProgress(player, trial, (saved) => { saved.extra = { ...saved.extra, whirlpool: true }; });
    player.getPacketSender().sendVarbit(common.varbit("sailing_bt_tempor_tantrum_collected_whirlpool_surprise"), 1);
    player.getInventory().addItem(new (core().Item)(WHIRLPOOL_SURPRISE, 2));
  }
}

/** Gwyna after her first talk: the captured greeting and her menu, answered from the first talk. */
function gwynaTalk({ player, npc, npcId }) {
  const trial = common.trialByKey("gwenith_glide");
  if (!common.trialProgress(player, trial).intro || sailingLevel(player) < trial.level || !questDone(player, trial.quest)) return false;
  const request = {
    player, npc, npcId, variant: FIRST_TALK, exact: true, handled: false,
    select: (steps) => gwynaSteps(steps),
  };
  common.api().emitCustomEvent("npc-dialogue:start", request);
  return request.handled;
}

function gwynaSteps(firstTalk) {
  const choice = firstTalk.find((step) => step?.type === "choice");
  const option = (text) => choice?.options?.find((entry) => entry.text === text);
  const tipsAt = firstTalk.findIndex((step) => step?.player === "I see. Do you have any tips or tricks for me?");
  const tips = tipsAt >= 0 ? firstTalk.slice(tipsAt, firstTalk.indexOf(choice)) : [];
  const rewards = common.ranksOf(common.trialByKey("gwenith_glide")).slice(1).map((rank) => {
    const name = core().CacheDefinitions.getItem(rank.reward)?.name ?? "";
    return { type: "condition", text: `If the player lost ${name.toLowerCase()}:`, steps: [{ type: "message", text: `Gwyna hands you a trial reward: ${name}.` }] };
  });
  // The two menus (rsprox 936); "Previous options..." goes back, a few times over (the steps are a tree).
  const menu = (depth) => ({
    type: "choice",
    options: [
      { text: "I'd like to attempt the Gwenith Glide.", steps: [
        { player: "I'd like to attempt the Gwenith Glide." },
        { type: "action", action: "open_interface", target: "The Gwenith Glide" },
      ] },
      option("Can you tell me about the Gwenith Glide?"),
      { text: "Do you have any tips or tricks for me?", steps: [{ player: "Do you have any tips or tricks for me?" }, ...tips.slice(1)] },
      { text: "Do I have any rewards to claim?", steps: [
        { player: "Do I have any rewards to claim?" },
        { type: "condition", text: "If the player does not have any rewards to reclaim:", steps: [{ npc: "Sorry, but I don't have anything for you at the moment." }] },
        ...rewards,
      ] },
      { text: "More options...", steps: [{ type: "choice", options: [
        option("Who are you?"), option("Who are the Barracudas?"), option("I'd best be off."),
        depth > 0 ? { text: "Previous options...", steps: [menu(depth - 1)] } : undefined,
      ].filter(Boolean) }] },
    ].filter(Boolean),
  });
  return [
    { npc: "   " },
    { player: "Hello?" },
    { npc: "Oh! Sorry, sailor, I didn't see you there." },
    menu(3),
  ];
}

/** Start-trial (op3) and Start-previous-rank (op4) on a master. */
function startTrial({ player, npcId }) {
  const trial = trialOf(npcId);
  if (!trial) return false;
  run.stopBoat(player);
  attempt(player, trial);
  return true;
}

function startPrevious({ player, npcId }) {
  const trial = trialOf(npcId);
  if (!trial) return false;
  run.stopBoat(player);
  attempt(player, trial, { previous: true });
  return true;
}

function attach(api) {
  common.init(api);
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:action", onAction);
  for (const trial of common.trials) {
    api.onNpcInteraction(trial.master.name, { "Start-trial": startTrial, "Start-previous-rank": startPrevious });
  }
  api.onNpcInteraction("Gwyna", { "Talk-to": gwynaTalk });
  api.onCustomEvent("barracuda-trials:rank-chosen", rankChosen);
  api.onCustomEvent("interface:closed", crewCleared);
  api.onPlayerLogout(forget);
}

function rankChosen({ player, trial, rank }) {
  if (!atHelm(player)) return say(player, trial, HELM_NOT_MANNED);
  if (hasCrew(player)) return refuseCrew(player, trial);
  run.start(player, trial, rank);
}

/** The crew management closed after "Can you help me transfer my crew away?": the attempt again. */
function crewCleared({ player, interfaceId }) {
  const trial = clearingCrew.get(player);
  if (!trial || interfaceId !== 938) return;
  clearingCrew.delete(player);
  core().TaskManager.submit(new (core().CountdownTask)(player, 1, () => attempt(player, trial)));
}

function forget({ player }) {
  clearingCrew.delete(player);
}

module.exports = attach;
module.exports.attempt = attempt;
module.exports.refusal = refusal;
module.exports.answerCondition = answerCondition;
module.exports.selectVariant = selectVariant;
module.exports.gwynaSteps = gwynaSteps;
