import { App, Modal, Notice } from "obsidian";
import { StoneGateSettings, ProtectedPath } from "./types";
import { verifyPassword } from "./crypto";

type UnlockCallback = (success: boolean) => void;

export class LockOverlay {
  private app: App;
  private settings: StoneGateSettings;
  private containerEl: HTMLElement | null = null;
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
  }

  private createOverlay() {
    this.containerEl = document.createElement("div");
    this.containerEl.addClass("sg-overlay-container", "sg-overlay-hidden");

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
    eyeToggle.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
    eyeToggle.addEventListener("click", () => {
      if (!this.inputEl) return;
      const isPassword = this.inputEl.type === "password";
      this.inputEl.type = isPassword ? "text" : "password";
      if (isPassword) {
        eyeToggle.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;
      } else {
        eyeToggle.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
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
    this.recoveryBypassEl.style.display = "none";
    const recoveryLink = this.recoveryBypassEl.createEl("a", {
      text: "Use Recovery Code",
      cls: "sg-recovery-link"
    });
    recoveryLink.addEventListener("click", (e) => {
      e.preventDefault();
      this.openRecoveryBypassModal();
    });

    this.submitBtnEl.addEventListener("click", () => this.submit());

    // Stop all keydown bubble events from leaving the overlay container to Obsidian
    this.containerEl.addEventListener("keydown", (e) => {
      e.stopPropagation();
    });

    document.body.appendChild(this.containerEl);

    // Tamper protection observer
    this.observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === "childList") {
          const removedNodes = Array.from(mutation.removedNodes);
          if (this.containerEl && removedNodes.includes(this.containerEl)) {
            document.body.appendChild(this.containerEl);
          }
        }
      });
    });
    this.observer.observe(document.body, { childList: true });
  }

  private handleKeydown(e: KeyboardEvent) {
    if (!this.containerEl || this.containerEl.hasClass("sg-overlay-hidden")) return;
    
    // Stop all key events from propagating to obsidian workspace
    e.stopPropagation();
    
    if (e.key === "Escape") {
      e.preventDefault();
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      this.submit();
      return;
    }

    // Force focus to input if user starts typing (but not during lockout)
    const isLockedOut = this.settings.lockoutUntil && Date.now() < this.settings.lockoutUntil;
    if (!isLockedOut && this.inputEl && document.activeElement !== this.inputEl) {
      this.inputEl.focus();
    }
  }

  public show(path: ProtectedPath, previousFile: string | null, callback: UnlockCallback) {
    if (!this.containerEl) return;
    
    this.currentPath = path;
    this.previousFile = previousFile;
    this.currentCallback = callback;
    
    if (this.settings.showStoneGateTitle) {
      this.appNameEl!.style.display = "block";
      this.appNameEl!.textContent = this.settings.customTitle || "StoneGate";
    } else {
      this.appNameEl!.style.display = "none";
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
    const workspace = document.body.querySelector(".workspace") as HTMLElement;
    if (workspace) workspace.style.pointerEvents = "none";

    // Block keyboard events
    document.addEventListener("keydown", this.boundHandleKeydown, true);

    if (this.inputEl) {
      this.inputEl.value = "";
      this.errorEl!.textContent = "";
      this.updateLockoutUI();
      
      if (this.settings.lockoutUntil && Date.now() < this.settings.lockoutUntil) {
        this.startLockoutTimer();
      } else {
        setTimeout(() => this.inputEl?.focus(), 50);
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

    setTimeout(() => {
      if (this.containerEl) {
        this.containerEl.addClass("sg-overlay-hidden");
      }
      const workspace = document.body.querySelector(".workspace") as HTMLElement;
      if (workspace) workspace.style.pointerEvents = "";
      document.removeEventListener("keydown", this.boundHandleKeydown, true);
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
    new RecoveryBypassModal(this.app, this.settings, async (verified: boolean) => {
      if (verified) {
        new Notice("🔓 Lockout bypassed using Recovery Code.", 5000);
        await this.handleSuccessfulUnlock();
      }
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
        this.recoveryBypassEl!.style.display = "block";
      }
    } else {
      if (this.settings.lockoutUntil !== 0) {
        this.settings.lockoutUntil = 0;
        this.saveSettings().catch(err => console.error("StoneGate: failed to save lockout settings", err));
      }
      this.inputEl!.disabled = false;
      this.submitBtnEl!.disabled = false;
      this.lockoutEl!.textContent = "";
      this.recoveryBypassEl!.style.display = "none";
      
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
    document.removeEventListener("keydown", this.boundHandleKeydown, true);
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

    const desc = contentEl.createEl("p", {
      text: "You are currently locked out. Enter your 6-character Recovery Code to immediately bypass the lockout and unlock."
    });
    desc.style.marginBottom = "16px";
    desc.style.color = "var(--text-muted)";
    desc.style.fontSize = "0.9em";

    const inputWrapper = contentEl.createDiv();
    inputWrapper.style.position = "relative";

    const input = inputWrapper.createEl("input", {
      type: "text",
      attr: {
        placeholder: "e.g. AB3X7K",
        maxlength: "6",
        autocomplete: "off",
        spellcheck: "false"
      }
    });
    input.style.width = "100%";
    input.style.textTransform = "uppercase";
    input.style.letterSpacing = "4px";
    input.style.textAlign = "center";
    input.style.fontSize = "1.4em";
    input.style.fontFamily = "monospace";
    input.style.padding = "10px 14px";
    input.style.boxSizing = "border-box";
    input.style.marginBottom = "12px";

    input.addEventListener("input", () => {
      const pos = input.selectionStart ?? input.value.length;
      input.value = input.value.toUpperCase();
      input.setSelectionRange(pos, pos);
    });

    const errorEl = contentEl.createDiv();
    errorEl.style.color = "var(--text-error)";
    errorEl.style.fontSize = "0.85em";
    errorEl.style.marginBottom = "16px";
    errorEl.style.minHeight = "1.2em";

    const btnRow = contentEl.createDiv();
    btnRow.style.display = "flex";
    btnRow.style.gap = "10px";
    btnRow.style.justifyContent = "flex-end";

    const cancelBtn = btnRow.createEl("button", { text: "Cancel" });
    const unlockBtn = btnRow.createEl("button", { text: "Use Recovery Code", cls: "mod-cta" });
    unlockBtn.style.marginTop = "0";

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

    unlockBtn.addEventListener("click", attempt);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        attempt();
      }
    });

    cancelBtn.addEventListener("click", () => {
      this.close();
    });

    setTimeout(() => input.focus(), 80);
  }

  onClose() {
    this.contentEl.empty();
    if (this.onCloseCallback) {
      this.onCloseCallback();
    }
  }
}