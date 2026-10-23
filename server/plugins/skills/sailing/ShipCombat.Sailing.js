// Boat cannons: Operate mans an installed cannon on the player's current deck; Attack (op2) on
// a hostile static ship fires one shot. Projectiles/animation/flight and the 7-tick repeated
// attack interval are the Red Reef capture (4152); damage is not captured (fixed 25).
const StaticShips = require("./StaticShips.Sailing");

const CANNON_ATTACK_ANIMATION = 13323; // sailing_cannon01_small01_attack01
const CANNON_ATTACK_GRAPHIC = 3538; // vfx_sailing_cannon01_small01_attack02
const CANNON_IMPACT_GRAPHIC = 3541; // vfx_sailing_cannon01_small01_impact01
const BRONZE_CANNONBALL_PROJECTILE = 3487; // sailing_cannonball_travel_bronze
const ADAMANT_CANNONBALL_PROJECTILE = 3492; // sailing_cannonball_travel_adamant
const FLIGHT_CYCLES = 86;
const ATTACK_INTERVAL_TICKS = 7; // captured player cannon shots every 7 ticks
const ENEMY_ATTACK_INTERVAL_TICKS = 7; // captured pirate cannon/arrow volleys
const ENEMY_DAMAGE = 5; // observed player-boat hits are 1-6; exact attribution is not captured
const PLAYER_BOAT_HP_VARBIT = 19181;
const PLAYER_BOAT_STORED_HP_VARBIT = 19458;
const DAMAGE = 25;
const RANGE_TILES = 24;
const CANNON_REACH = 2; // normal deck interaction reach (the object plus one tile)
const NOT_MOUNTED = "You can only attack a boat with a weapon mounted on another boat!";
/** Captured bronze/adamant projectiles; other cannonball tiers use the bronze visual. */
const AMMUNITION = [
  [31906, BRONZE_CANNONBALL_PROJECTILE], // bronze
  [31908, BRONZE_CANNONBALL_PROJECTILE], // iron
  [2, BRONZE_CANNONBALL_PROJECTILE], // steel (legacy id)
  [31910, BRONZE_CANNONBALL_PROJECTILE], // mithril
  [31912, ADAMANT_CANNONBALL_PROJECTILE], // adamant
  [31914, ADAMANT_CANNONBALL_PROJECTILE], // rune
  [31916, ADAMANT_CANNONBALL_PROJECTILE], // dragon
];

let core;
let hostileFireStarted = false;
/** player index -> { player, boat, cannon, cannonId, location, nextAttackTick }. */
const manning = new Map();

function attach(api) {
  core = api.core ?? api;
}

function coreApi() {
  if (!core) throw new Error("ShipCombat used before its plugin attached");
  return core;
}

/** Helper for direct callers/tests; logout hooks receive the event object. */
function forgetPlayer(player) {
  manning.delete(player.getIndex());
}

function logout({ player }) {
  forgetPlayer(player);
}

function cannonInstalled(state) {
  const deck = coreApi().BoatManager.getDeck(state.boat);
  return !!deck?.getObjects?.().some((object) =>
    object.getId() === state.cannonId && object.getLocation().equals(state.location));
}

function operateCannon(event) {
  const name = String(event.definition?.getName?.() ?? "");
  if (!/cannon/i.test(name) || String(event.option ?? "").toLowerCase() !== "operate") return false;
  const boat = coreApi().BoatManager.getBoatAboard(event.player);
  if (!boat) {
    event.player.sendMessage("You need to be on a boat to use a cannon.");
    event.handled = true;
    return true;
  }
  const location = new (coreApi().Location)(event.location.x, event.location.y, event.location.z);
  const installed = coreApi().BoatManager.getDeck(boat)?.getObjects?.().some((object) =>
    object.getId() === event.objectId && object.getLocation().equals(location));
  if (!installed || !event.player.getLocation().isWithinDistance(location, CANNON_REACH)) {
    event.player.sendMessage("You can't use that cannon.");
    event.handled = true;
    return true;
  }
  const previous = manning.get(event.player.getIndex());
  const sameCannon = previous && previous.boat === boat
    && previous.cannonId === event.objectId
    && previous.location.equals(location);
  // Re-manning the same cannon must keep both the cooldown and the state object identity: a
  // queued shot's impact is cancelled when `manning` no longer holds that exact state.
  const state = sameCannon ? previous : {
    player: event.player,
    boat,
    cannonId: event.objectId,
    location,
    nextAttackTick: 0,
  };
  state.player = event.player;
  state.cannon = event.object;
  manning.set(event.player.getIndex(), state);
  event.player.sendMessage("You man the cannon and take aim...");
  event.handled = true;
  return true;
}

function shipTile(ship) {
  return new (coreApi().Location)(ship.boat.tileX, ship.boat.tileY, ship.boat.level);
}

/** The main-world tile under the cannon, not its deck-scene coordinate. */
function cannonWorldLocation(state) {
  const tile = state.boat.deckTileToWorld(state.location.x, state.location.y);
  return new (coreApi().Location)(tile.x, tile.y, state.boat.level);
}

function viewersFor(player, attackerBoat, targetBoat) {
  const boat = coreApi().BoatManager;
  return [player, ...player.getLocalPlayers().filter((other) =>
    boat.canSeeBoat(other, attackerBoat) && boat.canSeeBoat(other, targetBoat))];
}

function fireProjectile(player, state, target, projectileId) {
  const start = cannonWorldLocation(state);
  const end = shipTile(target);
  const viewers = viewersFor(player, state.boat, target.boat);
  for (const viewer of viewers) {
    viewer.getPacketSender().sendProjectile(
      start, end, 0, FLIGHT_CYCLES, projectileId, 120, 0, null, 0,
    );
    viewer.getPacketSender().sendGraphic(new (coreApi().Graphic)(CANNON_ATTACK_GRAPHIC), start);
    viewer.getPacketSender().sendObjectAnimation(state.cannon, new (coreApi().Animation)(CANNON_ATTACK_ANIMATION));
  }
}

function ammoFor(player) {
  for (const [itemId, projectileId] of AMMUNITION) {
    if (player.getInventory().contains(itemId)) return { itemId, projectileId };
  }
  return undefined;
}

function attackWorldEntity(event) {
  if (event.clickType !== 2) return false;
  const target = StaticShips.get(event.entityIndex);
  if (!target || !target.definition.hostile) return false;
  if (!StaticShips.canSee(event.player, target)) return false;
  const state = manning.get(event.player.getIndex());
  if (!state) {
    event.player.sendMessage(NOT_MOUNTED);
    event.handled = true;
    return true;
  }
  const boat = coreApi().BoatManager.getBoatAboard(event.player);
  if (boat !== state.boat || !cannonInstalled(state)
    || !event.player.getLocation().isWithinDistance(state.location, CANNON_REACH)) {
    manning.delete(event.player.getIndex());
    return false;
  }
  if (!StaticShips.inRange(event.player, target, RANGE_TILES)) {
    event.player.sendMessage("You can't reach that boat.");
    event.handled = true;
    return true;
  }
  const now = coreApi().World.getProcessCycle();
  if (now < state.nextAttackTick) {
    event.handled = true;
    return true;
  }
  const ammo = ammoFor(event.player);
  if (!ammo) {
    event.player.sendMessage("You have no cannonballs to fire.");
    event.handled = true;
    return true;
  }
  event.player.getInventory().deleteNumber(ammo.itemId, 1);
  state.nextAttackTick = now + ATTACK_INTERVAL_TICKS;
  event.handled = true;
  fireProjectile(event.player, state, target, ammo.projectileId);

  const player = event.player;
  const impactTicks = Math.max(1, Math.ceil(
    FLIGHT_CYCLES * 20 / coreApi().GameConstants.GAME_ENGINE_PROCESSING_CYCLE_RATE,
  ));
  coreApi().TaskManager.submit(new (class extends coreApi().Task {
    constructor() { super(impactTicks, player, false); }
    execute() {
      this.stop();
      // The shot is cancelled by leaving the deck, losing/replacing the cannon, logging out,
      // or the target being removed/sunk.
      if (manning.get(player.getIndex()) !== state
        || coreApi().BoatManager.getBoatAboard(player) !== state.boat
        || !cannonInstalled(state)
        || !player.getLocation().isWithinDistance(state.location, CANNON_REACH)
        || StaticShips.get(target.boat.entityIndex) !== target
        || !StaticShips.inRange(player, target, RANGE_TILES)) return;
      const result = StaticShips.damage(target, DAMAGE);
      if (result.damage <= 0) return;
      for (const viewer of viewersFor(player, state.boat, target.boat)) {
        viewer.getPacketSender().sendGraphic(new (coreApi().Graphic)(CANNON_IMPACT_GRAPHIC), shipTile(target));
      }
      coreApi().PluginManager.emitCustomEvent("sailing:ship-hit", {
        player, ship: target, damage: result.damage, hitpoints: result.hitpoints,
      });
      if (!result.sunk || result.alreadySunk) return;
      coreApi().PluginManager.emitCustomEvent("sailing:ship-sunk", { player, ship: target });
      if (StaticShips.get(target.boat.entityIndex) === target) StaticShips.dispose(target);
    }
  })());
  return true;
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
      start, end, 0, FLIGHT_CYCLES, BRONZE_CANNONBALL_PROJECTILE, 120, 0, null, 0,
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
      const owned = coreApi().Sailing.activeBoat(target.player);
      if (!owned) return;
      owned.hitpoints = Math.max(0, owned.hitpoints - ENEMY_DAMAGE);
      target.player.getPacketSender().sendVarbit(PLAYER_BOAT_HP_VARBIT, owned.hitpoints);
      target.player.getPacketSender().sendVarbit(PLAYER_BOAT_STORED_HP_VARBIT + owned.slot, owned.hitpoints);
      coreApi().PluginManager.emitCustomEvent("sailing:ship-attacked", {
        player: target.player, ship, target: target.boat, damage: ENEMY_DAMAGE, hitpoints: owned.hitpoints,
      });
      if (owned.hitpoints <= 0) coreApi().Sailing.escape(target.player);
    }
  })());
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
  register(api) {
    initialize(api);
    api.onObjectInteraction(operateCannon);
    api.onWorldEntityInteraction(attackWorldEntity);
    api.onPlayerLogout(logout);
  },
  _test: {
    manning, forget: forgetPlayer, logout, operateCannon, attackWorldEntity, cannonInstalled, ammoFor,
    AMMUNITION, DAMAGE, RANGE_TILES, CANNON_REACH, ATTACK_INTERVAL_TICKS, FLIGHT_CYCLES,
    ENEMY_ATTACK_INTERVAL_TICKS, ENEMY_DAMAGE, tickHostileShips, fireHostileCannon,
  },
};
