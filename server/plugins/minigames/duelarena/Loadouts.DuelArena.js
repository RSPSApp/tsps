/**
 * PvP Arena builds and load-outs, as captured (rsprox 20261106T111454, 20261107T010112,
 * 20261107T023226, world 578):
 * - three builds, 0 Max/Med, 1 Zerker, 2 1 Def Pure (the copy messages name them), each with
 *   its own load-out: varbits pvpa_loadout_{a,b,c}_* hold indices into enum 4390 (worn slots,
 *   28 inventory slots) and the spellbook (enum 4389);
 * - the lobby supplies chest opens pvp_arena_stagingarea_supplies (758): one column per build,
 *   buildtypes picks the build shown (pvpa_transmit_build). The duel screen (757) has the same
 *   columns. Each click and drag is answered with the varbits it changes:
 *   - op 2 on an inventory slot discards it; a drag swaps two slots, wears an item on its slot,
 *     takes one off, or throws one in the trash;
 *   - a click in the items list adds that item to the first free slot; seek asks for an item
 *     (meslayer_mode14 over enum 4391) and scrolls the list to it (script 6319);
 *   - the spellbook menu's sub is the spellbook's value + 1;
 * - "Load-outs" on another player: "Sending load-out sharing offer..." (trade), and they get
 *   "<name> wishes to share load-outs with you." (tradereq); once both have offered, each sees
 *   the other's load-outs in pvp_arena_stagingarea_shareloadout (421), one tab per build: the
 *   tab's build (pvpa_transmit_build), its spellbook (..._opponentspellbook) and its items on
 *   inv 207 (worn slots 0-13, then the 28 inventory slots). Closing it closes the other's:
 *   "<name> has closed the menu.";
 * - Copy (421, and the duel screen's opponent_copy) asks through popupoverlay (289, script
 *   4212); the answer comes back as a count, 1 Yes and 0 No.
 * Inferred: a click (op 1) on an inventory or worn slot discards too, as Last Man Standing's
 * chest does; load-outs carry no supply limits (none are captured).
 */
const Common = require("./Common.DuelArena");

const BUILD_LETTERS = ["a", "b", "c"];
const INVENTORY_SIZE = 28;
const WORN_SIZE = 14;
const VIEW_INV = 207;
const POPUP = "popupoverlay";
const POPUP_SCRIPT = 4212;
const SEEK_SCRIPT = 750;
const SEEK_ENUM = 4391;
const SCROLL_TO_SCRIPT = 6319;
const SUPPLIES = "pvp_arena_stagingarea_supplies";
const SHARE = "pvp_arena_stagingarea_shareloadout";
const LOADOUTS_OPTION = 4;
const SPELLBOOKS = 3;

/** Editors (758, 757) by interface name: who may edit which column, and who to tell. */
const editors = new Map();
/** Load-out sharing: offers made (player -> player), and who views whose load-outs. */
const offers = new Map();
const viewing = new Map();
/** The share screen's tab each viewer last picked. */
const shown = new WeakMap();

// ---------------------------------------------------------------- the load-outs

function buildName(build) {
  return Common.data.builds[build]?.name ?? "";
}

function preferredBuild(player) {
  const build = Common.number(player, Common.BUILD_ATTRIBUTE);
  return build >= 0 && build <= 2 ? build : 0;
}

function setPreferredBuild(player, build) {
  player.setAttribute(Common.BUILD_ATTRIBUTE, build);
  Common.varbit(player, "pvpa_transmit_build", build);
}

/** The items list's last index: enum 4390's highest key (its entries are 0 to N). */
function itemsListEnd() {
  const values = Common.core.CacheDefinitions.getEnumValues(Common.data.itemEnum);
  return values ? Math.max(0, ...values.keys()) : 0;
}

/** A load-out value as an item index: an integer the items list holds, or 0 (empty). */
function entry(value) {
  return Number.isInteger(value) && value > 0 && value <= itemsListEnd() ? value : 0;
}

/**
 * A load-out in its fixed shape: the spellbook (0-2), the named worn slots and exactly 28
 * inventory slots, each a valid item index. Saves and copies go through it, so a load-out can
 * never hold more slots or other keys than the screens draw.
 */
function copyLoadout(loadout) {
  const spellbook = Number.isInteger(loadout?.spellbook) && loadout.spellbook >= 0 && loadout.spellbook < SPELLBOOKS ? loadout.spellbook : 0;
  const worn = {};
  for (const slot of Object.keys(Common.data.wornSlots)) {
    const value = entry(loadout?.worn?.[slot]);
    if (value) worn[slot] = value;
  }
  const inventory = Array.from({ length: INVENTORY_SIZE }, (_, slot) => entry(loadout?.inventory?.[slot]));
  return { spellbook, worn, inventory };
}

/** The player's load-out for a build (0-2), the captured default until they change it. */
function loadout(player, build) {
  const saved = player.getAttribute(Common.LOADOUTS_ATTRIBUTE);
  const own = saved?.[BUILD_LETTERS[build]];
  return copyLoadout(own ?? Common.data.builds[build].default);
}

function saveLoadout(player, build, value) {
  const saved = {};
  for (const letter of BUILD_LETTERS) {
    const own = player.getAttribute(Common.LOADOUTS_ATTRIBUTE)?.[letter];
    if (own) saved[letter] = copyLoadout(own);
  }
  saved[BUILD_LETTERS[build]] = copyLoadout(value);
  player.setAttribute(Common.LOADOUTS_ATTRIBUTE, saved);
}

function sendLoadout(player, build, value = loadout(player, build)) {
  const letter = BUILD_LETTERS[build];
  Common.varbit(player, `pvpa_loadout_${letter}_spellbook`, value.spellbook ?? 0);
  for (const slot of Object.keys(Common.data.wornSlots)) Common.varbit(player, `pvpa_loadout_${letter}_worn_${slot}`, value.worn[slot] ?? 0);
  for (let i = 0; i < INVENTORY_SIZE; i++) Common.varbit(player, `pvpa_loadout_${letter}_inv_${String(i).padStart(2, "0")}`, value.inventory[i] ?? 0);
}

/** Every load-out varbit, as the supplies chest sends them before it opens. */
function sendLoadouts(player) {
  for (let build = 0; build < BUILD_LETTERS.length; build++) sendLoadout(player, build);
}

function itemOf(value) {
  if (!value) return -1;
  return Common.core.CacheDefinitions.getEnumValues(Common.data.itemEnum)?.get(value) ?? -1;
}

function valueOf(itemId) {
  const values = Common.core.CacheDefinitions.getEnumValues(Common.data.itemEnum);
  if (!values) return 0;
  for (const [value, id] of values) if (id === itemId && value > 0) return value;
  return 0;
}

function equipSlot(id) {
  return Common.core.ItemDefinition.forId(id)?.getEquipmentType()?.getSlot() ?? -1;
}

/** The load-out as items: worn slots by equipment index, then the inventory (inv 207's order). */
function itemsOf(value) {
  const items = new Array(WORN_SIZE + INVENTORY_SIZE).fill(null);
  for (const [slot, index] of Object.entries(Common.data.wornSlots)) {
    const id = itemOf(value.worn[slot]);
    if (id > 0) items[index] = { id, amount: slot === "quiver" ? Common.data.quiverAmount : 1 };
  }
  value.inventory.forEach((entry, slot) => {
    const id = itemOf(entry);
    if (id > 0) items[WORN_SIZE + slot] = { id, amount: 1 };
  });
  return items;
}

/** Another player's load-out for a build, as the duel screen and the share screen draw it. */
function sendView(viewer, owner, build, script = -1) {
  const value = loadout(owner, build);
  Common.varbit(viewer, "pvpa_unrankedduel_transmit_opponentspellbook", value.spellbook ?? 0);
  const items = itemsOf(value);
  const slots = items.map((item, slot) => ({ slot, itemId: item?.id ?? -1, quantity: item?.amount ?? 0 }));
  viewer.getPacketSender().sendInterfaceScript(script, [], undefined, undefined, { [VIEW_INV]: { capacity: items.length, slots } });
}

// ---------------------------------------------------------------- in a fight

/** Captured: the build's levels, sent with no experience; Stash puts the real figures back. */
function giveLevels(player, build) {
  const { Skill } = Common.core;
  const skills = player.getSkillManager();
  for (const [name, level] of Object.entries(Common.data.builds[build].levels)) {
    const skill = Skill[name];
    skills.setMaxLevels(skill, level, false);
    skills.setExperiences(skill, 0, false);
    skills.setCurrentLevel(skill, level, true);
  }
}

/**
 * A load-out item, ready to fight with: charged items (a toxic staff's scales) come full, from
 * whichever plugin keeps that item's charges ("item:fill-charges").
 */
function supplied(player, id, amount) {
  const item = new Common.core.Item(id, amount);
  Common.api.emitCustomEvent("item:fill-charges", { player, item, handled: false });
  return item;
}

/** The build's load-out into the (emptied) inventory and equipment, its spellbook, full energy. */
function equip(player, build) {
  const { MagicSpellbook, Flag, WeaponInterfaceManager, BonusManager, CombatSpecial } = Common.core;
  const value = loadout(player, build);
  giveLevels(player, build);
  const items = itemsOf(value);
  const equipment = player.getEquipment();
  for (let slot = 0; slot < WORN_SIZE; slot++) {
    if (items[slot]) equipment.setItem(slot, supplied(player, items[slot].id, items[slot].amount));
  }
  equipment.refreshItems();
  const inventory = player.getInventory();
  for (let slot = 0; slot < INVENTORY_SIZE; slot++) {
    const item = items[WORN_SIZE + slot];
    if (item) inventory.setItem(slot, supplied(player, item.id, item.amount));
  }
  inventory.refreshItems();
  const book = MagicSpellbook[Common.data.spellbooks.values[value.spellbook ?? 0]] ?? MagicSpellbook.ANCIENT;
  player.setSpellbook(book);
  player.getPacketSender().sendTabInterface(Common.MAGIC_TAB, book.getInterfaceId());
  player.getCombat?.().setAutocastSpell?.(null);
  player.setRunEnergy(100);
  player.setSpecialPercentage(100);
  WeaponInterfaceManager.assign(player);
  BonusManager.update(player);
  player.getUpdateFlag().flag(Flag.APPEARANCE);
  CombatSpecial.updateBar(player);
}

// ---------------------------------------------------------------- copying

function copyFrom(player, owner, build) {
  const value = copyLoadout(loadout(owner, build));
  saveLoadout(player, build, value);
  sendLoadout(player, build, value);
  player.sendMessage(Common.message("copied", { build: buildName(build), name: owner.getDisplayName() }));
}

/** Copy's question (popupoverlay on the screen's popup layer): 1 copies, 0 keeps theirs. */
function askCopy(player, owner, build, popup, onCopied) {
  const sender = player.getPacketSender();
  const target = Common.component(popup);
  sender.sendSubInterface(target, Common.interfaceId(POPUP), 1);
  sender.sendClientScript(POPUP_SCRIPT, Common.message("copyPopup", { name: owner.getDisplayName(), build: buildName(build) }), target);
  player.setEnteredAmountAction({
    acceptsZero: true,
    execute(answer) {
      sender.closeInterface(Common.interfaceId(POPUP));
      if (answer !== 1) {
        player.sendMessage(Common.message("notChanged"));
        return;
      }
      copyFrom(player, owner, build);
      onCopied?.();
    },
  });
}

// ---------------------------------------------------------------- the editors

/** The components of an editor's column, by part. */
function columnUid(iface, build, part) {
  return Common.component(`${iface}:${build}${part}`);
}

function partOf(iface, uid) {
  for (let build = 0; build < 3; build++) {
    for (const part of ["inventory", "items_list", "trash", "spellbook_menu", "seek"]) {
      if (columnUid(iface, build, part) === uid) return { build, part };
    }
    for (const [slot, index] of Object.entries(Common.data.wornSlots)) {
      if (columnUid(iface, build, `slot${index}`) === uid) return { build, part: "worn", slot };
    }
  }
  return null;
}

/** The columns' events, as both screens set them. */
function sendColumnEvents(player, iface) {
  const { OP1, OP2, OP10, DEPTH2, DEPTH3, DRAGTARGET } = Common.EVENTS;
  const sender = player.getPacketSender();
  for (let build = 0; build < 3; build++) {
    sender.sendInterfaceFlagsRange(columnUid(iface, build, "inventory"), 0, 27, OP1 | OP2 | OP10 | DEPTH2 | DRAGTARGET);
  }
  for (const index of Object.values(Common.data.wornSlots).sort((a, b) => b - a)) {
    for (let build = 0; build < 3; build++) {
      sender.sendInterfaceFlagsRange(columnUid(iface, build, `slot${index}`), 1, 1, OP1 | OP10 | DEPTH3 | DRAGTARGET);
    }
  }
  for (let build = 0; build < 3; build++) sender.sendInterfaceFlagsRange(columnUid(iface, build, "trash"), -1, -1, DRAGTARGET);
  const end = itemsListEnd();
  for (let build = 0; build < 3; build++) sender.sendInterfaceFlagsRange(columnUid(iface, build, "items_list"), 1, end, OP1 | OP10 | DEPTH3);
  for (let build = 0; build < 3; build++) sender.sendInterfaceFlagsRange(columnUid(iface, build, "spellbook_menu"), 1, 3, OP1);
}

function editable(player, iface, build) {
  const editor = editors.get(iface);
  return !!editor && player.getInterfaceId() === Common.interfaceId(iface) && editor.canEdit(player, build);
}

function change(player, iface, build, mutate) {
  const value = copyLoadout(loadout(player, build));
  if (mutate(value) === false) return;
  saveLoadout(player, build, value);
  sendLoadout(player, build, value);
  editors.get(iface)?.changed?.(player, build);
}

function discardSound(player) {
  player.getPacketSender().sendSound(Common.data.sounds.discard, 100, 0);
}

function examine(player, id) {
  if (id > 0) player.sendMessage(Common.core.ItemDefinition.forId(id)?.getExamine() ?? "");
}

/**
 * Whether a slot the client sent fits the part it names: 0-27 in an inventory, an item index
 * in the items list, 1-3 in the spellbook menu. Anything else is a forged packet.
 */
function validSlot(part, slot) {
  if (part === "inventory") return Number.isInteger(slot) && slot >= 0 && slot < INVENTORY_SIZE;
  if (part === "items_list") return entry(slot) > 0;
  if (part === "spellbook_menu") return Number.isInteger(slot) && slot >= 1 && slot <= SPELLBOOKS;
  return true;
}

function click(iface, event) {
  const where = partOf(iface, event.buttonId);
  if (!where) return false;
  event.handled = true;
  const { player } = event;
  const slot = event.slot ?? -1;
  const { build, part } = where;
  const op = event.opId ?? event.action;
  if (!validSlot(part, slot)) return true;
  if (op === 10) {
    const value = part === "items_list" ? slot : part === "inventory" ? loadout(player, build).inventory[slot] : loadout(player, build).worn[where.slot];
    examine(player, itemOf(value));
    return true;
  }
  if (part === "seek") return seek(player, iface, build), true;
  if (!editable(player, iface, build)) return true;
  if (part === "inventory") {
    change(player, iface, build, (value) => {
      if (!value.inventory[slot]) return false;
      value.inventory[slot] = 0;
    });
    discardSound(player);
  } else if (part === "worn") {
    change(player, iface, build, (value) => {
      if (!value.worn[where.slot]) return false;
      value.worn[where.slot] = 0;
    });
    discardSound(player);
  } else if (part === "items_list") {
    if (itemOf(slot) <= 0) return true;
    change(player, iface, build, (value) => {
      const free = value.inventory.indexOf(0);
      if (free < 0) return false;
      value.inventory[free] = slot;
    });
  } else if (part === "spellbook_menu") {
    const book = slot - 1;
    if (book < 0 || book > 2) return true;
    change(player, iface, build, (value) => {
      value.spellbook = book;
    });
  }
  return true;
}

/** Seek: an item search, then the list scrolls to it (captured script 6319). */
function seek(player, iface, build) {
  player.setEnteredSyntaxAction({
    execute: (input) => {
      const id = Number(input);
      if (!Number.isInteger(id) || !valueOf(id)) return;
      player.getPacketSender().sendClientScript(SCROLL_TO_SCRIPT, build, id,
        columnUid(iface, build, "items_list"), Common.component(`${iface}:${build}items_scrollbar`));
    },
  });
  player.getPacketSender().sendInterfaceScript(SEEK_SCRIPT, [Common.message("seek"), 0, SEEK_ENUM, 1]);
}

function drag(iface, event) {
  const { player, packet } = event;
  const from = partOf(iface, packet.sourceWidgetId);
  if (!from) return false;
  event.handled = true;
  const to = partOf(iface, packet.targetWidgetId);
  if (!to || to.build !== from.build || !editable(player, iface, from.build)) return true;
  const fromSlot = packet.sourceSlot;
  const toSlot = packet.targetSlot;
  if (!validSlot(from.part, fromSlot) || !validSlot(to.part, toSlot)) return true;
  change(player, iface, from.build, (value) => {
    if (to.part === "trash") {
      if (from.part === "inventory" && value.inventory[fromSlot]) value.inventory[fromSlot] = 0;
      else if (from.part === "worn" && value.worn[from.slot]) value.worn[from.slot] = 0;
      else return false;
      discardSound(player);
      return;
    }
    if (from.part === "inventory" && to.part === "inventory") {
      if (fromSlot === toSlot) return false;
      [value.inventory[fromSlot], value.inventory[toSlot]] = [value.inventory[toSlot] ?? 0, value.inventory[fromSlot] ?? 0];
      return;
    }
    if (from.part === "items_list" && to.part === "inventory") {
      if (itemOf(fromSlot) <= 0 || value.inventory[toSlot]) return false;
      value.inventory[toSlot] = fromSlot;
      return;
    }
    if (from.part === "inventory" && to.part === "worn") {
      const moved = value.inventory[fromSlot];
      if (!moved || equipSlot(itemOf(moved)) !== Common.data.wornSlots[to.slot]) return false;
      value.inventory[fromSlot] = value.worn[to.slot] ?? 0;
      value.worn[to.slot] = moved;
      return;
    }
    if (from.part === "worn" && to.part === "inventory") {
      const moved = value.worn[from.slot];
      const there = value.inventory[toSlot] ?? 0;
      if (!moved || (there && equipSlot(itemOf(there)) !== Common.data.wornSlots[from.slot])) return false;
      value.worn[from.slot] = there;
      value.inventory[toSlot] = moved;
      return;
    }
    return false;
  });
  return true;
}

/**
 * Makes `iface`'s three columns an editor. `canEdit(player, build)` says which columns take
 * changes; `changed(player, build)` hears each change.
 */
function registerEditor(iface, options) {
  editors.set(iface, options);
}

function editorClick(event) {
  for (const iface of editors.keys()) if (click(iface, event)) return;
}

function editorDrag(event) {
  for (const iface of editors.keys()) if (drag(iface, event)) return;
}

function editorComponents() {
  const uids = [];
  for (const iface of [SUPPLIES, "pvp_arena_unrankedduel"]) {
    for (let build = 0; build < 3; build++) {
      for (const part of ["inventory", "items_list", "spellbook_menu", "seek"]) uids.push(columnUid(iface, build, part));
      for (const index of Object.values(Common.data.wornSlots)) uids.push(columnUid(iface, build, `slot${index}`));
    }
  }
  return uids.filter((uid) => uid != null);
}

// ---------------------------------------------------------------- the supplies chest

function openChest({ player }) {
  const sender = player.getPacketSender();
  Common.varbit(player, "pvpa_transmit_caneditbuild", 0);
  Common.varbit(player, "pvpa_transmit_battletype", 0);
  Common.varbit(player, "pvpa_transmit_build", preferredBuild(player));
  sendLoadouts(player);
  Common.openModal(player, SUPPLIES);
  sender.sendInterfaceFlagsRange(Common.component(`${SUPPLIES}:top`), 0, 0, Common.EVENTS.OP1);
  sendColumnEvents(player, SUPPLIES);
  sender.sendInterfaceFlagsRange(Common.component(`${SUPPLIES}:buildtypes`), 0, 2, Common.EVENTS.OP1);
  return true;
}

function chooseChestBuild({ player, slot }) {
  if (slot >= 0 && slot <= 2) setPreferredBuild(player, slot);
  return true;
}

// ---------------------------------------------------------------- sharing

function nearby(a, b) {
  return a.getLocation().getZ() === b.getLocation().getZ() && a.getPrivateArea() === b.getPrivateArea()
    && a.getLocation().getDistance(b.getLocation()) <= 16;
}

/** Load-outs (player option 4 in the Emir's Arena): an offer, or the answer to theirs. */
function offerShare(player, target) {
  if (!nearby(player, target) || viewing.has(player) || viewing.has(target)) return;
  if (offers.get(target) === player) {
    offers.delete(target);
    offers.delete(player);
    openShare(player, target);
    openShare(target, player);
    return;
  }
  offers.set(player, target);
  Common.chat(player, Common.CHAT.TRADE, Common.message("sharing"));
  Common.chat(target, Common.CHAT.TRADEREQ, Common.message("shareOffer"), player);
}

function openShare(viewer, owner) {
  const sender = viewer.getPacketSender();
  const { OP1, OP10 } = Common.EVENTS;
  const build = preferredBuild(owner);
  Common.varbit(viewer, "pvpa_transmit_build", build);
  sendView(viewer, owner, build);
  Common.openModal(viewer, SHARE);
  viewing.set(viewer, owner);
  sender.sendString(`View & Copy Load-outs: ${owner.getDisplayName()}`, Common.component(`${SHARE}:title`));
  sender.sendInterfaceFlagsRange(Common.component(`${SHARE}:inventory`), 0, 27, OP1 | OP10);
  for (const index of Object.values(Common.data.wornSlots).sort((a, b) => b - a)) {
    sender.sendInterfaceFlagsRange(Common.component(`${SHARE}:slot${index}`), 1, 1, OP10);
  }
}

/** A build's tab: that build's load-out of theirs (and the build Copy takes). */
function shareTab(event) {
  const { player } = event;
  const owner = viewing.get(player);
  const build = [0, 1, 2].find((b) => Common.component(`${SHARE}:tab_equipment${b}`) === event.buttonId);
  if (!owner || build == null) return true;
  shown.set(player, build);
  Common.varbit(player, "pvpa_transmit_build", build);
  sendView(player, owner, build);
  return true;
}

function shareCopy({ player }) {
  const owner = viewing.get(player);
  if (!owner) return true;
  askCopy(player, owner, shownBuild(player), `${SHARE}:popup`);
  return true;
}

function shownBuild(player) {
  return shown.get(player) ?? preferredBuild(viewing.get(player));
}

function shareClosed({ player, interfaceId }) {
  if (interfaceId !== Common.interfaceId(SHARE)) return;
  const owner = viewing.get(player);
  if (!owner) return;
  viewing.delete(player);
  shown.delete(player);
  if (viewing.get(owner) === player) {
    viewing.delete(owner);
    shown.delete(owner);
    owner.sendMessage(Common.message("closedMenu", { name: player.getDisplayName() }));
    owner.getPacketSender().sendInterfaceRemoval();
  }
}

function forget({ player }) {
  offers.delete(player);
  for (const [from, to] of offers) if (to === player) offers.delete(from);
  const owner = viewing.get(player);
  if (owner) shareClosed({ player, interfaceId: Common.interfaceId(SHARE) });
}

function shareOption(event) {
  if (event.option !== LOADOUTS_OPTION || !loadoutsOffered(event.player)) return;
  event.handled = true;
  offerShare(event.player, event.target);
}

/** Set by the Emir's Arena's menu: whether a player's option 4 reads "Load-outs" now. */
let loadoutsOffered = () => false;

function attachLoadouts(api, { offersLoadouts }) {
  loadoutsOffered = offersLoadouts;
  api.persistAttribute(Common.LOADOUTS_ATTRIBUTE, null);
  api.persistAttribute(Common.BUILD_ATTRIBUTE, 0);
  // By gameval id, not name: the chest's name is "Supplies", which other locs share.
  api.onObjectFirstClick([Common.locId("pvpa_lobby_supplies_chest")], openChest);
  api.onInterfaceActionButton(Common.component(`${SUPPLIES}:buildtypes`), chooseChestBuild);
  api.onInterfaceActionButton(editorComponents(), editorClick);
  api.onCustomEvent("player:widget-action", editorDrag);
  api.onInterfaceActionButton([0, 1, 2].map((b) => Common.component(`${SHARE}:tab_equipment${b}`)), shareTab);
  api.onInterfaceActionButton(Common.component(`${SHARE}:copy`), shareCopy);
  api.onCustomEvent("interface:closed", shareClosed);
  api.onPlayerOption(shareOption);
  api.onPlayerLogout(forget);
  api.onPlayerDisconnect(forget);
}

registerEditor(SUPPLIES, { canEdit: () => true });

module.exports = {
  attachLoadouts,
  registerEditor,
  sendColumnEvents,
  sendLoadouts,
  sendView,
  askCopy,
  equip,
  loadout,
  preferredBuild,
  setPreferredBuild,
  buildName,
  itemOf,
  itemsOf,
  BUILD_LETTERS,
  LOADOUTS_OPTION,
  _test: { offers, viewing, change, click, drag, partOf },
};
