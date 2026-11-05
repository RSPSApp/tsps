import java.nio.file.*;
import java.nio.ByteBuffer;
import java.security.MessageDigest;
import java.util.*;
import com.google.gson.*;
import net.rsprox.proxy.binary.BinaryBlob;
import net.rsprox.proxy.filters.DefaultPropertyFilterSetStore;
import net.rsprox.proxy.settings.DefaultSettingSetStore;
import net.rsprox.proxy.cache.*;
import net.rsprox.proxy.plugin.*;
import net.rsprox.proxy.huffman.HuffmanProvider;
import net.rsprox.cache.Js5MasterIndex;
import net.rsprox.cache.resolver.HistoricCacheResolver;

/** Sanitized sparse scene palettes from https://rsprox.net/download/1693.
 * Run with the JDK required by the installed RSProx1.0.5 launcher jars on the classpath.
 * Input is the decompressed recording. No player/account data is exported.
 */
class ExtractTempleOfTheEyeScenes {
  static final String SHA256 = "4c73333dd216fc72d43b682c487d2c0e14d61902fd7f13bd4e13606640d58d19";
  static final Set<Integer> TEMPLE = Set.of(4468,4544,4583,4656,8812);
  static final Set<Integer> TUTORIAL = Set.of(4865,8444,8569,8786);
  record Cell(int plane,int x,int y) implements Comparable<Cell> {
    public int compareTo(Cell o) {
      int p=Integer.compare(plane,o.plane);if(p!=0)return p;
      int a=Integer.compare(x,o.x);return a!=0?a:Integer.compare(y,o.y);
    }
  }
  record View(int tick,String kind,int x,int y,int dx,int dy,int[][][] palette) {}
  static String digest(byte[] bytes) throws Exception {
    return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
  }
  static String paletteHash(int[][][] grid) throws Exception {
    var bytes=ByteBuffer.allocate(4*13*13*4);
    for(var plane:grid)for(var column:plane)for(int value:column)bytes.putInt(value);
    return digest(bytes.array());
  }
  public static void main(String[] args) throws Exception {
    if(args.length!=2)throw new IllegalArgumentException("Expected decompressed-1693.bin templates.json");
    byte[] input=Files.readAllBytes(Path.of(args[0]));
    String sha=digest(input);
    if(!SHA256.equals(sha))throw new IllegalArgumentException("Wrong recording1693 input: "+sha);
    var home=Path.of(System.getProperty("user.home"),".rsprox");
    var binary=BinaryBlob.Companion.decode(input,
      DefaultPropertyFilterSetStore.Companion.load(home.resolve("filters")),
      DefaultSettingSetStore.Companion.load(home.resolve("settings")));
    HuffmanProvider.INSTANCE.load();
    var provider=new StatefulCacheProvider(new CachedCaches(new HistoricCacheResolver()));
    provider.update(Js5MasterIndex.Companion.trimmed(binary.getHeader().getRevision(),binary.getHeader().getJs5MasterIndex()));
    var loader=new DecoderLoader();loader.load(provider,null);
    var packets=new DecodingSession(binary,loader.getDecoder(binary.getHeader().getRevision(),provider)).sequence(null).iterator();
    var scenes=new LinkedHashMap<String,TreeMap<Cell,Integer>>();
    scenes.put("temple",new TreeMap<>());scenes.put("tutorial",new TreeMap<>());
    var views=new ArrayList<View>();int tick=0;
    while(packets.hasNext()) {
      var packet=packets.next();String prot=packet.getProt().toString();
      if(prot.equals("SERVER_TICK_END")){tick++;continue;}
      if(!prot.equals("REBUILD_REGION")||(!TEMPLE.contains(tick)&&!TUTORIAL.contains(tick)))continue;
      String kind=TEMPLE.contains(tick)?"temple":"tutorial";
      var message=packet.getMessage();var area=message.getClass().getMethod("getBuildArea").invoke(message);
      int[][][] grid=null;
      for(var field:area.getClass().getDeclaredFields())if(field.getType()==int[][][].class){
        field.setAccessible(true);grid=(int[][][])field.get(area);
      }
      if(grid==null||grid.length!=4)throw new IllegalStateException("Missing four-plane palette");
      int anchorX=kind.equals("temple")?299:307,anchorY=kind.equals("temple")?703:711;
      int ax=-1,ay=-1;
      for(int x=0;x<13;x++)for(int y=0;y<13;y++) {
        int v=grid[2][x][y];
        if(v!=-1&&((v>>>14)&1023)==anchorX&&((v>>>3)&2047)==anchorY){
          if(ax!=-1)throw new IllegalStateException("Ambiguous source anchor");ax=x;ay=y;
        }
      }
      if(ax<0)throw new IllegalStateException("Missing scene source anchor at "+tick);
      // This landmark is local6,3 in both coherent scenes; view windows move around it.
      int dx=6-ax,dy=3-ay;var scene=scenes.get(kind);
      for(int p=0;p<4;p++)for(int x=0;x<13;x++)for(int y=0;y<13;y++) {
        int v=grid[p][x][y];if(v==-1)continue;
        if(((v>>>1)&3)!=0)throw new IllegalStateException("Unexpected rotated chunk");
        var key=new Cell(p,x+dx,y+dy);var previous=scene.putIfAbsent(key,v);
        if(previous!=null&&previous!=v)throw new IllegalStateException("Conflicting scene chunk at "+tick+" "+key);
      }
      views.add(new View(tick,kind,(int)message.getClass().getMethod("getZoneX").invoke(message),
        (int)message.getClass().getMethod("getZoneZ").invoke(message),dx,dy,grid));
    }
    if(views.size()!=TEMPLE.size()+TUTORIAL.size())throw new IllegalStateException("Missing/duplicate rebuild");
    // A union must preserve every recorded hole, not merely every occupied source cell.
    for(var view:views)for(int p=0;p<4;p++)for(int x=0;x<13;x++)for(int y=0;y<13;y++)
      if(scenes.get(view.kind).getOrDefault(new Cell(p,x+view.dx,y+view.dy),-1)!=view.palette[p][x][y])
        throw new IllegalStateException("Union fills a recorded hole at "+view.tick);
    var out=new StringBuilder("{\n  \"capture\":1693,\n  \"source\":\"https://rsprox.net/download/1693\",\n  \"sha256\":\""+sha+"\",\n  \"scenes\":{\n");
    int count=0;
    for(var entry:scenes.entrySet()) {
      String kind=entry.getKey();var cells=entry.getValue();
      int width=cells.keySet().stream().mapToInt(Cell::x).max().orElseThrow()+1;
      int height=cells.keySet().stream().mapToInt(Cell::y).max().orElseThrow()+1;
      int sourceX=kind.equals("temple")?2344:2408,sourceY=kind.equals("temple")?5600:5664;
      out.append("    \"").append(kind).append("\":{\"x\":").append(sourceX).append(",\"y\":").append(sourceY)
        .append(",\"widthChunks\":").append(width).append(",\"heightChunks\":").append(height).append(",\"chunks\":[\n");
      int i=0;for(var cell:cells.entrySet()) {
        var k=cell.getKey();int v=cell.getValue();
        out.append("      ").append(Arrays.toString(new int[]{k.plane,k.x,k.y,(v>>>14)&1023,(v>>>3)&2047,(v>>>24)&3,(v>>>1)&3}))
          .append(++i==cells.size()?"\n":",\n");
      }
      out.append("    ]}").append(++count==scenes.size()?"\n":",\n");
    }
    out.append("  },\n  \"views\":[\n");
    for(int i=0;i<views.size();i++) {
      var v=views.get(i);out.append("    {\"tick\":").append(v.tick).append(",\"kind\":\"").append(v.kind)
        .append("\",\"center\":[").append(v.x).append(',').append(v.y).append("],\"offset\":[").append(v.dx).append(',').append(v.dy)
        .append("],\"paletteSha256\":\"").append(paletteHash(v.palette)).append("\"}").append(i+1==views.size()?"\n":",\n");
    }
    out.append("  ]\n}\n");Files.writeString(Path.of(args[1]),out.toString());
    System.out.println("Exported "+views.size()+" exact sparse views; input sha256 "+sha);
  }
}
