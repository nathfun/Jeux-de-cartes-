/*
 * Bruitages des jeux, générés en direct (Web Audio), sans fichier à télécharger.
 *   Sfx.card()      carte distribuée (petit « flick » de papier)
 *   Sfx.flip()      carte retournée
 *   Sfx.chips()     jetons posés sur le tapis
 *   Sfx.win()       victoire (arpège montant)
 *   Sfx.lose()      défaite (deux notes descendantes)
 *   Sfx.push()      égalité
 *   Sfx.tick()      dernières secondes d'un minuteur
 *   Sfx.blackjack() voix féminine « Blackjack ! » (synthèse vocale), avec une fanfare
 * Un bouton 🔊 (élément #sound-toggle) coupe ou remet le son ; le choix est mémorisé.
 */
(function () {
  'use strict';
  let ctx = null, noise = null, master = null, rocket = null;
  let enabled = true;
  try { enabled = localStorage.getItem('sfx-on') !== '0'; } catch (e) { /* ignore */ }

  function ac() {
    if (!enabled) return null;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(ctx.destination);
      // bruit blanc réutilisé pour les cartes
      noise = ctx.createBuffer(1, ctx.sampleRate * 0.25, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  // Les navigateurs n'autorisent le son qu'après un geste de l'utilisateur
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => window.addEventListener(ev, () => { ac(); }, { passive: true }));

  function env(g, t, peak, attack, decay) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  function noiseBurst(t, freq, q, peak, decay) {
    const c = ctx;
    const src = c.createBufferSource();
    src.buffer = noise;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q;
    const g = c.createGain();
    env(g, t, peak, 0.003, decay);
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(t, Math.random() * 0.1, decay + 0.05);
  }

  function tone(t, freq, type, peak, attack, decay, glideTo) {
    const c = ctx;
    const o = c.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + attack + decay);
    const g = c.createGain();
    env(g, t, peak, attack, decay);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + attack + decay + 0.05);
  }

  let lastCard = 0;
  const buzz = (p) => { if (window.Casino) Casino.vibrate(p); };
  // ---------- Ambiances de la cinématique du Parrain (boucles qu'on arrête avec la fonction renvoyée) ----------
  let longNoise = null;
  function loopNoise(filterType, freq, q, gain) {
    if (!longNoise) { longNoise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = longNoise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    const src = ctx.createBufferSource(); src.buffer = longNoise; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, ctx.currentTime); g.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + 1.2);
    src.connect(f); f.connect(g); g.connect(master); src.start();
    return { stop() { const t = ctx.currentTime; g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6); src.stop(t + 0.7); } };
  }
  function drone(freqs, gain, cutoff) {
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, ctx.currentTime); g.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + 1.5);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cutoff || 400;
    lp.connect(g); g.connect(master);
    const os = freqs.map((f) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); o.start(); return o; });
    return { stop() { const t = ctx.currentTime; g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8); os.forEach((o) => o.stop(t + 0.9)); } };
  }
  function every(ms, fn) { fn(); const id = setInterval(fn, ms); return { stop() { clearInterval(id); } }; }

  const Sfx = {
    /** Ambiance d'une scène de la cinématique : 'rain', 'smoke', 'casino', 'deal', 'blood'. Renvoie { stop }. */
    ambience(kind) {
      if (!ac()) return { stop() {} };
      const parts = [];
      if (kind === 'rain') {
        parts.push(loopNoise('bandpass', 2600, 0.5, 0.14), loopNoise('lowpass', 400, 0.7, 0.06));
        parts.push(every(4200, () => { const t = ctx.currentTime + Math.random(); tone(t, 45, 'sine', 0.35, 0.3, 2.4, 30); noiseBurst(t, 120, 0.6, 0.12, 1.6); }));
      } else if (kind === 'smoke') {
        parts.push(drone([55, 55.4, 82.4], 0.07, 320));
        parts.push(every(2600, () => { const t = ctx.currentTime; tone(t, 196, 'triangle', 0.05, 0.4, 1.8); tone(t + 0.9, 233, 'triangle', 0.04, 0.4, 1.8); }));
      } else if (kind === 'casino') {
        parts.push(loopNoise('bandpass', 900, 0.4, 0.05));
        const notes = [261.6, 311.1, 392, 466.2, 523.3, 622.3];
        parts.push(every(300, () => { const t = ctx.currentTime; tone(t, notes[Math.floor(Math.random() * notes.length)], 'triangle', 0.07, 0.005, 0.35); if (Math.random() < 0.3) Sfx.chips(); }));
        parts.push(drone([65.4, 98], 0.05, 260));
      } else if (kind === 'deal') {
        parts.push(drone([73.4, 110, 146.8], 0.06, 380));
        setTimeout(() => { if (!ctx) return; const t = ctx.currentTime; tone(t, 1568, 'sine', 0.12, 0.002, 0.9); tone(t + 0.08, 2093, 'sine', 0.09, 0.002, 1.1); }, 700);
      } else if (kind === 'blood') {
        parts.push(drone([41.2, 43.6], 0.08, 200));
        parts.push(every(1100, () => Sfx.heartbeat()));
      }
      return { stop() { parts.forEach((x) => { try { x.stop(); } catch (e) { /* ignore */ } }); } };
    },
    /** Fanfare de victoire (palier réussi) : cuivres en arpège, accord final et cymbale. */
    fanfare() {
      if (!ac()) return;
      const t = ctx.currentTime;
      [[392, 0], [392, 0.12], [392, 0.24], [523.3, 0.36], [392, 0.62], [523.3, 0.74]].forEach(([f, d]) => { tone(t + d, f, 'sawtooth', 0.09, 0.01, 0.16); tone(t + d, f * 2, 'square', 0.025, 0.01, 0.12); });
      [523.3, 659.3, 784, 1046.5].forEach((f) => { tone(t + 0.95, f, 'sawtooth', 0.07, 0.03, 1.4); tone(t + 0.95, f * 1.003, 'triangle', 0.05, 0.03, 1.5); });
      noiseBurst(t + 0.95, 7000, 0.6, 0.18, 1.2); noiseBurst(t + 0.95, 3500, 0.8, 0.12, 0.8);
      tone(t + 0.95, 65.4, 'sine', 0.5, 0.005, 0.9, 40);
      buzz([40, 30, 40, 30, 160]);
    },
    /** Petit carillon (annonce dorée, succès, défi). */
    chime() {
      if (!ac()) return;
      const t = ctx.currentTime;
      [1318.5, 1760, 2637].forEach((f, i) => tone(t + i * 0.07, f, 'sine', 0.06, 0.004, 0.5));
    },
    /** Pièces qui tombent dans la caisse (gain). */
    coins() {
      if (!ac()) return;
      const t = ctx.currentTime;
      for (let k = 0; k < 5; k++) { tone(t + k * 0.06, 2400 + Math.random() * 900, 'triangle', 0.045, 0.002, 0.12); noiseBurst(t + k * 0.06, 5200, 4, 0.025, 0.04); }
    },
    /** Frappe de machine à écrire. */
    type() { if (ac()) noiseBurst(ctx.currentTime, 3200 + Math.random() * 800, 3, 0.05, 0.025); },
    /** Coup de théâtre (titre « PALIER N ») : grosse caisse + accord grave. */
    sting() {
      if (!ac()) return;
      const t = ctx.currentTime;
      tone(t, 70, 'sine', 0.7, 0.005, 0.9, 38); noiseBurst(t, 200, 0.5, 0.25, 0.4);
      [130.8, 155.6, 196].forEach((f, i) => tone(t + 0.05 + i * 0.02, f, 'sawtooth', 0.05, 0.02, 1.6));
    },
    card() {
      if (!ac()) return;
      const t = ctx.currentTime;
      if (t - lastCard < 0.05) return; // évite l'empilement quand plusieurs cartes arrivent ensemble
      lastCard = t;
      buzz(8);
      noiseBurst(t, 2600 + Math.random() * 600, 0.9, 0.5, 0.07);   // glissement
      noiseBurst(t + 0.045, 1200, 1.4, 0.35, 0.05);                 // claquement sur le tapis
      tone(t + 0.045, 140, 'sine', 0.25, 0.002, 0.06, 70);          // petit « thump »
    },
    flip() {
      if (!ac()) return;
      const t = ctx.currentTime;
      noiseBurst(t, 3400, 1.2, 0.35, 0.05);
      noiseBurst(t + 0.06, 1800, 1.2, 0.3, 0.05);
    },
    chips() {
      if (!ac()) return;
      const t = ctx.currentTime;
      [0, 0.045, 0.085].forEach((dt, k) => {
        tone(t + dt, 2300 + k * 350 + Math.random() * 200, 'triangle', 0.18, 0.001, 0.05);
        noiseBurst(t + dt, 5200, 3, 0.12, 0.03);
      });
    },
    win() {
      buzz([25, 30, 25]);
      if (!ac()) return;
      const t = ctx.currentTime;
      [523.25, 659.25, 783.99, 1046.5].forEach((f, k) => {
        tone(t + k * 0.09, f, 'triangle', 0.22, 0.01, 0.35);
        tone(t + k * 0.09, f * 2, 'sine', 0.05, 0.01, 0.25);
      });
    },
    lose() {
      buzz(70);
      if (!ac()) return;
      const t = ctx.currentTime;
      tone(t, 392, 'triangle', 0.2, 0.02, 0.35, 370);
      tone(t + 0.28, 311.1, 'triangle', 0.2, 0.02, 0.55, 280);
    },
    push() {
      if (!ac()) return;
      tone(ctx.currentTime, 523.25, 'sine', 0.15, 0.02, 0.3);
    },
    tick() {
      if (!ac()) return;
      tone(ctx.currentTime, 1500, 'square', 0.06, 0.001, 0.03);
    },
    /** Battement de cœur (suspense) : deux coups sourds. */
    heartbeat() {
      if (!ac()) return;
      const t = ctx.currentTime;
      tone(t, 62, 'sine', 0.5, 0.005, 0.18, 48); tone(t + 0.2, 58, 'sine', 0.38, 0.005, 0.2, 44);
    },
    /** Roulement de tambour (environ `seconds` secondes) avant une boule décisive. */
    drumroll(seconds) {
      if (!ac()) return;
      const t = ctx.currentTime, n = Math.round((seconds || 1.2) * 22);
      for (let k = 0; k < n; k++) noiseBurst(t + k / 22, 180 + k * 3, 1.2, 0.05 + 0.09 * (k / n), 0.05);
    },
    /** Paquet qui arrive / qu'on déchire. */
    whoosh() { if (ac()) noiseBurst(ctx.currentTime, 900, 0.7, 0.12, 0.35); },
    tear() { if (ac()) { const t = ctx.currentTime; for (let k = 0; k < 6; k++) noiseBurst(t + k * 0.03, 2200 - k * 200, 2, 0.1, 0.05); } },
    // Roulette : roulement de la bille sur la piste (bruit filtré qui ralentit), rebonds, annonces
    rouletteRoll(seconds) {
      if (!ac() || !(seconds > 0)) return;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = noise; src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.Q.value = 2.5;
      bp.frequency.setValueAtTime(1800, t); bp.frequency.exponentialRampToValueAtTime(700, t + seconds);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.3);
      g.gain.setValueAtTime(0.22, t + seconds * 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
      // petites irrégularités du roulement
      const lfo = ctx.createOscillator(); const lg = ctx.createGain();
      lfo.frequency.setValueAtTime(14, t); lfo.frequency.linearRampToValueAtTime(5, t + seconds);
      lg.gain.value = 0.08; lfo.connect(lg); lg.connect(g.gain);
      src.connect(bp); bp.connect(g); g.connect(master);
      src.start(t); src.stop(t + seconds + 0.1); lfo.start(t); lfo.stop(t + seconds + 0.1);
    },
    clack(vol) {
      buzz(5);
      if (!ac()) return;
      const t = ctx.currentTime, v = Math.max(0.05, vol || 0.6);
      noiseBurst(t, 3800, 2, 0.45 * v, 0.025);
      tone(t, 2200 + Math.random() * 600, 'triangle', 0.12 * v, 0.001, 0.04);
    },
    // ---------- Rocket Crash ----------
    /** Moteur de la fusée : grondement (bruit filtré) + bourdonnement grave, qui montent avec le multiplicateur. */
    engineStart() {
      if (!ac() || rocket) return;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380; lp.Q.value = 0.8;
      const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 48;
      const og = ctx.createGain(); og.gain.value = 0.05;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.32, t + 0.6);
      src.connect(lp); lp.connect(g); osc.connect(og); og.connect(lp); g.connect(master);
      src.start(t); osc.start(t);
      rocket = { src, lp, osc, g };
    },
    engineSet(m) {
      if (!rocket || !ctx) return;
      const t = ctx.currentTime, k = Math.min(1, Math.log(Math.max(1, m)) / Math.log(20));
      rocket.lp.frequency.setTargetAtTime(380 + 1500 * k, t, 0.15);
      rocket.osc.frequency.setTargetAtTime(48 + 70 * k, t, 0.15);
      rocket.g.gain.setTargetAtTime(0.32 + 0.18 * k, t, 0.2);
    },
    engineStop(fast) {
      if (!rocket || !ctx) return;
      const r = rocket; rocket = null;
      const t = ctx.currentTime, d = fast ? 0.08 : 0.6;
      r.g.gain.cancelScheduledValues(t); r.g.gain.setValueAtTime(r.g.gain.value || 0.3, t); r.g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      r.src.stop(t + d + 0.05); r.osc.stop(t + d + 0.05);
    },
    /** Explosion : souffle filtré qui s'éteint + coup sourd. */
    explosion() {
      buzz([90, 40, 160]);
      if (!ac()) return;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.setValueAtTime(4200, t); lp.frequency.exponentialRampToValueAtTime(90, t + 1.6);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
      src.connect(lp); lp.connect(g); g.connect(master); src.start(t); src.stop(t + 1.9);
      tone(t, 120, 'sine', 0.7, 0.005, 0.9, 28);
      tone(t + 0.05, 70, 'triangle', 0.4, 0.01, 1.1, 22);
    },
    /** Retrait réussi : « cha-ching » brillant. */
    cashout() {
      buzz([20, 25, 40]);
      if (!ac()) return;
      const t = ctx.currentTime;
      [1318.5, 1760, 2637].forEach((f, k) => { tone(t + k * 0.06, f, 'triangle', 0.2, 0.004, 0.4); tone(t + k * 0.06, f * 1.5, 'sine', 0.05, 0.004, 0.3); });
      noiseBurst(t + 0.12, 7000, 4, 0.12, 0.25);
    },
    // ---------- Mines ----------
    /** Diamant trouvé : note cristalline qui monte à chaque case. */
    gem(k) {
      buzz(12);
      if (!ac()) return;
      const t = ctx.currentTime, f = 660 * Math.pow(2, Math.min(24, k || 1) / 12);
      tone(t, f, 'triangle', 0.16, 0.004, 0.3); tone(t + 0.04, f * 2, 'sine', 0.05, 0.004, 0.25);
    },
    // ---------- Plinko ----------
    /** Bille qui touche un picot : petit « tic » cristallin, plus aigu vers le bas du plateau. */
    peg(row, rows) {
      if (!ac()) return;
      const t = ctx.currentTime, k = rows ? row / rows : 0.5;
      tone(t, 1400 + 900 * k + Math.random() * 120, 'sine', 0.05, 0.001, 0.06);
      tone(t, 2800 + 1600 * k, 'triangle', 0.015, 0.001, 0.03);
    },
    /** Bille qui tombe dans une case : son plus riche pour les gros multiplicateurs. */
    plinkLand(mult) {
      if (!ac()) return;
      const t = ctx.currentTime;
      if (mult < 1) { tone(t, 330, 'triangle', 0.1, 0.005, 0.18, 260); return; }
      if (mult < 2) { tone(t, 660, 'triangle', 0.12, 0.004, 0.22); tone(t + 0.05, 990, 'sine', 0.05, 0.004, 0.2); return; }
      buzz(mult >= 10 ? [25, 30, 50] : 20);
      const notes = mult >= 10 ? [1046.5, 1318.5, 1568, 2093] : [880, 1108.7, 1318.5];
      notes.forEach((f, k) => { tone(t + k * 0.06, f, 'triangle', 0.16, 0.004, 0.35); tone(t + k * 0.06, f * 1.5, 'sine', 0.04, 0.004, 0.25); });
      if (mult >= 10) noiseBurst(t + 0.15, 7000, 4, 0.1, 0.3);
    },
    /** Annonce vocale (voix féminine française par défaut). */
    say(text, lang) { if (enabled) speak(text, lang || 'fr-FR'); },
    blackjack() {
      if (!enabled) return;
      if (ac()) { // petite fanfare
        const t = ctx.currentTime;
        [659.25, 783.99, 1046.5, 1318.5].forEach((f, k) => tone(t + k * 0.07, f, 'triangle', 0.18, 0.01, 0.45));
      }
      speak('Blackjack!');
    },
    // Musique d'ambiance « lounge » : accords doux de piano électrique et contrebasse, en boucle
    music(on) {
      musicOn = !!on;
      try { localStorage.setItem('music-on', musicOn ? '1' : '0'); } catch (e) { /* ignore */ }
      if (musicOn) startMusic(); else stopMusic();
      renderToggle();
    },
    get musicOn() { return musicOn; },
    get enabled() { return enabled; },
    setEnabled(on) {
      enabled = on;
      try { localStorage.setItem('sfx-on', on ? '1' : '0'); } catch (e) { /* ignore */ }
      if (!on && window.speechSynthesis) window.speechSynthesis.cancel();
      if (!on) stopMusic(); else if (musicOn) startMusic();
      renderToggle();
    },
  };

  // ---------- Musique ----------
  let musicOn = false, musicTimer = null, musicBus = null, bar = 0;
  try { musicOn = localStorage.getItem('music-on') === '1'; } catch (e) { /* ignore */ }
  // ii-V-I-vi en ré bémol, voicings jazz (fréquences en Hz)
  const CHORDS = [
    { bass: 77.78, notes: [311.13, 369.99, 466.16, 523.25] },   // Ebm9
    { bass: 103.83, notes: [277.18, 349.23, 415.3, 466.16] },   // Ab13
    { bass: 69.3, notes: [261.63, 311.13, 349.23, 415.3] },     // Dbmaj9
    { bass: 58.27, notes: [277.18, 311.13, 349.23, 466.16] },   // Bbm11
  ];
  function epiano(t, f, vol, dur) {
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = f;
    o2.type = 'sine'; o2.frequency.value = f * 2.01;
    const g2 = ctx.createGain(); g2.gain.value = 0.25;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); o2.connect(g2); g2.connect(g); g.connect(musicBus);
    o.start(t); o2.start(t); o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
  }
  // Une ambiance par jeu : lounge (accueil, blackjack), jazz feutré (poker), Las Vegas (roulette, machine à sous),
  // synthwave (Rocket Crash). Mesures de 3 s dans tous les cas.
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const chord = (bass, ...ns) => ({ bass: hz(bass), notes: ns.map(hz) });
  const STYLE = /\/(crash|plinko|trader|mines)\//.test(location.pathname) ? 'synth' : /\/(roulette|slots|gold)\//.test(location.pathname) ? 'vegas' : /\/poker\//.test(location.pathname) ? 'jazz' : 'lounge';
  const PROGS = {
    jazz: [chord(38, 65, 69, 72, 76), chord(43, 65, 69, 71, 76), chord(36, 64, 67, 71, 74), chord(45, 61, 67, 70, 73)],      // Dm9 G13 Cmaj9 A7b9
    vegas: [chord(36, 64, 67, 69, 72), chord(45, 64, 67, 69, 72), chord(38, 65, 69, 72, 74), chord(43, 65, 67, 71, 74)],     // C6 Am7 Dm7 G7
    synth: [chord(33, 69, 72, 76, 81), chord(29, 65, 69, 72, 77), chord(36, 64, 67, 72, 76), chord(31, 67, 71, 74, 79)],     // Am F C G
  };
  function synthNote(t, f, vol, dur, type) {
    const o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
    o.type = type || 'sawtooth'; o.frequency.value = f; lp.type = 'lowpass'; lp.frequency.value = 1400;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp); lp.connect(g); g.connect(musicBus); o.start(t); o.stop(t + dur + 0.05);
  }
  function kick(t) { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.15); g.gain.setValueAtTime(0.4, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2); o.connect(g); g.connect(musicBus); o.start(t); o.stop(t + 0.25); }
  function playStyled() {
    const t = ctx.currentTime + 0.05, beat = 0.75, ch = PROGS[STYLE][bar % 4];
    if (STYLE === 'synth') {
      for (let i = 0; i < 8; i++) synthNote(t + i * beat / 2, ch.bass * (i % 2 ? 2 : 1), 0.12, beat / 2.2, 'sawtooth');
      ch.notes.forEach((f) => synthNote(t, f, 0.025, beat * 4, 'triangle'));
      for (let i = 0; i < 4; i++) { kick(t + i * beat); noiseBurst(t + i * beat + beat / 2, 8000, 1, 0.03, 0.05); }
      [0, 1.5, 3].forEach((b, k) => synthNote(t + b * beat, ch.notes[(k + bar) % 4] * 2, 0.04, beat * 0.9, 'square'));
    } else if (STYLE === 'vegas') {
      [0, 1, 2, 3].forEach((b) => synthNote(t + b * beat, b % 2 ? ch.bass * 1.5 : ch.bass, 0.22, beat * 0.9, 'triangle'));
      [0.5, 1.5, 2.5, 3.5].forEach((b) => ch.notes.forEach((f) => epiano(t + b * beat, f, 0.03, beat * 0.45)));
      for (let i = 0; i < 8; i++) noiseBurst(t + i * beat / 2, 9000, 1.2, i % 2 ? 0.015 : 0.03, 0.04);
      [0, 0.75, 1.5, 2.25].forEach((b, k) => epiano(t + b * beat * 1.33, ch.notes[(k + bar) % 4] * 2, 0.045, beat * 0.6));
    } else { // jazz : comme le lounge, plus lent et plus grave
      [0, 2].forEach((b) => synthNote(t + b * beat, ch.bass, 0.28, beat * 1.9, 'triangle'));
      ch.notes.forEach((f) => epiano(t + 0.1, f, 0.045, beat * 3.6));
      [2, 3.5].forEach((b, k) => epiano(t + b * beat, ch.notes[(k + bar * 2) % 4] * 2, 0.03, beat));
      [1, 3].forEach((b) => noiseBurst(t + b * beat, 5000, 0.6, 0.02, 0.18));
    }
    bar++;
  }
  function playBar() {
    if (!ctx || !musicOn || !enabled) return;
    if (STYLE !== 'lounge') { playStyled(); return; }
    const t = ctx.currentTime + 0.05, beat = 0.75, ch = CHORDS[bar % CHORDS.length];
    // contrebasse : fondamentale et quinte
    [0, 2].forEach((b, k) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle'; o.frequency.value = k ? ch.bass * 1.5 : ch.bass;
      g.gain.setValueAtTime(0.0001, t + b * beat); g.gain.exponentialRampToValueAtTime(0.32, t + b * beat + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + b * beat + beat * 1.8);
      o.connect(g); g.connect(musicBus); o.start(t + b * beat); o.stop(t + b * beat + beat * 2);
    });
    // accord plaqué puis un petit arpège
    ch.notes.forEach((f) => epiano(t, f, 0.05, beat * 3.5));
    [1.5, 2.5, 3].forEach((b, k) => epiano(t + b * beat, ch.notes[(k + bar) % 4] * 2, 0.035, beat * 1.2));
    // balais sur la caisse claire
    [1, 3].forEach((b) => noiseBurst(t + b * beat, 6000, 0.6, 0.025, 0.12));
    bar++;
  }
  function startMusic() {
    if (!ac()) return; // attend un geste de l'utilisateur
    if (!musicBus) { musicBus = ctx.createGain(); musicBus.gain.value = 0.5; musicBus.connect(master); }
    if (musicTimer) return;
    playBar();
    musicTimer = setInterval(playBar, 3000);
  }
  function stopMusic() { if (musicTimer) clearInterval(musicTimer); musicTimer = null; }
  ['pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, () => { if (musicOn && !musicTimer) startMusic(); }, { passive: true }));

  // Voix féminine : on cherche une voix anglaise de femme, sinon n'importe quelle voix plus aiguë
  const FEMALE = /(female|femme|samantha|victoria|karen|moira|tessa|serena|fiona|zira|susan|allison|ava|kate|amélie|amelie|audrey|aurélie|marie|julie|hortense|google uk english female|google us english)/i;
  function pickVoice(lang) {
    const vs = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
    if (!vs.length) return null;
    const pre = new RegExp('^' + (lang || 'en').slice(0, 2), 'i');
    return vs.find((v) => pre.test(v.lang) && FEMALE.test(v.name))
      || vs.find((v) => pre.test(v.lang))
      || vs.find((v) => FEMALE.test(v.name))
      || vs[0];
  }
  function speak(text, lang) {
    if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      const v = pickVoice(lang || 'en');
      if (v) { u.voice = v; u.lang = v.lang; } else u.lang = lang || 'en-US';
      u.pitch = v && FEMALE.test(v.name) ? 1.15 : 1.5; // plus aigu si la voix n'est pas féminine
      u.rate = 0.92;
      u.volume = 1;
      window.speechSynthesis.cancel();
      setTimeout(() => window.speechSynthesis.speak(u), 250);
    } catch (e) { /* synthèse vocale indisponible */ }
  }
  if (window.speechSynthesis) window.speechSynthesis.getVoices(); // précharge la liste

  function renderToggle() {
    const m = document.getElementById('music-toggle');
    if (m) { m.textContent = '🎵'; m.style.opacity = musicOn ? '1' : '.45'; m.title = musicOn ? 'Couper la musique' : 'Mettre la musique'; m.setAttribute('aria-label', m.title); m.setAttribute('aria-pressed', musicOn); }
    const b = document.getElementById('sound-toggle');
    if (!b) return;
    b.textContent = enabled ? '🔊' : '🔇';
    b.title = enabled ? 'Couper le son' : 'Remettre le son';
    b.setAttribute('aria-label', b.title);
  }
  function bindToggle() {
    renderToggle();
    const b = document.getElementById('sound-toggle');
    if (b && !b.dataset.bound) { b.dataset.bound = '1'; b.addEventListener('click', () => Sfx.setEnabled(!enabled)); }
    const m = document.getElementById('music-toggle');
    if (m && !m.dataset.bound) { m.dataset.bound = '1'; m.addEventListener('click', () => Sfx.music(!musicOn)); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindToggle);
  else setTimeout(bindToggle, 0);

  window.Sfx = Sfx;
})();
