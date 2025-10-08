import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

let client: S3Client | null = null;

export const getS3Client = () => {
  if (client) return client;

  const region = process.env.S3_REGION ?? "us-east-1";
  const endpoint = process.env.S3_ENDPOINT;

  client = new S3Client({
    region,
    endpoint,
    forcePathStyle: Boolean(endpoint),
    credentials: process.env.S3_ACCESS_KEY_ID
      ? {
          accessKeyId: process.env.S3_ACCESS_KEY_ID!,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? ""
        }
      : undefined
  });

  return client;
};

export async function putObject(opts: {
  bucket: string;
  key: string;
  body: Buffer | Uint8Array | string;
  contentType: string;
}) {
  const command = new PutObjectCommand({
    Bucket: opts.bucket,
    Key: opts.key,
    Body: opts.body,
    ContentType: opts.contentType
  });

  await getS3Client().send(command);
}
