import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import sharp from "sharp";

const REGION = "us-east-1"; // Storj usually uses this for S3 compat
const BUCKET = process.env.STORJ_BUCKET;

const s3Client = new S3Client({
  region: REGION,
  endpoint: process.env.STORJ_ENDPOINT || "https://gateway.storjshare.io",
  credentials: {
    accessKeyId: process.env.STORJ_ACCESS_KEY || "",
    secretAccessKey: process.env.STORJ_SECRET_KEY || "",
  },
  forcePathStyle: true, // Required for Storj
});

export const storage = {
  /**
   * Compresses an image using Sharp and uploads it to Storj DCS
   * @param file The file object from Elysia
   * @returns The object key (path) of the uploaded image
   */
  async uploadImage(file: File): Promise<string> {
    if (!BUCKET) throw new Error("STORJ_BUCKET environment variable not set");

    // Validate file size (10MB max)
    const MAX_SIZE = 10 * 1024 * 1024;
    const buffer = Buffer.from(await file.arrayBuffer());

    if (buffer.length > MAX_SIZE) {
      throw new Error('Image too large. Maximum 10MB allowed.');
    }

    const key = `reports/${Date.now()}-${Math.random().toString(36).substring(7)}.webp`;

    console.log(`📸 Processing image: ${file.name} (${(buffer.length / 1024).toFixed(2)} KB)`);

    // Compression pipeline: Resize to max 1200px width, convert to WebP with 80% quality
    // Strip EXIF metadata for privacy
    const compressedBuffer = await sharp(buffer)
      .resize(1200, 1200, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .rotate() // Auto-rotate based on EXIF before stripping
      .withMetadata(false) // Strip all EXIF data for privacy
      .webp({ quality: 80 })
      .toBuffer();

    console.log(`📦 Compressed image: ${(compressedBuffer.length / 1024).toFixed(2)} KB`);

    const command = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: compressedBuffer,
      ContentType: "image/webp",
      CacheControl: "public, max-age=31536000", // Cache for 1 year
      ACL: "public-read", // Make images publicly accessible (no signed URLs needed)
    });

    try {
      await s3Client.send(command);
      console.log(`✅ Uploaded to Storj: ${key}`);

      // Return public URL instead of key (no signed URLs needed)
      const publicUrl = `${process.env.STORJ_ENDPOINT}/${BUCKET}/${key}`;
      return publicUrl;
    } catch (error) {
      console.error("❌ Storj upload failed:", error);
      throw error;
    }
  },

  /**
   * Get public URL for an image (no signing needed with public-read ACL)
   * @param keyOrUrl The object key or full URL from database
   * @returns Public URL
   */
  getPublicUrl(keyOrUrl: string): string {
    if (!keyOrUrl) return "";

    // If already a full URL, return as-is
    if (keyOrUrl.startsWith('http')) return keyOrUrl;

    // Otherwise construct public URL
    return `${process.env.STORJ_ENDPOINT}/${BUCKET}/${keyOrUrl}`;
  }
};
