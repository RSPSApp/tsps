/**
 * The balloons' log storage (Wiki: Log_storage; Transcript:Log_storage): a crate at each station
 * (the cache's zep_storage, shown by the station's zep_multi_storage_* multiloc once its route is
 * open). All the crates share one stock of up to 100 of each log type, noted logs too; what goes
 * in can't come back out, and pays for trips.
 * - Store (or logs used on it): "Which of your logs would you like to store?" offers each carried
 *   type; with more than one, "How many logs would you like to store?"; then "You put the [type]
 *   in the crate. You now have [amount] stored.";
 * - Preferences: whether a trip takes stored logs first, or asks each time;
 * - Check: the five counts.
 * A trip pays its logs from one place: storage when it's preferred (or the inventory can't pay),
 * otherwise the inventory; with "ask" and both able to, the player chooses. The choice's wording
 * and the count told after a trip from storage are calibrated (balloon-transport.json notes
 * which).
 */
const Common = require("./Common.BalloonTransport");

const STORED_ATTRIBUTE = "balloon-transport:stored-logs";
const PREFERENCE_ATTRIBUTE = "balloon-transport:log-preference";
const STORAGE = "storage";
const INVENTORY = "inventory";

const settings = () => Common.data.storage;
const text = (key) => settings().messages[key];

function fill(template, values) {
  return template.replace(/\[(\w+)\]/g, (whole, key) => (values[key] !== undefined ? String(values[key]) : whole));
}

function storedAll(player) {
  const saved = player.getAttribute?.(STORED_ATTRIBUTE);
  return saved && typeof saved === "object" ? { ...saved } : {};
}

function stored(player, key) {
  return Math.max(0, Number(storedAll(player)[key]) || 0);
}

function setStored(player, key, amount) {
  player.setAttribute(STORED_ATTRIBUTE, { ...storedAll(player), [key]: Math.max(0, amount) });
}

function preference(player) {
  const saved = player.getAttribute?.(PREFERENCE_ATTRIBUTE);
  return saved === STORAGE || saved === "ask" ? saved : settings().defaultPreference;
}

/** The log's unnoted and noted ids. */
function idsOf(key) {
  const id = Common.ids.objs[key];
  const noted = Common.core.ItemDefinition.forId(id)?.getNoteId?.() ?? -1;
  return noted > 0 && noted !== id ? [id, noted] : [id];
}

/** Carried logs of a type, noted ones too: what the crate takes. */
function carried(player, key) {
  const inventory = player.getInventory();
  return idsOf(key).reduce((sum, id) => sum + inventory.getAmount(id), 0);
}

/** Unnoted logs of a type: what a trip takes from the inventory. */
function carriedForTrip(player, key) {
  return player.getInventory().getAmount(Common.ids.objs[key]);
}

/** Takes `amount` of the log from the inventory, unnoted first. */
function takeCarried(player, key, amount) {
  const inventory = player.getInventory();
  let left = amount;
  for (const id of idsOf(key)) {
    const take = Math.min(left, inventory.getAmount(id));
    if (take > 0) inventory.delete(id, take);
    left -= take;
  }
  inventory.refreshItems?.();
}

/** The recorded item box (objectbox) with the log, for "You put the [type] in the crate.". */
function itemBox(player, key, line) {
  const { DialogueChainBuilder, ItemStatementDialogue } = Common.core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new ItemStatementDialogue(0, Common.ids.objs[key], line)));
}

function box(player, line) {
  const { DialogueChainBuilder, StatementDialogue } = Common.core;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new StatementDialogue(0, line)));
}

function membersWorld() {
  return Common.core.WorldDefinition?.isMembersWorld?.() !== false;
}

/** Puts up to `wanted` of the log in the crate (still by one: an amount answered elsewhere does nothing). */
function deposit(player, key, wanted) {
  if (!Common.stationAt(player.getLocation())) return;
  const room = settings().max - stored(player, key);
  if (room <= 0) {
    player.sendMessage(text("full"));
    return;
  }
  const amount = Math.min(wanted, carried(player, key), room);
  if (amount <= 0) return;
  takeCarried(player, key, amount);
  setStored(player, key, stored(player, key) + amount);
  itemBox(player, key, fill(text("stored"), { type: settings().names[key], amount: stored(player, key) }));
}

/** One log type chosen: the amount asked when more than one is carried. */
function storeType(player, key) {
  if (stored(player, key) >= settings().max) {
    player.sendMessage(text("full"));
    return;
  }
  const held = carried(player, key);
  if (held <= 0) return;
  if (held === 1) return deposit(player, key, 1);
  player.setEnteredAmountAction({
    execute: (amount) => {
      if (Number.isInteger(amount) && amount > 0) deposit(player, key, amount);
    },
  });
  player.getPacketSender().sendEnterAmountPrompt(text("howMany"));
}

function store({ player }) {
  if (!membersWorld()) return player.sendMessage(text("members"));
  const held = settings().order.filter((key) => carried(player, key) > 0);
  if (held.length === 0) return player.sendMessage(text("none"));
  Common.api.sendMultiChatboxPrompt(player, text("which"), ...held.flatMap((key) => [settings().names[key], () => storeType(player, key)]));
}

/** Logs (noted or not) used on a crate: straight to that type. */
function useOnStorage(event) {
  // The placed loc is the station's multiloc; its name is the player's view of it.
  const name = Common.core.ObjectDefinition.forPlayer(event.objectId, event.player)?.getName?.();
  if (name !== settings().loc) return false;
  const key = settings().order.find((candidate) => idsOf(candidate).includes(event.itemId));
  if (!key) return false;
  event.handled = true;
  if (!membersWorld()) return event.player.sendMessage(text("members"));
  storeType(event.player, key);
  return true;
}

function preferences({ player }) {
  const { DialogueChainBuilder, StatementDialogue, ActionDialogue } = Common.core;
  const chain = new DialogueChainBuilder()
    .add(new StatementDialogue(0, text("preferenceBox")))
    .add(new ActionDialogue(1, {
      execute: () => {
        player.getDialogueManager().reset?.();
        Common.api.sendMultiChatboxPrompt(player, text("preferenceTitle"),
          text("preferStorage"), () => player.setAttribute(PREFERENCE_ATTRIBUTE, STORAGE),
          text("preferAsk"), () => player.setAttribute(PREFERENCE_ATTRIBUTE, "ask"));
      },
    }));
  player.getDialogueManager().startDialogues(chain);
}

function check({ player }) {
  const counts = Object.fromEntries(settings().order.map((key) => [key, stored(player, key)]));
  box(player, fill(text("check"), counts));
}

/** Whether the trip's `count` logs can be paid from one place. */
function canPay(player, station, count) {
  return carriedForTrip(player, station.log) >= count || stored(player, station.log) >= count;
}

/** Read-only fuel eligibility for other plugins; no menu, preference change or payment. */
function queryFuel(event) {
  const station = Common.data.stations.find((entry) => entry.key === event.station);
  event.canPay = Boolean(station && Number.isInteger(event.logs) && event.logs > 0 &&
    canPay(event.player, station, event.logs));
}

/**
 * Where the trip's logs come from, given to `go(source)`: storage when preferred (or the only
 * place with enough), the inventory otherwise; asked when the player chose to be asked and both
 * can pay. False when neither can.
 */
function chooseSource(player, station, count, go) {
  const fromStorage = stored(player, station.log) >= count;
  const fromInventory = carriedForTrip(player, station.log) >= count;
  if (!fromStorage && !fromInventory) return false;
  if (!fromStorage) return go(INVENTORY);
  if (!fromInventory || preference(player) === STORAGE) return go(STORAGE);
  Common.api.sendMultiChatboxPrompt(player, text("sourceTitle"),
    text("useStorage"), () => go(STORAGE),
    text("useInventory"), () => go(INVENTORY));
  return true;
}

/** Takes the trip's logs from `source`; false when it no longer has them. */
function pay(player, station, count, source) {
  if (source === STORAGE) {
    if (stored(player, station.log) < count) return false;
    setStored(player, station.log, stored(player, station.log) - count);
    return true;
  }
  if (carriedForTrip(player, station.log) < count) return false;
  const inventory = player.getInventory();
  inventory.delete(Common.ids.objs[station.log], count);
  inventory.refreshItems?.();
  return true;
}

/** A trip that didn't happen: the logs back where they came from. */
function refund(player, station, count, source) {
  if (source === STORAGE) return setStored(player, station.log, stored(player, station.log) + count);
  const inventory = player.getInventory();
  const id = Common.ids.objs[station.log];
  inventory.adds?.(id, count) ?? inventory.add?.(new Common.core.Item(id, count));
  inventory.refreshItems?.();
}

/**
 * As a trip's logs are taken (rsprox 3225, spam): from storage, how many sets are left ("one set"
 * for the last but one); from either, the last one used.
 */
function tellPaid(player, station, source) {
  const { messages } = Common.data;
  const type = settings().names[station.log];
  const left = source === STORAGE ? stored(player, station.log) : carriedForTrip(player, station.log);
  const spam = (line) => player.getPacketSender().sendTypedMessage(Common.core.ChatType.SPAM, line);
  if (left <= 0) return spam(fill(messages.usedLast, { type }));
  if (source !== STORAGE) return;
  spam(left === 1 ? fill(messages.storageOne, { type }) : fill(messages.storageLeft, { amount: left, type }));
}

function attach(api) {
  api.persistAttribute(STORED_ATTRIBUTE, {});
  api.persistAttribute(PREFERENCE_ATTRIBUTE, settings().defaultPreference);
  api.onObjectInteraction(settings().loc, { Store: store, Preferences: preferences, Check: check });
  api.onItemOnObject(useOnStorage);
  api.onCustomEvent("balloon-transport:can-pay", queryFuel);
}

module.exports = {
  attach, store, storeType, useOnStorage, preferences, check, stored, carried, canPay, chooseSource, pay, refund, tellPaid,
  STORED_ATTRIBUTE, PREFERENCE_ATTRIBUTE, STORAGE, INVENTORY,
};
