package gateway.net

import gateway.cache.Cache
import gateway.cache.DiskStore
import io.netty.buffer.ByteBuf
import io.netty.buffer.Unpooled
import net.rsprot.protocol.api.js5.Js5GroupProvider
import net.rsprot.protocol.api.js5.Js5Service

/**
 * Serves the official client the exact cache tsps runs on. rsprot sends slices of the returned
 * buffer and releases each one, so the buffers are unreleasable heap buffers.
 */
class CacheJs5Provider(private val cache: Cache) : Js5GroupProvider {
    private val masterIndex: ByteBuf = prepare(DiskStore.MASTER_ARCHIVE, DiskStore.MASTER_ARCHIVE, cache.masterIndex())

    override fun provide(archive: Int, group: Int): ByteBuf? {
        if (archive == DiskStore.MASTER_ARCHIVE && group == DiskStore.MASTER_ARCHIVE) return masterIndex.duplicate()
        val container = cache.container(archive, group) ?: return null
        return prepare(archive, group, container)
    }

    private fun prepare(archive: Int, group: Int, container: ByteArray): ByteBuf {
        val output = Unpooled.buffer(container.size + 3 + container.size / 511 + 1)
        Js5Service.prepareJs5Buffer(archive, group, Unpooled.wrappedBuffer(container), output)
        return Unpooled.unreleasableBuffer(output)
    }
}
