import { useEffect, useState } from 'react';
import './menu-motion.css';

const LAUNCH_OVERLAY_MS = 1500;

/**
 * The jump into a campaign: a flash, a shock ring and star streaks over the
 * freshly mounted game (menu-motion.css «launch»). Purely visual and
 * pointer-transparent — the game is interactive underneath from the first frame.
 */
export function LaunchOverlay() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), LAUNCH_OVERLAY_MS);
    return () => window.clearTimeout(timer);
  }, []);
  if (!visible) return null;
  return (
    <div className="menu-launch" aria-hidden="true" data-qa-launch-overlay>
      <div className="menu-launch__flash" />
      <div className="menu-launch__streaks" />
      <div className="menu-launch__ring" />
    </div>
  );
}
