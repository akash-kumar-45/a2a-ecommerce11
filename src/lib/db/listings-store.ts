/**
 * listings-store.ts
 * Simple file-based JSON store for service listings.
 * Data lives in .listings-db.json at project root.
 */

import fs from "fs";
import path from "path";

export interface Listing {
  id: string;
  service: string;
  type: string;
  price: number;
  description: string;
  seller: string;   // Ethereum address
  username?: string;
  password?: string;
  notes?: string;
  signature?: string;
  zkCommitment?: string;
  timestamp: number;
  createdAt: string;
}

const DB_FILE = path.join(process.cwd(), ".listings-db.json");

function readDb(): Listing[] {
  try {
    if (!fs.existsSync(DB_FILE)) return [];
    const raw = fs.readFileSync(DB_FILE, "utf-8");
    return JSON.parse(raw) as Listing[];
  } catch {
    return [];
  }
}

function writeDb(listings: Listing[]): void {
  fs.writeFileSync(DB_FILE, JSON.stringify(listings, null, 2), "utf-8");
}

export function getAllListings(filters?: {
  type?: string;
  maxPrice?: number;
  seller?: string;
}): Omit<Listing, "username" | "password">[] {
  let listings = readDb();

  if (filters?.type) {
    listings = listings.filter((l) => l.type === filters.type);
  }
  if (filters?.maxPrice !== undefined) {
    listings = listings.filter((l) => l.price <= filters.maxPrice!);
  }
  if (filters?.seller) {
    listings = listings.filter(
      (l) => l.seller.toLowerCase() === filters.seller!.toLowerCase()
    );
  }

  // Return newest first, strip sensitive credentials from public response
  return listings
    .sort((a, b) => b.timestamp - a.timestamp)
    .map(({ username: _u, password: _p, ...safe }) => safe);
}

export function createListing(data: Omit<Listing, "id" | "createdAt">): Listing {
  const listings = readDb();
  const listing: Listing = {
    ...data,
    id: `lst_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };
  listings.push(listing);
  writeDb(listings);
  return listing;
}

export function getListingById(id: string): Listing | null {
  const listings = readDb();
  return listings.find((l) => l.id === id) ?? null;
}

export function deleteListingById(id: string): boolean {
  const listings = readDb();
  const next = listings.filter((l) => l.id !== id);
  if (next.length === listings.length) return false;
  writeDb(next);
  return true;
}
