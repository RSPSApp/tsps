"use strict";

const QuestRuntime = require("../QuestRuntime");
const { sites } = require("./data/enchanted-key.json");
const ORDER_ATTRIBUTE = "enchanted-key:order";
const FOUND_ATTRIBUTE = "enchanted-key:treasures-found";
// rev242 dump.varbit: makinghistory_locstatus (604:21..31), enchantedkey (3403:8..9).
// rsprox1702: each of eleven reward deltas adds its site's bit; final enchantedkey changes 1 -> 2.
const LOCSTATUS_VARBIT = 1391;
const STATUS_VARBIT = 13717;
/**
 * Feel's reading by Chebyshev distance to the next site, each with its own synth (loops 1, delay 0).
 * rsprox captures: local 1002311 (revision 243, 78 Feels) and 1702 (revision 226, 48 Feels) both
 * send only these six readings, at steaming 1-4, burning 5-16, very hot 43-57, warm 59-117, cold
 * 125-450 and freezing 505 and over; neither ever sends "It's hot" or "It's very cold". The Wiki's
 * table (hot 61-100, warm 101-400, cold 401-700, very cold 701-1000, freezing over 1000) disagrees
 * with every one of those samples past 58 squares; docs/quests/the-enchanted-key/README.md.
 * Ours: the cuts inside the recorded gaps. Burning keeps the Wiki's 30 (inside 16-43); 58, 120 and
 * 500 are placed in the gaps 57-59, 117-125 and 450-505.
 */
const FEEDBACK = [
  [4, "The key is steaming. It must be right below your feet.", 1201], // history_key_steaming
  [30, "Ouch! It's burning hot", 1197], // history_key_burning
  [58, "It's very hot", 1200], // history_key_hot
  [120, "It's warm", 1202], // history_key_warm
  [500, "It's cold", 1198], // history_key_cold
  [Infinity, "It's freezing", 1199], // history_key_freezing
];
// The quest journal (119) as live sends it (local 1002311 ticks 343, 481 and 2140; 1702 with nine
// sites found): the struck-out story, a struck-out line per site found in wireBit order, then the
// navy prompt, or once all eleven are found the key's last line and MINIQUEST COMPLETE!.
const JOURNAL_STORY = [
  "<str>While helping Jorral to save the Ardougne Outpost, I received",
  "<str>a strange key from Erin the silver merchant, which used to",
  "<str>belong to his great grandfather. By checking the temperature",
  "<str>of the key as I moved from place to place, I was able to find a",
  "<str>buried chest containing a journal.",
];
const JOURNAL_PROMPT = "<col=000080>I should see what else I can find with the help of the key.";
const JOURNAL_DONE = ["<str>The key doesn't seem to do anything anymore.", "", "<col=ff0000>MINIQUEST COMPLETE!"];
const LAST_DISTANCE = new WeakMap();
let api;
let core;
let quest;
/** The Enchanted Key's own quest list entry (cache quest row 41, list id 98, endstate 2). */
let miniquest;

function found(player) {
  const value = player.getAttribute(FOUND_ATTRIBUTE) ?? 0;
  return Number.isInteger(value) && value >= 0 && value <= sites.length ? value : null;
}
function complete(player) { return found(player) === sites.length; }
function physicalKey(player) { return player.getInventory().getAmount(core.ItemIdentifiers.ENCHANTED_KEY) > 0; }
function queryComplete(request) {
  if (request.player && quest.isComplete(request.player)) request.complete = complete(request.player);
}
function validOrder(order) {
  return Array.isArray(order) && order.length === sites.length && order[0] === sites[0].key
    && new Set(order).size === sites.length && order.every(key => sites.some(site => site.key === key));
}
/** The sites found so far, in route order; null when the saved progress can't be read. */
function foundSites(player) {
  const count = found(player), order = player.getAttribute(ORDER_ATTRIBUTE);
  if (count == null) return null;
  if (count === 0) return [];
  if (!validOrder(order)) return null;
  return order.slice(0, count).map(key => sites.find(site => site.key === key));
}
function sync({ player }) {
  if (!quest.isComplete(player)) return;
  const done = foundSites(player);
  if (done == null) return;
  const mask = done.reduce((bits, site) => bits | (1 << site.wireBit), 0);
  player.getPacketSender().sendVarbit(LOCSTATUS_VARBIT, mask).sendVarbit(STATUS_VARBIT, complete(player) ? 2 : 1);
}
/** The miniquest's stage as the enchantedkey varbit holds it: 0 before Making History, 1 hunting, 2 done. */
function stage(player) {
  if (!quest.isComplete(player)) return 0;
  return complete(player) ? 2 : 1;
}
function buildJournal(player) {
  if (stage(player) === 0) return [];
  const done = (foundSites(player) ?? []).slice().sort((a, b) => a.wireBit - b.wireBit);
  const lines = [...JOURNAL_STORY, ...done.map(site => `<str>I found some treasure ${site.journal}.`)];
  return complete(player) ? [...lines, ...JOURNAL_DONE] : [...lines, JOURNAL_PROMPT];
}

/** A saved permutation is never regenerated after progress; invalid saved state cannot award loot. */
function route(player) {
  const saved = player.getAttribute(ORDER_ATTRIBUTE);
  if (validOrder(saved)) return saved;
  if (found(player) !== 0 || (saved != null && (!Array.isArray(saved) || saved.length !== 0))) return null;
  const tail = sites.slice(1).map(site => site.key);
  for (let i = tail.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tail[i], tail[j]] = [tail[j], tail[i]];
  }
  const order = [sites[0].key, ...tail];
  player.setAttribute(ORDER_ATTRIBUTE, order);
  return order;
}
function target(player) {
  const count = found(player);
  if (count == null || count === sites.length) return null;
  const order = route(player);
  return order ? sites.find(site => site.key === order[count]) : null;
}
function distance(player, site) {
  const location = player.getLocation();
  const x = location.getX(), y = location.getY();
  return Number.isFinite(x) && Number.isFinite(y) ? Math.max(Math.abs(x - site.x), Math.abs(y - site.y)) : null;
}
function temperature(steps) {
  return FEEDBACK.find(([maximum]) => steps <= maximum);
}
function feel({ player }) {
  if (!quest.isComplete(player) || !physicalKey(player)) return false;
  const site = target(player);
  if (!site) return false;
  const steps = distance(player, site);
  if (steps == null) return false;
  const [, text, sound] = temperature(steps);
  let message = text;
  const last = LAST_DISTANCE.get(player);
  if (steps > 4 && last != null) {
    message += steps < last ? " and warmer than last time"
      : steps > last ? " but colder than last time" : " and the same temperature as last time";
  }
  LAST_DISTANCE.set(player, steps);
  player.sendMessage(message);
  if (sound != null) core.Sounds.sendSound(player, new core.Sound(sound, 1, 0, 1));
}

/** Resolve bank-note identities from this deployment's cache, never by assuming id + 1. */
function rewardItems(site) {
  return site.rewards.map(reward => {
    const base = core.ItemIdentifiers[reward.item];
    let id = base;
    if (reward.noted) {
      id = core.ItemDefinition.forId(base).getNoteId();
      if (!Number.isInteger(id) || id < 0) throw new Error(`Enchanted Key reward has no canonical note: ${reward.item}`);
      const definition = core.ItemDefinition.forId(id);
      if (!definition.isNoted() || definition.unNote() !== base || !definition.isStackable()) {
        throw new Error(`Enchanted Key reward has no canonical note: ${reward.item}`);
      }
    }
    return new core.Item(id, reward.amount);
  });
}
function dig({ player }) {
  if (!quest.isComplete(player) || !physicalKey(player)) return false;
  const site = target(player);
  if (!site || player.getLocation().getZ() !== 0) return false;
  const steps = distance(player, site);
  if (steps == null || steps > 4) return false;
  const inventory = player.getInventory();
  const last = found(player) === sites.length - 1;
  const preview = new core.Inventory(player).setItems(inventory.getCopiedItems());
  if (last) preview.deleted(core.ItemIdentifiers.ENCHANTED_KEY, 1, false);
  const rewards = rewardItems(site);
  for (const item of rewards) {
    if (preview.getAddableAmount(item) < item.getAmount()) {
      inventory.full();
      return;
    }
    preview.add(item, false);
  }
  // All amounts were planned on independent Item copies. One synchronous commit, no awaited window.
  inventory.setItems(preview.getCopiedItems());
  player.setAttribute(FOUND_ATTRIBUTE, found(player) + 1);
  sync({ player });
  LAST_DISTANCE.delete(player);
  inventory.refreshItems();
  player.sendMessage("You found some treasure.");
  if (last) {
    // local 1002311 tick 2111: enchantedkey reaches 2 with the dig; the miniquest count moves on
    // when the box is continued (tick 2115), so the quest list is refreshed there.
    const manager = player.getDialogueManager();
    manager.startDialogues(new core.DialogueChainBuilder()
      .add(new core.ItemStatementDialogue(0, core.ItemIdentifiers.ENCHANTED_KEY,
        "You find some items, but the key dissolves in your<br>hand."))
      .add(new core.ActionDialogue(1, { execute: () => {
        QuestRuntime.refreshQuestList(player);
        manager.advance();
      } }))
      .add(new core.EndDialogue(2)));
  }
}
function resetComparison({ player }) { LAST_DISTANCE.delete(player); }

/**
 * ::quest complete (and ::quest all): every treasure not yet dug is given (the command routes it to
 * the bank under ::quest all), the miniquest completes, and the key goes, as it dissolves live.
 * Live completes it with no scroll, jingle or chat line (local 1002311 ticks 2111-2115).
 */
function completeRoute(player) {
  if (!player || !quest.isComplete(player) || complete(player)) return false;
  const order = route(player);
  if (!order) return false;
  const inventory = player.getInventory();
  for (const key of order.slice(found(player))) {
    for (const item of rewardItems(sites.find(site => site.key === key))) inventory.forceAdd(player, item);
  }
  player.setAttribute(FOUND_ATTRIBUTE, sites.length);
  const KEY = core.ItemIdentifiers.ENCHANTED_KEY;
  for (const container of [inventory, ...(player.getBanks?.() ?? [])]) {
    const held = container?.getAmount(KEY) ?? 0;
    if (held > 0) container.deleted(KEY, held, false);
  }
  sync({ player });
  QuestRuntime.refreshQuestList(player);
  return true;
}

/**
 * A stage set directly (::quest <name> <stage>, as for every quest): 2 marks every site found, with
 * no rewards (complete() pays them); 0 or 1 clears the route, to start again from Rellekka. The
 * miniquest stays at 0 until Making History is complete.
 */
function setStageForCommand(player, value) {
  LAST_DISTANCE.delete(player);
  if ((value | 0) >= 2) {
    if (!quest.isComplete(player) || !route(player)) return;
    player.setAttribute(FOUND_ATTRIBUTE, sites.length);
    sync({ player });
    QuestRuntime.refreshQuestList(player);
    return;
  }
  player.setAttribute(FOUND_ATTRIBUTE, 0);
  player.setAttribute(ORDER_ATTRIBUTE, []);
  player.getPacketSender().sendVarbit(LOCSTATUS_VARBIT, 0).sendVarbit(STATUS_VARBIT, stage(player));
  QuestRuntime.refreshQuestList(player);
}

/**
 * The miniquest's own quest list row, so its journal opens and it counts towards the completed
 * miniquests. Its stage is derived, never saved: Making History and the treasures found decide it.
 */
function registerMiniquest() {
  miniquest = QuestRuntime.registerQuest(api, {
    key: "the_enchanted_key",
    name: "The Enchanted Key",
    varbitId: STATUS_VARBIT,
    startedValue: 1,
    completionValue: 2,
    questPoints: 0,
    journalAsSent: true,
    buildJournal,
  });
  miniquest.getStage = stage;
  miniquest.setStage = setStageForCommand;
  miniquest.complete = completeRoute;
}

module.exports = function attach(pluginApi, makingHistory) {
  api = pluginApi;
  core = api.core;
  quest = makingHistory;
  api.persistAttribute(ORDER_ATTRIBUTE, []);
  api.persistAttribute(FOUND_ATTRIBUTE, 0);
  registerMiniquest();
  api.onItemAction("Enchanted key", { Feel: feel });
  api.onItemAction("Spade", { Dig: dig });
  api.onCustomEvent("enchanted-key:is-complete", queryComplete);
  api.onCustomEvent("enchanted-key:sync", sync);
  api.onPlayerLogin(resetComparison);
  api.onPlayerLogout(resetComparison);
};
