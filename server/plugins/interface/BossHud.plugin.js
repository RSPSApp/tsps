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
 * - "boss-hud:extra" { player, current, maximum, colours?, hidden? } - the second bar under the
 *   first (rev 241, hpbar_hud_show_extra_bar): the Smorks under Bork, Ocellus' first phase. Live
 *   sets varp 5991, varbits 16570/16571 (current, maximum), colours on 303:24-26 and runs 10152
 *   (false); `hidden` takes it away again.
 *
 * The same HUD in standard mode (hpbar_hud_boss 0) is the normal health overlay: with "Show normal
 * health overlay" on (hpbar_hud_standard_disabled, varbit 12390, 0), a player's attack on any NPC
 * a boss doesn't drive shows that NPC (its id, hitpoints and maximum, the usual colours, the open
 * script and a fade in), each hit on it updates the hitpoints, and 8 ticks after the player's last
 * attack it fades out and clears 4 ticks later, as captured. A boss's own HUD always wins: an NPC
 * any boss event has named never gets the standard one, and a boss show replaces it.
 * Ours: the HUD follows the player's own combat target when a multi-target attack rolls several.
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
const OPEN_COMPONENTS = [0, 2, 4, 5, 8, 10, 21, 14, 15, 16, 9, 6, 7, 12, 19, 20, 17, 18, 3].map(uid);
const REDRAW_COMPONENTS = [5, 21, 14, 15, 16, 8, 9, 19, 20, 17, 18].map(uid);
/**
 * The fade scripts take 14 components and the transparency to start from: hp, name_area,
 * outer_border, name_backing, creature_name, inner_border, the bar's back, sliding and remaining
 * parts, its text, its thresholds and hp_bar_1/2.
 */
const FADE_COMPONENTS = [5, 8, 6, 7, 9, 12, 14, 15, 16, 21, 19, 20, 17, 18].map(uid);
/** The bar's back, sliding and remaining parts, and their usual colours (15-bit RGB, captured). */
const COLOUR_COMPONENTS = [14, 15, 16].map(uid);
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

const SHOW_EXTRA_VARP = 5991;
const EXTRA_CURRENT_VARBIT = 16570;
const EXTRA_MAXIMUM_VARBIT = 16571;
const EXTRA_REDRAW_SCRIPT = 10152;
/** health_bar_back_extra, _sliding_extra and _remaining_extra. */
const EXTRA_COLOUR_COMPONENTS = [24, 25, 26].map(uid);

const STANDARD_DISABLED_VARBIT = 12390;
const STANDARD_FADE_AFTER_TICKS = 8;

let core = null;
/** Per player: what their HUD shows, and a counter that cancels a pending hide. */
const shown = new WeakMap();
/** NPC ids a boss drives the HUD for; the standard HUD leaves them alone. */
const bossNpcIds = new Set();
/** Per NPC: the players whose standard HUD shows it, for its hitpoint updates. */
const watchers = new WeakMap();

function stateOf(player) {
  let state = shown.get(player);
  if (!state) {
    state = { npcId: -1, current: -1, maximum: -1, colours: null, generation: 0, mode: null, npc: null, idleTicks: 0, hiding: false, idleTask: null };
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
  if (npcId != null) bossNpcIds.add(npcId);
  const state = stateOf(player);
  unwatch(player, state);
  state.mode = "boss";
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
  if (npcId != null) bossNpcIds.add(npcId);
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
  unwatch(player, state);
  Object.assign(state, { npcId: -1, current: -1, maximum: -1, colours: null, mode: null });
  const sender = player.getPacketSender()
    .sendConfig(NPC_VARP, -1)
    .sendVarbit(CURRENT_VARBIT, 0)
    .sendVarbit(MAXIMUM_VARBIT, 0)
    .sendVarbit(BOSS_VARBIT, 0);
  if (state.extra) {
    state.extra = null;
    sender.sendConfig(SHOW_EXTRA_VARP, 0).sendVarbit(EXTRA_CURRENT_VARBIT, 0).sendVarbit(EXTRA_MAXIMUM_VARBIT, 0);
  }
  if (hideHp) sender.sendInterfaceDisplayState(HP, true);
}

function hideHud({ player, fade = true, afterTicks = HIDE_AFTER_TICKS }) {
  if (!player) return;
  const state = stateOf(player);
  const generation = ++state.generation;
  state.hiding = true;
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
  const state = stateOf(player);
  unwatch(player, state);
  state.mode = null;
  const sender = player.getPacketSender();
  sender.sendInterfaceDisplayState(HP, true);
  sender.sendInterfaceScript(CLEAR_SCRIPT, [CONTAINER]);
}

/** The second bar: shown with its values and colours, or `hidden` (each sends only what changed). */
function extraHud({ player, current, maximum, colours, hidden = false }) {
  if (!player) return;
  const state = stateOf(player);
  const sender = player.getPacketSender();
  if (hidden) {
    if (!state.extra) return;
    state.extra = null;
    sender.sendConfig(SHOW_EXTRA_VARP, 0).sendVarbit(EXTRA_CURRENT_VARBIT, 0).sendVarbit(EXTRA_MAXIMUM_VARBIT, 0);
    return;
  }
  const extra = state.extra ?? (state.extra = { current: -1, maximum: -1, colours: null });
  if (maximum != null && maximum !== extra.maximum) sender.sendVarbit(EXTRA_MAXIMUM_VARBIT, (extra.maximum = maximum));
  if (current != null && current !== extra.current) sender.sendVarbit(EXTRA_CURRENT_VARBIT, (extra.current = Math.max(0, current)));
  sender.sendConfig(SHOW_EXTRA_VARP, 1);
  if (colours && colours.join() !== extra.colours?.join()) {
    EXTRA_COLOUR_COMPONENTS.forEach((component, index) => sender.sendInterfaceColour(component, colours[index]));
    extra.colours = colours;
  }
  sender.sendClientScript(EXTRA_REDRAW_SCRIPT, 0);
}

/** Stops the standard HUD's hitpoint updates for the NPC it showed. */
function unwatch(player, state) {
  if (state.npc) watchers.get(state.npc)?.delete(player);
  state.npc = null;
  state.hiding = false;
}

function standardEnabled(player) {
  return player.getPacketSender().getVarbit(STANDARD_DISABLED_VARBIT) === 0;
}

/** A player's attack roll on an NPC shows it on their standard HUD, or keeps it there. */
function onHitRolled({ attacker, target }) {
  if (!attacker?.isPlayer?.() || !target?.isNpc?.()) return;
  const player = attacker.getAsPlayer?.() ?? attacker;
  const state = stateOf(player);
  if (state.mode === "boss") return;
  if (state.mode === "standard" && state.npc === target && !state.hiding) {
    state.idleTicks = 0;
    if (!state.idleTask?.isRunning()) startIdleTask(player, state, state.generation);
    return;
  }
  if (bossNpcIds.has(target.getId()) || !standardEnabled(player)) return;
  if (state.mode === "standard" && state.npc !== target && player.getCombat?.().getTarget?.() !== target) return;
  showStandard(player, state, target);
}

function showStandard(player, state, npc) {
  unwatch(player, state);
  state.generation++;
  state.mode = "standard";
  state.npc = npc;
  state.idleTicks = 0;
  let set = watchers.get(npc);
  if (!set) watchers.set(npc, (set = new Set()));
  set.add(player);
  const sender = player.getPacketSender();
  sendValues(player, state, { npcId: npc.getId(), current: npc.getHitpoints(), maximum: npc.getMaxHitpoints() }, true);
  sender.sendVarbit(BOSS_VARBIT, 0);
  sendColours(player, COLOURS);
  state.colours = COLOURS;
  sender.sendInterfaceScript(OPEN_SCRIPT, OPEN_COMPONENTS);
  sender.sendInterfaceScript(FADE_IN_SCRIPT, [...FADE_COMPONENTS, SHOW_FADE_FROM]);
  startIdleTask(player, state, state.generation);
}

/**
 * Counts the ticks since the player's last attack and fades the standard HUD out after 8. The task
 * has its own key: other systems cancel every task keyed on the player.
 */
function startIdleTask(player, state, generation) {
  const { Task, TaskManager } = core;
  state.idleTask = new (class extends Task {
    constructor() {
      super(1, {}, false);
    }
    execute() {
      if (state.generation !== generation || player.isRegistered?.() === false) {
        this.stop();
        return;
      }
      if (++state.idleTicks < STANDARD_FADE_AFTER_TICKS) return;
      this.stop();
      hideHud({ player });
    }
  })();
  TaskManager.submit(state.idleTask);
}

/** A hit on an NPC updates the hitpoints of every standard HUD showing it. */
function onDamageApplied({ target }) {
  const set = target && watchers.get(target);
  if (!set) return;
  const npcId = target.getId();
  const current = target.getHitpoints();
  for (const player of set) {
    const state = stateOf(player);
    if (state.mode === "standard" && state.npc === target) sendValues(player, state, { npcId, current }, false);
  }
}

function bind(api) {
  core = api.core;
}

module.exports = {
  name: "BossHud",
  description: "The boss health bar overlay, driven by custom events from boss plugins for health, colours, fade and hide, and the normal health overlay for any other NPC a player attacks.",
  register(api) {
    bind(api);
    api.onCustomEvent("boss-hud:show", showHud);
    api.onCustomEvent("boss-hud:update", updateHud);
    api.onCustomEvent("boss-hud:fade", fadeHud);
    api.onCustomEvent("boss-hud:hide", hideHud);
    api.onCustomEvent("boss-hud:reset", resetHud);
    api.onCustomEvent("boss-hud:extra", extraHud);
    api.onCustomEvent("combat:hit-rolled", onHitRolled);
    api.onCustomEvent("combat:damage-applied", onDamageApplied);
  },
};
