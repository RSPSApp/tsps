"use strict";

/**
 * The energy barriers into Port Phasmatys (ahoy_town_barrier_multi 57722: "Pass" and
 * "Pay-toll(2-Ecto)" before Ghosts Ahoy, only "Pass" after it) and the Ghost guards beside them.
 *
 * Wiki (Energy Barrier, Port Phasmatys): before the quest you pay 2 ecto-tokens and must wear a
 * ghostspeak amulet; after it, passage is free and Pay-toll is gone. Transcript:Ghost guard: the
 * guard asks for the toll if you wear a ghostspeak amulet or Morytania legs 2 or better, and only
 * wails at you otherwise ("...you may not pass the barriers..."); after the quest he waves you on.
 *
 * rsprox 231/00378 and 229/00703 (free passage): the player stops beside the barrier, faces it
 * for a tick, then walks through it one tile a tick to the tile beyond, with no message.
 *
 * Not recorded: Pass before the quest starts the guard's toll conversation (the guard is the one
 * who asks for the toll); the line for having too few ecto-tokens; and whether leaving the town
 * costs the toll too (it does here, as it did before).
 */

const ObstacleRunner = require("../skills/agility/ObstacleRunner.Agility");

const BARRIER_LOC = "ahoy_town_barrier_multi";
const TOLL = 2;
const QUEST = "Ghosts Ahoy";
const GHOST_GUARD = "Ghost guard";
const VARIANT = {
  BEFORE: "standard-dialogue-before-or-during-ghosts-ahoy",
  AFTER: "standard-dialogue-after-ghosts-ahoy",
};
/** Transcript:Ghost guard: the pay step; after the quest, his line and the wail that wave you on. */
const PAY_STEP = "s_ymV_";
const FREE_LINE = "All visitors to Port Phasmatys must pay a toll charge of 2 Ectotokens. However,";
const FREE_MESSAGE_STEP = "v-Asrg";
const UNDERSTANDS = "If the player wears either a ghostspeak amulet or the Morytania legs 2 or above:";
const NOT_UNDERSTANDS = "If the player does not wear either a ghostspeak amulet or the Morytania legs 2 or above:";
const MAY_NOT_PASS = "The ghostly guards wail at you incomprehensibly, and though you cannot understand their exact words you understand their meaning - you may not pass the barriers of Port Phasmatys.";
const TOO_FEW_TOKENS = "You need 2 ecto-tokens to pass through the barrier.";
/** How far from the player a guard's conversation looks for the barrier's anchor tile. */
const GUARD_REACH = 3;
/**
 * rsprox 231/00378: the object handler runs the tick after arriving beside it and the face shows
 * then; the first step is the tick after that.
 */
const FACE_TICKS = 1;

let api = null;
let core = null;

const barrierId = () => core.CacheDefinitions.getLocId(BARRIER_LOC);

function questComplete(player) {
  const request = { player, name: QUEST, complete: false };
  api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

/** Wearing a ghostspeak amulet, or Morytania legs 2 or better (Transcript:Ghost guard). */
function understandsGhosts(player) {
  const { Equipment, ItemIdentifiers: I } = core;
  const equipment = player.getEquipment();
  const amulet = equipment.get(Equipment.AMULET_SLOT)?.getId?.();
  const legs = equipment.get(Equipment.LEG_SLOT)?.getId?.();
  return [I.GHOSTSPEAK_AMULET, I.GHOSTSPEAK_AMULET_2].includes(amulet)
    || [I.MORYTANIA_LEGS_2, I.MORYTANIA_LEGS_3, I.MORYTANIA_LEGS_4].includes(legs);
}

function hasToll(player) {
  return player.getInventory().getAmount(core.ItemIdentifiers.ECTO_TOKEN) >= TOLL;
}

/**
 * The walk through a barrier from tile (x, y): onto its line and one tile past, or null when
 * that tile isn't beside it. The 1x2 loc lies north-south at rotations 0 and 2 (crossed
 * east-west) and east-west at rotations 1 and 3 (crossed north-south).
 */
function crossing(barrier, x, y, z) {
  const bx = barrier.x;
  const by = barrier.y;
  if (z !== barrier.z) return null;
  if (barrier.face % 2 === 0) {
    if (y < by || y > by + 1 || Math.abs(x - bx) !== 1) return null;
    return [[bx, y], [bx + (bx - x), y]];
  }
  if (x < bx || x > bx + 1 || Math.abs(y - by) !== 1) return null;
  return [[x, by], [x, by + (by - y)]];
}

/** The tiles a crossing starts from: either side of the line, beside each of its two tiles. */
function startTiles(barrier) {
  const { x, y } = barrier;
  return barrier.face % 2 === 0
    ? [[x - 1, y], [x - 1, y + 1], [x + 1, y], [x + 1, y + 1]]
    : [[x, y - 1], [x + 1, y - 1], [x, y + 1], [x + 1, y + 1]];
}

function barrierOf(object) {
  const at = object.getLocation();
  return { x: at.getX(), y: at.getY(), z: at.getZ(), face: object.getFace() };
}

/** Where the walk starts: `from` (beside a guard, one step away) or the player's own tile. */
function crossingFrom(player, barrier, from) {
  const at = player.getLocation();
  const [x, y] = from ?? [at.getX(), at.getY()];
  const path = crossing(barrier, x, y, at.getZ());
  if (!path) return null;
  return x === at.getX() && y === at.getY() ? path : [[x, y], ...path];
}

/** Faces the barrier for a tick, then walks through it a tile a tick (rsprox 231/00378). */
function walkThrough(player, barrier, from = null) {
  if (ObstacleRunner.isBusy(player)) return false;
  const steps = crossingFrom(player, barrier, from);
  if (!steps) return false;
  ObstacleRunner.run({ player }, [{ face: steps.at(-2) }, { wait: FACE_TICKS }, { walk: steps }]);
  return true;
}

/** Takes the toll and walks through; false (and nothing taken) when it can't. */
function payAndCross(player, barrier, from = null) {
  if (ObstacleRunner.isBusy(player) || !crossingFrom(player, barrier, from)) return false;
  if (!hasToll(player)) {
    player.sendMessage(TOO_FEW_TOKENS);
    return false;
  }
  player.getInventory().deleteNumber(core.ItemIdentifiers.ECTO_TOKEN, TOLL);
  return walkThrough(player, barrier, from);
}

function isBarrier(event) {
  return event.objectId === barrierId();
}

function pass(event) {
  if (!isBarrier(event)) return false;
  const { player, object } = event;
  if (questComplete(player)) {
    walkThrough(player, barrierOf(object));
    return true;
  }
  startGuard(player, VARIANT.BEFORE);
  return true;
}

function payToll(event) {
  if (!isBarrier(event)) return false;
  const { player, object } = event;
  if (questComplete(player)) {
    walkThrough(player, barrierOf(object));
    return true;
  }
  if (!understandsGhosts(player)) {
    player.sendMessage(MAY_NOT_PASS);
    return true;
  }
  payAndCross(player, barrierOf(object));
  return true;
}

function startGuard(player, variant) {
  api.emitCustomEvent("npc-dialogue:start", { player, npc: null, npcId: core.NpcIdentifiers.GHOST_GUARD, variant, handled: false });
}

function isGuard(npcId) {
  return core.CacheDefinitions.getNpc(npcId)?.name === GHOST_GUARD;
}

function guardVariant({ player, npcId }) {
  if (!isGuard(npcId)) return null;
  return questComplete(player) ? VARIANT.AFTER : VARIANT.BEFORE;
}

function guardCondition({ player, npcId, text }) {
  if (!isGuard(npcId)) return null;
  if (text === UNDERSTANDS) return understandsGhosts(player);
  if (text === NOT_UNDERSTANDS) return !understandsGhosts(player);
  return null;
}

/**
 * The barrier a guard conversation is about, and the start tile nearest the player: the guards
 * stand at the ends of the barrier line, so a player talking to one is beside a start tile (or
 * on one, after clicking Pass). Null when no barrier is that close.
 */
function guardBarrier(player) {
  const { Location, MapObjects } = core;
  const at = player.getLocation();
  let best = null;
  for (let dx = -GUARD_REACH; dx <= GUARD_REACH; dx++) {
    for (let dy = -GUARD_REACH; dy <= GUARD_REACH; dy++) {
      const tile = new Location(at.getX() + dx, at.getY() + dy, at.getZ());
      const object = MapObjects.get(barrierId(), tile, player.getPrivateArea?.() ?? null);
      if (!object) continue;
      const barrier = barrierOf(object);
      for (const start of startTiles(barrier)) {
        const distance = Math.max(Math.abs(start[0] - at.getX()), Math.abs(start[1] - at.getY()));
        if (distance <= 1 && (!best || distance < best.distance)) best = { barrier, from: start, distance };
      }
    }
  }
  return best;
}

/** The guard's "here's 2 Ectotokens" (s_ymV_): the toll, then through the barrier beside him. */
function guardAction(event) {
  if (!isGuard(event.npcId)) return;
  if (event.stepId === FREE_MESSAGE_STEP) {
    guardWavesOn(event.player);
    return;
  }
  if (event.stepId !== PAY_STEP) return;
  event.handled = true;
  event.end = true;
  // The guard's "understands ghosts" branch was chosen earlier; an amulet taken off since leaves the dialogue open,
  // so ask again here, as the barrier's own Pay-toll does.
  if (!understandsGhosts(event.player)) {
    event.player.sendMessage(MAY_NOT_PASS);
    return;
  }
  const near = guardBarrier(event.player);
  if (near) payAndCross(event.player, near.barrier, near.from);
}

/**
 * After the quest the guard waves you through. The transcript's "goes through the gate" steps
 * sit after its `end`, so the walk starts once his line has been read.
 */
function guardLine(request) {
  if (!isGuard(request.npcId) || !String(request.text ?? "").startsWith(FREE_LINE)) return;
  const previous = request.after;
  const player = request.player;
  request.after = () => {
    previous?.();
    guardWavesOn(player);
  };
}

function guardWavesOn(player) {
  if (!questComplete(player)) return;
  const near = guardBarrier(player);
  if (near) walkThrough(player, near.barrier, near.from);
}

function bind(registry) {
  api = registry;
  core = registry.core;
  ObstacleRunner.init(registry);
}

module.exports = {
  name: "PortPhasmatysBarrier",
  description: "Port Phasmatys energy barriers and Ghost guards: a 2 ecto-token toll before Ghosts Ahoy, free passage after.",
  members: true,
  register(registry) {
    bind(registry);
    registry.onObjectInteraction("Energy Barrier", { Pass: pass, "Pay-toll(2-Ecto)": payToll });
    registry.onNpcDialogueVariant(guardVariant);
    registry.onNpcDialogueCondition(guardCondition);
    registry.onCustomEvent("npc-dialogue:action", guardAction);
    registry.onCustomEvent("npc-dialogue:line", guardLine);
  },
  crossing, pass, payToll, guardVariant, guardCondition, guardAction, guardLine, understandsGhosts,
  TOLL, MAY_NOT_PASS, TOO_FEW_TOKENS, PAY_STEP, FREE_MESSAGE_STEP, FREE_LINE,
};
