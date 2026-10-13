"use strict";

const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const { CONFIG_KEY, AI_BOT_ATTRIBUTE, readAiBotConfig } = require("./AiBotConfig");
const { createProviders, providerFor } = require("./AiBotProviders");
const { AiBotRoster } = require("./AiBotRoster");
const { AiBotMind } = require("./AiBotMind");
const { AiBotCallLimiter, AiBotChatRouter } = require("./AiBotChat");
const { AiBotPresence } = require("./AiBotPresence");
const { buildSystemPrompt } = require("./AiBotPrompt");
const { buildTools } = require("./AiBotTools");
const { chooseName } = require("./AiBotNames");
const { rollPersona } = require("./AiBotPersona");
const { attachBrain } = require("../brain/attachBrain");
const { applyLevels, applyOutfit, outfitTier } = require("../brain/BotSiteSpawner");
const PLACES = require("../data/ai-places.json").places;

/**
 * AI bots: PlayerBots bots whose next activity, chat and trades come from a language model
 * (server/docs/ai-bots.md). Off unless world config "PlayerBots:ai" enables it and .env has a
 * provider key. Wired from PlayerBots.plugin.js, as the other runtime pieces are.
 */
const ACTIVITIES_FILE = path.join(process.cwd(), "data", "definitions", "bot-activities.json");
const START_TIERS = ["novices", "intermediates", "advanced"];
const START_COINS = Object.freeze({ novices: [2000, 8000], intermediates: [10000, 40000], advanced: [40000, 150000] });
const SPAWN_DELAY_MS = 2500;
const SPAWN_SPREAD_TILES = 4;

/** What the model is told each activity is: its skill and the level it needs. */
function buildCatalog(registry) {
  const definitions = JSON.parse(fs.readFileSync(ACTIVITIES_FILE, "utf8"));
  const levels = new Map((definitions.activities ?? []).map((entry) => [entry.id, Number(entry.fields?.level ?? 0)]));
  return registry.activities
    .filter((activity) => !activity.manual && !activity.ephemeral && activity.mode && activity.mode !== "pvp" && activity.mode !== "roaming")
    .map((activity) => {
      const level = levels.get(activity.id) ?? 0;
      const about = activity.mode === "combat_training"
        ? "fight monsters that suit your combat level, with your own gear and food"
        : `${activity.mode.replace(/_/g, " ")}${level > 1 ? `, needs level ${level}` : ""}`;
      return { id: activity.id, about, activity };
    });
}

/** A password no one can log in with: AI bot accounts are never playable by people. */
function lockedPassword() {
  return `${crypto.randomBytes(16).toString("hex")}:${crypto.randomBytes(32).toString("hex")}`;
}

function rollBetween([min, max]) {
  return Math.round(min + Math.random() * (max - min));
}

// A failing provider (a wrong key, Ollama not running) is shown on the console this often.
const FAILURE_WARN_MS = 60000;

/**
 * Bot log lines go to the PlayerBots log (BOT_RUNTIME_EVENT_LOGGING=1). Failed model calls
 * also reach the console, at most once a minute per provider, so a bad key isn't silent.
 */
function createLog(botApi) {
  const warnedAt = new Map();
  return (message, extra) => {
    botApi.log(message, extra);
    if (message !== "ai_bot_call_failed") return;
    const now = Date.now();
    if (now - (warnedAt.get(extra.provider) ?? 0) < FAILURE_WARN_MS) return;
    warnedAt.set(extra.provider, now);
    console.warn(`[ai bots] ${extra.provider} call failed for ${extra.bot}: ${extra.error}`);
  };
}

function registerAiBots({ api, botApi, runtime, registry, world, resetMovementState }) {
  const config = readAiBotConfig(api.getPluginConfig(CONFIG_KEY));
  if (config.enabled !== true) {
    return null;
  }
  const log = createLog(botApi);
  const providers = createProviders(config.providers, { log, timeoutMs: config.limits.timeoutSeconds * 1000 });
  if (providers.length === 0) {
    console.warn("[ai bots] enabled, but no provider is configured: set ANTHROPIC_API_KEY or OLLAMA_URL in .env");
    return null;
  }
  const core = api.core;
  const places = new Map(PLACES.map((place) => [place.id, place]));
  const catalog = buildCatalog(registry);
  const toolContext = { activityIds: catalog.map((entry) => entry.id), placeIds: PLACES.map((place) => place.id) };
  const roster = new AiBotRoster();
  const minds = new Map();
  const services = {
    core,
    config,
    roster,
    registry,
    places,
    catalog,
    system: buildSystemPrompt({ disclose: config.disclose === true, activities: catalog, places: PLACES }),
    tools: buildTools(toolContext),
    toolContext,
    limiter: new AiBotCallLimiter(config.limits),
    router: null,
    givenToday: new Map(),
    world,
    watched: (bot) => presence.watched(bot),
    getEntry: (name) => runtime.entriesByUsername.get(name) ?? null,
    log,
    emitCustomEvent: (name, payload) => api.emitCustomEvent(name, payload),
  };
  services.router = new AiBotChatRouter({ core, config, minds });
  const tiers = JSON.parse(fs.readFileSync(ACTIVITIES_FILE, "utf8")).tiers ?? {};

  function nameTaken(name) {
    return roster.has(name) || core.GameConstants.PLAYER_PERSISTENCE?.exists?.(name) === true || !!core.World.getPlayerByName(name);
  }

  function profileFor(index) {
    if (roster.bots[index]) return roster.bots[index];
    const name = chooseName(config.names, index, nameTaken);
    if (!name) return null;
    return roster.add({
      name,
      persona: rollPersona(),
      tier: START_TIERS[Math.floor(Math.random() * START_TIERS.length)],
      home: config.places[index % config.places.length],
    });
  }

  function startLocation(profile, place) {
    if (profile.location) {
      return new core.Location(profile.location.x, profile.location.y, profile.location.z ?? 0);
    }
    const dx = Math.floor(Math.random() * (SPAWN_SPREAD_TILES * 2 + 1)) - SPAWN_SPREAD_TILES;
    const dy = Math.floor(Math.random() * (SPAWN_SPREAD_TILES * 2 + 1)) - SPAWN_SPREAD_TILES;
    return new core.Location(place.x + dx, place.y + dy, place.z ?? 0);
  }

  /** First login only: levels, clothes and some coins for the bot's tier. */
  function outfitNewBot(bot, profile) {
    const tier = tiers[profile.tier] ?? tiers.novices;
    if (tier) {
      const levels = { all: tier.skills, combat: tier.combat };
      applyLevels(bot, levels);
      applyOutfit(bot, outfitTier(levels));
    }
    bot.getInventory().addItem(new core.Item(core.ItemIdentifiers.COINS, rollBetween(START_COINS[profile.tier] ?? START_COINS.novices)));
  }

  /** Logs in AI bot `index`. Returns "spawned", "online", "retry" (still logging out) or "failed". */
  function spawnAiBot(index) {
    const profile = profileFor(index);
    if (!profile) {
      log("ai_bot_no_name", { index });
      return "failed";
    }
    if (minds.has(profile.name.toLowerCase())) {
      return "online";
    }
    if (core.World.getPlayerByName(profile.name)) {
      return "retry";
    }
    const provider = providerFor(providers, profile, index);
    if (profile.provider !== provider.name || profile.model !== provider.model) {
      profile.provider = provider.name;
      profile.model = provider.model;
      roster.save();
    }
    const place = places.get(profile.home) ?? PLACES[0];
    const isNew = core.GameConstants.PLAYER_PERSISTENCE?.exists?.(profile.name) !== true;
    const bot = runtime.spawnPvpBot(startLocation(profile, place), { username: profile.name, persistent: true, mode: "roaming" });
    if (!bot) {
      log("ai_bot_spawn_failed", { name: profile.name });
      return "retry";
    }
    bot.setAttribute(AI_BOT_ATTRIBUTE, true);
    bot.setPasswordHashWithSalt(lockedPassword());
    // An ordinary player: no staff crown, whatever rank a save or a dev login handed it.
    bot.setRights(core.PlayerRights.NONE);
    // Players fight back by default; scripted bots have it off.
    bot.setAutoRetaliate(true);
    api.emitCustomEvent("account:refresh-chat-icons", { player: bot });
    if (isNew) outfitNewBot(bot, profile);
    const mind = new AiBotMind({ bot, profile, provider, services });
    bot.getTradingInteraction = () => mind.trade.interaction;
    minds.set(profile.name.toLowerCase(), mind);
    const roam = registry.byId.get("roam");
    attachBrain({
      runtime,
      registry,
      world,
      bot,
      activity: roam,
      home: bot.getLocation(),
      resetMovementState,
      chooseNext: (nowMs) => mind.chooseNext(nowMs),
      pacing: config.pacing,
    });
    mind.doing = { label: "hanging around", since: Date.now() };
    mind.addEvent("You logged in.");
    mind.requestDecision("login", { delayMs: 3000 });
    log("ai_bot_spawned", { name: profile.name, provider: provider.name, model: provider.model, isNew });
    return "spawned";
  }

  function logOut(bot) {
    bot.getForcedLogoutTimer?.().start?.(0);
    bot.requestLogout?.();
  }

  const presence = new AiBotPresence({ core, config, minds, spawn: spawnAiBot, logOut, log });

  function mindOf(player) {
    return minds.get(String(player?.getUsername?.() ?? "").toLowerCase()) ?? null;
  }

  function onSocialPacket(event) {
    if (event.packet?.type === "public_chat") {
      services.router.onPublicChat(event.player, event.packet.text);
    }
  }

  function onPrivateMessage({ sender, recipient, text }) {
    const mind = mindOf(recipient);
    if (!mind) return;
    const from = sender.getUsername();
    mind.hear({ at: Date.now(), from, text, private: true });
    mind.requestDecision("private", { reply: true, from });
  }

  function onTradeCompleted({ player, partner }) {
    mindOf(player)?.trade.onCompleted(partner.getUsername());
  }

  function onDeath({ player }) {
    const mind = mindOf(player);
    if (!mind) return;
    mind.addEvent("You died.");
    mind.requestDecision("checkIn");
  }

  function onLogout({ player }) {
    const mind = mindOf(player);
    if (!mind) return;
    roster.setLocation(mind.name, player.getLocation());
    minds.delete(mind.name.toLowerCase());
  }

  function onShutdown() {
    for (const mind of minds.values()) {
      roster.setLocation(mind.name, mind.bot.getLocation());
    }
    roster.save(true);
  }

  function listAiBots({ player }) {
    if (minds.size === 0) {
      player.sendMessage("No AI bots are online.");
      return;
    }
    for (const mind of minds.values()) {
      player.sendMessage(`${mind.name}: ${mind.describeDoing(Date.now())} [${mind.provider.name} ${mind.provider.model}]`);
    }
  }

  class AiBotTick extends core.Task {
    constructor() {
      super(1, "ai-bots", false);
    }

    execute() {
      const nowMs = Date.now();
      presence.tick(nowMs);
      for (const mind of minds.values()) {
        try {
          mind.tick(nowMs);
        } catch (error) {
          log("ai_bot_tick_failed", { bot: mind.name, error: String(error?.message ?? error) });
        }
      }
    }
  }

  api.onSocialPacket(onSocialPacket);
  api.onCustomEvent("friends:private-message", onPrivateMessage);
  api.onTradeCompleted(onTradeCompleted);
  api.onPlayerDeath(onDeath);
  api.onPlayerLogout(onLogout);
  api.onServerShutdown(onShutdown);
  api.registerCommand("aibots", listAiBots, core.PlayerRights.OWNER, "List the AI bots and what they're doing");
  api.onServerStartup(() => {
    core.TaskManager.submit(new AiBotTick());
    setTimeout(() => presence.start(), SPAWN_DELAY_MS);
  });
  log("ai_bots_enabled", { count: config.count, providers: providers.map((provider) => `${provider.name}:${provider.model}`) });
  return { minds, roster };
}

module.exports = { registerAiBots, buildCatalog };
