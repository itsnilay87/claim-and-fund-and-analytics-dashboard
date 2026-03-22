/**
 * PortfolioSelector.jsx — Dropdown / button group for switching portfolio modes.
 *
 * Renders as inline button group in the header. Shows available portfolios
 * (probed from data files) and highlights active one.
 */

import React from 'react';
import { COLORS, FONT, useUISettings } from '../theme';
import { PORTFOLIO_MODES } from '../data/dashboardData';

const MODE_ICONS = {
  all:      '📊',
  siac:     '🌏',
  domestic: '🏛️',
};

export default function PortfolioSelector({
  currentMode,
  onModeChange,
  availablePortfolios = ['all'],
}) {
  const { ui } = useUISettings();

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
    }}>
      <span style={{
        color: COLORS.textMuted,
        fontSize: ui.sizes.sm,
        fontWeight: 600,
        marginRight: 4,
      }}>
        Portfolio
      </span>

      {PORTFOLIO_MODES.map(({ id, label, color }) => {
        const isActive = currentMode === id;
        const isAvailable = availablePortfolios.includes(id);

        return (
          <button
            key={id}
            onClick={() => isAvailable && onModeChange(id)}
            disabled={!isAvailable}
            title={isAvailable ? label : `${label} — no data (run with --portfolio ${id})`}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: isActive ? `2px solid ${color}` : '1px solid transparent',
              cursor: isAvailable ? 'pointer' : 'not-allowed',
              fontFamily: FONT,
              fontSize: ui.sizes.sm,
              fontWeight: isActive ? 700 : 500,
              color: isActive ? '#fff' : (isAvailable ? COLORS.textMuted : '#555'),
              background: isActive ? color : COLORS.card,
              opacity: isAvailable ? 1 : 0.5,
              transition: 'all 0.2s ease',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span>{MODE_ICONS[id] || '📁'}</span>
            <span>{id === 'all' ? 'All (6)' : id === 'siac' ? 'SIAC (3)' : 'Domestic (3)'}</span>
          </button>
        );
      })}
    </div>
  );
}
