import { defineConfig } from 'astro/config'

export default defineConfig({
  // Astro 7 defaults to 'jsx' whitespace rules, which drop spaces between inline elements in copy.
  compressHTML: true,
})
