"use strict";

const Shared = require("./Shared.Colosseum");

// RSProx 237/1150: landing at t14765, first phase line at t14797 and kill at t14991.
const SHOW_DELAY = 2;
const PHASE_REFRESH_TICKS = 5;
const KILL_REFRESH_TICKS = 8;
const KILL_FADE_DELAY = 13;

function landed(run) {
  const fight = run.solFight;
  Shared.later(run, SHOW_DELAY, () => {
    if (run.stage !== "wave" || run.dying || run.solFight !== fight) return;
    const current = fight.npc.getHitpoints();
    if (current <= 0) return;
    fight.hud = { current };
    Shared.api().emitCustomEvent("boss-hud:show", {
      player: run.player,
      npcId: fight.npc.getId(),
      current,
      maximum: fight.npc.getMaxHitpoints(),
      fadeIn: false,
    });
  });
}

function update(run, hitpoints = run.solFight.npc.getHitpoints()) {
  const hud = run.solFight.hud;
  if (!hud) return;
  const current = Math.max(0, hitpoints);
  if (hud.current === current) return;
  hud.current = current;
  Shared.api().emitCustomEvent("boss-hud:update", { player: run.player, current });
}

/** Send each hit, including hits that share a game tick. The fight tick covers healing. */
function damageApplied({ target }) {
  const run = target?.__colosseumRun;
  if (run && run.solFight?.npc === target) update(run);
}

function refresh(run, hud, remaining) {
  hud.refresh?.stop();
  hud.refresh = Shared.repeat(run, 1, () => {
    if (run.solFight?.hud !== hud) return false;
    Shared.api().emitCustomEvent("boss-hud:fade", { player: run.player, fadeIn: true });
    remaining -= 1;
    return remaining > 0;
  });
}

function phaseChanged(run) {
  const hud = run.solFight.hud;
  if (hud) refresh(run, hud, PHASE_REFRESH_TICKS);
}

function defeated(run) {
  const fight = run.solFight;
  const hud = fight.hud;
  if (!hud) return;
  update(run, 0);
  refresh(run, hud, KILL_REFRESH_TICKS);
  Shared.later(run, KILL_FADE_DELAY, () => {
    if (run.solFight?.hud !== hud) return;
    fight.hud = null;
    Shared.api().emitCustomEvent("boss-hud:hide", { player: run.player, clearContainer: true });
  });
}

function drop(run) {
  const fight = run.solFight;
  if (!fight?.hud) return;
  fight.hud.refresh?.stop();
  fight.hud = null;
  Shared.api().emitCustomEvent("boss-hud:hide", { player: run.player, fade: false, afterTicks: 0 });
}

module.exports = { landed, update, damageApplied, phaseChanged, defeated, drop };
