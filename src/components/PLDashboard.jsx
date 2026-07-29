// ============================================
// P&L Dashboard - Self-contained with Supabase
// Shows Month/YTD/Weeks views with PY comparison
// ============================================
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabase.js';
import PLUpload from './PLUpload.jsx';

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 
                'July', 'August', 'September', 'October', 'November', 'December'];

export default function PLDashboard({ userEmail }) {
  const [data, setData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [view, setView] = useState('ytd-month'); // 'month' | 'ytd-month' | 'ytd-week'
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [showUpload, setShowUpload] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data: records, error } = await supabase
        .from('pl_data')
        .select('*')
        .gte('year', selectedYear - 1)
        .lte('year', selectedYear)
        .order('period_start', { ascending: true });
      
      if (error) throw error;
      setData(records || []);
    } catch (e) {
      console.error('Load P&L error:', e);
    } finally {
      setIsLoading(false);
    }
  }, [selectedYear]);

  useEffect(() => { loadData(); }, [loadData]);

  const formatCurrency = (val, compact = false) => {
    if (val === null || val === undefined) return '-';
    const absVal = Math.abs(val);
    if (compact && absVal >= 1000) {
      const k = absVal / 1000;
      return val < 0 ? `($${k.toFixed(1)}k)` : `$${k.toFixed(1)}k`;
    }
    return val < 0 ? `($${absVal.toLocaleString()})` : `$${val.toLocaleString()}`;
  };

  const formatDiff = (current, prior) => {
    if (prior === null || prior === undefined || prior === 0) return '-';
    if (current === null || current === undefined) return '-';
    const diff = current - prior;
    const pct = ((diff / Math.abs(prior)) * 100).toFixed(0);
    const sign = diff >= 0 ? '+' : '';
    const color = diff >= 0 ? '#4ade80' : '#f87171';
    return <span style={{ color, fontSize: '11px' }}>{sign}{pct}%</span>;
  };

  // Build view data
  const getViewData = () => {
    const currentYearData = data.filter(d => d.year === selectedYear);

    if (view === 'month') {
      // This month by week
      return currentYearData
        .filter(d => d.month === selectedMonth && d.period_type === 'week')
        .sort((a, b) => new Date(a.period_start) - new Date(b.period_start));
    }
    
    if (view === 'ytd-month') {
      // YTD by month - aggregate weeks into months if needed
      const monthData = currentYearData.filter(d => d.period_type === 'month');
      if (monthData.length > 0) {
        return monthData.sort((a, b) => a.month - b.month);
      }
      // Fallback: aggregate weekly data by month
      const byMonth = {};
      currentYearData.filter(d => d.period_type === 'week').forEach(w => {
        if (!byMonth[w.month]) {
          byMonth[w.month] = {
            period_label: `${MONTHS[w.month]} ${w.year}`,
            month: w.month,
            year: w.year,
            total_revenue: 0,
            total_expense: 0,
            net_amount: 0,
            py_total_revenue: null,
            py_net_amount: null
          };
        }
        byMonth[w.month].total_revenue += w.total_revenue || 0;
        byMonth[w.month].total_expense += w.total_expense || 0;
        byMonth[w.month].net_amount += w.net_amount || 0;
        if (w.py_total_revenue !== null) {
          byMonth[w.month].py_total_revenue = (byMonth[w.month].py_total_revenue || 0) + w.py_total_revenue;
        }
        if (w.py_net_amount !== null) {
          byMonth[w.month].py_net_amount = (byMonth[w.month].py_net_amount || 0) + w.py_net_amount;
        }
      });
      return Object.values(byMonth).sort((a, b) => a.month - b.month);
    }
    
    if (view === 'ytd-week') {
      // YTD by week
      return currentYearData
        .filter(d => d.period_type === 'week')
        .sort((a, b) => new Date(a.period_start) - new Date(b.period_start));
    }
    
    return [];
  };

  const viewData = getViewData();
  
  // Calculate totals
  const totals = viewData.reduce((acc, row) => ({
    total_revenue: acc.total_revenue + (row.total_revenue || 0),
    total_expense: acc.total_expense + (row.total_expense || 0),
    materials_expense: acc.materials_expense + (row.materials_expense || 0),
    labor_expense: acc.labor_expense + (row.labor_expense || 0),
    net_amount: acc.net_amount + (row.net_amount || 0),
    py_total_revenue: row.py_total_revenue !== null 
      ? (acc.py_total_revenue || 0) + (row.py_total_revenue || 0) : acc.py_total_revenue,
    py_net_amount: row.py_net_amount !== null 
      ? (acc.py_net_amount || 0) + (row.py_net_amount || 0) : acc.py_net_amount,
  }), {
    total_revenue: 0, total_expense: 0, materials_expense: 0, labor_expense: 0, net_amount: 0,
    py_total_revenue: null, py_net_amount: null
  });

  const formatMargin = (net, rev) => {
    if (!rev) return '-';
    const pct = (net / rev) * 100;
    return `${pct >= 0 ? '' : ''}${pct.toFixed(0)}%`;
  };

  // Check if any row has PY data
  const hasPY = viewData.some(d => d.py_total_revenue !== null || d.py_net_amount !== null);

  const viewTitles = {
    'month': `${MONTHS[selectedMonth]} ${selectedYear} by Week`,
    'ytd-month': `${selectedYear} YTD by Month`,
    'ytd-week': `${selectedYear} YTD by Week`
  };

  return (
    <div style={{ background: '#0f172a', borderRadius: '12px', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ 
        padding: '12px 16px', borderBottom: '1px solid #1e293b',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ color: '#e2e8f0', fontWeight: '700', fontSize: '16px' }}>📊 P&L</span>
          
          {/* View tabs */}
          <div style={{ display: 'flex', gap: '4px' }}>
            {[
              { key: 'month', label: 'Month' },
              { key: 'ytd-month', label: 'YTD' },
              { key: 'ytd-week', label: 'Weeks' }
            ].map(v => (
              <button
                key={v.key}
                onClick={() => setView(v.key)}
                style={{
                  padding: '4px 10px', borderRadius: '6px', border: 'none',
                  background: view === v.key ? '#3b82f6' : '#1e293b',
                  color: view === v.key ? '#fff' : '#64748b',
                  fontSize: '11px', fontWeight: '600', cursor: 'pointer'
                }}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Month selector (only for month view) */}
          {view === 'month' && (
            <select
              value={selectedMonth}
              onChange={e => setSelectedMonth(parseInt(e.target.value))}
              style={{
                background: '#1e293b', border: '1px solid #334155', borderRadius: '6px',
                color: '#e2e8f0', padding: '4px 8px', fontSize: '12px'
              }}
            >
              {MONTHS.slice(1).map((m, i) => (
                <option key={i + 1} value={i + 1}>{m}</option>
              ))}
            </select>
          )}
          
          {/* Year selector */}
          <select
            value={selectedYear}
            onChange={e => setSelectedYear(parseInt(e.target.value))}
            style={{
              background: '#1e293b', border: '1px solid #334155', borderRadius: '6px',
              color: '#e2e8f0', padding: '4px 8px', fontSize: '12px'
            }}
          >
            {[2026, 2025, 2024].map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          
          {/* Upload button */}
          <button
            onClick={() => setShowUpload(!showUpload)}
            style={{
              background: showUpload ? '#334155' : '#10b981', color: '#fff',
              border: 'none', borderRadius: '6px', padding: '6px 12px',
              fontSize: '11px', fontWeight: '600', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '4px'
            }}
          >
            {showUpload ? '✕' : '📁 Upload'}
          </button>
        </div>
      </div>

      {/* Upload panel */}
      {showUpload && (
        <div style={{ borderBottom: '1px solid #1e293b' }}>
          <PLUpload 
            userEmail={userEmail} 
            onUploadComplete={() => { setShowUpload(false); loadData(); }} 
          />
        </div>
      )}

      {/* Title */}
      <div style={{ padding: '12px 16px 8px', color: '#94a3b8', fontSize: '13px', fontWeight: '600' }}>
        {viewTitles[view]}
      </div>

      {/* Data table */}
      {isLoading ? (
        <div style={{ padding: '20px', color: '#cbd5e1', textAlign: 'center' }}>Loading...</div>
      ) : viewData.length === 0 ? (
        <div style={{ padding: '20px', color: '#cbd5e1', textAlign: 'center' }}>
          No data for this period. Upload a QBO P&L report.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr style={{ background: '#1e293b' }}>
                <th style={{ padding: '10px 16px', textAlign: 'left', color: '#94a3b8', fontWeight: '600' }}>Period</th>
                <th style={{ padding: '10px 12px', textAlign: 'right', color: '#94a3b8', fontWeight: '600' }}>Revenue</th>
                {hasPY && <th style={{ padding: '10px 12px', textAlign: 'right', color: '#94a3b8', fontWeight: '600' }}>vs PY</th>}
                <th style={{ padding: '10px 12px', textAlign: 'right', color: '#94a3b8', fontWeight: '600' }}>COGS</th>
                <th style={{ padding: '10px 12px', textAlign: 'right', color: '#94a3b8', fontWeight: '600' }}>Labor/OH</th>
                <th style={{ padding: '10px 12px', textAlign: 'right', color: '#94a3b8', fontWeight: '600' }}>Net</th>
                {hasPY && <th style={{ padding: '10px 12px', textAlign: 'right', color: '#94a3b8', fontWeight: '600' }}>vs PY</th>}
                <th style={{ padding: '10px 12px', textAlign: 'right', color: '#94a3b8', fontWeight: '600' }}>Margin</th>
              </tr>
            </thead>
            <tbody>
              {viewData.map((row, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: '10px 16px', color: '#e2e8f0' }}>{row.period_label}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: '#4ade80' }}>
                    {formatCurrency(row.total_revenue, true)}
                  </td>
                  {hasPY && (
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                      {formatDiff(row.total_revenue, row.py_total_revenue)}
                    </td>
                  )}
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: '#fb923c' }}>
                    {formatCurrency(row.materials_expense, true)}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: '#f87171' }}>
                    {formatCurrency(row.labor_expense, true)}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: row.net_amount >= 0 ? '#4ade80' : '#f87171', fontWeight: '600' }}>
                    {formatCurrency(row.net_amount, true)}
                  </td>
                  {hasPY && (
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                      {formatDiff(row.net_amount, row.py_net_amount)}
                    </td>
                  )}
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: row.net_amount >= 0 ? '#4ade80' : '#f87171', fontWeight: '600' }}>
                    {formatMargin(row.net_amount, row.total_revenue)}
                  </td>
                </tr>
              ))}
              {/* Totals row */}
              <tr style={{ background: '#1e293b', fontWeight: '700' }}>
                <td style={{ padding: '10px 16px', color: '#e2e8f0' }}>Total</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', color: '#4ade80' }}>
                  {formatCurrency(totals.total_revenue, true)}
                </td>
                {hasPY && (
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                    {formatDiff(totals.total_revenue, totals.py_total_revenue)}
                  </td>
                )}
                <td style={{ padding: '10px 12px', textAlign: 'right', color: '#fb923c' }}>
                  {formatCurrency(totals.materials_expense, true)}
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right', color: '#f87171' }}>
                  {formatCurrency(totals.labor_expense, true)}
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right', color: totals.net_amount >= 0 ? '#4ade80' : '#f87171' }}>
                  {formatCurrency(totals.net_amount, true)}
                </td>
                {hasPY && (
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                    {formatDiff(totals.net_amount, totals.py_net_amount)}
                  </td>
                )}
                <td style={{ padding: '10px 12px', textAlign: 'right', color: totals.net_amount >= 0 ? '#4ade80' : '#f87171' }}>
                  {formatMargin(totals.net_amount, totals.total_revenue)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
