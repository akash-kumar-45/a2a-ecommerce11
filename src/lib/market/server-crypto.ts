import crypto from "crypto";

// Ensure APP_SECRET is ideally 32 bytes hex length (64 chars)
const getSecretKey = (): Buffer => {
  const secret = process.env.APP_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("CRITICAL: APP_SECRET is not defined in production.");
    }
    console.warn("⚠️ WARNING: APP_SECRET not defined. Using insecure fallback for development ONLY.");
    return crypto.scryptSync("development_insecure_fallback", "salt", 32);
  }
  
  if (secret.length === 64) {
    // Treat as hex
    return Buffer.from(secret, 'hex');
  }
  
  // Hash to exactly 32 bytes just in case it's a weird format
  return crypto.scryptSync(secret, "salt", 32);
};

const ALGORITHM = "aes-256-gcm";

/**
 * Encrypts a plaintext string (the AES key from the browser) for safe storage in the DB.
 * Returns a composite string: iv:authTag:encryptedData
 */
export function encryptForDatabase(plaintext: string): string {
  const key = getSecretKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  
  const authTag = cipher.getAuthTag().toString("hex");
  
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

/**
 * Decrypts a composite string (iv:authTag:encryptedData) back to plaintext.
 */
export function decryptFromDatabase(composite: string): string {
  const key = getSecretKey();
  const parts = composite.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted data format");
  }

  const [ivHex, authTagHex, encryptedDataHex] = parts;
  
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encryptedDataHex, "hex", "utf8");
  decrypted += decipher.final("utf8");
  
  return decrypted;
}
