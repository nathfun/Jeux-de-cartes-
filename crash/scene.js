/*
 * Rocket Crash — rendu de la scène (canvas), indépendant de la logique du jeu.
 * La boucle d'affichage lit l'état fourni par getState() à chaque image :
 *   { phase: 'countdown' | 'launch' | 'flight' | 'crashed', t: ms de vol, m: multiplicateur exact,
 *     cd: secondes avant décollage, cdTotal, markers: [{ t, m, text }] }
 * Elle ne décide de rien : si elle ralentit, le jeu continue au même rythme.
 */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);

  class CrashScene {
    constructor(canvas, engine) {
      this.cv = canvas;
      this.cx = canvas.getContext('2d');
      this.E = engine;
      this.particles = [];
      this.stars = [];
      this.clouds = [];
      this.flash = 0; this.shake = 0; this.wave = null; this.lastPhase = null; this.lastT = 0;
      this.dpr = 1; this.W = 0; this.H = 0;
      this.reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.resize();
      if (window.ResizeObserver) new ResizeObserver(() => this.resize()).observe(canvas);
      else window.addEventListener('resize', () => this.resize());
      for (let i = 0; i < 140; i++) this.stars.push(this.newStar(true));
      this.resetClouds();
    }
    resize() {
      const r = this.cv.getBoundingClientRect();
      this.dpr = Math.min(2, window.devicePixelRatio || 1);
      this.W = Math.max(1, r.width); this.H = Math.max(1, r.height);
      this.cv.width = Math.round(this.W * this.dpr); this.cv.height = Math.round(this.H * this.dpr);
    }
    newStar(anywhere) {
      const layer = Math.random() < 0.6 ? 1 : Math.random() < 0.7 ? 2 : 3;
      return { x: Math.random(), y: anywhere ? Math.random() : -0.02, layer, s: layer * 0.55 + Math.random() * 0.6, tw: Math.random() * TAU };
    }
    resetClouds() {
      this.clouds = [];
      for (let i = 0; i < 5; i++) this.clouds.push({ x: rand(-0.1, 1), y: rand(0.62, 0.95), w: rand(0.22, 0.42), h: rand(0.05, 0.09), a: rand(0.08, 0.16) });
    }
    start(getState) {
      this.getState = getState;
      const loop = (now) => { this.frame(now); this.raf = requestAnimationFrame(loop); };
      this.raf = requestAnimationFrame(loop);
    }

    // ---------- Repère du graphique ----------
    plot(st) {
      const W = this.W, H = this.H;
      const pad = { l: Math.max(38, W * 0.06), r: Math.max(18, W * 0.05), t: Math.max(24, H * 0.1), b: Math.max(30, H * 0.11) };
      const t = Math.max(0, st.t || 0), m = Math.max(1, st.m || 1);
      const xMax = Math.max(9000, t * 1.18);
      const yMax = Math.max(2, 1 + (m - 1) * 1.3);
      const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
      return {
        pad, xMax, yMax, pw, ph,
        x: (tt) => pad.l + (tt / xMax) * pw,
        y: (mm) => H - pad.b - ((mm - 1) / (yMax - 1)) * ph,
      };
    }

    frame(now) {
      const st = this.getState ? this.getState() : { phase: 'countdown' };
      const dt = Math.min(0.05, Math.max(0, (now - (this.lastT || now)) / 1000));
      this.lastT = now;
      const c = this.cx, W = this.W, H = this.H;
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

      // transitions d'état
      if (st.phase !== this.lastPhase) {
        if (st.phase === 'crashed') this.boom(st);
        if (st.phase === 'countdown') { this.resetClouds(); this.wave = null; }
        this.lastPhase = st.phase;
      }
      const flying = st.phase === 'flight';
      const m = st.m || 1;
      // vitesse apparente : dérivée du multiplicateur (accélère avec lui)
      const speed = flying ? Math.min(9, 0.6 + Math.log(m) * 2.2) : st.phase === 'launch' ? 0.35 : 0.08;

      // tremblement (explosion)
      let sx = 0, sy = 0;
      if (this.shake > 0) { sx = rand(-1, 1) * this.shake; sy = rand(-1, 1) * this.shake; this.shake *= Math.pow(0.02, dt); if (this.shake < 0.3) this.shake = 0; }
      c.save();
      c.translate(sx, sy);

      // ciel : dégradé bleu nuit qui s'assombrit et vire au violet avec l'altitude
      const alt = Math.min(1, Math.log(m) / Math.log(30));
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, mix('#050816', '#0a0420', alt));
      g.addColorStop(0.55, mix('#0b1440', '#1b0d45', alt));
      g.addColorStop(1, mix('#1a2a6c', '#2a0f4f', alt));
      c.fillStyle = g; c.fillRect(-20, -20, W + 40, H + 40);
      // halo de nébuleuse
      const neb = c.createRadialGradient(W * 0.75, H * 0.25, 10, W * 0.75, H * 0.25, Math.max(W, H) * 0.6);
      neb.addColorStop(0, 'rgba(139,92,246,' + (0.12 + alt * 0.18) + ')'); neb.addColorStop(1, 'rgba(139,92,246,0)');
      c.fillStyle = neb; c.fillRect(0, 0, W, H);

      // étoiles : elles défilent vers le bas-gauche, de plus en plus vite
      this.stars.forEach((s, i) => {
        const v = speed * s.layer * 0.045 * dt * (this.reduced ? 0.3 : 1);
        s.y += v; s.x -= v * 0.45;
        if (s.y > 1.02 || s.x < -0.02) this.stars[i] = Object.assign(this.newStar(false), Math.random() < 0.5 ? { x: rand(0, 1.2), y: -0.02 } : { x: 1.02, y: rand(0, 1) });
        s.tw += dt * 3;
        const a = 0.35 + 0.35 * Math.sin(s.tw) + s.layer * 0.1;
        const px = s.x * W, py = s.y * H;
        if (speed > 2.5 && s.layer > 1) { // traînées de vitesse
          c.strokeStyle = 'rgba(165,243,252,' + Math.min(0.5, a * 0.6) + ')'; c.lineWidth = s.s * 0.7;
          c.beginPath(); c.moveTo(px, py); c.lineTo(px + speed * s.layer * 2.2, py - speed * s.layer * 4.5); c.stroke();
        } else {
          c.fillStyle = 'rgba(255,255,255,' + Math.min(1, a) + ')';
          c.beginPath(); c.arc(px, py, s.s, 0, TAU); c.fill();
        }
      });

      // nuages bas : ils restent sur la plateforme puis tombent sous l'écran au décollage
      this.clouds.forEach((cl) => {
        if (flying || st.phase === 'launch') cl.y += speed * 0.06 * dt;
        cl.x -= dt * 0.006;
        if (cl.x + cl.w < -0.1) cl.x = 1.05;
        if (cl.y > 1.3) return;
        const cx0 = cl.x * W, cy0 = cl.y * H, rw = cl.w * W, rh = cl.h * H;
        const cg = c.createRadialGradient(cx0, cy0, 2, cx0, cy0, rw);
        cg.addColorStop(0, 'rgba(148,163,255,' + cl.a + ')'); cg.addColorStop(1, 'rgba(148,163,255,0)');
        c.fillStyle = cg; c.beginPath(); c.ellipse(cx0, cy0, rw, rh, 0, 0, TAU); c.fill();
      });

      const P = this.plot(st);
      this.drawGrid(P);

      // plateforme de lancement
      const padX = P.x(0), padY = P.y(1);
      if (st.phase === 'countdown' || st.phase === 'launch' || (flying && st.t < 2500)) this.drawPad(padX, padY, flying ? Math.min(1, st.t / 2500) : 0);

      // courbe du vol
      if (flying || st.phase === 'crashed') this.drawCurve(P, st);

      // fusée
      let rx = padX + 4, ry = padY - 4, ang = -Math.PI / 4, flame = 0;
      if (st.phase === 'launch') { flame = 0.35 + 0.4 * (st.launch || 0); rx += rand(-1, 1) * 1.2; ry += rand(-1, 1) * 1.2; }
      if (flying) {
        const t = st.t, t2 = Math.max(0, t - 120);
        rx = P.x(t); ry = P.y(m);
        const px = P.x(t2), py = P.y(this.E.exactAt(t2));
        ang = Math.atan2(ry - py, rx - px);
        if (!(isFinite(ang))) ang = -Math.PI / 4;
        ang = Math.max(-Math.PI / 2 + 0.08, Math.min(-0.12, ang));
        flame = Math.min(1.6, 0.7 + Math.log(m) * 0.35);
      }
      this.rocketPos = { x: rx, y: ry, ang };
      if (flame > 0 && !this.reduced) this.emit(rx, ry, ang, flame, dt);
      this.drawParticles(dt);
      if (st.phase !== 'crashed') this.drawRocket(rx, ry, ang, Math.max(0.7, Math.min(1.15, W / 700)), flame, now);

      // repères de retrait
      (st.markers || []).forEach((mk) => this.drawMarker(P, mk));

      // onde de choc et flash
      if (this.wave) {
        this.wave.r += dt * 420; this.wave.a -= dt * 1.3;
        if (this.wave.a > 0) { c.strokeStyle = 'rgba(255,200,120,' + this.wave.a + ')'; c.lineWidth = 3; c.beginPath(); c.arc(this.wave.x, this.wave.y, this.wave.r, 0, TAU); c.stroke(); }
      }
      c.restore();
      if (this.flash > 0) { c.fillStyle = 'rgba(255,240,220,' + this.flash + ')'; c.fillRect(0, 0, W, H); this.flash = Math.max(0, this.flash - dt * 2.2); }

      // compte à rebours : anneau autour de la plateforme
      if (st.phase === 'countdown' && st.cdTotal) {
        const k = Math.max(0, Math.min(1, st.cd / st.cdTotal));
        c.strokeStyle = 'rgba(34,211,238,.85)'; c.lineWidth = 3; c.lineCap = 'round';
        c.beginPath(); c.arc(padX + 4, padY - 18, 30, -Math.PI / 2, -Math.PI / 2 + TAU * k); c.stroke();
      }
    }

    drawGrid(P) {
      const c = this.cx;
      c.font = '600 11px system-ui, sans-serif'; c.textBaseline = 'middle';
      const step = niceStep((P.yMax - 1) / 4);
      c.strokeStyle = 'rgba(148,163,255,.10)'; c.fillStyle = 'rgba(203,213,255,.45)'; c.lineWidth = 1;
      for (let v = 1; v <= P.yMax + 1e-9; v += step) {
        const y = P.y(v);
        c.beginPath(); c.moveTo(P.pad.l, y); c.lineTo(this.W - P.pad.r, y); c.stroke();
        c.textAlign = 'right'; c.fillText(v.toFixed(v < 10 ? 1 : 0) + '×', P.pad.l - 6, y);
      }
      const tstep = niceStep(P.xMax / 1000 / 5);
      c.textAlign = 'center'; c.textBaseline = 'top';
      for (let s = 0; s * 1000 <= P.xMax; s += tstep) c.fillText(s + ' s', P.x(s * 1000), this.H - P.pad.b + 8);
    }

    drawPad(x, y, leave) {
      const c = this.cx;
      c.globalAlpha = 1 - leave;
      const g = c.createLinearGradient(x - 40, 0, x + 50, 0);
      g.addColorStop(0, '#334155'); g.addColorStop(1, '#1e293b');
      c.fillStyle = g; c.fillRect(x - 36, y + 6, 80, 8);
      c.fillStyle = '#22d3ee'; c.shadowColor = '#22d3ee'; c.shadowBlur = 12;
      c.fillRect(x - 30, y + 6, 4, 3); c.fillRect(x + 34, y + 6, 4, 3);
      c.shadowBlur = 0;
      c.strokeStyle = 'rgba(148,163,184,.6)'; c.lineWidth = 2; c.beginPath(); c.moveTo(x - 26, y + 6); c.lineTo(x - 18, y - 26); c.stroke();
      c.globalAlpha = 1;
    }

    drawCurve(P, st) {
      const c = this.cx, crashed = st.phase === 'crashed';
      const tEnd = Math.max(0, st.t);
      const n = 70;
      c.beginPath();
      for (let i = 0; i <= n; i++) {
        const tt = (tEnd * i) / n, x = P.x(tt), y = P.y(this.E.exactAt(tt));
        if (i) c.lineTo(x, y); else c.moveTo(x, y);
      }
      // zone colorée sous la courbe
      c.save();
      const area = new Path2D();
      area.moveTo(P.x(0), P.y(1));
      for (let i = 0; i <= n; i++) { const tt = (tEnd * i) / n; area.lineTo(P.x(tt), P.y(this.E.exactAt(tt))); }
      area.lineTo(P.x(tEnd), P.y(1)); area.closePath();
      const ag = c.createLinearGradient(P.x(0), 0, P.x(tEnd) + 1, 0);
      ag.addColorStop(0, 'rgba(139,92,246,0)'); ag.addColorStop(1, crashed ? 'rgba(255,77,109,.22)' : 'rgba(34,211,238,.2)');
      c.fillStyle = ag; c.fill(area);
      c.restore();
      const lg = c.createLinearGradient(P.x(0), 0, P.x(tEnd) + 1, 0);
      if (crashed) { lg.addColorStop(0, '#9f1239'); lg.addColorStop(1, '#ff4d6d'); } else { lg.addColorStop(0, '#8b5cf6'); lg.addColorStop(0.6, '#3b82f6'); lg.addColorStop(1, '#22d3ee'); }
      c.strokeStyle = lg; c.lineWidth = 4; c.lineCap = 'round'; c.lineJoin = 'round';
      c.shadowColor = crashed ? '#ff4d6d' : '#22d3ee'; c.shadowBlur = 16;
      c.stroke();
      c.shadowBlur = 0;
    }

    drawRocket(x, y, ang, s, flame, now) {
      const c = this.cx;
      c.save();
      c.translate(x, y); c.rotate(ang + Math.PI / 2); c.scale(s, s);
      // flamme (vers l'arrière, axe +y)
      if (flame > 0) {
        const fl = 18 + flame * 26 + Math.sin(now / 35) * 4 + rand(-2, 2);
        const fg = c.createLinearGradient(0, 14, 0, 14 + fl);
        fg.addColorStop(0, 'rgba(255,255,255,.95)'); fg.addColorStop(0.25, 'rgba(255,209,102,.95)'); fg.addColorStop(0.6, 'rgba(255,122,0,.75)'); fg.addColorStop(1, 'rgba(244,63,94,0)');
        c.fillStyle = fg; c.shadowColor = '#ff9f1c'; c.shadowBlur = 25;
        c.beginPath(); c.moveTo(-7, 14); c.quadraticCurveTo(0, 14 + fl * 1.15, 7, 14); c.closePath(); c.fill();
        c.fillStyle = 'rgba(165,243,252,.9)'; c.beginPath(); c.moveTo(-3.5, 14); c.quadraticCurveTo(0, 14 + fl * 0.45, 3.5, 14); c.fill();
        c.shadowBlur = 0;
      }
      // ailerons
      c.fillStyle = '#7c3aed';
      c.beginPath(); c.moveTo(-8, 4); c.lineTo(-17, 18); c.lineTo(-8, 14); c.closePath(); c.fill();
      c.beginPath(); c.moveTo(8, 4); c.lineTo(17, 18); c.lineTo(8, 14); c.closePath(); c.fill();
      // corps
      const bg = c.createLinearGradient(-9, 0, 9, 0);
      bg.addColorStop(0, '#cbd5e1'); bg.addColorStop(0.45, '#ffffff'); bg.addColorStop(1, '#94a3b8');
      c.fillStyle = bg;
      c.beginPath(); c.moveTo(0, -26); c.bezierCurveTo(10, -16, 10, 6, 8, 15); c.lineTo(-8, 15); c.bezierCurveTo(-10, 6, -10, -16, 0, -26); c.closePath(); c.fill();
      // nez
      c.fillStyle = '#ec4899';
      c.beginPath(); c.moveTo(0, -26); c.bezierCurveTo(6, -21, 7.5, -16, 7.8, -13); c.lineTo(-7.8, -13); c.bezierCurveTo(-7.5, -16, -6, -21, 0, -26); c.fill();
      // hublot
      c.fillStyle = '#0e7490'; c.beginPath(); c.arc(0, -4, 4.6, 0, TAU); c.fill();
      c.fillStyle = '#67e8f9'; c.shadowColor = '#22d3ee'; c.shadowBlur = 10; c.beginPath(); c.arc(0, -4, 3, 0, TAU); c.fill(); c.shadowBlur = 0;
      c.fillStyle = 'rgba(255,255,255,.8)'; c.beginPath(); c.arc(-1, -5, 1, 0, TAU); c.fill();
      // tuyère
      c.fillStyle = '#475569'; c.fillRect(-5.5, 13, 11, 4);
      c.restore();
    }

    emit(x, y, ang, k, dt) {
      const back = ang + Math.PI;
      const n = Math.min(6, Math.round(60 * dt * (1 + k)));
      for (let i = 0; i < n; i++) {
        const a = back + rand(-0.35, 0.35), v = rand(40, 120) * (0.6 + k * 0.5);
        const ox = x + Math.cos(back) * 20, oy = y + Math.sin(back) * 20;
        if (Math.random() < 0.55) this.particles.push({ x: ox, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.25, 0.5), max: 0.5, r: rand(1.2, 2.6), col: Math.random() < 0.5 ? '255,183,3' : '255,122,0', g: 0 });
        else this.particles.push({ x: ox, y: oy, vx: Math.cos(a) * v * 0.35, vy: Math.sin(a) * v * 0.35, life: rand(0.6, 1.2), max: 1.2, r: rand(3, 7), col: '148,163,255', smoke: true, g: -8 });
      }
      if (this.particles.length > 320) this.particles.splice(0, this.particles.length - 320);
    }

    boom(st) {
      const p = this.rocketPos || { x: this.W / 2, y: this.H / 2 };
      this.flash = this.reduced ? 0.25 : 0.75;
      this.shake = this.reduced ? 0 : 14;
      this.wave = { x: p.x, y: p.y, r: 8, a: 0.9 };
      const cols = ['255,255,255', '255,209,102', '255,159,28', '255,77,109', '244,114,182'];
      for (let i = 0; i < 130; i++) {
        const a = rand(0, TAU), v = rand(60, 420);
        this.particles.push({ x: p.x, y: p.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.6, 1.6), max: 1.6, r: rand(1.5, 4), col: cols[i % cols.length], g: 160 });
      }
      for (let i = 0; i < 40; i++) {
        const a = rand(0, TAU), v = rand(20, 120);
        this.particles.push({ x: p.x, y: p.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(1.2, 2.4), max: 2.4, r: rand(8, 20), col: '100,90,140', smoke: true, g: -10 });
      }
      // débris de la fusée
      for (let i = 0; i < 10; i++) {
        const a = rand(0, TAU), v = rand(80, 260);
        this.particles.push({ x: p.x, y: p.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, life: 2, max: 2, r: rand(2, 4), col: '203,213,225', debris: true, g: 260, rot: rand(0, TAU) });
      }
    }

    drawParticles(dt) {
      const c = this.cx;
      this.particles = this.particles.filter((p) => (p.life -= dt) > 0);
      this.particles.forEach((p) => {
        p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.985; p.vy *= 0.985;
        const a = Math.max(0, p.life / p.max);
        if (p.smoke) { c.fillStyle = 'rgba(' + p.col + ',' + a * 0.25 + ')'; c.beginPath(); c.arc(p.x, p.y, p.r * (1.6 - a * 0.6), 0, TAU); c.fill(); }
        else if (p.debris) { c.save(); c.translate(p.x, p.y); c.rotate((p.rot += dt * 8)); c.fillStyle = 'rgba(' + p.col + ',' + a + ')'; c.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); c.restore(); }
        else { c.fillStyle = 'rgba(' + p.col + ',' + a + ')'; c.beginPath(); c.arc(p.x, p.y, p.r * (0.5 + a * 0.5), 0, TAU); c.fill(); }
      });
    }

    drawMarker(P, mk) {
      const c = this.cx, x = P.x(mk.t), y = P.y(mk.m);
      if (!(x > 0 && y > 0)) return;
      c.fillStyle = '#34d399'; c.shadowColor = '#34d399'; c.shadowBlur = 12;
      c.beginPath(); c.arc(x, y, 5, 0, TAU); c.fill(); c.shadowBlur = 0;
      c.font = '800 12px system-ui, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'middle';
      const tw = c.measureText(mk.text).width + 14;
      const bx = Math.min(this.W - tw - 6, x + 8), by = Math.max(14, y - 22);
      c.fillStyle = 'rgba(6,78,59,.85)'; roundRect(c, bx, by - 11, tw, 22, 11); c.fill();
      c.fillStyle = '#a7f3d0'; c.fillText(mk.text, bx + 7, by);
    }
  }

  function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function niceStep(raw) {
    const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-6))));
    const n = raw / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
  }
  function mix(a, b, k) {
    const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16)), pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
    return 'rgb(' + pa.map((v, i) => Math.round(v + (pb[i] - v) * k)).join(',') + ')';
  }

  root.CrashScene = CrashScene;
})(window);
