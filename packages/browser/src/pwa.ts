interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** Install/update controls live outside React; no credentials or business data are persisted. */
export function installPwa(): () => void {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return () => {};
  const tools = document.createElement("aside"); tools.className = "pwa-tools"; tools.setAttribute("aria-label", "App installation and connection status");
  const offline = document.createElement("span"); offline.className = "pwa-offline"; offline.setAttribute("role", "status"); offline.textContent = "Offline — reconnect to load or save billing data.";
  const install = document.createElement("button"); install.type = "button"; install.textContent = "Install app"; install.hidden = true;
  const update = document.createElement("button"); update.type = "button"; update.textContent = "Update app"; update.hidden = true;
  tools.append(offline, install, update); document.body.append(tools);
  let prompt: InstallPrompt | null = null, registration: ServiceWorkerRegistration | null = null, reloadForUpdate = false, disposed = false;
  const standalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const status = () => { offline.hidden = navigator.onLine; tools.hidden = offline.hidden && install.hidden && update.hidden; };
  install.hidden = !ios || standalone(); status();
  const onPrompt = (event: Event) => { event.preventDefault(); prompt = event as InstallPrompt; install.hidden = standalone(); status(); };
  const onInstalled = () => { prompt = null; install.hidden = true; status(); };
  install.onclick = async () => {
    if (prompt) { await prompt.prompt(); await prompt.userChoice; install.hidden = true; prompt = null; status(); }
    else if (ios) window.alert("To install: open this site in Safari, tap Share, then Add to Home Screen.");
  };
  update.onclick = () => { if (!window.confirm("Save any edits before updating. Reload the app now?")) return; reloadForUpdate = true; registration?.waiting?.postMessage({ type: "SKIP_WAITING" }); };
  const onController = () => { if (reloadForUpdate) window.location.reload(); };
  const showUpdate = () => { update.hidden = !registration?.waiting; status(); };
  const onOnline = () => { status(); void registration?.update().catch(() => {}); };
  window.addEventListener("beforeinstallprompt", onPrompt); window.addEventListener("appinstalled", onInstalled);
  window.addEventListener("online", onOnline); window.addEventListener("offline", status); navigator.serviceWorker.addEventListener("controllerchange", onController);
  void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).then(reg => {
    if (disposed) return;
    registration = reg; showUpdate();
    reg.addEventListener("updatefound", () => { const worker = reg.installing; worker?.addEventListener("statechange", () => { if (worker.state === "installed" && navigator.serviceWorker.controller) { update.hidden = false; status(); } }); });
  }).catch(() => { /* Online billing continues if installation isn't available. */ });
  return () => { disposed = true; tools.remove(); window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); window.removeEventListener("online", onOnline); window.removeEventListener("offline", status); navigator.serviceWorker.removeEventListener("controllerchange", onController); };
}
