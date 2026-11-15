/**
 * TzHaar-Ket-Rak's talk: the Wiki transcript (data/definitions/npc-dialogues.json, played by the
 * NpcDialogues plugin), answered and filled in here:
 * - the initial dialogue until he has met the player, then the standard one. Meeting him sets
 *   jad_challenge_master_met, which turns him into the form with the Challenge option;
 * - "completed all six challenges", and the player's TzHaar name ("JalYt-[caste]-Xo-...");
 * - "Challenge interface opens." and the Challenge option open the challenge menu, the cache's
 *   generic option menu, with the transcript's titles;
 * - the minigame lines (completion, failure, refusals) with their numbers. As recorded (rsprox),
 *   "Now, a new challenge awaits." is said only when a challenge was just unlocked, and a failure
 *   with kills is answered "Not bad for a JalYt. Have some TokKul." before the same reward line.
 */
const Common = require("./Common.TzHaarKetRak");

const NAME = "TzHaar-Ket-Rak";
/** "Challenge interface opens." in the standard and repeat branches. */
const OPEN_MENU_STEPS = new Set(["2zA7bO", "ZZ7T7h"]);
const STEP = {
  reward: "HYLZao",
  sixthFirst: "xZPIyY",
  sixthAgain: "BBx8Ey",
  needPrevious: "e1Qm5P",
  needZuk: "HsSd1d",
};
const VARIANT = {
  initial: "initial-dialogue",
  failed: "minigame-dying-or-using-the-cave-exit-during-a-challenge",
  completed: "minigame-completing-a-challenge",
  sixthFirst: "minigame-completing-the-sixth-challenge-for-the-first-time",
  sixthAgain: "minigame-completing-the-sixth-challenge-subsequent-times",
  needPrevious: "attempting-to-enter-a-challenge-without-having-cleared-the-previous-one",
  needZuk: "attempting-to-enter-the-third-challenge-without-having-completed-the-inferno",
};
const MENU_TITLE = "Which challenge would you like?";
const COMPLETED_LINE = "Challenge complete. Have some TokKul. Now, a new challenge awaits.";
const NEW_CHALLENGE = " Now, a new challenge awaits.";
const MENU_SCRIPT = 217;
const MENU_OPTIONS_CHILD = 3;
const PAUSE_BUTTON_EVENTS = 1;

/** What the next minigame line fills in: { challenge, tokkul, unlocked, npcLine }. */
const pendingLines = new WeakMap();
const pendingMenus = new WeakMap();
let startChallenge = () => {};

const isKetRak = (definition) => definition?.getName?.() === NAME;

function met(player) {
  return player.getAttribute?.(Common.MET_ATTRIBUTE) === true;
}

function sendMet(player) {
  player.getPacketSender().sendVarbit(Common.ids.varbits.met, met(player) ? 1 : 0);
}

/** The initial dialogue the first time; meeting him shows his Challenge option from then on. */
function chooseVariant({ player, definition }) {
  if (!isKetRak(definition) || met(player)) return null;
  player.setAttribute(Common.MET_ATTRIBUTE, true);
  sendMet(player);
  return VARIANT.initial;
}

function answerCondition({ player, definition, text }) {
  if (!isKetRak(definition)) return null;
  const value = String(text).toLowerCase();
  if (value.includes("has not completed all six")) return !Common.completedAllSix(player);
  if (value.includes("has completed all six")) return Common.completedAllSix(player);
  return null;
}

/** "JalYt-[caste]-Xo-[player name]": the caste and honorific are the player's own (Wiki TzHaar). */
function fillLine(request) {
  if (!isKetRak(request.definition) || typeof request.text !== "string") return;
  if (request.text === COMPLETED_LINE) {
    const pending = pendingLines.get(request.player);
    request.text = pending?.npcLine ?? (pending?.unlocked ? COMPLETED_LINE : COMPLETED_LINE.replace(NEW_CHALLENGE, ""));
    return;
  }
  request.text = request.text.replace(/JalYt-\[caste\]-(?:Xo|Kal)-/g,
    `JalYt-${Common.caste(request.player)}-${Common.honorific(request.player)}-`);
}

function onAction(event) {
  if (!isKetRak(event.definition)) return;
  if (OPEN_MENU_STEPS.has(event.stepId)) {
    event.handled = true;
    event.end = true;
    // The conversation closes its window as it ends; the menu opens on the next tick.
    Common.later(1, () => openMenu(event.player));
    return;
  }
  if (event.kind !== "message") return;
  const pending = pendingLines.get(event.player);
  const tokkulBox = { items: [Common.ids.objs.tokkul] };
  switch (event.stepId) {
    case STEP.reward:
      event.text = String(event.text).replace("[number]", (pending?.tokkul ?? 0).toLocaleString("en-GB"));
      event.box = tokkulBox;
      break;
    case STEP.sixthFirst:
    case STEP.sixthAgain:
      event.text = String(event.text).replace("[7,430/14,860]", (pending?.tokkul ?? 0).toLocaleString("en-GB"));
      event.box = tokkulBox;
      break;
    case STEP.needPrevious: {
      const challenge = pending?.challenge ?? 2;
      event.text = String(event.text)
        .replace("[Previous number]", Common.ordinal(challenge - 1))
        .replace("[Number]", Common.ordinal(challenge));
      event.box = { statement: true };
      break;
    }
    case STEP.needZuk:
      event.box = { statement: true };
      break;
    default:
  }
}

/** Plays one of his minigame lines; `fill` is what its numbers are. */
function say(player, variant, fill = {}) {
  pendingLines.set(player, fill);
  Common.api.emitCustomEvent("npc-dialogue:start", {
    player, npcId: Common.ids.npcs.masterTalk, variant, exact: true, handled: false,
  });
}

/**
 * The cache's generic option menu ("menu", script 217): title, "a|b|c", numbered. The Infinite
 * Challenge follows the Sixth, with the label the recordings send, only once the Sixth is completed
 * (Wiki transcript; rsprox_transcripts/237/01161.txt: the menu before the first Sixth ends at it,
 * the one after lists the Infinite Challenge next).
 */
function openMenu(player) {
  const labels = Common.data.ordinals.map((ordinal) => `${NAME}'s ${ordinal} Challenge`);
  const infinite = Common.completions(player, Common.SIX) > 0;
  if (infinite) labels.push(Common.data.infinite.menuLabel);
  labels.push("(Cancel)");
  const sender = player.getPacketSender();
  const menu = Common.ids.menu;
  sender.sendInterfaceRemoval();
  sender.sendInterface(menu);
  sender.sendClientScript(MENU_SCRIPT, 1, MENU_TITLE, labels.join("|"));
  sender.sendInterfaceFlagsRange((menu << 16) | MENU_OPTIONS_CHILD, 0, labels.length - 1, PAUSE_BUTTON_EVENTS);
  pendingMenus.set(player, { count: labels.length, infinite });
}

function chooseOption(event) {
  if (event.groupId !== Common.ids.menu || event.childId !== MENU_OPTIONS_CHILD) return;
  const menu = pendingMenus.get(event.player);
  if (menu === undefined) return;
  event.handled = true;
  pendingMenus.delete(event.player);
  if (event.player.getInterfaceId?.() !== Common.ids.menu) return;
  const index = event.slot ?? event.action;
  event.player.getPacketSender().sendInterfaceRemoval();
  if (Number.isInteger(index) && index >= 0 && index < Common.SIX) startChallenge(event.player, index + 1);
  else if (index === Common.SIX && menu.infinite) startChallenge(event.player, Common.INFINITE);
}

function closeMenu({ player }) {
  pendingMenus.delete(player);
}

/** The Challenge option: straight to the menu. */
function challengeOption({ player }) {
  openMenu(player);
  return true;
}

function onLogin({ player }) {
  sendMet(player);
}

function attach(api, { start }) {
  startChallenge = start;
  api.persistAttribute(Common.MET_ATTRIBUTE, false);
  api.onNpcDialogueVariant(chooseVariant);
  api.onNpcDialogueCondition(answerCondition);
  api.onCustomEvent("npc-dialogue:line", fillLine);
  api.onCustomEvent("npc-dialogue:action", onAction);
  api.onNpcInteraction(NAME, { Challenge: challengeOption });
  api.onInterfaceActionClick(chooseOption);
  api.onCustomEvent("interface:close", closeMenu);
  api.onPlayerLogout(closeMenu);
  api.onPlayerLogin(onLogin);
}

module.exports = {
  attach, say, openMenu, chooseOption, chooseVariant, answerCondition, fillLine, onAction, VARIANT, STEP, OPEN_MENU_STEPS,
};
