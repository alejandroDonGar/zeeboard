/* Personaje de ejemplo para miniaturas y avatares de las maquetas */
function head(p) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" aria-hidden="true"><rect width="100" height="100" fill="${p.bg}"/>
    <g stroke="#2a2420" stroke-width="2" stroke-linejoin="round">
      <path d="M26 44 L22 12 L46 34Z" fill="${p.fur}"/><path d="M74 44 L78 12 L54 34Z" fill="${p.fur}"/>
      <ellipse cx="50" cy="104" rx="34" ry="26" fill="${p.fur}"/>
      <circle cx="50" cy="56" r="28" fill="${p.fur}"/><ellipse cx="50" cy="67" rx="16" ry="12" fill="${p.muzzle}"/>
      <ellipse cx="40" cy="53" rx="4" ry="5" fill="#2a2420"/><ellipse cx="60" cy="53" rx="4" ry="5" fill="#2a2420"/>
      <path d="M47 62 L53 62 L50 66Z" fill="#2a2420"/></g></svg>`;
}
