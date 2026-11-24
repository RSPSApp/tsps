import assert from "node:assert/strict";
import { test } from "node:test";

import {
    SERVER_MAP_ICON_SPRITE_START,
    customMapElement,
    resolveMapElement,
} from "../custom/sprites/CustomMapElement";

test("customMapElement resolves server-sprite map function ids (>= 30000) centred on their tile", () => {
    const mel = customMapElement(30100);
    assert.ok(mel);
    assert.equal(mel.spriteId, 30100);
    assert.equal(mel.minimapVisible, true);
    assert.equal(mel.worldMapVisible, true);
    assert.equal(mel.category, -1);
    assert.equal(mel.horizontalAlignment, 0);
    assert.equal(mel.verticalAlignment, 0);
});

test("customMapElement leaves stock cache map element ids untouched", () => {
    assert.equal(customMapElement(-1), undefined);
    assert.equal(customMapElement(0), undefined);
    assert.equal(customMapElement(1271), undefined);
    assert.equal(customMapElement(SERVER_MAP_ICON_SPRITE_START - 1), undefined);
    assert.equal(customMapElement(SERVER_MAP_ICON_SPRITE_START)?.spriteId, SERVER_MAP_ICON_SPRITE_START);
});

test("resolveMapElement overrides blank cache elements (spriteId: -1) for world-map lookup", () => {
    // ArchiveTypeLoader.load returns a blank MapElementType with spriteId: -1 for missing ids.
    const blankCacheLoader = (id: number) => ({ id, spriteId: -1, category: -1, worldMapVisible: true });
    const element = resolveMapElement(30100, blankCacheLoader);
    const drawnSpriteId = (element?.spriteId ?? -1) | 0;
    assert.equal(drawnSpriteId, 30100);
    assert.equal(element?.worldMapVisible, true);
});

test("resolveMapElement delegates stock ids to the cache loader", () => {
    const stock = { id: 42, spriteId: 1487, category: 3, worldMapVisible: true };
    const element = resolveMapElement(42, (id) => (id === 42 ? stock : undefined));
    assert.equal(element, stock);
});
