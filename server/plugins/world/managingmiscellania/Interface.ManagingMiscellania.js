"use strict";

/**
 * The kingdom interface (misc_both_manage, an IF1 interface): its cs1 scripts draw each job's
 * bar from the misc_points_* varbits, the idle bar from varp 261, the fish, hardwood and herb
 * choices from misc_cooked / misc_rarewood_type / misc_herbs_or_flax and the help text from
 * varp 262; the server writes the coffer amount into its text and shows the Etceterian jobs
 * (hardwood, farm) after Royal Trouble.
 *
 * Add/Remove move a subject between the idle pool and a job (at most 10 on one job, 10 or 15
 * subjects in all). Deposit and Withdraw take an amount, with Advisor Ghrim's lines from the
 * Wiki transcript; the coffers hold 5,000,000 (7,500,000 after Royal Trouble).
 *
 * Wiki: https://oldschool.runescape.wiki/w/Managing_Miscellania,
 * https://oldschool.runescape.wiki/w/Transcript:Advisor_Ghrim
 */

const Common = require("./Common.ManagingMiscellania");

const GROUP = 391; // misc_both_manage
const uid = (child) => (GROUP << 16) | child;

const COMPONENT = {
  coffer: 92,
  deposit: 93,
  withdraw: 94,
  help: 99,
  hardwoodPanel: 139,
  farmPanel: 141,
};
/** [add, remove] per job, as the interface places them. */
const BUTTONS = {
  mine: [11, 12],
  herbs: [27, 28],
  wood: [45, 46],
  fish: [61, 62],
  hardwood: [116, 117],
  farm: [143, 144],
};
const COOKED_TOGGLE = [111, 112];
const HARDWOOD_TYPE = { 128: 0, 131: 0, 129: 1, 132: 1, 130: 2, 133: 2 };
const HERBS_OR_FLAX = { 155: false, 156: false, 157: true, 158: true };
const VARP_IDLE = 261;
const VARP_HELP = 262;
const ETCETERIAN_JOBS = new Set(["hardwood", "farm"]);

function formatCoins(amount) {
  return Math.max(0, amount | 0).toLocaleString("en-GB");
}

/** Every bar, choice and the coffer text, as the interface's scripts read them. */
function refresh(player, kingdom) {
  const sender = player.getPacketSender();
  const v = Common.varbits();
  const rt = Common.royalTrouble(player);
  for (const job of Common.JOBS) sender.sendVarbit(v.workers[job], kingdom.workers[job] | 0);
  sender.sendVarbit(v.coffers, Math.min(kingdom.coffer, (1 << 27) - 1));
  sender.sendVarbit(v.cooked, kingdom.cooked ? 1 : 0);
  sender.sendVarbit(v.hardwoodType, kingdom.hardwoodType | 0);
  sender.sendVarbit(v.herbsOrFlax, kingdom.flax ? 1 : 0);
  sender.sendVarbit(v.resourceTotal, Math.min(Common.DATA.resourcePointCap, kingdom.points | 0));
  sender.sendConfig(VARP_IDLE, Common.limits(rt).workers - Common.workersBusy(kingdom));
  sender.sendString(formatCoins(kingdom.coffer), uid(COMPONENT.coffer));
  sender.sendInterfaceDisplayState(uid(COMPONENT.hardwoodPanel), !rt);
  sender.sendInterfaceDisplayState(uid(COMPONENT.farmPanel), !rt);
}

/**
 * Opens in place of Ghrim's chat: the chatbox closes as the interface opens, which also ends
 * the conversation so transcript playback can't close the interface again.
 */
function open(player) {
  const kingdom = Common.catchUp(player);
  if (!kingdom) return false;
  // The Bank PIN guards this (Wiki: Bank_PIN); a locked PIN asks first, then reopens it.
  const pin = { player, feature: "miscellania", resume: () => open(player) };
  Common.getApi().emitCustomEvent("bank-pin:guard", pin);
  if (pin.locked) return true;
  player.getPacketSender().sendInterfaceRemoval();
  player.getPacketSender().sendConfig(VARP_HELP, 0);
  refresh(player, kingdom);
  player.getPacketSender().sendInterface(GROUP);
  return true;
}

function isOpen(player) {
  return player.getInterfaceId?.() === GROUP;
}

/** A subject moves from idle to the job (add) or back (remove). */
function move(player, job, add) {
  if (!Common.ruler(player)) return;
  const rt = Common.royalTrouble(player);
  if (ETCETERIAN_JOBS.has(job) && !rt) return;
  const kingdom = Common.kingdomOf(player);
  const on = kingdom.workers[job] | 0;
  if (add) {
    if (on >= Common.DATA.workers.perJob || Common.workersBusy(kingdom) >= Common.limits(rt).workers) return;
    kingdom.workers[job] = on + 1;
  } else {
    if (on <= 0) return;
    kingdom.workers[job] = on - 1;
  }
  Common.save(player, kingdom);
  refresh(player, kingdom);
}

function setChoice(player, change) {
  if (!Common.ruler(player)) return;
  const kingdom = Common.kingdomOf(player);
  change(kingdom);
  Common.save(player, kingdom);
  refresh(player, kingdom);
}

// --- Coffers

function deposit(player) {
  if (!Common.ruler(player)) return;
  const coins = Common.items().COINS;
  const carried = player.getInventory().getAmount(coins);
  if (carried <= 0) {
    player.sendMessage("You aren't carrying any coins.");
    return;
  }
  player.sendMessage(`You are carrying ${formatCoins(carried)} coins. Enter an amount to deposit in the coffers.`);
  player.setEnteredAmountAction({ execute: (amount) => depositAmount(player, amount) });
  player.getPacketSender().sendEnterAmountPrompt("Enter amount:");
}

function depositAmount(player, amount) {
  const kingdom = Common.catchUp(player);
  if (!kingdom || !(amount > 0) || !isOpen(player)) return;
  const coins = Common.items().COINS;
  const room = Common.limits(Common.royalTrouble(player)).cofferMax - kingdom.coffer;
  const paid = Math.min(Math.floor(amount), player.getInventory().getAmount(coins), Math.max(0, room));
  if (paid <= 0) {
    player.sendMessage("The coffers cannot hold any more coins.");
    open(player);
    return;
  }
  player.getInventory().deleteNumber(coins, paid);
  kingdom.coffer += paid;
  Common.save(player, kingdom);
  open(player);
}

function withdraw(player) {
  const kingdom = Common.catchUp(player);
  if (!kingdom) return;
  if (kingdom.coffer <= 0) {
    player.sendMessage("There are no coins to withdraw.");
    return;
  }
  player.sendMessage(`The coffers contain ${formatCoins(kingdom.coffer)} coins. Enter an amount to withdraw from the coffers.`);
  player.setEnteredAmountAction({ execute: (amount) => withdrawAmount(player, amount) });
  player.getPacketSender().sendEnterAmountPrompt("Enter amount:");
}

function withdrawAmount(player, amount) {
  const kingdom = Common.catchUp(player);
  if (!kingdom || !(amount > 0) || !isOpen(player)) return;
  const coins = Common.items().COINS;
  const inventory = player.getInventory();
  const carried = inventory.getAmount(coins);
  const fits = carried > 0 || inventory.getFreeSlots() > 0 ? 2147483647 - carried : 0;
  const taken = Math.min(Math.floor(amount), kingdom.coffer, fits);
  if (taken <= 0) {
    player.sendMessage("You don't have enough inventory space.");
    open(player);
    return;
  }
  kingdom.coffer -= taken;
  inventory.addItem(new (Common.getCore().Item)(coins, taken));
  Common.save(player, kingdom);
  open(player);
}

function onOpenRequest(request) {
  if (request?.player && open(request.player)) request.opened = true;
}

function toggleHelp(player) {
  const sender = player.getPacketSender();
  sender.sendConfig(VARP_HELP, sender.getVarp(VARP_HELP) === 1 ? 0 : 1);
}

/** Every button on the interface, by component. */
function onButton(event) {
  const child = event.buttonId & 0xffff;
  if ((event.buttonId >>> 16) !== GROUP) return false;
  const player = event.player;
  if (!isOpen(player)) return true;
  for (const [job, [addId, removeId]] of Object.entries(BUTTONS)) {
    if (child === addId) return move(player, job, true), true;
    if (child === removeId) return move(player, job, false), true;
  }
  if (COOKED_TOGGLE.includes(child)) return setChoice(player, (k) => { k.cooked = !k.cooked; }), true;
  if (child in HARDWOOD_TYPE) return setChoice(player, (k) => { k.hardwoodType = HARDWOOD_TYPE[child]; }), true;
  if (child in HERBS_OR_FLAX) return setChoice(player, (k) => { k.flax = HERBS_OR_FLAX[child]; }), true;
  if (child === COMPONENT.deposit) return deposit(player), true;
  if (child === COMPONENT.withdraw) return withdraw(player), true;
  if (child === COMPONENT.help) return toggleHelp(player), true;
  return false;
}

const ALL_BUTTONS = [
  ...Object.values(BUTTONS).flat(), ...COOKED_TOGGLE, ...Object.keys(HARDWOOD_TYPE).map(Number),
  ...Object.keys(HERBS_OR_FLAX).map(Number), COMPONENT.deposit, COMPONENT.withdraw, COMPONENT.help,
].map(uid);

module.exports = function registerInterface(api) {
  Common.bind(api);
  api.onInterfaceActionButton(ALL_BUTTONS, onButton);
  api.onCustomEvent("miscellania:open", onOpenRequest);
};

module.exports.open = open;
module.exports.refresh = refresh;
module.exports.isOpen = isOpen;
module.exports._test = {
  GROUP, COMPONENT, BUTTONS, VARP_IDLE, uid, refresh, open, move, deposit, depositAmount, withdraw,
  withdrawAmount, onButton, formatCoins,
};
