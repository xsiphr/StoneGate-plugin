# StoneGate 🔒

A lock screen plugin for Obsidian that protects your vault and individual 
folders with password authentication.

## Features

- **Vault & Folder Protection** — Lock your entire vault or specific folders
  with individual passwords
- **Per-Path Passwords** — Each protected path can have its own password,
  independent from the master password
- **Password Hints** — Optional hints shown on the lock screen to help you
  remember your password
- **Idle Auto-Lock** — Automatically locks after a configurable period of
  inactivity (supports decimal minutes, e.g. 0.5 = 30 seconds)
- **Lock on Startup** — Immediately shows lock screen when Obsidian opens,
  before any vault content is visible
- **Tamper Protection** — MutationObserver prevents the overlay from being
  removed via browser DevTools
- **Back Navigation** — If you navigate to a locked folder, a back button
  returns you to where you were
- **Command Palette** — Lock your vault instantly via Ctrl+P
- **Custom Hotkey** — Assign a keyboard shortcut to lock vault in
  Settings → Hotkeys
- **Lockout** — Configurable failed attempt limit with timed lockout

## Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the
   latest release
2. Create a folder at `<vault>/.obsidian/plugins/stonegate/`
3. Copy the 3 files into that folder
4. Open Obsidian → Settings → Community Plugins → Enable StoneGate

## Usage

1. Go to **Settings → StoneGate**
2. Toggle **Enable StoneGate** ON — you will be prompted to set a password
3. Configure protected paths under **Protected Paths**
4. Optionally set per-path passwords via the **Edit** button on each path

## Security Note

StoneGate provides a **lock screen layer** — it does not encrypt your files
on disk. For full disk-level encryption, consider using `gocryptfs` or
similar tools alongside this plugin.
