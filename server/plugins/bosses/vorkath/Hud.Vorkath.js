/**
 * Vorkath's boss health bar, through the shared BossHud plugin (boss-hud:* events). As rsprox
 * captures show it: it appears (npc 8061, 750/750, boss mode, the usual colours) on the tick
 * she turns awake, follows her hitpoints, and after a kill fades out 10 ticks after her death
 * animation and clears 4 ticks after that (BossHud's own hide). Her zombified spawn never
 * takes the bar. Leaving the crater or logging out drops it at once.
 */
const Shared = require("./Shared.Vorkath");

/** Death event (her NPC's removal, 6 ticks after the animation) to the fade: 4 ticks. */
const FADE_AFTER_DEATH_TICKS = 4;

let api = null;
let core = null;
/** npc -> { player, current } for each bar on show. */
const bars = new Map();

function values(npc, player) {
  return {
    player,
    npcId: Shared.AWAKE_ID,
    current: Math.max(0, npc.getHitpoints?.() ?? 0),
    maximum: Shared.MAX_HITPOINTS,
  };
}

function show(npc, player) {
  if (!npc || !player) return;
  const bar = values(npc, player);
  bars.set(npc, { player, current: bar.current });
  api.emitCustomEvent("boss-hud:show", bar);
}

/** Keeps each bar on her hitpoints; sends only when they changed. */
function tick() {
  for (const [npc, bar] of bars) {
    if (!bar.player?.isRegistered?.()) {
      bars.delete(npc);
      continue;
    }
    const current = Math.max(0, npc.getHitpoints?.() ?? 0);
    if (current === bar.current) continue;
    bar.current = current;
    api.emitCustomEvent("boss-hud:update", { player: bar.player, current });
  }
}

function later(ticks, action) {
  core.TaskManager.submit(new (class extends core.Task {
    constructor() {
      super(Math.max(1, ticks), null, false);
    }
    execute() {
      this.stop();
      action();
    }
  })());
}

/** After a kill: the captured fade, then BossHud clears it 4 ticks later. */
function killed(npc) {
  const bar = bars.get(npc);
  if (!bar) return;
  bars.delete(npc);
  later(FADE_AFTER_DEATH_TICKS, () => api.emitCustomEvent("boss-hud:hide", { player: bar.player }));
}

/** Leaving the crater or logging out: gone at once. */
function dropFor(player) {
  for (const [npc, bar] of bars) {
    if (bar.player !== player) continue;
    bars.delete(npc);
    api.emitCustomEvent("boss-hud:hide", { player, fade: false, afterTicks: 0 });
  }
}

function attach(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  core.TaskManager.submit(new (class extends core.Task {
    constructor() {
      super(1, null, false);
    }
    execute() {
      tick();
    }
  })());
}

module.exports = { attach, show, killed, dropFor, tick, bars, _test: { values, tick, bars } };
