const Common = require("./Common.Leviathan");
const Model = require("./Model.Leviathan");
const IGNORE_CLIPPING_FLAG = "movement:ignore-clipping";
const ADJACENT = [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [1, -1], [-1, -1], [-1, 1]];

class Hazards {
  constructor(fight) {
    this.fight = fight;
    this.session = fight.session;
    this.blockers = new Set();
    this.smokeCover = new Set();
    this.objects = new Map();
    this.originalClip = new Map();
    this.floor = new Set();
    this.pathfinder = null;
    this.tornado = null;
    this.pathCentre = null;
    this.pathNext = null;
    this.firstRoar = true;
    const { west, east, south, north } = Common.data.arena;
    for (let x = west; x <= east; x++) for (let y = south; y <= north; y++) {
      if ((this.session.area.getClip(this.session.tile([x, y])) & Common.core.RegionManager.BLOCKED_MASK) === 0) this.floor.add(Model.key([x, y]));
    }
  }
  playerTile() { return this.session.sourceTile(this.fight.player.getLocation()).slice(0, 2); }
  open(tile) { return this.floor.has(Model.key(tile)) && !this.blockers.has(Model.key(tile)); }
  nearPool(at = this.playerTile()) {
    return Model.distance(at, Common.data.arena.centre) <= 6 && ADJACENT.some(([dx, dy]) =>
      !this.floor.has(Model.key([at[0] + dx, at[1] + dy])));
  }
  graphic(tile, name) { Common.tileGraphic(this.fight.player, this.session.area, tile, name); }
  place(tile, rotation = 0) {
    const key = Model.key(tile);
    if (!this.floor.has(key) || this.blockers.has(key)) return false;
    const { GameObject, ObjectManager, RegionManager } = Common.core;
    const at = this.session.tile(tile);
    const before = this.session.area.getClip(at);
    this.originalClip.set(key, before);
    const object = new GameObject(Common.ids.locs.debris, at, 10, rotation, this.session.area);
    ObjectManager.register(object, true);
    RegionManager.addClipping(at.getX(), at.getY(), at.getZ(), RegionManager.BLOCKED_TILE, this.session.area);
    this.objects.set(key, object);
    this.blockers.add(key);
    return true;
  }
  drop(tile, permanent = true, delay = Common.data.inferred.debrisFlightTicks) {
    if (!this.floor.has(Model.key(tile))) return;
    const target = [...tile];
    const smokeRock = permanent && !this.fight.awakened;
    if (!this.fight.awakened) Common.tileProjectile(this.fight, target, delay, smokeRock ? 'smokeBoulder' : 'debris');
    else this.graphic(target, "debris");
    this.fight.at(delay, () => {
      if (!this.fight.alive()) return;
      this.graphic(target, smokeRock ? 'smokeBoulderImpact' : this.fight.awakened ? 'debrisImpact' : 'lightning');
      if (Model.key(this.playerTile()) === Model.key(target)) Common.damage(this.fight, Common.random(0, Common.data.damage.debris));
      if (permanent && this.place(target)) this.smokeCover.add(Model.key(target));
    });
  }
  dropRoar(tile) {
    if (!this.floor.has(Model.key(tile))) return;
    const target = [...tile], rotation = Common.random(0, 3);
    // The falling-stay animation includes its own impact. Its variant matches
    // the permanent rubble rotation; roar rocks are not smoke-bomb projectiles.
    Common.tileGraphic(this.fight.player, this.session.area, target, `roarRubble${rotation}`, Common.data.roar.graphicDelayCycles);
    this.fight.at(Common.data.roar.flightTicks, () => {
      if (!this.fight.alive()) return;
      if (Model.key(this.playerTile()) === Model.key(target)) Common.damage(this.fight, Common.random(0, Common.data.damage.debris));
      this.place(target, rotation);
    });
  }
  roar() {
    const tile = this.playerTile();
    this.dropRoar(tile);
    if (this.fight.awakened) for (const [dx, dy] of ADJACENT.slice(0, 4)) this.dropRoar([tile[0] + dx, tile[1] + dy]);
    // The first roar's side debris previews which alternating special comes first.
    if (!this.firstRoar) return;
    this.firstRoar = false;
    for (const [west, south, east, north] of Common.data.roar.tellRegions[this.fight.nextSpecial])
      this.dropRoar([Common.random(west, east), Common.random(south, north)]);
  }
  lightning() {
    const fight = this.fight, { inferred } = Common.data;
    // Normal Wiki and 2024 footage measure this envelope from the applied rear
    // punishment, where beginSpecial is called. Frame-derived boundaries retain
    // a one-tick uncertainty; see the evidence ledger, not packet-exact claims.
    const schedule = fight.awakened ? {
      firstWarningTicks: 1, pulses: inferred.lightningDurationTicks,
      endAnimationTicks: inferred.lightningDurationTicks + inferred.lightningDelayTicks + 1,
      endTicks: inferred.lightningDurationTicks + inferred.lightningDelayTicks + 1,
    } : Common.data.normalLightning;
    Common.animate(fight.boss, "lightning");
    if (schedule.loopStartTicks) fight.at(schedule.loopStartTicks, () => {
      if (fight.alive() && fight.special === 'lightning') Common.animate(fight.boss, 'lightningLoop');
    });
    for (let pulse = 0; pulse < schedule.pulses; pulse++) fight.at(schedule.firstWarningTicks + pulse, () => {
      if (!fight.alive() || fight.special !== "lightning") return;
      const target = this.playerTile();
      this.graphic(target, "lightningGround");
      const delay = fight.player.getHitpoints() <= 25 ? Math.max(1, inferred.lightningDelayTicks - 1) : inferred.lightningDelayTicks;
      fight.at(delay, () => {
        if (!fight.alive()) return;
        this.graphic(target, "lightning");
        if (Model.key(this.playerTile()) === Model.key(target)) Common.damage(fight, Common.random(0, Common.data.damage.lightning));
      });
      if (fight.awakened) {
        const tiles = [...this.floor].map(key => key.split(',').map(Number)).filter(at => Model.distance(at, Common.data.arena.centre) > 6);
        if (tiles.length) this.drop(Common.pick(tiles), false, delay);
      }
    });
    if (!fight.awakened) {
      // Ordinary clips show five separated cyan trajectories per repeated
      // burst, with an approximately six-tick cadence/eight-tick flight. The
      // filmed boundary uncertainty and unmeasured arc are in the ledger.
      for (let tick = schedule.firstWarningTicks; tick < schedule.firstWarningTicks + schedule.pulses; tick += schedule.sideIntervalTicks)
        fight.at(tick, () => {
          if (!fight.alive() || fight.special !== 'lightning') return;
          const tiles = [...this.floor].map(key => key.split(',').map(Number)).filter(at => !this.nearPool(at));
          if (tiles.length) for (let orb = 0; orb < schedule.sideOrbs; orb++)
            this.drop(Common.pick(tiles), false, schedule.sideFlightTicks);
        });
    }
    fight.at(schedule.endAnimationTicks, () => {
      if (fight.alive() && fight.special === "lightning") Common.animate(fight.boss, "lightningEnd");
    });
    fight.at(schedule.endTicks, () => {
      if (fight.alive() && fight.special === "lightning") fight.endSpecial();
    });
  }
  smoke() {
    const fight = this.fight;
    // Only rocks landed during this rain shelter the subsequent blast. Roar
    // rubble and previous smoke waves remain collision blockers, not cover.
    this.smokeCover.clear();
    const schedule = fight.awakened ? {
      startTicks: 0, firstThrowTicks: 1, chargeTicks: 13, blastTicks: 13, endTicks: 13,
    } : Common.data.normalSmoke;
    if (schedule.startTicks) {
      Common.animate(fight.boss, 'roar');
      fight.at(schedule.startTicks, () => {
        if (fight.alive() && fight.special === 'smoke') Common.animate(fight.boss, 'smoke');
      });
    } else Common.animate(fight.boss, 'smoke');
    // Ten aimed rocks, one per tick, taking two ticks to reach the marked tile.
    for (let rock = 0; rock < 10; rock++) fight.at(schedule.firstThrowTicks + rock, () => {
      if (fight.alive() && fight.special === 'smoke') { Common.animate(fight.boss, "smokeLoop"); this.drop(this.playerTile()); }
    });
    // The five-tick explosion sequence charges before the visible blast and
    // finishes afterward. Starting it on the damage tick cut off both stages.
    fight.at(schedule.chargeTicks, () => {
      if (fight.alive() && fight.special === 'smoke') Common.animate(fight.boss, 'smokeBlast');
    });
    fight.at(schedule.blastTicks, () => {
      if (!fight.alive() || fight.special !== 'smoke') return;
      this.graphic(Common.data.arena.centre, "smoke");
      if (!Model.covered(Common.data.arena.centre, this.playerTile(), fight.awakened ? this.blockers : this.smokeCover))
        Common.damage(fight, Common.random(0, fight.stats.smokeMax));
    });
    fight.at(schedule.endTicks, () => {
      if (fight.alive() && fight.special === 'smoke') fight.endSpecial();
    });
  }
  spawnPathfinder() {
    const corners = Common.data.arena.pathCorners;
    this.pathIndex = corners.findIndex(([cx, cy]) => {
      // The registered normal actor can overlap neighboring rubble. Only its
      // centre tile selects another corner (Wiki test and original packets).
      if (!this.fight.awakened) return this.open([cx, cy]);
      for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++)
        if (!this.open([x, y])) return false;
      return true;
    });
    if (this.pathIndex < 0) this.pathIndex = 0;
    this.pathCentre = [...corners[this.pathIndex]];
    this.pathfinder = this.session.spawn(Common.ids.npcs.pathfinder, [this.pathCentre[0] - 1, this.pathCentre[1] - 1]);
    this.pathfinder?.setScriptedMovement(true);
    this.pathfinder?.setFlag(Common.core.NPC.WALK_THROUGH_ENTITIES_FLAG, true);
    this.pathNext = this.fight.tick + Common.data.pathfinder.spawnDelayTicks;
    this.pathfinder?.setFlag(IGNORE_CLIPPING_FLAG, true);
    this.pathDestination = (this.pathIndex + 1) % corners.length;
    if (this.pathfinder) Common.animate(this.pathfinder, 'pathfinderSpawn');
  }
  pathReady() { return !!this.pathfinder?.isRegistered?.(); }
  pathfinderCentre() {
    const origin = this.session.sourceTile(this.pathfinder.getLocation());
    return [origin[0] + 1, origin[1] + 1];
  }
  inAura() { return this.pathReady() && Model.inAura(this.pathfinderCentre(), this.playerTile(), this.fight.awakened); }
  // Awakened entry remains disabled: preserve its previous provisional pursuit.
  stepTornadoToward(from, to) {
    const dx = Math.sign(to[0] - from[0]), dy = Math.sign(to[1] - from[1]);
    const candidates = [[dx, dy], [dx, 0], [0, dy], ...ADJACENT].filter(([x, y]) => x || y)
      .map(([x, y]) => [from[0] + x, from[1] + y]);
    return candidates.find(at => this.open(at) && Model.distance(at, to) < Model.distance(from, to)) ?? from;
  }
  spawnTornado() {
    if (this.tornado) return;
    this.tornadoTile = [...Common.data.arena.tornadoSpawn];
    this.tornado = this.session.spawn(Common.ids.npcs.tornado, this.tornadoTile);
    this.tornado?.setScriptedMovement(true);
    this.tornado?.performGraphic(Common.graphic("tornado"));
    this.tornadoNext = this.fight.tick + Common.data.inferred.tornadoStepTicks;
    this.tornadoHitAt = 0;
  }
  process() {
    const fight = this.fight;
    // Native packets refresh a thirty-client-cycle tint while the player is
    // inside the registered actor's actual aura. Leaving simply lets it expire.
    if (this.inAura()) fight.player.tint(Common.data.pathfinder.auraTint);
    if (this.pathReady() && fight.tick >= this.pathNext) {
      this.pathCentre = this.pathfinderCentre();
      const corners = Common.data.arena.pathCorners;
      if (Model.key(this.pathCentre) === Model.key(corners[this.pathDestination]))
        this.pathDestination = (this.pathDestination + 1) % corners.length;
      const target = corners[this.pathDestination];
      // RSProx shows cardinal walk steps along this rectangle, including through
      // debris. Keep the ordinary walk update instead of an exact-move mask.
      const next = [this.pathCentre[0] + Math.sign(target[0] - this.pathCentre[0]),
        this.pathCentre[1] + Math.sign(target[1] - this.pathCentre[1])];
      const movement = this.pathfinder.getMovementQueue();
      movement.reset();
      movement.addSteps(this.session.tile([next[0] - 1, next[1] - 1]));
      this.pathCentre = next;
      this.pathNext = fight.tick + Common.data.pathfinder.stepTicks;
    }
    if (fight.awakened && fight.boss.getHitpoints() <= fight.stats.hitpoints / 2) this.spawnTornado();
    if (this.tornado && fight.tick >= this.tornadoNext) {
      this.tornadoTile = this.stepTornadoToward(this.tornadoTile, this.playerTile());
      this.tornado.exactMove(this.session.tile(this.tornadoTile));
      this.tornadoNext = fight.tick + Common.data.inferred.tornadoStepTicks;
    }
    if (this.tornado && Model.key(this.tornadoTile) === Model.key(this.playerTile()) && fight.tick >= this.tornadoHitAt) {
      Common.damage(fight, Common.data.damage.tornado);
      this.tornadoHitAt = fight.tick + Common.data.inferred.tornadoStepTicks;
    }
  }
  clear() {
    for (const [key, object] of this.objects) {
      Common.core.ObjectManager.deregister(object, true);
      this.session.area.setClip(object.getLocation(), this.originalClip.get(key));
    }
    this.objects.clear(); this.originalClip.clear(); this.blockers.clear(); this.smokeCover.clear();
    for (const npc of [this.pathfinder, this.tornado]) if (npc) {
      if (npc.getPrivateArea() === this.session.area) this.session.area.remove(npc);
      Common.api.removeNpc(npc);
    }
    this.pathfinder = null; this.pathCentre = null; this.tornado = null;
    this.pathNext = null;
  }
}
module.exports = { Hazards };
