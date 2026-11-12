"use strict";

/**
 * The Kraken Cove crevice shortcut (see ../Kraken.plugin.js for behaviour and sources).
 *
 * Crevice (ObjectIdentifiers CREVICE_4 = 537) at (2280, 10017) Enter leads into the
 * Kraken boss pool at (2280, 10022); Crevice (CREVICE_5 = 538) at (2280, 10021) Use
 * leads back out to (2280, 10016). The out-landing is the tile players stand on at
 * the crevice (verified walkable in testing). The boss-side landing has no Wiki or
 * cache source: it is cross-checked against ReasonPS and stated as such (rule 10) —
 * an RSPS reference, not a capture. Plain moves: no squeeze animation was captured,
 * so none is played (estimate). Private rents an owned room; Peek remains unhandled.
 */

const Shared = require("./Shared.Kraken");
const Instance = require("./Instance.Kraken");
const PRIVATE_FEE = 25000;

const CREVICE_IN_TILE = [2280, 10017, 0];
const BOSS_SIDE_TILE = [2280, 10022, 0];
const CREVICE_OUT_TILE = [2280, 10021, 0];
const COVE_SIDE_TILE = [2280, 10016, 0];

function creviceIds() {
  const { CREVICE_4, CREVICE_5 } = Shared.core().ObjectIdentifiers;
  return { IN: CREVICE_4, OUT: CREVICE_5 };
}

function at(object, tile) {
  const location = object?.getLocation?.();
  return !!location
    && location.getX() === tile[0]
    && location.getY() === tile[1]
    && location.getZ() === tile[2];
}

function go(player, tile) {
  const { Location } = Shared.core();
  player.moveTo(new Location(tile[0], tile[1], tile[2]));
  return true;
}

function enter({ player, object }) {
  if (!object || !Shared.alive(player)) return false;
  if (object.getId?.() !== creviceIds().IN || !at(object, CREVICE_IN_TILE)) return false;
  return go(player, BOSS_SIDE_TILE);
}

function use({ player, object }) {
  if (!object || !Shared.alive(player)) return false;
  if (object.getId?.() !== creviceIds().OUT || !at(object, CREVICE_OUT_TILE)) return false;
  Instance.leave(player);
  return go(player, COVE_SIDE_TILE);
}

// Server-authored prompt/transaction. Source priority and exact prompt
// wording are TSPS choices, not a claim about the live interface.
function containers(player, source) {
  if (source === "inventory") return [player.getInventory()];
  const { Bank } = Shared.core();
  const out = [];
  for (let tab = 0; tab < Bank.TOTAL_BANK_TABS; tab++) {
    if (tab !== Bank.BANK_SEARCH_TAB_INDEX) out.push(player.getBank(tab));
  }
  return out;
}

function coins(containers, id) {
  return containers.reduce((sum, container) => sum + container.getAmount(id), 0);
}

function snapshot(containers) {
  return containers.map(container => ({ container, entries: container.getItems().map(item => item && ({
    item, id: item.getId(), amount: item.getAmount(), meta: item.clone().getMeta(),
  })) }));
}

function restore(snapshots) {
  for (const { container, entries } of snapshots) {
    for (const entry of entries) if (entry) entry.item.setId(entry.id).setAmount(entry.amount).setMeta(entry.meta);
    container.setItems(entries.map(entry => entry?.item ?? null));
    container.refreshItems();
  }
}

function sameContext(event, position, area) {
  const { player, object } = event;
  if (!Shared.alive(player) || player.getPrivateArea?.() || player.getArea() !== area) return false;
  if (!player.getLocation().equals(position) || object?.getId?.() !== creviceIds().IN || !at(object, CREVICE_IN_TILE)) return false;
  return Shared.core().World.findCacheObject(player, object.getId(), object.getLocation()) === object;
}

function bankUnlocked(event, position, area) {
  const pin = { player: event.player, feature: "kraken-instance", resume: () => {
    const player = event.player, sender = player.getPacketSender();
    if (sameContext(event, position, area) && player.getInterfaceId() < 0
      && sender.getChatboxGroupId() < 0 && !player.getEnteredAmountAction()
      && !player.getEnteredSyntaxAction() && !player.getDialogueManager().getCurrent()) {
      promptPrivate(event, position, area);
    }
  } };
  Shared.api().emitCustomEvent("bank-pin:guard", pin);
  return !pin.locked && sameContext(event, position, area);
}

function confirmPrivate(event, position, area, source) {
  const { player } = event;
  if (!sameContext(event, position, area)) return;
  if (source === "bank" && !bankUnlocked(event, position, area)) return;
  const selected = containers(player, source), id = Shared.core().ItemIdentifiers.COINS;
  if (coins(selected, id) < PRIVATE_FEE) {
    player.sendMessage("You need 25,000 coins in the selected source.");
    return;
  }
  const before = snapshot(selected), total = coins(selected, id);
  const room = Instance.create(player);
  if (!room) { player.sendMessage("The private room could not be opened."); return; }
  try {
    if (!sameContext(event, position, area)) { Instance.discard(room); return; }
    if (source === "bank" && !bankUnlocked(event, position, area)) { Instance.discard(room); return; }
    let left = PRIVATE_FEE;
    for (const container of selected) {
      const take = Math.min(left, container.getAmount(id));
      if (take > 0) container.deleteNumber(id, take);
      left -= take;
    }
    if (left || coins(selected, id) !== total - PRIVATE_FEE) throw new Error("Kraken fee debit did not complete");
    Instance.enter(room, player);
    go(player, BOSS_SIDE_TILE);
  } catch (error) {
    try { Instance.leave(player); }
    finally {
      try { Instance.discard(room); }
      finally { restore(before); player.moveTo(position); }
    }
    player.sendMessage("The private room could not be opened.");
  }
}

function promptPrivate(event, position, area) {
  if (!sameContext(event, position, area)) return;
  Shared.api().sendMultiChatboxPrompt(event.player, "Open a private room for 25,000 coins?",
    "Pay from inventory", () => confirmPrivate(event, position, area, "inventory"),
    "Pay from bank", () => confirmPrivate(event, position, area, "bank"),
    "Cancel", () => {});
}

function privateEntry(event) {
  if (!event.object || !Shared.alive(event.player)) return false;
  if (event.object.getId?.() !== creviceIds().IN || !at(event.object, CREVICE_IN_TILE)) return false;
  promptPrivate(event, event.player.getLocation().clone(), event.player.getArea());
  return true;
}

function attach(api) {
  api.onObjectInteraction("Crevice", { Enter: enter, Use: use, Private: privateEntry });
}

module.exports = { attach, enter, use };
