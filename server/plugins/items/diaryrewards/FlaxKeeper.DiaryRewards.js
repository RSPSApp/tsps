/**
 * The flax keeper (NPC 5522, Seers' Village flax fields; Wiki: Flax keeper, Kandarin Diary rewards):
 * once a day he swaps noted flax for the same number of noted bow strings, 30 / 60 / 120 / 250 by
 * Kandarin tier. His Talk-to and Exchange conversations are the Wiki transcript in npc-dialogues.json
 * (variants standard-dialogue and right-click-exchange-option); this unit answers its conditions,
 * fills in "[amount]" and performs the swap at its "receive" step.
 *
 * The words, the conditions and the rule are the Wiki's: text searches of the RSProx archive find none
 * of his lines ("flax banknotes", "exchanges your flax", "flax notes"), and archives 1034 and 1035, which
 * list NPC 5522, were decoded without his dialogue. INFERRED: the tier is the highest Kandarin tier
 * claimed from Toby, not merely completed (the Wiki says "completing"); "[amount]" is the plain number in
 * every line; the allowance resets at 00:00 UTC like the other diary allowances. The swap's message box
 * shows flax and bow string, as the transcript's picture box names.
 *
 * Nothing is taken or given until Agree: flax, room and the day's allowance are checked again then.
 * Flax that is a preset, untradeable or unbankable copy is not flax he takes, so those restrictions
 * cannot be laundered into clean bow strings. The allowance is a stored day + count, so there is no
 * timer to keep and no logout cleanup. The client has a varbit SEERS_FREE_FLAX (4559) beside the Sherlock
 * counter, but nothing here or in a capture shows when live sets it, so it is not sent.
 */
const Rewards = require("./Common.DiaryRewards");
const Progress = require("../../achievements/diaries/Progress.AchievementDiaries");
const { BY_KEY, TIERS } = require("../../achievements/diaries/Data.AchievementDiaries");

const DAILY_KEY = "flax-keeper";
const EXCHANGE_VARIANT = "right-click-exchange-option";
const RECEIVE_TEXT = "[amount] bow strings";
const AMOUNT = "[amount]";
const NO_DIARY = "If the player has not completed any of the Kandarin achievement diaries:";
const HAS_STRINGS = "If the Flax keeper has bowstrings to exchange for flax:";
const NO_STRINGS = "If the Flax keeper has no more bowstrings to exchange for flax:";
const SHORT = "If the player does not have [amount] noted flax:";
const ENOUGH = "If the player has [amount] noted flax:";
const SHORT_EXCHANGE = "If the Flax keeper has bowstrings to exchange for flax, but the player does not have [amount] noted flax:";
const ENOUGH_EXCHANGE = "If the Flax keeper has bowstrings to exchange for flax, and the player has [amount] noted flax:";
const NO_ROOM = "If the player has no room for the bowstrings:";
const ROOM = "If the player has room for the bowstrings:";

let pluginApi;
let core;
/** Noted ids, read from the item definitions on first use (they are not loaded when plugins register). */
const noted = {};

function notedId(name) {
  noted[name] ??= core.ItemDefinition.forId(core.ItemIdentifiers[name]).getNoteId();
  return noted[name];
}

function data() {
  return Rewards.DATA.flaxKeeper;
}

/** Today's amount from the highest Kandarin tier claimed from Toby, or 0. */
function allowance(player) {
  const claimed = Progress.claimedTiers(player, BY_KEY.get(data().diary));
  const tier = TIERS.reduce((best, name, index) => (claimed.has(name) ? index : best), -1);
  return tier < 0 ? 0 : data().perDay[tier];
}

const used = (player) => Rewards.dailyUses(player, DAILY_KEY) > 0;

/** Preset (and other untradeable or unbankable) copies keep their restrictions, so he takes none. */
function restricted(item) {
  const { Item } = core;
  return item.isPresetItem?.() === true
    || item.getMetaValue?.(Item.PRESET_META) === true
    || item.getMetaValue?.(Item.UNTRADEABLE_META) === true
    || item.getMetaValue?.(Item.UNBANKABLE_META) === true;
}

/** [slot, item] of every unrestricted noted flax stack. */
function flaxStacks(player) {
  const found = [];
  player.getInventory().getItems().forEach((item, slot) => {
    if (item && item.getId() === notedId("FLAX") && !restricted(item)) found.push([slot, item]);
  });
  return found;
}

const flaxHeld = (player) => flaxStacks(player).reduce((sum, [, item]) => sum + item.getAmount(), 0);

/**
 * Room for the bow strings, by what the inventory can really add (it respects stack metadata and the
 * stack cap). A flax stack the swap empties frees a slot, which counts only when no clean bow string
 * stack exists, since an add prefers that stack.
 */
function hasRoom(player, amount) {
  const inventory = player.getInventory();
  const strings = notedId("BOW_STRING");
  if (inventory.getAddableAmount(new core.Item(strings, amount)) >= amount) return true;
  if (inventory.getItems().some((item) => item && item.getId() === strings && !restricted(item))) return false;
  let left = amount;
  for (const [, item] of flaxStacks(player)) {
    const take = Math.min(item.getAmount(), left);
    left -= take;
    if (take === item.getAmount()) return true;
    if (left === 0) break;
  }
  return false;
}

function isKeeper(npcId) {
  return npcId === core.NpcIdentifiers.FLAX_KEEPER;
}

/** The transcript's Wiki prose conditions. */
function condition({ player, npcId, text }) {
  if (!isKeeper(npcId)) return null;
  const amount = allowance(player);
  const offer = amount > 0 && !used(player);
  switch (text) {
    case NO_DIARY: return amount === 0;
    case HAS_STRINGS: return offer;
    case NO_STRINGS: return amount > 0 && used(player);
    case SHORT: return flaxHeld(player) < amount;
    case ENOUGH: return flaxHeld(player) >= amount;
    case SHORT_EXCHANGE: return offer && flaxHeld(player) < amount;
    case ENOUGH_EXCHANGE: return offer && flaxHeld(player) >= amount;
    case NO_ROOM: return !hasRoom(player, amount);
    case ROOM: return hasRoom(player, amount);
    default: return null;
  }
}

function fill(text, player) {
  return typeof text === "string" && text.includes(AMOUNT) ? text.split(AMOUNT).join(String(allowance(player))) : text;
}

function line(request) {
  if (isKeeper(request.npcId)) request.text = fill(request.text, request.player);
}

function menu(notice) {
  if (isKeeper(notice.npcId)) notice.prompt = fill(notice.prompt, notice.player);
}

/** Pays and credits together; everything is checked again at this step. */
function exchange(player) {
  const amount = allowance(player);
  if (amount === 0 || used(player) || flaxHeld(player) < amount || !hasRoom(player, amount)) return false;
  const inventory = player.getInventory();
  let left = amount;
  for (const [slot, item] of flaxStacks(player)) {
    const take = Math.min(item.getAmount(), left);
    inventory.deleteAtSlot(slot, take, false);
    left -= take;
    if (left === 0) break;
  }
  inventory.adds(notedId("BOW_STRING"), amount);
  inventory.refreshItems();
  Rewards.useDaily(player, DAILY_KEY);
  return true;
}

/** The transcript's "receive" step is where the swap happens; a failed re-check ends the talk. */
function action(event) {
  if (!isKeeper(event.npcId)) return;
  if (event.kind === "message") {
    event.box = { items: [core.ItemIdentifiers.FLAX, core.ItemIdentifiers.BOW_STRING] };
    return;
  }
  if (event.action !== "receive" || event.text !== RECEIVE_TEXT) return;
  event.handled = true;
  if (!exchange(event.player)) event.end = true;
}

function clickExchange({ player, npc }) {
  const request = { player, npc, npcId: npc.getId(), variant: EXCHANGE_VARIANT, exact: true, handled: false };
  pluginApi.emitCustomEvent("npc-dialogue:start", request);
  return request.handled;
}

module.exports = function attachFlaxKeeper(api) {
  pluginApi = api;
  core = api.core;
  api.onNpcInteraction(data().npc, { Exchange: clickExchange });
  api.onNpcDialogueCondition(condition);
  api.onCustomEvent("npc-dialogue:line", line);
  api.onCustomEvent("npc-dialogue:menu", menu);
  api.onCustomEvent("npc-dialogue:action", action);
};
