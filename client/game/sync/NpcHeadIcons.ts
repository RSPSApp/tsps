import type { NpcEcs } from "../ecs/NpcEcs";
import type { NpcType } from "../../rs/config/npctype/NpcType";

type NpcHeadIcon = { archiveId: number; spriteId: number };
export type NpcHeadIcons = Map<number, NpcHeadIcon[]>;

/** NPC_INFO replaces the customization; an empty update restores definition icons. */
export function applyGlobalNpcHeadIcons(icons: NpcHeadIcons, index: number, next: NpcHeadIcon[]): void {
    if (next.length) icons.set(index, next);
    else icons.delete(index);
}

/** Specific packets mutate one slot on the currently registered NPC, just like native NPCs. */
export function applyNpcSpecificHeadIcon(
    ecs: NpcEcs,
    icons: NpcHeadIcons,
    loadType: (typeId: number) => NpcType | undefined,
    effect: { index: number; slot: number; archiveId: number; spriteId: number },
): void {
    const ecsId = ecs.getEcsIdForServer(effect.index);
    if (ecsId === undefined || !Number.isInteger(effect.slot) || effect.slot < 0 || effect.slot > 7) return;
    const previous = icons.get(effect.index);
    const type = previous === undefined ? loadType(ecs.getNpcTypeId(ecsId)) : undefined;
    const slots = Array.from({ length: 8 }, (_, slot) => ({
        archiveId: previous ? previous[slot]?.archiveId ?? -1 : type?.headIconSpriteIds?.[slot] ?? -1,
        spriteId: previous ? previous[slot]?.spriteId ?? -1 : type?.headIconSpriteIndices?.[slot] ?? -1,
    }));
    slots[effect.slot] = { archiveId: effect.archiveId, spriteId: effect.spriteId };
    icons.set(effect.index, slots);
}
