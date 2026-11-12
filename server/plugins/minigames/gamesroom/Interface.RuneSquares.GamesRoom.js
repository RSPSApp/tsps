'use strict';

// Revision241 native scripts: show_ops then update_grid clears occupied edges.
const SHOW_OPS_SCRIPT = 4021;
const UPDATE_GRID_SCRIPT = 4022;
let cache;
function configure(core) { cache = core.CacheDefinitions; }
function component(name) {
  const id = cache.getComponentId(`boardgames_runesquares:${name}`);
  if (id == null) throw new Error(`Missing RuneSquares component: ${name}`);
  return id;
}

function decode(buttonId) {
  for (const axis of ['h', 'v']) {
    for (let edge = 0; edge < 56; edge++) {
      if (['small', 'large'].some(size => buttonId === component(`${axis}${edge}_${size}`))) return { axis, edge };
    }
  }
  return null;
}

function refresh(player, match) {
  const sender = player.getPacketSender();
  const active = !match.state.result && match.players[match.state.turn] === player;
  for (const axis of ['h', 'v']) {
    const edges = match.state[axis];
    for (let half = 0; half < 2; half++) {
      let bits = 0;
      for (let bit = 0; bit < 32 && half * 32 + bit < 56; bit++) {
        if (edges[half * 32 + bit]) bits |= 1 << bit;
      }
      const name = `boardgames_runesquares_${axis}${half === 0 ? 'a' : 'b'}`;
      const id = cache.getVarpId(name);
      if (id == null) throw new Error(`Missing RuneSquares varp: ${name}`);
      sender.sendConfig(id, bits);
    }
    for (let edge = 0; edge < 56; edge++) {
      for (const size of ['small', 'large']) {
        sender.sendInterfaceFlagsRange(component(`${axis}${edge}_${size}`), -1, -1, active && !edges[edge] ? 2 : 0);
      }
    }
  }
  sender.sendInterfaceScript(SHOW_OPS_SCRIPT, [active ? 1 : 0]);
  sender.sendInterfaceScript(UPDATE_GRID_SCRIPT, []);
  if (!match.drawOffer) sender.sendString(`Squares: ${match.state.scores[0]} - ${match.state.scores[1]}`, component('status2'));
}

function roomOverlay(player, visible) {
  const group = cache.getInterfaceId('boardgames_runesquares_overlay');
  const target = cache.getComponentId('toplevel_osrs_stretch:overlay_hud');
  if (group == null || target == null) throw new Error('Missing RuneSquares rank overlay');
  const sender = player.getPacketSender();
  const current = sender.getSubInterfaceAt(target);
  if (visible && current?.groupId !== group) sender.sendSubInterface(target, group, 1);
  else if (!visible && current?.groupId === group) sender.closeSubInterfaceMount(current);
}

module.exports = { configure, decode, refresh, roomOverlay };
