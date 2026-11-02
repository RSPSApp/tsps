package gateway.down

import gateway.tsps.TspsPacket
import gateway.tsps.TspsReader
import gateway.tsps.TspsWriter

/** `CHAT_MESSAGE` (120): `text, u8 chat type, from, prefix, u16 player index`. */
class TspsChatMessage(
    val text: String,
    val type: Int,
    val from: String,
    val prefix: String,
    val playerIndex: Int,
    /** Public chat's colour and effect, when the speaker typed one. */
    val style: ChatStyle? = null,
) {
    /** Public chat types: 2, and autochat's 90 and 91. */
    val isPublic: Boolean get() = type == 2 || isAutotyper

    /** Autochat (the autotyper), which OSRS marks in the chat block. */
    val isAutotyper: Boolean get() = type == 90 || type == 91

    /**
     * Messages OSRS sends as MESSAGE_GAME: game (0), broadcast (14), filtered (105), trade and
     * challenge requests (101, 103), and the other system types, among them the clan channel
     * notices 43 and 46 (rsprox 763 has the intro notice as MESSAGE_GAME type 43). Private,
     * friends-chat and clan chat types have their own packets.
     */
    val isGameMessage: Boolean get() = !isPublic && type !in SOCIAL_TYPES

    /** The mod icon tsps puts in front of the name as `<img=N>`, or 0. */
    val modIcon: Int get() = Regex("""<img=(\d+)>""").find(from)?.groupValues?.get(1)?.toInt()?.plus(1) ?: 0

    companion object {
        private const val NO_PLAYER = 0xFFFF

        /** Private in/out, mod private, friends chat and clan chat. */
        private val SOCIAL_TYPES = setOf(3, 6, 7, 9, 41, 44)

        fun decode(packet: TspsPacket): TspsChatMessage {
            val reader = packet.reader()
            val text = reader.string()
            val type = reader.u8()
            val from = reader.string()
            val prefix = reader.string()
            val index = if (reader.remaining >= 2) reader.u16() else NO_PLAYER
            return TspsChatMessage(text, type, from, prefix, if (index == NO_PLAYER) -1 else index, ChatStyle.read(reader))
        }
    }
}

/**
 * A public message's colour (0-20) and effect (0-5), as typed with "red:wave:"; colours 13-20 are
 * patterns, followed by colour - 12 colour indices. tsps appends it to CHAT and CHAT_MESSAGE.
 */
class ChatStyle(val colour: Int, val effect: Int, val pattern: ByteArray?) {
    fun write(writer: TspsWriter): TspsWriter {
        writer.u8(colour).u8(effect)
        pattern?.forEach { writer.u8(it.toInt() and 0xFF) }
        return writer
    }

    companion object {
        private const val FIRST_PATTERN = 13
        private const val MAX_COLOUR = 20
        private const val MAX_EFFECT = 5

        fun read(reader: TspsReader): ChatStyle? {
            if (reader.remaining < 2) return null
            val colour = reader.u8()
            val effect = reader.u8()
            // As tsps's readChatStyle: anything else isn't a style.
            if (colour > MAX_COLOUR || effect > MAX_EFFECT) return null
            val length = if (colour >= FIRST_PATTERN) colour - FIRST_PATTERN + 1 else 0
            if (reader.remaining < length) return null
            return ChatStyle(colour, effect, if (length > 0) reader.bytes(length) else null)
        }
    }
}
