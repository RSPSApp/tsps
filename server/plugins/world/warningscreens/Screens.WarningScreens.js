/**
 * Shows a warning screen for whatever leads into its area, and remembers it per player.
 *
 * Content asks with `api.emitCustomEvent("warning-screen:show", { player, warning, proceed, stayOut, texts })`:
 * - a warning toggled off (7) is skipped: `proceed()` runs at once;
 * - otherwise the screen opens (toplevel_mainmodal_open 2524 [-1, -1], then the interface), counting
 *   the showing up to 6. From then on it shows its "Don't ask me this again" checkbox, which toggles
 *   it off (7) and back (6) while it is open;
 * - a question's Yes (17) closes it and runs `proceed()`; No (18), Close (12) or closing it any
 *   other way (walking off) runs `stayOut()`;
 * - the two notices (Icy Path Area, Death Plateau) only inform: they open and `proceed()` runs;
 * - `texts` ({ component: text }) rewrites the screen's lines once it is open, as live does with
 *   if_settext where one screen serves several entrances (the mole hill's 568:14/17/18).
 * The event comes back `handled` when this plugin answered it; content that sees it unhandled
 * (this plugin off) carries on as if warned.
 *
 * The Wilderness's own screen (warning 7, wilderness_warningscreen) is answered with a pause button and counts a
 * showing on Yes; see openPause.
 *
 * As captured: Shantay Pass (docs/shantay-pass.md), the Lumbridge cellar hole and the Observatory
 * stairs count their varbit up to 6; the fairy ring's warning sets its varbit on Confirm. Loc teleports
 * show theirs from an entry's `warningScreen` (the Waterbirth cave, docs/loc-teleports.md).
 */
const Shared = require("./Shared.WarningScreens");

const SCRIPT_MAINMODAL_OPEN = 2524; // toplevel_mainmodal_open
const CLOSE = 12; // cws_close
const YES = 17; // warn1
const NO = 18; // warn2
const QUESTION_TOGGLE = 20;
const QUESTION_TOGGLE_LAYER = 21;
const NOTICE_TOGGLE = 18;
const NOTICE_TOGGLE_LAYER = 19;

// The Wilderness's screen (wilderness_warningscreen 475), answered with a pause button (rsprox local 1002252 ticks
// 2398-2403, 1002220): Yes is sub 1 and No sub 0 on its universe (475:1); its toggle is 475:13.
const PAUSE_ANSWER = 1; // wilderness_warningscreen:universe
const PAUSE_TOGGLE = 13; // wilderness_warningscreen:toggle
const PAUSE_MESSAGE = 10; // wilderness_warningscreen:message
const PAUSE_BUTTON_FLAG = 1;
const PAUSE_YES = 1;
/** cws_warning_id: which warning the open pause-button screen is (0 -> 7 the first time, as recorded). */
const WARNING_ID_VARBIT = 14801;

const STRONGHOLD = 4; // Stronghold of Security Ladders
const SHANTAY_PASS = 10;

/** Each player's open warning: { entry, proceed, stayOut }. */
const pending = new WeakMap();

const toggleOf = (entry) => (entry.notice ? NOTICE_TOGGLE : QUESTION_TOGGLE);
const toggleLayerOf = (entry) => (entry.notice ? NOTICE_TOGGLE_LAYER : QUESTION_TOGGLE_LAYER);

/** Opens the warning's screen, counting the showing, then any text the entrance rewrites. */
function open(player, entry, texts) {
  const shown = Shared.state(player, entry.warning);
  const sender = player.getPacketSender();
  if (entry.varbit !== null && shown >= Shared.SHOWN_ENOUGH) {
    sender.sendInterfaceDisplayState((entry.interfaceId << 16) | toggleLayerOf(entry), false);
  } else if (entry.varbit !== null) {
    Shared.setState(player, entry.warning, shown + 1);
  }
  sender.sendInterfaceScript(SCRIPT_MAINMODAL_OPEN, [-1, -1]);
  sender.sendInterface(entry.interfaceId);
  for (const [child, text] of Object.entries(texts ?? {})) sender.sendString(String(text), (entry.interfaceId << 16) | Number(child));
}

/**
 * A pause-button screen (the Wilderness's 475), as recorded: the warning's id, the modal opened, the screen with its
 * toggle hidden until it has been shown enough, its message, then both answers enabled. Its showing is counted
 * on Yes (cws_warning_7 3 -> 4 on sub 1, nothing on sub 0), not when it opens.
 */
function openPause(player, entry, texts) {
  const id = entry.pauseInterfaceId;
  const sender = player.getPacketSender();
  sender.sendVarbit(WARNING_ID_VARBIT, entry.warning);
  sender.sendInterfaceScript(SCRIPT_MAINMODAL_OPEN, [-1, -1]);
  sender.sendInterface(id);
  sender.sendInterfaceDisplayState((id << 16) | PAUSE_TOGGLE, Shared.state(player, entry.warning) < Shared.SHOWN_ENOUGH);
  sender.sendString(String(texts?.[PAUSE_MESSAGE] ?? entry.message ?? ""), (id << 16) | PAUSE_MESSAGE);
  sender.sendInterfaceFlagsRange((id << 16) | PAUSE_ANSWER, 0, 1, PAUSE_BUTTON_FLAG);
  sender.sendInterfaceFlagsRange((id << 16) | PAUSE_TOGGLE, 0, 0, PAUSE_BUTTON_FLAG);
}

/** "warning-screen:show": the warning, or straight on when it is off. */
function show(event) {
  const { player, warning } = event;
  const entry = Shared.all().get(Number(warning));
  if (!player || !entry || (entry.interfaceId === null && entry.pauseInterfaceId === null)) return;
  event.handled = true;
  const proceed = typeof event.proceed === "function" ? event.proceed : () => {};
  const stayOut = typeof event.stayOut === "function" ? event.stayOut : () => {};
  if (Shared.state(player, entry.warning) >= Shared.OFF) {
    proceed();
    return;
  }
  if (entry.interfaceId === null) {
    openPause(player, entry, event.texts);
    pending.set(player, { entry, proceed, stayOut });
    return;
  }
  open(player, entry, event.texts);
  if (entry.notice) {
    proceed();
    return;
  }
  pending.set(player, { entry, proceed, stayOut });
}

/** "warning-screen:is-on": whether the warning would still show (content that only needs to know). */
function isOn(event) {
  const entry = Shared.all().get(Number(event.warning));
  if (!event.player || !entry) return;
  event.on = Shared.state(event.player, entry.warning) < Shared.OFF;
}

/** The screen's checkbox: off (7) and back on (6), once it has been shown often enough. */
function toggle(player, entry) {
  const shown = Shared.state(player, entry.warning);
  if (entry.varbit === null || shown < Shared.SHOWN_ENOUGH) return;
  const off = shown !== Shared.OFF;
  Shared.setState(player, entry.warning, off ? Shared.OFF : Shared.SHOWN_ENOUGH);
  player.sendMessage(off ? Shared.SCREEN_TOGGLED_OFF_MESSAGE : Shared.SCREEN_TOGGLED_ON_MESSAGE);
}

/** A pause-button screen's answer (sub 1 Yes, 0 No) or its toggle. */
function pauseClick(event, entry, child) {
  const { player } = event;
  // 475 also serves other content (the house obelisk's warning): only a screen this plugin opened is answered here.
  if (pending.get(player)?.entry !== entry) return;
  if (child === PAUSE_TOGGLE) {
    event.handled = true;
    toggle(player, entry);
    return;
  }
  if (child !== PAUSE_ANSWER) return;
  event.handled = true;
  const open = pending.get(player);
  pending.delete(player);
  player.getPacketSender().sendInterfaceRemoval();
  if (open?.entry !== entry) return;
  if (Number(event.action) !== PAUSE_YES) {
    open.stayOut();
    return;
  }
  const shown = Shared.state(player, entry.warning);
  if (entry.varbit !== null && shown < Shared.SHOWN_ENOUGH) Shared.setState(player, entry.warning, shown + 1);
  open.proceed();
}

function click(event) {
  const buttonId = Number(event.buttonId ?? 0);
  const groupId = event.groupId ?? (buttonId >>> 16);
  const entry = Shared.byInterface(groupId);
  if (!entry) return;
  const child = event.childId ?? (buttonId & 0xffff);
  if (entry.interfaceId !== groupId) {
    pauseClick(event, entry, child);
    return;
  }
  const { player } = event;
  if (child === toggleOf(entry)) {
    event.handled = true;
    toggle(player, entry);
    return;
  }
  const answer = !entry.notice && (child === YES || child === NO) ? child : child === CLOSE ? CLOSE : null;
  if (answer === null) return;
  event.handled = true;
  const open = pending.get(player);
  pending.delete(player);
  player.getPacketSender().sendInterfaceRemoval();
  if (open?.entry !== entry) return;
  if (answer === YES) open.proceed();
  else open.stayOut();
}

function closed({ player, interfaceId }) {
  const open = pending.get(player);
  if (!open || (open.entry.interfaceId !== interfaceId && open.entry.pauseInterfaceId !== interfaceId)) return;
  pending.delete(player);
  open.stayOut();
}

/**
 * A count saved where the warning used to keep it, as a state of this one. Only Shantay Pass kept
 * live's 7 for off; the Stronghold counted to 15 and kept its off apart.
 */
function legacyState(player, warning) {
  if (warning === STRONGHOLD && player.getAttribute(Shared.LEGACY_STRONGHOLD_OFF_ATTRIBUTE) === true) return Shared.OFF;
  const key = Shared.LEGACY_ATTRIBUTES[warning];
  const saved = key ? Number(player.getAttribute(key)) : 0;
  if (!Number.isFinite(saved)) return 0;
  return Math.max(0, Math.min(warning === SHANTAY_PASS ? Shared.OFF : Shared.SHOWN_ENOUGH, Math.floor(saved)));
}

/** Login: carries any old count over once, then gives the client every warning's state. */
function login({ player }) {
  for (const entry of Shared.all().values()) {
    let value = Shared.state(player, entry.warning);
    const legacy = legacyState(player, entry.warning);
    if (legacy > value) {
      value = legacy;
      player.setAttribute(Shared.stateAttribute(entry.warning), value);
    }
    if (Shared.LEGACY_ATTRIBUTES[entry.warning]) player.setAttribute(Shared.LEGACY_ATTRIBUTES[entry.warning], 0);
    if (entry.warning === STRONGHOLD) player.setAttribute(Shared.LEGACY_STRONGHOLD_OFF_ATTRIBUTE, false);
    if (value > 0 && entry.varbit !== null) player.getPacketSender().sendVarbit(entry.varbit, value);
  }
}

function persist(api) {
  // Every warning number, cache or not: registration may come before the cache is read.
  for (let warning = 1; warning <= Shared.HIGHEST_WARNING; warning++) api.persistAttribute(Shared.stateAttribute(warning), 0);
  for (const key of Object.values(Shared.LEGACY_ATTRIBUTES)) api.persistAttribute(key, 0);
  api.persistAttribute(Shared.LEGACY_STRONGHOLD_OFF_ATTRIBUTE, false);
}

module.exports = function attach(api) {
  persist(api);
  api.onCustomEvent("warning-screen:show", show);
  api.onCustomEvent("warning-screen:is-on", isOn);
  api.onInterfaceActionClick(click);
  api.onCustomEvent("interface:closed", closed);
  api.onPlayerLogin(login);
};
module.exports.show = show;
module.exports.click = click;
module.exports.login = login;
