/**
 * The mine's hazards, as recorded (rsprox 1858) with the Wiki's maxima
 * (volcanic-mine.json `hazards`):
 *
 * - Lava beasts on the mine floor: 65 HP, a lava bomb (projectile 1403) every 6 ticks whose hit
 *   lands 5 ticks later (Wiki max 18). Fighting one pays a point for each 10 damage, and +3 for the
 *   kill; the next comes 0-20 ticks after one dies.
 * - Earthquakes: "A sudden earthquake strikes the cavern!", then a stalactite on each player's tile
 *   a few ticks later; still there a tick after, it hits.
 * - Meteors from the lava: a blast 8 ticks after the throw, hurting anyone in its 3x3.
 *
 * Lower stability brings earthquakes and meteors more often (Wiki). None come in the lobby, during
 * a collapse or after the eruption.
 */
const Common = require("./Common.VolcanicMine");
const Game = require("./Game.VolcanicMine");

const H = () => Common.data.hazards;

// ------------------------------------------------------------------ lava beasts

let BeastMethod = null;

function beastMethod() {
  if (BeastMethod) return BeastMethod;
  const { Animation, CombatFactory, CombatMethod, CombatType, PendingHit, Projectile } = Common.core;
  BeastMethod = class extends CombatMethod {
    type() {
      return CombatType.RANGED;
    }

    attackSpeed() {
      return H().beast.attackTicks;
    }

    attackDistance() {
      return H().beast.distance;
    }

    start(npc, target) {
      const { beast } = H();
      npc.performAnimation(new Animation(beast.seqs.attack));
      const p = beast.projectile;
      new Projectile(Projectile.centreOf(npc), target.getLocation(), target, p.id, p.delay, p.speed, p.startHeight, p.endHeight, npc.getPrivateArea?.() ?? null)
        .sendProjectile();
    }

    hits(npc, target) {
      const hit = new PendingHit(npc, target, this, H().beast.hitDelay);
      CombatFactory.applyStyleDamage(hit, H().beast.maxHit);
      return [hit];
    }
  };
  return BeastMethod;
}

function beastsWanted(game) {
  return Math.max(1, Math.ceil(game.players.size / H().beast.perPlayers));
}

function spawnBeast(game) {
  if (game.ended || game.phase !== "running" || game.collapsing) return;
  const { beast } = H();
  const [x, y] = beast.tiles[Common.randomInt(0, beast.tiles.length - 1)];
  const at = game.area.at([x, y, beast.plane]);
  const npc = Common.api.spawnNpc({ id: beast.npc, x: at.getX(), y: at.getY(), z: at.getZ(), wanderRadius: 4 });
  if (!npc) return;
  if (!game.beasts) game.beasts = new Set();
  npc.__skipDefaultRespawn = true;
  npc.__volcanicMine = game;
  npc.setMaxHitpoints?.(beast.hp);
  npc.setHitpoints?.(beast.hp);
  game.area.add(npc);
  game.area.spawned.push(npc);
  game.beasts.add(npc);
  Common.animate(npc, beast.seqs.spawn);
}

function tickBeasts(game) {
  const { beast } = H();
  for (const npc of [...game.beasts]) {
    if (!npc.isRegistered?.() && npc.__spawnedAt != null) game.beasts.delete(npc);
  }
  const pending = game.beastsDue ?? 0;
  if (game.beasts.size + pending < beastsWanted(game)) {
    game.beastsDue = pending + 1;
    Common.later(Common.randomInt(...beast.respawn) || 1, () => {
      game.beastsDue = Math.max(0, (game.beastsDue ?? 1) - 1);
      spawnBeast(game);
    });
  }
  // An idle beast picks on the nearest player who can be seen.
  for (const npc of game.beasts) {
    npc.__spawnedAt ??= game.ticks;
    if (npc.getCombat?.().getTarget?.()) continue;
    let nearest = null;
    for (const player of game.players) {
      const here = player.getLocation();
      const there = npc.getLocation();
      if (here.getZ() !== there.getZ()) continue;
      const distance = Math.max(Math.abs(here.getX() - there.getX()), Math.abs(here.getY() - there.getY()));
      if (distance <= beast.distance && (!nearest || distance < nearest[1])) nearest = [player, distance];
    }
    if (nearest) npc.getCombat?.().attack?.(nearest[0]);
  }
}

/** A point for each 10 damage dealt to a beast (recorded), at least one a hit. */
function beastHit(event) {
  const game = event.npc?.__volcanicMine;
  const attacker = event.hit?.getAttacker?.();
  if (!game || !attacker?.isPlayer?.() || !game.players.has(attacker)) return;
  const damage = Math.min(event.hit.getTotalDamage?.() ?? 0, event.npc.getHitpoints?.() ?? Infinity);
  if (damage <= 0) return;
  game.addPoints(attacker, Math.max(1, Math.floor(damage / H().beast.pointsPer)));
}

/** The kill (Wiki): +3 to the killer; the next beast comes later. */
function beastDied(event) {
  const game = event.npc?.__volcanicMine;
  if (!game) return;
  game.beasts.delete(event.npc);
  const killer = event.killer;
  if (killer?.isPlayer?.() && game.players.has(killer)) game.addPoints(killer, H().beast.killPoints);
}

// ------------------------------------------------------------------ earthquakes and meteors

function lowStability(game) {
  return game.stability < 50;
}

function tileGraphic(game, id, tile, delay = 0) {
  const { Graphic } = Common.core;
  for (const player of game.players) player.getPacketSender().sendGraphic(Graphic.delayed(id, delay), tile);
}

function sameTile(a, b) {
  return a.getX() === b.getX() && a.getY() === b.getY() && a.getZ() === b.getZ();
}

function earthquake(game) {
  const { earthquake: quake } = H();
  for (const player of game.players) player.sendMessage(Common.message("earthquake"));
  for (const player of [...game.players]) {
    if (player.getLocation().getZ() > 1) continue;
    Common.later(Common.randomInt(...quake.stalactiteDelay), () => {
      if (game.ended || !game.players.has(player) || game.collapsing) return;
      const tile = player.getLocation().clone?.() ?? player.getLocation();
      tileGraphic(game, quake.graphic, tile);
      Common.later(1, () => {
        if (game.ended || game.collapsing || game.phase !== "running") return;
        if (!game.players.has(player) || !sameTile(player.getLocation(), tile)) return;
        if ((player.getHitpoints?.() ?? 1) <= 0) return;
        Common.hurt(player, Common.randomInt(...quake.damage));
      });
    });
  }
}

/** The nearest lava within `reach` of the player, for the meteor to come from. */
function lavaNear(game, here) {
  const { reach } = H().meteor;
  const lava = Common.data.locs.lava;
  const [hx, hy, hz] = game.area.templateOf(here);
  for (let ring = 1; ring <= reach; ring++) {
    const found = [];
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const tile = [hx + dx, hy + dy, hz];
        if (game.area.getTemplateObjects(game.area.at(tile)).some((o) => o.getId() === lava)) found.push(tile);
      }
    }
    if (found.length) return game.area.at(found[Math.floor(Math.random() * found.length)]);
  }
  return null;
}

function meteor(game, player) {
  const { meteor: m } = H();
  const { Location, Projectile } = Common.core;
  const here = player.getLocation();
  const from = lavaNear(game, here);
  if (!from) return;
  // Recorded: hundreds of blasts and few hits - they land about the player, not on them.
  const spread = m.spread;
  const target = new Location(here.getX() + Common.randomInt(-spread, spread), here.getY() + Common.randomInt(-spread, spread), here.getZ());
  new Projectile(from, target, null, m.projectile, 0, 120, 0, 0, game.area).sendProjectile();
  tileGraphic(game, m.graphic, target, m.blastTicks * 30);
  Common.later(m.blastTicks, () => {
    if (game.ended || game.collapsing) return;
    for (const p of game.players) {
      const at = p.getLocation();
      if (at.getZ() !== target.getZ()) continue;
      if (Math.abs(at.getX() - target.getX()) <= 1 && Math.abs(at.getY() - target.getY()) <= 1) {
        Common.hurt(p, Common.randomInt(...m.damage));
      }
    }
  });
}

function tick(game, since) {
  if (game.quiet) return;
  if (!game.beasts) game.beasts = new Set();
  tickBeasts(game);
  const { earthquake: quake, meteor: m } = H();
  if (since % quake.every === 0 && Math.random() < (lowStability(game) ? quake.lowStabilityChance : quake.chance) * Math.max(1, game.players.size / 5)) {
    earthquake(game);
  }
  if (since % m.every === 0) {
    for (const player of game.players) {
      if (player.getLocation().getZ() > 1) continue;
      if (Math.random() < (lowStability(game) ? m.chance + m.lowStabilityChance : m.chance)) meteor(game, player);
    }
  }
}

/** Pete: "Any creatures in there will cause instability too." */
function instability(game) {
  return -(game.beasts?.size ?? 0) * H().beast.instability;
}

function cleanUp(game) {
  game.beasts?.clear();
}

function attachHazards(api) {
  api.registerNpcCombatMethodProvider([Common.data.hazards.beast.npc], beastMethod(), { singleton: false });
  api.onNpcHitModify(beastHit);
  api.onNpcDeath(beastDied);
  Game.onTick(tick);
  Game.onStability(instability);
  Game.onEnd(cleanUp);
}

module.exports = { attachHazards, earthquake, meteor, spawnBeast, tick, beastHit, beastDied, beastMethod };
