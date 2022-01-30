import { CustomObjectsApi } from "@kubernetes/client-node";
import axios from "axios";
import { hasOwnPropertyOfType } from "typechecking-toolkit";
import { logger } from "./logger";
import { bunnyAPIHeaders } from "./operator";
import { BUNNY_CDN_STORAGE_ZONE, Regions, StorageZone, StorageZoneSpec } from "./types";
import { isNestedHttpResponse, StorageZoneNotReadyError } from "./utils/misc";

interface ApiStorageZone {
  Id: number;
  Name: string;
  Deleted: boolean;
  Region: Regions;
  ReplicationRegions: Regions[];
  PullZones: [] | null; // #TODO
  ReadOnlyPassword: string;
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

export const getOrCreateStorageZone = async (name: string, region?: string, replicationRegions?: string[]): Promise<number> => {
  const zones = await getStorageZones();
  const existingZone = zones.find(zone => zone.Name == name);
  if (existingZone) {
    logger.debug(`Storage zone ${name} already exists (${existingZone.Id}), skipping...`);
    return existingZone.Id;
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
      return res.data.Id;
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

export const handleStorageZoneModification = async (
  name: string,
  { region, replicationRegions }: StorageZoneSpec
): Promise<IStorageZoneCreationStatus> => {
  try {
    const zoneId = await getOrCreateStorageZone(name, region, replicationRegions);
    // #TODO handle update
    return { ready: true, message: "", id: zoneId };
  } catch (e) {
    return { ready: false, message: e instanceof Error ? e.message : "Unknown" };
  }
};

export const deleteStorageZone = async (id: number): Promise<void> => {
  await axios.delete<ApiStorageZone>(`https://api.bunny.net/storagezone/${id}`, { headers: bunnyAPIHeaders });
};

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
