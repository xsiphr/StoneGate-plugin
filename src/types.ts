export interface ProtectedPath {
  id: string;
  path: string;
  label?: string;
  timeoutMinutes: number;
  lastUnlocked?: number;
  passwordHash?: string;
  passwordSalt?: string;
  passwordHint?: string;
  showHint: boolean;
  enableGhostMode?: boolean;
}

export interface StoneGateSettings {
  enabled: boolean;
  passwordHash?: string;       // base64 PBKDF2-SHA256 hash
  passwordSalt?: string;       // base64 random 16-byte salt
  passwordHint?: string;
  showMasterHint: boolean;
  protectedPaths: ProtectedPath[];
  lockOnStartup: boolean;
  lockOnBlur: boolean;
  blurGracePeriodSeconds: number;
  intruderAlert: boolean;
  maxFailedAttempts: number;   // 0 = unlimited
  lockoutDurationSeconds: number;
  failedAttempts: number;
  totalIntruderAttempts: number;
  lockoutUntil: number;
  recoveryCodeHash?: string;
  recoveryCodeSalt?: string;
  showStoneGateTitle: boolean;
  customTitle?: string;
  unlockMenuPasswordHash?: string;
  unlockMenuPasswordSalt?: string;
  unlockMenuPasswordHint?: string;
  customBackgroundUrl: string;
}
