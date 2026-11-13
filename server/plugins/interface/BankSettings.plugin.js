/**
 * The bank settings menu (the wrench in the bank: https://oldschool.runescape.wiki/w/Bank).
 * - Toggles: the cache's scripts flip each setting's varbit in the client, then send the click.
 *   The server keeps its own copy, saves it and restores it on login, as live does.
 * - Tab display: the dropdown's pick (bank_tab_display), kept the same way.
 * - Release all placeholders: asks first (popupoverlay, script 4212), then releases every
 *   placeholder in every tab.
 * - Bank fillers: 1, 10, 50, X or All picks bank_fillermode; Fill adds that many fillers to the
 *   main tab, up to the bank space left. A filler can't be withdrawn: its op 8 asks to clear
 *   every filler in the bank.
 */
const SETTINGS_ATTRIBUTE_PREFIX = "bank-settings:";

/** Menu toggles: bankmain component, its varbit, and the saved attribute's name. */
const TOGGLES = [
  ["incinerator_toggle", "bank_showincinerator", "incinerator"],
  ["banktut_toggle", "bank_hidebanktut", "hide-tutorial"],
  ["sideops_toggle", "bank_hidesideops", "hide-inventory-options"],
  ["bankops_toggle", "bank_bankops_toggle_on", "bank-item-options"],
  ["depositinv_toggle", "bank_hidedepositinv", "hide-deposit-inventory"],
  ["depositworn_toggle", "bank_hidedepositworn", "hide-deposit-worn"],
  ["depositcontainers_toggle", "bank_hidedepositcontainers", "hide-empty-containers"],
  ["popup_tab_forgetpos", "bank_setting_forget_popup", "forget-storage-tab"],
  ["depositpotion_toggle", "bank_depositpotion", "deposit-potion-storage"],
  ["chuggingbarrel_toggle", "bank_chugging_fill_open", "chugging-fill-open"],
];
/** The dropdown's choices are bankmain:dropdown_content's sub-components. */
const TAB_DISPLAY = ["dropdown_content", "bank_tab_display", "tab-display"];
const FILLER_MODE = [null, "bank_fillermode", "filler-mode"];
/** The saved settings: [component, varbit, attribute]; every one starts at 0. */
const SAVED = [...TOGGLES, TAB_DISPLAY, FILLER_MODE];

/** bank_fillermode, as the cache's enum 1907 sets it from these buttons (All is its default, 0). */
const FILLER_BUTTONS = [["bank_filler_all", 0], ["bank_filler_1", 1], ["bank_filler_10", 2], ["bank_filler_50", 3], ["bank_filler_x", 4]];
const FILLER_MODE_ALL = 0;
const FILLER_MODE_X = 4;
const FILLER_AMOUNTS = { 1: 1, 2: 10, 3: 50 };
/** A filler's op in the bank that asks to clear them all. */
const FILLER_CLEAR_ALL_OP = 8;

/** The cache's script 2076 puts choice N at sub-component 1 + 2N (each row's text follows it). */
const tabDisplayChoice = (sub) => (sub - 1) / 2;
/** Enum 5586's choices: first item, digit, Roman numeral, hide tab bar. */
const TAB_DISPLAY_CHOICES = 4;

const POPUP_OVERLAY = "popupoverlay";
const POPUP_TARGET = "bankmain:popup";
const POPUP_SCRIPT = 4212;
const POPUP_YES = 1;
const CLEARED_SOUND = 1413;

const TEXT = {
  clearFillers: "Clear all fillers?|This option will clear <col=ffb83f>all</col> the bank fillers throughout your "
    + "<col=ffb83f>whole bank</col>.<br><br>Are you sure?|<col=ff0000>Cancel</col>|<col=0dc10d>Clear them all</col>",
  // Ours: the Wiki has the confirmation but not its wording; this follows the fillers' popup.
  releasePlaceholders: "Release all placeholders?|This option will release <col=ffb83f>all</col> the placeholders "
    + "throughout your <col=ffb83f>whole bank</col>.<br><br>Are you sure?|<col=ff0000>Cancel</col>|<col=0dc10d>Release them all</col>",
  filled: (count) => `You add ${count} bank ${count === 1 ? "filler" : "fillers"} to your bank.`,
  full: "Not enough space in bank.",
  amountPrompt: "Enter amount:",
};

let api;
let core;
let ids;
/** The popup's pending answer, per player who has one open. */
const openPopups = new WeakMap();

/** Component and varbit ids by gameval name, looked up once the cache is loaded. */
function lookup() {
  if (ids) return ids;
  const { CacheDefinitions } = core;
  const component = (name) => CacheDefinitions.getComponentId(`bankmain:${name}`);
  const toggles = new Map();
  for (const setting of TOGGLES) toggles.set(component(setting[0]), setting);
  const fillerModes = new Map(FILLER_BUTTONS.map(([name, mode]) => [component(name), mode]));
  const varbits = new Map(SAVED.map((setting) => [setting, CacheDefinitions.getVarbitId(setting[1])]));
  ids = {
    toggles,
    fillerModes,
    varbits,
    tabDisplay: component(TAB_DISPLAY[0]),
    releasePlaceholders: component("release_placeholders"),
    fill: component("bank_filler_confirm"),
    popup: component(POPUP_TARGET.split(":")[1]),
    popupOverlay: CacheDefinitions.getInterfaceId(POPUP_OVERLAY),
    filler: core.ItemIdentifiers.BANK_FILLER,
  };
  return ids;
}

const attribute = (setting) => SETTINGS_ATTRIBUTE_PREFIX + setting[2];
const saved = (player, setting) => Number(player.getAttribute(attribute(setting))) || 0;

function save(player, setting, value) {
  player.setAttribute(attribute(setting), value);
  player.getPacketSender().sendVarbit(lookup().varbits.get(setting), value);
}

function restoreSettings({ player }) {
  const sender = player.getPacketSender();
  for (const setting of SAVED) sender.sendVarbit(lookup().varbits.get(setting), saved(player, setting));
}

/** The cache's Yes/No popup over the bank; the answer comes back as a count, 1 = Yes. */
function confirm(player, text, onYes) {
  const { popup, popupOverlay } = lookup();
  const sender = player.getPacketSender();
  // An "Enter amount:" prompt still open is aborted: its answer must not count as the popup's.
  if (player.getEnteredAmountAction?.()) sender.abortInputPrompt();
  sender.sendSubInterface(popup, popupOverlay, 1);
  sender.sendClientScript(POPUP_SCRIPT, text, popup);
  const action = {
    acceptsZero: true,
    execute(answer) {
      closePopup(player);
      if (answer !== POPUP_YES || !core.Bank.isOpen(player)) return;
      onYes();
      sender.sendSound(CLEARED_SOUND, 100, 0);
    },
  };
  openPopups.set(player, action);
  player.setEnteredAmountAction(action);
}

/** Takes the popup down; its pending answer goes with it unless another prompt replaced it. */
function closePopup(player) {
  const action = openPopups.get(player);
  if (!action) return;
  openPopups.delete(player);
  player.getPacketSender().closeSubInterface(lookup().popup);
  if (player.getEnteredAmountAction?.() === action) player.setEnteredAmountAction(null);
}

/** Every banked item (placeholders included) that matches, across the tabs. */
function bankItems(player, matches) {
  const found = [];
  for (let tab = 0; tab < core.Bank.TOTAL_BANK_TABS; tab++) {
    if (tab === core.Bank.BANK_SEARCH_TAB_INDEX) continue;
    for (const item of player.getBank(tab).getItems()) if (item && item.getId() >= 0 && matches(item)) found.push(item);
  }
  return found;
}

const isPlaceholder = (item) => item.getAmount() === 0;

function releasePlaceholders(player) {
  if (bankItems(player, isPlaceholder).length === 0) return;
  confirm(player, TEXT.releasePlaceholders, () => core.Bank.releasePlaceholders(player, 0));
}

function clearFillers(player) {
  const filler = lookup().filler;
  for (const item of bankItems(player, (item) => item.getId() === filler)) {
    item.setId(-1);
    item.setMeta(null);
  }
  player.getBank(0).refreshItems();
  api.emitCustomEvent("persistence:save", { player, reason: "bank-filler-clear" });
}

function addFillers(player, wanted) {
  const count = Math.min(wanted, core.Bank.freeSlots(player));
  if (count <= 0) {
    player.sendMessage(TEXT.full);
    return;
  }
  const bank = player.getBank(0);
  for (let added = 0; added < count; added++) bank.setItem(bank.freeSlot(), new core.Item(lookup().filler, 1));
  bank.refreshItems();
  player.sendMessage(TEXT.filled(count));
  api.emitCustomEvent("persistence:save", { player, reason: "bank-filler-add" });
}

function fill(player) {
  const mode = saved(player, FILLER_MODE);
  if (mode === FILLER_MODE_ALL) addFillers(player, core.Bank.freeSlots(player));
  else if (mode === FILLER_MODE_X) askFillerAmount(player);
  else addFillers(player, FILLER_AMOUNTS[mode] ?? 0);
}

/** Ours: X asks for the amount when filling (the bank's remembered withdraw-X stays as it was). */
function askFillerAmount(player) {
  player.setEnteredAmountAction({
    execute(amount) {
      if (core.Bank.isOpen(player)) addFillers(player, amount);
    },
  });
  player.getPacketSender().sendEnterAmountPrompt(TEXT.amountPrompt);
}

/**
 * "player:widget-action": any other click in the bank takes an open popup down unanswered. The settings menu's
 * buttons are handled here while the bank is open; like the bank's own ops, one with the "Enter amount:" prompt
 * still open aborts it unless it asked for an amount again.
 */
function menuClick(event) {
  const { player, packet } = event;
  if (packet.groupId !== core.Bank.MAIN_INTERFACE_ID && packet.groupId !== core.Bank.SIDE_INTERFACE_ID) return;
  closePopup(player);
  if (packet.groupId !== core.Bank.MAIN_INTERFACE_ID || !core.Bank.isOpen(player)) return;
  const pending = player.getEnteredAmountAction?.();
  if (!menuButton(player, packet)) return;
  event.handled = true;
  if (pending && player.getEnteredAmountAction?.() === pending) player.getPacketSender().abortInputPrompt();
}

function menuButton(player, packet) {
  const known = lookup();
  const toggle = known.toggles.get(packet.widgetId);
  if (toggle) save(player, toggle, saved(player, toggle) ? 0 : 1);
  else if (known.fillerModes.has(packet.widgetId)) save(player, FILLER_MODE, known.fillerModes.get(packet.widgetId));
  else if (packet.widgetId === known.tabDisplay && Number.isInteger(packet.slot)) chooseTabDisplay(player, packet.slot);
  else if (packet.widgetId === known.releasePlaceholders) releasePlaceholders(player);
  else if (packet.widgetId === known.fill) fill(player);
  else return false;
  return true;
}

function chooseTabDisplay(player, sub) {
  const choice = tabDisplayChoice(sub);
  if (Number.isInteger(choice) && choice >= 0 && choice < TAB_DISPLAY_CHOICES) save(player, TAB_DISPLAY, choice);
}

/** Bank.ITEM_OP_EVENT: a filler is never withdrawn; its op 8 asks to clear them all. */
function fillerOp(event) {
  if (event.item.getId() !== lookup().filler) return;
  event.handled = true;
  if (event.op === FILLER_CLEAR_ALL_OP) confirm(event.player, TEXT.clearFillers, () => clearFillers(event.player));
}

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  for (const setting of SAVED) pluginApi.persistAttribute(attribute(setting), 0);
}

module.exports = {
  name: "BankSettings",
  register(pluginApi) {
    init(pluginApi);
    pluginApi.onPlayerLogin(restoreSettings);
    pluginApi.onCustomEvent("player:widget-action", menuClick);
    pluginApi.onCustomEvent("bank:item-op", fillerOp);
  },
};
