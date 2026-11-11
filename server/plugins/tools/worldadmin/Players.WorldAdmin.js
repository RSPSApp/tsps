const fs = require("node:fs");
const path = require("node:path");
const { HttpError, readJson, send } = require("./Http.WorldAdmin");
const { originAllowed } = require("./Access.WorldAdmin");

const USERNAME = /^[a-z0-9][a-z0-9 _-]{0,19}$/i;
const key = name => name.toLowerCase().replace(/_/g, " ");

function savedPlayers(profile = "main", jsonBackend = false) {
  const database = process.env.PLAYER_SAVE_DATABASE_PATH || "data/saves/players.sqlite";
  const prefix = profile === "main" ? "" : `${profile}:`;
  if (!jsonBackend && fs.existsSync(database)) {
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(database, { readOnly: true });
    try {
      return db.prepare("SELECT username, save_json AS json FROM player_saves").all()
        .flatMap(({ username, json }) => {
          const name = username.slice(prefix.length);
          return username.startsWith(prefix) && USERNAME.test(name) ? [[name, json]] : [];
        });
    } finally {
      db.close();
    }
  }
  const directory = path.resolve("data/saves/characters", profile === "main" ? "." : profile);
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(file => {
    const name = path.basename(file.name, ".json");
    if (!file.isFile() || !file.name.endsWith(".json") || !USERNAME.test(name)) return [];
    try { return [[name, fs.readFileSync(path.join(directory, file.name), "utf8")]]; }
    catch (error) { if (error.code !== "ENOENT") throw error; return []; }
  });
}

function levels(save) {
  const values = save.skills?.maxLevel;
  if (!Array.isArray(values) || values.length < 7 || !values.every(Number.isFinite)) return {};
  const [attack, defence, strength, hitpoints, ranged, prayer, magic] = values;
  return {
    combat: Math.floor((defence + hitpoints + Math.floor(prayer / 2)) / 4 +
      0.325 * Math.max(attack + strength, Math.floor(ranged * 1.5), Math.floor(magic * 1.5))),
    total: values.reduce((sum, value) => sum + value, 0),
  };
}

function parseSave(json) {
  try { return JSON.parse(json) || {}; }
  catch { return {}; }
}

async function playerRoutes(request, response, url, api, offlineCatalogue) {
  if (!["/api/players", "/api/players/save", "/api/players/action"].includes(url.pathname)) return false;
  const core = api?.core;
  const persistence = core?.GameConstants?.PLAYER_PERSISTENCE;
  const profile = core?.GameConstants?.WORLD_PROFILE ?? offlineCatalogue?.playerProfile ?? "main";
  const live = new Map((core?.World.getPlayers()?.stream?.() ?? [])
    .filter(player => player && !player.isPlayerBot?.()).map(player => [key(player.getUsername()), player]));
  const name = url.searchParams.get("name") ?? "";
  if (url.pathname === "/api/players/action") {
    if (request.method !== "POST") throw new HttpError(405, "Method not allowed");
    if (!originAllowed(request)) throw new HttpError(403, "Cross-origin request refused");
    if (!core || !persistence || core.Server.isShuttingDown?.()) throw new HttpError(409, "Start the server before managing players.");
    if (!USERNAME.test(name)) throw new HttpError(400, "Invalid player name.");
    const { action, rights, enabled } = await readJson(request);
    const candidate = core.World.getPlayerByName(name);
    const target = candidate?.isPlayerBot?.() ? undefined : candidate;
    if (!target && !persistence.exists(name, profile)) throw new HttpError(404, "Player not found.");
    if (action === "rights") {
      if (!Number.isInteger(rights) || rights < 0 || rights > 4) throw new HttpError(400, "Invalid player rights.");
      const rank = core.PlayerRights.fromId(rights);
      if (target) {
        target.setRights(rank);
        persistence.save(target, "world-admin-rights");
        await persistence.flush();
      } else if (!await persistence.updateOffline(name, save => save.setRights(rank), "world-admin-rights", profile)) {
        throw new HttpError(404, "Player save not found.");
      }
    } else if (action === "kick") {
      if (!target) throw new HttpError(409, "The player is offline.");
      target.requestLogout();
    } else if (["ban", "mute"].includes(action) && typeof enabled === "boolean") {
      const punishment = api.getPlayerPunishment();
      punishment[enabled ? action : `un${action}`](name);
      await punishment.flush();
      if (action === "ban" && enabled) target?.requestLogout();
    } else throw new HttpError(400, "Unknown player action.");
    send(response, 200, { ok: true });
    return true;
  }

  if (request.method !== "GET") throw new HttpError(405, "Method not allowed");
  const jsonBackend = persistence ? persistence.constructor.name === "JsonPlayerPersistence" : offlineCatalogue?.jsonPlayerSaves;
  const saves = new Map(savedPlayers(profile, jsonBackend)
    .map(([username, json]) => [key(username), parseSave(json)]));
  const row = (username, save) => {
    const player = live.get(username);
    const punishment = api?.getPlayerPunishment?.();
    return {
      username: player?.getUsername() ?? (typeof save?.username === "string" ? save.username : username),
      id: username,
      online: Boolean(player),
      rights: player?.getRights().getId() ?? save?.rights?.id ?? 0,
      banned: punishment?.banned(username) ?? false,
      muted: punishment?.muted(username) ?? false,
      ...(player ? { combat: player.getSkillManager().getCombatLevel(), total: player.getSkillManager().getTotalLevel() } : levels(save ?? {})),
    };
  };
  if (url.pathname === "/api/players") {
    const ids = new Set([...saves.keys(), ...live.keys()]);
    send(response, 200, { players: [...ids].map(username => row(username, saves.get(username))) });
  } else {
    if (!USERNAME.test(name)) throw new HttpError(400, "Invalid player name.");
    const username = key(name);
    const save = saves.get(username);
    if (!save && !live.has(username)) throw new HttpError(404, "Player not found.");
    // Gameplay fields only. Account credentials and remembered login tokens stay on the server.
    const { skills, inventory, equipment, banks, position, appearance, totalKills, deaths, highestKillstreak } = save ?? {};
    send(response, 200, {
      player: row(username, save),
      save: { skills, inventory, equipment, banks, position, appearance, totalKills, deaths, highestKillstreak },
    });
  }
  return true;
}

module.exports = { playerRoutes };
