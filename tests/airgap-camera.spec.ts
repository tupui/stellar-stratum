/**
 * The air-gapped signer reading an animated QR through a camera, with the device offline. Chromium
 * plays a generated video as its webcam, so this file has its own browser launch options. Nothing
 * here reaches a network: the transaction is built locally for testnet.
 */
import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Account, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import QRCode from 'qrcode';
import { encodeEnvelope } from '../src/lib/airgap/payloads';
import { createFrameEncoder } from '../src/lib/airgap/ur';

// A webcam: Chromium plays this video of an animated QR as its camera, one QR
// frame every 250 ms as the app shows them. It is written when the file loads, before the browser starts.
const CAMERA_TX = (() => {
  const builder = new TransactionBuilder(new Account(Keypair.random().publicKey(), '1'), {
    fee: '1000',
    networkPassphrase: Networks.TESTNET,
  });
  for (let i = 0; i < 10; i++) builder.addOperation(Operation.bumpSequence({ bumpTo: String(i + 2) }));
  return builder.setTimeout(0).build();
})();
const CAMERA_VIDEO = join(tmpdir(), `stratum-animated-qr-${process.pid}.y4m`);
(() => {
  const SIDE = 480;
  const encoder = createFrameEncoder(encodeEnvelope(CAMERA_TX.toXDR(), 'testnet'), 200);
  const chunks: Buffer[] = [Buffer.from(`YUV4MPEG2 W${SIDE} H${SIDE} F20:1 Ip A1:1 C420jpeg\n`)];
  for (let n = 0; n < encoder.parts * 3; n++) {
    const { modules } = QRCode.create(encoder.next(), { errorCorrectionLevel: 'M' });
    const scale = Math.floor(SIDE / (modules.size + 8));
    const offset = Math.floor((SIDE - modules.size * scale) / 2);
    const luma = Buffer.alloc(SIDE * SIDE, 235);
    for (let row = 0; row < modules.size; row++) {
      for (let col = 0; col < modules.size; col++) {
        if (!modules.get(row, col)) continue;
        for (let y = 0; y < scale; y++) luma.fill(16, (offset + row * scale + y) * SIDE + offset + col * scale, (offset + row * scale + y) * SIDE + offset + (col + 1) * scale);
      }
    }
    const chroma = Buffer.alloc((SIDE / 2) * (SIDE / 2) * 2, 128);
    // 5 video frames at 20 fps: 250 ms per QR frame
    for (let k = 0; k < 5; k++) chunks.push(Buffer.from('FRAME\n'), luma, chroma);
  }
  writeFileSync(CAMERA_VIDEO, Buffer.concat(chunks));
})();

test.use({
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${CAMERA_VIDEO}`] },
  permissions: ['camera'],
});

test('air-gapped signer reads an animated QR with the camera, offline', async ({ page, context }) => {
  await page.addInitScript(() => localStorage.setItem('stellar-network', 'mainnet'));
  await page.goto('/sign');
  await expect(page.getByRole('button', { name: 'Start Scanning' })).toBeVisible();
  // Everything /sign needs is loaded with the page: it works with the device offline.
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Start Scanning' }).click();
  await expect(page.getByText('Signing for')).toContainText('Testnet', { timeout: 60_000 });
  await expect(page.getByText(Buffer.from(CAMERA_TX.hash()).toString('hex')).first()).toBeVisible();
});
