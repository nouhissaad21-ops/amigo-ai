import type { StoreRole } from "@prisma/client";
declare global {
  namespace Express {
    interface Request {
      id: string;
      auth?: { userId: string; storeId: string; role: StoreRole };
    }
  }
}
export {};
