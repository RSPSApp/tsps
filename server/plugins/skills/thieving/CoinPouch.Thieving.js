/**
 * Coin pouches from pickpocketing (Wiki: Coin pouch): left-click opens the whole stack, right-click
 * opens one. Each kind holds the coins its target's pouch is listed with in pickpocketing.json.
 *
 * rsprox captures (recordings 2601, 3059 and others): Open-all says "You open all of the pouches and
 * receive a total of N coins." as a spam message with synth 2115, even for a single pouch. Open
 * (one pouch) isn't captured and keeps its own line.
 */
const { pouchCoins, POUCH_COINS } = require("./Pickpocket.Thieving");

const OPEN_SOUND = 2115;
/** Not captured: the coins would not fit. */
const NO_SPACE = "You don't have enough inventory space.";

let core;
let api;

/** The coins opening `count` pouches pays, or null when the stack must not be opened. */
function pouchOpen(player, pouchId, count) {
  // A right-click Open sends 0 when the last pouch just left; that is not the no-space refusal.
  if (!POUCH_COINS.has(pouchId) || count <= 0) return null;
  let coins = 0;
  for (let i = 0; i < count; i++) coins += pouchCoins(pouchId);
  // The coins must fit, or they'd vanish: into the coin stack or a free slot, or the slot the pouches free when
  // the whole stack is opened (one pouch left in its stack frees nothing).
  const inventory = player.getInventory();
  const COINS = core.ItemIdentifiers.COINS;
  const freesSlot = inventory.getAmount(pouchId) <= count && inventory.getAmount(COINS) === 0;
  if (!freesSlot && inventory.getAddableAmount(new core.Item(COINS, coins)) < coins) return null;
  return { count, coins };
}

/** Opens the pouches; true when the coins were paid (a refusal leaves the stack and credits nothing). */
function open(player, pouchId, count, all = false) {
  const opened = pouchOpen(player, pouchId, count);
  if (!opened) {
    if (count > 0 && POUCH_COINS.has(pouchId)) player.sendMessage(NO_SPACE);
    return false;
  }
  const { coins } = opened;
  player.getInventory().delete(pouchId, count);
  player.getInventory().adds(core.ItemIdentifiers.COINS, coins);
  // "coin-pouch:opened" { player, coins, all, pouches }: the coins the pouch(es) actually paid and how many
  // opened. Only a completed open reaches here, so a league's "Open 28 Coin Pouches at once" cannot credit a
  // refused Open-all; the coins still serve "Obtain 800 Coins From Coin Pouches At Once".
  api.emitCustomEvent("coin-pouch:opened", { player, coins, all, pouches: count });
  if (!all) {
    player.sendMessage(`You open the pouch and find ${coins} coins.`);
    return true;
  }
  player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, `You open all of the pouches and receive a total of ${coins.toLocaleString("en-US")} coins.`);
  player.getPacketSender().sendSound(OPEN_SOUND, 1, 0);
  return true;
}

function openAll(event) {
  // Handled only when the pouches really opened: a refused Open-all is no deed ("Open 28 Coin Pouches at once").
  event.handled = open(event.player, event.itemId, event.player.getInventory().getAmount(event.itemId), true);
}

function openOne(event) {
  event.handled = open(event.player, event.itemId, 1);
}

function register(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  api.onItemAction("Coin pouch", { "Open-all": openAll, Open: openOne });
}

module.exports = { register, _test: { open, pouchOpen } };
