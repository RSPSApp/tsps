package net.tsps.loginutilities;

import java.io.*;
import java.lang.reflect.*;
import java.util.*;
import org.objectweb.asm.*;
import org.objectweb.asm.tree.*;

/**
 * Resolves semantic wrappers in the installed injected client; no revision-specific field names.
 * Unknown layouts fail closed rather than inspecting arbitrary client strings.
 */
final class NativeAccess {
  private final Object client;
  private final ClassLoader loader;
  private Method accessSetter, refreshSetter;
  private Field passwordField;
  private Field oneTimeTokenField;
  private Field authBaseField;
  private String originalAuthBase;
  private Method passwordGetter;

  NativeAccess(Object client) throws Exception {
    this.client = client;
    loader = client.getClass().getClassLoader();
    ClassNode node = read(client.getClass());
    Set<String> tokenFields = new HashSet<>();
    for (MethodNode candidate : node.methods) {
      List<AbstractInsnNode> instructions = code(candidate);
      for (int i = 0; i + 1 < instructions.size(); i++)
        if (instructions.get(i) instanceof MethodInsnNode
            && instructions.get(i + 1) instanceof FieldInsnNode) {
          MethodInsnNode call = (MethodInsnNode) instructions.get(i);
          FieldInsnNode field = (FieldInsnNode) instructions.get(i + 1);
          if (call.owner.equals("com/jagex/oldscape/pub/OtlTokenResponse")
              && call.name.equals("getToken")
              && field.getOpcode() == Opcodes.PUTFIELD
              && field.owner.equals(node.name)
              && field.desc.equals("Ljava/lang/String;")) tokenFields.add(field.name);
        }
    }
    if (tokenFields.size() != 1) throw new IOException("Unsupported native one-time token layout");
    oneTimeTokenField = client.getClass().getDeclaredField(tokenFields.iterator().next());
    oneTimeTokenField.setAccessible(true);
    accessSetter = environmentSetter(node, "JX_ACCESS_TOKEN");
    refreshSetter = environmentSetter(node, "JX_REFRESH_TOKEN");
    Set<String> authFields = new HashSet<>();
    for (MethodNode candidate : node.methods) {
      List<AbstractInsnNode> instructions = code(candidate);
      for (int i = 0; i < instructions.size(); i++)
        if (instructions.get(i) instanceof LdcInsnNode
            && "shield/oauth/token".equals(((LdcInsnNode) instructions.get(i)).cst)) {
          for (int j = i - 1; j >= Math.max(0, i - 5); j--)
            if (instructions.get(j) instanceof FieldInsnNode) {
              FieldInsnNode field = (FieldInsnNode) instructions.get(j);
              if (field.getOpcode() == Opcodes.GETSTATIC && field.desc.equals("Ljava/lang/String;"))
                authFields.add(field.owner + "/" + field.name);
            }
        }
    }
    if (authFields.size() != 1) throw new IOException("Unsupported native auth URL layout");
    String auth = authFields.iterator().next();
    int slash = auth.lastIndexOf('/');
    authBaseField =
        Class.forName(auth.substring(0, slash).replace('/', '.'), false, loader)
            .getDeclaredField(auth.substring(slash + 1));
    authBaseField.setAccessible(true);
    originalAuthBase = (String) authBaseField.get(null);
    MethodNode password = method(node, "setPassword", "(Ljava/lang/String;)V");
    List<AbstractInsnNode> instructions = code(password);
    if (instructions.size() != 3
        || instructions.get(0).getOpcode() != Opcodes.ALOAD
        || !(instructions.get(1) instanceof MethodInsnNode))
      throw new IOException("Unsupported native password wrapper");
    MethodInsnNode target = (MethodInsnNode) instructions.get(1);
    Class<?> owner = Class.forName(target.owner.replace('/', '.'), false, loader);
    List<AbstractInsnNode> setter = code(method(read(owner), target.name, target.desc));
    if (setter.size() == 3 && setter.get(1).getOpcode() == Opcodes.PUTSTATIC) {
      FieldInsnNode field = (FieldInsnNode) setter.get(1);
      passwordField =
          Class.forName(field.owner.replace('/', '.'), false, loader).getDeclaredField(field.name);
      if (passwordField.getType() != String.class)
        throw new IOException("Unsupported password field");
      passwordField.setAccessible(true);
    } else if (setter.size() == 5
        && setter.get(0) instanceof LdcInsnNode
        && setter.get(1).getOpcode() == Opcodes.ICONST_0
        && setter.get(2).getOpcode() == Opcodes.ALOAD
        && setter.get(3).getOpcode() == Opcodes.AASTORE
        && setter.get(4).getOpcode() == Opcodes.RETURN) {
      Object value = ((LdcInsnNode) setter.get(0)).cst;
      if (!(value instanceof ConstantDynamic))
        throw new IOException("Unsupported native password storage");
      for (MethodNode candidate : read(owner).methods) {
        List<AbstractInsnNode> getter = code(candidate);
        if (candidate.desc.equals("()Ljava/lang/String;")
            && getter.size() == 4
            && getter.get(0) instanceof LdcInsnNode
            && value.equals(((LdcInsnNode) getter.get(0)).cst)
            && getter.get(1).getOpcode() == Opcodes.ICONST_0
            && getter.get(2).getOpcode() == Opcodes.AALOAD
            && getter.get(3).getOpcode() == Opcodes.ARETURN) {
          if (passwordGetter != null) throw new IOException("Ambiguous native password getter");
          passwordGetter = owner.getDeclaredMethod(candidate.name);
          passwordGetter.setAccessible(true);
        }
      }
      if (passwordGetter == null) throw new IOException("Native password getter unavailable");
    } else throw new IOException("Unsupported native password layout");
  }

  String password() throws Exception {
    return passwordGetter != null
        ? (String) passwordGetter.invoke(null)
        : (String) passwordField.get(null);
  }

  void clearOneTimeToken() throws Exception {
    oneTimeTokenField.set(client, null);
  }

  void tokenMode(boolean enabled, String authBase) throws Exception {
    // These are routing placeholders, never the account's persistent TSPS token.
    authBaseField.set(null, enabled ? authBase : originalAuthBase);
    accessSetter.invoke(null, enabled ? "tsps-native-access" : null);
    refreshSetter.invoke(null, enabled ? "tsps-native-refresh" : null);
  }

  void clearRequesters() throws Exception {
    for (String name :
        new String[] {
          "com.jagex.oldscape.pub.OtlTokenRequester",
          "com.jagex.oldscape.pub.RefreshAccessTokenRequester"
        }) {
      Class<?> type = Class.forName(name, false, loader);
      List<Field> candidates = new ArrayList<>();
      for (Field field : client.getClass().getDeclaredFields())
        if (field.getType() == type) candidates.add(field);
      if (candidates.size() != 1) throw new IOException("Unsupported native requester layout");
      candidates.get(0).setAccessible(true);
      candidates.get(0).set(client, null);
    }
  }

  private Method environmentSetter(ClassNode node, String key) throws Exception {
    Set<String> candidates = new HashSet<>();
    for (MethodNode method : node.methods) {
      List<AbstractInsnNode> instructions = code(method);
      for (int i = 0; i + 2 < instructions.size(); i++)
        if (instructions.get(i) instanceof LdcInsnNode
            && key.equals(((LdcInsnNode) instructions.get(i)).cst)
            && instructions.get(i + 1) instanceof MethodInsnNode
            && instructions.get(i + 2) instanceof MethodInsnNode) {
          MethodInsnNode read = (MethodInsnNode) instructions.get(i + 1),
              write = (MethodInsnNode) instructions.get(i + 2);
          if (read.desc.equals("(Ljava/lang/String;)Ljava/lang/String;")
              && write.getOpcode() == Opcodes.INVOKESTATIC
              && write.desc.equals("(Ljava/lang/String;)V")
              && write.owner.equals(node.name)) candidates.add(write.name);
        }
    }
    if (candidates.size() != 1) throw new IOException("Unsupported native token initialization");
    Method result = client.getClass().getDeclaredMethod(candidates.iterator().next(), String.class);
    result.setAccessible(true);
    return result;
  }

  private ClassNode read(Class<?> type) throws IOException {
    try (InputStream input =
        type.getResourceAsStream("/" + type.getName().replace('.', '/') + ".class")) {
      if (input == null) throw new IOException("Native client bytecode unavailable");
      ClassNode node = new ClassNode();
      new ClassReader(input).accept(node, ClassReader.SKIP_DEBUG | ClassReader.SKIP_FRAMES);
      return node;
    }
  }

  private MethodNode method(ClassNode owner, String name, String descriptor) throws IOException {
    for (MethodNode method : owner.methods)
      if (method.name.equals(name) && method.desc.equals(descriptor)) return method;
    throw new IOException("Native method unavailable");
  }

  private static List<AbstractInsnNode> code(MethodNode method) {
    List<AbstractInsnNode> result = new ArrayList<>();
    for (AbstractInsnNode instruction : method.instructions)
      if (instruction.getOpcode() >= 0) result.add(instruction);
    return result;
  }
}
