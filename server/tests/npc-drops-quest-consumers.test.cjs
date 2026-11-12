// Source-level (no build): node --test tests/npc-drops-quest-consumers.test.cjs
// Quest plugins answer `npc-drops:quest-item` for rows the dump gates behind a quest. The pinned export
// names a quest only when its title is a known quest page, so these rows' shapes are pinned here.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const dump = require('../data/definitions/npc-drops.json');

const read = (file) => fs.readFileSync(path.resolve(__dirname, file), 'utf8');
const rows = (itemId) => Object.entries(dump.tables)
    .flatMap(([id, table]) => ['entries', 'tertiary'].flatMap(field => (table[field] ?? []).filter(e => e.item_id === itemId).map(e => [id, e])));
const typed = (entry) => (entry.notes ?? []).map(n => /^Quest requirement: WikiQuestDropRequirement\(questKey=([^,]+), mode=([A-Za-z]+)\)$/.exec(n)).filter(Boolean);

test('the Suqah tiara rows carry the Lunar Diplomacy key the quest plugin answers', () => {
    const SPECIAL_TIARA = 9103;
    const tiaras = rows(SPECIAL_TIARA);
    assert.ok(tiaras.length > 0, 'the tiara is still a table row');
    for (const [id, entry] of tiaras) assert.deepEqual(typed(entry).map(m => [m[1], m[2]]), [['quest_lunardiplomacy', 'RequiresDuring']], id);
    const plugin = read('../plugins/quests/quests/LunarDiplomacy.Quest.js');
    assert.match(plugin, /const TIARA_DROP_QUEST_KEY = "quest_lunardiplomacy";/);
});

test('the Dragon token row has no typed requirement, and NpcDrops gates it by item id', () => {
    const DRAGON_TOKEN = 7478;
    const tokens = rows(DRAGON_TOKEN);
    assert.ok(tokens.some(([id, entry]) => id === 'black_dragon' && entry.always), 'still a guaranteed black dragon row');
    for (const [, entry] of tokens) assert.equal(typed(entry).length, 0);
    assert.match(read('../plugins/npcs/NpcDrops.plugin.js'), /QUEST_REQUIREMENT_BY_ITEM = new Map\(\[\s*\[7478,/);
    assert.match(read('../plugins/quests/quests/RecipeForDisaster.Quest.js'), /event\?\.itemId !== ItemIdentifiers\.DRAGON_TOKEN\) return;\s*event\.allowed = false;/);
});
