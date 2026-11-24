/**
 * The Candle seller's 1,000-coin lit candle, through his OSRS Wiki transcript
 * (Transcript:Candle seller, also played by Death to the Dorgeshuun's tour stop).
 *
 * The transcript guards the sale with two coin conditions and has no hand-over step, so the
 * sale happens when the "has at least 1000 coins" branch is taken: rsprox captures (recordings
 * 75, 1000176, 1000216 and 1000359, rev 227 Leagues worlds) send the reduced coin stack and the
 * lit candle on the tick of "Here you go then.", and complete the league task on that tick too.
 *
 * Varbit swamp_candle_guy_conversation (284) goes 0 -> 1 as the menu after his naked-flame
 * warning opens: recording 1000216 shows the warning at tick 2967 and the varbit with the menu
 * at tick 2968, and in 1000176 the player walks off at the warning and it is never sent
 * (75 tick 11664 and 1000359 tick 6770 continue twice in one tick). The Wiki marks it on the
 * haggling menu after "One thousand gold?!" as well. Once set, the Wiki's "After learning
 * about lanterns" opening is played (no recording shows that menu).
 */
const NO_COINS_CONDITION = "If the player does not have 1000 coins:";
const HAS_COINS_CONDITION = "If the player has at least 1000 coins:";
/** One option of each menu that sets the varbit: after the warning, and after "One thousand gold?!". */
const CONVERSATION_MENU_OPTIONS = ["What's so dangerous about a naked flame?", "No way."];
const LEARNT_VARIANT = "after-learning-about-lanterns-from-the-candle-seller";
const CONVERSATION_ATTRIBUTE = "candle-seller:conversation";
const CONVERSATION_VARBIT = "swamp_candle_guy_conversation";
const LEAGUE_TASK = "buy-a-candle-in-lumbridge";
const CANDLE_PRICE = 1000;
let core, emit;

function isCandleSeller(event) {
  return event.npcId === core.NpcIdentifiers.CANDLE_SELLER;
}

function coinsOf(player) {
  return player.getInventory().getAmount(core.ItemIdentifiers.COINS);
}

function condition(event) {
  if (!isCandleSeller(event)) return null;
  if (event.text === NO_COINS_CONDITION) return coinsOf(event.player) < CANDLE_PRICE;
  if (event.text === HAS_COINS_CONDITION) return coinsOf(event.player) >= CANDLE_PRICE;
  return null;
}

function sellCandle(event) {
  if (!isCandleSeller(event) || event.text !== HAS_COINS_CONDITION) return;
  const player = event.player, inventory = player.getInventory(), coins = coinsOf(player);
  if (coins < CANDLE_PRICE) return;
  // Ours: no source covers a full backpack. Spending the whole stack frees its slot;
  // otherwise nothing is charged and the standard no-space message is sent.
  if (inventory.getFreeSlots() === 0 && coins > CANDLE_PRICE) { inventory.full(); return; }
  inventory.deleteNumber(core.ItemIdentifiers.COINS, CANDLE_PRICE);
  inventory.adds(core.ItemIdentifiers.LIT_CANDLE, 1);
  emit("league:complete-task", { player, id: LEAGUE_TASK });
}

function sendConversation(player) {
  const id = core.CacheDefinitions.getVarbitId(CONVERSATION_VARBIT);
  if (id != null) player.getPacketSender().sendVarbit(id, player.getAttribute(CONVERSATION_ATTRIBUTE) === true ? 1 : 0);
}

function markConversation(player) {
  if (player.getAttribute(CONVERSATION_ATTRIBUTE) === true) return;
  player.setAttribute(CONVERSATION_ATTRIBUTE, true);
  sendConversation(player);
}

function conversationMenu(notice) {
  if (!isCandleSeller(notice) || !notice.options.some((option) => CONVERSATION_MENU_OPTIONS.includes(option.text))) return;
  markConversation(notice.player);
}

function variant(event) {
  if (!isCandleSeller(event) || event.player.getAttribute(CONVERSATION_ATTRIBUTE) !== true) return null;
  return LEARNT_VARIANT;
}

function syncVarbit({ player }) {
  sendConversation(player);
}

function init(api) {
  core = api.core;
  emit = api.emitCustomEvent.bind(api);
}

module.exports = {
  name: "CandleSeller",
  description: "The Candle seller by the Lumbridge Swamp Caves sells a lit candle for 1,000 coins through his Talk-to dialogue.",
  members: true,
  register(api) {
    init(api);
    api.persistAttribute(CONVERSATION_ATTRIBUTE, false);
    api.onNpcDialogueCondition(condition);
    api.onNpcDialogueVariant(variant);
    api.onCustomEvent("npc-dialogue:condition", sellCandle);
    api.onCustomEvent("npc-dialogue:menu", conversationMenu);
    api.onPlayerLogin(syncVarbit);
  },
  _test: { CONVERSATION_ATTRIBUTE },
};
