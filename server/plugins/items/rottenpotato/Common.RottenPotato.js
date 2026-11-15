"use strict";

/**
 * What every Rotten potato unit shares: who may use it, its menus and its prompts.
 *
 * Live's options open right-click submenus (Wiki: Rotten potato), but this cache gives the potato no
 * subops, so the client has nothing to draw. Each option's entries open as a chatbox menu instead,
 * four to a page with "More..." when there are more than five.
 */

const POTATO_NAME = "Rotten potato";
const REFUSAL = "Nothing interesting happens.";
const PAGE_SIZE = 4;
const MORE = "More...";
const MAX_OPTIONS = 5;

let api = null;
let core = null;

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

const getApi = () => api;
const getCore = () => core;
const potatoId = () => core.ItemIdentifiers.ROTTEN_POTATO;

/** Jagex moderators only on live; owners and developers here. Anyone else gets the refusal. */
function permitted(player) {
  if (player?.getRights?.()?.getId?.() >= core.PlayerRights.OWNER.getId()) return true;
  player?.sendMessage?.(REFUSAL);
  return false;
}

/**
 * A chatbox menu of `entries` ([label, handler] pairs). Each handler gets the player. More than five
 * entries page four at a time, the fifth option turning the page and wrapping back to the start.
 */
function menu(player, title, entries, page = 0) {
  const paged = entries.length > MAX_OPTIONS;
  const shown = paged ? entries.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE) : entries;
  const labels = shown.map(([label]) => label);
  if (paged) labels.push(MORE);
  const next = (page + 1) * PAGE_SIZE < entries.length ? page + 1 : 0;
  const chain = new core.DialogueChainBuilder();
  chain.add(new core.OptionDialogue(0, {
    executeOption(option) {
      // The client shows "Please wait..." on the picked option until the chatbox closes or
      // changes: close it first, so an entry that opens nothing (Spawn RARE!) frees it too.
      player.getDialogueManager().reset();
      player.getPacketSender().sendInterfaceRemoval();
      const index = Number(option) - 1;
      if (paged && index === shown.length) return menu(player, title, entries, next);
      shown[index]?.[1](player);
    },
  }, ...labels).setTitle(title));
  player.getDialogueManager().startDialogues(chain);
}

/** The "Enter amount" prompt; `accept` gets the whole number typed. */
function askNumber(player, prompt, accept) {
  player.setEnteredAmountAction({ execute: (amount) => accept(Math.floor(Number(amount))) });
  player.getPacketSender().sendEnterAmountPrompt(prompt);
}

/** The text prompt; `accept` gets the trimmed text typed. */
function askText(player, prompt, accept) {
  player.setEnteredSyntaxAction({ execute: (text) => accept(String(text ?? "").trim()) });
  player.getPacketSender().sendEnterInputPrompt(prompt);
}

/** The cache's name for an NPC id, or null when the cache has no such NPC. */
function npcName(id) {
  if (!Number.isInteger(id) || id < 0 || core.CacheDefinitions.hasDefinition("npc", id) !== true) return null;
  try {
    const name = core.CacheDefinitions.getNpc(id)?.name;
    return name && name !== "null" ? name : null;
  } catch {
    return null;
  }
}

/** Whether the cache gives NPC `id` an Attack option: one without it (a Talk-to-only Man) never fights back. */
function canFight(id) {
  try {
    return (core.CacheDefinitions.getNpc(id)?.actions ?? []).some((action) => action?.toLowerCase() === "attack");
  } catch {
    return false;
  }
}

/** An online player by name, the way ::teleto finds one. */
function onlinePlayer(name) {
  if (!name) return null;
  return core.World.getPlayerByName(name.toLowerCase().replace(/ /g, "_")) ??
    core.World.getPlayerByName(name) ?? null;
}

/** The squares around `player` an NPC or item may stand on, nearest first. */
function freeTilesAround(player) {
  const origin = player.getLocation();
  const region = api.getRegionManager();
  const area = player.getPrivateArea?.();
  return [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
    .map(([dx, dy]) => new core.Location(origin.getX() + dx, origin.getY() + dy, origin.getZ()))
    .filter((tile) => !region.blocked(tile, area));
}

/**
 * The random events another plugin offers, through "random-events:list", and a chooser over them.
 * `start` gets the player and the event's index.
 */
function chooseRandomEvent(player, title, start) {
  const request = { events: [] };
  api.emitCustomEvent("random-events:list", request);
  if (!request.events.length) {
    player.sendMessage("There are no random events to choose from.");
    return;
  }
  menu(player, title, request.events.map(({ index, name }) => [name, (chooser) => start(chooser, index, name)]));
}

/**
 * Starts random event `index` on `target`; what "random-events:start" answered. `forCommand` false for a target
 * other than the potato's user, who then gets none in a duel.
 */
function startRandomEvent(target, index, forCommand = true) {
  const request = { player: target, index, forCommand, result: "unavailable" };
  api.emitCustomEvent("random-events:start", request);
  return request.result;
}

module.exports = {
  POTATO_NAME, REFUSAL, init, getApi, getCore, potatoId, permitted, menu, askNumber, askText, npcName, canFight, onlinePlayer,
  freeTilesAround, chooseRandomEvent, startRandomEvent,
};
