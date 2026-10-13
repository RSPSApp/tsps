"use strict";

/**
 * The ents' visits and the spirits at each site.
 *
 * Captures (rsprox, Auburn Valley): every 80 ticks every site is visited at once. A fully
 * carved totem gets its offerings (site_N_points) and loses a point of durability (site_N_decay);
 * at 0 it collapses (every site_N_ varbit back to 0) on the same visit. A site with no totem gets
 * three new spirits (site_N_animal_1..3); a totem, carved or not, keeps them. Offerings per visit
 * match the Wiki's table: the wood's base plus its amount per decoration (oak 2 + 2 each, yew
 * 3 + 2.5, magic 3 + 3). One maple totem with one wrong animal got 6 instead of 10, the only
 * sample: each wrong animal takes 40% off here, an estimate.
 *
 * The spirit NPCs (ent_totems_site_N_animal_X_1) are multi-NPCs on site_N_multianimal_X_1, so
 * each player sees only their own three; they wander around the site.
 */
const Shared = require("./Shared.ValeTotems");
const State = require("./State.ValeTotems");
const Totems = require("./Totems.ValeTotems");

const { DATA } = Shared;
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

function visit(player, site) {
  const totem = State.totem(player, site);
  if (totem.wood === 0) {
    State.rollAnimals(player, site);
    return;
  }
  if (!totem.carved) return;
  State.set(player, site, { points: Math.min(POINTS_MAX, totem.points + offeringsFor(player, site, totem)) });
  if (totem.decay > 1) {
    State.set(player, site, { decay: totem.decay - 1 });
    return;
  }
  State.collapse(player, site);
  State.rollAnimals(player, site);
}

/** One ent visit at every site, for one player. */
function visitAll(player) {
  for (const site of State.SITES) visit(player, site);
}

function cycle() {
  for (const player of State.activePlayers()) visitAll(player);
}

function spawnSpirits(api) {
  for (const { site, x, y } of DATA.sites) {
    DATA.animals.forEach((animal, index) => {
      const [dx, dy] = SPIRIT_OFFSETS[index];
      api.spawnNpc({ id: Shared.npc(`ent_totems_site_${site}_animal_${animal.key}_1`), x: x + dx, y: y + dy, z: 0, wanderRadius: SPIRIT_WANDER });
    });
  }
}

function start() {
  const { Task, TaskManager } = Shared.core();
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(DATA.cycleTicks, "vale-totems:ents", false);
    }
    execute() {
      cycle();
    }
  })());
  spawnSpirits(Shared.api());
}

function attach(api) {
  api.onServerStartup(start);
}

module.exports = { attach, visitAll };
