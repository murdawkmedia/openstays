import type { PriceBreakdown } from '../../shared/pricing';
import { formatCad } from '../lib/money';

/** Line-item price breakdown, shared by the unit-type preview and checkout page. */
export function PriceBreakdownView({
  price,
  nights,
}: {
  price: PriceBreakdown;
  nights: number;
}) {
  return (
    <dl className="space-y-1.5 text-sm">
      <Row label={`Nightly subtotal (${nights} night${nights === 1 ? '' : 's'})`} value={price.nightlySubtotalCents} />
      {price.addOnSubtotalCents > 0 ? <Row label="Add-ons" value={price.addOnSubtotalCents} /> : null}
      {price.promoDiscountCents > 0 ? <Row label="Promo discount" value={-price.promoDiscountCents} /> : null}
      <Row label="GST" value={price.gstCents} />
      <div className="my-2 border-t border-stone-200" />
      <Row label="Total" value={price.totalCents} strong />
      {price.giftCertAppliedCents > 0 ? (
        <Row label="Gift certificate applied" value={-price.giftCertAppliedCents} />
      ) : null}
      <Row label="Due now (deposit)" value={price.depositDueCents} strong />
      {price.balanceDueCents > 0 ? (
        <Row label="Balance due at check-in" value={price.balanceDueCents} />
      ) : null}
    </dl>
  );
}

function Row({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${strong ? 'font-semibold text-stone-900' : 'text-stone-600'}`}>
      <dt>{label}</dt>
      <dd>{formatCad(value)}</dd>
    </div>
  );
}
