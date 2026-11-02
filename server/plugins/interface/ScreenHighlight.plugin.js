/**
 * The cache's screen highlight walkthrough (`screenhighlight`, 664): a box or a component picked
 * out on an interface with a text box under it and a Continue button, step by step. Any content can
 * run one (the league tutorial does on the task list, the area map and the relic screen):
 *
 *   api.emitCustomEvent("screen-highlight:show", { player, key, host, hint, colour, steps })
 *   "screen-highlight:finished" { player, key }   after the last step's Continue
 *   api.emitCustomEvent("screen-highlight:close", { player })
 *
 * `host` is the interface's `tutorial_highlight` layer the walkthrough mounts in (a uid), `hint` the
 * value of hnt_selected_hint, `colour` the text box's title colour. Each step is
 *   { focus: { script, args }, text: { script, text, final, extra } }
 * as the Leagues recordings show it (osrs-captures 227/00196, 237/01098): `focus` is highlight_screen
 * (3409, a box: x, y, width, height, two anchors, opacity, dim) or highlight_screen_component (2463,
 * the interface's content layer and the component to frame, then four values); `text` is
 * highlight_textbox (3413) or highlight_textbox_default (2465, with its extra int). Component
 * arguments may be given as "group:child". As captured: 664 opens in the host with OP1 on Continue
 * (664:31) and Previous (664:32) slot 9, script 3408 shows it, and the varbits hnt_selected_hint
 * (10307), hnt_hint_step (10308) and hnt_hint_max_step (10309) follow the walkthrough. The pause
 * button 664:9 takes PAUSEBUTTON (-1 to -1) too, as captured: on the last step ("Finish") the
 * button's script (3420) resumes it, and this client then sends only that resume, no Continue
 * click (live sent both), so the resume counts as the Continue. It ends the walkthrough, so a
 * Continue click following it finds nothing left to step.
 */
const { FLAG_OP1 } = require("./widgetGroup");

const HIGHLIGHT_GROUP = 664;
const CONTINUE = 31;
const PREVIOUS = 32;
const BUTTON_SLOT = 9;
/** screenhighlight:pausebutton, which the last step's Finish resumes. */
const PAUSE_BUTTON = 9;
/** if_setevents PAUSEBUTTON (bit 0, as RSProx names it). */
const FLAG_PAUSE_BUTTON = 1 << 0;
const OVERLAY = 1;
const SCRIPT_START = 3408;
const SCRIPT_HIDE = 3412;
const VARBIT_SELECTED_HINT = 10307;
const VARBIT_HINT_STEP = 10308;
const VARBIT_HINT_MAX_STEP = 10309;

/** Per player: the walkthrough showing. */
const active = new WeakMap();
let pluginApi = null;

function uid(group, child) {
  return (group << 16) | child;
}

/** "group:child" -> uid; a boolean -> 1 / 0 (a cs2 boolean is an int on the wire); anything else unchanged. */
function argument(value) {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value !== "string") return value;
  const match = /^(\d+):(\d+)$/.exec(value);
  return match ? uid(Number(match[1]), Number(match[2])) : value;
}

function render(player, state) {
  const step = state.steps[state.step];
  const sender = player.getPacketSender();
  sender.sendVarbit(VARBIT_HINT_STEP, state.step);
  sender.sendInterfaceScript(step.focus.script, [state.host, ...step.focus.args.map(argument)]);
  sender.sendInterfaceScript(step.text.script, [step.text.text, state.colour, step.text.final === true ? 1 : 0, 0, state.host, ...(step.text.extra ?? []).map(argument)]);
}

function close({ player }) {
  const state = player ? active.get(player) : null;
  if (!state) return;
  active.delete(player);
  const sender = player.getPacketSender();
  sender.closeSubInterface(state.host);
  sender.sendInterfaceScript(SCRIPT_HIDE, [state.host]);
}

function show(request) {
  const { player } = request ?? {};
  if (!player || !Array.isArray(request.steps) || !request.steps.length) return;
  if (active.has(player)) close({ player });
  const host = argument(request.host);
  const state = { key: request.key, host, colour: request.colour | 0, steps: request.steps, step: 0 };
  active.set(player, state);
  const sender = player.getPacketSender();
  sender.sendSubInterface(host, HIGHLIGHT_GROUP, OVERLAY);
  sender.sendInterfaceFlagsRange(uid(HIGHLIGHT_GROUP, CONTINUE), BUTTON_SLOT, BUTTON_SLOT, FLAG_OP1);
  sender.sendInterfaceFlagsRange(uid(HIGHLIGHT_GROUP, PREVIOUS), BUTTON_SLOT, BUTTON_SLOT, FLAG_OP1);
  sender.sendInterfaceFlagsRange(uid(HIGHLIGHT_GROUP, PAUSE_BUTTON), -1, -1, FLAG_PAUSE_BUTTON);
  sender.sendVarbit(VARBIT_SELECTED_HINT, request.hint | 0);
  sender.sendVarbit(VARBIT_HINT_MAX_STEP, request.steps.length);
  sender.sendInterfaceScript(SCRIPT_START, [host]);
  render(player, state);
}

function next({ player, slot }) {
  const state = active.get(player);
  if (!state || Number(slot) !== BUTTON_SLOT) return false;
  if (state.step + 1 < state.steps.length) {
    state.step++;
    render(player, state);
    return true;
  }
  player.getPacketSender().sendVarbit(VARBIT_HINT_STEP, state.steps.length);
  close({ player });
  pluginApi.emitCustomEvent("screen-highlight:finished", { player, key: state.key });
  return true;
}

/** The pause button's resume (the last step's Finish): the Continue. */
function resumed(event) {
  const state = active.get(event.player);
  if (!state || state.step + 1 < state.steps.length) return false;
  return next({ player: event.player, slot: BUTTON_SLOT });
}

function previous({ player, slot }) {
  const state = active.get(player);
  if (!state || Number(slot) !== BUTTON_SLOT) return false;
  if (state.step > 0) {
    state.step--;
    render(player, state);
  }
  return true;
}

/** Its host interface closed: the walkthrough went with it. */
function hostClosed({ player, interfaceId }) {
  const state = active.get(player);
  if (state && state.host >>> 16 === interfaceId) active.delete(player);
}

function bind(api) {
  pluginApi = api;
}

module.exports = {
  name: "ScreenHighlight",
  register(api) {
    bind(api);
    api.onCustomEvent("screen-highlight:show", show);
    api.onCustomEvent("screen-highlight:close", close);
    api.onCustomEvent("interface:closed", hostClosed);
    api.onInterfaceActionButton(uid(HIGHLIGHT_GROUP, CONTINUE), next);
    api.onInterfaceActionButton(uid(HIGHLIGHT_GROUP, PREVIOUS), previous);
    api.onInterfaceActionButton(uid(HIGHLIGHT_GROUP, PAUSE_BUTTON), resumed);
  },
  _test: { active },
};
