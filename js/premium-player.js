const SELECTOR = '#ss2AdminYoutube';

function addCss(){
  if(document.querySelector('link[data-ss-premium]')) return;
  const l=document.createElement('link');
  l.rel='stylesheet';
  l.href='./premium-player.css';
  l.dataset.ssPremium='1';
  document.head.appendChild(l);
}

function ensurePremiumPlayer(){
  const player=document.querySelector(SELECTOR);
  const card=document.querySelector('.ss2-player-card');
  if(!player||!card) return false;

  let wrap=card.querySelector('.ss2-premium-wrap');
  if(!wrap){
    wrap=document.createElement('div');
    wrap.className='ss2-premium-wrap';
    wrap.innerHTML=`
      <div class="ss2-premium-head">
        <div><span class="eyebrow">YOUTUBE PREMIUM</span><strong>Reproductor oficial</strong></div>
        <span class="ss2-premium-badge">SIN ANUNCIOS CON TU CUENTA PREMIUM</span>
      </div>
      <div class="ss2-premium-slot"></div>
      <p class="ss2-premium-help">Para que YouTube reconozca Premium, inicia sesión en YouTube con tu cuenta Premium en este mismo navegador y permite las cookies de <b>youtube.com</b>.</p>`;
    const now=card.querySelector('.ss2-now');
    if(now) now.insertAdjacentElement('afterend',wrap); else card.appendChild(wrap);
  }

  const slot=wrap.querySelector('.ss2-premium-slot');
  if(player.parentElement!==slot) slot.appendChild(player);

  player.removeAttribute('style');
  player.classList.add('ss2-premium-youtube');
  if(player.tagName==='IFRAME'){
    player.setAttribute('allow','accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share');
  }
  return true;
}

function watch(){
  addCss();
  ensurePremiumPlayer();
  const obs=new MutationObserver(()=>ensurePremiumPlayer());
  obs.observe(document.body,{childList:true,subtree:true});
  setInterval(ensurePremiumPlayer,1200);
}

watch();
