"use strict";

const { api, Bank, Item, DialogueChainBuilder, ItemStatementDialogue, StatementDialogue, ActionDialogue } = require("./Core.Construction");
const Data = require("./Data.Construction");
const Ids = require("./Ids.Construction");
const House = require("./House.Construction");

// Tip jars (rsprox captures, Wiki): guests tip coins or platinum tokens from their inventory; the
// owner gets "You can't use the tip jar to give yourself gifts." and, on Use, "Your tip jar is
// empty." or "Your tip jar contains:<br># coins<br># platinum" (the jar's item in the box), then
// takes it all to the inventory (coins first) or the bank. Setup shows "Donation notifications:
// Active/Muted" and "Attempt to bank on logout: Enabled/Disabled" and switches them. All of a
// house's jars share one balance, which stays until taken. The amount prompt, the tip and
// notification messages and the Setup menu's wording are this server's.
const COINS = Ids.obj("coins");
const PLATINUM = Ids.obj("platinum");
const TIP_JAR_ITEM = Ids.obj("poh_tipjar");
const GREEN = "004f00";
const RED = "7f0000";

function jarOf(house) {
  return house.save.tipJar ??= { coins: 0, platinum: 0, muted: false, bankOnLogout: false };
}

function jarAt(event) {
  const house = House.houseFor(event.player);
  const furniture = house?.getFurnitureAt(event.location, event.objectId, event.object?.getType() ?? 10);
  return furniture?.buildableKey === "TIP_JAR" ? house : null;
}

function use(event) {
  const house = jarAt(event);
  if (!house) return false;
  const player = event.player;
  if (house.owner !== player) return askTip(player, house), true;
  const jar = jarOf(house);
  if (!jar.coins && !jar.platinum) return say(player, "Your tip jar is empty."), true;
  const lines = [jar.coins && `${jar.coins.toLocaleString("en-US")} coins`, jar.platinum && `${jar.platinum.toLocaleString("en-US")} platinum`].filter(Boolean);
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new ItemStatementDialogue(0, TIP_JAR_ITEM, `Your tip jar contains:<br>${lines.join("<br>")}`),
    new ActionDialogue(1, { execute: () => api.sendMultiChatboxPrompt(player, "Take the tips?",
      "Take them to your inventory", () => withdraw(player, house, false),
      "Take them to your bank", () => withdraw(player, house, true),
      "Leave them", () => {}) }),
  ));
  return true;
}

function say(player, text) {
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(new ItemStatementDialogue(0, TIP_JAR_ITEM, text)));
}

function withdraw(player, house, toBank) {
  const jar = jarOf(house);
  for (const [field, itemId] of [["coins", COINS], ["platinum", PLATINUM]]) {
    const amount = jar[field];
    if (!amount) continue;
    if (toBank) {
      bank(player, itemId, amount);
    } else {
      if (!player.getInventory().contains(itemId) && player.getInventory().getFreeSlots() === 0) {
        player.sendMessage("You don't have enough inventory space.");
        break;
      }
      player.getInventory().adds(itemId, amount);
    }
    jar[field] = 0;
  }
  House.saveHouse(house);
}

function bank(player, itemId, amount) {
  player.getBank(Bank.getTabForItem(player, itemId)).add(new Item(itemId, amount), false);
}

function isIron(player) {
  const query = { player, mode: "none" };
  api.emitCustomEvent("ironman:mode", query);
  return query.mode !== "none";
}

function askTip(player, house, itemId) {
  const currencies = [[COINS, "coins"], [PLATINUM, "platinum tokens"]].filter(([id]) => (itemId ?? id) === id && player.getInventory().contains(id));
  if (!currencies.length) return player.sendMessage("You don't have any coins or platinum tokens to tip.");
  if (isIron(player) || isIron(house.owner)) {
    return player.sendMessage("Ironmen can't give or receive tips.");
  }
  const prompt = ([id, noun]) => {
    player.setEnteredAmountAction({ execute: (amount) => tip(player, house, id, noun, amount) });
    player.getPacketSender().sendEnterAmountPrompt(`How many ${noun} would you like to tip?`);
  };
  if (currencies.length === 1) return prompt(currencies[0]);
  api.sendMultiChatboxPrompt(player, "What would you like to tip?", "Coins", () => prompt(currencies[0]), "Platinum tokens", () => prompt(currencies[1]));
}

function tip(player, house, itemId, noun, amount) {
  if (House.houseFor(player) !== house || house.isDestroyed()) return;
  const given = Math.min(Math.floor(amount), player.getInventory().getAmount(itemId));
  if (given <= 0) return;
  player.getInventory().delete(itemId, given);
  const jar = jarOf(house);
  jar[itemId === COINS ? "coins" : "platinum"] += given;
  House.saveHouse(house);
  player.sendMessage(`You tip ${given.toLocaleString("en-US")} ${noun}.`);
  if (!jar.muted) house.owner.sendMessage(`${player.getDisplayName()} has tipped you ${given.toLocaleString("en-US")} ${noun}.`);
}

function tipWith(event) {
  if (event.itemId !== COINS && event.itemId !== PLATINUM) return;
  const house = jarAt(event);
  if (!house) return;
  event.handled = true;
  if (house.owner === event.player) return event.player.sendMessage("You can't use the tip jar to give yourself gifts.");
  askTip(event.player, house, event.itemId);
}

function setup(event) {
  const house = jarAt(event);
  if (!house) return false;
  const player = event.player;
  if (house.owner !== player) return player.sendMessage("Only the owner of the house can set up the tip jar."), true;
  const jar = jarOf(house);
  const state = (on, yes, no) => `<col=${on ? GREEN : RED}>${on ? yes : no}</col>`;
  player.getDialogueManager().startDialogues(new DialogueChainBuilder().add(
    new StatementDialogue(0, `Donation notifications: ${state(!jar.muted, "Active", "Muted")}<br>Attempt to bank on logout: ${state(jar.bankOnLogout, "Enabled", "Disabled")}`),
    new ActionDialogue(1, { execute: () => api.sendMultiChatboxPrompt(player, "Tip jar setup",
      jar.muted ? "Unmute donation notifications" : "Mute donation notifications", () => { jar.muted = !jar.muted; House.saveHouse(house); },
      jar.bankOnLogout ? "Stop banking tips on logout" : "Bank tips on logout", () => { jar.bankOnLogout = !jar.bankOnLogout; House.saveHouse(house); },
      "Cancel", () => {}) }),
  ));
  return true;
}

/** onPlayerLogout: the owner's tips go to the bank when they asked for it. */
function bankOnLogout({ player }) {
  const saved = House.houseStateFor(player);
  const jar = saved?.tipJar;
  if (!jar?.bankOnLogout || (!jar.coins && !jar.platinum)) return;
  if (jar.coins) bank(player, COINS, jar.coins);
  if (jar.platinum) bank(player, PLATINUM, jar.platinum);
  jar.coins = 0;
  jar.platinum = 0;
  player.setAttribute(Data.HOUSE_ATTRIBUTE, saved);
}

function attachTipJar(api) {
  api.onObjectInteraction("Tip jar", { Use: use, Setup: setup });
  api.onItemOnObject(tipWith);
  api.onPlayerLogout(bankOnLogout);
}

Object.assign(module.exports, { attachTipJar });
