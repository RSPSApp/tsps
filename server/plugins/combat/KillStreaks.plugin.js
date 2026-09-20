const { Flag } = require("../../src/main/typescript/elvarg/game/model/Flag");
const { Wilderness } = require("../../src/main/typescript/elvarg/game/content/wilderness/Wilderness");
const { Item } = require("../../src/main/typescript/elvarg/game/model/Item");
const { ItemIdentifiers } = require("../../src/main/typescript/elvarg/util/ItemIdentifiers");

const GLOW_PRESET_ATTRIBUTE = "visual:glowPreset";
const GLOW_INTENSITY_ATTRIBUTE = "visual:glowIntensity";
const LAST_GLOW_PRESET_ATTRIBUTE = "killstreaks:lastGlowPreset";

const BASE_BLOOD_MONEY_REWARD = 150;
const STREAK_STEP = 5;
const STREAK_STEP_REWARD = 25;
const STREAK_MILESTONE_REWARD = 100;
const MAX_BLOOD_MONEY_STREAK = 10;
const RECENT_KILL_TARGET_LIMIT = 5;

const GLOW_PRESETS = Object.freeze({
  off: 0,
  blood: 1,
  gold: 2,
  toxic: 3,
  ice: 4,
  royal: 5,
  infernal: 6,
});

const COLOR_TIERS = Object.freeze([
  Object.freeze({
    minKills: 3,
    preset: GLOW_PRESETS.blood,
    label: "Blood",
    messageColorTag: "@red@",
    intensityThresholds: Object.freeze([3, 4, 5]),
  }),
  Object.freeze({
    minKills: 6,
    preset: GLOW_PRESETS.toxic,
    label: "Toxic",
    messageColorTag: "@gre@",
    intensityThresholds: Object.freeze([6, 7, 9]),
  }),
  Object.freeze({
    minKills: 10,
    preset: GLOW_PRESETS.ice,
    label: "Ice",
    messageColorTag: "@cya@",
    intensityThresholds: Object.freeze([10, 12, 14]),
  }),
  Object.freeze({
    minKills: 15,
    preset: GLOW_PRESETS.gold,
    label: "Gold",
    messageColorTag: "@yel@",
    intensityThresholds: Object.freeze([15, 17, 19]),
  }),
  Object.freeze({
    minKills: 20,
    preset: GLOW_PRESETS.royal,
    label: "Royal",
    messageColorTag: "@mag@",
    intensityThresholds: Object.freeze([20, 23, 26]),
  }),
  Object.freeze({
    minKills: 30,
    preset: GLOW_PRESETS.infernal,
    label: "Infernal",
    messageColorTag: "@or2@",
    intensityThresholds: Object.freeze([30, 35, 45]),
  }),
]);

function parseAttributeInt(value, fallback = 0) {
  const parsed =
    typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.trunc(parsed);
}

function normalizeKillstreak(player) {
  const streak = parseAttributeInt(player?.getKillstreak?.(), 0);
  return streak > 0 ? streak : 0;
}

function isEligibleKillstreakPlayer(player) {
  return player?.isPlayer?.() === true && player?.isPlayerBot?.() !== true;
}

function resolveColorTier(killstreak) {
  for (let index = COLOR_TIERS.length - 1; index >= 0; index--) {
    const tier = COLOR_TIERS[index];
    if (killstreak >= tier.minKills) {
      return tier;
    }
  }
  return null;
}

function resolveTierIntensity(tier, killstreak) {
  if (!tier) {
    return 1;
  }
  let intensity = 0;
  for (const threshold of tier.intensityThresholds) {
    if (killstreak >= threshold) {
      intensity++;
    }
  }
  return Math.max(1, Math.min(3, intensity));
}

function flagAppearance(player) {
  player?.getUpdateFlag?.()?.flag?.(Flag.APPEARANCE);
}

function syncKillstreakGlow(player) {
  if (!isEligibleKillstreakPlayer(player)) {
    return {
      streak: 0,
      tier: null,
      previousPreset: 0,
      nextPreset: 0,
    };
  }

  const streak = normalizeKillstreak(player);
  const tier = resolveColorTier(streak);
  const nextPreset = tier?.preset ?? GLOW_PRESETS.off;
  const nextIntensity = resolveTierIntensity(tier, streak);

  const rawStoredPreset = player.getAttribute?.(LAST_GLOW_PRESET_ATTRIBUTE);
  const hasStoredPreset = rawStoredPreset !== undefined && rawStoredPreset !== null;
  const storedPreset = parseAttributeInt(rawStoredPreset, 0);
  const previousPreset = hasStoredPreset
    ? storedPreset
    : resolveColorTier(Math.max(0, streak - 1))?.preset ?? GLOW_PRESETS.off;

  // Only override visible glow state when the plugin is actively managing it.
  if (nextPreset > 0 || storedPreset > 0) {
    const currentGlowPreset = parseAttributeInt(
      player.getAttribute?.(GLOW_PRESET_ATTRIBUTE),
      GLOW_PRESETS.off
    );
    const rawCurrentGlowIntensity = player.getAttribute?.(GLOW_INTENSITY_ATTRIBUTE);
    const hasCurrentGlowIntensity =
      rawCurrentGlowIntensity !== undefined && rawCurrentGlowIntensity !== null;
    const currentGlowIntensity = parseAttributeInt(rawCurrentGlowIntensity, 1);

    let appearanceDirty = false;
    if (currentGlowPreset !== nextPreset) {
      player.setAttribute?.(GLOW_PRESET_ATTRIBUTE, nextPreset);
      appearanceDirty = true;
    }
    if (!hasCurrentGlowIntensity || currentGlowIntensity !== nextIntensity) {
      player.setAttribute?.(GLOW_INTENSITY_ATTRIBUTE, nextIntensity);
      appearanceDirty = true;
    }
    if (appearanceDirty) {
      flagAppearance(player);
    }
  }

  if (storedPreset !== nextPreset) {
    player.setAttribute?.(LAST_GLOW_PRESET_ATTRIBUTE, nextPreset);
  }

  return {
    streak,
    tier,
    previousPreset,
    nextPreset,
  };
}

function formatThresholdAnnouncement(player, tier, streak) {
  const username = player?.getUsername?.() ?? "A player";
  return `@red@[Killstreak] @whi@${username} has reached ${tier.messageColorTag}${tier.label}@whi@ status with ${streak} kills in a row!`;
}

function shouldIncrementForBotKill(killer, victim) {
  return (
    isEligibleKillstreakPlayer(killer) &&
    victim?.isPlayerBot?.() === true &&
    killer !== victim &&
    Wilderness.isIn?.(killer) === true &&
    Wilderness.isIn?.(victim) === true
  );
}

function updatePvpInterface(player) {
  if (!isEligibleKillstreakPlayer(player)) {
    return;
  }
  player
    .getPacketSender?.()
    .sendString?.(`@or1@Killstreak: ${normalizeKillstreak(player)}`, 52029)
    ?.sendString?.(`@or1@Kills: ${parseAttributeInt(player.getTotalKills?.(), 0)}`, 52030)
    ?.sendString?.(`@or1@Deaths: ${parseAttributeInt(player.getDeaths?.(), 0)}`, 52031)
    ?.sendString?.(`@or1@K/D Ratio: ${player.getKillDeathRatio?.() ?? "0"}`, 52033);
}

function trackRecentKill(killer, victim) {
  const recentKills = killer?.getRecentKills?.();
  const victimHost = victim?.getHostAddress?.();
  if (!Array.isArray(recentKills) || !victimHost) {
    return;
  }
  if (recentKills.length >= RECENT_KILL_TARGET_LIMIT) {
    recentKills.shift();
  }
  recentKills.push(victimHost);
}

function shouldRewardPlayerKill(killer, victim) {
  if (!isEligibleKillstreakPlayer(killer) || !isEligibleKillstreakPlayer(victim)) {
    return false;
  }

  const killerHost = killer.getHostAddress?.();
  const victimHost = victim.getHostAddress?.();
  if (killerHost && victimHost && killerHost === victimHost) {
    return false;
  }

  const recentKills = killer.getRecentKills?.();
  if (Array.isArray(recentKills) && victimHost && recentKills.includes(victimHost)) {
    return false;
  }

  return true;
}

function resolveStepReward(streak) {
  const cappedStreak = Math.min(Math.max(0, streak), MAX_BLOOD_MONEY_STREAK);
  return Math.floor(cappedStreak / STREAK_STEP) * STREAK_STEP_REWARD;
}

function resolveMilestoneReward(streak) {
  if (streak <= 0 || streak > MAX_BLOOD_MONEY_STREAK || streak % STREAK_STEP !== 0) {
    return 0;
  }
  return Math.floor(streak / STREAK_STEP) * STREAK_MILESTONE_REWARD;
}

function resolveKillstreakBonusReward(streak) {
  return resolveStepReward(streak) + resolveMilestoneReward(streak);
}

function awardBloodMoney(player, victim, amount) {
  if (!isEligibleKillstreakPlayer(player) || amount <= 0) {
    return;
  }

  if (
    player.getInventory?.().contains?.(ItemIdentifiers.BLOOD_MONEY) ||
    (player.getInventory?.().getFreeSlots?.() ?? 0) > 0
  ) {
    player.getInventory().adds(ItemIdentifiers.BLOOD_MONEY, amount);
  } else {
    ItemOnGroundManager.registerNonGlobals(
      player,
      new Item(ItemIdentifiers.BLOOD_MONEY, amount),
      victim?.getLocation?.()?.clone?.() ?? victim?.getLocation?.()
    );
  }
}

function applyKillstreakProgress(player) {
  if (!isEligibleKillstreakPlayer(player)) {
    return {
      streak: 0,
      newHighest: false,
      glowOutcome: syncKillstreakGlow(player),
    };
  }

  player.incrementKillstreak?.();
  const streak = normalizeKillstreak(player);
  const highest = parseAttributeInt(player.getHighestKillstreak?.(), 0);
  const newHighest = streak > highest;
  if (newHighest) {
    player.setHighestKillstreak?.(streak);
  }

  const glowOutcome = syncKillstreakGlow(player);
  updatePvpInterface(player);

  return {
    streak,
    newHighest,
    glowOutcome,
  };
}

function handleVictimDefeat(victim, options = {}) {
  if (!isEligibleKillstreakPlayer(victim)) {
    return;
  }

  if (options.countDeath === true) {
    victim.incrementDeaths?.();
  }
  const previousStreak = normalizeKillstreak(victim);
  if (previousStreak > 0) {
    victim.setKillstreak?.(0);
    victim
      .getPacketSender?.()
      .sendMessage?.(`Your ${previousStreak} killstreak has ended.`);
  }
  syncKillstreakGlow(victim);
  updatePvpInterface(victim);
}

function handleThresholdAnnouncement(killer, outcome) {
  if (!outcome?.tier || outcome.nextPreset === outcome.previousPreset) {
    return;
  }

  World.sendMessage(formatThresholdAnnouncement(killer, outcome.tier, outcome.streak));
}

function sendKillstreakMessage(killer, streak, newHighest) {
  const sender = killer?.getPacketSender?.();
  if (!sender) {
    return;
  }

  if (newHighest) {
    sender.sendMessage?.(`Congratulations! Your highest killstreak is now ${streak}.`);
    return;
  }

  sender.sendMessage?.(`Your killstreak is now ${streak}.`);
}

function applyKillstreakProgressAndAnnouncements(killer) {
  const progress = applyKillstreakProgress(killer);
  sendKillstreakMessage(killer, progress.streak, progress.newHighest);
  handleThresholdAnnouncement(killer, progress.glowOutcome);
  return progress;
}

function awardKillstreakScaledReward(killer, victim, streak, options = {}) {
  if (!isEligibleKillstreakPlayer(killer)) {
    return;
  }
  const baseReward = Math.max(0, Math.floor(Number(options?.baseReward ?? 0)));
  const bonusReward = resolveKillstreakBonusReward(streak);
  const totalReward = baseReward + bonusReward;
  if (totalReward <= 0) {
    return;
  }

  awardBloodMoney(killer, victim, totalReward);
  const sender = killer.getPacketSender?.();
  if (!sender) {
    return;
  }
  const milestoneReward = resolveMilestoneReward(streak);
  if (baseReward > 0) {
    if (milestoneReward > 0) {
      sender.sendMessage?.(
        `You've received ${totalReward} blood money for that kill, including a ${milestoneReward} killstreak bonus.`
      );
      return;
    }
    sender.sendMessage?.(`You've received ${totalReward} blood money for that kill!`);
    return;
  }

  if (milestoneReward > 0) {
    sender.sendMessage?.(
      `You've received ${totalReward} bonus blood money from your killstreak, including a ${milestoneReward} milestone bonus.`
    );
    return;
  }
  sender.sendMessage?.(`You've received ${totalReward} bonus blood money from your killstreak.`);
}

function isEligiblePlayerKill(killer, victim) {
  return (
    isEligibleKillstreakPlayer(killer) &&
    isEligibleKillstreakPlayer(victim) &&
    killer !== victim &&
    Wilderness.isIn?.(killer) === true &&
    Wilderness.isIn?.(victim) === true
  );
}

function handlePlayerKill(killer, victim) {
  if (!isEligiblePlayerKill(killer, victim)) {
    return;
  }

  if (!shouldRewardPlayerKill(killer, victim)) {
    killer
      .getPacketSender?.()
      .sendMessage?.(
        "Repeated kills on the same target do not give blood money or killstreak progress."
      );
    updatePvpInterface(killer);
    return;
  }

  trackRecentKill(killer, victim);
  killer.incrementTotalKills?.();

  const progress = applyKillstreakProgressAndAnnouncements(killer);
  awardKillstreakScaledReward(killer, victim, progress.streak, {
    baseReward: BASE_BLOOD_MONEY_REWARD,
  });
}

let World;
let ItemOnGroundManager;

module.exports = {
  name: "KillStreaks",
  dependsOn: ["Wilderness"],
  register(api) {
    World = api.getWorld();
    ItemOnGroundManager = api.getItemOnGroundManager();
    api.onPlayerLogin(({ player }) => {
      syncKillstreakGlow(player);
      updatePvpInterface(player);
    });

    api.onPlayerDefeated(({ killer, victim }) => {
      const botKill = shouldIncrementForBotKill(killer, victim);
      const playerKill = isEligiblePlayerKill(killer, victim);

      if (botKill) {
        applyKillstreakProgressAndAnnouncements(killer);
      }
      handleVictimDefeat(victim, { countDeath: playerKill });
      if (playerKill) {
        handlePlayerKill(killer, victim);
      }
    });
  },
};
