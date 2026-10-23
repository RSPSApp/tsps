import type { OsrsClient } from '../../game/OsrsClient';
import type { CustomItemDefinition } from '../../custom/items/CustomItemTypes';
import type { ObjType } from '../../rs/config/objtype/ObjType';
import { HSL_RGB_MAP } from '../../rs/util/ColorUtil';
import { wornModelIds } from './ItemPreview';
export type ColorEntry = {
    raw: number;
    faces: number;
    roles: string[];
};
export function modelColors(client: OsrsClient, obj: ObjType): {
    colors: ColorEntry[];
    textured: number;
    missing: number[];
} {
    const entries = new Map<number, ColorEntry>();
    let textured = 0;
    const parts = new Map<number, string[]>();
    for (const [role, ids] of [['Inventory / Ground', [obj.model]], ['Model A', wornModelIds(obj, false)], ['Model B', wornModelIds(obj, true)]] as [
        string,
        number[]
    ][]) {
        for (const id of ids)
            if (id >= 0)
                parts.set(id, [...(parts.get(id) ?? []), role]);
    }
    const missing: number[] = [];
    for (const [id, roles] of parts) {
        const data = client.modelLoader.getModel(id);
        if (!data) {
            missing.push(id);
            continue;
        }
        for (let face = 0; face < data.faceColors.length; face++) {
            if (data.faceTextures && data.faceTextures[face] >= 0) {
                textured++;
                continue;
            }
            const raw = data.faceColors[face];
            const entry = entries.get(raw) ?? { raw, faces: 0, roles: [] };
            entry.faces++;
            entry.roles = Array.from(new Set([...entry.roles, ...roles]));
            entries.set(raw, entry);
        }
    }
    return { colors: Array.from(entries.values()).sort((a, b) => b.faces - a.faces), textured, missing };
}
export function effectiveColor(raw: number, props: {
    recolorFrom?: number[];
    recolorTo?: number[];
}): number {
    let color = raw;
    props.recolorFrom?.forEach((from, i) => { if (color === from)
        color = props.recolorTo![i]; });
    return color;
}
export function colorHex(color: number): string { return `#${HSL_RGB_MAP[color].toString(16).padStart(6, '0')}`; }
export function hexHsl(hex: string): {
    hue: number;
    sat: number;
    light: number;
} {
    const rgb = [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16) / 255);
    const [r, g, b] = rgb, max = Math.max(...rgb), min = Math.min(...rgb), delta = max - min, light = (min + max) / 2;
    let hue = 0;
    if (delta)
        hue = (max === r ? ((g - b) / delta + (g < b ? 6 : 0)) : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) / 6;
    return { hue: Math.min(63, Math.floor(hue * 64)), sat: Math.min(7, Math.round((delta ? delta / (1 - Math.abs(2 * light - 1)) : 0) * 7)), light: Math.min(127, Math.round(light * 127)) };
}
// The game's replacements run sequentially. Temporary unused colors prevent
// cascades and support swaps (A -> B, B -> A) without corrupting either shade.
export function compileColors(rawColors: number[], desired: Map<number, number>): {
    recolorFrom: number[];
    recolorTo: number[];
} {
    const changes = rawColors.filter(raw => desired.has(raw) && desired.get(raw) !== raw);
    const used = new Set([...rawColors, ...Array.from(desired.values())]);
    const temps: number[] = [];
    let candidate = 65535;
    for (let i = 0; i < changes.length; i++) {
        while (used.has(candidate) && candidate >= 0)
            candidate--;
        if (candidate < 0)
            throw Error('Too many model colors');
        temps.push(candidate);
        used.add(candidate--);
    }
    return { recolorFrom: [...changes, ...temps], recolorTo: [...temps, ...changes.map(raw => desired.get(raw)!)] };
}
export function recolorSelection(item: CustomItemDefinition, rawColors: number[], selected: number[], hex: string, preserve: boolean, brightness: number, saturation?: number): CustomItemDefinition {
    const target = hexHsl(hex);
    const desired = new Map(rawColors.map(raw => [raw, effectiveColor(raw, item.objType)]));
    for (const raw of selected) {
        const previous = desired.get(raw)!;
        const light = Math.max(0, Math.min(127, (preserve ? previous & 127 : target.light) + brightness));
        desired.set(raw, (target.hue << 10) | ((saturation ?? target.sat) << 7) | light);
    }
    return { ...item, objType: { ...item.objType, ...compileColors(rawColors, desired) } };
}
