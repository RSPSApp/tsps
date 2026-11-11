// Run after `yarn build`: node --test tests/settings-chat-colours.test.cjs
// The chat colour rows of All Settings (opaque, transparent and split private chat): each opens the
// colour picker on its struct's default, saves into the varp the cache's colour reader (script 4181)
// reads for that row, comes back at login, and its group's reset row clears it.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { CacheIndexDat2 } = require('../dist/game/cache/codec/rs/cache/CacheIndex');
const { IndexType } = require('../dist/game/cache/codec/rs/cache/IndexType');
const { ByteBuffer } = require('../dist/game/cache/codec/rs/io/ByteBuffer');
const Settings = require('../plugins/interface/Settings.plugin');

const OPAQUE = [87, 89, 92, 94, 97, 99, 101, 103, 105, 193, 196, 198, 434];
const TRANSPARENT = [88, 90, 93, 95, 98, 100, 102, 104, 106, 194, 197, 199, 435];
const SPLIT = [91, 96];
const RESETS = { 107: OPAQUE, 108: TRANSPARENT, 109: SPLIT };
// Wiki: Settings#Chat (opaque / transparent / split defaults).
const WIKI_DEFAULTS = {
  87: 0x0000ff, 88: 0x9090ff, 89: 0x7f0000, 90: 0xbf2020, 91: 0x00ffff, 92: 0x2020ef, 93: 0x4040ff,
  94: 0x000000, 95: 0xffffff, 96: 0xffff00, 97: 0x7f0000, 98: 0xef5050, 101: 0x7f007f, 102: 0xdf20ff,
  103: 0x7e3200, 104: 0xff20df, 105: 0x007a00, 106: 0x00d300, 434: 0x006600, 435: 0xffff00,
};
const COLOUR_READER_SCRIPT = 4181;
const COLOUR_PICKER_SCRIPT = 4185;
const GET_VARP = 1;
const CANCEL = 2147483647;

const rows = new Map(); // setting id -> { category, row, params }
let readerVarps; // setting id -> varp, from script 4181

before(async () => {
  await CachePipeline.initialize();
  for (const [categoryId, structId] of CacheDefinitions.getEnumValues(422)) {
    const category = CacheDefinitions.getStructParams(Number(structId));
    const structs = [...CacheDefinitions.getEnumValues(Number(category.get(745)))].sort(([a], [b]) => a - b);
    structs.forEach(([, s], row) => {
      const params = CacheDefinitions.getStructParams(Number(s));
      rows.set(Number(params.get(1077)), { category: Number(categoryId), row, params });
    });
  }
  readerVarps = colourReaderVarps();
});

/** Script 4181's switch on the setting id: each case reads one varp (get_varp, minus one). */
function colourReaderVarps() {
  const index = CacheIndexDat2.fromStore(IndexType.DAT2.clientScript, CachePipeline.getStore());
  const buf = new ByteBuffer(new Int8Array(index.getFileSmart(COLOUR_READER_SCRIPT).data));
  const revision = CachePipeline.getActive().revision;
  const longCounts = revision !== 236 && revision >= 200;
  buf.offset = buf.length - 2;
  const switchLength = buf.readUnsignedShort();
  const end = buf.length - 2 - switchLength - (longCounts ? 16 : 12);
  buf.offset = end + 4 + (longCounts ? 12 : 8);
  const cases = new Map();
  assert.ok(buf.readUnsignedByte() >= 1, 'script 4181 has its switch');
  for (let count = buf.readUnsignedShort(); count > 0; count--) cases.set(buf.readInt(), buf.readInt());
  buf.offset = 0;
  buf.readNullString();
  const ops = [];
  while (buf.offset < end) {
    const opcode = buf.readUnsignedShort();
    if (opcode === 3) buf.readString();
    else if (opcode === 61) { buf.readInt(); buf.readInt(); }
    else if ([21, 38, 39, 62, 63].includes(opcode) || opcode >= 100) buf.readUnsignedByte();
    else { ops.push([opcode, buf.readInt()]); continue; }
    ops.push([opcode]);
  }
  // The switch is the second instruction; a case's offset is from the instruction after it.
  return new Map([...cases].map(([settingId, offset]) => {
    const [opcode, varp] = ops[2 + offset];
    assert.equal(opcode, GET_VARP, `script 4181's case ${settingId} reads a varp`);
    return [settingId, varp];
  }));
}

function allSettings() {
  const buttons = new Map();
  const logins = [];
  const ids = (id) => (Array.isArray(id) ? id : [id]);
  const api = {
    onInterfaceActionButton: (id, handler) => ids(id).forEach((one) => buttons.set(one, handler)),
    onPlayerLogin: (handler) => logins.push(handler),
    core: { CacheDefinitions, orbsGroupFor: require('../dist/net/protocol/ClientProtocol').orbsGroupFor },
  };
  Settings.register(new Proxy(api, { get: (target, prop) => (prop in target ? target[prop] : () => {}) }));
  const attributes = new Map();
  const varps = new Map();
  const scripts = [];
  const varbits = new Map();
  const opened = [];
  const flags = [];
  const sender = {
    sendVarbit: (id, value) => { varbits.set(id, value); return sender; },
    sendConfig: (id, value) => { varps.set(id, value); return sender; },
    getVarbit: () => 0,
    getVarp: (id) => varps.get(id) ?? 0,
    sendClientScript: (id, ...args) => { scripts.push([id, ...args]); return sender; },
    sendSubInterface: (target, id, type) => { opened.push([target, id, type]); return sender; },
    closeSubInterface: () => sender,
    sendInterfaceFlagsRange: (uid, from, to, value) => { flags.push([uid, from, to, value]); return sender; },
  };
  let amount;
  const player = {
    getPacketSender: () => sender,
    setAttribute: (k, v) => attributes.set(k, v),
    getAttribute: (k) => attributes.get(k),
    setEnteredAmountAction: (action) => { amount = action; },
    getEnteredAmountAction: () => amount,
  };
  const row = buttons.get((134 << 16) | 20);
  const click = (settingId) => {
    const { category, row: slot } = rows.get(settingId);
    player.setAttribute('settings-view', category);
    amount = undefined;
    scripts.length = 0;
    opened.length = 0;
    flags.length = 0;
    row({ player, slot });
    return { amount, picker: scripts.find(([id]) => id === COLOUR_PICKER_SCRIPT) };
  };
  const restore = logins.find((login) => login.name === 'restoreSettings');
  return { player, varps, varbits, opened, flags, click, restore };
}

const colourRows = [...OPAQUE, ...TRANSPARENT, ...SPLIT];

test('each chat colour row is a colour picker in the cache, in its chatbox mode\'s group', () => {
  for (const [group, ids] of [['opaque', OPAQUE], ['transparent', TRANSPARENT], ['split', SPLIT]]) {
    for (const id of ids) {
      const { params } = rows.get(id);
      assert.equal(params.get(1078), 9, `setting ${id} is a colour row`);
      assert.match(params.get(1088), new RegExp(`\\b${group}\\b`), `setting ${id} is a ${group} chat colour`);
      assert.ok(readerVarps.has(id), `script 4181 reads a varp for setting ${id}`);
    }
  }
  for (const [reset, ids] of Object.entries(RESETS)) {
    assert.equal(rows.get(Number(reset)).params.get(1078), 6, `setting ${reset} is a button`);
    assert.equal(new Set(ids.map((id) => readerVarps.get(id))).size, ids.length, 'one varp per row');
  }
});

test('the struct defaults are the Wiki\'s', () => {
  for (const [id, colour] of Object.entries(WIKI_DEFAULTS)) {
    assert.equal(rows.get(Number(id)).params.get(1230), colour, `setting ${id}`);
  }
});

test('each row opens the picker on its default, saves RGB+1 in the varp the cache reads, and Cancel keeps it', () => {
  const { varps, click } = allSettings();
  colourRows.forEach((id, n) => {
    const varp = readerVarps.get(id);
    let { amount, picker } = click(id);
    assert.ok(amount, `setting ${id} opens the colour picker`);
    assert.equal(picker?.[2], rows.get(id).params.get(1230), `setting ${id}'s picker starts on its struct default`);
    const colour = 0x010101 * (n + 1);
    amount.execute(colour);
    assert.equal(varps.get(varp), colour + 1, `setting ${id} saves into varp ${varp}`);
    ({ amount, picker } = click(id));
    assert.equal(picker?.[2], colour, 'and starts on the chosen colour next time');
    amount.execute(CANCEL);
    assert.equal(varps.get(varp), colour + 1, 'Cancel keeps the colour');
  });
  const { amount } = click(87);
  amount.execute(-1);
  assert.equal(varps.get(readerVarps.get(87)), 0, 'Default selects the struct default');
});

test('the picker opens as live opens it: an overlay in the settings popup layer, its buttons clickable', () => {
  const POPUP = (134 << 16) | 9;
  const OP1 = 1 << 1;
  const { varbits, opened, flags, click } = allSettings();
  const { amount, picker } = click(87);
  assert.deepEqual(opened, [[POPUP, 288, 1]], 'colour_pallet (288) opens as an overlay in settings:popup (134:9)');
  assert.equal(picker[1], POPUP, 'script 4185 lays the picker out in that layer');
  assert.deepEqual(flags, [[(288 << 16) | 11, 0, 152, OP1], [(288 << 16) | 8, 0, 4, OP1]], 'the palette and custom-colour buttons take op1');
  assert.equal(varbits.get(12284), 1, 'settings_colour_modal_opened is set while it is open');
  amount.execute(0x00d68b);
  assert.equal(varbits.get(12284), 0, 'and cleared once a colour is chosen');
  click(87).amount.execute(CANCEL);
  assert.equal(varbits.get(12284), 0, 'or on Cancel');
});

test('chosen colours come back at login', () => {
  const first = allSettings();
  for (const id of colourRows) first.click(id).amount.execute(0x123456);
  const next = allSettings();
  next.player.setAttribute('settings:values', first.player.getAttribute('settings:values'));
  next.restore({ player: next.player });
  for (const id of colourRows) assert.equal(next.varps.get(readerVarps.get(id)), 0x123457, `setting ${id} restored`);
});

test('each reset row clears its own group and leaves the others', () => {
  for (const [reset, ids] of Object.entries(RESETS)) {
    const { varps, click } = allSettings();
    for (const id of colourRows) click(id).amount.execute(0x123456);
    click(Number(reset));
    for (const id of colourRows) {
      const expected = ids.includes(id) ? 0 : 0x123457;
      assert.equal(varps.get(readerVarps.get(id)), expected, `reset ${reset}, setting ${id}`);
    }
  }
});
