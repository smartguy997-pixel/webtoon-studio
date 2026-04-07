import type { Request, Response, NextFunction } from "express";
import { getAuth } from "firebase-admin/auth";

const IS_DEV =
  process.env.NODE_ENV !== "production" &&
  (process.env.FIRESTORE_EMULATOR_HOST !== undefined ||
    (!process.env.FIREBASE_PRIVATE_KEY && !process.env.FIREBASE_CLIENT_EMAIL));

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  // Dev/emulator mode: accept `Bearer local` without Firebase verification
  if (IS_DEV && authHeader === "Bearer local") {
    (req as Request & { uid: string }).uid = "local";
    next();
    return;
  }

  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "인증 토큰이 없습니다" });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const decoded = await getAuth().verifyIdToken(token);
    (req as Request & { uid: string }).uid = decoded.uid;
    next();
  } catch {
    res.status(401).json({ error: "유효하지 않은 토큰입니다" });
  }
}
