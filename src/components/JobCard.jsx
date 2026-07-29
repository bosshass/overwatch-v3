// ============================================
// JUC-E V4 - JobCard Component
// ============================================
// Used in TechCalendar, OfficeHub Board, OwnerDashboard
// Shows: customer, type badge, status badge, age, last note preview

import { STATUS_INFO, JOB_STATUS } from '../services/supabase.js';
import { JOB_TYPE_INFO, getJobAge, getAgeUrgency } from '../utils/statusMachine.js';
import { assigneeOf } from '../utils/ownership.js';

const TERMINAL_STATUSES = [JOB_STATUS.BILLED, JOB_STATUS.ARCHIVED, JOB_STATUS.LOST, JOB_STATUS.DEAD];

export default function JobCard({ job, onClick, compact = false, showTime = false, isOrphan = false }) {
  const age = getJobAge(job.created_at);
  const ageInfo = getAgeUrgency(age);
  const typeInfo = JOB_TYPE_INFO[job.job_type] || JOB_TYPE_INFO.service;
  const statusInfo = STATUS_INFO[job.status] || {};
  const isTerminal = TERMINAL_STATUSES.includes(job.status);

  // Format time for calendar view
  const formatTime = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  // Format scheduled date
  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  // Last note preview (from completion_notes or issue)
  const notePreview = job.completion_notes || job.issue || '';
  const truncatedNote = notePreview.length > 80 ? notePreview.substring(0, 80) + '...' : notePreview;

  if (isOrphan) {
    return (
      <div
        onClick={onClick}
        style={{
          background: '#1e293b',
          borderRadius: '12px',
          padding: compact ? '12px' : '14px 16px',
          cursor: 'pointer',
          border: '1px solid #00c8e833',
          borderLeft: '3px solid #f59e0b',
          transition: 'background 0.15s',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '15px', fontWeight: '600', color: '#e2e8f0', marginBottom: '6px' }}>
              {job.summary || job.customer_name || 'Unknown'}
            </div>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{
                background: '#f59e0b',
                color: '#000',
                padding: '2px 8px',
                borderRadius: '4px',
                fontSize: '10px',
                fontWeight: '700',
                letterSpacing: '0.5px'
              }}>
                ⚠️ NOT IN SYSTEM
              </span>
              {showTime && job.start && (
                <span style={{ color: '#94a3b8', fontSize: '12px' }}>{formatTime(job.start)}</span>
              )}
            </div>
            {job.location && (
              <div style={{ color: '#cbd5e1', fontSize: '12px', marginTop: '4px' }}>📍 {job.location}</div>
            )}
          </div>
          {age > 0 && (
            <span style={{ color: ageInfo.color, fontSize: '12px', fontWeight: '700', flexShrink: 0 }}>
              -{age}d
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      style={{
        background: '#1e293b',
        borderRadius: '12px',
        padding: compact ? '12px' : '14px 16px',
        cursor: 'pointer',
        border: '1px solid #ffffff08',
        borderLeft: `3px solid ${statusInfo.color || '#475569'}`,
        opacity: isTerminal ? 0.6 : 1,
        transition: 'background 0.15s',
      }}
    >
      {/* Row 1: Customer name + age + job number */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
        <div style={{ fontSize: '15px', fontWeight: '600', color: '#e2e8f0', flex: 1 }}>
          {job.customer_name || 'Unknown Customer'}
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0 }}>
          {!isTerminal && age > 0 && (
            <span style={{
              color: ageInfo.color,
              fontSize: '12px',
              fontWeight: '700',
              background: `${ageInfo.color}15`,
              padding: '1px 6px',
              borderRadius: '4px'
            }}>
              {age}d
            </span>
          )}
          {job.job_number && (
            <span style={{ color: '#94a3b8', fontSize: '11px' }}>{job.job_number}</span>
          )}
        </div>
      </div>

      {/* Row 2: Badges + tech + time */}
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', marginBottom: truncatedNote && !compact ? '6px' : '0' }}>
        {/* Type badge */}
        <span style={{
          background: typeInfo.color,
          color: '#fff',
          padding: '2px 8px',
          borderRadius: '4px',
          fontSize: '10px',
          fontWeight: '700',
          letterSpacing: '0.5px'
        }}>
          {typeInfo.icon} {typeInfo.label}
        </span>

        {/* Status badge */}
        <span style={{
          background: `${statusInfo.color}20`,
          color: statusInfo.color,
          padding: '2px 8px',
          borderRadius: '4px',
          fontSize: '10px',
          fontWeight: '600',
          border: `1px solid ${statusInfo.color}40`
        }}>
          {statusInfo.label}
        </span>

        {/* Tech name */}
        {assigneeOf(job) && (
          <span style={{ color: '#94a3b8', fontSize: '12px', fontWeight: '500' }}>
            {assigneeOf(job)}
          </span>
        )}

        {/* Scheduled time */}
        {showTime && job.scheduled_for && (
          <span style={{ color: '#94a3b8', fontSize: '12px' }}>
            {formatDate(job.scheduled_for)} {formatTime(job.scheduled_for)}
          </span>
        )}
      </div>

      {/* Row 3: Note preview */}
      {truncatedNote && !compact && (
        <div style={{ color: '#cbd5e1', fontSize: '12px', lineHeight: '1.4', marginTop: '2px' }}>
          {truncatedNote}
        </div>
      )}

      {/* Row 4: Parts indicator */}
      {job.parts_needed && !compact && (
        <div style={{ color: '#f59e0b', fontSize: '11px', marginTop: '4px' }}>
          📦 Parts: {job.parts_needed}
        </div>
      )}
    </div>
  );
}
