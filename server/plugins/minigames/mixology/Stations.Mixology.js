"use strict";

/**
 * The three stations that finish a potion: the retort concentrates, the agitator homogenises
 * and the alembic crystallises (order modifiers 2, 1 and 3; enum 5545).
 *
 * rsprox captures (normal worlds 4186, 4187, 4191, 4197; Leagues VI 1107 and others):
 * - Starting (op1, or an unfinished potion used on the station): the first unfinished potion
 *   in the inventory goes in (its station varbit takes the potion's index), the player plays
 *   the station's human_machinery_..._interact01 every tick, the station its interact01 loop,
 *   and "You start crystallising the <col=6800bf>Mammoth-might mix</col>...". Nothing to put
 *   in: "You're not carrying anything that can be concentrated."
 * - Progress (varbits 11327-11329) climbs by 1 a tick to 45 - floor(Herblore / 3), the current
 *   level counting (20 at 75, 12 at 99, 11 at 102, 8 at 111). On the last step the potion
 *   comes out finished: "You finish crystallising the <col=6800bf>Mammoth-might mix</col>.",
 *   synth 2582, the station's idle02, both varbits back to 0. With no room for it: "You don't
 *   have enough inventory space to collect the finished Anti-leech lotion." and it waits.
 * - Retort: every tick the player clicks it again adds 1 more (2 a tick), for 2 XP a click.
 * - Alembic: after four active pumps the bellows open (synth 2655 and
 *   vfx_machinery_alchemy01_alembic01 at its front, both 30 cycles late); a click on the next
 *   tick hits (varbit 11338): progress jumps a third of the total (4 -> 10 at a total of 19),
 *   then +2 for the tick, and 14 XP. Any other click while it works loses 2 progress.
 * - Agitator: the same cue (synth 2655, vfx_machinery_alchemy01_agitator01, no delay) comes
 *   early, at progress 2-5; a click in either of the two ticks after it hits (varbit 11337),
 *   each hit a third of the total, 14 XP for the first and 2 for the second (Wiki: 16 total).
 *   Mistimed clicks lose 2.
 * - Check (op3): "The retort is empty." / "The retort contains Anti-leech lotion."
 * - The progress bar: an invisible NPC (13918) in front of the station carries headbar 33,
 *   sent from the current fill to full (50) over the ticks left at one a tick (30 cycles each):
 *   startfill 0, endtime 600 at a total of 20. A jump (a hit, a retort click) or a miss spawns
 *   it afresh with the new fill (25 over 300 at 10 of 20); finishing or leaving removes it
 *   (normal-world recordings 4186, 4197).
 * - Walking away pauses it: the potion and progress stay in the station (a Leagues capture
 *   finishes a potion left in the alembic hundreds of ticks earlier).
 */

const Shared = require("./Shared.Mixology");

const STATIONS = {
  retort: {
    key: "retort",
    name: "Retort",
    noun: "retort",
    modifier: Shared.MODIFIER.RETORT,
    loc: Shared.LOC.RETORT,
    bar: { x: 1397, y: 9326 },
    potionVarbit: Shared.VARBIT.RETORT_POTION,
    progressVarbit: Shared.VARBIT.RETORT_PROGRESS,
    verb: "concentrating",
    past: "concentrated",
    human: "human_machinery_alchemy01_retort01_interact01",
    machine: "machinery_alchemy01_retort01",
  },
  agitator: {
    key: "agitator",
    name: "Agitator",
    noun: "agitator",
    modifier: Shared.MODIFIER.AGITATOR,
    loc: Shared.LOC.AGITATOR,
    bar: { x: 1394, y: 9329 },
    potionVarbit: Shared.VARBIT.AGITATOR_POTION,
    progressVarbit: Shared.VARBIT.AGITATOR_PROGRESS,
    hitVarbit: Shared.VARBIT.HIT_SKILLSHOT_AGITATOR,
    verb: "homogenising",
    past: "homogenised",
    human: "human_machinery_alchemy01_agitator01_interact01",
    machine: "machinery_alchemy01_agitator01",
    cue: { vfx: "vfx_machinery_alchemy01_agitator01", x: 1394, y: 9329, delay: 0, window: 2, hits: 2, xp: [14, 2] },
  },
  alembic: {
    key: "alembic",
    name: "Alembic",
    noun: "alembic",
    modifier: Shared.MODIFIER.ALEMBIC,
    loc: Shared.LOC.ALEMBIC,
    bar: { x: 1391, y: 9326 },
    potionVarbit: Shared.VARBIT.ALEMBIC_POTION,
    progressVarbit: Shared.VARBIT.ALEMBIC_PROGRESS,
    hitVarbit: Shared.VARBIT.HIT_SKILLSHOT_ALEMBIC,
    verb: "crystallising",
    past: "crystallised",
    human: "human_machinery_alchemy01_alembic01_interact01",
    machine: "machinery_alchemy01_alembic01",
    cue: { vfx: "vfx_machinery_alchemy01_alembic01", x: 1391, y: 9326, delay: 30, window: 1, hits: 1, xp: [14] },
  },
};

const STATION_BY_ID = new Map([
  [Shared.OBJECT.RETORT_MULTI, STATIONS.retort],
  [Shared.OBJECT.AGITATOR_MULTI, STATIONS.agitator],
  [Shared.OBJECT.ALEMBIC_MULTI, STATIONS.alembic],
]);

const TOTAL_BASE = 45;
const LEVELS_PER_STEP = 3;
const MIN_TOTAL = 1;
const CLICK_BONUS = 1;
const MISS_PENALTY = 2;
const RETORT_CLICK_XP = 2;
const ALEMBIC_FIRST_PUMP = 4;
const ALEMBIC_RETRY_PUMPS = 7;
const AGITATOR_CUE_RANGE = [2, 5];
const SOUND_CUE = 2655;
const SOUND_FINISHED = 2582;
const BAR = { HEADBAR: 33, WIDTH: 50, CYCLES_PER_TICK: 30 };
/** Whether digweed went into the potion now in a station, kept beside its varbit. */
const DIGWEED_FIELD = (station) => `${station.key}Digweed`;

/** The station a player is working right now. */
const work = new WeakMap();

function stationAt(location) {
  for (const station of Object.values(STATIONS)) {
    if (station.loc.x === location.x && station.loc.y === location.y) return station;
  }
  return null;
}

function stationOf(event) {
  return STATION_BY_ID.get(event.objectId) ?? stationAt(event.location);
}

function isWorking(player) {
  return work.has(player);
}

function total(player) {
  return Math.max(MIN_TOTAL, TOTAL_BASE - Math.floor(Shared.herbloreLevel(player) / LEVELS_PER_STEP));
}

function notCarrying(station) {
  return `You're not carrying anything that can be ${station.past}.`;
}

function firstUnfinished(player) {
  const items = player.getInventory().getItems();
  for (let slot = 0; slot < items.length; slot++) {
    if (Shared.isUnfinished(items[slot]?.getId?.())) return slot;
  }
  return -1;
}

function removeBar(state) {
  if (state?.bar) Shared.api().removeNpc(state.bar);
  if (state) state.bar = null;
}

/** The bar from the current progress to full, at one a tick; spawned afresh as live does. */
function showBar(player, state, progress, needed) {
  removeBar(state);
  const { bar } = state.station;
  const npc = Shared.api().spawnNpc({ id: Shared.NPC.TABLE_BAR, x: bar.x, y: bar.y, z: Shared.LAB.z, wanderRadius: 0, owner: player });
  if (!npc) return;
  state.bar = npc;
  npc.showHeadbar(BAR.HEADBAR, {
    fill: Math.floor((BAR.WIDTH * progress) / needed),
    endFill: BAR.WIDTH,
    duration: Math.max(0, needed - progress) * BAR.CYCLES_PER_TICK,
  });
}

function begin(player, station) {
  const { Location } = Shared.core();
  const location = player.getLocation();
  const cue = station.cue;
  const cueProgress = station.key === "agitator"
    ? AGITATOR_CUE_RANGE[0] + Math.floor(Math.random() * (AGITATOR_CUE_RANGE[1] - AGITATOR_CUE_RANGE[0] + 1))
    : ALEMBIC_FIRST_PUMP;
  work.set(player, {
    station,
    tile: new Location(location.getX(), location.getY(), location.getZ()),
    started: Shared.tick(),
    click: -1,
    cueProgress: cue ? cueProgress : -1,
    cueTick: -1,
    // Count active pumps, not progress: a miss deducts progress and leaving resets pumps.
    pumps: 0,
    cuePump: ALEMBIC_FIRST_PUMP,
    retryScheduled: false,
    // A potion picked back up keeps its hit: the bonus comes once per potion (Wiki).
    hits: station.hitVarbit && Shared.get(player, station.hitVarbit) === 1 ? cue.hits : 0,
    bar: null,
  });
  showBar(player, work.get(player), Shared.get(player, station.progressVarbit), total(player));
  Shared.animate(player, station.human);
  Shared.animateLoc(player, station.loc, `${station.machine}_interact01`);
}

function insert(player, station, slot) {
  const inventory = player.getInventory();
  const item = inventory.getItems()[slot];
  const entry = Shared.potionByItem(item?.getId?.());
  if (!entry || entry.unfinished !== item.getId()) {
    player.sendMessage(notCarrying(station));
    return;
  }
  const digweed = item.getMetaValue?.(Shared.META.DIGWEED) === true;
  inventory.deleteAtSlot(slot, 1);
  inventory.refreshItems();
  Shared.set(player, station.potionVarbit, entry.index);
  Shared.set(player, station.progressVarbit, 0);
  if (station.hitVarbit) Shared.set(player, station.hitVarbit, 0);
  Shared.setField(player, DIGWEED_FIELD(station), digweed || null);
  player.sendMessage(`You start ${station.verb} the ${Shared.coloured(player, entry.name)}...`);
  begin(player, station);
}

/** A potion already in the station: pick it back up, or collect it if it is done. */
function resume(player, station) {
  if (Shared.get(player, station.progressVarbit) >= total(player)) {
    finish(player, station);
    return;
  }
  begin(player, station);
}

function process(event, slot = -1) {
  const { player } = event;
  const station = stationOf(event);
  if (!station || !Shared.permitted(player)) return;
  const current = work.get(player);
  if (current?.station === station) {
    current.click = Shared.tick();
    Shared.animateLoc(player, station.loc, `${station.machine}_interact01`);
    return;
  }
  if (current) stop(player);
  if (Shared.get(player, station.potionVarbit) !== 0) {
    resume(player, station);
    return;
  }
  const from = slot >= 0 ? slot : firstUnfinished(player);
  if (from < 0) {
    player.sendMessage(notCarrying(station));
    return;
  }
  insert(player, station, from);
}

function processPotion(event) {
  process(event);
}

function potionOnStation(event) {
  if (!Shared.isUnfinished(event.itemId)) return false;
  process(event, event.itemSlot);
  return true;
}

function check(event) {
  const station = stationOf(event);
  if (!station) return;
  const entry = Shared.potion(Shared.get(event.player, station.potionVarbit));
  event.player.sendMessage(entry
    ? `The ${station.noun} contains ${Shared.coloured(event.player, entry.name)}.`
    : `The ${station.noun} is empty.`);
}

function setProgress(player, station, value) {
  Shared.set(player, station.progressVarbit, Math.max(0, value));
}

function cue(player, station, state, now) {
  const spec = station.cue;
  state.cueTick = now;
  Shared.sound(player, SOUND_CUE, spec.delay);
  Shared.tileGraphic(player, spec.vfx, spec.x, spec.y, spec.delay);
}

/** A click while the station works: the retort's extra step, or the skillshot. */
function click(player, station, state, now, progress, needed) {
  if (station.key === "retort") {
    Shared.addXp(player, RETORT_CLICK_XP);
    return progress + 1 + CLICK_BONUS;
  }
  const spec = station.cue;
  const inWindow = state.cueTick >= 0 && now > state.cueTick && now <= state.cueTick + spec.window;
  if (!inWindow || state.hits >= spec.hits) {
    if (station.key === "alembic" && state.hits === 0 && !state.retryScheduled) {
      state.retryScheduled = true;
      state.cuePump = state.pumps + ALEMBIC_RETRY_PUMPS;
      state.cueTick = -1;
    }
    return progress - MISS_PENALTY;
  }
  Shared.addXp(player, spec.xp[state.hits]);
  state.hits++;
  Shared.set(player, station.hitVarbit, 1);
  const jumped = Math.min(needed, progress + Math.floor(needed / LEVELS_PER_STEP));
  setProgress(player, station, jumped);
  return jumped + 1 + CLICK_BONUS;
}

function tick(player, now) {
  const state = work.get(player);
  if (!state) return;
  const location = player.getLocation();
  if (location.getX() !== state.tile.getX() || location.getY() !== state.tile.getY()) {
    stop(player);
    return;
  }
  if (now === state.started) return;
  const { station } = state;
  const needed = total(player);
  if (station.key === "alembic") state.pumps++;
  const progress = Shared.get(player, station.progressVarbit);
  const next = state.click === now
    ? click(player, station, state, now, progress, needed)
    : progress + 1;
  setProgress(player, station, Math.min(needed, next));
  if (next !== progress + 1 && next < needed) showBar(player, state, Math.max(0, next), needed);
  const cueReached = station.key === "alembic" ? state.pumps >= state.cuePump : next >= state.cueProgress;
  if (station.cue && state.cueTick < 0 && state.hits < station.cue.hits && cueReached) cue(player, station, state, now);
  if (next >= needed) {
    finish(player, station);
    return;
  }
  Shared.animate(player, station.human);
}

function finish(player, station) {
  const entry = Shared.potion(Shared.get(player, station.potionVarbit));
  if (!entry) {
    stop(player);
    return;
  }
  const inventory = player.getInventory();
  if (inventory.getFreeSlots() < 1) {
    player.sendMessage(`You don't have enough inventory space to collect the finished ${entry.name}.`);
    stop(player);
    return;
  }
  const { Item } = Shared.core();
  const meta = { [Shared.META.MODIFIER]: station.modifier };
  if (Shared.field(player, DIGWEED_FIELD(station)) === true) meta[Shared.META.DIGWEED] = true;
  setProgress(player, station, 0);
  Shared.set(player, station.potionVarbit, 0);
  if (station.hitVarbit) Shared.set(player, station.hitVarbit, 0);
  Shared.setField(player, DIGWEED_FIELD(station), null);
  inventory.add(new Item(entry.finished, 1, meta), true);
  player.sendMessage(`You finish ${station.verb} the ${Shared.coloured(player, entry.name)}.`);
  Shared.sound(player, SOUND_FINISHED);
  Shared.animateLoc(player, station.loc, `${station.machine}_idle02`);
  stop(player);
  player.performAnimation(new (Shared.core().Animation)(-1));
}

function stop(player) {
  removeBar(work.get(player));
  work.delete(player);
}

module.exports = function attachStations(api) {
  api.onObjectInteraction(STATIONS.retort.name, { "Concentrate-potion": processPotion, Check: check });
  api.onObjectInteraction(STATIONS.agitator.name, { "Homogenise-potion": processPotion, Check: check });
  api.onObjectInteraction(STATIONS.alembic.name, { "Crystalise-potion": processPotion, Check: check });
  api.onItemOnObject(potionOnAnyStation);
};

/** An unfinished potion used on a station (ten potion names, so matched by the station). */
function potionOnAnyStation(event) {
  if (event.handled || !stationOf(event)) return;
  if (potionOnStation(event)) event.handled = true;
}

Object.assign(module.exports, { isWorking, tick, stop, total, STATIONS });
