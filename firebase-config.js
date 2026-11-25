/*
 * Configuration Firebase de l'app « Jeux de cartes ».
 * Objet firebaseConfig copié depuis la console Firebase (voir FIREBASE.md).
 * Ces valeurs ne sont pas secrètes : la sécurité vient des règles de la base de données.
 */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyCMNv8HTucKWUUxUhQpLuDP8QyMnVuStiI",
  authDomain: "jeux-de-cartes-81cdf.firebaseapp.com",
  databaseURL: "https://jeux-de-cartes-81cdf-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "jeux-de-cartes-81cdf",
  storageBucket: "jeux-de-cartes-81cdf.firebasestorage.app",
  messagingSenderId: "433776035648",
  appId: "1:433776035648:web:25fe2e6211435e7529dca5"
};

// Serveur du Casino (Cloud Functions, dossier functions/) : à passer à true une fois le serveur déployé
// (voir FIREBASE.md, « Serveur anti-triche »). Avec true, la banque et les tirages des parties réelles
// sont gérés par le serveur ; avec false, tout est calculé dans le navigateur.
window.CASINO_SERVER = false;
