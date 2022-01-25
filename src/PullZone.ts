import { KubernetesObject, V1ObjectMeta, V1RollingUpdateDeployment } from "@kubernetes/client-node";

export const API_GROUP = "bunny-cdn-operator.com";
export const BUNNY_CDN_PULL_ZONE = {
  API_GROUP,
  API_VERSION: "v1alpha1",
  PLURAL: "pullzones",
};
export const BUNNY_CDN_STORAGE_ZONE = {
  API_GROUP,
  API_VERSION: "v1alpha1",
  PLURAL: "storagezones",
};

// PullZone
export interface PullZone extends KubernetesObject {
  spec: PullZoneSpec;
  metadata: PullZoneMeta;
  status: PullZoneStatus;
}

export interface PullZoneMeta extends V1ObjectMeta {
  name: string;
  namespace: string;
}

export interface PullZoneSpec {
  origin: {
    storageZoneRef?: ResourceReference;
    // #TODO
  };
}

export interface PullZoneStatus {
  observedGeneration?: number;
}
// Storage Zone
export interface StorageZone extends KubernetesObject {
  metadata: StorageZoneMeta;
  spec: StorageZoneSpec;
  status: StorageZoneStatus;
}
export interface StorageZoneMeta extends V1ObjectMeta {
  name: string;
  namespace: string;
}

export type Regions = "DE" | "NY" | "LA" | "SG" | "SYD";
export interface StorageZoneSpec {
  region?: Regions;
  replicationRegions?: Regions[];
}

export interface StorageZoneStatus {
  id?: number;
  observedGeneration?: number;
}

// Origin
// export interface PullZone extends KubernetesObject {
//   spec: PullZoneSpec;
//   metadata: PullZoneMeta;
//   status: PullZoneStatus;
// }

// export interface PullZoneMeta extends V1ObjectMeta {
//   name: string;
//   namespace: string;
// }

// export interface PullZoneSpec {
//   origin: {
//     storageZoneRef: ResourceReference;
//   };
// }

// export interface PullZoneStatus {
//   observedGeneration?: number;
// }

// utils
interface ResourceReference {
  name: string;
  kind: string;
  namespace: string;
}

// API types
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
  Hostnames: Array<IHostname>;

  MonthlyBandwidthLimit: number;
  Type: 0 | 1; // The type of the pull zone. Premium = 0, Volume = 1
  ErrorPageWhitelabel: boolean;

  StorageZoneId: number;

  ZoneSecurityEnabled: boolean;
  ZoneSecurityKey: string;
  AWSSigningEnabled: boolean;
  AWSSigningKey: string;
  AWSSigningSecret: string;
  AWSSigningRegionName: string;
  EnableCacheSlice: boolean; // Determines if cache slicing (Optimize for video) should be enabled for this zone
}
