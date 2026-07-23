export interface GuestFormValue {
  name: string;
  email: string;
  phone: string;
  marketingOptIn: boolean;
  adults: number;
  children: number;
}

export interface GuestFormProps {
  value: GuestFormValue;
  onChange: (value: GuestFormValue) => void;
  maxOccupancy: number;
}

/** Guest contact + party-size form used on the unit-type booking page. */
export function GuestForm({ value, onChange, maxOccupancy }: GuestFormProps) {
  const set = <K extends keyof GuestFormValue>(key: K, v: GuestFormValue[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <div className="space-y-4">
      <div>
        <label className="field-label" htmlFor="guest-name">
          Full name
        </label>
        <input
          id="guest-name"
          className="field-input"
          type="text"
          required
          value={value.name}
          onChange={(e) => set('name', e.target.value)}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="field-label" htmlFor="guest-email">
            Email
          </label>
          <input
            id="guest-email"
            className="field-input"
            type="email"
            required
            value={value.email}
            onChange={(e) => set('email', e.target.value)}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="guest-phone">
            Phone
          </label>
          <input
            id="guest-phone"
            className="field-input"
            type="tel"
            required
            value={value.phone}
            onChange={(e) => set('phone', e.target.value)}
          />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="field-label" htmlFor="guest-adults">
            Adults
          </label>
          <input
            id="guest-adults"
            className="field-input"
            type="number"
            min={1}
            max={maxOccupancy}
            value={value.adults}
            onChange={(e) => set('adults', Math.max(1, Math.min(maxOccupancy, Number(e.target.value) || 1)))}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="guest-children">
            Children
          </label>
          <input
            id="guest-children"
            className="field-input"
            type="number"
            min={0}
            max={maxOccupancy}
            value={value.children}
            onChange={(e) => set('children', Math.max(0, Math.min(maxOccupancy, Number(e.target.value) || 0)))}
          />
        </div>
      </div>
      <label className="flex items-start gap-2 text-sm text-stone-600">
        <input
          type="checkbox"
          checked={value.marketingOptIn}
          onChange={(e) => set('marketingOptIn', e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-stone-300 text-emerald-700 focus:ring-emerald-600"
        />
        <span>
          Send me occasional news and offers.
          <span className="mt-1 block text-xs text-stone-500">
            Consent is recorded with your reservation; this demo does not send marketing campaigns.
          </span>
        </span>
      </label>
    </div>
  );
}
