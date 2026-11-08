// Chartin' Charles McAtless (rsprox 948; his Wiki transcript in npc-dialogues.json): in the
// Pandemonium's cave, he pays the bonuses for fully charted oceans (and for everything) as
// "training". His multinpc (15151) shows Get-training (1554) once the player has met him
// (sailing_charting_tutor_met, set here once anything is charted).
//   "Can you offer me some training?" (Talk-to) or Get-training: "Charles takes your charts and
//   shows them to his parrot."; nothing owed: "Sorry, but it doesn't look like you have anything
//   in here that I don't already know." and "The parrot glares at you."; owed but under the
//   ocean's level: "Yes, it looks like I can..." and "Oh, on second thoughts, ..."; otherwise
//   "Yes, it looks like I can...", one of his seven lectures over a fade, and "You are awarded
//   <col=0090bc>{xp}</col> Sailing XP for sharing charting information from the entire ocean!"
//   (rsprox 948: every owed bonus at once, 213,000), the owed variables back to 0.
const common = require("./Common.Charting");

const NPC_CHARLES = 15151;
const NPC_TRAINING_FORM = 1554;
const VARBIT_TUTOR_MET = 19571;
const VARP_XP_OWED = 5034;
const VARBIT_FULL_XP_OWED = 18571;
const FULL_LEVEL = 78;
const FADE_BACK_TICKS = 2;
const NAME = "Chartin' Charles McAtless";

/** His transcript's training branch: the condition steps and the lectures (message step ids). */
const CONDITION = Object.freeze({ NOTHING: "dx41Cr", TOO_LOW: "CDpkRB", OWED: "jBl-4T" });
const LECTURES = Object.freeze({
  oHHhft: "Charles gives a long-winded lecture on luffing.",
  "oF8Z-N": "Charles deep dives into the known history of mermaids.",
  zSb_fe: "Charles gives a refresher on the safe consumption of alcohol (through mouthfuls of grog).",
  U8GWIu: "Charles stops you in your tracks with his heavy analysis of anchor usage.",
  r_zOqs: "Charles tells you a tall tale about mast management.",
  "9vmpWg": "Charles spots you through some spyglass handling training.",
  q5tLEU: "Charles builds your confidence with a well constructed lesson on ship repairs.",
});

const CAPTAINS_LOG = 31985;
const NOTHING_CLAIMABLE = Object.freeze({ owed: false, oceans: [], full: false, xp: 0 });

/**
 * The bonuses the player may take now: owed oceans within their level, and everything charted. Wiki (Chartin' Charles,
 * Training): "You must have the captain's log in your inventory to receive the bonus XP" - without it nothing is paid,
 * and he gives his nothing-owed answer (no capture has a no-log line).
 */
function claimable(player) {
  if (!player.getInventory().contains(CAPTAINS_LOG)) return NOTHING_CLAIMABLE;
  const level = player.getSkillManager().getCurrentLevel(common.core().Skill.SAILING);
  const saved = common.progress(player);
  const seas = common.allSeas();
  const oceans = saved.owed.map((row) => seas.get(row)).filter((ocean) => ocean && !saved.paid.includes(ocean.row));
  const ready = oceans.filter((ocean) => level >= ocean.level);
  const full = saved.fullOwed && !saved.fullPaid;
  return {
    owed: oceans.length > 0 || full,
    oceans: ready,
    full: full && level >= FULL_LEVEL,
    xp: ready.reduce((sum, ocean) => sum + (common.DATA.oceanBonusXp[ocean.key] ?? 0), 0)
      + (full && level >= FULL_LEVEL ? common.DATA.fullBonusXp : 0),
  };
}

function answerCondition({ player, npcId, stepId }) {
  if (npcId !== NPC_CHARLES && npcId !== NPC_TRAINING_FORM && npcId !== 288) return null;
  const claim = claimable(player);
  if (stepId === CONDITION.NOTHING) return !claim.owed;
  if (stepId === CONDITION.TOO_LOW) return claim.owed && claim.xp === 0;
  if (stepId === CONDITION.OWED) return claim.xp > 0;
  return null;
}

/** A lecture's line: the screen fades, the bonuses are paid, the screen comes back. */
function onLecture(event) {
  if (!LECTURES[event.stepId]) return;
  pay(event.player);
}

function pay(player) {
  const claim = claimable(player);
  if (claim.xp <= 0) return;
  const content = require("../SailingContent.Sailing");
  content.fade(player, true);
  common.updateProgress(player, (saved) => {
    saved.paid = [...new Set([...saved.paid, ...claim.oceans.map((ocean) => ocean.row)])];
    saved.owed = saved.owed.filter((row) => !saved.paid.includes(row));
    if (claim.full) saved.fullPaid = true;
  });
  const sender = player.getPacketSender();
  let owedBits = sender.getVarp(VARP_XP_OWED);
  for (const ocean of claim.oceans) owedBits &= ~(1 << ocean.oceanId);
  sender.sendConfig(VARP_XP_OWED, owedBits);
  if (claim.full) sender.sendVarbit(VARBIT_FULL_XP_OWED, 0);
  player.sendMessage(`You are awarded <col=0090bc>${claim.xp.toLocaleString("en-US")}</col> Sailing XP for sharing charting information from the entire ocean!`);
  common.addXp(player, claim.xp);
  const { CountdownTask, TaskManager } = common.core();
  TaskManager.submit(new CountdownTask(null, FADE_BACK_TICKS, () => content.fade(player, false)));
}

/** Get-training: the transcript's training branch, without the menu. */
function getTraining({ player }) {
  const { DialogueChainBuilder, NpcDialogue, PlayerDialogue, StatementDialogue, ActionDialogue } = common.core();
  // The multinpc parent (15151) has no name or head: the lines speak as his visible form.
  const npcId = NPC_TRAINING_FORM;
  const claim = claimable(player);
  const chain = new DialogueChainBuilder();
  let i = 0;
  chain.add(new PlayerDialogue(i++, "Can you offer me some training?"));
  chain.add(new StatementDialogue(i++, "Charles takes your charts and shows them to his parrot."));
  if (!claim.owed) {
    chain.add(new NpcDialogue(i++, npcId, "Sorry, but it doesn't look like you have anything in here that I don't already know.", NAME));
    chain.add(new StatementDialogue(i++, "The parrot glares at you."));
  } else if (claim.xp === 0) {
    chain.add(new NpcDialogue(i++, npcId, "Yes, it looks like I can...", NAME));
    chain.add(new NpcDialogue(i++, npcId, "Oh, on second thoughts, it doesn't look like you have anything in here that I don't already know.", NAME));
  } else {
    const lectures = Object.values(LECTURES);
    const lecture = lectures[Math.floor(Math.random() * lectures.length)];
    chain.add(new NpcDialogue(i++, npcId, "Yes, it looks like I can...", NAME));
    chain.add(new ActionDialogue(i++, { execute: () => {
      pay(player);
      StatementDialogue.send(player, lecture);
    } }));
  }
  player.getDialogueManager().startDialogues(chain);
  return true;
}

function onLogin({ player }) {
  if (common.progress(player).charted.length > 0) player.getPacketSender().sendVarbit(VARBIT_TUTOR_MET, 1);
}

function onCharted({ player }) {
  player.getPacketSender().sendVarbit(VARBIT_TUTOR_MET, 1);
}

function attach(api) {
  common.init(api);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:action", onLecture);
  api.onCustomEvent("charting:complete", onCharted);
  api.onNpcInteraction(NAME, { "Get-training": getTraining });
  api.onPlayerLogin(onLogin);
}

module.exports = attach;
module.exports.claimable = claimable;
module.exports.answerCondition = answerCondition;
module.exports.getTraining = getTraining;
module.exports.pay = pay;
