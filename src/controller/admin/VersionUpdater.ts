import { Request, Response, NextFunction } from "express";
import { SuccessResponse } from "../../utils/response";
import * as versionUpdater from "../../utils/versionUpdater";

/**
 * Resolves the clientName from request body, query, or the current tenant's FRONTEND_URL.
 * If running on janssen or bcknd and no specific client is provided, defaults to "all" (or the specified client).
 */
const resolveClientName = (req: Request): string => {
    const fromBody = req.body?.clientName;
    if (fromBody && typeof fromBody === "string" && fromBody.trim()) {
        return fromBody.trim();
    }
    const fromQuery = req.query?.clientName;
    if (fromQuery && typeof fromQuery === "string" && fromQuery.trim()) {
        return fromQuery.trim();
    }
    const frontendUrl = process.env.FRONTEND_URL || "";
    const cleanUrl = frontendUrl.replace(/^https?:\/\//, '').split('.')[0];
    if (cleanUrl) {
        if (req.query?.all === 'true' || req.body?.all === true) {
            return "all";
        }
        return cleanUrl;
    }
    return "all";
};

// =========================
// Check for Changes (dry run)
// =========================
export const checkForChanges = async (req: Request, res: Response, next: NextFunction) => {
    const clientName = resolveClientName(req);

    const result = await versionUpdater.checkForChanges(clientName);

    SuccessResponse(res, {
        message: "Version check completed",
        result,
    });
};

// =========================
// Sync All (frontend + backend)
// =========================
export const syncAll = async (req: Request, res: Response, next: NextFunction) => {
    const clientName = resolveClientName(req);

    const result = await versionUpdater.syncAll(clientName);

    SuccessResponse(res, {
        message: `Full sync started for ${clientName}`,
        result,
    });
};

// =========================
// Get Sync Status
// =========================
export const getSyncStatus = async (req: Request, res: Response, next: NextFunction) => {
    const rawClient = (req.params.clientName || req.body?.clientName || req.query?.clientName || "").trim();
    const clientName = rawClient || resolveClientName(req);

    const result = await versionUpdater.getSyncStatus(clientName);

    SuccessResponse(res, {
        message: "Sync status",
        result,
    });
};

// =========================
// Sync Frontend Only
// =========================
export const syncFrontend = async (req: Request, res: Response, next: NextFunction) => {
    const clientName = resolveClientName(req);

    const result = await versionUpdater.syncFrontend(clientName);

    SuccessResponse(res, {
        message: `Frontend sync completed for ${clientName}`,
        result,
    });
};

// =========================
// Sync Backend Only
// =========================
export const syncBackend = async (req: Request, res: Response, next: NextFunction) => {
    const clientName = resolveClientName(req);

    const result = await versionUpdater.syncBackend(clientName);

    SuccessResponse(res, {
        message: `Backend sync completed for ${clientName}`,
        result,
    });
};
