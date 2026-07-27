import { useEffect, useId, useRef, useState } from 'react';

const TURNSTILE_SCRIPT =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

type TurnstileApi = {
  render: (
    target: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      'expired-callback': () => void;
      'error-callback': () => void;
      theme: 'light';
    },
  ) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

type Props = {
  onToken: (token: string | null) => void;
};

function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  const existing = document.querySelector<HTMLScriptElement>(
    `script[src="${TURNSTILE_SCRIPT}"]`,
  );
  return new Promise((resolve, reject) => {
    const script = existing ?? document.createElement('script');
    const onLoad = () => resolve();
    const onError = () => reject(new Error('TURNSTILE_UNAVAILABLE'));
    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', onError, { once: true });
    if (!existing) {
      script.src = TURNSTILE_SCRIPT;
      script.async = true;
      script.defer = true;
      document.head.append(script);
    }
  });
}

export function TurnstileChallenge({ onToken }: Props) {
  const id = useId();
  const host = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [error, setError] = useState(false);
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY;

  useEffect(() => {
    if (!siteKey || !host.current) {
      setError(true);
      return;
    }
    let cancelled = false;
    void loadTurnstile()
      .then(() => {
        if (cancelled || !host.current || !window.turnstile) return;
        widgetId.current = window.turnstile.render(host.current, {
          sitekey: siteKey,
          callback: (token) => {
            setError(false);
            onToken(token);
          },
          'expired-callback': () => onToken(null),
          'error-callback': () => {
            setError(true);
            onToken(null);
          },
          theme: 'light',
        });
      })
      .catch(() => setError(true));
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) {
        window.turnstile.remove(widgetId.current);
      }
    };
  }, [onToken, siteKey]);

  return (
    <div className="mt-4" aria-labelledby={`${id}-label`}>
      <p id={`${id}-label`} className="text-xs text-stone-600">
        Complete the anti-abuse check to enable a live payment.
      </p>
      <div ref={host} className="mt-2 min-h-16" />
      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-700">
          The payment check is unavailable. Refresh to retry or use the
          simulated tour.
        </p>
      ) : null}
    </div>
  );
}
