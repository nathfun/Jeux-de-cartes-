/* Ma collection : toutes les cartes des boosters du Parrain, celles découvertes, celles gardées (épiques et mieux), celles qui manquent. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x !== undefined) e.textContent = x; return e; };
  const R = window.CasinoRules, ORDER = Casino.RARITY_ORDER;
  const ALL = Casino.COLLECTION.filter((c) => c.series);
  let ser = 'all';
  const kept = (c) => Casino.colCount(c.id);
  const seen = (c) => kept(c) > 0 || !!((Casino.profile.dex || {})[c.id]);
  // retour : là d'où l'on vient (lobby ou partie), sinon le lobby
  try { if (document.referrer && new URL(document.referrer).origin === location.origin) $('back').onclick = (e) => { e.preventDefault(); history.back(); }; } catch (e) { /* ignore */ }

  function tabs() {
    const box = $('tabs'); box.innerHTML = '';
    const mk = (id, label) => { const b = el('button', id === ser ? 'on' : '', label); b.type = 'button'; b.onclick = () => { ser = id; tabs(); render(); }; box.appendChild(b); };
    const cnt = (list) => list.filter(seen).length + '/' + list.length;
    mk('all', '✨ Toutes ' + cnt(ALL));
    R.SERIES.forEach((se) => { const list = ALL.filter((c) => c.series === se.id); mk(se.id, se.icon + ' ' + se.name + ' ' + cnt(list)); });
  }
  function render() {
    const disc = ALL.filter(seen), kp = ALL.filter((c) => kept(c) > 0), copies = ALL.reduce((a, c) => a + kept(c), 0);
    $('have-top').textContent = disc.length; $('all-top').textContent = ALL.length;
    $('prog-txt').textContent = disc.length + ' / ' + ALL.length + ' cartes découvertes';
    $('prog-bar').style.width = Math.round(disc.length / ALL.length * 100) + '%';
    $('prog-sub').textContent = kp.length + ' carte' + (kp.length > 1 ? 's' : '') + ' dans ton album (' + copies + ' exemplaire' + (copies > 1 ? 's' : '') + ')';
    // compteur par rareté
    const rb = $('rars'); rb.innerHTML = '';
    ORDER.forEach((r) => { const list = ALL.filter((c) => c.rarity === r && (ser === 'all' || c.series === ser)); if (!list.length) return; const sp = el('span', '', R.RARITY[r].name + ' ' + list.filter(seen).length + '/' + list.length); sp.style.color = R.RARITY[r].color; sp.style.borderColor = R.RARITY[r].color; rb.appendChild(sp); });
    const show = $('f-show').value, sort = $('f-sort').value;
    const grid = $('grid'); grid.innerHTML = '';
    const series = ser === 'all' ? R.SERIES : R.SERIES.filter((x) => x.id === ser);
    let any = false;
    series.forEach((se) => {
      let list = ALL.filter((c) => c.series === se.id).filter((c) => show === 'all' || (show === 'mine' && seen(c)) || (show === 'miss' && !seen(c)) || (show === 'kept' && kept(c) > 0) || (show === 'dup' && kept(c) > 1));
      if (sort === 'rar') list = list.slice().sort((a, b) => ORDER.indexOf(b.rarity) - ORDER.indexOf(a.rarity) || a.n - b.n);
      else list = list.slice().sort((a, b) => a.n - b.n);
      if (!list.length) return;
      any = true;
      const h = el('div', 'ser-head'); h.append(el('span', '', se.icon + ' ' + se.name), el('small', '', ALL.filter((c) => c.series === se.id).filter(seen).length + ' / ' + ALL.filter((c) => c.series === se.id).length + ' · palier ' + se.palier));
      h.style.color = se.color; grid.appendChild(h);
      list.forEach((c) => {
        const n = kept(c), v = seen(c), s = el('button', 'slot'); s.type = 'button';
        s.appendChild(Casino.cardEl(c.id, { locked: !v, count: n }));
        s.appendChild(n ? el('span', 'tag kept', n > 1 ? '📖 ×' + n : '📖 Dans l\'album') : v ? el('span', 'tag seen', '👁 Découverte') : el('span', 'tag miss', '❓ À trouver'));
        s.onclick = () => detail(c);
        grid.appendChild(s);
      });
    });
    if (!any) grid.appendChild(el('p', 'empty', 'Aucune carte ici pour le moment.'));
  }
  function detail(c) {
    const n = kept(c), v = seen(c), se = R.SERIES.find((x) => x.id === c.series) || {};
    const o = el('div', 'dlg'), box = el('div', 'dlg-box');
    o.onclick = (e) => { if (e.target === o) o.remove(); };
    box.appendChild(Casino.cardEl(c.id, { size: 'big', locked: !v, fact: v, count: n }));
    const st = el('div', 'stats');
    const stat = (l, x) => { const d = el('div'); d.append(el('small', '', l), el('b', '', x)); st.appendChild(d); };
    stat('Rareté', R.RARITY[c.rarity].name);
    stat('Série', (se.icon || '') + ' ' + (se.name || ''));
    stat('Dans ton album', n ? n + ' exemplaire' + (n > 1 ? 's' : '') : v ? 'découverte' : 'pas encore');
    stat('Où la trouver', 'Boosters, palier ' + (se.palier || '?'));
    box.appendChild(st);
    const acts = el('div', 'acts');
    if (!v) acts.appendChild(el('p', 'note', 'Tu ne l\'as jamais tirée. Ouvre des boosters « ' + (se.name || '') + ' » pendant une partie du Parrain (à partir du palier ' + (se.palier || '?') + ').'));
    else if (!n && ORDER.indexOf(c.rarity) < ORDER.indexOf('epique')) acts.appendChild(el('p', 'note', 'Carte commune ou rare : elle est revendue tout de suite dans ta caisse quand tu la tires, mais elle reste découverte ici.'));
    const close = el('button', 'btn ghost', 'Fermer'); close.type = 'button'; close.onclick = () => o.remove();
    acts.appendChild(close);
    box.appendChild(acts); o.appendChild(box); document.body.appendChild(o);
  }
  $('f-show').onchange = render; $('f-sort').onchange = render;
  Casino.onChange(() => { tabs(); render(); });
  tabs(); render();
  if (Casino.server) Casino.sync();
})();
