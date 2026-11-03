// The Wilderness Agility Course's Agility dispenser (rsprox 233/00449-00461; Wiki).
// - A lap (the climbing rocks, heard through "agility:lap") makes a ticket available and, once the
//   150,000-coin fee is paid, a reward too, adding one to the reward streak.
// - Tag gives the ticket and the reward: noted resources and armour by the streak's tier, straight
//   into an open looting bag; with a free slot an unnoted extra; 1/40 a medium clue.
// - Pay takes the fee (and gives a looting bag to a player without one); leaving the course loses it.
// - Redeem trades every ticket for Agility XP.
// The flags and the streak are the recorded varbits, kept as saved attributes and sent at login.
const DATA = require("./data/agility-dispenser.json");

const COURSE_KEY = "wilderness";
const DEPOSIT_ATTRIBUTE = "agility-dispenser:deposit";
const REWARD_ATTRIBUTE = "agility-dispenser:reward";
const TICKET_ATTRIBUTE = "agility-dispenser:ticket";
const PAYMENT_WARNING_ATTRIBUTE = "agility-dispenser:payment-warning";
const STREAK_ATTRIBUTE = "agility-dispenser:streak";
/** The dispenser's state, by its varbit's key in DATA.varbits. */
const ATTRIBUTES = Object.freeze({
  deposit: DEPOSIT_ATTRIBUTE, reward: REWARD_ATTRIBUTE, ticket: TICKET_ATTRIBUTE,
  paymentWarning: PAYMENT_WARNING_ATTRIBUTE, streak: STREAK_ATTRIBUTE,
});

let api;
const paid = new Set();

const core = () => api.core;
const message = (key, values = {}) => DATA.messages[key].replace(/\{(\w+)\}/g, (_, name) => values[name]);
const get = (player, name) => Number(player.getAttribute(ATTRIBUTES[name])) || 0;
const itemName = (id) => core().ItemDefinition.forId(id).getName();
const noted = (id) => core().ItemDefinition.forId(id).getNoteId();
const ticketId = () => core().CacheDefinitions.getObjId(DATA.ticket);

function set(player, name, value) {
  player.setAttribute(ATTRIBUTES[name], value);
  player.getPacketSender().sendVarbit(core().CacheDefinitions.getVarbitId(DATA.varbits[name]), value);
}

function messageBox(player, text) {
  const { DialogueChainBuilder, StatementDialogue } = core();
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, text)));
}

function weighted(entries, weightAt) {
  const total = entries.reduce((sum, entry) => sum + entry[weightAt], 0);
  let roll = Math.random() * total;
  for (const entry of entries) {
    roll -= entry[weightAt];
    if (roll < 0) return entry;
  }
  return entries[entries.length - 1];
}

const between = (low, high) => low + Math.floor(Math.random() * (high - low + 1));

function tierFor(streak) {
  return [...DATA.tiers].reverse().find((tier) => streak >= tier.from) ?? DATA.tiers[0];
}

/** One paid lap's noted resource and noted armour, by the streak's tier (Wiki). */
function rollReward(streak) {
  const tier = tierFor(streak);
  const [resource, low, high] = weighted(tier.resources, 3);
  const [armour] = weighted(tier.armour, 1);
  return [{ id: noted(resource), amount: between(low, high) }, { id: noted(armour), amount: 1 }];
}

/** Into the inventory, or the player's own ground item on their tile when it won't fit. */
function give(player, id, amount) {
  const inventory = player.getInventory();
  const stacks = core().ItemDefinition.forId(id).isStackable();
  if (inventory.getFreeSlots() > 0 || (stacks && inventory.getAmount(id) > 0)) {
    inventory.add(new (core().Item)(id, amount));
  } else {
    core().ItemOnGroundManager.registerNonGlobals(player, new (core().Item)(id, amount), player.getLocation().clone());
  }
}

// ---------------------------------------------------------------- laps

function lapDone({ player, course }) {
  if (course !== COURSE_KEY) return;
  set(player, "ticket", 1);
  if (!get(player, "deposit")) return;
  set(player, "reward", 1);
  set(player, "streak", get(player, "streak") + 1);
  player.sendMessage(message("streak", { streak: get(player, "streak") }));
}

/**
 * Wiki (Agility dispenser): starting the next lap at the pipe without having tagged the dispenser
 * loses the unclaimed ticket and reward and resets the streak; the payment stays. Rev 233 kept the
 * streak (233/00449: 2 -> 3 and 4 -> 5 across untagged laps); the current Wiki rule is followed here.
 */
function lapStarted({ player, objectId }) {
  if (objectId !== core().CacheDefinitions.getLocId(DATA.lapStart)) return;
  if (!get(player, "ticket") && !get(player, "reward")) return;
  set(player, "ticket", 0);
  set(player, "reward", 0);
  set(player, "streak", 0);
}

// ---------------------------------------------------------------- the dispenser

/** Ring of wealth (i), uncharged and (i1)-(i5) (gameval RING_OF_WEALTH_I*). */
const IMBUED_RINGS_OF_WEALTH = Object.freeze([12785, 20786, 20787, 20788, 20789, 20790]);

/** Wiki (Agility dispenser): a worn ring of wealth (i) makes the medium clue 1/20 instead of 1/40. */
function clueChance(player) {
  const ring = player.getEquipment?.()?.getItems()[core().Equipment.RING_SLOT];
  return IMBUED_RINGS_OF_WEALTH.includes(ring?.getId?.()) ? DATA.clueChance / 2 : DATA.clueChance;
}

/**
 * A medium clue on 1/40 laps (1/20 with a ring of wealth (i) worn), through the shared clue
 * services (one per tier, banked ones count; a scroll box after X Marks the Spot), or null.
 */
function rollClue(player) {
  if (Math.floor(Math.random() * clueChance(player)) !== 0) return null;
  const allowed = { player, tier: "medium", allowed: null };
  api.emitCustomEvent("treasure-trails:can-receive", allowed);
  if (allowed.allowed === false) return null;
  if (allowed.allowed !== true && player.getInventory().getAmount(DATA.clue) > 0) return null;
  const award = { player, itemId: DATA.clue, box: false };
  api.emitCustomEvent("treasure-trails:clue-item", award);
  return award.itemId;
}

function tag({ player }) {
  player.setRunEnergy(100);
  player.getPacketSender().sendRunEnergy();
  if (!get(player, "ticket")) return void player.sendMessage(message("needLap"));
  const rewarded = get(player, "reward") === 1;
  const loot = rewarded ? rollReward(get(player, "streak")) : null;
  if (loot) {
    const check = { player, items: loot, check: true, result: "no-bag" };
    api.emitCustomEvent("looting-bag:store", check);
    if (check.result === "no-bag") return void messageBox(player, message("noBag"));
    if (check.result === "full") return void messageBox(player, message("bagFull"));
  }
  set(player, "ticket", 0);
  player.sendMessage(message("ticket"));
  give(player, ticketId(), 1);
  if (!loot) return;
  set(player, "reward", 0);
  api.emitCustomEvent("looting-bag:store", { player, items: loot, result: "no-bag" });
  const values = { a: loot[0].amount, first: itemName(loot[0].id), b: loot[1].amount, second: itemName(loot[1].id) };
  const inventory = player.getInventory();
  // A clue comes before the extra: with one slot left it is the clue's (Wiki).
  const clue = rollClue(player);
  const clueStacks = clue != null && inventory.getAmount(clue) > 0 && core().ItemDefinition.forId(clue).isStackable();
  const slotsForExtra = inventory.getFreeSlots() - (clue != null && !clueStacks ? 1 : 0);
  if (clue != null) give(player, clue, 1);
  if (slotsForExtra > 0) {
    const [extra] = weighted(DATA.extra, 1);
    inventory.add(new (core().Item)(extra, 1));
    player.sendMessage(message("awardedExtra", { ...values, extra: itemName(extra) }));
  } else {
    player.sendMessage(message("awarded", values));
  }
}

/** Carried or banked, open or closed (Wiki: the fee gives a bag only to a player who has none). */
function ownsLootingBag(player) {
  const { Bank } = core();
  const containers = [player.getInventory(),
    ...(player.getBanks?.() ?? []).filter((bank, tab) => bank && tab !== Bank.BANK_SEARCH_TAB_INDEX)];
  return containers.some((container) => DATA.lootingBags.some((id) => container.getAmount(id) > 0));
}

function payFee(player) {
  const inventory = player.getInventory();
  if (inventory.getAmount(DATA.coins) < DATA.fee) return void messageBox(player, message("poor"));
  inventory.deleteNumber(DATA.coins, DATA.fee);
  set(player, "deposit", 1);
  watchPaid(player);
  player.sendMessage(message("paid"));
  if (!ownsLootingBag(player)) {
    inventory.add(new (core().Item)(DATA.lootingBags[0], 1));
    player.sendMessage(message("bagGiven"));
  }
  inventory.refreshItems();
}

function pay({ player }) {
  if (get(player, "deposit")) return void messageBox(player, message("alreadyPaid"));
  if (!ownsLootingBag(player) && player.getInventory().getFreeSlots() <= 0) return void messageBox(player, message("noSlot"));
  if (get(player, "paymentWarning")) return void payFee(player);
  api.sendMultiChatboxPrompt(player, message("payPrompt"),
    message("yes"), () => payFee(player),
    message("yesNoAsk"), () => { set(player, "paymentWarning", 1); payFee(player); },
    message("no"), () => {});
}

/** Wiki: 200 XP a ticket for 1-10, 210 for 11-50, 220 for 51-100, 230 from 101. */
function redeemXp(count) {
  return count * DATA.redeem.find(([from]) => count >= from)[1];
}

function redeem({ player }) {
  const inventory = player.getInventory();
  const count = inventory.getAmount(ticketId());
  if (count <= 0) return void messageBox(player, message("noTickets"));
  const xp = redeemXp(count);
  inventory.deleteNumber(ticketId(), count);
  inventory.refreshItems();
  player.getSkillManager().addExperiences(core().Skill.AGILITY, xp);
  player.getPacketSender().sendSoundEffect(DATA.redeemSound, 1, 0, 1);
  player.sendMessage(count === 1 ? message("redeemOne", { xp: xp.toLocaleString("en-US") })
    : message("redeemMany", { count, xp: xp.toLocaleString("en-US") }));
}

// ---------------------------------------------------------------- the payment's end

function onCourse(location) {
  const { minX, maxX, minY, maxY } = DATA.course;
  const x = location.getX();
  const y = location.getY();
  return location.getZ() === 0 && x >= minX && x <= maxX && y >= minY && y <= maxY;
}

/** Recorded on leaving: the streak, the payment and an unclaimed reward go; the ticket stays. */
function forfeit(player) {
  paid.delete(player);
  set(player, "streak", 0);
  set(player, "deposit", 0);
  set(player, "reward", 0);
}

function checkPaid() {
  for (const player of paid) {
    if (!player.isRegistered()) paid.delete(player);
    else if (!onCourse(player.getLocation())) forfeit(player);
  }
}

const WATCH_KEY = Object.freeze({ task: "agility-dispenser:watch" });
let watcher = null;

/** Watches a paid player for leaving the course; the check runs only while someone has paid. */
function watchPaid(player) {
  paid.add(player);
  if (watcher) return;
  const { Task, TaskManager } = core();
  watcher = new (class extends Task {
    constructor() { super(1, WATCH_KEY, false); }
    execute() {
      checkPaid();
      if (paid.size === 0) this.stop();
    }
    stop() {
      if (watcher === this) watcher = null;
      super.stop();
    }
  })();
  TaskManager.submit(watcher);
}

/** Whether the paid-player watch is running (for tests). */
const isWatching = () => watcher != null;

function login({ player }) {
  for (const name of Object.keys(ATTRIBUTES)) {
    const value = get(player, name);
    if (value) player.getPacketSender().sendVarbit(core().CacheDefinitions.getVarbitId(DATA.varbits[name]), value);
  }
  if (get(player, "deposit")) watchPaid(player);
}

function logout({ player }) {
  paid.delete(player);
  player.setAttribute(STREAK_ATTRIBUTE, Math.max(0, get(player, "streak") - DATA.logoutStreakLoss));
}

module.exports = {
  name: "AgilityDispenser",
  members: true,
  DATA,
  ATTRIBUTES,
  isWatching,
  rollReward,
  redeemXp,
  register(pluginApi) {
    api = pluginApi;
    api.persistAttribute(DEPOSIT_ATTRIBUTE, 0);
    api.persistAttribute(REWARD_ATTRIBUTE, 0);
    api.persistAttribute(TICKET_ATTRIBUTE, 0);
    api.persistAttribute(PAYMENT_WARNING_ATTRIBUTE, 0);
    api.persistAttribute(STREAK_ATTRIBUTE, 0);
    api.onCustomEvent("agility:lap", lapDone);
    api.onCustomEvent("agility:obstacle-start", lapStarted);
    api.onObjectInteraction("Agility dispenser", { Tag: tag, Pay: pay, Redeem: redeem });
    api.onPlayerLogin(login);
    api.onPlayerLogout(logout);
  },
};
