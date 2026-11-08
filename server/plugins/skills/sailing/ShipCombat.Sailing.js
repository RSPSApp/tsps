// Boat cannons against hostile static ships (a quest's pirates), and what damages the player's
// own boat. Manning and firing a cannon are seacombat/Cannon.SeaCombat.js's; Attack (op2) on a
// hostile ship fires the manned cannon at it, with the cannon's reach (rsprox: Red Reef capture
// 4152 for the ship's shots back, every 7 ticks). A ship's own damage isn't captured (fixed 5).
const StaticShips = require("./StaticShips.Sailing");

const BRONZE_CANNONBALL_PROJECTILE = 3487; // sailing_cannonball_travel_bronze
const FLIGHT_CYCLES = 86;
/** 120 in the capture's map_projanim_v2, which rsprox prints four times over. */
const HOSTILE_START_HEIGHT = 30;
const ENEMY_ATTACK_INTERVAL_TICKS = 7; // captured pirate cannon/arrow volleys
const ENEMY_DAMAGE = 5; // observed player-boat hits are 1-6; exact attribution is not captured
const RANGE_TILES = 24;
const NOT_MOUNTED = "You can only attack a boat with a weapon mounted on another boat!";

let core;
let hostileFireStarted = false;

function attach(api) {
  core = api.core ?? api;
}

function coreApi() {
  if (!core) throw new Error("ShipCombat used before its plugin attached");
  return core;
}

function cannons() {
  return require("./seacombat/Cannon.SeaCombat");
}

function shipTile(ship) {
  return new (coreApi().Location)(ship.boat.tileX, ship.boat.tileY, ship.boat.level);
}

function viewersFor(player, attackerBoat, targetBoat) {
  const boat = coreApi().BoatManager;
  return [player, ...player.getLocalPlayers().filter((other) =>
    boat.canSeeBoat(other, attackerBoat) && boat.canSeeBoat(other, targetBoat))];
}

/** Attack (op2) on a hostile static ship: the manned cannon fires at it. */
function attackWorldEntity(event) {
  if (event.clickType !== 2) return false;
  const target = StaticShips.get(event.entityIndex);
  if (!target || !target.definition.hostile) return false;
  if (!StaticShips.canSee(event.player, target)) return false;
  const gunner = cannons().mannedBy(event.player);
  event.handled = true;
  if (!gunner) {
    event.player.sendMessage(NOT_MOUNTED);
    return true;
  }
  if (!StaticShips.inRange(event.player, target, RANGE_TILES)) {
    event.player.sendMessage("You can't reach that boat.");
    return true;
  }
  const now = coreApi().World.getProcessCycle();
  if (now < gunner.nextAttackTick) return true;
  gunner.nextAttackTick = now + gunner.stats.attackRate;
  const player = event.player;
  cannons().fire(gunner, {
    ship: target,
    onShipHit: (damage) => shipHit(player, gunner, target, damage),
  });
  return true;
}

/** A shot landing on a static ship, unless the gunner left the cannon or the ship has gone. */
function shipHit(player, gunner, target, damage) {
  if (cannons().mannedBy(player) !== gunner || StaticShips.get(target.boat.entityIndex) !== target) return;
  const result = StaticShips.damage(target, damage);
  if (result.damage <= 0) return;
  for (const viewer of viewersFor(player, gunner.boat, target.boat)) {
    viewer.getPacketSender().sendGraphic(new (coreApi().Graphic)(3541), shipTile(target));
  }
  coreApi().PluginManager.emitCustomEvent("sailing:ship-hit", {
    player, ship: target, damage: result.damage, hitpoints: result.hitpoints,
  });
  if (!result.sunk || result.alreadySunk) return;
  coreApi().PluginManager.emitCustomEvent("sailing:ship-sunk", { player, ship: target });
  if (StaticShips.get(target.boat.entityIndex) === target) StaticShips.dispose(target);
}

function playerBoatTile(boat) {
  return new (coreApi().Location)(boat.tileX, boat.tileY, boat.level);
}

function targetFor(ship) {
  let best;
  let bestDistance = RANGE_TILES + 1;
  for (const boat of coreApi().BoatManager.all()) {
    if (boat.static || boat.level !== ship.boat.level) continue;
    if (ship.boat.ownerOnly && boat.ownerPlayerId !== ship.boat.ownerPlayerId) continue;
    const owner = coreApi().BoatManager.getDeck(boat)?.getPlayers?.()
      .find((player) => player.getIndex() === boat.ownerPlayerId);
    if (!owner || !coreApi().BoatManager.canSeeBoat(owner, ship.boat)) continue;
    const distance = Math.max(
      Math.abs(boat.tileX - ship.boat.tileX),
      Math.abs(boat.tileY - ship.boat.tileY),
    );
    if (distance < bestDistance) {
      best = { boat, player: owner };
      bestDistance = distance;
    }
  }
  return best;
}

/** Hostile static ships fire a captured bronze cannonball at a nearby player boat. */
function fireHostileCannon(ship, target) {
  const start = shipTile(ship);
  const end = playerBoatTile(target.boat);
  for (const viewer of viewersFor(target.player, ship.boat, target.boat)) {
    viewer.getPacketSender().sendProjectile(
      start, end, 0, FLIGHT_CYCLES, BRONZE_CANNONBALL_PROJECTILE, HOSTILE_START_HEIGHT, 0, null, 0,
    );
  }
  const impactTicks = Math.max(1, Math.ceil(
    FLIGHT_CYCLES * 20 / coreApi().GameConstants.GAME_ENGINE_PROCESSING_CYCLE_RATE,
  ));
  coreApi().TaskManager.submit(new (class extends coreApi().Task {
    constructor() { super(impactTicks, target.player, false); }
    execute() {
      this.stop();
      if (StaticShips.get(ship.boat.entityIndex) !== ship) return;
      if (coreApi().BoatManager.getBoat(target.boat.entityIndex) !== target.boat) return;
      if (target.player.getIndex() !== target.boat.ownerPlayerId) return;
      if (coreApi().BoatManager.getBoatAboard(target.player) !== target.boat) return;
      if (coreApi().Sailing.instanceAboard(target.player) !== target.boat) return;
      damagePlayerBoat(target.player, ENEMY_DAMAGE, { ship, target: target.boat });
    }
  })());
}

/**
 * Damages the player's own boat (a sea creature, a hostile ship's shot, a Barracuda Trial's
 * lightning): its HP, the hitsplat on its HP-bar NPC, `sailing:ship-attacked`, and at 0 the player
 * escapes to land, losing the cargo when a creature or ship sank it (seacombat/BoatHp.SeaCombat.js).
 */
function damagePlayerBoat(player, damage, { ship, target, creature } = {}) {
  const owned = coreApi().Sailing.activeBoat(player);
  if (!owned) return undefined;
  const BoatHp = require("./seacombat/BoatHp.SeaCombat");
  const hitpoints = BoatHp.damage(player, owned, damage, coreApi().Sailing.instanceAboard(player));
  coreApi().PluginManager.emitCustomEvent("sailing:ship-attacked", {
    player, ship, creature, target: target ?? coreApi().Sailing.instanceAboard(player), damage, hitpoints,
  });
  if (hitpoints <= 0 && coreApi().Sailing.instanceAboard(player)) {
    // Combat capsize applies the cargo-loss policy (Wiki: Boat); a trial's hazards only send the
    // player back, as before.
    if (ship || creature) BoatHp.loseCargo(owned);
    coreApi().Sailing.escape(player);
  }
  return hitpoints;
}

function tickHostileShips() {
  const now = coreApi().World.getProcessCycle();
  for (const ship of StaticShips.all()) {
    if (!ship.definition.hostile) continue;
    if (now < (ship.nextFireTick ?? 0)) continue;
    const target = targetFor(ship);
    if (!target) continue;
    ship.nextFireTick = now + ENEMY_ATTACK_INTERVAL_TICKS;
    fireHostileCannon(ship, target);
  }
}

function initialize(api) {
  attach(api);
  if (hostileFireStarted) return;
  hostileFireStarted = true;
  coreApi().BoatManager.onAfterTick(tickHostileShips);
}

module.exports = {
  name: "SailingShipCombat",
  members: true,
  attach,
  damagePlayerBoat,
  register(api) {
    initialize(api);
    api.onWorldEntityInteraction(attackWorldEntity);
  },
  _test: {
    attackWorldEntity, RANGE_TILES, FLIGHT_CYCLES, ENEMY_ATTACK_INTERVAL_TICKS, ENEMY_DAMAGE, tickHostileShips, fireHostileCannon,
  },
};
