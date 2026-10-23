import type { OsrsClient } from "../../OsrsClient";
import type { WidgetManager } from "../../../widgets/WidgetManager";
import type { WidgetNode } from "../../../widgets/WidgetNode";
import { SKILL_NAME, type SkillId } from "../../../rs/skill/skills";
import { baseNpcTypeId } from "../../../custom/npcs/NpcModelOverrideRegistry";
import type { HelperNpc, HelperWidget, ReadonlyClientSnapshot } from "./QuestHelperProtocol";
const MAX_WIDGETS = 12000;
const MAX_OBJECTS = 20000;
export function collectWidgetTree(node: WidgetNode, manager: WidgetManager, visited = new Set<WidgetNode>()): HelperWidget {
    if (visited.size >= MAX_WIDGETS)
        throw new Error("Widget snapshot exceeds the safety bound.");
    visited.add(node);
    const children = [...manager.getStaticChildrenByParentUid(node.uid), ...manager.getDynamicChildrenByParent(node)];
    return { id: node.uid, text: node.text, hidden: manager.isEffectivelyHidden(node.uid), bounds: { x: node._absX ?? node.x, y: node._absY ?? node.y, width: node._absWidth ?? node.width, height: node._absHeight ?? node.height }, itemId: node.itemId, itemQuantity: node.itemQuantity, children: [...new Set(children)].filter(child => !visited.has(child)).map(child => collectWidgetTree(child, manager, visited)) };
}
export function collectHelperNpc(client: OsrsClient, index: number): HelperNpc {
    const ecs = client.npcEcs;
    const id = baseNpcTypeId(ecs.getNpcTypeId(index));
    const base = client.npcTypeLoader.load(id);
    const type = base.transforms ? base.transform(client.varManager, client.npcTypeLoader) : base;
    const server = ecs.getServerState(index);
    return { index: ecs.isLinked(index) ? ecs.getServerId(index) : -index - 1, id, transformedId: type?.id ?? -1, name: type?.name ?? "", x: server?.tileX ?? Math.floor(ecs.getWorldX(index) / 128), y: server?.tileY ?? Math.floor(ecs.getWorldY(index) / 128), plane: server?.plane ?? ecs.getLevel(index), animation: ecs.getSeqId(index), orientation: ecs.getRotation(index), combatLevel: type?.combatLevel };
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
    const objects: {
        id: number;
        x: number;
        y: number;
        plane: number;
        type?: number;
        orientation?: number;
    }[] = [];
    const renderer = client.renderer as typeof client.renderer & {
        getLocIdsAtTileAllLevels?: (x: number, y: number) => {
            id: number;
            level: number;
            typeRot?: number;
        }[];
    };
    if (!renderer.getLocIdsAtTileAllLevels)
        throw new Error("Scene object snapshot is unavailable for this renderer.");
    for (let x = scene.baseX; x < scene.baseX + 104; x++)
        for (let y = scene.baseY; y < scene.baseY + 104; y++)
            for (const loc of renderer.getLocIdsAtTileAllLevels(x, y)) {
                if (objects.length >= MAX_OBJECTS)
                    throw new Error("Scene object snapshot exceeds the safety bound.");
                objects.push({ id: loc.id, x, y, plane: loc.level, type: loc.typeRot === undefined ? undefined : loc.typeRot >> 2, orientation: loc.typeRot === undefined ? undefined : loc.typeRot & 3 });
            }
    const itemSlots = (inventory: OsrsClient["inventory"]) => inventory.getSlots().filter(slot => slot.itemId >= 0 && slot.quantity > 0).map(slot => ({ id: slot.itemId, quantity: slot.quantity, slot: slot.slot }));
    const manager = client.widgetManager;
    const groups = new Set([manager.rootInterface, ...[...manager.interfaceParents.values()].map(parent => parent.group)]);
    const visited = new Set<WidgetNode>();
    const widgets: HelperWidget[] = [];
    for (const group of groups)
        for (const root of manager.getAllGroupRoots(group))
            if (!visited.has(root))
                widgets.push(collectWidgetTree(root, manager, visited));
    return { varps, varbits, varbitDefinitions, inventory: itemSlots(client.inventory), equipment: itemSlots(client.equipment), bank: itemSlots(client.bankInventory), localPlayer: { name: client.localPlayerName, x: tile.tileX, y: tile.tileY, plane: client.playerEcs.getLevel(playerIndex), animation: client.playerEcs.getAnimActionSeqId(playerIndex), poseAnimation: client.playerEcs.getAnimMovementSeqId(playerIndex), orientation: client.playerEcs.getRotation(playerIndex), interactingIndex: client.playerEcs.getInteractionIndex(playerIndex) }, skills, npcs, objects, groundItems: client.groundItems.getAllStacks().map(item => ({ id: item.itemId, quantity: item.quantity, x: item.tile.x, y: item.tile.y, plane: item.tile.level })), widgets, baseX: scene.baseX, baseY: scene.baseY, plane: scene.plane, tick, instanceTemplateChunks: scene.instanceTemplateChunks ? scene.instanceTemplateChunks.map(plane => plane.map(row => [...row])) : undefined };
}
