import { StoneGateSettings } from "./types";

export const DEFAULT_SETTINGS: StoneGateSettings = {
  enabled: false,
  passwordHash: undefined,
  passwordSalt: undefined,
  passwordHint: undefined,
  showMasterHint: false,
  protectedPaths: [
    {
      id: "default",
      path: "/",
      label: "Vault",
      timeoutMinutes: 3,
      showHint: false,
      enableGhostMode: false,
      lastUnlocked: undefined
    }
  ],
  lockOnStartup: true,
  lockOnBlur: false,
  blurGracePeriodSeconds: 3,
  intruderAlert: false,
  maxFailedAttempts: 3,
  lockoutDurationSeconds: 60,
  failedAttempts: 0,
  totalIntruderAttempts: 0,
  lockoutUntil: 0,
  recoveryCodeHash: undefined,
  recoveryCodeSalt: undefined,
  showStoneGateTitle: true,
  customTitle: undefined,
  unlockMenuPasswordHash: undefined,
  unlockMenuPasswordSalt: undefined,
  unlockMenuPasswordHint: undefined,
  customBackgroundUrl: "",
};
