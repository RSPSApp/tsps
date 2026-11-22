"use strict";

/**
 * The ents' visits and the spirits at each site.
 *
 * The roaming ents advance together through the eight captured site positions. Crediting all sites
 * on the same 80-tick boundary preserves the pile, durability and spirit behavior already here.
 * The route geometry, trail timing and approximations are recorded in docs/vale-totems.md.
 *
 * The spirit NPCs (ent_totems_site_N_animal_X_1) are multi-NPCs on site_N_multianimal_X_1, so
 * each player sees only their own three; they wander around the site.
 */
const Shared = require("./Shared.ValeTotems");
const State = require("./State.ValeTotems");
const Totems = require("./Totems.ValeTotems");
const Spirits = require("./Spirits.ValeTotems");
const Icons = require("./Icons.ValeTotems");
const Trails = require("./Trails.ValeTotems");
const ROUTES = require("../data/vale-totems-ent-routes.json");

const { DATA } = Shared;
const OFFERING_PAUSE = 14;
const DEPARTURE_PAUSE = 8;
const TRAVEL_TICKS = DATA.cycleTicks - OFFERING_PAUSE - DEPARTURE_PAUSE;
const FIRST_FLOWER_TICK = 33;
const SECOND_FLOWER_TICK = FIRST_FLOWER_TICK + 2;
const TRAIL_LIFETIME = 73;
const IGNORE_CLIPPING = "movement:ignore-clipping";
const POINTS_MAX = (1 << 14) - 1;
const SPIRIT_WANDER = 4;
const SPIRIT_OFFSETS = [[-2, -2], [2, -2], [-2, 2], [2, 2], [0, -3]];

/** The offerings this totem earns from one visit. */
function offeringsFor(player, site, totem) {
  const wood = Totems.woodOf(totem.wood);
  const full = Math.floor(wood.baseOfferings + wood.decorationOfferings * totem.decorations);
  const wrong = Totems.wrongAnimals(player, site);
  return wrong ? Math.round(full * Math.max(0, 1 - DATA.wrongAnimalOfferingsPenalty * wrong)) : full;
}

function visit(player, site, ent) {
  if (Totems.questHolds(player, site)) return;
  const totem = State.totem(player, site);
  const multiplier = Trails.offeringMultiplier(player, ent, totem);
  if (totem.wood === 0) {
    State.rollAnimals(player, site);
    return;
  }
  if (!totem.carved) return;
  State.set(player, site, { points: Math.min(POINTS_MAX, totem.points + multiplier * offeringsFor(player, site, totem)) });
  if (totem.decay > 1) {
    State.set(player, site, { decay: totem.decay - 1 });
  } else {
    State.collapse(player, site);
    State.rollAnimals(player, site);
  }
  Icons.refresh(player);
}

/** One ent visit at every site, for one player. */
function visitAll(player, ents) {
  if (ents) {
    for (const ent of ents) visit(player, ent.destination, ent);
    Trails.updateEntIndicators(player);
  } else {
    for (const site of State.SITES) visit(player, site);
  }
}


function spawnSpirits(api) {
  for (const { site, x, y } of DATA.sites) {
    DATA.animals.forEach((animal, index) => {
      const [dx, dy] = SPIRIT_OFFSETS[index];
      const npc = api.spawnNpc({ id: Shared.npc(`ent_totems_site_${site}_animal_${animal.key}_1`), x: x + dx, y: y + dy, z: 0, wanderRadius: SPIRIT_WANDER });
      Spirits.retain(site, index + 1, npc);
    });
  }
}

/** Expand the captured directions and the collision-valid site-6 connector to tile steps. */
function routeTiles(waypoints) {
  const { Location } = Shared.core();
  let [x, y] = waypoints[0];
  const tiles = [new Location(x, y, 0)];
  for (const [endX, endY] of waypoints.slice(1)) {
    while (x !== endX || y !== endY) {
      x += Math.sign(endX - x);
      y += Math.sign(endY - y);
      tiles.push(new Location(x, y, 0));
    }
  }
  return tiles;
}

function destinationId(site) {
  return Shared.npc(`ent_totems_ent_destination_${site}`);
}

function spawnEnts(api, paths) {
  return paths.map((tiles, index) => {
    const destination = index + 1;
    const origin = tiles[0];
    const npc = api.spawnNpc({ id: destinationId(destination), x: origin.getX(), y: origin.getY(), z: 0 });
    if (!npc) throw new Error(`ValeTotems: unable to spawn the ent for site ${destination}`);
    npc.setScriptedMovement(true);
    // Scripted retail paths are not interrupted by players or NPCs standing on their waypoints.
    npc.setFlag(IGNORE_CLIPPING, true);
    return { destination, npc, tileIndex: 0, pair: null };
  });
}

function moveEnt(ent, tiles, phase) {
  const { npc } = ent;
  const previous = tiles[ent.tileIndex];
  // The engine may skip movement while the ent is outside all active regions. Resume on its
  // scheduled tile so a returning player never sees accumulated offscreen waypoints.
  if (!npc.getLocation().equals(previous)) npc.moveTo(previous);
  const travel = Math.max(0, Math.min(TRAVEL_TICKS, phase - DEPARTURE_PAUSE));
  const nextIndex = Math.floor(travel * (tiles.length - 1) / TRAVEL_TICKS);
  const steps = nextIndex - ent.tileIndex;
  if (steps === 0) return;
  npc.setMovementSteps(steps);
  for (let next = ent.tileIndex + 1; next <= nextIndex; next++) npc.getMovementQueue().addSteps(tiles[next]);
  ent.tileIndex = nextIndex;
}

function tickEnts(ents, paths, tick) {
  const phase = tick % DATA.cycleTicks;
  if (phase === 0) {
    for (const player of State.activePlayers()) visitAll(player, ents);
    for (const ent of ents) {
      ent.destination = ent.destination % paths.length + 1;
      ent.tileIndex = 0;
      ent.npc.setNpcTransformationId(destinationId(ent.destination));
    }
    for (const player of State.activePlayers()) Trails.updateEntIndicators(player);
  }

  for (const ent of ents) {
    const tiles = paths[ent.destination - 1];
    moveEnt(ent, tiles, phase);
    if (ent.pair && tick === ent.pair.removeAt) {
      Trails.removePair(ent.pair);
      ent.pair = null;
    }
    if (phase === FIRST_FLOWER_TICK) {
      ent.pair = { ent, parts: [], removeAt: tick + TRAIL_LIFETIME };
      Trails.placeFlower(ent.pair, 0, tiles[ent.tileIndex]);
    } else if (phase === SECOND_FLOWER_TICK) {
      Trails.placeFlower(ent.pair, 1, tiles[ent.tileIndex]);
    }
  }
}

function start() {
  const { Task, TaskManager } = Shared.core();
  const api = Shared.api();
  const paths = ROUTES.map(routeTiles);
  const ents = spawnEnts(api, paths);
  let tick = 0;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(1, "vale-totems:ents", false);
    }
    execute() {
      tickEnts(ents, paths, ++tick);
    }
  })());
  spawnSpirits(api);
}

function attach(api) {
  api.onServerStartup(start);
  Trails.attach(api);
}

module.exports = { attach, visitAll, stepOnTrail: Trails.step };
