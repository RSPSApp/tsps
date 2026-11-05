"use strict";

// Revision 241 native style chooser: [clientscript,item_transmog_init] draws one cache
// item_transmog group around %item_transmog_active_obj. Every holiday cosmetic whose
// option changes its look (Change, Change-style, Colour, Carve, Paint) opens it.
const ITEM_TRANSMOG_INIT_SCRIPT = 6857;
const STYLE_OPTIONS = new Set(["Change", "Change-style", "Colour", "Carve", "Paint"]);
// PluginManager's worn option convention: worn ops are obj params 451.. from click 2.
const WORN_OPTION_PARAM = 451, FIRST_WORN_OPTION_CLICK = 2;
const sessions = new WeakMap();
let catalogue;

// [proc,script6854]: rows the client shows as available only after a reward.
// Rows not listed are always available. Greenman masks and Fractured Archive capes
// read Forestry/Archive unlock procs this plugin does not own, so those groups are left out.
const AVAILABILITY = {
  // [proc,script2431] reads the client varc hw22_communitygoal_current_state_idx, which only
  // clientscript 2430 sets during the 2022 event. Nothing here sends it, so the client draws
  // these rows locked and the server keeps them locked to match.
  hw22_treat_cauldron_1: () => false,
  hw22_treat_cauldron_2: () => false,
  hw22_treat_cauldron_3: () => false,
  hw22_treat_cauldron_4: () => false,
  hw23_spiderhat_02: p => varbit(p, "hw23_reward_received_4") !== 0,
  hw23_spiderhat_03: p => varbit(p, "hw23_reward_received_5") !== 0,
  hw23_spiderhat_04: p => varbit(p, "hw23_reward_received_6") !== 0,
  hw23_spiderhat_05: p => varbit(p, "hw23_reward_received_7") !== 0,
};
const UNSUPPORTED_ROW_PREFIXES = ["greenman_mask", "tfa_cape"];
let core;

function varbit(player, name) {
  const id = core.CacheDefinitions.getVarbitId(name);
  return id == null ? 0 : player.getPacketSender().getVarbit(id);
}

function data() {
  if (catalogue) return catalogue;
  const cache = core.CacheDefinitions;
  const table = cache.getDbTableId("item_transmog");
  if (table == null) throw new Error("Missing item_transmog table in active cache");
  const column = name => cache.getDbColumn(table, name);
  const groupCol = column("group"), indexCol = column("group_id"), objCol = column("namedobj");
  const rule = new Map();
  for (const [name, check] of Object.entries(AVAILABILITY)) {
    const id = cache.getDbRowId(name);
    if (id != null) rule.set(id, check);
  }
  const unsupported = row => UNSUPPORTED_ROW_PREFIXES.some(prefix => (cache.getDbRowName(row.rowId) ?? "").startsWith(prefix));
  const groups = new Map();
  for (const row of cache.getDbTableRows(table)) {
    const group = row.int(groupCol);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push({ index: row.int(indexCol), objId: row.int(objCol), rowId: row.id });
  }
  const byItem = new Map();
  for (const [group, rows] of [...groups].sort((a, b) => a[0] - b[0])) {
    if (rows.some(unsupported)) continue;
    for (const row of rows) {
      if (!byItem.has(row.objId)) byItem.set(row.objId, []);
      byItem.get(row.objId).push(group);
    }
  }
  catalogue = {
    groups, byItem, rule,
    interfaceId: cache.getInterfaceId("item_transmog"),
    entries: cache.getComponentId("item_transmog:entries_clickzones"),
    objectVarp: cache.getVarpId("item_transmog_active_obj"),
    inventoryWidget: cache.getComponentId("inventory:items"),
  };
  return catalogue;
}

function wornOption(definition, clickType) {
  const option = definition.params?.get?.(WORN_OPTION_PARAM + clickType - FIRST_WORN_OPTION_CLICK);
  return typeof option === "string" ? option : null;
}

function itemOptions(definition, worn) {
  if (!worn) return [...(definition.inventoryActions ?? [])];
  return Array.from({ length: 5 }, (_, index) => wornOption(definition, index + FIRST_WORN_OPTION_CLICK));
}

function optionAt(definition, worn, event) {
  if (event.option) return event.option;
  return worn ? wornOption(definition, event.clickType) : definition.inventoryActions?.[event.clickType - 1] ?? null;
}

function available(player, row) {
  const check = data().rule.get(row.rowId);
  return !check || check(player) === true;
}

function open(event) {
  const { player, item, slot, interfaceId } = event;
  const d = data();
  const groups = d.byItem.get(event.itemId);
  if (!groups || !item) return;
  const worn = interfaceId === core.Equipment.INVENTORY_INTERFACE_ID;
  const container = worn ? player.getEquipment() :
    (interfaceId === core.Inventory.INTERFACE_ID || interfaceId === d.inventoryWidget) ? player.getInventory() : null;
  if (!container || container.getItems()[slot] !== item || item.getId() !== event.itemId) return;
  const definition = core.CacheDefinitions.getItem(item.getId());
  const option = optionAt(definition, worn, event);
  if (!STYLE_OPTIONS.has(option)) return;
  event.handled = true;
  // Another modal, including this chooser for the item's other style option, gives way.
  if (player.getInterfaceId() > 0) player.getPacketSender().sendInterfaceRemoval();
  if (player.busy()) return;
  // The n-th style option opens the n-th group the item belongs to: a pumpkin's Colour
  // opens its colour group and Carve its face group (rev 226 recording 1686). This relies on
  // the cache listing a multi-group item's groups in its option order, true for every such item.
  const position = itemOptions(definition, worn).filter(name => STYLE_OPTIONS.has(name)).indexOf(option);
  const group = groups[Math.min(Math.max(position, 0), groups.length - 1)];
  const sender = player.getPacketSender();
  sender.sendConfig(d.objectVarp, item.getId());
  sender.sendInterface(d.interfaceId);
  // Rev 226 recording 1686: if_setevents start=0, end=<row count>, events=[OP1, OP10].
  sender.sendInterfaceFlagsRange(d.entries, 0, d.groups.get(group).length, (1 << 1) | (1 << 10));
  sender.sendClientScript(ITEM_TRANSMOG_INIT_SCRIPT, group);
  sessions.set(player, { container, slot, item, id: item.getId(), amount: item.getAmount(),
    meta: JSON.stringify(item.getMeta()), group });
}

function select(event) {
  const state = sessions.get(event.player);
  const d = data();
  if (!state || event.buttonId !== d.entries || (event.opId ?? event.action) !== 1) return;
  event.handled = true;
  const { player } = event;
  if (player.getInterfaceId() !== d.interfaceId || player.getStatus() !== core.PlayerStatus.NONE || player.getHitpoints() <= 0 ||
      state.container.getItems()[state.slot] !== state.item || state.item.getId() !== state.id ||
      state.item.getAmount() !== state.amount || JSON.stringify(state.item.getMeta()) !== state.meta) {
    sessions.delete(player);
    return;
  }
  const row = d.groups.get(state.group).find(entry => entry.index === event.slot);
  if (!row || row.objId === state.id || !available(player, row)) return;
  const oldName = core.CacheDefinitions.getItem(state.id).name;
  state.item.setId(row.objId);
  state.id = row.objId;
  state.container.refreshItems();
  if (state.container === player.getEquipment()) {
    core.BonusManager.update(player);
    player.getUpdateFlag().flag(core.Flag.APPEARANCE);
  }
  player.getPacketSender().sendConfig(d.objectVarp, row.objId);
  // Rev 226 recording 1686: the message names the item as it was before the change.
  player.sendMessage(`You change the style of your ${oldName}.`);
}

function closed({ player, interfaceId }) {
  const state = sessions.get(player);
  if (state && interfaceId === data().interfaceId) sessions.delete(player);
}
function changed({ player, interfaceId }) {
  const state = sessions.get(player);
  if (state && interfaceId !== data().interfaceId) sessions.delete(player);
}
function logout({ player }) { sessions.delete(player); }

module.exports = {
  name: "ItemStyles",
  register(api) {
    core = api.core;
    api.onItemAction(open);
    api.onInterfaceActionClick(select);
    api.onCustomEvent("interface:closed", closed);
    api.onCustomEvent("interface:changed", changed);
    api.onPlayerLogout(logout);
  },
};
