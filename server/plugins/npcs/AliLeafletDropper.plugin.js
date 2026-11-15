/**
 * Ali the Leaflet Dropper (Al Kharid, by the north gate) and his Al kharid flyer
 * (docs/ali-leaflet-dropper.md):
 * - Take-flyer hands a flyer over with two lines (rsprox.net rec 3172 tick 807).
 * - Talk-to's "Which shops?" branch gives one through the Wiki transcript's three flyer
 *   conditions and its "receive" action.
 * - The flyer's Read shows it in an object box, then a message box: the voucher is out of date
 *   (rec 3172 tick 1454).
 */
const PAGE = "Ali the Leaflet Dropper";
const ALI = 5956; // ali_leaflet_dropper
const FLYER = 7922; // leaflet_dropper_flyer "Al kharid flyer"

/** The transcript's "receive" step that hands the flyer over. */
const RECEIVE_STEP = "WQ9ux6";
const CONDITION_GIVE = "If the player does not have an Al kharid flyer:";
const CONDITION_HAS = "If the player already has an Al kharid flyer:";
const CONDITION_FULL = "If the player has a full inventory:";

/** Take-flyer, rec 3172 tick 807 (head anims chatbored1, then chatquiz3 two ticks later). */
const TAKE_LINES = [
  ["Here! Take one and let me get back to work.", 562],
  ["I still have hundreds of these flyers to hand out, I wonder if Ali would notice if I quietly dumped them somewhere?", 556],
];
/**
 * Ours: Take-flyer with a flyer already held or a full backpack is not captured; these are the
 * Talk-to transcript's lines for the same two cases.
 */
const HAS_LINE = "Are you trying to be funny or has age turned your brain to mush? Look at the flyer you already have!";
const FULL_LINE = "I'd give you a flyer but it looks like your hands are full. Come back when you have space for my flyer.";

/** Read, rec 3172 tick 1454: the object box's text with live's line breaks, then the message box. */
const FLYER_TEXT = [
  "<col=000080>Come to the Al Kharid Market place! High quality",
  "<col=000080>produce at low, low prices! Show this flyer to a",
  "<col=000080>merchant for money off your next purchase, courtesy",
  "<col=000080>of Ali Morrisane!",
].join("<br>");
const OUT_OF_DATE = "You notice that the money off voucher is out of date.";

let core;

/** Ours: only a flyer in the backpack counts as held; neither source says about the bank. */
function hasFlyer(player) {
  return player.getInventory().contains(FLYER);
}

function hasRoom(player) {
  return player.getInventory().getFreeSlots() > 0;
}

function isAli(event) {
  return event.npcId === ALI && event.pages?.some(({ page }) => page === PAGE);
}

/** The three sibling flyer conditions: the first true one plays. */
function dialogueCondition(event) {
  if (!isAli(event)) return null;
  const { player } = event;
  if (event.text === CONDITION_GIVE) return !hasFlyer(player) && hasRoom(player);
  if (event.text === CONDITION_HAS) return hasFlyer(player);
  if (event.text === CONDITION_FULL) return !hasFlyer(player) && !hasRoom(player);
  return null;
}

function receiveFlyer(event) {
  if (event.action !== "receive" || event.stepId !== RECEIVE_STEP || !isAli(event)) return;
  event.handled = true;
  // The backpack could have changed since the condition was answered.
  if (hasFlyer(event.player) || !hasRoom(event.player)) {
    event.steps = [{ npc: hasFlyer(event.player) ? HAS_LINE : FULL_LINE }, { type: "end" }];
    return;
  }
  event.player.getInventory().addItem(new core.Item(FLYER, 1));
}

function npcLines(npcId, lines) {
  const chain = new core.DialogueChainBuilder();
  lines.forEach(([text, anim], index) => chain.add(new core.NpcDialogue(index, npcId, text, undefined, anim)));
  return chain;
}

/** Take-flyer: the flyer goes in on the click tick, with the first line (rec 3172 tick 807). */
function takeFlyer({ player, npc }) {
  const npcId = npc?.getId?.() ?? ALI;
  let lines;
  if (hasFlyer(player)) lines = [[HAS_LINE]];
  else if (!hasRoom(player)) lines = [[FULL_LINE]];
  else {
    player.getInventory().addItem(new core.Item(FLYER, 1));
    lines = TAKE_LINES;
  }
  player.getDialogueManager().startDialogues(npcLines(npcId, lines));
  return true;
}

/** Read: the flyer in an object box, then the out-of-date message box. Nothing is used up. */
function readFlyer({ player, itemId }) {
  if (itemId !== FLYER) return false;
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder()
    .add(new core.ItemStatementDialogue(0, FLYER, FLYER_TEXT))
    .add(new core.StatementDialogue(1, OUT_OF_DATE)));
  return true;
}

module.exports = {
  name: "AliLeafletDropper",
  description: "Ali the Leaflet Dropper in Al Kharid hands out the Al kharid flyer (Take-flyer and his Talk-to), and the flyer can be read.",
  _test: { takeFlyer, readFlyer, dialogueCondition, receiveFlyer, FLYER_TEXT, OUT_OF_DATE, TAKE_LINES, HAS_LINE, FULL_LINE },
  register(api) {
    core = api.core;
    api.onNpcInteraction(PAGE, { "Take-flyer": takeFlyer });
    api.onNpcDialogueCondition(dialogueCondition);
    api.onCustomEvent("npc-dialogue:action", receiveFlyer);
    api.onItemAction("Al kharid flyer", { Read: readFlyer });
  },
};
