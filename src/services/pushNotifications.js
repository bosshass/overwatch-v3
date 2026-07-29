// ============================================
// JUC-E V4 - Push Notifications Service
// ============================================
// Uses Firebase Cloud Messaging for real push.
// Falls back to in-app notifications if denied.

import { supabase } from './supabase.js';

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY;
const FCM_CONFIG = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

let messaging = null;

// ============================================
// INITIALIZE FCM
// ============================================
async function initFirebase() {
  if (messaging) return messaging;
  if (!FCM_CONFIG.apiKey) {
    console.warn('Firebase not configured — push disabled');
    return null;
  }
  try {
    const { initializeApp } = await import('firebase/app');
    const { getMessaging, getToken, onMessage } = await import('firebase/messaging');
    const app = initializeApp(FCM_CONFIG);
    messaging = getMessaging(app);
    return messaging;
  } catch (e) {
    console.error('Firebase init failed:', e);
    return null;
  }
}

// ============================================
// REQUEST PERMISSION + REGISTER TOKEN
// ============================================
export async function requestNotificationPermission(userEmail) {
  if (!('Notification' in window)) {
    return { granted: false, reason: 'not-supported' };
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { granted: false, reason: 'denied' };
  }

  // Register service worker
  let swReg;
  try {
    swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    await navigator.serviceWorker.ready;
  } catch (e) {
    console.error('SW registration failed:', e);
    // Still return granted — we can do in-app notifications
    return { granted: true, token: null };
  }

  // Get FCM token
  const msg = await initFirebase();
  if (!msg) return { granted: true, token: null };

  try {
    const { getToken } = await import('firebase/messaging');
    const token = await getToken(msg, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: swReg,
    });

    if (token) {
      await saveToken(userEmail, token);
      return { granted: true, token };
    }
  } catch (e) {
    console.error('FCM token error:', e);
  }

  return { granted: true, token: null };
}

// ============================================
// SAVE / REMOVE TOKEN IN SUPABASE
// ============================================
async function saveToken(userEmail, token) {
  try {
    // Upsert — same email+device gets updated, not duplicated
    await supabase.from('push_tokens').upsert({
      user_email: userEmail,
      token: token,
      device: navigator.userAgent.slice(0, 100),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'token' });
  } catch (e) {
    console.error('Token save error:', e);
  }
}

export async function removeToken(userEmail) {
  try {
    await supabase.from('push_tokens').delete().eq('user_email', userEmail);
  } catch (e) {
    console.error('Token remove error:', e);
  }
}

// ============================================
// LISTEN FOR FOREGROUND MESSAGES
// ============================================
export async function onForegroundMessage(callback) {
  const msg = await initFirebase();
  if (!msg) return;
  const { onMessage } = await import('firebase/messaging');
  onMessage(msg, (payload) => {
    callback({
      title: payload.notification?.title || 'JUC-E',
      body: payload.notification?.body || '',
      data: payload.data || {},
    });
  });
}

// ============================================
// IN-APP NOTIFICATION SYSTEM
// ============================================
// Works regardless of FCM — shows toast notifications inside the app

const listeners = new Set();

export function onNotification(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function sendLocalNotification(notification) {
  // Show to all in-app listeners
  listeners.forEach(cb => cb(notification));

  // Also show browser notification if permitted
  if (Notification.permission === 'granted') {
    try {
      new Notification(notification.title, {
        body: notification.body,
        icon: '/juce-icon-drh.png',
        badge: '/juce-icon-drh.png',
        tag: notification.tag || 'juce-default',
        data: notification.data,
      });
    } catch (e) {
      // Safari/iOS may not support new Notification() directly
      console.warn('Browser notification failed:', e);
    }
  }
}

// ============================================
// NOTIFICATION TRIGGERS
// ============================================
// Call these from your app code when events happen

export function notifyJobAssigned(techName, customerName, scheduledFor) {
  sendLocalNotification({
    title: `📋 New Assignment`,
    body: `${customerName} — assigned to ${techName}${scheduledFor ? ` for ${new Date(scheduledFor).toLocaleDateString()}` : ''}`,
    tag: 'job-assigned',
    data: { type: 'assignment' },
  });
}

export function notifyJobComplete(techName, customerName) {
  sendLocalNotification({
    title: `✅ Job Complete`,
    body: `${techName} finished ${customerName}`,
    tag: 'job-complete',
    data: { type: 'complete' },
  });
}

export function notifyStatusChange(customerName, newStatus) {
  sendLocalNotification({
    title: `🔄 Status Update`,
    body: `${customerName} → ${newStatus}`,
    tag: 'status-change',
    data: { type: 'status' },
  });
}

export function notifyOverrun(techName, customerName, minutes) {
  sendLocalNotification({
    title: `⚠️ Overrun Alert`,
    body: `${techName} at ${customerName} — ${minutes}min over expected`,
    tag: 'overrun',
    data: { type: 'overrun' },
  });
}

// ============================================
// NOTIFICATION PREFERENCES (localStorage)
// ============================================
const PREFS_KEY = 'juce_notification_prefs';

const DEFAULT_PREFS = {
  enabled: false,
  assignments: true,
  completions: true,
  statusChanges: false,
  overruns: true,
};

export function getNotificationPrefs() {
  try {
    const saved = localStorage.getItem(PREFS_KEY);
    return saved ? { ...DEFAULT_PREFS, ...JSON.parse(saved) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

export function saveNotificationPrefs(prefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

// ============================================
// CHECK STATUS
// ============================================
export function getNotificationStatus() {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission; // 'granted', 'denied', 'default'
}
