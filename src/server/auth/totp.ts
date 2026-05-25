import QRCode from 'qrcode';
import { Secret, TOTP } from 'otpauth';

export const totpDefaults = {
  algorithm: 'SHA1',
  digits: 6,
  issuer: 'Leominal',
  period: 30
} as const;

export interface TotpConfig {
  secret: string;
  accountName: string;
}

export function generateTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

export function createTotpUri(config: TotpConfig): string {
  return new TOTP({
    issuer: totpDefaults.issuer,
    label: config.accountName,
    algorithm: totpDefaults.algorithm,
    digits: totpDefaults.digits,
    period: totpDefaults.period,
    secret: Secret.fromBase32(config.secret)
  }).toString();
}

export async function createTotpQrCodeDataUrl(uri: string): Promise<string> {
  return QRCode.toDataURL(uri, { margin: 1, scale: 4 });
}

export function verifyTotpCode(secret: string, token: string, timestamp: number): boolean {
  if (!/^[0-9]{6}$/.test(token)) {
    return false;
  }
  try {
    const totp = new TOTP({
      issuer: totpDefaults.issuer,
      label: 'Leominal',
      algorithm: totpDefaults.algorithm,
      digits: totpDefaults.digits,
      period: totpDefaults.period,
      secret: Secret.fromBase32(secret)
    });
    return totp.validate({ token, timestamp, window: 1 }) !== null;
  } catch {
    return false;
  }
}
