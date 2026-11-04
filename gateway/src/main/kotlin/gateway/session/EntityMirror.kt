package gateway.session

import gateway.cache.NpcTypes
import gateway.cache.ObjTypes
import gateway.down.ActorBlock
import gateway.down.AppearanceBlock
import gateway.down.ChatStyle
import gateway.down.NpcSync
import gateway.down.PlayerSync
import net.rsprot.protocol.game.outgoing.info.Infos
import net.rsprot.protocol.game.outgoing.info.npcinfo.NpcAvatar
import net.rsprot.protocol.game.outgoing.info.npcinfo.NpcAvatarExtendedInfo
import net.rsprot.protocol.game.outgoing.info.playerinfo.PlayerAvatarExtendedInfo

/**
 * Mirrors what tsps shows one session into its [EntityWorld]: the observer, every other player
 * and every NPC, with their update blocks applied as rsprot extended info.
 */
class EntityMirror(
    private val world: EntityWorld,
    private val objs: ObjTypes,
    private val npcTypes: NpcTypes,
    private val self: Infos,
    private val selfIndex: Int,
    /** The local player's appearance, the only place tsps sends worn equipment to the browser. */
    private val onSelfAppearance: (AppearanceBlock) -> Unit,
    /** Whether a tile is on a boat's deck, where OSRS has actors on level 1 and tsps on 0. */
    private val onDeck: (Int, Int) -> Boolean = { _, _ -> false },
) {
    private val players = HashMap<Int, Infos>()
    private val npcs = HashMap<Int, NpcAvatar>()
    private val npcTypeIds = HashMap<Int, Int>()

    /** Public chat from CHAT_MESSAGE, by speaker, waiting for this tick's player sync. */
    private val pendingChat = HashMap<Int, PublicChat>()

    /** One public message for the speaker's chat block. */
    class PublicChat(val text: String, val modIcon: Int, val autotyper: Boolean, val style: ChatStyle?)

    fun queueChat(index: Int, chat: PublicChat) {
        pendingChat[index] = chat
    }

    fun applyPlayers(frame: PlayerSync.Frame, blocks: Map<Int, ActorBlock>) {
        for (index in frame.removed) players.remove(index)?.let(world::releasePlayer)
        for ((index, tile) in frame.tiles) {
            val infos =
                if (index == selfIndex) {
                    self
                } else {
                    players.getOrPut(index) { world.allocPlayer(index) }
                }
            infos.updateRootCoord(level(tile), tile.x, tile.z)
        }
        for ((index, block) in blocks) {
            val infos = if (index == selfIndex) self else players[index] ?: continue
            // A forced movement ends on its end tile, where tsps (and the browser) now count the
            // player from. OSRS has the player on that tile as the move starts, the move drawn from
            // there: place them on it as a teleport, and the move relative to it.
            val move = block.exactMove
            val tile = frame.tiles[index]
            if (move != null && tile != null) {
                infos.updateRootCoord(level(tile), tile.x + move.endX, tile.z + move.endZ)
                infos.playerInfo.avatar.extendedInfo.setTempMoveSpeed(TELEPORT_MOVE_SPEED)
            }
            applyPlayer(index, infos.playerInfo.avatar.extendedInfo, block)
        }
        for ((index, chat) in pendingChat) {
            val infos = if (index == selfIndex) self else players[index] ?: continue
            infos.playerInfo.avatar.extendedInfo.setChat(
                chat.style?.colour ?: 0,
                chat.style?.effect ?: 0,
                chat.modIcon,
                chat.autotyper,
                chat.text.take(MAX_CHAT_LENGTH),
                chat.style?.pattern,
            )
        }
        pendingChat.clear()
    }

    fun applyNpcs(frame: NpcSync.Frame, level: Int) {
        // tsps removes and re-adds an NPC in one frame for a jump or a type change; OSRS keeps
        // the NPC and teleports or transforms it, so those pairs don't touch the avatar list.
        val readded = frame.changes.filterIsInstance<NpcSync.Change.Added>().map { it.index }.toSet()
        for (change in frame.changes) {
            when (change) {
                is NpcSync.Change.Removed -> if (change.index !in readded) npcs.remove(change.index)?.let(world::releaseNpc)?.also { npcTypeIds.remove(change.index) }
                is NpcSync.Change.Added -> {
                    val npc = change.npc
                    npc.level = if (npc.onDeck) EntityWorld.DECK_LEVEL else level
                    npcTypeIds[change.index] = npc.type
                    val existing = npcs[change.index]
                    if (existing != null) {
                        existing.setId(npc.type)
                        existing.teleport(npc.level, npc.x, npc.z, change.jump)
                    } else {
                        npcs[change.index] = world.allocNpc(change.index, npc.type, npc.level, npc.x, npc.z, change.direction)
                    }
                }
                is NpcSync.Change.Moved -> {
                    val avatar = npcs[change.index] ?: continue
                    for ((dx, dz) in change.steps) if (change.crawl) avatar.crawl(dx, dz) else avatar.walk(dx, dz)
                }
            }
        }
        for ((index, block) in frame.blocks) {
            val avatar = npcs[index] ?: continue
            applyNpc(avatar.extendedInfo, block, npcTypeIds[index] ?: -1)
        }
    }

    /** tsps overrides body-model slots; OSRS replaces the whole list. Empty resets to the type's. */
    private fun applyModelCustomisation(info: NpcAvatarExtendedInfo, type: Int, overrides: List<Pair<Int, Int>>) {
        if (overrides.isEmpty()) {
            info.resetBodyCustomisations()
            return
        }
        val models = npcTypes.models(type).toMutableList()
        for ((slot, model) in overrides) {
            while (models.size <= slot) models += -1
            models[slot] = model
        }
        info.setBodyCustomisation(models.filter { it >= 0 }, emptyList(), emptyList())
    }

    /**
     * The other players are full rsprot observers too, so each tick computes info packets for
     * them that only their own sessions would send; release those so rsprot doesn't report them.
     */
    fun discardOthersPackets() {
        for (infos in players.values) {
            val packets = infos.getPackets()
            val root = packets.rootWorldInfoPackets
            root.worldEntityInfo.getOrNull()?.safeRelease()
            root.playerInfo.getOrNull()?.safeRelease()
            root.npcInfo.getOrNull()?.safeRelease()
            packets.activeWorlds.forEach { it.npcInfo.getOrNull()?.safeRelease() }
        }
    }

    fun release() {
        players.values.forEach(world::releasePlayer)
        npcs.values.forEach(world::releaseNpc)
        players.clear()
        npcs.clear()
        npcTypeIds.clear()
    }

    private fun applyPlayer(index: Int, info: PlayerAvatarExtendedInfo, block: ActorBlock) {
        block.appearance?.let {
            applyAppearance(info, it)
            if (index == selfIndex) onSelfAppearance(it)
        }
        // Public chat arrives as CHAT_MESSAGE too; the overhead copy would show it twice.
        block.forcedChat?.takeIf { index !in pendingChat }?.let(info::setSay)
        block.faceDirection?.let { info.setFaceAngle(it) }
        block.faceEntity?.let(info::setFacePathingEntity)
        block.animation?.let { (id, delay) -> info.setSequence(id, delay) }
        for (hit in block.hits) {
            // tsps already chose this viewer's hitsplat type.
            info.addHitMark(-1, hit.type, hit.type, hit.type, hit.damage, hit.delay)
        }
        for (bar in block.headbars) {
            if (bar.remove) {
                info.removeHeadBar(bar.id)
            } else {
                info.addHeadBar(-1, bar.id, bar.id, bar.fill, bar.endFill, bar.delay, bar.delay + bar.duration)
            }
        }
        block.movementType?.let(info::setMoveSpeed)
        if (block.resetPath) info.setTempMoveSpeed(TELEPORT_MOVE_SPEED)
        // Relative to the end tile the player was just placed on (see applyPlayers).
        block.exactMove?.let { info.setExactMove(it.startX - it.endX, it.startZ - it.endZ, it.startCycle, 0, 0, it.endCycle, it.direction) }
        for (spot in block.spotAnims) info.setSpotAnim(spot.slot, spot.id, spot.delay, spot.height)
        block.tint?.let { info.setTinting(it.start, it.end, it.hue, it.saturation, it.lightness, it.weight) }
    }

    /** A tile's level, the deck's for a boat's deck (OSRS has actors there on 1, tsps on 0). */
    private fun level(tile: PlayerSync.Tile) = if (onDeck(tile.x, tile.z)) EntityWorld.DECK_LEVEL else tile.level

    private fun applyNpc(info: NpcAvatarExtendedInfo, block: ActorBlock, type: Int) {
        block.modelCustomisation?.let { applyModelCustomisation(info, type, it) }
        block.tint?.let { info.setTinting(it.start, it.end, it.hue, it.saturation, it.lightness, it.weight) }
        block.forcedChat?.let(info::setSay)
        block.faceEntity?.let(info::setFacePathingEntity)
        block.faceTile?.let { (x, z) -> info.setFaceCoordGrid(x, z, instant = false, walkMode = 0) }
        block.animation?.let { (id, delay) -> info.setSequence(id, delay) }
        for (hit in block.hits) info.addHitMark(-1, hit.type, hit.type, hit.damage, hit.delay)
        for (bar in block.headbars) {
            if (bar.remove) {
                info.removeHeadBar(bar.id)
            } else {
                info.addHeadBar(-1, bar.id, bar.id, bar.fill, bar.endFill, bar.delay, bar.delay + bar.duration)
            }
        }
        block.exactMove?.let { info.setExactMove(it.startX, it.startZ, it.startCycle, it.endX, it.endZ, it.endCycle, it.direction) }
        for (spot in block.spotAnims) info.setSpotAnim(spot.slot, spot.id, spot.delay, spot.height)
        block.headIcons?.let { icons ->
            info.resetHeadIcons()
            icons.forEachIndexed { slot, (group, index) -> info.setHeadIconChange(slot, group, index) }
        }
        block.baseAnimations?.let { anims ->
            // tsps sends the whole set each time, empty for the type's own; rsprot's set keeps its
            // slots until reset and only adds to them, so a reset (or a dropped slot) never reached
            // the client: Scurrius kept his eating idle after getting up from the food pile.
            info.resetBaseAnimationSet()
            if (anims.isEmpty()) return@let
            val bySlot = anims.toMap()
            info.setBaseAnimationSet(
                readyAnim = bySlot[NPC_IDLE] ?: Int.MIN_VALUE,
                walkAnim = bySlot[NPC_WALK] ?: Int.MIN_VALUE,
                turnLeftAnim = bySlot[NPC_TURN_LEFT] ?: Int.MIN_VALUE,
                turnRightAnim = bySlot[NPC_TURN_RIGHT] ?: Int.MIN_VALUE,
            )
        }
        block.transparency?.let { info.setTransparency(it.start, it.end, it.from.coerceAtLeast(0), it.to, useStartTransparency = it.from >= 0) }
    }

    private fun applyAppearance(info: PlayerAvatarExtendedInfo, appearance: AppearanceBlock) {
        info.setName(appearance.name)
        info.setMale(appearance.gender == 0)
        info.setSkullIcon(appearance.skull)
        info.setOverheadIcon(appearance.prayer)
        info.setCombatLevel(appearance.combatLevel)
        info.setSkillLevel(appearance.skillLevel)
        if (appearance.npcId >= 0) {
            info.transformToNpc(appearance.npcId)
        } else {
            info.transformToNpc(-1)
            for (slot in 0 until WORN_SLOTS) {
                val obj = appearance.objs[slot]
                if (obj >= 0) {
                    val type = objs[obj]
                    info.setWornObj(slot, obj, type.wearpos2, type.wearpos3)
                } else {
                    info.setWornObj(slot, -1, -1, -1)
                }
                val kitSlot = KIT_SLOT_BY_WORN_SLOT[slot]
                if (kitSlot >= 0 && appearance.kits[slot] >= 0) info.setIdentKit(kitSlot, appearance.kits[slot])
            }
        }
        appearance.colours.forEachIndexed(info::setColour)
        val anims = appearance.animations
        info.setBaseAnimationSet(anims[0], anims[1], anims[2], anims[3], anims[4], anims[5], anims[6])
    }

    private companion object {
        const val WORN_SLOTS = 12
        const val TELEPORT_MOVE_SPEED = 127
        const val MAX_CHAT_LENGTH = 80

        /** tsps's `kitSlots` in encodePlayerAppearance: worn slot → identkit slot. */
        val KIT_SLOT_BY_WORN_SLOT = intArrayOf(-1, -1, -1, -1, 2, -1, 3, 5, 0, 4, 6, 1)

        const val NPC_IDLE = 0
        const val NPC_WALK = 1
        const val NPC_TURN_LEFT = 2
        const val NPC_TURN_RIGHT = 3
    }
}
