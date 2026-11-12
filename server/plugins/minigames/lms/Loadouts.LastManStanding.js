/**
 * The builds, Lisa's supply chest and the settings, as captured:
 * - the supply chest (loc 29068, a multiloc Lisa's introduction unlocks) opens br_loadout (646):
 *   three columns, one per build (a Max/Med, b Zerker, c 1 Def Pure), drawn by the client from
 *   the br_loadout_* varbits; the server answers each click and drag with the varbits it changes:
 *   - a drag between two inventory slots swaps them; onto the trash, or a click, discards
 *     (sound 2381);
 *   - a click in the list adds that item to the first free slot;
 *   - the spellbook menu's sub is the spellbook's value + 1;
 *   Inferred: a drag between the inventory and a worn slot wears or takes off the item when it
 *   fits that slot. Wiki: at most 10 sharks, 3 Saradomin brews, 2 Sanfew serums and 1 of every
 *   other potion; no Lunar spellbook for a 1 Def Pure.
 * - the lobby overlay's settings button opens br_settings (476): the build the player would like
 *   (varbit br_preferred_build, the button's sub).
 * - in a game the build's levels (Wiki), its load-out, the spellbook and full energy are given.
 */
const Common = require("./Common.LastManStanding");
const Profile = require("./Profile.LastManStanding");
const { examineItem } = require("../../../src/main/typescript/elvarg/game/content/ExaminePrice");

const OP1 = 1 << 1;
const OP10 = 1 << 10;
const DEPTH2 = 2 << 17;
const DEPTH3 = 3 << 17;
const DRAG_TARGET = 1 << 20;
/** Each column's list, as captured (amenu 1-32, bmenu 1-33, cmenu 1-27: the enums' sizes - 1). */
const MENU_SIZE = { a: 32, b: 33, c: 27 };
const PURE = 2;
const LUNAR = 2;

/** The column's components, by build letter. */
const uid = (letter, name) => Common.component(`br_loadout:${letter}${name}`);

function buildItems(build) {
  return Common.core.CacheDefinitions.getEnumValues(Common.data.builds[build].enum);
}

function itemOf(build, value) {
  if (!value) return -1;
  return buildItems(build)?.get(value) ?? -1;
}

function nameOf(id) {
  return Common.core.CacheDefinitions.getItem(id)?.name ?? "";
}

/** Which column (build) and part a component uid belongs to. */
function partOf(componentUid) {
  for (let build = 0; build < 3; build++) {
    const letter = Profile.BUILD_LETTERS[build];
    for (const part of ["inventory", "menu", "trash", "spellbook_menu"]) {
      if (uid(letter, part) === componentUid) return { build, part };
    }
    for (const [slot, index] of Object.entries(Common.data.wornSlots)) {
      if (uid(letter, `slot${index}`) === componentUid) return { build, part: "worn", slot };
    }
  }
  return null;
}

// ---------------------------------------------------------------- limits

/** How many of an item a load-out may hold (Wiki's supply limits; gear: one of each). */
function limitOf(id) {
  const name = nameOf(id);
  const limits = Common.data.supplyLimits;
  if (name in limits) return limits[name];
  if (/\(\d\)$/.test(name)) return limits.potion;
  return 1;
}

function countOf(loadout, build, id) {
  const worn = Object.values(loadout.worn).filter((value) => itemOf(build, value) === id).length;
  return worn + loadout.inventory.filter((value) => itemOf(build, value) === id).length;
}

// ---------------------------------------------------------------- the chest

function open({ player }) {
  if (!Profile.tutorialDone(player)) {
    player.getPacketSender().sendMessage(Common.message("introNeeded"));
    return true;
  }
  const sender = player.getPacketSender();
  Profile.sendLoadouts(player);
  sender.sendInterfaceScript(2524, [-1, -1]);
  sender.sendSubInterface(Common.component("toplevel_osrs_stretch:mainmodal"), Common.interfaceId("br_loadout"), 0);
  for (const letter of Profile.BUILD_LETTERS) {
    sender.sendInterfaceFlagsRange(uid(letter, "inventory"), 0, 27, OP1 | OP10 | DEPTH2 | DRAG_TARGET);
    for (const index of Object.values(Common.data.wornSlots)) {
      sender.sendInterfaceFlagsRange(uid(letter, `slot${index}`), 1, 1, OP1 | OP10 | DEPTH3 | DRAG_TARGET);
    }
    sender.sendInterfaceFlagsRange(uid(letter, "trash"), -1, -1, DRAG_TARGET);
    sender.sendInterfaceFlagsRange(uid(letter, "menu"), 1, MENU_SIZE[letter], OP1 | OP10 | DEPTH3);
    sender.sendInterfaceFlagsRange(uid(letter, "spellbook_menu"), 1, 3, OP1);
  }
  return true;
}

function change(player, build, mutate) {
  const loadout = Profile.copyLoadout(Profile.loadout(player, build));
  if (mutate(loadout) === false) return;
  Profile.saveLoadout(player, build, loadout);
  const letter = Profile.BUILD_LETTERS[build];
  Common.varbit(player, `br_loadout_${letter}_spellbook`, loadout.spellbook);
  for (const slot of Object.keys(Common.data.wornSlots)) Common.varbit(player, `br_loadout_${letter}_worn_${slot}`, loadout.worn[slot] ?? 0);
  loadout.inventory.forEach((value, i) => Common.varbit(player, `br_loadout_${letter}_inv_${String(i).padStart(2, "0")}`, value ?? 0));
}

function discardSound(player) {
  player.getPacketSender().sendSound(Common.data.sounds.discard, 100, 0);
}

/** A click in a column: discard from the inventory or a worn slot, add from the list, pick a spellbook. */
function click(event) {
  const where = partOf(event.buttonId);
  if (!where) return;
  event.handled = true;
  const { player, slot } = event;
  const { build, part } = where;
  if (event.opId === 10 || event.action === 10) {
    const id = part === "menu" ? itemOf(build, slot) : null;
    if (id > 0) examineItem(player, id, 1);
    return;
  }
  if (part === "inventory") {
    change(player, build, (loadout) => {
      if (!loadout.inventory[slot]) return false;
      loadout.inventory[slot] = 0;
    });
    discardSound(player);
  } else if (part === "worn") {
    change(player, build, (loadout) => {
      if (!loadout.worn[where.slot]) return false;
      loadout.worn[where.slot] = 0;
    });
    discardSound(player);
  } else if (part === "menu") {
    const id = itemOf(build, slot);
    if (id <= 0) return;
    change(player, build, (loadout) => {
      const free = loadout.inventory.indexOf(0);
      if (free < 0 || countOf(loadout, build, id) >= limitOf(id)) return false;
      loadout.inventory[free] = slot;
    });
  } else if (part === "spellbook_menu") {
    const value = slot - 1;
    if (value < 0 || value > 2 || (build === PURE && value === LUNAR)) return;
    change(player, build, (loadout) => {
      loadout.spellbook = value;
    });
  }
}

/** The equipment slot an item is worn in, or -1. */
function equipSlot(id) {
  const type = Common.core.ItemDefinition.forId(id)?.getEquipmentType();
  return type?.getSlot() ?? -1;
}

/** Drags: inventory to inventory, to the trash, between the inventory and a worn slot. */
function drag(event) {
  const { player, packet } = event;
  const from = partOf(packet.sourceWidgetId);
  const to = partOf(packet.targetWidgetId);
  if (!from) return;
  event.handled = true;
  if (!to || to.build !== from.build) return;
  const { build } = from;
  const fromSlot = packet.sourceSlot;
  const toSlot = packet.targetSlot;
  change(player, build, (loadout) => {
    if (to.part === "trash") {
      if (from.part === "inventory" && loadout.inventory[fromSlot]) loadout.inventory[fromSlot] = 0;
      else if (from.part === "worn" && loadout.worn[from.slot]) loadout.worn[from.slot] = 0;
      else return false;
      discardSound(player);
      return;
    }
    if (from.part === "inventory" && to.part === "inventory") {
      if (fromSlot === toSlot) return false;
      [loadout.inventory[fromSlot], loadout.inventory[toSlot]] = [loadout.inventory[toSlot] ?? 0, loadout.inventory[fromSlot] ?? 0];
      return;
    }
    if (from.part === "menu" && to.part === "inventory") {
      const id = itemOf(build, fromSlot);
      if (id <= 0 || loadout.inventory[toSlot] || countOf(loadout, build, id) >= limitOf(id)) return false;
      loadout.inventory[toSlot] = fromSlot;
      return;
    }
    if (from.part === "inventory" && to.part === "worn") {
      const value = loadout.inventory[fromSlot];
      if (!value || equipSlot(itemOf(build, value)) !== Common.data.wornSlots[to.slot]) return false;
      loadout.inventory[fromSlot] = loadout.worn[to.slot] ?? 0;
      loadout.worn[to.slot] = value;
      return;
    }
    if (from.part === "worn" && to.part === "inventory") {
      const value = loadout.worn[from.slot];
      const there = loadout.inventory[toSlot] ?? 0;
      if (!value || (there && equipSlot(itemOf(build, there)) !== Common.data.wornSlots[from.slot])) return false;
      loadout.worn[from.slot] = there;
      loadout.inventory[toSlot] = value;
      return;
    }
    return false;
  });
}

// ---------------------------------------------------------------- settings

function openSettings({ player }) {
  const sender = player.getPacketSender();
  Common.varbit(player, "br_preferred_build", Profile.preferredBuild(player));
  sender.sendInterfaceScript(2524, [-1, -1]);
  sender.sendSubInterface(Common.component("toplevel_osrs_stretch:mainmodal"), Common.interfaceId("br_settings"), 0);
  sender.sendInterfaceFlagsRange(Common.component("br_settings:stats"), 0, 2, OP1);
  return true;
}

function chooseBuild({ player, slot }) {
  if (slot >= 0 && slot <= 2) Profile.setPreferredBuild(player, slot);
  return true;
}

// ---------------------------------------------------------------- in a game

/**
 * Wiki: the build's levels; captured: sent with no experience (stat packets show 0). A base level
 * is the higher of the saved one and the experience's, so 0 experience keeps the build's level;
 * no experience is gained in a game (Match), and Stash puts the real figures back.
 */
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

/** The build's load-out into the (emptied) inventory and equipment, its spellbook, full energy. */
function equip(player, build) {
  const { Item, MagicSpellbook, Flag, WeaponInterfaceManager, BonusManager, CombatSpecial } = Common.core;
  const loadout = Profile.loadout(player, build);
  giveLevels(player, build);
  const equipment = player.getEquipment();
  for (const [slot, index] of Object.entries(Common.data.wornSlots)) {
    const id = itemOf(build, loadout.worn[slot]);
    if (id <= 0) continue;
    const amount = slot === "quiver" ? Common.data.ammoAmount : 1;
    equipment.setItem(index, new Item(id, amount));
  }
  equipment.refreshItems();
  const inventory = player.getInventory();
  loadout.inventory.forEach((value, slot) => {
    const id = itemOf(build, value);
    if (id > 0) inventory.setItem(slot, new Item(id, 1));
  });
  inventory.refreshItems();
  const name = Common.data.spellbooks.values[loadout.spellbook] ?? "ANCIENT";
  const book = build === PURE && name === "LUNAR" ? MagicSpellbook.ANCIENT : MagicSpellbook[name];
  player.setSpellbook(book);
  player.getPacketSender().sendTabInterface(6, book.getInterfaceId());
  player.getCombat?.().setAutocastSpell?.(null);
  refill(player);
  WeaponInterfaceManager.assign(player);
  BonusManager.update(player);
  player.getUpdateFlag().flag(Flag.APPEARANCE);
  CombatSpecial.updateBar(player);
}

/** Health, prayer, run and special back to full (the start, and a kill: Wiki). */
function refill(player) {
  const { Skill, CombatSpecial } = Common.core;
  const skills = player.getSkillManager();
  for (const name of ["HITPOINTS", "PRAYER"]) skills.setCurrentLevel(Skill[name], skills.getMaxLevel(Skill[name]), true);
  for (const name of ["ATTACK", "STRENGTH", "DEFENCE", "RANGED", "MAGIC"]) {
    const skill = Skill[name];
    if (skills.getCurrentLevel(skill) < skills.getMaxLevel(skill)) skills.setCurrentLevel(skill, skills.getMaxLevel(skill), true);
  }
  player.setRunEnergy(100);
  player.setSpecialPercentage(100);
  CombatSpecial.updateBar(player);
  player.setPoisonDamage(0);
  player.setVenomed(false);
}

/**
 * A kill's resupply (Wiki: "supplies are all replenished"): every food and potion of the build's
 * load-out, topped back up; what doesn't fit is dropped for a minute (Wiki, 17 June 2026).
 */
function resupply(player, build, dropFor) {
  const { Item } = Common.core;
  const loadout = Profile.loadout(player, build);
  const supplies = loadout.inventory.map((value) => itemOf(build, value)).filter((id) => id > 0 && isSupply(id));
  const inventory = player.getInventory();
  // Wiki (26 August 2026): empty vials go after a kill.
  const vial = Common.objId("br_vial_empty");
  if (vial != null && inventory.getAmount(vial) > 0) inventory.delete(vial, inventory.getAmount(vial));
  const wanted = new Map();
  for (const id of supplies) wanted.set(id, (wanted.get(id) ?? 0) + 1);
  for (const [id, count] of wanted) {
    const family = familyOf(id);
    let have = inventory.getItems().filter((item) => item?.getId() === id).length;
    // Partly drunk potions of the family become full ones first, in their own slots.
    inventory.getItems().forEach((item, slot) => {
      if (have >= count || !family || !item || item.getId() <= 0 || item.getId() === id) return;
      if (familyOf(item.getId()) !== family) return;
      inventory.setItem(slot, new Item(id, 1));
      have++;
    });
    for (; have < count; have++) {
      if (inventory.getFreeSlots() > 0) inventory.add(new Item(id, 1), false);
      else dropFor?.(new Item(id, 1));
    }
  }
  inventory.refreshItems();
}

function isSupply(id) {
  const actions = Common.core.CacheDefinitions.getItem(id)?.inventoryActions ?? [];
  return actions.includes("Eat") || actions.includes("Drink");
}

/** A potion's name without its dose ("Saradomin brew"), or null for anything else. */
function familyOf(id) {
  const match = /^(.*)\(\d\)$/.exec(nameOf(id));
  return match ? match[1] : null;
}

function buildName(build) {
  return Common.data.builds[build].name;
}

/** Every clickable component of the chest's three columns. */
function columnComponents() {
  const uids = [];
  for (const letter of Profile.BUILD_LETTERS) {
    for (const part of ["inventory", "menu", "spellbook_menu"]) uids.push(uid(letter, part));
    for (const index of Object.values(Common.data.wornSlots)) uids.push(uid(letter, `slot${index}`));
  }
  return uids;
}

function attachLoadouts(api) {
  api.onObjectFirstClick([Common.locId("br_loadout_customiser")], open);
  api.onInterfaceActionButton(columnComponents(), click);
  api.onCustomEvent("player:widget-action", drag);
  api.onInterfaceActionButton(Common.component("br_lobbyoverlay:settings"), openSettings);
  api.onInterfaceActionButton(Common.component("br_settings:stats"), chooseBuild);
}

module.exports = { attachLoadouts, open, click, drag, equip, refill, resupply, giveLevels, buildName, itemOf, limitOf, partOf, isSupply };
