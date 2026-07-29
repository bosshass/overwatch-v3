// ============================================
// JUC-E V4 - Installation Approval Modal
// ============================================
// Implements explicit manager approval for installations per SOP

import { useState } from 'react';
import { INSTALL_TYPES } from '../utils/statusMachine.js';

export default function InstallationApprovalModal({ 
  job, 
  assignments = [],
  onApprove, 
  onCancel, 
  userEmail,
  isSubmitting 
}) {
  const [approvalNotes, setApprovalNotes] = useState('');
  const [checklist, setChecklist] = useState({
    workCompleted: false,
    photosReviewed: false,
    customerSatisfied: false,
    partsAccounted: false,
    notesComplete: false
  });

  const isInstallType = INSTALL_TYPES.includes(job.job_type);
  
  if (!isInstallType) {
    return null; // Should never happen, but safety check
  }

  const completedAssignment = assignments.find(a => a.is_complete);
  const allChecked = Object.values(checklist).every(v => v === true);

  const handleChecklistChange = (key) => {
    setChecklist(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleApprove = () => {
    if (!allChecked) {
      alert('Please complete all checklist items before approving.');
      return;
    }

    onApprove({
      approvedBy: userEmail,
      approvedAt: new Date().toISOString(),
      approvalNotes: approvalNotes.trim() || null,
      checklist
    });
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.9)',
      zIndex: 300,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px'
    }}>
      <div style={{
        background: '#1e293b',
        borderRadius: '16px',
        padding: '24px',
        width: '100%',
        maxWidth: '500px',
        maxHeight: '90vh',
        overflowY: 'auto'
      }}>
        {/* Header */}
        <div style={{ marginBottom: '20px' }}>
          <h3 style={{ 
            fontSize: '18px', 
            fontWeight: '700', 
            color: '#e2e8f0', 
            margin: 0,
            marginBottom: '4px'
          }}>
            ✅ Approve Installation
          </h3>
          <div style={{ color: '#cbd5e1', fontSize: '14px', marginBottom: '8px' }}>
            {job.customer_name}
          </div>
          <div style={{ 
            color: '#f59e0b', 
            fontSize: '12px',
            background: '#713f1215',
            padding: '8px 12px',
            borderRadius: '8px',
            border: '1px solid #f59e0b40'
          }}>
            ⚠️ Per SOP: All installations require manager approval before billing
          </div>
        </div>

        {/* Job Details */}
        <div style={{
          background: '#0f1729',
          borderRadius: '10px',
          padding: '12px',
          marginBottom: '16px'
        }}>
          <div style={{ color: '#94a3b8', fontSize: '12px', marginBottom: '4px' }}>
            Job Number: <span style={{ color: '#e2e8f0' }}>{job.job_number}</span>
          </div>
          <div style={{ color: '#94a3b8', fontSize: '12px', marginBottom: '4px' }}>
            Address: <span style={{ color: '#e2e8f0' }}>{job.customer_address}</span>
          </div>
          {completedAssignment && (
            <>
              <div style={{ color: '#94a3b8', fontSize: '12px', marginBottom: '4px' }}>
                Completed by: <span style={{ color: '#e2e8f0' }}>{completedAssignment.tech?.name || 'Unknown'}</span>
              </div>
              <div style={{ color: '#94a3b8', fontSize: '12px' }}>
                Date: <span style={{ color: '#e2e8f0' }}>
                  {new Date(completedAssignment.scheduled_for).toLocaleDateString()}
                </span>
              </div>
            </>
          )}
        </div>

        {/* Approval Checklist */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ 
            color: '#94a3b8', 
            fontSize: '12px', 
            fontWeight: '600', 
            display: 'block', 
            marginBottom: '10px' 
          }}>
            📋 Manager Approval Checklist
          </label>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <label style={{
              display: 'flex',
              alignItems: 'center',
              padding: '10px 12px',
              background: checklist.workCompleted ? '#0c2d1e' : '#0f1729',
              border: `2px solid ${checklist.workCompleted ? '#22c55e40' : '#334155'}`,
              borderRadius: '8px',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}>
              <input
                type="checkbox"
                checked={checklist.workCompleted}
                onChange={() => handleChecklistChange('workCompleted')}
                style={{
                  marginRight: '10px',
                  width: '18px',
                  height: '18px',
                  cursor: 'pointer'
                }}
              />
              <span style={{ color: '#e2e8f0', fontSize: '13px' }}>
                Work completed per scope
              </span>
            </label>

            <label style={{
              display: 'flex',
              alignItems: 'center',
              padding: '10px 12px',
              background: checklist.photosReviewed ? '#0c2d1e' : '#0f1729',
              border: `2px solid ${checklist.photosReviewed ? '#22c55e40' : '#334155'}`,
              borderRadius: '8px',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}>
              <input
                type="checkbox"
                checked={checklist.photosReviewed}
                onChange={() => handleChecklistChange('photosReviewed')}
                style={{
                  marginRight: '10px',
                  width: '18px',
                  height: '18px',
                  cursor: 'pointer'
                }}
              />
              <span style={{ color: '#e2e8f0', fontSize: '13px' }}>
                Installation photos reviewed
              </span>
            </label>

            <label style={{
              display: 'flex',
              alignItems: 'center',
              padding: '10px 12px',
              background: checklist.customerSatisfied ? '#0c2d1e' : '#0f1729',
              border: `2px solid ${checklist.customerSatisfied ? '#22c55e40' : '#334155'}`,
              borderRadius: '8px',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}>
              <input
                type="checkbox"
                checked={checklist.customerSatisfied}
                onChange={() => handleChecklistChange('customerSatisfied')}
                style={{
                  marginRight: '10px',
                  width: '18px',
                  height: '18px',
                  cursor: 'pointer'
                }}
              />
              <span style={{ color: '#e2e8f0', fontSize: '13px' }}>
                Customer signed off / satisfied
              </span>
            </label>

            <label style={{
              display: 'flex',
              alignItems: 'center',
              padding: '10px 12px',
              background: checklist.partsAccounted ? '#0c2d1e' : '#0f1729',
              border: `2px solid ${checklist.partsAccounted ? '#22c55e40' : '#334155'}`,
              borderRadius: '8px',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}>
              <input
                type="checkbox"
                checked={checklist.partsAccounted}
                onChange={() => handleChecklistChange('partsAccounted')}
                style={{
                  marginRight: '10px',
                  width: '18px',
                  height: '18px',
                  cursor: 'pointer'
                }}
              />
              <span style={{ color: '#e2e8f0', fontSize: '13px' }}>
                All parts/materials accounted for
              </span>
            </label>

            <label style={{
              display: 'flex',
              alignItems: 'center',
              padding: '10px 12px',
              background: checklist.notesComplete ? '#0c2d1e' : '#0f1729',
              border: `2px solid ${checklist.notesComplete ? '#22c55e40' : '#334155'}`,
              borderRadius: '8px',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}>
              <input
                type="checkbox"
                checked={checklist.notesComplete}
                onChange={() => handleChecklistChange('notesComplete')}
                style={{
                  marginRight: '10px',
                  width: '18px',
                  height: '18px',
                  cursor: 'pointer'
                }}
              />
              <span style={{ color: '#e2e8f0', fontSize: '13px' }}>
                Tech notes complete and detailed
              </span>
            </label>
          </div>
        </div>

        {/* Approval Notes */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ 
            color: '#94a3b8', 
            fontSize: '12px', 
            fontWeight: '600', 
            display: 'block', 
            marginBottom: '6px' 
          }}>
            📝 Approval Notes (optional)
          </label>
          <textarea
            value={approvalNotes}
            onChange={e => setApprovalNotes(e.target.value)}
            placeholder="Any additional notes or observations..."
            rows={3}
            style={{
              width: '100%',
              background: '#0f1729',
              border: '1px solid #334155',
              borderRadius: '10px',
              color: '#e2e8f0',
              padding: '12px',
              fontSize: '14px',
              outline: 'none',
              resize: 'none',
              boxSizing: 'border-box',
              fontFamily: 'inherit'
            }}
          />
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={onCancel}
            disabled={isSubmitting}
            style={{
              flex: 1,
              background: '#334155',
              color: '#94a3b8',
              border: 'none',
              borderRadius: '10px',
              padding: '14px',
              fontSize: '14px',
              cursor: 'pointer',
              opacity: isSubmitting ? 0.5 : 1
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleApprove}
            disabled={!allChecked || isSubmitting}
            style={{
              flex: 2,
              background: allChecked ? '#22c55e' : '#334155',
              color: allChecked ? '#000' : '#64748b',
              border: 'none',
              borderRadius: '10px',
              padding: '14px',
              fontSize: '15px',
              fontWeight: '700',
              cursor: allChecked ? 'pointer' : 'not-allowed',
              opacity: isSubmitting ? 0.5 : 1
            }}
          >
            {isSubmitting ? 'Approving...' : '✅ Approve Installation'}
          </button>
        </div>
      </div>
    </div>
  );
}
