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
  sun: 'M12 1v2m0 18v2M1 12h2m18 0h2M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0',
};
export type IconName = keyof typeof paths;
export function icon(name: IconName): string {
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]}"/></svg>`;
}
