GPUBrewLauncher — SETUP AND RUN GUIDE
=====================================

GPUBrewLauncher is a homebrew app launcher for Nintendo Switch 2 that runs
through SmileBASIC4. Apps live on a Linux computer and appear in an on-console
menu. Selecting one launches it, and leaving it returns to the menu.

This guide covers installation, first launch and normal use. For package and
graphics internals, see [REFERENCE.md](REFERENCE.md); for building your own
apps, see [sdk/README.md](sdk/README.md).

What you need
-------------
- Nintendo Switch 2 on system software 23.0.1
- SmileBASIC4 4.4.9
- bootstrap.bas saved on the console as NS2 in slot 0
- more than 20 MiB free in the SmileBASIC save
- a Linux computer on the same reachable network as the console
- Node.js 22 or newer on the computer

If bootstrap.bas is not saved as NS2 yet, open smilebasic/bootstrap.bas in
SmileBASIC's program editor and enter it exactly, preserving punctuation, line
breaks and character case. Save it as NS2. A USB keyboard makes this easier.


1. INSTALL THE HOST TOOLS
-------------------------

Extract the project and open a terminal in its folder. The folder contains
start.sh, README.md, smilebasic/, sdk/ and apps/.

On Ubuntu/Debian:

  sudo apt-get update
  sudo apt-get install python3 python3-pil fonts-dejavu-core spirv-tools

Check the host:

  node scripts/doctor.cjs

Every line should say OK. The normal start script runs this check automatically.
Building apps also needs glslang-tools; check it with:

  node scripts/doctor.cjs --build

Desktop GPU tests need a C compiler, libvulkan-dev and a Vulkan driver.

The host finds the computer's LAN address automatically. To see the candidates
without starting a session:

  ./start.sh --list

If the computer has both Wi-Fi and Ethernet, ./start.sh lists every candidate
with its interface name and asks which one shares the console's network. You can
also pass that address directly to skip the prompt:

  ./start.sh 192.0.2.10

Use the address of the interface that shares a network with the console. If
unsure, check whether the console is connected over Wi-Fi or Ethernet in its
network settings. Do not use 127.0.0.1, a VPN-only address, or the console's own
address. `hostname -I` and `ip -4 addr` show the machine's addresses. The console must
be able to reach the computer on TCP 39380. Allow that port through the local
firewall and do not expose it to the public internet.


2. START THE HOST
-----------------

1. Close and reopen SmileBASIC4 so it is a fresh application process. Open
   Direct mode and leave it focused. Do not resume a previously failed native
   session.

2. From the project folder, start the host:

     ./start.sh

   If it lists more than one LAN address, choose the one on the Switch 2's
   network. To skip the prompt, pass the address shown by ./start.sh --list:

     ./start.sh 192.0.2.10

   The host prints something like:

     Graphics listener ready on 192.0.2.10:39380.
     In fresh SmileBASIC Direct mode, enter:
       LOAD "TXT:NS2"
       RUN
       REMOVE NSR,&H60000000,&H3FFFFFFF
     Then enter this session command:
       V=START(39380,192,0,2,10,0,0,0,0)

   Use the V=START line printed by the current run; the address decimals in it
   are the computer address you chose. The four trailing values are always
   0,0,0,0. The command has no per-run secret, so only run the host on a trusted
   local network. Do not expose TCP 39380 to the internet.

3. In SmileBASIC4 Direct mode, enter these lines separately:

     LOAD "TXT:NS2"

   Confirm the load if SmileBASIC4 asks. Then:

     RUN

   The bootstrap prints DIST BOOT READY and returns to Direct mode. Then:

     REMOVE NSR,&H60000000,&H3FFFFFFF

   The "Out of memory" response is expected and is part of the sequence. Then
   enter the V=START line printed by the current host.

4. Wait for the host to qualify the native session and start the graphics and
   SDK stages. The console display stays black during preparation, then
   GPUBrewLauncher fades in. This can take a little while.

5. Keep the host running and the computer awake for the whole session.

Enter REMOVE only once in the same SmileBASIC process. If a launch fails, close
and restart SmileBASIC (restart the console if needed) before trying again.
Reuse the saved NS2 program, not an old session's command or addresses.


3. USE THE LAUNCHER
-------------------

  - D-pad Up/Down or the left stick selects an app; A opens it.
  - Touch an app row to launch it, or touch Refresh to rescan the apps/ folder.
  - Move the right stick to control the pointer in handheld mode; ZR clicks the
    hovered row or Refresh.
  - A detached Joy-Con 2 in optical-mouse position moves the same pointer.
    L clicks while the left Joy-Con tracks; R clicks while the right tracks.
    ZR also clicks. The pointer hides when optical tracking stops unless it was
    activated with the right stick.
  - The sun/moon switch next to Back turns dark mode on and off. Tap a side,
    drag the knob, or press A or ZR while the pointer is over it. The setting
    lasts for the current launcher session.
  - While the pointer is visible, A acts on whatever is under it: an app row
    launches, the switch toggles, and blank space does nothing. With the
    pointer hidden, A opens the highlighted row.
  - Hello World returns to the menu with B or Minus.
  - D-pad Left/Right do not change the catalog.

Apps are immediate subdirectories of apps/ on the computer. To update an app,
return to the menu, replace its folder, press Refresh, then relaunch. To remove
one, move its folder out of apps/ and press Refresh. Hidden directories are
ignored. Nothing needs to be copied to the console SD card.


4. STOP, RETRY OR REPAIR
------------------------

Press Ctrl+C in the host terminal to stop its processes. Restart SmileBASIC4 to
release retained native allocations before a new session.

If the console never connects:
  - Check the address printed by ./start.sh and confirm it is on the console's
    network. ./start.sh --list shows every detected Wi-Fi/Ethernet address.
  - Check TCP 39380 and local-network/client isolation.
  - Check that Direct mode is focused and NS2 is saved in slot 0.
  - Verify the exact SmileBASIC and system versions listed above.
  - Restart SmileBASIC or the console after a failed attempt.

If V=START is rejected:
  - Check the computer address and TCP port 39380.
  - Confirm the four trailing values are 0,0,0,0.

If LOAD fails:
  - Confirm the program is saved as NS2 in slot 0.
  - Re-enter smilebasic/bootstrap.bas exactly if the saved source is damaged.

If a tool is missing:
  - Run node scripts/doctor.cjs and fix every NEED line.

If an app is missing:
  - Check its app.json, return to the menu, press Refresh, and inspect
    catalog.rejected in the session's app-runtime.json. Start the host with
    HB_KEEP_SESSION=1 to retain that session under runs/ and print its path.

Session files are temporary and are deleted when the program exits. Retained
sessions under runs/launcher-* contain local addresses, connection tokens and
memory captures; keep them private and do not ship them in app packages or
public bug reports.


CONSOLE INPUT AT A GLANCE
-------------------------

In a fresh SmileBASIC4 Direct mode:

  LOAD "TXT:NS2"
  RUN
  REMOVE NSR,&H60000000,&H3FFFFFFF
  V=START(<the line printed by the current host>)

That is the complete manual console sequence.

See [sdk/README.md](sdk/README.md) to build your own apps,
[REFERENCE.md](REFERENCE.md) for the technical reference, and
[CREDITS](CREDITS) for project attribution.
