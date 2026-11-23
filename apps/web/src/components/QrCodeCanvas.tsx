'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface QrCodeCanvasProps {
  value: string;
  size?: number;
  className?: string;
}

export function QrCodeCanvas({ value, size = 180, className = '' }: QrCodeCanvasProps) {
  const [dataUrl, setDataUrl] = useState<string>('');

  useEffect(() => {
    let active = true;
    void QRCode.toDataURL(value, {
      width: size,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#0b0a09',
        light: '#faf6ee',
      },
    })
      .then((url) => {
        if (active) setDataUrl(url);
      })
      .catch(() => {
        if (active) setDataUrl('');
      });

    return () => {
      active = false;
    };
  }, [value, size]);

  if (!dataUrl) {
    return (
      <div
        style={{ width: size, height: size }}
        className={`animate-pulse rounded-sm border border-[#f4ede1]/15 bg-[#1b1814] ${className}`}
      />
    );
  }

  return (
    <img
      src={dataUrl}
      alt={`QR Code for ${value}`}
      width={size}
      height={size}
      className={`rounded-sm border border-[#2e2821] bg-[#faf6ee] p-2 shadow-[0_8px_28px_rgba(0,0,0,0.45)] ${className}`}
    />
  );
}
