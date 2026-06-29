import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const accountId = process.env.R2_ACCOUNT_ID ?? "";
const bucket = process.env.R2_BUCKET ?? "";
const publicBase = process.env.R2_PUBLIC_BASE_URL ?? "";

let client: S3Client | null = null;

function getClient(): S3Client {
  if (client) return client;
  client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? ""
    }
  });
  return client;
}

export function segmentKey(dubId: string, idx: number): string {
  return `dubs/${dubId}/seg/${idx}`;
}

export async function presignPut(key: string, mime: string, expiresIn = 900): Promise<string> {
  const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: mime });
  return getSignedUrl(getClient(), command, { expiresIn });
}

export async function presignGet(key: string, expiresIn = 21600): Promise<string> {
  if (publicBase) {
    return `${publicBase.replace(/\/$/, "")}/${key}`;
  }
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(getClient(), command, { expiresIn });
}

export async function deleteKeys(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await getClient().send(
    new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: keys.map((Key) => ({ Key })) }
    })
  );
}
