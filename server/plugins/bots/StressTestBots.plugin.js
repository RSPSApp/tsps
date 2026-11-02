// Network stress-testing mode: spawns a large number of equipped player
// bots that occasionally walk, chat, and emote. No PvP or economy behaviors -
// this exists purely to generate realistic player-update load.
// Enabled via `--stressTest[=count]` (see Server.ts), off by default.
const { initPvpTierLoadouts } = require("./behaviours/pvp/PvpTierLoadouts.PlayerBots");
const { Animation } = require("../../src/main/typescript/elvarg/game/model/Animation");
const { Location } = require("../../src/main/typescript/elvarg/game/model/Location");
const { Task } = require("../../src/main/typescript/elvarg/game/task/Task");
const { ChatPacketListener } = require("../../src/main/typescript/elvarg/net/packet/impl/ChatPacketListener");
const { createBotPlayer } = require("./behaviours/spawn/PlayerFactory.PlayerBots");
const { randomInRange } = require("./behaviours/navigation/Navigation.PlayerBots");
const { ATTR_SKIP_PERSISTENCE } = require("./runtime/PersistenceConstants.PlayerBots");
const {
  buildRoamingPvpMetadata,
} = require("./behaviours/pvp/PvpAssignment.PlayerBots");
const {
  applyGeneratedPvpLoadout,
} = require("./behaviours/policies/PvpLoadoutPolicy.PlayerBots");
const {
  nextStressBotActivityTick,
  randomClippedStepWithinBounds,
  shouldTakeStressBotStep,
} = require("./Movement.StressTestBots");

const GRAND_EXCHANGE_BOUNDS = Object.freeze({
  minX: 3152,
  maxX: 3176,
  minY: 3476,
  maxY: 3500,
  z: 0,
});
const SPAWN_TILE_PROBE_LIMIT = 40;
const SPAWN_BATCH_SIZE = 50;
const SPAWN_BATCH_DELAY_MS = 20;
const CHAT_DELAY_TICKS = Object.freeze({ min: 14, max: 40 });
const EMOTE_DELAY_TICKS = Object.freeze({ min: 20, max: 60 });
const CHAT_MESSAGES = Object.freeze([
  "Anyone want to fight?",
  "Good luck!",
  "Nice gear.",
  "Selling loot!",
  "Buying supplies.",
  "What are you training?",
  "Anyone doing Castle Wars?",
  "That was close.",
  "Need food.",
  "Back in a minute.",
]);
const EMOTES = Object.freeze([855, 856, 858, 857, 863, 862, 864, 861, 866, 865].map(
  (id) => new Animation(id)
));

function parseStressBotCount() {
  const raw = process.env.STRESS_TEST_BOT_COUNT;
  if (raw === undefined) {
    return 0;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.floor(value);
}

// Same approach as the wilderness roamer spawns elsewhere in this plugin
// directory: pick a random tile in bounds and reject it via RegionManager's
// clipping check (this also keeps bots off water, which has no floor).
function findWalkableTile(RegionManager, bounds) {
  const z = Math.floor(bounds.z ?? 0);
  for (let attempt = 0; attempt < SPAWN_TILE_PROBE_LIMIT; attempt++) {
    const candidate = new Location(
      randomInRange(bounds.minX, bounds.maxX),
      randomInRange(bounds.minY, bounds.maxY),
      z
    );
    if (!RegionManager.blocked(candidate, null)) {
      return candidate;
    }
  }
  return null;
}

module.exports = {
  name: "StressTestBots",
  register(api) {
    initPvpTierLoadouts(api);
    const requestedCount = parseStressBotCount();
    if (requestedCount <= 0) {
      return;
    }

    const RegionManager = api.getRegionManager();
    const players = [];
    let loadoutFailures = 0;
    let activityTick = 0;

    const spawnOne = (index) => {
      const location = findWalkableTile(RegionManager, GRAND_EXCHANGE_BOUNDS);
      if (!location) {
        return;
      }
      const bot = createBotPlayer(`StressBot${index}`, location, {
        api,
        loadPersistence: false,
        saveRandomizedAppearance: false,
      });
      if (!bot) {
        return;
      }
      bot.setPlayerBot?.(true);
      try {
        if (!applyGeneratedPvpLoadout(
          bot,
          { pvp: buildRoamingPvpMetadata({ excludeF2p: true }) }
        )) {
          loadoutFailures += 1;
        }
      } catch (error) {
        loadoutFailures += 1;
        if (loadoutFailures === 1) {
          api.log("stress_test_bot_loadout_failed", { error: String(error) });
        }
      }
      bot.setAttribute?.(ATTR_SKIP_PERSISTENCE, true);
      players.push({
        player: bot,
        nextChatTick: nextStressBotActivityTick(activityTick, 1, CHAT_DELAY_TICKS.max),
        nextEmoteTick: nextStressBotActivityTick(activityTick, 2, EMOTE_DELAY_TICKS.max),
      });
    };

    let cursor = 0;
    const spawnBatch = () => {
      const end = Math.min(cursor + SPAWN_BATCH_SIZE, requestedCount);
      while (cursor < end) {
        cursor += 1;
        spawnOne(cursor);
      }
      if (cursor < requestedCount) {
        setTimeout(spawnBatch, SPAWN_BATCH_DELAY_MS);
        return;
      }
      api.log("stress_test_bots_spawned", {
        requested: requestedCount,
        spawned: players.length,
        loadoutFailures,
      });
    };
    setTimeout(spawnBatch, 0);

    api.getTaskManager().submit(
      new (class extends Task {
        execute() {
          activityTick += 1;
          for (const activity of players) {
            const { player } = activity;
            if (!player.isRegistered?.()) {
              continue;
            }
            if (shouldTakeStressBotStep()) {
              randomClippedStepWithinBounds(player, GRAND_EXCHANGE_BOUNDS);
            }
            if (activityTick >= activity.nextChatTick) {
              ChatPacketListener.handleText(
                player,
                CHAT_MESSAGES[randomInRange(0, CHAT_MESSAGES.length - 1)]
              );
              activity.nextChatTick = nextStressBotActivityTick(
                activityTick,
                CHAT_DELAY_TICKS.min,
                CHAT_DELAY_TICKS.max
              );
            }
            if (activityTick >= activity.nextEmoteTick) {
              player.performAnimation(EMOTES[randomInRange(0, EMOTES.length - 1)]);
              activity.nextEmoteTick = nextStressBotActivityTick(
                activityTick,
                EMOTE_DELAY_TICKS.min,
                EMOTE_DELAY_TICKS.max
              );
            }
          }
        }
      })(1)
    );
  },
};
