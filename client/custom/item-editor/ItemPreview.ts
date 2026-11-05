import type { OsrsClient } from '../../game/OsrsClient';
import { ItemIconRenderer } from '../../ui/item/ItemIconRenderer';
import { Model2DRenderer } from '../../ui/model/Model2DRenderer';
import { PlayerModelLoader } from '../../rs/config/player/PlayerModelLoader';
import { PlayerAppearance } from '../../rs/config/player/PlayerAppearance';
import { mapPlayerCompositionSlot, EquipmentSlot, withSeqHandItems } from '../../rs/config/player/Equipment';
import { Model } from '../../rs/model/Model';
import { animationTimeline } from './ItemPlayback';
import { isGroupMissingError } from '../../rs/cache/js5/GroupMissingError';
import type { ObjType } from '../../rs/config/objtype/ObjType';
export type ItemRow = {
    id: number;
    name: string;
    source: 'cache' | 'custom';
    noted: boolean;
    equipmentSlot: number;
    equipable: boolean;
    reason: string;
};
export type PreviewTab = 'Inventory' | 'Ground' | 'Model A' | 'Model B';
export function previewEquipment(row: ItemRow, offhand?: ItemRow): number[] {
    const equipment = new Array<number>(14).fill(-1);
    if (offhand?.equipable && !offhand.noted && offhand.equipmentSlot === 5)
        equipment[EquipmentSlot.SHIELD] = offhand.id;
    const slot = mapPlayerCompositionSlot(row.equipmentSlot);
    if (slot !== undefined)
        equipment[slot] = row.id;
    return equipment;
}
export function wornModelIds(obj: ObjType, female: boolean): number[] {
    return (female ? [obj.femaleModel, obj.femaleModel1, obj.femaleModel2]
        : [obj.maleModel, obj.maleModel1, obj.maleModel2]).filter(id => Number.isInteger(id) && id >= 0);
}
export function equippedPreviewState(row: ItemRow, obj: ObjType, female: boolean): {
    available: boolean;
    reason: string;
    slot?: EquipmentSlot;
} {
    if (!row.equipable)
        return { available: false, reason: row.reason || 'This item cannot be equipped' };
    const slot = mapPlayerCompositionSlot(row.equipmentSlot);
    if (slot === undefined)
        return { available: true, reason: 'Equipment definition unavailable' };
    // Rings and ammunition are equipped but deliberately have no worn geometry in OSRS.
    if (slot !== EquipmentSlot.RING && slot !== EquipmentSlot.AMMO && !wornModelIds(obj, female).length)
        return { available: true, reason: 'Equipped model missing', slot };
    return { available: true, reason: '', slot };
}
export class ItemPreview {
    private anchor?: {
        key: string;
        x: number;
        y: number;
    };
    readonly icons: ItemIconRenderer;
    readonly renderer: Model2DRenderer;
    readonly players: PlayerModelLoader;
    constructor(readonly client: OsrsClient) {
        this.icons = new ItemIconRenderer(client.objTypeLoader, client.modelLoader, client.textureLoader, client.cacheSystem);
        this.renderer = new Model2DRenderer(client.objTypeLoader, client.modelLoader, client.textureLoader);
        this.players = new PlayerModelLoader(client.idkTypeLoader, client.objTypeLoader, client.modelLoader, client.textureLoader);
    }
    private requireModel(id: number, label: string): void {
        const misses = this.client.modelLoader.missCount ?? 0;
        if (id >= 0 && this.client.modelLoader.getModel(id))
            return;
        const streaming = (this.client.modelLoader.missCount ?? 0) > misses;
        throw new Error(`${label} model ${id} unavailable.${streaming ? ' Waiting for cache assets…' : ''}`);
    }
    prepareAnimation(id: number): number[] {
        if (!Number.isInteger(id) || id < 0 || id >= this.client.seqTypeLoader.getCount())
            throw Error('Animation ID is not available in this cache.');
        try {
            const seq = this.client.seqTypeLoader.load(id);
            const timeline = animationTimeline(seq);
            if (!timeline.length)
                throw Error('Animation has no playable frames. Waiting for cache assets…');
            const ready = seq.isSkeletalSeq() ? !!this.client.skeletalSeqLoader?.load(seq.skeletalId)
                : seq.frameIds.map(frame => this.client.seqFrameLoader.load(frame)).every(Boolean);
            if (!ready)
                throw Error('Animation frames unavailable. Waiting for cache assets…');
            return timeline;
        }
        catch (error) {
            if (isGroupMissingError(error))
                throw Error('Animation frames unavailable. Waiting for cache assets…');
            throw error;
        }
    }
    render(row: ItemRow, tab: PreviewTab, yaw: number, pitch: number, zoom: number, animation?: {
        id: number;
        frame: number;
    }, offhand?: ItemRow): HTMLCanvasElement {
        const obj = this.client.objTypeLoader.load(row.id);
        if (tab === 'Inventory' || tab === 'Ground')
            this.requireModel(obj.model ?? -1, 'Inventory / ground');
        if (tab === 'Inventory') {
            const icon = this.icons.renderToCanvas(row.id, 1, { outline: 1, shadow: 0x302020 });
            if (!icon)
                throw new Error('Inventory model unavailable. Waiting for cache assets…');
            const canvas = document.createElement('canvas');
            canvas.width = 360;
            canvas.height = 320;
            const ctx = canvas.getContext('2d')!;
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(icon, 0, 0, 360, 320);
            return canvas;
        }
        const female = tab === 'Model B';
        const state = equippedPreviewState(row, obj, female);
        if (tab !== 'Ground' && state.reason)
            throw new Error(state.reason);
        let appearance = female ? PlayerAppearance.defaultFemale(this.client.idkTypeLoader) : PlayerAppearance.defaultMale(this.client.idkTypeLoader);
        // The female body has no beard kit. Only require the six visible body parts.
        if ([0, 2, 3, 4, 5, 6].some(part => appearance.kits[part] < 0))
            throw new Error('Reference body unavailable. Waiting for cache assets…');
        for (const kitId of appearance.kits.filter(id => id >= 0)) {
            for (const id of this.client.idkTypeLoader.load(kitId).modelIds ?? [])
                this.requireModel(id, 'Reference body');
        }
        let model;
        if (tab === 'Ground') {
            model = this.client.objModelLoader.getModel(row.id, 1);
        }
        else {
            const ids = wornModelIds(obj, female);
            for (const id of ids)
                this.requireModel(id, 'Equipped');
            const equipment = previewEquipment(row, offhand);
            if (equipment[EquipmentSlot.SHIELD] >= 0 && equipment[EquipmentSlot.SHIELD] !== row.id) {
                const shield = this.client.objTypeLoader.load(equipment[EquipmentSlot.SHIELD]);
                if (!wornModelIds(shield, female).length)
                    throw Error('Offhand equipped model missing');
                for (const id of wornModelIds(shield, female))
                    this.requireModel(id, 'Offhand');
            }
            appearance.equip = equipment;
            if (animation)
                appearance = withSeqHandItems(appearance, this.client.seqTypeLoader.load(animation.id));
            model = this.players.buildStaticModelFromEquipment(appearance, appearance.equip);
        }
        if (!model)
            throw new Error('Model unavailable. Waiting for cache assets…');
        const params = { yan2d: yaw, xan2d: pitch, zoom2d: 1800, zoom3d: Math.round((tab === 'Ground' ? 1100 : 3000) * zoom), depthTest: true, orthographic: true };
        if (animation && tab !== 'Ground') {
            const key = `${row.id}:${offhand?.id ?? -1}:${tab}:${yaw}:${pitch}:${zoom}:${animation.id}`;
            if (this.anchor?.key !== key) {
                const rest = this.renderer.renderModelInstanceToCanvasExtents(model, params);
                if (!rest)
                    throw Error('Reference pose could not be rendered');
                this.anchor = { key, x: (640 - rest.canvas.width) / 2 + rest.offsetX, y: (480 - rest.canvas.height) / 2 + rest.offsetY };
            }
            const seq = this.client.seqTypeLoader.load(animation.id);
            model = Model.copyAnimated(model, false, false);
            if (seq.isSkeletalSeq()) {
                const skeletal = this.client.skeletalSeqLoader?.load(seq.skeletalId);
                if (!skeletal)
                    throw Error('Animation frames unavailable. Waiting for cache assets…');
                model.animateSkeletal(skeletal, animation.frame);
            }
            else {
                const frame = this.client.seqFrameLoader.load(seq.frameIds[animation.frame]);
                if (!frame)
                    throw Error('Animation frame unavailable. Waiting for cache assets…');
                model.animate(frame, undefined, !!seq.op14);
            }
        }
        const rendered = this.renderer.renderModelInstanceToCanvasExtents(model, params);
        if (!rendered)
            throw new Error('Model could not be rendered');
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 480;
        const ctx = canvas.getContext('2d')!;
        if (tab === 'Ground') {
            // A 128-unit tile and a real reference body use the same projection scale as the item.
            const tile = 128 * params.zoom3d / params.zoom2d;
            ctx.strokeStyle = '#526376';
            ctx.fillStyle = '#26333c';
            ctx.beginPath();
            ctx.moveTo(230, 330 - tile / 2);
            ctx.lineTo(230 + tile, 330);
            ctx.lineTo(230, 330 + tile / 2);
            ctx.lineTo(230 - tile, 330);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = '#a3b0bf';
            ctx.font = '13px sans-serif';
            ctx.fillText('1 tile · 128 model units', 165, 410);
            const reference = this.players.buildStaticModelFromEquipment(appearance, new Array(14).fill(-1));
            if (!reference)
                throw new Error('Reference body unavailable. Waiting for cache assets…');
            const ghost = this.renderer.renderModelInstanceToCanvasExtents(reference, params);
            if (!ghost)
                throw new Error('Reference body could not be rendered');
            ctx.globalAlpha = 0.35;
            ctx.drawImage(ghost.canvas, 485 - ghost.canvas.width / 2, 345 - ghost.canvas.height);
            ctx.globalAlpha = 1;
            ctx.fillText('Scale reference', 436, 375);
            ctx.drawImage(rendered.canvas, 230 - rendered.canvas.width / 2, 330 - rendered.canvas.height);
        }
        else {
            ctx.drawImage(rendered.canvas, animation && this.anchor ? this.anchor.x - rendered.offsetX : (640 - rendered.canvas.width) / 2, animation && this.anchor ? this.anchor.y - rendered.offsetY : (480 - rendered.canvas.height) / 2);
        }
        return canvas;
    }
}
