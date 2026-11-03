import base from '@comercio/config/tailwind';

/** @type {import('tailwindcss').Config} */
export default {
  ...base,
  content: ['./src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
};
