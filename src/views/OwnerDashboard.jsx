// ============================================
// Overwatch V3 - OwnerDashboard
// ============================================
// Business metrics, pipeline, scheduling alerts.
// The MONEY view. JR sees this by default.
// Philosophy: "Useful first, strict never"
// ============================================

import { useState, useEffect, useCallback } from 'react';
import { queries, jobsApi, assignmentsApi, JOB_STATUS, STATUS_INFO, supabase } from '../services/supabase.js';
import { CALENDARS } from '../config/calendars.js';
import { fetchCalendarEvents as gcalFetchEvents } from '../services/calendarApi.js';
import { getJobAge, getAgeUrgency } from '../utils/statusMachine.js';
import usePullToRefresh from '../utils/usePullToRefresh.jsx';
import JobCard from '../components/JobCard.jsx';
import JobDetail from '../components/JobDetail.jsx';
import PLDashboard from '../components/PLDashboard.jsx';
import { StuckAlertsPanel } from '../components/StuckAlerts.jsx';
import { assigneeOf } from '../utils/ownership.js';

// ============================================
// HELPERS
// ============================================

function formatDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function daysSince(isoString) {
  if (!isoString) return 0;
  return Math.floor((Date.now() - new Date(isoString).getTime()) / (1000 * 60 * 60 * 24));
}

function AgeBadge({ days }) {
  const { color, label } = getAgeUrgency(days);
  return (
    <span style={{
      background: color + '20', color, fontSize: '11px', fontWeight: '700',
      padding: '2px 8px', borderRadius: '6px', letterSpacing: '0.03em'
    }}>
      {days}d
    </span>
  );
}

// ============================================
// GAP REPORT WIDGET
// ============================================
// Shows accepted QBO estimates without matching calendar events or invoices.
// The $147K+ gap that needs attention.

function GapReportWidget({ onDrilldown }) {
  const [gapData, setGapData] = useState({ total: 0, count: 0, jobs: [] });
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        // Get ACCEPTED (won) jobs with remaining_amount > 0 (not fully invoiced)
        const { data, error } = await supabase
          .from('jobs')
          .select('*')
          .eq('qbo_estimate_status', 'Accepted') // Only WON estimates
          .gt('remaining_amount', 0) // Still has balance to bill
          .order('remaining_amount', { ascending: false })
          .limit(20);
        
        if (error) {
          console.warn('Gap widget query failed (column may not exist):', error);
          setHasError(true);
          setLoading(false);
          return;
        }
        
        const jobs = data || [];
        const total = jobs.reduce((sum, j) => sum + (parseFloat(j.remaining_amount) || 0), 0);
        setGapData({ total, count: jobs.length, jobs });
      } catch (e) {
        console.error('Gap load error:', e);
        setHasError(true);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) return null;
  if (hasError) return null; // Don't show widget if query fails
  if (gapData.count === 0) return null; // No gap = no widget

  return (
    <div style={{
      background: gapData.total > 50000 ? '#dc262615' : '#f59e0b15',
      borderRadius: '12px', padding: '16px', marginBottom: '16px',
      border: `1px solid ${gapData.total > 50000 ? '#dc262640' : '#f59e0b40'}`,
      borderLeft: `4px solid ${gapData.total > 50000 ? '#dc2626' : '#f59e0b'}`
    }}>
      <div 
        onClick={() => setExpanded(!expanded)}
        style={{ cursor: 'pointer' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
          <div style={{ color: '#94a3b8', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            💰 Revenue Gap
          </div>
          <span style={{ color: '#94a3b8', fontSize: '12px' }}>{expanded ? '▼' : '▶'}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div style={{ color: gapData.total > 50000 ? '#dc2626' : '#f59e0b', fontSize: '28px', fontWeight: '800' }}>
            ${gapData.total.toLocaleString()}
          </div>
          <div style={{ color: '#cbd5e1', fontSize: '12px' }}>
            {gapData.count} job{gapData.count !== 1 ? 's' : ''} with remaining balance
          </div>
        </div>
        <div style={{ color: '#94a3b8', fontSize: '11px', marginTop: '4px' }}>
          Won estimates - remaining amount to bill
        </div>
      </div>

      {/* Expanded job list */}
      {expanded && (
        <div style={{ marginTop: '12px', borderTop: '1px solid #334155', paddingTop: '12px' }}>
          {gapData.jobs.slice(0, 10).map(job => (
            <div 
              key={job.id}
              onClick={() => onDrilldown && onDrilldown([job])}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '8px 0', borderBottom: '1px solid #0f1729', cursor: 'pointer'
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ color: '#e2e8f0', fontSize: '13px', fontWeight: '500' }}>
                  {job.customer_name}
                </div>
                <div style={{ color: '#cbd5e1', fontSize: '11px' }}>
                  {job.job_number} • {job.issue?.slice(0, 40)}...
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ color: '#ef4444', fontSize: '14px', fontWeight: '700' }}>
                  ${parseFloat(job.remaining_amount).toLocaleString()}
                </div>
                <div style={{ color: '#94a3b8', fontSize: '10px' }}>
                  of ${parseFloat(job.estimate_amount || 0).toLocaleString()}
                </div>
              </div>
            </div>
          ))}
          {gapData.count > 10 && (
            <div 
              onClick={() => onDrilldown && onDrilldown(gapData.jobs)}
              style={{ 
                color: '#00c8e8', fontSize: '12px', fontWeight: '600', 
                textAlign: 'center', padding: '10px', cursor: 'pointer' 
              }}
            >
              View all {gapData.count} jobs →
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================
// SCHEDULING PIPELINE VIEW
// ============================================
// The core pain point: approved estimates sitting 14+ days without scheduling.
// This view makes that visible and actionable.

function SchedulingPipeline({ stats, onJobClick, onBack }) {
  const [activeTab, setActiveTab] = useState('ready');

  // Jobs that are approved/won and need to be scheduled
  const readyToSchedule = stats.allJobs.filter(j =>
    j.status === JOB_STATUS.READY_TO_SCHEDULE || j.status === JOB_STATUS.WON
  ).sort((a, b) => new Date(a.created_at) - new Date(b.created_at)); // oldest first

  // Jobs waiting on estimates
  const needsEstimate = stats.billingJobs.filter(j => j.status === JOB_STATUS.NEEDS_ESTIMATE)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  // Estimates sent, waiting for customer decision
  const estimateSent = stats.billingJobs.filter(j => j.status === JOB_STATUS.ESTIMATE_SENT)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  // Won jobs (approved, need scheduling)
  const wonJobs = stats.billingJobs.filter(j => j.status === JOB_STATUS.WON)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  const tabs = [
    {
      key: 'ready',
      label: '✅ Ready',
      jobs: readyToSchedule,
      color: '#22c55e',
      description: 'Approved and ready to put on the calendar'
    },
    {
      key: 'estimate',
      label: '📋 Estimate',
      jobs: needsEstimate,
      color: '#f59e0b',
      description: 'Need an estimate before scheduling'
    },
    {
      key: 'sent',
      label: '📤 Sent',
      jobs: estimateSent,
      color: '#06b6d4',
      description: 'Estimate sent, waiting on customer'
    },
  ];

  const activeTabData = tabs.find(t => t.key === activeTab);

  // Highlight jobs waiting 7+ days
  const urgentJobs = readyToSchedule.filter(j => daysSince(j.created_at) >= 7);

  return (
    <div style={{ padding: '12px' }}>
      <button
        onClick={onBack}
        style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '14px', cursor: 'pointer', marginBottom: '12px', padding: '4px 0' }}
      >
        ← Back to Dashboard
      </button>

      <div style={{ color: '#e2e8f0', fontSize: '20px', fontWeight: '800', marginBottom: '4px' }}>
        📊 Scheduling Pipeline
      </div>
      <div style={{ color: '#cbd5e1', fontSize: '13px', marginBottom: '16px' }}>
        {stats.pipelineValue > 0 && (
          <span style={{ color: '#22c55e', fontWeight: '700' }}>
            ${stats.pipelineValue.toLocaleString()} potential
          </span>
        )}
        {stats.pipelineValue > 0 && ' · '}
        {readyToSchedule.length} ready to book
      </div>

      {/* Urgent alert */}
      {urgentJobs.length > 0 && (
        <div style={{
          background: '#dc262620', border: '1px solid #dc2626',
          borderRadius: '12px', padding: '12px 16px', marginBottom: '16px',
          display: 'flex', alignItems: 'center', gap: '10px'
        }}>
          <span style={{ fontSize: '20px' }}>🔴</span>
          <div>
            <div style={{ color: '#fca5a5', fontSize: '14px', fontWeight: '700' }}>
              {urgentJobs.length} job{urgentJobs.length > 1 ? 's' : ''} waiting 7+ days to be scheduled
            </div>
            <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '2px' }}>
              Customer service risk — these need dates ASAP
            </div>
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid #334155', marginBottom: '16px' }}>
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              flex: 1, padding: '10px 4px', background: 'transparent', border: 'none',
              borderBottom: activeTab === tab.key ? `3px solid ${tab.color}` : '3px solid transparent',
              color: activeTab === tab.key ? '#e2e8f0' : '#64748b',
              fontSize: '12px', fontWeight: '600', cursor: 'pointer',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px'
            }}
          >
            <span>{tab.label}</span>
            <span style={{
              background: activeTab === tab.key ? tab.color : '#334155',
              color: activeTab === tab.key ? '#000' : '#94a3b8',
              padding: '1px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: '700'
            }}>
              {tab.jobs.length}
            </span>
          </button>
        ))}
      </div>

      {/* Tab description */}
      <div style={{ color: '#cbd5e1', fontSize: '12px', marginBottom: '12px' }}>
        {activeTabData?.description}
      </div>

      {/* Job list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {activeTabData?.jobs.length > 0 ? (
          activeTabData.jobs.map(job => {
            const age = daysSince(job.created_at);
            const isUrgent = age >= 7;
            return (
              <div
                key={job.id}
                onClick={() => onJobClick(job.id)}
                style={{
                  background: '#1e293b',
                  border: `1px solid ${isUrgent ? '#dc2626' : '#334155'}`,
                  borderRadius: '12px', padding: '14px 16px',
                  cursor: 'pointer'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: '#e2e8f0', fontSize: '15px', fontWeight: '700', marginBottom: '2px' }}>
                      {job.customer_name}
                    </div>
                    {job.issue && (
                      <div style={{ color: '#94a3b8', fontSize: '13px', marginBottom: '4px' }}>
                        {job.issue.length > 80 ? job.issue.substring(0, 80) + '…' : job.issue}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                      {job.job_number && (
                        <span style={{ color: '#94a3b8', fontSize: '11px', fontFamily: 'monospace' }}>
                          {job.job_number}
                        </span>
                      )}
                      {job.estimate_amount && (
                        <span style={{ color: '#22c55e', fontSize: '12px', fontWeight: '700' }}>
                          ${parseFloat(job.estimate_amount).toLocaleString()}
                        </span>
                      )}
                      <span style={{ color: '#94a3b8', fontSize: '11px' }}>
                        Created {formatDate(job.created_at)}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px', marginLeft: '12px' }}>
                    <AgeBadge days={age} />
                    <span style={{ color: '#94a3b8', fontSize: '11px' }}>→</span>
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div style={{ textAlign: 'center', padding: '40px', color: '#cbd5e1' }}>
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>✓</div>
            <div>Nothing in this stage</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// TODAY'S SCHEDULE SUMMARY
// ============================================

function TodaySchedule({ stats }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // Get today's scheduled jobs from assignments
  const [todayJobs, setTodayJobs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const assignments = await assignmentsApi.getAllSchedule(
          today.toISOString(),
          tomorrow.toISOString()
        );
        setTodayJobs(assignments);
      } catch (e) {
        console.error('Today schedule load error:', e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) return null;
  if (todayJobs.length === 0) return null;

  // Group by tech
  const byTech = {};
  todayJobs.forEach(j => {
    const name = assigneeOf(j) || 'Unassigned';
    if (!byTech[name]) byTech[name] = [];
    byTech[name].push(j);
  });

  return (
    <div style={{
      background: '#1e293b', borderRadius: '12px', padding: '16px', marginBottom: '16px',
      border: '1px solid #334155'
    }}>
      <div style={{ color: '#94a3b8', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', marginBottom: '10px' }}>
        📅 Today's Schedule
      </div>
      {Object.entries(byTech).map(([techName, jobs]) => (
        <div key={techName} style={{ marginBottom: '8px' }}>
          <div style={{ color: '#cbd5e1', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
            {techName} ({jobs.length})
          </div>
          {jobs.map(j => (
            <div key={j.assignment_id || j.id} style={{
              display: 'flex', justifyContent: 'space-between',
              padding: '4px 0', borderBottom: '1px solid #0f1729'
            }}>
              <span style={{ color: '#e2e8f0', fontSize: '13px' }}>{j.customer_name}</span>
              <span style={{ color: '#cbd5e1', fontSize: '12px' }}>
                {j.scheduled_for ? new Date(j.scheduled_for).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : '—'}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ============================================
// CALENDAR STATS WIDGET
// ============================================
// Pulls ALL data from Google Calendar - the source of truth
// Calendar IDs come from config/calendars.js (single source of truth).

const TECHS = [
  { id: 'austin', name: 'Austin', calendarId: CALENDARS.AUSTIN, color: '#3b82f6', hoursPerWeek: 32 },
  { id: 'jr',     name: 'JR',     calendarId: CALENDARS.JR,     color: '#22c55e', hoursPerWeek: 20 },
  { id: 'brian',  name: 'Brian',  calendarId: CALENDARS.TECH3,  color: '#3F51B5', hoursPerWeek: 32 },
  { id: 'subs',   name: 'Subs',   calendarId: CALENDARS.SUBS,   color: '#EC4899', hoursPerWeek: 40 },
];

const DONE_TAGS = ['[BILLED]', '[INVOICED]', '[COMPLETED]', '[IGNORE]', '[IGNORED]', '[INVOICE]', '[SCHEDULED]', '[MOVED TO QUEUE]'];
const BLOCKED_TAGS = ['[NEEDS PARTS]', '[BLOCKED]', '[WAITING]', '[ON HOLD]', '[PENDING PARTS]', '[NEEDS NOTES]'];
const TO_BILL_TAGS = ['[TO BILL]'];

function CalendarStatsWidget({ accessToken, onStatsLoaded }) {
  const [techData, setTechData] = useState({});
  const [calendarStats, setCalendarStats] = useState({
    projects: 0,
    returns: 0,
    service: 0,
    openTasks: 0,
    blocked: 0,
    readyToSchedule: 0,
    toBill: 0,
    needsNotes: 0,
    // Estimate pipeline
    needsEstimate: 0,
    estimatesSent: 0,
    estimatesWon: 0,
    pipelineValue: 0,
    // Projects with $ value
    projectsValue: 0,
    projectsList: [],
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accessToken) return;

    // Shared service (services/calendarApi.js); fail-soft to [] like before
    const fetchCalendarEvents = (calendarId, timeMin, timeMax) =>
      gcalFetchEvents(accessToken, calendarId, timeMin, timeMax).catch(() => []);

    const loadData = async () => {
      const now = new Date();
      const twoWeeksOut = new Date(now);
      twoWeeksOut.setDate(twoWeeksOut.getDate() + 14);
      const sixtyDaysOut = new Date(now);
      sixtyDaysOut.setDate(sixtyDaysOut.getDate() + 60);
      const ninetyDaysBack = new Date(now);
      ninetyDaysBack.setDate(ninetyDaysBack.getDate() - 90);

      // Fetch tech schedules for utilization
      const techResults = {};
      for (const tech of TECHS) {
        const events = await fetchCalendarEvents(tech.calendarId, now, twoWeeksOut);
        const scheduledHours = events
          .filter(e => {
            const title = (e.summary || '').toUpperCase();
            return !DONE_TAGS.some(tag => title.includes(tag));
          })
          .reduce((sum, e) => {
            const start = new Date(e.start?.dateTime || e.start?.date);
            const end = new Date(e.end?.dateTime || e.end?.date);
            return sum + (end - start) / (1000 * 60 * 60);
          }, 0);

        const totalCapacity = tech.hoursPerWeek * 2;
        techResults[tech.id] = {
          name: tech.name,
          color: tech.color,
          scheduledHours: Math.round(scheduledHours),
          totalCapacity,
          availableHours: Math.max(0, totalCapacity - Math.round(scheduledHours)),
          utilization: Math.round((scheduledHours / totalCapacity) * 100),
        };
      }
      setTechData(techResults);

      // Fetch all calendars (matching BoardView sources)
      const [queueEvents, returnEvents, austinEvents, jrEvents, brianEvents, subsEvents, installEvents, completedEvents, adminEvents, salesEvents] = await Promise.all([
        fetchCalendarEvents(CALENDARS.TENTATIVELY_SCHEDULED, ninetyDaysBack, sixtyDaysOut),
        fetchCalendarEvents(CALENDARS.RETURN_VISITS, ninetyDaysBack, sixtyDaysOut),
        fetchCalendarEvents(CALENDARS.AUSTIN, ninetyDaysBack, sixtyDaysOut),
        fetchCalendarEvents(CALENDARS.JR, ninetyDaysBack, sixtyDaysOut),
        fetchCalendarEvents(CALENDARS.TECH3, ninetyDaysBack, sixtyDaysOut),
        fetchCalendarEvents(CALENDARS.SUBS, ninetyDaysBack, sixtyDaysOut),
        fetchCalendarEvents(CALENDARS.INSTALLATIONS, ninetyDaysBack, sixtyDaysOut),
        fetchCalendarEvents(CALENDARS.COMPLETED, ninetyDaysBack, sixtyDaysOut),
        fetchCalendarEvents(CALENDARS.ADMIN_NOTES, ninetyDaysBack, sixtyDaysOut),
        fetchCalendarEvents(CALENDARS.SALES_ACCOUNTING, ninetyDaysBack, sixtyDaysOut),
      ]);

      // Ready to Schedule (Queue + Returns, no done/blocked tags)
      const readyItems = [...queueEvents, ...returnEvents].filter(e => {
        const title = (e.summary || '').toUpperCase();
        return !DONE_TAGS.some(tag => title.includes(tag)) && !BLOCKED_TAGS.some(tag => title.includes(tag));
      });

      // Open Tasks (Tech calendars, no done/blocked tags)
      const openTaskItems = [...austinEvents, ...jrEvents, ...brianEvents, ...subsEvents, ...installEvents].filter(e => {
        const title = (e.summary || '').toUpperCase();
        return !DONE_TAGS.some(tag => title.includes(tag)) && !BLOCKED_TAGS.some(tag => title.includes(tag));
      });

      // Blocked (all calendars with blocked tags - matching BoardView)
      const allEvents = [...queueEvents, ...returnEvents, ...austinEvents, ...jrEvents, ...brianEvents, ...subsEvents, ...installEvents, ...adminEvents, ...salesEvents];
      const blockedItems = allEvents.filter(e => {
        const title = (e.summary || '').toUpperCase();
        return BLOCKED_TAGS.some(tag => title.includes(tag));
      });

      // Needs Notes (specific blocked tag)
      const needsNotesItems = allEvents.filter(e => {
        const title = (e.summary || '').toUpperCase();
        return title.includes('[NEEDS NOTES]');
      });

      // To Bill (Completed calendar with [TO BILL] tag OR tech calendars with [TO BILL])
      const toBillItems = [...completedEvents, ...austinEvents, ...jrEvents, ...brianEvents, ...subsEvents, ...installEvents].filter(e => {
        const title = (e.summary || '').toUpperCase();
        return TO_BILL_TAGS.some(tag => title.includes(tag));
      });

      // Approved estimates from Supabase (for Projects column)
      let estimateCount = 0;
      let acceptedEstimates = [];
      try {
        const { data: accepted } = await supabase
          .from('jobs')
          .select('*')
          .eq('qbo_estimate_status', 'Accepted')
          .gt('remaining_amount', 0); // Only show projects with remaining balance
        acceptedEstimates = accepted || [];
        estimateCount = acceptedEstimates.length;
      } catch (e) { /* ignore */ }

      // Estimate Pipeline from Supabase
      let needsEstimate = 0;
      let estimatesSent = 0;
      let pipelineValue = 0;
      try {
        // Needs Estimate
        const { count: needsEst } = await supabase
          .from('jobs')
          .select('*', { count: 'exact', head: true })
          .or('status.eq.needs_estimate,status.eq.estimate_needed');
        needsEstimate = needsEst || 0;

        // Estimates Sent (Pending)
        const { data: pending } = await supabase
          .from('jobs')
          .select('*')
          .eq('qbo_estimate_status', 'Pending');
        estimatesSent = (pending || []).length;
        pipelineValue = (pending || []).reduce((sum, j) => sum + (parseFloat(j.estimate_amount) || 0), 0);
      } catch (e) { /* ignore */ }

      // Projects value (sum of REMAINING amounts, not total estimate)
      const projectsValue = acceptedEstimates.reduce((sum, j) => sum + (parseFloat(j.remaining_amount) || 0), 0);

      // Categorize ready items
      const projects = readyItems.filter(e => (e.summary || '').toLowerCase().includes('install')).length + estimateCount;
      const returns = readyItems.filter(e => {
        const title = (e.summary || '').toUpperCase();
        return title.includes('RETURN') || title.includes('[RETURN NEEDED]');
      }).length;
      const service = Math.max(0, readyItems.length - projects - returns + estimateCount);

      const stats = {
        projects,
        returns,
        service,
        openTasks: openTaskItems.length,
        blocked: blockedItems.length,
        readyToSchedule: readyItems.length + estimateCount,
        toBill: toBillItems.length,
        needsNotes: needsNotesItems.length,
        // Estimate pipeline
        needsEstimate,
        estimatesSent,
        estimatesWon: estimateCount,
        pipelineValue,
        // Projects with $ value
        projectsValue,
        projectsList: acceptedEstimates.slice(0, 5), // Top 5 for display
      };
      setCalendarStats(stats);
      
      // Pass stats up to parent
      if (onStatsLoaded) {
        onStatsLoaded(stats);
      }

      setLoading(false);
    };

    loadData();
  }, [accessToken, onStatsLoaded]);

  if (loading) {
    return (
      <div style={{ background: '#1e293b', borderRadius: '12px', padding: '16px', marginBottom: '16px', border: '1px solid #334155' }}>
        <div style={{ color: '#cbd5e1', fontSize: '13px' }}>Loading from calendars...</div>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: '16px' }}>
      {/* Tech Capacity */}
      <div style={{ background: '#1e293b', borderRadius: '12px', padding: '16px', marginBottom: '8px', border: '1px solid #334155' }}>
        <div style={{ color: '#94a3b8', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', marginBottom: '12px', display: 'flex', justifyContent: 'space-between' }}>
          <span>📊 Tech Capacity (2 weeks)</span>
          <a href="/scheduler" style={{ color: '#8b5cf6', textDecoration: 'none', fontSize: '11px' }}>Open Scheduler →</a>
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          {TECHS.map(tech => {
            const data = techData[tech.id] || {};
            return (
              <div key={tech.id} style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ color: '#e2e8f0', fontSize: '13px', fontWeight: '600' }}>{tech.name}</span>
                  <span style={{ color: data.utilization > 80 ? '#ef4444' : data.utilization > 60 ? '#f59e0b' : '#22c55e', fontSize: '12px', fontWeight: '600' }}>
                    {data.utilization || 0}%
                  </span>
                </div>
                <div style={{ background: '#0f172a', borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
                  <div style={{
                    width: `${Math.min(100, data.utilization || 0)}%`,
                    height: '100%',
                    background: data.utilization > 80 ? '#ef4444' : data.utilization > 60 ? '#f59e0b' : tech.color,
                    transition: 'width 0.3s',
                  }} />
                </div>
                <div style={{ color: '#cbd5e1', fontSize: '11px', marginTop: '4px' }}>
                  {data.availableHours || 0}h available / {data.totalCapacity || 0}h
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Key Metrics Grid - from Calendar */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
        <a href="/board" style={{ textDecoration: 'none' }}>
          <div style={{ background: '#1e293b', borderRadius: '12px', padding: '16px', border: '1px solid #334155' }}>
            <div style={{ color: '#3b82f6', fontSize: '36px', fontWeight: '800', lineHeight: 1 }}>
              {calendarStats.openTasks}
            </div>
            <div style={{ color: '#cbd5e1', fontSize: '12px', marginTop: '4px' }}>Open Tasks</div>
          </div>
        </a>
        <a href="/board" style={{ textDecoration: 'none' }}>
          <div style={{
            background: calendarStats.readyToSchedule > 0 ? '#22c55e15' : '#1e293b',
            borderRadius: '12px', padding: '16px',
            border: `1px solid ${calendarStats.readyToSchedule > 0 ? '#22c55e40' : '#334155'}`
          }}>
            <div style={{ color: '#22c55e', fontSize: '36px', fontWeight: '800', lineHeight: 1 }}>
              {calendarStats.readyToSchedule}
            </div>
            <div style={{ color: '#cbd5e1', fontSize: '12px', marginTop: '4px' }}>Ready to Schedule</div>
          </div>
        </a>
        <a href="/board" style={{ textDecoration: 'none' }}>
          <div style={{
            background: calendarStats.blocked > 0 ? '#ef444415' : '#1e293b',
            borderRadius: '12px', padding: '16px',
            border: `1px solid ${calendarStats.blocked > 0 ? '#ef444440' : '#334155'}`
          }}>
            <div style={{ color: '#ef4444', fontSize: '36px', fontWeight: '800', lineHeight: 1 }}>
              {calendarStats.blocked}
            </div>
            <div style={{ color: '#cbd5e1', fontSize: '12px', marginTop: '4px' }}>Blocked</div>
          </div>
        </a>
        <a href="/billing" style={{ textDecoration: 'none' }}>
          <div style={{
            background: calendarStats.toBill > 0 ? '#8b5cf615' : '#1e293b',
            borderRadius: '12px', padding: '16px',
            border: `1px solid ${calendarStats.toBill > 0 ? '#8b5cf640' : '#334155'}`
          }}>
            <div style={{ color: '#8b5cf6', fontSize: '36px', fontWeight: '800', lineHeight: 1 }}>
              {calendarStats.toBill}
            </div>
            <div style={{ color: '#cbd5e1', fontSize: '12px', marginTop: '4px' }}>To Bill</div>
          </div>
        </a>
      </div>

      {/* By Status - Board columns */}
      <div style={{ background: '#1e293b', borderRadius: '12px', padding: '16px', border: '1px solid #334155' }}>
        <div style={{ color: '#94a3b8', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', marginBottom: '10px', letterSpacing: '0.05em' }}>
          Board Status
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {[
            { label: 'Projects', count: calendarStats.projects, color: '#22c55e', icon: '🔨' },
            { label: 'Returns', count: calendarStats.returns, color: '#06b6d4', icon: '🔄' },
            { label: 'Service Calls', count: calendarStats.service, color: '#8b5cf6', icon: '🔧' },
            { label: 'Open Tasks', count: calendarStats.openTasks, color: '#3b82f6', icon: '📋' },
            { label: 'Blocked', count: calendarStats.blocked, color: '#ef4444', icon: '🚫' },
            { label: 'Needs Notes', count: calendarStats.needsNotes, color: '#f59e0b', icon: '📝' },
            { label: 'To Bill', count: calendarStats.toBill, color: '#8b5cf6', icon: '💰' },
          ].map(item => {
            const total = calendarStats.openTasks + calendarStats.readyToSchedule + calendarStats.blocked;
            const pct = total > 0 ? Math.round((item.count / total) * 100) : 0;
            return (
              <a
                key={item.label}
                href={item.label === 'To Bill' ? '/unbilled' : '/board'}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '7px 4px', textDecoration: 'none', borderRadius: '6px'
                }}
              >
                <span style={{ fontSize: '13px', width: '18px', textAlign: 'center' }}>{item.icon}</span>
                <span style={{ color: '#94a3b8', fontSize: '13px', flex: 1 }}>{item.label}</span>
                <span style={{ color: '#e2e8f0', fontSize: '13px', fontWeight: '700', width: '28px', textAlign: 'right' }}>{item.count}</span>
                <div style={{ width: '50px', height: '3px', background: '#0f1729', borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: item.color, borderRadius: '2px' }} />
                </div>
              </a>
            );
          })}
        </div>
      </div>

      {/* Estimate Pipeline */}
      <div style={{ background: '#1e293b', borderRadius: '12px', padding: '16px', marginTop: '8px', border: '1px solid #334155' }}>
        <div style={{ color: '#94a3b8', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', marginBottom: '10px', letterSpacing: '0.05em' }}>
          📊 Estimate Pipeline
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '10px' }}>
          <div style={{ color: '#22c55e', fontSize: '28px', fontWeight: '800' }}>
            ${calendarStats.pipelineValue.toLocaleString()}
          </div>
          <div style={{ color: '#cbd5e1', fontSize: '12px' }}>
            {calendarStats.estimatesSent} estimates out
          </div>
        </div>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <span style={{ background: '#f59e0b20', color: '#f59e0b', fontSize: '11px', fontWeight: '700', padding: '3px 10px', borderRadius: '20px' }}>
            {calendarStats.needsEstimate} Need Est.
          </span>
          <span style={{ background: '#06b6d420', color: '#06b6d4', fontSize: '11px', fontWeight: '700', padding: '3px 10px', borderRadius: '20px' }}>
            {calendarStats.estimatesSent} Sent
          </span>
          <span style={{ background: '#22c55e20', color: '#22c55e', fontSize: '11px', fontWeight: '700', padding: '3px 10px', borderRadius: '20px' }}>
            {calendarStats.estimatesWon} Won
          </span>
        </div>
      </div>

      {/* Active Projects with $ */}
      {calendarStats.projectsValue > 0 && (
        <div style={{ background: '#1e293b', borderRadius: '12px', padding: '16px', marginTop: '8px', border: '1px solid #22c55e40' }}>
          <div style={{ color: '#94a3b8', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', marginBottom: '10px', letterSpacing: '0.05em' }}>
            💰 Active Projects — Remaining to Bill
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '10px' }}>
            <div style={{ color: '#22c55e', fontSize: '28px', fontWeight: '800' }}>
              ${calendarStats.projectsValue.toLocaleString()}
            </div>
            <div style={{ color: '#cbd5e1', fontSize: '12px' }}>
              {calendarStats.estimatesWon} active projects
            </div>
          </div>
          {calendarStats.projectsList.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {calendarStats.projectsList.map((proj, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #334155' }}>
                  <span style={{ color: '#e2e8f0', fontSize: '13px' }}>{proj.customer_name}</span>
                  <span style={{ color: '#22c55e', fontSize: '13px', fontWeight: '600' }}>
                    ${(parseFloat(proj.remaining_amount) || 0).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================
// MAIN DASHBOARD
// ============================================

export default function OwnerDashboard({ accessToken, userEmail, userRole }) {
  const [stats, setStats] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [view, setView] = useState('dashboard'); // dashboard | pipeline | drilldown
  const [drilldown, setDrilldown] = useState(null); // { label, jobs }
  const [selectedJobId, setSelectedJobId] = useState(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await queries.getDashboardStats();
      setStats(data);
    } catch (e) {
      console.error('Dashboard load error:', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
  const { PullIndicator } = usePullToRefresh(loadData);

  if (isLoading || !stats) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: '#cbd5e1' }}>
        <PullIndicator />
        <div style={{ fontSize: '32px', marginBottom: '12px' }}>📊</div>
        Loading dashboard...
      </div>
    );
  }

  // ============================================
  // ALERTS — the most important things right now
  // ============================================
  const alerts = [];

  // #1: Approved jobs waiting to be scheduled (THE critical pain point)
  const approvedNotScheduled = stats.allJobs.filter(j =>
    (j.status === JOB_STATUS.READY_TO_SCHEDULE || j.status === JOB_STATUS.WON) &&
    daysSince(j.created_at) >= 7
  );
  if (approvedNotScheduled.length > 0) {
    alerts.push({
      icon: '🔴',
      text: `${approvedNotScheduled.length} approved job${approvedNotScheduled.length > 1 ? 's' : ''} waiting 7+ days to schedule`,
      urgency: 'critical',
      action: () => setView('pipeline'),
      jobs: approvedNotScheduled
    });
  }

  // #2: Jobs older than 7 days (not scheduled)
  const oldUnscheduled = stats.allJobs.filter(j =>
    daysSince(j.created_at) >= 7 &&
    j.status !== JOB_STATUS.SCHEDULED &&
    j.status !== JOB_STATUS.COMPLETE &&
    j.status !== JOB_STATUS.READY_TO_SCHEDULE &&
    j.status !== JOB_STATUS.WON
  );
  if (oldUnscheduled.length > 0) {
    alerts.push({
      icon: '⚠️',
      text: `${oldUnscheduled.length} task${oldUnscheduled.length > 1 ? 's' : ''} older than 7 days`,
      urgency: 'warning',
      action: () => setDrilldown({ label: 'Old Tasks (7+ days)', jobs: oldUnscheduled }) || setView('drilldown'),
      jobs: oldUnscheduled
    });
  }

  // #3: Returns pending
  if (stats.returnsPending > 0) {
    const returnJobs = stats.allJobs.filter(j => j.status === JOB_STATUS.RETURN_PENDING);
    alerts.push({
      icon: '🔄',
      text: `${stats.returnsPending} return${stats.returnsPending > 1 ? 's' : ''} pending`,
      urgency: 'info',
      action: () => { setDrilldown({ label: 'Returns Pending', jobs: returnJobs }); setView('drilldown'); },
      jobs: returnJobs
    });
  }

  // #4: Waiting on parts
  if (stats.waitingOnParts > 0) {
    const partsJobs = stats.allJobs.filter(j => j.status === JOB_STATUS.NEEDS_PARTS);
    alerts.push({
      icon: '📦',
      text: `${stats.waitingOnParts} waiting on parts`,
      urgency: 'info',
      action: () => { setDrilldown({ label: 'Waiting on Parts', jobs: partsJobs }); setView('drilldown'); },
      jobs: partsJobs
    });
  }

  // #5: To-bill missing notes
  const missingNotes = stats.billingJobs.filter(j => j.status === JOB_STATUS.TO_BILL && !j.completion_notes?.trim());
  if (missingNotes.length > 0) {
    alerts.push({
      icon: '💵',
      text: `${missingNotes.length} to-bill job${missingNotes.length > 1 ? 's' : ''} missing notes`,
      urgency: 'warning',
      action: () => { setDrilldown({ label: 'To Bill — Missing Notes', jobs: missingNotes }); setView('drilldown'); },
      jobs: missingNotes
    });
  }

  const alertColors = { critical: '#dc2626', warning: '#f59e0b', info: '#64748b' };

  // ============================================
  // PIPELINE VIEW
  // ============================================
  if (view === 'pipeline') {
    return (
      <div>
        <PullIndicator />
        <SchedulingPipeline
          stats={stats}
          onJobClick={(id) => setSelectedJobId(id)}
          onBack={() => setView('dashboard')}
        />
        {selectedJobId && (
          <JobDetail
            jobId={selectedJobId}
            onClose={() => setSelectedJobId(null)}
            onUpdate={loadData}
            accessToken={accessToken}
            userEmail={userEmail}
            userRole={userRole}
          />
        )}
      </div>
    );
  }

  // ============================================
  // DRILLDOWN VIEW
  // ============================================
  if (view === 'drilldown' && drilldown) {
    return (
      <div style={{ padding: '12px' }}>
        <PullIndicator />
        <button
          onClick={() => { setView('dashboard'); setDrilldown(null); }}
          style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '14px', cursor: 'pointer', marginBottom: '12px', padding: '4px 0' }}
        >
          ← Back to Dashboard
        </button>
        <div style={{ color: '#e2e8f0', fontSize: '18px', fontWeight: '700', marginBottom: '12px' }}>
          {drilldown.label} ({drilldown.jobs.length})
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {drilldown.jobs.map(j => (
            <JobCard key={j.id} job={j} onClick={() => setSelectedJobId(j.id)} />
          ))}
        </div>
        {selectedJobId && (
          <JobDetail
            jobId={selectedJobId}
            onClose={() => setSelectedJobId(null)}
            onUpdate={loadData}
            accessToken={accessToken}
            userEmail={userEmail}
            userRole={userRole}
          />
        )}
      </div>
    );
  }

  // ============================================
  // MAIN DASHBOARD VIEW
  // ============================================

  return (
    <div style={{ padding: '12px 12px 20px' }}>
      <PullIndicator />

      {/* Date + greeting */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ color: '#e2e8f0', fontSize: '20px', fontWeight: '800' }}>
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </div>
        <div style={{ color: '#cbd5e1', fontSize: '13px', marginTop: '2px' }}>
          DRH Security — Owner View
        </div>
      </div>

      {/* STUCK ALERTS — real-time flags from GCal + Supabase */}
      <StuckAlertsPanel accessToken={accessToken} />

      {/* ALERTS — top priority */}
      {alerts.length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          <div style={{ color: '#94a3b8', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', marginBottom: '8px', letterSpacing: '0.05em' }}>
            ⚡ Needs Attention
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {alerts.map((alert, i) => (
              <div
                key={i}
                onClick={alert.action}
                style={{
                  background: '#1e293b',
                  border: `1px solid ${alertColors[alert.urgency]}40`,
                  borderLeft: `4px solid ${alertColors[alert.urgency]}`,
                  borderRadius: '10px', padding: '12px 14px',
                  display: 'flex', alignItems: 'center', gap: '10px',
                  cursor: 'pointer'
                }}
              >
                <span style={{ fontSize: '18px' }}>{alert.icon}</span>
                <span style={{ color: '#e2e8f0', fontSize: '13px', flex: 1, fontWeight: alert.urgency === 'critical' ? '600' : '400' }}>
                  {alert.text}
                </span>
                <span style={{ color: '#94a3b8', fontSize: '14px' }}>→</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CALENDAR STATS - Source of truth */}
      <CalendarStatsWidget accessToken={accessToken} />

      {/* GAP REPORT WIDGET — Money sitting unscheduled or unbilled */}
      <GapReportWidget onDrilldown={(jobs) => { setDrilldown({ label: 'Revenue Gap', jobs }); setView('drilldown'); }} />

      {/* TODAY'S SCHEDULE */}
      <TodaySchedule stats={stats} />

      {/* P&L SECTION */}
      <div style={{ marginBottom: '16px' }}>
        <PLDashboard userEmail={userEmail} />
      </div>

      {/* Job Detail Modal */}
      {selectedJobId && (
        <JobDetail
          jobId={selectedJobId}
          onClose={() => setSelectedJobId(null)}
          onUpdate={loadData}
          accessToken={accessToken}
          userEmail={userEmail}
          userRole={userRole}
        />
      )}
    </div>
  );
}
