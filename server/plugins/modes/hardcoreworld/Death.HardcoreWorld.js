"use strict";

/**
 * A Hardcore character's death that counts (it lost items: every safe minigame keeps them, as
 * for Hardcore Ironmen) is told to the whole world, then the character must choose how to go on
 * (Choice). It listens on `player:died`, which every death reaches, rather than `onPlayerDeath`,
 * which stops at the first handler that takes the respawn (a quest's, Death's first-grave visit).
 *
 * The broadcast, as live sends it to everyone (every session on worlds 634-670, 2026-11-04/05):
 *   "@mes_hl_ora@TzHaar-Ket killed Died Quick(33) with a 10 damage hit in Karamja.</col>"
 *   "@mes_hl_ora@Fast Plank(33) was killed by a 1 damage hit in Misthalin.</col>"
 * with no " in <area>" where the square belongs to no area. The name is the dead player's
 * display name and combat level; the hit is the killing blow; an NPC that dealt it is named.
 * The area is the cache's region (league:area-at, base). The highlight's colour follows each
 * reader's chatbox, as live's client does.
 */
const Common = require("./Common.HardcoreWorld");
const Choice = require("./Choice.HardcoreWorld");

const CHATBOX_TRANSPARENCY = 4608;

function regionName(location) {
  const query = { x: location.getX(), y: location.getY(), base: true, name: null };
  Common.api().emitCustomEvent("league:area-at", query);
  return query.name ?? null;
}

/** The broadcast line for a death, before its highlight is resolved. */
function broadcastText(player, hit, location) {
  const { messages } = Common.DATA;
  const region = regionName(location);
  const source = hit?.getSource?.() ?? null;
  const values = {
    name: player.getDisplayName?.() ?? player.getUsername(),
    level: player.getSkillManager().getCombatLevel(),
    damage: Math.max(0, hit?.getDamage?.() ?? 0),
    where: region ? Common.format(messages.deathWhere, { region }) : "",
    npc: source?.isNpc?.() ? source.getDefinition?.()?.getName?.() : null,
  };
  return Common.format(values.npc ? messages.deathByNpc : messages.death, values);
}

function broadcast(text) {
  const { World, resolveChatHighlights } = Common.core();
  World.getPlayers().forEach((reader) => {
    if (!reader) return;
    const transparent = reader.getPacketSender().getVarbit(CHATBOX_TRANSPARENCY) === 1;
    reader.sendMessage(resolveChatHighlights(text, transparent));
  });
}

function death(event) {
  const { player } = event;
  if (!Common.isHardcore(player) || event.itemsLost === false) return;
  if (player.getAttribute(Common.CHOICE_PENDING_ATTRIBUTE) === true) return;
  const hit = player.getCombat?.()?.getHitQueue?.()?.getLastAppliedHit?.() ?? null;
  broadcast(broadcastText(player, hit, player.getLocation()));
  const today = Common.today();
  player.setAttribute(Common.DIED_DATE_ATTRIBUTE, today);
  player.setAttribute(Common.CHOICE_PENDING_ATTRIBUTE, true);
  player.setAttribute(Common.DEATH_OPTION_ATTRIBUTE, 0);
  Common.setVarbit(player, "diedDate", today);
  Common.api().emitCustomEvent("persistence:save", { player, reason: "hardcore-death" });
  Choice.afterDeath(player);
}

module.exports = function attach(api) {
  api.onCustomEvent("player:died", death);
};

Object.assign(module.exports, { death, broadcastText, regionName });
