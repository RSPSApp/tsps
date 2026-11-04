"use strict";

const fs = require("node:fs");
const path = require("node:path");

const data = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "maggot-king.json"), "utf8"));
let api = null;
let core = null;

function init(pluginApi) {
  api = pluginApi;
  core = pluginApi.core;
}

function questComplete(player) {
  const request = { player, key: data.questKey, complete: false };
  api.emitCustomEvent("quest:is-complete", request);
  return request.complete === true;
}

const loc = ([x, y, z = 0]) => new core.Location(x, y, z);

module.exports = { init, data, loc, questComplete, api: () => api, core: () => core };
