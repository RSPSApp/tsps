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
uniform vec3 u_hdFog; // depth, scale, draw distance in tiles
uniform vec3 u_hdGroundFog;
uniform vec4 u_hdGrading; // saturation, contrast, brightness, rim
uniform float u_hdSpecular;
uniform mat4 u_hdShadowMatrix;
uniform sampler2D u_hdShadowMap;
uniform highp sampler2D u_hdMaterials;
uniform highp sampler2DArray u_hdTextures;
uniform float u_hdShadowStrength;
uniform int u_hdLightCount;
uniform vec4 u_hdLightPositions[16];
uniform vec4 u_hdLightColors[16];

vec3 hdSaturation(vec3 color, float amount) {
    return mix(vec3(dot(color, vec3(0.299, 0.587, 0.114))), color, amount);
}

float hdFogAmount(vec2 position) {
    float depth = clamp(u_hdFog.x / 5.0, 0.0, 1.0);
    if (depth <= 0.0002) return 0.0;
    float scale = clamp(u_hdFog.y, 0.0, 16.0);
    float distance = u_hdFog.z;
    vec2 delta = abs(position - u_playerPos);
    float squareDist = max(delta.x, delta.y);
    float reach = clamp((scale - 1.0) / 15.0, 0.0, 1.0);
    float rimWidth = max(8.0, distance * 0.18) * mix(1.0, 3.0, reach);
    float rim = pow(smoothstep(distance - rimWidth, distance, squareDist), mix(0.72, 0.42, depth));
    float wallBand = max(3.0, distance * 0.06) * mix(1.0, 2.0, reach);
    float wall = 1.0 - smoothstep(0.0, wallBand, distance - squareDist);
    float nearAttenuation = smoothstep(0.0, distance * mix(0.18, 0.34, reach), squareDist);
    return clamp((rim * (1.0 + 0.55 * depth) + wall * (0.9 + 0.5 * depth)) * scale * pow(depth, 0.55) * 1.25 * nearAttenuation, 0.0, 1.0);
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

vec3 hdMappedNormal(vec3 position, vec3 normal, vec2 uv, float layer) {
    vec3 dx = dFdx(position), dy = dFdy(position);
    vec2 ux = dFdx(uv), uy = dFdy(uv);
    float determinant = ux.x * uy.y - ux.y * uy.x;
    if (abs(determinant) < 1e-8) return normal;
    vec3 tangent = (dx * uy.y - dy * ux.y) / determinant;
    vec3 bitangent = (dy * ux.x - dx * uy.x) / determinant;
    tangent -= normal * dot(normal, tangent);
    bitangent -= normal * dot(normal, bitangent);
    if (min(dot(tangent, tangent), dot(bitangent, bitangent)) < 1e-10) return normal;
    // 117 HD maps encode signed tangent X/Y, with an unsigned normal Z.
    vec3 detail = texture(u_hdTextures, vec3(uv, layer)).xyz;
    detail.xy = detail.xy * 2.0 - 1.0;
    return normalize(normalize(tangent) * detail.x + normalize(bitangent) * detail.y + normal * detail.z);
}

vec3 hdShade(vec3 surface, vec3 position, vec4 material, vec4 metadata, vec2 uv) {
    if (metadata.y > 0.5) return surface;
    // Architecture/effects use face normals; actors and terrain interpolate
    // their own vertex normals to avoid visible triangle seams.
    vec3 faceNormal = cross(dFdx(position), dFdy(position));
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
    float shadow = hdShadow(position, faceNormal);
    if (metadata.x > 0.0 && metadata.z > 0.0) normal = hdMappedNormal(position, normal, uv, metadata.z);
    vec3 base = pow(max(surface, vec3(0.0)), vec3(2.2));
    float diffuse = max(dot(normal, u_hdLightDirection), 0.0);
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
    pointLight *= 1.1;
    float baseLuma = dot(base, vec3(0.2126, 0.7152, 0.0722));
    float additiveFloor = mix(0.035, 0.085, smoothstep(0.10, 0.45, baseLuma));
    vec3 color = base * (u_hdAmbient + u_hdDirectional * diffuse * shadow + pointLight) + pointLight * additiveFloor;
    // Upstream gloss is a Phong exponent. A half-vector here spreads the
    // highlight across roofs and terrain, making dry materials look wet.
    if (material.x > 0.0 && diffuse > 0.0) {
        vec3 reflected = reflect(-u_hdLightDirection, normal);
        float specular = pow(max(dot(viewDir, reflected), 0.0), max(material.y, 1.0));
        color += u_hdDirectional * specular * material.x * u_hdSpecular * shadow;
    }
    color += vec3(pow(1.0 - max(dot(normal, viewDir), 0.0), 2.0) * u_hdGrading.w);
    color = hdSaturation(color, u_hdGrading.x);
    color = (color - 0.5) * u_hdGrading.y + 0.5;
    return pow(max(color * u_hdGrading.z, vec3(0.0)), vec3(1.0 / 2.2));
}
