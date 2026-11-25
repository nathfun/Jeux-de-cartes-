/*
 * Bourse Flash — graphique du cours (canvas), indépendant de la logique du jeu.
 * getState() fournit à chaque image : { hist: [{t, p}], now: t courant (s), positions: [...], halted, haltDir, flash }
 */
(function (root) {
  'use strict';
  const WINDOW = 90; // secondes affichées

  class TraderScene {
    constructor(canvas) {
      this.cv = canvas; this.cx = canvas.getContext('2d');
      this.dpr = 1; this.W = 1; this.H = 1;
      this.yMin = null; this.yMax = null;
      this.resize();
      if (window.ResizeObserver) new ResizeObserver(() => this.resize()).observe(canvas);
      else window.addEventListener('resize', () => this.resize());
    }
    resize() {
      const r = this.cv.getBoundingClientRect();
      this.dpr = Math.min(2, window.devicePixelRatio || 1);
      this.W = Math.max(1, r.width); this.H = Math.max(1, r.height);
      this.cv.width = Math.round(this.W * this.dpr); this.cv.height = Math.round(this.H * this.dpr);
    }
    start(getState) {
      this.getState = getState;
      const loop = (now) => { this.raf = requestAnimationFrame(loop); try { this.frame(now); } catch (e) { /* image suivante */ } };
      this.raf = requestAnimationFrame(loop);
    }
    frame(ms) {
      const c = this.cx, W = this.W, H = this.H;
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      c.clearRect(0, 0, W, H);
      if (W < 60 || H < 60 || !this.getState) return;
      const st = this.getState();
      if (!st || !st.hist || st.hist.length < 2) return;
      const pad = { l: 10, r: Math.max(64, W * 0.11), t: 18, b: 22 };
      const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
      const t1 = st.now, t0 = t1 - WINDOW;
      const pts = st.hist.filter((q) => q.t >= t0 - 1);
      // échelle verticale lissée (pas de saut brutal)
      let lo = Infinity, hi = -Infinity;
      pts.forEach((q) => { lo = Math.min(lo, q.p); hi = Math.max(hi, q.p); });
      (st.positions || []).forEach((p) => { if (p.entry > lo * 0.97 && p.entry < hi * 1.03) { lo = Math.min(lo, p.entry); hi = Math.max(hi, p.entry); } });
      const span = Math.max(hi - lo, hi * 0.004);
      const tMin = lo - span * 0.18, tMax = hi + span * 0.18;
      if (this.yMin == null || st.reset) { this.yMin = tMin; this.yMax = tMax; }
      this.yMin += (tMin - this.yMin) * 0.12; this.yMax += (tMax - this.yMax) * 0.12;
      const X = (t) => pad.l + ((t - t0) / WINDOW) * pw;
      const Y = (p) => pad.t + (1 - (p - this.yMin) / (this.yMax - this.yMin)) * ph;
      const dec = st.decimals != null ? st.decimals : 2;
      const fmt = (p) => p.toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec });

      // grille
      c.font = '600 11px Inter, system-ui, sans-serif'; c.textBaseline = 'middle'; c.textAlign = 'left';
      const steps = 5;
      for (let i = 0; i <= steps; i++) {
        const p = this.yMin + (this.yMax - this.yMin) * (i / steps), y = Y(p);
        c.strokeStyle = 'rgba(139,92,246,.12)'; c.lineWidth = 1;
        c.beginPath(); c.moveTo(pad.l, y); c.lineTo(pad.l + pw, y); c.stroke();
        c.fillStyle = 'rgba(203,213,255,.45)'; c.fillText(fmt(p), pad.l + pw + 8, y);
      }
      for (let s = Math.ceil(t0 / 15) * 15; s <= t1; s += 15) {
        c.strokeStyle = 'rgba(139,92,246,.07)'; c.beginPath(); c.moveTo(X(s), pad.t); c.lineTo(X(s), pad.t + ph); c.stroke();
      }

      // couleur : hausse ou baisse sur la fenêtre
      const last = pts[pts.length - 1], first = pts[0];
      const up = last.p >= first.p;
      const col = up ? [52, 211, 153] : [244, 114, 182];
      const rgba = (a) => 'rgba(' + col.join(',') + ',' + a + ')';

      // aire + ligne
      c.save();
      c.beginPath(); c.rect(pad.l, 0, pw, H); c.clip();
      c.beginPath();
      pts.forEach((q, i) => { const x = X(q.t), y = Y(q.p); if (i) c.lineTo(x, y); else c.moveTo(x, y); });
      const grd = c.createLinearGradient(0, pad.t, 0, pad.t + ph);
      grd.addColorStop(0, rgba(0.28)); grd.addColorStop(1, rgba(0));
      c.lineTo(X(last.t), pad.t + ph); c.lineTo(X(first.t), pad.t + ph); c.closePath();
      c.fillStyle = grd; c.fill();
      c.beginPath();
      pts.forEach((q, i) => { const x = X(q.t), y = Y(q.p); if (i) c.lineTo(x, y); else c.moveTo(x, y); });
      c.strokeStyle = rgba(1); c.lineWidth = 2.4; c.lineJoin = 'round';
      c.shadowColor = rgba(0.8); c.shadowBlur = 12; c.stroke(); c.shadowBlur = 0;

      // positions : prix d'entrée et de liquidation
      (st.positions || []).forEach((p) => {
        const y = Y(p.entry), buy = p.dir > 0;
        c.setLineDash([6, 5]); c.lineWidth = 1.3;
        c.strokeStyle = buy ? 'rgba(34,211,238,.85)' : 'rgba(251,146,60,.85)';
        c.beginPath(); c.moveTo(pad.l, y); c.lineTo(pad.l + pw, y); c.stroke();
        if (p.liq > this.yMin && p.liq < this.yMax) {
          c.setLineDash([2, 4]); c.strokeStyle = 'rgba(255,77,109,.6)';
          c.beginPath(); c.moveTo(pad.l, Y(p.liq)); c.lineTo(pad.l + pw, Y(p.liq)); c.stroke();
        }
        c.setLineDash([]);
        const label = (buy ? '▲ Achat' : '▼ Vente') + ' ×' + p.lev + ' · ' + (p.pnl >= 0 ? '+' : '−') + Math.abs(p.pnl).toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' €';
        c.font = '800 11px Inter, system-ui, sans-serif';
        const w = c.measureText(label).width + 14;
        c.fillStyle = buy ? 'rgba(8,51,68,.9)' : 'rgba(67,20,7,.9)';
        roundRect(c, pad.l + 6, y - 10, w, 20, 8); c.fill();
        c.fillStyle = p.pnl >= 0 ? '#6ee7b7' : '#fda4af'; c.textAlign = 'left';
        c.fillText(label, pad.l + 13, y);
      });
      c.restore();

      // point du prix actuel + étiquette
      const lx = X(last.t), ly = Y(last.p);
      const pulse = 4 + 2 * Math.sin(ms / 180);
      c.fillStyle = rgba(0.25); c.beginPath(); c.arc(lx, ly, pulse + 5, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#fff'; c.beginPath(); c.arc(lx, ly, 3.5, 0, Math.PI * 2); c.fill();
      c.font = '800 12px Inter, system-ui, sans-serif';
      const txt = fmt(last.p), tw = c.measureText(txt).width + 14;
      c.fillStyle = rgba(0.95); roundRect(c, pad.l + pw + 2, ly - 11, tw, 22, 7); c.fill();
      c.fillStyle = '#04121a'; c.textAlign = 'left'; c.fillText(txt, pad.l + pw + 9, ly + 1);

      // cotation suspendue (krach / envolée)
      if (st.halted) {
        const a = 0.12 + 0.08 * Math.sin(ms / 90);
        c.fillStyle = st.haltDir === 'up' ? 'rgba(52,211,153,' + a + ')' : 'rgba(255,77,109,' + a + ')';
        c.fillRect(0, 0, W, H);
      }
    }
  }
  function roundRect(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  root.TraderScene = TraderScene;
})(window);
