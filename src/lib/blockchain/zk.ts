import { createHash, randomBytes } from "crypto";

export interface ZKCommitment {
  commitment: string;
  secret: string;
}

export function createZKCommitment(
  seller: string,
  price: number,
  capabilities: string
): ZKCommitment {
  const secret = randomBytes(32).toString("hex");
  const preimage = `${secret}|${seller}|${price}|${capabilities}`;
  const commitment = createHash("sha256").update(preimage).digest("hex");
  return { commitment, secret };
}

export function verifyZKCommitment(
  commitment: string,
  secret: string,
  seller: string,
  price: number,
  capabilities: string
): boolean {
  const preimage = `${secret}|${seller}|${price}|${capabilities}`;
  const recomputed = createHash("sha256").update(preimage).digest("hex");
  return recomputed === commitment;
}
