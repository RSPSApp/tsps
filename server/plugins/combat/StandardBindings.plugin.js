/** Standard binding spell rules: individual OSRS Wiki spell pages and Swampbark armour. */
const HOLD_TICKS_KEY = 'standard-bindings:hold-ticks';
let core;
const spells = new Map();
let armour = [];

function initialize(api) {
  core = api.core;
  spells.clear();
  for (const [name,ticks] of [['BIND',8],['SNARE',16],['ENTANGLE',24]]) {
    spells.set(core.CombatSpells[name].spellId(),{spell:core.CombatSpells[name],ticks});
  }
  const E = core.Equipment, I = core.ItemIdentifiers;
  armour = [[E.HEAD_SLOT,I.SWAMPBARK_HELM],[E.BODY_SLOT,I.SWAMPBARK_BODY],[E.LEG_SLOT,I.SWAMPBARK_LEGS]];
}

function disabled(event) {
  if (event.disabled === true || !spells.has(event.spellId)) return;
  const target = event.player.getCombat().getTarget();
  const timers = target?.getTimers?.();
  if (!timers) return;
  if (timers.has(core.TimerKey.FREEZE)) {
    event.player.sendMessage('Your target is already held by a magical force.');
    event.disabled = true;
  } else if (timers.has(core.TimerKey.FREEZE_IMMUNITY)) {
    event.player.sendMessage('The target is currently immune to that spell.');
    event.disabled = true;
  }
}

function committed(event) {
  const entry = spells.get(event.spell.spellId());
  if (!entry) return;
  const equipment = event.player.getEquipment().getItems();
  const pieces = armour.filter(([slot,id])=>equipment[slot]?.getId() === id && equipment[slot].getAmount() > 0).length;
  event.context.data.set(HOLD_TICKS_KEY,entry.ticks+pieces*2);
}

function impact(event) {
  if (!event.allowed || event.handled) return;
  const entry = spells.get(event.spell?.spellId?.());
  if (!entry) return;
  event.handled = true;
  const saved = event.context?.spell === event.spell ? event.context.data.get(HOLD_TICKS_KEY) : null;
  const ticks = Number.isInteger(saved) && saved >= entry.ticks && saved <= entry.ticks+6 && (saved-entry.ticks)%2 === 0 ? saved : entry.ticks;
  // The generic service owns NPC immunity, movement interruption and the five-tick grace period.
  core.CombatFactory.freezeTicks(event.target,ticks);
}

module.exports = {
  name:'Standard Bindings',
  register(api) {
    initialize(api);
    api.onSpellDisabled(disabled);
    api.onCustomEvent('magic:cast-committed',committed);
    api.onCustomEvent('magic:utility-effect',impact);
  },
};
