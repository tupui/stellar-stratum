import { cn } from '@/lib/utils';
import { useState, Suspense, lazy, memo, useCallback, useEffect, useRef } from "react";
import { LandingPage } from "@/components/LandingPage";
import { Footer } from "@/components/Footer";
import { DeepLinkHandler } from "@/components/DeepLinkHandler";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Spinner } from "@/components/brand/Mark";
import { AppHeader, Wrap } from "@/components/brand/Shell";
import { shortAddress } from "@/lib/xdr/describe";

// Lazy load heavy components to improve TTI
const AccountOverview = lazy(() => import("@/components/AccountOverview"));
const TransactionBuilder = lazy(() =>
  import("@/components/TransactionBuilder").then((module) => ({
    default: module.TransactionBuilder,
  })),
);
import { fetchAccountData, type AccountData } from "@/lib/stellar";
import { WATCHABLE_WALLETS } from "@/lib/walletKit";
import type { NetworkId } from "@/lib/xdr/parse";
import { StrKey } from "@stellar/stellar-sdk";
import { accountIdOf } from "@/lib/validation";
import { useToast } from "@/hooks/use-toast";
import { FiatCurrencyProvider } from "@/contexts/FiatCurrencyContext";
import { useNetwork } from "@/contexts/NetworkContext";
import { useWalletKit } from "@/contexts/WalletKitContext";
import { useRequestDeduplication } from "@/hooks/useRequestDeduplication";
import { updateUrlParams } from "@/lib/urlState";

type AppState = "connecting" | "dashboard" | "transaction";

const TRANSACTION_TABS = ["payment", "contract", "defi", "import"];

const clearDeepLinkStorage = () => {
  sessionStorage.removeItem("deeplink-xdr");
  sessionStorage.removeItem("deeplink-refractor-id");
  sessionStorage.removeItem("deeplink-source-account");
};

const Index = memo(() => {
  const { toast } = useToast();
  const { network, setNetwork } = useNetwork();
  const { disconnectWallet, connectedWallet: kitConnectedWallet, fetchActiveAddress } = useWalletKit();
  const { dedupe } = useRequestDeduplication();

  const [appState, setAppState] = useState<AppState>("connecting");
  const [accountData, setAccountData] = useState<AccountData | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [publicKey, setPublicKey] = useState<string>(""); // Connected wallet's public key (signer)
  const [sourceAccount, setSourceAccount] = useState<string>(""); // Source account for transactions (editable)
  const [deepLinkReady, setDeepLinkReady] = useState(false);
  const [liveWalletAddress, setLiveWalletAddress] = useState<string | null>(null);
  const addressDeepLinkHandled = useRef(false);
  const hasConnected = useRef(false);
  const prevAppState = useRef<AppState>("connecting");
  // Section requested by the URL (?view=transaction&tab=...). Applied once account data has
  // loaded, since the transaction builder's forms need balances/signers to render.
  const viewFromUrl = useRef<"transaction" | null>(null);
  const initialTransactionTab = useRef<string | null>(null);

  // Deep links are processed by DeepLinkHandler; we do not auto-switch app state here to ensure account loads first.

  // A Refractor deep link was pulled: load its source account on the transaction's network.
  const handleDeepLinkLoaded = useCallback(
    async (xdrSourceAccount: string, deepLinkNetwork: NetworkId) => {
      setSourceAccount(xdrSourceAccount);
      setPublicKey(xdrSourceAccount); // Set as initial signer if no wallet connected
      setLoading(true);

      try {
        const realAccountData = await dedupe(`account-${xdrSourceAccount}-${deepLinkNetwork}`, () =>
          fetchAccountData(xdrSourceAccount, deepLinkNetwork),
        );
        setAccountData(realAccountData);
        setDeepLinkReady(true);
        setAppState("transaction");

        toast({
          title: "Account Loaded",
          description: "Ready to review and sign transaction",
          duration: 3000,
        });
      } catch (error) {
        if (import.meta.env.DEV) console.error("Failed to load source account:", error);
        toast({
          title: "Failed to load source account",
          description: error instanceof Error ? error.message : "Could not load account data",
          variant: "destructive",
        });
        clearDeepLinkStorage();
        setAppState("connecting");
      } finally {
        setLoading(false);
      }
    },
    [dedupe, toast],
  );

  const handleWalletConnect = useCallback(
    async (walletPublicKey: string, selectedNetwork: NetworkId) => {
      setPublicKey(walletPublicKey);
      setNetwork(selectedNetwork);
      setLoading(true);

      // Scroll to top when transitioning from landing page
      window.scrollTo({ top: 0, behavior: "instant" });

      // A pending deep link (pulled before the wallet was connected) decides which account the
      // transaction view works on. Read it once: the builder clears these keys when it mounts.
      const deepLinkXdr = sessionStorage.getItem("deeplink-xdr");
      const storedSource = sessionStorage.getItem("deeplink-source-account");
      const deepLinkSource = deepLinkXdr && storedSource && StrKey.isValidEd25519PublicKey(storedSource) ? storedSource : null;
      const accountToFetch = deepLinkSource ?? walletPublicKey;
      setSourceAccount(accountToFetch);
      if (deepLinkXdr) {
        setDeepLinkReady(true);
        setAppState("transaction");
      } else {
        setDeepLinkReady(false);
        setAppState("dashboard");
      }

      setAccountError(null);

      // Defer account data fetching to not block TTI
      setTimeout(async () => {
        try {
          const realAccountData = await dedupe(`account-${accountToFetch}-${selectedNetwork}`, () =>
            fetchAccountData(accountToFetch, selectedNetwork),
          );
          setAccountData(realAccountData);
          setLoading(false);
          if (viewFromUrl.current) {
            setAppState(viewFromUrl.current);
            viewFromUrl.current = null;
          }
        } catch (error) {
          if (import.meta.env.DEV) console.error("Failed to load account:", error);
          // Keep the user on the account page and surface the error inline with a retry option,
          // instead of bouncing back to the landing page where they cannot retry.
          setAccountError(error instanceof Error ? error.message : "Could not load account data");
          setLoading(false);
        }
      }, 100); // Small delay to allow UI transition first
    },
    [setNetwork, dedupe],
  );

  // Watch-only deep link: ?address=G...&network=mainnet|testnet (?public_key= accepted as alias)
  useEffect(() => {
    if (addressDeepLinkHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("address") ?? params.get("public_key");
    if (!requested) return;
    addressDeepLinkHandled.current = true;

    // A muxed (M…) address opens the account behind it.
    const address = accountIdOf(requested);
    if (!address) {
      toast({
        title: "Invalid address",
        description: "The address in the URL is not a valid Stellar account address.",
        variant: "destructive",
      });
      return;
    }

    // If a Refractor deep-link is also present, let DeepLinkHandler take precedence.
    if (params.get("r")) return;

    const netParam = params.get("network");
    const selectedNetwork: "mainnet" | "testnet" =
      netParam === "testnet" ? "testnet" : netParam === "mainnet" ? "mainnet" : network;

    handleWalletConnect(address, selectedNetwork);

    // Restore the section the link points at (defaults to the dashboard)
    const view = params.get("view");
    const tab = params.get("tab");
    if (view === "transaction") {
      if (tab && TRANSACTION_TABS.includes(tab)) initialTransactionTab.current = tab;
      viewFromUrl.current = view;
    } else if (view === "multisig-config") {
      // Older links: multisig configuration now lives in the dashboard's Multisig tab.
      updateUrlParams({ view: null, tab: "multisig" });
    }
  }, [network, toast]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the address bar in sync with the current account, network and section so the
  // URL can be refreshed or shared at any point. Cleared again on disconnect.
  useEffect(() => {
    if (appState === "connecting") {
      // Skip on first mount so a pasted deep link isn't wiped before it's processed.
      if (hasConnected.current) {
        updateUrlParams({ public_key: null, address: null, network: null, view: null, tab: null, r: null });
      }
      return;
    }
    hasConnected.current = true;
    // Tabs are owned by the view components; drop the old one when switching views.
    const leavingView = prevAppState.current !== "connecting" && prevAppState.current !== appState;
    prevAppState.current = appState;
    const account = sourceAccount || publicKey;
    if (!account) return;
    updateUrlParams({
      public_key: account,
      address: null, // legacy alias, normalised to public_key
      network,
      view: appState === "dashboard" ? null : appState,
      ...(leavingView ? { tab: null } : {}),
    });
  }, [appState, sourceAccount, publicKey, network]);

  // Detect when the user switches the active account in their wallet (e.g. Varial)
  // after connecting. Only wallets that report their address without a prompt are polled.
  useEffect(() => {
    if (!kitConnectedWallet || !publicKey) {
      setLiveWalletAddress(null);
      return;
    }
    if (!WATCHABLE_WALLETS.includes(kitConnectedWallet.id.toLowerCase())) return;

    let stopped = false;
    const check = async () => {
      const live = await fetchActiveAddress();
      if (!stopped && live) setLiveWalletAddress(live);
    };
    check();
    const interval = setInterval(check, 3000);
    return () => { stopped = true; clearInterval(interval); };
  }, [kitConnectedWallet, publicKey, fetchActiveAddress]);

  // The wallet's active account no longer matches the account we connected with.
  const walletAccountChanged = Boolean(
    kitConnectedWallet && liveWalletAddress && publicKey && liveWalletAddress !== publicKey
  );

  const handleDisconnect = useCallback(() => {
    disconnectWallet();
    clearDeepLinkStorage();
    viewFromUrl.current = null;
    initialTransactionTab.current = null;
    setPublicKey("");
    setSourceAccount("");
    setAccountData(null);
    setAccountError(null);
    setLiveWalletAddress(null);
    setDeepLinkReady(false);
    setAppState("connecting");
  }, [disconnectWallet]);

  // Memoize frequently used callbacks
  const handleInitiateTransaction = useCallback(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    setAppState("transaction");
  }, []);

  // Memoized account refresh function - uses sourceAccount for transactions. It always asks
  // Horizon again: a refresh must never be answered from a recently settled request.
  const handleAccountRefresh = useCallback(async () => {
    const accountToRefresh = sourceAccount || publicKey;
    if (!accountToRefresh) return;
    const realAccountData = await fetchAccountData(accountToRefresh, network);
    setAccountData(realAccountData);
  }, [sourceAccount, publicKey, network]);

  const handleBackToDashboard = useCallback(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    setDeepLinkReady(false);
    initialTransactionTab.current = null;
    updateUrlParams({ r: null });
    setAppState("dashboard");
    // Balances and signers may have changed while the user was in the builder.
    handleAccountRefresh().catch(() => {
      /* the dashboard keeps showing the last known state */
    });
  }, [handleAccountRefresh]);

  // Handler for when user changes the source account. Switch only once the new account has
  // loaded, so the builder never pairs one account with another account's signers.
  const handleSourceAccountChange = useCallback(
    async (newSourceAccount: string) => {
      if (!newSourceAccount || newSourceAccount === sourceAccount) return;

      setLoading(true);
      try {
        const realAccountData = await fetchAccountData(newSourceAccount, network);
        setSourceAccount(newSourceAccount);
        setAccountData(realAccountData);
        setAccountError(null);
        toast({
          title: "Source Account Updated",
          description: "Account data loaded for new source account",
          duration: 3000,
        });
      } catch (error) {
        if (import.meta.env.DEV) console.error("Failed to load source account:", error);
        toast({
          title: "Failed to load account",
          description: error instanceof Error ? error.message : "Could not load account data",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    },
    [sourceAccount, network, toast],
  );

  // Retry loading account data after a failure (e.g. Horizon rate limit / network error).
  // Bypasses the dedupe cache so a recently-rejected promise isn't replayed.
  const handleRetryLoadAccount = useCallback(async () => {
    const accountToFetch = sourceAccount || publicKey;
    if (!accountToFetch) return;
    setLoading(true);
    setAccountError(null);
    try {
      const realAccountData = await fetchAccountData(accountToFetch, network);
      setAccountData(realAccountData);
    } catch (error) {
      if (import.meta.env.DEV) console.error("Failed to load account:", error);
      setAccountError(error instanceof Error ? error.message : "Could not load account data");
    } finally {
      setLoading(false);
    }
  }, [sourceAccount, publicKey, network]);

  return (
    <FiatCurrencyProvider>
      <DeepLinkHandler onDeepLinkLoaded={handleDeepLinkLoaded} />
      <div
        className={cn(
          'flex min-h-dvh flex-col bg-background',
          // the dashboard's bottom tab bar (60 px) follows the footer on the phone
          appState === 'dashboard' && 'max-md:min-h-[calc(100dvh-61px)]',
        )}
      >
        <div className="flex-1 flex flex-col">
          {/* Wallet active-account changed warning */}
          {appState !== "connecting" && walletAccountChanged && (
            <div className="notice amber sticky top-0 z-50 items-center border-x-0 border-t-0 px-0 py-0">
              <Wrap className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:gap-4">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                  <p className="text-sm text-foreground">
                    Your wallet's active account changed to{" "}
                    <span className="font-address text-[13px]">{liveWalletAddress ? shortAddress(liveWalletAddress) : ""}</span>,
                    which differs from the connected account{" "}
                    <span className="font-address text-[13px]">{shortAddress(publicKey)}</span>.
                    Reconnect to use the active account.
                  </p>
                </div>
                <Button variant="warn" size="sm" onClick={handleDisconnect} className="shrink-0">
                  <RotateCw />
                  Reconnect
                </Button>
              </Wrap>
            </div>
          )}

          {/* Landing Page */}
          {appState === "connecting" && <LandingPage onConnect={handleWalletConnect} />}

          {/* Transaction Builder */}
          {appState === "transaction" && (
            <Suspense
              fallback={
                <div className="flex flex-1 items-center justify-center p-4">
                  <div className="flex flex-col items-center gap-4">
                    <Spinner size={46} />
                    <span className="text-[15px] text-muted-foreground">Loading transaction builder...</span>
                  </div>
                </div>
              }
            >
              <TransactionBuilder
                key={`${appState}-${sourceAccount}`}
                onBack={handleBackToDashboard}
                accountPublicKey={sourceAccount || publicKey || ""}
                signerPublicKey={publicKey}
                accountData={accountData}
                initialTab={deepLinkReady ? "import" : initialTransactionTab.current ?? "payment"}
                onAccountRefresh={handleAccountRefresh}
                onSourceAccountChange={handleSourceAccountChange}
              />
            </Suspense>
          )}

          {/* Account Dashboard */}
          {appState === "dashboard" && publicKey && accountData && (
            <Suspense
              fallback={
                <div className="flex flex-1 items-center justify-center p-4">
                  <div className="flex flex-col items-center gap-4">
                    <Spinner size={46} />
                    <span className="text-[15px] text-muted-foreground">Loading dashboard...</span>
                  </div>
                </div>
              }
            >
              <AccountOverview
                accountData={accountData}
                onInitiateTransaction={handleInitiateTransaction}
                onRefreshBalances={handleAccountRefresh}
                onDisconnect={handleDisconnect}
              />
            </Suspense>
          )}

          {appState === "dashboard" && publicKey && !accountData && (
            accountError ? (
              <>
                <AppHeader />
                <Wrap className="flex flex-1 items-center py-8">
                  <section
                    role="alert"
                    aria-labelledby="account-load-failed"
                    className="notice red mx-auto w-full max-w-md flex-col gap-3 p-4"
                  >
                    <h1 id="account-load-failed" className="sec flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
                      Failed to Load Account
                    </h1>
                    <p className="break-words text-[15px]">{accountError}</p>
                    <div className="mt-1 flex flex-col gap-3">
                      <Button onClick={handleRetryLoadAccount} disabled={loading} className="w-full">
                        {loading ? <Spinner /> : <RotateCw />}
                        {loading ? "Retrying..." : "Retry"}
                      </Button>
                      <Button variant="outline" onClick={handleDisconnect} disabled={loading} className="w-full">
                        Disconnect
                      </Button>
                    </div>
                  </section>
                </Wrap>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center p-4">
                <div className="flex flex-col items-center gap-4">
                  <Spinner size={46} />
                  <span className="text-[15px] text-muted-foreground">Loading dashboard...</span>
                </div>
              </div>
            )
          )}
        </div>

        <Footer />
      </div>
    </FiatCurrencyProvider>
  );
});

export default Index;
