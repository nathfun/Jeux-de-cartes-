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
  let ctx = null, noise = null, master = null;
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
  const Sfx = {
    card() {
      if (!ac()) return;
      const t = ctx.currentTime;
      if (t - lastCard < 0.05) return; // évite l'empilement quand plusieurs cartes arrivent ensemble
      lastCard = t;
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
      if (!ac()) return;
      const t = ctx.currentTime;
      [523.25, 659.25, 783.99, 1046.5].forEach((f, k) => {
        tone(t + k * 0.09, f, 'triangle', 0.22, 0.01, 0.35);
        tone(t + k * 0.09, f * 2, 'sine', 0.05, 0.01, 0.25);
      });
    },
    lose() {
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
      if (!ac()) return;
      const t = ctx.currentTime, v = Math.max(0.05, vol || 0.6);
      noiseBurst(t, 3800, 2, 0.45 * v, 0.025);
      tone(t, 2200 + Math.random() * 600, 'triangle', 0.12 * v, 0.001, 0.04);
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
    get enabled() { return enabled; },
    setEnabled(on) {
      enabled = on;
      try { localStorage.setItem('sfx-on', on ? '1' : '0'); } catch (e) { /* ignore */ }
      if (!on && window.speechSynthesis) window.speechSynthesis.cancel();
      renderToggle();
    },
  };

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
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindToggle);
  else setTimeout(bindToggle, 0);

  window.Sfx = Sfx;
})();
