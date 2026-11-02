/**
 * Evil Eye (https://oldschool.runescape.wiki/w/Evil_Eye_(Demonic_Pacts_League)), Demonic Pacts'
 * tier 3 relic: the Evil eye teleports to the entrance of the Combat Achievements' bosses and
 * raids (the Barrows' chest or its surface, each Moon of Peril on its own), only in areas the
 * character has unlocked, from any Wilderness level. Teleport (or its area submenu, the cache's
 * subops; worn the same) lists an area's destinations; Last-destination repeats the last; Wear
 * and Destroy are the game's own. The cast is the league's area-teleport cast (no recording of
 * the eye in use, and the cache names no animation for it).
 *
 * The destinations (data/league-evil-eye.json) are the Wiki's "Teleports by Area" rows, each on
 * a tile the server's own data gives for the boss's entrance; the data lists the rows left out
 * and why.
 */
const Common = require("./Common.LeagueRelics");
const Teleports = require("./Teleports.LeagueRelics");
const DATA = require("../data/league-evil-eye.json");

const KEY = "evil-eye";

let effect;
let bosses;

function active(player) {
  return Common.effectActive(player, effect);
}

/** An option's handler for the relic's owner; anyone else's click goes on to the game's own (false). */
function only(fn) {
  return (event) => {
    if (!active(event.player)) return false;
    event.handled = true;
    fn(event);
  };
}

function teleport(event) {
  bosses.teleport(event);
}

function last(event) {
  bosses.last(event);
}

module.exports = function attach(api) {
  effect = Common.data.effects.evilEye;
  bosses = Teleports.areaTeleports({ key: KEY, title: Common.message("evilEyeTitle"), areas: DATA.areas });
  api.persistAttribute(Teleports.lastAttribute(KEY), null);
  api.onItemAction(effect.toolName, { Teleport: only(teleport), "Last-destination": only(last) });
};

Object.assign(module.exports, { KEY });
