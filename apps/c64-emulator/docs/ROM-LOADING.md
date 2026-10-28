# How ROM and program loading works

This app has no runtime filesystem access. The Switch 2 side only sees the
package that the HBLauncher host scanned and uploaded. "Loading a ROM" therefore
means **putting one image in `ROM/` on the PC, rebuilding the package, and
relaunching**. `start.sh` runs `prepare.cjs`, which repacks automatically when
`ROM/` changed. There is no emulator file dialog, no SD-card path, no ROM menu,
and no 1541 emulation.

The one image in `ROM/` is autostarted when the app opens. If `ROM/` is empty,
the legacy `programs/` locations and the built-in demo are used.

## 1. Package inputs

| File | Required | Size | Purpose |
| --- | --- | --- | --- |
| `ROM/*.prg` | optional | 3..65538 | autostarted PRG |
| `ROM/*.d64` | optional | 174848..206114 | disk image; first PRG extracted |
| `ROM/*.t64` | optional | >= 96 | tape image; first normal file extracted |
| `ROM/*.rom` | optional | 8192 or 16384 | raw cartridge image |
| `assets/roms/kernal.rom` | yes | 8192 | `$E000-$FFFF` KERNAL |
| `assets/roms/basic.rom` | yes | 8192 | `$A000-$BFFF` BASIC |
| `assets/roms/chargen.rom` | yes | 4096 | VIC-II character generator |
| `programs/boot.prg` | legacy | 3..65538 | BASIC or machine-code PRG |
| `programs/cart.rom` | legacy | 8192 or 16384 | raw cartridge image |

`ROM/` accepts **exactly one** supported image. If it contains more than one,
the build stops with an error. If it is empty, `programs/cart.rom` is used when
present, then `programs/boot.prg`/`demo.prg`; otherwise `build.cjs` generates a
small BASIC demo (print `C64 ON GPU` and set the border/background colours).

### ROM/ conversion

The app has no internal ROM selection screen. One image is converted into the
payload in `assets/program.bin`:

- `.prg` is used as supplied and autostarted at its load address. If it loads
  at `$0801` and contains a tokenized `SYS(...)` statement, the build replaces
  the two parentheses with spaces. Open ROMs BASIC rejects the parenthesised
  form that BASIC 2.0 accepts; the length and all addresses are unchanged.
- `.d64` is parsed with the standard 1541 directory and sector-chain layout.
  The first PRG entry is extracted, including its two-byte load address. D64
  images of 35, 40 and 42 tracks, with or without the error-byte block, are
  accepted.
- `.t64` is parsed and the first normal tape file is converted to a PRG using
  its start/end addresses. C64S snapshots and other exotic T64 record types are
  not supported.
- `.rom` must be a raw 8 KiB or 16 KiB cartridge with the PETSCII `CBM80`
  signature at `$8004`.

D64/T64 conversion is single-file only. A title that loads more files after
starting, or that talks to a 1541/datasette directly, will not run. There is no
disk or tape emulation at runtime.

The shipped ROMs are the LGPL **Open ROMs**. Replace them with any compatible
8K/8K/4K set. Commodore ROMs are copyrighted; use images you are legally
entitled to use.

## 2. Packed memory layout

`assets/memory.bin` is a little-endian array of 32-bit words, one word per
emulated byte. The words live in the private storage buffer (`set=0,
binding=1`). The shader declares:

```glsl
layout(set=0, binding=1, std430) buffer PrivateMemory { uint words[]; } memory;
```

| Word offset | Bytes | Content |
| --- | --- | --- |
| `0x00000` | 65536 | C64 RAM (`$0000-$FFFF`) |
| `0x10000` | 8192 | BASIC ROM (`$A000-$BFFF`) |
| `0x12000` | 8192 | KERNAL ROM (`$E000-$FFFF`) |
| `0x14000` | 4096 | Character ROM |
| `0x15000` | 16384 | Cartridge ROM (zero-padded for 8K images) |
| `0x19000` | 1024 | Colour RAM (`$D800-$DBFF`) |
| `0x19400` | 64 | VIC-II register file (`$D000-$D03F`) |
| `0x19440` | 32 | CIA #1 |
| `0x19460` | 32 | CIA #2 |
| `0x19480` | 32 | SID stub |
| `0x19500` | 12 | CPU checkpoint (A, X, Y, SP, P, PC, cycles, line, ...) |
| `0x19540` | 8 | Loader metadata |
| `0x20000` | 64000 | Front framebuffer (320x200) |
| `0x30000` | 64000 | Back framebuffer (320x200) |

Why one word per byte? It makes every 6502 memory access a single `uint` load
or store. Packing four bytes per word would need shifts and masks in the hot
path and make self-modifying code and stack operations harder to reason about.
1 MiB of private storage is well below the launcher's 32 MiB limit and holds
the whole machine comfortably.

## 3. Reset

On the first dispatch (`META_INIT == 0`) the shader:

1. Writes the C64 processor-port defaults `$0000 = $2F`, `$0001 = $37`
   (BASIC, KERNAL and I/O visible).
2. Sets `A=X=Y=0`, `SP=$FD`, `P=$24`.
3. Reads the reset vector through the memory map:
   `PC = [$FFFC] | [$FFFD] << 8`.
4. Starts executing real KERNAL code. With the included Open ROMs the vector is
   `$FCE2`, so the normal KERNAL/BASIC cold start runs, prints the startup
   banner and reaches `READY.`.

The CPU state, raster line and cycle phase are checkpointed at the end of each
dispatch and restored on the next one. The emulator therefore continues exactly
where it stopped, even though the compute shader is restarted every frame.

## 4. PRG autostart

`program.bin` starts with a 32-byte header:

| Offset | Size | Meaning |
| --- | --- | --- |
| 0 | 4 | ASCII `C64P` |
| 4 | 4 | format version (1) |
| 8 | 4 | payload length in bytes |
| 12 | 4 | load address |
| 16 | 4 | type: 1 PRG, 2 8K cart, 3 16K cart |
| 20 | 4 | ROM flags (bit 0 KERNAL, 1 BASIC, 2 CHARGEN) |
| 24 | 4 | payload length again (informational) |
| 28 | 4 | reserved |
| 32 | ... | PRG bytes, including its two-byte load address |

The header duplicates the values in the loader metadata words so the file is
self-describing if you inspect it separately.

D64 and T64 images are converted to this PRG form during the build; only their
first runnable file is used. A raw 8K/16K `.rom` takes the cartridge path in
section 5 instead.

After reset the shader watches screen RAM `$0400` for the six screen codes that
spell `READY.` (`18, 5, 1, 4, 25, 46`). Once found, it waits eight frames so the
KERNAL has finished setting up its keyboard buffer, then:

1. Copies the PRG body (payload offset 32 + 2) to RAM at the load address.
2. For a `$0801` load, sets the BASIC pointers `$2B/$2C` (start of program),
   `$2D/$2E` (start of variables), `$2F/$30` (end of arrays) and `$31/$32`
   (end of strings) to the end of the program.
3. Writes `R`, `U`, `N`, RETURN into the keyboard buffer at `$0277` and sets the
   buffer count at `$C6` to 4.
4. Marks the loader as done. The KERNAL's keyboard IRQ consumes the buffer and
   BASIC executes `RUN`.

For a PRG whose load address is not `$0801` (a machine-code loader or a
non-BASIC program), the shader jumps directly to the load address with a fresh
stack instead of using BASIC.

This works for the common case of a single-file PRG. It does not decompress
multi-part programs, attach disk images, or emulate a 1541.

## 5. Cartridge images

A raw 8 KiB or 16 KiB image is copied to `CART_BASE` at build time. Put it at
`ROM/<name>.rom`, or use the legacy `programs/cart.rom` location. While a
cartridge is present:

- `$8000-$9FFF` reads come from the image (ROML).
- `$A000-$BFFF` reads also come from the image for 16 KiB images (ROMH).
- Writes still go to the RAM underneath, as on hardware.

The KERNAL's reset code checks for the autostart signature before jumping
through the vector at `$8000`. The signature is the five PETSCII screen codes
for `CBM80`, written as bytes `$C3 $C2 $CD $38 $30` at image offsets
`$0004-$0008`, which is C64 address `$8004-$8008`. Note that these are PETSCII
screen codes, not ASCII: a file containing the ASCII text `CBM80` will not
autostart. `$8000/$8001` hold the cold-start vector and `$8002/$8003` the
warm-start vector.

This supports standard 8K/16K cartridge images without bank switching. `.crt`
files wrap the same data in a container plus chip-specific metadata; this app
does not parse that container.

## 6. Replacing a ROM

Replace the single file in `ROM/`. `start.sh` repacks automatically at startup;
if the host is already running, run `node apps/c64-emulator/build.cjs` instead,
then return to the launcher and press **Refresh**. Removing the file and
restarting returns to the legacy program or the built-in demo.

The launcher fingerprints the manifest and assets and uploads the packaged
`memory.bin` and `program.bin`. If you edit those by hand, the host sees a
changed package; return to the menu, rebuild, refresh and relaunch. Each launch
restores the packaged initial memory.

## 7. Legal notes

- Open ROMs are distributed under the LGPL; their notice is kept in
  `assets/roms/OPEN-ROMS-LICENSE.txt`.
- Commodore 64 ROMs, cartridge images and PRGs have their own copyright status.
  The build script only copies files you provide; it downloads nothing.
