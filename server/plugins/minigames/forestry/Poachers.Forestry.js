/**
 * Poachers, as recorded (rsprox 227/01855, 00083, 237/01100, 01101 and 01108; forestry.json `poachers`):
 * - a frightened fox and three poachers appear by the tree (spotanim 2571, sounds 1930 and 7530 at
 *   the fox, 1930 and 7540 at each poacher); the poachers wander about their spawns;
 * - the first trap comes 4-8 ticks in, then one every 10-17: a poacher stops, says a line ("This'll
 *   get that mangy fox!") with seq 10554, and 2 ticks later the trap is on that poacher's own tile
 *   (map_anim 2343, sound 2386);
 * - the fox crawls a tile every 2 ticks to the oldest trap on the map (and stops on any trap it
 *   steps on); a trap it has stood on for 2 ticks springs unless it's being disarmed: the trap's
 *   seq, the fox's defend seq and a 34 hitsplat, sounds 7541 and 2387 a tick later, the trap gone
 *   a tick after that (every recorded spring had the fox on the trap's tile);
 * - Disarm: "You start disarming the trap..." with synth 2387; 8 ticks on the trap plays its
 *   disarm seq and a poacher grumbles ("Oi, leave those traps alone!"); a tick later "You
 *   successfully disarm the trap." (spam) with synth 2387, and the bark the tick after;
 * - at 200 ticks they leave ("We'll get you next time, fox!", "Let's get out of here!"): sounds 7538
 *   and 2386 at the tree, map_anim 2369 at the fox, synth 7531 with "Well done, you've saved the fox
 *   from the poachers! The fox has left you a gift...", and the bark lump the tick after.
 * Wiki: up to 15 traps; a sprung trap takes 33-34 of the fox's 100 HP, and at none it's lost
 * ("Unfortunately you weren't able to save the fox from the poachers..."); 11 bark a trap,
 * Woodcutting 1.5 x level and Hunter 0.5 x level a trap; 160 bark and 400 + 14.45 x level
 * Woodcutting XP for saving it.
 * The fox is stepped here rather than by the npc random walk, which would move it a tile a tick
 * under its crawl. A fox that can't reach a trap leaves it be; the event still ends at 200 ticks.
 */
const Common = require("./Common.Forestry");
const Spawns = require("./Spawns.Forestry");

const F = () => Common.data.poachers;
/** Poacher events now on the map. */
const events = new Set();
/** Players disarming -> { event, trap, done, from, warned }. */
const sessions = new Map();

let cycle = 0;

function start(site) {
  const poachers = F();
  const tiles = Common.freeTiles(site, site.location, poachers.range, site.size);
  if (tiles.length < 4) return null;
  const event = {
    site,
    elapsed: 0,
    traps: new Set(),
    set: 0,
    nextTrap: Common.randomInt(...poachers.firstTrap),
    foxHp: poachers.foxHp,
    foxHome: tiles[0].clone(),
    disarmers: new Set(),
    arming: new Set(),
    /** Poacher -> the cycle of their last line, so none says two in a tick. */
    spoke: new Map(),
    over: false,
  };
  const { sounds, wander } = poachers;
  event.fox = Common.spawnNpc(poachers.npcs.fox, tiles[0], poachers.graphics.spawn);
  event.fox.setCrawling?.(true);
  Common.areaSound(tiles[0], sounds.spawn, sounds.spawnRadius);
  Common.areaSound(tiles[0], sounds.foxSpawn, sounds.spawnRadius);
  event.poachers = poachers.npcs.poachers.map((id, i) => {
    const npc = Common.spawnNpc(id, tiles[i + 1], poachers.graphics.spawn, wander.poachers);
    Common.animate(npc, poachers.seqs.spawn);
    Common.areaSound(tiles[i + 1], sounds.spawn, sounds.spawnRadius);
    Common.areaSound(tiles[i + 1], sounds.poacherSpawn, sounds.spawnRadius, sounds.poacherSpawnDelay);
    return npc;
  });
  events.add(event);
  Common.every(() => tick(event));
  return event;
}

const trapAt = (event, tile) => [...event.traps].find((trap) => trap.at.equals(tile));
const quiet = (event, npc) => event.spoke.get(npc) !== cycle;

/** A poacher's line (each says one a tick). */
function say(event, npc, text) {
  event.spoke.set(npc, cycle);
  npc.forceChat?.(text);
}

/** A poacher stops and arms a trap; it lands on their tile `armTicks` later. */
function arm(event) {
  const poachers = F();
  const free = event.poachers.filter((npc) => !event.arming.has(npc) && quiet(event, npc) && !trapAt(event, npc.getLocation()));
  if (!free.length) return;
  const poacher = Common.pick(free);
  event.arming.add(poacher);
  poacher.getMovementQueue?.().reset();
  poacher.getMovementQueue?.().setBlockMovement?.(true);
  Common.animate(poacher, poachers.seqs.arm);
  say(event, poacher, Common.pick(poachers.chatter));
  event.set++;
  Common.later(poachers.armTicks, () => placeTrap(event, poacher));
}

function placeTrap(event, poacher) {
  event.arming.delete(poacher);
  poacher.getMovementQueue?.().setBlockMovement?.(false);
  if (event.over) return;
  const poachers = F();
  const at = poacher.getLocation().clone();
  if (trapAt(event, at)) return;
  const npc = Common.spawnNpc(poachers.npcs.trap, at);
  Common.tileGraphic(at, poachers.graphics.trapSet);
  Common.areaSound(at, poachers.sounds.trapSet, poachers.sounds.trapSetRadius);
  event.traps.add({ npc, at, foxSince: null, disarming: false });
}

function spring(event, trap) {
  const poachers = F();
  event.traps.delete(trap);
  Common.animate(trap.npc, poachers.seqs.trapSprung);
  Common.later(1, () => {
    for (const id of poachers.sounds.sprung) Common.areaSound(trap.at, id, poachers.sounds.sprungRadius);
  });
  Common.later(2, () => Common.removeNpc(trap.npc));
  Common.animate(event.fox, poachers.seqs.foxDefend);
  const damage = Common.randomInt(...poachers.springDamage);
  event.foxHp = Math.max(0, event.foxHp - damage);
  event.fox.showHitsplat?.(damage, { mine: poachers.hitsplat, others: poachers.hitsplat }, { current: event.foxHp, max: poachers.foxHp });
  if (event.foxHp <= 0) end(event, false);
}

/** The fox's next tile towards `dest`: the closest walkable neighbour that gets it nearer, or null. */
function stepTowards(fox, dest) {
  const at = fox.getLocation();
  const queue = fox.getMovementQueue?.();
  const far = (x, y) => [Math.max(Math.abs(dest.getX() - x), Math.abs(dest.getY() - y)), Math.abs(dest.getX() - x) + Math.abs(dest.getY() - y)];
  const [now, nowSum] = far(at.getX(), at.getY());
  let best = null;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if ((!dx && !dy) || !queue?.canWalk(dx, dy)) continue;
      const [d, sum] = far(at.getX() + dx, at.getY() + dy);
      if (d > now || (d === now && sum >= nowSum)) continue;
      if (!best || d < best.d || (d === best.d && sum < best.sum)) best = { d, sum, dx, dy };
    }
  }
  return best ? at.transform(best.dx, best.dy) : null;
}

/** Every `foxStepTicks`: a tile towards the oldest trap, or now and then a roam about its spawn. */
function moveFox(event) {
  const poachers = F();
  const fox = event.fox;
  if (trapAt(event, fox.getLocation())) return;
  const [target] = event.traps;
  let next = null;
  if (target) next = stepTowards(fox, target.at);
  else if (Math.random() < poachers.foxRoamChance) {
    const roam = poachers.wander.fox;
    next = stepTowards(fox, event.foxHome.transform(Common.randomInt(-roam, roam), Common.randomInt(-roam, roam)));
  }
  if (!next) return;
  const queue = fox.getMovementQueue();
  queue.reset();
  queue.addSteps(next);
}

/** A trap the fox has stood on for `springDelay` ticks springs, unless it's being disarmed. */
function checkSprings(event) {
  const poachers = F();
  const foxAt = event.fox.getLocation();
  for (const trap of [...event.traps]) {
    if (trap.disarming || !trap.at.equals(foxAt)) {
      trap.foxSince = null;
      continue;
    }
    trap.foxSince ??= event.elapsed;
    if (event.elapsed - trap.foxSince >= poachers.springDelay) spring(event, trap);
    if (event.over) return;
  }
}

function tick(event) {
  if (event.over) return false;
  event.elapsed++;
  const poachers = F();
  if (event.elapsed >= poachers.lifeTicks) {
    end(event, true);
    return false;
  }
  checkSprings(event);
  if (event.over) return false;
  if (event.elapsed >= event.nextTrap && event.set < poachers.maxTraps) {
    arm(event);
    event.nextTrap = event.elapsed + Common.randomInt(...poachers.trapEvery);
  }
  if (event.elapsed % poachers.foxStepTicks === 0) moveFox(event);
  return true;
}

function end(event, saved) {
  if (event.over) return;
  event.over = true;
  events.delete(event);
  const poachers = F();
  const { sounds } = poachers;
  for (const trap of event.traps) Common.removeNpc(trap.npc);
  event.traps.clear();
  for (const [player, session] of sessions) if (session.event === event) sessions.delete(player);
  event.poachers.forEach((npc, i) => {
    npc.forceChat?.(Common.message(i === 1 ? "poacherLeaving" : "poachersLeaving"));
    Common.animate(npc, poachers.seqs.leave, 30);
  });
  Common.areaSound(event.site.location, sounds.leave, sounds.leaveRadius);
  Common.areaSound(event.site.location, sounds.leaveLate, sounds.leaveRadius, sounds.leaveLateDelay);
  Common.tileGraphic(event.fox.getLocation(), poachers.graphics.leave);
  Common.later(1, () => {
    for (const npc of [...event.poachers, event.fox]) Common.removeNpc(npc);
  });
  const players = new Set([...event.site.participants, ...event.disarmers]);
  for (const player of players) {
    if (!saved) {
      player.sendMessage(Common.message("foxLost"));
      continue;
    }
    const gift = event.site.participants.has(player) && event.disarmers.has(player);
    player.sendMessage(Common.message(gift ? "foxSaved" : "foxSavedNoGift"));
    Common.sound(player, sounds.saved);
    if (gift) Common.later(1, () => foxGift(player));
  }
  Spawns.ended(event);
}

/** The tick after the saved line: the lump and the bonus. */
function foxGift(player) {
  const poachers = F();
  Common.bark(player, poachers.lump, true);
  Common.xp(player, "WOODCUTTING", poachers.xp.bonusBase + poachers.xp.bonusPerLevel * Common.level(player, "WOODCUTTING"));
}

function trapOf(npc) {
  for (const event of events) {
    for (const trap of event.traps) if (trap.npc === npc) return { event, trap };
  }
  return null;
}

function disarm({ player, npc }) {
  const found = trapOf(npc);
  if (!found) return false;
  const { event, trap } = found;
  if (trap.disarming) return true;
  const previous = sessions.get(player);
  if (previous) previous.trap.disarming = false;
  trap.disarming = true;
  const poachers = F();
  Common.spam(player, Common.message("startDisarm"));
  Common.sound(player, poachers.sounds.disarm);
  Common.animate(player, poachers.seqs.disarm);
  player.setPositionToFace?.(npc.getLocation());
  sessions.set(player, { event, trap, done: cycle + poachers.disarmTicks, from: player.getLocation().clone(), warned: false });
  return true;
}

/** A tick before the end: the trap's disarm seq, and a poacher grumbles. */
function trapGives(session) {
  const poachers = F();
  session.warned = true;
  Common.animate(session.trap.npc, poachers.seqs.trapDisarmed);
  const { event } = session;
  const quietOnes = event.poachers.filter((npc) => quiet(event, npc));
  if (quietOnes.length) say(event, Common.pick(quietOnes), Common.pick(poachers.annoyed));
}

function disarmed(player, session) {
  const { event, trap } = session;
  const poachers = F();
  event.traps.delete(trap);
  if (!session.warned) trapGives(session);
  Common.animate(player, poachers.seqs.disarmEnd);
  Common.later(1, () => Common.removeNpc(trap.npc));
  Common.spam(player, Common.message("disarmed"));
  Common.sound(player, poachers.sounds.disarm);
  event.disarmers.add(player);
  if (!Spawns.eligible(event, player)) {
    Common.xp(player, "WOODCUTTING", 1);
    return;
  }
  Common.xp(player, "WOODCUTTING", Common.level(player, "WOODCUTTING") * poachers.xp.woodcutting);
  Common.xp(player, "HUNTER", Common.level(player, "HUNTER") * poachers.xp.hunter);
  Common.later(1, () => Common.bark(player, poachers.trapBark));
}

/** A disarm takes 9 ticks with the player kept still; walking off leaves the trap to spring. */
function disarmTick() {
  cycle++;
  for (const [player, session] of sessions) {
    const { event, trap } = session;
    if (event.over || !event.traps.has(trap)) {
      sessions.delete(player);
      continue;
    }
    if (!player.isRegistered?.() || !player.getLocation().equals(session.from)) {
      trap.disarming = false;
      sessions.delete(player);
      continue;
    }
    if (cycle === session.done - 1) trapGives(session);
    if (cycle < session.done) continue;
    sessions.delete(player);
    disarmed(player, session);
  }
}

function forget({ player }) {
  const session = sessions.get(player);
  if (session) session.trap.disarming = false;
  sessions.delete(player);
}

function attachPoachers(api) {
  Spawns.registerEvent("poachers", { start });
  api.onNpcInteraction("<col=00ffff>Fox trap</col>", { Disarm: disarm });
  api.onPlayerLogout(forget);
  Common.every(disarmTick);
}

module.exports = { attachPoachers, start, disarm, disarmTick, end, events, sessions };
