"use strict";

/**
 * Shared by the Group Ironman units: the data, and the questions they ask the Ironman and
 * Grouping plugins through events (a player's mode, their group and account key, setting a mode).
 */

const fs = require("fs");
const path = require("path");

let api = null;
let data = null;

function init(pluginApi) {
  api = pluginApi;
  data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "group-ironman.json"), "utf8"));
}

/** The variant ("ranked", "hardcore", "unranked") a Group Ironman mode plays, or null. */
function variantOfMode(mode) {
  return Object.entries(data.variants).find(([, variant]) => variant.mode === mode)?.[0] ?? null;
}

function modeOfVariant(variant) {
  return data.variants[variant]?.mode ?? null;
}

/** The player's Ironman mode, by the Ironman plugin ("none" without it). */
function modeOf(player) {
  const query = { player, mode: "none" };
  api.emitCustomEvent("ironman:mode", query);
  return query.mode;
}

function isGroupIronman(player) {
  return variantOfMode(modeOf(player)) !== null;
}

function setMode(player, mode) {
  if (modeOf(player) === mode) return;
  api.emitCustomEvent("ironman:set-mode", { player, mode });
}

/** { group, member, account }: the player's group snapshot, their entry in it, their account key. */
function groupOf(player) {
  const query = { player };
  api.emitCustomEvent("grouping:get", query);
  return { group: query.group ?? null, member: query.member ?? null, account: query.account ?? null };
}

/** The logged-in player whose account key this is, or null. */
function onlinePlayer(account) {
  let found = null;
  api.core.World.getPlayers().forEach((player) => {
    if (!found && player && player.isPlayerBot?.() !== true && groupOf(player).account === account) found = player;
  });
  return found;
}

function message(key, values = {}) {
  return data.messages[key].text.replace(/\{(\w+)\}/g, (match, name) => values[name] ?? match);
}

function tell(player, key, values) {
  player?.getPacketSender().sendMessage(message(key, values));
  return false;
}

/** Tells every logged-in member of the group snapshot. */
function tellGroup(group, key, values, except = null) {
  for (const member of group?.members ?? []) {
    if (member.account !== except && member.online) tell(onlinePlayer(member.account), key, values);
  }
}

module.exports = {
  init, variantOfMode, modeOfVariant, modeOf, isGroupIronman, setMode, groupOf, onlinePlayer, message, tell, tellGroup,
  get data() { return data; },
  get api() { return api; },
};
