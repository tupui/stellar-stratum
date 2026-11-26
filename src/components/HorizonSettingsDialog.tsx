import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Server, Trash2, RotateCcw, Check, AlertTriangle } from 'lucide-react';
import { Spinner } from '@/components/brand/Mark';
import { cn } from '@/lib/utils';
import { useNetwork } from '@/contexts/NetworkContext';
import { useToast } from '@/hooks/use-toast';
import { horizonSettings, probeHorizon, useHorizonEndpoints, type HorizonProbe } from '@/lib/horizonSettings';

const hostOf = (url: string) => {
  try {
    return new URL(url).host + new URL(url).pathname.replace(/\/$/, '');
  } catch {
    return url;
  }
};

/**
 * Endpoints button + sheet to choose which Horizon endpoints are used (and in what
 * order) for the current network. Custom endpoints are probed before being added.
 */
export const HorizonSettingsDialog = ({ className }: { className?: string }) => {
  const { network } = useNetwork();
  const { toast } = useToast();
  const endpoints = useHorizonEndpoints(network);
  const [open, setOpen] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<HorizonProbe | null>(null);
  const [checks, setChecks] = useState<Record<string, HorizonProbe | 'pending'>>({});

  const enabledCount = endpoints.filter((e) => e.enabled).length;

  const handleAdd = async () => {
    const url = newUrl.trim();
    if (!url) return;
    setProbing(true);
    setProbe(null);
    const result = await probeHorizon(url, network);
    setProbing(false);
    setProbe(result);
    if (!result.ok) return;
    const outcome = horizonSettings.addCustom(network, url);
    setNewUrl('');
    setProbe(null);
    const title = { added: 'Horizon endpoint added', enabled: 'Horizon endpoint re-enabled', unchanged: 'Horizon endpoint already in the list' }[outcome];
    toast({ title, description: `${hostOf(url)} · v${result.version} · ${result.latencyMs}ms`, duration: 3000 });
  };

  const handleCheck = async (url: string) => {
    setChecks((c) => ({ ...c, [url]: 'pending' }));
    const result = await probeHorizon(url, network);
    setChecks((c) => ({ ...c, [url]: result }));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className={cn('md:w-auto md:px-4', className)}
          title="Horizon endpoints"
          aria-label="Endpoints"
        >
          <Server className="!size-[18px] md:!size-4" />
          <span className="hidden md:inline">Endpoints</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Horizon Endpoints · {network === 'testnet' ? 'Testnet' : 'Mainnet'}</DialogTitle>
          <DialogDescription>
            Account data is read from the first enabled endpoint. Transaction submissions try each enabled endpoint in
            order and move on when one does not answer in time. Custom endpoints are tried first.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {endpoints.map((endpoint, index) => {
            const check = checks[endpoint.url];
            return (
              <div key={endpoint.url} className="well flex min-h-[68px] items-center gap-3">
                <Switch
                  checked={endpoint.enabled}
                  onCheckedChange={(checked) => horizonSettings.setEnabled(network, endpoint.url, checked)}
                  aria-label={`Enable ${endpoint.url}`}
                />
                <div className="min-w-0 flex-1">
                  <p className={cn('truncate font-mono text-xs', !endpoint.enabled && 'text-muted-foreground line-through')} title={endpoint.url}>
                    {hostOf(endpoint.url)}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {endpoint.enabled && index === endpoints.findIndex((e) => e.enabled) && (
                      <Badge>primary</Badge>
                    )}
                    {!endpoint.builtIn && <Badge>custom</Badge>}
                    {check === 'pending' && <Spinner size={12} />}
                    {check && check !== 'pending' && (
                      <span className={cn('flex items-center gap-1 text-xs', check.ok ? 'text-muted-foreground' : 'text-destructive')}>
                        {check.ok ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                        {check.ok ? `v${check.version} · ledger ${check.latestLedger} · ${check.latencyMs}ms` : check.error}
                      </span>
                    )}
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => handleCheck(endpoint.url)} disabled={check === 'pending'}>
                  Test
                </Button>
                {!endpoint.builtIn && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive"
                    onClick={() => horizonSettings.removeCustom(network, endpoint.url)}
                    title="Remove custom endpoint"
                    aria-label="Remove custom endpoint"
                  >
                    <Trash2 />
                  </Button>
                )}
              </div>
            );
          })}
          {enabledCount === 0 && (
            <p className="flex items-center gap-1 text-[13px] text-warning">
              <AlertTriangle className="h-4 w-4" /> No endpoint enabled: the built-in primary will be used.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <label htmlFor="custom-horizon" className="field-label">Add a custom Horizon</label>
          <div className="flex gap-2">
            <Input
              id="custom-horizon"
              value={newUrl}
              onChange={(e) => { setNewUrl(e.target.value); setProbe(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleAdd(); }}
              placeholder="https://horizon.example.com"
              className="font-mono text-[13px]"
              spellCheck={false}
            />
            <Button onClick={handleAdd} disabled={probing || !newUrl.trim()} className="shrink-0">
              {probing ? <Spinner mono /> : 'Add'}
            </Button>
          </div>
          {probe && !probe.ok && (
            <p className="flex items-center gap-1 text-[13px] text-destructive">
              <AlertTriangle className="h-4 w-4" /> {probe.error}
            </p>
          )}
          <p className="text-[13px] text-muted-foreground">
            The URL is checked before it is added: it must answer as a Horizon for {network} and allow browser (CORS) requests.
          </p>
        </div>

        <div className="flex justify-end">
          <Button variant="ghost" onClick={() => { horizonSettings.reset(network); setChecks({}); }}>
            <RotateCcw /> Reset to Defaults
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
