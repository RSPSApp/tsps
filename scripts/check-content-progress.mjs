import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const data = JSON.parse(readFileSync(new URL('../docs/progress/osrs-progress.json', import.meta.url), 'utf8'));
const statuses = new Set(['todo', 'in-progress', 'done']);
const names = new Set();
let count = 0;
assert.match(data.updated, /^\d{4}-\d{2}-\d{2}$/);
assert.ok(data.schema && Array.isArray(data.instructions));
assert.ok(Array.isArray(data.categories) && data.categories.length);
for (const category of data.categories) {
  assert.ok(typeof category.name === 'string' && category.name.trim());
  assert.ok(!names.has(category.name), `Duplicate category: ${category.name}`);
  names.add(category.name);
  assert.ok(Array.isArray(category.items));
  const items = new Set();
  for (const item of category.items) {
    const label = `${category.name}/${item.name}`;
    assert.ok(typeof item.name === 'string' && item.name.trim(), label);
    assert.ok(!items.has(item.name), `Duplicate item: ${label}`);
    items.add(item.name);
    assert.ok(Array.isArray(item.tasks) && item.tasks.length === 4, `${label}: four statuses required`);
    assert.ok(item.tasks.every(status => statuses.has(status)), `${label}: invalid status`);
    assert.ok(item.weight === undefined || (Number.isFinite(item.weight) && item.weight >= 0), `${label}: invalid weight`);
    const details = item.taskDetails ?? category.taskTemplate;
    assert.ok(Array.isArray(details) && details.length === 4, `${label}: four task descriptions required`);
    for (const task of details) {
      assert.ok(typeof task.name === 'string' && task.name.trim(), `${label}: unnamed task`);
      for (const field of ['steps', 'acceptanceCriteria']) {
        assert.ok(Array.isArray(task[field]) && task[field].every(value => typeof value === 'string'), `${label}: invalid ${field}`);
      }
      assert.ok(task.refs === undefined || (Array.isArray(task.refs) && task.refs.every(value => typeof value === 'string')), `${label}: invalid refs`);
    }
    for (const field of ['devNotes', 'implementedIn']) {
      assert.ok(Array.isArray(item[field]) && item[field].every(value => typeof value === 'string'), `${label}: invalid ${field}`);
    }
    count++;
  }
}
console.log(`Content progress valid: ${data.categories.length} categories, ${count} items. Gameplay claims require review.`);
