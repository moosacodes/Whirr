import QRCode from 'qrcode';

export async function makeQrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, {
    margin: 1,
    width: 360,
    errorCorrectionLevel: 'M',
    color: { dark: '#171310ff', light: '#fffaf2ff' },
  });
}
