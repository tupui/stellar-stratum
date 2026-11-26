import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { QrCode, Send, Wifi, WifiOff } from 'lucide-react';
import { Dock } from '@/components/brand/Shell';
import { Spinner } from '@/components/brand/Mark';

interface TransactionSubmitterProps {
  xdr: string;
  network: 'mainnet' | 'testnet';
  /** Every involved account has enough verified signature weight. */
  ready: boolean;
  isSubmittingToNetwork: boolean;
  isSubmittingToRefractor: boolean;
  onSubmitToNetwork: () => Promise<void>;
  onSubmitToRefractor: () => Promise<void>;
  onShowOfflineModal: () => void;
  /** Air-gapped signer: no network, only hand the signed transaction back by QR. */
  offlineOnly?: boolean;
}

/**
 * The primary: from sm up a full-width button under the panels; on the phone in the bottom bar.
 * The bar is drawn at the end of the page so it sticks to the bottom of the screen from the top of
 * the page, whatever box the panels sit in. Only one of the two is ever displayed.
 */
const PrimaryDock = ({ children }: { children: ReactNode }) => (
  <>
    <Dock className="hidden sm:flex sm:justify-stretch sm:pt-0 sm:[&>*]:flex-1">{children}</Dock>
    {createPortal(<Dock className="sm:hidden">{children}</Dock>, document.body)}
  </>
);

export const TransactionSubmitter = ({
  xdr,
  network,
  ready,
  isSubmittingToNetwork,
  isSubmittingToRefractor,
  onSubmitToNetwork,
  onSubmitToRefractor,
  onShowOfflineModal,
  offlineOnly = false,
}: TransactionSubmitterProps) => {
  const [isAirgappedMode, setIsAirgappedMode] = useState(false);
  const networkName = network === 'mainnet' ? 'Mainnet' : 'Testnet';

  // Nothing to sign or send. (The submission and its log are followed in the SendSheet.)
  if (!xdr) return null;

  if (offlineOnly) {
    return (
      <Button variant="outline" className="w-full" onClick={onShowOfflineModal}>
        <QrCode />
        Air-gap Sync
      </Button>
    );
  }

  if (ready) {
    return (
      <PrimaryDock>
        <Button onClick={onSubmitToNetwork} disabled={isSubmittingToNetwork}>
          {isSubmittingToNetwork ? <Spinner mono /> : <Send />}
          {`Send Transaction to ${networkName}`}
        </Button>
      </PrimaryDock>
    );
  }

  // Not enough signatures yet: hand the transaction to the other signers
  return (
    <>
      <section
        aria-labelledby="coordination-title"
        className="flex flex-col gap-4 border-t border-line p-4 sm:border sm:bg-ink-2"
      >
        <div>
          <h2 id="coordination-title" className="sec">
            Coordination Mode
          </h2>
          <p className="mt-2 text-muted-foreground">Choose how to coordinate transaction signatures</p>
        </div>
        <Tabs value={isAirgappedMode ? 'offline' : 'online'} onValueChange={(value) => setIsAirgappedMode(value === 'offline')}>
          <TabsList aria-label="Coordination Mode">
            <TabsTrigger value="online" className="min-w-0 px-2">
              <Wifi />
              Refractor (Online)
            </TabsTrigger>
            <TabsTrigger value="offline" className="min-w-0 px-2">
              <WifiOff />
              Air-gapped (Offline)
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </section>

      <PrimaryDock>
        <Button onClick={isAirgappedMode ? onShowOfflineModal : onSubmitToRefractor} disabled={isSubmittingToRefractor}>
          {isSubmittingToRefractor ? <Spinner mono /> : isAirgappedMode ? <QrCode /> : <Send />}
          {isSubmittingToRefractor ? 'Sending...' : isAirgappedMode ? 'Air-gap Sync' : 'Send for Signature'}
        </Button>
      </PrimaryDock>
    </>
  );
};
