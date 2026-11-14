// Pushes the effect countdowns to the client: to the buff bar's own vars, which the cache scripts
// draw, and, for antifire, teleblock and stamina, to the client's infobox timers
// (client/game/plugins/statustimer). Each value is read from the real state every tick, so a relog or
// any other source of the effect shows the right time left. The infobox timers use custom varps,
// mirrored in client/game/plugins/statustimer/StatusTimerOverlay.tsx; 7995-7999 are already taken.
const { ATTR_DRAGONFIRE_STATE, ATTR_DRAGONFIRE_TIER, DragonfireProtectionTier } = require("../combat/DragonfireProtection");

const ANTIFIRE_TIMER_SECONDS_VARP = 7990;
/** 1: antifire or extended antifire, 2: super or extended super antifire. */
const ANTIFIRE_TIMER_TYPE_VARP = 7991;
const TELEBLOCK_TIMER_SECONDS_VARP = 7992;
const STAMINA_TIMER_SECONDS_VARP = 7993;

/** antifire_potion: an antifire or extended antifire's time left, in steps of 30 ticks. */
const ANTIFIRE_VARBIT = 3981;
const ANTIFIRE_STEP_TICKS = 30;
/** super_antifire_potion: a super or extended super antifire's time left, in steps of 20 ticks. */
const SUPER_ANTIFIRE_VARBIT = 6101;
const SUPER_ANTIFIRE_STEP_TICKS = 20;
/** teleblock_cycles: the Tele Block's time left, in ticks. */
const TELEBLOCK_VARBIT = 4163;
/** stamina_duration: a stamina potion's time left, in steps of 10 ticks; stamina_active is 1 while it lasts. */
const STAMINA_DURATION_VARBIT = 24;
const STAMINA_STEP_TICKS = 10;
const STAMINA_ACTIVE_VARBIT = 25;

const ANTIFIRE_TYPE = 1;
const SUPER_ANTIFIRE_TYPE = 2;
const TICK_MS = 600;

/** Set by Potions.plugin.js: a Date.now() deadline, shifted by the time spent offline. */
const ATTR_STAMINA_END = "potions:stamina:end";

/*
 * The other timers the buff bar reads straight from a var (cache script 5923, with each buff's struct:
 * param 1541 is the ticks per step). They are sent only when they change, from 0, since the client
 * starts every var at 0 on login.
 */
/** magearena_charge (a varp): the Charge spell's time left, in steps of 2 ticks. */
const CHARGE_VARP = 272;
const CHARGE_STEP_TICKS = 2;
const ATTR_CHARGE_UNTIL = "charge:until";
/** godwars_altar_delay: the God Wars altars' cooldown, in steps of 100 ticks. */
const GODWARS_ALTAR_VARBIT = 4099;
const GODWARS_ALTAR_STEP_TICKS = 100;
const ATTR_GODWARS_ALTAR = "godwars:altar-prayed-at";
const GODWARS_ALTAR_COOLDOWN_MS = require("../bosses/godwars/data/godwars.json").altarCooldownMs;
/** magic_imbue_active: Magic Imbue's time left, in steps of 10 ticks. */
const MAGIC_IMBUE_VARBIT = 5438;
const MAGIC_IMBUE_STEP_TICKS = 10;
const ATTR_MAGIC_IMBUE_UNTIL = "lunar:magic-imbue-until";
/**
 * divine*_potion_time: a divine potion's ticks left. Each skill has its own varbit, and a combined potion's
 * runs while all of its skills are locked: a divine super combat sets attack, strength, defence and combat.
 */
const DIVINE_SKILL_VARBITS = [[0, 8429], [2, 8430], [1, 8431], [4, 8432], [6, 8433]]; // attack, strength, defence, ranged, magic
const DIVINE_COMBINED_VARBITS = [[13663, [0, 2, 1]], [13664, [4, 1]], [13665, [6, 1]]]; // combat, bastion, battlemage
/** divineattack_potion_base: the Attack level a divine potion locked, while that lock lasts. */
const DIVINE_ATTACK_BASE_VARBIT = 8434;
const ATTR_DIVINE_STATE = "potions:divine:state";
/** statrenewal_potion_timer: the Menaphite remedy's time left, in steps of 25 ticks. */
const STAT_RENEWAL_VARBIT = 14448;
const STAT_RENEWAL_STEP_TICKS = 25;
const ATTR_MENAPHITE_STATE = "potions:menaphite:state";
/**
 * The Chambers of Xeric prayer enhance: raids_prayer_enhance_tier (1 to 3, for (-), plain and (+)) picks the
 * buff, and raids_prayerenhance_timer counts steps of raids_prayerenhance_rate ticks (6, a prayer point each).
 */
const PRAYER_ENHANCE_TIER_VARBIT = 12397;
const PRAYER_ENHANCE_TIMER_VARBIT = 5417;
const PRAYER_ENHANCE_RATE_VARBIT = 5419;
const PRAYER_ENHANCE_STEP_TICKS = 6;
const ATTR_PRAYER_ENHANCE = "potions:prayer-enhance";
/** The raid's overloads: raids_overload_tier (1 to 3) and raids_overload_timer, in steps of 25 ticks. */
const RAID_OVERLOAD_TIER_VARBIT = 5420;
const RAID_OVERLOAD_TIMER_VARBIT = 5418;
const RAID_OVERLOAD_STEP_TICKS = 25;
const ATTR_OVERLOAD_STATE = "potions:overload:state";
/**
 * The Arceuus spellbook. arceuus_corruption is 1 or 2 while a lesser or greater corruption waits for its hit.
 * Each cooldown varbit is 1 while its cooldown lasts, and arceuus_resurrection_active while a thrall is up.
 */
const CORRUPTION_VARBIT = 12136;
const CORRUPTION_BY_TOTAL = { 6: 1, 12: 2 };
const ATTR_CORRUPTION = "arceuus:corruption";
const ARCEUUS_COOLDOWNS = [
  [12288, "arceuus:corruption-cooldown"],
  [12291, "arceuus:shadow-veil-cooldown"],
  [12293, "arceuus:ward-cooldown"],
  [12290, "arceuus:thrall-until"], // resurrection
];
const RESURRECTION_ACTIVE_VARBIT = 12413;
const ATTR_THRALL = "arceuus:thrall";
/** buff_bar_ammo_type and buff_bar_ammo_amount: the ammo slot's item (-1 when empty) and count; buff_bar_weapon stays -1. */
const AMMO_TYPE_VARP = 3158;
const AMMO_AMOUNT_VARP = 3159;
const AMMO_WEAPON_VARP = 3160;
const AMMUNITION_SLOT = 13;
/**
 * The ammo buff (struct 3659) takes its item and count from those varps only when buff_bar_start (script 5931)
 * starts it with the count, so live starts it again whenever the worn ammo changes. Ours: 0 when the slot empties.
 */
const BUFF_BAR_START_SCRIPT = 5931;
const AMMO_BUFF_STRUCT = 3659;
/**
 * The Group Woodcutting Bonus: group_gathering_active_buff is 96 while the player chops a tree that gives one
 * (-1 when not), group_gathering_buff_num_players the players at it and group_gathering_buff_value one less.
 */
const GROUP_GATHERING_VARP = 4007;
const GROUP_GATHERING_WOODCUTTING = 96;
const GROUP_GATHERING_PLAYERS_VARBIT = 15347;
const GROUP_GATHERING_VALUE_VARBIT = 15348;

const states = new WeakMap();
const effectStates = new WeakMap();
/** The worn ammo the ammo buff was last started for: "id:count". */
const ammoBuffStarts = new WeakMap();
let pluginApi = null;

function millisUntil(endsAt, now) {
  return Number.isFinite(endsAt) && endsAt > now ? endsAt - now : 0;
}

const seconds = (ms) => Math.ceil(ms / 1000);
const ticks = (ms) => Math.ceil(ms / TICK_MS);
/** Time left in the buff bar's steps: a step stays shown until the last of its ticks has passed. */
const steps = (ms, stepTicks) => Math.ceil(ticks(ms) / stepTicks);
/** Ticks left before a World process-cycle deadline. */
const cyclesUntil = (until, cycle) => (Number.isFinite(cycle) && Number(until) > cycle ? Number(until) - cycle : 0);
const flag = (on) => (on ? 1 : 0);

/**
 * The dragonfire protection state from DragonfireProtection.js, or the saved fire immunity timer
 * and saved tier when the state is gone (it is not persisted, so a relog falls back to them as that
 * module does). [milliseconds left, type].
 */
function getAntifire(player, now) {
  const state = player.getAttribute?.(ATTR_DRAGONFIRE_STATE);
  if (state && typeof state === "object") {
    const ms = millisUntil(state.endsAt, now);
    if (ms === 0) return [0, 0];
    return [ms, state.tier >= DragonfireProtectionTier.SUPER_ANTIFIRE ? SUPER_ANTIFIRE_TYPE : ANTIFIRE_TYPE];
  }
  const timer = player.getCombat?.()?.getFireImmunityTimer?.();
  const secondsLeft = Math.max(0, Number(timer?.secondsRemaining?.() ?? 0));
  if (secondsLeft === 0) return [0, 0];
  const savedTier = player.getAttribute?.(ATTR_DRAGONFIRE_TIER)?.tier;
  const ms = Math.max(0, Number(timer.millisRemaining?.() ?? secondsLeft * 1000));
  return [ms, savedTier >= DragonfireProtectionTier.SUPER_ANTIFIRE ? SUPER_ANTIFIRE_TYPE : ANTIFIRE_TYPE];
}

/**
 * [whole seconds, milliseconds] left. secondsRemaining(), not finished(): finished() stops the
 * timer as a side effect.
 */
function getTeleblock(player) {
  const timer = player.getCombat?.()?.getTeleblockTimer?.();
  const secondsLeft = Math.max(0, Number(timer?.secondsRemaining?.() ?? 0));
  if (secondsLeft === 0) return [0, 0];
  return [secondsLeft, Math.max(0, Number(timer.millisRemaining?.() ?? secondsLeft * 1000))];
}

function getStaminaMillis(player, now) {
  return millisUntil(Number(player.getAttribute?.(ATTR_STAMINA_END)), now);
}

/** [kind, id, value]: "varp" for the infobox timers, "varbit" for the buff bar. */
function getState(player, now = Date.now()) {
  const [antifireMs, antifireType] = getAntifire(player, now);
  const [teleblockSeconds, teleblockMs] = getTeleblock(player);
  const staminaMs = getStaminaMillis(player, now);
  return [
    ["varp", ANTIFIRE_TIMER_SECONDS_VARP, seconds(antifireMs)],
    ["varp", ANTIFIRE_TIMER_TYPE_VARP, antifireType],
    ["varp", TELEBLOCK_TIMER_SECONDS_VARP, teleblockSeconds],
    ["varp", STAMINA_TIMER_SECONDS_VARP, seconds(staminaMs)],
    ["varbit", ANTIFIRE_VARBIT, antifireType === ANTIFIRE_TYPE ? steps(antifireMs, ANTIFIRE_STEP_TICKS) : 0],
    ["varbit", SUPER_ANTIFIRE_VARBIT, antifireType === SUPER_ANTIFIRE_TYPE ? steps(antifireMs, SUPER_ANTIFIRE_STEP_TICKS) : 0],
    ["varbit", TELEBLOCK_VARBIT, steps(teleblockMs, 1)],
    ["varbit", STAMINA_DURATION_VARBIT, steps(staminaMs, STAMINA_STEP_TICKS)],
    ["varbit", STAMINA_ACTIVE_VARBIT, staminaMs > 0 ? 1 : 0],
  ];
}

function spellTimers(player, now, cycle) {
  const attribute = (key) => player.getAttribute?.(key);
  const altarMs = millisUntil(Number(attribute(ATTR_GODWARS_ALTAR)) + GODWARS_ALTAR_COOLDOWN_MS, now);
  return [
    ["varp", CHARGE_VARP, Math.ceil(cyclesUntil(attribute(ATTR_CHARGE_UNTIL), cycle) / CHARGE_STEP_TICKS)],
    ["varbit", GODWARS_ALTAR_VARBIT, steps(altarMs, GODWARS_ALTAR_STEP_TICKS)],
    ["varbit", MAGIC_IMBUE_VARBIT, Math.ceil(cyclesUntil(attribute(ATTR_MAGIC_IMBUE_UNTIL), cycle) / MAGIC_IMBUE_STEP_TICKS)],
    ["varbit", CORRUPTION_VARBIT, CORRUPTION_BY_TOTAL[Number(attribute(ATTR_CORRUPTION))] ?? 0],
    ...ARCEUUS_COOLDOWNS.map(([varbit, key]) => ["varbit", varbit, flag(cyclesUntil(attribute(key), cycle) > 0)]),
    ["varbit", RESURRECTION_ACTIVE_VARBIT, flag(attribute(ATTR_THRALL) != null)],
  ];
}

function divineTimers(player, now) {
  const state = player.getAttribute?.(ATTR_DIVINE_STATE);
  const ends = new Map();
  let attackBase = 0;
  for (const entry of Array.isArray(state?.targets) ? state.targets : []) {
    const endsAt = Number.isFinite(entry?.endsAt) ? entry.endsAt : state.endsAt;
    if (millisUntil(endsAt, now) <= 0) continue;
    ends.set(entry?.skillIndex, endsAt);
    if (entry?.skillIndex === DIVINE_SKILL_VARBITS[0][0] && Number.isInteger(entry.base)) attackBase = entry.base;
  }
  const leftOf = (skill) => (ends.has(skill) ? ticks(ends.get(skill) - now) : 0);
  // A combined potion locks its skills with one deadline: two other potions that happen to cover them don't count.
  const combined = (skills) => (new Set(skills.map((skill) => ends.get(skill))).size === 1 ? leftOf(skills[0]) : 0);
  return [
    ...DIVINE_SKILL_VARBITS.map(([skill, varbit]) => ["varbit", varbit, leftOf(skill)]),
    ...DIVINE_COMBINED_VARBITS.map(([varbit, skills]) => ["varbit", varbit, combined(skills)]),
    ["varbit", DIVINE_ATTACK_BASE_VARBIT, attackBase],
  ];
}

/** A tiered raid potion's [tier, ms left]; [0, 0] once it is over. */
function tiered(state, now) {
  const ms = state?.tier ? millisUntil(state.endsAt, now) : 0;
  return ms > 0 ? [state.tier, ms] : [0, 0];
}

function potionTimers(player, now) {
  const [enhanceTier, enhanceMs] = tiered(player.getAttribute?.(ATTR_PRAYER_ENHANCE), now);
  const [overloadTier, overloadMs] = tiered(player.getAttribute?.(ATTR_OVERLOAD_STATE), now);
  return [
    ...divineTimers(player, now),
    ["varbit", STAT_RENEWAL_VARBIT, steps(millisUntil(player.getAttribute?.(ATTR_MENAPHITE_STATE)?.endsAt, now), STAT_RENEWAL_STEP_TICKS)],
    ["varbit", PRAYER_ENHANCE_TIER_VARBIT, enhanceTier],
    ["varbit", PRAYER_ENHANCE_RATE_VARBIT, enhanceTier ? PRAYER_ENHANCE_STEP_TICKS : 0],
    ["varbit", PRAYER_ENHANCE_TIMER_VARBIT, steps(enhanceMs, PRAYER_ENHANCE_STEP_TICKS)],
    ["varbit", RAID_OVERLOAD_TIER_VARBIT, overloadTier],
    ["varbit", RAID_OVERLOAD_TIMER_VARBIT, steps(overloadMs, RAID_OVERLOAD_STEP_TICKS)],
  ];
}

/** [item, count] in the ammo slot: [-1, 0] when it is empty, undefined without equipment. */
function wornAmmo(player) {
  const equipment = player.getEquipment?.();
  if (!equipment) return undefined;
  const ammo = equipment.get?.(pluginApi?.core?.Equipment?.AMMUNITION_SLOT ?? AMMUNITION_SLOT);
  const id = Number(ammo?.getId?.() ?? -1);
  const amount = Number(ammo?.getAmount?.() ?? 0);
  return id > 0 && amount > 0 ? [id, amount] : [-1, 0];
}

function ammoTimers(player) {
  const ammo = wornAmmo(player);
  if (!ammo) return [];
  return [
    ["varp", AMMO_TYPE_VARP, ammo[0]],
    ["varp", AMMO_AMOUNT_VARP, ammo[1]],
    ["varp", AMMO_WEAPON_VARP, -1],
  ];
}

/**
 * Starts the ammo buff again after its varps change, so it shows the new item and count. The first tick after a
 * login starts it for whatever is worn: the bar ignores a start that comes before the gameframe has built it.
 */
function syncAmmoBuff(player) {
  const ammo = wornAmmo(player);
  if (!ammo) return;
  const key = `${ammo[0]}:${ammo[1]}`;
  const prior = ammoBuffStarts.get(player);
  if (prior === key) return;
  ammoBuffStarts.set(player, key);
  // An empty slot after a login has nothing to clear.
  if (prior === undefined && ammo[0] === -1) return;
  player.getPacketSender().sendClientScript(BUFF_BAR_START_SCRIPT, AMMO_BUFF_STRUCT, ammo[1]);
}

function groupGatheringTimers(player) {
  if (!pluginApi?.emitCustomEvent) return [];
  const request = { player, players: 0 };
  pluginApi.emitCustomEvent("woodcutting:group-bonus", request);
  const players = Math.max(0, Math.floor(Number(request.players) || 0));
  return [
    ["varp", GROUP_GATHERING_VARP, players > 0 ? GROUP_GATHERING_WOODCUTTING : -1],
    ["varbit", GROUP_GATHERING_PLAYERS_VARBIT, players],
    ["varbit", GROUP_GATHERING_VALUE_VARBIT, Math.max(0, players - 1)],
  ];
}

/** [kind, id, value] for every other timer the buff bar reads from a var. */
function getEffectState(player, now = Date.now(), cycle = pluginApi?.core?.World?.getProcessCycle?.()) {
  return [...spellTimers(player, now, cycle), ...potionTimers(player, now), ...ammoTimers(player), ...groupGatheringTimers(player)];
}

function send(sender, kind, id, value) {
  if (kind === "varbit") sender.sendVarbit(id, value);
  else sender.sendConfig(id, value);
}

/** The effect timers that changed since the last tick; after a login, the ones that aren't 0. */
function syncEffects(player) {
  const prior = effectStates.get(player) ?? new Map();
  const next = new Map();
  let sender;
  for (const [kind, id, value] of getEffectState(player)) {
    const key = `${kind}:${id}`;
    next.set(key, value);
    if ((prior.get(key) ?? 0) === value) continue;
    sender ??= player.getPacketSender();
    send(sender, kind, id, value);
  }
  effectStates.set(player, next);
}

function sync(player, force = false) {
  if (!player || player.isPlayerBot?.()) return;
  const state = getState(player);
  const prior = force ? undefined : states.get(player);
  states.set(player, state);
  let sender;
  for (let i = 0; i < state.length; i++) {
    const [kind, id, value] = state[i];
    if (prior && prior[i][2] === value) continue;
    sender ??= player.getPacketSender();
    send(sender, kind, id, value);
  }
  if (force) effectStates.delete(player);
  syncEffects(player);
}

function attach(api) {
  pluginApi = api;
}

function forget({ player }) {
  states.delete(player);
  effectStates.delete(player);
  ammoBuffStarts.delete(player);
}

function login({ player }) {
  ammoBuffStarts.delete(player);
  sync(player, true);
}

function tick({ player }) {
  sync(player);
  if (player && !player.isPlayerBot?.()) syncAmmoBuff(player);
}

module.exports = {
  name: "Buff Timers",
  description: "Sends the effect countdowns the buff bar reads (potions, spells, ammo, group woodcutting) and the client's antifire, Tele Block and stamina infobox timers.",
  _test: { getState, getEffectState, sync },
  register(api) {
    attach(api);
    api.onPlayerLogin(login);
    api.onPlayerProcess(tick);
    api.onPlayerLogout(forget);
  },
};
