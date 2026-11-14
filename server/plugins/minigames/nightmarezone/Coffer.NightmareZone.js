/**
 * Dominic's coffer, as recorded (rsprox 234/03279 [19614]-[19628],
 * [19726]-[19745]; nightmare-zone.json `coffer`):
 * - the coffer unlocks the first time the player steps into the enclosure (varbit
 *   nzone_moneypouch_unlocked; its Unlock option does the same);
 * - Use: "The coffer is empty." / "You have N coins stored in the coffer." beside a pile of coins,
 *   then "Dominic's Coffer (...)": Deposit money., Withdraw money. (once there is some), Cancel.;
 *   "How much do you wish to deposit? (coins carried)", in thousands (varbit nzone_cash);
 * - coins used on the coffer are not a deposit (the engine's "Nothing interesting happens.").
 * Not recorded: withdrawing (its prompt mirrors the deposit's) and a full coffer.
 */
const Common = require("./Common.NightmareZone");

const COINS = 995;

function unlocked(player) {
  return Number(player.getAttribute(Common.UNLOCKED_ATTRIBUTE)) === 1;
}

/** Recorded on the first step into the enclosure: the coffer's lock comes off, with a sound. */
function unlock(player) {
  if (unlocked(player)) return;
  player.setAttribute(Common.UNLOCKED_ATTRIBUTE, 1);
  Common.varbit(player, "nzone_moneypouch_unlocked", 1);
  player.getPacketSender().sendSound?.(Common.data.sounds.unlocked, 100, 0);
}

function icon(coins) {
  return Common.data.cofferIcons.find(([from]) => coins >= from)[1];
}

function useCoffer({ player }) {
  if (!unlocked(player)) unlock(player);
  const coins = Common.coffer(player);
  const text = coins > 0 ? Common.message("cofferHolds", { coins: Common.commas(coins) }) : Common.message("cofferEmpty");
  Common.talk(player, [["item", text, icon(coins)]], { done: () => cofferMenu(player) });
  return true;
}

function cofferMenu(player) {
  const coins = Common.coffer(player);
  const state = coins > 0 ? `${Common.commas(coins)} coins` : "Empty";
  const options = [["Deposit money.", () => deposit(player)]];
  if (coins > 0) options.push(["Withdraw money.", () => withdraw(player)]);
  options.push(["Cancel.", () => {}]);
  Common.choose(player, Common.message("cofferTitle", { state }), options);
}

function prompt(player, text, done) {
  player.setEnteredAmountAction?.({ execute: (amount) => done(Math.max(0, Math.floor(Number(amount) || 0))) });
  player.getPacketSender().sendEnterAmountPrompt(text);
}

/** Whole thousands only (the coffer counts in thousands), up to its 262,143,000. */
function deposit(player) {
  const inventory = player.getInventory();
  prompt(player, Common.message("depositPrompt", { have: Common.commas(inventory.getAmount(COINS)) }), (asked) => {
    const room = Common.data.coffer.max - Common.coffer(player);
    const amount = Math.floor(Math.min(asked, inventory.getAmount(COINS), room) / Common.data.coffer.unit) * Common.data.coffer.unit;
    if (room <= 0) player.sendMessage(Common.message("cofferFull"));
    if (amount <= 0) return;
    inventory.delete(COINS, amount);
    inventory.refreshItems?.();
    Common.setCoffer(player, Common.coffer(player) + amount);
    player.getPacketSender().sendSound?.(Common.data.sounds.deposited, 100, 0);
    cofferMenu(player);
  });
}

function withdraw(player) {
  prompt(player, Common.message("withdrawPrompt", { have: Common.commas(Common.coffer(player)) }), (asked) => {
    const inventory = player.getInventory();
    const carried = inventory.getAmount(COINS);
    const amount = Math.floor(Math.min(asked, Common.coffer(player), 2147483647 - carried) / Common.data.coffer.unit) * Common.data.coffer.unit;
    if (amount <= 0) return;
    if (carried === 0 && inventory.getFreeSlots() <= 0) return;
    Common.setCoffer(player, Common.coffer(player) - amount);
    inventory.add(new Common.core.Item(COINS, amount));
    inventory.refreshItems?.();
    player.getPacketSender().sendSound?.(Common.data.sounds.deposited, 100, 0);
    cofferMenu(player);
  });
}

function unlockOption({ player }) {
  unlock(player);
  return true;
}

function loggedIn({ player }) {
  Common.varbit(player, "nzone_cash", Math.floor(Common.coffer(player) / Common.data.coffer.unit));
  Common.varbit(player, "nzone_moneypouch_unlocked", unlocked(player) ? 1 : 0);
}

/** "group-ironman:wipe-tradeables" { player }: a leaver who stays a ranked Group Ironman loses the coins in Dominic's coffer (Wiki). */
function wipeForGroupIronman({ player }) {
  Common.setCoffer(player, 0);
}

function attachCoffer(api) {
  api.persistAttribute(Common.COFFER_ATTRIBUTE, 0);
  api.onCustomEvent("group-ironman:wipe-tradeables", wipeForGroupIronman);
  api.persistAttribute(Common.UNLOCKED_ATTRIBUTE, 0);
  api.onPlayerLogin(loggedIn);
  api.onObjectInteraction("Dominic's coffer", { Use: useCoffer, Unlock: unlockOption });
}

module.exports = { attachCoffer, unlock, unlocked, useCoffer, cofferMenu, deposit, withdraw };
