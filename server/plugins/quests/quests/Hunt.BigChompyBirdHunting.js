/** Tick-owned Chompy bait/birds. Mechanics: OSRS Wiki Bloated toad / Chompy bird. */
module.exports = function createChompyHunt(api, callbacks = {}) {
  const { Location, Animation, Graphic, HitDamage, HitMask, RegionManager, World, Task, TaskManager, CacheDefinitions, NpcIdentifiers } = api.core;
  const ROLL_INTERVAL = 25;
  const BAIT_LIFETIME = 100;
  const BIRD_LIFETIME = 100;
  const CARCASS_LIFETIME = 200;
  const MIN_LANDING_DISTANCE = 3;
  const MAX_LANDING_DISTANCE = 10;
  const LEAVING_FLAG = "chompy-hunt:leaving";
  const BLOCKED_LANDING = RegionManager.BLOCKED_MASK;
  const baits = new Map(), birds = new Map(), carcasses = new Map(), departures = new Map();
  let task = null;

  function sequence(name) {
    const id = CacheDefinitions.getSeqId(name);
    if (id == null) throw new Error("Missing Chompy sequence: " + name);
    const seq = CacheDefinitions.getSeq(id);
    const cycles = seq.frameLengths?.reduce((total, length) => total + length, 0)
      || Math.max(0, seq.skeletalEnd - seq.skeletalStart);
    return { id, ticks: Math.max(1, Math.ceil(cycles / 30)) };
  }
  const landing = sequence("chompy_update_fly_down"), leaving = sequence("chompy_update_fly_up");
  const burstGraphic = CacheDefinitions.getSpotanimId("chompy_toad_exploding");
  if (burstGraphic == null) throw new Error("Missing Chompy toad burst graphic");

  function spawn(id, at, player, area) {
    if (area?.isDestroyed()) return null;
    const npc = api.spawnNpc({ id, x: at.getX(), y: at.getY(), z: at.getZ(), wanderRadius: 0, owner: player, ownerOnly: true });
    if (!npc?.isRegistered()) {
      if (npc) api.removeNpc(npc);
      return null;
    }
    // spawnNpc does not inherit the owner's instance. Never use the owner's later location/area.
    if (area) area.add(npc);
    else npc.setArea(null);
    return npc;
  }

  function removeActor(npc) {
    npc.getPrivateArea()?.detach(npc);
    api.removeNpc(npc);
  }

  function occupied(at, area, nearby) {
    return nearby.some(entity => {
      const loc = entity.getLocation();
      return entity.isRegistered() && entity.getPrivateArea() === area && loc.getZ() === at.getZ()
        && at.getX() >= loc.getX() && at.getX() < loc.getX() + entity.getSize()
        && at.getY() >= loc.getY() && at.getY() < loc.getY() + entity.getSize();
    });
  }

  function landingTile(bait) {
    const possible = [];
    const nearby = [...World.getNpcsNear(bait.at, MAX_LANDING_DISTANCE * 2, bait.area),
      ...World.getPlayers()].filter(Boolean);
    for (let dx = -MAX_LANDING_DISTANCE; dx <= MAX_LANDING_DISTANCE; dx++) {
      for (let dy = -MAX_LANDING_DISTANCE; dy <= MAX_LANDING_DISTANCE; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < MIN_LANDING_DISTANCE) continue;
        const at = new Location(bait.at.getX() + dx, bait.at.getY() + dy, bait.at.getZ());
        if (!RegionManager.getRegion(at.getX(), at.getY())) continue;
        if ((RegionManager.getClipping(at.getX(), at.getY(), at.getZ(), bait.area) & BLOCKED_LANDING) !== 0) continue;
        if (!RegionManager.canProjectileAttackBounds(at, bait.at, 1, 1, 1, 1, bait.area) || occupied(at, bait.area, nearby)) continue;
        possible.push(at);
      }
    }
    return possible.length ? possible[Math.floor(Math.random() * possible.length)] : null;
  }

  function doubleChance(player) {
    for (const [tier, chance] of [["elite", 1], ["medium", 0.5], ["easy", 0.25]]) {
      const request = { player, diary: "western", tier, claimed: false };
      api.emitCustomEvent("diary:is-reward-claimed", request);
      if (request.claimed === true) return chance;
    }
    return 0;
  }

  function attract(bait) {
    const at = landingTile(bait);
    if (!at) return false;
    const npc = spawn(NpcIdentifiers.CHOMPY_BIRD, at, bait.player, bait.area);
    if (!npc) return false;
    const arrived = [npc];
    birds.set(npc, { npc, player: bait.player, area: bait.area, bait, age: 0 });
    npc.performAnimation(new Animation(landing.id));
    bait.attracted = true;
    const chance = doubleChance(bait.player);
    if (chance === 1 || (chance > 0 && Math.random() < chance)) {
      const secondTile = landingTile(bait);
      const second = secondTile && spawn(NpcIdentifiers.CHOMPY_BIRD, secondTile, bait.player, bait.area);
      if (second) {
        birds.set(second, { npc: second, player: bait.player, area: bait.area, bait, age: 0 });
        second.performAnimation(new Animation(landing.id));
        arrived.push(second);
      }
    }
    for (const bird of arrived) callbacks.onAttracted?.({ player: bait.player, npc: bird, bait: bait.npc });
    return true;
  }

  function removeBait(bait, burst = false) {
    if (!baits.delete(bait.npc)) return;
    removeActor(bait.npc);
    if (burst) {
      const player = bait.player;
      if (player.isRegistered() && player.getPrivateArea() === bait.area && player.getLocation().isWithinDistance(bait.at, 16)) {
        player.getPacketSender().sendGraphic(new Graphic(burstGraphic), bait.at);
        // The burst cannot kill: damage is clamped to leave the owner at 1 HP, and skipped at 1 HP.
        const damage = player.getLocation().isWithinDistance(bait.at, 1)
          ? Math.min(1 + Math.floor(Math.random() * 2), player.getHitpoints() - 1) : 0;
        if (damage >= 1) {
          player.getCombat().getHitQueue().addPendingDamage([new HitDamage(damage, HitMask.RED)]);
        }
      }
    }
    callbacks.onBaitExpired?.({ player: bait.player, attracted: bait.attracted,
      remaining: [...baits.values()].filter(other => other.player === bait.player).length });
  }

  function ownsBird(player, npc) { return birds.get(npc)?.player === player; }
  function removeBird(npc) { birds.delete(npc); }
  function ownsCarcass(player, npc) { return carcasses.get(npc)?.player === player; }
  function hasCarcass(player) { return [...carcasses.values()].some(corpse => corpse.player === player && corpse.npc.isRegistered()); }
  function forgetCarcass(npc) { carcasses.delete(npc); }
  function trackCarcass(npc, player) {
    carcasses.set(npc, { npc, player, area: npc.getPrivateArea(), age: 0 });
    ensureTask();
  }

  function leave(bird) {
    birds.delete(bird.npc);
    bird.npc.setFlag(LEAVING_FLAG);
    bird.npc.getMovementQueue().reset();
    bird.npc.getCombat().reset();
    bird.npc.performAnimation(new Animation(leaving.id));
    departures.set(bird.npc, { npc: bird.npc, player: bird.player, area: bird.area, age: 0 });
  }

  function tick() {
    for (const departure of [...departures.values()]) {
      if (!departure.player.isRegistered() || departure.area?.isDestroyed() || ++departure.age >= leaving.ticks) {
        departures.delete(departure.npc);
        removeActor(departure.npc);
      }
    }
    for (const corpse of [...carcasses.values()]) {
      if (!corpse.player.isRegistered() || corpse.area?.isDestroyed() || !corpse.npc.isRegistered() || ++corpse.age >= CARCASS_LIFETIME) {
        carcasses.delete(corpse.npc);
        removeActor(corpse.npc);
      }
    }
    // Existing birds first: a bird born on this tick starts at age zero.
    for (const bird of [...birds.values()]) {
      if (!bird.player.isRegistered() || bird.area?.isDestroyed() || !bird.npc.isRegistered()) {
        birds.delete(bird.npc);
        removeActor(bird.npc);
      } else if (bird.npc.getHitpoints() <= 0) {
        continue; // retain identity until the actual death hook transfers ownership
      } else if (++bird.age >= BIRD_LIFETIME) {
        leave(bird);
      } else if (bird.age >= landing.ticks && baits.has(bird.bait.npc) && !bird.npc.getCombat().getAttacker()) {
        if (bird.npc.getLocation().isWithinDistance(bird.bait.at, 1)) removeBait(bird.bait);
        else if (!bird.npc.getMovementQueue().getDestination()) {
          api.core.PathFinder.calculateWalkRoute(bird.npc, bird.bait.at.getX(), bird.bait.at.getY());
        }
      }
    }
    for (const bait of [...baits.values()]) {
      if (!bait.player.isRegistered() || bait.area?.isDestroyed() || !bait.npc.isRegistered()) {
        removeBait(bait);
        continue;
      }
      bait.age++;
      // Fourth attempt precedes the age-100 burst, even if it succeeds.
      if (!bait.attracted && bait.age % ROLL_INTERVAL === 0 && Math.random() < 1 / 5) attract(bait);
      if (bait.age >= BAIT_LIFETIME) removeBait(bait, true);
    }
    if (baits.size + birds.size + carcasses.size + departures.size === 0) {
      task.stop();
      task = null;
    }
  }

  class ChompyHuntTask extends Task { execute() { tick(); } }
  function ensureTask() {
    if (!task) {
      task = new ChompyHuntTask(1);
      TaskManager.submit(task);
    }
  }

  function place(player) {
    const at = player.getLocation().clone(), area = player.getPrivateArea();
    if (World.getNpcsNear(at, 1, area).some(npc => npc.getId() === NpcIdentifiers.BLOATED_TOAD && npc.getLocation().equals(at))) {
      player.sendMessage("There is a bloated toad already placed at this location.");
      return false;
    }
    const npc = spawn(NpcIdentifiers.BLOATED_TOAD, at, player, area);
    if (!npc) return false;
    baits.set(npc, { npc, at, area, player, age: 0, attracted: false });
    ensureTask();
    return true;
  }

  function cleanup(player) {
    for (const collection of [baits, birds, carcasses, departures]) {
      for (const [npc, state] of collection) {
        if (state.player === player) {
          collection.delete(npc);
          removeActor(npc);
        }
      }
    }
  }
  function shutdown() {
    for (const collection of [baits, birds, carcasses, departures]) {
      for (const npc of collection.keys()) removeActor(npc);
      collection.clear();
    }
    task?.stop();
    task = null;
  }
  return { place, ownsBird, removeBird, ownsCarcass, hasCarcass, trackCarcass, forgetCarcass, cleanup, shutdown,
    isLeaving: npc => npc?.hasFlag?.(LEAVING_FLAG) === true };
};
