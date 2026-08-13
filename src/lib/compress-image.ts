// Canvas-based client-side compression before upload — a cheap mitigation
// against Supabase Storage's free-tier 1 GB cap filling up fast with
// full-resolution screenshots. Zero new dependencies: draws to an
// offscreen canvas capped at MAX_DIMENSION on the longest edge and
// re-encodes at JPEG_QUALITY. Skips GIFs (animated GIFs break under
// canvas re-encoding) and anything already small.
//
// Always preserves the original filename — it's load-bearing for
// CR/TC/sequence parsing in test-result-screenshots.functions.ts, so
// compression must never touch it, only the bytes.
const COMPRESS_THRESHOLD_BYTES = 1 * 1024 * 1024; // 1 MB
const MAX_DIMENSION = 1920;
const JPEG_QUALITY = 0.8;

export async function compressImageIfNeeded(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  if (file.size <= COMPRESS_THRESHOLD_BYTES) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1) {
      bitmap.close();
      return file;
    }
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const outputType = file.type === "image/png" ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, outputType, JPEG_QUALITY),
    );
    if (!blob || blob.size >= file.size) return file;

    return new File([blob], file.name, { type: blob.type, lastModified: file.lastModified });
  } catch {
    // Compression is a best-effort optimization — any failure (unsupported
    // format, canvas taint, etc.) falls back to uploading the original.
    return file;
  }
}
