// ============================================
// P&L Upload - Parses QBO xlsx, saves to Supabase
// Handles: weekly, monthly, with/without PY comparison
// ============================================
import { useState, useCallback } from 'react';
import { supabase } from '../services/supabase.js';
import * as XLSX from 'xlsx';

export default function PLUpload({ userEmail, onUploadComplete }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  const parseQBOExcel = useCallback((workbook, fileName) => {
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    // Row 4 has period headers, Row 5 might have CURRENT/PY sub-headers
    const headerRow = raw[4] || [];
    const subHeaderRow = raw[5] || [];
    
    // Check if this has PY comparison (row 5 contains "CURRENT" or "(PY)")
    const hasPY = subHeaderRow.some(cell => 
      String(cell).includes('CURRENT') || String(cell).includes('(PY)')
    );

    // Date pattern for period columns
    const datePattern = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[\s\d\-]+\d{4}$/i;
    const monthPattern = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}$/i;
    
    // Find all period columns
    const periods = [];
    for (let c = 1; c < headerRow.length; c++) {
      const cell = String(headerRow[c] || '').trim();
      if (datePattern.test(cell) && !cell.toLowerCase().includes('total')) {
        // Determine if it's a week or month
        const isMonth = monthPattern.test(cell);
        
        // Extract year and month
        const yearMatch = cell.match(/(\d{4})/);
        const year = yearMatch ? parseInt(yearMatch[1]) : new Date().getFullYear();
        const monthMatch = cell.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i);
        const monthNames = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
        const month = monthMatch ? monthNames[monthMatch[1].toLowerCase()] : 1;
        
        // For PY files, current is this column, PY is next column
        const currentCol = c;
        const pyCol = hasPY ? c + 1 : null;
        
        periods.push({
          label: cell,
          col: currentCol,
          pyCol: pyCol,
          year,
          month,
          period_type: isMonth ? 'month' : 'week'
        });
        
        // Skip the PY column in iteration if present
        if (hasPY) c++;
      }
    }

    if (periods.length === 0) {
      throw new Error('No valid date columns found. Expected headers like "Jan 2026" or "Jan 1-4 2026"');
    }

    // Helper to get numeric value from cell
    const getValue = (row, colIdx) => {
      if (colIdx === null || colIdx === undefined) return null;
      const v = row[colIdx];
      if (v === '' || v === null || v === undefined || v === '-') return 0;
      const num = parseFloat(String(v).replace(/[,$()]/g, ''));
      return isNaN(num) ? 0 : (String(v).includes('(') ? -num : num);
    };

    // Parse key totals
    const dataStartRow = hasPY ? 6 : 5;
    let totalIncome = periods.map(() => ({ current: 0, py: null }));
    let totalCOGS = periods.map(() => ({ current: 0, py: null }));
    let grossProfit = periods.map(() => ({ current: 0, py: null }));
    let totalExpenses = periods.map(() => ({ current: 0, py: null }));
    let netIncome = periods.map(() => ({ current: 0, py: null }));

    for (let i = dataStartRow; i < raw.length; i++) {
      const row = raw[i];
      const label = String(row[0] || '').trim();
      
      if (/^Total for Income$/i.test(label)) {
        totalIncome = periods.map((p, idx) => ({
          current: getValue(row, p.col),
          py: p.pyCol ? getValue(row, p.pyCol) : null
        }));
      }
      if (/^Total for Cost of Goods Sold$/i.test(label)) {
        totalCOGS = periods.map((p, idx) => ({
          current: getValue(row, p.col),
          py: p.pyCol ? getValue(row, p.pyCol) : null
        }));
      }
      if (/^Gross Profit$/i.test(label)) {
        grossProfit = periods.map((p, idx) => ({
          current: getValue(row, p.col),
          py: p.pyCol ? getValue(row, p.pyCol) : null
        }));
      }
      if (/^Total for Expenses$/i.test(label)) {
        totalExpenses = periods.map((p, idx) => ({
          current: getValue(row, p.col),
          py: p.pyCol ? getValue(row, p.pyCol) : null
        }));
      }
      if (/^Net Income$/i.test(label)) {
        netIncome = periods.map((p, idx) => ({
          current: getValue(row, p.col),
          py: p.pyCol ? getValue(row, p.pyCol) : null
        }));
      }
    }

    // Build records for Supabase
    const records = periods.map((p, i) => ({
      period_type: p.period_type,
      period_label: p.label,
      period_start: `${p.year}-${String(p.month).padStart(2, '0')}-01`,
      period_end: `${p.year}-${String(p.month).padStart(2, '0')}-28`,
      year: p.year,
      month: p.month,
      week_number: p.period_type === 'week' ? i + 1 : null,
      total_revenue: totalIncome[i].current,
      total_expense: (totalCOGS[i].current || 0) + (totalExpenses[i].current || 0),
      labor_expense: totalExpenses[i].current || 0,
      materials_expense: totalCOGS[i].current || 0,
      net_amount: netIncome[i].current,
      // Prior year
      py_total_revenue: totalIncome[i].py,
      py_total_expense: totalCOGS[i].py !== null && totalExpenses[i].py !== null 
        ? (totalCOGS[i].py || 0) + (totalExpenses[i].py || 0) : null,
      py_net_amount: netIncome[i].py,
      source_file: fileName,
      uploaded_by: userEmail
    }));

    return { periods: records, hasPY };
  }, [userEmail]);

  const handleFile = useCallback((e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    
    setFile(f);
    setError(null);
    setPreview(null);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const arr = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(arr, { type: 'array' });
        const parsed = parseQBOExcel(workbook, f.name);
        setPreview(parsed);
      } catch (err) {
        setError(err.message);
      }
    };
    reader.onerror = () => setError('Failed to read file');
    reader.readAsArrayBuffer(f);
  }, [parseQBOExcel]);

  const handleSave = async () => {
    if (!preview?.periods?.length) return;
    
    setIsSaving(true);
    setError(null);
    
    try {
      for (const period of preview.periods) {
        const { error: upsertError } = await supabase
          .from('pl_data')
          .upsert(period, { 
            onConflict: 'period_type,period_start,period_end,year',
            ignoreDuplicates: false 
          });
        
        if (upsertError) throw upsertError;
      }
      
      onUploadComplete?.();
    } catch (err) {
      setError(`Save failed: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const fmt = (n) => {
    if (n === null || n === undefined) return '-';
    return n < 0 ? `($${Math.abs(n).toLocaleString()})` : `$${n.toLocaleString()}`;
  };

  return (
    <div style={{ padding: '16px' }}>
      <div style={{ marginBottom: '12px' }}>
        <input 
          type="file" 
          accept=".xlsx,.xls,.csv"
          onChange={handleFile}
          style={{ fontSize: '12px' }}
        />
      </div>

      {file && (
        <div style={{ color: '#94a3b8', fontSize: '12px', marginBottom: '8px' }}>
          {file.name}
        </div>
      )}

      {error && (
        <div style={{ background: '#7f1d1d', color: '#fca5a5', padding: '12px', borderRadius: '8px', marginBottom: '12px', fontSize: '12px' }}>
          ⚠️ {error}
        </div>
      )}

      {preview && preview.periods.length > 0 && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{ color: '#4ade80', fontSize: '12px', marginBottom: '8px' }}>
            ✓ Found {preview.periods.length} periods {preview.hasPY && '(with PY comparison)'}
          </div>
          
          {/* Preview table */}
          <div style={{ overflowX: 'auto', marginBottom: '12px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
              <thead>
                <tr style={{ background: '#1e293b' }}>
                  <th style={{ padding: '8px', textAlign: 'left', color: '#94a3b8' }}>Period</th>
                  <th style={{ padding: '8px', textAlign: 'right', color: '#94a3b8' }}>Revenue</th>
                  {preview.hasPY && <th style={{ padding: '8px', textAlign: 'right', color: '#94a3b8' }}>PY Rev</th>}
                  <th style={{ padding: '8px', textAlign: 'right', color: '#94a3b8' }}>Net</th>
                  {preview.hasPY && <th style={{ padding: '8px', textAlign: 'right', color: '#94a3b8' }}>PY Net</th>}
                </tr>
              </thead>
              <tbody>
                {preview.periods.slice(0, 6).map((p, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #1e293b' }}>
                    <td style={{ padding: '8px', color: '#e2e8f0' }}>{p.period_label}</td>
                    <td style={{ padding: '8px', textAlign: 'right', color: '#4ade80' }}>{fmt(p.total_revenue)}</td>
                    {preview.hasPY && <td style={{ padding: '8px', textAlign: 'right', color: '#cbd5e1' }}>{fmt(p.py_total_revenue)}</td>}
                    <td style={{ padding: '8px', textAlign: 'right', color: p.net_amount >= 0 ? '#4ade80' : '#f87171' }}>{fmt(p.net_amount)}</td>
                    {preview.hasPY && <td style={{ padding: '8px', textAlign: 'right', color: '#cbd5e1' }}>{fmt(p.py_net_amount)}</td>}
                  </tr>
                ))}
                {preview.periods.length > 6 && (
                  <tr><td colSpan={preview.hasPY ? 5 : 3} style={{ padding: '8px', color: '#cbd5e1', textAlign: 'center' }}>...and {preview.periods.length - 6} more</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <button
            onClick={handleSave}
            disabled={isSaving}
            style={{
              background: isSaving ? '#334155' : '#3b82f6', color: '#fff',
              border: 'none', borderRadius: '6px', padding: '8px 16px',
              fontSize: '12px', fontWeight: '600', cursor: isSaving ? 'not-allowed' : 'pointer'
            }}
          >
            {isSaving ? 'Saving...' : 'Save to Dashboard'}
          </button>
        </div>
      )}
    </div>
  );
}
