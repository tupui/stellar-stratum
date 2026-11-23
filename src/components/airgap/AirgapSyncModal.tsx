import { useMemo, useState } from 'react';
import { ScanLine } from 'lucide-react';
import type { xdr } from '@stellar/stellar-sdk';
import { Button } from '@/components/ui/button';
import { GlassModal } from '@/components/GlassModal';
import { HashField } from '@/components/HashField';
import { QRScanner, type ScanRefusal } from '@/components/QRScanner';
import { AirgapQRCode } from './AirgapQRCode';
import { encodeEnvelope, encodeSignatureSet } from '@/lib/airgap/payloads';
import { planQr } from '@/lib/airgap/qr';
import { readUR } from '@/lib/airgap/read';
import { buildSEP7TxUri, isRefusal, parseTransactionPayload } from '@/lib/sep7';
import { signaturesBy } from '@/lib/signatures';
import { getTransactionHash, tryParseTransaction, type NetworkId } from '@/lib/xdr/parse';
import { shortAddress } from '@/lib/xdr/describe';

/** Signatures read back from the signing device, for the transaction with this hash. */
export interface ReturnedSignatures {
  hash: string;
  signatures: xdr.DecoratedSignature[];
}

type AirgapSyncModalProps = {
  xdr: string;
  network: NetworkId;
  onClose: () => void;
} & (
  | {
      /** The online device: show the transaction, then read the signatures back. */
      mode: 'request';
      /** Add the signatures; a refusal keeps the scanner open with the reason. */
      onSignatures: (returned: ReturnedSignatures) => ScanRefusal | void;
    }
  | {
      /** The air-gapped signer: send back what was signed here. */
      mode: 'response';
      /** Keys that signed on this device. */
      signedBy: string[];
    }
);

const NONE: string[] = [];

const SIGNATURES_FOR_ANOTHER_TX: ScanRefusal = {
  title: 'Not this transaction',
  description: 'This QR code holds signatures for another transaction or network.',
};

/** Air-gap Sync: QR codes between the online device and the air-gapped signer (/sign). */
export const AirgapSyncModal = (props: AirgapSyncModalProps) => {
  const { xdr: envelopeXdr, network, onClose } = props;
  const [scanning, setScanning] = useState(false);
  const [showFullTransaction, setShowFullTransaction] = useState(false);

  const signedBy = props.mode === 'response' ? props.signedBy : NONE;
  const parsed = useMemo(() => tryParseTransaction(envelopeXdr, network), [envelopeXdr, network]);
  const hash = parsed ? getTransactionHash(parsed.tx) : '';
  const returned = useMemo(() => (parsed ? signaturesBy(parsed.tx, signedBy) : []), [parsed, signedBy]);

  const transactionPlan = useMemo(
    () => planQr(encodeEnvelope(envelopeXdr, network), buildSEP7TxUri(envelopeXdr, network)),
    [envelopeXdr, network],
  );
  const signaturePlan = useMemo(
    () => (parsed && returned.length ? planQr(encodeSignatureSet({ hash: parsed.tx.hash(), signatures: returned })) : null),
    [parsed, returned],
  );

  if (!parsed) return null;

  /** What the signing device showed back: its signatures, or the whole signed envelope. */
  const handleScan = (text: string): ScanRefusal | void => {
    if (props.mode !== 'request') return;
    const ur = readUR(text);
    if (ur && !isRefusal(ur) && ur.kind === 'signatures') {
      const returnedHash = Buffer.from(ur.hash).toString('hex');
      if (returnedHash !== hash) return SIGNATURES_FOR_ANOTHER_TX;
      return props.onSignatures({ hash: returnedHash, signatures: ur.signatures });
    }
    const payload = parseTransactionPayload(text);
    if (isRefusal(payload)) return { title: 'QR code not used', description: payload.refused };
    if (!payload) {
      return { title: 'Unrecognized QR code', description: 'Expected the Signature QR of the air-gapped signer.' };
    }
    const signed = tryParseTransaction(payload.xdr, payload.network ?? network);
    if (!signed || getTransactionHash(signed.tx) !== hash) return SIGNATURES_FOR_ANOTHER_TX;
    return props.onSignatures({ hash, signatures: signed.tx.signatures });
  };

  // The scanner is a dialog of its own, under this one: show it alone, then come back.
  if (scanning) return <QRScanner isOpen onClose={() => setScanning(false)} onScan={handleScan} />;

  if (props.mode === 'response' && signaturePlan && !showFullTransaction) {
    return (
      <GlassModal
        title="Signature QR"
        description="Scan this QR code with the online device. It adds the signature to the transaction it has open."
        onClose={onClose}
      >
        <AirgapQRCode plan={signaturePlan} label="Signature QR code" />
        <div className="flex flex-wrap items-center justify-center gap-x-2 text-xs text-muted-foreground">
          <span>Signed by</span>
          {signedBy.map((key) => (
            <span key={key} className="font-address text-foreground">
              {shortAddress(key)}
            </span>
          ))}
        </div>
        <HashField label="Transaction Hash" value={hash} />
        <Button variant="outline" className="w-full" onClick={() => setShowFullTransaction(true)}>
          Show Full Transaction
        </Button>
        <p className="text-xs text-muted-foreground text-center">For an online device that no longer has the transaction open.</p>
      </GlassModal>
    );
  }

  const animated = transactionPlan.kind === 'animated';
  const description =
    props.mode === 'response'
      ? 'Scan this QR code on the online device, in Import.'
      : animated
        ? 'Scan this animated QR code with your air-gapped signing device. It repeats until the scan is complete.'
        : 'Scan this QR code with your air-gapped signing device';

  return (
    <GlassModal title={props.mode === 'response' ? 'Signed Transaction' : 'Send for Signature'} description={description} onClose={onClose}>
      <AirgapQRCode plan={transactionPlan} label="QR code of the transaction" />
      <HashField label="Transaction Hash" value={hash} />
      {props.mode === 'request' && (
        <Button variant="outline" className="w-full" onClick={() => setScanning(true)}>
          <ScanLine className="w-4 h-4 mr-2" />
          Scan Signature
        </Button>
      )}
      {props.mode === 'response' && signaturePlan && (
        <Button variant="outline" className="w-full" onClick={() => setShowFullTransaction(false)}>
          Show Signature QR
        </Button>
      )}
    </GlassModal>
  );
};
