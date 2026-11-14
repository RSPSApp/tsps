"use strict";

/**
 * Hands Grouping's "grouping:changed" and logins to the units that care, in order: the group's
 * mode first, then lives, then the leaver's choice.
 */

const Variants = require("./Variants.GroupIronman");
const Hardcore = require("./Hardcore.GroupIronman");
const Leaving = require("./Leaving.GroupIronman");
const Unranked = require("./Unranked.GroupIronman");
const Store = require("./Store.GroupIronman");

function changed(event) {
  switch (event.type) {
    case "created": Variants.created(event); break;
    case "joined": Variants.joined(event); break;
    case "left":
    case "kicked":
      Hardcore.departed(event);
      Leaving.departed(event);
      break;
    case "disbanded": Store.remove(event.groupId); break;
    default:
  }
}

function login(event) {
  Unranked.login(event);
  Variants.login(event);
  Leaving.login(event);
}

module.exports = { changed, login };
