import { App } from "obsidian";
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
  private appNameEl: HTMLElement | null = null;
  private titleEl: HTMLElement | null = null;
  private hintEl: HTMLElement | null = null;

  private currentCallback: UnlockCallback | null = null;
  private currentPath: ProtectedPath | null = null;
  private previousFile: string | null = null;
  private failedAttempts = 0;
  private lockoutUntil = 0;
  private lockoutTimer: number | null = null;

  private boundHandleKeydown = this.handleKeydown.bind(this);
  private observer: MutationObserver | null = null;

  constructor(app: App, settings: StoneGateSettings) {
    this.app = app;
    this.settings = settings;
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

    this.submitBtnEl.addEventListener("click", () => this.submit());

    document.body.appendChild(this.containerEl);

    // Tamper protection observer
    this.observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === "childList") {
          const removedNodes = Array.from(mutation.removedNodes);
          if (this.containerEl && removedNodes.includes(this.containerEl)) {
            // It was removed, but it shouldn't be unless disposed
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

    // Force focus to input if user starts typing
    if (this.inputEl && document.activeElement !== this.inputEl) {
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
    } else {
      this.appNameEl!.style.display = "none";
    }
    
    this.titleEl!.textContent = `${path.label || path.path || "Vault"}`;
    
    let hintText = "";
    if (path.showHint && path.passwordHint) {
        hintText = `Hint: ${path.passwordHint}`;
    } else if (!path.passwordHash && this.settings.showMasterHint && this.settings.passwordHint) {
        hintText = `Hint: ${this.settings.passwordHint}`;
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
      
      if (!this.lockoutUntil || Date.now() > this.lockoutUntil) {
        setTimeout(() => this.inputEl?.focus(), 100);
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

  private async submit() {
    const hash = this.currentPath?.passwordHash || this.settings.passwordHash;
    const salt = this.currentPath?.passwordSalt || this.settings.passwordSalt;

    if (!this.inputEl || !hash || !salt) {
      this.hide();
      if (this.currentCallback) this.currentCallback(true);
      return;
    }

    if (this.lockoutUntil && Date.now() < this.lockoutUntil) {
      return;
    }

    const guess = this.inputEl.value;
    this.inputEl.value = "";

    // Check actual password
    const isMatch = await verifyPassword(guess, hash, salt);
    
    if (isMatch) {
      this.failedAttempts = 0;
      this.updateLockoutUI();
      this.hide();
      if (this.currentCallback) this.currentCallback(true);
    } else {
      this.failedAttempts++;
      this.errorEl!.textContent = "Incorrect password";
      
      this.inputEl.classList.remove("sg-shake");
      void this.inputEl.offsetWidth; // trigger reflow
      this.inputEl.classList.add("sg-shake");

      if (this.settings.maxFailedAttempts > 0 && this.failedAttempts >= this.settings.maxFailedAttempts) {
        this.lockoutUntil = Date.now() + this.settings.lockoutDurationSeconds * 1000;
        this.failedAttempts = 0;
        this.updateLockoutUI();
        this.startLockoutTimer();
      } else {
        this.updateLockoutUI();
      }
    }
  }

  private updateLockoutUI() {
    if (this.lockoutUntil && Date.now() < this.lockoutUntil) {
      this.inputEl!.disabled = true;
      this.submitBtnEl!.disabled = true;
      this.errorEl!.textContent = "";
      this.counterEl!.textContent = "";
      
      const secondsLeft = Math.ceil((this.lockoutUntil - Date.now()) / 1000);
      this.lockoutEl!.textContent = `Locked out for ${secondsLeft} seconds`;
    } else {
      this.lockoutUntil = 0;
      this.inputEl!.disabled = false;
      this.submitBtnEl!.disabled = false;
      this.lockoutEl!.textContent = "";
      
      if (this.settings.maxFailedAttempts > 0 && this.failedAttempts > 0) {
        this.counterEl!.textContent = `${this.failedAttempts} / ${this.settings.maxFailedAttempts} attempts`;
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
      if (this.lockoutUntil && Date.now() < this.lockoutUntil) {
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
