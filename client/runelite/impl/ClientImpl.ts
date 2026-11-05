import type { Actor, Client, NPC, NPCComposition, Player, Point } from "@runelite/api/Client";
import { WorldPoint } from "@runelite/api/coords/WorldPoint";
import type { EnumComposition } from "@runelite/api/EnumComposition";
import type { GameState } from "@runelite/api/GameState";
import { ItemContainer } from "@runelite/api/Item";
import type { ItemComposition } from "@runelite/api/ItemComposition";
import type { ObjectComposition } from "@runelite/api/ObjectComposition";
import type { Widget } from "@runelite/api/widgets/Widget";
import { TOPLEVEL } from "@runelite/api/gameval/InterfaceID";
import * as InventoryID from "@runelite/api/gameval/InventoryID";
import { ClientState } from "../../game/ClientState";
import type { OsrsClient } from "../../game/OsrsClient";
import { getCurrentTick } from "../../network/serverConnection/timing";
import { decodeInteractionIndex } from "../../rs/interaction/InteractionIndex";
import type { SkillId } from "../../rs/skill/skills";
import { getEnum, getItemDefinition, getObjectDefinition } from "./ClientDefinitions";
import { clearHintArrow, hintArrowNpcIndex, setHintArrow } from "./ClientHintArrows";
import { toRuneLiteGameState } from "./GameStateMapping";
import { getWidget } from "./WidgetImpl";

/** RuneLite's Constants.CLIENT_TICK_LENGTH. */
const CLIENT_TICK_LENGTH = 20;

/** The RuneLite `Client` facade over our engine. */
export class ClientImpl implements Client {
    constructor(private readonly osrsClient: OsrsClient) {}

    getGameState(): GameState {
        return toRuneLiteGameState(this.osrsClient.gameState);
    }

    getLocalPlayer(): Player | null {
        const client = this.osrsClient;
        const index = client.playerEcs?.getIndexForServerId(client.controlledPlayerServerId);
        if (client.controlledPlayerServerId < 0 || index === undefined || index < 0) return null;
        const players = client.playerEcs;
        return {
            getName: () => client.localPlayerName,
            getCombatLevel: () => players.getCombatLevel(index),
            getAnimation: () => {
                const seq = players.getAnimActionSeqId(index) | 0;
                return seq >= 0 ? seq : -1;
            },
            // The player ECS holds world positions, 128 units per tile.
            getWorldLocation: () => new WorldPoint(players.getX(index) >> 7, players.getY(index) >> 7, players.getLevel(index) | 0),
            getInteracting: () => this.actor(players.getInteractionIndex(index)),
        };
    }

    /** The NPC or player behind an encoded interaction index. */
    private actor(key: number): Actor | null {
        const target = decodeInteractionIndex(key);
        if (!target) return null;
        const client = this.osrsClient;
        if (target.type === "player") {
            const index = client.playerEcs?.getIndexForServerId(target.id);
            return {
                getName: () => (index === undefined ? null : client.playerEcs.getName(index) ?? null),
                getInteractionKey: () => key,
            };
        }
        return this.npc(target.id, key);
    }

    /** RuneLite's NPC for a server index: every getter reads the store live. */
    private npc(serverId: number, interactionKey = -1): NPC {
        const client = this.osrsClient;
        const ecsId = () => client.npcEcs?.getEcsIdForServer(serverId);
        return {
            getId: () => {
                const id = ecsId();
                return id === undefined ? -1 : client.npcEcs.getNpcTypeId(id) | 0;
            },
            getIndex: () => serverId,
            getName: () => this.npcType(serverId)?.name ?? null,
            getInteractionKey: () => interactionKey,
            getComposition: (): NPCComposition | null => {
                const type = this.npcType(serverId);
                return type ? { getName: () => type.name, getActions: () => type.actions ?? [] } : null;
            },
            getWorldLocation: () => {
                const id = ecsId();
                if (id === undefined) return new WorldPoint(-1, -1, 0);
                const npcs = client.npcEcs;
                return new WorldPoint(npcs.getX(id) >> 7, npcs.getY(id) >> 7, npcs.getLevel(id) | 0);
            },
        };
    }

    /** The NPC's type after transforms (RuneLite's NPC.getTransformedComposition). */
    private npcType(serverId: number): { id: number; name: string; actions: string[] } | undefined {
        const client = this.osrsClient;
        const ecsId = client.npcEcs?.getEcsIdForServer(serverId);
        if (ecsId === undefined) return undefined;
        let type = client.npcTypeLoader?.load(client.npcEcs.getNpcTypeId(ecsId) | 0);
        if (type?.transforms) type = type.transform(client.varManager, client.npcTypeLoader) ?? type;
        return type ?? undefined;
    }

    getNpcs(): NPC[] {
        const npcs = this.osrsClient.npcEcs;
        if (!npcs) return [];
        const out: NPC[] = [];
        for (const ecsId of npcs.getAllActiveIds()) {
            if (!npcs.isLinked(ecsId)) continue;
            const serverId = npcs.getServerId(ecsId) | 0;
            if (serverId > 0) out.push(this.npc(serverId));
        }
        return out;
    }

    getNpcByIndex(index: number): NPC | null {
        const npcs = this.osrsClient.npcEcs;
        if (!npcs || !(index > 0) || npcs.getEcsIdForServer(index) === undefined) return null;
        return this.npc(index);
    }

    getVarpValue(varpId: number): number {
        return this.osrsClient.varManager?.getVarp(varpId) ?? 0;
    }

    getVarbitValue(varbitId: number): number {
        return this.osrsClient.varManager?.getVarbit(varbitId) ?? 0;
    }

    getRealSkillLevel(skill: SkillId): number {
        return this.osrsClient.cs2Vm?.context?.getStatBase?.(skill) ?? 1;
    }

    getBoostedSkillLevel(skill: SkillId): number {
        return this.osrsClient.cs2Vm?.context?.getStatBoosted?.(skill) ?? 1;
    }

    isResized(): boolean {
        const root = this.osrsClient.widgetManager?.rootInterface;
        return root !== undefined && root !== TOPLEVEL;
    }

    getEnergy(): number {
        return this.osrsClient.cs2Vm?.context?.getRunEnergy?.() ?? 0;
    }

    getTickCount(): number {
        return getCurrentTick();
    }

    getMouseLastPressedMillis(): number {
        return this.osrsClient.inputManager?.clickTime ?? 0;
    }

    getKeyboardIdleTicks(): number {
        const input = this.osrsClient.inputManager;
        return input ? Math.floor(input.getKeyboardIdleMs() / CLIENT_TICK_LENGTH) : 0;
    }

    /**
     * Throws when the script can't run: before the cache is loaded, or while another script runs
     * (a top-level run would reset that script's stacks). RuneLite runs scripts only on the
     * client thread, between scripts, so it never meets the second case.
     */
    runScript(scriptId: number, ...args: number[]): void {
        const vm = this.osrsClient.cs2Vm;
        if (!vm || vm.isRunning()) throw new Error(`Client script ${scriptId} can't run now`);
        const script = vm.context?.loadScript?.(scriptId | 0);
        if (!script) throw new Error(`Client script ${scriptId} is not in the cache`);
        vm.run(script, args, []);
    }

    getIntStack(): ArrayLike<number> {
        return this.osrsClient.cs2Vm.intStack;
    }

    getWidget(componentId: number): Widget | null {
        return getWidget(this.osrsClient.widgetManager, componentId);
    }

    getItemContainer(id: number): ItemContainer | null {
        const client = this.osrsClient;
        const store =
            id === InventoryID.INV ? client.inventory
            : id === InventoryID.WORN ? client.equipment
            : id === InventoryID.BANK ? client.bankInventory
            : undefined;
        return store ? new ItemContainer(id, store) : null;
    }

    getItemDefinition(id: number): ItemComposition | null {
        return getItemDefinition(this.osrsClient, id);
    }

    getEnum(id: number): EnumComposition | null {
        return getEnum(this.osrsClient, id);
    }

    getObjectDefinition(id: number): ObjectComposition | null {
        return getObjectDefinition(this.osrsClient, id);
    }

    getNpcDefinition(id: number): NPCComposition | null {
        const client = this.osrsClient;
        if (!(id >= 0)) return null;
        let type = client.npcTypeLoader?.load(id | 0);
        if (type?.transforms && client.varManager) type = type.transform(client.varManager, client.npcTypeLoader) ?? type;
        return type ? { getName: () => type.name, getActions: () => type.actions ?? [] } : null;
    }

    getPlane(): number {
        return ClientState.plane | 0;
    }

    getMouseCanvasPosition(): Point {
        const input = this.osrsClient.inputManager;
        const x = Number(input?.mouseX), y = Number(input?.mouseY);
        return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : { x: -1, y: -1 };
    }

    setHintArrow(target: NPC | WorldPoint): void {
        setHintArrow(target);
    }

    clearHintArrow(): void {
        clearHintArrow();
    }

    getHintArrowNpc(): NPC | null {
        const index = hintArrowNpcIndex();
        return index > 0 ? this.npc(index) : null;
    }
}
