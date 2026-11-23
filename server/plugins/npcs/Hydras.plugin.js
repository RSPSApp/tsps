"use strict";

/**
 * Hydras of the Karuulm Slayer Dungeon in combat, from plugins/npcs/data/hydras.json
 * (docs/hydras.md). The Alchemical Hydra is a different NPC with its own plugin.
 *
 * Wiki (Hydra): Magic and Ranged, max hit 22, every 6 ticks. A hydra "start[s] off with a random
 * combat style" and switches "after three attacks, regardless if they hit or not". Every twelfth
 * attack it spits poison at three random tiles, one of them the player's; that attack "does not count
 * towards the three attacks", and the count isn't reset by leaving combat. The splat is 3x3, and a
 * player standing on a pool takes 4 poison damage every two ticks, 1 to 2 with poison immunity.
 * The animations, projectiles, sounds and flight times are from rsprox captures 1000480 and 1000143.
 */
const fs = require("fs");
const path = require("path");

let api = null;
let DATA = null;
let MethodClass = null;
/** Hydra -> { count, style, run }: its attacks so far, its current style and the attacks made in it. */
const counts = new WeakMap();
/** Pools on the ground: { tile, owner, landed, until }, in world cycles. */
const pools = [];
let poolTask = null;
/** The players a splat hurt this cycle: overlapping splats landing together hurt once. */
const splatHits = { cycle: -1, players: new Set() };

function core() {
  return api.core;
}

function data() {
  DATA ??= JSON.parse(fs.readFileSync(path.join(__dirname, "data", "hydras.json"), "utf8"));
  return DATA;
}

const randomInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

function chebyshev(a, b) {
  return Math.max(Math.abs(a.getX() - b.getX()), Math.abs(a.getY() - b.getY()));
}

function worldCycle() {
  return Number(core().World.getProcessCycle());
}

function isHydra(mobile) {
  return Boolean(mobile?.isNpc?.()) && data().ids.includes(mobile.getId?.());
}

/**
 * The hydra's next attack: "special" on every twelfth, else its style, switched after three of them
 * (Wiki). The first style is random; the count lives on the hydra, so leaving combat keeps it.
 */
function nextAttack(npc) {
  let state = counts.get(npc);
  if (!state) {
    state = { count: 0, style: Math.random() < 0.5 ? "magic" : "ranged", run: 0 };
    counts.set(npc, state);
  }
  state.count++;
  if (state.count % data().specialEvery === 0) return "special";
  if (state.run >= data().stylesBeforeSwitch) {
    state.style = state.style === "magic" ? "ranged" : "magic";
    state.run = 0;
  }
  state.run++;
  return state.style;
}

/** A basic flight's end cycle: 40 + 5 a tile from the hydra's south-west tile (rsprox 1000480). */
function flightEnd(npc, location) {
  const { endBase, endPerTile } = data().flight;
  return endBase + endPerTile * chebyshev(npc.getLocation(), location);
}

/** The tick a flight lands, in whole ticks after it is sent (a 60-cycle flight hits 2 ticks on). */
function landingTicks(end) {
  return Math.max(1, Math.floor(end / 30));
}

/** Players who see and hear the hydra's tile effects: its plane and instance, within 32 tiles. */
function viewers(npc, location) {
  const area = npc.getPrivateArea?.() ?? null;
  const out = [];
  for (const player of core().World.getPlayers()) {
    if (!player || (player.getPrivateArea?.() ?? null) !== area) continue;
    const at = player.getLocation();
    if (at.getZ() !== location.getZ() || chebyshev(at, location) > 32) continue;
    out.push(player);
  }
  return out;
}

function areaSound(npc, sound, location, delay) {
  core().Sounds.playAreaSound({
    soundId: sound.id, x: location.getX(), y: location.getY(), level: location.getZ(),
    loops: 1, delay, radius: sound.range, source: npc,
  });
}

function tileGraphic(npc, id, location, delay = 0) {
  const graphic = core().Graphic.delayed(id, delay, 0);
  for (const player of viewers(npc, location)) player.getPacketSender().sendGraphic(graphic, location);
}

function send(npc, from, to, lockon, projectile, end) {
  const { Projectile } = core();
  new Projectile(from, to, lockon, projectile.id, projectile.start, end, projectile.startHeight,
    projectile.endHeight, npc.getPrivateArea?.() ?? null)
    .withSource(npc).withAngle(projectile.angle).withProgress(projectile.progress).sendProjectile();
}

/** A magic or ranged attack from the hydra's centre; returns the hit delay. */
function shoot(npc, target, style) {
  const { projectile, sound } = data().styles[style];
  const at = target.getLocation();
  const end = flightEnd(npc, at);
  send(npc, core().Projectile.centreOf(npc), at, target, projectile, end);
  areaSound(npc, sound, at, end);
  return landingTicks(end);
}

/** Runs `action` `ticks` ticks from now. */
function later(ticks, action) {
  const { Task, TaskManager } = core();
  TaskManager.submit(new (class HydraDelay extends Task {
    constructor() {
      super(Math.max(1, ticks), null, false);
    }
    execute() {
      this.stop();
      action();
    }
  })());
}

/** The three tiles: the player's, then two more within the spread of it, all different. */
function splatTiles(base) {
  const { blobs, spread } = data().special;
  const tiles = [base];
  for (let attempt = 0; tiles.length < blobs && attempt < 40; attempt++) {
    const tile = base.transform(randomInt(-spread, spread), randomInt(-spread, spread));
    if (!tiles.some((other) => chebyshev(other, tile) === 0)) tiles.push(tile);
  }
  return tiles;
}

/** Poison immunity halves the pool (Wiki: 1 to 2): an antipoison's protection or content's say-so. */
function poisonImmune(player) {
  const clock = player.getCombat?.()?.getPoisonClock?.();
  if (clock && !clock.finished()) return true;
  const status = { target: player, kind: "poison", allow: true };
  api.emitCustomEvent("combat:status-apply", status);
  return status.allow === false;
}

function poisonDamage(player) {
  const { damage, immuneDamage } = data().special;
  const amount = poisonImmune(player) ? randomInt(immuneDamage[0], immuneDamage[1]) : damage;
  const { HitDamage, HitMask } = core();
  player.getCombat().getHitQueue().addPendingDamage([new HitDamage(amount, HitMask.GREEN)]);
  return amount;
}

function playersNear(npcLike, tile, reach) {
  return viewers(npcLike, tile).filter((player) =>
    chebyshev(player.getLocation(), tile) <= reach && Number(player.getHitpoints?.()) > 0);
}

/** The pools' clock: every other tick from its landing a pool hurts whoever stands on it (Wiki). */
function tickPools() {
  const now = worldCycle();
  const { hurtEvery } = data().special;
  const hurt = new Set();
  for (const pool of pools) {
    if (now <= pool.landed || (now - pool.landed) % hurtEvery !== 0) continue;
    for (const player of playersNear(pool.owner, pool.tile, 0)) {
      if (hurt.has(player)) continue; // overlapping pools hurt once
      hurt.add(player);
      poisonDamage(player);
    }
  }
  for (let i = pools.length - 1; i >= 0; i--) if (now >= pools[i].until) pools.splice(i, 1);
  if (pools.length === 0 && poolTask) {
    poolTask.stop();
    poolTask = null;
  }
}

function startPoolClock() {
  if (poolTask) return;
  const { Task, TaskManager } = core();
  poolTask = new (class HydraPools extends Task {
    constructor() {
      super(1, null, false);
    }
    execute() {
      tickPools();
    }
  })();
  TaskManager.submit(poolTask);
}

/** A blob lands: the 3x3 splat hurts once, then the pool settles on its tile. */
function land(npc, tile) {
  const special = data().special;
  const angle = randomInt(0, special.landing.length - 1);
  tileGraphic(npc, special.landing[angle], tile);
  // Ours: the Wiki gives the splat's area (3x3) but no damage; it deals the pool's.
  const now = worldCycle();
  if (splatHits.cycle !== now) {
    splatHits.cycle = now;
    splatHits.players.clear();
  }
  for (const player of playersNear(npc, tile, 1)) {
    if (splatHits.players.has(player)) continue;
    splatHits.players.add(player);
    poisonDamage(player);
  }
  // Timed by the world's cycle, not by the pool task: a blob landing before the task runs this tick keeps its schedule.
  pools.push({ tile, owner: npc, landed: now, until: now + special.poolTicks });
  startPoolClock();
  later(1, () => tileGraphic(npc, special.landed[angle], tile));
}

/** The middle head spits poison at three tiles, the first the player's (Wiki; rsprox 1000143 tick 215). */
function spitPoison(npc, target) {
  const special = data().special;
  const from = core().Projectile.centreOf(npc);
  for (const tile of splatTiles(target.getLocation())) {
    const end = special.projectile.endBase + special.projectile.endPerTile * chebyshev(from, tile);
    send(npc, from, tile, null, special.projectile, end);
    tileGraphic(npc, special.splash, tile, end);
    areaSound(npc, special.sound, tile, end);
    later(landingTicks(end), () => land(npc, tile));
  }
}

/** The combat method; the provider makes one per attack, so the style lives only for that attack. */
function method() {
  if (MethodClass) return MethodClass;
  const { CombatMethod, CombatType, PendingHit, Animation } = core();
  MethodClass = class HydraCombatMethod extends CombatMethod {
    constructor() {
      super();
      this.style = null;
      this.delay = 2;
    }

    type() {
      return this.style === "magic" ? CombatType.MAGIC : CombatType.RANGED;
    }

    /** Ours: no source states its reach; rsprox 1000480 has shots from 10 tiles of its footprint. */
    attackDistance() {
      return data().attackDistance;
    }

    attackSpeed(character) {
      return character.getCurrentDefinition?.()?.getAttackSpeed?.() || 6;
    }

    start(character, target) {
      const kind = nextAttack(character);
      if (kind === "special") {
        this.style = null;
        character.performAnimation(new Animation(data().special.anim));
        spitPoison(character, target);
        return;
      }
      this.style = kind;
      character.performAnimation(new Animation(data().styles[kind].anim));
      this.delay = shoot(character, target, kind);
    }

    hits(character, target) {
      if (!this.style) return [];
      return [new PendingHit(character, target, this, this.delay)];
    }
  };
  return MethodClass;
}

/** Clears every pool and its clock (tests). */
function reset() {
  pools.length = 0;
  splatHits.cycle = -1;
  splatHits.players.clear();
  poolTask?.stop();
  poolTask = null;
}

/** "combat:npc-poison": its magic and ranged attacks don't poison; only its spit does (Wiki: "Yes (special attack)"). */
function basicAttackPoison(event) {
  if (isHydra(event?.attacker)) event.handled = true;
}

module.exports = {
  name: "Hydras",
  description: "Karuulm Slayer Dungeon hydras: magic and ranged attacks that switch style every three attacks, and a poison spit every twelfth that leaves pools on three tiles, with the captured animations, projectiles and sounds.",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    pluginApi.registerNpcCombatMethodProvider(data().ids, method(), { singleton: false });
    pluginApi.onCustomEvent("combat:npc-poison", basicAttackPoison);
  },
  _test: { nextAttack, flightEnd, landingTicks, splatTiles, tickPools, land, pools, reset, method, data },
};
