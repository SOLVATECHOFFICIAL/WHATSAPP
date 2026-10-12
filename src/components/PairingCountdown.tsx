import { useEffect, useState } from 'react';

interface PairingCountdownProps {
  pairingCode: string;
}

export function PairingCountdown({ pairingCode }: PairingCountdownProps) {
  const [secondsRemaining, setSecondsRemaining] = useState(120);

  useEffect(() => {
    const expiresAt = Date.now() + 120_000;
    const updateCountdown = () => {
      setSecondsRemaining(Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)));
    };

    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, [pairingCode]);

  return <>{secondsRemaining}s remaining</>;
}
