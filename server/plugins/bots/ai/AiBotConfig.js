"use strict";

/**
 * AI bots' settings: world.json / world.local.json pluginConfig "PlayerBots:ai", merged over
 * DEFAULTS one section deep. API keys never go here; they come from the environment (.env),
 * see AiBotProviders.js.
 *
 *   "pluginConfig": { "PlayerBots:ai": {
 *     "enabled": true, "count": 4, "places": ["lumbridge", "draynor_village"],
 *     "providers": [{ "provider": "anthropic", "model": "claude-sonnet-5-5", "effort": "low" }],
 *     "gifts": { "perTrade": 20000 }
 *   } }
 */
const CONFIG_KEY = "PlayerBots:ai";
// Set on AI bots, so other bot features (recruiting, duel auto-accept) leave them alone.
const AI_BOT_ATTRIBUTE = "ai-bots:ai";

const DEFAULTS = Object.freeze({
  enabled: false,
  // How many AI bots are online. Each keeps its name, save and notes between restarts.
  count: 3,
  // Where new AI bots start, round-robin (ids from data/ai-places.json).
  places: ["lumbridge", "draynor_village", "varrock"],
  // "realistic" (player-like names) or "numbered" (AiBot1, AiBot2, ...).
  names: "realistic",
  // true: bots say they are AI-controlled when asked, and their persona says so too.
  disclose: false,
  // Each new bot takes the next provider entry that has its key set (.env), round-robin.
  providers: [
    // Haiku takes no effort setting (null leaves it out); Opus/Sonnet 5.5 do ("low" suits chat).
    { provider: "anthropic", model: "claude-haiku-4-5", effort: null },
    { provider: "ollama", model: "llama3.1" },
  ],
  chat: {
    // Bots hear public chat this many tiles away.
    radius: 15,
    // Chance a bot answers chat not meant for anyone in particular.
    replyChance: 0.35,
    // ...when it reads as a question or a greeting.
    questionReplyChance: 0.6,
    // Chance a second bot joins in after the first answer.
    joinInChance: 0.1,
    // Seconds a player and a bot count as talking to each other after their last exchange.
    conversationSeconds: 60,
    // Seconds a bot waits between two public messages of its own.
    cooldownSeconds: 6,
    // Chance a bot answers another bot (only with a real player nearby).
    botReplyChance: 0.15,
    // Bot-to-bot replies in a row before they stop (a real player speaking resets it).
    maxBotChain: 2,
  },
  limits: {
    // Model calls per bot per minute, and for all AI bots together.
    callsPerBotPerMinute: 4,
    callsPerMinute: 30,
    // Seconds before an unanswered model call is given up on.
    timeoutSeconds: 45,
  },
  // Minutes between a bot's own check-ins (keep going, or do something else?).
  checkInMinutes: [8, 15],
  // A bot with no real player within this many tiles makes no model calls of its own (no
  // check-ins, no idle choices: its brain picks). Chat, messages and trades still get answers.
  watchTiles: 64,
  // Minutes with no real player online before AI bots log out (0: they stay). They come
  // back a few at a time when someone logs in. Saves server time, not just model calls.
  logoutWhenEmptyMinutes: 0,
  // How long a bot takes between things, in ms ([min, max], rolled each time), so it doesn't
  // act every tick: after an action, before a new activity, sometimes between walk legs.
  pacing: {
    actionPauseMs: [600, 2400],
    activityPauseMs: [2000, 8000],
    walkPauseChance: 0.3,
    walkPauseMs: [600, 2400],
    // Slots dropped per tick when emptying the inventory.
    dropsPerTick: [1, 2],
  },
  gifts: {
    // The most a bot may lose on one trade, in coins of Grand Exchange value.
    perTrade: 10000,
    // The most it may give one player in a day.
    perPlayerPerDay: 25000,
  },
});

function mergeSection(defaults, value) {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...defaults, ...value } : defaults;
}

/** The effective config; `raw` is the pluginConfig value (undefined when the world sets none). */
function readAiBotConfig(raw) {
  const config = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    ...DEFAULTS,
    ...config,
    chat: mergeSection(DEFAULTS.chat, config.chat),
    limits: mergeSection(DEFAULTS.limits, config.limits),
    gifts: mergeSection(DEFAULTS.gifts, config.gifts),
    pacing: mergeSection(DEFAULTS.pacing, config.pacing),
    providers: Array.isArray(config.providers) ? config.providers : DEFAULTS.providers,
    places: Array.isArray(config.places) && config.places.length > 0 ? config.places : DEFAULTS.places,
  };
}

module.exports = { AI_BOT_ATTRIBUTE, CONFIG_KEY, DEFAULTS, readAiBotConfig };
