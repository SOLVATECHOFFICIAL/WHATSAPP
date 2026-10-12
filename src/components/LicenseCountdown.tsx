import { useEffect, useState, type FC } from 'react';
import { calculateRemainingTime } from '../services/license';

interface LicenseCountdownProps {
  expiresAt: string | null;
  isUnlimited: boolean;
  nowOffsetMs: number;
}

export const LicenseCountdown: FC<LicenseCountdownProps> = ({
  expiresAt,
  isUnlimited,
  nowOffsetMs,
}) => {
  const [remaining, setRemaining] = useState(() =>
    calculateRemainingTime(expiresAt, isUnlimited, Date.now() + nowOffsetMs)
  );

  useEffect(() => {
    const update = () => {
      const next = calculateRemainingTime(expiresAt, isUnlimited, Date.now() + nowOffsetMs);
      setRemaining((previous) =>
        previous.formatted === next.formatted && previous.isExpired === next.isExpired
          ? previous
          : next
      );
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [expiresAt, isUnlimited, nowOffsetMs]);

  return (
    <span
      className={`text-xs font-bold font-mono ${
        remaining.isExpired && !remaining.isUnlimited ? 'text-rose-300' : 'text-emerald-300'
      }`}
    >
      {remaining.formatted}
    </span>
  );
};
