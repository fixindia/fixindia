/* eslint-disable @typescript-eslint/no-unused-vars */
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import sharp from "sharp";
import { env } from '../config';

const REGION = "us-east-1"; // Storj usually uses this for S3 compat
const BUCKET = env.STORJ_BUCKET;

const s3Client = new S3Client({
  region: REGION,
  endpoint: env.STORJ_ENDPOINT,
  credentials: {
    accessKeyId: env.STORJ_ACCESS_KEY,
    secretAccessKey: env.STORJ_SECRET_KEY,
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
      .rotate() // Bake in EXIF orientation before metadata is dropped
      // NOTE: do NOT call .withMetadata() here. In sharp, withMetadata()
      // *keeps* metadata (the `false` arg is ignored), which would leak the
      // photo's GPS/EXIF in the public image. Sharp strips all metadata by
      // default, so omitting the call is what actually protects reporter privacy.
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
      const publicUrl = `${env.STORJ_ENDPOINT}/${BUCKET}/${key}`;
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
    return `${env.STORJ_ENDPOINT}/${BUCKET}/${keyOrUrl}`;
  },

  /**
   * Extract the object key from a stored value (which may be a full public URL
   * or a bare key). Used by deleteImage.
   */
  keyFromStoredValue(keyOrUrl: string): string {
    if (!keyOrUrl) return "";
    if (keyOrUrl.startsWith('http')) {
      // Full URL: https://<endpoint>/<bucket>/<key...>
      try {
        const u = new URL(keyOrUrl);
        const prefix = `/${BUCKET}/`;
        const idx = u.pathname.indexOf(prefix);
        if (idx >= 0) return decodeURIComponent(u.pathname.slice(idx + prefix.length));
        return decodeURIComponent(u.pathname.replace(/^\//, ''));
      } catch {
        return "";
      }
    }
    return keyOrUrl;
  },

  /**
   * Delete an uploaded image object from Storj (10A.6).
   * Used when a report is rejected/removed so rejected-report images don't
   * linger as orphans in object storage.
   * @param keyOrUrl The object key OR full public URL stored in the DB.
   * @returns true if deleted (or already absent), false on error.
   */
  async deleteImage(keyOrUrl: string): Promise<boolean> {
    if (!BUCKET) throw new Error("STORJ_BUCKET environment variable not set");
    const key = this.keyFromStoredValue(keyOrUrl);
    if (!key) return false;

    try {
      const command = new DeleteObjectCommand({ Bucket: BUCKET, Key: key });
      await s3Client.send(command);
      return true;
    } catch (error) {
      // Don't throw — a failed cleanup must not break the rejection flow. Log
      // and continue; the row is already rejected.
      console.error("❌ Storj delete failed:", error);
      return false;
    }
  },
};
