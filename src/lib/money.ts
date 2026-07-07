// Money is always integer cents (see CLAUDE.md convention #1). This is the
// ONLY place the client formats cents into a display string.
// Currency comes from the property (CAD default; USD/EUR offered in settings).

export { formatMoney, SUPPORTED_CURRENCIES, DEFAULT_CURRENCY } from '../../shared/currency';
