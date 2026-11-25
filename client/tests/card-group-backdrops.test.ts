import assert from 'node:assert/strict';
import { filterRows } from '../widgets/custom/CustomInterfaceRuntime';
import { layoutCards, type CardRow, type CardStyle } from '../widgets/custom/cardLayout';
import { cardGroupPaths, CardGroupBackdropPool } from '../widgets/custom/cardGroupBackdrops';

const backdrop = { backgroundStart: 10, borderStart: 50, slotCount: 40, padding: 4,
    backgroundColors: [0x211c16, 0x2b241b], borderColors: [0x806845, 0x9b7f54] };
const style: CardStyle = { minWidth: 112, maxColumns: 5, gap: 8, height: 132, groups: true, groupBackdrops: backdrop };
const source = [
    { id: 1, name: 'Main', header: true }, { id: 2, name: 'Before' },
    { id: 3, name: 'Amounts', expandable: true, collapsed: true },
    { id: 4, name: 'Small', parentId: 3 },
    { id: 5, name: 'Nested', parentId: 3, expandable: true, collapsed: true },
    ...Array.from({ length: 60 }, (_, index) => ({ id: index + 6, name: `Reward ${index}`, parentId: 5 })),
    { id: 66, name: 'Last child', parentId: 3 }, { id: 67, name: 'After' },
    { id: 68, name: 'Next section', header: true }, { id: 69, name: 'Other' },
];
const pack = (rows: CardRow[], width = 648, cardStyle = style) => layoutCards(rows, width, cardStyle, 50, 64, 6, 18);
const expanded = filterRows(source, '', new Map([[3, true], [5, true]]));
for (const width of [1, 112, 222, 510, 648]) {
    const layout = pack(expanded, width);
    const at = (id: number) => layout.placements[expanded.findIndex(row => row.id === id)];
    const outer = layout.backdrops.find(span => span.id === 3)!;
    const inner = layout.backdrops.find(span => span.id === 5)!;
    assert.deepEqual(layout.backdrops.map(span => span.id), [3, 5], 'frames paint outermost first');
    assert.ok(at(3).y > at(2).y + at(2).height, 'an expanded parent never shares a row with an unrelated item');
    assert.ok(outer.y >= at(2).y + at(2).height, 'the preceding item stays outside the frame');
    assert.ok(outer.y + outer.height < at(67).y, 'the following sibling stays outside the frame');
    assert.ok(inner.y >= outer.y && inner.y + inner.height <= outer.y + outer.height);
    for (const row of expanded.filter(row => row.parentId === 3 || row.parentId === 5)) {
        const p = at(row.id);
        assert.ok(p.x >= outer.x && p.x + p.width <= outer.x + outer.width);
        assert.ok(p.y >= outer.y && p.y + p.height <= outer.y + outer.height);
    }
    for (const p of [...layout.placements, ...layout.backdrops]) {
        assert.ok(p.x >= 0 && p.width >= 1 && p.x + p.width <= width);
        assert.ok(p.y >= 0 && p.y + p.height <= layout.height);
    }
    for (let y = 0; y < layout.height; y += 23) {
        assert.ok(layout.placements.filter(p => p.y < y + 801 && p.y + p.height > y).length <= 40);
        assert.ok(layout.backdrops.filter(p => p.y < y + 801 && p.y + p.height > y).length <= backdrop.slotCount);
    }
}

assert.deepEqual(pack(filterRows(source, '')).backdrops, [], 'collapsed groups have no shared frame');
const plain = pack(expanded, 648, { ...style, groupBackdrops: undefined });
assert.deepEqual(plain.backdrops, [], 'interfaces must opt into the extra layout and decoration');
assert.equal(plain.placements[1].y, plain.placements[2].y, 'the original packing remains available');
const search = pack(filterRows(source, 'Reward 59'));
assert.deepEqual(search.backdrops.map(span => span.id), [3, 5], 'search frames the same ancestors it reveals');
assert.deepEqual(pack(filterRows(source, '')).backdrops, [], 'clearing search restores the prior closed groups');
assert.deepEqual(cardGroupPaths([{ id: 1, parentId: 2, expandable: true },
    { id: 2, parentId: 1, expandable: true }, { id: 3, parentId: 99 }]), [[], [], []]);
const deep = Array.from({ length: 14 }, (_, index) => ({ id: index + 1, expandable: true,
    ...(index ? { parentId: index } : {}) }));
assert.equal(cardGroupPaths(deep)[13].length, 0, 'invalid deep ancestry stays bounded');

// Exercise the exact pool API intended for the runtime, independently of its owned source file.
const layout = pack(expanded), pool = new CardGroupBackdropPool();
const widgets = new Map<number, any>();
for (let slot = 0; slot < backdrop.slotCount; slot++) {
    for (const start of [backdrop.backgroundStart, backdrop.borderStart])
        widgets.set(start + slot, { hidden: true, isHidden: true, widthMode: 1, xPositionMode: 2 });
}
let invalidations = 0;
const invalidate = () => { invalidations++; };
const sync = (scrollY: number, spans = layout.backdrops) => pool.sync(spans, backdrop, scrollY, 200, id => widgets.get(id), invalidate);
const inner = layout.backdrops[1];
const scrollY = inner.y + 200;
sync(scrollY);
assert.equal(widgets.get(backdrop.backgroundStart).hidden, false, 'the outer frame survives scrolling its parent offscreen');
assert.equal(widgets.get(backdrop.backgroundStart + 1).hidden, false, 'the nested frame also survives parent pooling');
assert.equal(widgets.get(backdrop.backgroundStart).rawY, layout.backdrops[0].y, 'native scissoring retains the real frame endpoints');
assert.equal(widgets.get(backdrop.backgroundStart + 1).color, backdrop.backgroundColors[1]);
assert.equal(widgets.get(backdrop.backgroundStart).widthMode, 0);
assert.equal(widgets.get(backdrop.backgroundStart).xPositionMode, 0);
const count = invalidations;
sync(scrollY);
assert.equal(invalidations, count, 'an unchanged tick does no decoration work');
sync(layout.height);
assert.ok([...widgets.values()].every(widget => widget.hidden && widget.isHidden), 'leaving a group hides every pooled decoration');
sync(scrollY);
sync(0, []);
assert.ok([...widgets.values()].every(widget => widget.hidden), 'collapse or an empty search result clears stale frames');
const resized = pack(expanded, 222);
pool.sync(resized.backdrops, backdrop, 100, 200, id => widgets.get(id), invalidate);
assert.equal(widgets.get(backdrop.backgroundStart).rawWidth, resized.backdrops[0].width, 'resize updates native geometry');
pool.sync(pack(filterRows(source, '')).backdrops, backdrop, 0, 200, id => widgets.get(id), invalidate);
assert.ok([...widgets.values()].every(widget => widget.hidden), 'a fresh closed examine discards earlier frames');
const nestedOnly = [{ ...layout.backdrops[1], y: 0 }];
pool.sync(nestedOnly, backdrop, 0, 200, id => widgets.get(id), invalidate);
assert.equal(widgets.get(backdrop.backgroundStart).color, backdrop.backgroundColors[1], 'slot reuse applies the new nesting color');
const outerOnly = [{ ...layout.backdrops[0], y: 0 }];
pool.sync(outerOnly, backdrop, 0, 200, id => widgets.get(id), invalidate);
assert.equal(widgets.get(backdrop.backgroundStart).color, backdrop.backgroundColors[0], 'slot reuse restores the outer color');
widgets.set(backdrop.backgroundStart, { hidden: true, isHidden: true });
pool.reset();
pool.sync(outerOnly, backdrop, 0, 200, id => widgets.get(id), invalidate);
assert.equal(widgets.get(backdrop.backgroundStart).hidden, false, 'a remounted native pool repaints after reset');
console.log('card group frames, nesting, responsive layout, search and native decoration pooling passed');
