const preferenceKey = 'imagescout-theme';

export function savedTheme() {
  try {
    const value = localStorage.getItem(preferenceKey);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

export function initialTheme() {
  return (
    savedTheme() ||
    (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  );
}

export function applyTheme(theme, persist = false) {
  document.documentElement.dataset.theme = theme;
  if (persist) {
    try {
      localStorage.setItem(preferenceKey, theme);
    } catch {
      /* Keep the toggle usable without storage. */
    }
  }
}
