import React from 'react';
import logo from '../resources/logo.svg?raw';

// The desktop icon generator uses this same vector geometry.
export default function Logo() {
  return (
    <span
      className="brand-mark"
      aria-hidden="true"
      dangerouslySetInnerHTML={{
        __html: logo.replace('fill="#7DD3FC"', 'fill="currentColor"'),
      }}
    />
  );
}
