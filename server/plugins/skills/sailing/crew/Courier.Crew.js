// Crewmates carrying courier crates (rsprox, Cabin Boy Jenkins and Jobless Jim; Wiki, Courier
// tasks): with the player's boat docked, the crew carry what the player can't.
//   pickup: taking a task's crate at the ledger table brings the crew ("Your crew come to help you
//   carry the heavy cargo."): each takes 1 crate, 2 with Deckhandiness 3 or 4, of what's left to
//   collect, appears beside the player in their carrying form (one per crate count) with a puff
//   of smoke, and follows them. Boarding, they pack them into the hold ("Your crew pack the cargo
//   they were holding into the cargo hold.") and the crates count as taken.
//   delivery: disembarking with a crate in hand at its destination, a tick later the crew carry
//   the task's other crates out of the hold; the ledger takes theirs before the player's ("Your
//   crew drop off the cargo that needed to be delivered here.", Ledger.PortTasks.js).
// Not captured, so guessed: crew who wander off (the player leaves the port without boarding, or
// teleports) put the crates back where they came from, and a hold too full to pack them keeps
// the rest at the ledger table.
const common = require("./Common.Crew");
const assign = require("./Assign.Crew");
const portTasks = require("../porttasks/Common.PortTasks");
const cargo = require("../Cargo.Sailing");

const COME = "Your crew come to help you carry the heavy cargo.";
const PACKED = "Your crew pack the cargo they were holding into the cargo hold.";
/** smokepuff_quick, where a carrying crewmate appears and where they go aboard (rsprox). */
const SMOKE = 2902;
const SMOKE_HEIGHT = 30;
/** Tiles from the dock the crew follow the player before giving up (a guess). */
const PORT_RANGE = 32;
/** Where carrying crewmates appear, around the player (rsprox: 2 west and 1 south, then 1 north), first walkable first. */
const OFFSETS = [[-2, -1], [0, 1], [-1, -1], [1, 1], [-1, 1]];
/** How far from the player a crewmate may appear, in steps. */
const APPEAR_STEPS = 2;
const STEPS = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];

let pluginApi;
/** Per player: the crewmates carrying for them, `{ index, kind, dockId, npcs, task }`. */
const carrying = new WeakMap();

function capacityOf(crew) {
  return crew.stats[common.STAT.DECKHANDINESS] >= 3 ? 2 : 1;
}

/** The player's active boat, if it's docked at this dock. */
function boatDockedAt(player, dockId) {
  const owned = common.core().Sailing.activeBoat(player);
  return owned?.location?.kind === "docked" && owned.location.dock === dockId ? owned : undefined;
}

/** The crew who'd sail the boat: its assigned slots, up to what it holds. */
function crewOf(player, owned) {
  return common.state(player).slots.slice(0, assign.crewCapacity(owned)).filter(Boolean)
    .map((id) => common.byId(id)).filter(Boolean);
}

/** Up to `count` crates shared out in slot order, each crewmate as many as they can carry. */
function shareOut(crews, count) {
  const parts = [];
  let left = count;
  for (const crew of crews) {
    if (left <= 0) break;
    const amount = Math.min(left, capacityOf(crew));
    parts.push({ crew, amount });
    left -= amount;
  }
  return parts;
}

function capacityOfAll(crews) {
  return crews.reduce((total, crew) => total + capacityOf(crew), 0);
}

function smoke(player, location) {
  const { Graphic } = common.core();
  player.getPacketSender().sendGraphic(new Graphic(SMOKE, 0, SMOKE_HEIGHT), location);
}

/**
 * Tiles the player could walk to within a couple of steps, by the same collision as movement: a
 * crewmate appears on the dock, never in the water or behind a wall.
 */
function reachableTiles(player) {
  const { RegionManager } = common.core();
  const here = player.getLocation();
  const z = here.getZ();
  const area = player.getPrivateArea?.() ?? null;
  const key = (x, y) => `${x},${y}`;
  const seen = new Map([[key(here.getX(), here.getY()), [here.getX(), here.getY()]]]);
  let frontier = [[here.getX(), here.getY()]];
  for (let step = 0; step < APPEAR_STEPS; step++) {
    const next = [];
    for (const [x, y] of frontier) {
      for (const [dx, dy] of STEPS) {
        const to = [x + dx, y + dy];
        if (seen.has(key(...to)) || !RegionManager.canMove(x, y, to[0], to[1], z, 1, 1, area)) continue;
        seen.set(key(...to), to);
        next.push(to);
      }
    }
    frontier = next;
  }
  seen.delete(key(here.getX(), here.getY()));
  return seen;
}

/** Where the n-th carrier appears: the recorded spots first, else any tile in reach, else with the player. */
function appearAt(player, reachable, taken, i) {
  const here = player.getLocation();
  const free = (x, y) => reachable.has(`${x},${y}`) && !taken.has(`${x},${y}`);
  const offsets = [...OFFSETS.slice(i), ...OFFSETS.slice(0, i)];
  const spot = offsets.map(([dx, dy]) => [here.getX() + dx, here.getY() + dy]).find(([x, y]) => free(x, y))
    ?? [...reachable.values()].find(([x, y]) => free(x, y))
    ?? [here.getX(), here.getY()];
  taken.add(`${spot[0]},${spot[1]}`);
  return spot;
}

/** Each carrying crewmate appears beside the player; the first follows them, the rest the one before (rsprox). */
function spawnCarriers(player, parts) {
  const { Location } = common.core();
  const here = player.getLocation();
  const reachable = reachableTiles(player);
  const taken = new Set();
  const npcs = [];
  parts.forEach(({ crew, amount }, i) => {
    const form = crew.cargoNpcs[Math.min(amount, crew.cargoNpcs.length) - 1];
    if (form === undefined) return;
    const [x, y] = appearAt(player, reachable, taken, i);
    const at = new Location(x, y, here.getZ());
    const npc = pluginApi.spawnNpc({ id: form, x: at.getX(), y: at.getY(), z: at.getZ(), owner: player });
    if (!npc) return;
    smoke(player, at);
    npc.setFlag?.(common.core().NPC.WALK_THROUGH_ENTITIES_FLAG, true);
    npc.setMovementSteps(2);
    npc.setFollowing(npcs.at(-1) ?? player);
    npcs.push(npc);
  });
  // The dock crewmate is among them.
  player.getPacketSender().sendVarbit(common.VARBIT.ON_DOCK, 0);
  return npcs;
}

function despawn(player, job, { smokeAt, send = true } = {}) {
  for (const npc of job.npcs) {
    if (smokeAt) smoke(player, npc.getLocation());
    pluginApi.removeNpc(npc);
  }
  job.npcs = [];
  carrying.delete(player);
  if (send) common.sendVarbits(player);
}

/** The crew put their crates down and go: the task was cancelled, or the player left. */
function drop(player, { send = true } = {}) {
  const job = carrying.get(player);
  if (!job) return;
  portTasks.setCrewCargo(player, job.index, null);
  despawn(player, job, { send });
}

/** Crew that wandered off with the player gone: the crates go back where they came from. */
function watch(player, job) {
  const { Task, TaskManager, Sailing } = common.core();
  TaskManager.submit(new (class extends Task {
    constructor() { super(1, player, false); }
    execute() {
      if (carrying.get(player) !== job) return this.stop();
      if (Sailing.instanceAboard(player)) return;
      const dock = portTasks.dockAt(player.getLocation().getX(), player.getLocation().getY(), PORT_RANGE);
      if (player.isRegistered?.() !== false && dock?.id === job.dockId) return;
      portTasks.setCrewCargo(player, job.index, null);
      despawn(player, job);
      this.stop();
    }
  })());
}

function start(player, kind, index, dockId, parts, entry) {
  const amount = parts.reduce((total, part) => total + part.amount, 0);
  portTasks.setCrewCargo(player, index, { ...entry, amount });
  player.sendMessage(COME);
  // The task they carry for: a slot freed and taken by another task isn't theirs.
  const taskId = portTasks.slots(player)[index]?.id;
  const job = { index, kind, dockId, taskId, npcs: spawnCarriers(player, parts) };
  carrying.set(player, job);
  watch(player, job);
  return amount;
}

/** The ledger's Take-cargo: the crew take what's left to collect, as far as they can carry. */
function cargoTaken(event) {
  const { player, index, task, dock, left } = event;
  if (carrying.has(player) || left <= 0 || !dock) return;
  const owned = boatDockedAt(player, dock.id);
  const crews = owned ? crewOf(player, owned) : [];
  if (!crews.length) return;
  const parts = shareOut(crews, Math.min(left, capacityOfAll(crews)));
  event.helped = start(player, "pickup", index, dock.id, parts, { crate: task.crate });
}

/** Boarding (a tick in, with the deck): the crew pack their crates into the hold. */
function boarded({ player, owned }) {
  const job = carrying.get(player);
  if (!job || job.kind !== "pickup" || !owned) return;
  const entry = portTasks.crewCargo(player)[job.index];
  const held = portTasks.slots(player);
  if (held[job.index]?.id !== job.taskId) return drop(player);
  const stored = entry ? cargo.store(owned, entry.crate, entry.amount) : 0;
  if (stored > 0) {
    held[job.index] = { ...held[job.index], taken: held[job.index].taken + stored };
    portTasks.setSlots(player, held);
    player.sendMessage(PACKED);
  }
  portTasks.setCrewCargo(player, job.index, null);
  despawn(player, job, { smokeAt: true });
}

/** Off the boat with a crate for this port in hand: the crew carry the rest out of the hold. */
function disembarked(player) {
  const crate = portTasks.heldCrate(player);
  if (crate === undefined || carrying.has(player)) return;
  const here = player.getLocation();
  const dock = portTasks.dockAt(here.getX(), here.getY());
  const owned = dock && boatDockedAt(player, dock.id);
  if (!owned) return;
  const held = portTasks.slots(player);
  const index = held.findIndex((slot) => {
    const task = slot && portTasks.taskById(slot.id);
    return task?.crate === crate && task.destination === dock.id;
  });
  if (index < 0) return;
  const crews = crewOf(player, owned);
  // The player's own crate is one of those still to deliver.
  const toDeliver = held[index].taken - held[index].delivered - 1;
  const count = Math.min(capacityOfAll(crews), cargo.countIn(owned, crate), toDeliver);
  if (count <= 0) return;
  start(player, "delivery", index, dock.id, shareOut(crews, count),
    { crate, owned, boatSlot: owned.slot, holdInventory: cargo.inventoryIdOf(owned) });
}

/** The ledger took the crew's crates: out of the hold they came from, and the crew go. */
function crewDelivered({ player, crate, amount, owned }) {
  const job = carrying.get(player);
  if (owned) cargo.take(owned, 0, crate, amount);
  if (job) despawn(player, job);
}

function attach(api) {
  pluginApi = api;
  common.init(api);
  portTasks.init(api);
  api.onCustomEvent("port-tasks:cargo-taken", cargoTaken);
  api.onCustomEvent("port-tasks:crew-delivered", crewDelivered);
  api.onCustomEvent("port-tasks:cancelled", ({ player, index }) => {
    if (carrying.get(player)?.index === index) drop(player);
  });
  // Before the player's tasks are cancelled (Player.onLogout), which would leave the watcher idle.
  api.onPlayerLogout(({ player }) => drop(player, { send: false }));
  api.onCustomEvent("sailing:boarded", ({ player, boat, owned }) => {
    const { CountdownTask, TaskManager, Sailing } = common.core();
    if (!owned || Sailing.instanceAboard(player) !== boat) return;
    TaskManager.submit(new CountdownTask(player, 1, () => boarded({ player, owned })));
  });
  api.onCustomEvent("sailing:left", ({ player, reason }) => {
    if (reason !== "disembark") return;
    const { CountdownTask, TaskManager } = common.core();
    TaskManager.submit(new CountdownTask(player, 1, () => disembarked(player)));
  });
}

module.exports = attach;
module.exports.capacityOf = capacityOf;
module.exports.shareOut = shareOut;
