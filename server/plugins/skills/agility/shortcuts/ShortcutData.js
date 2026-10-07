/**
 * The agility shortcuts, read from data/definitions/agility-shortcuts.json and turned into the
 * obstacle entries Agility.plugin.js plays. The format is described in ../README.md.
 *
 * Steps in the data are templates: animations by name (`"CLIMB_ROCKS"`), the builders as macros
 * (`{ "use": "hops", "args": ["object", "to"] }`), tiles relative to the clicked loc or the player
 * (`{ "object": [0, 1] }`, `{ "pos": [0, 4, 0] }`), single coordinates (`"pos.x"`), and for a
 * two-way shortcut its ends (`"from"`, `"to"`) and the tiles it passes in travel order (`"via0"`,
 * `"...via"`). Behaviour no template can say is a named script from the region files.
 */
const DATA = require("../../../../data/definitions/agility-shortcuts.json");
const { Anim } = require("../constants");
const { climb } = require("../steps");
const builders = require("./builders");

const SCRIPTS = {
  ...require("./Common"),
  ...require("./CourseEntrances"),
  ...require("./Misthalin"),
  ...require("./Asgarnia"),
  ...require("./Karamja"),
  ...require("./Desert"),
  ...require("./Fremennik"),
  ...require("./Kourend"),
  ...require("./Wilderness"),
  ...require("./Wyrmscraig"),
};

const ANIMATIONS = { ...Anim, ...builders.ShortcutAnim };
const MACROS = {
  climbOver: builders.climbOver,
  jump: builders.jump,
  hops: builders.hops,
  pipe: builders.pipe,
  tunnel: builders.tunnel,
  crevice: builders.crevice,
  crawlDown: builders.crawlDown,
  crawlUp: builders.crawlUp,
  ropeSwing: builders.ropeSwing,
  hurdle: builders.hurdle,
  climb,
};
const ANIMATION_NAME = /^[A-Z][A-Z0-9_]*$/;
const COORDINATES = {
  "pos.x": (scope) => scope.pos.x,
  "pos.y": (scope) => scope.pos.y,
  "pos.z": (scope) => scope.pos.z,
  "object.x": (scope) => scope.obj.x,
  "object.y": (scope) => scope.obj.y,
  "object.z": (scope) => scope.obj.z,
};
const ENTRY_KEYS = new Set([
  "name", "object", "at", "level", "xp", "start", "end", "render", "route", "refuse",
  "steps", "between", "stile", "script", "params", "fail", "requires", "unverified", "note",
]);
const FAIL_KEYS = new Set([
  "low", "high", "baseChance", "neverFailLevel", "fromLevel", "xp", "start", "end", "render", "steps", "cross", "hit",
]);
const REQUIREMENT_KEYS = new Set(["skills", "equipped", "items", "quest", "diary", "steps", "cross", "start", "end"]);

function animation(name, where) {
  const id = ANIMATIONS[name];
  if (id === undefined) throw new Error(`agility-shortcuts.json: unknown animation "${name}" (${where})`);
  return id;
}

function relative(base, delta) {
  const tile = [base.x + delta[0], base.y + delta[1]];
  return delta.length > 2 ? [...tile, base.z + delta[2]] : tile;
}

/** Fills a template from `scope` ({ obj, pos, tokens }). */
function bind(value, scope, where) {
  if (typeof value === "string") {
    if (scope.tokens && value in scope.tokens) return scope.tokens[value];
    if (value in COORDINATES) return COORDINATES[value](scope);
    if (ANIMATION_NAME.test(value)) return animation(value, where);
    return value;
  }
  if (Array.isArray(value)) {
    const out = [];
    for (const item of value) {
      if (item === "...via") {
        out.push(...scope.tokens.via);
      } else if (item && typeof item === "object" && !Array.isArray(item) && item.use) {
        const result = bind(item, scope, where);
        if (Array.isArray(result)) out.push(...result);
        else out.push(result);
      } else {
        out.push(bind(item, scope, where));
      }
    }
    return out;
  }
  if (value && typeof value === "object") {
    if (value.use) {
      const macro = MACROS[value.use];
      if (!macro) throw new Error(`agility-shortcuts.json: unknown macro "${value.use}" (${where})`);
      return macro(...bind(value.args ?? [], scope, where));
    }
    if (value.object) return relative(scope.obj, value.object);
    if (value.pos) return relative(scope.pos, value.pos);
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = bind(item, scope, where);
    return out;
  }
  return value;
}

const CONTEXT_TOKENS = new Set(["object", "to", "from", "...via", ...Object.keys(COORDINATES)]);

/** Whether a template reads the clicked loc, the player or a crossing's ends. */
function needsContext(value) {
  if (typeof value === "string") return CONTEXT_TOKENS.has(value) || /^via\d+$/.test(value);
  if (Array.isArray(value)) return value.some(needsContext);
  if (value && typeof value === "object") {
    if (value.object || value.pos) return true;
    return Object.values(value).some(needsContext);
  }
  return false;
}

/**
 * A template as a function of the obstacle context, or - when it reads nothing from the context -
 * the plain value, filled once.
 */
function template(value, where) {
  if (!needsContext(value)) return bind(value, { tokens: {} }, where);
  return (context) => bind(value, { obj: context.obj, pos: context.pos, tokens: { object: [context.obj.x, context.obj.y] } }, where);
}

/** A two-way crossing: `ends`, optional `via` tiles listed from the first end, and the `cross` steps. */
function betweenEntry(entry, spec, where) {
  const filled = template(spec.ends, where);
  const ends = typeof filled === "function" ? filled : () => filled;
  const cross = Array.isArray(spec.cross)
    ? { forward: spec.cross, back: spec.cross }
    : spec.cross;
  return builders.between({
    ...entry,
    ends: filled,
    cross: (from, to, context) => {
      const [first] = ends(context);
      const forward = from[0] === first[0] && from[1] === first[1];
      const via = (spec.via ?? []).slice();
      if (!forward) via.reverse();
      const tokens = { from, to, via, object: [context.obj.x, context.obj.y] };
      via.forEach((tile, index) => { tokens[`via${index}`] = tile; });
      return bind(forward ? cross.forward : cross.back, { obj: context.obj, pos: context.pos, tokens }, where);
    },
  });
}

function failOf(spec, where) {
  if (!spec) return undefined;
  for (const key of Object.keys(spec)) {
    if (!FAIL_KEYS.has(key)) throw new Error(`agility-shortcuts.json: unknown fail key "${key}" (${where})`);
  }
  const fail = { ...spec };
  if (spec.render != null) fail.render = animation(spec.render, where);
  if (spec.steps) fail.steps = template(spec.steps, where);
  return fail;
}

/**
 * A failure that still gets the player across (`cross`): the success steps, then the hit. Made
 * once the success steps are known.
 */
function crossingFail(fail, steps) {
  if (!fail?.cross) return fail;
  const hit = { hit: fail.hit ?? [1, 4] };
  return {
    ...fail,
    steps: (context) => [...(typeof steps === "function" ? steps(context) : steps), hit],
  };
}

/** `requires`: alternatives, any one of which lets the player use the shortcut. */
function requirementsOf(spec, where) {
  if (!spec) return undefined;
  if (!Array.isArray(spec) || spec.length === 0) throw new Error(`agility-shortcuts.json: requires must be a list (${where})`);
  return spec.map((alternative) => {
    for (const key of Object.keys(alternative)) {
      if (!REQUIREMENT_KEYS.has(key)) throw new Error(`agility-shortcuts.json: unknown requirement "${key}" (${where})`);
    }
    return alternative.steps ? { ...alternative, steps: template(alternative.steps, where) } : alternative;
  });
}

function build(raw, index) {
  const where = raw.name ?? `entry ${index}`;
  for (const key of Object.keys(raw)) {
    if (!ENTRY_KEYS.has(key)) throw new Error(`agility-shortcuts.json: unknown key "${key}" (${where})`);
  }
  const kinds = ["steps", "between", "stile", "script", "refuse"].filter((key) => raw[key] != null);
  if (kinds.length !== 1 && !(kinds.length === 2 && raw.script && raw.steps)) {
    throw new Error(`agility-shortcuts.json: "${where}" needs one of steps, between, stile, script or refuse`);
  }
  const entry = {
    name: raw.name,
    object: raw.object,
    level: raw.level,
    xp: raw.xp ?? 0,
  };
  if (raw.start != null) entry.start = raw.start;
  if (raw.end != null) entry.end = raw.end;
  if (raw.render != null) entry.render = animation(raw.render, where);
  if (raw.route != null) entry.route = template(raw.route, where);
  const fail = failOf(raw.fail, where);
  if (fail) entry.fail = fail;
  const requires = requirementsOf(raw.requires, where);
  if (requires) entry.requires = requires;

  let built;
  if (raw.between) {
    built = betweenEntry(entry, raw.between, where);
  } else if (raw.stile) {
    const stile = { ...raw.stile };
    if (stile.anim != null) stile.anim = animation(stile.anim, where);
    built = builders.stile({ ...entry, ...stile });
  } else if (raw.refuse) {
    built = { ...entry, precondition: () => raw.refuse, steps: [] };
  } else {
    built = { ...entry };
    if (raw.steps) built.steps = template(raw.steps, where);
    if (raw.script) {
      const script = SCRIPTS[raw.script];
      if (typeof script !== "function") throw new Error(`agility-shortcuts.json: unknown script "${raw.script}" (${where})`);
      const scripted = script(raw.params ?? {}, raw);
      Object.assign(built, scripted, scripted.fail ? { fail: { ...built.fail, ...scripted.fail } } : {});
    }
  }

  if (built.fail?.cross) built.fail = crossingFail(built.fail, built.steps);
  // An alternative's own crossing of the same two ends (a barehanded climb beside a grapple).
  if (raw.between && built.requires) {
    built.requires = built.requires.map((alternative) => (alternative.cross
      ? { ...alternative, steps: betweenEntry({}, { ...raw.between, cross: alternative.cross }, where).steps }
      : alternative));
  }

  const tiles = raw.at == null ? [null] : Array.isArray(raw.at[0]) ? raw.at : [raw.at];
  return tiles.map((at) => (at ? { ...built, at } : built));
}

const SHORTCUTS = DATA.shortcuts.flatMap(build);

module.exports = { SHORTCUTS, build };
