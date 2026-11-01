package gateway.tsps

import java.io.ByteArrayOutputStream

/** One tsps server packet: its opcode and payload, length prefix removed. */
class TspsPacket(val opcode: Int, val payload: ByteArray) {
    fun reader() = TspsReader(payload)
}

/** Big-endian reader for tsps payloads; strings are latin1, NUL-terminated. */
class TspsReader(private val data: ByteArray, var offset: Int = 0) {
    val remaining: Int get() = data.size - offset

    fun u8(): Int = data[offset++].toInt() and 0xFF

    fun s8(): Int = data[offset++].toInt()

    fun u16(): Int = (u8() shl 8) or u8()

    fun s16(): Int = u16().toShort().toInt()

    fun i32(): Int = (u16() shl 16) or u16()

    fun i64(): Long = (i32().toLong() shl 32) or (i32().toLong() and 0xFFFFFFFFL)

    fun string(): String {
        val start = offset
        while (data[offset] != 0.toByte()) offset++
        return String(data, start, offset++ - start, Charsets.ISO_8859_1)
    }

    /** A NUL-terminated UTF-8 string (PLAYER_OPTION's text). */
    fun utf8(): String {
        val start = offset
        while (data[offset] != 0.toByte()) offset++
        return String(data, start, offset++ - start, Charsets.UTF_8)
    }

    fun bytes(length: Int): ByteArray = data.copyOfRange(offset, offset + length).also { offset += length }
}

object TspsCodec {
    /** Splits one WebSocket message into its packets. Throws on an opcode tsps doesn't define. */
    fun split(message: ByteArray): List<TspsPacket> {
        val packets = ArrayList<TspsPacket>()
        var offset = 0
        while (offset < message.size) {
            val opcode = message[offset++].toInt() and 0xFF
            val declared = requireNotNull(TspsServerPacket.LENGTHS[opcode]) { "unknown tsps server opcode $opcode" }
            val length =
                when (declared) {
                    -1 -> message[offset++].toInt() and 0xFF
                    -2 -> ((message[offset++].toInt() and 0xFF) shl 8) or (message[offset++].toInt() and 0xFF)
                    else -> declared
                }
            require(offset + length <= message.size) { "tsps packet $opcode overruns its frame" }
            packets += TspsPacket(opcode, message.copyOfRange(offset, offset + length))
            offset += length
        }
        return packets
    }
}

/** Builds tsps client packets: `u8 opcode`, a length prefix for variable ones, the payload. */
class TspsWriter {
    private val out = ByteArrayOutputStream()

    fun u8(value: Int) = apply { out.write(value) }

    fun u16(value: Int) = apply { u8(value ushr 8).u8(value) }

    fun i32(value: Int) = apply { u16(value ushr 16).u16(value) }

    // tsps's reader names (ClientProtocol.ts), which differ from OSRS's in places.

    /** `byteAdd`: value + 128. */
    fun u8Add(value: Int) = u8(value + 128)

    /** `byteSub`: 128 - value. */
    fun u8Sub(value: Int) = u8(128 - value)

    /** `byteNeg`: -value. */
    fun u8Neg(value: Int) = u8(-value)

    fun u16le(value: Int) = u8(value).u8(value ushr 8)

    fun i32le(value: Int) = u16le(value).u16le(value ushr 16)

    /** `intME`: bytes 2, 1, 4, 3 of the big-endian value. */
    fun i32me(value: Int) = u8(value ushr 8).u8(value).u8(value ushr 24).u8(value ushr 16)

    /** `intIME`: bytes 3, 4, 1, 2 of the big-endian value. */
    fun i32ime(value: Int) = u8(value ushr 16).u8(value ushr 24).u8(value).u8(value ushr 8)

    fun bytes(data: ByteArray) = apply { out.writeBytes(data) }

    /** The payload written so far, without an opcode. */
    fun body(): ByteArray = out.toByteArray()

    /** `shortAdd`: low byte + 128, then the high byte. */
    fun u16Add(value: Int) = u8(value + 128).u8(value ushr 8)

    /** `shortAddLE`: the high byte, then low byte + 128. */
    fun u16AddLE(value: Int) = u8(value ushr 8).u8(value + 128)

    fun string(value: String) = apply { out.writeBytes(value.toByteArray(Charsets.ISO_8859_1)).also { out.write(0) } }

    fun fixed(opcode: Int): ByteArray = byteArrayOf(opcode.toByte()) + out.toByteArray()

    fun varByte(opcode: Int): ByteArray {
        val body = out.toByteArray()
        require(body.size <= 0xFF) { "tsps client packet $opcode exceeds byte length" }
        return byteArrayOf(opcode.toByte(), body.size.toByte()) + body
    }

    fun varShort(opcode: Int): ByteArray {
        val body = out.toByteArray()
        require(body.size <= 0xFFFF) { "tsps client packet $opcode exceeds short length" }
        return byteArrayOf(opcode.toByte(), (body.size ushr 8).toByte(), body.size.toByte()) + body
    }
}

/**
 * The tsps client packets the gateway sends, mirroring `ClientPacketId` in
 * `server/.../net/protocol/ClientPackets.ts`. tsps closes the session on an opcode it doesn't
 * know, so nothing else may be sent.
 */
object TspsClientPacket {
    const val IF_BUTTON = 13
    const val MOVE_GAMECLICK = 16
    const val IF_BUTTONX = 91
    const val CLAN_CHANNEL_ACTION = 181
    const val CHAT = 190
    const val SET_HEADING = 214
    const val PING = 201
    const val HANDSHAKE = 202
    const val LOGIN = 204

    /** `HANDSHAKE_CAPABILITY_NATIVE_CLIENT` in ClientProtocol.ts. */
    const val CAPABILITY_NATIVE_CLIENT = 0x1
    private const val CLIENT_TYPE_DESKTOP = 0
    private const val CHAT_KIND_PUBLIC = 0
    private const val CHAT_KIND_CLAN = 4

    fun login(username: String, password: String, revision: Int): ByteArray =
        TspsWriter().string(username).string(password).i32(revision).u8(0).varShort(LOGIN)

    fun handshake(username: String): ByteArray =
        TspsWriter()
            .string(username)
            .u8(0) // no appearance; tsps sends it
            .u8(CLIENT_TYPE_DESKTOP)
            .u8(CAPABILITY_NATIVE_CLIENT)
            .varByte(HANDSHAKE)

    fun ping(time: Int): ByteArray = TspsWriter().i32(time).fixed(PING)

    /** A walk click; [keys] is OSRS's key combination (1 ctrl, 2 ctrl+shift). */
    fun move(x: Int, z: Int, keys: Int): ByteArray =
        TspsWriter()
            .u8(z ushr 8).u8(z + 128) // shortAddLE
            .u8(-keys) // byteNeg
            .u8(x ushr 8).u8(x + 128)
            .u8(128).u8(0) // shortAdd: no target loc
            .fixed(MOVE_GAMECLICK)

    private val PLAYER_OP_OPCODES = intArrayOf(44, 45, 46, 73, 6, 48, 10, 21)
    private val NPC_OP_OPCODES = intArrayOf(76, 12, 34, 70, 57)
    const val EXAMINE_NPC = 9

    /** OPPLAYER1-8. tsps reads the ctrl byte and ignores it. */
    fun playerOp(op: Int, index: Int): ByteArray {
        val writer = TspsWriter()
        when (op) {
            1, 3 -> writer.u8Sub(0).u16(index)
            2 -> writer.u8(0).u16(index)
            4, 6 -> writer.u16(index).u8Neg(0)
            5 -> writer.u16AddLE(index).u8Sub(0)
            7 -> writer.u16Add(index).u8Sub(0)
            8 -> writer.u8(0).u16Add(index)
            else -> throw IllegalArgumentException("player op $op")
        }
        return writer.fixed(PLAYER_OP_OPCODES[op - 1])
    }

    /** OPNPC1-5. */
    fun npcOp(op: Int, index: Int): ByteArray {
        val writer = TspsWriter()
        when (op) {
            1 -> writer.u8(0).u16AddLE(index)
            2 -> writer.u16AddLE(index).u8(0)
            3 -> writer.u16Add(index).u8Neg(0)
            4 -> writer.u8Neg(0).u16le(index)
            5 -> writer.u8Add(0).u16le(index)
            else -> throw IllegalArgumentException("npc op $op")
        }
        return writer.fixed(NPC_OP_OPCODES[op - 1])
    }

    fun examineNpc(type: Int): ByteArray = TspsWriter().u16Add(type).fixed(EXAMINE_NPC)

    /** A plain if1 button click. */
    fun ifButton(combinedId: Int): ByteArray = TspsWriter().i32(combinedId).fixed(IF_BUTTON)

    /** An if3 button click: component, slot (0xFFFF none), obj (-1 none) and op 1-32. */
    fun ifButtonX(combinedId: Int, slot: Int, obj: Int, op: Int): ByteArray =
        TspsWriter().i32(combinedId).u16(slot).u16(obj).u8(op).fixed(IF_BUTTONX)

    /** Public chat: kind 0 public, 2 friends chat, 3 autochat (`encodeChat` in the browser client). */
    fun chat(kind: Int, text: String, style: gateway.down.ChatStyle? = null): ByteArray =
        TspsWriter().u8(kind).string(text).also { style?.write(it) }.varByte(CHAT)

    /** Clan chat: [clanType] 0 the player's clan, -1 the guest clan (`encodeClanChat`). */
    fun clanChat(clanType: Int, text: String): ByteArray = TspsWriter().u8(CHAT_KIND_CLAN).u8(clanType and 0xFF).string(text).varByte(CHAT)

    /** A channel user's op, by name: action 0 kick, 1 ban, 2 mute (`value` 1 mutes). */
    fun clanChannelAction(action: Int, name: String, value: Int): ByteArray = TspsWriter().u8(action).u8(value).string(name).varByte(CLAN_CHANNEL_ACTION)

    /** A `::` command; tsps reads commands from public chat. */
    fun command(command: String): ByteArray = TspsWriter().u8(CHAT_KIND_PUBLIC).string("::$command").varByte(CHAT)

    fun setHeading(heading: Int): ByteArray = TspsWriter().u8(heading).fixed(SET_HEADING)
}
