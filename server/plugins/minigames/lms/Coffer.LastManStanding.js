/**
 * The coffer and the reward chest, as captured where recorded:
 * - the coffer (Use): an object box with coins, "The coffer is empty. You need at least 1,000
 *   coins to make a deposit." (nothing to deposit) or "The coffer is empty." then the menu
 *   "Coffer (Empty)": Deposit money. / Cancel.; with coins in it "You have 500,000 coins stored in
 *   the coffer." and "Coffer (500,000 coins)": Withdraw money. / Cancel.; "How much do you wish to
 *   deposit? (500,000)", "How much do you wish to withdraw? (500,000 coins)"; varbit br_coffer in
 *   thousands. Wiki: in steps of 1,000 up to 262,143,000;
 * - the reward chest (Claim): "You have nothing to claim." Wiki: High Stakes winnings wait in it.
 * - High Stakes (Wiki): 500,000 from the coffer to play, a free next game for 3rd to 5th.
 * Inferred: the claim and prize lines; with coins to deposit and some stored, the menu offers both.
 */
const Common = require("./Common.LastManStanding");
const Profile = require("./Profile.LastManStanding");

const STEP = 1000;
const MAX = 262143000;
/** The most of one item a stack holds. */
const MAX_STACK = 2147483647;
const coinId = () => Common.core.ItemIdentifiers.COINS;

function amountPrompt(player, text, done) {
  player.setEnteredAmountAction({ execute: (amount) => done(Math.max(0, Math.floor(Number(amount) || 0))) });
  player.getPacketSender().sendEnterAmountPrompt(text);
}

function refreshed(player) {
  require("./Lobby.LastManStanding").refreshOverlay(player);
}

function deposit(player) {
  const inventory = player.getInventory();
  const held = inventory.getAmount(coinId());
  amountPrompt(player, Common.message("deposit", { max: held.toLocaleString("en-GB") }), (amount) => {
    const room = MAX - Profile.coffer(player);
    const coins = Math.min(room, inventory.getAmount(coinId()), Math.floor(amount / STEP) * STEP);
    if (coins < STEP) return;
    inventory.delete(coinId(), coins);
    inventory.refreshItems();
    Profile.setCoffer(player, Profile.coffer(player) + coins);
    refreshed(player);
    menu(player);
  });
}

function withdraw(player) {
  const stored = Profile.coffer(player);
  amountPrompt(player, Common.message("withdraw", { max: stored.toLocaleString("en-GB") }), (amount) => {
    const inventory = player.getInventory();
    // What the coin stack can still hold, in steps of 1,000; the coffer keeps the rest.
    const room = Math.floor((MAX_STACK - inventory.getAmount(coinId())) / STEP) * STEP;
    // The balance now, not when the prompt opened: a High Stakes fee may have been paid from it since.
    const coins = Math.min(Profile.coffer(player), Math.floor(amount / STEP) * STEP, room);
    if (coins < STEP) {
      if (room < STEP && amount >= STEP) player.sendMessage(Common.message("noRoom"));
      return;
    }
    if (!inventory.contains(coinId()) && inventory.getFreeSlots() <= 0) {
      player.sendMessage(Common.message("noRoom"));
      return;
    }
    Profile.setCoffer(player, Profile.coffer(player) - coins);
    inventory.add(new Common.core.Item(coinId(), coins), true);
    refreshed(player);
    menu(player);
  });
}

function menu(player) {
  const stored = Profile.coffer(player);
  const canDeposit = player.getInventory().getAmount(coinId()) >= STEP;
  if (stored <= 0) {
    Common.api.sendMultiChatboxPrompt(player, "Coffer (Empty)", "Deposit money.", () => deposit(player), "Cancel.", () => {});
    return;
  }
  const title = `Coffer (${stored.toLocaleString("en-GB")} coins)`;
  if (canDeposit) {
    Common.api.sendMultiChatboxPrompt(player, title, "Deposit money.", () => deposit(player), "Withdraw money.", () => withdraw(player), "Cancel.", () => {});
  } else {
    Common.api.sendMultiChatboxPrompt(player, title, "Withdraw money.", () => withdraw(player), "Cancel.", () => {});
  }
}

/** An object box with coins (captured: coins_10000 with coins stored, coins_1000 when empty). */
function box(player, line, done) {
  const { DialogueChainBuilder, ItemStatementDialogue, ActionDialogue } = Common.core;
  const chain = new DialogueChainBuilder();
  const shown = Common.objId(Profile.coffer(player) > 0 ? "coins_10000" : "coins_1000");
  chain.add(new ItemStatementDialogue(0, shown, line));
  chain.add(new ActionDialogue(1, {
    execute: () => {
      player.getDialogueManager().reset();
      player.getPacketSender().sendInterfaceRemoval();
      done?.();
    },
  }));
  player.getDialogueManager().startDialogues(chain);
}

function use({ player }) {
  const stored = Profile.coffer(player);
  const canDeposit = player.getInventory().getAmount(coinId()) >= STEP;
  const amount = stored.toLocaleString("en-GB");
  const line = stored <= 0
    ? Common.message(canDeposit ? "cofferEmpty" : "cofferEmptyDeposit")
    : Common.message(canDeposit ? "cofferHas" : "cofferHasDeposit", { amount });
  box(player, line, stored <= 0 && !canDeposit ? null : () => menu(player));
  return true;
}

// ---------------------------------------------------------------- High Stakes

function freeEntry(player) {
  return player.getAttribute(Common.ATTRIBUTES.freeHighStakes) === true;
}

function canPay(player, fee) {
  return freeEntry(player) || Profile.coffer(player) >= fee;
}

/** The fee as the game starts: a free entry first, else from the coffer. */
function pay(player, fee) {
  if (freeEntry(player)) {
    player.setAttribute(Common.ATTRIBUTES.freeHighStakes, false);
    return true;
  }
  if (Profile.coffer(player) < fee) return false;
  Profile.setCoffer(player, Profile.coffer(player) - fee);
  return true;
}

function award(player, coins) {
  Common.add(player, Common.ATTRIBUTES.winnings, coins);
  player.sendMessage(Common.message("prize", { amount: coins.toLocaleString("en-GB") }));
}

function grantFreeEntry(player) {
  player.setAttribute(Common.ATTRIBUTES.freeHighStakes, true);
  player.sendMessage(Common.message("freeEntry"));
}

function claim({ player }) {
  const coins = Common.number(player, Common.ATTRIBUTES.winnings);
  if (coins <= 0) {
    player.sendMessage(Common.message("nothingToClaim"));
    return true;
  }
  const inventory = player.getInventory();
  if (!inventory.contains(coinId()) && inventory.getFreeSlots() <= 0) {
    player.sendMessage(Common.message("noRoomCoins"));
    return true;
  }
  const room = MAX_STACK - inventory.getAmount(coinId());
  const taken = Math.min(coins, room);
  player.setAttribute(Common.ATTRIBUTES.winnings, coins - taken);
  inventory.add(new Common.core.Item(coinId(), taken), true);
  player.sendMessage(Common.message("claimed", { amount: taken.toLocaleString("en-GB") }));
  return true;
}

/** "group-ironman:wipe-tradeables" { player }: a leaver who stays a ranked Group Ironman loses the coins in the coffer (Wiki). */
function wipeForGroupIronman({ player }) {
  Profile.setCoffer(player, 0);
}

function attachCoffer(api) {
  api.persistAttribute(Common.ATTRIBUTES.winnings, 0);
  api.onCustomEvent("group-ironman:wipe-tradeables", wipeForGroupIronman);
  api.persistAttribute(Common.ATTRIBUTES.freeHighStakes, false);
  api.onObjectFirstClick([Common.locId("br_coffer")], use);
  api.onObjectFirstClick([Common.locId("br_reward_chest")], claim);
}

module.exports = { attachCoffer, use, menu, withdraw, claim, canPay, pay, award, grantFreeEntry, freeEntry, wipeForGroupIronman };
