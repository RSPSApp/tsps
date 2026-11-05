/** Realistic OSRS-style display names for bots; the username stays the bot's stable identity. */

const MAX_LENGTH = 12;
const VALID_NAME = /^[A-Za-z0-9 ]{1,12}$/;
const FIRST = ["Iron", "Dark", "Rune", "Mith", "Fire", "Wild", "Lone", "Pure", "Swift", "Frost", "Stone", "Shadow",
  "Blood", "Gold", "Silver", "Zul", "Mad", "Holy", "Grim", "Ranged", "Magic", "Dragon", "Lucky", "Tiny", "Big"];
const SECOND = ["man", "slayer", "knight", "fisher", "miner", "chef", "mage", "archer", "pker", "wolf", "bear", "hunter",
  "smith", "lord", "king", "scape", "hero", "monk", "thief", "rogue", "baron", "fox", "crab", "cow", "tank"];
const WORDS = ["Skiller", "Noob", "Ninja", "Wizard", "Duelist", "Farmer", "Pirate", "Maniac", "Sailor"];

/** FNV-1a then mulberry32: a small seeded generator, so the same bot always rolls the same names. */
function seededRandom(seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rollName(random) {
  const pick = (list) => list[Math.floor(random() * list.length)];
  const first = pick(FIRST);
  const base = random() < 0.2 ? pick(WORDS) : first + pick(SECOND);
  const join = random() < 0.15 ? " " : "";
  const digits = random() < 0.4 ? String(Math.floor(random() * 1000)) : "";
  return random() < 0.2 ? `${base}${join}${pick(WORDS)}`.slice(0, MAX_LENGTH).trim() : `${base}${digits}`;
}

/** Deterministic per `username`; moves on to the next roll while `isTaken(name)`. */
function generateBotName(username, isTaken = () => false) {
  const random = seededRandom(username);
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const name = rollName(random);
    if (VALID_NAME.test(name) && !isTaken(name)) return name;
  }
  return null; // ponytail: 1000 rolls all taken; caller keeps the username
}

/** Why a staff-chosen bot name is refused (a message), or null. Same rules as ::displayname. */
function botNameProblem(name) {
  if (!VALID_NAME.test(name)) return `Display names are 1-${MAX_LENGTH} letters, numbers and spaces.`;
  if (name.replace(/ /g, "").toLowerCase().includes("mod")) return "Display names can't contain \"mod\".";
  return null;
}

module.exports = { generateBotName, botNameProblem };
