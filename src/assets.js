// The two circular "people" photos on the invite. Real images are uploaded to
// KV (key `asset:left` / `asset:right`) and served by the /photo/:side route;
// until then these placeholders are served instead. Either way the <img> keeps
// its `.photo` class, so CSS (fixed box + object-fit: cover + mobile clamp)
// controls the rendered size — the source image's real dimensions never matter.
export const PLACEHOLDER_SVG = {
  left:
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>" +
    "<rect width='100' height='100' fill='#f2e7ee'/>" +
    "<circle cx='50' cy='40' r='15' fill='#d3bccb'/>" +
    "<path d='M23 84c0-16 12-27 27-27s27 11 27 27z' fill='#d3bccb'/></svg>",
  right:
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>" +
    "<rect width='100' height='100' fill='#e9edf6'/>" +
    "<circle cx='50' cy='40' r='15' fill='#bcc6d8'/>" +
    "<path d='M23 84c0-16 12-27 27-27s27 11 27 27z' fill='#bcc6d8'/></svg>",
};

// Best-effort content-type from magic bytes, for images stored in KV without
// explicit metadata.
export function sniffImageType(bytes) {
  const b = new Uint8Array(bytes);
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return 'application/octet-stream';
}
