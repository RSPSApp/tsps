"use strict";

/**
 * The Book of Haricanto's shipwreck and rocky island, as the user's revision 242 capture
 * plays them (20261112T092603-5ab63b4; facts by tick in docs/quests/ghosts-ahoy/README.md):
 *
 * - The toy boat: Repair, Inspect and dyeing its flag (item boxes, ticks 528, 739-763).
 * - The ship's chests: the lobster's chest on the bottom deck (581-617), the locked chest in
 *   the office (905-923) and the chest on the rocky island (962-974).
 * - The mast and the wind (632-764): the ahoy_windspeed overlay while on the top deck, and the
 *   flag's colours shown one part at a time while the wind is low.
 * - The gangplanks and the rock jumps to the island (930-1014).
 * - Piecing the map scraps together (1025).
 */

const State = require("./State.GhostsAhoy");
const ObstacleRunner = require("../../skills/agility/ObstacleRunner.Agility");

const COLOURS = ["white", "red", "yellow", "blue", "orange", "green", "purple"];
/** Flag parts as stored ([top, bottom, skull]) and as the dye menu, the boxes and the mast name them. */
const PART = Object.freeze({ TOP: 0, BOTTOM: 1, SKULL: 2 });

/** The top deck, where the ahoy_windspeed overlay shows (the mast is at 3619,3543,2). */
const TOP_DECK = Object.freeze({ minX: 3614, maxX: 3622, minY: 3539, maxY: 3547, levels: [2] });
const OVERLAY_HUD_UID = (161 << 16) | 8; // toplevel overlay_hud (164:8 in the capture's fixed layout)
const WINDSPEED_INTERFACE = "ahoy_windspeed";
const WINDSPEED_INDICATOR = "ahoy_windspeed:ahoy_windspeed_indicator";
/** Captured gusts lasted 2-25 ticks either way (ticks 644-764); Ours: an even roll in that range. */
const WIND_TICKS = Object.freeze({ min: 2, max: 25 });

const CHEST = Object.freeze({
  LOBSTER: { x: 3618, y: 3542, z: 0 },
  ISLAND: { x: 3606, y: 3564, z: 0 },
  OFFICE: { x: 3619, y: 3545, z: 1 },
});
const LOBSTER_SPAWN = Object.freeze({ x: 3616, y: 3543, z: 0 });

/** Gangplank (tile it's at) -> landing, one tick after arriving (ticks 934, 1014). */
const GANGPLANKS = Object.freeze([
  { at: [3605, 3546, 1], to: [3605, 3548, 0] },
  { at: [3605, 3547, 0], to: [3605, 3545, 1] },
]);

/**
 * Rock jumps, by the rock clicked: from the take-off tile to the landing (capture ticks
 * 937-1005). Two rocks are clicked from either side; the take-off nearest the player is used.
 * Ours: rock 3599,3564 (never clicked in the capture) jumps from itself to 3601,3564.
 */
const JUMPS = Object.freeze([
  { rock: [3604, 3550], from: [3604, 3550], to: [3602, 3550] },
  { rock: [3597, 3552], from: [3601, 3551], to: [3597, 3552] },
  { rock: [3595, 3556], from: [3595, 3554], to: [3595, 3556] },
  { rock: [3597, 3561], from: [3596, 3557], to: [3597, 3561] },
  { rock: [3601, 3564], from: [3597, 3563], to: [3601, 3564] },
  { rock: [3601, 3564], from: [3601, 3564], to: [3599, 3564] },
  { rock: [3597, 3559], from: [3598, 3563], to: [3597, 3559] },
  { rock: [3595, 3554], from: [3596, 3558], to: [3595, 3554] },
  { rock: [3599, 3552], from: [3597, 3552], to: [3599, 3552] },
  { rock: [3602, 3550], from: [3602, 3550], to: [3604, 3550] },
  { rock: [3599, 3564], from: [3599, 3564], to: [3601, 3564] },
]);
const JUMP_ANIM = 1604; // human_jump_stones, delay 26
const JUMP_SOUND = 2461;
const FALL_ANIM = 767; // human_falling_end
const FALL_SOUND = 2455;
const JUMP_XP = 10; // Transcript: "10 Agility experience" a successful jump
/** Ours: the capture fell once in ten jumps; the Wiki gives no rate. */
const FALL_CHANCE = 0.1;
/** Wiki: a fall loses 1-3 Hitpoints (the capture: 3, two ticks after landing). */
const FALL_DAMAGE = Object.freeze([1, 3]);

const MESSAGE = Object.freeze({
  LOBSTER: "You are attacked by a giant lobster!!",
  SCRAP: "You find a piece of a map inside the chest.",
  NOTHING: "You search the chest but find nothing.",
  LOCKED: "The chest is locked.",
  UNLOCKED: "You unlock the chest.",
  GANGPLANK: "You cross the gangplank.",
  REPAIRED: "You replace the toy boat's missing flag.",
  REPAIR_KIT: "You need some silk to replace the flag, something to sew it to the boat, and something to cut the flag to the right size.",
  DYE_PROMPT: "Which part of the flag do you want to dye?",
  MAP: "You piece the three map scraps together to form a complete map.",
  MAP_PIECES: "You don't have all the pieces of the map yet.",
  MAST: "You can see a tattered flag blowing in the wind.",
  WINDY: "The wind is blowing too hard to make out any details.",
});

let api;
let core;
let ids;
let quest;
let box;

/** Live giant lobsters, by the player they attack. */
const lobsters = new Map();
/** Players on the top deck and their wind timers. */
const windy = new Map();

const at = (location, tile) => location.x === tile.x && location.y === tile.y && location.z === tile.z;
const held = (player, itemId) => player.getInventory().getAmount(itemId) > 0;

function dyeColours() {
  const I = core.ItemIdentifiers;
  return new Map([
    [I.RED_DYE, 1], [I.YELLOW_DYE, 2], [I.BLUE_DYE, 3],
    [I.ORANGE_DYE, 4], [I.GREEN_DYE, 5], [I.PURPLE_DYE, 6],
  ]);
}

/** The mast's colours, rolled once per player (1-6 per part). */
function mastFlag(player) {
  let parts = State.flag(player, State.MAST_FLAG_ATTRIBUTE);
  if (!parts) {
    parts = [0, 1, 2].map(() => 1 + Math.floor(Math.random() * 6));
    State.setFlag(player, State.MAST_FLAG_ATTRIBUTE, parts);
  }
  return parts;
}

function toyFlag(player) {
  return State.flag(player, State.TOY_FLAG_ATTRIBUTE) ?? [0, 0, 0];
}

function toyMatchesMast(player) {
  const toy = toyFlag(player);
  const mast = mastFlag(player);
  return toy.every((part, index) => part === mast[index]);
}

/** The map is whole, or the book was dug up or handed in: no chest gives a scrap again. */
function mapDone(player) {
  return held(player, ids.TREASURE_MAP) || held(player, ids.BOOK_OF_HARICANTO)
    || State.get(player, State.VARBIT.GIVEN_BOOK) === 1;
}

function hasScrap(player, scrap) {
  return held(player, scrap) || mapDone(player);
}

function replaceLoc(object, id) {
  const { GameObject, Location, ObjectManager } = core;
  const location = object.getLocation();
  ObjectManager.deregister(object, true);
  const next = new GameObject(id, new Location(location.getX(), location.getY(), location.getZ()), object.getType(),
    object.getFace(), object.getPrivateArea?.() ?? null);
  ObjectManager.register(next, true);
  return next;
}

function later(player, ticks, fn) {
  core.TaskManager.submit(new core.CountdownTask(player, ticks, () => {
    if (player.isRegistered?.() !== false) fn();
  }));
}

function animate(player, id, delay = 0) {
  player.performAnimation(new core.Animation(id, delay));
}

function sound(player, id, delay = 0) {
  core.Sounds.sendSound(player, new core.Sound(id, 1, delay, 0));
}

// ---------------------------------------------------------------------------
// Chests
// ---------------------------------------------------------------------------

/** Open (16118): the lid anim and sound, then the open chest a tick later (ticks 587-588, 965-966). */
function openChest(event) {
  const { player, object } = event;
  animate(player, 536);
  sound(player, 52);
  later(player, 1, () => {
    if (core.MapObjects.get(ids.CHEST_CLOSED, object.getLocation(), object.getPrivateArea?.() ?? null) === object) {
      replaceLoc(object, ids.CHEST_OPEN);
    }
  });
  return true;
}

/** Close (16119 op2): ticks 973-974. */
function closeChest(event) {
  const { player, object } = event;
  animate(player, 535);
  sound(player, 51);
  later(player, 1, () => {
    if (core.MapObjects.get(ids.CHEST_OPEN, object.getLocation(), object.getPrivateArea?.() ?? null) === object) {
      replaceLoc(object, ids.CHEST_CLOSED);
    }
  });
  return true;
}

function searchChest(event) {
  const { player, location } = event;
  if (quest.isStarted(player) && quest.getStage(player) >= quest.STAGE.CRONE_HELP) {
    if (at(location, CHEST.LOBSTER)) return searchLobsterChest(player);
    if (at(location, CHEST.ISLAND) && !hasScrap(player, ids.MAP_SCRAP_3)) {
      box.item(player, ids.MAP_SCRAP_3, MESSAGE.SCRAP);
      player.getInventory().adds(ids.MAP_SCRAP_3, 1);
      return true;
    }
  }
  player.sendMessage(MESSAGE.NOTHING);
  return true;
}

/** The guarded chest: the lobster first (ticks 591-615), the scrap once it is dead (617). */
function searchLobsterChest(player) {
  if (State.get(player, State.VARBIT.LOBSTER) !== 1) {
    // A search while it fights does nothing (ticks 599, 602).
    if (lobsters.has(player)) return true;
    spawnLobster(player);
    return true;
  }
  if (hasScrap(player, ids.MAP_SCRAP_2)) {
    player.sendMessage(MESSAGE.NOTHING);
    return true;
  }
  player.getInventory().adds(ids.MAP_SCRAP_2, 1);
  box.item(player, ids.MAP_SCRAP_2, MESSAGE.SCRAP);
  return true;
}

function spawnLobster(player) {
  const lobster = api.spawnNpc({
    id: ids.GIANT_LOBSTER, ...LOBSTER_SPAWN, wanderRadius: 0, owner: player, ownerOnly: true,
  });
  if (!lobster) return;
  lobsters.set(player, lobster);
  player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, MESSAGE.LOBSTER);
  player.getPacketSender().sendEntityHint(lobster);
  lobster.getCombat?.()?.attack?.(player);
}

function lobsterDied(event) {
  if (event.npcId !== ids.GIANT_LOBSTER) return;
  for (const [player, lobster] of lobsters) {
    if (lobster !== event.npc) continue;
    lobsters.delete(player);
    State.set(player, State.VARBIT.LOBSTER, 1);
    player.getPacketSender().clearHintArrow();
  }
}

function dropLobster({ player }) {
  const lobster = lobsters.get(player);
  if (!lobster) return;
  lobsters.delete(player);
  api.removeNpc(lobster);
}

/** The office chest (16116 at 3619,3545,1); the other closed chests are just locked. */
function openLockedChest(event) {
  const { player, location, object } = event;
  if (!at(location, CHEST.OFFICE) || State.get(player, State.VARBIT.TOY_BOAT) < 3) {
    player.sendMessage(MESSAGE.LOCKED);
    return true;
  }
  // Unlocked: the chest shows open for a moment, then closes again (ticks 920-923).
  const shown = replaceLoc(object, ids.LOCKED_CHEST_ACTIVE);
  sound(player, 62);
  const shut = () => {
    if (core.MapObjects.get(ids.LOCKED_CHEST_ACTIVE, shown.getLocation(), null) === shown) replaceLoc(shown, ids.LOCKED_CHEST);
  };
  if (!hasScrap(player, ids.MAP_SCRAP)) {
    player.getInventory().adds(ids.MAP_SCRAP, 1);
    box.item(player, ids.MAP_SCRAP, MESSAGE.SCRAP, () => {
      player.sendMessage(MESSAGE.NOTHING);
      shut();
    });
    return true;
  }
  player.sendMessage(MESSAGE.NOTHING);
  later(player, 1, shut);
  return true;
}

function keyOnChest(event) {
  const { player, location, itemId } = event;
  if (itemId !== ids.CHEST_KEY || !location || !at(location, CHEST.OFFICE)) return;
  if (event.objectId !== ids.LOCKED_CHEST) return;
  event.handled = true;
  if (!held(player, ids.CHEST_KEY)) return;
  player.getInventory().deleteNumber(ids.CHEST_KEY, 1);
  State.set(player, State.VARBIT.TOY_BOAT, 3);
  box.item(player, ids.CHEST_KEY, MESSAGE.UNLOCKED);
}

// ---------------------------------------------------------------------------
// The mast and the wind
// ---------------------------------------------------------------------------

function sendWind(player, low) {
  player.getPacketSender().sendVarbit(State.VARBIT.WINDSPEED, low ? 1 : 0);
  const indicator = core.CacheDefinitions.getComponentId(WINDSPEED_INDICATOR);
  player.getFrameUpdater?.()?.clear?.(indicator);
  player.getPacketSender().sendString(low ? "Low" : "High", indicator);
}

function nextGust(player, state) {
  const ticks = WIND_TICKS.min + Math.floor(Math.random() * (WIND_TICKS.max - WIND_TICKS.min + 1));
  const token = ++state.token;
  later(player, ticks, () => {
    if (windy.get(player) !== state || state.token !== token) return;
    state.low = !state.low;
    sendWind(player, state.low);
    nextGust(player, state);
  });
}

/** On the top deck: the overlay opens on "High" (ticks 631-632) and the wind starts changing. */
function deckEntered({ player }) {
  if (windy.has(player)) return;
  const state = { low: false, token: 0 };
  windy.set(player, state);
  sendWind(player, false);
  player.getPacketSender().sendSubInterface(OVERLAY_HUD_UID, core.CacheDefinitions.getInterfaceId(WINDSPEED_INTERFACE), 1);
  nextGust(player, state);
}

/** Off the deck (tick 768): the overlay closes; the varbit stays as it was. */
function deckLeft({ player }) {
  if (!windy.delete(player)) return;
  player.getPacketSender().closeSubInterface(OVERLAY_HUD_UID);
}

function windIsLow(player) {
  return windy.get(player)?.low === true;
}

/** Search (ticks 634-724): a message box, the flag's details only while the wind is low. */
function searchMast(event) {
  const { player } = event;
  let detail = MESSAGE.WINDY;
  if (windIsLow(player)) {
    const parts = mastFlag(player);
    const part = Math.floor(Math.random() * 3);
    const colour = COLOURS[parts[part]];
    detail = part === PART.TOP ? `The top half of the flag is coloured ${colour}.`
      : part === PART.BOTTOM ? `The bottom half of the flag is coloured ${colour}.`
        : `The skull emblem is coloured ${colour}.`;
  }
  box.statement(player, `${MESSAGE.MAST}<br>${detail}`);
  return true;
}

// ---------------------------------------------------------------------------
// Gangplanks and the rocky island
// ---------------------------------------------------------------------------

function crossGangplank(event) {
  const { player, location } = event;
  const plank = GANGPLANKS.find(({ at: [x, y, z] }) => location.x === x && location.y === y && location.z === z);
  if (!plank) return false;
  later(player, 1, () => {
    player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, MESSAGE.GANGPLANK);
    player.moveTo(new core.Location(...plank.to));
  });
  return true;
}

function jumpFor(player, location) {
  const here = player.getLocation();
  const distance = ([x, y]) => Math.max(Math.abs(x - here.getX()), Math.abs(y - here.getY()));
  return JUMPS.filter(({ rock: [x, y] }) => x === location.x && y === location.y)
    .sort((a, b) => distance(a.from) - distance(b.from))[0] ?? null;
}

let fallRoll = () => Math.random() < FALL_CHANCE;

/**
 * Jump-To: a forced walk to the take-off, then the leap (anim 1604 delay 26, sound 2461, the
 * exact move over cycles 47-59) and 10 Agility two ticks later (ticks 937-940); a fall plays
 * anim 767 and sound 2455 on landing and hits 1-3 two ticks after (981-985), with no XP.
 */
function jumpToRock(event) {
  const { player, location } = event;
  if (ObstacleRunner.isBusy(player)) return true;
  const jump = jumpFor(player, location);
  if (!jump) return false;
  const falls = fallRoll();
  const steps = [];
  const here = player.getLocation();
  if (here.getX() !== jump.from[0] || here.getY() !== jump.from[1]) steps.push({ walk: [jump.from] });
  steps.push({ sound: JUMP_SOUND });
  steps.push({ move: [...jump.to, 0], anim: JUMP_ANIM, delay: 26, speed: [47, 59], ticks: 2 });
  if (falls) {
    steps.push({ anim: FALL_ANIM }, { sound: FALL_SOUND }, { wait: 2 },
      { hit: [FALL_DAMAGE[0], FALL_DAMAGE[1]] });
  } else {
    steps.push({ run: () => player.getSkillManager().addExperiences(core.Skill.AGILITY, JUMP_XP) });
  }
  ObstacleRunner.run({ player }, steps, { busyVarbit: true });
  return true;
}

// ---------------------------------------------------------------------------
// The toy boat and the map
// ---------------------------------------------------------------------------

function hasRepairKit(player) {
  return [ids.SILK, ids.NEEDLE, ids.THREAD, ids.KNIFE].every((item) => held(player, item));
}

/** Repair (tick 528): silk and thread are used, and the repaired boat takes the silk's slot. */
function repairToyBoat({ player }) {
  if (!held(player, ids.MODEL_SHIP)) return true;
  if (!hasRepairKit(player)) {
    box.statement(player, MESSAGE.REPAIR_KIT);
    return true;
  }
  const inventory = player.getInventory();
  const slot = inventory.getSlotForItemId?.(ids.SILK) ?? -1;
  inventory.deleteNumber(ids.MODEL_SHIP, 1);
  inventory.deleteNumber(ids.THREAD, 1);
  if (slot >= 0 && typeof inventory.setItem === "function") {
    inventory.setItem(slot, new core.Item(ids.REPAIRED_SHIP, 1));
    inventory.refreshItems?.();
  } else {
    inventory.deleteNumber(ids.SILK, 1);
    inventory.adds(ids.REPAIRED_SHIP, 1);
  }
  box.item(player, ids.REPAIRED_SHIP, MESSAGE.REPAIRED);
  return true;
}

function useOnToyBoat(event) {
  const { player } = event;
  const used = event.usedItemId;
  const other = event.usedWithItemId;
  const pair = new Set([used, other]);
  if (pair.has(ids.MODEL_SHIP) && [ids.SILK, ids.NEEDLE, ids.THREAD, ids.KNIFE].some((item) => pair.has(item))) {
    event.handled = true;
    repairToyBoat({ player });
    return;
  }
  if (!pair.has(ids.REPAIRED_SHIP)) return;
  const dye = dyeColours().has(used) ? used : dyeColours().has(other) ? other : null;
  if (dye == null) return;
  event.handled = true;
  dyeToyBoat(player, dye);
}

/** "Which part of the flag do you want to dye?" then an item box (ticks 739-763). */
function dyeToyBoat(player, dye) {
  const colour = dyeColours().get(dye);
  const apply = (part, label) => () => {
    if (!held(player, dye) || !held(player, ids.REPAIRED_SHIP)) return;
    player.getInventory().deleteNumber(dye, 1);
    const parts = toyFlag(player);
    parts[part] = colour;
    State.setFlag(player, State.TOY_FLAG_ATTRIBUTE, parts);
    box.item(player, ids.REPAIRED_SHIP, `You dye ${label} ${COLOURS[colour]}.`);
  };
  api.sendMultiChatboxPrompt(
    player,
    MESSAGE.DYE_PROMPT,
    "Top half", apply(PART.TOP, "the top of the flag"),
    "Bottom half", apply(PART.BOTTOM, "the bottom of the flag"),
    "Skull emblem", apply(PART.SKULL, "the skull emblem"),
  );
}

/** Inspect: the Wiki's box ("The top of the flag is white. The skull emblem is white. ..."). */
function inspectToyBoat({ player }) {
  const [top, bottom, skull] = toyFlag(player);
  box.item(player, ids.REPAIRED_SHIP,
    `The top of the flag is ${COLOURS[top]}. The skull emblem is ${COLOURS[skull]}. The bottom of the flag is ${COLOURS[bottom]}.`);
  return true;
}

const SCRAPS = () => [ids.MAP_SCRAP, ids.MAP_SCRAP_2, ids.MAP_SCRAP_3];

function combineScraps(event) {
  const scraps = SCRAPS();
  if (!scraps.includes(event.usedItemId) || !scraps.includes(event.usedWithItemId)) return;
  const { player } = event;
  event.handled = true;
  if (!scraps.every((scrap) => held(player, scrap))) {
    box.statement(player, MESSAGE.MAP_PIECES);
    return;
  }
  for (const scrap of scraps) player.getInventory().deleteNumber(scrap, 1);
  player.getInventory().adds(ids.TREASURE_MAP, 1);
  box.item(player, ids.TREASURE_MAP, MESSAGE.MAP);
}

function leave(event) {
  dropLobster(event);
  windy.delete(event.player);
}

function attach(registry, shared) {
  api = registry;
  core = registry.core;
  ({ ids, quest, box } = shared);
  ObstacleRunner.init(registry);
}

module.exports = {
  attach,
  // Handlers, wired in GhostsAhoy.Quest.js's register list.
  openChest,
  closeChest,
  searchChest,
  openLockedChest,
  keyOnChest,
  searchMast,
  deckEntered,
  deckLeft,
  crossGangplank,
  jumpToRock,
  repairToyBoat,
  inspectToyBoat,
  useOnToyBoat,
  combineScraps,
  lobsterDied,
  leave,
  toyMatchesMast,
  mastFlag,
  TOP_DECK,
  JUMPS,
  MESSAGE,
  COLOURS,
  _test: {
    lobsters,
    windy,
    setFallRoll(fn) { fallRoll = fn; },
    sendWind,
  },
};
