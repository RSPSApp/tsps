const fs = require('node:fs');
const path = require('node:path');
const Common = require('./Common.Whisperer');
const FILE = path.join(process.cwd(), 'data', 'saves', 'whisperer-scoreboard.json');
/** toplevel_mainmodal_open (-1, -1), run before the board as live does: a modal before it (the bank's
 * -2) can leave the main modal stretched, which pulls the board's background to the top. */
const SCRIPT_MAINMODAL_OPEN = 2524;

let world;
const count = value => Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
function records() {
  if (world)
    return world;
  let saved;
  try {
    saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  }
  catch {
    saved = null;
  }
  return world = { kills: count(saved?.kills), deaths: count(saved?.deaths), bestTicks: count(saved?.bestTicks) };
}
function save() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(records()));
  }
  catch (error) {
    Common.api.log(`Whisperer scoreboard could not be saved: ${error.message}`);
  }
}
function won(fight) {
  const totals = records(), ticks = count(fight.elapsedTicks);
  totals.kills++;
  if (ticks && (!totals.bestTicks || ticks < totals.bestTicks))
    totals.bestTicks = ticks;
  save();
}
function died(player) {
  player.setAttribute(Common.DEATHS_ATTRIBUTE, count(player.getAttribute(Common.DEATHS_ATTRIBUTE)) + 1);
  records().deaths++;
  save();
}
const number = value => count(value).toLocaleString('en-US');
function time(ticks) {
  const centiseconds = count(ticks) * 60;
  return centiseconds ? `${Math.floor(centiseconds / 6000)}:${String(Math.floor(centiseconds / 100) % 60).padStart(2, '0')}.${String(centiseconds % 100).padStart(2, '0')}` : 'No recorded best';
}
function read(event) {
  const board = Common.data.scoreboard, player = event.player;
  if (![...board.parents, ...board.readable].includes(event.objectId ?? event.definition?.id))
    return false;
  const quest = { player, key: Common.data.quest, complete: false };
  Common.api.emitCustomEvent('quest:is-complete', quest);
  if (!quest.complete)
    return false;
  const known = { player, monster: Common.MONSTER, total: 0 };
  Common.api.emitCustomEvent('combat-achievements:count', known);
  const values = {
    kills: number(Math.max(count(player.getAttribute(Common.KILLS_ATTRIBUTE)), count(known.total))),
    deaths: `${number(player.getAttribute(Common.DEATHS_ATTRIBUTE))} (recorded)`,
    best: time(player.getAttribute(Common.BEST_ATTRIBUTE)),
    worldKills: `${number(records().kills)} (recorded)`,
    worldDeaths: `${number(records().deaths)} (recorded)`,
    worldBest: time(records().bestTicks),
  };
  const sender = player.getPacketSender();
  sender.sendInterfaceScript(SCRIPT_MAINMODAL_OPEN, [-1, -1]);
  sender.sendInterface(board.interface);
  for (const [key, component] of Object.entries(board.components))
    sender.sendString(values[key], (board.interface << 16) | component);
  return true;
}
function parentRead(event) {
  if (!Common.data.scoreboard.parents.includes(event.objectId ?? event.definition?.id) || event.clickType !== 1)
    return;
  if (read(event))
    event.handled = true;
}
function attach(api) {
  api.persistAttribute(Common.DEATHS_ATTRIBUTE, 0);
  api.onBeforeObjectInteraction(parentRead);
  api.onObjectInteraction('Scoreboard', { Read: read });
}
module.exports = { attach, read, won, died };
