import { useState, type ReactNode } from 'react';
import { ChevronDown, Copy, ExternalLink, Power, Server, Share2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { HorizonSettingsDialog } from './HorizonSettingsDialog';
import { useIsMobile } from '@/hooks/use-mobile';
import { useToast } from '@/hooks/use-toast';
import { buildAccountUrl } from '@/lib/urlState';
import { shortAddress } from '@/lib/xdr/describe';
import { cn } from '@/lib/utils';

interface AccountMenuProps {
  publicKey: string;
  network: 'mainnet' | 'testnet';
  onDisconnect: () => void;
}

const row =
  'flex min-h-12 w-full items-center gap-3 border-t border-line px-4 text-left text-[15px] text-foreground no-underline hover:bg-ink-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring [&_svg]:size-[18px] [&_svg]:shrink-0 [&_svg]:text-muted-foreground';

/**
 * The connected account in the header: a pill with its short key. It opens the account's actions,
 * Disconnect last: a menu under the pill from md up, a sheet from the bottom on the phone.
 */
export const AccountMenu = ({ publicKey, network, onDisconnect }: AccountMenuProps) => {
  const [open, setOpen] = useState(false);
  const [endpointsOpen, setEndpointsOpen] = useState(false);
  const isMobile = useIsMobile();
  const { toast } = useToast();

  const act = (run: () => void) => () => {
    setOpen(false);
    run();
  };

  const items: ReactNode = (
    <>
      <div className="px-4 py-3.5">
        <span className="field-label">Public key</span>
        <p className="mt-1.5 font-address text-[12.5px] leading-[1.55] break-all">{publicKey}</p>
      </div>
      <button
        type="button"
        className={row}
        onClick={act(() => navigator.clipboard.writeText(publicKey))}
      >
        <Copy aria-hidden="true" />
        Copy public key
      </button>
      <button
        type="button"
        className={row}
        onClick={act(() => {
          // A link that reopens this account directly (?public_key=G...), skipping manual entry
          navigator.clipboard.writeText(buildAccountUrl(publicKey, network));
          toast({
            title: 'Account link copied',
            description: `Opening it loads ${shortAddress(publicKey)} directly`,
            duration: 3000,
          });
        })}
      >
        <Share2 aria-hidden="true" />
        Share
      </button>
      <a
        className={row}
        href={`https://stellar.expert/explorer/${network === 'testnet' ? 'testnet' : 'public'}/account/${publicKey}`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => setOpen(false)}
      >
        <ExternalLink aria-hidden="true" />
        Open in explorer
      </a>
      <button type="button" className={row} onClick={act(() => setEndpointsOpen(true))}>
        <Server aria-hidden="true" />
        Horizon endpoints
      </button>
      <button type="button" className={row} onClick={act(onDisconnect)}>
        <Power aria-hidden="true" />
        Disconnect
      </button>
    </>
  );

  const pill = (
    <button
      type="button"
      aria-expanded={open}
      onClick={isMobile ? () => setOpen(true) : undefined}
      className="inline-flex h-11 items-center gap-2.5 whitespace-nowrap md:h-12 border border-line-2 bg-ink-2 pl-3 pr-2.5 font-address text-[13px] text-foreground hover:border-foreground focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span aria-hidden="true" className="size-2 shrink-0 bg-foreground" />
      <span className="sr-only">Account </span>
      {/* The 8…8 form does not fit below 360 px beside the logo, nor from md to lg beside the tabs */}
      <span className="max-[359px]:hidden md:max-lg:hidden">{shortAddress(publicKey)}</span>
      <span className="hidden max-[359px]:inline md:max-lg:inline">{shortAddress(publicKey, 4)}</span>
      <ChevronDown aria-hidden="true" className={cn('size-4 text-muted-foreground', open && 'rotate-180')} />
    </button>
  );

  return (
    <>
      {isMobile ? (
        <>
          {pill}
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent className="gap-0 px-0 pb-[calc(12px+env(safe-area-inset-bottom))] pt-5 [&>button:last-child]:hidden">
              <DialogTitle className="sr-only">Account</DialogTitle>
              {items}
            </DialogContent>
          </Dialog>
        </>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>{pill}</PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={10}
            aria-label="Account"
            className="w-[340px] border-line-2 bg-ink-2 p-0 shadow-[8px_8px_0_#000]"
          >
            {items}
          </PopoverContent>
        </Popover>
      )}
      <HorizonSettingsDialog open={endpointsOpen} onOpenChange={setEndpointsOpen} />
    </>
  );
};
