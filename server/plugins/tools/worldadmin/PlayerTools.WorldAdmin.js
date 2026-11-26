const { HttpError, send } = require("./Http.WorldAdmin");
const { describePlayer, searchItems, applyPlayerTool } = require("../PlayerTools");

const PLAYER_TOOLS_CONFIG = "WorldAdmin:playerTools";
const enabled = api => Boolean(api?.core?.Skill) && (api.getPluginConfig?.(PLAYER_TOOLS_CONFIG, true) ?? true) === true;
function playerTools(api, player) {
  return enabled(api) ? describePlayer(api, player) : { enabled: false };
}

function toolRoutes(request, response, url, api) {
  if (!["/api/players/tools", "/api/players/items"].includes(url.pathname)) return false;
  if (request.method !== "GET") throw new HttpError(405, "Method not allowed");
  if (!enabled(api)) {
    if (url.pathname.endsWith("/tools")) send(response, 200, { enabled: false });
    else throw new HttpError(409, "Player tools are disabled or the server is offline.");
  } else if (url.pathname.endsWith("/tools")) send(response, 200, playerTools(api));
  else {
    try { send(response, 200, { items: searchItems(api.core, url.searchParams.get("q") ?? "") }); }
    catch (error) {
      if (Number.isInteger(error.status)) throw new HttpError(error.status, error.message);
      throw error;
    }
  }
  return true;
}

// WorldAdmin has already checked host, token, method and Origin.
async function toolAction(api, target, body) {
  if (!["teleport", "give", "skill", "restore", "quest"].includes(body.action)) return null;
  if (!enabled(api)) throw new HttpError(409, "Player tools are disabled.");
  try { return await applyPlayerTool(api, target, body); }
  catch (error) {
    if (Number.isInteger(error.status)) throw new HttpError(error.status, error.message);
    throw error;
  }
}

module.exports = { PLAYER_TOOLS_CONFIG, playerTools, toolRoutes, toolAction };
