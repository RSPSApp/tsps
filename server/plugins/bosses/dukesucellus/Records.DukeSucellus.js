"use strict";
// Revision-241 duke_sucellus_scoreboard: text components have no transmit listeners.
const fs = require('node:fs'), path = require('node:path');
const Common = require('./Common.DukeSucellus');
const DEATHS = 'duke-sucellus:deaths';
const FILE = path.join(process.cwd(), 'data', 'saves', 'duke-sucellus-scoreboard.json');
const INTERFACE = 828;
/** toplevel_mainmodal_open (-1, -1), run before the board as live does: a modal before it (the bank's
 * -2) can leave the main modal stretched, which pulls the board's background to the top. */
const SCRIPT_MAINMODAL_OPEN = 2524;

let world = null, persist = true;
const number = value => Math.max(0, Math.trunc(Number(value) || 0));
function worldRecords() {
  if (world)
    return world;
  world = { kills: 0, deaths: 0, best: 0 };
  try {
    const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    for (const key of Object.keys(world))
      world[key] = number(saved[key]);
  }
  catch {
  }
  return world;
}
function save() {
  if (!persist)
    return;
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(worldRecords()));
    fs.renameSync(`${FILE}.tmp`, FILE);
  }
  catch (error) {
    console.warn('[Duke Sucellus] Could not save world records:', error.message);
  }
}
function kill(ticks) {
  const w = worldRecords();
  w.kills++;
  if (ticks > 0 && (!w.best || ticks < w.best))
    w.best = ticks;
  save();
}
function died(player) {
  player.setAttribute(DEATHS, Common.count(player, DEATHS) + 1);
  worldRecords().deaths++;
  save();
}
function time(ticks) {
  if (!(ticks > 0))
    return '-';
  const tenths = Math.round(ticks * 6);
  return `${Math.floor(tenths / 600)}:${String(Math.floor(tenths / 10) % 60).padStart(2, '0')}.${tenths % 10}`;
}
function read(event) {
  if (![Common.data.objects.scoreboardParent, Common.data.objects.scoreboard].includes(event.objectId ?? event.definition?.id))
    return false;
  const p = event.player, quest = { player: p, key: Common.data.quest, complete: false };
  Common.api.emitCustomEvent('quest:is-complete', quest);
  if (quest.complete !== true)
    return false;
  const w = worldRecords(), sender = p.getPacketSender();
  sender.sendInterfaceScript(SCRIPT_MAINMODAL_OPEN, [-1, -1]);
  sender.sendInterface(INTERFACE);
  for (const [component, value] of [[9, Common.kills(p)], [11, `${Common.count(p, DEATHS)} (recorded)`], [13, time(Common.count(p, Common.BEST))], [15, `${w.kills} (recorded)`], [17, `${w.deaths} (recorded)`], [19, time(w.best)]])
    sender.sendString(String(value), (INTERFACE << 16) | component);
  return true;
}
function parentRead(event) {
  if ((event.objectId ?? event.definition?.id) !== Common.data.objects.scoreboardParent || event.clickType !== 1)
    return;
  if (read(event))
    event.handled = true;
}
function attach(api) {
  api.persistAttribute(DEATHS, 0);
  api.onBeforeObjectInteraction(parentRead);
  api.onObjectInteraction('Scoreboard', { Read: read });
}
// Like the other boss record stores, tests use an isolated in-memory world.
function resetWorld() {
  world = { kills: 0, deaths: 0, best: 0 };
  persist = false;
}
module.exports = { DEATHS, worldRecords, kill, died, read, attach, resetWorld };
