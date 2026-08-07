/**
 * The three ambient layers behind the entire app: pixel grid, CRT
 * scanlines, and a vignette. Rendered once, fixed to the viewport,
 * pointer-events:none so they're purely decorative. Every screen
 * inherits the texture without knowing about it.
 */
export function Backdrop() {
  return (
    <>
      <div className="vk-grid" />
      <div className="vk-scan" />
      <div className="vk-vignette" />
    </>
  );
}