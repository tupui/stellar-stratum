import { useMemo } from 'react';
import { ChevronDown, KeyRound, PenLine, TriangleAlert } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import {
  accountMovements,
  authNodes,
  sameAccount,
  type AuthEntry,
  type AuthNode,
  type DeployInfo,
  type TokenMovement,
} from '@/lib/protocols/auth';
import type { AnalyzedCall } from '@/lib/protocols/detect';
import { findKnownContract, PROTOCOL_LABELS, type NetworkId } from '@/lib/protocols/registry';
import { shortenAddress } from '@/lib/protocols/tokens';
import { useProtocolMetadata, type ProtocolMetadata } from '@/hooks/useProtocolMetadata';

export const Address = ({ value }: { value: string }) => (
  <span className="font-mono text-xs break-all">{shortenAddress(value, 8, 8)}</span>
);

/** Human-readable value for one decoded contract argument. */
export const ArgValue = ({ value }: { value: unknown }) => {
  if (value === undefined) return <span className="text-muted-foreground italic">not decodable</span>;
  if (typeof value === 'boolean') return <span>{value ? 'yes' : 'no'}</span>;
  if (typeof value === 'number') return <span className="tabular-nums">{value}</span>;
  if (typeof value === 'string') {
    if (/^([GC][A-Z2-7]{55}|M[A-Z2-7]{68})$/.test(value)) return <Address value={value} />;
    if (/^-?\d+$/.test(value)) return <span className="tabular-nums">{value}</span>;
    return <span className="break-all">{value}</span>;
  }
  if (Array.isArray(value)) {
    return (
      <span className="flex flex-col gap-0.5">
        {value.map((item, i) => (
          <ArgValue key={i} value={item} />
        ))}
      </span>
    );
  }
  return <span className="font-mono text-xs break-all">{JSON.stringify(value)}</span>;
};

/** A token amount: in the token's decimals when known, else the raw contract integer. */
const Quantity = ({ raw, token, meta }: { raw: string; token: string; meta: ProtocolMetadata }) => {
  const info = meta.token(token);
  if (info) {
    return (
      <span>
        <span className="font-semibold tabular-nums">{meta.amount(raw, token)}</span> {info.code}
      </span>
    );
  }
  return (
    <span>
      <span className="font-semibold tabular-nums break-all">{raw}</span>{' '}
      <span className="text-muted-foreground">raw units of</span> <Address value={token} />
    </span>
  );
};

const Party = ({ address, source }: { address?: string; source?: string }) => {
  if (!address) return <span className="italic">an unreadable address</span>;
  if (source && sameAccount(address, source)) return <strong>your account</strong>;
  return <Address value={address} />;
};

const Movement = ({ movement, meta, source }: { movement: TokenMovement; meta: ProtocolMetadata; source?: string }) => {
  const amount = <Quantity raw={movement.amount} token={movement.token} meta={meta} />;
  const from = <Party address={movement.from} source={source} />;
  const to = <Party address={movement.to} source={source} />;
  const spender = <Party address={movement.spender} source={source} />;
  switch (movement.kind) {
    case 'transfer':
      return <>Sends {amount} from {from} to {to}</>;
    case 'transfer_from':
      return <>Sends {amount} from {from} to {to}, using the allowance of {spender}</>;
    case 'approve':
      return <>Lets {to} spend up to {amount} of {from}</>;
    case 'burn':
      return <>Burns {amount} from {from}</>;
    case 'burn_from':
      return <>Burns {amount} from {from}, using the allowance of {spender}</>;
  }
};

/** What code a deployment runs, in one line. */
const deployedCode = (deploy: DeployInfo): string => {
  if (deploy.kind === 'upload-wasm') return `Uploads WASM ${shortenAddress(deploy.wasmHash, 8, 8)}`;
  if (deploy.wasmHash) return `Runs WASM ${shortenAddress(deploy.wasmHash, 8, 8)}`;
  if (deploy.asset !== undefined) return `Wraps ${deploy.asset || 'an unreadable asset'} in a token contract`;
  if (deploy.externalRef) return `Runs the code ${shortenAddress(deploy.externalRef.owner, 6, 6)} publishes as "${deploy.externalRef.tag}"`;
  return 'Runs code the app cannot read';
};

const ContractLabel = ({ contractId, meta, network }: { contractId: string; meta: ProtocolMetadata; network: NetworkId }) => {
  if (!contractId) return <span className="italic text-muted-foreground">unreadable contract</span>;
  const known = findKnownContract(contractId, network);
  const name = meta.token(contractId)?.code ?? (known ? `${PROTOCOL_LABELS[known.protocol]} ${known.role}` : null);
  return (
    <span className="inline-flex items-baseline gap-1.5 flex-wrap min-w-0">
      {name && <span className="font-semibold">{name}</span>}
      <span className="font-mono text-xs text-muted-foreground break-all">{shortenAddress(contractId, 6, 6)}</span>
    </span>
  );
};

interface NodeProps {
  node: AuthNode;
  meta: ProtocolMetadata;
  network: NetworkId;
  source?: string;
  critical: boolean;
  /** The root is the operation's own call: its arguments are shown with the call already. */
  isCall?: boolean;
}

const NodeItem = ({ node, meta, network, source, critical, isCall = false }: NodeProps) => (
  <li className="space-y-1.5 min-w-0">
    <div
      className={cn(
        'rounded-md px-3 py-2 space-y-1.5 text-sm',
        node.movement || node.deploy
          ? critical || node.deploy
            ? 'bg-destructive/10 ring-1 ring-destructive/40'
            : 'bg-warning/10 ring-1 ring-warning/30'
          : 'bg-secondary/40',
      )}
    >
      <div className="flex items-baseline gap-x-2 gap-y-0.5 flex-wrap min-w-0">
        {node.deploy ? (
          <span className="font-semibold">Deploy contract</span>
        ) : (
          <ContractLabel contractId={node.contractId} meta={meta} network={network} />
        )}
        <code className="font-mono text-xs">{node.functionName}</code>
        {isCall && <span className="text-xs text-muted-foreground">this operation&apos;s call</span>}
      </div>
      {node.movement && (
        <p className={cn('flex items-start gap-1.5', critical ? 'text-destructive' : 'text-foreground')}>
          <TriangleAlert className={cn('w-3.5 h-3.5 mt-0.5 shrink-0', !critical && 'text-warning')} />
          <span className="min-w-0 break-words">
            <Movement movement={node.movement} meta={meta} source={source} />
          </span>
        </p>
      )}
      {node.deploy && (
        <p className="text-xs text-destructive break-words">
          {deployedCode(node.deploy)}
          {node.contractId && <> as <Address value={node.contractId} /></>}
        </p>
      )}
      {node.args.length > 0 && !isCall && (
        <dl className="grid gap-1 text-xs">
          {node.args.map((arg, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,7rem)_1fr] gap-2 items-start">
              <dt className="font-mono text-muted-foreground break-all">{arg.name}</dt>
              <dd className="min-w-0">
                <ArgValue value={arg.value} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
    {node.subInvocations.length > 0 && (
      <ul className="ml-2 pl-3 border-l border-border/60 space-y-1.5">
        {node.subInvocations.map((child, i) => (
          <NodeItem key={i} node={child} meta={meta} network={network} source={source} critical={critical} />
        ))}
      </ul>
    )}
  </li>
);

const EntryItem = ({ entry, ...rest }: { entry: AuthEntry } & Omit<NodeProps, 'node'>) => (
  <li className="space-y-1.5">
    <p className="text-xs text-muted-foreground flex items-start gap-1.5">
      {entry.credential === 'source' ? (
        <PenLine className="w-3.5 h-3.5 mt-px shrink-0" />
      ) : (
        <KeyRound className="w-3.5 h-3.5 mt-px shrink-0 text-warning" />
      )}
      <span className="min-w-0 break-words">
        {entry.credential === 'source' ? (
          <>
            Authorised by signing this transaction
            {rest.source && (
              <>
                , as <Address value={rest.source} />
              </>
            )}
            .
          </>
        ) : (
          <>
            Signed separately by <Party address={entry.address} source={rest.source} />
            {entry.expirationLedger ? `, valid until ledger ${entry.expirationLedger}` : ''}.
          </>
        )}
        {!entry.rootIsCall && (
          <span className="text-destructive font-medium"> Its first call is not the one this operation makes.</span>
        )}
      </span>
    </p>
    <ul>
      <NodeItem node={entry.root} isCall={entry.rootIsCall} {...rest} />
    </ul>
  </li>
);

/** A clear stop before signing. */
export const CriticalNotice = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 space-y-1.5">
    <p className="text-sm font-semibold text-destructive flex items-start gap-2">
      <TriangleAlert className="w-4 h-4 mt-px shrink-0" />
      {title}
    </p>
    <div className="text-xs text-foreground pl-6 space-y-1 break-words">{children}</div>
  </div>
);

/**
 * The warning a call's authorization deserves, if any: a protocol call that
 * authorises more than its summary, or an unrecognised contract that can move
 * the account's tokens.
 */
export const AuthorizationWarning = ({ call, meta }: { call: AnalyzedCall; meta: ProtocolMetadata }) => {
  if (call.match && call.authIssues.length) {
    return (
      <CriticalNotice title="Signing authorises more than this summary shows">
        <ul className="list-disc pl-4 space-y-0.5">
          {call.authIssues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
        <p>Do not sign unless you expect every call listed under Authorisations.</p>
      </CriticalNotice>
    );
  }

  const moves = accountMovements(call.auth, call.source);
  if (!call.match && moves.length) {
    return (
      <CriticalNotice title="This call can move your tokens">
        <ul className="list-disc pl-4 space-y-0.5">
          {moves.map(({ movement }, i) => (
            <li key={i}>
              <Movement movement={movement} meta={meta} source={call.source} />
            </li>
          ))}
        </ul>
        <p>The contract is not one the app recognises. Sign only if you expect each of these.</p>
      </CriticalNotice>
    );
  }
  return null;
};

interface AuthorizationTreeProps {
  call: AnalyzedCall;
  meta: ProtocolMetadata;
  network: NetworkId;
  /** Start expanded: something in the tree needs the signer's attention. */
  defaultOpen?: boolean;
}

/**
 * Every authorization entry of a call, as the tree of calls it allows. This is
 * what a signature on the transaction actually agrees to, token transfers made
 * deep inside other contracts included.
 */
export const AuthorizationTree = ({ call, meta, network, defaultOpen = false }: AuthorizationTreeProps) => {
  const { auth, source } = call;
  if (!auth.length) {
    return <p className="text-xs text-muted-foreground">No authorization entries attached.</p>;
  }

  const calls = authNodes(auth).length;
  const moves = accountMovements(auth, source).length;
  const critical = Boolean((call.match && call.authIssues.length) || (!call.match && moves));

  return (
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger className="group flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors text-left">
        <ChevronDown className="w-3.5 h-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
        <span>
          Authorisations: {calls} call{calls === 1 ? '' : 's'}
          {moves > 0 && (
            <span className={critical ? 'text-destructive font-medium' : 'text-warning font-medium'}>
              {' '}
              · {moves} moving your tokens
            </span>
          )}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3">
        <ul className="space-y-3">
          {auth.map((entry, i) => (
            <EntryItem key={i} entry={entry} meta={meta} network={network} source={source} critical={critical} />
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
};

/**
 * What signing a freshly simulated call authorises, for the contract-call
 * builder: the same tree and warnings the signing screen shows.
 */
export const InvocationAuthorization = ({ call, network }: { call: AnalyzedCall; network: NetworkId }) => {
  const calls = useMemo(() => [call], [call]);
  const meta = useProtocolMetadata(calls, network);
  return (
    <div className="rounded-md border p-3 space-y-3">
      <p className="text-xs text-muted-foreground">What signing this call authorises</p>
      <AuthorizationWarning call={call} meta={meta} />
      {call.auth.length ? (
        <AuthorizationTree call={call} meta={meta} network={network} defaultOpen />
      ) : (
        <p className="text-sm text-muted-foreground">Nothing: the call needs no authorization from your account.</p>
      )}
    </div>
  );
};
