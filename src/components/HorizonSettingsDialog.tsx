import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Server, Trash2, RotateCcw, Loader2, Check, AlertTriangle } from 'lucide-react';
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
 * Gear button + dialog to choose which Horizon endpoints are used (and in what
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
    horizonSettings.addCustom(network, url);
    setNewUrl('');
    setProbe(null);
    toast({ title: 'Horizon endpoint added', description: `${hostOf(url)} · v${result.version} · ${result.latencyMs}ms`, duration: 3000 });
  };

  const handleCheck = async (url: string) => {
    setChecks((c) => ({ ...c, [url]: 'pending' }));
    const result = await probeHorizon(url, network);
    setChecks((c) => ({ ...c, [url]: result }));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className={className} title="Horizon endpoints">
          <Server className="w-4 h-4" />
          <span className="ml-2 hidden sm:inline">Endpoints</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Server className="w-4 h-4" />
            Horizon endpoints · {network === 'testnet' ? 'Testnet' : 'Mainnet'}
          </DialogTitle>
          <DialogDescription>
            Account data is read from the first enabled endpoint. Transaction submissions try each enabled endpoint in
            order and move on when one does not answer in time. Custom endpoints are tried first.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {endpoints.map((endpoint, index) => {
            const check = checks[endpoint.url];
            return (
              <div key={endpoint.url} className="flex items-center gap-3 rounded-lg border bg-secondary/40 px-3 py-2">
                <Switch
                  checked={endpoint.enabled}
                  onCheckedChange={(checked) => horizonSettings.setEnabled(network, endpoint.url, checked)}
                  aria-label={`Enable ${endpoint.url}`}
                />
                <div className="min-w-0 flex-1">
                  <p className={`font-mono text-xs sm:text-sm truncate ${endpoint.enabled ? '' : 'text-muted-foreground line-through'}`} title={endpoint.url}>
                    {hostOf(endpoint.url)}
                  </p>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    {endpoint.enabled && index === endpoints.findIndex((e) => e.enabled) && (
                      <Badge variant="outline" className="text-[10px] h-4 px-1">primary</Badge>
                    )}
                    {!endpoint.builtIn && <Badge variant="outline" className="text-[10px] h-4 px-1">custom</Badge>}
                    {check === 'pending' && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
                    {check && check !== 'pending' && (
                      <span className={`text-[11px] flex items-center gap-1 ${check.ok ? 'text-success' : 'text-destructive'}`}>
                        {check.ok ? <Check className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                        {check.ok ? `v${check.version} · ledger ${check.latestLedger} · ${check.latencyMs}ms` : check.error}
                      </span>
                    )}
                  </div>
                </div>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => handleCheck(endpoint.url)} disabled={check === 'pending'}>
                  Test
                </Button>
                {!endpoint.builtIn && (
                  <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => horizonSettings.removeCustom(network, endpoint.url)} title="Remove custom endpoint">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            );
          })}
          {enabledCount === 0 && (
            <p className="text-xs text-warning flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> No endpoint enabled: the built-in primary will be used.
            </p>
          )}
        </div>

        <div className="space-y-2 pt-2 border-t">
          <p className="text-sm font-medium">Add a custom Horizon</p>
          <div className="flex gap-2">
            <Input
              value={newUrl}
              onChange={(e) => { setNewUrl(e.target.value); setProbe(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleAdd(); }}
              placeholder="https://horizon.example.com"
              className="font-mono text-xs sm:text-sm"
              spellCheck={false}
            />
            <Button onClick={handleAdd} disabled={probing || !newUrl.trim()} className="shrink-0">
              {probing ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Add'}
            </Button>
          </div>
          {probe && !probe.ok && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> {probe.error}
            </p>
          )}
          <p className="text-[11px] text-muted-foreground">
            The URL is checked before it is added: it must answer as a Horizon for {network} and allow browser (CORS) requests.
          </p>
        </div>

        <div className="flex justify-end pt-1">
          <Button variant="ghost" size="sm" onClick={() => { horizonSettings.reset(network); setChecks({}); }} className="text-xs">
            <RotateCcw className="w-3.5 h-3.5 mr-1" /> Reset to defaults
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
