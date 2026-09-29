// Firebase *web app* config. These values are not secrets — access is enforced by firestore.rules.
// Set to `null` to run in local demo mode (reports stored only in this browser).
export const firebaseConfig = {
  "apiKey": "AIzaSyCYBgHfgDKYDnjIhLJLjChZOE05XYjy4R8",
  "authDomain": "bkkflood-d54cc.firebaseapp.com",
  "projectId": "bkkflood-d54cc",
  "appId": "1:660111617024:web:cbcd374a5032c81b7d3ce5"
};

// Web Push certificate (public key) from Firebase console > Cloud Messaging. null = SDK default key.
export const vapidKey = null;

// App Check (reCAPTCHA Enterprise, score-based) site key — public. Registered for the web app in Firebase App Check.
export const appCheckSiteKey = '6LcXy9UtAAAAAL0LqloSZQC8AOMEv7tbABH6Sl2n';
