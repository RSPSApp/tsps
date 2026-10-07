/**
 * The boss health HUD (hpbar_hud, interface 303) for any boss, as captured (the Mad Angel, the
 * Doom of Mokhaiotl, the Gemstone Crab). The client mounts 303 at login and its own scripts draw
 * the bar from varp 1683 (the npc), varbits 6099/6100 (current and maximum) and 12401 (boss
 * mode); the server sets those, the bar's colours, and runs its open and fade scripts.
 *
 * Bosses drive it per player through custom events (each sends only what changed):
 * - "boss-hud:show" { player, npcId, current, maximum, colours? } - the values, the bar's colours,
 *   the open script and a fade in.
 * - "boss-hud:update" { player, npcId?, current?, maximum?, colours?, force? } - any of them; new
 *   colours are redrawn (the Doom's shield turns the bar blue).
 * - "boss-hud:fade" { player, fadeIn } - fades it in or out and leaves it there.
 * - "boss-hud:hide" { player, fade = true, afterTicks = 4 } - fades it out, then (as captured, 4
 *   ticks later) clears the values and hides it. A show before then cancels it. With no delay the
 *   values clear at once and a fade is left to finish (the Doom's kill, as captured).
 * - "boss-hud:reset" { player } - hides it and empties its container (the Doom's delve change).
 */
const GROUP = 303;
const uid = (child) => (GROUP << 16) | child;

const NPC_VARP = 1683;
const CURRENT_VARBIT = 6099;
const MAXIMUM_VARBIT = 6100;
const BOSS_VARBIT = 12401;
const OPEN_SCRIPT = 2376;
const REDRAW_SCRIPT = 2102;
const FADE_IN_SCRIPT = 2887;
const FADE_OUT_SCRIPT = 2889;
const CLEAR_SCRIPT = 2249;
const HP = uid(5);
const CONTAINER = uid(1);
const OPEN_COMPONENTS = [0, 2, 4, 5, 8, 10, 20, 13, 14, 15, 9, 6, 7, 11, 18, 19, 16, 17, 3].map(uid);
const REDRAW_COMPONENTS = [5, 20, 13, 14, 15, 8, 9, 18, 19, 16, 17].map(uid);
/**
 * The fade scripts take 14 components and the transparency to start from: hp, name_area,
 * outer_border, name_backing, creature_name, inner_border, the bar's back, sliding and remaining
 * parts, its text, its thresholds and hp_bar_1/2.
 */
const FADE_COMPONENTS = [5, 8, 6, 7, 9, 11, 13, 14, 15, 20, 18, 19, 16, 17].map(uid);
/** The bar's back, sliding and remaining parts, and their usual colours (15-bit RGB, captured). */
const COLOUR_COMPONENTS = [13, 14, 15].map(uid);
const COLOURS = [25600, 576, 800];
/**
 * 2887 returns at once if told to start from the transparency the HUD already has, and a
 * finished fade-out leaves it at 255: showing it starts from 254. A fade in on its own starts
 * from 255, a fade out from 0.
 */
const SHOW_FADE_FROM = 254;
const FADE_IN_FROM = 255;
const FADE_OUT_FROM = 0;
const HIDE_AFTER_TICKS = 4;

let core = null;
/** Per player: what their HUD shows, and a counter that cancels a pending hide. */
const shown = new WeakMap();

function stateOf(player) {
  let state = shown.get(player);
  if (!state) {
    state = { npcId: -1, current: -1, maximum: -1, colours: null, generation: 0 };
    shown.set(player, state);
  }
  return state;
}

function sendColours(player, colours) {
  const sender = player.getPacketSender();
  COLOUR_COMPONENTS.forEach((component, index) => sender.sendInterfaceColour(component, colours[index]));
}

/** Sends whichever of the npc, current and maximum changed (all of them with `force`). */
function sendValues(player, state, { npcId, current, maximum }, force) {
  const sender = player.getPacketSender();
  if (npcId != null && (force || npcId !== state.npcId)) sender.sendConfig(NPC_VARP, (state.npcId = npcId));
  if (current != null && (force || current !== state.current)) sender.sendVarbit(CURRENT_VARBIT, (state.current = Math.max(0, current)));
  if (maximum != null && (force || maximum !== state.maximum)) sender.sendVarbit(MAXIMUM_VARBIT, (state.maximum = maximum));
}

function showHud({ player, npcId, current, maximum, colours = COLOURS }) {
  if (!player) return;
  const state = stateOf(player);
  state.generation++;
  const sender = player.getPacketSender();
  sendValues(player, state, { npcId, current, maximum }, true);
  sender.sendVarbit(BOSS_VARBIT, 1);
  sendColours(player, colours);
  state.colours = colours;
  sender.sendInterfaceScript(OPEN_SCRIPT, OPEN_COMPONENTS);
  sender.sendInterfaceScript(FADE_IN_SCRIPT, [...FADE_COMPONENTS, SHOW_FADE_FROM]);
}

function updateHud({ player, npcId, current, maximum, colours, force = false }) {
  if (!player) return;
  const state = stateOf(player);
  sendValues(player, state, { npcId, current, maximum }, force);
  if (colours && (force || colours.join() !== state.colours?.join())) {
    sendColours(player, colours);
    state.colours = colours;
    player.getPacketSender().sendInterfaceScript(REDRAW_SCRIPT, [...REDRAW_COMPONENTS, 1]);
  }
}

function fadeHud({ player, fadeIn }) {
  if (!player) return;
  player.getPacketSender().sendInterfaceScript(fadeIn ? FADE_IN_SCRIPT : FADE_OUT_SCRIPT, [...FADE_COMPONENTS, fadeIn ? FADE_IN_FROM : FADE_OUT_FROM]);
}

function clear(player, hideHp = true) {
  const state = stateOf(player);
  Object.assign(state, { npcId: -1, current: -1, maximum: -1, colours: null });
  const sender = player.getPacketSender()
    .sendConfig(NPC_VARP, -1)
    .sendVarbit(CURRENT_VARBIT, 0)
    .sendVarbit(MAXIMUM_VARBIT, 0)
    .sendVarbit(BOSS_VARBIT, 0);
  if (hideHp) sender.sendInterfaceDisplayState(HP, true);
}

function hideHud({ player, fade = true, afterTicks = HIDE_AFTER_TICKS }) {
  if (!player) return;
  const state = stateOf(player);
  const generation = ++state.generation;
  if (fade) fadeHud({ player, fadeIn: false });
  if (afterTicks <= 0) {
    clear(player, !fade);
    return;
  }
  const { Task, TaskManager } = core;
  TaskManager.submit(new (class extends Task {
    constructor() {
      super(afterTicks, player, false);
    }
    execute() {
      this.stop();
      if (state.generation === generation && player.isRegistered?.() !== false) clear(player);
    }
  })());
}

function resetHud({ player }) {
  if (!player) return;
  const sender = player.getPacketSender();
  sender.sendInterfaceDisplayState(HP, true);
  sender.sendInterfaceScript(CLEAR_SCRIPT, [CONTAINER]);
}

function bind(api) {
  core = api.core;
}

module.exports = {
  name: "BossHud",
  register(api) {
    bind(api);
    api.onCustomEvent("boss-hud:show", showHud);
    api.onCustomEvent("boss-hud:update", updateHud);
    api.onCustomEvent("boss-hud:fade", fadeHud);
    api.onCustomEvent("boss-hud:hide", hideHud);
    api.onCustomEvent("boss-hud:reset", resetHud);
  },
};
