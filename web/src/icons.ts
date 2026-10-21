const paths = {
  undo: 'M9 5 4 10l5 5M4 10h9a6 6 0 0 1 0 12',
  redo: 'm15 5 5 5-5 5m5-5h-9a6 6 0 0 0 0 12',
  rotate: 'M20 10a8 8 0 1 0-2 8M20 4v6h-6',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7',
  hand: 'M8 12V6a2 2 0 0 1 4 0v5-7a2 2 0 0 1 4 0v7-5a2 2 0 0 1 4 0v9c0 5-3 7-7 7-3 0-5-2-7-5l-3-4a2 2 0 0 1 3-2l2 2',
  save: 'M5 3h12l4 4v14H3V3h2Zm2 0v6h10V3M7 21v-8h10v8',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  sound: 'M11 4 6 8H3v8h3l5 4V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14',
  muted: 'M11 4 6 8H3v8h3l5 4V4Zm5 5 6 6m0-6-6 6',
  help: 'M9 9a3 3 0 1 1 4 3c-1 .5-1 1-1 2m0 3h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  home: 'm3 10 9-7 9 7M5 9v12h14V9M9 21v-7h6v7',
  path: 'M5 21v-4a4 4 0 0 1 4-4h6a4 4 0 0 0 0-8h-3m-3-3 3 3-3 3M9 17h4m-4 4h4',
  tree: 'm12 3-7 8h3l-5 7h18l-5-7h3l-7-8Zm0 15v4',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  close: 'm6 6 12 12M6 18 18 6',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  upload: 'M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5',
  check: 'm5 12 4 4L19 6',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  'eye-off':
    'm3 3 18 18M10 5.2c.6-.1 1.3-.2 2-.2 6.5 0 10 7 10 7a19 19 0 0 1-3 3.8M6.2 6.2C3.5 8.4 2 12 2 12s3.5 7 10 7c1.8 0 3.4-.5 4.8-1.2M9.9 9.9a3 3 0 0 0 4.2 4.2',
  'rotate-left': 'm7 4-4 4 4 4M3 8h10a7 7 0 1 1-5 12',
  'rotate-right': 'm17 4 4 4-4 4m4-4H11a7 7 0 1 0 5 12',
  sunset: 'M3 17h18M5 21h14M7 17a5 5 0 0 1 10 0M12 3v4M4 8l2 2m12 0 2-2M2 13h2m16 0h2',
  moon: 'M20.8 14A9 9 0 0 1 10 3.2 9 9 0 1 0 20.8 14Z',
  water: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z',
  share: 'M12 15V3m-4 4 4-4 4 4M5 11v9h14v-9',
  star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9L12 3Z',
  sun: 'M12 1v2m0 18v2M1 12h2m18 0h2M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0',
};
export type IconName = keyof typeof paths;
export function icon(name: IconName): string {
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]}"/></svg>`;
}
