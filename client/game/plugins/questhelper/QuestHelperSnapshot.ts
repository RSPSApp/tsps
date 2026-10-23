import { collectHelperSceneObjects } from "./QuestHelperScene";
import type { OsrsClient } from "../../OsrsClient";
import type { WidgetManager } from "../../../widgets/WidgetManager";
import type { WidgetNode } from "../../../widgets/WidgetNode";
import { SKILL_NAME, type SkillId } from "../../../rs/skill/skills";
import { baseNpcTypeId } from "../../../custom/npcs/NpcModelOverrideRegistry";
import type { HelperNpc, HelperWidget, ReadonlyClientSnapshot } from "./QuestHelperProtocol";
import { hintArrow } from "../../HintArrow";
const MAX_WIDGETS = 12000;

export function collectWidgetTree(node: WidgetNode, manager: WidgetManager, emitted = new Set<WidgetNode>()): HelperWidget {
    const path = new Set<WidgetNode>();
    let count = 0;
    const visit = (current: WidgetNode): HelperWidget | null => {
        if (path.has(current)) return null;
        if (++count > MAX_WIDGETS || (!emitted.has(current) && emitted.size >= MAX_WIDGETS)) throw new Error("Widget snapshot exceeds the safety bound.");
        emitted.add(current);
        path.add(current);
        try {
            const mounted = manager.getSubInterface?.(current.uid);
            const staticChildren = manager.getStaticChildrenByParentUid(current.uid);
            // Preserve the native sparse runtime array. The manager's dense accessor
            // intentionally strips null slots and IF1 references for rendering.
            const dynamicChildren = Array.from(current.children ?? [], child => child &&
                child.parentUid === current.uid && ((child.childIndex ?? -1) >= 0 || child.fileId === -1)
                ? visit(child) : null);
            return {
                id: current.id ?? current.uid, runtimeId: current.uid, index: current.childIndex ?? -1,
                parentId: current.parentUid, fileId:current.fileId, groupId:current.groupId, originalX: current.rawX, originalY: current.rawY,
                originalWidth: current.rawWidth, originalHeight: current.rawHeight,
                animationId: current.sequenceId ?? current.modelAnim, modelId: current.modelId,
                name: current.opBase ?? current.dataText, spriteId: current.spriteId, type: current.type,
                text: current.text, hidden: manager.isEffectivelyHidden(current.uid),
                bounds: {x: current._absX ?? current.x, y: current._absY ?? current.y,
                    width: current._absWidth ?? current.width, height: current._absHeight ?? current.height},
                itemId: current.itemId, itemQuantity: current.itemQuantity ?? current.itemAmount,
                staticChildren: staticChildren.map(visit), dynamicChildren,
                nestedChildren: mounted ? manager.getAllGroupRoots(mounted.group).map(visit) : [],
            };
        } finally { path.delete(current); }
    };
    return visit(node)!;
}
export function collectHelperNpc(client: OsrsClient, index: number): HelperNpc {
    const ecs = client.npcEcs;
    const id = baseNpcTypeId(ecs.getNpcTypeId(index));
    const base = client.npcTypeLoader.load(id);
    const type = base.transforms ? base.transform(client.varManager, client.npcTypeLoader) : base;
    const server = ecs.getServerState(index);
    return { index: ecs.isLinked(index) ? ecs.getServerId(index) : -index - 1, ecsIndex:index, id, transformedId: type?.id ?? -1, name: type?.name ?? "", x: server?.tileX ?? Math.floor(ecs.getWorldX(index) / 128), y: server?.tileY ?? Math.floor(ecs.getWorldY(index) / 128), plane: server?.plane ?? ecs.getLevel(index), animation: ecs.getSeqId(index), orientation: ecs.getRotation(index), combatLevel: type?.combatLevel, interactingIndex:ecs.getInteractionIndex(index) };
}
/** Runs synchronously at the game-tick boundary; never changes cache, actors, vars or widgets. */
export function collectQuestHelperSnapshot(client: OsrsClient, tick: number, scene: {
    baseX: number;
    baseY: number;
    plane: number;
    instanceTemplateChunks?: number[][][] | null;
}, skillEntries: readonly {
    id: number;
    baseLevel: number;
    currentLevel: number;
    xp: number;
}[], requiredVarbits: ReadonlySet<number>): ReadonlyClientSnapshot {
    const tile = client.getControlledPlayerMovementTile();
    const playerIndex = client.playerEcs.getIndexForServerId(client.controlledPlayerServerId);
    if (!tile || playerIndex === undefined)
        throw new Error("Local player state is unavailable.");
    const varps: Record<string, number> = {};
    client.varManager.values.forEach((value, id) => { if (value !== 0)
        varps[id] = value; });
    const varbits: Record<string, number> = {};
    const varbitDefinitions: Record<string, {
        varp: number;
        lsb: number;
        msb: number;
    }> = {};
    for (const id of requiredVarbits) {
        const definition = client.varManager.customVarbits.get(id) ?? client.varManager.varbitLoader.load(id);
        if (!definition || !Number.isInteger(definition.baseVar))
            continue;
        varbitDefinitions[id] = { varp: definition.baseVar, lsb: definition.startBit, msb: definition.endBit };
        varbits[id] = client.varManager.getVarbit(id);
    }
    const skills: Record<string, {
        real: number;
        boosted: number;
        xp: number;
    }> = {};
    for (const skill of skillEntries) {
        const name = SKILL_NAME[skill.id as SkillId];
        if (name)
            skills[name.toUpperCase()] = { real: skill.baseLevel, boosted: skill.currentLevel, xp: skill.xp };
    }
    const npcs: HelperNpc[] = [];
    client.npcEcs.forEachActive(index => { if (npcs.length >= 4096)
        throw new Error("NPC snapshot exceeds the safety bound."); npcs.push(collectHelperNpc(client, index)); });
    const objects = collectHelperSceneObjects(client, scene);
    const itemSlots = (inventory: OsrsClient["inventory"]) => inventory.getSlots().filter(slot => slot.itemId >= 0 && slot.quantity > 0).map(slot => ({ id: slot.itemId, quantity: slot.quantity, slot: slot.slot }));
    const manager = client.widgetManager;
    const groups = new Set([manager.rootInterface, ...[...manager.interfaceParents.values()].map(parent => parent.group)]);
    const visited = new Set<WidgetNode>();
    const widgets: HelperWidget[] = [];
    for (const group of groups)
        for (const root of manager.getAllGroupRoots(group))
            if (!visited.has(root))
                widgets.push(collectWidgetTree(root, manager, visited));
    const gender=client.playerEcs.getAppearance?.(playerIndex)?.gender;
    return { hintArrowNpcIndex:hintArrow.type===1?hintArrow.npcId:-1, varps, varbits, varbitDefinitions, gender, inventory: itemSlots(client.inventory), equipment: itemSlots(client.equipment), bank: itemSlots(client.bankInventory), localPlayer: { index:client.controlledPlayerServerId, name: client.localPlayerName, gender, x: tile.tileX, y: tile.tileY, plane: client.playerEcs.getLevel(playerIndex), animation: client.playerEcs.getAnimActionSeqId(playerIndex), poseAnimation: client.playerEcs.getAnimMovementSeqId(playerIndex), orientation: client.playerEcs.getRotation(playerIndex), interactingIndex: client.playerEcs.getInteractionIndex(playerIndex) }, skills, npcs, objects, groundItems: client.groundItems.getAllStacks().map(item => ({ id: item.itemId, quantity: item.quantity, x: item.tile.x, y: item.tile.y, plane: item.tile.level })), widgets, baseX: scene.baseX, baseY: scene.baseY, plane: scene.plane, tick, instanceTemplateChunks: scene.instanceTemplateChunks ? scene.instanceTemplateChunks.map(plane => plane.map(row => [...row])) : undefined };
}
