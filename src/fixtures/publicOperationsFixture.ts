export type PublicOperationKind =
  | 'hold'
  | 'booking'
  | 'payment'
  | 'message'
  | 'refund'
  | 'receipt'
  | 'reward'
  | 'channel'
  | 'treasury'
  | 'front_desk'
  | 'housekeeping'
  | 'maintenance'
  | 'folio'
  | 'quote'
  | 'group'
  | 'report';

export interface PublicOperationRecord {
  id: string;
  kind: PublicOperationKind;
  title: string;
  status: string;
  summary: string;
  updatedLabel: string;
  details: Array<{
    label: string;
    value: string;
  }>;
}

export interface PublicOperationsFixture {
  notice: 'Read-only fictional demo';
  generatedLabel: string;
  metrics: Array<{
    label: string;
    value: string;
    note: string;
  }>;
  records: PublicOperationRecord[];
}

/**
 * This fixture is deliberately source-controlled and detached from Convex.
 * Every value is fictional, judge-safe, and contains no guest or operator data.
 */
export const PUBLIC_OPERATIONS_FIXTURE: PublicOperationsFixture = {
  notice: 'Read-only fictional demo',
  generatedLabel: 'Consensus Commons · sample operations shift',
  metrics: [
    { label: 'Occupancy', value: '68%', note: '14 of 22 fictional sites' },
    { label: 'Arrivals', value: '6 today', note: '5 units ready' },
    { label: 'Open work', value: '4 items', note: '2 housekeeping · 2 maintenance' },
    { label: 'Channel adapter', value: 'Ready', note: 'Not connected' },
  ],
  records: [
    {
      id: 'demo-hold-01',
      kind: 'hold',
      title: 'Node Room hold',
      status: 'Awaiting payment',
      summary: 'Inventory is reserved while the payment window remains open.',
      updatedLabel: '2 min ago',
      details: [
        { label: 'Inventory agreement', value: 'Temporary hold recorded' },
        { label: 'Expiry policy', value: 'Automatic release when unpaid' },
        { label: 'Channel impact', value: 'Availability decrement queued' },
      ],
    },
    {
      id: 'demo-booking-01',
      kind: 'booking',
      title: 'Bad Bash booking',
      status: 'Confirmed',
      summary: 'Availability, payment, and booking state reached consensus.',
      updatedLabel: '6 min ago',
      details: [
        { label: 'Booking state', value: 'Confirmed' },
        { label: 'Payment authority', value: 'Merchant receive matched' },
        { label: 'Notification', value: 'Reservation notice sent' },
      ],
    },
    {
      id: 'demo-payment-wave',
      kind: 'payment',
      title: 'Wavelength contribution',
      status: 'Settled',
      summary: 'A completed 1,000-sat signet receive matched the expected request.',
      updatedLabel: '7 min ago',
      details: [
        { label: 'Rail', value: 'Wavelength · signet' },
        { label: 'Principal', value: '1,000 test sats' },
        { label: 'Authority', value: 'Completed merchant activity' },
      ],
    },
    {
      id: 'demo-payment-zaprite',
      kind: 'payment',
      title: 'Zaprite contribution',
      status: 'Reconciled',
      summary: 'The server fetched the hosted order before accepting payment state.',
      updatedLabel: '19 min ago',
      details: [
        { label: 'Rail', value: 'Zaprite sandbox' },
        { label: 'Amount', value: 'CA$1.00' },
        { label: 'Authority', value: 'Provider order lookup' },
      ],
    },
    {
      id: 'demo-message-01',
      kind: 'message',
      title: 'Booking conversation',
      status: 'Staff replied',
      summary: 'A fictional guest-to-staff thread demonstrates scoped messaging.',
      updatedLabel: '24 min ago',
      details: [
        { label: 'Participants', value: 'Guest role ↔ staff role' },
        { label: 'Delivery', value: 'Opposite-party alert queued' },
        { label: 'Isolation', value: 'Bound to one booking' },
      ],
    },
    {
      id: 'demo-refund-01',
      kind: 'refund',
      title: 'Manual refund case',
      status: 'Needs review',
      summary: 'A manual rail remains paid until staff records external completion.',
      updatedLabel: '31 min ago',
      details: [
        { label: 'Provider', value: 'Wavelength' },
        { label: 'Disposition', value: 'Manual review required' },
        { label: 'Guest notice', value: 'Success notice withheld' },
      ],
    },
    {
      id: 'demo-receipt-01',
      kind: 'receipt',
      title: 'Consensus Receipt',
      status: 'Submitted',
      summary: 'A privacy-safe commitment reached four public timestamp calendars.',
      updatedLabel: '34 min ago',
      details: [
        { label: 'Commitment', value: 'SHA-256 · 91e5…b72c' },
        { label: 'Calendars', value: '4 attestations' },
        { label: 'Bitcoin state', value: 'Anchoring pending' },
      ],
    },
    {
      id: 'demo-reward-01',
      kind: 'reward',
      title: 'Consensus reward',
      status: 'Eligible',
      summary: 'The submitted receipt unlocked one 1,000-sat signet reward.',
      updatedLabel: '34 min ago',
      details: [
        { label: 'Network', value: 'Signet' },
        { label: 'Amount', value: '1,000 test sats' },
        { label: 'Settlement', value: 'Not yet claimed' },
      ],
    },
    {
      id: 'demo-channel-01',
      kind: 'channel',
      title: 'Channex adapter',
      status: 'Ready · not connected',
      summary: 'Availability changes are dirty-marked for a future channel sync.',
      updatedLabel: '41 min ago',
      details: [
        { label: 'Mapping', value: 'Fictional room type mapped' },
        { label: 'Availability', value: 'Refresh ready' },
        { label: 'Certification', value: 'Operator step not attempted' },
      ],
    },
    {
      id: 'demo-treasury-01',
      kind: 'treasury',
      title: 'Signet treasury preview',
      status: 'Dry run',
      summary: 'Excess operator test funds are bounded above a protected reserve.',
      updatedLabel: '1 hr ago',
      details: [
        { label: 'Protected reserve', value: '14,520 test sats' },
        { label: 'Refund liability', value: '1,000 test sats' },
        { label: 'Transfer state', value: 'Preview only' },
      ],
    },
    {
      id: 'demo-front-desk-01',
      kind: 'front_desk',
      title: 'Arrival queue',
      status: '5 of 6 ready',
      summary: 'The desk sees arrivals, balances, party size, unit readiness, and exceptions together.',
      updatedLabel: 'Now',
      details: [
        { label: 'Arrivals', value: '6 fictional stays' },
        { label: 'Ready', value: '5 units verified' },
        { label: 'Exception', value: '1 inspection pending' },
      ],
    },
    {
      id: 'demo-housekeeping-01',
      kind: 'housekeeping',
      title: 'Turnaround board',
      status: 'Cleaning',
      summary: 'Service readiness advances independently from whether a unit is sellable.',
      updatedLabel: '3 min ago',
      details: [
        { label: 'Queue', value: 'Dirty → cleaning → inspection → ready' },
        { label: 'Assignment', value: 'Fictional attendant assigned' },
        { label: 'Inventory impact', value: 'None unless a linked block is created' },
      ],
    },
    {
      id: 'demo-maintenance-01',
      kind: 'maintenance',
      title: 'Power pedestal repair',
      status: 'In progress',
      summary: 'A dated maintenance outage carries an explicit linked inventory block.',
      updatedLabel: '11 min ago',
      details: [
        { label: 'Priority', value: 'High' },
        { label: 'Sellability', value: 'Blocked only for the repair window' },
        { label: 'Resolution', value: 'Releases the linked block with an audit event' },
      ],
    },
    {
      id: 'demo-folio-01',
      kind: 'folio',
      title: 'Camp-store folio',
      status: 'Balanced',
      summary: 'Retail charges and an external-terminal payment are recorded as immutable entries.',
      updatedLabel: '16 min ago',
      details: [
        { label: 'Charges', value: 'CA$42.00' },
        { label: 'Payments', value: 'CA$42.00' },
        { label: 'Corrections', value: 'Reversals only; posted money is never rewritten' },
      ],
    },
    {
      id: 'demo-quote-01',
      kind: 'quote',
      title: 'Long-weekend quote',
      status: 'Sent',
      summary: 'The quote does not occupy inventory; acceptance rechecks availability before creating a hold.',
      updatedLabel: '22 min ago',
      details: [
        { label: 'Inventory', value: 'Non-blocking' },
        { label: 'Expiry', value: 'Tomorrow at noon' },
        { label: 'Acceptance', value: 'Creates the normal 35-minute hold' },
      ],
    },
    {
      id: 'demo-group-01',
      kind: 'group',
      title: 'Paddling club prospect',
      status: 'Prospect',
      summary: 'A fictional group record coordinates dates and contacts without silently occupying sites.',
      updatedLabel: '38 min ago',
      details: [
        { label: 'Requested sites', value: '8' },
        { label: 'Current occupancy', value: 'None' },
        { label: 'Next step', value: 'Create individual audited reservations' },
      ],
    },
    {
      id: 'demo-report-01',
      kind: 'report',
      title: 'Night-audit snapshot',
      status: 'Closed',
      summary: 'The fictional business date preserves revenue, payments, occupancy, refunds, and exceptions.',
      updatedLabel: 'Yesterday',
      details: [
        { label: 'Revenue', value: 'CA$2,418.00' },
        { label: 'Payments', value: 'CA$2,301.00' },
        { label: 'Export', value: 'Accounting CSV ready' },
      ],
    },
  ],
};
