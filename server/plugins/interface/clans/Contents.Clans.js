/**
 * What's in a Clan Hall: the party chest and lever, balloons, the piano, staff and furniture. No
 * recording holds any of it. The objects and screens are the cache's and the rules the Wiki's (Clan
 * Hall, Chest, Lever, Piano, Party balloon); it leaves balloon counts, drop odds, staff positions
 * and all wording to us (docs/clans.md).
 */

const Core = require("./Core.Clans");

const CHEST_LOC = 46248;
const CHEST_GROUP = 783;
const CHEST_SIDE_GROUP = 266;
const OFFER_LIST = 16;
const CONFIRM = 17;
const CHEST_INV = 916 + 32768; // clan_hall_partychest, which the screen reads with invother_getobj
const OFFER_INV = 92; // partyroom_tempinv
const CHEST_SIZE = 216; // Wiki: Clan Hall
const OFFER_SIZE = 8;
const MAX_STACK = 2147483647;
const LAST_INV_SLOT = 27;
const MAIN_MODAL = (161 << 16) | 16;
const SIDE_MODAL = (161 << 16) | 74;
const OPS_1_TO_5 = 0b111110;
const OFFER_FLAGS_RANGE = OFFER_SIZE - 1;
/** Bits 14-15 of canoeing_menu are farming_tools_selectedquantity: 0 one, 1 five, 2 all, 3 X. */
const QUANTITY_VARP = 675;
const QUANTITY_SHIFT = 14;

const DEPOSIT_SETTING = 94;
const LEVER_SETTING = 95;
const BALLOON_SETTING = 96;
const LEVER_COST = 1000; // Wiki: Lever (Clan Hall)
const FIRST_BALLOON = 115; // 115-122 have Burst in the cache; 123-130, without it, can't be used
const BALLOON_COLOURS = 8;
const BALLOON_TICKS = 200; // Wiki: two minutes
const MIN_BALLOONS = 16; // ours
const MAX_BALLOONS = 64; // ours
const DROP_CHANCE = 0.5; // ours: the Wiki gives a chance, not how much
const BALLOON_AREA = { minX: 1752, maxX: 1772, minY: 5456, maxY: 5476 }; // ours: the main room, by the chest

const PIANO_GROUP = 698;
const PIANO_INIT_SCRIPT = 4321; // clan_hall_piano
const PIANO_KEYS_ENUM = 3799;
const PARAM_KEY_COMPONENT = 1236;
const PARAM_NOTE_SOUND = 1239;
const RHAPSODY_TRACK = 692;

/** Positions are ours: beside what each stands by, as the Wiki describes the rooms. */
const STAFF = [
  { npc: "BANKER_66", x: 1745, y: 5474 }, // the first of clan_hall_banker_0-3, by the deposit box
  { npc: "HANNIBAL", x: 1747, y: 5468 }, // in the kitchen
  { npc: "RAQUEEL", x: 1756, y: 5474 },
  { npc: "GEM", x: 1755, y: 5474 }, // at the bar
  { npc: "GARDENER_JAY_JR", x: 1746, y: 5458 }, // in the garden
];

const SIT_SEQ = 1137; // human_sitting_chair

let core = null;
let api = null;
let hallOf = null;

const openChests = new Map();
const pianists = new Map();
const selectedQuantity = new WeakMap();

function init(pluginApi, findHall) {
  api = pluginApi;
  core = pluginApi.core;
  hallOf = findHall;
}

/** The hall's own staff and state, made when its first visitor arrives. */
function furnish(hall) {
  hall.chest = [];
  hall.balloons = new Map();
  hall.staff = STAFF.map(({ npc: name, x, y }) => {
    const npc = api.spawnNpc({ id: core.NpcIdentifiers[name], x, y, z: 0, wanderRadius: 0 });
    hall.add(npc);
    return npc;
  });
}

function clear(hall) {
  for (const npc of hall.staff ?? []) {
    hall.detach(npc);
    api.removeNpc(npc);
  }
  hall.staff = [];
  for (const balloon of [...(hall.balloons?.values() ?? [])]) removeBalloon(hall, balloon);
}

function allowed(player, clan, setting) {
  const rank = Core.memberOf(clan, Core.accountOf(player))?.rank ?? -1;
  return rank >= Core.permissionRank(clan, setting);
}

// ---------------------------------------------------------------- the chest

function offerOf(player) {
  return openChests.get(player);
}

function invItems(items, size) {
  return Array.from({ length: size }, (_, slot) => {
    const item = items[slot];
    return item ? { id: item.id, amount: item.amount } : null;
  });
}

function sendChest(player, hall) {
  player.getPacketSender().sendInventory(CHEST_INV, CHEST_SIZE, invItems(hall.chest, CHEST_SIZE));
}

function sendOffer(player) {
  player.getPacketSender().sendInventory(OFFER_INV, OFFER_SIZE, invItems(offerOf(player)?.items ?? [], OFFER_SIZE));
}

function openChest({ player, objectId }) {
  if (objectId !== CHEST_LOC) return false;
  const found = hallOf(player);
  if (!found) return false;
  const { hall, clan } = found;
  if (!allowed(player, clan, DEPOSIT_SETTING)) {
    player.sendMessage("You are not a high enough rank to deposit in this chest.");
    return true;
  }
  closeChest(player);
  openChests.set(player, { hall, clan, items: [] });
  // Before the mount: partydrop_main_init sizes its rows from the inventories' capacity.
  sendChest(player, hall);
  sendOffer(player);
  const sender = player.getPacketSender();
  // As the main interface, so "interface:closed" tells of it going by any route, walking away included.
  sender.sendInterface(CHEST_GROUP);
  sender.sendSubInterface(SIDE_MODAL, CHEST_SIDE_GROUP, 3);
  sender.sendInterfaceFlagsRange((CHEST_SIDE_GROUP << 16), 0, LAST_INV_SLOT, OPS_1_TO_5);
  sender.sendInterfaceFlagsRange((CHEST_GROUP << 16) | OFFER_LIST, 0, OFFER_FLAGS_RANGE, OPS_1_TO_5);
  player.sendMessage("Whatever you confirm stays in the chest until the balloons take it.");
  return true;
}

function checkPermissions({ player, objectId }) {
  if (objectId !== CHEST_LOC) return false;
  const found = hallOf(player);
  if (!found) return false;
  const { clan } = found;
  const line = (name, setting) => `${name}: ${allowed(player, clan, setting) ? "yes" : "no"}.`;
  player.sendMessage(`${line("Deposit", DEPOSIT_SETTING)} ${line("Pull the lever", LEVER_SETTING)} ${line("Get drops", BALLOON_SETTING)}`);
  return true;
}

/** Op 2 is one, 3 five, 4 X, 5 all; op 1 is whichever the screen has selected (partydrop_main_offeritems). */
function amountFor(player, op, held, onAmount) {
  const selected = selectedQuantity.get(player) ?? 0;
  const choice = op === 1 ? [2, 3, 5, 4][selected] : op;
  if (choice === 2) onAmount(1);
  else if (choice === 3) onAmount(Math.min(5, held));
  else if (choice === 5) onAmount(held);
  else if (choice === 4) {
    player.setEnteredAmountAction({ execute: (amount) => onAmount(Math.min(amount, held)) });
    player.getPacketSender().sendEnterAmountPrompt("Enter amount:");
  }
}

function offer(player, slot, op) {
  const state = offerOf(player);
  const inventory = player.getInventory();
  const item = inventory.getItems()[slot];
  if (!state || !item || item.getId() < 0) return;
  const id = item.getId();
  if (core.ItemDefinition.forId(id)?.isTradeable?.() === false) {
    player.sendMessage("That item can't go in the chest.");
    return;
  }
  const held = inventory.getAmount(id);
  amountFor(player, op, held, (amount) => {
    if (offerOf(player) !== state) return;
    const stack = state.items.find((entry) => entry.id === id);
    const moved = Math.min(amount, inventory.getAmount(id), MAX_STACK - (stack?.amount ?? 0));
    if (moved <= 0 || (!stack && state.items.length >= OFFER_SIZE)) return;
    inventory.delete(id, moved);
    if (stack) stack.amount += moved;
    else state.items.push({ id, amount: moved });
    sendOffer(player);
  });
}

function takeBack(player, slot, op) {
  const state = offerOf(player);
  const stack = state?.items[slot];
  if (!stack) return;
  amountFor(player, op, stack.amount, (amount) => {
    const moved = Math.min(amount, stack.amount);
    if (moved <= 0 || offerOf(player) !== state || !state.items.includes(stack)) return;
    giveBack(player, stack.id, moved);
    stack.amount -= moved;
    if (stack.amount === 0) state.items = state.items.filter((entry) => entry !== stack);
    sendOffer(player);
  });
}

/** Never lost: what doesn't fit in the inventory lands at the player's feet. */
function giveBack(player, id, amount) {
  player.getInventory().forceAdd(player, new core.Item(id, amount));
}

function confirm(player) {
  const state = offerOf(player);
  if (!state || state.items.length === 0) return;
  const { hall } = state;
  const stacks = new Set(hall.chest.map((entry) => entry.id));
  for (const { id } of state.items) stacks.add(id);
  if (stacks.size > CHEST_SIZE) {
    player.sendMessage("The chest can't hold that many different items.");
    return;
  }
  const held = (id) => hall.chest.find((entry) => entry.id === id)?.amount ?? 0;
  if (state.items.some(({ id, amount }) => held(id) + amount > MAX_STACK)) {
    player.sendMessage("The chest can't hold any more of that.");
    return;
  }
  for (const { id, amount } of state.items) {
    const stack = hall.chest.find((entry) => entry.id === id);
    if (stack) stack.amount += amount;
    else hall.chest.push({ id, amount });
  }
  state.items = [];
  sendOffer(player);
  for (const [viewer, open] of openChests) if (open.hall === hall) sendChest(viewer, hall);
}

/** Anything not confirmed goes back to who offered it. */
function closeChest(player) {
  const state = offerOf(player);
  if (!state) return;
  openChests.delete(player);
  for (const { id, amount } of state.items) giveBack(player, id, amount);
}

/** The screens are main interfaces, so this hears them close by any route. */
function interfaceClosed({ player, interfaceId }) {
  if (interfaceId === CHEST_GROUP) closeChest(player);
  else if (interfaceId === PIANO_GROUP) pianists.delete(player);
}

/** A plugin can mount over the main modal without closing it. */
function interfaceOpened({ player, targetUid, groupId }) {
  if (targetUid !== MAIN_MODAL) return;
  if (groupId !== CHEST_GROUP) closeChest(player);
  if (groupId !== PIANO_GROUP) pianists.delete(player);
}

function playerGone(player) {
  closeChest(player);
  pianists.delete(player);
}

function clickChest(event) {
  const { player, groupId, childId, slot, action } = event;
  if (groupId !== CHEST_SIDE_GROUP && groupId !== CHEST_GROUP) return;
  event.handled = true;
  if (!player.getPacketSender().isSubInterfaceOpen(CHEST_GROUP)) {
    closeChest(player);
    return;
  }
  if (groupId === CHEST_SIDE_GROUP) {
    offer(player, slot, action);
  } else {
    if (childId === OFFER_LIST) takeBack(player, slot, action);
    else if (childId === CONFIRM) confirm(player);
  }
}

function varpTransmitted(event) {
  if (event.varpId !== QUANTITY_VARP || !openChests.has(event.player)) return;
  selectedQuantity.set(event.player, (event.value >> QUANTITY_SHIFT) & 3);
  event.handled = true;
}

// ---------------------------------------------------------------- the lever and balloons

function randomFreeTile(hall) {
  for (let tries = 0; tries < 30; tries++) {
    const x = BALLOON_AREA.minX + Math.floor(Math.random() * (BALLOON_AREA.maxX - BALLOON_AREA.minX + 1));
    const y = BALLOON_AREA.minY + Math.floor(Math.random() * (BALLOON_AREA.maxY - BALLOON_AREA.minY + 1));
    const key = `${x},${y}`;
    if (hall.balloons.has(key)) continue;
    const tile = new core.Location(x, y, 0);
    if (!core.RegionManager.blocked(tile, hall) && core.ObjectManager.objectsAt(tile).length === 0) return { key, tile };
  }
  return null;
}

function removeBalloon(hall, balloon) {
  if (!hall.balloons.has(balloon.key)) return;
  hall.balloons.delete(balloon.key);
  core.ObjectManager.deregister(balloon.object, true);
}

function releaseBalloons(hall, later) {
  const count = Math.max(MIN_BALLOONS, Math.min(MAX_BALLOONS, hall.chest.length * 2));
  for (let index = 0; index < count; index++) {
    const spot = randomFreeTile(hall);
    if (!spot) return;
    const id = FIRST_BALLOON + Math.floor(Math.random() * BALLOON_COLOURS);
    const object = new core.GameObject(id, spot.tile, 10, 0, hall);
    const balloon = { key: spot.key, object };
    hall.balloons.set(spot.key, balloon);
    core.ObjectManager.register(object, true);
    later(BALLOON_TICKS, () => removeBalloon(hall, balloon));
  }
}

let later = null;

function setScheduler(schedule) {
  later = schedule;
}

function pullLever({ player }) {
  const found = hallOf(player);
  if (!found) return false;
  const { hall, clan } = found;
  if (!allowed(player, clan, LEVER_SETTING)) {
    player.sendMessage("You are not a high enough rank to pull this lever.");
    return true;
  }
  if (hall.chest.length === 0) {
    player.sendMessage("The chest is empty.");
    return true;
  }
  const { COINS } = core.ItemIdentifiers;
  if (player.getInventory().getAmount(COINS) < LEVER_COST) {
    player.sendMessage(`You need ${LEVER_COST.toLocaleString("en-GB")} coins to pull the lever.`);
    return true;
  }
  player.getInventory().delete(COINS, LEVER_COST);
  releaseBalloons(hall, later);
  for (const visitor of hall.getPlayers()) visitor.sendMessage("Balloon Bonanza! The party balloons have been released.");
  return true;
}

function burst({ player, location }) {
  const found = hallOf(player);
  if (!found) return false;
  const { hall, clan } = found;
  const balloon = hall.balloons.get(`${location.x},${location.y}`);
  if (!balloon) return true;
  removeBalloon(hall, balloon);
  if (!allowed(player, clan, BALLOON_SETTING) || Core.ironmanMode(player) !== "none") return true;
  if (hall.chest.length === 0 || Math.random() >= DROP_CHANCE) return true;
  const index = Math.floor(Math.random() * hall.chest.length);
  const [stack] = hall.chest.splice(index, 1);
  const drop = new core.ItemOnGround(
    core.GroundItemState.SEEN_BY_EVERYONE, undefined,
    new core.Location(location.x, location.y, location.z ?? 0), new core.Item(stack.id, stack.amount),
    false, -1, hall,
  );
  core.ItemOnGroundManager.register(drop);
  for (const [viewer, open] of openChests) if (open.hall === hall) sendChest(viewer, hall);
  return true;
}

// ---------------------------------------------------------------- the piano

/** Key component uid -> note sound, from the cache's own table. */
let pianoNotes = null;

function noteFor(uid) {
  if (!pianoNotes) {
    pianoNotes = new Map();
    for (const [, struct] of core.CacheDefinitions.getEnumValues(PIANO_KEYS_ENUM)) {
      const params = core.CacheDefinitions.getStructParams(Number(struct));
      pianoNotes.set(params.get(PARAM_KEY_COMPONENT), params.get(PARAM_NOTE_SOUND));
    }
  }
  return pianoNotes.get(uid);
}

function openPiano(player, heardByAll) {
  pianists.set(player, heardByAll);
  const sender = player.getPacketSender();
  sender.sendInterface(PIANO_GROUP);
  sender.sendClientScript(PIANO_INIT_SCRIPT);
}

function entertain({ player }) {
  if (!hallOf(player)) return false;
  openPiano(player, true);
  return true;
}

function playQuietly({ player }) {
  if (!hallOf(player)) return false;
  openPiano(player, false);
  return true;
}

function backgroundMusic({ player }) {
  if (!hallOf(player)) return false;
  api.emitCustomEvent("music:unlock-track", { player, trackId: RHAPSODY_TRACK });
  return true;
}

/** The client plays its own note; Entertain has everyone else in the hall hear it too. */
function clickPiano(event) {
  if (event.groupId !== PIANO_GROUP) return;
  event.handled = true;
  const { player, groupId, childId } = event;
  if (pianists.get(player) !== true || !player.getPacketSender().isSubInterfaceOpen(PIANO_GROUP)) return;
  const note = noteFor((groupId << 16) | childId);
  const found = hallOf(player);
  if (!note || !found) return;
  for (const visitor of found.hall.getPlayers()) {
    if (visitor !== player) visitor.getPacketSender().sendSound(note, 255, 0);
  }
}

// ---------------------------------------------------------------- furniture

function sit({ player }) {
  if (!hallOf(player)) return false;
  player.performAnimation(new core.Animation(SIT_SEQ));
  return true;
}

function hitDummy({ player }) {
  if (!hallOf(player)) return false;
  player.sendMessage("You hit the dummy, but learn nothing from it.");
  return true;
}

function searchBooks({ player }) {
  if (!hallOf(player)) return false;
  player.sendMessage("You find nothing of interest in the bookcase.");
  return true;
}

function reset() {
  openChests.clear();
  pianists.clear();
  pianoNotes = null;
}

module.exports = {
  backgroundMusic,
  burst,
  checkPermissions,
  clear,
  clickChest,
  clickPiano,
  closeChest,
  entertain,
  furnish,
  hitDummy,
  init,
  interfaceClosed,
  interfaceOpened,
  openChest,
  playerGone,
  playQuietly,
  pullLever,
  reset,
  searchBooks,
  setScheduler,
  sit,
  varpTransmitted,
};
