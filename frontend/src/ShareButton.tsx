import { useEffect, useRef, useState } from 'react';
import { Share2 } from 'lucide-react';
import { pageTitle, SHARE_BASE } from './url';
import { SHARE_CONFIRM_MS } from './layout';

/**
 * Share the current URL (which App keeps in sync through url.ts: ?pc= / ?area= /
 * ?area2= / ?filter= / ?nation= / ?order=):
 * the native share sheet where there is one, otherwise copy it to the clipboard.
 */
export const ShareButton: React.FC<{ title: string }> = ({ title }) => {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const flash = (s: 'copied' | 'failed') => {
    setStatus(s);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setStatus('idle'), SHARE_CONFIRM_MS);
  };

  const share = async () => {
    const url = window.location.href;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: pageTitle(SHARE_BASE, title), url });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return; // cancelled
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      flash('copied');
    } catch {
      flash('failed');
    }
  };

  return (
    <button className="share-btn" onClick={share} aria-live="polite">
      <Share2 size={14} />
      {status === 'copied' ? 'Link copied' : status === 'failed' ? 'Copy failed' : 'Share'}
    </button>
  );
};
