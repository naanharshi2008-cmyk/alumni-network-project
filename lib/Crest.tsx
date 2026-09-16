/**
 * The Veveaham school crest, on a cream plate.
 *
 * The plate is not decoration: the crest's navy border all but disappears on
 * the site's near-black background, and the plate keeps its outline readable
 * at icon size. The image is decorative wherever the "Veveaham Alumni"
 * wordmark or a heading sits beside it, so alt text would only be read twice.
 */
export default function Crest({ size = 'sm', className = '' }: { size?: 'sm' | 'lg'; className?: string }) {
  return (
    <span className={`nav__logo${size === 'lg' ? ' nav__logo--lg' : ''}${className ? ` ${className}` : ''}`}>
      <img
        src={size === 'lg' ? '/brand/crest.png' : '/brand/crest-96.png'}
        alt=""
        width={size === 'lg' ? 256 : 96}
        height={size === 'lg' ? 256 : 96}
        decoding="async"
      />
    </span>
  );
}
