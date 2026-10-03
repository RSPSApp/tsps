/**
 * Client-to-Server Packet IDs - Binary protocol for JSON message replacement
 *
 * These opcodes are separate from OSRS-style packets (in client/common/network/ClientPacketId.ts).
 * OSRS packets use opcodes 1-103 for low-level game actions (clicks, interactions).
 * These packets use opcode range 180+ for high-level client messages.
 */
export const enum ClientPacketId {
    // ========================================
    // CORE PROTOCOL (200-209)
    // ========================================
    HELLO = 200,
    PING = 201,
    HANDSHAKE = 202,
    LOGOUT = 203,
    LOGIN = 204,

    // ========================================
    // MOVEMENT (210-219)
    // ========================================
    WALK = 210,
    FACE = 211,
    TELEPORT = 212,
    PATHFIND = 213,
    /** Boat helm heading, 0-15 in 128-unit steps (OSRS SetHeading). */
    SET_HEADING = 214,

    // ========================================
    // INTERACTION (230-239)
    // ========================================
    LOC_INTERACT = 231,
    GROUND_ITEM_ACTION = 232,
    INTERACT = 233,
    INTERACT_STOP = 234,

    // ========================================
    // INVENTORY (240-249)
    // ========================================
    INVENTORY_USE = 240,
    INVENTORY_USE_ON = 241,
    INVENTORY_MOVE = 242,
    BANK_DEPOSIT_INVENTORY = 243,
    BANK_DEPOSIT_EQUIPMENT = 244,
    BANK_MOVE = 245,

    // ========================================
    // WIDGETS/UI (250-254)
    // The opcode 250 used to conflict with DEBUG, moved to 255
    // ========================================
    WIDGET = 250,
    WIDGET_ACTION = 251,
    RESUME_PAUSEBUTTON = 252,
    IF_BUTTOND = 253,
    EMOTE = 254,

    // ========================================
    // DEBUG (255 - special)
    // ========================================
    DEBUG = 255,

    // ========================================
    // TRADE (180-189) - moved to avoid 250 range
    // ========================================
    TRADE_ACTION = 180,

    // ========================================
    // CHAT/VARPS (190-199)
    // ========================================
    CHAT = 190,
    VARP_TRANSMIT = 191,
    RESUME_COUNTDIALOG = 192,
    RESUME_NAMEDIALOG = 193,
    RESUME_STRINGDIALOG = 194,
    MAP_EDIT = 195,
    FRIENDS_CHAT_ACTION = 196,
    PRIVATE_MESSAGE = 197,
    CHAT_FILTER = 198,
}

/**
 * Packet length constants
 * -1 = variable byte (1 byte length prefix)
 * -2 = variable short (2 byte length prefix)
 * positive = fixed length
 */
export const CLIENT_PACKET_LENGTHS: Record<ClientPacketId, number> = {
    [ClientPacketId.HELLO]: -1,
    [ClientPacketId.PING]: 4, // time(4)
    [ClientPacketId.HANDSHAKE]: -1,
    [ClientPacketId.LOGOUT]: 0,
    [ClientPacketId.LOGIN]: -2, // username + password (variable)

    [ClientPacketId.WALK]: 5, // x(2) + y(2) + flags(1)
    [ClientPacketId.FACE]: -1,
    [ClientPacketId.TELEPORT]: 5, // x(2) + y(2) + level(1)
    [ClientPacketId.PATHFIND]: -1,
    [ClientPacketId.SET_HEADING]: 1, // heading(1)

    [ClientPacketId.LOC_INTERACT]: -1,
    [ClientPacketId.GROUND_ITEM_ACTION]: -1,
    [ClientPacketId.INTERACT]: -1,
    [ClientPacketId.INTERACT_STOP]: 0,

    [ClientPacketId.INVENTORY_USE]: -1,
    [ClientPacketId.INVENTORY_USE_ON]: -1,
    [ClientPacketId.INVENTORY_MOVE]: 4, // from(2) + to(2)

    [ClientPacketId.BANK_DEPOSIT_INVENTORY]: 0,
    [ClientPacketId.BANK_DEPOSIT_EQUIPMENT]: 0,
    [ClientPacketId.BANK_MOVE]: -1,

    [ClientPacketId.WIDGET]: -1,
    [ClientPacketId.WIDGET_ACTION]: -1,
    [ClientPacketId.RESUME_PAUSEBUTTON]: 6, // widgetId(4) + childIndex(2)
    [ClientPacketId.IF_BUTTOND]: 16, // target item(2) + target widget(4) + source item(2) + source slot(2) + source widget(4) + target slot(2)
    [ClientPacketId.EMOTE]: 3, // index(2) + loop(1)

    [ClientPacketId.TRADE_ACTION]: -1,

    [ClientPacketId.CHAT]: -1,
    [ClientPacketId.VARP_TRANSMIT]: 6, // varpId(2) + value(4)
    [ClientPacketId.RESUME_COUNTDIALOG]: 4, // value(4)
    [ClientPacketId.RESUME_NAMEDIALOG]: -1, // value(string)
    [ClientPacketId.RESUME_STRINGDIALOG]: -1, // value(string)
    [ClientPacketId.MAP_EDIT]: -1, // action(1) + tile(4) + level/type/rotation/id(var)
    [ClientPacketId.FRIENDS_CHAT_ACTION]: -1,
    [ClientPacketId.PRIVATE_MESSAGE]: -1,
    [ClientPacketId.CHAT_FILTER]: 3,

    [ClientPacketId.DEBUG]: -2,
};

/**
 * Check if an opcode is from the new JSON-replacement protocol (180+)
 * vs OSRS-style packets (1-103)
 */
export function isNewProtocolOpcode(opcode: number): boolean {
    return opcode >= 180;
}
