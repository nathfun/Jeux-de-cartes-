/*
 * Plinko — rendu du plateau (canvas), indépendant de la logique du jeu.
 * Le chemin de chaque bille est déjà tiré quand elle est lâchée : la scène ne fait que l'animer.
 * La position d'une bille ne dépend que de l'heure (performance.now) : si l'affichage rame, la bille
 * arrive quand même au bon moment, et la logique du jeu règle le gain sans attendre l'image.
 */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // Durée de la chute d'une bille : un « saut » par rangée, plus l'entrée et la chute dans la case
  const STEP_MS = (rows) => clamp(2200 / (rows + 2), 125, 230);
  const durationOf = (rows) => STEP_MS(rows) * (rows + 1.6);

  class PlinkoScene {
    constructor(canvas) {
      this.cv = canvas; this.cx = canvas.getContext('2d');
      this.balls = []; this.flashes = []; this.labels = []; this.sparks = []; this.bump = {};
      this.rows = 16; this.risk = 'medium'; this.table = [];
      this.skin = null;
      this.dpr = 1; this.W = 1; this.H = 1;
      this.reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.stars = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), s: Math.random() * 1.2 + 0.3, tw: Math.random() * TAU }));
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
    setBoard(rows, risk, table) { this.rows = rows; this.risk = risk; this.table = table; this.bump = {}; }

    // ---------- Géométrie ----------
    geo() {
      const n = this.rows, W = this.W, H = this.H;
      const s = Math.min((W - 16) / (n + 1.6), (H - 12) / (n * 0.9 + 3.1)); // écart entre deux picots
      const vy = s * 0.9, top = Math.max(8, (H - (n * vy + 3.1 * s)) / 2) + s * 1.1;
      const cx = W / 2;
      return {
        s, vy, top, cx, n,
        pegR: Math.max(1.6, s * 0.11), ballR: Math.max(3, s * 0.24),
        pegX: (i, j) => cx + (j - (i + 2) / 2) * s,
        pegY: (i) => top + i * vy,
        slotX: (k) => cx + (k - n / 2) * s,
        slotY: top + (n - 1) * vy + s * 0.95, slotW: s * 0.9, slotH: s * 0.72,
      };
    }

    // ---------- Billes ----------
    /** Ajoute une bille. path : directions (0/1) ; at : heure de départ ; id : identifiant. */
    drop(ball) {
      ball.dur = durationOf(ball.rows);
      ball.wobble = (Math.random() - 0.5) * 0.18;
      ball.hits = -1;
      ball.trail = [];
      this.balls.push(ball);
    }
    /** Position de la bille à l'instant t (en unités du plateau). */
    posOf(b, t, g) {
      const step = STEP_MS(b.rows), e = t - b.at;
      const n = b.rows;
      // décalage horizontal (en écarts) avant la rangée i
      const off = (i) => { let o = 0; for (let k = 0; k < i; k++) o += b.path[k] ? 0.5 : -0.5; return o; };
      const contactY = (i) => g.pegY(i) - g.pegR - g.ballR * 0.9;
      if (e < step * 0.6) { // entrée : la bille tombe du haut vers le premier picot
        const u = clamp(e / (step * 0.6), 0, 1);
        return { x: g.cx + b.wobble * g.s, y: g.top - g.s * 1.05 + (contactY(0) - g.top + g.s * 1.05) * u * u, row: -1 };
      }
      const k = (e - step * 0.6) / step; // rebonds
      const i = Math.floor(k), u = k - i;
      if (i < n) {
        const x0 = g.cx + (off(i) + (i === 0 ? b.wobble : 0)) * g.s, x1 = g.cx + off(i + 1) * g.s;
        const y0 = contactY(i);
        const y1 = i + 1 < n ? contactY(i + 1) : g.slotY - g.slotH * 0.15;
        const ease = u * u * (3 - 2 * u);
        const hop = g.s * (0.32 - 0.008 * n);
        return { x: x0 + (x1 - x0) * (0.15 * u + 0.85 * ease), y: y0 + (y1 - y0) * u * u - hop * 4 * u * (1 - u), row: i };
      }
      // dans la case
      const x = g.cx + off(n) * g.s, u2 = clamp((k - n) / 0.6, 0, 1);
      return { x, y: g.slotY - g.slotH * 0.15 + g.slotH * 0.35 * u2, row: n, done: u2 >= 1 };
    }

    start(onPeg) {
      this.onPeg = onPeg;
      const loop = (now) => { this.raf = requestAnimationFrame(loop); try { this.frame(now); } catch (e) { /* une image ratée ne bloque pas l'animation */ } };
      this.raf = requestAnimationFrame(loop);
    }

    // ---------- Couleurs des cases ----------
    slotColor(k) {
      const n = this.rows, d = Math.abs(k - n / 2) / (n / 2); // 0 au centre, 1 au bord
      const stops = [[34, 211, 238], [99, 102, 241], [168, 85, 247], [244, 114, 182], [251, 191, 36]];
      const p = d * (stops.length - 1), a = Math.floor(p), f = p - a, A = stops[a], B = stops[Math.min(stops.length - 1, a + 1)];
      return A.map((v, i) => Math.round(v + (B[i] - v) * f));
    }

    frame(now) {
      const c = this.cx, W = this.W, H = this.H, dpr = this.dpr;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, W, H);
      if (W < 60 || H < 60) return; // plateau caché (écran de choix du mode)
      const g = this.geo();
      // étoiles du fond
      this.stars.forEach((st) => {
        const a = 0.25 + 0.25 * Math.sin(now / 900 + st.tw);
        c.fillStyle = 'rgba(200,210,255,' + a + ')';
        c.fillRect(st.x * W, st.y * H, st.s, st.s);
      });
      // lueur derrière le plateau
      const glow = c.createRadialGradient(g.cx, g.top + g.n * g.vy * 0.55, 0, g.cx, g.top + g.n * g.vy * 0.55, g.n * g.s * 0.75);
      glow.addColorStop(0, 'rgba(99,102,241,.16)'); glow.addColorStop(1, 'rgba(99,102,241,0)');
      c.fillStyle = glow; c.fillRect(0, 0, W, H);

      // billes : avancement, contacts avec les picots
      const live = [];
      this.balls.forEach((b) => {
        const p = this.posOf(b, now, g);
        if (p.row > b.hits && p.row >= 0 && p.row < b.rows) {
          for (let r = b.hits + 1; r <= p.row; r++) {
            let o = 0; for (let q = 0; q < r; q++) o += b.path[q] ? 0.5 : -0.5;
            const j = Math.round(o + (r + 2) / 2);
            this.flashes.push({ i: r, j, at: now });
            if (this.onPeg && r === p.row) this.onPeg(r, b.rows);
          }
          b.hits = p.row;
        }
        if (p.row >= b.rows && !b.landedFx) {
          b.landedFx = true;
          this.bump[b.slot] = now;
          if (b.label) this.labels.push({ x: g.slotX(b.slot), y: g.slotY - g.slotH, text: b.label, good: b.mult >= 1, big: b.mult >= 10, at: now });
          if (b.mult >= 2 && !this.reduced) {
            const [r0, g0, b0] = this.slotColor(b.slot);
            for (let q = 0; q < (b.mult >= 10 ? 26 : 12); q++) {
              const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, v = (Math.random() * 0.12 + 0.05) * g.s;
              this.sparks.push({ x: g.slotX(b.slot), y: g.slotY, vx: Math.cos(a) * v, vy: Math.sin(a) * v, at: now, col: r0 + ',' + g0 + ',' + b0 });
            }
          }
        }
        b.trail.push({ x: p.x, y: p.y }); if (b.trail.length > 7) b.trail.shift();
        b.p = p;
        if (!p.done || now - b.at < b.dur + 250) live.push(b);
      });
      this.balls = live;

      // picots
      this.flashes = this.flashes.filter((f) => now - f.at < 380);
      const lit = {};
      this.flashes.forEach((f) => { const key = f.i + ':' + f.j; lit[key] = Math.max(lit[key] || 0, 1 - (now - f.at) / 380); });
      for (let i = 0; i < g.n; i++) {
        for (let j = 0; j < i + 3; j++) {
          const x = g.pegX(i, j), y = g.pegY(i), l = lit[i + ':' + j] || 0;
          if (l > 0) {
            c.fillStyle = 'rgba(244,114,182,' + (0.35 * l) + ')';
            c.beginPath(); c.arc(x, y, g.pegR * (2.2 + 2.5 * (1 - l)), 0, TAU); c.fill();
          }
          c.shadowColor = l > 0 ? '#f472b6' : 'rgba(165,180,252,.8)'; c.shadowBlur = l > 0 ? 14 : 6;
          c.fillStyle = l > 0 ? '#fdf2f8' : '#dbe4ff';
          c.beginPath(); c.arc(x, y, g.pegR * (1 + 0.5 * l), 0, TAU); c.fill();
        }
      }
      c.shadowBlur = 0;

      // cases
      const fs = Math.max(7, Math.min(14, g.slotW * 0.34));
      c.font = '800 ' + fs + 'px Inter, system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      for (let k = 0; k <= g.n; k++) {
        const [r0, g0, b0] = this.slotColor(k), m = this.table[k];
        const bt = this.bump[k] ? clamp(1 - (now - this.bump[k]) / 320, 0, 1) : 0;
        const x = g.slotX(k) - g.slotW / 2, y = g.slotY + bt * g.slotH * 0.28, w = g.slotW, h = g.slotH;
        const grd = c.createLinearGradient(0, y, 0, y + h);
        grd.addColorStop(0, 'rgba(' + r0 + ',' + g0 + ',' + b0 + ',' + (0.95) + ')');
        grd.addColorStop(1, 'rgba(' + Math.round(r0 * 0.55) + ',' + Math.round(g0 * 0.55) + ',' + Math.round(b0 * 0.55) + ',1)');
        c.shadowColor = 'rgba(' + r0 + ',' + g0 + ',' + b0 + ',' + (0.5 + bt * 0.5) + ')'; c.shadowBlur = 8 + bt * 22;
        c.fillStyle = grd;
        roundRect(c, x, y, w, h, Math.min(6, w * 0.18)); c.fill();
        c.shadowBlur = 0;
        c.fillStyle = 'rgba(255,255,255,.18)'; roundRect(c, x + 1, y + 1, w - 2, h * 0.38, Math.min(5, w * 0.16)); c.fill();
        if (m != null) {
          c.fillStyle = '#0b0b25';
          const txt = m >= 100 ? String(m) : m >= 10 ? String(m) : String(m).replace('.', ',');
          c.fillText(txt + (g.slotW > 30 ? '×' : ''), x + w / 2, y + h / 2 + 1);
        }
      }

      // étincelles
      this.sparks = this.sparks.filter((sp) => now - sp.at < 700);
      this.sparks.forEach((sp) => {
        const t = (now - sp.at) / 16, a = 1 - (now - sp.at) / 700;
        c.fillStyle = 'rgba(' + sp.col + ',' + a + ')';
        c.beginPath(); c.arc(sp.x + sp.vx * t, sp.y + sp.vy * t + 0.004 * g.s * t * t, Math.max(1, g.s * 0.06), 0, TAU); c.fill();
      });

      // billes
      const sk = (this.skin && this.skin.c) || ['#f472b6', '#fff0f7', '#ec4899'];
      this.balls.forEach((b) => {
        const p = b.p; if (!p || p.done) return;
        b.trail.forEach((q, n) => {
          c.fillStyle = hexA(sk[2], (n + 1) / b.trail.length * 0.22);
          c.beginPath(); c.arc(q.x, q.y, g.ballR * (0.4 + 0.5 * n / b.trail.length), 0, TAU); c.fill();
        });
        c.shadowColor = sk[2]; c.shadowBlur = 16;
        const rg = c.createRadialGradient(p.x - g.ballR * 0.35, p.y - g.ballR * 0.4, g.ballR * 0.1, p.x, p.y, g.ballR);
        rg.addColorStop(0, sk[1]); rg.addColorStop(0.45, sk[0]); rg.addColorStop(1, sk[2]);
        c.fillStyle = rg; c.beginPath(); c.arc(p.x, p.y, g.ballR, 0, TAU); c.fill();
        c.shadowBlur = 0;
      });

      // gains qui montent au-dessus des cases
      this.labels = this.labels.filter((l) => now - l.at < 1300);
      this.labels.forEach((l) => {
        const u = (now - l.at) / 1300;
        c.globalAlpha = 1 - u * u;
        c.font = '900 ' + Math.round(fs * (l.big ? 1.5 : 1.15)) + 'px Inter, system-ui, sans-serif';
        c.fillStyle = l.good ? (l.big ? '#fde68a' : '#6ee7b7') : '#fda4af';
        c.shadowColor = 'rgba(0,0,0,.7)'; c.shadowBlur = 6;
        c.fillText(l.text, l.x, l.y - u * g.s * 1.6);
        c.shadowBlur = 0; c.globalAlpha = 1;
      });
    }
  }
  function roundRect(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  function hexA(hex, a) {
    const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  PlinkoScene.durationOf = durationOf;
  root.PlinkoScene = PlinkoScene;
})(window);
