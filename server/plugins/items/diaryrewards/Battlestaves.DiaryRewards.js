/**
 * Zaff's barrel (Wiki: Varrock Diary rewards): once a day, one stack of noted battlestaves at
 * 7,000 coins each - 15 / 30 / 60 / 120 by the highest tier claimed from Toby. As captured (rsprox
 * archive 3216, rev 232): the barrel's first option checks the room (a message box), then offers
 * the price in a message box and Yes./No.; Yes. re-checks the coins, takes them, hands over the
 * noted stack, plays the pick-up animation and sets varbit zaff_last_claimed.
 *
 * The barrel is a multiloc on that varbit (cache: 0 shows the full barrel with Claim-staves, 1 the
 * empty one with no options), so a player who stays online must see 0 again at 00:00 UTC (Wiki,
 * 23 July 2025: no relog needed). No capture shows that reset; sending 0 then is from the Wiki and
 * the cache. Each claim and each login of a claimed player schedules it as a player-owned task.
 */
const Rewards = require("./Common.DiaryRewards");
const Progress = require("../../achievements/diaries/Progress.AchievementDiaries");
const { BY_KEY, TIERS } = require("../../achievements/diaries/Data.AchievementDiaries");

let pluginApi;

const TICK_MS = 600;
const DAILY_KEY = "zaff-battlestaves";
const DIARY_KEY = "varrock";
const COINS_ITEM = "coins";
const NO_ROOM_MESSAGE = "You need to make more space to carry your battlestaves.";
const OFFER_MESSAGE = (count, total) =>
  `Buy ${count} discounted battlestaves for ${format(stock().price)} coins each?<br>Total cost: ${format(total)} coins`;
const NEED_COINS_MESSAGE = (total) =>
  `You're going to need ${format(total)} coins to pay for these, even at their<br>discounted price.`;

function stock() {
  return Rewards.DATA.zaffBattlestaves;
}

function format(amount) {
  return amount.toLocaleString("en-US");
}

/** The highest Varrock tier claimed from Toby, or -1. */
function claimedTier(player) {
  const claimed = Progress.claimedTiers(player, BY_KEY.get(DIARY_KEY));
  return TIERS.reduce((best, tier, index) => (claimed.has(tier) ? index : best), -1);
}

function hasRoom(player, count) {
  const { Item } = Rewards.core;
  return player.getInventory().getAddableAmount(new Item(Rewards.objId(stock().item), count)) >= count;
}

/** A message box that ends the conversation when read; `then` runs after it, e.g. a choice. */
function messageBox(player, text, then) {
  const { DialogueChainBuilder, StatementDialogue, ActionDialogue, EndDialogue } = Rewards.core;
  const chain = new DialogueChainBuilder().add(new StatementDialogue(0, text));
  if (then) chain.add(new ActionDialogue(1, { execute: then }), new EndDialogue(2));
  else chain.add(new EndDialogue(1));
  player.getDialogueManager().startDialogues(chain);
}

function offer(player) {
  const tier = claimedTier(player);
  if (tier < 0 || Rewards.dailyUses(player, DAILY_KEY) > 0) return;
  const count = stock().perDay[tier];
  if (!hasRoom(player, count)) {
    messageBox(player, NO_ROOM_MESSAGE);
    return;
  }
  messageBox(player, OFFER_MESSAGE(count, count * stock().price), () => pluginApi.sendMultiChatboxPrompt(
    player, "Select an option",
    "Yes.", () => buy(player),
    "No.", () => {},
  ));
}

/** Pays and credits together; everything is checked again at this step. */
function buy(player) {
  const tier = claimedTier(player);
  if (tier < 0 || Rewards.dailyUses(player, DAILY_KEY) > 0) return;
  const count = stock().perDay[tier];
  const total = count * stock().price;
  const inventory = player.getInventory();
  const coins = Rewards.objId(COINS_ITEM);
  if (inventory.getAmount(coins) < total) {
    messageBox(player, NEED_COINS_MESSAGE(total));
    return;
  }
  if (!hasRoom(player, count)) {
    messageBox(player, NO_ROOM_MESSAGE);
    return;
  }
  inventory.deleteNumber(coins, total);
  inventory.adds(Rewards.objId(stock().item), count);
  player.performAnimation(new Rewards.core.Animation(Rewards.gamevalId("seq", stock().seq)));
  Rewards.sendCount(player, Rewards.gamevalId("varbit", stock().varbit), Rewards.useDaily(player, DAILY_KEY));
  scheduleReset(player);
}

/** Ticks from now to the next 00:00 UTC, at least one. */
function ticksToReset() {
  const now = Date.now();
  const midnight = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate() + 1);
  return Math.max(1, Math.ceil((midnight - now) / TICK_MS));
}

/**
 * Each player's reset has its own task key, not the player: other systems call
 * TaskManager.cancelTasks(player) (Misthalin Mystery's rowboat, among others) and would end it
 * until a relog. Logout cancels it explicitly.
 */
const RESET_KEYS = new WeakMap();

function resetKey(player) {
  if (!RESET_KEYS.has(player)) RESET_KEYS.set(player, {});
  return RESET_KEYS.get(player);
}

function cancelReset({ player }) {
  Rewards.core.TaskManager.cancelTasks(resetKey(player));
  RESET_KEYS.delete(player);
}

/**
 * Sends the varbit back to 0 once the UTC day has turned; a task that fires early waits again.
 * Arming replaces the player's earlier reset, so a login or a repeat claim never stacks two.
 */
function scheduleReset(player) {
  const { Task, TaskManager } = Rewards.core;
  const key = resetKey(player);
  TaskManager.cancelTasks(key);
  TaskManager.submit(new (class extends Task {
    constructor() { super(ticksToReset(), key, false); }
    execute() {
      this.stop();
      if (Rewards.dailyUses(player, DAILY_KEY) > 0) scheduleReset(player);
      else Rewards.sendCount(player, Rewards.gamevalId("varbit", stock().varbit), 0);
    }
  })());
}

function syncOnLogin({ player }) {
  if (Rewards.dailyUses(player, DAILY_KEY) === 0) return;
  Rewards.sendCount(player, Rewards.gamevalId("varbit", stock().varbit), 1);
  scheduleReset(player);
}

function clickBarrel({ player }) {
  offer(player);
  return true;
}

module.exports = function attachBattlestaves(api) {
  pluginApi = api;
  api.onObjectFirstClick(Rewards.core.CacheDefinitions.getLocId(stock().loc), clickBarrel);
  api.onPlayerLogin(syncOnLogin);
  api.onPlayerLogout(cancelReset);
};

module.exports._test = { offer, buy, claimedTier, DAILY_KEY };
