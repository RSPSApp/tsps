"use strict";

const { api, CacheDefinitions, PluginManager, MapObjects, Item, ItemDefinition, PlayerStatus } = require("./Core.Construction");
const Ids = require("./Ids.Construction");
const House = require("./House.Construction");
const PetForms = require("./PetForms.Construction");

// The menagerie (rsprox captures, cache scripts 639-643): using a pet on menagerie furniture
// stores it; the pet house's View opens interface 211, whose list shows slot i of enum 985 when
// bit i of varps 864 / 1416 / 4718 is set, and a click takes the pet back. Toggle sets varbit
// 2013 (poh_menagerie_closed); stored pets roam the menagerie rooms while it is 0 and the house
// isn't in building mode.
const MENAGERIE_INTERFACE = Ids.iface("poh_menagerie");
const LIST = 7;
const ROAM_TOGGLE = 9;
const PET_ENUM = 985;
// Which pets are stored, from slot 0, 32 and 63 of the enum on.
const STORED_VARPS = [["prayer20", 0], ["menagerie_contents2", 32], ["menagerie_contents3", 63]].map(([name, first]) => [Ids.varp(name), first]);
const CLOSED_VARBIT = Ids.varbit("poh_menagerie_closed");
const STORED_ATTRIBUTE = "construction:menagerie";
const CLOSED_ATTRIBUTE = "construction:menagerie-closed";
const FORMS_ATTRIBUTE = "construction:menagerie-forms";
const MULTIFORM_ENUM_PARAM = 446;
const MENAGERIE_ROOMS = new Set(["MENAGERIE_INDOORS", "MENAGERIE_OUTDOORS"]);
const MENAGERIE_FURNITURE = /HOUSE$|HABITAT$|SCRATCHING_POST$|ARENA$|FEEDER$|PET_LIST$/;
const ROAM_RADIUS = 3;
const MAX_ROAMING = 20;

let petsBySlot = null;
/** house -> Map(npc -> slot) */
const roaming = new WeakMap();
const pending = new WeakMap();

/** Slot -> { itemId, npcId } from the cache enum and the Pets plugin's definitions. */
function pets() {
  if (petsBySlot) return petsBySlot;
  const request = { pets: [] };
  api.emitCustomEvent("pets:definitions", request);
  const npcByItem = new Map(request.pets.map(pet => [pet.itemId, pet.houseNpcId ?? pet.petId]));
  petsBySlot = new Map([...CacheDefinitions.getEnumValues(PET_ENUM)].map(([slot, itemId]) => {
    const forms = new Map(request.pets.filter(pet => pet.familyItemId === itemId)
      .map(pet => [pet.itemId, {itemId: pet.itemId, npcId: pet.houseNpcId ?? pet.petId}]));
    const enumId = CacheDefinitions.getItem(itemId).params?.get(MULTIFORM_ENUM_PARAM);
    const formVarbit = PetForms.varbitForEnum(enumId);
    return [slot, { itemId, npcId: npcByItem.get(itemId) ?? -1, forms, enumId, formVarbit }];
  }));
  return petsBySlot;
}

function slotOf(itemId) {
  for (const [slot, pet] of pets()) if (pet.itemId === itemId || pet.forms.has(itemId)) return slot;
  return -1;
}

function stored(player) {
  return new Set(player.getAttribute(STORED_ATTRIBUTE) ?? []);
}

function storedPet(player, slot) {
  const base = pets().get(slot);
  return base?.forms.get(player.getAttribute(FORMS_ATTRIBUTE)?.[slot]) ?? base;
}

function sendStored(player) {
  const slots = stored(player);
  for (const [varp, first] of STORED_VARPS) {
    let value = 0;
    for (let bit = 0; bit < 32; bit++) if (slots.has(first + bit)) value |= 1 << bit;
    player.getPacketSender().sendConfig(varp, value);
  }
  player.getPacketSender().sendVarbit(CLOSED_VARBIT, player.getAttribute(CLOSED_ATTRIBUTE) ? 1 : 0);
  for (const [slot, pet] of pets()) {
    if (!pet.forms.size || !Number.isInteger(pet.enumId) || !Number.isInteger(pet.formVarbit)) continue;
    const itemId = storedPet(player, slot).itemId;
    const form = [...CacheDefinitions.getEnumValues(pet.enumId)].find(([, id]) => id === itemId)?.[0] ?? 0;
    player.getPacketSender().sendVarbit(pet.formVarbit, form);
  }
  if (player.getInterfaceId() === MENAGERIE_INTERFACE) {
    // Script641 creates children by enum slot; script2266's onOp is only cosmetic.
    player.getPacketSender().sendInterfaceFlagsRange((MENAGERIE_INTERFACE << 16) | LIST, 0, 71, (1 << 1) | (1 << 10));
  }
}

function inMenagerie(event) {
  const house = House.houseFor(event.player);
  const furniture = house?.getFurnitureAt(event.location, event.objectId, event.object?.getType() ?? 10);
  const room = furniture && house.getRoom(house.getRoomPositionAt(event.location));
  return room && MENAGERIE_ROOMS.has(room.roomKey) && MENAGERIE_FURNITURE.test(furniture.buildableKey) ? house : null;
}

function view(event) {
  if (!inMenagerie(event)) return false;
  event.player.getPacketSender().sendInterface(MENAGERIE_INTERFACE);
  sendStored(event.player);
  return true;
}

function storePet(event) {
  const slot = slotOf(event.itemId);
  const house = slot >= 0 && inMenagerie(event);
  if (!house) return;
  event.handled = true;
  const player = event.player;
  if (house.owner !== player) return player.sendMessage("You can only keep pets in your own menagerie.");
  if (house.buildingMode) return player.sendMessage("You can't spawn pets unless they're permitted to roam the house, which they can't do in building mode.");
  const context = {player, house, slot, event, origin: player.getLocation().clone()};
  pending.set(player, context);
  storeNow(context);
}

function safe(context) {
  const {player, house, origin} = context;
  return player.isRegistered() && player.getHitpoints() > 0 && player.getStatus() === PlayerStatus.NONE && !house.buildingMode &&
    house.owner === player && House.houseFor(player) === house &&
    player.getLocation().equals(origin) && !player.isNeedsPlacement() &&
    !player.isTeleportingReturn() && !player.getForceMovement();
}

function storeNow(context) {
  const {player, house, slot, event} = context;
  if (pending.get(player) !== context || !safe(context) || player.busy()) return;
  const inventory = player.getInventory();
  if (inventory.getItems()[event.itemSlot] !== event.item || event.item.getId() !== event.itemId ||
      event.item.getAmount() < 1 || inMenagerie(event) !== house ||
      !MapObjects.stillStands(player, event.objectId, event.object.getLocation(), event.object)) return;
  const pin = {player, feature: "poh-menagerie", resume: () => storeNow(context)};
  api.emitCustomEvent("bank-pin:guard", pin);
  if (pin.locked || pending.get(player) !== context || !safe(context)) return;
  pending.delete(player);
  const slots = stored(player);
  if (slots.has(slot)) return player.sendMessage("You already have that pet in your menagerie.");
  inventory.deletedItem(new Item(event.itemId, 1), event.itemSlot, true);
  player.setAttribute(FORMS_ATTRIBUTE, {...player.getAttribute(FORMS_ATTRIBUTE), [slot]: event.itemId});
  slots.add(slot);
  player.setAttribute(STORED_ATTRIBUTE, [...slots]);
  sendStored(player);
  refreshPets(house);
}

function interfaceClick(event) {
  if (event.groupId !== MENAGERIE_INTERFACE) return;
  const player = event.player;
  const house = House.houseFor(player);
  if (!house || house.owner !== player) return;
  event.handled = true;
  if (!player.isRegistered() || player.getHitpoints() <= 0 || house.buildingMode ||
      player.getInterfaceId() !== MENAGERIE_INTERFACE ||
      !player.getPacketSender().isSubInterfaceOpen(MENAGERIE_INTERFACE)) return;
  if (event.childId === ROAM_TOGGLE) {
    if ((event.opId ?? event.action ?? 1) !== 1) return;
    player.setAttribute(CLOSED_ATTRIBUTE, !player.getAttribute(CLOSED_ATTRIBUTE));
    sendStored(player);
    refreshPets(house);
    return;
  }
  const slot = event.slot;
  const slots = stored(player);
  if (event.childId === LIST && slots.has(slot) && (event.opId ?? event.action) === 10) {
    player.sendMessage(ItemDefinition.forId(storedPet(player, slot).itemId).getExamine());
    return;
  }
  if (event.childId !== LIST || !slots.has(slot) || (event.opId ?? event.action ?? 1) > 1) return;
  const context = {player, house, slot, itemId: storedPet(player, slot).itemId, origin: player.getLocation().clone()};
  pending.set(player, context);
  withdrawNow(context);
}

function resumeWithdrawal(context) {
  const {player} = context;
  if (pending.get(player) !== context || !safe(context) || player.busy()) return;
  player.getPacketSender().sendInterface(MENAGERIE_INTERFACE);
  sendStored(player);
  withdrawNow(context);
}

function withdrawNow(context) {
  const {player, house, slot, itemId} = context;
  const slots = stored(player);
  if (pending.get(player) !== context || !safe(context) || !slots.has(slot) ||
      storedPet(player, slot).itemId !== itemId || player.getInterfaceId() !== MENAGERIE_INTERFACE ||
      !player.getPacketSender().isSubInterfaceOpen(MENAGERIE_INTERFACE)) return;
  const pin = {player, feature: "poh-menagerie", resume: () => resumeWithdrawal(context)};
  api.emitCustomEvent("bank-pin:guard", pin);
  if (pin.locked || pending.get(player) !== context || !safe(context)) return;
  pending.delete(player);
  if (player.getInventory().getFreeSlots() === 0) return player.sendMessage("You don't have enough inventory space.");
  slots.delete(slot);
  player.setAttribute(STORED_ATTRIBUTE, [...slots]);
  player.getInventory().adds(storedPet(player, slot).itemId, 1);
  const forms = {...player.getAttribute(FORMS_ATTRIBUTE)};
  delete forms[slot];
  player.setAttribute(FORMS_ATTRIBUTE, forms);
  sendStored(player);
  refreshPets(house);
}

function clearPending({player}) { pending.delete(player); }

/** Instance.rebuild: stored pets roam the menagerie rooms while the owner lets them. */
function refreshPets(house) {
  const out = roaming.get(house) ?? new Map();
  roaming.set(house, out);
  const owner0 = house.owner;
  const wanted = owner0 && !house.buildingMode && !owner0.getAttribute(CLOSED_ATTRIBUTE) ? [...stored(owner0)].slice(0, MAX_ROAMING) : [];
  // Each occupant's rebuild calls this; leave the pets alone unless what should roam changed.
  if (wanted.length === out.size && [...out].every(([npc, slot]) => npc.isRegistered() && wanted.includes(slot))) return;
  for (const npc of out.keys()) if (npc.isRegistered()) { house.leave(npc, false); PluginManager.removeNpc(npc); }
  out.clear();
  const owner = house.owner;
  if (!owner || house.buildingMode || owner.getAttribute(CLOSED_ATTRIBUTE)) return;
  const tiles = house.furnitureEntries().filter(entry => MENAGERIE_ROOMS.has(entry.room.roomKey)).map(entry => entry.location);
  if (!tiles.length) return;
  for (const slot of [...stored(owner)].slice(0, MAX_ROAMING)) {
    const pet = storedPet(owner, slot);
    if (!pet || pet.npcId < 0) continue;
    const at = tiles[Math.floor(Math.random() * tiles.length)];
    const npc = PluginManager.spawnNpc({ id: pet.npcId, x: at.getX(), y: at.getY(), z: at.getZ(), wanderRadius: ROAM_RADIUS });
    if (!npc) continue;
    npc.__skipDefaultRespawn = true;
    house.enter(npc);
    out.set(npc, slot);
  }
}

/** `pets:held-elsewhere`: a pet kept in the owner's menagerie is still theirs. */
function heldInMenagerie(request) {
  const slot = slotOf(request.itemId);
  if (slot >= 0 && stored(request.player).has(slot)) request.held = true;
}

function attachMenagerie(api) {
  api.persistAttribute(STORED_ATTRIBUTE, []);
  api.persistAttribute(CLOSED_ATTRIBUTE, false);
  api.persistAttribute(FORMS_ATTRIBUTE, {});
  for (const name of ["Oak house", "Teak house", "Mahogany house", "Consecrated house", "Desecrated house", "Nature house"]) {
    api.onObjectInteraction(name, { View: view });
  }
  api.onItemOnObject(storePet, { noted: false });
  api.onInterfaceActionClick(interfaceClick);
  api.onCustomEvent("pets:held-elsewhere", heldInMenagerie);
  api.onPlayerLogout(clearPending);
  api.onPlayerDisconnect(clearPending);
}

Object.assign(module.exports, { attachMenagerie, refreshPets });
