/**
 * What's in a Clan Hall: the party chest and lever, balloons, the piano, staff and furniture. No
 * recording holds any of it. The objects and screens are the cache's and the rules the Wiki's (Clan
 * Hall, Chest, Lever, Piano, Party balloon); it leaves balloon counts, drop odds, staff positions
 * and all wording to us (docs/clans.md).
 */

const Core = require("./Core.Clans");
const PartyChest = require("../partychest/Offer.PartyChest");

const CHEST_LOC = 46248;
const CHEST_GROUP = 783;
const OFFER_LIST = 16;
const CONFIRM = 17;
const CHEST_INV = 916 + 32768; // clan_hall_partychest, which the screen reads with invother_getobj
const CHEST_SIZE = 216; // Wiki: Clan Hall
/** What's offered and not yet confirmed, in the player's save: only here do the items still exist. */
const OFFER_ATTRIBUTE = "clans:chest-offer";
const MAIN_MODAL = (161 << 16) | 16;

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
const PIANO_CLOSE = 45; // clan_piano:close_button, a static transmit op1 "Close" (rev 241)
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

const pianists = new Map();

function init(pluginApi, findHall) {
  api = pluginApi;
  core = pluginApi.core;
  hallOf = findHall;
  chestScreen.init(pluginApi, core);
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

/** The offer flow is shared with the Party Room: interface/partychest. Here: whose chest, and who may deposit. */
const chestScreen = PartyChest.create({
  mainGroup: CHEST_GROUP,
  offerList: OFFER_LIST,
  confirmComponent: CONFIRM,
  chestInv: CHEST_INV,
  chestSize: CHEST_SIZE,
  offerAttribute: OFFER_ATTRIBUTE,
  chestOf: ({ hall }) => hall.chest,
  welcome: "Whatever you confirm stays in the chest until the balloons take it.",
  /** The rank can rise while the screen is up. Taking back and closing stay open, so nothing is stuck. */
  canDeposit(player, { clan }) {
    if (allowed(player, clan, DEPOSIT_SETTING)) return true;
    player.sendMessage("You are not a high enough rank to deposit in this chest.");
    return false;
  },
});

const restoreOffer = chestScreen.restoreOffer;
const closeChest = chestScreen.close;
const clickChest = chestScreen.click;
const varpTransmitted = chestScreen.varpTransmitted;

function openChest({ player, objectId }) {
  if (objectId !== CHEST_LOC) return false;
  const found = hallOf(player);
  if (!found) return false;
  chestScreen.open(player, found);
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

/** The screens are main interfaces, so this hears them close by any route. */
function interfaceClosed(event) {
  chestScreen.interfaceClosed(event);
  if (event.interfaceId === PIANO_GROUP) pianists.delete(event.player);
}

/** A plugin can mount over the main modal without closing it. */
function interfaceOpened(event) {
  chestScreen.interfaceOpened(event);
  if (event.targetUid === MAIN_MODAL && event.groupId !== PIANO_GROUP) pianists.delete(event.player);
}

function playerGone(player) {
  closeChest(player);
  pianists.delete(player);
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
  chestScreen.refreshViewers(hall.chest);
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
  if (childId === PIANO_CLOSE) {
    player.getPacketSender().closeInterface(PIANO_GROUP);
    return;
  }
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
  chestScreen.reset();
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
  restoreOffer,
  searchBooks,
  setScheduler,
  sit,
  varpTransmitted,
};
