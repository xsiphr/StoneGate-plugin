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
      lastUnlocked: undefined
    }
  ],
  lockOnStartup: true,
  maxFailedAttempts: 3,
  lockoutDurationSeconds: 60,
  showStoneGateTitle: true,
};
