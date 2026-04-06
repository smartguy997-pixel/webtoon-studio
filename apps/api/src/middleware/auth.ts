import type { Request, Response, NextFunction } from "express";
import { getAuth } from "firebase-admin/auth";

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
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
