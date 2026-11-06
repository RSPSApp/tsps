"use strict";

const { api, CacheDefinitions, CountdownTask, Location, Skill, TaskManager, TeleportHandler } = require("./Core.Construction");
const Ids = require("./Ids.Construction");
const House = require("./House.Construction");
const Portals = require("./Portals.Construction");

// The portal nexus (rsprox captures, cache enums 1375/1377 and their structs, Wiki):
// - Destinations are enum 1377 (id -> struct: name 660, runes 664-671 already x1000, Magic level
//   673, alternate 679, e.g. Varrock -> Grand Exchange 151). A player's slots are varbits
//   poh_nexus_tele_<n> and poh_nexus_left_click; interfaces work on their _temp copies, with
//   poh_nexus_id the nexus tier (1 marble, 2 gilded, 3 crystalline).
// - Teleport Menu opens telenexus_teleport (17); resume_pausebutton on rows1/key_listeners picks
//   slot sub (0-based), on rows2/extra_key_listeners the alternates Grand Exchange, Seers' Village
//   and Yanille. The teleport is instant (captured landings).
// - Configuration opens telenexus (19). Dragging a slotted row onto the portal (left_click_layer)
//   makes it the left-click destination and left_click_options 2/3 picks it or its alternate;
//   left_text clears it ("Drag from the slotted list to the portal to set the left click
//   destination."); Done saves the temp varbits, clears poh_nexus_id and closes (captured), or,
//   when the slots changed, the client shows the cost panel and Confirm saves.
//   Adding (non_slotted row i is enum 1375's i-th destination) and reordering slots by dragging,
//   and removing by dragging a slot back, aren't captured: adding costs 1,000x the spell's runes
//   from the inventory on Done, needs its Magic level, and removing refunds nothing (Wiki).
//   Marble holds 4, gilded 8, crystalline 41 (Wiki).
const MENU = Ids.iface("telenexus_teleport"), CONFIG = Ids.iface("telenexus");
const ROWS = 13, KEYS = 8, ALT_ROWS = 17, ALT_KEYS = 7, OPTIONS_LAYER = 10;
// telenexus by component name: the rev 241 ids moved (Done was 9, now 15; the list layers shifted too).
const child = (name) => Ids.component(`telenexus:${name}`) & 0xffff;
const LEFT_CLICK_LAYER = child("click_layer"), LEFT_TEXT = child("click_text"), LEFT_CLICK_OPTIONS = child("radio_button_options");
const DONE = child("telenexus_donebutton"), CONFIRM = child("telenexus_confirm");
const NON_SLOTTED = child("non_slotted_list"), CONFIRM_DETAILS = child("confirm_details"), SLOTTED = child("slotted_list");
const COST_INV = 619;
const NEXUS_ID = Ids.varbit("poh_nexus_id"), LEFT = Ids.varbit("poh_nexus_left_click"), LEFT_TEMP = Ids.varbit("poh_nexus_left_click_temp");
// The 45 slots: poh_nexus_tele_<n>, and the interfaces' poh_nexus_tele_<n>_temp copies.
const SLOT_VARBITS = Array.from({ length: 45 }, (_, index) => Ids.varbit(`poh_nexus_tele_${index + 1}`));
const TEMP_VARBITS = Array.from({ length: 45 }, (_, index) => Ids.varbit(`poh_nexus_tele_${index + 1}_temp`));
const TIERS = { MARBLE_PORTAL_NEXUS: { id: 1, slots: 4 }, GILDED_PORTAL_NEXUS: { id: 2, slots: 8 }, CRYSTALLINE_PORTAL_NEXUS: { id: 3, slots: 41 } };
// rows2: the alternates, with the middle of their captured landings.
const ALTERNATES = [[151, [3165, 3477, 0]], [154, [2726, 3486, 0]], [156, [2583, 3095, 0]]];
// Struct names that differ from the spells' destination names.
const SPELL_NAMES = {
  "marim": "ape atoll", "lunar isle": "moonclan", "waterbirth island": "waterbirth", "fenken' castle": "fenkenstrain's castle",
  "barbarian outpost": "barbarian", "port khazard": "khazard", "ape atoll dungeon": "ape atoll dungeon",
};
const STATE_ATTRIBUTE = "construction:nexus";
const LEFT_CLICK_DELAY_TICKS = 2;
const PAUSEBUTTON = 1, OP1 = 1 << 1, OP10 = 1 << 10, DEPTH5 = 5 << 17, DRAG_TARGET = 1 << 20;

let destinationsById = null;

/** Every destination from the cache, with where the spell lands. */
function destinations() {
  if (destinationsById) return destinationsById;
  const spells = Portals.houseDestinations();
  destinationsById = new Map();
  for (const [id, struct] of CacheDefinitions.getEnumValues(1377)) {
    const params = CacheDefinitions.getStructParams(struct);
    const name = String(params.get(660) ?? "");
    const spellName = `${SPELL_NAMES[name.toLowerCase()] ?? name.toLowerCase()} teleport`;
    const spell = spells.find(data => data.name === spellName);
    const runes = [[664, 668], [665, 669], [666, 670], [667, 671]]
      .map(([item, amount]) => [params.get(item), params.get(amount)]).filter(([item]) => item != null);
    const alternate = ALTERNATES.find(([altId]) => altId === id);
    destinationsById.set(id, {
      id, name, spellName, runes, level: Number(params.get(673) ?? 1),
      alternate: params.get(679) != null ? [...CacheDefinitions.getEnumValues(1377)].find(([, s]) => s === params.get(679))?.[0] : undefined,
      tile: alternate ? new Location(...alternate[1]) : spell?.destination ?? null,
    });
  }
  return destinationsById;
}

function nexusAt(event) {
  const house = House.houseFor(event.player);
  const furniture = house?.getFurnitureAt(event.location, event.objectId, event.object?.getType() ?? 10);
  const tier = furniture && TIERS[furniture.buildableKey];
  return tier ? { house, furniture, tier } : null;
}

/** The player's slots and left-click destination; older saves kept destination names on the nexus. */
function stateOf(player, furniture) {
  let state = player.getAttribute(STATE_ATTRIBUTE);
  if (!state) {
    const names = furniture?.destinations ?? [];
    const slots = names.map(name => [...destinations().values()].find(data => data.spellName === name)?.id).filter(Boolean);
    state = { slots, left: 0 };
    player.setAttribute(STATE_ATTRIBUTE, state);
  }
  return state;
}

function sendState(player, slots, left, varbits, leftVarbit) {
  const sender = player.getPacketSender();
  varbits.forEach((varbit, index) => sender.sendVarbit(varbit, slots[index] ?? 0));
  sender.sendVarbit(leftVarbit, left ?? 0);
}

function teleportTo(player, house, id) {
  const destination = destinations().get(id);
  player.getPacketSender().sendInterfaceRemoval();
  if (!destination?.tile) return player.sendMessage("That destination isn't available yet.");
  if (!TeleportHandler.checkReqs(player, destination.tile)) return;
  house.exitHouse(player, destination.tile.clone());
  api.emitCustomEvent("construction:portal", { player, destination: destination.spellName });
}

/**
 * rsprox captures ("Teleport" on poh_nexus_portal_3 and _league_5, rev 228-239): the player faces
 * the portal and leaves two ticks after arriving, with poh_nexus_id set to the portal's tier. A
 * click meanwhile stops it. A pick in the Teleport Menu leaves at once.
 */
function teleport(event) {
  const found = nexusAt(event);
  if (!found) return false;
  const player = event.player;
  const state = stateOf(player, found.furniture);
  if (!state.left) return openMenu(player, found), true;
  player.setPositionToFace(event.location);
  TaskManager.submit(new CountdownTask(player.getIndex(), LEFT_CLICK_DELAY_TICKS, () => {
    if (House.houseFor(player) !== found.house) return;
    player.getPacketSender().sendVarbit(NEXUS_ID, found.tier.id);
    teleportTo(player, found.house, state.left);
  }));
  return true;
}

function teleportMenu(event) {
  const found = nexusAt(event);
  if (!found) return false;
  openMenu(event.player, found);
  return true;
}

const open = new WeakMap();

function openMenu(player, found) {
  const state = stateOf(player, found.furniture);
  const sender = player.getPacketSender();
  sender.sendVarbit(NEXUS_ID, found.tier.id);
  sendState(player, state.slots, state.left, TEMP_VARBITS, LEFT_TEMP);
  sender.sendInterface(MENU);
  for (const [child, end] of [[ROWS, 30], [KEYS, 30], [ALT_ROWS, 2], [ALT_KEYS, 2]]) sender.sendInterfaceFlagsRange((MENU << 16) | child, 0, end, PAUSEBUTTON);
  sender.sendInterfaceFlagsRange((MENU << 16) | OPTIONS_LAYER, 2, 3, PAUSEBUTTON);
  open.set(player, { ...found, mode: "menu" });
}

function configuration(event) {
  const found = nexusAt(event);
  if (!found) return false;
  const player = event.player;
  if (found.house.owner !== player) return player.sendMessage("Only the owner can configure the nexus."), true;
  const state = stateOf(player, found.furniture);
  const session = { ...found, mode: "config", slots: [...state.slots], left: state.left };
  open.set(player, session);
  const sender = player.getPacketSender();
  sender.sendVarbit(NEXUS_ID, found.tier.id);
  sendConfig(player, session);
  sender.sendInterface(CONFIG);
  sender.sendInterfaceFlagsRange((CONFIG << 16) | SLOTTED, 1, 31, DEPTH5 | DRAG_TARGET);
  sender.sendInterfaceFlagsRange((CONFIG << 16) | NON_SLOTTED, 1, 31, DEPTH5);
  sender.sendInterfaceFlagsRange((CONFIG << 16) | LEFT_CLICK_OPTIONS, 0, 3, OP1);
  sender.sendInterfaceFlagsRange((CONFIG << 16) | CONFIRM_DETAILS, 0, 29, OP10);
  return true;
}

/** The temp slots and the runes the new destinations will cost (the cost inventory). */
function sendConfig(player, session) {
  sendState(player, session.slots, session.left, TEMP_VARBITS, LEFT_TEMP);
  const cost = costOf(player, session);
  player.getPacketSender().sendInventory(COST_INV, Math.max(1, cost.length), cost.map(([id, amount]) => ({ id, amount })));
}

function costOf(player, session) {
  const paid = new Set(stateOf(player, session.furniture).slots);
  const total = new Map();
  for (const id of session.slots) {
    if (paid.has(id)) continue;
    for (const [item, amount] of destinations().get(id)?.runes ?? []) total.set(item, (total.get(item) ?? 0) + amount);
  }
  return [...total];
}

function menuClick(event, session) {
  const player = event.player;
  const sub = event.action;
  if (event.childId === ROWS || event.childId === KEYS) {
    const id = stateOf(player, session.furniture).slots[sub];
    if (id) teleportTo(player, session.house, id);
  } else if (event.childId === ALT_ROWS || event.childId === ALT_KEYS) {
    const alternate = ALTERNATES[sub];
    if (alternate) teleportTo(player, session.house, alternate[0]);
  }
}

function configClick(event, session) {
  const player = event.player;
  if (event.childId === LEFT_TEXT) {
    if (!session.left) player.sendMessage("Drag from the slotted list to the portal to set the left click destination.");
    session.left = 0;
  } else if (event.childId === LEFT_CLICK_OPTIONS) {
    const base = [...destinations().values()].find(data => data.id === session.left || data.alternate === session.left);
    if (base && (event.slot ?? event.action) === 3 && base.alternate) session.left = base.alternate;
    else if (base && (event.slot ?? event.action) === 2) session.left = base.id;
  } else if (event.childId === DONE) {
    return doneClicked(player, session);
  } else if (event.childId === CONFIRM) {
    return done(player, session);
  }
  sendConfig(player, session);
}

/**
 * Done (client script telenexus_okbutton_click): the client compares the sum of the temp slot
 * varbits with the saved ones. Equal, it closes by itself, so a reorder or a new left-click
 * destination saves here; different, it shows the cost panel and waits for Confirm.
 */
function doneClicked(player, session) {
  const sum = (slots) => slots.reduce((total, id) => total + id, 0);
  if (sum(session.slots) === sum(stateOf(player, session.furniture).slots)) return done(player, session);
}

/** Done: pay for new destinations (inventory runes, the spell's Magic level), then save. */
function done(player, session) {
  const added = session.slots.filter(id => !stateOf(player, session.furniture).slots.includes(id));
  const magic = player.getSkillManager().getMaxLevel(Skill.MAGIC);
  const tooHigh = added.map(id => destinations().get(id)).find(data => data && data.level > magic);
  if (tooHigh) return player.sendMessage(`You need a Magic level of ${tooHigh.level} to add ${tooHigh.name}.`);
  const cost = costOf(player, session);
  const inventory = player.getInventory();
  if (cost.some(([item, amount]) => inventory.getAmount(item) < amount)) {
    return player.sendMessage("You don't have the runes to add those destinations. (Combination runes, pouches and staffs cannot be used.)");
  }
  for (const [item, amount] of cost) inventory.delete(item, amount);
  const state = { slots: [...session.slots], left: session.left };
  player.setAttribute(STATE_ATTRIBUTE, state);
  sendState(player, state.slots, state.left, SLOT_VARBITS, LEFT);
  player.getPacketSender().sendVarbit(NEXUS_ID, 0);
  player.getPacketSender().sendInterfaceRemoval();
  open.delete(player);
}

function interfaceClick(event) {
  const session = open.get(event.player);
  if (!session || (event.groupId !== MENU && event.groupId !== CONFIG)) return;
  event.handled = true;
  if (House.houseFor(event.player) !== session.house) return;
  if (event.groupId === MENU && session.mode === "menu") menuClick(event, session);
  else if (event.groupId === CONFIG && session.mode === "config") configClick(event, session);
}

/** player:widget-action drags in the configuration: onto the portal, between slots, to and from the lists. */
function drag(request) {
  const session = open.get(request.player);
  const packet = request.packet;
  if (!session || session.mode !== "config" || packet?.sourceWidgetId >>> 16 !== CONFIG) return;
  request.handled = true;
  const from = packet.sourceWidgetId & 0xffff, to = packet.targetWidgetId & 0xffff;
  const player = request.player;
  if (from === SLOTTED && to === LEFT_CLICK_LAYER) {
    const id = session.slots[packet.sourceSlot - 1];
    if (id) session.left = id;
  } else if (from === SLOTTED && to === SLOTTED) {
    const [a, b] = [packet.sourceSlot - 1, packet.targetSlot - 1];
    if (session.slots[a] && b >= 0 && b < session.slots.length) [session.slots[a], session.slots[b]] = [session.slots[b], session.slots[a]];
  } else if (from === SLOTTED && to === NON_SLOTTED) {
    const id = session.slots.splice(packet.sourceSlot - 1, 1)[0];
    if (session.left === id || destinations().get(id)?.alternate === session.left) session.left = 0;
  } else if (from === NON_SLOTTED && to === SLOTTED) {
    const id = CacheDefinitions.getEnumValues(1375).get(packet.sourceSlot);
    if (!id || session.slots.includes(id)) return;
    if (session.slots.length >= session.tier.slots) return player.sendMessage(`This nexus can only hold ${session.tier.slots} destinations.`);
    session.slots.splice(Math.min(Math.max(packet.targetSlot - 1, 0), session.slots.length), 0, id);
  }
  sendConfig(player, session);
}

function attachNexus(api) {
  api.persistAttribute(STATE_ATTRIBUTE, null);
  api.onInterfaceActionClick(interfaceClick);
  api.onCustomEvent("player:widget-action", drag);
  api.onCustomEvent("interface:close", ({ player }) => open.delete(player));
  api.onPlayerLogin(({ player }) => {
    const state = player.getAttribute(STATE_ATTRIBUTE);
    if (state) sendState(player, state.slots, state.left, SLOT_VARBITS, LEFT);
  });
}

/** Portals.useHousePortal hands the nexus's ops here. */
function nexusOption(event, action) {
  if (action === "teleport") return teleport(event);
  if (action === "teleport menu") return teleportMenu(event);
  if (action === "configuration") return configuration(event);
  return false;
}

Object.assign(module.exports, { attachNexus, nexusOption, STATE_ATTRIBUTE, destinations });
