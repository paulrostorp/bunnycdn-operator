import axios from "axios";
import { hasOwnPropertyOfType } from "typechecking-toolkit";
import { logger } from "./logger";
import { bunnyAPIHeaders } from "./operator";
import { Regions, StorageZoneSpec } from "./types";

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

type IStorageZoneCreationStatus = { ready: true; message: ""; id: number } | { ready: false; message: string; id?: never };

export const getOrCreateStorageZone = async (
  name: string,
  region?: string,
  replicationRegions?: string[]
): Promise<IStorageZoneCreationStatus> => {
  const zones = await getStorageZones();
  const existingZone = zones.find(zone => zone.Name == name);
  if (existingZone) {
    logger.debug(`Storage zone ${name} already exists (${existingZone.Id}), skipping...`);
    return { ready: true, message: "", id: existingZone.Id };
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

      return { ready: true, message: "", id: res.data.Id };
    } catch (e) {
      if (axios.isAxiosError(e)) {
        const data = e.response?.data;
        if (isBunnyAPIErrorPayload(data)) return { ready: false, message: data.Message };

        return { ready: false, message: e.message };
      }

      return { ready: false, message: e instanceof Error ? e.message : "Unknown" };
    }
  }
};

export const handleStorageZoneModification = async (
  name: string,
  { region, replicationRegions }: StorageZoneSpec
): Promise<IStorageZoneCreationStatus> => {
  const zone = await getOrCreateStorageZone(name, region, replicationRegions);
  // #TODO handle update

  return zone;
};

export const deleteStorageZone = async (id: number): Promise<void> => {
  await axios.delete<ApiStorageZone>(`https://api.bunny.net/storagezone/${id}`, { headers: bunnyAPIHeaders });
};
