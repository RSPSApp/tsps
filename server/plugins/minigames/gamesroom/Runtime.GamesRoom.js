'use strict';
const { GAMES } = require('./Games.GamesRoom');
const Rules = require('./Rules.GamesRoom');
const Screen = require('./Interface.GamesRoom');
const Tables = require('./Tables.GamesRoom');
const Access = require('./Access.GamesRoom');
const Seating = require('./Seating.GamesRoom');
const RuneSquares = require('./Interface.RuneSquares.GamesRoom');
const Spectator = require('./Spectator.GamesRoom');
const RANK_ATTRIBUTES = Object.fromEntries(Object.keys(GAMES).map(game => [game, `games-room:${game}-rank`]));
const SETTINGS_ATTRIBUTE = 'games-room:settings';
const SECONDS = [15,30,60,120];
const PIECES = ['firerune','waterrune','earthrune','airrune','mindrune','bodyrune','naturerune','chaosrune','lawrune','cosmicrune','bloodrune','soulrune'];
const TIMES = ['15seconds','30seconds','1minute','2minutes'];
// Current Wiki audio metadata identifies these jingles; all three archives are
// present in the active rev241 cache (musicJingles index). Symbols are anonymous.
// /w/Draw_(Burthorpe_Games_Room), /w/Defeat..._(Burthorpe_Games_Room),
// /w/Victory!_(Burthorpe_Games_Room) on oldschool.runescape.wiki.
const RESULT_JINGLES = { draw: 108, defeat: 109, victory: 110 };
const menus = new Map(), matches = new Map(), invitations = new Map(), results = new Map();
/** Each player's opponent in their last game: the only one they may challenge in a ground-floor game room. */
const previousOpponents = new WeakMap();
let api, core, area;
function now() { return core.World.getProcessCycle(); }
function ticks(seconds) { return Math.ceil(seconds*1000/core.GameConstants.GAME_ENGINE_PROCESSING_CYCLE_RATE); }
function rank(player,game) {
  const n=player.getAttribute(RANK_ATTRIBUTES[game],1000);
  return Number.isInteger(n)?Math.max(1,Math.min(60000,n)):1000;
}
function settings(player) {
  const s=player.getAttribute(SETTINGS_ATTRIBUTE,null);
  return {piece:Number.isInteger(s?.piece)&&s.piece>=1&&s.piece<=12?s.piece:1,
    seconds:SECONDS.includes(s?.seconds)?s.seconds:30,ranked:s?.ranked!==false};
}
function inRoom(player) {
  return !!player&&player.isRegistered()&&player.getHitpoints()>0&&area.getBoundaries().some(b=>b.inside(player.getLocation()));
}
function available(player) {
  if(!inRoom(player)||matches.has(player)||core.CombatFactory.inCombat(player))return false;
  if(player.isNeedsPlacement()||player.isTeleportingReturn()||player.getForceMovement()!=null||player.getStatus()!==core.PlayerStatus.NONE)return false;
  const open=player.getInterfaceId();
  return open<=0||[core.CacheDefinitions.getInterfaceId('boardgames_challenge'),...Object.keys(GAMES).flatMap(game=>[Screen.optionsGroup(game),Screen.group(game)])].includes(open);
}
function pairValid(a,b) {
  const aRoom=a&&Access.roomGame(a.getLocation()),bRoom=b&&Access.roomGame(b.getLocation());
  return a!==b&&!Spectator.viewOf(a)&&!Spectator.viewOf(b)&&available(a)&&available(b)&&aRoom===bRoom&&a.getLocation().getZ()===b.getLocation().getZ()&&a.getLocation().getDistance(b.getLocation())<=16
    &&(!postGameRoom(a)||previousOpponents.get(a)===b&&previousOpponents.get(b)===a);
}
/**
 * Wiki (Burthorpe Games Room): "at the end of each game, the player is placed in a room in which they can only
 * challenge their opponent" to another match of that game. The ground-floor rooms are those (gameRoom); the
 * upstairs experienced rooms keep challenges open among their players (ours: the Wiki only names a rank to enter).
 */
function postGameRoom(player) {
  const location=player.getLocation();
  return location.getZ()===0&&Access.roomGame(location)!=null;
}
function invitation(a,b) { return invitations.get(a)?.get(b); }
function removeInvitation(inv) {
  const list=invitations.get(inv.from);
  if(list?.get(inv.to)!==inv)return false;
  list.delete(inv.to);if(!list.size)invitations.delete(inv.from);return true;
}
function cancelInvitations(player) {
  for(const [from,list] of invitations) {
    for(const inv of list.values())if(from===player||inv.to===player)list.delete(inv.to);
    if(!list.size)invitations.delete(from);
  }
}
function ownScreen(player,group) { return player.getInterfaceId()===group&&player.getPacketSender().isSubInterfaceOpen(group); }
function selection(player,target) {
  const room=Access.roomGame(player.getLocation());
  const menu={target,game:room??'draughts',stage:'selection',settings:settings(player)};
  menus.set(player,menu);results.delete(player);
  if(room)options(player,menu);else Screen.showSelection(player,0,
    Object.fromEntries(Object.keys(GAMES).map(game=>[game,[rank(player,game),rank(target,game)]])));
}
function options(player,menu) { menu.stage='options';Screen.showOptions(player,menu.game,menu.settings); }
function playerOption(event) {
  if(event.option!==4||!inRoom(event.player))return;
  event.handled=true;
  const {player,target}=event;
  if(!pairValid(player,target)) {player.sendMessage('That player is unavailable for a game.');return;}
  const incoming=invitation(target,player);
  if(incoming)return accept(incoming);
  selection(player,target);
}
function route(event) {
  if(event.option===4&&inRoom(event.player))playerOption(event);
}
function issue(player,menu) {
  if(!pairValid(player,menu.target)||(Access.roomGame(player.getLocation())&&Access.roomGame(player.getLocation())!==menu.game)) {menus.delete(player);player.sendMessage('That player is unavailable for a game.');return;}
  player.setAttribute(SETTINGS_ATTRIBUTE,{...menu.settings});
  const inv={from:player,to:menu.target,game:menu.game,settings:{...menu.settings},created:now()};
  let list=invitations.get(player);if(!list)invitations.set(player,list=new Map());list.set(menu.target,inv);
  menus.delete(player);player.getPacketSender().sendInterfaceRemoval();
  player.sendMessage(`You challenge ${menu.target.getDisplayName()} to ${GAMES[menu.game].title}.`);
  menu.target.sendMessage(`${player.getDisplayName()} challenges you to ${GAMES[menu.game].title}. Choose Challenge on that player to accept.`);
  api.sendMultiChatboxPrompt(menu.target,'Accept this game challenge?',
    'Accept',()=>accept(inv),'Decline',()=>decline(inv));
}
function decline(inv) {
  if(removeInvitation(inv))inv.from.sendMessage(`${inv.to.getDisplayName()} declined your challenge.`);
}
function accept(inv) {
  if(invitation(inv.from,inv.to)!==inv)return;
  if(!pairValid(inv.from,inv.to)) {removeInvitation(inv);return;}
  const chosen=settings(inv.to);
  if(chosen.piece===inv.settings.piece)chosen.piece=inv.settings.piece===1?2:1;
  const menu={target:inv.from,game:inv.game,stage:'accept',settings:{...inv.settings,piece:chosen.piece},inv};
  menus.set(inv.to,menu);
  Screen.showOptions(inv.to,inv.game,menu.settings,{recipient:true});
}
function start(inv,recipientSettings) {
  if(invitation(inv.from,inv.to)!==inv||!pairValid(inv.from,inv.to))return;
  if(recipientSettings.piece===inv.settings.piece) {inv.to.sendMessage('Please choose a different rune from your opponent.');return;}
  // The ordinary lobby spans both planes. Only an experienced challenge-room
  // invitation uses upstairs tables (pinned reference challengeroom flag).
  const plane=Access.roomGame(inv.from.getLocation())===inv.game&&inv.from.getLocation().getZ()===1?1:0;
  const allocation=Tables.allocate(inv.game,plane);
  if(!allocation) {inv.to.sendMessage('There are no free tables for a game.');return;}
  removeInvitation(inv);
  const players=[inv.from,inv.to],state=Rules.create(inv.game);
  state.turn=Math.random()<0.5?0:1;
  const match={game:inv.game,players,state,allocation,seats:allocation.seats,settings:{seconds:inv.settings.seconds,ranked:inv.settings.ranked,
    pieces:[inv.settings.piece,recipientSettings.piece]},drawOffer:null,selected:new Map(),deadline:now()+ticks(inv.settings.seconds),turns:0};
  for(const p of players) {cancelInvitations(p);menus.delete(p);results.delete(p);p.getPacketSender().sendInterfaceRemoval();}
  for(const p of players)matches.set(p,match);
  for(const [side,p] of players.entries()) {p.getMovementQueue().reset();p.moveTo(match.seats[side].clone());Screen.showMatch(p,match);}
  Seating.seat(match);
}
function finish(match,winner,reason,{departing=null,returnDeparting=false}={}) {
  if(match.finished)return;
  match.finished=true;match.state.result={winner,reason};
  Spectator.refresh(match);
  Seating.release(match);
  match.allocation.release();
  // Four completed turns before ranking comes only from the historical reference.
  // It prevents instant-resign rank transfers; current capture confirmation is absent.
  // Runeversi reuses this existing rating policy; its formula and four-turn
  // threshold are not established by a current Runeversi recording.
  if(match.settings.ranked&&winner!=null&&match.turns>=4) {
    const w=match.players[winner],l=match.players[1-winner],wr=rank(w,match.game),lr=rank(l,match.game),delta=Rules.rankChange(wr,lr);
    w.setAttribute(RANK_ATTRIBUTES[match.game],Math.min(60000,wr+delta));l.setAttribute(RANK_ATTRIBUTES[match.game],Math.max(1,lr-delta));
  }
  for(const p of match.players) {if(matches.get(p)===match)matches.delete(p);match.selected.delete(p);}
  previousOpponents.set(match.players[0],match.players[1]);previousOpponents.set(match.players[1],match.players[0]);
  for(const p of match.players) {
    if((p!==departing||returnDeparting)&&inRoom(p))p.moveTo(Access.gameRoom(match.game,match.seats[0].getZ()));
    if(p===departing)continue;
    if(ownScreen(p,Screen.group(match.game))) {results.set(p,match);Screen.showResult(p,match);}
    p.sendMessage(winner==null?'The game is a draw.':p===match.players[winner]?'You win!':'You lose.');
    p.getPacketSender().sendJingle(winner==null?RESULT_JINGLES.draw:p===match.players[winner]?RESULT_JINGLES.victory:RESULT_JINGLES.defeat,0);
    p.getPacketSender().sendConfig(core.CacheDefinitions.getVarpId(`boardgames_${match.game}_rank`),rank(p,match.game));
  }
}
function leave(player) {
  RuneSquares.roomOverlay(player,false);
  Spectator.leave(player, true);
  cancelInvitations(player);menus.delete(player);results.delete(player);
  const match=matches.get(player);if(match)finish(match,1-match.players.indexOf(player),'Opponent left the game.',{departing:player});
}
function pairValidForMatch(match) {
  return invalidSides(match).length===0;
}
function invalidSides(match) {
  return match.players.flatMap((p,side)=>!inRoom(p)||!p.getLocation().equals(match.seats[side])?[side]:[]);
}
function move(player,match,move) {
  const side=match.players.indexOf(player);
  if(!pairValidForMatch(match)||!Rules.play(match.state,side,move))return false;
  Seating.moved(match,player);
  match.selected.clear();match.drawOffer=null;
  if(match.state.forced==null||match.state.result)match.turns++;
  match.deadline=now()+ticks(match.settings.seconds);
  for(const p of match.players)Screen.refreshMatch(p,match);
  Spectator.refresh(match);
  if(match.state.result)finish(match,match.state.result.winner,match.state.result.reason);
  return true;
}
function click(event) {
  if(Spectator.click(event))return;
  const {player,buttonId}=event,group=buttonId>>>16;
  const supported=[core.CacheDefinitions.getInterfaceId('boardgames_challenge'),...Object.keys(GAMES).flatMap(game=>[Screen.group(game),Screen.optionsGroup(game)])];
  if(!supported.includes(group))return;event.handled=true;
  if((event.opId??event.action)!==1||!ownScreen(player,group))return;
  const is=name=>buttonId===Screen.component(name),match=matches.get(player);
  if(match&&group===Screen.group(match.game)) {
    const prefix=`boardgames_${match.game}`;
    if(is(`${prefix}:resign`))return finish(match,1-match.players.indexOf(player),'Resigned.');
    if(is(`${prefix}:offer_draw`)) {
      if(match.drawOffer&&match.drawOffer!==player)return finish(match,null,'Draw agreed.');
      match.drawOffer=player;for(const p of match.players)Screen.refreshMatch(p,match);
      Spectator.refresh(match);return;
    }
    if(match.game==='runesquares') {
      const edge=RuneSquares.decode(buttonId);
      if(edge)return move(player,match,edge);
    } else if(match.game==='runelink') {
      for(let col=0;col<7;col++)if(is(`${prefix}:column${col}`))return move(player,match,{column:col});
    } else if(match.game==='runeversi') {
      for(let to=0;to<64;to++)if(is(`${prefix}:square_${to}`))return move(player,match,{to});
    } else if(is(`${prefix}:boardinv`)&&Number.isInteger(event.slot)&&event.slot>=0&&event.slot<64&&match.players[match.state.turn]===player) {
      const from=match.selected.get(player),to=event.slot;
      if(from!==undefined&&move(player,match,{from,to}))return;
      if(Rules.legalMoves(match.state).some(m=>m.from===to)) {match.selected.set(player,to);Screen.refreshMatch(player,match);}
    }
    return;
  }
  if(results.has(player)&&is(`boardgames_${results.get(player).game}:close`)) {results.delete(player);player.getPacketSender().sendInterfaceRemoval();return;}
  const menu=menus.get(player);if(!menu)return;
  if(menu.stage==='selection'&&group===core.CacheDefinitions.getInterfaceId('boardgames_challenge')) {
    const chosen=Object.keys(GAMES).find(game=>is(`boardgames_challenge:${game}`));
    if(chosen)menu.game=chosen;
    else if(is('boardgames_challenge:select'))return options(player,menu);
    else return;
    player.getPacketSender().sendVarbit(core.CacheDefinitions.getVarbitId('boardgames_game'),GAMES[menu.game].id);return;
  }
  if((menu.stage==='options'||menu.stage==='accept')&&group===Screen.optionsGroup(menu.game)) {
    const prefix=`boardgames_${menu.game}_options`,piece=PIECES.findIndex(n=>is(`${prefix}:${n}`)),time=TIMES.findIndex(n=>is(`${prefix}:${n}`));
    if(piece>=0)menu.settings.piece=piece+1;
    else if(time>=0&&menu.stage!=='accept')menu.settings.seconds=SECONDS[time];
    else if(is(`${prefix}:ranked`)&&menu.stage!=='accept')menu.settings.ranked=!menu.settings.ranked;
    else if(is(`${prefix}:challenge`))return menu.stage==='accept'?start(menu.inv,menu.settings):issue(player,menu);
    else return;
    player.setAttribute(SETTINGS_ATTRIBUTE,{...menu.settings});Screen.showOptions(player,menu.game,menu.settings,{recipient:menu.stage==='accept'});
  }
}
function closed({player,interfaceId}) {
  Spectator.closed({player,interfaceId});
  const match=matches.get(player);
  if(match&&interfaceId===Screen.group(match.game))return finish(match,1-match.players.indexOf(player),'Game closed.',{departing:player,returnDeparting:true});
  const menu=menus.get(player);
  if(menu&&interfaceId===(menu.stage==='selection'?core.CacheDefinitions.getInterfaceId('boardgames_challenge'):Screen.optionsGroup(menu.game))) {menus.delete(player);if(menu.inv)decline(menu.inv);}
  const result=results.get(player);if(result&&interfaceId===Screen.group(result.game))results.delete(player);
}
function opened({player,groupId,targetUid}) {
  Spectator.opened({player,groupId,targetUid});
  if(targetUid!==core.CacheDefinitions.getComponentId('toplevel_osrs_stretch:mainmodal'))return;
  const match=matches.get(player);
  if(match&&groupId!==Screen.group(match.game))finish(match,1-match.players.indexOf(player),'Game replaced.',{departing:player,returnDeparting:true});
  const menu=menus.get(player);
  if(menu&&groupId!==(menu.stage==='selection'?core.CacheDefinitions.getInterfaceId('boardgames_challenge'):Screen.optionsGroup(menu.game))) {
    menus.delete(player);if(menu.inv)decline(menu.inv);
  }
}
function logout({player}) {leave(player);}
function bootstrap({player}) {
  for(const game of Object.keys(GAMES))player.getPacketSender().sendConfig(core.CacheDefinitions.getVarpId(`boardgames_${game}_rank`),rank(player,game));
}
function processPlayer(player) {
  Spectator.process(player);
  if(!player.isPlayer())return;
  RuneSquares.roomOverlay(player,Access.roomGame(player.getLocation())==='runesquares'&&!matches.has(player));
  for(const list of invitations.values())for(const inv of [...list.values()])if((inv.from===player||inv.to===player)&&!pairValid(inv.from,inv.to))removeInvitation(inv);
  const match=matches.get(player);if(!match)return;
  const departed=invalidSides(match);
  if(departed.length)return finish(match,departed.length===1?1-departed[0]:null,'Player left the game.');
  Seating.process(match,player,now());
  if(match.players[match.state.turn]===player&&now()>=match.deadline) {
    // Runeversi uses the existing legal random auto-move policy too. The cache
    // establishes its clock choices, but its timeout policy is not captured.
    const auto=Rules.chooseAutoMove(match.state);if(auto)move(player,match,auto);
  }
}
function shutdown() {
  for(const match of new Set(matches.values()))finish(match,null,'Server shutdown.');
  Spectator.shutdown();invitations.clear();menus.clear();results.clear();
}
function matchAt(object) {
  return [...new Set(matches.values())].find(match=>GAMES[match.game].spectatable&&!match.finished&&match.allocation.playingTable===object);
}
function prepareViewer(player) { cancelInvitations(player);menus.delete(player);results.delete(player); }
function attach(pluginApi) {
  api=pluginApi;core=api.core;Screen.configure(core);Tables.configure(core);Seating.configure(core);RuneSquares.configure(core);
  Access.attach(api,{rank});
  Spectator.attach(api,{available,matchAt,prepare:prepareViewer});
  class GamesRoomArea extends core.Area {
    postEnter(p) {if(p.isPlayer()){Access.enforce(p);p.getPacketSender().sendPlayerOption(4,'Challenge',false);}}
    postLeave(p) {if(p.isPlayer()){leave(p);p.getPacketSender().sendPlayerOption(4,'null',false);}}
    process(p) {if(!p.isPlayer()||!Access.enforce(p))processPlayer(p);}
  }
  // Reference region34,77, confirmed against the active Games Room map.
  area=new GamesRoomArea([new core.Boundary(2176,2239,4928,4991,0),new core.Boundary(2176,2239,4928,4991,1)]);
  for(const attribute of Object.values(RANK_ATTRIBUTES))api.persistAttribute(attribute,1000);
  api.persistAttribute(SETTINGS_ATTRIBUTE,{piece:1,seconds:30,ranked:true});
  api.registerArea(area);api.onPlayerOption(playerOption);api.onCustomEvent('player:option-route',route);api.onInterfaceActionClick(click);
  api.onPlayerLogout(logout);api.onCustomEvent('interface:closed',closed);api.onCustomEvent('interface:opened',opened);api.onCustomEvent('player:bootstrap-complete',bootstrap);
  api.onServerShutdown(shutdown);
}
module.exports={attach,invitation,matchOf:p=>matches.get(p),leave,areaOf:()=>area};
