// ============================================
// JUC-E V4 - NotificationBell
// ============================================
// Bell icon in header with notification dropdown,
// settings toggle, and recent notification history.

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  requestNotificationPermission,
  onNotification,
  onForegroundMessage,
  getNotificationPrefs,
  saveNotificationPrefs,
  getNotificationStatus,
} from '../services/pushNotifications.js';

export default function NotificationBell({ userEmail }) {
  const [showPanel, setShowPanel] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [prefs, setPrefs] = useState(getNotificationPrefs());
  const [permissionStatus, setPermissionStatus] = useState(getNotificationStatus());
  const panelRef = useRef(null);

  // Listen for in-app notifications
  useEffect(() => {
    const unsub = onNotification((notification) => {
      setNotifications(prev => [{
        ...notification,
        id: Date.now(),
        time: new Date(),
        read: false,
      }, ...prev].slice(0, 50)); // Keep last 50
      setUnreadCount(c => c + 1);
    });
    return unsub;
  }, []);

  // Listen for FCM foreground messages
  useEffect(() => {
    onForegroundMessage((msg) => {
      setNotifications(prev => [{
        title: msg.title,
        body: msg.body,
        data: msg.data,
        id: Date.now(),
        time: new Date(),
        read: false,
      }, ...prev].slice(0, 50));
      setUnreadCount(c => c + 1);
    });
  }, []);

  // Close panel on outside click
  useEffect(() => {
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setShowPanel(false);
        setShowSettings(false);
      }
    };
    if (showPanel) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPanel]);

  const enableNotifications = useCallback(async () => {
    const result = await requestNotificationPermission(userEmail);
    setPermissionStatus(result.granted ? 'granted' : 'denied');
    if (result.granted) {
      const updated = { ...prefs, enabled: true };
      setPrefs(updated);
      saveNotificationPrefs(updated);
    }
  }, [userEmail, prefs]);

  const togglePref = (key) => {
    const updated = { ...prefs, [key]: !prefs[key] };
    setPrefs(updated);
    saveNotificationPrefs(updated);
  };

  const markAllRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    setUnreadCount(0);
  };

  const clearAll = () => {
    setNotifications([]);
    setUnreadCount(0);
  };

  const timeAgo = (date) => {
    const mins = Math.floor((Date.now() - date.getTime()) / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}d`;
  };

  return (
    <div ref={panelRef} style={{ position: 'relative' }}>
      {/* Bell button */}
      <button
        onClick={() => { setShowPanel(!showPanel); if (!showPanel) markAllRead(); }}
        style={{
          background: 'none', border: '1px solid #334155', borderRadius: '6px',
          color: unreadCount > 0 ? '#f59e0b' : '#94a3b8',
          padding: '4px 8px', fontSize: '14px', cursor: 'pointer', position: 'relative',
        }}
      >
        🔔
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute', top: '-4px', right: '-4px',
            background: '#ef4444', color: '#fff', borderRadius: '50%',
            width: '16px', height: '16px', fontSize: '9px', fontWeight: '700',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {showPanel && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: '8px',
          width: '320px', maxHeight: '420px', overflowY: 'auto',
          background: '#1e293b', borderRadius: '12px', border: '1px solid #334155',
          boxShadow: '0 8px 30px rgba(0,0,0,0.5)', zIndex: 200,
        }}>
          {/* Header */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '12px 14px', borderBottom: '1px solid #334155',
          }}>
            <span style={{ color: '#e2e8f0', fontSize: '14px', fontWeight: '700' }}>Notifications</span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => setShowSettings(!showSettings)} style={{
                background: 'none', border: 'none', color: showSettings ? '#00c8e8' : '#64748b',
                fontSize: '14px', cursor: 'pointer', padding: 0,
              }}>⚙️</button>
              {notifications.length > 0 && (
                <button onClick={clearAll} style={{
                  background: 'none', border: 'none', color: '#cbd5e1',
                  fontSize: '11px', cursor: 'pointer', padding: 0,
                }}>Clear</button>
              )}
            </div>
          </div>

          {/* Settings panel */}
          {showSettings && (
            <div style={{ padding: '12px 14px', borderBottom: '1px solid #334155' }}>
              {permissionStatus !== 'granted' ? (
                <button onClick={enableNotifications} style={{
                  width: '100%', background: '#00c8e8', color: '#000', border: 'none',
                  borderRadius: '8px', padding: '10px', fontSize: '13px', fontWeight: '700',
                  cursor: 'pointer', marginBottom: '8px',
                }}>
                  {permissionStatus === 'denied' ? '🚫 Notifications blocked — check browser settings' : '🔔 Enable Push Notifications'}
                </button>
              ) : (
                <div style={{ color: '#22c55e', fontSize: '12px', fontWeight: '600', marginBottom: '8px' }}>
                  ✅ Notifications enabled
                </div>
              )}
              {[
                { key: 'assignments', label: 'Job assignments', icon: '📋' },
                { key: 'completions', label: 'Job completions', icon: '✅' },
                { key: 'statusChanges', label: 'Status changes', icon: '🔄' },
                { key: 'overruns', label: 'Overrun alerts', icon: '⚠️' },
              ].map(({ key, label, icon }) => (
                <div key={key} onClick={() => togglePref(key)} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 0', cursor: 'pointer',
                }}>
                  <span style={{ color: '#94a3b8', fontSize: '13px' }}>{icon} {label}</span>
                  <div style={{
                    width: '36px', height: '20px', borderRadius: '10px',
                    background: prefs[key] ? '#00c8e8' : '#334155',
                    position: 'relative', transition: 'background 0.2s',
                  }}>
                    <div style={{
                      width: '16px', height: '16px', borderRadius: '50%',
                      background: '#fff', position: 'absolute', top: '2px',
                      left: prefs[key] ? '18px' : '2px', transition: 'left 0.2s',
                    }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Notification list */}
          {notifications.length === 0 ? (
            <div style={{ padding: '30px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>
              No notifications yet
            </div>
          ) : (
            notifications.map(n => (
              <div key={n.id} style={{
                padding: '10px 14px', borderBottom: '1px solid #334155',
                background: n.read ? 'transparent' : '#00c8e808',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ color: '#e2e8f0', fontSize: '13px', fontWeight: '600' }}>{n.title}</div>
                  <span style={{ color: '#94a3b8', fontSize: '10px', flexShrink: 0, marginLeft: '8px' }}>
                    {timeAgo(n.time)}
                  </span>
                </div>
                {n.body && <div style={{ color: '#94a3b8', fontSize: '12px', marginTop: '2px' }}>{n.body}</div>}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
