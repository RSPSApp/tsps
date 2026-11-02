/**
 * Shared Taverley Dungeon key doors, Velrak's canonical dusty-key hand-out and the suits of
 * armour guarding the Cauldron of Thunder's prison door.
 */
const DOORS = [
  { id: 'DOOR_99', key: 'JAIL_KEY', tile: [2931, 9690, 0], inside: [2931, 9689, 0], freeExit: true },
  { id: 'DOOR_99', key: 'JAIL_KEY', tile: [2931, 9694, 0], inside: [2931, 9695, 0], freeExit: true },
  { id: 'GATE_57', key: 'DUSTY_KEY', tile: [2924, 9803, 0], inside: [2923, 9803, 0], freeExit: false },
];
/**
 * Live (rsprox 3250 rev 233, 3279 rev 234): each Open on the prison door while a suit still
 * stands wakes the suit nearest the player instead of opening it - the suit loc is removed,
 * Suit of armour (5043) appears on its tile and attacks. "Suddenly the suit of armour comes to
 * life!" was sent for the first suit only. The door opens once no suit is left standing.
 * Neither the captures nor the Wiki tie it to a Druidic Ritual stage.
 */
const CAULDRON_PRISON_DOORS = [
  { id: 'PRISON_DOOR_4', tile: [2889, 9830, 0] },
  { id: 'PRISON_DOOR_3', tile: [2889, 9831, 0] },
];
/**
 * Each suit's stand, and the tile in front of it it steps out to before going for the player
 * (rsprox 3250: 9829 walks north to 9830, 9832 south to 9831, then east). The core's one-step
 * pursuit would aim at the blocked floor beside the alcove instead, and give up.
 */
const CAULDRON_SUITS = [
  { tile: [2887, 9829, 0], stepOut: [2887, 9830, 0] },
  { tile: [2887, 9832, 0], stepOut: [2887, 9831, 0] },
];
const CAULDRON_SUIT_TILES = CAULDRON_SUITS.map(suit => suit.tile);
const SUIT_AWAKENS_MESSAGE = 'Suddenly the suit of armour comes to life!';
/**
 * Live suits were still awake 167 and 267 ticks after waking (1702, 3279); when an unkilled
 * suit goes back is not captured, so it stands down after this long without a fight.
 */
const SUIT_AWAKE_MIN_TICKS = 300;
const SUIT_IDLE_TICKS = 10;
const SUIT_WANDER_RADIUS = 3;
/** How long a suit gets to step out before it goes for the player anyway. */
const SUIT_STEP_OUT_TICKS = 3;
/** Tile key -> the awake suit NPC; its loc is gone until the NPC dies or stands down. */
const awakeSuits = new Map();
const VELRAK_PAGE = 'Velrak the explorer';
const DUSTY_KEY_RECEIPT = 'sM-0Hv';

function at(location, [x, y, z]) {
  return (location?.getX?.() ?? location?.x) === x
    && (location?.getY?.() ?? location?.y) === y
    && (location?.getZ?.() ?? location?.z) === z;
}

function doorAt(core, event) {
  const location = event.location ?? event.object?.getLocation?.();
  return DOORS.find(door => event.objectId === core.ObjectIdentifiers[door.id] && at(location, door.tile));
}

function checkDoorKey(core, event) {
  if (event.handled) return;
  const door = doorAt(core, event);
  if (!door) return;
  if (door.freeExit && at(event.player.getLocation(), door.inside)) return;
  if (event.player.getInventory().getAmount(core.ItemIdentifiers[door.key]) > 0) return;
  event.player.sendMessage('The door is locked.');
  event.handled = true;
}

function useKey(api, event) {
  const door = doorAt(api.core, event);
  if (!door || event.itemId !== api.core.ItemIdentifiers[door.key]) return;
  const request = { ...event, handled: false };
  api.emitCustomEvent('door:open', request);
  if (request.handled) event.handled = true;
}

function isVelrak(core, event) {
  return event.npcId === core.NpcIdentifiers.VELRAK_THE_EXPLORER
    && event.pages?.some(({ page }) => page === VELRAK_PAGE);
}

function answerVelrak(core, event) {
  if (!isVelrak(core, event)) return null;
  const held = event.player.getInventory().getAmount(core.ItemIdentifiers.DUSTY_KEY) > 0;
  if (event.text === 'Without having a dusty key in the inventory:') return !held;
  if (event.text === 'With a dusty key in the inventory:') return held;
  return null;
}

function giveDustyKey(core, event) {
  if (event.kind !== 'message' || event.stepId !== DUSTY_KEY_RECEIPT || !isVelrak(core, event)) return;
  event.handled = true;
  const inventory = event.player.getInventory();
  const key = core.ItemIdentifiers.DUSTY_KEY;
  const before = inventory.getAmount(key);
  if (before > 0) {
    event.end = true;
    return;
  }
  if (inventory.getFreeSlots() < 1) {
    inventory.full();
    event.end = true;
    return;
  }
  inventory.adds(key, 1);
  if (inventory.getAmount(key) !== before + 1) {
    event.end = true;
    return;
  }
  event.box = { items: [key] };
}

function tileKey([x, y, z]) {
  return `${x},${y},${z}`;
}

function isCauldronPrisonDoor(core, event) {
  const location = event.location ?? event.object?.getLocation?.();
  return CAULDRON_PRISON_DOORS.some(door =>
    event.objectId === core.ObjectIdentifiers[door.id] && at(location, door.tile));
}

function standingSuit(core, tile) {
  if (awakeSuits.has(tileKey(tile))) return null;
  return core.MapObjects.get(core.ObjectIdentifiers.SUIT_OF_ARMOUR_2, new core.Location(...tile), null) ?? null;
}

function nearestStandingSuit(core, player) {
  const from = player.getLocation();
  let nearest = null;
  for (const tile of CAULDRON_SUIT_TILES) {
    const object = standingSuit(core, tile);
    if (!object) continue;
    const distance = from.getDistance(object.getLocation());
    if (!nearest || distance < nearest.distance) nearest = { tile, object, distance };
  }
  return nearest;
}

function restoreSuit(core, key, object) {
  awakeSuits.delete(key);
  core.ObjectManager.register(new core.GameObject(object.getId(), object.getLocation().clone(),
    object.getType(), object.getFace(), null), true);
}

function suitHasStoodDown(npc, ticks) {
  if (ticks < SUIT_AWAKE_MIN_TICKS || npc.isDyingFunction()) return false;
  const combat = npc.getCombat();
  return !combat.getTarget() && combat.ticksSinceAttacked() >= SUIT_IDLE_TICKS;
}

/** Puts the suit back once its NPC is gone (killed or removed), or after it stands down. */
function watchSuit(api, key, object, npc) {
  const { core } = api;
  let ticks = 0;
  const task = new core.Task(1, `taverley-suit:${key}`);
  task.execute = () => {
    ticks++;
    if (npc.isRegistered() && !suitHasStoodDown(npc, ticks)) return;
    task.stop();
    if (npc.isRegistered()) api.removeNpc(npc);
    restoreSuit(core, key, object);
  };
  core.TaskManager.submit(task);
}

/** The suit steps out of its alcove, then goes for the player. */
function stepOutAndAttack(core, npc, tile, player) {
  const { stepOut } = CAULDRON_SUITS.find(suit => tileKey(suit.tile) === tileKey(tile));
  npc.getMovementQueue().addFirstStep(new core.Location(...stepOut));
  let ticks = 0;
  const task = new core.Task(1, npc);
  task.execute = () => {
    const out = at(npc.getLocation(), stepOut);
    if (!out && ++ticks < SUIT_STEP_OUT_TICKS) return;
    task.stop();
    if (npc.isRegistered() && player.isRegistered()) npc.getCombat().attack(player);
  };
  core.TaskManager.submit(task);
}

function wakeSuit(api, event) {
  const { core } = api;
  if (event.handled || !isCauldronPrisonDoor(core, event)) return;
  const { player } = event;
  // The suits and their locs are the shared world's; an instanced copy opens normally.
  if (player.getPrivateArea?.()) return;
  const suit = nearestStandingSuit(core, player);
  if (!suit) return;
  const [x, y, z] = suit.tile;
  // rsprox 1702: an awake suit wanders a few tiles from its stand.
  const npc = api.spawnNpc({ id: core.NpcIdentifiers.SUIT_OF_ARMOUR, x, y, z, wanderRadius: SUIT_WANDER_RADIUS });
  if (!npc) return;
  event.handled = true;
  npc.__skipDefaultRespawn = true;
  if (awakeSuits.size === 0) player.sendMessage(SUIT_AWAKENS_MESSAGE);
  const key = tileKey(suit.tile);
  awakeSuits.set(key, npc);
  core.ObjectManager.deregister(suit.object, true);
  stepOutAndAttack(core, npc, suit.tile, player);
  watchSuit(api, key, suit.object, npc);
}

module.exports = {
  name: 'TaverleyDungeon',
  members: true,
  register(api) {
    api.onCustomEvent('door:toggle', checkDoorKey.bind(null, api.core));
    api.onCustomEvent('door:toggle', wakeSuit.bind(null, api));
    api.onItemOnObject(useKey.bind(null, api), { noted: false });
    api.onNpcDialogueCondition(answerVelrak.bind(null, api.core));
    api.onCustomEvent('npc-dialogue:action', giveDustyKey.bind(null, api.core));
  },
  __internals: { awakeSuits },
};
