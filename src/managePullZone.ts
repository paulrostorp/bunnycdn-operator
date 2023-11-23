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
  MonthlyBandwidthLimit: number; // Sets the monthly limit of bandwidth in bytes that the pullzone is allowed to use
  Type: 0 | 1; // The type of the pull zone. Premium = 0, Volume = 1
  ErrorPageWhitelabel: boolean; // Determines if the error pages should be whitelabel or not
  ZoneSecurityEnabled: boolean; // Determines if the zone token authentication security should be enabled
  ZoneSecurityKey: string;
  EnableCacheSlice: boolean; // Determines if cache slicing (Optimize for video) should be enabled for this zone
  EnableSmartCache: boolean; // Dynamically selects if a request should be cached based on the file extension and MIME type to allow easy full-site acceleration. If the request is cacheable, the Cache Expiration Time setting will be applied.
  CacheControlMaxAgeOverride: number; // Sets the cache control override setting for this zone
  CacheControlBrowserMaxAgeOverride: number; // Sets the browser cache control override setting for this zone
  EnableQueryStringOrdering: boolean; // Determines if the query string ordering should be enabled.
  CacheErrorResponses: boolean; // Determines if the cache error responses should be enabled on the zone
  IgnoreQueryStrings: boolean; // Determines if the Pull Zone should ignore query strings when serving cached objects (Vary by Query String)
  QueryStringVaryParameters: string[]; // Contains the list of vary parameters that will be used for vary cache by query string. If empty, all parameters will be used to construct the key
  EnableWebpVary: boolean; // Determines if the WebP Vary feature should be enabled.
  EnableAvifVary: boolean; // Determines if the AVIF Vary feature should be enabled.
  EnableMobileVary: boolean; // Determines if the Mobile Vary feature is enabled.
  EnableCountryCodeVary: boolean; // Determines if the Country Code Vary feature should be enabled.
  EnableHostnameVary: boolean; // Determines if the Hostname Vary feature should be enabled.
  EnableCookieVary: boolean; // Determines if the Cookie Vary feature is enabled.
  CookieVaryParameters: string[]; // Contains the list of vary parameters that will be used for vary cache by cookie string. If empty, cookie vary will not be used.
  DisableCookies: boolean; // Determines if the Pull Zone should automatically remove cookies from the responses
  UseStaleWhileOffline: boolean; // Determines if we should use stale cache while the origin is offline
  UseStaleWhileUpdating: boolean; // Determines if we should use stale cache while cache is updating
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
          logger.debug("Storage Zone not ready, retrying...", { attempt });
          return true;
        } else {
          logger.error("Storage Zone was not ready after 5 attempt, giving up...", { attempt });
          logger.debug(e); // extended error
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
    EnableSmartCache: spec.enableSmartCache,
    CacheControlMaxAgeOverride: spec.cacheExpirationTime,
    CacheControlBrowserMaxAgeOverride: spec.browserCacheExpirationTime,
    EnableQueryStringOrdering: spec.enableQueryStringSort,
    CacheErrorResponses: spec.cacheErrorResponses,
    IgnoreQueryStrings: !spec.enableQueryStringVary,
    QueryStringVaryParameters: spec.queryStringVaryParameters,
    EnableWebpVary: spec.enableWebpVary,
    EnableAvifVary: spec.enableAvifVary,
    EnableMobileVary: spec.enableMobileVary,
    EnableCountryCodeVary: spec.enableCountryCodeVary,
    EnableHostnameVary: spec.enableHostnameVary,
    EnableCookieVary: spec.cookieVaryNames.length > 0,
    CookieVaryParameters: spec.cookieVaryNames,
    DisableCookies: spec.stripResponseCookies,
    UseStaleWhileOffline: spec.useStaleWhileOffline,
    UseStaleWhileUpdating: spec.useStaleWhileUpdating,
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
    logger.error("Failed to upsert Pull Zone:", e);
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
