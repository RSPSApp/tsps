"use strict";

// Lifecycle and serve flow adapted from GregHib/void (BSD-3-Clause);
// Genie/Dwarf owner checks and rewards adapted from LostCityRS/Content (MIT).
// See SOURCES.md and LICENSES.txt alongside this module.
const TRAY_GROUP = 297;
const TRAY_TITLE = (TRAY_GROUP << 16) | 2;
const TRAY_FIRST_FOOD = 6;
const TRAY_SELECT_ACTION = 1;
const EVENT_LIFETIME_MS = 180_000;
const NAG_INTERVAL_MS = 18_000;
const MAX_DISTANCE = 15;
const DEFINITIONS_EVENT = "random-events:definitions";
const Gift = require("./GiftRewards");
const Certer = require("./Certer");
const players = new Map();
const eventsByNpc = new Map();
let api;
let events;
let foods;

function initialize(pluginApi) {
  shutdown();
  api = pluginApi;
  const { NpcIdentifiers: N, ItemIdentifiers: I } = api.core;
  foods = [
    [I.BAGUETTE, "baguette"], [I.TRIANGLE_SANDWICH, "triangle sandwich"],
    [I.SQUARE_SANDWICH, "square sandwich"], [I.ROLL, "roll"],
    [I.MEAT_PIE, "meat pie"], [I.KEBAB, "kebab"], [I.CHOCOLATE_BAR, "chocolate bar"],
  ];
  events = [
    { id: N.GENIE, kind: "genie", rewards: [I.LAMP], greeting: "Greetings" },
    { id: N.SANDWICH_LADY, kind: "sandwich", greeting: "Sandwich delivery for" },
    { id: N.DRUNKEN_DWARF, kind: "dwarf", rewards: [I.KEBAB, I.BEER], greeting: "'Ello der" },
    { id: N.RICK_TURPENTINE, kind: "gift", greeting: "A gift for",
      rewardMessage: "Rick Turpentine gives you a gift to make amends." },
    { ids: [N.NILES, N.MILES, N.GILES], kind: "certer", greeting: "A question for" },
    { id: N.MYSTERIOUS_OLD_MAN_2, kind: "gift", greeting: "Greetings",
      rewardMessage: "The mysterious old man gives you a gift." },
  ];
  // Members plugins contribute definitions only when loaded by PluginManager.
  api.emitCustomEvent(DEFINITIONS_EVENT, { definitions: events });
}

// Port of Void's initial cooldown and re-arming before an attempted spawn.
// The original OSRS scheduler is unpublished; use the reference's 60–120 minutes.
function nextEventAt(now) {
  return now + (60 + Math.random() * 60) * 60_000;
}

function login({ player }) {
  cleanup({ player });
  if (player?.isPlayerBot?.() === true) return;
  players.set(player, { nextAt: nextEventAt(Date.now()), active: null });
}

function eligible(player) {
  const combat = player.getCombat();
  const location = player.getLocation();
  const x = location.getX(), y = location.getY();
  // Same surface/underground footprint as TutorialIsland's existing restriction.
  const tutorial = location.getZ() === 0 && x >= 3060 && x <= 3165 &&
    ((y >= 3060 && y <= 3165) || (y >= 9400 && y <= 9620));
  return player.isRegistered() && player.isPlayerBot?.() !== true &&
    player.getHitpoints() > 0 && !player.busy() && !player.isDyingReturn?.() &&
    !player.isTeleportingReturn?.() && player.getForceMovement?.() == null &&
    player.getPrivateArea?.() == null && !tutorial &&
    (player.getArea?.() == null || api.core.Wilderness.isPvpArea(location)) &&
    !player.getDueling?.().inDuel?.() &&
    !combat.getTarget() && !combat.getAttacker() && !player.getCombatFollowing?.();
}

function spawn(player, state, now, definition = null) {
  const origin = player.getLocation();
  const { Location } = api.core;
  // LostCity uses a line-of-walk square beside the player; the local collision
  // manager's traversal check rejects walls as well as blocked destination tiles.
  const candidates = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const region = api.getRegionManager();
  const tile = candidates.map(([dx, dy]) => new Location(origin.getX() + dx, origin.getY() + dy, origin.getZ()))
    .find((location) => !region.blocked(location, player.getPrivateArea?.()) &&
      region.canMovestart(origin, location, 1, 1, player.getPrivateArea?.()));
  if (!tile) return false;
  definition ??= events[Math.floor(Math.random() * events.length)];
  const npc = api.spawnNpc({
    id: definition.ids ? definition.ids[Math.floor(Math.random() * definition.ids.length)] : definition.id,
    x: tile.getX(), y: tile.getY(), z: tile.getZ(),
    owner: player, wanderRadius: 0,
  });
  if (!npc) return false;
  const active = {
    player, npc, definition, startedAt: now, expiresAt: now + EVENT_LIFETIME_MS,
    nextNagAt: now + NAG_INTERVAL_MS,
    foodIndex: definition.kind === "sandwich" ? Math.floor(Math.random() * foods.length) : null,
    trayOpen: false,
  };
  state.active = active;
  eventsByNpc.set(npc, active);
  if (!definition.stationary) {
    npc.setFollowing(player);
    npc.setMobileInteraction(player);
  }
  if (definition.greeting) npc.forceChat(`${definition.greeting} ${player.getUsername()}!`);
  definition.onSpawn?.(active);
  return true;
}

function spawnCommand(event) {
  event.handled = true;
  const { player, parts } = event;
  const index = parts.length === 1 ? Math.floor(Math.random() * events.length) : Number(parts[1]);
  if (parts.length > 2 || (parts.length === 2 && !/^\d+$/.test(parts[1])) ||
      !Number.isInteger(index) || index < 0 || index >= events.length) {
    player.sendMessage(`Usage: ::randevt [id] (0-${events.length - 1}; omit id for random).`);
    return;
  }
  if (!eligible(player)) {
    player.sendMessage("Move outside combat and restricted activities before testing a random event.");
    return;
  }
  login({ player }); // Replace the previous owned event and re-arm its cooldown.
  if (spawn(player, players.get(player), Date.now(), events[index])) {
    player.sendMessage(`Spawned random event ${index} (${events[index].kind}).`);
  } else {
    player.sendMessage("No traversable square is available beside you.");
  }
}

function valid(active, player, now = Date.now()) {
  if (!active || active.player !== player || active.npc.getOwner() !== player ||
      players.get(player)?.active !== active || now >= active.expiresAt ||
      !player.isRegistered() || player.getHitpoints() <= 0) return false;
  const a = player.getLocation(), b = active.npc.getLocation();
  return player.getPrivateArea?.() == null && a.getZ() === b.getZ() && a.getDistance(b) <= MAX_DISTANCE;
}

function finish(active) {
  const state = players.get(active.player);
  if (state?.active === active) {
    state.active = null;
    state.nextAt = nextEventAt(Date.now());
  }
  eventsByNpc.delete(active.npc);
  if (active.interfaceId && active.player.getInterfaceId() === active.interfaceId) {
    active.player.getPacketSender().sendInterfaceRemoval();
  }
  api.removeNpc(active.npc);
}

function processPlayer({ player }) {
  if (!api) return;
  let state = players.get(player);
  if (!state) {
    login({ player });
    state = players.get(player);
  }
  if (!state) return;
  const now = Date.now();
  if (state.active) {
    const active = state.active;
    if (!valid(active, player, now)) { finish(active); return; }
    if (active.definition.greeting && now >= active.nextNagAt) {
      active.npc.forceChat(`I've got something for you, ${player.getUsername()}!`);
      active.nextNagAt = now + NAG_INTERVAL_MS;
    }
    return;
  }
  if (api.getPluginConfig("random-events:enabled", true) === false || now < state.nextAt || !eligible(player)) return;
  state.nextAt = nextEventAt(now);
  spawn(player, state, now);
}

function serve(active, rewards, exchange = null) {
  const player = active.player;
  if (!valid(active, player)) return false;
  const inventory = player.getInventory();
  if (exchange && (inventory.get(exchange.slot) !== exchange.item || exchange.item.getAmount() !== 1)) return false;
  const items = rewards.map(reward => new api.core.Item(typeof reward === "number" ? reward : reward.id,
    typeof reward === "number" ? 1 : reward.amount));
  const slots = items.filter(item => !item.getDefinition().isStackable() || !inventory.containsNumber(item.getId())).length;
  if (inventory.getFreeSlots() + (exchange ? 1 : 0) < slots) {
    player.sendMessage(`You'll need ${slots} free inventory space${slots === 1 ? "" : "s"}.`);
    return false;
  }
  // Void clears state before serving: repeated interactions cannot claim twice.
  finish(active);
  if (exchange) inventory.deleteAtSlot(exchange.slot, 1);
  for (const item of items) inventory.addItem(item);
  return true;
}

function talk({ player, npc }) {
  const active = eventsByNpc.get(npc);
  if (!active) return false; // Other NPCs with these names retain their own dialogue.
  if (!valid(active, player)) {
    player.sendMessage("Sorry, I'm here to talk to someone else.");
    return true;
  }
  if (active.definition.talk) {
    active.definition.talk(active, { valid, serve, finish });
    return true;
  }
  if (active.definition.kind === "certer") { Certer.open(api, active); return true; }
  if (active.definition.kind === "gift") {
    active.gift ??= Gift.roll(api);
    if (serve(active, [active.gift])) player.sendMessage(active.definition.rewardMessage);
    return true;
  }
  if (active.definition.kind !== "sandwich") {
    if (serve(active, active.definition.rewards)) {
      player.sendMessage(active.definition.kind === "genie"
        ? "The genie gives you a lamp. Rub it to make your wish!"
        : "The drunken dwarf gives you a kebab and a beer.");
    }
    return true;
  }
  active.trayOpen = true;
  active.interfaceId = TRAY_GROUP;
  const sender = player.getPacketSender();
  sender.sendInterface(TRAY_GROUP);
  sender.sendString(`Have a ${foods[active.foodIndex][1]} for free!`, TRAY_TITLE);
  foods.forEach(([id], index) => {
    const uid = (TRAY_GROUP << 16) | (TRAY_FIRST_FOOD + index);
    sender.sendItemOnInterfaces(uid, id, 1);
    sender.sendInterfaceFlagsRange(uid, -1, -1, 1 << TRAY_SELECT_ACTION);
  });
  return true;
}

function chooseSandwich(event) {
  const { player, buttonId } = event;
  if ((buttonId >>> 16) !== TRAY_GROUP) return;
  const index = (buttonId & 0xffff) - TRAY_FIRST_FOOD;
  if (index < 0 || index >= foods.length) return;
  event.handled = true;
  const active = players.get(player)?.active;
  if (event.action !== TRAY_SELECT_ACTION || !active?.trayOpen || active.definition.kind !== "sandwich" ||
      player.getInterfaceId() !== TRAY_GROUP || !valid(active, player)) return;
  if (index !== active.foodIndex) {
    player.sendMessage("That isn't the refreshment she offered. Try again!");
    return;
  }
  let id = foods[index][0];
  if (id === api.core.ItemIdentifiers.BAGUETTE && Math.floor(Math.random() * 64) === 0) id = api.core.ItemIdentifiers.STALE_BAGUETTE;
  if (serve(active, [id])) player.sendMessage("The sandwich lady gives you your refreshment.");
}

function dismiss({ player, npc }) {
  const active = eventsByNpc.get(npc);
  if (!active) return false;
  if (valid(active, player)) finish(active);
  return true;
}

function chooseCerter(event) {
  Certer.choose(api, players.get(event.player)?.active, event, { valid, serve, finish });
}

function cleanup({ player }) {
  const active = players.get(player)?.active;
  if (active) finish(active);
  players.delete(player);
}

function shutdown() {
  for (const active of [...eventsByNpc.values()]) finish(active);
  players.clear();
}

module.exports = { DEFINITIONS_EVENT, initialize, login, processPlayer, spawnCommand, talk, chooseSandwich, chooseCerter, dismiss, cleanup, shutdown };
