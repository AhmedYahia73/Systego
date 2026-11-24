import { Router, Request, Response, NextFunction } from "express";
import { catchAsync } from "../../utils/catchAsync";
import {
    checkForChanges,
    syncAll,
    getSyncStatus,
    syncFrontend,
    syncBackend,
} from "../../controller/admin/VersionUpdater";
import { authenticated } from "../../middlewares/authenticated";
import { Unauthorized } from "../../Errors";

const route = Router();

// Flexible auth: allows either API Key (header or query) OR Bearer JWT Token OR localhost
const flexibleAuth = (req: Request, res: Response, next: NextFunction) => {
    const apiKey = (req.headers["x-api-key"] || req.query?.key || "") as string;
    const expectedKey = process.env.VERSION_UPDATER_API_KEY || "698f334b-53b1-69fd-612f-bd9c30d9222c";

    if (apiKey && apiKey === expectedKey) {
        return next();
    }

    if (req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
        return authenticated(req, res, next);
    }

    const ip = req.ip || req.socket.remoteAddress;
    if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") {
        return next();
    }

    throw new Unauthorized("Authentication required: provide x-api-key header, ?key= query parameter, or Bearer token");
};

route.use(flexibleAuth);

// Check for changes (dry run) - supports both GET and POST
route.get("/", catchAsync(checkForChanges));
route.post("/", catchAsync(checkForChanges));

// Sync all (frontend + backend) - supports both GET and POST
route.get("/sync", catchAsync(syncAll));
route.post("/sync", catchAsync(syncAll));

// Sync all tenants explicitly
route.get("/sync-all", catchAsync((req, res, next) => {
    req.body = { ...req.body, clientName: "all" };
    return syncAll(req, res, next);
}));
route.post("/sync-all", catchAsync((req, res, next) => {
    req.body = { ...req.body, clientName: "all" };
    return syncAll(req, res, next);
}));

// Get sync status (polling)
route.get("/status", catchAsync(getSyncStatus));
route.get("/status/:clientName", catchAsync(getSyncStatus));
route.post("/status", catchAsync(getSyncStatus));

// Sync frontend only
route.get("/sync-frontend", catchAsync(syncFrontend));
route.post("/sync-frontend", catchAsync(syncFrontend));

// Sync backend only
route.get("/sync-backend", catchAsync(syncBackend));
route.post("/sync-backend", catchAsync(syncBackend));

export default route;
