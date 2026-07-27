import { PUBLIC_PAYMENT_DISCLOSURE } from '../lib/livePayments';

type Props = {
  rail: 'zaprite' | 'wavelength';
  accepted: boolean;
  onAcceptedChange: (accepted: boolean) => void;
};

export function LivePaymentDisclosure({
  rail,
  accepted,
  onAcceptedChange,
}: Props) {
  return (
    <section className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
      <h2 className="font-semibold">Fictional booking and payment disclosure</h2>
      <p className="mt-2">{PUBLIC_PAYMENT_DISCLOSURE}</p>
      <p className="mt-2 font-medium">
        {rail === 'zaprite'
          ? 'This checkout creates a real CA$1 voluntary contribution.'
          : 'This checkout sends exactly 1,000 signet test sats.'}
      </p>
      <label className="mt-4 flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 accent-emerald-700"
          checked={accepted}
          onChange={(event) => onAcceptedChange(event.target.checked)}
        />
        <span>
          No accommodation, reservation, or other lodging service is being purchased.
          I understand a contribution is voluntary, not tax-deductible, and has no charitable receipt.
          I may request a refund from my booking page. Wavelength uses signet test sats.
        </span>
      </label>
    </section>
  );
}
