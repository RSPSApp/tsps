// Run after `yarn build`: node --test tests/npc-dialogues.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { pickVariant, aliasKeys, flatten, startDialogue, speakerIdIndex } = require('../plugins/npcs/NpcDialogues.plugin');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/definitions/npc-dialogues.json'), 'utf8'));
const aliases = aliasKeys(data);
const talk = (name) => {
  const record = pickVariant(data[name]) ? data[name] : data[aliases.get(name)];
  return pickVariant(record);
};

test('a variant is chosen when the dump names no default', () => {
  assert.equal(pickVariant({ default: 'b', variants: { a: [{ npc: 'a' }], b: [{ npc: 'b' }] } })[0].npc, 'b');
  assert.equal(pickVariant({ default: null, variants: { 'overhead-x': [1], 'standard-y': [2] } })[0], 2);
  assert.equal(pickVariant({ default: null, variants: { 'if-poisoned': [3] } })[0], 3);
  // Overhead shouts are not a conversation; stay silent rather than yell at the player.
  assert.equal(pickVariant({ default: null, variants: { 'overhead-x': [1] } }), undefined);
  assert.equal(pickVariant(undefined), undefined);
  // Larran and Pox are variant-only records that used to resolve to nothing.
  for (const name of ['Larran', 'Pox', 'Emblem Trader', 'Ferox', 'Lisa']) assert.ok(talk(name)?.length, name);
});

test('cache names reach disambiguated wiki keys', () => {
  assert.equal(aliases.get('Hops'), 'Hops (Biohazard)');
  // A bare key wins when it is usable; "Guard" is overhead-only, so the alias takes over.
  assert.equal(pickVariant(data['Guard']), undefined);
  for (const name of ['Hops', 'Guard', 'Bartender', 'Wizard']) assert.ok(talk(name)?.length, name);
});

test('canonical speaker names take precedence over earlier transcript aliases', () => {
  const index = {
    8906: [{ page: 'Transcript:Lady Carys Hefin' }],
    8907: [{ page: 'Transcript:Lady Carys Hefin' }],
    8908: [{ page: 'Transcript:Lady Carys Hefin' }],
    20: [{ page: 'Transcript:Hops (Biohazard)' }],
  };
  const names = { 8906: 'Elf Hermit', 8907: 'Lady Carys Hefin', 8908: 'Lady Carys Hefin', 20: 'Hops' };
  const speakers = speakerIdIndex(index, { forId: id => ({ getName: () => names[id] }) });
  assert.equal(speakers.get('Lady Carys Hefin'), 8907);
  assert.equal(speakers.get('Elf Hermit'), 8906);
  assert.equal(speakers.get('Hops (Biohazard)'), 20);
});

test('prose conditions take their first branch and dead jumps fall through', () => {
  const steps = flatten([
    { npc: 'hello' },
    { type: 'condition', text: 'If A:', steps: [{ npc: 'branch A' }, { type: 'jump', id: 'nowhere' }] },
    { type: 'condition', text: 'If B:', steps: [{ npc: 'branch B' }] },
    { npc: 'shared tail' },
  ]);
  assert.deepEqual(steps.map((step) => step.npc), ['hello', 'branch A', 'shared tail']);
  assert.deepEqual(flatten([{ type: 'condition', steps: [{ type: 'condition', steps: [{ npc: 'deep' }] }] }]),
    [{ npc: 'deep' }]);
  // Perdu opens on a condition, so the whole conversation used to be unreachable.
  assert.equal(flatten(talk('Perdu'))[0].npc,
    "It seems you're missing out on some valuable experience. Would you like it?");
});

test('inline jump bodies play and missing external jumps still fall through', () => {
  assert.deepEqual(flatten([
    { player: 'before the jump' },
    { type: 'jump', reference: 'continue', steps: [{ npc: 'inline continuation' }] },
    { npc: 'tail' },
  ]), [
    { player: 'before the jump' },
    { type: 'jump_to', steps: [{ npc: 'inline continuation' }] },
    { npc: 'tail' },
  ]);
  assert.deepEqual(flatten([
    { type: 'jump', reference: 'continue', id: 'missing-target' },
    { npc: 'external jump fallthrough' },
  ]), [{ npc: 'external jump fallthrough' }]);
});

test('a condition branch that continues reaches the next sibling check', () => {
  const steps = flatten([
    {
      type: 'condition', text: 'If high combat:', steps: [
        { npc: 'very strong' },
        {
          type: 'choice',
          options: [
            { text: 'no', steps: [{ player: 'no' }, { type: 'jump', reference: 'continues' }] },
            { text: 'yes', steps: [{ player: 'yes' }, { type: 'end' }] },
          ],
        },
      ],
    },
    { type: 'condition', text: "If no assignment:", steps: [{ npc: 'assigned' }] },
    { type: 'condition', text: 'If has assignment:', steps: [{ npc: 'still hunting' }] },
  ]);
  // The detour keeps its prompt, then falls through to the first following check.
  assert.deepEqual(steps.map((step) => step.npc).filter(Boolean), ['very strong', 'assigned']);
});

test('a nested "jump above" reaches an unselected sibling instead of looping', () => {
  // The nested option's jump is written "above"; its target is the sibling of the
  // same text on the outer menu, which has not been selected yet.
  const tree = [
    { npc: 'I need help.' },
    {
      type: 'choice', prompt: 'Q1', options: [
        {
          text: 'Outer', steps: [
            { npc: 'nested' },
            {
              type: 'choice', prompt: 'Q2', options: [
                { text: "What's wrong?", steps: [{ type: 'jump', reference: 'above' }] },
                { text: 'Nothing', steps: [{ type: 'end' }] },
              ],
            },
          ],
        },
        {
          text: "What's wrong?", steps: [
            { npc: 'detail' },
            {
              type: 'choice', prompt: 'Q3', options: [
                { text: 'Start?', steps: [{ npc: 'starting' }] },
                { text: 'No', steps: [{ type: 'end' }] },
              ],
            },
          ],
        },
      ],
    },
  ];

  const script = ['Outer', "What's wrong?", 'No'];
  const prompts = [];
  const player = {
    getDialogueManager: () => ({
      reset() {},
      startDialogues(chain) {
        for (const entry of [...chain.getDialogues().values()].sort((a, b) => a.getIndex() - b.getIndex())) {
          try { entry.send(player); } catch { /* unwired dialogue entries are fine here */ }
        }
      },
    }),
    getPacketSender: () => ({ sendInterfaceRemoval() {} }),
    sendMessage() {},
  };
  const definition = { getName: () => 'Cook', getId: () => 4626 };
  const api = {
    emitCustomEvent() {},
    sendMultiChatboxPrompt(_player, title, ...pairs) {
      assert.ok(prompts.length < 10, 'dialogue looped');
      const options = [];
      for (let i = 0; i < pairs.length; i += 2) options.push({ text: pairs[i], cb: pairs[i + 1] });
      prompts.push(title);
      const pick = options.find((option) => option.text === script[prompts.length - 1]) ?? options[0];
      pick.cb();
      return true;
    },
  };
  const event = { player, npc: { getId: () => 4626 }, npcId: 4626, definition };
  startDialogue(api, event, tree, {}, { player, npc: event.npc, npcId: 4626, definition, pages: [] });

  assert.deepEqual(prompts, ['Q1', 'Q2', 'Q3']);
});

test('action dialogue events carry their Wiki step id', () => {
  const actions = [];
  const player = {
    getDialogueManager: () => ({
      reset() {},
      startDialogues(chain) {
        for (const entry of [...chain.getDialogues().values()].sort((a, b) => a.getIndex() - b.getIndex())) {
          try { entry.send(player); } catch { /* action callbacks need no client */ }
        }
      },
    }),
    getPacketSender: () => ({ sendInterfaceRemoval() {} }),
    sendMessage() {},
  };
  const definition = { getName: () => 'Bob', getId: () => 6750 };
  const event = { player, npc: null, npcId: 6750, definition };
  const api = {
    emitCustomEvent(name, request) {
      if (name !== 'npc-dialogue:action') return;
      actions.push(request.stepId);
      request.handled = true;
    },
  };
  startDialogue(api, event, [{ type: 'action', text: 'The memory returns.', id: 'memory-restored' }], {},
    { ...event, pages: [] });
  assert.deepEqual(actions, ['memory-restored']);
});

test('a random alternative ending "same as above" repeats the previous alternative, not another menu', () => {
  const said = [];
  const acted = [];
  const player = {
    getDialogueManager: () => ({
      reset() {},
      startDialogues(chain) {
        for (const entry of [...chain.getDialogues().values()].sort((a, b) => a.getIndex() - b.getIndex())) {
          if (entry.text) said.push(String(entry.text));
          try { entry.send(player); } catch { /* unwired dialogue entries are fine here */ }
        }
      },
    }),
    getPacketSender: () => ({ sendInterfaceRemoval() {} }),
    sendMessage() {},
  };
  const api = {
    emitCustomEvent(name, payload) {
      if (name === 'npc-dialogue:action' && payload.stepId) {
        acted.push(payload.stepId);
        payload.handled = true;
      }
    },
    sendMultiChatboxPrompt() { return true; },
  };
  const tree = [{
    type: 'random',
    options: [
      {
        text: 'Support 1',
        steps: [
          { type: 'line', speaker: 'Ghost villager', text: 'Most certainly, I will.' },
          { type: 'message', text: 'The ghost signs your petition.', id: 'sign' },
        ],
      },
      {
        text: 'Support 2',
        steps: [
          { type: 'line', speaker: 'Ghost villager', text: "I'll do anything that annoys Necrovarus." },
          { type: 'jump', reference: 'above' },
        ],
      },
    ],
  }];
  const definition = { getName: () => 'Ghost villager', getId: () => 2998 };
  const event = { player, npc: { getId: () => 2998 }, npcId: 2998, definition };
  const originalRandom = Math.random;
  Math.random = () => 0.99; // always pick Support 2
  try {
    startDialogue(api, event, tree, {}, { player, npc: event.npc, npcId: 2998, definition, pages: [] });
  } finally {
    Math.random = originalRandom;
  }
  assert.deepEqual(acted, ['sign'], "the jump lands on the previous alternative's action");
  assert.ok(said.includes("I'll do anything that annoys Necrovarus."));
  assert.ok(!said.includes('Most certainly, I will.'), "the previous alternative's line is not replayed");
});

test('a jump after a repeated question carries on as that question, judged when it is reached', () => {
  // Percy's unlocks: buying, then asking again, must not offer what was just bought, and the
  // branch that jumps back into itself ("That'll be 200 nuggets") must not recurse forever.
  const { PluginManager } = require('../dist/plugins/PluginManager');
  let unlocked = false;
  const condition = { pluginName: 'test', handler: ({ text }) => (text === 'If locked:' ? !unlocked : text === 'If unlocked:' ? unlocked : null) };
  PluginManager.npcDialogueConditionHooks.unshift(condition);
  const said = [];
  const picks = ['Anything to unlock?', 'Buy', 'Anything to unlock?'];
  const player = {
    getDialogueManager: () => ({
      reset() {},
      startDialogues(chain) {
        for (const entry of [...chain.getDialogues().values()].sort((a, b) => a.getIndex() - b.getIndex())) {
          if (entry.text) said.push(entry.text);
          try { entry.send(player); } catch { /* unwired dialogue entries are fine here */ }
        }
      },
    }),
    getPacketSender: () => ({ sendInterfaceRemoval() {} }),
    sendMessage() {},
  };
  const api = {
    emitCustomEvent(name, payload) {
      if (name === 'npc-dialogue:action' && payload.stepId === 'pay' && payload.kind === 'message') unlocked = true;
    },
    sendMultiChatboxPrompt(_player, _title, ...pairs) {
      const options = [];
      for (let i = 0; i < pairs.length; i += 2) options.push({ text: pairs[i], cb: pairs[i + 1] });
      const pick = options.find((option) => option.text === picks[0]);
      if (!pick) return true;
      picks.shift();
      pick.cb();
      return true;
    },
  };
  const question = (steps) => ({ text: 'Anything to unlock?', steps: [{ player: 'Anything to unlock?' }, ...steps] });
  const tree = [{
    type: 'choice', prompt: 'Top', options: [question([
      {
        type: 'condition', text: 'If locked:', steps: [{
          type: 'choice', prompt: 'Unlocks', options: [
            { text: 'Buy', steps: [{ type: 'message', text: 'You pay.', id: 'pay' }, { player: 'Anything to unlock?' }, { type: 'jump', reference: 'below' }] },
            { text: 'Too dear', steps: [{ npc: "That'll cost ye." }, { player: 'Anything to unlock?' }, { type: 'jump', reference: 'above' }] },
          ],
        }],
      },
      { type: 'condition', text: 'If unlocked:', steps: [{ npc: 'Ye have it all.' }] },
    ])],
  }];
  const definition = { getName: () => 'Percy', getId: () => 6562 };
  const event = { player, npc: { getId: () => 6562 }, npcId: 6562, definition };
  try {
    startDialogue(api, event, tree, {}, { player, npc: event.npc, npcId: 6562, definition, pages: [] });
  } finally {
    PluginManager.npcDialogueConditionHooks.splice(PluginManager.npcDialogueConditionHooks.indexOf(condition), 1);
  }
  assert.equal(unlocked, true);
  assert.deepEqual(said.filter((line) => line === 'Ye have it all.'), ['Ye have it all.'], 'the jump saw the purchase');
});

test('an unreplayable menu jump ends the branch instead of leaking the next step', () => {
  const steps = flatten([
    {
      type: 'condition', text: 'If A:', steps: [
        { npc: 'thanks' },
        { type: 'jump', reference: 'other', id: 'x' },
      ],
    },
    { type: 'unavailable' },
  ], { resolveJump: (step) => (/^other/i.test(step.reference) ? 'end' : null) });
  assert.deepEqual(steps.map((step) => step.npc ?? step.type), ['thanks', 'end']);
});

test('menu navigation jumps become replayable gomenu steps', () => {
  const steps = flatten([{ type: 'jump', reference: 'other' }], {
    resolveJump: (step) => (step.reference === 'other' ? { menu: { marker: true } } : null),
  });
  assert.equal(steps.length, 1);
  assert.equal(steps[0].type, 'gomenu');
  assert.deepEqual(steps[0].menu, { marker: true });
});

test('an action step is dispatched once with its transcript step id', () => {
  const actions = [];
  const said = [];
  const player = {
    getDialogueManager: () => ({
      reset() {},
      startDialogues(chain) {
        for (const entry of [...chain.getDialogues().values()].sort((a, b) => a.getIndex() - b.getIndex())) {
          if (entry.text) said.push(String(entry.text));
          try { entry.send(player); } catch { /* unwired dialogue entries are fine here */ }
        }
      },
    }),
    getPacketSender: () => ({ sendInterfaceRemoval() {} }),
    sendMessage() {},
  };
  const definition = { getName: () => 'Guard', getId: () => 1 };
  const event = { player, npc: { getId: () => 1 }, npcId: 1, definition };
  startDialogue({
    emitCustomEvent(name, payload) { if (name === 'npc-dialogue:action') actions.push(payload); },
  }, event, [
    { type: 'action', id: 'quest-step-1', action: 'open the gate' },
    { npc: 'The gate swings open.' },
  ], {}, { player, npc: event.npc, npcId: 1, definition, pages: [] });

  assert.equal(actions.length, 1);
  assert.equal(actions[0].stepId, 'quest-step-1');
  assert.deepEqual(said, ['The gate swings open.']);
});

test('a shop split into versions opens the version a plugin picks, else its Default (#831)', () => {
  // Ned's "Yes, I would like some rope." names the shop page; the dump lists its versions.
  const find = (nodes) => {
    for (const node of nodes ?? []) {
      if (node.action === 'open_shop') return node;
      const nested = find(node.steps) ?? find((node.options ?? []).flatMap((option) => option.steps ?? []));
      if (nested) return nested;
    }
    return undefined;
  };
  const step = find(talk('Ned'));
  assert.deepEqual(step.shops, ["Ned's Handmade Rope (100% Wool) (Default)", "Ned's Handmade Rope (100% Wool) (Fremennik Isles)"]);

  const { ShopDefinition } = require('../dist/game/definition/ShopDefinition');
  const { ShopManager } = require('../dist/game/model/container/shop/ShopManager');
  const all = ShopDefinition.all;
  const open = ShopManager.open;
  const opened = [];
  ShopDefinition.all = () => step.shops.map((name, index) => ({ getName: () => name, getId: () => 1249 + index }));
  ShopManager.open = (player, id) => { opened.push(id); return true; };
  try {
    const player = {
      getDialogueManager: () => ({ reset() {}, startDialogues(chain) { for (const entry of chain.getDialogues().values()) try { entry.send(player); } catch { /* unwired */ } } }),
      getPacketSender: () => ({ sendInterfaceRemoval() {} }),
      sendMessage() {},
    };
    const definition = { getName: () => 'Ned', getId: () => 4280 };
    const event = { player, npc: { getId: () => 4280 }, npcId: 4280, definition };
    const run = (pick) => startDialogue({
      emitCustomEvent(name, payload) { if (name === 'npc-dialogue:shop' && pick) payload.shop = pick; },
    }, event, [step], {}, { player, npc: event.npc, npcId: 4280, definition, pages: [] });
    run(null);
    run(step.shops[1]);
  } finally {
    ShopDefinition.all = all;
    ShopManager.open = open;
  }
  assert.deepEqual(opened, [1249, 1250]);
});

test('"previous" on the first menu replays it instead of ending the dialogue', () => {
  // Ulsquire's "What did you find out about the remains?" ends in {{tact|previous}}:
  // the player must land back on the question menu, not have the chat closed.
  const tree = [
    { npc: 'Hello.' },
    {
      type: 'choice', prompt: 'Q1', options: [
        { text: 'Ask', steps: [{ npc: 'Answer.' }, { type: 'jump', reference: 'previous' }] },
        { text: 'Bye', steps: [{ type: 'end' }] },
      ],
    },
  ];
  const script = ['Ask', 'Bye'];
  const prompts = [];
  const player = {
    getDialogueManager: () => ({
      reset() {},
      startDialogues(chain) {
        for (const entry of [...chain.getDialogues().values()].sort((a, b) => a.getIndex() - b.getIndex())) {
          try { entry.send(player); } catch { /* unwired dialogue entries are fine here */ }
        }
      },
    }),
    getPacketSender: () => ({ sendInterfaceRemoval() {} }),
    sendMessage() {},
  };
  const api = {
    emitCustomEvent() {},
    sendMultiChatboxPrompt(_player, title, ...pairs) {
      assert.ok(prompts.length < 5, 'dialogue looped');
      const options = [];
      for (let i = 0; i < pairs.length; i += 2) options.push({ text: pairs[i], cb: pairs[i + 1] });
      prompts.push(title);
      const pick = options.find((option) => option.text === script[prompts.length - 1]) ?? options[0];
      pick.cb();
      return true;
    },
  };
  const definition = { getName: () => 'Ulsquire', getId: () => 1288 };
  const event = { player, npc: { getId: () => 1288 }, npcId: 1288, definition };
  startDialogue(api, event, tree, {}, { player, npc: event.npc, npcId: 1288, definition, pages: [] });
  assert.deepEqual(prompts, ['Q1', 'Q1']);
});

test('returning to a menu abandons the old handout branch and keeps the menu continuation once', () => {
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const condition = { pluginName: 'test', handler: ({ text }) => text === 'If already held:' ? true : null };
  PluginManager.npcDialogueConditionHooks.unshift(condition);
  const tree = [
    { type: 'choice', options: [
      { text: 'Acid', steps: [
        { type: 'condition', text: 'If already held:', steps: [{ npc: 'You already have some.' }, { type: 'jump', reference: 'other' }] },
        { type: 'action', id: 'handout', text: 'Give acid' },
      ] },
      { text: 'Bye' },
    ] },
    { type: 'action', id: 'after-menu', text: 'Menu finished' },
  ];
  const actions = [], picks = ['Acid', 'Bye'];
  const player = {
    getDialogueManager: () => ({ reset() {}, startDialogues(chain) {
      for (const entry of [...chain.getDialogues().values()].sort((a, b) => a.getIndex() - b.getIndex())) {
        if (entry.constructor.name === 'ActionDialogue') return entry.send(player);
      }
    } }),
    getPacketSender: () => ({ sendInterfaceRemoval() {} }), sendMessage() {},
  };
  const definition = { getName: () => 'Daer Krand', getId: () => 9409 };
  const event = { player, npcId: 9409, definition, npc: null };
  const api = {
    emitCustomEvent(name, request) { if (name === 'npc-dialogue:action' && request.stepId) actions.push(request.stepId); },
    sendMultiChatboxPrompt(_player, _title, ...pairs) {
      const pick = picks.shift();
      assert.ok(pick, 'the menu did not end');
      for (let i = 0; i < pairs.length; i += 2) if (pairs[i] === pick) { pairs[i + 1](); return true; }
      assert.fail(`missing option ${pick}`);
    },
  };
  try {
    startDialogue(api, event, tree, {}, { ...event, pages: [] });
    assert.deepEqual(actions, ['after-menu']);
  } finally {
    PluginManager.npcDialogueConditionHooks.splice(PluginManager.npcDialogueConditionHooks.indexOf(condition), 1);
  }
});

test('a slayer master assigns from a slugged action, not literal prose', () => {
  const steps = talk('Krystilia');
  const found = { action: false, tip: false, spoken: false };
  const walk = (nodes) => {
    for (const node of nodes ?? []) {
      if (node.action === 'slayer_assignment') {
        found.action = true;
        assert.equal(node.target, 'Krystilia');
      }
      if (node.action === 'slayer_task_tip') found.tip = true;
      if (typeof node.npc === 'string' && node.npc.includes('Your new task is to kill')) found.spoken = true;
      walk(node.steps);
      for (const option of node.options ?? []) walk(option.steps);
    }
  };
  walk(steps);
  assert.ok(found.action, 'the assignment step carries the slug');
  assert.ok(found.tip, 'the task tip step carries the slug');
  // The placeholder line must not survive as something a player can read.
  assert.equal(found.spoken, false);
});

test('Lumbridge tutors hand out what their transcripts say', () => {
  const { Skill } = require('../dist/game/model/Skill');
  const { ItemIdentifiers: I } = require('../dist/util/ItemIdentifiers');
  const { NpcIdentifiers: N } = require('../dist/util/NpcIdentifiers');
  const hooks = {};
  require('../plugins/npcs/Tutors.plugin').register({
    core: {
      Skill, ItemIdentifiers: I, NpcIdentifiers: N, ItemDefinition: { forId: () => ({ getName: () => 'Thing' }) },
      Equipment: require('../dist/game/model/container/impl/Equipment').Equipment,
      Sounds: { sendSound() {} }, Sound: { PICK_UP_ITEM: 0 },
      ItemOnGroundManager: { deregister(groundItem) { groundItem.deregistered = true; } },
    },
    persistAttribute() {}, onNpcDialogueVariant() {}, onItemOnNpc() {},
    onNpcDialogueCondition(handler) { hooks.condition = handler; },
    onCustomEvent(name, handler) { hooks[name] = handler; },
    onNpcInteraction(name, actions) { hooks[name] = actions; },
    onGroundItemPickup(handler) { hooks.pickup = handler; },
    emitCustomEvent(_name, request) { hooks.started = request.variant; },
  });
  const container = (items = {}) => {
    const map = new Map(Object.entries(items).map(([id, n]) => [Number(id), n]));
    return { getAmount: (id) => map.get(id) ?? 0, contains: (id) => map.has(id), adds: (id, n) => map.set(id, (map.get(id) ?? 0) + n),
      getFreeSlots: () => 28 - map.size, getItems: () => [] };
  };
  const player = (bank = {}) => {
    const attributes = {};
    const inventory = container();
    return { inventory, messages: [], getInventory: () => inventory, getEquipment: () => container(), getBanks: () => [container(bank)],
      getAttribute: (key) => attributes[key], setAttribute: (key, value) => { attributes[key] = value; },
      sendMessage(text) { this.messages.push(text); }, getSkillManager: () => ({ getMaxLevel: () => 1 }) };
  };
  // Plays a transcript the way startDialogue drives the hooks, taking the menu option `pick`.
  const play = (p, npcId, steps, pick) => {
    const queue = flatten(steps, { resolveCondition: (step) => hooks.condition({ player: p, npcId, text: step.text }) });
    for (const step of queue) {
      if (step.type === 'end') return;
      if (step.type === 'choice') return play(p, npcId, step.options.find((option) => option.text.startsWith(pick)).steps);
      const line = { player: p, npcId, text: step.npc, skip: false };
      if (step.npc) hooks['npc-dialogue:line'](line);
      if (step.type === 'action') hooks['npc-dialogue:action']({ player: p, npcId, step, text: step.text });
      if (step.type === 'message') {
        const message = { player: p, npcId, step, text: step.text, kind: 'message' };
        hooks['npc-dialogue:action'](message);
        if (!message.handled) p.sendMessage(step.text);
      }
    }
  };
  const transcript = (name, variant) => data[name].variants[variant];

  const melee = player({ [I.TRAINING_SWORD]: 1 });
  play(melee, N.MELEE_COMBAT_TUTOR, transcript('Melee combat tutor', 'standard-dialogue'), "I'd like a training");
  assert.equal(melee.inventory.getAmount(I.TRAINING_SHIELD), 1);
  assert.equal(melee.inventory.getAmount(I.TRAINING_SWORD), 0);

  // No runes and room for both: mind and air runes, then the shared 30-minute cooldown.
  const mage = player();
  hooks['Magic combat tutor'].Claim({ player: mage, npcId: N.MAGIC_COMBAT_TUTOR });
  play(mage, N.MAGIC_COMBAT_TUTOR, transcript('Magic combat tutor', hooks.started));
  assert.equal(mage.inventory.getAmount(I.MIND_RUNE), 30);
  assert.equal(mage.inventory.getAmount(I.AIR_RUNE), 30);
  assert.deepEqual(mage.messages, ['Mikasi gives you 30 mind runes.', 'Mikasi gives you 30 air runes.']);
  hooks['Ranged combat tutor'].Claim({ player: mage, npcId: N.RANGED_COMBAT_TUTOR });
  play(mage, N.RANGED_COMBAT_TUTOR, transcript('Ranged combat tutor', hooks.started));
  assert.equal(mage.inventory.getAmount(I.TRAINING_BOW), 0);

  const ranger = player();
  hooks['Ranged combat tutor'].Claim({ player: ranger, npcId: N.RANGED_COMBAT_TUTOR });
  play(ranger, N.RANGED_COMBAT_TUTOR, transcript('Ranged combat tutor', hooks.started));
  assert.equal(ranger.inventory.getAmount(I.TRAINING_BOW), 1);
  assert.equal(ranger.inventory.getAmount(I.TRAINING_ARROWS), 25);

  // The ranged tutor's pickup toggle: same ammo as the worn slot goes to the slot, not the bag.
  hooks['npc-dialogue:choice']({ player: ranger, npcId: N.RANGED_COMBAT_TUTOR, option: 'Automatically equip it.' });
  assert.equal(ranger.getAttribute('ranged:equip-ammo-on-pickup'), true);
  const { Equipment } = require('../dist/game/model/container/impl/Equipment');
  const { Item } = require('../dist/game/model/Item');
  const ammoSlot = new Item(I.BRONZE_ARROW, 5);
  ranger.getEquipment = () => ({
    get: (slot) => slot === Equipment.AMMUNITION_SLOT ? ammoSlot : new Item(-1, 0),
    refreshItems() {},
  });
  const matching = { player: ranger, groundItemId: I.BRONZE_ARROW, groundItem: { getItem: () => new Item(I.BRONZE_ARROW, 3) }, handled: false };
  hooks.pickup(matching);
  assert.equal(matching.handled, true);
  assert.equal(matching.groundItem.deregistered, true);
  assert.equal(ammoSlot.getAmount(), 8);
  const wrongAmmo = { player: ranger, groundItemId: I.IRON_ARROW, groundItem: { getItem: () => new Item(I.IRON_ARROW, 1) }, handled: false };
  hooks.pickup(wrongAmmo);
  assert.equal(wrongAmmo.handled, false, 'different ammo stays on the normal inventory pickup path');
  hooks['npc-dialogue:choice']({ player: ranger, npcId: N.RANGED_COMBAT_TUTOR, option: 'Place it in my inventory.' });
  assert.equal(ranger.getAttribute('ranged:equip-ammo-on-pickup'), false);
  const disabled = { player: ranger, groundItemId: I.BRONZE_ARROW, groundItem: { getItem: () => new Item(I.BRONZE_ARROW, 3) }, handled: false };
  hooks.pickup(disabled);
  assert.equal(disabled.handled, false);
});

test('"same as above" after an NPC line carries on as that line does elsewhere, never looping', () => {
  const { collectPageLines, collectPageOptions } = require('../plugins/npcs/NpcDialogues.plugin');
  // Bryn's page: the first-time answer says the opening line, then "jump above".
  const record = data.Bryn;
  const options = collectPageOptions(record);
  const context = { pages: [], pageLines: collectPageLines(record), pageOptions: options.byText, pageOptionList: options.list };
  const said = [];
  let steps = 0;
  const player = {
    getDialogueManager: () => ({
      reset() {},
      startDialogues(chain) {
        assert.ok(++steps < 20, 'dialogue looped');
        const entries = [...chain.getDialogues().values()].sort((a, b) => a.getIndex() - b.getIndex());
        for (const entry of entries) {
          if (entry.constructor.name === 'ActionDialogue') return entry.send(player);
          said.push(String(entry.text ?? ''));
        }
      },
    }),
    getPacketSender: () => ({ sendInterfaceRemoval() { said.push('<closed>'); } }),
    sendMessage() {},
  };
  const definition = { getName: () => 'Bryn', getId: () => 9020 };
  const api = {
    emitCustomEvent() {},
    sendMultiChatboxPrompt(_player, _title, ...pairs) { pairs[1](); return true; }, // "What is this place?"
  };
  const event = { player, npc: { getId: () => 9020 }, npcId: 9020, definition };
  startDialogue(api, event, record.variants['first-time-talking-to-him'], record.branches, { ...context, player, npc: event.npc, npcId: 9020, definition });
  assert.ok(said.includes('Train?'), 'the full explanation follows');
  assert.equal(said.filter((line) => line.startsWith('This here is the Gauntlet')).length, 1, 'said once');
  assert.equal(said.at(-1), '<closed>');
});

test('a random story skips alternatives a plugin rules out, and an action can splice in steps', () => {
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const condition = { pluginName: 'test', handler: ({ text }) => (text === 'If done:' ? true : text === 'If not done:' ? false : null) };
  PluginManager.npcDialogueConditionHooks.unshift(condition);
  const said = [];
  const player = {
    getDialogueManager: () => ({
      reset() {},
      startDialogues(chain) {
        for (const entry of [...chain.getDialogues().values()].sort((a, b) => a.getIndex() - b.getIndex())) {
          if (entry.text) said.push(entry.text);
          try { entry.send(player); } catch { /* unwired dialogue entries are fine here */ }
        }
      },
    }),
    getPacketSender: () => ({ sendInterfaceRemoval() {} }),
    sendMessage() {},
  };
  const story = {
    type: 'random',
    options: [
      { text: 'a', condition: 'If not done:', steps: [{ player: 'Never happened.' }] },
      { text: 'b', condition: 'If done:', steps: [{ player: 'It happened.' }] },
    ],
  };
  const api = {
    emitCustomEvent(name, payload) {
      if (name === 'npc-dialogue:action' && payload.stepId === 'pick') {
        payload.steps = [story];
        payload.handled = true;
      }
    },
  };
  const definition = { getName: () => 'Juna', getId: () => 5785 };
  const event = { player, npc: null, npcId: 5785, definition };
  try {
    for (let i = 0; i < 10; i++) {
      startDialogue(api, event, [{ type: 'reference', id: 'pick' }, { npc: 'Your stories have entertained me.' }], {}, { player, npc: null, npcId: 5785, definition, pages: [] });
    }
  } finally {
    PluginManager.npcDialogueConditionHooks.splice(PluginManager.npcDialogueConditionHooks.indexOf(condition), 1);
  }
  assert.equal(said.filter((line) => line === 'Never happened.').length, 0);
  assert.equal(said.filter((line) => line === 'It happened.').length, 10);
  assert.equal(said.filter((line) => line === 'Your stories have entertained me.').length, 10);
});

test('player-name and gendered placeholders resolve from the reader', () => {
  const { formatPlayerText } = require('../plugins/npcs/NpcDialogues.plugin');
  const male = { getUsername: () => 'Zezima', getAppearance: () => ({ isMale: () => true }) };
  const female = { getUsername: () => 'Woox', getAppearance: () => ({ isMale: () => false }) };

  assert.equal(formatPlayerText('Can I help you, [sir/madam]?', male), 'Can I help you, sir?');
  assert.equal(formatPlayerText('Can I help you, [sir/madam]?', female), 'Can I help you, madam?');
  assert.equal(formatPlayerText('Greetings [Madam/Sir].', male), 'Greetings Sir.');
  assert.equal(formatPlayerText('Greetings [Madam/Sir].', female), 'Greetings Madam.');
  assert.equal(formatPlayerText('Ah, good day to you [milady/sirrah]!', male), 'Ah, good day to you sirrah!');
  assert.equal(formatPlayerText('[Greetings, sir/Greetings, madam/Greetings]', female), 'Greetings, madam');
  assert.equal(formatPlayerText('A [man/woman/one] of taste.', female), 'A woman of taste.');
  assert.equal(formatPlayerText('Iron[men/women] cannot use the bank.', male), 'Ironmen cannot use the bank.');
  assert.equal(formatPlayerText("[That'll do nicely, sir/That'll do nicely, madam/That'll do nicely].", female), "That'll do nicely, madam.");
  assert.equal(formatPlayerText('Good day, [Sir/Madam/ ]. Can I help you?', male), 'Good day, Sir. Can I help you?');
  assert.equal(formatPlayerText('Look [miss/pal] I got the goods.', male), 'Look pal I got the goods.');
  assert.equal(formatPlayerText('I am sorry [player name].', male), 'I am sorry Zezima.');
  assert.equal(formatPlayerText('Hurry up, <player name>!', female), 'Hurry up, Woox!');
  assert.equal(formatPlayerText('[player] reporting, sir!', female), 'Woox reporting, sir!');
  assert.equal(formatPlayerText('Good day [player.] Have you had any luck?', male), 'Good day Zezima. Have you had any luck?');
  assert.equal(formatPlayerText('Haha, you have spirit, [player name/fremennik name].', female), 'Haha, you have spirit, Woox.');
  // Alternatives that are not about the reader stay for the owning plugin.
  assert.equal(formatPlayerText('Kill [3/4/5] rats.', male), 'Kill [3/4/5] rats.');
  assert.equal(formatPlayerText('Sir Amik Varze hands you 2,500 coins.', female), 'Sir Amik Varze hands you 2,500 coins.');
});


test('Morgan warns low-combat players and still offers to start Vampyre Slayer', () => {
  const steps = flatten(data['Vampyre Slayer'].variants['starting-off'], {
    resolveCondition: () => true,
  });
  assert.ok(steps.some((step) => step.type === 'message' && step.id === 'KjL0_I'));
  assert.ok(!steps.some((step) => step.type === 'unavailable'));
  assert.ok(steps.some((step) => step.type === 'choice' && step.prompt === 'Start the Vampyre Slayer quest?'));
});

test('Quest transcripts preserve each named speaker instead of borrowing the clicked NPC head', () => {
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const { startTranscript } = require('../plugins/quests/QuestRuntime');
  const names = new Map([[13511,'Thaerisk'],[13543,'Akrisae'],[13540,'Idria'],[13519,'Silif']]);
  const api = {
    core: { ...PluginManager.getCoreApi(), NpcDefinition: { forId: id => ({getId:()=>id,getName:()=>names.get(id)||'null'}) } },
    emitCustomEvent() {},
  };
  const lines=[];
  const player={getUsername:()=> 'Test',getDialogueManager:()=>({reset(){},startDialogues:chain=>{
    for(const e of chain.getDialogues().values())if(e.getNpcId)lines.push([e.getNpcId(),e.getText()]);
  }})};
  assert.equal(startTranscript(api,player,13543,'While Guthix Sleeps','forming-a-fellowship-capturing-a-spy-talking-to-thaerisk-idria-or-akrisae'),true);
  assert.equal(lines[0][0],13511);
  assert.ok(lines.some(([id,text])=>id===13543&&text.includes('Glad to have you')));
  assert.ok(lines.some(([id,text])=>id===13540&&text.includes('theology')));
});

test('The BMR preparation transcript indexes its distinct Mysterious Vampyre speaker', () => {
  const { speakerIdIndex } = require('../plugins/npcs/NpcDialogues.plugin');
  const dialogueIndex = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/definitions/npc-dialogue-index.json'), 'utf8'));
  const speakers = speakerIdIndex(dialogueIndex, { forId: id => ({
    getName: () => ({ 15953: 'Mysterious Woman', 15964: 'Mysterious Vampyre' })[id] || 'null',
  }) });
  const page = 'The Blood Moon Rises';
  const variant = 'hallowed-preparations-talking-to-the-mysterious-woman';
  assert.equal(speakers.get('Mysterious Vampyre'), 15964);
  assert.ok(dialogueIndex['15964'].some(entry => entry.page === `Transcript:${page}` && entry.variants.includes(variant)));
  assert.ok(data[page].variants[variant].some(step => step.type === 'line' && step.speaker === 'Mysterious Vampyre'));
});

test('Quest transcript options reuse answers from earlier variants on the same page', () => {
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const { startTranscript } = require('../plugins/quests/QuestRuntime');
  let chain, current, menu;
  const lines = [];
  const manager = {
    reset() { current = null; }, getCurrent: () => current,
    startDialogues(builder) { chain = builder; current = [...builder.getDialogues().values()][0]; },
  };
  const player = { getUsername: () => 'Test', getDialogueManager: () => manager,
    getPacketSender: () => ({ sendInterfaceRemoval() {} }) };
  const api = { core: { ...PluginManager.getCoreApi(), NpcDefinition: { forId: id => ({ getId: () => id, getName: () => 'Wizard Persten' }) } },
    emitCustomEvent() {}, sendMultiChatboxPrompt(_player, _title, ...pairs) { menu = pairs; } };
  const reachMenu = () => {
    for (let i = 0; i < 30 && !menu; i++) {
      const entries = [...chain.getDialogues().values()];
      for (const entry of entries) if (entry.getText) lines.push(entry.getText());
      current = entries.at(-1);
      current.send(player);
    }
    assert(menu, 'the conversation returns to its options');
  };
  assert.equal(startTranscript(api, player, api.core.NpcIdentifiers.WIZARD_PERSTEN_5,
    'Desert Treasure II - The Fallen Empire', 'praefectus-classis-perseriya-talking-to-wizard-persten-after-completing-the-first-passage'), true);
  reachMenu();
  for (const [question, answer] of [['How did you survive in here?', 'turn back time'], ["What's with the demons in this place?", 'demonic connections']]) {
    const choice = menu.indexOf(question);
    assert(choice >= 0);
    const select = menu[choice + 1]; menu = null; lines.length = 0;
    select(); reachMenu();
    assert(lines.some(text => text.includes(answer)), `${question} plays its earlier answer before returning to the menu`);
  }
});


test('Core choice dialogues use native options and validate the resume without losing their chain', () => {
 const {PluginManager}=require('../dist/plugins/PluginManager'),{DialogueManager}=require('../dist/game/model/dialogues/DialogueManager');
 const {OptionDialogue,DialogueChainBuilder,StatementDialogue}=PluginManager.getCoreApi();const packets=[];let chosen;
 const sender={sendInterfaceScript:id=>packets.push(['script',id]),sendVarbit(){},sendChatboxInterface:id=>packets.push(['open',id]),sendClientScript:(...a)=>packets.push(['cs2',...a]),sendInterfaceFlagsRange:(...a)=>packets.push(['flags',...a]),isChatboxInterface:id=>id===219,sendInterfaceRemoval(){}};
 const player={getPacketSender:()=>sender};const manager=new DialogueManager(player);
 const option=new OptionDialogue(0,{executeOption:n=>chosen=n},'First','Second');
 manager.startDialogues(new DialogueChainBuilder().add(option,new StatementDialogue(1,'The conversation continues.')));
 assert.ok(packets.some(a=>a[0]==='open'&&a[1]===219));assert.deepEqual(packets.find(a=>a[0]==='cs2'),['cs2',58,'Select an Option','First|Second']);
 assert.equal(manager.getCurrent(),option);
 for(const [uid,n]of [[OptionDialogue.OPTIONS_WIDGET_ID,0],[OptionDialogue.OPTIONS_WIDGET_ID,3],[OptionDialogue.OPTIONS_WIDGET_ID,1.5],[231<<16,1]])assert.equal(manager.handleResume(uid,n),false);
 assert.equal(chosen,undefined);assert.equal(manager.handleResume(OptionDialogue.OPTIONS_WIDGET_ID,2),true);assert.equal(chosen,2);
 assert.equal(manager.getCurrent(),option,'selecting must not erase entries owned by the option callback');
});


test('continuing a quest line preserves a new conversation started by its after callback', () => {
 let current,chain;const replacement={newConversation:true};
 const manager={getCurrent:()=>current,reset:()=>current=null,startDialogues:builder=>{chain=builder;current=[...builder.getDialogues().values()][0];}};
 const player={getUsername:()=> 'Test',getDialogueManager:()=>manager,getPacketSender:()=>({sendInterfaceRemoval(){}})};
 const definition={getName:()=> 'Guard',getId:()=>13566};
 const api={emitCustomEvent:(name,e)=>{if(name==='npc-dialogue:line'&&e.text==='Yes master!')e.after=()=>manager.startDialogues({getDialogues:()=>new Map([[0,replacement]])});}};
 const event={player,npc:null,npcId:13566,definition};
 startDialogue(api,event,[{npc:'Yes master!'},{npc:'Old conversation tail'}],{},{...event,pages:[]});
 const after=[...chain.getDialogues().values()].at(-1);current=after;after.send(player);
 assert.equal(current,replacement,'the new Surok conversation must survive the guard continuation');
});

test('a quest message preserves the next conversation started by its action handler', () => {
 let current,chain;const replacement={newConversation:true};const messages=[];
 const manager={getCurrent:()=>current,reset:()=>current=null,startDialogues:builder=>{chain=builder;current=[...builder.getDialogues().values()][0];}};
 const player={getUsername:()=> 'Test',getDialogueManager:()=>manager,sendMessage:text=>messages.push(text),getPacketSender:()=>({sendInterfaceRemoval(){}})};
 const definition={getName:()=> 'Ysgawyn',getId:()=>8890};
 const api={emitCustomEvent:(name,e)=>{if(name==='npc-dialogue:action'&&e.stepId==='return-to-lletya')manager.startDialogues({getDialogues:()=>new Map([[0,replacement]])});}};
 const event={player,npc:null,npcId:8890,definition};
 startDialogue(api,event,[{npc:'We need to go!'},{type:'message',text:'You return to Lletya.',id:'return-to-lletya'}],{},{...event,pages:[]});
 const after=[...chain.getDialogues().values()].at(-1);current=after;after.send(player);
 assert.equal(current,replacement,'Mawrth’s new conversation survives the Ysgawyn message continuation');
 assert.deepEqual(messages,['You return to Lletya.']);
});

test('an action that starts a new conversation does not resume the old transcript tail', () => {
 let current,chain;const replacement={newConversation:true};
 const manager={getCurrent:()=>current,reset:()=>current=null,startDialogues:builder=>{chain=builder;current=[...builder.getDialogues().values()][0];}};
 const player={getUsername:()=> 'Test',getDialogueManager:()=>manager,getPacketSender:()=>({sendInterfaceRemoval(){}})};
 const definition={getName:()=> 'Vanescula',getId:()=>16176};
 const api={emitCustomEvent:(name,e)=>{
   if(name==='npc-dialogue:action'&&e.stepId==='start-next-scene')
     manager.startDialogues({getDialogues:()=>new Map([[0,replacement]])});
 }};
 const event={player,npc:null,npcId:16176,definition};
 startDialogue(api,event,[{type:'action',id:'start-next-scene'},{npc:'Old conversation tail'}],{}, {...event,pages:[]});
 const action=[...chain.getDialogues().values()][0];current=action;action.send(player);
 assert.equal(current,replacement,'the action-started scene must survive the old transcript tail');
});


test('the Lassar vision uses the player head for copies speaking under the player placeholder', () => {
  const { PlayerDialogue } = require('../dist/game/model/dialogues/entries/impl/PlayerDialogue');
  let chain;
  const player = { getUsername: () => 'Test', getDialogueManager: () => ({
    reset() {}, startDialogues(builder) { chain = builder; },
  }) };
  const cloneLine = data['Desert Treasure II - The Fallen Empire'].variants[
    'the-whisperer-inspecting-the-totem-in-the-cistern'].find(step => step.type === 'line' && step.speaker === '[player name]');
  assert.ok(cloneLine);
  startDialogue({ emitCustomEvent() {} }, {
    player, npcId: 12232, definition: { getId: () => 12232, getName: () => 'Ketla' },
  }, [cloneLine]);
  const spoken = [...chain.getDialogues().values()].filter(entry => entry.getText);
  assert.equal(spoken.length, 1);
  assert.ok(spoken[0] instanceof PlayerDialogue, 'the copy does not borrow Ketla’s head');
  assert.equal(spoken[0].getText(), cloneLine.text);
});

test('a plain quest message box waits for continue before resuming the transcript', () => {
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const core = PluginManager.getCoreApi();
  let current;
  const manager = {
    getCurrent: () => current,
    startDialogues(chain) {
      current = chain;
      const first = [...chain.getDialogues().values()][0];
      if (first.constructor.name === 'ActionDialogue') first.send(player);
    },
  };
  const player = { getDialogueManager: () => manager, getPacketSender: () => ({ sendInterfaceRemoval() {} }), sendMessage() { assert.fail('message must be a chatbox'); } };
  const definition = { getName: () => 'Fred the Farmer', getId: () => 732 };
  const api = { core, emitCustomEvent(name, message) {
    if (name === 'npc-dialogue:action' && message.kind === 'message') message.box = { statement: true };
  } };
  startDialogue(api, { player, npcId: 732, definition }, [
    { type: 'message', text: 'You give Fred 20 balls of wool.' },
    { npc: "I guess I'd better pay you then." },
  ], {}, { player, npcId: 732, definition, pages: [] });
  let entries = [...current.getDialogues().values()];
  assert.ok(entries[0] instanceof core.StatementDialogue);
  assert.equal(entries[0].getText(), 'You give Fred 20 balls of wool.');
  entries[1].send(player);
  entries = [...current.getDialogues().values()];
  assert.equal(entries[0].constructor.name, 'NpcDialogue');
});

test('quest state callbacks run when their line is reached, never while later lines are compiled', () => {
  let entries, index = 0, stage = 0;
  const manager = {
    getCurrent: () => entries?.get(index),
    startDialogues: chain => { entries = chain.getDialogues(); index = 0; },
    advance: () => { index++; },
  };
  const player = { getUsername: () => 'Test', getDialogueManager: () => manager };
  const definition = { getName: () => 'Cassius', getId: () => 15632 };
  const api = { emitCustomEvent(name, request) {
    if (name !== 'npc-dialogue:line') return;
    if (request.text === 'Of milk.') request.before = () => { stage = 2; };
    if (request.text === 'Meet the Groats family.') request.before = () => { stage = 3; };
  } };
  startDialogue(api, { player, npcId: 15632, definition }, [
    { npc: 'Welcome.' }, { npc: 'Of milk.' }, { npc: 'Meet the Groats family.' },
  ]);
  assert.equal(stage, 0);
  manager.advance(); manager.getCurrent().send(player);
  assert.equal(stage, 2); assert.equal(manager.getCurrent().getText(), 'Of milk.');
  manager.advance(); manager.getCurrent().send(player);
  assert.equal(stage, 3); assert.equal(manager.getCurrent().getText(), 'Meet the Groats family.');
});

test('a quest can select the captured head for a group of cutscene speakers', () => {
  let chain;
  const player = { getUsername: () => 'Test', getDialogueManager: () => ({ startDialogues: value => { chain = value; } }) };
  const definition = { getName: () => 'Denath', getId: () => 5091 };
  startDialogue({ emitCustomEvent(name, request) {
    if (name === 'npc-dialogue:line') request.speakerId = 5087;
  } }, { player, npcId: 5091, definition }, [{ type: 'line', speaker: 'Dark wizards', text: 'Yes master!' }]);
  const line = [...chain.getDialogues().values()][0];
  assert.equal(line.npcId, 5087);
});


test('quest menu warning pauses once, then presents the same selectable options', () => {
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const core = PluginManager.getCoreApi();
  const chains = [], menus = [];
  const player = { getDialogueManager: () => ({ reset() {}, startDialogues: chain => chains.push(chain) }),
    getPacketSender: () => ({ sendInterfaceRemoval() {} }), sendMessage() {} };
  const definition = { getName: () => 'Doric', getId: () => 3893 };
  const api = { core, emitCustomEvent(name, request) { if (name === 'npc-dialogue:menu') request.warning = 'You need 15 Mining.'; },
    sendMultiChatboxPrompt(_player, title, ...options) { menus.push({title, options}); } };
  const event = { player, npcId: 3893, npc: null, definition };
  startDialogue(api, event, [{ type: 'choice', options: [{ text: 'Yes', steps: [{ npc: 'Thanks.' }] }, { text: 'No' }] }], {}, event);
  [...chains.shift().getDialogues().values()][0].send(player);
  const entries = [...chains.shift().getDialogues().values()];
  assert.equal(entries[0].getText(), 'You need 15 Mining.');
  assert.equal(menus.length, 0);
  entries[1].send(player);
  assert.equal(menus.length, 1);
  assert.deepEqual(menus[0].options.filter(value => typeof value === 'string'), ['Yes', 'No']);
});

test('typed speakers retain their name with a nameless transform-parent head and captured expressions', () => {
  let chain;
  const sent = [], sender = new Proxy({}, { get: (_target, key) => (...args) => { sent.push([key, ...args]); return sender; } });
  const player = { getUsername: () => 'Test', getPacketSender: () => sender,
    getDialogueManager: () => ({ startDialogues: value => { chain = value; } }) };
  const definition = { getName: () => 'null', getId: () => 13404 };
  startDialogue({ emitCustomEvent(name, request) { if (name === 'npc-dialogue:line') request.expression = 567; } },
    { player, npcId: 13404, definition }, [{ type: 'line', speaker: 'Sue', text: 'Peace at last!' }]);
  const line = [...chain.getDialogues().values()][0]; line.send(player);
  assert.ok(sent.some(row => row[0] === 'sendString' && row[1] === 'Sue' && row[2] === (231 << 16 | 4)));
  assert.ok(sent.some(row => row[0] === 'sendInterfaceAnimation' && row[2] === 567));
  sent.length = 0;
  startDialogue({ emitCustomEvent() {} }, { player, npcId: 13404, definition }, [{ player: 'Hello!', expression: 554 }]);
  [...chain.getDialogues().values()][0].send(player);
  assert.ok(sent.some(row => row[0] === 'sendInterfaceAnimation' && row[2] === 554));
});

test('paired cutscene NPCs can use the native right-side chatbox without the player head', () => {
  let chain;
  const sent = [], sender = new Proxy({}, { get: (_target, key) => (...args) => { sent.push([key, ...args]); return sender; } });
  const player = { getUsername: () => 'Test', getPacketSender: () => sender,
    getDialogueManager: () => ({ startDialogues: value => { chain = value; } }) };
  startDialogue({ emitCustomEvent(_name, request) { request.speakerId = 16536; request.side = 'right'; } },
    { player, npcId: 16527, definition: { getName: () => 'Outlaw', getId: () => 16527 } },
    [{ type: 'line', speaker: 'Outlaw', text: "A little mangy mutt. Can we keep 'em?" }]);
  [...chain.getDialogues().values()][0].send(player);
  assert.ok(sent.some(row => row[0] === 'sendChatboxInterface' && row[1] === 217));
  assert.ok(sent.some(row => row[0] === 'sendNpcHeadOnInterface' && row[1] === 16536 && row[2] === (217 << 16 | 2)));
  assert.ok(!sent.some(row => row[0] === 'sendPlayerHeadOnInterface'));
});
