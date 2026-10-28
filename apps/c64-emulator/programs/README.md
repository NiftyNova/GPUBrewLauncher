# Programs

The primary place for a program is `../ROM/`; put exactly one `.prg`, `.d64`,
`.t64` or `.rom` there. This folder is the legacy fallback used when `ROM/` is
empty.

Put one of these here before running `node apps/c64-emulator/build.cjs`:

- `boot.prg` - a BASIC or machine-code PRG. The first two bytes are its load
  address. A `$0801` program is started with `RUN`; other addresses are jumped
  to directly.
- `cart.rom` - a raw 8 KiB or 16 KiB cartridge image with the PETSCII
  screen-code `CBM80` signature (`$C3 $C2 $CD $38 $30` at `$0004-$0008`). It
  takes priority over `boot.prg`.

If neither file exists, the build generates a small built-in BASIC demo that
prints `C64 ON GPU` and sets the border and background colours. Set
`C64_BOOT_BASIC=1` to skip the demo and leave the machine at the BASIC prompt.

Files are packed into the app package at build time. The console does not read
this folder at runtime. See `../docs/ROM-LOADING.md` for the exact format and
autostart sequence.
