/**
 * Surge potion (https://oldschool.runescape.wiki/w/Surge_potion; rsprox recording 4098, rev 237, for the
 * drink, the timer, the refusals and the resets; docs/surge-potion.md).
 *
 * A dose restores 25% special attack energy and starts a five-minute wait before the next one. The wait
 * is the `surge_potion_timer` varbit: 50 on the drink, one less every ten ticks, and at 0 "You now feel
 * capable of drinking another dose of surge potion." A dose drunk early is refused with the time left
 * (minutes, rounded, down to half a minute; then seconds), and one drunk at full energy with "Drinking
 * this would have no effect."; the wait is checked first. Drinking from a house pool, going through the
 * Ferox Enclave free-for-all portal or dying ends the wait: the timer drops to 1 and runs out the next
 * tick, with the line. Dying in the Chambers of Xeric, the Theatre of Blood or the Tombs of Amascut does
 * not (Wiki).
 */
const POTION_NAME = "Surge potion";
const TIMER_VARBIT = "surge_potion_timer";
const DOSE_KEYS = ["SURGE_POTION_4_", "SURGE_POTION_3_", "SURGE_POTION_2_", "SURGE_POTION_1_"];
// Ticks until the next dose may be drunk; saved, so the wait carries over a logout.
const TICKS_LEFT_ATTRIBUTE = "surge-potion:ticks-left";
// The cycle the wait was last counted down (or set), so the drink's own tick is not counted twice.
const COUNTED_AT_ATTRIBUTE = "surge-potion:counted-at";
const COOLDOWN_TICKS = 500;
const TICKS_PER_STEP = 10;
const SECONDS_PER_STEP = 6;
const SPECIAL_RESTORE = 25;
const FULL_SPECIAL = 100;
// rsprox 4098 t1291: spotanim vfx_surge_potion_01 at height 100, synth 6182 next to the drink's 2401.
const DRINK_GRAPHIC = "vfx_surge_potion_01";
const DRINK_SOUND = 6182;
const READY_MESSAGE = "<col=ff3045>You now feel capable of drinking another dose of surge potion</col>.";
const NO_EFFECT_MESSAGE = "Drinking this would have no effect.";
// Wiki: the deaths in these raids keep the wait.
const RAIDS_KEEPING_THE_WAIT = new Set(["Chambers of Xeric", "Theatre of Blood", "Tombs of Amascut"]);

let api = null;
let core = null;

function ticksLeft(player) {
  const left = player.getAttribute(TICKS_LEFT_ATTRIBUTE);
  return typeof left === "number" && left > 0 ? left : 0;
}

/** The varbit's value for `left` ticks: 50 for a full wait, down a step every ten ticks. */
function timerValue(left) {
  return Math.ceil(left / TICKS_PER_STEP);
}

function sendTimer(player, value) {
  const id = core.CacheDefinitions.getVarbitId(TIMER_VARBIT);
  if (id != null && player.getPacketSender().getVarbit(id) !== value) player.getPacketSender().sendVarbit(id, value);
}

function setTicksLeft(player, left) {
  player.setAttribute(TICKS_LEFT_ATTRIBUTE, left);
  player.setAttribute(COUNTED_AT_ATTRIBUTE, core.World.getProcessCycle());
  sendTimer(player, timerValue(left));
}

/**
 * The wait in the refusal, from the timer (rsprox 4098 t1299-1783): from 5 steps (30 seconds) on, minutes
 * rounded half up (45 and 44 steps are "5 minutes" and "4 minutes", 5 is "1 minute"); below that, six
 * seconds a step ("24 seconds" ... "6 seconds").
 */
function waitText(value) {
  if (value * SECONDS_PER_STEP < 30) return `${value * SECONDS_PER_STEP} seconds`;
  const minutes = Math.round(value / TICKS_PER_STEP);
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

function canDrink(player) {
  return ticksLeft(player) === 0 && player.getSpecialPercentage() < FULL_SPECIAL;
}

function refusal(player) {
  const left = ticksLeft(player);
  if (left > 0) return `You are still full of adrenaline. You'll be able to drink in ${waitText(timerValue(left))}.`;
  return NO_EFFECT_MESSAGE;
}

function drink(player) {
  player.incrementSpecialPercentage(SPECIAL_RESTORE);
  core.CombatSpecial.updateBar(player);
  player.performGraphic(new core.Graphic(core.CacheDefinitions.getSpotanimId(DRINK_GRAPHIC), core.GraphicHeight.HIGH));
  player.getPacketSender().sendSoundEffect(DRINK_SOUND, 1, 0);
  setTicksLeft(player, COOLDOWN_TICKS);
}

function process({ player }) {
  const left = ticksLeft(player);
  if (left === 0) return;
  const cycle = core.World.getProcessCycle();
  if (player.getAttribute(COUNTED_AT_ATTRIBUTE) === cycle) return;
  setTicksLeft(player, left - 1);
  if (left - 1 === 0) player.sendMessage(READY_MESSAGE);
}

/** A reset (rsprox 4098 t3425 after a house pool, t4312 after the free-for-all portal): 1 now, 0 and the line next tick. */
function reset(player) {
  if (player && ticksLeft(player) > 1) setTicksLeft(player, 1);
}

function poolDrunk(event) {
  reset(event?.player);
}

function freeForAllPortal(event) {
  reset(event?.player);
}

function died({ player }) {
  if (RAIDS_KEEPING_THE_WAIT.has(player.getArea?.()?.getName?.())) return;
  reset(player);
}

function login({ player }) {
  sendTimer(player, timerValue(ticksLeft(player)));
}

function registerPotion() {
  const chain = DOSE_KEYS.map((key) => core.ItemIdentifiers[key]);
  api.emitCustomEvent("potions:register", {
    name: POTION_NAME, chains: [chain], effect: drink, canUse: canDrink, canUseMessage: refusal,
  });
}

module.exports = {
  name: "SurgePotion",
  description: "Surge potions restore 25% special attack energy a dose, with a five-minute wait between doses that a house pool, the free-for-all portal or a death ends.",
  members: true,
  _test: { waitText, TICKS_LEFT_ATTRIBUTE },
  register(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
    api.persistAttribute(TICKS_LEFT_ATTRIBUTE, 0);
    api.onServerStartup(registerPotion);
    api.onPlayerProcess(process);
    api.onPlayerLogin(login);
    api.onCustomEvent("rejuvenation-pool:restored", poolDrunk);
    api.onCustomEvent("free-for-all-portal:used", freeForAllPortal);
    api.onCustomEvent("player:died", died); // every death, unlike onPlayerDeath, which a quest respawn can take
  },
};
