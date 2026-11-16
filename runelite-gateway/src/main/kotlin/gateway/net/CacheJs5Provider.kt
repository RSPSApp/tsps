package gateway.net

import gateway.cache.ClientCache
import gateway.cache.DiskStore
import gateway.cache.ServedCache
import io.netty.buffer.ByteBuf
import io.netty.buffer.Unpooled
import net.rsprot.protocol.api.js5.Js5GroupProvider
import net.rsprot.protocol.api.js5.Js5Service

/**
 * Serves the official client the cache tsps runs on, with the gateway's patches
 * ([gateway.cache.ClientCachePatches]) and tsps's league content ([ServedCache]), which a request
 * for the master index, the first of a JS5 session, refreshes. rsprot sends slices of the returned
 * buffer and releases each one, so the buffers are unreleasable heap buffers.
 */
class CacheJs5Provider(private val served: ServedCache) : Js5GroupProvider {
    private class Prepared(val cache: ClientCache, val masterIndex: ByteBuf)

    @Volatile
    private var prepared: Prepared? = null

    override fun provide(archive: Int, group: Int): ByteBuf? {
        if (archive == DiskStore.MASTER_ARCHIVE && group == DiskStore.MASTER_ARCHIVE) return masterIndex(served.refresh()).duplicate()
        val container = served.current.container(archive, group) ?: return null
        return prepare(archive, group, container)
    }

    private fun masterIndex(cache: ClientCache): ByteBuf {
        prepared?.takeIf { it.cache === cache }?.let { return it.masterIndex }
        return Prepared(cache, prepare(DiskStore.MASTER_ARCHIVE, DiskStore.MASTER_ARCHIVE, cache.masterIndex())).also { prepared = it }.masterIndex
    }

    private fun prepare(archive: Int, group: Int, container: ByteArray): ByteBuf {
        val output = Unpooled.buffer(container.size + 3 + container.size / 511 + 1)
        Js5Service.prepareJs5Buffer(archive, group, Unpooled.wrappedBuffer(container), output)
        return Unpooled.unreleasableBuffer(output)
    }
}
