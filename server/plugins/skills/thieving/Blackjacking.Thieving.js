/**
 * OSRS Wiki: Blackjack, Bandit (Pollnivneach), Menaphite Thug and Thieving training.
 *
 * rsprox captures (recordings 1788, 1858, Leagues V): the swing is human_blunt_pound with synth
 * 1842; a tick later "You smack the bandit over the head and render them unconscious." (spam)
 * and "Zzzzzz" as it falls. It wakes with "Arghh my head." and human_ready. A failed swing says "Your blow
 * only glances off the bandit's head." (spam) and the target, "I'll kill you for that!", strikes
 * a tick later. An unconscious target can't be knocked out again.
 */
let core;
let api;
const unconscious = new WeakMap();
const aggression = new WeakMap();
const KNOCKOUT_ANIMATION = "human_blunt_pound";
const UNCONSCIOUS_ANIMATION = "human_unconscious";
const WAKE_ANIMATION = "human_ready";
const KNOCKOUT_SOUND = 1842;
/** Ticks from a failed swing to the target's strike. */
const STRIKE_TICKS = 1;
const UNCONSCIOUS_PICKPOCKET_ANIMATION = 827;
// shortcut: Wiki gives two pickpockets but no exact window, calibrate these timings from an OSRS capture.
const KNOCKOUT_TICKS = 6;
const FEUD_BLACKJACK_STAGE = 9;
const FEUD_QUEST_KEY = "the_feud";
const TARGET_NAMES = ["Bandit", "Menaphite Thug"];

function targetFor(npcId) {
  return require("./Pickpocket.Thieving").targetFor(npcId === core.NpcIdentifiers.MENAPHITE_THUG || npcId === core.NpcIdentifiers.MENAPHITE_THUG_2 ? "Menaphite Thug" : "Bandit", npcId);
}

function supported(npcId) {
  const N = core.NpcIdentifiers;
  return [N.BANDIT_7, N.BANDIT_8, N.BANDIT_9, N.BANDIT_10, N.MENAPHITE_THUG, N.MENAPHITE_THUG_2].includes(npcId);
}

function ready(event) {
  if (!supported(event.npcId)) return false;
  event.handled = true;
  const { player } = event;
  const quest = { player, key: FEUD_QUEST_KEY, stage: 0 };
  api.emitCustomEvent("quest:get-stage", quest);
  if (quest.stage < FEUD_BLACKJACK_STAGE) {
    player.sendMessage("You need to learn how to use a blackjack during The Feud first.");
    return false;
  }
  const id = player.getEquipment().get(core.Equipment.WEAPON_SLOT)?.getId();
  if (!/blackjack/i.test(core.ItemDefinition.forId(id ?? -1)?.getName() ?? "")) {
    event.npc.getCombat().reset();
    player.sendMessage("You need to equip a blackjack to do this.");
    return false;
  }
  const level = targetFor(event.npcId)?.level ?? 65;
  if (player.getSkillManager().getCurrentLevel(core.Skill.THIEVING) < level) {
    player.sendMessage(`You need a Thieving level of at least ${level} to do this.`);
    return false;
  }
  return true;
}

function spam(player, text) {
  player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, text);
}

function later(ticks, run) {
  core.TaskManager.submit(new (class extends core.Task {
    constructor() { super(ticks); }
    execute() { this.stop(); run(); }
  })());
}

function lure(event) {
  if (!ready(event)) return event.handled ? true : false;
  const { player, npc } = event;
  aggression.delete(npc);
  npc.getCombat().reset();
  npc.setFollowing(player);
  player.sendMessage("You lure the bandit away.");
  later(10, () => { if (npc.getFollowing() === player) npc.setFollowing(null); });
}

/**
 * The Wiki's knock-out charts, low/high out of 256, by the pickpocket target they belong to.
 * Bandit (Pollnivneach) charts 80/240, measured over 31 million attempts. Menaphite Thug charts
 * 78/240 on its own page, which is Mod Ash's "31% at level 1 ... 94% at level 99" (79/256 and
 * 241/256); the Blackjack page plots the thug on the bandit's line, where 80/240 would be 31.6%.
 */
const KNOCKOUT_CHART = {
  pollnivnian_bandit: [80, 240],
  pollnivnian_bearded_bandit: [80, 240],
  menaphite_thug: [78, 240],
};
const DEFAULT_KNOCKOUT_CHART = KNOCKOUT_CHART.pollnivnian_bandit;

/** The target's own chart; `ready` has already limited the action to supported NPCs. */
function knockoutChart(npcId) {
  return KNOCKOUT_CHART[targetFor(npcId)?.key] ?? DEFAULT_KNOCKOUT_CHART;
}

/** Wiki (Module:Skilling success chart): low/high interpolated by level, out of 256. */
function successChance(low, high, level) {
  return Math.max(0, Math.min(1, (1 + Math.floor(low * (99 - level) / 98 + high * (level - 1) / 98 + 0.5)) / 256));
}

function knockOut(event) {
  if (!ready(event)) return event.handled ? true : false;
  const { player, npc } = event;
  if (!player.getClickDelay().elapsedTime(1200)) return;
  if (unconscious.has(npc)) {
    player.sendMessage("I can't do that. They're unconscious.");
    return;
  }
  if (core.CombatFactory.inCombat(player) || core.CombatFactory.inCombat(npc)) {
    player.sendMessage("You can't knock-out the bandit during combat.");
    return;
  }
  for (const other of core.World.getNpcs()) {
    if (!other || other === npc || !supported(other.getId()) || other.getPrivateArea() !== npc.getPrivateArea()) continue;
    if (other.getLocation().getZ() !== player.getLocation().getZ() || !other.getLocation().isWithinDistance(player.getLocation(), 15)) continue;
    if (core.RegionManager.canProjectileAttackBounds(player.getLocation(), other.getLocation(), 1, 1, other.getSize(), other.getSize(), null)) {
      player.sendMessage("Perhaps I shouldn't do this here, I think another bandit will see me.");
      return;
    }
  }
  aggression.delete(npc);
  npc.setFollowing(null);
  player.getClickDelay().reset();
  player.performAnimation(new core.Animation(core.CacheDefinitions.getSeqId(KNOCKOUT_ANIMATION)));
  player.getPacketSender().sendSound(KNOCKOUT_SOUND, 1, 0);
  const [low, high] = knockoutChart(event.npcId);
  if (Math.random() >= successChance(low, high, player.getSkillManager().getCurrentLevel(core.Skill.THIEVING))) {
    spam(player, "Your blow only glances off the bandit's head.");
    npc.forceChat("I'll kill you for that!");
    const attempt = {};
    aggression.set(npc, attempt);
    later(STRIKE_TICKS, () => {
      if (aggression.get(npc) !== attempt || !npc.isRegistered() || !player.isRegistered()) return;
      aggression.delete(npc);
      npc.getCombat().attack(player);
    });
    return;
  }
  const state = { remaining: 2 };
  unconscious.set(npc, state);
  npc.getMovementQueue().reset();
  npc.getTimers().registers(core.TimerKey.STUN, KNOCKOUT_TICKS);
  npc.getTimers().registers(core.TimerKey.ATTACK_IMMUNITY, KNOCKOUT_TICKS);
  player.getSkillManager().addExperiences(core.Skill.THIEVING, 10);
  later(1, () => {
    if (unconscious.get(npc) !== state) return;
    spam(player, "You smack the bandit over the head and render them unconscious.");
    npc.forceChat("Zzzzzz");
    npc.performAnimation(new core.Animation(core.CacheDefinitions.getSeqId(UNCONSCIOUS_ANIMATION)));
  });
  later(KNOCKOUT_TICKS, () => {
    if (unconscious.get(npc) !== state) return;
    unconscious.delete(npc);
    if (!npc.isRegistered()) return;
    npc.forceChat("Arghh my head.");
    npc.performAnimation(new core.Animation(core.CacheDefinitions.getSeqId(WAKE_ANIMATION)));
  });
}

function pickpocketTarget(request) {
  if (!supported(request.npcId)) return;
  aggression.delete(request.npc);
  if (request.npc.getCombat().getTarget() === request.player) request.npc.getCombat().reset();
  const state = unconscious.get(request.npc);
  if (!state || state.remaining <= 0 || !request.player.getClickDelay().elapsedTime(1200)) return;
  if (request.player.getInventory().isFull() && request.player.getInventory().getAmount(core.ItemIdentifiers.COINS) === 0) return;
  request.unconscious = true;
  request.target = { ...request.target, pickpocketAnimation: UNCONSCIOUS_PICKPOCKET_ANIMATION };
  request.onAttempt = () => { state.remaining--; };
}

module.exports = function attachBlackjacking(pluginApi) {
  core = pluginApi.core;
  api = pluginApi;
  api.onNpcsInteraction(TARGET_NAMES, { Lure: lure, "Knock-Out": knockOut });
  api.onCustomEvent("thieving:pickpocket-target", pickpocketTarget);
};
module.exports._test = { targetFor, ready, lure, knockOut, successChance, knockoutChart, pickpocketTarget, unconscious, aggression };
