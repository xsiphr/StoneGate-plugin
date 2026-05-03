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
  private lastActivityTime = Date.now();

  private onStateChangeCallbacks: StateChangeCallback[] = [];

  // Throttled listener references
  private boundActivityHandler = this.throttleActivity.bind(this);

  // Used for throttling activity updates (max once per second)
  private activityUpdatePending = false;

  constructor(app: App, settings: StoneGateSettings, overlay: LockOverlay) {
    this.app = app;
    this.settings = settings;
    this.overlay = overlay;

    this.setupListeners();
    this.startIdleChecker();
  }

  updateSettings(settings: StoneGateSettings) {
    this.settings = settings;
    // Check if any paths should lock due to new settings
    this.checkTimeouts();
  }

  private setupListeners() {
    document.addEventListener("mousemove", this.boundActivityHandler);
    document.addEventListener("keydown", this.boundActivityHandler);
    document.addEventListener("mousedown", this.boundActivityHandler);
    document.addEventListener("touchstart", this.boundActivityHandler);
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
  }

  public lock(pathId: string) {
    this.unlockedPaths.delete(pathId);
    this.notifyStateChange(true);
  }

  public lockAll() {
    this.unlockedPaths.clear();
    this.notifyStateChange(true);
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
    if (this.isLocked(file.path)) {
      this.triggerLock(file.path);
    }
  }

  public dispose() {
    document.removeEventListener("mousemove", this.boundActivityHandler);
    document.removeEventListener("keydown", this.boundActivityHandler);
    document.removeEventListener("mousedown", this.boundActivityHandler);
    document.removeEventListener("touchstart", this.boundActivityHandler);

    if (this.idleTimerId !== null) {
      window.clearTimeout(this.idleTimerId);
    }
  }
}
