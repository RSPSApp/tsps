/**
 * Soul Wars: what the units share - the plugin api, plugins/minigames/data/soul-wars.json, cache
 * ids by name, tick timing, the teams and the HUD helpers.
 */
const fs = require("fs");
const path = require("path");

let api = null;
let core = null;
let data = null;
const ids = { components: {}, varbits: {}, varps: {} };

const TEAMS = ["blue", "red"];
const TEAM_VALUE = { blue: 1, red: 2 };
const COLOURS = { blue: "3366ff", red: "ff3232" };
/** The alignment scale's ends (recorded: 0 blue, 60 neutral, 120 red). */
const ALIGNMENT = { blue: 0, neutral: 60, red: 120 };

/** Set once by the plugin before any unit attaches. */
function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
  data = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "soul-wars.json"), "utf8"));
}

function component(name) {
  if (!(name in ids.components)) ids.components[name] = core.CacheDefinitions.getComponentId(name);
  return ids.components[name];
}

function varbitId(name) {
  if (!(name in ids.varbits)) ids.varbits[name] = core.CacheDefinitions.getVarbitId(name);
  return ids.varbits[name];
}

function varpId(name) {
  if (!(name in ids.varps)) ids.varps[name] = core.CacheDefinitions.getVarpId(name);
  return ids.varps[name];
}

function varbit(player, name, value) {
  const id = varbitId(name);
  if (id != null) player.getPacketSender().sendVarbit(id, value);
}

/** The saved figures' attribute keys (kebab-case), by their varp's name after `soul_wars_`. */
const FIGURE_ATTRIBUTES = {
  zeal: "soul-wars:zeal",
  zeal_tokens: "soul-wars:zeal-tokens",
  total_games: "soul-wars:total-games",
  total_wins: "soul-wars:total-wins",
  total_kills: "soul-wars:total-kills",
  total_deaths: "soul-wars:total-deaths",
};

/** A saved counter on a varp (Zeal, games, kills...): the attribute is the truth, the varp shows it. */
function addVarp(player, name, amount) {
  const key = FIGURE_ATTRIBUTES[name];
  const value = (Number(player.getAttribute(key)) || 0) + amount;
  player.setAttribute(key, value);
  const id = varpId(`soul_wars_${name}`);
  if (id != null) player.getPacketSender().sendConfig(id, value);
  return value;
}

function getVarp(player, name) {
  return Number(player.getAttribute(FIGURE_ATTRIBUTES[name])) || 0;
}

function text(player, name, value) {
  const id = component(name);
  if (id != null) player.getPacketSender().sendString(String(value), id);
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

function message(name, values = {}) {
  return String(data.messages[name]).replace(/\{(\w+)\}/g, (_, field) => String(values[field] ?? ""));
}

const randomInt = (low, high) => low + Math.floor(Math.random() * (high - low + 1));
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const toLocation = ([x, y, z]) => new core.Location(x, y, z ?? 0);
const other = (team) => (team === "blue" ? "red" : "blue");

function inBox(location, [x0, y0, x1, y1]) {
  const x = location.getX();
  const y = location.getY();
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

/**
 * The NPCs standing in a box on plane z, lowest index first. A region query: walking
 * World.getNpcs() steps through every NPC slot (65535), every time it is asked.
 */
function npcsInBox([x0, y0, x1, y1], z = 0) {
  const cx = (x0 + x1 + 1) >> 1;
  const cy = (y0 + y1 + 1) >> 1;
  const radius = Math.max(cx - x0, x1 - cx, cy - y0, y1 - cy);
  const near = core.World?.getNpcsNear?.(new core.Location(cx, cy, z), radius) ?? [];
  return near.filter((npc) => inBox(npc.getLocation(), [x0, y0, x1, y1])).sort((a, b) => a.getIndex() - b.getIndex());
}

function level(player, skill) {
  return player.getSkillManager().getCurrentLevel(core.Skill[skill]);
}

function maxLevel(player, skill) {
  return player.getSkillManager().getMaxLevel?.(core.Skill[skill]) ?? level(player, skill);
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
  FIGURE_ATTRIBUTES,
  TEAMS,
  TEAM_VALUE,
  COLOURS,
  ALIGNMENT,
  component,
  varbitId,
  varpId,
  varbit,
  addVarp,
  getVarp,
  text,
  later,
  every,
  message,
  randomInt,
  pick,
  toLocation,
  other,
  inBox,
  npcsInBox,
  level,
  maxLevel,
};
