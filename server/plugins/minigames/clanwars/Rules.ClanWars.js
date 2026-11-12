/**
 * The configuration offered by this bounded melee team-battle implementation, NOT a claim
 * about OSRS's initial/default settings. The team cap, mode, bounded melee and membership terms are negotiable.
 *
 * Rev242 enum_374/375: last standing is 0 and closes entry when combat starts;
 * enum_929: Plateau is 1; enum_2340: the cap indices below (not the Wiki's older list).
 * The Wiki's Clan Wars page establishes safe deaths and the 100-fighter per-side limit.
 * Enums 374/376 map modes 1..8 to kill targets; enum1119 maps 16..20 to minutes.
 * Objective modes remain unsupported.
 * Enums919/921/923/925 establish prayer, food, drinks and special-attack choices.
 * Enums2336..2339 establish leaving-channel penalties and the 60-second rejoining delay.
 * Enums927/928 establish loss at zero or five-or-fewer fighters; Ignore 5 is offered for LTS only.
 * Staff-of-the-Dead-only, other combat restrictions and modern clans remain deferred.
 */
const OFFERED_RULES = Object.freeze({
  wincondition: 0,
  arena: 1,
  melee: 0,
  ranged: 1,
  magic: 4,
  prayer: 0,
  food: 0,
  drinks: 0,
  specialattacks: 0,
  stragglers: 0,
  freezing: 0,
  pjtimer: 0,
  tots: 0,
  singlespells: 0,
  leavingcc: 0,
  rejoiningdelay: 0,
  playercap: 0,
  vls: 0,
});

// "Uncapped" remains subject to the activity's maximum of 100 fighters per side.
const TEAM_CAPS = Object.freeze([100, 1, 5, 10, 15, 20, 50, 100]);
const KILL_TARGETS = Object.freeze([0, 25, 50, 100, 200, 500, 1000, 5000, 10000]);
const TIME_LIMIT_MINUTES = Object.freeze({ 16: 5, 17: 10, 18: 20, 19: 60, 20: 120 });
// GameConstants.GAME_ENGINE_PROCESSING_CYCLE_RATE is 600ms; HUD script213
// multiplies this tick count by 30 client cycles (script744 uses 50 cycles/s).
const TICKS_PER_MINUTE = 100;
const STRAGGLER_LIMITS = Object.freeze([0, 5]);
const RESTRICTIONS = Object.freeze({
  food: Object.freeze([0, 1]),
  drinks: Object.freeze([0, 1]),
  prayer: Object.freeze([0, 1, 2]),
  // "No Staff of the Dead" needs separately qualified variant/effect rules.
  specialattacks: Object.freeze([0, 2]),
  leavingcc: Object.freeze([0, 1]),
  rejoiningdelay: Object.freeze([0, 1]),
});
const RULE_KEYS = Object.freeze(Object.keys(OFFERED_RULES));

/** Refuse incomplete, obsolete or forged configurations rather than silently normalising. */
function validate(rules) {
  if (!rules || typeof rules !== "object" || Array.isArray(rules)) return false;
  const prototype = Object.getPrototypeOf(rules);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Reflect.ownKeys(rules);
  if (keys.length !== RULE_KEYS.length || keys.some((key) => !RULE_KEYS.includes(key))) return false;
  for (const key of RULE_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(rules, key);
    if (!descriptor || !("value" in descriptor) || !Number.isInteger(descriptor.value)) return false;
    if (key === "playercap") {
      if (descriptor.value < 0 || descriptor.value >= TEAM_CAPS.length) return false;
    } else if (key === "wincondition") {
      if ((descriptor.value < 0 || descriptor.value >= KILL_TARGETS.length)
        && !TIME_LIMIT_MINUTES[descriptor.value]) return false;
    } else if (key === "stragglers") {
      if (descriptor.value < 0 || descriptor.value >= STRAGGLER_LIMITS.length
        || descriptor.value === 1 && Object.getOwnPropertyDescriptor(rules, "wincondition")?.value !== 0) return false;
    } else if (RESTRICTIONS[key]) {
      if (!RESTRICTIONS[key].includes(descriptor.value)) return false;
    } else if (descriptor.value !== OFFERED_RULES[key]) return false;
  }
  return true;
}

function create(playercap = 0, wincondition = 0) {
  const rules = { ...OFFERED_RULES, playercap, wincondition };
  return validate(rules) ? rules : null;
}

function teamCap(rules) {
  return validate(rules) ? TEAM_CAPS[rules.playercap] : null;
}

function killTarget(rules) {
  return validate(rules) ? KILL_TARGETS[rules.wincondition] ?? 0 : null;
}

function timeLimitTicks(rules) {
  return validate(rules) ? (TIME_LIMIT_MINUTES[rules.wincondition] ?? 0) * TICKS_PER_MINUTE : null;
}

function respawns(rules) { return killTarget(rules) > 0 || timeLimitTicks(rules) > 0; }

/** Server-written confirmation text; wording is ours, mechanics are from the sources above. */
function summary(rules) {
  if (!validate(rules)) return null;
  const cap = teamCap(rules);
  const capText = rules.playercap === 0 ? "Uncapped (maximum 100 fighters per team)" : `${cap} v ${cap}`;
  const target = killTarget(rules);
  const minutes = TIME_LIMIT_MINUTES[rules.wincondition];
  const respawning = respawns(rules);
  return [
    minutes ? `Most kills in ${minutes} minutes on Plateau.`
      : target ? `First to ${target.toLocaleString("en-US")} kills on Plateau.` : "Last team standing on Plateau.",
    `Team cap: ${capText}.`,
    "Safe deaths: you keep your items. No prizes or stakes.",
    respawning ? "Two minutes to prepare. Joining and rejoining remain open during the battle."
      : "Two minutes to enter and prepare. No joining or rejoining after the battle begins.",
    respawning ? "Defeated fighters go to jail and may return to battle."
      : rules.stragglers === 1 ? "Stragglers: Ignore 5. A team with five or fewer fighters remaining loses."
        : "Stragglers: Kill 'em all. The team with no fighters remaining loses.",
    ...(!respawning && rules.stragglers === 1 ? ["If both teams have five or fewer fighters when checked, the battle ends without a winner."] : []),
    rules.leavingcc ? "Leaving the chat-channel incurs no death penalty." : "Leaving the chat-channel counts as a death.",
    rules.rejoiningdelay ? respawning ? "After death, returning to this battle requires a 60-second wait."
      : "The selected 60-second rejoining delay cannot reopen entry after Last Team Standing begins."
      : "There is no additional rejoining delay.",
    ...(minutes ? ["At the time limit the higher kill score wins. Equal scores end without a winner."] : []),
    "Melee combat only. Ranged and magical combat are disabled.",
    rules.prayer === 2 ? "Prayers are disabled." : rules.prayer === 1
      ? "Prayers with overhead icons are disabled; other prayers are allowed." : "All prayers are allowed.",
    `Food: ${rules.food ? "disabled" : "allowed"}. Drinks: ${rules.drinks ? "disabled" : "allowed"}.`,
    `Melee special attacks: ${rules.specialattacks === 2 ? "disabled" : "allowed"}.`,
    `${rules.food && rules.drinks ? "Food and drinks are disabled." : rules.food
      ? "Allowed drinks are consumed normally." : rules.drinks ? "Allowed food is consumed normally."
        : "Food and drinks are consumed normally."} Powered staves and Vesta's blighted longsword are not enabled.`,
  ].join("<br>");
}

module.exports = { OFFERED_RULES, RESTRICTIONS, STRAGGLER_LIMITS, TEAM_CAPS, KILL_TARGETS, TIME_LIMIT_MINUTES, validate, create, teamCap, killTarget, timeLimitTicks, respawns, summary };
