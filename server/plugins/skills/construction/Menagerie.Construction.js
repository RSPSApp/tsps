"use strict";

const { api, Animation, CacheDefinitions, ChatType, CountdownTask, HitDamage, HitMask, PluginManager, MapObjects, Item, PlayerStatus, TaskManager, World } = require("./Core.Construction");
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
// The desert habitat's cactus (rsprox capture 2792 ticks 768-890; Wiki: Desert habitat): Touch
// faces it and plays human_pickuptable, and the tick after says "That was unwise." (spam) and
// hits for 2. A touch takes those two ticks, so held clicks touch every other tick.
const CACTUS = Ids.loc("poh_menagerie_habitat_feature_3");
// 2792: every touch sends human_pickuptable with delay 15.
const TOUCH_ANIMATION = new Animation(Ids.seq("human_pickuptable"), 15);
const CACTUS_DAMAGE = 2;
const TOUCH_CYCLES = 2;
/** Player -> the world cycle their next Touch is accepted on (2792: every other tick). */
const nextTouch = new WeakMap();
/** The cactus's own queued hits, capped as they land (`combat:damage-apply`). */
const stings = new WeakSet();
const ROAM_RADIUS = 3;
const MAX_ROAMING = 20;
// Extras (pet rocks, cats, dogs, fishbowls, ...): script 641 draws enum 985's slots, then every
// obj in inventory poh_menagerie_pets (517) as the next list children, so list child
// `enum size + inv slot` is that inventory slot. rsprox captures 2779 and 2782 (rev 229): using
// the pet rock on an oak house takes it that tick with no message (2779 tick 1019, 2782 tick 27)
// and its poh_rock starts roaming; View sends the inventory in
// full before opening interface 211; taking it back empties its slot (2779 tick 2090, child 63
// after the 63 enum slots of that revision). A pet house holds its tier's limit, extras
// included (2779 tick 1050: supreme, K'ril and the rock filled an oak house, so the chompy
// chick got "The pet house is full. Only 3 creatures can live in this kind of pet house.");
// the nature house holds every unique pet and 12 extras (Wiki: Menagerie).
const EXTRAS = require("./data/menagerie-extras.json");
const EXTRAS_INVENTORY = CacheDefinitions.getInventoryId("poh_menagerie_pets");
const EXTRA_NPC_BY_ITEM = new Map(Object.entries(EXTRAS.pets).map(([obj, npc]) => [Ids.obj(obj), Ids.npc(npc)]));
const KITTENS = new Set(EXTRAS.kittens.map(Ids.obj));
const EXTRAS_ATTRIBUTE = "construction:menagerie-extras";

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

/** The first list child after enum 985's slots: where script 641 starts drawing the extras. */
function extrasBase() {
  return Math.max(...pets().keys()) + 1;
}

/** The extras inventory as stored: item ids by slot, null where empty. */
function extras(player) {
  const saved = player.getAttribute(EXTRAS_ATTRIBUTE);
  return Array.from({length: EXTRAS.capacity}, (_, slot) => (Array.isArray(saved) && Number.isInteger(saved[slot]) ? saved[slot] : null));
}

function extrasCount(player) {
  return extras(player).filter(id => id !== null).length;
}

/** Every stored pet by its list child: enum slots for the unique pets, then the extras. */
function held(player) {
  const base = extrasBase();
  return new Set([...stored(player), ...extras(player).flatMap((id, slot) => (id === null ? [] : [base + slot]))]);
}

function storedPet(player, slot) {
  const base = extrasBase();
  if (slot >= base) {
    const itemId = extras(player)[slot - base] ?? null;
    return itemId === null ? undefined : {itemId, npcId: EXTRA_NPC_BY_ITEM.get(itemId) ?? -1};
  }
  const pet = pets().get(slot);
  return pet?.forms.get(player.getAttribute(FORMS_ATTRIBUTE)?.[slot]) ?? pet;
}

/** Sends the extras inventory, owned by interface 211 so closing it stops the transmit. */
function sendExtras(player) {
  player.getPacketSender().sendInventory(EXTRAS_INVENTORY, EXTRAS.capacity,
    extras(player).map(id => (id === null ? null : {id, amount: 1})), MENAGERIE_INTERFACE);
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
    sendExtras(player);
    // Script641 creates children by enum slot, then one per extras slot; script2266's onOp is
    // only cosmetic. 2779/2782 (rev 229, 63 enum slots) send OP1 and OP10 on 0-75: enum size + 12.
    player.getPacketSender().sendInterfaceFlagsRange((MENAGERIE_INTERFACE << 16) | LIST, 0, extrasBase() + EXTRAS.capacity, (1 << 1) | (1 << 10));
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
  // 2779/2782: the extras inventory goes out in full before the interface opens.
  sendExtras(event.player);
  event.player.getPacketSender().sendInterface(MENAGERIE_INTERFACE);
  sendStored(event.player);
  return true;
}

/**
 * How many pets the house's best pet house holds, or null for no limit on unique pets (the
 * nature house). -1 when no pet house is built.
 */
function houseLimit(house) {
  let best = -1;
  for (const {furniture, room} of house.furnitureEntries()) {
    if (!MENAGERIE_ROOMS.has(room.roomKey) || !(furniture.buildableKey in EXTRAS.houseLimits)) continue;
    const limit = EXTRAS.houseLimits[furniture.buildableKey];
    if (limit === null) return null;
    best = Math.max(best, limit);
  }
  return best;
}

/** Why the pet can't move in, or null when there's room. */
function refusal(player, house, extra) {
  const limit = houseLimit(house);
  // Ours: no recording or Wiki line covers a menagerie without a pet house.
  if (limit === -1) return "You need a pet house to keep pets in your menagerie.";
  if (limit === null) {
    // Ours: the Wiki gives the nature house's 12 extras but no message for a 13th.
    return extra && extrasCount(player) >= EXTRAS.capacity ? `Your menagerie can't hold more than ${EXTRAS.capacity} of those pets.` : null;
  }
  if (stored(player).size + extrasCount(player) >= limit) {
    return `The pet house is full. Only ${limit} creatures can live in this kind of pet house.`;
  }
  return null;
}

/**
 * The cactus's Touch: the pick-up animation, then the sting a tick later. 2792 (ticks 868-871,
 * 995-998) sends Touch every tick but the server takes one every other tick, so the next touch
 * waits two cycles from this one, past the sting's own tick.
 */
function touchCactus(event) {
  if (event.objectId !== CACTUS) return false;
  const player = event.player;
  const cycle = World.getProcessCycle(), wait = (nextTouch.get(player) ?? cycle) - cycle;
  if (wait > 0 && wait <= TOUCH_CYCLES) return true;
  nextTouch.set(player, cycle + TOUCH_CYCLES);
  player.performAnimation(TOUCH_ANIMATION);
  TaskManager.submit(new CountdownTask(player, 1, () => {
    if (!player.isRegistered()) return;
    player.getPacketSender().sendTypedMessage(ChatType.SPAM, "That was unwise.");
    const hit = new HitDamage(CACTUS_DAMAGE, HitMask.RED);
    stings.add(hit);
    player.getCombat().getHitQueue().addPendingDamage([hit]);
  }));
  return true;
}

/**
 * It never kills: 2792's touches at 1 hitpoint (ticks 993-998) each hit a blue 0. Capped as it
 * lands, after any hit queued before it (poison), so the two together can't kill either. Ours:
 * at 2 hitpoints it takes 1 (no recording at 2).
 */
function capSting({ target, hit }) {
  if (!stings.delete(hit)) return;
  hit.setDamage(Math.max(0, Math.min(hit.getDamage(), target.getHitpoints() - 1)));
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
  const extra = slot < 0 && EXTRA_NPC_BY_ITEM.has(event.itemId);
  const kitten = KITTENS.has(event.itemId);
  const house = (slot >= 0 || extra || kitten) && inMenagerie(event);
  if (!house) return;
  event.handled = true;
  const player = event.player;
  if (house.owner !== player) return player.sendMessage("You can only keep pets in your own menagerie.");
  if (house.buildingMode) return player.sendMessage("You can't spawn pets unless they're permitted to roam the house, which they can't do in building mode.");
  // 2779 ticks 911 and 987: a kitten is turned away.
  if (kitten) return player.sendMessage("Kittens need more personal care and attention than the pet house can provide.");
  const context = {player, house, slot, extra, event, origin: player.getLocation().clone()};
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
  const {player, house, slot, extra, event} = context;
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
  if (!extra && slots.has(slot)) return player.sendMessage("You already have that pet in your menagerie.");
  const full = refusal(player, house, extra);
  if (full) return player.sendMessage(full);
  if (extra) {
    const kept = extras(player), free = kept.indexOf(null);
    inventory.deletedItem(new Item(event.itemId, 1), event.itemSlot, true);
    kept[free] = event.itemId;
    player.setAttribute(EXTRAS_ATTRIBUTE, kept);
    sendStored(player);
    refreshPets(house);
    return;
  }
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
  const slots = held(player);
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
  if (pending.get(player) !== context || !safe(context) || !held(player).has(slot) ||
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
  player.getInventory().adds(storedPet(player, slot).itemId, 1);
  const base = extrasBase();
  if (slot >= base) {
    // 2779 tick 2090: the slot empties; the extras after it keep their slots.
    const kept = extras(player);
    kept[slot - base] = null;
    player.setAttribute(EXTRAS_ATTRIBUTE, kept);
  } else {
    const slots = stored(player);
    slots.delete(slot);
    player.setAttribute(STORED_ATTRIBUTE, [...slots]);
    const forms = {...player.getAttribute(FORMS_ATTRIBUTE)};
    delete forms[slot];
    player.setAttribute(FORMS_ATTRIBUTE, forms);
  }
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
  if (pending.get(player) !== context || !safe(context) || player.busy() || !held(player).has(slot) ||
      storedPet(player, slot).itemId !== itemId || !npc.isRegistered() || roaming.get(house)?.get(npc) !== slot) return;
  const pin = {player, feature: "poh-menagerie", resume: () => pickUpNow(context)};
  api.emitCustomEvent("bank-pin:guard", pin);
  if (pin.locked || pending.get(player) !== context || !safe(context)) return;
  pending.delete(player);
  // The Fremennik Diary's pet rock task: picking the roaming rock up off the menagerie floor.
  if (takeBack(player, house, slot, npc)) api.emitCustomEvent("construction:menagerie-pet-picked-up", {player, house, itemId});
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
  const wanted = new Set(owner && !house.buildingMode && !owner.getAttribute(CLOSED_ATTRIBUTE) ? [...held(owner)].slice(0, MAX_ROAMING) : []);
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
  if (extras(request.player).includes(request.itemId)) request.held = true;
}

function attachMenagerie(api) {
  api.persistAttribute(STORED_ATTRIBUTE, []);
  api.persistAttribute(EXTRAS_ATTRIBUTE, []);
  api.persistAttribute(CLOSED_ATTRIBUTE, false);
  api.persistAttribute(FORMS_ATTRIBUTE, {});
  for (const name of ["Oak house", "Teak house", "Mahogany house", "Consecrated house", "Desecrated house", "Nature house"]) {
    api.onObjectInteraction(name, { View: view });
  }
  api.onObjectInteraction("Pet list", { Read: readPetList });
  api.onObjectInteraction("Cactus", { Touch: touchCactus });
  api.onCustomEvent("combat:damage-apply", capSting);
  api.onItemOnObject(storePet, { noted: false });
  api.onInterfaceActionClick(interfaceClick);
  // A plain hook: roaming pets are told apart by the house's roaming map, not by name.
  api.onNpcInteraction(pickUp);
  api.onCustomEvent("pets:held-elsewhere", heldInMenagerie);
  api.onPlayerLogout(clearPending);
  api.onPlayerDisconnect(clearPending);
}

Object.assign(module.exports, { attachMenagerie, refreshPets });
