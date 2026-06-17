import { App, Modal, Notice, TFile, setIcon } from "obsidian";
import { StoneGateSettings, ProtectedPath } from "./types";
import { verifyPassword } from "./crypto";

type UnlockCallback = (success: boolean) => void;

export class LockOverlay {
  private app: App;
  private settings: StoneGateSettings;
  private containerEl: HTMLElement | null = null;
  private bgLayerEl: HTMLElement | null = null;
  private inputEl: HTMLInputElement | null = null;
  private submitBtnEl: HTMLButtonElement | null = null;
  private errorEl: HTMLElement | null = null;
  private counterEl: HTMLElement | null = null;
  private lockoutEl: HTMLElement | null = null;
  private recoveryBypassEl: HTMLElement | null = null;
  private appNameEl: HTMLElement | null = null;
  private titleEl: HTMLElement | null = null;
  private hintEl: HTMLElement | null = null;

  private currentCallback: UnlockCallback | null = null;
  private currentPath: ProtectedPath | null = null;
  private previousFile: string | null = null;
  private lockoutTimer: number | null = null;
  private saveSettings: () => Promise<void>;

  private boundHandleKeydown = this.handleKeydown.bind(this);
  private observer: MutationObserver | null = null;
  private isRecoveryPromptOpen = false;

  constructor(app: App, settings: StoneGateSettings, saveSettings: () => Promise<void>) {
    this.app = app;
    this.settings = settings;
    this.saveSettings = saveSettings;
    this.createOverlay();
  }

  updateSettings(settings: StoneGateSettings) {
    this.settings = settings;
    this.applyBackgroundStyles();
  }

  private resolveBackgroundUrl(url: string): string {
    if (!url) return "";
    url = url.trim();

    if (/^(https?:\/\/|data:|app:\/\/)/i.test(url)) {
      return url;
    }

    if (url.startsWith("obsidian://")) {
      try {
        const parsed = new URL(url);
        const filePath = parsed.searchParams.get("file") || parsed.searchParams.get("path");
        if (filePath) {
          const file = this.app.metadataCache.getFirstLinkpathDest(decodeURIComponent(filePath), "") || 
                       this.app.vault.getAbstractFileByPath(decodeURIComponent(filePath));
          if (file && file instanceof TFile) {
            return this.app.vault.getResourcePath(file);
          }
        }
      } catch {
        // ignore
      }
    }

    const file = this.app.metadataCache.getFirstLinkpathDest(url, "") || 
                 this.app.vault.getAbstractFileByPath(url);
    if (file && file instanceof TFile) {
      return this.app.vault.getResourcePath(file);
    }

    const isWindowsAbsolute = /^[a-zA-Z]:[\\/]/i.test(url) || url.startsWith("\\\\");
    const isPosixAbsolute = url.startsWith("/");

    if (isWindowsAbsolute || isPosixAbsolute) {
      let normalizedPath = url.replace(/\\/g, "/");
      if (normalizedPath.startsWith("/")) {
        return `app://local${normalizedPath}`;
      } else {
        return `app://local/${normalizedPath}`;
      }
    }

    return url;
  }

  private applyBackgroundStyles() {
    if (!this.containerEl || !this.bgLayerEl) return;
    
    const bgUrlSetting = this.settings.customBackgroundUrl;
    if (!bgUrlSetting) {
      this.bgLayerEl.setCssStyles({
        backgroundImage: "",
        backgroundSize: "",
        backgroundPosition: "",
        filter: "",
        transform: "",
        webkitTransform: ""
      });
      return;
    }

    let resolvedUrl = "";
    try {
      resolvedUrl = this.resolveBackgroundUrl(bgUrlSetting);
    } catch (e) {
      console.warn("StoneGate: Background url resolution threw error:", e);
    }

    console.log("StoneGate: Applying background from:", resolvedUrl);

    if (resolvedUrl) {
      this.bgLayerEl.setCssStyles({
        backgroundImage: `linear-gradient(rgba(0, 0, 0, 0.65), rgba(0, 0, 0, 0.65)), url('${resolvedUrl}')`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        filter: "blur(10px)",
        transform: "scale(1.1)",
        webkitTransform: "scale(1.1)"
      });
    } else {
      this.bgLayerEl.setCssStyles({
        backgroundImage: "",
        backgroundSize: "",
        backgroundPosition: "",
        filter: "",
        transform: "",
        webkitTransform: ""
      });
    }
  }

  private createOverlay() {
    this.containerEl = activeDocument.createElement("div");
    this.containerEl.addClass("sg-overlay-container", "sg-overlay-hidden");

    this.bgLayerEl = this.containerEl.createDiv("sg-background-layer");

    const card = this.containerEl.createDiv("sg-overlay-card");
    this.appNameEl = card.createEl("div", { text: "StoneGate", cls: "sg-app-name" });
    this.titleEl = card.createEl("h2", { cls: "sg-title" });

    const inputWrapper = card.createDiv("sg-input-wrapper");
    this.inputEl = inputWrapper.createEl("input", {
      type: "password",
      cls: "sg-input",
      attr: { placeholder: "Enter password" }
    });

    const eyeToggle = inputWrapper.createEl("button", { cls: "sg-eye-toggle" });
    setIcon(eyeToggle, "eye");
    eyeToggle.addEventListener("click", () => {
      if (!this.inputEl) return;
      const isPassword = this.inputEl.type === "password";
      this.inputEl.type = isPassword ? "text" : "password";
      if (isPassword) {
        setIcon(eyeToggle, "eye-off");
      } else {
        setIcon(eyeToggle, "eye");
      }
    });

    this.hintEl = card.createDiv("sg-hint");

    this.submitBtnEl = card.createEl("button", {
      text: "Unlock",
      cls: "mod-cta sg-submit-btn"
    });

    this.errorEl = card.createDiv("sg-error");
    this.counterEl = card.createDiv("sg-counter");
    this.lockoutEl = card.createDiv("sg-lockout");

    // Recovery bypass link — always in DOM, toggled via display style
    this.recoveryBypassEl = card.createDiv("sg-recovery-bypass");
    this.recoveryBypassEl.hide();
    const recoveryLink = this.recoveryBypassEl.createEl("a", {
      text: "Use Recovery Code",
      cls: "sg-recovery-link"
    });
    recoveryLink.addEventListener("click", (e) => {
      e.preventDefault();
      this.openRecoveryBypassModal();
    });

    this.submitBtnEl.addEventListener("click", () => { void this.submit(); });

    // Stop all keydown bubble events from leaving the overlay container to Obsidian
    this.containerEl.addEventListener("keydown", (e) => {
      e.stopPropagation();
    });

    activeDocument.body.appendChild(this.containerEl);

    // Tamper protection observer
    this.observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === "childList") {
          const removedNodes = Array.from(mutation.removedNodes);
          if (this.containerEl && removedNodes.includes(this.containerEl)) {
            activeDocument.body.appendChild(this.containerEl);
          }
        }
      });
    });
    this.observer.observe(activeDocument.body, { childList: true });
  }

  private handleKeydown(e: KeyboardEvent) {
    if (!this.containerEl || this.containerEl.hasClass("sg-overlay-hidden")) return;
    
    const isRecoveryModalOpen = !!activeDocument.querySelector(".sg-recovery-modal-container");
    const recoveryModal = activeDocument.querySelector(".sg-recovery-modal-container");
    const recoveryInput = recoveryModal?.querySelector("input") as HTMLInputElement;

    const activeEl = activeDocument.activeElement;
    const isFocusOnOurInput = (activeEl === this.inputEl) || (recoveryInput && activeEl === recoveryInput);

    const hasModifier = e.ctrlKey || e.metaKey || e.altKey;
    
    if (hasModifier) {
      // Allow standard editing shortcuts inside the input field:
      // Ctrl/Cmd + A, C, V, X, Z, Y
      const keyLower = e.key.toLowerCase();
      const isEditingShortcut = ["a", "c", "v", "x", "z", "y"].includes(keyLower);
      
      if (isFocusOnOurInput && isEditingShortcut) {
        return;
      }
      
      e.stopPropagation();
      e.preventDefault();
      return;
    }

    if (!isFocusOnOurInput) {
      e.stopPropagation();
      e.preventDefault();
      
      if (isRecoveryModalOpen && recoveryInput) {
        recoveryInput.focus();
      } else if (this.inputEl) {
        const isLockedOut = this.settings.lockoutUntil && Date.now() < this.settings.lockoutUntil;
        if (!isLockedOut) {
          this.inputEl.focus();
        }
      }
      return;
    }

    if (e.key === "Enter") {
      if (isRecoveryModalOpen) {
        return;
      }
      e.stopPropagation();
      e.preventDefault();
      void this.submit();
      return;
    }

    if (e.key === "Escape") {
      e.stopPropagation();
      e.preventDefault();
      return;
    }
  }

  public show(path: ProtectedPath, previousFile: string | null, callback: UnlockCallback) {
    if (!this.containerEl) return;
    
    this.currentPath = path;
    this.previousFile = previousFile;
    this.currentCallback = callback;
    
    if (this.settings.showStoneGateTitle) {
      this.appNameEl!.show();
      this.appNameEl!.textContent = this.settings.customTitle || "StoneGate";
    } else {
      this.appNameEl!.hide();
    }
    
    this.titleEl!.textContent = `${path.label || path.path || "Vault"}`;
    
    let hintText = "";
    if (path.showHint && path.passwordHint) {
        hintText = path.passwordHint;
    } else if (!path.passwordHash && this.settings.showMasterHint && this.settings.passwordHint) {
        hintText = this.settings.passwordHint;
    }
    this.hintEl!.textContent = hintText;

    this.containerEl.removeClass("sg-overlay-hidden");
    this.containerEl.removeClass("sg-overlay-fade-out");
    this.containerEl.addClass("sg-overlay-fade-in");
    
    // Disable workspace pointer events
    const workspace = activeDocument.body.querySelector(".workspace") as HTMLElement;
    if (workspace) workspace.setCssStyles({ pointerEvents: "none" });

    // Hide active modals to prevent focus trapping
    const modals = activeDocument.querySelectorAll(".modal-container");
    modals.forEach((modal) => {
      const htmlModal = modal as HTMLElement;
      if (htmlModal.style.display !== "none") {
        htmlModal.setAttribute("data-sg-original-display", htmlModal.style.display || "block");
        htmlModal.style.display = "none";
      }
    });

    // Block keyboard events
    window.addEventListener("keydown", this.boundHandleKeydown, { capture: true });

    // Hook into Obsidian layout lifecycle
    if (this.app.workspace.layoutReady) {
      this.applyBackgroundStyles();
    } else {
      this.app.workspace.onLayoutReady(() => {
        this.applyBackgroundStyles();
      });
    }

    if (this.inputEl) {
      this.inputEl.value = "";
      this.errorEl!.textContent = "";
      this.updateLockoutUI();
      
      if (this.settings.lockoutUntil && Date.now() < this.settings.lockoutUntil) {
        this.startLockoutTimer();
      } else {
        window.setTimeout(() => this.inputEl?.focus(), 50);
      }
    }
  }

  public isVisible(): boolean {
    return !!this.containerEl && !this.containerEl.hasClass("sg-overlay-hidden");
  }

  public hide() {
    if (!this.containerEl) return;

    this.containerEl.removeClass("sg-overlay-fade-in");
    this.containerEl.addClass("sg-overlay-fade-out");

    // Restore active modals
    const modals = activeDocument.querySelectorAll(".modal-container");
    modals.forEach((modal) => {
      const htmlModal = modal as HTMLElement;
      const originalDisplay = htmlModal.getAttribute("data-sg-original-display");
      if (originalDisplay) {
        htmlModal.style.display = originalDisplay === "block" ? "" : originalDisplay;
        htmlModal.removeAttribute("data-sg-original-display");
      }
    });

    window.setTimeout(() => {
      if (this.containerEl) {
        this.containerEl.addClass("sg-overlay-hidden");
      }
      const workspace = activeDocument.body.querySelector(".workspace") as HTMLElement;
      if (workspace) workspace.setCssStyles({ pointerEvents: "" });
      window.removeEventListener("keydown", this.boundHandleKeydown, { capture: true });
    }, 300); // match animation duration
  }

  private async handleSuccessfulUnlock() {
    if (this.settings.intruderAlert && this.settings.totalIntruderAttempts > 0) {
      new Notice(
        `🚨 Security Alert: ${this.settings.totalIntruderAttempts} failed unlock attempt(s) detected.`,
        10000
      );
    }
    this.settings.failedAttempts = 0;
    this.settings.totalIntruderAttempts = 0;
    this.settings.lockoutUntil = 0;
    await this.saveSettings();
    this.updateLockoutUI();
    this.hide();
    if (this.currentCallback) this.currentCallback(true);
  }

  private async submit() {
    const hash = this.currentPath?.passwordHash || this.settings.passwordHash;
    const salt = this.currentPath?.passwordSalt || this.settings.passwordSalt;

    if (!this.inputEl || !hash || !salt) {
      this.hide();
      if (this.currentCallback) this.currentCallback(true);
      return;
    }

    if (this.settings.lockoutUntil && Date.now() < this.settings.lockoutUntil) {
      return;
    }

    const guess = this.inputEl.value;
    this.inputEl.value = "";

    let isMatch = await verifyPassword(guess, hash, salt);

    if (!isMatch && this.settings.recoveryCodeHash && this.settings.recoveryCodeSalt) {
      const upperGuess = guess.trim().toUpperCase();
      isMatch = await verifyPassword(upperGuess, this.settings.recoveryCodeHash, this.settings.recoveryCodeSalt);
      if (isMatch) {
        new Notice("🔓 Unlocked using Recovery Code (Global Skeleton Key).", 5000);
      }
    }
    
    if (isMatch) {
      await this.handleSuccessfulUnlock();
    } else {
      this.settings.failedAttempts++;
      this.settings.totalIntruderAttempts++;
      this.errorEl!.textContent = "Incorrect password";
      
      this.inputEl.classList.remove("sg-shake");
      void this.inputEl.offsetWidth; // trigger reflow
      this.inputEl.classList.add("sg-shake");

      if (this.settings.maxFailedAttempts > 0 && this.settings.failedAttempts >= this.settings.maxFailedAttempts) {
        this.settings.lockoutUntil = Date.now() + this.settings.lockoutDurationSeconds * 1000;
        this.settings.failedAttempts = 0;
        await this.saveSettings();
        this.updateLockoutUI();
        this.startLockoutTimer();
      } else {
        await this.saveSettings();
        this.updateLockoutUI();
      }
    }
  }

  private openRecoveryBypassModal() {
    if (this.isRecoveryPromptOpen) return;
    if (!this.settings.recoveryCodeHash || !this.settings.recoveryCodeSalt) {
      new Notice("No Recovery Code is configured. Set one up in StoneGate settings.", 6000);
      return;
    }
    this.isRecoveryPromptOpen = true;
    new RecoveryBypassModal(this.app, this.settings, (verified: boolean) => {
      void (async () => {
        if (verified) {
          new Notice("🔓 Lockout bypassed using Recovery Code.", 5000);
          await this.handleSuccessfulUnlock();
        }
      })();
    }, () => {
      this.isRecoveryPromptOpen = false;
    }).open();
  }

  private updateLockoutUI() {
    const isLockedOut = this.settings.lockoutUntil && Date.now() < this.settings.lockoutUntil;

    if (isLockedOut) {
      this.inputEl!.disabled = true;
      this.submitBtnEl!.disabled = true;
      this.errorEl!.textContent = "";
      this.counterEl!.textContent = "";
      
      const secondsLeft = Math.ceil((this.settings.lockoutUntil - Date.now()) / 1000);
      this.lockoutEl!.textContent = `Locked out for ${secondsLeft} seconds`;

      if (this.settings.recoveryCodeHash) {
        this.recoveryBypassEl!.show();
      }
    } else {
      if (this.settings.lockoutUntil !== 0) {
        this.settings.lockoutUntil = 0;
        void this.saveSettings().catch(err => console.error("StoneGate: failed to save lockout settings", err));
      }
      this.inputEl!.disabled = false;
      this.submitBtnEl!.disabled = false;
      this.lockoutEl!.textContent = "";
      this.recoveryBypassEl!.hide();
      
      if (this.settings.maxFailedAttempts > 0 && this.settings.failedAttempts > 0) {
        this.counterEl!.textContent = `${this.settings.failedAttempts} / ${this.settings.maxFailedAttempts} attempts`;
      } else {
        this.counterEl!.textContent = "";
      }
    }
  }

  private startLockoutTimer() {
    if (this.lockoutTimer !== null) {
      window.clearInterval(this.lockoutTimer);
    }
    
    this.lockoutTimer = window.setInterval(() => {
      if (this.settings.lockoutUntil && Date.now() < this.settings.lockoutUntil) {
        this.updateLockoutUI();
      } else {
        window.clearInterval(this.lockoutTimer!);
        this.lockoutTimer = null;
        this.updateLockoutUI();
        if (this.inputEl && !this.containerEl!.hasClass("sg-overlay-hidden")) {
          this.inputEl.focus();
        }
      }
    }, 1000);
  }

  public dispose() {
    if (this.observer) {
      this.observer.disconnect();
    }
    if (this.lockoutTimer !== null) {
      window.clearInterval(this.lockoutTimer);
    }
    window.removeEventListener("keydown", this.boundHandleKeydown, { capture: true });
    if (this.containerEl && this.containerEl.parentNode) {
      this.containerEl.parentNode.removeChild(this.containerEl);
    }
  }
}

class RecoveryBypassModal extends Modal {
  private settings: StoneGateSettings;
  private onResult: (verified: boolean) => void;
  private onCloseCallback?: () => void;

  constructor(app: App, settings: StoneGateSettings, onResult: (verified: boolean) => void, onCloseCallback?: () => void) {
    super(app);
    this.settings = settings;
    this.onResult = onResult;
    this.onCloseCallback = onCloseCallback;
  }

  onOpen() {
    this.containerEl.addClass("sg-recovery-modal-container");
    this.containerEl.addEventListener("keydown", (e) => {
      e.stopPropagation();
    });

    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "🔑 Emergency Recovery Bypass" });

    contentEl.createEl("p", {
      text: "You are currently locked out. Enter your 6-character Recovery Code to immediately bypass the lockout and unlock.",
      cls: "sg-recovery-desc"
    });

    const inputWrapper = contentEl.createDiv("sg-recovery-input-wrapper");

    const input = inputWrapper.createEl("input", {
      type: "text",
      cls: "sg-recovery-input",
      attr: {
        placeholder: "XXXXXX",
        maxlength: "6",
        autocomplete: "off",
        spellcheck: "false"
      }
    });

    input.addEventListener("input", () => {
      const pos = input.selectionStart ?? input.value.length;
      input.value = input.value.toUpperCase();
      input.setSelectionRange(pos, pos);
    });

    const errorEl = contentEl.createDiv("sg-recovery-error");

    const btnRow = contentEl.createDiv("sg-recovery-btn-row");

    const cancelBtn = btnRow.createEl("button", { text: "Cancel" });
    const unlockBtn = btnRow.createEl("button", { text: "Use Recovery Code", cls: "mod-cta" });

    let submitted = false;

    const attempt = async () => {
      if (submitted) return;
      errorEl.textContent = "";

      const code = input.value.trim().toUpperCase();
      if (!code) {
        errorEl.textContent = "Please enter your Recovery Code.";
        return;
      }

      unlockBtn.disabled = true;
      unlockBtn.textContent = "Verifying…";

      const isMatch = await verifyPassword(
        code,
        this.settings.recoveryCodeHash!,
        this.settings.recoveryCodeSalt!
      );

      if (isMatch) {
        submitted = true;
        this.close();
        this.onResult(true);
      } else {
        unlockBtn.disabled = false;
        unlockBtn.textContent = "Use Recovery Code";
        errorEl.textContent = "Invalid Recovery Code. Please check and try again.";
        input.value = "";
        new Notice("❌ Invalid Recovery Code.", 4000);
      }
    };

    unlockBtn.addEventListener("click", () => { void attempt(); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        void attempt();
      }
    });

    cancelBtn.addEventListener("click", () => {
      this.close();
    });

    window.setTimeout(() => input.focus(), 80);
  }

  onClose() {
    this.contentEl.empty();
    if (this.onCloseCallback) {
      this.onCloseCallback();
    }
  }
}