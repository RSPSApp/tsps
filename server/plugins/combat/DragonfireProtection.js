const ATTR_DRAGONFIRE_STATE = "combat:dragonfire:protection";

const DragonfireProtectionTier = Object.freeze({
  NONE: 0,
  ANTIFIRE: 1,
  SUPER_ANTIFIRE: 2,
});

// rsprox captures: the expiry warning comes 30 ticks before an antifire potion ends (1149, 1740,
// 3279, 4053) and 20 before a super antifire potion ends (355, 3316, 3318).
const EXPIRY_WARNING_MS = Object.freeze({
  [DragonfireProtectionTier.ANTIFIRE]: 30 * 600,
  [DragonfireProtectionTier.SUPER_ANTIFIRE]: 20 * 600,
});
const EXPIRY_MESSAGE_COLOUR = "7f007f";

// Wiki Dragonfire, damage reduction table (chromatic and metallic dragons): a shield or
// Protect from Magic sets the damage range before the roll, a won Magic accuracy roll caps it
// at 30, and an antifire potion subtracts 15 from the rolled damage.
const SHIELD_MAX_HIT = 5;
const PRAYER_MAX_HIT = 10;
const RESISTED_MAX_HIT = 30;
const ANTIFIRE_REDUCTION = 15;

const RESIST_MESSAGE = "You manage to resist some of the dragon fire!";
const FULL_BURN_MESSAGE = "You're horribly burnt by the dragon fire!";
const SHIELD_MESSAGE = "Your shield absorbs most of the dragon fire!";
const PRAYER_MESSAGE = "Your prayers resist some of the dragon fire!";
const ANTIFIRE_MESSAGE = "Your antifire potion helps to protect you from the dragon's breath!";
const SUPER_ANTIFIRE_MESSAGE = "Your super antifire potion completely protects you from the dragon fire!";

/**
 * Sent for every dragonfire breath that reaches a player, whatever protects them, so a worn
 * shield can absorb it (the Dragonfire shield gains a charge). Listeners may append
 * `{ text, spam }` lines to `messages`; they are sent after the protection lines.
 */
const DRAGONFIRE_BREATH_EVENT = "combat:dragonfire-breath";

let core;
let pluginApi;

/** Called from each plugin that uses this module, before any dragonfire logic runs. */
function initDragonfireProtectionCoreAccess(api) {
  core = api.core;
  pluginApi = api;
}

/**
 * Current protection state, or null. Every reader expires a finished state here, and the expiry
 * notice goes with it, so a dragon attack on the expiry tick (NPCs process before players)
 * still tells the player exactly once.
 */
function normalizeState(player) {
  if (!player) {
    return null;
  }

  const timer = player.getCombat?.().getFireImmunityTimer?.();
  let state = player.getAttribute?.(ATTR_DRAGONFIRE_STATE) ?? null;
  if (!state || typeof state !== "object") {
    state = null;
  }

  const nowMs = Date.now();
  if (state && Number.isFinite(state.endsAt) && nowMs >= state.endsAt) {
    clearDragonfireProtection(player);
    player.getPacketSender?.().sendMessage?.(`<col=${EXPIRY_MESSAGE_COLOUR}>Your ${state.label} has expired.</col>`);
    return null;
  }

  if (state) {
    return state;
  }

  if (timer && !timer.finished?.()) {
    const secondsRemaining = Number(timer.secondsRemaining?.() ?? 0);
    if (secondsRemaining > 0) {
      const fallbackState = {
        tier: DragonfireProtectionTier.ANTIFIRE,
        label: "antifire potion",
        endsAt: nowMs + secondsRemaining * 1000,
        warned: false,
      };
      player.setAttribute?.(ATTR_DRAGONFIRE_STATE, fallbackState);
      return fallbackState;
    }
  }

  return null;
}

function setDragonfireProtection(player, { tier, seconds, label }) {
  if (!player || !Number.isFinite(seconds) || seconds <= 0) {
    return false;
  }

  const normalizedTier = Number.isFinite(tier)
    ? Math.max(DragonfireProtectionTier.NONE, Math.trunc(tier))
    : DragonfireProtectionTier.NONE;

  const state = {
    tier: normalizedTier,
    label: String(label || "").trim() || "antifire potion",
    endsAt: Date.now() + Math.trunc(seconds * 1000),
    warned: false,
  };

  player.setAttribute?.(ATTR_DRAGONFIRE_STATE, state);
  player.getCombat?.().getFireImmunityTimer?.().start(seconds);
  return true;
}

function clearDragonfireProtection(player) {
  if (!player) {
    return;
  }
  player.setAttribute?.(ATTR_DRAGONFIRE_STATE, null);
  player.getCombat?.().getFireImmunityTimer?.().stop?.();
}

function processDragonfireProtection(player) {
  const state = normalizeState(player);
  if (!state) {
    return;
  }

  const remainingMs = state.endsAt - Date.now();

  const warningMs = EXPIRY_WARNING_MS[state.tier] ?? EXPIRY_WARNING_MS[DragonfireProtectionTier.ANTIFIRE];
  if (state.warned !== true && remainingMs <= warningMs) {
    state.warned = true;
    player.setAttribute?.(ATTR_DRAGONFIRE_STATE, state);
    player.getPacketSender?.().sendMessage?.(`<col=${EXPIRY_MESSAGE_COLOUR}>Your ${state.label} is about to expire.</col>`);
  }
}

/**
 * The player's protection tier: their potion's, or full protection when content makes them immune
 * to dragonfire outright (a league relic answers `combat:status-apply` for it as for poison).
 */
/** Through the plugin api this module was given; a caller that only handed it `core` goes through core. */
function emit(name, payload) {
  const emitter = pluginApi?.emitCustomEvent ? pluginApi : core?.PluginManager;
  emitter?.emitCustomEvent?.(name, payload);
}

/** Lets a worn shield absorb the breath; returns `messages` with any lines it added. */
function emitDragonfireBreath(attacker, player, messages) {
  emit(DRAGONFIRE_BREATH_EVENT, { attacker, player, messages });
  return messages;
}

function getDragonfireProtectionTier(player) {
  const status = { target: player, kind: "dragonfire", allow: true };
  emit("combat:status-apply", status);
  if (status.allow === false) {
    return DragonfireProtectionTier.SUPER_ANTIFIRE;
  }
  return normalizeState(player)?.tier ?? DragonfireProtectionTier.NONE;
}

/**
 * Regular (chromatic, brutal and metallic) dragonfire against a player. `prayerProtects` is false
 * for metallic dragons, whose fire ignores Protect from Magic. Returns the damage and the
 * messages to send, one per protection layer as live sends them.
 */
function resolveChromaticDragonfireDamage(attacker, player, options = {}) {
  const { CombatEquipment, CombatType, AccuracyFormulasDpsCalc, Misc, PrayerHandler } = core;
  const maxHit = Number.isFinite(options.maxHit) ? Math.max(0, Math.trunc(options.maxHit)) : 50;
  const tier = getDragonfireProtectionTier(player);

  if (tier >= DragonfireProtectionTier.SUPER_ANTIFIRE) {
    // The potion's message is the potion's; an immunity granted by content says nothing.
    const potion = (normalizeState(player)?.tier ?? DragonfireProtectionTier.NONE) >= DragonfireProtectionTier.SUPER_ANTIFIRE;
    const messages = potion ? [spam(SUPER_ANTIFIRE_MESSAGE)] : [];
    return { damage: 0, accurate: true, messages: emitDragonfireBreath(attacker, player, messages) };
  }

  let accurate = true;
  let max;
  const messages = [];
  if (CombatEquipment.hasDragonProtectionGear(player)) {
    max = SHIELD_MAX_HIT;
    messages.push(spam(SHIELD_MESSAGE));
  } else if (options.prayerProtects !== false && PrayerHandler.isActivated(player, PrayerHandler.PROTECT_FROM_MAGIC)) {
    max = PRAYER_MAX_HIT;
    messages.push(spam(PRAYER_MESSAGE));
  } else {
    accurate = AccuracyFormulasDpsCalc.rollAccuracy(attacker, player, CombatType.MAGIC);
    max = accurate ? Math.min(RESISTED_MAX_HIT, maxHit) : maxHit;
    messages.push(game(accurate ? RESIST_MESSAGE : FULL_BURN_MESSAGE));
  }

  let damage = Misc.randomInclusive(0, max);
  if (tier >= DragonfireProtectionTier.ANTIFIRE) {
    damage = Math.max(0, damage - ANTIFIRE_REDUCTION);
    messages.push(spam(ANTIFIRE_MESSAGE));
  }
  return { damage, accurate, messages: emitDragonfireBreath(attacker, player, messages) };
}

function game(text) {
  return { text, spam: false };
}

function spam(text) {
  return { text, spam: true };
}

/** Sends the messages from `resolveChromaticDragonfireDamage`: layer messages go to the spam filter. */
function sendDragonfireMessages(player, messages) {
  for (const { text, spam: filtered } of messages) {
    if (filtered) {
      player.getPacketSender().sendTypedMessage(core.ChatType.SPAM, text);
    } else {
      player.sendMessage(text);
    }
  }
}

module.exports = {
  initDragonfireProtectionCoreAccess,
  ATTR_DRAGONFIRE_STATE,
  DragonfireProtectionTier,
  DRAGONFIRE_BREATH_EVENT,
  emitDragonfireBreath,
  setDragonfireProtection,
  clearDragonfireProtection,
  processDragonfireProtection,
  getDragonfireProtectionTier,
  resolveChromaticDragonfireDamage,
  sendDragonfireMessages,
};
