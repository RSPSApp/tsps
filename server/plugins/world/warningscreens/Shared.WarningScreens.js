/**
 * The warning screens the Doomsayer looks after (Wiki: Doomsayer), shared by the screens
 * themselves and his Toggle warnings list.
 *
 * Each warning n has its own interface and a 3-bit varbit, both named cws_warning_n in the cache
 * (data/warning-screens.json, checked against it by tests/warning-screens.test.cjs).
 * The varbit, as rsprox 20261115T211134 shows it (varps 1045/1046, script 166):
 *   0-5  how many times the screen has been shown; the Doomsayer cannot toggle it yet;
 *   6    shown often enough: it shows "Don't ask me this again", and it is on;
 *   7    toggled off: it no longer opens.
 * Warnings 21 (the Kalphite Queen's rope) and 22 (the King Black Dragon's lever) have screens but
 * no varbit, so they cannot be toggled (Wiki: some warnings cannot be turned back on).
 */
const DATA = require("../data/warning-screens.json");

const SHOWN_ENOUGH = 6;
const OFF = 7;
const HIGHEST_WARNING = Math.max(...DATA.warnings.map((entry) => entry.warning));
/** Each warning's state, saved per player: `warning-screens:warning-<n>`. */
const STATE_ATTRIBUTE_PREFIX = "warning-screens:warning-";

/** Where each warning used to be saved before they shared this, so no showing is lost. */
const LEGACY_ATTRIBUTES = {
  4: "sos.descent-warnings",
  9: "observatory-quest:dungeon-warnings",
  10: "shantay-pass:warnings",
  16: "lost-tribe:dark-warnings",
};
/** The Stronghold kept its "Don't ask me this again" apart: true is off (7). */
const LEGACY_STRONGHOLD_OFF_ATTRIBUTE = "sos.dont-ask-descent";

const TOGGLED_ON_MESSAGE = "You have toggled this warning screen on. You will see this interface again.";
const TOGGLED_OFF_MESSAGE = "You have toggled this warning screen off. You will no longer see this warning screen.";
/** The screen's own checkbox says where to turn it back on (docs/shantay-pass.md). */
const SCREEN_TOGGLED_OFF_MESSAGE = "You have toggled this warning screen off. You will not see this warning screen unless you speak to the Doomsayer in Lumbridge to turn it on again.";
const CANNOT_TOGGLE_MESSAGE = "You cannot toggle this warning screen on or off. You need to go to the area it is linked to enough times to have the option to do so.";

/** Every warning: { warning, name, interfaceId (null: not a cws screen), varbit (null: no toggle), doomsayerRow, notice }. */
const WARNINGS = new Map(DATA.warnings.map((entry) => [entry.warning, {
  warning: entry.warning,
  name: entry.name,
  interfaceId: entry.interface,
  varbit: entry.varbit,
  doomsayerRow: entry.doomsayerRow,
  notice: entry.notice === true,
}]));

function all() {
  return WARNINGS;
}

/** The warning whose screen is this interface. */
function byInterface(interfaceId) {
  for (const entry of WARNINGS.values()) if (entry.interfaceId !== null && entry.interfaceId === interfaceId) return entry;
  return null;
}

/** The warning on this row of the Doomsayer's list. */
function byDoomsayerRow(child) {
  for (const entry of WARNINGS.values()) if (entry.doomsayerRow !== null && entry.doomsayerRow === child) return entry;
  return null;
}

const stateAttribute = (warning) => `${STATE_ATTRIBUTE_PREFIX}${warning}`;

function state(player, warning) {
  const value = Number(player.getAttribute(stateAttribute(warning)));
  return Number.isFinite(value) ? Math.max(0, Math.min(OFF, Math.floor(value))) : 0;
}

/** Saves the warning's state and tells the client, whose screens and Doomsayer list draw from it. */
function setState(player, warning, value) {
  player.setAttribute(stateAttribute(warning), value);
  const varbit = WARNINGS.get(warning)?.varbit;
  if (varbit !== null && varbit !== undefined) player.getPacketSender().sendVarbit(varbit, value);
}

module.exports = {
  SHOWN_ENOUGH,
  OFF,
  HIGHEST_WARNING,
  LEGACY_ATTRIBUTES,
  LEGACY_STRONGHOLD_OFF_ATTRIBUTE,
  TOGGLED_ON_MESSAGE,
  TOGGLED_OFF_MESSAGE,
  SCREEN_TOGGLED_OFF_MESSAGE,
  CANNOT_TOGGLE_MESSAGE,
  all,
  byInterface,
  byDoomsayerRow,
  stateAttribute,
  state,
  setState,
};
