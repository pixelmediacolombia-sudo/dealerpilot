import { AppProviders } from "./providers";
import { AppRouter } from "./router";
import { AuthGate } from "./AuthGate";

export function App() {
  return (
    <AppProviders>
      <AuthGate>
        <AppRouter />
      </AuthGate>
    </AppProviders>
  );
}

export default App;
