// Run after `yarn build`: node --test tests/buff-bar-settings.test.cjs
// The Buff Bar rows of All Settings (Interfaces > Buff Bar): every row in that section of the cache
// is wired, names the varbit the cache's own setting reader reads for it (script 6716 for toggles,
// 3962 for the dropdown), flips only its own varbit on click, and comes back at login.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { CacheIndexDat2 } = require('../dist/game/cache/codec/rs/cache/CacheIndex');
const { PluginManager } = require('../dist/plugins/PluginManager');
const Settings = require('../plugins/interface/Settings.plugin');
const settingsJson = require('../plugins/interface/data/settings.json').settings;

const TOGGLE = 0;
const DROPDOWN = 2;
const SECTION = 5;
// setting id -> the varbit's gameval name. 124 hides the whole bar, 128 its tooltips; the rest hide one buff each.
const TOGGLES = {
  124: 'buff_bar_hidden', 128: 'buff_bar_tooltips_hidden',
  125: 'buff_home_teleport_disabled', 126: 'buff_minigame_teleport_disabled', 129: 'buff_teleblock_disabled',
  130: 'buff_charge_spell_disabled', 131: 'buff_godwars_altar_disabled', 132: 'buff_dragonfire_shield_cooldown_disabled',
  133: 'buff_imbued_heart_cooldown_disabled', 134: 'buff_vengeance_cooldown_disabled', 135: 'buff_vengeance_active_disabled',
  136: 'buff_stamina_duration_disabled', 137: 'buff_prayer_enhance_duration_disabled', 138: 'buff_overload_duration_disabled',
  139: 'buff_magic_imbue_duration_disabled', 140: 'buff_sire_stun_duration_disabled', 141: 'buff_freeze_duration_disabled',
  142: 'buff_sotd_duration_disabled', 143: 'buff_divine_potion_duration_disabled', 144: 'buff_antifire_duration_disabled',
  145: 'buff_antipoison_duration_disabled', 152: 'buff_corruption_disabled', 153: 'buff_mark_of_darkness_disabled',
  154: 'buff_shadow_veil_disabled', 155: 'buff_death_charge_disabled', 156: 'buff_ward_of_arceuus_disabled',
  157: 'buff_resurrection_disabled', 170: 'buff_ammo_disabled', 186: 'buff_poison_damage_disabled',
  208: 'buff_desert_damage_disabled', 213: 'buff_cannon_ammo_disabled', 244: 'buff_water_charges_disabled',
  246: 'buff_cannon_decay_disabled', 284: 'buff_statrenewal_duration_disabled', 285: 'buff_apmekens_sight_disabled',
  286: 'buff_akkha_burn_duration_disabled', 287: 'buff_akkha_darkness_duration_disabled',
  288: 'buff_akkha_freeze_duration_disabled', 289: 'buff_zebak_bleed_duration_disabled',
  290: 'buff_toa_midraidloot_healing_duration_disabled', 291: 'buff_toa_midraidloot_prayer_duration_disabled',
  292: 'buff_toa_midraidloot_energy_duration_disabled', 293: 'buff_toa_midraidloot_stats_duration_disabled',
  307: 'buff_wbr_exit_cave', 363: 'buff_group_gathering_woodcutting_disabled', 369: 'buff_scurrius_food_pile',
  385: 'buff_deadman_overload_potion', 388: 'buff_prayer_regeneration_potion_duration_disabled',
  390: 'buff_goading_potion_duration_disabled', 437: 'buff_surge_potion_cooldown_disabled',
  443: 'buff_bowstring_spool_disabled', 444: 'buff_ent_totems_bonus_xp_disabled',
};
const DROPDOWNS = { 364: 15350 };

const CLIENT_SCRIPTS = 12;
const TOGGLE_READER = 6716;
const DROPDOWN_READER = 3962;
const PUSH_VARBIT = 25;
const SWITCH = 60;

const handlers = {};
const catalog = new Map();
const slots = new Map();
const buffBarSection = [];

/** A client script's instructions and switch tables, as the client decodes them. */
function readScript(id) {
  const data = Buffer.from(CacheIndexDat2.fromStore(CLIENT_SCRIPTS, CachePipeline.getStore()).getArchive(id).getFile(0).data);
  const switchLength = data.readUInt16BE(data.length - 2);
  const end = data.length - 2 - switchLength - 16; // rev 241 scripts carry long local/argument counts
  let at = end + 16;
  const switches = [];
  for (let i = 0, n = data[at++]; i < n; i++) {
    const cases = new Map();
    for (let count = data.readUInt16BE(at), k = (at += 2, 0); k < count; k++, at += 8) cases.set(data.readInt32BE(at), data.readInt32BE(at + 4));
    switches.push(cases);
  }
  const ops = [];
  const operands = [];
  at = data.indexOf(0) + 1; // after the script's name
  while (at < end) {
    const op = data.readUInt16BE(at);
    at += 2;
    let operand = 0;
    if (op === 3) at = data.indexOf(0, at) + 1;
    else if (op === 61) at += 8;
    else if (op === 21 || op === 38 || op === 39 || op === 62 || op === 63 || op >= 100) operand = data[at++];
    else { operand = data.readInt32BE(at); at += 4; }
    ops.push(op);
    operands.push(operand);
  }
  return { ops, operands, switches };
}

/** The first instruction a reader script runs for one setting id. */
function readerCase(script, settingId) {
  const pc = script.ops.indexOf(SWITCH);
  const offset = script.switches[script.operands[pc]].get(settingId);
  assert.notEqual(offset, undefined, `the reader has a case for setting ${settingId}`);
  return [script.ops[pc + offset + 1], script.operands[pc + offset + 1]];
}

before(async () => {
  await CachePipeline.initialize();
  const api = {
    core: PluginManager.getCoreApi(),
    onInterfaceActionButton: (_id, fn) => { handlers[fn.name] = fn; },
    onPlayerLogin: (fn) => { handlers[fn.name] = fn; },
    onCustomEvent: (_name, fn) => { handlers[fn.name] = fn; },
    emitCustomEvent: () => {},
  };
  Settings.register(new Proxy(api, { get: (t, p) => (p in t ? t[p] : () => {}) }));
  for (const [, structId] of [...CacheDefinitions.getEnumValues(422)].sort(([a], [b]) => a - b)) {
    const category = CacheDefinitions.getStructParams(Number(structId));
    const settings = [...CacheDefinitions.getEnumValues(Number(category.get(745)))].sort(([a], [b]) => a - b);
    let section = null;
    settings.forEach(([, s], slot) => {
      const params = CacheDefinitions.getStructParams(Number(s));
      const type = Number(params.get(1078) ?? 0);
      if (type === SECTION) section = params.get(1086);
      if (!params.has(1077)) return;
      const id = Number(params.get(1077));
      catalog.set(id, type);
      slots.set(id, { category: Number(category.get(743)), slot });
      if (category.get(744) === 'Interfaces' && section === 'Buff Bar') buffBarSection.push(id);
    });
  }
});

/** A player whose varbits live in their varps, as the client keeps them. */
function player(attributes = new Map()) {
  const varps = new Map();
  const bits = (id) => {
    const { baseVar, startBit, endBit } = CacheDefinitions.getVarbit(id);
    return { baseVar, startBit, mask: (2 ** (endBit - startBit + 1) - 1) };
  };
  const sender = {
    getVarp: (id) => varps.get(id) ?? 0,
    sendConfig(id, value) { varps.set(id, value); return sender; },
    getVarbit(id) { const b = bits(id); return ((varps.get(b.baseVar) ?? 0) >>> b.startBit) & b.mask; },
    sendVarbit(id, value) {
      const b = bits(id);
      varps.set(b.baseVar, ((varps.get(b.baseVar) ?? 0) & ~(b.mask << b.startBit)) | ((value & b.mask) << b.startBit));
      return sender;
    },
    sendClientScript() { return sender; },
  };
  return { varps, attributes, getAttribute: (k) => attributes.get(k), setAttribute: (k, v) => attributes.set(k, v), getPacketSender: () => sender };
}

function click(p, settingId) {
  const { category, slot } = slots.get(settingId);
  p.setAttribute('settings-view', category);
  return handlers.clickSetting({ player: p, slot });
}

const toggleVarbits = () => Object.entries(TOGGLES).map(([id, name]) => [Number(id), CacheDefinitions.getVarbitId(name)]);

test('every row of the Buff Bar section is wired', () => {
  const wired = [...Object.keys(TOGGLES), ...Object.keys(DROPDOWNS)].map(Number).sort((a, b) => a - b);
  assert.deepEqual([...buffBarSection].sort((a, b) => a - b), wired);
});

test('each row names the varbit the cache reads for it', () => {
  const toggleReader = readScript(TOGGLE_READER);
  for (const [id, varbit] of toggleVarbits()) {
    assert.equal(catalog.get(id), TOGGLE, `setting ${id} is a toggle in the cache`);
    assert.ok(Number.isInteger(varbit), `varbit ${TOGGLES[id]} is in the cache`);
    assert.equal(settingsJson[id]?.varbit, varbit, `settings.json row ${id}`);
    assert.deepEqual(readerCase(toggleReader, id), [PUSH_VARBIT, varbit], `script ${TOGGLE_READER} reads varbit ${varbit} for setting ${id}`);
    assert.equal(settingsJson[id].default, undefined, `setting ${id} starts shown, as live`);
  }
  const dropdownReader = readScript(DROPDOWN_READER);
  for (const [id, varbit] of Object.entries(DROPDOWNS)) {
    assert.equal(catalog.get(Number(id)), DROPDOWN, `setting ${id} is a dropdown in the cache`);
    assert.equal(settingsJson[id]?.varbit, varbit);
    assert.deepEqual(readerCase(dropdownReader, Number(id)), [PUSH_VARBIT, varbit]);
  }
});

test('a row hides only its own buff, and the choice comes back at the next login', () => {
  const all = toggleVarbits();
  for (const [id, varbit] of all) {
    const p = player();
    handlers.restoreSettings({ player: p });
    assert.equal(click(p, id), true, `setting ${id} is handled`);
    for (const [otherId, other] of all) {
      assert.equal(p.getPacketSender().getVarbit(other), otherId === id ? 1 : 0, `setting ${id} leaves only varbit ${varbit} set`);
    }
    const next = player(p.attributes);
    handlers.restoreSettings({ player: next });
    assert.equal(next.getPacketSender().getVarbit(varbit), 1, `setting ${id} is restored at login`);
    click(next, id);
    assert.equal(next.getPacketSender().getVarbit(varbit), 0, `setting ${id} shows the buff again`);
  }
});

test('the Leprechaun\'s Luck dropdown sets its varbit to the option chosen and keeps it', () => {
  for (const [id, varbit] of Object.entries(DROPDOWNS)) {
    const p = player();
    click(p, Number(id));
    assert.equal(handlers.clickDropdownOption({ player: p, slot: 1 * 3 }), true);
    assert.equal(p.getPacketSender().getVarbit(varbit), 1);
    const next = player(p.attributes);
    handlers.restoreSettings({ player: next });
    assert.equal(next.getPacketSender().getVarbit(varbit), 1);
  }
});
