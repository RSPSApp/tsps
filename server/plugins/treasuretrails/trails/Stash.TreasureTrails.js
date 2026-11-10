"use strict";

// STASH units (Wiki "STASH"): an emote step's hidey-hole loc is built with Construction,
// then stores that step's full outfit. The loc is a multiloc on its own cache varbit.
const Catalogue = require("./Catalogue.TreasureTrails");
const Runtime = require("./Runtime.TreasureTrails");
const { TIERS } = require("./Tiers.TreasureTrails");
const BUILT_ATTRIBUTE = "treasure-trails:stash-built";
const STORED_ATTRIBUTE = "treasure-trails:stash-stored";
const NAILS_PER_UNIT = 10;
const PLANKS_PER_UNIT = 2;
let api;
let core;
let units;

/** Every STASH unit by its base loc id, with the outfit of the emote step it serves. */
function stashes() {
  if (units) return units;
  units = new Map();
  for (const tier of TIERS) {
    if (!tier.stash) continue;
    for (const step of Runtime.data(tier).steps) {
      if (step.family !== "emote" || !step.stash) continue;
      const definition = core.CacheDefinitions.getObject(step.stash.locId);
      units.set(step.stash.locId, { tier, step, location: step.stash.location, varbit: definition?.transformVarbit ?? -1 });
    }
  }
  return units;
}

function built(player) {
  const value = player.getAttribute(BUILT_ATTRIBUTE);
  return Array.isArray(value) ? value : [];
}

function stored(player) {
  const value = player.getAttribute(STORED_ATTRIBUTE);
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function nails(inventory) {
  const I = core.ItemIdentifiers;
  // Any one metal except dragon (Wiki "STASH": dragon nails do not work).
  return [I.BRONZE_NAILS, I.IRON_NAILS, I.STEEL_NAILS, I.BLACK_NAILS, I.MITHRIL_NAILS, I.ADAMANTITE_NAILS, I.RUNE_NAILS]
    .find(id => count(inventory, id) >= NAILS_PER_UNIT);
}

function count(inventory, id) {
  return inventory.getItems().reduce((sum, item) => sum + (item && item.getId() === id ? item.getAmount() : 0), 0);
}

function build(player, unit) {
  const { stash } = unit.tier;
  const inventory = player.getInventory();
  const I = core.ItemIdentifiers;
  if (player.getSkillManager().getCurrentLevel(core.Skill.CONSTRUCTION) < stash.level) {
    player.sendMessage(`You need a Construction level of ${stash.level} to build this STASH unit.`);
    return;
  }
  const nail = nails(inventory);
  const hasSaw = [I.SAW, I.CRYSTAL_SAW, I.AMYS_SAW].some(id => count(inventory, id) > 0);
  // Master units also take a gold leaf (Wiki "STASH").
  const extra = (stash.extra ?? []).map(([name, amount]) => [I[name], amount]);
  const extraText = extra.map(([id, amount]) => `, ${amount} ${core.ItemDefinition.forId(id).getName().toLowerCase()}`).join("");
  if (count(inventory, I.HAMMER) < 1 || !hasSaw || count(inventory, I[stash.plank]) < PLANKS_PER_UNIT || nail == null ||
      extra.some(([id, amount]) => count(inventory, id) < amount)) {
    player.sendMessage(`You need a hammer, a saw, ${PLANKS_PER_UNIT} ${core.ItemDefinition.forId(I[stash.plank]).getName().toLowerCase()}s${extraText} and ${NAILS_PER_UNIT} nails of one metal to build this STASH unit.`);
    return;
  }
  inventory.delete(I[stash.plank], PLANKS_PER_UNIT);
  for (const [id, amount] of extra) inventory.delete(id, amount);
  inventory.delete(nail, NAILS_PER_UNIT);
  player.getSkillManager().addExperiences(core.Skill.CONSTRUCTION, stash.xp);
  player.performAnimation(new core.Animation(core.CacheDefinitions.getSeqId("human_poh_build")));
  player.setAttribute(BUILT_ATTRIBUTE, [...built(player), unit.step.stash.locId]);
  if (unit.varbit >= 0) player.getPacketSender().sendVarbit(unit.varbit, 1);
}

/** Not captured: the shared powered-staff wording for a preset copy. */
const PRESET_TEXT = "Preset items cannot be used for this.";

/**
 * A STASH keeps only item ids, so what comes back is a plain copy: a preset or meta-untradeable copy
 * (Presets.PvpMode tags them) is never stored, or it would come back tradeable.
 */
function restricted(item) {
  return item.isPresetItem?.() === true || item.isUntradeable?.() === true || item.isUnbankable?.() === true;
}

/** All Settings "STASH units take equipped items" (451). */
const TAKE_EQUIPPED_VARBIT = 17938;

/**
 * Each outfit item comes from the inventory first, then, with "STASH units take equipped items"
 * on, from what the player wears.
 */
function deposit(player, unit) {
  const inventory = player.getInventory();
  const equipment = player.getEquipment();
  const sources = player.getPacketSender().getVarbit?.(TAKE_EQUIPPED_VARBIT) === 1 ? [inventory, equipment] : [inventory];
  const taken = [];
  for (const requirement of unit.step.equipment) {
    if (requirement.emptySlot != null) continue;
    const fits = id => requirement.anyOf ? requirement.anyOf.includes(id) :
      core.CacheDefinitions.getItem(id)?.params?.get?.(Catalogue.TRAIL_ITEM_GROUP_PARAM) === requirement.group;
    let found = null, restrictedOnly = false;
    for (const container of sources) {
      const free = (item, index) => item && item.getAmount() > 0 && fits(item.getId())
        && !taken.some(entry => entry.container === container && entry.slot === index);
      const slot = container.getItems().findIndex((item, index) => free(item, index) && !restricted(item));
      if (slot >= 0) { found = { container, slot, id: container.getItems()[slot].getId() }; break; }
      if (container.getItems().some(free)) restrictedOnly = true;
    }
    if (!found) {
      player.sendMessage(restrictedOnly ? PRESET_TEXT : "You need all the items for this STASH unit's emote clue to store them.");
      return;
    }
    taken.push(found);
  }
  for (const { container, slot } of taken) container.deleteAtSlot(slot, 1);
  inventory.refreshItems();
  if (taken.some(entry => entry.container === equipment)) {
    equipment.refreshItems();
    core.WeaponInterfaceManager.assign(player);
    player.getUpdateFlag().flag(core.Flag.APPEARANCE);
    api.emitCustomEvent("equipment:changed", { player });
  }
  player.setAttribute(STORED_ATTRIBUTE, { ...stored(player), [unit.step.stash.locId]: taken.map(entry => entry.id) });
  player.sendMessage("You store the items in the STASH unit.");
  // A STASH filled, by its tier ("fill a Medium STASH unit"): content that credits the deed.
  api.emitCustomEvent("stash:filled", { player, tier: unit.tier.name });
}

function withdraw(player, unit, items) {
  const inventory = player.getInventory();
  if (inventory.getFreeSlots() < items.length) {
    player.sendMessage("You need more inventory space to take the items out of the STASH unit.");
    return;
  }
  for (const id of items) inventory.adds(id, 1);
  const remaining = { ...stored(player) };
  delete remaining[unit.step.stash.locId];
  player.setAttribute(STORED_ATTRIBUTE, remaining);
  player.sendMessage("You take the items out of the STASH unit.");
}

function interact(event) {
  if (event.handled) return;
  const unit = stashes().get(event.objectId);
  if (!unit) return;
  event.handled = true;
  const { player } = event;
  if (!built(player).includes(event.objectId)) { build(player, unit); return; }
  // The Bank PIN guards this (Wiki: Bank_PIN); a locked PIN asks first, then reopens it.
  const pin = { player, feature: "stash", resume: () => interact({ ...event, handled: false }) };
  api.emitCustomEvent("bank-pin:guard", pin);
  if (pin.locked) return;
  const items = stored(player)[event.objectId];
  if (Array.isArray(items) && items.length) withdraw(player, unit, items);
  else deposit(player, unit);
}

function restore({ player }) {
  for (const locId of built(player)) {
    const unit = stashes().get(locId);
    if (unit?.varbit >= 0) player.getPacketSender().sendVarbit(unit.varbit, 1);
  }
}

module.exports = function attachStash(pluginApi) {
  api = pluginApi;
  core = api.core;
  units = null;
  api.persistAttribute(BUILT_ATTRIBUTE, []);
  api.persistAttribute(STORED_ATTRIBUTE, {});
  api.onBeforeObjectInteraction(interact);
  api.onPlayerLogin(restore);
  // "treasure-trails:stashes" { list }: every STASH unit, built or not, as { tier, location } (a league relic's clue compass).
  api.onCustomEvent("treasure-trails:stashes", (request) => {
    if (!Array.isArray(request?.list)) return;
    for (const unit of stashes().values()) request.list.push({ tier: unit.tier.name, location: unit.location });
  });
};

Object.assign(module.exports, { BUILT_ATTRIBUTE, STORED_ATTRIBUTE, stashes, interact, restore });
