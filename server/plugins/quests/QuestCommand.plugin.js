/**
 * ::quest - an admin command to look at or set a player's quest progress, for testing
 * quest-gated content without playing the quest.
 *
 *   ::quest all [complete]     complete every registered quest without opening every completion scroll;
 *                              item rewards go to the bank (unbankable ones to the inventory), XP lamps and tomes are skipped
 *   ::quest <name>             show the quest's stage
 *   ::quest <name> complete    complete it as the quest itself does (rewards, points, scroll)
 *   ::quest <name> reset       back to not started
 *   ::quest <name> <stage>     set the stage
 *
 * <name> is a quest's name or key, any case; part of a name works when only one quest matches
 * ("grand tree"). Quest points follow a quest set below or above its completion stage.
 */
const QuestRuntime = require("./QuestRuntime");
const { PlayerRights } = require("../../src/main/typescript/elvarg/game/model/rights/PlayerRights");

const USAGE = "Usage: ::quest all [complete] | ::quest <name> [complete|reset|<stage>]";

function normalise(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** The one quest a name means: an exact name or key first, then a unique partial match. */
function findQuests(text) {
  const wanted = normalise(text);
  const quests = QuestRuntime.getRegisteredQuests();
  const exact = quests.filter((quest) => normalise(quest.name) === wanted || normalise(quest.key) === wanted ||
    normalise(quest.name).replace(/^the /, "") === wanted);
  return exact.length > 0 ? exact : quests.filter((quest) => normalise(quest.name).includes(wanted));
}

function addQuestPoints(player, delta) {
  const points = Math.max(0, (Number(player.getAttribute(QuestRuntime.QUEST_POINTS_ATTRIBUTE)) || 0) + delta);
  player.setAttribute(QuestRuntime.QUEST_POINTS_ATTRIBUTE, points);
  player.getPacketSender().sendConfig(QuestRuntime.QUEST_POINTS_VARP, points);
}

/** Sets a stage directly, keeping the quest points in step when it crosses completion. */
function setStage(player, quest, stage) {
  const wasComplete = quest.isComplete(player);
  quest.setStage(player, stage);
  const isComplete = quest.isComplete(player);
  if (wasComplete !== isComplete) addQuestPoints(player, (isComplete ? 1 : -1) * (quest.questPoints || 0));
}

function describe(player, quest) {
  const state = quest.isComplete(player) ? "complete" : quest.isStarted(player) ? "started" : "not started";
  return `${quest.name}: stage ${quest.getStage(player)} (${state}; completes at ${quest.completionValue ?? 2}).`;
}

/**
 * Reward items that only grant experience: ::quest all skips them; the quests' own XP still applies.
 * Lamps are the rubbed (or prayed-over) ones: Antique, Combat, Dreamy, Blessed, Magic lamp (skill)..., not light sources.
 */
function isExperienceItem(api, item) {
  const cached = api.core.CacheDefinitions?.getItem?.(item.getId());
  const name = cached?.name ?? item.getDefinition?.()?.getName?.() ?? "";
  if (/^(tome of experience|book of knowledge)$/i.test(name)) return true;
  const ops = cached?.inventoryActions ?? [];
  return /\blamp\b/i.test(name) && ops.some((op) => /^(rub|pray-over)$/i.test(op ?? ""));
}

/**
 * Rewards ::quest all also hands out in an upgraded form, so they are not given: Kharedst's memoirs
 * and its four pages are all in the Book of the Dead.
 */
const SUPERSEDED_REWARDS = new Set([21760, 21762, 21764, 21766, 21770]);

/**
 * While ::quest all runs, rewards that would flood the inventory go elsewhere: experience items are
 * not given, bankable items go to the bank, anything else (or what the bank refuses) to the
 * inventory as the quest gave it. Returns the restore function and the tallies.
 */
function routeRewards(api, player) {
  const inventory = player.getInventory();
  const { add, forceAdd } = inventory;
  const tally = { banked: 0, skipped: 0 };
  const bankAmount = (id) => player.getBanks().reduce((sum, bank, tab) =>
    bank && tab !== api.core.Bank.BANK_SEARCH_TAB_INDEX ? sum + bank.getAmount(id) : sum, 0);
  /** What still has to go to the inventory: null when skipped or banked whole. */
  const route = (item) => {
    if (!item || item.getId() < 0) return item;
    if (isExperienceItem(api, item)) {
      tally.skipped += item.getAmount();
      return null;
    }
    if (SUPERSEDED_REWARDS.has(item.getId())) return null;
    if (api.emitCanBankItem(player, item, { quiet: true }) === false) return item;
    // Match normal deposits: bank stacks use the unnoted identity, while any
    // inventory remainder must keep the form in which the quest awarded it.
    const bankItem = item.clone().setId(item.getDefinition().unNote());
    const before = bankAmount(bankItem.getId());
    player.getBank(api.core.Bank.getTabForItem(player, bankItem.getId())).add(bankItem, false);
    const moved = Math.max(0, bankAmount(bankItem.getId()) - before);
    tally.banked += moved;
    const left = item.getAmount() - moved;
    return left > 0 ? item.clone().setAmount(left) : null;
  };
  inventory.add = function routedAdd(item, refresh = true) {
    const rest = route(item);
    return rest ? add.call(this, rest, refresh) : this;
  };
  inventory.forceAdd = function routedForceAdd(owner, item) {
    const rest = route(item);
    if (rest) forceAdd.call(this, owner, rest);
  };
  const restore = () => {
    inventory.add = add;
    inventory.forceAdd = forceAdd;
  };
  return { restore, tally };
}

function completeAllQuests(api, player) {
  let completed = 0;
  let alreadyComplete = 0;
  const errors = [];
  const routing = routeRewards(api, player);

  try {
    for (const quest of QuestRuntime.getRegisteredQuests()) {
      try {
        // prompts: false: no reward choice pop-ups (The Fremennik Isles' combat XP).
        if (quest.complete(player, { scroll: false, announce: false, prompts: false })) completed++;
        else alreadyComplete++;
      } catch (error) {
        errors.push(quest.name);
        console.error(`[quest command] completing ${quest.name} (${quest.key}) failed:`, error);
      }
    }
    // `quest:complete-all-miniquests` { player, completed }: miniquests outside the quest registry
    // finish themselves (rewards still routed) and push their names. After the quests, so a
    // miniquest needing its parent quest (The Enchanted Key: Making History) sees it complete.
    const miniquests = { player, completed: [] };
    try {
      api.emitCustomEvent("quest:complete-all-miniquests", miniquests);
    } catch (error) {
      errors.push("miniquests");
      console.error("[quest command] completing the miniquests failed:", error);
    }
    completed += miniquests.completed.length;
  } finally {
    routing.restore();
  }
  player.getInventory().refreshItems();

  const messages = [
    `Quest completion: ${completed} completed, ${alreadyComplete} already complete, ${errors.length} errors.`,
    `Rewards: ${routing.tally.banked} items sent to your bank, ${routing.tally.skipped} experience items not given.`,
  ];
  if (errors.length) {
    const names = errors.slice(0, 5).join(", ");
    messages.push(`Completion errors: ${names}${errors.length > 5 ? `, and ${errors.length - 5} more` : ""}.`);
  }
  return messages;
}

function resetAllQuests(player, quests) {
  let reset = 0;
  let errors = 0;
  for (const quest of quests) {
    if (quest.getStage(player) === 0) continue;
    try {
      setStage(player, quest, 0);
      reset++;
    } catch (error) {
      errors++;
      console.error(`[quest command] resetting ${quest.name} (${quest.key}) failed:`, error);
    }
  }
  return `Quest reset: ${reset} reset, ${errors} errors. Rewards are kept.`;
}

let api;

function questCommand({ player, parts }) {
  const args = parts.slice(1);
  const last = String(args.at(-1) ?? "").toLowerCase();
  const action = last === "complete" || last === "reset" || /^\d+$/.test(last) ? last : null;
  const name = (action ? args.slice(0, -1) : args).join(" ");
  if (!name) {
    player.sendMessage(USAGE);
    return true;
  }
  if (normalise(name) === "all" && (action === null || action === "complete")) {
    for (const message of completeAllQuests(api, player)) player.sendMessage(message);
    return true;
  }
  const matches = findQuests(name);
  if (matches.length !== 1) {
    player.sendMessage(matches.length === 0
      ? `No quest matches "${name}".`
      : `"${name}" matches ${matches.length} quests: ${matches.slice(0, 5).map((quest) => quest.name).join(", ")}${matches.length > 5 ? ", ..." : ""}.`);
    return true;
  }
  const [quest] = matches;
  if (action === "complete") {
    if (!quest.complete(player)) player.sendMessage(`${quest.name} is already complete.`);
  } else if (action === "reset") {
    setStage(player, quest, 0);
  } else if (action !== null) {
    setStage(player, quest, Number(action));
  }
  player.sendMessage(describe(player, quest));
  return true;
}

// Trusted plugin-to-plugin requests. PlayerTools runs after the caller's authorization checks.
function adminQuestRequest(event) {
  const { player, key, action } = event;
  if (!player) return;
  const quests = QuestRuntime.getRegisteredQuests();
  event.handled = true;
  if (action === "complete-all") {
    event.message = completeAllQuests(api, player)[0];
  } else if (action === "reset-all") {
    event.message = resetAllQuests(player, quests);
  } else if (action !== undefined) {
    const quest = quests.find(quest => quest.key === key);
    if (!quest || !["complete", "reset"].includes(action)) {
      event.error = "Choose a registered quest and Complete or Reset.";
      return;
    }
    if (action === "complete") quest.complete(player);
    else setStage(player, quest, 0);
    event.message = describe(player, quest);
  }
  event.quests = quests.map(quest => ({ key: quest.key, name: quest.name,
    stage: quest.getStage(player), complete: quest.isComplete(player) }));
}

module.exports = {
  name: "QuestCommand",
  description: "Adds the admin ::quest command to show, set, complete or reset a player's quest stage, for testing quest-gated content.",
  register(registry) {
    api = registry;
    api.registerCommand("quest", questCommand, PlayerRights.ADMINISTRATOR, "Complete all quests or show, set, complete or reset one quest: ::quest all");
    api.onCustomEvent("quests:admin", adminQuestRequest);
  },
  _test: { questCommand, findQuests, routeRewards, adminQuestRequest },
};
