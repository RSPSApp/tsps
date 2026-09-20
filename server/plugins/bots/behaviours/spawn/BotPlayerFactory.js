const { Flag } = require("../../../../src/main/typescript/elvarg/game/model/Flag");
const { Appearance } = require("../../../../src/main/typescript/elvarg/game/model/Appearance");
const { Player } = require("../../../../src/main/typescript/elvarg/game/entity/impl/player/Player");
const { BotPlayerSession } = require("../../../../src/main/typescript/elvarg/net/BotPlayerSession");
const { GameConstants } = require("../../../../src/main/typescript/elvarg/game/GameConstants");
const { Misc } = require("../../../../src/main/typescript/elvarg/util/Misc");

const COLOR_RANGES = [
  [0, 11], // hair
  [0, 15], // torso
  [0, 15], // legs
  [0, 5], // feet
  [0, 7], // skin
];

const MALE_RANGES = {
  head: [0, 8],
  beard: [10, 17],
  chest: [18, 25],
  arms: [26, 31],
  hands: [33, 34],
  legs: [36, 40],
  feet: [42, 43],
};

const FEMALE_RANGES = {
  head: [45, 54],
  beard: [292, 306],
  chest: [56, 60],
  arms: [61, 65],
  hands: [67, 68],
  legs: [70, 77],
  feet: [79, 80],
};

function randomInclusive(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFromRange([min, max]) {
  return randomInclusive(Math.min(min, max), Math.max(min, max));
}

function buildRandomAppearanceLook() {
  const gender = Math.random() < 0.5 ? 0 : 1;
  const look = new Array(13).fill(0);
  const ranges = gender === 0 ? MALE_RANGES : FEMALE_RANGES;

  look[Appearance.GENDER] = gender;
  look[Appearance.HEAD] = randomFromRange(ranges.head);
  look[Appearance.CHEST] = randomFromRange(ranges.chest);
  look[Appearance.ARMS] = randomFromRange(ranges.arms);
  look[Appearance.HANDS] = randomFromRange(ranges.hands);
  look[Appearance.LEGS] = randomFromRange(ranges.legs);
  look[Appearance.FEET] = randomFromRange(ranges.feet);
  look[Appearance.BEARD] = randomFromRange(ranges.beard);

  look[Appearance.HAIR_COLOUR] = randomFromRange(COLOR_RANGES[0]);
  look[Appearance.TORSO_COLOUR] = randomFromRange(COLOR_RANGES[1]);
  look[Appearance.LEG_COLOUR] = randomFromRange(COLOR_RANGES[2]);
  look[Appearance.FEET_COLOUR] = randomFromRange(COLOR_RANGES[3]);
  look[Appearance.SKIN_COLOUR] = randomFromRange(COLOR_RANGES[4]);

  return look;
}

function createBotPlayer(username, spawn, options = {}) {
  const loadPersistence = options.loadPersistence !== false;
  const saveRandomizedAppearance = options.saveRandomizedAppearance !== false;
  const World = options.api.getWorld();
  const existing =
    World.getPlayerByName(username) ||
    World.getAddPlayerQueue().find((p) => p && p.getUsername() === username);
  if (existing) {
    return null;
  }

  const session = new BotPlayerSession();
  const bot = new Player(session, spawn.clone());
  bot.setUsername(username);
  bot.setLongUsername(Misc.stringToLongBigInt(username));
  bot.setHostAddress("bot");
  bot.setAutoRetaliate(false);
  bot.setLastKnownRegion(spawn.clone());

  let appliedPersistence = false;
  let hasValidSavedAppearance = false;
  if (loadPersistence) {
    try {
      const persistence = GameConstants.PLAYER_PERSISTENCE;
      const playerSave = persistence?.load?.(username);
      if (playerSave && typeof playerSave.applyToPlayer === "function") {
        const rawAppearance =
          typeof playerSave.getAppearance === "function"
            ? playerSave.getAppearance()
            : playerSave?.appearance;
        hasValidSavedAppearance =
          Array.isArray(rawAppearance) && rawAppearance.length >= 13;
        playerSave.applyToPlayer(bot);
        appliedPersistence = true;
      }
    } catch (err) {
      console.error(`[PlayerBots] Failed to load persistence for ${username}`, err);
    }
  }

  // Apply after persistence so older walking-only saves also start with run enabled.
  bot.setRunning(true);
  bot.setRunEnergy(100);

  // Older bot saves often have empty/missing appearance arrays; randomize once
  // so bots don't collapse to the same default look.
  if (!appliedPersistence || !hasValidSavedAppearance) {
    bot.getAppearance().setLookArray(buildRandomAppearanceLook());
    if (saveRandomizedAppearance) {
      try {
        GameConstants.PLAYER_PERSISTENCE?.save?.(bot);
      } catch (err) {
        console.error(`[PlayerBots] Failed to save randomized appearance for ${username}`, err);
      }
    }
  }

  // Full-time PvP bots are assigned explicit hotspot spawns. Persisted player
  // positions should not drag them back to stale saved coordinates.
  bot.setLocation(spawn.clone());
  bot.setLastKnownRegion(spawn.clone());
  bot.getUpdateFlag().flag(Flag.APPEARANCE);
  World.getAddPlayerQueue().push(bot);
  return bot;
}

module.exports = {
  createBotPlayer,
};
