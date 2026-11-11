import '@testing-library/jest-dom';

Object.defineProperty(window, 'matchMedia', { writable: true, value: (media: string) => ({
  matches: false, media, onchange: null,
  addListener: () => {}, removeListener: () => {},
  addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
}) });
