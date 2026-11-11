import typography from './typography.json';

export { typography };

export function applyTypography() {
  const style = document.documentElement.style;
  style.setProperty('--font-ui', typography.fontFamily);
  for (const role of Object.keys(typography.sizes) as Array<keyof typeof typography.sizes>) {
    style.setProperty(`--text-${role}-size`, `${typography.sizes[role]}px`);
    style.setProperty(`--text-${role}-line`, `${typography.lineHeights[role]}px`);
  }
}
