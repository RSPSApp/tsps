/**
 * What a freeze does after it lands (OSRS Wiki: Freeze; rsprox captures, docs/freezes.md):
 * ice spells say so in red, Ice and Bind-type freezes warn the frozen player shortly
 * before they end, and a freeze one player puts on another only holds while the two stay
 * within 10 tiles of each other (X and Y only, so a ladder keeps it).
 */
const PVP_RANGE = 10;
// Live warns 29-30 ticks after "You have been frozen!" from a 32-tick Ice Barrage. Tasks run
// before player turns, so seeing three ticks left gives 29 when the target takes its turn
// after the caster (its timer already ticked on the cast tick) and 30 when before.
const WARNING_TICKS = 3;
const KINDS = {
  ice: {
    applied: "<col=ef1020>You have been frozen!</col>",
    warning: "<col=ef1020>The freeze cast upon you is beginning to thaw.</col>",
  },
  bind: {
    applied: null,
    warning: "<col=ef1020>The holding effect is beginning to fade.</col>",
  },
};

let core;
let FreezeWatch;

function initialize(api) {
  core = api.core;
  FreezeWatch = class extends core.Task {
    constructor(target, holder, timer, warning) {
      super(1, target, false);
      this.args = [target, holder, timer, warning];
    }

    execute() {
      if (!watch(...this.args)) this.stop();
    }
  };
}

function heldByPlayer(target, source) {
  return target.isPlayer() && source?.isPlayer?.() === true && source !== target;
}

function withinRange(target, source) {
  const a = target.getLocation();
  const b = source.getLocation();
  return Math.max(Math.abs(a.getX() - b.getX()), Math.abs(a.getY() - b.getY())) <= PVP_RANGE;
}

/** One tick of a watched freeze; false once there is nothing left to watch. */
function watch(target, source, timer, warning) {
  if (!target.isRegistered() || target.getTimers().timers().get(core.TimerKey.FREEZE) !== timer || timer.ticks() <= 0) {
    return false;
  }
  if (source && source.isRegistered() && !withinRange(target, source)) {
    target.getTimers().cancel(core.TimerKey.FREEZE);
    return false;
  }
  if (warning && timer.ticks() === WARNING_TICKS) {
    target.getPacketSender().sendMessage(warning);
  }
  return true;
}

function frozen({ target, source, kind }) {
  if (!target?.isPlayer?.()) return;
  const messages = KINDS[kind] ?? null;
  if (messages?.applied) {
    target.getPacketSender().sendTypedMessage(core.ChatType.SPAM, messages.applied);
  }
  const holder = heldByPlayer(target, source) ? source : null;
  const warning = messages?.warning ?? null;
  if (!holder && !warning) return;
  const timer = target.getTimers().timers().get(core.TimerKey.FREEZE);
  core.TaskManager.submit(new FreezeWatch(target, holder, timer, warning));
}

module.exports = {
  name: "Freezes",
  description: "Freeze aftermath: red messages for ice spells, expiry warnings, and releasing a player-applied freeze when the two stray over 10 tiles apart.",
  register(api) {
    initialize(api);
    api.onCustomEvent("combat:frozen", frozen);
  },
};
