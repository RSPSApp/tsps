/**
 * Araxxor's boss health bar, through the shared BossHud plugin (boss-hud:* events). As the
 * captures show it (headbar type 20 on the boss): it appears with the fight, follows her
 * hitpoints and lingers through the enrage. After a kill it fades and clears; leaving the
 * lair or logging out drops it at once.
 */
const Shared = require("./Shared.Araxxor");

const FADE_AFTER_DEATH_TICKS = 4;

let api = null;
let core = null;
/** npc -> { player, current } for each bar on show. */
const bars = new Map();

function values(npc, player) {
  return {
    player,
    npcId: Shared.BOSS_ID,
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

function killed(npc) {
  const bar = bars.get(npc);
  if (!bar) return;
  bars.delete(npc);
  later(FADE_AFTER_DEATH_TICKS, () => api.emitCustomEvent("boss-hud:hide", { player: bar.player }));
}

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

module.exports = { attach, show, killed, dropFor, tick, bars, _test: { values, bars } };
