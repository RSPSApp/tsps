/**
 * The relic effect toggles of a cache-read league (Demonic Pacts): the relic interface draws them
 * from the cache's `league_relic_effect_toggle` rows (league_relic_toggle_effects_draw), each
 * with its relic's struct, its bit of varp `league_relic_effect_toggle_1` and whether a set bit
 * means on (`toggle_invert`) or off (script9464). A click flips the bit client-side (script9465)
 * and sends the row as the toggles component's script trigger (655:38); the server keeps the
 * varp, sends it back and says the change in the row's words, prefixed by the relic's name, in
 * green when on and red when off (237/01104: "<col=229628>Transmute - Transmutation spells will
 * now send noted products to the bank."). Units ask `on(player, rowName)`.
 */
const Common = require("./Common.LeagueRelics");
const { triggerInts } = require("../../interface/widgetGroup");
const Unlock = require("./Unlock.LeagueRelics");

const TOGGLES_ATTRIBUTE = "league:relic-toggles";

let config = null;
let ids = null;


function resolve() {
  if (ids) return ids;
  const { CacheDefinitions } = Common.core;
  const table = CacheDefinitions.getDbTableId(config.toggles.table);
  const column = (name) => CacheDefinitions.getDbColumn(table, name);
  ids = {
    table,
    varp: CacheDefinitions.getVarpId(config.toggles.varp),
    relic: column("toggle_relic"),
    on: column("toggle_on_message"),
    off: column("toggle_off_message"),
    invert: column("toggle_invert"),
    bit: column("toggle_bit"),
  };
  return ids;
}

function bits(player) {
  return Number(player.getAttribute(TOGGLES_ATTRIBUTE)) | 0;
}

/** A toggle row of the cache, or null. */
function row(id) {
  const found = Common.core.CacheDefinitions.getDbRow(id);
  return found && found.tableId === resolve().table ? found : null;
}

function rowState(player, found) {
  const { bit, invert } = resolve();
  const set = ((bits(player) >>> found.int(bit, -1)) & 1) === 1;
  return found.int(invert, 0) === 1 ? set : !set;
}

/** Whether the toggle row (its gameval name, `league_relic_endless_harvest_toggle_bank`) is on for the player. */
function on(player, rowName) {
  const found = row(Common.core.CacheDefinitions.getDbRowId(rowName));
  return found ? rowState(player, found) : true;
}

function inLeague(player) {
  return [].concat(config.league).includes(Common.leagueOf(player));
}

function send(player) {
  player.getPacketSender().sendConfig(resolve().varp, bits(player));
}

/** The toggles component's script trigger: [row]. A relic not held changes nothing (the client says why). */
function toggled(event) {
  const { player } = event;
  if (!event.scriptTrigger || !inLeague(player)) return false;
  const [rowId] = triggerInts(event.argsData);
  const found = Number.isInteger(rowId) ? row(rowId) : null;
  const bit = found?.int(resolve().bit, -1) ?? -1;
  const relicName = found ? String(Common.core.CacheDefinitions.getStructParams(found.int(resolve().relic, -1)).get(Common.data.params.relicName) ?? "") : "";
  if (!found || bit < 0 || bit > 31 || !relicName || !Common.hasRelic(player, Common.slug(relicName))) {
    send(player);
    return true;
  }
  player.setAttribute(TOGGLES_ATTRIBUTE, bits(player) ^ (1 << bit));
  send(player);
  const now = rowState(player, found);
  const colour = now ? config.toggles.onColour : config.toggles.offColour;
  player.sendMessage(`<col=${colour}>${relicName} - ${found.string(now ? resolve().on : resolve().off)}`);
  return true;
}

function login({ player }) {
  if (inLeague(player)) send(player);
}

module.exports = function attach(api) {
  config = Common.data.effects.demonicPacts;
  api.persistAttribute(TOGGLES_ATTRIBUTE, 0);
  api.onInterfaceActionButton(Unlock.uid(Common.data.interface.group, Common.data.interface.toggles), toggled);
  api.onCustomEvent("league:login", login);
};

module.exports.on = on;
module.exports.TOGGLES_ATTRIBUTE = TOGGLES_ATTRIBUTE;
module.exports.triggerInts = triggerInts;
