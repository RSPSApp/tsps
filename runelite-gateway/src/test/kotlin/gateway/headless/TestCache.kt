package gateway.headless

import gateway.cache.Cache
import gateway.config.GatewayConfig

/** The cache tsps and the gateway use, opened once per test JVM. */
object TestCache {
    val config: GatewayConfig = GatewayConfig.load()
    val cache: Cache by lazy { Cache.open(config.cacheDirectory) }
    val huffman: ByteArray by lazy { requireNotNull(cache.file(10, "huffman")) }
}
