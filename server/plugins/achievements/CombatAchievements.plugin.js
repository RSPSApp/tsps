/**
 * Combat Achievements (https://oldschool.runescape.wiki/w/Combat_Achievements): 655 tasks in six
 * tiers, their points and tier rewards, and the five interfaces. Tasks, tiers and rewards come
 * from the cache (Data.CombatAchievements); see docs/combat-achievements.md for the captured packets.
 *
 * Plain kill-count tasks finish from kill counts (Kills.CombatAchievements). Every other task is finished by the
 * content it belongs to, through events (the units in ./tasks/ for content this server has):
 *   api.emitCustomEvent("combat-achievements:complete", { player, task: "Perfect Zulrah" })  name or id
 *   api.emitCustomEvent("combat-achievements:kill", { player, monster: "Barrows", count? })
 *                                       comes back with `total`, the kill count it now holds;
 *                                       announce(total), if given, runs before tasks finish
 *   answer "combat-achievements:kill-count" { player, counts }        counts["Zulrah"] = n, at login
 *   answer "combat-achievements:personal-best" { player, monster, best }   best in ticks
 *   answer "combat-achievements:reset-best" { player, monster, handled }
 *   api.emitCustomEvent("combat-achievements:tier", { player, tier: "Hard" })
 *                                       comes back with `unlocked`: whether the tier is reached,
 *                                       and `claimed`: whether its rewards were claimed from Ghommal
 *   api.emitCustomEvent("combat-achievements:open", { player, collectionLogCategory? })
 *                                       the account summary's row; a collection log boss's button
 * and it emits "combat-achievements:completed" { player, silent, task: { id, name, tier } }.
 *
 *   ::ca complete <task name|id>   finish a task through the real path
 *   ::ca kc <monster> <n>           set a monster's kill count
 *   ::ca reset                      clear every task, claim and kill count
 */
const Data = require("./combatachievements/Data.CombatAchievements");
const Progress = require("./combatachievements/Progress.CombatAchievements");
const Kills = require("./combatachievements/Kills.CombatAchievements");
const Interface = require("./combatachievements/Interface.CombatAchievements");
const Rewards = require("./combatachievements/Rewards.CombatAchievements");
const Fights = require("./combatachievements/Fights.CombatAchievements");

const USAGE = "Usage: ::ca complete <task name|id> | ::ca kc <monster> <n> | ::ca reset";

function restore({ player }) {
  Progress.sendAll(player);
  Interface.restore(player);
  Kills.restore(player);
}

function onComplete(request) {
  if (request?.player && request.task !== undefined) request.completed = Progress.complete(request.player, request.task);
}

/**
 * Whether the player has reached a tier (by name), for content locked behind one (Nex's private fights),
 * and whether they claimed its rewards, for perks that apply only once claimed.
 */
function onTier(request) {
  const tier = Data.tiers().find((each) => each.name.toLowerCase() === String(request?.tier ?? "").toLowerCase());
  if (!request?.player || !tier) return;
  const status = Progress.tierStatus(request.player, tier);
  request.unlocked = status > 0;
  request.claimed = status === 2;
}

function onOpen({ player, collectionLogCategory }) {
  if (!player) return;
  if (collectionLogCategory) Interface.openForCollectionLog(player, collectionLogCategory);
  else Interface.open(player);
}

function caCommand({ player, parts }) {
  const [action, ...rest] = parts.slice(1);
  switch (action?.toLowerCase()) {
    case "complete": {
      const text = rest.join(" ");
      const task = /^\d+$/.test(text) ? Data.task(Number(text)) : Data.taskNamed(text);
      if (!task) player.sendMessage(`No combat task is called "${text}".`);
      else if (!Progress.complete(player, task)) player.sendMessage(`${task.name} is already complete.`);
      return true;
    }
    case "kc": {
      const count = Number(rest.at(-1));
      const monster = Data.monsterNamed(rest.slice(0, -1).join(" "));
      if (!monster || !Number.isInteger(count)) {
        player.sendMessage(USAGE);
        return true;
      }
      Kills.setCount(player, monster, count);
      Kills.checkTasks(player, monster);
      player.sendMessage(`${monster.name} kill count: ${count}.`);
      return true;
    }
    case "reset":
      Kills.reset(player);
      Progress.reset(player);
      player.sendMessage("Your Combat Achievements have been cleared.");
      return true;
    default:
      player.sendMessage(USAGE);
      return true;
  }
}

module.exports = {
  name: "CombatAchievements",
  register(api) {
    Data(api);
    Progress(api);
    Kills(api);
    Fights(api);
    Interface(api);
    Rewards(api);
    // One file per content's tasks (<Unit>.CombatAchievements.js).
    require("./combatachievements/tasks/Barrows.CombatAchievements")(api, Fights);
    require("./combatachievements/tasks/GiantLairs.CombatAchievements")(api, Fights);
    require("./combatachievements/tasks/KalphiteQueen.CombatAchievements")(api, Fights);
    require("./combatachievements/tasks/GiantMole.CombatAchievements")(api, Fights);
    require("./combatachievements/tasks/DagannothKings.CombatAchievements")(api, Fights);
    require("./combatachievements/tasks/Vorkath.CombatAchievements")(api, Fights);
    require("./combatachievements/tasks/Sarachnis.CombatAchievements")(api, Fights);
    api.onPlayerLogin(restore);
    api.onCustomEvent("combat-achievements:complete", onComplete);
    api.onCustomEvent("combat-achievements:open", onOpen);
    api.onCustomEvent("combat-achievements:tier", onTier);
    api.registerCommand("ca", caCommand, api.core.PlayerRights.ADMINISTRATOR, "Combat Achievements: ::ca complete <task> | kc <monster> <n> | reset");
  },
  _test: { restore, onComplete, onTier, caCommand },
};
