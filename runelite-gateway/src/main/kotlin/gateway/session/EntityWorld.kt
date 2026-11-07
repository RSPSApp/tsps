package gateway.session

import io.netty.buffer.ByteBufAllocator
import net.rsprot.compression.provider.HuffmanCodecProvider
import net.rsprot.protocol.common.client.OldSchoolClientType
import net.rsprot.protocol.game.outgoing.codec.npcinfo.DesktopLowResolutionChangeEncoder
import net.rsprot.protocol.game.outgoing.codec.npcinfo.extendedinfo.writer.NpcAvatarExtendedInfoDesktopWriter
import net.rsprot.protocol.game.outgoing.codec.playerinfo.extendedinfo.writer.PlayerAvatarExtendedInfoDesktopWriter
import net.rsprot.protocol.game.outgoing.codec.worldentity.DesktopWorldEntityResolutionChangeEncoder
import net.rsprot.protocol.game.outgoing.codec.worldentity.extendedinfo.WorldEntityAvatarExtendedInfoDesktopWriter
import net.rsprot.protocol.game.outgoing.info.InfoProtocols
import net.rsprot.protocol.game.outgoing.info.Infos
import net.rsprot.protocol.game.outgoing.info.filter.DefaultExtendedInfoFilter
import net.rsprot.protocol.game.outgoing.info.npcinfo.DeferredNpcInfoProtocolSupplier
import net.rsprot.protocol.game.outgoing.info.npcinfo.NpcAvatar
import net.rsprot.protocol.game.outgoing.info.npcinfo.NpcAvatarExceptionHandler
import net.rsprot.protocol.game.outgoing.info.npcinfo.NpcAvatarFactory
import net.rsprot.protocol.game.outgoing.info.npcinfo.NpcInfoProtocol
import net.rsprot.protocol.game.outgoing.info.playerinfo.PlayerAvatarFactory
import net.rsprot.protocol.game.outgoing.info.playerinfo.PlayerInfoProtocol
import net.rsprot.protocol.game.outgoing.info.worker.SingleThreadProtocolWorker
import net.rsprot.protocol.game.outgoing.info.worldentityinfo.WorldEntityAvatarExceptionHandler
import net.rsprot.protocol.game.outgoing.info.worldentityinfo.WorldEntityAvatar
import net.rsprot.protocol.game.outgoing.info.worldentityinfo.WorldEntityAvatarFactory
import net.rsprot.protocol.game.outgoing.info.worldentityinfo.WorldEntityProtocol
import net.rsprot.protocol.internal.client.ClientTypeMap
import net.rsprot.protocol.internal.game.outgoing.info.util.ZoneIndexStorage

/**
 * One rsprot entity world for one official client.
 *
 * tsps already decides what each player sees, so each gateway session mirrors exactly its own
 * view: the session's player is the observer, and every other player, NPC and world entity tsps
 * shows it is an avatar here, created and removed when tsps adds or drops it. Nothing is shared
 * between sessions, which also keeps tsps's per-viewer hitsplat types intact.
 *
 * The NetworkService's own protocols stay unused; rsprot builds those for a single game world.
 */
class EntityWorld(allocator: ByteBufAllocator, huffman: HuffmanCodecProvider) {
    val npcAvatars: NpcAvatarFactory
    private val worldEntityAvatars: WorldEntityAvatarFactory
    private val protocols: InfoProtocols

    init {
        val worker = SingleThreadProtocolWorker()
        val desktop = OldSchoolClientType.COUNT

        val worldEntityZones = ZoneIndexStorage(ZoneIndexStorage.WORLDENTITY_CAPACITY)
        worldEntityAvatars =
            WorldEntityAvatarFactory(allocator, worldEntityZones, listOf(WorldEntityAvatarExtendedInfoDesktopWriter()), huffman)
        val worldEntities =
            WorldEntityProtocol(
                allocator,
                WorldEntityAvatarExceptionHandler { index, e -> throw IllegalStateException("world entity $index", e) },
                worldEntityAvatars,
                ClientTypeMap.of(listOf(DesktopWorldEntityResolutionChangeEncoder()), desktop) { it.clientType },
                worker,
                worldEntityZones,
                null,
            )

        val playerAvatars =
            PlayerAvatarFactory(allocator, DefaultExtendedInfoFilter(), listOf(PlayerAvatarExtendedInfoDesktopWriter()), huffman)
        val players = PlayerInfoProtocol(allocator, worker, playerAvatars)

        val npcZones = ZoneIndexStorage(ZoneIndexStorage.NPC_CAPACITY)
        val npcProtocolSupplier = DeferredNpcInfoProtocolSupplier()
        npcAvatars =
            NpcAvatarFactory(
                allocator,
                DefaultExtendedInfoFilter(),
                listOf(NpcAvatarExtendedInfoDesktopWriter()),
                huffman,
                npcZones,
                npcProtocolSupplier,
            )
        val npcs =
            NpcInfoProtocol(
                allocator,
                ClientTypeMap.of(listOf(DesktopLowResolutionChangeEncoder()), desktop) { it.clientType },
                npcAvatars,
                NpcAvatarExceptionHandler { index, e -> throw IllegalStateException("npc $index", e) },
                worker,
                npcZones,
                null,
            )
        npcProtocolSupplier.supply(npcs)
        protocols = InfoProtocols(players, npcs, worldEntities)
    }

    /** The observer (index = the tsps player index), or another player tsps shows it. */
    fun allocPlayer(index: Int): Infos = protocols.alloc(index, OldSchoolClientType.DESKTOP)

    fun releasePlayer(infos: Infos) = protocols.dealloc(infos)

    fun allocNpc(index: Int, id: Int, level: Int, x: Int, z: Int, direction: Int = 0): NpcAvatar =
        npcAvatars.alloc(index, id, level, x, z, direction = direction)

    fun releaseNpc(avatar: NpcAvatar) = npcAvatars.release(avatar)

    /**
     * A boat drawn on [level] at fine [fineX], [fineZ], its deck [sizeX] × [sizeZ] zones from
     * [zoneX], [zoneZ]. tsps sends neither owner nor deck levels: rsprot puts the world the
     * player is on first whoever owns it, and everyone aboard stands on the deck's level 1.
     */
    fun allocWorldEntity(
        index: Int,
        configId: Int,
        sizeX: Int,
        sizeZ: Int,
        zoneX: Int,
        zoneZ: Int,
        level: Int,
        fineX: Int,
        fineZ: Int,
        angle: Int,
    ): WorldEntityAvatar =
        worldEntityAvatars.alloc(
            index,
            configId,
            NO_OWNER,
            sizeX,
            sizeZ,
            zoneX,
            zoneZ,
            minLevel = 0,
            maxLevel = MAX_LEVEL,
            fineX = fineX,
            fineZ = fineZ,
            projectedLevel = level,
            activeLevel = DECK_LEVEL,
            angle = angle,
        )

    fun releaseWorldEntity(avatar: WorldEntityAvatar) = worldEntityAvatars.release(avatar)

    /** Computes this tick's info packets; read them afterwards with [Infos.getPackets]. */
    fun update() = protocols.update()

    companion object {
        private const val NO_OWNER = 0
        private const val MAX_LEVEL = 3
        /** OSRS's deck level (docs/sailing-osrs-reference.md); tsps keeps actors on its level 0. */
        const val DECK_LEVEL = 1
    }
}
