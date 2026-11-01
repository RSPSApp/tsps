"use strict";

/**
 * Tempoross' attacks, which hurt nobody but cost fish and tools.
 *
 * Captures (552, 1858; ticks from the warning):
 * - wave: "A colossal wave closes in..." (red), Tempoross 10573 with seq 8902; +2 script 4068
 *   (300) and sound 4038; +4 the hosts: "Tempoross is drawing in water, prepare yourselves!";
 *   +13 the hit: tethered players get "...the rope keeps you securely upright as the wave washes
 *   over you.", Tempoross is 10572 again with seq 8897, water splashes (1843) leave debris.
 * - lightning: "A strong wind blows as clouds roll in..." (red), a cloud shadow (41006) and
 *   sound 2186 under each strike; clouds grow at +6, charge at +11, Tempoross casts
 *   (`fsb_lightening_cast`) at +13, the clouds strike at +15 (NPC 10581,
 *   sound 4433) and at +16 each strike tile burns: Fire NPC 8643, spotanim 1840, loc 37582,
 *   sound 159. A fire spreads 40 ticks later with projectile 1839, twice at most.
 * - torrent: seq 8903, spotanim 1841 at Tempoross and projectile 1842 to a cannon, which is
 *   disabled from +6 for 24 ticks.
 * The attacks first come ~49 ticks after Tempoross surfaces, then every 50-55 ticks, wave and
 * lightning in turn. Wiki: none at or below 10% energy; a wave puts out every fire; standing in a
 * fire costs items every 2 ticks; dousing gives 40 points.
 */

const Shared = require("./Shared.Tempoross");
const { coveOf, coveOfNpc } = require("./Cove.Tempoross");
const { untetherFor } = require("./Tethers.Tempoross");

const { DATA, NPC, LOC, ITEM, ANIM, GFX, SOUND, SCRIPT, LOSABLE } = Shared;
const F = DATA.fight;
const L = F.lightningTicks;

/** The template's bounds, for the flood fill below. */
const TEMPLATE = { minX: 3008, maxX: 3071, minY: 2816, maxY: 2879 };
const FIRE_SIZE = 2;
const SPREAD_STEPS = [[2, 0], [-2, 0], [0, 2], [0, -2]];

class Attacks {
  constructor(fight) {
    this.fight = fight;
    this.cove = fight.cove;
    this.nextAttackAt = -1;
    this.nextTorrentAt = -1;
    this.nextKind = "wave";
    /** { npc, loc, x, y, spreads, spreadAt } by "x,y" of its south-west tile. */
    this.fires = new Map();
    this.pending = [];
    this.debris = [];
    /** Bumped by every wave, so a spread still in the air when it lands doesn't light. */
    this.waves = 0;
  }

  setUp() {}

  stop() {
    for (const task of this.pending) task.stop();
    this.pending = [];
  }

  at(ticks, action) {
    const task = Shared.later(this.fight, ticks, () => {
      this.pending = this.pending.filter((other) => other !== task);
      if (!this.fight.stopped && !this.cove.ended) action();
    });
    this.pending.push(task);
  }

  onSurface() {
    this.nextAttackAt = this.fight.ticks + F.firstAttackTicks;
    this.nextTorrentAt = -1;
  }

  onSubmerge() {
    this.nextAttackAt = -1;
    this.nextTorrentAt = -1;
  }

  tick() {
    const now = this.fight.ticks;
    if (this.fight.calm()) {
      if (this.nextAttackAt >= 0 && now >= this.nextAttackAt) this.nextAttackAt = now + F.lowEnergyCalmTicks;
      return;
    }
    if (this.nextTorrentAt >= 0 && now >= this.nextTorrentAt) {
      this.nextTorrentAt = -1;
      this.torrent();
    }
    if (this.nextAttackAt < 0 || now < this.nextAttackAt) return;
    const cooldown = Shared.randomInt(...F.attackCooldown);
    this.nextAttackAt = now + cooldown;
    if (Math.random() < F.torrentChance) this.nextTorrentAt = now + Math.floor(cooldown / 2) + Shared.randomInt(-5, 5);
    if (this.nextKind === "wave") this.wave();
    else this.lightning();
    this.nextKind = this.nextKind === "wave" ? "lightning" : "wave";
  }

  // ------------------------------------------------------------------ the wave

  wave() {
    const fight = this.fight;
    this.cove.message(`<col=${Shared.RED}>A colossal wave closes in...</col>`);
    fight.setBoss(NPC.BOSS_DRAWING_WATER);
    Shared.animate(fight.boss, ANIM.BOSS_TIDAL_WAVE);
    this.at(2, () => fight.forEachPlayer((player) => {
      player.getPacketSender().sendClientScript(SCRIPT.WAVE_SHOW, F.waveOverlay);
      player.getPacketSender().sendSoundEffect(SOUND.WAVE, 4, 0, 100);
    }));
    this.at(4, () => fight.hostsSay("Tempoross is drawing in water, prepare yourselves!"));
    this.at(F.waveTicks, () => this.waveHits());
  }

  waveHits() {
    const fight = this.fight;
    if (fight.phase !== "surfaced") return;
    fight.setBoss(fight.enraged ? NPC.BOSS_ENRAGED : NPC.BOSS);
    Shared.animate(fight.boss, ANIM.BOSS_SPAWN);
    for (const old of this.debris) this.cove.removeLoc(old);
    this.debris = DATA.cove.debris.map(([x, y]) => {
      this.cove.mapGraphic(GFX.WATER_SPLASH, this.cove.tile([x, y, 0]));
      return this.cove.placeLoc(Shared.pick(LOC.DEBRIS), [x, y], { type: 22 });
    });
    this.cove.sound(SOUND.BOAT);
    fight.forEachPlayer((player) => {
      if (fight.tethers.siteOf(player)) {
        player.sendMessage("...the rope keeps you securely upright as the wave washes over you.");
        fight.addPoints(player, DATA.points.wave);
        return;
      }
      player.getPacketSender().sendClientScript(SCRIPT.WAVE_HIDE, F.waveOverlayHide);
      Shared.stopAction(player);
      loseItems(player, "wave");
    });
    fight.tethers.breakSites();
    this.waves += 1;
    this.clearFires();
    this.at(F.untetherAfterWave, () => {
      for (const player of [...fight.tethers.tethered.keys()]) fight.tethers.untether(player);
    });
  }

  // ------------------------------------------------------------------ lightning and fires

  lightning() {
    const fight = this.fight;
    this.cove.message(`<col=${Shared.RED}>A strong wind blows as clouds roll in...</col>`);
    this.at(L.cast, () => Shared.animate(fight.boss, ANIM.BOSS_LIGHTNING));
    const strikes = this.strikeTiles(Shared.randomInt(...F.strikes));
    for (const tile of strikes) {
      const shadow = this.cove.placeLoc(LOC.LIGHTNING_SHADOW, tile);
      const at = this.cove.tile([...tile, 0]);
      this.cove.areaSound(SOUND.WIND, at, 20);
      const cloud = this.cove.spawnNpc(NPC.CLOUD, tile);
      this.at(L.grow, () => {
        Shared.animate(cloud, ANIM.CLOUD_GROWING);
        this.cove.areaSound(SOUND.CLOUD_CHARGE, at, 20, 120);
      });
      this.at(L.charge, () => Shared.animate(cloud, ANIM.CLOUD_CHARGING));
      this.at(L.strike, () => {
        Shared.animate(cloud, ANIM.CLOUD_ATTACK);
        this.cove.areaSound(SOUND.STRIKE, at, 20);
        const strike = this.cove.spawnNpc(NPC.STRIKE, tile);
        this.at(2, () => this.cove.removeNpc(strike));
      });
      this.at(L.fire, () => {
        this.cove.removeLoc(shadow);
        Shared.animate(cloud, ANIM.CLOUD_SHRINKING);
        if (this.fight.phase !== "over") this.ignite(tile);
      });
      this.at(L.fire + 4, () => this.cove.removeNpc(cloud));
    }
  }

  /** Strike tiles: by the players where possible, the rest anywhere walkable. */
  strikeTiles(count) {
    const chosen = [];
    const free = (tile) => this.burnable(tile) && !chosen.some(([x, y]) => Math.abs(x - tile[0]) < FIRE_SIZE && Math.abs(y - tile[1]) < FIRE_SIZE);
    for (const player of this.fight.players) {
      if (chosen.length >= Math.ceil(count / 2)) break;
      const [px, py] = this.cove.templateTile(player.getLocation());
      const tile = [px + Shared.randomInt(-3, 3), py + Shared.randomInt(-3, 3)];
      if (free(tile)) chosen.push(tile);
    }
    const floor = walkableTiles(this.cove);
    for (let attempt = 0; attempt < 200 && chosen.length < count; attempt++) {
      const tile = Shared.pick(floor);
      if (free(tile)) chosen.push(tile);
    }
    return chosen;
  }

  /** A 2x2 of floor players can reach, with no fire on it. */
  burnable([x, y]) {
    const floor = walkableSet(this.cove);
    for (let dx = 0; dx < FIRE_SIZE; dx++) {
      for (let dy = 0; dy < FIRE_SIZE; dy++) {
        if (!floor.has(`${x + dx},${y + dy}`)) return false;
      }
    }
    for (const fire of this.fires.values()) {
      if (Math.abs(fire.x - x) < FIRE_SIZE && Math.abs(fire.y - y) < FIRE_SIZE) return false;
    }
    return true;
  }

  ignite([x, y], spreads = 0) {
    if (!this.burnable([x, y])) return;
    const npc = this.cove.spawnNpc(NPC.FIRE, [x, y]);
    if (!npc) return;
    Shared.graphic(npc, GFX.FIRE_SPAWN);
    const loc = this.cove.placeLoc(LOC.FIRE_VISUALS, [x, y], { face: Shared.randomInt(0, 3) });
    this.cove.areaSound(SOUND.FIRE, this.cove.tile([x, y, 0]), 5);
    this.fires.set(`${x},${y}`, { npc, loc, x, y, spreads, spreadAt: this.fight.ticks + F.fireSpreadTicks });
  }

  extinguish(fire) {
    this.fires.delete(`${fire.x},${fire.y}`);
    this.cove.removeNpc(fire.npc);
    this.cove.removeLoc(fire.loc);
  }

  fireOf(npc) {
    for (const fire of this.fires.values()) {
      if (fire.npc === npc) return fire;
    }
    return null;
  }

  clearFires() {
    for (const fire of [...this.fires.values()]) this.extinguish(fire);
  }

  clearAll() {
    this.stop();
    this.clearFires();
    this.nextAttackAt = -1;
    this.nextTorrentAt = -1;
  }

  tickFires() {
    if (this.fires.size === 0) return;
    const now = this.fight.ticks;
    for (const fire of [...this.fires.values()]) {
      if (now < fire.spreadAt || fire.spreads >= F.fireSpreads) continue;
      fire.spreadAt = now + F.fireSpreadTicks;
      const step = Shared.pick(SPREAD_STEPS.filter(([dx, dy]) => this.burnable([fire.x + dx, fire.y + dy])));
      if (!step) continue;
      fire.spreads += 1;
      const to = [fire.x + step[0], fire.y + step[1]];
      this.cove.projectile(GFX.FIRE_SPREAD, this.cove.tile([fire.x, fire.y, 0]), this.cove.tile([...to, 0]), {
        cycles: 60, startHeight: 1, endHeight: 0, slope: 30,
      });
      const wave = this.waves;
      this.at(2, () => {
        if (this.waves === wave) this.ignite(to, fire.spreads);
      });
    }
    if (now % F.fireBurnTicks !== 0) return;
    this.fight.forEachPlayer((player) => {
      const [x, y] = this.cove.templateTile(player.getLocation());
      for (const fire of this.fires.values()) {
        if (x >= fire.x && x < fire.x + FIRE_SIZE && y >= fire.y && y < fire.y + FIRE_SIZE) {
          loseItems(player, "fire");
          break;
        }
      }
    });
  }

  /** Script 4074 arguments 11-14: a fire burning in each area, in the tether sites' order. */
  fireFlags() {
    const flags = [0, 0, 0, 0];
    const order = ["north", "west", "east", "south"];
    for (const fire of this.fires.values()) {
      const tile = this.cove.tile([fire.x, fire.y, 0]);
      order.forEach((key, index) => {
        if (this.cove.inBox(DATA.cove.fireAreas[key], tile)) flags[index] = 1;
      });
    }
    return flags;
  }

  // ------------------------------------------------------------------ the torrent

  torrent() {
    const fight = this.fight;
    const crates = fight.cannons.crates.filter((crate) => !fight.cannons.disabled(crate));
    if (crates.length === 0 || !fight.boss) return;
    const loading = crates.filter((crate) => [...fight.players].some((player) => player.__temporossLoading === crate
      && Shared.actionOf(player) === "load"));
    const crate = Shared.pick(loading.length > 0 ? loading : crates);
    Shared.animate(fight.boss, ANIM.BOSS_TORRENT);
    const from = this.cove.tile([...DATA.cove.bossCentre, 0]);
    this.cove.mapGraphic(GFX.TORRENT_CAST, from);
    this.cove.projectile(GFX.TORRENT, from, crate.cannonLoc.getLocation(), { cycles: 120, slope: 127 });
    this.at(F.torrentTicks, () => fight.cannons.disable(crate));
  }
}

/**
 * The tiles a player can walk to from the west ship, found once from the first cove's collision
 * (the sea carries no collision of its own, so open tiles alone would let fires land on it).
 */
let walkable = null;

function walkableSet(cove) {
  if (walkable) return walkable.set;
  const set = new Set();
  const start = DATA.cove.arrival[0];
  const queue = [start];
  set.add(`${start[0]},${start[1]}`);
  while (queue.length > 0) {
    const [x, y] = queue.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      const key = `${nx},${ny}`;
      if (set.has(key) || nx < TEMPLATE.minX || nx > TEMPLATE.maxX || ny < TEMPLATE.minY || ny > TEMPLATE.maxY) continue;
      if (cove.area.getClip(cove.tile([nx, ny, 0])) !== 0) continue;
      set.add(key);
      queue.push([nx, ny]);
    }
  }
  walkable = { set, list: [...set].map((key) => key.split(",").map(Number)) };
  return set;
}

function walkableTiles(cove) {
  walkableSet(cove);
  return walkable.list;
}

/**
 * A wave or fire takes one of the cove's tools and some harpoonfish (Wiki: only those can be
 * lost). The message follows the captured "You lose some <fish> and a <Bucket> to the fire.".
 */
function loseItems(player, cause) {
  const inventory = player.getInventory();
  const parts = [];
  const fish = [ITEM.RAW, ITEM.COOKED, ITEM.CRYSTALLISED].filter((id) => inventory.contains(id));
  if (fish.length > 0) {
    let lost = Shared.randomInt(1, 3);
    for (const id of fish) {
      const take = Math.min(lost, inventory.getAmount(id));
      inventory.delete(id, take);
      lost -= take;
      if (lost <= 0) break;
    }
    parts.push(`some <col=${Shared.RED}>fish</col>`);
  }
  const tools = LOSABLE.filter((tool) => inventory.contains(tool.id));
  if (tools.length > 0) {
    const tool = Shared.pick(tools);
    inventory.delete(tool.id, 1);
    parts.push(`a <col=${Shared.RED}>${tool.name}</col>`);
  }
  if (parts.length === 0) return;
  inventory.refreshItems();
  player.sendMessage(`You lose ${parts.join(" and ")} to the ${cause}.`);
}

function douse(event) {
  const { player, npc } = event;
  const cove = coveOfNpc(npc);
  if (!cove) return false;
  if (coveOf(player) !== cove || !cove.fight) return true;
  untetherFor(player);
  const fire = cove.fight.attacks.fireOf(npc);
  if (!fire) return true;
  if (!player.getInventory().contains(ITEM.BUCKET_OF_WATER)) {
    player.sendMessage("You need a bucket of water to put out the fire.");
    return true;
  }
  Shared.stopAction(player);
  player.setPositionToFace(npc.getLocation());
  Shared.animate(player, ANIM.DOUSE);
  player.getPacketSender().sendSound(SOUND.DOUSE, 100, 0).sendSound(SOUND.DOUSE_2, 100, 0);
  player.getInventory().delete(ITEM.BUCKET_OF_WATER, 1);
  player.getInventory().adds(ITEM.BUCKET, 1);
  player.getInventory().refreshItems();
  player.sendMessage("You extinguish the fire.");
  cove.fight.addPoints(player, DATA.points.douse);
  cove.fight.attacks.extinguish(fire);
  return true;
}

function attachAttacks(api) {
  api.onNpcInteraction("<col=00ffff>Fire</col>", { Douse: douse });
}

module.exports = { Attacks, attachAttacks, loseItems };
