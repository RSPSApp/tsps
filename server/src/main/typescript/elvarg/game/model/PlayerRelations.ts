import { Player } from "../entity/impl/player/Player";
import { World } from "../World";
import { Misc } from "../../util/Misc";

export class PlayerRelations {
    private static readonly MAX_FRIENDS = 200;
    private static readonly MAX_IGNORES = 100;
    private status: PrivateChatStatus = PrivateChatStatus.ON;
    private publicChatMode = 0;
    private tradeChatMode = 0;
    public friendList: Array<bigint> = [];
    public ignoreList: Array<bigint> = [];
    private friendSet: Set<bigint> = new Set<bigint>();
    private ignoreSet: Set<bigint> = new Set<bigint>();
    private friendRanks = new Map<bigint, number>();
    private friendsChatChannelName = "";
    private friendsChatLastOwner = "";
    private friendsChatEntryRank = -1;
    private friendsChatTalkRank = -1;
    private friendsChatKickRank = 2;
    private privateMessageId = 1;
    private player: Player;

    constructor(player: Player) {
        this.player = player;
    }

    public getPrivateMessageId(): number {
        return this.privateMessageId++;
    }

    public setPrivateMessageId(privateMessageId: number): PlayerRelations {
        this.privateMessageId = privateMessageId;
        return this;
    }

    public setStatus(status: PrivateChatStatus, update: boolean): PlayerRelations {
        this.status = status;
        if (update) {
            this.updateLists(true);
        }
        return this;
    }

    public getStatus(): PrivateChatStatus {
        return this.status;
    }

    public setChatModes(publicMode: number, privateMode: number, tradeMode: number): void {
        this.publicChatMode = Math.max(0, Math.min(3, publicMode | 0));
        this.tradeChatMode = Math.max(0, Math.min(2, tradeMode | 0));
        this.setStatus(Math.max(0, Math.min(2, privateMode | 0)) as PrivateChatStatus, false);
    }

    public getPublicChatMode(): number {
        return this.publicChatMode;
    }

    public getTradeChatMode(): number {
        return this.tradeChatMode;
    }

    public getFriendList(): Array<bigint> {
        return this.friendList;
    }

    public getIgnoreList(): Array<bigint> {
        return this.ignoreList;
    }

    public hasFriend(username: bigint): boolean {
        return this.friendSet.has(username);
    }

    public hasIgnore(username: bigint): boolean {
        return this.ignoreSet.has(username);
    }

    public canReceivePublicChatFrom(other: Player): boolean {
        if (!other || this.hasIgnore(other.getLongUsername())) return false;
        return this.publicChatMode === 0 ||
            (this.publicChatMode === 1 && this.hasFriend(other.getLongUsername()));
    }

    public canReceivePrivateMessageFrom(other: Player): boolean {
        if (!other || this.hasIgnore(other.getLongUsername()) || this.status === PrivateChatStatus.OFF) {
            return false;
        }
        return this.status === PrivateChatStatus.ON || this.hasFriend(other.getLongUsername());
    }

    public getFriendRank(username: bigint): number {
        return this.friendRanks.get(username) ?? 0;
    }

    public setFriendRank(username: bigint, rank: number): boolean {
        if (!this.hasFriend(username)) return false;
        this.friendRanks.set(username, Math.max(0, Math.min(6, rank | 0)));
        return true;
    }

    public getFriendRanks(): Record<string, number> {
        const ranks: Record<string, number> = {};
        for (const [username, rank] of this.friendRanks) {
            if (this.friendSet.has(username)) ranks[username.toString()] = rank;
        }
        return ranks;
    }

    public loadFriendRanks(ranks: Record<string, number> | null | undefined): void {
        this.friendRanks.clear();
        if (!ranks || typeof ranks !== "object") return;
        for (const [rawName, rawRank] of Object.entries(ranks)) {
            try {
                const username = BigInt(rawName);
                if (this.friendList.includes(username) && Number.isFinite(rawRank)) {
                    this.friendRanks.set(username, Math.max(0, Math.min(6, rawRank | 0)));
                }
            } catch {}
        }
    }

    public getFriendsChatChannelName(): string {
        return this.friendsChatChannelName;
    }

    public setFriendsChatChannelName(name: string): void {
        this.friendsChatChannelName = String(name ?? "");
    }

    public getFriendsChatLastOwner(): string {
        return this.friendsChatLastOwner;
    }

    public setFriendsChatLastOwner(owner: string): void {
        this.friendsChatLastOwner = String(owner ?? "");
    }

    public getFriendsChatEntryRank(): number {
        return this.friendsChatEntryRank;
    }

    public getFriendsChatTalkRank(): number {
        return this.friendsChatTalkRank;
    }

    public getFriendsChatKickRank(): number {
        return this.friendsChatKickRank;
    }

    public setFriendsChatRanks(entryRank: number, talkRank: number, kickRank: number): void {
        this.friendsChatEntryRank = Math.max(-1, Math.min(7, entryRank | 0));
        this.friendsChatTalkRank = Math.max(-1, Math.min(7, talkRank | 0));
        this.friendsChatKickRank = Math.max(2, Math.min(7, kickRank | 0));
    }

    private rebuildRelationSets(): void {
        this.friendSet = new Set<bigint>(this.friendList);
        this.ignoreSet = new Set<bigint>(this.ignoreList);
        for (const username of this.friendRanks.keys()) {
            if (!this.friendSet.has(username)) this.friendRanks.delete(username);
        }
    }

    updateLists(online: boolean) {
        this.rebuildRelationSets();

        if (this.status === PrivateChatStatus.OFF) {
            online = false;
        }

        this.player.getPacketSender().sendFriendStatus(2);

        World.getPlayers().forEach((other) => {
            if (!other) {
                return;
            }

            let temporaryOnlineStatus = online;
            if (other.getRelations().hasFriend(this.player.getLongUsername())) {
                if (
                    (this.status === PrivateChatStatus.FRIENDS_ONLY &&
                        !this.hasFriend(other.getLongUsername())) ||
                    this.status === PrivateChatStatus.OFF ||
                    this.hasIgnore(other.getLongUsername())
                ) {
                    temporaryOnlineStatus = false;
                }
                other.getPacketSender().sendFriend(
                    this.player.getLongUsername(),
                    temporaryOnlineStatus ? 1 : 0
                );
            }

            let otherVisibleToPlayer = true;
            if (this.hasFriend(other.getLongUsername())) {
                if (
                    (other.getRelations().status === PrivateChatStatus.FRIENDS_ONLY &&
                        !other.getRelations().hasFriend(this.player.getLongUsername())) ||
                    other.getRelations().status === PrivateChatStatus.OFF ||
                    other.getRelations().hasIgnore(this.player.getLongUsername())
                ) {
                    otherVisibleToPlayer = false;
                }
                this.player.getPacketSender().sendFriend(
                    other.getLongUsername(),
                    otherVisibleToPlayer ? 1 : 0
                );
            }
        });

        return this;
    }

    sendPrivateStatus() {
        const privateChat = this.status === PrivateChatStatus.OFF ? 2 : this.status === PrivateChatStatus.FRIENDS_ONLY ? 1 : 0;
        this.player.getPacketSender().sendChatOptions(this.publicChatMode, privateChat, this.tradeChatMode);
    }

    sendFriends() {
        for (const l of this.friendList) {
            if (l) {
                this.player.getPacketSender().sendFriend(l, 0);
            }
        }
    }

    public sendIgnores(): void {
        for (const l of this.ignoreList) {
            if (l) {
                this.player.getPacketSender().sendAddIgnore(l);
            }
        }
    }

    public sendAddFriend(name: bigint): void {
        this.player.getPacketSender().sendFriend(name, 0);
    }

    public sendDeleteFriend(name: bigint): void {
        this.player.getPacketSender().sendDeleteFriend(name);
    }

    public sendAddIgnore(name: bigint): void {
        this.player.getPacketSender().sendAddIgnore(name);
    }

    public sendDeleteIgnore(name: bigint): void {
        this.player.getPacketSender().sendDeleteIgnore(name);
    }

    public onLogin(player: Player): PlayerRelations {
        this.rebuildRelationSets();
        this.sendIgnores();
        this.sendFriends();
        this.sendPrivateStatus();
        return this;
    }

    public addFriend(username: bigint): void {
        const name = Misc.formatName(Misc.longToString(username));
        if (name === this.player.getUsername()) {
            return;
        }
        if (this.friendList.length >= PlayerRelations.MAX_FRIENDS) {
            this.player.sendMessage("Your friend list is full!");
            return;
        }
        if (this.ignoreList.indexOf(username) !== -1) {
            this.player.sendMessage("Please remove " + name + " from your ignore list first.");
            return;
        }
        if (this.friendList.indexOf(username) !== -1) {
            this.player.sendMessage(name + " is already on your friends list!");
        } else {
            this.friendList.push(username);
            this.friendSet.add(username);
            this.friendRanks.set(username, 0);
            this.sendAddFriend(username);
            this.updateLists(true);
            const friend = World.getPlayerByName(name);
            if (friend) {
                friend.getRelations().updateLists(true);
            }
        }
    }

    public isFriendWith(player: string): boolean {
        return this.hasFriend(Misc.stringToLongBigInt(player));
    }

    public deleteFriend(username: bigint): void {
        const name = Misc.formatName(Misc.longToString(username));
        if (name === this.player.getUsername()) {
            return;
        }
        const friendIndex = this.friendList.indexOf(username);
        if (friendIndex !== -1) {
            this.friendList.splice(friendIndex, 1);
            this.friendSet.delete(username);
            this.friendRanks.delete(username);
            this.sendDeleteFriend(username);
            this.updateLists(false);
            const unfriend = World.getPlayerByName(name);
            if (unfriend) {
                unfriend.getRelations().updateLists(false);
            }
        } else {
            this.player.sendMessage("This player is not on your friends list!");
        }
    }

    public addIgnore(username: bigint): void {
        const name = Misc.formatName(Misc.longToString(username));
        if (name === this.player.getUsername()) {
            return;
        }
        if (this.ignoreList.length >= PlayerRelations.MAX_IGNORES) {
            this.player.sendMessage("Your ignore list is full!");
            return;
        }
        if (this.friendList.indexOf(username) !== -1) {
            this.player.sendMessage("Please remove " + name + " from your friend list first.");
            return;
        }
        if (this.ignoreList.indexOf(username) !== -1) {
            this.player.sendMessage(name + " is already on your ignore list!");
        } else {
            this.ignoreList.push(username);
            this.ignoreSet.add(username);
            this.sendAddIgnore(username);
            this.updateLists(true);
            const ignored = World.getPlayerByName(name);
            if (ignored) {
                ignored.getRelations().updateLists(false);
            }
        }
    }

    public deleteIgnore(username: bigint): void {
        const name = Misc.formatName(Misc.longToString(username));
        if (name === this.player.getUsername()) {
            return;
        }
        const ignoreIndex = this.ignoreList.indexOf(username);
        if (ignoreIndex !== -1) {
            this.ignoreList.splice(ignoreIndex, 1);
            this.ignoreSet.delete(username);
            this.sendDeleteIgnore(username);
            this.updateLists(true);
            if (this.status === PrivateChatStatus.ON) {
                const ignored = World.getPlayerByName(name);
                if (ignored) {
                    ignored.getRelations().updateLists(true);
                }
            }
        } else {
            this.player.sendMessage("This player is not on your ignore list!");
        }
    }

    public message(friend: Player, message: Uint8Array, size: number): void {
        if (!friend.getRelations().canReceivePrivateMessageFrom(this.player)) {
            this.player.sendMessage("This player is currently offline.");
            return;
        }
        if (this.status === PrivateChatStatus.OFF) {
            this.setStatus(PrivateChatStatus.FRIENDS_ONLY, true);
        }
        friend.getPacketSender().sendPrivateMessage(this.player, message, size);
    }

}

export enum PrivateChatStatus {
    ON, FRIENDS_ONLY, OFF
}
