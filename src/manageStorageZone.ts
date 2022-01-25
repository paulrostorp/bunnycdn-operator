import axios from "axios";
import { bunnyAPIHeaders } from "./operator";
import { Regions } from "./PullZone";

interface ApiStorageZone {
  Id: number;
  Name: string;
  // Password: "2435eb42-c5ce-4524-92ab89d8c5de-b4c8-4a42";
  // DateModified: "2022-01-20T14:29:18.0773833Z";
  Deleted: boolean;
  Region: Regions;
  ReplicationRegions: Regions[];
  PullZones: [] | null; // #TODO
  ReadOnlyPassword: string;
}

const getStorageZones = async (): Promise<Array<ApiStorageZone>> => {
  const res = await axios.get<{ Items: Array<ApiStorageZone> }>("https://api.bunny.net/storagezone?page=1&perPage=1000", {
    headers: bunnyAPIHeaders,
  });
  if (!res.data?.Items) throw new Error("Failed to fetch storage zones");
  if (res.data.Items.length >= 1000) throw new Error("Too many pages, not implemented !");

  return res.data.Items;
};

const getOrCreateStorageZone = async (name: string, originUrl: string): Promise<ApiStorageZone> => {
  const zones = await getStorageZones();
  const existingZone = zones.find(zone => zone.Name == name);
  if (existingZone) {
    console.debug(`Storage zone ${name} already exists (${existingZone.Id}), skipping...`);
    // #TODO handle update
    return existingZone;
  } else {
    const res = await axios.post<ApiStorageZone>(
      "https://api.bunny.net/pullzone",
      {
        Name: name,
        // OriginUrl: originUrl,
        // Region:
      },
      { headers: bunnyAPIHeaders }
    );

    return res.data;
  }
};
