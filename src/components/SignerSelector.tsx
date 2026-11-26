import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronDown, ChevronUp, PenLine } from 'lucide-react';
import { Notice, SignatureStrip, SignerCell } from '@/components/brand/Shell';
import { Spinner } from '@/components/brand/Mark';
import { useWalletKit } from '@/contexts/WalletKitContext';
import { THRESHOLD_LABELS } from '@/lib/xdr/interpret';
import type { SignatureRequirement, SignerInfo } from '@/lib/signatures';
import { shortAddress } from '@/lib/xdr/describe';
import { cn } from '@/lib/utils';

interface SignerSelectorProps {
  /** Signers of every account the transaction involves (weight > 0). */
  signers: SignerInfo[];
  requirements: SignatureRequirement[];
  currentAccountKey: string;
  onSignWithSigner: (signerKey: string, walletId: string) => Promise<void>;
  isSigning: boolean;
  /** Signers of another involved account are still being loaded. */
  loading?: boolean;
}

const SUBHEAD = 'sub border-t border-line px-4 pb-2 pt-3';

/** A signer: its cell, lit once it has signed, the key and its weight. */
const SignerRow = ({ signer, signed, current }: { signer: SignerInfo; signed: boolean; current: boolean }) => (
  <li className="flex items-center gap-3 border-t border-line px-4 py-3">
    <SignerCell signed={signed} />
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
      <span className="font-address text-[13px]">{shortAddress(signer.key)}</span>
      {current && <Badge>Current Account</Badge>}
    </div>
    <span className="shrink-0 text-[13px] text-muted-foreground">Weight {signer.weight}</span>
  </li>
);

/** The weight one account has gathered: the figure in pixels, the strip beside it. */
const WeightFigure = ({ req, multipleAccounts, count }: { req: SignatureRequirement; multipleAccounts: boolean; count?: string }) => {
  const signed = req.known && req.weight > 0;
  return (
    <div className="flex items-center gap-4" title={`${THRESHOLD_LABELS[req.level].name} threshold of ${req.account}`}>
      <span
        className={cn(
          'font-pix text-[56px] font-normal leading-[.9]',
          signed ? 'text-acid [text-shadow:0_0_18px_hsl(var(--acid)/.35)]' : 'text-foreground',
        )}
      >
        {req.known ? req.weight : '?'}
        <span className="text-muted-foreground [text-shadow:none]">/{req.known ? req.threshold : '?'}</span>
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-2 flex justify-between gap-2 text-[13px] text-muted-foreground">
          <span className="min-w-0 truncate">
            Weight
            {multipleAccounts && <span className="ml-2 font-address text-foreground">{shortAddress(req.account)}</span>}
          </span>
          {count && <span className="shrink-0">{count}</span>}
        </div>
        <SignatureStrip signed={req.known ? req.weight : 0} required={req.threshold} />
      </div>
    </div>
  );
};

export const SignerSelector = ({
  signers,
  requirements,
  currentAccountKey,
  onSignWithSigner,
  isSigning,
  loading = false,
}: SignerSelectorProps) => {
  const { wallets: allWallets } = useWalletKit();
  const wallets = allWallets.filter((w) => w.isAvailable);
  const [selectedSigner, setSelectedSigner] = useState<string>('');
  const [selectedWalletId, setSelectedWalletId] = useState<string>('');
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Only signatures that verify against this transaction count.
  const signedKeys = new Set(requirements.flatMap((r) => r.signedBy));
  const signedSigners = signers.filter((s) => signedKeys.has(s.key));
  const availableSigners = signers.filter((s) => !signedKeys.has(s.key) && s.key.startsWith('G'));
  const unknownAccounts = requirements.filter((r) => !r.known);
  const ready = !loading && requirements.length > 0 && requirements.every((r) => r.known && r.weight >= r.threshold);
  const multipleAccounts = requirements.length > 1;

  const handleSign = async () => {
    if (!selectedSigner || !selectedWalletId) return;
    await onSignWithSigner(selectedSigner, selectedWalletId);
    setSelectedSigner('');
    setSelectedWalletId('');
  };

  return (
    <div aria-labelledby="signature-management" className="sm:bg-ink-3 sm:pb-1">
      <div className="flex items-center gap-2 px-4 pt-2">
        <h3 id="signature-management" className="sub">
          Signature Management
        </h3>
        <button
          type="button"
          onClick={() => setIsCollapsed(!isCollapsed)}
          aria-label={isCollapsed ? 'Expand Signature Management' : 'Collapse Signature Management'}
          aria-expanded={!isCollapsed}
          className="ml-auto inline-grid size-11 shrink-0 place-items-center border border-line-2 text-foreground hover:border-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          {isCollapsed ? <ChevronDown className="h-5 w-5" /> : <ChevronUp className="h-5 w-5" />}
        </button>
      </div>
      <div className="flex flex-col gap-4 px-4 pb-4 pt-2">
        {requirements.map((req, i) => (
          <WeightFigure
            key={`${req.account}-${req.level}`}
            req={req}
            multipleAccounts={multipleAccounts}
            count={i === 0 ? `${signedSigners.length} of ${signers.length} signers` : undefined}
          />
        ))}
      </div>

      {!isCollapsed && (
        <>
          {(loading || unknownAccounts.length > 0) && (
            <div className="flex flex-col gap-2 px-4 pb-4">
              {loading && <p className="text-[13px] text-muted-foreground">Loading the signers of the accounts this transaction uses…</p>}
              {unknownAccounts.map((req) => (
                <Notice key={req.account} level="warning">
                  Could not load the signers of <span className="font-address">{shortAddress(req.account)}</span>, so its
                  signatures cannot be checked. Make sure the account exists on this network.
                </Notice>
              ))}
            </div>
          )}

          <h4 className={SUBHEAD}>Current Signatures</h4>
          <ul>
            {signedSigners.length === 0 ? (
              <li className="border-t border-line px-4 py-3 text-muted-foreground">No signatures yet</li>
            ) : (
              signedSigners.map((signer) => (
                <SignerRow key={signer.key} signer={signer} signed current={signer.key === currentAccountKey} />
              ))
            )}
          </ul>

          <h4 className={SUBHEAD}>Available Signers</h4>
          {availableSigners.length === 0 ? (
            <p className="px-4 pb-3 text-muted-foreground">{signers.length === 0 ? 'No signers to show' : 'All signers have signed'}</p>
          ) : (
            <>
              <div className="flex flex-col gap-2 px-4 pb-3">
                <Select value={selectedSigner} onValueChange={setSelectedSigner}>
                  <SelectTrigger aria-label="Signer">
                    <SelectValue placeholder="Select a signer to sign with" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableSigners.map((signer) => (
                      <SelectItem key={signer.key} value={signer.key}>
                        <span className="flex w-full items-center justify-between gap-4">
                          <span className="font-address text-[13px]">{shortAddress(signer.key)}</span>
                          {signer.key === currentAccountKey && <Badge>Current</Badge>}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div className="flex gap-2">
                  <Select value={selectedWalletId} onValueChange={setSelectedWalletId}>
                    <SelectTrigger aria-label="Wallet" className="min-w-0 flex-1">
                      <SelectValue placeholder="Select wallet to sign" />
                    </SelectTrigger>
                    <SelectContent>
                      {wallets.map((w) => (
                        <SelectItem key={w.id} value={w.id}>
                          {w.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Button
                    variant="outline"
                    onClick={handleSign}
                    disabled={!selectedSigner || !selectedWalletId || isSigning}
                    className="shrink-0"
                  >
                    {isSigning ? <Spinner /> : <PenLine />}
                    {isSigning ? 'Signing...' : 'Sign'}
                  </Button>
                </div>
              </div>

              <ul>
                {availableSigners.map((signer) => (
                  <SignerRow key={signer.key} signer={signer} signed={false} current={signer.key === currentAccountKey} />
                ))}
              </ul>
            </>
          )}

          {ready && (
            <Notice level="signed" className="m-4 items-center">
              Minimum signature weight reached. Transaction can be submitted.
            </Notice>
          )}
        </>
      )}
    </div>
  );
};
