/**
 * The PvP Arena units' shared parts: the plugin api, plugins/minigames/data/pvp-arena.json,
 * cache ids by gameval name, the saved attributes and small tick helpers.
 */
const fs = require("fs");
const path = require("path");

let api = null;
let core = null;
let data = null;
const ids = { components: {}, varbits: {}, interfaces: {}, locs: {}, objs: {} };

/** Saved figures (kebab-case attributes). */
const ATTRIBUTES = {
  stash: "pvp-arena:stash",
  loadouts: "pvp-arena:loadouts",
  build: "pvp-arena:build",
  participation: "pvp-arena:unranked-participation",
  wins: "pvp-arena:unranked-wins",
};

/** The client's chat types for the lines the captures show (ChatMessageType's 101-103). */
const CHAT = { TRADEREQ: 101, TRADE: 102, CHALREQ_TRADE: 103 };

/** if_setevents bits, as the captures list them. */
const EVENTS = {
  OP1: 1 << 1,
  OP2: 1 << 2,
  OP10: 1 << 10,
  DEPTH2: 2 << 17,
  DEPTH3: 3 << 17,
  DRAGTARGET: 1 << 20,
};

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "pvp-arena.json"), "utf8"));
}

function cached(kind, name, lookup) {
  if (!(name in ids[kind])) ids[kind][name] = lookup(name);
  return ids[kind][name];
}

const component = (name) => cached("components", name, (n) => core.CacheDefinitions.getComponentId(n));
const varbitId = (name) => cached("varbits", name, (n) => core.CacheDefinitions.getVarbitId(n));
const interfaceId = (name) => cached("interfaces", name, (n) => core.CacheDefinitions.getInterfaceId(n));
const locId = (name) => cached("locs", name, (n) => core.CacheDefinitions.getLocId(n));
const objId = (name) => cached("objs", name, (n) => core.CacheDefinitions.getObjId(n));

function varbit(player, name, value) {
  const id = varbitId(name);
  if (id != null) player.getPacketSender().sendVarbit(id, value);
}

function message(name, values = {}) {
  return String(data.messages[name]).replace(/\{(\w+)\}/g, (_, field) => String(values[field] ?? ""));
}

/** A line of one of the request/notification chat types; `from` makes it the client's request line. */
function chat(player, type, text, from = null) {
  const sender = player.getPacketSender();
  if (!from) {
    sender.sendTypedMessage(type, text);
    return;
  }
  sender.sendRequestMessage(type, text, from.getDisplayName(), from.getIndex());
}

function number(player, key) {
  return Number(player.getAttribute(key)) || 0;
}

function add(player, key, amount) {
  const value = number(player, key) + amount;
  player.setAttribute(key, value);
  return value;
}

function later(ticks, action) {
  const { Task, TaskManager } = core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(Math.max(1, ticks), null, false);
    }
    execute() {
      this.stop();
      action();
    }
  })());
}

function every(action) {
  const { Task, TaskManager } = core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(1, null, false);
    }
    execute() {
      if (action() === false) this.stop();
    }
  })());
}

function asPlayer(mobile) {
  return mobile?.isPlayer?.() ? mobile.getAsPlayer?.() ?? mobile : null;
}

function location([x, y], z = 0) {
  return new core.Location(x, y, z);
}

/** Opens a main modal as the captures do (toplevel_mainmodal_open, then the group). */
function openModal(player, name) {
  const sender = player.getPacketSender();
  sender.sendInterfaceScript(2524, [-1, -1]);
  sender.sendInterface(interfaceId(name));
}

module.exports = {
  init,
  get api() {
    return api;
  },
  get core() {
    return core;
  },
  get data() {
    return data;
  },
  ATTRIBUTES,
  CHAT,
  EVENTS,
  component,
  varbitId,
  interfaceId,
  locId,
  objId,
  varbit,
  message,
  chat,
  number,
  add,
  later,
  every,
  asPlayer,
  location,
  openModal,
};
