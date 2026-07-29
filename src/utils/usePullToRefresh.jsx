// ============================================
// JUC-E V3 - Pull to Refresh Hook
// ============================================

import { useState, useRef, useCallback, useEffect } from 'react';

export default function usePullToRefresh(onRefresh) {
  const [pulling, setPulling] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(0);
  const pulling_ref = useRef(false);

  const THRESHOLD = 80;

  const handleTouchStart = useCallback((e) => {
    // Only trigger if scrolled to top
    const scrollTop = document.documentElement.scrollTop || document.body.scrollTop;
    if (scrollTop <= 0) {
      startY.current = e.touches[0].clientY;
      pulling_ref.current = true;
    }
  }, []);

  const handleTouchMove = useCallback((e) => {
    if (!pulling_ref.current) return;
    const diff = e.touches[0].clientY - startY.current;
    if (diff > 0) {
      setPulling(true);
      setPullDistance(Math.min(diff * 0.5, 120));
    }
  }, []);

  const handleTouchEnd = useCallback(async () => {
    if (!pulling_ref.current) return;
    pulling_ref.current = false;

    if (pullDistance >= THRESHOLD && onRefresh) {
      setRefreshing(true);
      try { await onRefresh(); } catch (e) { console.error(e); }
      setRefreshing(false);
    }
    setPulling(false);
    setPullDistance(0);
  }, [pullDistance, onRefresh]);

  useEffect(() => {
    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: true });
    document.addEventListener('touchend', handleTouchEnd);
    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  const PullIndicator = () => {
    if (!pulling && !refreshing) return null;
    return (
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
        display: 'flex', justifyContent: 'center', alignItems: 'center',
        height: pullDistance || 50,
        background: 'linear-gradient(180deg, rgba(34,197,94,0.15) 0%, transparent 100%)',
        transition: pulling ? 'none' : 'height 0.3s ease',
        overflow: 'hidden'
      }}>
        <div style={{
          fontSize: 20,
          opacity: refreshing ? 1 : Math.min(pullDistance / THRESHOLD, 1),
          transform: refreshing ? 'none' : `rotate(${pullDistance * 3}deg)`,
          animation: refreshing ? 'spin 0.8s linear infinite' : 'none'
        }}>
          {refreshing ? '🔄' : (pullDistance >= THRESHOLD ? '✓' : '↓')}
        </div>
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  };

  return { PullIndicator, refreshing };
}
