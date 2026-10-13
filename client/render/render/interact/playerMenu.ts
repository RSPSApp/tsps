import { ClientState } from "../../../game/ClientState";
import { MenuTargetType, type OsrsMenuEntry } from "../../../rs/MenuEntry";
export interface PlayerMenuActionContext {
    sid: number;
    playerLabel: string;
    targetCombatLevel: number;
    localCombatLevel: number;
    targetTeam: number;
    localTeam: number;
    targetIsClanMember: boolean;
    canAttackPlayers: boolean;
    localX: number;
    localY: number;
    actions: {
        option(serverId: number, slot: number): void;
        follow(serverId: number): void;
        trade(serverId: number): void;
        attack(serverId: number, localX: number, localY: number): void;
    };
}
/** Shared native no-selection path. Player-menu plugin arrays mutate this same packet-backed state. */
export function buildPlayerActionEntries(context: PlayerMenuActionContext): OsrsMenuEntry[] {
    const { sid, playerLabel, targetCombatLevel, localCombatLevel, targetTeam, localTeam, targetIsClanMember, canAttackPlayers, localX, localY, actions } = context;
    const entries: OsrsMenuEntry[] = [];
    // No selection: insert player actions in 7..0 order.
    for (let actionIdx = 7; actionIdx >= 0; actionIdx--) {
        const customOption = ClientState.playerOptions.get(actionIdx + 1);
        if (customOption && !customOption.option)
            continue;
        if (customOption && (actionIdx >= 3 || customOption.option !== ["Attack", "Trade with", "Follow"][actionIdx])) {
            entries.push({
                option: customOption.option,
                targetId: sid | 0,
                targetType: MenuTargetType.PLAYER,
                targetName: playerLabel,
                targetLevel: targetCombatLevel,
                mapX: localX,
                mapY: localY,
                playerServerId: sid | 0,
                actionIndex: actionIdx,
                opcode: customOption.opcode,
                deprioritized: !customOption.priority,
                onClick: () => actions.option(sid | 0, actionIdx + 1),
            });
        }
        else if (actionIdx === 2) {
            entries.push({
                option: "Follow",
                targetId: sid | 0,
                targetType: MenuTargetType.PLAYER,
                targetName: playerLabel,
                targetLevel: targetCombatLevel,
                mapX: localX,
                mapY: localY,
                playerServerId: sid | 0,
                actionIndex: 2, // OPPLAYER3 - Follow
                opcode: customOption?.opcode,
                deprioritized: customOption ? !customOption.priority : false,
                onClick: () => actions.follow(sid | 0),
            });
        }
        else if (actionIdx === 1) {
            // OSRS: Trade is typically a low-priority player option from the server.
            entries.push({
                option: "Trade with",
                targetId: sid | 0,
                targetType: MenuTargetType.PLAYER,
                targetName: playerLabel,
                targetLevel: targetCombatLevel,
                mapX: localX,
                mapY: localY,
                playerServerId: sid | 0,
                actionIndex: 1, // OPPLAYER2 - Trade with
                opcode: customOption?.opcode,
                deprioritized: customOption ? !customOption.priority : true,
                onClick: () => actions.trade(sid | 0),
            });
        }
        else if (actionIdx === 0) {
            // Attack visibility follows the server's current permission.
            if (!canAttackPlayers)
                continue;
            const attackOption = ClientState.playerAttackOption | 0;
            if (attackOption === 3)
                continue;
            let deprioritized = false;
            if (attackOption === 1) {
                deprioritized = true;
            }
            else if (attackOption === 0) {
                deprioritized = targetCombatLevel > localCombatLevel;
            }
            else if (attackOption === 4) {
                deprioritized = targetIsClanMember;
            }
            // Team logic overrides attack option priority when both players have teams.
            if (localTeam !== 0 && targetTeam !== 0) {
                deprioritized = localTeam === targetTeam;
            }
            entries.push({
                option: "Attack",
                targetId: sid | 0,
                targetType: MenuTargetType.PLAYER,
                targetName: playerLabel,
                targetLevel: targetCombatLevel,
                mapX: localX,
                mapY: localY,
                playerServerId: sid | 0,
                actionIndex: 0, // OPPLAYER1 - Attack
                opcode: customOption?.opcode,
                deprioritized: deprioritized || (customOption ? !customOption.priority : false),
                onClick: () => actions.attack(sid | 0, localX, localY),
            });
        }
    }
    return entries;
}
