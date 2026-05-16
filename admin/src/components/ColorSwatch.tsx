type Props = {
  color: string | number | null;
  size?: number;
};

// Resolves the colorId stored on globalAuthor records into a CSS color.
// AuthorManager stores either a string hex (legacy) or an integer index
// into the palette returned by getColorPalette() — we re-derive the
// palette here rather than fetch it because the order is stable and the
// admin already has many other small constants inline.
const PALETTE = [
  '#ffc7c7', '#fff1c7', '#e3ffc7', '#c7ffd5', '#c7ffff', '#c7d5ff',
  '#e3c7ff', '#ffc7f1', '#ffa8a8', '#ffe699', '#cfff9e', '#99ffb3',
  '#a3ffff', '#99b3ff', '#cc99ff', '#ff99e5', '#e7b1b1', '#e9dcAf',
  '#cde9af', '#bfedcc', '#b1e7e7', '#c3cdee', '#d2b8ea', '#eec3e6',
  '#e9cece', '#e7e0ca', '#d3e5c7', '#bce1c5', '#c1e2e2', '#c1c9e2',
  '#cfc1e2', '#e0bdd9', '#baded3', '#a0f8eb', '#b1e7e0', '#c3c8e4',
  '#cec5e2', '#b1d5e7', '#cda8f0', '#f0f0a8', '#f2f2a6', '#f5a8eb',
  '#c5f9a9', '#ececbb', '#e7c4bc', '#daf0b2', '#b0a0fd', '#bce2e7',
  '#cce2bb', '#ec9afe', '#edabbd', '#aeaeea', '#c4e7b1', '#d722bb',
  '#f3a5e7', '#ffa8a8', '#d8c0c5', '#eaaedd', '#adc6eb', '#bedad1',
  '#dee9af', '#e9afc2', '#f8d2a0', '#b3b3e6',
];

export const ColorSwatch = ({color, size = 14}: Props) => {
  let resolved = '#ccc';
  if (typeof color === 'string') {
    resolved = color;
  } else if (typeof color === 'number' && color >= 0 && color < PALETTE.length) {
    resolved = PALETTE[color];
  }
  return <span style={{
    display: 'inline-block', width: size, height: size,
    background: resolved, border: '1px solid rgba(0,0,0,0.2)',
    borderRadius: 3, verticalAlign: 'middle',
  }}/>;
};
