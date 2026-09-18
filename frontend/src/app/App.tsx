import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { useEffect } from "react";
import { useAuth } from "@/stores/auth";
import { useTheme } from "@/stores/theme";
import { PwaInstall } from "@/components/PwaInstall";
import { AppRoutes } from "./routes";

const client = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 15_000
    }
  }
});

export function App() {
  const hydrate = useAuth((s) => s.hydrate);
  const hydrateTheme = useTheme((s) => s.hydrate);
  useEffect(() => {
    hydrateTheme();
    void hydrate();
  }, [hydrate, hydrateTheme]);
  return (
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <AppRoutes />
        <PwaInstall />
        <Toaster
          position="top-center"
          containerStyle={{ top: "calc(0.75rem + env(safe-area-inset-top))" }}
          toastOptions={{
            duration: 3500,
            style: {
              borderRadius: 12,
              fontSize: 13,
              background: "var(--surface)",
              color: "var(--ink)",
              border: "1px solid var(--line)",
              boxShadow: "0 8px 24px rgba(17,19,24,0.08)"
            }
          }}
        />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
