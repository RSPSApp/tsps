/**
 * Map of Alacrity (https://oldschool.runescape.wiki/w/Map_of_Alacrity_(Demonic_Pacts_League)),
 * Demonic Pacts' tier 3 relic: the Map of alacrity teleports to Agility shortcuts, on the less
 * favourable side (the start of a one-way one), only when the character could reach the
 * shortcut (its area unlocked, the Wiki's quest notes "to use the teleport"), from any Wilderness
 * level, whatever the Agility level (Wiki: "teleporting to a shortcut does not require you to
 * have the Agility level to use it"); the shortcut keeps its own requirements. Read (or its area
 * submenu, the cache's subops) lists an area's shortcuts in the menu interface, as Evil Eye's
 * (Teleports' `listMenu`; no recording of the map's, so its titles are ours); Last-destination
 * repeats the last (through the same pick, so with the same cast). The cast is the map's own:
 * hotfoot_grace_teleport with spotanim leagues_6_hotfoot, the move as the seq ends. No recording
 * of the map in use; inferred from the Wiki's video and the cache's names (data `_cast`).
 *
 * The shortcuts (data/league-map-of-alacrity.json) are the Wiki map's that the server's Agility
 * shortcuts have, each landing on the tile of the shortcut's own end nearest the Wiki's pin; the
 * data lists the Wiki's rows left out and why (no such shortcut here, or no side the data and
 * the pin agree on).
 */
const Common = require("./Common.LeagueRelics");
const Teleports = require("./Teleports.LeagueRelics");
const DATA = require("../data/league-map-of-alacrity.json");

const KEY = "map-of-alacrity";

let effect;
let shortcuts;

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

function read(event) {
  shortcuts.teleport(event);
}

function last(event) {
  shortcuts.last(event);
}

module.exports = function attach(api) {
  effect = Common.data.effects.mapOfAlacrity;
  shortcuts = Teleports.areaTeleports({ key: KEY, title: Common.message("alacrityTitle"), areas: DATA.areas, cast: Teleports.itemCast(effect.cast) });
  Teleports.attachMenu(api);
  api.persistAttribute(Teleports.lastAttribute(KEY), null);
  api.onItemAction(effect.toolName, { Read: only(read), "Last-destination": only(last) });
};

Object.assign(module.exports, { KEY });
