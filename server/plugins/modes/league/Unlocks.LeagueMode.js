/**
 * Shattered Relics' unlocks screen (league_3_unlocks 733, data/league-shattered.json `unlocks`):
 * skills, bosses and quest packs bought with Sage's Renown (Wiki /Unlocks). What a character has
 * unlocked is saved and sent as the varbits the screen draws from. A locked skill gives no XP and
 * a locked boss can't be attacked (Wiki: "Locked skills can be trained, but no experience will be
 * granted"). A quest pack, bought in a bank, completes its quests and its prerequisite packs' through
 * the quest runtime, with no XP (Wiki: "Auto-completing quests will not grant the experience"); the
 * Sage (Sage.LeagueMode) hands out the items a pack lets its owner claim.
 *
 *   "league:unlock-skill" { player, skill }   unlocks a skill for free (the starting class)
 *   "league:open-unlocks" { player }          opens the screen
 *   "league:unlocks" { player } -> { skills, bosses, quests }
 *   "league:boss-locked" { player, name, notify? } -> locked   (a boss fight started without Attack: Disturb, Poke)
 */
const Common = require("./Common.LeagueMode");
const QuestRuntime = require("../../quests/QuestRuntime");
const { FLAG_OP1 } = require("../../interface/widgetGroup");
const { data, isShattered } = require("./Shattered.LeagueMode");
const { nearBank } = require("./NearBank.LeagueMode");

/** { skills: [skill id], bosses: [npc id], quests: [pack name] }. */
const UNLOCKS_ATTRIBUTE = "league:unlocks";
const TABS = ["skills", "bosses", "quests"];

/** Per tab, the cache's entries in list order: { key, struct, name, cost?, skill?, npc?, index? }; read once. */
let entryLists = null;

function uid(group, child) {
  return (group << 16) | child;
}

function config() {
  return data.unlocks;
}

function entries(tab) {
  if (!entryLists) {
    const { CacheDefinitions } = Common.core;
    const { costParam, nameParam, skills, bosses, quests } = config();
    const read = (table, extra) => [...CacheDefinitions.getEnumValues(table.enum).entries()].sort(([a], [b]) => a - b).map(([key, struct]) => {
      const params = CacheDefinitions.getStructParams(Number(struct));
      return { key: Number(key), struct: Number(struct), name: String(params?.get(nameParam) ?? ""), cost: Number(params?.get(costParam)) || 0, ...extra(params) };
    });
    entryLists = {
      skills: read(skills, (params) => ({ skill: Number(params?.get(skills.skillParam)) })),
      bosses: read(bosses, (params) => ({ npc: Number(params?.get(bosses.npcParam)) })),
      quests: read(quests, (params) => ({ index: Number(params?.get(quests.indexParam)) })),
    };
  }
  return entryLists[tab];
}

function unlocked(player) {
  const value = player.getAttribute(UNLOCKS_ATTRIBUTE);
  const valid = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    skills: Array.isArray(valid.skills) ? valid.skills.map(Number) : [],
    bosses: Array.isArray(valid.bosses) ? valid.bosses.map(Number) : [],
    quests: Array.isArray(valid.quests) ? valid.quests.map(String) : [],
  };
}

function save(player, state) {
  player.setAttribute(UNLOCKS_ATTRIBUTE, state);
}

// ---- Quest pack prices ----

function pack(name) {
  return config().quests.packs[name] ?? null;
}

/** A pack's prerequisite packs, every level down. */
function prerequisites(name, seen = new Set()) {
  for (const required of pack(name)?.requires ?? []) {
    if (seen.has(required)) continue;
    seen.add(required);
    prerequisites(required, seen);
  }
  return seen;
}

/**
 * A pack's price now (Wiki /Unlocks: its prerequisites count while incomplete): its price less
 * the prices of the unlocked prerequisite packs that no other unlocked one includes. 0 = unlocked.
 */
function questPrice(name, unlockedPacks) {
  const row = pack(name);
  if (!row) return 0;
  if (unlockedPacks.has(name)) return 0;
  const done = [...prerequisites(name)].filter((required) => unlockedPacks.has(required));
  const outer = done.filter((required) => !done.some((other) => other !== required && prerequisites(other).has(required)));
  const paid = outer.reduce((sum, required) => sum + (pack(required)?.cost ?? 0), 0);
  return Math.max(1, row.cost - paid);
}

// ---- Quest packs' quests ----

/** Players whose pack's quests are completing: their rewards give no XP (Wiki /Unlocks). */
const completing = new WeakSet();

/**
 * The quests a pack completes, its prerequisite packs' too, each once and earliest first (the
 * Wiki lists a pack's main quest first). Names this server registers no quest for (Recipe for
 * Disaster's subquests, miniquests) are left out.
 */
function packQuests(name) {
  const names = new Set([name, ...prerequisites(name)].flatMap((each) => pack(each)?.quests ?? []));
  return [...names].reverse().map((quest) => QuestRuntime.questNamed(quest)).filter(Boolean);
}

function banks(player) {
  return player.getBanks().filter((bank, tab) => bank && tab !== Common.core.Bank.BANK_SEARCH_TAB_INDEX);
}

function isExperienceItem(id) {
  return config().quests.experienceItems.includes(id);
}

/** How many of each experience reward item (data `experienceItems`) the character has banked. */
function bankedExperienceItems(player) {
  return new Map(config().quests.experienceItems.map((id) => [id, banks(player).reduce((sum, bank) => sum + bank.getAmount(id), 0)]));
}

/**
 * As much as the inventory takes, the rest into the bank tab the item belongs in, counting what the
 * bank really took (a full bank or a capped stack takes less), and anything left on the floor, as
 * a quest reward past a full inventory goes (`forceAdd`).
 */
function give(player, item) {
  const { Bank } = Common.core;
  const inventory = player.getInventory();
  let rest = item.getAmount();
  const carried = Math.min(rest, inventory.getAddableAmount(item));
  if (carried > 0) {
    inventory.add(item.clone().setAmount(carried), false);
    rest -= carried;
  }
  if (rest > 0) {
    const bank = player.getBank(Bank.getTabForItem(player, item.getId()));
    const before = bank.getAmount(item.getId());
    bank.add(item.clone().setAmount(rest), false);
    rest -= Math.max(0, bank.getAmount(item.getId()) - before);
  }
  if (rest > 0) inventory.forceAdd(player, item.clone().setAmount(rest));
}

/**
 * One quest completed as the quest itself does but without the XP: its own, a prompt it offers
 * later, or an item that gives it (a lamp, a tome; Wiki /Unlocks), and without a scroll. It runs
 * against an empty inventory, so many rewards in a row are never lost to a full one; then the
 * inventory comes back and the rewards go into it, or the bank where they don't fit.
 */
function completeQuest(player, quest, { items = true } = {}) {
  const inventory = player.getInventory();
  const carried = inventory.getCopiedItems();
  const banked = bankedExperienceItems(player);
  inventory.resetItems();
  try {
    quest.complete(player, { experience: false, scroll: false });
  } catch (error) {
    console.warn(`[LeagueMode] ${quest.name} failed to complete for ${player.getUsername?.()}: ${error?.message ?? error}`);
  } finally {
    const rewards = inventory.getValidItems().map((item) => item.clone());
    inventory.setItems(carried);
    // A reward that went straight to the bank (a full inventory's forceAdd) comes back out of it.
    for (const [id, now] of bankedExperienceItems(player)) {
      let extra = now - (banked.get(id) ?? 0);
      for (const bank of banks(player)) {
        if (extra <= 0) break;
        const taken = Math.min(extra, bank.getAmount(id));
        if (taken > 0) bank.delete(id, taken);
        extra -= taken;
      }
    }
    // Without `items`, the rewards are dropped: a league's start quests hand none (237/01098).
    for (const item of items ? rewards : []) {
      if (!isExperienceItem(item.getId())) give(player, item);
    }
    inventory.refreshItems();
  }
}

/** Completes the pack's quests not complete yet (completeQuest); one quest's failure doesn't stop the rest. */
function completeQuests(player, name) {
  completing.add(player);
  try {
    for (const quest of packQuests(name)) {
      if (!quest.isComplete(player)) completeQuest(player, quest);
    }
  } finally {
    completing.delete(player);
  }
}

/**
 * `league:complete-quests` { player, quests: [names], items? }: completes the named quests the way a
 * pack does (no experience, the final rewards kept; with `items: false` no item rewards either), in
 * reverse list order, so a list written as the
 * Wiki nests a quest's requirements under it completes the requirements first (Demonic Pacts'
 * areas). Names this server registers no quest for are left out.
 */
function completeNamedQuests(request) {
  const { player } = request ?? {};
  if (!player || !Array.isArray(request.quests)) return;
  const quests = [...new Set(request.quests)].reverse().map((name) => QuestRuntime.questNamed(name)).filter(Boolean);
  completing.add(player);
  try {
    for (const quest of quests) {
      if (!quest.isComplete(player)) completeQuest(player, quest, { items: request.items !== false });
    }
  } finally {
    completing.delete(player);
  }
}

// ---- What the client is sent ----

function sendUnlocks(player) {
  const state = unlocked(player);
  const sender = player.getPacketSender();
  const { skills, bosses, quests } = config();
  for (const [skill, varbit] of Object.entries(skills.varbits)) sender.sendVarbit(varbit, state.skills.includes(Number(skill)) ? 1 : 0);
  for (const [npc, varbit] of Object.entries(bosses.varbits)) sender.sendVarbit(varbit, state.bosses.includes(Number(npc)) ? 1 : 0);
  const packs = new Set(state.quests);
  for (const entry of entries("quests")) sender.sendVarbit(quests.varbitBase + entry.index, questPrice(entry.name, packs));
}

/**
 * The confirm panel (733:40) shows itself from its onVarTransmit (script 5827) whenever varp 3343 or
 * 3344 changes, and the client runs it once as the screen opens too, so the screen would open with
 * an empty confirm up; it is hidden again a tick later, as the onLoad (5806) left it.
 */
function hideConfirmLater(player) {
  const { group, confirmPanel } = config();
  Common.later(player, 1, () => {
    if (isOpen(player)) player.getPacketSender().sendInterfaceDisplayState(uid(group, confirmPanel), true);
  });
}

function open({ player }) {
  if (!isShattered(player)) return;
  const { group, tabs, tabChildren, entries: list, skills, bosses, quests } = config();
  sendUnlocks(player);
  const sender = player.getPacketSender();
  sender.sendInterface(group);
  sender.sendInterfaceFlagsRange(uid(group, tabs), 0, TABS.length * tabChildren - 1, FLAG_OP1);
  const rows = Math.max(...[skills, bosses, quests].map((table, tab) => entries(TABS[tab]).length * table.entryChildren));
  sender.sendInterfaceFlagsRange(uid(group, list), 0, rows - 1, FLAG_OP1);
  hideConfirmLater(player);
}

function isOpen(player) {
  return player.getInterfaceId() === config().group;
}

/** Per player: the tab and entry shown (the server's copy of varps 3343 / 3344), for the session. */
const view = new WeakMap();

function viewOf(player) {
  return view.get(player) ?? { tab: 0, entry: -1 };
}

/** The tab (3343) and then no entry (3344): the redraw this sends ends with the confirm panel hidden. */
function showTab(player, tab) {
  view.set(player, { tab, entry: -1 });
  const sender = player.getPacketSender();
  sender.sendConfig(config().tabVarp, tab);
  sender.sendConfig(config().selectionVarp, 0);
}

function pickTab({ player, slot }) {
  if (!isShattered(player) || !isOpen(player)) return false;
  const child = Number(slot);
  const tab = child / config().tabChildren;
  if (!Number.isInteger(tab) || tab < 0 || tab >= TABS.length) return true;
  showTab(player, tab);
  return true;
}

function pickEntry({ player, slot }) {
  if (!isShattered(player) || !isOpen(player)) return false;
  const { tab } = viewOf(player);
  const table = config()[TABS[tab]];
  const offset = Number(slot) - table.selectChild;
  const entry = offset / table.entryChildren;
  if (!Number.isInteger(entry) || entry < 0 || entry >= entries(TABS[tab]).length) return true;
  view.set(player, { tab, entry });
  player.getPacketSender().sendConfig(config().selectionVarp, entry + 1);
  return true;
}

/**
 * The entry shown: { cost } to buy it, { cost: null } when there is nothing to buy (already or
 * always unlocked), or { cost: null, refusal } when a requirement is missing (Nex's generals).
 */
function price(player, tab, entry) {
  const state = unlocked(player);
  if (TABS[tab] === "skills") {
    if (config().skills.alwaysUnlocked.includes(entry.skill) || state.skills.includes(entry.skill)) return { cost: null };
    return { cost: entry.cost };
  }
  if (TABS[tab] === "bosses") {
    if (state.bosses.includes(entry.npc)) return { cost: null };
    const requirement = config().bosses.requires[entry.npc];
    if (requirement && requirement.bosses.some((npc) => !state.bosses.includes(npc))) {
      return { cost: null, refusal: data.messages[requirement.message] };
    }
    return { cost: entry.cost };
  }
  const cost = questPrice(entry.name, new Set(state.quests));
  return { cost: cost > 0 ? cost : null };
}

function unlock(player, tab, entry) {
  const state = unlocked(player);
  if (TABS[tab] === "skills") state.skills.push(entry.skill);
  else if (TABS[tab] === "bosses") state.bosses.push(entry.npc);
  else state.quests = [...new Set([...state.quests, entry.name, ...prerequisites(entry.name)])];
  save(player, state);
  if (TABS[tab] === "quests") completeQuests(player, entry.name);
}

/** Accept (733:47): the entry shown, paid in Sage's Renown. */
function accept({ player }) {
  if (!isShattered(player) || !isOpen(player)) return false;
  const { tab, entry: index } = viewOf(player);
  const entry = entries(TABS[tab])[index];
  const priced = entry ? price(player, tab, entry) : { cost: null };
  // Quest packs auto-complete only in a bank (the launch news), checked before any renown is spent.
  const away = priced.cost !== null && TABS[tab] === "quests" && !nearBank(player);
  const { cost, refusal } = away ? { cost: null, refusal: data.messages.questsAway } : priced;
  if (refusal) player.sendMessage(refusal);
  if (cost !== null) {
    const spend = { player, amount: cost };
    Common.api.emitCustomEvent("league:spend-renown", spend);
    if (spend.spent) {
      unlock(player, tab, entry);
      sendUnlocks(player);
    }
  }
  // No entry selected: the list redraws (733:18 runs on 3344) with the unlock, and the confirm
  // panel that the same change shows is hidden again.
  view.set(player, { tab, entry: -1 });
  player.getPacketSender().sendConfig(config().selectionVarp, 0);
  hideConfirmLater(player);
  return true;
}

function close({ player }) {
  if (!isShattered(player) || !isOpen(player)) return false;
  player.getPacketSender().sendInterfaceRemoval();
  return true;
}

function unlockSkill({ player, skill }) {
  if (!isShattered(player)) return;
  const id = Number(skill);
  if (config().skills.varbits[id] === undefined) return;
  const state = unlocked(player);
  if (!state.skills.includes(id)) state.skills.push(id);
  save(player, state);
  sendUnlocks(player);
}

// ---- The locks ----

/** A skill (its stat id) the character can't gain XP in yet; a skill outside the unlock list never is. */
function skillLocked(player, statId) {
  const { skills } = config();
  if (skills.varbits[statId] === undefined || skills.alwaysUnlocked.includes(statId)) return false;
  return !unlocked(player).skills.includes(statId);
}

/**
 * onCanGainExperience: no XP from quests completed for the character, any league's (a bought pack,
 * Demonic Pacts' automatic quests: live's new character has none of Perilous Moons' or Twilight's
 * Promise's, 237/01098), nor in a Shattered Relics locked skill (Wiki /Unlocks).
 */
function lockedSkillExperience(event) {
  const { player, skill } = event;
  if (completing.has(player)) {
    event.allow = false;
    return;
  }
  if (isShattered(player) && skillLocked(player, Number(skill?.getClientId?.()))) event.allow = false;
}

/** NPC name -> the boss unlock (its NPC id) that covers it, read once from the data. */
let bossByName = null;

function bossOf(name) {
  if (!bossByName) {
    bossByName = new Map();
    for (const [npc, names] of Object.entries(config().bosses.names)) {
      for (const each of names) bossByName.set(each.toLowerCase(), Number(npc));
    }
  }
  return bossByName.get(String(name ?? "").toLowerCase()) ?? null;
}

/** Per player: the boss last refused and when, so the refusal is said once a while, not every check. */
const lastRefused = new WeakMap();

/** The locked boss unlock covering this NPC name for the player, or null. */
function lockedBoss(player, name) {
  const boss = bossOf(name);
  return boss === null || unlocked(player).bosses.includes(boss) ? null : boss;
}

function refuse(player, boss, key) {
  const now = Date.now();
  const last = lastRefused.get(player);
  if (last && last.key === key && now - last.at < config().bosses.messageCooldownMs) return;
  lastRefused.set(player, { key, at: now });
  const name = entries("bosses").find((entry) => entry.npc === boss)?.name ?? "";
  player.sendMessage(data.messages.lockedBoss.replace("{name}", name));
}

/** A player, or the player whose thrall it is. */
function controller(mobile) {
  if (mobile?.isPlayer?.()) return mobile;
  const owner = mobile?.isNpc?.() ? mobile.getOwner?.() : null;
  return owner?.isPlayer?.() ? owner : null;
}

/**
 * onCanAttack: a locked boss can't be fought (Wiki /Unlocks), by the player or its thrall. Only a
 * real attack (one with a combat method) says why; a cannon's or a multi-target attack's check
 * asks with none and is refused quietly.
 */
function lockedBossAttack(event) {
  const { attacker, target } = event;
  const player = controller(attacker);
  if (!player || !target?.isNpc?.() || !isShattered(player)) return;
  const boss = lockedBoss(player, target.getCurrentDefinition?.(player)?.getName?.() ?? target.getDefinition?.()?.getName?.());
  if (boss === null) return;
  event.allow = false;
  if (event.method && attacker === player) refuse(player, boss, target);
}

/** `league:boss-locked` { player, name, notify }: a fight started some other way (Disturb, Poke). */
function bossLockedQuery(request) {
  if (!request?.player) return;
  const boss = isShattered(request.player) ? lockedBoss(request.player, request.name) : null;
  request.locked = boss !== null;
  if (request.locked && request.notify) refuse(request.player, boss, request.name);
}

function query(request) {
  if (!request) return;
  Object.assign(request, isShattered(request.player) ? unlocked(request.player) : { skills: [], bosses: [], quests: [] });
}

function login({ player }) {
  if (isShattered(player)) sendUnlocks(player);
}

function buttons() {
  const { group, tabs, entries: list, accept: acceptButton, close: closeButton } = config();
  return { tabs: uid(group, tabs), list: uid(group, list), accept: uid(group, acceptButton), close: uid(group, closeButton) };
}

module.exports = function attach(api) {
  const buttonIds = buttons();
  api.persistAttribute(UNLOCKS_ATTRIBUTE, {});
  api.onCustomEvent("league:unlock-skill", unlockSkill);
  api.onCustomEvent("league:open-unlocks", open);
  api.onCustomEvent("league:unlocks", query);
  api.onCustomEvent("league:login", login);
  api.onCanGainExperience(lockedSkillExperience);
  api.onCanAttack(lockedBossAttack);
  api.onCustomEvent("league:boss-locked", bossLockedQuery);
  api.onCustomEvent("league:complete-quests", completeNamedQuests);
  api.onInterfaceActionButton(buttonIds.tabs, pickTab);
  api.onInterfaceActionButton(buttonIds.list, pickEntry);
  api.onInterfaceActionButton(buttonIds.accept, accept);
  api.onInterfaceActionButton(buttonIds.close, close);
};

module.exports.unlocked = unlocked;
module.exports._test = { questPrice, packQuests, completeQuests, completeNamedQuests, entries, unlocked, skillLocked, bossOf, UNLOCKS_ATTRIBUTE };
