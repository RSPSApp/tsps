/**
 * Spores, as captured: her animation, the spores planted a tick later in one of four layouts, the
 * message and their growth a tick after that, armed on the fifth. A player who comes within a tile
 * of an armed spore bursts it (its animation and sound; it's gone two ticks later) and turns
 * drowsy (Specials.Nightmare). Those left burst by themselves on the thirtieth tick.
 * Phosani's comes with a run of six sets of her claws six ticks after her animation.
 */
const Common = require("./Common.Nightmare");

const CHAIN_AFTER = 6;

function start(fight) {
  const { spores } = Common.data;
  fight.boss.performAnimation(Common.animation(spores.anim));
  for (const player of fight.players()) Common.sounds(player, spores.sounds);
  const layout = Common.pick(spores.layouts);
  const state = { locs: [], armed: false, start: fight.tick, previousTiles: new Map() };
  fight.spores = state;
  fight.at(spores.initialTicks, () => {
    if (fight.spores !== state) return;
    const { GameObject, ObjectManager } = Common.core;
    state.locs = layout.map(([x, y]) => {
      const object = new GameObject(spores.locs.initial, fight.dream.tile([x, y]), 10, 0, fight.dream.area);
      object.__sporeTile = [x, y];
      ObjectManager.register(object, true);
      return object;
    });
    for (const player of fight.players()) Common.sounds(player, [spores.initialSound]);
  });
  fight.at(spores.messageTicks, () => {
    if (fight.spores !== state) return;
    for (const player of fight.players()) {
      player.getPacketSender().sendTypedMessage(Common.core.ChatType.SPAM, spores.message);
      for (const object of state.locs) player.getPacketSender().sendObjectAnimation(object, Common.animation(spores.spawnAnim));
    }
  });
  fight.at(spores.armTicks, () => {
    if (fight.spores !== state) return;
    state.locs = state.locs.map((object) => replace(fight, object, spores.locs.armed));
    state.armed = true;
  });
  if (fight.phosani) {
    const { chain } = Common.data.claws;
    fight.at(CHAIN_AFTER, () => {
      if (fight.spores === state && fight.stage !== "blast") require("./Claws.Nightmare").chain(fight, false, chain.sporesCount);
    });
    return CHAIN_AFTER + chain.every * chain.sporesCount + 6;
  }
  return null;
}

function replace(fight, object, id) {
  const { GameObject, ObjectManager } = Common.core;
  ObjectManager.deregister(object, false);
  const next = new GameObject(id, object.getLocation(), 10, 0, fight.dream.area);
  next.__sporeTile = object.__sporeTile;
  ObjectManager.register(next, true);
  return next;
}

function burst(fight, object) {
  const state = fight.spores;
  if (!state || !state.locs.includes(object)) return;
  const { spores } = Common.data;
  state.locs = state.locs.filter((other) => other !== object);
  const players = fight.players();
  for (const player of players) player.getPacketSender().sendObjectAnimation(object, Common.animation(spores.burstAnim));
  Common.areaSound(players, object.getLocation(), spores.burstSound);
  fight.at(2, () => Common.core.ObjectManager.deregister(object, false));
}

function nearby(state, tile) {
  if (!tile) return [];
  const [px, py] = tile;
  return state.locs.filter(({ __sporeTile: [x, y] }) => Math.max(Math.abs(px - x), Math.abs(py - y)) <= 1);
}

/** A player sets off spores beside the tile they occupied after the previous move. */
function processPlayer(fight, player) {
  const state = fight.spores;
  if (!state) return;
  const previous = state.previousTiles.get(player);
  state.previousTiles.set(player, fight.dream.arenaTile(player.getLocation()));
  if (!state.armed || fight.tick <= state.start + Common.data.spores.armTicks) return;
  const spores = nearby(state, previous);
  if (spores.length === 0) return;
  require("./Specials.Nightmare").makeDrowsy(fight, player);
  for (const object of spores) burst(fight, object);
}

function process(fight) {
  const state = fight.spores;
  if (!state || fight.tick < state.start + Common.data.spores.endTicks) return;
  for (const player of fight.players()) {
    if (nearby(state, state.previousTiles.get(player)).length > 0) {
      require("./Specials.Nightmare").makeDrowsy(fight, player);
    }
  }
  burstAll(fight);
}

function burstAll(fight) {
  const state = fight.spores;
  if (!state) return;
  for (const object of [...state.locs]) burst(fight, object);
  fight.spores = null;
}

function playerLeft(fight, player) {
  fight.spores?.previousTiles.delete(player);
}

function clear(fight) {
  const state = fight.spores;
  if (!state) return;
  for (const object of state.locs) Common.core.ObjectManager.deregister(object, false);
  fight.spores = null;
}

module.exports = { start, process, processPlayer, burstAll, playerLeft, clear };
