import type { EnumComposition } from "@runelite/api/EnumComposition";
import type { ItemComposition } from "@runelite/api/ItemComposition";
import type { ObjectComposition } from "@runelite/api/ObjectComposition";
import type { OsrsClient } from "../../game/OsrsClient";
import type { EnumType } from "../../rs/config/enumtype/EnumType";
import type { EnumTypeLoader } from "../../rs/config/enumtype/EnumTypeLoader";
import type { LocType } from "../../rs/config/loctype/LocType";
import { ObjStackability } from "../../rs/config/objtype/ObjStackability";
import type { ObjType } from "../../rs/config/objtype/ObjType";

/** RuneLite's ItemComposition over a cache ObjType. */
export function itemComposition(type: ObjType): ItemComposition {
    return {
        getId: () => type.id | 0,
        getName: () => type.name ?? "null",
        getIntValue: (paramId) => {
            const value = type.params?.get(paramId | 0);
            return typeof value === "number" ? value : -1;
        },
        getStringValue: (paramId) => {
            const value = type.params?.get(paramId | 0);
            return typeof value === "string" ? value : "";
        },
        // The cache's `note` is the other half of a note pair (unnoted <-> noted); `noteTemplate` marks a note.
        getLinkedNoteId: () => (type.note >= 0 ? type.note : -1),
        getNote: () => (type.noteTemplate >= 0 ? type.noteTemplate : -1),
        isStackable: () => type.stackability === ObjStackability.ALWAYS,
        isMembers: () => type.isMembers === true,
    };
}

/** RuneLite's EnumComposition over a cache EnumType. */
export function enumComposition(type: EnumType): EnumComposition {
    const keys = () => type.keys ?? [];
    const indexOf = (key: number) => keys().indexOf(key | 0);
    return {
        getId: () => type.id | 0,
        getKeys: () => [...keys()],
        getIntVals: () => [...(type.intValues ?? [])],
        getStringVals: () => [...(((type as any).stringValues as string[] | undefined) ?? [])],
        getIntValue: (key) => {
            const index = indexOf(key);
            return index >= 0 && type.intValues ? type.intValues[index] : type.defaultInt ?? -1;
        },
        getStringValue: (key) => {
            const index = indexOf(key);
            const values = (type as any).stringValues as string[] | undefined;
            return index >= 0 && values ? values[index] : type.defaultString ?? "";
        },
        size: () => keys().length,
    };
}

/** RuneLite's ObjectComposition over a cache LocType, with the player's vars picking the impostor. */
export function objectComposition(client: OsrsClient, type: LocType): ObjectComposition {
    return {
        getId: () => type.id | 0,
        getName: () => type.name ?? "null",
        getActions: () => (type as any).actions ?? [],
        getImpostorIds: () => (type.transforms ? [...type.transforms] : null),
        getImpostor: () => {
            if (!type.transforms || !client.varManager || !client.locTypeLoader) return null;
            const impostor = type.transform(client.varManager, client.locTypeLoader);
            return impostor ? objectComposition(client, impostor) : null;
        },
        getSizeX: () => (type as any).sizeX ?? 1,
        getSizeY: () => (type as any).sizeY ?? 1,
    };
}

/** `Client.getItemDefinition`: null for an id the cache does not define. */
export function getItemDefinition(client: OsrsClient, id: number): ItemComposition | null {
    if (!(id >= 0)) return null;
    const type = client.objTypeLoader?.load(id | 0);
    return type ? itemComposition(type) : null;
}

/** The engine keeps the enum loader on its loader factory; a test stub may hand one in directly. */
type EnumLoaderSource = { enumTypeLoader?: EnumTypeLoader; loaderFactory?: { getEnumTypeLoader?(): EnumTypeLoader | undefined } };

export function getEnum(client: OsrsClient, id: number): EnumComposition | null {
    if (!(id >= 0)) return null;
    const source = client as unknown as EnumLoaderSource;
    const loader = source.enumTypeLoader ?? source.loaderFactory?.getEnumTypeLoader?.();
    const type = loader?.load(id | 0);
    return type ? enumComposition(type) : null;
}

export function getObjectDefinition(client: OsrsClient, id: number): ObjectComposition | null {
    if (!(id >= 0)) return null;
    const type = client.locTypeLoader?.load(id | 0);
    return type ? objectComposition(client, type) : null;
}
