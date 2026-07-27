type SearchParamsReader = { get(name: string): string | null };

export function readGuestConfirmation(searchParams: SearchParamsReader): string {
  return searchParams.get('confirmation') ?? searchParams.get('code') ?? '';
}

export function checkoutPath(bookingId: string, confirmationCode: string): string {
  return `/checkout/${bookingId}?confirmation=${encodeURIComponent(confirmationCode)}`;
}

export function walletPath(bookingId: string, confirmationCode: string): string {
  return `/wallet/pay/${bookingId}?confirmation=${encodeURIComponent(confirmationCode)}`;
}
