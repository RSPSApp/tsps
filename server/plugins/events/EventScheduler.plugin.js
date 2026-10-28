const fs = require("fs");
const path = require("path");

const EVENTS_ATTRIBUTE = "event-scheduler-active";
const EVENT_OVERRIDE_KEY = "event-override";
const EVENT_CHECK_INTERVAL = 600;

let definitionSourceRegistered = false;
let loadedEvents = {};
let activeEvents = new Set();
let overrideEvent = null;
let checkTask = null;
let pluginApi = null;
let loadedWorldProfile = null;

function loadEventsData() {
  try {
    const eventsPath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "data",
      "definitions",
      "events.json"
    );
    if (fs.existsSync(eventsPath)) {
      const raw = fs.readFileSync(eventsPath, "utf-8");
      loadedEvents = JSON.parse(raw);
    } else {
      loadedEvents = {};
    }
  } catch (e) {
    if (pluginApi) {
      pluginApi.log("EventScheduler: failed to load events.json", { error: e.message });
    }
    loadedEvents = {};
  }
}

function isDateInWindow(eventDef) {
  const now = new Date();
  const year = now.getUTCFullYear();

  const startMonth = eventDef.monthStart || 1;
  const startDay = eventDef.dayStart || 1;
  const endMonth = eventDef.monthEnd || 12;
  const endDay = eventDef.dayEnd || 28;

  let startDate = new Date(Date.UTC(year, startMonth - 1, startDay, 0, 0, 0, 0));
  let endDate = new Date(Date.UTC(year, endMonth - 1, endDay, 23, 59, 59, 999));

  if (endMonth < startMonth) {
    endDate = new Date(Date.UTC(year + 1, endMonth - 1, endDay, 23, 59, 59, 999));
  }

  const nowMs = now.getTime();
  return nowMs >= startDate.getTime() && nowMs <= endDate.getTime();
}

function evaluateActiveEvents() {
  const newActive = new Set();
  const wasActive = new Set(activeEvents);

  for (const [key, eventDef] of Object.entries(loadedEvents)) {
    const enabled = eventDef.enabled !== false;
    const inWindow = isDateInWindow(eventDef);

    if (enabled && inWindow) {
      newActive.add(key);
    }
  }

  if (overrideEvent) {
    newActive.add(overrideEvent);
  }

  for (const key of newActive) {
    if (!wasActive.has(key)) {
      if (pluginApi) {
        pluginApi.emitCustomEvent("events:active", { key, active: true, phase: "start" });
      }
    }
  }

  for (const key of wasActive) {
    if (!newActive.has(key)) {
      if (pluginApi) {
        pluginApi.emitCustomEvent("events:active", { key, active: false, phase: "end" });
      }
    }
  }

  activeEvents = newActive;
  return newActive;
}

function cleanupEvent(key) {
  if (!pluginApi) return;

  const eventDef = loadedEvents[key];
  if (!eventDef) return;

  const spawnedNpcs = pluginApi.core.getWorld().getNpcList();
  const eventNpcIds = new Set((eventDef.npcs || []).map((n) => n.id));

  for (const npc of spawnedNpcs) {
    if (npc?.getPluginName?.() === "EventScheduler") {
      pluginApi.removeNpc(npc);
    }
  }
}

function scheduleEvent(key) {
  if (!pluginApi) return;

  const eventDef = loadedEvents[key];
  if (!eventDef || !eventDef.npcs) return;

  for (const npcDef of eventDef.npcs) {
    try {
      pluginApi.spawnNpc({
        id: npcDef.id,
        x: npcDef.x,
        y: npcDef.y,
        z: npcDef.plane || 0,
        wanderRadius: npcDef.wanderRadius || 0,
      });
    } catch (e) {
      if (pluginApi) {
        pluginApi.log(
          `EventScheduler: failed to spawn NPC ${npcDef.id}`,
          { error: e.message }
        );
      }
    }
  }
}

function forceEvent(key) {
  if (!pluginApi) return;

  if (key === null || key === "") {
    overrideEvent = null;
    evaluateActiveEvents();
    return;
  }

  if (!loadedEvents[key]) {
    if (pluginApi) {
      pluginApi.log(`EventScheduler: unknown event key '${key}'`);
    }
    return;
  }

  overrideEvent = key;
  evaluateActiveEvents();
}

function onServerStartup({ world }) {
  loadEventsData();
  evaluateActiveEvents();

  const taskManager = pluginApi.getTaskManager();
  checkTask = {
    key: Symbol("event-scheduler-check"),
    interval: EVENT_CHECK_INTERVAL,
    run: function () {
      evaluateActiveEvents();
    },
    stop: false,
  };

  taskManager.submit({
    key: checkTask.key,
    interval: EVENT_CHECK_INTERVAL,
    execute: function () {
      if (checkTask.stop) return false;
      evaluateActiveEvents();
      return true;
    },
  });
}

function onServerShutdown() {
  if (checkTask && pluginApi) {
    pluginApi.getTaskManager().cancelTasks(checkTask.key);
  }

  for (const key of activeEvents) {
    cleanupEvent(key);
  }

  activeEvents.clear();
  overrideEvent = null;
}

function onPlayerLogout({ player }) {
  if (player) {
    player.setAttribute(EVENTS_ATTRIBUTE, null);
  }
}

function registerCommand() {
  const { PlayerRights } = require("../../src/main/typescript/elvarg/game/model/rights/PlayerRights");

  function forceEventCmd(player, args) {
    const key = args[0] || null;
    forceEvent(key);

    if (key) {
      player.message(
        `EventScheduler: event '${key}' forced active.`
      );
    } else {
      player.message("EventScheduler: event override cleared.");
    }
  }

  return {
    command: "forceevent",
    handler: forceEventCmd,
    minimumRights: PlayerRights.OWNER,
    description: "Force a holiday event to be active for testing.",
  };
}

module.exports = {
  name: "EventScheduler",
  initialize(api) {
    pluginApi = api;
  },
  register(api) {
    if (!definitionSourceRegistered) {
      api.registerDefinitionSource("events", "data/definitions/events.json");
      definitionSourceRegistered = true;
    }

    api.onServerStartup(onServerStartup);
    api.onServerShutdown(onServerShutdown);
    api.onPlayerLogout(onPlayerLogout);

    const cmd = registerCommand();
    api.registerCommand(cmd.command, cmd.handler, cmd.minimumRights, cmd.description);

    api.persistAttribute(EVENTS_ATTRIBUTE, null);
  },
  getActiveEvents: () => activeEvents,
  getLoadedEvents: () => loadedEvents,
  forceEvent: forceEvent,
  isEventActive: (key) => activeEvents.has(key),
};
