StoneGate 🔒

StoneGate is a high-security lock screen plugin for Obsidian, designed to protect your vault and individual folders with password authentication.

Stop worrying about prying eyes. Whether you are using your vault in a public space or sharing your device, StoneGate ensures your sensitive notes remain private.
🚀 Features

    Vault & Folder Protection: Lock your entire vault or specific sensitive folders with unique passwords.

    Idle Timeout: Automatically lock your vault after a period of inactivity.

    Persistent Lockout: Protect against brute-force attacks with a secure lockout mechanism after failed attempts.

    Emergency Recovery: Never lose access—generate a one-time secure recovery code to bypass lockouts.

    Stealth Mode (Ghost Mode): Hide protected folders from the File Explorer entirely.

    Premium Customization: * Set custom background images (supports external URLs and Vault paths).
    

🛠 Installation

Currently, StoneGate is in pre-release. You can install it using the BRAT plugin:

    Install  BRAT from the Community Plugins browser.

    Open BRAT settings.

    Add `xsiphr/StoneGate-plugin` to the list of Beta plugins.

    Enable StoneGate in your Community Plugins list.

🛡 Security Practices

    Hashing: StoneGate uses industry-standard bcrypt for all password and recovery code hashing.

    Data Integrity: Your secrets are stored locally. We never transmit your passwords or vault data to any external server.

    Recommendation: For maximum security, we recommend using this plugin in combination with system-level encryption (e.g., Cryptomator) for your vault files.

⚙️ Configuration

    Master Password: Set this in the settings tab to enable the base protection.

    Recovery Code: Generate your recovery code under "Recovery Options." Keep this code offline! It is the only way to regain access if you forget your password.

    Ghost Mode: When enabled, the folder will vanish from the file explorer. Use the "Unlock Menu" (Command Palette: StoneGate: Unlock Path) to access it.

📝 License

This project is licensed under the MIT License.

Built with passion by Abdulrahman Agiba |xsiphr . 
