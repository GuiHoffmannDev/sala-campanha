// Every Tink product. Nav, /products and each product page read from this list,
// so a new product is one entry here, its drawing in ProductIcon.astro and its page in src/pages/products/.
// `color` is the product's accent: its mini logo is drawn in it, on a pale tint of it. `soon` products show in the menu without a link.
export const PRODUCTS = [
  {
    slug: 'room',
    name: 'Room',
    summary: 'One shared conversation where your team and AI agents make each campaign piece together.',
    color: '#d9620f',
  },
  {
    slug: 'workshop',
    name: 'Workshop',
    summary: 'Chain AI models into reusable workflows for images, video and copy.',
    color: '#9b3fd1',
    soon: true,
  },
  {
    slug: 'stage',
    name: 'Stage',
    summary: 'Animate campaign pieces and export them for every format.',
    color: '#c08f00',
    soon: true,
  },
  {
    slug: 'studio',
    name: 'Studio',
    summary: 'Draw and refine vector illustrations in your brand’s shapes.',
    color: '#3f6fb5',
    soon: true,
  },
  {
    slug: 'press',
    name: 'Press',
    summary: 'Turn one approved piece into every size and channel your brand needs.',
    color: '#9a6a2f',
    soon: true,
  },
] as const

export type ProductSlug = (typeof PRODUCTS)[number]['slug']
