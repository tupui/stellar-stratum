import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Wifi, WifiOff, Send } from 'lucide-react';
import { SubmissionTerminal } from './SubmissionTerminal';
import { submitLog, useSubmitLog } from '@/lib/submitLog';

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
  const submitEntries = useSubmitLog();
  const showTerminal = !offlineOnly && (isSubmittingToNetwork || submitEntries.length > 0);
  const networkName = network === 'mainnet' ? 'Mainnet' : 'Testnet';

  if (!xdr) {
    // Nothing to sign or send; keep the last submission log visible so it can be read
    if (!showTerminal) return null;
    return <SubmissionTerminal active={isSubmittingToNetwork} network={network} onClose={submitLog.clear} />;
  }

  if (offlineOnly) {
    return (
      <Button className="w-full" size="lg" onClick={onShowOfflineModal}>
        <Send className="w-4 h-4 mr-2" />
        Air-gap sync
      </Button>
    );
  }

  if (ready) {
    return (
      <div className="space-y-6">
        {/* While transmitting, the button turns into a live terminal; afterwards the log stays below it */}
        {!isSubmittingToNetwork && (
          <Button onClick={onSubmitToNetwork} className="w-full" size="lg">
            <Send className="w-4 h-4 mr-2" />
            {`Send Transaction to ${networkName}`}
          </Button>
        )}
        {showTerminal && <SubmissionTerminal active={isSubmittingToNetwork} network={network} onClose={submitLog.clear} />}
      </div>
    );
  }

  // Not enough signatures yet: hand the transaction to the other signers
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base sm:text-lg">Coordination Mode</CardTitle>
          <CardDescription>Choose how to coordinate transaction signatures</CardDescription>
        </CardHeader>
        <CardContent>
          <ToggleGroup
            type="single"
            value={isAirgappedMode ? 'offline' : 'online'}
            onValueChange={(value) => setIsAirgappedMode(value === 'offline')}
            className="grid w-full grid-cols-2"
          >
            <ToggleGroupItem value="online" className="flex items-center gap-2">
              <Wifi className="w-4 h-4" />
              Refractor (Online)
            </ToggleGroupItem>
            <ToggleGroupItem value="offline" className="flex items-center gap-2">
              <WifiOff className="w-4 h-4" />
              Air-gapped (Offline)
            </ToggleGroupItem>
          </ToggleGroup>
        </CardContent>
      </Card>

      <Button
        className="w-full"
        size="lg"
        onClick={isAirgappedMode ? onShowOfflineModal : onSubmitToRefractor}
        disabled={isSubmittingToRefractor}
      >
        <Send className="w-4 h-4 mr-2" />
        {isSubmittingToRefractor ? 'Sending...' : isAirgappedMode ? 'Air-gap sync' : 'Send for Signature'}
      </Button>
      {showTerminal && <SubmissionTerminal active={isSubmittingToNetwork} network={network} onClose={submitLog.clear} />}
    </div>
  );
};
