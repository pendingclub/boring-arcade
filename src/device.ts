import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign,
  verify,
  type KeyObject
} from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, resolve } from "node:path";
import { canonicalJson } from "./shared/index.js";

interface StoredDevice {
  version: 1;
  algorithm: "ed25519";
  privateKey: string;
  publicKey: string;
  deviceId?: string;
}

export interface LocalDevice {
  algorithm: "ed25519";
  deviceId: string | undefined;
  privateKey: KeyObject;
  publicKey: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export function arcadeHome(environment: NodeJS.ProcessEnv): string {
  const configured = environment.BORING_ARCADE_HOME?.trim();
  if (configured) return resolve(configured);
  if (platform() === "win32") {
    return resolve(environment.APPDATA?.trim() || homedir(), "website-boring", "arcade");
  }
  if (platform() === "darwin") {
    return resolve(homedir(), "Library", "Application Support", "website-boring", "arcade");
  }
  return resolve(environment.XDG_CONFIG_HOME?.trim() || resolve(homedir(), ".config"), "website-boring", "arcade");
}

export function deviceFilePath(environment: NodeJS.ProcessEnv): string {
  return resolve(arcadeHome(environment), "device.json");
}

function decodeDevice(value: unknown): LocalDevice {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    value.algorithm !== "ed25519" ||
    typeof value.privateKey !== "string" ||
    typeof value.publicKey !== "string" ||
    (value.deviceId !== undefined && typeof value.deviceId !== "string")
  ) {
    throw new Error("The local Arcade device file is invalid");
  }
  try {
    const privateKey = createPrivateKey({
      format: "der",
      key: Buffer.from(value.privateKey, "base64"),
      type: "pkcs8"
    });
    const publicKeyObject = createPublicKey({
      format: "der",
      key: Buffer.from(value.publicKey, "base64"),
      type: "spki"
    });
    const probe = Buffer.from("website-boring-device-check", "utf8");
    if (!verify(null, probe, publicKeyObject, sign(null, probe, privateKey))) {
      throw new Error("Device key pair does not match");
    }
    return {
      algorithm: "ed25519",
      deviceId: value.deviceId,
      privateKey,
      publicKey: value.publicKey
    };
  } catch (error) {
    throw new Error("The local Arcade device key cannot be read", { cause: error });
  }
}

function storedDevice(device: LocalDevice): StoredDevice {
  const privateKey = device.privateKey
    .export({ format: "der", type: "pkcs8" })
    .toString("base64");
  return device.deviceId === undefined
    ? {
        version: 1,
        algorithm: "ed25519",
        privateKey,
        publicKey: device.publicKey
      }
    : {
        version: 1,
        algorithm: "ed25519",
        privateKey,
        publicKey: device.publicKey,
        deviceId: device.deviceId
      };
}

export async function loadLocalDevice(
  environment: NodeJS.ProcessEnv
): Promise<LocalDevice | null> {
  try {
    return decodeDevice(JSON.parse(await readFile(deviceFilePath(environment), "utf8")));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }
}

export async function ensureLocalDevice(
  environment: NodeJS.ProcessEnv
): Promise<LocalDevice> {
  const existing = await loadLocalDevice(environment);
  if (existing) return existing;

  const pair = generateKeyPairSync("ed25519");
  const device: LocalDevice = {
    algorithm: "ed25519",
    deviceId: undefined,
    privateKey: pair.privateKey,
    publicKey: pair.publicKey
      .export({ format: "der", type: "spki" })
      .toString("base64")
  };
  const path = deviceFilePath(environment);
  await mkdir(dirname(path), { mode: 0o700, recursive: true });
  try {
    await writeFile(path, `${JSON.stringify(storedDevice(device))}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
    await chmod(path, 0o600);
    return device;
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      const concurrent = await loadLocalDevice(environment);
      if (concurrent) return concurrent;
    }
    throw error;
  }
}

export async function saveLinkedDevice(
  environment: NodeJS.ProcessEnv,
  device: LocalDevice,
  deviceId: string
): Promise<LocalDevice> {
  if (deviceId.trim().length === 0) throw new Error("Device id must not be empty");
  const linked: LocalDevice = { ...device, deviceId };
  const path = deviceFilePath(environment);
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  await mkdir(dirname(path), { mode: 0o700, recursive: true });
  try {
    await writeFile(temporaryPath, `${JSON.stringify(storedDevice(linked))}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
    await rename(temporaryPath, path);
    await chmod(path, 0o600);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  return linked;
}

export function signCanonicalPayload(
  device: LocalDevice,
  payload: unknown
): string {
  return sign(
    null,
    Buffer.from(canonicalJson(payload), "utf8"),
    device.privateKey
  ).toString("base64");
}
