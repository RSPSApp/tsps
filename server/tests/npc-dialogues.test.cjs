// Run after `yarn build`: node --test tests/npc-dialogues.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { pickVariant, aliasKeys, flatten, startDialogue, speakerIdIndex, collectMenuBefore } = require('../plugins/npcs/NpcDialogues.plugin');

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

test('activity-only records cannot become implicit NPC conversations or aliases', () => {
  const event = { activation: 'explicit', default: 'starting-off', variants: {
    'starting-off': [{ npc: 'An inactive activity must not start here.' }],
  } };
  assert.equal(pickVariant(event), undefined);
  assert.equal(pickVariant({ activation: 'explicit', steps: [{ npc: 'Nor a flat activity.' }] }), undefined);
  assert.equal(aliasKeys({ 'Cook (holiday event)': event }).has('Cook'), false);
  assert.equal(pickVariant({ default: null, variants: { 'starting-off': [{ npc: 'An ordinary fallback.' }] } })[0].npc,
    'An ordinary fallback.');
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

test('prior menus include condition containers, preserve the variant family and stop at the first choice', () => {
  const nested = { type: 'choice', options: [{ text: 'Nested', steps: [] }] };
  const menu = { type: 'choice', options: [{ text: 'Help', steps: [nested] }] };
  const record = { variants: {
    'filliman-first': [{ type: 'line', speaker: 'Filliman Tarlock', text: 'Hello.' },
      { type: 'condition', steps: [{ type: 'condition', steps: [menu] }] }],
    'drezel-other': [{ type: 'choice', options: [{ text: 'Foreign', steps: [] }] }],
    'filliman-again': [{ npc: 'Hello again.' }],
  } };
  const scope = { initial: true, callerName: 'Filliman Tarlock' };
  assert.equal(collectMenuBefore(record, 'filliman-again', scope).step, menu);
  assert.equal(collectMenuBefore(record, 'filliman-again'), undefined, 'legacy lookup remains direct-only');
  assert.equal(collectMenuBefore(record, 'filliman-first'), undefined);
  assert.equal(collectMenuBefore(record, 'drezel-other'), undefined);
  const canonical = collectMenuBefore(data['Nature Spirit'], 'finding-filliman-subsequent-dialogue-with-filliman-2', scope);
  assert.ok(canonical.step.options.some(option => option.text === 'How can I help?'));
});

test('initial uses the conversation menu before its prior-page fallback and ends without either', () => {
  const prior = { step: { type: 'choice', prompt: 'Prior', options: [{ text: 'Bye', steps: [] }] }, rest: [] };
  for (const ownMenu of [false, true]) {
    const prompts = [];
    const player = {
      getDialogueManager: () => ({ reset() {}, startDialogues(chain) {
        for (const entry of chain.getDialogues().values()) if (entry.constructor.name === 'ActionDialogue') return entry.send(player);
      } }),
      getPacketSender: () => ({ sendInterfaceRemoval() {} }), sendMessage() {},
    };
    const event = { player, npcId: 943, definition: { getName: () => 'Filliman Tarlock', getId: () => 943 } };
    const api = {
      emitCustomEvent() {},
      sendMultiChatboxPrompt(_player, title, ...pairs) {
        prompts.push(title); assert.ok(prompts.length <= 2, 'initial should return to a usable menu');
        pairs[prompts.length === 1 && ownMenu ? 1 : pairs.length - 1]();
      },
    };
    const steps = ownMenu ? [{ type: 'choice', prompt: 'Current', options: [
      { text: 'Again', steps: [{ type: 'jump', reference: 'initial' }] }, { text: 'Bye', steps: [] },
    ] }] : [{ type: 'jump', reference: 'initial' }];
    startDialogue(api, event, steps, {}, { ...event, pages: [], pageInitialMenu: prior });
    assert.deepEqual(prompts, ownMenu ? ['Current', 'Current'] : ['Prior']);
    prompts.length = 0;
    startDialogue(api, event, [{ type: 'jump', reference: 'initial' }], {}, { ...event, pages: [] });
    assert.deepEqual(prompts, []);
  }
});

test('scoped initial recovery rejects foreign, mixed and unknown source ownership', () => {
  const menu = { type: 'choice', options: [{ text: 'Help', steps: [] }] };
  const line = speaker => ({ type: 'line', speaker, text: 'Hello.' });
  for (const speakers of [[], ['Velorina'], ['Old crone', 'Velorina'], [null]]) {
    const record = { variants: {
      'talking-first': [...speakers.map(speaker => speaker ? line(speaker) : { npc: 'An unlabelled speaker.' }), menu],
      'talking-again': [line('Old crone')],
    } };
    assert.equal(collectMenuBefore(record, 'talking-again', { initial: true, callerName: 'Old crone' }), undefined);
  }
});

test('canonical Kragen keeps the direct menu ahead of an earlier conditional menu', () => {
  const record = data['Garden of Tranquillity'], variant = 'talking-to-kragen-subsequent-dialogue-with-kragen';
  const expected = ['Would you look after my crops for me?', 'Can you give me any farming advice?',
    'Can you sell me something?', "That's all, thanks."];
  for (const options of [undefined, { initial: true, callerName: 'Kragen' }]) {
    assert.deepEqual(collectMenuBefore(record, variant, options).step.options.map(option => option.text), expected);
  }
});

test('legacy above/below keeps its implicit-owner direct menu while initial fails closed', () => {
  const menu = { type: 'choice', prompt: 'Legacy', options: [{ text: 'Bye', steps: [] }] };
  const record = { variants: { 'talking-first': [menu], 'talking-again': [{ type: 'jump', reference: 'above' }] } };
  const prior = collectMenuBefore(record, 'talking-again');
  assert.equal(prior.step, menu);
  assert.equal(collectMenuBefore(record, 'talking-again', { initial: true, callerName: 'Unknown' }), undefined);
  for (const reference of ['above', 'below', 'initial']) {
    const prompts = [];
    const player = {
      getDialogueManager: () => ({ reset() {}, startDialogues(chain) {
        for (const entry of chain.getDialogues().values()) if (entry.constructor.name === 'ActionDialogue') return entry.send(player);
      } }),
      getPacketSender: () => ({ sendInterfaceRemoval() {} }), sendMessage() {},
    };
    const event = { player, npcId: 943, definition: { getName: () => 'Unknown', getId: () => 943 } };
    startDialogue({ emitCustomEvent() {}, sendMultiChatboxPrompt(_player, title) { prompts.push(title); } },
      event, [{ type: 'jump', reference }], {}, { ...event, pages: [], pageMenuBefore: prior });
    assert.deepEqual(prompts, reference === 'initial' ? [] : ['Legacy']);
  }
});

test('canonical Old crone material handover cannot recover Velorina acquisition questions', t => {
  const record = data['Ghosts Ahoy'], variant = 'talking-to-the-old-crone-with-the-materials';
  const scope = { initial: true, callerName: 'Old crone' };
  const initial = collectMenuBefore(record, variant, scope);
  const expected = ['I am afraid I have not found your son yet.', 'Remind me - what can I do about Necrovarus?',
    'What did you want me to get for you?', "I'll go and search for those items you wanted."];
  assert.deepEqual(initial.step.options.map(option => option.text), expected);
  assert.deepEqual(collectMenuBefore(record, variant, { initial: true }).step.options.map(option => option.text), expected,
    'a single canonical source actor is also sufficient without a caller override');
  const { PluginManager } = require('../dist/plugins/PluginManager');
  t.mock.method(PluginManager, 'emitNpcDialogueCondition', event => event.text === 'If the player has the Book of Haricanto:');
  let sender;
  sender = new Proxy({}, { get: () => () => sender });
  const player = { getDisplayName: () => 'Reviewer', sendMessage() {}, getPacketSender: () => sender,
    getDialogueManager: () => ({ reset() {}, startDialogues(chain) {
      for (const entry of chain.getDialogues().values()) entry.send(player);
    } }) };
  const event = { player, npcId: 1695, definition: { getName: () => 'Old crone', getId: () => 1695 } };
  const menus = [], options = require('../plugins/npcs/NpcDialogues.plugin').collectPageOptions(record);
  startDialogue({ emitCustomEvent() {}, sendMultiChatboxPrompt(_player, _title, ...pairs) {
    menus.push(pairs.filter((_value, i) => i % 2 === 0));
  } }, event, record.variants[variant], record.branches, { ...event, pages: [],
    pageMenuBefore: collectMenuBefore(record, variant), pageInitialMenu: initial,
    pageOptions: options.byText, pageOptionList: options.list });
  assert.deepEqual(menus, [expected]);
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
  const male = { getUsername: () => 'Zezima', getDisplayName: () => 'Zezima', getAppearance: () => ({ isMale: () => true }) };
  const female = { getUsername: () => 'Woox', getDisplayName: () => 'Woox', getAppearance: () => ({ isMale: () => false }) };

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
  const player = { getUsername: () => 'Test', getDisplayName: () => 'Test', getDialogueManager: () => manager,
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


test('the Lassar vision overhead copies speak through the player actor on the task cadence', () => {
  const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
  const { ActionDialogue } = require('../dist/game/model/dialogues/entries/impl/ActionDialogue');
  const { PlayerDialogue } = require('../dist/game/model/dialogues/entries/impl/PlayerDialogue');
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const { TaskManager } = require('../dist/game/task/TaskManager');
  const chats = [];
  const sent = [];
  const sender = new Proxy({}, {
    get: (_target, key) => (...args) => { sent.push([key, ...args]); return sender; },
  });
  const player = {
    getUsername: () => 'Test', getDisplayName: () => 'Test',
    getAppearance: () => ({ isMale: () => true }),
    isRegistered: () => true,
    forceChat(text) { chats.push(text); },
    getPacketSender: () => sender,
    getDialogueManager() { return this.manager; },
  };
  player.manager = new DialogueManager(player);
  const cloneLine = data['Desert Treasure II - The Fallen Empire'].variants[
    'the-whisperer-inspecting-the-totem-in-the-cistern'].find(step => step.type === 'line' && step.speaker === '[player name]');
  assert.equal(cloneLine.presentation, 'overhead');
  try {
    startDialogue({ core: PluginManager.getCoreApi(), emitCustomEvent() {} }, {
      player, npcId: 12232, definition: { getId: () => 12232, getName: () => 'Ketla' },
    }, [cloneLine]);
    assert.deepEqual(chats, [cloneLine.text], 'the current player is the real overhead actor');
    assert.ok(!(player.manager.getCurrent() instanceof PlayerDialogue));
    assert.ok(player.manager.getCurrent() instanceof ActionDialogue, 'the overhead action owns the dialogue during the cadence');
    assert.ok(sent.every(([key]) => key !== 'sendChatboxInterface'), 'an overhead line does not open a chatbox');
    TaskManager.process();
    TaskManager.process();
    assert.equal(player.manager.getCurrent(), undefined, 'the empty continuation closes and resets the dialogue');
  } finally {
    TaskManager.cancelTasks(player);
    TaskManager.pendingTasks.clear();
    TaskManager.activeTasks.length = 0;
  }
});

test('an overhead NPC action owns its two-tick continuation; treating it as a dialogue drops the transcript tail', () => {
  const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
  const { ActionDialogue } = require('../dist/game/model/dialogues/entries/impl/ActionDialogue');
  const { PlayerDialogue } = require('../dist/game/model/dialogues/entries/impl/PlayerDialogue');
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const { TaskManager } = require('../dist/game/task/TaskManager');
  const area = {};
  const chats = [];
  const sender = new Proxy({}, { get: (_target, _key) => (..._args) => sender });
  const location = { getZ: () => 0, getDistance: () => 1 };
  const player = {
    getUsername: () => 'Test', getDisplayName: () => 'Test', getAppearance: () => ({ isMale: () => true }),
    isRegistered: () => true, getLocation: () => location, getPrivateArea: () => area,
    getPacketSender: () => sender, getDialogueManager() { return this.manager; },
    getLocalNpcs: () => [burntof],
  };
  const burntof = {
    isRegistered: () => true, getPrivateArea: () => area, getLocation: () => location,
    isOwnerOnly: () => true, getOwner: () => player, isVisible: () => true,
    getIndex: () => 42, getCurrentDefinition: () => ({ getName: () => 'Burntof' }),
    forceChat: (text) => chats.push(text),
  };
  player.manager = new DialogueManager(player);
  const transcript = [
    { type: 'line', speaker: 'Burntof', text: 'Yaaa*hic*aawn', presentation: 'overhead' },
    { player: 'The transcript continues.' },
  ];
  const play = () => startDialogue({ core: PluginManager.getCoreApi(), emitCustomEvent() {} }, {
    player, npc: null, npcId: 10661, definition: { getId: () => 10661, getName: () => 'Willow' },
  }, transcript, {}, { player, npc: null, npcId: 10661, definition: { getId: () => 10661, getName: () => 'Willow' }, pages: [], speakerIdByName: new Map([['Burntof', 10664]]) });

  try {
    TaskManager.pendingTasks.clear();
    TaskManager.activeTasks.length = 0;
    play();
    assert.deepEqual(chats, ['Yaaa*hic*aawn']);
    assert.ok(player.manager.getCurrent() instanceof ActionDialogue);
    TaskManager.process();
    TaskManager.process();
    assert.ok(player.manager.getCurrent() instanceof PlayerDialogue, 'the scheduled overhead continuation resumes the next line');

    player.manager.reset();
    play();
    assert.ok(player.manager.getCurrent() instanceof ActionDialogue);
    player.manager.advance(); // A plugin moving the chain on, not a native Continue.
    TaskManager.process();
    TaskManager.process();
    assert.equal(player.manager.getCurrent(), undefined, 'advancing the internal action invalidates its guarded continuation');

    player.manager.reset();
    play();
    // Held Space: a native Continue on the chatbox still showing reaches the waiting overhead.
    assert.equal(player.manager.handleResume((231 << 16) | 5, -1), true);
    assert.ok(player.manager.getCurrent() instanceof ActionDialogue, 'a Continue does not skip the overhead cadence');
    TaskManager.process();
    TaskManager.process();
    assert.ok(player.manager.getCurrent() instanceof PlayerDialogue, 'the overhead still continues on its own timer');
  } finally {
    TaskManager.cancelTasks(player);
    TaskManager.pendingTasks.clear();
    TaskManager.activeTasks.length = 0;
  }
});

test('an explicitly bound overhead scene actor is still local, visible, registered and owner scoped', () => {
  const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const { TaskManager } = require('../dist/game/task/TaskManager');
  const transcript = [{ type: 'line', speaker: 'Guard Dog', text: 'Woof!', presentation: 'overhead' }];
  const run = ({ registered = true, visible = true, owner = null, area = null, z = 0, local = true } = {}) => {
    const chats = [], scene = {}, playerLocation = { getZ: () => 0, getDistance: () => 1 };
    const npcLocation = { getZ: () => z };
    const sender = new Proxy({}, { get: (_target, _key) => (..._args) => sender });
    const player = {
      isRegistered: () => true,
      getLocation: () => playerLocation,
      getPrivateArea: () => scene,
      getLocalNpcs: () => local ? [actor] : [],
      getPacketSender: () => sender,
      sendMessage: () => {},
      getDialogueManager() { return this.manager; },
    };
    const actor = {
      isRegistered: () => registered,
      isVisible: () => visible,
      isOwnerOnly: () => true,
      getOwner: () => owner ?? player,
      getPrivateArea: () => area ?? scene,
      getLocation: () => npcLocation,
      getCurrentDefinition: () => ({ getName: () => 'Dog' }),
      forceChat: text => chats.push(text),
    };
    player.manager = new DialogueManager(player);
    const api = {
      core: PluginManager.getCoreApi(),
      emitCustomEvent(name, request) { if (name === 'npc-dialogue:line') request.actors = [actor]; },
    };
    const event = { player, npc: null, npcId: 14303, definition: { getId: () => 14303, getName: () => 'Captain Vibia' } };
    startDialogue(api, event, transcript, {}, { ...event, pages: [], speakerIdByName: new Map() });
    return { chats, player };
  };

  try {
    TaskManager.pendingTasks.clear();
    TaskManager.activeTasks.length = 0;
    assert.deepEqual(run().chats, ['Woof!'], 'an explicit alias binds the real local Dog actor');
    assert.deepEqual(run({ owner: {} }).chats, [], 'a different owner cannot speak in this scene');
    assert.deepEqual(run({ area: {} }).chats, [], 'an actor in another private area is rejected');
    assert.deepEqual(run({ visible: false }).chats, [], 'an invisible actor is rejected');
    assert.deepEqual(run({ registered: false }).chats, [], 'a removed actor is rejected');
    assert.deepEqual(run({ local: false }).chats, [], 'an actor absent from the local NPC list is rejected');
    assert.deepEqual(run({ z: 1 }).chats, [], 'an actor on another plane is rejected');
  } finally {
    TaskManager.pendingTasks.clear();
    TaskManager.activeTasks.length = 0;
  }
});

test('a collective overhead validates the entire local cast before any actor speaks', () => {
  const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const { TaskManager } = require('../dist/game/task/TaskManager');
  const chats = [];
  const sender = new Proxy({}, { get: (_target, _key) => (..._args) => sender });
  const area = {};
  const location = { getZ: () => 0, getDistance: () => 1 };
  const player = {
    isRegistered: () => true,
    getLocation: () => location,
    getPrivateArea: () => area,
    sendMessage: () => {},
    getPacketSender: () => sender,
    getDialogueManager() { return this.manager; },
  };
  const actors = Array.from({ length: 4 }, (_, index) => ({
    isRegistered: () => true,
    isVisible: () => true,
    isOwnerOnly: () => true,
    getOwner: () => player,
    getPrivateArea: () => area,
    getLocation: () => location,
    getCurrentDefinition: () => ({ getName: () => `Scene actor ${index}` }),
    forceChat: text => chats.push([index, text]),
  }));
  player.getLocalNpcs = () => actors;
  player.manager = new DialogueManager(player);
  const event = { player, npc: null, npcId: 11437, definition: { getId: () => 11437, getName: () => 'Wizard Persten' } };
  const step = { type: 'line', speaker: 'Persten and co.', text: 'Saris! Val! Curak! Belito!', presentation: 'overhead' };
  const run = cast => {
    player.manager.reset();
    chats.length = 0;
    startDialogue({
      core: PluginManager.getCoreApi(),
      emitCustomEvent(name, request) { if (name === 'npc-dialogue:line') request.actors = cast; },
    }, event, [step], {}, { ...event, pages: [], speakerIdByName: new Map() });
    return [...chats];
  };
  try {
    TaskManager.pendingTasks.clear();
    TaskManager.activeTasks.length = 0;
    assert.deepEqual(run(actors), actors.map((_, index) => [index, step.text]));
    assert.deepEqual(run([actors[0], actors[1], undefined, actors[3]]), [], 'a partial cast cannot chant as if all actors were present');
    assert.deepEqual(run([...actors.slice(0, 3), undefined]), [], 'an incomplete group does not speak');
  } finally {
    TaskManager.cancelTasks(player);
    TaskManager.pendingTasks.clear();
    TaskManager.activeTasks.length = 0;
  }
});

test('ordinary typed player-placeholder lines still use the player chathead', () => {
  const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const { PlayerDialogue } = require('../dist/game/model/dialogues/entries/impl/PlayerDialogue');
  const sender = new Proxy({}, { get: () => (..._args) => sender });
  const player = {
    getUsername: () => 'Test', getDisplayName: () => 'Test',
    getAppearance: () => ({ isMale: () => true }),
    isRegistered: () => true,
    getPacketSender: () => sender,
    getDialogueManager() { return this.manager; },
  };
  player.manager = new DialogueManager(player);
  const line = data['Desert Treasure II - The Fallen Empire'].variants[
    'the-whisperer-inspecting-the-totem-in-the-cistern'].find((step) =>
      step.type === 'line' && step.speaker === '[player name]' && step.presentation !== 'overhead');
  assert.ok(line, 'the variant still has ordinary typed player lines');
  startDialogue({ core: PluginManager.getCoreApi(), emitCustomEvent() {} }, {
    player, npcId: 12232, definition: { getId: () => 12232, getName: () => 'Ketla' },
  }, [line]);
  const spoken = player.manager.getCurrent();
  assert.ok(spoken instanceof PlayerDialogue);
  assert.equal(spoken.getText().replace(/\s+/g, ' '), line.text.replace(/\s+/g, ' '));
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
  const player = { getUsername: () => 'Test', getDisplayName: () => 'Test', getDialogueManager: () => manager };
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
  const player = { getUsername: () => 'Test', getDisplayName: () => 'Test', getDialogueManager: () => ({ startDialogues: value => { chain = value; } }) };
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

test('conditional menu options resolve by their source condition id', () => {
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const previous = PluginManager.emitNpcDialogueCondition;
  const seen = [];
  const menus = [];
  PluginManager.emitNpcDialogueCondition = (request) => {
    seen.push(request.stepId);
    return request.stepId === 'condition-source-id' ? false : null;
  };
  try {
    const player = {
      getDialogueManager: () => ({ reset() {}, startDialogues(chain) {
        for (const entry of chain.getDialogues().values()) entry.send(player);
      } }),
      getPacketSender: () => ({ sendInterfaceRemoval() {} }),
      sendMessage() {},
    };
    const event = { player, npcId: 1, npc: null, definition: { getName: () => 'Guard' } };
    startDialogue({ emitCustomEvent() {}, sendMultiChatboxPrompt(_player, _title, ...pairs) {
      menus.push(pairs.filter((_, index) => index % 2 === 0));
    } }, event, [{ type: 'choice', options: [
      { text: 'Hidden', id: 'option-id', condition: 'If ready:', condition_id: 'condition-source-id' },
      { text: 'Visible', id: 'other-option' },
    ] }], {}, { ...event, pages: [] });
    assert.deepEqual(seen, ['condition-source-id']);
    assert.equal(menus.length, 1);
    assert.equal(menus[0][0], 'Visible');
    assert.ok(!menus[0].includes('Hidden'));

    const randomActions = [];
    const randomPlayer = {
      getDialogueManager: () => ({ reset() {}, startDialogues(chain) {
        for (const entry of chain.getDialogues().values()) entry.send(randomPlayer);
      } }),
      getPacketSender: () => ({ sendInterfaceRemoval() {} }),
      sendMessage() {},
    };
    const originalRandom = Math.random;
    Math.random = () => 0;
    try {
      startDialogue({ emitCustomEvent(name, request) {
        if (name === 'npc-dialogue:action') randomActions.push(request.stepId);
      } }, { ...event, player: randomPlayer }, [{ type: 'random', options: [
        { text: 'Hidden', id: 'random-option-id', condition: 'If ready:', condition_id: 'condition-source-id', steps: [{ type: 'action', id: 'hidden-action' }] },
        { text: 'Visible', id: 'random-visible', steps: [{ type: 'action', id: 'visible-action' }] },
      ] }], {}, { player: randomPlayer, npcId: 1, pages: [] });
    } finally {
      Math.random = originalRandom;
    }
    assert.ok(randomActions.includes('visible-action'));
    assert.ok(!randomActions.includes('hidden-action'));
    assert.deepEqual(seen, ['condition-source-id', 'condition-source-id']);
  } finally {
    PluginManager.emitNpcDialogueCondition = previous;
  }
});

test('typed speakers retain their name with a nameless transform-parent head and captured expressions', () => {
  let chain;
  const sent = [], sender = new Proxy({}, { get: (_target, key) => (...args) => { sent.push([key, ...args]); return sender; } });
  const player = { getUsername: () => 'Test', getDisplayName: () => 'Test', getPacketSender: () => sender,
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
  const player = { getUsername: () => 'Test', getDisplayName: () => 'Test', getPacketSender: () => sender,
    getDialogueManager: () => ({ startDialogues: value => { chain = value; } }) };
  startDialogue({ emitCustomEvent(_name, request) { request.speakerId = 16536; request.side = 'right'; } },
    { player, npcId: 16527, definition: { getName: () => 'Outlaw', getId: () => 16527 } },
    [{ type: 'line', speaker: 'Outlaw', text: "A little mangy mutt. Can we keep 'em?" }]);
  [...chain.getDialogues().values()][0].send(player);
  assert.ok(sent.some(row => row[0] === 'sendChatboxInterface' && row[1] === 217));
  assert.ok(sent.some(row => row[0] === 'sendNpcHeadOnInterface' && row[1] === 16536 && row[2] === (217 << 16 | 2)));
  assert.ok(!sent.some(row => row[0] === 'sendPlayerHeadOnInterface'));
});

test('Talk-to warns once per NPC name when it falls back to the placeholder line', (t) => {
  const NpcDialogues = require('../plugins/npcs/NpcDialogues.plugin');
  const { PluginManager } = require('../dist/plugins/PluginManager');
  const warn = t.mock.method(console, 'warn', () => {});
  let talk;
  NpcDialogues.register({
    core: { ...PluginManager.getCoreApi(), NpcDefinition: { forId: () => ({ getName: () => 'null' }) } },
    onCustomEvent() {}, emitCustomEvent() {},
    onAnyNpcInteraction(actions) { talk = actions['Talk-to']; },
  });
  const chains = [];
  const player = { getUsername: () => 'Test', getDisplayName: () => 'Test', getDialogueManager: () => ({ reset() {}, startDialogues: chain => chains.push(chain) }) };
  const talkTo = (name) => talk({ player, npc: null, npcId: -1, definition: { getName: () => name, getId: () => 0 } });
  const placeholder = () => [...chains.at(-1).getDialogues().values()][0].getText();

  // No transcript at all.
  talkTo('Nobody with a transcript'); talkTo('Nobody with a transcript');
  assert.equal(placeholder(), "Sorry, i've nothing interesting to talk about yet");
  // A transcript of overhead shouts only: pickVariant has nothing to play.
  assert.equal(pickVariant(data['Battle mage']), undefined);
  talkTo('Battle mage'); talkTo('Battle mage');
  assert.equal(placeholder(), "Sorry, i've nothing interesting to talk about yet");
  // A playable transcript stays quiet.
  talkTo('Hans');

  const warnings = warn.mock.calls.map(call => String(call.arguments[0]));
  assert.equal(warnings.length, 2, warnings.join('\n'));
  assert.match(warnings[0], /Nobody with a transcript .*no transcript reaches it/);
  assert.match(warnings[1], /Battle mage .*transcript "Battle mage" has no playable variant/);
});

test('cancelling mid-chain through closeInterruptibleInterfaces leaves no stuck dialogue', async () => {
  const { CachePipeline } = require('../dist/game/cache/CachePipeline');
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PacketSender } = require('../dist/net/packet/PacketSender');
  const { DialogueManager } = require('../dist/game/model/dialogues/DialogueManager');
  const { PlayerStatus } = require('../dist/game/model/PlayerStatus');
  await CachePipeline.initialize(process.cwd());
  const sender = new Proxy({}, { get: () => () => sender });
  const player = { getUsername: () => 'Test', getDisplayName: () => 'Test', getPacketSender: () => sender, getDialogueManager: () => manager,
    getSession: () => ({ sendClientPacket() {} }), getInterfaceId: () => -1, getFrameUpdater: () => ({ clearGroup() {} }) };
  const manager = new DialogueManager(player);
  // The fields Player.closeInterruptibleInterfaces reads; the real PacketSender does the reset.
  const core = { status: PlayerStatus.NONE, interfaceId: -1, dialogueManager: manager, packetSender: new PacketSender(player) };
  const definition = { getName: () => 'Hans', getId: () => 3105 };
  const shown = () => manager.getCurrent()?.getText?.();
  const talk = () => startDialogue({ emitCustomEvent() {} }, { player, npcId: 3105, definition },
    [{ npc: 'One.' }, { npc: 'Two.' }, { npc: 'Three.' }]);

  talk();
  manager.advance();
  assert.equal(shown(), 'Two.');
  Player.prototype.closeInterruptibleInterfaces.call(core);
  assert.equal(manager.isActive(), false);
  assert.equal(manager.getCurrent(), undefined);
  // A late continue click from the closed chatbox resumes nothing.
  assert.equal(manager.handleResume(231 << 16, -1), false);
  assert.equal(manager.getCurrent(), undefined);
  // Talking again starts over from the first line, not the abandoned tail.
  talk();
  assert.equal(shown(), 'One.');
});

test('npc-dialogue:line skip applies to one player and one line only', () => {
  const steps = [{ npc: 'Hello.' }, { npc: 'Here is your reward.' }, { npc: 'Goodbye.' }];
  const definition = { getName: () => 'Hans', getId: () => 3105 };
  const chains = new Map();
  const makePlayer = (name) => ({ getUsername: () => name, getDisplayName: () => name,
    getDialogueManager: () => ({ reset() {}, startDialogues: chain => chains.set(name, chain) }) });
  const alice = makePlayer('Alice'), bob = makePlayer('Bob');
  const seen = [];
  const api = { emitCustomEvent(name, request) {
    if (name !== 'npc-dialogue:line') return;
    seen.push([request.player.getUsername(), request.text, request.skip]);
    if (request.player === alice && request.text === 'Here is your reward.') request.skip = true;
  } };
  const lines = (name) => [...chains.get(name).getDialogues().values()].filter(entry => entry.getText).map(entry => entry.getText());

  startDialogue(api, { player: alice, npcId: 3105, definition }, steps);
  startDialogue(api, { player: bob, npcId: 3105, definition }, steps);
  assert.deepEqual(lines('Alice'), ['Hello.', 'Goodbye.']);
  assert.deepEqual(lines('Bob'), ['Hello.', 'Here is your reward.', 'Goodbye.']);
  // Every line starts unskipped: a skip never carries to the next line or another player.
  assert.ok(seen.every(([, , skip]) => skip === false));
  assert.ok(steps.every(step => !('skip' in step)), 'the shared transcript steps are not marked');
  startDialogue(api, { player: bob, npcId: 3105, definition }, steps);
  assert.deepEqual(lines('Bob'), ['Hello.', 'Here is your reward.', 'Goodbye.']);
});

test('live condition runs fall through only after a chosen true branch', () => {
  const { PluginManager } = require('../dist/plugins/PluginManager');
  let answers = {};
  const condition = { pluginName: 'test', handler: ({ text }) => Object.hasOwn(answers, text) ? answers[text] : null };
  PluginManager.npcDialogueConditionHooks.unshift(condition);

  const play = (tree, script = []) => {
    const lines = [];
    const actions = [];
    const player = {
      getDialogueManager: () => ({ reset() {}, startDialogues(chain) {
        for (const entry of [...chain.getDialogues().values()].sort((a, b) => a.getIndex() - b.getIndex())) {
          if (entry.constructor.name === 'ActionDialogue') entry.send(player);
          else if (entry.text) lines.push(String(entry.text));
        }
      } }),
      getPacketSender: () => ({ sendInterfaceRemoval() {} }),
      sendMessage() {},
    };
    const definition = { getName: () => 'Guard', getId: () => 1 };
    const event = { player, npcId: 1, npc: null, definition };
    const api = {
      emitCustomEvent(name, request) {
        if (name !== 'npc-dialogue:action' || !request.stepId) return;
        actions.push(request.stepId);
        if (request.stepId === 'flag') answers['If flag:'] = true;
      },
      sendMultiChatboxPrompt(_player, _title, ...pairs) {
        const pick = script.shift();
        for (let i = 0; i < pairs.length; i += 2) if (pairs[i] === pick) { pairs[i + 1](); return true; }
        assert.fail(`missing menu option ${pick}`);
      },
    };
    startDialogue(api, event, tree, {}, { ...event, pages: [] });
    return { lines, actions };
  };

  try {
    // A true, unended branch continues; the next true branch's end stops the run.
    answers = { 'If A:': true, 'If B:': true, 'If C:': true };
    assert.deepEqual(play([
      { type: 'condition', text: 'If A:', steps: [{ npc: 'a' }] },
      { type: 'condition', text: 'If B:', steps: [{ npc: 'b' }, { type: 'end' }] },
      { type: 'condition', text: 'If C:', steps: [{ npc: 'c' }] },
      { npc: 'tail' },
    ]).lines, ['a', 'b']);

    // With no true answer the first unknown still plays and does not fall through.
    answers = { 'If A:': null, 'If B:': null };
    assert.deepEqual(play([
      { type: 'condition', text: 'If A:', steps: [{ npc: 'a' }] },
      { type: 'condition', text: 'If B:', steps: [{ npc: 'b' }] },
      { npc: 'tail' },
    ]).lines, ['a', 'tail']);

    // An explicit continue still reaches later siblings when the answer is unknown.
    answers = { 'If A:': null, 'If B:': null };
    assert.deepEqual(play([
      { type: 'condition', text: 'If A:', steps: [{ npc: 'a' }, { type: 'jump', reference: 'continues' }] },
      { type: 'condition', text: 'If B:', steps: [{ npc: 'b' }] },
    ]).lines, ['a', 'b']);

    // Nested menus keep their existing control flow; only linear true branches implicitly continue.
    answers = { 'If A:': true, 'If B:': true };
    assert.deepEqual(play([
      { type: 'condition', text: 'If A:', steps: [{ type: 'choice', options: [
        { text: 'yes', steps: [{ npc: 'yes' }] },
        { text: 'no', steps: [{ npc: 'no' }, { type: 'end' }] },
      ] }] },
      { type: 'condition', text: 'If B:', steps: [{ npc: 'after' }] },
    ], ['yes']).lines, ['yes']);
    assert.deepEqual(play([
      { type: 'condition', text: 'If A:', steps: [{ type: 'choice', options: [
        { text: 'yes', steps: [{ npc: 'yes' }] },
        { text: 'no', steps: [{ npc: 'no' }, { type: 'end' }] },
      ] }] },
      { type: 'condition', text: 'If B:', steps: [{ npc: 'after' }] },
    ], ['no']).lines, ['no']);

    // A branch action changes the next sibling guard before it is resolved.
    answers = { 'If A:': true };
    const branchAction = play([
      { type: 'condition', text: 'If A:', steps: [{ type: 'action', id: 'flag' }] },
      { type: 'condition', text: 'If flag:', steps: [{ npc: 'guarded' }] },
    ]);
    assert.deepEqual(branchAction.actions, ['flag']);
    assert.deepEqual(branchAction.lines, ['guarded']);

    // Lazy conditions see an action that ran before the following guard.
    answers = {};
    const run = play([
      { type: 'action', id: 'flag', action: 'set flag' },
      { type: 'condition', text: 'If flag:', steps: [{ npc: 'guarded' }] },
    ]);
    assert.deepEqual(run.actions, ['flag']);
    assert.deepEqual(run.lines, ['guarded']);
  } finally {
    PluginManager.npcDialogueConditionHooks.splice(PluginManager.npcDialogueConditionHooks.indexOf(condition), 1);
  }
});

test('dialogue alternatives follow saved pronouns independently of the body', () => {
  const { formatPlayerText } = require('../plugins/npcs/NpcDialogues.plugin');
  const player = (value) => ({ getUsername: () => 'Alex', getAppearance: () => ({ isMale: () => false, getPronouns: () => value }) });
  assert.equal(formatPlayerText('[He/She/They] is ready.', player(0)), 'He is ready.');
  assert.equal(formatPlayerText('[He/She/They] is ready.', player(1)), 'She is ready.');
  assert.equal(formatPlayerText('[He/She/They] are ready.', player(2)), 'They are ready.');
  assert.equal(formatPlayerText('[Greetings, sir/Greetings, madam/Greetings]', player(2)), 'Greetings');
});


test('initial recovery rejects mutually exclusive prior menus instead of taking the first condition', () => {
  const variant = 'forming-a-fellowship-capturing-a-spy-talking-to-akrisae-after-the-truth-serum-breaks';
  assert.equal(collectMenuBefore(data['While Guthix Sleeps'], variant,
    { initial: true, callerName: 'Akrisae' }), undefined);
  const menu = { type: 'choice', options: [{ text: 'Old option', steps: [] }] };
  const line = { type: 'line', speaker: 'Akrisae', text: 'Hello.' };
  const record = { variants: {
    'talking-first': [line, menu],
    'talking-conditional': [line,
      { type: 'condition', text: 'If available:', steps: [menu] },
      { type: 'condition', text: 'If used:', steps: [menu] }],
    'talking-again': [line],
  } };
  assert.equal(collectMenuBefore(record, 'talking-again',
    { initial: true, callerName: 'Akrisae' }), undefined, 'ambiguity cannot fall back to an older menu');
});

test('below plus queued choice preserves supplied jump results and inline priority', () => {
  const jump = { type: 'jump', reference: 'below' };
  const choice = { type: 'choice', options: [{ text: 'Continue', steps: [] }] };
  const body = [{ npc: 'Resolved continuation' }];
  const menu = { step: choice, rest: [] };
  for (const [result, expected] of [
    [body, [{ type: 'jump_to', steps: body }, choice]],
    ['end', [{ type: 'end' }]],
    [{ menu }, [{ type: 'gomenu', menu }, choice]],
    [null, [choice]],
  ]) {
    let calls = 0;
    assert.deepEqual(flatten([jump, choice], { resolveJump() { calls++; return result; } }), expected);
    assert.equal(calls, 1, 'the supplied resolver decides the unresolved jump');
  }
  assert.deepEqual(flatten([{ ...jump, steps: body }, choice], {
    resolveJump() { assert.fail('an inline target must bypass the resolver'); },
  }), [{ type: 'jump_to', steps: body }, choice]);
});

// Exercise production resolution with real startDialogue, recording its visible
// lines and menus while synchronously executing only ActionDialogue entries.
function belowContinuationPlayback(steps, context = {}, selected = null) {
  const said = [], prompts = [];
  const player = {
    getDialogueManager: () => ({ reset() {}, startDialogues(chain) {
      for (const entry of chain.getDialogues().values()) {
        if (entry.constructor.name === 'ActionDialogue') entry.send(player);
      }
    } }),
    getPacketSender: () => ({ sendInterfaceRemoval() {} }), sendMessage() {},
  };
  const event = { player, npcId: 3490, definition: { getId: () => 3490, getName: () => 'Jorral' } };
  const api = {
    emitCustomEvent(name, request) { if (name === 'npc-dialogue:line') said.push(request.text); },
    sendMultiChatboxPrompt(_player, title, ...pairs) {
      prompts.push(title);
      if (selected !== null) {
        const label = selected;
        selected = null;
        const index = pairs.indexOf(label);
        assert.ok(index >= 0, `option ${label} exists`);
        pairs[index + 1]();
      }
      return true;
    },
  };
  startDialogue(api, event, steps, {}, { ...event, pages: [], ...context });
  return { said, prompts };
}

test('production below keeps matching player and NPC continuations ahead of a queued menu', () => {
  const menu = { type: 'choice', prompt: 'Queued', options: [{ text: 'Bye', steps: [] }] };
  const jump = { type: 'jump', reference: 'below' };
  const strong = { npc: 'The matched continuation.' };
  const question = 'What should I do?';
  const line = 'I know the answer.';
  const player = belowContinuationPlayback([{ player: question }, jump, menu], {
    pageOptions: new Map([['whatshouldido', [{ player: question }, strong]]]),
  });
  assert.deepEqual(player.said, [question, strong.npc]);
  assert.deepEqual(player.prompts, ['Queued']);
  const npc = belowContinuationPlayback([{ npc: line }, jump, menu], {
    pageLines: new Map([['iknowtheanswer', [{ npc: line }, strong]]]),
  });
  assert.deepEqual(npc.said, [line, strong.npc]);
  assert.deepEqual(npc.prompts, ['Queued']);
});

test('production below uses an adjacent menu but retains historical above and nonadjacent below', () => {
  const queued = { type: 'choice', prompt: 'Follow-up', options: [{ text: 'Bye', steps: [] }] };
  const tree = (reference, adjacent) => [{ type: 'choice', prompt: 'Topics', options: [
    { text: 'First', steps: [{ npc: 'First topic.' }, ...(reference === 'below'
      ? [{ type: 'jump', reference }, ...(adjacent ? [] : [{ npc: 'Tail.' }]), queued] : [])] },
    { text: 'Second', steps: [{ npc: 'Second topic.' }, ...(reference === 'above' ? [{ type: 'jump', reference }, queued] : [])] },
  ] }];
  const adjacent = belowContinuationPlayback(tree('below', true), {}, 'First');
  assert.deepEqual(adjacent.said, ['First topic.']);
  assert.deepEqual(adjacent.prompts, ['Topics', 'Follow-up']);
  const nonadjacent = belowContinuationPlayback(tree('below', false), {}, 'First');
  assert.deepEqual(nonadjacent.said, ['First topic.', 'Second topic.', 'Tail.']);
  assert.deepEqual(nonadjacent.prompts, ['Topics', 'Follow-up']);
  const above = belowContinuationPlayback(tree('above', true), {}, 'Second');
  assert.deepEqual(above.said, ['Second topic.', 'First topic.']);
  assert.deepEqual(above.prompts, ['Topics', 'Follow-up']);
});
