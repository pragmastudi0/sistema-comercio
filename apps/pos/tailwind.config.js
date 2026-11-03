import base from '@comercio/config/tailwind';

/** @type {import('tailwindcss').Config} */
export default {
  ...base,
  content: ['./index.html', './src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
};
