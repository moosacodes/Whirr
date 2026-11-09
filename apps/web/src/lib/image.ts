export async function fileToSmallDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choose a PNG, JPEG or WebP image.');
  if (file.size > 12 * 1024 * 1024) throw new Error('Image is too large (maximum 12 MB).');
  const bitmap = await createImageBitmap(file);
  const max = 720;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not process this image in the browser.');
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
  if (dataUrl.length > 330_000) throw new Error('Image is still too large after resizing; choose a simpler photo.');
  return dataUrl;
}
