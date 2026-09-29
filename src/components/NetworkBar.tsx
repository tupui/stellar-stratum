import { Button } from '@/components/ui/button';
import { useNetwork } from '@/contexts/NetworkContext';

/**
 * The network every read, signature and submission goes to, always in view. Keys are the same
 * on both networks, so a "please sign this test transaction" link can point at Mainnet; when a
 * link switched the network, that is said until the user acknowledges it.
 */
export const NetworkBar = () => {
  const { network, switchedByLink, acknowledgeLinkSwitch } = useNetwork();
  const mainnet = network === 'mainnet';

  return (
    <div
      className={`border-b ${
        switchedByLink ? 'bg-warning/10 border-warning/40' : mainnet ? 'border-border' : 'bg-primary/5 border-primary/30'
      }`}
    >
      <div className="max-w-4xl mx-auto px-3 sm:px-6 py-1.5 flex items-center gap-3 text-xs sm:text-sm">
        <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${mainnet ? 'bg-success' : 'bg-primary'}`} aria-hidden />
        <span className="flex-1 min-w-0">
          {switchedByLink ? (
            <>
              The link you opened switched the app to <span className="font-semibold">{mainnet ? 'Mainnet' : 'Testnet'}</span>
              {mainnet ? ': transactions here move real funds.' : '.'}
            </>
          ) : (
            <>
              <span className="font-semibold">{mainnet ? 'Mainnet' : 'Testnet'}</span>
              <span className="text-muted-foreground">{mainnet ? ' · real funds' : ' · test funds only'}</span>
            </>
          )}
        </span>
        {switchedByLink && (
          <Button size="sm" variant="outline" className="h-7 shrink-0" onClick={acknowledgeLinkSwitch}>
            OK
          </Button>
        )}
      </div>
    </div>
  );
};
