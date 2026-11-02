package gateway.tsps

/**
 * tsps server→client opcodes and their lengths, mirroring `ServerPacketId` and
 * `SERVER_PACKET_LENGTHS` in `server/.../net/protocol/ServerPackets.ts`; `TspsServerPacketTest`
 * fails when they drift apart. A length ≥ 0 is fixed, -1 is a u8 length prefix, -2 a u16 one.
 */
@Suppress("unused")
object TspsServerPacket {
    const val WELCOME = 0
    const val TICK = 1
    const val HANDSHAKE = 2
    const val LOGIN_RESPONSE = 3
    const val LOGOUT_RESPONSE = 4
    const val PATH_RESPONSE = 5
    const val PLUGIN_MESSAGE = 6
    const val PLAYER_SYNC = 20
    const val NPC_INFO = 21
    const val ANIM = 22
    const val MOVEMENT_POSITION = 23
    const val VARP_SMALL = 40
    const val VARP_LARGE = 41
    const val VARBIT = 42
    const val VARP_BATCH = 43
    const val VARP_LONG = 44
    const val INVENTORY_SNAPSHOT = 50
    const val INVENTORY_SLOT = 51
    const val BANK_SNAPSHOT = 52
    const val BANK_SLOT = 53
    const val GROUND_ITEMS = 54
    const val GROUND_ITEMS_DELTA = 55
    const val SKILLS_SNAPSHOT = 70
    const val SKILLS_DELTA = 71
    const val COMBAT_STATE = 80
    const val RUN_ENERGY = 81
    const val HITSPLAT = 82
    const val SPOT_ANIM = 83
    const val PROJECTILES = 84
    const val SPELL_RESULT = 85
    const val DEBUG_PACKET = 86
    const val DESTINATION = 87
    const val PLAYER_OPTION = 88
    const val HINT_ARROW = 89
    const val ATTACK_TIMER = 90
    const val WIDGET_OPEN = 100
    const val WIDGET_CLOSE = 101
    const val WIDGET_SET_ROOT = 102
    const val WIDGET_OPEN_SUB = 103
    const val WIDGET_CLOSE_SUB = 104
    const val WIDGET_SET_TEXT = 105
    const val WIDGET_SET_HIDDEN = 106
    const val WIDGET_SET_ITEM = 107
    const val WIDGET_SET_NPC_HEAD = 108
    const val WIDGET_SET_FLAGS_RANGE = 109
    const val WIDGET_RUN_SCRIPT = 110
    const val WIDGET_SET_FLAGS = 111
    const val WIDGET_SET_FLAGS_RANGE_V2 = 112
    const val WIDGET_SET_ANGLE = 113
    const val WIDGET_SET_ANIMATION = 114
    const val WIDGET_SET_PLAYER_HEAD = 115
    const val WIDGET_SET_QUEST_LIST = 116
    const val WIDGET_SET_MODEL = 117
    const val WIDGET_SET_POSITION = 118
    const val WIDGET_SET_COLOUR = 119
    const val CHAT_MESSAGE = 120
    const val FRIENDS_CHAT_UPDATE = 121
    const val CHAT_FILTER_SETTINGS = 122
    const val TRIGGER_ONDIALOGABORT = 123
    const val CLAN_SETTINGS_FULL = 124
    const val CLAN_CHANNEL_FULL = 125
    const val CLAN_CHANNEL_DELTA = 126
    const val CLAN_SETTINGS_DELTA = 127
    const val CLAN_VAR = 128
    const val LOC_CHANGE = 130
    const val SOUND = 131
    const val PLAY_JINGLE = 132
    const val PLAY_SONG = 133
    const val LOC_ADD_CHANGE = 134
    const val LOC_DEL = 135
    const val LOC_ANIM = 136
    const val CAMERA_CONTROL = 137
    const val REBUILD_REGION = 140
    const val REBUILD_NORMAL = 141
    const val REBUILD_WORLDENTITY = 142
    const val WORLDENTITY_INFO = 143
    const val REGION_REPLACEMENT = 144
    const val SET_INTERACTION_MODE = 145
    const val RESET_INTERACTION_MODE = 146
    const val SHOP_OPEN = 150
    const val SHOP_SLOT = 151
    const val SHOP_CLOSE = 152
    const val SHOP_MODE = 153
    const val TRADE_REQUEST = 154
    const val TRADE_OPEN = 155
    const val TRADE_UPDATE = 156
    const val TRADE_CLOSE = 157
    const val RUN_CLIENT_SCRIPT = 170
    const val SMITHING_OPEN = 180
    const val SMITHING_MODE = 181
    const val SMITHING_CLOSE = 182
    const val COLLECTION_LOG_SNAPSHOT = 190
    const val NOTIFICATION = 200
    const val GAMEMODE_DATA = 210
    const val SYSTEM_UPDATE = 220
    const val DEBUG = 250

    val LENGTHS: Map<Int, Int> =
        mapOf(
            PLUGIN_MESSAGE to -2,
            WELCOME to 8,
            TICK to 8,
            HANDSHAKE to -1,
            CAMERA_CONTROL to -1,
            LOGIN_RESPONSE to -1,
            LOGOUT_RESPONSE to -1,
            PATH_RESPONSE to -1,
            PLAYER_SYNC to -2,
            MOVEMENT_POSITION to 18,
            NPC_INFO to -2,
            ANIM to 22,
            VARP_SMALL to 3,
            VARP_LARGE to 6,
            VARBIT to 6,
            VARP_BATCH to -1,
            VARP_LONG to 10,
            INVENTORY_SNAPSHOT to -2,
            INVENTORY_SLOT to -1,
            BANK_SNAPSHOT to -2,
            BANK_SLOT to -1,
            GROUND_ITEMS to -2,
            GROUND_ITEMS_DELTA to -2,
            SKILLS_SNAPSHOT to -1,
            SKILLS_DELTA to -1,
            COMBAT_STATE to -1,
            RUN_ENERGY to 2,
            HITSPLAT to -1,
            SPOT_ANIM to -1,
            PROJECTILES to -2,
            SPELL_RESULT to -2,
            DEBUG_PACKET to -2,
            PLAYER_OPTION to -1,
            DESTINATION to 4,
            HINT_ARROW to 7,
            ATTACK_TIMER to 1,
            WIDGET_OPEN to 3,
            WIDGET_CLOSE to 2,
            WIDGET_SET_ROOT to 2,
            WIDGET_OPEN_SUB to -2,
            WIDGET_CLOSE_SUB to 4,
            WIDGET_SET_TEXT to -2,
            WIDGET_SET_MODEL to 8,
            WIDGET_SET_POSITION to 8,
            WIDGET_SET_ANGLE to 10,
            WIDGET_SET_COLOUR to 6,
            WIDGET_SET_HIDDEN to 5,
            WIDGET_SET_ITEM to 10,
            WIDGET_SET_NPC_HEAD to 6,
            WIDGET_SET_FLAGS_RANGE to 12,
            WIDGET_SET_FLAGS_RANGE_V2 to 16,
            WIDGET_RUN_SCRIPT to -2,
            WIDGET_SET_FLAGS to 8,
            WIDGET_SET_ANIMATION to 6,
            WIDGET_SET_PLAYER_HEAD to 4,
            WIDGET_SET_QUEST_LIST to -2,
            CHAT_MESSAGE to -2,
            FRIENDS_CHAT_UPDATE to -2,
            CHAT_FILTER_SETTINGS to 3,
            TRIGGER_ONDIALOGABORT to 0,
            CLAN_SETTINGS_FULL to -2,
            CLAN_CHANNEL_FULL to -2,
            CLAN_CHANNEL_DELTA to -2,
            CLAN_SETTINGS_DELTA to -2,
            CLAN_VAR to 6,
            LOC_CHANGE to -1,
            LOC_ADD_CHANGE to -1,
            LOC_DEL to -1,
            LOC_ANIM to 10,
            SOUND to -1,
            PLAY_JINGLE to 5,
            PLAY_SONG to 10,
            REBUILD_REGION to -2,
            REBUILD_NORMAL to -2,
            REBUILD_WORLDENTITY to -2,
            WORLDENTITY_INFO to -1,
            REGION_REPLACEMENT to -2,
            SET_INTERACTION_MODE to 4,
            RESET_INTERACTION_MODE to 2,
            SHOP_OPEN to -2,
            SHOP_SLOT to -1,
            SHOP_CLOSE to 0,
            SHOP_MODE to -1,
            TRADE_REQUEST to -1,
            TRADE_OPEN to -2,
            TRADE_UPDATE to -2,
            TRADE_CLOSE to -1,
            RUN_CLIENT_SCRIPT to -2,
            SMITHING_OPEN to -2,
            SMITHING_MODE to 5,
            SMITHING_CLOSE to 0,
            COLLECTION_LOG_SNAPSHOT to -2,
            NOTIFICATION to -1,
            GAMEMODE_DATA to -2,
            SYSTEM_UPDATE to 4,
            DEBUG to -2,
        )
}
