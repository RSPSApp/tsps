"use strict";

/**
 * A group's name (Wiki, Group Ironman Mode: at most 12 characters, and not the name of another
 * group or of a clan, which share the names). The leader sets it with ::group name <name>, or
 * through Tony on The Node ("grouping:rename"). Letters, numbers and single spaces (ours).
 */

const Store = require("./Store.Grouping");
const Members = require("./Members.Grouping");
const Actions = require("./Actions.Grouping");

const MAX_LENGTH = 12;
const ALLOWED = /^[A-Za-z0-9 ]+$/;
const MESSAGE = Object.freeze({
  EMPTY: "Your group's name needs at least one letter or number.",
  TOO_LONG: `A group's name can be at most ${MAX_LENGTH} characters long.`,
  BAD_CHARACTERS: "A group's name can only have letters, numbers and spaces.",
  TAKEN: "That name is taken.",
});

let api;

function init(pluginApi) {
  api = pluginApi;
}

/** Why `name` can't be this group's, or null. */
function refusal(group, name) {
  if (!name) return MESSAGE.EMPTY;
  if (name.length > MAX_LENGTH) return MESSAGE.TOO_LONG;
  if (!ALLOWED.test(name)) return MESSAGE.BAD_CHARACTERS;
  const other = Store.byName(name);
  if (other && other !== group) return MESSAGE.TAKEN;
  const clan = { name, taken: false };
  api.emitCustomEvent("clans:name-taken", clan);
  return clan.taken ? MESSAGE.TAKEN : null;
}

function rename(player, typed) {
  const me = Members.identify(player);
  const group = me && Store.groupOf(me.profile, me.account);
  if (!group) return Actions.tell(player, Actions.MESSAGE.NOT_IN_GROUP);
  if (group.leader !== me.account) return Actions.tell(player, Actions.MESSAGE.LEADER_ONLY);
  const name = String(typed ?? "").trim().replace(/\s+/g, " ");
  const refused = refusal(group, name);
  if (refused) return Actions.tell(player, refused);
  Store.setName(group, name);
  Actions.tellGroup(group, `Your group is now called ${name}.`);
  Actions.changed("renamed", group, me.account, null);
  return true;
}

/** "grouping:rename" { player, name } -> renamed. */
function answerRename(request) {
  request.renamed = rename(request.player, request.name) === true;
}

module.exports = { MAX_LENGTH, MESSAGE, init, refusal, rename, answerRename };
