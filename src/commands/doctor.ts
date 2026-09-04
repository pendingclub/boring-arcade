import { versions } from "node:process";
import type { ArcadeConfig } from "../config.js";

export interface DoctorResult {
  status: "ok";
  version: string;
  runtime: string;
  apiOrigin: string;
}

export function runDoctor(config: ArcadeConfig): DoctorResult {
  return {
    status: "ok",
    version: config.version,
    runtime: `node ${versions.node}`,
    apiOrigin: config.apiOrigin
  };
}
