// The Gwenith Glide's crystals and portals (rsprox, recordings 936, 1030, 1031 and 1032):
//   Each elven clan's crystal by Gwyna has a pair of portals beside it; both send the boat to the
//   same place far out in the crystal-flecked waters. That clan's return portal sends it back, out
//   beside the other portal of the pair it last left through (another clan's pair: each return
//   portal has its own side), and imbues the crystal if the rank needs it and it isn't yet: "You
//   imbue the Crystal of X (k/N)!" (k a running count, any order). The portals work for any boat
//   on the course, in a trial or not (936, before the intro); only a run imbues.
//   A portal at tick T: the imbue, the HUD closed, the portal effect and sound 10747; T+1 "The boat
//   is sucked through the portal and sent somewhere else." (spam), the boat teleported to the exit
//   with a new heading, a burst of speed; T+5 the effect closed and the HUD back. The effect:
//   gotr_overlay (745) with script 5984 in the clan's colour, 5985 at T+2; with full screen effects
//   off a fade out at T and in at T+2. The last crystal of a three-crystal rank sends the boat to
//   the start instead, and the completion follows from T (closing at T+2, done at T+3).
//   The ranks need the clans in order: ithell, amlodd, cadarn (Unranked, Swordfish), crwys, hefin
//   (Shark), iorwerth, meilyr, trahaearn (Marlin). The HUD shows them as "1|0|...|" in that order.
//   Crystal motes (58980): "The crystal mote grants both a small burst of speed as well as a wind
//   mote.", map_anim 3503 (height 50) on the mote and sound 10895; taken 2-4 tiles from the boat's
//   centre, and again 6-8 ticks later.
// Ours: the portal's reach (1 tile round it; live triggered 0-3 tiles off the centre, the hull),
// the return exits never captured (the other side of the pair, mirrored), the colours of the five
// clans never seen with effects on (Ithell's), the bursts' size and length, a mote's reach (3) and
// wait (6 ticks), and no wind catcher yet, so a mote's wind mote isn't kept.
const common = require("./Common.BarracudaTrials");
const run = require("./Run.BarracudaTrials");
const supplies = require("./Supplies.BarracudaTrials");
const { fade } = require("../SailingContent.Sailing");

const PORTAL_IDS = new Set([58937, 58938, 58942, 58946, 58947, 58952, 58957, 58962, 58964, 58969, 58971, 58976]);
const MOTE = 58980;
const OVERLAY_ATMOSPHERE = (161 << 16) | 1;
const GOTR_OVERLAY = 745;
const SCRIPT_GOTR_PORTAL = 5984;
const SCRIPT_GOTR_REMOVE = 5985;
const GOTR_MODEL = 54330;
const DEFAULT_COLOUR = 16316664;
const VARBIT_EFFECTS_OFF = "settings_colourful_fade_disabled";
const SOUND_PORTAL = 10747;
const SOUND_MOTE = 10895;
const GRAPHIC_MOTE = 3503;
const MOTE_HEIGHT = 50;
const PORTAL_REACH = 1;
const PORTAL_WAIT = 2;
const EFFECT_TICKS = 5;
const FADE_CYCLES = 15;
const MOTE_REACH = 3;
const MOTE_WAIT = 6;
/** Each burst's extra (fine units a tick, a step past the sails) and how long it lasts. */
const BURSTS = { portal: [64, 8], mote: [64, 5], crystals: [64, 8] };

/** Per boat on the course: { lastOut, portalAt, bursts, motes }. */
const boats = new WeakMap();

function trial() {
  return common.trialByKey("gwenith_glide");
}

function crystalVarbit(clan) {
  return common.varbit(`sailing_bt_gwenith_glide_crystal_${clan}_deactivated`);
}

/** The clans a rank needs, by how many crystals it has. */
function clansOf(current) {
  return trial().clans.slice(0, current.rankData.objectives);
}

function boatState(boat) {
  let state = boats.get(boat);
  if (!state) {
    state = { lastOut: undefined, portalAt: -Infinity, bursts: new Map(), motes: new Map() };
    boats.set(boat, state);
  }
  return state;
}

let portalIndex;

/** Every portal on the map with what it does: { loc, pair?, member?, back? }. */
function portals() {
  if (portalIndex) return portalIndex;
  const at = (loc, [x, y]) => loc.x === x && loc.y === y;
  portalIndex = [];
  for (const loc of common.mapLocs(trial(), "portals", PORTAL_IDS)) {
    for (const pair of trial().portalPairs) {
      const member = pair.portals.findIndex((tile) => at(loc, tile));
      if (member >= 0) portalIndex.push({ loc, pair, member });
    }
    const back = trial().returnPortals.find((portal) => at(loc, portal.at));
    if (back) portalIndex.push({ loc, back });
  }
  return portalIndex;
}

function near(loc, [x, y], reach) {
  const dx = Math.max(loc.x - x, 0, x - (loc.x + loc.sizeX - 1));
  const dy = Math.max(loc.y - y, 0, y - (loc.y + loc.sizeY - 1));
  return Math.max(dx, dy) <= reach;
}

function burst(boat, kind) {
  const [factor, ticks] = BURSTS[kind];
  boat.burstBonuses.set(`gwenith:${kind}`, factor);
  boatState(boat).bursts.set(kind, common.clock() + ticks);
}

function later(player, ticks, action) {
  const { CountdownTask, TaskManager } = common.core();
  TaskManager.submit(new CountdownTask(player, ticks, action));
}

function start(player, current) {
  current.state = { imbued: new Set() };
  const clans = clansOf(current);
  // Live sends the later ranks' clans first (Marlin: iorwerth.. trahaearn, crwys, hefin, then the first three).
  const order = [...clans.slice(5), ...clans.slice(3, 5), ...clans.slice(0, 3)];
  for (const clan of order) player.getPacketSender().sendVarbit(crystalVarbit(clan), 1);
}

function effectsOff(player) {
  return player.getPacketSender().getVarbit(common.varbit(VARBIT_EFFECTS_OFF)) === 1;
}

/** The portal's effect at T, its overlay closed at T+5 (rsprox 936, 1030). */
function portalEffect(player, clan) {
  const out = player.getPacketSender();
  if (effectsOff(player)) {
    fade(player, true, FADE_CYCLES, { minimap: false });
    later(player, 2, () => fade(player, false, FADE_CYCLES, { minimap: false }));
    return;
  }
  const colour = trial().portalColours?.[clan] ?? DEFAULT_COLOUR;
  out.sendSubInterface(OVERLAY_ATMOSPHERE, GOTR_OVERLAY, 1, { postScripts: [{ scriptId: SCRIPT_GOTR_PORTAL, args: [GOTR_MODEL, colour] }] });
  later(player, 2, () => out.sendClientScript(SCRIPT_GOTR_REMOVE));
}

/** The run a portal counts for: the player's Gwenith Glide run, once under way. */
function runFor(player) {
  const current = common.runs.get(player);
  return current?.trial.key === "gwenith_glide" && current.state?.imbued && !current.finishing ? current : undefined;
}

/** Through a portal: where it sends the boat, and on a run the imbue if it's a return portal the rank needs. */
function enter(player, boat, portal) {
  const state = boatState(boat);
  const running = runFor(player);
  state.portalAt = common.clock();
  let exit;
  let clan;
  if (portal.pair) {
    clan = portal.pair.clan;
    exit = portal.pair.exits?.[portal.member] ?? portal.pair.exit;
    if (clan) state.lastOut = { clan, member: portal.member };
  } else {
    clan = portal.back.clan;
    const member = state.lastOut?.clan === clan ? state.lastOut.member : portal.back.default ?? 0;
    exit = portal.back.exits[member];
    const clans = running ? clansOf(running) : [];
    if (running && clans.includes(clan) && !running.state.imbued.has(clan)) {
      running.state.imbued.add(clan);
      player.getPacketSender().sendVarbit(crystalVarbit(clan), 0);
      const name = clan[0].toUpperCase() + clan.slice(1);
      player.sendMessage(`<col=3366ff>You imbue the Crystal of ${name} (${running.state.imbued.size}/${clans.length})!</col>`);
      if (running.state.imbued.size === clans.length) {
        if (clans.length <= 3) exit = running.trial.start;
        if (running.remaining.size === 0) run.finish(player, running);
      }
    }
  }
  if (running) run.closeHud(player);
  portalEffect(player, clan);
  player.getPacketSender().sendSoundEffect(SOUND_PORTAL, 1, 0);
  later(player, 1, () => {
    if (common.core().Sailing.instanceAboard(player) !== boat) return;
    player.getPacketSender().sendTypedMessage(common.core().ChatType.SPAM, "The boat is sucked through the portal and sent somewhere else.");
    common.core().BoatManager.teleport(boat, exit);
    burst(boat, "portal");
  });
  later(player, EFFECT_TICKS, () => {
    player.getPacketSender().closeSubInterface(OVERLAY_ATMOSPHERE);
    if (running && runFor(player) === running) run.openHud(player);
  });
}

function motes(player, boat, tiles) {
  const state = boatState(boat);
  const now = common.clock();
  for (const mote of common.mapLocs(trial(), "motes", new Set([MOTE]))) {
    if ((state.motes.get(mote) ?? -Infinity) > now || !tiles.some((tile) => near(mote, tile, MOTE_REACH))) continue;
    state.motes.set(mote, now + MOTE_WAIT);
    player.sendMessage("<col=229628>The crystal mote grants both a small burst of speed as well as a wind mote.");
    const { Graphic, Location } = common.core();
    const out = player.getPacketSender();
    out.sendGraphic(new Graphic(GRAPHIC_MOTE, 0, MOTE_HEIGHT), new Location(mote.x, mote.y, 0));
    out.sendSoundEffect(SOUND_MOTE, 1, 0);
    burst(boat, "mote");
    require("../WindCatcher.Helm").addCrystalMote(player);
  }
}

/** Every player's boat on the course, each tick after the boats move. */
function tickCourse() {
  const { BoatManager, World, Sailing } = common.core();
  const now = common.clock();
  for (const boat of BoatManager.all()) {
    if (boat.static || !common.inBounds(trial(), boat.tileX, boat.tileY)) continue;
    const player = World.getPlayers().get(boat.ownerPlayerId);
    if (!player || Sailing.instanceAboard(player) !== boat) continue;
    const state = boatState(boat);
    for (const [kind, until] of [...state.bursts]) {
      if (until > now) continue;
      state.bursts.delete(kind);
      boat.burstBonuses.delete(`gwenith:${kind}`);
    }
    // A run's boat waits moored until its timer starts.
    const current = common.runs.get(player);
    if (current && !current.timing) continue;
    const tiles = supplies.pathTiles(boat);
    if (now - state.portalAt >= PORTAL_WAIT) {
      const portal = portals().find(({ loc }) => tiles.some((tile) => near(loc, tile, PORTAL_REACH)));
      if (portal) enter(player, boat, portal);
    }
    motes(player, boat, tiles);
  }
}

function crystalString(current) {
  return clansOf(current).map((clan) => `${current.state.imbued.has(clan) ? 1 : 0}|`).join("");
}

function end(player, current, { packets }) {
  if (!current.state?.imbued) return;
  require("./Resonance.BarracudaTrials").reset(player, current, { packets });
  if (!packets) return;
  for (const clan of clansOf(current)) player.getPacketSender().sendVarbit(crystalVarbit(clan), 0);
}

const mechanic = {
  start,
  end,
  hud: (player, current) => [current.state.imbued.size, 0, 0, crystalString(current)],
  // The last imbue starts the completion itself, on its own tick; this covers a last crate after it.
  done: (player, current) => current.state.imbued.size >= current.rankData.objectives,
};

function attach(api) {
  common.init(api);
  run.registerMechanic("gwenith_glide", mechanic);
  common.core().BoatManager.onAfterTick(tickCourse);
}

module.exports = attach;
module.exports.mechanic = mechanic;
module.exports.portals = portals;
module.exports.enter = enter;
module.exports.burst = burst;
module.exports.tickCourse = tickCourse;
module.exports.crystalString = crystalString;
