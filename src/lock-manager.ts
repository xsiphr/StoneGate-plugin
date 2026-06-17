import { App, TAbstractFile } from "obsidian";
import { StoneGateSettings, ProtectedPath } from "./types";
import { LockOverlay } from "./overlay";

type StateChangeCallback = (locked: boolean) => void;

export class LockManager {
  private app: App;
  private settings: StoneGateSettings;
  private overlay: LockOverlay;
  
  // pathId -> timestamp when last unlocked
  private unlockedPaths: Map<string, number> = new Map();
  private previousFile: string | null = null;
  
  private idleTimerId: number | null = null;
  private blurTimerId: number | null = null;
  private lastActivityTime = Date.now();

  private onStateChangeCallbacks: StateChangeCallback[] = [];

  private boundActivityHandler = this.throttleActivity.bind(this);
  private boundBlurHandler = this.handleWindowBlur.bind(this);
  private boundFocusHandler = this.handleWindowFocus.bind(this);

  // Used for throttling activity updates (max once per second)
  private activityUpdatePending = false;

  constructor(app: App, settings: StoneGateSettings, overlay: LockOverlay) {
    this.app = app;
    this.settings = settings;
    this.overlay = overlay;

    this.setupListeners();
    this.startIdleChecker();
    this.updateGhostModeStyles();
  }

  updateSettings(settings: StoneGateSettings) {
    this.settings = settings;
    // Check if any paths should lock due to new settings
    this.checkTimeouts();
    this.updateGhostModeStyles();
  }

  private setupListeners() {
    document.addEventListener("mousemove", this.boundActivityHandler);
    document.addEventListener("keydown", this.boundActivityHandler);
    document.addEventListener("mousedown", this.boundActivityHandler);
    document.addEventListener("touchstart", this.boundActivityHandler);
    window.addEventListener("blur", this.boundBlurHandler);
    window.addEventListener("focus", this.boundFocusHandler);
  }

  private throttleActivity() {
    if (this.activityUpdatePending) return;
    this.activityUpdatePending = true;
    setTimeout(() => {
      this.lastActivityTime = Date.now();
      this.activityUpdatePending = false;
    }, 1000);
  }

  private startIdleChecker() {
    // Single recursive setTimeout, runs every 10 seconds
    const check = () => {
      this.checkTimeouts();
      this.idleTimerId = window.setTimeout(check, 10000);
    };
    this.idleTimerId = window.setTimeout(check, 10000);
  }

  private checkTimeouts() {
    const now = Date.now();
    let lockOccurred = false;

    for (const path of this.settings.protectedPaths) {
      const idleTimeMinutes = (now - this.lastActivityTime) / 1000 / 60;
      
      if (idleTimeMinutes >= path.timeoutMinutes) {
        if (this.unlockedPaths.has(path.id)) {
          this.unlockedPaths.delete(path.id);
          lockOccurred = true;
        }
      }
    }

    if (lockOccurred) {
      this.notifyStateChange(true);
    }
    
    const currentFile = this.app.workspace.getActiveFile();
    if (currentFile && this.isLocked(currentFile.path)) {
      const matchingPath = this.getMatchingPath(currentFile.path);
      if (matchingPath) {
        const idleTimeMinutes = (now - this.lastActivityTime) / 1000 / 60;
        if (idleTimeMinutes >= matchingPath.timeoutMinutes) {
          if (!this.overlay.isVisible()) {
            this.triggerLock(currentFile.path);
          }
        }
      }
    }
  }

  public getMatchingPath(filePath: string): ProtectedPath | null {
    // Return the deepest matching protected path
    let match: ProtectedPath | null = null;
    let longestPathLength = -1;

    for (const p of this.settings.protectedPaths) {
      if (p.path === "" || p.path === "/") {
        if (longestPathLength < 0) {
          match = p;
          longestPathLength = 0;
        }
      } else if (filePath === p.path || filePath.startsWith(p.path + "/")) {
        if (p.path.length > longestPathLength) {
          match = p;
          longestPathLength = p.path.length;
        }
      }
    }
    return match;
  }

  public getPreviousFile(): string | null {
    return this.previousFile;
  }

  public setPreviousFile(filePath: string | null) {
    this.previousFile = filePath;
  }

  public isLocked(filePath: string): boolean {
    if (!this.settings.enabled) return false;
    
    const matchingPath = this.getMatchingPath(filePath);
    if (!matchingPath) return false; // Not protected

    if (!matchingPath.passwordHash && !this.settings.passwordHash) return false;

    return !this.unlockedPaths.has(matchingPath.id);
  }

  public triggerLock(filePath: string) {
    if (!this.settings.enabled) return;
    
    const matchingPath = this.getMatchingPath(filePath);
    if (!matchingPath) return;

    if (!matchingPath.passwordHash && !this.settings.passwordHash) return;

    if (this.overlay.isVisible()) return;

    this.overlay.show(matchingPath, this.previousFile, (success: boolean) => {
      if (success) {
        this.unlock(matchingPath.id);
      } else {
        // Failed unlock, navigate away? We keep it locked.
        // If they hit escape, we shouldn't get here because we block escape.
      }
    });
  }

  public unlock(pathId: string) {
    const now = Date.now();
    this.unlockedPaths.set(pathId, now);
    const pathObj = this.settings.protectedPaths.find(p => p.id === pathId);
    if (pathObj) {
      pathObj.lastUnlocked = now;
    }
    this.notifyStateChange(false);
    this.updateGhostModeStyles();
  }

  public lock(pathId: string) {
    this.unlockedPaths.delete(pathId);
    this.notifyStateChange(true);
    this.updateGhostModeStyles();
  }

  public lockAll() {
    this.unlockedPaths.clear();
    this.notifyStateChange(true);
    this.updateGhostModeStyles();
  }

  public onLockStateChange(callback: StateChangeCallback) {
    this.onStateChangeCallbacks.push(callback);
  }

  private notifyStateChange(locked: boolean) {
    for (const cb of this.onStateChangeCallbacks) {
      cb(locked);
    }
  }

  public handleFileOpen(file: TAbstractFile | null) {
    if (!file) return;
    // Navigating between files counts as user activity
    this.lastActivityTime = Date.now();
    if (this.isLocked(file.path)) {
      this.triggerLock(file.path);
    }
  }

  private handleWindowBlur() {
    if (!this.settings.enabled || !this.settings.lockOnBlur) return;
    
    if (this.blurTimerId !== null) {
      window.clearTimeout(this.blurTimerId);
    }
    
    const gracePeriod = this.settings.blurGracePeriodSeconds ?? 3;
    if (gracePeriod <= 0) {
      this.executeBlurLock();
    } else {
      this.blurTimerId = window.setTimeout(() => {
        this.executeBlurLock();
        this.blurTimerId = null;
      }, gracePeriod * 1000);
    }
  }

  private handleWindowFocus() {
    if (this.blurTimerId !== null) {
      window.clearTimeout(this.blurTimerId);
      this.blurTimerId = null;
    }
  }

  private executeBlurLock() {
    // Lock all paths
    this.lockAll();
    
    // If there is an active file, trigger the lock overlay so it is ready when they return
    const currentFile = this.app.workspace.getActiveFile();
    if (currentFile) {
      this.triggerLock(currentFile.path);
    } else {
      // If no active file but we locked everything, trigger lock on the default path
      const defaultPath = this.settings.protectedPaths.find(p => p.id === "default" || p.path === "/");
      if (defaultPath && (defaultPath.passwordHash || this.settings.passwordHash)) {
        if (!this.overlay.isVisible()) {
          this.overlay.show(defaultPath, this.previousFile, (success) => {
            if (success) {
              this.unlock(defaultPath.id);
            }
          });
        }
      }
    }
  }

  public updateGhostModeStyles() {
    let styleEl = document.getElementById("stonegate-ghost-mode") as HTMLStyleElement;
    if (!this.settings.enabled) {
      if (styleEl) styleEl.remove();
      return;
    }

    let css = "";
    for (const path of this.settings.protectedPaths) {
      if (path.path === "/" || path.path === "") continue; // Skip root path
      if (path.enableGhostMode && this.isLocked(path.path)) {
        const safePath = path.path.replace(/"/g, '\\"');
        css += `.nav-folder:has(> .nav-folder-title[data-path="${safePath}"]), .nav-file:has(> .nav-file-title[data-path="${safePath}"]) { display: none !important; }\n`;
      }
    }

    if (css) {
      if (!styleEl) {
        styleEl = document.createElement("style");
        styleEl.id = "stonegate-ghost-mode";
        document.head.appendChild(styleEl);
      }
      styleEl.textContent = css;
    } else {
      if (styleEl) styleEl.remove();
    }
  }

  public dispose() {
    document.removeEventListener("mousemove", this.boundActivityHandler);
    document.removeEventListener("keydown", this.boundActivityHandler);
    document.removeEventListener("mousedown", this.boundActivityHandler);
    document.removeEventListener("touchstart", this.boundActivityHandler);
    window.removeEventListener("blur", this.boundBlurHandler);
    window.removeEventListener("focus", this.boundFocusHandler);

    if (this.idleTimerId !== null) {
      window.clearTimeout(this.idleTimerId);
    }
    if (this.blurTimerId !== null) {
      window.clearTimeout(this.blurTimerId);
    }

    const styleEl = document.getElementById("stonegate-ghost-mode");
    if (styleEl) styleEl.remove();
  }
}
