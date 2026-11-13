package gateway.cache

import java.util.zip.CRC32

/** A file the official client gets changed: [change] turns the cache's copy into the served one. */
class FilePatch(val archive: Int, val group: Int, val file: Int, val change: (ByteArray) -> ByteArray)

/**
 * The cache as JS5 serves it to the official client: the one tsps runs on, with [patches]
 * applied. A patched group gets a new container, its archive's index the group's new CRC and
 * lengths, and the master index that index's new CRC, so the client's checks pass and it
 * downloads the patched group in place of any copy it already has.
 */
class ClientCache(private val cache: Cache, patches: List<FilePatch> = ClientCachePatches.ALL) {
    private val patched = HashMap<Long, ByteArray>()
    private val masterIndex: ByteArray

    init {
        for ((archive, archivePatches) in patches.groupBy { it.archive }) {
            var index = Container.decompress(requireNotNull(cache.container(DiskStore.MASTER_ARCHIVE, archive)) { "no index for archive $archive" })
            for ((group, groupPatches) in archivePatches.groupBy { it.group }) {
                val files = cache.files(archive, group).toMutableMap()
                for (patch in groupPatches) {
                    files[patch.file] = patch.change(requireNotNull(files[patch.file]) { "no file $archive:$group:${patch.file}" })
                }
                val data = GroupFiles.join(cache.table(archive).groups.getValue(group).files.map(files::getValue))
                val container = Container.compress(data)
                patched[key(archive, group)] = container
                index = ReferenceTable.withGroup(index, group, crc(container), container.size, data.size)
            }
            patched[key(DiskStore.MASTER_ARCHIVE, archive)] = Container.compress(index)
        }
        masterIndex = cache.masterIndex { container(DiskStore.MASTER_ARCHIVE, it) }
    }

    /** The container JS5 sends for [archive]:[group]. */
    fun container(archive: Int, group: Int): ByteArray? = patched[key(archive, group)] ?: cache.container(archive, group)

    /** Group 255:255, listing the patched indexes' CRCs. */
    fun masterIndex(): ByteArray = masterIndex

    private companion object {
        fun key(archive: Int, group: Int): Long = (archive.toLong() shl 32) or group.toLong()

        fun crc(data: ByteArray): Int = CRC32().apply { update(data) }.value.toInt()
    }
}
