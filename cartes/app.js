/* Album des cartes Légendes : collection, cotes, vente immédiate au Casino, mise en vente sur le marché. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Math.round(n || 0).toLocaleString('fr-FR');
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x !== undefined) e.textContent = x; return e; };
  const ORDER = Casino.RARITY_ORDER;
  let cat = 'all', cotes = {};
  const key = (c) => 'col:' + c.id;
  const coteOf = (c) => (cotes[key(c)] && cotes[key(c)].cote) || Casino.COTE_BASE[c.rarity];

  // onglets par catégorie
  function tabs() {
    const box = $('tabs'); box.innerHTML = '';
    const mk = (id, label) => { const b = el('button', id === cat ? 'on' : '', label); b.type = 'button'; b.onclick = () => { cat = id; tabs(); render(); }; box.appendChild(b); };
    const have = (list) => list.filter((c) => Casino.colCount(c.id) > 0).length;
    mk('all', '✨ Tout ' + have(Casino.COLLECTION) + '/' + Casino.COLLECTION.length);
    Object.keys(Casino.COL_CATS).forEach((k) => { const list = Casino.COLLECTION.filter((c) => c.cat === k); mk(k, Casino.COL_CATS[k].icon + ' ' + Casino.COL_CATS[k].name + ' ' + have(list) + '/' + list.length); });
  }
  function render() {
    $('wallet').textContent = fmt(Casino.wallet());
    const all = Casino.COLLECTION, mine = all.filter((c) => Casino.colCount(c.id) > 0);
    $('prog-txt').textContent = mine.length + ' / ' + all.length + ' cartes';
    $('prog-bar').style.width = Math.round(mine.length / all.length * 100) + '%';
    const copies = all.reduce((a, c) => a + Casino.colCount(c.id), 0);
    $('value').textContent = fmt(all.reduce((a, c) => a + Casino.colCount(c.id) * coteOf(c), 0)) + ' €';
    $('value-sub').textContent = copies + ' exemplaire' + (copies > 1 ? 's' : '');
    const show = $('f-show').value, sort = $('f-sort').value;
    let list = all.filter((c) => cat === 'all' || c.cat === cat).filter((c) => {
      const n = Casino.colCount(c.id);
      return show === 'all' || (show === 'mine' && n > 0) || (show === 'miss' && !n) || (show === 'dup' && n > 1);
    });
    if (sort === 'rar') list = list.slice().sort((a, b) => ORDER.indexOf(b.rarity) - ORDER.indexOf(a.rarity) || a.n - b.n);
    if (sort === 'cote') list = list.slice().sort((a, b) => coteOf(b) - coteOf(a));
    const grid = $('grid'); grid.innerHTML = '';
    if (!list.length) grid.appendChild(el('p', 'empty', 'Aucune carte ici pour le moment.'));
    list.forEach((c) => {
      const n = Casino.colCount(c.id), s = el('button', 'slot'); s.type = 'button';
      s.appendChild(Casino.cardEl(c.id, { locked: !n, count: n }));
      const info = el('small'); const t = cotes[key(c)] && cotes[key(c)].trend;
      info.textContent = fmt(coteOf(c)) + ' € ';
      if (t) { const sp = el('span', t > 0 ? 'up' : 'down', (t > 0 ? '▲ ' : '▼ ') + Math.abs(t) + ' %'); info.appendChild(sp); }
      s.appendChild(info);
      s.onclick = () => detail(c);
      grid.appendChild(s);
    });
    $('sell-dups').disabled = !all.some((c) => Casino.colCount(c.id) > 1);
  }
  // fiche d'une carte
  function detail(c) {
    const n = Casino.colCount(c.id), k = key(c), info = cotes[k] || {}, cote = coteOf(c), instant = info.instant || Casino.instantPrice(k, cote);
    const o = el('div', 'dlg'), box = el('div', 'dlg-box');
    o.onclick = (e) => { if (e.target === o) o.remove(); };
    box.appendChild(Casino.cardEl(c.id, { size: 'big', locked: !n, fact: true, count: n }));
    const st = el('div', 'stats');
    const stat = (l, v) => { const d = el('div'); d.append(el('small', '', l), el('b', '', v)); st.appendChild(d); };
    stat('Cote', fmt(cote) + ' €' + (info.trend ? ' (' + (info.trend > 0 ? '+' : '') + info.trend + ' %)' : ''));
    stat('Tu en as', String(n));
    stat('En circulation', info.circ !== undefined ? fmt(info.circ) + ' ex.' : '—');
    stat('Ventes (30 j)', info.sales !== undefined ? fmt(info.sales) : '—');
    box.appendChild(st);
    const acts = el('div', 'acts'), msg = el('p', 'msg');
    if (n) {
      let armed = false;
      const sell = el('button', 'btn', '💰 Vendre au Casino : +' + fmt(instant) + ' €'); sell.type = 'button';
      sell.onclick = async () => {
        if (!armed) { armed = true; sell.textContent = '👉 Confirmer : +' + fmt(instant) + ' € tout de suite ?'; setTimeout(() => { armed = false; sell.textContent = '💰 Vendre au Casino : +' + fmt(instant) + ' €'; }, 4000); return; }
        sell.disabled = true;
        const r = await Casino.sellInstant(k, 1);
        if (r.error) { msg.textContent = r.error; sell.disabled = false; return; }
        Casino.toast('Vendu au Casino', c.name + ' : +' + fmt(r.price) + ' €', '💰', 'gold');
        o.remove(); await refresh();
      };
      const row = el('div', 'row'), price = el('input'); price.type = 'number'; price.min = 10; price.step = 10; price.value = Math.max(10, Math.round(cote));
      const list = el('button', 'btn ghost', '🏷️ Mettre sur le marché'); list.type = 'button';
      list.onclick = async () => {
        list.disabled = true;
        const r = await Casino.deal('mk.list', { item: k, price: +price.value });
        if (r.error) { msg.textContent = r.error; list.disabled = false; return; }
        Casino.toast('En vente sur le marché', c.name + ' à ' + fmt(price.value) + ' €. Tu seras prévenu dès qu\'elle est vendue.', '🏷️', 'gold');
        o.remove(); await refresh();
      };
      row.append(price, list);
      acts.append(sell, row);
      acts.appendChild(el('p', 'note', 'Sur le marché, tu fixes ton prix (le Casino prend ' + Math.round((Casino.isVip() ? Casino.MARKET_FEE_VIP : Casino.MARKET_FEE) * 100) + ' % à la vente). La vente au Casino, elle, est immédiate.'));
    } else {
      acts.appendChild(el('p', 'note', 'Tu n\'as pas encore cette carte : trouve-la dans les boosters ou achète-la à un autre joueur sur le marché.'));
      const go = el('a', 'btn', '🏪 Voir le marché'); go.href = '../index.html#shop'; acts.appendChild(go);
    }
    const close = el('button', 'btn ghost', 'Fermer'); close.type = 'button'; close.onclick = () => o.remove();
    acts.append(msg, close);
    box.appendChild(acts); o.appendChild(box); document.body.appendChild(o);
  }
  // vendre tous les doublons (on garde 1 exemplaire de chaque)
  let dupArmed = false;
  $('sell-dups').onclick = async () => {
    const dups = Casino.COLLECTION.filter((c) => Casino.colCount(c.id) > 1);
    const total = dups.reduce((a, c) => a + (Casino.colCount(c.id) - 1) * ((cotes[key(c)] && cotes[key(c)].instant) || Casino.instantPrice(key(c))), 0);
    const b = $('sell-dups');
    if (!dupArmed) { dupArmed = true; b.textContent = '👉 Vendre ' + dups.reduce((a, c) => a + Casino.colCount(c.id) - 1, 0) + ' doublons pour ' + fmt(total) + ' € ?'; setTimeout(() => { dupArmed = false; b.textContent = '💰 Vendre mes doublons au Casino'; }, 5000); return; }
    dupArmed = false; b.disabled = true;
    let got = 0;
    for (const c of dups) { const r = await Casino.sellInstant(key(c), Casino.colCount(c.id) - 1); if (!r.error) got += r.price; }
    Casino.toast('Doublons vendus', '+' + fmt(got) + ' € sur ta banque', '💰', 'gold');
    b.textContent = '💰 Vendre mes doublons au Casino';
    await refresh();
  };
  $('f-show').onchange = render; $('f-sort').onchange = render;
  async function refresh() { try { cotes = await Casino.cotes(true); } catch (e) { cotes = {}; } tabs(); render(); }
  Casino.onChange(() => { tabs(); render(); });
  tabs(); render(); refresh();
  if (Casino.server) Casino.sync();
})();
