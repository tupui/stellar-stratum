import { useState, Suspense, lazy, memo, useCallback, useEffect, useRef } from "react";
import { LandingPage } from "@/components/LandingPage";
import { LoadingPill } from "@/components/ui/loading-pill";
import { Footer } from "@/components/Footer";
import { DeepLinkHandler } from "@/components/DeepLinkHandler";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw } from "lucide-react";

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
    const address = params.get("address") ?? params.get("public_key");
    if (!address) return;
    addressDeepLinkHandled.current = true;

    if (!StrKey.isValidEd25519PublicKey(address)) {
      toast({
        title: "Invalid address",
        description: "The address in the URL is not a valid Stellar public key.",
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

  // Detect when the user switches the active account in their wallet (e.g. Freighter)
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
      <div className="min-h-screen bg-background flex flex-col">
        <div className="flex-1 flex flex-col">
          {/* Wallet active-account changed warning */}
          {appState !== "connecting" && walletAccountChanged && (
            <div className="sticky top-0 z-50 bg-warning/10 border-b border-warning/40">
              <div className="max-w-4xl mx-auto px-3 sm:px-6 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                <div className="flex items-start gap-2 flex-1 min-w-0">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-warning" />
                  <p className="text-sm text-foreground">
                    Your wallet's active account changed to{" "}
                    <span className="font-address">{liveWalletAddress?.slice(0, 8)}...{liveWalletAddress?.slice(-8)}</span>,
                    which differs from the connected account{" "}
                    <span className="font-address">{publicKey.slice(0, 8)}...{publicKey.slice(-8)}</span>.
                    Reconnect to use the active account.
                  </p>
                </div>
                <Button size="sm" onClick={handleDisconnect} className="shrink-0 gap-2">
                  <RefreshCw className="w-4 h-4" />
                  Reconnect
                </Button>
              </div>
            </div>
          )}

          {/* Landing Page */}
          {appState === "connecting" && <LandingPage onConnect={handleWalletConnect} />}

          {/* Transaction Builder */}
          {appState === "transaction" && (
            <Suspense
              fallback={
                <div className="min-h-screen flex items-center justify-center">
                  <div className="flex flex-col items-center gap-4">
                    <LoadingPill size="lg" glowColor="primary" />
                    <span className="text-muted-foreground">Loading transaction builder...</span>
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
                <div className="min-h-screen flex items-center justify-center">
                  <div className="flex flex-col items-center gap-4">
                    <LoadingPill size="lg" glowColor="primary" />
                    <span className="text-muted-foreground">Loading dashboard...</span>
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
            <div className="min-h-screen flex items-center justify-center p-4">
              {accountError ? (
                <div className="max-w-md w-full rounded-2xl border border-destructive/40 bg-destructive/5 p-6 text-center flex flex-col items-center gap-4">
                  <div className="flex items-center gap-2 text-destructive">
                    <AlertTriangle className="w-5 h-5" />
                    <h2 className="text-lg font-semibold">Failed to load account</h2>
                  </div>
                  <p className="text-sm text-muted-foreground break-words">{accountError}</p>
                  <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                    <Button onClick={handleRetryLoadAccount} disabled={loading} className="gap-2">
                      <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                      {loading ? "Retrying..." : "Retry"}
                    </Button>
                    <Button variant="outline" onClick={handleDisconnect} disabled={loading}>
                      Disconnect
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-4">
                  <LoadingPill size="lg" glowColor="primary" />
                  <span className="text-muted-foreground">Loading dashboard...</span>
                </div>
              )}
            </div>
          )}
        </div>

        <Footer />
      </div>
    </FiatCurrencyProvider>
  );
});

export default Index;
