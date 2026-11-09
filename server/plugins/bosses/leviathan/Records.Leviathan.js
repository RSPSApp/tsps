const fs = require('fs');
const path = require('path');
const Common = require('./Common.Leviathan');

// As with the native Nex/Doom scoreboards, plugin world records survive restart.
// These counts begin with recorded events; there is no fabricated old history.
const FILE = path.join(process.cwd(), 'data', 'saves', 'leviathan-scoreboard.json');
/** toplevel_mainmodal_open (-1, -1), run before the board as live does: a modal before it (the bank's
 * -2) can leave the main modal stretched, which pulls the board's background to the top. */
const SCRIPT_MAINMODAL_OPEN = 2524;

let world;
const count = value => Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
function records() {
  if (world) return world;
  let saved;
  try { saved = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { saved = null; }
  return world = { kills: count(saved?.kills), deaths: count(saved?.deaths), bestTicks: count(saved?.bestTicks) };
}
function save() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(records(), null, 2));
  } catch (error) { Common.api.log(`Leviathan scoreboard could not be saved: ${error.message}`); }
}
const number = value => count(value).toLocaleString('en-US');
function time(ticks) {
  const centiseconds = count(ticks) * 60;
  if (!centiseconds) return 'No recorded best';
  return `${Math.floor(centiseconds / 6000)}:${String(Math.floor(centiseconds / 100) % 60).padStart(2, '0')}.${String(centiseconds % 100).padStart(2, '0')}`;
}
function read(player) {
  const sender = player.getPacketSender(), group = Common.ids.interfaces.scoreboard;
  const values = {
    kills: number(Common.normalKills(player)),
    deaths: `${number(Common.count(player, Common.DEATHS_ATTRIBUTE))} (recorded)`,
    best: time(Common.count(player, Common.BEST_ATTRIBUTE)),
    worldKills: `${number(records().kills)} (recorded)`,
    worldDeaths: `${number(records().deaths)} (recorded)`,
    worldBest: time(records().bestTicks),
  };
  sender.sendInterfaceScript(SCRIPT_MAINMODAL_OPEN, [-1, -1]);
  sender.sendInterface(group);
  for (const [key, component] of Object.entries(Common.data.scoreboard.components))
    sender.sendString(values[key], (group << 16) | component);
  return true;
}
function won(fight) {
  if (fight.awakened) return;
  const result = records();
  result.kills++;
  if (fight.finishedTicks > 0 && (!result.bestTicks || fight.finishedTicks < result.bestTicks)) result.bestTicks = fight.finishedTicks;
  save();
}
function died(player) {
  player.setAttribute(Common.DEATHS_ATTRIBUTE, Common.count(player, Common.DEATHS_ATTRIBUTE) + 1);
  records().deaths++;
  save();
}
function attach(api) { api.persistAttribute(Common.DEATHS_ATTRIBUTE, 0); }
module.exports = { attach, read, won, died };
