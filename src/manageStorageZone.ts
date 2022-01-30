import { CoreV1Api, CustomObjectsApi } from "@kubernetes/client-node";
import axios from "axios";
import { hasOwnPropertyOfType } from "typechecking-toolkit";
import { logger } from "./logger";
import { bunnyAPIHeaders } from "./operator";
import { BUNNY_CDN_STORAGE_ZONE, Regions, StorageZone } from "./types";
import { createK8Secret } from "./utils/k8Secret";
import { isNestedHttpResponse, StorageZoneNotReadyError } from "./utils/misc";

interface ApiStorageZone {
  Id: number;
  Name: string;
  Deleted: boolean;
  Region: Regions;
  ReplicationRegions: Regions[];
  PullZones: [] | null; // #TODO
  ReadOnlyPassword: string;
  Password: string;
}

// util
interface IBunnyAPIErrorPayload {
  ErrorKey: string;
  Field: string;
  Message: string;
}

const isBunnyAPIErrorPayload = (err: unknown): err is IBunnyAPIErrorPayload => {
  return (
    hasOwnPropertyOfType(err, "ErrorKey", "string") &&
    hasOwnPropertyOfType(err, "Field", "string") &&
    hasOwnPropertyOfType(err, "Message", "string")
  );
};

const getStorageZones = async (): Promise<Array<ApiStorageZone>> => {
  const res = await axios.get<{ Items: Array<ApiStorageZone> }>("https://api.bunny.net/storagezone?page=1&perPage=1000", {
    headers: bunnyAPIHeaders,
  });
  if (!res.data?.Items) throw new Error("Failed to fetch storage zones");
  if (res.data.Items.length >= 1000) throw new Error("Too many pages, not implemented !");

  return res.data.Items;
};

export const getOrCreateStorageZone = async (name: string, region?: string, replicationRegions?: string[]): Promise<ApiStorageZone> => {
  const zones = await getStorageZones();
  const existingZone = zones.find(zone => zone.Name == name);
  if (existingZone) {
    logger.debug(`Storage zone ${name} already exists (${existingZone.Id}), skipping...`);
    return existingZone;
  } else {
    try {
      const res = await axios.post<ApiStorageZone>(
        "https://api.bunny.net/storagezone",
        {
          Name: name,
          ...(region ? { Region: region } : {}),
          ...(replicationRegions ? { ReplicationRegions: replicationRegions } : {}),
        },
        { headers: bunnyAPIHeaders }
      );
      return res.data;
    } catch (e) {
      if (axios.isAxiosError(e)) {
        const data = e.response?.data;
        if (isBunnyAPIErrorPayload(data)) throw new Error(data.Message);
      }
      throw e;
    }
  }
};

type IStorageZoneCreationStatus = { ready: true; message: ""; id: number } | { ready: false; message: string; id?: never };

export const handleStorageZoneModification = async (object: StorageZone, k8sApiClient: CoreV1Api): Promise<IStorageZoneCreationStatus> => {
  try {
    const { metadata, spec } = object;
    const { name } = metadata;
    const { region, replicationRegions } = spec;

    const { Id, Name, Password, ReadOnlyPassword } = await getOrCreateStorageZone(name, region, replicationRegions);
    // #TODO handle update
    await createK8Secret(
      k8sApiClient,
      `${name}.storagezone.credentials`,
      {
        BUNNY_CDN_STORAGE_ZONE_ID: Buffer.from(Id.toString()).toString("base64"),
        BUNNY_CDN_STORAGE_ZONE_NAME: Buffer.from(Name).toString("base64"),
        BUNNY_CDN_STORAGE_ZONE_PASSWORD: Buffer.from(Password).toString("base64"),
        BUNNY_CDN_STORAGE_ZONE_RO_PASSWORD: Buffer.from(ReadOnlyPassword).toString("base64"),
        BUNNY_CDN_STORAGE_ZONE_HOSTNAME: Buffer.from("storage.bunnycdn.com").toString("base64"),
        BUNNY_CDN_STORAGE_ZONE_USERNAME: Buffer.from(Name).toString("base64"),
        BUNNY_CDN_STORAGE_ZONE_PORT: Buffer.from("21").toString("base64"),
      },
      metadata.namespace,
      object
    );
    return { ready: true, message: "", id: Id };
  } catch (e) {
    return { ready: false, message: e instanceof Error ? e.message : "Unknown" };
  }
};

export const deleteStorageZone = async (id: number): Promise<void> => {
  await axios.delete<ApiStorageZone>(`https://api.bunny.net/storagezone/${id}`, { headers: bunnyAPIHeaders });
};

// util
export const getStorageZoneCrStatusId = async (
  name: string,
  namespace: string,
  customObjectsAPIClient: CustomObjectsApi
): Promise<number> => {
  try {
    const { body } = await customObjectsAPIClient.getNamespacedCustomObjectStatus(
      BUNNY_CDN_STORAGE_ZONE.API_GROUP,
      BUNNY_CDN_STORAGE_ZONE.API_VERSION,
      namespace,
      BUNNY_CDN_STORAGE_ZONE.PLURAL,
      name
    );

    const { status } = body as StorageZone;

    if (!status?.ready || !status?.id) throw new StorageZoneNotReadyError(`Storage zone ${name} in ${namespace} is not ready`);

    return status.id;
  } catch (e) {
    if (isNestedHttpResponse(e)) {
      if (e.response.statusCode == 404) {
        throw `Storage Zone ${name} in ${namespace} not found.`;
      }
    }
    throw e;
  }
};
