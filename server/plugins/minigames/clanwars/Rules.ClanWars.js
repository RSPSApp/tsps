/**
 * The configuration offered by this bounded Last Team Standing implementation, NOT a claim
 * about OSRS's initial/default settings. Only the team cap is negotiable in this slice.
 *
 * Rev241 enum_374/375: last standing is 0 and closes entry when combat starts;
 * enum_929: Plateau is 1; enum_2340: the cap indices below (not the Wiki's older list).
 * The Wiki's Clan Wars page establishes safe deaths and the 100-fighter per-side limit.
 * Other modes, combat restrictions and modern-clan selection need separate implementation.
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
    } else if (descriptor.value !== OFFERED_RULES[key]) return false;
  }
  return true;
}

function create(playercap = 0) {
  const rules = { ...OFFERED_RULES, playercap };
  return validate(rules) ? rules : null;
}

function teamCap(rules) {
  return validate(rules) ? TEAM_CAPS[rules.playercap] : null;
}

/** Server-written confirmation text; wording is ours, mechanics are from the sources above. */
function summary(rules) {
  if (!validate(rules)) return null;
  const cap = teamCap(rules);
  const capText = rules.playercap === 0 ? "Uncapped (maximum 100 fighters per team)" : `${cap} v ${cap}`;
  return [
    "Last team standing on Plateau.",
    `Team cap: ${capText}.`,
    "Safe deaths: you keep your items. No prizes or stakes.",
    "Two minutes to enter and prepare. No joining or rejoining after the battle begins.",
    "The team with no fighters remaining loses. Leaving the chat-channel counts as a death.",
    "Melee combat only. Ranged and magical combat are disabled. Prayers, food, drinks and melee special attacks are allowed.",
    "Food and drinks are consumed normally. Powered staves and Vesta's blighted longsword are not enabled.",
  ].join("<br>");
}

module.exports = { OFFERED_RULES, TEAM_CAPS, validate, create, teamCap, summary };
