import { App, Modal, PluginSettingTab, Setting, TFolder, Notice } from "obsidian";
import type StoneGatePlugin from "./main";
import { ProtectedPath } from "./types";
import { generateSalt, hashPassword, uint8ArrayToBase64, verifyPassword, generateRecoveryCode } from "./crypto";

export class StoneGateSettingTab extends PluginSettingTab {
  plugin: StoneGatePlugin;

  constructor(app: App, plugin: StoneGatePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "StoneGate Settings" });

    // --- Protection Enable/Disable ---
    new Setting(containerEl)
      .setName("Enable StoneGate")
      .setDesc("Turn on lock screen protection")
      .addToggle((toggle) => {
        let isSyncing = false;
        toggle
          .setValue(this.plugin.settings.enabled)
          .onChange(async (value) => {
            if (isSyncing) return;
            try {
              if (value) {
                if (!this.plugin.settings.passwordHash) {
                  // Must set password first
                  isSyncing = true;
                  toggle.setValue(false);
                  isSyncing = false;
                  new PasswordModal(this.app, this.plugin, undefined, undefined, "Master Password", async (success, hash, salt) => {
                    try {
                      if (success && hash && salt) {
                        this.plugin.settings.passwordHash = hash;
                        this.plugin.settings.passwordSalt = salt;
                        this.plugin.settings.enabled = true;
                        await this.plugin.saveSettings();
                        this.display();
                      } else {
                        isSyncing = true;
                        toggle.setValue(false);
                        isSyncing = false;
                      }
                    } catch (e) {
                      console.error("Password modal callback error:", e);
                    }
                  }).open();
                } else {
                  this.plugin.settings.enabled = true;
                  await this.plugin.saveSettings();
                }
              } else {
                // Disabling requires confirmation
                isSyncing = true;
                toggle.setValue(true);
                isSyncing = false;
                new ConfirmPasswordModal(this.app, this.plugin, this.plugin.settings.passwordHash, this.plugin.settings.passwordSalt, "Master Password", async (success) => {
                  try {
                    if (success) {
                      this.plugin.settings.enabled = false;
                      await this.plugin.saveSettings();
                      this.plugin.lockManager.lockAll();
                      this.display();
                    } else {
                      isSyncing = true;
                      toggle.setValue(true);
                      isSyncing = false;
                    }
                  } catch (e) {
                    console.error("Confirm password modal callback error:", e);
                  }
                }).open();
              }
            } catch (e) {
              console.error("Failed to toggle StoneGate:", e);
              isSyncing = true;
              toggle.setValue(!value);
              isSyncing = false;
            }
          });
      });

    containerEl.createEl("h3", { text: "Master Password" });

    const passwordSetting = new Setting(containerEl)
      .setName("Password")
      .setDesc("Used to unlock your vault and folders");

    if (this.plugin.settings.passwordHash) {
      passwordSetting
        .addButton((btn) =>
          btn
            .setButtonText("Change Password")
            .onClick(() => {
              new PasswordModal(this.app, this.plugin, this.plugin.settings.passwordHash, this.plugin.settings.passwordSalt, "Master Password", async (success, hash, salt) => {
                if (success && hash && salt) {
                  this.plugin.settings.passwordHash = hash;
                  this.plugin.settings.passwordSalt = salt;
                  await this.plugin.saveSettings();
                  this.display();
                }
              }).open();
            })
        )
        .addButton((btn) =>
          btn
            .setButtonText("Remove")
            .setWarning()
            .onClick(() => {
              new ConfirmPasswordModal(this.app, this.plugin, this.plugin.settings.passwordHash, this.plugin.settings.passwordSalt, "Master Password", async (success) => {
                if (success) {
                  this.plugin.settings.passwordHash = undefined;
                  this.plugin.settings.passwordSalt = undefined;
                  this.plugin.settings.enabled = false; // Disable if no password
                  await this.plugin.saveSettings();
                  this.display();
                }
              }).open();
            })
        );



    } else {
      passwordSetting.addButton((btn) =>
        btn
          .setButtonText("Set Password")
          .setCta()
          .onClick(() => {
            new PasswordModal(this.app, this.plugin, undefined, undefined, "Master Password", async (success, hash, salt) => {
              if (success && hash && salt) {
                this.plugin.settings.passwordHash = hash;
                this.plugin.settings.passwordSalt = salt;
                await this.plugin.saveSettings();
                this.display();
              }
            }).open();
          })
      );
    }

    containerEl.createEl("h3", { text: "Protected Paths" });

    new Setting(containerEl)
      .setName("Add Protected Path")
      .setDesc("Select a folder to protect.")
      .addButton((btn) =>
        btn
          .setButtonText("Add Path")
          .setCta()
          .onClick(() => {
            new AddPathModal(this.app, this.plugin, () => this.display()).open();
          })
      );

    const pathsContainer = containerEl.createDiv();
    for (const path of this.plugin.settings.protectedPaths) {
      new Setting(pathsContainer)
        .setName(path.path === "/" || path.path === "" ? "Vault" : path.path)
        .setDesc(`${path.label ? path.label + " | " : ""}${path.timeoutMinutes} min timeout${path.passwordHash ? " | 🔑 Has own password" : ""}`)
        .addButton((btn) =>
          btn
            .setButtonText("Edit")
            .onClick(() => {
              new EditPathModal(this.app, this.plugin, path, () => this.display()).open();
            })
        )
        .addButton((btn) =>
          btn
            .setButtonText("Remove")
            .onClick(async () => {
              this.plugin.settings.protectedPaths = this.plugin.settings.protectedPaths.filter((p) => p.id !== path.id);
              await this.plugin.saveSettings();
              this.display();
            })
        );
    }

    containerEl.createEl("h3", { text: "Behavior" });

    new Setting(containerEl)
      .setName("Lock on Startup")
      .setDesc("Require password immediately when opening Obsidian")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.lockOnStartup)
          .onChange(async (value) => {
            this.plugin.settings.lockOnStartup = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Lock when Obsidian loses focus")
      .setDesc("Lock immediately when the window loses focus")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.lockOnBlur)
          .onChange(async (value) => {
            this.plugin.settings.lockOnBlur = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Blur Grace Period (seconds)")
      .setDesc("Time in seconds to wait before locking after focus loss (0 = immediate)")
      .addText((text) =>
        text
          .setPlaceholder("3")
          .setValue(String(this.plugin.settings.blurGracePeriodSeconds))
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            if (!isNaN(num) && num >= 0) {
              this.plugin.settings.blurGracePeriodSeconds = num;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Max Failed Attempts")
      .setDesc("0 = unlimited")
      .addText((text) =>
        text
          .setPlaceholder("3")
          .setValue(String(this.plugin.settings.maxFailedAttempts))
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            if (!isNaN(num) && num >= 0) {
              this.plugin.settings.maxFailedAttempts = num;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Lockout Duration (seconds)")
      .addText((text) =>
        text
          .setPlaceholder("60")
          .setValue(String(this.plugin.settings.lockoutDurationSeconds))
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            if (!isNaN(num) && num >= 0) {
              this.plugin.settings.lockoutDurationSeconds = num;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Intruder Alert")
      .setDesc("Show a notice upon unlocking if there were failed attempts")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.intruderAlert)
          .onChange(async (value) => {
            this.plugin.settings.intruderAlert = value;
            await this.plugin.saveSettings();
          })
      );



    containerEl.createEl("h3", { text: "Appearance" });

    new Setting(containerEl)
      .setName("Show StoneGate Title")
      .setDesc("Show the 'StoneGate' app name at the top of the lock screen")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showStoneGateTitle)
          .onChange(async (value) => {
            this.plugin.settings.showStoneGateTitle = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Custom Lock Screen Title")
      .setDesc("Custom text to show at the top of the lock screen (defaults to 'StoneGate')")
      .addText((text) =>
        text
          .setPlaceholder("StoneGate")
          .setValue(this.plugin.settings.customTitle || "")
          .onChange(async (value) => {
            this.plugin.settings.customTitle = value.trim() || undefined;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Custom Background URL/Path")
      .setDesc("URL or local path to a custom background image. You can copy an Obsidian URL using the 'Copy Obsidian URL' feature (starts with app://obsidian.md/...).")
      .addText((text) =>
        text
          .setPlaceholder("https://example.com/image.jpg")
          .setValue(this.plugin.settings.customBackgroundUrl || "")
          .onChange(async (value) => {
            this.plugin.settings.customBackgroundUrl = value.trim();
            await this.plugin.saveSettings();
          })
      );



    containerEl.createEl("h3", { text: "Ghost Mode & Commands" });

    const unlockMenuPwdSetting = new Setting(containerEl)
      .setName("Unlock Menu Access Password")
      .setDesc("Used to access the command palette list of hidden/locked paths");

    if (this.plugin.settings.unlockMenuPasswordHash) {
      unlockMenuPwdSetting
        .addButton((btn) =>
          btn
            .setButtonText("Change Password")
            .onClick(() => {
              new PasswordModal(this.app, this.plugin, this.plugin.settings.unlockMenuPasswordHash, this.plugin.settings.unlockMenuPasswordSalt, "Unlock Menu Password", async (success, hash, salt) => {
                if (success && hash && salt) {
                  this.plugin.settings.unlockMenuPasswordHash = hash;
                  this.plugin.settings.unlockMenuPasswordSalt = salt;
                  await this.plugin.saveSettings();
                  this.display();
                }
              }).open();
            })
        )
        .addButton((btn) =>
          btn
            .setButtonText("Remove")
            .setWarning()
            .onClick(() => {
              new ConfirmPasswordModal(this.app, this.plugin, this.plugin.settings.unlockMenuPasswordHash, this.plugin.settings.unlockMenuPasswordSalt, "Unlock Menu Password", async (success) => {
                if (success) {
                  this.plugin.settings.unlockMenuPasswordHash = undefined;
                  this.plugin.settings.unlockMenuPasswordSalt = undefined;
                  await this.plugin.saveSettings();
                  this.display();
                }
              }).open();
            })
        );
    } else {
      unlockMenuPwdSetting.addButton((btn) =>
        btn
          .setButtonText("Set Password")
          .setCta()
          .onClick(() => {
            new PasswordModal(this.app, this.plugin, undefined, undefined, "Unlock Menu Password", async (success, hash, salt) => {
              if (success && hash && salt) {
                this.plugin.settings.unlockMenuPasswordHash = hash;
                this.plugin.settings.unlockMenuPasswordSalt = salt;
                await this.plugin.saveSettings();
                this.display();
              }
            }).open();
          })
      );
    }

    new Setting(containerEl)
      .setName("Unlock Menu Password Hint")
      .setDesc("Hint shown when the Unlock Menu password is requested")
      .addText((text) =>
        text
          .setPlaceholder("Hint or custom message...")
          .setValue(this.plugin.settings.unlockMenuPasswordHint || "")
          .onChange(async (value) => {
            this.plugin.settings.unlockMenuPasswordHint = value.trim() || undefined;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "Recovery Options" });

    const recoverySetting = new Setting(containerEl)
      .setName("Recovery Code (Global Skeleton Key)")
      .setDesc("A 6-character recovery code that can bypass and unlock any path if you forget your password.");

    if (this.plugin.settings.recoveryCodeHash) {
      recoverySetting
        .setDesc("A recovery code is configured. You can use it to bypass lock screens. (For security, only the hash is stored; the code cannot be shown again).")
        .addButton((btn) =>
          btn
            .setButtonText("Remove Recovery Code")
            .setWarning()
            .onClick(() => {
              new ConfirmPasswordModal(
                this.app,
                this.plugin,
                undefined,
                undefined,
                "Master Password",
                async (success) => {
                  if (success) {
                    this.plugin.settings.recoveryCodeHash = undefined;
                    this.plugin.settings.recoveryCodeSalt = undefined;
                    await this.plugin.saveSettings();
                    this.display();
                    new Notice("Recovery Code removed successfully.");
                  }
                }
              ).open();
            })
        );
    } else {
      recoverySetting.addButton((btn) =>
        btn
          .setButtonText("Generate Recovery Code")
          .setCta()
          .onClick(() => {
            new ConfirmPasswordModal(
              this.app,
              this.plugin,
              undefined,
              undefined,
              "Master Password",
              async (success) => {
                if (success) {
                  const code = generateRecoveryCode();
                  const saltBytes = generateSalt();
                  const hash = await hashPassword(code.toUpperCase(), saltBytes);
                  this.plugin.settings.recoveryCodeHash = hash;
                  this.plugin.settings.recoveryCodeSalt = uint8ArrayToBase64(saltBytes);
                  await this.plugin.saveSettings();
                  this.display();
                  new RecoveryCodeDisplayModal(this.app, code).open();
                }
              }
            ).open();
          })
      );
    }
  }
}

// --- Modals ---

function createInputWithEye(container: HTMLElement, placeholder: string): HTMLInputElement {
  const wrapper = container.createDiv("sg-modal-input-container");
  const input = wrapper.createEl("input", { type: "password", attr: { placeholder } });
  
  const eyeBtn = wrapper.createEl("button", { cls: "sg-eye-toggle" });
  eyeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
  eyeBtn.addEventListener("click", () => {
    const isPassword = input.type === "password";
    input.type = isPassword ? "text" : "password";
    if (isPassword) {
      eyeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;
    } else {
      eyeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
    }
  });
  return input;
}

export class PasswordModal extends Modal {
  plugin: StoneGatePlugin;
  onSubmit: (success: boolean, hash?: string, salt?: string) => void;
  targetHash?: string;
  targetSalt?: string;
  targetName: string;

  constructor(app: App, plugin: StoneGatePlugin, targetHash: string | undefined, targetSalt: string | undefined, targetName: string, onSubmit: (success: boolean, hash?: string, salt?: string) => void) {
    super(app);
    this.plugin = plugin;
    this.targetHash = targetHash;
    this.targetSalt = targetSalt;
    this.targetName = targetName;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: this.targetHash ? `Change ${this.targetName}` : `Set ${this.targetName}` });

    let currentInput: HTMLInputElement | undefined;
    if (this.targetHash) {
      currentInput = createInputWithEye(contentEl, "Current Password");
    }

    const newPasswordInput = createInputWithEye(contentEl, "New Password");
    const confirmPasswordInput = createInputWithEye(contentEl, "Confirm Password");
    const errorEl = contentEl.createDiv("sg-error");

    const submitBtn = contentEl.createEl("button", { text: "Save", cls: "mod-cta" });
    submitBtn.style.marginTop = "16px";

    const submit = async () => {
      errorEl.textContent = "";
      if (currentInput && this.targetHash && this.targetSalt) {
        const isMatch = await verifyPassword(currentInput.value, this.targetHash, this.targetSalt);
        if (!isMatch) {
          errorEl.textContent = "Current password is incorrect.";
          currentInput.style.borderColor = "#e05555";
          return;
        }
      }

      const p1 = newPasswordInput.value;
      const p2 = confirmPasswordInput.value;

      if (!p1 || p1.length < 4 || !/^[\x00-\x7F]*$/.test(p1)) {
        errorEl.textContent = "Password must be at least 4 ASCII characters.";
        return;
      }

      if (p1 !== p2) {
        errorEl.textContent = "Passwords do not match.";
        return;
      }

      const salt = generateSalt();
      const hash = await hashPassword(p1, salt);
      this.onSubmit(true, hash, uint8ArrayToBase64(salt));
      this.close();
    };

    submitBtn.addEventListener("click", submit);
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    };
    newPasswordInput.addEventListener("keydown", handleKey);
    confirmPasswordInput.addEventListener("keydown", handleKey);
    if (currentInput) currentInput.addEventListener("keydown", handleKey);
    
    setTimeout(() => {
      if (currentInput) currentInput.focus();
      else newPasswordInput.focus();
    }, 50);
  }

  onClose() {
    this.contentEl.empty();
    this.onSubmit(false);
  }
}

export class ConfirmPasswordModal extends Modal {
  plugin: StoneGatePlugin;
  onSubmit: (success: boolean) => void;
  targetHash?: string;
  targetSalt?: string;
  targetName: string;
  hint?: string;

  constructor(app: App, plugin: StoneGatePlugin, targetHash: string | undefined, targetSalt: string | undefined, targetName: string, onSubmit: (success: boolean) => void, hint?: string) {
    super(app);
    this.plugin = plugin;
    this.targetHash = targetHash;
    this.targetSalt = targetSalt;
    this.targetName = targetName;
    this.onSubmit = onSubmit;
    this.hint = hint;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: `Confirm ${this.targetName}` });
    contentEl.createEl("p", { text: "Please enter the password to continue." });

    const input = createInputWithEye(contentEl, "Password");

    // Display hint if provided
    if (this.hint) {
      const hintEl = contentEl.createDiv("sg-hint");
      hintEl.textContent = this.hint;
    }

    const errorEl = contentEl.createDiv("sg-error");

    const submitBtn = contentEl.createEl("button", { text: "Confirm", cls: "mod-cta" });
    submitBtn.style.marginTop = "16px";

    const submit = async () => {
      errorEl.textContent = "";
      const hash = this.targetHash || this.plugin.settings.passwordHash;
      const salt = this.targetSalt || this.plugin.settings.passwordSalt;
      if (!hash || !salt) {
        this.onSubmit(true);
        this.close();
        return;
      }

      const isMatch = await verifyPassword(input.value, hash, salt);
      if (isMatch) {
        this.onSubmit(true);
        this.close();
      } else {
        errorEl.textContent = "Incorrect password.";
        input.style.borderColor = "#e05555";
      }
    };

    submitBtn.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });
    setTimeout(() => input.focus(), 50);
  }

  onClose() {
    this.contentEl.empty();
    this.onSubmit(false);
  }
}

export class RecoveryCodeDisplayModal extends Modal {
  private code: string;

  constructor(app: App, code: string) {
    super(app);
    this.code = code;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    
    contentEl.createEl("h2", { text: "🔑 Secure Recovery Code Generated", cls: "sg-modal-title" });
    
    const desc = contentEl.createEl("p", {
      text: "This recovery code acts as a Global Skeleton Key. It can bypass and unlock any locked folder or the vault itself if you forget your password.",
      cls: "sg-modal-desc"
    });
    desc.style.marginBottom = "16px";

    const warningBox = contentEl.createDiv("sg-warning-box");
    warningBox.style.border = "1px solid var(--text-error)";
    warningBox.style.backgroundColor = "rgba(255, 0, 0, 0.05)";
    warningBox.style.padding = "12px 16px";
    warningBox.style.borderRadius = "6px";
    warningBox.style.marginBottom = "20px";
    
    const warningTitle = warningBox.createEl("strong", { text: "⚠️ IMPORTANT WARNING:" });
    warningTitle.style.color = "var(--text-error)";
    warningTitle.style.display = "block";
    warningTitle.style.marginBottom = "6px";

    const warningText = warningBox.createEl("span", {
      text: "Write this code down or save it in a secure password manager. For security reasons, the code is hashed before saving, and it CANNOT be shown or recovered again once you close this window."
    });
    warningText.style.fontSize = "0.9em";

    const codeContainer = contentEl.createDiv("sg-recovery-code-container");
    codeContainer.style.textAlign = "center";
    codeContainer.style.margin = "24px 0";
    codeContainer.style.padding = "16px";
    codeContainer.style.borderRadius = "8px";
    codeContainer.style.backgroundColor = "var(--background-secondary-alt)";
    codeContainer.style.border = "2px dashed var(--interactive-accent)";

    const codeEl = codeContainer.createEl("div", { text: this.code });
    codeEl.style.fontSize = "2.4em";
    codeEl.style.fontWeight = "bold";
    codeEl.style.letterSpacing = "6px";
    codeEl.style.color = "var(--interactive-accent)";
    codeEl.style.fontFamily = "monospace";
    codeEl.style.userSelect = "all";

    const buttonRow = contentEl.createDiv("sg-button-row");
    buttonRow.style.display = "flex";
    buttonRow.style.justifyContent = "space-between";
    buttonRow.style.marginTop = "24px";

    const copyBtn = buttonRow.createEl("button", { text: "Copy Code", cls: "mod-cta" });
    copyBtn.addEventListener("click", async () => {
      await navigator.clipboard.writeText(this.code);
      new Notice("Recovery code copied to clipboard!");
      copyBtn.setText("Copied!");
      setTimeout(() => copyBtn.setText("Copy Code"), 2000);
    });

    const closeBtn = buttonRow.createEl("button", { text: "Done / I Saved It" });
    closeBtn.addEventListener("click", () => {
      this.close();
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}

class AddPathModal extends Modal {
  plugin: StoneGatePlugin;
  onSubmit: (success: boolean) => void;

  constructor(app: App, plugin: StoneGatePlugin, onSubmit: (success: boolean) => void) {
    super(app);
    this.plugin = plugin;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Add Protected Path" });

    // Path Input with Autocomplete
    const pathWrapper = contentEl.createDiv({ cls: "sg-modal-input-container" });
    pathWrapper.createEl("label", { text: "Folder path (e.g. Secret/ or / for entire vault)" }).style.display = "block";
    pathWrapper.style.marginBottom = "8px";
    
    const pathInput = pathWrapper.createEl("input", { type: "text", attr: { placeholder: "Path..." } });
    pathInput.style.width = "100%";
    
    const dropdown = pathWrapper.createDiv("sg-autocomplete-dropdown");
    dropdown.style.display = "none";

    const folders = this.app.vault.getAllFolders().map(f => f.path);
    folders.unshift("/"); // Allow matching root
    
    const updateDropdown = () => {
      dropdown.empty();
      const query = pathInput.value.toLowerCase();
      const matches = folders.filter(f => f.toLowerCase().includes(query)).slice(0, 8);
      
      if (matches.length > 0 && query.length > 0) {
        dropdown.style.display = "block";
        for (const match of matches) {
          const item = dropdown.createDiv({ cls: "sg-autocomplete-item", text: match === "/" ? "Vault (/)" : match });
          item.addEventListener("click", () => {
            pathInput.value = match;
            dropdown.style.display = "none";
          });
        }
      } else {
        dropdown.style.display = "none";
      }
    };

    pathInput.addEventListener("input", updateDropdown);

    // Label Input
    const labelWrapper = contentEl.createDiv({ cls: "sg-modal-input-container" });
    labelWrapper.createEl("label", { text: "Friendly Label (optional)" }).style.display = "block";
    labelWrapper.style.marginBottom = "8px";
    const labelInput = labelWrapper.createEl("input", { type: "text", attr: { placeholder: "My Secrets" } });
    labelInput.style.width = "100%";

    // Timeout Input
    const timeoutWrapper = contentEl.createDiv({ cls: "sg-modal-input-container" });
    timeoutWrapper.createEl("label", { text: "Timeout in Minutes (decimals allowed, e.g., 0.5 = 30s)" }).style.display = "block";
    timeoutWrapper.style.marginBottom = "8px";
    const timeoutInput = timeoutWrapper.createEl("input", { type: "number", attr: { placeholder: "Minutes (e.g. 0.5 = 30s, 3 = 3min)", step: "any" } });
    timeoutInput.style.width = "100%";
    timeoutInput.value = "3";

    // Hint Input
    const hintWrapper = contentEl.createDiv({ cls: "sg-modal-input-container" });
    hintWrapper.createEl("label", { text: "Password Hint (optional)" }).style.display = "block";
    hintWrapper.style.marginBottom = "8px";
    const hintInput = hintWrapper.createEl("input", { type: "text", attr: { placeholder: "Hint or custom message..." } });
    hintInput.style.width = "100%";

    // Show hint toggle
    const toggleWrapper = contentEl.createDiv({ cls: "sg-modal-input-container" });
    toggleWrapper.style.display = "flex";
    toggleWrapper.style.flexDirection = "row";
    toggleWrapper.style.alignItems = "center";
    toggleWrapper.style.justifyContent = "flex-start";
    toggleWrapper.style.gap = "8px";
    toggleWrapper.style.marginBottom = "16px";
    const showHintToggle = toggleWrapper.createEl("input", { type: "checkbox" });
    const showHintLabel = toggleWrapper.createEl("span", { text: "Show hint on lock screen" });
    showHintLabel.style.cursor = "pointer";
    showHintLabel.addEventListener("click", () => showHintToggle.click());

    // Ghost mode toggle
    const ghostWrapper = contentEl.createDiv({ cls: "sg-modal-input-container" });
    ghostWrapper.style.display = "flex";
    ghostWrapper.style.flexDirection = "row";
    ghostWrapper.style.alignItems = "center";
    ghostWrapper.style.justifyContent = "flex-start";
    ghostWrapper.style.gap = "8px";
    ghostWrapper.style.marginBottom = "16px";
    const ghostToggle = ghostWrapper.createEl("input", { type: "checkbox" });
    ghostToggle.style.flexShrink = "0";
    const ghostLabel = ghostWrapper.createEl("span", { text: "Enable Ghost Mode (Hide this path from File Explorer)" });
    ghostLabel.style.cursor = "pointer";
    ghostLabel.addEventListener("click", () => ghostToggle.click());

    // Set path password
    let tempHash: string | undefined = undefined;
    let tempSalt: string | undefined = undefined;
    const pwdBtn = contentEl.createEl("button", { text: "Set Password for this path (optional)" });
    pwdBtn.style.marginBottom = "16px";
    pwdBtn.addEventListener("click", () => {
      new PasswordModal(this.app, this.plugin, undefined, undefined, "Path Password", (success, hash, salt) => {
        if (success && hash && salt) {
          tempHash = hash;
          tempSalt = salt;
          pwdBtn.textContent = "Path password set ✓";
        }
      }).open();
    });

    const errorEl = contentEl.createDiv("sg-error");

    const submitBtn = contentEl.createEl("button", { text: "Add", cls: "mod-cta" });
    submitBtn.style.marginTop = "16px";

    const submit = async () => {
      errorEl.textContent = "";
      const pathVal = pathInput.value.trim();
      const labelVal = labelInput.value.trim();
      const timeoutVal = parseFloat(timeoutInput.value);

      if (!pathVal) {
        errorEl.textContent = "Path cannot be empty.";
        return;
      }
      
      if (isNaN(timeoutVal) || timeoutVal < 0) {
        errorEl.textContent = "Timeout must be a positive number.";
        return;
      }
      
      if (this.plugin.settings.protectedPaths.some(p => p.path === pathVal)) {
        errorEl.textContent = "Path is already protected.";
        return;
      }

      this.plugin.settings.protectedPaths.push({
        id: "path-" + Date.now(),
        path: pathVal,
        label: labelVal || undefined,
        timeoutMinutes: timeoutVal,
        passwordHash: tempHash,
        passwordSalt: tempSalt,
        passwordHint: hintInput.value.trim() || undefined,
        showHint: showHintToggle.checked,
        enableGhostMode: ghostToggle.checked
      });
      
      await this.plugin.saveSettings();
      this.onSubmit(true);
      this.close();
    };

    submitBtn.addEventListener("click", submit);
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    };
    pathInput.addEventListener("keydown", handleKey);
    labelInput.addEventListener("keydown", handleKey);
    timeoutInput.addEventListener("keydown", handleKey);

    // Close dropdown when clicking outside
    document.addEventListener("click", (e) => {
      if (!pathWrapper.contains(e.target as Node)) {
        dropdown.style.display = "none";
      }
    });

    setTimeout(() => pathInput.focus(), 50);
  }

  onClose() {
    this.contentEl.empty();
  }
}

class EditPathModal extends Modal {
  plugin: StoneGatePlugin;
  pathObj: ProtectedPath;
  onSubmit: (success: boolean) => void;

  constructor(app: App, plugin: StoneGatePlugin, pathObj: ProtectedPath, onSubmit: (success: boolean) => void) {
    super(app);
    this.plugin = plugin;
    this.pathObj = pathObj;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Edit Protected Path" });
    contentEl.createEl("p", { text: `Path: ${this.pathObj.path === "/" ? "Vault (/)" : this.pathObj.path}` });

    // Label Input
    const labelWrapper = contentEl.createDiv({ cls: "sg-modal-input-container" });
    labelWrapper.createEl("label", { text: "Friendly Label" }).style.display = "block";
    labelWrapper.style.marginBottom = "8px";
    const labelInput = labelWrapper.createEl("input", { type: "text", attr: { placeholder: "Label" } });
    labelInput.style.width = "100%";
    labelInput.value = this.pathObj.label || "";

    // Timeout Input
    const timeoutWrapper = contentEl.createDiv({ cls: "sg-modal-input-container" });
    timeoutWrapper.createEl("label", { text: "Timeout in Minutes (decimals allowed, e.g., 0.5 = 30s)" }).style.display = "block";
    timeoutWrapper.style.marginBottom = "8px";
    const timeoutInput = timeoutWrapper.createEl("input", { type: "number", attr: { placeholder: "Minutes", step: "any" } });
    timeoutInput.style.width = "100%";
    timeoutInput.value = String(this.pathObj.timeoutMinutes);

    // Hint Input
    const hintWrapper = contentEl.createDiv({ cls: "sg-modal-input-container" });
    hintWrapper.createEl("label", { text: "Password Hint" }).style.display = "block";
    hintWrapper.style.marginBottom = "8px";
    const hintInput = hintWrapper.createEl("input", { type: "text", attr: { placeholder: "Hint or custom message..." } });
    hintInput.style.width = "100%";
    hintInput.value = this.pathObj.passwordHint || "";

    // Show hint toggle
    const toggleWrapper = contentEl.createDiv({ cls: "sg-modal-input-container" });
    toggleWrapper.style.display = "flex";
    toggleWrapper.style.flexDirection = "row";
    toggleWrapper.style.alignItems = "center";
    toggleWrapper.style.justifyContent = "flex-start";
    toggleWrapper.style.gap = "8px";
    toggleWrapper.style.marginBottom = "16px";
    const showHintToggle = toggleWrapper.createEl("input", { type: "checkbox" });
    showHintToggle.checked = this.pathObj.showHint;
    const showHintLabel = toggleWrapper.createEl("span", { text: "Show hint on lock screen" });
    showHintLabel.style.cursor = "pointer";
    showHintLabel.addEventListener("click", () => showHintToggle.click());

    // Ghost mode toggle
    const ghostWrapper = contentEl.createDiv({ cls: "sg-modal-input-container" });
    ghostWrapper.style.display = "flex";
    ghostWrapper.style.flexDirection = "row";
    ghostWrapper.style.alignItems = "center";
    ghostWrapper.style.justifyContent = "flex-start";
    ghostWrapper.style.gap = "8px";
    ghostWrapper.style.marginBottom = "16px";
    const ghostToggle = ghostWrapper.createEl("input", { type: "checkbox" });
    ghostToggle.style.flexShrink = "0";
    ghostToggle.checked = !!this.pathObj.enableGhostMode;
    const ghostLabel = ghostWrapper.createEl("span", { text: "Enable Ghost Mode (Hide this path from File Explorer)" });
    ghostLabel.style.cursor = "pointer";
    ghostLabel.addEventListener("click", () => ghostToggle.click());

    const pwdControls = contentEl.createDiv();
    pwdControls.style.display = "flex";
    pwdControls.style.gap = "8px";
    pwdControls.style.marginBottom = "16px";

    const pwdBtn = pwdControls.createEl("button", { text: this.pathObj.passwordHash ? "Change Path Password" : "Set Path Password" });
    pwdBtn.addEventListener("click", () => {
      new PasswordModal(this.app, this.plugin, this.pathObj.passwordHash, this.pathObj.passwordSalt, "Path Password", async (success, hash, salt) => {
        if (success && hash && salt) {
          this.pathObj.passwordHash = hash;
          this.pathObj.passwordSalt = salt;
          await this.plugin.saveSettings();
          this.onSubmit(true);
          this.close();
        }
      }).open();
    });

    if (this.pathObj.passwordHash) {
      const rmPwdBtn = pwdControls.createEl("button", { text: "Remove Path Password", cls: "mod-warning" });
      rmPwdBtn.addEventListener("click", () => {
        new ConfirmPasswordModal(this.app, this.plugin, this.pathObj.passwordHash, this.pathObj.passwordSalt, "Path Password", async (success) => {
          if (success) {
            this.pathObj.passwordHash = undefined;
            this.pathObj.passwordSalt = undefined;
            await this.plugin.saveSettings();
            this.onSubmit(true);
            this.close();
          }
        }).open();
      });
    }

    const errorEl = contentEl.createDiv("sg-error");

    const controls = contentEl.createDiv();
    controls.style.display = "flex";
    controls.style.gap = "8px";
    controls.style.marginTop = "16px";

    const submitBtn = controls.createEl("button", { text: "Save", cls: "mod-cta" });
    const cancelBtn = controls.createEl("button", { text: "Cancel" });

    const submit = async () => {
      errorEl.textContent = "";
      const labelVal = labelInput.value.trim();
      const timeoutVal = parseFloat(timeoutInput.value);

      if (isNaN(timeoutVal) || timeoutVal < 0) {
        errorEl.textContent = "Timeout must be a positive number.";
        return;
      }

      this.pathObj.label = labelVal || undefined;
      this.pathObj.timeoutMinutes = timeoutVal;
      this.pathObj.passwordHint = hintInput.value.trim() || undefined;
      this.pathObj.showHint = showHintToggle.checked;
      this.pathObj.enableGhostMode = ghostToggle.checked;
      
      await this.plugin.saveSettings();
      this.plugin.lockManager.updateGhostModeStyles();
      this.onSubmit(true);
      this.close();
    };

    submitBtn.addEventListener("click", submit);
    cancelBtn.addEventListener("click", () => this.close());
    
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    };
    labelInput.addEventListener("keydown", handleKey);
    timeoutInput.addEventListener("keydown", handleKey);
    hintInput.addEventListener("keydown", handleKey);

    setTimeout(() => labelInput.focus(), 50);
  }

  onClose() {
    this.contentEl.empty();
  }
}
