import { createRoot } from "react-dom/client";
import App from "./App";
import "@fontsource/poppins/latin-ext-400.css";
import "@fontsource/poppins/latin-ext-500.css";
import "@fontsource/poppins/latin-ext-600.css";
import "@fontsource/poppins/latin-ext-700.css";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
