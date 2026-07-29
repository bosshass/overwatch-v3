// ============================================
// JUC-E V4 - Firebase Messaging Service Worker
// ============================================
// Handles push notifications when app is in background

/* eslint-disable no-restricted-globals */

importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js');

// Firebase config injected at build time via env vars
// For SW, we read from URL params or hardcode — SW can't access import.meta.env
// The app will post the config to the SW on init
let firebaseConfig = null;

self.addEventListener('message', (event) => {
  if (event.data?.type === 'FIREBASE_CONFIG') {
    firebaseConfig = event.data.config;
    initFirebase();
  }
});

function initFirebase() {
  if (!firebaseConfig) return;
  try {
    firebase.initializeApp(firebaseConfig);
    const messaging = firebase.messaging();

    messaging.onBackgroundMessage((payload) => {
      const title = payload.notification?.title || 'JUC-E';
      const options = {
        body: payload.notification?.body || '',
        icon: '/juce-icon-drh.png',
        badge: '/juce-icon-drh.png',
        tag: payload.data?.tag || 'juce-push',
        data: payload.data || {},
        vibrate: [200, 100, 200],
        actions: [
          { action: 'open', title: 'Open JUC-E' },
          { action: 'dismiss', title: 'Dismiss' },
        ],
      };
      self.registration.showNotification(title, options);
    });
  } catch (e) {
    console.error('SW Firebase init error:', e);
  }
}

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss') return;

  // Open or focus the app
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus existing tab if open
      for (const client of clients) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          return;
        }
      }
      // Otherwise open new tab
      return self.clients.openWindow('/');
    })
  );
});
