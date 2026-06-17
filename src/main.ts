import { Plugin } from "obsidian";
import { StoneGateSettings } from "./types";
import { DEFAULT_SETTINGS } from "./constants";
import { LockManager } from "./lock-manager";
import { LockOverlay } from "./overlay";
import { StoneGateSettingTab, ConfirmPasswordModal } from "./settings";
import { UnlockPathModal } from "./unlock-path-modal";

export default class StoneGatePlugin extends Plugin {
  settings!: StoneGateSettings;
  lockManager!: LockManager;
  overlay!: LockOverlay;
  private currentFilePath: string | null = null;

  async onload() {
    await this.loadSettings();

    // Initialize overlay first
    this.overlay = new LockOverlay(this.app, this.settings, async () => {
      await this.saveSettings();
    });
    this.lockManager = new LockManager(this.app, this.settings, this.overlay);

    const isLockedOut = this.settings.lockoutUntil && Date.now() < this.settings.lockoutUntil;
    if (isLockedOut) {
      const defaultPath = this.settings.protectedPaths.find(p => p.id === "default" || p.path === "/");
      if (defaultPath) {
        this.lockManager.lockAll();
        this.overlay.show(defaultPath, null, (success) => {
          if (success) {
            this.lockManager.unlock(defaultPath.id);
          }
        });
      }
    } else if (this.settings.enabled && this.settings.lockOnStartup) {
      const defaultPath = this.settings.protectedPaths.find(p => p.id === "default" || p.path === "/");
      if (defaultPath && (defaultPath.passwordHash || this.settings.passwordHash)) {
        this.overlay.show(defaultPath, null, (success) => {
          if (success) {
            this.lockManager.unlock(defaultPath.id);
          }
        });
      }
    }

    // Watch for file open events
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        const file = this.app.workspace.getActiveFile();
        const newPath = file ? file.path : null;

        if (this.currentFilePath !== newPath) {
          this.lockManager.setPreviousFile(this.currentFilePath);
        }

        this.lockManager.handleFileOpen(file);
        this.currentFilePath = newPath;
      })
    );

    this.addSettingTab(new StoneGateSettingTab(this.app, this));

    this.addCommand({
      id: "lock-vault",
      name: "Lock vault now",
      callback: () => {
        if (this.settings.enabled) {
          const defaultPath = this.settings.protectedPaths.find(p => p.id === "default" || p.path === "/");
          if (defaultPath && (defaultPath.passwordHash || this.settings.passwordHash)) {
            this.lockManager.lockAll();
            this.overlay.show(defaultPath, this.lockManager.getPreviousFile(), (success) => {
              if (success) {
                this.lockManager.unlock(defaultPath.id);
              }
            });
          }
        }
      },
    });

    this.addCommand({
      id: "lock-folder",
      name: "Lock current folder",
      callback: () => {
        const file = this.app.workspace.getActiveFile();
        if (file && this.settings.enabled) {
          const matchingPath = this.lockManager.getMatchingPath(file.path);
          if (matchingPath && (matchingPath.passwordHash || this.settings.passwordHash)) {
            this.lockManager.lock(matchingPath.id);
            this.lockManager.triggerLock(file.path);
          }
        }
      },
    });

    this.addCommand({
      id: "unlock-path",
      name: "Unlock hidden/locked path",
      callback: () => {
        if (!this.settings.enabled) return;

        const openUnlockMenu = () => {
          new UnlockPathModal(this.app, this).open();
        };

        if (this.settings.unlockMenuPasswordHash && this.settings.unlockMenuPasswordSalt) {
          new ConfirmPasswordModal(
            this.app,
            this,
            this.settings.unlockMenuPasswordHash,
            this.settings.unlockMenuPasswordSalt,
            "Unlock Menu",
            (success) => {
              if (success) {
                openUnlockMenu();
              }
            },
            this.settings.unlockMenuPasswordHint
          ).open();
        } else {
          openUnlockMenu();
        }
      },
    });
  }

  onunload() {
    this.overlay.dispose();
    this.lockManager.dispose();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.overlay.updateSettings(this.settings);
    this.lockManager.updateSettings(this.settings);
  }
}
