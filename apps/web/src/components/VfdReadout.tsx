import React from 'react';

interface VfdReadoutProps {
  label: string;
  value: string;
  tone?: 'amber' | 'mint';
  className?: string;
}

/**
 * Vacuum Fluorescent Display (VFD) numeric/code readout inspired by vintage Japanese Hi-Fi KTV decks.
 */
export const VfdReadout: React.FC<VfdReadoutProps> = ({
  label,
  value,
  tone = 'amber',
  className = '',
}) => {
  const isAmber = tone === 'amber';
  return (
    <div
      className={`rounded-sm px-3.5 py-2 ${isAmber ? 'vfd-amber-screen' : 'vfd-screen'} ${className}`}
    >
      <div className="font-mono text-[10px] font-semibold tracking-[0.22em] text-[#8c7f6e] uppercase">
        {label}
      </div>
      <div
        className={`mt-0.5 font-mono text-xl font-bold tracking-[0.18em] tabular-nums ${
          isAmber ? 'vfd-glow-amber text-[#ffb740]' : 'vfd-glow-mint text-[#34d399]'
        }`}
      >
        {value}
      </div>
    </div>
  );
};

interface StatusLampProps {
  active: boolean;
  activeLabel: string;
  inactiveLabel: string;
  tone?: 'live' | 'mint' | 'amber';
}

export const StatusLamp: React.FC<StatusLampProps> = ({
  active,
  activeLabel,
  inactiveLabel,
  tone = 'mint',
}) => {
  const dotClass = active
    ? tone === 'live'
      ? 'bg-[#e63946] animate-on-air'
      : tone === 'amber'
        ? 'bg-[#f59e0b] shadow-[0_0_8px_rgba(245,158,11,0.8)]'
        : 'bg-[#34d399] shadow-[0_0_8px_rgba(52,211,153,0.75)]'
    : 'bg-[#f59e0b] animate-pulse';

  return (
    <span className="inline-flex items-center gap-2 rounded-sm border border-[#f4ede1]/12 bg-[#13110e]/90 px-2.5 py-1 font-mono text-[10px] font-semibold tracking-[0.18em] text-[#c8bca8] uppercase">
      <span className={`h-2 w-2 rounded-full ${dotClass}`} />
      <span>{active ? activeLabel : inactiveLabel}</span>
    </span>
  );
};
