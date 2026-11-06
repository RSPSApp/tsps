package gateway.session

import gateway.cache.Cache
import gateway.cache.EnumTypes
import gateway.cache.InterfaceComponents
import gateway.cache.NpcTypes
import gateway.cache.ObjTypes
import gateway.cache.VarTypes
import gateway.config.GatewayConfig
import gateway.up.UpdatePlayerModel
import io.netty.buffer.ByteBufAllocator
import net.rsprot.compression.provider.HuffmanCodecProvider
import net.rsprot.protocol.api.GameConnectionHandler
import net.rsprot.protocol.api.login.GameLoginResponseHandler
import net.rsprot.protocol.loginprot.incoming.util.AuthenticationType
import net.rsprot.protocol.loginprot.incoming.util.LoginBlock
import net.rsprot.protocol.loginprot.outgoing.LoginResponse
import net.rsprot.crypto.xtea.XteaKey

/** What every session shares: config, the cache and rsprot's codec providers. */
class GatewayContext(
    val config: GatewayConfig,
    val cache: Cache,
    val huffman: HuffmanCodecProvider,
    /** The revision tsps checks LOGIN against: the cache's. */
    val revision: Int,
    val allocator: ByteBufAllocator = ByteBufAllocator.DEFAULT,
) {
    val objs = ObjTypes(cache)
    val npcTypes = NpcTypes(cache)
    val components = InterfaceComponents(cache)
    val vars = VarTypes(cache)
    val enums = EnumTypes(cache)
    val identKitCount = UpdatePlayerModel.identKitCount(cache)
}

/** rsprot's login callbacks: each login gets a [GatewaySession]. */
class GatewayConnections(private val context: GatewayContext) : GameConnectionHandler<GatewaySession> {
    override fun onLogin(
        responseHandler: GameLoginResponseHandler<GatewaySession>,
        block: LoginBlock<AuthenticationType>,
    ) {
        GatewaySession(context, responseHandler, block).start()
    }

    /** tsps has no session resumption yet; the client falls back to a fresh login. */
    override fun onReconnect(
        responseHandler: GameLoginResponseHandler<GatewaySession>,
        block: LoginBlock<XteaKey>,
    ) {
        responseHandler.writeFailedResponse(LoginResponse.ConnectFail)
    }
}
