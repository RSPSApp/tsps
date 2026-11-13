"use strict";

// No XP curve is selected here. These are preparation locks, not post-protection retail rules.
const PROFILE = "deadman";
const PROTECTION_END_ATTRIBUTE = "deadman:protection-end-online";
const PROTECTION_MS = 12 * 60 * 60 * 1000;
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const ONE_MINUTE_MS = 60 * 1000;
const PAGE = "Doomsayer";
const VARIANT = "deadman-mode-worlds";
const REMOVE_OPTION = "I'd like to remove my PvP protection.";
const NOW_OPTION = "Yes, remove my PvP protection right now.";
const MINUTE_OPTION = "Yes, arrange for my PvP protection to end in 1 minute.";
let api;
let modeVarbit;

function participant(player) {
  return player?.getProfile?.() === PROFILE;
}

function onlineTime(player) {
  const request = { player, milliseconds: null };
  api.emitCustomEvent("account:play-time", request);
  if (!Number.isFinite(request.milliseconds) || request.milliseconds < 0) {
    throw new Error("Deadman preparation requires the canonical online-time query");
  }
  return request.milliseconds;
}

function protectionEnd(player) {
  const value = player.getAttribute(PROTECTION_END_ATTRIBUTE);
  return Number.isFinite(value) && value >= 0 ? value : PROTECTION_MS;
}

function remaining(player) {
  return Math.max(0, protectionEnd(player) - onlineTime(player));
}

function login({ player }) {
  if (!participant(player)) {
    throw new Error("Deadman preparation did not obtain its isolated character profile");
  }
  // The canonical fresh profile's online clock starts at its first login. No main progress is copied.
  onlineTime(player);
  player.getPacketSender().sendVarbit(modeVarbit, 1);
  player.sendMessage("Deadman source preparation is unfinished. Experience and player combat are disabled.");
}

function blockUnqualifiedExperience(event) {
  // Also fail closed on an invalid mixed-profile deployment: no ordinary-rate fallback.
  event.allow = false;
}

function blockUnfinishedPlayerCombat(event) {
  if (event.attacker?.isPlayer?.() && event.target?.isPlayer?.()) event.allow = false;
}

function queryProtection(request) {
  if (!participant(request.player)) return;
  request.remainingMilliseconds = remaining(request.player);
}

function doomsayer(event) {
  if (!participant(event.player)) return false;
  return event.definition?.getName?.() === PAGE
    || event.pages?.some((page) => page.page === PAGE);
}

function selectVariant(event) {
  if (!doomsayer(event)) return null;
  return { page: PAGE, variant: VARIANT };
}

function condition(event) {
  if (!doomsayer(event)) return null;
  const left = remaining(event.player);
  if (event.text === "No protection left:") return left === 0;
  if (event.text === "Have less than 5 minutes of protection left:") return left > 0 && left < FIVE_MINUTES_MS;
  if (event.text === "Have more than 5 minutes of protection left:") return left > FIVE_MINUTES_MS;
  return null; // At exactly five minutes neither ungrounded boundary branch is invented.
}

function choice(event) {
  if (!doomsayer(event) || (event.option !== NOW_OPTION && event.option !== MINUTE_OPTION)) return;
  // Revalidate at choice time: an old menu cannot extend or repeatedly renew a one-minute deadline.
  const now = onlineTime(event.player);
  if (protectionEnd(event.player) - now <= FIVE_MINUTES_MS) {
    event.end = true;
    event.player.sendMessage("Your protection can no longer be shortened here.");
    return;
  }
  event.player.setAttribute(PROTECTION_END_ATTRIBUTE,
    Math.min(protectionEnd(event.player), now + (event.option === NOW_OPTION ? 0 : ONE_MINUTE_MS)));
}

function removalSteps(steps) {
  for (const step of steps) {
    const option = step.options?.find((entry) => entry.text === REMOVE_OPTION);
    if (option) return option.steps;
  }
  return []; // Missing source transcript is not replaced with invented dialogue.
}

function removeProtection(event) {
  if (!participant(event.player)) return false;
  api.emitCustomEvent("npc-dialogue:start", {
    player: event.player, npc: event.npc, npcId: event.npcId,
    variant: { page: PAGE, variant: VARIANT }, exact: true, select: removalSteps,
  });
  return true;
}

module.exports = function attach(pluginApi) {
  if (pluginApi.getPluginConfig("DeadmanMode:enabled", false) !== true) return;
  api = pluginApi;
  // Install the preparation locks before claiming a profile; invalid combinations cannot gain ordinary XP.
  api.onCanGainExperience(blockUnqualifiedExperience);
  api.onCanAttack(blockUnfinishedPlayerCombat);
  api.setWorldProfile(PROFILE);
  modeVarbit = api.core.CacheDefinitions.getVarbitId("deadman_mode");
  if (!Number.isInteger(modeVarbit) || modeVarbit < 0) throw new Error("Missing deadman_mode cache identity");
  api.persistAttribute(PROTECTION_END_ATTRIBUTE, PROTECTION_MS);
  api.onPlayerLogin(login);
  api.onCustomEvent("deadman:protection", queryProtection);
  api.onNpcDialogueVariant(selectVariant);
  api.onNpcDialogueCondition(condition);
  api.onCustomEvent("npc-dialogue:choice", choice);
  api.onNpcInteraction(PAGE, { "Remove-protection": removeProtection });
};
