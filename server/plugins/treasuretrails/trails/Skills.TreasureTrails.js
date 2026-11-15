"use strict";

// Sherlock's skill challenges (Wiki "Sherlock", Transcript:Sherlock). Showing him the clue hands over
// the tier's challenge scroll, carried beside the clue like any challenge, with a task from the cache
// (cluehelper_clue_skillchallenge) on it; the task counts only when done with that scroll in the
// inventory, and talking to him then gives the next clue. Master has no challenge scroll: its clue
// is the task (one of the tier's skill-challenge rows), done with the clue itself held. data/skill-challenges.json says which event a task is: a task without an entry is
// content this server lacks, and Sherlock never sets it.
const Runtime = require("./Runtime.TreasureTrails");
const Dialogue = require("./Dialogue.TreasureTrails");
const CHALLENGES = require("./data/skill-challenges.json");
const VARIANT = "treasure-trails-skill-challenge";
const STANDARD = "standard-dialogue";
// A kill is the core onNpcDeath hook, not a custom event.
const NPC_DEATH = "npc-death";
/**
 * `treasure-trails:npc-talked-to` { player, npc, npcId }: this hook took a Talk-to the NPC's own handlers
 * then never see (an achievement diary's "speak to" task listens).
 */
const TALKED_TO_EVENT = "treasure-trails:npc-talked-to";
const HAND_OVER = "Ah, just what I was looking for. I have a challenge for you. If you complete it, I'll give you something.";
const THANKS = "Fantastic! Here, have this.";
const DONE = "You have completed your elite/master level challenge!";
let api;
let core;
// The transcript's completion message, kept from the last talk to him.
let doneMessage = null;

const pick = (entries, random = Math.random) => entries[Math.floor(random() * entries.length)];

function skillOf(stat) {
  return core.Skill.values().find(skill => skill.getClientId() === stat) ?? null;
}

/** Wiki "Sherlock": "temporary skill boosts may be used", so the current level counts. */
function meets(player, task) {
  return task.requirements.every(({ stat, level }) => {
    const skill = skillOf(stat);
    return !skill || player.getSkillManager().getCurrentLevel(skill) >= level;
  });
}

function chooseTask(player, tier, random = Math.random) {
  const supported = Runtime.data(tier).supportedTasks;
  const able = supported.filter(task => meets(player, task));
  return pick(able.length ? able : supported, random);
}

/** What carries the task and whether it's done: elite's Sherlock scroll if carried, or master's clue. */
function scrollOf(player, trail) {
  if (trail.step.family === "skillchallenge") return trail.item;
  return player.getInventory().getItems()[Runtime.auxiliarySlot(player, trail, "skill")] ?? null;
}

function taskOf(trail, meta) {
  return Runtime.data(trail.tier).tasks.get(trail.step.family === "skillchallenge" ? trail.step.row : meta?.task);
}

function talk(event) {
  if (event.handled) return;
  const { player, npcId, npc } = event;
  const definition = event.definition ?? npc.getCurrentDefinition?.(player);
  if (definition?.getActions?.()[event.clickType - 1] !== "Talk-to") return;
  const trail = Runtime.startedTrails(player).find(entry => (entry.step.skill?.itemId != null || entry.step.family === "skillchallenge") &&
    entry.step.npcIds?.includes(npcId));
  if (!trail) return;
  event.handled = true;
  api.emitCustomEvent(TALKED_TO_EVENT, { player, npc, npcId });
  const steps = Dialogue.transcript(player, npc, npcId, VARIANT);
  const said = (steps ?? []).filter(step => typeof step.npc === "string").map(step => ({ npc: step.npc }));
  doneMessage = Dialogue.message(steps) ?? doneMessage;
  const scroll = scrollOf(player, trail);
  if (!scroll) {
    Dialogue.play(player, npcId, [said[0] ?? { npc: HAND_OVER }], () => handOut(player, npcId, trail));
    return;
  }
  if (scroll.getMetaValue(Runtime.metaKey(trail.tier))?.taskDone !== true) {
    // His everyday "bring it to me" line; the task is on the scroll.
    const standard = Dialogue.transcript(player, npc, npcId, STANDARD) ?? [];
    const line = standard.find(step => typeof step.npc === "string" && /scroll/i.test(step.npc));
    Dialogue.play(player, npcId, [{ npc: line?.npc ?? "If you find a scroll that requires my attention, bring it to me and I shall handle it." }]);
    return;
  }
  Dialogue.play(player, npcId, [said[1] ?? { npc: THANKS }], () => Runtime.advance(player, trail));
}

/** Like any challenge scroll, Sherlock's goes in a free slot beside the clue. */
function handOut(player, npcId, snapshot) {
  const current = Runtime.stillHeld(player, snapshot);
  if (!current || scrollOf(player, current)) return;
  const inventory = player.getInventory();
  const slot = inventory.getItems().findIndex(item => !item || item.getAmount() <= 0);
  if (slot < 0) { player.sendMessage("You need a free inventory space to receive a challenge scroll."); return; }
  const task = chooseTask(player, current.tier);
  const scroll = new core.Item(current.step.skill.itemId, 1).setMetaValue(Runtime.metaKey(current.tier), { ...current.state, task: task.row, taskDone: false });
  inventory.setItem(slot, scroll);
  inventory.refreshItems();
  Dialogue.itemBox(player, scroll.getId(), `${core.CacheDefinitions.getNpc(npcId)?.name ?? "Sherlock"} has given you a challenge scroll!`);
}

function ids(namespace, names) {
  return (Array.isArray(names) ? names : [names]).map(name => namespace[name]);
}

/** One payload field against its rule: a literal or a list of them, ids by name ({ item }, { npc }, { prayer }) or { min }. */
function fieldMatches(value, rule) {
  if (rule && typeof rule === "object") {
    if (rule.item) return ids(core.ItemIdentifiers, rule.item).includes(value);
    if (rule.npc) return ids(core.NpcIdentifiers, rule.npc).includes(value);
    if (rule.prayer) return ids(core.PrayerHandler, rule.prayer).includes(value);
    if (rule.min != null) return Number(value) >= rule.min;
    if (Array.isArray(rule)) return rule.includes(value);
    return false;
  }
  return value === rule;
}

/** One worn slot: one of the listed items, or any item whose name has `name` (graceful's many recolours). */
function wears(player, { slot, item, name }) {
  const worn = player.getEquipment().getItems()[core.Equipment[slot]];
  if (!worn || worn.getId() <= 0) return false;
  if (item) return ids(core.ItemIdentifiers, item).includes(worn.getId());
  return core.ItemDefinition.forId(worn.getId())?.getName?.()?.toLowerCase().includes(name.toLowerCase()) ?? false;
}

/** Where it happened (the payload's tile, or the player's) is inside { x: [min, max], y: [min, max], z }. */
function within(area, player, payload) {
  const where = payload.location ?? player.getLocation();
  const x = where.getX?.() ?? where.x, y = where.getY?.() ?? where.y, z = where.getZ?.() ?? where.z;
  return x >= area.x[0] && x <= area.x[1] && y >= area.y[0] && y <= area.y[1] && (area.z == null || z === area.z);
}

function matches(challenge, player, payload) {
  if (challenge.worn && ![].concat(challenge.worn).every(slot => wears(player, slot))) return false;
  if (challenge.area && !within(challenge.area, player, payload)) return false;
  return Object.entries(challenge.match ?? {}).every(([field, rule]) => fieldMatches(payload[field], rule));
}

/** A done task marks the scroll, with the transcript's completion message. */
function performed(event, player, payload) {
  if (!player?.getInventory) return;
  for (const trail of Runtime.trails(player)) {
    const scroll = scrollOf(player, trail);
    const meta = scroll?.getMetaValue(Runtime.metaKey(trail.tier));
    if (!meta || meta.taskDone === true) continue;
    const task = taskOf(trail, meta);
    const challenge = task && CHALLENGES[task.key];
    if (!challenge || challenge.event !== event || !matches(challenge, player, payload)) continue;
    // The scroll keeps its trail's revision, which is what links it to the clue (and master's clue to its talk).
    scroll.setMetaValue(Runtime.metaKey(trail.tier), { ...meta, taskDone: true });
    player.getInventory().refreshItems();
    player.sendMessage(doneMessage ?? DONE);
  }
}

function listen(event) {
  if (event === NPC_DEATH) api.onNpcDeath(payload => performed(event, payload.killer, payload));
  else api.onCustomEvent(event, payload => performed(event, payload?.player, payload));
}

module.exports = function attachSkills(pluginApi) {
  api = pluginApi;
  core = api.core;
  doneMessage = null;
  api.onBeforeNpcInteraction(talk);
  for (const event of new Set(Object.values(CHALLENGES).map(challenge => challenge.event))) listen(event);
};

Object.assign(module.exports, { talk, performed, chooseTask, meets, matches, VARIANT, TALKED_TO_EVENT });
