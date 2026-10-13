/**
 * Combat Achievements (https://oldschool.runescape.wiki/w/Combat_Achievements): 655 tasks in six
 * tiers, their points and tier rewards, and the five interfaces. Tasks, tiers and rewards come
 * from the cache (CaData); see docs/combat-achievements.md for the captured packets.
 *
 * Plain kill-count tasks finish from kill counts (CaKills). Every other task is finished by the
 * content it belongs to, through events (the units in ./tasks/ for content this server has):
 *   api.emitCustomEvent("combat-achievements:complete", { player, task: "Perfect Zulrah" })  name or id
 *   api.emitCustomEvent("combat-achievements:kill", { player, monster: "Barrows", count? })
 *                                       comes back with `total`, the kill count it now holds;
 *                                       announce(total), if given, runs before tasks finish
 *   answer "combat-achievements:kill-count" { player, counts }        counts["Zulrah"] = n, at login
 *   answer "combat-achievements:personal-best" { player, monster, best }   best in ticks
 *   answer "combat-achievements:reset-best" { player, monster, handled }
 *   api.emitCustomEvent("combat-achievements:open", { player, collectionLogCategory? })
 *                                       the account summary's row; a collection log boss's button
 * and it emits "combat-achievements:completed" { player, task: { id, name, tier } }.
 *
 *   ::ca complete <task name|id>   finish a task through the real path
 *   ::ca kc <monster> <n>           set a monster's kill count
 *   ::ca reset                      clear every task, claim and kill count
 */
const Data = require("./CaData");
const Progress = require("./CaProgress");
const Kills = require("./CaKills");
const Interface = require("./CaInterface");
const Rewards = require("./CaRewards");
const Fights = require("./CaFights");

/** One file per content's tasks in ./tasks/ (<Unit>.CombatAchievements.js). */
const UNITS = ["Barrows", "GiantLairs", "KalphiteQueen", "GiantMole", "DagannothKings", "Vorkath"];

const USAGE = "Usage: ::ca complete <task name|id> | ::ca kc <monster> <n> | ::ca reset";

function restore({ player }) {
  Progress.sendAll(player);
  Interface.restore(player);
  Kills.restore(player);
}

function onComplete(request) {
  if (request?.player && request.task !== undefined) request.completed = Progress.complete(request.player, request.task);
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
    for (const module of [Data, Progress, Kills, Interface, Rewards, Fights]) module.bind(api);
    for (const key of [Progress.COMPLETED_ATTRIBUTE, Progress.CLAIMED_ATTRIBUTE, Kills.KILLS_ATTRIBUTE, Interface.VIEW_ATTRIBUTE]) {
      api.persistAttribute(key);
    }
    api.onPlayerLogin(restore);
    api.onNpcDeath(Kills.onNpcDeath);
    api.onNpcDeath(Fights.onNpcDeath);
    api.onPlayerDealtDamage(Fights.onDealt);
    api.onCombatHitResolved(Fights.onHitResolved);
    api.onCustomEvent("combat-achievements:kill", Kills.onKill);
    api.onCustomEvent("combat-achievements:complete", onComplete);
    api.onCustomEvent("combat-achievements:open", onOpen);
    api.onInterfaceActionClick(Interface.onClick);
    api.onNpcDialogueVariant(Rewards.dialogueVariant);
    api.onNpcDialogueCondition(Rewards.dialogueCondition);
    api.onCustomEvent("npc-dialogue:line", Rewards.dialogueLine);
    api.onItemAction("Antique lamp", { Rub: Rewards.rubLamp });
    api.registerCommand("ca", caCommand, api.core.PlayerRights.ADMINISTRATOR, "Combat Achievements: ::ca complete <task> | kc <monster> <n> | reset");
    for (const unit of UNITS) require(`./tasks/${unit}.CombatAchievements`)(api, Fights);
  },
  _test: { restore, onComplete, caCommand },
};
