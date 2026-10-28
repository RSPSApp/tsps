const { ItemIdentifiers } = require("../../src/main/typescript/elvarg/util/ItemIdentifiers");

const HALLOWEEN_COMPLETE_ATTRIBUTE = "halloween:complete";
const HALLOWEEN_KILL_COUNT_ATTRIBUTE = "halloween:kills";

let eventScheduler = null;
let spawnedNpcs = [];
let pluginApi = null;

function loadEventScheduler() {
  try {
    eventScheduler = require("./EventScheduler.plugin.js");
  } catch (e) {
    if (pluginApi) {
      pluginApi.log("HalloweenEvents: failed to load EventScheduler", { error: e.message });
    }
  }
}

function hasReceivedReward(player, rewardId) {
  if (!player) return true;
  const completed = player.getAttribute(HALLOWEEN_COMPLETE_ATTRIBUTE) || {};
  return completed[rewardId] === true;
}

function markRewardReceived(player, rewardId) {
  if (!player) return;
  let completed = player.getAttribute(HALLOWEEN_COMPLETE_ATTRIBUTE) || {};
  completed = { ...completed, [rewardId]: true };
  player.setAttribute(HALLOWEEN_COMPLETE_ATTRIBUTE, completed);
}

function getUnreceivedRewards(eventDef, player) {
  if (!eventDef || !eventDef.rewards) return [];
  return eventDef.rewards.filter((reward) => {
    if (!reward.oncePerAccount) return true;
    return !hasReceivedReward(player, reward.id);
  });
}

function grantReward(player, rewardDef) {
  if (!player || !rewardDef) return;

  if (rewardDef.oncePerAccount && hasReceivedReward(player, rewardDef.id)) {
    player.message("You have already received this reward this Halloween.");
    return;
  }

  const inventory = player.getInventory();
  if (!inventory) {
    player.message("Your inventory is full.");
    return;
  }

  const itemId = ItemIdentifiers[rewardDef.id];
  if (!itemId) {
    if (pluginApi) {
      pluginApi.log(`HalloweenEvents: unknown reward id '${rewardDef.id}'`);
    }
    return;
  }

  const success = inventory.add(itemId, 1);
  if (success) {
    player.message(`You receive a ${rewardDef.name}.`);
    if (rewardDef.oncePerAccount) {
      markRewardReceived(player, rewardDef.id);
    }
  } else {
    player.message("Your inventory is full.");
  }
}

function handleSkeletonInteraction({ player }) {
  if (!player) return;

  const eventDef = eventScheduler?.getLoadedEvents?.()["halloween"];
  if (!eventDef || !eventDef.rewards) return;

  const unreceived = getUnreceivedRewards(eventDef, player);

  if (unreceived.length === 0) {
    player.message("You have already claimed all your Halloween rewards.");
    return;
  }

  player.message("The skeleton rattles and drops Halloween treasures at your feet.");

  for (const reward of unreceived) {
    grantReward(player, reward);
  }
}

function onEventActive({ key, active }) {
  if (key !== "halloween") return;

  if (active) {
    activateHalloween();
  } else {
    deactivateHalloween();
  }
}

function activateHalloween() {
  if (!pluginApi) return;

  const eventDef = eventScheduler?.getLoadedEvents?.()["halloween"];
  if (!eventDef || !eventDef.npcs) return;

  for (const npcDef of eventDef.npcs) {
    try {
      const npc = pluginApi.spawnNpc({
        id: npcDef.id,
        x: npcDef.x,
        y: npcDef.y,
        z: npcDef.plane || 0,
        wanderRadius: npcDef.wanderRadius || 0,
      });
      if (npc) {
        spawnedNpcs.push(npc);
      }
    } catch (e) {
      if (pluginApi) {
        pluginApi.log(
          `HalloweenEvents: failed to spawn NPC ${npcDef.id}`,
          { error: e.message }
        );
      }
    }
  }

  if (pluginApi) {
    pluginApi.onNpcInteraction("Skeleton", { "Talk-to": handleSkeletonInteraction });
  }
}

function deactivateHalloween() {
  if (!pluginApi) return;

  for (const npc of spawnedNpcs) {
    try {
      pluginApi.removeNpc(npc);
    } catch (e) {
      if (pluginApi) {
        pluginApi.log(`HalloweenEvents: failed to remove NPC`, { error: e.message });
      }
    }
  }

  spawnedNpcs = [];
}

function onPlayerLogin({ player }) {
  if (!eventScheduler) loadEventScheduler();

  const activeEvents = eventScheduler?.getActiveEvents?.();
  if (activeEvents && activeEvents.has("halloween")) {
    player.message("Halloween is currently active! Hunt the monsters and visit the Skeleton for rewards.");
  }
}

module.exports = {
  name: "HalloweenEvents",
  initialize(api) {
    pluginApi = api;
    loadEventScheduler();
  },
  register(api) {
    api.onCustomEvent("events:active", onEventActive);
    api.onPlayerLogin(onPlayerLogin);
    api.persistAttribute(HALLOWEEN_COMPLETE_ATTRIBUTE, null);
    api.persistAttribute(HALLOWEEN_KILL_COUNT_ATTRIBUTE, null);
  },
  getSpawnedNpcs: () => spawnedNpcs,
};
