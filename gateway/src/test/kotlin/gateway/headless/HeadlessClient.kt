package gateway.headless

import io.netty.buffer.ByteBuf
import io.netty.buffer.Unpooled
import net.rsprot.buffer.extensions.toJagByteBuf
import net.rsprot.compression.HuffmanCodec
import net.rsprot.crypto.cipher.IsaacRandom
import net.rsprot.protocol.message.IncomingMessage
import net.rsprox.cache.api.Cache
import net.rsprox.cache.api.CacheProvider
import net.rsprox.cache.api.type.GameVal
import net.rsprox.cache.api.type.GameValType
import net.rsprox.cache.api.type.NpcType
import net.rsprox.cache.api.type.VarBitType
import net.rsprox.protocol.session.AttributeMap
import net.rsprox.protocol.session.Session
import net.rsprox.protocol.v241.ServerPacketDecoderServiceV241
import net.rsprox.protocol.v241.game.outgoing.decoder.prot.GameServerProt
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.EOFException
import java.math.BigInteger
import java.net.Socket
import java.net.SocketTimeoutException
import java.security.SecureRandom

/**
 * A minimal revision-241 client for tests: JS5 requests, the RSA/XTEA login block, ISAAC, and
 * every game packet decoded with RSProx's 241 decoders, as the official client would see it.
 */
class HeadlessClient(private val host: String, private val port: Int) {
    /** JS5: fetches one group's container, the JS5 block markers removed. */
    fun js5(archive: Int, group: Int): ByteArray =
        Socket(host, port).use { socket ->
            socket.soTimeout = TIMEOUT_MS
            val out = DataOutputStream(socket.getOutputStream())
            val input = DataInputStream(socket.getInputStream())
            out.writeByte(INIT_JS5REMOTE_CONNECTION)
            out.writeInt(REVISION)
            repeat(4) { out.writeInt(0) }
            out.flush()
            val status = input.readUnsignedByte()
            check(status == 0) { "JS5 handshake refused: $status" }
            out.writeByte(JS5_URGENT_REQUEST)
            out.writeByte(archive)
            out.writeShort(group)
            out.flush()
            readJs5Response(input, archive, group)
        }

    /** Result of [login]: the response code and, when it succeeded, the connected game session. */
    class LoginResult(val code: Int, val game: Game?)

    fun login(username: String, password: String, modulus: BigInteger): LoginResult {
        val socket = Socket(host, port).apply { soTimeout = TIMEOUT_MS }
        val out = DataOutputStream(socket.getOutputStream())
        val input = DataInputStream(socket.getInputStream())
        out.writeByte(INIT_GAME_CONNECTION)
        out.flush()
        check(input.readUnsignedByte() == 0) { "game connection refused" }
        val sessionId = input.readLong()

        val seed = IntArray(4) { random.nextInt() }
        val block = loginBlock(username, password, seed, sessionId, modulus)
        out.writeByte(GAMELOGIN)
        out.writeShort(block.size)
        out.write(block)
        out.flush()

        val code = input.readUnsignedByte()
        if (code != LOGIN_OK) {
            socket.close()
            return LoginResult(code, null)
        }
        val decoding = IsaacRandom(IntArray(4) { seed[it] + 50 })
        // The size byte is always 37, whatever the payload; the client reads the fields it knows.
        input.readUnsignedByte()
        // authenticator (5), staff level, player mod, index (2), members, account hashes
        val ok = input.readNBytes(LOGIN_OK_PAYLOAD)
        val index = ((ok[7].toInt() and 0xFF) shl 8) or (ok[8].toInt() and 0xFF)
        return LoginResult(code, Game(socket, input, decoding, IsaacRandom(seed.copyOf()), index))
    }

    /** The logged-in game stream; [next] decodes one server packet at a time. */
    class Game internal constructor(
        private val socket: Socket,
        private val input: DataInputStream,
        private val cipher: IsaacRandom,
        private val encoding: IsaacRandom,
        val index: Int,
    ) : AutoCloseable {
        private val output = DataOutputStream(socket.getOutputStream())

        /** The real client sends NO_TIMEOUT every few seconds; rsprot drops a silent client. */
        private val keepAlive =
            Thread {
                try {
                    while (!socket.isClosed) {
                        Thread.sleep(KEEPALIVE_MS)
                        sendFixed(NO_TIMEOUT, ByteArray(0))
                    }
                } catch (e: Exception) {
                    // The socket closed.
                }
            }.apply {
                isDaemon = true
                start()
            }

        /** A var-byte client packet, opcode enciphered as the client does. */
        fun sendVarByte(opcode: Int, payload: ByteArray) =
            synchronized(output) {
                output.writeByte(opcode + encoding.nextInt())
                output.writeByte(payload.size)
                output.write(payload)
                output.flush()
            }

        /** A fixed-size client packet, opcode enciphered as the client does. */
        fun sendFixed(opcode: Int, payload: ByteArray) =
            synchronized(output) {
                output.writeByte(opcode + encoding.nextInt())
                output.write(payload)
                output.flush()
            }

        /** IF_BUTTONX: op [op] on component [interfaceId]:[componentId]. */
        fun button(interfaceId: Int, componentId: Int, op: Int = 1, sub: Int = 0xFFFF, obj: Int = 0xFFFF) =
            sendFixed(
                IF_BUTTONX,
                Unpooled.buffer().toJagByteBuf().apply {
                    p4((interfaceId shl 16) or componentId)
                    p2(sub)
                    p2(obj)
                    p1(op)
                }.buffer.let { it.array().copyOf(it.writerIndex()) },
            )

        /** MESSAGE_PUBLIC: plain public chat. */
        fun say(text: String, colour: Int = 0, effect: Int = 0) =
            sendVarByte(
                MESSAGE_PUBLIC,
                Unpooled.buffer().toJagByteBuf().apply {
                    p1(0) // type: public
                    p1(colour)
                    p1(effect)
                    huffman.encode(this, text)
                }.buffer.let { it.array().copyOf(it.writerIndex()) },
            )

        /** A var-short client packet, opcode enciphered as the client does. */
        fun sendVarShort(opcode: Int, payload: ByteArray) =
            synchronized(output) {
                output.writeByte(opcode + encoding.nextInt())
                output.writeShort(payload.size)
                output.write(payload)
                output.flush()
            }

        fun addFriend(name: String) =
            sendVarByte(FRIENDLIST_ADD, Unpooled.buffer().toJagByteBuf().apply { pjstr(name) }.buffer.let { it.array().copyOf(it.writerIndex()) })

        fun privateMessage(name: String, text: String) =
            sendVarShort(
                MESSAGE_PRIVATE,
                Unpooled.buffer().toJagByteBuf().apply {
                    pjstr(name)
                    huffman.encode(this, text)
                }.buffer.let { it.array().copyOf(it.writerIndex()) },
            )

        /** OPNPC1 (Talk-to on most NPCs). */
        fun npcOp1(index: Int) =
            sendFixed(
                OPNPC1,
                Unpooled.buffer().toJagByteBuf().apply {
                    p1Alt1(0) // subop
                    p2Alt3(index)
                    p1Alt2(0) // ctrl
                }.buffer.let { it.array().copyOf(it.writerIndex()) },
            )

        /** RESUME_PAUSEBUTTON: "Click here to continue", or option [sub] of a dialogue's list. */
        fun resume(interfaceId: Int, componentId: Int, sub: Int = 0xFFFF) =
            sendFixed(
                RESUME_PAUSEBUTTON,
                Unpooled.buffer().toJagByteBuf().apply {
                    p2Alt1(sub)
                    p4Alt1((interfaceId shl 16) or componentId)
                }.buffer.let { it.array().copyOf(it.writerIndex()) },
            )

        /** IF_BUTTONT: the selected component (a spell, or an item's Use) on a target component's slot. */
        fun buttonT(selected: Int, selectedSub: Int, selectedObj: Int, target: Int, targetSub: Int, targetObj: Int) =
            sendFixed(
                IF_BUTTONT,
                Unpooled.buffer().toJagByteBuf().apply {
                    p4Alt1(target)
                    p2Alt3(selectedObj)
                    p4Alt2(selected)
                    p2Alt3(targetObj)
                    p2(targetSub)
                    p2Alt3(selectedSub)
                }.buffer.let { it.array().copyOf(it.writerIndex()) },
            )

        /** OPNPC2 (Attack on most NPCs). */
        fun npcOp2(index: Int) =
            sendFixed(
                OPNPC2,
                Unpooled.buffer().toJagByteBuf().apply {
                    p1Alt1(0) // ctrl
                    p1Alt3(0) // subop
                    p2Alt3(index)
                }.buffer.let { it.array().copyOf(it.writerIndex()) },
            )

        /** IF_SCRIPT_TRIGGER: a cache script's if_triggeroplocal, with one int argument (a zigzag varint). */
        fun scriptTrigger(interfaceId: Int, componentId: Int, argument: Int) =
            sendVarShort(
                IF_SCRIPT_TRIGGER,
                Unpooled.buffer().toJagByteBuf().apply {
                    p4Alt2((interfaceId shl 16) or componentId)
                    p2Alt1(0xFFFF) // obj
                    p2Alt1(0xFFFF) // sub
                    p4Alt2(0) // crc
                    var zigzag = (argument shl 1) xor (argument shr 31)
                    while (zigzag and 0x7F.inv() != 0) {
                        p1((zigzag and 0x7F) or 0x80)
                        zigzag = zigzag ushr 7
                    }
                    p1(zigzag)
                }.buffer.let { it.array().copyOf(it.writerIndex()) },
            )

        /** IF_BUTTOND: dragging [fromSub] of one component onto [toSub] of another. */
        fun drag(fromInterface: Int, fromComponent: Int, fromSub: Int, fromObj: Int, toInterface: Int, toComponent: Int, toSub: Int, toObj: Int) =
            sendFixed(
                IF_BUTTOND,
                Unpooled.buffer().toJagByteBuf().apply {
                    p2Alt1(fromObj)
                    p4Alt3((fromInterface shl 16) or fromComponent)
                    p2Alt1(fromSub)
                    p2(toSub)
                    p2Alt2(toObj)
                    p4Alt3((toInterface shl 16) or toComponent)
                }.buffer.let { it.array().copyOf(it.writerIndex()) },
            )

        /** OPLOC1_V2: a loc's first op. */
        fun opLoc1(id: Int, x: Int, z: Int) =
            sendFixed(
                OPLOC1_V2,
                Unpooled.buffer().toJagByteBuf().apply {
                    p2Alt1(z)
                    p2Alt3(id)
                    p1(0) // subop
                    p2(x)
                    p1Alt3(0) // control key
                }.buffer.let { it.array().copyOf(it.writerIndex()) },
            )

        /** OPPLAYER2 (tsps's Trade with). */
        fun playerOp2(index: Int) =
            sendFixed(
                OPPLAYER2,
                Unpooled.buffer().toJagByteBuf().apply {
                    p2Alt1(index)
                    p1Alt2(0)
                }.buffer.let { it.array().copyOf(it.writerIndex()) },
            )

        /** UPDATE_PLAYER_MODEL_V2: 26 raw bytes, as the character designer sends them. */
        fun updatePlayerModel(bytes: ByteArray) = sendFixed(UPDATE_PLAYER_MODEL_V2, bytes)

        /** CLIENT_CHEAT: a `::` command, without the colons. */
        fun command(text: String) =
            sendVarByte(CLIENT_CHEAT, Unpooled.buffer().toJagByteBuf().apply { pjstr(text); p1(0) }.buffer.let { it.array().copyOf(it.writerIndex()) })

        /** MOVE_GAMECLICK: walk to [x], [z] ([keys] 1 = ctrl). */
        fun walk(x: Int, z: Int, keys: Int = 0) =
            sendVarByte(
                MOVE_GAMECLICK,
                Unpooled.buffer().toJagByteBuf().apply {
                    p1Alt1(keys)
                    p2Alt2(z)
                    p2Alt2(x)
                }.buffer.let { it.array().copyOf(it.writerIndex()) },
            )
        private val decoder = ServerPacketDecoderServiceV241(huffman, CacheProvider { NoCache })
        private val session = Session(index, AttributeMap())

        /** The next packet, or null on timeout or a closed stream. */
        fun next(): IncomingMessage? {
            val prot =
                try {
                    var opcode = (input.readUnsignedByte() - cipher.nextInt()) and 0xFF
                    if (opcode >= 0x80) opcode = ((opcode and 0x7F) shl 8) or ((input.readUnsignedByte() - cipher.nextInt()) and 0xFF)
                    GameServerProt.entries.firstOrNull { it.opcode == opcode } ?: error("unknown server opcode $opcode")
                } catch (e: SocketTimeoutException) {
                    return null
                } catch (e: EOFException) {
                    return null
                }
            val size =
                when (prot.size) {
                    VAR_BYTE -> input.readUnsignedByte()
                    VAR_SHORT -> input.readUnsignedShort()
                    else -> prot.size
                }
            val payload: ByteBuf = Unpooled.wrappedBuffer(input.readNBytes(size))
            return decoder.decode(prot.opcode, payload.toJagByteBuf(), session)
        }

        /** Reads packets until one of type [T] arrives, failing after [limit] packets. */
        inline fun <reified T> expect(limit: Int = 5_000): T {
            repeat(limit) {
                val message = next() ?: error("stream ended waiting for ${T::class.simpleName}")
                if (message is T) return message
            }
            error("no ${T::class.simpleName} in $limit packets")
        }

        override fun close() = socket.close()
    }

    private fun loginBlock(username: String, password: String, seed: IntArray, sessionId: Long, modulus: BigInteger): ByteArray {
        val rsa =
            Unpooled.buffer().toJagByteBuf().apply {
                p1(1)
                seed.forEach(::p4)
                p8(sessionId)
                p1(OTP_NONE)
                p4(0)
                p1(PASSWORD_AUTHENTICATION)
                pjstr(password)
            }
        val rsaBytes = BigInteger(rsa.buffer.array().copyOf(rsa.buffer.writerIndex())).modPow(PUBLIC_EXPONENT, modulus).toByteArray()

        val xtea =
            Unpooled.buffer().toJagByteBuf().apply {
                pjstr(username)
                p1(RESIZABLE)
                p2(765)
                p2(503)
                repeat(24) { p1(0) }
                pjstr("")
                p4(0)
                p1(0) // deep links
                hostPlatformStats()
                p1(DESKTOP)
                p4(0) // reflection checker
                liveCrcs()
            }
        val xteaBytes = xteaEncrypt(xtea.buffer.array().copyOf(xtea.buffer.writerIndex()), seed)

        return Unpooled.buffer().toJagByteBuf().apply {
            p4(REVISION)
            p4(1) // sub version
            p4(1) // server version
            p1(DESKTOP)
            p1(0) // platform
            p1(0) // external authenticator
            p2(rsaBytes.size)
            pdata(rsaBytes)
            pdata(xteaBytes)
        }.buffer.let { it.array().copyOf(it.writerIndex()) }
    }

    private fun net.rsprot.buffer.JagByteBuf.pdata(bytes: ByteArray) = buffer.writeBytes(bytes)

    private fun net.rsprot.buffer.JagByteBuf.hostPlatformStats() {
        p1(9) // version
        p1(1) // os
        p1(1) // 64 bit
        p2(10)
        p1(1) // java vendor
        p1(17)
        p1(0)
        p1(0)
        p1(1) // not an applet
        p2(1024)
        p1(4)
        p3(8192)
        p2(0)
        repeat(4) { pjstr2("") }
        p1(0)
        p2(0)
        pjstr2("")
        pjstr2("")
        p1(4)
        p1(4)
        repeat(3) { p4(0) }
        p4(0)
        pjstr2("")
        pjstr2("")
    }

    /** The CRC block in DesktopLoginCrcDecoder's live order; tsps doesn't check CRCs. */
    private fun net.rsprot.buffer.JagByteBuf.liveCrcs() = repeat(LIVE_CRC_COUNT) { p4(0) }

    private fun readJs5Response(input: DataInputStream, archive: Int, group: Int): ByteArray {
        check(input.readUnsignedByte() == archive && input.readUnsignedShort() == group) { "JS5 answered another group" }
        val out = java.io.ByteArrayOutputStream()
        val compression = input.readUnsignedByte()
        val length = input.readInt()
        val total = 5 + length + if (compression == 0) 0 else 4
        out.write(compression)
        out.writeBytes(BigInteger.valueOf(length.toLong()).toByteArray().let { ByteArray(4 - it.size) + it })
        var written = 5
        var blockOffset = 8 // archive, group and the container header already read
        while (written < total) {
            if (blockOffset == JS5_BLOCK) {
                check(input.readUnsignedByte() == 0xFF) { "missing JS5 block marker" }
                blockOffset = 1
            }
            out.write(input.readUnsignedByte())
            written++
            blockOffset++
        }
        return out.toByteArray()
    }

    private companion object {
        const val REVISION = 241
        const val TIMEOUT_MS = 15_000
        const val INIT_GAME_CONNECTION = 14
        const val INIT_JS5REMOTE_CONNECTION = 15
        const val GAMELOGIN = 16
        const val JS5_URGENT_REQUEST = 1
        const val JS5_BLOCK = 512
        const val LOGIN_OK = 2
        const val MOVE_GAMECLICK = 55
        const val OPPLAYER2 = 35
        const val IF_BUTTOND = 46
        const val OPLOC1_V2 = 72
        const val IF_SCRIPT_TRIGGER = 17
        const val UPDATE_PLAYER_MODEL_V2 = 88
        const val NO_TIMEOUT = 75
        const val KEEPALIVE_MS = 5_000L
        const val OPNPC2 = 44
        const val OPNPC1 = 92
        const val IF_BUTTONT = 15
        const val RESUME_PAUSEBUTTON = 16
        const val FRIENDLIST_ADD = 14
        const val MESSAGE_PRIVATE = 50
        const val MESSAGE_PUBLIC = 49
        const val IF_BUTTONX = 38
        const val CLIENT_CHEAT = 84
        const val LOGIN_OK_PAYLOAD = 34
        const val OTP_NONE = 2
        const val PASSWORD_AUTHENTICATION = 0
        const val DESKTOP = 1
        const val RESIZABLE = 0x2
        const val LIVE_CRC_COUNT = 23
        const val VAR_BYTE = -1
        const val VAR_SHORT = -2
        val PUBLIC_EXPONENT: BigInteger = BigInteger.valueOf(65537)
        val random = SecureRandom()
        val huffman: HuffmanCodec = HuffmanCodec.create(Unpooled.wrappedBuffer(TestCache.huffman))

        fun xteaEncrypt(data: ByteArray, key: IntArray): ByteArray {
            val out = data.copyOf()
            val buffer = java.nio.ByteBuffer.wrap(out)
            for (block in 0 until data.size / 8) {
                var v0 = buffer.getInt(block * 8)
                var v1 = buffer.getInt(block * 8 + 4)
                var sum = 0
                repeat(32) {
                    v0 += (v1 shl 4 xor v1.ushr(5)) + v1 xor sum + key[sum and 3]
                    sum += -0x61c88647
                    v1 += (v0 shl 4 xor v0.ushr(5)) + v0 xor sum + key[sum.ushr(11) and 3]
                }
                buffer.putInt(block * 8, v0)
                buffer.putInt(block * 8 + 4, v1)
            }
            return out
        }
    }

    /** RSProx reads NPC types to decode some NPC_INFO blocks; M1 decodes none of those. */
    internal object NoCache : Cache {
        override fun getNpcType(id: Int): NpcType? = null

        override fun listNpcTypes(): Collection<NpcType> = emptyList()

        override fun getVarBitType(id: Int): VarBitType? = null

        override fun listVarBitTypes(): Collection<VarBitType> = emptyList()

        override fun getGameValType(gameVal: GameVal, id: Int): GameValType? = null

        override fun listGameValTypes(gameVal: GameVal): Collection<GameValType> = emptyList()

        override fun allGameValTypes(): Map<GameVal, Map<Int, GameValType>> = emptyMap()
    }
}
