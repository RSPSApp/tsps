// Run from client/: node --import tsx tests/item-editor.test.ts
import assert from 'node:assert/strict';
import { CacheSystem } from '../rs/cache/CacheSystem';
import { getCacheLoaderFactory } from '../rs/cache/loader/CacheLoaderFactory';
import { loadCache, loadCacheInfos, loadCacheList } from '../scripts/cache/load-util';
import { PlayerAppearance } from '../rs/config/player/PlayerAppearance';
import { PlayerModelLoader } from '../rs/config/player/PlayerModelLoader';
import { CustomItemRegistry } from '../custom/items/CustomItemRegistry';
import { CustomObjTypeLoader } from '../custom/items/CustomObjTypeLoader';
import { ItemPreview, equippedPreviewState, previewEquipment, type ItemRow } from '../custom/item-editor/ItemPreview';
import { animationTimeline, animationFrame } from '../custom/item-editor/ItemPlayback';
import { Model } from '../rs/model/Model';
const info = loadCacheList(loadCacheInfos()).latest;
const factory = getCacheLoaderFactory(info, CacheSystem.fromFiles(info, loadCache(info).files));
const objs = factory.getObjTypeLoader();
const models = factory.getModelLoader();
const kits = factory.getIdkTypeLoader();
const players = new PlayerModelLoader(kits, objs, models, factory.getTextureLoader());
const row = (id: number, slot: number, equipable = true): ItemRow => ({ id, name: objs.load(id).name,
    source: 'cache', noted: id === 1206, equipmentSlot: slot, equipable,
    reason: id === 1206 ? 'Noted items cannot be equipped' : 'This item cannot be equipped' });
for (const id of [440, 1206])
    for (const female of [false, true]) {
        assert.equal(equippedPreviewState(row(id, -1, false), objs.load(id), female).available, false);
    }
for (const female of [false, true]) {
    for (const [id, slot] of [[1205, 3], [1117, 4]]) {
        const original = JSON.stringify(objs.load(id));
        const state = equippedPreviewState(row(id, slot), objs.load(id), female);
        assert.equal(state.reason, '');
        assert.equal(state.available, true);
        const body = female ? PlayerAppearance.defaultFemale(kits) : PlayerAppearance.defaultMale(kits);
        const equipment = new Array(14).fill(-1);
        equipment[state.slot!] = id;
        const base = players.buildStaticModelFromEquipment(body, new Array(14).fill(-1));
        const worn = players.buildStaticModelFromEquipment(body, equipment);
        assert.ok(base && worn);
        assert.ok(worn.verticesCount > 0);
        assert.notEqual(worn.verticesCount, base.verticesCount);
        assert.equal(JSON.stringify(objs.load(id)), original);
    }
}
CustomItemRegistry.register({ id: 60000, baseItemId: 1205,
    objType: { name: 'Missing male model test', maleModel: -1, maleModel1: -1, maleModel2: -1 } });
const missingMale = new CustomObjTypeLoader(objs, info).load(60000);
const customRow: ItemRow = { ...row(1205, 3), id: 60000, source: 'custom' };
assert.deepEqual(equippedPreviewState(customRow, missingMale, false), { available: true, reason: 'Equipped model missing', slot: 3 });
assert.equal(equippedPreviewState(customRow, missingMale, true).reason, '');
const customObjs = new CustomObjTypeLoader(objs, info);
const previewClient = { objTypeLoader: customObjs, modelLoader: models, textureLoader: factory.getTextureLoader(), idkTypeLoader: kits } as any;
assert.throws(() => new ItemPreview(previewClient).render(customRow, 'Model A', 256, 128, 1), /Equipped model missing/);
previewClient.modelLoader = { missCount: 0, getModel() { return undefined; } };
assert.throws(() => new ItemPreview(previewClient).render(row(1205, 3), 'Inventory', 0, 0, 1), error => error instanceof Error && error.message.includes('unavailable') && !error.message.includes('Waiting'));
previewClient.modelLoader = { missCount: 0, getModel() { this.missCount++; return undefined; } };
assert.throws(() => new ItemPreview(previewClient).render(row(1205, 3), 'Inventory', 0, 0, 1), /Waiting for cache assets/);
assert.equal(missingMale.femaleModel, objs.load(1205).femaleModel);
assert.equal(missingMale.model, objs.load(1205).model);
CustomItemRegistry.clear();
assert.equal(equippedPreviewState(row(1205, 12), missingMale, false).reason, '');
assert.equal(equippedPreviewState(row(1205, 88), missingMale, false).reason, 'Equipment definition unavailable');
console.log('Item preview: cache models A/B, armour composition, missing geometry and disabled tabs passed');
// Palette uses original model face colors; compiled maps survive sequential
// replacements, including swaps and pre-existing base recolours.
import { compileColors, effectiveColor, recolorSelection, modelColors, hexHsl } from '../custom/item-editor/ItemColors';
const rawColors = [10, 20, 30, 40];
const desired = new Map([[10, 20], [20, 10], [30, 40], [40, 50]]);
const compiled = compileColors(rawColors, desired);
for (const raw of rawColors)
    assert.equal(effectiveColor(raw, compiled), desired.get(raw));
const baseColors = { id: 60001, baseItemId: 1205, objType: { name: 'Palette fixture', recolorFrom: [10, 20], recolorTo: [20, 100] } };
const transformed = recolorSelection(baseColors, rawColors, [10], '#9147d8', true, 0);
assert.equal(effectiveColor(10, transformed.objType) & 127, 100 & 127);
for (const raw of [20, 30, 40])
    assert.equal(effectiveColor(raw, transformed.objType), effectiveColor(raw, baseColors.objType));
assert.ok(hexHsl('#9147d8').sat > 0); // Gray metal can receive a saturated hue.
const dagger = objs.load(1205);
const paletteClient = { modelLoader: models } as any;
const originalBytes = Array.from(models.getModel(dagger.model)!.faceColors);
const palette = modelColors(paletteClient, dagger);
assert.ok(palette.colors.length > 0);
assert.equal(palette.missing.length, 0);
assert.ok(palette.colors.some(color => color.roles.includes('Model A')));
assert.deepEqual(Array.from(models.getModel(dagger.model)!.faceColors), originalBytes);
for (const female of [false, true]) {
    const body = female ? PlayerAppearance.defaultFemale(kits) : PlayerAppearance.defaultMale(kits);
    const equip = new Array(14).fill(-1);
    equip[3] = 60001;
    const colors = palette.colors.map(entry => entry.raw);
    const variant = recolorSelection({ id: 60001, baseItemId: 1205, objType: { name: 'Purple dagger', recolorFrom: [...(dagger.recolorFrom ?? [])], recolorTo: [...(dagger.recolorTo ?? [])] } }, colors, colors, '#9147d8', true, 0);
    CustomItemRegistry.register(variant);
    const worn = new PlayerModelLoader(kits, new CustomObjTypeLoader(objs, info), models, factory.getTextureLoader()).buildStaticModelFromEquipment(body, equip);
    assert.ok(worn && worn.verticesCount > 0);
}
CustomItemRegistry.clear();
console.log('Item recolour: real palette, preserved shading, sequential swaps and custom models A/B passed');
const seqs = factory.getSeqTypeLoader(), frames = factory.getSeqFrameLoader();
const playbackPreview = new ItemPreview({ ...previewClient, seqTypeLoader: seqs, seqFrameLoader: frames,
    skeletalSeqLoader: factory.getSkeletalSeqLoader() } as any);
const attack = seqs.load(376);
const timeline = animationTimeline(attack);
assert.ok(timeline.length > 1);
assert.deepEqual(playbackPreview.prepareAnimation(376), timeline);
for (const id of [393, 395, 396, 11931, 819, 824, 1062, 11240, 7552])
    assert.ok(playbackPreview.prepareAnimation(id).length > 0);
const missingFrames = new ItemPreview({ ...previewClient, seqTypeLoader: seqs, seqFrameLoader: { load: () => undefined } } as any);
assert.throws(() => missingFrames.prepareAnimation(376), /Waiting for cache assets/);
assert.equal(animationFrame(timeline, 0), 0);
assert.equal(animationFrame(timeline, timeline[0] - 1), 0);
assert.equal(animationFrame(timeline, timeline[0]), 1);
assert.equal(animationFrame(timeline, timeline.at(-1)!), -1); // One shot, no wrap.
assert.deepEqual(animationTimeline({ isSkeletalSeq: () => true, getSkeletalDuration: () => 3 } as any), [20, 40, 60]);
assert.deepEqual(animationTimeline({ isSkeletalSeq: () => false, frameIds: [1, 2, 3], frameLengths: [2, 0, 2] } as any), [60, 80, 120]);
for (const female of [false, true]) {
    const appearance = female ? PlayerAppearance.defaultFemale(kits) : PlayerAppearance.defaultMale(kits);
    const equipment = new Array(14).fill(-1);
    equipment[3] = 1215;
    const base = players.buildStaticModelFromEquipment(appearance, equipment)!;
    const original = [...base.verticesX, ...base.verticesY, ...base.verticesZ];
    const animated = Model.copyAnimated(base, false, true);
    animated.animate(frames.load(attack.frameIds[0])!, undefined, !!attack.op14);
    assert.notDeepEqual([...animated.verticesX, ...animated.verticesY, ...animated.verticesZ], original);
    assert.deepEqual([...base.verticesX, ...base.verticesY, ...base.verticesZ], original);
}
console.log('Item animation: real attack deforms both bodies without mutating base; one-shot timeline boundaries passed');
for (const female of [false, true]) {
    const body = female ? PlayerAppearance.defaultFemale(kits) : PlayerAppearance.defaultMale(kits);
    for (const shieldId of [12954, 1187]) {
        const equipment = previewEquipment(row(27021, 3), row(shieldId, 5));
        assert.equal(equipment[3], 27021);
        assert.equal(equipment[5], shieldId);
        const single = players.buildStaticModelFromEquipment(body, previewEquipment(row(27021, 3)))!;
        const combined = players.buildStaticModelFromEquipment(body, equipment)!;
        assert.ok(combined.verticesCount > single.verticesCount, 'offhand geometry is included alongside Colossal blade');
        const before = [...combined.verticesX, ...combined.verticesY, ...combined.verticesZ];
        const seq = seqs.load(393);
        const animated = Model.copyAnimated(combined, false, true);
        animated.animate(frames.load(seq.frameIds[0])!, undefined, !!seq.op14);
        assert.equal(animated.verticesCount, combined.verticesCount);
        assert.notDeepEqual([...animated.verticesX, ...animated.verticesY, ...animated.verticesZ], before);
        assert.deepEqual([...combined.verticesX, ...combined.verticesY, ...combined.verticesZ], before);
    }
}
assert.equal(previewEquipment(row(27021, 3), row(1205, 3))[5], -1);
assert.equal(previewEquipment(row(27021, 3), { ...row(1187, 5), noted: true })[5], -1);
assert.equal(previewEquipment(row(1187, 5), row(12954, 5))[5], 1187);
console.log('Item offhand: Colossal with defender/shield, both bodies and attack geometry, removal and slot conflicts passed');
