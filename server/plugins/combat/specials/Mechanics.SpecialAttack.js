// Data-only descriptions shared by native gameplay and the authoring catalog.
const number = (key, label, value, min, max, step = 1) => ({ key, label, type: "number", value, min, max, step });
const enabled = { key: "enabled", label: "Enable feature", type: "boolean", value: true };
const definitions = {
  burn: {
    name: "Burn", trigger: "When the hit deals damage", description: "Apply {damage} total burn damage with a {chance}% chance. The burn deals damage over time; immune targets are unaffected.",
    parameters: [enabled, number("damage", "Total burn damage", 10, 0, 1000), number("chance", "Burn chance (%)", 100, 0, 100, .1), { key: "strong", label: "Burn targets resistant to normal burns", help: "Changes which targets can be burned, not the damage amount. Full burn immunity still applies.", type: "boolean", value: false }],
  },
  "burn-rolls": {
    name: "Burn with accuracy stages", trigger: "After the hit passes accuracy", description: "Apply {damage} total burn damage. Use a {firstChance}%, {secondChance}% or {thirdChance}% burn chance depending on which accuracy stage succeeds. Attempt a burn for each hit or once for the attack.",
    parameters: [enabled, number("damage", "Total burn damage", 10, 0, 1000), number("firstChance", "First accuracy stage burn chance (%)", 15, 0, 100, .1), number("secondChance", "Second accuracy stage burn chance (%)", 30, 0, 100, .1), number("thirdChance", "Third accuracy stage burn chance (%)", 45, 0, 100, .1), { key: "perHit", label: "Attempt a burn for every hit", type: "boolean", value: true }, { key: "strong", label: "Burn targets resistant to normal burns", help: "Changes which targets can be burned, not the damage amount. Full burn immunity still applies.", type: "boolean", value: false }],
  },
  poison: {
    name: "Poison", trigger: "When the hit deals damage", description: "Apply poison with a {chance}% chance. Its first tick deals {damage} damage, and later ticks weaken over time. Poison-immune targets are unaffected.",
    parameters: [enabled, number("damage", "Initial poison damage", 4, 0, 100), number("chance", "Poison chance (%)", 100, 0, 100, .1)],
  },
  "stat-drain": {
    name: "Stat reduction", trigger: "When the hit passes accuracy", description: "Remove {percent}% of each chosen skill's base level, plus {flat} levels. Against demons, use {demonPercent}% instead. Base levels exclude boosts and earlier drains.",
    advancedFrom: 4, detailsLabel: "Affected stats",
    parameters: [enabled, number("percent", "Base levels removed (%)", 5, 0, 100, .1), number("demonPercent", "Base levels removed against demons (%)", 10, 0, 100, .1), number("flat", "Additional levels removed", 1, 0, 1000), ...["attack", "strength", "defence", "magic", "ranged", "prayer"].map(key => ({ key, label: `Drain ${key[0].toUpperCase() + key.slice(1)}`, type: "boolean", value: ["attack", "strength", "defence"].includes(key) }))],
  },
  "prayer-block": {
    name: "Protection prayer lock", trigger: "When the hit passes accuracy against a player", description: "Disable the enemy's protection prayers for {durationTicks} ticks ({durationTicks:seconds} s).",
    parameters: [enabled, number("durationTicks", "Protection prayer lock (ticks)", 8, 1, 1000)],
  },
  "defence-drain": {
    name: "Defence reduction", trigger: "When the hit passes accuracy", description: "Remove {percent}% of the enemy's current Defence level. Choose whether the hit must deal damage. Bosses may limit how far their Defence can be reduced.",
    parameters: [enabled, number("percent", "Current Defence removed (%)", 30, 0, 100, .1), { key: "requireDamage", label: "Require positive damage", type: "boolean", value: true }, { key: "playersOnly", label: "Only affect players", type: "boolean", value: false }],
  },
  "damage-drain": {
    name: "Damage-based stat reduction", trigger: "When the hit deals damage", description: "Reduce the chosen enemy skill by {percent}% of damage dealt. Minimum skill levels and boss-specific limits still apply.",
    parameters: [enabled, { key: "skill", label: "Enemy stat", type: "choice", value: "defence", choices: ["attack", "strength", "defence", "magic", "ranged", "prayer"].map(value=>({value,label:value[0].toUpperCase()+value.slice(1)})) }, number("percent", "Damage used for stat drain (%)", 100, 0, 1000, .1), { key: "requireUnreduced", label: "Only drain a skill that is not already reduced", type: "boolean", value: true }, number("playerFloor", "Minimum player stat level", 1, 0, 99)],
  },
  "ordered-drain": {
    name: "Sequential stat reduction", trigger: "After the hit deals damage", description: "Use {percent}% of damage dealt to reduce these skills in order: {order}. Move to the next skill only when the previous one reaches its minimum.",
    parameters: [enabled, number("percent", "Damage used for stat drain (%)", 100, 0, 1000, .1), { key: "order", label: "Stat drain order", type: "order", value: ["defence", "strength", "prayer", "attack", "magic", "ranged"], choices: ["defence", "strength", "prayer", "attack", "magic", "ranged"].map(value=>({value,label:value[0].toUpperCase()+value.slice(1)})) }, number("playerFloor", "Minimum player stat level", 0, 0, 99)],
  },
  "skill-boost": {
    name: "Skill boost", trigger: "When the special activates", description: "Raise {skill} to its base level plus {flat} levels and {percent}% of that base. Keep an existing boost if it is higher.",
    parameters: [enabled, { key: "skill", label: "Boosted skill", type: "choice", value: "woodcutting", choices: ["attack", "strength", "defence", "ranged", "magic", "prayer", "hitpoints", "cooking", "woodcutting", "fletching", "fishing", "firemaking", "crafting", "smithing", "mining", "herblore", "agility", "thieving", "slayer", "farming", "runecrafting", "hunter", "construction", "sailing"].map(value=>({value,label:value[0].toUpperCase()+value.slice(1)})) }, number("flat", "Flat skill boost", 3, 0, 1000), number("percent", "Base level boost (%)", 0, 0, 100, .1)],
  },
  "missing-resource-bonus": {
    name: "Bonus from missing levels", trigger: "Calculated when the attack rolls", description: "For each {skill} point below your base level, add {damagePerPoint}% damage and {accuracyPerPoint}% accuracy. Optionally limit the total damage bonus.",
    parameters: [enabled, { key: "skill", label: "Missing skill points", type: "choice", value: "prayer", choices: ["hitpoints", "prayer", "attack", "strength", "defence", "ranged", "magic"].map(value=>({value,label:value[0].toUpperCase()+value.slice(1)})) }, number("damagePerPoint", "Damage bonus per missing point (%)", .5, 0, 100, .1), number("accuracyPerPoint", "Accuracy bonus per missing point (%)", 0, 0, 100, .1), { key: "capEnabled", label: "Cap the damage bonus", type: "boolean", value: false }, number("damageCap", "Maximum damage bonus (%)", 100, 0, 1000000, .1)],
  },
};

function mechanicSchema(type, defaults = {}) {
  if (Array.isArray(type)) return { version: 1, groups: type.flatMap(([kind, values]) => mechanicSchema(kind, values).groups) };
  const definition = definitions[type];
  if (!definition) throw new Error(`Unknown special mechanic: ${type}`);
  const parameters = definition.parameters.map(parameter => ({ ...parameter, value: defaults[parameter.key] ?? parameter.value }));
  return { version: 1, groups: [{ ...definition, id: type, phase: defaults._event === "launch" ? "At activation" : "At impact", event: defaults._event ?? "resolved", hook: defaults._hook ?? "handleAfterHitEffects", parameters }] };
}
function mechanicSettings(method, type, defaults) { return { enabled: true, ...defaults, ...method.specialMechanics?.[type] }; }
module.exports = { mechanicSchema, mechanicSettings };
