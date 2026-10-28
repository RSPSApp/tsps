const { ItemIdentifiers } = require("../../src/main/typescript/elvarg/util/ItemIdentifiers");

const EASTER_COMPLETE_ATTRIBUTE = "easter:complete";
const EASTER_EGGS_FOUND_ATTRIBUTE = "easter:eggs-found";

let eventScheduler = null;
let spawnedNpcs = [];
let spawnedRocks = [];
let pluginApi = null;

function loadEventScheduler() {
  try {
    eventScheduler = require("./EventScheduler.plugin.js");
  } catch (e) {
    if (pluginApi) {
      pluginApi.log("EasterEvents: failed to load EventScheduler", { error: e.message });
    }
  }
}

function hasReceivedReward(player, rewardId) {
  if (!player) return true;
  const completed = player.getAttribute(EASTER_COMPLETE_ATTRIBUTE) || {};
  return completed[rewardId] === true;
}

function markRewardReceived(player, rewardId) {
  if (!player) return;
  let completed = player.getAttribute(EASTER_COMPLETE_ATTRIBUTE) || {};
  completed = { ...completed, [rewardId]: true };
  player.setAttribute(EASTER_COMPLETE_ATTRIBUTE, completed);
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
    player.message("You have already received this reward this Easter.");
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
      pluginApi.log(`EasterEvents: unknown reward id '${rewardDef.id}'`);
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

function handleEasterBunnyInteraction({ player }) {
  if (!player) return;

  const eventDef = eventScheduler?.getLoadedEvents?.()["easter"];
  if (!eventDef || !eventDef.rewards) return;

  const unreceived = getUnreceivedRewards(eventDef, player);

  if (unreceived.length === 0) {
    player.message("You have already claimed all your Easter rewards.");
    return;
  }

  player.message("The Easter Bunny hops excitedly and shares its Easter eggs with you.");

  for (const reward of unreceived) {
    grantReward(player, reward);
  }
}

function onEventActive({ key, active }) {
  if (key !== "easter") return;

  if (active) {
    activateEaster();
  } else {
    deactivateEaster();
  }
}

function activateEaster() {
  if (!pluginApi) return;

  const eventDef = eventScheduler?.getLoadedEvents?.()["easter"];
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
          `EasterEvents: failed to spawn NPC ${npcDef.id}`,
          { error: e.message }
        );
      }
    }
  }

  if (pluginApi) {
    pluginApi.onNpcInteraction("Easter Bunny", { "Talk-to": handleEasterBunnyInteraction });
  }
}

function deactivateEaster() {
  if (!pluginApi) return;

  for (const npc of spawnedNpcs) {
    try {
      pluginApi.removeNpc(npc);
    } catch (e) {
      if (pluginApi) {
        pluginApi.log(`EasterEvents: failed to remove NPC`, { error: e.message });
      }
    }
  }

  for (const rock of spawnedRocks) {
    try {
      pluginApi.removeGameObject(rock);
    } catch (e) {
      if (pluginApi) {
        pluginApi.log(`EasterEvents: failed to remove game object`, { error: e.message });
      }
    }
  }

  spawnedNpcs = [];
  spawnedRocks = [];
}

function onPlayerLogin({ player }) {
  if (!eventScheduler) loadEventScheduler();

  const activeEvents = eventScheduler?.getActiveEvents?.();
  if (activeEvents && activeEvents.has("easter")) {
    player.message("Easter is currently active! Find the Easter eggs and visit the Easter Bunny for rewards.");
  }
}

module.exports = {
  name: "EasterEvents",
  initialize(api) {
    pluginApi = api;
    loadEventScheduler();
  },
  register(api) {
    api.onCustomEvent("events:active", onEventActive);
    api.onPlayerLogin(onPlayerLogin);
    api.persistAttribute(EASTER_COMPLETE_ATTRIBUTE, null);
    api.persistAttribute(EASTER_EGGS_FOUND_ATTRIBUTE, null);
  },
  getSpawnedNpcs: () => spawnedNpcs,
  getSpawnedRocks: () => spawnedRocks,
};
