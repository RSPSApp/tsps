/** OSRS Wiki: Blackjack, Bandit (Pollnivneach), Menaphite Thug and Thieving training. */
let core;
let api;
const unconscious = new WeakMap();
const aggression = new WeakMap();
// RuneLite gameval AnimationID: HUMAN_BLUNT_POUND, STUNNED_BLACKJACK.
const KNOCKOUT_ANIMATION = 401;
const UNCONSCIOUS_ANIMATION = 1874;
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

// Blackjack's chart and cited Jagex explanation: identical chance for all woods and targets.
function successChance(level) {
  return Math.max(0, Math.min(1, (1 + Math.floor(80 * (99 - level) / 98 + 240 * (level - 1) / 98 + 0.5)) / 256));
}

function knockOut(event) {
  if (!ready(event)) return event.handled ? true : false;
  const { player, npc } = event;
  if (!player.getClickDelay().elapsedTime(1200)) return;
  if (unconscious.has(npc) || core.CombatFactory.inCombat(player) || core.CombatFactory.inCombat(npc)) {
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
  player.performAnimation(new core.Animation(KNOCKOUT_ANIMATION));
  if (Math.random() >= successChance(player.getSkillManager().getCurrentLevel(core.Skill.THIEVING))) {
    player.sendMessage("You fail to knock the bandit out.");
    npc.forceChat("I'll kill you for that!");
    const attempt = {};
    aggression.set(npc, attempt);
    later(3, () => {
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
  npc.performAnimation(new core.Animation(UNCONSCIOUS_ANIMATION));
  player.getSkillManager().addExperiences(core.Skill.THIEVING, 10);
  player.sendMessage("You knock the bandit unconscious.");
  later(KNOCKOUT_TICKS, () => {
    if (unconscious.get(npc) === state) unconscious.delete(npc);
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
module.exports._test = { targetFor, ready, lure, knockOut, successChance, pickpocketTarget, unconscious, aggression };
