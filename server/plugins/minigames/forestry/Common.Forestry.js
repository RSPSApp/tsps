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

/** Free tiles within `range` of `location` (outside a `size` footprint there), shuffled. */
function freeTiles(location, range, size = 1) {
  const [x0, y0, z] = [location.getX(), location.getY(), location.getZ()];
  const tiles = [];
  for (let x = x0 - range; x < x0 + size + range; x++) {
    for (let y = y0 - range; y < y0 + size + range; y++) {
      const inside = x >= x0 && x < x0 + size && y >= y0 && y < y0 + size;
      if (!inside && walkable(x, y, z)) tiles.push(new core.Location(x, y, z));
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
  chat,
  menu,
  ORDINALS,
};
