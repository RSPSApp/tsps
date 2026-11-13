"use strict";

/**
 * What a Group Ironman becomes once they are out of their group (Wiki, Group Ironman Mode: Leaving
 * a group), chosen on the cache's "Choose your Gamemode" interface (gim_leaving):
 *
 * - Ranked (gim_competitive_button, hidden for an Unranked player): they stay a Group Ironman and
 *   lead a new group; every tradeable item they have is deleted, and they have played before
 *   (Variants.EXPERIENCED_ATTRIBUTE: they can only make groups, not join ranked ones).
 * - Unranked (gim_button): they become an Unranked Group Ironman leading a new group, items kept.
 * - Regular (main_button): they stop being an Ironman, items kept.
 *
 * Each button transmits "Select"; the client relabels the chosen one "Confirm" and a second click
 * on it confirms. The choice waits (saved) until it is made: shown at once if they are online when
 * their seven days end, else at their next login.
 * Deleted: tradeables in the inventory, worn and in the bank, and "group-ironman:wipe-tradeables"
 * { player } asks other containers' plugins to clear theirs (ours: the Wiki's list of what stays
 * and goes beyond those three is not modelled one by one).
 */

const Common = require("./Common.GroupIronman");
const Store = require("./Store.GroupIronman");
const Variants = require("./Variants.GroupIronman");
const Wipe = require("./Wipe.GroupIronman");

const WIPE_EVENT = "group-ironman:wipe-tradeables";
/** player -> the button selected once, waiting for the confirming click. */
const selected = new WeakMap();

const group = () => Common.api.core.CacheDefinitions.getInterfaceId("gim_leaving");
const uid = (name) => Common.api.core.CacheDefinitions.getComponentId(`gim_leaving:${name}`);
const CHOICES = Object.freeze({ gim_competitive_button: "ranked", gim_button: "unranked", main_button: "regular" });

function show(player) {
  selected.delete(player);
  Common.tell(player, "chooseMode");
  player.getPacketSender().sendInterface(group());
}

/** "grouping:changed" "left" / "kicked" for a formed Group Ironman group: their choice is due. */
function departed(event) {
  if (!event.group?.ironman || !event.target || !Store.get(event.groupId)?.formed) return;
  Store.setPendingChoice(event.target, true);
  const player = Common.onlinePlayer(event.target);
  if (player) show(player);
}

function login({ player }) {
  const { account } = Common.groupOf(player);
  if (account && Store.hasPendingChoice(account)) show(player);
}

/** Deletes every item a ranked leaver loses (Wipe.lost) in one container; true when anything went. */
function wipe(container) {
  let wiped = false;
  container.getItems().forEach((item, slot) => {
    if (Wipe.lost(item)) {
      container.deleteAtSlot(slot, item.getAmount(), false);
      wiped = true;
    }
  });
  return wiped;
}

function wipeTradeables(player) {
  wipe(player.getInventory());
  player.getInventory().refreshItems();
  if (wipe(player.getEquipment())) player.getEquipment().refreshItems();
  for (const bank of player.getBanks?.() ?? []) {
    if (bank && wipe(bank)) bank.sortItems?.();
  }
  Common.api.emitCustomEvent(WIPE_EVENT, { player });
}

function choose(player, choice) {
  const { group: current, account } = Common.groupOf(player);
  if (current || !account || !Store.hasPendingChoice(account)) return;
  if (choice === "ranked") {
    wipeTradeables(player);
    player.setAttribute(Variants.EXPERIENCED_ATTRIBUTE, true);
    Common.setMode(player, Common.modeOfVariant("ranked"));
  } else if (choice === "unranked") {
    player.setAttribute(Variants.EXPERIENCED_ATTRIBUTE, true);
    Common.setMode(player, Common.modeOfVariant("unranked"));
  } else {
    Common.setMode(player, "none");
  }
  Store.setPendingChoice(account, false);
  player.getPacketSender().sendInterfaceRemoval();
  if (choice !== "regular") Common.api.emitCustomEvent("grouping:create", { player });
  Common.tell(player, { ranked: "tradeablesDeleted", unranked: "becameUnranked", regular: "becameRegular" }[choice]);
  Common.api.emitCustomEvent("persistence:save", { player, reason: "group-ironman-leave" });
}

/** onInterfaceActionClick: gim_leaving's three buttons; the second click on one confirms it. */
function click(event) {
  const { player, buttonId } = event;
  if (buttonId >>> 16 !== group()) return;
  event.handled = true;
  const name = Object.keys(CHOICES).find((component) => uid(component) === buttonId);
  if (!name) return;
  if (name === "gim_competitive_button" && Common.modeOf(player) === Common.modeOfVariant("unranked")) return;
  if (selected.get(player) !== name) {
    selected.set(player, name);
    return;
  }
  selected.delete(player);
  choose(player, CHOICES[name]);
}

module.exports = { WIPE_EVENT, CHOICES, show, departed, login, wipeTradeables, choose, click };
