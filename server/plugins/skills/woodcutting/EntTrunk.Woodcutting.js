/**
 * Ent trunks (https://oldschool.runescape.wiki/w/Ent), as captured in the Woodcutting Guild:
 * - a dead Ent stays where it fell, and four ticks after it dies it is an Ent trunk;
 * - only its killer may chop it: "You swing your axe at the Ent trunk.", then an attempt every
 *   three ticks; each success gives one noted log (two in the Wilderness), 25 XP, "The ent
 *   carcass yields: 1 x Magic logs" and the usual 1/256 bird nest chance; being attacked
 *   meanwhile doesn't stop it (no auto-retaliate while chopping, as captured);
 * - the trunk lasts 101 ticks, and the Ent respawns 50 ticks later in the guild (15 in the
 *   Wilderness).
 * The log type depends on base Woodcutting level and the axe (Wiki); the weights and the success
 * chart are estimates from the capture, kept in woodcutting-guild.json.
 */
const GuildData = require("./GuildData.Woodcutting");

let api = null;
let core = null;
let ENTS = null;
let helpers = null;

/** Trunks -> { killer, ent, until }. */
const trunks = new Map();
/** Players chopping -> { npc, axe, next, from }. */
const sessions = new Map();
/** Being attacked doesn't stop the chopping (as captured): no auto-retaliate meanwhile. */
const NO_RETALIATE_FLAG = "combat:no-retaliate";

function startSession(player, session) {
  sessions.set(player, session);
  player.setFlag?.(NO_RETALIATE_FLAG, true);
}

function endSession(player) {
  if (!sessions.delete(player)) return;
  player.setFlag?.(NO_RETALIATE_FLAG, false);
}

/** Ticks counted by this module's own task, so trunks and chops keep time with it. */
let cycle = 0;
const now = () => cycle;

function later(ticks, action) {
  core.TaskManager.submit(new (class extends core.Task {
    constructor() {
      super(Math.max(1, ticks), null, false);
    }
    execute() {
      this.stop();
      action();
    }
  })());
}

/** The Ent stays as its remains; two ticks after the death event (four after it fell) it's a trunk. */
function entDied(event) {
  const ent = ENTS.npcs[String(event.npcId)];
  if (!ent || !event.killer?.isPlayer?.()) return;
  const untilTrunk = ENTS.transformTicks - 2;
  event.remains = { ticks: untilTrunk + ENTS.trunkTicks, respawnTicks: ent.respawnTicks };
  const npc = event.npc;
  later(untilTrunk, () => {
    npc.setNpcTransformationId(ENTS.trunk);
    trunks.set(npc, { killer: event.killer, ent, until: now() + ENTS.trunkTicks });
  });
}

/** The log a success gives: those the player's base level allows, weighted (better axes favour magic). */
function rollLog(baseLevel, axe, random = Math.random) {
  const choices = ENTS.logs
    .filter((log) => baseLevel >= log.minLevel && baseLevel <= (log.maxLevel ?? 99))
    .map((log) => ({ log, weight: log.weight + (log.weightPerAxeTier ?? 0) * axe.tier }));
  let roll = random() * choices.reduce((sum, choice) => sum + choice.weight, 0);
  for (const choice of choices) {
    roll -= choice.weight;
    if (roll < 0) return choice.log;
  }
  return choices[choices.length - 1]?.log ?? null;
}

function chopTrunk(event) {
  const { player, npc } = event;
  const trunk = trunks.get(npc);
  if (!trunk || trunk.killer !== player) return true;
  const axe = helpers.findBestUsableAxe(player);
  if (!axe) {
    player.sendMessage(ENTS.messages.noAxe);
    return true;
  }
  if (player.getInventory().getFreeSlots() <= 0) {
    player.sendMessage(ENTS.messages.full);
    return true;
  }
  player.sendMessage(ENTS.messages.swing);
  player.performAnimation(new core.Animation(axe.animationId));
  startSession(player, { npc, axe, next: now() + ENTS.chopTicks, from: player.getLocation().clone() });
  return true;
}

function giveLogs(player, trunk, axe) {
  const log = rollLog(player.getSkillManager().getMaxLevel(core.Skill.WOODCUTTING), axe);
  if (!log) return true;
  const noted = core.ItemDefinition.forId(log.id).getNoteId();
  const itemId = noted > 0 ? noted : log.id;
  const inventory = player.getInventory();
  if (inventory.getFreeSlots() <= 0 && !inventory.contains(itemId)) {
    player.sendMessage(ENTS.messages.full);
    return false;
  }
  inventory.adds(itemId, trunk.ent.logsPerSuccess);
  player.getSkillManager().addExperiences(core.Skill.WOODCUTTING, ENTS.xp * helpers.lumberjackXpMultiplier(player));
  player.sendMessage(ENTS.messages.yield.replace("{amount}", String(trunk.ent.logsPerSuccess)).replace("{log}", log.name));
  helpers.maybeDropBirdNest(player);
  return true;
}

/** One chop attempt per session every three ticks, while the trunk lasts and the player stays. */
function tick() {
  cycle++;
  for (const [npc, trunk] of trunks) if (cycle >= trunk.until || !npc.isRegistered()) trunks.delete(npc);
  for (const [player, session] of sessions) {
    const trunk = trunks.get(session.npc);
    if (!trunk || !player.isRegistered() || !player.getLocation().equals(session.from)) {
      endSession(player);
      continue;
    }
    if (cycle < session.next) continue;
    session.next = cycle + ENTS.chopTicks;
    player.performAnimation(new core.Animation(session.axe.animationId));
    const level = player.getSkillManager().getCurrentLevel(core.Skill.WOODCUTTING);
    if (Math.random() >= helpers.calculateCutChance(level, { cutChance: ENTS.cutChance }, session.axe)) continue;
    if (!giveLogs(player, trunk, session.axe)) endSession(player);
  }
}

function forget({ player }) {
  endSession(player);
}

function attach(pluginApi, woodcutting) {
  api = pluginApi;
  core = pluginApi.core;
  helpers = woodcutting;
  ENTS = GuildData.load(core).ents;
  core.TaskManager.submit(new (class EntTrunkTask extends core.Task {
    constructor() {
      super(1, null, false);
    }
    execute() {
      tick();
    }
  })());
  pluginApi.onNpcDeath(entDied);
  pluginApi.onNpcClick(core.NpcIdentifiers.COL_00FFFF_ENT_TRUNK_COL, 1, chopTrunk);
  pluginApi.onPlayerDisconnect(forget);
}

module.exports = { attach, entDied, chopTrunk, rollLog, tick, trunks, sessions };
