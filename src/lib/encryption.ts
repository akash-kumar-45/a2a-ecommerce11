import crypto from "crypto";

// Ensure APP_SECRET exists and is 32 bytes (64 hex chars)
const SECRET_KEY = process.env.APP_SECRET || "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
const ALGORITHM = "aes-256-cbc";

export function encryptString(text: string): string {
  if (!text) return text;
  
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(
    ALGORITHM,
    Buffer.from(SECRET_KEY.slice(0, 64), "hex"),
    iv
  );

  let encrypted = cipher.update(text, "utf-8", "hex");
  encrypted += cipher.final("hex");

  // Format: iv:encrypted
  return `${iv.toString("hex")}:${encrypted}`;
}

export function decryptString(encryptedText: string): string {
  if (!encryptedText) return encryptedText;

  const parts = encryptedText.split(":");
  if (parts.length !== 2) return encryptedText; // Not encrypted or badly formatted

  const iv = Buffer.from(parts[0], "hex");
  const encrypted = parts[1];

  try {
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      Buffer.from(SECRET_KEY.slice(0, 64), "hex"),
      iv
    );

    let decrypted = decipher.update(encrypted, "hex", "utf-8");
    decrypted += decipher.final("utf-8");
    return decrypted;
  } catch (error) {
    console.error("Decryption failed:", error);
    return encryptedText; // Return original on failure
  }
}
