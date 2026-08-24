import { Injectable, Inject } from "@nestjs/common";
import {
  createCipheriv, createDecipheriv, createHash, createHmac, randomBytes,
  randomInt, timingSafeEqual,
} from "node:crypto";
import * as argon2 from "argon2";
import { authConfig, type AuthConfig } from "@/config/configuration";

/* ============================================================================
 * All cryptographic primitives live here so the choices are auditable in one
 * place and nothing is re-implemented per module.
 * ========================================================================== */

@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(@Inject(authConfig.KEY) private readonly cfg: AuthConfig) {
    this.key = Buffer.from(cfg.encryptionKey, "hex");
  }

  /* ------------------------------ passwords ------------------------------ */

  /**
   * Argon2id — memory-hard, the current OWASP recommendation. Parameters follow
   * the OWASP ASVS L2 minimum (19 MiB, 2 iterations, 1 lane).
   */
  hashPassword(plain: string): Promise<string> {
    return argon2.hash(plain, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
  }

  async verifyPassword(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      // A malformed stored hash must read as "wrong password", never as a crash.
      return false;
    }
  }

  /** True when the stored hash was produced with weaker parameters than current.
   *  Callers re-hash transparently on the next successful login. */
  needsRehash(hash: string): boolean {
    try {
      return argon2.needsRehash(hash, { memoryCost: 19456, timeCost: 2 });
    } catch {
      return true;
    }
  }

  /* ------------------------- symmetric encryption ------------------------ */

  /**
   * AES-256-GCM for data we must be able to read back: TOTP secrets, KYC
   * document storage keys, bank detail fragments. Output is
   * `v1.<iv>.<tag>.<ciphertext>`, all base64url, so the format is versioned and
   * we can rotate the scheme later without ambiguity.
   */
  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ["v1", iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
  }

  decrypt(payload: string): string {
    const [version, ivB64, tagB64, ctB64] = payload.split(".");
    if (version !== "v1" || !ivB64 || !tagB64 || !ctB64) {
      throw new Error("Malformed ciphertext");
    }
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(ivB64, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ctB64, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }

  /* --------------------------------- hashes ------------------------------ */

  /** Deterministic lookup hash. Used for indexed columns over sensitive values
   *  (email lookup, refresh-token matching) so we never store the raw value. */
  hmac(value: string): string {
    return createHmac("sha256", this.key).update(value).digest("hex");
  }

  sha256(value: string | Buffer): string {
    return createHash("sha256").update(value).digest("hex");
  }

  /* --------------------------------- tokens ------------------------------ */

  /** URL-safe opaque token. 32 bytes = 256 bits of entropy. */
  randomToken(bytes = 32): string {
    return randomBytes(bytes).toString("base64url");
  }

  /** Numeric OTP via rejection-free CSPRNG — never Math.random. */
  numericOtp(digits = 6): string {
    const max = 10 ** digits;
    return String(randomInt(0, max)).padStart(digits, "0");
  }

  /** Human-friendly referral code. Excludes I/O/0/1 to avoid transcription errors. */
  referralCode(prefix = "MTT", length = 6): string {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let out = "";
    for (let i = 0; i < length; i++) out += alphabet[randomInt(0, alphabet.length)];
    return `${prefix}-${out}`;
  }

  /** Constant-time compare. Use for every secret comparison. */
  safeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) {
      // Still burn a comparison so length doesn't leak through timing.
      timingSafeEqual(ab, ab);
      return false;
    }
    return timingSafeEqual(ab, bb);
  }

  /** HMAC-SHA256 webhook signature, hex. Matches the Stripe/Razorpay convention. */
  webhookSignature(secret: string, payload: string): string {
    return createHmac("sha256", secret).update(payload).digest("hex");
  }

  verifyWebhookSignature(secret: string, payload: string, signature: string): boolean {
    return this.safeEqual(this.webhookSignature(secret, payload), signature.trim().toLowerCase());
  }
}
