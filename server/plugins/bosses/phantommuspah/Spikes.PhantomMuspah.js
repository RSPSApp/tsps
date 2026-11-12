/**
 * The Phantom Muspah's spikes (docs/phantom-muspah.md), as captured:
 * - A spike is warned of (spot 2335), rises two ticks later (loc muspah_spike_pre, spot 2324) and
 *   stands a tick after that (muspah_spike), blocking its tile until the fight ends. A player on
 *   the tile as it rises is knocked to a free tile beside it (seq 1114, an exact move), hit, and
 *   the Muspah heals 75% of it (Wiki).
 * - Waves: two near the arena's edge as the Muspah appears; at each form switch one beside each
 *   group and one under the player; after the shield, every fourth attack, one under the player
 *   and more beside the groups, so they spread.
 * - Homing spikes: two to four standing spikes, never one beside the player or under the Muspah,
 *   sink (muspah_spike_post, spot 2325) and come back as muspah_spike_follow, stepping a tile every
 *   two ticks towards the player, never diagonally and never through a spike; the tile left clears
 *   a tick later. After 34 ticks, or when the shield goes up, they harden where they are.
 * Tiles here are the lair's own (the template square); the session turns them into the instance.
 */
const CameraShake = require("../../interface/CameraShake.plugin");
const Common = require("./Common.PhantomMuspah");
const Hits = require("./Hits.PhantomMuspah");

const LOC_SHAPE = 10;
const CARDINAL = [[0, 1], [1, 0], [0, -1], [-1, 0]];
const AROUND = [...CARDINAL, [1, 1], [1, -1], [-1, -1], [-1, 1]];
/** A loc's rotation is a random quarter turn (captured: all four). */
const randomRotation = () => Math.floor(Math.random() * 4);
const key = ([x, y]) => `${x},${y}`;

class SpikeField {
  constructor(fight) {
    this.fight = fight;
    this.session = fight.session;
    /** Tile key -> { tile, state: "rising" | "up" | "homing", object, rotation }. */
    this.spikes = new Map();
    this.homing = [];
    this.cleared = false;
  }

  get player() {
    return this.fight.player;
  }

  location([x, y]) {
    return this.session.tile([x, y, 0]);
  }

  /** Whether a spike (rising, standing or homing) is on a lair tile. */
  has(tile) {
    return this.spikes.has(key(tile));
  }

  standing() {
    return [...this.spikes.values()].filter((spike) => spike.state === "up");
  }

  /** A tile a spike may take: on the arena's floor, open, and not under the Muspah. */
  open(tile) {
    if (!Common.onArena(tile) || this.has(tile) || this.fight.underBoss(tile)) return false;
    const { RegionManager } = Common.core;
    return !RegionManager.blocked(this.location(tile), this.session.area);
  }

  place(tile, locId, rotation) {
    const { GameObject, ObjectManager } = Common.core;
    const object = new GameObject(locId, this.location(tile), LOC_SHAPE, rotation, this.session.area);
    ObjectManager.register(object, true);
    return object;
  }

  remove(object) {
    if (!object) return;
    Common.core.ObjectManager.deregister(object, true);
  }

  block(tile, blocked) {
    const { RegionManager } = Common.core;
    const at = this.location(tile);
    if (blocked) RegionManager.addClipping(at.getX(), at.getY(), at.getZ(), RegionManager.BLOCKED_TILE, this.session.area);
    else RegionManager.removeClipping(at.getX(), at.getY(), at.getZ(), RegionManager.BLOCKED_TILE, this.session.area);
  }

  graphic(tile, id) {
    Common.tileGraphic(this.player, this.location(tile), id);
  }

  // ------------------------------------------------------------------ waves

  /** A wave of spikes on lair tiles: warned now, rising in two ticks, standing in three. */
  wave(tiles) {
    const { spikes } = Common.data;
    const unique = [...new Map(tiles.filter(Boolean).map((tile) => [key(tile), tile])).values()];
    const fresh = unique.filter((tile) => !this.has(tile));
    if (fresh.length === 0) return;
    for (const tile of fresh) {
      this.graphic(tile, spikes.warnSpot);
      this.spikes.set(key(tile), { tile, state: "warned", object: null, rotation: randomRotation() });
    }
    this.fight.at(spikes.preTicks, () => {
      for (const tile of fresh) this.rise(tile);
    });
    this.fight.at(spikes.upTicks, () => {
      let stood = false;
      for (const tile of fresh) stood = this.stand(tile) || stood;
      if (stood) this.rumble();
    });
  }

  rise(tile) {
    const spike = this.spikes.get(key(tile));
    if (!spike || spike.state !== "warned" || this.cleared) return;
    // A warned tile isn't solid yet: if the Muspah has walked onto it, the spike doesn't come up.
    if (this.fight.underBoss(tile)) {
      this.spikes.delete(key(tile));
      return;
    }
    const { locs, spikes } = Common.data;
    spike.state = "rising";
    spike.object = this.place(tile, locs.spikePre, spike.rotation);
    this.graphic(tile, spikes.riseSpot);
    if (key(this.playerTile()) === key(tile) && Common.alive(this.player)) this.knock(tile);
    this.block(tile, true);
  }

  stand(tile) {
    const spike = this.spikes.get(key(tile));
    if (!spike || spike.state !== "rising" || this.cleared) return false;
    spike.state = "up";
    spike.object = this.place(tile, Common.data.locs.spike, spike.rotation);
    return true;
  }

  /** The ground shakes as spikes stand (sounds 1678 and 6780, a short camera shake). */
  rumble() {
    const { riseSounds, cameraShake } = Common.data.spikes;
    const { player } = this;
    const sender = player.getPacketSender();
    Common.sounds(player, riseSounds);
    for (const [slot, amount] of cameraShake) CameraShake.send(sender, "combat", slot, amount);
    // On the world's clock, not the fight's: the shake must stop even if the fight ends now.
    Common.later(2, () => player.isRegistered() && sender.sendCameraReset());
  }

  /** Two near the edge as the Muspah appears. */
  spawnWave() {
    const { spawnCount, spawnMinDistance } = Common.data.spikes;
    const candidates = Common.shuffle(Common.arena().tiles)
      .filter(([dx, dy]) => Math.max(Math.abs(dx), Math.abs(dy)) >= spawnMinDistance)
      .map(Common.fromCentre)
      .filter((tile) => this.open(tile));
    const chosen = [];
    for (const tile of candidates) {
      if (chosen.length >= spawnCount) break;
      if (chosen.some((other) => Math.abs(other[0] - tile[0]) + Math.abs(other[1] - tile[1]) < spawnMinDistance)) continue;
      chosen.push(tile);
    }
    this.wave(chosen);
  }

  /** At a form switch: one beside each group of spikes, and one under the player. */
  switchWave() {
    const tiles = this.underPlayer();
    for (const group of this.groups()) {
      const beside = this.besideGroup(group);
      if (beside.length) tiles.push(Common.pick(beside));
    }
    this.wave(tiles);
  }

  /** After the shield, every fourth attack: under the player, and spreading from every group. */
  growthWave() {
    const tiles = this.underPlayer();
    for (const group of this.groups()) {
      const beside = Common.shuffle(this.besideGroup(group));
      tiles.push(...beside.slice(0, Math.max(1, Math.ceil(group.length / 2))));
    }
    this.wave(tiles);
  }

  /** Standing spikes, grouped by touching (8 ways). */
  groups() {
    const left = new Map(this.standing().map((spike) => [key(spike.tile), spike.tile]));
    const groups = [];
    while (left.size) {
      const [first] = left.values();
      left.delete(key(first));
      const group = [first];
      for (let i = 0; i < group.length; i++) {
        for (const [dx, dy] of AROUND) {
          const next = [group[i][0] + dx, group[i][1] + dy];
          if (!left.has(key(next))) continue;
          left.delete(key(next));
          group.push(next);
        }
      }
      groups.push(group);
    }
    return groups;
  }

  besideGroup(group) {
    const seen = new Set();
    const out = [];
    for (const tile of group) {
      for (const [dx, dy] of CARDINAL) {
        const next = [tile[0] + dx, tile[1] + dy];
        if (seen.has(key(next)) || !this.open(next)) continue;
        seen.add(key(next));
        out.push(next);
      }
    }
    return out;
  }

  /** The player's tile, when a spike can come up there (on the arena's floor). */
  underPlayer() {
    const tile = this.playerTile();
    return Common.onArena(tile) && !this.fight.underBoss(tile) ? [tile] : [];
  }

  playerTile() {
    const [x, y] = this.session.lairTile(this.player.getLocation());
    return [x, y];
  }

  // ------------------------------------------------------------------ the knock-back

  /** A spike comes up under the player: knocked aside, hit, and the Muspah heals 75% of it. */
  knock(from) {
    const { player } = this;
    const { knock } = Common.data.spikes;
    const { ForceMovement, ForceMovementTask, TaskManager, Location } = Common.core;
    // Already being thrown aside this tick: one knock-back at a time.
    const to = player.getForceMovement() ? null : this.knockTile(from);
    if (to) {
      const dx = to[0] - from[0];
      const dy = to[1] - from[1];
      // Knocked backwards: facing the spike it was thrown from.
      const direction = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 3 : 1) : (dy > 0 ? 2 : 0);
      const start = player.getLocation().clone();
      TaskManager.submit(new ForceMovementTask(player, 1,
        new ForceMovement(start, new Location(dx, dy, 0), 0, knock.cycles, direction, knock.anim)));
    } else {
      Common.animate(player, knock.anim);
    }
    const dealt = Hits.damage(player, Common.randomInt(knock.minDamage, knock.maxDamage));
    this.fight.spikeHealed(Math.floor(dealt * knock.heal));
  }

  /** A free tile beside `from`, straight sides first. */
  knockTile(from) {
    const sides = [...Common.shuffle(CARDINAL), ...Common.shuffle(AROUND.slice(4))];
    for (const [dx, dy] of sides) {
      const tile = [from[0] + dx, from[1] + dy];
      if (this.open(tile)) return tile;
    }
    return null;
  }

  // ------------------------------------------------------------------ homing spikes

  /** The special: two to four standing spikes sink, and come back homing on the player. */
  startHoming() {
    const { homing } = Common.data;
    const player = this.playerTile();
    const sources = Common.shuffle(this.standing()).filter(({ tile }) =>
      Math.max(Math.abs(tile[0] - player[0]), Math.abs(tile[1] - player[1])) > 1 && !this.fight.underBoss(tile));
    const count = Math.min(sources.length, Common.randomInt(homing.min, homing.max));
    for (const spike of sources.slice(0, count)) {
      this.sink(spike.tile);
      this.fight.at(2, () => this.follow(spike.tile));
    }
  }

  /** A standing spike sinks (muspah_spike_post, spot 2325) and is gone a tick later. */
  sink(tile) {
    const spike = this.spikes.get(key(tile));
    if (!spike) return;
    const { locs, spikes } = Common.data;
    this.spikes.delete(key(tile));
    this.block(tile, false);
    const post = this.place(tile, locs.spikePost, spike.rotation);
    this.graphic(tile, spikes.despawnSpot);
    this.fight.at(1, () => this.remove(post));
  }

  follow(tile) {
    if (this.cleared || this.has(tile)) return;
    const { homing } = Common.data;
    const follower = { tile, state: "homing", object: null, rotation: randomRotation(), until: this.fight.tick + homing.lifetimeTicks, nextStep: this.fight.tick + homing.stepTicks };
    this.spikes.set(key(tile), follower);
    this.homing.push(follower);
    this.showFollower(follower);
    this.block(tile, true);
  }

  showFollower(follower) {
    const { locs, homing } = Common.data;
    follower.object = this.place(follower.tile, locs.spikeFollow, follower.rotation);
    const at = this.location(follower.tile);
    Common.tileGraphic(this.player, at, homing.stepSpot);
    for (const spec of homing.stepSounds) Common.areaSound(this.player, at, spec, homing.soundRadius);
  }

  /** Every tick: homing spikes step, and harden when their time is up. */
  process() {
    if (this.cleared || this.homing.length === 0) return;
    for (const follower of [...this.homing]) {
      if (this.fight.tick >= follower.until) {
        this.harden(follower);
        continue;
      }
      if (this.fight.tick >= follower.nextStep) this.step(follower);
    }
  }

  /** One tile towards the player, never diagonally, never through a spike. */
  step(follower) {
    const { homing } = Common.data;
    follower.nextStep = this.fight.tick + homing.stepTicks;
    const target = this.playerTile();
    const dx = Math.sign(target[0] - follower.tile[0]);
    const dy = Math.sign(target[1] - follower.tile[1]);
    if (dx === 0 && dy === 0) return;
    const horizontalFirst = Math.abs(target[0] - follower.tile[0]) >= Math.abs(target[1] - follower.tile[1]);
    const moves = (horizontalFirst ? [[dx, 0], [0, dy]] : [[0, dy], [dx, 0]]).filter(([mx, my]) => mx !== 0 || my !== 0);
    for (const [mx, my] of moves) {
      const next = [follower.tile[0] + mx, follower.tile[1] + my];
      const onPlayer = key(next) === key(target);
      if (!onPlayer && !this.open(next)) continue;
      if (onPlayer && (this.has(next) || !Common.onArena(next))) continue;
      this.moveFollower(follower, next, onPlayer);
      return;
    }
  }

  moveFollower(follower, next, onPlayer) {
    const old = follower.tile;
    const oldObject = follower.object;
    this.spikes.delete(key(old));
    follower.tile = next;
    this.spikes.set(key(next), follower);
    this.showFollower(follower);
    this.block(next, true);
    if (onPlayer && Common.alive(this.player)) this.knock(next);
    this.fight.at(1, () => {
      this.remove(oldObject);
      if (!this.has(old)) this.block(old, false);
    });
  }

  /** A homing spike stops and stands where it is (spot 2324, then a spike a tick later). */
  harden(follower) {
    const index = this.homing.indexOf(follower);
    if (index >= 0) this.homing.splice(index, 1);
    if (this.spikes.get(key(follower.tile)) !== follower) return;
    const { locs, spikes } = Common.data;
    follower.state = "rising";
    follower.object = this.place(follower.tile, locs.spikePre, follower.rotation);
    this.graphic(follower.tile, spikes.riseSpot);
    this.fight.at(1, () => this.stand(follower.tile));
  }

  hardenAll() {
    for (const follower of [...this.homing]) this.harden(follower);
  }

  /** Whether a line from the centre to a tile passes a spike: the shockwave's shadow. */
  shelters(from, to) {
    const steps = Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1])) * 4;
    for (let i = 1; i < steps; i++) {
      const x = Math.round(from[0] + ((to[0] - from[0]) * i) / steps);
      const y = Math.round(from[1] + ((to[1] - from[1]) * i) / steps);
      if (x === to[0] && y === to[1]) break;
      if (this.has([x, y])) return true;
    }
    return false;
  }

  /** Every spike sinks (the fight is over). */
  clear() {
    if (this.cleared) return;
    this.cleared = true;
    this.homing = [];
    const { locs, spikes } = Common.data;
    for (const spike of this.spikes.values()) {
      this.block(spike.tile, false);
      if (!spike.object) continue;
      const post = this.place(spike.tile, locs.spikePost, spike.rotation);
      Common.tileGraphic(this.player, this.location(spike.tile), spikes.despawnSpot);
      Common.later(1, () => this.remove(post));
    }
    this.spikes.clear();
  }
}

module.exports = { SpikeField };
