/**
 * Forestry: what the units share - the plugin api, the data from plugins/minigames/data/forestry.json,
 * tick timing, placed locs, nearby players, and the bark and XP rewards.
 */
const fs = require("fs");
const path = require("path");

let api = null;
let core = null;
let data = null;
/** Ticks since the plugin started (its own clock, for action delays). */
let clock = 0;
const busyUntil = new WeakMap();

/** Set once by the plugin before any unit attaches. */
function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "forestry.json"), "utf8"));
  every(() => {
    clock++;
  });
}

/** Whether the player is still busy with their last event action; if not, they now are for `ticks`. */
function busy(player, ticks) {
  if ((busyUntil.get(player) ?? 0) > clock) return true;
  busyUntil.set(player, clock + ticks);
  return false;
}

/** Runs `action` `ticks` ticks from now (at least one). */
function later(ticks, action) {
  const { Task, TaskManager } = core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(Math.max(1, ticks), null, false);
    }
    execute() {
      this.stop();
      action();
    }
  })());
}

/** Runs `action(tick)` every tick until it returns false. */
function every(action) {
  const { Task, TaskManager } = core;
  let tick = 0;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(1, null, false);
    }
    execute() {
      if (action(++tick) === false) this.stop();
    }
  })());
}

const randomInt = (low, high) => low + Math.floor(Math.random() * (high - low + 1));
const pick = (list) => list[Math.floor(Math.random() * list.length)];

function message(name, values = {}) {
  return String(data.messages[name]).replace(/\{(\w+)\}/g, (_, field) => String(values[field] ?? ""));
}

/** A filterable line, as live sends the per-action lines. */
function spam(player, text) {
  player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, text);
}

function sound(player, id, delay = 0) {
  player.getPacketSender().sendSoundEffect(id, 1, delay, 1);
}

/** A message box (live "mesbox"). */
function messageBox(player, text) {
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(new core.StatementDialogue(0, text)));
}

/** An item box (live "objectbox"). */
function objectBox(player, itemId, text) {
  player.getDialogueManager().startDialogues(new core.DialogueChainBuilder().add(new core.ItemStatementDialogue(0, itemId, text)));
}

function level(player, skill) {
  return player.getSkillManager().getCurrentLevel(core.Skill[skill]);
}

function xp(player, skill, amount) {
  if (amount > 0) player.getSkillManager().addExperience(core.Skill[skill], amount);
}

/**
 * Into a carried or worn Forestry kit first ("storage:gather": rsprox 1104 has event bark go
 * straight into the worn kit), then the pack, then the floor.
 */
function award(player, id, amount) {
  const gather = { player, itemId: id, amount, stored: 0 };
  api.emitCustomEvent("storage:gather", gather);
  if (amount - gather.stored > 0) give(player, id, amount - gather.stored);
}

/** Bark into the kit or the pack (on the floor when there's no room), with the award line. */
function bark(player, amount, lump = false) {
  if (amount <= 0) return;
  award(player, data.items.bark, amount);
  const text = message("bark", { amount });
  if (lump) player.sendMessage(text);
  else spam(player, text);
}

function give(player, id, amount) {
  const item = new core.Item(id, amount);
  if (player.getInventory().getAddableAmount(item) >= amount) player.getInventory().add(item, true);
  else core.ItemOnGroundManager.registers(player, item);
}

function hasKit(player) {
  return player.getInventory().contains(data.items.kit) || player.getEquipment().contains(data.items.kit);
}

function distance(a, b) {
  return Math.max(Math.abs(a.getX() - b.getX()), Math.abs(a.getY() - b.getY()));
}

function nearbyPlayers(location, range) {
  const players = [];
  for (const player of core.World.getPlayers()) {
    if (!player?.isRegistered?.()) continue;
    const at = player.getLocation();
    if (at.getZ() === location.getZ() && distance(at, location) <= range) players.push(player);
  }
  return players;
}

function areaSound(location, id, radius = 10, delay = 0) {
  for (const player of nearbyPlayers(location, 15)) {
    player.getPacketSender().sendAreaSound(id, location.getX(), location.getY(), location.getZ(), 1, delay, radius);
  }
}

function tileGraphic(location, id) {
  for (const player of nearbyPlayers(location, 15)) player.getPacketSender().sendGraphic(new core.Graphic(id), location);
}

function locAnim(object, seq) {
  for (const player of nearbyPlayers(object.getLocation(), 15)) {
    player.getPacketSender().sendObjectAnimation(object, new core.Animation(seq));
  }
}

/** A loc of ours on the map (shape 10, as recorded). */
function placeLoc(id, location, face = 0) {
  const object = new core.GameObject(id, location.clone(), 10, face, null);
  core.ObjectManager.register(object, true);
  return object;
}

function removeLoc(object) {
  if (object) core.ObjectManager.deregister(object, true);
}

/** Whether (x, y, z) is free for a loc of ours: walkable, with no map scenery there to hide. */
function walkable(x, y, z) {
  const tile = new core.Location(x, y, z);
  return !core.RegionManager.blocked(tile, null) && !core.MapObjects.getType(tile, 10, null);
}

/** An event's npc: no respawn, no wandering. */
/** An event npc; it stands still unless `wander` gives it a roaming radius. */
function spawnNpc(id, location, graphic = -1, wander = 0) {
  const { NPC, World } = core;
  const npc = NPC.create(id, location.clone());
  npc.__skipDefaultRespawn = true;
  npc.getMovementCoordinator?.().setRadius?.(wander);
  World.getAddNPCQueue().push(npc);
  if (graphic >= 0) npc.performGraphic?.(new core.Graphic(graphic));
  return npc;
}

function removeNpc(npc) {
  if (npc) core.World.getRemoveNPCQueue().push(npc);
}

function animate(entity, seq, delay = 0) {
  entity.performAnimation(new core.Animation(seq, delay));
}

/**
 * How far from the tree a walk to an event's tile is followed. Event tiles are at most 12 tiles
 * out (a rainbow 9 from a leprechaun 3 from the tree); the rest leaves room for a path round a
 * pond or fence.
 */
const REACH_RADIUS = 24;
/** One route finder for the reach checks (its search buffers are reused). */
let routes = null;
const STEPS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

/**
 * The tiles ("x,y") a player can walk to from the tree an event came from: a flood over the
 * game's own step clipping (RegionManager.canMove) from the tiles the tree is chopped from,
 * kept to the tree's plane and REACH_RADIUS. Water, a rock out in a river or a fenced-off yard
 * walkable() lets through are not in it (#3872). When a chopper stands beside the tree, the
 * flood starts from where they stand, so a pocket on the tree's far side isn't counted.
 */
function reachableTiles(site) {
  const { Location, RegionManager } = core;
  const [x0, y0, z] = [site.location.getX(), site.location.getY(), site.location.getZ()];
  const size = Math.max(1, site.size ?? 1);
  routes ??= new core.RsmodRouteFinding();
  const inBounds = (x, y) => x >= x0 - REACH_RADIUS && x < x0 + size + REACH_RADIUS && y >= y0 - REACH_RADIUS && y < y0 + size + REACH_RADIUS;
  // Where the tree can be chopped from: the walkable tiles beside it with no wall between.
  const beside = [];
  for (let x = x0 - 1; x <= x0 + size; x++) {
    for (let y = y0 - 1; y <= y0 + size; y++) {
      if (x >= x0 && x < x0 + size && y >= y0 && y < y0 + size) continue;
      if (RegionManager.blocked(new Location(x, y, z), null)) continue;
      const besideTree = routes.reachedAbsolute({
        level: z, srcX: x, srcY: y, srcSize: 1, destX: x0, destY: y0, destWidth: size, destLength: size,
        locAngle: site.tree?.getFace?.() ?? 0, locShape: 10, privateArea: null,
      });
      if (besideTree) beside.push([x, y]);
    }
  }
  const standing = beside.filter(([x, y]) => [...(site.participants ?? [])].some((player) => {
    const at = player.getLocation?.();
    return at && at.getZ() === z && at.getX() === x && at.getY() === y;
  }));
  const queue = standing.length ? standing : beside;
  const seen = new Set(queue.map(([x, y]) => `${x},${y}`));
  for (let head = 0; head < queue.length; head++) {
    const [x, y] = queue[head];
    for (const [dx, dy] of STEPS) {
      const [nx, ny] = [x + dx, y + dy];
      const key = `${nx},${ny}`;
      if (seen.has(key) || !inBounds(nx, ny) || !RegionManager.canMove(x, y, nx, ny, z, 1, 1, null)) continue;
      seen.add(key);
      queue.push([nx, ny]);
    }
  }
  return seen;
}

/**
 * Free tiles within `range` of `location` (outside a `size` footprint there) that a player can
 * walk to from `site`'s tree, shuffled.
 */
function freeTiles(site, location, range, size = 1) {
  const [x0, y0, z] = [location.getX(), location.getY(), location.getZ()];
  if (z !== site.location.getZ()) return [];
  const reach = reachableTiles(site);
  const tiles = [];
  for (let x = x0 - range; x < x0 + size + range; x++) {
    for (let y = y0 - range; y < y0 + size + range; y++) {
      const inside = x >= x0 && x < x0 + size && y >= y0 && y < y0 + size;
      if (!inside && reach.has(`${x},${y}`) && walkable(x, y, z)) tiles.push(new core.Location(x, y, z));
    }
  }
  for (let i = tiles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }
  return tiles;
}

/**
 * A chatbox conversation: lines of ["npc", text] / ["player", text], with `npcId`'s head, then
 * `onEnd` once the last is continued.
 */
function chat(player, npcId, lines, onEnd = null) {
  const { ActionDialogue, DialogueChainBuilder, EndDialogue, NpcDialogue, PlayerDialogue } = core;
  const builder = new DialogueChainBuilder();
  let index = 0;
  // A line is [who, text] or [who, text, chathead seq id] (live chatheads such as chatquiz1, from forestry.json).
  for (const [who, text, face] of lines) {
    builder.add(who === "npc"
      ? (face === undefined ? new NpcDialogue(index++, npcId, text) : new NpcDialogue(index++, npcId, text, undefined, face))
      : (face === undefined ? new PlayerDialogue(index++, text) : new PlayerDialogue(index++, text, face)));
  }
  builder.add(onEnd ? new ActionDialogue(index, { execute: onEnd }) : new EndDialogue(index));
  player.getDialogueManager().startDialogues(builder);
}

/** A two-option chatbox menu. */
function menu(player, first, second) {
  api.sendMultiChatboxPrompt(player, "Select an option", first[0], first[1], second[0], second[1]);
}

const ORDINALS = ["first", "second", "third"];

module.exports = {
  init,
  get api() {
    return api;
  },
  get core() {
    return core;
  },
  get data() {
    return data;
  },
  later,
  every,
  busy,
  randomInt,
  pick,
  message,
  spam,
  sound,
  messageBox,
  objectBox,
  level,
  xp,
  bark,
  give,
  award,
  hasKit,
  distance,
  nearbyPlayers,
  areaSound,
  tileGraphic,
  locAnim,
  placeLoc,
  removeLoc,
  walkable,
  spawnNpc,
  removeNpc,
  animate,
  freeTiles,
  reachableTiles,
  chat,
  menu,
  ORDINALS,
};
