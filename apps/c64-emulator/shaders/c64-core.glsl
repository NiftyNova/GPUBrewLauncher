// C64 core for the HBLauncher GPU app.
//
// The C64 is emulated inside one compute-shader invocation per display
// frame. Private GPU storage (set 0, binding 1) is the machine's memory:
// every C64 byte is stored in one uint word. This is deliberately simple:
// a one-word-per-byte layout needs no bit packing in the 6502 hot path.
//
// Layout (word indices):
//   0x00000 64 KiB C64 RAM
//   0x10000 BASIC ROM (8 KiB)
//   0x12000 KERNAL ROM (8 KiB)
//   0x14000 character ROM (4 KiB)
//   0x15000 cartridge ROM (16 KiB, zero padded)
//   0x19000 colour RAM (1 KiB)
//   0x19400 VIC-II registers
//   0x19440 CIA #1
//   0x19460 CIA #2
//   0x19480 SID registers (write-only stub)
//   0x19500 CPU state
//   0x19540 loader/meta state
//   0x20000 front framebuffer (320*200)
//   0x30000 back framebuffer  (320*200)

#ifndef C64_CORE_GLSL
#define C64_CORE_GLSL

#include "opcodes.glsl"

const uint RAM_BASE      = 0x00000u;
const uint BASIC_BASE    = 0x10000u;
const uint KERNAL_BASE   = 0x12000u;
const uint CHARGEN_BASE  = 0x14000u;
const uint CART_BASE     = 0x15000u;
const uint FB_FRONT      = 0x20000u;
const uint FB_BACK       = 0x30000u;
const uint COLOR_BASE    = 0x19000u;
const uint VIC_BASE      = 0x19400u;
const uint CIA1_BASE     = 0x19440u;
const uint CIA2_BASE     = 0x19460u;
const uint SID_BASE      = 0x19480u;
const uint CPU_BASE      = 0x19500u;
const uint META_BASE     = 0x19540u;

// CPU state words
const uint CPU_A         = 0u;
const uint CPU_X         = 1u;
const uint CPU_Y         = 2u;
const uint CPU_SP        = 3u;
const uint CPU_P         = 4u;
const uint CPU_PC        = 5u;
const uint CPU_TOTAL     = 6u;
const uint CPU_HALT      = 7u;
const uint CPU_FRAMES    = 8u;
const uint CPU_LINE      = 9u;
const uint CPU_LINECYCLE = 10u;
const uint CPU_REMAINDER = 11u;

// Loader state words
const uint META_INIT     = 0u;
const uint META_STAGE    = 1u; // 0 reset, 1 waiting for BASIC, 2 program started, 3 error
const uint META_TYPE     = 2u; // 0 none, 1 PRG, 2 8K cartridge, 3 16K cartridge
const uint META_LOAD     = 3u;
const uint META_SIZE     = 4u;
const uint META_FLAGS    = 5u; // bit0 KERNAL, bit1 BASIC, bit2 CHARGEN
const uint META_IDLE     = 6u;
const uint META_ERROR    = 7u;

// The program payload starts after this many bytes of data.bin.
const uint DATA_PAYLOAD  = 32u;

// CIA register indices (the same layout is used for both chips).
const uint CIA_PA        = 0u;
const uint CIA_PB        = 1u;
const uint CIA_DDRA      = 2u;
const uint CIA_DDRB      = 3u;
const uint CIA_TALO      = 4u;
const uint CIA_TAHI      = 5u;
const uint CIA_TBLO      = 6u;
const uint CIA_TBHI      = 7u;
const uint CIA_TOD10     = 8u;
const uint CIA_TODSEC    = 9u;
const uint CIA_TODMIN    = 10u;
const uint CIA_TODHR     = 11u;
const uint CIA_SDR       = 12u;
const uint CIA_ICR       = 13u;
const uint CIA_CRA       = 14u;
const uint CIA_CRB       = 15u;
const uint CIA_TA        = 16u;
const uint CIA_TB        = 17u;
const uint CIA_TA_LATCH  = 18u;
const uint CIA_TB_LATCH  = 19u;
const uint CIA_ICR_MASK  = 20u;
const uint CIA_ICR_FLAGS = 21u;
const uint CIA_IRQ       = 22u;

const uint P_C = 0x01u;
const uint P_Z = 0x02u;
const uint P_I = 0x04u;
const uint P_D = 0x08u;
const uint P_B = 0x10u;
const uint P_U = 0x20u;
const uint P_V = 0x40u;
const uint P_N = 0x80u;

// 6502 registers live in shader locals while a frame is executing. They are
// checkpointed to private storage at the start and end of every dispatch.
uint A, X, Y, SP, P, PC;
uint c64Total, c64Spent;
uint cyclesInFrame;
uint currentLine;
uint lineCycle;
bool frameDone;
bool cpuHalted;

uint keyBitsLo, keyBitsHi;
uint joystick2; // bit0 up, 1 down, 2 left, 3 right, 4 fire (active low in CIA)

bool irqLine;

// Forward declarations.
uint c64Read(uint address);
void c64Write(uint address, uint value);
uint vicReadMem(uint address);
uint ciaRead(uint base, uint reg);
void ciaWrite(uint base, uint reg, uint value);
uint vicReadReg(uint reg);
void vicWriteReg(uint reg, uint value);
void vicSetRasterFlag();
void renderLine(uint line);
void updateIrq();
void tick(uint n);
uint readVector16(uint address);

uint mget(uint i) { return mem[i]; }
void mset(uint i, uint v) { mem[i] = v; }

uint ramRead(uint address) { return mem[RAM_BASE + (address & 0xFFFFu)] & 0xFFu; }
void ramWrite(uint address, uint value) { mem[RAM_BASE + (address & 0xFFFFu)] = value & 0xFFu; }
uint romByte(uint base, uint offset) { return mem[base + offset] & 0xFFu; }

uint read16(uint address) {
    return ramRead(address) | (ramRead(address + 1u) << 8u);
}

// Interrupt vectors live in ROM (or in RAM under ROM), so they must go
// through the memory map instead of straight to RAM.
uint readVector16(uint address) {
    return c64Read(address) | (c64Read(address + 1u) << 8u);
}

// VIC bank is selected by the low two bits of CIA2 port A, inverted.
uint vicBank() {
    uint v = mget(CIA2_BASE + CIA_PA) & 3u;
    return (3u - v) << 14u;
}

uint vicReadMem(uint address) {
    uint bank = vicBank();
    uint off = address & 0x3FFFu;
    // The VIC sees the character generator at $1000-$1FFF in banks 0 and 2.
    if ((bank == 0x0000u || bank == 0x8000u) && off >= 0x1000u && off < 0x2000u)
        return romByte(CHARGEN_BASE, off - 0x1000u);
    return ramRead(bank + off);
}

// Sprite pointers and sprite data always come from RAM: the character ROM
// window only applies to character/bitmap fetches inside the graphics section.
uint vicReadSpriteMem(uint address) {
    return ramRead(vicBank() + (address & 0x3FFFu));
}

uint c64Read(uint address) {
    address &= 0xFFFFu;
    uint port = ramRead(0x0000u) & ramRead(0x0001u);
    // PLA banking ($01): LORAM=bit0, HIRAM=bit1, CHAREN=bit2.
    bool loram  = (port & 0x01u) != 0u;
    bool hiram  = (port & 0x02u) != 0u;
    bool charen = (port & 0x04u) != 0u;
    bool kernal = hiram;
    bool basic  = loram && (hiram || charen);
    bool io     = charen && (hiram || loram);
    uint type   = mget(META_BASE + META_TYPE);

    // Cartridge ROM at $8000-$9FFF, and $A000-$BFFF for a 16 KiB image.
    if (address >= 0x8000u && address <= 0x9FFFu && type >= 2u)
        return romByte(CART_BASE, address - 0x8000u);
    if (address >= 0xA000u && address <= 0xBFFFu && type == 3u)
        return romByte(CART_BASE, address - 0x8000u);

    if (address >= 0xA000u && address <= 0xBFFFu && basic)
        return romByte(BASIC_BASE, address - 0xA000u);
    if (address >= 0xD000u && address <= 0xDFFFu) {
        if (io) {
            if (address < 0xD400u) return vicReadReg(address - 0xD000u);
            if (address < 0xD800u) return 0u; // SID is write-only on the real chip
            if (address < 0xDC00u) return mem[COLOR_BASE + (address - 0xD800u)] & 0x0Fu;
            if (address < 0xDD00u) return ciaRead(CIA1_BASE, address - 0xDC00u);
            if (address < 0xDE00u) return ciaRead(CIA2_BASE, address - 0xDD00u);
            return 0u;
        }
        // CHAREN=0 exposes the character ROM in the I/O window whenever a
        // ROM bank is enabled.
        if (!charen && (hiram || loram))
            return romByte(CHARGEN_BASE, (address - 0xD000u) & 0x0FFFu);
        return ramRead(address);
    }
    if (address >= 0xE000u && address <= 0xFFFFu && kernal)
        return romByte(KERNAL_BASE, address - 0xE000u);
    return ramRead(address);
}

void c64Write(uint address, uint value) {
    address &= 0xFFFFu;
    value &= 0xFFu;
    uint port = ramRead(0x0000u) & ramRead(0x0001u);
    bool io     = ((port & 0x04u) != 0u) &&
                  (((port & 0x02u) != 0u) || ((port & 0x01u) != 0u));

    // The 6502 always writes the RAM below ROM.
    ramWrite(address, value);

    if (address <= 0x0001u) return;
    if (address >= 0xD000u && address <= 0xDFFFu && io) {
        if (address < 0xD400u) { vicWriteReg(address - 0xD000u, value); return; }
        // SID registers mirror every 32 bytes through $D400-$D7FF.
        if (address < 0xD800u) { mem[SID_BASE + ((address - 0xD400u) & 0x1Fu)] = value; return; }
        if (address < 0xDC00u) { mem[COLOR_BASE + (address - 0xD800u)] = value & 0x0Fu; return; }
        if (address < 0xDD00u) { ciaWrite(CIA1_BASE, address - 0xDC00u, value); return; }
        if (address < 0xDE00u) { ciaWrite(CIA2_BASE, address - 0xDD00u, value); return; }
        return;
    }
}

uint stackRead() { return ramRead(0x0100u + (SP & 0xFFu)); }
void push(uint value) { ramWrite(0x0100u + (SP & 0xFFu), value); SP = (SP - 1u) & 0xFFu; }
uint pull() { SP = (SP + 1u) & 0xFFu; return ramRead(0x0100u + (SP & 0xFFu)); }

void setNZ(uint value) {
    value &= 0xFFu;
    P = (P & ~(P_N | P_Z)) | (value == 0u ? P_Z : 0u) | (value & P_N);
}
void setC(bool value) { if (value) P |= P_C; else P &= ~P_C; }
void setV(bool value) { if (value) P |= P_V; else P &= ~P_V; }

// ---------------------------------------------------------------------------
// CIA
// ---------------------------------------------------------------------------

uint keyBit(uint pa, uint pb) {
    uint index = pa * 8u + pb;
    return index < 32u ? ((keyBitsLo >> index) & 1u)
                       : ((keyBitsHi >> (index - 32u)) & 1u);
}

void pressKey(uint pa, uint pb) {
    // The matrix tables list PB (row) first and PA (column) second, while the
    // CIA scan drives PA and reads PB.  Swap the coordinates so every caller
    // can use the natural table order.
    uint index = (pb & 7u) * 8u + (pa & 7u);
    if (index < 32u) keyBitsLo |= (1u << index);
    else keyBitsHi |= (1u << (index - 32u));
}

uint ciaPortA(uint base) {
    uint outBits = mget(base + CIA_PA) & mget(base + CIA_DDRA);
    uint inBits  = 0xFFu & ~mget(base + CIA_DDRA);
    uint value = outBits | inBits;
    if (base == CIA1_BASE) value &= ~(joystick2 & 0x1Fu);
    return value & 0xFFu;
}

uint ciaPortB(uint base) {
    uint ddr = mget(base + CIA_DDRB);
    uint outBits = mget(base + CIA_PB) & ddr;
    uint inBits  = 0xFFu & ~ddr;
    if (base == CIA1_BASE && inBits != 0u) {
        uint pa = mget(base + CIA_PA) & mget(base + CIA_DDRA);
        uint rows = 0xFFu;
        for (uint pb = 0u; pb < 8u; pb++) {
            bool pressed = false;
            for (uint ca = 0u; ca < 8u; ca++) {
                if ((pa & (1u << ca)) == 0u && keyBit(ca, pb) != 0u) pressed = true;
            }
            if (pressed) rows &= ~(1u << pb);
        }
        inBits &= rows;
        // Joystick port 2 shares the keyboard row lines; the same pad is also
        // offered on port 1 so software that reads $DC01 (joystick port 1)
        // responds as well.
        inBits &= ~(joystick2 & 0x1Fu);
    }
    return (outBits | inBits) & 0xFFu;
}

uint ciaRead(uint base, uint reg) {
    uint r = reg & 0x0Fu;
    if (r == CIA_PA) return ciaPortA(base);
    if (r == CIA_PB) return ciaPortB(base);
    if (r == CIA_TALO) return mget(base + CIA_TA) & 0xFFu;
    if (r == CIA_TAHI) return (mget(base + CIA_TA) >> 8u) & 0xFFu;
    if (r == CIA_TBLO) return mget(base + CIA_TB) & 0xFFu;
    if (r == CIA_TBHI) return (mget(base + CIA_TB) >> 8u) & 0xFFu;
    if (r == CIA_ICR) {
        uint flags = mget(base + CIA_ICR_FLAGS);
        uint mask = mget(base + CIA_ICR_MASK);
        mset(base + CIA_ICR_FLAGS, 0u);
        updateIrq();
        return (flags & 0x1Fu) | ((flags & mask & 0x1Fu) != 0u ? 0x80u : 0u);
    }
    return mget(base + r) & 0xFFu;
}

void ciaSetFlag(uint base, uint bit) {
    uint flags = mget(base + CIA_ICR_FLAGS) | (1u << bit);
    mset(base + CIA_ICR_FLAGS, flags);
    if ((flags & mget(base + CIA_ICR_MASK)) != 0u) mset(base + CIA_IRQ, 1u);
    updateIrq();
}

void ciaWrite(uint base, uint reg, uint value) {
    uint r = reg & 0x0Fu;
    value &= 0xFFu;
    if (r == CIA_PA || r == CIA_PB || r == CIA_DDRA || r == CIA_DDRB ||
        r == CIA_SDR || r == CIA_TOD10 || r == CIA_TODSEC ||
        r == CIA_TODMIN || r == CIA_TODHR) {
        mset(base + r, value);
        return;
    }
    if (r == CIA_TALO) { mset(base + CIA_TA_LATCH, (mget(base + CIA_TA_LATCH) & 0xFF00u) | value); return; }
    if (r == CIA_TAHI) {
        uint latch = (mget(base + CIA_TA_LATCH) & 0x00FFu) | (value << 8u);
        mset(base + CIA_TA_LATCH, latch);
        if ((mget(base + CIA_CRA) & 0x01u) == 0u) mset(base + CIA_TA, latch);
        return;
    }
    if (r == CIA_TBLO) { mset(base + CIA_TB_LATCH, (mget(base + CIA_TB_LATCH) & 0xFF00u) | value); return; }
    if (r == CIA_TBHI) {
        uint latch = (mget(base + CIA_TB_LATCH) & 0x00FFu) | (value << 8u);
        mset(base + CIA_TB_LATCH, latch);
        if ((mget(base + CIA_CRB) & 0x01u) == 0u) mset(base + CIA_TB, latch);
        return;
    }
    if (r == CIA_ICR) {
        uint mask = mget(base + CIA_ICR_MASK);
        if ((value & 0x80u) != 0u) mask |= value & 0x1Fu;
        else mask &= ~(value & 0x1Fu);
        mset(base + CIA_ICR_MASK, mask);
        updateIrq();
        return;
    }
    if (r == CIA_CRA) {
        if ((value & 0x10u) != 0u) mset(base + CIA_TA, mget(base + CIA_TA_LATCH));
        mset(base + CIA_CRA, value & 0xEFu);
        return;
    }
    if (r == CIA_CRB) {
        if ((value & 0x10u) != 0u) mset(base + CIA_TB, mget(base + CIA_TB_LATCH));
        mset(base + CIA_CRB, value & 0xEFu);
        return;
    }
}

void ciaTickOne(uint base) {
    uint cra = mget(base + CIA_CRA);
    if ((cra & 0x01u) != 0u) {
        uint t = mget(base + CIA_TA);
        if (t == 0u) {
            mset(base + CIA_TA, mget(base + CIA_TA_LATCH));
            ciaSetFlag(base, 0u);
        } else {
            t = (t - 1u) & 0xFFFFu;
            mset(base + CIA_TA, t);
            if (t == 0u) {
                mset(base + CIA_TA, mget(base + CIA_TA_LATCH));
                ciaSetFlag(base, 0u);
            }
        }
    }
    uint crb = mget(base + CIA_CRB);
    if ((crb & 0x01u) != 0u) {
        uint t = mget(base + CIA_TB);
        if (t == 0u) {
            mset(base + CIA_TB, mget(base + CIA_TB_LATCH));
            ciaSetFlag(base, 1u);
        } else {
            t = (t - 1u) & 0xFFFFu;
            mset(base + CIA_TB, t);
            if (t == 0u) {
                mset(base + CIA_TB, mget(base + CIA_TB_LATCH));
                ciaSetFlag(base, 1u);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// VIC-II registers
// ---------------------------------------------------------------------------

uint vicIrqState() {
    return (mget(VIC_BASE + 0x19u) & mget(VIC_BASE + 0x1Au) & 0x0Fu);
}

uint vicReadReg(uint reg) {
    uint r = reg & 0x3Fu;
    if (r == 0x11u) return (mget(VIC_BASE + 0x11u) & 0x7Fu) | ((currentLine & 0x100u) != 0u ? 0x80u : 0u);
    if (r == 0x12u) return currentLine & 0xFFu;
    if (r == 0x16u) return (mget(VIC_BASE + 0x16u) & 0x3Fu) | 0xC0u;
    if (r == 0x18u) return (mget(VIC_BASE + 0x18u) & 0xFEu) | 0x01u;
    if (r == 0x19u) {
        uint flags = mget(VIC_BASE + 0x19u) & 0x0Fu;
        // Reading $D019 acknowledges every latched VIC interrupt.
        mset(VIC_BASE + 0x19u, 0u);
        updateIrq();
        return flags | ((flags & (mget(VIC_BASE + 0x1Au) & 0x0Fu)) != 0u ? 0x80u : 0u);
    }
    if (r == 0x1Au) return (mget(VIC_BASE + 0x1Au) & 0x0Fu) | 0xF0u;
    if (r == 0x1Eu || r == 0x1Fu) return 0u;
    if (r <= 0x2Eu) return mget(VIC_BASE + r) & 0xFFu;
    return 0xFFu;
}

void vicWriteReg(uint reg, uint value) {
    uint r = reg & 0x3Fu;
    value &= 0xFFu;
    if (r == 0x19u) {
        mset(VIC_BASE + 0x19u, mget(VIC_BASE + 0x19u) & ~(value & 0x0Fu));
        updateIrq();
        return;
    }
    if (r == 0x1Eu || r == 0x1Fu) return;
    if (r <= 0x2Eu) mset(VIC_BASE + r, value);
    // Writing $D011/$D012 only moves the comparison latch. It must not raise
    // the raster IRQ immediately: doing that re-triggers the interrupt while
    // the handler is still running (the handler writes $D011) and starves the
    // main program.
    updateIrq();
}

void vicSetRasterFlag() {
    uint line = (mget(VIC_BASE + 0x12u) |
                 ((mget(VIC_BASE + 0x11u) & 0x80u) << 1u)) & 0x1FFu;
    if (line == (currentLine & 0x1FFu)) {
        mset(VIC_BASE + 0x19u, mget(VIC_BASE + 0x19u) | 0x01u);
        updateIrq();
    }
}

// ---------------------------------------------------------------------------
// VIC-II scanline renderer. Only the 320x200 display window is rendered;
// the fragment shader paints the border from $D020.
// ---------------------------------------------------------------------------

void spriteLine(uint line, uint li) {
    uint enabled = mget(VIC_BASE + 0x15u);
    if (enabled == 0u) return;
    uint d018 = mget(VIC_BASE + 0x18u);
    uint screenBase = vicBank() + ((d018 >> 4u) & 0x0Fu) * 0x400u;
    uint bg0 = mget(VIC_BASE + 0x21u) & 0x0Fu;
    uint bg1 = mget(VIC_BASE + 0x22u) & 0x0Fu;
    uint bg2 = mget(VIC_BASE + 0x23u) & 0x0Fu;
    uint lineBase = FB_BACK + li * 320u;

    // Low-numbered sprites are in front. Draw high to low.
    for (int ni = 7; ni >= 0; ni--) {
        uint n = uint(ni);
        if ((enabled & (1u << n)) == 0u) continue;
        uint yexp = (mget(VIC_BASE + 0x17u) >> n) & 1u;
        uint height = yexp != 0u ? 42u : 21u;
        uint sy0 = mget(VIC_BASE + 0x01u + n * 2u);
        if (line < sy0 || line >= sy0 + height) continue;
        uint sy = (line - sy0) / (yexp != 0u ? 2u : 1u);
        if (sy >= 21u) continue;

        uint sx0 = mget(VIC_BASE + 0x00u + n * 2u);
        if ((mget(VIC_BASE + 0x10u) & (1u << n)) != 0u) sx0 |= 0x100u;
        uint xexp = (mget(VIC_BASE + 0x1Du) >> n) & 1u;
        uint mult = (mget(VIC_BASE + 0x1Cu) >> n) & 1u;
        uint behind = (mget(VIC_BASE + 0x1Bu) >> n) & 1u;
        uint color = mget(VIC_BASE + 0x27u + n) & 0x0Fu;
        uint width = xexp != 0u ? 48u : 24u;
        uint ptr = vicReadSpriteMem(screenBase + 0x03F8u + n);
        uint dataBase = vicBank() + ptr * 64u + sy * 3u;

        for (uint dx = 0u; dx < width; dx++) {
            // Sprite X=24 is the left edge of the visible display window.
            int px = int(sx0) + int(dx) - 24;
            if (px < 0 || px >= 320) continue;
            uint sx = dx / (xexp != 0u ? 2u : 1u);
            if (sx >= 24u) continue;
            uint outc = 16u;
            if (mult != 0u) {
                uint pair = (sx & ~1u);
                uint b = vicReadSpriteMem(dataBase + (pair >> 3u));
                uint v = (b >> (6u - (pair & 6u))) & 3u;
                if (v == 1u) outc = mget(VIC_BASE + 0x25u) & 0x0Fu;
                else if (v == 2u) outc = mget(VIC_BASE + 0x26u) & 0x0Fu;
                else if (v == 3u) outc = color;
            } else {
                uint bit = (vicReadSpriteMem(dataBase + (sx >> 3u)) >> (7u - (sx & 7u))) & 1u;
                if (bit != 0u) outc = color;
            }
            if (outc == 16u) continue;
            uint under = mem[lineBase + uint(px)] & 0x0Fu;
            if (behind != 0u && under != bg0 && under != bg1 && under != bg2) continue;
            mem[lineBase + uint(px)] = outc;
        }
    }
}

void renderLine(uint line) {
    if (line < 51u || line >= 251u) return;
    uint li = line - 51u;
    uint d011 = mget(VIC_BASE + 0x11u);
    uint d016 = mget(VIC_BASE + 0x16u);
    uint d018 = mget(VIC_BASE + 0x18u);
    uint bg0 = mget(VIC_BASE + 0x21u) & 0x0Fu;
    uint bg1 = mget(VIC_BASE + 0x22u) & 0x0Fu;
    uint bg2 = mget(VIC_BASE + 0x23u) & 0x0Fu;
    uint border = mget(VIC_BASE + 0x20u) & 0x0Fu;

    uint py = line - 51u;
    uint yscroll = d011 & 0x07u;
    uint xscroll = d016 & 0x07u;
    // The VIC starts a new character row on every badline, i.e. whenever
    // (raster line & 7) == yscroll.  The first visible badline is therefore
    // 48 + yscroll; derive the row and the pixel inside it from that phase
    // instead of adding yscroll to the display offset (which clipped the top
    // of the first row on the default $D011 = $1B).
    int rel = int(line) - int(48u + yscroll);
    uint rowPixel = uint(rel & 7);
    int rowIndex = rel >> 3;
    if (rowIndex < 0) rowIndex += 25;
    else if (rowIndex > 24) rowIndex -= 25;
    uint row = uint(rowIndex);

    bool bitmap = (d011 & 0x20u) != 0u;
    bool ecm = (d011 & 0x40u) != 0u;
    bool multicolor = (d016 & 0x10u) != 0u;
    bool den = (d011 & 0x10u) != 0u;

    uint bank = vicBank();
    uint screenBase = bank + ((d018 >> 4u) & 0x0Fu) * 0x400u;
    uint charBase = bank + ((d018 >> 1u) & 0x07u) * 0x800u;
    uint bitmapBase = bank + ((d018 >> 3u) & 0x01u) * 0x2000u;
    uint lineBase = FB_BACK + li * 320u;

    for (uint px = 0u; px < 320u; px++) {
        if (!den) { mem[lineBase + px] = border; continue; }
        uint col = (px + xscroll) >> 3u;
        if (col >= 40u) col -= 40u;
        uint cell = (row * 40u + col) & 0x3FFu;
        uint screen = vicReadMem(screenBase + cell);
        uint colorram = mem[COLOR_BASE + cell] & 0x0Fu;
        uint outColor = bg0;
        uint bitIn = (px + xscroll) & 7u;

        if (bitmap) {
            uint addr = bitmapBase + cell * 8u + rowPixel;
            uint glyph = vicReadMem(addr);
            if (multicolor) {
                uint pair = bitIn >> 1u;
                uint v = (glyph >> (6u - pair * 2u)) & 3u;
                outColor = v == 0u ? bg0 : (v == 1u ? bg1 : (v == 2u ? bg2 : colorram));
            } else {
                outColor = ((glyph >> (7u - bitIn)) & 1u) != 0u ? colorram : bg0;
            }
        } else {
            uint charCode = screen;
            uint charColor = colorram;
            if (ecm) charCode |= ((colorram >> 6u) & 3u) << 8u;
            uint glyph = vicReadMem(charBase + charCode * 8u + rowPixel);
            if (multicolor && (colorram & 0x08u) != 0u) {
                uint pair = bitIn >> 1u;
                uint v = (glyph >> (6u - pair * 2u)) & 3u;
                outColor = v == 0u ? bg0 : (v == 1u ? bg1 : (v == 2u ? bg2 : (charColor & 0x07u)));
            } else {
                outColor = ((glyph >> (7u - bitIn)) & 1u) != 0u ? charColor : bg0;
            }
        }
        mem[lineBase + px] = outColor & 0x0Fu;
    }
    spriteLine(line, li);
}

// ---------------------------------------------------------------------------
// Timing, IRQ and 6502 helpers
// ---------------------------------------------------------------------------

void updateIrq() {
    bool a = (mget(CIA1_BASE + CIA_ICR_FLAGS) & mget(CIA1_BASE + CIA_ICR_MASK) & 0x1Fu) != 0u;
    bool v = vicIrqState() != 0u;
    irqLine = a || v;
}

void copyVisibleFrame() {
    for (uint i = 0u; i < 64000u; i++) mem[FB_FRONT + i] = mem[FB_BACK + i];
}

void tick(uint n) {
    // Clamp defensively so a bad cycle count cannot stall or overrun a frame.
    if (n > 64u) n = 64u;
    for (uint i = 0u; i < n; i++) {
        ciaTickOne(CIA1_BASE);
        ciaTickOne(CIA2_BASE);
        lineCycle++;
        if (lineCycle >= 63u) {
            lineCycle = 0u;
            currentLine++;
            if (currentLine >= 312u) {
                currentLine = 0u;
                frameDone = true;
                copyVisibleFrame();
            }
            if (currentLine >= 51u && currentLine < 251u) renderLine(currentLine);
            vicSetRasterFlag();
        }
    }
}

// Scratch used by the table-driven 6502 core.
uint ea, opcodeValue, mode, op, baseCycles;
bool pageCrossed;

int sign8(uint v) { return int(v) - ((v & 0x80u) != 0u ? 256 : 0); }

uint fetch8() { uint v = c64Read(PC); PC = (PC + 1u) & 0xFFFFu; return v; }
uint fetch16() { uint lo = fetch8(); uint hi = fetch8(); return lo | (hi << 8u); }

void branch(bool take, int offset) {
    if (!take) return;
    uint old = PC;
    PC = uint(int(PC) + offset) & 0xFFFFu;
    baseCycles += ((old & 0xFF00u) != (PC & 0xFF00u)) ? 2u : 1u;
}

void doCompare(uint reg, uint value) {
    setC(reg >= value);
    setNZ((reg - value) & 0xFFu);
}

void doADC(uint value) {
    uint carry = P & P_C;
    uint sum = A + value + carry;
    setV((~(A ^ value) & (A ^ sum) & 0x80u) != 0u);
    if ((P & P_D) != 0u) {
        uint lo = (A & 0x0Fu) + (value & 0x0Fu) + carry;
        uint hi = (A >> 4u) + (value >> 4u);
        if (lo > 9u) { lo += 6u; hi++; }
        if (hi > 9u) hi += 6u;
        setC(hi > 0x0Fu);
        A = ((hi << 4u) | (lo & 0x0Fu)) & 0xFFu;
        setNZ(sum & 0xFFu);
    } else {
        setC(sum > 0xFFu);
        A = sum & 0xFFu;
        setNZ(A);
    }
}

void doSBC(uint value) {
    uint borrow = 1u - (P & P_C);
    int diff = int(A) - int(value) - int(borrow);
    setV(((A ^ value) & (A ^ uint(diff & 0xFF)) & 0x80u) != 0u);
    if ((P & P_D) != 0u) {
        int lo = int(A & 0x0Fu) - int(value & 0x0Fu) - int(borrow);
        int hi = int(A >> 4u) - int(value >> 4u);
        if (lo < 0) { lo -= 6; hi--; }
        if (hi < 0) hi -= 6;
        setC(diff >= 0);
        A = ((hi << 4) | (lo & 0x0F)) & 0xFF;
        setNZ(uint(diff & 0xFF));
    } else {
        setC(diff >= 0);
        A = uint(diff & 0xFF);
        setNZ(A);
    }
}

uint aslValue(uint v) { setC((v & 0x80u) != 0u); v = (v << 1u) & 0xFFu; setNZ(v); return v; }
uint lsrValue(uint v) { setC((v & 1u) != 0u); v >>= 1u; setNZ(v); return v; }
uint rolValue(uint v) { uint c = P & P_C; setC((v & 0x80u) != 0u); v = ((v << 1u) | c) & 0xFFu; setNZ(v); return v; }
uint rorValue(uint v) { uint c = (P & P_C) << 7u; setC((v & 1u) != 0u); v = (v >> 1u) | c; setNZ(v); return v; }

uint serviceIrq() {
    push((PC >> 8u) & 0xFFu);
    push(PC & 0xFFu);
    push((P & ~P_B) | P_U);
    P |= P_I;
    PC = readVector16(0xFFFEu);
    return 7u;
}

void executeInstruction() {
    uint opcode = fetch8();
    mode = OPCODE_MODE[opcode];
    op = OPCODE_OP[opcode];
    baseCycles = OPCODE_CYCLES[opcode];
    pageCrossed = false;
    ea = 0u;
    opcodeValue = 0u;

    if (mode == MODE_IMM) { ea = PC; PC = (PC + 1u) & 0xFFFFu; }
    else if (mode == MODE_ZP) { ea = fetch8(); }
    else if (mode == MODE_ZPX) { ea = (fetch8() + X) & 0xFFu; }
    else if (mode == MODE_ZPY) { ea = (fetch8() + Y) & 0xFFu; }
    else if (mode == MODE_ABS) { ea = fetch16(); }
    else if (mode == MODE_ABX || mode == MODE_ABX_P) {
        uint b = fetch16(); ea = (b + X) & 0xFFFFu;
        pageCrossed = ((b & 0xFF00u) != (ea & 0xFF00u));
    }
    else if (mode == MODE_ABY || mode == MODE_ABY_P) {
        uint b = fetch16(); ea = (b + Y) & 0xFFFFu;
        pageCrossed = ((b & 0xFF00u) != (ea & 0xFF00u));
    }
    else if (mode == MODE_IZX) {
        uint zp = (fetch8() + X) & 0xFFu;
        ea = ramRead(zp) | (ramRead((zp + 1u) & 0xFFu) << 8u);
    }
    else if (mode == MODE_IZY || mode == MODE_IZY_P) {
        uint zp = fetch8();
        uint b = ramRead(zp) | (ramRead((zp + 1u) & 0xFFu) << 8u);
        ea = (b + Y) & 0xFFFFu;
        pageCrossed = ((b & 0xFF00u) != (ea & 0xFF00u));
    }
    else if (mode == MODE_REL) {
        opcodeValue = fetch8();
    }
    else if (mode == MODE_IND) {
        // The pointer bytes follow the current memory map, so JMP ($A002)
        // sees the BASIC ROM vector rather than the RAM underneath it.
        uint ptr = fetch16();
        ea = c64Read(ptr) | (c64Read((ptr & 0xFF00u) | ((ptr + 1u) & 0x00FFu)) << 8u);
    }

    if (mode == MODE_ABX_P || mode == MODE_ABY_P || mode == MODE_IZY_P) {
        if (pageCrossed) baseCycles++;
    }
    // Never let a malformed table entry spin the frame loop with zero cycles.
    if (baseCycles < 2u) baseCycles = 2u;

    switch (op) {
    case OP_ADC: doADC(c64Read(ea)); break;
    case OP_AND: A &= c64Read(ea); setNZ(A); break;
    case OP_ASL:
        if (mode == MODE_ACC) A = aslValue(A);
        else { uint v = aslValue(c64Read(ea)); c64Write(ea, v); }
        break;
    case OP_BCC: branch((P & P_C) == 0u, sign8(opcodeValue)); break;
    case OP_BCS: branch((P & P_C) != 0u, sign8(opcodeValue)); break;
    case OP_BEQ: branch((P & P_Z) != 0u, sign8(opcodeValue)); break;
    case OP_BIT:
        opcodeValue = c64Read(ea);
        setNZ(A & opcodeValue);
        P = (P & ~(P_N | P_V)) | (opcodeValue & (P_N | P_V));
        break;
    case OP_BMI: branch((P & P_N) != 0u, sign8(opcodeValue)); break;
    case OP_BNE: branch((P & P_Z) == 0u, sign8(opcodeValue)); break;
    case OP_BPL: branch((P & P_N) == 0u, sign8(opcodeValue)); break;
    case OP_BRK:
        PC = (PC + 1u) & 0xFFFFu;
        push((PC >> 8u) & 0xFFu); push(PC & 0xFFu);
        push(P | P_B | P_U);
        P |= P_I;
        PC = readVector16(0xFFFEu);
        break;
    case OP_BVC: branch((P & P_V) == 0u, sign8(opcodeValue)); break;
    case OP_BVS: branch((P & P_V) != 0u, sign8(opcodeValue)); break;
    case OP_CLC: P &= ~P_C; break;
    case OP_CLD: P &= ~P_D; break;
    case OP_CLI: P &= ~P_I; break;
    case OP_CLV: P &= ~P_V; break;
    case OP_CMP: doCompare(A, c64Read(ea)); break;
    case OP_CPX: doCompare(X, c64Read(ea)); break;
    case OP_CPY: doCompare(Y, c64Read(ea)); break;
    case OP_DCP:
        opcodeValue = (c64Read(ea) - 1u) & 0xFFu; c64Write(ea, opcodeValue);
        doCompare(A, opcodeValue); break;
    case OP_DEC:
        opcodeValue = (c64Read(ea) - 1u) & 0xFFu; c64Write(ea, opcodeValue); setNZ(opcodeValue); break;
    case OP_DEX: X = (X - 1u) & 0xFFu; setNZ(X); break;
    case OP_DEY: Y = (Y - 1u) & 0xFFu; setNZ(Y); break;
    case OP_EOR: A ^= c64Read(ea); setNZ(A); break;
    case OP_INC:
        opcodeValue = (c64Read(ea) + 1u) & 0xFFu; c64Write(ea, opcodeValue); setNZ(opcodeValue); break;
    case OP_INX: X = (X + 1u) & 0xFFu; setNZ(X); break;
    case OP_INY: Y = (Y + 1u) & 0xFFu; setNZ(Y); break;
    case OP_ISB:
        opcodeValue = (c64Read(ea) + 1u) & 0xFFu; c64Write(ea, opcodeValue); doSBC(opcodeValue); break;
    case OP_JMP: PC = ea; break;
    case OP_JSR: { uint ret = (PC - 1u) & 0xFFFFu; push((ret >> 8u) & 0xFFu); push(ret & 0xFFu); PC = ea; break; }
    case OP_LAX: A = X = c64Read(ea); setNZ(A); break;
    case OP_LDA: A = c64Read(ea); setNZ(A); break;
    case OP_LDX: X = c64Read(ea); setNZ(X); break;
    case OP_LDY: Y = c64Read(ea); setNZ(Y); break;
    case OP_LSR:
        if (mode == MODE_ACC) A = lsrValue(A);
        else { uint v = lsrValue(c64Read(ea)); c64Write(ea, v); }
        break;
    case OP_NOP: break;
    case OP_ORA: A |= c64Read(ea); setNZ(A); break;
    case OP_PHA: push(A); break;
    case OP_PHP: push(P | P_B | P_U); break;
    case OP_PLA: A = pull(); setNZ(A); break;
    case OP_PLP: P = (pull() | P_U) & ~P_B; break;
    case OP_RLA:
        opcodeValue = rolValue(c64Read(ea)); c64Write(ea, opcodeValue);
        A &= opcodeValue; setNZ(A); break;
    case OP_ROL:
        if (mode == MODE_ACC) A = rolValue(A);
        else { uint v = rolValue(c64Read(ea)); c64Write(ea, v); }
        break;
    case OP_ROR:
        if (mode == MODE_ACC) A = rorValue(A);
        else { uint v = rorValue(c64Read(ea)); c64Write(ea, v); }
        break;
    case OP_RRA:
        opcodeValue = rorValue(c64Read(ea)); c64Write(ea, opcodeValue); doADC(opcodeValue); break;
    case OP_RTI:
        P = (pull() | P_U) & ~P_B;
        { uint lo = pull(); uint hi = pull(); PC = lo | (hi << 8u); }
        break;
    case OP_RTS:
        { uint lo = pull(); uint hi = pull(); PC = ((lo | (hi << 8u)) + 1u) & 0xFFFFu; }
        break;
    case OP_SAX: c64Write(ea, A & X); break;
    case OP_SBC: doSBC(c64Read(ea)); break;
    case OP_SEC: P |= P_C; break;
    case OP_SED: P |= P_D; break;
    case OP_SEI: P |= P_I; break;
    case OP_SLO:
        opcodeValue = aslValue(c64Read(ea)); c64Write(ea, opcodeValue);
        A |= opcodeValue; setNZ(A); break;
    case OP_SRE:
        opcodeValue = lsrValue(c64Read(ea)); c64Write(ea, opcodeValue);
        A ^= opcodeValue; setNZ(A); break;
    case OP_STA: c64Write(ea, A); break;
    case OP_STX: c64Write(ea, X); break;
    case OP_STY: c64Write(ea, Y); break;
    case OP_TAX: X = A; setNZ(X); break;
    case OP_TAY: Y = A; setNZ(Y); break;
    case OP_TSX: X = SP; setNZ(X); break;
    case OP_TXA: A = X; setNZ(A); break;
    case OP_TXS: SP = X; break;
    case OP_TYA: A = Y; setNZ(A); break;
    default: break;
    }

    c64Total += baseCycles;
    c64Spent += baseCycles;
}

// ---------------------------------------------------------------------------
// Boot / input helpers
// ---------------------------------------------------------------------------

uint dataByte(uint offset) {
    uint word = c.atlas[offset >> 2u];
    return (word >> ((offset & 3u) * 8u)) & 0xFFu;
}

uint dataWord(uint offset) {
    return dataByte(offset) | (dataByte(offset + 1u) << 8u) |
           (dataByte(offset + 2u) << 16u) | (dataByte(offset + 3u) << 24u);
}

bool screenHasReady() {
    for (uint row = 0u; row < 25u; row++) {
        for (uint col = 0u; col + 5u < 40u; col++) {
            uint i = 0x0400u + row * 40u + col;
            if (ramRead(i) == 18u && ramRead(i + 1u) == 5u &&
                ramRead(i + 2u) == 1u && ramRead(i + 3u) == 4u &&
                ramRead(i + 4u) == 25u && ramRead(i + 5u) == 46u)
                return true;
        }
    }
    return false;
}

void injectRun() {
    ramWrite(0x00C6u, 4u);
    ramWrite(0x0277u, 82u);  // R
    ramWrite(0x0278u, 85u);  // U
    ramWrite(0x0279u, 78u);  // N
    ramWrite(0x027Au, 13u);  // RETURN
}

void loadPrg() {
    uint type = mget(META_BASE + META_TYPE);
    uint size = mget(META_BASE + META_SIZE);
    uint load = mget(META_BASE + META_LOAD);
    if (type != 1u) return;
    if (size < 3u || size > 0x10002u) {
        mset(META_BASE + META_STAGE, 3u);
        mset(META_BASE + META_ERROR, 1u);
        return;
    }
    uint body = size - 2u;
    for (uint i = 0u; i < body; i++)
        ramWrite((load + i) & 0xFFFFu, dataByte(DATA_PAYLOAD + 2u + i));

    if (load == 0x0801u) {
        uint end = (load + body) & 0xFFFFu;
        ramWrite(0x002Bu, 0x01u); ramWrite(0x002Cu, 0x08u);
        ramWrite(0x002Du, end & 0xFFu); ramWrite(0x002Eu, (end >> 8u) & 0xFFu);
        ramWrite(0x002Fu, end & 0xFFu); ramWrite(0x0030u, (end >> 8u) & 0xFFu);
        ramWrite(0x0031u, end & 0xFFu); ramWrite(0x0032u, (end >> 8u) & 0xFFu);
        injectRun();
    } else {
        PC = load;
        SP = 0xFD;
        P = P_U | P_I;
        cpuHalted = false;
    }
    mset(META_BASE + META_STAGE, 2u);
}

void mapKeyboard() {
    keyBitsLo = 0u;
    keyBitsHi = 0u;
    if (hbHas(HB_KEYBOARD)) {
        for (uint usage = 4u; usage < 232u; usage++) {
            if (!hbKey(usage)) continue;
            if (usage >= 4u && usage <= 29u) {
                // A..Z, physical C64 matrix positions (column PA, row PB).
                if (usage == 4u)  { pressKey(2u, 1u); } // A
                else if (usage == 5u)  { pressKey(4u, 3u); } // B
                else if (usage == 6u)  { pressKey(4u, 2u); } // C
                else if (usage == 7u)  { pressKey(2u, 2u); } // D
                else if (usage == 8u)  { pressKey(6u, 1u); } // E
                else if (usage == 9u)  { pressKey(5u, 2u); } // F
                else if (usage == 10u) { pressKey(2u, 3u); } // G
                else if (usage == 11u) { pressKey(5u, 3u); } // H
                else if (usage == 12u) { pressKey(1u, 4u); } // I
                else if (usage == 13u) { pressKey(2u, 4u); } // J
                else if (usage == 14u) { pressKey(5u, 4u); } // K
                else if (usage == 15u) { pressKey(2u, 5u); } // L
                else if (usage == 16u) { pressKey(4u, 4u); } // M
                else if (usage == 17u) { pressKey(7u, 4u); } // N
                else if (usage == 18u) { pressKey(6u, 4u); } // O
                else if (usage == 19u) { pressKey(1u, 5u); } // P
                else if (usage == 20u) { pressKey(6u, 7u); } // Q
                else if (usage == 21u) { pressKey(1u, 2u); } // R
                else if (usage == 22u) { pressKey(5u, 1u); } // S
                else if (usage == 23u) { pressKey(6u, 2u); } // T
                else if (usage == 24u) { pressKey(6u, 3u); } // U
                else if (usage == 25u) { pressKey(7u, 3u); } // V
                else if (usage == 26u) { pressKey(1u, 1u); } // W
                else if (usage == 27u) { pressKey(7u, 2u); } // X
                else if (usage == 28u) { pressKey(1u, 3u); } // Y
                else if (usage == 29u) { pressKey(4u, 1u); } // Z
            } else if (usage >= 30u && usage <= 39u) {
                // 1..9 and 0
                if (usage == 30u)      pressKey(0u, 7u);
                else if (usage == 31u) pressKey(3u, 7u);
                else if (usage == 32u) pressKey(0u, 1u);
                else if (usage == 33u) pressKey(3u, 1u);
                else if (usage == 34u) pressKey(0u, 2u);
                else if (usage == 35u) pressKey(3u, 2u);
                else if (usage == 36u) pressKey(0u, 3u);
                else if (usage == 37u) pressKey(3u, 3u);
                else if (usage == 38u) pressKey(0u, 4u);
                else                   pressKey(3u, 4u);
            }
            else if (usage == 40u) pressKey(1u, 0u);      // Return
            else if (usage == 41u) pressKey(7u, 7u);      // Escape -> RUN/STOP
            else if (usage == 42u) pressKey(0u, 0u);      // Backspace -> DEL
            else if (usage == 43u) pressKey(5u, 7u);      // Tab -> C=
            else if (usage == 44u) pressKey(4u, 7u);      // Space
            else if (usage == 45u) pressKey(3u, 5u);      // -
            else if (usage == 46u) pressKey(5u, 6u);      // =
            else if (usage == 47u) pressKey(6u, 5u);      // [ -> @
            else if (usage == 48u) pressKey(1u, 6u);      // ] -> *
            else if (usage == 49u) pressKey(7u, 6u);      // backslash -> /
            else if (usage == 51u) pressKey(2u, 6u);      // ;
            else if (usage == 52u) pressKey(5u, 5u);      // ' -> :
            else if (usage == 53u) pressKey(0u, 6u);      // ` -> GBP
            else if (usage == 54u) pressKey(7u, 5u);      // ,
            else if (usage == 55u) pressKey(4u, 5u);      // .
            else if (usage == 56u) pressKey(7u, 6u);      // /
            else if (usage == 57u) pressKey(7u, 1u);      // Caps -> LSHIFT
            else if (usage == 74u) pressKey(3u, 6u);      // Home
            else if (usage == 76u) pressKey(0u, 0u);      // Delete
            else if (usage == 79u) pressKey(2u, 0u);      // Cursor right
            else if (usage == 80u) { pressKey(2u, 0u); pressKey(7u, 1u); } // Cursor left
            else if (usage == 81u) pressKey(7u, 0u);      // Cursor down
            else if (usage == 82u) { pressKey(7u, 0u); pressKey(7u, 1u); } // Cursor up
            else if (usage == 225u) pressKey(7u, 1u);     // Left shift
            else if (usage == 229u) pressKey(4u, 6u);     // Right shift
            else if (usage == 224u || usage == 228u) pressKey(2u, 7u); // Ctrl
            else if (usage == 226u || usage == 230u || usage == 227u || usage == 231u) pressKey(5u, 7u); // C=
            else if (usage >= 58u && usage <= 65u) {
                // F1..F8 (F2/F4/F6/F8 use shifted C64 function keys).
                uint f = usage - 58u;
                uint pa = f < 2u ? 4u : (f < 4u ? 5u : (f < 6u ? 6u : 3u));
                pressKey(pa, 0u);
                if ((f & 1u) != 0u) pressKey(7u, 1u);
            }
        }
    }

    uint b = hbButtons();
    // A small set of controller shortcuts for users without a USB keyboard.
    if ((b & HB_X) != 0u)      pressKey(1u, 0u);   // Return
    if ((b & HB_Y) != 0u)      pressKey(7u, 7u);   // RUN/STOP
    if ((b & HB_PLUS) != 0u)   pressKey(1u, 0u);   // Return
    if ((b & HB_L) != 0u)      pressKey(7u, 1u);   // Left shift
    if ((b & HB_R) != 0u)      pressKey(4u, 6u);   // Right shift
    if ((b & (1u << 8u)) != 0u) pressKey(5u, 7u);  // ZL -> C=
    if ((b & (1u << 9u)) != 0u) pressKey(4u, 7u);  // ZR -> Space
}

void mapController() {
    uint b = hbButtons();
    joystick2 = 0u;
    if ((b & HB_UP) != 0u)    joystick2 |= 1u;
    if ((b & HB_DOWN) != 0u)  joystick2 |= 2u;
    if ((b & HB_LEFT) != 0u)  joystick2 |= 4u;
    if ((b & HB_RIGHT) != 0u) joystick2 |= 8u;
    // Plus doubles as the fire button so the pad can start a game on its own.
    if ((b & (HB_A | HB_B | HB_PLUS)) != 0u) joystick2 |= 16u;

    // Accept either analog stick, so a single detached Joy-Con works too.
    vec2 stickL = hbStick(false);
    vec2 stickR = hbStick(true);
    vec2 stick = length(stickL) >= length(stickR) ? stickL : stickR;
    if (stick.y > 0.45f)  joystick2 |= 1u;
    if (stick.y < -0.45f) joystick2 |= 2u;
    if (stick.x < -0.45f) joystick2 |= 4u;
    if (stick.x > 0.45f)  joystick2 |= 8u;

    mapKeyboard();
}

void resetMachine() {
    // Power-on processor port: RAM, BASIC, KERNAL and I/O visible.
    ramWrite(0x0000u, 0x2Fu);
    ramWrite(0x0001u, 0x37u);
    A = 0u; X = 0u; Y = 0u; SP = 0xFD; P = P_U | P_I;
    PC = readVector16(0xFFFCu);
    c64Total = 0u;
    c64Spent = 0u;
    currentLine = 0u;
    lineCycle = 0u;
    frameDone = false;
    irqLine = false;
    cpuHalted = false;
    mset(CPU_BASE + CPU_FRAMES, 0u);
    mset(CPU_BASE + CPU_REMAINDER, 0u);
    mset(META_BASE + META_INIT, 1u);
    mset(META_BASE + META_STAGE, 1u);
    mset(META_BASE + META_IDLE, 0u);
    mset(META_BASE + META_ERROR, 0u);
    copyVisibleFrame();
    updateIrq();
}

void loadCpu() {
    A = mget(CPU_BASE + CPU_A) & 0xFFu;
    X = mget(CPU_BASE + CPU_X) & 0xFFu;
    Y = mget(CPU_BASE + CPU_Y) & 0xFFu;
    SP = mget(CPU_BASE + CPU_SP) & 0xFFu;
    P = (mget(CPU_BASE + CPU_P) & 0xFFu) | P_U;
    PC = mget(CPU_BASE + CPU_PC) & 0xFFFFu;
    c64Total = mget(CPU_BASE + CPU_TOTAL);
    cpuHalted = mget(CPU_BASE + CPU_HALT) != 0u;
    currentLine = mget(CPU_BASE + CPU_LINE) % 312u;
    lineCycle = mget(CPU_BASE + CPU_LINECYCLE) % 63u;
    cyclesInFrame = 0u;
    frameDone = false;
    updateIrq();
}

void saveCpu() {
    mset(CPU_BASE + CPU_A, A);
    mset(CPU_BASE + CPU_X, X);
    mset(CPU_BASE + CPU_Y, Y);
    mset(CPU_BASE + CPU_SP, SP);
    mset(CPU_BASE + CPU_P, P);
    mset(CPU_BASE + CPU_PC, PC);
    mset(CPU_BASE + CPU_TOTAL, c64Total);
    mset(CPU_BASE + CPU_HALT, cpuHalted ? 1u : 0u);
    mset(CPU_BASE + CPU_LINE, currentLine);
    mset(CPU_BASE + CPU_LINECYCLE, lineCycle);
}

void saveFrameCounters(uint frames, uint remainder) {
    mset(CPU_BASE + CPU_FRAMES, frames);
    mset(CPU_BASE + CPU_REMAINDER, remainder);
}

#endif
