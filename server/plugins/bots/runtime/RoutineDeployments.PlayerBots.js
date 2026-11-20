"use strict";

const { DEFAULT_SPAWN_SETUP } = require("./Deploy.PlayerBots");
const { listedRoutines, routineName } = require("./RoutineCatalog.PlayerBots");
const { routineOverrideFields } = require("./DeploymentOverrides.PlayerBots");
const families = require("./RoutineFamilies.PlayerBots");

const labels = Object.freeze({
  location: "Override spawn location", skills: "Override / add starting skill levels",
  inventory: "Replace starting inventory", equipment: "Replace starting equipment",
});

function listRoutineDeployments(registry) {
  const activities = listedRoutines(registry);
  const available = new Set(activities.map(activity => activity.id));
  return activities.map(activity => {
    const family = Object.values(families).find(family => Object.hasOwn(family.profiles, activity.id));
    const deploymentOverrides = routineOverrideFields(activity).map(key => ({ key, label: labels[key], type: "setup" }));
    if (family) {
      const choices = Object.entries(family.profiles).filter(([id]) => available.has(id)).map(([id, label]) => ({ id, label }));
      if (choices.length > 1) deploymentOverrides.unshift({ key: "routine", type: "routineChoice", label: family.profileLabel, choices });
    }
    return {
      id: activity.id, name: activity.name ?? routineName(activity.id), repeat: activity.repeat,
      setup: activity.spawnSetup ?? DEFAULT_SPAWN_SETUP, deploymentOverrides,
    };
  });
}

function groupRoutines(entries) {
  const found = new Map();
  for (const entry of entries) {
    const member = Object.entries(families).find(([, family]) => Object.hasOwn(family.profiles, entry.id));
    const [familyId, family] = member ?? [];
    const key = family ? `family:${familyId}` : entry.id;
    if (!found.has(key)) found.set(key, { key, label: family?.label ?? entry.name ?? entry.id, defaultProfile: family?.defaultProfile, profiles: [] });
    found.get(key).profiles.push({ id: entry.id, label: family?.profiles[entry.id] ?? entry.name ?? entry.id });
  }
  return [...found.values()];
}

const defaultRoutineId = group => group?.profiles.find(profile => profile.id === group.defaultProfile)?.id ?? group?.profiles[0]?.id ?? null;

module.exports = { listRoutineDeployments, groupRoutines, defaultRoutineId };
