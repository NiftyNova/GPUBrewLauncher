#version 450
#extension GL_GOOGLE_include_directive : require
layout(location=0) out vec4 outColor;

#define STATE_ACCESS readonly
#include "abi.glsl"

layout(set=0, binding=1, std430) readonly buffer PrivateMemory { uint words[]; } memory;

const uint VIC_BASE_  = 0x19400u;
const uint FB_FRONT_  = 0x20000u;
const uint META_BASE_ = 0x19540u;

// Pepto's commonly used C64 palette.
const vec3 PALETTE[16] = vec3[16](
    vec3(0.000, 0.000, 0.000), // 0 black
    vec3(1.000, 1.000, 1.000), // 1 white
    vec3(0.408, 0.216, 0.169), // 2 red
    vec3(0.439, 0.643, 0.698), // 3 cyan
    vec3(0.435, 0.239, 0.525), // 4 purple
    vec3(0.345, 0.553, 0.263), // 5 green
    vec3(0.208, 0.157, 0.475), // 6 blue
    vec3(0.722, 0.780, 0.435), // 7 yellow
    vec3(0.435, 0.310, 0.145), // 8 orange
    vec3(0.263, 0.224, 0.000), // 9 brown
    vec3(0.604, 0.404, 0.349), // 10 light red
    vec3(0.267, 0.267, 0.267), // 11 dark grey
    vec3(0.424, 0.424, 0.424), // 12 grey
    vec3(0.604, 0.824, 0.518), // 13 light green
    vec3(0.424, 0.369, 0.710), // 14 light blue
    vec3(0.584, 0.584, 0.584)  // 15 light grey
);

void main() {
    vec2 p = gl_FragCoord.xy;
    vec3 color = vec3(0.008, 0.009, 0.014);

    uint borderIndex = memory.words[VIC_BASE_ + 0x20u] & 0x0Fu;
    vec3 border = PALETTE[borderIndex];
    vec3 background = PALETTE[memory.words[VIC_BASE_ + 0x21u] & 0x0Fu];

    // 1600x1000 monitor area: a 1280x800 C64 display surrounded by the
    // VIC-II border colour.
    bool monitor = p.x >= 160.0 && p.x < 1760.0 && p.y >= 40.0 && p.y < 1040.0;
    if (monitor) color = border;

    // 4x nearest-neighbour C64 display.
    vec2 q = (p - vec2(320.0, 140.0)) * 0.25;
    if (q.x >= 0.0 && q.x < 320.0 && q.y >= 0.0 && q.y < 200.0) {
        uint x = uint(q.x);
        uint y = uint(q.y);
        uint pixel = memory.words[FB_FRONT_ + y * 320u + x] & 0x0Fu;
        color = PALETTE[pixel];
        // Gentle CRT scanlines: one darker line for every C64 pixel row.
        float scan = mod(floor(p.y), 4.0) < 1.0 ? 0.86 : 1.0;
        color *= scan;
        // Slight glass shading, strongest towards the outer edge.
        vec2 n = (q / vec2(320.0, 200.0)) * 2.0 - 1.0;
        color *= 1.0 - 0.045 * dot(n, n);
    } else if (monitor) {
        // A faint vignette on the plastic/bezel area.
        float d = length((p - vec2(960.0, 540.0)) / vec2(880.0, 560.0));
        color *= 1.0 - 0.08 * clamp(d, 0.0, 1.0);
    }

    // Double border if the loader failed, so a bad package is obvious.
    if (memory.words[META_BASE_ + 7u] != 0u) {
        float pulse = 0.5 + 0.5 * sin(c.motion.x * 8.0);
        if (monitor && (p.x < 180.0 || p.x >= 1740.0 || p.y < 60.0 || p.y >= 1020.0))
            color = mix(color, vec3(0.75, 0.05, 0.04), 0.35 + 0.35 * pulse);
    }

    outColor = vec4(color * (1.0 - c.transition.x), 1.0);
}
