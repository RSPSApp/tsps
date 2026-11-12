// The Gwenith Glide's resonance crystals and the crystallised helm (rsprox, recordings 936, 1030,
// 1031 and 1032):
//   35 resonance crystals (NPC 15112) stand in the narrows. Every 20 ticks all of them fire
//   together, each in its own direction, whoever is near: they turn the tick before, then a trail
//   of crystal (3509) runs out over the 5 tiles toward a spot about 6 tiles away (delays
//   0/12/24/36/48), and 3 ticks later a 3x3 field of spikes rises there: 3507 with its sound in the
//   middle, 3508 on the other 8 at random delays of 10-20 client cycles, again every 2 ticks, 9 in
//   all.
//   A boat caught in an active field, in a trial or not: "Some crystals attach to the helm, hurting
//   anyone who touches them!", the helm becomes the crystallised helm (59597), the headbar NPC
//   (15113) stands on it with headbar 82 at 40 for everyone to see, map_anim 3505 and sound 10733.
//   Whoever holds the helm is hit the next tick and every 4 ticks after: 1, 1, 1, 2, 2, 2... up to 5.
//   Break-crystals (op1) three times: the headbar 40, 27, 14 with sound 4156 on the first two; the
//   third: "The crystals have been successfully removed from the helm, granting a burst of speed.",
//   the helm back, 3505 and 10733. Clicking the helm the tick after: "The splintered crystals
//   linger on the helm, making it difficult to touch." (spam). A reset takes the crystals off with
//   the message and 3505, no sound and no burst.
// Ours: the direction (random; live's look random against the boat), the distance (6), what's
// caught (the boat's centre within 3 tiles of the field's middle, about the hull: live caught boats
// 0.5-4.5 tiles off), who sees a wave (players whose boat is within 40 tiles of the crystal), and
// the burst's size.
const common = require("./Common.BarracudaTrials");
const { isHelm, removeDeckNpc } = require("../SailingContent.Sailing");

const CRYSTAL = 15112;
const HEADBAR_NPC = 15113;
const HEADBAR = 82;
const HEADBAR_FILLS = [40, 27, 14];
const LOC_CRYSTALLISED = 59597;
const GRAPHIC_SPIKES = 3507;
const GRAPHIC_SPIKES_QUIET = 3508;
const GRAPHIC_TRAIL = 3509;
const GRAPHIC_HELM = 3505;
const SOUND_HELM = 10733;
const SOUND_STRIKE = 4156;
const TRAIL_DELAYS = [0, 12, 24, 36, 48];
const WAVE_EVERY = 20;
const SHOT_DISTANCE = 6;
const FIELD_AFTER = 3;
const FIELD_PULSES = 9;
const FIELD_EVERY = 2;
const FIELD_REACH = 3;
const VIEW_RANGE = 40;
const HIT_EVERY = 4;
const MAX_HIT = 5;
const STRIKES = 3;
const LINGER_MESSAGE = "The splintered crystals linger on the helm, making it difficult to touch.";

let pluginApi;
const crystals = [];
/** Fields of spikes now up: { tile: [x, y], from, until }. */
let fields = [];
/** Crystallised helms by boat: { loc, npc, strikes, since, hits }. */
const helms = new Map();
/** Boats whose helm was just cleared: boat -> clock. */
const cleared = new WeakMap();

function spawnCrystals() {
  for (const [x, y] of common.trialByKey("gwenith_glide").resonanceCrystals ?? []) {
    const npc = pluginApi.spawnNpc({ id: CRYSTAL, x, y, z: 0 });
    if (npc) crystals.push({ npc, aim: undefined });
  }
}

/** Player boats on the course with their owner aboard. */
function boatsOnCourse() {
  const { BoatManager, World, Sailing } = common.core();
  const trial = common.trialByKey("gwenith_glide");
  const found = [];
  for (const boat of BoatManager.all()) {
    if (boat.static || !common.inBounds(trial, boat.tileX, boat.tileY)) continue;
    const player = World.getPlayers().get(boat.ownerPlayerId);
    if (player && Sailing.instanceAboard(player) === boat) found.push({ boat, player });
  }
  return found;
}

function viewers(on, x, y) {
  return on.filter(({ boat }) => Math.max(Math.abs(boat.tileX - x), Math.abs(boat.tileY - y)) <= VIEW_RANGE).map(({ player }) => player);
}

/** The tick before a wave: each crystal picks its spot and turns to it. */
function aim() {
  const { Location } = common.core();
  for (const crystal of crystals) {
    const angle = Math.random() * Math.PI * 2;
    const at = crystal.npc.getLocation();
    crystal.aim = [at.getX() + Math.round(Math.cos(angle) * SHOT_DISTANCE), at.getY() + Math.round(Math.sin(angle) * SHOT_DISTANCE)];
    crystal.npc.faceTile(new Location(crystal.aim[0], crystal.aim[1], 0));
  }
}

function fire(on) {
  const { Graphic, Location } = common.core();
  const now = common.clock();
  for (const crystal of crystals) {
    if (!crystal.aim) continue;
    const from = crystal.npc.getLocation();
    const [tx, ty] = crystal.aim;
    const watching = viewers(on, from.getX(), from.getY());
    if (watching.length > 0) {
      TRAIL_DELAYS.forEach((delay, i) => {
        const t = (i + 1) / SHOT_DISTANCE;
        const tile = new Location(Math.round(from.getX() + (tx - from.getX()) * t), Math.round(from.getY() + (ty - from.getY()) * t), 0);
        for (const player of watching) player.getPacketSender().sendGraphic(new Graphic(GRAPHIC_TRAIL, delay), tile);
      });
    }
    fields.push({ tile: crystal.aim, from: now + FIELD_AFTER, until: now + FIELD_AFTER + (FIELD_PULSES - 1) * FIELD_EVERY });
    crystal.aim = undefined;
  }
}

function pulse(field, on) {
  const { Graphic, Location } = common.core();
  const [x, y] = field.tile;
  for (const player of viewers(on, x, y)) {
    const out = player.getPacketSender();
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const middle = dx === 0 && dy === 0;
        const graphic = middle ? new Graphic(GRAPHIC_SPIKES) : new Graphic(GRAPHIC_SPIKES_QUIET, 10 + Math.floor(Math.random() * 11));
        out.sendGraphic(graphic, new Location(x + dx, y + dy, 0));
      }
    }
  }
}

/** The helm installed on this boat (its built tier), from the boat's live spec. */
function helmLocOf(boat) {
  return common.core().BoatManager.getSpec(boat)?.locs.find(isHelm);
}

function deckTile(boat, loc) {
  return new (common.core().Location)(boat.deckBaseX + loc.x, boat.deckBaseY + loc.y, loc.level);
}

function crystallise(player, boat) {
  const helm = helmLocOf(boat);
  if (helms.has(boat) || !helm) return;
  const { BoatManager, Graphic } = common.core();
  player.sendMessage("<col=ff3045>Some crystals attach to the helm, hurting anyone who touches them!");
  BoatManager.setDeckLoc(boat, { ...helm, id: LOC_CRYSTALLISED });
  const tile = deckTile(boat, helm);
  // On the deck's level (0), where everyone aboard stands, not the helm loc's template plane.
  const npc = pluginApi.spawnNpc({ id: HEADBAR_NPC, x: tile.getX(), y: tile.getY(), z: 0 });
  if (npc) {
    BoatManager.getDeck(boat)?.enter(npc);
    npc.showHeadbar(HEADBAR, { fill: HEADBAR_FILLS[0] });
  }
  helms.set(boat, { loc: helm, npc, strikes: 0, since: common.clock(), hits: 0 });
  const out = player.getPacketSender();
  out.sendGraphic(new Graphic(GRAPHIC_HELM), tile);
  out.sendSoundEffect(SOUND_HELM, 1, 0);
}

/**
 * Takes the crystals off the helm: the third strike (message, 3505, 10733 and a burst), a reset
 * (message and 3505), or the owner gone (nothing sent).
 */
function clearHelm(player, boat, { by = "strikes" } = {}) {
  const crystallised = helms.get(boat);
  if (!crystallised) return;
  helms.delete(boat);
  removeDeckNpc(pluginApi, boat, crystallised.npc);
  const { BoatManager, Graphic } = common.core();
  BoatManager.setDeckLoc(boat, crystallised.loc);
  cleared.set(boat, common.clock());
  if (by === "gone" || !player) return;
  player.sendMessage("<col=229628>The crystals have been successfully removed from the helm, granting a burst of speed.");
  const out = player.getPacketSender();
  out.sendGraphic(new Graphic(GRAPHIC_HELM), deckTile(boat, crystallised.loc));
  if (by !== "strikes") return;
  out.sendSoundEffect(SOUND_HELM, 1, 0);
  require("./Gwenith.BarracudaTrials").burst(boat, "crystals");
}

function strike(player, boat) {
  const crystallised = helms.get(boat);
  if (!crystallised) return;
  crystallised.strikes++;
  if (crystallised.strikes >= STRIKES) return clearHelm(player, boat);
  player.getPacketSender().sendSoundEffect(SOUND_STRIKE, 1, 0);
  crystallised.npc?.showHeadbar(HEADBAR, { fill: HEADBAR_FILLS[crystallised.strikes] });
}

/** Hits whoever holds a crystallised helm: the tick after, then every 4 ticks, harder every third, at most 5. */
function hurt(boat, crystallised) {
  const since = common.clock() - crystallised.since;
  if (since < 1 || (since - 1) % HIT_EVERY !== 0) return;
  const holder = boat.helmPlayerId === undefined ? undefined : common.core().World.getPlayers().get(boat.helmPlayerId);
  const damage = Math.min(MAX_HIT, Math.floor(crystallised.hits / 3) + 1);
  crystallised.hits++;
  if (!holder) return;
  const { HitDamage, HitMask } = common.core();
  holder.getCombat().getHitQueue().addPendingDamage([new HitDamage(damage, HitMask.RED)]);
}

function tick() {
  const now = common.clock();
  const on = boatsOnCourse();
  // Helms whose boat is gone or whose owner left: back to normal.
  for (const [boat, crystallised] of [...helms]) {
    const owner = common.core().World.getPlayers().get(boat.ownerPlayerId);
    if (common.core().BoatManager.getBoat(boat.entityIndex) !== boat || !owner || common.core().Sailing.instanceAboard(owner) !== boat) {
      clearHelm(owner, boat, { by: "gone" });
      continue;
    }
    hurt(boat, crystallised);
    crystallised.npc?.showHeadbar(HEADBAR, { fill: HEADBAR_FILLS[crystallised.strikes] });
  }
  if (now % WAVE_EVERY === WAVE_EVERY - 1) aim();
  if (now % WAVE_EVERY === 0) fire(on);
  fields = fields.filter((field) => field.until >= now);
  for (const field of fields) {
    if (field.from > now) continue;
    if ((now - field.from) % FIELD_EVERY === 0) pulse(field, on);
    for (const { boat, player } of on) {
      if (Math.max(Math.abs(boat.tileX - field.tile[0]), Math.abs(boat.tileY - field.tile[1])) <= FIELD_REACH) crystallise(player, boat);
    }
  }
}

/** A run's reset or end takes the crystals off its boat (rsprox 936: with the message). */
function reset(player, current, { packets }) {
  const boat = current.boat ?? common.core().Sailing.instanceAboard(player);
  if (!boat) return;
  const aboard = common.core().Sailing.instanceAboard(player) === boat;
  clearHelm(player, boat, { by: packets && aboard ? "reset" : "gone" });
}

function onLoc(event) {
  if (event.clickType !== 1) return;
  const boat = common.core().Sailing.instanceAboard(event.player);
  if (!boat) return;
  if (event.objectId === LOC_CRYSTALLISED && helms.has(boat)) {
    event.handled = true;
    strike(event.player, boat);
    return;
  }
  const at = cleared.get(boat);
  if (at !== undefined && common.clock() - at <= 1 && event.objectId === helmLocOf(boat)?.id) {
    event.handled = true;
    event.player.getPacketSender().sendTypedMessage(common.core().ChatType.SPAM, LINGER_MESSAGE);
  }
}

function startWaves() {
  spawnCrystals();
  const { Task, TaskManager } = common.core();
  TaskManager.submit(new (class extends Task {
    constructor() { super(1, "barracuda-trials:resonance", false); }
    execute() { tick(); }
  })());
}

function attach(api) {
  pluginApi = api;
  common.init(api);
  api.onServerStartup(startWaves);
  api.onObjectInteraction(onLoc);
}

module.exports = attach;
module.exports.tick = tick;
module.exports.reset = reset;
module.exports.crystallise = crystallise;
module.exports.strike = strike;
module.exports.clearHelm = clearHelm;
module.exports.helmOf = (boat) => helms.get(boat);
module.exports.fields = () => fields;
