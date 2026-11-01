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

export interface ClanState {
    settings: Map<number, ClanSettings>;
    channels: Map<number, KeyedClanChannel>;
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
