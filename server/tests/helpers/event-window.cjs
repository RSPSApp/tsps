"use strict";

// Opens and closes a configured event through the real EventScheduler's ::forceevent
// override, so content that grants through events:grant-reward sees the same window the
// scheduler reports. Registers the scheduler once per test process.
const { CommandPacketListener } = require("../../dist/net/packet/impl/CommandPacketListener");
const { Player } = require("../../dist/game/entity/impl/player/Player");
let startScheduler = null;

function owner(core) {
  const player = new Player(null);
  player.setUsername("eventwindow");
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  player.setHitpoints(10);
  player.setRights(core.PlayerRights.OWNER);
  player.sendMessage = () => {};
  return player;
}

function ensureScheduler(PM) {
  // A test that loads every plugin (PM.loadFromDirectory) already has the real scheduler:
  // a second copy would answer each grant again, so only register one when none answers.
  const probe0 = { player: { getAttribute: () => [] }, completion: "probe" };
  PM.emitCustomEvent("events:completed", probe0);
  const loaded = !startScheduler && probe0.completed !== undefined;
  if (!startScheduler && !loaded) {
    // Keep the scheduler's own startup hook, so starting it does not run every other
    // plugin's server startup (bots, scenes) inside an event test.
    const api = Object.create(PM.createApi("EventScheduler"));
    api.onServerStartup = hook => { startScheduler = hook; };
    require("../../plugins/world/EventScheduler.plugin").register(api);
  }
  // A bare ::forceevent changes nothing: a running scheduler answers with its usage line,
  // a stopped one says it is not running, and is then started.
  const probe = owner(PM.getCoreApi()), messages = [];
  probe.sendMessage = message => messages.push(message);
  CommandPacketListener.execute(probe, "forceevent");
  if (!messages.some(message => message.includes("not running"))) return;
  if (startScheduler) startScheduler({ timestamp: Date.now() });
  else PM.emitServerStartup({ timestamp: Date.now() });
}

/** Forces `key` open (true), closed (false) or back to its calendar (null). */
function setWindow(PM, key, active) {
  ensureScheduler(PM);
  const mode = active === null ? "auto" : active ? "on" : "off";
  CommandPacketListener.execute(owner(PM.getCoreApi()), `forceevent ${key} ${mode}`);
}

module.exports = { setWindow, ensureScheduler };
