import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Routes, Route } from "react-router-dom";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import { NetworkProvider } from "@/contexts/NetworkContext";
import { WalletKitProvider } from "@/contexts/WalletKitContext";
import Index from "./pages/Index";
import AirgapSigner from "./pages/AirgapSigner";
import NotFound from "./pages/NotFound";
import Legal from "./pages/legal/Legal";
import Impressum from "./pages/legal/Impressum";
import Privacy from "./pages/legal/Privacy";
import Terms from "./pages/legal/Terms";

const queryClient = new QueryClient();

const App = () => (
  <ErrorBoundary>
    <NetworkProvider>
      <WalletKitProvider>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
          <Toaster />
          <BrowserRouter basename={import.meta.env.BASE_URL}>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/sign" element={<AirgapSigner />} />
              <Route path="/legal" element={<Legal />}>
                <Route index element={<Navigate to="impressum" replace />} />
                <Route path="impressum" element={<Impressum />} />
                <Route path="privacy" element={<Privacy />} />
                <Route path="terms" element={<Terms />} />
              </Route>
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
          </TooltipProvider>
        </QueryClientProvider>
      </WalletKitProvider>
    </NetworkProvider>
  </ErrorBoundary>
);

export default App;