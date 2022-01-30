import Operator, { OperatorLogger, ResourceEvent, ResourceEventType } from "@dot-i/k8s-operator";
import { deleteStorageZone, handleStorageZoneModification } from "./manageStorageZone";
import { BUNNY_CDN_PULL_ZONE, BUNNY_CDN_STORAGE_ZONE, PullZone, StorageZone } from "./types";
import { logger } from "./logger";
import { CustomObjectsApi } from "@kubernetes/client-node";
import { handlePullZoneModification } from "./managePullZone";

const BUNNY_CDN_API_KEY = process.env.BUNNY_CDN_API_KEY;

if (!BUNNY_CDN_API_KEY || BUNNY_CDN_API_KEY == "") {
  logger.error("Missing `BUNNY_CDN_API_KEY` environment variable");
  process.exit(9);
}
export const bunnyAPIHeaders = { Accept: "application/json", AccessKey: BUNNY_CDN_API_KEY };

export class BunnyOperator extends Operator {
  customObjectsAPIClient: CustomObjectsApi;
  constructor(logger?: OperatorLogger) {
    super(logger);
    this.customObjectsAPIClient = this.kubeConfig.makeApiClient(CustomObjectsApi);
  }

  protected async init(): Promise<void> {
    // storage zone
    await this.watchResource(
      BUNNY_CDN_STORAGE_ZONE.API_GROUP,
      BUNNY_CDN_STORAGE_ZONE.API_VERSION,
      BUNNY_CDN_STORAGE_ZONE.PLURAL,
      async e => {
        const object = e.object as StorageZone;
        const metadata = object.metadata;
        try {
          if (e.type === ResourceEventType.Added || e.type === ResourceEventType.Modified) {
            const isOpDelete = await this.handleResourceFinalizer(e, BUNNY_CDN_STORAGE_ZONE.API_GROUP, e => this.onStorageZoneDeleted(e));
            if (!isOpDelete) {
              await this.onStorageZoneModified(e);
            }
          }
        } catch (err) {
          logger.error(`Failed to process event for resource ${metadata?.name}: ` + (err instanceof Error ? err.message : "error unknown"));
        }
      }
    );

    // pull zone
    await this.watchResource(BUNNY_CDN_PULL_ZONE.API_GROUP, BUNNY_CDN_PULL_ZONE.API_VERSION, BUNNY_CDN_PULL_ZONE.PLURAL, async e => {
      const object = e.object as PullZone;
      const metadata = object.metadata;
      try {
        if (e.type === ResourceEventType.Added || e.type === ResourceEventType.Modified) {
          const isOpDelete = await this.handleResourceFinalizer(e, BUNNY_CDN_PULL_ZONE.API_GROUP, e => this.onPullZoneDeleted(e));
          if (!isOpDelete) {
            await this.onPullZoneModified(e);
          }
        }
      } catch (err) {
        logger.error(`Failed to process event for resource ${metadata?.name}: ` + (err instanceof Error ? err.message : "error unknown"));
      }
    });
  }

  private async onStorageZoneModified(e: ResourceEvent): Promise<void> {
    const object = e.object as StorageZone;
    const metadata = object.metadata;

    if (!object.status || object.status.observedGeneration !== metadata.generation) {
      // handle resource modification here
      const { ready, message, id } = await handleStorageZoneModification(metadata.name, object.spec);
      await this.setResourceStatus(e.meta, { observedGeneration: metadata.generation, ready, message, id });
    }
  }

  private async onStorageZoneDeleted(e: ResourceEvent): Promise<void> {
    const object = e.object as StorageZone;

    if (object?.status?.ready) {
      // do delete
      if (!object.status.id) {
        // this shouldn't happen
        throw new Error("Failed to find storage zone ID from resource state");
      }
      await deleteStorageZone(object.status.id);
    } else {
      // ignore
    }
    logger.debug("Storage zone deleted");
  }

  private async onPullZoneModified(e: ResourceEvent): Promise<void> {
    const object = e.object as PullZone;
    const metadata = object.metadata;

    if (!object.status || object.status.observedGeneration !== metadata.generation) {
      // handle resource modification here
      const { ready, message, id } = await handlePullZoneModification(object, this.customObjectsAPIClient, this.k8sApi);
      await this.setResourceStatus(e.meta, { observedGeneration: metadata.generation, ready, message, id });
    }
  }

  private async onPullZoneDeleted(e: ResourceEvent): Promise<void> {
    const object = e.object as PullZone;
    if (object?.status?.ready) {
      // do delete
      if (!object.status.id) {
        // this shouldn't happen
        throw new Error("Failed to find pull zone ID from resource state");
      }
      // await deleteStorageZone(object.status.id);
    } else {
      // ignore
    }
    logger.debug("pull zone deleted");
  }
}
