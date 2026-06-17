import { App, Modal, PluginSettingTab, Setting, Notice, AbstractInputSuggest, setIcon } from "obsidian";
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

    new Setting(containerEl).setName("General").setHeading();

    // --- Protection Enable/Disable ---
    new Setting(containerEl)
      .setName("Enable StoneGate")
      .setDesc("Turn on lock screen protection")
      .addToggle((toggle) => {
        let isSyncing = false;
        toggle
          .setValue(this.plugin.settings.enabled)
          .onChange((value) => {
            void (async () => {
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
            })();
          });
      });

    new Setting(containerEl).setName("Master Password").setHeading();

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
        .addButton((btn) => {
          btn.setButtonText("Remove");
          if (typeof (btn as any).setDestructive === "function") {
            (btn as any).setDestructive();
          } else {
            (btn as any)["setWarning"]();
          }
          btn.onClick(() => {
            new ConfirmPasswordModal(this.app, this.plugin, this.plugin.settings.passwordHash, this.plugin.settings.passwordSalt, "Master Password", async (success) => {
              if (success) {
                this.plugin.settings.passwordHash = undefined;
                this.plugin.settings.passwordSalt = undefined;
                this.plugin.settings.enabled = false; // Disable if no password
                await this.plugin.saveSettings();
                this.display();
              }
            }).open();
          });
        });



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

    new Setting(containerEl).setName("Protected Paths").setHeading();

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

    new Setting(containerEl).setName("Behavior").setHeading();

    new Setting(containerEl)
      .setName("Lock on Startup")
      .setDesc("Require password immediately when opening Obsidian")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.lockOnStartup)
          .onChange((value) => {
            this.plugin.settings.lockOnStartup = value;
            void this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Lock when Obsidian loses focus")
      .setDesc("Lock immediately when the window loses focus")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.lockOnBlur)
          .onChange((value) => {
            this.plugin.settings.lockOnBlur = value;
            void this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Blur Grace Period (seconds)")
      .setDesc("Time in seconds to wait before locking after focus loss (0 = immediate)")
      .addText((text) =>
        text
          .setPlaceholder("3")
          .setValue(String(this.plugin.settings.blurGracePeriodSeconds))
          .onChange((value) => {
            const num = parseInt(value, 10);
            if (!isNaN(num) && num >= 0) {
              this.plugin.settings.blurGracePeriodSeconds = num;
              void this.plugin.saveSettings();
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
          .onChange((value) => {
            const num = parseInt(value, 10);
            if (!isNaN(num) && num >= 0) {
              this.plugin.settings.maxFailedAttempts = num;
              void this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Lockout Duration (seconds)")
      .addText((text) =>
        text
          .setPlaceholder("60")
          .setValue(String(this.plugin.settings.lockoutDurationSeconds))
          .onChange((value) => {
            const num = parseInt(value, 10);
            if (!isNaN(num) && num >= 0) {
              this.plugin.settings.lockoutDurationSeconds = num;
              void this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Intruder Alert")
      .setDesc("Show a notice upon unlocking if there were failed attempts")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.intruderAlert)
          .onChange((value) => {
            this.plugin.settings.intruderAlert = value;
            void this.plugin.saveSettings();
          })
      );



    new Setting(containerEl).setName("Appearance").setHeading();

    new Setting(containerEl)
      .setName("Show StoneGate Title")
      .setDesc("Show the 'StoneGate' app name at the top of the lock screen")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showStoneGateTitle)
          .onChange((value) => {
            this.plugin.settings.showStoneGateTitle = value;
            void this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Custom Lock Screen Title")
      .setDesc("Custom text to show at the top of the lock screen (defaults to 'StoneGate')")
      .addText((text) =>
        text
          .setPlaceholder("StoneGate")
          .setValue(this.plugin.settings.customTitle || "")
          .onChange((value) => {
            this.plugin.settings.customTitle = value.trim() || undefined;
            void this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Custom Background URL/Path")
      .setDesc("URL or local path to a custom background image. You can use an external URL (http/https), or a local file from the vault (simply type the file name or use the path in the vault).")
      .addText((text) => {
        text
          .setPlaceholder("https://example.com/image.jpg")
          .setValue(this.plugin.settings.customBackgroundUrl || "")
          .onChange((value) => {
            this.plugin.settings.customBackgroundUrl = value.trim();
            void this.plugin.saveSettings();
          });
        new ImagePathSuggest(this.app, text.inputEl);
      });



    new Setting(containerEl).setName("Ghost Mode & Commands").setHeading();

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
        .addButton((btn) => {
          btn.setButtonText("Remove");
          if (typeof (btn as any).setDestructive === "function") {
            (btn as any).setDestructive();
          } else {
            (btn as any)["setWarning"]();
          }
          btn.onClick(() => {
            new ConfirmPasswordModal(this.app, this.plugin, this.plugin.settings.unlockMenuPasswordHash, this.plugin.settings.unlockMenuPasswordSalt, "Unlock Menu Password", async (success) => {
              if (success) {
                this.plugin.settings.unlockMenuPasswordHash = undefined;
                this.plugin.settings.unlockMenuPasswordSalt = undefined;
                await this.plugin.saveSettings();
                this.display();
              }
            }).open();
          });
        });
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
          .onChange((value) => {
            this.plugin.settings.unlockMenuPasswordHint = value.trim() || undefined;
            void this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setName("Security").setHeading();

    const recoverySetting = new Setting(containerEl)
      .setName("Recovery Code (Global Skeleton Key)")
      .setDesc("A 6-character recovery code that can bypass and unlock any path if you forget your password.");

    if (this.plugin.settings.recoveryCodeHash) {
      recoverySetting
        .setDesc("A recovery code is configured. You can use it to bypass lock screens. (For security, only the hash is stored; the code cannot be shown again).")
        .addButton((btn) => {
          btn.setButtonText("Remove Recovery Code");
          if (typeof (btn as any).setDestructive === "function") {
            (btn as any).setDestructive();
          } else {
            (btn as any)["setWarning"]();
          }
          btn.onClick(() => {
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
          });
        });
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
  setIcon(eyeBtn, "eye");
  eyeBtn.addEventListener("click", () => {
    const isPassword = input.type === "password";
    input.type = isPassword ? "text" : "password";
    if (isPassword) {
      setIcon(eyeBtn, "eye-off");
    } else {
      setIcon(eyeBtn, "eye");
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

    const submitBtn = contentEl.createEl("button", { text: "Save", cls: "mod-cta sg-modal-submit-btn" });

    const submit = async () => {
      errorEl.textContent = "";
      if (currentInput) {
        currentInput.setCssStyles({ borderColor: "" });
      }
      if (currentInput && this.targetHash && this.targetSalt) {
        const isMatch = await verifyPassword(currentInput.value, this.targetHash, this.targetSalt);
        if (!isMatch) {
          errorEl.textContent = "Current password is incorrect.";
          currentInput.setCssStyles({ borderColor: "#e05555" });
          return;
        }
      }

      const p1 = newPasswordInput.value;
      const p2 = confirmPasswordInput.value;

      if (!p1 || p1.length < 4 || !/^[\u0000-\u007F]*$/.test(p1)) {
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
    
    window.setTimeout(() => {
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

    const submitBtn = contentEl.createEl("button", { text: "Confirm", cls: "mod-cta sg-modal-submit-btn" });

    const submit = async () => {
      errorEl.textContent = "";
      input.setCssStyles({ borderColor: "" });
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
        input.setCssStyles({ borderColor: "#e05555" });
      }
    };

    submitBtn.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });
    window.setTimeout(() => input.focus(), 50);
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
    desc.addClass("sg-display-desc");

    const warningBox = contentEl.createDiv("sg-warning-box sg-display-warning-box");
    
    warningBox.createEl("strong", { text: "⚠️ IMPORTANT WARNING:", cls: "sg-display-warning-title" });

    warningBox.createEl("span", {
      text: "Write this code down or save it in a secure password manager. For security reasons, the code is hashed before saving, and it CANNOT be shown or recovered again once you close this window.",
      cls: "sg-display-warning-text"
    });

    const codeContainer = contentEl.createDiv("sg-recovery-code-container sg-display-code-container");

    codeContainer.createEl("div", { text: this.code, cls: "sg-display-code-el" });

    const buttonRow = contentEl.createDiv("sg-button-row sg-display-button-row");

    const copyBtn = buttonRow.createEl("button", { text: "Copy Code", cls: "mod-cta" });
    copyBtn.addEventListener("click", async () => {
      await navigator.clipboard.writeText(this.code);
      new Notice("Recovery code copied to clipboard!");
      copyBtn.setText("Copied!");
      window.setTimeout(() => copyBtn.setText("Copy Code"), 2000);
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
    const pathWrapper = contentEl.createDiv({ cls: "sg-modal-input-container sg-small-margin" });
    pathWrapper.createEl("label", { text: "Folder path (e.g. Secret/ or / for entire vault)" });
    
    const pathInput = pathWrapper.createEl("input", { type: "text", attr: { placeholder: "Path..." } });
    
    const dropdown = pathWrapper.createDiv("sg-autocomplete-dropdown");
    dropdown.hide();

    const folders = this.app.vault.getAllFolders().map(f => f.path);
    folders.unshift("/"); // Allow matching root
    
    const updateDropdown = () => {
      dropdown.empty();
      const query = pathInput.value.toLowerCase();
      const matches = folders.filter(f => f.toLowerCase().includes(query)).slice(0, 8);
      
      if (matches.length > 0 && query.length > 0) {
        dropdown.show();
        for (const match of matches) {
          const item = dropdown.createDiv({ cls: "sg-autocomplete-item", text: match === "/" ? "Vault (/)" : match });
          item.addEventListener("click", () => {
            pathInput.value = match;
            dropdown.hide();
          });
        }
      } else {
        dropdown.hide();
      }
    };

    pathInput.addEventListener("input", updateDropdown);

    // Label Input
    const labelWrapper = contentEl.createDiv({ cls: "sg-modal-input-container sg-small-margin" });
    labelWrapper.createEl("label", { text: "Friendly Label (optional)" });
    const labelInput = labelWrapper.createEl("input", { type: "text", attr: { placeholder: "My Secrets" } });

    // Timeout Input
    const timeoutWrapper = contentEl.createDiv({ cls: "sg-modal-input-container sg-small-margin" });
    timeoutWrapper.createEl("label", { text: "Timeout in Minutes (decimals allowed, e.g., 0.5 = 30s)" });
    const timeoutInput = timeoutWrapper.createEl("input", { type: "number", attr: { placeholder: "Minutes (e.g. 0.5 = 30s, 3 = 3min)", step: "any" } });
    timeoutInput.value = "3";

    // Hint Input
    const hintWrapper = contentEl.createDiv({ cls: "sg-modal-input-container sg-small-margin" });
    hintWrapper.createEl("label", { text: "Password Hint (optional)" });
    const hintInput = hintWrapper.createEl("input", { type: "text", attr: { placeholder: "Hint or custom message..." } });

    // Show hint toggle
    const toggleWrapper = contentEl.createDiv({ cls: "sg-modal-input-container sg-flex-row" });
    const showHintToggle = toggleWrapper.createEl("input", { type: "checkbox" });
    const showHintLabel = toggleWrapper.createEl("span", { text: "Show hint on lock screen" });
    showHintLabel.addEventListener("click", () => showHintToggle.click());

    // Ghost mode toggle
    const ghostWrapper = contentEl.createDiv({ cls: "sg-modal-input-container sg-flex-row" });
    const ghostToggle = ghostWrapper.createEl("input", { type: "checkbox" });
    const ghostLabel = ghostWrapper.createEl("span", { text: "Enable Ghost Mode (Hide this path from File Explorer)" });
    ghostLabel.addEventListener("click", () => ghostToggle.click());

    // Show in Unlock Menu toggle
    const menuWrapper = contentEl.createDiv({ cls: "sg-modal-input-container sg-flex-row" });
    const menuToggle = menuWrapper.createEl("input", { type: "checkbox" });
    const menuLabel = menuWrapper.createEl("span", { text: "Show in Unlock Menu" });
    menuLabel.addEventListener("click", () => {
      if (!menuToggle.disabled) {
        menuToggle.click();
      }
    });

    // Description text for the new toggle
    contentEl.createEl("p", {
      text: "If enabled, this path will be listed in the Unlock Menu. Note: Paths with Ghost Mode enabled are ALWAYS listed.",
      cls: "sg-modal-desc-small"
    });

    // Enforce dependency logic
    ghostToggle.addEventListener("change", () => {
      if (ghostToggle.checked) {
        menuToggle.checked = true;
        menuToggle.disabled = true;
      } else {
        menuToggle.disabled = false;
      }
    });

    // Set path password
    let tempHash: string | undefined = undefined;
    let tempSalt: string | undefined = undefined;
    const pwdBtn = contentEl.createEl("button", { text: "Set Password for this path (optional)", cls: "sg-path-password-btn" });
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

    const submitBtn = contentEl.createEl("button", { text: "Add", cls: "mod-cta sg-modal-submit-btn" });

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
        enableGhostMode: ghostToggle.checked,
        showInUnlockMenu: menuToggle.checked
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
    activeDocument.addEventListener("click", (e) => {
      if (!pathWrapper.contains(e.target as Node)) {
        dropdown.hide();
      }
    });

    window.setTimeout(() => pathInput.focus(), 50);
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
    const labelWrapper = contentEl.createDiv({ cls: "sg-modal-input-container sg-small-margin" });
    labelWrapper.createEl("label", { text: "Friendly Label" });
    const labelInput = labelWrapper.createEl("input", { type: "text", attr: { placeholder: "Label" } });
    labelInput.value = this.pathObj.label || "";

    // Timeout Input
    const timeoutWrapper = contentEl.createDiv({ cls: "sg-modal-input-container sg-small-margin" });
    timeoutWrapper.createEl("label", { text: "Timeout in Minutes (decimals allowed, e.g., 0.5 = 30s)" });
    const timeoutInput = timeoutWrapper.createEl("input", { type: "number", attr: { placeholder: "Minutes", step: "any" } });
    timeoutInput.value = String(this.pathObj.timeoutMinutes);

    // Hint Input
    const hintWrapper = contentEl.createDiv({ cls: "sg-modal-input-container sg-small-margin" });
    hintWrapper.createEl("label", { text: "Password Hint" });
    const hintInput = hintWrapper.createEl("input", { type: "text", attr: { placeholder: "Hint or custom message..." } });
    hintInput.value = this.pathObj.passwordHint || "";

    // Show hint toggle
    const toggleWrapper = contentEl.createDiv({ cls: "sg-modal-input-container sg-flex-row" });
    const showHintToggle = toggleWrapper.createEl("input", { type: "checkbox" });
    showHintToggle.checked = this.pathObj.showHint;
    const showHintLabel = toggleWrapper.createEl("span", { text: "Show hint on lock screen" });
    showHintLabel.addEventListener("click", () => showHintToggle.click());

    // Ghost mode toggle
    const ghostWrapper = contentEl.createDiv({ cls: "sg-modal-input-container sg-flex-row" });
    const ghostToggle = ghostWrapper.createEl("input", { type: "checkbox" });
    ghostToggle.checked = !!this.pathObj.enableGhostMode;
    const ghostLabel = ghostWrapper.createEl("span", { text: "Enable Ghost Mode (Hide this path from File Explorer)" });
    ghostLabel.addEventListener("click", () => ghostToggle.click());

    // Show in Unlock Menu toggle
    const menuWrapper = contentEl.createDiv({ cls: "sg-modal-input-container sg-flex-row" });
    const menuToggle = menuWrapper.createEl("input", { type: "checkbox" });
    menuToggle.checked = !!this.pathObj.showInUnlockMenu;
    const menuLabel = menuWrapper.createEl("span", { text: "Show in Unlock Menu" });
    menuLabel.addEventListener("click", () => {
      if (!menuToggle.disabled) {
        menuToggle.click();
      }
    });

    // Description text for the new toggle
    contentEl.createEl("p", {
      text: "If enabled, this path will be listed in the Unlock Menu. Note: Paths with Ghost Mode enabled are ALWAYS listed.",
      cls: "sg-modal-desc-small"
    });

    // Enforce initial disabled state if Ghost Mode was already enabled
    if (ghostToggle.checked) {
      menuToggle.checked = true;
      menuToggle.disabled = true;
    }

    // Enforce dependency logic
    ghostToggle.addEventListener("change", () => {
      if (ghostToggle.checked) {
        menuToggle.checked = true;
        menuToggle.disabled = true;
      } else {
        menuToggle.disabled = false;
      }
    });

    const pwdControls = contentEl.createDiv("sg-modal-button-row-left");

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

    const controls = contentEl.createDiv("sg-modal-button-row-right");

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
      this.pathObj.showInUnlockMenu = menuToggle.checked;
      
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

    window.setTimeout(() => labelInput.focus(), 50);
  }

  onClose() {
    this.contentEl.empty();
  }
}

export class ImagePathSuggest extends AbstractInputSuggest<string> {
  private inputEl: HTMLInputElement;

  constructor(app: App, inputEl: HTMLInputElement) {
    super(app, inputEl);
    this.inputEl = inputEl;
  }

  protected getSuggestions(query: string): string[] {
    const files = this.app.vault.getFiles();
    const extensions = ["png", "jpg", "jpeg", "gif", "svg", "webp"];
    const lowerQuery = query.toLowerCase();

    return files
      .filter((file) => {
        const ext = file.extension.toLowerCase();
        const matchesExtension = extensions.includes(ext);
        const matchesQuery = file.path.toLowerCase().contains(lowerQuery);
        return matchesExtension && matchesQuery;
      })
      .map((file) => file.path);
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    el.setText(value);
  }

  selectSuggestion(value: string, evt: MouseEvent | KeyboardEvent): void {
    this.setValue(value);
    this.inputEl.dispatchEvent(new Event("input"));
    this.close();
  }
}
