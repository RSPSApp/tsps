package gateway.up

import gateway.cache.Cache
import gateway.tsps.TspsWriter
import net.rsprot.buffer.JagByteBuf
import net.rsprot.protocol.ClientProt
import net.rsprot.protocol.ClientProtCategory
import net.rsprot.protocol.api.NetworkService
import net.rsprot.protocol.api.repositories.MessageDecoderRepositories
import net.rsprot.protocol.common.client.OldSchoolClientType
import net.rsprot.protocol.game.incoming.GameClientProtCategory
import net.rsprot.protocol.game.incoming.prot.GameClientProt
import net.rsprot.protocol.internal.client.ClientTypeMap
import net.rsprot.protocol.message.IncomingGameMessage
import net.rsprot.protocol.message.IncomingMessage
import net.rsprot.protocol.ProtRepository
import net.rsprot.protocol.message.codec.MessageDecoder
import net.rsprot.protocol.message.codec.incoming.MessageDecoderRepository
import net.rsprot.protocol.message.codec.incoming.MessageDecoderRepositoryBuilder
import java.util.logging.Logger

/**
 * The character designer's confirm (UPDATE_PLAYER_MODEL_V2, 26 bytes). rsprot 241 has no
 * decoder for it, and a packet without one disconnects the client, so the gateway adds one.
 *
 * The official client's designer (679) doesn't send it: it sends each click as an IF_BUTTON and
 * tsps designs on the server. The decoder stays so a client that does send it isn't dropped; its
 * 26-byte layout isn't documented, so a design is only passed on when one of the layouts that
 * fit gives valid cache ids, and logged otherwise.
 */
class UpdatePlayerModel(val bytes: ByteArray) : IncomingGameMessage {
    override val category: ClientProtCategory get() = GameClientProtCategory.USER_EVENT

    class Design(val male: Boolean, val kits: IntArray, val colours: IntArray)

    fun design(identKitCount: Int): Design? = LAYOUTS.firstNotNullOfOrNull { layout -> layout(bytes)?.takeIf { it.valid(identKitCount) } }

    /** tsps's APPEARANCE_SET (37): u8 gender, 7 × s16 kits, 5 × u8 colours. */
    fun toTsps(design: Design): ByteArray {
        val writer = TspsWriter().u8(if (design.male) 0 else 1)
        design.kits.forEach { writer.u16(it) }
        design.colours.forEach { writer.u8(it) }
        return writer.fixed(APPEARANCE_SET)
    }

    private fun Design.valid(identKitCount: Int) =
        kits.all { it == -1 || it in 0 until identKitCount } && colours.all { it in 0 until MAX_COLOUR }

    companion object {
        private const val APPEARANCE_SET = 37
        private const val MAX_COLOUR = 64
        private val log: Logger = Logger.getLogger(UpdatePlayerModel::class.java.name)

        private fun u16(bytes: ByteArray, at: Int) = ((bytes[at].toInt() and 0xFF) shl 8) or (bytes[at + 1].toInt() and 0xFF)

        private fun kit(value: Int) = if (value == 0xFFFF) -1 else value

        /** body, 7 × u16 kits, 5 × u16 colours, one more byte. */
        private val SHORT_FIELDS: (ByteArray) -> Design? = { b ->
            Design(b[0].toInt() == 0, IntArray(7) { kit(u16(b, 1 + it * 2)) }, IntArray(5) { u16(b, 15 + it * 2) })
        }

        /** body, 7 × u16 kits, 5 × u8 colours, then six more bytes. */
        private val BYTE_COLOURS: (ByteArray) -> Design? = { b ->
            Design(b[0].toInt() == 0, IntArray(7) { kit(u16(b, 1 + it * 2)) }, IntArray(5) { b[15 + it].toInt() and 0xFF })
        }

        private val LAYOUTS = listOf(SHORT_FIELDS, BYTE_COLOURS)

        fun logUnknown(message: UpdatePlayerModel) =
            log.warning("unrecognised UPDATE_PLAYER_MODEL_V2 layout, dropped: ${message.bytes.joinToString(" ") { "%02x".format(it) }}")

        /** Number of identkits in the cache (config group 3), to validate a decoded design. */
        fun identKitCount(cache: Cache): Int = cache.table(CONFIG_ARCHIVE).groups[IDENTKIT_GROUP]?.files?.let { it.last() + 1 } ?: 0

        private const val CONFIG_ARCHIVE = 2
        private const val IDENTKIT_GROUP = 3

        /** Adds the decoder to a built network service's desktop game decoders. */
        @Suppress("UNCHECKED_CAST")
        @OptIn(ExperimentalStdlibApi::class)
        fun install(network: NetworkService<*>) {
            val current = network.decoderRepositories
            val desktop = current.gameMessageDecoderRepositories[OldSchoolClientType.DESKTOP]
            val builder = MessageDecoderRepositoryBuilder(ProtRepository.of<GameClientProt>())
            for (opcode in 0..0xFF) {
                val decoder = desktop.getDecoderOrNull(opcode) as MessageDecoder<IncomingMessage>? ?: continue
                val messageClass = desktop.getMessageClass(decoder.javaClass as Class<out MessageDecoder<IncomingMessage>>)
                builder.bind(messageClass as Class<IncomingMessage>, decoder)
            }
            builder.bind(UpdatePlayerModel::class.java, Decoder)
            network.decoderRepositories =
                MessageDecoderRepositories(
                    current.loginMessageDecoderRepository,
                    current.js5MessageDecoderRepository,
                    ClientTypeMap.of(OldSchoolClientType.COUNT, listOf(OldSchoolClientType.DESKTOP to builder.build() as MessageDecoderRepository<ClientProt>)),
                    current.loginCrcDecoders,
                )
        }
    }

    private object Decoder : MessageDecoder<UpdatePlayerModel> {
        override val prot: ClientProt = GameClientProt.UPDATE_PLAYER_MODEL_V2

        override fun decode(buffer: JagByteBuf): UpdatePlayerModel = UpdatePlayerModel(ByteArray(buffer.readableBytes()).also { buffer.buffer.readBytes(it) })
    }
}
