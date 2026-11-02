import type { ClanChannel, ClanSettings } from "../../rs/cs2/handlers/HandlerTypes";

/** The packets' clan types: 0 the player's own clan, -1 the clan they are listening to as a guest. */
export const OWN_CLAN_TYPE = 0;
export const LISTENED_CLAN_TYPE = -1;

export interface KeyedClanChannel extends ClanChannel {
    key: number;
    updateNum: number;
}

export type ClanChannelDeltaEvent =
    | { type: "add"; name: string; rank: number; world: number }
    | { type: "delete"; index: number };

export interface ClanChannelDelta {
    clanType: number;
    key: number;
    updateNum: number;
    events: ClanChannelDeltaEvent[];
}

export type ClanSettingsDeltaUpdate =
    | { type: "add_member"; name: string; joinRuneDay: number }
    | { type: "delete_member"; index: number }
    | { type: "member_rank"; index: number; rank: number }
    | { type: "member_muted"; index: number; muted: boolean }
    | { type: "member_extra_info"; index: number; value: number; startBit: number; endBit: number }
    | { type: "int_setting"; setting: number; value: number };

export interface ClanState {
    settings: Map<number, ClanSettings>;
    channels: Map<number, KeyedClanChannel>;
    /** %varclan values, which belong to the player's own clan. */
    vars: Map<number, number>;
}

/** A delta for another channel than the one held is ignored; a full update always follows a join. */
export function applyClanChannelDelta(
    channel: KeyedClanChannel | undefined,
    delta: ClanChannelDelta,
): KeyedClanChannel | undefined {
    if (!channel || channel.key !== delta.key) return channel;
    const next: KeyedClanChannel = {
        ...channel,
        updateNum: delta.updateNum,
        userNames: [...channel.userNames],
        userRanks: [...channel.userRanks],
        userWorlds: [...channel.userWorlds],
        sortedUserSlots: undefined,
    };
    for (const event of delta.events) {
        if (event.type === "add") {
            next.userNames.push(event.name);
            next.userRanks.push(event.rank);
            next.userWorlds.push(event.world);
        } else {
            next.userNames.splice(event.index, 1);
            next.userRanks.splice(event.index, 1);
            next.userWorlds.splice(event.index, 1);
        }
    }
    return next;
}

/** Sets bits startBit..endBit of `value` to `bits`, as the delta's extra info does. */
function withBits(value: number, bits: number, startBit: number, endBit: number): number {
    const mask = ((1 << (endBit - startBit + 1)) - 1) << startBit;
    return (value & ~mask) | ((bits << startBit) & mask);
}

export function applyClanSettingsDelta(settings: ClanSettings, updates: ClanSettingsDeltaUpdate[]): ClanSettings {
    const next: ClanSettings = {
        ...settings,
        memberNames: [...settings.memberNames],
        memberRanks: [...settings.memberRanks],
        memberExtraInfo: [...settings.memberExtraInfo],
        memberJoinDays: [...settings.memberJoinDays],
        memberMuted: [...settings.memberMuted],
        parameters: new Map(settings.parameters),
    };
    for (const update of updates) {
        if (update.type === "add_member") {
            next.memberNames.push(update.name);
            next.memberRanks.push(0);
            next.memberExtraInfo.push(0);
            next.memberJoinDays.push(update.joinRuneDay);
            next.memberMuted.push(false);
        } else if (update.type === "delete_member") {
            next.memberNames.splice(update.index, 1);
            next.memberRanks.splice(update.index, 1);
            next.memberExtraInfo.splice(update.index, 1);
            next.memberJoinDays.splice(update.index, 1);
            next.memberMuted.splice(update.index, 1);
        } else if (update.type === "member_rank") {
            next.memberRanks[update.index] = update.rank;
        } else if (update.type === "member_muted") {
            next.memberMuted[update.index] = update.muted;
        } else if (update.type === "member_extra_info") {
            next.memberExtraInfo[update.index] = withBits(
                next.memberExtraInfo[update.index],
                update.value,
                update.startBit,
                update.endBit,
            );
        } else {
            next.parameters!.set(update.setting, update.value);
        }
    }
    return next;
}
