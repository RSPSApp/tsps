"use strict";

/**
 * The lobby's Ascension rocks, the gathering sprite and the builders' banter.
 *
 * Captured (docs/fractured-archive.md):
 * - Ten rocks; three are up (tfa_gathering_rock_active01-03, "Mine") at a time, the rest lowered
 *   (the inactive ids, which the map places). The set changes every 289 ticks: the rocks going
 *   down play crystal_ascension0N_lower, the ones coming up _raise, with synth 2661. A new set
 *   never repeats the one before. Anyone mining a rock that goes down stops.
 * - Mining: "You swing your pick at the crystal.", the pickaxe's wall animation, and every
 *   success "You manage to mine some ascension shards." with one shard and synth 3600.
 *   tfa_gathering_coord_temp (varp 5916) holds the rock's packed tile.
 * - The sprite (tfa_gathering_sprite) appears beside the rocks about once a rotation (synth
 *   10391) and wanders. Look-at shatters it (tfa_gathering_sprite_explode, synth 10467): "The
 *   sprite shatters, giving you some ascension shards." and one or two shards.
 * - The builders: one boasts "This bridge will hold a thousand marching soldiers once I'm done
 *   with it!", another answers "Stop boasting and get back to work, pal." (sometimes "I am!").
 * Estimates: the success chance (shards came 20-70 ticks apart with a dragon pickaxe at 89
 * Mining), the sprite's timing and lifetime, how often the builders talk. Mining experience is
 * not given: the captures' stat packets don't carry a usable total.
 */

const path = require("path");
const fs = require("fs");
const Shared = require("./Shared.FracturedArchive");

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "fractured-archive.json"), "utf8")).gathering;

const SWING_MESSAGE = "You swing your pick at the crystal.";
const SUCCESS_MESSAGE = "You manage to mine some ascension shards.";
const SPRITE_MESSAGE = "The sprite shatters, giving you some ascension shards.";
const NO_PICKAXE_MESSAGE = "You need a pickaxe to mine this rock.";
/** The loot tracker key live sent with the sprite's shards (script 7192). */
const SPRITE_LOOT_KEY = 196151;
/** Ticks between swings of the animation (estimate, as the Mining plugin's). */
const SWING_TICKS = 4;
/** Ticks between a boast and the answer (captured: 4). */
const BANTER_REPLY_TICKS = 4;
const BANTER_EVERY = [60, 140];
const SHARD_SUCCESS_BASE = 0.05;

const state = {
  /** The rocks' indexes into DATA.rocks that are up. */
  active: new Set(),
  rocks: [],
  sprite: null,
  spriteDue: 0,
  nextRotation: 0,
  nextBanter: 0,
  started: false,
  /** Whether the first set has gone up (the apprentice speaks from the second on). */
  rocksShown: false,
};
/** Per player: the rock being mined. */
const sessions = new WeakMap();

function lobbyPlayers() {
  const players = [];
  for (const player of Shared.core().World.getPlayers()) {
    if (player && Shared.inLobby(player.getLocation())) players.push(player);
  }
  return players;
}

function lobbyNpcs(npcIds) {
  const wanted = new Set([].concat(npcIds));
  const found = [];
  for (const npc of Shared.core().World.getNpcs()) {
    if (npc && wanted.has(npc.getId()) && Shared.inLobby(npc.getLocation())) found.push(npc);
  }
  return found;
}

// ---------------------------------------------------------------- the rocks

/** The map's rock at a tile, whatever it is now. */
function rockObjectAt(rock) {
  const { MapObjects } = Shared.core();
  return MapObjects.getType(Shared.loc({ x: rock.tile[0], y: rock.tile[1], z: 0 }), 10, null);
}

function setRock(index, up) {
  const rock = DATA.rocks[index];
  const { GameObject, ObjectManager, Animation } = Shared.core();
  const objectId = Shared.id("loc", up ? "ROCK_ACTIVE" : "ROCK_INACTIVE")[rock.variant];
  const current = rockObjectAt(rock);
  if (current) ObjectManager.deregister(current, true);
  const object = new GameObject(objectId, Shared.loc({ x: rock.tile[0], y: rock.tile[1], z: 0 }), 10, rock.face, null);
  ObjectManager.register(object, true);
  state.rocks[index] = object;
  const animation = new Animation(Shared.id("seq", up ? "ROCK_RAISE" : "ROCK_LOWER")[rock.variant]);
  for (const player of lobbyPlayers()) {
    player.getPacketSender().sendObjectAnimation(object, animation);
    if (object.getLocation().isViewableFrom?.(player.getLocation()) !== false) Shared.sound(player, Shared.SOUND.ROCK_SHIFT);
  }
}

/** A new set of three, none of them up already. */
function rotate() {
  const candidates = Shared.shuffle(DATA.rocks.map((_, index) => index).filter((index) => !state.active.has(index)));
  const next = new Set(candidates.slice(0, DATA.activeCount));
  for (const index of state.active) if (!next.has(index)) setRock(index, false);
  for (const index of next) if (!state.active.has(index)) setRock(index, true);
  state.active = next;
  for (const [player, session] of sessionsList()) {
    if (!next.has(session.index)) stopMining(player, true);
  }
  if (state.rocksShown) {
    const apprentice = lobbyNpcs(Shared.id("npc", "WIZARD_APPRENTICE"))[0];
    apprentice?.forceChat("The roots are shifting!");
  }
  state.rocksShown = true;
  state.spriteDue = Shared.cycle() + Shared.random(20, DATA.rotateTicks - 40);
}

const miners = new Set();

function sessionsList() {
  return [...miners].map((player) => [player, sessions.get(player)]).filter(([, session]) => session);
}

function rockIndexOf(object) {
  const location = object.getLocation();
  return DATA.rocks.findIndex((rock) => rock.tile[0] === location.getX() && rock.tile[1] === location.getY());
}

function bestPickaxe(player) {
  const request = { player, pickaxe: null };
  Shared.api().emitCustomEvent("mining:best-pickaxe", request);
  return request.pickaxe;
}

/** The pickaxe's wall-mining animation (human_mining_<metal>_pickaxe_wall), by the item's gameval. */
function wallAnimation(pickaxe) {
  const { CacheDefinitions, Animation } = Shared.core();
  const name = CacheDefinitions.getObjNames().get(pickaxe.id) ?? "";
  const metal = name.replace(/^trail_/, "").replace(/_pickaxe.*$/, "");
  const seq = CacheDefinitions.getSeqId(`human_mining_${metal}_pickaxe_wall`);
  return seq ? new Animation(seq) : pickaxe.animation;
}

function mineRock(event) {
  const { player, object } = event;
  const index = rockIndexOf(object);
  if (index < 0 || !state.active.has(index)) return false;
  const pickaxe = bestPickaxe(player);
  if (!pickaxe) {
    player.sendMessage(NO_PICKAXE_MESSAGE);
    return true;
  }
  stopMining(player, false);
  const { Location } = Shared.core();
  const at = object.getLocation();
  sessions.set(player, { index, pickaxe, animation: wallAnimation(pickaxe), from: player.getLocation().clone(), started: Shared.cycle() });
  miners.add(player);
  player.setPositionToFace(new Location(at.getX(), at.getY(), at.getZ()));
  player.performAnimation(sessions.get(player).animation);
  player.getPacketSender().sendConfig(Shared.id("varp", "GATHERING_COORD"), (at.getZ() << 28) | (at.getX() << 14) | at.getY());
  player.sendMessage(SWING_MESSAGE);
  return true;
}

function stopMining(player, resetAnimation) {
  if (!sessions.has(player)) return;
  sessions.delete(player);
  miners.delete(player);
  if (resetAnimation) {
    const { Animation } = Shared.core();
    player.performAnimation(new Animation(-1));
  }
}

/** Per tick for the lobby's miners: swings, successes, and stopping when they wander off. */
function processMiners(now) {
  const { Skill, Item } = Shared.core();
  for (const [player, session] of sessionsList()) {
    if (!player.isRegistered?.() || !player.getLocation().equals(session.from) || !state.active.has(session.index)) {
      stopMining(player, false);
      continue;
    }
    const elapsed = now - session.started;
    if (elapsed > 0 && elapsed % SWING_TICKS === 0) player.performAnimation(session.animation);
    if (elapsed <= 0 || elapsed % session.pickaxe.attemptIntervalTicks !== 0) continue;
    const level = player.getSkillManager().getCurrentLevel(Skill.MINING);
    const chance = SHARD_SUCCESS_BASE + level * 0.0003 + session.pickaxe.speed * 0.1;
    if (Math.random() >= chance) continue;
    if (player.getInventory().getFreeSlots() <= 0 && !player.getInventory().contains(Shared.id("obj", "ASCENSION_SHARDS"))) {
      player.sendMessage("Your inventory is too full to hold any more shards.");
      stopMining(player, true);
      continue;
    }
    player.getInventory().add(new Item(Shared.id("obj", "ASCENSION_SHARDS"), 1));
    Shared.sound(player, Shared.SOUND.SHARD);
    player.sendMessage(SUCCESS_MESSAGE);
  }
}

// ---------------------------------------------------------------- the sprite

function spawnSprite() {
  const [x, y] = DATA.sprite.spawn;
  const npc = Shared.api().spawnNpc({ id: Shared.id("npc", "GATHERING_SPRITE"), x, y, z: 0, wanderRadius: 3 });
  if (!npc) return;
  npc.__skipDefaultRespawn = true;
  state.sprite = { npc, until: Shared.cycle() + DATA.sprite.lifeTicks };
  for (const player of lobbyPlayers()) {
    if (npc.getLocation().isViewableFrom?.(player.getLocation()) !== false) Shared.sound(player, Shared.SOUND.SPRITE_APPEAR);
  }
}

function removeSprite() {
  const sprite = state.sprite;
  state.sprite = null;
  if (sprite?.npc?.isRegistered?.()) Shared.api().removeNpc(sprite.npc);
}

function shatterSprite(event) {
  const { player, npc } = event;
  const sprite = state.sprite;
  if (!sprite || sprite.npc !== npc || sprite.shattered) return true;
  sprite.shattered = true;
  const { Animation, Item } = Shared.core();
  npc.performAnimation(new Animation(Shared.id("seq", "SPRITE_EXPLODE")));
  const shards = Shared.random(1, 2);
  const shardId = Shared.id("obj", "ASCENSION_SHARDS");
  player.getInventory().add(new Item(shardId, shards));
  player.getPacketSender().sendClientScript(Shared.SCRIPT.SPRITE_SHARDS, npc.getId(), SPRITE_LOOT_KEY, shardId, shards);
  Shared.sound(player, Shared.SOUND.SPRITE_SHATTER);
  player.sendMessage(SPRITE_MESSAGE);
  Shared.later(state, 2, removeSprite);
  return true;
}

// ---------------------------------------------------------------- the builders

function banter() {
  const builders = Shared.shuffle(lobbyNpcs(Shared.id("npc", "BUILDERS")));
  if (builders.length < 2) return;
  const [boaster, heckler] = builders;
  const [boast, heckle, retort] = DATA.builders;
  boaster.forceChat(boast);
  Shared.later(state, BANTER_REPLY_TICKS, () => {
    heckler.forceChat(heckle);
    if (Math.random() < 0.1) Shared.later(state, BANTER_REPLY_TICKS, () => boaster.forceChat(retort));
  });
}

// ---------------------------------------------------------------- the lobby's clock

/** One task for all of it: the rotation, the miners, the sprite and the banter. */
function tick() {
  const now = Shared.cycle();
  if (!state.started) {
    state.started = true;
    state.nextRotation = now;
    state.nextBanter = now + Shared.random(...BANTER_EVERY);
  }
  if (now >= state.nextRotation) {
    state.nextRotation = now + DATA.rotateTicks;
    rotate();
  }
  if (miners.size > 0) processMiners(now);
  if (!state.sprite && state.spriteDue > 0 && now >= state.spriteDue) {
    state.spriteDue = 0;
    spawnSprite();
  } else if (state.sprite && now >= state.sprite.until && !state.sprite.shattered) {
    removeSprite();
  }
  if (now >= state.nextBanter) {
    state.nextBanter = now + Shared.random(...BANTER_EVERY);
    banter();
  }
}

function start() {
  Shared.repeat(state, 1, () => {
    tick();
    return true;
  });
}

function logout({ player }) {
  stopMining(player, false);
}

module.exports = function registerGathering(api) {
  Shared.bind(api);
  api.onServerStartup?.(start);
  api.onObjectInteraction("Ascension rocks", { Mine: mineRock });
  api.onNpcInteraction("<col=00ffff>Sprite</col>", { "Look-at": shatterSprite });
  api.onPlayerLogout(logout);
};

Object.assign(module.exports, { DATA, state, rotate, mineRock, stopMining, shatterSprite, start, tick });
