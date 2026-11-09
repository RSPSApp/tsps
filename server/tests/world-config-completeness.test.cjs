// Run after `yarn build`: node --test tests/world-config-completeness.test.cjs
// Every pluginConfig key the server reads must be declared by exactly one plugin (or the core),
// with a default that matches the call site; default-off and switch-table plugins are described.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { CORE_CONFIG_DECLARATIONS, validateDeclaration } = require('../dist/game/definition/WorldSettingDeclarations');

const SERVER = path.join(__dirname, '..');
const PLUGINS = path.join(SERVER, 'plugins');
const SRC = path.join(SERVER, 'src');

// ---- source scanning -------------------------------------------------------------------------

function walk(dir, ext, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, ext, out);
    else if (ext.some((e) => entry.name.endsWith(e)) && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/** Source with comments blanked (newlines kept, so offsets still map to lines). String contents stay. */
function stripComments(text) {
  let out = '';
  for (let i = 0; i < text.length;) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') { out += ' '; i++; }
    } else if (c === '/' && next === '*') {
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) { out += text[i] === '\n' ? '\n' : ' '; i++; }
      out += '  '; i += 2;
    } else if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < text.length && text[j] !== c) { if (text[j] === '\\') j++; j++; }
      out += text.slice(i, j + 1); i = j + 1;
    } else { out += c; i++; }
  }
  return out;
}

/** Splits the text after an opening "(" into top-level arguments; returns them and stops at the matching ")". */
function parseArgs(text, start) {
  const args = [];
  let depth = 0;
  let current = '';
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < text.length && text[j] !== c) { if (text[j] === '\\') j++; j++; }
      current += text.slice(i, j + 1); i = j; continue;
    }
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) {
      if (depth === 0) { if (current.trim()) args.push(current.trim()); return args; }
      depth--;
    }
    if (c === ',' && depth === 0) { args.push(current.trim()); current = ''; continue; }
    current += c;
  }
  return args;
}

const lineOf = (text, offset) => text.slice(0, offset).split('\n').length;

function stringLiteral(expr) {
  const m = /^(["'])((?:\\.|(?!\1).)*)\1$/.exec(expr) ?? /^`([^`$]*)`$/.exec(expr);
  if (!m) return undefined;
  return m.length === 3 ? m[2] : m[1];
}

/** A JSON-literal value of a default argument, or undefined when it is not one (identifiers, expressions, templates). */
function jsonLiteral(expr) {
  if (expr === undefined) return undefined;
  const text = /^'((?:\\.|[^'\\])*)'$/.test(expr) ? JSON.stringify(expr.slice(1, -1)) : expr;
  if (/^`[^`$]*`$/.test(expr)) return { value: expr.slice(1, -1) };
  try { return { value: JSON.parse(text) }; } catch { return undefined; }
}

/** A numeric constant a default names, e.g. `const MAX = 60 * 60_000`, as a literal; undefined for anything else. */
function constNumber(expr, file) {
  if (!file || !/^[\w$]+$/.test(expr)) return undefined;
  const m = new RegExp('const\\s+' + expr + '\\s*=\\s*([\\d_ *()+-]+);').exec(sourceOf(file));
  return m ? { value: Function('return ' + m[1].replace(/_/g, ''))() } : undefined;
}

const fileCache = new Map();
const sourceOf = (file) => {
  if (!fileCache.has(file)) fileCache.set(file, stripComments(fs.readFileSync(file, 'utf8')));
  return fileCache.get(file);
};

function resolveRequire(from, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(from), spec);
  for (const candidate of [base, `${base}.js`, `${base}.ts`, path.join(base, 'index.js'), path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function requiredFiles(file) {
  const out = [];
  for (const m of sourceOf(file).matchAll(/require\(\s*["'](\.[^"']+)["']\s*\)|from\s+["'](\.[^"']+)["']/g)) {
    const resolved = resolveRequire(file, m[1] ?? m[2]);
    if (resolved) out.push(resolved);
  }
  return out;
}

/** The string a constant holds: declared in this file, else in a module it requires (two levels deep). */
function constString(name, file, depth = 2, seen = new Set()) {
  if (seen.has(file)) return undefined;
  seen.add(file);
  const m = new RegExp(`(?:const|let|var)\\s+${name}\\s*(?::[^=]+)?=\\s*(["'\`][^"'\`$\\n]*["'\`])\\s*[;,\\n]`).exec(sourceOf(file));
  if (m) return stringLiteral(m[1]);
  if (depth > 0) {
    for (const next of requiredFiles(file)) {
      const found = constString(name, next, depth - 1, seen);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/** For a key passed through a parameter of a helper function, the matching calls' arguments in that file. */
function forwardedCalls(text, offset, param) {
  const head = text.slice(0, offset);
  const decls = [...head.matchAll(/function\s+(\w+)\s*\(([^)]*)\)/g)];
  const decl = decls[decls.length - 1];
  if (!decl) return null;
  const params = decl[2].split(',').map((p) => p.trim().replace(/\s*=.*$/, ''));
  const index = params.indexOf(param);
  if (index < 0) return null;
  const calls = [];
  for (const m of text.matchAll(new RegExp(`(?<![\\w.])${decl[1]}\\s*\\(`, 'g'))) {
    if (m.index === decl.index + decl[0].indexOf(decl[1]) ) continue;
    if (/function\s+$/.test(text.slice(Math.max(0, m.index - 10), m.index))) continue;
    const args = parseArgs(text, m.index + m[0].length);
    if (args.length > index) calls.push({ keyExpr: args[index], defaultExpr: args[index + 1], offset: m.index });
  }
  return calls;
}

const CALL = /getPluginConfig\s*(?:<[^>()]*>)?\s*(?:\?\.)?\s*\(/g;
// Where getPluginConfig is defined and documented: only literal-key calls count there.
const DEFINITION_FILES = ['PluginManager.ts', 'PluginTypes.ts'];

/** Every getPluginConfig read: { key, defaultExpr, where } or { unresolved, where }. */
function scanReads() {
  const reads = [];
  for (const file of [...walk(PLUGINS, ['.js']), ...walk(SRC, ['.ts'])]) {
    const text = sourceOf(file);
    const isDefinitionFile = DEFINITION_FILES.includes(path.basename(file));
    for (const m of text.matchAll(CALL)) {
      const args = parseArgs(text, m.index + m[0].length);
      const where = `${path.relative(SERVER, file).split(path.sep).join('/')}:${lineOf(text, m.index)}`;
      if (args.length === 0 || /^\w+\s*:\s*\w/.test(args[0])) continue; // a signature, not a read
      const literal = stringLiteral(args[0]);
      if (isDefinitionFile && literal === undefined) continue;
      if (literal !== undefined) { reads.push({ key: literal, defaultExpr: args[1], where, file }); continue; }
      const name = /^(?:[\w$]+\.)*([\w$]+)$/.exec(args[0])?.[1];
      const resolved = name ? constString(name, file) : undefined;
      if (resolved !== undefined) { reads.push({ key: resolved, defaultExpr: args[1], where, file }); continue; }
      const forwarded = name && /^\w+$/.test(args[0]) ? forwardedCalls(text, m.index, name) : null;
      const keys = forwarded?.map((call) => {
        const callName = /^(?:[\w$]+\.)*([\w$]+)$/.exec(call.keyExpr)?.[1];
        const key = stringLiteral(call.keyExpr) ?? (callName ? constString(callName, file) : undefined);
        return key === undefined ? null : { key, defaultExpr: call.defaultExpr, where, file };
      });
      if (keys?.length && keys.every(Boolean)) reads.push(...keys);
      else reads.push({ unresolved: args[0], where });
    }
  }
  return reads;
}

// ---- declarations ----------------------------------------------------------------------------

const rel = (file) => path.relative(PLUGINS, file).split(path.sep).join('/');

/** Plugin modules as the loader requires them: every top-level *.plugin.js under server/plugins. */
function loadPluginModules() {
  const modules = [];
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    for (const file of walk(PLUGINS, ['.plugin.js'])) {
      const loaded = require(file);
      const mod = loaded?.default ?? loaded;
      if (mod && typeof mod === 'object' && typeof mod.name === 'string') modules.push({ file: rel(file), mod });
    }
  } finally { console.warn = originalWarn; }
  return modules;
}

const modules = loadPluginModules();

function declarations() {
  const byKey = new Map();
  for (const [key, decl] of Object.entries(CORE_CONFIG_DECLARATIONS)) byKey.set(key, { decl, owners: ['core'] });
  for (const { file, mod } of modules) {
    for (const [key, decl] of Object.entries(mod.config ?? {})) {
      const entry = byKey.get(key) ?? { decl, owners: [] };
      entry.owners.push(file);
      byKey.set(key, entry);
    }
  }
  return byKey;
}

const reads = scanReads();
const declared = declarations();

// ---- tests -----------------------------------------------------------------------------------

test('the scanner finds the reads it should (guards against matching nothing)', () => {
  const keys = new Set(reads.filter((r) => r.key).map((r) => r.key));
  for (const key of ['Prayer:sequentialBurying', 'league:type', 'commands:permissions', 'CrossFloor:visibility', 'DisplayName:holdDays']) {
    assert.ok(keys.has(key), `scanner missed ${key}`);
  }
  assert.ok(keys.size >= 25, `only ${keys.size} keys found`);
});

test('every read key is declared', () => {
  const unresolved = reads.filter((r) => r.unresolved !== undefined).map((r) => `${r.where}: key "${r.unresolved}" cannot be resolved`);
  const missing = reads.filter((r) => r.key && !declared.has(r.key)).map((r) => `${r.where}: ${r.key} has no declaration`);
  assert.deepEqual([...unresolved, ...missing], []);
});

test('each key is declared once and every declaration is valid', () => {
  const problems = [];
  for (const [key, { decl, owners }] of declared) {
    if (owners.length > 1) problems.push(`${key} declared by ${owners.join(' and ')}`);
    problems.push(...validateDeclaration(key, decl));
  }
  assert.deepEqual(problems, []);
});

test('every declared plugin key is read somewhere', () => {
  const read = new Set(reads.filter((r) => r.key).map((r) => r.key));
  const stale = [...declared.keys()].filter((key) => !read.has(key));
  assert.deepEqual(stale, []);
});

test('inline defaults match the declared default', () => {
  const problems = [];
  for (const r of reads.filter((x) => x.key && declared.has(x.key))) {
    if (r.defaultExpr === undefined) continue; // the call site supplies no default
    const { decl } = declared.get(r.key);
    const literal = jsonLiteral(r.defaultExpr) ?? constNumber(r.defaultExpr, r.file);
    if (literal === undefined) {
      if (decl.defaultText === undefined) problems.push(`${r.where}: ${r.key} default "${r.defaultExpr}" is not a literal, so it needs defaultText`);
    } else if (decl.default !== undefined) {
      if (JSON.stringify(literal.value) !== JSON.stringify(decl.default)) {
        problems.push(`${r.where}: ${r.key} reads default ${JSON.stringify(literal.value)} but declares ${JSON.stringify(decl.default)}`);
      }
    } else if (literal.value !== '') {
      // An empty string means "unset"; it is described in words (e.g. a date option).
      problems.push(`${r.where}: ${r.key} reads default ${JSON.stringify(literal.value)} but declares only defaultText`);
    }
  }
  assert.deepEqual(problems, []);
});

const SWITCH_TABLE = ['TutorialIsland', 'VoiceChat', 'DuelStaking', 'Freeze Timer', 'FriendsList', 'GrandExchange',
  'SideJournalDefaults', 'IgnoreList', 'Vengeance Timer'];

test('default-off plugins and the switches-table plugins have a description', () => {
  const needing = modules.filter(({ mod }) => mod.enabled === false || SWITCH_TABLE.includes(mod.name));
  for (const name of SWITCH_TABLE) assert.ok(needing.some(({ mod }) => mod.name === name), `plugin ${name} not found`);
  const missing = needing.filter(({ mod }) => typeof mod.description !== 'string' || !mod.description.trim()).map(({ file }) => file);
  assert.deepEqual(missing, []);
});
