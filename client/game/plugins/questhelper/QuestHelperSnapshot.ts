import { collectHelperSceneObjects } from "./QuestHelperScene";
import type { OsrsClient } from "../../OsrsClient";
import type { WidgetManager } from "../../../widgets/WidgetManager";
import type { WidgetNode } from "../../../widgets/WidgetNode";
import { SKILL_NAME, type SkillId } from "../../../rs/skill/skills";
import { baseNpcTypeId } from "../../../custom/npcs/NpcModelOverrideRegistry";
import type { HelperNpc, HelperWidget, ReadonlyClientSnapshot } from "./QuestHelperProtocol";
import { hintArrow } from "../../HintArrow";
const MAX_WIDGETS = 12000;

/** One widget a walk read, kept to tell on the next tick whether anything the walk saw changed. */
type WalkedWidget = {
    node: WidgetNode;
    out: HelperWidget;
    rawHidden: boolean | undefined;
    children: WidgetNode["children"];
    /** The dynamic children array's slots as walked, and which of them the walk took. */
    slots?: (WidgetNode | null)[];
    taken?: boolean[];
};
type WidgetWalk = { structureVersion: number; widgets: HelperWidget[]; walked: WalkedWidget[] };
const lastWalk = new WeakMap<WidgetManager, WidgetWalk>();

const isDynamicChildOf = (child: WidgetNode | null | undefined, parent: WidgetNode): boolean =>
    !!child && child.parentUid === parent.uid && ((child.childIndex ?? -1) >= 0 || child.fileId === -1);

export function collectWidgetTree(node: WidgetNode, manager: WidgetManager, emitted = new Set<WidgetNode>(), walked?: WalkedWidget[]): HelperWidget {
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
            const slots = current.children ? Array.from(current.children, child => child ?? null) : undefined;
            const taken = slots?.map(child => isDynamicChildOf(child, current));
            const dynamicChildren = (slots ?? []).map((child, i) => taken![i] ? visit(child!) : null);
            const out: HelperWidget = {
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
            walked?.push({ node: current, out, rawHidden: current.hidden, children: current.children, slots, taken });
            return out;
        } finally { path.delete(current); }
    };
    return visit(node)!;
}
/**
 * Whether every widget the last walk read still reads the same. The shape (groups, mounts,
 * static children, registered widgets) is covered by WidgetManager.structureVersion; the fields
 * are compared here directly, since scripts, packets, layout and plugins all write them.
 */
function walkStillHolds(walk: WidgetWalk, manager: WidgetManager): boolean {
    if (walk.structureVersion !== manager.structureVersion) return false;
    for (const { node: n, out: o, rawHidden, children, slots, taken } of walk.walked) {
        // Any hidden flag in the tree feeds isEffectivelyHidden of everything under it.
        if (n.hidden !== rawHidden || n.children !== children) return false;
        if (slots) {
            const now = n.children!;
            if (now.length !== slots.length) return false;
            for (let i = 0; i < slots.length; i++) {
                const child = now[i] ?? null;
                if (child !== slots[i] || isDynamicChildOf(child, n) !== taken![i]) return false;
            }
        }
        const b = o.bounds!;
        if (o.id !== (n.id ?? n.uid) || o.runtimeId !== n.uid || o.index !== (n.childIndex ?? -1) || o.parentId !== n.parentUid
            || o.fileId !== n.fileId || o.groupId !== n.groupId || o.originalX !== n.rawX || o.originalY !== n.rawY
            || o.originalWidth !== n.rawWidth || o.originalHeight !== n.rawHeight || o.animationId !== (n.sequenceId ?? n.modelAnim)
            || o.modelId !== n.modelId || o.name !== (n.opBase ?? n.dataText) || o.spriteId !== n.spriteId || o.type !== n.type
            || o.text !== n.text || b.x !== (n._absX ?? n.x) || b.y !== (n._absY ?? n.y) || b.width !== (n._absWidth ?? n.width)
            || b.height !== (n._absHeight ?? n.height) || o.itemId !== n.itemId || o.itemQuantity !== (n.itemQuantity ?? n.itemAmount))
            return false;
    }
    return true;
}

/**
 * The loaded widget tree. While nothing the last walk read has changed, the same array comes
 * back, so its reuse digest is not recomputed either (SnapshotReuse.prepare).
 */
export function collectHelperWidgets(manager: WidgetManager): HelperWidget[] {
    const previous = lastWalk.get(manager);
    // A manager without the counter (test doubles) is walked every time.
    const cacheable = typeof manager.structureVersion === "number";
    if (cacheable && previous && walkStillHolds(previous, manager)) return previous.widgets;
    const groups = new Set([manager.rootInterface, ...[...manager.interfaceParents.values()].map(parent => parent.group)]);
    const visited = new Set<WidgetNode>();
    const widgets: HelperWidget[] = [];
    const walked: WalkedWidget[] = [];
    for (const group of groups)
        for (const root of manager.getAllGroupRoots(group))
            if (!visited.has(root))
                widgets.push(collectWidgetTree(root, manager, visited, walked));
    // Read after the walk: getAllGroupRoots may fill its cache on the way, which is no change.
    if (cacheable) lastWalk.set(manager, { structureVersion: manager.structureVersion, widgets, walked });
    return widgets;
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
    const widgets = collectHelperWidgets(client.widgetManager);
    const gender=client.playerEcs.getAppearance?.(playerIndex)?.gender;
    return { hintArrowNpcIndex:hintArrow.type===1?hintArrow.npcId:-1, varps, varbits, varbitDefinitions, gender, inventory: itemSlots(client.inventory), equipment: itemSlots(client.equipment), bank: itemSlots(client.lastKnownBank), localPlayer: { index:client.controlledPlayerServerId, name: client.localPlayerName, gender, x: tile.tileX, y: tile.tileY, plane: client.playerEcs.getLevel(playerIndex), animation: client.playerEcs.getAnimActionSeqId(playerIndex), poseAnimation: client.playerEcs.getAnimMovementSeqId(playerIndex), orientation: client.playerEcs.getRotation(playerIndex), interactingIndex: client.playerEcs.getInteractionIndex(playerIndex) }, skills, npcs, objects, groundItems: client.groundItems.getAllStacks().map(item => ({ id: item.itemId, quantity: item.quantity, x: item.tile.x, y: item.tile.y, plane: item.tile.level })), widgets, baseX: scene.baseX, baseY: scene.baseY, plane: scene.plane, tick, instanceTemplateChunks: scene.instanceTemplateChunks ? scene.instanceTemplateChunks.map(plane => plane.map(row => [...row])) : undefined };
}
