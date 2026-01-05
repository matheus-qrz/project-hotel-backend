import cloudinary from "../config/cloudinary";

export async function uploadImageBuffer(opts: {
  buffer: Buffer;
  mimetype: string;
  folder: string;
}) {
  const { buffer, mimetype, folder } = opts;

  const dataUri = `data:${mimetype};base64,${buffer.toString("base64")}`;

  const result = await cloudinary.uploader.upload(dataUri, {
    folder,
    resource_type: "image",
  });

  return {
    imageUrl: result.secure_url,
    imagePublicId: result.public_id,
  };
}

export async function deleteImageByPublicId(publicId?: string | null) {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch {
    // não explode o fluxo por falha de cleanup
  }
}