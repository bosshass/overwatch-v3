// ============================================
// JUC-E V4 - InboxBar Component
// ============================================
// Pinned notification bar for Tasks & Quick Notes
// These are NOT jobs — they're internal comms that demand acknowledgment.
// Shows at top of every view with badge count.
// Actions: Acknowledge (done), Convert to Job, Snooze

import { useState, useEffect, useCallback } from 'react';
import { supabase, jobsApi, JOB_STATUS } from '../services/supabase.js';
import { TECH_COLORS } from '../config/calendars.js';

const TECH_PILL_COLORS = {
  'Austin': '#3b82f6', 'JR': '#22c55e', 'Shana': '#eab308',
  'Sara': '#a855f7', 'Trevor': '#14b8a6',
};

export default function InboxBar({ userEmail, onConvertToJob, onRefresh }) {
  const [items, setItems] = useState([]);
  const [expanded, setExpanded] = useState(false);
  const [actionInProgress, setActionInProgress] = useState(null);

  const loadItems = useCallback(async () => {
    try {
      // Fetch tasks & notes that haven't been acknowledged
      const { data, error } = await supabase
        .from('jobs')
        .select('*, job_assignments(*, techs(name, email))')
        .in('job_type', ['task', 'note'])
        .not('status', 'in', `(${JOB_STATUS.BILLED},${JOB_STATUS.ARCHIVED},${JOB_STATUS.DEAD})`)
        .is('acknowledged_at', null)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setItems(data || []);
    } catch (e) { console.error('Inbox load error:', e); }
  }, []);

  useEffect(() => { loadItems(); }, [loadItems]);

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(loadItems, 30000);
    return () => clearInterval(interval);
  }, [loadItems]);

  const acknowledge = async (item) => {
    setActionInProgress(item.id);
    try {
      await supabase.from('jobs').update({
        acknowledged_at: new Date().toISOString(),
        acknowledged_by: userEmail,
        status: JOB_STATUS.ARCHIVED
      }).eq('id', item.id);
      setItems(prev => prev.filter(i => i.id !== item.id));
      onRefresh?.();
    } catch (e) { console.error('Acknowledge error:', e); }
    finally { setActionInProgress(null); }
  };

  const convertToJob = async (item) => {
    setActionInProgress(item.id);
    try {
      // Change job_type to service_res, keep everything else
      await supabase.from('jobs').update({
        job_type: 'service_res',
        acknowledged_at: new Date().toISOString(),
        acknowledged_by: userEmail,
      }).eq('id', item.id);
      setItems(prev => prev.filter(i => i.id !== item.id));
      onRefresh?.();
      onConvertToJob?.(item);
    } catch (e) { console.error('Convert error:', e); }
    finally { setActionInProgress(null); }
  };

  const dismissAll = async () => {
    try {
      const ids = items.map(i => i.id);
      await supabase.from('jobs').update({
        acknowledged_at: new Date().toISOString(),
        acknowledged_by: userEmail,
        status: JOB_STATUS.ARCHIVED
      }).in('id', ids);
      setItems([]);
      onRefresh?.();
    } catch (e) { console.error('Dismiss all error:', e); }
  };

  const getTimeSince = (dateStr) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const getAssignedTech = (item) => {
    const assignment = item.job_assignments?.[0];
    return assignment?.techs?.name || null;
  };

  const getCreator = (item) => {
    const email = item.created_by || '';
    if (email.includes('info@')) return 'Sara';
    if (email.includes('sara@')) return 'Sara';
    if (email.includes('austin')) return 'Austin';
    if (email.includes('shana')) return 'Shana';
    if (email.includes('jr@') || email.includes('jrappt')) return 'JR';
    if (email.includes('trevor')) return 'Trevor';
    return email.split('@')[0] || 'Unknown';
  };

  if (items.length === 0) return null;

  const isTask = (item) => item.job_type === 'task';
  const tasks = items.filter(isTask);
  const notes = items.filter(i => !isTask(i));

  return (
    <div style={{ marginBottom: expanded ? '0' : '8px' }}>
      {/* Collapsed bar */}
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: expanded ? '#1a2332' : 'linear-gradient(135deg, #f59e0b15, #ef444415)',
          border: `1px solid ${expanded ? '#334155' : '#f59e0b40'}`,
          borderRadius: expanded ? '14px 14px 0 0' : '14px',
          padding: '12px 16px', cursor: 'pointer',
          animation: !expanded ? 'inboxPulse 2s ease-in-out infinite' : 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '18px' }}>📥</span>
          <span style={{ color: '#e2e8f0', fontWeight: '700', fontSize: '14px' }}>
            Inbox
          </span>
          {tasks.length > 0 && (
            <span style={{
              background: '#f59e0b', color: '#000', fontSize: '11px', fontWeight: '800',
              padding: '2px 8px', borderRadius: '10px'
            }}>
              {tasks.length} task{tasks.length !== 1 ? 's' : ''}
            </span>
          )}
          {notes.length > 0 && (
            <span style={{
              background: '#10b981', color: '#fff', fontSize: '11px', fontWeight: '800',
              padding: '2px 8px', borderRadius: '10px'
            }}>
              {notes.length} note{notes.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <span style={{ color: '#cbd5e1', fontSize: '12px' }}>{expanded ? '▾' : '▸'}</span>
      </button>

      {/* Expanded items */}
      {expanded && (
        <div style={{
          background: '#1a2332', border: '1px solid #334155', borderTop: 'none',
          borderRadius: '0 0 14px 14px', overflow: 'hidden'
        }}>
          {/* Dismiss all */}
          {items.length > 1 && (
            <div style={{ padding: '8px 16px', borderBottom: '1px solid #0f1729', display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={dismissAll}
                style={{ background: 'none', border: 'none', color: '#cbd5e1', fontSize: '12px', cursor: 'pointer', textDecoration: 'underline' }}>
                Acknowledge All ({items.length})
              </button>
            </div>
          )}

          {items.map((item, idx) => {
            const tech = getAssignedTech(item);
            const creator = getCreator(item);
            const techColor = tech ? (TECH_PILL_COLORS[tech] || '#475569') : null;
            const isNote = item.job_type === 'note';
            const processing = actionInProgress === item.id;

            return (
              <div key={item.id}
                style={{
                  padding: '14px 16px',
                  borderBottom: idx < items.length - 1 ? '1px solid #0f1729' : 'none',
                  opacity: processing ? 0.5 : 1,
                  transition: 'opacity 0.2s'
                }}>
                {/* Header: icon + type + time */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '14px' }}>{isNote ? '📌' : '📝'}</span>
                    <span style={{ color: isNote ? '#10b981' : '#f59e0b', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase' }}>
                      {isNote ? 'Note' : 'Task'}
                    </span>
                    <span style={{ color: '#94a3b8' }}>·</span>
                    <span style={{ color: '#cbd5e1', fontSize: '11px' }}>from {creator}</span>
                  </div>
                  <span style={{ color: '#94a3b8', fontSize: '11px' }}>{getTimeSince(item.created_at)}</span>
                </div>

                {/* Content */}
                <div style={{ color: '#e2e8f0', fontSize: '14px', fontWeight: '500', marginBottom: '4px', lineHeight: '1.4' }}>
                  {item.issue || item.customer_name || '(no content)'}
                </div>

                {/* Customer if note has one */}
                {isNote && item.customer_name && item.customer_name !== '📌 Quick Note' && (
                  <div style={{ color: '#94a3b8', fontSize: '12px', marginBottom: '4px' }}>
                    Re: {item.customer_name}
                  </div>
                )}

                {/* Assigned tech */}
                {tech && (
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginBottom: '8px' }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: techColor }} />
                    <span style={{ color: techColor, fontSize: '12px', fontWeight: '600' }}>→ {tech}</span>
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                  <button onClick={() => acknowledge(item)} disabled={processing}
                    style={{
                      flex: 1, padding: '10px', fontSize: '13px', fontWeight: '600',
                      background: '#22c55e15', color: '#22c55e',
                      border: '1px solid #22c55e40', borderRadius: '10px', cursor: 'pointer'
                    }}>
                    ✓ Got it
                  </button>
                  {!isNote && (
                    <button onClick={() => convertToJob(item)} disabled={processing}
                      style={{
                        flex: 1, padding: '10px', fontSize: '13px', fontWeight: '600',
                        background: '#3b82f615', color: '#3b82f6',
                        border: '1px solid #3b82f640', borderRadius: '10px', cursor: 'pointer'
                      }}>
                      🔧 Make a Job
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pulse animation */}
      <style>{`
        @keyframes inboxPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0); }
          50% { box-shadow: 0 0 12px 2px rgba(245, 158, 11, 0.15); }
        }
      `}</style>
    </div>
  );
}
