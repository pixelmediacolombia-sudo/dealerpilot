import { AppProviders } from "./providers";
import { AppRouter } from "./router";
import { AuthGate } from "./AuthGate";
import { DealerThemeProvider } from "./DealerThemeProvider";

export function App() {
  return (
    <AppProviders>
      <AuthGate>
        <DealerThemeProvider>
          <AppRouter />
        </DealerThemeProvider>
      </AuthGate>
    </AppProviders>
  );
}

export default App;
