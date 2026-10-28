# Put one C64 image here

Drop **exactly one** supported image into this folder:

| File | What happens |
| --- | --- |
| `*.prg` | Loaded at its own address and started automatically |
| `*.d64` | The first PRG in the disk directory is extracted and started |
| `*.t64` | The first normal tape file is extracted and started |
| `*.rom` | Raw 8 KiB or 16 KiB cartridge, started through the CBM80 vector |

Then start GPUBrewLauncher normally (`./start.sh`). The host repacks the C64
package automatically when this folder changed. Select **C64 GPU** and the ROM
starts directly; there is no ROM menu inside the emulator.

Only the formats above are supported. `.crt` containers are not. D64/T64
support is single-file only: the first runnable PRG is extracted at build time.
Games that load further files from disk/tape or use custom fast loaders need a
1541/datasette, which is not emulated.

If this folder is empty, the emulator uses the legacy `programs/boot.prg` or
`programs/cart.rom` location, or the built-in demo. See `../README.md` and
`../docs/ROM-LOADING.md`.
