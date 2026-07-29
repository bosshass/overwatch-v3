// ============================================
// DEMOTED 9.11.1 — legacy surfaces only.
// Board, My Tasks, /j/ links and Work Today all render TicketSheet now.
// This component survives ONLY because OwnerDashboard, OfficeHub and
// TechCalendar still mount it. Do not add features here; when those three
// move to TicketSheet, delete this file (~1,300 lines).
// ============================================
// ============================================
// JUC-E V4 - JobDetail Component (Redesigned)
// ============================================
// Two modes:
// 1. EXECUTION MODE (scheduled jobs) — clean, focused, matches field UI mockup
// 2. ADMIN MODE (all other statuses) — full operator controls
//
// The execution view is what techs see on-site:
//   Customer name → badges → address → issue → HOW'D IT GO? → notes
//   Nothing else. Zero clutter.

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { jobsApi, assignmentsApi, techsApi, notesApi, STATUS_INFO, JOB_STATUS, queries, supabase } from '../services/supabase.js';
import { JOB_TYPE_INFO, PRIORITY_INFO, getJobAge, getAgeUrgency, VALID_TRANSITIONS, ACTIONS, PRE_SCHEDULE_CHECKLIST, getChecklistState, getChecklistBlockers, INSTALL_TYPES, stripIntakeTemplate, parsePhoneNumbers } from '../utils/statusMachine.js';
import { findDuplicateJobs } from '../utils/fuzzyMatch.js';
import { notifyJobComplete, notifyStatusChange } from '../services/pushNotifications.js';
import { CALENDARS } from '../config/calendars.js';
import NotesPanel from './NotesPanel.jsx';
import MoveStatus from './MoveStatus.jsx';
import FieldVisits from './FieldVisits.jsx';
// ScheduleModal DELETED 9.10.7. It was a fifth scheduler with its own
// "tentative" mode that wrote a 📌 note and nothing else — no tentative_date,
// no Tent event, no board column — and could set status=SCHEDULED through
// jobsApi.changeStatus, dodging every guard. It is the writer behind events
// that said "scheduled" while the job said tentative while the owner said
// Shana. One scheduler now: VisualSchedulerModal, same as everywhere else.
import VisualSchedulerModal from './VisualSchedulerModal.jsx';
import RescheduleModal from './RescheduleModal.jsx';
import InstallationApprovalModal from './InstallationApprovalModal.jsx';

// The customer dedup effort left merge-audit text sitting directly in
// customers.notes on ~341 rows ("MERGED FROM CS123, CS456…"). That's an audit
// trail, not a customer-service comment, and it doesn't belong in the
// customer-info box a tech reads on-site. Suppress it there; the raw field is
// untouched in the database for whoever needs the audit trail directly.
const isMergeAuditText = (text) => /merged|merge audit/i.test(text || '');

export default function JobDetail({ jobId, onClose, onUpdate, accessToken, userEmail, userRole }) {
  const navigate = useNavigate();
  const [job, setJob] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState(null);
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const [statusNote, setStatusNote] = useState('');
  const [showTypePicker, setShowTypePicker] = useState(false);
  const [showPriorityPicker, setShowPriorityPicker] = useState(false);
  const [showAdminSection, setShowAdminSection] = useState(false);
  const [loadError, setLoadError] = useState('');

  const [showTimeCapture, setShowTimeCapture] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const [timeArrived, setTimeArrived] = useState('');
  const [timeDeparted, setTimeDeparted] = useState('');
  const [completionNotes, setCompletionNotes] = useState('');

  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [schedTechs, setSchedTechs] = useState([]);
  useEffect(() => {
    techsApi.getAll().then(setSchedTechs).catch(async () => {
      const { data } = await supabase.from('techs').select('*').order('name');
      setSchedTechs(data || []);
    });
  }, []);
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [showApprovalModal, setShowApprovalModal] = useState(false);

  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [potentialDuplicates, setPotentialDuplicates] = useState([]);
  const [selectedMergeTarget, setSelectedMergeTarget] = useState(null);
  const [isMerging, setIsMerging] = useState(false);

  const [showPartsForm, setShowPartsForm] = useState(false);
  const [partsNeeded, setPartsNeeded] = useState('');
  const [partsOrderedBy, setPartsOrderedBy] = useState('');
  const [partsETA, setPartsETA] = useState('');

  const [manualChecks, setManualChecks] = useState({});
  const [linkedCustomer, setLinkedCustomer] = useState(null);
  const [showChecklistWarning, setShowChecklistWarning] = useState(false);
  const [pendingScheduleAction, setPendingScheduleAction] = useState(null);

  // Billing modal (info@ only)
  const [showBillingModal, setShowBillingModal] = useState(false);
  const [billedAmount, setBilledAmount] = useState('');
  const [billingNote, setBillingNote] = useState('');

  const isOperator = userRole === 'operator';

  // ============================================
  // DATA LOADING
  // ============================================

  const loadJob = useCallback(async () => {
    if (!jobId) return;
    setIsLoading(true);
    setLoadError('');
    try {
      const data = await jobsApi.getById(jobId);
      if (!data) { setLoadError('That job could not be found.'); return; }
      setJob(data);
      const assigns = await assignmentsApi.getForJob(jobId);
      setAssignments(assigns);
      try {
        const saved = data.checklist_overrides ? (typeof data.checklist_overrides === 'string' ? JSON.parse(data.checklist_overrides) : data.checklist_overrides) : {};
        setManualChecks(saved);
      } catch { setManualChecks({}); }
      if (data.customer_id) {
        try {
          const { data: cust } = await supabase.from('customers').select('*').eq('id', data.customer_id).maybeSingle();
          setLinkedCustomer(cust);
        } catch { setLinkedCustomer(null); }
      } else { setLinkedCustomer(null); }
    } catch (e) {
      // This used to only console.error and leave `job` null — which renders
      // as a totally blank screen with zero indication anything went wrong.
      // Surface it instead.
      console.error('Job load error:', e);
      setLoadError(e.message || 'Something went wrong loading this job.');
    } finally {
      setIsLoading(false);
    }
  }, [jobId]);

  useEffect(() => { loadJob(); }, [loadJob]);

  // ============================================
  // ACTION HANDLERS
  // ============================================

  const findPotentialDuplicates = useCallback(async (auto = false) => {
    if (!job) return;
    try {
      // Was: exact-match or substring-containment only, e.g.
      // "sainati".includes("santini") — which is false either direction, so
      // this could never catch a phonetic near-miss or a "Jerry Allen" vs
      // "JAllen" spelling variant. That's the actual reason duplicates have
      // kept slipping through despite this tool existing. Now uses the same
      // calibrated fuzzy matcher used for the automatic on-load check.
      const dupes = await findDuplicateJobs(job.customer_name, job.id);
      const byAddress = job.customer_address ? await (async () => {
        const { data } = await supabase.from('jobs').select('*')
          .not('status', 'eq', 'archived').limit(500);
        const addr1 = job.customer_address.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 15);
        return (data || []).filter(j => j.id !== job.id && j.customer_address &&
          addr1.length > 5 && j.customer_address.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 15) === addr1);
      })() : [];
      const byId = job.customer_id ? await (async () => {
        const { data } = await supabase.from('jobs').select('*')
          .eq('customer_id', job.customer_id).not('status', 'eq', 'archived').limit(500);
        return (data || []).filter(j => j.id !== job.id);
      })() : [];
      const merged = [...dupes, ...byAddress, ...byId];
      const seen = new Set();
      const matches = merged.filter(j => (seen.has(j.id) ? false : (seen.add(j.id), true)));
      matches.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      setPotentialDuplicates(matches);
      if (!auto) setShowDuplicateModal(true);
    } catch (e) {
      console.error('Duplicate search error:', e);
      if (!auto) alert('Error searching for duplicates: ' + e.message);
    }
  }, [job]);

  // Force the duplicate flag automatically — this used to require someone
  // to remember to tap "Check duplicates." Runs once per job id loaded, not
  // on every subsequent update (notes, status changes) to the same job.
  useEffect(() => { if (job) findPotentialDuplicates(true); }, [job?.id, findPotentialDuplicates]);

  const handleMerge = async () => {
    if (!selectedMergeTarget || isMerging) return;
    setIsMerging(true);
    try {
      const targetJob = potentialDuplicates.find(j => j.id === selectedMergeTarget);
      const mergeNote = [
        `🔗 MERGED FROM JOB #${job.job_number || job.id.slice(0,8)}`,
        `Customer: ${job.customer_name}`,
        `Issue: ${job.issue || 'N/A'}`,
        `Merged on: ${new Date().toLocaleDateString()}`
      ].join('\n');
      await notesApi.addNote(selectedMergeTarget, mergeNote, userEmail);
      await notesApi.addNote(job.id, `[MERGED INTO JOB #${targetJob?.job_number || selectedMergeTarget.slice(0,8)}]`, userEmail);
      await jobsApi.changeStatus(job.id, JOB_STATUS.ARCHIVED, userEmail, `Merged into job #${targetJob?.job_number || selectedMergeTarget.slice(0,8)}`);
      setShowDuplicateModal(false);
      onUpdate?.();
      onClose();
    } catch (e) {
      console.error('Merge error:', e);
      alert('Error merging jobs: ' + e.message);
    } finally {
      setIsMerging(false);
    }
  };

  const handleNeedsParts = async () => {
    if (!partsNeeded.trim()) return;
    setActionInProgress('parts');
    try {
      const partsNote = [
        `📦 PARTS NEEDED (${new Date().toLocaleDateString()})`,
        `Parts: ${partsNeeded.trim()}`,
        partsOrderedBy ? `Ordered by: ${partsOrderedBy}` : null,
        partsETA ? `ETA: ${partsETA}` : null
      ].filter(Boolean).join('\n');
      await jobsApi.addNote(job.id, partsNote, userEmail);
      await jobsApi.changeStatus(job.id, JOB_STATUS.NEEDS_PARTS, userEmail, partsNote);
      setShowPartsForm(false);
      setPartsNeeded(''); setPartsOrderedBy(''); setPartsETA('');
      await loadJob();
      onUpdate?.();
    } catch (e) { console.error('Parts error:', e); }
    finally { setActionInProgress(null); }
  };

  const handleStatusChange = async (newStatus) => {
    if (newStatus === JOB_STATUS.BILLED && !job.completion_notes?.trim()) {
      alert('⚠️ Cannot mark as Billed — completion notes are required.');
      return;
    }
    if (newStatus === JOB_STATUS.BILLED && INSTALL_TYPES.includes(job.job_type) && !job.manager_approved_by) {
      alert('⚠️ Cannot mark as Billed — installation requires manager approval first.');
      return;
    }
    if (actionInProgress) return;
    setActionInProgress(newStatus);
    try {
      await jobsApi.changeStatus(job.id, newStatus, userEmail, statusNote || null);
      setStatusNote(''); setShowStatusPicker(false);
      await loadJob();
      onUpdate?.();
    } catch (e) { console.error('Status change error:', e); }
    finally { setActionInProgress(null); }
  };

  // Handle billing with $ amount + move to Completed calendar
  const isInfoUser = userEmail?.toLowerCase()?.includes('info@drhsecurityservices.com') || userEmail?.toLowerCase()?.includes('sara@jnbllc.com');
  
  const handleBilledSubmit = async () => {
    if (actionInProgress) return;
    setActionInProgress(JOB_STATUS.BILLED);
    try {
      // Save billed amount
      const updateData = { billed_amount: parseFloat(billedAmount) || 0 };
      if (billingNote.trim()) updateData.billing_notes = billingNote.trim();
      await jobsApi.update(job.id, updateData, userEmail);

      // Change status to BILLED
      await jobsApi.changeStatus(job.id, JOB_STATUS.BILLED, userEmail, billingNote || null);

      // Move GCal event to Completed calendar
      if (accessToken && assignments.length > 0) {
        for (const a of assignments) {
          if (!a.calendar_event_id) continue;
          try {
            const techCalendars = [
              CALENDARS.DRH_TECH_1, CALENDARS.JR_APPOINTMENT, CALENDARS.TECH3, CALENDARS.SUBS,
              CALENDARS.SHANA, CALENDARS.INSTALLATIONS, CALENDARS.SARA_TASKS, CALENDARS.SERVICE_QUEUE
            ];
            for (const srcCal of techCalendars) {
              try {
                const moveUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(srcCal)}/events/${encodeURIComponent(a.calendar_event_id)}/move?destination=${encodeURIComponent(CALENDARS.COMPLETED)}`;
                const res = await fetch(moveUrl, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } });
                if (res.ok) { console.log(`✓ Moved event to Completed from ${srcCal}`); break; }
              } catch (_) {}
            }
          } catch (e) { console.warn('Move to Completed failed:', e); }
        }
      }

      setShowBillingModal(false);
      setBilledAmount('');
      setBillingNote('');
      await loadJob();
      onUpdate?.();
    } catch (e) {
      console.error('Billing error:', e);
      alert('Error billing: ' + e.message);
    } finally { setActionInProgress(null); }
  };

  const toggleChecklistItem = async (itemId) => {
    const updated = { ...manualChecks, [itemId]: !manualChecks[itemId] };
    setManualChecks(updated);
    try {
      await jobsApi.update(job.id, { checklist_overrides: updated }, userEmail);
    } catch (e) { console.warn('Checklist save failed:', e); }
  };

  const attemptSchedule = () => {
    const checkState = getChecklistState(job, assignments, manualChecks);
    const blockers = getChecklistBlockers(checkState);
    if (blockers.length > 0) {
      setPendingScheduleAction(true);
      setShowChecklistWarning(true);
    } else {
      setShowScheduleModal(true);
    }
  };

  const startCompletion = (action) => {
    setPendingAction(action);
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    setTimeDeparted(`${hh}:${mm}`);
    setTimeArrived('');
    setCompletionNotes('');
    setShowTimeCapture(true);
  };

  const submitCompletion = async (completionData) => {
    if (!pendingAction) return;
    setActionInProgress(pendingAction.toStatus);
    try {
      const today = new Date().toISOString().split('T')[0];
      const tArrived = completionData?.timeArrived || timeArrived;
      const tDeparted = completionData?.timeDeparted || timeDeparted;
      const notes = completionData?.completionNotes || completionNotes;
      const timeIn = tArrived ? `${today}T${tArrived}:00` : null;
      const timeOut = tDeparted ? `${today}T${tDeparted}:00` : null;
      const actualHours = (timeIn && timeOut)
        ? (new Date(timeOut) - new Date(timeIn)) / (1000 * 60 * 60)
        : null;
      const activeAssignment = assignments.find(a => !a.is_complete);
      // Keep the assignment record in sync IF one exists (scheduling history)
      if (activeAssignment) {
        await assignmentsApi.markComplete(
          activeAssignment.id, timeIn, timeOut, notes || null, null, null
        );
      }
      // SOURCE OF TRUTH: always write time to the JOB row, assignment or not.
      // (changeStatus below writes completion_notes; this writes the time.)
      await jobsApi.update(job.id, {
        time_in: timeIn,
        time_out: timeOut,
        actual_hours: actualHours
      }, userEmail);
      await jobsApi.changeStatus(job.id, pendingAction.toStatus, userEmail, notes || null);
      if (pendingAction.toStatus === JOB_STATUS.COMPLETED || pendingAction.toStatus === JOB_STATUS.ARCHIVED) {
        const techName = activeAssignment?.tech?.name || 'Tech';
        notifyJobComplete(techName, job.customer_name);
      } else {
        notifyStatusChange(job.customer_name, STATUS_INFO[pendingAction.toStatus]?.label || pendingAction.toStatus);
      }
      if (pendingAction.toStatus === JOB_STATUS.NEEDS_PARTS) {
        try {
          const allTechs = await techsApi.getAll();
          const jr = allTechs.find(t => t.name?.toLowerCase() === 'jr');
          if (jr) await assignmentsApi.create({ job_id: job.id, tech_id: jr.id, scheduled_for: null }, userEmail);
        } catch (e) { console.error('Auto-assign to JR error:', e); }
      }
      setShowTimeCapture(false);
      setPendingAction(null);
      await loadJob();
      onUpdate?.();
    } catch (e) { console.error('Completion error:', e); }
    finally { setActionInProgress(null); }
  };

  const handleApproval = async (approvalData) => {
    try {
      await jobsApi.update(job.id, {
        manager_approved_by: approvalData.approvedBy,
        manager_approved_at: approvalData.approvedAt,
        manager_approval_notes: approvalData.approvalNotes
      }, userEmail);
      setShowApprovalModal(false);
      await loadJob();
      onUpdate?.();
    } catch (e) {
      console.error('Approval error:', e);
      alert('Error approving installation: ' + e.message);
    }
  };

  const getQuickActions = () => {
    if (!job) return [];
    const status = job.status;
    const actions = [];
    switch (status) {
      case JOB_STATUS.NEW:
        actions.push(ACTIONS.SCHEDULE, ACTIONS.MARK_READY, ACTIONS.NEEDS_DETAILS, ACTIONS.COMPLETE_SALES, ACTIONS.MARK_DEAD); break;
      case JOB_STATUS.NEEDS_DETAILS:
        actions.push(ACTIONS.SCHEDULE, ACTIONS.MARK_READY, ACTIONS.NEEDS_PARTS, ACTIONS.COMPLETE_SALES); break;
      case JOB_STATUS.NEEDS_PARTS:
        actions.push(ACTIONS.SCHEDULE, ACTIONS.MATERIALS_IN); break;
      case JOB_STATUS.PENDING_DECISION:
        actions.push(ACTIONS.SCHEDULE, ACTIONS.MARK_READY, ACTIONS.NEEDS_PARTS, ACTIONS.COMPLETE_SALES); break;
      case JOB_STATUS.READY_TO_SCHEDULE:
        actions.push(ACTIONS.SCHEDULE); break;
      case JOB_STATUS.SCHEDULED: break;
      case JOB_STATUS.COMPLETE:
        actions.push(ACTIONS.MARK_BILLED, ACTIONS.COMPLETE_RETURN); break;
      case JOB_STATUS.TO_BILL:
        if (INSTALL_TYPES.includes(job.job_type) && !job.manager_approved_by) {
          if (isOperator) actions.push({ label: '✅ Approve Installation', action: () => setShowApprovalModal(true), color: '#22c55e' });
        } else { actions.push(ACTIONS.MARK_BILLED); }
        break;
      case JOB_STATUS.NEEDS_ESTIMATE:
        actions.push(ACTIONS.SEND_ESTIMATE, ACTIONS.MARK_DEAD); break;
      case JOB_STATUS.ESTIMATE_SENT:
        actions.push(ACTIONS.MARK_WON, ACTIONS.MARK_LOST); break;
      case JOB_STATUS.WON:
        actions.push(ACTIONS.SCHEDULE, ACTIONS.MARK_READY); break;
      case JOB_STATUS.RETURN_PENDING:
        actions.push(ACTIONS.SCHEDULE, ACTIONS.MARK_READY); break;
      case JOB_STATUS.BILLED:
        if (isOperator) actions.push(ACTIONS.ARCHIVE); break;
      default: break;
    }
    return actions;
  };

  const formatDateTime = (dateStr) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    const now = new Date();
    const sameYear = d.getFullYear() === now.getFullYear();
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), hour: 'numeric', minute: '2-digit' });
  };

  const formatTimeOnly = (dateStr) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  // ============================================
  // LOADING / ERROR
  // ============================================

  if (isLoading) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#0f1729', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#cbd5e1' }}>Loading...</div>
      </div>
    );
  }
  if (!job) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#0f1729', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ textAlign: 'center', color: '#e2e8f0' }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>{loadError || 'That job could not be found.'}</div>
          <button onClick={onClose}
            style={{ background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', borderRadius: 8, padding: '9px 16px', fontSize: 14, cursor: 'pointer' }}>
            Back to board
          </button>
        </div>
      </div>
    );
  }

  const typeInfo = JOB_TYPE_INFO[job.job_type] || JOB_TYPE_INFO.service;
  // Strip the intake form's fixed header — see stripIntakeTemplate for why.
  // If the whole "issue" was nothing but that template, this is '' and the
  // Issue box below doesn't render at all rather than showing an empty shell.
  const cleanIssue = stripIntakeTemplate(job.issue);
  const statusInfo = STATUS_INFO[job.status] || {};
  const quickActions = getQuickActions();
  const validNextStatuses = VALID_TRANSITIONS[job.status] || [];
  const isScheduled = job.status === JOB_STATUS.SCHEDULED;

  const activeAssign = assignments.find(a => !a.is_complete);
  const techName = activeAssign?.tech?.name || null;
  const scheduledDate = activeAssign?.scheduled_for
    ? new Date(activeAssign.scheduled_for).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null;
  const scheduledTime = activeAssign?.scheduled_for
    ? new Date(activeAssign.scheduled_for).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : null;

  // Completion buttons config
  const completionButtons = [
    { ...ACTIONS.COMPLETE_FIXED,  icon: '✓', bg: '#22c55e', label: 'All Fixed' },
    { ...ACTIONS.COMPLETE_RETURN, icon: '↩', bg: '#f97316', label: 'Return Needed' },
    { ...ACTIONS.COMPLETE_SALES,  icon: '$', bg: '#eab308', label: 'Sales Opportunity' },
    { ...ACTIONS.COMPLETE_PARTS,  icon: '📦', bg: '#3b82f6', label: 'Pending Parts' },
    { ...ACTIONS.COMPLETE_NC,     icon: '✕', bg: '#ef4444', label: 'No Charge' },
  ];

  // ============================================
  // SHARED SUB-RENDERS
  // ============================================

  const renderAdminControls = () => (
    <>
      {!showStatusPicker ? (
        <button onClick={() => setShowStatusPicker(true)}
          style={{ background: 'none', border: '1px solid #334155', borderRadius: '8px', color: '#cbd5e1', padding: '10px 16px', fontSize: '13px', cursor: 'pointer', width: '100%', textAlign: 'center' }}>
          Change status manually...
        </button>
      ) : (
        <div style={{ background: '#1e293b', borderRadius: '10px', padding: '12px', marginTop: '8px' }}>
          <div style={{ color: '#94a3b8', fontSize: '12px', marginBottom: '8px' }}>Move to:</div>
          <input value={statusNote} onChange={e => setStatusNote(e.target.value)}
            placeholder="Add note for this change (optional)"
            style={{ width: '100%', background: '#0f1729', border: '1px solid #334155', borderRadius: '8px', color: '#e2e8f0', padding: '8px 12px', fontSize: '13px', marginBottom: '8px', outline: 'none', boxSizing: 'border-box' }} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {/* SCHEDULED is excluded on purpose — this raw picker was the last
                back door for marking a job scheduled with no date, no tech and
                no calendar event. Booking goes through the scheduler, period. */}
            {validNextStatuses
              .filter(s => s !== JOB_STATUS.SCHEDULED)
              .filter(s => s !== JOB_STATUS.ARCHIVED || isOperator).map(s => {
              const info = STATUS_INFO[s];
              return (
                <button key={s} onClick={() => handleStatusChange(s)} disabled={actionInProgress !== null}
                  style={{ background: `${info.color}15`, color: info.color, border: `1px solid ${info.color}30`, borderRadius: '6px', padding: '6px 12px', fontSize: '12px', cursor: 'pointer', fontWeight: '500' }}>
                  {info.label}
                </button>
              );
            })}
            <button onClick={() => setShowStatusPicker(false)}
              style={{ background: '#334155', color: '#94a3b8', border: 'none', borderRadius: '6px', padding: '6px 12px', fontSize: '12px', cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}
    </>
  );

  const renderPartsModal = () => {
    if (!showPartsForm) return null;
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ background: '#1e293b', borderRadius: '16px', width: '100%', maxWidth: '400px', padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div style={{ color: '#f59e0b', fontWeight: '700', fontSize: '16px' }}>📦 What parts are needed?</div>
            <button onClick={() => setShowPartsForm(false)} style={{ background: 'none', border: 'none', color: '#cbd5e1', fontSize: '24px', cursor: 'pointer' }}>×</button>
          </div>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ color: '#94a3b8', fontSize: '12px', display: 'block', marginBottom: '6px' }}>Parts Needed *</label>
            <textarea value={partsNeeded} onChange={e => setPartsNeeded(e.target.value)}
              placeholder="e.g. 2x motion sensors, 1x panel battery..."
              rows={3} autoFocus
              style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: '8px', color: '#e2e8f0', padding: '12px', fontSize: '14px', resize: 'vertical', boxSizing: 'border-box' }} />
          </div>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ color: '#94a3b8', fontSize: '12px', display: 'block', marginBottom: '6px' }}>Ordered by (optional)</label>
            <input value={partsOrderedBy} onChange={e => setPartsOrderedBy(e.target.value)}
              placeholder="JR, Austin, Amazon order #..."
              style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: '8px', color: '#e2e8f0', padding: '12px', fontSize: '14px', boxSizing: 'border-box' }} />
          </div>
          <div style={{ marginBottom: '20px' }}>
            <label style={{ color: '#94a3b8', fontSize: '12px', display: 'block', marginBottom: '6px' }}>Expected arrival (optional)</label>
            <input value={partsETA} onChange={e => setPartsETA(e.target.value)}
              placeholder="Tomorrow, Friday, 2-3 days..."
              style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: '8px', color: '#e2e8f0', padding: '12px', fontSize: '14px', boxSizing: 'border-box' }} />
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button onClick={() => setShowPartsForm(false)}
              style={{ flex: 1, padding: '12px', background: '#334155', color: '#e2e8f0', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>Cancel</button>
            <button onClick={handleNeedsParts} disabled={!partsNeeded.trim() || actionInProgress === 'parts'}
              style={{ flex: 1, padding: '12px', background: partsNeeded.trim() ? '#f59e0b' : '#334155', color: partsNeeded.trim() ? '#000' : '#64748b', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: '600', cursor: partsNeeded.trim() ? 'pointer' : 'default' }}>
              {actionInProgress === 'parts' ? 'Saving...' : '📦 Mark Waiting on Parts'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderDuplicateModal = () => {
    if (!showDuplicateModal) return null;
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ background: '#1e293b', borderRadius: '16px', width: '100%', maxWidth: '400px', maxHeight: '80vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '16px', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ color: '#e2e8f0', fontWeight: '700', fontSize: '16px' }}>🔗 Merge Duplicate</div>
              <div style={{ color: '#cbd5e1', fontSize: '12px' }}>Select job to merge this into</div>
            </div>
            <button onClick={() => setShowDuplicateModal(false)} style={{ background: 'none', border: 'none', color: '#cbd5e1', fontSize: '24px', cursor: 'pointer' }}>×</button>
          </div>
          <div style={{ padding: '12px 16px', background: '#0f172a', borderBottom: '1px solid #334155' }}>
            <div style={{ color: '#f59e0b', fontSize: '11px', fontWeight: '600', marginBottom: '4px' }}>THIS JOB (will be archived):</div>
            <div style={{ color: '#e2e8f0', fontWeight: '600' }}>{job.customer_name}</div>
            <div style={{ color: '#94a3b8', fontSize: '12px' }}>{job.issue || 'No description'}</div>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
            {potentialDuplicates.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#cbd5e1', padding: '20px' }}>No potential duplicates found.</div>
            ) : (
              <>
                <div style={{ color: '#94a3b8', fontSize: '12px', marginBottom: '12px' }}>Found {potentialDuplicates.length} job(s):</div>
                {potentialDuplicates.map(dupe => (
                  <div key={dupe.id} onClick={() => setSelectedMergeTarget(dupe.id)}
                    style={{ background: selectedMergeTarget === dupe.id ? '#22c55e20' : '#0f172a', border: selectedMergeTarget === dupe.id ? '2px solid #22c55e' : '1px solid #334155', borderRadius: '10px', padding: '12px', marginBottom: '8px', cursor: 'pointer' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ color: '#e2e8f0', fontWeight: '600', fontSize: '14px' }}>{dupe.customer_name}</div>
                        <div style={{ color: '#94a3b8', fontSize: '12px' }}>{dupe.issue || 'No description'}</div>
                      </div>
                      <span style={{ background: STATUS_INFO[dupe.status]?.color || '#64748b', color: '#fff', padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: '600' }}>
                        {STATUS_INFO[dupe.status]?.label || dupe.status}
                      </span>
                    </div>
                    <div style={{ color: '#cbd5e1', fontSize: '11px', marginTop: '6px' }}>#{dupe.job_number || dupe.id.slice(0,8)} · {new Date(dupe.created_at).toLocaleDateString()}</div>
                  </div>
                ))}
              </>
            )}
          </div>
          <div style={{ padding: '16px', borderTop: '1px solid #334155', display: 'flex', gap: '12px' }}>
            <button onClick={() => setShowDuplicateModal(false)}
              style={{ flex: 1, padding: '12px', background: '#334155', color: '#e2e8f0', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>Cancel</button>
            <button onClick={handleMerge} disabled={!selectedMergeTarget || isMerging}
              style={{ flex: 1, padding: '12px', background: selectedMergeTarget ? '#22c55e' : '#334155', color: selectedMergeTarget ? '#fff' : '#64748b', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: '600', cursor: selectedMergeTarget ? 'pointer' : 'default' }}>
              {isMerging ? 'Merging...' : 'Merge & Archive'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderChecklistWarning = () => {
    if (!showChecklistWarning) return null;
    const checkState = getChecklistState(job, assignments, manualChecks);
    const blockers = getChecklistBlockers(checkState);
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{ background: '#1e293b', borderRadius: '16px', padding: '24px', width: '100%', maxWidth: '360px', borderTop: '4px solid #f59e0b' }}>
          <div style={{ fontSize: '18px', fontWeight: '700', color: '#f59e0b', marginBottom: '12px' }}>⚠️ Checklist Incomplete</div>
          <div style={{ color: '#94a3b8', fontSize: '13px', marginBottom: '16px' }}>{blockers.length} item{blockers.length > 1 ? 's' : ''} not checked off:</div>
          {blockers.map(item => (
            <div key={item.id} style={{ color: '#e2e8f0', fontSize: '13px', padding: '6px 0', display: 'flex', gap: '8px' }}>
              <span style={{ color: '#f59e0b' }}>○</span> {item.label}
            </div>
          ))}
          <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
            <button onClick={() => setShowChecklistWarning(false)} style={{ flex: 1, background: '#334155', color: '#94a3b8', border: 'none', borderRadius: '10px', padding: '14px', fontSize: '14px', cursor: 'pointer' }}>Go Back</button>
            <button onClick={() => { setShowChecklistWarning(false); setShowScheduleModal(true); }} style={{ flex: 1, background: '#f59e0b', color: '#000', border: 'none', borderRadius: '10px', padding: '14px', fontSize: '14px', fontWeight: '700', cursor: 'pointer' }}>Schedule Anyway</button>
          </div>
        </div>
      </div>
    );
  };

  const renderModals = () => (
    <>
      {showTimeCapture && pendingAction && (
        <InlineTimeGate
          job={job}
          pendingAction={pendingAction}
          timeArrived={timeArrived}
          setTimeArrived={setTimeArrived}
          timeDeparted={timeDeparted}
          setTimeDeparted={setTimeDeparted}
          completionNotes={completionNotes}
          setCompletionNotes={setCompletionNotes}
          onSubmit={submitCompletion}
          onCancel={() => { setShowTimeCapture(false); setPendingAction(null); }}
          isSubmitting={actionInProgress !== null}
        />
      )}
      {showScheduleModal && job && (
        <VisualSchedulerModal job={job} techs={schedTechs} accessToken={accessToken} userEmail={userEmail}
          onClose={() => setShowScheduleModal(false)}
          onScheduled={() => { setShowScheduleModal(false); loadJob(); onUpdate?.(); }}
          userEmail={userEmail} userRole={userRole} accessToken={accessToken} />
      )}
      {showRescheduleModal && job && (
        <RescheduleModal job={job} assignments={assignments} onClose={() => setShowRescheduleModal(false)}
          onRescheduled={() => { setShowRescheduleModal(false); loadJob(); onUpdate?.(); }}
          userEmail={userEmail} accessToken={accessToken} />
      )}
      {showApprovalModal && job && (
        <InstallationApprovalModal job={job} assignments={assignments}
          onApprove={handleApproval} onCancel={() => setShowApprovalModal(false)}
          userEmail={userEmail} isSubmitting={actionInProgress !== null} />
      )}
      {renderChecklistWarning()}
      {renderPartsModal()}
      {renderDuplicateModal()}

      {/* Billing Modal — $ amount + move to completed */}
      {showBillingModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: '#0f1729', borderRadius: '20px', padding: '24px', width: '100%', maxWidth: '380px', border: '1px solid #8b5cf640' }}>
            <h3 style={{ color: '#8b5cf6', fontSize: '18px', fontWeight: '700', margin: '0 0 4px 0' }}>💰 Mark as Billed</h3>
            <div style={{ color: '#cbd5e1', fontSize: '13px', marginBottom: '20px' }}>
              {job?.customer_name} — {job?.job_number}
            </div>

            {/* Amount field */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ color: '#94a3b8', fontSize: '12px', display: 'block', marginBottom: '4px' }}>Invoice Amount *</label>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#22c55e', fontSize: '18px', fontWeight: '700' }}>$</span>
                <input
                  type="number" step="0.01" autoFocus
                  value={billedAmount}
                  onChange={e => setBilledAmount(e.target.value)}
                  placeholder="0.00"
                  style={{
                    width: '100%', background: '#1a2332', border: '2px solid #334155', borderRadius: '12px',
                    color: '#22c55e', padding: '14px 14px 14px 32px', fontSize: '24px', fontWeight: '700',
                    outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit'
                  }}
                  onFocus={e => e.target.style.borderColor = '#8b5cf6'}
                  onBlur={e => e.target.style.borderColor = '#334155'}
                />
              </div>
            </div>

            {/* Billing note */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ color: '#94a3b8', fontSize: '12px', display: 'block', marginBottom: '4px' }}>Invoice # / Note (optional)</label>
              <input
                value={billingNote}
                onChange={e => setBillingNote(e.target.value)}
                placeholder="INV-2026-001"
                style={{
                  width: '100%', background: '#1a2332', border: '1px solid #334155', borderRadius: '8px',
                  color: '#e2e8f0', padding: '10px 12px', fontSize: '14px', outline: 'none', boxSizing: 'border-box'
                }}
              />
            </div>

            {/* Info banner */}
            <div style={{ background: '#22c55e10', border: '1px solid #22c55e30', borderRadius: '10px', padding: '10px 12px', marginBottom: '16px', display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ fontSize: '16px' }}>📅</span>
              <span style={{ color: '#22c55e', fontSize: '12px' }}>Calendar event will be moved to Completed</span>
            </div>

            {/* Buttons */}
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => { setShowBillingModal(false); setBilledAmount(''); setBillingNote(''); }}
                style={{ flex: 1, padding: '14px', background: '#1e293b', border: '1px solid #334155', borderRadius: '10px', color: '#94a3b8', fontSize: '14px', cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={handleBilledSubmit}
                disabled={!billedAmount || actionInProgress}
                style={{
                  flex: 2, padding: '14px', fontSize: '16px', fontWeight: '700',
                  background: billedAmount ? '#8b5cf6' : '#334155',
                  color: billedAmount ? '#fff' : '#64748b',
                  border: 'none', borderRadius: '10px', cursor: billedAmount ? 'pointer' : 'default',
                  boxShadow: billedAmount ? '0 4px 20px #8b5cf640' : 'none'
                }}>
                {actionInProgress ? 'Processing...' : `Bill $${parseFloat(billedAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  // ============================================
  // RENDER — EXECUTION MODE (scheduled jobs)
  // ============================================
  if (isScheduled) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#0f1729', zIndex: 200, overflowY: 'auto' }}>
        <div style={{ padding: '20px 20px 0', textAlign: 'center' }}>
          {/* Back — subtle */}
          <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '8px' }}>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#cbd5e1', fontSize: '14px', cursor: 'pointer', padding: '4px 0' }}>← Back</button>
          </div>

          {/* Customer — BIG */}
          <h1 style={{ fontSize: '36px', fontWeight: '900', color: '#e2e8f0', margin: 0, textTransform: 'uppercase', letterSpacing: '1px', lineHeight: 1.1 }}>
            {job.customer_name || 'Unknown'}
          </h1>
          {job.job_number && (
            <div style={{ color: '#38bdf8', fontSize: '14px', fontWeight: '500', marginTop: '6px' }}>{job.job_number}</div>
          )}
          {job.customer_id && (
            <button
              onClick={() => navigate(`/customers?customerId=${encodeURIComponent(job.customer_id)}&returnTo=${encodeURIComponent(window.location.pathname)}`)}
              style={{ marginTop: 8, background: 'none', border: '1px solid #334155', borderRadius: 8, color: '#00c8e8', padding: '6px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
              👤 View Full Client History
            </button>
          )}

          {/* Forced duplicate flag — fuzzy-matched automatically on load, not
              waiting for anyone to remember to check. Covers "still on the
              board" and "scheduled in the future" since both are just open
              rows in the same jobs table. */}
          {potentialDuplicates.length > 0 && (
            <button onClick={() => setShowDuplicateModal(true)}
              style={{ marginTop: 12, width: '100%', textAlign: 'left', background: '#7c2d1230', border: '2px solid #f97316', borderRadius: 12, padding: '12px 14px', cursor: 'pointer' }}>
              <div style={{ color: '#fdba74', fontWeight: 800, fontSize: 14 }}>
                ⚠️ Possible duplicate — {potentialDuplicates.length} similar job{potentialDuplicates.length > 1 ? 's' : ''} found
              </div>
              <div style={{ color: '#fed7aa', fontSize: 12, marginTop: 3 }}>
                {potentialDuplicates.slice(0, 3).map(d => `${d.customer_name} (${STATUS_INFO[d.status]?.label || d.status})`).join(' · ')}
                {potentialDuplicates.length > 3 ? ` +${potentialDuplicates.length - 3} more` : ''} — tap to review
              </div>
            </button>
          )}

          {/* Badges */}
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '12px', flexWrap: 'wrap' }}>
            {job.priority && job.priority !== 'normal' && (
              <span style={{ background: (PRIORITY_INFO[job.priority] || PRIORITY_INFO.normal).color, color: '#fff', padding: '4px 14px', borderRadius: '20px', fontSize: '12px', fontWeight: '700', textTransform: 'uppercase' }}>
                {(PRIORITY_INFO[job.priority] || PRIORITY_INFO.normal).label}
              </span>
            )}
            <span style={{ background: typeInfo.color, color: '#fff', padding: '4px 14px', borderRadius: '20px', fontSize: '12px', fontWeight: '700', textTransform: 'uppercase' }}>
              {typeInfo.label}
            </span>
          </div>

          {/* Tech • Date */}
          <div style={{ color: '#94a3b8', fontSize: '14px', marginTop: '10px' }}>
            {techName}{techName && scheduledDate ? ' • ' : ''}{scheduledDate && `${scheduledDate}, ${scheduledTime}`}
          </div>
        </div>

        <div style={{ padding: '16px 20px 120px' }}>
          {/* Address */}
          {job.customer_address && (
            <div style={{ background: '#1e293b', borderRadius: '12px', padding: '16px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <span style={{ color: '#e2e8f0', fontSize: '15px', flex: 1 }}>{job.customer_address}</span>
              <a href={`https://maps.google.com/?q=${encodeURIComponent(job.customer_address)}`} target="_blank" rel="noopener noreferrer"
                style={{ color: '#3b82f6', fontSize: '14px', fontWeight: '600', textDecoration: 'none', whiteSpace: 'nowrap', marginLeft: '14px' }}>Navigate →</a>
            </div>
          )}

          {/* Phone */}
          {parsePhoneNumbers(job.customer_phone || linkedCustomer?.phone).map((p, i) => (
            <div key={i} style={{ background: '#1e293b', borderRadius: '12px', padding: '16px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <span style={{ color: '#e2e8f0', fontSize: '15px' }}>📞 {p.display}{p.label ? ` · ${p.label}` : ''}</span>
              <a href={`tel:${p.digits}`} style={{ color: '#22c55e', fontSize: '14px', fontWeight: '600', textDecoration: 'none' }}>Call →</a>
            </div>
          ))}

          {/* Access codes */}
          {(job.gate_code || job.panel_password) && (
            <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
              {job.gate_code && (
                <div style={{ flex: 1, background: '#1e293b', borderRadius: '12px', padding: '14px 18px' }}>
                  <div style={{ color: '#cbd5e1', fontSize: '10px', fontWeight: '600', textTransform: 'uppercase' }}>Gate Code</div>
                  <div style={{ color: '#f59e0b', fontSize: '20px', fontWeight: '700', marginTop: '4px' }}>{job.gate_code}</div>
                </div>
              )}
              {job.panel_password && (
                <div style={{ flex: 1, background: '#1e293b', borderRadius: '12px', padding: '14px 18px' }}>
                  <div style={{ color: '#cbd5e1', fontSize: '10px', fontWeight: '600', textTransform: 'uppercase' }}>Panel</div>
                  <div style={{ color: '#f59e0b', fontSize: '20px', fontWeight: '700', marginTop: '4px' }}>{job.panel_password}</div>
                </div>
              )}
            </div>
          )}

          {/* Issue */}
          {cleanIssue && (
            <div style={{ background: '#1e293b', borderRadius: '12px', padding: '16px 18px', marginBottom: '20px' }}>
              <div style={{ color: '#cbd5e1', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', marginBottom: '8px', letterSpacing: '0.5px' }}>Issue</div>
              <div style={{ color: '#e2e8f0', fontSize: '15px', lineHeight: 1.5 }}>{cleanIssue}</div>
            </div>
          )}

          {/* CMS */}
          {linkedCustomer && (linkedCustomer.cms_account_id || (linkedCustomer.notes && !isMergeAuditText(linkedCustomer.notes))) && (
            <div style={{ background: '#1e293b', borderRadius: '12px', padding: '14px 18px', marginBottom: '20px' }}>
              {linkedCustomer.cms_account_id && <div style={{ color: '#94a3b8', fontSize: '13px', marginBottom: '4px' }}>📡 CMS: {linkedCustomer.cms_account_id}</div>}
              {linkedCustomer.notes && !isMergeAuditText(linkedCustomer.notes) && <div style={{ color: '#94a3b8', fontSize: '13px', fontStyle: 'italic' }}>💬 {linkedCustomer.notes}</div>}
            </div>
          )}

          {/* ===== HOW'D IT GO? ===== */}
          <div style={{ background: '#1a2332', borderRadius: '16px', padding: '24px 20px', marginBottom: '20px' }}>
            <h2 style={{ color: '#e2e8f0', fontSize: '26px', fontWeight: '900', textAlign: 'center', margin: '0 0 18px 0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              HOW'D IT GO?
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {completionButtons.map((action, i) => (
                <button key={i} onClick={() => startCompletion(action)}
                  disabled={actionInProgress !== null}
                  style={{
                    background: action.bg, color: '#fff', border: 'none', borderRadius: '14px',
                    padding: '18px 20px', fontSize: '18px', fontWeight: '700', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: '14px',
                    opacity: actionInProgress !== null ? 0.5 : 1
                  }}>
                  <span style={{ fontSize: '22px', width: 36, height: 36, borderRadius: '10px', background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{action.icon}</span>
                  <span style={{ flex: 1, textAlign: 'center', paddingRight: 36 }}>{action.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Move status — bidirectional, any role, note travels with the card */}
          <MoveStatus job={job} userEmail={userEmail} onMoved={() => { loadJob(); onUpdate?.(); }} onRequestSchedule={attemptSchedule} />

          {/* Notes */}
          <NotesPanel jobId={job.id} userEmail={userEmail} job={job} accessToken={accessToken} />

          {/* Field visits — the tech's actual time_entry (notes/materials/hours) */}
          <FieldVisits job={job} />

          {/* Reschedule — always visible for scheduled jobs */}
          <button onClick={() => setShowRescheduleModal(true)}
            style={{
              width: '100%', padding: '12px', background: '#f59e0b15', border: '1px solid #f59e0b40',
              borderRadius: '10px', color: '#f59e0b', fontSize: '14px', fontWeight: '600',
              cursor: 'pointer', textAlign: 'center', marginBottom: '8px'
            }}>
            📅 Reschedule
          </button>

          {/* Admin toggle */}
          {isOperator && (
            <>
              <button onClick={() => setShowAdminSection(!showAdminSection)}
                style={{ background: 'none', border: '1px solid #334155', borderRadius: '8px', color: '#94a3b8', padding: '10px', fontSize: '12px', cursor: 'pointer', width: '100%', textAlign: 'center', marginTop: '16px' }}>
                {showAdminSection ? 'Hide admin controls ▲' : 'Admin controls ▼'}
              </button>
              {showAdminSection && (
                <div style={{ marginTop: '12px' }}>
                  {renderAdminControls()}
                </div>
              )}
            </>
          )}
        </div>

        {renderModals()}
      </div>
    );
  }

  // ============================================
  // RENDER — ADMIN MODE (non-scheduled)
  // ============================================
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0f1729', zIndex: 200, overflowY: 'auto', paddingBottom: '100px' }}>
      {/* Header bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #1e293b', position: 'sticky', top: 0, background: '#0f1729', zIndex: 10 }}>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '16px', cursor: 'pointer', padding: '4px 8px' }}>← Back</button>
        <span style={{ background: statusInfo.color + '20', color: statusInfo.color, padding: '4px 12px', borderRadius: '12px', fontSize: '12px', fontWeight: '600' }}>{statusInfo.label}</span>
      </div>

      <div style={{ padding: '16px' }}>
        {/* Hero */}
        <div style={{ textAlign: 'center', marginBottom: '4px' }}>
          <h1 style={{ fontSize: '32px', fontWeight: '800', color: '#e2e8f0', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            {job.customer_name || 'Unknown Customer'}
          </h1>
          {job.job_number && <div style={{ color: '#38bdf8', fontSize: '14px', fontWeight: '500', marginTop: '4px' }}>{job.job_number}</div>}
        </div>

        {/* Badges */}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginBottom: '6px', flexWrap: 'wrap' }}>
          {job.priority && job.priority !== 'normal' && (
            <button onClick={() => { setShowPriorityPicker(!showPriorityPicker); setShowTypePicker(false); }}
              style={{ background: (PRIORITY_INFO[job.priority] || PRIORITY_INFO.normal).color, color: '#fff', padding: '5px 16px', borderRadius: '20px', fontSize: '12px', fontWeight: '700', border: 'none', cursor: 'pointer', textTransform: 'uppercase' }}>
              {(PRIORITY_INFO[job.priority] || PRIORITY_INFO.normal).label}
            </button>
          )}
          <button onClick={() => { setShowTypePicker(!showTypePicker); setShowPriorityPicker(false); }}
            style={{ background: typeInfo.color, color: '#fff', padding: '5px 16px', borderRadius: '20px', fontSize: '12px', fontWeight: '700', border: 'none', cursor: 'pointer', textTransform: 'uppercase' }}>
            {typeInfo.label}
          </button>
        </div>

        {/* Type picker */}
        {showTypePicker && (
          <div style={{ background: '#1e293b', borderRadius: '12px', padding: '10px', marginBottom: '12px' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', justifyContent: 'center' }}>
              {Object.entries(JOB_TYPE_INFO).filter(([key]) => ['task', 'note'].includes(key) || key === job.job_type || ['service_res', 'service_com', 'return_trip', 'install', 'new_construction', 'subcontractor', 'government', 'estimate', 'sales'].includes(key)).map(([key, info]) => (
                <button key={key} onClick={async () => {
                  const wasTaskOrNote = ['task', 'note'].includes(job.job_type);
                  const isBecomingJob = !['task', 'note'].includes(key);
                  const updates = { job_type: key, updated_by: userEmail };
                  if (wasTaskOrNote && isBecomingJob) {
                    updates.status = JOB_STATUS.NEW;
                    await jobsApi.logHistory(job.id, job.status, JOB_STATUS.NEW, userEmail, `Converted from ${job.job_type} to ${key}`);
                  }
                  await jobsApi.update(job.id, updates);
                  setShowTypePicker(false); loadJob(); onUpdate?.();
                }} style={{ background: job.job_type === key ? info.color : `${info.color}20`, color: job.job_type === key ? '#fff' : info.color, border: 'none', borderRadius: '20px', padding: '8px 14px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>
                  {info.icon} {info.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Priority picker */}
        {showPriorityPicker && (
          <div style={{ background: '#1e293b', borderRadius: '12px', padding: '10px', marginBottom: '12px' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', justifyContent: 'center' }}>
              {Object.entries(PRIORITY_INFO).map(([key, info]) => (
                <button key={key} onClick={async () => {
                  await jobsApi.update(job.id, { priority: key, updated_by: userEmail });
                  setShowPriorityPicker(false); loadJob();
                }} style={{ background: job.priority === key ? info.color : `${info.color}15`, color: job.priority === key ? '#fff' : info.color, border: 'none', borderRadius: '20px', padding: '8px 14px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>
                  {info.icon} {info.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Tech + date */}
        {assignments.length > 0 && (
          <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: '14px', marginBottom: '16px' }}>
            {assignments.filter(a => !a.is_complete).map(a => (
              <span key={a.id}>{a.tech?.name || '?'} • {a.scheduled_for ? new Date(a.scheduled_for).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' + new Date(a.scheduled_for).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : 'Unscheduled'}</span>
            ))}
          </div>
        )}

        {/* Address */}
        {job.customer_address && (
          <div style={{ background: '#1e293b', borderRadius: '12px', padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <span style={{ color: '#e2e8f0', fontSize: '14px' }}>{job.customer_address}</span>
            <a href={`https://maps.google.com/?q=${encodeURIComponent(job.customer_address)}`} target="_blank" rel="noopener noreferrer"
              style={{ color: '#3b82f6', fontSize: '14px', fontWeight: '600', textDecoration: 'none', whiteSpace: 'nowrap', marginLeft: '12px' }}>Navigate →</a>
          </div>
        )}

        {/* Phone */}
        {parsePhoneNumbers(job.customer_phone || linkedCustomer?.phone).map((p, i) => (
          <div key={i} style={{ background: '#1e293b', borderRadius: '12px', padding: '14px 16px', marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#e2e8f0', fontSize: '14px' }}>📞 {p.display}{p.label ? ` · ${p.label}` : ''}</span>
            <a href={`tel:${p.digits}`} style={{ color: '#22c55e', fontSize: '14px', fontWeight: '600', textDecoration: 'none' }}>Call →</a>
          </div>
        ))}

        {/* Access codes */}
        {(job.gate_code || job.panel_password) && (
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            {job.gate_code && (
              <div style={{ flex: 1, background: '#1e293b', borderRadius: '12px', padding: '12px 16px' }}>
                <div style={{ color: '#cbd5e1', fontSize: '10px', fontWeight: '600', textTransform: 'uppercase' }}>Gate Code</div>
                <div style={{ color: '#f59e0b', fontSize: '18px', fontWeight: '700', marginTop: '4px' }}>{job.gate_code}</div>
              </div>
            )}
            {job.panel_password && (
              <div style={{ flex: 1, background: '#1e293b', borderRadius: '12px', padding: '12px 16px' }}>
                <div style={{ color: '#cbd5e1', fontSize: '10px', fontWeight: '600', textTransform: 'uppercase' }}>Panel Password</div>
                <div style={{ color: '#f59e0b', fontSize: '18px', fontWeight: '700', marginTop: '4px' }}>{job.panel_password}</div>
              </div>
            )}
          </div>
        )}

        {/* Issue */}
        {cleanIssue && (
          <div style={{ background: '#1e293b', borderRadius: '12px', padding: '14px 16px', marginBottom: '16px' }}>
            <div style={{ color: '#cbd5e1', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', marginBottom: '6px' }}>Issue</div>
            <div style={{ color: '#e2e8f0', fontSize: '15px', lineHeight: '1.5' }}>{cleanIssue}</div>
          </div>
        )}

        {/* CMS */}
        {linkedCustomer && (linkedCustomer.cms_account_id || (linkedCustomer.notes && !isMergeAuditText(linkedCustomer.notes))) && (
          <div style={{ background: '#1e293b', borderRadius: '12px', padding: '12px 16px', marginBottom: '16px' }}>
            {linkedCustomer.cms_account_id && <div style={{ color: '#94a3b8', fontSize: '13px', marginBottom: '4px' }}>📡 CMS: {linkedCustomer.cms_account_id}</div>}
            {linkedCustomer.notes && !isMergeAuditText(linkedCustomer.notes) && <div style={{ color: '#94a3b8', fontSize: '13px', fontStyle: 'italic' }}>💬 {linkedCustomer.notes}</div>}
          </div>
        )}

        {/* Pre-schedule checklist */}
        {['new', 'needs_details', 'needs_parts', 'pending_decision', 'pending_materials', 'ready_to_schedule', 'return_pending'].includes(job.status) && job.job_type !== 'note' && job.job_type !== 'task' && (() => {
          const checkState = getChecklistState(job, assignments, manualChecks);
          const blockers = getChecklistBlockers(checkState);
          const totalItems = PRE_SCHEDULE_CHECKLIST.length;
          const doneItems = totalItems - blockers.length;
          const allDone = blockers.length === 0;
          return (
            <div style={{ background: allDone ? '#0c2d1e' : '#1e293b', border: `2px solid ${allDone ? '#22c55e40' : '#f59e0b40'}`, borderRadius: '14px', padding: '14px', marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <div style={{ color: allDone ? '#22c55e' : '#f59e0b', fontSize: '12px', fontWeight: '700', textTransform: 'uppercase' }}>
                  {allDone ? '✅ Ready to Schedule' : `📋 Pre-Schedule (${doneItems}/${totalItems})`}
                </div>
                {!allDone && <span style={{ color: '#f59e0b', fontSize: '11px' }}>{blockers.length} remaining</span>}
              </div>
              {PRE_SCHEDULE_CHECKLIST.map(item => {
                const checked = checkState[item.id];
                const isAuto = item.auto;
                return (
                  <div key={item.id} onClick={isAuto ? undefined : () => toggleChecklistItem(item.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 4px', cursor: isAuto ? 'default' : 'pointer', borderBottom: '1px solid #0f172a20' }}>
                    <div style={{ width: '22px', height: '22px', borderRadius: '6px', flexShrink: 0, background: checked ? '#22c55e' : '#334155', border: `2px solid ${checked ? '#22c55e' : '#475569'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', color: '#fff' }}>
                      {checked ? '✓' : ''}
                    </div>
                    <span style={{ color: checked ? '#94a3b8' : '#e2e8f0', fontSize: '13px', textDecoration: checked ? 'line-through' : 'none', opacity: checked ? 0.7 : 1 }}>
                      {item.label}{isAuto && <span style={{ color: '#94a3b8', fontSize: '10px', marginLeft: '6px' }}>auto</span>}
                    </span>
                  </div>
                );
              })}
              {Number(JOB_TYPE_INFO[job.job_type]?.minutes) > 0 && (
                <div style={{ color: '#cbd5e1', fontSize: '11px', marginTop: '8px', textAlign: 'right' }}>⏱ Expected: {JOB_TYPE_INFO[job.job_type].minutes} min</div>
              )}
            </div>
          );
        })()}

        {/* Estimate */}
        {/* `&&` on a NUMBER renders the number when it's 0 — that bare 0 above
            the merge button was an estimate_amount of zero. Compare explicitly. */}
        {Number(job.estimate_amount) > 0 && (
          <div style={{ background: '#1e293b', borderRadius: '10px', padding: '12px', marginBottom: '16px' }}>
            <div style={{ color: '#cbd5e1', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', marginBottom: '4px' }}>Estimate</div>
            <div style={{ color: '#22c55e', fontSize: '22px', fontWeight: '700' }}>${parseFloat(job.estimate_amount).toLocaleString()}</div>
          </div>
        )}

        {/* Parts */}
        {!!job.parts_needed && (
          <div style={{ background: '#1e293b', borderRadius: '10px', padding: '12px', marginBottom: '16px', border: '1px solid #f59e0b30' }}>
            <div style={{ color: '#f59e0b', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', marginBottom: '4px' }}>📦 Parts Needed</div>
            <div style={{ color: '#e2e8f0', fontSize: '14px' }}>{job.parts_needed}</div>
          </div>
        )}

        {/* Time log */}
        {assignments.length > 0 && assignments.some(a => a.time_in || a.time_out || a.actual_hours || a.is_complete) && (
          <div style={{ background: '#1e293b', borderRadius: '10px', padding: '12px', marginBottom: '16px' }}>
            <div style={{ color: '#cbd5e1', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', marginBottom: '8px' }}>Time Log</div>
            {assignments.filter(a => a.time_in || a.time_out || a.actual_hours || a.is_complete).map(a => (
              <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #0f1729' }}>
                <div>
                  <span style={{ color: '#e2e8f0', fontSize: '13px', fontWeight: '600' }}>{a.tech?.name || 'Unknown'}</span>
                  {a.time_in && <span style={{ color: '#94a3b8', fontSize: '12px', marginLeft: '8px' }}>In: {formatTimeOnly(a.time_in)}</span>}
                  {a.time_out && <span style={{ color: '#94a3b8', fontSize: '12px', marginLeft: '8px' }}>Out: {formatTimeOnly(a.time_out)}</span>}
                </div>
                <div>
                  {a.actual_hours ? <span style={{ color: '#00c8e8', fontSize: '13px', fontWeight: '700' }}>{a.actual_hours.toFixed(1)}h</span>
                    : a.is_complete ? <span style={{ color: '#22c55e', fontSize: '12px' }}>✓ Done</span> : null}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Time log fallback — job-row time when no assignment carries it (NakedPM) */}
        {!assignments.some(a => a.time_in || a.time_out || a.actual_hours) && (job.time_in || job.time_out || job.actual_hours) && (
          <div style={{ background: '#1e293b', borderRadius: '10px', padding: '12px', marginBottom: '16px' }}>
            <div style={{ color: '#cbd5e1', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', marginBottom: '8px' }}>Time Log</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
              <div>
                <span style={{ color: '#e2e8f0', fontSize: '13px', fontWeight: '600' }}>{job.tech_assigned || 'Logged'}</span>
                {job.time_in && <span style={{ color: '#94a3b8', fontSize: '12px', marginLeft: '8px' }}>In: {formatTimeOnly(job.time_in)}</span>}
                {job.time_out && <span style={{ color: '#94a3b8', fontSize: '12px', marginLeft: '8px' }}>Out: {formatTimeOnly(job.time_out)}</span>}
              </div>
              <div>
                {job.actual_hours ? <span style={{ color: '#00c8e8', fontSize: '13px', fontWeight: '700' }}>{Number(job.actual_hours).toFixed(1)}h</span> : null}
              </div>
            </div>
          </div>
        )}

        {/* Quick actions */}
        {quickActions.length > 0 && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{ color: '#cbd5e1', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', marginBottom: '8px' }}>Actions</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {quickActions.map((action, i) => (
                <button key={i}
                  onClick={() => {
                    if (action.action) { action.action(); }
                    else if (action.toStatus === JOB_STATUS.NEEDS_PARTS) { setShowPartsForm(true); }
                    else if (action.toStatus === JOB_STATUS.SCHEDULED) { attemptSchedule(); }
                    else if (action.toStatus === JOB_STATUS.BILLED && isInfoUser) { setShowBillingModal(true); }
                    else { handleStatusChange(action.toStatus); }
                  }}
                  disabled={actionInProgress !== null}
                  style={{ background: `${action.color}15`, color: action.color, border: `1px solid ${action.color}40`, borderRadius: '10px', padding: '12px 16px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', textAlign: 'left', opacity: actionInProgress === action.toStatus ? 0.5 : 1 }}>
                  {actionInProgress === action.toStatus ? 'Working...' : action.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Reschedule — show for scheduled jobs in admin view */}
        {job.status === JOB_STATUS.SCHEDULED && (
          <button onClick={() => setShowRescheduleModal(true)}
            style={{
              width: '100%', padding: '12px 16px', background: '#f59e0b15', border: '1px solid #f59e0b40',
              borderRadius: '10px', color: '#f59e0b', fontSize: '14px', fontWeight: '600',
              cursor: 'pointer', textAlign: 'center', marginBottom: '12px'
            }}>
            📅 Reschedule
          </button>
        )}

        {/* Move status + notes — these used to exist ONLY on the `isScheduled`
            branch above, so every ticket that wasn't scheduled (tasks, new,
            ready, returns, estimates — i.e. most of the board) opened with no
            way to write a note and no visible status control beyond a collapsed
            "Change status manually…". Opening a card and being unable to say
            anything about it is the reason people stop opening cards. */}
        <MoveStatus job={job} userEmail={userEmail} onMoved={() => { loadJob(); onUpdate?.(); }} onRequestSchedule={attemptSchedule} />

        <NotesPanel jobId={job.id} userEmail={userEmail} job={job} accessToken={accessToken} />

        <FieldVisits job={job} />

        {/* Duplicate merge */}
        <button onClick={() => findPotentialDuplicates(false)}
          style={{ background: '#6366f115', color: '#6366f1', border: '1px solid #6366f140', borderRadius: '10px', padding: '12px 16px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', width: '100%', textAlign: 'center', marginBottom: '12px' }}>
          🔗 Mark as Duplicate / Merge
        </button>

        {/* Status picker */}
        {renderAdminControls()}

        {/* Timestamps */}
        <div style={{ marginTop: '20px', padding: '12px', background: '#1a2332', borderRadius: '8px' }}>
          <div style={{ color: '#94a3b8', fontSize: '11px' }}>Created: {formatDateTime(job.created_at)}</div>
          {job.scheduled_at && <div style={{ color: '#94a3b8', fontSize: '11px' }}>Scheduled: {formatDateTime(job.scheduled_at)}</div>}
          {job.completed_at && <div style={{ color: '#94a3b8', fontSize: '11px' }}>Completed: {formatDateTime(job.completed_at)}</div>}
          {job.billed_at && <div style={{ color: '#94a3b8', fontSize: '11px' }}>Billed: {formatDateTime(job.billed_at)}</div>}
          {job.billed_amount > 0 && <div style={{ color: '#22c55e', fontSize: '13px', fontWeight: '700' }}>💰 ${parseFloat(job.billed_amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}{job.billing_notes ? ` — ${job.billing_notes}` : ''}</div>}
          <div style={{ color: '#94a3b8', fontSize: '11px' }}>Updated: {formatDateTime(job.updated_at)} by {job.updated_by?.split('@')[0]}</div>
        </div>
      </div>

      {renderModals()}
    </div>
  );
}

// ── InlineTimeGate ────────────────────────────────────────────────
// Simple time-arrived / time-departed / completion-notes modal that
// gates a status change on the Supabase jobs table. Replaces the deleted
// TimeCaptureModal as part of the cleanup that consolidated all
// "tech finishes a job" flows into JobFinishSheet.jsx for the
// calendar-driven path. JobDetail still handles the Supabase-jobs status
// machine path; that is intentional and a separate architecture.
//
// Overrun detection was removed in this cleanup — it shipped but nobody
// actually used it, and its presence forced two separate flows to coexist.
function InlineTimeGate({
  job,
  pendingAction,
  timeArrived,
  setTimeArrived,
  timeDeparted,
  setTimeDeparted,
  completionNotes,
  setCompletionNotes,
  onSubmit,
  onCancel,
  isSubmitting,
}) {
  // Pre-fill departed time with current time if empty
  useEffect(() => {
    if (!timeDeparted) {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      setTimeDeparted(`${hh}:${mm}`);
    }
  }, []);

  const submit = () => {
    if (isSubmitting) return;
    onSubmit({ timeArrived, timeDeparted, completionNotes });
  };

  return (
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 500,
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#1e293b', borderRadius: '20px 20px 0 0',
        padding: '24px 20px 32px', width: '100%', maxWidth: 480, maxHeight: '92vh',
        overflowY: 'auto',
      }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ color: '#e2e8f0', fontSize: 17, fontWeight: 700 }}>
            {pendingAction?.label || 'Complete Job'}
          </div>
          <div style={{ color: '#cbd5e1', fontSize: 13, marginTop: 4 }}>
            {job?.customer_name} {job?.job_number ? `· ${job.job_number}` : ''}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <label style={timeLabelStyle}>Time arrived</label>
            <input
              type="time"
              value={timeArrived}
              onChange={e => setTimeArrived(e.target.value)}
              style={timeInputStyle}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={timeLabelStyle}>Time departed</label>
            <input
              type="time"
              value={timeDeparted}
              onChange={e => setTimeDeparted(e.target.value)}
              style={timeInputStyle}
            />
          </div>
        </div>

        <label style={timeLabelStyle}>Notes (optional)</label>
        <textarea
          value={completionNotes}
          onChange={e => setCompletionNotes(e.target.value)}
          placeholder="What was done, anything noteworthy…"
          rows={3}
          style={{
            width: '100%', padding: 10, background: '#0f1729',
            border: '1px solid #334155', borderRadius: 10, color: '#e2e8f0',
            fontSize: 13, fontFamily: 'inherit', resize: 'none',
            boxSizing: 'border-box', marginBottom: 16,
          }}
        />

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onCancel} disabled={isSubmitting} style={{
            flex: 1, padding: 12, background: 'none', border: '1px solid #334155',
            borderRadius: 10, color: '#94a3b8', fontSize: 13, cursor: 'pointer',
          }}>Cancel</button>
          <button onClick={submit} disabled={isSubmitting} style={{
            flex: 2, padding: 12, background: isSubmitting ? '#334155' : '#22c55e',
            border: 'none', borderRadius: 10, color: '#000',
            fontSize: 14, fontWeight: 700, cursor: isSubmitting ? 'not-allowed' : 'pointer',
          }}>
            {isSubmitting ? 'Saving…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

const timeLabelStyle = {
  color: '#94a3b8', fontSize: 11, fontWeight: 600, display: 'block',
  marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5,
};
const timeInputStyle = {
  width: '100%', padding: 10, background: '#0f1729',
  border: '1px solid #334155', borderRadius: 10, color: '#e2e8f0',
  fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box',
};
