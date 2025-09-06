/**
 * QR code chunking utilities for air-gapped coordination
 */

export interface QRChunk {
  id: string;
  part: number;
  total: number;
  data: string;
  type: 'xdr' | 'signature';
}

export interface SignatureData {
  signerKey: string;
  signature: string;
  signedAt: number;
}

// Max QR code capacity with good error correction (~1000-1500 chars)
const MAX_CHUNK_SIZE = 800;

/**
 * Split XDR or signature data into QR-friendly chunks
 */
export const createChunks = (
  data: string, 
  type: 'xdr' | 'signature',
  id?: string
): QRChunk[] => {
  const chunkId = id || generateChunkId();
  const chunks: QRChunk[] = [];
  
  let position = 0;
  let part = 1;
  
  while (position < data.length) {
    const chunkData = data.substring(position, position + MAX_CHUNK_SIZE);
    chunks.push({
      id: chunkId,
      part,
      total: Math.ceil(data.length / MAX_CHUNK_SIZE),
      data: chunkData,
      type
    });
    
    position += MAX_CHUNK_SIZE;
    part++;
  }
  
  return chunks;
};

/**
 * Reassemble chunks back into original data
 */
export const reassembleChunks = (chunks: QRChunk[]): { data: string; type: 'xdr' | 'signature'; complete: boolean } => {
  if (chunks.length === 0) {
    return { data: '', type: 'xdr', complete: false };
  }
  
  const firstChunk = chunks[0];
  const expectedTotal = firstChunk.total;
  const type = firstChunk.type;
  
  // Check if all parts are present
  const parts = new Map<number, string>();
  for (const chunk of chunks) {
    if (chunk.id !== firstChunk.id) continue; // Only chunks with same ID
    parts.set(chunk.part, chunk.data);
  }
  
  const complete = parts.size === expectedTotal;
  
  // Reassemble in order
  let data = '';
  for (let i = 1; i <= expectedTotal; i++) {
    const partData = parts.get(i);
    if (partData) {
      data += partData;
    } else if (!complete) {
      break; // Missing part, can't complete
    }
  }
  
  return { data, type, complete };
};

/**
 * Generate a unique ID for chunk tracking
 */
const generateChunkId = (): string => {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
};

/**
 * Encode chunk for QR display
 */
export const encodeChunk = (chunk: QRChunk): string => {
  return JSON.stringify(chunk);
};

/**
 * Decode chunk from QR scan
 */
export const decodeChunk = (qrData: string): QRChunk | null => {
  try {
    const chunk = JSON.parse(qrData) as QRChunk;
    
    // Validate required fields
    if (!chunk.id || !chunk.data || !chunk.type || 
        typeof chunk.part !== 'number' || typeof chunk.total !== 'number') {
      return null;
    }
    
    return chunk;
  } catch (error) {
    console.error('Failed to decode chunk:', error);
    return null;
  }
};

/**
 * Create signature payload for QR sharing
 */
export const createSignaturePayload = (
  signerKey: string,
  signedXdr: string
): SignatureData => {
  return {
    signerKey,
    signature: signedXdr, // This would be the signed XDR envelope
    signedAt: Date.now()
  };
};