/**
 * The configuration offered by this bounded melee team-battle implementation, NOT a claim
 * about OSRS's initial/default settings. The team cap and Last Team Standing / kill-target mode are negotiable.
 *
 * Rev242 enum_374/375: last standing is 0 and closes entry when combat starts;
 * enum_929: Plateau is 1; enum_2340: the cap indices below (not the Wiki's older list).
 * The Wiki's Clan Wars page establishes safe deaths and the 100-fighter per-side limit.
 * Enums 374/376 map modes 1..8 to the kill targets below; timed and objective modes remain unsupported.
 * Other combat restrictions and modern-clan selection need separate implementation.
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
      if (descriptor.value < 0 || descriptor.value >= KILL_TARGETS.length) return false;
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
  return validate(rules) ? KILL_TARGETS[rules.wincondition] : null;
}

/** Server-written confirmation text; wording is ours, mechanics are from the sources above. */
function summary(rules) {
  if (!validate(rules)) return null;
  const cap = teamCap(rules);
  const capText = rules.playercap === 0 ? "Uncapped (maximum 100 fighters per team)" : `${cap} v ${cap}`;
  const target = killTarget(rules);
  return [
    target ? `First to ${target.toLocaleString("en-US")} kills on Plateau.` : "Last team standing on Plateau.",
    `Team cap: ${capText}.`,
    "Safe deaths: you keep your items. No prizes or stakes.",
    target ? "Two minutes to prepare. Joining and rejoining remain open during the battle; rejoining is unrestricted."
      : "Two minutes to enter and prepare. No joining or rejoining after the battle begins.",
    target ? "Defeated fighters go to jail and may return to battle. Leaving the chat-channel counts as a death."
      : "The team with no fighters remaining loses. Leaving the chat-channel counts as a death.",
    "Melee combat only. Ranged and magical combat are disabled. Prayers, food, drinks and melee special attacks are allowed.",
    "Food and drinks are consumed normally. Powered staves and Vesta's blighted longsword are not enabled.",
  ].join("<br>");
}

module.exports = { OFFERED_RULES, TEAM_CAPS, KILL_TARGETS, validate, create, teamCap, killTarget, summary };
