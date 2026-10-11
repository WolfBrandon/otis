// Tiny inline SVG icon set (24×24, stroked with currentColor).

const P = {
  select: '<path d="M6 3l13 8-6 1.5L10 19z"/>',
  box: '<rect x="4" y="5" width="16" height="14" rx="1"/>',
  text: '<path d="M5 7V4h14v3M12 4v16M9 20h6"/>',
  line: '<path d="M3 18h9V8"/><path d="M8 12l4-4 4 4"/>',
  cursor: '<path d="M3 12h7"/><rect x="13" y="6" width="6" height="12" fill="currentColor" stroke="none"/>',
  block: '<rect x="4" y="4" width="7" height="7" fill="currentColor" stroke="none"/><rect x="13" y="4" width="7" height="7" fill="currentColor" stroke="none" opacity=".65"/><rect x="4" y="13" width="7" height="7" fill="currentColor" stroke="none" opacity=".4"/><rect x="13" y="13" width="7" height="7" fill="currentColor" stroke="none" opacity=".18"/>',
  pencil: '<path d="M4 20l1.2-4.8L16 4.4l3.6 3.6L8.8 18.8z"/><path d="M14 6.5l3.5 3.5"/>',
  eraser: '<path d="M9 20h11"/><path d="M5 15.5l9.5-10.5 5.5 5L12 19H8.5z"/><path d="M9.5 10.5l5 5"/>',
  hand: '<path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><path d="M4 4l16 16"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="1"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  unlock: '<rect x="5" y="11" width="14" height="9" rx="1"/><path d="M8 11V8a4 4 0 0 1 7.6-1.7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="1"/><path d="M16 8V4H4v12h4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
  swap: '<path d="M16 3l4 4-4 4M20 7H8M8 21l-4-4 4-4M4 17h12"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  group: '<rect x="3" y="3" width="18" height="18" rx="1" stroke-dasharray="3 3"/><rect x="8" y="8" width="8" height="8"/>',
  paint: '<path d="M4 20c4 0 4-4 8-4s4 4 8 4"/><path d="M8 12l8-8"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  slim: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M15 4v16"/>',
  wide: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M10 4v16M15.5 4v16"/>',
  textart: '<path d="M3 19L8.5 5h3L17 19M5.5 13.5h9"/><path d="M12.5 5H15l5.5 14M17.5 13.5H19" opacity=".55"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9h18M3 14.5h18M9 4v16M15 4v16"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  alignLeft: '<path d="M4 3v18M8 7h10v4H8zM8 14h6v4H8z"/>',
  alignHCenter: '<path d="M12 3v18M6 7h12v4H6zM8 14h8v4H8z"/>',
  alignRight: '<path d="M20 3v18M6 7h10v4H6zM10 14h6v4h-6z"/>',
  alignTop: '<path d="M3 4h18M7 8h4v10H7zM14 8h4v6h-4z"/>',
  alignVCenter: '<path d="M3 12h18M7 6h4v12H7zM14 8h4v8h-4z"/>',
  alignBottom: '<path d="M3 20h18M7 6h4v10H7zM14 10h4v6h-4z"/>',
};

export function icon(name, size = 18) {
  const span = document.createElement('span');
  span.className = 'ico';
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
  return span;
}
