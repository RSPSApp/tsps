/**
 * Goading potion (https://oldschool.runescape.wiki/w/Goading_potion; rsprox recordings 821, 3402,
 * 3414, 4056, 4066, 4069, 4073, 4092, 4094, 4099, 4101 for the timer, messages and cancellations).
 *
 * Drinking a dose sets the `goading_potion_timer` varbit to 100. It drops one every six ticks and
 * the potion runs out at 0 (six minutes): "Your Goading potion has almost run out!" is sent when it
 * reaches 3 and "The effects of your Goading potion have worn off." at 0. Drinking another dose
 * while it runs sets the timer back to 100. A teleport, or drinking a cup of tea, ends it at once
 * with the same worn-off message.
 *
 * Every six ticks, starting the tick after the drink (Wiki), monsters within four tiles that the
 * player can see, that are not fighting, and whose Slayer level the player has, turn on the player;
 * in single-way combat the first one does and the rest wait until the fight is over.
 * The timer is not kept across a logout: no capture shows what the live game does with it.
 */
const POTION_NAME = "Goading potion";
const TIMER_VARBIT = "goading_potion_timer";
const TEA_NAME = "Cup of tea";
const START_VALUE = 100;
const STEP_TICKS = 6;
const WARNING_VALUE = 3;
const RADIUS = 4;
const DRINK_MESSAGE = "You drink some of your goading potion.";
const WARNING_MESSAGE = "<col=ff3045>Your Goading potion has almost run out!";
const WORN_OFF_MESSAGE = "<col=ff3045>The effects of your Goading potion have worn off.";
const DOSE_KEYS = ["GOADING_POTION_4_", "GOADING_POTION_3_", "GOADING_POTION_2_", "GOADING_POTION_1_"];
const DRUNK_AT_ATTRIBUTE = "goading-potion:drunk-at";

let api = null;
let core = null;

function drunkAt(player) {
  const cycle = player.getAttribute(DRUNK_AT_ATTRIBUTE);
  return typeof cycle === "number" ? cycle : null;
}

function sendTimer(player, value) {
  const id = core.CacheDefinitions.getVarbitId(TIMER_VARBIT);
  if (id != null && player.getPacketSender().getVarbit(id) !== value) player.getPacketSender().sendVarbit(id, value);
}

function stop(player, message) {
  if (drunkAt(player) === null) return;
  player.setAttribute(DRUNK_AT_ATTRIBUTE, null);
  sendTimer(player, 0);
  if (message) player.sendMessage(WORN_OFF_MESSAGE);
}

/** A dose was drunk: the timer starts again at 100, whether or not one was running. */
function drink(player) {
  player.setAttribute(DRUNK_AT_ATTRIBUTE, core.World.getProcessCycle());
  sendTimer(player, START_VALUE);
}

/** Whether this monster turns on the player: one the player could fight, free to, and in view. */
function goads(player, npc) {
  const definition = npc.getCurrentDefinition();
  if (definition == null || !definition.isAttackable() || definition.getCombatLevel() <= 0 || npc.getHitpoints() <= 0) return false;
  if (npc.getPrivateArea() !== player.getPrivateArea() || (npc.isOwnerOnly?.() && npc.getOwner?.() !== player)) return false;
  if (core.CombatFactory.inCombat(npc)) return false;
  if (player.getSkillManager().getCurrentLevel(core.Skill.SLAYER) < definition.getSlayerLevel()) return false;
  const here = player.getLocation();
  const there = npc.getLocation();
  if (here.getZ() !== there.getZ() || Math.abs(here.getX() - there.getX()) > RADIUS || Math.abs(here.getY() - there.getY()) > RADIUS) return false;
  return core.RegionManager.canProjectileAttackTarget(npc, player);
}

function goad(player) {
  for (const npc of player.getLocalNpcs()) {
    if (npc == null || !goads(player, npc)) continue;
    const method = core.CombatFactory.getMethod(npc);
    if (core.CombatFactory.canAttack(npc, method, player) !== core.CanAttackResponse.CAN_ATTACK) continue;
    npc.getCombat().attack(player);
    // Single-way combat: the one that turned on the player is the only one (Wiki).
    if (!core.CombatFactory.multiCombatBetween(npc, player)) return;
  }
}

function process({ player }) {
  const start = drunkAt(player);
  if (start === null) return;
  const elapsed = core.World.getProcessCycle() - start;
  const value = START_VALUE - Math.floor(elapsed / STEP_TICKS);
  if (value <= 0) {
    stop(player, true);
    return;
  }
  sendTimer(player, value);
  if (elapsed % STEP_TICKS === 0 && value === WARNING_VALUE) player.sendMessage(WARNING_MESSAGE);
  if (elapsed % STEP_TICKS === 1) goad(player);
}

function teleported({ player }) {
  stop(player, true);
}

function ateTea({ player, itemId }) {
  if (core.CacheDefinitions.getItem(itemId)?.name === TEA_NAME) stop(player, true);
}

/** Death sends the player to their respawn point and clears the potion without a line of its own. */
function died({ player }) {
  stop(player, false);
}

/** "You drink some of your goading potion." and what is left of it (rsprox: 1 dose, 2 doses, finished). */
function drinkMessages(itemId) {
  const left = DOSE_KEYS.length - 1 - DOSE_KEYS.findIndex((key) => core.ItemIdentifiers[key] === itemId);
  const remaining = left === 0 ? "You have finished your potion."
    : `You have ${left} ${left === 1 ? "dose" : "doses"} of potion left.`;
  return [DRINK_MESSAGE, remaining];
}

function registerPotion() {
  const chain = DOSE_KEYS.map((key) => core.ItemIdentifiers[key]);
  api.emitCustomEvent("potions:register", { name: POTION_NAME, chains: [chain], effect: drink, drink: { messages: drinkMessages } });
}

module.exports = {
  name: "GoadingPotion",
  description: "Drinking a goading potion starts a six-minute timer during which nearby monsters within four tiles turn on the player, with the worn-off warnings.",
  members: true,
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    api.onServerStartup(registerPotion);
    api.onPlayerProcess(process);
    api.onCustomEvent("teleport:landed", teleported);
    api.onCustomEvent("food:eaten", ateTea);
    api.onCustomEvent("player:died", died); // every death, unlike onPlayerDeath, which a quest respawn can take
  },
};
