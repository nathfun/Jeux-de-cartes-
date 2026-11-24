/*
 * Chat avec le coach : pose des questions sur le blackjack à Claude.
 * Disponible uniquement sur la version en ligne (claude.ai) : ailleurs, le panneau l'indique.
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const history = []; // { role, content } — 10 derniers échanges
  let sample = null;
  let pending = null;

  const INSTRUCTIONS = [
    'Tu es un coach de blackjack bienveillant et pédagogue, intégré à une application d\'entraînement.',
    'Réponds en français, en tutoyant, de façon claire et concrète, en 2 à 6 phrases courtes (pas de titres, pas de tableaux, pas de markdown).',
    'Règles de la table : 6 jeux, le croupier reste sur 17 souple, double sur 2 cartes quelconques, double après séparation autorisé, blackjack payé 3:2, pas d\'abandon.',
    'Paris annexes proposés : Paire parfaite (5:1, 12:1, 25:1) et 21+3 (5:1 à 100:1).',
    'Le comptage enseigné est le Hi-Lo (2-6 = +1, 7-9 = 0, 10 à As = −1, compte vrai = compte courant / jeux restants).',
    'Appuie-toi sur la stratégie de base et sur des probabilités exactes ou bien établies. Si la question sort du blackjack, ramène gentiment la conversation au jeu.',
    'Rappelle si c\'est utile que le jeu d\'argent comporte des risques, sans faire la morale.',
  ].join('\n');

  function add(role, text) {
    const el = document.createElement('div');
    el.className = 'msg ' + (role === 'user' ? 'me' : 'coach');
    el.textContent = text;
    $('coach-chat').appendChild(el);
    $('coach-chat').scrollTop = $('coach-chat').scrollHeight;
    return el;
  }

  async function ask(question) {
    question = question.trim();
    if (!question || pending) return;
    if (!sample) { add('coach', 'Le chat du coach n\'est disponible que sur la version en ligne du jeu.'); return; }
    add('user', question);
    const out = add('coach', '…');
    out.classList.add('typing');
    const ctx = window.BJ ? window.BJ.getContext() : '';
    const turns = history.slice(-10);
    turns.push({ role: 'user', content: INSTRUCTIONS + '\n\nContexte actuel du joueur :\n' + ctx + '\n\nQuestion du joueur : ' + question });
    const input = turns;
    pending = new AbortController();
    $('coach-chat-form').querySelector('button').disabled = true;
    try {
      const res = await sample(input, {
        signal: pending.signal,
        cache: false,
        onText: ({ text }) => { out.textContent = text; $('coach-chat').scrollTop = $('coach-chat').scrollHeight; },
      });
      out.textContent = res.text;
      history.push({ role: 'user', content: question });
      history.push({ role: 'assistant', content: res.text });
    } catch (e) {
      const code = e && e.code;
      if (code === 'not_granted') {
        out.textContent = 'Le chat du coach n\'a pas été autorisé. Tu peux l\'activer depuis le menu des autorisations de la page.';
      } else if (code === 'rate_limited') {
        out.textContent = 'Trop de questions d\'un coup : attends quelques secondes et réessaie.';
      } else {
        out.textContent = (e && e.text) || 'Le coach n\'a pas pu répondre. Réessaie dans un instant.';
      }
    } finally {
      out.classList.remove('typing');
      pending = null;
      $('coach-chat-form').querySelector('button').disabled = false;
    }
  }

  $('coach-chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('coach-chat-input').value;
    $('coach-chat-input').value = '';
    ask(q);
  });

  window.CoachChat = {
    ask,
    askAboutSituation() {
      $('coach-chat-panel').scrollIntoView({ behavior: 'smooth', block: 'center' });
      ask('Peux-tu m\'expliquer plus en détail pourquoi c\'est la bonne décision dans la situation que je viens de jouer ?');
    },
  };

  // Hors de claude.ai (app indépendante), le chat du coach n'existe pas : on masque le panneau
  function disable() {
    $('coach-chat-panel').hidden = true;
  }

  if (!window.claude || typeof window.claude.use !== 'function') { disable(); return; }
  window.claude.use('sample').then((s) => {
    if (!s) disable(); else sample = s;
  }).catch(disable);
})();
