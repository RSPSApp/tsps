"use strict";

const Shared = require("./ColosseumShared");
const Run = require("./ColosseumRun");
const Loot = require("./ColosseumLoot");
const Effects = require("./ModifierEffects.Colosseum");
const { MODIFIERS } = require("./ColosseumModifiers");

/** ::colosseum - to the lobby under the Colosseum. */
function toLobby({ player }) {
  player.moveTo(Shared.loc(Shared.LOBBY));
  return true;
}

/** ::colokill - kills the wave under way. */
function killWave({ player }) {
  const run = Run.runOf(player);
  if (!run || run.stage !== "wave") {
    player.sendMessage("Start a wave first.");
    return true;
  }
  for (const npc of run.npcs) npc.setHitpoints(0);
  return true;
}

/** ::cologlory <glory> - sets your best Glory (it decides your title and the lobby bank). */
function setGlory({ player, parts }) {
  const value = Number(parts?.[1]);
  if (!Number.isFinite(value) || value < 0) {
    player.sendMessage("Use ::cologlory <glory>.");
    return true;
  }
  player.setAttribute(Shared.ATTR.GLORY, Math.trunc(value));
  player.sendMessage(`Your Glory is now ${Math.trunc(value)} (${Shared.rankOf(player)}).`);
  return true;
}

function intermissionRun(player) {
  const run = Run.runOf(player);
  if (run?.stage === "intermission") return run;
  player.sendMessage("Use this between waves, in a run.");
  return null;
}

/** ::colowave <1-12> - makes the next wave the given one, with its loot rolled. */
function setWave({ player, parts }) {
  const run = intermissionRun(player);
  const wave = Math.trunc(Number(parts?.[1]));
  if (!run) return true;
  if (!(wave >= 1 && wave <= Shared.FINAL_WAVE)) {
    player.sendMessage(`Use ::colowave <1-${Shared.FINAL_WAVE}>.`);
    return true;
  }
  run.wave = wave - 1;
  run.loot.future = Loot.roll(wave, player, run.random);
  player.sendMessage(`The next wave is wave ${wave}.`);
  return true;
}

/** ::colomod <modifier> <tier> - sets a modifier's tier (0 removes it), e.g. ::colomod solarflare 3. */
function setModifier({ player, parts }) {
  const run = intermissionRun(player);
  if (!run) return true;
  const modifier = MODIFIERS.find(({ id }) => id === parts?.[1]);
  const tier = Math.trunc(Number(parts?.[2] ?? 1));
  if (!modifier || !(tier >= 0 && tier <= 3)) {
    player.sendMessage(`Use ::colomod <${MODIFIERS.map(({ id }) => id).join("|")}> <0-3>.`);
    return true;
  }
  if (tier === 0) run.modifiers.tiers.delete(modifier.key);
  else run.modifiers.tiers.set(modifier.key, modifier.varbit == null ? 1 : tier);
  run.modifiers.sync(player);
  Effects.picked(run);
  player.sendMessage(`${modifier.id} is now tier ${run.modifiers.tier(modifier.key)}.`);
  return true;
}

module.exports = function registerColosseumCommands(api) {
  const { DEVELOPER } = api.core.PlayerRights;
  api.registerCommand("colosseum", toLobby, DEVELOPER, "Teleport to the Colosseum lobby");
  api.registerCommand("colokill", killWave, DEVELOPER, "Kill the active Colosseum wave");
  api.registerCommand("cologlory", setGlory, DEVELOPER, "Set your best Glory");
  api.registerCommand("colowave", setWave, DEVELOPER, "Set the next Colosseum wave (1-12)");
  api.registerCommand("colomod", setModifier, DEVELOPER, "Set a Colosseum modifier tier");
};
