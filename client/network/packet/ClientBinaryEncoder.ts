/**
 * ClientBinaryEncoder - Encode client messages to binary format
 *
 * Replaces JSON.stringify for client-to-server messages.
 * All encoding methods match OSRS buffer patterns.
 */
import { CLIENT_PACKET_LENGTHS, ClientPacketId } from "../../common/packets/ClientPacketId";
import {
    FriendsChatActionCode,
    type FriendsChatAction,
} from "../../common/social/FriendsChat";

/**
 * Binary packet buffer for client encoding
 */
export class ClientPacketBuffer {
    readonly data: Uint8Array;
    offset: number = 0;

    constructor(size: number = 5000) {
        this.data = new Uint8Array(size);
    }

    writeByte(value: number): void {
        this.data[this.offset++] = value & 0xff;
    }

    writeShort(value: number): void {
        this.data[this.offset++] = (value >> 8) & 0xff;
        this.data[this.offset++] = value & 0xff;
    }

    writeInt(value: number): void {
        this.data[this.offset++] = (value >> 24) & 0xff;
        this.data[this.offset++] = (value >> 16) & 0xff;
        this.data[this.offset++] = (value >> 8) & 0xff;
        this.data[this.offset++] = value & 0xff;
    }

    writeBoolean(value: boolean): void {
        this.writeByte(value ? 1 : 0);
    }

    writeString(str: string): void {
        for (let i = 0; i < str.length; i++) {
            this.data[this.offset++] = str.charCodeAt(i) & 0xff;
        }
        this.data[this.offset++] = 0; // null terminator
    }

    /** Write byte with ADD encoding: (value + 128) & 0xFF */
    writeByteAdd(value: number): void {
        this.data[this.offset++] = (value + 128) & 0xff;
    }

    /** Write byte with NEG encoding: (0 - value) & 0xFF */
    writeByteNeg(value: number): void {
        this.data[this.offset++] = (0 - value) & 0xff;
    }

    /** Write byte with SUB encoding: (128 - value) & 0xFF */
    writeByteSub(value: number): void {
        this.data[this.offset++] = (128 - value) & 0xff;
    }

    /** Write short little-endian: [low, high] */
    writeShortLE(value: number): void {
        this.data[this.offset++] = value & 0xff;
        this.data[this.offset++] = (value >> 8) & 0xff;
    }

    /** Write short with ADD encoding: [low+128, high] */
    writeShortAdd(value: number): void {
        this.data[this.offset++] = (value + 128) & 0xff;
        this.data[this.offset++] = (value >> 8) & 0xff;
    }

    /** Write short with ADD LE encoding: [high, low+128] */
    writeShortAddLE(value: number): void {
        this.data[this.offset++] = (value >> 8) & 0xff;
        this.data[this.offset++] = (value + 128) & 0xff;
    }

    /** Write int little-endian: [b0, b1, b2, b3] */
    writeIntLE(value: number): void {
        this.data[this.offset++] = value & 0xff;
        this.data[this.offset++] = (value >> 8) & 0xff;
        this.data[this.offset++] = (value >> 16) & 0xff;
        this.data[this.offset++] = (value >> 24) & 0xff;
    }

    /** Write int middle-endian: [b1, b0, b3, b2] */
    writeIntME(value: number): void {
        this.data[this.offset++] = (value >> 8) & 0xff;
        this.data[this.offset++] = value & 0xff;
        this.data[this.offset++] = (value >> 24) & 0xff;
        this.data[this.offset++] = (value >> 16) & 0xff;
    }

    /** Write int inverse middle-endian: [b2, b3, b0, b1] */
    writeIntIME(value: number): void {
        this.data[this.offset++] = (value >> 16) & 0xff;
        this.data[this.offset++] = (value >> 24) & 0xff;
        this.data[this.offset++] = value & 0xff;
        this.data[this.offset++] = (value >> 8) & 0xff;
    }

    toPacket(opcode: ClientPacketId): Uint8Array {
        const length = CLIENT_PACKET_LENGTHS[opcode];
        const dataLen = this.offset;

        if (length === -1) {
            // Variable byte length
            const result = new Uint8Array(dataLen + 2);
            result[0] = opcode;
            result[1] = dataLen & 0xff;
            result.set(this.data.subarray(0, dataLen), 2);
            return result;
        } else if (length === -2) {
            // Variable short length
            const result = new Uint8Array(dataLen + 3);
            result[0] = opcode;
            result[1] = (dataLen >> 8) & 0xff;
            result[2] = dataLen & 0xff;
            result.set(this.data.subarray(0, dataLen), 3);
            return result;
        } else {
            // Fixed length
            const result = new Uint8Array(dataLen + 1);
            result[0] = opcode;
            result.set(this.data.subarray(0, dataLen), 1);
            return result;
        }
    }

    reset(): void {
        this.offset = 0;
    }
}

/**
 * Encode client messages to binary packets
 */
export class ClientBinaryEncoder {
    private buffer = new ClientPacketBuffer(65536);

    // ========================================
    // CORE PROTOCOL
    // ========================================

    encodeHello(client: string, version?: string): Uint8Array {
        this.buffer.reset();
        this.buffer.writeString(client);
        this.buffer.writeString(version ?? "");
        return this.buffer.toPacket(ClientPacketId.HELLO);
    }

    encodePing(time: number): Uint8Array {
        this.buffer.reset();
        this.buffer.writeInt(time);
        return this.buffer.toPacket(ClientPacketId.PING);
    }

    encodeHandshake(name?: string, appearance?: any, clientType?: number): Uint8Array {
        this.buffer.reset();
        this.buffer.writeString(name ?? "");
        if (appearance) {
            this.buffer.writeBoolean(true);
            this.buffer.writeByte(appearance.gender ?? 0);
            const colors = appearance.colors ?? [];
            this.buffer.writeByte(colors.length);
            for (const c of colors) this.buffer.writeByte(c);
            const kits = appearance.kits ?? [];
            this.buffer.writeByte(kits.length);
            for (const k of kits) this.buffer.writeShort(k);
            const equip = appearance.equip ?? [];
            this.buffer.writeByte(equip.length);
            for (const e of equip) this.buffer.writeShort(e);
        } else {
            this.buffer.writeBoolean(false);
        }
        this.buffer.writeByte((clientType ?? 0) & 0xff);
        return this.buffer.toPacket(ClientPacketId.HANDSHAKE);
    }

    encodeLogout(): Uint8Array {
        this.buffer.reset();
        return this.buffer.toPacket(ClientPacketId.LOGOUT);
    }

    encodeLogin(username: string, password: string, revision: number): Uint8Array {
        this.buffer.reset();
        this.buffer.writeString(username ?? "");
        this.buffer.writeString(password ?? "");
        this.buffer.writeInt(revision);
        return this.buffer.toPacket(ClientPacketId.LOGIN);
    }

    // ========================================
    // MOVEMENT
    // ========================================

    encodeWalk(x: number, y: number, run?: boolean, modifierFlags?: number): Uint8Array {
        this.buffer.reset();
        this.buffer.writeShort(x);
        this.buffer.writeShort(y);
        // flags: bit 0 = run, bits 1-7 = modifierFlags
        let flags = run ? 1 : 0;
        if (modifierFlags) flags |= modifierFlags << 1;
        this.buffer.writeByte(flags);
        return this.buffer.toPacket(ClientPacketId.WALK);
    }

    encodeSetHeading(heading: number): Uint8Array {
        this.buffer.reset();
        this.buffer.writeByte(heading & 15);
        return this.buffer.toPacket(ClientPacketId.SET_HEADING);
    }

    encodeFace(rot?: number, tile?: { x: number; y: number }): Uint8Array {
        this.buffer.reset();
        this.buffer.writeBoolean(rot !== undefined);
        if (rot !== undefined) {
            this.buffer.writeShort(rot);
        }
        this.buffer.writeBoolean(tile !== undefined);
        if (tile) {
            this.buffer.writeShort(tile.x);
            this.buffer.writeShort(tile.y);
        }
        return this.buffer.toPacket(ClientPacketId.FACE);
    }

    encodeTeleport(x: number, y: number, level?: number): Uint8Array {
        this.buffer.reset();
        this.buffer.writeShort(x);
        this.buffer.writeShort(y);
        this.buffer.writeByte(level ?? 0);
        return this.buffer.toPacket(ClientPacketId.TELEPORT);
    }

    encodePathfind(
        id: number,
        from: { x: number; y: number; plane: number },
        to: { x: number; y: number },
        size?: number,
    ): Uint8Array {
        this.buffer.reset();
        this.buffer.writeInt(id);
        this.buffer.writeShort(from.x);
        this.buffer.writeShort(from.y);
        this.buffer.writeByte(from.plane);
        this.buffer.writeShort(to.x);
        this.buffer.writeShort(to.y);
        this.buffer.writeByte(size ?? 1);
        return this.buffer.toPacket(ClientPacketId.PATHFIND);
    }

    encodeLocInteract(
        id: number,
        tile: { x: number; y: number },
        level?: number,
        action?: string,
        opNum?: number,
    ): Uint8Array {
        this.buffer.reset();
        this.buffer.writeShort(id);
        this.buffer.writeShort(tile.x);
        this.buffer.writeShort(tile.y);
        this.buffer.writeByte(level ?? 0);
        this.buffer.writeString(action ?? "");
        this.buffer.writeByte(opNum ?? 0);
        return this.buffer.toPacket(ClientPacketId.LOC_INTERACT);
    }

    encodeGroundItemAction(payload: any): Uint8Array {
        this.buffer.reset();
        this.buffer.writeInt(payload.stackId);
        this.buffer.writeShort(payload.tile.x);
        this.buffer.writeShort(payload.tile.y);
        this.buffer.writeByte(payload.tile.level ?? 0);
        this.buffer.writeShort(payload.itemId);
        this.buffer.writeInt(payload.quantity ?? 1);
        this.buffer.writeString(payload.option ?? "");
        this.buffer.writeByte(payload.opNum ?? 0);
        return this.buffer.toPacket(ClientPacketId.GROUND_ITEM_ACTION);
    }

    encodeInteract(mode: "follow" | "trade", targetId: number): Uint8Array {
        this.buffer.reset();
        this.buffer.writeByte(mode === "follow" ? 0 : 1);
        this.buffer.writeShort(targetId);
        return this.buffer.toPacket(ClientPacketId.INTERACT);
    }

    encodeInteractStop(): Uint8Array {
        this.buffer.reset();
        return this.buffer.toPacket(ClientPacketId.INTERACT_STOP);
    }

    // ========================================
    // INVENTORY
    // ========================================

    encodeInventoryUse(
        slot: number,
        itemId: number,
        quantity?: number,
        option?: string,
    ): Uint8Array {
        this.buffer.reset();
        this.buffer.writeShort(slot);
        this.buffer.writeShort(itemId);
        this.buffer.writeInt(quantity ?? 1);
        this.buffer.writeString(option ?? "");
        return this.buffer.toPacket(ClientPacketId.INVENTORY_USE);
    }

    encodeInventoryUseOn(slot: number, itemId: number, target: any): Uint8Array {
        this.buffer.reset();
        this.buffer.writeShort(slot);
        this.buffer.writeShort(itemId);
        // Target kind: npc=0, loc=1, obj=2, player=3, inv=4
        const kindMap: Record<string, number> = { npc: 0, loc: 1, obj: 2, player: 3, inv: 4 };
        this.buffer.writeByte(kindMap[target.kind] ?? 0);
        this.buffer.writeShort(target.id ?? 0);
        this.buffer.writeBoolean(target.tile !== undefined);
        if (target.tile) {
            this.buffer.writeShort(target.tile.x);
            this.buffer.writeShort(target.tile.y);
        }
        this.buffer.writeByte(target.plane ?? 0);
        if (target.kind === "inv") {
            this.buffer.writeShort(target.slot ?? 0);
            this.buffer.writeShort(target.itemId ?? 0);
        }
        return this.buffer.toPacket(ClientPacketId.INVENTORY_USE_ON);
    }

    encodeInventoryMove(from: number, to: number): Uint8Array {
        this.buffer.reset();
        this.buffer.writeShort(from);
        this.buffer.writeShort(to);
        return this.buffer.toPacket(ClientPacketId.INVENTORY_MOVE);
    }

    encodeBankDepositInventory(): Uint8Array {
        this.buffer.reset();
        return this.buffer.toPacket(ClientPacketId.BANK_DEPOSIT_INVENTORY);
    }

    encodeBankDepositEquipment(): Uint8Array {
        this.buffer.reset();
        return this.buffer.toPacket(ClientPacketId.BANK_DEPOSIT_EQUIPMENT);
    }

    encodeBankMove(from: number, to: number, mode?: "swap" | "insert", tab?: number): Uint8Array {
        this.buffer.reset();
        this.buffer.writeShort(from);
        this.buffer.writeShort(to);
        this.buffer.writeByte(mode === "insert" ? 1 : 0);
        this.buffer.writeByte(tab ?? 0);
        return this.buffer.toPacket(ClientPacketId.BANK_MOVE);
    }

    // ========================================
    // WIDGETS/UI
    // ========================================

    encodeWidget(action: "open" | "close", groupId: number, modal?: boolean): Uint8Array {
        this.buffer.reset();
        this.buffer.writeByte(action === "open" ? 0 : 1);
        this.buffer.writeShort(groupId);
        this.buffer.writeBoolean(modal ?? false);
        return this.buffer.toPacket(ClientPacketId.WIDGET);
    }

    encodeWidgetAction(payload: any): Uint8Array {
        this.buffer.reset();
        this.buffer.writeInt(payload.widgetId);
        this.buffer.writeShort(payload.groupId);
        this.buffer.writeShort(payload.childId);
        this.buffer.writeString(payload.option ?? "");
        this.buffer.writeString(payload.target ?? "");
        this.buffer.writeByte(payload.opId ?? 0);
        this.buffer.writeByte(payload.buttonNum ?? 0);
        this.buffer.writeShort(payload.cursorX ?? 0);
        this.buffer.writeShort(payload.cursorY ?? 0);
        this.buffer.writeBoolean(payload.isPrimary ?? false);
        this.buffer.writeShort(payload.slot ?? -1);
        this.buffer.writeShort(payload.itemId ?? -1);
        return this.buffer.toPacket(ClientPacketId.WIDGET_ACTION);
    }

    encodeResumePausebutton(widgetId: number, childIndex: number): Uint8Array {
        this.buffer.reset();
        this.buffer.writeInt(widgetId);
        this.buffer.writeShort(childIndex);
        return this.buffer.toPacket(ClientPacketId.RESUME_PAUSEBUTTON);
    }

    encodeResumeCountdialog(value: number): Uint8Array {
        this.buffer.reset();
        this.buffer.writeInt(value | 0);
        return this.buffer.toPacket(ClientPacketId.RESUME_COUNTDIALOG);
    }

    encodeResumeNamedialog(value: string): Uint8Array {
        this.buffer.reset();
        this.buffer.writeString(value ?? "");
        return this.buffer.toPacket(ClientPacketId.RESUME_NAMEDIALOG);
    }

    encodeResumeStringdialog(value: string): Uint8Array {
        this.buffer.reset();
        this.buffer.writeString(value ?? "");
        return this.buffer.toPacket(ClientPacketId.RESUME_STRINGDIALOG);
    }

    encodeIfButtond(payload: any): Uint8Array {
        this.buffer.reset();
        this.buffer.writeShortLE(payload.targetItemId | 0);
        this.buffer.writeIntLE(payload.targetWidgetId | 0);
        this.buffer.writeShort(payload.sourceItemId | 0);
        this.buffer.writeShortAddLE(payload.sourceSlot | 0);
        this.buffer.writeIntME(payload.sourceWidgetId | 0);
        this.buffer.writeShortLE(payload.targetSlot | 0);
        return this.buffer.toPacket(ClientPacketId.IF_BUTTOND);
    }

    encodeEmote(index: number, loop?: boolean): Uint8Array {
        this.buffer.reset();
        this.buffer.writeShort(index);
        this.buffer.writeBoolean(loop ?? false);
        return this.buffer.toPacket(ClientPacketId.EMOTE);
    }

    // ========================================
    // TRADE
    // ========================================

    encodeTradeAction(payload: any): Uint8Array {
        this.buffer.reset();
        // action: offer=0, remove=1, accept=2, decline=3, confirm_accept=4, confirm_decline=5
        const actionMap: Record<string, number> = {
            offer: 0,
            remove: 1,
            accept: 2,
            decline: 3,
            confirm_accept: 4,
            confirm_decline: 5,
        };
        this.buffer.writeByte(actionMap[payload.action] ?? 0);
        this.buffer.writeShort(payload.slot ?? 0);
        this.buffer.writeInt(payload.quantity ?? 0);
        this.buffer.writeShort(payload.itemId ?? -1);
        return this.buffer.toPacket(ClientPacketId.TRADE_ACTION);
    }

    // ========================================
    // CHAT/VARPS
    // ========================================

    encodeChat(text: string, messageType?: "public" | "game" | "friends_chat"): Uint8Array {
        this.buffer.reset();
        this.buffer.writeByte(messageType === "friends_chat" ? 2 : messageType === "game" ? 1 : 0);
        this.buffer.writeString(text);
        return this.buffer.toPacket(ClientPacketId.CHAT);
    }

    encodeFriendsChatAction(payload: FriendsChatAction): Uint8Array {
        this.buffer.reset();
        const actionCodes: Record<FriendsChatAction["action"], FriendsChatActionCode> = {
            join: FriendsChatActionCode.Join,
            leave: FriendsChatActionCode.Leave,
            kick: FriendsChatActionCode.Kick,
            add_friend: FriendsChatActionCode.AddFriend,
            remove_friend: FriendsChatActionCode.RemoveFriend,
            set_friend_rank: FriendsChatActionCode.SetFriendRank,
            add_ignore: FriendsChatActionCode.AddIgnore,
            remove_ignore: FriendsChatActionCode.RemoveIgnore,
        };
        this.buffer.writeByte(actionCodes[payload.action]);
        this.buffer.writeString("name" in payload ? payload.name : "");
        this.buffer.writeByte(payload.action === "set_friend_rank" ? payload.rank : 0);
        return this.buffer.toPacket(ClientPacketId.FRIENDS_CHAT_ACTION);
    }

    encodePrivateMessage(recipient: string, text: string): Uint8Array {
        this.buffer.reset();
        this.buffer.writeString(recipient);
        this.buffer.writeString(text);
        return this.buffer.toPacket(ClientPacketId.PRIVATE_MESSAGE);
    }

    encodeChatFilter(publicMode: number, privateMode: number, tradeMode: number): Uint8Array {
        this.buffer.reset();
        this.buffer.writeByte(publicMode);
        this.buffer.writeByte(privateMode);
        this.buffer.writeByte(tradeMode);
        return this.buffer.toPacket(ClientPacketId.CHAT_FILTER);
    }

    encodeVarpTransmit(varpId: number, value: number): Uint8Array {
        this.buffer.reset();
        this.buffer.writeShort(varpId);
        this.buffer.writeInt(value);
        return this.buffer.toPacket(ClientPacketId.VARP_TRANSMIT);
    }

    // ========================================
    // DEBUG
    // ========================================

    encodeDebug(payload: any): Uint8Array {
        this.buffer.reset();
        this.buffer.writeString(JSON.stringify(payload));
        return this.buffer.toPacket(ClientPacketId.DEBUG);
    }
}

// Singleton instance
export const clientEncoder = new ClientBinaryEncoder();

/**
 * Encode a client message to binary
 */
export function encodeClientMessage(msg: { type: string; payload: any }): Uint8Array {
    const { type, payload } = msg;

    switch (type) {
        case "hello":
            return clientEncoder.encodeHello(payload.client, payload.version);

        case "ping":
            return clientEncoder.encodePing(payload.time);

        case "handshake":
            return clientEncoder.encodeHandshake(
                payload.name,
                payload.appearance,
                payload.clientType,
            );

        case "logout":
            return clientEncoder.encodeLogout();

        case "login":
            return clientEncoder.encodeLogin(payload.username, payload.password, payload.revision);

        case "walk":
            return clientEncoder.encodeWalk(
                payload.to.x,
                payload.to.y,
                payload.run,
                payload.modifierFlags,
            );

        case "face":
            return clientEncoder.encodeFace(payload.rot, payload.tile);

        case "set_heading":
            return clientEncoder.encodeSetHeading(payload.heading);

        case "teleport":
            return clientEncoder.encodeTeleport(payload.to.x, payload.to.y, payload.level);

        case "pathfind":
            return clientEncoder.encodePathfind(payload.id, payload.from, payload.to, payload.size);

        case "loc_interact":
            return clientEncoder.encodeLocInteract(
                payload.id,
                payload.tile,
                payload.level,
                payload.action,
                payload.opNum,
            );

        case "ground_item_action":
            return clientEncoder.encodeGroundItemAction(payload);

        case "interact":
            return clientEncoder.encodeInteract(payload.mode, payload.targetId);

        case "interact_stop":
            return clientEncoder.encodeInteractStop();

        case "inventory_use":
            return clientEncoder.encodeInventoryUse(
                payload.slot,
                payload.itemId,
                payload.quantity,
                payload.option,
            );

        case "inventory_use_on":
            return clientEncoder.encodeInventoryUseOn(payload.slot, payload.itemId, payload.target);

        case "inventory_move":
            return clientEncoder.encodeInventoryMove(payload.from, payload.to);

        case "bank_deposit_inventory":
            return clientEncoder.encodeBankDepositInventory();

        case "bank_deposit_equipment":
            return clientEncoder.encodeBankDepositEquipment();

        case "bank_move":
            return clientEncoder.encodeBankMove(
                payload.from,
                payload.to,
                payload.mode,
                payload.tab,
            );

        case "widget":
            return clientEncoder.encodeWidget(payload.action, payload.groupId, payload.modal);

        case "widget_action":
            return clientEncoder.encodeWidgetAction(payload);

        case "resume_pausebutton":
            return clientEncoder.encodeResumePausebutton(payload.widgetId, payload.childIndex);

        case "if_buttond":
            return clientEncoder.encodeIfButtond(payload);

        case "emote":
            return clientEncoder.encodeEmote(payload.index, payload.loop);

        case "trade_action":
            return clientEncoder.encodeTradeAction(payload);

        case "chat":
            return clientEncoder.encodeChat(payload.text, payload.messageType);

        case "friends_chat_action":
            return clientEncoder.encodeFriendsChatAction(payload);

        case "private_message":
            return clientEncoder.encodePrivateMessage(payload.recipient, payload.text);

        case "chat_filter":
            return clientEncoder.encodeChatFilter(
                payload.publicMode,
                payload.privateMode,
                payload.tradeMode,
            );

        case "varp_transmit":
            return clientEncoder.encodeVarpTransmit(payload.varpId, payload.value);

        case "resume_countdialog":
            return clientEncoder.encodeResumeCountdialog(payload.amount);

        case "resume_namedialog":
            return clientEncoder.encodeResumeNamedialog(payload.value);

        case "resume_stringdialog":
            return clientEncoder.encodeResumeStringdialog(payload.value);

        case "debug":
            return clientEncoder.encodeDebug(payload);

        default:
            throw new Error(`Unknown client message type: ${type}`);
    }
}
