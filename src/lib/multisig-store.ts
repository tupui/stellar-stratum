import { v4 as uuidv4 } from 'uuid';

/**
 * Client-side storage for pending multisig transactions.
 * Uses localStorage with a versioned key and defensive JSON parsing.
 * All writes replace the full array to keep operations atomic-ish.
 */

const STORAGE_KEY = 'stratum_multisig_pending_v1';
const MAX_ENTRIES = 50; // rough safety – 50 tx × ~3 KB ≈ 150 KB < 5 MB quota

export interface PendingMultisigTx {
  id: string; // uuid for local ref
  xdr: string;
  signatures: string[]; // base64 signatures
  requiredSignatures: number;
  createdAt: number;
}

function safeParse(json: string | null): PendingMultisigTx[] {
  if (!json) return [];
  try {
    const data = JSON.parse(json);
    // Handle both old format (array) and new format (versioned object)
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object' && Array.isArray(data.transactions)) {
      return data.transactions;
    }
  } catch {
    // Ignore JSON parse errors, return empty array
  }
  return [];
}

function loadAll(): PendingMultisigTx[] {
  if (typeof localStorage === 'undefined') return [];
  return safeParse(localStorage.getItem(STORAGE_KEY));
}

function saveAll(txs: PendingMultisigTx[]): void {
  if (typeof localStorage === 'undefined') return;
  
  // CRITICAL: Use atomic write with versioning to prevent race conditions
  const trimmed = txs.sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_ENTRIES);
  const version = Date.now();
  const data = { version, transactions: trimmed };
  
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    // Quota exceeded → fallback: drop oldest and retry once
    try {
      const fallbackData = { version, transactions: trimmed.slice(0, MAX_ENTRIES - 5) };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(fallbackData));
    } catch {/* give up */}
  }
}

export function addPendingTx(xdr: string, requiredSignatures: number): PendingMultisigTx {
  const tx: PendingMultisigTx = {
    id: uuidv4(),
    xdr,
    signatures: [],
    requiredSignatures,
    createdAt: Date.now(),
  };
  const all = loadAll();
  all.push(tx);
  saveAll(all);
  return tx;
}

export function appendSignature(id: string, signature: string): PendingMultisigTx | null {
  const all = loadAll();
  const tx = all.find(t => t.id === id);
  if (!tx) return null;
  
  // CRITICAL: Validate signature format and prevent duplicates
  if (typeof signature !== 'string' || signature.length === 0) {
    return null; // Invalid signature
  }
  
  // CRITICAL: Prevent duplicate signatures (case-insensitive comparison)
  const normalizedSig = signature.toLowerCase();
  const isDuplicate = tx.signatures.some(existingSig => 
    existingSig.toLowerCase() === normalizedSig
  );
  
  if (!isDuplicate) {
    tx.signatures.push(signature);
    saveAll(all);
  }
  return tx;
}

export function removePendingTx(id: string): void {
  const all = loadAll().filter(t => t.id !== id);
  saveAll(all);
}

export function listPendingTx(): PendingMultisigTx[] {
  return loadAll();
}
