/**
 * Leagues III - Shattered Relics (data/league-shattered.json): Sage's Renown, the league's own
 * side panel (736) and the starting class choice (737). Fragments.LeagueMode and
 * Unlocks.LeagueMode run its other two screens; this unit opens them from the panel.
 *
 *   api.emitCustomEvent("league:award-renown", { player, amount, reason })  -> awarded
 *   api.emitCustomEvent("league:spend-renown", { player, amount })          -> spent (all or nothing)
 *   api.emitCustomEvent("league:renown", { player })                        -> renown
 *   "league:points-changed" (LeaguePoints)   a task's award pays its tier's renown (data.renown.byTaskPoints)
 *   "league:open-fragments" / "league:open-unlocks" / "league:open-tasks" { player }   from the panel
 *   "league:grant-fragment" { player, id } / "league:unlock-skill" { player, skill }  from the class
 *
 * No recording exists; the packets are the cache scripts' (data comments) and the rules the Wiki's.
 */
const fs = require("fs");
const path = require("path");
const Common = require("./Common.LeagueMode");
const Panels = require("./Panels.LeagueMode");

const RENOWN_ATTRIBUTE = "league:renown";
/** The class chosen (1-3), absent until Accept. */
const CLASS_ATTRIBUTE = "league:class";

const data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "league-shattered.json"), "utf8"));

/** Per player: the class selected on 737 but not yet accepted (the server's copy of varp 3345). */
const selected = new WeakMap();
/** Players owed the class choice once nothing is in the way. */
const awaitingChoice = new WeakSet();
/** Players whose welcome screen is up (its Play opens the choice). */
const welcomeShown = new WeakSet();

function uid(group, child) {
  return (group << 16) | child;
}

function isShattered(player) {
  return Common.leagueOf(player) === data.league;
}

function renownOf(player) {
  return Math.max(0, Number(player.getAttribute(RENOWN_ATTRIBUTE)) || 0);
}

function sendRenown(player) {
  player.getPacketSender().sendConfig(data.renown.varp, renownOf(player));
}

function awardRenown(request) {
  if (!request) return;
  request.awarded = false;
  const amount = Number(request.amount);
  if (!isShattered(request.player) || !Number.isInteger(amount) || amount <= 0) return;
  request.player.setAttribute(RENOWN_ATTRIBUTE, renownOf(request.player) + amount);
  sendRenown(request.player);
  request.awarded = true;
}

function spendRenown(request) {
  if (!request) return;
  request.spent = false;
  const amount = Number(request.amount);
  if (!isShattered(request.player) || !Number.isInteger(amount) || amount < 0 || renownOf(request.player) < amount) return;
  request.player.setAttribute(RENOWN_ATTRIBUTE, renownOf(request.player) - amount);
  sendRenown(request.player);
  request.spent = true;
}

/** A task award pays the renown of its tier, read from its points (Wiki /Tasks). */
function taskRenown({ player, points, previous }) {
  if (!isShattered(player)) return;
  const renown = Number(data.renown.byTaskPoints[Number(points) - Number(previous)]) || 0;
  if (renown > 0) awardRenown({ player, amount: renown, reason: "task" });
}

function renownQuery(request) {
  if (request) request.renown = isShattered(request.player) ? renownOf(request.player) : 0;
}

// ---- The side panel's buttons ----

function panelInfo({ player }) {
  if (!isShattered(player)) return false;
  return Panels.openInfo({ player });
}

function panelTasks({ player }) {
  if (!isShattered(player)) return false;
  Common.api.emitCustomEvent("league:open-tasks", { player });
  return true;
}

function panelFragments({ player }) {
  if (!isShattered(player)) return false;
  Common.api.emitCustomEvent("league:open-fragments", { player });
  return true;
}

function panelUnlocks({ player }) {
  if (!isShattered(player)) return false;
  Common.api.emitCustomEvent("league:open-unlocks", { player });
  return true;
}

// ---- The class choice ----

function chosen(player) {
  return Number(player.getAttribute(CLASS_ATTRIBUTE)) || 0;
}

function showClassChoice(player) {
  if (!isShattered(player) || chosen(player)) return;
  const { group, varp } = data.classChoice;
  selected.delete(player);
  const sender = player.getPacketSender();
  sender.sendConfig(varp, 0);
  sender.sendInterface(group);
}

function isChoiceOpen(player) {
  return player.getInterfaceId() === data.classChoice.group;
}

/** The choice opens once the welcome screen is gone and no other interface is up. */
function openWhenReady(player) {
  if (!awaitingChoice.has(player) || welcomeShown.has(player) || player.getInterfaceId() > 0) return;
  awaitingChoice.delete(player);
  showClassChoice(player);
}

function awaitChoice(player, ticks) {
  if (!isShattered(player) || chosen(player)) return;
  awaitingChoice.add(player);
  Common.later(player, ticks, () => openWhenReady(player));
}

function welcomeScreenShown({ player }) {
  if (player && isShattered(player)) welcomeShown.add(player);
}

function welcomePlay({ player }) {
  welcomeShown.delete(player);
  if (awaitingChoice.has(player)) Common.later(player, 1, () => openWhenReady(player));
  return false;
}

/** 737 has no close button: closed (walking away, another interface) before a class is chosen, it comes back. */
function interfaceClosed({ player, interfaceId }) {
  if (!player || !isShattered(player) || chosen(player)) return;
  if (interfaceId === data.classChoice.group || awaitingChoice.has(player)) awaitChoice(player, 1);
}

/** The bank tabs an item can go to: one already holding it, then its own tab, then any other. */
function bankTabs(player, item) {
  const { Bank } = Common.core;
  const tabs = [];
  for (let tab = 0; tab < Bank.TOTAL_BANK_TABS; tab++) if (tab !== Bank.BANK_SEARCH_TAB_INDEX) tabs.push(player.getBank(tab));
  const holding = tabs.filter((bank) => bank.contains(item));
  return [...new Set([...holding, player.getBank(Bank.getTabForItem(player, item)), ...tabs])];
}

/** The free slots a container needs for an item: none to top up a stack it holds, one for a new stack, one each otherwise (a bank stacks everything). */
function slotsNeeded(player, container, item, amount) {
  const stacks = container !== player.getInventory() || Common.core.ItemDefinition.forId(item).isStackable();
  if (!stacks) return amount;
  return container.contains(item) ? 0 : 1;
}

/**
 * Where each of a class's items goes: the inventory when it has room, otherwise a bank tab with
 * room, reserving both tab space and the bank-wide slots the kit's earlier items take.
 * Null when an item has nowhere to go.
 */
function placeKit(player, items) {
  const { Bank, Item } = Common.core;
  const taken = new Map();
  let bankSlots = Bank.freeSlots(player);
  const places = [];
  for (const [item, amount] of items) {
    const fits = (container) => {
      const needed = slotsNeeded(player, container, item, amount);
      if (container !== player.getInventory() && needed > bankSlots) return false;
      return container.getAddableAmount(new Item(item, amount)) >= amount && container.getFreeSlots() - (taken.get(container) ?? 0) >= needed;
    };
    const container = [player.getInventory(), ...bankTabs(player, item)].find(fits);
    if (!container) return null;
    const needed = slotsNeeded(player, container, item, amount);
    taken.set(container, (taken.get(container) ?? 0) + needed);
    if (container !== player.getInventory()) bankSlots -= needed;
    places.push(container);
  }
  return places;
}

function give(player, items, places) {
  const { Item } = Common.core;
  items.forEach(([item, amount], index) => {
    if (places[index] === player.getInventory()) player.getInventory().adds(item, amount);
    else places[index].add(new Item(item, amount), false);
  });
}

/** Select (737:6 / 11 / 16): its confirm panel shows that class. */
function selectClass(event) {
  const { player } = event;
  if (!isShattered(player) || !isChoiceOpen(player)) return false;
  const child = event.buttonId & 0xffff;
  const entry = Object.entries(data.classChoice.classes).find(([, row]) => row.select === child);
  if (!entry) return true;
  selected.set(player, Number(entry[0]));
  player.getPacketSender().sendConfig(data.classChoice.varp, Number(entry[0]));
  return true;
}

function declineClass({ player }) {
  if (!isShattered(player) || !isChoiceOpen(player)) return false;
  selected.delete(player);
  player.getPacketSender().sendConfig(data.classChoice.varp, 0);
  return true;
}

/**
 * Accept: the class's skill, items and fragment; the choice closes for good. Its items are placed
 * first: with no room for all of them in the inventory and bank, nothing is given and the class
 * stays unchosen.
 */
function acceptClass({ player }) {
  if (!isShattered(player) || !isChoiceOpen(player)) return false;
  const choice = selected.get(player);
  const row = data.classChoice.classes[choice];
  if (!row || chosen(player)) return true;
  const places = placeKit(player, row.items);
  if (!places) {
    player.sendMessage(data.messages.classNoRoom);
    return true;
  }
  player.setAttribute(CLASS_ATTRIBUTE, choice);
  selected.delete(player);
  Common.api.emitCustomEvent("league:unlock-skill", { player, skill: row.skill });
  Common.api.emitCustomEvent("league:grant-fragment", { player, id: row.fragment });
  give(player, row.items, places);
  player.getPacketSender().sendInterfaceRemoval();
  return true;
}

// ---- Login ----

function login({ player }) {
  if (!isShattered(player)) return;
  sendRenown(player);
  // Every login until a class is chosen, after the welcome screen and the other units' packets.
  awaitChoice(player, data.classChoice.openDelayTicks);
}

function renownCommand({ player, parts }) {
  const amount = Number(parts[1]);
  const name = parts.slice(2).join(" ").trim();
  const target = name ? Common.core.World.getPlayerByName(name) : player;
  if (!Number.isInteger(amount) || amount <= 0 || !target) {
    player.sendMessage(data.messages.renownUsage);
    return true;
  }
  const award = { player: target, amount, reason: "command" };
  awardRenown(award);
  player.sendMessage(award.awarded
    ? data.messages.renownGranted.replace("{amount}", amount).replace("{name}", target.getDisplayName()).replace("{renown}", renownOf(target))
    : data.messages.notShattered.replace("{name}", target.getDisplayName()));
  return true;
}

function buttons() {
  const { sidePanel, classChoice } = data;
  return {
    info: uid(sidePanel.group, sidePanel.info),
    tasks: uid(sidePanel.group, sidePanel.tasks),
    fragments: uid(sidePanel.group, sidePanel.fragments),
    unlocks: uid(sidePanel.group, sidePanel.unlocks),
    select: Object.values(classChoice.classes).map((row) => uid(classChoice.group, row.select)),
    decline: uid(classChoice.group, classChoice.decline),
    accept: uid(classChoice.group, classChoice.accept),
    welcomePlay: uid(classChoice.welcomePlay[0], classChoice.welcomePlay[1]),
  };
}

module.exports = function attach(api) {
  const ids = buttons();
  api.persistAttribute(RENOWN_ATTRIBUTE, 0);
  api.persistAttribute(CLASS_ATTRIBUTE, 0);
  api.onCustomEvent("league:award-renown", awardRenown);
  api.onCustomEvent("league:spend-renown", spendRenown);
  api.onCustomEvent("league:renown", renownQuery);
  api.onCustomEvent("league:points-changed", taskRenown);
  api.onCustomEvent("league:login", login);
  api.onCustomEvent("welcome-screen:shown", welcomeScreenShown);
  api.onCustomEvent("interface:closed", interfaceClosed);
  api.onInterfaceActionButton(ids.welcomePlay, welcomePlay);
  api.onInterfaceActionButton(ids.info, panelInfo);
  api.onInterfaceActionButton(ids.tasks, panelTasks);
  api.onInterfaceActionButton(ids.fragments, panelFragments);
  api.onInterfaceActionButton(ids.unlocks, panelUnlocks);
  api.onInterfaceActionButton(ids.select, selectClass);
  api.onInterfaceActionButton(ids.decline, declineClass);
  api.onInterfaceActionButton(ids.accept, acceptClass);
  api.registerCommand("renown", renownCommand, api.core.PlayerRights.DEVELOPER, "Grant Sage's Renown (Shattered Relics): ::renown <amount> [player]");
};

module.exports.data = data;
module.exports.isShattered = isShattered;
module.exports.RENOWN_ATTRIBUTE = RENOWN_ATTRIBUTE;
module.exports.CLASS_ATTRIBUTE = CLASS_ATTRIBUTE;
