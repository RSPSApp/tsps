/**
 * Tai Bwo Wannai Cleanup: what hacking the jungle can disturb.
 *
 * The Wiki (Light Jungle, "Event rate", from Mod Ash): a counter that rises by one for each hack
 * result, to at most 7, is the chance out of 101 rolled on every tick of a swing; it is 0 again
 * after an event, and logging out resets it (eventchance, rsprox 227/01858 and 237/01102). An
 * event takes the place of that swing's result and ends the hack. The Wiki's table: a gout tuber
 * first (1/100 at Woodcutting 10 to 1/33 at 99), else spider 22, tribesman 21, snake 21, a large
 * mosquito 8, a swarm (level 17) 7, a swarm (level 20) 6, a gem rock 5, and the combat, poison
 * and disease Broodoo victims 4, 3 and 2, out of 99.
 *
 * As recorded: the stall animation on the roll's tick; on the next, the message, the bush shaking,
 * and for a monster the step back (one tile straight away from the bush, if it's free) with the
 * monster put on the tile the player left. It takes its attacking form 2 ticks later (the snake
 * 3), then attacks. Mosquitoes have no hidden form. Spawns last 50 minutes (Wiki).
 *
 * Kills: the Wiki's favour (1% a mosquito, swarm or snake; 1-2% a tribesman or spider, a spider
 * only once sticks have been claimed, wild jungle spiders too; about 3% a Broodoo victim) to the
 * killer, with the recorded message; mosquitoes also give Agility XP (17.5, 35, 75).
 */
const Common = require("./Common.TaiBwoWannaiCleanup");
const Favour = require("./Favour.TaiBwoWannaiCleanup");
const Locs = require("./Locs.TaiBwoWannaiCleanup");

const COUNTER = "tai-bwo-wannai-cleanup:event-chance";
/** By spawned NPC: { player, event, due }. */
const spawned = new Map();

const events = () => Common.data.events;
const npcId = (name) => Common.core.CacheDefinitions.getNpcId(name) ?? -1;
const between = ([low, high]) => low + Math.floor(Math.random() * (high - low + 1));

function counter(player) {
  return Number(player.getAttribute(COUNTER)) || 0;
}

function setCounter(player, value) {
  player.setAttribute(COUNTER, value);
  Common.varbit(player, events().chance.varbit, value);
}

/** A hack result: one more in 101 next swing, to the cap. */
function counted(player) {
  setCounter(player, Math.min(events().chance.max, counter(player) + 1));
}

/** A swing's tick: whether an event takes it (the caller ends the hack). */
function roll(player, jungle, object) {
  const chance = counter(player);
  if (chance <= 0 || Math.floor(Math.random() * events().chance.outOf) >= chance) return false;
  setCounter(player, 0);
  Common.animate(player, events().stall);
  const location = player.getLocation().clone();
  Common.later(player, 1, () => disturb(player, jungle, object, location));
  return true;
}

/** The gout tuber's odds, 1/100 at Woodcutting 10 to 1/33 at 99. */
function goutChance(level) {
  const { low, high, fromLevel, toLevel } = events().goutChance;
  const at = Math.max(0, Math.min(1, (level - fromLevel) / (toLevel - fromLevel)));
  return 1 / (low + (high - low) * at);
}

function pick() {
  const table = events().table;
  let roll = Math.floor(Math.random() * table.reduce((sum, entry) => sum + entry.weight, 0));
  for (const entry of table) {
    roll -= entry.weight;
    if (roll < 0) return entry;
  }
  return table[0];
}

/** Everyone in view sees the bush shake and the chippings fly. */
function shake(player, object) {
  const { Animation, Graphic } = Common.core;
  object.performAnimation(new Animation(Common.seqId(events().bushShake)));
  const chippings = Common.core.CacheDefinitions.getSpotanimId(Common.data.spotanims.chippings);
  player.getPacketSender().sendGlobalGraphic(new Graphic(chippings), object.getLocation());
}

function say(player, entry) {
  if (entry.chat === "game") player.sendMessage(entry.message);
  else Common.spam(player, entry.message);
  if (entry.sound) Common.sound(player, entry.sound);
}

function disturb(player, jungle, object, location) {
  const live = Locs.find([Common.locId(jungle.locs[0]), Common.locId(jungle.locs[1]), Common.locId(jungle.locs[2]), Common.locId(jungle.locs[3])], object.getLocation());
  if (!live) return;
  shake(player, live);
  if (Math.random() < goutChance(Common.level(player, "WOODCUTTING"))) return revealGout(player, jungle, live);
  const entry = pick();
  if (entry.key === "gemRock") return revealGemRock(player, jungle, live);
  say(player, entry);
  stepBack(player, live);
  spawn(player, entry, location);
}

/** One tile straight away from the bush, facing it, when that tile is free; else the player stays. */
function stepBack(player, bush) {
  const { ForceMovement, ForceMovementTask, Location, RegionManager, TaskManager } = Common.core;
  const at = player.getLocation();
  const dx = Math.sign(at.getX() - bush.getLocation().getX());
  const dy = Math.sign(at.getY() - bush.getLocation().getY());
  const { stepback } = events();
  Common.animate(player, stepback.seq, stepback.delay);
  if ((dx === 0) === (dy === 0)) return;
  const to = new Location(at.getX() + dx, at.getY() + dy, at.getZ());
  // A wall or anything solid in the way: the player stays put (237/01102).
  const area = player.getPrivateArea();
  // (canMoveIsBlocked answers whether the step is clear.)
  if (RegionManager.blocked(to, area) || !RegionManager.canMoveIsBlocked(at, stepDirection(dx, dy), area)) return;
  // ForceMovement directions: 0 north, 1 east, 2 south, 3 west; the player faces the bush.
  const facing = dy < 0 ? 0 : dx < 0 ? 1 : dy > 0 ? 2 : 3;
  player.getMovementQueue().reset();
  TaskManager.submit(new ForceMovementTask(player, 1,
    new ForceMovement(at.clone(), new Location(dx, dy), stepback.speed, stepback.reverse, facing, Common.seqId(stepback.seq))));
}

/** RegionManager's direction index for a one-tile step (1 north, 4 east, 6 south, 3 west). */
function stepDirection(dx, dy) {
  return dy > 0 ? 1 : dx > 0 ? 4 : dy < 0 ? 6 : 3;
}

function spawn(player, entry, location) {
  const { NPC, World } = Common.core;
  const npc = new NPC(npcId(entry.spawn ?? entry.npc), location.clone());
  npc.__skipDefaultRespawn = true;
  spawned.set(npc, { player, entry, due: World.getProcessCycle() + events().lifeTicks });
  World.getAddNPCQueue().push(npc);
  // Its attacking form comes whether or not the player is still here.
  Common.afterTicks(entry.turnAfter, () => {
    if (!spawned.has(npc) || !npc.isRegistered?.()) return;
    if (entry.spawn) {
      npc.setNpcTransformationId(npcId(entry.npc));
      // Its health is the attacking form's (a Broodoo victim's hidden form has 10, its own 100).
      npc.setHitpoints(npc.getMaxHitpoints());
    }
    if (player.isRegistered()) npc.getCombat().attack(player);
  });
  return npc;
}

function remove(npc) {
  const { World } = Common.core;
  spawned.delete(npc);
  npc.getCombat?.().reset?.();
  const pending = World.getAddNPCQueue();
  const index = pending.indexOf(npc);
  if (index !== -1) pending.splice(index, 1);
  if (npc.isRegistered?.() && !World.getRemoveNPCQueue().includes(npc)) World.getRemoveNPCQueue().push(npc);
}

/** Spawns left alone go after 50 minutes. */
function expire() {
  const tick = Common.core.World.getProcessCycle();
  for (const [npc, spawn] of [...spawned]) {
    if (spawn.due <= tick) remove(npc);
  }
}

// ------------------------------------------------------------------ gout tuber and gem rock

/** By tile: who found a gout tuber plant or gem rock (only they may dig it while logged in, Wiki), by username. */
const finders = new Map();
const tileKey = (location) => `${location.getX()},${location.getY()},${location.getZ()}`;

function revealGout(player, jungle, bush) {
  const { gout } = events();
  player.sendMessage(gout.message);
  Common.sound(player, gout.sound);
  const plant = Locs.swap(bush, Common.locId(gout.loc), gout.lifeTicks, Common.locId(jungle.locs[0]));
  finders.set(tileKey(plant.getLocation()), { username: player.getUsername(), jungle });
}

function online(username) {
  return Common.core.World.getPlayerByName?.(username)?.isRegistered?.() === true;
}

function jungleOfStump(location) {
  return finders.get(tileKey(location))?.jungle ?? Common.data.jungle[0];
}

/** Spade on the plant: two digs, then the tuber, and the jungle cut back to the ground. */
function digGout(event) {
  const { player, object } = event;
  if (object.getId() !== Common.locId(events().gout.loc)) return false;
  event.handled = true;
  const { dig } = events().gout;
  const tile = tileKey(object.getLocation());
  const finder = finders.get(tile);
  if (finder && finder.username !== player.getUsername() && online(finder.username)) {
    player.sendMessage(dig.notYours);
    return true;
  }
  const jungle = jungleOfStump(object.getLocation());
  // Starting to dig makes it the digger's.
  finders.set(tile, { username: player.getUsername(), jungle });
  const digOnce = () => {
    Common.animate(player, dig.seq);
    Common.sound(player, dig.sound);
  };
  digOnce();
  Common.later(player, dig.again, digOnce);
  Common.later(player, dig.doneAt, () => {
    const plant = Locs.find([Common.locId(events().gout.loc)], object.getLocation());
    if (!plant || finders.get(tile)?.username !== player.getUsername()) return;
    if (!player.getLocation().isWithinInteractionDistance(plant.getLocation())) return;
    // No room: the plant stays, still theirs, for when there is.
    const tuber = new Common.core.Item(Common.objId(dig.item), 1);
    if (player.getInventory().getAddableAmount(tuber) < 1) {
      player.sendMessage(Common.message("noRoom"));
      return;
    }
    finders.delete(tile);
    player.getInventory().add(tuber);
    Common.spam(player, dig.message);
    // The tuber found: its own event, for the league's "Find a Gout Tuber" (the plant is dug).
    Common.api.emitCustomEvent("tai-bwo-wannai-cleanup:gout-tuber", { player });
    Locs.swap(plant, Common.locId(jungle.locs[4]), Common.data.hack.regrowTicks, Common.locId(jungle.locs[0]));
  });
  return true;
}

function revealGemRock(player, jungle, bush) {
  const { gem } = events();
  player.sendMessage(gem.message);
  const rock = Locs.swap(bush, Common.locId(gem.locs[0]), gem.lifeTicks, Common.locId(jungle.locs[0]));
  finders.set(tileKey(rock.getLocation()), { username: player.getUsername(), jungle });
}

// ------------------------------------------------------------------ kills

function isOurs(npc) {
  return Common.data.events.table.some((entry) => entry.npc && npcId(entry.npc) === npc.getId());
}

function rewardKill({ npc, killer }) {
  const player = killer?.isPlayer?.() ? killer.getAsPlayer() : null;
  const entry = events().table.find((candidate) => candidate.npc && npcId(candidate.npc) === npc.getId());
  const spawn = spawned.get(npc);
  if (spawn) spawned.delete(npc);
  if (!player) return;
  const wild = !entry && npc.getCurrentDefinition?.(player)?.getName?.() === events().wildSpider.name && Favour.inVillage(player);
  if (!entry && !wild) return;
  if ((wild || entry.afterClaim) && Common.progress(player) < Common.data.progress.claimed) return;
  Favour.gain(player, between(wild ? events().wildSpider.points : entry.points));
  Common.spam(player, events().killMessage);
  if (entry?.agility) {
    Common.xp(player, "AGILITY", entry.agility);
    player.sendMessage(events().agilityMessage);
  }
}

/**
 * Tribesmen disturbed in the cleanup drop only bones (Wiki, and every recorded kill). The generic
 * tribesman table is no longer theirs (npc-drop-overrides.json), so NpcDrops rolls nothing and the
 * bones join its drops here, as other content's own loot does ("npc-drops:add").
 */
function addBones(event) {
  const entry = events().table.find((candidate) => candidate.bones && npcId(candidate.npc) === event.npcId);
  if (entry) event.drops.push({ itemId: Common.objId("bones"), amount: 1, noted: false });
}

/** Removed by anything else (a death, a reset): forget it, so it doesn't hold its player. */
function forgetRemoved() {
  for (const npc of [...spawned.keys()]) {
    if (!npc.isRegistered?.() && !Common.core.World.getAddNPCQueue().includes(npc)) spawned.delete(npc);
  }
}

function attachEvents(api) {
  const { Task, TaskManager } = Common.core;
  api.onItemOnObject("Spade", Common.core.CacheDefinitions.getObject(Common.locId(events().gout.loc)).name, digGout);
  api.onNpcDeath(rewardKill);
  api.onCustomEvent("npc-drops:add", addBones);
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(1, "tai-bwo-wannai-cleanup:spawns", false);
    }
    execute() {
      expire();
      forgetRemoved();
    }
  })());
}

module.exports = {
  attachEvents, roll, counted, goutChance, pick, spawn, remove, digGout, rewardKill, addBones, isOurs, revealGout, revealGemRock,
  COUNTER, _spawned: spawned, _finders: finders,
};
