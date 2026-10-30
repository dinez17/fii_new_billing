import { installResponsiveTables } from "../../../packages/browser/src/responsive-tables";
import { installPwa } from "../../../packages/browser/src/pwa";
import { installThemePicker } from "../../../packages/browser/src/themes";
import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import "./styles.css";
import "../../../packages/browser/src/mobile.css";
import "../../../packages/browser/src/pwa.css";
import "../../../packages/browser/src/theme.css";
import { installEnterNavigation } from "../../../packages/browser/src/enter-navigation";

const removeEnterNavigation = installEnterNavigation();
const removeThemePicker = installThemePicker();
const removeResponsiveTables = installResponsiveTables();
const removePwa = import.meta.env.PROD ? installPwa() : () => {};
import.meta.hot?.dispose(() => { removeResponsiveTables(); removePwa(); removeThemePicker(); });
import.meta.hot?.dispose(removeEnterNavigation);

const qc = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
