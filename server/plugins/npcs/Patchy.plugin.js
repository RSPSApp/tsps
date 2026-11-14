"use strict";

/**
 * Patchy, Mos Le'Harmless (https://oldschool.runescape.wiki/w/Patchy): Sew, and Talk-to's "Let me
 * see what you can do.", open his sewing interface (patchy). As captured (rsprox.net recording
 * 1039, rev 235, ticks 302-1384; facts in docs/patchy.md):
 * - the open: varp if1 = -1, script toplevel_mainmodal_open (-1, -1), the patchy modal, then
 *   if_setevents patchy:list -1..-1 IF_SCRIPT_TRIGGER, and varbit busy = 1 (cleared on close);
 * - the list is drawn by the client from the cache's patchy_data table. A pick arrives as a script
 *   trigger on patchy:list with the row's id (-1 for none), which the server sets in if1;
 * - Confirm without every ingredient: "Patchy needs the following items: <col=ef1020>A</col> &
 *   <col=ef1020>B</col>" (game message, every ingredient listed, the modal stays open);
 * - with them: the ingredients and 500 coins go, the costume piece comes, sounds 2592 and 2114
 *   (delay 10), a mesbox chat line, the modal closes for an objectbox "<name>:<br><br>Patchy takes 500 coins and sews
 *   your items together."; its Continue opens the interface again, nothing picked.
 */

const { triggerInts } = require("../interface/widgetGroup");

const INTERFACE = "patchy";
const LIST = "patchy:list";
const CONFIRM = "patchy:confirm";
const TABLE = "patchy_data";
const SELECTION_VARP = "if1";
const BUSY_VARBIT = "busy";
const MAINMODAL_OPEN_SCRIPT = 2524;
const COINS = 995;
const SEW_COST = 500;
const SEW_SOUND = 2592;
const SNIP_SOUND = 2114;
const SNIP_SOUND_DELAY = 10;
const IF_SCRIPT_TRIGGER = 1 << 23;
/** The Talk-to transcript's action for "Let me see what you can do." */
const DIALOGUE_TARGET = "Patchy";

let api = null;
let core = null;
let recipes = null;
/** The row each player last picked, while the interface is open (interface state, not saved). */
const picked = new WeakMap();

function cache() {
  return core.CacheDefinitions;
}

function required(value, what) {
  if (value === null || value === undefined) throw new Error(`Patchy: the cache has no ${what}`);
  return value;
}

/** patchy_data rows by their id column: the combined piece and its two ingredients. */
function loadRecipes() {
  if (recipes) return recipes;
  const table = required(cache().getDbTableId(TABLE), `${TABLE} table`);
  const column = (name) => required(cache().getDbColumn(table, name), `${TABLE}.${name} column`);
  const id = column("id"), combined = column("combined"), ingredients = column("ingredients");
  recipes = new Map();
  for (const row of cache().getDbTableRows(table)) {
    recipes.set(row.int(id, -1), { combined: row.int(combined, -1), ingredients: row.column(ingredients).map(Number) });
  }
  return recipes;
}

function interfaceId() {
  return required(cache().getInterfaceId(INTERFACE), `${INTERFACE} interface`);
}

function component(name) {
  return required(cache().getComponentId(name), `${name} component`);
}

function busyVarbit() {
  return required(cache().getVarbitId(BUSY_VARBIT), `${BUSY_VARBIT} varbit`);
}

function selectionVarp() {
  return required(cache().getVarpId(SELECTION_VARP), `${SELECTION_VARP} varp`);
}

function itemName(id) {
  return core.ItemDefinition.forId(id).getName();
}

function openSewing(player) {
  const sender = player.getPacketSender();
  picked.delete(player);
  sender.sendConfig(selectionVarp(), -1);
  sender.sendClientScript(MAINMODAL_OPEN_SCRIPT, -1, -1);
  sender.sendInterface(interfaceId());
  sender.sendInterfaceFlagsRange(component(LIST), -1, -1, IF_SCRIPT_TRIGGER);
  sender.sendVarbit(busyVarbit(), 1);
}

/**
 * Live clears busy when the interface is closed (rec 1039, Close). It keeps it through the sew's
 * objectbox; here it drops with the modal there, since an objectbox walked away from reports no
 * close and the flag would stay set.
 */
function closed({ player, interfaceId: closedId }) {
  if (closedId !== interfaceId()) return;
  picked.delete(player);
  player.getPacketSender().sendVarbit(busyVarbit(), 0);
}

function isOpen(player) {
  return player.getInterfaceId() === interfaceId();
}

/** The client's pick: the row's id, or -1 when it clears it. */
function pick(event) {
  const { player } = event;
  if (!event.scriptTrigger || !isOpen(player)) return;
  event.handled = true;
  const [row] = triggerInts(event.argsData);
  const selected = loadRecipes().has(row) ? row : -1;
  if (selected < 0) picked.delete(player);
  else picked.set(player, selected);
  player.getPacketSender().sendConfig(selectionVarp(), selected);
}

function sew(player, recipe) {
  const inventory = player.getInventory();
  for (const id of recipe.ingredients) inventory.delete(id, 1);
  inventory.delete(COINS, SEW_COST);
  inventory.adds(recipe.combined, 1);
  const sender = player.getPacketSender();
  sender.sendSound(SEW_SOUND, 1, 0);
  sender.sendSound(SNIP_SOUND, 1, SNIP_SOUND_DELAY);
  sender.sendInterfaceRemoval();
  const { DialogueChainBuilder, ItemStatementDialogue, ActionDialogue } = core;
  const text = `${itemName(recipe.combined)}:<br><br>Patchy takes ${SEW_COST} coins and sews your items together.`;
  // The chat history gets the box's text as a mesbox line, the breaks as spaces (rec 1039, tick 1380).
  player.getDialogueManager().startDialogues(new DialogueChainBuilder()
    .add(new ItemStatementDialogue(0, recipe.combined, text))
    .add(new ActionDialogue(1, { execute: () => reopen(player) })));
}

/** The objectbox's Continue opens the interface again, as captured. */
function reopen(player) {
  player.getDialogueManager().reset();
  player.getPacketSender().sendInterfaceRemoval();
  openSewing(player);
}

function confirm(event) {
  const { player } = event;
  if (!isOpen(player)) return;
  event.handled = true;
  const recipe = loadRecipes().get(picked.get(player));
  // Ours: Confirm with nothing picked does nothing (no capture; the client draws it unselected).
  if (!recipe) return;
  const inventory = player.getInventory();
  if (!recipe.ingredients.every((id) => inventory.contains(id))) {
    const names = recipe.ingredients.map((id) => `<col=ef1020>${itemName(id)}</col>`).join(" & ");
    player.sendMessage(`Patchy needs the following items: ${names}`);
    return;
  }
  if (inventory.getAmount(COINS) < SEW_COST) {
    // Ours: no capture or Wiki line for the ingredients carried without the coins.
    player.sendMessage(`Patchy needs <col=ef1020>${SEW_COST} coins</col> to sew those together.`);
    return;
  }
  sew(player, recipe);
}

function sewOption({ player }) {
  openSewing(player);
  return true;
}

/**
 * Talk-to's "Let me see what you can do." ends in the transcript's open_interface "Patchy". The
 * conversation closes the chatbox as it ends, so the interface opens the tick after.
 */
function dialogueOpen(event) {
  if (event.handled || event.action !== "open_interface" || event.target !== DIALOGUE_TARGET) return;
  event.handled = true;
  event.end = true;
  const { player } = event;
  core.TaskManager.submit(new (class extends core.Task {
    constructor() {
      super(1, player.getIndex(), false);
    }
    execute() {
      this.stop();
      if (player.isRegistered() && !player.getDialogueManager().isActive()) openSewing(player);
    }
  })());
}

function start(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

module.exports = {
  name: "Patchy",
  description: "Patchy's sewing interface on Mos Le'Harmless: Sew and Talk-to open it, and Confirm sews the picked costume piece for 500 coins.",
  members: true,
  register(pluginApi) {
    start(pluginApi);
    pluginApi.onNpcInteraction("Patchy", { Sew: sewOption });
    pluginApi.onCustomEvent("npc-dialogue:action", dialogueOpen);
    pluginApi.onInterfaceActionButton(component(LIST), pick);
    pluginApi.onInterfaceActionButton(component(CONFIRM), confirm);
    pluginApi.onCustomEvent("interface:closed", closed);
  },
  _test: { start, openSewing, pick, confirm, closed, dialogueOpen, loadRecipes, picked },
};
