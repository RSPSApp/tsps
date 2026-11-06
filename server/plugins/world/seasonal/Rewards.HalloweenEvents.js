"use strict";

// Spook-a-thon rewards (Wiki 2025 Halloween event, Rewards): the Grim reaper
// outfit, the Spooky chair and pumpkin lantern, and the tradeable noted pumpkins
// and halloween masks, which accounts with under 24 hours of play time claim
// from Fred later. All-or-nothing on an inventory copy, then one write.
const Progress = require("./Progress.HalloweenEvents");
const { rewards, previousRewards, eventRewards } = require("./data/halloween-2025-scene.json");
const { STAGE } = Progress;
const TITLE = "Spook-a-thon Decoration Contest";
const scrolls = new WeakSet();

function itemId(api, symbol) {
  const id = api.core.CacheDefinitions.getObjId(symbol);
  if (id === null) throw new Error("Missing Halloween reward " + symbol);
  return id;
}

function eligibleForTradeables(api, player) {
  const request = { player };
  api.emitCustomEvent("player:lifetime-seconds", request);
  return typeof request.seconds === "number" && Number.isFinite(request.seconds) && request.seconds >= rewards.tradeablePlaySeconds;
}

/** Holiday rewards Diango returns once unlocked: every previous Halloween event's. */
function unlockPrevious(api, player) {
  const request = { player, items: [...previousRewards] };
  api.emitCustomEvent("holiday-rewards:unlock", request);
  return request.accepted === true;
}

function rows(api, player, { cosmetics, tradeables }) {
  const list = [];
  if (cosmetics) {
    for (const row of rewards.items) list.push({ id: itemId(api, row.symbol), amount: row.amount, cosmetic: true });
    // The lantern is held for the contest; a lost one is replaced with the rest.
    if (!Progress.owns(api, player, rewards.lantern)) list.push({ id: itemId(api, rewards.lantern), amount: 1, cosmetic: true });
  }
  if (tradeables) for (const row of rewards.tradeable) list.push({ id: itemId(api, row.symbol), amount: row.amount, cosmetic: false });
  return list;
}

/** Plans the additions on a copy of the inventory; null when any of it would not fit. */
function plan(api, player, list) {
  const copy = new api.core.Inventory(player).setItems(player.getInventory().getCopiedItems());
  for (const row of list) {
    const item = new api.core.Item(row.id, row.amount);
    if (copy.getAddableAmount(item) !== row.amount) return null;
    copy.add(item, false);
  }
  return copy.getItems();
}

function completionRows(api, player) {
  const state = Progress.read(player);
  return rows(api, player, { cosmetics: true, tradeables: !state.tradeableClaimed && eligibleForTradeables(api, player) });
}

function canClaim(api, player) {
  return Progress.read(player).stage === STAGE.JUDGED && plan(api, player, completionRows(api, player)) !== null;
}

/**
 * Free slots the rewards still need: the source's "[1-9] free inventory [slot/slots]".
 * A reward that stacks onto a held stack needs none; one blocked by a stack at its
 * cap is not a slot shortfall. Planned on a copy of the real inventory.
 */
function missingSlots(api, player, list) {
  const copy = new api.core.Inventory(player).setItems(player.getInventory().getCopiedItems());
  let missing = 0;
  for (const row of list) {
    const item = new api.core.Item(row.id, row.amount);
    if (copy.getAddableAmount(item) === row.amount) { copy.add(item, false); continue; }
    const stacks = api.core.ItemDefinition.forId(row.id)?.isStackable?.() && copy.getAmount(row.id) > 0;
    if (!stacks) missing++;
  }
  return missing;
}

/** The refusal when the rewards do not fit: the slot count, or plain space when slots are not the cause. */
function refuse(api, player, list = completionRows(api, player)) {
  const missing = missingSlots(api, player, list);
  player.sendMessage(missing > 0
    ? `You need ${missing} free inventory slot${missing === 1 ? "" : "s"} to receive your Halloween event rewards.`
    : "You don't have enough inventory space to receive your Halloween event rewards.");
}

function announce(api, player, list) {
  for (const row of list) if (row.cosmetic) {
    player.sendMessage("You've received a holiday item: <col=e00a19>" + api.core.CacheDefinitions.getItem(row.id).name);
  }
}

function claim(api, player) {
  const state = Progress.read(player);
  if (!player.isRegistered() || player.getHitpoints() <= 0 || state.stage !== STAGE.JUDGED) return false;
  const tradeables = !state.tradeableClaimed && eligibleForTradeables(api, player);
  const list = rows(api, player, { cosmetics: true, tradeables }), items = plan(api, player, list);
  if (!items) return false;
  // HolidayRewards validates the whole unlock before writing; nothing else changes on refusal.
  const unlock = { player, items: [...eventRewards] };
  api.emitCustomEvent("holiday-rewards:unlock", unlock);
  if (unlock.accepted !== true) return false;
  player.getInventory().setItems(items);
  player.getInventory().refreshItems();
  Progress.update(api, player, next => next.stage === STAGE.JUDGED && (next.stage = STAGE.COMPLETE, next.tradeableClaimed = tradeables, true));
  announce(api, player, list);
  return list;
}

/** After completion, an account that has since reached 24 hours of play claims the tradeables from Fred. */
function claimTradeables(api, player) {
  const state = Progress.read(player);
  if (state.stage !== STAGE.COMPLETE || state.tradeableClaimed || !eligibleForTradeables(api, player)) return false;
  const list = rows(api, player, { cosmetics: false, tradeables: true }), items = plan(api, player, list);
  if (!items) {
    refuse(api, player, list);
    return true;
  }
  player.getInventory().setItems(items);
  player.getInventory().refreshItems();
  Progress.update(api, player, next => !next.tradeableClaimed && (next.tradeableClaimed = true));
  return true;
}

function show(api, player, list) {
  const cache = api.core.CacheDefinitions, sender = player.getPacketSender();
  const group = cache.getInterfaceId("eventscroll");
  if (group === null) return;
  sender.sendInterface(group);
  sender.sendString(TITLE, cache.getComponentId("eventscroll:event_title"));
  const names = list.filter(row => row.cosmetic).map(row => "- " + cache.getItem(row.id).name);
  sender.sendString(names.join("<br>"), cache.getComponentId("eventscroll:event_rewards"));
  sender.sendInterfaceModel(cache.getComponentId("eventscroll:event_model"), itemId(api, rewards.lantern), 10);
  scrolls.add(player);
}

function close(api, event) {
  const { player } = event, cache = api.core.CacheDefinitions;
  if (!scrolls.has(player) || player.getInterfaceId() !== cache.getInterfaceId("eventscroll") ||
    event.buttonId !== cache.getComponentId("eventscroll:close_button")) return;
  event.handled = true;
  if ((event.opId ?? event.action) !== 1) return;
  scrolls.delete(player);
  player.getPacketSender().sendInterfaceRemoval();
}

module.exports = { TITLE, eligibleForTradeables, unlockPrevious, canClaim, refuse, claim, claimTradeables, show, close };
