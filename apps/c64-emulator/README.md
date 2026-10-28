# C64 GPU

A Commodore 64 emulator that runs as an HBLauncher (GPUBrewLauncher) GPU app on
Nintendo Switch 2. The 6502, VIC-II subset, CIAs and memory map are emulated in a
single compute-shader invocation each display frame. The fragment shader draws
the resulting 320x200 picture.

This is a GPU app, not an NRO, native ARM64 program, or a general-purpose
machine-code loader. Everything the emulator executes is data prepared on the
PC at build time and uploaded by the launcher.

## Quick start

1. Put **exactly one** supported image in `ROM/`:

   - `*.prg` — C64 program
   - `*.d64` — disk image (first PRG is extracted)
   - `*.t64` — tape image (first normal file is extracted)
   - `*.rom` — raw 8 KiB or 16 KiB cartridge

2. From the repository root, run:

   ```sh
   ./start.sh
   ```

3. Select **C64 GPU**. The image is packed automatically at launcher startup
   and autostarts; there is no ROM menu inside the emulator.

If you change `ROM/` while the host is already running, restart `./start.sh`
(or run `node apps/c64-emulator/build.cjs`), then tap **Refresh** in the
launcher before opening the app.

`ROM/` is scanned on the PC. The console never reads the folder at runtime, so
the package still has to be uploaded by the host. The build also accepts the
legacy `programs/boot.prg` and `programs/cart.rom` locations when `ROM/` is
empty.

## Controls

| Input | C64 |
| --- | --- |
| D-pad / left stick | Joystick 2 (up, down, left, right) |
| A or B | Joystick 2 fire |
| X | Return |
| Y | RUN/STOP |
| Plus | Return |
| L / R | Left shift / right shift |
| ZL / ZR | C= / space |
| Minus | Return to HBLauncher |
| USB keyboard | C64 keyboard matrix (US layout) |

The keyboard is passed through as a physical C64 matrix, so SHIFT combinations
such as `SHIFT+2` (double quote) are resolved by the C64 KERNAL, not by the
host. The emulator does not consume the launcher's menu controls beyond the
buttons listed above.

## What is emulated

| Component | Coverage |
| --- | --- |
| CPU | NMOS 6502, all documented opcodes plus the common undocumented ones used by demos (LAX, SAX, DCP, ISB, SLO, RLA, SRE, RRA) |
| Memory | 64 KiB RAM, BASIC/KERNAL/character ROM banking, colour RAM, I/O window |
| VIC-II | Text, multicolour text, ECM, standard/multicolour bitmap, 8 sprites with X/Y expansion and priority, border/background, raster IRQ |
| CIA 1/2 | Port A/B, timers A/B, ICR, keyboard matrix, joystick |
| Interrupts | IRQ (CIA + VIC raster). NMI/RESTORE is not wired |
| Loader | One `ROM/` image autostarts: PRG, first PRG of D64/T64, or raw 8K/16K cartridge |
| SID | Registers are write-only stubs; **no sound** |

## How ROM loading works

The console cannot read files from the SD card or the host at runtime. There is
also no ROM picker inside the emulator: one image is selected at build time and
autostarted. `start.sh` calls `prepare.cjs`, which repacks only when `ROM/`, the
system ROMs, or the program files changed.

1. `build.cjs` reads `assets/roms/kernal.rom`, `basic.rom` and `chargen.rom`.
   They must be 8192, 8192 and 4096 bytes.
2. It scans `ROM/` and converts the single supported image to an autostart PRG:
   - `.prg` is used as supplied.
   - `.d64` is parsed and the first PRG in its directory chain is extracted.
   - `.t64` is parsed and the first normal tape file is extracted.
   - `.rom` is a raw 8K/16K cartridge image mapped at `$8000`.
3. Each byte is written as one 32-bit word into `assets/memory.bin` at the
   private-memory offsets described in
   [`docs/ROM-LOADING.md`](docs/ROM-LOADING.md).
4. The launcher uploads `memory.bin` as the private storage buffer at set 0,
   binding 1. The compute shader addresses it as `memory.words[]`, one word per
   emulated byte.
5. On the first dispatch the shader resets the CPU and reads the reset vector
   from `$FFFC` in the packed KERNAL. From that point the real KERNAL/BASIC
   ROMs boot the machine exactly as on hardware (at GPU speed).
6. The shader waits for the KERNAL's `READY.` prompt, copies the PRG from
   `program.bin` into C64 RAM, fixes the BASIC pointers, and injects `RUN`.
   A cartridge is started through the KERNAL's CBM80 check instead.

### D64 and T64 limits

D64 and T64 are **build-time containers**, not mounted drives. Only the first
runnable PRG is extracted and launched. This runs many single-file games,
demos and utilities, but not titles that load extra files from disk or tape, or
that use a custom fast loader. Those need a 1541/datasette, which is not
emulated. `.crt` containers are also unsupported; use a raw 8K/16K `.rom`,
`.prg`, `.d64` or `.t64`.

### Using your own ROM set

```sh
cp /path/to/kernal.rom apps/c64-emulator/assets/roms/kernal.rom
cp /path/to/basic.rom  apps/c64-emulator/assets/roms/basic.rom
cp /path/to/chargen.rom apps/c64-emulator/assets/roms/chargen.rom
node apps/c64-emulator/build.cjs
```

Use 8 KiB KERNAL and BASIC images and a 4 KiB character generator. A combined
16 KiB `kernal.rom` from some emulator packages must be split first.

The included ROMs are the **Open ROMs** LGPL replacements, not Commodore ROMs.
See `assets/roms/OPEN-ROMS-LICENSE.txt`. Commodore ROM images remain the
copyright of their owners; supply your own legally obtained copies.

### Loading a program

Put one file in `ROM/`. The extension decides how it is handled:

- **`*.prg`** — first two bytes are the load address. A PRG at `$0801` is
  started with `RUN`; other addresses are jumped to directly with a fresh
  stack. The build rewrites `SYS(...)` to `SYS ...` in a tokenized BASIC stub
  because Open ROMs BASIC rejects the parenthesised form; without that, many
  commercial BASIC stubs stop with `?SYNTAX ERROR IN <line>`.
- **`*.d64`** — the first PRG in the disk directory is extracted and treated as
  above. Only single-file programs work.
- **`*.t64`** — the first normal tape file is extracted and treated as above.
  Only single-file programs work.
- **`*.rom`** — raw 8 KiB or 16 KiB cartridge. It is mapped at `$8000` (and
  `$A000` for 16 KiB) and the KERNAL's autostart path runs it. The image must
  contain the PETSCII screen-code `CBM80` signature `$C3 $C2 $CD $38 $30` at
  offsets `$0004-$0008` (`$8004-$8008` in C64 memory). `.crt` containers are
  not supported.

There is no menu. The selected image starts as soon as the app is opened. If
`ROM/` is empty, the legacy locations are used:

- `programs/boot.prg` — a BASIC or machine-code PRG.
- `programs/cart.rom` — a raw 8 KiB or 16 KiB cartridge; takes priority over
  `boot.prg`.
- Otherwise the build packs the small built-in demo. To keep the BASIC prompt
  and start nothing automatically, run
  `C64_BOOT_BASIC=1 node apps/c64-emulator/build.cjs`.

`start.sh` repacks automatically when `ROM/`, the system ROMs, or the legacy
program files change. If the host is already running, restart it or run
`node apps/c64-emulator/build.cjs`, then tap **Refresh**. The launcher restores
the packaged initial memory on every launch; there is no save state.

## Layout of the package

```text
apps/c64-emulator/
  app.json              manifest (1 MiB private memory, data, shaders)
  build.cjs             ROM/PRG packer and shader build
  prepare.cjs           repacks when ROM/ or ROM files change
  rom-tools.cjs         PRG/D64/T64/cartridge converter
  rom-tools.test.cjs    converter tests
  assets.py             icon generator
  ROM/                  put exactly one PRG/D64/T64/ROM here
  assets/
    roms/               Open ROMs + licence
    memory.bin          generated initial private memory (one uint per byte)
    program.bin         generated 32-byte header + PRG/cartridge payload
    rom-stamp.json      generated input fingerprint for auto-repacking
    state.bin           generated 1024-byte ABI state
    icon.png            generated launcher icon
  shaders/
    app.comp            per-frame driver and cycle budget
    app.frag            C64 palette, 4x display, border and scanlines
    c64-core.glsl       6502, CIA, VIC-II and loader
    opcodes.glsl        generated 6502 opcode/mode/cycle tables
  programs/
    boot.prg            optional legacy program location
    cart.rom            optional legacy cartridge location
  docs/ROM-LOADING.md   exact loader and memory format
```

## Limitations

- **No audio.** SID registers exist so programs do not crash, but nothing is
  synthesised and the launcher is silent.
- **Partial VIC-II.** Badline timing, sprite collisions, open borders, FLI and
  the VIC's exact fetch pipeline are not cycle-accurate. Most BASIC programs,
  text adventures and simple games render correctly; demanding demos will not.
- **No NMI / RESTORE.** The RESTORE key is not delivered.
- **No runtime disk or tape.** There is no 1541, datasette, KERNAL LOAD/SAVE
  or filesystem. D64/T64 images are unpacked at build time and only their first
  runnable PRG is started; multi-file titles and custom fast loaders do not
  work. Programs must otherwise be self-contained PRGs or cartridge images.
- **No `.crt`, bank-switched or EF/REU cartridges.** Only raw 8K/16K images
  with the PETSCII `CBM80` signature at `$8004`.
- **No save states.** Each launch starts from the packaged memory image.
- **Timing.** The CPU advances at the PAL rate (985,248 cycles/second) spread
  over 60 launcher frames. The picture updates when a PAL frame completes
  (about 50 Hz), so display motion can repeat frames on a 60 Hz panel.
- **No PAL/NTSC switch.** The raster is fixed at 312 lines x 63 cycles.
- **Undocumented opcodes** cover the common stable set, not every unstable
  NMOS behaviour.
- **No cartridge RAM, REU, or second SID.**
- **Keyboard layout** assumes a US USB keyboard. Non-US layouts may map
  punctuation differently.

## Performance note

The compute shader emulates about 16,421 cycles per dispatch. That is enough
for BASIC and modest games, but the emulator runs as a single GPU invocation,
so heavy raster effects and sprite-heavy scenes cost more on the GPU. If a
program is too slow, simplify the scene or reduce the emulated resolution by
editing `renderLine` in `shaders/c64-core.glsl`.
