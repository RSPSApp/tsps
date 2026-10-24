const Common = require('./Common.ElementalTomes');
const CAST_DATA_KEY = 'elemental-tomes:cast';
const elements = new Map();
const curses = new Set();
const statCurses = new Set();

function initialize(api) {
  elements.clear(); curses.clear(); statCurses.clear();
  for (const [name, spell] of Object.entries(api.core.CombatSpells)) {
    const match = /^(FIRE|WATER|EARTH)_(STRIKE|BOLT|BLAST|WAVE|SURGE)$/.exec(name);
    if (match) elements.set(spell.spellId(), match[1].toLowerCase());
  }
  for (const name of ['CONFUSE','WEAKEN','CURSE','VULNERABILITY','ENFEEBLE','STUN']) {
    const id = api.core.CombatSpells[name].spellId();
    curses.add(id); statCurses.add(id);
  }
  for (const name of ['BIND','SNARE','ENTANGLE']) curses.add(api.core.CombatSpells[name].spellId());
}
function current(player) {
  const worn = Common.getEquipped(player);
  if (!worn || worn.state.charges <= 0) return null;
  return Object.freeze({ element:worn.definition.element,
    searing:worn.state.pageId === worn.definition.specialPageId });
}
function snapshot(request) {
  if (request.context != null) {
    if (request.context.spell !== request.spell || !(request.context.data instanceof Map)) return null;
    return request.context.data.get(CAST_DATA_KEY) ?? null;
  }
  return current(request.attacker);
}
function matching(spell, state) {
  return state && elements.get(spell?.spellId?.()) === state.element;
}
function chargedCast(spell, state) {
  return matching(spell,state) || (state?.element === 'water' && curses.has(spell?.spellId?.()));
}
function committed(event) {
  const worn = Common.getEquipped(event.player);
  const state = current(event.player);
  event.context.data.set(CAST_DATA_KEY, state);
  if (!worn || !chargedCast(event.spell,state)) return;
  Common.set(worn.item,worn.definition,worn.state.charges-1,worn.state.pageId);
  Common.refresh(event.player);
}
function supplyRune(event) {
  const worn = Common.getEquipped(event.player);
  if (worn?.state.charges > 0 && event.runeId === worn.definition.rune) event.bypass = true;
}
function hitBounds(request) {
  if (!request.attacker?.isPlayer?.()) return;
  const state = snapshot(request);
  if (!matching(request.spell,state)) return;
  const beforeTome = request.maxHit;
  if (state.searing) request.minHit = Math.max(request.minHit,Math.floor(beforeTome/10));
  const pvp = request.target?.isPlayer?.() === true;
  const percent = pvp && state.element === 'fire' ? 50 : pvp && state.element === 'water' ? 20 : 10;
  request.maxHit = Math.floor(beforeTome*(100+percent)/100);
}
function accuracy(request) {
  if (!request.attacker?.isPlayer?.()) return;
  const state = snapshot(request);
  if (state?.element !== 'water') return;
  const curse = curses.has(request.spell?.spellId?.());
  if (!curse && !matching(request.spell,state)) return;
  const percent = curse || request.target?.isPlayer?.() ? 20 : 10;
  request.attackRoll = Math.floor(request.attackRoll*(100+percent)/100);
}
function curseStrength(request) {
  if (!request.attacker?.isPlayer?.()) return;
  // The enhanced percentage is integral: 5% becomes 7%, not 7.5% (Tome of Water Wiki).
  if (snapshot(request)?.element === 'water' && statCurses.has(request.spell?.spellId?.())) request.percent = Math.floor(request.percent * 1.5);
}
function attach(api) {
  api.onCustomEvent('magic:cast-committed',committed);
  api.onSpellRuneBypass(supplyRune);
  api.onCustomEvent('combat:magic-hit-bounds',hitBounds);
  api.onCustomEvent('combat:magic-attack-roll-modify',accuracy);
  api.onCustomEvent('combat:stat-drain-modify',curseStrength);
}
module.exports = { initialize, attach, CAST_DATA_KEY };
