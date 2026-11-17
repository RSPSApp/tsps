package gateway.cache

import java.util.zip.CRC32

/**
 * A file the official client gets changed: [change] turns the cache's copy into the served one.
 * The copy is null for a file the cache doesn't have, which the served group then adds.
 */
class FilePatch(val archive: Int, val group: Int, val file: Int, val change: (ByteArray?) -> ByteArray) {
    companion object {
        /** A change to a file the cache has. */
        fun of(archive: Int, group: Int, file: Int, change: (ByteArray) -> ByteArray) =
            FilePatch(archive, group, file) { change(requireNotNull(it) { "no file $archive:$group:$file" }) }

        /** A file the cache doesn't have. */
        fun added(archive: Int, group: Int, file: Int, data: ByteArray) =
            FilePatch(archive, group, file) {
                require(it == null) { "file $archive:$group:$file is already in the cache" }
                data
            }
    }
}

/** A one-file group the cache doesn't have, served as [archive]:[group] with [data] as its file 0. */
class NewGroup(val archive: Int, val group: Int, val name: String, val data: ByteArray)

/**
 * The cache as JS5 serves it to the official client: the one tsps runs on, with [patches]
 * applied and [additions] added. A patched or added group gets a new container, its archive's
 * index the group's CRC and lengths (and file ids, when a patch adds a file), and the master index
 * that index's new CRC, so the client's checks pass and it downloads the group in place of any
 * copy it already has.
 */
class ClientCache(
    private val cache: Cache,
    patches: List<FilePatch> = ClientCachePatches.ALL,
    additions: List<NewGroup> = emptyList(),
) {
    private val patched = HashMap<Long, ByteArray>()
    private val masterIndex: ByteArray

    init {
        val patchesByArchive = patches.groupBy { it.archive }
        val additionsByArchive = additions.groupBy { it.archive }
        for (archive in patchesByArchive.keys + additionsByArchive.keys) {
            var index = Container.decompress(requireNotNull(cache.container(DiskStore.MASTER_ARCHIVE, archive)) { "no index for archive $archive" })
            for ((group, groupPatches) in patchesByArchive[archive].orEmpty().groupBy { it.group }) {
                val files = sortedMapOf<Int, ByteArray>().apply { putAll(cache.files(archive, group)) }
                for (patch in groupPatches) files[patch.file] = patch.change(files[patch.file])
                val ids = files.keys.toIntArray()
                val data = GroupFiles.join(files.values.toList())
                val container = Container.compress(data)
                patched[key(archive, group)] = container
                val added = ids.takeUnless { it.contentEquals(cache.table(archive).groups.getValue(group).files) }
                index = ReferenceTable.withGroup(index, group, crc(container), container.size, data.size, added)
            }
            for (addition in additionsByArchive[archive].orEmpty()) {
                val container = Container.compress(addition.data)
                val crc = crc(container)
                patched[key(archive, addition.group)] = container
                // Any version will do; the CRC tells the client whether its copy is current.
                index = ReferenceTable.withNewGroup(index, addition.group, ReferenceTable.djb2(addition.name), crc, crc, container.size, addition.data.size)
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
