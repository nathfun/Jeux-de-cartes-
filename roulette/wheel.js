/*
 * Roue de roulette européenne dessinée sur un canvas, avec la bille.
 *
 * Animation d'un lancer (durée T) :
 *  - la roue tourne dans un sens, plus vite au lancer puis revient à sa vitesse de repos ;
 *  - la bille est lancée en sens inverse sur la piste, ralentit, descend vers les losanges,
 *    rebondit, puis tombe dans la case du numéro tiré et tourne avec la roue.
 * Le numéro est choisi avant l'animation : la trajectoire de la bille est calculée pour arriver
 * exactement dans sa case (angle relatif à la roue qui tend vers 0 en douceur).
 */
(function (root) {
  'use strict';
  const B = root.RouletteBets;
  const N = B.WHEEL.length;
  const STEP = (Math.PI * 2) / N;
  const TAU = Math.PI * 2;
  const IDLE = 0.32; // vitesse de repos de la roue (rad/s)

  function RouletteWheel(canvas, opts) {
    this.canvas = canvas;
    this.opts = opts || {};
    this.phi = Math.random() * TAU; // angle de la roue
    this.ball = null;               // { pocket, rel, r } : bille posée (null = pas de bille)
    this.anim = null;
    this.highlight = -1;
    this.last = performance.now();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    const loop = (t) => { this.frame(t); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  RouletteWheel.prototype.resize = function () {
    const css = this.canvas.getBoundingClientRect().width || 320;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.size = Math.round(css * dpr);
    this.canvas.width = this.canvas.height = this.size;
    this.bowl = this.renderBowl(this.size);
    this.wheelImg = this.renderWheel(this.size);
  };

  // ---------- Dessin des parties fixes ----------
  RouletteWheel.prototype.geom = function (S) {
    const R = S / 2;
    return {
      c: R, R,
      rim: R * 0.985, track: R * 0.86, trackIn: R * 0.74,       // cuvette et piste de la bille
      ballTrack: R * 0.80, deflect: R * 0.715,                    // rayons de la bille
      pocketOut: R * 0.66, pocketIn: R * 0.5, numR: R * 0.61,    // cases et numéros
      pocketBall: R * 0.545, cone: R * 0.48, turret: R * 0.12,
      ballSize: Math.max(3, R * 0.034),
    };
  };

  RouletteWheel.prototype.renderBowl = function (S) {
    const cv = document.createElement('canvas'); cv.width = cv.height = S;
    const x = cv.getContext('2d'), g = this.geom(S), c = g.c;
    // bois de la cuvette
    let gr = x.createRadialGradient(c, c, g.track * 0.9, c, c, g.rim);
    gr.addColorStop(0, '#6b3d1c'); gr.addColorStop(0.6, '#4a2610'); gr.addColorStop(1, '#2a1406');
    x.fillStyle = gr; x.beginPath(); x.arc(c, c, g.rim, 0, TAU); x.fill();
    // liseré doré
    x.strokeStyle = '#c9a24a'; x.lineWidth = S * 0.006; x.beginPath(); x.arc(c, c, g.rim * 0.985, 0, TAU); x.stroke();
    // piste de la bille (bois verni clair)
    gr = x.createRadialGradient(c, c, g.trackIn, c, c, g.track);
    gr.addColorStop(0, '#8a5a2e'); gr.addColorStop(0.5, '#c08a4e'); gr.addColorStop(1, '#7a4a22');
    x.fillStyle = gr; x.beginPath(); x.arc(c, c, g.track, 0, TAU); x.arc(c, c, g.trackIn, 0, TAU, true); x.fill();
    // losanges déflecteurs
    for (let k = 0; k < 8; k++) {
      const a = k * TAU / 8 + (k % 2 ? 0.2 : 0);
      x.save(); x.translate(c + Math.cos(a) * g.deflect * 1.04, c + Math.sin(a) * g.deflect * 1.04); x.rotate(a);
      x.fillStyle = '#e8d08a'; x.strokeStyle = '#8a6a20'; x.lineWidth = 1;
      x.beginPath(); x.moveTo(-S * 0.022, 0); x.lineTo(0, -S * 0.009); x.lineTo(S * 0.022, 0); x.lineTo(0, S * 0.009); x.closePath(); x.fill(); x.stroke();
      x.restore();
    }
    return cv;
  };

  RouletteWheel.prototype.renderWheel = function (S) {
    const cv = document.createElement('canvas'); cv.width = cv.height = S;
    const x = cv.getContext('2d'), g = this.geom(S), c = g.c;
    // anneau des numéros + cases
    for (let i = 0; i < N; i++) {
      const n = B.WHEEL[i];
      const a0 = -Math.PI / 2 + i * STEP - STEP / 2, a1 = a0 + STEP;
      const col = B.color(n) === 'red' ? '#b3171b' : B.color(n) === 'black' ? '#141414' : '#0d7a3e';
      x.fillStyle = col;
      x.beginPath(); x.arc(c, c, g.pocketOut + S * 0.035, a0, a1); x.arc(c, c, g.pocketIn, a1, a0, true); x.closePath(); x.fill();
      // numéro
      x.save(); x.translate(c, c); x.rotate(a0 + STEP / 2 + Math.PI / 2);
      x.fillStyle = '#fff'; x.font = '700 ' + Math.round(S * 0.034) + 'px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(String(n), 0, -(g.numR + S * 0.025));
      x.restore();
    }
    // cases (fond creux plus sombre) et séparateurs dorés
    x.fillStyle = 'rgba(0,0,0,.28)';
    x.beginPath(); x.arc(c, c, g.pocketOut - S * 0.035, 0, TAU); x.arc(c, c, g.pocketIn, 0, TAU, true); x.fill();
    x.strokeStyle = '#d8b65a'; x.lineWidth = Math.max(1, S * 0.004);
    for (let i = 0; i < N; i++) {
      const a = -Math.PI / 2 + i * STEP - STEP / 2;
      x.beginPath(); x.moveTo(c + Math.cos(a) * g.pocketIn, c + Math.sin(a) * g.pocketIn);
      x.lineTo(c + Math.cos(a) * (g.pocketOut + S * 0.035), c + Math.sin(a) * (g.pocketOut + S * 0.035)); x.stroke();
    }
    x.beginPath(); x.arc(c, c, g.pocketOut + S * 0.035, 0, TAU); x.stroke();
    x.beginPath(); x.arc(c, c, g.pocketOut - S * 0.035, 0, TAU); x.stroke();
    // cône central
    let gr = x.createRadialGradient(c - S * 0.05, c - S * 0.05, S * 0.02, c, c, g.cone);
    gr.addColorStop(0, '#9a6a3a'); gr.addColorStop(0.7, '#5a3416'); gr.addColorStop(1, '#3a1f0b');
    x.fillStyle = gr; x.beginPath(); x.arc(c, c, g.pocketIn, 0, TAU); x.fill();
    x.strokeStyle = '#c9a24a'; x.lineWidth = S * 0.005; x.beginPath(); x.arc(c, c, g.pocketIn, 0, TAU); x.stroke();
    // tourelle dorée en croix
    x.strokeStyle = '#d8b65a'; x.lineCap = 'round'; x.lineWidth = S * 0.018;
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2;
      x.beginPath(); x.moveTo(c, c); x.lineTo(c + Math.cos(a) * g.turret * 2.2, c + Math.sin(a) * g.turret * 2.2); x.stroke();
      x.fillStyle = '#f0d27a'; x.beginPath(); x.arc(c + Math.cos(a) * g.turret * 2.2, c + Math.sin(a) * g.turret * 2.2, S * 0.016, 0, TAU); x.fill();
    }
    gr = x.createRadialGradient(c - S * 0.015, c - S * 0.015, 1, c, c, g.turret);
    gr.addColorStop(0, '#fff3c4'); gr.addColorStop(1, '#b8902e');
    x.fillStyle = gr; x.beginPath(); x.arc(c, c, g.turret * 0.7, 0, TAU); x.fill();
    return cv;
  };

  // ---------- Animation ----------
  const idx = (n) => B.WHEEL.indexOf(n);
  const pocketAngle = (n) => -Math.PI / 2 + idx(n) * STEP;
  const smooth = (u) => u * u * (3 - 2 * u);

  /**
   * Lance la bille ; elle finira dans la case de `result`.
   * opts.duration (ms, 9000 par défaut), opts.elapsed (ms déjà écoulées, pour rejoindre un lancer en cours).
   * Renvoie une promesse résolue quand la bille est posée.
   */
  RouletteWheel.prototype.spin = function (result, opts) {
    opts = opts || {};
    const T = (opts.duration || 9000) / 1000;
    const revs = 7 + Math.random() * 2;      // tours de la bille par rapport à la roue
    this.highlight = -1;
    this.ball = { pocket: result, rel: 0, r: 0 };
    const start = performance.now() - (opts.elapsed || 0);
    const clacks = [0.6, 0.655, 0.7, 0.74, 0.775, 0.81, 0.835, 0.86, 0.88];
    this.anim = { result, T, F: revs * TAU, start, phi0: this.phi, clacks, nextClack: 0, onDone: null, rolling: false };
    // on rejoint un lancer déjà commencé : on saute les sons passés
    const u0 = (opts.elapsed || 0) / 1000 / T;
    while (this.anim.nextClack < clacks.length && clacks[this.anim.nextClack] < u0) this.anim.nextClack++;
    if (u0 < 0.55 && window.Sfx && Sfx.rouletteRoll) { Sfx.rouletteRoll(T * (0.62 - u0)); this.anim.rolling = true; }
    return new Promise((res) => { this.anim.onDone = res; if (u0 >= 1) this.finish(); });
  };

  RouletteWheel.prototype.finish = function () {
    const a = this.anim;
    if (!a) return;
    this.anim = null;
    this.ball = { pocket: a.result, rel: 0, r: 1 };
    this.highlight = a.result;
    if (window.Sfx && Sfx.clack) Sfx.clack(0.5);
    if (a.onDone) a.onDone(a.result);
  };

  /** Pose directement la bille dans une case (arrivée en cours de partie). */
  RouletteWheel.prototype.place = function (n) { this.anim = null; this.ball = { pocket: n, rel: 0, r: 1 }; this.highlight = n; };
  RouletteWheel.prototype.clear = function () { if (!this.anim) { this.ball = null; this.highlight = -1; } };

  RouletteWheel.prototype.frame = function (now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const S = this.size, x = this.canvas.getContext('2d'), g = this.geom(S), c = g.c;
    let rel = 0, radius = g.pocketBall, jitter = 0;
    const a = this.anim;
    if (a) {
      const t = (now - a.start) / 1000;
      const u = Math.min(1, t / a.T);
      // roue : plus rapide au lancer, puis revient au repos
      this.phi = a.phi0 + IDLE * t + 3.6 * (1 - Math.exp(-t / 3));
      // bille : angle relatif à la roue qui décroît vers 0 (sens inverse au départ)
      rel = a.F * Math.pow(1 - u, 3);
      // rayon : piste → losanges → case, avec des rebonds
      if (u < 0.55) radius = g.ballTrack;
      else if (u < 0.88) {
        const v = (u - 0.55) / 0.33;
        const base = g.ballTrack + (g.pocketBall - g.ballTrack) * smooth(v);
        const bounce = Math.abs(Math.sin(v * Math.PI * 6)) * (1 - v) * S * 0.035;
        radius = base + bounce;
        jitter = Math.sin(v * 31) * (1 - v) * 0.12;
      } else radius = g.pocketBall + Math.abs(Math.sin((u - 0.88) * 60)) * (1 - u) * S * 0.01;
      while (a.nextClack < a.clacks.length && u >= a.clacks[a.nextClack]) {
        if (window.Sfx && Sfx.clack) Sfx.clack(0.9 - a.nextClack * 0.08);
        a.nextClack++;
      }
      if (u >= 1) this.finish();
    } else {
      this.phi += IDLE * dt;
    }
    this.phi %= TAU;
    // dessin
    x.clearRect(0, 0, S, S);
    x.drawImage(this.bowl, 0, 0);
    x.save(); x.translate(c, c); x.rotate(this.phi); x.drawImage(this.wheelImg, -c, -c);
    if (this.highlight >= 0) { // case gagnante en surbrillance
      const pa = pocketAngle(this.highlight);
      x.strokeStyle = 'rgba(255, 230, 120, .95)'; x.lineWidth = S * 0.012;
      x.beginPath(); x.arc(0, 0, (g.pocketOut + g.pocketIn) / 2 + S * 0.01, pa - STEP / 2, pa + STEP / 2); x.stroke();
    }
    x.restore();
    if (this.ball) {
      const ang = this.phi + pocketAngle(this.ball.pocket) + rel + jitter;
      const bx = c + Math.cos(ang) * radius, by = c + Math.sin(ang) * radius;
      x.fillStyle = 'rgba(0,0,0,.35)'; x.beginPath(); x.arc(bx + g.ballSize * 0.3, by + g.ballSize * 0.4, g.ballSize, 0, TAU); x.fill();
      const gr = x.createRadialGradient(bx - g.ballSize * 0.35, by - g.ballSize * 0.35, g.ballSize * 0.1, bx, by, g.ballSize);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#b9c0c8');
      x.fillStyle = gr; x.beginPath(); x.arc(bx, by, g.ballSize, 0, TAU); x.fill();
    }
  };

  root.RouletteWheel = RouletteWheel;
})(window);
