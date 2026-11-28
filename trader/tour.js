/* Bourse Flash — partie guidée (Apprentissage) : chaque zone de l'écran est éclairée et expliquée,
   et le joueur ouvre puis clôture une vraie position, pas à pas. */
(function () {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const T = () => (window.Trader ? window.Trader.state : null);
  const STEPS = [
    { title: 'Bienvenue à la Bourse Flash ! 📈', text: 'Ici, tu paries sur le cours d\'une action : va-t-il monter ou baisser dans les prochaines secondes ? Je te montre tout, pas à pas. Tu joues avec ton crédit d\'apprentissage : aucun risque.' },
    { sel: '#assets', title: 'Trois actions au choix', text: '💡 NÉON est calme (levier jusqu\'à ×20), 🛰️ ORBT est nerveuse (×10), 🌙 MOON est folle : krachs et envolées (×3). Touche une action pour la suivre.' },
    { sel: '#stage', title: 'Le cours en direct', text: 'La courbe bouge en temps réel, au hasard : personne ne sait où elle va. En haut, le prix actuel et sa variation depuis le début. Le marché ne regarde jamais tes paris.' },
    { sel: '.bet-side', title: 'Ta mise', text: 'C\'est la somme que tu risques sur une position. Les boutons ½ et ×2 l\'ajustent, ou touche un montant tout prêt. Tu ne peux jamais perdre plus que ta mise.' },
    { sel: '#lev', title: 'L\'effet de levier', text: 'Le levier multiplie tout. Au levier ×10, si le cours bouge de 1 %, ta position bouge de 10 %. Plus de gains possibles… mais une perte plus rapide aussi. Commence petit : ×2 ou ×3.' },
    { sel: '.tr-auto', title: 'Objectif de gain et limite de perte', text: 'Facultatif : la position se ferme toute seule quand elle gagne +X % de ta mise (objectif) ou perd −Y % (limite). Pratique pour ne pas rester collé à l\'écran.' },
    { sel: '.potential', title: 'Ce que tu risques', text: 'Ici, tu vois combien tu gagnes (ou perds) si le cours bouge de 1 %, avec ta mise et ton levier actuels.' },
    { sel: '.balance', title: 'Les frais', text: 'Chaque position paie de petits frais à l\'ouverture (0,3 % de la somme engagée : mise × levier). C\'est l\'avantage du casino.' },
    { sel: '.tr-buttons', title: 'À toi de jouer : ACHETER', text: 'ACHETER = tu paries que ça va MONTER. VENDRE = tu paries que ça va BAISSER. Essaie : appuie sur ACHETER.', wait: () => T() && T().positions.length > 0, waitText: '👉 Appuie sur ACHETER' },
    { sel: '#positions', title: 'Ta position est ouverte !', text: 'Tu vois en direct ton gain ou ta perte (en € et en %), le prix d\'entrée, et le prix de LIQUIDATION : si le cours l\'atteint, la position se ferme et ta mise est perdue. La barre montre le danger.' },
    { sel: '#positions', title: 'Encaisse ton résultat', text: 'Quand tu veux, appuie sur « Clôturer » : tu récupères la valeur de ta position, gain ou perte compris. Vas-y !', wait: () => T() && T().positions.length === 0, waitText: '👉 Appuie sur Clôturer' },
    { sel: '#stage', title: 'Krachs et envolées', text: 'Parfois une nouvelle fait bondir ou plonger une action : un bandeau s\'affiche et la cotation est suspendue 2 secondes. Pendant ce temps, impossible d\'ouvrir ou de fermer… mais la liquidation peut tomber !' },
    { title: 'Tu sais tout ! 🎓', text: 'Les bons réflexes : petit levier pour commencer, une limite de perte, ne pas garder trop longtemps, et ne jamais tout miser sur une seule position. Tu peux relancer ce guide avec le bouton « 🎓 Partie guidée ».' },
  ];
  let i = 0, hole = null, box = null, timer = null;
  function css() {
    if (document.getElementById('tr-tour-css')) return;
    const s = document.createElement('style'); s.id = 'tr-tour-css';
    s.textContent = `
.trt-hole { position: fixed; z-index: 400; border-radius: 14px; box-shadow: 0 0 0 9999px rgba(2,6,23,.72), 0 0 0 3px #facc15, 0 0 24px rgba(250,204,21,.6); pointer-events: none; transition: all .3s ease; }
.trt-box { position: fixed; z-index: 401; left: 50%; transform: translateX(-50%); width: min(420px, calc(100vw - 24px)); background: #0f172a; color: #e2e8f0; border: 2px solid #facc15; border-radius: 16px; padding: .85rem 1rem; box-shadow: 0 16px 40px rgba(0,0,0,.6); font: 15px/1.45 system-ui, sans-serif; animation: trtIn .3s ease-out; }
@keyframes trtIn { from { opacity: 0; transform: translateX(-50%) translateY(10px); } }
.trt-box h3 { margin: 0 0 .3rem; color: #fde68a; font-size: 1.05rem; }
.trt-box p { margin: 0 0 .7rem; }
.trt-row { display: flex; align-items: center; gap: .5rem; }
.trt-row small { color: #94a3b8; margin-right: auto; }
.trt-row button { font: inherit; font-weight: 800; border-radius: 10px; padding: .45rem .9rem; cursor: pointer; border: 0; }
.trt-next { background: linear-gradient(135deg, #fde047, #f59e0b); color: #1c1300; }
.trt-skip { background: transparent; color: #94a3b8; border: 1px solid #334155 !important; }
.trt-wait { font-weight: 900; color: #facc15; animation: trtBlink 1s steps(2) infinite; }
@keyframes trtBlink { 50% { opacity: .45; } }`;
    document.head.appendChild(s);
  }
  function place() {
    const st = STEPS[i]; if (!box) return;
    const el = st.sel ? st.sel.split(',').map((x) => $(x.trim())).find((e) => e && e.offsetParent !== null) : null;
    if (el) {
      const r = el.getBoundingClientRect(), pad = 6;
      hole.style.display = ''; Object.assign(hole.style, { left: (r.left - pad) + 'px', top: (r.top - pad) + 'px', width: (r.width + pad * 2) + 'px', height: (r.height + pad * 2) + 'px' });
      const below = r.bottom + 12, h = box.offsetHeight;
      if (below + h < innerHeight - 8) { box.style.top = below + 'px'; } else if (r.top - h - 12 > 8) { box.style.top = (r.top - h - 12) + 'px'; } else { box.style.top = Math.max(8, innerHeight - h - 8) + 'px'; }
    } else { hole.style.display = 'none'; box.style.top = Math.max(12, innerHeight / 2 - box.offsetHeight / 2) + 'px'; }
  }
  function show() {
    const st = STEPS[i];
    const el = st.sel ? st.sel.split(',').map((x) => $(x.trim())).find((e) => e && e.offsetParent !== null) : null;
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    box.innerHTML = '';
    const h = document.createElement('h3'); h.textContent = st.title;
    const p = document.createElement('p'); p.textContent = st.text;
    const row = document.createElement('div'); row.className = 'trt-row';
    const n = document.createElement('small'); n.textContent = (i + 1) + ' / ' + STEPS.length;
    const skip = document.createElement('button'); skip.type = 'button'; skip.className = 'trt-skip'; skip.textContent = i === STEPS.length - 1 ? 'Fermer' : 'Passer';
    skip.onclick = end;
    row.append(n, skip);
    if (st.wait) {
      const w = document.createElement('span'); w.className = 'trt-wait'; w.textContent = st.waitText; row.appendChild(w);
      clearInterval(timer); timer = setInterval(() => { if (st.wait()) { clearInterval(timer); if (window.Sfx) Sfx.chips(); setTimeout(next, 700); } }, 300);
    } else if (i < STEPS.length - 1) {
      const nx = document.createElement('button'); nx.type = 'button'; nx.className = 'trt-next'; nx.textContent = 'Suivant ›'; nx.onclick = next; row.appendChild(nx);
    }
    box.append(h, p, row);
    setTimeout(place, 350); place();
  }
  function next() { clearInterval(timer); i++; if (i >= STEPS.length) { end(); return; } show(); }
  function end() {
    clearInterval(timer);
    if (hole) hole.remove(); if (box) box.remove(); hole = box = null;
    window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true);
    try { localStorage.setItem('tr-tour-done', '1'); } catch (e) { /* ignore */ }
  }
  function start() {
    if (box) return;
    css(); i = 0;
    hole = document.createElement('div'); hole.className = 'trt-hole';
    box = document.createElement('div'); box.className = 'trt-box'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Partie guidée');
    document.body.append(hole, box);
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    show();
  }
  window.TraderTour = { start, end, get running() { return !!box; } };
})();
