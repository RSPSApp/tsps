const { NPC } = require("../../src/main/typescript/elvarg/game/entity/impl/npc/NPC");
const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");
const { Boundary } = require("../../src/main/typescript/elvarg/game/model/Boundary");
const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { ObjectIdentifiers: Objects } = require("../../src/main/typescript/elvarg/util/ObjectIdentifiers");
const { NpcIdentifiers: Npcs } = require("../../src/main/typescript/elvarg/util/NpcIdentifiers");
const { ItemIdentifiers: Items } = require("../../src/main/typescript/elvarg/util/ItemIdentifiers");
const { TimerKey } = require("../../src/main/typescript/elvarg/util/timers/TimerKey");

const { CacheDefinitions } = require("../../src/main/typescript/elvarg/game/cache/CacheDefinitions");
const { GameObject } = require("../../src/main/typescript/elvarg/game/entity/impl/object/GameObject");
const { Skill } = require("../../src/main/typescript/elvarg/game/model/Skill");
const { Equipment } = require("../../src/main/typescript/elvarg/game/model/container/impl/Equipment");
const { HitDamage } = require("../../src/main/typescript/elvarg/game/content/combat/hit/HitDamage");
const { HitMask } = require("../../src/main/typescript/elvarg/game/content/combat/hit/HitMask");
const { ForceMovement } = require("../../src/main/typescript/elvarg/game/model/ForceMovement");
const { ForceMovementTask } = require("../../src/main/typescript/elvarg/game/task/impl/ForceMovementTask");
const { MagicCombatMethod } = require("../../src/main/typescript/elvarg/game/content/combat/method/impl/MagicCombatMethod");
const { CombatSpells } = require("../../src/main/typescript/elvarg/game/content/combat/magic/CombatSpells");
const { MOBILE_CLIENT_ATTRIBUTE } = require("../../src/main/typescript/elvarg/net/protocol/ClientProtocol");
const { decodeRegionObjects, initRegionBuildingAnalysisCoreAccess } = require("../world/RegionBuildingAnalysisUtil");

const REGION_ID = 14231;
const ATTRIBUTE = "barrows";
const DIG_ANIMATION = new Animation(830);
const OVERLAY_ID = 24;
const OVERLAY_HUD_UID = (161 << 16) | 8;
const WELCOME_PLAY_BUTTON_UID = (378 << 16) | 72;
const REWARDS_ID = 155;
const REWARDS_INVENTORY = 141;
const PUZZLE_ID = 25;
const PUZZLE_BUTTONS = [12, 14, 16];
const PUZZLE_SEQUENCE_MODELS = [3, 5, 7];
const PUZZLE_OPTION_MODELS = [13, 15, 17];
const GAMEFRAME_OVERLAY_UID = (161 << 16) | 92;
const CLOSE_INTERFACE_ATTRIBUTE = "interface:close-on-interface-close";
const POTENTIAL_VARBIT = 463;
const KILL_COUNT_VARBIT = 464;
const CHEST_OPEN_VARBIT = 1394;
const LADDER_VISIBLE_VARBIT = 4743;
const PRAYER_DRAIN_TICKS = 30;
const CORNERS = [0, 2, 6, 8];
// Room numbers run NW to SE through a 3x3 grid. The outside corridors wrap around the corners.
const DOOR_LINKS = [
  [469, 0, 2], [470, 0, 6], [471, 0, 3], [472, 0, 1],
  [473, 1, 4], [474, 1, 2], [475, 2, 5], [476, 2, 8],
  [477, 3, 4], [478, 4, 5], [479, 3, 6], [480, 4, 7],
  [481, 5, 8], [482, 6, 7], [483, 7, 8], [484, 6, 8],
];
const HILTS = new Set([Items.GHOMMALS_HILT_2, Items.GHOMMALS_HILT_3, Items.GHOMMALS_HILT_4, Items.GHOMMALS_HILT_5, Items.GHOMMALS_HILT_6]);
// These model sequences and options are present in the current cache's model archive.
const PUZZLES = [
  { sequence: [6716, 6717, 6718], options: [6713, 6714, 6715] },
  { sequence: [6722, 6723, 6724], options: [6719, 6720, 6721] },
  { sequence: [6728, 6729, 6730], options: [6725, 6726, 6727] },
  { sequence: [6734, 6735, 6736], options: [6731, 6732, 6733] },
];

const BROTHERS = [
  {
    npcId: Npcs.AHRIM_THE_BLIGHTED, coffin: Objects.SARCOPHAGUS_11, stairs: Objects.STAIRCASE_120,
    mound: new Boundary(3562, 3568, 3285, 3292, 0), surface: new Location(3565, 3288),
    crypt: new Location(3557, 9703, 3), spawn: new Location(3557, 9701, 3), killedVarbit: 457,
  },
  {
    npcId: Npcs.DHAROK_THE_WRETCHED, coffin: Objects.SARCOPHAGUS_8, stairs: Objects.STAIRCASE_121,
    mound: new Boundary(3572, 3578, 3294, 3301, 0), surface: new Location(3574, 3297),
    crypt: new Location(3556, 9718, 3), spawn: new Location(3553, 9716, 3), killedVarbit: 458,
  },
  {
    npcId: Npcs.GUTHAN_THE_INFESTED, coffin: Objects.SARCOPHAGUS_10, stairs: Objects.STAIRCASE_122,
    mound: new Boundary(3574, 3584, 3279, 3285, 0), surface: new Location(3577, 3282),
    crypt: new Location(3534, 9704, 3), spawn: new Location(3540, 9705, 3), killedVarbit: 459,
  },
  {
    npcId: Npcs.KARIL_THE_TAINTED, coffin: Objects.SARCOPHAGUS_12, stairs: Objects.STAIRCASE_123,
    mound: new Boundary(3564, 3568, 3273, 3278, 0), surface: new Location(3566, 3275),
    crypt: new Location(3546, 9684, 3), spawn: new Location(3549, 9685, 3), killedVarbit: 460,
  },
  {
    npcId: Npcs.TORAG_THE_CORRUPTED, coffin: Objects.SARCOPHAGUS_9, stairs: Objects.STAIRCASE_124,
    mound: new Boundary(3550, 3556, 3280, 3284, 0), surface: new Location(3554, 3282),
    crypt: new Location(3568, 9683, 3), spawn: new Location(3568, 9688, 3), killedVarbit: 461,
  },
  {
    npcId: Npcs.VERAC_THE_DEFILED, coffin: Objects.SARCOPHAGUS_13, stairs: Objects.STAIRCASE_125,
    mound: new Boundary(3553, 3560, 3294, 3301, 0), surface: new Location(3557, 3297),
    crypt: new Location(3578, 9706, 3), spawn: new Location(3575, 9708, 3), killedVarbit: 462,
  },
];
const BOUNDS = [
  new Boundary(3545, 3584, 3265, 3306, 0),
  new Boundary(3520, 3583, 9664, 9727, 0),
  new Boundary(3521, 3582, 9662, 9724, 3),
];
const EQUIPMENT = [
  Items.AHRIMS_HOOD, Items.AHRIMS_STAFF, Items.AHRIMS_ROBETOP, Items.AHRIMS_ROBESKIRT,
  Items.DHAROKS_HELM, Items.DHAROKS_GREATAXE, Items.DHAROKS_PLATEBODY, Items.DHAROKS_PLATELEGS,
  Items.GUTHANS_HELM, Items.GUTHANS_WARSPEAR, Items.GUTHANS_PLATEBODY, Items.GUTHANS_CHAINSKIRT,
  Items.KARILS_COIF, Items.KARILS_CROSSBOW, Items.KARILS_LEATHERTOP, Items.KARILS_LEATHERSKIRT,
  Items.TORAGS_HELM, Items.TORAGS_HAMMERS, Items.TORAGS_PLATEBODY, Items.TORAGS_PLATELEGS,
  Items.VERACS_HELM, Items.VERACS_FLAIL, Items.VERACS_BRASSARD, Items.VERACS_PLATESKIRT,
];
const CREATURES = new Set([Npcs.BLOODWORM, Npcs.CRYPT_RAT, Npcs.GIANT_CRYPT_RAT, Npcs.GIANT_CRYPT_RAT_2, Npcs.GIANT_CRYPT_RAT_3, Npcs.CRYPT_SPIDER, Npcs.GIANT_CRYPT_SPIDER,
  Npcs.SKELETON_17, Npcs.SKELETON_18, Npcs.SKELETON_19, Npcs.SKELETON_20]);
const sessions = new WeakMap();
let World;
let RegionManager;
let TaskManager;
let pluginApi;
let tunnelMap;

function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function shuffled(values) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(0, i);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function roomLocation(room) {
  return new Location(3534 + room % 3 * 17, 9712 - Math.floor(room / 3) * 17);
}

function roomAt(location) {
  if (location.getZ() !== 0) return -1;
  for (let room = 0; room < 9; room++) {
    if (location.getDistance(roomLocation(room)) <= 7) return room;
  }
  return -1;
}

function inBarrows(player) {
  return BOUNDS.some((boundary) => boundary.inside(player.getLocation()));
}

function inTunnels(player) {
  return BOUNDS[1].inside(player.getLocation());
}

function session(player) {
  let value = sessions.get(player);
  if (!value) {
    value = { npcs: new Set(), brother: null, phase: "outside", puzzle: null, dig: null, crossing: null };
    sessions.set(player, value);
  }
  return value;
}

function randomiseLayout(run) {
  // Connect all eight outside rooms, then choose exactly one entrance to the chest room.
  const connected = new Set([0]);
  const openDoors = [];
  const outer = DOOR_LINKS.filter(([, a, b]) => a !== 4 && b !== 4);
  while (connected.size < 8) {
    const candidates = outer.filter(([, a, b]) => connected.has(a) !== connected.has(b));
    const [varbit, a, b] = candidates[randomInt(0, candidates.length - 1)];
    openDoors.push(varbit);
    connected.add(a);
    connected.add(b);
  }
  const inner = DOOR_LINKS.filter(([, a, b]) => a === 4 || b === 4);
  run.puzzleDoor = inner[randomInt(0, inner.length - 1)][0];
  run.openDoors = [...openDoors, run.puzzleDoor];
  run.exitRoom = CORNERS[randomInt(0, CORNERS.length - 1)];
  run.puzzleSolved = false;
}

function freshRun(chests = 0) {
  const run = { tunnel: randomInt(0, 5), killed: [], points: 0, kills: 0, chests,
    chestOpen: false, looted: false, prayerTicks: PRAYER_DRAIN_TICKS };
  randomiseLayout(run);
  return run;
}

function getRun(player) {
  let run = player.getAttribute(ATTRIBUTE);
  if (!run) {
    run = freshRun();
    player.setAttribute(ATTRIBUTE, run);
  }
  return run;
}

function getTunnelMap() {
  if (tunnelMap) return tunnelMap;
  const objects = decodeRegionObjects(REGION_ID).filter((object) => object.z === 0);
  const doors = [];
  const ladders = [];
  let chest;
  for (const object of objects) {
    const definition = CacheDefinitions.getObject(object.id);
    const varbit = definition.transformVarbit;
    if (DOOR_LINKS.some(([id]) => id === varbit)) doors.push({ ...object, varbit });
    if (varbit === LADDER_VISIBLE_VARBIT) ladders.push(object);
    if (varbit === CHEST_OPEN_VARBIT) chest = object;
  }
  if (!chest || ladders.length !== 4 || doors.length !== 64) throw new Error("Barrows: region 14231 is missing its chest, ladders, or doors");
  return tunnelMap = { doors, ladders, chest };
}

function asObject(object) {
  return new GameObject(object.id, new Location(object.x, object.y, object.z), object.type, object.orientation, null);
}

function updateOverlay(player, run) {
  const sender = player.getPacketSender();
  for (let i = 0; i < BROTHERS.length; i++) sender.sendVarbit(BROTHERS[i].killedVarbit, run.killed.includes(i) ? 1 : 0);
  sender.sendVarbit(POTENTIAL_VARBIT, run.points);
  sender.sendVarbit(KILL_COUNT_VARBIT, run.kills);
}

function showOverlay(player) {
  player.getPacketSender().sendSubInterface(OVERLAY_HUD_UID, OVERLAY_ID, 1);
  updateOverlay(player, getRun(player));
}

function restoreOverlayAfterWelcome({ player }) {
  // WelcomeScreen replaces the gameframe during this click; mount after all its handlers finish.
  queueMicrotask(() => {
    if (inBarrows(player)) showOverlay(player);
  });
  return false;
}

function syncTunnels(player, run) {
  const sender = player.getPacketSender();
  for (const [id] of DOOR_LINKS) sender.sendVarbit(id, run.openDoors.includes(id) ? 0 : 1);
  sender.sendVarbit(CHEST_OPEN_VARBIT, run.chestOpen ? 1 : 0);
  sender.sendVarbit(LADDER_VISIBLE_VARBIT, 1);
  for (const ladder of getTunnelMap().ladders) {
    if (roomAt(new Location(ladder.x, ladder.y)) === run.exitRoom) sender.sendObject(asObject(ladder));
    else sender.sendObjectRemoval(asObject(ladder));
  }
}

function removeNpc(player, npc) {
  const state = session(player);
  state.npcs.delete(npc);
  if (state.brother === npc) {
    state.brother = null;
    player.getPacketSender().sendEntityHintRemoval(false);
  }
  npc.getCombat().reset();
  npc.__skipDefaultRespawn = true;
  const pending = World.getAddNPCQueue();
  const index = pending.indexOf(npc);
  if (index !== -1) pending.splice(index, 1);
  if (npc.isRegistered() && !World.getRemoveNPCQueue().includes(npc)) World.getRemoveNPCQueue().push(npc);
}

function cleanupNpcs(player, keepDying = false) {
  for (const npc of [...session(player).npcs]) {
    if (!keepDying || !npc.isDyingFunction()) removeNpc(player, npc);
  }
}

function onNpcAdded() {
  NPC.prototype.onAdd.call(this);
  const player = this.getOwner();
  if (session(player).brother === this) {
    this.forceChat("You dare disturb my rest!");
    this.getTimers().extendOrRegister(TimerKey.COMBAT_ATTACK, 3);
    player.getPacketSender().sendEntityHint(this);
  }
  this.getCombat().attack(player);
}

function spawnNpc(player, npcId, location, brother = false) {
  const npc = new NPC(npcId, location.clone());
  npc.setOwner(player);
  npc.__skipDefaultRespawn = true;
  npc.onAdd = onNpcAdded;
  const state = session(player);
  state.npcs.add(npc);
  if (brother) state.brother = npc;
  World.getAddNPCQueue().push(npc);
  return npc;
}

function dig({ player }) {
  const state = session(player);
  if (state.dig || player.getForceMovement()) return true;
  player.performAnimation(DIG_ANIMATION);
  const brother = BROTHERS.find((entry) => entry.mound.inside(player.getLocation()));
  if (!brother) {
    player.sendMessage("You dig into the ground, but find nothing.");
    return true;
  }
  // Keep the animation on the mound for two ticks before changing planes.
  state.dig = { from: player.getLocation().clone(), to: brother.crypt, ticks: 2 };
  return true;
}

function enterTunnel(player, run, brother) {
  if (getRun(player) !== run || player.getLocation().getZ() !== 3 ||
      player.getLocation().getDistance(brother.crypt) > 10) return;
  cleanupNpcs(player, true);
  player.getPacketSender().sendInterfaceRemoval();
  const ladder = getTunnelMap().ladders.find((object) => roomAt(new Location(object.x, object.y)) === run.exitRoom);
  player.moveTo(new Location(ladder.x, ladder.y - 1));
  syncTunnels(player, run);
}

function searchCrypt(player, index) {
  const run = getRun(player);
  const state = session(player);
  const brother = BROTHERS[index];
  if (index === run.tunnel) {
    pluginApi.sendMultiChatboxPrompt(player, "You've found a hidden tunnel. Enter?",
      "Enter", () => enterTunnel(player, run, brother), "Cancel", () => player.getPacketSender().sendInterfaceRemoval());
  } else if (state.brother || run.killed.includes(index)) {
    player.sendMessage("The sarcophagus appears to be empty.");
  } else {
    spawnNpc(player, brother.npcId, brother.spawn, true);
  }
}

function doorAt(object) {
  const location = object.getLocation();
  return getTunnelMap().doors.find((entry) => entry.x === location.getX() && entry.y === location.getY() &&
    entry.z === location.getZ() && (entry.id === object.getId() ||
      [Objects.DOOR_415, Objects.DOOR_416, Objects.DOOR_418, Objects.DOOR_419].includes(object.getId())));
}

function doorSides(door) {
  const { x, y, orientation } = door;
  if (orientation === 0) return [new Location(x - 1, y), new Location(x, y)];
  if (orientation === 2) return [new Location(x, y), new Location(x + 1, y)];
  if (orientation === 1) return [new Location(x, y), new Location(x, y + 1)];
  return [new Location(x, y - 1), new Location(x, y)];
}

function routeDoor(event) {
  if (!inTunnels(event.player)) return;
  const door = doorAt(event.object);
  if (!door) return;
  const from = event.player.getLocation();
  const sides = doorSides(door).sort((a, b) => from.getDistance(a) - from.getDistance(b));
  event.destination = { x: sides[0].getX(), y: sides[0].getY(), z: 0 };
}

function consumeLockpick(player) {
  const inventory = player.getInventory();
  const item = inventory.getItems().find((entry) => entry.getId() === Items.STRANGE_OLD_LOCKPICK || entry.getId() === Items.STRANGE_OLD_LOCKPICK_FULL_);
  if (!item) return false;
  const charges = item.getId() === Items.STRANGE_OLD_LOCKPICK_FULL_ ? 50 : Number(item.getMetaValue("barrows:lockpick-charges") ?? 50);
  if (!Number.isInteger(charges) || charges < 1 || charges > 50) return false;
  if (charges === 1) {
    inventory.deleteItem(item, inventory.getItems().indexOf(item));
    player.sendMessage("Your strange old lockpick crumbles to dust.");
  } else {
    item.setId(Items.STRANGE_OLD_LOCKPICK);
    item.setMetaValue("barrows:lockpick-charges", charges - 1);
    inventory.refreshItems();
  }
  return true;
}

function inspectLockpick({ player, item }) {
  const charges = item.getId() === Items.STRANGE_OLD_LOCKPICK_FULL_ ? 50 : item.getMetaValue("barrows:lockpick-charges") ?? 50;
  player.sendMessage(`Your strange old lockpick has ${charges} charges remaining.`);
}

function crossDoor(player, door) {
  const state = session(player);
  if (state.crossing || player.getForceMovement()) return;
  const sides = doorSides(door);
  const from = player.getLocation();
  const index = sides.findIndex((side) => side.equals(from));
  if (index === -1) return;
  const to = sides[1 - index];
  const leaves = getTunnelMap().doors.filter((entry) => entry.varbit === door.varbit &&
    Math.abs(entry.x - door.x) + Math.abs(entry.y - door.y) <= 1);
  for (const leaf of leaves) player.getPacketSender().sendObjectRemoval(asObject(leaf));
  state.crossing = { leaves, to, ticks: 3 };
  const dx = to.getX() - from.getX();
  const dy = to.getY() - from.getY();
  const direction = dy > 0 ? 0 : dx > 0 ? 1 : dy < 0 ? 2 : 3;
  TaskManager.submit(new ForceMovementTask(player, 2,
    new ForceMovement(from.clone(), new Location(dx, dy), 0, 30, direction, -1)));
}

function useDoor(player, door) {
  const state = session(player);
  if (state.crossing || player.getForceMovement()) return;
  const run = getRun(player);
  if (!doorSides(door).some((side) => side.equals(player.getLocation()))) return;
  const centre = DOOR_LINKS.find(([id]) => id === door.varbit).slice(1).includes(4);
  if (!run.openDoors.includes(door.varbit)) {
    if (!consumeLockpick(player)) {
      player.sendMessage("This door is locked.");
      return;
    }
  } else if (centre && !run.puzzleSolved && roomAt(player.getLocation()) !== 4 && !run.looted) {
    if (!consumeLockpick(player)) {
      showPuzzle(player, door);
      return;
    }
  }
  crossDoor(player, door);
}

function spawnEncounter(player, room) {
  if (room < 0) return;
  const state = session(player);
  const run = getRun(player);
  if ([...state.npcs].filter((npc) => roomAt(npc.getLocation()) === room).length >= 11) return;
  const remaining = BROTHERS.map((_, i) => i).filter((index) => !run.killed.includes(index));
  const roll = randomInt(0, 127);
  const brother = !state.brother && remaining.length && (run.looted || roll < 12)
    ? remaining[randomInt(0, remaining.length - 1)] : -1;
  if (run.looted && brother === -1) return;
  const id = brother !== -1 ? BROTHERS[brother].npcId : roll < 64 ? Npcs.SKELETON_17 : roll < 96 ? Npcs.BLOODWORM : Npcs.CRYPT_RAT;
  // Room bounds overlap the doorway/corridor. An empty tile near the room centre may be
  // behind the door, so spawn beside the arrival tile and check the actual wall clipping.
  const arrival = player.getLocation();
  const area = player.getPrivateArea();
  for (const [dx, dy] of shuffled([[0, 1], [1, 0], [0, -1], [-1, 0]])) {
    const location = new Location(arrival.getX() + dx, arrival.getY() + dy, arrival.getZ());
    if (!RegionManager.blocked(location, area) && RegionManager.canMovestart(location, arrival, 1, 1, area)) {
      spawnNpc(player, id, location, brother !== -1);
      return;
    }
  }
}

class AhrimCombat extends MagicCombatMethod {
  start(npc, target) {
    const spells = [CombatSpells.FIRE_WAVE, CombatSpells.FIRE_WAVE, CombatSpells.FIRE_WAVE,
      CombatSpells.CONFUSE, CombatSpells.WEAKEN, CombatSpells.CURSE];
    npc.getCombat().setCastSpell(spells[randomInt(0, spells.length - 1)]);
    super.start(npc, target);
  }

  hits(npc, target) {
    const hits = super.hits(npc, target);
    if (npc.getCombat().getSelectedSpell().maximumHit() < 0) {
      for (const hit of hits) hit.setTotalDamage(0);
    }
    return hits;
  }

  finished(npc) {
    npc.getCombat().setPreviousCast(npc.getCombat().getSelectedSpell());
    npc.getCombat().setCastSpell(null);
  }
}

function rollRewards(run) {
  const potential = Math.min(1000, run.points) + run.killed.length * 2;
  if (potential === 0) return [];
  const equipment = run.killed.flatMap((index) => EQUIPMENT.slice(index * 4, index * 4 + 4));
  const rewards = new Map();
  const add = (id, amount) => rewards.set(id, (rewards.get(id) ?? 0) + amount);
  for (let i = 0; i <= run.killed.length; i++) {
    if (equipment.length && randomInt(1, 450 - 58 * run.killed.length) === 1) {
      const index = randomInt(0, equipment.length - 1);
      add(equipment.splice(index, 1)[0], 1);
    } else {
      // The table uses a zero-based potential roll; quantities scale with that roll.
      const roll = randomInt(0, potential - 1);
      if (roll < 380) add(Items.COINS, Math.max(2, roll * 2 + randomInt(0, 16)));
      else if (roll < 505) add(Items.MIND_RUNE, Math.floor(roll * 2 / 3));
      else if (roll < 630) add(Items.CHAOS_RUNE, Math.floor(roll * 2 / 9));
      else if (roll < 755) add(Items.DEATH_RUNE, Math.floor(roll / 9));
      else if (roll < 880) add(Items.BLOOD_RUNE, Math.floor(roll / 20));
      else if (roll < 1005) add(Items.BOLT_RACK, Math.floor(roll / 25));
      else if (roll < 1008) add(Items.LOOP_HALF_OF_KEY, 1);
      else if (roll < 1011) add(Items.TOOTH_HALF_OF_KEY, 1);
      else add(Items.DRAGON_MED_HELM, 1);
    }
    if (!rewards.has(Items.CLUE_SCROLL_ELITE_) && randomInt(1, 200) === 1) add(Items.CLUE_SCROLL_ELITE_, 1);
  }
  return [...rewards].map(([id, amount]) => new Item(id, amount));
}

function showRewards(player, rewards) {
  player.setAttribute(CLOSE_INTERFACE_ATTRIBUTE, REWARDS_ID);
  const sender = player.getPacketSender();
  sender.sendSubInterface(GAMEFRAME_OVERLAY_UID, REWARDS_ID, 0);
  sender.sendInterfaceScript(1065, [(REWARDS_ID << 16) | 3], undefined, undefined, {
    [REWARDS_INVENTORY]: { capacity: 8, slots: rewards.map((item, slot) => ({ slot, itemId: item.getId(), quantity: item.getAmount() })) },
  });
}

function showPuzzle(player, door) {
  const puzzle = randomInt(0, PUZZLES.length - 1);
  const options = shuffled([0, 1, 2]);
  session(player).puzzle = { puzzle, options, door, from: player.getLocation().clone(), run: getRun(player) };
  player.setAttribute(CLOSE_INTERFACE_ATTRIBUTE, PUZZLE_ID);
  const sender = player.getPacketSender();
  sender.sendSubInterface(GAMEFRAME_OVERLAY_UID, PUZZLE_ID, 0);
  const definition = PUZZLES[puzzle];
  for (let slot = 0; slot < 3; slot++) {
    sender.sendInterfaceRawModel((PUZZLE_ID << 16) | PUZZLE_SEQUENCE_MODELS[slot], definition.sequence[slot]);
    sender.sendInterfaceRawModel((PUZZLE_ID << 16) | PUZZLE_OPTION_MODELS[slot], definition.options[options[slot]]);
    sender.sendInterfaceFlags((PUZZLE_ID << 16) | PUZZLE_BUTTONS[slot], 1 << 1);
  }
}

function answerPuzzle(event) {
  const { player, buttonId } = event;
  const slot = PUZZLE_BUTTONS.indexOf(buttonId & 0xffff);
  if ((buttonId >>> 16) !== PUZZLE_ID || slot < 0 || slot > 2) return;
  event.handled = true;
  const state = session(player);
  const pending = state.puzzle;
  state.puzzle = null;
  player.getPacketSender().closeInterface(PUZZLE_ID);
  if (!pending || !inTunnels(player) || !pending.from.equals(player.getLocation()) || getRun(player) !== pending.run) return;
  if (pending.options[slot] !== 0) {
    randomiseLayout(pending.run);
    syncTunnels(player, pending.run);
    player.sendMessage("Wrong! The passages shift around you.");
    return;
  }
  pending.run.puzzleSolved = true;
  crossDoor(player, pending.door);
}

function searchChest(player, clickType) {
  const run = getRun(player);
  const state = session(player);
  const sender = player.getPacketSender();
  if (run.looted) {
    sender.sendMessage("The chest is empty. Leave the tunnels to begin another run.");
    return;
  }
  if (clickType === 2) {
    run.chestOpen = false;
    sender.sendVarbit(CHEST_OPEN_VARBIT, 0);
    return;
  }
  if (!run.chestOpen) {
    run.chestOpen = true;
    sender.sendVarbit(CHEST_OPEN_VARBIT, 1);
    if (!run.killed.includes(run.tunnel) && !state.brother) {
      spawnNpc(player, BROTHERS[run.tunnel].npcId, new Location(3550, 9694), true);
    }
    return;
  }
  const rewards = rollRewards(run);
  for (const item of rewards) player.getInventory().forceAdd(player, item);
  run.chests++;
  run.looted = true;
  randomiseLayout(run);
  syncTunnels(player, run);
  showRewards(player, rewards);
  sender.sendMessage(`You've looted ${run.chests} Barrows chests. The tunnels begin to collapse!`);
}

function handleObject(event) {
  const { player, object, clickType } = event;
  if (!inBarrows(player)) return;
  const id = object.getId();
  const stairs = BROTHERS.find((brother) => brother.stairs === id);
  const crypt = BROTHERS.findIndex((brother) => brother.coffin === id);
  if (player.getLocation().getZ() === 3 && clickType === 1 && (stairs || crypt !== -1)) {
    event.handled = true;
    if (stairs) {
      cleanupNpcs(player, true);
      player.moveTo(stairs.surface.clone());
    } else searchCrypt(player, crypt);
    return;
  }
  if (!inTunnels(player)) return;
  const map = getTunnelMap();
  const location = object.getLocation();
  const ladder = map.ladders.find((entry) => entry.x === location.getX() && entry.y === location.getY() &&
    (entry.id === id || id === Objects.LADDER_270));
  if (ladder) {
    event.handled = true;
    const run = getRun(player);
    if (roomAt(location) !== run.exitRoom) return;
    cleanupNpcs(player, true);
    player.moveTo(BROTHERS[run.tunnel].crypt.clone());
    if (run.looted) player.setAttribute(ATTRIBUTE, freshRun(run.chests));
    return;
  }
  if (location.getX() === map.chest.x && location.getY() === map.chest.y &&
      [map.chest.id, Objects.CHEST_68, Objects.CHEST_69].includes(id)) {
    event.handled = true;
    if (clickType === 1 || clickType === 2) searchChest(player, clickType);
    return;
  }
  const door = doorAt(object);
  if (door) {
    event.handled = true;
    if (clickType === 1) useDoor(player, door);
  }
}

function handleNpcDeath({ npc, killer }) {
  if (!killer) return;
  const owner = npc.getOwner();
  if (owner && owner !== killer) return;
  const index = BROTHERS.findIndex((brother) => brother.npcId === npc.getId());
  if (index === -1 && (!CREATURES.has(npc.getId()) || !inTunnels(killer))) return;
  const state = session(killer);
  if (index !== -1 && !state.npcs.has(npc)) return;
  state.npcs.delete(npc);
  if (state.brother === npc) {
    state.brother = null;
    killer.getPacketSender().sendEntityHintRemoval(false);
  }
  if (owner) npc.__skipDefaultRespawn = true;
  const run = getRun(killer);
  if (run.looted || (index !== -1 && run.killed.includes(index))) return;
  if (index !== -1) run.killed.push(index);
  run.points = Math.min(1000, run.points + npc.getDefinition().getCombatLevel());
  run.kills++;
  updateOverlay(killer, run);
}

function drainPrayer(player, run) {
  if (--run.prayerTicks > 0) return;
  run.prayerTicks = PRAYER_DRAIN_TICKS;
  if (HILTS.has(player.getEquipment().get(Equipment.SHIELD_SLOT).getId())) return;
  const skills = player.getSkillManager();
  skills.setCurrentLevelCombat(Skill.PRAYER, Math.max(0, skills.getCurrentLevel(Skill.PRAYER) - 8 - run.killed.length));
  skills.updateSkill(Skill.PRAYER);
  player.sendMessage("A strange force drains your Prayer.");
}

function processPlayer({ player }) {
  if (!inBarrows(player) && !sessions.has(player)) return;
  const state = session(player);
  if (state.puzzle && !state.puzzle.from.equals(player.getLocation())) {
    state.puzzle = null;
    player.getPacketSender().closeInterface(PUZZLE_ID);
  }
  if (state.dig && --state.dig.ticks <= 0) {
    const dig = state.dig;
    state.dig = null;
    if (player.getLocation().equals(dig.from) && player.getHitpoints() > 0) {
      cleanupNpcs(player, true);
      player.moveTo(dig.to.clone());
      player.sendMessage("You've found a crypt!");
    }
  }
  const phase = !inBarrows(player) ? "outside" : inTunnels(player) ? "tunnels" : player.getLocation().getZ() === 3 ? "crypt" : "surface";
  const run = player.getAttribute(ATTRIBUTE) ?? (phase !== "outside" ? getRun(player) : null);
  if (phase !== state.phase) {
    if (state.phase === "tunnels" && phase !== "tunnels") {
      cleanupNpcs(player, true);
      if (run.looted) player.setAttribute(ATTRIBUTE, freshRun(run.chests));
    }
    state.puzzle = null;
    state.phase = phase;
    if (phase === "outside") player.getPacketSender().closeInterface(OVERLAY_ID);
    else {
      showOverlay(player);
      // This also restores player-specific objects on the first process tick after login.
      if (phase === "tunnels") syncTunnels(player, getRun(player));
    }
  }
  if (state.crossing && --state.crossing.ticks <= 0) {
    const crossing = state.crossing;
    state.crossing = null;
    if (phase === "tunnels") {
      for (const leaf of crossing.leaves) player.getPacketSender().sendObject(asObject(leaf));
      if (player.getLocation().equals(crossing.to)) spawnEncounter(player, roomAt(crossing.to));
    }
  }
  if (phase === "crypt" || phase === "tunnels") {
    if (player.getHitpoints() > 0) drainPrayer(player, getRun(player));
    if (phase === "tunnels" && getRun(player).looted && World.getProcessCycle() % 10 === 0) {
      player.getCombat().getHitQueue().addPendingDamage([new HitDamage(randomInt(1, 4), HitMask.RED)]);
    }
  }
  for (const npc of [...state.npcs]) {
    // Let a fatal hit finish crediting its owner even if they climb out on the same tick.
    if (npc.isDyingFunction()) continue;
    if (phase === "outside" || phase === "surface" || npc.getLocation().getZ() !== player.getLocation().getZ() ||
        npc.getLocation().getDistance(player.getLocation()) >= 40) removeNpc(player, npc);
  }
}

function cleanupPlayer({ player }) {
  if (sessions.has(player)) {
    cleanupNpcs(player);
    sessions.delete(player);
  }
  const run = player.getAttribute(ATTRIBUTE);
  if (run?.looted && !inTunnels(player)) player.setAttribute(ATTRIBUTE, freshRun(run.chests));
}

function playerDeath(event) {
  cleanupPlayer(event);
  const run = event.player.getAttribute(ATTRIBUTE);
  if (run?.looted) event.player.setAttribute(ATTRIBUTE, freshRun(run.chests));
}

module.exports = {
  name: "Barrows",
  members: true,
  register(api) {
    World = api.getWorld();
    RegionManager = api.getRegionManager();
    TaskManager = api.getTaskManager();
    pluginApi = api;
    initRegionBuildingAnalysisCoreAccess(api);
    api.persistAttribute(ATTRIBUTE);
    api.onItemAction("Spade", { Dig: dig });
    api.onItemAction("Strange old lockpick", { Inspect: inspectLockpick });
    api.onItemAction("Strange old lockpick (full)", { Inspect: inspectLockpick });
    api.onObjectRoute(routeDoor);
    api.onObjectInteraction(handleObject);
    api.onInterfaceActionClick(answerPuzzle);
    api.onInterfaceActionButton(WELCOME_PLAY_BUTTON_UID, restoreOverlayAfterWelcome);
    // Mobile skips the welcome screen, so its gameframe is never replaced and
    // this mount survives. Desktop keeps waiting for the Play button, which runs
    // after WelcomeScreen re-boots the gameframe.
    api.onPlayerLogin(({ player }) => {
      if (player.getAttribute(MOBILE_CLIENT_ATTRIBUTE) === true) {
        restoreOverlayAfterWelcome({ player });
      }
    });
    api.onNpcDeath(handleNpcDeath);
    api.onPlayerProcess(processPlayer);
    api.onPlayerDeath(playerDeath);
    api.onPlayerDisconnect(cleanupPlayer);
    api.onPlayerLogout(cleanupPlayer);
    api.registerNpcCombatMethodProvider(Npcs.AHRIM_THE_BLIGHTED, AhrimCombat);
  },
};
