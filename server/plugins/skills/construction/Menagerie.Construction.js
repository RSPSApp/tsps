"use strict";

const { api, CacheDefinitions, PluginManager, MapObjects, Item, PlayerStatus } = require("./Core.Construction");
const Ids = require("./Ids.Construction");
const House = require("./House.Construction");
const PetForms = require("./PetForms.Construction");
const { examineItem } = require("../../../src/main/typescript/elvarg/game/content/ExaminePrice");

// The menagerie (rsprox captures, cache scripts 639-643): using a pet on menagerie furniture
// stores it; the pet house's View opens interface 211, whose list shows slot i of enum 985 when
// bit i of varps 864 / 1416 / 4718 is set, and a click takes the pet back. Toggle sets varbit
// 2013 (poh_menagerie_closed); stored pets roam the menagerie rooms while it is 0 and the house
// isn't in building mode, and the owner's Pick-up on one takes it back.
const MENAGERIE_INTERFACE = Ids.iface("poh_menagerie");
// The Pet list's Read (rsprox captures 2581, 2777, 2782, 2793 and 3121): script 2524 (-1, -1),
// poh_petlist (210) as the main modal, Examine (op10) on every list slot, then script 647 with
// one "Owned"/"Not owned" cell per slot of enum 985, each ending in "|". Owned is the
// insurance record (rec 2581's nine Owned slots are its nine pet_insurance bits); Examine
// sends the pet's examine whether it is owned or not.
const PET_LIST_INTERFACE = Ids.iface("poh_petlist");
const PET_LIST = 3;
const SCRIPT_MAINMODAL_OPEN = 2524;
const SCRIPT_PET_LIST = 647;
const OWNED = "<col=00ff00>Owned</col>";
const NOT_OWNED = "<col=ff0000>Not owned</col>";
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

function owns(player, itemId) {
  const request = {player, itemId, owns: false};
  api.emitCustomEvent("pets:owns", request);
  return request.owns === true;
}

function readPetList(event) {
  if (!inMenagerie(event)) return false;
  const player = event.player;
  const last = Math.max(...pets().keys());
  const cells = [];
  for (let slot = 0; slot <= last; slot++) {
    const pet = pets().get(slot);
    cells.push(pet && owns(player, pet.itemId) ? OWNED : NOT_OWNED);
  }
  const sender = player.getPacketSender();
  sender.sendInterfaceScript(SCRIPT_MAINMODAL_OPEN, [-1, -1]);
  sender.sendInterface(PET_LIST_INTERFACE);
  sender.sendInterfaceFlagsRange((PET_LIST_INTERFACE << 16) | PET_LIST, 0, last, 1 << 10);
  sender.sendInterfaceScript(SCRIPT_PET_LIST, [cells.map(cell => cell + "|").join("")]);
  return true;
}

function petListClick(event) {
  const player = event.player;
  if (event.childId !== PET_LIST || (event.opId ?? event.action) !== 10 ||
      player.getInterfaceId() !== PET_LIST_INTERFACE ||
      !player.getPacketSender().isSubInterfaceOpen(PET_LIST_INTERFACE)) return;
  const pet = pets().get(event.slot);
  if (pet) examineItem(player, pet.itemId, 1);
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
  if (event.groupId === PET_LIST_INTERFACE) {
    event.handled = true;
    return petListClick(event);
  }
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
    examineItem(player, storedPet(player, slot).itemId, 1);
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
  takeBack(player, house, slot);
}

/** Moves a stored pet back to the owner's backpack, clearing its slot and form varbit. */
function takeBack(player, house, slot, npc = null) {
  if (player.getInventory().getFreeSlots() === 0) {
    player.sendMessage("You don't have enough inventory space.");
    return false;
  }
  const slots = stored(player);
  slots.delete(slot);
  player.setAttribute(STORED_ATTRIBUTE, [...slots]);
  player.getInventory().adds(storedPet(player, slot).itemId, 1);
  const forms = {...player.getAttribute(FORMS_ATTRIBUTE)};
  delete forms[slot];
  player.setAttribute(FORMS_ATTRIBUTE, forms);
  // Only this pet goes; the rest keep roaming where they are.
  npc ??= [...(roaming.get(house) ?? [])].find(([, roamingSlot]) => roamingSlot === slot)?.[0];
  if (npc) despawn(house, npc);
  sendStored(player);
  refreshPets(house);
  return true;
}

function despawn(house, npc) {
  roaming.get(house)?.delete(npc);
  if (!npc.isRegistered()) return;
  house.leave(npc, false);
  PluginManager.removeNpc(npc);
}

/**
 * Pick-up on a pet roaming the menagerie takes it straight back, as the pet list's Take does
 * (rsprox captures 2779-2784, rev 229: the NPC goes, the item arrives and the pet's menagerie
 * varbits clear on the tick the owner reaches it; no animation or sound). Runs ahead of the
 * Pets plugin's follower Pick-up, which refuses NPCs that aren't the player's follower.
 */
function pickUp(event) {
  const {player, npc} = event;
  const house = npc && House.houseFor(player);
  const slot = house ? roaming.get(house)?.get(npc) : undefined;
  if (slot === undefined || event.definition?.getActions?.()?.[event.clickType - 1] !== "Pick-up") return;
  event.handled = true;
  // Ours: a guest's Pick-up does nothing; no recording shows a guest trying.
  if (house.owner !== player) return;
  const context = {player, house, slot, npc, itemId: storedPet(player, slot).itemId, origin: player.getLocation().clone()};
  pending.set(player, context);
  pickUpNow(context);
}

function pickUpNow(context) {
  const {player, house, slot, npc, itemId} = context;
  if (pending.get(player) !== context || !safe(context) || player.busy() || !stored(player).has(slot) ||
      storedPet(player, slot).itemId !== itemId || !npc.isRegistered() || roaming.get(house)?.get(npc) !== slot) return;
  const pin = {player, feature: "poh-menagerie", resume: () => pickUpNow(context)};
  api.emitCustomEvent("bank-pin:guard", pin);
  if (pin.locked || pending.get(player) !== context || !safe(context)) return;
  pending.delete(player);
  takeBack(player, house, slot, npc);
}

function clearPending({player}) { pending.delete(player); }

/**
 * Instance.rebuild: stored pets roam the menagerie rooms while the owner lets them. Only what
 * changed is touched: pets no longer wanted leave, newly wanted ones spawn, the rest stay put.
 */
function refreshPets(house) {
  const out = roaming.get(house) ?? new Map();
  roaming.set(house, out);
  const owner = house.owner;
  const wanted = new Set(owner && !house.buildingMode && !owner.getAttribute(CLOSED_ATTRIBUTE) ? [...stored(owner)].slice(0, MAX_ROAMING) : []);
  for (const [npc, slot] of [...out]) {
    if (npc.isRegistered() && wanted.has(slot) && npc.getId() === storedPet(owner, slot)?.npcId) continue;
    out.delete(npc);
    if (npc.isRegistered()) { house.leave(npc, false); PluginManager.removeNpc(npc); }
  }
  const present = new Set(out.values());
  const missing = [...wanted].filter(slot => !present.has(slot));
  if (!missing.length) return;
  // Each occupant's rebuild calls this; furniture tiles are only needed when a pet spawns.
  const tiles = house.furnitureEntries().filter(entry => MENAGERIE_ROOMS.has(entry.room.roomKey)).map(entry => entry.location);
  if (!tiles.length) return;
  for (const slot of missing) {
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
  api.onObjectInteraction("Pet list", { Read: readPetList });
  api.onItemOnObject(storePet, { noted: false });
  api.onInterfaceActionClick(interfaceClick);
  // A plain hook: roaming pets are told apart by the house's roaming map, not by name.
  api.onNpcInteraction(pickUp);
  api.onCustomEvent("pets:held-elsewhere", heldInMenagerie);
  api.onPlayerLogout(clearPending);
  api.onPlayerDisconnect(clearPending);
}

Object.assign(module.exports, { attachMenagerie, refreshPets });
