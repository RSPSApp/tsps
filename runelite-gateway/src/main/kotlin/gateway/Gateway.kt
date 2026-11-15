package gateway

import gateway.cache.Cache
import gateway.cache.ServedCache
import gateway.config.GatewayConfig
import gateway.crypto.RsaKeys
import gateway.net.CacheJs5Provider
import gateway.net.GatewayNetwork
import gateway.session.GatewayConnections
import gateway.session.GatewayContext
import gateway.tsps.TspsContent
import gateway.up.UpdatePlayerModel
import io.netty.buffer.Unpooled
import net.rsprot.compression.HuffmanCodec
import net.rsprot.compression.provider.DefaultHuffmanCodecProvider
import net.rsprot.crypto.rsa.RsaKeyPair
import net.rsprot.protocol.api.NetworkService

/** A running gateway: the rsprot network service and what it was built from. */
class Gateway private constructor(
    val config: GatewayConfig,
    val rsa: RsaKeyPair,
    val revision: Int,
    /** The cache JS5 serves, with the content data tsps's league sends. */
    val servedCache: ServedCache,
    private val network: NetworkService<*>,
    private val context: GatewayContext,
) {
    fun stop() {
        context.loginUtilities?.close()
        network.shutdownNow()
    }

    companion object {
        private const val BINARY_ARCHIVE = 10

        @OptIn(ExperimentalStdlibApi::class)
        fun start(config: GatewayConfig): Gateway {
            val rsa = RsaKeys.loadOrCreate(config.keyFile)
            val cache = Cache.open(config.cacheDirectory)
            val huffmanTable = requireNotNull(cache.file(BINARY_ARCHIVE, "huffman")) { "no huffman table in the cache" }
            val huffman = DefaultHuffmanCodecProvider(HuffmanCodec.create(Unpooled.wrappedBuffer(huffmanTable)))
            // Cache directories are named osrs-<revision>_<date>.
            val revision = config.cacheDirectory.fileName.toString().substringAfter("osrs-").substringBefore('_').toInt()
            val context = GatewayContext(config, cache, huffman, revision)
            val servedCache = ServedCache(cache, TspsContent(config.leagueContentUrl))
            var network: NetworkService<*>? = null
            try {
                network = GatewayNetwork(config.bindHost, config.gatewayPort, rsa, huffman, CacheJs5Provider(servedCache), GatewayConnections(context)).build()
                UpdatePlayerModel.install(network)
                network.start()
                // Ready before the first client when tsps is already up; every JS5 session refreshes it.
                Thread(servedCache::refresh, "gateway-league-content").apply { isDaemon = true }.start()
                return Gateway(config, rsa, revision, servedCache, network, context)
            } catch (failure: Throwable) {
                // The context already bound the login broker's port; a gateway that never started must not keep it.
                context.loginUtilities?.close()
                // A failed start() has already started the event loops and the JS5 threads before its bind fails.
                // A failure earlier than that leaves nothing to stop, and shutting down then throws instead.
                if (network != null) {
                    try {
                        network.shutdownNow()
                    } catch (shutdown: Throwable) {
                        failure.addSuppressed(shutdown)
                    }
                }
                throw failure
            }
        }
    }
}
