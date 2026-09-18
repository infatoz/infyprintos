import fs from "fs";
import path from "path";
import crypto from "crypto";
import multer from "multer";
import { env } from "../config/env";
import { ApiError } from "../common/errors";

const dest = path.resolve(env.uploadDir);
if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, dest),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-]+/g, "_");
    cb(null, `${Date.now()}-${safe}`);
  }
});

const allowed = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
  "application/postscript",
  "application/illustrator"
]);

const fileFilter: multer.Options["fileFilter"] = (_req, file, cb) => {
  if (!allowed.has(file.mimetype) && !file.originalname.match(/\.(ai|eps|pdf|png|jpe?g|svg|webp)$/i)) {
    return cb(ApiError.badRequest("Unsupported file type"));
  }
  cb(null, true);
};

export const upload = multer({
  storage,
  limits: { fileSize: env.maxFileSizeMb * 1024 * 1024 },
  fileFilter
});

const kycDest = path.join(dest, "kyc");
if (!fs.existsSync(kycDest)) fs.mkdirSync(kycDest, { recursive: true });

export const kycDir = kycDest;

const kycStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, kycDest),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).replace(/[^\w.]+/g, "") || ".bin";
    cb(null, `${Date.now()}-${crypto.randomBytes(12).toString("hex")}${ext}`);
  }
});

export const kycUpload = multer({
  storage: kycStorage,
  limits: { fileSize: env.maxFileSizeMb * 1024 * 1024 },
  fileFilter
});

const photoDest = path.join(dest, "customers");
if (!fs.existsSync(photoDest)) fs.mkdirSync(photoDest, { recursive: true });

export const customerPhotoDir = photoDest;

const imageOnly: multer.Options["fileFilter"] = (_req, file, cb) => {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.mimetype) && !file.originalname.match(/\.(png|jpe?g|webp)$/i)) {
    return cb(ApiError.badRequest("Profile photo must be a PNG, JPEG or WebP image"));
  }
  cb(null, true);
};

const photoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, photoDest),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).replace(/[^\w.]+/g, "") || ".jpg";
    cb(null, `${Date.now()}-${crypto.randomBytes(12).toString("hex")}${ext}`);
  }
});

export const photoUpload = multer({
  storage: photoStorage,
  limits: { fileSize: Math.min(env.maxFileSizeMb, 5) * 1024 * 1024 },
  fileFilter: imageOnly
});

const catalogDest = path.join(dest, "catalog");
if (!fs.existsSync(catalogDest)) fs.mkdirSync(catalogDest, { recursive: true });

export const catalogImageDir = catalogDest;

const catalogImageFilter: multer.Options["fileFilter"] = (_req, file, cb) => {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.mimetype) && !file.originalname.match(/\.(png|jpe?g|webp)$/i)) {
    return cb(ApiError.badRequest("Catalog image must be a PNG, JPEG or WebP file"));
  }
  cb(null, true);
};

const catalogStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, catalogDest),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).replace(/[^\w.]+/g, "") || ".jpg";
    cb(null, `${Date.now()}-${crypto.randomBytes(12).toString("hex")}${ext}`);
  }
});

export const catalogUpload = multer({
  storage: catalogStorage,
  limits: { fileSize: Math.min(env.maxFileSizeMb, 5) * 1024 * 1024 },
  fileFilter: catalogImageFilter
});
