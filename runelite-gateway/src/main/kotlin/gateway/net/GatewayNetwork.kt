package gateway.net

import gateway.session.GatewaySession
import gateway.up.UpdatePlayerModel
import io.netty.buffer.ByteBufAllocator
import net.rsprot.compression.provider.HuffmanCodecProvider
import net.rsprot.crypto.rsa.RsaKeyPair
import net.rsprot.protocol.api.AbstractNetworkServiceFactory
import net.rsprot.protocol.api.GameConnectionHandler
import net.rsprot.protocol.api.js5.Js5GroupProvider
import net.rsprot.protocol.api.handlers.ExceptionHandlers
import net.rsprot.protocol.api.handlers.LoginHandlers
import net.rsprot.protocol.common.client.OldSchoolClientType
import net.rsprot.protocol.game.incoming.prot.DesktopGameMessageDecoderRepository
import net.rsprot.protocol.loginprot.incoming.pow.NopProofOfWorkProvider
import net.rsprot.protocol.message.IncomingGameMessage
import net.rsprot.protocol.message.IncomingMessage
import net.rsprot.protocol.message.codec.MessageDecoder
import net.rsprot.protocol.message.codec.incoming.GameMessageConsumerRepositoryBuilder
import net.rsprot.protocol.message.codec.incoming.provider.DefaultGameMessageConsumerRepositoryProvider
import net.rsprot.protocol.message.codec.incoming.provider.GameMessageConsumerRepositoryProvider
import java.util.logging.Level
import java.util.logging.Logger

private val log: Logger = Logger.getLogger(GatewayNetwork::class.java.name)

/**
 * rsprot's network service on GATEWAY_PORT: JS5, login, ISAAC and the revision-241 codecs. It
 * listens on [bindHost] (GATEWAY_BIND_HOST, loopback unless set).
 */
class GatewayNetwork(
    private val bindHost: String,
    private val port: Int,
    private val rsa: RsaKeyPair,
    private val huffman: HuffmanCodecProvider,
    private val js5: Js5GroupProvider,
    private val connections: GameConnectionHandler<GatewaySession>,
) : AbstractNetworkServiceFactory<GatewaySession>() {
    override val allocator: ByteBufAllocator get() = ByteBufAllocator.DEFAULT
    override val host: String get() = bindHost
    override val ports: List<Int> get() = listOf(port)
    override val supportedClientTypes: List<OldSchoolClientType> get() = listOf(OldSchoolClientType.DESKTOP)

    override fun getRsaKeyPair(): RsaKeyPair = rsa

    override fun getHuffmanCodecProvider(): HuffmanCodecProvider = huffman

    override fun getJs5GroupProvider(): Js5GroupProvider = js5

    override fun getGameConnectionHandler(): GameConnectionHandler<GatewaySession> = connections

    /** Channel errors close the client's connection; log why rather than let it go quietly. */
    override fun getExceptionHandlers(): ExceptionHandlers<GatewaySession> =
        ExceptionHandlers(
            channelExceptionHandler = { ctx, cause ->
                log.log(Level.WARNING, "client channel ${ctx.channel().remoteAddress()} failed", cause)
                ctx.close()
            },
            incomingGameMessageConsumerExceptionHandler = { _, message, cause ->
                log.log(Level.WARNING, "client packet $message failed", cause)
            },
        )

    /** The gateway only listens on loopback behind RSProx; proof of work would only slow logins. */
    override fun getLoginHandlers(): LoginHandlers = LoginHandlers(proofOfWorkProvider = NopProofOfWorkProvider)

    /**
     * Every client packet goes to its session, which translates it or counts it as dropped.
     * rsprot only decodes packets that have a consumer, so each 241 message class gets one.
     */
    @OptIn(ExperimentalStdlibApi::class)
    override fun getGameMessageConsumerRepositoryProvider(): GameMessageConsumerRepositoryProvider<GatewaySession> {
        val decoders = DesktopGameMessageDecoderRepository.build(huffman)
        val builder = GameMessageConsumerRepositoryBuilder<GatewaySession>()
        (0..0xFF)
            .mapNotNull(decoders::getDecoderOrNull)
            .map { @Suppress("UNCHECKED_CAST") decoders.getMessageClass(it.javaClass as Class<out MessageDecoder<IncomingMessage>>) }
            .distinct()
            .filterIsInstance<Class<out IncomingGameMessage>>()
            .forEach { builder.addListener(it) { session, message -> session.onClientMessage(message) } }
        // The gateway's own decoder for the character designer, which rsprot 241 lacks.
        builder.addListener(UpdatePlayerModel::class.java) { session, message -> session.onClientMessage(message) }
        return DefaultGameMessageConsumerRepositoryProvider(builder.build())
    }
}
