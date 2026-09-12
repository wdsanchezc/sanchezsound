const params = new URLSearchParams(location.search);
const initialView = params.get('view') || 'public';
const interfaceType = initialView === 'admin' ? 'admin' : initialView === 'host' ? 'host' : initialView === 'guest' ? 'guest' : 'public';
document.body.dataset.interface = interfaceType;

const dock = document.getElementById('mobileDock');
if (dock) {
  const viewToNav = {
    homeView: 'home',
    catalogView: 'artists',
    searchView: 'search',
    queueView: 'queue'
  };
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
  const suffix = interfaceType === 'admin' ? ' · Admin' : interfaceType === 'host' ? ' · Rokola' : interfaceType === 'guest' ? ' · Invitado' : '';
  const observer = new MutationObserver(() => {
    if (!mode.textContent.includes('·') && suffix) mode.textContent += suffix;
  });
  observer.observe(mode,{childList:true,subtree:true});
  setTimeout(() => { if (!mode.textContent.includes('·') && suffix) mode.textContent += suffix; }, 300);
}
