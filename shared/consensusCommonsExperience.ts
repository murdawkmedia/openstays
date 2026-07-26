export const consensusCommonsMedia = [
  {
    src: '/demo/consensus-commons/exterior.webp',
    alt: 'Fictional two-storey red-brick Consensus Commons guesthouse on a leafy Toronto street after rain.',
    caption: 'Consensus Commons exterior — a fictional Queen West guesthouse.',
  },
  {
    src: '/demo/consensus-commons/node-room.webp',
    alt: 'Fictional Node Room with a queen bed, exposed brick wall, warm oak desk, and black-framed window.',
    caption: 'The Node Room — a calm base between conference sessions.',
  },
  {
    src: '/demo/consensus-commons/hack-lounge.webp',
    alt: 'Fictional shared hack lounge with brick walls, communal oak tables, laptops, whiteboards, and warm evening lights.',
    caption: 'Shared Hack Lounge — where independent ideas converge.',
  },
] as const;

export const CONSENSUS_COMMONS_PHOTO_URLS = consensusCommonsMedia.map((image) => image.src);

export type ConsensusAmenityAction =
  | { kind: 'external'; href: string; title: string }
  | { kind: 'gallery'; imageIndex: number };

const actions: Record<string, ConsensusAmenityAction> = {
  'Fast Wi-Fi': {
    kind: 'external',
    href: 'https://techspecs.ui.com/unifi/cloud-gateways/udr?subcategory=cloud-gateways-wifi-integrated',
    title: 'View the Ubiquiti Dream Router specifications',
  },
  'Shared hack lounge': { kind: 'gallery', imageIndex: 2 },
  'Signet faucet guide': {
    kind: 'external',
    href: 'https://bitcoinsignetfaucet.com/',
    title: 'Open a third-party Bitcoin Signet Faucet guide',
  },
  'Late-night coffee': {
    kind: 'external',
    href: 'https://www.lagolosagelateria.ca/',
    title: 'Visit La Golosa near The Great Hall',
  },
};

export function getConsensusAmenityAction(propertySlug: string, amenity: string): ConsensusAmenityAction | null {
  return propertySlug === 'consensus-commons' ? actions[amenity] ?? null : null;
}
