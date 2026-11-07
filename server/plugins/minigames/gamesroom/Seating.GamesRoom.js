let core;
let animations;
const sessions = new WeakMap();
const owners = new WeakMap();

function configure(apiCore) {
  core = apiCore;
  animations = Object.fromEntries(['ready', 'scratch', 'think', 'move'].map(name => {
    const id = core.CacheDefinitions.getSeqId(`human_sittingdown_${name}`);
    if (id == null) throw new Error(`Missing Games Room seating sequence: ${name}`);
    return [name, id];
  }));
}

function normalAnimations(player) {
  const weapon = player.getEquipment().getItems()[core.Equipment.WEAPON_SLOT]?.getDefinition();
  const sequence = name => core.CacheDefinitions.getSeqId(name);
  // Same weapon/default movement set as PlayerSession's appearance encoder.
  return [weapon?.getStandAnim() ?? sequence('human_ready'), sequence('human_turnonspot'),
    weapon?.getWalkAnim() ?? sequence('human_walk_f'), sequence('human_walk_b'),
    sequence('human_walk_l'), sequence('human_walk_r'), weapon?.getRunAnim() ?? sequence('human_running')];
}

function animate(state, name) {
  const player = state.player;
  if (player.getAnimationGeneration() === state.animationGeneration && player.getAnimation()) {
    player.performAnimation(core.Animation.DEFAULT_RESET_ANIMATION);
  }
  const animation = new core.Animation(animations[name]);
  const before = player.getAnimationGeneration();
  player.performAnimation(animation);
  if (player.getAnimationGeneration() !== before) state.animationGeneration = player.getAnimationGeneration();
}

// Historical implementation explicitly records think/scratch every 5–9 game
// ticks, equip-substituted stool sequences, face-opponent and reset at finish.
// No local live OSRS gameplay capture establishes this interval independently.
// https://github.com/LostCityRS/Content/blob/65b754f768b79b941b21b2a1eb3b0d1ecae3cdfe/scripts/minigames/game_gamesroom/general/scripts/boardgames.rs2
function interval() {
  return 5 + Math.floor(Math.random() * 5);
}

function seat(match) {
  if (sessions.has(match)) return;
  const cycle = core.World.getProcessCycle();
  const states = match.players.map((player, side) => {
    const previous = owners.get(player);
    const inherited = previous && player.getRenderAnimations() === previous.applied;
    const prior = inherited ? previous.prior : player.getRenderAnimations();
    const applied = [...(prior ?? normalAnimations(player))];
    applied[0] = animations.ready;
    applied[1] = animations.ready;
    const state = { player, prior, applied, side, active: match.state.turn === side,
      next: cycle + interval(), previousFace: inherited ? previous.previousFace : player.getPositionToFace(),
      animationGeneration: previous?.animationGeneration };
    player.setRenderAnimations(applied);
    player.getUpdateFlag().flag(core.Flag.APPEARANCE);
    player.setPositionToFace(match.players[1 - side].getLocation().clone());
    state.appliedFace = player.getPositionToFace();
    owners.set(player, state);
    animate(state, 'ready');
    return state;
  });
  sessions.set(match, states);
}

function process(match, player, cycle) {
  const state = sessions.get(match)?.find(entry => entry.player === player);
  if (!state || owners.get(player) !== state) return;
  const active = match.state.turn === state.side;
  if (active !== state.active) {
    state.active = active;
    animate(state, 'ready');
    state.next = cycle + interval();
  }
  if (active && cycle >= state.next) {
    animate(state, Math.random() < 0.5 ? 'think' : 'scratch');
    state.next = cycle + interval();
  }
}

function moved(match, player) {
  const state = sessions.get(match)?.find(entry => entry.player === player);
  if (state && owners.get(player) === state) animate(state, 'move');
}

function release(match) {
  const states = sessions.get(match);
  if (!states) return;
  sessions.delete(match);
  for (const state of states) {
    const player = state.player;
    if (owners.get(player) !== state) continue;
    owners.delete(player);
    if (player.getRenderAnimations() === state.applied) {
      player.setRenderAnimations(state.prior);
      player.getUpdateFlag().flag(core.Flag.APPEARANCE);
    }
    if (player.getPositionToFace() === state.appliedFace) player.setPositionToFace(state.previousFace);
    if (player.getAnimationGeneration() === state.animationGeneration) player.performAnimation(core.Animation.DEFAULT_RESET_ANIMATION);
  }
}

module.exports = { configure, seat, process, moved, release };
