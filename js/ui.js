const params = new URLSearchParams(location.search);
const originalView = params.get('view') || 'public';
window.__SS_ORIGINAL_VIEW = originalView;

// Legacy host/admin URLs used to start the player in the public app. They are now
// rendered as a silent guest/public surface and the protected admin console owns audio.
if (originalView === 'host' || originalView === 'admin') {
  const next = new URL(location.href);
  next.searchParams.set('view', next.searchParams.get('room') ? 'guest' : 'home');
  history.replaceState({}, '', next);
}

const effectiveParams = new URLSearchParams(location.search);
const initialView = effectiveParams.get('view') || 'public';
const interfaceType = originalView === 'admin' || originalView === 'host' ? 'admin' : initialView === 'guest' ? 'guest' : 'public';
document.body.dataset.interface = interfaceType;

if (!document.querySelector('link[data-ss-rich]')) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = './rich.css';
  link.dataset.ssRich = '1';
  document.head.appendChild(link);
}

const dock = document.getElementById('mobileDock');
if (dock) {
  const viewToNav = {homeView:'home',catalogView:'artists',searchView:'search',queueView:'queue'};
  const syncDock = () => {
    const visible = [...document.querySelectorAll('main > .view')].find(el => !el.classList.contains('hidden'));
    const nav = visible ? viewToNav[visible.id] : 'home';
    dock.querySelectorAll('[data-nav]').forEach(btn => btn.classList.toggle('active', btn.dataset.nav === nav));
  };
  const observer = new MutationObserver(syncDock);
  document.querySelectorAll('main > .view').forEach(el => observer.observe(el,{attributes:true,attributeFilter:['class']}));
  dock.addEventListener('click', syncDock);
  syncDock();
}

const mode = document.getElementById('modeBadge');
if (mode) {
  const suffix = initialView === 'guest' ? ' · Invitado' : '';
  const observer = new MutationObserver(() => { if (!mode.textContent.includes('·') && suffix) mode.textContent += suffix; });
  observer.observe(mode,{childList:true,subtree:true});
  setTimeout(() => { if (!mode.textContent.includes('·') && suffix) mode.textContent += suffix; }, 300);
}

import('./catalog-rich.js').catch(() => {});
import('./experience-v2.js').catch(err => console.error('SanchezSound experience:', err));
