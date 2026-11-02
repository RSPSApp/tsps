package gateway.session

import gateway.coverage.DropCounter
import gateway.down.ActorBlocks
import gateway.down.BlockReader
import gateway.down.Clans
import gateway.down.GroundItems
import gateway.down.Interfaces
import gateway.down.Items
import gateway.down.StockMarket
import gateway.down.MapRebuild
import gateway.down.NpcSync
import gateway.down.PlayerSync
import gateway.down.Social
import gateway.down.Trade
import gateway.down.TspsChatMessage
import gateway.down.World
import gateway.down.TspsHandshake
import gateway.down.TspsLoginResult
import gateway.tsps.TspsClientPacket
import gateway.tsps.TspsPacket
import gateway.tsps.TspsServerPacket
import gateway.tsps.TspsSocket
import gateway.up.Upstream
import net.rsprot.protocol.api.Session
import net.rsprot.protocol.api.login.GameLoginResponseHandler
import net.rsprot.protocol.game.outgoing.info.Infos
import net.rsprot.protocol.game.outgoing.map.RebuildLoginV2
import net.rsprot.protocol.game.outgoing.misc.client.ServerTickEnd
import net.rsprot.protocol.game.outgoing.logout.Logout
import net.rsprot.protocol.game.outgoing.misc.player.MessageGame
import net.rsprot.protocol.game.outgoing.misc.player.SetMapFlagV2
import net.rsprot.protocol.game.outgoing.misc.player.UpdateRunEnergy
import net.rsprot.protocol.game.outgoing.misc.player.SetPlayerOp
import net.rsprot.protocol.loginprot.incoming.util.AuthenticationType
import net.rsprot.protocol.loginprot.incoming.util.LoginBlock
import net.rsprot.protocol.loginprot.outgoing.LoginResponse
import net.rsprot.protocol.loginprot.outgoing.util.AuthenticatorResponse
import net.rsprot.protocol.message.IncomingGameMessage
import net.rsprot.protocol.message.OutgoingGameMessage
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.TimeUnit
import java.util.logging.Level
import java.util.logging.Logger
/**
 * One official client and the tsps session behind it.
 *
 * Everything for a session runs on its own thread: tsps packets, the client's packets and the
 * rsprot entity world. tsps drives the clock: each tick ends with its `NPC_INFO`, at which point
 * the gateway processes the client's packets, writes the info packets and flushes.
 */
class GatewaySession(
    private val context: GatewayContext,
    private val responses: GameLoginResponseHandler<GatewaySession>,
    private val block: LoginBlock<AuthenticationType>,
) : TspsSocket.Listener {
    private enum class State { CONNECTING, LOGGING_IN, ENTERING, AWAITING_SCENE, IN_GAME, CLOSED }

    private val executor: ScheduledExecutorService =
        Executors.newSingleThreadScheduledExecutor { Thread(it, "gateway-${block.username}").apply { isDaemon = true } }
    private var state = State.CONNECTING
    private lateinit var tsps: TspsSocket
    private lateinit var handshake: TspsHandshake
    private var session: Session<GatewaySession>? = null

    private val world = EntityWorld(context.allocator, context.huffman)
    private val boats = WorldEntities(world)
    private var self: Infos? = null
    private val varps = VarpMirror(context.vars)
    private val items = Items(context.objs, ::send)
    private val groundItems = GroundItems(::send)
    private val stockMarket = StockMarket(::send)
    private val social = Social(::send)
    private val clans = Clans(::send)
    private val worldUpdates = World(::send, boats::deckAt, boats::sessionWorld)
    private val trade by lazy { Trade(::send, { tsps.send(it) }, items::carried) }

    /** Everything that turns tsps messages into OSRS packets, asked in turn. */
    private val translators: List<(TspsPacket) -> Boolean> by lazy {
        listOf(interfaces::handle, items::handle, groundItems::handle, social::handle, clans::handle, worldUpdates::handle, trade::handle)
    }
    private val interfaces = Interfaces(varps, InterfaceTree(context.enums), stockMarket, items::scriptInventories, context.components::exists, ::send)
    private val upstream =
        Upstream(
            varps,
            context.identKitCount,
            interceptButton = { id, sub, obj, op -> trade.button(id, sub, obj, op) },
            interceptCount = { trade.count(it) },
            worldEntityIndex = boats::tspsIndex,
        ) { tsps.send(it) }
    private val players = PlayerSync()
    private val npcs = NpcSync { index -> boats.deck(index)?.let { it.baseX to it.baseZ } }
    private var mirror: EntityMirror? = null
    /** The player's level in the main world; on a deck, the one they boarded from. */
    private var level = 0

    /** The scene the client has, built by REBUILD_LOGIN or the last rebuild sent. */
    private var scene: MapRebuild? = null

    /** The scene tsps built before the client logged in; REBUILD_LOGIN takes its place. */
    private var loginScene: MapRebuild? = null

    /** Messages produced before the client is logged in, sent right after REBUILD_LOGIN. */
    private val beforeLogin = ArrayList<OutgoingGameMessage>()
    private var lastPing = 0L

    fun start() {
        val password = (block.authentication as? AuthenticationType.PasswordAuthentication)?.password?.asString()
        if (password == null) {
            fail(LoginResponse.InvalidUsernameOrPassword)
            return
        }
        val channel = responses.ctx.channel()
        // rsprot's disconnection hook only exists once the client is in game (enterGame); a client
        // gone while tsps still logs it in would leave the tsps session and this thread running.
        channel.closeFuture().addListener {
            run {
                if (state != State.IN_GAME) {
                    log.info("${block.username}: the client disconnected while logging in")
                    close()
                }
            }
        }
        val address = channel.remoteAddress().toString().substringAfter('/').substringBeforeLast(':')
        TspsSocket.connect(context.config.tspsUrl, address, this).whenComplete { socket, error ->
            val queued =
                run {
                    // The client left first (its close may be queued ahead of this): close() never
                    // saw this socket, and logging in on it would hold the account in tsps.
                    if (state == State.CLOSED) {
                        socket?.close()
                        return@run
                    }
                    if (error != null) {
                        log.warning("${block.username}: ${error.message}")
                        fail(LoginResponse.LoginServerOffline)
                        return@run
                    }
                    tsps = socket
                    state = State.LOGGING_IN
                    tsps.send(TspsClientPacket.login(block.username, password, context.revision))
                }
            if (!queued) socket?.close()
        }
    }

    override fun onPackets(packets: List<TspsPacket>) {
        run { packets.forEach(::onTspsPacket) }
    }

    override fun onClosed(reason: String) {
        run {
            log.info("${block.username}: $reason")
            when (state) {
                State.CLOSED -> Unit
                State.IN_GAME -> close()
                else -> fail(LoginResponse.LoginServerOffline)
            }
        }
    }

    /** A decoded client packet, from [Session.processIncomingPackets] on this session's thread. */
    fun onClientMessage(message: IncomingGameMessage) = upstream.handle(message)

    private val beforeHandshake = ArrayList<TspsPacket>()

    private fun onTspsPacket(packet: TspsPacket) {
        when (state) {
            State.LOGGING_IN -> if (packet.opcode == TspsServerPacket.LOGIN_RESPONSE) onLoginResult(TspsLoginResult.decode(packet))
            // tsps runs its plugins' login hooks before it answers the handshake, so their packets
            // (restored settings, keybinds, ...) arrive first; keep them for after the handshake.
            State.ENTERING -> if (packet.opcode == TspsServerPacket.HANDSHAKE) onHandshake(TspsHandshake.decode(packet)) else beforeHandshake += packet
            State.AWAITING_SCENE, State.IN_GAME -> onGamePacket(packet)
            State.CONNECTING, State.CLOSED -> Unit
        }
    }

    private fun onLoginResult(result: TspsLoginResult) {
        if (!result.ok) {
            fail(result.toLoginResponse())
            return
        }
        state = State.ENTERING
        tsps.send(TspsClientPacket.handshake(block.username))
    }

    private fun onHandshake(handshake: TspsHandshake) {
        this.handshake = handshake
        state = State.AWAITING_SCENE
        beforeHandshake.forEach(::onGamePacket)
        beforeHandshake.clear()
    }

    private fun onGamePacket(packet: TspsPacket) {
        when (packet.opcode) {
            TspsServerPacket.PLAYER_SYNC -> onPlayerSync(players.decode(packet))
            TspsServerPacket.NPC_INFO -> {
                val frame = npcs.decode(packet)
                mirror?.applyNpcs(frame, level)
                if (state == State.IN_GAME) endTick()
            }
            TspsServerPacket.REBUILD_WORLDENTITY -> boats.onRebuild(packet)
            TspsServerPacket.WORLDENTITY_INFO -> boats.onInfo(packet, level)
            TspsServerPacket.CHAT_MESSAGE -> onChat(TspsChatMessage.decode(packet))
            TspsServerPacket.PLAYER_OPTION -> {
                val reader = packet.reader()
                val slot = reader.u8()
                val priority = reader.u8() != 0
                send(SetPlayerOp(slot, priority, reader.utf8().ifEmpty { null }))
            }
            TspsServerPacket.REBUILD_NORMAL -> onRebuild(MapRebuild.normal(packet))
            TspsServerPacket.REBUILD_REGION -> onRebuild(MapRebuild.region(packet))
            TspsServerPacket.DESTINATION -> {
                val reader = packet.reader()
                val x = reader.u16()
                val z = reader.u16()
                send(if (x == 0 && z == 0) SetMapFlagV2() else SetMapFlagV2(x, z))
            }
            TspsServerPacket.RUN_ENERGY -> {
                val reader = packet.reader()
                send(UpdateRunEnergy(reader.u8() * RUN_ENERGY_PER_PERCENT))
                // The run orb reads varp 173; the browser sets it from this packet itself.
                varps.setVarp(RUN_VARP, reader.u8())?.let(::send)
            }
            TspsServerPacket.LOGOUT_RESPONSE -> {
                val reader = packet.reader()
                val ok = reader.u8() != 0
                val reason = reader.string()
                if (ok) send(Logout) else if (reason.isNotEmpty()) send(MessageGame(GAME_MESSAGE, reason))
            }
            TspsServerPacket.TICK -> groundItems.tick(packet.reader().i32())
            else -> {
                if (translators.none { it(packet) }) DropCounter.down(packet.opcode)
                // Varbits also arrive inside interface and script bundles.
                attackOption()
            }
        }
    }

    private var attackShown = false

    /**
     * The browser offers Attack on players while the wilderness varbit is set; tsps only sends
     * PLAYER_OPTION for other options, so the gateway follows the varbit itself.
     */
    private fun attackOption() {
        val inWilderness = varps.getVarbit(IN_WILDERNESS_VARBIT) == 1
        if (inWilderness == attackShown) return
        attackShown = inWilderness
        send(SetPlayerOp(ATTACK_OP, true, if (inWilderness) "Attack" else null))
    }

    private fun onRebuild(rebuild: MapRebuild) {
        val self = self
        if (self == null) {
            loginScene = rebuild
            return
        }
        if (rebuild.canKeep(scene)) return
        scene = rebuild
        self.updateRootBuildArea(rebuild.zoneX - SCENE_RADIUS_ZONES, rebuild.zoneZ - SCENE_RADIUS_ZONES)
        send(rebuild.toMessage())
        groundItems.rebuild(rebuild.zoneX, rebuild.zoneZ)
        worldUpdates.rebuild(rebuild.zoneX, rebuild.zoneZ)
    }

    private fun onPlayerSync(frame: PlayerSync.Frame) {
        val tile = frame.tiles[frame.localIndex] ?: return
        if (boats.deckAt(tile.x, tile.z) == null) level = tile.level
        if (self == null) {
            if (state != State.AWAITING_SCENE) return
            enterGame(tile)
        }
        followScene(tile)
        val reader = BlockReader(frame.updateBlocks)
        val blocks = frame.updateIndices.associateWith { ActorBlocks.player(reader) }
        mirror?.applyPlayers(frame, blocks)
        for ((index, block) in blocks) {
            val move = block.exactMove ?: continue
            val at = frame.tiles[index] ?: continue
            players.moveTo(index, at.x + move.endX, at.z + move.endZ)
        }
    }

    /**
     * tsps sends no rebuild inside a private area on the real map (a raid's own copy of it, like
     * the Fractured Archive): the browser streams the map itself. The official client only has
     * its scene, so the player walks off it. The gateway rebuilds by tsps's own rule instead:
     * a scene centred on the player once they are within [SCENE_EDGE_TILES] of its edge.
     */
    private fun followScene(tile: PlayerSync.Tile) {
        val scene = scene as? MapRebuild.Normal ?: return
        if (boats.deckAt(tile.x, tile.z) != null) return
        val localX = tile.x - ((scene.zoneX - SCENE_RADIUS_ZONES) shl 3)
        val localZ = tile.z - ((scene.zoneZ - SCENE_RADIUS_ZONES) shl 3)
        val inside = SCENE_EDGE_TILES until SCENE_TILES - SCENE_EDGE_TILES
        if (localX in inside && localZ in inside) return
        onRebuild(MapRebuild.Normal(tile.x ushr 3, tile.z ushr 3))
    }

    private fun onChat(chat: TspsChatMessage) {
        when {
            // Public chat goes overhead and to the chatbox through PLAYER_INFO.
            chat.isPublic && chat.playerIndex >= 0 -> mirror?.queueChat(chat.playerIndex, EntityMirror.PublicChat(chat.text, chat.modIcon, chat.isAutotyper, chat.style))
            social.chat(chat) -> Unit
            chat.isGameMessage -> send(MessageGame(chat.type, chat.from.ifEmpty { null }, chat.text))
            else -> DropCounter.down(TspsServerPacket.CHAT_MESSAGE)
        }
    }

    /** tsps has placed the player: log the client in at that tile. */
    private fun enterGame(tile: PlayerSync.Tile) {
        val infos = world.allocPlayer(handshake.index)
        infos.updateRootCoord(tile.level, tile.x, tile.z)
        val scene = loginScene ?: MapRebuild.Normal(tile.x ushr 3, tile.z ushr 3)
        this.scene = scene
        infos.updateRootBuildArea(scene.zoneX - SCENE_RADIUS_ZONES, scene.zoneZ - SCENE_RADIUS_ZONES)
        Appearance.apply(infos.playerInfo.avatar.extendedInfo, handshake)
        // tsps decides who this player sees; the session's world only holds those avatars, so
        // rsprot's own distance rules mustn't drop any of them.
        infos.playerInfo.avatar.forceResizeRange(Int.MAX_VALUE)
        infos.npcInfo.setRenderDistance(SCENE_RENDER_DISTANCE)
        infos.npcInfo.setZoneSearchRadius(SCENE_RADIUS_ZONES + 1)
        infos.worldEntityInfo.updateRenderDistance(BOAT_RENDER_DISTANCE)
        self = infos
        mirror = EntityMirror(world, context.objs, context.npcTypes, infos, handshake.index, items::selfAppearance) { x, z -> boats.deckAt(x, z) != null }

        val ok =
            LoginResponse.Ok(
                authenticatorResponse = AuthenticatorResponse.NoAuthenticator,
                staffModLevel = if (handshake.admin) STAFF_ADMINISTRATOR else 0,
                playerMod = false,
                index = handshake.index,
                member = handshake.members,
                accountHash = 0,
                userId = handshake.index.toLong(),
                userHash = 0,
            )
        val session = responses.writeSuccessfulResponse(ok, block)
        session.setDisconnectionHook {
            log.info("${handshake.name}: the client disconnected")
            run(::close)
        }
        this.session = session
        // REBUILD_LOGIN is always a static map; an instance follows as its own rebuild.
        session.queue(RebuildLoginV2(scene.zoneX, scene.zoneZ, MapRebuild.MAIN_WORLD_AREA, infos.playerInfo))
        if (scene is MapRebuild.Region) session.queue(scene.toMessage())
        groundItems.rebuild(scene.zoneX, scene.zoneZ)
        worldUpdates.rebuild(scene.zoneX, scene.zoneZ)
        // The browser client adds these itself; tsps handles op 2 as trade and 3 as follow.
        session.queue(SetPlayerOp(TRADE_OP, false, "Trade with"))
        session.queue(SetPlayerOp(FOLLOW_OP, false, "Follow"))
        // Every tsps player has their name from login, but the chatbox (script 223) shows it only
        // once this varbit says a display name is set; otherwise "You must set a name...".
        varps.setVarbit(NAME_SET_VARBIT, 1)?.let(session::queue)
        beforeLogin.forEach(session::queue)
        beforeLogin.clear()
        state = State.IN_GAME
        // Pass the client's packets on as they come, not once per tick: tsps only acts on them at
        // its next tick, so waiting for ours as well added up to a tick to every click.
        executor.scheduleWithFixedDelay({ run(::forwardClientPackets) }, CLIENT_POLL_MS, CLIENT_POLL_MS, TimeUnit.MILLISECONDS)
        log.info("${handshake.name} entered at ${tile.x}, ${tile.z}, ${tile.level} (index ${handshake.index})")
    }

    private fun forwardClientPackets() {
        if (state == State.IN_GAME) session?.processIncomingPackets(this)
    }

    private fun endTick() {
        val session = session ?: return
        val self = self ?: return
        session.processIncomingPackets(this)
        world.update()
        mirror?.discardOthersPackets()
        val packets = self.getPackets()
        val root = packets.rootWorldInfoPackets
        // A failed info packet leaves the client's entity state behind for good (rsprot says to
        // kick the player), so it ends the session with the reason.
        for (result in listOf(root.worldEntityInfo, root.playerInfo, root.npcInfo) + packets.activeWorlds.map { it.npcInfo }) {
            result.exceptionOrNull()?.let { throw IllegalStateException("info packet failed", it) }
        }
        // The boats first, then each boat's world (its deck scene when new, its zones and NPCs),
        // then the main world's zones, players and NPCs.
        session.queue(root.activeWorld)
        session.queue(root.worldEntityInfo.getOrNull()!!)
        for (boat in packets.activeWorlds) {
            session.queue(boat.activeWorld)
            if (boat.added) boats.deckOfWorld(boat.worldId)?.let { session.queue(it.rebuild()) }
            worldUpdates.flushDeck(boat.worldId)
            session.queue(boat.npcUpdateOrigin)
            session.queue(boat.npcInfo.getOrNull()!!)
        }
        packets.removedWorldIndices.forEach(worldUpdates::dropDeck)
        session.queue(root.activeWorld)
        worldUpdates.flushZones()
        session.queue(root.playerInfo.getOrNull()!!)
        session.queue(root.npcUpdateOrigin)
        session.queue(root.npcInfo.getOrNull()!!)
        session.queue(ServerTickEnd)
        session.flush()
        keepAlive()
    }

    /** tsps closes a socket that has pinged once and then gone quiet for 30 s. */
    private fun keepAlive() {
        val now = System.currentTimeMillis()
        if (now - lastPing < PING_INTERVAL_MS) return
        lastPing = now
        tsps.send(TspsClientPacket.ping(now.toInt()))
    }

    private fun send(message: OutgoingGameMessage) {
        val session = session
        if (session == null) beforeLogin += message else session.queue(message)
    }

    private fun fail(response: LoginResponse) {
        if (state == State.CLOSED) return
        responses.writeFailedResponse(response)
        close()
    }

    /**
     * Runs [task] on this session's thread. A failure is logged and ends the session: its
     * mirrors of tsps's state can't be trusted after a message was only half applied. Returns
     * false when the session has ended and [task] won't run.
     */
    private fun run(task: () -> Unit): Boolean {
        if (executor.isShutdown) return false
        try {
            executor.execute {
                try {
                    task()
                } catch (e: Throwable) {
                    log.log(Level.SEVERE, "${block.username}: session failed", e)
                    if (state == State.IN_GAME) close() else fail(LoginResponse.UnknownReplyFromLoginServer)
                }
            }
        } catch (e: RejectedExecutionException) {
            // Shut down between the check and the hand-off.
            return false
        }
        return true
    }

    private fun close() {
        if (state == State.CLOSED) return
        state = State.CLOSED
        if (::tsps.isInitialized) tsps.close()
        session?.flush()
        session?.requestClose()
        mirror?.release()
        mirror = null
        boats.release()
        self?.let(world::releasePlayer)
        self = null
        executor.shutdown()
        executor.awaitTermination(0, TimeUnit.SECONDS)
    }

    private companion object {
        val log: Logger = Logger.getLogger(GatewaySession::class.java.name)
        const val STAFF_ADMINISTRATOR = 2

        /** Tiles; tsps shows boats within 32 of the player, and rsprot needs a boat wholly inside. */
        const val BOAT_RENDER_DISTANCE = 40
        const val PING_INTERVAL_MS = 5_000L
        const val SCENE_RADIUS_ZONES = 6
        const val SCENE_TILES = 104

        /** tsps moves the scene once the player is this close to its edge (PlayerSession). */
        const val SCENE_EDGE_TILES = 16

        /** One client cycle. */
        const val CLIENT_POLL_MS = 20L
        const val SCENE_RENDER_DISTANCE = 52
        const val TRADE_OP = 2
        const val ATTACK_OP = 1
        const val IN_WILDERNESS_VARBIT = 5963
        const val NAME_SET_VARBIT = 8119
        const val RUN_VARP = 173
        const val RUN_ENERGY_PER_PERCENT = 100
        const val GAME_MESSAGE = 0

        const val FOLLOW_OP = 3
    }
}
