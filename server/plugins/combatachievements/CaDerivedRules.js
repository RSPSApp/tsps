/**
 * Fight rules read from the tasks' own descriptions, for the phrasings the cache uses over and
 * over: "Kill Vorkath in less than 54 seconds.", "... without a slayer task.", "Kill Skotizo
 * without taking any damage.", "... without taking any damage from her.", "... with only magical
 * attacks.", "... with the Protect from Melee prayer activated.", "Kill the Corporeal Beast solo.",
 * "... using only special attacks.", "... without equipping any weapon.", "... with a stab weapon.".
 * A description has to be exactly one of these, so a task with any further condition is left to
 * its content's plugin. Monsters counted by their plugins (data/monsters.json countedByEvent,
 * ownRules) get none: their fights are not one NPC's from first hit to death.
 *
 * The fight is timed from the first hit either way to the death (CaFights).
 */
const Data = require("./CaData");
const MONSTERS_DATA = require("./data/monsters.json");

const TARGET = "(?:the )?[A-Z][^,.]*?";
const TIME = "((?:\\d+:\\d{2})(?: minutes?)?|(?:\\d+ minutes?)?(?:,? (?:and )?)?(?:\\d+ seconds?)?)";
const PATTERNS = [
  {
    re: new RegExp(`^Kill ${TARGET} in less than ${TIME}(,? without a slayer task)?\\.$`),
    rule: (match) => {
      const seconds = parseTime(match[1]);
      if (!seconds) return null;
      const noTask = Boolean(match[2]);
      return (fight, api) => fight.within(seconds) && (!noTask || !onSlayerTask(api, fight));
    },
  },
  { re: new RegExp(`^Kill ${TARGET} without taking any damage\\.$`), rule: () => (fight) => fight.hitsTaken.every((hit) => hit.damage <= 0) },
  { re: new RegExp(`^Kill ${TARGET} without taking any damage from (?:her|him|it|its attacks)\\.$`), rule: () => (fight) => fight.damageTaken() === 0 },
  { re: new RegExp(`^Kill ${TARGET} (?:with only magical attacks|using only magical damage)\\.$`), rule: () => (fight) => fight.only("MAGIC") },
  {
    re: new RegExp(`^Kill ${TARGET} with the Protect from (Melee|Magic|Missiles) prayer activ(?:e|ated)\\.$`),
    rule: (match) => (fight) => fight.prayedAtKill(`PROTECT_FROM_${match[1].toUpperCase()}`),
  },
  { re: new RegExp(`^Kill ${TARGET} solo\\.$`), rule: () => (fight) => fight.solo },
  { re: new RegExp(`^Kill ${TARGET} using only special attacks\\.$`), rule: () => (fight) => fight.onlySpecials() },
  { re: new RegExp(`^Kill ${TARGET} without equipping any weapon\\.$`), rule: () => (fight) => fight.onlyWeapons(-1) },
  { re: new RegExp(`^Kill ${TARGET} with a stab weapon\\.$`), rule: () => (fight) => fight.onlyMelee("stab") },
];

/** "1 minute 45 seconds", "1 minute and 30 seconds", "54 seconds", "2 minutes", "1:25", "1:00 minutes". */
function parseTime(text) {
  const clock = /^(\d+):(\d{2})/.exec(text);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const minutes = Number(/(\d+) minutes?/.exec(text)?.[1] ?? 0);
  const seconds = Number(/(\d+) seconds?/.exec(text)?.[1] ?? 0);
  return minutes * 60 + seconds;
}

function onSlayerTask(api, fight) {
  const request = { player: fight.player, npc: fight.npc, onTask: false };
  api.emitCustomEvent("slayer:on-task", request);
  return request.onTask === true;
}

/** The rule a task's description makes, or null. */
function ruleFor(task) {
  const description = task.description.trim();
  for (const { re, rule } of PATTERNS) {
    const match = re.exec(description);
    if (match) return rule(match);
  }
  return null;
}

/** Every derived rule, as [npc name, task, test(fight)]. */
function derive(api) {
  const rules = [];
  const ownRules = new Set(MONSTERS_DATA.ownRules);
  for (const task of Data.tasks().values()) {
    const monster = task.monster;
    if (!monster || monster.byEvent || ownRules.has(monster.name) || task.killCount !== null) continue;
    const test = ruleFor(task);
    if (!test) continue;
    for (const npcName of monster.npcNames) rules.push([npcName, task, (fight) => test(fight, api)]);
  }
  return rules;
}

module.exports = { derive, ruleFor, parseTime };
