import { isNestedHttpResponse, PullZoneNotReadyError, StorageZoneNotReadyError } from "./utils/misc";
import { CoreV1Api, CustomObjectsApi } from "@kubernetes/client-node";
import { getStorageZoneCrStatusId } from "./manageStorageZone";
import { BUNNY_CDN_PULL_ZONE, PullZone } from "./types";
import { createK8Secret } from "./utils/k8Secret";
import axios, { AxiosResponse } from "axios";
import { bunnyAPIHeaders } from "./operator";
import { backOff } from "exponential-backoff";
import { logger } from "./logger";

interface IHostname {
  Id: number;
  Value: string;
  ForceSSL: boolean;
  IsSystemHostname: boolean;
  HasCertificate: boolean;
}

interface IPullZone {
  Id: number;
  Name: string;
  OriginUrl: string;
  StorageZoneId: number;
  Hostnames: Array<IHostname>;
  MonthlyBandwidthLimit: number;
  Type: 0 | 1; // The type of the pull zone. Premium = 0, Volume = 1
  ErrorPageWhitelabel: boolean;
  ZoneSecurityEnabled: boolean;
  ZoneSecurityKey: string;
  EnableCacheSlice: boolean; // Determines if cache slicing (Optimize for video) should be enabled for this zone
}

const getPullZones = async (): Promise<Array<IPullZone>> => {
  const res = await axios.get<{ Items: Array<IPullZone> }>("https://api.bunny.net/pullzone?page=1&perPage=1000", {
    headers: bunnyAPIHeaders,
  });
  if (!res.data?.Items) throw new Error("Failed to fetch pull zones");
  if (res.data.Items.length >= 1000) throw new Error("Too many environments, not implemented !");

  return res.data.Items;
};

type ICreatePullZoneProps = Pick<IPullZone, "Name" | "Type"> &
  Pick<Partial<IPullZone>, "StorageZoneId" | "OriginUrl"> &
  (Pick<IPullZone, "OriginUrl"> | Pick<IPullZone, "StorageZoneId">);

const getOrCreatePullZone = async (config: ICreatePullZoneProps): Promise<IPullZone> => {
  const zones = await getPullZones();
  const existingZone = zones.find(zone => zone.Name == config.Name);
  if (existingZone) {
    logger.debug(`Pull Zone ${config.Name} already exists (${existingZone.Id}), skipping creation...`);

    return existingZone;
  } else {
    const res = await axios.post<ICreatePullZoneProps, AxiosResponse<IPullZone>>("https://api.bunny.net/pullzone", config, {
      headers: bunnyAPIHeaders,
    });

    return res.data;
  }
};

const getOriginConfig = async (
  object: PullZone,
  customObjectsAPIClient: CustomObjectsApi
): Promise<{ StorageZoneId: number } | { OriginUrl: string }> => {
  const { spec, metadata } = object;
  if (spec.storageZoneRef) {
    const { name, namespace = metadata.namespace } = spec.storageZoneRef;

    const id = await backOff(() => getStorageZoneCrStatusId(name, namespace, customObjectsAPIClient), {
      retry: (e, attempt) => {
        if (e instanceof StorageZoneNotReadyError) {
          logger.debug("Storage zone not ready, retrying...", { attempt });
          return true;
        } else {
          logger.error("Storage zone was not ready after 5 attempt, giving up...", { attempt });
          return false;
        }
      },
      numOfAttempts: 5,
      startingDelay: 500,
    });

    return { StorageZoneId: id };
  } else if (spec.storageZoneId) {
    return { StorageZoneId: spec.storageZoneId };
  } else if (spec.originUrl) {
    return { OriginUrl: spec.originUrl };
  } else {
    throw new Error(`Required property missing on ${name}: at least one of "originUrl", "storageZoneId" or "storageZoneRef" is required`);
  }
};

type IUpdatePullZoneProps = Partial<Omit<IPullZone, "Name" | "Id" | "ZoneSecurityKey" | "Hostnames">>;
const updatePullZone = async (id: number, config: IUpdatePullZoneProps): Promise<IPullZone> => {
  const { data } = await axios.post<IUpdatePullZoneProps, AxiosResponse<IPullZone>>(`https://api.bunny.net/pullzone/${id}`, config, {
    headers: bunnyAPIHeaders,
  });
  return data;
};

const getOrCreatePullZoneConfig = async (
  object: PullZone,
  customObjectsAPIClient: CustomObjectsApi
): Promise<{ createConfig: ICreatePullZoneProps; updateConfig: IUpdatePullZoneProps }> => {
  const { spec, metadata } = object;
  const originConfig = await getOriginConfig(object, customObjectsAPIClient);
  const createConfig: ICreatePullZoneProps = {
    Name: metadata.name,
    Type: spec.zoneType.trim() == "premium" ? 0 : 1,
    ...originConfig,
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { Name, ...other } = createConfig;
  const updateConfig: IUpdatePullZoneProps = {
    ...other,
    EnableCacheSlice: spec.enabledCacheSlice,
    ErrorPageWhitelabel: spec.errorPageWhiteLabel,
    MonthlyBandwidthLimit: spec.monthlyBandwidthLimit,
    ZoneSecurityEnabled: spec.zoneSecurityEnabled,
  };
  return { createConfig, updateConfig };
};

type IPullZoneCreationStatus = { ready: true; message: ""; id: number } | { ready: false; message: string; id?: never };

export const handlePullZoneModification = async (
  object: PullZone,
  customObjectsAPIClient: CustomObjectsApi,
  k8sApiClient: CoreV1Api
): Promise<IPullZoneCreationStatus> => {
  try {
    const { metadata } = object;
    const { createConfig, updateConfig } = await getOrCreatePullZoneConfig(object, customObjectsAPIClient);
    const { Id } = await getOrCreatePullZone(createConfig);
    const zone = await updatePullZone(Id, updateConfig);
    await createK8Secret(
      k8sApiClient,
      `${zone.Name}.pullzone.credentials`,
      {
        BUNNY_CDN_ZONE_ID: Buffer.from(zone.Id.toString()).toString("base64"),
        BUNNY_CDN_ZONE_SECURITY_KEY: Buffer.from(zone.ZoneSecurityKey).toString("base64"),
        BUNNY_CDN_ZONE_HOST: Buffer.from(zone.Hostnames[0].Value).toString("base64"),
      },
      metadata.namespace,
      object
    );
    return { ready: true, message: "", id: Id };
  } catch (e) {
    logger.error("Failed to upsert pull zone:", e);
    return { ready: false, message: e instanceof Error ? e.message : "Unknown" };
  }
};

export const deletePullZone = async (id: number): Promise<void> => {
  await axios.delete(`https://api.bunny.net/pullzone/${id}`, { headers: bunnyAPIHeaders });
};

// util
export const getPullZoneCrStatusId = async (name: string, namespace: string, customObjectsAPIClient: CustomObjectsApi): Promise<number> => {
  try {
    const { body } = await customObjectsAPIClient.getNamespacedCustomObjectStatus(
      BUNNY_CDN_PULL_ZONE.API_GROUP,
      BUNNY_CDN_PULL_ZONE.API_VERSION,
      namespace,
      BUNNY_CDN_PULL_ZONE.PLURAL,
      name
    );

    const { status } = body as PullZone;

    if (!status?.ready || !status?.id) throw new PullZoneNotReadyError(`Pull zone ${name} in ${namespace} is not ready`);

    return status.id;
  } catch (e) {
    if (isNestedHttpResponse(e)) {
      if (e.response.statusCode == 404) {
        throw `Pull Zone ${name} in ${namespace} not found.`;
      }
    }
    throw e;
  }
};
