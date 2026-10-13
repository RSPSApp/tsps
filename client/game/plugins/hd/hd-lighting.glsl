// Non-water lighting adapted from elvarg-web-client/draw/hdShaders.ts (117HD).
// See public/images/water/LICENSE-117HD.txt.
in vec3 v_hdPosition;
in vec3 v_hdNormal;
flat in uint v_hdGroundMaterial;
flat in float v_hdTerrain;
uniform bool u_hdEnabled;
uniform bool u_hdShadowPass;
uniform vec3 u_hdLightDirection;
uniform vec3 u_hdAmbient;
uniform vec3 u_hdDirectional;
uniform vec3 u_hdFogColor;
uniform vec3 u_hdFog; // start, fully obscured distance in tiles, curve exponent
uniform vec3 u_hdGroundFog;
uniform vec4 u_hdGrading; // saturation, contrast, brightness, rim
uniform float u_hdSpecular;
uniform mat4 u_hdShadowMatrix;
uniform sampler2D u_hdShadowMap;
uniform highp sampler2D u_hdMaterials;
uniform highp sampler2DArray u_hdTextures;
uniform highp sampler2DArray u_hdDetailTextures;
uniform float u_hdShadowStrength;
uniform int u_hdLightCount;
uniform vec4 u_hdLightPositions[16];
uniform vec4 u_hdLightColors[16];
uniform vec4 u_hdMist; // mist level (tiles, y down), strength, wind x, wind z (HdMist.ts)

vec3 hdSaturation(vec3 color, float amount) {
    return mix(vec3(dot(color, vec3(0.299, 0.587, 0.114))), color, amount);
}

float hdFogAmount(vec2 position) {
    vec2 delta = abs(position - u_playerPos);
    float squareDist = max(delta.x, delta.y);
    return pow(smoothstep(u_hdFog.x, u_hdFog.y, squareDist), u_hdFog.z);
}

float hdMistHash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float hdMistNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hdMistHash(i), hdMistHash(i + vec2(1.0, 0.0)), f.x),
        mix(hdMistHash(i + vec2(0.0, 1.0)), hdMistHash(i + vec2(1.0, 1.0)), f.x), f.y);
}

// Low-lying mist: pools below the surrounding land's average height (u_hdMist.x, y grows
// downwards) and thickens with how far the view travels through it, so the ground nearby stays
// readable while a valley fills; drifts in banks with the wind. Mirrors hdMistWgsl.
float hdMistAmount(vec3 position) {
    if (u_hdMist.y <= 0.0) return 0.0;
    float low = smoothstep(u_hdMist.x - 1.0, u_hdMist.x + 2.0, position.y);
    float depth = 1.0 - exp(-length(position.xz - u_cameraPos) * 0.07);
    vec2 drift = position.xz * 0.07 + u_hdMist.zw * u_currentTime;
    float banks = hdMistNoise(drift) * 0.65 + hdMistNoise(drift * 2.3 + 17.0) * 0.35;
    // Clear around the player: none within 4 tiles, full by 14 (mirrored in hd-lighting.wgsl.ts).
    float clear = smoothstep(4.0, 14.0, length(position.xz - u_playerPos));
    return clamp(low * depth * clear * mix(0.4, 1.0, banks) * u_hdMist.y, 0.0, 1.0);
}

float hdShadow(vec3 position, vec3 normal) {
    vec4 projected = u_hdShadowMatrix * vec4(position, 1.0);
    vec3 p = projected.xyz / projected.w * 0.5 + 0.5;
    if (u_hdShadowStrength == 0.0 || any(lessThan(p, vec3(0.0))) || any(greaterThan(p, vec3(1.0)))) return 1.0;
    float bias = max(0.0006 * (1.0 - max(dot(normal, u_hdLightDirection), 0.0)), 0.00018);
    vec2 texel = 1.0 / vec2(textureSize(u_hdShadowMap, 0));
    float shadow = 0.0;
    for (int x = -1; x <= 1; x++) {
        for (int y = -1; y <= 1; y++) {
            shadow += p.z - bias > texture(u_hdShadowMap, p.xy + vec2(x, y) * texel).r ? 1.0 : 0.0;
        }
    }
    float edge = min(min(p.x, 1.0 - p.x), min(p.y, 1.0 - p.y));
    return 1.0 - shadow / 9.0 * u_hdShadowStrength * smoothstep(0.0, 0.05, edge);
}

vec3 hdMappedNormal(vec3 normal, vec2 uv, float layer, vec3 dx, vec3 dy, vec2 ux, vec2 uy) {
    float determinant = ux.x * uy.y - ux.y * uy.x;
    if (abs(determinant) < 1e-8) return normal;
    vec3 tangent = (dx * uy.y - dy * ux.y) / determinant;
    vec3 bitangent = (dy * ux.x - dx * uy.x) / determinant;
    tangent -= normal * dot(normal, tangent);
    bitangent -= normal * dot(normal, bitangent);
    if (min(dot(tangent, tangent), dot(bitangent, bitangent)) < 1e-10) return normal;
    // 117 HD maps encode signed tangent X/Y, with an unsigned normal Z.
    vec3 detail = textureGrad(u_hdTextures, vec3(uv, layer), ux, uy).xyz;
    detail.xy = detail.xy * 2.0 - 1.0;
    return normalize(normalize(tangent) * detail.x + normalize(bitangent) * detail.y + normal * detail.z);
}

vec3 hdShade(vec3 surface, vec3 position, vec4 material, vec4 metadata, vec2 uv) {
    if ((int(metadata.y) & 4) != 0) return pow(pow(max(surface, vec3(0.0)), vec3(2.2)) * 6.0, vec3(1.0 / 2.2));
    if ((int(metadata.y) & 1) != 0) return surface;
    // Architecture/effects use face normals; actors and terrain interpolate
    // their own vertex normals to avoid visible triangle seams.
    vec3 dx = dFdx(position), dy = dFdy(position);
    // Derivatives stay outside the distance branch, including quads that cross
    // the detail boundary. Explicit gradients keep normal-map mip selection stable.
    vec2 ux = dFdx(uv), uy = dFdy(uv);
    vec3 faceNormal = cross(dx, dy);
    faceNormal *= inversesqrt(max(dot(faceNormal, faceNormal), 1e-12));
    vec3 camera = -(u_viewMatrix[3].xyz * mat3(u_viewMatrix));
    vec3 viewDir = normalize(camera - position);
    if (dot(faceNormal, viewDir) < 0.0) faceNormal = -faceNormal;
    vec3 normal = faceNormal;
    if (dot(v_hdNormal, v_hdNormal) > 1e-8) {
        normal = normalize(v_hdNormal);
        // A smooth normal may point past the camera at a visible silhouette.
        // Flipping there makes lighting jump; orient using triangle facing.
        if (!gl_FrontFacing) normal = -normal;
    }
    vec2 offset = abs(position.xz - u_playerPos);
    float detail = 1.0 - smoothstep(24.0, 48.0, max(offset.x, offset.y));
    float shadow = detail > 0.0 ? mix(1.0, hdShadow(position, faceNormal), detail) : 1.0;
    if (detail > 0.0 && metadata.x != 0.0 && metadata.z > 0.0)
        normal = normalize(mix(normal, hdMappedNormal(normal, uv, metadata.z, dx, dy, ux, uy), detail));
    vec3 base = pow(max(surface, vec3(0.0)), vec3(2.2));
    float diffuse = max(dot(normal, u_hdLightDirection), 0.0);
    if (detail <= 0.0) {
        // Distant scenery uses one albedo sample and ambient/sun lighting only.
        vec3 color = base * (u_hdAmbient + u_hdDirectional * diffuse);
        color = hdSaturation(color, u_hdGrading.x);
        color = (color - 0.5) * u_hdGrading.y + 0.5;
        return pow(max(color * u_hdGrading.z, vec3(0.0)), vec3(1.0 / 2.2));
    }
    vec3 pointLight = vec3(0.0);
    for (int i = 0; i < 16; i++) {
        if (i >= u_hdLightCount) break;
        vec3 delta = u_hdLightPositions[i].xyz - position;
        float radius = u_hdLightPositions[i].w;
        float distanceSquared = dot(delta, delta);
        // Most fragments lie outside each local light's radius.
        if (distanceSquared >= radius * radius) continue;
        float distance = max(sqrt(distanceSquared), 0.001);
        float attenuation = max(1.0 - distance / radius, 0.0);
        pointLight += u_hdLightColors[i].rgb * u_hdLightColors[i].w * attenuation * attenuation * max(dot(normal, delta / distance), 0.0);
    }
    pointLight *= 1.1 * detail;
    float baseLuma = dot(base, vec3(0.2126, 0.7152, 0.0722));
    float additiveFloor = mix(0.035, 0.085, smoothstep(0.10, 0.45, baseLuma));
    vec3 color = base * (u_hdAmbient + u_hdDirectional * diffuse * shadow + pointLight) + pointLight * additiveFloor;
    // Upstream gloss is a Phong exponent. A half-vector here spreads the
    // highlight across roofs and terrain, making dry materials look wet.
    if (material.x > 0.0 && diffuse > 0.0) {
        vec3 reflected = reflect(-u_hdLightDirection, normal);
        float specular = pow(max(dot(viewDir, reflected), 0.0), max(material.y, 1.0));
        color += u_hdDirectional * specular * material.x * u_hdSpecular * shadow * detail;
    }
    color += vec3(pow(1.0 - max(dot(normal, viewDir), 0.0), 2.0) * u_hdGrading.w);
    color = hdSaturation(color, u_hdGrading.x);
    color = (color - 0.5) * u_hdGrading.y + 0.5;
    return pow(max(color * u_hdGrading.z, vec3(0.0)), vec3(1.0 / 2.2));
}
