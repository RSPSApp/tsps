import type { OsrsClient } from "../../OsrsClient";
import type { LocType } from "../../../rs/config/loctype/LocType";
import type { NpcType } from "../../../rs/config/npctype/NpcType";
import { ObjStackability } from "../../../rs/config/objtype/ObjStackability";
export type HelperDefinitionIds = {
    items: ReadonlySet<number>;
    objects: ReadonlySet<number>;
    npcs: ReadonlySet<number>;
};
type Definition = Record<string, unknown>;
/** Export concrete cache data only. Missing fields remain missing for strict bridge diagnostics. */
export function collectQuestHelperDefinitions(client: OsrsClient, ids: HelperDefinitionIds): {
    itemDefinitions: Record<string, Definition>;
    objectDefinitions: Record<string, Definition>;
    npcDefinitions: Record<string, Definition>;
} {
    const itemDefinitions: Record<string, Definition> = {}, objectDefinitions: Record<string, Definition> = {}, npcDefinitions: Record<string, Definition> = {};
    if (ids.items.size + ids.objects.size + ids.npcs.size > 4096)
        throw new Error("Quest Helper requested too many cache definitions.");
    for (const id of ids.items) {
        const item = client.objTypeLoader.load(id);
        itemDefinitions[id] = { id, name: item.name, note: item.noteTemplate, linkedNoteId: item.note, placeholderId: item.placeholder, placeholderTemplateId: item.placeholderTemplate, stackable: item.stackability === ObjStackability.ALWAYS, members: item.isMembers, price: item.price, inventoryActions: item.inventoryActions ? [...item.inventoryActions] : undefined, groundActions: item.groundActions ? [...item.groundActions] : undefined, isTradeable: item.isTradable, weight: item.weight };
    }
    const object = (type: LocType): Definition => ({ id: type.id, name: type.name, sizeX: type.sizeX, sizeY: type.sizeY, impostorIds: type.transforms ? [...type.transforms] : null, actions: type.actions ? [...type.actions] : undefined, animationId: type.seqId, mapSceneId: type.mapSceneId, mapIconId: type.mapFunctionId });
    for (const id of ids.objects) {
        const type = client.locTypeLoader.load(id);
        const transformed = type.transforms ? type.transform(client.varManager, client.locTypeLoader) : undefined;
        objectDefinitions[id] = { ...object(type), impostor: transformed ? object(transformed) : null };
    }
    const npc = (type: NpcType): Definition => ({ id: type.id, name: type.name, size: type.size, combatLevel: type.combatLevel, configs: type.transforms ? [...type.transforms] : null, actions: type.actions ? [...type.actions] : undefined, isInteractible: type.isInteractable, isClickable: type.isClickable, isFollower: type.isFollower });
    for (const id of ids.npcs) {
        const type = client.npcTypeLoader.load(id);
        const transformed = type.transforms ? type.transform(client.varManager, client.npcTypeLoader) : undefined;
        npcDefinitions[id] = { ...npc(type), transformedId: transformed?.id, transformedComposition: transformed ? npc(transformed) : null };
    }
    return { itemDefinitions, objectDefinitions, npcDefinitions };
}
