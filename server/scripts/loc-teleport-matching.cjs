"use strict";

// Choosing which captured loc teleports (rsprox_index.py loc-teleports) become
// plugins/world/data/loc-teleports.json entries, for scripts/sync-loc-teleports.cjs
// (docs/loc-teleports.md). Plain JS so tests can load it.

/**
 * The kinds of loc taken, by the loc's name: ladders, stairs, trapdoors, ropes, caves, holes,
 * tunnels and crevices; and doors, gates, doorways, passageways and entrances that take the
 * player somewhere (a door that only opens in place never moves anyone, so it isn't captured).
 * Boats, portals, jumps and the like need more than a fixed move (fares, quests, agility), so they
 * wait for their own work.
 */
const KINDS = /^(.*\bladder( top)?|stairs?|.*\bstaircase|steps|cellar stairs|trap ?door|manhole|rope|climbing rope|anchor rope|.*\bcave\b.*|cave opening|hole|.*\btunnel|.*\bcrevice|cracked wall|grotto|sewer entrance|smokey well|old ruin entrance|entrance|entry|crypt|.*\bentrance|.*\bdoors?|.*\bdoorway|passageway|.*\bgate)$/i;

/** Sounds that are a fight's, not the loc's (ids, from loc-teleport-sync.json). */
const IGNORED_SOUNDS = new Set(Object.keys(require("../plugins/world/data/loc-teleport-sync.json").ignoreSounds ?? {}).map(Number));

/** Gameval names of content that only exists on Leagues worlds. */
const LEAGUES_ONLY = /^league/;

/**
 * Messages of attempts without a teleport that aren't a refusal: the player doing something
 * else meanwhile, or the attempt never reaching the loc. Any other message ("That looks too
 * steep to safely climb down with just your bare hands.", a guard turning the player away) is
 * taken as a requirement.
 * - Status and notification lines, which the game colours ("<col=...>Your prayers have been
 *   drained!", potion effects, diary and Slayer task completions);
 * - level-ups, food and potions, poison, a chat channel, a music unlock, the desert's thirst;
 * - "I can't reach that!" (the click never got there);
 * - other features' own lines meanwhile (a seed pod or ectophial, a boat docking, an Ironman notice);
 * - the loc's own flavour text.
 */
const NOISE = new RegExp([
  "^<col=", "^Congratulations, you've just advanced", "^Well done! You have completed", "^You have completed your task",
  "^You drink some of", "^You have # doses? of", "^You have finished your potion", "^Bottomless Brew",
  "^You eat ", "^It heals some health",
  "^You have been poisoned", "^You have been venomed", "^You are hit by",
  "^Now talking in", "^To talk, start each line", "^You have unlocked a new music track",
  "^You start dying of thirst", "^You should get a waterskin",
  "^I can't reach that!", "teleports you", "^You refill the ectophial", "^You dock the boat", "^As an Ironman",
  "^You squeeze", "^You climb over", "^You nimbly", "^and continue", "^You swing your pickaxe", "^Your stamina", "^You feel",
].join("|"));

function refusals(entry) {
  return (entry.failures ?? []).map(([message]) => message).filter((message) => !NOISE.test(message));
}

/** How far apart two destinations of one loc can be and still be one teleport (a side apart). */
const NETWORK_SPREAD = 30;

const distance = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/**
 * A travel network (spirit tree, magic mushtree, the shipyard portal): one loc, several
 * far-apart destinations and no dialogue choice, so an interface picks the destination.
 */
function isNetwork(entry) {
  const destinations = entry.destinations ?? [];
  if (destinations.length < 2 || destinations.some((destination) => destination.choice)) return false;
  return destinations.some((a) => destinations.some((b) => distance(a, b) > NETWORK_SPREAD));
}

/** Two destinations reached from the same tile: where the player stands doesn't pick one. */
function sharesSide(entry) {
  const sides = (entry.destinations ?? []).map((destination) => String(destination.from?.[0] ?? destination.teleported_from?.[0]));
  return new Set(sides).size < sides.length;
}

/**
 * The decision that leaves a loc out: by tile (one placement of a name many locs share), exact
 * gameval name or pattern. { why } or null.
 */
function skipDecision(entry, decisions) {
  const { name } = entry;
  const placed = (decisions.skip?.locs ?? []).find((loc) => loc.name === name && loc.x === entry.x && loc.y === entry.y && (loc.z ?? 0) === entry.z);
  if (placed) return { why: placed.why };
  if (decisions.skip?.names?.[name]) return { why: decisions.skip.names[name] };
  for (const { pattern, why } of decisions.skip?.patterns ?? []) {
    if (new RegExp(pattern).test(name)) return { why };
  }
  return null;
}

/**
 * The gate decided for a loc (`decisions.requirements`): by tile, or by name for every
 * placement when the decision has no tile. Null when there's none.
 */
function requirementFor(entry, decisions) {
  return (decisions.requirements ?? []).find((gate) => gate.name === entry.name
    && (gate.x === undefined || (gate.x === entry.x && gate.y === entry.y && (gate.z ?? 0) === entry.z))) ?? null;
}

/** The dialogue decided for a loc (`decisions.dialogues`), by tile or by name; null when there's none. */
function dialogueFor(entry, decisions) {
  return (decisions.dialogues ?? []).find((asked) => asked.name === entry.name
    && (asked.x === undefined || (asked.x === entry.x && asked.y === entry.y && (asked.z ?? 0) === entry.z))) ?? null;
}

/** A loc's captured destinations, one per distinct tile (the same move seen with and without the dialogue). */
function distinctDestinations(entry) {
  const seen = new Map();
  for (const destination of entry.destinations ?? []) {
    const key = `${destination.x},${destination.y},${destination.z}`;
    if (!seen.has(key)) seen.set(key, destination);
  }
  return [...seen.values()];
}

/**
 * Whether a captured loc becomes an entry. `probe` is what clicking it in tsps did, per
 * destination side: { status: same | nothing | different | handled-no-move | ..., handledBy }.
 * `display` is the loc's name in the rev 241 cache (for a multiloc, the variant with the option).
 * Returns { take: true } or { take: false, reason }.
 */
function choose(entry, probe, display, decisions) {
  // Leagues and event worlds move players the same way, apart from their own content.
  const labels = (entry.labels ?? []).filter((label) => label !== "special-world");
  if (labels.length) return { take: false, reason: `labelled ${entry.labels.join(", ")}` };
  if (LEAGUES_ONLY.test(entry.name)) return { take: false, reason: "Leagues content" };
  if (!entry.teleports) return { take: false, reason: "no teleport captured" };
  const skipped = skipDecision(entry, decisions);
  if (skipped) return { take: false, reason: skipped.why };
  if (isNetwork(entry)) return { take: false, reason: "travel network (an interface picks the destination)" };
  // A gate with its requirement decided plays the captured refusal; any other refusal waits for one.
  if (refusals(entry).length && !requirementFor(entry, decisions)) return { take: false, reason: "live OSRS refused some attempts (a requirement)" };
  if (entry.dialogue && !dialogueFor(entry, decisions)) return { take: false, reason: "dialogue choice" };
  // A decided dialogue's destination is its `go` options'; the same move with and without it is one.
  if (!dialogueFor(entry, decisions) && sharesSide(entry)) return { take: false, reason: "several destinations from one tile (something else decides)" };
  if (dialogueFor(entry, decisions) && distinctDestinations(entry).length > 1) return { take: false, reason: "a dialogue with several destinations (a network)" };
  if ((!display || !KINDS.test(display)) && !dialogueFor(entry, decisions) && !decisions.include?.[entry.name]) return { take: false, reason: "not a ladder, stair, cave or hole" };
  if (!probe?.length || probe.some((side) => ["not-on-map", "op-missing", "error"].includes(side.status))) {
    return { take: false, reason: "not on the rev 241 map as captured" };
  }
  if (probe.every((side) => side.status === "same")) return { take: false, reason: "tsps already does this" };
  // Clicks tsps leaves alone, or that Ladders takes (it asks other plugins first); another
  // plugin's loc is that plugin's to fix.
  const owner = probe.find((side) => side.status !== "same" && side.status !== "nothing" && side.handledBy !== "Ladders");
  if (owner) return { take: false, reason: `handled by ${owner.handledBy ?? owner.status}` };
  return { take: true };
}

/** "x,y,z:op", how entries are looked up from a click. */
function keyOf(x, y, z, op) {
  return `${x},${y},${z}:${op}`;
}

/**
 * The data entry for a captured loc: its destination, or one per side when it depends on where
 * the player stands (a staircase used from either end), and the captured animation, sound,
 * fade and ticks (counted from arrival, as the captures count them).
 */
function toEntry(entry, { display, option, sequenceId, gate, asked }) {
  const out = { name: entry.name, id: entry.id, display, option, op: entry.op, x: entry.x, y: entry.y, z: entry.z };
  const destinations = asked ? distinctDestinations(entry) : entry.destinations ?? [];
  if (destinations.length === 1) {
    out.to = [destinations[0].x, destinations[0].y, destinations[0].z];
  } else {
    out.sides = destinations.map((destination) => ({
      from: destination.from?.[0] ?? destination.teleported_from?.[0],
      to: [destination.x, destination.y, destination.z],
    }));
  }
  if (sequenceId !== null && sequenceId !== undefined) {
    out.anim = sequenceId;
    out.animTick = Math.round(entry.sequence_tick);
  }
  // Medians of an even number of attempts fall between ticks; ticks are whole.
  out.tick = Math.round(entry.teleport_tick);
  // The first sound that is not a fight's (loc-teleport-sync.json ignoreSounds): with a monster or a player fighting
  // nearby, the first thing a capture hears around the climb is the fight.
  const sound = (entry.sounds ?? []).map(([id]) => id).find((id) => !IGNORED_SOUNDS.has(id));
  if (sound !== undefined) out.sound = sound;
  if (entry.fade) out.fade = true;
  if (gate?.requires) out.requires = gate.requires;
  if (gate?.mesbox) out.mesbox = gate.mesbox;
  if (asked) {
    out.ask = {
      prompt: asked.prompt,
      options: asked.options.map((text) => ({ text, ...((asked.go ?? []).includes(text) ? { go: true } : {}), ...(asked.ladder?.[text] ? { ladder: asked.ladder[text] } : {}) })),
      ...(asked.answer ? { answer: asked.answer } : {}),
    };
  }
  out.recordings = entry.recordings;
  return out;
}

module.exports = { dialogueFor, distinctDestinations, requirementFor, KINDS, isNetwork, sharesSide, refusals, skipDecision, choose, keyOf, toEntry };
